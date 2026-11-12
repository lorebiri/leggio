// Verifica dopo la riscrittura: il resto del testo della pagina deve essere rimasto identico.
// Puro: confronta gli item di getTextContent di pdf.js prima e dopo.

const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Rettangolo approssimato (spazio pagina) di un item di pdf.js. */
export function itemRect(it) {
  const [a, b, c, d, e, f] = it.transform;
  const fs = Math.hypot(c, d) || it.height || 1;
  const w = it.width || 0;
  const ang = Math.atan2(b, a);
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const pts = [[e, f], [e + w * cs, f + w * sn], [e - 0.8 * fs * sn, f + 0.8 * fs * cs], [e + w * cs - 0.8 * fs * sn, f + w * sn + 0.8 * fs * cs], [e + 0.2 * fs * sn, f - 0.2 * fs * cs]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Caratteri (senza spazi) del testo fuori dalle zone escluse, ordinati: confronto insensibile all'ordine degli item. */
export function textOutside(items, exclude) {
  const chars = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string' || !it.transform) continue;
    const s = it.str.replace(/\s+/g, '');
    if (!s) continue;
    const r = itemRect(it);
    // un item lungo che tocca appena la zona viene escluso del tutto (prudenza: confronto più debole ma senza falsi allarmi)
    if (exclude.some((z) => intersects(r, z))) continue;
    for (const ch of s) chars.push(ch);
  }
  return chars.sort().join('');
}

/**
 * Confronta il testo prima/dopo fuori dalle zone modificate.
 * @returns {{ ok:boolean, missing:string, added:string }}
 */
export function compareOutside(beforeItems, afterItems, exclude, { margin = 2 } = {}) {
  const zones = exclude.map((z) => [z[0] - margin, z[1] - margin, z[2] + margin, z[3] + margin]);
  // un item escluso "dopo" ma non "prima" (o viceversa) falserebbe il confronto: si escludono in entrambi
  // tutti gli item che toccano una zona, prima e dopo.
  const a = textOutside(beforeItems, zones);
  const b = textOutside(afterItems, zones);
  if (a === b) return { ok: true, missing: '', added: '' };
  return { ok: false, ...charDiff(a, b) };
}

function charDiff(a, b) {
  const count = (s) => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) || 0) + 1); return m; };
  const ca = count(a), cb = count(b);
  let missing = '', added = '';
  for (const [c, n] of ca) { const d = n - (cb.get(c) || 0); if (d > 0) missing += c.repeat(Math.min(d, 5)); }
  for (const [c, n] of cb) { const d = n - (ca.get(c) || 0); if (d > 0) added += c.repeat(Math.min(d, 5)); }
  return { missing: missing.slice(0, 40), added: added.slice(0, 40) };
}

/** Il testo atteso compare nella pagina (ignorando spazi e a capo)? */
export function containsText(items, expected) {
  const all = (items || []).map((it) => it.str || '').join('').replace(/\s+/g, '');
  const exp = String(expected || '').replace(/\s+/g, '');
  return !exp || all.includes(exp);
}
