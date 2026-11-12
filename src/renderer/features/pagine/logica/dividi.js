// Divisione di un PDF in più file. Logica pura.
import { ErroreUtente, gruppiIntervalli, nomeFileSicuro, cedi, annullato } from './util.js';
import { estraiInNuovo } from './struttura.js';
import { leggiSegnalibri, scriviSegnalibri, rimappa } from './segnalibri.js';

/** Preimpostazioni per la dimensione massima (MB). La PEC va verificata col proprio gestore. */
export const PRESET_DIMENSIONE = [
  [5, 'Allegato PEC prudente (5 MB)'],
  [10, 'Email normale (10 MB)'],
  [20, 'Portale con limite 20 MB'],
];

/** Ogni n pagine. → gruppi di indici */
export function pianoOgni(nPagine, ogni) {
  ogni = Math.floor(ogni);
  if (!(ogni >= 1)) throw new ErroreUtente('Scrivi un numero di pagine da 1 in su.');
  const out = [];
  for (let i = 0; i < nPagine; i += ogni) out.push([...Array(Math.min(ogni, nPagine - i)).keys()].map((k) => i + k));
  return out;
}

/** Intervalli scritti dall'utente ("1-3, 4-10, 11-"). */
export function pianoIntervalli(nPagine, testo) { return gruppiIntervalli(testo, nPagine).filter((g) => g.length); }

/**
 * A ogni pagina bianca (separatore): vuote = Set/array di indici bianchi. Le pagine bianche
 * vengono tolte; i gruppi vuoti scartati.
 */
export function pianoSeparatori(nPagine, vuote) {
  const v = new Set(vuote);
  const out = []; let cur = [];
  for (let i = 0; i < nPagine; i++) {
    if (v.has(i)) { if (cur.length) out.push(cur); cur = []; } else cur.push(i);
  }
  if (cur.length) out.push(cur);
  if (!out.length) throw new ErroreUtente('Tutte le pagine sembrano bianche: niente da dividere.');
  return out;
}

/** Segnalibri di primo livello: un file per segnalibro (dalla sua pagina alla successiva). → [{titolo, indici}] */
export function pianoSegnalibri(doc) {
  const n = doc.getPageCount();
  const top = leggiSegnalibri(doc).filter((s) => s.pagina != null);
  if (!top.length) throw new ErroreUtente('Il documento non ha segnalibri con pagine: scegli un altro modo di dividere.');
  const punti = [];
  for (const s of top) if (!punti.length || s.pagina > punti[punti.length - 1].pagina) punti.push(s);
  const out = [];
  if (punti[0].pagina > 0) out.push({ titolo: 'Inizio', indici: [...Array(punti[0].pagina).keys()] });
  punti.forEach((s, k) => {
    const fine = k + 1 < punti.length ? punti[k + 1].pagina : n;
    out.push({ titolo: s.titolo, indici: [...Array(fine - s.pagina).keys()].map((j) => s.pagina + j) });
  });
  return out;
}

/** Nomi dei file risultanti: base_01.pdf, oppure titolo del segnalibro. */
export function nomiParti(base, parti) {
  const cifre = Math.max(2, String(parti.length).length);
  const usati = new Set();
  return parti.map((p, k) => {
    let n = p.titolo ? `${base}_${String(k + 1).padStart(cifre, '0')}_${nomeFileSicuro(p.titolo).slice(0, 60)}` : `${base}_${String(k + 1).padStart(cifre, '0')}`;
    let f = n + '.pdf'; let j = 2;
    while (usati.has(f.toLowerCase())) f = `${n}_${j++}.pdf`;
    usati.add(f.toLowerCase());
    return f;
  });
}

async function costruisci(src, indici, { segnalibri = true } = {}) {
  const out = await estraiInNuovo(src, indici);
  if (segnalibri) {
    try {
      const pos = new Map(indici.map((p, k) => [p, k]));
      const alb = rimappa(leggiSegnalibri(src), (p) => (pos.has(p) ? pos.get(p) : null));
      if (alb.length) scriviSegnalibri(out, alb);
    } catch { /* segnalibri non essenziali */ }
  }
  return out.save({ useObjectStreams: true });
}

/**
 * Esegue un piano: per ogni gruppo produce i byte. scrivi(nome, bytes) viene chiamato man mano
 * (così non si tengono tutti i file in memoria). carica() → nuovo PDFDocument usa e getta della sorgente
 * (serve perché le copie modificano la sorgente). → numero di file scritti
 */
export async function eseguiPiano(carica, parti, nomi, scrivi, { onProgress, signal, segnalibri = true } = {}) {
  let src = await carica();
  for (let k = 0; k < parti.length; k++) {
    if (signal?.aborted) throw annullato();
    const bytes = await costruisci(src, parti[k].indici || parti[k], { segnalibri });
    await scrivi(nomi[k], bytes);
    onProgress?.((k + 1) / parti.length, nomi[k]);
    if ((k + 1) % 20 === 0) src = await carica(); // libera gli oggetti accumulati dalle copie
    await cedi();
  }
  return parti.length;
}

/**
 * Divide per dimensione massima: gruppi consecutivi il più grandi possibile sotto maxByte.
 * Stima con ricerca esponenziale + binaria sul numero di pagine (pochi salvataggi anche con 1000 pagine).
 * → [{ indici, bytes }] (i byte sono già pronti). Le pagine singole più grandi del limite restano da sole.
 */
export async function pianoDimensione(carica, nPagine, maxByte, { onProgress, signal } = {}) {
  if (!(maxByte >= 50 * 1024)) throw new ErroreUtente('La dimensione massima deve essere di almeno 0,05 MB.');
  let src = await carica();
  let salvataggi = 0;
  const misura = async (a, b) => {
    if (signal?.aborted) throw annullato();
    if (++salvataggi % 12 === 0) src = await carica();
    const indici = [...Array(b - a).keys()].map((k) => a + k);
    const bytes = await costruisci(src, indici);
    await cedi();
    return bytes;
  };
  const out = [];
  let a = 0;
  let passo = 8;
  while (a < nPagine) {
    // crescita esponenziale finché si sta sotto il limite
    let okB = a + 1, okBytes = await misura(a, a + 1);
    if (okBytes.length <= maxByte) {
      let hi = null;
      let b = Math.min(nPagine, a + passo);
      while (b > okB) {
        const by = await misura(a, b);
        if (by.length <= maxByte) { okB = b; okBytes = by; if (b === nPagine) break; b = Math.min(nPagine, a + (b - a) * 2); }
        else { hi = b; break; }
      }
      if (hi != null) { // ricerca binaria tra okB e hi
        let lo = okB;
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          const by = await misura(a, mid);
          if (by.length <= maxByte) { lo = mid; okBytes = by; } else hi = mid;
        }
        okB = lo;
      }
    }
    passo = Math.max(1, okB - a);
    out.push({ indici: [...Array(okB - a).keys()].map((k) => a + k), bytes: okBytes, troppoGrande: okBytes.length > maxByte });
    a = okB;
    onProgress?.(a / nPagine);
  }
  return out;
}
