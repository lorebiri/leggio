// Genera un archivio d'ufficio di prova (PDF realistici in sottocartelle) per collaudare l'area «archivio».
//   node test/archivio-genera.mjs <cartella> [--n=3000] [--grande]
// Fatture (PDF, XML FatturaPA, .xml.p7m), note di credito, DURC, ordini e determine, missioni,
// contratti (alcuni con firma PAdES simulata), PEC (.eml), scansioni senza testo, file danneggiati,
// file protetti da password. I file vanno FUORI dal repository (sono migliaia): cancellarli dopo la prova.
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, degrees, PDFString } from '@cantoo/pdf-lib';
import forge from 'node-forge';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
// per disegnare la striscia di segnatura come immagine (come fa Titulus); se manca, segnatura come testo
let Canvas = null;
try { Canvas = createRequire(import.meta.url)('@napi-rs/canvas'); } catch { Canvas = null; }

const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || 'archivio-prova');
const N = +(args.find((a) => a.startsWith('--n='))?.slice(4) || 3000);
const GRANDE = args.includes('--grande');
const PESANTI = +(args.find((a) => a.startsWith('--pesanti='))?.slice(10) || 0); // scansioni vere (immagini), ~1-2 MB l'una
const OGGI = new Date(Date.UTC(2026, 10, 12));

