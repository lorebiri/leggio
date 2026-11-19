// «Archivio personale»: protezione (password facoltativa), backup esportato e importato, cosa c'è
// archiviato, registro delle firme di altre persone, gestione di firme, sigle e timbri.
import '../archivio.css';
import { openPane } from '../../avanzati/pane.js';
import { csvDaTabella } from '../lib/tabelle.js';
import { nomeContatto } from '../lib/campi.js';

/** Chiede la password dell'archivio. → password | null */
export async function chiediPassword(app, { errore = '' } = {}) {
  const v = await app.ui.dialog({
    title: 'Archivio personale protetto',
    message: 'Firme, timbri e rubrica sono protetti da una password. Inseriscila per continuare.',
    fields: [
      ...(errore ? [{ name: 'info', type: 'info', text: errore }] : []),
      { name: 'password', label: 'Password', type: 'password', required: true },
    ],
    okLabel: 'Apri',
  });
  return v ? v.password : null;
}

const dataOra = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const data = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('it-IT'); };

export function registerImpostazioni(app, ctx) {
  const apriSezione = (sezione) => apriArchivioPersonale(app, ctx, sezione);
  app.registerTool({
    id: 'personal-archive', name: 'Archivio personale', category: 'moduli', icon: 'shield', needsDoc: false,
    description: 'Firme, sigle, timbri, rubrica e modelli cifrati su questo computer: password, backup, cosa c\'è archiviato, registro delle firme',
    keywords: 'archivio personale cifrato password backup esporta importa sicurezza gdpr privacy registro firme cosa c\'è',
    run: () => apriSezione('protezione'),
  });
  app.registerTool({
    id: 'signatures-library', name: 'Firme e sigle salvate', category: 'moduli', icon: 'signature', needsDoc: false,
    description: 'Le tue firme e sigle e quelle di altre persone: rinomina, cambia proprietario, elimina',
    keywords: 'firme salvate sigle iniziali gestisci elimina rinomina proprietario archivio',
    run: () => apriSezione('firme'),
  });
  app.registerTool({
    id: 'stamps-library', name: 'Timbri salvati', category: 'moduli', icon: 'stamp', needsDoc: false,
    description: 'Il timbro dell\'ente e gli altri timbri salvati',
    keywords: 'timbro timbri ente gestisci elimina',
    run: () => apriSezione('timbri'),
  });
  app.registerTool({
    id: 'signatures-log', name: 'Registro delle firme', category: 'moduli', icon: 'checklist', needsDoc: false,
    description: 'Quando e su quali documenti hai usato firme e sigle di altre persone; esportabile',
    keywords: 'registro firme altre persone utilizzi log storico esporta',
    run: () => apriSezione('registro'),
  });
}

/** Apre lo spazio «Archivio personale» sulla sezione indicata. */
export async function apriArchivioPersonale(app, ctx, sezione = 'protezione') {
  const { archivio } = ctx;
  if (!(await ctx.apri())) return;
  const { h } = app.ui;
  const pane = openPane(app, { title: 'Archivio personale', subtitle: 'Cifrato, solo su questo computer', id: 'personale' });
  pane.el.classList.add('pers-pane');
  const SEZ = [['protezione', 'Protezione e backup'], ['contenuto', 'Cosa c\'è archiviato'], ['firme', 'Firme e sigle'], ['timbri', 'Timbri'], ['registro', 'Registro delle firme']];
  const nav = h('nav', { class: 'pers-nav', 'aria-label': 'Sezioni' });
  const main = h('div', { class: 'pers-main', tabindex: '-1' });
  pane.body.append(h('div', { class: 'pers-layout' }, nav, main));
  let attuale = sezione;
  const off = archivio.on('cambiato', () => { if (main.isConnected && !main.contains(document.activeElement)) mostra(attuale, false); });
  const chiudi = pane.close; pane.close = (s) => { off(); chiudi(s); };
  function mostra(s, fuoco = true) {
    attuale = s;
    nav.textContent = '';
    for (const [k, l] of SEZ) nav.append(h('button', { type: 'button', class: 'pers-nav-btn' + (k === s ? ' on' : ''), 'aria-current': k === s ? 'page' : null, onclick: () => mostra(k) }, l));
    main.textContent = '';
    const r = { protezione: sezProtezione, contenuto: sezContenuto, firme: sezFirme, timbri: sezTimbri, registro: sezRegistro }[s];
    Promise.resolve(r(app, ctx, main, mostra, () => pane.close())).catch((err) => app.reportError(err, 'Archivio personale'));
    if (fuoco) main.focus();
  }
  mostra(sezione);
  return pane;
}

