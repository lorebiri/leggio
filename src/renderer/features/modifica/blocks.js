// Raggruppamento del testo della pagina in righe e paragrafi (blocchi modificabili) e utilità di testo.
// Puro: lavora sugli item di getTextContent di pdf.js oppure sui glifi dell'interprete.

const rad = (d) => (d * Math.PI) / 180;
/** Da spazio pagina a riferimento locale ruotato di -angle. */
export function toLocal(angle, x, y) { const r = rad(angle), c = Math.cos(r), s = Math.sin(r); return [x * c + y * s, -x * s + y * c]; }
export function fromLocal(angle, lx, ly) { const r = rad(angle), c = Math.cos(r), s = Math.sin(r); return [lx * c - ly * s, lx * s + ly * c]; }

/** Quadrilatero e rettangolo in spazio pagina di un box locale [x0,y0,x1,y1]. */
export function boxToPage(angle, box) {
  const [x0, y0, x1, y1] = box;
  const quad = [fromLocal(angle, x0, y0), fromLocal(angle, x1, y0), fromLocal(angle, x1, y1), fromLocal(angle, x0, y1)];
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  return { quad, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/**
 * Raggruppa gli item di pdf.js in blocchi.
 * @param items  textContent.items
 * @param styles textContent.styles (facoltativo)
 * @param opts   { rules: [{x0,y0,x1,y1}] } tratti disegnati nella pagina (interprete → rules), in spazio pagina:
 *               i filetti verticali separano le celle delle tabelle, quelli orizzontali le righe.
 * @returns blocks: [{ id, angle, box:[x0,y0,x1,y1] locale, quad, rect, lines:[{text,left,right,base,fs}], text, fontSize, lineHeight, fontName, fontFamily,
 *                     cell?: { row, col, bounds:[x0,y0,x1,y1] (locale; y0/y1 null se ignoti), bordered } }]
 *
 * Le righe di testo si dividono in celle quando (a) un filetto verticale cade tra due tratti di testo, oppure
 * (b) uno spazio largo è allineato in colonna su almeno tre righe vicine (tabelle senza bordi, impaginazione a
 * più colonne). Le celle di una tabella non si uniscono in verticale con quelle della riga sotto, salvo le righe
 * di continuazione (testo che va a capo nella stessa cella).
 */
export function groupTextItems(items, styles = {}, opts = {}) {
  const els = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string' || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const fs = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 0;
    if (!(fs > 0.5)) continue;
    let angle = (Math.atan2(b, a) * 180) / Math.PI;
    angle = Math.round(angle * 2) / 2;
    if (Math.abs(angle) < 0.5) angle = 0;
    const [lx, ly] = toLocal(angle, e, f);
    const w = Math.abs(it.width || 0);
    if (!it.str.length && !w) continue;
    els.push({ str: it.str, lx, ly, w, right: lx + w, fs, angle, fontName: it.fontName, eol: !!it.hasEOL, blank: !it.str.trim() });
  }
  els.sort((p, q) => p.angle - q.angle || q.ly - p.ly || p.lx - q.lx);
  // righe come le ha sempre formate Leggio (item consecutivi nell'ordine di lettura, vicini in orizzontale):
  // le divisioni per celle si aggiungono a queste, non le sostituiscono
  {
    let cur = null, id = 0;
    for (const el of els) {
      if (cur && cur.angle === el.angle && Math.abs(cur.base - el.ly) < 0.35 * Math.max(cur.fs, el.fs) && el.lx > cur.right - 0.6 * el.fs && el.lx - cur.right < 2.2 * el.fs) {
        el.ol = cur.id;
        if (!el.blank) cur.fs = Math.max(cur.fs, el.fs);
        cur.right = Math.max(cur.right, el.lx + (el.blank ? Math.min(el.w, 0.5 * el.fs) : el.w));
        continue;
      }
      if (el.blank) { el.ol = -1; continue; }
      cur = { id: ++id, angle: el.angle, base: el.ly, right: el.right, fs: el.fs };
      el.ol = cur.id;
    }
  }
  // file di testo: tutti gli item sulla stessa linea di base
  const rows = [];
  for (const el of els) {
    let row = null;
    for (let k = rows.length - 1; k >= 0 && k >= rows.length - 6; k--) {
      const r = rows[k];
      if (r.angle === el.angle && Math.abs(r.base - el.ly) < 0.35 * Math.max(r.fs, el.fs)) { row = r; break; }
    }
    if (!row) {
      if (el.blank) continue;
      row = { angle: el.angle, base: el.ly, fs: el.fs, els: [] };
      rows.push(row);
    }
    row.els.push(el);
    if (!el.blank) row.fs = Math.max(row.fs, el.fs);
  }
  for (const r of rows) r.els.sort((p, q) => p.lx - q.lx);
  const rules = prepareRules(opts.rules, rows);
  // (a) filetti verticali dentro un item (pdf.js unisce le celle vicine in un solo item) e tra item
  for (const r of rows) {
    if (rules.v.length) r.els = r.els.flatMap((el) => (el.blank ? [el] : splitAtRules(el, r, rules)));
    r.atoms = r.els.filter((el) => !el.blank);
    for (let k = 1; k < r.atoms.length; k++) {
      const a = r.atoms[k - 1], b = r.atoms[k];
      if (b.split) continue;
      const fs = Math.max(a.fs, b.fs);
      const rule = rules.v.length ? verticalRuleBetween(rules, r, a.right - 0.15 * fs, b.lx + 0.15 * fs) : null;
      if (rule) b.split = { kind: 'rule', comp: rule.id, x: rule.x, a, b };
    }
  }
  // (b) colonne allineate (tabelle senza bordi, più colonne)
  detectColumns(rows);
  const comps = new Map();
  for (const r of rows) for (const el of r.atoms) if (el.split) {
    const c = comps.get(el.split.comp) || { gaps: [], aMax: -Infinity, bMin: Infinity };
    c.gaps.push(el.split);
    c.aMax = Math.max(c.aMax, el.split.a.right); c.bMin = Math.min(c.bMin, el.lx);
    comps.set(el.split.comp, c);
  }
  // righe
  const lines = [];
  for (const r of rows) {
    r.lines = [];
    let cur = null;
    for (const el of r.els) {
      const blank = el.blank;
      const forced = !blank && el.split;
      if (cur && !forced && el.ol === cur.ol) {
        if (!blank) {
          const gap = el.lx - cur.right;
          if (gap > 0.12 * el.fs && !cur.text.endsWith(' ') && !el.str.startsWith(' ')) cur.text += ' ';
          cur.text += el.str;
          cur.fs = Math.max(cur.fs, el.fs);
          cur.ink = Math.max(cur.ink, el.right);
        } else if (!cur.text.endsWith(' ')) cur.text += ' ';
        // gli spazi lunghi (tabulazioni, celle vuote) non allungano la riga: separano colonne
        cur.right = Math.max(cur.right, el.lx + (blank ? Math.min(el.w, 0.5 * el.fs) : el.w));
        cur.fontNames.push(el.fontName);
        continue;
      }
      if (blank) continue;
      if (cur && forced) cur.right = cur.ink; // la cella finisce dove finisce il suo testo
      const prev = cur;
      cur = { angle: el.angle, base: el.ly, left: el.lx, right: el.lx + el.w, ink: el.lx + el.w, fs: el.fs, text: el.str, fontNames: [el.fontName], row: r, ol: el.ol };
      if (forced && prev) { cur.splitL = el.split; prev.splitR = el.split; }
      lines.push(cur); r.lines.push(cur);
    }
  }
  for (const l of lines) l.text = l.text.replace(/\s+$/, '');
  // un «canale» tra colonne di prosa (impaginazione su più colonne) divide le righe ma non fa una tabella:
  // lo è quando da entrambe le parti la maggior parte delle righe è testo corrente (righe larghe, molte parole)
  // (oppure quando un lato è una vera colonna di testo: righe di prosa quasi tutte larghe come la colonna)
  for (const r of rows) r.lines.forEach((l, k) => {
    if (!k || !l.splitL) return;
    const c = comps.get(l.splitL.comp);
    (c.L = c.L || []).push(r.lines[k - 1]); (c.R = c.R || []).push(l);
  });
  const textColumn = (ls) => {
    if (ls.length < 6) return false;
    const wmax = Math.max(...ls.map((l) => l.right - l.left));
    return ls.filter(isProse).length >= 0.6 * ls.length && ls.filter((l) => l.right - l.left >= 0.85 * wmax).length >= 0.6 * ls.length;
  };
  for (const c of comps.values()) {
    const L = c.L || [], R = c.R || [];
    c.gutter = (L.filter(isProse).length >= 0.5 * c.gaps.length && R.filter(isProse).length >= 0.5 * c.gaps.length) || textColumn(L) || textColumn(R);
  }
  for (const l of lines) {
    if (l.splitL) l.splitL = { ...l.splitL, gutter: comps.get(l.splitL.comp).gutter };
    if (l.splitR) l.splitR = { ...l.splitR, gutter: comps.get(l.splitR.comp).gutter };
    const sides = [l.splitL, l.splitR].filter((x) => x && !x.gutter);
    l.table = sides.length > 0;
    // riga di testo corrente accanto a pochi elementi isolati (es. il bordo di una figura nella colonna vicina)
    if (l.table && isProse(l) && sides.every((x) => comps.get(x.comp).gaps.length < 4)) l.table = false;
    if (rules.v.length || rules.h.length) l.box = cellBox(l, rules);
  }
  // colonna di testo accanto a una figura o a un elenco: se nella stessa fascia verticale la maggior parte delle
  // righe di quel lato non è divisa, quel lato è testo corrente e le sue righe restano paragrafi
  for (const [id, c] of comps) {
    if (c.gutter) continue;
    for (const side of ['L', 'R']) {
      const mine = lines.filter((l) => (side === 'L' ? l.splitR : l.splitL)?.comp === id);
      if (!mine.length || !mine.some(isProse)) continue;
      const top = Math.max(...mine.map((l) => l.base)), bot = Math.min(...mine.map((l) => l.base));
      const x0 = Math.min(...mine.map((l) => l.left)), x1 = Math.max(...mine.map((l) => l.right));
      const free = lines.filter((l) => !mine.includes(l) && l.angle === mine[0].angle && l.base <= top && l.base >= bot && Math.min(l.right, x1) - Math.max(l.left, x0) > 0.5 * (l.right - l.left) && isProse(l)).length;
      if (free > mine.length) for (const l of mine) if (isProse(l)) l.table = false;
    }
  }
  // una riga non divisa ma racchiusa tra due filetti che dividono altre righe è anch'essa una cella
  const tableRules = new Set();
  for (const c of comps) if (!c[1].gutter && String(c[0]).startsWith('r')) tableRules.add(c[0]);
  for (const l of lines) if (!l.table && l.box && l.box.lId && l.box.rId && (tableRules.has(l.box.lId) || tableRules.has(l.box.rId))) l.table = true;
  for (const l of lines) {
    l.key = l.box && l.box.l != null && l.box.r != null ? [l.box.lId, l.box.rId, l.box.t ?? '', l.box.b ?? ''].join('|') : null;
    const fs = l.fs;
    // limiti per il testo nuovo: filetti o colonna vicina
    const sideL = l.splitL ? (l.splitL.kind === 'rule' ? l.splitL.x + 1.5 : comps.get(l.splitL.comp).aMax + 0.5 * fs) : l.box?.l != null ? l.box.l + 1.5 : null;
    const sideR = l.splitR ? (l.splitR.kind === 'rule' ? l.splitR.x - 1.5 : comps.get(l.splitR.comp).bMin - 0.5 * fs) : l.box?.r != null ? l.box.r - 1.5 : null;
    l.bounds = [sideL == null ? null : Math.min(sideL, l.left), sideR == null ? null : Math.max(sideR, l.right)];
  }
  let tableRow = -1;
  for (const r of rows) { const t = r.lines.filter((l) => l.table); if (t.length) { tableRow++; t.forEach((l, k) => { l.cellRow = tableRow; l.cellCol = k; }); } r.tableCount = t.length; }
  // paragrafi
  lines.sort((p, q) => p.angle - q.angle || q.base - p.base || p.left - q.left);
  const blocks = [];
  const open = [];
  for (const ln of lines) {
    let target = null;
    for (let k = open.length - 1; k >= 0 && k >= open.length - 12; k--) {
      const bl = open[k];
      const last = bl.lines[bl.lines.length - 1];
      if (bl.angle !== ln.angle) continue;
      if (Math.abs(last.fs - ln.fs) > 0.18 * Math.max(last.fs, ln.fs)) continue;
      const dy = last.base - ln.base;
      if (dy < 0.6 * ln.fs || dy > 1.9 * ln.fs) continue;
      if (bl.lines.length >= 2) { const prevDy = bl.lines[bl.lines.length - 2].base - last.base; if (Math.abs(prevDy - dy) > 0.3 * ln.fs) continue; }
      const overlap = Math.min(bl.right, ln.right) - Math.max(bl.left, ln.left);
      if (overlap < Math.min(0.3 * (ln.right - ln.left), 3 * ln.fs)) continue;
      if (Math.abs(ln.left - bl.left) > 6 * ln.fs) continue;
      if (rules.h.length && horizontalRuleBetween(rules, last, ln)) continue;
      if ((last.table || ln.table) && !sameCell(last, ln)) continue;
      target = bl; break;
    }
    if (target) {
      target.lines.push(ln);
      target.left = Math.min(target.left, ln.left); target.right = Math.max(target.right, ln.right);
    } else {
      const bl = { angle: ln.angle, lines: [ln], left: ln.left, right: ln.right };
      open.push(bl); blocks.push(bl);
    }
  }
  return blocks.map((bl, i) => finishBlock(bl, i, styles, lines));
}

const LIST_MARK = /^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[•·▪■□◦●○\-–—*])$/;
/** Riga di testo corrente: larga (almeno 10 em) e con almeno tre parole. */
const isProse = (l) => l.right - l.left >= 10 * l.fs && words(l.text) >= 3;
const words = (s) => String(s).trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
const NUMERIC = /^[\s€$£%+\-−–.,:/'()\d]*\d[\s€$£%+\-−–.,:/'()\d]*$/;
const isNumeric = (s) => NUMERIC.test(String(s));

