// Area «commenti» — «Esporta/importa solo i commenti» nel formato standard XFDF (XML di Adobe).
// Logica pura: niente DOM (in node non c'è DOMParser), parser XML minimale incluso.
import { rgbToHex, hexToRgb, normRect, pairs, r2, newName } from './geom.js';

const TAGS = { Text: 'text', FreeText: 'freetext', Line: 'line', Square: 'square', Circle: 'circle', Polygon: 'polygon', PolyLine: 'polyline', Highlight: 'highlight', Underline: 'underline', Squiggly: 'squiggly', StrikeOut: 'strikeout', Stamp: 'stamp', Caret: 'caret', Ink: 'ink' };
const FROM_TAG = Object.fromEntries(Object.entries(TAGS).map(([k, v]) => [v, k]));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const num = (v) => r2(v);

/** Nome stabile per ogni annotazione (usa /NM se c'è). */
function nameFor(a) { return a.nm || `leggio-${String(a.key).replace(/[^\w-]/g, '_')}`; }

/** list: annotazioni da readAllAnnotations. → stringa XFDF */
export function toXfdf(list, { fileName = 'documento.pdf' } = {}) {
  const names = new Map(list.map((a) => [a.key, nameFor(a)]));
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve">', '<annots>'];
  for (const a of list) {
    const tag = TAGS[a.type];
    if (!tag || !a.rect) continue;
    const at = { page: a.pageIndex, rect: a.rect.map(num).join(','), name: names.get(a.key), title: a.author, subject: a.subject || undefined, date: a.modDate || undefined, creationdate: a.creationDate || undefined, flags: flagsText(a.flags) };
    const c = rgbToHex(a.color, false); if (c) at.color = c.toUpperCase();
    const ic = rgbToHex(a.interior, false); if (ic) at['interior-color'] = ic.toUpperCase();
    if (a.opacity != null && a.opacity < 1) at.opacity = num(a.opacity);
    if (['Square', 'Circle', 'Polygon', 'PolyLine', 'Line', 'Ink', 'FreeText'].includes(a.type)) at.width = num(a.width ?? 1);
    if (a.dash) { at.style = 'dash'; at.dashes = a.dash.map(num).join(','); }
    if (a.cloud) { at.style = 'cloudy'; at.intensity = num(a.cloud); }
    if (a.irt && names.has(a.irt)) { at.inreplyto = names.get(a.irt); if (a.replyType === 'Group') at.replyType = 'group'; }
    if (a.state) { at.state = a.state; at.statemodel = a.stateModel || 'Review'; }
    if (a.icon) at.icon = a.icon;
    if (a.intent) at.intent = a.intent;
    if (a.quadPoints) at.coords = a.quadPoints.map(num).join(',');
    if (a.type === 'Line' && a.line) { at.start = `${num(a.line[0])},${num(a.line[1])}`; at.end = `${num(a.line[2])},${num(a.line[3])}`; }
    if (a.lineEnding) { at.head = a.lineEnding[0]; at.tail = a.lineEnding[1]; }
    if (a.type === 'FreeText') { at.justification = ['left', 'centered', 'right'][a.align || 0]; }
    const attrs = Object.entries(at).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const kids = [];
    if (a.text) kids.push(`<contents>${esc(a.text)}</contents>`);
    if (a.type === 'FreeText') { const tc = a.textColor || [0, 0, 0]; kids.push(`<defaultappearance>${esc(`/Helv ${num(a.fontSize || 12)} Tf ${tc.map(num).join(' ')} rg`)}</defaultappearance>`); }
    if (a.vertices) kids.push(`<vertices>${a.vertices.map((p) => `${num(p[0])},${num(p[1])}`).join(';')}</vertices>`);
    if (a.inkList) kids.push(`<inklist>${a.inkList.map((s) => `<gesture>${s.map((p) => `${num(p[0])},${num(p[1])}`).join(';')}</gesture>`).join('')}</inklist>`);
    out.push(kids.length ? `<${tag}${attrs}>${kids.join('')}</${tag}>` : `<${tag}${attrs}/>`);
  }
  out.push('</annots>', `<f href="${esc(fileName)}"/>`, '</xfdf>');
  return out.join('\n');
}
function flagsText(f) {
  if (!f) return undefined;
  const names = [[1, 'invisible'], [2, 'hidden'], [4, 'print'], [8, 'nozoom'], [16, 'norotate'], [32, 'noview'], [64, 'readonly'], [128, 'locked']];
  return names.filter(([b]) => f & b).map(([, n]) => n).join(',') || undefined;
}

// ---------------------------------------------------------------- parser XML minimale
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return ''; } }
    return ENT[e] ?? m;
  });
}
/** → albero { name, attrs, children:[nodo|stringa] }. Lancia Error leggibile se l'XML è rotto. */
export function parseXml(xml) {
  const src = String(xml ?? '');
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const err = (m) => { throw new Error(`Il file dei commenti non è valido (${m}).`); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { const t = src.slice(i); if (t.trim()) stack[stack.length - 1].children.push(decodeEntities(t)); break; }
    if (lt > i) { const t = src.slice(i, lt); if (t.trim() || stack.length > 1) stack[stack.length - 1].children.push(decodeEntities(t)); }
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); if (e < 0) err('commento non chiuso'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); if (e < 0) err('CDATA non chiuso'); stack[stack.length - 1].children.push(src.slice(lt + 9, e)); i = e + 3; continue; }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); if (e < 0) err('dichiarazione non chiusa'); i = e + 1; continue; }
    const gt = findTagEnd(src, lt);
    if (gt < 0) err('tag non chiuso');
    const body = src.slice(lt + 1, gt);
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name || !stack.length) err(`chiusura inattesa di <${name}>`);
    } else {
      const selfClose = body.endsWith('/');
      const m = /^([^\s/>]+)/.exec(body);
      if (!m) err('tag senza nome');
      const node = { name: m[1].replace(/^[\w-]+:/, ''), attrs: {}, children: [] };
      const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let am;
      while ((am = re.exec(body.slice(m[1].length)))) node.attrs[am[1].replace(/^[\w-]+:(?!space)/, '')] = decodeEntities(am[3] ?? am[4] ?? '');
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    i = gt + 1;
  }
  if (stack.length !== 1) err(`<${stack[stack.length - 1].name}> non chiuso`);
  return root;
}
function findTagEnd(s, from) {
  let q = null;
  for (let i = from + 1; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return i;
  }
  return -1;
}
const kids = (n, name) => n.children.filter((c) => typeof c === 'object' && (!name || c.name === name));
const text = (n) => (n ? n.children.map((c) => (typeof c === 'string' ? c : text(c))).join('') : '');
const nums = (s) => String(s || '').split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite);

