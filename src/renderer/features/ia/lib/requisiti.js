// Assistente IA, logica pura: requisiti del PC, modello consigliato, cosa manca da installare, testi.
// Soglie dallo studio di fattibilità: Gemma 4 E2B usa al massimo 4,2 GB di RAM, Qwen3.5-2B 2,0 GB.

const GB = 1024 ** 3;

/** Avvertenza mostrata ovunque compaia una risposta dell'assistente. */
export const AVVERTENZA = 'Risposta automatica: aiuto da verificare. Controlla sempre nel documento, alla pagina indicata.';
export const AVVERTENZA_PRIMA_VOLTA = 'L\'assistente funziona interamente su questo computer: i documenti non vengono inviati a nessuno. '
  + 'Può sbagliare: usalo come aiuto, non come fonte. Controlla sempre le risposte nel documento.';

export const formatoGB = (byte) => (byte / GB).toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' GB';

/**
 * Valuta il PC dallo stato del modulo main.
 * → { adatto, bloccante, avvisi: [testi], consigliato: 'principale'|'leggero' }
 */
export function valuta(stato) {
  const avvisi = [];
  if (!stato?.piattaformaSupportata) return { adatto: false, bloccante: 'L\'assistente non è disponibile per questo sistema.', avvisi, consigliato: 'leggero' };
  const tot = stato.ram?.totale || 0;
  const libera = stato.ram?.libera || 0;
  let bloccante = '';
  if (stato.cpu?.avx2 === false) bloccante = 'Il processore di questo PC è troppo vecchio (manca AVX2): l\'assistente sarebbe troppo lento.';
  else if (tot && tot < 6 * GB) bloccante = `Questo PC ha ${formatoGB(tot)} di RAM: ne servono almeno 8.`;
  if (!bloccante && tot && tot < 7.5 * GB) avvisi.push(`Questo PC ha ${formatoGB(tot)} di RAM: usa il modello leggero e chiudi i programmi pesanti.`);
  // con 12 GB o più va sempre il principale; tra 8 e 12 GB solo se ora ci sono almeno 5 GB liberi
  let consigliato = 'principale';
  if (tot && tot < 7.5 * GB) consigliato = 'leggero';
  else if (tot && tot < 12 * GB && libera < 5 * GB) consigliato = 'leggero';
  if (stato.cpu?.arch === 'arm64' && stato.piattaforma?.startsWith('win32')) avvisi.push('Su Windows ARM l\'assistente non è ancora stato provato: potrebbe essere lento.');
  return { adatto: !bloccante, bloccante, avvisi, consigliato };
}

/** Componenti che servono per un uso: 'domande' (motore + modello scelto) o 'archivio' (motore + embedding). */
export function servono(uso, modello = 'principale') {
  return uso === 'archivio' ? ['motore', 'embedding'] : ['motore', modello, 'embedding'];
}

/** Componenti ancora da installare e byte da scaricare. */
export function mancanti(stato, componenti) {
  const out = [];
  let byte = 0;
  for (const c of componenti) {
    const s = c === 'motore' ? stato?.motore : stato?.modelli?.[c];
    if (s && !s.installato) { out.push(c); byte += s.byte || 0; }
  }
  return { componenti: out, byte };
}

/** Il disco ha posto? (margine di 500 MB) */
export const spazioSufficiente = (stato, byte) => !stato?.discoLibero || stato.discoLibero > byte + 500 * 1024 * 1024;

export const NOMI_COMPONENTI = { motore: 'Motore (llama.cpp)', principale: 'Modello principale', leggero: 'Modello leggero', embedding: 'Ricerca per significato' };
