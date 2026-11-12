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
import { ToolRegistry } from './tools.js';
import { Settings } from './settings.js';
import { platform, isMac, modKey } from './platform.js';
import { openPdfLib, savePdfLib, renderPageToCanvas, openPdfJs, verifyPdfBytes, PDFLib, pdfjs } from './pdf.js';
import * as ui from './ui.js';
import { h, toast, dialog, confirm, withProgress, parsePageRanges, formatBytes, escapeHtml } from './ui.js';
import { icon } from './icons.js';

export class App {
  constructor(root) {
    this.bus = new Bus();
    this.settings = new Settings(this.bus);
    this.platform = platform;
    this.ui = ui;
    this.lib = { PDFLib, pdfjs, openPdfLib, savePdfLib, renderPageToCanvas };
    this.docs = [];
    this.activeDoc = null;
    this.saveHooks = [];
    this.log = log;
    installGuards(this);
    this.#setupHistory();
    this.el = this.#buildShell(root);
    this.viewer = new Viewer(this, this.el.viewerContainer);
    this.sidebar = new Sidebar(this, this.el.rail, this.el.sideBody);
    this.tools = new ToolRegistry(this);
    this.sidebar.registerPanel(thumbnailsPanel(this));
    this.sidebar.registerPanel(outlinePanel(this));
    this.#registerCoreTools();
    this.#wireCommands();
    this.#wireDragDrop();
    this.#applyTheme();
    this.bus.on('tools:changed', () => this.#renderQuickTools());
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
  /** fn(bytes, doc) → bytes: trasformazioni applicate al momento del salvataggio. */
  registerSaveHook(fn) { this.saveHooks.push(fn); }

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
  async applyEdit(label, fn, doc = this.activeDoc) {
    if (!doc) throw new Error('Nessun documento aperto');
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
      if (doc.closed) { pdf.destroy(); return false; }
      await doc.commit(label, next);
      await this.#swapPdf(doc, pdf);
      this.bus.emit('document:changed', { doc, label });
      toast(label, { kind: 'success', timeout: 2600, action: { label: 'Annulla', run: () => this.undo(doc) } });
      return true;
    });
  }

