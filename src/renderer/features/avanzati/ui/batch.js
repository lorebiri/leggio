// Azioni guidate: file → sequenza di operazioni → dove salvare → avanzamento → rapporto finale.
import { tutteLeOperazioni, validaSequenza, eseguiSequenza, nomeUscita, SkipError, operazioneProteggi, destinazione } from '../lib/batch-ops.js';
import { chooseFolder, chooseFiles, writeOut, isDesktop, call, fileItem, dirname, basename } from '../native.js';
import { preferenze as prefProtocollo } from './protocollo.js';
import { contatoreCorrente } from '../lib/protocollo.js';
import { nomeDalContenuto } from './coda.js';
import { nuovoLavoro, registra, daFare, conteggi, lavoroValido, registroCsv, chiaveDi } from '../lib/registro.js';

const KEY_SEQ = 'avanzati.sequenze';
const MAX_FILE = 500 * 1024 * 1024;

export const SEQUENZE_ESEMPIO = [
  { nome: 'Copia per pubblicazione (metadati, numeri, filigrana COPIA)', passi: [{ op: 'metadati', params: {} }, { op: 'numeri', params: { formato: 'Pagina {n} di {tot}', posizione: 'basso-centro', size: 10, inizio: 1 } }, { op: 'filigrana', params: { testo: 'COPIA', opacita: 15, colore: '#b42318', pagine: 'tutte' } }] },
  { nome: 'Raddrizza scansioni (ruota di 90°)', passi: [{ op: 'ruota', params: { angolo: '90', pagine: 'tutte' } }] },
];

/**
 * Operazioni disponibili: le nostre + quelle registrate dalle altre aree con 'batch:operations'. Se un'area espone
 * il servizio ma non ha (ancora) registrato l'operazione, la offriamo noi sopra il servizio, così compare comunque.
 */
