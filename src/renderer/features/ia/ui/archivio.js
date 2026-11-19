// Assistente IA: «Cerca per significato nell'archivio».
// L'indice per significato si prepara in sottofondo a partire dal testo già letto dall'archivio d'ufficio
// (nessun file viene riletto dal disco), solo per i documenti nuovi o cambiati (impronta SHA-256).
import { metti } from '../lib/dom.js';
import { chiama } from '../servizio.js';
import { passaggi, pagineDaTesto } from '../lib/passaggi.js';
import { daIndicizzare, fondiRisultati } from '../lib/archivio.js';

const S = { lavoro: null, avanzamento: { fatti: 0, totale: 0 }, ascoltatori: new Set() };
const emetti = () => { for (const f of S.ascoltatori) { try { f(); } catch { /* */ } } };

async function righeArchivio(A) {
  const r = await A.cerca({ limite: 50000 });
  return r?.righe || [];
}

/** Prepara o aggiorna l'indice per significato. Una sola esecuzione alla volta, interrompibile. */
export function preparaIndice(app) {
  const A = app.archivio;
  if (S.lavoro) return S.lavoro.promise;
  const lavoro = { annullato: false };
  S.lavoro = lavoro;
  lavoro.promise = (async () => {
    const righe = await righeArchivio(A);
    const note = await chiama(app, 'indice-impronte');
    const { nuovi, vecchi } = daIndicizzare(righe, note);
    if (vecchi.length) await chiama(app, 'indice-togli', { impronte: vecchi });
    S.avanzamento = { fatti: 0, totale: nuovi.length };
    emetti();
    for (const r of nuovi) {
      if (lavoro.annullato) break;
      try {
        const d = await A.documento(r.id);
        const pz = passaggi(pagineDaTesto(d?.testo || '')).map((p) => ({ pagina: p.pagina, testo: p.testo }));
        await chiama(app, 'indice-aggiungi', { documenti: [{ impronta: r.impronta, passaggi: pz }] });
      } catch (e) {
        if (/installat/i.test(e.message)) throw e;
        app.log?.('warn', 'ia: documento non indicizzato', { nome: r.nome, errore: e.message });
      }
      S.avanzamento.fatti++;
      emetti();
    }
    return S.avanzamento;
  })().finally(() => { S.lavoro = null; emetti(); });
  return lavoro.promise;
}

export function interrompiIndice() { if (S.lavoro) S.lavoro.annullato = true; }