/** Le righe ln (sotto) e last (sopra) possono stare nella stessa cella? */
function sameCell(last, ln) {
  if (last.key || ln.key) {
    if (last.key !== ln.key) return false;
    // cella chiusa da filetti su quattro lati: tutto quello che c'è dentro è la stessa cella (salvo righe di
    // tabella complete, quando la griglia ha solo il contorno)
    if (last.box.t != null && last.box.b != null && (ln.row.tableCount < last.row.tableCount || ln.row.tableCount <= 1)) return true;
    // stessi filetti ai lati, interlinea stretta, solo testo: è un titolo o una nota che va a capo nella cella
    if (last.key && !isNumeric(ln.text) && !isNumeric(last.text) && last.base - ln.base <= 1.25 * Math.max(ln.fs, last.fs)) return true;
  }
  if (!last.table) return false; // una riga di tabella non si attacca al paragrafo sopra
  // riga di continuazione: meno celle della riga sopra, solo testo (i numeri non vanno a capo), dentro i limiti della cella
  if (isNumeric(ln.text) || isNumeric(last.text)) return false;
  if (ln.row.tableCount >= Math.max(2, last.row.tableCount)) return false;
  if (ln.row.lines.some((l) => l !== ln && (l.table && isNumeric(l.text)))) return false;
  const [b0, b1] = last.bounds;
  if (b0 != null && ln.left < b0 - 0.5 * ln.fs) return false;
  if (b1 != null && ln.right > b1 + 0.5 * ln.fs) return false;
  if (!ln.table && b1 == null && ln.right > last.right + 2 * ln.fs) return false;
  return true;
}

