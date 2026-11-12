// Applicazione: schede documento, barra strumenti, salvataggio, annulla/ripeti, stampa, ricerca,
// e l'API pubblica usata dalle feature (vedi docs/ARCHITETTURA.md).
import { Bus } from './bus.js';
import { Doc, historyConfig } from './doc.js';
import { History, DiskStore, memoryBudget, diskBudget, MB } from './history.js';
import { precheck, describeOpenError, MAX_PDF_BYTES, cleanIpcMessage, sniff } from './errors.js';
import { repairPdf } from './repair.js';
import { installGuards, log } from './guard.js';
import { Recovery } from './recovery.js';
import { Viewer, isTyping } from './viewer.js';
import { Sidebar, thumbnailsPanel, outlinePanel } from './sidebar.js';
import { ToolRegistry, CATEGORIES } from './tools.js';
import { Settings } from './settings.js';
import { platform, isMac, modKey } from './platform.js';
import { openPdfLib, savePdfLib, renderPageToCanvas, openPdfJs, verifyPdfBytes, destroyPdf, PDFLib, pdfjs, fontkit } from './pdf.js';
import { isSignedPdf } from './signature.js';
import { reorderPdfPages } from './pagetree.js';
import { printSources } from './print.js';
import * as ui from './ui.js';
import { h, toast, dialog, confirm, withProgress, parsePageRanges, formatBytes, escapeHtml, contextMenu } from './ui.js';
import { icon } from './icons.js';

