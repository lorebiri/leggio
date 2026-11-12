// Area «commenti» — modello dei commenti per pannello, selezione e riepilogo (logica pura).
// Fonte: page.getAnnotations() di pdf.js (gira nel worker, non blocca l'interfaccia).
import { normRect, rgbToHex, pairs, parsePdfDate, fmtDate, quadsBounds, rectFromPoints } from './geom.js';
import { COMMENT_TYPES, TYPE_LABELS, STATE_LABELS } from './annots.js';
import { esc } from './xfdf.js';

/** Testo pdf.js che a volte arriva con BOM UTF-16 non decodificato. */
export function cleanStr(s) {
  if (typeof s !== 'string') return '';
  if (s.startsWith('þÿ')) { let o = ''; for (let i = 2; i + 1 < s.length; i += 2) o += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1)); return o; }
  return s;
}

/** Dato pdf.js → commento normalizzato, o null se non è un commento o è inutilizzabile. */
export function fromPdfjs(d, pageIndex) {
  try {
    if (!d || !COMMENT_TYPES.has(d.subtype)) return null;
    let rect = normRect(d.rect);
    const quadPoints = d.quadPoints && d.quadPoints.length >= 8 ? Array.from(d.quadPoints) : null;
    if (!rect || (rect[2] - rect[0] <= 0 && rect[3] - rect[1] <= 0)) {
      rect = quadPoints ? quadsBounds(quadPoints) : d.inkLists?.length ? rectFromPoints(d.inkLists.flatMap((l) => pairs(l))) : d.vertices ? rectFromPoints(pairs(d.vertices)) : null;
    }
    if (!rect) return null;
    const color = rgbToHex(d.color, true);
    const mod = parsePdfDate(d.modificationDate) || parsePdfDate(d.creationDate);
    return {
      key: d.id, pageIndex, type: d.subtype, label: TYPE_LABELS[d.subtype] || d.subtype, rect, color,
      text: cleanStr(d.contentsObj?.str || ''), author: cleanStr(d.titleObj?.str || ''), date: mod, dateText: fmtDate(mod),
      irt: d.inReplyTo || null, replyType: d.replyType || null, state: cleanStr(d.state || '') || null, stateModel: cleanStr(d.stateModel || '') || null,
      hidden: !!d.hidden, quadPoints, vertices: d.vertices ? pairs(d.vertices) : null, line: d.lineCoordinates ? Array.from(d.lineCoordinates) : null,
      inkList: d.inkLists ? d.inkLists.map((l) => pairs(l)) : null, noRotate: !!d.noRotate, popupRef: d.popupRef || null,
    };
  } catch { return null; }
}

/**
 * Raggruppa in discussioni: commenti principali con risposte (in ordine di data) e stato corrente
 * (l'ultimo stato di revisione impostato). Le risposte di tipo "Group" vengono unite al genitore.
 */
