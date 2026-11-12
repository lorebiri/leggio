// Area «avanzati»: funzioni per la Pubblica Amministrazione (.p7m, FatturaPA, protocollo), azioni guidate,
// creazione PDF da web e Office, ricerca in più PDF, sessione, vista divisa, livelli, portfolio,
// accessibilità e cartella delle scansioni.
import './avanzati.css';
import { openPane } from './pane.js';
import { openSignedFile, signatureView, saveContent, saveReport, registerP7mPanel, SIGNED_EXT } from './ui/p7m.js';
import { openFattura } from './ui/fattura.js';
import { timbroProtocollo } from './ui/protocollo.js';
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

export default function register(app) {
  const deps = {};
  Object.assign(deps, {
    openPane, signatureView, saveContent, saveReport,
    openSignedFile: (a, f) => openSignedFile(a, f, deps),
    openFattura: (a, b, n, o) => openFattura(a, b, n, o || {}, deps),
    chooseSigned: (a) => chooseSigned(a, deps),
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
  app.registerTool({ id: 'protocol-stamp', name: 'Timbro di protocollo', category: 'avanzati', icon: 'stamp',
    description: 'Riquadro «Prot. n. … del …» con numerazione progressiva',
    keywords: 'protocollo segnatura numero protocollo timbro entrata uscita classificazione',
    run: () => timbroProtocollo(app, deps) });

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
