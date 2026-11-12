// Funzioni condivise dall'interfaccia dell'area «sicurezza».
import { openDecrypted, PasswordError } from './logica/cifratura.js';
import { countSignatures } from './logica/pdfutil.js';

/** Telefoni ed email del Profilo dell'ente (area avanzati), da non oscurare mai. → predicato hit → bool */
export function esclusioneEnte(app, datiEnte, isDatoEnte) {
  let ente = null;
  try { ente = datiEnte(app.services?.profiloEnte?.() || {}); } catch { /* profilo non disponibile */ }
  if (!ente || (!ente.emails.size && !ente.phones.size)) return null;
  return (hit) => isDatoEnte(hit, ente);
}

export const PDF_FILTER = [{ name: 'Documento PDF', extensions: ['pdf'] }];

/** Stato dell'area per documento (in doc.data). */
export function st(doc) { return (doc.data.sicurezza ||= { marks: [], nextId: 1 }); }

export function baseName(name) { return String(name || 'documento').replace(/\.pdf$/i, ''); }
export function copyName(doc, suffix) { return `${baseName(doc.name)}_${suffix}.pdf`; }

/** Apre i byte del documento con pdf-lib, decifrandoli se serve (anche file con sole restrizioni). */
export async function openForEdit(bytes, doc) {
  try {
    return (await openDecrypted(bytes, doc?.password ?? '')).doc;
  } catch (e) {
    if (e instanceof PasswordError) throw new Error('Il documento è protetto e la password memorizzata non basta per modificarlo. Chiudilo e riaprilo con la password del proprietario.');
    throw e;
  }
}

/** Modifica annullabile con un documento pdf-lib decifrato. fn(pdfDoc) → false per annullare. */
export async function modifica(app, label, fn, { useObjectStreams = true } = {}) {
  return app.applyEdit(label, async (bytes, doc) => {
    const pdfDoc = await openForEdit(bytes, doc);
    const r = await fn(pdfDoc, doc);
    if (r === false) return null;
    return pdfDoc.save({ useObjectStreams });
  });
}

/** Salva byte come copia con nome proposto. → true se salvato */
export async function salvaCopia(app, bytes, name) {
  const r = await app.exportFile(bytes, name, PDF_FILTER);
  if (r) app.ui.toast(`Copia salvata: ${r.name || name}`, { kind: 'success' });
  return !!r;
}

/** Firme digitali presenti? Usa pdf-lib se già aperto, altrimenti una ricerca veloce nei byte. */
export function signatureCount(bytes, pdfDoc) {
  if (pdfDoc) return countSignatures(pdfDoc);
  // ricerca veloce: /ByteRange compare solo nei dizionari di firma
  const needle = [47, 66, 121, 116, 101, 82, 97, 110, 103, 101]; // "/ByteRange"
  let n = 0;
  outer: for (let i = 0; i < bytes.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    n++;
  }
  return n;
}

/** Messaggio standard per i file firmati. */
export function avvisoFirma(n, azione) {
  return `Questo documento è firmato digitalmente${n > 1 ? ` (${n} firme)` : ''}. Se lo ${azione}, la firma non sarà più valida. Per questo Leggio salva il risultato come copia e lascia intatto l'originale firmato.`;
}

/** Riquadro di avviso da mettere nei dialoghi. */
export function boxAvviso(app, text, kind = 'warning') {
  return app.ui.h('div', { class: `lg-sic-avviso lg-sic-${kind}`, role: kind === 'error' ? 'alert' : 'note' }, text);
}

/** Cerca "/Encrypt" nel trailer (fine del file) e all'inizio: veloce, senza analisi completa. */
export function looksEncrypted(bytes) {
  const scan = (a, b) => {
    const needle = [47, 69, 110, 99, 114, 121, 112, 116]; // "/Encrypt"
    outer: for (let i = Math.max(0, a); i < Math.min(bytes.length, b) - needle.length; i++) {
      for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
      return true;
    }
    return false;
  };
  return scan(bytes.length - 65536, bytes.length) || scan(0, 8192);
}

let styled = false;
/** Stili dell'area (iniettati una volta: il foglio di stile del nucleo non si tocca). */
export function injectStyles() {
  if (styled) return; styled = true;
  const css = `
.lg-sic-avviso { border-radius: 8px; padding: 10px 12px; margin: 0 0 12px; font-size: 13px; line-height: 1.45; border: 1px solid; }
.lg-sic-warning { background: #fff4e5; border-color: #f5c27a; color: #6b3a00; }
.lg-sic-error { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }
.lg-sic-ok { background: #e7f6ee; border-color: #8fd1ad; color: #075e33; }
.lg-sic-info { background: var(--surface-2); border-color: var(--border); color: var(--ink); }
:root[data-theme="dark"] .lg-sic-warning { background: #3a2a10; border-color: #8a6420; color: #ffd9a0; }
:root[data-theme="dark"] .lg-sic-ok { background: #12301f; border-color: #2f7a4f; color: #b6efcd; }
.lg-meter { height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; margin: 6px 0 2px; }
.lg-meter > div { height: 100%; width: 0; transition: width .2s, background .2s; }
.lg-meter-label { font-size: 12.5px; color: var(--muted); }
.lg-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; }
.lg-grid2 label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.lg-section-title { font-weight: 600; margin: 14px 0 6px; font-size: 13px; }
.leggio-overlay .lg-red { position: absolute; box-sizing: border-box; border: 2px solid #d92d20; background: rgba(217,45,32,.18); pointer-events: auto; }
.leggio-overlay .lg-red.off { border: 1.5px dashed #8a8f98; background: rgba(138,143,152,.10); }
.leggio-overlay .lg-red.page { background: repeating-linear-gradient(45deg, rgba(217,45,32,.12) 0 8px, rgba(217,45,32,.22) 8px 16px); }
.leggio-overlay .lg-red .lg-x { position: absolute; top: -10px; right: -10px; width: 20px; height: 20px; border-radius: 10px; border: 0; background: #d92d20; color: #fff; font: bold 13px/20px sans-serif; cursor: pointer; display: none; padding: 0; }
.leggio-overlay .lg-red:hover .lg-x { display: block; }
.leggio-overlay .lg-red-draft { position: absolute; border: 2px dashed #d92d20; background: rgba(217,45,32,.12); pointer-events: none; }
.lg-res { list-style: none; margin: 0; padding: 0; }
.lg-res li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 4px; border-bottom: 1px solid var(--border); font-size: 13px; cursor: pointer; }
.lg-res li:hover { background: var(--hover); }
.lg-res li input { margin-top: 3px; }
.lg-res .ctx { color: var(--muted); }
.lg-res .ctx b { color: var(--ink); background: rgba(217,45,32,.15); border-radius: 3px; padding: 0 2px; }
.lg-res .pg { margin-left: auto; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.lg-group { margin: 12px 0 4px; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.lg-group .btn { margin-left: auto; }
.lg-models { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 6px 0 10px; }
.lg-models label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.lg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
.lg-att { list-style: none; margin: 0; padding: 0 8px; }
.lg-att li { padding: 8px 6px; border-bottom: 1px solid var(--border); }
.lg-att .nm { font-weight: 500; word-break: break-all; }
.lg-att .meta { color: var(--muted); font-size: 12.5px; }
.lg-att .acts { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.lg-stats { font-variant-numeric: tabular-nums; }
.lg-stats td { padding: 3px 12px 3px 0; }
.lg-big { font-size: 22px; font-weight: 600; }
`;
  document.head.append(Object.assign(document.createElement('style'), { textContent: css, id: 'lg-sicurezza-css' }));
}
