// Archivio locale (localStorage) di firme, iniziali e profilo personale per la compilazione automatica.
// Logica pura con archivio iniettabile (per i test). Nessun dato lascia il computer.

const KEY_SIGS = 'leggio.moduli.firme.v1';
const KEY_PROFILE = 'leggio.moduli.profilo.v1';
const MAX_ITEMS = 12;
const MAX_DATAURL = 3 * 1024 * 1024;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function defaultStorage() {
  try { if (typeof localStorage !== 'undefined') { localStorage.getItem('x'); return localStorage; } } catch {}
  return memoryStorage();
}

function readJson(storage, key, fallback) {
  try { const v = JSON.parse(storage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; }
}

/** Campi del profilo personale, con le etichette che li riconoscono nei moduli. */
export const PROFILE_FIELDS = [
  { key: 'nome', label: 'Nome', match: /^(nome|first.?name|given.?name)$/i },
  { key: 'cognome', label: 'Cognome', match: /^(cognome|surname|last.?name|family.?name)$/i },
  { key: 'nomeCompleto', label: 'Nome e cognome', match: /(nome.?e.?cognome|cognome.?e.?nome|full.?name|nominativo|sottoscritt[oa]|il.?la.?sottoscritt)/i },
  { key: 'codiceFiscale', label: 'Codice fiscale', match: /(codice.?fiscale|^c\.?f\.?$|^cf$|fiscal.?code|tax.?code)/i },
  { key: 'dataNascita', label: 'Data di nascita', match: /(data.?(di.?)?nascita|nat[oa].?il|birth.?date|date.?of.?birth)/i },
  { key: 'luogoNascita', label: 'Luogo di nascita', match: /(luogo.?(di.?)?nascita|nat[oa].?a$|birth.?place|place.?of.?birth)/i },
  { key: 'ente', label: 'Ente / istituto', match: /(^ente$|istituto|amministrazione|organizzazione|azienda|company|organi[sz]ation)/i },
  { key: 'ufficio', label: 'Ufficio / struttura', match: /(ufficio|struttura|servizio|reparto|department|unit[aà])/i },
  { key: 'qualifica', label: 'Qualifica', match: /(qualifica|ruolo|profilo|incarico|job.?title|position)/i },
  { key: 'indirizzo', label: 'Indirizzo', match: /(indirizzo|^via$|residen|address|street)/i },
  { key: 'citta', label: 'Città', match: /(citt[aà]|comune|^luogo$|city|town)/i },
  { key: 'cap', label: 'CAP', match: /^(cap|c\.a\.p\.?|zip|postal.?code)$/i },
  { key: 'provincia', label: 'Provincia', match: /^(prov(incia)?\.?|province)$/i },
  { key: 'telefono', label: 'Telefono', match: /(telefono|^tel\.?$|cellulare|phone|mobile)/i },
  { key: 'email', label: 'Email', match: /(e-?mail|posta.?elettronica|^mail$)/i },
  { key: 'pec', label: 'PEC', match: /^pec$|posta.?elettronica.?certificata/i },
  { key: 'partitaIva', label: 'Partita IVA dell\'ente', match: /(partita.?iva|p\.?\s?iva|vat)/i },
];

/** Trova il dato del profilo adatto a un campo dal suo nome (o etichetta vicina). La data di oggi per i campi "data". */
export function profileValueFor(fieldName, profile, today) {
  const n = String(fieldName || '').replace(/[_\-.[\]0-9]+/g, ' ').trim();
  if (!n) return null;
  // prima le corrispondenze più specifiche
  const order = ['nomeCompleto', 'dataNascita', 'luogoNascita', 'codiceFiscale', 'pec', 'partitaIva', 'email', 'cognome', 'nome', 'cap', 'provincia', 'citta', 'indirizzo', 'telefono', 'ufficio', 'qualifica', 'ente'];
  for (const key of order) {
    const f = PROFILE_FIELDS.find((x) => x.key === key);
    if (f.match.test(n)) {
      let v = profile?.[key];
      if (!v && key === 'nomeCompleto' && (profile?.nome || profile?.cognome)) v = [profile.nome, profile.cognome].filter(Boolean).join(' ');
      return v ? { key, value: String(v) } : null;
    }
  }
  if (today && /^(data|date|li|lì|il giorno)$/i.test(n)) return { key: 'oggi', value: today };
  return null;
}

export function createStore(storage = defaultStorage()) {
  return {
    /** kind: 'signature' | 'initials' */
    list(kind) {
      const all = readJson(storage, KEY_SIGS, []);
      return (Array.isArray(all) ? all : []).filter((x) => x && typeof x.dataUrl === 'string' && x.dataUrl.startsWith('data:image/') && (!kind || x.kind === kind));
    },
    add(item) {
      if (!item || typeof item.dataUrl !== 'string' || !item.dataUrl.startsWith('data:image/')) throw new Error('Immagine della firma non valida.');
      if (item.dataUrl.length > MAX_DATAURL) throw new Error('L\'immagine della firma è troppo grande.');
      const kind = item.kind === 'initials' ? 'initials' : 'signature';
      const entry = { id: item.id || 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, dataUrl: item.dataUrl, w: +item.w || 0, h: +item.h || 0, created: Date.now(), label: String(item.label || '').slice(0, 80) };
      const all = this.list();
      // le più recenti in cima; massimo MAX_ITEMS per tipo
      const others = all.filter((x) => x.kind !== kind);
      const same = [entry, ...all.filter((x) => x.kind === kind)].slice(0, MAX_ITEMS);
      try { storage.setItem(KEY_SIGS, JSON.stringify([...same, ...others])); }
      catch { throw new Error('Spazio esaurito per salvare la firma: elimina qualche firma salvata.'); }
      return entry;
    },
    remove(id) { storage.setItem(KEY_SIGS, JSON.stringify(this.list().filter((x) => x.id !== id))); },
    /** Sposta in cima (usata per ultima). */
    touch(id) {
      const all = this.list(); const i = all.findIndex((x) => x.id === id);
      if (i > 0) { const [x] = all.splice(i, 1); all.unshift(x); storage.setItem(KEY_SIGS, JSON.stringify(all)); }
    },
    getProfile() {
      const p = readJson(storage, KEY_PROFILE, {});
      const out = {};
      for (const f of PROFILE_FIELDS) if (typeof p[f.key] === 'string') out[f.key] = p[f.key];
      return out;
    },
    setProfile(p) {
      const out = {};
      for (const f of PROFILE_FIELDS) { const v = p?.[f.key]; if (typeof v === 'string' && v.trim()) out[f.key] = v.trim().slice(0, 300); }
      storage.setItem(KEY_PROFILE, JSON.stringify(out));
      return out;
    },
    /** Preferenze varie (colore, dimensione testo, ultimo .p12 usato ecc.) */
    getPref(k, def) { const p = readJson(storage, 'leggio.moduli.pref.v1', {}); return p && k in p ? p[k] : def; },
    setPref(k, v) { const p = readJson(storage, 'leggio.moduli.pref.v1', {}) || {}; p[k] = v; try { storage.setItem('leggio.moduli.pref.v1', JSON.stringify(p)); } catch {} },
  };
}

export { memoryStorage };