let seed = 20261112;
// mulberry32: sequenza riproducibile e senza cicli brevi
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pad = (n, k = 2) => String(n).padStart(k, '0');
const iso = (d) => d.toISOString().slice(0, 10);
const it = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const giorni = (d, n) => new Date(d.getTime() + n * 86400000);
const euro = (v) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function piva(base10) {
  const s = String(base10).padStart(10, '0').slice(0, 10);
  let sum = 0;
  for (let i = 0; i < 10; i++) { let d = +s[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return s + ((10 - (sum % 10)) % 10);
}
const NOMI = ['Alfa Strumenti', 'Beta Reagenti', 'Chimica Toscana', 'Delta Lab', 'Elettronica Pisana', 'Fluidi Tecnici', 'Gas Speciali Italia', 'HPLC Service', 'Infolab Sistemi', 'Laser Ottica', 'Microscopia Avanzata', 'Nord Vetreria', 'Officine Meccaniche Sestesi', 'Polimeri Fiorentini', 'Quarzo e Silice', 'Reagenti Puri', 'Spettro Analitica', 'Termostati Italiani', 'Ultravuoto', 'Vetro Scientifico', 'Zeta Informatica', 'Arno Pulizie', 'Biblioteca Servizi', 'Catering Toscano', 'Dispositivi Medici Centro', 'Edilizia Sesto', 'Ferramenta Industriale', 'Gestione Rifiuti Speciali', 'Hotel Convegni Pisa', 'Impianti Elettrici Rossi', 'Licenze Software', 'Manutenzioni Generali', 'Noleggi Veicoli', 'Ottica di Precisione', 'Pompe e Valvole', 'Quadri Elettrici', 'Ricambi Strumentali', 'Sicurezza Lavoro', 'Traslochi Firenze', 'Utensileria Tecnica'];
const FORME = ['S.r.l.', 'S.p.A.', 'S.r.l.s.', 'S.n.c.'];
/** IBAN italiano con cifre di controllo valide (mod 97); numeri inventati. */
function ibanIt(k) {
  const bban = 'X' + String(5428 + (k % 50)).padStart(5, '0') + String(11101 + k).padStart(5, '0') + String(100000 + k * 7919).padStart(12, '0');
  const num = (bban + 'IT00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of num) m = (m * 10 + +ch) % 97;
  return 'IT' + String(98 - m).padStart(2, '0') + bban;
}
const FORNITORI = NOMI.map((n, i) => ({ nome: `${n} ${FORME[i % 4]}`, piva: piva(1234560 + i * 7919), iban: ibanIt(i), citta: pick(['Firenze', 'Pisa', 'Sesto Fiorentino', 'Prato', 'Livorno', 'Bologna', 'Milano']) }));
const CNR = 'Consiglio Nazionale delle Ricerche - Istituto di Chimica dei Composti OrganoMetallici (ICCOM), Via Madonna del Piano 10, 50019 Sesto Fiorentino (FI) - C.F. 80054330586 - P.IVA 02118311006';
const PERSONE = ['Mario Rossi', 'Anna Bianchi', 'Luca Verdi', 'Giulia Neri', 'Paolo Gialli', 'Sara Conti', 'Marco Ferri', 'Elena Galli'];
const LUOGHI = ['Roma', 'Milano', 'Bologna', 'Napoli', 'Torino', 'Bruxelles', 'Parigi', 'Monaco di Baviera'];
// acquisti: stesso CIG su determina, ordine e fattura (pratica collegata)
const ACQUISTI = [];
const acquisto = () => { if (ACQUISTI.length < 80 && rnd() < 0.5) { const a = { f: null, cig: null }; ACQUISTI.push(a); return a; } return ACQUISTI.length ? pick(ACQUISTI) : null; };
const cig = () => pick(['Z', 'A', 'B', '9']) + Array.from({ length: 9 }, () => pick('0123456789ABCDEF'.split(''))).join('');
const cup = () => `B${int(10, 99)}C${int(10, 99)}${String(int(0, 999999999)).padStart(9, '0')}`;
const dataCasuale = () => giorni(OGGI, -int(0, 700));

let font, bold;
async function pdf(righe, opz = {}) {
  const { pagine = 1, firma = null, scansione = false, password = null } = opz;
  const d = await PDFDocument.create();
  font = await d.embedFont(StandardFonts.Helvetica); bold = await d.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < pagine; p++) {
    const pg = d.addPage([595, 842]);
    if (scansione) {
      // «scansione»: solo grafica, nessun testo
      for (let k = 0; k < 40; k++) pg.drawRectangle({ x: 50 + rnd() * 400, y: 60 + rnd() * 700, width: 20 + rnd() * 120, height: 3 + rnd() * 6, color: rgb(0.2, 0.2, 0.2) });
      continue;
    }
    let y = 790;
    const blocco = p === 0 ? righe : [`Pagina ${p + 1} di ${pagine}`, ...righe.slice(-6).map((r) => (typeof r === 'string' ? r : r.t) + ' (segue)'), 'Condizioni generali di fornitura: la merce viaggia a rischio del committente salvo diverso accordo scritto.'];
    for (const r of blocco) {
      const t = typeof r === 'string' ? r : r.t;
      const f = typeof r === 'object' && r.b ? bold : font;
      const size = typeof r === 'object' && r.s ? r.s : 10;
      for (const line of wrap(t, f, size, 495)) { pg.drawText(line, { x: 50, y, size, font: f }); y -= size + 4; if (y < 50) break; }
      y -= 2;
    }
  }
  if (opz.striscia) {
    const pg = d.getPages()[0];
    if (Canvas) pg.drawImage(await d.embedPng(strisciaPng(opz.striscia)), { x: 0, y: 218, width: 17, height: 624 });
    else pg.drawText(opz.striscia, { x: 10, y: 230, size: 7, font, color: rgb(0.75, 0, 0), rotate: degrees(90) });
  }
  if (firma) {
    const sig = d.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'ETSI.CAdES.detached', ByteRange: [0, 0, 0, 0], Name: PDFString.of(firma), M: PDFString.of('D:20261001100000Z') });
    d.context.register(sig);
  }
  if (password) d.encrypt({ userPassword: password, ownerPassword: password + 'x' });
  return d.save({ useObjectStreams: false });
}
function wrap(t, f, size, w) {
  const out = []; let cur = '';
  for (const word of String(t).replace(/[^\x20-\x7e -ÿ€]/g, '?').split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (f.widthOfTextAtSize(next, size) > w && cur) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// segnatura stampata dal protocollo informatico (Titulus) su una parte dei documenti ricevuti
let progressivoTitulus = 4100;
// numeri INVENTATI: due forme, come testo nell'intestazione o come striscia-immagine verticale sul margine sinistro
const prossimoNumero = () => (rnd() < 0.02 && progressivoTitulus > 4100 ? progressivoTitulus : ++progressivoTitulus); // ~2%: stesso numero su due documenti (anomalia)
const segnaturaTitulus = (d) => {
  const x = rnd();
  if (x < 0.12) return [`CNR-ICCOM - ${String(prossimoNumero()).padStart(7, '0')} - ${it(giorni(d, int(0, 5)))}`];
  if (x < 0.30) prossimaStriscia = `Prot. CNR n. ${String(prossimoNumero()).padStart(7, '0')} del ${it(giorni(d, int(0, 5)))} - UOR: SI${String(int(1, 99)).padStart(6, '0')}`;
  return [];
};
let prossimaStriscia = null;
/** PNG 69×2493 con la segnatura in rosso, scritta dall'alto verso il basso (come la striscia di Titulus). */
function strisciaPng(testo) {
  const c = Canvas.createCanvas(69, 2493); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 69, 2493);
  ctx.translate(20, 20); ctx.rotate(Math.PI / 2); // dall'alto in basso, come la striscia vista al CNR
  ctx.fillStyle = '#c00000'; ctx.font = 'bold 44px sans-serif'; ctx.fillText(testo, 0, 0);
  return c.toBuffer('image/png');
}
function intestazione(f) { return [{ t: f.nome, b: true, s: 14 }, `Via dell'Industria ${int(1, 200)} - ${f.citta}`, `P.IVA ${f.piva} - C.F. ${f.piva}`, '']; }

async function fattura(nota = false) {
  const acq = !nota && rnd() < 0.6 ? acquisto() : null;
  const f = acq?.f || pick(FORNITORI); const d = dataCasuale(); const n = `${int(1, 999)}/${d.getUTCFullYear()}`;
  if (acq) { acq.f = f; acq.cig ??= cig(); }
  const righe = Array.from({ length: int(1, 6) }, () => ({ desc: pick(['Reagente analitico', 'Colonna cromatografica', 'Manutenzione strumento', 'Vetreria da laboratorio', 'Licenza software annuale', 'Servizio di pulizia', 'Gas tecnici in bombola', 'Materiale di consumo', 'Assistenza tecnica', 'Noleggio attrezzatura']), imp: int(20, 4000) + int(0, 99) / 100 }));
  const imponibile = righe.reduce((s, r) => s + r.imp, 0); const iva = Math.round(imponibile * 22) / 100;
  const scad = giorni(d, pick([30, 60, 90]));
  const conCig = rnd() < 0.85; const conCup = rnd() < 0.35;
  const c = acq?.cig || cig(); const u = cup();
  const ibanFattura = rnd() < 0.08 ? ibanIt(500 + int(0, 99)) : f.iban; // qualche IBAN diverso da quello dichiarato
  const testo = [...segnaturaTitulus(d), ...intestazione(f), { t: nota ? `NOTA DI CREDITO N. ${n} del ${it(d)}` : `FATTURA N. ${n} del ${it(d)}`, b: true, s: 13 },
    'Spett.le', CNR, '',
    conCig ? `CIG: ${c}` : 'Riferimento ordine: vedi allegato', conCup ? `CUP: ${u}` : '',
    ...righe.map((r) => `${r.desc} .......... € ${euro(r.imp)}`), '',
    `Imponibile € ${euro(imponibile)}`, `IVA 22% € ${euro(iva)} (scissione dei pagamenti art. 17-ter DPR 633/72)`,
    { t: `Totale documento € ${euro(imponibile + iva)}`, b: true },
    `Modalità di pagamento: bonifico bancario. Scadenza pagamento: ${it(scad)}`, `IBAN ${ibanFattura}`];
  const striscia = prossimaStriscia; prossimaStriscia = null;
  const bytes = await pdf(testo, { pagine: rnd() < 0.2 ? int(2, 4) : 1, striscia });
  const sub = path.join(nota ? 'Note di credito' : 'Fatture', String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1));
  const nome = nota ? `NC_${f.nome.split(' ')[0]}_${n.replace('/', '-')}.pdf` : pick([`Fattura_${f.nome.split(' ')[0]}_${n.replace('/', '-')}.pdf`, `fatt ${n.replace('/', '_')} ${f.nome.split(' ')[0].toLowerCase()}.pdf`, `${iso(d)}_${f.piva}.pdf`, `scan${int(1000, 9999)}.pdf`]);
  return { sub, nome, bytes };
}

