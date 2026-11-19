// Misura della compilazione in serie (non è un test: node test/personale-serie-benchmark.mjs [record]).
// Modulo AcroForm di prova con 10 campi; tempi per file singoli e per il PDF unico.
import * as PDFLib from '@cantoo/pdf-lib';
import { generaSerie, recordDaRiga, abbinaColonne } from '../src/renderer/features/personale/lib/serie.js';
import { modelloDaPdf } from '../src/renderer/features/personale/lib/modelli.js';

const N = Number(process.argv[2]) || 500;
const CAMPI = ['cognome', 'nome', 'codice_fiscale', 'data_nascita', 'luogo_nascita', 'indirizzo', 'cap', 'citta', 'email', 'telefono'];

async function modulo() {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([595, 842]);
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  const f = d.getForm();
  CAMPI.forEach((c, i) => { p.drawText(c, { x: 50, y: 760 - i * 40, size: 10, font }); f.createTextField(c).addToPage(p, { x: 180, y: 752 - i * 40, width: 300, height: 20 }); });
  return d.save();
}
const base = await modulo();
const modello = await modelloDaPdf(PDFLib, base, { nome: 'Prova' });
const intestazioni = ['Cognome', 'Nome', 'Codice fiscale', 'Data di nascita', 'Luogo di nascita', 'Indirizzo', 'CAP', 'Città', 'Email', 'Telefono'];
modello.corrispondenze = abbinaColonne(modello.campi, intestazioni);
const records = Array.from({ length: N }, (_, i) => recordDaRiga(Object.fromEntries(intestazioni.map((h) => [h, `${h} ${i + 1} àèìòù`])), intestazioni, i));
for (const unico of [false, true]) {
  const t0 = performance.now(); let byte = 0;
  const r = await generaSerie({ PDFLib, base, modello, records, opzioni: { schema: '{cognome}_{n}.pdf', unico }, onGruppo: async (g) => { for (const e of g) byte += e.bytes?.length || 0; } });
  const ms = performance.now() - t0;
  console.log(`${N} record, ${unico ? 'PDF unico' : 'file singoli'}: ${(ms / 1000).toFixed(1)} s (${(ms / N).toFixed(1)} ms/record)` + (unico ? `, ${(r.unico.length / 1e6).toFixed(1)} MB, ${r.pagineUnico} pagine` : `, ${(byte / 1e6).toFixed(1)} MB`) + `, esiti: ${r.esiti.filter((e) => e.stato !== 'errore').length} generati`);
}