// ------------------------------------------------------------------ filetti

/** Filetti in coordinate locali per ciascun orientamento delle righe: { v:[{x,y0,y1,id}], h:[{y,x0,x1,id}] } (uniti se allineati). */
function prepareRules(raw, rows) {
  const out = { v: [], h: [] };
  if (!raw || !raw.length || !rows.length) return out;
  // le tabelle sono dritte o girate di 90°: il testo ad altri angoli (etichette di mappe e disegni) non usa i
  // filetti, e ogni angolo in più costava un'altra passata su migliaia di tratti (interfaccia bloccata)
  const angles = [...new Set(rows.map((r) => r.angle))].filter((a) => ((a % 90) + 90) % 90 === 0);
  for (const ang of angles) {
    const v = [], h = [];
    for (const r of raw) {
      const [ax, ay] = toLocal(ang, r.x0, r.y0), [bx, by] = toLocal(ang, r.x1, r.y1);
      const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
      if (dx < 0.8 && dy >= 2) v.push({ angle: ang, x: (ax + bx) / 2, y0: Math.min(ay, by), y1: Math.max(ay, by) });
      else if (dy < 0.8 && dx >= 2) h.push({ angle: ang, y: (ay + by) / 2, x0: Math.min(ax, bx), x1: Math.max(ax, bx) });
    }
    out.v.push(...mergeCollinear(v, 'x', 'y0', 'y1'));
    out.h.push(...mergeCollinear(h, 'y', 'x0', 'x1'));
  }
  out.v.forEach((r, i) => { r.id = 'r' + i; });
  out.h.forEach((r, i) => { r.id = 'h' + i; });
  if (out.v.length > 4000) out.v.length = 4000;
  if (out.h.length > 4000) out.h.length = 4000;
  return out;
}
function mergeCollinear(list, pos, a, b) {
  list.sort((p, q) => p[pos] - q[pos] || p[a] - q[a]);
  const out = [];
  for (const s of list) {
    // out è ordinato per posizione: si guardano solo gli ultimi tratti allineati (al più 64), non tutto l'elenco,
    // così migliaia di tratti (tratteggi, disegni tecnici) non bloccano l'interfaccia
    let m = null;
    for (let k = out.length - 1, n = 0; k >= 0 && n < 64 && out[k][pos] > s[pos] - 0.75; k--, n++) {
      const o = out[k];
      if (s[a] <= o[b] + 2.5 && s[b] >= o[a] - 2.5) { m = o; break; }
    }
    if (m) { m[a] = Math.min(m[a], s[a]); m[b] = Math.max(m[b], s[b]); } else out.push({ ...s });
  }
  return out;
}
/** Il filetto verticale attraversa la riga (copre la zona tra linea di base e metà altezza delle lettere)? */
const crossesRow = (v, r) => v.angle === r.angle && v.y0 <= r.base + 0.2 * r.fs && v.y1 >= r.base + 0.5 * r.fs;
function verticalRuleBetween(rules, r, x0, x1) {
  let best = null;
  for (const v of rules.v) if (v.x > x0 && v.x < x1 && crossesRow(v, r)) { if (!best || Math.abs(v.x - (x0 + x1) / 2) < Math.abs(best.x - (x0 + x1) / 2)) best = v; }
  return best;
}
/** Filetto orizzontale tra due righe (sopra la riga ln, sotto la riga last), che copre il centro di ln. */
function horizontalRuleBetween(rules, last, ln) {
  const lo = ln.base + 0.55 * ln.fs, hi = last.base - 0.2 * last.fs;
  const cx = (Math.max(ln.left, last.left) + Math.min(ln.right, last.right)) / 2;
  return rules.h.some((h) => h.angle === ln.angle && h.y > lo && h.y < hi && h.x0 <= cx && h.x1 >= cx);
}
/** Filetti più vicini intorno a una riga: { l, r, t, b, lId, rId } (null se assenti). */
function cellBox(l, rules) {
  const fs = l.fs, out = { l: null, r: null, t: null, b: null };
  const row = { angle: l.angle, base: l.base, fs };
  for (const v of rules.v) {
    if (!crossesRow(v, row)) continue;
    if (v.x <= l.left + 0.2 * fs && (out.l == null || v.x > out.l)) { out.l = v.x; out.lId = v.id; }
    if (v.x >= l.right - 0.2 * fs && (out.r == null || v.x < out.r)) { out.r = v.x; out.rId = v.id; }
  }
  const cx = (l.left + l.right) / 2;
  for (const h of rules.h) {
    if (h.angle !== l.angle || h.x0 > cx || h.x1 < cx) continue;
    if (out.l != null && h.x1 < out.l) continue;
    if (h.y >= l.base + 0.55 * fs && (out.t == null || h.y < out.t)) out.t = h.y;
    if (h.y <= l.base - 0.05 * fs && (out.b == null || h.y > out.b)) out.b = h.y;
  }
  if (out.t != null) out.t = Math.round(out.t * 10) / 10;
  if (out.b != null) out.b = Math.round(out.b * 10) / 10;
  return out;
}