function xmlFattura() {
  const f = pick(FORNITORI); const d = dataCasuale(); const n = `FE${int(1, 9999)}`;
  const imp = int(100, 9000) + int(0, 99) / 100; const iva = Math.round(imp * 22) / 100;
  const scad = giorni(d, 30);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPA12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
<FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${f.piva}</IdCodice></IdTrasmittente><ProgressivoInvio>${int(10000, 99999)}</ProgressivoInvio><FormatoTrasmissione>FPA12</FormatoTrasmissione><CodiceDestinatario>ABC123</CodiceDestinatario></DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${f.piva}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>${f.nome}</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici><Sede><Indirizzo>Via Roma 1</Indirizzo><CAP>50100</CAP><Comune>${f.citta}</Comune><Nazione>IT</Nazione></Sede></CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>02118311006</IdCodice></IdFiscaleIVA><CodiceFiscale>80054330586</CodiceFiscale><Anagrafica><Denominazione>CNR ICCOM</Denominazione></Anagrafica></DatiAnagrafici><Sede><Indirizzo>Via Madonna del Piano 10</Indirizzo><CAP>50019</CAP><Comune>Sesto Fiorentino</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente></FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>${rnd() < 0.05 ? 'TD04' : 'TD01'}</TipoDocumento><Divisa>EUR</Divisa><Data>${iso(d)}</Data><Numero>${n}</Numero><ImportoTotaleDocumento>${(imp + iva).toFixed(2)}</ImportoTotaleDocumento><Causale>Fornitura materiale di laboratorio</Causale></DatiGeneraliDocumento>
<DatiOrdineAcquisto><IdDocumento>ORD${int(1, 500)}</IdDocumento><CodiceCUP>${cup()}</CodiceCUP><CodiceCIG>${cig()}</CodiceCIG></DatiOrdineAcquisto></DatiGenerali>
<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Materiale di consumo per laboratorio</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>${imp.toFixed(2)}</PrezzoUnitario><PrezzoTotale>${imp.toFixed(2)}</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
<DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>${imp.toFixed(2)}</ImponibileImporto><Imposta>${iva.toFixed(2)}</Imposta><EsigibilitaIVA>S</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>${iso(scad)}</DataScadenzaPagamento><ImportoPagamento>${imp.toFixed(2)}</ImportoPagamento><IBAN>${f.iban}</IBAN></DettaglioPagamento></DatiPagamento></FatturaElettronicaBody>
</p:FatturaElettronica>`;
  return { sub: path.join('Fatture elettroniche', String(d.getUTCFullYear())), nome: `IT${f.piva}_${n}.xml`, bytes: Buffer.from(xml) };
}

let keys, cert;
function firmaP7m(bytes) {
  if (!keys) {
    keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
    cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.UTC(2020, 0, 1)); cert.validity.notAfter = new Date(Date.UTC(2035, 0, 1));
    const attrs = [{ name: 'commonName', value: 'MARIO ROSSI' }, { name: 'countryName', value: 'IT' }, { type: '2.5.4.42', value: 'MARIO' }, { type: '2.5.4.4', value: 'ROSSI' }];
    cert.setSubject(attrs); cert.setIssuer([{ name: 'commonName', value: 'Certificatore di prova' }]); cert.sign(keys.privateKey, forge.md.sha256.create());
  }
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.from(bytes).toString('binary'));
  p7.addCertificate(cert);
  p7.addSigner({ key: keys.privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() }] });
  p7.sign();
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

async function durc(i) {
  const f = FORNITORI[i % FORNITORI.length];
  // i DURC più recenti di ogni fornitore: alcuni scaduti, alcuni in scadenza, gli altri validi
  const giro = Math.floor(i / FORNITORI.length);
  const richiesta = giro === 0 ? giorni(OGGI, -int(80, 140)) : giorni(OGGI, -120 * giro - int(10, 100));
  const scad = giorni(richiesta, 120);
  const prot = `INPS_${int(30000000, 49999999)}`;
  const testo = [{ t: 'Durc On Line', b: true, s: 14 }, { t: 'DOCUMENTO UNICO DI REGOLARITA\' CONTRIBUTIVA', b: true }, `Numero Protocollo ${prot}`, `Data richiesta ${it(richiesta)}`, `Scadenza validità ${it(scad)}`, '',
    `Denominazione/ragione sociale ${f.nome}`, `Codice fiscale ${f.piva}`, `Sede legale Via Roma ${int(1, 99)} ${f.citta}`, '',
    'Con il presente Documento si dichiara che il soggetto sopra identificato RISULTA REGOLARE nei confronti di I.N.P.S., I.N.A.I.L. e CNCE.',
    'Il Documento ha validità di 120 giorni dalla data della richiesta e si riferisce alla risultanza, alla stessa data, dell\'interrogazione degli archivi.'];
  return { sub: path.join('DURC', f.nome.split(' ')[0]), nome: `DURC_${f.nome.split(' ')[0]}_${iso(richiesta)}.pdf`, bytes: await pdf(testo) };
}

async function ordine() {
  const acq = rnd() < 0.7 ? acquisto() : null;
  const f = acq?.f || pick(FORNITORI); const d = dataCasuale(); const det = rnd() < 0.5;
  if (acq) { acq.f = f; acq.cig ??= cig(); }
  const cigOrdine = acq?.cig || cig();
  const n = `${int(1, 999)}/${d.getUTCFullYear()}`; const imp = int(500, 39000) + int(0, 99) / 100;
  const testo = det
    ? [{ t: 'CONSIGLIO NAZIONALE DELLE RICERCHE - ISTITUTO ICCOM', b: true }, { t: `DETERMINA A CONTRARRE N. ${n}`, b: true, s: 13 }, `Sesto Fiorentino, ${it(d)}`, '',
      'IL DIRETTORE', `VISTO il D.Lgs. 36/2023; CONSIDERATA la necessità di acquisire la fornitura di materiale di laboratorio per il progetto in corso;`,
      `DETERMINA di affidare a ${f.nome} (P.IVA ${f.piva}) la fornitura per un importo complessivo di € ${euro(imp)} oltre IVA.`, `CIG ${cigOrdine}`, rnd() < 0.5 ? `CUP ${cup()}` : '', 'Il Responsabile Unico del Progetto è nominato con il presente atto.']
    : [...segnaturaTitulus(d), { t: 'CNR - ICCOM - Ufficio Acquisti', b: true }, { t: `ORDINE DI ACQUISTO N. ${n} del ${it(d)}`, b: true, s: 13 }, `Spett.le ${f.nome}`, `P.IVA ${f.piva}`, '',
      `Si ordina la fornitura di quanto segue per un importo totale di € ${euro(imp)} IVA esclusa.`, `CIG: ${cigOrdine}`, 'Consegna presso il magazzino dell\'Istituto entro 30 giorni.', 'Fatturazione elettronica: codice univoco ufficio ABC123.'];
  const striscia = prossimaStriscia; prossimaStriscia = null;
  return { sub: path.join('Ordini e determine', String(d.getUTCFullYear())), nome: `${det ? 'Determina' : 'Ordine'}_${n.replace('/', '-')}.pdf`, bytes: await pdf(testo, { pagine: det ? int(1, 3) : 1, striscia }) };
}

async function tracciabilita(k) {
  const f = FORNITORI[k % FORNITORI.length]; const d = giorni(OGGI, -int(30, 600));
  const testo = [{ t: f.nome, b: true, s: 13 }, `P.IVA ${f.piva}`, '', { t: 'DICHIARAZIONE SOSTITUTIVA - COMUNICAZIONE DEL CONTO CORRENTE DEDICATO', b: true },
    'ai sensi dell\'art. 3 della Legge 136/2010 sulla tracciabilità dei flussi finanziari', `Spett.le ${CNR}`, '',
    `Il sottoscritto legale rappresentante di ${f.nome} comunica che il conto corrente dedicato, anche in via non esclusiva, alle commesse pubbliche è:`,
    `IBAN ${f.iban}`, `presso Banca di prova, filiale di ${f.citta}`, `Data ${it(d)}`];
  return { sub: path.join('Fornitori', f.nome.split(' ')[0]), nome: `Tracciabilita_${f.nome.split(' ')[0]}.pdf`, bytes: await pdf(testo) };
}

async function mepa() {
  const acq = acquisto(); const f = acq?.f || pick(FORNITORI); const d = dataCasuale();
  if (acq) { acq.f = f; acq.cig ??= cig(); }
  const testo = [{ t: 'MERCATO ELETTRONICO DELLA PUBBLICA AMMINISTRAZIONE', b: true }, { t: `DOCUMENTO DI STIPULA - TRATTATIVA DIRETTA N. ${int(1000000, 9999999)}`, b: true, s: 12 },
    `Stazione appaltante: ${CNR}`, `Fornitore: ${f.nome} - P.IVA ${f.piva}`, `CIG ${acq?.cig || cig()}`, `Importo contrattuale € ${euro(int(1000, 39000))} IVA esclusa`, `Data di stipula ${it(d)}`];
  return { sub: path.join('MePA', String(d.getUTCFullYear())), nome: `MePA_TD_${f.nome.split(' ')[0]}_${iso(d)}.pdf`, bytes: await pdf(testo, { firma: 'Punto ordinante' }) };
}

async function incarico() {
  const p = pick(PERSONE); const d = giorni(OGGI, -int(5, 200)); const fine = giorni(d, int(90, 700));
  const testo = [{ t: 'CNR - Istituto ICCOM', b: true }, { t: pick(['CONTRATTO DI COLLABORAZIONE', 'CONFERIMENTO DI INCARICO DI COLLABORAZIONE', 'CONTRATTO DI RICERCA']), b: true, s: 13 },
    `Con il presente atto si procede al conferimento dell'incarico a ${p}`, `Durata: dal ${it(d)} al ${it(fine)}`, `Compenso lordo € ${euro(int(5000, 30000))}`, `Data ${it(d)}`, rnd() < 0.5 ? `CUP ${cup()}` : ''];
  return { sub: path.join('Incarichi', String(d.getUTCFullYear())), nome: `Incarico_${p.split(' ')[1]}_${iso(d)}.pdf`, bytes: await pdf(testo) };
}

