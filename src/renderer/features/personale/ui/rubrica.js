// Rubrica di persone ed enti: finestra a tutta area con ricerca istantanea, gruppi, elenco virtualizzato
// (migliaia di contatti), scheda del contatto, importazione/esportazione, doppioni e selezione multipla.
import { openPane } from '../../avanzati/pane.js';
import { CAMPI_CONTATTO, nomeContatto } from '../lib/campi.js';
import { avvisiContatto } from '../lib/validatori.js';
import { cercaContatti, trovaDuplicati, calcolaUnione, applicaUnione, esportaCsv, SENZA_GRUPPO } from '../lib/rubrica.js';
import { modificaContatto, sezioneFirme, sezioneRegistro, esportaDatiPersona, cancellaPersona, sceltaGruppi, data } from './contatto.js';
import { importaContatti } from './importa.js';
import { dettaglioContatto, iniziali, scegliContatto } from './scegli.js';

export { scegliContatto };

/** replaceChildren senza i valori vuoti (null/false diventerebbero testo «null»). */
const metti = (el, ...n) => el.replaceChildren(...n.flat().filter((x) => x != null && x !== false));
const ALTEZZA_RIGA = 60;
const CHIAVE_NON_DOPPI = 'personale.rubrica.nonDoppi';

export function registerRubrica(app, ctx) {
  app.registerTool({
    id: 'rubrica', name: 'Rubrica', category: 'moduli', icon: 'user', needsDoc: false,
    description: 'Persone ed enti: dati anagrafici, codici fiscali, PEC, IBAN e gruppi, per compilare i moduli e firmare a nome di altri.',
    keywords: 'rubrica contatti persone enti fornitori clienti anagrafica indirizzi codice fiscale partita iva pec iban vcard importa csv excel gdpr',
    run: async () => { if (await ctx.apri()) apriRubrica(app, ctx); },
  });
  // scorciatoie per le altre aree (e per il collaudo da console: __leggioPersonale.scegliContatto())
  ctx.scegliContatto = (opzioni) => scegliContatto(app, ctx.archivio, opzioni);
  ctx.apriRubrica = async (opzioni) => { if (await ctx.apri()) return apriRubrica(app, ctx, opzioni); return null; };
}

