// Importazione di contatti da CSV, Excel (.xlsx) o vCard: corrispondenza delle colonne, anteprima, gruppo,
// gestione dei doppioni (salta / aggiorna i campi vuoti / aggiungi comunque) e riepilogo finale.
import { nomeContatto, CAMPI_CONTATTO } from '../lib/campi.js';
import { avvisiContatto } from '../lib/validatori.js';
import { tabellaDaFile } from '../lib/tabelle.js';
import { DESTINAZIONI, mappaColonne, righeAContatti, pianificaImport, preparaContatto, leggiVcard, cercaDoppione, chiaviForti } from '../lib/rubrica.js';

/** replaceChildren senza i valori vuoti (null/false diventerebbero testo «null»). */
const metti = (el, ...n) => el.replaceChildren(...n.flat().filter((x) => x != null && x !== false));
const FILTRI = [{ name: 'Rubrica (CSV, Excel, vCard)', extensions: ['csv', 'txt', 'xlsx', 'xlsm', 'vcf', 'vcard', 'xls', 'ods'] }];
const etichetta = (k) => CAMPI_CONTATTO.find((c) => c.key === k)?.label || (k === 'gruppi' ? 'Gruppi' : k);
const ANTEPRIMA = 5;

function eVcard({ name = '', bytes }) {
  if (/\.(vcf|vcard)$/i.test(name)) return true;
  const testa = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  return /^\s*(﻿|ï»¿)?BEGIN:VCARD/i.test(testa);
}

/**
 * Importa contatti da un file (se non indicato lo chiede). → { aggiunti, aggiornati, saltati, invariati, avvisi } | null
 */
export async function importaContatti(app, archivio, { file = null } = {}) {
  try {
    if (!file) {
      const scelti = await app.platform.openFiles({ raw: true, multiple: false, title: 'Scegli il file con i contatti', filters: FILTRI });
      file = scelti?.[0];
      if (!file) return null;
    }
    if (!file.bytes?.length) throw new Error('Il file è vuoto.');
    let voci; let tabella = null;
    if (eVcard(file)) {
      const r = leggiVcard(file.bytes);
      if (!r.contatti.length) throw new Error('Il file vCard non contiene contatti con un nome, un\'email o un telefono.');
      voci = r.contatti.map((c, i) => { const contatto = preparaContatto(c); return { riga: i + 1, contatto, avvisi: avvisiContatto(contatto) }; });
    } else {
      tabella = await tabellaDaFile(file);
      if (!tabella.righe.length) throw new Error('Il file non contiene righe di dati (serve una prima riga con i nomi delle colonne e almeno una riga sotto).');
    }
    const scelte = await finestraImport(app, archivio, file, { voci, tabella });
    if (!scelte) return null;
    const piano = pianificaImport(scelte.voci, archivio.contatti(), { duplicati: scelte.duplicati });
    if (piano.daSalvare.length) archivio.salvaContatti(piano.daSalvare.map((c) => (c.id ? c : { ...c, origine: 'importazione' })));
    await riepilogo(app, piano, file.name);
    return piano;
  } catch (err) {
    app.ui.dialog({ title: 'Importazione non riuscita', message: err?.message || String(err), cancelLabel: null, okLabel: 'Chiudi' });
    return null;
  }
}

