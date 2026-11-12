// Area «conversione»: OCR, esportazioni, PDF/A, confronto, lettura ad alta voce, accessibilità.
// Le operazioni sono esposte anche come servizi riutilizzabili in app.services (vedi docs/aree/conversione.md).
import './conversione.css';
import { registraOcr } from './ocr-ui.js';
import { registraEsporta } from './esporta.js';
import { registraTabella } from './tabella-ui.js';

export default function register(app) {
  app.services = app.services || {};
  registraOcr(app);
  registraEsporta(app);
  registraTabella(app);
}
