// Flussi che raccolgono più file in un PDF: «Pratica di missione», «Fascicolo con indice», «Pacchetto per la rendicontazione».
import { creaFascicolo } from '../lib/fascicolo.js';
import { nomeMissione, aggiungiRiepilogo, dividiPerDimensione, classificaGiustificativo, nomeGiustificativo } from '../lib/missione.js';
import { regoleUfficio } from './controlli.js';
import { raggruppaPerVoce, csvRendiconto, nomeVoce } from '../lib/rendiconto.js';
import { estraiDati } from '../lib/datichiave.js';
import { looksLikeP7m, openP7m, overallStatus } from '../lib/cades.js';
import { pageText } from '../lib/textsearch.js';
import { openPdfJs } from '../../../core/pdf.js';
import { chooseFiles, chooseFolder, writeOut, isDesktop, destroyPdf, call } from '../native.js';
import { elencoFile, bloccaDrop } from './elenco.js';
import { preparaImmagine, aggiungiPaginaImmagine, immagineComePdf, isImmagine, ESTENSIONI_IMMAGINI } from './immagini.js';

const MB = 1024 * 1024;
const isPdfName = (n) => /\.pdf$/i.test(n);
const isP7mName = (n) => /\.p7m$/i.test(n);
const mb = (n) => (n / MB).toFixed(1).replace('.', ',') + ' MB';

async function leggiComePdf(app, it) {
  let bytes = await it.read();
  if (isP7mName(it.name) || looksLikeP7m(bytes)) { const r = await openP7m(bytes, { verify: false }); if (r.kind !== 'pdf') throw new Error('il file firmato non contiene un PDF'); bytes = r.content; }
  if (isImmagine(it.name, bytes) && !new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) bytes = await immagineComePdf(app, bytes, it.name, { rot: it.rot || 0 });
  return bytes;
}
const apertiComeItem = (app) => app.docs.map((d) => ({ name: d.name, rel: d.name, path: d.path, size: d.bytes.length, read: () => app.currentBytes(d) }));

