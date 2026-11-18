// Riquadro unico «Controlli» sul documento aperto. Parla solo se c'è qualcosa da dire: avvisi brevi, ognuno con
// un'azione concreta, e in fondo un'unica sezione «Dati da copiare» (Titulus, U-GOV, ordine). Nessuno strumento nuovo.
// Le regole che cambiano nel tempo vengono da dati/regole-ufficio.json (fonte e data visibili), aggiornabile dall'ufficio.
import { regole as regoleDa, dataLocaleDaMs, validaRegole, controlliFattura, controlliContratto, riconosciOrdine, abbinaFatturaOrdini, datiPerUgov } from '../lib/controlli.js';
import { estraiDati } from '../lib/datichiave.js';
import { analizza } from '../lib/rinomina.js';
import { datiPerTitulus, testoDatiTitulus } from '../lib/titulus.js';
import { pageText } from '../lib/textsearch.js';
import { percorsoOriginale } from './datititulus.js';
import { isDesktop } from '../native.js';
import { sezioniFattura } from './fattura.js';

const KEY_REGOLE = 'avanzati.regole';
const KEY_RICEZIONE = 'avanzati.sdi.ricezione'; // { chiave fattura: 'aaaa-mm-gg' }
const MAX_PAGINE = 6;

export const regoleUfficio = (app) => regoleDa(app.settings.get(KEY_REGOLE, null));

async function testoDoc(doc) {
  if (doc.data.testoControlli?.bytes === doc.bytes) return doc.data.testoControlli.testo;
  let t = '';
  for (let i = 1; i <= Math.min(MAX_PAGINE, doc.pageCount); i++) { const p = await doc.pdf.getPage(i); t += pageText((await p.getTextContent()).items) + '\n'; p.cleanup(); }
  doc.data.testoControlli = { bytes: doc.bytes, testo: t };
  return t;
}
async function copia(app, t) {
  try { await navigator.clipboard.writeText(t); app.ui.toast(`Copiato: ${t.length > 50 ? t.slice(0, 50) + '…' : t}`, { kind: 'success', timeout: 2500 }); }
  catch { app.ui.toast('Impossibile copiare negli appunti.', { kind: 'error' }); }
}
const chiaveFattura = (doc) => { const f = doc.data.fattura; return f ? (f.xmlPath || `${f.f.cedente?.partitaIva}|${f.f.corpi[0]?.numero}|${f.f.corpi[0]?.data}`) : null; };

/** Ordini e determine dell'archivio collegabili alla fattura (per CIG e per P.IVA). Servizio dell'area archivio. */
async function ordiniDallArchivio(app, f) {
  const A = app.archivio;
  if (!A?.cerca || !A?.documento) return null;
  const c = f.corpi[0]; const ids = new Set();
  for (const cig of c.cig.slice(0, 3)) { const r = await A.cerca({ cigcup: cig, limite: 20 }).catch(() => null); for (const x of r?.righe || []) ids.add(x.id); }
  const piva = String(f.cedente?.partitaIva || '').replace(/^IT/i, '');
  if (piva) { const r = await A.cerca({ fornitore: piva, tipo: 'ordine', limite: 20 }).catch(() => null); for (const x of r?.righe || []) ids.add(x.id); }
  const out = [];
  for (const id of [...ids].slice(0, 25)) {
    const d = await A.documento(id).catch(() => null);
    if (!d?.testo || d.tipo === 'fattura') continue;
    const o = riconosciOrdine(d.testo);
    if (o) out.push({ id, nome: d.nome, path: d.path, ...o });
  }
  return out;
}

/**
 * Dall'indice dell'archivio: data di ricezione SdI (letta dai metadati) o data del file come stima, IBAN delle fatture
 * precedenti dello stesso fornitore, CUP presenti nella pratica (stesso CIG). Servizio preferito: app.services.ibanFornitore.
 */
async function datiArchivio(app, doc, f) {
  const out = { ricezione: null, fonte: null, ibanNoti: [], cupPratica: false };
  const A = app.archivio;
  const path = percorsoOriginale(doc);
  const piva = String(f.cedente?.partitaIva || '').replace(/^IT/i, '');
  if (A?.cerca && piva) {
    const r = await A.cerca({ fornitore: piva, tipo: 'fattura', limite: 60 }).catch(() => null);
    for (const x of r?.righe || []) {
      if (path && x.path === path) {
        if (x.ricezione) { out.ricezione = String(x.ricezione).slice(0, 10); out.fonte = 'metadati'; }
        else if (x.mtime) { out.ricezione = dataLocaleDaMs(+x.mtime) || null; out.fonte = out.ricezione ? 'stima' : null; }
        continue;
      }
      if (x.iban) out.ibanNoti.push({ iban: x.iban, numero: x.numero, data: x.data });
    }
  }
  if (typeof app.services?.ibanFornitore === 'function' && piva) { try { const l = await app.services.ibanFornitore(piva, { escludi: path }); if (Array.isArray(l)) out.ibanNoti = l; } catch {} }
  const cig = f.corpi[0]?.cig[0];
  if (A?.cerca && cig) { const r = await A.cerca({ cigcup: cig, limite: 30 }).catch(() => null); out.cupPratica = (r?.righe || []).some((x) => x.path !== path && x.cup?.length); }
  return out;
}

