// Azioni guidate: file → sequenza di operazioni → dove salvare → avanzamento → rapporto finale.
import { tutteLeOperazioni, validaSequenza, eseguiSequenza, nomeUscita, SkipError } from '../lib/batch-ops.js';
import { chooseFolder, chooseFiles, writeOut, isDesktop, call, fileItem, dirname, basename } from '../native.js';
import { preferenze as prefProtocollo } from './protocollo.js';
import { contatoreCorrente } from '../lib/protocollo.js';

const KEY_SEQ = 'avanzati.sequenze';
const MAX_FILE = 500 * 1024 * 1024;

export const SEQUENZE_ESEMPIO = [
  { nome: 'Copia per pubblicazione (metadati, numeri, filigrana COPIA)', passi: [{ op: 'metadati', params: {} }, { op: 'numeri', params: { formato: 'Pagina {n} di {tot}', posizione: 'basso-centro', size: 10, inizio: 1 } }, { op: 'filigrana', params: { testo: 'COPIA', opacita: 15, colore: '#b42318', pagine: 'tutte' } }] },
  { nome: 'Raddrizza scansioni (ruota di 90°)', passi: [{ op: 'ruota', params: { angolo: '90', pagine: 'tutte' } }] },
];

function operazioni(app) {
  const esterne = [];
  try { app.bus.emit('batch:operations', esterne); } catch (e) { console.error(e); }
  return tutteLeOperazioni(esterne);
}

