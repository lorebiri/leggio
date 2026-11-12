// Area «conversione»: OCR, esportazioni, PDF/A, confronto, lettura ad alta voce, accessibilità.
// Le operazioni sono esposte anche come servizi riutilizzabili in app.services (vedi docs/aree/conversione.md).
import './conversione.css';
import { registraOcr } from './ocr-ui.js';
import { registraEsporta } from './esporta.js';
import { registraTabella } from './tabella-ui.js';
import { registraConfronto } from './confronta.js';
import { registraPdfA } from './pdfa-ui.js';
import { registraLettura } from './leggi.js';
import { registraAccessibilita } from './accessibilita-ui.js';
import { registraImmaginiStatistiche } from './immagini.js';

export default function register(app) {
  app.services = app.services || {};
  // ogni gruppo di strumenti è indipendente: un errore in uno non blocca gli altri
  for (const reg of [registraOcr, registraEsporta, registraTabella, registraConfronto, registraPdfA, registraLettura, registraAccessibilita, registraImmaginiStatistiche]) {
    try { reg(app); } catch (err) { console.error(`[conversione] ${reg.name} non caricato`, err); }
  }
}
