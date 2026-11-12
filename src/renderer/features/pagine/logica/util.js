// Utilità pure (nessun DOM) condivise dalle operazioni sulle pagine.

/** Formati carta in punti tipografici (1 pt = 1/72 di pollice). Verticali. */
export const FORMATI = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};
export const FORMATI_ETICHETTE = [
  ['A4', 'A4 (210 × 297 mm)'],
  ['A3', 'A3 (297 × 420 mm)'],
  ['A5', 'A5 (148 × 210 mm)'],
  ['Letter', 'Lettera USA (8,5 × 11 in)'],
  ['Legal', 'Legale USA (8,5 × 14 in)'],
];

export const mmToPt = (mm) => (mm / 25.4) * 72;
export const ptToMm = (pt) => (pt / 72) * 25.4;

/** Cede il controllo al ciclo degli eventi (l'interfaccia resta reattiva sulle operazioni lunghe). */
export const cedi = () => new Promise((r) => {
  // MessageChannel non viene rallentato come setTimeout quando la finestra è in secondo piano
  if (typeof MessageChannel === 'undefined') { setTimeout(r, 0); return; }
  const c = new MessageChannel();
  c.port1.onmessage = () => { c.port1.close(); r(); };
  c.port2.postMessage(0);
});

/**
 * Esegue fn(i) per i = 0..n-1 cedendo il controllo ogni `blocco` iterazioni.
 * opts: { onProgress(frac), signal (AbortSignal), blocco }
 */
export async function aBlocchi(n, fn, { onProgress, signal, blocco = 25 } = {}) {
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw annullato();
    await fn(i);
    if ((i + 1) % blocco === 0) { onProgress?.((i + 1) / n); await cedi(); }
  }
  onProgress?.(1);
}

export function annullato() { const e = new Error('Operazione annullata'); e.name = 'AbortError'; return e; }

/** Errore pensato per essere mostrato all'utente così com'è. */
export class ErroreUtente extends Error { constructor(msg) { super(msg); this.name = 'ErroreUtente'; } }

/** Indici 0-based validi, unici e ordinati; lancia ErroreUtente se vuoti o fuori intervallo. */
export function validaIndici(indici, pageCount, { almenoUno = true } = {}) {
  if (!Array.isArray(indici)) throw new ErroreUtente('Nessuna pagina indicata.');
  const out = [...new Set(indici)].sort((a, b) => a - b);
  for (const i of out) if (!Number.isInteger(i) || i < 0 || i >= pageCount) throw new ErroreUtente(`La pagina ${i + 1} non esiste (il documento ha ${pageCount} pagine).`);
  if (almenoUno && !out.length) throw new ErroreUtente('Seleziona almeno una pagina.');
  return out;
}

/** Converte "1-3, 5, 8-" (anche "pari", "dispari") in indici 0-based ordinati. Vuoto = tutte. */
export function intervalli(str, pageCount) {
  const s = (str || '').trim();
  if (!s) return [...Array(pageCount).keys()];
  const out = new Set();
  for (const part of s.split(/[,;]+/)) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    if (p === 'pari' || p === 'even') { for (let i = 1; i < pageCount; i += 2) out.add(i); continue; }
    if (p === 'dispari' || p === 'odd') { for (let i = 0; i < pageCount; i += 2) out.add(i); continue; }
    if (p === 'tutte' || p === 'all') { for (let i = 0; i < pageCount; i++) out.add(i); continue; }
    if (p === 'ultima' || p === 'last') { out.add(pageCount - 1); continue; }
    const m = p.match(/^(\d*)\s*[-–]\s*(\d*)$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : pageCount;
      if (a < 1 || b > pageCount || a > b) throw new ErroreUtente(`Intervallo non valido: «${part.trim()}» (il documento ha ${pageCount} pagine).`);
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n < 1 || n > pageCount) throw new ErroreUtente(`La pagina ${n} non esiste (il documento ha ${pageCount} pagine).`);
      out.add(n - 1);
    } else throw new ErroreUtente(`Non capisco «${part.trim()}». Scrivi per esempio: 1-3, 5, 8-`);
  }
  return [...out].sort((a, b) => a - b);
}

