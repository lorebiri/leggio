import { describe, it, expect } from 'vitest';
import { rankTools, scoreTool } from '../src/renderer/core/toolsearch.js';

const T = [
  { id: 'stamp', name: 'Timbro', keywords: 'timbro approvato protocollo pagato', description: 'Timbri predefiniti' },
  { id: 'protocol', name: 'Timbro di protocollo', keywords: 'protocollo numero data', description: 'Numero e data di protocollo' },
  { id: 'merge', name: 'Unisci PDF', acrobatName: 'Combina file', keywords: 'combina unire accorpare', description: 'Unisce più file' },
  { id: 'summary', name: 'Riepilogo commenti', keywords: 'esporta commenti', description: 'Esporta PDF con i commenti' },
  { id: 'convert-word', name: 'Converti in Word', acrobatName: 'Esporta PDF', keywords: 'esporta word docx', description: 'Esporta in Word' },
  { id: 'compress', name: 'Riduci dimensioni file', acrobatName: 'Comprimi PDF', keywords: 'comprimere comprimi pesante', description: 'Rende il file più leggero' },
  { id: 'hidden', name: 'Timbro segreto', hidden: true },
];
const ids = (q) => rankTools(T, q).map((t) => t.id);

describe('classifica della ricerca strumenti', () => {
  it('«protocollo»: prima «Timbro di protocollo» (parola nel nome) poi «Timbro» (parola chiave)', () => {
    expect(ids('protocollo').slice(0, 2)).toEqual(['protocol', 'stamp']);
  });
  it('inizio del nome batte tutto; nome esatto per primo', () => {
    expect(ids('timbro')[0]).toBe('stamp');
    expect(ids('timbro di')[0]).toBe('protocol');
  });
  it('nome Acrobat prima delle parole chiave e della descrizione', () => {
    expect(ids('esporta pdf')[0]).toBe('convert-word');
    expect(ids('combina')[0]).toBe('merge');
    expect(ids('comprimi')[0]).toBe('compress');
  });
  it('accenti e maiuscole ignorati; più parole: servono tutte', () => {
    expect(ids('UNISCI')[0]).toBe('merge');
    expect(ids('riduci file')).toEqual(['compress']);
    expect(ids('riduci zebra')).toEqual([]);
  });
  it('stessa radice: «comprimere» trova Comprimi, «togliere password» trova Rimuovi protezione', () => {
    const more = [...T, { id: 'unprotect', name: 'Rimuovi protezione', keywords: 'rimuovi togli protezione password sblocca' }];
    expect(rankTools(T, 'comprimere')[0].id).toBe('compress');
    expect(rankTools(more, 'togliere password')[0].id).toBe('unprotect');
    expect(rankTools(T, 'zebra')).toEqual([]);
  });
  it('gli strumenti nascosti non compaiono; ricerca vuota = tutti', () => {
    expect(ids('segreto')).toEqual([]);
    expect(rankTools(T, '').length).toBe(6);
    expect(scoreTool(T[0], '')).toBe(1);
  });
});
