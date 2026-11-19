// Modelli di modulo: impronta del PDF di base, campi, corrispondenze campo → dato, zone da compilare sui PDF
// non compilabili, posizione di firma/timbro, schema del nome dei file. Logica pura (niente DOM), usata
// dall'interfaccia, dal Web Worker della compilazione in serie e da «Compila a nome di» (area moduli).
//
// Modello: { id, nome, tipo: 'acroform'|'zone', blob, impronta, chiaveCampi, pagine,
//            campi: [{ nome, tipo }], corrispondenze: { nomeCampo: chiave },
//            zone: [{ id, pagina, rect:[x1,y1,x2,y2], chiave, size, allinea }],
//            firma?: { pagina, rect }, timbro?: { pagina, rect }, nomeFile? }
// Chiave: una delle chiavi di campi.js, 'oggi', 'fisso:testo', 'colonna:Nome colonna', '' = non compilare.
import * as PDFLibPredefinita from '@cantoo/pdf-lib';
import { fieldKind, scriviValori, rigeneraAspetti, moduloSicuro, campiSicuri } from './acroform.js';
import { placement, localToPdf, todayIt, winAnsiSafe, normRect } from '../../moduli/lib/geom.js';
import { chiavePerCampo, CAMPI_MODULO, CAMPI_CONTATTO, etichettaCampo } from './campi.js';

export const ALLINEAMENTI = [
  { value: 'sinistra', label: 'A sinistra' },
  { value: 'centro', label: 'Al centro' },
  { value: 'destra', label: 'A destra' },
];
const TIPI_COMPILABILI = new Set(['text', 'checkbox', 'radio', 'dropdown', 'listbox']);

// ------------------------------------------------------------------------------------------- impronte
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
/** SHA-256 (esadecimale) di byte o testo. */
export async function sha256(dati) {
  const bytes = typeof dati === 'string' ? new TextEncoder().encode(dati) : dati;
  return hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}
/** Impronta del PDF di base (riconosce lo stesso file). */
export const improntaPdf = (bytes) => sha256(bytes);
/**
 * Impronta dei campi: riconosce lo stesso modulo anche quando i byte cambiano (es. una copia già
 * compilata o salvata da un altro programma). Solo per moduli con almeno 3 campi.
 */
export async function chiaveCampi(campi, pagine = 0) {
  const nomi = [...new Set((campi || []).map((c) => c.nome))].sort();
  if (nomi.length < 3) return '';
  return sha256(`${pagine}|${nomi.join('\u0001')}`);
}

// ------------------------------------------------------------------------------------------- campi
/** Campi compilabili di un documento pdf-lib (niente pulsanti né campi firma). → [{ nome, tipo, opzioni? }] */
export function campiDaPdf(PDFLib, pdfDoc) {
  const out = []; const visti = new Set();
  const fields = campiSicuri(moduloSicuro(PDFLib, pdfDoc));
  for (const f of fields) {
    try {
      const nome = f.getName(); const tipo = fieldKind(PDFLib, f);
      if (!TIPI_COMPILABILI.has(tipo) || visti.has(nome)) continue;
      visti.add(nome);
      const c = { nome, tipo };
      if (tipo === 'radio' || tipo === 'dropdown' || tipo === 'listbox') { try { c.opzioni = f.getOptions().slice(0, 50); } catch { /* */ } }
      out.push(c);
    } catch { /* campo illeggibile */ }
  }
  return out;
}

/** Corrispondenze proposte dal nome dei campi (riconoscimento di campi.js). Caselle e scelte: non compilare. */
export function proponiCorrispondenze(campi) {
  const out = {};
  for (const c of campi || []) out[c.nome] = c.tipo === 'text' || !c.tipo ? chiavePerCampo(c.nome) || '' : '';
  return out;
}

const testo = (v, max) => String(v ?? '').slice(0, max);
const num = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
const rettangolo = (r) => (Array.isArray(r) && r.length === 4 && r.every((x) => Number.isFinite(+x)) ? normRect(r.map(Number)) : null);
function posizione(p) {
  if (!p || typeof p !== 'object') return null;
  const rect = rettangolo(p.rect); if (!rect) return null;
  return { pagina: Math.trunc(num(p.pagina, 0, -1, 100000)), rect };
}