async function apriDallArchivio(app, idOPath) {
  const A = app.archivio;
  try {
    const d = A ? await A.documento(idOPath).catch(() => null) : null;
    const path = d?.path || idOPath;
    if (typeof app.openPath === 'function' && /\.pdf$/i.test(path)) return app.openPath(path, { readOnly: true });
    const bytes = await A.leggiBytes(path);
    return app.openFile({ path, name: d?.nome || String(path).split(/[\\/]/).pop(), bytes }, { readOnly: true });
  } catch (e) { app.reportError(e, 'Documento non aperto'); }
}
async function cerca(app, q) {
  if (typeof app.services?.apriArchivio === 'function') return app.services.apriArchivio({ q });
  await copia(app, q);
  if (app.tools.get('archivio')) { app.tools.run('archivio'); app.ui.toast('Incolla nella ricerca dell\'archivio.', { timeout: 6000 }); }
}

export function registerControlli(app) {
  app.registerPanel({
    id: 'controlli', title: 'Controlli', icon: 'checklist', order: 61,
    render(c) {
      const { h } = app.ui;
      const doc = app.activeDoc;
      const wrap = h('div', { class: 'pad av-side' }, h('p', { class: 'av-note' }, 'Controllo del documento…'));
      c.append(wrap);
      let vivo = true;
      const ridisegna = () => { if (app.activeDoc === doc) app.sidebar.show('controlli'); };
      (async () => {
        const R = regoleUfficio(app);
        const avvisi = []; const gruppi = [];
        let testo = '';
        try {
          if (doc.data.fattura) {
            const f = doc.data.fattura.f;
            const indicata = (app.settings.get(KEY_RICEZIONE, {}) || {})[chiaveFattura(doc)] || null;
            const da = await datiArchivio(app, doc, f).catch(() => ({ ibanNoti: [] }));
            if (!vivo) return;
            const ordini = await ordiniDallArchivio(app, f);
            const ab = ordini ? abbinaFatturaOrdini(f, ordini) : null;
            // CUP dovuto: regola dell'ufficio, CUP nell'ordine abbinato o nella pratica, oppure fattura su un progetto
            const c0 = f.corpi[0];
            const cupDovuto = app.settings.get('avanzati.cup.sempre', false) === true || !!ab?.abbinati[0]?.ordine.cup?.length || !!da.cupPratica
              || /\b(PNRR|progetto di investimento|NextGenerationEU)\b/i.test([...c0.causali, ...c0.linee.map((l) => l.descrizione)].join(' '));
            avvisi.push(...controlliFattura(f, { dataRicezione: indicata || da.ricezione, fonteRicezione: indicata ? 'indicata' : da.fonte, cupDovuto, ibanNoti: da.ibanNoti, regole: R }));
            if (doc.data.fattura.firma?.stato === 'invalid') avvisi.unshift({ id: 'firma', livello: 'avviso', testo: 'La firma del file .p7m non è valida.', aiuto: 'Verifica CAdES fatta da Leggio senza rete.' });
            if (ab) {
              avvisi.push(...ab.avvisi);
              const o = ab.abbinati[0]?.ordine;
              if (o) gruppi.push({ titolo: `Ordine abbinato (${ab.abbinati[0].motivi.join(', ')})`, campi: [['Documento', o.nome], ['Tipo', o.tipo], ['Numero', o.numero], ['CIG', o.cig.join(', ')], ['Importo', o.importo != null ? o.importo.toFixed(2).replace('.', ',') : '']].filter((x) => x[1]).map(([etichetta, valore]) => ({ etichetta, valore })), apri: o.id });
            }
            gruppi.unshift({ titolo: 'Per U-GOV', campi: datiPerUgov({ fattura: f }) });
            gruppi.unshift({ titolo: 'Per Titulus', campi: datiPerTitulus({ fattura: f, firma: doc.data.fattura.firma }) });
          } else {
            testo = await testoDoc(doc);
            if (!vivo) return;
            if (!testo.trim()) {
              if (app.tools.get('ocr')) avvisi.push({ id: 'scansione', livello: 'info', testo: 'Il documento è una scansione senza testo: i controlli non possono leggerlo.', azione: { tipo: 'strumento', etichetta: 'Rendi ricercabile', valore: 'ocr' } });
            } else {
              const d = estraiDati(testo, { durataDurc: R.durc.giorniValidita });
              const an = analizza(testo, doc.name);
              if (d.durc?.scaduto) avvisi.push({ id: 'durc-scaduto', livello: 'avviso', testo: `DURC scaduto il ${d.durc.scadenza.split('-').reverse().join('/')}.`, aiuto: R.durc.fonte, azione: { tipo: 'cerca', etichetta: 'Cerca un DURC più recente', valore: `DURC ${an.soggetto || ''}`.trim() } });
              else if (d.durc?.giorniResidui != null && d.durc.giorniResidui <= 15) avvisi.push({ id: 'durc-in-scadenza', livello: 'info', testo: `Il DURC scade tra ${d.durc.giorniResidui} giorni.`, aiuto: R.durc.fonte });
              // contratti: bollo (All. I.4) e ricevuta F24 nella pratica (stesso CIG nell'archivio)
              let testiPratica = [];
              if (app.archivio?.cerca && d.cig[0]) {
                const r = await app.archivio.cerca({ cigcup: d.cig[0].valore, limite: 30 }).catch(() => null);
                for (const x of (r?.righe || []).slice(0, 20)) { const dd = await app.archivio.documento(x.id).catch(() => null); if (dd?.testo && dd.path !== doc.path) testiPratica.push(dd.testo); }
              }
              const imp = doc.data.importoContratto;
              avvisi.push(...controlliContratto(imp ? `${testo}\nimporto massimo del contratto € ${imp.toFixed(2).replace('.', ',')}` : testo, { testiPratica, regole: R }));
              const o = riconosciOrdine(testo);
              if (o && (!an.tipo || an.tipo === 'Documento' || an.tipo === 'Ordine')) { an.tipo = o.tipo; if (o.numero) an.numero = o.numero; if (!an.soggetto && o.fornitore) an.soggetto = o.fornitore; }
              gruppi.push({ titolo: 'Per Titulus', campi: datiPerTitulus({ dati: d, analisi: an, firma: doc.data.p7m, nomeFile: doc.name }) });
              gruppi.push({ titolo: 'Per U-GOV', campi: datiPerUgov({ testo }) });
              if (o) gruppi.push({ titolo: o.tipo, campi: [['Numero', o.numero], ['CIG', o.cig.join(', ')], ['CUP', o.cup.join(', ')], ['Importo', o.importo != null ? o.importo.toFixed(2).replace('.', ',') : ''], ['Fornitore', o.fornitore], ['P.IVA', o.piva.join(', ')]].filter((x) => x[1]).map(([etichetta, valore]) => ({ etichetta, valore })) });
            }
          }
          if (doc.data.p7m?.stato === 'invalid' && !doc.data.fattura) avvisi.unshift({ id: 'firma', livello: 'avviso', testo: 'La firma del file .p7m non è valida.', azione: { tipo: 'pannello', etichetta: 'Vedi le firme', valore: 'p7m' } });
          const s = doc.data.segnaturaTitulus;
          if (s) avvisi.push({ id: 'protocollato', livello: 'info', testo: `Protocollato in Titulus: n. ${s.numero} del ${s.data.split('-').reverse().join('/')}.` });
        } catch (err) { console.error('[controlli]', err); }
        if (!vivo) return;
        const fatt = doc.data.fattura && app.avanzati ? sezioniFattura(app, doc, app.avanzati) : null;
        wrap.replaceChildren(...[
          sezioneAvvisi(app, avvisi, doc, ridisegna),
          sezioneDati(app, gruppi),
          ...(fatt?.extra || []),
          fatt?.pulsanti,
          sezioneFonti(app, R, ridisegna),
        ].filter(Boolean));
      })();
      return () => { vivo = false; };
    },
  });
}

