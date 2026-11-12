// Area «avanzati»: funzioni per la Pubblica Amministrazione (.p7m, FatturaPA, Titulus), azioni guidate,
// creazione PDF da web e Office, ricerca in più PDF, sessione, vista divisa, livelli, portfolio,
// accessibilità e cartella delle scansioni.
import './avanzati.css';
import { openPane } from './pane.js';
import { openSignedFile, signatureView, saveContent, saveReport, registerP7mPanel, SIGNED_EXT } from './ui/p7m.js';
import { openFattura, registerFatturaPanel } from './ui/fattura.js';
import { timbroProtocollo, KEY_MODELLI, cercaSegnatura } from './ui/protocollo.js';
import { preparaPerTitulus, KEY_SOGLIA_TITULUS } from './ui/titulus.js';
import { leggiSegnaturaTitulus, KEY_MASCHERA_UOR } from './ui/segnatura-immagine.js';
import { compilaModelli, MODELLI_PREDEFINITI, SOGLIA_MB_PREDEFINITA, segnatureTitulus } from './lib/titulus.js';
import { openBatch } from './ui/batch.js';
import { openSearchFolder } from './ui/search-folder.js';
import { creaDaWeb, creaDaOffice, OFFICE_EXT, convertOfficeBytes } from './ui/web-office.js';
import { setupSession } from './ui/session.js';
import { toggleSplitView } from './ui/split-view.js';
import { registerLayersPanel } from './ui/layers.js';
import { setupPortfolio, showPortfolio } from './ui/portfolio.js';
import { prepareAccessibility } from './ui/accessibility.js';
import { openScans } from './ui/scans.js';
import { isFattura } from './lib/fattura.js';
import { looksLikeP7m } from './lib/cades.js';
import { extOf } from './native.js';
import { dichiarazioneConformita, rinominaIntelligente, apriEml } from './ui/coda.js';
import { setupEnte, modificaProfiloEnte, inserisciEnteTool, compilaConEnte } from './ui/ente.js';
import { registerDatiChiave } from './ui/datichiave.js';
import { praticaMissione, fascicoloConIndice, pacchettoRendicontazione } from './ui/raccoglitori.js';
import { prontoPubblicazione } from './ui/pubblicabile.js';

