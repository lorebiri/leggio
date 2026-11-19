// Compilazione in serie: record (da rubrica o da file CSV/Excel), abbinamento automatico campi ↔ dati,
// controlli per record, schema del nome dei file, generazione dei PDF (un record con errori non blocca
// gli altri). Logica pura: gira nel Web Worker (serie.worker.js) e, se manca, nel thread principale.
import { chiavePerCampo, nomeRipulito, datiDaContatto, nomeContatto, CAMPI_CONTATTO, CAMPI_MODULO } from './campi.js';
import { validaCodiceFiscale } from './validatori.js';
import { compilaConModello, corrispondenzeModello, valoreChiave, etichettaChiave, disegnaImmagine, appiattisciModulo, tipoImmagine } from './modelli.js';
import { todayIt } from '../../moduli/lib/geom.js';

// ------------------------------------------------------------------------------------------- nomi file
const RISERVATI = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NOME = 150;

/** Ripulisce un nome di file (senza estensione): caratteri non validi, spazi, punti finali, nomi riservati. */
export function pulisciNomeFile(s) {
  let n = String(s ?? '').normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_[\s_]*_/g, '_') // segnaposto vuoti: «Rossi__domanda» → «Rossi_domanda»
    .replace(/(^[\s._-]+|[\s._-]+$)/g, '');
  if (n.length > MAX_NOME) n = n.slice(0, MAX_NOME).replace(/[\s._-]+$/, '');
  if (!n) n = 'documento';
  if (RISERVATI.test(n.split('.')[0])) n = '_' + n;
  return n;
}

const dataFile = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Nome del file per un record dallo schema con segnaposto: {cognome} {nome} {ragioneSociale} {codiceFiscale}
 * (e ogni altra chiave dei dati), {n} numero progressivo (con zeri davanti se totale > 9), {data} (aaaa-mm-gg)
 * e, per i file CSV/Excel, {Nome colonna}. Estensione .pdf garantita.
 */
export function nomeFileDaSchema(schema, dati = {}, { n = 1, totale = 1, data = new Date() } = {}) {
  const cifre = String(Math.max(1, totale)).length;
  const colonne = Object.keys(dati).filter((k) => k.startsWith('colonna:'));
  const testo = String(schema || '').trim() || '{n}';
  const base = testo.replace(/\.pdf\s*$/i, '').replace(/\{([^{}]{1,80})\}/g, (_, nomeRaw) => {
    const nome = nomeRaw.trim();
    if (nome === 'n') return String(n).padStart(cifre, '0');
    if (nome === 'data') return dataFile(data instanceof Date ? data : new Date(data));
    if (dati[nome] != null && !nome.startsWith('colonna:')) return String(dati[nome]);
    if (dati['colonna:' + nome] != null) return String(dati['colonna:' + nome]);
    const k = colonne.find((c) => norm(c.slice(8)) === norm(nome)) || Object.keys(dati).find((c) => !c.startsWith('colonna:') && c.toLowerCase() === nome.toLowerCase());
    return k ? String(dati[k]) : '';
  });
  return pulisciNomeFile(base) + '.pdf';
}

/** Rende unici i nomi (senza distinguere maiuscole: Windows e macOS non le distinguono): «x.pdf», «x_2.pdf»… */
export function creaNomiUnici() {
  const usati = new Set();
  return (nome) => {
    const m = /^(.*?)(\.pdf)$/i.exec(nome) || [null, nome, '.pdf'];
    let out = m[1] + m[2]; let k = 2;
    while (usati.has(out.toLowerCase())) out = `${m[1]}_${k++}${m[2]}`;
    usati.add(out.toLowerCase());
    return out;
  };
}

/** Segnaposto disponibili per lo schema dei nomi. → [{ value: '{cognome}', label }] */
export function segnapostoDisponibili(intestazioni = []) {
  return [
    { value: '{cognome}', label: 'Cognome' }, { value: '{nome}', label: 'Nome' },
    { value: '{ragioneSociale}', label: 'Ragione sociale' }, { value: '{codiceFiscale}', label: 'Codice fiscale' },
    { value: '{n}', label: 'Numero progressivo' }, { value: '{data}', label: 'Data di oggi' },
    ...intestazioni.map((h) => ({ value: `{${h}}`, label: `Colonna «${h}»` })),
  ];
}

