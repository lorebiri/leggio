// Ricostruzione della struttura del testo di una pagina PDF (logica pura, senza DOM).
// Input: frammenti di testo normalizzati { str, x, y, w, size, bold, italic } con y = linea di base
// misurata dall'alto della pagina (unità PDF). Output: blocchi in ordine di lettura
// (titoli, paragrafi, elenchi, tabelle), adatti a Word, HTML, testo e lettura ad alta voce.

const BULLET_RE = /^\s*([•◦▪▫‣⁃●○■□►▸✓✔–—\-*·])\s+/;
const ORDERED_RE = /^\s*((?:\d{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,5})[.)])\s+/;

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Moltiplica due matrici PDF [a b c d e f]. */
export function mulMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Bold/italic dal nome del font (es. "ABCDEF+Arial-BoldItalicMT", "Times-Roman", "Calibri,Bold"). */
export function stileDaNomeFont(name = '') {
  const n = String(name).replace(/^[A-Z]{6}\+/, '');
  return {
    bold: /bold|black|heavy|semibold|demi|[-,]bd\b|extrabold|ultrabold/i.test(n),
    italic: /italic|oblique|[-,]it\b|kursiv|corsivo/i.test(n),
  };
}

/**
 * Converte gli item di pdf.js (getTextContent) in frammenti normalizzati.
 * viewportTransform: viewport.transform di una viewport a scala 1 (gestisce rotazione e CropBox).
 * fonts: { [fontName]: { name, bold, italic } } (facoltativo, da page.commonObjs).
 */
export function normalizzaItems(items, viewportTransform, fonts = {}) {
  const out = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string' || !it.transform) continue;
    const str = it.str.replace(/\u0000/g, '');
    if (!str.trim()) continue;
    const m = mulMatrix(viewportTransform, it.transform);
    const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]) || 1;
    // testo verticale o fortemente ruotato: lo teniamo, ma senza pretese di layout
    const sx = Math.hypot(it.transform[0], it.transform[1]) || 1;
    const scaleW = Math.hypot(m[0], m[1]) / sx;
    const f = fonts[it.fontName] || {};
    const st = f.name ? stileDaNomeFont(f.name) : { bold: false, italic: false };
    out.push({
      str, x: m[4], y: m[5], w: Math.max(0, (it.width || 0) * scaleW) || str.length * size * 0.5,
      size, bold: !!(f.bold || st.bold), italic: !!(f.italic || st.italic),
    });
  }
  return out;
}

/** Raggruppa i frammenti in righe (stessa linea di base) e le righe in segmenti (spezzati da grandi spazi). */
export function costruisciSegmenti(frags, { gapFactor = 1.25 } = {}) {
  const items = frags.filter((f) => f && f.str && f.str.trim() && Number.isFinite(f.x) && Number.isFinite(f.y));
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const tol = Math.max(1, it.size * 0.4);
    // cerca una riga aperta compatibile (le ultime righe, per tollerare apici/pedici)
    let row = null;
    for (let k = rows.length - 1; k >= 0 && k >= rows.length - 4; k--) {
      if (Math.abs(rows[k].y - it.y) <= tol) { row = rows[k]; break; }
    }
    if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  const segments = [];
  rows.forEach((row, rowIndex) => {
    row.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of row.items) {
      const size = it.size;
      if (cur) {
        const gap = it.x - cur.x1;
        if (gap > gapFactor * Math.max(size, cur.size) + 0.5) { segments.push(finish(cur)); cur = null; }
      }
      if (!cur) cur = { rowIndex, x0: it.x, x1: it.x + it.w, y: row.y, size, parts: [] };
      else {
        const gap = it.x - cur.x1;
        const prev = cur.parts[cur.parts.length - 1];
        const needSpace = gap > 0.12 * size && !/\s$/.test(prev.str) && !/^\s/.test(it.str);
        if (needSpace) prev.str += ' ';
      }
      cur.parts.push({ str: it.str, bold: it.bold, italic: it.italic, size });
      cur.x1 = Math.max(cur.x1, it.x + it.w);
      cur.x0 = Math.min(cur.x0, it.x);
    }
    if (cur) segments.push(finish(cur));
  });
  return segments;

  function finish(s) {
    let chars = 0; let boldChars = 0; let italicChars = 0;
    const sizes = new Map();
    for (const p of s.parts) {
      const n = p.str.replace(/\s/g, '').length;
      chars += n; if (p.bold) boldChars += n; if (p.italic) italicChars += n;
      const k = Math.round(p.size * 2) / 2;
      sizes.set(k, (sizes.get(k) || 0) + n);
    }
    let size = s.size; let best = -1;
    for (const [k, n] of sizes) if (n > best) { best = n; size = k; }
    const text = s.parts.map((p) => p.str).join('').replace(/\s+/g, ' ').trim();
    return {
      ...s, text, size, chars,
      bold: chars > 0 && boldChars / chars > 0.8, italic: chars > 0 && italicChars / chars > 0.8,
      top: s.y - size * 0.85, bottom: s.y + size * 0.25,
    };
  }
}

