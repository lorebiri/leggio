// Area «aggiornamenti»: avviso dentro l'app quando esce una nuova versione di Leggio,
// «Novità di questa versione» al primo avvio dopo un aggiornamento, e l'impostazione
// «Controlla automaticamente gli aggiornamenti». Il controllo vero lo fa il main (electron/updater.cjs),
// che manda 'app:update-available'. Nessun dato inviato: solo una richiesta GET anonima a GitHub.
import { icon } from '../../core/icons.js';
import { compareVersions, riassuntoNote, rimandato, novitaDaMostrare, TRE_GIORNI } from './logica.js';
import { NOVITA } from './novita.js';

const K_AUTO = 'aggiornamenti.auto';
const K_RIMANDATO = 'aggiornamenti.rimandato';
const K_VISTA = 'aggiornamenti.ultimaVersioneVista';

const native = typeof window !== 'undefined' ? window.leggio : undefined;
const inviaPreferenze = (auto) => { try { native?.invoke('app:update-prefs', { auto: !!auto })?.catch?.(() => {}); } catch {} };

export default function registerAggiornamenti(app) {
  const { h } = app.ui;
  let barra = null;
  let versioneInUso = null;

  // ---------- impostazione ----------
  app.bus.on('settings:fields', (campi) => campi.push({
    key: K_AUTO,
    field: { label: 'Controlla automaticamente gli aggiornamenti', type: 'checkbox', value: true,
      help: 'Una volta al giorno Leggio chiede a GitHub se c\'è una versione nuova. Non invia nessun dato tuo.' },
  }));
  app.bus.on('settings:changed', ({ key, value }) => { if (key === K_AUTO) inviaPreferenze(value); });
  inviaPreferenze(app.settings.get(K_AUTO, true));

  // ---------- barra «È disponibile Leggio X.Y.Z» ----------
  app.platform.on('app:update-available', (info) => {
    if (!info || !info.version) return;
    if (app.settings.get(K_AUTO, true) === false) return;
    if (versioneInUso && compareVersions(info.version, versioneInUso) <= 0) return;
    if (rimandato(app.settings.get(K_RIMANDATO, null), info.version)) return;
    mostraBarra(info);
  });

  function chiudiBarra() {
    if (!barra) return;
    const b = barra; barra = null;
    b.classList.add('chiusura');
    setTimeout(() => b.remove(), 180);
  }

  function mostraBarra(info) {
    stile();
    if (barra && barra.dataset.versione === info.version) return; // già visibile
    chiudiBarra();
    const { righe, altro } = riassuntoNote(info.notes, 3);
    const testo = h('div', { class: 'agg-testo' },
      h('strong', { class: 'agg-titolo' }, `È disponibile Leggio ${info.version}`),
      h('p', { class: 'agg-sotto' }, 'Una nuova versione gratuita, pronta da scaricare.'),
      righe.length ? h('ul', { class: 'agg-novita' }, righe.map((r) => h('li', {}, r))) : null,
      h('button', { type: 'button', class: 'agg-link', onclick: () => app.platform.openExternal(info.url) },
        altro || righe.length ? 'Leggi tutte le novità' : 'Cosa cambia'));
    const scarica = h('button', { type: 'button', class: 'btn primary', onclick: () => {
      app.platform.openExternal(info.downloadUrl || info.url);
      testo.replaceChildren(
        h('strong', { class: 'agg-titolo' }, 'Download avviato'),
        h('p', { class: 'agg-sotto' }, info.downloadUrl
          ? 'Quando il file è stato scaricato, aprilo e segui le istruzioni. I tuoi documenti e le impostazioni restano al loro posto.'
          : 'Si è aperta la pagina di Leggio: scegli il file per il tuo computer e, una volta scaricato, aprilo e segui le istruzioni.'));
      azioni.replaceChildren(h('button', { type: 'button', class: 'btn', onclick: chiudiBarra }, 'Chiudi'));
    } }, 'Scarica');
    const tardi = h('button', { type: 'button', class: 'btn', onclick: () => {
      app.settings.set(K_RIMANDATO, { versione: info.version, fino: Date.now() + TRE_GIORNI });
      chiudiBarra();
    } }, 'Più tardi');
    const azioni = h('div', { class: 'agg-azioni' }, tardi, scarica);
    barra = h('section', { class: 'agg-barra', role: 'status', 'aria-live': 'polite', 'aria-label': 'Aggiornamento disponibile' },
      h('span', { class: 'agg-ico', html: icon('sparkles', 22) }), testo, azioni);
    barra.dataset.versione = info.version;
    document.body.append(barra);
  }

  // ---------- «Novità di questa versione» (una sola volta per versione) ----------
  (async () => {
    let infoApp;
    try { infoApp = await app.platform.info(); } catch { return; }
    const attuale = infoApp && infoApp.version;
    if (!attuale || !/^\d+\.\d+\.\d+/.test(attuale)) return; // anteprima nel browser: niente
    versioneInUso = attuale;
    const vista = app.settings.get(K_VISTA, null);
    if (vista === attuale) return;
    app.settings.set(K_VISTA, attuale);
    const voci = novitaDaMostrare(NOVITA, vista, attuale);
    if (!voci.length) return;
    const corpo = h('div', { class: 'agg-dlg' }, voci.map((v) => h('section', {},
      h('h3', {}, voci.length > 1 ? `Versione ${v.versione} — ${v.titolo || ''}` : (v.titolo || `Versione ${v.versione}`)),
      h('ul', {}, (v.punti || []).map((p) => h('li', {}, p))))));
    stile();
    setTimeout(() => app.ui.dialog({ title: `Novità di Leggio ${attuale}`, body: corpo, okLabel: 'Ho capito', cancelLabel: null, width: 480 }), 600);
  })();
}

let stileInserito = false;
function stile() {
  if (stileInserito) return;
  stileInserito = true;
  const s = document.createElement('style');
  s.dataset.area = 'aggiornamenti';
  s.textContent = `
.agg-barra { position: fixed; z-index: 900; right: 18px; bottom: 18px; width: min(460px, calc(100vw - 36px));
  display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; padding: 16px 18px 14px;
  background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-left: 4px solid var(--accent);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-pop); animation: agg-entra .28s var(--ease); }
.agg-barra.chiusura { opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s; }
.agg-ico { color: var(--accent); padding-top: 1px; }
.agg-titolo { display: block; font-size: 15px; }
.agg-sotto { margin: 2px 0 0; color: var(--muted); }
.agg-novita { margin: 8px 0 0; padding-left: 18px; }
.agg-novita li { margin: 2px 0; }
.agg-link { margin-top: 6px; padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.agg-azioni { grid-column: 2; display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.agg-dlg h3 { margin: 0 0 6px; font-size: 15px; }
.agg-dlg section + section { margin-top: 14px; }
.agg-dlg ul { margin: 0; padding-left: 20px; }
.agg-dlg li { margin: 4px 0; }
@keyframes agg-entra { from { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .agg-barra { animation: none; } }
`;
  document.head.append(s);
}