// larghezze di Helvetica (1/1000 em) per stimare dove cade uno spazio dentro un item di pdf.js
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
function charWidth(ch) {
  let c = ch.charCodeAt(0);
  if (c > 126) c = (ch.normalize('NFD')[0] || 'n').charCodeAt(0);
  return c >= 32 && c <= 126 ? HELV[c - 32] : 556;
}
/** Divide un item nei punti in cui un filetto verticale lo attraversa (in corrispondenza di uno spazio). */
function splitAtRules(el, r, rules) {
  const fs = el.fs;
  const cross = rules.v.filter((v) => v.x > el.lx + 0.3 * fs && v.x < el.right - 0.3 * fs && crossesRow(v, r));
  if (!cross.length || !/\s/.test(el.str.trim())) return [el];
  const str = el.str, ws = [...str].map(charWidth);
  const tot = ws.reduce((t, w) => t + w, 0) || 1;
  const k = el.w / tot;
  const pos = []; let x = el.lx;
  for (const w of ws) { pos.push(x); x += w * k; }
  pos.push(el.right);
  const chars = [...str];
  const cuts = [];
  for (const v of cross.sort((p, q) => p.x - q.x)) {
    let best = -1, bd = Infinity;
    chars.forEach((ch, i) => { if (/\s/.test(ch)) { const d = Math.abs((pos[i] + pos[i + 1]) / 2 - v.x); if (d < bd) { bd = d; best = i; } } });
    if (best > 0 && bd < 1.2 * fs && !cuts.some((c) => c.i === best)) cuts.push({ i: best, v });
  }
  if (!cuts.length) return [el];
  cuts.sort((p, q) => p.i - q.i);
  const out = [];
  let from = 0, prevRule = null;
  for (const c of [...cuts, { i: chars.length, v: null }]) {
    let a = from, b = c.i;
    while (a < b && /\s/.test(chars[a])) a++;
    let e = b; while (e > a && /\s/.test(chars[e - 1])) e--;
    if (e > a) {
      let lx = pos[a], right = pos[e];
      // le stime non devono scavalcare il filetto
      if (prevRule) lx = Math.max(lx, prevRule.x + 0.05);
      if (c.v) right = Math.min(right, c.v.x - 0.05);
      const piece = { ...el, str: chars.slice(a, e).join(''), lx, right, w: Math.max(0, right - lx), estimated: true };
      if (prevRule && out.length) piece.split = { kind: 'rule', comp: prevRule.id, x: prevRule.x, a: out[out.length - 1] };
      out.push(piece);
    }
    from = c.i + 1; prevRule = c.v;
  }
  if (!out.length) return [el];
  if (el.split) out[0].split = el.split;
  return out;
}