/** Intervalli liberi verticali (colonne): gap in x di almeno minGap che nessuna scatola attraversa. */
export function gutters(boxes, minGap) {
  if (boxes.length < 2) return [];
  const iv = boxes.map((b) => [b.x0, b.x1]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let end = iv[0][1];
  for (let i = 1; i < iv.length; i++) {
    if (iv[i][0] - end >= minGap) out.push([end, iv[i][0]]);
    end = Math.max(end, iv[i][1]);
  }
  return out;
}

function splitByGutters(boxes, gs) {
  const groups = gs.map(() => []);
  groups.push([]);
  for (const b of boxes) {
    let k = 0;
    while (k < gs.length && b.x0 >= gs[k][1] - 0.01) k++;
    groups[k].push(b);
  }
  return groups.filter((g) => g.length);
}

/** Gutter "veri" di colonna: ogni colonna deve essere abbastanza larga e contenere più righe. */
function columnGutters(boxes, minGap) {
  const gs = gutters(boxes, minGap);
  if (!gs.length) return [];
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const W = Math.max(1, x1 - x0);
  const groups = splitByGutters(boxes, gs);
  const ok = groups.every((g) => {
    const gx0 = Math.min(...g.map((b) => b.x0)); const gx1 = Math.max(...g.map((b) => b.x1));
    return (gx1 - gx0) >= 0.12 * W || g.length >= 2;
  });
  return ok ? gs : [];
}

/** Bande orizzontali separate da spazi vuoti (in y). */
function bands(boxes) {
  const s = [...boxes].sort((a, b) => a.top - b.top);
  const out = [];
  let cur = [s[0]]; let end = s[0].bottom;
  for (let i = 1; i < s.length; i++) {
    const b = s[i];
    // una lieve sovrapposizione (ascendenti/discendenti) non unisce le bande
    const overlap = end - b.top;
    if (overlap > 0.3 * Math.min(b.bottom - b.top, end - cur[cur.length - 1].top)) { cur.push(b); end = Math.max(end, b.bottom); }
    else { out.push(cur); cur = [b]; end = b.bottom; }
  }
  out.push(cur);
  return out;
}

/**
 * Ordine di lettura con un taglio XY ricorsivo: colonne prima, poi bande orizzontali.
 * Restituisce una lista di regioni (array di scatole), ciascuna da leggere dall'alto in basso.
 */
export function ordineLettura(boxes, { minGap } = {}) {
  if (!boxes.length) return [];
  const gap = minGap ?? Math.max(6, median(boxes.map((b) => b.size || 10)) * 0.9);
  const out = [];
  (function cut(bx, depth) {
    if (bx.length <= 1 || depth > 40) { out.push(bx); return; }
    const gs = columnGutters(bx, gap);
    if (gs.length) { for (const g of splitByGutters(bx, gs)) cut(g, depth + 1); return; }
    const bs = bands(bx);
    if (bs.length <= 1) { out.push(bx); return; }
    // unisce bande consecutive finché la struttura a colonne resta coerente
    const groups = [];
    let group = bs[0];
    for (let i = 1; i < bs.length; i++) {
      const cand = group.concat(bs[i]);
      const gGroup = columnGutters(group, gap).length > 0;
      const gBand = columnGutters(bs[i], gap).length > 0;
      if (columnGutters(cand, gap).length > 0 || (!gGroup && !gBand)) group = cand;
      else { groups.push(group); group = bs[i]; }
    }
    groups.push(group);
    if (groups.length === 1) { out.push(bx); return; }
    for (const g of groups) cut(g, depth + 1);
  })(boxes, 0);
  return out;
}

/** Rileva tabelle: sequenze di righe con ≥2 segmenti allineati su colonne comuni. */
export function rilevaTabelle(segments, { pageWidth = 600 } = {}) {
  const byRow = new Map();
  for (const s of segments) { if (!byRow.has(s.rowIndex)) byRow.set(s.rowIndex, []); byRow.get(s.rowIndex).push(s); }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, segs]) => segs.sort((a, b) => a.x0 - b.x0));
  const tables = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const t = valutaTabella(run, pageWidth);
      if (t) tables.push(t);
    }
    run = [];
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 2) { flush(); continue; }
    if (run.length) {
      const prev = run[run.length - 1];
      const size = median(r.map((s) => s.size));
      const dy = r[0].y - prev[0].y;
      if (dy > 3.2 * size) flush();
    }
    run.push(r);
  }
  flush();
  return tables;
}

