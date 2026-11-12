// File firmati .p7m: apertura, pannello «Firme del file .p7m», salvataggio del contenuto e del rapporto.
import { openP7m, innerName, overallStatus, MAX_P7M_BYTES } from '../lib/cades.js';
import { compactResult } from '../lib/p7m-compact.js';
import { ESITI, LIMITI, righeFirmatario, rapportoPdf, sha256Hex, fmtData } from '../lib/report.js';
import { isFattura } from '../lib/fattura.js';

export const SIGNED_EXT = ['p7m', 'p7s', 'tsd', 'm7m'];

/** Analizza in un Worker (annullabile); se i Worker non sono disponibili, nel thread principale. */
export async function analyze(app, bytes, name) {
  if (bytes.length > MAX_P7M_BYTES) throw new Error('Il file è troppo grande per essere aperto.');
  return app.ui.withProgress(`Verifica della firma: ${name}`, async (p) => {
    p.set(null, 'Lettura della busta firmata e verifica delle firme…');
    let worker = null;
    try { worker = new Worker(new URL('../lib/p7m.worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }
    if (!worker) return compactResult(await openP7m(bytes));
    try {
      return await new Promise((resolve, reject) => {
        p.signal.addEventListener('abort', () => reject(new DOMException('Annullato', 'AbortError')));
        worker.onmessage = (e) => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)));
        worker.onerror = (e) => { e.preventDefault?.(); reject(new Error('Analisi non riuscita: ' + (e.message || 'errore interno'))); };
        worker.postMessage({ bytes: bytes.slice() });
      });
    } finally { worker.terminate(); }
  });
}

/** Apre un file firmato: il contenuto si apre da solo (PDF in una scheda, fattura impaginata) con le firme accanto. */
export async function openSignedFile(app, { bytes, name, path = null }, deps) {
  let result;
  try { result = await analyze(app, bytes, name); }
  catch (err) {
    if (err?.name === 'AbortError') return;
    return app.ui.dialog({ title: 'File firmato non leggibile', body: app.ui.h('div', { class: 'av-pre' }, `«${name}» non può essere aperto: ${err.message}\n\nSe il file è arrivato per PEC o da un portale, prova a scaricarlo di nuovo.`), cancelLabel: null, okLabel: 'Chiudi' });
  }
  if (!result) return;
  const stato = overallStatus(result);
  const info = { result, stato, sourceName: name, sourcePath: path, sourceSize: bytes.length, sourceBytes: bytes };
  const inner = innerName(name, result.kind);
  if (result.kind === 'pdf') {
    const doc = await app.openBytes(result.content, { name: inner });
    if (!doc) {
      // il PDF contenuto non si apre (danneggiato o alterato): mostriamo comunque l'esito della firma
      showSignaturePane(app, info, deps);
      return;
    }
    doc.data.p7m = info;
    app.sidebar.show('p7m');
    toastEsito(app, stato);
    return doc;
  }
  if (result.kind === 'fattura' || (result.content && isFattura(result.content))) {
    return deps.openFattura(app, result.content, inner, { firma: info });
  }
  // altro contenuto (immagine, zip, xml generico, firma separata)
  showSignaturePane(app, info, deps);
}

function toastEsito(app, stato) {
  const t = ESITI[stato];
  app.ui.toast(`${t.titolo}. Dettagli nel pannello «Firme».`, { kind: stato === 'valid' ? 'success' : stato === 'invalid' ? 'error' : 'warning', timeout: 7000 });
}

