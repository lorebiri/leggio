// Visualizzatore: incapsula PDFViewer di pdf.js (scorrimento continuo, testo selezionabile,
// link, moduli compilabili, ricerca) e offre alle feature un livello "overlay" per pagina.
import { EventBus, PDFViewer, PDFLinkService, PDFFindController, ScrollMode, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { pdfjs } from './pdf.js';
import { rectToCss } from './geometry.js';
import { isEditable } from './keys.js';

export { rectToCss };

export { ScrollMode, SpreadMode };

export class Viewer {
  constructor(app, container) {
    this.app = app;
    this.container = container;               // div assoluto con overflow
    this.viewerEl = container.firstElementChild;
    this.eventBus = new EventBus();
    this.linkService = new PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: 2 });
    this.findController = new PDFFindController({ eventBus: this.eventBus, linkService: this.linkService });
    this.pdfViewer = new PDFViewer({
      container, viewer: this.viewerEl, eventBus: this.eventBus,
      linkService: this.linkService, findController: this.findController,
      annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
      textLayerMode: 1, removePageBorders: false,
      maxCanvasPixels: 2 ** 25, enableAutoLinking: true,
      // icone delle note e degli allegati disegnate da pdf.js (copiate da vite.config.js in dist/pdfjs/images)
      imageResourcesPath: new URL('./pdfjs/images/', document.baseURI).href,
    });
    this.linkService.setViewer(this.pdfViewer);
    this.doc = null;
    this.mode = 'select'; // select | hand | tool
    this.#wireEvents();
    this.#wireGestures();
  }

  #wireEvents() {
    const eb = this.eventBus;
    eb.on('pagesinit', () => requestAnimationFrame(() => this.#initView()));
    eb.on('pagechanging', ({ pageNumber }) => this.app.bus.emit('page:changed', { pageIndex: pageNumber - 1, pageNumber }));
    eb.on('scalechanging', ({ scale, presetValue }) => this.app.bus.emit('viewer:scale', { scale, presetValue }));
    eb.on('pagerendered', ({ pageNumber, isDetailView }) => { if (!isDetailView) this.#pageReady(pageNumber - 1); });
    eb.on('textlayerrendered', ({ pageNumber }) => this.app.bus.emit('page:textlayer', { pageIndex: pageNumber - 1, pageDiv: this.getPageDiv(pageNumber - 1) }));
    eb.on('annotationlayerrendered', ({ pageNumber }) => this.app.bus.emit('page:annotationlayer', { pageIndex: pageNumber - 1, pageDiv: this.getPageDiv(pageNumber - 1) }));
    eb.on('updatefindmatchescount', ({ matchesCount }) => this.app.bus.emit('find:count', matchesCount));
    eb.on('updatefindcontrolstate', ({ state, matchesCount }) => this.app.bus.emit('find:state', { state, matchesCount }));
  }

  #initView() {
    // tra «pagesinit» e questo fotogramma il documento può essere già cambiato (schede aperte e chiuse
    // in fretta, riordino): sulla vista nuova le pagine non esistono ancora e pdf.js andrebbe in errore
    // («Cannot destructure property 'div'»); ci penserà il suo «pagesinit»
    if (!this.pdfViewer.pagesCount || this.pdfViewer.pdfDocument !== this.doc?.pdf) return;
    const vs = this.doc?.viewState;
    if (vs && vs.scale) { this.pdfViewer.currentScaleValue = vs.scale; if (vs.page) this.#goTo(vs.page); if (vs.scrollTop != null) setTimeout(() => (this.container.scrollTop = vs.scrollTop)); }
    else { this.pdfViewer.currentScaleValue = this.app.settings.get('defaultZoom', 'auto'); if (vs?.page) this.#goTo(vs.page); }
    this.app.bus.emit('viewer:pagesinit', { doc: this.doc });
  }

  /** Va alla pagina n (1-based) solo se le pagine della vista sono pronte. */
  #goTo(n) {
    if (!pagesReady(this.pdfViewer, n)) return false;
    this.pdfViewer.currentPageNumber = n;
    return true;
  }

  #pageReady(pageIndex) {
    const pv = this.pdfViewer.getPageView(pageIndex);
    if (!pv) return;
    const overlay = this.getOverlay(pageIndex);
    this.app.bus.emit('page:rendered', { doc: this.doc, pageIndex, pageDiv: pv.div, overlay, viewport: pv.viewport });
  }

  /** Livello trasparente sopra la pagina (sopra testo e annotazioni) dove le feature disegnano. */
  getOverlay(pageIndex) {
    const pv = this.pdfViewer.getPageView(pageIndex);
    if (!pv) return null;
    let ov = pv.div.querySelector(':scope > .leggio-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'leggio-overlay';
      ov.dataset.pageIndex = String(pageIndex);
      pv.div.append(ov);
    }
    return ov;
  }

  /** La pagina i è già disegnata (renderingState FINISHED)? */
  isRendered(pageIndex) { return this.pdfViewer.getPageView(pageIndex)?.renderingState === 3; }
  getPageDiv(pageIndex) { return this.pdfViewer.getPageView(pageIndex)?.div || null; }
  /** PageViewport corrente (scala+rotazione): convertToPdfPoint / convertToViewportPoint. */
  getViewport(pageIndex) { return this.pdfViewer.getPageView(pageIndex)?.viewport || null; }
  /** Da coordinate evento (clientX/Y) a punto PDF della pagina indicata. */
  clientToPdf(pageIndex, clientX, clientY) {
    const div = this.getPageDiv(pageIndex); const vp = this.getViewport(pageIndex);
    if (!div || !vp) return null;
    const r = div.getBoundingClientRect();
    const bx = parseFloat(getComputedStyle(div).borderLeftWidth) || 0;
    const by = parseFloat(getComputedStyle(div).borderTopWidth) || 0;
    return vp.convertToPdfPoint(clientX - r.left - bx, clientY - r.top - by);
  }
  /** Rettangolo PDF [x1,y1,x2,y2] → rettangolo CSS {left,top,width,height} nella pagina. */
  pdfRectToCss(pageIndex, rect) {
    const vp = this.getViewport(pageIndex);
    return rectToCss(vp, rect);
  }
  /** Rende di nuovo tutte le pagine visibili (es. dopo cambi solo visivi). */
  refresh() { this.pdfViewer.refresh(); }

  async setDocument(doc) {
    if (this.doc && this.doc !== doc) this.saveViewState();
    this.doc = doc;
    if (!doc) { this.pdfViewer.setDocument(null); this.linkService.setDocument(null); return; }
    this.pdfViewer.setDocument(doc.pdf);
    this.linkService.setDocument(doc.pdf, null);
  }
  /** Ricarica il documento corrente mantenendo pagina, zoom e scorrimento. */
  async reloadKeepingView() {
    this.saveViewState();
    await this.setDocument(this.doc);
  }
  saveViewState() {
    // vista non ancora pronta (pagine non create): si tiene lo stato salvato prima, non «pagina 1»
    if (!this.doc || !this.pdfViewer.pdfDocument || !this.pdfViewer.pagesCount || this.pdfViewer.currentScaleValue == null) return;
    this.doc.viewState = { scale: this.pdfViewer.currentScaleValue, page: this.pdfViewer.currentPageNumber, scrollTop: this.container.scrollTop };
  }

  get page() { return this.pdfViewer.currentPageNumber; }
  set page(n) {
    if (!this.doc) return;
    const p = Math.max(1, Math.min(this.doc.pageCount, Math.round(Number(n)) || 1));
    if (this.#goTo(p)) return;
    // vista non ancora pronta (documento appena caricato o ricaricato): la pagina si applica in #initView
    // (lo scorrimento salvato porterebbe di nuovo alla pagina di prima: non serve più)
    if (!this.pdfViewer.pagesCount) this.doc.viewState = { ...(this.doc.viewState || {}), page: p, scrollTop: null };
  }
  get pageIndex() { return this.page - 1; }
  get scale() { return this.pdfViewer.currentScale; }
  set scaleValue(v) { this.pdfViewer.currentScaleValue = v; }
  zoomIn() { this.pdfViewer.increaseScale(); }
  zoomOut() { this.pdfViewer.decreaseScale(); }
  rotateView(delta = 90) { this.pdfViewer.pagesRotation = (this.pdfViewer.pagesRotation + delta + 360) % 360; }
  setScrollMode(m) { this.pdfViewer.scrollMode = m; }
  setSpreadMode(m) { this.pdfViewer.spreadMode = m; }
  goToDestination(dest) { return this.linkService.goToDestination(dest); }
  scrollToPdfPoint(pageIndex, x, y) { this.pdfViewer.scrollPageIntoView({ pageNumber: pageIndex + 1, destArray: [null, { name: 'XYZ' }, x, y, null] }); }

  find(query, { again = false, previous = false, caseSensitive = false, entireWord = false, highlightAll = true } = {}) {
    this.eventBus.dispatch('find', { source: this, type: again ? 'again' : '', query, caseSensitive, entireWord, highlightAll, findPrevious: previous, matchDiacritics: false });
  }
  clearFind() { this.eventBus.dispatch('findbarclose', { source: this }); }

  /** Modalità puntatore: 'select' (testo), 'hand' (trascina), 'tool' (le feature catturano il puntatore negli overlay). */
  setMode(mode, cursor) {
    this.mode = mode;
    this.container.dataset.mode = mode;
    this.container.style.setProperty('--tool-cursor', cursor || 'crosshair');
    this.app.bus.emit('viewer:mode', { mode });
  }

  #wireGestures() {
    // trascinamento con la mano (modalità hand o barra spaziatrice tenuta premuta)
    let pan = null; let space = false;
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && !isTyping(e)) { space = true; this.container.classList.add('pan-ready'); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { space = false; this.container.classList.remove('pan-ready'); } });
    // passando a un'altra finestra con Spazio premuto (Alt/⌘+Tab) il rilascio non arriva mai: si azzera qui
    window.addEventListener('blur', () => { space = false; pan = null; this.container.classList.remove('pan-ready', 'panning'); });
    this.container.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      if (!(this.mode === 'hand' || space || e.button === 1)) return;
      pan = { x: e.clientX, y: e.clientY, l: this.container.scrollLeft, t: this.container.scrollTop };
      this.container.classList.add('panning'); e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => { if (!pan) return; this.container.scrollLeft = pan.l - (e.clientX - pan.x); this.container.scrollTop = pan.t - (e.clientY - pan.y); });
    window.addEventListener('mouseup', () => { pan = null; this.container.classList.remove('panning'); });
    // zoom con Ctrl/⌘ + rotella o pinch del trackpad
    this.container.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !this.doc) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.01);
      this.pdfViewer.updateScale({ scaleFactor: factor, origin: [e.clientX, e.clientY] });
    }, { passive: false });
  }
}

export function isTyping(e) { return isEditable(e.target); }

/** Le pagine della vista pdf.js esistono già e n è una pagina valida? (Prima di «pagesinit» non ci sono.) */
export function pagesReady(pdfViewer, n) {
  return !!pdfViewer.pdfDocument && Number.isInteger(n) && n >= 1 && n <= pdfViewer.pagesCount && !!pdfViewer.getPageView(n - 1);
}