async function missione() {
  const p = pick(PERSONE); const d = dataCasuale(); const l = pick(LUOGHI); const imp = int(80, 2500) + int(0, 99) / 100;
  const testo = [{ t: 'CNR - Istituto ICCOM', b: true }, { t: pick(['RICHIESTA DI RIMBORSO SPESE DI MISSIONE', 'ORDINE DI MISSIONE', 'AUTORIZZAZIONE ALLA MISSIONE']), b: true, s: 13 }, `Missione n. ${int(1, 400)}/${d.getUTCFullYear()}`,
    `Incaricato: ${p}`, `Destinazione: ${l}`, `Dal ${it(d)} al ${it(giorni(d, int(1, 5)))}`, `Motivo: partecipazione a convegno scientifico`, `Mezzo: treno`, `Totale rimborso richiesto € ${euro(imp)}`, rnd() < 0.3 ? `CUP ${cup()}` : ''];
  return { sub: path.join('Missioni', String(d.getUTCFullYear()), p.split(' ')[1]), nome: `missione_${p.split(' ')[1].toLowerCase()}_${iso(d)}.pdf`, bytes: await pdf(testo) };
}

async function contratto(i) {
  const f = pick(FORNITORI); const d = dataCasuale(); const imp = int(5000, 200000);
  const testo = [{ t: 'CONTRATTO DI FORNITURA E SERVIZI', b: true, s: 14 }, `Rep. n. ${int(1, 300)}/${d.getUTCFullYear()}`, 'TRA', CNR, 'E', `${f.nome}, con sede in ${f.citta}, P.IVA ${f.piva}`, '',
    `Art. 1 - Oggetto: fornitura di strumentazione e assistenza tecnica.`, `Art. 2 - Importo contrattuale: € ${euro(imp)} oltre IVA.`, `Art. 3 - Durata: 36 mesi a decorrere dal ${it(d)}.`, `CIG ${cig()}`, 'Art. 4 - Tracciabilità dei flussi finanziari ai sensi della L. 136/2010.'];
  return { sub: 'Contratti', nome: `Contratto_${f.nome.split(' ')[0]}_${d.getUTCFullYear()}.pdf`, bytes: await pdf(testo, { pagine: int(2, 6), firma: i % 2 ? 'Mario Rossi' : null }) };
}

