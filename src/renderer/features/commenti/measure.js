// Area «commenti» — Misura: distanza, perimetro, area con scala impostabile (es. 1 cm = 1 m).
// Crea annotazioni Line / PolyLine / Polygon con /Measure ed etichetta, come Acrobat Pro.
import { measure, normScale, scaleLabel, ptToReal, rectFromPoints, REAL_UNITS } from './geom.js';
import { createAnnot, measureSpec } from './annots.js';
import { S, setS, author, edit, segmented, overlayOf, eventPoint, previewSvg, svgEl, swatchRow, rgb } from './ui-common.js';

export function measureTool(app) {
  let cleanup = null;
  return {
    id: 'measure', name: 'Misura', category: 'avanzati', icon: 'measure',
    description: 'Distanza, perimetro e area su disegni e planimetrie, con scala a scelta (es. 1 cm = 1 m).',
    keywords: 'misura misurazione righello distanza area perimetro scala planimetria metri measure',
    interactive: {
      activate(_, opts) {
        const H = app.ui.h;
        const kind = () => S(app, 'measure.kind', 'distance');
        const render = () => {
          opts.innerHTML = '';
          opts.append(
            segmented(app, { items: [{ value: 'distance', label: 'Distanza' }, { value: 'perimeter', label: 'Perimetro' }, { value: 'area', label: 'Area' }], value: kind(), onPick: (v) => { setS(app, 'measure.kind', v); abort(); render(); } }),
            H('button', { class: 'btn small', onclick: async () => { if (await askScale(app)) render(); } }, 'Scala: ' + scaleLabel(S(app, 'measure.scale'))),
            swatchRow(app, { palette: ['#e03131', '#1c7ed6', '#2f9e44', '#000000'], value: S(app, 'measure.color', '#e03131'), onPick: (c) => setS(app, 'measure.color', c) }),
            live,
            H('span', { class: 'lg-hint' }, kind() === 'distance' ? 'Trascina da un punto all\'altro.' : 'Clic su ogni vertice; doppio clic o Invio per finire.'));
        };
        const live = H('output', { class: 'lg-live', 'aria-live': 'polite' });
        render();
        app.viewer.setMode('tool', 'crosshair');
        const c = app.viewer.container;
        let cur = null; // { ov, pi, css:[], pdf:[], el, label }
        const abort = () => { cur?.el.remove(); cur?.label.remove(); cur = null; live.textContent = ''; };
        const scale = () => normScale(S(app, 'measure.scale'));
        const draw = (extra) => {
          const css = extra ? [...cur.css, extra.css] : cur.css;
          const pdf = extra ? [...cur.pdf, extra.pdf] : cur.pdf;
          cur.el.setAttribute('points', (kind() === 'area' || kind() === 'perimeter') && css.length > 2 ? [...css, css[0]].map((q) => q.join(',')).join(' ') : css.map((q) => q.join(',')).join(' '));
          const m = measure(kind(), pdf, scale());
          live.textContent = pdf.length > 1 ? m.label : '';
          const last = css[css.length - 1];
          cur.label.textContent = pdf.length > 1 ? m.label : '';
          cur.label.setAttribute('x', last[0] + 8); cur.label.setAttribute('y', last[1] - 8);
          return m;
        };
        const start = (ov, p) => {
          const svg = previewSvg(ov);
          const el = svgEl('polyline', { class: 'lg-ghost', fill: kind() === 'area' ? 'rgba(224,49,49,.12)' : 'none', stroke: S(app, 'measure.color', '#e03131'), 'stroke-width': 1.5, 'stroke-dasharray': '6 3' });
          const label = svgEl('text', { class: 'lg-measure-label' });
          svg.append(el, label);
          cur = { ov, pi: +ov.dataset.pageIndex, css: [[p.x, p.y]], pdf: [[p.px, p.py]], el, label };
        };
        const finish = async () => {
          if (!cur) return;
          const k = kind(); const s = scale();
          const pts = cur.pdf.filter((v, i, a) => i === 0 || Math.hypot(v[0] - a[i - 1][0], v[1] - a[i - 1][1]) > 0.5);
          const pi = cur.pi; abort();
          if (pts.length < (k === 'distance' ? 2 : 3)) { if (k !== 'distance') app.ui.toast('Servono almeno 3 punti'); return; }
          const m = measure(k, pts, s);
          const color = rgb(S(app, 'measure.color', '#e03131'));
          const unit = s.realUnit; const f = ptToReal(s);
          const base = { color, width: 1, text: m.label, measureLabel: m.label, measure: measureSpec(scaleLabel(s), unit, f), subject: { distance: 'Distanza', perimeter: 'Perimetro', area: 'Area' }[k] };
          const who = await author(app);
          await edit(app, `Misura: ${m.label}`, (pdfDoc) => createAnnot(pdfDoc, pi,
            k === 'distance' ? { ...base, type: 'Line', line: [...pts[0], ...pts[1]], lineEnding: ['Butt', 'Butt'], intent: 'LineDimension', rect: rectFromPoints(pts, 14) }
              : k === 'perimeter' ? { ...base, type: 'PolyLine', vertices: [...pts, pts[0]], intent: 'PolyLineDimension', rect: rectFromPoints(pts, 14) }
                : { ...base, type: 'Polygon', vertices: pts, intent: 'PolygonDimension', interior: null, rect: rectFromPoints(pts, 14) }, { author: who }));
        };
        const onDown = (e) => {
          const ov = overlayOf(e.target); if (!ov || e.button !== 0) return;
          e.preventDefault();
          const p = eventPoint(app, ov, e);
          if (kind() === 'distance') { abort(); start(ov, p); ov.setPointerCapture(e.pointerId); return; }
          if (cur && cur.ov !== ov) abort();
          if (!cur) { start(ov, p); return; }
          if (e.detail >= 2) { finish(); return; }
          cur.css.push([p.x, p.y]); cur.pdf.push([p.px, p.py]); draw();
        };
        const onMove = (e) => {
          if (!cur) return;
          const p = eventPoint(app, cur.ov, e);
          if (kind() === 'distance') { cur.css[1] = [p.x, p.y]; cur.pdf[1] = [p.px, p.py]; draw(); }
          else draw({ css: [p.x, p.y], pdf: [p.px, p.py] });
        };
        const onUp = () => { if (cur && kind() === 'distance') finish(); };
        const onKey = (e) => { if (cur && e.key === 'Enter') { e.preventDefault(); finish(); } };
        c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp); document.addEventListener('keydown', onKey);
        cleanup = () => { c.removeEventListener('pointerdown', onDown); c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerup', onUp); document.removeEventListener('keydown', onKey); abort(); };
      },
      deactivate() { cleanup?.(); cleanup = null; },
    },
  };
}

