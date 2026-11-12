// «Prepara per Titulus»: controlla e prepara i file prima del caricamento nel protocollo informatico del CNR.
// Nessun collegamento a Titulus (Leggio resta offline): si producono copie pronte e un rapporto.
import { valutaPerTitulus, dichiaraPdfA, nomePulito, SOGLIA_MB_PREDEFINITA } from '../lib/titulus.js';
import { openP7m, looksLikeP7m, overallStatus, innerName } from '../lib/cades.js';
import { analizza, proponiNome } from '../lib/rinomina.js';
import { pageText } from '../lib/textsearch.js';
import { ESITI } from '../lib/report.js';
import { testoSicuro } from '../lib/protocollo.js';
import { aCapo } from '../lib/conformita.js';
import { isSignedPdf } from '../../../core/signature.js';
import { openPdfJs } from '../../../core/pdf.js';
import { chooseFiles, chooseFolder, writeOut, isDesktop, call, dirname, destroyPdf } from '../native.js';
import { elencoFile, bloccaDrop } from './elenco.js';
import { cercaSegnatura } from './protocollo.js';

export const KEY_SOGLIA_TITULUS = 'avanzati.titulus.sogliaMb';
const SUB = 'Per Titulus';

async function testoPrime(bytes, n = 2) {
  let pdf;
  try { ({ pdf } = await openPdfJs(bytes)); let t = ''; for (let i = 1; i <= Math.min(n, pdf.numPages); i++) { const p = await pdf.getPage(i); t += pageText((await p.getTextContent()).items) + '\n'; } return t; }
  catch { return ''; } finally { destroyPdf(pdf); }
}

async function analizzaFile(app, it, sogliaMb) {
  const bytes = await it.read();
  const info = { nome: it.name, dimensione: bytes.length, sogliaMb, tipo: 'altro', leggibile: true, protetto: false, firmato: false, esitoFirma: null, pdfa: 0, firmatari: '' };
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (/\.p7m$/i.test(it.name) || looksLikeP7m(bytes)) {
    info.tipo = 'p7m';
    try {
      const r = await openP7m(bytes);
      info.esitoFirma = overallStatus(r);
      info.firmatari = r.levels.flatMap((l) => l.signers.map((s) => s.name)).join(', ');
      info.contenuto = r.kind;
    } catch (e) { info.leggibile = false; info.errore = e.message; }
  } else if (head.includes('%PDF-')) {
    info.tipo = 'pdf';
    info.firmato = isSignedPdf(bytes);
    try {
      const d = await app.lib.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      info.protetto = d.isEncrypted;
      info.pagine = d.getPageCount();
      if (!info.protetto) {
        const meta = d.catalog.lookup(app.lib.PDFLib.PDFName.of('Metadata'));
        if (meta) { try { const raw = app.lib.PDFLib.decodePDFRawStream ? app.lib.PDFLib.decodePDFRawStream(meta).decode() : meta.getContents(); info.pdfa = dichiaraPdfA(new TextDecoder().decode(raw)); } catch { info.pdfa = 0; } }
      }
    } catch { info.leggibile = false; }
  }
  return { bytes, info, valutazione: valutaPerTitulus(info) };
}

