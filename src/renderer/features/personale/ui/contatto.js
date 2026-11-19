// Scheda di modifica di un contatto della rubrica, firme e registro di una persona, diritti GDPR
// (esporta tutti i dati, cancella la persona e tutto ciò che la riguarda).
import { CAMPI_CONTATTO, nomeContatto } from '../lib/campi.js';
import { avvisiContatto, normalizzaCodici, validaCodiceFiscale, dataNascitaDaCf } from '../lib/validatori.js';

const etichetta = (k) => CAMPI_CONTATTO.find((c) => c.key === k)?.label || k;
// disposizione del modulo: [chiave, larghezza in colonne su 6]
const DISPOSIZIONE = [
  ['nome', 3], ['cognome', 3], ['ragioneSociale', 6],
  ['codiceFiscale', 3], ['partitaIva', 3],
  ['dataNascita', 3], ['luogoNascita', 3],
  ['email', 3], ['pec', 3], ['telefono', 3], ['ruolo', 3],
  ['indirizzo', 6], ['cap', 1], ['citta', 3], ['provincia', 1], ['nazione', 1],
  ['iban', 4], ['codiceSdi', 2],
  ['note', 6],
];
const SUGGERIMENTI = { codiceFiscale: 'RSSMRA85T10A562S', partitaIva: '11 cifre', email: 'nome@esempio.it', pec: 'nome@pec.it', dataNascita: 'gg/mm/aaaa', cap: '00000', provincia: 'PO', iban: 'IT60 X054 …', codiceSdi: '7 caratteri' };
const MAIUSCOLI = new Set(['codiceFiscale', 'partitaIva', 'iban', 'codiceSdi', 'provincia']);

export const dataOra = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
export const data = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const nomeFile = (s) => String(s || 'contatto').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'contatto';

/** Gruppi come pulsanti a interruttore (quelli esistenti) più una casella per aggiungerne di nuovi. */
export function sceltaGruppi(app, { esistenti = [], scelti = [], etichettaId = '' } = {}) {
  const { h } = app.ui;
  const attivi = new Set(scelti);
  const tutti = [...new Set([...esistenti, ...scelti])].sort((a, b) => a.localeCompare(b, 'it'));
  const chips = h('div', { class: 'rub-chips', role: 'group', 'aria-labelledby': etichettaId || null });
  const disegna = () => {
    chips.replaceChildren(...tutti.map((g) => h('button', {
      type: 'button', class: 'rub-chip-btn', 'aria-pressed': String(attivi.has(g)),
      onclick: () => { if (attivi.has(g)) attivi.delete(g); else attivi.add(g); disegna(); chips.querySelector(`[data-g="${CSS.escape(g)}"]`)?.focus(); },
      'data-g': g,
    }, attivi.has(g) ? '✓ ' : '', g)));
    if (!tutti.length) chips.append(h('span', { class: 'rub-nota' }, 'Nessun gruppo ancora: scrivine uno qui sotto.'));
  };
  const nuovo = h('input', { type: 'text', class: 'input rub-nuovo-gruppo', placeholder: 'Nuovo gruppo (es. fornitori) e Invio', 'aria-label': 'Nuovo gruppo', maxlength: 60 });
  const aggiungi = () => {
    for (const g of nuovo.value.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) { if (!tutti.includes(g)) tutti.push(g); attivi.add(g); }
    tutti.sort((a, b) => a.localeCompare(b, 'it'));
    nuovo.value = ''; disegna();
  };
  nuovo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aggiungi(); } });
  const btn = h('button', { type: 'button', class: 'btn small', onclick: aggiungi }, 'Aggiungi');
  disegna();
  return {
    el: h('div', { class: 'rub-gruppi' }, chips, h('div', { class: 'rub-riga-in' }, nuovo, btn)),
    valore: () => { if (nuovo.value.trim()) aggiungi(); return [...attivi]; },
  };
}

/** Elenco delle firme e sigle di una persona, con le miniature. */
export function sezioneFirme(app, archivio, id) {
  const { h } = app.ui;
  const firme = archivio.firme({ proprietario: id });
  const box = h('section', { class: 'rub-sezione', 'aria-label': 'Firme di questa persona' }, h('h3', {}, `Firme e sigle (${firme.length})`));
  if (!firme.length) { box.append(h('p', { class: 'rub-nota' }, 'Nessuna firma archiviata per questa persona. Le firme di altre persone si aggiungono da «Compila e firma».')); return box; }
  const griglia = h('ul', { class: 'rub-firme' });
  for (const f of firme) {
    const img = h('img', { alt: `${f.tipo === 'sigla' ? 'Sigla' : 'Firma'}: ${f.nome}`, loading: 'lazy' });
    archivio.immagine(f.blob).then((u) => { img.src = u; }).catch(() => { img.replaceWith(h('span', { class: 'rub-nota' }, 'immagine non disponibile')); });
    griglia.append(h('li', { class: 'rub-firma' }, h('div', { class: 'rub-firma-img' }, img),
      h('div', { class: 'rub-firma-nome' }, f.nome), h('div', { class: 'rub-nota' }, `${f.tipo === 'sigla' ? 'Sigla' : 'Firma'} · usata il ${data(f.usata || f.creata)}`)));
  }
  box.append(griglia);
  return box;
}

