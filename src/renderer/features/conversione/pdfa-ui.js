// «Prepara per la conservazione (PDF/A)» e «Verifica PDF/A»: conversione in PDF/A-2b/3b con OCR facoltativo,
// font incorporati, profilo colore e verifica finale con esito chiaro.
import { fontkit } from '../../core/pdf.js';
import { convertiPdfA, preflightPdfA, incorporaFontSans } from './lib/pdfa.js';
import { caricaRisorsa } from './lib/risorse.js';
import { haFirmaDigitale } from './ocr-ui.js';
import { nomeBase, messaggioErrore } from './comune.js';

let fontsPromise = null;
function fontLiberation() {
  return (fontsPromise ||= (async () => {
    const f = (n) => caricaRisorsa(`./pdfjs/standard_fonts/LiberationSans-${n}.ttf`);
    const [regular, bold, italic, boldItalic] = await Promise.all([f('Regular'), f('Bold'), f('Italic'), f('BoldItalic')]);
    return { regular, bold, italic, boldItalic };
  })().catch((e) => { fontsPromise = null; throw e; }));
}

const decoder = (PDFLib) => (s) => PDFLib.decodePDFRawStream(s).decode();

/** Verifica PDF/A di byte PDF. → [{ id, ok, titolo, dettaglio, correggibile }] */
export async function verificaPdfA(app, bytes, password) {
  const doc = await app.lib.openPdfLib(bytes, password);
  return preflightPdfA(doc, app.lib.PDFLib, { decode: decoder(app.lib.PDFLib) });
}

/**
 * Converte byte PDF in PDF/A. opts: { part: 2|3, ocr: bool, langs, title, lang, password, progress }
 * → { bytes, azioni, avvisi, verifica, fontCorretti }
 */
export async function pdfaSuBytes(app, bytes, opts = {}) {
  const { PDFLib } = app.lib;
  const progress = opts.progress || { set() {} };
  let src = bytes;
  if (opts.ocr) {
    progress.set(0.02, 'Riconoscimento del testo delle scansioni…');
    src = await app.services.ocr(src, { password: opts.password, langs: opts.langs, progress: { set: (f, m) => progress.set(0.02 + f * 0.7, m), signal: progress.signal } });
  }
  progress.set(0.75, 'Converto in PDF/A…');
  let doc;
  try { doc = await app.lib.openPdfLib(src, opts.password); }
  catch (err) { throw new Error(/password|encrypt/i.test(String(err?.message)) ? 'Il documento è protetto: serve la password per convertirlo.' : 'Il file PDF sembra danneggiato: non riesco a convertirlo. Prova prima a ripararlo.'); }
  if (!doc.getPageCount()) throw new Error('Il file PDF sembra danneggiato: non contiene pagine leggibili.');
  let fontCorretti = 0;
  try { fontCorretti = incorporaFontSans(doc, PDFLib, await fontLiberation(), fontkit); }
  catch (e) { console.warn('[pdfa] font non incorporati', e); }
  const { azioni, avvisi } = convertiPdfA(doc, PDFLib, { part: opts.part, title: opts.title, lang: opts.lang });
  if (fontCorretti) azioni.push(`${fontCorretti} font incorporati (Liberation Sans al posto di Helvetica/Arial, stesse misure)`);
  const out = await app.lib.savePdfLib(doc, { useObjectStreams: true });
  progress.set(0.95, 'Verifico il risultato…');
  const verifica = await verificaPdfA(app, out);
  return { bytes: out, azioni, avvisi, verifica, fontCorretti };
}

function mostraRapporto(app, { titolo, verifica, azioni = [], avvisi = [], azioniExtra }) {
  const { h } = app.ui;
  const c = app.openRightPanel(titolo);
  const ko = verifica.filter((x) => !x.ok);
  const part = verifica.find((x) => x.id === 'identificazione');
  c.append(h('div', { class: 'conv-report' },
    h('p', { class: 'conv-esito ' + (ko.length ? 'ko' : 'ok'), role: 'status' }, ko.length
      ? `${ko.length} ${ko.length === 1 ? 'punto da sistemare' : 'punti da sistemare'}`
      : `Conforme: ${part?.titolo?.replace('Dichiarato ', '') || 'PDF/A'} (verifica di base)`),
    h('ul', { class: 'conv-checks' }, verifica.map((x) => h('li', { class: x.ok ? 'ok' : 'ko' }, h('span', { class: 'conv-ico', 'aria-hidden': 'true' }, x.ok ? '✓' : '✗'), h('div', {}, h('strong', {}, x.titolo), x.dettaglio ? h('small', {}, x.dettaglio) : null)))),
    azioni.length ? h('details', { open: true }, h('summary', {}, 'Cosa ha fatto Leggio'), h('ul', { class: 'conv-azioni' }, azioni.map((a) => h('li', {}, a)))) : null,
    avvisi.length ? h('div', { class: 'conv-avvisi' }, avvisi.map((a) => h('p', {}, '⚠ ' + a))) : null,
    h('p', { class: 'muted conv-nota' }, 'La verifica di Leggio controlla i requisiti principali (metadati, font, colori, script, annotazioni, cifratura). Per la conservazione a norma il conservatore usa un validatore completo (es. veraPDF).'),
    azioniExtra || null));
  return c;
}