export function preparaPerTitulus(app, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'Prepara per Titulus', subtitle: 'Controlla i file prima di caricarli nel protocollo: PDF/A, firme, password, dimensione, nome. Leggio non si collega a Titulus: prepara copie e un rapporto.', id: 'titulus' });
  bloccaDrop(pane.el);
  const state = { folder: null };
  const elenco = elencoFile(app, { accetta: (n) => /\.(pdf|p7m)$/i.test(n), titoli: false });
  const soglia = Number(app.settings.get(KEY_SOGLIA_TITULUS, SOGLIA_MB_PREDEFINITA)) || SOGLIA_MB_PREDEFINITA;
  const optPdfa = h('input', { type: 'checkbox', id: 'av-t-a', checked: !!app.services?.pdfa, disabled: !app.services?.pdfa });
  const optRid = h('input', { type: 'checkbox', id: 'av-t-r', checked: !!app.services?.compress, disabled: !app.services?.compress });
  const optNome = h('input', { type: 'checkbox', id: 'av-t-n', checked: true });
  const report = h('div', { class: 'av-report' });
  pane.actions.append(h('button', { class: 'btn primary', onclick: () => avvia() }, 'Controlla e prepara'));
  pane.body.append(h('div', { class: 'av-batch' },
    h('section', { class: 'av-box', style: { gridColumn: 'span 2' } }, h('h3', {}, h('span', { class: 'av-step-n' }, '1'), 'File da caricare in Titulus'),
      h('div', { class: 'av-row' },
        h('button', { class: 'btn', onclick: async () => { try { elenco.add(await chooseFiles(app, { exts: ['pdf', 'p7m'], title: 'File da preparare', filterName: 'PDF e file firmati' })); } catch (e) { app.reportError(e, 'File non aggiunti'); } } }, 'Aggiungi file…'),
        h('button', { class: 'btn', onclick: async () => { try { const r = await chooseFolder(app, { exts: ['pdf', 'p7m'], recursive: false, skipDirs: [SUB], title: 'Cartella dei file' }); if (r) { state.folder = r.folder; elenco.add(r.items); } } catch (e) { app.reportError(e, 'Cartella non leggibile'); } } }, 'Aggiungi una cartella…'),
        app.docs.length ? h('button', { class: 'btn', onclick: () => elenco.add(app.docs.map((d) => ({ name: d.name, rel: d.name, path: d.path, size: d.bytes.length, read: () => app.currentBytes(d) }))) }, 'Aggiungi i documenti aperti') : null),
      elenco.el),
    h('section', { class: 'av-box' }, h('h3', {}, h('span', { class: 'av-step-n' }, '2'), 'Cosa preparare'),
      h('label', { class: 'chk', for: 'av-t-a' }, optPdfa, app.services?.pdfa ? 'Converti in PDF/A i file che non lo sono' : 'Conversione PDF/A non disponibile'),
      h('label', { class: 'chk', for: 'av-t-r' }, optRid, app.services?.compress ? `Riduci i file sopra ${soglia} MB` : 'Riduzione non disponibile'),
      h('label', { class: 'chk', for: 'av-t-n' }, optNome, 'Proponi un nome chiaro ai file con nomi poco chiari'),
      h('p', { class: 'av-note' }, `I file firmati vengono copiati senza modifiche (cambierebbe la firma). Le copie vanno nella sottocartella «${SUB}»; gli originali restano come sono. La soglia si cambia nelle Impostazioni.`))),
  report);

  async function avvia() {
    if (!elenco.items.length) return app.ui.toast('Aggiungi prima i file.', { kind: 'warning' });
    let dest = state.folder;
    if (isDesktop() && !dest) {
      const primo = elenco.items.find((x) => x.path);
      if (primo) { dest = dirname(primo.path); try { await call(app, 'stat', { path: dest }); } catch { dest = null; } }
      if (!dest) { try { dest = await call(app, 'choose-folder', { title: `Dove salvare le copie per Titulus` }); } catch { dest = null; } if (!dest) return; }
    }
    const righe = [];
    const ok = await app.ui.withProgress('Prepara per Titulus', async (p) => {
      for (const [i, it] of elenco.items.entries()) {
        if (p.cancelled) throw new DOMException('Annullato', 'AbortError');
        p.set(i / elenco.items.length, `${it.name} (${i + 1} di ${elenco.items.length})`);
        const r = { nome: it.name, azioni: [], esito: 'pronto' };
        try {
          const { bytes, info, valutazione } = await analizzaFile(app, it, soglia);
          Object.assign(r, { info, problemi: valutazione.problemi, avvisi: [...valutazione.avvisi] });
          if (valutazione.problemi.length) { r.esito = 'da sistemare'; righe.push(r); continue; }
          let out = bytes; const firmato = info.tipo === 'p7m' || info.firmato;
          if (!firmato && valutazione.azioni.pdfa && optPdfa.checked && app.services?.pdfa) {
            p.set(i / elenco.items.length, `${it.name}: conversione in PDF/A…`);
            const res = await app.services.pdfa(out, { part: 2, ocr: true, lang: 'it-IT', progress: { set() {}, signal: p.signal, get cancelled() { return p.cancelled; } } });
            out = res.bytes;
            const ko = (res.verifica || []).filter((x) => !x.ok);
            r.azioni.push(ko.length ? `PDF/A con ${ko.length} controlli non superati` : 'convertito in PDF/A-2 (verificato)');
            r.avvisi = r.avvisi.filter((a) => a !== 'non è PDF/A');
          }
          if (!firmato && out.length > soglia * 1048576 && optRid.checked && app.services?.compress) {
            p.set(i / elenco.items.length, `${it.name}: riduzione…`);
            const res = await app.services.compress(out, { maxBytes: soglia * 1048576, signal: p.signal });
            if (res?.bytes && res.bytes.length < out.length) { r.azioni.push(`ridotto da ${(out.length / 1048576).toFixed(1).replace('.', ',')} a ${(res.bytes.length / 1048576).toFixed(1).replace('.', ',')} MB`); out = res.bytes; }
          }
          let nome = it.name;
          if (valutazione.azioni.rinomina && optNome.checked) {
            const testo = info.tipo === 'pdf' ? await testoPrime(out) : '';
            const seg = testo ? cercaSegnatura(app, testo) : null;
            nome = testo.trim() ? proponiNome(analizza(testo, it.name)) : nomePulito(it.name);
            if (/^Documento(_n\d*)?\.pdf$/i.test(nome)) { nome = nomePulito(it.name); r.avvisi.push('non è stato possibile proporre un nome dal contenuto: rinominalo a mano prima del caricamento'); }
            if (seg) nome = nome.replace(/\.pdf$/, `_prot${seg.numero}.pdf`);
            if (info.tipo === 'p7m' && !/\.p7m$/i.test(nome)) nome = nomePulito(innerName(it.name, 'pdf')) + '.p7m';
            r.azioni.push(`nuovo nome: ${nome}`);
          } else nome = nomePulito(it.name);
          r.dove = await writeOut(app, dest, { sub: SUB, name: nome, bytes: out });
          r.esito = r.avvisi.length && r.avvisi.some((a) => /firma integra ma da controllare/.test(a)) ? 'pronto, da controllare' : 'pronto';
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          r.esito = 'non riuscito'; r.problemi = [e?.message || String(e)];
        }
        righe.push(r);
      }
      // rapporto PDF e CSV accanto alle copie
      const pdf = await rapportoTitulus(app.lib.PDFLib, righe);
      const csv = '﻿' + ['Esito;File;Problemi;Avvisi;Operazioni;Copia', ...righe.map((x) => [x.esito, x.nome, (x.problemi || []).join(' | '), (x.avvisi || []).join(' | '), x.azioni.join(' | '), x.dove || ''].map((c) => /[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(';'))].join('\r\n');
      const giorno = new Date().toISOString().slice(0, 10);
      await writeOut(app, dest, { sub: SUB, name: `Rapporto_Prepara_Titulus_${giorno}.pdf`, bytes: pdf });
      await writeOut(app, dest, { sub: SUB, name: `Rapporto_Prepara_Titulus_${giorno}.csv`, bytes: new TextEncoder().encode(csv) });
      return true;
    });
    if (!ok) return;
    mostra(righe, dest);
  }

  function mostra(righe, dest) {
    report.innerHTML = '';
    const pronti = righe.filter((r) => r.esito.startsWith('pronto')).length;
    report.append(h('section', { class: 'av-box' }, h('h3', {}, 'Rapporto'),
      h('p', { class: 'av-big-ok' }, `${pronti} file pronti per Titulus${righe.length - pronti ? `, ${righe.length - pronti} da sistemare` : ''}.`),
      dest && isDesktop() ? h('div', { class: 'av-row' }, h('button', { class: 'btn', onclick: () => app.platform.showInFolder(righe.find((r) => r.dove)?.dove || dest) }, 'Mostra la cartella «Per Titulus»')) : null,
      h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Esito'), h('th', {}, 'Dettagli')),
        righe.map((r) => h('tr', {}, h('td', {}, r.nome),
          h('td', { class: r.esito === 'pronto' ? 'av-ok' : r.esito.startsWith('pronto') ? 'av-skip' : 'av-ko' }, r.esito),
          h('td', {}, [...(r.problemi || []), ...(r.avvisi || []), ...r.azioni, r.info?.firmatari ? `firmato da ${r.info.firmatari} (${ESITI[r.info.esitoFirma]?.titolo || 'non verificato'})` : ''].filter(Boolean).join(' — ')))))));
  }
}