export class App {
  constructor(root) {
    this.bus = new Bus();
    this.settings = new Settings(this.bus);
    this.platform = platform;
    this.ui = ui;
    this.lib = { PDFLib, pdfjs, fontkit, openPdfLib, savePdfLib, renderPageToCanvas };
    this.openers = [];
    this.docs = [];
    this.activeDoc = null;
    this.saveHooks = [];
    this.log = log;
    installGuards(this);
    this.#setupHistory();
    this.el = this.#buildShell(root);
    this.#applyUiPrefs();
    this.viewer = new Viewer(this, this.el.viewerContainer);
    this.sidebar = new Sidebar(this, this.el.rail, this.el.sideBody);
    this.tools = new ToolRegistry(this);
    this.sidebar.registerPanel(thumbnailsPanel(this));
    this.sidebar.registerPanel(outlinePanel(this));
    this.#registerCoreTools();
    this.#wireCommands();
    this.#wireDragDrop();
    this.#applyTheme();
    this.bus.on('tools:changed', () => this.#scheduleToolsChanged());
    this.bus.on('page:changed', () => this.#updateNav());
    this.bus.on('viewer:scale', () => this.#updateNav());
    this.bus.on('viewer:pagesinit', () => this.#updateNav());
    this.#renderTabs();
    this.#renderHome();
    this.recovery = new Recovery(this);
    this.recovery.start();
  }

  // ======================= API per le feature =======================

  registerTool(def) { this.tools.register(def); }
  registerPanel(def) { this.sidebar.registerPanel(def); }
  registerPageAction(def) { this.sidebar.registerPageAction(def); }
  /**
   * Gestore per aprire file che non sono PDF (es. .p7m, .xml): dialogo Apri, trascinamento,
   * doppio clic nel Finder/Esplora risorse, «Apri con».
   * def: { id, name, extensions: ['p7m', 'tsd'], open(file:{path,name,bytes}, app) }
   */
  registerOpener(def) {
    if (!def?.open || !Array.isArray(def.extensions) || !def.extensions.length) throw new Error('registerOpener: servono extensions e open()');
    const exts = def.extensions.map((e) => String(e).toLowerCase().replace(/^\./, '')).filter((e) => e && e !== 'pdf');
    this.openers.push({ ...def, extensions: exts });
  }
  /** Gestore registrato per il nome di file (in base all'ultima estensione), o null. */
  openerFor(name) {
    const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    return (ext && this.openers.find((o) => o.extensions.includes(ext))) || null;
  }
  /** Apre un file qualunque {path, name, bytes}: gestori registrati, poi PDF. */
  async openFile(file) {
    const op = this.openerFor(file.name);
    if (op) {
      try { return await op.open(file, this); } catch (err) { this.reportError(err, `Impossibile aprire «${file.name}»`); return null; }
    }
    return this.openBytes(file.bytes, { name: file.name, path: /\.pdf$/i.test(file.name) ? file.path : null });
  }

  /** Il documento contiene firme digitali (campo firma con valore)? Risultato memorizzato per versione. */
  isSigned(doc = this.activeDoc) {
    if (!doc) return false;
    if (doc.data.__signedVersion !== doc.version) { doc.data.__signed = isSignedPdf(doc.bytes); doc.data.__signedVersion = doc.version; }
    return doc.data.__signed;
  }

  /**
   * fn(bytes, doc) → bytes: trasformazioni applicate al momento del salvataggio, in ordine crescente
   * di `order` (predefinito 50; la cifratura dell'area sicurezza usa 100 per girare per ultima).
   * Un hook può aggiornare doc.password: la verifica del file salvato usa il valore aggiornato.
   */
  registerSaveHook(fn, { order = 50 } = {}) {
    this.saveHooks.push(Object.assign(fn, { __order: order }));
    this.saveHooks.sort((a, b) => (a.__order ?? 50) - (b.__order ?? 50));
  }

  /** Byte correnti del documento, compresi i valori dei moduli compilati a schermo. */
  async currentBytes(doc = this.activeDoc) {
    if (doc.pdf && doc.pdf.annotationStorage.size > 0 && doc.formsDirty) {
      const saved = await doc.pdf.saveDocument();
      doc.replaceBytes(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
      doc.formsDirty = false;
    }
    return doc.bytes;
  }

  /**
   * Applica una modifica annullabile al documento (di default quello attivo).
   * fn(bytes, doc) → Promise<Uint8Array>. La vista mantiene pagina e zoom.
   * Le modifiche allo stesso documento sono eseguite una alla volta (coda): due chiamate
   * contemporanee non si intrecciano. Il risultato viene verificato con pdf.js prima di
   * essere accettato: se non è un PDF leggibile, il documento resta com'era.
   * NB: non chiamare applyEdit/undo/save dello stesso documento dall'interno di fn (attenderebbe sé stessa).
   */
  async applyEdit(label, fn, doc = this.activeDoc, { signatureWarning = true } = {}) {
    if (!doc) throw new Error('Nessun documento aperto');
    if (signatureWarning && !(await this.#confirmSignedEdit(doc))) return false;
    if (!(await this.#confirmRestrictedEdit(doc))) return false;
    return this.#exclusive(doc, label, async () => {
      const before = await this.currentBytes(doc);
      const after = await fn(before, doc);
      if (!after || after === before || doc.closed) return false;
      const next = after instanceof Uint8Array ? after : new Uint8Array(after);
      if (next.length === 0) throw new Error(`«${label}» ha prodotto un file vuoto: il documento non è stato modificato.`);
      if (next.length > MAX_PDF_BYTES) throw new Error(`«${label}» produrrebbe un file oltre i 2 GB: il documento non è stato modificato.`);
      let pdf;
      try { pdf = await doc.openCandidate(next); }
      catch (err) { throw new Error(`«${label}» ha prodotto un PDF non leggibile (${err?.message || err}). Il documento non è stato modificato.`); }
      if (doc.closed) { destroyPdf(pdf); return false; }
      // la copia per Annulla (su disco nell'app) prosegue in sottofondo; Annulla la attende
      doc.commit(label, next).catch((err) => log('error', 'cronologia: copia non salvata', { error: String(err?.message || err) }));
      await this.#swapPdf(doc, pdf);
      this.bus.emit('document:changed', { doc, label });
      toast(label, { kind: 'success', timeout: 2600, action: { label: 'Annulla', run: () => this.undo(doc) } });
      return true;
    });
  }

  /** Come applyEdit ma con un PDFDocument di pdf-lib già aperto: fn(pdfDoc, PDFLib, doc). */
  async editWithPdfLib(label, fn, doc = this.activeDoc, opts) {
    return this.applyEdit(label, async (bytes) => {
      const pdfDoc = await openPdfLib(bytes, doc.password);
      const r = await fn(pdfDoc, PDFLib, doc);
      if (r === false) return null;
      return savePdfLib(pdfDoc);
    }, doc, opts);
  }

  /**
   * Prima modifica a un documento firmato: avvisa una volta per documento.
   * «Lavora su una copia» toglie il percorso (il salvataggio chiederà un nuovo nome: l'originale firmato resta intatto).
   */
  /** Permessi del PDF che vietano la modifica: per ora solo un avviso, una volta per documento. */
  async #confirmRestrictedEdit(doc) {
    if (doc.data.__permAck || !doc.pdf) return true;
    let perms = null;
    try { perms = await doc.pdf.getPermissions(); } catch { perms = null; }
    const F = pdfjs.PermissionFlag || {};
    if (!perms || perms.includes(F.MODIFY_CONTENTS ?? 8)) { doc.data.__permAck = true; return true; }
    const v = await ui.choice({
      title: 'Modifiche limitate dall\'autore',
      message: `L'autore ha limitato le modifiche a «${doc.name}». Vuoi continuare comunque?`,
      buttons: [{ value: 'cancel', label: 'Lascia perdere' }, { value: 'ok', label: 'Continua', primary: true }],
    });
    if (v !== 'ok') return false;
    doc.data.__permAck = true;
    return true;
  }

  async #confirmSignedEdit(doc) {
    if (doc.data.__signatureAck || !this.isSigned(doc)) return true;
    const v = await ui.choice({
      title: 'Documento firmato digitalmente',
      message: `«${doc.name}» contiene una firma digitale. Modificarlo annulla la validità della firma. Vuoi lavorare su una copia, così il file firmato resta intatto?`,
      buttons: [{ value: 'cancel', label: 'Lascia perdere' }, { value: 'anyway', label: 'Modifica questo file' }, { value: 'copy', label: 'Lavora su una copia', primary: true }],
    });
    if (!v || v === 'cancel') return false;
    doc.data.__signatureAck = true;
    if (v === 'copy') {
      doc.path = null;
      doc.name = doc.name.replace(/(\.pdf)?$/i, '_copia.pdf');
      doc.dirty = true;
      this.#renderTabs(); this.#updateTitle();
      toast(`Stai lavorando su «${doc.name}»: al salvataggio sceglierai dove metterla.`, { timeout: 8000 });
    }
    this.bus.emit('document:signature-warning', { doc, choice: v });
    return true;
  }

  /** Esegue fn nella coda del documento (operazioni serializzate). Utile alle feature per operazioni lunghe che leggono e poi modificano. */
  runExclusive(doc, label, fn) { return this.#exclusive(doc, label, fn); }

  #exclusive(doc, label, fn) {
    if (!doc.queue.onChange) doc.queue.onChange = () => { if (doc === this.activeDoc) this.#updateBusy(); };
    return doc.queue.run(label, fn);
  }

  /** Apre byte come nuova scheda. opts: { name, path, dirty } */
  async openBytes(bytes, { name, path, dirty = false, _repaired = false } = {}) {
    const existing = path && this.docs.find((d) => d.path === path);
    if (existing) { this.activate(existing); return existing; }
    const displayName = name || 'Senza titolo.pdf';
    const pre = precheck(bytes, displayName);
    if (pre) { this.#openFailed(pre, displayName); return null; }
    const doc = new Doc({ name, path, bytes });
    const askPw = (reason) => ui.prompt(reason === 2 ? 'Password errata, riprova:' : `«${doc.name}» è protetto. Inserisci la password:`, '', { title: 'Documento protetto', type: 'password', okLabel: 'Apri' });
    // i file grandi mostrano l'avanzamento (annullabile) se l'apertura supera qualche istante
    const ctrl = new AbortController();
    let prog = null;
    const timer = setTimeout(() => {
      prog = ui.progress(`Apertura di «${doc.name}»`);
      prog.signal.addEventListener('abort', () => ctrl.abort());
      prog.set(null, formatBytes(bytes.length));
    }, bytes.length > 20 * MB ? 0 : 1200);
    try {
      await doc.load(askPw, {
        signal: ctrl.signal,
        onProgress: ({ loaded, total }) => prog?.set(total ? loaded / total : null),
      });
      if (!doc.pageCount) throw new Error('Il documento non contiene pagine leggibili');
    } catch (err) {
      doc.destroy();
      clearTimeout(timer); prog?.close();
      if (err?.name === 'AbortError') { toast('Apertura interrotta'); return null; }
      if (err?.name === 'PasswordException') { if (/non inserita/.test(err.message)) toast('Apertura annullata'); else this.#openFailed(describeOpenError(err, bytes, displayName), displayName); return null; }
      log('warn', 'apertura non riuscita', { name: displayName, size: bytes.length, error: String(err?.message || err) });
      // ultimo tentativo: riparazione (file troncati, xref/trailer mancanti)
      const kind = sniff(bytes).kind;
      if (!_repaired && (kind === 'pdf' || kind === 'pdf-offset')) {
        const rep = await repairPdf(bytes);
        if (rep) {
          log('info', 'file riparato', { name: displayName, pages: rep.pages });
          const fixed = await this.openBytes(rep.bytes, { name: displayName.replace(/(\.pdf)?$/i, ' (riparato).pdf'), dirty: true, _repaired: true });
          if (fixed) dialog({ title: 'Documento riparato', message: `«${displayName}» era danneggiato e non poteva essere letto così com'è. Leggio ne ha recuperato ${fixed.pageCount} ${fixed.pageCount === 1 ? 'pagina' : 'pagine'}: controlla che il contenuto sia completo e salvalo con un nuovo nome. L'originale non è stato modificato.`, cancelLabel: null, okLabel: 'Ho capito' });
          return fixed;
        }
      }
      this.#openFailed(describeOpenError(err, bytes, displayName), displayName);
      return null;
    } finally { clearTimeout(timer); prog?.close(); }
    if (dirty) doc.dirty = true;
    this.#watchForms(doc);
    this.docs.push(doc);
    this.activate(doc);
    this.bus.emit('document:loaded', { doc });
    return doc;
  }

  #openFailed(message, name) {
    dialog({ title: 'Impossibile aprire il documento', message, cancelLabel: null, okLabel: 'Chiudi' });
    this.bus.emit('document:open-failed', { name, message });
  }

  async openDialog() {
    const exts = [...new Set(this.openers.flatMap((o) => o.extensions))];
    const filters = exts.length
      ? [{ name: 'Documenti PDF e file firmati', extensions: ['pdf', ...exts] }, { name: 'Documenti PDF', extensions: ['pdf'] }, { name: 'Tutti i file', extensions: ['*'] }]
      : [{ name: 'Documenti PDF', extensions: ['pdf'] }];
    let files;
    try { files = await platform.openFiles({ multiple: true, filters }); }
    catch (err) { this.#openFailed(cleanIpcMessage(err?.message || err), 'file'); return; }
    for (const f of files) await this.openFile(f);
  }

  /** Apre un percorso (solo app desktop), es. dai recenti. */
  async openPath(p) {
    try { const f = await platform.readFile(p); if (f) return this.openFile(f); }
    catch (err) { this.#openFailed(cleanIpcMessage(err?.message || err), p.split(/[\\/]/).pop()); }
    return null;
  }

  activate(doc) {
    if (this.activeDoc === doc && (doc || this.viewer.doc == null)) return;
    const prev = this.activeDoc;
    this.tools.deactivate();
    if (prev) this.viewer.saveViewState();
    // lo stato appartiene al documento: ricerca e pannello destro del documento precedente si chiudono
    if (prev && prev !== doc) {
      if (!this.el.findbar.hidden) this.closeFind();
      if (this.rightPanelDoc && this.rightPanelDoc !== doc) this.closeRightPanel({ notify: true });
      this.bus.emit('document:deactivated', { doc: prev, next: doc });
    }
    this.activeDoc = doc;
    this.el.root.classList.toggle('has-doc', !!doc);
    this.viewer.setDocument(doc);
    this.#renderTabs();
    this.#updateTitle();
    this.sidebar.refresh();
    this.#updateBusy();
    this.bus.emit('document:activated', { doc });
  }

  async closeDoc(doc = this.activeDoc) {
    if (!doc || doc.closed) return true;
    if (doc.busy) {
      // un'operazione è in corso su questo documento: si aspetta che finisca, poi si chiude
      const t = toast(`Attendo la fine di «${doc.queue.current}» prima di chiudere…`, { timeout: 60000 });
      await doc.queue.idle();
      t.remove();
      if (doc.closed) return true;
    }
    if (doc.dirty || doc.formsDirty) {
      if (this.activeDoc !== doc) this.activate(doc);
      const v = await ui.choice({
        title: 'Modifiche non salvate',
        message: `Vuoi salvare le modifiche a «${doc.name}» prima di chiudere?`,
        buttons: [{ value: 'discard', label: 'Non salvare', left: true }, { value: 'cancel', label: 'Annulla' }, { value: 'save', label: 'Salva', primary: true }],
      });
      if (!v || v === 'cancel' || doc.closed) return false;
      if (v === 'save' && !(await this.save(doc))) return false;
    }
    await doc.queue.idle();
    if (doc.closed) return true;
    const i = this.docs.indexOf(doc);
    if (i >= 0) this.docs.splice(i, 1);
    if (this.activeDoc === doc) { this.tools.deactivate(); this.activeDoc = null; this.activate(this.docs[Math.min(i, this.docs.length - 1)] || null); }
    doc.destroy();
    this.#renderTabs();
    if (!this.docs.length) this.#renderHome();
    this.bus.emit('document:closed', { doc });
    return true;
  }

  /** Byte pronti da scrivere (moduli + save hook). */
  async bytesForSave(doc = this.activeDoc) {
    let bytes = await this.currentBytes(doc);
    for (const hook of this.saveHooks) bytes = (await hook(bytes, doc)) || bytes;
    return bytes;
  }

  /**
   * Salva (o Salva con nome). Passa dalla coda del documento: non si intreccia con modifiche o Annulla.
   * I byte vengono verificati con pdf.js prima di toccare il file su disco; la scrittura nel main è
   * atomica e controllata (vedi electron/core/safe-write.cjs). → true se salvato.
   */
  async save(doc = this.activeDoc, { as = false } = {}) {
    if (!doc || doc.closed) return false;
    try {
      return await this.#exclusive(doc, 'Salvataggio', async () => {
        const version = doc.version;
        const bytes = await this.bytesForSave(doc);
        if (bytes.length > MAX_PDF_BYTES) throw new Error('Il documento supera i 2 GB e non può essere salvato. Riduci le immagini (Comprimi) o dividilo in più file.');
        try { await verifyPdfBytes(bytes, doc.password); }
        catch (err) { throw new Error(`Il documento da salvare non risulta un PDF valido (${err?.message || err}). Il file su disco non è stato toccato.`); }
        if (doc.path && !as) await platform.writeFile(doc.path, bytes);
        else {
          const r = await platform.saveAs(bytes, doc.name);
          if (!r) return false;
          if (r.path) { doc.path = r.path; doc.name = r.name; }
        }
        doc.replaceBytes(bytes);
        if (doc.version === version) doc.markSaved();
        this.#renderTabs(); this.#updateTitle();
        toast(`Salvato: ${doc.name}`, { kind: 'success' });
        this.bus.emit('document:saved', { doc });
        return true;
      });
    } catch (err) {
      if (err?.name === 'QueueClosedError') return false;
      this.reportError(err, 'Salvataggio non riuscito');
      return false;
    }
  }

  /** Esporta byte arbitrari (es. conversioni) con dialogo "Salva con nome". */
  async exportFile(bytes, defaultName, filters) { return platform.saveAs(bytes, defaultName, filters); }

  async undo(doc = this.activeDoc) { return this.#history(doc, 'undo'); }
  async redo(doc = this.activeDoc) { return this.#history(doc, 'redo'); }

  async #history(d, dir) {
    if (!d || d.closed) return;
    try {
      await this.#exclusive(d, dir === 'undo' ? 'Annulla' : 'Ripeti', async () => {
        const prev = { bytes: d.bytes, version: d.version };
        const label = dir === 'undo' ? await d.undo() : await d.redo();
        if (!label) { toast(dir === 'undo' ? 'Niente da annullare' : 'Niente da ripetere'); return; }
        let pdf;
        try { pdf = await d.openCandidate(d.bytes); }
        catch (err) {
          // lo stato recuperato non si apre (non dovrebbe succedere): si torna indietro
          dir === 'undo' ? await d.redo() : await d.undo();
          d.bytes = prev.bytes; d.version = prev.version;
          throw err;
        }
        if (d.closed) { destroyPdf(pdf); return; }
        await this.#swapPdf(d, pdf);
        toast((dir === 'undo' ? 'Annullato: ' : 'Ripetuto: ') + label);
        this.bus.emit('document:changed', { doc: d, label: dir });
      });
    } catch (err) {
      if (err?.name !== 'QueueClosedError') this.reportError(err, dir === 'undo' ? 'Annulla non riuscito' : 'Ripeti non riuscito');
    }
  }

  /** Sposta pagine (indici 0-based) prima della posizione target. */
  async movePages(indices, target) {
    const doc = this.activeDoc; const n = doc.pageCount;
    const moving = [...new Set(indices)].sort((a, b) => a - b);
    const rest = [...Array(n).keys()].filter((i) => !moving.includes(i));
    const insertAt = rest.filter((i) => i < target).length;
    const order = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
    if (order.every((v, i) => v === i)) return;
    await this.reorderPages(order, moving.length === 1 ? 'Pagina spostata' : 'Pagine spostate');
  }
  /** Riordina secondo order (array di indici 0-based vecchi). */
  async reorderPages(order, label = 'Pagine riordinate', doc = this.activeDoc) {
    // riordino "in place" ricostruendo l'albero delle pagine (core/pagetree.js): stessi oggetti pagina,
    // così annotazioni e campi modulo restano validi
    return this.editWithPdfLib(label, async (src) => { reorderPdfPages(src, order); }, doc);
  }

  reportError(err, context = 'Errore') {
    console.error(context, err);
    log('error', context, { message: String(err?.message || err), stack: err?.stack });
    const msg = cleanIpcMessage(err?.message || String(err));
    dialog({ title: context, message: msg, cancelLabel: null, okLabel: 'Chiudi' });
  }

  parsePages(str) { return parsePageRanges(str, this.activeDoc.pageCount); }

  // ======================= interni =======================

  /** Sostituisce il proxy pdf.js del documento aggiornando la vista, poi libera il vecchio. */
  async #swapPdf(doc, pdf) {
    const old = doc.setPdf(pdf);
    this.#watchForms(doc);
    if (doc === this.activeDoc) { await this.viewer.reloadKeepingView(); this.sidebar.refresh(); }
    destroyPdf(old);
    this.#renderTabs(); this.#updateTitle(); this.#updateNav();
  }

  #setupHistory() {
    // tetto di memoria: dalla RAM del computer (nell'app) o dalle informazioni del browser
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    let memInfo = { deviceMemoryGB: nav.deviceMemory, heapLimit: performance?.memory?.jsHeapSizeLimit };
    let diskFree = 0;
    const backend = platform.historyBackend();
    platform.memoryInfo().then((m) => { if (m) { memInfo = { ...memInfo, totalMemory: m.total }; diskFree = m.diskFree || 0; } }).catch(() => {});
    const trimmedOnce = new WeakSet();
    historyConfig.makeHistory = (doc) => new History({
      disk: backend ? new DiskStore(backend) : null,
      memoryBudget: () => memoryBudget(memInfo),
      diskBudget: () => diskBudget(diskFree),
      onTrim: ({ reason }) => {
        if (reason === 'count' || trimmedOnce.has(doc)) return;
        trimmedOnce.add(doc);
        toast(`Cronologia di «${doc.name}» accorciata: per non esaurire la ${reason === 'disk' ? 'spazio su disco' : 'memoria'} si potranno annullare solo le modifiche più recenti.`, { kind: 'warning', timeout: 8000 });
        log('info', 'cronologia accorciata', { reason, size: doc.bytes.length });
      },
    });
  }

  #updateBusy() {
    const d = this.activeDoc;
    const busy = !!d?.busy;
    this.el.root.classList.toggle('doc-busy', busy);
    this.#updateNav();
  }

  #watchForms(doc) {
    const st = doc.pdf.annotationStorage;
    st.onSetModified = () => { doc.formsDirty = true; doc.formsRev++; this.#renderTabs(); this.#updateTitle(); this.bus.emit('document:forms-changed', { doc }); };
  }

  #updateTitle() {
    const d = this.activeDoc;
    if (this.el) this.#updateNav();
    platform.setTitle(d ? `${d.dirty || d.formsDirty ? '• ' : ''}${d.name} — Leggio` : 'Leggio');
  }

  #buildShell(root) {
    root.innerHTML = '';
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Documenti aperti' });
    const titlebar = h('div', { class: 'titlebar' + (isMac ? ' mac' : '') },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: logoSvg() }), h('span', {}, 'Leggio')),
      tabs);
    // short = etichetta visibile sotto l'icona (Impostazioni › Etichette nella barra)
    const btn = (ic, label, cmd, extra = {}, short) => {
      const b = h('button', { class: 'icon-btn' + (short ? ' has-label' : ''), title: label, 'aria-label': label, 'data-cmd': cmd, html: icon(ic), ...extra });
      if (extra.class && short) b.classList.add('has-label');
      if (short) b.append(h('span', { class: 'tb-label', 'aria-hidden': 'true' }, short));
      return b;
    };
    const pageInput = h('input', { class: 'page-input', type: 'text', inputmode: 'numeric', 'aria-label': 'Numero di pagina' });
    const pageTotal = h('span', { class: 'page-total' }, '/ 0');
    const zoomSel = h('select', { class: 'zoom-select', 'aria-label': 'Zoom' },
      [['auto', 'Automatico'], ['page-fit', 'Pagina intera'], ['page-width', 'Larghezza pagina'], ['page-actual', 'Dimensioni reali'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%'], ['custom', '']].map(([v, l]) => h('option', { value: v, hidden: v === 'custom' }, l)));
    const quick = h('div', { class: 'quick-tools' });
    const moreTools = h('button', { class: 'icon-btn has-label needs-doc more-tools', hidden: true, title: 'Altri strumenti', 'aria-label': 'Altri strumenti', 'aria-haspopup': 'menu', html: icon('tools') }, h('span', { class: 'tb-label', 'aria-hidden': 'true' }, 'Altri strumenti'));
    moreTools.addEventListener('click', () => this.#openMoreTools(moreTools));
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Barra degli strumenti' },
      h('div', { class: 'tb-group' }, btn('open', `Apri (${modKey}O)`, 'open', {}, 'Apri'), btn('save', `Salva (${modKey}S)`, 'save', { class: 'icon-btn needs-doc' }, 'Salva'), btn('saveAs', `Salva con nome (${modKey}⇧S)`, 'save-as', { class: 'icon-btn needs-doc' }, 'Salva con nome'), btn('print', `Stampa (${modKey}P)`, 'print', { class: 'icon-btn needs-doc' }, 'Stampa')),
      h('div', { class: 'tb-sep' }),
      h('div', { class: 'tb-group needs-doc' }, btn('undo', `Annulla (${modKey}Z)`, 'undo', {}, 'Annulla'), btn('redo', `Ripeti (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`, 'redo', {}, 'Ripeti')),
      h('div', { class: 'tb-sep' }),
      h('div', { class: 'tb-group needs-doc' }, btn('pointer', 'Selezione testo (V)', 'mode-select', { class: 'icon-btn mode-btn active' }, 'Seleziona'), btn('hand', 'Mano: trascina la pagina (H, o tieni premuto Spazio)', 'mode-hand', { class: 'icon-btn mode-btn' }, 'Mano')),
      h('div', { class: 'tb-group needs-doc nav' }, btn('chevronUp', 'Pagina precedente', 'prev-page'), pageInput, pageTotal, btn('chevronDown', 'Pagina successiva', 'next-page')),
      h('div', { class: 'tb-group needs-doc' }, btn('minus', 'Riduci', 'zoom-out'), zoomSel, btn('plus', 'Ingrandisci', 'zoom-in'), btn('rotate', `Ruota la visualizzazione (non modifica il file) (${modKey}R)`, 'rotate-view')),
      h('div', { class: 'tb-spacer' }),
      quick, moreTools,
      h('div', { class: 'tb-group' }, btn('search', `Trova (${modKey}F)`, 'find', { class: 'icon-btn needs-doc' }, 'Trova'),
        h('button', { class: 'btn tools-btn', 'data-cmd': 'tools', title: `Tutti gli strumenti (${modKey}K)`, html: icon('tools', 16) + '<span>Strumenti</span>' }),
        btn('settings', 'Impostazioni', 'settings', {}, 'Impostazioni')));
    const toolOptions = h('div', { class: 'tool-options', hidden: true, role: 'toolbar', 'aria-label': 'Opzioni strumento' });
    const findbar = h('div', { class: 'findbar', hidden: true, role: 'search' });
    const rail = h('nav', { class: 'rail', 'aria-label': 'Pannelli' });
    const sideBody = h('aside', { class: 'side', 'aria-label': 'Barra laterale' });
    const viewerContainer = h('div', { class: 'viewer-container', tabindex: 0, 'data-mode': 'select' }, h('div', { class: 'pdfViewer' }));
    const home = h('div', { class: 'home' });
    const right = h('aside', { class: 'right-panel', hidden: true, 'aria-label': 'Pannello strumento' });
    const main = h('main', { class: 'main' }, h('div', { class: 'stage' }, viewerContainer, home), right);
    const status = h('footer', { class: 'statusbar' });
    const body = h('div', { class: 'body' }, rail, sideBody, h('div', { class: 'center' }, toolOptions, findbar, main));
    const app = h('div', { class: 'app sidebar-closed' }, titlebar, toolbar, body, status);
    root.append(app, h('div', { id: 'overlay-root' }), h('div', { id: 'toast-root', 'aria-live': 'polite' }), h('div', { id: 'print-root' }));
    // la barra si ridispone quando cambia la larghezza (finestra, zoom dell'interfaccia, etichette)
    new ResizeObserver(() => { if (!this.layoutPending) { this.layoutPending = true; requestAnimationFrame(() => { this.layoutPending = false; this.layoutToolbar(); }); } }).observe(toolbar);
    return { root: app, tabs, toolbar, quick, moreTools, pageInput, pageTotal, zoomSel, toolOptions, findbar, rail, sideBody, viewerContainer, home, right, status, main };
  }

  /** Pannello destro per strumenti con molte opzioni. → container (svuotato). close() lo nasconde. */
  /**
   * Pannello destro. Appartiene a un documento (predefinito: quello attivo; `doc: null` = pannello
   * generale): al cambio di scheda viene chiuso e onClose() chiamato. → container (svuotato).
   */
  openRightPanel(title, { onClose, doc } = {}) {
    if (this.rightPanelOnClose) { const f = this.rightPanelOnClose; this.rightPanelOnClose = null; try { f(); } catch (err) { console.error(err); } }
    const r = this.el.right; r.innerHTML = ''; r.hidden = false;
    this.rightPanelDoc = doc === undefined ? this.activeDoc : doc;
    this.rightPanelOnClose = onClose || null;
    const c = h('div', { class: 'right-content' });
    r.append(h('header', { class: 'side-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', title: 'Chiudi il pannello', 'aria-label': 'Chiudi il pannello', onclick: () => this.closeRightPanel({ notify: true }), html: icon('close') })), c);
    return c;
  }
  /** Chiude il pannello destro; con notify chiama anche l'onClose di chi l'ha aperto. */
  closeRightPanel({ notify = false } = {}) {
    const f = this.rightPanelOnClose; this.rightPanelOnClose = null; this.rightPanelDoc = null;
    this.el.right.hidden = true; this.el.right.innerHTML = '';
    if (notify && f) { try { f(); } catch (err) { console.error(err); } }
  }

  #renderTabs() {
    const t = this.el.tabs; t.innerHTML = '';
    for (const d of this.docs) {
      const unsaved = d.dirty || d.formsDirty;
      const tab = h('div', { class: 'tab' + (d === this.activeDoc ? ' active' : '') + (unsaved ? ' dirty' : ''), role: 'tab', 'aria-selected': String(d === this.activeDoc), title: (d.path || d.name) + (unsaved ? ' — modifiche non salvate' : ''), tabindex: 0 },
        h('span', { class: 'tab-name' }, d.name),
        h('button', { class: 'tab-close', title: 'Chiudi ' + d.name, 'aria-label': 'Chiudi ' + d.name, onclick: (e) => { e.stopPropagation(); this.closeDoc(d); }, html: icon('close', 13) }));
      tab.addEventListener('click', () => this.activate(d));
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) this.closeDoc(d); });
      tab.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.activate(d); });
      t.append(tab);
    }
    t.append(h('button', { class: 'tab-new', title: 'Apri un PDF', 'aria-label': 'Apri un PDF', onclick: () => this.openDialog(), html: icon('plus', 15) }));
  }

  async #renderHome() {
    const token = (this.homeToken = (this.homeToken || 0) + 1);
    const home = this.el.home;
    const recent = await platform.recent().catch(() => []);
    if (token !== this.homeToken) return; // nel frattempo è partito un altro disegno
    home.innerHTML = '';
    const featured = ['create-pdf', 'merge', 'compress', 'ocr', 'sign', 'protect', 'redact', 'convert-word', 'compare', 'fill-sign', 'organize'];
    const quick = featured.map((id) => this.tools.get(id)).filter(Boolean);
    home.append(h('div', { class: 'home-inner' },
      h('section', { class: 'home-hero' },
        h('div', { class: 'home-mark', html: logoSvg(56) }),
        h('h1', {}, 'Leggio'),
        h('p', { class: 'lead' }, 'Leggi, commenta, modifica, firma e converti i PDF. Tutte le funzioni, nessun abbonamento, nessun account. I tuoi file non lasciano mai il computer.'),
        h('div', { class: 'home-actions' },
          h('button', { class: 'btn primary big', onclick: () => this.openDialog(), html: icon('open') + `<span>Apri un PDF</span>` }),
          h('button', { class: 'btn big', onclick: () => this.tools.openHub(), html: icon('tools') + '<span>Tutti gli strumenti</span>' })),
        h('p', { class: 'drop-hint' }, 'oppure trascina qui i file')),
      quick.length ? h('section', { class: 'home-sec' }, h('h2', {}, 'Strumenti più usati'),
        h('div', { class: 'home-tools' }, quick.map((t) => h('button', { class: 'home-tool', onclick: () => this.tools.run(t.id) }, h('span', { class: 'hub-ico', html: icon(t.icon || 'tools', 22) }), h('strong', {}, t.name), h('small', {}, t.description || ''))))) : null,
      recent.length ? h('section', { class: 'home-sec' }, h('h2', {}, 'Recenti'),
        h('ul', { class: 'recent' }, recent.slice(0, 8).map((p) => h('li', {}, h('button', { class: 'recent-item', onclick: () => this.openPath(p) }, h('span', { html: icon('file', 16) }), h('span', { class: 'recent-name' }, p.split(/[\\/]/).pop()), h('small', {}, p)))))) : null));
  }

  #scheduleToolsChanged() {
    if (this.toolsTimer) return;
    this.toolsTimer = setTimeout(() => { this.toolsTimer = null; this.#renderQuickTools(); this.#syncToolsMenu(); }, 0);
  }
  /** Menu nativo «Strumenti» (app desktop): categorie e nomi (con il nome Acrobat se c'è). */
  #syncToolsMenu() {
    if (!platform.isElectron) return;
    const groups = CATEGORIES.map(([cat, label]) => ({
      label,
      items: this.tools.list().filter((t) => t.category === cat && !t.hidden).map((t) => ({ id: t.id, label: t.acrobatName && t.acrobatName !== t.name ? `${t.name} (${t.acrobatName})` : t.name })),
    })).filter((g) => g.items.length);
    platform.setToolsMenu(groups).catch(() => {});
  }

  #renderQuickTools() {
    const q = this.el.quick; q.innerHTML = '';
    this.quickList = this.tools.list().filter((t) => t.quick && !t.hidden).sort((a, b) => (a.quickOrder ?? 50) - (b.quickOrder ?? 50));
    for (const t of this.quickList) {
      const b = h('button', { class: 'icon-btn has-label needs-doc quick-btn', 'data-tool-id': t.id, title: t.name + (t.shortcut ? ` (${t.shortcut})` : ''), 'aria-label': t.name, onclick: () => this.tools.run(t.id), html: icon(t.icon || 'tools') });
      b.append(h('span', { class: 'tb-label', 'aria-hidden': 'true' }, t.quickLabel || shortLabel(t.name)));
      q.append(b);
    }
    this.layoutToolbar();
    if (!this.docs.length) this.#renderHome();
  }

  /**
   * Barra adattiva: niente scorrimento orizzontale. Gli strumenti rapidi che non ci stanno finiscono
   * nel pulsante «Altri strumenti»; se nemmeno così basta, la barra va a capo.
   */
  layoutToolbar() {
    const tb = this.el.toolbar;
    if (!tb || !this.el.moreTools || !tb.clientWidth) return;
    // Livelli di compattazione, dal meno al più invasivo, finché si vedono almeno 4 strumenti rapidi:
    // 1 = via i pulsanti −/+ dello zoom e le frecce pagina (restano tendina, campo pagina, scorciatoie e menu Vista);
    // 2 = via anche «Ruota la visualizzazione» (resta nel menu Vista e con ⌘/Ctrl+R);
    // 3 = pulsanti con etichetta più stretti.
    const want = Math.min(4, this.el.quick.querySelectorAll('.quick-btn').length);
    let n = 0;
    for (const level of [0, 1, 2, 3]) {
      tb.classList.toggle('tb-compact1', level >= 1);
      tb.classList.toggle('tb-compact2', level >= 2);
      tb.classList.toggle('tb-compact3', level >= 3);
      n = this.#fitQuick();
      if (n >= want) break;
    }
    // non bastano ancora (finestra stretta, caratteri grandi): gli strumenti rapidi vanno su una seconda riga
    // (con la seconda riga, la prima torna completa se ci sta: zoom −/+, frecce pagina, ruota)
    if (n < want) {
      const first = tb.firstElementChild; const lastFixed = this.el.toolbar.querySelector(':scope > .tb-group:last-child');
      for (const level of [0, 1, 2, 3]) {
        tb.classList.toggle('tb-compact1', level >= 1);
        tb.classList.toggle('tb-compact2', level >= 2);
        tb.classList.toggle('tb-compact3', level >= 3);
        this.#fitQuick({ ownRow: true });
        if (!lastFixed || Math.abs(lastFixed.offsetTop - first.offsetTop) < 4) break;
      }
    }
    if (tb.scrollWidth > tb.clientWidth + 2) tb.classList.add('wrap');
  }

  /** Mostra quanti più strumenti rapidi possibile, misurando le larghezze reali. → quanti visibili. */
  #fitQuick({ ownRow = false } = {}) {
    const tb = this.el.toolbar; const more = this.el.moreTools; const quick = this.el.quick;
    const btns = [...quick.querySelectorAll('.quick-btn')];
    tb.classList.remove('wrap');
    tb.classList.toggle('quick-row', ownRow);
    btns.forEach((b) => (b.hidden = false));
    more.hidden = false;
    const cs = getComputedStyle(tb);
    const gap = parseFloat(cs.columnGap) || 0;
    const inner = tb.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const outer = (el) => { const st = getComputedStyle(el); return el.offsetWidth + (parseFloat(st.marginLeft) || 0) + (parseFloat(st.marginRight) || 0); };
    // le parti fisse si misurano senza strumenti rapidi; nessun elemento della barra si restringe (flex-shrink: 0)
    quick.hidden = true;
    const kids = [...tb.children].filter((el) => !el.hidden && getComputedStyle(el).display !== 'none' && el !== more && !el.classList.contains('tb-spacer'));
    let fixed = 0;
    if (!ownRow) for (const el of kids) fixed += outer(el);
    else kids.length = 0; // sulla seconda riga ci sono solo gli strumenti rapidi e «Altri strumenti»
    quick.hidden = false;
    const qs = getComputedStyle(quick);
    const qGap = parseFloat(qs.columnGap) || 0;
    const qChrome = ['paddingLeft', 'paddingRight', 'marginLeft', 'marginRight', 'borderLeftWidth', 'borderRightWidth'].reduce((t, k) => t + (parseFloat(qs[k]) || 0), 0);
    const widths = btns.map((b) => b.offsetWidth);
    const moreW = outer(more);
    // elementi in riga: fissi + contenitore rapidi (+ «Altri strumenti»); lo spaziatore vale 0 ma ha il suo gap
    const room = (withMore) => inner - fixed - (kids.length + 1 + (withMore ? 1 : 0)) * gap - (withMore ? moreW : 0) - qChrome;
    const fitCount = (avail) => { let w = 0; let k = 0; for (const x of widths) { const add = x + (k ? qGap : 0); if (w + add > avail) break; w += add; k++; } return k; };
    let n = fitCount(room(false));
    const showMore = n < btns.length;
    if (showMore) n = fitCount(room(true));
    btns.forEach((b, i) => (b.hidden = i >= n));
    more.hidden = !showMore;
    quick.hidden = n === 0;
    this.hiddenQuick = btns.filter((b) => b.hidden).map((b) => b.dataset.toolId);
    return n;
  }
  #openMoreTools(anchor) {
    const r = anchor.getBoundingClientRect();
    const items = (this.hiddenQuick || []).map((id) => this.tools.get(id)).filter(Boolean).map((t) => ({ label: t.name, icon: t.icon || 'tools', run: () => this.tools.run(t.id) }));
    contextMenu(r.left, r.bottom + 4, [...items, '-', { label: 'Tutti gli strumenti…', icon: 'tools', run: () => this.tools.openHub() }]);
  }

  #updateNav() {
    const d = this.activeDoc;
    this.el.pageTotal.textContent = '/ ' + (d?.pageCount || 0);
    if (document.activeElement !== this.el.pageInput) this.el.pageInput.value = d ? String(this.viewer.page) : '';
    const pv = this.viewer.pdfViewer;
    const sv = String(pv.currentScaleValue);
    const sel = this.el.zoomSel;
    const match = [...sel.options].find((o) => o.value === sv);
    if (match) sel.value = sv;
    else { const c = sel.querySelector('option[value=custom]'); c.textContent = Math.round((pv.currentScale || 1) * 100) + '%'; sel.value = 'custom'; }
    const st = this.el.status; st.textContent = '';
    if (d) {
      if (d.dirty || d.formsDirty) st.append(h('span', { class: 'status-dirty' }, 'Modifiche non salvate ·'));
      st.append(`${d.busy ? `In corso: ${d.queue.current}… · ` : ''}${d.pageCount} pagine · ${formatBytes(d.bytes.length)}${(d.bytes.length < 64 * MB ? this.isSigned(d) : d.data.__signed) ? ' · firmato digitalmente' : ''}${d.password ? ' · protetto da password' : ''}${d.path ? ' · ' + d.path : ''}`);
    }
  }

  /** Preferenze di leggibilità: { large?: bool, zoom?: number, labels?: bool }. Ricordate nelle impostazioni. */
  setUiPrefs({ large, zoom, labels } = {}) {
    if (large != null) this.settings.set('uiLarge', !!large);
    if (zoom != null) this.settings.set('uiZoom', zoom);
    if (labels != null) this.settings.set('toolbarLabels', !!labels);
    this.#applyUiPrefs();
    this.layoutToolbar();
    const z = this.uiZoom;
    toast(`Interfaccia al ${Math.round(z * 100)}%${this.settings.get('uiLarge', false) ? ' (caratteri e pulsanti grandi)' : ''}`);
  }
  /** Fattore di zoom dell'interfaccia effettivo (non quello della pagina). */
  get uiZoom() {
    const z = Number(this.settings.get('uiZoom', 1)) || 1;
    return this.settings.get('uiLarge', false) ? Math.max(1.25, z) : z;
  }
  #applyUiPrefs() {
    const root = document.documentElement;
    const large = !!this.settings.get('uiLarge', false);
    root.classList.toggle('ui-large', large);
    root.style.setProperty('--ui-zoom', String(this.uiZoom));
    this.el.root.classList.toggle('tb-labels', this.settings.get('toolbarLabels', true) !== false);
  }

  #applyTheme() {
    const t = this.settings.get('theme', 'system');
    document.documentElement.dataset.theme = t;
    platform.setTheme(t);
  }

  async command(id) {
    const v = this.viewer;
    const map = {
      open: () => this.openDialog(), save: () => this.save(), 'save-as': () => this.save(this.activeDoc, { as: true }),
      print: () => this.print(), properties: () => this.showProperties(), 'close-tab': () => this.closeDoc(),
      undo: () => this.undo(), redo: () => this.redo(), find: () => this.openFind(), tools: () => this.tools.openHub(),
      'zoom-in': () => v.zoomIn(), 'zoom-out': () => v.zoomOut(), 'zoom-reset': () => (v.scaleValue = 'page-actual'),
      'fit-width': () => (v.scaleValue = 'page-width'), 'fit-page': () => (v.scaleValue = 'page-fit'),
      'rotate-view': () => v.rotateView(90), 'toggle-sidebar': () => (this.el.root.classList.contains('sidebar-closed') ? this.sidebar.show(this.sidebar.current || 'thumbs') : this.sidebar.close()),
      'reading-mode': () => this.el.root.classList.toggle('reading'), 'toggle-theme': () => this.#cycleTheme(),
      'prev-page': () => (v.page -= 1), 'next-page': () => (v.page += 1),
      'mode-select': () => { this.tools.deactivate(); v.setMode('select'); this.#modeButtons('mode-select'); },
      'mode-hand': () => { this.tools.deactivate(); v.setMode('hand'); this.#modeButtons('mode-hand'); },
      settings: () => this.showSettings(), shortcuts: () => this.showShortcuts(),
      'open-logs': () => platform.openLogs(),
      'toggle-large-ui': () => this.setUiPrefs({ large: !this.settings.get('uiLarge', false) }),
      'ui-zoom-in': () => this.setUiPrefs({ zoom: stepZoom(this.settings.get('uiZoom', 1), +1) }),
      'ui-zoom-out': () => this.setUiPrefs({ zoom: stepZoom(this.settings.get('uiZoom', 1), -1) }),
      'ui-zoom-reset': () => this.setUiPrefs({ zoom: 1, large: false }),
    };
    if (id.startsWith('tool:')) return this.tools.run(id.slice(5));
    const needsDoc = !['open', 'tools', 'settings', 'shortcuts', 'toggle-theme', 'open-logs', 'toggle-large-ui', 'ui-zoom-in', 'ui-zoom-out', 'ui-zoom-reset'].includes(id);
    if (needsDoc && !this.activeDoc) return;
    // Annulla/Ripeti/Salva durante un'operazione vengono messi in coda (nessun clic perso); la stampa no
    if (id === 'print' && this.activeDoc?.busy) {
      toast(`Attendi: «${this.activeDoc.queue.current}» è ancora in corso`, { kind: 'warning' });
      return;
    }
    await map[id]?.();
  }
  #modeButtons(active) { this.el.toolbar.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.cmd === active)); }
  #cycleTheme() {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(this.settings.get('theme', 'system')) + 1) % 3];
    this.settings.set('theme', next); this.#applyTheme();
    toast('Tema: ' + { system: 'come il sistema', light: 'chiaro', dark: 'scuro' }[next]);
  }

  #wireCommands() {
    this.el.toolbar.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b) this.command(b.dataset.cmd); });
    this.el.pageInput.addEventListener('change', () => { const n = parseInt(this.el.pageInput.value, 10); if (n) this.viewer.page = n; this.#updateNav(); });
    this.el.pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.el.pageInput.blur(); });
    this.el.zoomSel.addEventListener('change', () => { if (this.el.zoomSel.value !== 'custom') this.viewer.scaleValue = this.el.zoomSel.value; });
    platform.on('app:command', (id) => { this.command(id); });
    platform.on('app:open-file', (f) => { if (f?.bytes) this.openBytes(f.bytes, f); else if (f?.path) this.openPath(f.path); });
    platform.on('app:open-recovery', () => { this.recovery?.offer(true); });
    platform.on('app:before-close', async () => {
      this.bus.emit('app:quitting', { docs: [...this.docs] });
      for (const d of [...this.docs]) if (!(await this.closeDoc(d))) { this.bus.emit('app:quit-cancelled'); return; }
      await this.recovery?.cleanExit();
      window.leggio.invoke('app:confirm-close');
    });
    platform.on('app:notify', ({ kind = 'info', message, title } = {}) => {
      if (kind === 'error') dialog({ title: title || 'Leggio', message, cancelLabel: null, okLabel: 'Chiudi' });
      else toast(message, { kind });
    });
    window.addEventListener('beforeunload', (e) => { if (!window.leggio && this.docs.some((d) => d.dirty || d.formsDirty)) e.preventDefault(); });
    document.addEventListener('keydown', (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !window.leggio) {
        // nel browser i menu nativi non esistono: replichiamo le scorciatoie principali
        const k = e.key.toLowerCase();
        if (e.shiftKey && ['+', '=', '-', '_'].includes(k)) { e.preventDefault(); this.command(k === '-' || k === '_' ? 'ui-zoom-out' : 'ui-zoom-in'); return; }
        const m = { o: 'open', s: e.shiftKey ? 'save-as' : 'save', p: 'print', f: 'find', k: 'tools', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', w: 'close-tab', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' }[k];
        if (m) { e.preventDefault(); this.command(m); return; }
      }
      if (isTyping(e) || mod || e.altKey) return;
      if (e.key === 'Escape') { if (this.tools.active) this.tools.deactivate(); else if (!this.el.findbar.hidden) this.closeFind(); else if (this.el.root.classList.contains('reading')) this.el.root.classList.remove('reading'); }
      if (!this.activeDoc) return;
      if (e.key === 'v' || e.key === 'V') this.command('mode-select');
      if (e.key === 'h' || e.key === 'H') this.command('mode-hand');
      if (e.key === 'PageDown' && this.viewer.pdfViewer.scrollMode === 3) this.viewer.page += 1;
      for (const t of this.tools.list()) if (t.shortcut && t.shortcut.length === 1 && e.key.toLowerCase() === t.shortcut.toLowerCase()) { e.preventDefault(); this.tools.run(t.id); return; }
    });
  }

  /** C'è una finestra modale aperta (dialogo, avanzamento, «Tutti gli strumenti», pannelli a schermo intero delle aree)? */
  modalOpen() {
    const layer = document.getElementById('overlay-root');
    return !!layer && [...layer.children].some((el) => !el.classList.contains('ctx-menu') && !el.classList.contains('closing'));
  }

  #wireDragDrop() {
    // Trascinamenti sicuri: con una finestra modale aperta, i file lasciati fuori dalla finestra
    // non arrivano al documento sotto (né al nucleo né alle aree); il browser non deve mai aprirli da sé.
    const layer = () => document.getElementById('overlay-root');
    const guard = (e) => {
      if (!this.modalOpen() || !e.dataTransfer?.types?.includes('Files')) return;
      if (layer().contains(e.target)) return; // dentro la finestra: decide lei
      e.preventDefault(); e.stopPropagation();
      if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none';
      if (e.type === 'drop') toast('Rilascia i file dentro la finestra aperta', { kind: 'warning' });
    };
    for (const t of ['dragenter', 'dragover', 'drop']) window.addEventListener(t, guard, true);
    // nessun file deve mai «navigare» la finestra se nessuna zona lo gestisce
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    const root = this.el.root;
    root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); root.classList.add('dragging'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('dragging'); });
    root.addEventListener('drop', async (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault(); root.classList.remove('dragging');
      const files = [...e.dataTransfer.files];
      const handled = files.filter((f) => this.openerFor(f.name));
      const pdfs = files.filter((f) => !handled.includes(f) && (/\.pdf$/i.test(f.name) || f.type === 'application/pdf'));
      const others = files.filter((f) => !pdfs.includes(f) && !handled.includes(f));
      for (const f of handled) {
        let path = null;
        try { path = window.leggio?.pathForFile?.(f) || null; } catch { path = null; }
        try { await this.openFile({ path, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); }
        catch (err) { this.reportError(err, `Impossibile aprire «${f.name}»`); }
      }
      for (const f of pdfs) {
        if (f.size > MAX_PDF_BYTES) { this.#openFailed(precheck({ length: f.size }, f.name), f.name); continue; }
        let path = null;
        try { path = window.leggio?.pathForFile?.(f) || null; } catch { path = null; }
        let bytes;
        try { bytes = new Uint8Array(await f.arrayBuffer()); }
        catch (err) { this.#openFailed(`Impossibile leggere «${f.name}»: ${err?.message || err}`, f.name); continue; }
        await this.openBytes(bytes, { name: f.name, path });
      }
      if (others.length) this.bus.emit('files:dropped-nonpdf', { files: others });
    });
  }

  // ---------- trova ----------
  openFind() {
    const fb = this.el.findbar;
    if (!fb.hidden) { fb.querySelector('input').select(); return; }
    fb.innerHTML = '';
    const input = h('input', { type: 'search', placeholder: 'Trova nel documento', 'aria-label': 'Trova nel documento' });
    const count = h('span', { class: 'find-count' });
    const cs = h('input', { type: 'checkbox', id: 'find-cs' }); const ww = h('input', { type: 'checkbox', id: 'find-ww' });
    const run = (opts = {}) => this.viewer.find(input.value, { caseSensitive: cs.checked, entireWord: ww.checked, ...opts });
    input.addEventListener('input', () => run());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run({ again: true, previous: e.shiftKey }); if (e.key === 'Escape') this.closeFind(); });
    cs.onchange = () => run(); ww.onchange = () => run();
    fb.append(h('span', { html: icon('search', 16) }), input,
      h('button', { class: 'icon-btn', 'aria-label': 'Precedente', onclick: () => run({ again: true, previous: true }), html: icon('chevronUp') }),
      h('button', { class: 'icon-btn', 'aria-label': 'Successivo', onclick: () => run({ again: true }), html: icon('chevronDown') }),
      count, h('label', { class: 'chk' }, cs, 'Maiuscole/minuscole'), h('label', { class: 'chk' }, ww, 'Parole intere'),
      h('div', { class: 'tb-spacer' }), h('button', { class: 'icon-btn', 'aria-label': 'Chiudi ricerca', onclick: () => this.closeFind(), html: icon('close') }));
    this.offFind?.(); this.offFind = this.bus.on('find:count', ({ current, total }) => { count.textContent = total ? `${current} di ${total}` : input.value ? 'Nessun risultato' : ''; });
    fb.hidden = false; input.focus();
  }
  closeFind() { this.el.findbar.hidden = true; this.viewer.clearFind(); this.offFind?.(); }

  // ---------- stampa ----------
  /** Stampa il documento (stampante, copie, fronte/retro, timbro «COPIA», scelte ricordate). */
  async print(doc = this.activeDoc) { if (doc) return printSources(this, [doc]); }
  /**
   * Stampa più documenti in una volta. sources: Doc aperti, { name, bytes, password } o { path } (app).
   * opts.preset: stampa senza dialogo con queste scelte (vedi core/printplan.js DEFAULT_PRINT_PRESET).
   */
  async printFiles(sources, opts) { return printSources(this, sources, opts); }

  // ---------- proprietà ----------
  async showProperties() {
    const doc = this.activeDoc;
    const { info, metadata } = await doc.pdf.getMetadata().catch(() => ({ info: {} }));
    const page1 = await doc.pdf.getPage(1); const vp = page1.getViewport({ scale: 1 });
    const mm = (pt) => (pt / 72 * 25.4).toFixed(0);
    const fmtDate = (s) => { const d = pdfjs.PDFDateString.toDateObject(s); return d ? d.toLocaleString('it-IT') : '—'; };
    const rows = [
      ['File', doc.name], ['Percorso', doc.path || '—'], ['Dimensione', formatBytes(doc.bytes.length)],
      ['Titolo', info.Title || '—'], ['Autore', info.Author || '—'], ['Oggetto', info.Subject || '—'], ['Parole chiave', info.Keywords || '—'],
      ['Creato con', info.Creator || '—'], ['Produttore PDF', info.Producer || '—'],
      ['Creato il', fmtDate(info.CreationDate)], ['Modificato il', fmtDate(info.ModDate)],
      ['Versione PDF', info.PDFFormatVersion || '—'], ['Pagine', String(doc.pageCount)],
      ['Formato pagina 1', `${mm(vp.width)} × ${mm(vp.height)} mm`],
      ['Protetto', doc.password ? 'Sì (password di apertura)' : (info.IsEncrypted ? 'Sì (restrizioni)' : 'No')],
      ['Moduli', info.IsAcroFormPresent ? 'Sì' : 'No'], ['XFA', info.IsXFAPresent ? 'Sì' : 'No'],
      ['Ottimizzato per il web', info.IsLinearized ? 'Sì' : 'No'],
    ];
    const tbl = h('table', { class: 'props' }, rows.map(([k, val]) => h('tr', {}, h('th', {}, k), h('td', {}, val))));
    const editTool = this.tools.get('metadata');
    const r = await dialog({ title: 'Proprietà documento', body: tbl, okLabel: editTool ? 'Modifica proprietà…' : 'Chiudi', cancelLabel: editTool ? 'Chiudi' : null, width: 560 });
    if (r && editTool) this.tools.run('metadata');
  }

  // ---------- impostazioni ----------
  async showSettings() {
    const s = this.settings;
    const extra = []; this.bus.emit('settings:fields', extra); // le feature aggiungono campi {field, key}
    const v = await dialog({ title: 'Impostazioni', width: 520, fields: [
      { name: 'theme', label: 'Tema', type: 'select', value: s.get('theme', 'system'), options: [{ value: 'system', label: 'Come il sistema' }, { value: 'light', label: 'Chiaro' }, { value: 'dark', label: 'Scuro' }] },
      { name: 'defaultZoom', label: 'Zoom all\'apertura', type: 'select', value: s.get('defaultZoom', 'auto'), options: [{ value: 'auto', label: 'Automatico' }, { value: 'page-width', label: 'Larghezza pagina' }, { value: 'page-fit', label: 'Pagina intera' }, { value: '1', label: '100%' }] },
      { name: 'author', label: 'Nome autore (per commenti e firme)', type: 'text', value: s.get('author', '') },
      { name: 'uiLarge', label: 'Caratteri e pulsanti grandi', type: 'checkbox', value: s.get('uiLarge', false), help: 'Ingrandisce testi, pulsanti e finestre (non la pagina). Anche da Vista › Caratteri e pulsanti grandi.' },
      { name: 'uiZoom', label: 'Dimensione dell\'interfaccia', type: 'select', value: String(s.get('uiZoom', 1)), options: UI_ZOOMS.map((z) => ({ value: String(z), label: Math.round(z * 100) + '%' })) },
      { name: 'toolbarLabels', label: 'Mostra i nomi sotto le icone della barra', type: 'checkbox', value: s.get('toolbarLabels', true) },
      ...extra.map((x) => ({ ...x.field, name: x.key, value: s.get(x.key, x.field.value) })),
    ] });
    if (!v) return;
    v.uiZoom = Number(v.uiZoom) || 1;
    for (const [k, val] of Object.entries(v)) s.set(k, val);
    this.#applyTheme();
    this.#applyUiPrefs();
  }

  showShortcuts() {
    const m = modKey;
    const rows = [[`${m}O`, 'Apri'], [`${m}S`, 'Salva'], [`${m}⇧S`, 'Salva con nome'], [`${m}P`, 'Stampa'], [`${m}F`, 'Trova'], [`${m}K`, 'Tutti gli strumenti'], [`${m}Z`, 'Annulla'], [`${m}+ / ${m}−`, 'Zoom'], [`${m}0`, 'Dimensioni reali'], [`${m}1 / ${m}2`, 'Adatta larghezza / pagina'], [`${m}R`, 'Ruota la visualizzazione (non modifica il file)'], [`${m}⇧+ / ${m}⇧−`, 'Ingrandisci / riduci l\'interfaccia'], [`${m}L`, 'Modalità lettura'], ['F4', 'Barra laterale'], ['V / H', 'Selezione / Mano'], ['Spazio (tenuto)', 'Trascina la pagina'], ['Esc', 'Chiudi strumento']];
    for (const t of this.tools.list()) if (t.shortcut) rows.push([t.shortcut.toUpperCase(), t.name]);
    dialog({ title: 'Scorciatoie da tastiera', cancelLabel: null, okLabel: 'Chiudi', body: h('table', { class: 'props' }, rows.map(([k, l]) => h('tr', {}, h('th', {}, h('kbd', {}, k)), h('td', {}, l)))) });
  }

  async #printManyDialog() {
    let sources = this.docs.slice();
    if (sources.length) {
      const v = await ui.choice({ title: 'Stampa più documenti', message: `Vuoi stampare i ${sources.length} documenti aperti o scegliere altri file?`, buttons: [{ value: 'cancel', label: 'Lascia perdere', left: true }, { value: 'files', label: 'Scegli file…' }, { value: 'open', label: 'Documenti aperti', primary: true }] });
      if (!v || v === 'cancel') return;
      if (v === 'files') sources = null;
    }
    if (!sources) {
      const files = await platform.openFiles({ multiple: true, title: 'Scegli i PDF da stampare' }).catch((err) => { this.reportError(err, 'Apertura dei file'); return []; });
      sources = files.map((f) => ({ name: f.name, bytes: f.bytes }));
    }
    if (sources.length) await this.printFiles(sources);
  }

  #registerCoreTools() {
    this.registerTool({ id: 'core-properties', name: 'Proprietà documento', category: 'avanzati', icon: 'info', description: 'Autore, date, formato, protezione', run: () => this.showProperties() });
    this.registerTool({ id: 'core-print', name: 'Stampa', category: 'vista', icon: 'print', keywords: 'stampa stampante copie fronte retro', description: 'Stampante, copie, fronte/retro, pagine scelte, timbro «COPIA» solo sulla stampa', run: () => this.print() });
    this.registerTool({ id: 'core-print-many', name: 'Stampa più documenti…', category: 'vista', icon: 'print', needsDoc: false, keywords: 'stampa tutti lotto più file schede aperte', description: 'Stampa in una volta i documenti aperti o altri file scelti', run: () => this.#printManyDialog() });
    this.registerTool({ id: 'core-reading', name: 'Modalità lettura', category: 'vista', icon: 'book', description: 'Nasconde barre e pannelli', run: () => this.command('reading-mode') });
    this.registerTool({ id: 'core-two-pages', name: 'Vista a due pagine', category: 'vista', icon: 'book', description: 'Pagine affiancate come un libro', run: () => { const pv = this.viewer.pdfViewer; pv.spreadMode = pv.spreadMode === 2 ? 0 : 2; } });
    this.registerTool({ id: 'core-theme', name: 'Tema chiaro/scuro', category: 'vista', icon: 'moon', needsDoc: false, description: 'Cambia aspetto dell\'app', run: () => this.#cycleTheme() });
  }
}

/** Copia metadati di livello documento (titolo ecc.) da un PDFDocument a un altro. */
export function copyDocLevel(src, dst) {
  try {
    const t = src.getTitle(); if (t) dst.setTitle(t);
    const a = src.getAuthor(); if (a) dst.setAuthor(a);
  } catch {}
}

function logoSvg(size = 22) {
  // leggio stilizzato: un foglio inclinato su un'asta
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="3" width="22" height="17" rx="3" transform="rotate(-6 16 11)" fill="var(--accent)"/><path d="M10 9.5h11M10 13.5h8" stroke="var(--accent-ink)" stroke-width="2" stroke-linecap="round" transform="rotate(-6 16 11)"/><path d="M16 20v8M11 29h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}

const UI_ZOOMS = [0.9, 1, 1.1, 1.25, 1.4, 1.6];
function stepZoom(cur, dir) {
  const i = UI_ZOOMS.findIndex((z) => z >= cur - 0.001);
  const k = Math.max(0, Math.min(UI_ZOOMS.length - 1, (i < 0 ? UI_ZOOMS.length - 1 : i) + dir));
  return UI_ZOOMS[k];
}

/** Etichetta breve per un'icona della barra: al massimo due parole significative. */
function shortLabel(name) {
  const w = String(name).replace(/\s*\(.*\)\s*$/, '').split(/\s+/);
  if (w.join(' ').length <= 16) return w.join(' ');
  const keep = w.filter((x, i) => i === 0 || !/^(il|lo|la|i|gli|le|un|una|di|del|della|dei|delle|e|in|da|con|per|a|al|alla|PDF)$/i.test(x));
  return keep.slice(0, 2).join(' ');
}
