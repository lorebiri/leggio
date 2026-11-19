// «Compila e firma» e «Firma»: clic ovunque per scrivere, segni ✓ ✗ ●, data, sigla, firma grafica (anche di
// altre persone, con conferma e registro), «Sigla tutte le pagine», «Luogo, data e firma», timbri, dati della rubrica.
// Gli elementi restano modificabili finché lo strumento è aperto; alla chiusura (o con «Applica») vengono scritti nella pagina.
import { Board, rectToCss } from './board.js';
import { placement, localToPdf, todayIt, winAnsiSafe, dimensioniVisive, rettangoloInPosizione, rettangoloDaVisivo, pdfToVisivo, posizioneRelativa } from './lib/geom.js';
import { textItemsFromPdfjs } from './lib/detect.js';
import { createSignatureDialog, NOTA_FIRMA_SEMPLICE } from './sigpad.js';
import { editProfileDialog } from './profile.js';
import { apriArchivio, sceltaProprietario, confermaFirmaAltrui, registraUsi, nomeContatto } from './personale.js';
import { scegliContatto } from '../personale/ui/scegli.js';
import { CAMPI_MODULO, datiDaContatto, datiDaProfilo } from '../personale/lib/campi.js';
import { MODELLI_TIMBRO, COLORI_TIMBRO, normalizzaSpec, haData } from './lib/timbri.js';
import { disegnaTimbro, creaTimbroDialog, immagineTimbro, ruotaImmagine } from './timbri.js';

const MARKS = {
  check: 'M16 54 L40 78 L86 24',
  cross: 'M22 22 L78 78 M78 22 L22 78',
};
const LINE_H = 1.2; const BASELINE = 0.946; // metriche di Helvetica/Arial con interlinea 1,2