function valutaTabella(run, pageWidth) {
  const segs = run.flat();
  const size = median(segs.map((s) => s.size)) || 10;
  const gs = gutters(segs, Math.max(4, size * 0.6));
  if (!gs.length) return null;
  const nCols = gs.length + 1;
  const medChars = median(segs.map((s) => s.text.length));
  const medWidth = median(segs.map((s) => s.x1 - s.x0));
  // testo a colonne (giornale, articolo) e non tabella: segmenti lunghi e larghi
  if (nCols <= 3 && medChars > 28 && medWidth > 0.22 * pageWidth) return null;
  const edges = [-Infinity, ...gs.map((g) => (g[0] + g[1]) / 2), Infinity];
  const rows = run.map((r) => {
    const cells = Array.from({ length: nCols }, () => '');
    for (const s of r) {
      let c = 0;
      while (c < nCols - 1 && (s.x0 + s.x1) / 2 > edges[c + 1]) c++;
      cells[c] = cells[c] ? cells[c] + ' ' + s.text : s.text;
    }
    return cells;
  });
  return {
    rows, segments: segs,
    x0: Math.min(...segs.map((s) => s.x0)), x1: Math.max(...segs.map((s) => s.x1)),
    top: Math.min(...segs.map((s) => s.top)), bottom: Math.max(...segs.map((s) => s.bottom)),
    size, rowIndexFirst: run[0][0].rowIndex,
  };
}

/** Dimensione del corpo del testo: moda pesata per numero di caratteri. */
export function corpoTesto(segments) {
  const m = new Map();
  for (const s of segments) { const k = Math.round(s.size * 2) / 2; m.set(k, (m.get(k) || 0) + s.chars); }
  let best = 0; let size = 10;
  for (const [k, n] of m) if (n > best) { best = n; size = k; }
  return size;
}

function joinLines(prevText, nextText) {
  if (/[A-Za-zÀ-ÿ]-$/.test(prevText) && /^[a-zà-ÿ]/.test(nextText)) return prevText.slice(0, -1) + nextText;
  return prevText + ' ' + nextText;
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic) last.text += r.text;
    else out.push({ ...r });
  }
  if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); }
  return out.filter((r) => r.text);
}

function lineRuns(seg) {
  return seg.parts.map((p) => ({ text: p.str.replace(/\s+/g, ' '), bold: !!p.bold, italic: !!p.italic }));
}

/**
 * Ricostruisce i blocchi di una pagina.
 * opts: { width, height, bodySize (corpo del documento), detectTables=true }
 * → [{ type:'heading', level, text, runs, align } | { type:'paragraph', text, runs, align } |
 *    { type:'list', ordered, marker, text, runs } | { type:'table', rows }]
 */
