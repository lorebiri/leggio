// Correzioni del nucleo: recupero, moduli compilati, Annulla/Ripeti, tastiera, finestre modali, pagine.
import { describe, it, expect, beforeAll } from 'vitest';
import { restoreTarget } from '../src/renderer/core/recovery.js';
import { parsePageRanges } from '../src/renderer/core/ui.js';
import { integrateForms } from '../src/renderer/core/forms.js';
import { keyRoute, isEditable, isTextEditable } from '../src/renderer/core/keys.js';
import { ModalStack, nextFocusIndex } from '../src/renderer/core/modal.js';

// doc.js passa da core/pdf.js, che legge document.baseURI: in Node basta un segnaposto
let Doc;
beforeAll(async () => {
  globalThis.document ??= { baseURI: 'http://localhost/' };
  ({ Doc } = await import('../src/renderer/core/doc.js'));
});

const bytes = (...v) => new Uint8Array(v);
/** Proxy pdf.js finto: i valori digitati a schermo diventano i byte restituiti da saveDocument. */
const fakePdf = (saved) => ({ annotationStorage: { size: 1 }, saveDocument: async () => saved });

describe('recupero: copia di un file già aperto', () => {
  it('se il percorso è già aperto la copia si apre a parte, senza percorso, come «(recuperato)»', () => {
    const t = restoreTarget({ name: 'prova.pdf', path: '/u/prova.pdf' }, (p) => p === '/u/prova.pdf');
    expect(t).toEqual({ name: 'prova (recuperato).pdf', path: null });
  });
  it('se il percorso non è aperto si ripristina con nome e percorso originali', () => {
    expect(restoreTarget({ name: 'prova.pdf', path: '/u/prova.pdf' }, () => false)).toEqual({ name: 'prova.pdf', path: '/u/prova.pdf' });
  });
  it('documento senza percorso: resta senza percorso e con il suo nome', () => {
    expect(restoreTarget({ name: 'Senza titolo.pdf', path: null }, () => true)).toEqual({ name: 'Senza titolo.pdf', path: null });
  });
  it('nome senza estensione: si aggiunge «(recuperato).pdf»', () => {
    expect(restoreTarget({ name: 'verbale', path: '/u/verbale' }, () => true).name).toBe('verbale (recuperato).pdf');
  });
});

describe('moduli compilati integrati nei byte', () => {
  it('dopo l\'integrazione (stampa, strumenti) il documento resta «modificato»: chiudendo si chiede di salvare', async () => {
    const doc = new Doc({ name: 'modulo.pdf', bytes: bytes(1) });
    doc.setPdf(fakePdf(bytes(1, 9)));
    doc.formsDirty = true;
    expect(doc.dirty).toBe(false);
    const out = await integrateForms(doc);
    expect([...out]).toEqual([1, 9]);
    expect(doc.formsDirty).toBe(false);
    expect(doc.dirty).toBe(true);
  });
  it('il salvataggio successivo lo segna come salvato (stessa versione)', async () => {
    const doc = new Doc({ name: 'modulo.pdf', bytes: bytes(1) });
    doc.setPdf(fakePdf(bytes(1, 9)));
    doc.formsDirty = true;
    const v = doc.version;
    await integrateForms(doc);
    expect(doc.version).toBe(v);
    doc.markSaved();
    expect(doc.dirty).toBe(false);
  });
  it('senza moduli digitati non cambia nulla', async () => {
    const doc = new Doc({ name: 'a.pdf', bytes: bytes(1) });
    doc.setPdf(fakePdf(bytes(7)));
    expect([...(await integrateForms(doc))]).toEqual([1]);
    expect(doc.dirty).toBe(false);
  });
});

describe('Annulla/Ripeti con moduli digitati dopo l\'ultima modifica', () => {
  it('Annulla toglie i valori insieme alla modifica, Ripeti li riporta', async () => {
    const doc = new Doc({ name: 'modulo.pdf', bytes: bytes(1) });
    await doc.commit('Riordina', bytes(2));
    doc.setPdf(fakePdf(bytes(2, 9))); // valori digitati sui byte [2]
    doc.formsDirty = true;
    expect(await doc.undo()).toBe('Riordina');
    expect([...doc.bytes]).toEqual([1]);
    expect(doc.formsDirty).toBe(false);
    doc.setPdf({ annotationStorage: { size: 0 }, saveDocument: async () => bytes(1) }); // vista ricaricata
    expect(await doc.redo()).toBe('Riordina');
    expect([...doc.bytes]).toEqual([2, 9]);
    expect(doc.dirty).toBe(true);
  });
});

