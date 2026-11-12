// Web Worker che legge un documento e ne estrae testo e dati chiave, fuori dal thread
// dell'interfaccia: PDF (pdf.js), .p7m (busta CAdES, anche annidata), fattura elettronica XML,
// messaggio PEC (.eml). Un documento alla volta; il worker viene ricreato ogni tanto dal
// chiamante (memoria costante) e terminato se un file impiega troppo.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pageText } from '../avanzati/lib/textsearch.js';
import { openP7m, looksLikeP7m, innerName } from '../avanzati/lib/cades.js';
import { parseFattura, isFattura } from '../avanzati/lib/fattura.js';
import { parseMime, attachments, bodyText, summary, parseDaticert } from '../avanzati/lib/mime.js';
import { datiDaTesto, datiDaFattura, testoFattura, eScansione, firmePdf, VERSIONE_ESTRAZIONE } from './lib/estrai.js';
import { immaginiDisegnate, strisciaCandidata } from './lib/striscia.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(workerUrl, self.location.href).href;

const MAX_PAGINE = 400; // oltre: testo parziale (segnalato)
const MAX_CARATTERI = 400000;
let pdfWorker = null; // un solo worker di pdf.js per tutti i documenti
let assets = {};

function errore(msg, extra = {}) { return { errore: msg, ...extra }; }

async function testoPdf(bytes) {
  pdfWorker ??= new pdfjs.PDFWorker({ name: 'archivio' });
  const task = pdfjs.getDocument({ data: bytes, worker: pdfWorker, isEvalSupported: false, stopAtErrors: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: true, ...assets });
  // senza onPassword pdf.js rifiuta con PasswordException: il file protetto viene solo segnalato
  let pdf;
  try { pdf = await task.promise; }
  catch (e) {
    await task.destroy().catch(() => {});
    if (e?.name === 'PasswordException' || /password/i.test(e?.message || '')) return { protetto: true, pagine: null, testo: '', caratteri: [] };
    throw e;
  }
  try {
    const n = pdf.numPages; const parti = []; const caratteri = []; let tot = 0; let parziale = false; let striscia = null;
    for (let i = 1; i <= n; i++) {
      if (i > MAX_PAGINE || tot > MAX_CARATTERI) { parziale = true; break; }
      const page = await pdf.getPage(i);
      if (i === 1) {
        // striscia di segnatura (immagine lungo un bordo): solo individuata, la lettura è in una coda a parte
        try { const ol = await page.getOperatorList(); striscia = strisciaCandidata(immaginiDisegnate(ol.fnArray, ol.argsArray, pdfjs.OPS), page.view); } catch { striscia = null; }
      }
      const tc = await page.getTextContent();
      const t = pageText(tc.items).replace(/\f/g, ' ');
      parti.push(t); caratteri.push(t.replace(/\s+/g, '').length); tot += t.length;
      page.cleanup();
    }
    let testo = parti.join('\f');
    if (testo.length > MAX_CARATTERI) { testo = testo.slice(0, MAX_CARATTERI); parziale = true; }
    return { pagine: n, testo, caratteri, parziale, protetto: false, striscia };
  } finally { await task.destroy().catch(() => {}); }
}

