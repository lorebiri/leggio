// Avvio della pagina di download: propone il file giusto per il computer di chi visita.
// 1. Subito, con i dati della versione scritti nella pagina a ogni pubblicazione (scripts/sito-aggiorna.mjs):
//    numero, data, link diretti, dimensioni e impronte SHA-256. Senza JavaScript si vedono gli stessi dati.
// 2. Poi chiede a GitHub l'ultima versione pubblicata (cache di 10 minuti): se è più nuova aggiorna pulsanti ed elenco.
//    Se GitHub non risponde, è lento o ha raggiunto il limite di richieste, restano i dati della pagina.
import {
  CATALOGO, URL_API, URL_RELEASES, URL_SORGENTE, NOMI_SISTEMA,
  rilevaSistema, leggiRelease, leggiDatiStatici, scegliPrincipale,
  urlDownloadSicuro, formattaDimensione, formattaData, risparmioAnnuo, formattaEuro,
} from './scarica.js';

const $ = (sel, el = document) => el.querySelector(sel);
const voce = (chiave) => CATALOGO.find((v) => v.chiave === chiave);

function crea(tag, attr = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of figli) if (f != null) el.append(f);
  return el;
}

// link sicuro: solo indirizzi di GitHub, altrimenti la pagina delle versioni
const href = (url) => (urlDownloadSicuro(url) ? url : URL_RELEASES);

async function conTempo(url, opzioni = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opzioni, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  finally { clearTimeout(t); }
}

const CACHE = 'leggio-release';
const CACHE_MS = 10 * 60 * 1000;

