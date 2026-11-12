// Istantanea della sessione (schede aperte con percorso e pagina). Logica pura.
export const MAX_SESSION_DOCS = 30;

export function snapshot(docs, activeDoc, activePage) {
  const list = [];
  for (const d of docs || []) {
    if (!d.path) continue; // documenti mai salvati (es. estratti da .p7m) non si possono riaprire
    const page = d === activeDoc ? activePage : d.viewState?.page;
    list.push({ path: d.path, page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1 });
    if (list.length >= MAX_SESSION_DOCS) break;
  }
  return { docs: list, active: activeDoc?.path || null, at: Date.now() };
}

/** Valida un'istantanea letta dalle impostazioni. */
export function docsToRestore(s) {
  if (!s || !Array.isArray(s.docs)) return [];
  const seen = new Set();
  return s.docs.filter((d) => d && typeof d.path === 'string' && d.path.length < 4096 && !seen.has(d.path) && seen.add(d.path))
    .slice(0, MAX_SESSION_DOCS).map((d) => ({ path: d.path, page: Number.isFinite(d.page) && d.page > 0 ? Math.floor(d.page) : 1 }));
}