/** Modello normalizzato (campi mancanti, tipi sbagliati). Non assegna id: lo fa archivio.salvaModello. */
export function normalizzaModello(m = {}) {
  const tipo = m.tipo === 'zone' ? 'zone' : 'acroform';
  const out = {
    ...(m.id ? { id: String(m.id) } : {}),
    nome: testo(m.nome, 120).trim() || 'Modello',
    tipo,
    blob: m.blob || null,
    impronta: typeof m.impronta === 'string' ? m.impronta : '',
    chiaveCampi: typeof m.chiaveCampi === 'string' ? m.chiaveCampi : '',
    pagine: Math.trunc(num(m.pagine, 0, 0, 100000)),
    campi: (Array.isArray(m.campi) ? m.campi : []).filter((c) => c && typeof c.nome === 'string').map((c) => ({ nome: c.nome, tipo: TIPI_COMPILABILI.has(c.tipo) ? c.tipo : 'text', ...(Array.isArray(c.opzioni) ? { opzioni: c.opzioni.map(String).slice(0, 50) } : {}) })),
    corrispondenze: {},
    zone: [],
    nomeFile: testo(m.nomeFile, 200),
  };
  for (const [k, v] of Object.entries(m.corrispondenze || {})) if (typeof v === 'string') out.corrispondenze[k] = v.slice(0, 500);
  if (tipo === 'zone') {
    out.zone = (Array.isArray(m.zone) ? m.zone : []).map((z, i) => {
      const rect = rettangolo(z?.rect); if (!rect) return null;
      return { id: String(z.id || `z${i + 1}`), pagina: Math.trunc(num(z.pagina, 0, 0, 100000)), rect, chiave: typeof z.chiave === 'string' ? z.chiave.slice(0, 500) : '', size: num(z.size, 11, 5, 72), allinea: ['sinistra', 'centro', 'destra'].includes(z.allinea) ? z.allinea : 'sinistra' };
    }).filter(Boolean);
  }
  const f = posizione(m.firma); if (f) out.firma = f;
  const t = posizione(m.timbro); if (t) out.timbro = t;
  if (m.creato) out.creato = m.creato;
  if (m.usato) out.usato = m.usato;
  return out;
}

/**
 * Prepara un modello dai byte di un PDF (impronte, campi, proposta di corrispondenze).
 * → modello normalizzato (senza id né blob)
 */
export async function modelloDaPdf(PDFLib, bytes, { nome = '', tipo = null, pdfDoc = null } = {}) {
  const doc = pdfDoc || await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const campi = campiDaPdf(PDFLib, doc);
  const pagine = doc.getPageCount();
  return normalizzaModello({
    nome, tipo: tipo || (campi.length ? 'acroform' : 'zone'), pagine, campi,
    impronta: await improntaPdf(bytes), chiaveCampi: await chiaveCampi(campi, pagine),
    corrispondenze: proponiCorrispondenze(campi),
  });
}

/** Corrispondenze { nomeCampo: chiave } salvate in un modello (per «Compila a nome di» e la serie). */
export function corrispondenzeModello(modello) {
  if (!modello) return {};
  const out = { ...(modello.corrispondenze || {}) };
  for (const c of modello.campi || []) if (!Object.prototype.hasOwnProperty.call(out, c.nome)) out[c.nome] = '';
  return out;
}

/**
 * Modello salvato che corrisponde a un documento (stessa impronta del PDF; per i moduli compilabili
 * anche stessi campi e pagine). archivio: l'archivio personale (o un elenco di modelli).
 * opts.pdfDoc + opts.PDFLib: documento già aperto con pdf-lib (evita una seconda lettura).
 * → modello | null
 */