async function caricaRelease() {
  try {
    const salvata = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
    const r = salvata && Date.now() - salvata.quando < CACHE_MS ? leggiRelease(salvata.json) : null;
    if (r) return r;
  } catch { /* sessionStorage non disponibile */ }
  const r = await conTempo(URL_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ha risposto ${r.status}`);
  const json = await r.json();
  const release = leggiRelease(json);
  if (!release) throw new Error('Risposta di GitHub non valida');
  try { sessionStorage.setItem(CACHE, JSON.stringify({ quando: Date.now(), json: { tag_name: json.tag_name, published_at: json.published_at, html_url: json.html_url, assets: (json.assets || []).map(({ name, size, url, browser_download_url }) => ({ name, size, url, browser_download_url })) } })); } catch { /* pazienza */ }
  return release;
}

// Dati della versione scritti nella pagina (blocco «sync:head»).
function datiStatici() {
  try { return leggiDatiStatici(JSON.parse($('#dati-versione')?.textContent || 'null')); } catch { return null; }
}

function annuncia(testo) {
  const el = $('#annuncio');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = testo; }, 50);
}

async function copia(testo, pulsante) {
  let ok = false;
  try { await navigator.clipboard.writeText(testo); ok = true; } catch {
    // ripiego: selezione del testo, l'utente copia con Ctrl+C
    const code = pulsante.previousElementSibling;
    if (code) { const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(code); sel.removeAllRanges(); sel.addRange(r); }
  }
  pulsante.textContent = ok ? 'Copiata' : 'Selezionata';
  annuncia(ok ? 'Impronta copiata negli appunti.' : 'Impronta selezionata: premi Ctrl+C (o Cmd+C) per copiarla.');
  setTimeout(() => { pulsante.textContent = 'Copia'; }, 2000);
}

function rigaImpronta(nome, hex) {
  const btn = crea('button', { type: 'button', class: 'copia', 'aria-label': `Copia l'impronta SHA-256 di ${nome}`, text: 'Copia' });
  btn.addEventListener('click', () => copia(hex, btn));
  return crea('span', { class: 'impronta' }, crea('span', { text: 'SHA-256:' }), crea('code', { text: hex }), btn);
}

function dettaglio(f) {
  return [f?.nome, formattaDimensione(f?.dimensione)].filter(Boolean).join(' · ');
}

// ---- pulsante principale ----

function pulsante(chiave, release, primario) {
  const v = voce(chiave);
  const f = release?.file?.[chiave];
  const testo = chiave === 'win-installer' ? 'Scarica per Windows' : chiave === 'linux-appimage' ? 'Scarica per Linux' : `Scarica per ${v.breve}`;
  const sotto = f ? [chiave === 'win-installer' ? 'Installer' : null, release.versione && `versione ${release.versione}`, formattaDimensione(f.dimensione)].filter(Boolean).join(' · ') : 'dalla pagina ufficiale su GitHub';
  return crea('a', { class: primario ? 'btn primario' : 'btn', href: href(f?.url), 'data-principale': chiave }, testo, ' ', crea('small', { text: sotto }));
}

function disegnaPrincipale(sistema, arch, release, errore) {
  const box = $('#principale');
  const { chiavi } = scegliPrincipale(sistema, release ? release.file : null, arch);
  const pezzi = [];
  if (sistema === 'windows') {
    pezzi.push(crea('div', { class: 'cta' }, pulsante('win-installer', release, true),
      crea('a', { class: 'btn', href: href(release?.file?.['win-portatile']?.url) }, 'Versione portatile', ' ', crea('small', { text: 'senza installazione' }))));
    pezzi.push(crea('p', { class: 'nota', text: 'Per Windows 10 e 11 (64 bit). Altri sistemi e file più in basso.' }));
  } else if (sistema === 'mac') {
    pezzi.push(crea('div', { class: 'cta' }, pulsante(chiavi[0], release, true), pulsante(chiavi[1], release, false)));
    pezzi.push(crea('p', { class: 'nota scelta-mac' },
      'Il browser non dice con certezza che chip ha il tuo Mac. Controlla dal menu Apple → ', crea('em', { text: 'Informazioni su questo Mac' }),
      ': «Chip Apple M…» → chip Apple; «Processore Intel» → Intel. Per macOS 12 o successivo.'));
  } else if (sistema === 'linux' && chiavi.length) {
    pezzi.push(crea('div', { class: 'cta' }, pulsante('linux-appimage', release, true)));
    pezzi.push(crea('p', { class: 'nota', text: 'AppImage per Linux a 64 bit (x86_64): rendila eseguibile e aprila.' }));
  } else if (sistema === 'linux') {
    pezzi.push(crea('p', { class: 'nota forte' }, crea('strong', { text: 'Linux: presto disponibile.' }), ' Nel frattempo puoi ', crea('a', { href: URL_SORGENTE, text: 'compilarlo dal codice sorgente' }), '.'));
    pezzi.push(crea('div', { class: 'cta' }, crea('a', { class: 'btn', href: '#altri-sistemi', text: 'Vedi i file per Windows e macOS' })));
  } else {
    const dove = sistema === 'mobile' ? 'Leggio è un programma per computer (Windows, macOS, Linux): apri questa pagina dal computer, oppure scegli il file qui sotto.' : `Non riconosco il sistema di ${NOMI_SISTEMA[sistema] || 'questo computer'}: scegli il file qui sotto.`;
    pezzi.push(crea('p', { class: 'nota', text: dove }));
    pezzi.push(crea('div', { class: 'cta' }, crea('a', { class: 'btn primario', href: '#altri-sistemi' }, 'Scegli il file', ' ', crea('small', { text: 'Windows, macOS, Linux' }))));
  }
  if (errore) {
    pezzi.push(crea('p', { class: 'nota', role: 'status' }, 'Non riesco a leggere l\'elenco dei file da GitHub in questo momento: i pulsanti portano alla ',
      crea('a', { href: URL_RELEASES, text: 'pagina ufficiale delle versioni' }), ', dove trovi gli stessi file.'));
  }
  box.replaceChildren(...pezzi);
  box.setAttribute('aria-busy', 'false');
}

// ---- elenco di tutti i file ----

function aggiornaElenco(release, somme) {
  for (const li of document.querySelectorAll('[data-file]')) {
    const chiave = li.dataset.file;
    const f = release.file[chiave];
    const a = $('a', li);
    const info = $('.file-info', li);
    li.querySelector('.impronta')?.remove();
    if (!f) {
      li.classList.add('assente');
      continue;
    }
    li.classList.remove('assente');
    a.href = href(f.url);
    if (info) info.textContent = dettaglio(f);
    const hex = somme.get(f.nome);
    if (hex) li.append(rigaImpronta(f.nome, hex));
  }
  const presto = $('#linux-presto');
  if (presto) presto.hidden = !!release.file['linux-appimage'];
  const nota = $('#somme-nota');
  if (nota) {
    nota.replaceChildren(...(release.somme
      ? ['Le impronte di tutti i file sono anche nel file ', crea('a', { href: href(release.somme.url) }, crea('code', { text: 'SHA256SUMS.txt' })), ' pubblicato insieme alla versione.']
      : ['Le impronte di tutti i file sono anche nel file ', crea('code', { text: 'SHA256SUMS.txt' }), ' pubblicato insieme alla versione, sulla ', crea('a', { href: release.pagina || URL_RELEASES, text: 'pagina della versione' }), '.']));
  }
}

function scriviVersione(release) {
  const el = $('#versione-testo');
  if (!el) return;
  const data = formattaData(release.data);
  el.textContent = `Versione ${release.versione}${data ? `, pubblicata il ${data}` : ''}.`;
}

// Mostra una versione (dalla pagina o da GitHub): pulsante principale, numero e data, elenco dei file.
function mostra(sistema, arch, release, somme) {
  disegnaPrincipale(sistema, arch, release, false);
  scriviVersione(release);
  aggiornaElenco(release, somme);
  aggiungiImprontePrincipali(release, somme);
}

function aggiungiImprontePrincipali(release, somme) {
  const box = $('#principale');
  box.querySelector('.impronte-principali')?.remove();
  const righe = [];
  for (const a of box.querySelectorAll('[data-principale]')) {
    const f = release.file[a.dataset.principale];
    const hex = f && somme.get(f.nome);
    if (hex) righe.push(crea('li', {}, crea('span', { class: 'file-info', text: f.nome }), rigaImpronta(f.nome, hex)));
  }
  if (righe.length) box.append(crea('ul', { class: 'impronte-principali', 'aria-label': 'Impronte SHA-256 dei file proposti' }, ...righe));
}

async function architettura() {
  try {
    const d = navigator.userAgentData;
    if (!d?.getHighEntropyValues) return '';
    const v = await Promise.race([d.getHighEntropyValues(['architecture']), new Promise((r) => setTimeout(() => r({}), 500))]);
    return v?.architecture || '';
  } catch { return ''; }
}

// Domande frequenti: un link a una risposta (#d-verifica…) apre la risposta chiusa.
function apriRisposta(hash) {
  let id = '';
  try { id = decodeURIComponent(String(hash || '').slice(1)); } catch { return; }
  const d = id && document.getElementById(id)?.closest('details');
  if (d && !d.open) d.open = true;
}

function collegaRisposte() {
  apriRisposta(location.hash);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  window.addEventListener('hashchange', () => apriRisposta(location.hash));
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (a) apriRisposta(a.getAttribute('href'));
  });
}

