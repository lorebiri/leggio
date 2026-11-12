// Dove sta l'archivio: nell'app desktop i file e l'indice passano dal processo principale
// (canali feat:archivio:*, indice in userData/archivio); nell'anteprima web l'indice va in
// IndexedDB e le cartelle valgono solo per la sessione (il browser non dà percorsi ai file).

export const isDesktop = () => typeof window !== 'undefined' && !!window.leggio;
export const sepPercorso = () => (window.leggio?.platform === 'win32' ? '\\' : '/');
export const percorsiSenzaMaiuscole = () => (window.leggio ? window.leggio.platform !== 'linux' : true);

/** Identificativo stabile di un documento: il suo percorso (senza maiuscole dove il sistema le ignora). */
export function idDa(percorso, ci = percorsiSenzaMaiuscole()) { return ci ? String(percorso).toLowerCase() : String(percorso); }

async function call(app, name, args = {}) {
  const r = await app.platform.invokeFeature('archivio:' + name, args);
  if (!r || !r.ok) { const e = new Error(r?.error || 'Operazione non riuscita.'); e.code = r?.code; throw e; }
  return r.value;
}

// ---------------- app desktop ----------------
export function storeDesktop(app) {
  return {
    desktop: true,
    cartelle: () => call(app, 'cartelle'),
    aggiungiCartella: (percorso) => call(app, 'aggiungi-cartella', percorso ? { percorso } : {}),
    togliCartella: (id) => call(app, 'togli-cartella', { id }),
    scansiona: (id) => call(app, 'scansiona', { id }),
    leggi: (path, maxBytes) => call(app, 'leggi', { path, maxBytes }),
    manifesto: () => call(app, 'indice-manifesto'),
    blocco: (file) => call(app, 'indice-blocco', { file }),
    scrivi: (piano) => call(app, 'indice-scrivi', piano),
    statiLeggi: () => call(app, 'stati-leggi'),
    statiScrivi: (testo) => call(app, 'stati-scrivi', { testo }),
    cancella: (anche) => call(app, 'cancella-indice', { anche }),
    dimensione: () => call(app, 'dimensione'),
    scegliDestinazione: (title) => call(app, 'scegli-destinazione', { title }),
    scriviCopia: (a) => call(app, 'scrivi-copia', a),
    copiaFile: (a) => call(app, 'copia-file', a),
  };
}

// ---------------- anteprima web ----------------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('leggio-archivio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kv(op, key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', op === 'get' || op === 'keys' ? 'readonly' : 'readwrite');
    const st = tx.objectStore('kv');
    const r = op === 'get' ? st.get(key) : op === 'put' ? st.put(val, key) : op === 'del' ? st.delete(key) : op === 'keys' ? st.getAllKeys() : st.clear();
    tx.oncomplete = () => { db.close(); resolve(r.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export function storeWeb() {
  const cartelle = []; // { id, percorso, nome, files: Map rel → File }
  const pick = () => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.webkitdirectory = true; input.setAttribute('webkitdirectory', '');
    input.onchange = () => resolve([...input.files]); input.oncancel = () => resolve([]);
    input.click();
  });
  const trova = (p) => { for (const c of cartelle) if (p.startsWith(c.percorso + '/')) return { c, rel: p.slice(c.percorso.length + 1) }; return null; };
  async function sha256(bytes) { const d = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  const api = {
    desktop: false,
    cartelle: async () => ({ cartelle: cartelle.map(({ files, ...c }) => c), dati: 'IndexedDB del browser' }),
    /** Nel browser: files = [{ rel, file }] (per i test) oppure scelta della cartella. */
    async aggiungiCartella(_p, files) {
      const list = files || (await pick()).map((f) => ({ rel: f.webkitRelativePath.split('/').slice(1).join('/'), file: f, top: f.webkitRelativePath.split('/')[0] }));
      if (!list.length) return null;
      const nome = list[0].top || 'cartella';
      const c = { id: 'web-' + Math.random().toString(36).slice(2, 10), percorso: '/' + nome, nome, aggiunta: Date.now(), files: new Map() };
      for (const x of list) if (/\.(pdf|p7m|xml|eml)$/i.test(x.rel)) c.files.set(x.rel, x.file);
      cartelle.push(c);
      return { cartella: { id: c.id, percorso: c.percorso, nome: c.nome } };
    },
    async togliCartella(id) { const i = cartelle.findIndex((c) => c.id === id); if (i >= 0) cartelle.splice(i, 1); return true; },
    async scansiona(id) {
      const c = cartelle.find((x) => x.id === id);
      if (!c) return { id, raggiungibile: false, errore: 'Nell\'anteprima web le cartelle valgono solo finché la pagina resta aperta: collegala di nuovo.', file: [], illeggibili: [] };
      return { id, raggiungibile: true, file: [...c.files].map(([rel, f]) => [rel, f.size, f.lastModified]), illeggibili: [] };
    },
    async leggi(p) {
      const t = trova(p); const f = t && t.c.files.get(t.rel);
      if (!f) throw new Error('Il file non è disponibile in questa sessione: collega di nuovo la cartella.');
      const bytes = new Uint8Array(await f.arrayBuffer());
      return { bytes, impronta: await sha256(bytes), size: f.size, mtime: f.lastModified, troppoGrande: false };
    },
    manifesto: async () => ({ manifesto: (await kv('get', 'manifesto')) || null, orfani: 0 }),
    blocco: (file) => kv('get', 'b:' + file),
    async scrivi({ scrivi, manifesto, elimina }) {
      for (const b of scrivi) await kv('put', 'b:' + b.file, b.testo);
      await kv('put', 'manifesto', manifesto);
      for (const f of elimina) await kv('del', 'b:' + f);
      return true;
    },
    statiLeggi: async () => ({ testo: (await kv('get', 'stati')) || null }),
    statiScrivi: (testo) => kv('put', 'stati', testo),
    async cancella(anche) {
      const keys = await kv('keys');
      for (const k of keys) if (k === 'manifesto' || String(k).startsWith('b:') || (anche === 'tutto' && k === 'stati')) await kv('del', k);
      if (anche === 'tutto') cartelle.length = 0;
      return true;
    },
    dimensione: async () => null,
    scegliDestinazione: async () => '__download__',
    scriviCopia: async ({ nome, bytes }) => { const url = URL.createObjectURL(new Blob([bytes])); const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); return nome; },
    async copiaFile({ path: p, nome }) { const r = await api.leggi(p); return api.scriviCopia({ nome, bytes: r.bytes }); },
  };
  return api;
}