// ---------------------------------------------------------------- pratica di missione
export function praticaMissione(app, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'Pratica di missione', subtitle: 'Modulo e giustificativi (PDF, foto JPG o HEIC, scansioni) in un solo PDF, ordinato, raddrizzato e sotto la dimensione massima.', id: 'missione' });
  bloccaDrop(pane.el);
  const elenco = elencoFile(app, { accetta: (n) => isPdfName(n) || ESTENSIONI_IMMAGINI.includes(n.toLowerCase().split('.').pop()), rotazione: true });
  const pers = app.services?.profiloCompleto?.().personale || {};
  const pref = app.settings.get('avanzati.missione', {});
  const cognome = h('input', { type: 'text', value: pers.cognome || pref.cognome || '', 'aria-label': 'Cognome' });
  const data = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10), 'aria-label': 'Data della missione' });
  const motivo = h('input', { type: 'text', placeholder: 'es. Convegno a Roma, 10–12 novembre', 'aria-label': 'Motivo o destinazione' });
  // soglia PEC unica in tutta l'app: servizio dell'area sicurezza, altrimenti la sua impostazione
  const pec = Number((typeof app.services?.sogliaPec === 'function' ? app.services.sogliaPec() : null) ?? app.settings.get('sic.pec.limitMB', 30)) || 30;
  const voci = [['0', 'Nessun limite'], ['5', '5 MB'], ['10', '10 MB (portali)'], [String(pec), `${pec} MB (PEC, come nelle Impostazioni)`]].filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i);
  const scelta = voci.some((x) => x[0] === String(pref.soglia)) ? String(pref.soglia) : String(pec);
  const soglia = h('select', { 'aria-label': 'Dimensione massima' }, voci.map(([v, l]) => h('option', { value: v, selected: scelta === v }, l)));
  const riepilogo = h('input', { type: 'checkbox', checked: pref.riepilogo !== false, id: 'av-m-r' });
  const ritaglia = h('input', { type: 'checkbox', checked: pref.ritaglia !== false, id: 'av-m-c' });
  const ocr = h('input', { type: 'checkbox', checked: pref.ocr !== false && !!app.services?.ocr, disabled: !app.services?.ocr, id: 'av-m-o' });
  const perSpesa = h('input', { type: 'checkbox', checked: !!pref.perSpesa, id: 'av-m-u' });
  const campo = (l, el) => h('div', { class: 'field' }, h('label', {}, l), el);
  pane.actions.append(h('button', { class: 'btn primary', onclick: () => crea() }, 'Crea la pratica'));
  pane.body.append(h('div', { class: 'av-batch' },
    h('section', { class: 'av-box', style: { gridColumn: 'span 2' } }, h('h3', {}, h('span', { class: 'av-step-n' }, '1'), 'Modulo e giustificativi, nell\'ordine giusto'),
      h('div', { class: 'av-row' },
        h('button', { class: 'btn', onclick: async () => { try { elenco.add(await chooseFiles(app, { exts: ['pdf', ...ESTENSIONI_IMMAGINI], title: 'Aggiungi modulo e giustificativi', filterName: 'PDF e foto' })); } catch (e) { app.reportError(e, 'File non aggiunti'); } } }, 'Aggiungi file…'),
        app.docs.length ? h('button', { class: 'btn', onclick: () => elenco.add(apertiComeItem(app)) }, 'Aggiungi i documenti aperti') : null),
      elenco.el,
      h('p', { class: 'av-note' }, 'Le foto vengono girate secondo l\'orientamento salvato dal telefono; con ↻ puoi girarle ancora. Il primo file di solito è il modulo di missione.')),
    h('section', { class: 'av-box' }, h('h3', {}, h('span', { class: 'av-step-n' }, '2'), 'Opzioni'),
      campo('Cognome (per il nome del file)', cognome), campo('Data della missione', data), campo('Motivo o destinazione (facoltativo)', motivo),
      campo('Dimensione massima del PDF', soglia),
      h('label', { class: 'chk', for: 'av-m-r' }, riepilogo, 'Pagina di riepilogo dei giustificativi in testa'),
      h('label', { class: 'chk', for: 'av-m-c' }, ritaglia, 'Ritaglia i margini bianchi delle foto e delle scansioni'),
      h('label', { class: 'chk', for: 'av-m-o' }, ocr, app.services?.ocr ? 'Rendi ricercabile il testo (OCR)' : 'OCR non disponibile in questa versione'),
      h('label', { class: 'chk', for: 'av-m-u' }, perSpesa, 'Anche un file per ogni spesa, da allegare in U-Web'))));

  async function crea() {
    if (!elenco.items.length) return app.ui.toast('Aggiungi prima il modulo e i giustificativi.', { kind: 'warning' });
    const max = (+soglia.value || 0) * MB;
    app.settings.set('avanzati.missione', { cognome: cognome.value, soglia: soglia.value, riepilogo: riepilogo.checked, ritaglia: ritaglia.checked, ocr: ocr.checked, perSpesa: perSpesa.checked });
    const nome = nomeMissione(cognome.value, data.value);
    const { PDFLib } = app.lib;
    const problemi = [];
    const res = await app.ui.withProgress('Pratica di missione', async (p) => {
      const out = await PDFLib.PDFDocument.create();
      const voci = [];
      for (const [i, it] of elenco.items.entries()) {
        if (p.cancelled) throw new DOMException('Annullato', 'AbortError');
        p.set(i / elenco.items.length * 0.45, `Preparazione di ${it.name} (${i + 1} di ${elenco.items.length})`);
        const start = out.getPageCount();
        try {
          const bytes = await it.read();
          if (new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
            const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
            if (src.isEncrypted) throw new Error('è protetto da password');
            for (const pg of await out.copyPages(src, src.getPageIndices())) { if (it.rot) pg.setRotation(PDFLib.degrees((pg.getRotation().angle + it.rot) % 360)); out.addPage(pg); }
            voci.push({ titolo: it.titolo, pagina: start, pagine: out.getPageCount() - start });
          } else {
            const prep = await preparaImmagine(app, bytes, it.name, { rot: it.rot || 0, ritaglia: ritaglia.checked });
            await aggiungiPaginaImmagine(out, PDFLib, prep.bytes);
            voci.push({ titolo: it.titolo, pagina: start, pagine: 1, nota: prep.ritagliata ? 'ritagliata' : '' });
          }
        } catch (e) { problemi.push(`${it.name}: ${e.message}`); }
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!out.getPageCount()) throw new Error('Nessun file è stato letto: ' + problemi.join('; '));
      if (riepilogo.checked) await aggiungiRiepilogo(out, PDFLib, voci, { titolo: 'Pratica di missione — riepilogo dei giustificativi', righe: [[cognome.value, data.value.split('-').reverse().join('/')].filter(Boolean).join(' — '), motivo.value] });
      out.setTitle(nome.replace(/\.pdf$/, '')); out.setLanguage('it-IT'); out.setCreator('Leggio');
      let bytes = await out.save({ useObjectStreams: true });
      if (ocr.checked && app.services?.ocr) {
        p.set(0.5, 'Riconoscimento del testo (OCR)…');
        try { bytes = await app.services.ocr(bytes, { deskew: true, progress: { set: (f, m) => p.set(0.5 + (f ?? 0) * 0.3, m), signal: p.signal, get cancelled() { return p.cancelled; } } }); }
        catch (e) { if (e?.name === 'AbortError') throw e; problemi.push('OCR non riuscito: ' + e.message); }
      }
      let raggiunta = true;
      if (max && bytes.length > max) {
        if (app.services?.compress) {
          p.set(0.82, `Riduzione sotto ${mb(max)}…`);
          try { const r = await app.services.compress(bytes, { maxBytes: max, signal: p.signal, onProgress: (f, m) => p.set(0.82 + (f || 0) * 0.15, m) }); if (r?.bytes && r.bytes.length < bytes.length) bytes = r.bytes; raggiunta = bytes.length <= max; }
          catch (e) { if (e?.name === 'AbortError') throw e; problemi.push('Riduzione non riuscita: ' + e.message); raggiunta = false; }
        } else raggiunta = false;
      }
      return { bytes, raggiunta, pagine: out.getPageCount() };
    });
    if (!res) return;
    if (problemi.length) app.ui.toast(`Attenzione: ${problemi.slice(0, 3).join(' — ')}`, { kind: 'warning', timeout: 12000 });
    if (max && !res.raggiunta) {
      const r = await app.ui.dialog({ title: 'Il PDF supera la dimensione massima', message: `La pratica pesa ${mb(res.bytes.length)}, più dei ${mb(max)} scelti anche dopo la riduzione. Vuoi dividerla in più parti («parte 1 di N»), ognuna sotto ${mb(max)}?`, okLabel: 'Dividi in parti', cancelLabel: 'Tieni un solo file' });
      if (r) {
        const parti = await app.ui.withProgress('Divisione in parti', async (p) => { p.set(null, 'Calcolo delle parti…'); return dividiPerDimensione(app.lib.PDFLib, res.bytes, max, { signal: p.signal }); });
        if (!parti) return;
        for (const [k, pt] of parti.entries()) await app.openBytes(pt.bytes, { name: nome.replace(/\.pdf$/, `_parte${k + 1}di${parti.length}.pdf`) });
        if (parti.some((x) => x.troppoGrande)) app.ui.toast('Una pagina da sola supera la soglia: riducila con «Riduci dimensioni file».', { kind: 'warning', timeout: 9000 });
        app.ui.toast(`Pratica divisa in ${parti.length} parti, aperte in schede: salvale con «Salva con nome».`, { kind: 'success', timeout: 8000 });
        return;
      }
    }
    if (perSpesa.checked) await giustificativiUweb(app, elenco.items, { ritaglia: ritaglia.checked, ocr: ocr.checked });
    const doc = await app.openBytes(res.bytes, { name: nome });
    if (doc) { app.ui.toast(`Pratica pronta: ${res.pagine} pagine, ${mb(res.bytes.length)}.`, { kind: 'success' }); await app.save(doc, { as: true }); }
  }
}

