import { describe, it, expect } from 'vitest';
import { creaDoc, ricarica, etichette, PDFDocument } from './pagine-helpers.js';
import * as S from '../src/renderer/features/pagine/logica/struttura.js';
import { intervalli, gruppiIntervalli, indiciInTesto, validaIndici } from '../src/renderer/features/pagine/logica/util.js';

const lab = (d) => etichette(d).map((s) => +s.replace('Pagina ', ''));

describe('intervalli di pagine', () => {
  it('casi normali e limite', () => {
    expect(intervalli('', 3)).toEqual([0, 1, 2]);
    expect(intervalli('1-2, 5', 5)).toEqual([0, 1, 4]);
    expect(intervalli('3-', 4)).toEqual([2, 3]);
    expect(intervalli('pari', 5)).toEqual([1, 3]);
    expect(intervalli('dispari', 1)).toEqual([0]);
    expect(intervalli('ultima', 7)).toEqual([6]);
    expect(intervalli('1 – 3; 5', 6)).toEqual([0, 1, 2, 4]);
    expect(() => intervalli('9', 3)).toThrow(/non esiste/);
    expect(() => intervalli('abc', 3)).toThrow(/Non capisco/);
    expect(() => intervalli('3-1', 3)).toThrow(/non valido/);
    expect(gruppiIntervalli('1-2, 3', 3)).toEqual([[0, 1], [2]]);
    expect(indiciInTesto([0, 1, 2, 4, 6, 7])).toBe('1-3, 5, 7-8');
    expect(() => validaIndici([], 3)).toThrow(/almeno una/);
  });
});