export function openBatch(app, deps, preset = null) {
  const { h } = app.ui;
  const ops = operazioni(app);
  const state = { items: [], folder: null, label: '', passi: preset?.passi ? structuredClone(preset.passi) : [], dest: 'sub', destFolder: null, nome: 'stesso', recursive: true };
  const pane = deps.openPane(app, { title: 'Azioni guidate', subtitle: 'Applica le stesse operazioni a molti PDF in una volta. Gli originali non vengono toccati.', id: 'batch' });

  // --- colonna 1: file ---
  const fileList = h('ul', { class: 'av-files', 'aria-label': 'File da elaborare' });
  const fileCount = h('div', { class: 'av-note' });
  const recursive = h('input', { type: 'checkbox', checked: true, id: 'av-b-rec', onchange: () => { state.recursive = recursive.checked; } });
  const drop = h('div', { class: 'av-drop' }, 'Puoi anche trascinare qui i PDF');
  const renderFiles = () => {
    fileList.innerHTML = '';
    state.items.slice(0, 400).forEach((it, i) => fileList.append(h('li', {}, h('span', {}, it.rel || it.name),
      h('button', { class: 'icon-btn', 'aria-label': 'Togli ' + it.name, title: 'Togli dall\'elenco', onclick: () => { state.items.splice(i, 1); renderFiles(); } }, '✕'))));
    if (state.items.length > 400) fileList.append(h('li', {}, h('span', { class: 'av-note' }, `… e altri ${state.items.length - 400} file`)));
    fileCount.textContent = state.items.length ? `${state.items.length} file${state.label ? ' da «' + state.label + '»' : ''}` : 'Nessun file scelto.';
  };
  const addItems = (items, folder, label) => {
    const seen = new Set(state.items.map((x) => x.path || x.rel + x.size));
    for (const it of items) { const k = it.path || it.rel + it.size; if (!seen.has(k)) { seen.add(k); state.items.push(it); } }
    if (folder !== undefined) { state.folder = folder; state.label = label; }
    renderFiles();
  };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('over');
    addItems([...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name)).map(fileItem));
  });
  const col1 = h('section', { class: 'av-box' }, h('h3', {}, h('span', { class: 'av-step-n' }, '1'), 'File da elaborare'),
    h('div', { class: 'av-row' },
      h('button', { class: 'btn primary', onclick: async () => { try { const r = await chooseFolder(app, { recursive: state.recursive, skipDirs: ['Elaborati'], title: 'Scegli la cartella con i PDF' }); if (r) { addItems(r.items, r.folder, r.label); if (r.truncated) app.ui.toast('La cartella contiene moltissimi file: ne sono stati presi i primi 20.000.', { kind: 'warning' }); } } catch (e) { app.reportError(e, 'Cartella non leggibile'); } } }, 'Scegli cartella…'),
      h('button', { class: 'btn', onclick: async () => { try { addItems(await chooseFiles(app, { title: 'Aggiungi PDF' })); } catch (e) { app.reportError(e, 'File non aggiunti'); } } }, 'Aggiungi file…'),
      state.items ? h('button', { class: 'btn', onclick: () => { state.items = []; state.folder = null; state.label = ''; renderFiles(); } }, 'Svuota') : null),
    h('label', { class: 'chk', for: 'av-b-rec' }, recursive, 'Comprendi le sottocartelle'),
    fileCount, fileList, drop);

  // --- colonna 2: operazioni ---
  const stepsEl = h('ol', { class: 'av-steps', 'aria-label': 'Sequenza di operazioni' });
  const addSel = h('select', { 'aria-label': 'Operazione da aggiungere' }, h('option', { value: '' }, 'Scegli un\'operazione…'), ops.map((o) => h('option', { value: o.id }, o.label + (o.esterna ? '' : ''))));
  const seqSel = h('select', { 'aria-label': 'Sequenze salvate' });
  const renderSeq = () => {
    const saved = app.settings.get(KEY_SEQ, null) ?? SEQUENZE_ESEMPIO;
    seqSel.innerHTML = '';
    seqSel.append(h('option', { value: '' }, saved.length ? 'Sequenze salvate…' : 'Nessuna sequenza salvata'), saved.map((s, i) => h('option', { value: String(i) }, s.nome)));
  };
  const renderSteps = () => {
    stepsEl.innerHTML = '';
    if (!state.passi.length) stepsEl.append(h('li', {}, h('span', { class: 'av-note av-grow' }, 'Aggiungi una o più operazioni: verranno eseguite in quest\'ordine.')));
    state.passi.forEach((s, i) => {
      const o = ops.find((x) => x.id === s.op);
      const label = o ? (o.summary?.(s.params || {}) || o.label) : `${s.op} (non disponibile)`;
      stepsEl.append(h('li', {}, h('strong', {}, `${i + 1}.`), h('span', { class: 'av-grow' }, label),
        h('button', { class: 'btn small', title: 'Sposta su', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { [state.passi[i - 1], state.passi[i]] = [state.passi[i], state.passi[i - 1]]; renderSteps(); } }, '↑'),
        h('button', { class: 'btn small', title: 'Sposta giù', 'aria-label': 'Sposta giù', disabled: i === state.passi.length - 1, onclick: () => { [state.passi[i + 1], state.passi[i]] = [state.passi[i], state.passi[i + 1]]; renderSteps(); } }, '↓'),
        o ? h('button', { class: 'btn small', onclick: async () => { const p = await askParams(app, o, s.params); if (p) { s.params = p; renderSteps(); } } }, 'Modifica') : null,
        h('button', { class: 'btn small', 'aria-label': 'Togli operazione', onclick: () => { state.passi.splice(i, 1); renderSteps(); } }, 'Togli')));
    });
  };
  addSel.addEventListener('change', async () => {
    const o = ops.find((x) => x.id === addSel.value); addSel.value = '';
    if (!o) return;
    const p = await askParams(app, o, defaultsFor(app, o));
    if (p) { state.passi.push({ op: o.id, params: p }); renderSteps(); }
  });
  seqSel.addEventListener('change', () => {
    const saved = app.settings.get(KEY_SEQ, null) ?? SEQUENZE_ESEMPIO;
    const s = saved[+seqSel.value];
    if (s) { state.passi = structuredClone(s.passi); renderSteps(); app.ui.toast(`Sequenza «${s.nome}» caricata`); }
  });
  const col2 = h('section', { class: 'av-box' }, h('h3', {}, h('span', { class: 'av-step-n' }, '2'), 'Operazioni da eseguire'),
    stepsEl, h('div', { class: 'av-row' }, addSel),
    h('div', { class: 'av-row', style: { marginTop: '12px' } }, seqSel,
      h('button', { class: 'btn small', onclick: async () => {
        const err = validaSequenza(state.passi, ops); if (err) return app.ui.toast(err, { kind: 'warning' });
        const nome = await app.ui.prompt('Nome della sequenza', '', { title: 'Salva sequenza', okLabel: 'Salva' });
        if (!nome) return;
        const saved = [...(app.settings.get(KEY_SEQ, null) ?? SEQUENZE_ESEMPIO)].filter((x) => x.nome !== nome.trim());
        // la password non viene mai salvata
        saved.push({ nome: nome.trim().slice(0, 120), passi: state.passi.map((p) => ({ op: p.op, params: p.op === 'proteggi' ? { ...p.params, password: '' } : p.params })) });
        app.settings.set(KEY_SEQ, saved); renderSeq(); app.ui.toast('Sequenza salvata', { kind: 'success' });
      } }, 'Salva sequenza…'),
      h('button', { class: 'btn small', onclick: async () => {
        const saved = [...(app.settings.get(KEY_SEQ, null) ?? SEQUENZE_ESEMPIO)]; const i = +seqSel.value;
        if (seqSel.value === '' || !saved[i]) return app.ui.toast('Scegli prima una sequenza dall\'elenco.');
        if (!(await app.ui.confirm(`Eliminare la sequenza «${saved[i].nome}»?`, { okLabel: 'Elimina', danger: true }))) return;
        saved.splice(i, 1); app.settings.set(KEY_SEQ, saved); renderSeq();
      } }, 'Elimina')),
    h('p', { class: 'av-note' }, 'Le password non vengono salvate nelle sequenze: verranno chieste di nuovo.'));

  // --- colonna 3: destinazione ---
  const destNote = h('div', { class: 'av-note' });
  const destRadios = h('div', { class: 'radio-group', role: 'radiogroup' },
    ...[['sub', 'Nella sottocartella «Elaborati» accanto agli originali (consigliato)'], ['other', 'In un\'altra cartella…'], ['overwrite', 'Sostituisci gli originali']].map(([v, l]) =>
      h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'av-dest', value: v, checked: state.dest === v, onchange: async () => {
        state.dest = v;
        if (v === 'other' && isDesktop()) { try { state.destFolder = await call(app, 'choose-folder', { title: 'Dove salvare i file elaborati' }); } catch {} }
        renderDest();
      } }), h('span', {}, l))));
  const nameSel = h('select', { 'aria-label': 'Nome dei file', onchange: () => { state.nome = nameSel.value; } },
    h('option', { value: 'stesso' }, 'Stesso nome dell\'originale'), h('option', { value: 'suffisso' }, 'Nome con «_elaborato»'));
  const renderDest = () => {
    destNote.textContent = !isDesktop() ? 'Nell\'anteprima web i file elaborati vengono scaricati.' :
      state.dest === 'other' ? (state.destFolder ? `Cartella: ${state.destFolder}` : 'Nessuna cartella scelta.') :
        state.dest === 'overwrite' ? 'Attenzione: gli originali verranno sostituiti. Ti verrà chiesta conferma.' : '';
  };
  const startBtn = h('button', { class: 'btn primary big', onclick: () => avvia() }, 'Avvia');
  const col3 = h('section', { class: 'av-box' }, h('h3', {}, h('span', { class: 'av-step-n' }, '3'), 'Dove salvare'),
    destRadios, h('div', { class: 'field' }, h('label', {}, 'Nome dei file'), nameSel), destNote,
    h('div', { style: { marginTop: '14px' } }, startBtn));
  const report = h('div', { class: 'av-report' });
  pane.body.append(h('div', { class: 'av-batch' }, col1, col2, col3), report);
  renderFiles(); renderSteps(); renderSeq(); renderDest();

  async function avvia() {
    if (!state.items.length) return app.ui.toast('Scegli prima i file da elaborare.', { kind: 'warning' });
    const err = validaSequenza(state.passi, ops);
    if (err) return app.ui.toast(err, { kind: 'warning' });
    // password mancanti (sequenze salvate)
    for (const s of state.passi) {
      if (s.op === 'proteggi' && !s.params?.password) {
        const o = ops.find((x) => x.id === 'proteggi'); const p = await askParams(app, o, s.params); if (!p) return; s.params = p;
      }
    }
    if (state.dest === 'other' && isDesktop() && !state.destFolder) return app.ui.toast('Scegli la cartella dove salvare.', { kind: 'warning' });
    if (state.dest === 'overwrite') {
      if (state.items.some((it) => !it.path)) return app.ui.toast('Nell\'anteprima web non è possibile sostituire gli originali.', { kind: 'warning' });
      const ok = await app.ui.confirm(`Vuoi davvero sostituire ${state.items.length} file originali con quelli elaborati? Non si potrà annullare.`, { title: 'Sostituire gli originali?', okLabel: 'Sostituisci gli originali', danger: true });
      if (!ok) return;
    }
    const esiti = [];
    const t0 = Date.now();
    const done = await app.ui.withProgress('Azioni guidate', async (p) => {
      for (let i = 0; i < state.items.length; i++) {
        if (p.cancelled) break;
        const it = state.items[i];
        p.set(i / state.items.length, `File ${i + 1} di ${state.items.length}: ${it.name}`);
        const ctx = { index: i, name: it.name };
        try {
          if (it.size > MAX_FILE) throw new SkipError('Il file è troppo grande (oltre 500 MB).');
          const bytes = await it.read();
          const out = await eseguiSequenza(bytes, state.passi, { PDFLib: app.lib.PDFLib, openPdfLib: (b) => app.lib.openPdfLib(b), savePdfLib: (d) => app.lib.savePdfLib(d), ops, ctx, signal: p.signal });
          const name = nomeUscita(it.name, { modo: state.nome });
          let dove;
          if (state.dest === 'overwrite' && it.path) dove = await call(app, 'write', { folder: dirname(it.path), name: basename(it.path), bytes: out, overwrite: true });
          else if (state.dest === 'other' && state.destFolder) dove = await writeOut(app, state.destFolder, { name, bytes: out });
          else if (it.path) {
            // sottocartella «Elaborati» accanto all'originale, mantenendo la struttura delle sottocartelle
            const base = state.folder && it.path.startsWith(state.folder) ? state.folder : dirname(it.path);
            const relDir = state.folder && it.path.startsWith(state.folder) ? dirname(it.rel.replace(/\\/g, '/')) : '';
            dove = await call(app, 'write', { folder: base, sub: ['Elaborati', relDir && relDir !== it.rel ? relDir : ''].filter(Boolean).join('/'), name, bytes: out });
          } else dove = await writeOut(app, null, { name, bytes: out });
          esiti.push({ it, ok: true, dove, note: ctx.note || '' });
        } catch (e) {
          if (e?.name === 'AbortError') break;
          esiti.push({ it, ok: false, skip: e instanceof SkipError, motivo: e?.message || String(e) });
        }
        await new Promise((r) => setTimeout(r, 0)); // lascia respirare l'interfaccia
      }
      return true;
    });
    const prot = state.passi.find((s) => s.op === 'protocollo');
    if (prot) {
      const base = parseInt(String(prot.params.numero).replace(/\D/g, ''), 10);
      const usati = esiti.filter((e) => e.ok).length;
      if (Number.isFinite(base) && usati) app.settings.set('avanzati.protocollo.contatore', { anno: new Date().getFullYear(), prossimo: base + state.items.length });
    }
    mostraRapporto(esiti, Date.now() - t0, done === undefined);
  }

  function mostraRapporto(esiti, ms, annullato) {
    report.innerHTML = '';
    const ok = esiti.filter((e) => e.ok); const ko = esiti.filter((e) => !e.ok);
    const sec = Math.max(1, Math.round(ms / 1000));
    report.append(h('section', { class: 'av-box' },
      h('h3', {}, 'Rapporto finale'),
      h('p', { class: 'av-big-ok' }, `${ok.length} file elaborati correttamente${ko.length ? `, ${ko.length} non elaborati` : ''}${annullato ? ' (operazione interrotta)' : ''} — ${sec} s.`),
      h('div', { class: 'av-row' },
        ok[0]?.dove && isDesktop() ? h('button', { class: 'btn', onclick: () => app.platform.showInFolder(ok[0].dove) }, 'Mostra nella cartella') : null,
        h('button', { class: 'btn', onclick: () => app.platform.download(new TextEncoder().encode(rapportoTesto(esiti)), 'rapporto_azioni_guidate.txt') }, 'Salva il rapporto (testo)')),
      h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Esito'), h('th', {}, 'Dettagli')),
        esiti.map((e) => h('tr', {}, h('td', {}, e.it.rel || e.it.name),
          h('td', { class: e.ok ? 'av-ok' : e.skip ? 'av-skip' : 'av-ko' }, e.ok ? 'Fatto' : e.skip ? 'Saltato' : 'Non riuscito'),
          h('td', {}, e.ok ? [e.note, e.dove].filter(Boolean).join(' — ') : e.motivo))))));
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function rapportoTesto(esiti) {
  return ['Rapporto delle azioni guidate — Leggio', new Date().toLocaleString('it-IT'), '',
    ...esiti.map((e) => `${e.ok ? 'FATTO     ' : e.skip ? 'SALTATO   ' : 'NON RIUSCITO'}  ${e.it.rel || e.it.name}  ${e.ok ? e.dove || '' : e.motivo}`)].join('\r\n');
}

function defaultsFor(app, o) {
  const p = {};
  for (const f of o.fields || []) if (f.name && f.type !== 'info') p[f.name] = f.value;
  if (o.id === 'protocollo') {
    const pr = prefProtocollo(app);
    Object.assign(p, { ente: pr.ente, ufficio: pr.ufficio, direzione: pr.direzione, posizione: pr.posizione, numero: String(contatoreCorrente(app.settings.get('avanzati.protocollo.contatore', null)).prossimo) });
  }
  return p;
}

async function askParams(app, o, params = {}) {
  const fields = (o.fields || []).map((f) => ({ ...f, value: f.name in (params || {}) ? params[f.name] : f.value }));
  if (!fields.some((f) => f.type !== 'info')) return {};
  const v = await app.ui.dialog({ title: o.label, message: o.description, fields, okLabel: 'Conferma', validate: (x) => o.validate?.(x) || null });
  return v;
}
