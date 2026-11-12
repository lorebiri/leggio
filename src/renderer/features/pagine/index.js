// Area «pagine»: organizza, unisci, dividi, ritaglia, numera, filigrana, crea PDF, segnalibri.
// Registra strumenti, azioni sulle miniature e il pannello dei segnalibri modificabile.
import './pagine.css';
import { registerIcon } from '../../core/icons.js';
import * as S from './logica/struttura.js';
import { apriOrganizza, installaOrganizza } from './ui/organizza.js';
import { apriUnisci } from './ui/unisci.js';
import { apriDividi } from './ui/dividi.js';
import { strumentoRitaglia } from './ui/ritaglia.js';
import { apriIntestazioni, apriFiligrana, apriSfondo } from './ui/timbri.js';
import { apriCrea, installaTrascinamento } from './ui/crea.js';
import { pannelloSegnalibri } from './ui/segnalibri.js';
import * as U from './ui/strumenti.js';
import { mostraErrore, modificaDoc } from './ui/comune.js';

registerIcon('rotateLeft', '<path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/>');
registerIcon('copy', '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>');
registerIcon('organize', '<rect x="3" y="3" width="7" height="9" rx="1.2"/><rect x="14" y="3" width="7" height="9" rx="1.2"/><rect x="3" y="15" width="7" height="6" rx="1.2"/><path d="M14 18h7M17.5 14.5v7"/>');
registerIcon('pageInsert', '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>');
registerIcon('pageExtract', '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M14 3v6h6v3M15 18h6M18 15l3 3-3 3"/>');
registerIcon('pageDelete', '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9.5 13.5l5 5M14.5 13.5l-5 5"/>');
registerIcon('pageReplace', '<rect x="3" y="3" width="9" height="12" rx="1.5"/><rect x="12" y="9" width="9" height="12" rx="1.5"/><path d="M7 19h3M17 5h-3"/>');
registerIcon('reverse', '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>');
registerIcon('resize', '<rect x="3" y="7" width="12" height="14" rx="1.5"/><path d="M10 3h11v11M16 3h5v5"/>');
registerIcon('nup', '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M3 12h18"/>');
registerIcon('booklet', '<path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14"/>');
registerIcon('headerFooter', '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M7 6.5h10M9 18h6M7 10h10M7 13h7"/>');
registerIcon('numbering', '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M10 15.5h4M12 15.5v-6l-1.5 1.2"/>');
registerIcon('bates', '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 17h8M8 8h3v4H8zM14 8h2M14 11h2"/>');
registerIcon('background', '<rect x="4" y="3" width="16" height="18" rx="1.5" fill="currentColor" fill-opacity=".18"/><path d="M8 8h8M8 12h8M8 16h5"/>');
registerIcon('labels', '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>');
registerIcon('eraser', '<path d="m7 21-4-4 11-11 7 7-7 8zM10 9l6 6M3 21h18"/>');
registerIcon('duplicate', '<rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2M14 12v5M11.5 14.5h5"/>');