async function askScale(app) {
  const s = normScale(S(app, 'measure.scale'));
  const v = await app.ui.dialog({
    title: 'Scala di misura',
    message: 'Quanto vale nella realtà una lunghezza sulla pagina? Esempio per una planimetria 1:100: 1 cm = 1 m.',
    fields: [
      { name: 'dv', label: 'Sulla pagina', type: 'number', min: 0, step: 'any', value: s.docValue },
      { name: 'du', label: 'Unità sulla pagina', type: 'select', value: s.docUnit, options: [{ value: 'mm', label: 'millimetri' }, { value: 'cm', label: 'centimetri' }, { value: 'in', label: 'pollici' }, { value: 'pt', label: 'punti' }] },
      { name: 'rv', label: 'Nella realtà', type: 'number', min: 0, step: 'any', value: s.realValue },
      { name: 'ru', label: 'Unità reale', type: 'select', value: s.realUnit, options: REAL_UNITS },
    ],
    okLabel: 'Imposta scala',
    validate: (x) => (!(x.dv > 0) || !(x.rv > 0) ? 'Scrivi due numeri maggiori di zero.' : null),
  });
  if (!v) return false;
  setS(app, 'measure.scale', normScale({ docValue: v.dv, docUnit: v.du, realValue: v.rv, realUnit: v.ru }));
  return true;
}
