// Indicatore semplice della robustezza di una password, senza librerie: lunghezza «utile» (le ripetizioni,
// le sequenze come «1234» o «qwerty» e le parole troppo comuni contano poco) per la varietà dei caratteri.
// Non è una garanzia: serve solo a scoraggiare le password ovvie e a consigliare una frase lunga.

const COMUNI = [
  'password', 'passw0rd', 'qwerty', 'azerty', 'asdfgh', 'zxcvbn', 'iloveyou', 'letmein', 'welcome', 'admin', 'login',
  'leggio', 'ciao', 'amore', 'tiamo', 'segreto', 'cambiami', 'firma', 'archivio', 'computer', 'ufficio', 'comune',
  'juventus', 'milan', 'inter', 'napoli', 'roma', 'lazio', 'italia', 'francesco', 'giuseppe', 'maria', 'mario',
  'estate', 'inverno', 'natale', 'calcio', 'dragon', 'monkey', 'sunshine', 'princess', 'football',
];
const SEQUENZE = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertzuiop'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

/** a→b è un passo di una sequenza nota? → nome della sequenza con il verso, oppure null */
function passo(a, b) {
  for (const s of SEQUENZE) {
    const x = s.indexOf(a);
    if (x < 0) continue;
    if (s[x + 1] === b) return s + '+';
    if (x > 0 && s[x - 1] === b) return s + '-';
  }
  return null;
}
/** Quante «lettere utili» ci sono: ogni ripetizione, sequenza o parola comune vale come un solo carattere. */
function lunghezzaUtile(pw) {
  const norm = Array.from(pw.toLowerCase(), (c) => LEET[c] || c).join('');
  const conta = new Array(norm.length).fill(1);
  const spegni = (da, a) => { for (let i = da + 1; i < a; i++) conta[i] = 0; };
  for (const w of COMUNI) { let i = norm.indexOf(w); while (i >= 0) { spegni(i, i + w.length); i = norm.indexOf(w, i + 1); } }
  for (let i = 0; i < norm.length;) {
    // stesso carattere ripetuto (aaaa) o sequenza (1234, abcd, qwer, anche al contrario)
    let j = i + 1;
    while (j < norm.length && norm[j] === norm[i]) j++;
    if (j - i >= 3) { spegni(i, j); i = j; continue; }
    let k = i + 1;
    const dir = k < norm.length ? passo(norm[i], norm[k]) : null;
    if (dir) while (k < norm.length && passo(norm[k - 1], norm[k]) === dir) k++;
    if (k - i >= 3) { spegni(i, k); i = k; continue; }
    i++;
  }
  return conta.reduce((s, x) => s + x, 0);
}

function varieta(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 26;
  if (/[A-Z]/.test(pw)) n += 26;
  if (/[0-9]/.test(pw)) n += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) n += 33;
  return Math.max(n, 10);
}

/**
 * → { livello: 0..4, etichetta, consiglio, bit }
 *   0 troppo corta · 1 debole · 2 discreta · 3 buona · 4 ottima
 */
export function robustezzaPassword(pw, { minimo = 8 } = {}) {
  pw = String(pw || '');
  if (!pw) return { livello: 0, etichetta: '', consiglio: '', bit: 0 };
  if (Array.from(pw).length < minimo) return { livello: 0, etichetta: 'Troppo corta', consiglio: `Servono almeno ${minimo} caratteri.`, bit: 0 };
  const bit = Math.round(lunghezzaUtile(pw) * Math.log2(varieta(pw)));
  const consiglio = 'Una frase di quattro o cinque parole che ricordi facilmente è più sicura di una parola complicata.';
  if (bit < 36) return { livello: 1, etichetta: 'Debole', consiglio: 'Facile da indovinare. ' + consiglio, bit };
  if (bit < 55) return { livello: 2, etichetta: 'Discreta', consiglio: 'Più lunga sarebbe meglio. ' + consiglio, bit };
  if (bit < 75) return { livello: 3, etichetta: 'Buona', consiglio: '', bit };
  return { livello: 4, etichetta: 'Ottima', consiglio: '', bit };
}
