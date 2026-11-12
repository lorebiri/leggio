// Operazioni per le "Azioni guidate" (elaborazione in blocco). Logica pura su pdf-lib.
// Ogni operazione: { id, label, description, fields (per app.ui.dialog), summary(params), run(pdfDoc, PDFLib, params, ctx) }
// Le altre aree possono aggiungere operazioni "a byte" con l'evento bus 'batch:operations' (vedi docs/aree/avanzati.md):
//   app.bus.on('batch:operations', (list) => list.push({ id, label, description, fields, summary, runBytes: async (bytes, params, ctx) => bytes }))
import { applicaProtocollo, POSIZIONI, DIREZIONI, oggi, testoSicuro, visivoAPagina, dimensioniVisive, formattaNumero } from './protocollo.js';

export class SkipError extends Error {}

const POS_NUMERI = [
  { value: 'basso-centro', label: 'In basso al centro' }, { value: 'basso-destra', label: 'In basso a destra' },
  { value: 'basso-sinistra', label: 'In basso a sinistra' }, { value: 'alto-destra', label: 'In alto a destra' }, { value: 'alto-centro', label: 'In alto al centro' },
];

function hex(PDFLib, c) {
  const m = String(c || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : PDFLib.rgb(0, 0, 0);
}
function quali(pages, scelta) {
  if (scelta === 'dispari') return pages.filter((_, i) => i % 2 === 0);
  if (scelta === 'pari') return pages.filter((_, i) => i % 2 === 1);
  if (scelta === 'prima') return pages.slice(0, 1);
  return pages;
}

export const OPERAZIONI = [
  {
    id: 'ruota', label: 'Ruota pagine', description: 'Gira le pagine di 90°, 180° o 270°',
    fields: [
      { name: 'angolo', label: 'Rotazione', type: 'select', value: '90', options: [{ value: '90', label: '90° in senso orario' }, { value: '180', label: '180° (capovolgi)' }, { value: '270', label: '90° in senso antiorario' }] },
      { name: 'pagine', label: 'Quali pagine', type: 'select', value: 'tutte', options: [{ value: 'tutte', label: 'Tutte' }, { value: 'dispari', label: 'Solo dispari' }, { value: 'pari', label: 'Solo pari' }, { value: 'prima', label: 'Solo la prima' }] },
    ],
    summary: (p) => `Ruota di ${p.angolo === '270' ? '90° in senso antiorario' : p.angolo + '°'} (${p.pagine})`,
    run(doc, PDFLib, p) {
      const a = +p.angolo || 90;
      for (const pg of quali(doc.getPages(), p.pagine)) pg.setRotation(PDFLib.degrees((pg.getRotation().angle + a) % 360));
    },
  },
  {
    id: 'numeri', label: 'Aggiungi numeri di pagina', description: 'Scrive «Pagina 1 di 10» su ogni pagina',
    fields: [
      { name: 'formato', label: 'Testo', type: 'select', value: 'Pagina {n} di {tot}', options: ['Pagina {n} di {tot}', '{n} / {tot}', '{n}', 'Pag. {n}'] },
      { name: 'posizione', label: 'Posizione', type: 'select', value: 'basso-centro', options: POS_NUMERI },
      { name: 'size', label: 'Dimensione del carattere', type: 'number', value: 10, min: 6, max: 36 },
      { name: 'inizio', label: 'Primo numero', type: 'number', value: 1, min: 0, max: 99999 },
    ],
    summary: (p) => `Numeri di pagina «${p.formato}»`,
    async run(doc, PDFLib, p) {
      const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages = doc.getPages(); const tot = pages.length; const size = Math.max(6, Math.min(36, +p.size || 10));
      const start = Number.isFinite(+p.inizio) ? +p.inizio : 1;
      pages.forEach((pg, i) => {
        const t = testoSicuro(font, String(p.formato || '{n}').replace('{n}', String(i + start)).replace('{tot}', String(tot + start - 1)));
        const w = font.widthOfTextAtSize(t, size);
        const { w: PW, h: PH } = dimensioniVisive(pg);
        const m = 22;
        let u = (PW - w) / 2; let v = m;
        if (p.posizione?.endsWith('destra')) u = PW - m - w;
        if (p.posizione?.endsWith('sinistra')) u = m;
        if (p.posizione?.startsWith('alto')) v = PH - m - size;
        const a = visivoAPagina(pg, u, v);
        pg.drawText(t, { x: a.x, y: a.y, size, font, color: PDFLib.rgb(0.15, 0.15, 0.15), rotate: PDFLib.degrees(a.rot) });
      });
    },
  },
  {
    id: 'filigrana', label: 'Aggiungi filigrana', description: 'Testo trasparente in diagonale (es. COPIA, BOZZA)',
    fields: [
      { name: 'testo', label: 'Testo della filigrana', type: 'text', value: 'COPIA', required: true },
      { name: 'opacita', label: 'Trasparenza', type: 'range', value: 20, min: 5, max: 80, unit: '%' },
      { name: 'colore', label: 'Colore', type: 'color', value: '#b42318' },
      { name: 'pagine', label: 'Quali pagine', type: 'select', value: 'tutte', options: [{ value: 'tutte', label: 'Tutte' }, { value: 'prima', label: 'Solo la prima' }] },
    ],
    summary: (p) => `Filigrana «${p.testo}»`,
    async run(doc, PDFLib, p) {
      const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      const t = testoSicuro(font, String(p.testo || 'COPIA').slice(0, 60));
      for (const pg of quali(doc.getPages(), p.pagine)) {
        const { w: PW, h: PH } = dimensioniVisive(pg);
        const diag = Math.hypot(PW, PH);
        let size = Math.min(160, (diag * 0.7) / Math.max(1, font.widthOfTextAtSize(t, 1)));
        size = Math.max(10, size);
        const w = font.widthOfTextAtSize(t, size);
        const ang = Math.atan2(PH, PW);
        // centro della scritta al centro della pagina visiva
        const u = PW / 2 - (w / 2) * Math.cos(ang) + (size / 3) * Math.sin(ang);
        const v = PH / 2 - (w / 2) * Math.sin(ang) - (size / 3) * Math.cos(ang);
        const a = visivoAPagina(pg, u, v);
        pg.drawText(t, { x: a.x, y: a.y, size, font, color: hex(PDFLib, p.colore || '#b42318'), opacity: Math.max(0.05, Math.min(0.8, (+p.opacita || 20) / 100)), rotate: PDFLib.degrees(a.rot + (ang * 180) / Math.PI) });
      }
    },
  },
  {
    id: 'protocollo', label: 'Timbro di protocollo', description: 'Riquadro «Prot. n. … del …» con numerazione progressiva',
    fields: [
      { name: 'ente', label: 'Ente o istituto', type: 'text', value: '' },
      { name: 'ufficio', label: 'Ufficio (facoltativo)', type: 'text', value: '' },
      { name: 'numero', label: 'Numero del primo file', type: 'text', value: '1', required: true, help: 'Ai file successivi viene dato il numero seguente.' },
      { name: 'data', label: 'Data', type: 'text', value: oggi() },
      { name: 'direzione', label: 'Entrata / uscita', type: 'select', value: 'entrata', options: DIREZIONI },
      { name: 'classificazione', label: 'Classificazione (facoltativa)', type: 'text', value: '' },
      { name: 'posizione', label: 'Posizione', type: 'select', value: 'alto-destra', options: POSIZIONI },
    ],
    summary: (p) => `Protocollo dal n. ${p.numero} del ${p.data}`,
    async run(doc, PDFLib, p, ctx) {
      const base = parseInt(String(p.numero).replace(/\D/g, ''), 10);
      const numero = Number.isFinite(base) ? formattaNumero(base + (ctx?.index || 0), String(p.numero).trim().length > String(base).length ? String(p.numero).trim().length : 0) : p.numero;
      if (ctx) ctx.note = `Prot. n. ${numero}`;
      await applicaProtocollo(doc, PDFLib, { ...p, numero, pagine: 'prima' });
    },
  },
  {
    id: 'metadati', label: 'Rimuovi metadati', description: 'Cancella autore, titolo, programma usato e dati XMP',
    fields: [{ name: 'info', type: 'info', text: 'Toglie dal file autore, titolo, oggetto, parole chiave, programma di creazione, date e metadati XMP.' }],
    summary: () => 'Rimuovi metadati',
    run(doc, PDFLib) {
      const { PDFName } = PDFLib;
      doc.catalog.delete(PDFName.of('Metadata'));
      try {
        const infoRef = doc.context.trailerInfo.Info;
        const info = infoRef && doc.context.lookup(infoRef);
        if (info && info.keys) for (const k of info.keys()) info.delete(k);
      } catch {}
      for (const pg of doc.getPages()) { try { pg.node.delete(PDFName.of('Metadata')); pg.node.delete(PDFName.of('PieceInfo')); } catch {} }
      doc.catalog.delete(PDFName.of('PieceInfo'));
    },
  },
  {
    id: 'appiattisci', label: 'Rendi definitivi i moduli', description: 'I campi compilati diventano testo non modificabile',
    fields: [{ name: 'info', type: 'info', text: 'I campi dei moduli vengono trasformati in testo fisso: non si potranno più modificare.' }],
    summary: () => 'Rendi definitivi i moduli',
    run(doc) {
      try { const f = doc.getForm(); if (f.getFields().length) f.flatten(); } catch (e) { throw new Error('Impossibile rendere definitivi i moduli: ' + e.message); }
    },
  },
  {
    id: 'comprimi', label: 'Ottimizza (compressione leggera)', description: 'Salva in forma compatta senza toccare la qualità',
    fields: [{ name: 'info', type: 'info', text: 'Riorganizza il file in forma più compatta. Non riduce la qualità delle immagini: per ridurre molto le scansioni usa «Comprimi PDF» se disponibile nell\'elenco.' }],
    summary: () => 'Ottimizza (compressione leggera)',
    run() { /* il salvataggio con flussi di oggetti compatti è già la compressione */ },
  },
  {
    id: 'proteggi', label: 'Proteggi con password', description: 'Chiede una password per aprire il file',
    last: true,
    fields: [
      { name: 'password', label: 'Password per aprire', type: 'password', value: '', required: true },
      { name: 'stampa', label: 'Consenti la stampa', type: 'checkbox', value: true },
      { name: 'copia', label: 'Consenti di copiare il testo', type: 'checkbox', value: false },
    ],
    summary: () => 'Proteggi con password',
    validate: (p) => (String(p.password || '').length < 4 ? 'La password deve avere almeno 4 caratteri.' : null),
    run(doc, PDFLib, p) {
      const owner = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
      doc.encrypt({ userPassword: String(p.password), ownerPassword: owner, permissions: { printing: p.stampa ? 'highResolution' : false, copying: !!p.copia, modifying: false, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: false } });
    },
  },
];

export function tutteLeOperazioni(esterne = []) {
  const map = new Map(OPERAZIONI.map((o) => [o.id, o]));
  for (const e of esterne) if (e && e.id && e.label && typeof e.runBytes === 'function') map.set(e.id, { ...e, esterna: true });
  return [...map.values()];
}

/** Controlla una sequenza: operazioni esistenti, «Proteggi» per ultima. → messaggio d'errore o null */
export function validaSequenza(passi, ops) {
  if (!Array.isArray(passi) || !passi.length) return 'Aggiungi almeno un\'operazione.';
  const byId = new Map(ops.map((o) => [o.id, o]));
  for (const [i, s] of passi.entries()) {
    const o = byId.get(s.op);
    if (!o) return `L'operazione «${s.op}» non è disponibile in questa versione.`;
    if (o.last && i !== passi.length - 1) return `«${o.label}» deve essere l'ultima operazione della sequenza.`;
    const err = o.validate?.(s.params || {});
    if (err) return `${o.label}: ${err}`;
  }
  return null;
}

/**
 * Esegue la sequenza su un file. env: { PDFLib, openPdfLib(bytes), savePdfLib(doc), ops, ctx, signal }
 * Le operazioni pdf-lib consecutive condividono un solo caricamento/salvataggio.
 */
export async function eseguiSequenza(bytes, passi, env) {
  const byId = new Map(env.ops.map((o) => [o.id, o]));
  let cur = bytes;
  let doc = null;
  const flush = async () => { if (doc) { cur = await env.savePdfLib(doc); doc = null; } };
  for (const s of passi) {
    if (env.signal?.aborted) throw new DOMException('Annullato', 'AbortError');
    const o = byId.get(s.op);
    if (!o) throw new Error(`Operazione non disponibile: ${s.op}`);
    if (o.esterna) {
      await flush();
      const out = await o.runBytes(cur, s.params || {}, env.ctx || {});
      if (out instanceof Uint8Array) cur = out;
      else if (out instanceof ArrayBuffer) cur = new Uint8Array(out);
    } else {
      if (!doc) {
        try { doc = await env.openPdfLib(cur); }
        catch (e) { throw new SkipError(/password|encrypt/i.test(e?.message || '') ? 'Il file è protetto da password.' : 'Il file non è un PDF leggibile o è danneggiato.'); }
        if (doc.isEncrypted) throw new SkipError('Il file è protetto da password: aprilo e togli la protezione prima di elaborarlo.');
      }
      await o.run(doc, env.PDFLib, s.params || {}, env.ctx || {});
    }
  }
  await flush();
  return cur;
}

/** Nome del file di uscita. modo: 'stesso' | 'suffisso' */
export function nomeUscita(nome, { modo = 'stesso', suffisso = '_elaborato' } = {}) {
  const n = String(nome || 'documento.pdf');
  if (modo !== 'suffisso') return n;
  const m = n.match(/^(.*?)(\.pdf)?$/i);
  return `${m[1]}${suffisso}.pdf`;
}