function testoEml(bytes) {
  const root = parseMime(bytes);
  const all = attachments(root);
  let info = summary(root); let corpo = bodyText(root); let ricevuta = null; let allegati = all;
  const daticert = all.find((a) => /daticert\.xml$/i.test(a.name));
  if (daticert) { try { ricevuta = parseDaticert(daticert.bytes); } catch { /* ricevuta illeggibile */ } }
  const postacert = all.find((a) => /postacert\.eml$/i.test(a.name) || a.contentType === 'message/rfc822');
  if (postacert?.bytes) {
    try { const inner = parseMime(postacert.bytes); info = summary(inner); corpo = bodyText(inner); allegati = attachments(inner); } catch { /* messaggio interno illeggibile */ }
  }
  const nomi = allegati.map((a) => a.name).filter((n) => !/^(daticert\.xml|postacert\.eml|smime\.p7s)$/i.test(n));
  const testo = [`Oggetto: ${info.oggetto}`, `Da: ${info.da}`, `A: ${info.a}`, ricevuta ? `${ricevuta.tipoLabel} — ${ricevuta.data}` : '', nomi.length ? 'Allegati: ' + nomi.join(', ') : '', '', corpo].filter((x) => x !== '').join('\n');
  const m = String(info.data || '').match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  const mesi = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const data = m ? `${m[3]}-${String(mesi[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
  return { testo: testo.slice(0, MAX_CARATTERI), oggetto: info.oggetto, mittente: info.da, data, ricevuta: ricevuta?.tipoLabel || '', allegati: nomi.slice(0, 50) };
}

/**
 * Estrae tutto quello che serve all'indice. d: { bytes, nome, ext, escludi }
 * → { testo, pagine, scansione, protetto, parziale, errore, firme, firmatari, contenuto, ...dati }
 */
async function estrai({ bytes, nome, escludi }) {
  const out = { v: VERSIONE_ESTRAZIONE, testo: '', pagine: null, scansione: false, protetto: false, parziale: false, errore: '', firme: 0, firmatari: [], contenuto: '' };
  const low = String(nome).toLowerCase();
  let b = bytes; let nomeInterno = nome;
  // busta firmata .p7m (anche annidata): si guarda dentro senza verificare (la verifica è nell'area avanzati)
  if (/\.(p7m|p7s|tsd|m7m)$/.test(low) || (low.endsWith('.xml') && looksLikeP7m(b))) {
    try {
      const r = await openP7m(b, { verify: false });
      const firmatari = [];
      for (const l of r.levels) for (const s of l.signers) { firmatari.push(s.name); for (const c of s.counterSigners || []) firmatari.push(c.name); }
      out.firme = firmatari.length; out.firmatari = [...new Set(firmatari)].slice(0, 20);
      if (!r.content) return { ...out, contenuto: 'p7m', ...datiDaTesto('', { nome, escludi }), tipo: 'p7m', errore: r.detached ? '' : 'Busta firmata senza contenuto' };
      b = r.content; nomeInterno = innerName(nome, r.kind);
      out.contenuto = r.kind;
    } catch (e) {
      return { ...out, ...datiDaTesto('', { nome, escludi }), tipo: 'p7m', errore: 'Busta firmata (.p7m) danneggiata o non riconosciuta' };
    }
  }
  const lowI = nomeInterno.toLowerCase();
  if (lowI.endsWith('.eml')) {
    const e = testoEml(b);
    const dati = datiDaTesto(e.testo, { nome, escludi });
    return { ...out, contenuto: 'eml', testo: e.testo, ...dati, tipo: 'pec', fornitore: dati.fornitore || e.mittente.replace(/<.*>/, '').replace(/"/g, '').trim().slice(0, 80), data: dati.data || e.data, oggetto: e.oggetto };
  }
  if (lowI.endsWith('.xml') || isFattura(b)) {
    if (!isFattura(b)) return { ...out, contenuto: 'xml', ...datiDaTesto('', { nome, escludi }), tipo: out.firme ? 'p7m' : 'altro', errore: 'File XML che non è una fattura elettronica' };
    const f = parseFattura(b);
    const testo = testoFattura(f).slice(0, MAX_CARATTERI);
    return { ...out, contenuto: 'fattura', testo, ...datiDaFattura(f, { escludi }), corpi: f.corpi.length };
  }
  // PDF
  const head = new TextDecoder('latin1').decode(b.subarray(0, 1024));
  if (!head.includes('%PDF')) return { ...out, ...datiDaTesto('', { nome, escludi }), tipo: out.firme ? 'p7m' : 'altro', errore: 'Non è un PDF valido' };
  const firme = firmePdf(b);
  if (firme.length) { out.firme += firme.length; out.firmatari = [...new Set([...out.firmatari, ...firme.filter(Boolean)])].slice(0, 20); }
  const t = await testoPdf(b);
  const dati = datiDaTesto(t.testo, { nome, escludi });
  return {
    ...out, contenuto: out.contenuto || 'pdf', testo: t.testo, pagine: t.pagine, protetto: t.protetto, parziale: !!t.parziale,
    scansione: !t.protetto && eScansione(t.caratteri || []), striscia: t.striscia || null, ...dati,
    tipo: dati.tipo === 'altro' && out.firme && out.contenuto ? 'p7m' : dati.tipo,
  };
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.t === 'assets') { assets = m.assets || {}; return; }
  if (m.t !== 'estrai') return;
  try {
    const r = await estrai(m);
    self.postMessage({ req: m.req, ok: true, r });
  } catch (e) {
    const msg = /Invalid PDF|InvalidPDF|structure|xref|bad XRef|Invalid header|FormatError|Unexpected end/i.test(e?.message || '') ? 'File danneggiato: non si riesce a leggerlo' : (e?.message || String(e)).slice(0, 200);
    self.postMessage({ req: m.req, ok: false, errore: msg, dettaglio: String(e?.stack || '').slice(0, 1500) });
  }
};