// ------------------------------------------------------------------ colonne senza bordi

/**
 * Spazi tra item allineati in colonna: un «fiume» di spazio bianco che attraversa almeno tre righe vicine,
 * con il testo che lo segue (o lo precede) allineato a sinistra, a destra o al centro.
 */
function detectColumns(rows) {
  const gaps = [];
  rows.forEach((r, ri) => {
    r.gaps = [];
    for (let k = 1; k < r.atoms.length; k++) {
      const a = r.atoms[k - 1], b = r.atoms[k];
      const fs = Math.max(a.fs, b.fs);
      if (b.lx - a.right < 0.5 * fs) continue;
      // il numero o il punto di un elenco non è una colonna di tabella
      if (k === 1 && LIST_MARK.test(a.str.trim()) && words(b.str) >= 2) continue;
      const g = { ri, a, b, x0: a.right, x1: b.lx, fs, id: gaps.length };
      r.gaps.push(g); gaps.push(g);
    }
  });
  if (gaps.length < 3) return;
  const parent = gaps.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const aligned = (g, h) => {
    const tol = 0.5 * Math.max(g.fs, h.fs);
    return Math.abs(g.b.lx - h.b.lx) < tol || Math.abs(g.b.right - h.b.right) < tol || Math.abs(g.a.right - h.a.right) < tol
      || Math.abs((g.b.lx + g.b.right) / 2 - (h.b.lx + h.b.right) / 2) < tol;
  };
  for (const g of gaps) {
    const r0 = rows[g.ri];
    for (let j = g.ri + 1, n = 0; j < rows.length && n < 40; j++, n++) {
      const r = rows[j];
      if (r.angle !== r0.angle || rows[j - 1].base - r.base > 3.2 * Math.max(r.fs, rows[j - 1].fs)) break;
      const h = r.gaps.find((x) => Math.min(x.x1, g.x1) - Math.max(x.x0, g.x0) >= 0.25 * g.fs && aligned(g, x));
      if (h) { parent[find(h.id)] = find(g.id); break; }
      // una riga che attraversa lo spazio interrompe la colonna
      if (r.atoms.some((el) => el.lx < g.x0 + 0.1 * g.fs && el.right > g.x1 - 0.1 * g.fs)) break;
    }
  }
  const comp = new Map();
  for (const g of gaps) { const c = find(g.id); if (!comp.has(c)) comp.set(c, []); comp.get(c).push(g); }
  for (const [c, list] of comp) {
    const rowsIn = new Set(list.map((g) => g.ri));
    if (rowsIn.size < 3 || list.filter((g) => g.x1 - g.x0 >= 0.9 * g.fs).length < 2) continue;
    for (const g of list) if (!g.b.split) g.b.split = { kind: 'col', comp: 'c' + c, x: (g.x0 + g.x1) / 2, a: g.a };
  }
}

