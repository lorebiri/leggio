// «Ritaglia pagine»: riquadro disegnato sulla pagina, margini numerici o rimozione automatica dei bordi bianchi.
import { ritaglia as ritagliaLogica } from '../logica/impaginazione.js';
import { intervalli, mmToPt, ptToMm, indiciInTesto } from '../logica/util.js';
import { analizzaPagina, mostraErrore } from './comune.js';
import { modifica } from './strumenti.js';

export function strumentoRitaglia(app) {
  let stato = null;
  const { h } = app.ui;

  function disegna(i) {
    const ov = app.viewer.getOverlay(i); if (!ov) return;
    ov.querySelector('.pg-crop-rett')?.remove();
    const r = stato?.rett; if (!r || r.pagina !== i) return;
    const css = app.viewer.pdfRectToCss(i, r.box);
    const el = h('div', { class: 'pg-crop-rett', style: { left: css.left + 'px', top: css.top + 'px', width: css.width + 'px', height: css.height + 'px' } },
      ...['nw', 'ne', 'sw', 'se'].map((k) => h('span', { class: 'pg-h ' + k, 'data-h': k })),
      h('span', { class: 'pg-crop-misure' }, `${Math.round(ptToMm(Math.abs(r.box[2] - r.box[0])))} × ${Math.round(ptToMm(Math.abs(r.box[3] - r.box[1])))} mm`));
    ov.append(el);
  }
  function ridisegnaTutto() { document.querySelectorAll('.pg-crop-rett').forEach((e) => e.remove()); if (stato?.rett) disegna(stato.rett.pagina); }

  function pointerDown(e) {
    const ov = e.target.closest?.('.leggio-overlay'); if (!ov || e.button !== 0) return;
    const i = +ov.dataset.pageIndex;
    const p = app.viewer.clientToPdf(i, e.clientX, e.clientY); if (!p) return;
    e.preventDefault(); e.stopPropagation();
    const maniglia = e.target.dataset?.h;
    const dentro = e.target.closest('.pg-crop-rett') && stato.rett?.pagina === i;
    if (maniglia && stato.rett) {
      // l'angolo opposto resta fermo: lo troviamo in coordinate PDF
      const [x1, y1, x2, y2] = stato.rett.box;
      const angoli = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]];
      const lontano = angoli.reduce((best, a) => (Math.hypot(a[0] - p[0], a[1] - p[1]) > Math.hypot(best[0] - p[0], best[1] - p[1]) ? a : best));
      stato.drag = { tipo: 'nuovo', pagina: i, a: lontano };
    } else if (dentro) stato.drag = { tipo: 'muovi', pagina: i, da: p, box: [...stato.rett.box] };
    else { stato.drag = { tipo: 'nuovo', pagina: i, a: p }; stato.rett = { pagina: i, box: [p[0], p[1], p[0], p[1]] }; }
    ov.setPointerCapture?.(e.pointerId);
    aggiornaBarra();
  }
  function pointerMove(e) {
    const d = stato?.drag; if (!d) return;
    const p = app.viewer.clientToPdf(d.pagina, e.clientX, e.clientY); if (!p) return;
    if (d.tipo === 'nuovo') stato.rett = { pagina: d.pagina, box: [Math.min(d.a[0], p[0]), Math.min(d.a[1], p[1]), Math.max(d.a[0], p[0]), Math.max(d.a[1], p[1])] };
    else { const dx = p[0] - d.da[0], dy = p[1] - d.da[1]; stato.rett = { pagina: d.pagina, box: [d.box[0] + dx, d.box[1] + dy, d.box[2] + dx, d.box[3] + dy] }; }
    disegna(d.pagina);
  }
  function pointerUp() {
    if (!stato?.drag) return;
    stato.drag = null;
    const r = stato.rett;
    if (r && (Math.abs(r.box[2] - r.box[0]) < 8 || Math.abs(r.box[3] - r.box[1]) < 8)) { stato.rett = null; ridisegnaTutto(); }
    aggiornaBarra();
  }

  let ambito, pagine, btnApplica, info;
  function aggiornaBarra() {
    if (!btnApplica) return;
    btnApplica.disabled = !stato?.rett;
    info.textContent = stato?.rett ? `Riquadro sulla pagina ${stato.rett.pagina + 1}: trascina gli angoli per regolarlo.` : 'Trascina un riquadro sulla pagina per scegliere la parte da tenere.';
    pagine.hidden = ambito.value !== 'scelte';
  }
  function paginePerAmbito() {
    const n = app.activeDoc.pageCount;
    const cur = stato?.rett?.pagina ?? app.viewer.pageIndex;
    switch (ambito.value) {
      case 'questa': return [cur];
      case 'tutte': return [...Array(n).keys()];
      case 'pari': return intervalli('pari', n);
      case 'dispari': return intervalli('dispari', n);
      default: return intervalli(pagine.value, n);
    }
  }

  async function applicaRiquadro() {
    if (!stato?.rett) return;
    let indici; try { indici = paginePerAmbito(); } catch (e) { return mostraErrore(app, Object.assign(e, { name: 'ErroreUtente' }), 'Ritaglia pagine'); }
    if (!indici.length) return app.ui.toast('Nessuna pagina scelta', { kind: 'warning' });
    const box = stato.rett.box;
    const ok = await modifica(app, `Ritagliate ${indici.length === 1 ? 'la pagina ' + (indici[0] + 1) : indici.length + ' pagine'}`, (d) => ritagliaLogica(d, indici, { rett: box }));
    if (ok) { stato.rett = null; ridisegnaTutto(); aggiornaBarra(); }
  }

  async function margini() {
    const v = await app.ui.dialog({ title: 'Ritaglia con margini', message: 'Quanto togliere da ogni lato, come si vede la pagina.', fields: [
      { name: 'alto', label: 'Sopra (mm)', type: 'number', min: 0, max: 500, value: 10 },
      { name: 'basso', label: 'Sotto (mm)', type: 'number', min: 0, max: 500, value: 10 },
      { name: 'sinistra', label: 'Sinistra (mm)', type: 'number', min: 0, max: 500, value: 10 },
      { name: 'destra', label: 'Destra (mm)', type: 'number', min: 0, max: 500, value: 10 },
      { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
    ], okLabel: 'Ritaglia', validate: (x) => { for (const k of ['alto', 'basso', 'sinistra', 'destra']) if (!(x[k] >= 0 && x[k] <= 500)) return 'I margini vanno da 0 a 500 mm.'; try { intervalli(x.pages, app.activeDoc.pageCount); } catch (e) { return e.message; } } });
    if (!v) return;
    const indici = intervalli(v.pages, app.activeDoc.pageCount);
    const m = { alto: mmToPt(v.alto), basso: mmToPt(v.basso), sinistra: mmToPt(v.sinistra), destra: mmToPt(v.destra) };
    await modifica(app, `Ritagliate ${indici.length} pagine`, (d) => ritagliaLogica(d, indici, { margini: m }));
  }

  async function automatico() {
    let indici; try { indici = paginePerAmbito(); } catch (e) { return mostraErrore(app, Object.assign(e, { name: 'ErroreUtente' }), 'Ritaglia pagine'); }
    const doc = app.activeDoc; const pdf = doc.pdf;
    const rett = new Map();
    const ok = await app.ui.withProgress('Ricerca dei margini bianchi', async (p) => {
      for (let k = 0; k < indici.length; k++) {
        if (p.cancelled) return false;
        p.set(k / indici.length, `Pagina ${indici[k] + 1} di ${doc.pageCount}`);
        const r = await analizzaPagina(pdf, indici[k], { scala: 1 });
        if (!r.limiti || r.vuota) continue;
        const pad = 6; // punti di respiro attorno al contenuto
        const a = r.viewport.convertToPdfPoint(r.limiti.x0, r.limiti.y0);
        const b = r.viewport.convertToPdfPoint(r.limiti.x1, r.limiti.y1);
        rett.set(indici[k], [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad]);
      }
      return true;
    }).catch((e) => { mostraErrore(app, e, 'Ritaglia pagine'); return false; });
    if (!ok) return;
    if (!rett.size) return app.ui.toast('Nessun margine bianco da togliere', { kind: 'success' });
    const saltate = indici.filter((i) => !rett.has(i));
    await modifica(app, `Margini bianchi tolti da ${rett.size} pagine`, (d) => ritagliaLogica(d, [...rett.keys()], (i) => rett.get(i)));
    if (saltate.length) app.ui.toast(`Pagine bianche lasciate com'erano: ${indiciInTesto(saltate)}`, { timeout: 6000 });
  }

  async function ripristina() {
    let indici; try { indici = paginePerAmbito(); } catch (e) { return mostraErrore(app, Object.assign(e, { name: 'ErroreUtente' }), 'Ritaglia pagine'); }
    await modifica(app, 'Ritaglio tolto', (d) => ritagliaLogica(d, indici, { ripristina: true }));
  }

  return {
    id: 'crop', name: 'Ritaglia pagine', category: 'pagine', icon: 'crop', acrobatName: 'Ritaglia pagine',
    description: 'Tieni solo una parte della pagina; toglie da solo i margini bianchi delle scansioni',
    keywords: 'ritaglia taglia crop cropbox margini bianchi scontrini rifila',
    interactive: {
      activate(app2, opts) {
        stato = { rett: null, drag: null };
        app.viewer.setMode('tool', 'crosshair');
        info = h('span', { class: 'help', style: { minWidth: '260px' } });
        ambito = h('select', { class: 'pg-input', style: { width: 'auto' }, 'aria-label': 'Pagine a cui applicare' },
          h('option', { value: 'questa' }, 'Solo questa pagina'), h('option', { value: 'tutte' }, 'Tutte le pagine'), h('option', { value: 'pari' }, 'Pagine pari'), h('option', { value: 'dispari' }, 'Pagine dispari'), h('option', { value: 'scelte' }, 'Pagine…'));
        pagine = h('input', { type: 'text', class: 'pg-input', style: { width: '130px' }, placeholder: 'es. 1-3, 5', 'aria-label': 'Pagine' });
        ambito.addEventListener('change', aggiornaBarra);
        btnApplica = h('button', { class: 'btn primary small', onclick: applicaRiquadro }, 'Ritaglia');
        opts.append(info, h('label', {}, 'Applica a', ambito), pagine, btnApplica,
          h('button', { class: 'btn small', onclick: automatico, title: 'Trova il contenuto e toglie i bordi bianchi (anche delle scansioni)' }, 'Togli margini bianchi'),
          h('button', { class: 'btn small', onclick: margini }, 'Margini in mm…'),
          h('button', { class: 'btn small', onclick: ripristina, title: 'Toglie il ritaglio e mostra di nuovo tutta la pagina' }, 'Ripristina originale'));
        aggiornaBarra();
        stato.off = app.bus.on('page:rendered', ({ pageIndex }) => { if (stato?.rett?.pagina === pageIndex) disegna(pageIndex); });
        stato.offDoc = app.bus.on('document:changed', () => { if (stato) { stato.rett = null; aggiornaBarra(); } });
        app.viewer.container.addEventListener('pointerdown', pointerDown, true);
        window.addEventListener('pointermove', pointerMove);
        window.addEventListener('pointerup', pointerUp);
      },
      deactivate() {
        stato?.off?.(); stato?.offDoc?.();
        app.viewer.container.removeEventListener('pointerdown', pointerDown, true);
        window.removeEventListener('pointermove', pointerMove);
        window.removeEventListener('pointerup', pointerUp);
        document.querySelectorAll('.pg-crop-rett').forEach((e) => e.remove());
        stato = null; btnApplica = null;
      },
    },
  };
}
