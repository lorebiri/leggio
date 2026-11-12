// Strumento «Copia come tabella»: si trascina un riquadro sulla pagina, le colonne vengono riconosciute
// e la tabella va negli appunti (incollabile in Excel con colonne e numeri giusti) o in un file .xlsx.
import { tabellaDaFrammenti } from './lib/testo.js';
import { tsv, xlsx, escXml } from './lib/formati.js';
import { testoPagina, nomeBase } from './comune.js';

let stato = null;

async function copiaTabella(app, rows) {
  const text = tsv(rows);
  const htmlTab = `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${escXml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  try {
    // nell'app: appunti di sistema tramite il processo main (testo + HTML, sempre consentito)
    if (window.leggio) { await app.platform.invokeFeature('conversione:appunti', { text, html: htmlTab }); return true; }
  } catch { /* si prova con l'API del browser */ }
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([htmlTab], { type: 'text/html' }) })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
}

async function estraiRiquadro(app, pageIndex, p1, p2) {
  const doc = app.activeDoc;
  const page = await doc.pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  page.cleanup();
  // da punti PDF a coordinate "dall'alto" della viewport a scala 1, come i frammenti
  const a = vp.convertToViewportPoint(p1[0], p1[1]);
  const b = vp.convertToViewportPoint(p2[0], p2[1]);
  const x0 = Math.min(a[0], b[0]); const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]); const y1 = Math.max(a[1], b[1]);
  const { frags } = await testoPagina(doc.pdf, pageIndex, { withFonts: false });
  const dentro = frags.filter((f) => {
    const cx = f.x + f.w / 2; const cy = f.y - f.size * 0.3;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
  return { rows: tabellaDaFrammenti(dentro), vuota: !dentro.length };
}

function attiva(app, optionsEl) {
  const { h } = app.ui;
  app.viewer.setMode('tool', 'crosshair');
  optionsEl.append(h('span', { class: 'conv-hint' }, 'Trascina un riquadro attorno alla tabella: la copio negli appunti, pronta da incollare in Excel.'));
  const container = app.el.viewerContainer;
  let drag = null;
  const down = (e) => {
    const ov = e.target.closest?.('.leggio-overlay');
    if (!ov || e.button !== 0) return;
    e.preventDefault();
    const pageIndex = Number(ov.dataset.pageIndex);
    const r = ov.getBoundingClientRect();
    const box = h('div', { class: 'conv-sel' });
    ov.append(box);
    drag = { pageIndex, ov, box, sx: e.clientX, sy: e.clientY, r };
    ov.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag) return;
    const { r, box, sx, sy } = drag;
    const x0 = Math.min(sx, e.clientX) - r.left; const y0 = Math.min(sy, e.clientY) - r.top;
    Object.assign(box.style, { left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - sx) + 'px', height: Math.abs(e.clientY - sy) + 'px' });
  };
  const up = async (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    setTimeout(() => d.box.remove(), 600);
    if (Math.abs(e.clientX - d.sx) < 6 || Math.abs(e.clientY - d.sy) < 6) return;
    try {
      const p1 = app.viewer.clientToPdf(d.pageIndex, d.sx, d.sy);
      const p2 = app.viewer.clientToPdf(d.pageIndex, e.clientX, e.clientY);
      const { rows, vuota } = await estraiRiquadro(app, d.pageIndex, p1, p2);
      if (vuota || !rows.length) return app.ui.toast('Nel riquadro non c’è testo. Se la pagina è una scansione, usa prima «Rendi ricercabile (OCR)».', { kind: 'warning', timeout: 6000 });
      const ok = await copiaTabella(app, rows);
      const nc = Math.max(...rows.map((x) => x.length));
      app.ui.toast(ok ? `Tabella copiata: ${rows.length} righe × ${nc} colonne. Incollala in Excel.` : 'Non riesco a usare gli appunti: salva la tabella in Excel.', {
        kind: ok ? 'success' : 'warning', timeout: 8000,
        action: { label: 'Salva in Excel…', run: () => app.exportFile(xlsx([{ name: `Pagina ${d.pageIndex + 1}`, rows }]), `${nomeBase(app.activeDoc?.name)}_tabella.xlsx`, [{ name: 'Cartella Excel', extensions: ['xlsx'] }]) },
      });
    } catch (err) { app.reportError(err, 'Copia della tabella non riuscita'); }
  };
  container.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  stato = () => { container.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
}

export function registraTabella(app) {
  /** Righe e colonne del testo dentro un riquadro (punti PDF) di una pagina del documento attivo. */
  app.services.tabellaDaRiquadro = async (pageIndex, [x1, y1, x2, y2]) => (await estraiRiquadro(app, pageIndex, [x1, y1], [x2, y2])).rows;
  app.registerTool({
    id: 'copy-table', name: 'Copia come tabella', category: 'converti', icon: 'form',
    description: 'Seleziona una tabella e incollala in Excel',
    keywords: 'copia tabella excel incolla colonne riquadro seleziona tabella numeri importi estratto conto',
    interactive: { activate: attiva, deactivate: () => { stato?.(); stato = null; } },
  });
}
