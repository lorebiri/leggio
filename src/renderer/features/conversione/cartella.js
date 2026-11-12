// «Rendi ricercabile una cartella»: OCR in blocco su centinaia o migliaia di PDF.
// Worker riusati tra un file e l'altro, un file alla volta in memoria, avanzamento complessivo con stima,
// annullabile; un registro nella cartella di destinazione permette di riprendere senza rifare i file finiti.
import { creaPoolOcr, LINGUE_OCR } from './ocr.js';
import { ocrSuBytes } from './ocr-ui.js';
import { leggiRegistro, daFare, segna, riepilogo, percorsoUscita, nuovoRegistro } from './lib/registro.js';
import { stimaTempo } from './lib/ocr-layout.js';
import { messaggioErrore } from './comune.js';

export const NOME_REGISTRO = '.leggio-ocr.json';
const SOTTOCARTELLA = 'Ricercabili';

/** Accesso ai file tramite il processo main (solo nell'app desktop). */
export function ioNativo(app) {
  const f = (canale, ...a) => app.platform.invokeFeature('conversione:' + canale, ...a);
  return {
    elenca: (cartella, opts) => f('elenca', { cartella, ...opts }),
    leggi: async (p) => new Uint8Array(await f('leggi', p)),
    esiste: (p) => f('esiste', p),
    scrivi: (percorso, bytes) => f('scrivi', { percorso, bytes }),
  };
}

const sepDi = (p) => (/\\/.test(p) && !/\//.test(p) ? '\\' : '/');

/**
 * Esegue l'OCR su una cartella.
 * opts: { io, cartella, destinazione, sottocartelle=true, langs, dpi=300, copiaGiaTesto=true, progress:{set,signal}, pool }
 * → { registro, riepilogo, saltatiPerchéFiniti, ms, pagine, file }
 */
export async function ocrCartella(app, opts) {
  const { io, cartella, langs = ['ita', 'eng'], dpi = 300, copiaGiaTesto = true } = opts;
  const sep = sepDi(cartella);
  const destinazione = opts.destinazione || cartella.replace(/[\\/]+$/, '') + sep + SOTTOCARTELLA;
  const progress = opts.progress || { set() {}, signal: opts.signal };
  const signal = progress.signal;
  const percorsoRegistro = destinazione + sep + NOME_REGISTRO;
  progress.set(null, 'Cerco i PDF nella cartella…');
  const elenco = await io.elenca(cartella, { sottocartelle: opts.sottocartelle !== false, escludi: [destinazione] });
  let registro;
  try { registro = (await io.esiste(percorsoRegistro)) ? leggiRegistro(await io.leggi(percorsoRegistro), { langs, dpi }) : nuovoRegistro({ langs, dpi }); }
  catch { registro = nuovoRegistro({ langs, dpi }); }
  const { fare, fatti } = daFare(elenco, registro);
  // più file in parallelo, ognuno con un proprio worker riusato: così anche i file di una sola pagina
  // tengono occupati tutti i processori (le scansioni d'ufficio sono spesso di 1–2 pagine)
  const corsie = Math.max(1, Math.min(opts.corsie || Math.min(3, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))), fare.length || 1));
  const pools = Array.from({ length: corsie }, () => creaPoolOcr({ inattivitaMs: 5000 }));
  const t0 = performance.now();
  let pagineFatte = 0; let ultimoSalvataggio = 0; let prossimo = 0; let finiti = 0;
  const salvaRegistro = async (forza) => {
    if (!forza && performance.now() - ultimoSalvataggio < 2000) return;
    ultimoSalvataggio = performance.now();
    try { await io.scrivi(percorsoRegistro, new TextEncoder().encode(JSON.stringify(registro))); } catch (e) { console.warn('[ocr cartella] registro non salvato', e); }
  };
  const testa = () => {
    const eta = stimaTempo(performance.now() - t0, finiti, fare.length);
    return `File ${Math.min(fare.length, finiti + 1)} di ${fare.length}${fatti.length ? ` (${fatti.length} già fatti in precedenza)` : ''}${eta ? ' · ' + eta : ''}`;
  };
  const corsia = async (pool) => {
    while (prossimo < fare.length) {
      if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
      const f = fare[prossimo++];
      progress.set(finiti / fare.length, `${testa()} — ${f.rel}`);
      const tf = performance.now();
      let bytes = null;
      try {
        bytes = await io.leggi(f.path);
        const report = {};
        const out = await ocrSuBytes(app, bytes, { langs, dpi, pool, report, workers: 1, progress: { signal, set() {} } });
        const dest = percorsoUscita(destinazione, f.rel, sep);
        const pagine = report.pagine?.length || 0;
        if (out === bytes) {
          if (copiaGiaTesto) await io.scrivi(dest, bytes);
          segna(registro, f, 'gia-testo', { ms: Math.round(performance.now() - tf) });
        } else {
          await io.scrivi(dest, out);
          pagineFatte += pagine;
          segna(registro, f, 'fatto', { pagine, ms: Math.round(performance.now() - tf) });
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        segna(registro, f, 'errore', { motivo: messaggioErrore(err) });
      } finally { bytes = null; }
      finiti++;
      progress.set(finiti / fare.length, `${testa()} — ${f.rel}`);
      await salvaRegistro(false);
      opts.onFile?.(f, registro.voci[f.rel]);
    }
  };
  try {
    const lavori = pools.map((p) => { const pr = corsia(p); pr.catch(() => {}); return pr; });
    await Promise.all(lavori);
  } finally {
    await salvaRegistro(true);
    await Promise.all(pools.map((p) => p.chiudi()));
  }
  return { registro, riepilogo: riepilogo(registro), saltatiPercheFiniti: fatti.length, file: fare.length, pagine: pagineFatte, ms: performance.now() - t0, destinazione, elenco: elenco.length };
}