export async function modelloPerDocumento(archivio, bytes, { PDFLib = null, pdfDoc = null } = {}) {
  const elenco = Array.isArray(archivio) ? archivio : (archivio?.aperto === false ? [] : archivio?.modelli?.() || []);
  if (!elenco.length || !bytes?.length) return null;
  const imp = await improntaPdf(bytes);
  const esatto = elenco.find((m) => m.impronta && m.impronta === imp);
  if (esatto) return esatto;
  const candidati = elenco.filter((m) => m.tipo === 'acroform' && m.chiaveCampi);
  if (!candidati.length) return null;
  try {
    const Lib = PDFLib || PDFLibPredefinita;
    const doc = pdfDoc || await Lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const chiave = await chiaveCampi(campiDaPdf(Lib, doc), doc.getPageCount());
    return (chiave && candidati.find((m) => m.chiaveCampi === chiave)) || null;
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------- valori
/** Valore di una chiave per un record. dati: { chiave: valore, 'colonna:Nome': valore }. → stringa ('' = vuoto) | null (non compilare) */
export function valoreChiave(chiave, dati = {}, oggi = todayIt()) {
  if (!chiave) return null;
  if (chiave === 'oggi') return oggi || '';
  if (chiave.startsWith('fisso:')) return chiave.slice(6);
  const v = dati?.[chiave];
  return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v).trim();
}

/** Etichetta leggibile di una chiave. */
export function etichettaChiave(chiave) {
  if (!chiave) return 'Non compilare';
  if (chiave === 'oggi') return 'Data di oggi';
  if (chiave.startsWith('fisso:')) return `Testo fisso: «${chiave.slice(6)}»`;
  if (chiave.startsWith('colonna:')) return `Colonna «${chiave.slice(8)}»`;
  return etichettaCampo(chiave);
}

/** Chiavi offerte nei menu: tutte quelle di campi.js (senza doppioni), più la data di oggi. → [{ value, label }] */
export function chiaviDisponibili() {
  const visti = new Set(); const out = [];
  for (const c of [...CAMPI_MODULO, ...CAMPI_CONTATTO]) {
    if (visti.has(c.key) || c.key === 'note') continue;
    visti.add(c.key); out.push({ value: c.key, label: etichettaCampo(c.key) });
  }
  out.push({ value: 'oggi', label: 'Data di oggi' });
  return out;
}

// ------------------------------------------------------------------------------------------- scrittura
const LINE_H = 1.2;
function canEncodeCon(font) {
  const cache = new Map();
  return (ch) => {
    if (cache.has(ch)) return cache.get(ch);
    let ok; try { font.encodeText(ch); ok = true; } catch { ok = false; }
    cache.set(ch, ok); return ok;
  };
}

/** Scrive un testo in un rettangolo (coordinate PDF) della pagina, diritto anche sulle pagine ruotate. */
export function scriviInZona(PDFLib, page, { rect, size = 11, allinea = 'sinistra' }, valore, font, { colore } = {}) {
  const encode = font.__leggioEncode || (font.__leggioEncode = canEncodeCon(font));
  const righe = winAnsiSafe(String(valore), encode).split(/\r?\n/);
  const pl = placement(rect, page.getRotation().angle || 0);
  const pad = Math.min(2, pl.w / 10);
  const maxW = Math.max(1, pl.w - pad * 2);
  let s = num(size, 11, 4, 72);
  const larghezza = (r, sz) => font.widthOfTextAtSize(r, sz);
  // il testo troppo lungo si rimpicciolisce (fino a 5 pt) invece di uscire dal riquadro
  while (s > 5 && (righe.some((r) => larghezza(r, s) > maxW) || righe.length * s * LINE_H > pl.h + s * 0.4)) s = Math.max(5, s - 0.5);
  const lh = s * LINE_H;
  const alto = pl.h / 2 + (righe.length * lh) / 2; // blocco centrato in verticale
  const color = colore || PDFLib.rgb(0.07, 0.07, 0.07);
  righe.forEach((r, i) => {
    if (!r) return;
    const w = larghezza(r, s);
    const lx = allinea === 'centro' ? (pl.w - w) / 2 : allinea === 'destra' ? pl.w - pad - w : pad;
    const ly = alto - i * lh - lh / 2 - s * 0.35;
    const p = localToPdf(pl, lx, ly);
    page.drawText(r, { x: p.x, y: p.y, size: s, font, color, rotate: PDFLib.degrees(pl.rotate) });
  });
  return s;
}

/** Tipo di immagine dai primi byte. */
export function tipoImmagine(bytes) {
  if (bytes?.[0] === 0x89 && bytes[1] === 0x50) return 'png';
  if (bytes?.[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  return null;
}
/** Indice di pagina effettivo (-1 = ultima). */
export function paginaEffettiva(pagina, n) { const p = Math.trunc(Number(pagina) || 0); return p < 0 ? Math.max(0, n + p) : Math.min(p, n - 1); }

/**
 * Disegna un'immagine (firma o timbro, PNG o JPEG) nella posizione { pagina, rect }; l'immagine è adattata
 * al riquadro mantenendo le proporzioni. immagine: Uint8Array oppure PDFImage già incorporata nel documento.
 */
export async function disegnaImmagine(PDFLib, pdfDoc, immagine, { pagina = -1, rect }) {
  let img = immagine;
  if (immagine instanceof Uint8Array) {
    const t = tipoImmagine(immagine);
    if (t === 'png') img = await pdfDoc.embedPng(immagine);
    else if (t === 'jpg') img = await pdfDoc.embedJpg(immagine);
    else throw new Error('Immagine non supportata (servono PNG o JPEG).');
  }
  const pages = pdfDoc.getPages();
  const page = pages[paginaEffettiva(pagina, pages.length)];
  const pl = placement(rect, page.getRotation().angle || 0);
  const ratio = img.width / Math.max(1, img.height);
  let w = pl.w; let hh = w / ratio;
  if (hh > pl.h) { hh = pl.h; w = hh * ratio; }
  const o = localToPdf(pl, (pl.w - w) / 2, (pl.h - hh) / 2);
  page.drawImage(img, { x: o.x, y: o.y, width: w, height: hh, rotate: PDFLib.degrees(pl.rotate) });
  return img;
}

/**
 * Posizione predefinita per firma/timbro (dimPagina = [larghezza, altezza] visive): 'basso-destra' | 'basso-sinistra' | 'basso-centro' dell'ultima
 * pagina (o di quella indicata). size: [larghezza, altezza] in punti. → { pagina, rect }
 */
export function posizionePredefinita(dimPagina, dove = 'basso-destra', { size = [150, 60], pagina = -1 } = {}) {
  const [W] = dimPagina; const [w, h] = size; const m = 48;
  const x1 = dove === 'basso-sinistra' ? m : dove === 'basso-centro' ? (W - w) / 2 : W - m - w;
  const y1 = 56;
  return { pagina, rect: [x1, y1, x1 + w, y1 + h] };
}

/** Appiattisce i campi (diventano testo della pagina); i campi senza aspetto disegnabile restano compilabili. */
export async function appiattisciModulo(PDFLib, pdfDoc) {
  const form = moduloSicuro(PDFLib, pdfDoc);
  const fields = campiSicuri(form);
  if (!fields.length) return 0;
  for (const f of fields) { try { form.markFieldAsDirty(f.ref); } catch { /* */ } }
  await rigeneraAspetti(PDFLib, pdfDoc, form);
  const bad = [];
  for (const f of fields) {
    try { for (const w of f.acroField.getWidgets()) if (!w.getNormalAppearance()) throw new Error('senza aspetto'); }
    catch { bad.push(f); }
  }
  for (const f of bad) { try { form.acroForm.removeField(f.acroField); } catch { /* */ } }
  form.flatten({ updateFieldAppearances: false });
  for (const f of bad) { try { form.acroForm.addField(f.ref); } catch { /* */ } }
  return fields.length - bad.length;
}

/**
 * Compila un documento pdf-lib con un modello: campi AcroForm (corrispondenze) oppure zone (testo nella
 * pagina) e, se ci sono, immagini di firma/timbro nelle posizioni del modello.
 *   dati: { chiave: valore, 'colonna:Nome colonna': valore } (vedi datiDaContatto / recordDaRiga)
 *   opts: { oggi, font (Helvetica già incorporata, facoltativa), immagini: { firma?, timbro? } (Uint8Array o
 *           PDFImage), appiattisci, aspetti (default true: rigenera gli aspetti dei campi) }
 * → { scritti, vuoti: [nomi dei campi/zone abbinati ma senza dato], mancanti: [campi non trovati], falliti: [] }
 */
export async function compilaConModello(PDFLib, pdfDoc, modello, dati = {}, { oggi = todayIt(), font = null, immagini = null, appiattisci = false, aspetti = true } = {}) {
  const res = { scritti: 0, vuoti: [], mancanti: [], falliti: [] };
  if (!modello) return res;
  if (modello.tipo === 'zone') {
    const zone = modello.zone || [];
    if (zone.length) {
      const f = font || await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      for (const z of zone) {
        const v = valoreChiave(z.chiave, dati, oggi);
        if (v == null) continue;
        if (!v) { res.vuoti.push(etichettaChiave(z.chiave)); continue; }
        const page = pages[z.pagina];
        if (!page) { res.mancanti.push(`zona a pagina ${z.pagina + 1}`); continue; }
        try { scriviInZona(PDFLib, page, z, v, f); res.scritti++; }
        catch { res.falliti.push(etichettaChiave(z.chiave)); }
      }
    }
  } else {
    const corr = corrispondenzeModello(modello);
    const valori = {};
    for (const [campo, chiave] of Object.entries(corr)) {
      const v = valoreChiave(chiave, dati, oggi);
      if (v == null) continue;
      if (!v) { res.vuoti.push(campo); continue; }
      valori[campo] = v;
    }
    if (Object.keys(valori).length) {
      const w = scriviValori(PDFLib, pdfDoc, valori);
      res.scritti = w.set; res.mancanti.push(...w.missing); res.falliti.push(...w.failed);
      if (aspetti && w.set && !appiattisci) { try { await rigeneraAspetti(PDFLib, pdfDoc, moduloSicuro(PDFLib, pdfDoc), { font }); } catch { /* il lettore li ridisegna */ } }
    }
  }
  if (immagini?.firma && modello.firma) await disegnaImmagine(PDFLib, pdfDoc, immagini.firma, modello.firma);
  if (immagini?.timbro && modello.timbro) await disegnaImmagine(PDFLib, pdfDoc, immagini.timbro, modello.timbro);
  if (appiattisci) await appiattisciModulo(PDFLib, pdfDoc);
  return res;
}