function dataUrlToBytes(u) { const b = atob(u.split(',')[1] || ''); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function hexToRgb(PDFLib, hex) { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }

export class FillSignSession {
  constructor(app, store, { mode = 'fill' } = {}) {
    this.app = app; this.store = store; this.mode = mode;
    this.tool = mode === 'sign' ? 'select' : 'text';
    this.color = /^#[0-9a-f]{6}$/i.test(store.getPref('color', '')) ? store.getPref('color') : '#111111';
    this.size = Math.max(6, Math.min(72, Number(store.getPref('size', 12)) || 12));
    this.pendingText = null;
    this.textCache = new Map();
    this.doc = app.activeDoc;
    this.board = new Board(app, {
      className: 'mod-fill',
      renderItem: (el, item, ctx) => this.#render(el, item, ctx),
      onEmptyPointer: (pi, pt, e) => this.#place(pi, pt, e),
      onSelect: () => this.#syncBar(),
      onChange: () => {},
      keepAspect: (item) => item.kind === 'image' || item.kind === 'check' || item.kind === 'cross' || item.kind === 'dot',
      pageBox: (pi) => this.#pageBox(pi),
      onClickItem: (item) => { if (item.kind === 'text') this.#focusText(item); },
    });
  }

  // ------------------------------------------------------------------ ciclo di vita
  activate(optionsEl) {
    this.optionsEl = optionsEl;
    this.app.viewer.setMode('tool', this.tool === 'text' ? 'text' : 'crosshair');
    this.board.attach();
    this.#buildBar();
    this.offDoc = this.app.bus.on('document:activated', () => this.app.tools.deactivate());
  }
  async deactivate() {
    this.offDoc?.();
    const pending = this.board.items.filter((i) => !(i.kind === 'text' && !i.text.trim()));
    const doc = this.doc;
    this.board.detach();
    if (pending.length && doc && this.app.docs.includes(doc)) {
      try { await this.apply(pending, doc); }
      catch (err) { this.app.reportError(err, 'Non è stato possibile scrivere gli elementi nella pagina'); }
    }
  }

  // ------------------------------------------------------------------ barra opzioni
  #buildBar() {
    const { h } = this.app.ui;
    const el = this.optionsEl; el.textContent = '';
    const tb = (tool, label, title, extra = {}) => h('button', { type: 'button', class: 'btn small mod-tbtn' + (this.tool === tool ? ' on' : ''), 'data-tool': tool, title, 'aria-pressed': String(this.tool === tool), onclick: () => this.setTool(tool), ...extra }, label);
    // firma in due clic: il pulsante mette subito l'ultima firma usata (o la fa creare); la freccia apre l'elenco
    const split = (kind, label, title) => h('span', { class: 'mod-split' + (kind === 'signature' ? ' primary' : '') },
      h('button', { type: 'button', class: 'btn small' + (kind === 'signature' ? ' primary' : ''), title, 'data-azione': kind === 'signature' ? 'firma' : 'sigla', onclick: () => this.quickSign(kind) }, label),
      h('button', { type: 'button', class: 'btn small mod-split-arrow' + (kind === 'signature' ? ' primary' : ''), title: 'Scegli tra le firme salvate (anche di altre persone) o creane una nuova', 'aria-label': kind === 'signature' ? 'Altre firme' : 'Altre sigle', 'aria-haspopup': 'menu', onclick: (e) => this.signatureMenu(e.currentTarget, kind) }, '▾'));
    const sigBtn = split('signature', '✍ Firma', 'Aggiungi la tua firma: compare sulla pagina, trascinala dove serve');
    const iniBtn = split('initials', 'Sigla', 'Aggiungi la sigla (iniziali)');
    const altroBtn = h('button', { type: 'button', class: 'btn small', 'aria-haspopup': 'menu', 'data-azione': 'altro', title: 'Sigla tutte le pagine, «Luogo, data e firma», timbri', onclick: (e) => this.quickMenu(e.currentTarget) }, 'Firme rapide e timbri ▾');
    const profBtn = h('button', { type: 'button', class: 'btn small', 'aria-haspopup': 'menu', title: 'Inserisci un dato tuo o di un contatto della rubrica (nome, codice fiscale, IBAN…)', onclick: (e) => this.profileMenu(e.currentTarget) }, 'Dati ▾');
    const sizeOut = h('span', { class: 'mod-size', 'aria-live': 'polite' }, this.size + ' pt');
    const setSize = (d) => {
      const sel = this.board.selected;
      if (sel?.kind === 'text') { sel.size = Math.max(6, Math.min(72, sel.size + d)); this.size = sel.size; this.#fitText(sel); this.board.update(sel); }
      else this.size = Math.max(6, Math.min(72, this.size + d));
      this.store.setPref('size', this.size); sizeOut.textContent = (sel?.kind === 'text' ? sel.size : this.size) + ' pt';
    };
    const colors = h('span', { class: 'mod-colors' }, [['#111111', 'Nero'], ['#1d3f9a', 'Blu'], ['#b42318', 'Rosso']].map(([c, l]) => h('button', { type: 'button', class: 'mod-color' + (c === this.color ? ' on' : ''), title: l, 'aria-label': 'Colore ' + l, style: { background: c }, onclick: (e) => {
      this.color = c; this.store.setPref('color', c);
      el.querySelectorAll('.mod-color').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      const sel = this.board.selected; if (sel && sel.kind !== 'image') { sel.color = c; this.board.update(sel); }
    } })));
    el.append(
      tb('text', 'Ab Testo', 'Clic sulla pagina per scrivere (T)'),
      tb('check', '✓', 'Segno di spunta: clic dove serve'),
      tb('cross', '✗', 'Croce: clic dove serve'),
      tb('dot', '●', 'Pallino: clic dove serve'),
      tb('date', 'Data', 'Data di oggi: clic dove serve'),
      h('span', { class: 'tb-sep' }),
      sigBtn, iniBtn, altroBtn, profBtn,
      h('span', { class: 'tb-sep' }),
      h('button', { type: 'button', class: 'btn small', title: 'Testo più piccolo', 'aria-label': 'Testo più piccolo', onclick: () => setSize(-1) }, 'A−'), sizeOut,
      h('button', { type: 'button', class: 'btn small', title: 'Testo più grande', 'aria-label': 'Testo più grande', onclick: () => setSize(1) }, 'A+'),
      colors,
      h('span', { class: 'mod-hint' }, this.mode === 'sign' ? 'Trascina la firma dove serve. «Fine» la scrive nel documento.' : 'Clic sulla pagina per scrivere; trascina per spostare. «Fine» scrive tutto.'),
      h('button', { type: 'button', class: 'link-btn mod-legal', title: NOTA_FIRMA_SEMPLICE, onclick: () => this.#notaLegale() }, 'Che valore ha?'),
      h('button', { type: 'button', class: 'btn small primary', title: 'Scrivi ora gli elementi nella pagina (resta possibile annullare)', onclick: () => this.applyNow() }, 'Applica'),
    );
    this.sizeOut = sizeOut;
    if (this.mode === 'sign') setTimeout(() => this.quickSign(), 0);
  }
  async #notaLegale() {
    const v = await this.app.ui.choice({
      title: 'Che valore ha questa firma?',
      message: NOTA_FIRMA_SEMPLICE + ' Quando serve una firma con pieno valore legale (contratti, atti, documenti per la pubblica amministrazione) usa la firma digitale con il tuo certificato o la tua smart card.',
      buttons: [{ value: null, label: 'Chiudi', left: true }, { value: 'digitale', label: 'Firma digitale…', primary: true }],
    });
    if (v === 'digitale') this.app.tools.run('digital-sign');
  }
  #syncBar() {
    const sel = this.board.selected;
    if (this.sizeOut) this.sizeOut.textContent = (sel?.kind === 'text' ? sel.size : this.size) + ' pt';
  }
  setTool(tool) {
    this.tool = tool; this.pendingText = null;
    this.optionsEl?.querySelectorAll('.mod-tbtn').forEach((b) => { const on = b.dataset.tool === tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    this.app.viewer.setMode('tool', tool === 'text' || tool === 'date' ? 'text' : 'crosshair');
  }

  // ------------------------------------------------------------------ firme e sigle (archivio personale)
  get #nomeDoc() { return this.doc?.name || 'documento'; }
  async #archivio() { this.archivio ||= await apriArchivio(this.app); return this.archivio; }
  /** Firma in due clic: compare subito la propria firma (o sigla) usata più di recente. */
  async quickSign(kind = 'signature') {
    const a = await this.#archivio(); if (!a) return;
    const tipo = kind === 'initials' ? 'sigla' : 'firma';
    const mia = a.firme({ tipo, proprietario: 'io' })[0];
    if (mia) return this.addSignature(mia);
    const created = await this.#create(kind);
    if (created) await this.addSignature(created);
  }
  /** → firma salvata (archivio) o temporanea { id, tipo, proprietario, dataUrl, w, h, nome } | null */
  async #create(kind, { proprietario = 'io' } = {}) {
    const a = await this.#archivio(); if (!a) return null;
    const p = a.profilo();
    const chi = proprietario === 'io' ? null : a.contatto(proprietario);
    const name = chi ? [chi.nome, chi.cognome].filter(Boolean).join(' ') : p.nomeCompleto || [p.nome, p.cognome].filter(Boolean).join(' ') || this.app.settings.get('author', '');
    const r = await createSignatureDialog(this.app, { kind, name, proprietario, nomeProprietario: chi ? nomeContatto(chi) : '', scegliProprietario: sceltaProprietario(this.app, a) });
    if (!r) return null;
    const tipo = r.kind === 'initials' ? 'sigla' : 'firma';
    if (r.save) {
      try { return await a.aggiungiFirma({ nome: r.nome, tipo, proprietario: r.proprietario, immagine: r.dataUrl, w: r.w, h: r.h, origine: r.origine }); }
      catch (e) { this.app.ui.toast(e.message, { kind: 'warning' }); }
    }
    return { id: 'temporanea', nome: r.nome, tipo, proprietario: r.proprietario, dataUrl: r.dataUrl, w: r.w, h: r.h };
  }
  async signatureMenu(anchor, kind) {
    const a = await this.#archivio(); if (!a) return;
    const tipo = kind === 'initials' ? 'sigla' : 'firma';
    const mie = a.firme({ tipo, proprietario: 'io' });
    const altrui = a.firme({ tipo, proprietario: 'altri' });
    const r = anchor.getBoundingClientRect();
    const voce = (f, label) => ({ label, run: () => this.addSignature(f) });
    const lista = [...mie.slice(0, 10).map((f) => [f, f.nome]), ...altrui.slice(0, 15).map((f) => [f, `${f.nome} — ${a.nomeProprietario(f)}`])];
    const menu = this.app.ui.contextMenu(r.left, r.bottom + 4, [
      ...lista.map(([f, l]) => voce(f, l)),
      ...(lista.length ? ['-'] : []),
      { label: tipo === 'sigla' ? 'Crea una nuova sigla…' : 'Crea una nuova firma…', icon: 'plus', run: async () => { const c = await this.#create(kind); if (c) this.addSignature(c); } },
      { label: tipo === 'sigla' ? 'Sigla di un\'altra persona…' : 'Firma di un\'altra persona…', icon: 'user', run: () => this.#firmaDiAltri(kind) },
      { label: 'Gestisci firme e sigle…', icon: 'settings', run: () => this.app.tools.run('signatures-library') },
    ]);
    // miniature
    const btns = menu?.querySelectorAll?.('button[role=menuitem]') || [];
    lista.forEach(([f], i) => {
      const b = btns[i]; if (!b) return;
      a.immagine(f.blob).then((u) => { const img = new Image(); img.src = u; img.className = 'mod-menu-sig'; img.alt = ''; b.prepend(img); }).catch(() => {});
    });
  }
  async #firmaDiAltri(kind) {
    const a = await this.#archivio(); if (!a) return;
    const chi = await sceltaProprietario(this.app, a)();
    if (!chi) return;
    if (chi === 'io') return this.quickSign(kind);
    const tipo = kind === 'initials' ? 'sigla' : 'firma';
    const sue = a.firme({ tipo, proprietario: chi.id });
    if (sue.length === 1) return this.addSignature(sue[0]);
    if (sue.length > 1) {
      const scelta = await this.app.ui.choice({ title: `Firme di ${chi.nome}`, message: 'Quale vuoi usare?', buttons: [{ value: null, label: 'Lascia perdere', left: true }, ...sue.slice(0, 4).map((f, i) => ({ value: f.id, label: f.nome, primary: i === 0 }))] });
      const f = sue.find((x) => x.id === scelta); if (f) this.addSignature(f);
      return;
    }
    const c = await this.#create(kind, { proprietario: chi.id });
    if (c) this.addSignature(c);
  }

  /** Mette una firma o sigla sulla pagina visibile (chiede conferma se è di un'altra persona). */
  async addSignature(f, { pageIndex = null, rect = null, select = true } = {}) {
    const a = await this.#archivio();
    if (!(await confermaFirmaAltrui(this.app, a, f, this.#nomeDoc))) return null;
    let dataUrl = f.dataUrl;
    if (!dataUrl) { try { dataUrl = await a.immagine(f.blob); } catch (e) { this.app.ui.toast(e.message, { kind: 'error' }); return null; } }
    if (f.id !== 'temporanea') a?.usaFirma(f.id);
    return this.addImage({ dataUrl, w: f.w, h: f.h, kind: f.tipo === 'sigla' ? 'initials' : 'signature', firmaRef: { id: f.id, nome: f.nome, tipo: f.tipo, proprietario: f.proprietario } }, { pageIndex, rect, select });
  }

  // ------------------------------------------------------------------ firme rapide e timbri
  quickMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    this.app.ui.contextMenu(r.left, r.bottom + 4, [
      { label: 'Sigla tutte le pagine…', icon: 'pages', run: () => this.siglaTutte() },
      { label: 'Luogo, data e firma…', icon: 'calendar', run: () => this.luogoDataFirma() },
      '-',
      { label: 'Timbro…', icon: 'stamp', run: () => this.timbroMenu(anchor) },
      { label: 'Crea il timbro dell\'ente…', icon: 'plus', run: async () => { const a = await this.#archivio(); if (!a) return; const t = await creaTimbroDialog(this.app, a); if (t) this.addStamp(t); } },
    ]);
  }

  /** Dialogo comune: posizione sulla pagina e pagine. → { pos, pagine: [indici] } | null */
  async #sceltaPosizione({ titolo, messaggio, chiave, selezionato }) {
    const n = this.doc?.pageCount || 1;
    const prev = this.store.getPref(chiave, { pos: 'br', quali: 'tutte' });
    const opzioni = [['br', 'In basso a destra'], ['bl', 'In basso a sinistra'], ['bc', 'In basso al centro'], ['tr', 'In alto a destra'], ['tl', 'In alto a sinistra']];
    if (selezionato) opzioni.unshift(['sel', 'Dove l\'ho messa io (la posizione dell\'elemento selezionato)']);
    const v = await this.app.ui.dialog({
      title: titolo, message: messaggio, width: 520,
      fields: [
        { name: 'pos', label: 'Posizione', type: 'radio', value: selezionato ? 'sel' : prev.pos, options: opzioni.map(([value, label]) => ({ value, label })) },
        { name: 'quali', label: 'Pagine', type: 'radio', value: prev.quali, options: [{ value: 'tutte', label: `Tutte (${n})` }, { value: 'tranne-ultima', label: 'Tutte tranne l\'ultima (dove di solito c\'è la firma)' }, { value: 'intervallo', label: 'Solo queste:' }] },
        { name: 'intervallo', label: 'Pagine da usare (se hai scelto «Solo queste»)', type: 'pages', value: '' },
      ],
      okLabel: 'Inserisci',
      validate: (x) => { if (x.quali === 'intervallo') { try { this.app.parsePages(x.intervallo || '1-' + n); } catch (e) { return e.message; } } return null; },
    });
    if (!v) return null;
    this.store.setPref(chiave, { pos: v.pos === 'sel' ? prev.pos : v.pos, quali: v.quali });
    let pagine = [...Array(n).keys()];
    if (v.quali === 'tranne-ultima' && n > 1) pagine = pagine.slice(0, -1);
    if (v.quali === 'intervallo') pagine = this.app.parsePages(v.intervallo || '1-' + n);
    return { pos: v.pos, pagine };
  }
  #rot(pi) { return this.app.viewer.getViewport(pi)?.rotation || 0; }
  /** Copie di un'immagine su più pagine nella stessa posizione visiva. */
  #suPagine(base, { pos, pagine, w, h, rifRect = null, rifPagina = 0 }) {
    let rel = null;
    if (pos === 'sel' && rifRect) rel = posizioneRelativa(this.#pageBox(rifPagina), this.#rot(rifPagina), rifRect);
    const out = [];
    for (const pi of pagine) {
      if (pos === 'sel' && pi === rifPagina) continue;
      const rect = rettangoloInPosizione(this.#pageBox(pi), this.#rot(pi), rel ? { fx: rel.fx, fy: rel.fy } : pos, rel ? rel.w : w, rel ? rel.h : h, 24);
      out.push({ ...base, pageIndex: pi, rect });
    }
    for (const it of out) this.board.add(it, { select: false });
    this.board.select(out[out.length - 1] || null);
    return out;
  }

  /** «Sigla tutte le pagine»: la posizione si sceglie una volta. */
  async siglaTutte() {
    const a = await this.#archivio(); if (!a) return;
    const sel = this.board.selected;
    let f = sel?.kind === 'image' && sel.firmaRef?.tipo === 'sigla' ? a.firma(sel.firmaRef.id) || sel.firmaRef : a.firme({ tipo: 'sigla', proprietario: 'io' })[0];
    if (!f) { f = await this.#create('initials'); if (!f) return; }
    const scelta = await this.#sceltaPosizione({ titolo: 'Sigla tutte le pagine', messaggio: `Sigla: «${f.nome}»${a.altrui(f) ? ' di ' + a.nomeProprietario(f) : ''}. Puoi spostare ogni sigla prima di applicare.`, chiave: 'siglaPos', selezionato: sel?.kind === 'image' && sel.firmaRef?.tipo === 'sigla' });
    if (!scelta) return;
    if (!(await confermaFirmaAltrui(this.app, a, f, this.#nomeDoc))) return;
    let dataUrl = f.dataUrl; if (!dataUrl) dataUrl = await a.immagine(f.blob);
    if (f.id !== 'temporanea') a.usaFirma(f.id);
    const ratio = (f.w || 2) / (f.h || 1); const hh = 24; const ww = Math.min(hh * ratio, 120);
    const base = { kind: 'image', dataUrl, sigKind: 'initials', firmaRef: { id: f.id, nome: f.nome, tipo: f.tipo, proprietario: f.proprietario } };
    const items = this.#suPagine(base, { pos: scelta.pos, pagine: scelta.pagine, w: ww, h: ww / ratio, rifRect: sel?.rect, rifPagina: sel?.pageIndex });
    this.setTool('select');
    this.app.ui.toast(`Sigla aggiunta su ${items.length + (scelta.pos === 'sel' ? 1 : 0)} pagine: controlla e premi «Applica»`, { kind: 'success' });
  }

  /** Blocco «Luogo, data e firma» con la data di oggi. */
  async luogoDataFirma() {
    const a = await this.#archivio(); if (!a) return;
    const p = a.profilo();
    const mie = a.firme({ tipo: 'firma', proprietario: 'io' });
    const v = await this.app.ui.dialog({
      title: 'Luogo, data e firma', width: 480,
      fields: [
        { name: 'luogo', label: 'Luogo', type: 'text', value: this.store.getPref('luogo', '') || p.citta || '', placeholder: 'es. Prato' },
        { name: 'data', label: 'Data', type: 'text', value: todayIt() },
        { name: 'firma', label: 'Firma', type: 'select', value: mie[0]?.id || 'nuova', options: [...mie.map((f) => ({ value: f.id, label: f.nome })), { value: 'nuova', label: 'Crea una nuova firma…' }, { value: 'nessuna', label: 'Nessuna firma (solo luogo e data)' }] },
        { name: 'dicitura', label: 'Sopra la firma', type: 'select', value: this.store.getPref('dicitura', 'Firma'), options: ['Firma', 'In fede', 'Il dichiarante', 'Il richiedente', 'Letto, confermato e sottoscritto', '(niente)'] },
      ],
      okLabel: 'Inserisci',
    });
    if (!v) return;
    this.store.setPref('luogo', v.luogo.trim()); this.store.setPref('dicitura', v.dicitura);
    let f = null;
    if (v.firma === 'nuova') { f = await this.#create('signature'); if (!f) return; }
    else if (v.firma !== 'nessuna') f = a.firma(v.firma);
    const pi = this.#visiblePage(); const box = this.#pageBox(pi); const rot = this.#rot(pi);
    const P = dimensioniVisive(box, rot);
    const size = Math.max(9, Math.min(14, this.size));
    const testo = [v.luogo.trim(), v.data.trim()].filter(Boolean).join(', ');
    // a sinistra «Luogo, data», a destra la firma con la dicitura sopra (nell'ultima parte visibile della pagina)
    const c = this.#visibleCenter(pi);
    const cy = c ? pdfToVisivo(box, rot, c[0], c[1])[1] : P.h * 0.75;
    const vy = Math.max(40, Math.min(P.h - 90, cy));
    if (testo) this.board.add({ kind: 'text', pageIndex: pi, text: testo, size, color: this.color, rect: rettangoloDaVisivo(box, rot, 56, vy + 22, Math.max(size * 4, size * 0.6 * (testo.length + 1)), size * LINE_H) }, { select: false });
    const xFirma = P.w * 0.58;
    if (v.dicitura !== '(niente)') this.board.add({ kind: 'text', pageIndex: pi, text: v.dicitura, size, color: this.color, rect: rettangoloDaVisivo(box, rot, xFirma, vy, Math.max(size * 4, size * 0.6 * (v.dicitura.length + 1)), size * LINE_H) }, { select: false });
    if (f) {
      const ratio = (f.w || 3) / (f.h || 1); const hh = 38; const ww = Math.min(hh * ratio, P.w - xFirma - 30);
      await this.addSignature(f, { pageIndex: pi, rect: rettangoloDaVisivo(box, rot, xFirma, vy + size * LINE_H + 2, ww, ww / ratio) });
    }
    this.setTool('select');
  }

  async timbroMenu(anchor) {
    const a = await this.#archivio(); if (!a) return;
    const r = anchor.getBoundingClientRect();
    const salvati = a.timbri();
    this.app.ui.contextMenu(r.left, r.bottom + 4, [
      ...MODELLI_TIMBRO.map((m) => ({ label: m.nome.replace('[data]', todayIt()), run: () => this.#timbroConOpzioni({ nome: m.nome, spec: m.spec, tipo: 'testo' }) })),
      ...(salvati.length ? ['-'] : []),
      ...salvati.slice(0, 12).map((t) => ({ label: t.nome, run: () => this.#timbroConOpzioni(t) })),
      '-',
      { label: 'Crea il timbro dell\'ente…', icon: 'plus', run: async () => { const t = await creaTimbroDialog(this.app, a); if (t) this.#timbroConOpzioni(t); } },
      ...(salvati.length ? [{ label: 'Gestisci timbri…', icon: 'settings', run: () => this.app.tools.run('stamps-library') }] : []),
    ]);
  }
  /** Colore, rotazione, data e pagine prima di mettere il timbro. */
  async #timbroConOpzioni(t) {
    const a = this.archivio;
    const spec = t.spec ? normalizzaSpec(t.spec) : null;
    const fields = [];
    if (spec) fields.push({ name: 'colore', label: 'Colore', type: 'select', value: spec.colore, options: COLORI_TIMBRO.map((c) => ({ value: c.v, label: c.l })) });
    fields.push({ name: 'rotazione', label: 'Rotazione', type: 'range', min: -30, max: 30, value: spec ? spec.rotazione : 0, unit: '°' });
    if (spec && !haData(spec)) fields.push({ name: 'data', label: 'Aggiungi la data di oggi', type: 'checkbox', value: false });
    fields.push({ name: 'dove', label: 'Dove', type: 'radio', value: 'questa', options: [{ value: 'questa', label: 'Su questa pagina (poi lo trascini dove serve)' }, { value: 'tutte', label: 'Su più pagine…' }] });
    const v = await this.app.ui.dialog({ title: t.nome.replace('[data]', todayIt()), fields, okLabel: 'Metti il timbro', width: 460 });
    if (!v) return;
    let img;
    if (spec) img = disegnaTimbro({ ...spec, colore: v.colore, rotazione: v.rotazione, data: spec.data || !!v.data });
    else { const base = await immagineTimbro(a, t); img = await ruotaImmagine(base.dataUrl, base.w, base.h, v.rotazione); }
    if (t.id && a?.timbro(t.id)) a.usaTimbro(t.id);
    const scala = Math.min(1, 200 / img.w);
    const w = img.w * scala; const hh = img.h * scala;
    if (v.dove === 'tutte') {
      const scelta = await this.#sceltaPosizione({ titolo: 'Timbro su più pagine', messaggio: 'Scegli dove mettere il timbro.', chiave: 'timbroPos' });
      if (!scelta) return;
      this.#suPagine({ kind: 'image', dataUrl: img.dataUrl, sigKind: 'timbro' }, { pos: scelta.pos === 'sel' ? 'br' : scelta.pos, pagine: scelta.pagine, w, h: hh });
    } else this.addImage({ dataUrl: img.dataUrl, w, h: hh, kind: 'timbro', natural: true });
    this.setTool('select');
  }
  addStamp(t) { return this.#timbroConOpzioni(t); }

  async profileMenu(anchor) {
    const a = await this.#archivio(); if (!a) return;
    const r = anchor.getBoundingClientRect();
    const persona = this.persona && this.persona !== 'io' ? a.contatto(this.persona) : null;
    const dati = persona ? datiDaContatto(persona) : datiDaProfilo(a.profilo());
    const entries = CAMPI_MODULO.map((f) => ({ f, v: dati[f.key] })).filter((x) => x.v).filter((x, i, all) => all.findIndex((y) => y.v === x.v) === i);
    this.app.ui.contextMenu(r.left, r.bottom + 4, [
      { label: persona ? `Dati di ${nomeContatto(persona)}` : 'I miei dati', disabled: true },
      ...entries.map(({ f, v }) => ({ label: `${f.label}: ${v.length > 40 ? v.slice(0, 40) + '…' : v}`, run: () => this.#armText(v) })),
      { label: 'Data di oggi: ' + todayIt(), run: () => this.#armText(todayIt()) },
      '-',
      { label: 'Usa i dati di un\'altra persona…', icon: 'user', run: async () => { const c = await scegliContatto(this.app, a, { titolo: 'Compila a nome di…', consentiIo: true }); if (c) { this.persona = c === 'io' ? 'io' : c.id; this.profileMenu(anchor); } } },
      { label: persona ? 'Modifica il contatto in rubrica…' : (entries.length ? 'Modifica i miei dati personali…' : 'Inserisci i tuoi dati personali…'), icon: 'settings', run: () => (persona ? this.app.tools.run('rubrica') : editProfileDialog(this.app, this.store)) },
    ]);
  }
  #armText(text) {
    this.setTool('text'); this.pendingText = text;
    this.app.ui.toast('Ora fai clic sulla pagina dove inserirlo', { timeout: 2500 });
  }

  /** sig: { dataUrl, w, h, kind, firmaRef?, natural? } */
  addImage(sig, { pageIndex = null, rect = null, select = true } = {}) {
    const pi = pageIndex ?? this.#visiblePage();
    const box = this.#pageBox(pi); const rot = this.#rot(pi);
    if (!rect) {
      const ratio = (sig.w || 3) / (sig.h || 1);
      const P = dimensioniVisive(box, rot);
      let ww; let hh;
      if (sig.natural) { ww = Math.min(sig.w, P.w * 0.6); hh = ww / ratio; }
      else { hh = sig.kind === 'initials' ? 24 : 40; ww = Math.min(hh * ratio, P.w * 0.6); hh = ww / ratio; }
      const c = this.#visibleCenter(pi);
      const [vx, vy] = c ? pdfToVisivo(box, rot, c[0], c[1]) : [P.w / 2, P.h / 2];
      rect = rettangoloInPosizione(box, rot, { fx: vx / P.w, fy: vy / P.h }, ww, hh, 0);
    }
    const item = { kind: 'image', pageIndex: pi, rect, dataUrl: sig.dataUrl, sigKind: sig.kind, firmaRef: sig.firmaRef || null };
    this.board.add(item, { select });
    this.setTool('select');
    return item;
  }

  // ------------------------------------------------------------------ posizionamento
  #pageBox(pi) {
    const vp = this.app.viewer.getViewport(pi);
    if (!vp) return [0, 0, 595, 842];
    const vb = vp.viewBox; return [vb[0], vb[1], vb[2], vb[3]];
  }
  #visiblePage() { return Math.max(0, Math.min((this.app.activeDoc?.pageCount || 1) - 1, this.app.viewer.pageIndex)); }
  #visibleCenter(pi) {
    const c = this.app.viewer.container.getBoundingClientRect();
    const div = this.app.viewer.getPageDiv(pi); if (!div) return null;
    const r = div.getBoundingClientRect();
    const x = Math.max(r.left, Math.min(r.right, (c.left + c.right) / 2));
    const y = Math.max(r.top + 40, Math.min(r.bottom - 40, (Math.max(c.top, r.top) + Math.min(c.bottom, r.bottom)) / 2));
    return this.app.viewer.clientToPdf(pi, x, y);
  }

  async #textItems(pi) {
    if (this.textCache.has(pi)) return this.textCache.get(pi);
    const p = (async () => { try { const page = await this.app.activeDoc.pdf.getPage(pi + 1); return textItemsFromPdfjs(await page.getTextContent()); } catch { return []; } })();
    this.textCache.set(pi, p);
    return p;
  }

  #place(pi, pt, e) {
    if (this.tool === 'select') return false;
    const [x, y] = pt;
    const size = this.size;
    if (this.tool === 'text' || this.tool === 'date') {
      const text = this.tool === 'date' ? todayIt() : this.pendingText || '';
      this.pendingText = null;
      const lineH = size * LINE_H;
      // il clic indica il punto in alto a sinistra, un po' sopra il puntatore (come Acrobat)
      const item = { kind: 'text', pageIndex: pi, text, size, color: this.color, rect: [x, y - lineH * 0.6, x + Math.max(size * 4, size * 0.6 * (text.length + 1)), y + lineH * 0.4] };
      this.board.add(item);
      // aggancio alle righe «_____» vicine
      this.#textItems(pi).then((items) => {
        const line = items.find((it) => /_{3,}|\.{6,}/.test(it.str) && x >= it.x - 4 && x <= it.x + it.w + 4 && Math.abs(it.y - (y - lineH * 0.3)) < Math.max(8, size));
        if (line && this.board.items.includes(item)) {
          const baseY = line.y + size * 0.18;
          const top = baseY + size * BASELINE; // la linea di base del testo poco sopra la riga
          const hgt = item.rect[3] - item.rect[1];
          item.rect = [item.rect[0], top - hgt, item.rect[2], top];
          this.board.drawPage(pi); this.#focusText(item);
        }
      });
      if (this.tool === 'date') { this.#fitTextLater(item); this.setTool('text'); }
      else this.#focusText(item);
      return true;
    }
    // segni: quadrato centrato sul clic, adattato a una casella ☐ vicina
    const s = Math.max(8, size * 1.1);
    const item = { kind: this.tool, pageIndex: pi, color: this.color, rect: [x - s / 2, y - s / 2, x + s / 2, y + s / 2] };
    this.board.add(item);
    this.#textItems(pi).then((items) => {
      const box = items.find((it) => /[☐□❑❒◻▢☐]/.test(it.str) && x >= it.x - 3 && x <= it.x + it.w + 3 && y >= it.y - it.h * 0.4 && y <= it.y + it.h * 1.2);
      if (box && this.board.items.includes(item)) {
        const cw = box.w / Math.max(1, box.str.length); const idx = Math.max(0, Math.min(box.str.length - 1, Math.floor((x - box.x) / cw)));
        const cx = box.x + cw * (idx + 0.5); const cy = box.y + box.h * 0.35; const ss = Math.max(6, box.h * 0.75);
        item.rect = [cx - ss / 2, cy - ss / 2, cx + ss / 2, cy + ss / 2];
        this.board.drawPage(pi);
      }
    });
    return true;
  }

  // ------------------------------------------------------------------ disegno a schermo
  #render(el, item, { scale }) {
    if (item.kind === 'text') {
      el.classList.add('mod-text');
      const ed = document.createElement('div');
      ed.className = 'mod-text-edit';
      ed.contentEditable = 'plaintext-only';
      ed.spellcheck = true;
      ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-label', 'Testo'); ed.setAttribute('aria-multiline', 'true');
      Object.assign(ed.style, { fontSize: item.size * scale + 'px', color: item.color, lineHeight: String(LINE_H) });
      ed.textContent = item.text;
      ed.addEventListener('input', () => { item.text = ed.innerText.replace(/\n$/, ''); this.#fitText(item, ed); });
      ed.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ed.blur(); this.board.select(null); } });
      ed.addEventListener('blur', () => { if (!item.text.trim()) setTimeout(() => { if (this.board.items.includes(item) && !item.text.trim()) this.board.remove(item); }, 0); });
      el.append(ed);
    } else if (item.kind === 'image') {
      el.classList.add('mod-image');
      const img = document.createElement('img'); img.src = item.dataUrl; img.alt = item.sigKind === 'initials' ? 'Sigla' : item.sigKind === 'timbro' ? 'Timbro' : 'Firma'; img.draggable = false;
      el.append(img);
    } else {
      el.classList.add('mod-mark');
      el.innerHTML = item.kind === 'dot'
        ? `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="30" fill="${item.color}"/></svg>`
        : `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${MARKS[item.kind]}" fill="none" stroke="${item.color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
  }
  #focusText(item) {
    requestAnimationFrame(() => {
      const ed = this.board.elementOf(item)?.querySelector('.mod-text-edit');
      if (!ed) return;
      ed.focus();
      const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
    });
  }
  #fitTextLater(item) { requestAnimationFrame(() => this.#fitText(item)); }
  /** Adatta il riquadro al testo scritto (si allarga mentre si scrive). */
  #fitText(item, ed) {
    const el = this.board.elementOf(item); if (!el) return;
    ed ||= el.querySelector('.mod-text-edit'); if (!ed) return;
    const viewer = this.app.viewer;
    const pi = item.pageIndex;
    const r = el.getBoundingClientRect();
    const vp = viewer.getViewport(pi);
    const needW = Math.max(ed.scrollWidth + 4, item.size * vp.scale * 2);
    const needH = Math.max(ed.scrollHeight, item.size * LINE_H * vp.scale);
    const a = viewer.clientToPdf(pi, r.left, r.top); const b = viewer.clientToPdf(pi, r.left + needW, r.top + needH);
    if (!a || !b) return;
    item.rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const css = rectToCss(viewer, pi, item.rect);
    Object.assign(el.style, { width: css.width + 'px', height: css.height + 'px', left: css.left + 'px', top: css.top + 'px' });
  }

  // ------------------------------------------------------------------ scrittura nel PDF
  async applyNow() {
    const items = this.board.items.filter((i) => !(i.kind === 'text' && !i.text.trim()));
    if (!items.length) { this.app.ui.toast('Non c\'è niente da applicare: fai clic sulla pagina per aggiungere testo o segni.'); return; }
    document.activeElement?.blur?.();
    try {
      await this.apply(items, this.doc);
      this.board.clear();
    } catch (err) { this.app.reportError(err, 'Non è stato possibile scrivere gli elementi nella pagina'); }
  }

  async apply(items, doc) {
    const nSig = items.filter((i) => i.kind === 'image').length;
    const nTimbri = items.filter((i) => i.sigKind === 'timbro').length;
    const label = nSig && items.length === nSig ? (nTimbri === nSig ? (nSig > 1 ? 'Timbri aggiunti' : 'Timbro aggiunto') : nSig > 1 ? 'Firme aggiunte' : 'Firma aggiunta') : 'Compila e firma';
    await this.app.editWithPdfLib(label, async (pdfDoc, PDFLib) => {
      const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      const imgCache = new Map();
      const canEncode = (ch) => { try { font.encodeText(ch); return true; } catch { return false; } };
      for (const it of items) {
        const page = pages[it.pageIndex]; if (!page) continue;
        const rot = page.getRotation().angle || 0;
        const pl = placement(it.rect, rot);
        const color = hexToRgb(PDFLib, it.color || '#111111');
        const deg = PDFLib.degrees(pl.rotate);
        if (it.kind === 'text') {
          const lines = winAnsiSafe(it.text, canEncode).split('\n');
          lines.forEach((ln, i) => {
            if (!ln) return;
            const p = localToPdf(pl, 0, pl.h - it.size * BASELINE - i * it.size * LINE_H);
            page.drawText(ln, { x: p.x, y: p.y, size: it.size, font, color, rotate: deg });
          });
        } else if (it.kind === 'image') {
          let img = imgCache.get(it.dataUrl);
          if (!img) { img = await pdfDoc.embedPng(dataUrlToBytes(it.dataUrl)); imgCache.set(it.dataUrl, img); }
          page.drawImage(img, { x: pl.x, y: pl.y, width: pl.w, height: pl.h, rotate: deg });
        } else if (it.kind === 'dot') {
          const c = localToPdf(pl, pl.w / 2, pl.h / 2);
          page.drawCircle({ x: c.x, y: c.y, size: Math.min(pl.w, pl.h) * 0.3, color });
        } else {
          const s = Math.min(pl.w, pl.h);
          const tl = localToPdf(pl, (pl.w - s) / 2, pl.h - (pl.h - s) / 2);
          page.drawSvgPath(MARKS[it.kind], { x: tl.x, y: tl.y, scale: s / 100, borderColor: color, borderWidth: 12, borderLineCap: PDFLib.LineCapStyle.Round, rotate: deg });
        }
      }
    }, doc);
    // firme di altre persone: annotate nel registro solo dopo che sono state scritte davvero
    try { registraUsi(this.archivio, items, doc?.name || 'documento'); } catch (e) { this.app.log?.('warn', 'registro firme non aggiornato', { error: e.message }); }
  }
}
