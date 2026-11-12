// Area «sicurezza»: proteggi, rimuovi protezione, oscura (redazione), sanifica, proprietà,
// riduci dimensioni, allegati, ripara. Vedi docs/aree/sicurezza.md.
import { injectStyles, st } from './comune.js';
import { protect, unprotect, installSaveHook, protectBytes, unprotectBytes } from './ui-protezione.js';
import { redactTool, openSearchPanel } from './ui-oscura.js';
import { compressTool, compressBytes, compressUnder } from './ui-comprimi.js';
import { sanitizeTool, metadataTool, attachmentsPanel, watchAttachments, repairTool } from './ui-varie.js';
import { sanitize, analyze } from './logica/sanifica.js';
import { LIVELLI } from './logica/comprimi.js';
import { payloadLimit } from './logica/pec.js';
import { openDecrypted } from './logica/cifratura.js';
import { operazioniSicurezza } from './azioni.js';
import { pecTool, pecSettings, preparaPec, sogliaPec } from './ui-pec.js';
import { oscuraDatiPersonali } from './ui-conferma.js';

export default function register(app) {
  injectStyles();
  const run = (fn, ctx) => async (a) => { try { await fn(a); } catch (e) { if (e?.name !== 'AbortError') a.reportError(e, ctx); } };

  app.registerTool({
    id: 'protect', name: 'Proteggi con password', category: 'proteggi', icon: 'lock', quickOrder: 70,
    description: 'Password di apertura e limiti a stampa, copia e modifica (Proteggi, Cifra con password)',
    keywords: 'proteggi password cifra crittografa cifratura permessi limita stampa copia sicurezza riservato aes encrypt',
    run: run(protect, 'Proteggi con password'),
  });
  app.registerTool({
    id: 'unprotect', name: 'Rimuovi protezione', category: 'proteggi', icon: 'lock',
    description: 'Toglie password e limitazioni conoscendo la password (Rimuovi sicurezza)',
    keywords: 'rimuovi togli protezione password sblocca decifra sicurezza permessi stampa',
    run: run(unprotect, 'Rimuovi protezione'),
  });
  app.registerTool({
    id: 'redact', name: 'Oscura (Redazione)', category: 'proteggi', icon: 'redact', quick: true, quickOrder: 60,
    description: 'Elimina davvero testo e immagini riservati: aree, testo, ricerca di codici fiscali e IBAN, pagine',
    keywords: 'oscura redazione redigi omissis anonimizza privacy trasparenza gdpr nascondi cancella codice fiscale iban dati personali',
    interactive: redactTool(),
  });
  app.registerTool({
    id: 'redact-search', name: 'Cerca e oscura', category: 'proteggi', icon: 'search',
    description: 'Trova e oscura codici fiscali, IBAN, partite IVA, email, telefoni, targhe o parole (Redazione)',
    keywords: 'cerca oscura redazione codice fiscale iban partita iva email telefono targa amministrazione trasparente privacy',
    run: run(openSearchPanel, 'Cerca e oscura'),
  });
  app.registerTool({
    id: 'sanitize', name: 'Sanifica documento', category: 'proteggi', icon: 'sparkles',
    description: 'Rimuove metadati, JavaScript, allegati, commenti, livelli nascosti, versioni precedenti (Rimuovi informazioni nascoste)',
    keywords: 'sanifica pulisci rimuovi informazioni nascoste metadati autore javascript allegati commenti livelli privacy pubblica',
    run: run(sanitizeTool, 'Sanifica documento'),
  });
  app.registerTool({
    id: 'metadata', name: 'Proprietà e vista iniziale', category: 'proteggi', icon: 'info',
    description: 'Titolo, autore, oggetto, parole chiave, date; come si apre il documento',
    keywords: 'proprietà metadati titolo autore oggetto parole chiave date vista iniziale apertura layout zoom',
    run: run(metadataTool, 'Proprietà del documento'),
  });
  app.registerTool({
    id: 'compress', name: 'Riduci dimensioni file', category: 'proteggi', icon: 'compress', quick: true, quickOrder: 50,
    description: 'Comprimi PDF, anche sotto una dimensione massima (per PEC e portali)',
    keywords: 'comprimi riduci dimensioni file peso mb pec portale ottimizza alleggerisci compressione immagini',
    run: run(compressTool, 'Riduci dimensioni file'),
  });
  app.registerTool({
    id: 'attachments', name: 'Allegati', category: 'avanzati', icon: 'paperclip',
    description: 'Vedi, salva, aggiungi o togli i file allegati al PDF',
    keywords: 'allegati file incorporati embedded attachment xml fattura',
    run: (a) => a.sidebar.show('attachments'),
  });
  app.registerTool({
    id: 'repair', name: 'Ripara PDF', category: 'avanzati', icon: 'settings', needsDoc: false,
    description: 'Recupera un PDF danneggiato o che non si apre',
    keywords: 'ripara recupera danneggiato corrotto rotto non si apre errore xref',
    run: run(repairTool, 'Ripara PDF'),
  });
  app.registerTool({
    id: 'pec', name: 'Prepara per PEC', category: 'proteggi', icon: 'export', needsDoc: false,
    description: 'Riduce più allegati per stare nel limite della PEC; se non basta, propone come dividere gli invii',
    keywords: 'pec posta certificata allegati invio limite mb dimensione riduci comprimi dividi spedire email',
    run: run(pecTool, 'Prepara per PEC'),
  });
  pecSettings(app);
  // operazioni nelle Azioni guidate (area avanzati)
  app.bus.on('batch:operations', (list) => { for (const op of operazioniSicurezza(app)) list.push(op); });
  app.registerPanel(attachmentsPanel(app));
  installSaveHook(app);
  watchAttachments(app);

  // segni di oscuramento: se le pagine cambiano numero, togli quelli fuori dal documento
  app.bus.on('document:changed', ({ doc }) => {
    const s = st(doc);
    if (s.marks.length) s.marks = s.marks.filter((m) => m.page < doc.pageCount);
  });

  // ---- servizi per altre aree (es. elaborazione in blocco). Vedi docs/aree/sicurezza.md ----
  app.services = app.services || {};
  Object.assign(app.services, {
    protect: (bytes, opts, { password } = {}) => protectBytes(bytes, opts, password),
    unprotect: (bytes, password) => unprotectBytes(bytes, password),
    compress: async (bytes, opts = {}) => {
      if (opts.maxBytes) return compressUnder(bytes, opts.maxBytes, opts);
      const step = opts.level ? LIVELLI.find((l) => l.id === opts.level) : { dpi: opts.dpi ?? 150, quality: opts.quality ?? 0.72 };
      return { ...(await compressBytes(bytes, { ...opts, ...step })), reached: true };
    },
    sanitize: async (bytes, opts = {}, { password } = {}) => {
      const { doc } = await openDecrypted(bytes, password ?? '');
      const report = sanitize(doc, opts);
      return { bytes: await doc.save({ useObjectStreams: true }), report };
    },
    preparaPec: (files, opts) => preparaPec(files, opts),
    /** Oscuramento con i modelli: mostra SEMPRE l'elenco dei risultati da confermare. → { bytes, trovati, verifica } */
    oscuraDatiPersonali: (bytes, opts) => oscuraDatiPersonali(app, bytes, opts),
    /** Soglia PEC unica dell'app: limite del messaggio in MB (Impostazioni). */
    sogliaPec: () => sogliaPec(app),
    /** Byte di allegati che stanno in un messaggio PEC (tolta la codifica base64 e un margine). */
    sogliaPecAllegati: () => payloadLimit(sogliaPec(app)),
    analyzeHidden: async (bytes, { password } = {}) => analyze((await openDecrypted(bytes, password ?? '')).doc, bytes),
  });
}
