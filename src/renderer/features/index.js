// Ogni area di competenza registra qui i propri strumenti. Un'area = una cartella.
// Non modificare l'ordine senza motivo: determina l'ordine nella barra rapida a parità di quickOrder.
import pagine from './pagine/index.js';
import commenti from './commenti/index.js';
import moduli from './moduli/index.js';
import conversione from './conversione/index.js';
import sicurezza from './sicurezza/index.js';
import modifica from './modifica/index.js';
import avanzati from './avanzati/index.js';
import aggiornamenti from './aggiornamenti/index.js';

const AREE = { pagine, commenti, moduli, conversione, sicurezza, modifica, avanzati, aggiornamenti };

// Ordine della barra rapida deciso dal coordinatore, dalle funzioni più usate in ufficio
// (vedi docs/CONFRONTO-ACROBAT.md e le priorità dell'utente di riferimento). Gli strumenti
// rapidi non elencati vengono dopo, nell'ordine scelto dalla loro area.
const ORDINE_RAPIDI = [
  'highlight', 'sticky-note', 'fill-sign', 'sign', 'organize', 'edit-content',
  'compress', 'redact', 'ocr', 'free-text', 'stamp', 'compare', 'ink', 'shapes', 'comments-select',
];

export function registerFeatures(app) {
  for (const [nome, reg] of Object.entries(AREE)) {
    try { reg(app); }
    catch (err) { console.error(`[leggio] area «${nome}» non caricata`, err); }
  }
  ORDINE_RAPIDI.forEach((id, i) => { const t = app.tools.get(id); if (t?.quick) t.quickOrder = i; });
  for (const t of app.tools.list()) if (t.quick && !ORDINE_RAPIDI.includes(t.id)) t.quickOrder = 100 + (t.quickOrder ?? 50);
  app.bus.emit('tools:changed');
}