async function avvia(app) {
  if (!window.leggio) {
    return app.ui.toast('L’OCR di una cartella intera è disponibile nell’app desktop. Qui puoi usare le Azioni guidate o aprire i file uno per volta.', { kind: 'info', timeout: 8000 });
  }
  const cartella = await app.platform.chooseFolder('Cartella con le scansioni da rendere ricercabili');
  if (!cartella) return;
  const io = ioNativo(app);
  const sep = sepDi(cartella);
  const scelte = new Set(app.settings.get('ocr.lingue', ['ita', 'eng']));
  const v = await app.ui.dialog({
    title: 'Rendi ricercabile una cartella',
    message: `Cartella: ${cartella}\nOgni PDF viene copiato, con il testo riconosciuto, nella sottocartella «${SOTTOCARTELLA}». Gli originali non vengono toccati. Puoi interrompere quando vuoi: alla ripresa i file già finiti vengono saltati.`,
    fields: [
      { name: 'langs', label: 'Lingue', type: 'custom', render(c) {
        const boxes = LINGUE_OCR.map((l) => { const cb = app.ui.h('input', { type: 'checkbox', value: l.value, checked: scelte.has(l.value) }); c.append(app.ui.h('label', { class: 'conv-check' }, cb, ' ', l.label)); return cb; });
        return { get: () => boxes.filter((b) => b.checked).map((b) => b.value) };
      } },
      { name: 'sotto', label: 'Comprendi le sottocartelle', type: 'checkbox', value: true },
      { name: 'copia', label: 'Copia anche i PDF che hanno già il testo (la cartella «Ricercabili» sarà completa)', type: 'checkbox', value: true },
      { name: 'qualita', label: 'Precisione', type: 'select', value: '300', options: [{ value: '200', label: 'Veloce' }, { value: '300', label: 'Normale (consigliata)' }, { value: '400', label: 'Massima (testi piccoli, scontrini)' }] },
    ],
    okLabel: 'Avvia', validate: (x) => (x.langs.length ? null : 'Scegli almeno una lingua.'),
  });
  if (!v) return;
  let esito;
  try {
    esito = await app.ui.withProgress('OCR della cartella', (p) => ocrCartella(app, { io, cartella, sottocartelle: v.sotto, langs: v.langs, dpi: Number(v.qualita), copiaGiaTesto: v.copia, progress: p }));
  } catch (err) { return app.reportError(new Error(messaggioErrore(err)), 'OCR della cartella non riuscito'); }
  const destinazione = cartella.replace(/[\\/]+$/, '') + sep + SOTTOCARTELLA;
  if (!esito) {
    // annullato: il registro è salvato, si può riprendere
    return app.ui.toast('Interrotto. I file già finiti sono salvati: rilancia lo strumento sulla stessa cartella per riprendere da dove eri.', { kind: 'info', timeout: 9000 });
  }
  mostraRapporto(app, esito);
}

function mostraRapporto(app, e) {
  const { h } = app.ui;
  const r = e.riepilogo;
  const c = app.openRightPanel('OCR della cartella');
  const errori = Object.entries(e.registro.voci).filter(([, v]) => v.esito === 'errore');
  const min = e.ms / 60000;
  c.append(h('div', { class: 'conv-report' },
    h('p', { class: 'conv-esito ' + (errori.length ? 'ko' : 'ok') }, `${r.fatto} PDF resi ricercabili, ${r['gia-testo']} avevano già il testo${errori.length ? `, ${errori.length} non elaborati` : ''}.`),
    h('ul', { class: 'conv-azioni' },
      h('li', {}, `File nella cartella: ${e.elenco}; elaborati ora: ${e.file}${e.saltatiPercheFiniti ? `; saltati perché già finiti: ${e.saltatiPercheFiniti}` : ''}.`),
      h('li', {}, `Pagine riconosciute ora: ${e.pagine} in ${min < 1 ? Math.round(e.ms / 1000) + ' s' : Math.round(min) + ' min'}${e.pagine ? ` (${(e.ms / 1000 / e.pagine).toFixed(1).replace('.', ',')} s a pagina)` : ''}.`),
      h('li', {}, `Risultati in: ${e.destinazione}`)),
    errori.length ? h('details', { open: true }, h('summary', {}, 'File non elaborati'), h('ul', {}, errori.slice(0, 200).map(([rel, v]) => h('li', {}, `${rel}: ${v.motivo}`)))) : null,
    h('div', { class: 'conv-btns' }, h('button', { class: 'btn', onclick: () => app.platform.showInFolder(e.destinazione) }, 'Apri la cartella dei risultati'))));
}

export function registraCartella(app) {
  /** app.services.ocrCartella({ io?, cartella, destinazione?, langs, dpi, progress }) — vedi ocrCartella */
  app.services.ocrCartella = (opts) => ocrCartella(app, { io: opts.io || ioNativo(app), ...opts });
  app.registerTool({
    id: 'ocr-folder', name: 'Rendi ricercabile una cartella (OCR)', category: 'converti', icon: 'ocr',
    description: 'Riconosce il testo di tutte le scansioni di una cartella',
    keywords: 'ocr cartella in blocco molti file scansioni archivio riconosci testo ricercabile tutti i pdf massivo',
    run: () => avvia(app),
  });
}