// ------------------------------------------------------------------------------------------- record
/** Chiave dei dati che corrisponde all'intestazione di una colonna (es. «Cognome», «C.F.», «Città»). → chiave | null */
const ALIAS = { cf: 'codiceFiscale', codfisc: 'codiceFiscale', codfiscale: 'codiceFiscale', piva: 'partitaIva', partitaiva: 'partitaIva', tel: 'telefono', cell: 'telefono', mail: 'email', ragsociale: 'ragioneSociale', prov: 'provincia', comune: 'citta', datanascita: 'dataNascita', luogonascita: 'luogoNascita', natoa: 'luogoNascita', natoil: 'dataNascita' };
export function chiaveIntestazione(h) {
  const n = norm(h);
  if (!n) return null;
  const compatto = n.replace(/ /g, '');
  if (ALIAS[compatto]) return ALIAS[compatto];
  for (const c of [...CAMPI_CONTATTO, ...CAMPI_MODULO]) if (norm(c.label) === n || norm(c.key) === n) return c.key;
  const k = chiavePerCampo(h);
  return k && k !== 'oggi' ? k : null;
}

/** Record da un contatto della rubrica. → { id, etichetta, dati } */
export function recordDaContatto(c) {
  return { id: c.id, etichetta: nomeContatto(c), dati: datiDaContatto(c) };
}

/**
 * Record da una riga di un file CSV/Excel. Le colonne restano come 'colonna:Nome'; quelle riconosciute
 * (Cognome, Codice fiscale…) danno anche le chiavi standard (per i nomi dei file e i controlli).
 */
export function recordDaRiga(riga, intestazioni = Object.keys(riga || {}), i = 0) {
  const dati = {};
  for (const h of intestazioni) {
    const v = String(riga?.[h] ?? '').trim();
    dati['colonna:' + h] = v;
    const k = chiaveIntestazione(h);
    if (k && v && !dati[k]) dati[k] = v;
  }
  if (!dati.nomeCompleto) { const full = [dati.nome, dati.cognome].filter(Boolean).join(' '); if (full || dati.ragioneSociale) dati.nomeCompleto = full || dati.ragioneSociale; }
  if (dati.ragioneSociale && !dati.ente) dati.ente = dati.ragioneSociale;
  const etichetta = dati.nomeCompleto || dati.ragioneSociale || intestazioni.map((h) => dati['colonna:' + h]).find(Boolean) || `Riga ${i + 1}`;
  return { id: `riga-${i + 1}`, etichetta, dati };
}

// ------------------------------------------------------------------------------------------- abbinamento
/**
 * Abbinamento automatico campi del modulo ↔ colonne di un file. In ordine: nome identico del campo,
 * stessa chiave riconosciuta (campi.js) fra campo e intestazione, chiave derivata (es. nome+cognome),
 * data di oggi. campi: [{ nome, tipo }]. → { nomeCampo: 'colonna:…' | chiave | 'oggi' | '' }
 */
export function abbinaColonne(campi, intestazioni = []) {
  const perNome = new Map(intestazioni.map((h) => [norm(nomeRipulito(h)), h]));
  const perChiave = new Map();
  for (const h of intestazioni) { const k = chiaveIntestazione(h); if (k && !perChiave.has(k)) perChiave.set(k, h); }
  const derivate = new Set();
  if (perChiave.has('nome') && perChiave.has('cognome')) derivate.add('nomeCompleto');
  if (perChiave.has('ragioneSociale')) { derivate.add('ente'); if (!perChiave.has('nome')) derivate.add('nomeCompleto'); }
  const out = {};
  for (const c of campi || []) {
    const nome = typeof c === 'string' ? c : c.nome;
    const esatto = perNome.get(norm(nomeRipulito(nome))) || intestazioni.find((h) => h === nome);
    if (esatto) { out[nome] = 'colonna:' + esatto; continue; }
    if (c.tipo && c.tipo !== 'text') { out[nome] = ''; continue; }
    const k = chiavePerCampo(nome);
    if (k === 'oggi') out[nome] = 'oggi';
    else if (k && perChiave.has(k)) out[nome] = 'colonna:' + perChiave.get(k);
    else if (k && derivate.has(k)) out[nome] = k;
    else out[nome] = '';
  }
  return out;
}