/** Elenco firme come elementi DOM (usato dal pannello laterale, dalla fattura e dallo spazio di lavoro). */
export function signatureView(app, info, { compact = false } = {}) {
  const { h } = app.ui;
  const r = info.result;
  const esito = ESITI[info.stato];
  const wrap = h('div', { class: 'av-sig' });
  wrap.append(h('div', { class: `av-sem av-sem-${info.stato}`, role: 'status' },
    h('span', { class: 'av-sem-dot', 'aria-hidden': 'true' }),
    h('div', {}, h('strong', {}, esito.titolo), h('div', { class: 'av-sem-txt' }, esito.spiega))));
  if (r.detached) wrap.append(h('p', { class: 'av-note' }, 'Questo file contiene solo la firma: il documento firmato è un file separato (firma «detached»).'));
  let n = 0;
  r.levels.forEach((lv, li) => {
    if (lv.kind === 'tsd') {
      wrap.append(h('div', { class: 'av-sig-card' }, h('div', { class: 'av-sig-name' }, 'Marca temporale'), ...lv.timestamps.map((t) => h('div', {}, `${fmtData(t.time)}${t.tsa ? ' — ' + t.tsa : ''}`))));
      return;
    }
    const card = (s, contro) => {
      n++;
      const ok = s.integrity === 'valid' && s.certValidAtSigning !== false && s.certificate?.qualified; const bad = s.integrity === 'invalid';
      const rows = righeFirmatario(s).slice(compact ? 1 : 0);
      const el = h('div', { class: 'av-sig-card ' + (bad ? 'bad' : ok ? 'ok' : 'warn') },
        h('div', { class: 'av-sig-name' }, `${contro ? 'Controfirma: ' : ''}${s.name}`, r.levels.length > 1 ? h('span', { class: 'av-sig-level' }, ` busta ${li + 1} di ${r.levels.length}`) : null),
        h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
      wrap.append(el);
      s.counterSigners?.forEach((cs) => card(cs, true));
    };
    lv.signers.forEach((s) => card(s, false));
  });
  wrap.append(h('p', { class: 'av-note' }, LIMITI));
  return wrap;
}

export async function saveContent(app, info) {
  const r = info.result;
  if (!r.content) return app.ui.toast('Il documento firmato non è contenuto in questo file.', { kind: 'warning' });
  const name = innerName(info.sourceName, r.kind);
  const ext = name.split('.').pop();
  await app.exportFile(r.content, name, [{ name: ext.toUpperCase(), extensions: [ext] }]);
}

export async function saveReport(app, info) {
  try {
    const sha = await sha256Hex(info.sourceBytes);
    const bytes = await rapportoPdf(app.lib.PDFLib, info.result, { nomeFile: info.sourceName, dimensione: info.sourceSize, sha256: sha, contenuto: info.result.content ? innerName(info.sourceName, info.result.kind) : null, stato: info.stato });
    const base = info.sourceName.replace(/(\.p7m|\.p7s|\.tsd|\.m7m)+$/i, '').replace(/\.[a-z0-9]{2,4}$/i, '');
    await app.exportFile(bytes, `${base}_verifica_firma.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
  } catch (err) { app.reportError(err, 'Rapporto di verifica non creato'); }
}

/** Spazio di lavoro per file firmati con contenuto non PDF. */
function showSignaturePane(app, info, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'File firmato', subtitle: info.sourceName, id: 'p7m' });
  const kind = info.result.kind;
  const desc = info.result.detached ? 'Firma separata (il documento non è incluso)' : { zip: 'Archivio ZIP', jpg: 'Immagine JPEG', png: 'Immagine PNG', xml: 'File XML', other: 'File di tipo non riconosciuto' }[kind] || kind;
  pane.actions.append(
    info.result.content ? h('button', { class: 'btn primary', onclick: () => saveContent(app, info) }, 'Salva il documento contenuto…') : null,
    h('button', { class: 'btn', onclick: () => saveReport(app, info) }, 'Salva rapporto di verifica (PDF)…'));
  pane.body.append(h('div', { class: 'av-narrow' }, h('p', {}, `Contenuto: ${desc}.`), signatureView(app, info)));
}

/** Pannello laterale per i PDF estratti da un .p7m. */
export function registerP7mPanel(app, deps) {
  app.registerPanel({
    id: 'p7m', title: 'Firme (.p7m)', icon: 'signature', order: 62,
    render(c) {
      const { h } = app.ui;
      const info = app.activeDoc?.data?.p7m;
      if (!info) {
        c.append(h('div', { class: 'pad av-side' },
          h('p', {}, 'Questo documento non è stato aperto da un file firmato .p7m.'),
          h('button', { class: 'btn', onclick: () => deps.chooseSigned(app) }, 'Apri file firmato (.p7m)…')));
        return;
      }
      c.append(h('div', { class: 'pad av-side' },
        h('div', { class: 'av-btn-col' },
          h('button', { class: 'btn primary', onclick: () => saveContent(app, info) }, 'Salva il PDF contenuto…'),
          h('button', { class: 'btn', onclick: () => saveReport(app, info) }, 'Salva rapporto di verifica (PDF)…')),
        h('p', { class: 'av-note' }, `File firmato: ${info.sourceName}`),
        signatureView(app, info, { compact: false })));
    },
  });
}