async function rapportoTitulus(PDFLib, righe) {
  const d = await PDFLib.PDFDocument.create();
  const reg = await d.embedFont(PDFLib.StandardFonts.Helvetica); const bold = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  d.setTitle('Rapporto Prepara per Titulus'); d.setLanguage('it-IT'); d.setCreator('Leggio');
  let page = d.addPage([595.28, 841.89]); let y = 790; const M = 50; const W = 495;
  const ink = PDFLib.rgb(0.1, 0.11, 0.13); const muted = PDFLib.rgb(0.4, 0.43, 0.47); const ko = PDFLib.rgb(0.7, 0.14, 0.09); const ok = PDFLib.rgb(0.02, 0.46, 0.28);
  const line = (t, { f = reg, s = 10, c = ink, x = M, gap = 3 } = {}) => { for (const r of aCapo(f, s, t, W - (x - M))) { if (y < 50) { page = d.addPage([595.28, 841.89]); y = 790; } y -= s; page.drawText(r, { x, y, size: s, font: f, color: c }); y -= gap; } };
  line('Prepara per Titulus — rapporto', { f: bold, s: 16, gap: 6 });
  line(`Generato da Leggio il ${new Date().toLocaleString('it-IT')}. Il protocollo ufficiale resta in Titulus: questo rapporto descrive solo i controlli sui file prima del caricamento.`, { s: 9, c: muted, gap: 12 });
  for (const r of righe) {
    line(`${r.esito.toUpperCase()} — ${r.nome}`, { f: bold, s: 10.5, c: r.esito.startsWith('pronto') ? ok : ko });
    for (const t of [...(r.problemi || []), ...(r.avvisi || []), ...r.azioni]) line('• ' + t, { s: 9, x: M + 12 });
    if (r.dove) line(`Copia: ${r.dove}`, { s: 8, x: M + 12, c: muted });
    y -= 6;
  }
  void testoSicuro;
  return d.save();
}