function sezioneAvvisi(app, avvisi, doc, ridisegna) {
  const { h } = app.ui;
  if (!avvisi.length) return h('p', { class: 'av-ok' }, 'Nessun controllo da segnalare.');
  avvisi.sort((a, b) => (a.livello === 'avviso' ? 0 : 1) - (b.livello === 'avviso' ? 0 : 1));
  return h('div', { class: 'av-controlli' }, avvisi.map((a) => {
    const perche = a.aiuto ? h('p', { class: 'av-note av-perche', hidden: true }, a.aiuto) : null;
    const riga = h('div', { class: 'av-row' });
    if (a.azione?.tipo === 'data-ricezione') {
      // correzione in linea, senza finestre
      const inp = h('input', { type: 'date', class: 'av-input', value: a.azione.valore || '', 'aria-label': 'Data di ricezione dallo SdI', hidden: true });
      const ok = h('button', { class: 'btn small', hidden: true, onclick: () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) return; const k = chiaveFattura(doc); app.settings.set(KEY_RICEZIONE, { ...(app.settings.get(KEY_RICEZIONE, {}) || {}), [k]: inp.value }); ridisegna(); } }, 'Salva');
      riga.append(h('button', { class: 'btn small', onclick: (e) => { e.target.hidden = true; inp.hidden = false; ok.hidden = false; inp.focus(); } }, a.azione.etichetta), inp, ok);
    } else if (a.azione) riga.append(h('button', { class: 'btn small', onclick: () => azione(app, a.azione, doc, ridisegna) }, a.azione.etichetta));
    if (perche) riga.append(h('button', { class: 'av-link', 'aria-expanded': 'false', onclick: (e) => { perche.hidden = !perche.hidden; e.target.setAttribute('aria-expanded', String(!perche.hidden)); } }, 'Perché?'));
    return h('div', { class: 'av-controllo ' + (a.livello === 'avviso' ? 'avviso' : 'info') }, h('p', {}, a.testo), riga, perche);
  }));
}