/** Finestra unica: colonne → campi (solo per le tabelle), anteprima, gruppo, doppioni. → { voci, duplicati } | null */
async function finestraImport(app, archivio, file, { voci: vociVcard, tabella: tabIniziale }) {
  const { h } = app.ui;
  const uid = 'rubi' + Math.random().toString(36).slice(2, 8);
  let tabella = tabIniziale; let mappa = tabella ? mappaColonne(tabella.intestazioni) : null;
  let voci = []; let okBtn = null;

  const zonaColonne = h('div', { class: 'rub-imp-colonne' });
  const zonaAnteprima = h('div', { class: 'rub-imp-anteprima' });
  const datalist = h('datalist', { id: uid + '-gr' }, archivio.gruppi().map((g) => h('option', { value: g.nome })));
  const gruppo = h('input', { type: 'text', class: 'input', id: uid + '-gruppo', list: uid + '-gr', placeholder: 'es. fornitori 2026 (facoltativo)', maxlength: 60, autocomplete: 'off' });
  const dupInfo = h('p', { class: 'rub-nota', 'aria-live': 'polite' });
  const dupScelta = h('div', { class: 'radio-group rub-imp-dup', role: 'radiogroup', 'aria-label': 'Contatti già in rubrica' },
    [['aggiorna', 'Aggiorna i campi vuoti del contatto che c\'è già'], ['salta', 'Salta (lascia com\'è)'], ['aggiungi', 'Aggiungi comunque (crea un doppione)']]
      .map(([v, l], i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: uid + '-dup', value: v, checked: i === 0 }), h('span', {}, l))));
  const zonaDup = h('fieldset', { class: 'rub-fieldset' }, h('legend', {}, 'Contatti già in rubrica'), dupInfo, dupScelta);

  const calcola = () => {
    voci = tabella ? righeAContatti(tabella.righe, mappa, { gruppo: gruppo.value }) : vociVcard.map((v) => ({ ...v, contatto: preparaContatto({ ...v.contatto, gruppi: [...(v.contatto.gruppi || [])] }, { gruppo: gruppo.value }) }));
    // doppioni con la rubrica (per il messaggio)
    const indice = new Map();
    for (const c of archivio.contatti()) for (const { k } of chiaviForti(c)) if (!indice.has(k)) indice.set(k, c);
    const doppi = voci.filter((v) => cercaDoppione(v.contatto, indice)).length;
    dupInfo.textContent = doppi ? `${doppi === 1 ? '1 riga corrisponde' : `${doppi} righe corrispondono`} a contatti già in rubrica (stessa partita IVA, codice fiscale, email o PEC).` : 'Nessuna riga corrisponde a contatti già in rubrica (stessa partita IVA, codice fiscale, email o PEC).';
    dupScelta.hidden = !doppi;
    if (okBtn) { okBtn.textContent = voci.length ? `Importa ${voci.length === 1 ? '1 contatto' : `${voci.length} contatti`}` : 'Importa'; okBtn.disabled = !voci.length; }
    disegnaAnteprima();
  };

  const disegnaColonne = () => {
    if (!tabella) { metti(zonaColonne); return; }
    const opzioni = [{ key: '', label: 'Non importare' }, ...DESTINAZIONI];
    const esempi = (col) => tabella.righe.map((r) => r[col]).filter(Boolean).slice(0, 3);
    metti(zonaColonne, 
      h('h3', { class: 'rub-h3' }, 'Colonne del file'),
      h('p', { class: 'rub-nota' }, 'Per ogni colonna scegli in quale dato del contatto metterla. Più colonne possono andare in «Indirizzo», «Telefono», «Note» e «Gruppi»: i valori vengono uniti.'),
      h('div', { class: 'rub-tabella-wrap rub-imp-scorri' }, h('table', { class: 'rub-tabella' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Colonna'), h('th', { scope: 'col' }, 'Esempi'), h('th', { scope: 'col' }, 'Importa in'))),
        h('tbody', {}, tabella.intestazioni.map((col, i) => {
          const idSel = `${uid}-c${i}`;
          const sel = h('select', { class: 'input rub-imp-sel', id: idSel, 'aria-label': `Dove importare la colonna «${col}»` },
            opzioni.map((o) => h('option', { value: o.key, selected: (mappa[col] || '') === o.key }, o.label)));
          sel.addEventListener('change', () => { mappa = { ...mappa, [col]: sel.value }; sel.closest('tr').classList.toggle('rub-spenta', !sel.value); calcola(); });
          return h('tr', { class: mappa[col] ? '' : 'rub-spenta' }, h('th', { scope: 'row' }, h('label', { for: idSel }, col)), h('td', { class: 'rub-esempi' }, esempi(col).join(' · ') || '—'), h('td', {}, sel));
        })))));
  };

  const disegnaAnteprima = () => {
    const prime = voci.slice(0, ANTEPRIMA);
    const colonne = [['Nome', (c) => nomeContatto(c)], ['CF / P.IVA', (c) => c.codiceFiscale || c.partitaIva || ''], ['Email / PEC', (c) => [c.email, c.pec].filter(Boolean).join(' · ')], ['Telefono', (c) => c.telefono || ''], ['Città', (c) => c.citta || ''], ['Gruppi', (c) => (c.gruppi || []).join(', ')]];
    const nAvvisi = voci.filter((v) => Object.keys(v.avvisi).length).length;
    metti(zonaAnteprima, 
      h('h3', { class: 'rub-h3' }, `Anteprima${voci.length > ANTEPRIMA ? ` (prime ${ANTEPRIMA} righe su ${voci.length})` : ''}`),
      voci.length ? h('div', { class: 'rub-tabella-wrap' }, h('table', { class: 'rub-tabella' },
        h('thead', {}, h('tr', {}, colonne.map(([t]) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col' }, 'Da controllare'))),
        h('tbody', {}, prime.map((v) => h('tr', {}, colonne.map(([, fn]) => h('td', { class: 'rub-spezza' }, fn(v.contatto))),
          h('td', { class: 'rub-avviso-cella' }, Object.entries(v.avvisi).map(([k, a]) => `${etichetta(k)}: ${a}`).join(' ')))))))
        : h('p', { class: 'rub-avviso' }, 'Con queste scelte nessuna riga ha dati da importare: scegli almeno una colonna.'),
      nAvvisi ? h('p', { class: 'rub-nota' }, `${nAvvisi === 1 ? '1 contatto ha' : `${nAvvisi} contatti hanno`} dati da controllare (es. codice fiscale o IBAN non validi): verranno importati comunque e li vedrai segnalati nella rubrica.`) : null);
  };

  let foglioSel = null;
  if (tabella?.fogli?.length > 1) {
    foglioSel = h('select', { class: 'input', id: uid + '-foglio' }, tabella.fogli.map((f) => h('option', { value: f, selected: f === tabella.foglio }, f)));
    foglioSel.addEventListener('change', async () => {
      try { tabella = await tabellaDaFile(file, { foglio: foglioSel.value }); mappa = mappaColonne(tabella.intestazioni); disegnaColonne(); calcola(); }
      catch (err) { app.ui.toast(err.message, { kind: 'error' }); }
    });
  }
  gruppo.addEventListener('input', () => { clearTimeout(gruppo._t); gruppo._t = setTimeout(calcola, 200); });

  const righe = tabella ? tabella.righe.length : vociVcard.length;
  const corpo = h('div', { class: 'rub-importa' },
    h('p', { class: 'rub-file' }, h('strong', {}, file.name || 'File'), ` — ${righe === 1 ? '1 riga' : `${righe} righe`}${tabella ? '' : ' (vCard)'}`),
    foglioSel ? h('div', { class: 'rub-campo' }, h('label', { for: uid + '-foglio' }, 'Foglio di lavoro'), foglioSel) : null,
    zonaColonne, zonaAnteprima,
    h('div', { class: 'rub-campo' }, h('label', { for: uid + '-gruppo' }, 'Aggiungi tutti gli importati al gruppo'), gruppo, datalist),
    zonaDup);
  disegnaColonne();
  calcola();
  const r = await app.ui.dialog({
    title: 'Importa contatti', body: corpo, fields: [], width: 900, okLabel: 'Importa',
    onOpen: (form) => { okBtn = form.querySelector('.dlg-foot .btn.primary'); calcola(); setTimeout(() => (zonaColonne.querySelector('select') || gruppo).focus()); },
    validate: () => (voci.length ? null : 'Scegli almeno una colonna da importare.'),
  });
  if (!r) return null;
  calcola();
  return { voci, duplicati: dupScelta.hidden ? 'aggiungi' : (dupScelta.querySelector('input:checked')?.value || 'aggiorna') };
}

async function riepilogo(app, piano, nomeFile) {
  const { h } = app.ui;
  const riga = (n, una, tante) => (n ? h('li', {}, n === 1 ? una : tante.replace('#', n)) : null);
  const avvisi = piano.avvisi.slice(0, 30);
  const corpo = h('div', { class: 'rub-riepilogo' },
    h('ul', { class: 'rub-conteggi' },
      riga(piano.aggiunti, '1 contatto aggiunto', '# contatti aggiunti'),
      riga(piano.aggiornati, '1 contatto già presente aggiornato (campi vuoti completati)', '# contatti già presenti aggiornati (campi vuoti completati)'),
      riga(piano.invariati, '1 contatto già presente e senza dati nuovi', '# contatti già presenti e senza dati nuovi'),
      riga(piano.saltati, '1 riga saltata perché il contatto era già in rubrica', '# righe saltate perché il contatto era già in rubrica'),
      !piano.aggiunti && !piano.aggiornati ? h('li', {}, 'Nessun contatto nuovo.') : null),
    avvisi.length ? h('div', {},
      h('h3', { class: 'rub-h3' }, `Dati da controllare (${piano.avvisi.length})`),
      h('ul', { class: 'rub-avvisi-lista' }, avvisi.map((a) => h('li', {}, h('strong', {}, `${a.riga ? `Riga ${a.riga} · ` : ''}${a.nome}: `), Object.entries(a.avvisi).map(([k, t]) => `${etichetta(k)}: ${t}`).join(' ')))),
      piano.avvisi.length > avvisi.length ? h('p', { class: 'rub-nota' }, `…e altri ${piano.avvisi.length - avvisi.length}. Nella rubrica i dati da controllare sono segnalati sulla scheda di ogni contatto.`) : null) : null);
  await app.ui.dialog({ title: `Importazione da «${nomeFile || 'file'}» completata`, body: corpo, fields: [], cancelLabel: null, okLabel: 'Chiudi', width: 620 });
}