function pec() {
  const f = pick(FORNITORI); const d = dataCasuale();
  const oggetto = pick(['Trasmissione fattura', 'Invio DURC aggiornato', 'Offerta economica', 'Richiesta chiarimenti ordine', 'Comunicazione conto dedicato']);
  const b = 'BOUNDARY' + int(1000, 9999);
  const eml = `From: "Per conto di: info@${f.nome.split(' ')[0].toLowerCase()}.it" <posta-certificata@pec.aruba.it>\r\nTo: protocollo.iccom@pec.cnr.it\r\nSubject: POSTA CERTIFICATA: ${oggetto}\r\nDate: ${d.toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMessaggio di posta certificata.\r\nIl giorno ${it(d)} il messaggio "${oggetto}" è stato inviato da info@${f.nome.split(' ')[0].toLowerCase()}.it.\r\n\r\nSpett.le ICCOM, si trasmette in allegato la documentazione richiesta.\r\n${f.nome} - P.IVA ${f.piva}\r\n--${b}\r\nContent-Type: application/pdf; name="allegato.pdf"\r\nContent-Disposition: attachment; filename="allegato.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--${b}--\r\n`;
  return { sub: path.join('PEC', String(d.getUTCFullYear())), nome: `PEC_${iso(d)}_${oggetto.replace(/\s+/g, '_')}_${int(100, 999)}.eml`, bytes: Buffer.from(eml) };
}

