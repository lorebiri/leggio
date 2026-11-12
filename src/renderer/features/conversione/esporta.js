// Esportazioni: Word (.docx), OpenDocument (.odt), Excel (.xlsx) e CSV, PowerPoint, immagini, testo, HTML.
import { openPdfJs } from '../../core/pdf.js';
import { blocchiInTesto, tabellaDaFrammenti } from './lib/testo.js';
import { csv, xlsx, pptx, odt, html } from './lib/formati.js';
import { creaDocx } from './lib/docx.js';
import { stimaTempo } from './lib/ocr-layout.js';
import { nomeBase, abortIf, testoPagina, corpoDocumento, renderPagina, canvasBytes, liberaCanvas, messaggioErrore } from './comune.js';
import { ricostruisciPagina } from './lib/testo.js';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Estrae la struttura di tutte le pagine richieste, una per volta (memoria costante). */
export async function estraiStruttura(pdf, pages, { progress, from = 0, to = 1, label = 'Analizzo' } = {}) {
  const signal = progress?.signal;
  const bodySize = await corpoDocumento(pdf, pages, signal);
  const out = [];
  const t0 = performance.now();
  for (let k = 0; k < pages.length; k++) {
    abortIf(signal);
    const i = pages[k];
    let t;
    try { t = await testoPagina(pdf, i); } catch (err) { t = { frags: [], width: 595, height: 842, chars: 0, errore: messaggioErrore(err) }; }
    const blocks = ricostruisciPagina(t.frags, { width: t.width, height: t.height, bodySize });
    out.push({ index: i, blocks, width: t.width, height: t.height, chars: t.chars, frags: t.frags, errore: t.errore });
    const eta = stimaTempo(performance.now() - t0, k + 1, pages.length);
    progress?.set(from + (to - from) * ((k + 1) / pages.length), `${label}: pagina ${k + 1} di ${pages.length}${eta ? ' · ' + eta : ''}`);
    if (k % 8 === 7) await new Promise((r) => setTimeout(r)); // lascia respirare l'interfaccia
  }
  return out;
}

/** Immagine JPEG/PNG di una pagina. → { data, type, wPx, hPx } */
export async function immaginePagina(app, pdf, index, dpi = 150, type = 'jpeg', quality = 0.88) {
  let c = await renderPagina(pdf, index, dpi / 72, { pdfjs: app.lib.pdfjs });
  try {
    const data = await canvasBytes(c, type === 'png' ? 'image/png' : 'image/jpeg', quality);
    return { data, type: type === 'png' ? 'png' : 'jpeg', wPx: c.width, hPx: c.height };
  } finally { liberaCanvas(c); c = null; }
}

// ---------------- servizi riutilizzabili ----------------
/**
 * Converte byte PDF in un formato. formato: docx|odt|xlsx|csv|txt|html|pptx.
 * opts: { pages, password, progress, title, immaginiPagina: 'mai'|'senza-testo'|'tutte', dpi, csvSep, fogli: 'pagina'|'unico' }
 * → Uint8Array
 */
export async function convertiBytes(app, bytes, formato, opts = {}) {
  const { pdf } = opts.pdf ? { pdf: opts.pdf } : await openPdfJs(bytes, { password: opts.password });
  try { return await convertiPdf(app, pdf, formato, opts); }
  finally { if (!opts.pdf) await pdf.loadingTask.destroy().catch(() => {}); }
}