  /** Come applyEdit ma con un PDFDocument di pdf-lib già aperto: fn(pdfDoc, PDFLib, doc). */
  async editWithPdfLib(label, fn, doc = this.activeDoc) {
    return this.applyEdit(label, async (bytes) => {
      const pdfDoc = await openPdfLib(bytes, doc.password);
      const r = await fn(pdfDoc, PDFLib, doc);
      if (r === false) return null;
      return savePdfLib(pdfDoc);
    }, doc);
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
      if (err?.name === 'AbortError') { toast('Apertura annullata'); return null; }
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
    let files;
    try { files = await platform.openFiles({ multiple: true }); }
    catch (err) { this.#openFailed(cleanIpcMessage(err?.message || err), 'file'); return; }
    for (const f of files) await this.openBytes(f.bytes, f);
  }

  /** Apre un percorso (solo app desktop), es. dai recenti. */
  async openPath(p) {
    try { const f = await platform.readFile(p); if (f) return this.openBytes(f.bytes, f); }
    catch (err) { this.#openFailed(cleanIpcMessage(err?.message || err), p.split(/[\\/]/).pop()); }
    return null;
  }

  activate(doc) {
    if (this.activeDoc === doc && (doc || this.viewer.doc == null)) return;
    this.tools.deactivate();
    if (this.activeDoc) this.viewer.saveViewState();
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
      const v = await dialog({ title: 'Modifiche non salvate', message: `Vuoi salvare le modifiche a «${doc.name}» prima di chiudere?`, fields: [{ name: 'a', type: 'radio', value: 'save', options: [{ value: 'save', label: 'Salva' }, { value: 'discard', label: 'Non salvare' }] }], okLabel: 'Continua' });
      if (!v || doc.closed) return false;
      if (v.a === 'save' && !(await this.save(doc))) return false;
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
        if (d.closed) { pdf.destroy(); return; }
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
  async reorderPages(order, label = 'Pagine riordinate') {
    await this.editWithPdfLib(label, async (src) => {
      // riordino "in place": stessi oggetti pagina, così annotazioni e campi modulo restano validi
      const pages = src.getPages();
      for (let i = pages.length - 1; i >= 0; i--) src.removePage(i);
      order.forEach((oldIndex, k) => src.insertPage(k, pages[oldIndex]));
    });
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
    try { old?.destroy(); } catch { /* già distrutto */ }
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
    for (const b of this.el.toolbar.querySelectorAll('[data-cmd="undo"],[data-cmd="redo"],[data-cmd="save"]')) b.disabled = busy;
    this.#updateNav();
  }

  #watchForms(doc) {
    const st = doc.pdf.annotationStorage;
    st.onSetModified = () => { doc.formsDirty = true; doc.formsRev++; this.#renderTabs(); this.#updateTitle(); this.bus.emit('document:forms-changed', { doc }); };
  }

  #updateTitle() {
    const d = this.activeDoc;
    platform.setTitle(d ? `${d.dirty || d.formsDirty ? '• ' : ''}${d.name} — Leggio` : 'Leggio');
  }

  #buildShell(root) {
    root.innerHTML = '';
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Documenti aperti' });
    const titlebar = h('div', { class: 'titlebar' + (isMac ? ' mac' : '') },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: logoSvg() }), h('span', {}, 'Leggio')),
      tabs);
    const btn = (ic, label, cmd, extra = {}) => h('button', { class: 'icon-btn', title: label, 'aria-label': label, 'data-cmd': cmd, html: icon(ic), ...extra });
    const pageInput = h('input', { class: 'page-input', type: 'text', inputmode: 'numeric', 'aria-label': 'Numero di pagina' });
    const pageTotal = h('span', { class: 'page-total' }, '/ 0');
    const zoomSel = h('select', { class: 'zoom-select', 'aria-label': 'Zoom' },
      [['auto', 'Automatico'], ['page-fit', 'Pagina intera'], ['page-width', 'Larghezza pagina'], ['page-actual', 'Dimensioni reali'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%'], ['custom', '']].map(([v, l]) => h('option', { value: v, hidden: v === 'custom' }, l)));
    const quick = h('div', { class: 'quick-tools' });
    const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Barra degli strumenti' },
      h('div', { class: 'tb-group' }, btn('open', `Apri (${modKey}O)`, 'open'), btn('save', `Salva (${modKey}S)`, 'save', { class: 'icon-btn needs-doc' }), btn('print', `Stampa (${modKey}P)`, 'print', { class: 'icon-btn needs-doc' })),
      h('div', { class: 'tb-sep' }),
      h('div', { class: 'tb-group needs-doc' }, btn('undo', `Annulla (${modKey}Z)`, 'undo'), btn('redo', 'Ripeti', 'redo')),
      h('div', { class: 'tb-sep' }),
      h('div', { class: 'tb-group needs-doc' }, btn('pointer', 'Selezione testo (V)', 'mode-select', { class: 'icon-btn mode-btn active' }), btn('hand', 'Mano (H, o tieni premuto Spazio)', 'mode-hand', { class: 'icon-btn mode-btn' })),
      h('div', { class: 'tb-group needs-doc nav' }, btn('chevronUp', 'Pagina precedente', 'prev-page'), pageInput, pageTotal, btn('chevronDown', 'Pagina successiva', 'next-page')),
      h('div', { class: 'tb-group needs-doc' }, btn('minus', 'Riduci', 'zoom-out'), zoomSel, btn('plus', 'Ingrandisci', 'zoom-in'), btn('rotate', `Ruota vista (${modKey}R)`, 'rotate-view')),
      h('div', { class: 'tb-spacer' }),
      quick,
      h('div', { class: 'tb-group' }, btn('search', `Trova (${modKey}F)`, 'find', { class: 'icon-btn needs-doc' }),
        h('button', { class: 'btn tools-btn', 'data-cmd': 'tools', title: `Tutti gli strumenti (${modKey}K)`, html: icon('tools', 16) + '<span>Strumenti</span>' }),
        btn('settings', 'Impostazioni', 'settings')));
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
    return { root: app, tabs, toolbar, quick, pageInput, pageTotal, zoomSel, toolOptions, findbar, rail, sideBody, viewerContainer, home, right, status, main };
  }

  /** Pannello destro per strumenti con molte opzioni. → container (svuotato). close() lo nasconde. */
  openRightPanel(title, { onClose } = {}) {
    const r = this.el.right; r.innerHTML = ''; r.hidden = false;
    const c = h('div', { class: 'right-content' });
    r.append(h('header', { class: 'side-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Chiudi', onclick: () => { this.closeRightPanel(); onClose?.(); }, html: icon('close') })), c);
    return c;
  }
  closeRightPanel() { this.el.right.hidden = true; this.el.right.innerHTML = ''; }

  #renderTabs() {
    const t = this.el.tabs; t.innerHTML = '';
    for (const d of this.docs) {
      const tab = h('div', { class: 'tab' + (d === this.activeDoc ? ' active' : ''), role: 'tab', 'aria-selected': String(d === this.activeDoc), title: d.path || d.name, tabindex: 0 },
        h('span', { class: 'tab-name' }, (d.dirty || d.formsDirty ? '• ' : '') + d.name),
        h('button', { class: 'tab-close', 'aria-label': 'Chiudi ' + d.name, onclick: (e) => { e.stopPropagation(); this.closeDoc(d); }, html: icon('close', 13) }));
      tab.addEventListener('click', () => this.activate(d));
      tab.addEventListener('auxclick', (e) => { if (e.button === 1) this.closeDoc(d); });
      tab.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.activate(d); });
      t.append(tab);
    }
    t.append(h('button', { class: 'tab-new', title: 'Apri un PDF', 'aria-label': 'Apri un PDF', onclick: () => this.openDialog(), html: icon('plus', 15) }));
  }

  async #renderHome() {
    const home = this.el.home; home.innerHTML = '';
    const recent = await platform.recent();
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

  #renderQuickTools() {
    const q = this.el.quick; q.innerHTML = '';
    for (const t of this.tools.list().filter((t) => t.quick).sort((a, b) => (a.quickOrder ?? 50) - (b.quickOrder ?? 50))) {
      q.append(h('button', { class: 'icon-btn needs-doc', 'data-tool-id': t.id, title: t.name + (t.shortcut ? ` (${t.shortcut})` : ''), 'aria-label': t.name, onclick: () => this.tools.run(t.id), html: icon(t.icon || 'tools') }));
    }
    if (!this.docs.length) this.#renderHome();
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
    this.el.status.textContent = d ? `${d.busy ? `In corso: ${d.queue.current}… · ` : ''}${d.pageCount} pagine · ${formatBytes(d.bytes.length)}${d.path ? ' · ' + d.path : ''}` : '';
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
    };
    if (id.startsWith('tool:')) return this.tools.run(id.slice(5));
    const needsDoc = !['open', 'tools', 'settings', 'shortcuts', 'toggle-theme', 'open-logs'].includes(id);
    if (needsDoc && !this.activeDoc) return;
    if (['undo', 'redo', 'save', 'save-as', 'print'].includes(id) && this.activeDoc?.busy) {
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
    platform.on('app:command', (id) => this.command(id));
    platform.on('app:open-file', (f) => this.openBytes(f.bytes, f));
    platform.on('app:open-recovery', () => this.recovery?.offer(true));
    platform.on('app:before-close', async () => {
      for (const d of [...this.docs]) if (!(await this.closeDoc(d))) return;
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

  #wireDragDrop() {
    const root = this.el.root;
    root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); root.classList.add('dragging'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('dragging'); });
    root.addEventListener('drop', async (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault(); root.classList.remove('dragging');
      const files = [...e.dataTransfer.files];
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      const others = files.filter((f) => !pdfs.includes(f));
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
  async print() {
    const doc = this.activeDoc;
    const v = await dialog({ title: 'Stampa', fields: [
      { name: 'pages', label: 'Pagine', type: 'pages', value: '' },
      { name: 'quality', label: 'Qualità', type: 'select', value: '150', options: [{ value: '96', label: 'Bozza (96 dpi)' }, { value: '150', label: 'Normale (150 dpi)' }, { value: '300', label: 'Alta (300 dpi)' }] },
      { name: 'annots', label: 'Stampa commenti e moduli', type: 'checkbox', value: true },
    ], okLabel: 'Stampa…', validate: (x) => { try { this.parsePages(x.pages); } catch (e) { return e.message; } } });
    if (!v) return;
    const pages = this.parsePages(v.pages);
    const bytes = await this.currentBytes(doc);
    const { pdf } = await openPdfJs(bytes, { password: doc.password });
    const root = document.getElementById('print-root'); root.innerHTML = '';
    const ok = await withProgress('Preparazione della stampa', async (p) => {
      for (let k = 0; k < pages.length; k++) {
        if (p.cancelled) return false;
        p.set(k / pages.length, `Pagina ${k + 1} di ${pages.length}`);
        const cv = await renderPageToCanvas(pdf, pages[k], +v.quality / 72, { annotationMode: v.annots ? pdfjs.AnnotationMode.ENABLE_STORAGE : pdfjs.AnnotationMode.DISABLE, background: '#fff' });
        const img = new Image(); img.src = cv.toDataURL('image/jpeg', 0.92);
        await img.decode();
        root.append(h('div', { class: 'print-page' }, img));
      }
      return true;
    });
    pdf.destroy();
    if (ok) { document.body.classList.add('printing'); window.print(); document.body.classList.remove('printing'); }
    root.innerHTML = '';
  }

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
      ...extra.map((x) => ({ ...x.field, name: x.key, value: s.get(x.key, x.field.value) })),
    ] });
    if (!v) return;
    for (const [k, val] of Object.entries(v)) s.set(k, val);
    this.#applyTheme();
  }

  showShortcuts() {
    const m = modKey;
    const rows = [[`${m}O`, 'Apri'], [`${m}S`, 'Salva'], [`${m}⇧S`, 'Salva con nome'], [`${m}P`, 'Stampa'], [`${m}F`, 'Trova'], [`${m}K`, 'Tutti gli strumenti'], [`${m}Z`, 'Annulla'], [`${m}+ / ${m}−`, 'Zoom'], [`${m}0`, 'Dimensioni reali'], [`${m}1 / ${m}2`, 'Adatta larghezza / pagina'], [`${m}R`, 'Ruota vista'], [`${m}L`, 'Modalità lettura'], ['F4', 'Barra laterale'], ['V / H', 'Selezione / Mano'], ['Spazio (tenuto)', 'Trascina la pagina'], ['Esc', 'Chiudi strumento']];
    for (const t of this.tools.list()) if (t.shortcut) rows.push([t.shortcut.toUpperCase(), t.name]);
    dialog({ title: 'Scorciatoie da tastiera', cancelLabel: null, okLabel: 'Chiudi', body: h('table', { class: 'props' }, rows.map(([k, l]) => h('tr', {}, h('th', {}, h('kbd', {}, k)), h('td', {}, l)))) });
  }

  #registerCoreTools() {
    this.registerTool({ id: 'core-properties', name: 'Proprietà documento', category: 'avanzati', icon: 'info', description: 'Autore, date, formato, protezione', run: () => this.showProperties() });
    this.registerTool({ id: 'core-print', name: 'Stampa', category: 'vista', icon: 'print', description: 'Stampa pagine scelte con qualità regolabile', run: () => this.print() });
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
