// Verifica dopo la riscrittura: il resto del testo della pagina deve essere rimasto identico.
// Puro: confronta gli item di getTextContent di pdf.js prima e dopo.


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

/**
 * Caratteri (senza spazi) del testo fuori dalle zone escluse, ordinati: confronto insensibile all'ordine e a come
 * pdf.js spezza gli item. La posizione di ogni carattere è stimata dividendo la larghezza dell'item in parti uguali;
 * il margine (in frazioni della dimensione del carattere) assorbe l'imprecisione della stima.
 */
export function textOutside(items, exclude, { marginFs = 0.6 } = {}) {
  const chars = [];
  for (const it of items || []) {
    if (!it || typeof it.str !== 'string' || !it.transform) continue;
    const str = [...it.str];
    if (!str.some((c) => c.trim())) continue;
    const [a, b, c, d, e, f] = it.transform;
    const fs = Math.hypot(c, d) || it.height || 1;
    const ang = Math.atan2(b, a);
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const w = it.width || 0;
    const m = marginFs * fs;
    str.forEach((ch, k) => {
      if (!ch.trim()) return;
      const t = ((k + 0.5) / str.length) * w;
      const x = e + t * cs - 0.35 * fs * sn, y = f + t * sn + 0.35 * fs * cs;
      if (exclude.some((z) => x >= z[0] - m && x <= z[2] + m && y >= z[1] - m && y <= z[3] + m)) return;
      chars.push(ch);
    });
  }
  return chars.sort().join('');
}

/**
 * Confronta il testo prima/dopo fuori dalle zone modificate.
 * @returns {{ ok:boolean, missing:string, added:string }}
 */
export function compareOutside(beforeItems, afterItems, exclude, { margin = 2 } = {}) {
  const zones = exclude.filter(Boolean).map((z) => [Math.min(z[0], z[2]) - margin, Math.min(z[1], z[3]) - margin, Math.max(z[0], z[2]) + margin, Math.max(z[1], z[3]) + margin]);
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