function finishBlock(bl, i, styles, allLines) {
  const lines = bl.lines;
  const fs = median(lines.map((l) => l.fs));
  const lineHeight = lines.length > 1 ? (lines[0].base - lines[lines.length - 1].base) / (lines.length - 1) : fs * 1.2;
  const box = [bl.left, lines[lines.length - 1].base - 0.25 * fs, bl.right, lines[0].base + 0.82 * fs];
  const { quad, rect } = boxToPage(bl.angle, box);
  const fontName = mostCommon(lines.flatMap((l) => l.fontNames));
  const st = styles[fontName] || {};
  const out = {
    id: 'b' + i, angle: bl.angle, box, quad, rect,
    lines: lines.map((l) => {
      const o = { text: l.text, left: l.left, right: l.right, base: l.base, fs: l.fs };
      // limiti netti per scegliere i glifi della cella (filetto o metà dello spazio tra le colonne)
      if (l.splitL) o.clipL = l.splitL.x;
      if (l.splitR) o.clipR = l.splitR.x;
      return o;
    }),
    text: joinLines(lines, bl.right - bl.left),
    fontSize: fs, lineHeight, fontName, fontFamily: st.fontFamily || 'sans-serif',
    align: guessAlign(lines, bl.left, bl.right, fs),
  };
  const first = lines[0];
  if (lines.some((l) => l.table)) {
    const lastL = lines[lines.length - 1];
    const x0 = Math.min(...lines.map((l) => l.bounds[0] ?? -Infinity)), x1 = Math.max(...lines.map((l) => l.bounds[1] ?? Infinity));
    const y0 = lastL.box?.b != null ? lastL.box.b + 1 : null, y1 = first.box?.t != null ? first.box.t - 1 : null;
    out.cell = {
      row: first.cellRow ?? lines.find((l) => l.cellRow != null)?.cellRow ?? 0, col: first.cellCol ?? 0,
      bounds: [Number.isFinite(x0) ? x0 : null, y0, Number.isFinite(x1) ? x1 : null, y1], bordered: !!first.key,
    };
    if (lines.length === 1 || out.align === 'justify') out.align = guessCellAlign(first, allLines);
  }
  return out;
}

