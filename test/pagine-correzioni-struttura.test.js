// Correzioni: divisione per dimensione dopo un gruppo da una pagina, duplicati di pagine esterne in Organizza.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { creaDoc } from './pagine-helpers.js';
import { pianoDimensione } from '../src/renderer/features/pagine/logica/dividi.js';
import { applicaDisposizione } from '../src/renderer/features/pagine/logica/struttura.js';

describe('dividi per dimensione', () => {
  it('dopo una prima pagina troppo grande i gruppi successivi tornano a crescere', async () => {
    const doc = await creaDoc(20);
    // pagina 1 pesante: flusso non comprimibile da 120 KB
    const rnd = new Uint8Array(120 * 1024); let x = 12345;
    for (let i = 0; i < rnd.length; i++) { x = (x * 1103515245 + 12345) >>> 0; rnd[i] = x >>> 24; }
    doc.getPage(0).node.set(PDFName.of('Pesante'), doc.context.register(doc.context.stream(rnd, {})));
    const bytes = await doc.save();
    const parti = await pianoDimensione(() => PDFDocument.load(bytes), 20, 100 * 1024);
    expect(parti.map((p) => p.indici.length)).toEqual([1, 19]);
    expect(parti[0].troppoGrande).toBe(true);
    expect(parti[1].troppoGrande).toBe(false);
  }, 60000);
});

describe('Organizza: pagina esterna duplicata', () => {
  it('ogni copia ha le proprie annotazioni e un proprio campo modulo', async () => {
    const ext = await PDFDocument.create();
    const p = ext.addPage([595, 842]);
    const t = ext.getForm().createTextField('nome'); t.setText('Mario'); t.addToPage(p, { x: 50, y: 500, width: 200, height: 24 });
    const src = await PDFDocument.load(await ext.save());
    const doc = await creaDoc(1);
    const fin = await applicaDisposizione(doc, [{ tipo: 'pagina', indice: 0 }, { tipo: 'esterna', file: 'a', indice: 0 }, { tipo: 'esterna', file: 'a', indice: 0 }], new Map([['a', src]]));
    expect(fin).toHaveLength(3);
    const a1 = fin[1].node.Annots(); const a2 = fin[2].node.Annots();
    expect(a1.get(0).toString()).not.toBe(a2.get(0).toString());
    expect(a1.lookup(0).get(PDFName.of('P')).toString()).toBe(fin[1].ref.toString());
    expect(a2.lookup(0).get(PDFName.of('P')).toString()).toBe(fin[2].ref.toString());
    const out = await PDFDocument.load(await doc.save());
    const campi = out.getForm().getFields().map((f) => [f.getName(), f.acroField.getWidgets().length]);
    expect(campi).toEqual([['nome', 1], ['nome_2', 1]]);
    expect(out.getForm().getTextField('nome_2').getText()).toBe('Mario');
  });
});
