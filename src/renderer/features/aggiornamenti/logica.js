// Logica pura dell'area «aggiornamenti» (niente DOM): coperta da test/aggiornamenti.test.js.

/** Confronto di versioni semver (1.2.10 > 1.2.9; 1.0.0-beta.1 < 1.0.0). → -1 | 0 | 1 (0 se illeggibili). */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
    return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i] ? 1 : -1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p > +q ? 1 : -1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/**
 * Riassunto leggibile del corpo di una release GitHub (markdown): toglie titoli, collegamenti,
 * grassetti, nomi utente e URL delle note automatiche. → { righe: string[], altro: boolean }
 */
export function riassuntoNote(md, max = 4) {
  const righe = [];
  for (let raw of String(md || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    let r = raw.trim();
    if (!r || /^#{1,6}\s/.test(r) || /^(-{3,}|\*{3,}|_{3,})$/.test(r)) continue;     // vuote, titoli, separatori
    r = r.replace(/^[-*+]\s+|^\d+[.)]\s+/, '');                                      // elenchi
    if (/^\*{0,2}(full changelog|elenco completo|new contributors)/i.test(r)) continue;
    if (/^@\S+ made their first contribution/i.test(r)) continue;
    r = r.replace(/\s+by @[\w-]+ in https?:\/\/\S+$/i, '');                          // «by @utente in URL» delle note automatiche
    r = r.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                                      // immagini
    r = r.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                                   // collegamenti → testo
    r = r.replace(/<[^>]+>/g, '');                                                   // HTML
    r = r.replace(/https?:\/\/\S+/g, '');                                            // URL nudi
    r = r.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, '$1$2').replace(/`([^`]*)`/g, '$1');
    r = r.replace(/^>\s*/, '').replace(/\s{2,}/g, ' ').trim();
    if (r) righe.push(r);
  }
  return { righe: righe.slice(0, max), altro: righe.length > max };
}

/** «Più tardi» vale per quella versione fino alla scadenza. */
export function rimandato(stato, versione, ora = Date.now()) {
  return !!(stato && stato.versione === versione && Number(stato.fino) > ora);
}
export const TRE_GIORNI = 3 * 24 * 60 * 60 * 1000;

/**
 * Voci di «Novità di questa versione» da mostrare: quelle con versione > ultimaVista e ≤ attuale,
 * dalla più recente. Prima installazione (ultimaVista assente) → nessuna.
 */
export function novitaDaMostrare(elenco, ultimaVista, attuale) {
  if (!ultimaVista || !attuale || compareVersions(attuale, ultimaVista) <= 0) return [];
  return (elenco || [])
    .filter((n) => compareVersions(n.versione, ultimaVista) > 0 && compareVersions(n.versione, attuale) <= 0)
    .sort((a, b) => compareVersions(b.versione, a.versione));
}