/** Gruppi di intervalli separati da virgola: "1-3, 4-6, 7" → [[0,1,2],[3,4,5],[6]] (ordine conservato). */
export function gruppiIntervalli(str, pageCount) {
  const parti = (str || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  if (!parti.length) throw new ErroreUtente('Scrivi almeno un intervallo, per esempio: 1-3, 4-10');
  return parti.map((p) => intervalli(p, pageCount));
}

/** Indici 0-based → testo compatto "1-3, 5". */
export function indiciInTesto(indici) {
  const s = [...new Set(indici)].sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < s.length; k++) {
    let j = k; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > k ? `${s[k] + 1}-${s[j] + 1}` : String(s[k] + 1));
    k = j;
  }
  return out.join(', ');
}

// Caratteri disponibili nei font standard (WinAnsiEncoding) oltre all'ASCII.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const SOSTITUZIONI = { '−': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '≠': '!=', '™': '™' };

/** Rende il testo stampabile con i font standard: sostituisce i caratteri non rappresentabili. */
export function testoWinAnsi(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c === 9) { out += '    '; continue; }
    if (c < 32) continue;
    if (c < 127 || (c >= 160 && c <= 255) || WIN_ANSI_EXTRA.includes(ch)) { out += ch; continue; }
    if (SOSTITUZIONI[ch]) { out += SOSTITUZIONI[ch]; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && base.codePointAt(0) < 256 ? base : '?';
  }
  return out;
}

export function numeroRomano(n) {
  if (n <= 0 || n >= 4000) return String(n);
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}
export function numeroLettere(n) {
  // stile PDF: a..z, aa..zz, aaa..
  if (n <= 0) return String(n);
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

/** Tipo immagine dai primi byte. → 'jpg' | 'png' | 'gif' | 'webp' | 'bmp' | null */
export function tipoImmagine(bytes) {
  const b = bytes;
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return null;
}

/** È un PDF? (cerca %PDF- nei primi 1024 byte, come fanno i lettori) */
export function sembraPdf(bytes) {
  if (!bytes || bytes.length < 8) return false;
  const n = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i < n; i++) if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  return false;
}

/** Orientamento EXIF di un JPEG (1..8), 1 se assente. */
export function orientamentoJpeg(b) {
  if (!b || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) return 1;
    const marker = b[o + 1];
    const len = (b[o + 2] << 8) | b[o + 3];
    if (marker === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) {
      const t = o + 10; // inizio intestazione TIFF
      const le = b[t] === 0x49;
      const u16 = (p) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
      const u32 = (p) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) return 1;
        if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
      }
      return 1;
    }
    if (marker === 0xda || marker === 0xd9) return 1;
    o += 2 + len;
  }
  return 1;
}

/** Nome file sicuro (senza caratteri vietati su Windows/macOS). */
export function nomeFileSicuro(s, ripiego = 'documento') {
  const t = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
  return t || ripiego;
}
export function senzaEstensione(nome) { return String(nome || 'documento').replace(/\.[a-z0-9]{2,5}$/i, ''); }

/**
 * pdf-lib cede il controllo ogni 50 oggetti (setTimeout): nel browser questo moltiplica i tempi
 * per 10 (1200 pagine: 3,5 s invece di 0,3 s). Con blocchi più grandi l'interfaccia resta reattiva
 * (pause massime misurate ~170 ms) e le operazioni sono molto più rapide.
 */
export const LETTURA = { parseSpeed: 1500, updateMetadata: false };
export const SCRITTURA = { useObjectStreams: true, objectsPerTick: 1500 };
export const salva = (doc) => doc.save(SCRITTURA);