/**
 * XFDF → [{ pageIndex, name, irtName, spec }] pronte per createAnnot (le risposte dopo i genitori).
 * warnings raccoglie gli elementi saltati.
 */
export function fromXfdf(xml, { pageCount = Infinity, warnings = [] } = {}) {
  const root = parseXml(xml);
  const x = kids(root).find((n) => n.name === 'xfdf');
  if (!x) throw new Error('Il file non contiene commenti XFDF (manca l\'elemento <xfdf>).');
  const annots = kids(x, 'annots')[0];
  if (!annots) return [];
  const out = [];
  for (const n of kids(annots)) {
    const type = FROM_TAG[n.name.toLowerCase()];
    if (!type) { warnings.push(`Tipo «${n.name}» non supportato, saltato`); continue; }
    const a = n.attrs;
    const pageIndex = parseInt(a.page, 10);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) { warnings.push(`Commento su una pagina inesistente (${a.page}), saltato`); continue; }
    const spec = { type, rect: normRect(nums(a.rect)) };
    if (a.color) spec.color = hexToRgb(a.color, null);
    if (a['interior-color']) spec.interior = hexToRgb(a['interior-color'], null);
    if (a.opacity) { const o = Number(a.opacity); if (o > 0 && o <= 1) spec.opacity = o; }
    if (a.width) { const w = Number(a.width); if (w >= 0 && w < 100) spec.width = w; }
    if (a.style === 'dash') spec.dash = nums(a.dashes).length ? nums(a.dashes) : [3];
    if (a.style === 'cloudy') spec.cloud = Number(a.intensity) || 1;
    if (a.icon) spec.icon = a.icon;
    if (a.subject) spec.subject = a.subject;
    if (a.intent) spec.intent = a.intent;
    if (a.state) { spec.state = a.state; spec.stateModel = a.statemodel || 'Review'; }
    const contents = kids(n, 'contents')[0];
    spec.text = contents ? text(contents) : (a.contents || '');
    if (a.coords) { const q = nums(a.coords); if (q.length >= 8) spec.quadPoints = q.slice(0, q.length - (q.length % 8)); }
    if (type === 'Line') { const s = nums(a.start), e = nums(a.end); if (s.length === 2 && e.length === 2) spec.line = [...s, ...e]; spec.lineEnding = [a.head || 'None', a.tail || 'None']; }
    if (type === 'PolyLine' && (a.head || a.tail)) spec.lineEnding = [a.head || 'None', a.tail || 'None'];
    const v = kids(n, 'vertices')[0]; if (v) spec.vertices = pairs(nums(text(v)));
    const ink = kids(n, 'inklist')[0]; if (ink) spec.inkList = kids(ink, 'gesture').map((g) => pairs(nums(text(g)))).filter((s) => s.length);
    if (type === 'FreeText') {
      const da = text(kids(n, 'defaultappearance')[0]);
      const tf = /([\d.]+)\s+Tf/.exec(da); spec.fontSize = tf ? Math.min(144, Math.max(4, +tf[1])) : 12;
      const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da); spec.textColor = rg ? [+rg[1], +rg[2], +rg[3]] : [0, 0, 0];
      spec.align = { centered: 1, right: 2 }[a.justification] || 0;
      spec.borderWidth = spec.width ?? (spec.color ? 1 : 0);
    }
    if (type === 'Text' && a.inreplyto) spec.reply = true;
    // validazione geometria
    const need = { Highlight: 'quadPoints', Underline: 'quadPoints', StrikeOut: 'quadPoints', Squiggly: 'quadPoints', Line: 'line', Polygon: 'vertices', PolyLine: 'vertices', Ink: 'inkList' }[type];
    if (need && !(spec[need] && spec[need].length)) {
      if (['Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(type) && spec.rect) { const [x1, y1, x2, y2] = spec.rect; spec.quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1]; }
      else { warnings.push(`${n.name}: geometria mancante, saltato`); continue; }
    }
    if (!spec.rect && !need) { warnings.push(`${n.name}: posizione mancante, saltato`); continue; }
    out.push({ pageIndex, name: a.name || newName(), irtName: a.inreplyto || null, author: a.title || '', spec });
  }
  // genitori prima delle risposte
  const byName = new Map(out.map((o) => [o.name, o]));
  const depth = (o, seen = new Set()) => { if (!o.irtName || seen.has(o.name)) return 0; seen.add(o.name); const p = byName.get(o.irtName); return p ? 1 + depth(p, seen) : 0; };
  return out.map((o, i) => ({ o, i, d: depth(o) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.o);
}