/** Abbinamento automatico per la rubrica: chiave riconosciuta dal nome del campo. */
export function abbinaRubrica(campi) {
  const out = {};
  for (const c of campi || []) { const nome = typeof c === 'string' ? c : c.nome; out[nome] = (!c.tipo || c.tipo === 'text') ? chiavePerCampo(nome) || '' : ''; }
  return out;
}

// ------------------------------------------------------------------------------------------- controlli
/** Coppie [nome (campo o zona), chiave] abbinate di un modello. */
function abbinate(modello) {
  if (modello?.tipo === 'zone') return (modello.zone || []).map((z) => [etichettaChiave(z.chiave), z.chiave]);
  return Object.entries(corrispondenzeModello(modello));
}
const eCf = (nome, chiave) => chiave === 'codiceFiscale'
  || (chiave?.startsWith('colonna:') && chiaveIntestazione(chiave.slice(8)) === 'codiceFiscale')
  || (chiave && !chiave.startsWith('fisso:') && chiavePerCampo(nome) === 'codiceFiscale');

/**
 * Controlli di un record prima della generazione: campi abbinati senza dato, codici fiscali non validi.
 * → { mancanti: [nomi], cf: [{ campo, valore, avviso }], avvisi: [testi] }
 */
export function controllaRecord(record, modello, { oggi = todayIt() } = {}) {
  const mancanti = []; const cf = []; const visti = new Set();
  for (const [nome, chiave] of abbinate(modello)) {
    const v = valoreChiave(chiave, record?.dati, oggi);
    if (v == null) continue;
    if (!v) { mancanti.push(nome); continue; }
    if (eCf(nome, chiave) && !visti.has(v)) {
      visti.add(v);
      const r = validaCodiceFiscale(v);
      if (!r.valido) cf.push({ campo: nome, valore: v, avviso: r.avviso || 'Codice fiscale non valido.' });
    }
  }
  const avvisi = [];
  if (mancanti.length) avvisi.push(`Campi senza dato: ${mancanti.join(', ')}`);
  for (const c of cf) avvisi.push(`Codice fiscale non valido (${c.valore}): ${c.avviso}`);
  return { mancanti, cf, avvisi };
}

// ------------------------------------------------------------------------------------------- generazione
/**
 * Prepara il PDF di base: aggiunge una volta sola firma e timbro (uguali per tutti i record), così ogni
 * copia non deve rielaborare l'immagine. → byte
 */
export async function preparaBase(PDFLib, bytes, { firma = null, timbro = null } = {}) {
  if (!firma && !timbro) return bytes;
  const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  for (const im of [firma, timbro]) if (im?.bytes && im.posizione) await disegnaImmagine(PDFLib, doc, im.bytes, im.posizione);
  return doc.save({ updateFieldAppearances: false });
}

const pausa = () => new Promise((r) => setTimeout(r, 0));
const interrotto = () => Object.assign(new Error('Operazione interrotta'), { name: 'AbortError' });

/**
 * Genera i PDF della serie.
 *   PDFLib, base (byte del modulo), modello (normalizzato: campi/corrispondenze o zone), records [{ id, etichetta, dati }]
 *   opzioni: { schema ('{cognome}_{nome}.pdf'), unico (un solo PDF con tutti), appiattisci, oggi, data,
 *              firma?: { bytes, posizione:{pagina,rect} }, timbro?: { bytes, posizione }, salvaSingoli (default !unico) }
 *   signal: AbortSignal (o { aborted }) — controllato fra un record e l'altro
 *   onGruppo(esiti[]) — chiamata ogni `gruppo` record con i byte dei PDF (attesa: freno alla memoria)
 *   onProgresso(fatti, totale, etichetta)
 *   cedi: funzione asincrona chiamata fra un record e l'altro (thread principale: cede il controllo)
 * → { esiti: [{ n, id, etichetta, nome, stato:'ok'|'avvisi'|'errore', avvisi, errore }], unico?: Uint8Array,
 *     pagineUnico, interrotto }
 */