async function preparaPdfA(app) {
  const doc = app.activeDoc;
  const bytes = await app.currentBytes(doc);
  let scansione = false;
  try { scansione = (await app.services.rilevaScansione(doc.pdf, { max: 5 })).pagineSenzaTesto > 0; } catch { /* ignora */ }
  const firmato = haFirmaDigitale(bytes);
  const titolo0 = (await app.lib.openPdfLib(bytes, doc.password).then((d) => d.getTitle()).catch(() => '')) || nomeBase(doc.name);
  const v = await app.ui.dialog({
    title: 'Prepara per la conservazione (PDF/A)',
    message: 'Crea una copia in formato PDF/A, adatto alla conservazione a lungo termine e al protocollo. L’originale non viene modificato.',
    fields: [
      ...(firmato ? [{ type: 'info', html: '<strong>Attenzione:</strong> il documento è firmato digitalmente. La copia PDF/A non conterrà una firma valida: conserva anche l’originale firmato.' }] : []),
      { name: 'part', label: 'Variante', type: 'radio', value: String(app.settings.get('pdfa.part', '2')), options: [
        { value: '2', label: 'PDF/A-2b — consigliata per la conservazione' },
        { value: '3', label: 'PDF/A-3b — come la 2b, ma ammette file allegati di ogni tipo' },
      ], help: 'Verifica con il tuo conservatore quale variante accetta (Linee guida AgID sul documento informatico).' },
      { name: 'ocr', label: 'Riconosci il testo delle pagine scansionate (OCR)', type: 'checkbox', value: scansione, help: scansione ? 'Il documento contiene pagine senza testo: consigliato.' : '' },
      { name: 'title', label: 'Titolo del documento', type: 'text', value: titolo0 },
    ],
    okLabel: 'Crea PDF/A…',
  });
  if (!v) return;
  app.settings.set('pdfa.part', v.part);
  let r;
  try {
    r = await app.ui.withProgress('Preparazione per la conservazione', (p) => pdfaSuBytes(app, bytes, { part: Number(v.part), ocr: v.ocr, title: v.title.trim() || undefined, lang: 'it-IT', password: doc.password, progress: p }));
  } catch (err) { return app.reportError(new Error(messaggioErrore(err)), 'Conversione PDF/A non riuscita'); }
  if (!r) return;
  const nome = `${nomeBase(doc.name)}_pdfa.pdf`;
  const salva = async () => {
    const s = await app.exportFile(r.bytes, nome, [{ name: 'Documento PDF/A', extensions: ['pdf'] }]);
    if (s) app.ui.toast(`Salvato «${s.name || nome}»`, { kind: 'success' });
    return s;
  };
  const { h } = app.ui;
  mostraRapporto(app, {
    titolo: 'PDF/A: esito', verifica: r.verifica, azioni: r.azioni, avvisi: r.avvisi,
    azioniExtra: h('div', { class: 'conv-btns' },
      h('button', { class: 'btn primary', onclick: salva }, 'Salva la copia PDF/A…'),
      h('button', { class: 'btn', onclick: () => app.openBytes(r.bytes, { name: nome }) }, 'Apri la copia')),
  });
  await salva();
}

async function verificaUi(app) {
  const doc = app.activeDoc;
  try {
    const verifica = await verificaPdfA(app, await app.currentBytes(doc), doc.password);
    const { h } = app.ui;
    mostraRapporto(app, {
      titolo: 'Verifica PDF/A', verifica,
      azioniExtra: verifica.some((x) => !x.ok) ? h('div', { class: 'conv-btns' }, h('button', { class: 'btn primary', onclick: () => preparaPdfA(app) }, 'Converti in PDF/A…')) : null,
    });
  } catch (err) { app.reportError(new Error(messaggioErrore(err)), 'Verifica non riuscita'); }
}

export function registraPdfA(app) {
  /** app.services.pdfa(bytes, { part, ocr, title, lang, password, progress }) → { bytes, azioni, avvisi, verifica } */
  app.services.pdfa = (bytes, opts) => pdfaSuBytes(app, bytes, opts);
  /** app.services.verificaPdfA(bytes, password) → elenco dei controlli */
  app.services.verificaPdfA = (bytes, password) => verificaPdfA(app, bytes, password);
  app.registerTool({
    id: 'pdfa', name: 'Prepara per la conservazione (PDF/A)', category: 'avanzati', icon: 'file',
    description: 'Copia PDF/A con verifica, per conservazione e protocollo',
    keywords: 'pdf/a pdfa conservazione archiviazione protocollo norma agid salva come pdf/a standard archivio lungo termine preflight',
    run: () => preparaPdfA(app),
  });
  app.registerTool({
    id: 'pdfa-check', name: 'Verifica PDF/A (preflight)', category: 'avanzati', icon: 'check',
    description: 'Controlla se il documento è conforme a PDF/A',
    keywords: 'verifica pdf/a preflight conformità controllo conservazione validazione',
    run: () => verificaUi(app),
  });
}