export function ricostruisciPagina(frags, opts = {}) {
  const width = opts.width || 612;
  const segments = costruisciSegmenti(frags);
  if (!segments.length) return [];
  const bodySize = opts.bodySize || corpoTesto(segments);
  const tables = opts.detectTables === false ? [] : rilevaTabelle(segments, { pageWidth: width });
  const inTable = new Set(tables.flatMap((t) => t.segments));
  const boxes = segments.filter((s) => !inTable.has(s));
  for (const t of tables) boxes.push({ ...t, isTable: true, text: '', chars: 0 });
  const regions = ordineLettura(boxes);
  const blocks = [];
  for (const region of regions) {
    const startCount = blocks.length;
    const tablesHere = region.filter((b) => b.isTable);
    const lines = region.filter((b) => !b.isTable);
    // le tabelle si inseriscono nella posizione verticale giusta
    const items = [...lines.map((l) => ({ kind: 'line', top: l.top, l })), ...tablesHere.map((t) => ({ kind: 'table', top: t.top, t }))]
      .sort((a, b) => a.top - b.top || (a.l?.x0 ?? 0) - (b.l?.x0 ?? 0));
    let pending = [];
    const flushLines = () => { if (pending.length) blocks.push(...paragrafi(pending, bodySize, width)); pending = []; };
    for (const it of items) {
      if (it.kind === 'table') { flushLines(); blocks.push({ type: 'table', rows: it.t.rows }); }
      else pending.push(it.l);
    }
    flushLines();
    if (blocks.length > startCount) blocks[startCount].regionStart = true;
  }
  // un paragrafo spezzato tra due colonne (finisce senza punteggiatura, riprende in minuscolo) torna intero
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.regionStart && prev && prev.type === 'paragraph' && b.type === 'paragraph' && !/[.!?:;»"”)]$/.test(prev.text) && /^[a-zà-ÿ]/.test(b.text)) {
      prev.text = joinLines(prev.text, b.text);
      prev.runs = mergeRuns([...prev.runs, { text: ' ', bold: false, italic: false }, ...b.runs]);
      continue;
    }
    out.push(b);
  }
  for (const b of out) delete b.regionStart;
  return out;
}

/** Unisce in una riga i segmenti della stessa riga (es. testo con tabulazioni non riconosciuto come tabella). */
function unisciRighe(lines) {
  const byRow = new Map();
  for (const l of lines) { if (!byRow.has(l.rowIndex)) byRow.set(l.rowIndex, []); byRow.get(l.rowIndex).push(l); }
  return [...byRow.values()].map((segs) => {
    if (segs.length === 1) return segs[0];
    segs.sort((a, b) => a.x0 - b.x0);
    const parts = [];
    segs.forEach((s, i) => { if (i) parts.push({ str: '\t', bold: false, italic: false, size: s.size }); parts.push(...s.parts); });
    return { ...segs[0], parts, text: segs.map((s) => s.text).join('\t'), x0: segs[0].x0, x1: segs[segs.length - 1].x1, chars: segs.reduce((n, s) => n + s.chars, 0), bold: segs.every((s) => s.bold), italic: segs.every((s) => s.italic), size: Math.max(...segs.map((s) => s.size)) };
  }).sort((a, b) => a.top - b.top);
}

function paragrafi(rawLines, bodySize, pageWidth) {
  const lines = unisciRighe(rawLines);
  if (!lines.length) return [];
  const rx0 = Math.min(...lines.map((l) => l.x0));
  const rx1 = Math.max(...lines.map((l) => l.x1));
  const rw = Math.max(1, rx1 - rx0);
  const spacings = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].y - lines[i - 1].y;
    if (d > 0 && Math.abs(lines[i].size - lines[i - 1].size) < 0.5) spacings.push(d);
  }
  const typical = median(spacings) || bodySize * 1.2;
  const paras = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = lines[i - 1];
    let brk = !cur;
    if (cur && prev) {
      const gap = l.y - prev.y;
      const sizeChange = Math.abs(l.size - prev.size) > Math.max(0.6, 0.12 * prev.size);
      const bullet = BULLET_RE.test(l.text) || (ORDERED_RE.test(l.text) && (BULLET_RE.test(cur.first.text) || ORDERED_RE.test(cur.first.text) || /[.:;]$/.test(prev.text)));
      const shortPrev = /[.!?:;»"”)]$/.test(prev.text) && prev.x1 < rx1 - Math.max(0.12 * rw, 2 * l.size);
      const indent = l.x0 > rx0 + 0.8 * l.size && Math.abs(prev.x0 - rx0) < 0.5 * l.size && shortPrev;
      const boldChange = l.bold !== prev.bold && (l.bold ? l.text.length < 120 : prev.text.length < 120);
      const isHeadingPrev = cur.lines.length && prev.size > bodySize * 1.12;
      const tabbed = l.text.includes('\t') || prev.text.includes('\t');
      brk = gap > typical * 1.4 + 0.5 || gap < -0.5 || sizeChange || bullet || shortPrev || indent || boldChange || (isHeadingPrev && l.size <= bodySize * 1.05) || tabbed;
    }
    if (brk) { cur = { first: l, lines: [] }; paras.push(cur); }
    cur.lines.push(l);
  }
  return paras.map((p) => classifica(p.lines, bodySize, pageWidth, rx0, rx1));
}

