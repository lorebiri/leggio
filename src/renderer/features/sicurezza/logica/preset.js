// Modelli pronti per l'oscuramento: un solo menu, nomi chiari. Ogni modello dice quali dati cercare e quali
// risultati sono spuntati in partenza; l'elenco va comunque sempre confermato (tranne nelle Azioni guidate).
// Logica pura.
import { MODELLI } from './modelli.js';

export const FIRMA = 'Firma autografa (immagine)';
const label = (id) => MODELLI.find((m) => m.id === id)?.label;

/** Domini di posta istituzionali: non sono «email personali» (regola da verificare con l'ufficio). */
export function emailIstituzionale(email) {
  const dom = String(email).toLowerCase().split('@')[1] || '';
  return /(^|\.)cnr\.it$/.test(dom) || /(^|\.)pec\.[a-z.]+$/.test(dom) || /^(pec|legalmail|postacert|cert)\./.test(dom) || /(^|\.)(gov|edu)\.it$/.test(dom) || /(^|\.)(unipi|unifi|miur|mur)\.it$/.test(dom);
}

export const PRESET = [
  {
    id: 'dati', nome: 'Dati personali comuni',
    descrizione: 'Codice fiscale, IBAN, email e telefono. Partite IVA, indirizzi e date di nascita compaiono nell\'elenco ma non sono spuntati.',
    cerca: ['cf', 'iban', 'email', 'tel', 'piva', 'nascita', 'indirizzo'],
    spunta: ['cf', 'iban', 'email', 'tel'],
    firma: false,
  },
  {
    id: 'incarichi', nome: 'Incarichi e assegni (Amministrazione Trasparente)',
    descrizione: 'Si oscurano indirizzo, telefono, email personale, luogo e data di nascita, codice fiscale delle persone, IBAN e firma autografa. Restano il nome, la partita IVA delle ditte e il compenso.',
    cerca: ['cf', 'iban', 'email', 'tel', 'nascita', 'indirizzo', 'piva'],
    spunta: ['cf', 'iban', 'email', 'tel', 'nascita', 'indirizzo'],
    firma: true,
    emailPersonale: true,
    indirizzoPersonale: true,
    fonti: [
      'Art. 15 d.lgs. 33/2013: per gli incarichi si pubblicano estremi dell\'atto, curriculum, compenso e attestazione sui conflitti di interesse (verificato).',
      'Dati da non pubblicare (indirizzo, telefono, email personale, nascita, codice fiscale, IBAN, firma): secondo le Linee guida del Garante sulla trasparenza (2014) — da verificare sul testo vigente e con il responsabile della trasparenza.',
      'Email istituzionali (cnr.it, PEC, enti pubblici) considerate non personali e lasciate visibili; indirizzi spuntati solo se di residenza o domicilio (la sede dell\'ente o della ditta resta): regole di Leggio, da verificare.',
      'Assegni: dal 2022 in gran parte sostituiti dai contratti di ricerca (art. 22 L. 240/2010); il modello vale per entrambi.',
    ],
  },
];

const RESIDENZA = /(resident[ei]|residenza|domicili(?:o|at[oa])|abitante|dimorante|recapito)[^.;\n]{0,30}$/i;

export function getPreset(id) { return PRESET.find((p) => p.id === id) || null; }

/** Il risultato va spuntato in partenza con questo modello? hit: { matcher, text } */
export function preselect(preset, hit) {
  if (!preset) return hit.matcher !== label('piva') && hit.matcher !== label('date');
  if (hit.matcher === FIRMA) return !!preset.firma;
  const id = MODELLI.find((m) => m.label === hit.matcher)?.id;
  if (!id || !preset.spunta.includes(id)) return false;
  if (id === 'email' && preset.emailPersonale && emailIstituzionale(hit.text)) return false;
  // indirizzo: spuntato solo se è di residenza o domicilio (la sede dell'ente o della ditta resta visibile)
  if (id === 'indirizzo' && preset.indirizzoPersonale && hit.before != null && !RESIDENZA.test(hit.before)) return false;
  return true;
}

/**
 * Riquadri probabili di firme autografe: immagini non troppo grandi, più larghe che alte, vicine a una
 * dicitura di firma («Firma», «In fede», «Il dichiarante», «firmato»…). images: [{ rect }]; labels: [rect].
 * Le pagine scansionate (un'immagine che copre quasi tutta la pagina) sono escluse: lì la firma va segnata a mano.
 */
