// Accesso all'archivio personale. Nell'app desktop passa dal processo principale (feat:personale:*),
// che cifra tutto; nell'anteprima web e nei test usa un archivio in memoria (o in localStorage, NON cifrato:
// solo per lo sviluppo). Tutte le funzioni restituiscono il risultato o lanciano un Error leggibile.

function errore(r) { const e = new Error(r?.error || 'Archivio personale non disponibile.'); e.code = r?.code || null; return e; }

export function createIpcBackend(invoke = (ch, a) => window.leggio.invoke(ch, a)) {
  const call = async (name, a) => {
    let r;
    try { r = await invoke('feat:personale:' + name, a); }
    catch (e) {
      const m = String(e?.message || e);
      throw errore({ error: /No handler registered/i.test(m) ? 'Questa funzione richiede la versione aggiornata dell\'app: riavvia Leggio.' : 'Errore di comunicazione con l\'archivio personale: ' + m.replace(/^Error invoking remote method '[^']+': /, '') });
    }
    if (!r || typeof r !== 'object' || !('ok' in r)) throw errore({ error: 'Risposta inattesa dall\'archivio personale.' });
    if (!r.ok) throw errore(r);
    return r.result;
  };
  return {
    tipo: 'cifrato',
    stato: () => call('stato'),
    sblocca: (password) => call('sblocca', { password }),
    blocca: () => call('blocca'),
    impostaPassword: (attuale, nuova) => call('imposta-password', { attuale, nuova }),
    leggi: () => call('leggi'),
    salva: (indice, { purga = false } = {}) => call('salva', { indice, purga }),
    leggiBlob: (id) => call('blob-leggi', { id }),
    scriviBlob: (id, dati) => call('blob-scrivi', { id, dati }),
    cancellaBlob: (id) => call('blob-cancella', { id }),
    esporta: (password) => call('esporta', { password }),
    importaScegli: () => call('importa-scegli'),
    importaApri: (token, password) => call('importa-apri', { token, password }),
    azzera: () => call('azzera', { conferma: 'METTI-DA-PARTE' }),
  };
}

const b64 = {
  da: (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  a: (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
};

/**
 * Archivio in memoria (test) o in localStorage (anteprima web). opts.password simula la password.
 * Non cifra nulla: nell'app desktop si usa sempre createIpcBackend.
 */
export function createMemoryBackend({ storage = null, chiave = 'leggio.personale.anteprima', password = null } = {}) {
  let indice = null; const blob = new Map(); let pw = password; let bloccato = !!password;
  if (storage) {
    try {
      const o = JSON.parse(storage.getItem(chiave) || 'null');
      if (o) { indice = o.indice || null; for (const [k, v] of Object.entries(o.blob || {})) blob.set(k, b64.a(v)); }
    } catch { /* */ }
  }
  const persisti = () => {
    if (!storage) return;
    try { storage.setItem(chiave, JSON.stringify({ indice, blob: Object.fromEntries([...blob].map(([k, v]) => [k, b64.da(v)])) })); }
    catch { throw new Error('Spazio dell\'anteprima esaurito (nell\'app desktop non c\'è questo limite).'); }
  };
  const idOk = (id) => { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{3,63}$/.test(id)) throw new Error('Identificativo non valido.'); return id; };
  const sbloccato = () => { if (bloccato) { const e = new Error('L\'archivio personale è bloccato: inserisci la password.'); e.code = 'bloccato'; throw e; } };
  const stato = () => ({ pronto: true, bloccato, password: !!pw, protezione: 'memoria', sistema: 'nessuna (anteprima)', sistemaDisponibile: false, avvisoPortachiavi: false, creatoOra: false, ripristinato: false, cartella: '' });
  const esportati = new Map();
  return {
    tipo: storage ? 'anteprima' : 'memoria',
    salvataggi: 0,
    stato: async () => stato(),
    sblocca: async (p) => { if (pw && p !== pw) { const e = new Error('Password errata.'); e.code = 'password-errata'; throw e; } bloccato = false; return stato(); },
    blocca: async () => { if (pw) bloccato = true; return stato(); },
    impostaPassword: async (a, n) => { if (pw && a !== pw) throw new Error('Password errata.'); if (n && n.length < 8) throw new Error('La password deve avere almeno 8 caratteri.'); pw = n || null; return stato(); },
    leggi: async () => { sbloccato(); return { indice: indice ? structuredClone(indice) : null, stato: stato() }; },
    async salva(i, opts = {}) { sbloccato(); if (!i || typeof i !== 'object' || Array.isArray(i)) throw new Error('Indice dell\'archivio non valido.'); indice = structuredClone(i); this.salvataggi++; this.ultimaPurga = !!opts.purga; persisti(); return {}; },
    leggiBlob: async (id) => { sbloccato(); const b = blob.get(idOk(id)); if (!b) throw new Error('Elemento dell\'archivio non trovato (forse è stato eliminato).'); return b.slice(); },
    scriviBlob: async (id, d) => { sbloccato(); blob.set(idOk(id), new Uint8Array(d)); persisti(); return {}; },
    cancellaBlob: async (id) => { blob.delete(idOk(id)); persisti(); },
    esporta: async (p) => { if (!p || p.length < 8) throw new Error('Scegli una password di almeno 8 caratteri per il file di backup.'); const t = 'exp' + esportati.size; esportati.set(t, { p, indice: structuredClone(indice), blob: new Map(blob) }); return { nome: t + '.leggio-backup', percorso: t, elementi: blob.size, mancanti: 0 }; },
    importaScegli: async () => { const t = [...esportati.keys()].pop(); return t ? { token: t, nome: t + '.leggio-backup' } : null; },
    importaApri: async (t, p) => { const e = esportati.get(t); if (!e) throw new Error('Scegli di nuovo il file di backup.'); if (e.p !== p) throw new Error('Password del backup errata, oppure il file è danneggiato.'); for (const [k, v] of e.blob) blob.set(k, v); return { indice: structuredClone(e.indice || {}), elementi: e.blob.size }; },
    azzera: async () => { indice = null; blob.clear(); pw = null; bloccato = false; persisti(); return stato(); },
    _blob: blob,
  };
}

export const isDesktop = () => typeof window !== 'undefined' && !!window.leggio;