export async function apriRicercaArchivio(app, apriConfigura) {
  const { h } = app.ui;
  const A = app.archivio;
  if (!A) return app.ui.toast('L\'archivio d\'ufficio non è disponibile.', { kind: 'warning' });
  if (!A.attivo) {
    const ok = await app.ui.confirm('Per cercare per significato serve prima l\'archivio d\'ufficio: collega le cartelle dei documenti.', { title: 'Nessuna cartella collegata', okLabel: 'Collega una cartella…' });
    if (ok) app.tools.run('archivio-cartelle');
    return;
  }
  const q = h('input', { type: 'search', class: 'ia-q-archivio', placeholder: 'Descrivi il documento: es. «posti letto per i senzatetto d\'inverno»', 'aria-label': 'Cosa cerchi' });
  const cerca = h('button', { class: 'btn primary', type: 'button' }, 'Cerca');
  const infoIndice = h('div', { class: 'ia-indice', role: 'status', 'aria-live': 'polite' });
  const risultati = h('div', { class: 'ia-risultati' });
  const corpo = h('div', { class: 'ia-archivio' },
    h('p', { class: 'ia-avviso' }, 'Trova i documenti dell\'archivio descrivendoli con parole tue, anche se non contengono le stesse parole. Funziona su questo computer. I risultati sono suggerimenti: aprili per controllare.'),
    h('div', { class: 'ia-cerca' }, q, cerca), infoIndice, risultati);

  const disegnaIndice = async () => {
    let info = { documenti: 0 };
    try { info = await chiama(app, 'indice-info'); } catch (e) { metti(infoIndice, h('span', { class: 'ia-blocco' }, e.message)); return; }
    if (S.lavoro) {
      const { fatti, totale } = S.avanzamento;
      metti(infoIndice, h('div', { class: 'ia-barra' }, h('div', { style: { width: Math.round((fatti / Math.max(1, totale)) * 100) + '%' } })),
        h('span', {}, `Preparo la ricerca per significato: ${fatti} di ${totale} documenti`), h('button', { class: 'btn small', type: 'button', onclick: interrompiIndice }, 'Interrompi'));
    } else {
      metti(infoIndice, h('span', {}, info.documenti ? `Pronti per la ricerca per significato: ${info.documenti} documenti.` : 'La ricerca per significato non è ancora pronta.'),
        h('button', { class: 'btn small', type: 'button', onclick: avvia }, info.documenti ? 'Aggiorna' : 'Prepara (in sottofondo)'));
    }
  };
  const avvia = () => {
    preparaIndice(app).then((a) => { if (a?.totale) app.ui.toast(`Ricerca per significato pronta (${a.fatti} documenti aggiunti).`, { kind: 'success' }); })
      .catch((e) => { metti(infoIndice, h('span', { class: 'ia-blocco' }, e.message), /installat/i.test(e.message) ? h('button', { class: 'btn small', type: 'button', onclick: () => apriConfigura(app) }, 'Impostazioni dell\'assistente') : null); });
    disegnaIndice();
  };
  S.ascoltatori.add(disegnaIndice);

  cerca.onclick = async () => {
    const testo = q.value.trim();
    if (!testo) return;
    cerca.disabled = true;
    metti(risultati, h('p', {}, 'Cerco…'));
    try {
      const righe = await righeArchivio(A);
      const perImpronta = new Map(righe.filter((r) => r.impronta).map((r) => [r.impronta, r]));
      const [sem, par] = await Promise.all([
        chiama(app, 'indice-cerca', { domanda: testo, k: 40 }),
        A.cerca({ q: testo, limite: 40 }).then((x) => x?.righe || []).catch(() => []),
      ]);
      const lista = fondiRisultati(testo, sem, par, perImpronta, { max: 25 });
      if (!lista.length) { metti(risultati, h('p', {}, 'Nessun documento trovato. Se la ricerca per significato non è pronta, preparala con il pulsante qui sopra.')); return; }
      metti(risultati, ...lista.map((x) => h('button', {
        class: 'ia-risultato', type: 'button', title: 'Apri il documento (sola lettura) alla pagina indicata',
        onclick: () => app.services?.apriDocumentoArchivio?.(x.riga.id, { pagina: x.pagina }),
      }, h('strong', {}, x.riga.nome), h('span', { class: 'ia-meta' }, `pagina ${x.pagina}${x.perParole && x.perSignificato ? ' · trovato per parole e per significato' : x.perParole ? ' · trovato per parole' : ''}`),
      x.estratto ? h('span', { class: 'ia-estratto' }, x.estratto.length > 220 ? x.estratto.slice(0, 220) + '…' : x.estratto) : null)));
    } catch (e) {
      metti(risultati, h('p', { class: 'ia-blocco' }, e.message), /installat/i.test(e.message) ? h('button', { class: 'btn small', type: 'button', onclick: () => apriConfigura(app) }, 'Impostazioni dell\'assistente') : null);
    } finally { cerca.disabled = false; }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); cerca.click(); } });
  disegnaIndice();
  setTimeout(() => q.focus(), 0);
  try {
    await app.ui.dialog({ title: 'Cerca per significato nell\'archivio', width: 720, body: corpo, okLabel: 'Chiudi', cancelLabel: null });
  } finally { S.ascoltatori.delete(disegnaIndice); }
}
