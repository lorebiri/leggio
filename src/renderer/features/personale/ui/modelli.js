// Modelli di modulo: «Salva come modello» (moduli compilabili), «Zone da compilare (modello)» (PDF non
// compilabili: si disegnano i riquadri sulla pagina), «I miei modelli» (elenco, rinomina, elimina, usa).
import { Board } from '../../moduli/board.js';
import { normRect } from '../../moduli/lib/geom.js';
import {
  modelloDaPdf, modelloPerDocumento, normalizzaModello, improntaPdf, chiaviDisponibili, etichettaChiave, ALLINEAMENTI, proponiCorrispondenze,
} from '../lib/modelli.js';

// ------------------------------------------------------------------------------------------- menu del dato
/**
 * Menu a tendina per scegliere il dato di un campo o di una zona. colonne: intestazioni del file (serie).
 * onChange(chiave). → <select> con .valore (chiave corrente)
 */
export function selettoreChiave(app, { valore = '', colonne = [], onChange = () => {}, etichetta = 'Dato' } = {}) {
  const { h } = app.ui;
  const sel = h('select', { class: 'serie-sel-chiave', 'aria-label': etichetta });
  let corrente = valore || '';
  const riempi = () => {
    sel.textContent = '';
    sel.append(h('option', { value: '' }, '— Non compilare —'));
    if (colonne.length) sel.append(h('optgroup', { label: 'Colonne del file' }, colonne.map((c) => h('option', { value: 'colonna:' + c }, c))));
    sel.append(h('optgroup', { label: 'Dati della persona o dell\'ente' }, chiaviDisponibili().filter((c) => c.value !== 'oggi').map((c) => h('option', { value: c.value }, c.label))));
    const altro = [h('option', { value: 'oggi' }, 'Data di oggi')];
    if (corrente.startsWith('colonna:') && !colonne.includes(corrente.slice(8))) altro.push(h('option', { value: corrente }, etichettaChiave(corrente)));
    if (corrente.startsWith('fisso:')) altro.push(h('option', { value: corrente }, etichettaChiave(corrente)));
    if (!colonne.length) altro.push(h('option', { value: '__colonna' }, 'Colonna del file…'));
    altro.push(h('option', { value: '__fisso' }, 'Testo fisso…'));
    sel.append(h('optgroup', { label: 'Altro' }, altro));
    sel.value = corrente;
    if (sel.value !== corrente) { corrente = ''; sel.value = ''; }
  };
  riempi();
  sel.addEventListener('change', async () => {
    const v = sel.value;
    if (v === '__fisso' || v === '__colonna') {
      sel.value = corrente;
      const testo = await app.ui.prompt(v === '__fisso' ? 'Testo da scrivere uguale in tutti i documenti' : 'Nome della colonna del file (come nella prima riga del foglio)', corrente.startsWith(v === '__fisso' ? 'fisso:' : 'colonna:') ? corrente.replace(/^(fisso|colonna):/, '') : '', { title: v === '__fisso' ? 'Testo fisso' : 'Colonna del file', okLabel: 'Usa' });
      if (testo == null || !String(testo).trim()) { sel.focus(); return; }
      corrente = (v === '__fisso' ? 'fisso:' : 'colonna:') + String(testo).trim();
      riempi(); sel.focus(); onChange(corrente);
      return;
    }
    corrente = v; riempi(); onChange(corrente);
  });
  Object.defineProperty(sel, 'valore', { get: () => corrente, set: (x) => { corrente = x || ''; riempi(); } });
  return sel;
}

// ------------------------------------------------------------------------------------------- salvataggio
/** Salva un modello con il PDF; se il PDF non è cambiato tiene quello già archiviato (niente doppioni). */
export async function salvaModelloConPdf(archivio, m, bytes, esistente = null) {
  const stessoPdf = esistente?.blob && esistente.impronta && esistente.impronta === m.impronta;
  const salvato = await archivio.salvaModello({ ...m, id: esistente?.id, blob: stessoPdf ? esistente.blob : null }, stessoPdf ? null : bytes);
  if (esistente?.blob && !stessoPdf) { try { await archivio.salvaOra(); await archivio.backend.cancellaBlob(esistente.blob); } catch { /* resta un file orfano cifrato */ } }
  return salvato;
}