// ---------------------------------------------------------------- fascicolo con indice
export function fascicoloConIndice(app, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'Fascicolo con indice', subtitle: 'Unisce i documenti in un PDF con pagina indice cliccabile e segnalibri: per gare, rendicontazioni e ispezioni.', id: 'fascicolo' });
  bloccaDrop(pane.el);
  const elenco = elencoFile(app, { accetta: (n) => isPdfName(n) || isP7mName(n) || ESTENSIONI_IMMAGINI.includes(n.toLowerCase().split('.').pop()) });
  const pref = app.settings.get('avanzati.fascicolo', {});
  const titolo = h('input', { type: 'text', value: pref.titolo || 'Fascicolo', 'aria-label': 'Titolo del fascicolo' });
  const sotto = h('input', { type: 'text', placeholder: 'es. Procedura di gara n. 12/2026 — CIG …', 'aria-label': 'Descrizione' });
  const etich = h('input', { type: 'checkbox', checked: pref.etichetta !== false, id: 'av-f-e' });
  const numeri = h('input', { type: 'checkbox', checked: !!pref.numeri, id: 'av-f-n' });
  const campo = (l, el) => h('div', { class: 'field' }, h('label', {}, l), el);
  pane.actions.append(h('button', { class: 'btn primary', onclick: () => crea() }, 'Crea il fascicolo'));
  pane.body.append(h('div', { class: 'av-batch' },
    h('section', { class: 'av-box', style: { gridColumn: 'span 2' } }, h('h3', {}, h('span', { class: 'av-step-n' }, '1'), 'Documenti (il titolo diventa la voce dell\'indice)'),
      h('div', { class: 'av-row' },
        h('button', { class: 'btn', onclick: async () => { try { elenco.add(await chooseFiles(app, { exts: ['pdf', 'p7m', ...ESTENSIONI_IMMAGINI], title: 'Aggiungi documenti' })); } catch (e) { app.reportError(e, 'File non aggiunti'); } } }, 'Aggiungi file…'),
        h('button', { class: 'btn', onclick: async () => { try { const r = await chooseFolder(app, { exts: ['pdf', 'p7m'], title: 'Cartella dei documenti' }); if (r) elenco.add(r.items); } catch (e) { app.reportError(e, 'Cartella non leggibile'); } } }, 'Aggiungi una cartella…'),
        app.docs.length ? h('button', { class: 'btn', onclick: () => elenco.add(apertiComeItem(app)) }, 'Aggiungi i documenti aperti') : null),
      elenco.el, h('p', { class: 'av-note' }, 'I file firmati .p7m vengono aperti e uniti con il PDF che contengono.')),
    h('section', { class: 'av-box' }, h('h3', {}, h('span', { class: 'av-step-n' }, '2'), 'Opzioni'),
      campo('Titolo', titolo), campo('Descrizione (facoltativa)', sotto),
      h('label', { class: 'chk', for: 'av-f-e' }, etich, 'Scrivi «Allegato n.» sulla prima pagina di ogni documento'),
      h('label', { class: 'chk', for: 'av-f-n' }, numeri, 'Numera tutte le pagine («Pagina 1 di N»)'))));

  async function crea() {
    if (elenco.items.length < 1) return app.ui.toast('Aggiungi almeno un documento.', { kind: 'warning' });
    app.settings.set('avanzati.fascicolo', { titolo: titolo.value, etichetta: etich.checked, numeri: numeri.checked });
    // 1) lettura: firme dei .p7m (per l'indice) e DURC scaduti (avviso prima di unire)
    const letti = await app.ui.withProgress('Lettura dei documenti', async (p) => {
      const docs = []; const durc = [];
      for (const [i, it] of elenco.items.entries()) {
        if (p.cancelled) throw new DOMException('Annullato', 'AbortError');
        p.set(i / elenco.items.length, `Lettura di ${it.name}`);
        try {
          const raw = await it.read();
          let titoloVoce = it.titolo;
          if (isP7mName(it.name) || looksLikeP7m(raw)) {
            const r = await openP7m(raw).catch(() => null);
            if (r) { const nomi = r.levels.flatMap((l) => l.signers.map((x) => x.name)); const st = overallStatus(r); if (nomi.length) titoloVoce += ` (firmato digitalmente da ${nomi.join(', ')}${st === 'invalid' ? ' — firma NON valida' : st === 'warning' ? ' — firma da controllare' : ''})`; }
          }
          const bytes = await leggiComePdf(app, { ...it, read: async () => raw });
          let pdf;
          try { ({ pdf } = await openPdfJs(bytes)); let t = ''; for (let k = 1; k <= Math.min(2, pdf.numPages); k++) { const pg = await pdf.getPage(k); t += pageText((await pg.getTextContent()).items) + '\n'; } const d = estraiDati(t, { durataDurc: Number(app.settings.get('avanzati.durc.giorni', 120)) || 120 }); if (d.durc?.scaduto) durc.push({ titolo: it.titolo, scadenza: d.durc.scadenza }); }
          catch { /* testo non leggibile: nessun controllo */ } finally { destroyPdf(pdf); }
          docs.push({ titolo: titoloVoce, bytes });
        } catch (e) { docs.push({ titolo: it.titolo, bytes: new Uint8Array(0), errore: e.message }); }
      }
      return { docs, durc };
    });
    if (!letti) return;
    if (letti.durc.length) {
      const ok = await app.ui.confirm(`Attenzione: ${letti.durc.length === 1 ? 'c\'è un DURC scaduto' : `ci sono ${letti.durc.length} DURC scaduti`}: ${letti.durc.map((d) => `«${d.titolo}» (scaduto il ${d.scadenza.split('-').reverse().join('/')})`).join('; ')}. Vuoi comunque creare il fascicolo?`, { title: 'DURC scaduto', okLabel: 'Crea comunque' });
      if (!ok) return;
    }
    const res = await app.ui.withProgress('Creazione del fascicolo', async (p) => {
      const docs = letti.docs;
      const r = await creaFascicolo(app.lib.PDFLib, docs, { titolo: titolo.value, sottotitolo: sotto.value, etichetta: etich.checked ? 'Allegato' : '', numeriPagina: numeri.checked, signal: p.signal, onProgress: (f, m) => p.set(f * 0.95, m) });
      return { ...r, bytes: await app.lib.savePdfLib(r.pdfDoc) };
    });
    if (!res) return;
    if (res.saltati.length) app.ui.toast(`Non inseriti: ${res.saltati.map((s) => `${s.titolo} (${s.motivo})`).join('; ')}`, { kind: 'warning', timeout: 12000 });
    const doc = await app.openBytes(res.bytes, { name: (titolo.value || 'Fascicolo').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf' });
    if (doc) app.ui.toast(`Fascicolo creato: ${res.voci.length} documenti, ${doc.pageCount} pagine.`, { kind: 'success' });
  }
}

// ---------------------------------------------------------------- pacchetto per la rendicontazione
export function pacchettoRendicontazione(app, deps) {
  const { h } = app.ui;
  const pane = deps.openPane(app, { title: 'Pacchetto per la rendicontazione', subtitle: 'Da una cartella con una sottocartella per ogni voce di spesa: un PDF per voce, con gli allegati numerati, e un riepilogo per Excel.', id: 'rendiconto' });
  bloccaDrop(pane.el);
  const state = { folder: null, label: '', gruppi: [] };
  const info = h('div', {});
  const importi = h('input', { type: 'checkbox', checked: true, id: 'av-r-i' });
  const numeri = h('input', { type: 'checkbox', checked: true, id: 'av-r-n' });
  const avvia = h('button', { class: 'btn primary', disabled: true, onclick: () => crea() }, 'Crea il pacchetto');
  pane.actions.append(avvia);
  pane.body.append(h('div', { class: 'av-narrow' },
    h('div', { class: 'av-row' }, h('button', { class: 'btn', onclick: () => scegli() }, 'Scegli la cartella dei giustificativi…')),
    h('p', { class: 'av-note' }, 'Esempio: «Rendicontazione PNRR» con dentro le cartelle «Missioni», «Materiali», «Personale». I file sciolti finiscono in «Senza voce». Formati: PDF, .p7m, foto JPG/PNG/HEIC.'),
    h('label', { class: 'chk', for: 'av-r-i' }, importi, 'Rileva date e importi dai documenti per il riepilogo (da verificare)'),
    h('label', { class: 'chk', for: 'av-r-n' }, numeri, 'Numera le pagine di ogni PDF'),
    info));
  async function scegli() {
    try {
      const r = await chooseFolder(app, { exts: ['pdf', 'p7m', ...ESTENSIONI_IMMAGINI], recursive: true, skipDirs: ['Rendicontazione'], title: 'Cartella dei giustificativi' });
      if (!r) return;
      state.folder = r.folder; state.label = r.label; state.gruppi = raggruppaPerVoce(r.items);
      info.innerHTML = '';
      info.append(h('div', { class: 'av-box' }, h('h3', {}, `${r.items.length} giustificativi in ${state.gruppi.length} voci`),
        h('ul', { class: 'av-list' }, state.gruppi.map((g) => h('li', {}, h('strong', {}, g.voce), ` — ${g.files.length} file`)))));
      avvia.disabled = !r.items.length;
    } catch (e) { app.reportError(e, 'Cartella non leggibile'); }
  }
  async function crea() {
    const righe = []; const prodotti = []; const problemi = [];
    const tot = state.gruppi.reduce((s, g) => s + g.files.length, 0); let fatti = 0;
    const ok = await app.ui.withProgress('Pacchetto per la rendicontazione', async (p) => {
      for (const g of state.gruppi) {
        const docs = [];
        for (const it of g.files) {
          if (p.cancelled) throw new DOMException('Annullato', 'AbortError');
          p.set(fatti++ / tot * 0.9, `${g.voce}: ${it.name}`);
          let bytes = null; let dati = null;
          try {
            bytes = await leggiComePdf(app, it);
            if (importi.checked) {
              let pdf;
              try { ({ pdf } = await openPdfJs(bytes)); let t = ''; for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) { const pg = await pdf.getPage(i); t += pageText((await pg.getTextContent()).items) + '\n'; } dati = estraiDati(t); }
              catch { dati = null; } finally { destroyPdf(pdf); }
            }
          } catch (e) { problemi.push(`${it.rel}: ${e.message}`); }
          docs.push({ titolo: it.name.replace(/\.[^.]+$/, ''), bytes: bytes || new Uint8Array(0), it, dati });
        }
        const r = await creaFascicolo(app.lib.PDFLib, docs, { titolo: `Voce di spesa: ${g.voce}`, sottotitolo: state.label, etichetta: 'Allegato', numeriPagina: numeri.checked });
        const bytes = await app.lib.savePdfLib(r.pdfDoc);
        const nome = `Voce_${nomeVoce(g.voce)}.pdf`;
        prodotti.push({ nome, bytes });
        const okDocs = docs.filter((d) => !r.saltati.some((s) => s.titolo === d.titolo) && d.bytes.length);
        r.voci.forEach((v, k) => {
          const d = okDocs[k]; const dt = d?.dati;
          righe.push({ voce: g.voce, n: v.n, file: d?.it.rel || v.titolo, pagine: v.pagine, paginaNelPdf: v.pagina, data: dt?.date?.[0]?.valore || '', importo: dt?.totale ?? null, cig: dt?.cig?.map((x) => x.valore).join(' ') || '', cup: dt?.cup?.map((x) => x.valore).join(' ') || '' });
        });
        for (const s of r.saltati) righe.push({ voce: g.voce, n: '', file: s.titolo, nota: `NON INSERITO: ${s.motivo}` });
      }
      p.set(0.95, 'Salvataggio…');
      const csv = new TextEncoder().encode(csvRendiconto(righe));
      const salvati = [];
      for (const f of [...prodotti, { nome: 'Riepilogo_rendicontazione.csv', bytes: csv }]) salvati.push(await writeOut(app, state.folder, { sub: 'Rendicontazione', name: f.nome, bytes: f.bytes }));
      return salvati;
    });
    if (!ok) return;
    if (problemi.length) app.ui.toast(`File non inseriti: ${problemi.slice(0, 3).join('; ')}${problemi.length > 3 ? '…' : ''}`, { kind: 'warning', timeout: 12000 });
    app.ui.dialog({ title: 'Pacchetto creato', message: `${prodotti.length} PDF (uno per voce) e il riepilogo «Riepilogo_rendicontazione.csv»${isDesktop() && state.folder ? ' nella sottocartella «Rendicontazione»' : ' scaricati'}. Gli importi rilevati automaticamente vanno verificati.`, okLabel: isDesktop() && state.folder ? 'Mostra nella cartella' : 'Chiudi', cancelLabel: isDesktop() && state.folder ? 'Chiudi' : null })
      .then((r) => { if (r && isDesktop() && ok[0]) app.platform.showInFolder(ok[0]); });
  }
}

