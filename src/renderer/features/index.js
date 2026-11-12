// Ogni area di competenza registra qui i propri strumenti. Un'area = una cartella.
// Non modificare l'ordine senza motivo: determina l'ordine nella barra rapida a parità di quickOrder.
import pagine from './pagine/index.js';
import commenti from './commenti/index.js';
import moduli from './moduli/index.js';
import conversione from './conversione/index.js';
import sicurezza from './sicurezza/index.js';
import modifica from './modifica/index.js';

const AREE = { pagine, commenti, moduli, conversione, sicurezza, modifica };

export function registerFeatures(app) {
  for (const [nome, reg] of Object.entries(AREE)) {
    try { reg(app); }
    catch (err) { console.error(`[leggio] area «${nome}» non caricata`, err); }
  }
}
