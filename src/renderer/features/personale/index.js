// Area «personale»: archivio personale cifrato (firme, sigle, timbri, rubrica, modelli, registro),
// rubrica di persone ed enti, compilazione in serie. Il processo principale cifra tutto
// (electron/features/personale.cjs); qui ci sono il modello dei dati e l'interfaccia.
import './personale.css';
import { createArchivio } from './lib/archivio.js';
import { createIpcBackend, createMemoryBackend, isDesktop } from './lib/backend.js';
import { impostaArchivio } from './lib/condiviso.js';
import { registerImpostazioni, chiediPassword } from './ui/impostazioni.js';
import { registerRubrica } from './ui/rubrica.js';
import { registerSerie } from './ui/serie.js';

export default function register(app) {
  let legacy = null;
  try { legacy = typeof localStorage !== 'undefined' ? localStorage : null; } catch { legacy = null; }
  const backend = isDesktop() ? createIpcBackend() : createMemoryBackend({ storage: legacy });
  const archivio = createArchivio({
    backend, legacyStorage: legacy,
    chiediPassword: (o) => chiediPassword(app, o),
    log: (lvl, msg, data) => { try { app.log?.(lvl, msg, data); } catch { /* */ } },
  });
  impostaArchivio(archivio);
  archivio.on('errore', (e) => app.ui.toast('Archivio personale: ' + (e?.message || e), { kind: 'error', timeout: 8000 }));
  archivio.on('ripristinato', () => app.ui.toast('L\'archivio personale era danneggiato: è stata ripristinata l\'ultima versione salvata.', { kind: 'warning', timeout: 10000 }));

  /** Apre l'archivio (con la password se serve). → true se pronto. Mostra gli errori all'utente. */
  const apri = async () => {
    try { return await archivio.apri(); }
    catch (err) { app.reportError(err, 'Archivio personale non disponibile'); return false; }
  };
  const ctx = { archivio, apri };
  // all'avvio, senza password, l'archivio si apre da solo (e la migrazione dalla 0.2 avviene in silenzio)
  setTimeout(() => { archivio.apri({ interattivo: false }).catch((e) => { try { app.log?.('warn', 'archivio personale non aperto all\'avvio', { error: e.message }); } catch { /* */ } }); }, 0);

  registerImpostazioni(app, ctx);
  registerRubrica(app, ctx);
  registerSerie(app, ctx);
  try { window.__leggioPersonale = ctx; } catch { /* */ }
}
