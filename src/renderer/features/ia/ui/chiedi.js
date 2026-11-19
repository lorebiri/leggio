// Assistente IA: pannello «Chiedi al documento» (domande con la pagina citata).
import { metti } from '../lib/dom.js';
import { chiama, nuovoId } from '../servizio.js';
import { pagineDelDocumento, haTesto } from '../lib/testo-doc.js';
import { scegliContesto, passaggi, messaggiDomanda, leggiRisposta, verificaPagina, SCHEMA_RISPOSTA, stimaToken, testoConPagine, MAX_TOKEN_INTERO } from '../lib/passaggi.js';
import { AVVERTENZA } from '../lib/requisiti.js';

const vettoriDoc = new WeakMap(); // PDFDocumentProxy → Promise<{ pz, vettori }>

/** Porta il documento alla pagina e, se possibile, evidenzia il testo con la barra Trova. */
export function vaiAllaPagina(app, doc, pagina, testo) {
  if (doc !== app.activeDoc) return;
  app.viewer.page = Math.max(1, Math.min(doc.pageCount || pagina, pagina));
  if (testo) {
    app.openFind();
    const inp = app.el.findbar?.querySelector('input[type=search]');
    if (inp) { inp.value = testo; app.viewer.find(testo); }
  }
}

export function apriChiedi(app, apriConfigura) {
  const doc = app.activeDoc;
  if (!doc) return;
  const { h } = app.ui;
  let inCorso = null; // { id }
  const c = app.openRightPanel('Chiedi al documento', { doc, onClose: () => { if (inCorso) chiama(app, 'interrompi', { id: inCorso.id }).catch(() => {}); } });
  const domanda = h('textarea', { class: 'ia-domanda', rows: 3, placeholder: 'Es.: Qual è l\'importo? Chi è il responsabile del procedimento? Entro quando si presenta la domanda?', 'aria-label': 'La tua domanda sul documento' });
  const bottone = h('button', { class: 'btn primary', type: 'button' }, 'Chiedi');
  const ferma = h('button', { class: 'btn', type: 'button', hidden: true }, 'Interrompi');
  const stato = h('div', { class: 'ia-stato', role: 'status', 'aria-live': 'polite' });
  const lista = h('div', { class: 'ia-risposte' });
  c.append(h('div', { class: 'ia-pannello' },
    h('p', { class: 'ia-avviso' }, 'Fai una domanda su questo documento: la risposta indica la pagina da cui viene. Tutto avviene su questo computer.'),
    domanda, h('div', { class: 'ia-azioni' }, bottone, ferma), stato, lista));
  domanda.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bottone.click(); } });
  setTimeout(() => domanda.focus(), 0);

  ferma.onclick = () => { if (inCorso) chiama(app, 'interrompi', { id: inCorso.id }).catch(() => {}); };
  bottone.onclick = async () => {
    const q = domanda.value.trim();
    if (!q || inCorso) return;
    const modello = app.settings.get('ia.modello', '') || 'principale';
    inCorso = { id: nuovoId() };
    bottone.disabled = true; ferma.hidden = false;
    const t0 = Date.now();
    try {
      stato.textContent = 'Leggo il testo del documento…';
      const pagine = await pagineDelDocumento(doc.pdf);
      if (!haTesto(pagine)) throw new Error('Questo documento non ha testo (è una scansione): usa prima «Rendi ricercabile (OCR)», poi chiedi di nuovo.');
      let opz = {};
      if (stimaToken(testoConPagine(pagine)) > MAX_TOKEN_INTERO) {
        // documento lungo: passaggi pertinenti, con la ricerca per significato se il modello c'è
        stato.textContent = 'Cerco i passaggi pertinenti…';
        try {
          if (!vettoriDoc.has(doc.pdf)) {
            const pz = passaggi(pagine);
            vettoriDoc.set(doc.pdf, chiama(app, 'vettori', { testi: pz.map((p) => p.testo) }).then((vettori) => ({ pz, vettori })));
          }
          const { pz, vettori } = await vettoriDoc.get(doc.pdf);
          const [vettoreDomanda] = await chiama(app, 'vettori', { testi: [q] });
          opz = { pz, vettori, vettoreDomanda };
        } catch { vettoriDoc.delete(doc.pdf); opz = {}; /* senza embedding: solo ricerca per parole */ }
      }
      const ctx = scegliContesto(pagine, q, opz);
      stato.textContent = ctx.modo === 'intero' ? 'L\'assistente legge il documento… (la prima domanda è la più lenta)' : 'L\'assistente legge i passaggi trovati…';
      const r = await chiama(app, 'chiedi', { modello, messaggi: messaggiDomanda(ctx.testo, q), schema: SCHEMA_RISPOSTA, maxToken: 200, id: inCorso.id });
      const ris = leggiRisposta(r.testo, { pagineValide: ctx.pagine });
      const ver = ris.trovata ? verificaPagina(ris.risposta, ris.pagina, pagine, ctx.pagine) : null;
      lista.prepend(scheda(app, doc, q, ris, ver, Math.round((Date.now() - t0) / 1000)));
      stato.textContent = '';
      domanda.value = '';
      app.log?.('info', 'ia: domanda', { modo: ctx.modo, trovata: ris.trovata, paginaCitataEsiste: ris.paginaVerificata, testoInPagina: ver?.verificata, paginaCorretta: ver?.corretta, ms: Date.now() - t0, promptN: r.tempi?.promptN, cacheN: r.tempi?.cacheN });
    } catch (e) {
      const msg = e.message;
      metti(stato, h('span', { class: 'ia-blocco' }, msg === 'Interrotto.' ? 'Domanda interrotta.' : msg),
        /installat/i.test(msg) ? h('button', { class: 'btn small', type: 'button', onclick: () => apriConfigura(app) }, 'Apri le impostazioni dell\'assistente') : null);
    } finally {
      inCorso = null; bottone.disabled = false; ferma.hidden = true;
    }
  };
}

function scheda(app, doc, q, ris, ver, secondi) {
  const { h } = app.ui;
  const card = h('div', { class: 'ia-risposta' }, h('div', { class: 'ia-q' }, q));
  if (!ris.trovata) {
    card.append(h('div', { class: 'ia-a ia-vuota' }, 'Non ho trovato la risposta in questo documento.'));
  } else {
    card.append(h('div', { class: 'ia-a' }, ris.risposta));
    if (ver?.pagina) {
      // la pagina mostrata è quella in cui il testo della risposta compare davvero (se il modello ne ha citata
      // un'altra, si corregge); se il testo non si ritrova, «pagina da controllare»
      card.append(h('div', { class: 'ia-fonte' },
        h('button', { class: 'btn small', type: 'button', title: 'Vai alla pagina ed evidenzia il passaggio', onclick: () => vaiAllaPagina(app, doc, ver.pagina, ver.evidenzia) }, `Pagina ${ver.pagina}`),
        ver.verificata ? null : h('span', { class: 'ia-attenzione' }, ' pagina da controllare')));
    }
  }
  card.append(h('div', { class: 'ia-nota' }, `${AVVERTENZA} (${secondi} s)`));
  return card;
}