describe('tastiera: campi di testo e finestre modali', () => {
  const input = (type = 'text') => ({ tagName: 'INPUT', type });
  it('Ctrl/⌘+Z e Ctrl+Y in un campo di testo restano al campo (annullano il testo, non il documento)', () => {
    expect(keyRoute({ key: 'z', mod: true, target: input('search') })).toBe('native');
    expect(keyRoute({ key: 'Z', mod: true, target: { tagName: 'TEXTAREA' } })).toBe('native');
    expect(keyRoute({ key: 'y', mod: true, target: { tagName: 'DIV', isContentEditable: true } })).toBe('native');
  });
  it('Ctrl/⌘+Z fuori dai campi è l\'Annulla del documento', () => {
    expect(keyRoute({ key: 'z', mod: true, target: { tagName: 'DIV' } })).toBe('mod');
    expect(keyRoute({ key: 'z', mod: true, target: input('checkbox') })).toBe('mod');
  });
  it('le altre scorciatoie con Ctrl/⌘ funzionano anche mentre si scrive', () => {
    expect(keyRoute({ key: 's', mod: true, target: input() })).toBe('mod');
  });
  it('con una finestra modale aperta le scorciatoie non agiscono sul documento dietro', () => {
    expect(keyRoute({ key: 'n', target: { tagName: 'BUTTON' }, modal: true })).toBe('ignore');
    expect(keyRoute({ key: 'z', mod: true, target: { tagName: 'BUTTON' }, modal: true })).toBe('ignore');
    expect(keyRoute({ key: 'z', mod: true, target: input(), modal: true })).toBe('native');
  });
  it('tasti singoli: attivi fuori dai campi, ignorati mentre si scrive o con Alt', () => {
    expect(keyRoute({ key: 'n', target: { tagName: 'BODY' } })).toBe('key');
    expect(keyRoute({ key: 'n', target: input() })).toBe('ignore');
    expect(keyRoute({ key: 'n', alt: true, target: { tagName: 'BODY' } })).toBe('ignore');
  });
  it('isEditable / isTextEditable', () => {
    expect(isEditable({ tagName: 'SELECT' })).toBe(true);
    expect(isTextEditable({ tagName: 'SELECT' })).toBe(false);
    expect(isTextEditable({ tagName: 'INPUT', type: 'text', readOnly: true })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe('finestre modali sovrapposte', () => {
  it('solo quella in cima reagisce: chiusa quella, tocca alla precedente', () => {
    const s = new ModalStack();
    const a = s.push({ root: 'a' }); const b = s.push({ root: 'b' });
    expect(s.isTop(b)).toBe(true);
    expect(s.isTop(a)).toBe(false);
    s.remove(b);
    expect(s.top).toBe(a);
    s.remove(a);
    expect(s.top).toBe(null);
  });
  it('Tab gira dentro la finestra: dall\'ultimo al primo e, con Maiusc, dal primo all\'ultimo', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    expect(nextFocusIndex(3, -1, false)).toBe(0); // fuoco fuori dalla finestra: si rientra
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });
});

describe('intervalli di pagine', () => {
  it('«pari» su un documento di una pagina: errore leggibile invece di nessuna pagina', () => {
    expect(() => parsePageRanges('pari', 1)).toThrow(/Nessuna pagina corrisponde a «pari»/);
  });
  it('«pari» su più pagine funziona come prima', () => {
    expect(parsePageRanges('pari', 4)).toEqual([1, 3]);
  });
  it('vuoto resta «tutte le pagine»', () => {
    expect(parsePageRanges('  ', 3)).toEqual([0, 1, 2]);
  });
  it('accetta il trattino lungo come separatore di intervallo', () => {
    expect(parsePageRanges('1–3, 5', 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges('2—', 4)).toEqual([1, 2, 3]);
  });
});
