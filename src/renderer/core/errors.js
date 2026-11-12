// Diagnosi dei file e traduzione degli errori tecnici in messaggi chiari per l'utente.
// Logica pura (nessun DOM): coperta da test/robustezza-file.test.js.

/** Dimensione massima di un PDF che Leggio apre o salva (limite di memoria del renderer). */
export const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024 - 1;

const SIGNATURES = [
  { name: 'un\'immagine PNG', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { name: 'un\'immagine JPEG', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: 'un\'immagine GIF', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { name: 'un\'immagine TIFF', test: (b) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a) },
  { name: 'un\'immagine WebP', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 },
  { name: 'un\'immagine BMP', test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { name: 'un archivio ZIP o un documento Office (Word, Excel, PowerPoint)', test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  { name: 'un vecchio documento Office (.doc, .xls)', test: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 },
  { name: 'un file PostScript', test: (b) => b[0] === 0x25 && b[1] === 0x21 && b[2] === 0x50 && b[3] === 0x53 },
  { name: 'una pagina web (HTML)', test: (b) => /^\s*<(!doctype html|html)/i.test(ascii(b, 0, 64)) },
  { name: 'un file RTF', test: (b) => ascii(b, 0, 5) === '{\\rtf' },
];

function ascii(b, start, len) {
  let s = '';
  for (let i = start; i < Math.min(b.length, start + len); i++) s += String.fromCharCode(b[i]);
  return s;
}

/**
 * Esamina i primi byte. → { kind: 'empty'|'pdf'|'pdf-offset'|'other'|'unknown', what?, offset? }
 * 'pdf-offset': intestazione %PDF non all'inizio (spazzatura prima, capita con alcuni allegati email).
 */
export function sniff(bytes) {
  if (!bytes || bytes.length === 0) return { kind: 'empty' };
  const head = ascii(bytes, 0, 1024);
  const at = head.indexOf('%PDF-');
  if (at === 0) return { kind: 'pdf' };
  if (at > 0) return { kind: 'pdf-offset', offset: at };
  for (const s of SIGNATURES) if (s.test(bytes)) return { kind: 'other', what: s.name };
  return { kind: 'unknown' };
}

/** C'è un %%EOF negli ultimi 2 KB? (indizio di file troncato se manca) */
export function hasEof(bytes) {
  if (!bytes?.length) return false;
  const tail = ascii(bytes, Math.max(0, bytes.length - 2048), 2048);
  return tail.includes('%%EOF');
}

/** Controllo preliminare: errore leggibile se il file non va nemmeno provato. */
export function precheck(bytes, name = 'il file') {
  if (!bytes || bytes.length === 0) return `«${name}» è vuoto (0 byte). Forse il salvataggio o lo scaricamento non si è concluso: prova a recuperare di nuovo il file.`;
  if (bytes.length > MAX_PDF_BYTES) return `«${name}» supera i 2 GB: Leggio non può aprirlo. Dividilo prima con un altro strumento, oppure comprimi le immagini.`;
  return null;
}

/**
 * Messaggio chiaro per un errore di apertura di pdf.js / pdf-lib.
 * @param {any} err @param {Uint8Array} [bytes] @param {string} [name]
 */
export function describeOpenError(err, bytes, name = 'il file') {
  const n = `«${name}»`;
  const s = bytes ? sniff(bytes) : { kind: 'unknown' };
  if (s.kind === 'empty') return precheck(bytes, name);
  if (err?.name === 'PasswordException') return `${n} è protetto da password e la password non è stata inserita o non è corretta.`;
  if (s.kind === 'other') return `${n} non è un PDF: sembra ${s.what}. Per trasformarlo in PDF usa lo strumento «Crea PDF».`;
  const msg = String(err?.message || err || '');
  if (err?.name === 'InvalidPDFException' || /Invalid PDF structure|No password given|Invalid XRef|startxref|xref/i.test(msg)) {
    if (s.kind === 'unknown') return `${n} non sembra un PDF (manca l'intestazione %PDF). Se l'estensione è sbagliata, aprilo con il programma giusto.`;
    return `${n} è danneggiato e non può essere letto${bytes && !hasEof(bytes) ? ' (sembra troncato: forse lo scaricamento o la copia non si sono conclusi)' : ''}. Prova a riscaricarlo o a chiedere una nuova copia a chi te l'ha mandato.`;
  }
  if (/no pages|numPages|pagine/i.test(msg)) return `${n} non contiene pagine leggibili.`;
  if (/out of memory|Array buffer allocation failed|allocation/i.test(msg)) return `Memoria insufficiente per aprire ${n}. Chiudi altri documenti o programmi e riprova.`;
  if (/Loading aborted|Worker was destroyed|cancel/i.test(msg)) return 'Apertura annullata.';
  return `Impossibile aprire ${n}: ${msg || 'errore sconosciuto'}.`;
}

/** Messaggio dell'errore di un invoke IPC senza il prefisso tecnico di Electron. */
export function cleanIpcMessage(msg) {
  return String(msg || '').replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(\w*Error):\s*/, '');
}

/** Errori da ignorare negli avvisi globali (rumore noto, non bug). */
export function isBenignError(err) {
  const m = String(err?.message || err || '');
  const n = err?.name || '';
  return n === 'RenderingCancelledException' || n === 'AbortError' || n === 'QueueClosedError'
    || /ResizeObserver loop/i.test(m) || /Rendering cancelled/i.test(m) || /Worker was destroyed/i.test(m)
    || /Transport destroyed/i.test(m);
}