function classifica(lines, bodySize, pageWidth) {
  let text = '';
  let runs = [];
  lines.forEach((l, i) => {
    const lr = lineRuns(l);
    if (i === 0) { text = l.text; runs = lr; return; }
    const joined = joinLines(text, l.text);
    const hyphenJoin = joined.length === text.length - 1 + l.text.length;
    if (hyphenJoin) {
      // togli il trattino dall'ultimo run
      for (let k = runs.length - 1; k >= 0; k--) { const t = runs[k].text.replace(/\s+$/, ''); if (t) { runs[k].text = t.slice(0, -1); runs.length = k + 1; break; } }
    } else runs.push({ text: ' ', bold: false, italic: false });
    runs.push(...lr);
    text = joined;
  });
  runs = mergeRuns(runs);
  const size = median(lines.map((l) => l.size));
  const allBold = lines.every((l) => l.bold);
  const x0 = Math.min(...lines.map((l) => l.x0)); const x1 = Math.max(...lines.map((l) => l.x1));
  const center = (x0 + x1) / 2;
  const centered = Math.abs(center - pageWidth / 2) < pageWidth * 0.04 && (x1 - x0) < pageWidth * 0.7 && x0 > pageWidth * 0.15;
  const align = centered ? 'center' : undefined;
  const ratio = size / (bodySize || size);
  let m;
  if ((m = text.match(BULLET_RE))) {
    const cut = (s) => s.replace(BULLET_RE, '');
    return { type: 'list', ordered: false, marker: m[1], text: cut(text), runs: stripPrefix(runs, m[0].length) };
  }
  if ((m = text.match(ORDERED_RE)) && text.length > m[0].length) {
    return { type: 'list', ordered: true, marker: m[1], text, runs };
  }
  const short = text.length < 160 && lines.length <= 3 && !/[.,;]$/.test(text);
  let level = 0;
  if (ratio >= 1.6 && text.length < 300) level = 1;
  else if (ratio >= 1.3 && text.length < 300) level = 2;
  else if (ratio >= 1.12 && short) level = 3;
  else if (allBold && short && text.length < 100 && lines.length <= 2 && /[A-Za-zÀ-ÿ]/.test(text)) level = 4;
  if (level) return { type: 'heading', level, text, runs, align };
  return { type: 'paragraph', text, runs, align };
}

function stripPrefix(runs, n) {
  const out = runs.map((r) => ({ ...r }));
  let left = n;
  while (left > 0 && out.length) {
    const r = out[0];
    if (r.text.length <= left) { left -= r.text.length; out.shift(); }
    else { r.text = r.text.slice(left); left = 0; }
  }
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, '');
  return out.filter((r) => r.text);
}

/** Testo semplice di una lista di blocchi. */
export function blocchiInTesto(blocks) {
  return blocks.map((b) => {
    if (b.type === 'table') return b.rows.map((r) => r.join('\t')).join('\n');
    if (b.type === 'list') return (b.ordered ? '' : '• ') + b.text;
    return b.text;
  }).join('\n\n');
}

/**
 * Griglia di celle da un insieme di frammenti (es. un riquadro selezionato o un'intera pagina):
 * righe per linea di base, colonne dagli spazi verticali comuni. → [[cella]]
 */
export function tabellaDaFrammenti(frags, { gapFactor = 1.0 } = {}) {
  const segs = costruisciSegmenti(frags, { gapFactor });
  if (!segs.length) return [];
  const size = median(segs.map((s) => s.size)) || 10;
  const gs = gutters(segs, Math.max(3, size * 0.5));
  const edges = [-Infinity, ...gs.map((g) => (g[0] + g[1]) / 2), Infinity];
  const nCols = gs.length + 1;
  const byRow = new Map();
  for (const s of segs) { if (!byRow.has(s.rowIndex)) byRow.set(s.rowIndex, []); byRow.get(s.rowIndex).push(s); }
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => {
    const cells = Array.from({ length: nCols }, () => '');
    for (const s of r.sort((a, b) => a.x0 - b.x0)) {
      let c = 0;
      while (c < nCols - 1 && s.x0 >= edges[c + 1]) c++;
      cells[c] = cells[c] ? cells[c] + ' ' + s.text : s.text;
    }
    return cells;
  });
}