// «Quanto risparmi»: il conto con i numeri di chi visita (senza JavaScript restano le tre carte fisse).
function collegaCalcolo() {
  const box = $('#calcolo');
  const postazioni = $('#postazioni');
  const costo = $('#costo');
  const esito = $('#calcolo-esito');
  if (!box || !postazioni || !costo || !esito) return;
  const aggiorna = () => {
    const n = Number(postazioni.value);
    if (!Number.isInteger(n) || n < 1) { esito.textContent = 'Scrivi un numero intero di postazioni, da 1 in su.'; return; }
    if (costo.value.trim() === '') { esito.replaceChildren('Con Leggio, ', crea('strong', { text: `${n} ${n === 1 ? 'postazione' : 'postazioni'}` }), ' costano ', crea('span', { class: 'calcolo-noi', text: '0 €' }), '. Scrivi quanto paghi oggi per vedere quanto risparmi.'); return; }
    const anno = risparmioAnnuo(n, costo.value);
    if (anno == null) { esito.textContent = 'Scrivi il costo annuo per postazione in euro, per esempio 120.'; return; }
    esito.replaceChildren('Con Leggio risparmi ', crea('strong', { text: formattaEuro(anno) }), ' l\'anno, ',
      crea('strong', { text: formattaEuro(anno * 3) }), ' in tre anni. ', crea('span', { class: 'calcolo-noi', text: 'Leggio: 0 €.' }));
  };
  postazioni.addEventListener('input', aggiorna);
  costo.addEventListener('input', aggiorna);
  box.hidden = false;
  aggiorna();
}

async function avvia() {
  document.documentElement.classList.add('js');
  collegaRisposte();
  collegaCalcolo();
  document.body.append(crea('div', { id: 'annuncio', class: 'vh', role: 'status', 'aria-live': 'polite' }));
  const sistema = rilevaSistema({
    platform: navigator.userAgentData?.platform || '',
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
  document.documentElement.dataset.sistema = sistema;
  document.querySelector(`.carta[data-sistema="${sistema}"]`)?.classList.add('evidenza');
  const guida = $('#link-guida');
  if (guida && ['windows', 'mac', 'linux'].includes(sistema)) guida.href = `sicurezza.html#${sistema}`;
  const arch = sistema === 'mac' ? await architettura() : '';

  // 1. subito i dati scritti nella pagina
  const statica = datiStatici();
  if (statica) mostra(sistema, arch, statica, statica.impronte);
  else $('#principale').setAttribute('aria-busy', 'true');

  // 2. poi l'ultima versione pubblicata, se GitHub risponde
  let release = null;
  try { release = await caricaRelease(); } catch (err) {
    console.info('Leggio: GitHub non risponde, restano i dati della pagina —', err.message);
  }
  // una release senza file riconosciuti (per esempio mentre si caricano) non sostituisce i dati della pagina
  if (!release || (statica && !Object.keys(release.file).length)) {
    if (!statica) disegnaPrincipale(sistema, arch, null, true);
    return;
  }
  // stessa versione della pagina: le impronte scritte nella pagina valgono anche per i file di GitHub
  const stessa = statica && statica.versione === release.versione;
  if (stessa && statica.fonte === 'github') return; // niente di nuovo
  const somme = stessa ? statica.impronte : new Map();
  if (stessa && !release.somme) release.somme = statica.somme;
  mostra(sistema, arch, release, somme);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
else avvia();