// ---------------------------------------------------------------- giustificativi per U-Web (dentro la Pratica di missione)
/**
 * Un file per ogni spesa, con nome «nn_data_tipo_importo.pdf» e il tipo di allegato proposto per U-Web.
 * Leggio propone soltanto: tipo, importo e pagamento vanno confermati in U-Web; il rimborso lo calcola U-Web.
 */
async function giustificativiUweb(app, items, { ritaglia, ocr }) {
  const { h } = app.ui;
  const R = regoleUfficio(app);
  let dest = null;
  if (isDesktop()) { try { dest = await call(app, 'choose-folder', { title: 'Dove salvare i giustificativi per U-Web' }); } catch { dest = null; } if (!dest) return; }
  const righe = await app.ui.withProgress('Giustificativi per U-Web', async (p) => {
    const out = []; let n = 0;
    for (const [i, it] of items.entries()) {
      if (p.cancelled) throw new DOMException('Annullato', 'AbortError');
      p.set(i / items.length, `Lettura di ${it.name}`);
      try {
        const raw = await it.read();
        const isPdf = new TextDecoder('latin1').decode(raw.subarray(0, 1024)).includes('%PDF-');
        let bytes = isPdf ? raw : await immagineComePdf(app, raw, it.name, { rot: it.rot || 0, ritaglia });
        let testo = await testoPdf(bytes);
        if (!testo.trim() && ocr && app.services?.ocr) { bytes = await app.services.ocr(bytes, { progress: { set() {}, signal: p.signal, get cancelled() { return p.cancelled; } } }); testo = await testoPdf(bytes); }
        const c = classificaGiustificativo(testo, { regolePagamenti: R.pagamentiTracciabili });
        // il modulo di missione (PDF di più pagine senza importo) non è un giustificativo
        if (isPdf && c.importo == null && /missione|autorizzazione|richiesta/i.test(testo)) { out.push({ it, saltato: 'sembra il modulo di missione' }); continue; }
        n++;
        const nome = nomeGiustificativo(c, n);
        const dove = await writeOut(app, dest, { sub: 'Giustificativi U-Web', name: nome, bytes });
        out.push({ it, c, nome, dove });
      } catch (e) { if (e?.name === 'AbortError') throw e; out.push({ it, saltato: e.message }); }
    }
    return out;
  });
  if (!righe) return;
  const contanti = righe.filter((r) => r.c?.contantiDaSegnalare);
  const euro = (v) => (v == null ? '?' : v.toFixed(2).replace('.', ',') + ' €');
  await app.ui.dialog({ title: 'Giustificativi per U-Web', width: 720, okLabel: 'Chiudi', cancelLabel: null, body: h('div', {},
    h('p', {}, `${righe.filter((r) => r.c).length} file pronti${dest ? ' nella cartella «Giustificativi U-Web»' : ''}. Controlla tipo, data e importo prima di inserirli in U-Web: il rimborso lo calcola U-Web.`),
    contanti.length ? h('div', { class: 'av-controllo avviso' }, h('p', {}, `${contanti.length === 1 ? 'Una spesa sembra pagata' : contanti.length + ' spese sembrano pagate'} in contanti: in U-Web va spuntato «Pagamento non tracciabile».`), h('p', { class: 'av-note' }, 'Fonte: ' + R.pagamentiTracciabili.fonte)) : null,
    h('table', { class: 'av-tabella' }, h('tr', {}, ...['File', 'Spesa', 'Data', 'Importo', 'Pagamento', 'Tipo di allegato'].map((x) => h('th', {}, x))),
      righe.map((r) => r.c ? h('tr', {}, h('td', {}, r.nome), h('td', {}, r.c.tipoSpesa), h('td', {}, r.c.data ? r.c.data.split('-').reverse().join('/') : '?'), h('td', {}, euro(r.c.importo)), h('td', { class: r.c.contantiDaSegnalare ? 'av-ko' : '' }, r.c.pagamento), h('td', {}, r.c.tipoAllegato))
        : h('tr', {}, h('td', {}, r.it.name), h('td', { colspan: 5, class: 'av-note' }, `non preparato: ${r.saltato}`)))),
    dest && isDesktop() ? h('button', { class: 'btn', onclick: () => app.platform.showInFolder(righe.find((r) => r.dove)?.dove || dest) }, 'Mostra la cartella') : null) });
}

async function testoPdf(bytes) {
  let pdf;
  try { ({ pdf } = await openPdfJs(bytes)); let t = ''; for (let i = 1; i <= Math.min(2, pdf.numPages); i++) { const pg = await pdf.getPage(i); t += pageText((await pg.getTextContent()).items) + '\n'; } return t; }
  catch { return ''; } finally { destroyPdf(pdf); }
}
