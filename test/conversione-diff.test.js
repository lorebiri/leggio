import { describe, it, expect } from 'vitest';
import { diffSequenze, modifiche, parole, confrontaParole, descriviModifica, normalizza } from '../src/renderer/features/conversione/lib/diff.js';

// ricostruisce b da a applicando i passi: verifica di coerenza
function applica(a, b, ops) {
  const out = [];
  let ia = 0; let ib = 0;
  for (const o of ops) {
    expect(o.a0).toBe(ia); expect(o.b0).toBe(ib);
    if (o.op === '=') { for (let k = o.a0; k < o.a1; k++) { expect(a[k]).toBe(b[o.b0 + k - o.a0]); out.push(a[k]); } }
    if (o.op === '+') for (let k = o.b0; k < o.b1; k++) out.push(b[k]);
    ia = o.a1; ib = o.b1;
  }
  expect(ia).toBe(a.length); expect(ib).toBe(b.length);
  return out;
}

describe('diff a parole', () => {
  it('testi identici → solo uguaglianze', () => {
    const a = parole('il gatto è sul tavolo');
    const ops = diffSequenze(a, [...a]);
    expect(ops).toEqual([{ op: '=', a0: 0, a1: 5, b0: 0, b1: 5 }]);
    expect(modifiche(ops, a, a)).toEqual([]);
  });

  it('sequenze vuote', () => {
    expect(diffSequenze([], [])).toEqual([]);
    expect(diffSequenze(['a'], [])).toEqual([{ op: '-', a0: 0, a1: 1, b0: 0, b1: 0 }]);
    expect(diffSequenze([], ['a'])).toEqual([{ op: '+', a0: 0, a1: 0, b0: 0, b1: 1 }]);
  });

  it('sostituzione, inserimento ed eliminazione', () => {
    const a = parole('Il fornitore consegna entro 30 giorni dalla firma del contratto.');
    const b = parole('Il fornitore consegna entro 60 giorni lavorativi dalla firma del contratto.');
    const ops = diffSequenze(a, b);
    expect(applica(a, b, ops)).toEqual(b);
    const mods = modifiche(ops, a, b);
    expect(mods).toHaveLength(1);
    expect(mods[0].tipo).toBe('sostituzione');
    expect(descriviModifica(mods[0], a, b)).toBe('«30 giorni» → «60 giorni lavorativi»');
  });

  it('coerenza su sequenze casuali (anche con ripetizioni)', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const voc = ['il', 'la', 'di', 'contratto', 'euro', '1.234,56', 'è', 'non', 'art.', '5'];
    for (let t = 0; t < 60; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 80) }, () => voc[Math.floor(rnd() * voc.length)]);
      const b = a.filter(() => rnd() > 0.15);
      for (let k = 0; k < 8; k++) b.splice(Math.floor(rnd() * (b.length + 1)), 0, voc[Math.floor(rnd() * voc.length)]);
      expect(applica(a, b, diffSequenze(a, b))).toEqual(b);
    }
  });

  it('documenti grandi: corretto e senza esplosioni di tempo', () => {
    const a = Array.from({ length: 200000 }, (_, i) => 'parola' + (i % 5000));
    const b = [...a];
    b.splice(1000, 3, 'nuovo', 'testo');
    b.splice(150000, 0, 'aggiunta');
    b.splice(199000, 10);
    const t0 = Date.now();
    const ops = diffSequenze(a, b);
    const ms = Date.now() - t0;
    expect(applica(a, b, ops)).toEqual(b);
    expect(modifiche(ops, a, b)).toHaveLength(3);
    // solo i casi patologici (es. complessità quadratica): la misura vera è in test/conversione-benchmark.mjs
    expect(ms).toBeLessThan(60000);
  });

  it('blocco totalmente diverso oltre il tetto: sostituito in blocco senza esplodere', () => {
    const a = Array.from({ length: 5000 }, (_, i) => 'a' + (i % 3));
    const b = Array.from({ length: 5000 }, (_, i) => 'b' + (i % 3));
    const ops = diffSequenze(a, b, { maxD: 200 });
    expect(applica(a, b, ops)).toEqual(b);
  });

  it('normalizzazione: virgolette tipografiche e maiuscole', () => {
    expect(normalizza('«Ciao»')).toBe('"Ciao"');
    expect(normalizza('L’art.', { ignoraMaiuscole: true })).toBe("l'art.");
    expect(normalizza('fine.', { ignoraPunteggiatura: true })).toBe('fine');
  });

  it('confronto di documenti con statistiche', () => {
    const w = (s, page = 0) => parole(s).map((text) => ({ text, page }));
    const r = confrontaParole(w('Art. 1 Il prezzo è di 100 euro. Art. 2 Pagamento a 30 giorni.'), w('Art. 1 Il prezzo è di 120 euro. Art. 2 Pagamento a 30 giorni. Art. 3 Foro di Firenze.'));
    expect(r.stats).toMatchObject({ sostituzioni: 1, inserimenti: 1, eliminazioni: 0 });
  });
});