export default function register(app) {
  installaOrganizza(app);
  installaTrascinamento(app);

  const T = (def) => app.registerTool({ category: 'pagine', ...def, run: async (a) => { try { await def.run(a); } catch (err) { mostraErrore(app, err, def.name); } } });

  // ---------- organizza e combina ----------
  T({ id: 'organize', name: 'Organizza pagine', acrobatName: 'Organizza pagine', icon: 'organize', quick: true, quickOrder: 20,
    description: 'Griglia di miniature grandi: riordina, ruota, elimina, inserisci, estrai e togli le pagine bianche',
    keywords: 'organizza pagine griglia riordina sposta ordine miniature ruota elimina inserisci estrai pagine bianche scansioni',
    run: (a) => apriOrganizza(a) });
  T({ id: 'merge', name: 'Unisci PDF', acrobatName: 'Combina file', icon: 'merge', category: 'crea', needsDoc: false,
    description: 'Combina PDF e foto (JPG, PNG, HEIC) in un unico PDF, con un segnalibro per ogni file',
    keywords: 'unisci combina file merge accorpa fascicolo foto immagini jpg png heic segnalibri',
    run: (a) => apriUnisci(a, { includiAttivo: !!a.activeDoc }) });
  T({ id: 'split', name: 'Dividi PDF', acrobatName: 'Dividi documento', icon: 'split',
    description: 'In più file: ogni N pagine, per intervalli, a ogni pagina bianca, per segnalibri o sotto una dimensione (PEC)',
    keywords: 'dividi separa spezza split pec dimensione massima mb allegati segnalibri pagine bianche fatture',
    run: (a) => apriDividi(a) });
  T({ id: 'create-pdf', name: 'Crea PDF', acrobatName: 'Crea PDF', icon: 'pageInsert', category: 'crea', needsDoc: false,
    description: 'Da foto e immagini (una per pagina, raddrizzate e adattate ad A4), da file di testo o vuoto',
    keywords: 'crea nuovo pdf da immagini foto jpg png heic scontrini testo txt vuoto',
    run: (a) => apriCrea(a) });

  // ---------- pagine singole ----------
  T({ id: 'extract-pages', name: 'Estrai pagine', acrobatName: 'Estrai', icon: 'pageExtract', description: 'Copia alcune pagine in un nuovo documento o in file separati', keywords: 'estrai copia pagine nuovo documento separa salva pagine', run: (a) => U.estrai(a) });
  T({ id: 'delete-pages', name: 'Elimina pagine', acrobatName: 'Elimina', icon: 'pageDelete', description: 'Togli pagine scelte o le pagine bianche delle scansioni', keywords: 'elimina cancella togli rimuovi pagine bianche vuote', run: (a) => U.eliminaDialogo(a) });
  T({ id: 'rotate-pages', name: 'Ruota pagine', acrobatName: 'Ruota', icon: 'rotate', description: 'Ruota le pagine nel file (non solo la vista): tutte, alcune, pari o dispari', keywords: 'ruota gira raddrizza rotazione orizzontale verticale capovolgi', run: (a) => U.ruotaDialogo(a) });
  T({ id: 'insert-pages', name: 'Inserisci pagine', acrobatName: 'Inserisci', icon: 'pageInsert', description: 'Da un altro PDF, da foto o pagine vuote, prima o dopo una pagina', keywords: 'inserisci aggiungi pagine file vuota bianca foto', run: (a) => U.inserisci(a) });
  T({ id: 'replace-pages', name: 'Sostituisci pagine', acrobatName: 'Sostituisci', icon: 'pageReplace', description: 'Sostituisci pagine con quelle di un altro file (es. la pagina firmata corretta)', keywords: 'sostituisci rimpiazza cambia pagina firmata', run: (a) => U.sostituisci(a) });
  T({ id: 'duplicate-pages', name: 'Duplica pagine', icon: 'duplicate', description: 'Crea copie di pagine, subito dopo o in fondo', keywords: 'duplica copia pagine ripeti', run: (a) => U.duplicaDialogo(a) });
  T({ id: 'reverse-pages', name: 'Inverti ordine pagine', acrobatName: 'Inverti', icon: 'reverse', description: 'Dall\'ultima alla prima (scansioni fatte al contrario)', keywords: 'inverti ordine contrario rovescia pagine scanner', run: (a) => U.invertiDialogo(a) });

  // ---------- impaginazione ----------
  app.registerTool(strumentoRitaglia(app));
  T({ id: 'resize-pages', name: 'Ridimensiona pagine', icon: 'resize', description: 'Porta tutte le pagine ad A4 (o altro formato) adattando il contenuto', keywords: 'ridimensiona formato a4 lettera letter a3 scala adatta dimensione pagina', run: (a) => U.ridimensionaDialogo(a) });
  T({ id: 'n-up', name: 'Più pagine per foglio', icon: 'nup', description: '2, 4, 6 o 9 pagine affiancate su ogni foglio, con bordo', keywords: 'n-up nup 2 4 pagine per foglio affianca stampa giustificativi', run: (a) => U.nUpDialogo(a) });
  T({ id: 'booklet', name: 'Opuscolo', icon: 'booklet', description: 'Pagine disposte per stampare fronte/retro e piegare a libretto', keywords: 'opuscolo libretto booklet imposizione piega stampa', run: (a) => U.opuscoloDialogo(a) });

  // ---------- numeri e timbri ----------
  T({ id: 'header-footer', name: 'Intestazione e piè di pagina', acrobatName: 'Intestazione e piè di pagina', icon: 'headerFooter', description: 'Numeri di pagina «Pag. 1 di 10», data, nome file, con anteprima', keywords: 'intestazione piè di pagina pie numera numerazione numeri di pagina pag di data nome file header footer', run: (a) => apriIntestazioni(a) });
  T({ id: 'page-numbers', name: 'Numera pagine', acrobatName: 'Aggiungi numeri di pagina', icon: 'numbering', description: 'Aggiungi «Pag. 1 di 10» o «1/10» con anteprima e impostazioni salvabili', keywords: 'numera numeri di pagina numerazione pag di fascicolo', run: (a) => apriIntestazioni(a) });
  T({ id: 'bates', name: 'Numerazione degli allegati (Bates)', acrobatName: 'Numerazione Bates', icon: 'bates', description: 'Numero progressivo tipo ALL.1-001 che continua da un file all\'altro', keywords: 'bates numerazione progressiva allegati contenzioso ispezione prefisso', run: (a) => apriIntestazioni(a, { bates: true }) });
  T({ id: 'watermark', name: 'Filigrana', acrobatName: 'Filigrana', icon: 'watermark', description: '«COPIA», «BOZZA», «ANNULLATO» o un\'immagine, trasparente, con anteprima', keywords: 'filigrana watermark copia bozza annullato riservato trasparente timbro diagonale', run: (a) => apriFiligrana(a) });
  T({ id: 'background', name: 'Sfondo', acrobatName: 'Sfondo', icon: 'background', description: 'Colore o immagine dietro il contenuto delle pagine', keywords: 'sfondo colore immagine background carta', run: (a) => apriSfondo(a) });
  T({ id: 'remove-added', name: 'Rimuovi numeri e filigrane aggiunti', icon: 'eraser', description: 'Toglie intestazioni, numeri, filigrane e sfondi aggiunti con Leggio', keywords: 'rimuovi togli elimina filigrana intestazione numeri sfondo aggiunti', run: (a) => U.rimuoviAggiunti(a) });
  T({ id: 'page-labels', name: 'Etichette di pagina', icon: 'labels', description: 'Numerazione mostrata dai lettori (i, ii, iii per la prefazione, poi 1, 2, 3)', keywords: 'etichette pagina numerazione romani prefazione page labels', run: (a) => U.etichetteDialogo(a) });

  // ---------- pannello segnalibri modificabile (sostituisce quello di base) ----------
  app.registerPanel(pannelloSegnalibri(app));

  // ---------- azioni sulle miniature ----------
  const A = (def) => app.registerPageAction({ ...def, run: async (a, sel) => { try { await def.run(a, sel); } catch (err) { mostraErrore(app, err, def.label); } } });
  const ruota = (delta) => (a, sel) => U.modifica(a, sel.length === 1 ? `Ruotata la pagina ${sel[0] + 1}` : `Ruotate ${sel.length} pagine`, (d) => S.ruota(d, sel, delta));
  A({ id: 'rotate-right', label: 'Ruota a destra', icon: 'rotate', run: ruota(90) });
  A({ id: 'rotate-left', label: 'Ruota a sinistra', icon: 'rotateLeft', run: ruota(-90) });
  A({ id: 'duplicate-pages', label: 'Duplica', icon: 'duplicate', run: (a, sel) => U.modifica(a, sel.length === 1 ? 'Pagina duplicata' : `Duplicate ${sel.length} pagine`, (d) => S.duplica(d, sel)) });
  A({ id: 'extract-pages', label: 'Estrai in un nuovo documento', icon: 'pageExtract', run: (a, sel) => U.estrai(a, sel) });
  A({ id: 'insert-blank-after', label: 'Inserisci pagina vuota dopo', icon: 'pageInsert', run: async (a, sel) => {
    const i = sel[sel.length - 1]; const pg = await a.activeDoc.pdf.getPage(i + 1); const vp = pg.getViewport({ scale: 1 });
    await U.modifica(a, 'Inserita una pagina vuota', (d) => S.inserisciVuote(d, i + 1, 1, [vp.width, vp.height]));
  } });
  A({ id: 'insert-file-after', label: 'Inserisci da file dopo…', icon: 'open', run: (a, sel) => U.inserisci(a, { dopo: sel[sel.length - 1], sorgente: 'file' }) });
  A({ id: 'replace-pages', label: 'Sostituisci con pagine da file…', icon: 'pageReplace', run: (a, sel) => U.sostituisci(a, sel) });
  A({ id: 'organize', label: 'Apri in «Organizza pagine»', icon: 'organize', run: (a, sel) => apriOrganizza(a, { selezione: sel }) });
  A({ id: 'delete-pages', label: 'Elimina', icon: 'trash', danger: true, run: (a, sel) => U.eliminaPagine(a, sel) });
}