/** Registro degli utilizzi delle firme di una persona (le ultime 100 voci). */
export function sezioneRegistro(app, archivio, id) {
  const { h } = app.ui;
  const voci = archivio.registro({ proprietario: id });
  const box = h('section', { class: 'rub-sezione', 'aria-label': 'Registro degli utilizzi' }, h('h3', {}, `Registro degli utilizzi (${voci.length})`));
  if (!voci.length) { box.append(h('p', { class: 'rub-nota' }, 'Le firme di questa persona non sono ancora state usate.')); return box; }
  box.append(h('div', { class: 'rub-tabella-wrap' }, h('table', { class: 'rub-tabella' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Quando'), h('th', { scope: 'col' }, 'Firma'), h('th', { scope: 'col' }, 'Documento'), h('th', { scope: 'col' }, 'Pagine'))),
    h('tbody', {}, voci.slice(0, 100).map((r) => h('tr', {}, h('td', {}, dataOra(r.quando)), h('td', {}, r.firmaNome || ''), h('td', { class: 'rub-spezza' }, r.documento || ''), h('td', {}, r.pagine || '')))))));
  if (voci.length > 100) box.append(h('p', { class: 'rub-nota' }, `Sono mostrate le 100 voci più recenti su ${voci.length}. L'elenco completo è in «Esporta tutti i dati di questa persona».`));
  return box;
}

/** GDPR, diritto di accesso: tutti i dati della persona in un file JSON. */
export async function esportaDatiPersona(app, archivio, contatto) {
  try {
    const d = await archivio.datiPersona(contatto.id);
    if (!d) return app.ui.toast('Il contatto non è più in rubrica.', { kind: 'warning' });
    const bytes = new TextEncoder().encode(JSON.stringify(d, null, 2));
    const r = await app.exportFile(bytes, `Dati di ${nomeFile(nomeContatto(contatto))}.json`, [{ name: 'Dati in formato JSON', extensions: ['json'] }]);
    if (r) app.ui.toast('Dati della persona esportati: contatto, firme (con le immagini) e registro degli utilizzi.', { kind: 'success', timeout: 6000 });
  } catch (err) { app.reportError(err, 'Esportazione dei dati non riuscita'); }
}

/** GDPR, diritto alla cancellazione. → true se cancellata */
export async function cancellaPersona(app, archivio, contatto) {
  const { h } = app.ui;
  const firme = archivio.firme({ proprietario: contatto.id }).length;
  const voci = archivio.registro({ proprietario: contatto.id }).length;
  const nome = nomeContatto(contatto);
  const scelta = await app.ui.choice({
    title: 'Cancellare questa persona?',
    body: h('div', { class: 'rub-conferma' },
      h('p', {}, `Verranno eliminati definitivamente dall'archivio personale:`),
      h('ul', {}, h('li', {}, `il contatto «${nome}»;`),
        h('li', {}, firme === 1 ? '1 firma o sigla di questa persona;' : `${firme} firme e sigle di questa persona;`),
        h('li', {}, voci === 1 ? '1 voce del registro degli utilizzi.' : `${voci} voci del registro degli utilizzi.`)),
      h('p', { class: 'rub-nota' }, 'Anche la copia di sicurezza automatica viene aggiornata. I file di backup che hai esportato in passato non vengono toccati: se contengono questa persona, eliminali a mano.')),
    buttons: [{ value: null, label: 'Lascia perdere' }, { value: 'si', label: 'Cancella definitivamente', danger: true }],
  });
  if (scelta !== 'si') return false;
  try {
    const r = await archivio.eliminaContatto(contatto.id, { registro: true });
    if (r) app.ui.toast(`«${r.contatto}» cancellato${r.firme ? `, con ${r.firme === 1 ? '1 firma' : `${r.firme} firme`}` : ''}${r.registro ? ` e ${r.registro === 1 ? '1 voce' : `${r.registro} voci`} di registro` : ''}.`, { kind: 'success', timeout: 6000 });
    return !!r;
  } catch (err) { app.reportError(err, 'Cancellazione non riuscita'); return false; }
}

/**
 * Modulo di modifica (o creazione, con contatto null) di un contatto. Gli avvisi di validazione non bloccano.
 * opzioni: { titolo, valori (precompilati per un contatto nuovo) } → Promise<contatto salvato | null>
 */
export async function modificaContatto(app, archivio, contatto = null, { titolo = '', valori = {} } = {}) {
  const { h } = app.ui;
  const base = contatto ? { ...contatto } : { ...valori };
  const inputs = {}; const avvisi = {};
  const uid = 'rubc' + Math.random().toString(36).slice(2, 8);
  const griglia = h('div', { class: 'rub-modulo' });
  let btnCf = null;
  for (const [k, span] of DISPOSIZIONE) {
    const id = `${uid}-${k}`; const idAvv = `${id}-avv`;
    const attrs = { id, class: 'input', 'aria-describedby': idAvv, placeholder: SUGGERIMENTI[k] || '', autocomplete: 'off', spellcheck: k === 'note' ? 'true' : 'false' };
    if (k === 'email' || k === 'pec') attrs.inputmode = 'email';
    if (k === 'telefono') attrs.inputmode = 'tel';
    if (k === 'cap') attrs.inputmode = 'numeric';
    const inp = k === 'note' ? h('textarea', { ...attrs, rows: 3 }) : h('input', { ...attrs, type: 'text' });
    inp.value = base[k] || '';
    if (MAIUSCOLI.has(k)) inp.classList.add('rub-codice');
    inputs[k] = inp;
    avvisi[k] = h('div', { id: idAvv, class: 'rub-avviso', 'aria-live': 'polite' });
    const etich = h('label', { for: id }, etichetta(k));
    let campo = inp;
    if (k === 'dataNascita') {
      btnCf = h('button', { type: 'button', class: 'btn small', title: 'Ricava la data di nascita dal codice fiscale', onclick: () => { const d = dataNascitaDaCf(inputs.codiceFiscale.value); if (d) { inp.value = d; controlla(); inp.focus(); } } }, 'dal codice fiscale');
      campo = h('div', { class: 'rub-riga-in' }, inp, btnCf);
    }
    griglia.append(h('div', { class: `rub-campo rub-span-${span}` }, etich, campo, avvisi[k]));
  }
  const idGr = `${uid}-gruppi`;
  const gruppi = sceltaGruppi(app, { esistenti: archivio.gruppi().map((g) => g.nome), scelti: base.gruppi || [], etichettaId: idGr });
  griglia.append(h('div', { class: 'rub-campo rub-span-6' }, h('span', { id: idGr, class: 'rub-etichetta' }, 'Gruppi'), gruppi.el));

  const valoriAttuali = () => { const o = {}; for (const [k, inp] of Object.entries(inputs)) o[k] = inp.value.trim(); return o; };
  function controlla() {
    const v = valoriAttuali();
    const a = avvisiContatto(v);
    for (const k of Object.keys(inputs)) {
      const t = a[k] || '';
      if (avvisi[k].textContent !== t) avvisi[k].textContent = t;
      inputs[k].toggleAttribute('aria-invalid', !!t);
      inputs[k].classList.toggle('rub-da-controllare', !!t);
    }
    const cf = validaCodiceFiscale(v.codiceFiscale);
    btnCf.disabled = !(cf.valido && !cf.vuoto && cf.tipo !== 'numerico');
    if (cf.valido && !cf.vuoto && cf.tipo !== 'numerico' && v.dataNascita && dataNascitaDaCf(v.codiceFiscale) !== v.dataNascita && !a.dataNascita) {
      avvisi.dataNascita.textContent = `Il codice fiscale indica il ${dataNascitaDaCf(v.codiceFiscale)}.`;
    }
  }
  let t = null;
  griglia.addEventListener('input', () => { clearTimeout(t); t = setTimeout(controlla, 250); });
  griglia.addEventListener('focusout', () => { clearTimeout(t); controlla(); });

  const extra = [];
  if (contatto?.id) {
    extra.push(sezioneFirme(app, archivio, contatto.id), sezioneRegistro(app, archivio, contatto.id));
  }
  const corpo = h('div', { class: 'rub-modifica' }, griglia, ...extra);
  // gli avvisi già presenti si vedono subito (contatti importati), quelli nuovi mentre si scrive
  if (contatto || base.codiceFiscale) setTimeout(controlla); else btnCf.disabled = true;

  const r = await app.ui.dialog({
    title: titolo || (contatto ? `Modifica «${nomeContatto(contatto)}»` : 'Nuovo contatto'),
    body: corpo, fields: [], width: 760, okLabel: 'Salva',
    validate: () => {
      const v = valoriAttuali();
      if (!Object.values(v).some(Boolean)) return 'Scrivi almeno un dato (per esempio il nome).';
      return null;
    },
  });
  if (!r) return null;
  const v = normalizzaCodici(valoriAttuali());
  const salvato = archivio.salvaContatto({ ...(contatto || {}), ...v, gruppi: gruppi.valore(), ...(contatto ? {} : { origine: base.origine || 'manuale' }) });
  const n = Object.keys(avvisiContatto(salvato)).length;
  app.ui.toast(n ? `Contatto salvato. ${n === 1 ? 'C\'è un dato' : `Ci sono ${n} dati`} da controllare.` : 'Contatto salvato.', { kind: n ? 'warning' : 'success' });
  return salvato;
}
