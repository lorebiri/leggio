// Confronto di sequenze di parole (logica pura): ancore "patience" + Myers sui tratti rimanenti.
// Regge documenti lunghi: memoria limitata (Myers con tetto sulle differenze per blocco),
// nessuna ricorsione profonda (pila esplicita).

const MAX_D = 2000; // oltre questo numero di differenze in un blocco: blocco sostituito in blocco

/** Divide un testo in parole (conserva la punteggiatura attaccata). */
export function parole(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

/** Normalizza una parola per il confronto. opts: { ignoraMaiuscole, ignoraPunteggiatura } */
export function normalizza(w, opts = {}) {
  let s = String(w).normalize('NFC');
  s = s.replace(/[‘’`´]/g, "'").replace(/[“”«»„]/g, '"').replace(/[‐‑‒–—]/g, '-');
  if (opts.ignoraPunteggiatura) s = s.replace(/[.,;:!?"'()[\]{}…]/g, '');
  if (opts.ignoraMaiuscole) s = s.toLowerCase();
  return s;
}

/** Myers O(ND) su a[a0..a1) e b[b0..b1). Restituisce ops o null se D supera il tetto. */
function myers(a, b, a0, a1, b0, b1, maxD) {
  const N = a1 - a0; const M = b1 - b0;
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  const V = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    // salva solo la porzione utile di V (k da -d a d)
    trace.push(V.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) x = V[off + k + 1];
      else x = V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[a0 + x] === b[b0 + y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // ricostruzione all'indietro
  const steps = [];
  let x = N; let y = M;
  for (let d = found; d > 0; d--) {
    const Vd = trace[d]; // V prima del passo d, porzione k ∈ [-d-1, d+1]
    const get = (k) => Vd[k + d + 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && get(k - 1) < get(k + 1))) prevK = k + 1; else prevK = k - 1;
    const prevX = get(prevK); const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { steps.push(['=', a0 + x - 1, b0 + y - 1]); x--; y--; }
    if (x === prevX) { steps.push(['+', -1, b0 + y - 1]); y--; } else { steps.push(['-', a0 + x - 1, -1]); x--; }
  }
  while (x > 0 && y > 0) { steps.push(['=', a0 + x - 1, b0 + y - 1]); x--; y--; }
  steps.reverse();
  return steps;
}

/** Ancore patience: parole uniche in entrambi i tratti, sottosequenza crescente più lunga. */
function patienceAnchors(a, b, a0, a1, b0, b1) {
  const ca = new Map(); const cb = new Map();
  for (let i = a0; i < a1; i++) { const e = ca.get(a[i]); if (e) e.n++; else ca.set(a[i], { n: 1, i }); }
  for (let j = b0; j < b1; j++) { const e = cb.get(b[j]); if (e) e.n++; else cb.set(b[j], { n: 1, j }); }
  const pairs = [];
  for (const [w, ea] of ca) { if (ea.n !== 1) continue; const eb = cb.get(w); if (eb && eb.n === 1) pairs.push([ea.i, eb.j]); }
  if (!pairs.length) return [];
  pairs.sort((p, q) => p[0] - q[0]);
  // LIS su j (patience sorting)
  const tails = []; const prev = new Int32Array(pairs.length).fill(-1); const tailIdx = [];
  for (let k = 0; k < pairs.length; k++) {
    const j = pairs[k][1];
    let lo = 0; let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < j) lo = mid + 1; else hi = mid; }
    tails[lo] = j; tailIdx[lo] = k; prev[k] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const out = [];
  for (let k = tailIdx[tails.length - 1]; k >= 0; k = prev[k]) out.push(pairs[k]);
  return out.reverse();
}

/**
 * Confronta due array di stringhe (già normalizzate).
 * → array di passi compatti: { op: '='|'-'|'+', a0, a1, b0, b1 } (intervalli semiaperti).
 */
export function diffSequenze(a, b, { maxD = MAX_D } = {}) {
  const raw = []; // passi elementari raggruppati: [op, aStart, aEnd, bStart, bEnd]
  const push = (op, as, ae, bs, be) => {
    if (ae - as <= 0 && be - bs <= 0) return;
    raw.push([op, as, ae, bs, be]);
  };
  // pila di lavori: tratti da confrontare, elaborati in ordine
  const stack = [[0, a.length, 0, b.length]];
  while (stack.length) {
    const job = stack.pop();
    if (job.emit) { push(...job.emit); continue; }
    let [a0, a1, b0, b1] = job;
    // prefisso e suffisso comuni
    let p = 0;
    while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p]) p++;
    let s = 0;
    while (a1 - s - 1 >= a0 + p && b1 - s - 1 >= b0 + p && a[a1 - s - 1] === b[b1 - s - 1]) s++;
    const tasks = [];
    if (p) tasks.push({ emit: ['=', a0, a0 + p, b0, b0 + p] });
    const ma0 = a0 + p; const ma1 = a1 - s; const mb0 = b0 + p; const mb1 = b1 - s;
    if (ma0 === ma1 || mb0 === mb1) {
      if (ma1 > ma0) tasks.push({ emit: ['-', ma0, ma1, mb0, mb0] });
      if (mb1 > mb0) tasks.push({ emit: ['+', ma1, ma1, mb0, mb1] });
    } else {
      const anchors = patienceAnchors(a, b, ma0, ma1, mb0, mb1);
      if (anchors.length) {
        let pa = ma0; let pb = mb0;
        for (const [i, j] of anchors) {
          tasks.push([pa, i, pb, j]);
          tasks.push({ emit: ['=', i, i + 1, j, j + 1] });
          pa = i + 1; pb = j + 1;
        }
        tasks.push([pa, ma1, pb, mb1]);
      } else {
        const steps = myers(a, b, ma0, ma1, mb0, mb1, maxD);
        if (steps) {
          for (const [op, i, j] of steps) {
            if (op === '=') tasks.push({ emit: ['=', i, i + 1, j, j + 1] });
            else if (op === '-') tasks.push({ emit: ['-', i, i + 1, 0, 0] });
            else tasks.push({ emit: ['+', 0, 0, j, j + 1] });
          }
        } else {
          tasks.push({ emit: ['-', ma0, ma1, mb0, mb0] });
          tasks.push({ emit: ['+', ma1, ma1, mb0, mb1] });
        }
      }
    }
    if (s) tasks.push({ emit: ['=', a1 - s, a1, b1 - s, b1] });
    for (let k = tasks.length - 1; k >= 0; k--) stack.push(tasks[k]);
  }
  // normalizza le posizioni dei passi '-' e '+' (b0/a0 coerenti con la sequenza)
  const out = [];
  let ia = 0; let ib = 0;
  for (const [op, as, ae, bs, be] of raw) {
    if (op === '=') { out.push({ op, a0: as, a1: ae, b0: bs, b1: be }); ia = ae; ib = be; }
    else if (op === '-') { out.push({ op, a0: as, a1: ae, b0: ib, b1: ib }); ia = ae; }
    else { out.push({ op, a0: ia, a1: ia, b0: bs, b1: be }); ib = be; }
  }
  return compatta(out);
}

function compatta(ops) {
  const out = [];
  for (const o of ops) {
    const last = out[out.length - 1];
    if (last && last.op === o.op && last.a1 === o.a0 && last.b1 === o.b0) { last.a1 = o.a1; last.b1 = o.b1; }
    else out.push({ ...o });
  }
  return out;
}

/**
 * Raggruppa i passi in modifiche leggibili: sostituzione, inserimento, eliminazione.
 * Unisce cancellazioni e inserimenti adiacenti (anche separati da una sola parola uguale e corta).
 * → [{ tipo:'sostituzione'|'inserimento'|'eliminazione', a0,a1,b0,b1 }]
 */
export function modifiche(ops, a = [], b = []) {
  const out = [];
  let cur = null;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.op === '=') {
      // una o due parole uguali tra due modifiche non spezzano la modifica ("30 giorni" → "60 giorni lavorativi")
      const next = ops[k + 1];
      const small = o.a1 - o.a0 <= 2 && cur && next && next.op !== '=';
      if (small) continue;
      if (cur) { out.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = { a0: o.a0, a1: o.a1, b0: o.b0, b1: o.b1 };
    else { cur.a1 = Math.max(cur.a1, o.a1); cur.b1 = Math.max(cur.b1, o.b1); }
  }
  if (cur) out.push(cur);
  for (const m of out) {
    const del = m.a1 > m.a0; const ins = m.b1 > m.b0;
    m.tipo = del && ins ? 'sostituzione' : del ? 'eliminazione' : 'inserimento';
  }
  return out;
}

/** Testo breve di una modifica, per il riepilogo. */
export function descriviModifica(m, wa, wb, max = 80) {
  const cut = (s) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
  const va = cut(wa.slice(m.a0, m.a1).join(' '));
  const vb = cut(wb.slice(m.b0, m.b1).join(' '));
  if (m.tipo === 'sostituzione') return `«${va}» → «${vb}»`;
  if (m.tipo === 'eliminazione') return `eliminato «${va}»`;
  return `aggiunto «${vb}»`;
}

/**
 * Confronto completo tra due documenti già divisi in parole.
 * docA/docB: [{ text, page, ... }] (una voce per parola). → { ops, modifiche, stats }
 */
export function confrontaParole(docA, docB, opts = {}) {
  const na = docA.map((w) => normalizza(w.text, opts));
  const nb = docB.map((w) => normalizza(w.text, opts));
  const ops = diffSequenze(na, nb, opts);
  const mods = modifiche(ops, na, nb);
  const stats = { sostituzioni: 0, inserimenti: 0, eliminazioni: 0, paroleA: na.length, paroleB: nb.length };
  for (const m of mods) {
    if (m.tipo === 'sostituzione') stats.sostituzioni++; else if (m.tipo === 'inserimento') stats.inserimenti++; else stats.eliminazioni++;
  }
  return { ops, modifiche: mods, stats };
}
