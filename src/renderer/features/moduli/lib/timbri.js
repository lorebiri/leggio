// Timbri semplici: modelli pronti e timbro dell'ente composto con testo. Logica pura (il disegno su tela è
// in ../timbri.js). Un timbro è descritto da una «spec»:
//   { forma: 'rettangolo'|'tondo'|'nessuna', righe: ['…'], bordoTesto: '…' (solo tondo: testo lungo il bordo),
//     colore: '#rrggbb', rotazione: gradi (-45..45), doppioBordo: bool, data: bool (aggiunge la data di oggi) }
// Nelle righe «[data]» diventa la data di oggi (gg/mm/aaaa).

export const COLORI_TIMBRO = [
  { v: '#1d3f9a', l: 'Blu' },
  { v: '#b42318', l: 'Rosso' },
  { v: '#1b7a3d', l: 'Verde' },
  { v: '#111111', l: 'Nero' },
  { v: '#6b2fa3', l: 'Viola' },
];

export const MODELLI_TIMBRO = [
  { id: 'copia-conforme', nome: 'Copia conforme all\'originale', spec: { forma: 'rettangolo', righe: ['COPIA CONFORME', 'ALL\'ORIGINALE'], colore: '#1d3f9a', rotazione: 0, doppioBordo: true } },
  { id: 'ricevuto', nome: 'Ricevuto il [data]', spec: { forma: 'rettangolo', righe: ['RICEVUTO IL', '[data]'], colore: '#1d3f9a', rotazione: 0 } },
  { id: 'annullato', nome: 'Annullato', spec: { forma: 'rettangolo', righe: ['ANNULLATO'], colore: '#b42318', rotazione: -12, doppioBordo: true } },
  { id: 'visto', nome: 'Visto', spec: { forma: 'rettangolo', righe: ['VISTO'], colore: '#1d3f9a', rotazione: 0 } },
  { id: 'pagato', nome: 'Pagato', spec: { forma: 'rettangolo', righe: ['PAGATO', '[data]'], colore: '#1b7a3d', rotazione: -8, doppioBordo: true } },
];

const oggiIt = (d = new Date()) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

/** Spec valida (valori fuori misura riportati nei limiti). */
export function normalizzaSpec(s = {}) {
  const forma = ['rettangolo', 'tondo', 'nessuna'].includes(s.forma) ? s.forma : 'rettangolo';
  const righe = (Array.isArray(s.righe) ? s.righe : String(s.righe || '').split('\n')).map((r) => String(r).slice(0, 80)).filter((r, i, a) => r.trim() || (i > 0 && i < a.length - 1)).slice(0, 8);
  return {
    forma,
    righe: righe.length ? righe : ['TIMBRO'],
    bordoTesto: forma === 'tondo' ? String(s.bordoTesto || '').slice(0, 120) : '',
    colore: /^#[0-9a-f]{6}$/i.test(s.colore) ? s.colore.toLowerCase() : '#1d3f9a',
    rotazione: Math.max(-45, Math.min(45, Math.round(Number(s.rotazione) || 0))),
    doppioBordo: !!s.doppioBordo,
    data: !!s.data,
  };
}

/** Righe da scrivere, con la data al posto di [data] (e in fondo se spec.data). */
export function righeTimbro(spec, oggi = oggiIt()) {
  const s = normalizzaSpec(spec);
  const r = s.righe.map((x) => x.replace(/\[data\]/gi, oggi));
  if (s.data && !s.righe.some((x) => /\[data\]/i.test(x))) r.push(oggi);
  return r;
}

/** Il timbro contiene una data che cambia ogni giorno? (allora non si salva come immagine fissa) */
export const haData = (spec) => !!spec?.data || (spec?.righe || []).some((x) => /\[data\]/i.test(x));

/** Nome leggibile di una spec (per l'elenco dei timbri salvati). */
export function nomeTimbro(spec) {
  const s = normalizzaSpec(spec);
  const t = (s.bordoTesto || s.righe.join(' ')).replace(/\s+/g, ' ').trim();
  return t.length > 50 ? t.slice(0, 50) + '…' : t;
}