export function signatureCandidates(images, labels, pageW, pageH) {
  const out = [];
  for (const im of images) {
    const [x1, y1, x2, y2] = im.rect;
    const w = x2 - x1; const h = y2 - y1;
    if (w <= 0 || h <= 0) continue;
    if (w * h > pageW * pageH * 0.15 || w > pageW * 0.6) continue; // troppo grande: scansione o foto
    if (w < 25 || h < 8) continue; // troppo piccola: icona
    const ratio = w / h;
    if (ratio < 1.2 || ratio > 9) continue;
    const near = labels.some((l) => {
      const dx = Math.max(0, l[0] - x2, x1 - l[2]); const dy = Math.max(0, l[1] - y2, y1 - l[3]);
      return dx < 160 && dy < 90;
    });
    if (near) out.push([x1 - 3, y1 - 3, x2 + 3, y2 + 3]);
  }
  return out;
}

export const FIRMA_ETICHETTE = /\b(firma|firmato|in\s+fede|il\s+dichiarante|la\s+dichiarante|l['’]\s*incaricat[oa]|il\s+contraente|per\s+accettazione|letto,?\s+confermato)\b/i;

// ---- Dati dell'ente (Profilo dell'ente, area avanzati): telefoni ed email che non si oscurano mai ----
const soloCifre = (s) => String(s).replace(/\D/g, '').replace(/^(00)?39(?=\d{9,})/, '');

/** Dal profilo dell'ente (oggetto con testi qualsiasi) → { emails:Set, phones:Set } */
export function datiEnte(profilo) {
  const emails = new Set(); const phones = new Set();
  const NON_RECAPITI = new Set(['partitaIva', 'codiceFiscale', 'codiceUfficio', 'codiceIpa', 'cap']);
  for (const [k, v] of Object.entries(profilo || {})) {
    if (typeof v !== 'string' || NON_RECAPITI.has(k)) continue;
    for (const m of v.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0].toLowerCase());
    for (const m of v.matchAll(/(?:\+|00)?[\d][\d\s./-]{5,}\d/g)) { const d = soloCifre(m[0]); if (d.length >= 6 && d.length <= 13) phones.add(d); }
  }
  return { emails, phones };
}

/** Il risultato è un telefono o un'email dell'ente? (non va mai oscurato) */
export function isDatoEnte(hit, ente) {
  if (!ente) return false;
  const t = String(hit.text);
  if (hit.matcher === label('email')) return ente.emails.has(t.toLowerCase());
  if (hit.matcher === label('tel')) {
    const d = soloCifre(t);
    for (const p of ente.phones) if (p === d || (Math.min(p.length, d.length) >= 8 && (p.endsWith(d) || d.endsWith(p)))) return true;
  }
  return false;
}

// ---- Proposta automatica del modello ----
// Stesse espressioni dell'archivio (tipo «Incarico o assegno»), più alcune forme frequenti nei decreti.
const INCARICO_RE = /\bconferimento\s+(?:di\s+|dell['’]\s*)?(?:incarico|assegno|borsa)\b|\bcontratto\s+di\s+(?:collaborazione|lavoro\s+autonomo|prestazione\s+(?:d['’]opera|occasionale)|ricerca)\b|\bassegn[oi]\s+(?:di|per\s+(?:lo\s+svolgimento\s+di\s+)?attivit[àa]\s+di)\s+ricerca\b|\bincarico\s+(?:di\s+collaborazione|post-?doc|di\s+ricerca|professionale|di\s+lavoro\s+autonomo)\b|\bborsa\s+di\s+(?:studio|ricerca)\b|\bprestazione\s+occasionale\b|\bco\.?co\.?co\b/i;

/** Il testo sembra un incarico, un contratto di collaborazione, un assegno o una borsa? */
export function sembraIncarico(testo) { return INCARICO_RE.test(String(testo || '').replace(/\s+/g, ' ')); }

/** Modello da proporre: 'incarichi' se il documento sembra un incarico (dal testo o dal tipo d'archivio). */
export function presetConsigliato({ testo, tipoArchivio } = {}) {
  if (tipoArchivio === 'incarico' || sembraIncarico(testo)) return 'incarichi';
  return null;
}

/** Il profilo dell'ente ha almeno un telefono o un'email? */
export function profiloEnteCompilato(profilo) { const d = datiEnte(profilo); return d.emails.size > 0 || d.phones.size > 0; }