export function buildThreads(list) {
  const byKey = new Map(list.map((c) => [c.key, { ...c, replies: [], status: null, statusBy: null, marked: false }]));
  const roots = [];
  for (const c of byKey.values()) {
    const parent = c.irt && byKey.get(c.irt);
    if (!parent) { roots.push(c); continue; }
    if (c.replyType === 'Group') continue;
    if (c.state) {
      if ((c.stateModel || 'Review') === 'Marked') { if (!parent._markDate || (c.date || 0) >= parent._markDate) { parent.marked = c.state === 'Marked'; parent._markDate = c.date || 0; } }
      else if (!parent._stateDate || (c.date || 0) >= parent._stateDate) { parent.status = c.state === 'None' ? null : c.state; parent.statusBy = c.author; parent._stateDate = c.date || 0; }
      continue;
    }
    parent.replies.push(c);
  }
  // risposte annidate: portate tutte sotto la radice
  for (const r of roots) {
    const flat = [];
    const walk = (n) => { for (const x of n.replies) { flat.push(x); walk(x); } };
    walk(r);
    r.allReplies = flat.sort((a, b) => (a.date || 0) - (b.date || 0));
  }
  return roots.sort((a, b) => a.pageIndex - b.pageIndex || b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
}

/** Filtro del pannello. f: { q, types:Set, authors:Set, colors:Set, status: ''|'open'|'done'|stato } */
export function filterThreads(threads, f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  return threads.filter((t) => {
    if (f.types?.size && !f.types.has(t.type)) return false;
    if (f.authors?.size && !f.authors.has(t.author || '')) return false;
    if (f.colors?.size && !f.colors.has(t.color || '')) return false;
    if (f.status === 'open' && (t.status === 'Completed' || t.status === 'Accepted' || t.status === 'Rejected' || t.status === 'Cancelled')) return false;
    if (f.status === 'done' && !(t.status === 'Completed' || t.status === 'Accepted')) return false;
    if (f.status && !['open', 'done'].includes(f.status) && t.status !== f.status) return false;
    if (q) {
      const hay = [t.text, t.author, t.label, ...t.allReplies.map((r) => r.text + ' ' + r.author)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Valori distinti per i filtri. */
export function facets(threads) {
  const count = (fn) => { const m = new Map(); for (const t of threads) { const k = fn(t); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  return { types: count((t) => t.type), authors: count((t) => t.author || ''), colors: count((t) => t.color || '').filter(([c]) => c) };
}

// ---------------------------------------------------------------- riepilogo
const statusText = (t) => (t.status ? STATE_LABELS[t.status] || t.status : '');

/** Riepilogo in testo semplice (da incollare in una mail). */
export function summaryText(threads, { docName = '' } = {}) {
  const lines = [`Commenti — ${docName}`.trim(), `${threads.length} commenti`, ''];
  let page = -1;
  for (const t of threads) {
    if (t.pageIndex !== page) { page = t.pageIndex; lines.push(`Pagina ${page + 1}`); }
    const st = statusText(t);
    lines.push(`  • ${t.label}${t.author ? ' — ' + t.author : ''}${t.dateText ? ' (' + t.dateText + ')' : ''}${st ? ' [' + st + ']' : ''}`);
    if (t.text) for (const l of t.text.split(/\r?\n/)) lines.push('    ' + l);
    for (const r of t.allReplies) {
      lines.push(`    ↳ ${r.author || 'Risposta'}${r.dateText ? ' (' + r.dateText + ')' : ''}: ${r.text.replace(/\s+/g, ' ')}`);
    }
  }
  return lines.join('\n');
}

/** Riepilogo HTML stampabile. thumbs: Map pagina → dataURL (facoltativo). */
export function summaryHtml(threads, { docName = '', thumbs = new Map(), author = '' } = {}) {
  const byPage = new Map();
  for (const t of threads) { if (!byPage.has(t.pageIndex)) byPage.set(t.pageIndex, []); byPage.get(t.pageIndex).push(t); }
  let n = 0;
  const sections = [...byPage.entries()].map(([p, ts]) => {
    const img = thumbs.get(p);
    const items = ts.map((t) => {
      n++;
      const st = statusText(t);
      return `<li><div class="hd"><span class="num">${n}</span><span class="dot" style="background:${esc(t.color || '#999')}"></span><b>${esc(t.label)}</b> · ${esc(t.author || 'Senza autore')} <span class="d">${esc(t.dateText)}</span>${st ? ` <span class="st">${esc(st)}</span>` : ''}</div>` +
        (t.text ? `<div class="tx">${esc(t.text).replace(/\n/g, '<br>')}</div>` : '') +
        (t.allReplies.length ? `<ul class="rp">${t.allReplies.map((r) => `<li><b>${esc(r.author || 'Risposta')}</b> <span class="d">${esc(r.dateText)}</span><br>${esc(r.text).replace(/\n/g, '<br>')}</li>`).join('')}</ul>` : '') + '</li>';
    }).join('');
    return `<section><h2>Pagina ${p + 1}</h2><div class="row">${img ? `<img src="${img}" alt="Pagina ${p + 1}">` : ''}<ol>${items}</ol></div></section>`;
  }).join('');
  const now = fmtDate(new Date());
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Riepilogo commenti — ${esc(docName)}</title><style>
body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1c1e22;margin:32px;max-width:1000px}
h1{font-size:22px;margin:0 0 4px}.meta{color:#555;margin-bottom:24px}h2{font-size:16px;border-bottom:2px solid #0f766e;padding-bottom:4px;margin-top:28px}
.row{display:flex;gap:20px;align-items:flex-start}.row img{width:220px;border:1px solid #ccc;flex:none}
ol{list-style:none;padding:0;margin:0;flex:1}ol>li{border:1px solid #ddd;border-radius:8px;padding:10px 12px;margin-bottom:10px;break-inside:avoid}
.hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.num{background:#0f766e;color:#fff;border-radius:10px;padding:0 7px;font-size:12px}
.dot{width:12px;height:12px;border-radius:50%;display:inline-block;border:1px solid #0002}.d{color:#555;font-size:12.5px}
.st{background:#e6f4f1;color:#0c5f58;border-radius:4px;padding:0 6px;font-size:12px}.tx{margin-top:6px;white-space:normal}
.rp{margin:8px 0 0 18px;padding:0;list-style:none}.rp li{border-left:3px solid #ddd;padding:2px 0 2px 10px;margin:6px 0}
@media print{body{margin:12mm}section{break-inside:auto}}
</style></head><body><h1>Riepilogo commenti</h1><div class="meta">${esc(docName)} · ${threads.length} commenti · creato il ${esc(now)}${author ? ' da ' + esc(author) : ''}</div>${sections || '<p>Nessun commento.</p>'}</body></html>`;
}
