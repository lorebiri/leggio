// Web Worker della compilazione in serie (features/personale/serie.worker.js) con un «self» finto:
// dopo «interrompi» il riepilogo (fine) arriva solo quando il thread principale ha scritto il gruppo in corso.
import { describe, it, expect, vi } from 'vitest';
import * as PDFLib from '@cantoo/pdf-lib';
import { modelloDaPdf } from '../src/renderer/features/personale/lib/modelli.js';

async function modulo() {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([595, 842]);
  d.getForm().createTextField('cognome').addToPage(p, { x: 150, y: 700, width: 250, height: 20 });
  return d.save();
}

describe('worker della serie', () => {
  it('interrompi durante un gruppo: «fine» solo dopo l\'ack del gruppo', async () => {
    const posta = [];
    globalThis.self = { postMessage: (m) => posta.push(m), onmessage: null };
    vi.resetModules();
    await import('../src/renderer/features/personale/serie.worker.js');
    const base = await modulo();
    const modello = await modelloDaPdf(PDFLib, base);
    const records = Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, dati: { cognome: 'C' + i } }));
    self.onmessage({ data: { t: 'genera', base, modello, records, opzioni: { schema: '{cognome}' }, gruppo: 10 } });
    const attendi = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); };
    await attendi(() => posta.some((m) => m.t === 'gruppo'));
    expect(posta.some((m) => m.t === 'gruppo')).toBe(true);
    self.onmessage({ data: { t: 'interrompi' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(posta.some((m) => m.t === 'fine')).toBe(false); // il gruppo non è ancora stato scritto
    self.onmessage({ data: { t: 'ack' } });
    await attendi(() => posta.some((m) => m.t === 'fine'));
    const fine = posta.find((m) => m.t === 'fine');
    expect(fine.risultato.interrotto).toBe(true);
    delete globalThis.self;
  });
});