const t0 = Date.now();
fs.mkdirSync(dir, { recursive: true });
const piano = [
  ['fattura', 0.33], ['nota', 0.02], ['xml', 0.06], ['p7m', 0.015], ['durc', 0.10], ['ordine', 0.15], ['missione', 0.10], ['contratto', 0.05], ['tracciabilita', 0.011], ['mepa', 0.02], ['incarico', 0.015], ['pec', 0.05], ['scansione', 0.06], ['corrotto', 0.015], ['protetto', 0.012],
];
const conteggi = {};
let i = 0; let byte = 0;
const nomiUsati = new Set();
async function scrivi(doc) {
  let p = path.join(dir, doc.sub, doc.nome); let k = 2;
  while (nomiUsati.has(p.toLowerCase())) { p = path.join(dir, doc.sub, doc.nome.replace(/(\.[a-z0-9]+(?:\.p7m)?)$/i, ` (${k++})$1`)); }
  nomiUsati.add(p.toLowerCase());
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, doc.bytes);
  byte += doc.bytes.length;
}
for (const [tipo, quota] of piano) {
  const n = Math.max(1, Math.round(N * quota));
  conteggi[tipo] = n;
  for (let k = 0; k < n; k++, i++) {
    if (tipo === 'fattura') await scrivi(await fattura());
    else if (tipo === 'nota') await scrivi(await fattura(true));
    else if (tipo === 'xml') await scrivi(xmlFattura());
    else if (tipo === 'p7m') { const x = rnd() < 0.5 ? xmlFattura() : { ...(await contratto(0)), sub: 'Firmati' }; await scrivi({ ...x, nome: x.nome + '.p7m', bytes: firmaP7m(x.bytes) }); }
    else if (tipo === 'durc') await scrivi(await durc(k));
    else if (tipo === 'ordine') await scrivi(await ordine());
    else if (tipo === 'missione') await scrivi(await missione());
    else if (tipo === 'contratto') await scrivi(await contratto(k));
    else if (tipo === 'pec') await scrivi(pec());
    else if (tipo === 'scansione') await scrivi({ sub: 'Scansioni', nome: `SCAN_${pad(k + 1, 4)}.pdf`, bytes: await pdf([], { pagine: int(1, 3), scansione: true }) });
    else if (tipo === 'corrotto') {
      const ok = (await fattura()).bytes;
      const b = k % 3 === 0 ? ok.slice(0, Math.floor(ok.length * 0.4)) : k % 3 === 1 ? Buffer.from('%PDF-1.7\n' + 'spazzatura '.repeat(200)) : Buffer.from('<html>non sono un pdf</html>');
      await scrivi({ sub: 'Da sistemare', nome: `documento_rovinato_${k + 1}.pdf`, bytes: b });
    } else if (tipo === 'tracciabilita') { await scrivi(await tracciabilita(k)); }
    else if (tipo === 'mepa') { await scrivi(await mepa()); }
    else if (tipo === 'incarico') { await scrivi(await incarico()); }
    else if (tipo === 'protetto') {
      const f = pick(FORNITORI);
      await scrivi({ sub: 'Riservati', nome: `riservato_${k + 1}.pdf`, bytes: await pdf([{ t: 'DOCUMENTO RISERVATO', b: true }, `Contratto con ${f.nome}`], { password: 'segreta' }) });
    }
  }
}
// PNG in scala di grigi con «rumore» (non comprimibile): simula una scansione a 150 dpi
function pngRumore(w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = 200 + Math.floor(rnd() * 55) - ((y % 40 < 3 && x > 80 && x < w - 80) ? 150 : 0); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
for (let k = 0; k < PESANTI; k++, i++) {
  const d = await PDFDocument.create();
  const img = await d.embedPng(pngRumore(1240, 1754));
  for (let p = 0; p < 1 + (k % 2); p++) d.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  await scrivi({ sub: path.join('Scansioni pesanti', String(2025 + (k % 2))), nome: `scansione_ufficio_${pad(k + 1, 4)}.pdf`, bytes: await d.save() });
  conteggi.pesanti = (conteggi.pesanti || 0) + 1;
}
if (GRANDE) {
  // un file oltre il limite di lettura (200 MB): indicizzato solo per nome
  const p = path.join(dir, 'Grandi', 'scansione_enorme.pdf'); fs.mkdirSync(path.dirname(p), { recursive: true });
  const fd = fs.openSync(p, 'w'); fs.writeSync(fd, '%PDF-1.4\n%' + 'x'.repeat(100) + '\n'); const blk = Buffer.alloc(8 * 1024 * 1024, 32);
  for (let k = 0; k < 27; k++) fs.writeSync(fd, blk); fs.closeSync(fd); conteggi.grande = 1;
}
console.log(JSON.stringify({ cartella: dir, documenti: i, mb: Math.round(byte / 1048576), conteggi, secondi: Math.round((Date.now() - t0) / 1000) }));