/** Apre la finestra della Rubrica. opzioni.contattoId: contatto da mostrare subito. */
export function apriRubrica(app, ctx, { contattoId = null } = {}) {
  const { h } = app.ui;
  const { archivio } = ctx;
  const uid = 'rub' + Math.random().toString(36).slice(2, 7);
  let risultati = []; let attivo = 0; let attivoId = contattoId;
  let modoSelezione = false; const selezionati = new Set();
  let doppi = [];

  const offs = [];
  const pane = openPane(app, { title: 'Rubrica', subtitle: '', id: 'rubrica', onClose: () => { offs.forEach((o) => o()); } });
  pane.el.classList.add('rub-pane');

  // ------------------------------------------------------------------ barra in alto
  const btnDoppi = h('button', { class: 'btn', onclick: () => finestraDoppioni() }, 'Doppioni');
  const btnSel = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => impostaSelezione(!modoSelezione) }, 'Seleziona più contatti');
  pane.actions.append(
    h('button', { class: 'btn primary', onclick: () => nuovo() }, 'Nuovo contatto'),
    h('button', { class: 'btn', onclick: async () => { const r = await importaContatti(app, archivio); if (r) aggiorna(); } }, 'Importa…'),
    h('button', { class: 'btn', onclick: () => esporta() }, 'Esporta CSV…'),
    btnDoppi, btnSel);

  // ------------------------------------------------------------------ colonna dell'elenco
  const cerca = h('input', { type: 'search', class: 'input rub-cerca', placeholder: 'Cerca nome, codice fiscale, P.IVA, email, telefono, città…', 'aria-label': 'Cerca nella rubrica', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': uid + '-lista', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false' });
  const filtro = h('select', { class: 'input rub-filtro', 'aria-label': 'Filtra per gruppo' });
  const conteggio = h('p', { class: 'rub-conteggio', 'aria-live': 'polite' });
  const spazio = h('div', { class: 'rub-spazio' });
  const lista = h('div', { id: uid + '-lista', class: 'rub-lista', role: 'listbox', tabindex: '0', 'aria-label': 'Contatti' }, spazio);
  const barraSel = h('div', { class: 'rub-barra-sel', hidden: true });
  const vuota = h('div', { class: 'rub-vuota', hidden: true });
  const colonna = h('div', { class: 'rub-colonna' }, h('div', { class: 'rub-ricerca' }, cerca, filtro), conteggio, barraSel, lista, vuota);
  const scheda = h('div', { class: 'rub-scheda', 'aria-label': 'Scheda del contatto', role: 'region' });
  pane.body.classList.add('rub-body');
  pane.body.append(colonna, scheda);

  // ------------------------------------------------------------------ dati
  function aggiornaGruppi() {
    const g = archivio.gruppi(); const v = filtro.value;
    metti(filtro, h('option', { value: '' }, 'Tutti i gruppi'), ...g.map((x) => h('option', { value: x.nome }, `${x.nome} (${x.n})`)), g.length ? h('option', { value: SENZA_GRUPPO }, 'Senza gruppo') : null);
    filtro.value = v && (v === SENZA_GRUPPO ? g.length : g.some((x) => x.nome === v)) ? v : '';
    filtro.hidden = !g.length;
  }
  function aggiornaDoppi() {
    const ignorati = new Set(app.settings.get(CHIAVE_NON_DOPPI, []) || []);
    doppi = trovaDuplicati(archivio.contatti()).filter((g) => !ignorati.has(chiaveGruppo(g)));
    btnDoppi.textContent = doppi.length ? `Doppioni (${doppi.length})` : 'Doppioni';
    btnDoppi.classList.toggle('rub-attenzione', doppi.length > 0);
    btnDoppi.setAttribute('aria-label', doppi.length ? `Doppioni: ${doppi.length} gruppi da controllare` : 'Doppioni: nessuno trovato');
  }
  function filtra({ mantieni = true } = {}) {
    const prima = mantieni ? (risultati[attivo]?.id || attivoId) : null;
    risultati = cercaContatti(archivio.contatti(), cerca.value, { gruppo: filtro.value });
    const k = prima ? risultati.findIndex((c) => c.id === prima) : -1;
    attivo = k >= 0 ? k : 0;
    const tot = archivio.contatti().length;
    pane.setTitle('Rubrica', tot ? `${tot === 1 ? '1 contatto' : `${tot} contatti`} nell'archivio personale` : 'Archivio personale');
    conteggio.textContent = !tot ? '' : (cerca.value.trim() || filtro.value) ? `${risultati.length === 1 ? '1 trovato' : `${risultati.length} trovati`} su ${tot}` : `${tot === 1 ? '1 contatto' : `${tot} contatti`}, in ordine alfabetico`;
    vuota.hidden = !!risultati.length;
    lista.hidden = !risultati.length;
    if (!tot) metti(vuota, h('strong', {}, 'La rubrica è vuota'), h('p', {}, 'Aggiungi persone ed enti con «Nuovo contatto», oppure importali da un file CSV, Excel o vCard (esportato da Outlook, Gmail o dal telefono).'),
      h('div', { class: 'rub-riga-in' }, h('button', { class: 'btn primary', onclick: () => nuovo() }, 'Nuovo contatto'), h('button', { class: 'btn', onclick: async () => { if (await importaContatti(app, archivio)) aggiorna(); } }, 'Importa…')));
    else metti(vuota, h('strong', {}, 'Nessun contatto trovato'), h('p', {}, 'Prova con meno parole o scegli «Tutti i gruppi».'));
    spazio.style.height = risultati.length * ALTEZZA_RIGA + 'px';
    disegnaRighe(true);
    disegnaScheda();
    disegnaBarraSel();
  }
  function aggiorna() { aggiornaGruppi(); aggiornaDoppi(); for (const id of [...selezionati]) if (!archivio.contatto(id)) selezionati.delete(id); filtra(); }

  // ------------------------------------------------------------------ elenco virtualizzato
  const righeDom = new Map(); // indice → elemento
  function disegnaRighe(tutto = false) {
    if (tutto) { righeDom.forEach((el) => el.remove()); righeDom.clear(); }
    const alt = lista.clientHeight || 600;
    const da = Math.max(0, Math.floor(lista.scrollTop / ALTEZZA_RIGA) - 6);
    const a = Math.min(risultati.length, Math.ceil((lista.scrollTop + alt) / ALTEZZA_RIGA) + 6);
    for (const [i, el] of righeDom) if (i < da || i >= a) { el.remove(); righeDom.delete(i); }
    for (let i = da; i < a; i++) {
      if (righeDom.has(i)) { aggiornaRiga(righeDom.get(i), i); continue; }
      const el = creaRiga(i); righeDom.set(i, el); spazio.append(el);
    }
    const att = righeDom.get(attivo);
    if (att) { lista.setAttribute('aria-activedescendant', att.id); cerca.setAttribute('aria-activedescendant', att.id); }
    else { lista.removeAttribute('aria-activedescendant'); cerca.removeAttribute('aria-activedescendant'); }
  }
  function creaRiga(i) {
    const c = risultati[i];
    const n = Object.keys(avvisiContatto(c)).length;
    const el = h('div', { class: 'rub-riga', role: 'option', id: `${uid}-r-${c.id}`, style: { top: i * ALTEZZA_RIGA + 'px' } },
      h('span', { class: 'rub-spunta', 'aria-hidden': 'true' }),
      h('span', { class: 'rub-avatar', 'aria-hidden': 'true' }, iniziali(c)),
      h('span', { class: 'rub-riga-testo' }, h('span', { class: 'rub-riga-nome' }, nomeContatto(c)), h('small', {}, dettaglioContatto(c) || ' ')),
      (c.gruppi || []).length ? h('span', { class: 'rub-riga-gruppi' }, (c.gruppi || []).slice(0, 2).map((g) => h('span', { class: 'rub-chip' }, g)), c.gruppi.length > 2 ? h('span', { class: 'rub-chip' }, `+${c.gruppi.length - 2}`) : null) : null,
      n ? h('span', { class: 'rub-segno', title: 'Ci sono dati da controllare', 'aria-label': 'dati da controllare' }, '!') : null);
    el.addEventListener('mousedown', (e) => { if (e.detail > 1) e.preventDefault(); });
    el.addEventListener('click', () => { vaiA(i, { scorri: false }); if (modoSelezione) cambiaSelezione(c.id); lista.focus({ preventScroll: true }); });
    el.addEventListener('dblclick', () => { if (!modoSelezione) modifica(c); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); vaiA(i, { scorri: false }); menu(c, e.clientX, e.clientY); });
    aggiornaRiga(el, i);
    return el;
  }
  function aggiornaRiga(el, i) {
    const c = risultati[i];
    const sel = modoSelezione ? selezionati.has(c.id) : i === attivo;
    el.setAttribute('aria-selected', String(sel));
    el.classList.toggle('rub-attiva', i === attivo);
    el.classList.toggle('rub-scelta', modoSelezione && selezionati.has(c.id));
    el.classList.toggle('rub-con-spunta', modoSelezione);
  }
  lista.addEventListener('scroll', () => disegnaRighe());
  const ro = new ResizeObserver(() => disegnaRighe());
  ro.observe(lista);
  offs.push(() => ro.disconnect());

  function vaiA(i, { scorri = true } = {}) {
    if (!risultati.length) return;
    attivo = Math.max(0, Math.min(risultati.length - 1, i));
    attivoId = risultati[attivo].id;
    if (scorri) {
      const top = attivo * ALTEZZA_RIGA;
      if (top < lista.scrollTop) lista.scrollTop = top;
      else if (top + ALTEZZA_RIGA > lista.scrollTop + lista.clientHeight) lista.scrollTop = top + ALTEZZA_RIGA - lista.clientHeight;
    }
    disegnaRighe();
    for (const [k, el] of righeDom) aggiornaRiga(el, k);
    disegnaScheda();
  }

  // ------------------------------------------------------------------ tastiera
  const perPagina = () => Math.max(1, Math.floor((lista.clientHeight || 600) / ALTEZZA_RIGA) - 1);
  function tasti(e, daRicerca) {
    const c = risultati[attivo];
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); vaiA(attivo + 1); break;
      case 'ArrowUp': e.preventDefault(); vaiA(attivo - 1); break;
      case 'PageDown': e.preventDefault(); vaiA(attivo + perPagina()); break;
      case 'PageUp': e.preventDefault(); vaiA(attivo - perPagina()); break;
      case 'Home': if (!daRicerca) { e.preventDefault(); vaiA(0); } break;
      case 'End': if (!daRicerca) { e.preventDefault(); vaiA(risultati.length - 1); } break;
      case 'Enter': if (c) { e.preventDefault(); if (modoSelezione && !daRicerca) cambiaSelezione(c.id); else modifica(c); } break;
      case ' ': if (!daRicerca && c) { e.preventDefault(); if (modoSelezione) cambiaSelezione(c.id); else impostaSelezione(true, c.id); } break;
      case 'Delete': if (!daRicerca && c) { e.preventDefault(); if (modoSelezione && selezionati.size) eliminaSelezionati(); else elimina(c); } break;
      case 'ContextMenu': if (!daRicerca && c) { e.preventDefault(); const r = righeDom.get(attivo)?.getBoundingClientRect(); menu(c, r ? r.left + 40 : 200, r ? r.bottom : 200); } break;
      default:
        // una lettera scritta sull'elenco va nella ricerca
        if (!daRicerca && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { cerca.focus(); }
    }
  }
  cerca.addEventListener('keydown', (e) => tasti(e, true));
  lista.addEventListener('keydown', (e) => tasti(e, false));
  let tCerca = null;
  cerca.addEventListener('input', () => { clearTimeout(tCerca); tCerca = setTimeout(() => { lista.scrollTop = 0; attivoId = null; filtra({ mantieni: false }); }, 40); });
  filtro.addEventListener('change', () => { lista.scrollTop = 0; filtra({ mantieni: false }); });
  // Esc nella ricerca con del testo: svuota (e non chiude la Rubrica)
  const escRicerca = (e) => {
    if (e.key === 'Escape' && document.activeElement === cerca && cerca.value && !document.querySelector('.backdrop')) {
      e.stopPropagation(); e.preventDefault(); cerca.value = ''; filtra({ mantieni: true });
    }
  };
  window.addEventListener('keydown', escRicerca, true);
  offs.push(() => window.removeEventListener('keydown', escRicerca, true));

  // ------------------------------------------------------------------ scheda del contatto
  function disegnaScheda() {
    const c = risultati[attivo];
    if (modoSelezione && selezionati.size) {
      metti(scheda, h('div', { class: 'rub-scheda-vuota' }, h('strong', {}, selezionati.size === 1 ? '1 contatto selezionato' : `${selezionati.size} contatti selezionati`),
        h('p', {}, 'Usa la barra sopra l\'elenco per aggiungerli a un gruppo, unirli, esportarli o eliminarli. Spazio o clic aggiungono e tolgono dalla selezione.')));
      return;
    }
    if (!c) { metti(scheda, h('div', { class: 'rub-scheda-vuota' }, h('p', {}, archivio.contatti().length ? 'Scegli un contatto dall\'elenco.' : 'Qui compariranno i dati del contatto scelto.'))); return; }
    if (scheda.dataset.id === c.id && scheda.dataset.mod === c.modificato) return;
    scheda.dataset.id = c.id; scheda.dataset.mod = c.modificato || '';
    const avv = avvisiContatto(c);
    const dl = h('dl', { class: 'rub-dati' });
    for (const f of CAMPI_CONTATTO) {
      if (!c[f.key]) continue;
      dl.append(h('dt', {}, f.label), h('dd', { class: ['codiceFiscale', 'partitaIva', 'iban', 'codiceSdi'].includes(f.key) ? 'rub-codice' : '' },
        f.key === 'iban' ? c.iban.replace(/(.{4})/g, '$1 ').trim() : c[f.key],
        avv[f.key] ? h('span', { class: 'rub-avviso' }, avv[f.key]) : null));
    }
    if (!dl.children.length) dl.append(h('dt', {}, 'Dati'), h('dd', {}, 'nessuno'));
    metti(scheda, 
      h('header', { class: 'rub-scheda-testa' },
        h('span', { class: 'rub-avatar grande', 'aria-hidden': 'true' }, iniziali(c)),
        h('div', { class: 'rub-scheda-titoli' }, h('h3', {}, nomeContatto(c)),
          c.ruolo || ((c.nome || c.cognome) && c.ragioneSociale) ? h('div', { class: 'rub-sub' }, [c.ruolo, (c.nome || c.cognome) ? c.ragioneSociale : ''].filter(Boolean).join(' · ')) : null,
          (c.gruppi || []).length ? h('div', { class: 'rub-chips' }, c.gruppi.map((g) => h('button', { class: 'rub-chip rub-chip-filtro', title: `Mostra solo il gruppo «${g}»`, onclick: () => { filtro.value = g; filtra(); } }, g))) : null)),
      h('div', { class: 'rub-azioni' },
        h('button', { class: 'btn primary', onclick: () => modifica(c) }, 'Modifica…'),
        h('button', { class: 'btn', onclick: () => esportaDatiPersona(app, archivio, c) }, 'Esporta tutti i dati di questa persona…'),
        h('button', { class: 'btn danger-soft', onclick: () => elimina(c) }, 'Cancella questa persona e tutto ciò che la riguarda…')),
      avv.nome ? h('p', { class: 'rub-avviso' }, avv.nome) : null,
      dl,
      sezioneFirme(app, archivio, c.id),
      sezioneRegistro(app, archivio, c.id),
      h('p', { class: 'rub-nota' }, `Aggiunto il ${data(c.creato)}${c.modificato && c.modificato !== c.creato ? `, modificato il ${data(c.modificato)}` : ''}${c.origine && c.origine !== 'manuale' ? ` (${({ fattura: 'da una fattura elettronica', importazione: 'importato da file' })[c.origine] || c.origine})` : ''}.`));
  }

  // ------------------------------------------------------------------ azioni
  async function nuovo() {
    const g = filtro.value && filtro.value !== SENZA_GRUPPO ? [filtro.value] : [];
    const c = await modificaContatto(app, archivio, null, { valori: { gruppi: g } });
    if (c) { attivoId = c.id; cerca.value = ''; filtra({ mantieni: false }); const k = risultati.findIndex((x) => x.id === c.id); if (k >= 0) vaiA(k); }
    lista.focus({ preventScroll: true });
  }
  async function modifica(c) {
    const r = await modificaContatto(app, archivio, archivio.contatto(c.id) || c);
    if (r) { attivoId = r.id; filtra(); const k = risultati.findIndex((x) => x.id === r.id); if (k >= 0) vaiA(k); }
    (risultati.length ? lista : cerca).focus({ preventScroll: true });
  }
  async function elimina(c) {
    if (await cancellaPersona(app, archivio, c)) { selezionati.delete(c.id); filtra({ mantieni: false }); vaiA(Math.min(attivo, risultati.length - 1)); }
    (risultati.length ? lista : cerca).focus({ preventScroll: true });
  }
  function menu(c, x, y) {
    app.ui.contextMenu(x, y, [
      { label: 'Modifica…', run: () => modifica(c) },
      { label: modoSelezione && selezionati.has(c.id) ? 'Togli dalla selezione' : 'Seleziona', run: () => (modoSelezione ? cambiaSelezione(c.id) : impostaSelezione(true, c.id)) },
      { label: 'Esporta tutti i dati di questa persona…', run: () => esportaDatiPersona(app, archivio, c) },
      '-',
      { label: 'Cancella questa persona…', danger: true, run: () => elimina(c) },
    ]);
  }
  async function esporta() {
    const tot = archivio.contatti();
    if (!tot.length) return app.ui.toast('La rubrica è vuota: non c\'è niente da esportare.', { kind: 'info' });
    const filtrati = cerca.value.trim() || filtro.value;
    const bottoni = [{ value: null, label: 'Lascia perdere', left: true }];
    if (selezionati.size) bottoni.push({ value: 'sel', label: `I selezionati (${selezionati.size})` });
    if (filtrati && risultati.length !== tot.length) bottoni.push({ value: 'filtro', label: `Quelli mostrati (${risultati.length})` });
    bottoni.push({ value: 'tutti', label: `Tutti (${tot.length})`, primary: true });
    const scelta = bottoni.length > 2 ? await app.ui.choice({ title: 'Esporta contatti in CSV', message: 'Quali contatti vuoi esportare? Il file si apre con Excel e si può reimportare in Leggio.', buttons: bottoni }) : 'tutti';
    if (!scelta) return;
    const lista2 = scelta === 'sel' ? risultatiOrdinati([...selezionati]) : scelta === 'filtro' ? risultati : cercaContatti(tot, '');
    await esportaLista(lista2);
  }
  const risultatiOrdinati = (ids) => cercaContatti(archivio.contatti(), '').filter((c) => ids.includes(c.id));
  async function esportaLista(contatti) {
    try {
      const testo = esportaCsv(contatti);
      const r = await app.exportFile(new TextEncoder().encode(testo), `Rubrica ${new Date().toLocaleDateString('it-IT').replace(/\//g, '-')}.csv`, [{ name: 'CSV (Excel)', extensions: ['csv'] }]);
      if (r) app.ui.toast(`${contatti.length === 1 ? '1 contatto esportato' : `${contatti.length} contatti esportati`}. Attenzione: il file non è protetto da password.`, { kind: 'success', timeout: 7000 });
    } catch (err) { app.reportError(err, 'Esportazione non riuscita'); }
  }

  // ------------------------------------------------------------------ selezione multipla
  function impostaSelezione(on, id = null) {
    modoSelezione = on;
    if (!on) selezionati.clear(); else if (id) selezionati.add(id);
    btnSel.setAttribute('aria-pressed', String(on));
    btnSel.textContent = on ? 'Fine selezione' : 'Seleziona più contatti';
    lista.setAttribute('aria-multiselectable', String(on));
    for (const [k, el] of righeDom) aggiornaRiga(el, k);
    disegnaBarraSel(); scheda.dataset.id = ''; disegnaScheda();
    lista.focus({ preventScroll: true });
  }
  /** Aggiunge o toglie un contatto dalla selezione (id null: ridisegna soltanto). */
  function cambiaSelezione(id) {
    if (id != null) { if (selezionati.has(id)) selezionati.delete(id); else selezionati.add(id); }
    for (const [k, el] of righeDom) aggiornaRiga(el, k);
    disegnaBarraSel(); scheda.dataset.id = ''; disegnaScheda();
  }
  function disegnaBarraSel() {
    barraSel.hidden = !modoSelezione;
    if (!modoSelezione) return;
    const n = selezionati.size;
    metti(barraSel, 
      h('span', { class: 'rub-sel-n', 'aria-live': 'polite' }, n === 1 ? '1 selezionato' : `${n} selezionati`),
      h('button', { class: 'btn small', onclick: () => { risultati.forEach((c) => selezionati.add(c.id)); cambiaSelezione(null); } }, `Seleziona i ${risultati.length} mostrati`),
      h('button', { class: 'btn small', disabled: !n, onclick: () => gruppoSelezionati() }, 'Aggiungi a un gruppo…'),
      h('button', { class: 'btn small', disabled: n < 2, onclick: () => unisci(archivio.contatti().filter((c) => selezionati.has(c.id))) }, 'Unisci…'),
      h('button', { class: 'btn small', disabled: !n, onclick: () => esportaLista(risultatiOrdinati([...selezionati])) }, 'Esporta CSV…'),
      h('button', { class: 'btn small danger-soft', disabled: !n, onclick: () => eliminaSelezionati() }, 'Elimina…'),
      n ? h('button', { class: 'btn small ghost', onclick: () => { selezionati.clear(); cambiaSelezione(null); } }, 'Deseleziona') : null);
  }

  async function gruppoSelezionati() {
    let scelta = null;
    const r = await app.ui.dialog({
      title: `Aggiungi a un gruppo (${selezionati.size})`, width: 520, okLabel: 'Aggiungi',
      fields: [{ name: 'g', type: 'custom', label: 'Gruppi', render: (el) => { scelta = sceltaGruppi(app, { esistenti: archivio.gruppi().map((g) => g.nome) }); el.append(scelta.el); return { get: () => scelta.valore() }; } }],
      validate: (v) => (v.g.length ? null : 'Scegli o scrivi almeno un gruppo.'),
    });
    if (!r) return;
    const da = archivio.contatti().filter((c) => selezionati.has(c.id)).map((c) => ({ ...c, gruppi: [...new Set([...(c.gruppi || []), ...r.g])] }));
    archivio.salvaContatti(da);
    app.ui.toast(`${da.length === 1 ? '1 contatto aggiunto' : `${da.length} contatti aggiunti`} a ${r.g.map((g) => `«${g}»`).join(', ')}.`, { kind: 'success' });
  }
  async function eliminaSelezionati() {
    const ids = [...selezionati];
    if (ids.length === 1) { const c = archivio.contatto(ids[0]); if (c) await elimina(c); return; }
    const firme = ids.reduce((s, id) => s + archivio.firme({ proprietario: id }).length, 0);
    const voci = ids.reduce((s, id) => s + archivio.registro({ proprietario: id }).length, 0);
    const ok = await app.ui.choice({
      title: `Cancellare ${ids.length} contatti?`,
      body: h('div', { class: 'rub-conferma' }, h('p', {}, 'Verranno eliminati definitivamente dall\'archivio personale:'),
        h('ul', {}, h('li', {}, `${ids.length} contatti;`), h('li', {}, `${firme === 1 ? '1 firma o sigla' : `${firme} firme e sigle`} di queste persone;`), h('li', {}, `${voci === 1 ? '1 voce' : `${voci} voci`} del registro degli utilizzi.`)),
        h('p', { class: 'rub-nota' }, 'I file di backup esportati in passato non vengono toccati.')),
      buttons: [{ value: null, label: 'Lascia perdere' }, { value: 'si', label: `Cancella ${ids.length} contatti`, danger: true }],
    });
    if (ok !== 'si') return;
    try {
      await app.ui.withProgress('Cancellazione dei contatti', async (p) => {
        for (const [i, id] of ids.entries()) { p.set(i / ids.length, `${i + 1} di ${ids.length}`); await archivio.eliminaContatto(id, { registro: true }); }
      }, { cancellable: false });
      selezionati.clear();
      app.ui.toast(`${ids.length} contatti cancellati.`, { kind: 'success' });
    } catch (err) { app.reportError(err, 'Cancellazione non riuscita'); }
  }

  // ------------------------------------------------------------------ doppioni e unione
  async function finestraDoppioni() {
    aggiornaDoppi();
    const corpo = h('div', { class: 'rub-doppi' });
    const disegna = () => {
      aggiornaDoppi();
      if (!doppi.length) { metti(corpo, h('p', { class: 'rub-ok' }, 'Nessun doppione: ogni persona o ente compare una volta sola.')); return; }
      metti(corpo, 
        h('p', { class: 'rub-nota' }, `${doppi.length === 1 ? '1 gruppo di contatti sembra' : `${doppi.length} gruppi di contatti sembrano`} la stessa persona o lo stesso ente. Unendoli i dati si combinano e le firme passano al contatto che resta.`),
        h('ul', { class: 'rub-doppi-lista' }, doppi.slice(0, 200).map((g) => h('li', { class: 'rub-doppio' },
          h('div', { class: 'rub-doppio-testa' }, h('strong', {}, g.motivi.join(', ').replace(/^./, (x) => x.toUpperCase()))),
          h('ul', {}, g.contatti.map((c) => h('li', {}, h('span', { class: 'rub-riga-nome' }, nomeContatto(c)), ' ', h('small', {}, dettaglioContatto(c))))),
          h('div', { class: 'rub-riga-in' },
            h('button', { type: 'button', class: 'btn small primary', onclick: async () => { if (await unisci(g.contatti)) disegna(); } }, `Unisci ${g.contatti.length === 2 ? 'i due' : `i ${g.contatti.length}`}…`),
            h('button', { type: 'button', class: 'btn small', onclick: () => { app.settings.set(CHIAVE_NON_DOPPI, [...new Set([...(app.settings.get(CHIAVE_NON_DOPPI, []) || []), chiaveGruppo(g)])]); disegna(); aggiorna(); } }, 'Non sono doppioni'))))),
        doppi.length > 200 ? h('p', { class: 'rub-nota' }, `Sono mostrati i primi 200 gruppi su ${doppi.length}.`) : null);
    };
    disegna();
    await app.ui.dialog({ title: 'Doppioni nella rubrica', body: corpo, fields: [], width: 680, cancelLabel: null, okLabel: 'Chiudi' });
    lista.focus({ preventScroll: true });
  }

  /** Unione con la scelta dei valori in conflitto. → true se unito */
  async function unisci(contatti) {
    let u;
    try { u = calcolaUnione(contatti); } catch (err) { app.ui.toast(err.message, { kind: 'warning' }); return false; }
    const scelte = {};
    const nomeId = `rubu${Math.random().toString(36).slice(2, 7)}`;
    const firme = u.elimina.reduce((s, id) => s + archivio.firme({ proprietario: id }).length, 0);
    const corpo = h('div', { class: 'rub-unione' },
      h('p', {}, `I ${contatti.length} contatti diventeranno uno solo: i dati si combinano, i gruppi si sommano e le note si mettono insieme.${firme ? ` ${firme === 1 ? 'La firma' : `Le ${firme} firme`} degli altri contatti ${firme === 1 ? 'passa' : 'passano'} al contatto unito, con il registro degli utilizzi.` : ''}`),
      u.conflitti.length ? h('div', {}, h('h3', { class: 'rub-h3' }, 'Dati diversi: quale tenere?'),
        u.conflitti.map((cf, i) => h('fieldset', { class: 'rub-fieldset' }, h('legend', {}, cf.etichetta),
          cf.valori.map((v, j) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: `${nomeId}-${i}`, value: v.valore, checked: j === 0, onchange: () => { scelte[cf.campo] = v.valore; } }),
            h('span', {}, h('strong', {}, v.valore), h('small', { class: 'rub-nota' }, `  da ${v.nome}${j === 0 ? ' (modificato più di recente)' : ''}`)))))))
        : h('p', { class: 'rub-nota' }, 'Non ci sono dati in conflitto.'),
      h('div', { class: 'rub-anteprima-unione' }, h('h3', { class: 'rub-h3' }, 'Risultato'), h('p', {}, h('strong', {}, nomeContatto(u.risultato)), ' — ', dettaglioContatto(u.risultato) || ''),
        (u.risultato.gruppi || []).length ? h('p', { class: 'rub-nota' }, 'Gruppi: ' + u.risultato.gruppi.join(', ')) : null));
    const r = await app.ui.dialog({ title: `Unisci ${contatti.length} contatti`, body: corpo, fields: [], width: 620, okLabel: 'Unisci' });
    if (!r) return false;
    try {
      const fin = calcolaUnione(contatti.map((c) => archivio.contatto(c.id) || c), { scelte, tieni: u.tieni });
      const esito = await applicaUnione(archivio, fin);
      for (const id of esito.eliminati) selezionati.delete(id);
      attivoId = esito.contatto.id;
      app.ui.toast(`Contatti uniti in «${nomeContatto(esito.contatto)}»${esito.firmeSpostate ? `; ${esito.firmeSpostate === 1 ? '1 firma spostata' : `${esito.firmeSpostate} firme spostate`}` : ''}.`, { kind: 'success' });
      filtra();
      return true;
    } catch (err) { app.reportError(err, 'Unione non riuscita'); return false; }
  }

  // ------------------------------------------------------------------ avvio
  let tCambio = null;
  offs.push(archivio.on('cambiato', ({ sezione } = {}) => {
    if (!pane.el.isConnected) return;
    if (!archivio.aperto) { pane.close(); return; }
    if (sezione && !['contatti', 'firme', 'registro', '*'].includes(sezione)) return;
    clearTimeout(tCambio); tCambio = setTimeout(() => { scheda.dataset.id = ''; aggiorna(); }, 30);
  }));
  aggiorna();
  if (contattoId) { const k = risultati.findIndex((c) => c.id === contattoId); if (k >= 0) vaiA(k); }
  setTimeout(() => cerca.focus());
  return pane;
}

const chiaveGruppo = (g) => g.contatti.map((c) => c.id).sort().join('|');