// ----------------------------------------------------------------------------------------- protezione
async function sezProtezione(app, ctx, el, mostra, chiudiPane) {
  const { h } = app.ui; const a = ctx.archivio;
  const st = await a.stato();
  const prot = st.protezione === 'sistema' ? `Chiave protetta dal ${st.sistema}.` : st.protezione === 'file' ? 'Protezione di base: su questo computer il portachiavi del sistema non è disponibile, quindi la chiave è protetta solo dai permessi del tuo utente. Ti consigliamo di impostare una password.' : 'Anteprima: archivio NON cifrato (solo per lo sviluppo).';
  el.append(...[
    h('h3', {}, 'Protezione'),
    h('p', {}, 'Firme, sigle, timbri, rubrica, modelli e registro sono cifrati (AES-256) in un archivio nella cartella dati di Leggio. ' + prot),
    h('p', {}, st.password ? 'Password: impostata. Leggio la chiede la prima volta che usi l\'archivio dopo l\'avvio.' : 'Password: nessuna. Puoi aggiungerla se il computer è condiviso o vuoi più protezione.'),
    h('div', { class: 'pers-actions' },
      h('button', { type: 'button', class: 'btn', onclick: async () => { if (await impostaPassword(app, a, st.password)) mostra('protezione'); } }, st.password ? 'Cambia la password…' : 'Imposta una password…'),
      st.password ? h('button', { type: 'button', class: 'btn', onclick: async () => { if (await impostaPassword(app, a, true, { togli: true })) mostra('protezione'); } }, 'Togli la password…') : null,
      st.password ? h('button', { type: 'button', class: 'btn', onclick: async () => { await a.salvaOra(); await a.backend.blocca(); await a.chiudi(); app.ui.toast('Archivio personale bloccato: servirà la password per riaprirlo.', { kind: 'success' }); chiudiPane(); } }, 'Blocca ora') : null),
    h('h3', {}, 'Backup'),
    h('p', {}, 'Leggio conserva da solo la versione precedente dell\'archivio. Per spostare i dati su un altro computer, o per sicurezza, esporta un file di backup: è cifrato con una password che scegli tu (senza quella password non si apre).'),
    h('div', { class: 'pers-actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => esportaBackup(app, a) }, 'Esporta un backup…'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { if (await importaBackup(app, a)) mostra('contenuto'); } }, 'Importa un backup…')),
    st.cartella ? h('p', { class: 'muted pers-small' }, 'Cartella: ' + st.cartella) : null,
  ].filter(Boolean));
}

async function impostaPassword(app, a, haPassword, { togli = false } = {}) {
  const fields = [];
  if (haPassword) fields.push({ name: 'attuale', label: 'Password attuale', type: 'password', required: true });
  if (!togli) fields.push({ name: 'nuova', label: 'Nuova password (almeno 8 caratteri)', type: 'password', required: true }, { name: 'ripeti', label: 'Ripeti la nuova password', type: 'password', required: true });
  fields.push({ name: 'info', type: 'info', text: togli ? 'Senza password l\'archivio resta cifrato con la chiave del sistema.' : 'Attenzione: se dimentichi la password i dati non si possono recuperare (nemmeno da noi). Tieni un backup esportato in un posto sicuro.' });
  for (;;) {
    const v = await app.ui.dialog({
      title: togli ? 'Togli la password' : haPassword ? 'Cambia la password' : 'Imposta una password', fields, okLabel: togli ? 'Togli la password' : 'Salva la password',
      validate: (x) => (!togli && x.nuova !== x.ripeti ? 'Le due password non coincidono.' : !togli && x.nuova.length < 8 ? 'La password deve avere almeno 8 caratteri.' : null),
    });
    if (!v) return false;
    try {
      await a.salvaOra();
      await a.backend.impostaPassword(v.attuale || '', togli ? '' : v.nuova);
      app.ui.toast(togli ? 'Password tolta' : 'Password salvata', { kind: 'success' });
      return true;
    } catch (e) { app.ui.toast(e.message, { kind: 'error', timeout: 6000 }); if (e.code !== 'password-errata') return false; }
  }
}

async function esportaBackup(app, a) {
  const v = await app.ui.dialog({
    title: 'Esporta un backup', message: 'Il file conterrà tutto l\'archivio personale (firme, timbri, rubrica, modelli, registro), cifrato con questa password.',
    fields: [
      { name: 'pw', label: 'Password del backup (almeno 8 caratteri)', type: 'password', required: true },
      { name: 'pw2', label: 'Ripeti la password', type: 'password', required: true },
    ],
    okLabel: 'Esporta…',
    validate: (x) => (x.pw !== x.pw2 ? 'Le due password non coincidono.' : x.pw.length < 8 ? 'La password deve avere almeno 8 caratteri.' : null),
  });
  if (!v) return;
  try {
    await a.salvaOra();
    const r = await a.backend.esporta(v.pw);
    if (r) app.ui.toast(`Backup salvato: ${r.nome}`, { kind: 'success' });
  } catch (e) { app.reportError(e, 'Backup non riuscito'); }
}

async function importaBackup(app, a) {
  try {
    const f = await a.backend.importaScegli();
    if (!f) return false;
    for (;;) {
      const v = await app.ui.dialog({
        title: 'Importa un backup', message: `File: ${f.nome}`,
        fields: [
          { name: 'pw', label: 'Password del backup', type: 'password', required: true },
          { name: 'modo', label: 'Cosa fare con i dati che hai già', type: 'radio', value: 'unisci', options: [
            { value: 'unisci', label: 'Unisci: aggiungi quello che manca e aggiorna con la versione più recente' },
            { value: 'sostituisci', label: 'Sostituisci: l\'archivio diventa uguale al backup' },
          ] },
        ],
        okLabel: 'Importa',
      });
      if (!v) return false;
      try {
        const r = await a.backend.importaApri(f.token, v.pw);
        if (v.modo === 'sostituisci' && !(await app.ui.confirm('I dati attuali dell\'archivio personale verranno sostituiti da quelli del backup. Continuare?', { title: 'Sostituisci l\'archivio', okLabel: 'Sostituisci', danger: true }))) return false;
        const inv = await a.applicaImportato(r.indice, v.modo);
        app.ui.toast(`Backup importato: ${inv.contatti} contatti, ${inv.firmeMie + inv.sigleMie + inv.firmeAltrui} firme e sigle, ${inv.timbri} timbri, ${inv.modelli} modelli`, { kind: 'success', timeout: 8000 });
        return true;
      } catch (e) { app.ui.toast(e.message, { kind: 'error', timeout: 6000 }); if (e.code !== 'password-errata') return false; }
    }
  } catch (e) { app.reportError(e, 'Importazione non riuscita'); return false; }
}

// ----------------------------------------------------------------------------------------- contenuto
function sezContenuto(app, ctx, el, mostra) {
  const { h } = app.ui; const a = ctx.archivio; const i = a.inventario();
  const riga = (n, testo, azione, label) => h('tr', {}, h('td', { class: 'num' }, String(n)), h('td', {}, testo), h('td', {}, azione ? h('button', { type: 'button', class: 'btn small', onclick: azione }, label || 'Apri') : null));
  el.append(
    h('h3', {}, 'Cosa c\'è nell\'archivio personale'),
    h('p', {}, 'Tutto resta su questo computer: Leggio non invia nulla in rete. Per i dati di una singola persona (esportarli o cancellarli) apri la sua scheda nella Rubrica.'),
    h('table', { class: 'pers-table' }, h('tbody', {},
      riga(i.profilo, 'dati personali tuoi (nome, codice fiscale, ufficio…)', () => app.tools.run('personal-data'), 'Modifica'),
      riga(i.contatti, `contatti in rubrica (${i.gruppi} gruppi)`, () => app.tools.run('rubrica')),
      riga(i.firmeMie, 'tue firme', () => mostra('firme')),
      riga(i.sigleMie, 'tue sigle', () => mostra('firme')),
      riga(i.firmeAltrui, 'firme e sigle di altre persone', () => mostra('firme')),
      riga(i.timbri, 'timbri', () => mostra('timbri')),
      riga(i.modelli, 'modelli di moduli (con le corrispondenze dei campi)', () => app.tools.run('templates')),
      riga(i.registro, 'voci nel registro delle firme di altre persone', () => mostra('registro')))),
  );
}

// ----------------------------------------------------------------------------------------- firme
async function sezFirme(app, ctx, el) {
  const { h } = app.ui; const a = ctx.archivio;
  const tutte = a.firme();
  el.append(h('h3', {}, 'Firme e sigle'),
    h('p', {}, 'Nessun limite di numero. Le firme di altre persone si usano solo dopo una conferma e ogni uso finisce nel registro.'),
    h('div', { class: 'pers-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: async () => { const { createSignatureDialog } = await import('../../moduli/sigpad.js'); const { sceltaProprietario } = await import('../../moduli/personale.js'); const r = await createSignatureDialog(app, { kind: 'signature', name: [a.profilo().nome, a.profilo().cognome].filter(Boolean).join(' '), scegliProprietario: sceltaProprietario(app, a) }); if (r) await a.aggiungiFirma({ nome: r.nome, tipo: r.kind === 'initials' ? 'sigla' : 'firma', proprietario: r.proprietario, immagine: r.dataUrl, w: r.w, h: r.h, origine: r.origine }); } }, 'Nuova firma o sigla…')));
  if (!tutte.length) { el.append(h('p', { class: 'muted' }, 'Ancora nessuna firma salvata.')); return; }
  const gruppi = [['Mie', tutte.filter((f) => f.proprietario === 'io')], ['Di altre persone', tutte.filter((f) => f.proprietario !== 'io')]];
  for (const [titolo, lista] of gruppi) {
    if (!lista.length) continue;
    el.append(h('h4', {}, `${titolo} (${lista.length})`));
    const ul = h('ul', { class: 'pers-sig-list' });
    for (const f of lista) {
      const img = h('img', { alt: f.nome, class: 'pers-sig-img' });
      a.immagine(f.blob).then((u) => { img.src = u; }).catch(() => { img.alt = 'immagine non disponibile'; });
      ul.append(h('li', { class: 'pers-sig' }, img,
        h('div', { class: 'pers-sig-info' }, h('strong', {}, f.nome), h('span', {}, `${f.tipo === 'sigla' ? 'Sigla' : 'Firma'} · ${f.proprietario === 'io' ? 'mia' : 'di ' + a.nomeProprietario(f)} · creata il ${data(f.creata)} · usata il ${data(f.usata)}`)),
        h('div', { class: 'pers-sig-act' },
          h('button', { type: 'button', class: 'btn small', onclick: async () => { const n = await app.ui.prompt('Nome', f.nome, { title: 'Rinomina', okLabel: 'Salva' }); if (n != null) a.aggiornaFirma(f.id, { nome: n }); } }, 'Rinomina'),
          h('button', { type: 'button', class: 'btn small', onclick: () => a.aggiornaFirma(f.id, { tipo: f.tipo === 'sigla' ? 'firma' : 'sigla' }) }, f.tipo === 'sigla' ? 'È una firma' : 'È una sigla'),
          h('button', { type: 'button', class: 'btn small', onclick: async () => { const { sceltaProprietario } = await import('../../moduli/personale.js'); const r = await sceltaProprietario(app, a)(); if (r) a.aggiornaFirma(f.id, { proprietario: r === 'io' ? 'io' : r.id }); } }, 'Cambia proprietario…'),
          h('button', { type: 'button', class: 'btn small danger', onclick: async () => { if (await app.ui.confirm(`Eliminare «${f.nome}»? L'immagine viene cancellata dall'archivio.`, { title: 'Elimina firma', okLabel: 'Elimina', danger: true })) await a.eliminaFirma(f.id); } }, 'Elimina'))));
    }
    el.append(ul);
  }
}

// ----------------------------------------------------------------------------------------- timbri
async function sezTimbri(app, ctx, el) {
  const { h } = app.ui; const a = ctx.archivio;
  const { creaTimbroDialog, immagineTimbro } = await import('../../moduli/timbri.js');
  el.append(h('h3', {}, 'Timbri'),
    h('p', {}, 'Il timbro dell\'ente, composto con il testo o ricavato dalla scansione di quello vero. I modelli pronti («Copia conforme», «Ricevuto il…», «Annullato», «Visto», «Pagato») sono sempre disponibili in Compila e firma.'),
    h('div', { class: 'pers-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => creaTimbroDialog(app, a) }, 'Crea il timbro dell\'ente…')));
  const lista = a.timbri();
  if (!lista.length) { el.append(h('p', { class: 'muted' }, 'Ancora nessun timbro salvato.')); return; }
  const ul = h('ul', { class: 'pers-sig-list' });
  for (const t of lista) {
    const img = h('img', { alt: t.nome, class: 'pers-sig-img' });
    immagineTimbro(a, t).then((r) => { img.src = r.dataUrl; }).catch(() => {});
    ul.append(h('li', { class: 'pers-sig' }, img,
      h('div', { class: 'pers-sig-info' }, h('strong', {}, t.nome), h('span', {}, `${t.tipo === 'testo' ? 'Composto con il testo' : 'Da immagine'} · creato il ${data(t.creato)}`)),
      h('div', { class: 'pers-sig-act' },
        t.spec && t.tipo === 'testo' ? h('button', { type: 'button', class: 'btn small', onclick: async () => { const n = await creaTimbroDialog(app, a, { iniziale: { ...t.spec, nome: t.nome } }); if (n) await a.eliminaTimbro(t.id); } }, 'Modifica…') : null,
        h('button', { type: 'button', class: 'btn small danger', onclick: async () => { if (await app.ui.confirm(`Eliminare il timbro «${t.nome}»?`, { title: 'Elimina timbro', okLabel: 'Elimina', danger: true })) await a.eliminaTimbro(t.id); } }, 'Elimina'))));
  }
  el.append(ul);
}

// ----------------------------------------------------------------------------------------- registro
function sezRegistro(app, ctx, el) {
  const { h } = app.ui; const a = ctx.archivio;
  const voci = a.registro();
  const persone = [...new Map(voci.map((r) => [r.proprietario, r.proprietarioNome])).entries()];
  let filtro = '';
  const tbody = h('tbody');
  const disegna = () => {
    tbody.textContent = '';
    const v = voci.filter((r) => !filtro || r.proprietario === filtro);
    for (const r of v.slice(0, 2000)) tbody.append(h('tr', {}, h('td', {}, dataOra(r.quando)), h('td', {}, r.firmaNome + (r.tipo === 'sigla' ? ' (sigla)' : '')), h('td', {}, a.contatto(r.proprietario) ? nomeContatto(a.contatto(r.proprietario)) : r.proprietarioNome), h('td', {}, r.documento), h('td', {}, r.pagine)));
    if (v.length > 2000) tbody.append(h('tr', {}, h('td', { colspan: 5, class: 'muted' }, `… e altre ${v.length - 2000} voci (tutte nell'esportazione CSV)`)));
  };
  const sel = h('select', { 'aria-label': 'Filtra per persona', onchange: () => { filtro = sel.value; disegna(); } }, h('option', { value: '' }, 'Tutte le persone'), persone.map(([id, n]) => h('option', { value: id }, n)));
  el.append(h('h3', {}, 'Registro delle firme di altre persone'),
    h('p', {}, 'Ogni volta che una firma o una sigla di un\'altra persona viene scritta in un documento, qui restano: quale firma, di chi, in quale documento e quando.'),
    h('div', { class: 'pers-actions' }, sel, h('button', { type: 'button', class: 'btn', disabled: !voci.length, onclick: () => {
      const cols = ['Quando', 'Firma', 'Tipo', 'Di chi', 'Documento', 'Pagine', 'Azione'];
      const righe = voci.filter((r) => !filtro || r.proprietario === filtro).map((r) => ({ Quando: dataOra(r.quando), Firma: r.firmaNome, Tipo: r.tipo, 'Di chi': r.proprietarioNome, Documento: r.documento, Pagine: r.pagine, Azione: r.azione }));
      app.exportFile(new TextEncoder().encode(csvDaTabella(cols, righe)), `registro-firme-${new Date().toISOString().slice(0, 10)}.csv`, [{ name: 'CSV (Excel)', extensions: ['csv'] }]);
    } }, 'Esporta CSV…')));
  if (!voci.length) { el.append(h('p', { class: 'muted' }, 'Il registro è vuoto.')); return; }
  el.append(h('table', { class: 'pers-table pers-log' }, h('thead', {}, h('tr', {}, ['Quando', 'Firma', 'Di chi', 'Documento', 'Pagine'].map((c) => h('th', { scope: 'col' }, c)))), tbody));
  disegna();
}
