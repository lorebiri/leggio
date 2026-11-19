// Pagina «Avvisi di sicurezza»: apre da sola la guida del sistema di chi visita e aggiunge i pulsanti «Copia».
// Senza JavaScript tutte le guide restano aperte e i comandi si copiano a mano.
import { rilevaSistema, NOMI_SISTEMA } from './scarica.js';

const GUIDE = ['windows', 'mac', 'linux'];

function guida(id) {
  return GUIDE.includes(id) ? document.getElementById(id) : null;
}

// Apre la guida richiesta e chiude le altre (l'utente può sempre riaprirle).
function apriSolo(id) {
  const scelta = guida(id);
  if (!scelta) return false;
  for (const g of GUIDE) {
    const d = guida(g);
    if (d) d.open = d === scelta;
  }
  return true;
}

// Un'ancora interna a una guida chiusa (#antivirus, #smart-app-control…) apre la guida che la contiene.
function apriAncora(hash) {
  let id = '';
  try { id = decodeURIComponent(String(hash || '').slice(1)); } catch { return; }
  if (!id) return;
  if (apriSolo(id)) return;
  const el = document.getElementById(id);
  for (let d = el?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
}

function annuncia(testo) {
  const el = document.getElementById('annuncio');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = testo; }, 50);
}

async function copia(code, pulsante) {
  let ok = false;
  try { await navigator.clipboard.writeText(code.textContent); ok = true; } catch {
    const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(code); sel.removeAllRanges(); sel.addRange(r);
  }
  pulsante.textContent = ok ? 'Copiato' : 'Selezionato';
  annuncia(ok ? 'Comando copiato negli appunti.' : 'Comando selezionato: premi Ctrl+C (o Cmd+C) per copiarlo.');
  setTimeout(() => { pulsante.textContent = 'Copia'; }, 2000);
}

function aggiungiCopia() {
  for (const code of document.querySelectorAll('code[data-copia]')) {
    const box = code.closest('.comando');
    if (!box || box.querySelector('.copia')) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copia';
    btn.textContent = 'Copia';
    btn.setAttribute('aria-label', 'Copia il comando');
    btn.addEventListener('click', () => copia(code, btn));
    box.append(btn);
  }
}

function avvia() {
  document.documentElement.classList.add('js');
  const annuncio = document.createElement('div');
  annuncio.id = 'annuncio'; annuncio.className = 'vh'; annuncio.setAttribute('role', 'status'); annuncio.setAttribute('aria-live', 'polite');
  document.body.append(annuncio);
  aggiungiCopia();

  const sistema = rilevaSistema({
    platform: navigator.userAgentData?.platform || '',
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
  document.documentElement.dataset.sistema = sistema;
  const nota = document.getElementById('sistema-rilevato');
  const d = guida(sistema);
  if (d) {
    d.querySelector('.riconosciuto')?.removeAttribute('hidden');
    d.classList.add('evidenza');
    document.querySelector(`[data-apri="${sistema}"]`)?.classList.add('primario');
    if (nota) nota.textContent = `Abbiamo aperto la guida per ${NOMI_SISTEMA[sistema]}, il sistema che stai usando. Le altre si aprono con un clic.`;
  }
  // l'ancora nell'indirizzo ha la precedenza sul sistema rilevato
  if (location.hash && document.getElementById(location.hash.slice(1))) {
    apriAncora(location.hash);
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } else if (d) {
    apriSolo(sistema);
  }
  window.addEventListener('hashchange', () => apriAncora(location.hash));
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (a) apriAncora(a.getAttribute('href'));
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
else avvia();