export async function convertiPdf(app, pdf, formato, opts = {}) {
  const pages = opts.pages || [...Array(pdf.numPages).keys()];
  const progress = opts.progress || { set() {}, signal: opts.signal };
  const title = opts.title || 'Documento';
  const enc = new TextEncoder();
  if (formato === 'pptx') {
    const slides = [];
    for (let k = 0; k < pages.length; k++) {
      abortIf(progress.signal);
      const page = await pdf.getPage(pages[k] + 1);
      const vp = page.getViewport({ scale: 1 }); page.cleanup();
      const img = await immaginePagina(app, pdf, pages[k], opts.dpi || 150, 'jpeg', 0.9);
      slides.push({ data: img.data, type: 'jpeg', wPt: vp.width, hPt: vp.height });
      progress.set((k + 1) / pages.length, `Diapositiva ${k + 1} di ${pages.length}`);
    }
    return pptx(slides, { title });
  }
  const conImmagini = opts.immaginiPagina || 'senza-testo';
  const strutt = await estraiStruttura(pdf, pages, { progress, to: conImmagini === 'mai' ? 1 : 0.7 });
  if (['docx', 'odt', 'html'].includes(formato) && conImmagini !== 'mai') {
    const target = strutt.filter((s) => conImmagini === 'tutte' || s.chars < 20);
    for (let k = 0; k < target.length; k++) {
      abortIf(progress.signal);
      const s = target[k];
      const img = await immaginePagina(app, pdf, s.index, opts.dpi || 150);
      s.image = formato === 'html' ? { ...img, dataUrl: await toDataUrl(img) } : img;
      progress.set(0.7 + 0.3 * (k + 1) / target.length, `Immagini delle pagine: ${k + 1} di ${target.length}`);
    }
  }
  progress.set(1, 'Scrivo il file…');
  switch (formato) {
    case 'docx': return creaDocx(strutt, { title });
    case 'odt': return odt(strutt, { title });
    case 'txt': return enc.encode('﻿' + strutt.map((s, k) => (pages.length > 1 ? `--- Pagina ${s.index + 1} ---\n\n` : '') + blocchiInTesto(s.blocks)).join('\n\n\f') + '\n');
    case 'html': return enc.encode(html(strutt.map((s) => ({ blocks: s.blocks, image: s.image?.dataUrl })), { title }));
    case 'xlsx': case 'csv': {
      const fogli = strutt.map((s) => {
        const tabs = s.blocks.filter((b) => b.type === 'table');
        const rows = tabs.length && !opts.tuttoIlTesto ? tabs.flatMap((t, i) => (i ? [[], ...t.rows] : t.rows)) : tabellaDaFrammenti(s.frags);
        return { name: `Pagina ${s.index + 1}`, rows };
      }).filter((f) => f.rows.length);
      if (formato === 'csv') return enc.encode(csv(fogli.flatMap((f, i) => (i ? [[], ...f.rows] : f.rows)), { sep: opts.csvSep || ';' }));
      if (opts.fogli === 'unico') return xlsx([{ name: title, rows: fogli.flatMap((f, i) => (i ? [[], ...f.rows] : f.rows)) }]);
      return xlsx(fogli.length ? fogli : [{ name: 'Foglio1', rows: [] }]);
    }
    default: throw new Error('Formato non supportato: ' + formato);
  }
}