/** Allineamento di una cella: dai margini dentro i filetti oppure dalle altre celle della stessa colonna. */
function guessCellAlign(l, all) {
  const fs = l.fs;
  if (l.box?.l != null && l.box?.r != null) {
    const lp = l.left - l.box.l, rp = l.box.r - l.right;
    if (lp > 2 * rp + 1.5) return 'right';
    if (lp > 1.2 * fs && Math.abs(lp - rp) < 0.2 * (lp + rp) + 1) return 'center';
    return 'left';
  }
  const key = l.splitL ? ['L', l.splitL.comp] : l.splitR ? ['R', l.splitR.comp] : null;
  if (!key) return 'left';
  const mates = all.filter((m) => m.table && m.angle === l.angle && (key[0] === 'L' ? m.splitL?.comp === key[1] : (!m.splitL && m.splitR?.comp === key[1])));
  if (mates.length < 2) return isNumeric(l.text) ? 'right' : 'left';
  const spread = (f) => { const v = mates.map(f); return Math.max(...v) - Math.min(...v); };
  const tol = 0.4 * fs;
  const L = spread((m) => m.left) < tol, R = spread((m) => m.right) < tol, C = spread((m) => (m.left + m.right) / 2) < tol;
  if (L && R) return isNumeric(l.text) ? 'right' : 'left';
  if (L) return 'left';
  if (R) return 'right';
  if (C) return 'center';
  return 'left';
}

