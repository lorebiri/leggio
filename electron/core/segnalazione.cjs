// «Segnala un problema»: prepara una mail per lo sviluppatore e la apre nel programma di posta
// dell'utente (mailto:). Leggio non spedisce nulla da solo: l'utente legge il testo e preme «Invia».
// Non allega documenti; dal registro prende solo le ultime righe di avvisi ed errori, con i percorsi
// accorciati al nome del file.
const fs = require('node:fs');
const path = require('node:path');

const DESTINATARIO = 'lorenzo.birindelli@cnr.it';
// i programmi di posta (Outlook su Windows in particolare) troncano i mailto: troppo lunghi
const MAX_URL = 1900;

const SISTEMI = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Ultime righe WARN/ERROR del registro (testo grezzo del file). */
function righeErrore(testo, max = 6) {
  return String(testo || '').split('\n').filter((r) => /\[(ERROR|WARN)\]/.test(r)).slice(-max);
}

/** Toglie cartelle personali e percorsi completi: resta solo il nome del file. */
function pulisci(riga, home = '') {
  let s = String(riga);
  if (home) s = s.split(home).join('~');
  // percorsi Windows (C:\...\nome.pdf) e POSIX (/Users/.../nome.pdf, ~/...): solo l'ultimo elemento
  s = s.replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\s"',:]+)+[\\/]([^\\/\s"',:]+)/g, '…/$1');
  s = s.replace(/~(?:[\\/][^\\/\s"',:]+)+[\\/]([^\\/\s"',:]+)/g, '…/$1');
  // la data ISO completa è inutile: bastano giorno e ora
  s = s.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.\d+Z/, '$1 $2');
  return s.slice(0, 220);
}

/**
 * Costruisce il mailto:. → { url, oggetto, corpo }
 * info: { versione, sistema, versioneSistema, errori: [righe], contesto?: string }
 */
function preparaMail({ versione = '?', sistema = '', versioneSistema = '', errori = [], contesto = '', immagine = '' } = {}) {
  const oggetto = `Leggio ${versione}: segnalazione di un problema`;
  const testa = [
    'Ciao Lorenzo,',
    '',
    'cosa stavo facendo quando è successo:',
    '',
    '',
    'cosa mi aspettavo e cosa è successo invece:',
    '',
    '',
    ...(immagine ? [`L'immagine della finestra è nella cartella Download («${immagine}»): trascinala in questa mail.`] : []),
    '(Se serve, allega il documento: Leggio non lo allega da solo.)',
    '',
    '-- Dati tecnici, puoi lasciarli così --',
    `Versione di Leggio: ${versione}`,
    `Sistema: ${SISTEMI[sistema] || sistema || '?'} ${versioneSistema}`.trim(),
  ];
  if (contesto) testa.push(`Avviso mostrato: ${String(contesto).replace(/\s+/g, ' ').slice(0, 200)}`);
  const encode = (o, c) => `mailto:${DESTINATARIO}?subject=${encodeURIComponent(o)}&body=${encodeURIComponent(c)}`;
  let righe = errori.slice();
  let corpo; let url;
  // se è troppo lunga si tolgono le righe di registro più vecchie, poi tutte
  for (;;) {
    corpo = [...testa, ...(righe.length ? ['Ultimi errori registrati:', ...righe] : [])].join('\n');
    url = encode(oggetto, corpo);
    if (url.length <= MAX_URL || !righe.length) break;
    righe = righe.slice(1);
  }
  return { url, oggetto, corpo, destinatario: DESTINATARIO };
}

/** Legge la coda del registro senza caricare tutto il file. */
function codaRegistro(file, byte = 64 * 1024) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const n = Math.min(byte, st.size);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, st.size - n);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/** Nome dell'immagine della finestra: Leggio-segnalazione-AAAA-MM-GG-hhmmss.png (ora locale). */
function nomeImmagine(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `Leggio-segnalazione-${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
}

function mailDaRegistro({ logDir, home, versione, sistema, versioneSistema, contesto, immagine }) {
  const errori = righeErrore(codaRegistro(path.join(logDir, 'leggio.log'))).map((r) => pulisci(r, home));
  return preparaMail({ versione, sistema, versioneSistema, errori, contesto, immagine });
}

module.exports = { DESTINATARIO, MAX_URL, righeErrore, pulisci, preparaMail, mailDaRegistro, nomeImmagine };
