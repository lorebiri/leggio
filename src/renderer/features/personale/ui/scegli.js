// Scelta di un contatto della rubrica (o di «Io»): ricerca istantanea, filtro per gruppo, frecce + Invio.
// Usata per «Compila a nome di», per il proprietario delle firme e dalle altre aree.
import { nomeContatto } from '../lib/campi.js';
import { cercaContatti, normalizzaTesto, SENZA_GRUPPO } from '../lib/rubrica.js';
import { modificaContatto } from './contatto.js';

const MAX_RIGHE = 200;

/** Riga secondaria di un contatto: ente, codici, email, città. */
export function dettaglioContatto(c) {
  const p = [];
  if ((c.nome || c.cognome) && c.ragioneSociale) p.push(c.ragioneSociale);
  if (c.ruolo) p.push(c.ruolo);
  if (c.codiceFiscale) p.push('CF ' + c.codiceFiscale); else if (c.partitaIva) p.push('P.IVA ' + c.partitaIva);
  if (c.email || c.pec) p.push(c.email || c.pec);
  if (c.citta) p.push(c.citta + (c.provincia ? ` (${c.provincia})` : ''));
  return p.join(' · ');
}
/** Iniziali per l'avatar. */
export function iniziali(c) {
  const parole = (c.nome || c.cognome ? [c.nome, c.cognome] : String(c.ragioneSociale || c.email || c.pec || '?').split(/\s+/)).filter(Boolean);
  return (parole.slice(0, 2).map((w) => String(w)[0]).join('') || '?').toUpperCase();
}

/**
 * Finestra di scelta di un contatto.
 * → Promise<'io' | contatto | null> (null = lascia perdere, o archivio non aperto)
 */
export async function scegliContatto(app, archivio, { titolo = 'Scegli un contatto', messaggio = '', consentiIo = true, testoIo = 'Io (i miei dati personali)' } = {}) {
  if (!archivio) return null;
  try { if (!archivio.aperto && !(await archivio.apri())) return null; }
  catch (err) { app.reportError(err, 'Archivio personale non disponibile'); return null; }
  const { h } = app.ui;
  const uid = 'rubs' + Math.random().toString(36).slice(2, 8);
  let elenco = []; let attivo = 0; let scelto = null; let form = null;

  const cerca = h('input', { type: 'search', class: 'input rub-cerca', placeholder: 'Cerca per nome, codice fiscale, email, città…', 'aria-label': 'Cerca nella rubrica', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': uid + '-lista', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false' });
  const gruppi = archivio.gruppi();
  const filtro = h('select', { class: 'input rub-filtro', 'aria-label': 'Gruppo' },
    h('option', { value: '' }, 'Tutti i gruppi'), gruppi.map((g) => h('option', { value: g.nome }, `${g.nome} (${g.n})`)),
    gruppi.length ? h('option', { value: SENZA_GRUPPO }, 'Senza gruppo') : null);
  if (!gruppi.length) filtro.hidden = true;
  const lista = h('div', { id: uid + '-lista', class: 'rub-scegli-lista', role: 'listbox', 'aria-label': 'Contatti' });
  const stato = h('p', { class: 'rub-nota', 'aria-live': 'polite' });

  const ridisegna = () => {
    const q = cerca.value; const g = filtro.value;
    const trovati = cercaContatti(archivio.contatti(), q, { gruppo: g });
    const io = consentiIo && !g && (!q.trim() || normalizzaTesto(testoIo).includes(normalizzaTesto(q)));
    elenco = [...(io ? ['io'] : []), ...trovati.slice(0, MAX_RIGHE)];
    attivo = Math.min(attivo, Math.max(0, elenco.length - 1));
    lista.replaceChildren(...elenco.map((c, i) => {
      const sel = i === attivo;
      const riga = c === 'io'
        ? h('div', { class: 'rub-opzione rub-io', role: 'option', id: `${uid}-o${i}`, 'aria-selected': String(sel) }, h('span', { class: 'rub-avatar', 'aria-hidden': 'true' }, 'IO'), h('span', { class: 'rub-opz-testo' }, h('strong', {}, testoIo)))
        : h('div', { class: 'rub-opzione', role: 'option', id: `${uid}-o${i}`, 'aria-selected': String(sel) },
          h('span', { class: 'rub-avatar', 'aria-hidden': 'true' }, iniziali(c)),
          h('span', { class: 'rub-opz-testo' }, h('strong', {}, nomeContatto(c)), h('small', {}, dettaglioContatto(c))));
      riga.addEventListener('mousedown', (e) => e.preventDefault()); // il fuoco resta nella ricerca
      riga.addEventListener('click', () => { attivo = i; aggiornaAttivo(); });
      riga.addEventListener('dblclick', () => { attivo = i; form?.requestSubmit(); });
      return riga;
    }));
    const tot = archivio.contatti().length;
    stato.textContent = !tot ? 'La rubrica è vuota: puoi aggiungere un contatto nuovo.'
      : !trovati.length ? 'Nessun contatto trovato.'
        : trovati.length > MAX_RIGHE ? `${trovati.length} contatti: sono mostrati i primi ${MAX_RIGHE}, continua a scrivere per restringere.`
          : `${trovati.length} ${trovati.length === 1 ? 'contatto' : 'contatti'}${q || g ? ` su ${tot}` : ''}.`;
    aggiornaAttivo();
  };
  const aggiornaAttivo = () => {
    [...lista.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === attivo)));
    const el = lista.children[attivo];
    if (el) { cerca.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); } else cerca.removeAttribute('aria-activedescendant');
  };
  cerca.addEventListener('input', () => { attivo = 0; ridisegna(); });
  filtro.addEventListener('change', () => { attivo = 0; ridisegna(); cerca.focus(); });
  cerca.addEventListener('keydown', (e) => {
    const n = elenco.length; if (!n) return;
    const passo = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
    if (passo) { e.preventDefault(); attivo = Math.max(0, Math.min(n - 1, attivo + passo)); aggiornaAttivo(); }
  });
  const nuovo = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const c = await modificaContatto(app, archivio, null, { valori: /\S/.test(cerca.value) && !/[@\d]/.test(cerca.value) ? (() => { const [n1, ...rest] = cerca.value.trim().split(/\s+/); return { nome: n1, cognome: rest.join(' ') }; })() : {} });
    if (c) { scelto = c; form?.requestSubmit(); } else cerca.focus();
  } }, 'Nuovo contatto…');

  const corpo = h('div', { class: 'rub-scegli' },
    messaggio ? h('p', { class: 'dlg-msg' }, messaggio) : null,
    h('div', { class: 'rub-riga-in' }, cerca, filtro), lista, h('div', { class: 'rub-riga-in rub-tra' }, stato, nuovo));
  ridisegna();
  const r = await app.ui.dialog({
    title: titolo, body: corpo, fields: [], width: 560, okLabel: 'Scegli',
    onOpen: (f) => { form = f; setTimeout(() => cerca.focus()); },
    validate: () => { if (scelto) return null; if (!elenco[attivo]) return 'Scegli un contatto dall\'elenco.'; scelto = elenco[attivo]; return null; },
  });
  if (!r) return null;
  if (scelto === 'io') return 'io';
  return scelto ? (archivio.contatto(scelto.id) || scelto) : null;
}