function guessAlign(lines, left, right, fs) {
  if (lines.length < 2) return 'left';
  const tol = 0.6 * fs;
  const L = lines.every((l) => Math.abs(l.left - left) < tol);
  const R = lines.slice(0, -1).every((l) => Math.abs(l.right - right) < tol);
  if (L && R) return 'justify';
  if (L) return 'left';
  if (lines.every((l) => Math.abs(l.right - right) < tol)) return 'right';
  const mid = (left + right) / 2;
  if (lines.every((l) => Math.abs((l.left + l.right) / 2 - mid) < tol)) return 'center';
  return 'left';
}

/** Unisce le righe di un paragrafo: le righe "piene" si uniscono con uno spazio, quelle corte vanno a capo. */
export function joinLines(lines, width) {
  let s = '';
  lines.forEach((l, i) => {
    if (i === 0) { s = l.text; return; }
    const prev = lines[i - 1];
    const full = prev.right - prev.left > 0.75 * width;
    if (full && /[A-Za-zÀ-ÿ]-$/.test(s) && /^[a-zà-ÿ]/.test(l.text)) s = s.slice(0, -1) + l.text; // sillabazione
    else s += (full ? ' ' : '\n') + l.text;
  });
  return s;
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; }
function mostCommon(a) { const m = new Map(); let best = null, n = 0; for (const x of a) { const c = (m.get(x) || 0) + 1; m.set(x, c); if (c > n) { n = c; best = x; } } return best; }

/**
 * Va a capo nella larghezza indicata. widthOf(str) → larghezza.
 * Rispetta gli a capo espliciti; spezza le parole troppo lunghe.
 */
export function wrapText(text, maxWidth, widthOf) {
  const out = [];
  for (const para of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!maxWidth || maxWidth <= 0) { out.push(para); continue; }
    const words = para.split(/( +)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (line && widthOf(cand.trimEnd()) <= maxWidth + 1e-6) { line = cand; continue; }
      if (line && /^ +$/.test(w)) { out.push(line.trimEnd()); line = ''; continue; }
      if (line) out.push(line.trimEnd());
      line = w;
      // parola più lunga della riga: si spezza a caratteri
      while (widthOf(line) > maxWidth && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && widthOf(line.slice(0, k)) > maxWidth) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Prefisso e suffisso comuni tra due stringhe → { start, oldEnd, newEnd } (intervalli semiaperti). */
export function diffRange(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  return { start: s, oldEnd: ea, newEnd: eb };
}

/** URL ed email in un testo → [{ start, end, kind:'url'|'email', value }]. */
export function findLinksInText(text) {
  const out = [];
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'«»()]+(?:\([^\s<>"'()]*\)[^\s<>"'«»()]*)*)|\b([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
  let m;
  while ((m = re.exec(text))) {
    let v = m[0];
    let end = m.index + v.length;
    if (m[1]) {
      const orig = v.length;
      for (;;) {
        if (/[.,;:!?'"’”\]}]$/.test(v)) { v = v.slice(0, -1); continue; }
        if (v.endsWith(')') && (v.match(/\(/g) || []).length < (v.match(/\)/g) || []).length) { v = v.slice(0, -1); continue; }
        break;
      }
      end -= orig - v.length;
      if (v.length < 8) continue;
      out.push({ start: m.index, end, kind: 'url', value: /^www\./i.test(v) ? 'https://' + v : v });
    } else out.push({ start: m.index, end, kind: 'email', value: v });
  }
  return out;
}
