// Area «archivio»: archivio d'ufficio sopra le cartelle che l'ufficio già usa.
// Indice dei documenti (testo, tipo, dati chiave, firme, scansioni), ricerca istantanea con filtri,
// stati e note d'ufficio legati all'impronta del file, scadenzario «Oggi», azioni in blocco.
// I file originali non vengono mai spostati né modificati. Vedi docs/aree/archivio.md.
import './archivio.css';
import { registerIcon } from '../../core/icons.js';
import { Archivio } from './archivio.js';
import { apriVista, vistaAperta } from './ui/vista.js';
import { disegnaOggi } from './ui/oggi.js';
import { apriDocumento } from './ui/azioni.js';
import { apriCartelle } from './ui/cartelle.js';
import { IMPOSTAZIONI_PREDEFINITE } from './lib/scadenze.js';
import { CODICI_ENTE_PREDEFINITI } from './lib/estrai.js';

registerIcon('archive', '<rect x="3" y="4" width="18" height="5" rx="1.2"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>');

export default function register(app) {
  const A = new Archivio(app);
  app.archivio = A; // per i test e per le altre aree

  const apri = (opts) => apriVista(app, A, opts);
  const apriId = async (id) => { const [r] = await A.righe([id]); if (r) apriDocumento(app, A, r, {}); };

  app.registerTool({
    id: 'archivio', name: 'Archivio d\'ufficio', category: 'archivio', icon: 'archive', needsDoc: false,
    description: 'Trova subito fatture, DURC, ordini e PEC nelle cartelle dell\'ufficio; stati, scadenze e registro',
    keywords: 'archivio indice cerca documenti cartelle ufficio fatture durc ordini determine missioni contratti pec p7m scadenzario scadenze protocollo titulus segnatura numero di protocollo stato pagato registro cig cup fornitore oggi',
    run: () => apri({}),
  });
  app.registerTool({
    id: 'archivio-oggi', name: 'Oggi: scadenze e cose da fare', category: 'archivio', icon: 'archive', needsDoc: false,
    description: 'DURC in scadenza, fatture da pagare, documenti da protocollare in Titulus o da firmare, nuovi arrivi',
    keywords: 'oggi scadenzario scadenze durc scaduto fatture da pagare da protocollare da firmare nuovi documenti',
    run: () => apri({ scheda: 'oggi' }),
  });
  app.registerTool({
    id: 'archivio-cartelle', name: 'Collega una cartella all\'archivio…', category: 'archivio', icon: 'archive', needsDoc: false,
    description: 'Aggiunge una cartella (anche di rete o OneDrive) all\'archivio d\'ufficio',
    keywords: 'collega cartella archivio rete onedrive indicizza aggiungi cartella',
    run: () => apriCartelle(app, A),
  });

  // ---------- pannello laterale ----------
  app.registerPanel({
    id: 'archive', title: 'Archivio', icon: 'archive', order: 60, needsDoc: false,
    render(c) {
      const { h } = app.ui;
      const q = h('input', { type: 'search', class: 'ar-side-q', placeholder: 'Cerca nell\'archivio…', 'aria-label': 'Cerca nell\'archivio' });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') apri({ q: q.value }); });
      const stato = h('div', { class: 'ar-side-stato', role: 'status', 'aria-live': 'polite' });
      const oggi = h('div', { class: 'ar-side-oggi' });
      const azioni = h('div', { class: 'ar-side-azioni' },
        h('button', { class: 'btn primary', onclick: () => apri({ q: q.value || undefined, scheda: q.value ? 'documenti' : undefined }) }, 'Apri l\'archivio'),
        h('button', { class: 'btn', onclick: () => apriCartelle(app, A) }, 'Cartelle…'));
      c.append(h('div', { class: 'ar-side' }, h('div', { class: 'ar-side-cerca' }, q, h('button', { class: 'btn', onclick: () => apri({ q: q.value }) }, 'Cerca')), azioni, stato, oggi));
      const aggiorna = async () => {
        const av = A.avanzamento;
        if (A.lavoro && av.fase === 'lettura') stato.replaceChildren(h('div', { class: 'ar-barra' }, h('div', { style: { width: Math.round((av.fatti / Math.max(1, av.totale)) * 100) + '%' } })), h('span', {}, `Indicizzazione: ${av.fatti} di ${av.totale}`), h('button', { class: 'btn small', onclick: () => A.interrompi() }, 'Interrompi'));
        else if (A.lavoro) stato.replaceChildren(h('span', {}, 'Controllo delle cartelle…'));
        else if (A.codaSeg) stato.replaceChildren(h('span', {}, `Lettura delle segnature di protocollo: ${A.codaSeg.fatti} di ${A.codaSeg.totale}`), h('button', { class: 'btn small', onclick: () => A.interrompiSegnature() }, 'Interrompi'));
        else stato.replaceChildren(h('span', { class: 'av-note' }, A.attivo ? `${A.cartelle.length} ${A.cartelle.length === 1 ? 'cartella collegata' : 'cartelle collegate'}` : 'Nessuna cartella collegata. Collega le cartelle dell\'ufficio per trovare subito i documenti.'));
        if (A.attivo && A.caricato) await disegnaOggi(app, A, oggi, { compatto: true, apri: apriId, vedi: (filtro) => apri({ filtro }) });
        else oggi.replaceChildren();
      };
      let t = 0;
      const off = A.on((tipo) => { if ((tipo === 'avanzamento' && A.lavoro) || (tipo === 'segnature' && A.codaSeg)) { if (!t) t = setTimeout(() => { t = 0; aggiorna(); }, 500); } else if (tipo !== 'avanzamento' || !A.lavoro) { clearTimeout(t); t = setTimeout(() => { t = 0; aggiorna(); }, 200); } });
      aggiorna();
      return () => { off(); clearTimeout(t); };
    },
  });

  // ---------- «Oggi» nella schermata iniziale ----------
  const home = app.el.home;
  let disegnando = false;
  async function inserisciOggi() {
    if (disegnando || !A.attivo || !A.caricato) return;
    const inner = home.querySelector('.home-inner');
    if (!inner || inner.querySelector('.ar-home')) return;
    disegnando = true;
    try {
      const { h } = app.ui;
      const box = h('div', { class: 'ar-oggi ar-oggi-home' });
      const sec = h('section', { class: 'home-sec ar-home' },
        h('div', { class: 'ar-home-head' }, h('h2', {}, 'Oggi in archivio'),
          h('button', { class: 'btn', onclick: () => apri({ scheda: 'documenti' }) }, 'Cerca nei documenti'),
          h('button', { class: 'btn primary', onclick: () => apri({ scheda: 'oggi' }) }, 'Apri l\'archivio')),
        box);
      const hero = inner.querySelector('.home-hero');
      if (hero) hero.after(sec); else inner.prepend(sec);
      await disegnaOggi(app, A, box, { compatto: true, apri: apriId, vedi: (filtro) => apri({ filtro }) });
    } finally { disegnando = false; }
  }
  new MutationObserver(() => inserisciOggi()).observe(home, { childList: true });
  let tHome = 0;
  A.on((tipo) => {
    if (!['cambiato', 'caricato', 'cartelle'].includes(tipo)) return;
    clearTimeout(tHome);
    tHome = setTimeout(() => { home.querySelector('.ar-home')?.remove(); inserisciOggi(); }, 800);
  });

  // ---------- stati chiesti da altre aree e lettura dello stato (vedi docs/aree/archivio.md) ----------
  // L'area avanzati emette «archivio:stato» quando appone o legge una segnatura: va confermato in modo SINCRONO.
  app.bus.on('archivio:stato', (ev) => { try { A.riceviStato(ev); } catch (e) { console.error(e); } });
  app.services = app.services || {};
  /** app.services.statoArchivio(path) → Promise<{ protocollato, numero, data, uor, origine, stati, … } | null> */
  app.services.statoArchivio = (path) => A.statoArchivio(path);

  // ---------- documenti nuovi arrivati nelle cartelle ----------
  A.on((tipo, d) => {
    if (tipo !== 'nuovi' || !d?.n) return;
    app.ui.toast(d.n === 1 ? 'È arrivato un documento nuovo nell\'archivio.' : `Sono arrivati ${d.n} documenti nuovi nell'archivio.`, { kind: 'info', action: { label: 'Vedi', run: () => apri({ scheda: 'oggi' }) } });
  });

  // ---------- impostazioni ----------
  app.bus.on('settings:fields', (arr) => {
    const s = app.settings;
    arr.push({ key: 'archivio.durataDurc', field: { name: 'archivio.durataDurc', label: 'Archivio: validità del DURC in giorni (se nel documento non c\'è la scadenza)', type: 'number', min: 1, max: 999, value: s.get('archivio.durataDurc', IMPOSTAZIONI_PREDEFINITE.durataDurc), help: 'Oggi 120 giorni per il DURC online: verifica sulla normativa vigente.' } });
    arr.push({ key: 'archivio.preavvisoDurc', field: { name: 'archivio.preavvisoDurc', label: 'Archivio: avvisa dei DURC in scadenza con quanti giorni di anticipo', type: 'number', min: 0, max: 365, value: s.get('archivio.preavvisoDurc', IMPOSTAZIONI_PREDEFINITE.preavvisoDurc) } });
    arr.push({ key: 'archivio.preavvisoFatture', field: { name: 'archivio.preavvisoFatture', label: 'Archivio: proponi in «Oggi» le fatture che scadono entro quanti giorni', type: 'number', min: 0, max: 365, value: s.get('archivio.preavvisoFatture', IMPOSTAZIONI_PREDEFINITE.preavvisoFatture) } });
    arr.push({ key: 'archivio.giorniNonProtocollati', field: { name: 'archivio.giorniNonProtocollati', label: 'Archivio: segnala in «Oggi» i documenti arrivati da più di quanti giorni e non ancora protocollati', type: 'number', min: 1, max: 60, value: s.get('archivio.giorniNonProtocollati', IMPOSTAZIONI_PREDEFINITE.giorniNonProtocollati) } });
    arr.push({ key: 'archivio.codiciEnte', field: { name: 'archivio.codiciEnte', label: 'Archivio: codice fiscale e P.IVA del tuo ente (non vengono presi per quelli del fornitore)', type: 'text', value: s.get('archivio.codiciEnte', CODICI_ENTE_PREDEFINITI.join(', ')) } });
  });

  const CHIAVI_REGOLE = ['archivio.durataDurc', 'archivio.preavvisoDurc', 'archivio.preavvisoFatture', 'archivio.giorniNonProtocollati', 'archivio.codiciEnte'];
  app.bus.on('settings:changed', (e) => { if (CHIAVI_REGOLE.includes(e?.key)) A.impostazioniCambiate().catch(() => {}); });

  // ---------- operazioni in blocco offerte da altre aree (OCR, compressione) ----------
  app.bus.on('batch:operations', (list) => {
    const sv = app.services || {};
    if (sv.ocr && !list.some((o) => o.id === 'ocr')) {
      list.push({ id: 'ocr', label: 'Rendi ricercabile (OCR)', description: 'Riconosce il testo delle scansioni, senza internet; l\'aspetto delle pagine non cambia',
        fields: [{ name: 'info', type: 'info', text: 'Le pagine che hanno già testo vengono lasciate com\'erano. Può richiedere alcuni secondi per pagina.' }],
        summary: () => 'Rendi ricercabile (OCR)', runBytes: (bytes) => sv.ocr(bytes, {}) });
    }
    if (sv.compress && !list.some((o) => o.id === 'riduci')) {
      list.push({ id: 'riduci', label: 'Riduci dimensioni file', description: 'Comprime le immagini (le scansioni pesanti diventano adatte a PEC e portali)',
        fields: [{ name: 'level', label: 'Livello', type: 'select', value: 'media', options: [{ value: 'archivio', label: 'Bassa compressione (qualità alta, per archivio)' }, { value: 'media', label: 'Media compressione (consigliata)' }, { value: 'alta', label: 'Alta compressione (file piccolo, per PEC e portali)' }] }],
        summary: (p) => `Riduci dimensioni (${p.level || 'media'})`, runBytes: async (bytes, p) => (await sv.compress(bytes, { level: p.level || 'media' })).bytes });
    }
  });

  // ---------- avvio ----------
  setTimeout(() => A.avvia().catch((e) => { app.log?.('error', 'archivio: avvio non riuscito', { e: e.message }); app.ui.toast('Archivio non disponibile: ' + e.message, { kind: 'warning', timeout: 8000 }); }), 600);
  // all'uscita si scrive quello che manca dell'indice
  app.bus.on('app:quitting', () => { A.interrompi(); A.scriviOra().catch(() => {}); });
  window.addEventListener('beforeunload', () => { if (A.lavoro) A.interrompi(); });
  return { apri, vistaAperta };
}