describe('struttura delle pagine', () => {
  it('riordina, sposta e inverte mantenendo moduli e annotazioni', async () => {
    const d = await creaDoc(6, { modulo: true, annot: true });
    S.riordina(d, [5, 4, 3, 2, 1, 0]);
    let r = await ricarica(d);
    expect(lab(r)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(r.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['nome', 'ok', 'scelta']);
    expect(r.getForm().getTextField('nome').getText()).toBe('Mario');
    S.sposta(r, [0], 6); // prima pagina in fondo
    expect(lab(r)).toEqual([5, 4, 3, 2, 1, 6]);
    S.inverti(r, [0, 1, 2]);
    r = await ricarica(r);
    expect(lab(r)).toEqual([3, 4, 5, 2, 1, 6]);
    expect(r.getPage(0).node.Annots().size()).toBe(1);
  });

  it('elimina: casi limite e pulizia dei campi', async () => {
    const d = await creaDoc(3, { modulo: true });
    expect(() => S.elimina(d, [0, 1, 2])).toThrow(/tutte le pagine/);
    expect(() => S.elimina(d, [])).toThrow(/almeno una/);
    S.elimina(d, [1]); // pagina con casella e gruppo radio
    const r = await ricarica(d);
    expect(lab(r)).toEqual([1, 3]);
    expect(r.getForm().getFields().map((f) => f.getName())).toEqual(['nome']);
    S.elimina(r, [1]); // ultima pagina
    expect((await ricarica(r)).getPageCount()).toBe(1);
  });

  it('duplica con campi rinominati, anche su documento da 1 pagina', async () => {
    const d = await creaDoc(2, { modulo: true });
    S.duplica(d, [0, 1]);
    const r = await ricarica(d);
    expect(lab(r)).toEqual([1, 1, 2, 2]);
    const nomi = r.getForm().getFields().map((f) => f.getName()).sort();
    expect(nomi).toEqual(['nome', 'nome_2', 'ok', 'ok_2', 'scelta', 'scelta_2']);
    expect(r.getForm().getRadioGroup('scelta_2').getOptions().length).toBe(2);
    const uno = await creaDoc(1);
    S.duplica(uno, [0], { copie: 3, dove: 'fine' });
    expect((await ricarica(uno)).getPageCount()).toBe(4);
  });

  it('ruota con controllo dell\'angolo', async () => {
    const d = await creaDoc(2);
    S.ruota(d, [1], 90); S.ruota(d, [1], 270); S.ruota(d, [0], -90);
    const r = await ricarica(d);
    expect(r.getPage(0).getRotation().angle).toBe(270);
    expect(r.getPage(1).getRotation().angle).toBe(0);
    expect(() => S.ruota(d, [0], 45)).toThrow();
  });

  it('inserisce vuote e da file esterno con moduli, e sostituisce', async () => {
    const d = await creaDoc(3, { modulo: true });
    S.inserisciVuote(d, 0, 2, [612, 792]);
    expect(d.getPageCount()).toBe(5);
    expect(d.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const est = await creaDoc(2, { modulo: true });
    await S.inserisciDaPdf(d, est, [0, 1], 5);
    let r = await ricarica(d);
    expect(r.getPageCount()).toBe(7);
    expect(r.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['nome', 'nome_2', 'ok', 'ok_2', 'scelta', 'scelta_2']);
    const est2 = await creaDoc(4);
    await S.sostituisci(r, [2], est2, [3]);
    r = await ricarica(r);
    expect(lab(r)[2]).toBe(4);
    await expect(S.sostituisci(r, [0, 1], est2, [0])).rejects.toThrow(/uguale/);
  });

  it('estrae in un nuovo documento senza trascinare il resto', async () => {
    const d = await creaDoc(10, { modulo: true });
    const out = await S.estraiInNuovo(d, [1, 9]);
    const r = await ricarica(out);
    expect(lab(r)).toEqual([2, 10]);
    expect(r.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['ok', 'scelta']);
    const tutto = (await d.save()).length;
    expect((await out.save()).length).toBeLessThan(tutto);
  });

  it('applica una disposizione dalla vista Organizza', async () => {
    const d = await creaDoc(4, { modulo: true });
    const est = await creaDoc(2);
    const items = [
      { tipo: 'pagina', indice: 3, rot: 90 },
      { tipo: 'esterna', file: 'e', indice: 1 },
      { tipo: 'pagina', indice: 0 },
      { tipo: 'pagina', indice: 0, rot: 180 },
      { tipo: 'vuota', size: [300, 300] },
    ];
    await S.applicaDisposizione(d, items, new Map([['e', est]]));
    const r = await ricarica(d);
    expect(lab(r)).toEqual([4, 2, 1, 1, NaN]);
    expect(r.getPage(0).getRotation().angle).toBe(90);
    expect(r.getPage(3).getRotation().angle).toBe(180);
    expect(r.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['nome', 'nome_2']);
    await expect(S.applicaDisposizione(d, [])).rejects.toThrow(/almeno una/);
  });

  it('gestisce alberi Pages annidati con attributi ereditati', async () => {
    const d = await creaDoc(4);
    // sposta MediaBox sul nodo radice e crea un nodo intermedio
    const { PDFName } = await import('@cantoo/pdf-lib');
    const ctx = d.context; const root = d.catalog.Pages(); const rootRef = d.catalog.get(PDFName.of('Pages'));
    const kids = root.lookup(PDFName.of('Kids')).asArray();
    const mid = ctx.obj({ Type: 'Pages', Kids: kids.slice(2), Count: 2, Parent: rootRef }); const midRef = ctx.register(mid);
    for (const k of kids) ctx.lookup(k).delete(PDFName.of('MediaBox'));
    kids.slice(2).forEach((k) => ctx.lookup(k).set(PDFName.of('Parent'), midRef));
    root.set(PDFName.of('Kids'), ctx.obj([...kids.slice(0, 2), midRef]));
    root.set(PDFName.of('MediaBox'), ctx.obj([0, 0, 400, 500]));
    const r0 = await ricarica(d);
    S.riordina(r0, [3, 2, 1, 0]);
    const r = await ricarica(r0);
    expect(lab(r)).toEqual([4, 3, 2, 1]);
    expect(r.getPage(0).getSize()).toEqual({ width: 400, height: 500 });
  });

  it('carica PDF non validi con messaggio chiaro', async () => {
    await expect(S.caricaPdf(new Uint8Array([1, 2, 3]), { nome: 'x.pdf' })).rejects.toThrow(/non sembra un PDF/);
  });
});