async function archivioPronto(app, ctx) {
  if (await ctx.apri()) return true;
  app.ui.toast('Per i modelli serve l\'archivio personale: aprilo con la sua password.', { kind: 'warning', timeout: 6000 });
  return false;
}

/** Byte del documento salvati (senza i valori non ancora salvati: il modello è il modulo vuoto). */
async function byteBase(app, doc) {
  let bytes = doc.bytes;
  if (doc.password) { const d = await app.lib.openPdfLib(bytes, doc.password); bytes = await d.save(); }
  return bytes;
}

async function salvaComeModello(app, ctx) {
  const doc = app.activeDoc;
  if (!(await archivioPronto(app, ctx))) return;
  const { archivio } = ctx; const { h } = app.ui;
  const bytes = await byteBase(app, doc);
  const nuovo = await modelloDaPdf(app.lib.PDFLib, bytes, { nome: (doc.name || 'Modulo').replace(/\.pdf$/i, '') });
  if (!nuovo.campi.length) {
    app.ui.toast('Questo PDF non ha campi compilabili: usa «Zone da compilare (modello)» per indicare dove scrivere i dati.', { kind: 'warning', timeout: 9000, action: { label: 'Zone da compilare', run: () => app.tools.run('template-zones') } });
    return;
  }
  const esistente = await modelloPerDocumento(archivio, bytes, { PDFLib: app.lib.PDFLib });
  const corr = { ...nuovo.corrispondenze, ...(esistente?.tipo === 'acroform' ? esistente.corrispondenze : {}) };
  const nomeIn = h('input', { type: 'text', value: esistente?.nome || nuovo.nome, maxlength: 120, 'aria-label': 'Nome del modello' });
  const selettori = new Map();
  const righe = nuovo.campi.map((c) => {
    const sel = selettoreChiave(app, { valore: corr[c.nome] || '', etichetta: `Dato per il campo ${c.nome}`, onChange: (v) => { corr[c.nome] = v; } });
    selettori.set(c.nome, sel);
    return h('tr', {}, h('th', { scope: 'row', class: 'serie-campo' }, c.nome, c.tipo !== 'text' ? h('span', { class: 'serie-tipo' }, { checkbox: 'casella', radio: 'scelta', dropdown: 'elenco', listbox: 'elenco' }[c.tipo] || '') : null), h('td', {}, sel));
  });
  const body = h('div', { class: 'serie-salva' },
    h('label', { class: 'serie-etichetta' }, 'Nome del modello', nomeIn),
    esistente ? h('p', { class: 'serie-nota' }, `Questo modulo è già salvato come «${esistente.nome}»: le modifiche aggiornano quel modello.`) : null,
    h('p', { class: 'serie-nota' }, 'Per ogni campo scegli il dato da scrivere. La proposta viene dal nome del campo: correggila dove serve.'),
    h('div', { class: 'serie-tabella-wrap' }, h('table', { class: 'serie-tabella' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Campo del modulo'), h('th', { scope: 'col' }, 'Dato'))), h('tbody', {}, righe))));
  const ok = await app.ui.dialog({ title: esistente ? 'Aggiorna il modello' : 'Salva come modello', body, okLabel: 'Salva il modello', width: 640, validate: () => (nomeIn.value.trim() ? null : 'Scrivi un nome per il modello.') });
  if (!ok) return;
  for (const [nome, sel] of selettori) corr[nome] = sel.valore;
  const m = normalizzaModello({ ...nuovo, ...(esistente || {}), tipo: 'acroform', nome: nomeIn.value.trim(), campi: nuovo.campi, impronta: nuovo.impronta, chiaveCampi: nuovo.chiaveCampi, pagine: nuovo.pagine, corrispondenze: corr });
  const salvato = await salvaModelloConPdf(archivio, m, bytes, esistente);
  app.ui.toast(`Modello «${salvato.nome}» salvato. Lo trovi in «I miei modelli».`, { kind: 'success' });
  return salvato;
}

// ------------------------------------------------------------------------------------------- zone
const DIMENSIONI = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];

class ZoneSession {
  constructor(app, ctx) {
    this.app = app; this.ctx = ctx; this.doc = app.activeDoc;
    this.size = 11; this.allinea = 'sinistra'; this.ultimaChiave = '';
    this.modificato = false; this.esistente = null;
    this.board = new Board(app, {
      className: 'serie-zone-layer',
      minSize: 6,
      renderItem: (el, item) => this.#render(el, item),
      onEmptyPointer: (pi, pt, e) => this.#disegna(pi, pt, e),
      onSelect: () => this.#sincronizza(),
      onChange: () => { this.modificato = true; },
      onDelete: () => { this.modificato = true; this.#sincronizza(); },
      pageBox: (pi) => this.#pageBox(pi),
      keepAspect: () => false,
    });
  }
  #pageBox(pi) { const vp = this.app.viewer.getViewport(pi); return vp ? vp.viewBox : [0, 0, 595, 842]; }

  async activate(optionsEl) {
    this.optionsEl = optionsEl;
    this.app.viewer.setMode('tool', 'crosshair');
    this.board.attach();
    this.#barra();
    this.offDoc = this.app.bus.on('document:activated', () => this.app.tools.deactivate());
    if (await this.ctx.apri()) {
      try {
        const m = await modelloPerDocumento(this.ctx.archivio, this.doc.bytes, { PDFLib: this.app.lib.PDFLib });
        if (m?.tipo === 'zone' && this.board.attached) {
          this.esistente = m;
          for (const z of m.zone) this.board.add({ kind: 'zona', pageIndex: z.pagina, rect: z.rect.slice(), chiave: z.chiave, size: z.size, allinea: z.allinea }, { select: false });
          for (const k of ['firma', 'timbro']) if (m[k]) this.board.add({ kind: k, pageIndex: m[k].pagina < 0 ? Math.max(0, this.doc.pageCount + m[k].pagina) : m[k].pagina, rect: m[k].rect.slice() }, { select: false });
          this.app.ui.toast(`Modello «${m.nome}» caricato: puoi modificare le zone.`, { kind: 'info', timeout: 5000 });
          this.#sincronizza();
        }
      } catch { /* modello non leggibile: si parte da zero */ }
    }
  }
  async deactivate() {
    this.offDoc?.();
    const zone = this.board.items.length;
    this.board.detach();
    if (!this.modificato || !zone || !this.app.docs.includes(this.doc)) return;
    const r = await this.app.ui.choice({ title: 'Zone da compilare', message: 'Vuoi salvare le zone disegnate come modello?', buttons: [{ value: 'no', label: 'Non salvare' }, { value: 'si', label: 'Salva il modello', primary: true }] });
    if (r === 'si') await this.salva(this.board.items).catch((err) => this.app.reportError(err, 'Modello non salvato'));
  }

  // -------------------------------------------------------------- barra delle opzioni
  #barra() {
    const { h } = this.app.ui;
    const el = this.optionsEl; el.textContent = '';
    this.selChiave = selettoreChiave(this.app, { valore: '', etichetta: 'Dato della zona selezionata', onChange: (v) => { const it = this.board.selected; this.ultimaChiave = v; if (it?.kind === 'zona') { it.chiave = v; this.modificato = true; this.board.update(it); } } });
    this.selSize = h('select', { 'aria-label': 'Dimensione del carattere', onchange: () => { this.size = +this.selSize.value; const it = this.board.selected; if (it?.kind === 'zona') { it.size = this.size; this.modificato = true; this.board.update(it); } } }, DIMENSIONI.map((d) => h('option', { value: d, selected: d === this.size }, d + ' pt')));
    this.selAll = h('select', { 'aria-label': 'Allineamento del testo', onchange: () => { this.allinea = this.selAll.value; const it = this.board.selected; if (it?.kind === 'zona') { it.allinea = this.allinea; this.modificato = true; this.board.update(it); } } }, ALLINEAMENTI.map((a) => h('option', { value: a.value }, a.label)));
    this.conteggio = h('span', { class: 'serie-zone-conta', 'aria-live': 'polite' });
    el.append(
      h('button', { type: 'button', class: 'btn small', title: 'Aggiunge una zona al centro della pagina (poi spostala con le frecce o trascinandola)', onclick: () => this.aggiungi('zona') }, '＋ Zona'),
      h('label', { class: 'serie-zone-campo' }, 'Dato', this.selChiave),
      h('label', { class: 'serie-zone-campo' }, 'Carattere', this.selSize),
      h('label', { class: 'serie-zone-campo' }, 'Allinea', this.selAll),
      h('span', { class: 'tb-sep' }),
      h('button', { type: 'button', class: 'btn small', title: 'Dove mettere la firma nella compilazione in serie', onclick: () => this.aggiungi('firma') }, 'Posizione firma'),
      h('button', { type: 'button', class: 'btn small', title: 'Dove mettere il timbro nella compilazione in serie', onclick: () => this.aggiungi('timbro') }, 'Posizione timbro'),
      this.conteggio,
      h('span', { class: 'mod-hint' }, 'Trascina sulla pagina per disegnare una zona. Canc la elimina.'),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => this.salva(this.board.items).catch((err) => this.app.reportError(err, 'Modello non salvato')) }, 'Salva modello'),
    );
    this.#sincronizza();
  }
  #sincronizza() {
    const it = this.board.selected;
    const zona = it?.kind === 'zona';
    for (const c of [this.selChiave, this.selSize, this.selAll]) if (c) c.disabled = !zona;
    if (zona) { this.selChiave.valore = it.chiave || ''; this.selSize.value = String(it.size); this.selAll.value = it.allinea; }
    const n = this.board.items.filter((i) => i.kind === 'zona').length;
    if (this.conteggio) this.conteggio.textContent = n === 1 ? '1 zona' : `${n} zone`;
  }

  // -------------------------------------------------------------- disegno
  #render(el, item) {
    el.classList.add('serie-zona', 'k-' + item.kind);
    const testo = item.kind === 'zona' ? (item.chiave ? etichettaChiave(item.chiave) : 'Scegli il dato') : item.kind === 'firma' ? 'Firma' : 'Timbro';
    if (item.kind === 'zona' && !item.chiave) el.classList.add('vuota');
    const lab = document.createElement('span'); lab.className = 'serie-zona-label'; lab.textContent = testo;
    if (item.kind === 'zona') lab.style.textAlign = { sinistra: 'left', centro: 'center', destra: 'right' }[item.allinea] || 'left';
    el.title = item.kind === 'zona' ? `Zona: ${testo} (${item.size} pt)` : `Posizione: ${testo}`;
    el.setAttribute('role', 'group'); el.setAttribute('aria-label', el.title);
    el.append(lab);
  }
  #disegna(pi, start, e) {
    const viewer = this.app.viewer; const box = this.#pageBox(pi);
    const clamp = (p) => [Math.max(box[0], Math.min(box[2], p[0])), Math.max(box[1], Math.min(box[3], p[1]))];
    const item = { kind: 'zona', pageIndex: pi, rect: [start[0], start[1], start[0], start[1]], chiave: this.ultimaChiave, size: this.size, allinea: this.allinea };
    this.board.add(item, { select: false });
    const move = (ev) => {
      const p = viewer.clientToPdf(pi, ev.clientX, ev.clientY); if (!p) return;
      item.rect = normRect([start[0], start[1], ...clamp(p)]);
      const el = this.board.elementOf(item);
      if (el) { const vp = viewer.getViewport(pi); const [ax, ay] = vp.convertToViewportPoint(item.rect[0], item.rect[1]); const [bx, by] = vp.convertToViewportPoint(item.rect[2], item.rect[3]); Object.assign(el.style, { left: Math.min(ax, bx) + 'px', top: Math.min(ay, by) + 'px', width: Math.abs(bx - ax) + 'px', height: Math.abs(by - ay) + 'px' }); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      const [x1, y1, x2, y2] = item.rect;
      // un clic senza trascinare: zona di misura normale sotto il puntatore
      if (x2 - x1 < 8 || y2 - y1 < 6) { const hh = Math.max(14, this.size * 1.6); item.rect = normRect([start[0], start[1] - hh / 2, Math.min(box[2], start[0] + 160), start[1] + hh / 2]); }
      this.modificato = true;
      this.board.select(item);
      this.#sincronizza();
      requestAnimationFrame(() => this.selChiave?.focus());
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    e.preventDefault();
    return true;
  }
  aggiungi(kind) {
    const pi = Math.max(0, Math.min((this.doc.pageCount || 1) - 1, this.app.viewer.pageIndex));
    const box = this.#pageBox(pi);
    if (kind !== 'zona') { const vecchio = this.board.items.find((i) => i.kind === kind); if (vecchio) this.board.remove(vecchio); }
    const [w, hh] = kind === 'firma' ? [150, 55] : kind === 'timbro' ? [110, 110] : [180, Math.max(14, this.size * 1.6)];
    const cx = (box[0] + box[2]) / 2; const cy = kind === 'zona' ? (box[1] + box[3]) / 2 : box[1] + 60 + hh / 2;
    const x1 = kind === 'zona' ? cx - w / 2 : box[2] - 48 - w;
    const item = { kind, pageIndex: pi, rect: [x1, cy - hh / 2, x1 + w, cy + hh / 2], ...(kind === 'zona' ? { chiave: this.ultimaChiave, size: this.size, allinea: this.allinea } : {}) };
    this.board.add(item);
    this.modificato = true; this.#sincronizza();
  }

  async salva(items) {
    if (!(await archivioPronto(this.app, this.ctx))) return null;
    const zone = items.filter((i) => i.kind === 'zona');
    if (!zone.length) { this.app.ui.toast('Disegna almeno una zona sulla pagina (trascina con il mouse) e scegli il dato da scriverci.', { kind: 'warning', timeout: 6000 }); return null; }
    const senza = zone.filter((z) => !z.chiave).length;
    const v = await this.app.ui.dialog({
      title: this.esistente ? 'Aggiorna il modello' : 'Salva il modello a zone',
      message: senza ? `${senza === 1 ? 'Una zona non ha' : senza + ' zone non hanno'} un dato scelto: ${senza === 1 ? 'verrà ignorata' : 'verranno ignorate'}.` : '',
      fields: [{ name: 'nome', label: 'Nome del modello', value: this.esistente?.nome || (this.doc.name || 'Modulo').replace(/\.pdf$/i, ''), required: true }],
      okLabel: 'Salva il modello',
    });
    if (!v) return null;
    const bytes = await byteBase(this.app, this.doc);
    const pos = (k) => { const it = items.find((i) => i.kind === k); return it ? { pagina: it.pageIndex, rect: normRect(it.rect) } : undefined; };
    const m = normalizzaModello({
      ...(this.esistente || {}), nome: v.nome.trim(), tipo: 'zone', impronta: await improntaPdf(bytes), pagine: this.doc.pageCount, campi: [], corrispondenze: {},
      zone: zone.map((z, i) => ({ id: 'z' + (i + 1), pagina: z.pageIndex, rect: normRect(z.rect), chiave: z.chiave, size: z.size, allinea: z.allinea })),
      firma: pos('firma'), timbro: pos('timbro'),
    });
    if (!m.firma) delete m.firma; if (!m.timbro) delete m.timbro;
    const salvato = await salvaModelloConPdf(this.ctx.archivio, m, bytes, this.esistente);
    this.esistente = salvato; this.modificato = false;
    this.app.ui.toast(`Modello «${salvato.nome}» salvato (${zone.length} ${zone.length === 1 ? 'zona' : 'zone'}). Usalo in «Compilazione in serie».`, { kind: 'success', timeout: 6000, action: { label: 'Compilazione in serie', run: () => { this.app.tools.deactivate(); this.ctx.serie?.avvia({ modelloId: salvato.id }); } } });
    return salvato;
  }
}