async function azione(app, a, doc, ridisegna) {
  switch (a.tipo) {
    case 'copia': return copia(app, a.valore);
    case 'cerca': return cerca(app, a.valore);
    case 'apri': return apriDallArchivio(app, a.valore);
    case 'strumento': return app.tools.run(a.valore);
    case 'pannello': return app.sidebar.show(a.valore);
    case 'importo-contratto': {
      const v = await app.ui.dialog({ title: 'Importo massimo del contratto', message: 'Comprende opzioni e rinnovi: serve per sapere il bollo dovuto.', fields: [{ name: 'n', label: 'Importo in euro', type: 'number', min: 0, value: '' }], okLabel: 'Salva', validate: (x) => (x.n > 0 ? null : 'Scrivi un importo.') });
      if (!v) return;
      doc.data.importoContratto = Number(v.n); return ridisegna();
    }
    default: return undefined;
  }
}

function sezioneDati(app, gruppi) {
  const { h } = app.ui;
  const pieni = gruppi.filter((g) => g.campi?.length);
  if (!pieni.length) return null;
  return h('div', { class: 'av-box' }, h('h3', {}, 'Dati da copiare'),
    ...pieni.map((g, i) => h('details', { class: 'av-gruppo', open: i === 0 },
      h('summary', {}, g.titolo),
      h('div', { class: 'av-row' },
        h('button', { class: 'btn small', onclick: () => copia(app, testoDatiTitulus(g.campi)) }, 'Copia tutto'),
        g.apri ? h('button', { class: 'btn small', onclick: () => apriDallArchivio(app, g.apri) }, 'Apri') : null),
      h('dl', { class: 'av-copia' }, g.campi.flatMap((x) => [h('dt', {}, x.etichetta),
        h('dd', {}, h('span', {}, x.valore), h('button', { class: 'btn small', 'aria-label': `Copia ${x.etichetta}`, onclick: () => copia(app, x.valore) }, 'Copia'))])))));
}

function sezioneFonti(app, R, ridisegna) {
  const { h } = app.ui;
  const voci = Object.entries(R).filter(([, v]) => v && typeof v === 'object' && v.fonte);
  return h('details', { class: 'av-fonti' }, h('summary', {}, `Regole aggiornate al ${String(R.versione).split('-').reverse().join('/')}`),
    h('ul', { class: 'av-list' }, voci.map(([, v]) => h('li', {}, h('small', {}, `${v.fonte} (controllata il ${String(v.aggiornato).split('-').reverse().join('/')})`)))),
    h('p', { class: 'av-note' }, 'Leggio segnala soltanto: accettare o rifiutare una fattura si fa in U-GOV.'),
    h('button', { class: 'btn small', onclick: async () => {
      const files = await app.platform.openFiles({ multiple: false, raw: true, title: 'File delle regole aggiornato', filters: [{ name: 'Regole (JSON)', extensions: ['json'] }] });
      const f = files?.[0]; if (!f) return;
      let x; try { x = JSON.parse(new TextDecoder().decode(f.bytes)); } catch { return app.ui.toast('Il file non è leggibile.', { kind: 'error' }); }
      const err = validaRegole(x); if (err) return app.ui.toast(err, { kind: 'error' });
      app.settings.set(KEY_REGOLE, x); app.ui.toast('Regole aggiornate.', { kind: 'success' }); ridisegna();
    } }, 'Aggiorna le regole da un file…'),
    isDesktop() ? null : null);
}

export { percorsoOriginale };
