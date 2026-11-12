// Liste di controllo per le pratiche (acquisti, progetti PNRR): modelli MODIFICABILI dall'ufficio, spenti di default,
// mostrati dentro la «pratica» dell'archivio. Leggio segna presente / non trovato cercando nei documenti della pratica;
// non decide la conformità. Logica pura.

/** Modelli predefiniti: una voce per riga «Testo | parole da cercare, separate da virgole | fonte». */
export const MODELLI_PREDEFINITI = {
  acquisto: {
    nome: 'Acquisto (affidamento diretto)',
    righe: [
      'Determina a contrarre | determina a contrarre, decisione di contrarre, determina di affidamento | RACF CNR art. 32',
      'Nomina del RUP | nomina del RUP, responsabile unico del progetto, responsabile unico del procedimento | d.lgs. 36/2023 art. 15',
      'CIG | CIG | art. 3 L. 136/2010',
      'Preventivo o offerta | preventivo, offerta | prassi',
      'Dichiarazione sostitutiva del fornitore (DSAN) | dichiarazione sostitutiva, DSAN, DGUE, art. 94, art. 95 | d.lgs. 36/2023 art. 52',
      'Dichiarazione del titolare effettivo | titolare effettivo | prassi antiriciclaggio e PNRR',
      'Assenza di conflitto di interessi | conflitto di interess | d.lgs. 36/2023 art. 16',
      'DURC | DURC, regolarità contributiva | DM 30/1/2015',
      'Tracciabilità (conto dedicato) | tracciabilità, conto corrente dedicato, conto dedicato | L. 136/2010 art. 3',
      'Ordine o contratto | ordine, contratto, documento di stipula, trattativa diretta | prassi',
      'Certificato di regolare esecuzione | regolare esecuzione, CRE, verifica di conformità | d.lgs. 36/2023 art. 50 c. 7',
      'Fattura | fattura | prassi',
    ],
  },
  pnrr: {
    nome: 'Progetto PNRR',
    righe: [
      'CUP su ogni documento | §CUP | art. 11 L. 3/2003; Circ. RGS 30/2022',
      'Dicitura «Finanziato dall\'Unione europea – NextGenerationEU» | NextGenerationEU, Next Generation EU, finanziato dall\'unione europea | Circ. RGS 30/2022 (da verificare sul manuale del progetto)',
      'Comunicazione del titolare effettivo | titolare effettivo | Circ. RGS 30/2022',
      'Assenza di conflitto di interessi | conflitto di interess | Circ. RGS 30/2022',
      'Checklist DNSH | DNSH, do no significant harm, non arrecare un danno significativo | Circ. MEF 33/2022',
      'Certificato di regolare esecuzione | regolare esecuzione, CRE | d.lgs. 36/2023 art. 50 c. 7',
    ],
  },
};

/** Testo modificato dall'ufficio → modello. Righe vuote o commentate (#) ignorate. */
export function leggiModello(testo, nome = 'Lista') {
  const righe = String(testo || '').split(/\r?\n/).map((r) => r.trim()).filter((r) => r && !r.startsWith('#'));
  return { nome, voci: righe.map((r, i) => { const [t, parole = '', fonte = ''] = r.split('|').map((x) => x.trim()); return { id: 'v' + i, testo: t, parole: parole.split(',').map((p) => p.trim()).filter(Boolean), fonte }; }) };
}
export function modelloPredefinito(id) { const m = MODELLI_PREDEFINITI[id]; return leggiModello(m.righe.join('\n'), m.nome); }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Valuta un modello sui documenti della pratica. documenti: [{ nome, testo, cup?: [] }]
 * La parola speciale «§CUP» vuol dire: il CUP deve comparire su OGNI documento.
 * → [{ voce, stato: 'presente'|'non trovato', documenti: [nomi], mancanti?: [nomi] }]
 */
export function valutaLista(modello, documenti) {
  return modello.voci.map((v) => {
    if (v.parole.includes('§CUP')) {
      const re = /\b[A-Z]\d{2}[A-Z][0-9A-Z]{11}\b/;
      const mancanti = documenti.filter((d) => !re.test(d.testo || '')).map((d) => d.nome);
      return { voce: v, stato: documenti.length && !mancanti.length ? 'presente' : 'non trovato', documenti: documenti.filter((d) => !mancanti.includes(d.nome)).map((d) => d.nome), mancanti };
    }
    const parole = v.parole.map(norm);
    const trovati = documenti.filter((d) => { const t = norm(d.nome + ' ' + (d.testo || '')); return parole.some((p) => p && (p.length <= 4 ? new RegExp(`\\b${p}\\b`).test(t) : t.includes(p))); }).map((d) => d.nome);
    return { voce: v, stato: trovati.length ? 'presente' : 'non trovato', documenti: trovati };
  });
}

/**
 * Stessa fattura usata su più progetti (doppio finanziamento). fatture: [{ progetto, piva, numero, data }]
 * → [{ chiave, progetti: [] }]
 */
export function doppioUtilizzo(fatture) {
  const m = new Map();
  for (const f of fatture) {
    if (!f.numero || !f.piva) continue;
    const k = `${String(f.piva).replace(/^IT/i, '')}|${String(f.numero).replace(/\s+/g, '').toUpperCase()}|${f.data || ''}`;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(f.progetto);
  }
  return [...m.entries()].filter(([, s]) => s.size > 1).map(([chiave, s]) => ({ chiave, progetti: [...s] }));
}