// ------------------------------------------------------------------------------------------- elenco
async function iMieiModelli(app, ctx) {
  if (!(await archivioPronto(app, ctx))) return;
  const { archivio } = ctx; const { h } = app.ui;
  const lista = h('div', { class: 'serie-modelli', role: 'list' });
  let chiudi = null;
  const data = (s) => { try { return new Date(s).toLocaleDateString('it-IT'); } catch { return ''; } };
  const disegna = () => {
    lista.textContent = '';
    const modelli = archivio.modelli();
    if (!modelli.length) {
      lista.append(h('div', { class: 'serie-vuoto' }, h('p', {}, 'Non hai ancora salvato modelli.'), h('p', { class: 'serie-nota' }, 'Apri un modulo e usa «Salva come modello» (moduli compilabili) oppure «Zone da compilare (modello)» (PDF normali, anche scansionati).')));
      return;
    }
    for (const m of modelli) {
      const dettagli = m.tipo === 'zone' ? `${(m.zone || []).length} zone` : `${(m.campi || []).length} campi`;
      lista.append(h('div', { class: 'serie-modello', role: 'listitem' },
        h('div', { class: 'serie-modello-txt' }, h('strong', {}, m.nome), h('small', {}, `${m.tipo === 'zone' ? 'PDF a zone' : 'Modulo compilabile'} · ${dettagli}${m.modificato ? ' · modificato il ' + data(m.modificato) : ''}`)),
        h('div', { class: 'serie-modello-azioni' },
          h('button', { type: 'button', class: 'btn small primary', onclick: () => { chiudi?.(); ctx.serie?.avvia({ modelloId: m.id }); } }, 'Usa per la serie'),
          h('button', { type: 'button', class: 'btn small', disabled: !m.blob, title: m.blob ? 'Apri il PDF del modello in una nuova scheda' : 'Il PDF non è stato salvato con questo modello', onclick: async () => {
            try { const b = await archivio.pdfModello(m.id); if (!b) throw new Error('Il PDF di questo modello non è disponibile.'); chiudi?.(); await app.openBytes(b, { name: `${m.nome}.pdf` }); }
            catch (err) { app.reportError(err, 'Modello non aperto'); }
          } }, 'Apri il PDF'),
          h('button', { type: 'button', class: 'btn small', onclick: async () => {
            const nome = await app.ui.prompt('Nuovo nome', m.nome, { title: 'Rinomina il modello', okLabel: 'Rinomina' });
            if (nome && nome.trim()) { await archivio.salvaModello({ ...m, nome: nome.trim() }); disegna(); }
          } }, 'Rinomina'),
          h('button', { type: 'button', class: 'btn small danger', onclick: async () => {
            if (!(await app.ui.confirm(`Eliminare il modello «${m.nome}»? Il PDF salvato con il modello verrà cancellato dall'archivio (i tuoi file non vengono toccati).`, { title: 'Elimina modello', okLabel: 'Elimina', danger: true }))) return;
            await archivio.eliminaModello(m.id); disegna();
          } }, 'Elimina'))));
    }
  };
  disegna();
  await app.ui.dialog({ title: 'I miei modelli', body: lista, okLabel: 'Chiudi', cancelLabel: null, width: 720, onOpen: (form) => { chiudi = () => form.querySelector('.dlg-foot .btn')?.click(); } });
}

