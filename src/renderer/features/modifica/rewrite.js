// Riscrittura mirata di operatori: rimozione/sostituzione di glifi negli operatori di testo e
// riposizionamento delle immagini. Puro: lavora sui risultati di contentstream.js + interpreter.js.
import { fmtNum, toHex, serializeOperand, escapeName } from './contentstream.js';
import { mul, inv } from './interpreter.js';

/** Prefisso che conserva gli effetti collaterali di ' e " (a capo, Tw, Tc). */
function prefixFor(show, opRec) {
  if (show.op === "'") return 'T* ';
  if (show.op === '"') {
    const a = opRec.operands;
    return `${serializeOperand(a[0] || { t: 'num', v: 0 })} Tw ${serializeOperand(a[1] || { t: 'num', v: 0 })} Tc T* `;
  }
  return '';
}

/**
 * Sostituzione per un operatore di testo che elimina i glifi scelti lasciando invariata la posizione
 * di tutti gli altri: al posto dei glifi tolti si inserisce uno spostamento numerico equivalente nel TJ.
 * Ritorna la stringa sostitutiva o null se non è possibile in modo esatto.
 */
export function removeGlyphs(show, opRec, shouldRemove) {
  if (show.inForm) return null;
  const fs = show.fs;
  const out = [];
  let removedAdv = 0; // avanzamento accumulato dei glifi rimossi (unità testo, senza Th)
  let any = false;
  const flushRemoved = () => {
    if (Math.abs(removedAdv) > 1e-9) {
      if (!fs) throw new Error('fs0');
      out.push(fmtNum((-removedAdv * 1000) / fs));
    }
    removedAdv = 0;
  };
  let byEl = new Map();
  show.glyphs.forEach((g, i) => { if (!byEl.has(g.el)) byEl.set(g.el, []); byEl.get(g.el).push([g, i]); });
  try {
    show.elements.forEach((el, ei) => {
      if (!el) return;
      if (el.t === 'num') { flushRemoved(); out.push(serializeOperand(el)); return; }
      if (el.t !== 'str' && el.t !== 'hex') return;
      const list = byEl.get(ei) || [];
      let run = [];
      const flushRun = () => { if (run.length) { out.push('<' + toHex(Uint8Array.from(run)) + '>'); run = []; } };
      for (const [g, gi] of list) {
        if (shouldRemove(g, gi)) { flushRun(); removedAdv += g.adv; any = true; }
        else {
          flushRemoved();
          for (let k = 0; k < g.len; k++) run.push(el.b[g.offset + k]);
        }
      }
      flushRun();
    });
    flushRemoved();
  } catch { return null; }
  if (!any) return undefined; // niente da cambiare
  return prefixFor(show, opRec) + '[' + out.join(' ') + '] TJ';
}

/**
 * Sostituisce i glifi da `from` a `to` (indici inclusi) con i byte codificati `newBytes` nello stesso font.
 * Il testo che segue nello stesso operatore scorre in modo naturale.
 */
export function replaceGlyphRange(show, opRec, from, to, newBytes) {
  if (show.inForm) return null;
  const out = [];
  const byEl = new Map();
  show.glyphs.forEach((g, i) => { if (!byEl.has(g.el)) byEl.set(g.el, []); byEl.get(g.el).push([g, i]); });
  let inserted = false;
  show.elements.forEach((el, ei) => {
    if (!el) return;
    if (el.t === 'num') {
      // la crenatura all'interno della parola sostituita non ha più senso
      const prev = lastGlyphIndexBefore(byEl, ei), next = firstGlyphIndexAfter(byEl, ei, show.elements.length);
      if (prev != null && next != null && prev >= from && next <= to) return;
      out.push(serializeOperand(el)); return;
    }
    if (el.t !== 'str' && el.t !== 'hex') return;
    let run = [];
    const flushRun = () => { if (run.length) { out.push('<' + toHex(Uint8Array.from(run)) + '>'); run = []; } };
    for (const [g, gi] of byEl.get(ei) || []) {
      if (gi >= from && gi <= to) {
        if (!inserted) { for (const b of newBytes) run.push(b); inserted = true; }
        continue;
      }
      for (let k = 0; k < g.len; k++) run.push(el.b[g.offset + k]);
    }
    flushRun();
  });
  if (!inserted) return null;
  return prefixFor(show, opRec) + '[' + out.join(' ') + '] TJ';
}
function lastGlyphIndexBefore(byEl, ei) { for (let e = ei - 1; e >= 0; e--) { const l = byEl.get(e); if (l && l.length) return l[l.length - 1][1]; } return null; }
function firstGlyphIndexAfter(byEl, ei, n) { for (let e = ei + 1; e < n; e++) { const l = byEl.get(e); if (l && l.length) return l[0][1]; } return null; }

// ------------------------------------------------------------------ immagini

const mstr = (m) => m.map(fmtNum).join(' ');

/**
 * Sostituzione per un "Do" di immagine: la disegna con la matrice finale `target` (unità → pagina)
 * al posto della CTM attuale `ctm`. name: nome della risorsa (eventualmente nuovo).
 * clipQuad: facoltativo, 4 punti in spazio pagina per ritagliare.
 */
export function placeImage(ctm, target, name, clipQuad) {
  const ci = inv(ctm);
  if (!ci) return null;
  let s = 'q ';
  if (clipQuad) {
    const pts = clipQuad.map(([x, y]) => [x * ci[0] + y * ci[2] + ci[4], x * ci[1] + y * ci[3] + ci[5]]);
    s += `${fmtNum(pts[0][0])} ${fmtNum(pts[0][1])} m ${pts.slice(1).map((p) => `${fmtNum(p[0])} ${fmtNum(p[1])} l`).join(' ')} h W n `;
  }
  const m = mul(target, ci); // m × ctm = target
  s += `${mstr(m)} cm /${escapeName(name)} Do Q`;
  return s;
}

/** Trasformazioni di pagina (da comporre a destra della CTM di un'immagine). */
export const T = {
  translate: (dx, dy) => [1, 0, 0, 1, dx, dy],
  scaleAbout: (sx, sy, ax, ay) => [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay],
  rotateAbout: (deg, cx, cy) => {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  },
};
