// Ponte verso il processo principale (electron/features/moduli.cjs). Ogni risposta è { ok, result } o { ok:false, error }.
export const isDesktop = () => typeof window !== 'undefined' && !!window.leggio;

export async function invoke(channel, payload) {
  if (!isDesktop()) return { ok: false, error: 'Funzione disponibile solo nell\'app desktop.' };
  try {
    const r = await window.leggio.invoke('feat:' + channel, payload);
    if (r && typeof r === 'object' && 'ok' in r) return r;
    return { ok: false, error: 'Risposta inattesa dal programma.' };
  } catch (e) {
    const m = String(e?.message || e);
    return { ok: false, error: /No handler registered/i.test(m) ? 'Questa funzione richiede la versione aggiornata dell\'app: riavvia Leggio.' : 'Errore di comunicazione: ' + m.replace(/^Error invoking remote method '[^']+': /, '') };
  }
}

export function onProgress(fn) {
  if (!isDesktop()) return () => {};
  try { return window.leggio.on('feat:moduli:progress', fn); } catch { return () => {}; }
}