// ------------------------------------------------------------------------------------------- registrazione
export function registerModelli(app, ctx) {
  let sessione = null;
  app.registerTool({
    id: 'save-template', name: 'Salva come modello', category: 'moduli', icon: 'form',
    description: 'Ricorda quale dato va in ogni campo di questo modulo, per compilarlo in un attimo e per la compilazione in serie',
    keywords: 'modello template salva modulo corrispondenze campi serie stampa unione',
    run: () => salvaComeModello(app, ctx),
  });
  app.registerTool({
    id: 'template-zones', name: 'Zone da compilare (modello)', category: 'moduli', icon: 'shape',
    description: 'Per i PDF non compilabili: disegna i riquadri dove scrivere nome, codice fiscale… e salvali come modello',
    keywords: 'zone riquadri modello pdf non compilabile scansione serie posizioni campi template',
    interactive: {
      activate(a, optionsEl) { try { sessione = new ZoneSession(a, ctx); sessione.activate(optionsEl).catch((err) => a.reportError(err, 'Zone da compilare')); } catch (err) { a.reportError(err, 'Strumento non disponibile'); } },
      deactivate() { const s = sessione; sessione = null; s?.deactivate()?.catch?.((err) => app.reportError(err, 'Chiusura dello strumento')); },
    },
  });
  app.registerTool({
    id: 'templates', name: 'I miei modelli', category: 'moduli', icon: 'archive', needsDoc: false,
    description: 'Modelli di modulo salvati: rinomina, elimina, apri il PDF, usali per la compilazione in serie',
    keywords: 'modelli template salvati elenco moduli serie',
    run: () => iMieiModelli(app, ctx),
  });
  return { salvaComeModello: () => salvaComeModello(app, ctx), get sessione() { return sessione; } };
}

export { proponiCorrispondenze };
