// Area «moduli»: moduli compilabili e firme. Registra strumenti, barra informativa e collegamenti.
import './moduli.css';
import { createStore } from './lib/store.js';
import { FillSignSession } from './fillsign.js';
import { FormEditor } from './formeditor.js';
import { registerFormTools, installInfoBar } from './formtools.js';
import { registerDigital, openVerifyPanel } from './digital.js';
import { editProfileDialog } from './profile.js';

export default function register(app) {
  const store = createStore();
  let session = null;
  const interactive = (Factory, opts) => ({
    activate(a, optionsEl) {
      try { session = new Factory(a, store, opts); session.activate(optionsEl); }
      catch (err) { a.reportError(err, 'Strumento non disponibile'); }
    },
    deactivate() { const s = session; session = null; s?.deactivate()?.catch?.((err) => app.reportError(err, 'Chiusura dello strumento')); },
  });

  app.registerTool({
    id: 'fill-sign', name: 'Compila e firma', category: 'moduli', icon: 'pen', quick: true, quickOrder: 20,
    description: 'Scrivi su qualunque modulo, anche non compilabile: testo, ✓ ✗, data, iniziali, firma, dati personali',
    keywords: 'compila firma scrivi testo modulo non compilabile spunta crocetta data iniziali fill sign riempi',
    interactive: interactive(FillSignSession, { mode: 'fill' }),
  });
  app.registerTool({
    id: 'sign', name: 'Firma', category: 'moduli', icon: 'signature', quick: true, quickOrder: 21,
    description: 'Aggiungi la tua firma: la firma salvata compare subito, trascinala dove serve',
    keywords: 'firma firmare autografa grafica disegna immagine sigla',
    interactive: interactive(FillSignSession, { mode: 'sign' }),
  });
  app.registerTool({
    id: 'form-editor', name: 'Prepara modulo', category: 'moduli', icon: 'form',
    description: 'Crea campi compilabili (testo, caselle, elenchi, firma) e riconosce i campi da solo',
    keywords: 'prepara modulo crea campi compilabile form editor riconoscimento automatico campi acroform',
    interactive: interactive(FormEditor),
  });
  app.registerTool({
    id: 'personal-data', name: 'I miei dati personali', category: 'moduli', icon: 'settings', needsDoc: false,
    description: 'Nome, codice fiscale, ufficio… per compilare i moduli con un clic (restano sul computer)',
    keywords: 'profilo dati personali anagrafica compilazione automatica',
    run: () => editProfileDialog(app, store),
  });
  // per il collaudo dalla console (come window.__leggio)
  try { window.__leggioModuli = { get session() { return session; }, store }; } catch {}
  registerFormTools(app, store);
  registerDigital(app, store);
  installInfoBar(app, { onVerify: () => openVerifyPanel(app) });
}
