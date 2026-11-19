// Area «personale»: archivio personale cifrato (firme, sigle, timbri, rubrica, modelli, registro),
// rubrica di persone ed enti, compilazione in serie. Il processo principale cifra tutto
// (electron/features/personale.cjs); qui ci sono il modello dei dati e l'interfaccia.
import './personale.css';
import { createArchivio } from './lib/archivio.js';
import { createIpcBackend, createMemoryBackend, isDesktop } from './lib/backend.js';
import { impostaArchivio } from './lib/condiviso.js';
import { registerImpostazioni, chiediPassword, impostaPassword, esportaBackup, importaBackup } from './ui/impostazioni.js';
import { avvisoPortachiavi, promemoriaBackup, dialogoRecupero, guardiaUscita, ERRORI_RECUPERABILI } from './ui/avvisi.js';
import { createStatoPromemoria } from './lib/promemoria.js';
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
  archivio.on('errore', (e) => app.ui.toast('Archivio personale: ' + (e?.message || e), { kind: 'error', timeout: 15000 }));
  // alla chiusura: si salva subito ciò che è in attesa; se non si può, l'utente decide (mai dati persi in silenzio)
  app.quitGuards?.push(() => guardiaUscita(app, archivio));
  archivio.on('recuperato', () => app.ui.toast('Archivio personale: le modifiche ora sono salvate.', { kind: 'success' }));
  archivio.on('ripristinato', () => app.ui.toast('L\'archivio personale era danneggiato: è stata ripristinata l\'ultima versione salvata.', { kind: 'warning', timeout: 10000 }));

  const promemoria = createStatoPromemoria(legacy);
  const ctx = { archivio, promemoria };
  /** Apre l'archivio (con la password se serve). → true se pronto. Mostra gli errori con la via d'uscita. */
  const apri = async () => {
    try { return await archivio.apri(); }
    catch (err) {
      if (ERRORI_RECUPERABILI.has(err?.code)) return dialogoRecupero(app, archivio, err, { importaBackup: () => importaBackup(app, archivio) });
      app.reportError(err, 'Archivio personale non disponibile'); return false;
    }
  };
  ctx.apri = apri;

  // ---- avvisi gentili: portachiavi mancante (una volta) e promemoria del backup (al massimo uno per sessione)
  let promemoriaFatto = false; let timerPromemoria = null;
  const finestraAperta = () => typeof document !== 'undefined' && !!document.querySelector('.backdrop:not(.closing)');
  const controllaPromemoria = (ritardo) => {
    clearTimeout(timerPromemoria);
    timerPromemoria = setTimeout(async () => {
      if (promemoriaFatto || !archivio.aperto) return;
      if (finestraAperta()) { controllaPromemoria(30000); return; } // mai sopra un'altra finestra
      const tipo = promemoria.decidi(archivio.inventario());
      if (!tipo) return;
      promemoriaFatto = true;
      const r = await promemoriaBackup(app, tipo);
      if (r === 'mai-piu') promemoria.applica('maiPiu');
      else if (r === 'non-ora') promemoria.applica('nonOra');
      else if (!(await esportaBackup(app, archivio, ctx))) promemoria.applica('nonOra');
    }, ritardo);
  };
  archivio.on('cambiato', (e) => { if (e && e.sezione !== '*' && !e.uso) promemoria.applica('modificato'); });
  archivio.on('salvato', () => controllaPromemoria(4000));
  archivio.on('aperto', async () => {
    try {
      const st = await archivio.stato();
      if (st?.avvisoPortachiavi && !promemoria.leggi().portachiaviAvvisato) {
        // mai sopra un'altra finestra: si aspetta che l'utente abbia finito quello che sta facendo
        do await new Promise((r) => setTimeout(r, 1500)); while (finestraAperta());
        await avvisoPortachiavi(app, { stato: st, promemoria, impostaPassword: () => impostaPassword(app, archivio, false) });
      }
    } catch (e) { try { app.log?.('warn', 'avviso del portachiavi non mostrato', { error: e.message }); } catch { /* */ } }
    controllaPromemoria(60000);
  });
  // all'avvio, senza password, l'archivio si apre da solo (e la migrazione dalla 0.2 avviene in silenzio)
  setTimeout(() => { archivio.apri({ interattivo: false }).catch((e) => { try { app.log?.('warn', 'archivio personale non aperto all\'avvio', { error: e.message }); } catch { /* */ } }); }, 0);

  registerImpostazioni(app, ctx);
  registerRubrica(app, ctx);
  registerSerie(app, ctx);
  try { window.__leggioPersonale = ctx; } catch { /* */ }
}
