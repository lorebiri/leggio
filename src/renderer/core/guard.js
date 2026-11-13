// Rete di sicurezza globale: errori non gestiti e promesse rifiutate nel renderer.
// Mostra un avviso non invadente (al massimo uno ogni pochi secondi) e scrive nel registro locale.
import { platform } from './platform.js';
import { isBenignError } from './errors.js';

const ring = []; // ultime voci, utili anche nel browser (window.__leggio.logTail())

/** Scrive nel registro locale. level: info|warn|error */
export function log(level, message, data) {
  const entry = { t: new Date().toISOString(), level, message: String(message).slice(0, 2000), data: safeData(data) };
  ring.push(entry); if (ring.length > 200) ring.shift();
  try { platform.log(entry)?.catch?.(() => {}); } catch { /* il registro non deve mai causare errori */ }
  return entry;
}
export function logTail() { return ring.slice(); }

function safeData(d) {
  if (d == null) return undefined;
  try { const s = JSON.stringify(d); return s.length > 8000 ? s.slice(0, 8000) + '…' : JSON.parse(s); } catch { return String(d); }
}

let installed = false;
export function installGuards(app) {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  let lastToast = 0;
  const notify = () => {
    const now = Date.now();
    if (now - lastToast < 8000) return;
    lastToast = now;
    // import dinamico evitato: ui.toast è caricato dall'app
    const msg = 'Si è verificato un errore imprevisto. Il documento non è stato perso.';
    app?.ui?.toast?.(msg, { kind: 'warning', timeout: 7000, action: platform.isElectron === false ? undefined : { label: 'Segnalalo', run: () => platform.reportProblem(msg) } });
  };
  window.addEventListener('error', (e) => {
    const err = e.error || e.message;
    if (isBenignError(err)) return;
    // errori di caricamento risorse (img, script) arrivano senza error: solo registro
    if (!e.error && e.target && e.target !== window) { log('warn', 'risorsa non caricata', { src: e.target?.src || e.target?.href }); return; }
    log('error', 'errore non gestito: ' + (e.error?.message || e.message), { stack: e.error?.stack, where: `${e.filename}:${e.lineno}:${e.colno}` });
    notify();
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (isBenignError(r)) { e.preventDefault(); return; }
    log('error', 'promessa rifiutata non gestita: ' + (r?.message || String(r)), { stack: r?.stack });
    notify();
  });
  log('info', 'avvio renderer', { ua: navigator.userAgent });
}