async function toDataUrl(img) {
  const blob = new Blob([img.data], { type: img.type === 'png' ? 'image/png' : 'image/jpeg' });
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

// ---------------- interfaccia ----------------
const FORMATI = {
  docx: { label: 'Word (.docx)', ext: 'docx', filtro: 'Documento Word', descr: 'Testo modificabile con titoli, elenchi e tabelle' },
  odt: { label: 'OpenDocument (.odt) — LibreOffice', ext: 'odt', filtro: 'Documento OpenDocument', descr: 'Come Word, per LibreOffice e OpenOffice' },
  xlsx: { label: 'Excel (.xlsx)', ext: 'xlsx', filtro: 'Cartella Excel', descr: 'Tabelle in colonne, numeri riconosciuti' },
  csv: { label: 'CSV (.csv)', ext: 'csv', filtro: 'File CSV', descr: 'Tabelle come testo separato da punto e virgola' },
  pptx: { label: 'PowerPoint (.pptx)', ext: 'pptx', filtro: 'Presentazione PowerPoint', descr: 'Una diapositiva per pagina' },
  img: { label: 'Immagini (JPG o PNG)', ext: 'jpg', filtro: 'Immagine', descr: 'Un file immagine per pagina' },
  txt: { label: 'Testo semplice (.txt)', ext: 'txt', filtro: 'Testo', descr: 'Solo il testo, da copiare nel gestionale' },
  html: { label: 'Pagina web (.html)', ext: 'html', filtro: 'Pagina web', descr: 'Testo strutturato leggibile nel browser' },
};

async function chiediOcrPrima(app, pdf, pages) {
  // controlla al massimo 10 pagine: se nessuna ha testo, propone l'OCR
  const sample = pages.slice(0, 10);
  let senza = 0;
  for (const i of sample) {
    const { chars } = await testoPagina(pdf, i, { withFonts: false });
    if (chars < 20) senza++;
  }
  if (!senza) return 'no';
  const tutte = senza === sample.length;
  const v = await app.ui.dialog({
    title: tutte ? 'Il documento è una scansione' : 'Alcune pagine sono scansioni',
    message: tutte ? 'Le pagine non contengono testo: sono immagini. Per ottenere testo modificabile Leggio può prima riconoscerlo (OCR). Il documento aperto non viene modificato.' : `${senza} delle prime ${sample.length} pagine non contengono testo. Vuoi riconoscerlo prima di esportare? Il documento aperto non viene modificato.`,
    fields: [{ name: 'a', type: 'radio', value: 'ocr', options: [{ value: 'ocr', label: 'Sì, riconosci il testo (consigliato)' }, { value: 'no', label: 'No, esporta le pagine come immagini' }] }],
    okLabel: 'Continua',
  });
  return v ? v.a : null;
}

export async function esporta(app, formato, preset = {}) {
  const doc = app.activeDoc;
  const f = FORMATI[formato];
  if (formato === 'img') return esportaImmagini(app);
  const fields = [{ name: 'pages', label: 'Pagine', type: 'pages', value: '' }];
  if (['docx', 'odt', 'html'].includes(formato)) fields.push({ name: 'img', label: 'Immagini delle pagine', type: 'select', value: 'senza-testo', options: [{ value: 'senza-testo', label: 'Solo per le pagine senza testo (consigliato)' }, { value: 'tutte', label: 'Aggiungi l’immagine di ogni pagina dopo il testo' }, { value: 'mai', label: 'Nessuna immagine' }] });
  if (formato === 'xlsx') fields.push({ name: 'fogli', label: 'Fogli', type: 'select', value: 'pagina', options: [{ value: 'pagina', label: 'Un foglio per ogni pagina' }, { value: 'unico', label: 'Tutto in un unico foglio' }] });
  if (formato === 'xlsx' || formato === 'csv') fields.push({ name: 'tutto', label: 'Esporta tutto il testo, non solo le tabelle riconosciute', type: 'checkbox', value: false, help: 'I numeri scritti all’italiana (1.234,56) diventano numeri veri in Excel.' });
  if (formato === 'csv') fields.push({ name: 'sep', label: 'Separatore', type: 'select', value: ';', options: [{ value: ';', label: 'Punto e virgola (Excel in italiano)' }, { value: ',', label: 'Virgola' }, { value: '\t', label: 'Tabulazione' }] });
  const v = preset.direct ? { pages: '' } : await app.ui.dialog({ title: `Esporta in ${f.label}`, message: f.descr + '.', fields, okLabel: 'Esporta…', validate: (x) => { try { app.parsePages(x.pages); } catch (e) { return e.message; } } });
  if (!v) return;
  const pages = app.parsePages(v.pages);
  let pdf = doc.pdf; let tmp = null;
  try {
    if (formato !== 'pptx') {
      const scelta = await chiediOcrPrima(app, pdf, pages);
      if (scelta === null) return;
      if (scelta === 'ocr') {
        const cur = await app.currentBytes(doc);
        const bytes = await app.ui.withProgress('Riconoscimento del testo', (p) => app.services.ocr(cur, { pages, pdf, password: doc.password, progress: p }));
        if (!bytes) return;
        tmp = (await openPdfJs(bytes)).pdf; pdf = tmp;
      }
    }
    const t0 = performance.now();
    const out = await app.ui.withProgress(`Esportazione in ${f.label}`, (p) => convertiPdf(app, pdf, formato, {
      pages, progress: p, title: nomeBase(doc.name), immaginiPagina: v.img, fogli: v.fogli, tuttoIlTesto: v.tutto, csvSep: v.sep,
    }));
    if (!out) return;
    const nome = `${nomeBase(doc.name)}.${f.ext}`;
    const r = await app.exportFile(out, nome, [{ name: f.filtro, extensions: [f.ext] }]);
    if (r) app.ui.toast(`Esportato «${r.name || nome}» in ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s`, { kind: 'success' });
  } catch (err) {
    app.reportError(new Error(messaggioErrore(err)), 'Esportazione non riuscita');
  } finally { if (tmp) await tmp.loadingTask.destroy().catch(() => {}); }
}

async function esportaImmagini(app) {
  const doc = app.activeDoc;
  const v = await app.ui.dialog({
    title: 'Esporta come immagini', message: 'Ogni pagina diventa un file immagine nella cartella che scegli.',
    fields: [
      { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
      { name: 'fmt', label: 'Formato', type: 'radio', value: 'jpeg', options: [{ value: 'jpeg', label: 'JPG (file più leggeri, per foto e presentazioni)' }, { value: 'png', label: 'PNG (qualità perfetta, per testi e grafici)' }] },
      { name: 'dpi', label: 'Qualità', type: 'select', value: '150', options: [{ value: '96', label: 'Per lo schermo (96 dpi)' }, { value: '150', label: 'Buona (150 dpi)' }, { value: '300', label: 'Per la stampa (300 dpi)' }, { value: '600', label: 'Massima (600 dpi, file grandi)' }] },
    ],
    okLabel: 'Scegli la cartella…',
    validate: (x) => { try { app.parsePages(x.pages); } catch (e) { return e.message; } },
  });
  if (!v) return;
  const pages = app.parsePages(v.pages);
  const folder = await app.platform.chooseFolder('Cartella in cui salvare le immagini');
  if (!folder) return;
  const ext = v.fmt === 'png' ? 'png' : 'jpg';
  const pad = String(doc.pageCount).length;
  try {
    const n = await app.ui.withProgress('Esportazione delle immagini', async (p) => {
      const t0 = performance.now();
      for (let k = 0; k < pages.length; k++) {
        abortIf(p.signal);
        const img = await immaginePagina(app, doc.pdf, pages[k], Number(v.dpi), v.fmt);
        await app.platform.writeInFolder(folder, `${nomeBase(doc.name)}_pagina_${String(pages[k] + 1).padStart(pad, '0')}.${ext}`, img.data);
        const eta = stimaTempo(performance.now() - t0, k + 1, pages.length);
        p.set((k + 1) / pages.length, `Pagina ${k + 1} di ${pages.length}${eta ? ' · ' + eta : ''}`);
      }
      return pages.length;
    });
    if (n) app.ui.toast(`${n} ${n === 1 ? 'immagine salvata' : 'immagini salvate'}`, { kind: 'success', action: folder !== '__download__' ? { label: 'Apri cartella', run: () => app.platform.showInFolder(folder) } : undefined });
  } catch (err) { app.reportError(new Error(messaggioErrore(err)), 'Esportazione non riuscita'); }
}

async function esportaPdf(app) {
  const v = await app.ui.dialog({
    title: 'Esporta PDF', message: 'In quale formato vuoi convertire il documento?',
    fields: [{ name: 'f', type: 'radio', value: app.settings.get('conv.ultimoFormato', 'docx'), options: Object.entries(FORMATI).map(([k, x]) => ({ value: k, label: `${x.label} — ${x.descr}` })) }],
    okLabel: 'Avanti',
  });
  if (!v) return;
  app.settings.set('conv.ultimoFormato', v.f);
  return esporta(app, v.f);
}

export function registraEsporta(app) {
  app.services.converti = (bytes, formato, opts) => convertiBytes(app, bytes, formato, opts);
  app.services.creaDocx = creaDocx;
  const T = (id, name, formato, description, keywords, extra = {}) => app.registerTool({ id, name, category: 'converti', icon: 'export', description, keywords, run: () => esporta(app, formato), ...extra });
  app.registerTool({ id: 'export-pdf', name: 'Esporta PDF', category: 'converti', icon: 'export', description: 'Converti in Word, Excel, PowerPoint, immagini, testo…', keywords: 'esporta pdf converti salva come formato word excel powerpoint immagini', run: () => esportaPdf(app) });
  T('convert-word', 'Esporta in Word', 'docx', 'PDF in documento Word modificabile', 'converti pdf in word docx documento modificabile esporta pdf microsoft word', { icon: 'convert', quick: true, quickOrder: 45 });
  T('export-odt', 'Esporta in OpenDocument (LibreOffice)', 'odt', 'PDF in documento .odt', 'odt libreoffice openoffice writer opendocument esporta pdf');
  T('export-excel', 'Esporta in Excel', 'xlsx', 'Tabelle in un foglio di calcolo', 'excel xlsx foglio di calcolo tabelle esporta pdf numeri');
  T('export-csv', 'Esporta tabelle in CSV', 'csv', 'Tabelle in un file CSV', 'csv tabelle esporta pdf separatore');
  T('export-pptx', 'Esporta in PowerPoint', 'pptx', 'Una diapositiva per pagina', 'powerpoint pptx presentazione diapositive esporta pdf');
  T('export-images', 'Esporta come immagini', 'img', 'Pagine in JPG o PNG', 'immagini jpg jpeg png foto esporta pdf pagine');
  T('export-text', 'Esporta come testo', 'txt', 'Solo il testo (.txt)', 'testo txt semplice copia gestionale esporta pdf');
  T('export-html', 'Esporta come pagina web', 'html', 'Testo strutturato in HTML', 'html pagina web sito esporta pdf');
}

export { MIME };
