// Operazioni dell'area «conversione» nelle Azioni guidate dell'area avanzati (evento 'batch:operations').
// OCR e PDF/A trasformano il PDF; le esportazioni (Word, testo, Excel) scrivono il file convertito
// in una cartella scelta e lasciano il PDF invariato.
import { LINGUE_OCR } from './ocr.js';
import { ocrSuBytes, poolOcr } from './ocr-ui.js';
import { pdfaSuBytes } from './pdfa-ui.js';
import { convertiBytes } from './esporta.js';
import { nomeBase } from './comune.js';

function campoLingue(app) {
  return {
    name: 'langs', label: 'Lingue', type: 'custom',
    render(c) {
      const scelte = new Set(Array.isArray(this.value) && this.value.length ? this.value : app.settings.get('ocr.lingue', ['ita', 'eng']));
      const boxes = LINGUE_OCR.map((l) => { const cb = app.ui.h('input', { type: 'checkbox', value: l.value, checked: scelte.has(l.value) }); c.append(app.ui.h('label', { class: 'conv-check' }, cb, ' ', l.label)); return cb; });
      return { get: () => boxes.filter((b) => b.checked).map((b) => b.value) };
    },
  };
}

function campoCartella(app) {
  return {
    name: 'cartella', label: 'Dove salvare i file convertiti', type: 'custom',
    render(c) {
      let valore = this.value || '';
      const lab = app.ui.h('span', { class: 'conv-hint' }, valore || 'Accanto agli altri risultati, nella cartella «Elaborati»');
      const btn = app.ui.h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const f = await app.platform.chooseFolder('Cartella per i file convertiti');
        if (f && f !== '__download__') { valore = f; lab.textContent = f; }
      } }, 'Scegli un\'altra cartella…');
      c.append(btn, ' ', lab);
      return { get: () => valore };
    },
    help: 'Facoltativo. Il PDF passa invariato ai passi successivi della sequenza.',
  };
}

const FORMATI = { docx: ['Word', 'docx'], txt: ['testo', 'txt'], xlsx: ['Excel', 'xlsx'], odt: ['OpenDocument', 'odt'] };

function opEsporta(app, formato) {
  const [nome, ext] = FORMATI[formato];
  return {
    id: 'conv-esporta-' + formato, label: `Esporta in ${nome} (.${ext})`, description: `Salva una copia in formato ${nome} di ogni file in una cartella`,
    fields: [campoCartella(app)],
    summary: (p) => `Esporta in ${nome}${p.cartella ? ` in ${p.cartella}` : ''}`,
    async runBytes(bytes, p, ctx = {}) {
      const out = await convertiBytes(app, bytes, formato, { title: nomeBase(ctx.name), immaginiPagina: formato === 'docx' || formato === 'odt' ? 'senza-testo' : 'mai' });
      const file = `${nomeBase(ctx.name || 'documento')}.${ext}`;
      // cartella scelta dall'utente, altrimenti accanto agli altri risultati («Elaborati»)
      if (p.cartella) await app.platform.writeInFolder(p.cartella, file, out);
      else if (typeof ctx.scriviFile === 'function') await ctx.scriviFile(file, out);
      else await app.platform.writeInFolder('__download__', file, out);
      ctx.note = [ctx.note, `${nome}: ${file}`].filter(Boolean).join(' — ');
      return bytes;
    },
  };
}

export function operazioniBatch(app) {
  return [
    {
      id: 'conv-ocr', label: 'Rendi ricercabile (OCR)', description: 'Riconosce il testo delle scansioni; i file che hanno già il testo restano come sono',
      fields: [campoLingue(app), { name: 'qualita', label: 'Precisione', type: 'select', value: '300', options: [{ value: '200', label: 'Veloce' }, { value: '300', label: 'Normale (consigliata)' }, { value: '400', label: 'Massima (testi piccoli, scontrini)' }] }],
      validate: (p) => (Array.isArray(p.langs) && !p.langs.length ? 'Scegli almeno una lingua.' : null),
      summary: (p) => `OCR (${(p.langs?.length ? p.langs : ['ita', 'eng']).join('+')})`,
      async runBytes(bytes, p, ctx = {}) {
        const report = {};
        // i worker restano accesi tra un file e l'altro (gruppo condiviso, chiuso dopo un minuto di inattività)
        const out = await ocrSuBytes(app, bytes, { langs: p.langs?.length ? p.langs : undefined, dpi: Number(p.qualita) || 300, report, pool: poolOcr, signal: ctx.signal });
        const n = report.pagine?.filter((x) => x.parole.length).length || 0;
        ctx.note = [ctx.note, out === bytes ? 'aveva già il testo: lasciato com’è' : `testo riconosciuto su ${n} ${n === 1 ? 'pagina' : 'pagine'}`].filter(Boolean).join(' — ');
        return out;
      },
    },
    {
      id: 'conv-pdfa', label: 'Converti in PDF/A (conservazione)', description: 'PDF/A-2b o 3b con verifica; facoltativo l’OCR delle scansioni',
      fields: [
        { name: 'part', label: 'Variante', type: 'select', value: '2', options: [{ value: '2', label: 'PDF/A-2b (consigliata)' }, { value: '3', label: 'PDF/A-3b (ammette allegati)' }] },
        { name: 'ocr', label: 'Riconosci prima il testo delle scansioni (OCR)', type: 'checkbox', value: true },
      ],
      summary: (p) => `PDF/A-${p.part || 2}b${p.ocr ? ' con OCR' : ''}`,
      async runBytes(bytes, p, ctx = {}) {
        const r = await pdfaSuBytes(app, bytes, { part: Number(p.part) || 2, ocr: !!p.ocr, title: nomeBase(ctx.name), lang: 'it-IT' });
        const ko = r.verifica.filter((x) => !x.ok);
        ctx.note = [ctx.note, ko.length ? `PDF/A con ${ko.length} punti da verificare: ${ko.map((x) => x.titolo).join('; ')}` : `PDF/A-${p.part || 2}b conforme (verifica di base)`].filter(Boolean).join(' — ');
        return r.bytes;
      },
    },
    opEsporta(app, 'docx'),
    opEsporta(app, 'txt'),
    opEsporta(app, 'xlsx'),
  ];
}

export function registraBatch(app) {
  app.bus.on('batch:operations', (list) => { for (const o of operazioniBatch(app)) list.push(o); });
}