export default function register(app) {
  const deps = {};
  Object.assign(deps, {
    openPane, signatureView, saveContent, saveReport,
    openSignedFile: (a, f) => openSignedFile(a, f, deps),
    openFattura: (a, b, n, o) => openFattura(a, b, n, o || {}, deps),
    chooseSigned: (a) => chooseSigned(a, deps),
    openEml: (a, b, n) => apriEml(a, b, n, deps),
  });
  app.avanzati = deps; // usato dai test e dalle altre parti dell'area

  const safe = (fn) => async (...args) => { try { await fn(...args); } catch (err) { if (err?.name !== 'AbortError') app.reportError(err, 'Operazione non riuscita'); } };

  // ---------- Pubblica Amministrazione ----------
  app.registerTool({ id: 'open-p7m', name: 'Apri file firmato (.p7m)…', category: 'moduli', icon: 'signature', needsDoc: false,
    description: 'Apre i file firmati digitalmente (.p7m, anche annidati) e verifica le firme',
    keywords: 'p7m cades firma digitale verifica firme busta firmata p7s tsd m7m marca temporale dike arubasign',
    run: () => chooseSigned(app, deps) });
  app.registerTool({ id: 'fattura-elettronica', name: 'Apri fattura elettronica (XML)…', category: 'avanzati', icon: 'file', needsDoc: false,
    description: 'Mostra la FatturaPA impaginata, con CIG, CUP, IBAN e allegati; salvala in PDF',
    keywords: 'fattura elettronica fatturapa xml sdi fpa12 fpr12 cig cup iva split payment',
    run: () => chooseFattura(app, deps) });
  // Titulus: il protocollo ufficiale del CNR. Leggio non assegna numeri: li riporta o li legge dal documento.
  if (app.settings.get('avanzati.protocollo.contatore', null) != null) app.settings.set('avanzati.protocollo.contatore', null);
  app.services = app.services || {};
  /** Segnatura di Titulus nel testo → { aoo, numero, numeroOriginale, anno, data (ISO), dataTesto, classifica, fascicolo, testo } | null */
  app.services.segnaturaTitulus = (testo) => cercaSegnatura(app, testo);
  /** Dai byte di un PDF o .p7m: prima il testo della pagina 1, poi la striscia-immagine sul margine (OCR). Non modifica nulla. */
  app.services.leggiSegnaturaTitulus = (bytes, opts) => leggiSegnaturaTitulus(app, bytes, opts);
  app.services.segnatureTitulus = (testo) => { try { return segnatureTitulus(testo, { modelli: String(app.settings.get(KEY_MODELLI, '') || '').trim() ? String(app.settings.get(KEY_MODELLI)).split(/\r?\n/).filter(Boolean) : undefined }); } catch { return segnatureTitulus(testo); } };
  app.bus.on('settings:fields', (arr) => {
    arr.push({ key: KEY_MODELLI, field: { label: 'Segnatura di Titulus: modelli di riconoscimento (uno per riga; vuoto = generici). Da verificare sul formato dell\'AOO.', type: 'textarea', rows: 3, value: '', placeholder: MODELLI_PREDEFINITI[0].slice(0, 80) + '…' } });
    arr.push({ key: KEY_MASCHERA_UOR, field: { label: 'Segnatura di Titulus: formato del codice UOR per correggere la lettura dalla striscia (A = lettera, 9 = cifra; vuoto = nessuna correzione)', type: 'text', value: 'AA999999' } });
    arr.push({ key: KEY_SOGLIA_TITULUS, field: { label: 'Prepara per Titulus: dimensione massima consigliata per file (MB)', type: 'number', min: 1, max: 500, value: SOGLIA_MB_PREDEFINITA } });
  });
  app.bus.on('settings:changed', ({ key, value }) => {
    if (key !== KEY_MODELLI || !String(value || '').trim()) return;
    try { compilaModelli(String(value).split(/\r?\n/)); } catch (err) { app.ui.toast(`${err.message} Verranno usati i modelli generici.`, { kind: 'warning', timeout: 9000 }); }
  });
  app.registerTool({ id: 'prepare-titulus', name: 'Prepara per Titulus', category: 'avanzati', icon: 'check', needsDoc: false,
    description: 'Controlla i file prima del caricamento in Titulus: PDF/A, firme, password, dimensione, nome; rapporto e copie',
    keywords: 'titulus protocollo carica caricamento prepara controlla pdf/a firma protocollare conservazione',
    run: () => preparaPerTitulus(app, deps) });
  app.registerTool({ id: 'protocol-stamp', name: 'Segnatura su copia di lavoro', category: 'avanzati', icon: 'stamp',
    description: 'Riporta su una copia il numero e la data già assegnati da Titulus (non assegna numeri)',
    keywords: 'segnatura protocollo titulus copia di lavoro numero data riporta',
    run: () => timbroProtocollo(app, deps) });

  app.registerTool({ id: 'conformity-declaration', name: 'Dichiarazione di conformità all\'originale', category: 'avanzati', icon: 'signature',
    description: 'Aggiunge il testo di attestazione dell\'ufficio con nome, qualifica e data, pronto per la firma',
    keywords: 'conformità originale copia conforme attestazione dichiarazione autentica',
    run: () => dichiarazioneConformita(app) });
  app.registerTool({ id: 'smart-rename', name: 'Rinomina dal contenuto', category: 'avanzati', icon: 'file',
    description: 'Propone un nome come Fattura_FORNITORE_n123_2026-10-31.pdf leggendo il documento',
    keywords: 'rinomina nome file intelligente automatico fattura durc salva con nome',
    run: () => rinominaIntelligente(app) });
  app.registerTool({ id: 'open-eml', name: 'Apri messaggio PEC (.eml)…', category: 'avanzati', icon: 'paperclip', needsDoc: false,
    description: 'Mostra ricevute e messaggi PEC salvati (daticert.xml) e ne apre gli allegati',
    keywords: 'pec posta certificata eml daticert ricevuta accettazione consegna allegati email',
    run: async () => { const files = await app.platform.openFiles({ multiple: true, raw: true, title: 'Apri messaggio PEC', filters: [{ name: 'Messaggi di posta', extensions: ['eml'] }] }); for (const f of files || []) await deps.openEml(app, f.bytes, f.name); } });

  // ---------- flussi dell'ufficio amministrativo ----------
  setupEnte(app);
  registerDatiChiave(app);
  app.registerTool({ id: 'mission-file', name: 'Pratica di missione', category: 'crea', icon: 'merge', needsDoc: false,
    description: 'Modulo e giustificativi (PDF, foto, scansioni) in un solo PDF sotto la dimensione scelta',
    keywords: 'missione rimborso trasferta giustificativi scontrini ricevute biglietti foto heic pratica',
    run: () => praticaMissione(app, deps) });
  app.registerTool({ id: 'dossier-index', name: 'Fascicolo con indice', category: 'crea', icon: 'bookmark', needsDoc: false,
    description: 'Unisce i documenti con pagina indice cliccabile e segnalibri (gare, rendicontazioni, ispezioni)',
    keywords: 'fascicolo indice unisci combina allegati gara ispezione rendicontazione segnalibri sommario',
    run: () => fascicoloConIndice(app, deps) });
  app.registerTool({ id: 'reporting-package', name: 'Pacchetto per la rendicontazione', category: 'crea', icon: 'pages', needsDoc: false,
    description: 'Un PDF per ogni voce di spesa con allegati numerati e riepilogo per Excel',
    keywords: 'rendicontazione rendiconto pnrr progetto europeo voci di spesa giustificativi csv excel',
    run: () => pacchettoRendicontazione(app, deps) });
  app.registerTool({ id: 'publish-ready', name: 'Pronto per la pubblicazione', category: 'proteggi', icon: 'check',
    description: 'Amministrazione Trasparente: oscura i dati personali, pulisci, PDF/A, accessibilità e rapporto',
    keywords: 'amministrazione trasparente pubblicazione albo pubblicabile privacy oscura pdf/a accessibilità sito',
    run: () => prontoPubblicazione(app, deps) });
  app.registerTool({ id: 'entity-profile', name: 'Profilo dell\'ente', category: 'moduli', icon: 'settings', needsDoc: false,
    description: 'Denominazione, sede, codice fiscale, P.IVA, codice IPA, PEC, direttore e firmatari',
    keywords: 'ente istituto profilo dati dell\'ente denominazione codice ipa codice univoco pec direttore firmatari',
    run: () => modificaProfiloEnte(app) });
  app.registerTool({ id: 'insert-entity', name: 'Inserisci dati dell\'ente', category: 'moduli', icon: 'text',
    description: 'Scegli il dato e fai clic sulla pagina dove scriverlo', keywords: 'ente intestazione denominazione inserisci timbro dati',
    interactive: inserisciEnteTool(app) });
  app.registerTool({ id: 'fill-entity', name: 'Compila con i dati dell\'ente', category: 'moduli', icon: 'form',
    description: 'Riempie i campi del modulo (denominazione, P.IVA, codice IPA, PEC…)', keywords: 'compila modulo ente dati automatico',
    run: () => compilaConEnte(app) });

  // ---------- azioni guidate, creazione, ricerca ----------
  app.registerTool({ id: 'batch', name: 'Azioni guidate (elaborazione in blocco)', category: 'avanzati', icon: 'layers', needsDoc: false,
    description: 'Applica una sequenza di operazioni a una cartella o a molti file',
    keywords: 'azioni guidate elaborazione in blocco batch cartella più file sequenza automatica tutti i pdf',
    run: () => openBatch(app, deps) });
  app.registerTool({ id: 'create-from-web', name: 'Crea PDF da pagina web o HTML…', category: 'crea', icon: 'link', needsDoc: false,
    description: 'Trasforma un indirizzo web o un file HTML in PDF',
    keywords: 'pagina web html sito url internet crea pdf converti',
    run: safe(() => creaDaWeb(app, deps)) });
  app.registerTool({ id: 'create-from-office', name: 'Crea PDF da Word, Excel, PowerPoint…', category: 'crea', icon: 'convert', needsDoc: false,
    description: 'Converte documenti .docx, .xlsx, .pptx, .odt in PDF (con LibreOffice)',
    keywords: 'word excel powerpoint docx xlsx pptx odt ods odp rtf libreoffice office converti crea pdf',
    run: safe(() => creaDaOffice(app, deps)) });
  app.registerTool({ id: 'search-folder', name: 'Cerca in più PDF', category: 'avanzati', icon: 'search', needsDoc: false,
    description: 'Cerca una parola in tutti i PDF di una cartella',
    keywords: 'ricerca avanzata cerca in cartella più file tutti i pdf trova testo',
    run: () => openSearchFolder(app, deps) });
  app.registerTool({ id: 'scan-folder', name: 'Crea PDF dalla cartella delle scansioni', category: 'crea', icon: 'image', needsDoc: false,
    description: 'Raccoglie le immagini nuove dello scanner in un PDF',
    keywords: 'scanner scansione scansioni multifunzione immagini jpg png cartella crea pdf',
    run: () => openScans(app, deps) });

  // ---------- vista, livelli, portfolio, accessibilità ----------
  app.registerTool({ id: 'split-view', name: 'Vista divisa (due documenti affiancati)', category: 'vista', icon: 'compare',
    description: 'Mostra due documenti fianco a fianco, con scorrimento sincronizzato',
    keywords: 'vista divisa affianca due documenti fianco a fianco sincronizza confronto visivo',
    run: () => toggleSplitView(app, deps) });
  app.registerTool({ id: 'portfolio', name: 'File del portfolio PDF', category: 'avanzati', icon: 'paperclip',
    description: 'Elenca e apre i file contenuti in un portfolio PDF',
    keywords: 'portfolio collection raccolta file inclusi allegati',
    run: () => showPortfolio(app, deps) });
  app.registerTool({ id: 'accessibility-prepare', name: 'Prepara per l\'accessibilità', category: 'vista', icon: 'speaker',
    description: 'Titolo, lingua, testo alternativo e struttura di base per gli screen reader',
    keywords: 'accessibilità tag struttura testo alternativo lingua titolo screen reader pdf/ua amministrazione trasparente',
    run: () => prepareAccessibility(app, deps) });
  registerP7mPanel(app, deps);
  registerFatturaPanel(app, deps);
  // i pannelli «Firme (.p7m)» e «Fattura elettronica» appartengono al loro documento:
  // passando a un documento che non li riguarda si torna alle miniature
  app.bus.on('document:activated', ({ doc }) => {
    const cur = app.sidebar.current;
    if (app.el.root.classList.contains('sidebar-closed')) return;
    if (cur === 'p7m' && !doc?.data?.p7m) app.sidebar.show(doc?.data?.fattura ? 'fattura' : 'thumbs');
    else if (cur === 'fattura' && !doc?.data?.fattura) app.sidebar.show(doc?.data?.p7m ? 'p7m' : 'thumbs');
    else if (cur === 'thumbs' && doc?.data?.fattura) app.sidebar.show('fattura');
  });
  registerLayersPanel(app, deps);
  setupPortfolio(app, deps);
  setupSession(app, deps);

  // ---------- apertura dal Finder / Esplora risorse / dialogo Apri ----------
  if (typeof app.registerOpener === 'function') {
    app.registerOpener({
      id: 'avanzati-firmati', name: 'File firmati (.p7m)', extensions: [...SIGNED_EXT],
      open: (f) => deps.openSignedFile(app, { bytes: f.bytes, name: f.name, path: f.path }),
    });
    app.registerOpener({
      id: 'avanzati-xml', name: 'Fattura elettronica (.xml)', extensions: ['xml'],
      open: (f) => (isFattura(f.bytes) ? deps.openFattura(app, f.bytes, f.name)
        : looksLikeP7m(f.bytes) ? deps.openSignedFile(app, { bytes: f.bytes, name: f.name, path: f.path })
        : app.ui.toast(`«${f.name}» non è una fattura elettronica.`, { kind: 'warning' })),
    });
    app.registerOpener({ id: 'avanzati-eml', name: 'Messaggi PEC (.eml)', extensions: ['eml'], open: (f) => deps.openEml(app, f.bytes, f.name) });
    app.registerOpener({
      id: 'avanzati-office', name: 'Documenti Office', extensions: [...OFFICE_EXT],
      open: (f) => convertOfficeBytes(app, f.bytes, f.name),
    });
  }

  // ---------- file non PDF trascinati ----------
  app.bus.on('files:dropped-nonpdf', safe(async ({ files }) => {
    for (const f of files.slice(0, 50)) {
      const ext = extOf(f.name);
      if (SIGNED_EXT.includes(ext)) { await deps.openSignedFile(app, { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name }); continue; }
      if (ext === 'xml') {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (isFattura(bytes)) await deps.openFattura(app, bytes, f.name);
        else if (looksLikeP7m(bytes)) await deps.openSignedFile(app, { bytes, name: f.name });
        else app.ui.toast(`«${f.name}» non è una fattura elettronica.`, { kind: 'warning' });
        continue;
      }
      if (ext === 'eml') { await deps.openEml(app, new Uint8Array(await f.arrayBuffer()), f.name); continue; }
      if (OFFICE_EXT.includes(ext)) { await convertOfficeBytes(app, new Uint8Array(await f.arrayBuffer()), f.name); continue; }
    }
  }));
}

async function chooseSigned(app, deps) {
  const files = await app.platform.openFiles({ multiple: true, raw: true, title: 'Apri file firmato', filters: [{ name: 'File firmati e fatture elettroniche', extensions: ['p7m', 'p7s', 'tsd', 'm7m', 'xml'] }, { name: 'Tutti i file', extensions: ['*'] }] });
  for (const f of files || []) {
    if (/\.xml$/i.test(f.name) && isFattura(f.bytes)) await deps.openFattura(app, f.bytes, f.name);
    else await deps.openSignedFile(app, { bytes: f.bytes, name: f.name, path: f.path });
  }
}

async function chooseFattura(app, deps) {
  const files = await app.platform.openFiles({ multiple: false, raw: true, title: 'Apri fattura elettronica', filters: [{ name: 'Fatture elettroniche', extensions: ['xml', 'p7m'] }] });
  const f = files?.[0];
  if (!f) return;
  if (looksLikeP7m(f.bytes)) return deps.openSignedFile(app, { bytes: f.bytes, name: f.name, path: f.path });
  return deps.openFattura(app, f.bytes, f.name);
}