export function operazioni(app) {
  const esterne = [];
  try { app.bus.emit('batch:operations', esterne); } catch (e) { console.error(e); }
  const ha = (id) => esterne.some((x) => x?.id === id);
  const sv = app.services || {};
  const prog = (ctx) => ({ set() {}, signal: ctx.signal, get cancelled() { return !!ctx.signal?.aborted; } });
  if (typeof sv.ocr === 'function' && !ha('ocr')) esterne.push({ id: 'ocr', label: 'Rendi ricercabile (OCR)', description: 'Riconosce il testo delle scansioni (italiano e inglese)', fields: [{ name: 'info', type: 'info', text: 'Le pagine che hanno già testo non vengono toccate.' }], summary: () => 'Rendi ricercabile (OCR)', runBytes: (b, _p, ctx) => sv.ocr(b, { deskew: true, progress: prog(ctx) }) });
  if (typeof sv.protect === 'function' && !ha('proteggi')) esterne.push({ ...operazioneProteggi(sv.protect), esterna: true });
  if (typeof sv.compress === 'function' && !ha('comprimi-sotto') && !ha('riduci')) esterne.push({ id: 'comprimi-sotto', label: 'Riduci dimensioni (sotto N MB)', description: 'Comprime le immagini fino a stare sotto la dimensione scelta', fields: [{ name: 'mb', label: 'Dimensione massima (MB)', type: 'number', value: 10, min: 0.2, max: 500, step: 0.1 }], summary: (p) => `Riduci sotto ${p.mb} MB`, validate: (p) => (!(+p.mb > 0) ? 'Scrivi una dimensione in MB.' : null), runBytes: async (b, p, ctx) => { const r = await sv.compress(b, { maxBytes: Math.round(+p.mb * 1048576), signal: ctx.signal }); if (r && r.reached === false) ctx.note = [ctx.note, `sopra ${p.mb} MB anche dopo la riduzione`].filter(Boolean).join(' — '); return r?.bytes || b; } });
  if (typeof sv.pdfa === 'function' && !ha('pdfa')) esterne.push({ id: 'pdfa', label: 'Converti in PDF/A', description: 'Formato per la conservazione, con verifica', fields: [{ name: 'part', label: 'Variante', type: 'select', value: '2', options: [{ value: '2', label: 'PDF/A-2 (consigliata)' }, { value: '3', label: 'PDF/A-3' }] }, { name: 'ocr', label: 'Riconosci il testo delle scansioni', type: 'checkbox', value: true }], summary: (p) => `PDF/A-${p.part}`, runBytes: async (b, p, ctx) => { const r = await sv.pdfa(b, { part: +p.part || 2, ocr: !!p.ocr, lang: 'it-IT', progress: prog(ctx) }); const ko = (r.verifica || []).filter((x) => !x.ok).length; ctx.note = [ctx.note, ko ? `PDF/A: ${ko} controlli non superati` : 'PDF/A verificato'].filter(Boolean).join(' — '); return r.bytes; } });
  if (typeof sv.sanitize === 'function' && !ha('sanifica') && !ha('sanitize')) esterne.push({ id: 'sanifica', label: 'Togli contenuti nascosti', description: 'Metadati, commenti, allegati, JavaScript, livelli nascosti, versioni precedenti', fields: [{ name: 'commenti', label: 'Togli anche i commenti', type: 'checkbox', value: true }, { name: 'allegati', label: 'Togli anche gli allegati', type: 'checkbox', value: true }], summary: () => 'Togli contenuti nascosti', runBytes: async (b, p) => (await sv.sanitize(b, { metadati: true, javascript: true, allegati: !!p.allegati, commenti: !!p.commenti, campiNascosti: true, livelliNascosti: true, datiPrivati: true, xfa: true, versioni: true })).bytes });
  if (typeof sv.oscuraDatiPersonali === 'function' && !ha('oscura-modelli')) esterne.push({ id: 'oscura-modelli', label: 'Oscura dati personali (modelli)', description: 'Codici fiscali, IBAN e altri dati trovati con i modelli', fields: [{ name: 'info', type: 'info', text: 'Oscuramento definitivo: il testo sotto viene eliminato.' }], summary: () => 'Oscura dati personali', runBytes: async (b, _p, ctx) => { const r = await sv.oscuraDatiPersonali(b, { progress: prog(ctx) }); ctx.note = [ctx.note, `${r.trovati ?? 0} dati oscurati`].filter(Boolean).join(' — '); return r.bytes; } });
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
      h('button', { class: 'btn primary', onclick: async () => { try { const r = await chooseFolder(app, { recursive: state.recursive, skipDirs: ['Elaborati'], title: 'Scegli la cartella con i PDF' }); if (r) { addItems(r.items, r.folder, r.label); if (r.truncated) app.ui.toast('La cartella contiene moltissimi file: ne sono stati presi i primi 200.000.', { kind: 'warning' }); } } catch (e) { app.reportError(e, 'Cartella non leggibile'); } } }, 'Scegli cartella…'),
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
    h('option', { value: 'stesso' }, 'Stesso nome dell\'originale'), h('option', { value: 'suffisso' }, 'Nome con «_elaborato»'), h('option', { value: 'contenuto' }, 'Proposto dal contenuto (es. Fattura_FORNITORE_n123_data)'));
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
    const lavoro = nuovoLavoro({ items: state.items, passi: state.passi, opzioni: { folder: state.folder, dest: state.dest, destFolder: state.destFolder, nome: state.nome, label: state.label } });
    await esegui(lavoro, state.items, state.passi);
  }

  /** Esegue (o riprende) un lavoro: salva lo stato ogni pochi file, così dopo un'interruzione si riparte da lì. */
  async function esegui(lavoro, items, passi) {
    const byKey = new Map(items.map((it) => [chiaveDi(it), it]));
    const opz = lavoro.opzioni;
    const t0 = Date.now(); let ultimoSalvataggio = 0;
    const salva = async (forza) => {
      if (!isDesktop()) return;
      if (!forza && Date.now() - ultimoSalvataggio < 3000) return;
      ultimoSalvataggio = Date.now();
      try { await call(app, 'job-save', { json: JSON.stringify(lavoro) }); } catch (e) { console.warn('[avanzati] stato non salvato', e); }
    };
    const registroDove = async () => {
      const csv = new TextEncoder().encode(registroCsv(lavoro));
      const folder = opz.dest === 'other' ? opz.destFolder : opz.folder;
      if (isDesktop() && folder) { try { return await call(app, 'write', { folder, sub: opz.dest === 'other' ? '' : 'Elaborati', name: `registro_azioni_guidate_${lavoro.id}.csv`, bytes: csv, overwrite: true }); } catch {} }
      return null;
    };
    const scrivi = async (d, name, bytes) => {
      if (d.folder && isDesktop()) return call(app, 'write', { folder: d.folder, sub: d.sub, name, bytes, overwrite: d.overwrite });
      return writeOut(app, null, { name, bytes });
    };
    await salva(true);
    const todo = daFare(lavoro);
    const done = await app.ui.withProgress('Azioni guidate', async (p) => {
      const c0 = conteggi(lavoro);
      for (let i = 0; i < todo.length; i++) {
        if (p.cancelled) break;
        const rec = todo[i]; const it = byKey.get(rec.k) || { ...rec, read: () => call(app, 'read', { path: rec.path }) };
        const k = c0.fatti + i;
        const el = (Date.now() - t0) / 1000; const rate = i ? el / i : 0;
        p.set(k / lavoro.items.length, `File ${k + 1} di ${lavoro.items.length}: ${it.name}${i > 5 ? ` — circa ${Math.ceil((todo.length - i) * rate / 60)} min alla fine` : ''}`);
        const dest = destinazione(it, opz);
        // ctx.scriviFile: le operazioni che producono altri file (.docx, .txt…) li scrivono accanto al risultato
        const ctx = { index: lavoro.items.indexOf(rec), name: it.name, signal: p.signal, scriviFile: (nome, b) => scrivi({ ...dest, overwrite: true }, nome, b) };
        const s0 = performance.now();
        try {
          if (it.size > MAX_FILE) throw new SkipError('Il file è troppo grande (oltre 500 MB).');
          const bytes = await it.read();
          const out = await eseguiSequenza(bytes, passi, { PDFLib: app.lib.PDFLib, openPdfLib: (b) => app.lib.openPdfLib(b), savePdfLib: (d) => app.lib.savePdfLib(d), ops, ctx, signal: p.signal });
          const name = opz.nome === 'contenuto' ? await nomeDalContenuto(out, it.name, app.settings.get('avanzati.rinomina.regola')) : nomeUscita(it.name, { modo: opz.nome });
          if (opz.nome === 'contenuto') ctx.note = [ctx.note, `nuovo nome: ${name}`].filter(Boolean).join(' — ');
          const dove = await scrivi(dest, opz.dest === 'overwrite' && it.path ? basename(it.path) : name, out);
          registra(lavoro, rec, { s: 'ok', dove, nota: ctx.note || '', ms: performance.now() - s0 });
        } catch (e) {
          if (e?.name === 'AbortError') break;
          registra(lavoro, rec, { s: e instanceof SkipError ? 'saltato' : 'errore', motivo: e?.message || String(e), ms: performance.now() - s0 });
        }
        await salva(false);
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0)); // lascia respirare l'interfaccia
      }
      return true;
    });
    const cc = conteggi(lavoro);
    const registro = await registroDove();
    if (isDesktop()) { if (cc.mancanti) await salva(true); else await call(app, 'job-clear').catch(() => {}); }
    const prot = passi.find((s) => s.op === 'protocollo');
    if (prot) {
      const base = parseInt(String(prot.params.numero).replace(/\D/g, ''), 10);
      if (Number.isFinite(base) && cc.ok) app.settings.set('avanzati.protocollo.contatore', { anno: new Date().getFullYear(), prossimo: base + lavoro.items.length });
    }
    mostraRapporto(lavoro, Date.now() - t0, done === undefined || cc.mancanti > 0, registro);
  }

  // lavoro interrotto (chiusura dell'app, annullamento): proponi di riprenderlo
  if (isDesktop()) {
    call(app, 'job-load').then((json) => {
      let l = null; try { l = json && JSON.parse(json); } catch { l = null; }
      if (!lavoroValido(l)) return;
      const cc = conteggi(l);
      if (!cc.mancanti) return;
      const box = h('section', { class: 'av-box av-resume' },
        h('h3', {}, 'Elaborazione interrotta'),
        h('p', {}, `Il ${new Date(l.aggiornato).toLocaleString('it-IT')} un'elaborazione di ${cc.totale} file si è fermata: ${cc.fatti} fatti, ${cc.mancanti} da fare. Le impostazioni e l'elenco dei file sono stati conservati (le password no).`),
        h('div', { class: 'av-row' },
          h('button', { class: 'btn primary', onclick: async () => {
            for (const s of l.passi) if (s.op === 'proteggi' && !s.params?.password) { const o = ops.find((x) => x.id === 'proteggi'); const pp = await askParams(app, o, s.params); if (!pp) return; s.params = pp; }
            const err = validaSequenza(l.passi, ops); if (err) return app.ui.toast(err, { kind: 'warning' });
            box.remove(); await esegui(l, [], l.passi);
          } }, `Riprendi (${cc.mancanti} file)`),
          h('button', { class: 'btn', onclick: async () => { if (await app.ui.confirm('Dimenticare l\'elaborazione interrotta? I file già elaborati restano dove sono.', { okLabel: 'Dimentica' })) { await call(app, 'job-clear').catch(() => {}); box.remove(); } } }, 'Dimentica')));
      pane.body.prepend(box);
    }).catch(() => {});
  }

  function mostraRapporto(lavoro, ms, interrotto, registro) {
    report.innerHTML = '';
    const cc = conteggi(lavoro);
    const sec = Math.max(1, Math.round(ms / 1000));
    const righe = lavoro.items.map((it) => ({ it, e: lavoro.esiti[it.k] })).filter((x) => x.e);
    const problemi = righe.filter((x) => x.e.s !== 'ok');
    const mostrati = [...problemi.slice(0, 500), ...righe.filter((x) => x.e.s === 'ok').slice(0, Math.max(0, 200 - Math.min(problemi.length, 200)))];
    report.append(h('section', { class: 'av-box' },
      h('h3', {}, 'Rapporto finale'),
      h('p', { class: 'av-big-ok' }, `${cc.ok} file elaborati${cc.saltati ? `, ${cc.saltati} saltati` : ''}${cc.errori ? `, ${cc.errori} non riusciti` : ''}${interrotto && cc.mancanti ? ` — interrotta: ${cc.mancanti} da fare (riprendi riaprendo Azioni guidate)` : ''} — ${sec} s.`),
      registro ? h('p', { class: 'av-note' }, `Registro completo salvato in: ${registro}`) : null,
      h('div', { class: 'av-row' },
        righe.find((x) => x.e.s === 'ok')?.e.dove && isDesktop() ? h('button', { class: 'btn', onclick: () => app.platform.showInFolder(righe.find((x) => x.e.s === 'ok').e.dove) }, 'Mostra nella cartella') : null,
        h('button', { class: 'btn', onclick: () => app.platform.download(new TextEncoder().encode(registroCsv(lavoro)), 'registro_azioni_guidate.csv') }, 'Scarica il registro (CSV)')),
      righe.length > mostrati.length ? h('p', { class: 'av-note' }, `Qui sotto: tutti i file con problemi (fino a 500) e alcuni di quelli riusciti. L'elenco completo è nel registro.`) : null,
      h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Esito'), h('th', {}, 'Dettagli')),
        mostrati.map(({ it, e }) => h('tr', {}, h('td', {}, it.rel || it.name),
          h('td', { class: e.s === 'ok' ? 'av-ok' : e.s === 'saltato' ? 'av-skip' : 'av-ko' }, e.s === 'ok' ? 'Fatto' : e.s === 'saltato' ? 'Saltato' : 'Non riuscito'),
          h('td', {}, e.s === 'ok' ? [e.nota, e.dove].filter(Boolean).join(' — ') : e.motivo))))));
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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
