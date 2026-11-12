// «Prepara per PEC»: calcoli puri su dimensioni e suddivisione degli invii.
// Gli allegati di posta viaggiano codificati in base64: pesano circa 4/3 (un terzo in più) rispetto al file.
// Il valore esatto dipende dal gestore (intestazioni, a capo ogni 76 caratteri): per prudenza usiamo 1,37.

export const BASE64_OVERHEAD = 1.37;
export const MARGINE_MESSAGGIO = 150 * 1000; // testo del messaggio, intestazioni, daticert ecc. (stima prudente)

/** Byte di allegati che stanno in un messaggio con limite «limitMB» (megabyte decimali, come i gestori). */
export function payloadLimit(limitMB, overhead = BASE64_OVERHEAD) {
  const total = Math.max(0, Number(limitMB) || 0) * 1e6;
  return Math.max(0, Math.floor((total - MARGINE_MESSAGGIO) / overhead));
}

/**
 * Divide i file in invii (first-fit decrescente). sizes: [byte]. limit: byte per invio.
 * → { sends: [[indici]], tooBig: [indici] } — i file più grandi del limite da soli finiscono in tooBig.
 */
export function planSends(sizes, limit) {
  const order = sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
  const sends = []; const room = []; const tooBig = [];
  for (const [s, i] of order) {
    if (s > limit) { tooBig.push(i); continue; }
    let k = room.findIndex((r) => r >= s);
    if (k < 0) { sends.push([]); room.push(limit); k = sends.length - 1; }
    sends[k].push(i); room[k] -= s;
  }
  for (const s of sends) s.sort((a, b) => a - b);
  return { sends, tooBig: tooBig.sort((a, b) => a - b) };
}

/** Numero minimo teorico di invii (per il messaggio all'utente). */
export function minSends(total, limit) { return limit > 0 ? Math.max(1, Math.ceil(total / limit)) : Infinity; }
