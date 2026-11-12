// Strumento «Rendi ricercabile (OCR)», proposta automatica sulle scansioni e servizio app.services.ocr.
import { openPdfJs } from '../../core/pdf.js';
import { LINGUE_OCR, creaWorkerOcr, creaPoolOcr, riconosciPagine, applicaTestoOcr, fontOcrBytes, misuratoreFont, rilevaScansione } from './ocr.js';
import { messaggioErrore, renderPagina } from './comune.js';

export function haFirmaDigitale(bytes) {
  // ricerca rapida del dizionario di firma (/ByteRange) senza analizzare tutto il file
  const needle = [0x2f, 0x42, 0x79, 0x74, 0x65, 0x52, 0x61, 0x6e, 0x67, 0x65]; // "/ByteRange"
  outer: for (let i = 0; i < bytes.length - needle.length; i++) {
    if (bytes[i] !== 0x2f) continue;
    for (let k = 1; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** Chiede conferma prima di modificare un documento firmato. → true per procedere. */
export async function confermaSeFirmato(app, bytes, azione = 'modificarlo') {
  if (!haFirmaDigitale(bytes)) return true;
  return app.ui.confirm(`Questo documento è firmato digitalmente. Se procedi a ${azione}, la firma non sarà più valida. Ti consigliamo di salvare poi il risultato con «Salva con nome», così l'originale firmato resta intatto.`, { title: 'Documento firmato', okLabel: 'Procedi comunque' });
}

function lingueDefault(app) {
  const v = app.settings.get('ocr.lingue', ['ita', 'eng']);
  return Array.isArray(v) && v.length ? v : ['ita', 'eng'];
}

/**
 * Esegue l'OCR su byte PDF e restituisce i nuovi byte (o gli stessi se non c'era nulla da riconoscere).
 * opts: { langs, pages (0-based), skipText=true, deskew=false, dpi=300, password, pdf, progress:{set,signal} }
 * Il risultato dettagliato è in opts.report dopo la chiamata (se passato un oggetto).
 */
// worker condivisi tra le chiamate (es. azioni guidate file dopo file); chiusi dopo un minuto di inattività
export const poolOcr = creaPoolOcr();

export async function ocrSuBytes(app, bytes, opts = {}) {
  const own = !opts.pdf;
  const pool = opts.pool || poolOcr;
  const pdf = opts.pdf || (await openPdfJs(bytes, { password: opts.password })).pdf;
  try {
    const fontWidth = await misuratoreFont();
    const res = await riconosciPagine({
      pdf, pages: opts.pages, workers: opts.workers, langs: opts.langs || lingueDefault(app), skipText: opts.skipText !== false,
      deskew: !!opts.deskew, dpi: opts.dpi || 300, progress: opts.progress || { set() {}, signal: opts.signal },
      renderPage: (p, i, s) => renderPagina(p, i, s, { pdfjs: app.lib.pdfjs }), fontWidth, pool,
    });
    if (opts.report) Object.assign(opts.report, res);
    // niente da scrivere (pagine bianche o senza testo riconoscibile): il documento resta identico
    if (!res.pagine.some((p) => p.parole.length || p.immagine)) return bytes;
    opts.progress?.set(1, 'Scrivo il testo nel documento…');
    const pdfDoc = await app.lib.openPdfLib(bytes, opts.password);
    let font;
    try { font = await pdfDoc.embedFont(await fontOcrBytes(), { subset: false }); } // il sottoinsieme di fontkit fallisce con questo file
    catch { font = await pdfDoc.embedFont(app.lib.PDFLib.StandardFonts.Helvetica); }
    // con Helvetica (ripiego) le parole con caratteri non codificabili vengono semplificate
    for (const p of res.pagine) {
      p.parole = p.parole.filter((w) => { try { font.encodeText(w.text); return true; } catch { return false; } });
    }
    await applicaTestoOcr(pdfDoc, app.lib.PDFLib, font, res.pagine);
    return await app.lib.savePdfLib(pdfDoc);
  } finally {
    pool.rilascia();
    if (own) await pdf.loadingTask.destroy().catch(() => {});
  }
}

async function avviaOcr(app, { proposta = false } = {}) {
  const doc = app.activeDoc;
  const bytes0 = await app.currentBytes(doc);
  let v;
  if (proposta) v = { langs: lingueDefault(app), pages: '', skip: 'salta', deskew: false, qualita: '300' };
  else {
    const scelte = new Set(lingueDefault(app));
    v = await app.ui.dialog({
      title: 'Rendi ricercabile (riconosci testo)',
      message: 'Leggio riconosce il testo delle pagine scansionate e lo aggiunge in un livello invisibile: l’aspetto delle pagine non cambia, ma potrai cercare, selezionare e copiare il testo. Tutto avviene sul tuo computer, senza internet.',
      fields: [
        { name: 'langs', label: 'Lingue del documento', type: 'custom', render(c) {
          const boxes = LINGUE_OCR.map((l) => {
            const cb = app.ui.h('input', { type: 'checkbox', value: l.value, checked: scelte.has(l.value) });
            c.append(app.ui.h('label', { class: 'conv-check' }, cb, ' ', l.label));
            return cb;
          });
          return { get: () => boxes.filter((b) => b.checked).map((b) => b.value) };
        }, help: 'Scegli solo le lingue presenti: il riconoscimento è più preciso e veloce.' },
        { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
        { name: 'skip', label: 'Pagine che hanno già del testo', type: 'select', value: 'salta', options: [{ value: 'salta', label: 'Saltale (consigliato)' }, { value: 'elabora', label: 'Riconoscile comunque' }] },
        { name: 'qualita', label: 'Precisione', type: 'select', value: '300', options: [{ value: '200', label: 'Veloce' }, { value: '300', label: 'Normale (consigliata)' }, { value: '400', label: 'Massima (testi piccoli, scontrini)' }] },
        { name: 'deskew', label: 'Raddrizza le pagine storte', type: 'checkbox', value: false, help: 'Le pagine storte vengono sostituite dalla loro immagine raddrizzata.' },
      ],
      okLabel: 'Riconosci testo',
      validate: (x) => { if (!x.langs.length) return 'Scegli almeno una lingua.'; try { app.parsePages(x.pages); } catch (e) { return e.message; } },
    });
    if (!v) return;
    app.settings.set('ocr.lingue', v.langs);
  }
  if (!(await confermaSeFirmato(app, bytes0, 'aggiungere il testo riconosciuto'))) return;
  const pages = app.parsePages(v.pages);
  const report = {};
  let out;
  try {
    out = await app.ui.withProgress('Riconoscimento del testo', (p) => ocrSuBytes(app, bytes0, {
      langs: v.langs, pages, skipText: v.skip !== 'elabora', deskew: !!v.deskew, dpi: Number(v.qualita) || 300,
      password: doc.password, pdf: doc.pdf, progress: p, report,
    }));
  } catch (err) {
    return app.reportError(new Error(messaggioErrore(err)), 'Riconoscimento del testo non riuscito');
  }
  if (!out) return; // annullato
  if (out === bytes0 || !report.pagine?.some((p) => p.parole.length || p.immagine)) {
    const s = report.saltate?.length || 0;
    return app.ui.toast(s ? `Nessuna pagina da riconoscere: ${s === 1 ? 'la pagina ha' : `le ${s} pagine hanno`} già del testo.` : 'Nessun testo riconosciuto.', { kind: 'info', timeout: 5000 });
  }
  await app.applyEdit('Testo riconosciuto (OCR)', async () => out, doc);
  const n = report.pagine.length;
  const s = report.saltate.length;
  const parole = report.pagine.reduce((k, x) => k + x.parole.length, 0);
  const incerte = report.pagine.filter((x) => x.parole.length && x.confidenza < 55).map((x) => x.index + 1);
  let msg = `Testo riconosciuto su ${n} ${n === 1 ? 'pagina' : 'pagine'} (${parole} parole) in ${Math.max(1, Math.round(report.ms / 1000))} s.`;
  if (s) msg += ` ${s} ${s === 1 ? 'pagina aveva' : 'pagine avevano'} già testo.`;
  if (incerte.length) msg += ` Riconoscimento incerto a pagina ${incerte.slice(0, 6).join(', ')}${incerte.length > 6 ? '…' : ''}: controlla il risultato.`;
  app.ui.toast(msg, { kind: incerte.length ? 'warning' : 'success', timeout: 7000 });
  app.bus.emit('conversione:ocr-fatto', { doc, report });
}

// ---------- proposta automatica sulle scansioni ----------
function rimuoviBanner(app) { app.el.root.querySelector('.conv-banner')?.remove(); }

function mostraBanner(app, doc) {
  rimuoviBanner(app);
  const { h } = app.ui;
  const bar = h('div', { class: 'conv-banner', role: 'status' },
    h('span', { class: 'conv-banner-ico', html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h8M8 12h8M8 15h5"/></svg>' }),
    h('span', { class: 'conv-banner-txt' }, 'Questo documento è una scansione: il testo non si può cercare né copiare. Vuoi renderlo ricercabile?'),
    h('button', { class: 'btn primary small', onclick: () => { rimuoviBanner(app); if (app.activeDoc === doc) avviaOcr(app, { proposta: true }); } }, 'Rendi ricercabile'),
    h('button', { class: 'btn small', onclick: () => { rimuoviBanner(app); if (app.activeDoc === doc) avviaOcr(app); } }, 'Opzioni…'),
    h('button', { class: 'btn small', onclick: () => { doc.data.ocrBannerChiuso = true; rimuoviBanner(app); } }, 'Non ora'),
    h('button', { class: 'conv-link', onclick: () => { app.settings.set('ocr.proponi', false); rimuoviBanner(app); app.ui.toast('Non te lo chiederò più. Puoi riattivarlo nelle Impostazioni.'); } }, 'Non chiedere più'));
  app.el.main.before(bar);
}

async function controllaScansione(app, doc) {
  if (!doc?.pdf || doc.data.ocrBannerChiuso || app.settings.get('ocr.proponi', true) === false) return;
  try {
    const r = doc.data.scansione ?? (doc.data.scansione = await rilevaScansione(doc.pdf));
    if (r.scansione && app.activeDoc === doc && !doc.data.ocrBannerChiuso) mostraBanner(app, doc);
  } catch { /* documento illeggibile: nessuna proposta */ }
}

export function registraOcr(app) {
  app.services = app.services || {};
  /** app.services.ocr(bytes, opts) → Promise<Uint8Array>: vedi ocrSuBytes. */
  app.services.ocr = (bytes, opts) => ocrSuBytes(app, bytes, opts);
  app.services.rilevaScansione = (pdf, opts) => rilevaScansione(pdf, opts);
  /** Worker Tesseract offline già configurato (ricordarsi di chiamare terminate()). */
  app.services.creaWorkerOcr = (langs) => creaWorkerOcr(langs);

  app.registerTool({
    id: 'ocr', name: 'Rendi ricercabile (OCR)', category: 'converti', icon: 'ocr', quick: true, quickOrder: 40,
    description: 'Riconosce il testo delle scansioni, offline',
    keywords: 'ocr riconosci testo riconoscimento scansione scanner ricercabile selezionabile copiare testo immagine fattura scontrino raddrizza',
    run: () => avviaOcr(app),
  });

  app.bus.on('document:loaded', ({ doc }) => { setTimeout(() => controllaScansione(app, doc), 50); });
  app.bus.on('document:activated', ({ doc }) => { rimuoviBanner(app); if (doc?.data.scansione?.scansione) controllaScansione(app, doc); });
  app.bus.on('document:changed', ({ doc }) => { if (doc) { doc.data.scansione = undefined; rimuoviBanner(app); } });
  app.bus.on('document:closed', () => { if (!app.activeDoc) rimuoviBanner(app); });
  app.bus.on('settings:fields', (arr) => {
    arr.push({ key: 'ocr.proponi', field: { name: 'ocr.proponi', label: 'Proponi di rendere ricercabili le scansioni quando le apro', type: 'checkbox', value: app.settings.get('ocr.proponi', true) } });
    arr.push({ key: 'ocr.lingua', field: { name: 'ocr.lingua', label: 'Lingua principale per il riconoscimento del testo', type: 'select', value: lingueDefault(app)[0], options: LINGUE_OCR } });
  });
  app.bus.on('settings:changed', (e) => {
    const k = e?.key; const val = e?.value;
    if (k === 'ocr.lingua' && val) { const cur = lingueDefault(app).filter((x) => x !== val); app.settings.set('ocr.lingue', [val, ...cur].slice(0, 3)); }
  });
}