export async function generaSerie({ PDFLib, base, modello, records, opzioni = {}, signal = null, onGruppo = null, onProgresso = null, cedi = null, gruppo = 10 }) {
  const { schema = '{n}', unico = false, appiattisci = false, oggi = todayIt(), data = new Date() } = opzioni;
  const salvaSingoli = opzioni.salvaSingoli ?? !unico;
  const totale = records.length;
  const unicoNome = creaNomiUnici();
  const baseBytes = await preparaBase(PDFLib, base, { firma: opzioni.firma, timbro: opzioni.timbro });
  const finale = unico ? await PDFLib.PDFDocument.create() : null;
  const esiti = []; let blocco = [];
  let fermato = false;
  const invia = async () => { if (!blocco.length) return; const b = blocco; blocco = []; if (onGruppo) await onGruppo(b); };
  for (let i = 0; i < totale; i++) {
    if (signal?.aborted) { fermato = true; break; }
    const rec = records[i];
    const n = i + 1;
    const esito = { n, id: rec?.id, etichetta: rec?.etichetta || `Record ${n}`, nome: '', stato: 'ok', avvisi: [], errore: '' };
    try {
      esito.nome = unicoNome(nomeFileDaSchema(schema, rec.dati, { n, totale, data }));
      const ctrl = controllaRecord(rec, modello, { oggi });
      esito.avvisi.push(...ctrl.avvisi);
      const doc = await PDFLib.PDFDocument.load(baseBytes, { ignoreEncryption: true, updateMetadata: false });
      const r = await compilaConModello(PDFLib, doc, modello, rec.dati, { oggi, appiattisci: appiattisci || unico });
      if (r.falliti.length) esito.avvisi.push(`Campi non scritti: ${r.falliti.join(', ')}`);
      if (r.mancanti.length) esito.avvisi.push(`Campi non trovati nel modulo: ${r.mancanti.join(', ')}`);
      if (finale) {
        const pagine = await finale.copyPages(doc, doc.getPageIndices());
        for (const p of pagine) finale.addPage(p);
      }
      if (salvaSingoli) esito.bytes = await doc.save({ updateFieldAppearances: false });
      if (esito.avvisi.length) esito.stato = 'avvisi';
    } catch (e) {
      esito.stato = 'errore'; esito.errore = e?.message || String(e);
    }
    const { bytes, ...senzaByte } = esito;
    esiti.push(senzaByte);
    blocco.push(esito);
    onProgresso?.(n, totale, esito.etichetta);
    if (blocco.length >= gruppo) await invia();
    if (cedi) await cedi();
  }
  await invia();
  const out = { esiti, interrotto: fermato };
  if (finale && !fermato && finale.getPageCount()) { out.unico = await finale.save(); out.pagineUnico = finale.getPageCount(); }
  return out;
}

/** Conteggi del riepilogo. */
export function riepilogo(esiti) {
  const r = { totale: esiti.length, ok: 0, avvisi: 0, errori: 0 };
  for (const e of esiti) { if (e.stato === 'errore') r.errori++; else if (e.stato === 'avvisi') r.avvisi++; else r.ok++; }
  r.generati = r.ok + r.avvisi;
  return r;
}

/** Riepilogo per record in CSV (separatore «;», per Excel in italiano). */
export function riepilogoCsv(esiti) {
  const stato = { ok: 'Generato', avvisi: 'Generato con avvisi', errore: 'Non generato' };
  const cella = (v) => { const s = String(v ?? ''); return /[";\r\n]/.test(s) || /^[=@+-]/.test(s) ? '"' + (/^[=@+-]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  const righe = [['N.', 'Record', 'File', 'Esito', 'Avvisi ed errori']];
  for (const e of esiti) righe.push([e.n, e.etichetta, e.stato === 'errore' ? '' : e.nome, stato[e.stato] || e.stato, [...(e.avvisi || []), e.errore].filter(Boolean).join(' | ')]);
  return '﻿' + righe.map((r) => r.map(cella).join(';')).join('\r\n') + '\r\n';
}

export { pausa, interrotto, tipoImmagine, appiattisciModulo };
