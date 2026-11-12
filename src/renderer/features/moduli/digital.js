// Firma digitale con certificato («Usa un certificato»), firma CAdES .p7m, firma di più file, ID digitale,
// verifica delle firme con verdetto in italiano. Le operazioni crittografiche avvengono nel processo principale.
import { isDesktop, invoke, onProgress, onEvent } from './bridge.js';
import { countSignatures } from './formtools.js';

const fmtDate = (iso, time = true) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }); };
const P12_FILTERS = [{ name: 'ID digitale (.p12, .pfx)', extensions: ['p12', 'pfx'] }];

function desktopOnly(app, what) {
  app.ui.dialog({
    title: what, cancelLabel: null, okLabel: 'Ho capito',
    message: 'Questa funzione è disponibile nell\'app Leggio per Windows e macOS: la firma digitale usa il tuo certificato e avviene interamente sul computer, mai in un browser.',
  });
}

let sessionId = null; // { name, bytes } — solo in memoria, mai salvato su disco; la password non viene mai conservata

/**
 * Campo «Certificato»: certificati del sistema e delle smart card (portachiavi macOS / archivio Windows),
 * file .p12/.pfx, oppure il programma di firma installato. Restituisce la scelta come credenziale.
 */
function certificateField(app, systemList, { allowExternal = true, lastChoice } = {}) {
  return {
    name: 'cred', label: 'Firma con', type: 'custom',
    render(c) {
      const { h } = app.ui;
      const opts = [];
      for (const x of systemList.ids || []) {
        const detail = [x.fiscalCode && 'CF ' + x.fiscalCode, 'emesso da ' + x.issuer, (x.expired ? 'SCADUTO il ' : 'valido fino al ') + fmtDate(x.notAfter, false)].filter(Boolean).join(' · ');
        opts.push({ value: x.id, title: x.subject + (x.organization ? ' — ' + x.organization : ''), detail, badge: x.qualified ? 'qualificato' : x.source === 'smart card' ? 'smart card' : x.selfSigned ? 'autofirmato' : '', disabled: x.expired });
      }
      opts.push({ value: 'p12', title: 'File ID digitale (.p12 o .pfx)…', detail: sessionId ? 'Scelto: ' + sessionId.name : 'Il file del certificato con la sua password' });
      if (allowExternal) opts.push({ value: 'external', title: 'Programma di firma installato (Dike, ArubaSign, FirmaOK…)', detail: 'Leggio apre il documento nel programma e riapre da solo il file firmato' });
      const first = opts.find((o) => o.value === lastChoice && !o.disabled) || opts.find((o) => !o.disabled);
      let chosen = first?.value;
      const pwd = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Password del file .p12/.pfx', 'aria-label': 'Password dell\'ID digitale' });
      const fileLabel = h('span', { class: 'mod-idname' }, sessionId ? sessionId.name : 'Nessun file scelto');
      const p12Row = h('div', { class: 'mod-p12row' },
        h('div', { class: 'mod-idrow' }, fileLabel, h('button', { type: 'button', class: 'btn small', onclick: async () => {
          const f = (await app.platform.openFiles({ filters: P12_FILTERS, raw: true, title: 'Scegli il tuo ID digitale' }))?.[0];
          if (!f) return;
          if (f.bytes.length > 1024 * 1024) { app.ui.toast('Il file è troppo grande per essere un ID digitale.', { kind: 'error' }); return; }
          sessionId = { name: f.name, bytes: f.bytes }; fileLabel.textContent = f.name;
        } }, 'Scegli…')), pwd);
      const group = h('div', { class: 'mod-certlist', role: 'radiogroup', 'aria-label': 'Certificato con cui firmare' });
      const name = 'cert' + Math.random().toString(36).slice(2);
      const sync = () => { p12Row.hidden = chosen !== 'p12'; };
      for (const o of opts) {
        const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === chosen, disabled: o.disabled, onchange: () => { chosen = o.value; sync(); } });
        group.append(h('label', { class: 'mod-cert' + (o.disabled ? ' disabled' : '') }, input,
          h('span', { class: 'mod-cert-txt' }, h('strong', {}, o.title, o.badge ? h('span', { class: 'mod-badge' }, o.badge) : null), h('small', {}, o.detail))));
      }
      c.append(group, p12Row);
      if (systemList.note) c.append(h('p', { class: 'help' }, systemList.note));
      sync();
      return { get: () => {
        if (chosen === 'p12') return sessionId ? { type: 'p12', p12: sessionId.bytes, password: pwd.value, choice: 'p12' } : { missing: 'Scegli il file del tuo ID digitale (.p12 o .pfx).' };
        if (chosen === 'external') return { type: 'external', choice: 'external' };
        return chosen ? { type: 'system', id: chosen, choice: chosen } : { missing: 'Scegli un certificato.' };
      } };
    },
  };
}

async function loadSystemIds(app) {
  const r = await app.ui.withProgress('Lettura dei certificati', async (p) => { p.set(null, 'Certificati del sistema e smart card…'); return invoke('moduli:list-system-ids', {}); }, { cancellable: false });
  return r?.ok ? r.result : { supported: false, ids: [], note: r?.error || '' };
}

/** Sceglie il certificato e lo controlla. → { ...valori, credential, cert } | { ...valori, external:true } | null */
export async function askCertificate(app, store, { title, extraFields = [], okLabel = 'Firma', allowExternal = true }) {
  const systemList = await loadSystemIds(app);
  let values = {};
  for (;;) {
    const v = await app.ui.dialog({
      title, width: 620, okLabel,
      fields: [certificateField(app, systemList, { allowExternal, lastChoice: store.getPref('lastCert', '') }), ...extraFields.map((f) => ({ ...f, value: values[f.name] ?? f.value }))],
      validate: (x) => x.cred?.missing || null,
    });
    if (!v) return null;
    values = v;
    store.setPref('lastCert', v.cred.choice);
    if (v.cred.type === 'external') return { ...v, external: true };
    const { choice, ...credential } = v.cred;
    const r = await app.ui.withProgress('Controllo del certificato', async (p) => { p.set(null, 'Apertura del certificato…'); return invoke('moduli:describe-id', { credential }); }, { cancellable: false });
    if (r?.ok) return { ...v, credential, cert: r.result };
    await app.ui.dialog({ title: 'Certificato non utilizzabile', message: r?.error || 'Errore', cancelLabel: null, okLabel: 'Riprova' });
  }
}

function certWarnings(cert) {
  const w = [];
  if (cert.selfSigned) w.push('Certificato autofirmato: va bene per documenti interni, non ha valore di firma qualificata.');
  const days = (new Date(cert.notAfter) - Date.now()) / 86400000;
  if (days < 30 && days > 0) w.push(`Il certificato scade tra ${Math.ceil(days)} giorni.`);
  return w;
}

/** Disegno di un riquadro sulla pagina (per la firma visibile). → { pageIndex, rect } | null */
function pickRect(app, message) {
  return new Promise((resolve) => {
    const viewer = app.viewer;
    const prevMode = viewer.mode;
    viewer.setMode('tool', 'crosshair');
    const t = app.ui.toast(message + ' (Esc per annullare)', { timeout: 60000 });
    let start = null; let box = null; let pageIndex = -1;
    const cleanup = (res) => {
      viewer.container.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      document.removeEventListener('keydown', key, true);
      box?.remove(); t.remove();
      viewer.setMode(prevMode === 'tool' ? 'select' : prevMode);
      resolve(res);
    };
    const down = (e) => {
      const ov = e.target.closest?.('.leggio-overlay'); if (!ov || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      pageIndex = +ov.dataset.pageIndex;
      const r = ov.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, ox: r.left, oy: r.top };
      box = document.createElement('div'); box.className = 'mod-pickrect'; ov.append(box);
      move(e);
    };
    const move = (e) => {
      if (!start) return;
      const x1 = Math.min(start.x, e.clientX) - start.ox; const y1 = Math.min(start.y, e.clientY) - start.oy;
      Object.assign(box.style, { left: x1 + 'px', top: y1 + 'px', width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px' });
    };
    const up = (e) => {
      if (!start) return;
      let a = viewer.clientToPdf(pageIndex, start.x, start.y); let b = viewer.clientToPdf(pageIndex, e.clientX, e.clientY);
      if (!a || !b) return cleanup(null);
      if (Math.abs(a[0] - b[0]) < 20 || Math.abs(a[1] - b[1]) < 10) {
        // semplice clic: riquadro standard centrato
        const c = b; a = [c[0] - 90, c[1] - 30]; b = [c[0] + 90, c[1] + 30];
      }
      cleanup({ pageIndex, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
    };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cleanup(null); } };
    viewer.container.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    document.addEventListener('keydown', key, true);
  });
}

function dataUrlToBytes(u) { const b = atob(u.split(',')[1] || ''); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function baseName(n) { return (n || 'documento').replace(/\.pdf$/i, ''); }

export function registerDigital(app, store) {
  // ------------------------------------------------------------------ Usa un certificato (PAdES / CAdES)
  app.registerTool({
    id: 'digital-sign', name: 'Usa un certificato', category: 'moduli', icon: 'lock',
    description: 'Firma digitale con il tuo ID digitale (.p12/.pfx): firma visibile o invisibile nel PDF, oppure busta .p7m',
    keywords: 'firma digitale certificato pades cades p7m p12 pfx firma elettronica qualificata usa un certificato',
    async run() {
      if (!isDesktop()) return desktopOnly(app, 'Usa un certificato');
      const doc = app.activeDoc;
      const sigs = store.list('signature');
      const extra = [
        { name: 'kind', label: 'Tipo di firma', type: 'radio', value: store.getPref('dsKind', 'pades'), options: [{ value: 'pades', label: 'Firma nel PDF (PAdES) — si vede e si verifica aprendo il PDF' }, { value: 'cades', label: 'Busta .p7m (CAdES) — crea un file .pdf.p7m separato' }] },
        { name: 'visible', label: 'Mostra un riquadro con la firma sulla pagina', type: 'checkbox', value: store.getPref('dsVisible', true) },
        ...(sigs.length ? [{ name: 'image', label: 'Includi nel riquadro la mia firma grafica', type: 'checkbox', value: store.getPref('dsImage', true) }] : []),
        { name: 'reason', label: 'Motivo (facoltativo)', type: 'text', value: store.getPref('dsReason', ''), placeholder: 'es. Approvazione, Per accettazione' },
        { name: 'location', label: 'Luogo (facoltativo)', type: 'text', value: store.getPref('dsLocation', ''), placeholder: 'es. Sesto Fiorentino' },
        { name: 'standard', label: 'Formato della firma nel PDF', type: 'select', value: store.getPref('dsStandard', 'cades'), options: [{ value: 'cades', label: 'PAdES europeo (consigliato)' }, { value: 'pkcs7', label: 'Compatibile con lettori vecchi (adbe.pkcs7)' }] },
      ];
      const v = await askCertificate(app, store, { title: 'Usa un certificato', extraFields: extra, okLabel: 'Continua' });
      if (!v) return;
      if (v.external) return externalSign(app, store, doc);
      for (const k of ['kind', 'visible', 'image', 'reason', 'location', 'standard']) if (k in v) store.setPref('ds' + k[0].toUpperCase() + k.slice(1), v[k]);
      const warn = certWarnings(v.cert);
      const confirmMsg = `Firmerai come «${v.cert.subject}»${v.cert.organization ? ` (${v.cert.organization})` : ''}, certificato valido fino al ${fmtDate(v.cert.notAfter, false)}.` + (warn.length ? '\n\n' + warn.join('\n') : '');
      if (v.kind === 'cades') {
        if (!(await app.ui.confirm(confirmMsg, { title: 'Conferma la firma', okLabel: 'Firma e salva .p7m' }))) return;
        const bytes = await app.currentBytes(doc);
        const r = await app.ui.withProgress('Firma in corso', async (p) => { p.set(null, 'Creazione della busta .p7m…'); return invoke('moduli:sign-p7m', { data: bytes, credential: v.credential }); }, { cancellable: false });
        if (!r?.ok) return app.ui.dialog({ title: 'Firma non riuscita', message: r?.error || 'Errore sconosciuto', cancelLabel: null, okLabel: 'Chiudi' });
        const saved = await app.exportFile(r.result.bytes, doc.name.replace(/(\.pdf)?$/i, '.pdf.p7m'), [{ name: 'File firmato (.p7m)', extensions: ['p7m'] }]);
        if (saved) app.ui.toast('File firmato salvato: ' + (saved.name || ''), { kind: 'success', timeout: 5000 });
        return;
      }
      let place = null;
      if (v.visible) {
        place = await pickRect(app, 'Trascina sulla pagina il riquadro della firma, o fai un clic');
        if (!place) return;
      }
      if (!(await app.ui.confirm(confirmMsg + '\n\nDopo la firma, ogni modifica al documento renderà la firma non valida.', { title: 'Conferma la firma', okLabel: 'Firma' }))) return;
      const options = {
        visible: !!place, pageIndex: place?.pageIndex ?? 0, rect: place?.rect, reason: v.reason || '', location: v.location || '',
        subFilter: v.standard === 'pkcs7' ? 'pkcs7' : 'cades', name: v.cert.subject,
        imagePng: place && v.image && sigs[0] ? dataUrlToBytes(sigs[0].dataUrl) : undefined,
      };
      let result = null;
      const ok = await app.applyEdit('Firma digitale', async (bytes) => {
        const r = await app.ui.withProgress('Firma in corso', async (p) => { p.set(null, 'Calcolo della firma e verifica del risultato…'); return invoke('moduli:sign', { pdf: bytes, credential: v.credential, options }); }, { cancellable: false });
        if (!r?.ok) throw new Error(r?.error || 'Firma non riuscita');
        result = r.result;
        return r.result.bytes;
      }, doc, { signatureWarning: false }).catch(async (err) => {
        // ripiego: con smart card e certificati di sistema si può sempre passare dal programma del fornitore
        if (v.credential.type === 'system') {
          const c = await app.ui.choice({ title: 'Firma non riuscita', message: err.message + '\n\nPuoi firmare con il programma installato dal tuo fornitore (Dike, ArubaSign, FirmaOK…): Leggio riaprirà da solo il file firmato.', buttons: [{ value: 'close', label: 'Chiudi' }, { value: 'ext', label: 'Firma con il programma installato', primary: true }] });
          if (c === 'ext') externalSign(app, store, doc);
        } else app.ui.dialog({ title: 'Firma non riuscita', message: err.message, cancelLabel: null, okLabel: 'Chiudi' });
        return false;
      });
      if (ok && result) {
        const save = await app.ui.dialog({ title: 'Documento firmato', message: `${result.verification.verdict.title}. Salva ora il documento: ${doc.path ? 'puoi sovrascrivere l\'originale o farne una copia' : 'scegli dove'}.`, okLabel: 'Salva con nome…', cancelLabel: 'Più tardi' });
        if (save) await app.save(doc, { as: true });
      }
    },
  });

  app.registerTool({
    id: 'sign-external', name: 'Firma con il programma installato', category: 'moduli', icon: 'signature',
    description: 'Apre il documento in Dike, ArubaSign, FirmaOK… e riapre da solo il file firmato',
    keywords: 'dike arubasign firmaok firmacerta gosign smart card token cns firma qualificata programma esterno p7m',
    async run() {
      if (!isDesktop()) return desktopOnly(app, 'Firma con il programma installato');
      return externalSign(app, store, app.activeDoc);
    },
  });

  // ------------------------------------------------------------------ firma di più file
  app.registerTool({
    id: 'sign-batch', name: 'Firma più file', category: 'moduli', icon: 'lock', needsDoc: false,
    description: 'Firma digitalmente molti PDF (o altri file in .p7m) in una volta, con una sola password',
    keywords: 'firma in blocco più file massiva multipla p7m pades cartella',
    run: () => firmaFile(app, store, null),
  });

  // servizio per le altre aree (es. l'archivio: «Firma…» sui documenti selezionati)
  app.services ||= {};
  app.services.firmaFile = (files, opzioni) => firmaFile(app, store, files, opzioni);

  // ------------------------------------------------------------------ ID digitale autofirmato
  app.registerTool({
    id: 'create-digital-id', name: 'Crea ID digitale', category: 'moduli', icon: 'lock', needsDoc: false,
    description: 'Crea in un clic un certificato personale autofirmato (.p12) per firmare documenti interni',
    keywords: 'crea id digitale certificato autofirmato p12 pfx nuovo',
    async run() {
      if (!isDesktop()) return desktopOnly(app, 'Crea ID digitale');
      const prof = store.getProfile();
      const v = await app.ui.dialog({
        title: 'Crea ID digitale', width: 540, okLabel: 'Crea e salva…',
        message: 'Un ID autofirmato va bene per documenti interni e prove. Per gli atti ufficiali serve la firma qualificata rilasciata da un ente certificatore (smart card, token o firma remota).',
        fields: [
          { name: 'name', label: 'Nome e cognome', type: 'text', value: prof.nomeCompleto || [prof.nome, prof.cognome].filter(Boolean).join(' ') || app.settings.get('author', ''), required: true },
          { name: 'email', label: 'Email', type: 'text', value: prof.email || '' },
          { name: 'organization', label: 'Ente o organizzazione', type: 'text', value: prof.ente || '' },
          { name: 'unit', label: 'Ufficio', type: 'text', value: prof.ufficio || '' },
          { name: 'password', label: 'Password per proteggere l\'ID (almeno 6 caratteri)', type: 'password', required: true },
          { name: 'password2', label: 'Ripeti la password', type: 'password', required: true },
          { name: 'years', label: 'Validità', type: 'select', value: '5', options: [{ value: '1', label: '1 anno' }, { value: '3', label: '3 anni' }, { value: '5', label: '5 anni' }, { value: '10', label: '10 anni' }] },
        ],
        validate: (x) => (x.password.length < 6 ? 'La password deve avere almeno 6 caratteri.' : x.password !== x.password2 ? 'Le due password non coincidono.' : x.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email) ? 'L\'email non sembra valida.' : null),
      });
      if (!v) return;
      const r = await app.ui.withProgress('Creazione dell\'ID digitale', async (p) => { p.set(null, 'Generazione delle chiavi…'); return invoke('moduli:create-id', { name: v.name, email: v.email, organization: v.organization, unit: v.unit, password: v.password, years: +v.years }); }, { cancellable: false });
      if (!r?.ok) return app.ui.dialog({ title: 'ID non creato', message: r?.error, cancelLabel: null, okLabel: 'Chiudi' });
      const saved = await app.exportFile(r.result, `${v.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'ID'}.p12`, P12_FILTERS);
      if (saved) { sessionId = { name: saved.name || 'ID.p12', bytes: r.result }; app.ui.toast('ID digitale creato. Conserva il file e la password: senza non si può firmare.', { kind: 'success', timeout: 7000 }); }
    },
  });

  // ------------------------------------------------------------------ verifica
  app.registerTool({
    id: 'verify-signatures', name: 'Verifica firme', category: 'moduli', icon: 'check',
    description: 'Controlla le firme digitali: chi ha firmato, quando, e se il documento è stato modificato dopo',
    keywords: 'verifica firme digitali convalida pannello firme valida certificato',
    run: () => openVerifyPanel(app),
  });

  // I file .p7m (apertura, trascinamento, verifica) sono gestiti dall'area «avanzati»:
  // un solo punto d'ingresso evita doppie finestre.
}

/**
 * Ripiego «Firma con il programma installato»: apre il documento nel programma di firma del fornitore
 * e osserva la cartella; quando compare il file firmato (.p7m o PDF firmato) Leggio lo apre da solo.
 */
async function externalSign(app, store, doc) {
  let apps = (await invoke('moduli:external-apps', {}))?.result || [];
  const { h } = app.ui;
  let appId = store.getPref('extApp', '');
  if (!apps.some((a) => a.id === appId)) appId = apps[0]?.id || '';
  const v = await app.ui.dialog({
    title: 'Firma con il programma installato', width: 560, okLabel: 'Apri nel programma',
    message: 'Leggio apre il documento nel programma di firma (Dike, ArubaSign, FirmaOK…). Firma lì come al solito, salvando nella stessa cartella: quando il file firmato compare, Leggio lo apre da solo.',
    fields: [{ name: 'app', label: 'Programma', type: 'custom', render(c) {
      const sel = h('select', { 'aria-label': 'Programma di firma' });
      const fill = () => { sel.textContent = ''; for (const a of apps) sel.append(h('option', { value: a.id, selected: a.id === appId }, a.name)); if (!apps.length) sel.append(h('option', { value: '' }, 'Nessun programma trovato')); };
      fill();
      c.append(h('div', { class: 'mod-idrow' }, sel, h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const r = await invoke('moduli:external-choose', {});
        if (r?.ok && r.result) { apps = (await invoke('moduli:external-apps', {}))?.result || apps; appId = r.result.id; fill(); }
      } }, 'Scegli programma…')));
      return { get: () => sel.value };
    } }],
    validate: (x) => (!x.app ? 'Scegli il programma di firma (pulsante «Scegli programma…»).' : null),
  });
  if (!v) return;
  store.setPref('extApp', v.app);
  // se il documento è già su disco e non ha modifiche si apre l'originale, altrimenti una copia di lavoro
  const unchanged = doc.path && !doc.dirty && !doc.formsDirty;
  const payload = unchanged ? { appId: v.app, path: doc.path, name: doc.name } : { appId: v.app, pdf: await app.currentBytes(doc), name: doc.name };
  const r = await invoke('moduli:external-sign', payload);
  if (!r?.ok) return app.ui.dialog({ title: 'Programma non avviato', message: r?.error || 'Errore', cancelLabel: null, okLabel: 'Chiudi' });
  const { token, folder } = r.result;
  let off = null;
  const t = app.ui.toast(`In attesa del file firmato nella cartella ${folder}…`, { timeout: 30 * 60 * 1000, action: { label: 'Smetti di attendere', run: () => { off?.(); invoke('moduli:external-cancel', { token }); } } });
  off = onEvent('feat:moduli:external-result', async (res) => {
    if (!res || res.token !== token) return;
    off?.(); t.remove?.();
    if (res.timeout) return app.ui.toast('Nessun file firmato comparso nella cartella: se hai firmato, aprilo con «Apri».', { kind: 'warning', timeout: 8000 });
    if (res.error) return app.ui.toast('File firmato non leggibile: ' + res.error, { kind: 'error' });
    app.ui.toast('File firmato trovato: ' + res.name, { kind: 'success' });
    try { await (app.openFile ? app.openFile({ path: res.path, name: res.name, bytes: res.bytes }) : app.openBytes(res.bytes, { name: res.name, path: res.path })); }
    catch (e) { app.reportError(e, 'Apertura del file firmato'); }
  });
}

/**
 * «Firma più file». Con files = null i file si scelgono nella finestra del sistema (come oggi);
 * con files = [{ path, name }] si firmano quelli, senza altre finestre: il certificato si sceglie una volta sola.
 * → [{ path, ok, uscita, errore }] (con files = null: undefined). Per ogni file firmato emette «archivio:stato».
 * opzioni: { formato: 'pdf'|'p7m', motivo, mostraEsito (predefinito: solo se ci sono errori), deps (per i test) }
 */
export async function firmaFile(app, store, files, opzioni = {}) {
  const d = { invoke, onProgress, askCertificate, isDesktop, ...(opzioni.deps || {}) };
  const list = files == null ? null : (Array.isArray(files) ? files : [files])
    .map((f) => (typeof f === 'string' ? { path: f } : f))
    .filter((f) => f && typeof f.path === 'string' && f.path);
  if (list && !list.length) return [];
  const fail = (msg) => (list ? list.map((f) => ({ path: f.path, ok: false, uscita: null, errore: msg })) : undefined);
  if (!d.isDesktop()) { desktopOnly(app, 'Firma più file'); return fail('Funzione disponibile solo nell\'app desktop.'); }
  const n = list?.length;
  const fmtDefault = opzioni.formato === 'p7m' || opzioni.formato === 'pdf' ? opzioni.formato : store.getPref('batchFmt', 'pdf');
  const v = await d.askCertificate(app, store, {
    title: n ? (n === 1 ? 'Firma 1 file' : `Firma ${n} file`) : 'Firma più file',
    okLabel: n ? 'Firma' : 'Scegli i file…', allowExternal: false,
    extraFields: [
      { name: 'format', label: 'Tipo di firma', type: 'radio', value: fmtDefault, options: [{ value: 'pdf', label: 'Firma nei PDF (PAdES, invisibile) → nome_firmato.pdf' }, { value: 'p7m', label: 'Buste .p7m (CAdES), anche per file non PDF → nome.pdf.p7m' }] },
      { name: 'reason', label: 'Motivo (facoltativo)', type: 'text', value: opzioni.motivo ?? store.getPref('dsReason', '') },
      { name: 'info', type: 'info', text: 'I file originali non vengono modificati: le copie firmate sono salvate accanto agli originali.' },
    ],
  });
  if (!v) return fail('Firma annullata.');
  store.setPref('batchFmt', v.format);
  let off = null;
  const payload = { credential: v.credential, format: v.format, options: { reason: v.reason || '', subFilter: 'cades', name: v.cert.subject } };
  const r = await app.ui.withProgress(n ? 'Firma dei documenti' : 'Firma dei file', async (p) => {
    p.set(null, n ? 'Preparazione…' : 'Scegli i file da firmare…');
    off = d.onProgress((x) => p.set(x.index / Math.max(1, x.total), `${x.phase === 'firma' ? 'Firma (il PIN può essere chiesto una volta)' : `${x.index + 1} di ${x.total}: ${x.name}`}`));
    return n ? d.invoke('moduli:sign-files', { ...payload, paths: list.map((f) => f.path) }) : d.invoke('moduli:sign-batch', payload);
  }, { cancellable: false }).finally(() => off?.());
  if (!r?.ok) { app.ui.dialog({ title: 'Firma non riuscita', message: r?.error || 'Errore', cancelLabel: null, okLabel: 'Chiudi' }); return fail(r?.error || 'Firma non riuscita.'); }
  if (r.result.cancelled) return undefined;
  const results = r.result.results || [];
  // stato «firmato» nell'archivio, per ogni documento firmato
  for (const x of results) {
    if (!x.ok || !x.path) continue;
    try { app.bus.emit('archivio:stato', { path: x.path, nome: x.name, modifica: { imposta: 'firmato' }, origine: 'firma', copia: x.output, ricevuto: false }); } catch {}
  }
  const okN = results.filter((x) => x.ok).length;
  const showDialog = opzioni.mostraEsito ?? (okN < results.length || !n);
  if (showDialog) {
    const { h } = app.ui;
    const ul = h('ul', { class: 'mod-batch' }, results.map((x) => h('li', { class: x.ok ? 'ok' : 'bad' }, h('strong', {}, (x.ok ? '✔ ' : '✖ ') + x.name), x.ok ? h('small', {}, ' → ' + x.output) : h('small', {}, ' — ' + x.error))));
    app.ui.dialog({ title: `Firmati ${okN} file su ${results.length}`, body: ul, cancelLabel: null, okLabel: 'Chiudi', width: 620 });
  } else app.ui.toast(okN === 1 ? 'Documento firmato: la copia firmata è accanto all\'originale.' : `Firmati ${okN} documenti: le copie firmate sono accanto agli originali.`, { kind: 'success', timeout: 6000 });
  if (!list) return undefined;
  const byPath = new Map(results.map((x) => [x.path, x]));
  return list.map((f) => { const x = byPath.get(f.path); return x ? { path: f.path, ok: !!x.ok, uscita: x.output || null, errore: x.ok ? null : x.error || 'Errore' } : { path: f.path, ok: false, uscita: null, errore: 'File non elaborato.' }; });
}

async function openP7m(app, f) {
  const r = await invoke('moduli:verify-p7m', { data: f.bytes });
  if (!r.ok) return app.ui.dialog({ title: 'File .p7m non leggibile', message: r.error, cancelLabel: null, okLabel: 'Chiudi' });
  const { h } = app.ui;
  const body = h('div', { class: 'mod-verify' }, r.result.layers.map((l) => sigCard(app, { ...l, verdict: l.verdict }, { compact: true })));
  const content = r.result.content;
  const isPdf = content && new TextDecoder('latin1').decode(content.subarray(0, 1024)).includes('%PDF');
  const go = await app.ui.dialog({ title: 'Firma del file ' + f.name, body, width: 600, okLabel: isPdf ? 'Apri il PDF contenuto' : 'Salva il contenuto…', cancelLabel: 'Chiudi' });
  if (!go || !content) return;
  const innerName = f.name.replace(/(\.p7m)+$/i, '') || 'contenuto';
  if (isPdf) await app.openBytes(content, { name: /\.pdf$/i.test(innerName) ? innerName : innerName + '.pdf' });
  else await app.exportFile(content, innerName, [{ name: 'File', extensions: ['*'] }]);
}

function sigCard(app, s, { compact = false, onGo } = {}) {
  const { h } = app.ui;
  const v = s.verdict || { level: 'bad', title: 'Firma non verificabile', detail: s.problems || [] };
  const c = s.signer;
  const rows = [
    ['Firmatario', c ? c.subject + (c.organization ? ` — ${c.organization}` : '') : s.name || '—'],
    ...(c?.fiscalCode ? [['Codice fiscale', c.fiscalCode]] : []),
    ['Data della firma', fmtDate(s.signingTime)],
    ...(s.reason ? [['Motivo', s.reason]] : []),
    ...(s.location ? [['Luogo', s.location]] : []),
    ...(c ? [['Certificato', `${c.selfSigned ? 'autofirmato' : 'rilasciato da ' + (c.issuerOrg || c.issuer)}, valido dal ${fmtDate(c.notBefore, false)} al ${fmtDate(c.notAfter, false)}`]] : []),
    ...(!compact && s.subFilter ? [['Formato', s.subFilter === 'ETSI.CAdES.detached' ? 'PAdES (europeo)' : s.subFilter === 'adbe.pkcs7.detached' ? 'PKCS#7 (Adobe)' : s.subFilter]] : []),
    ...(!compact && s.fieldName ? [['Campo', s.fieldName + (s.page >= 0 ? ` — pagina ${s.page + 1}` : '') + (s.visible ? '' : ' (invisibile)')]] : []),
  ];
  return h('section', { class: 'mod-sigcard ' + v.level },
    h('header', {}, h('span', { class: 'mod-sem', 'aria-hidden': 'true' }), h('strong', {}, v.title)),
    h('table', { class: 'props' }, rows.map(([k, val]) => h('tr', {}, h('th', {}, k), h('td', {}, val)))),
    v.detail?.length ? h('ul', { class: 'mod-sigdetail' }, v.detail.map((d) => h('li', {}, d))) : null,
    onGo && s.page >= 0 ? h('button', { class: 'btn small', onclick: () => onGo(s) }, 'Mostra nel documento') : null);
}

export async function openVerifyPanel(app) {
  const doc = app.activeDoc; if (!doc) return;
  const { h } = app.ui;
  const c = app.openRightPanel('Firme digitali');
  c.append(h('p', { class: 'muted pad' }, 'Verifica in corso…'));
  if (!isDesktop()) {
    const n = countSignatures(doc.bytes);
    c.textContent = '';
    c.append(h('div', { class: 'pad' },
      h('p', {}, n ? (n === 1 ? 'Il documento contiene una firma digitale.' : `Il documento contiene ${n} firme digitali.`) : 'Il documento non contiene firme digitali.'),
      h('p', { class: 'muted' }, 'La verifica completa (integrità, certificato, modifiche dopo la firma) è disponibile nell\'app Leggio per Windows e macOS.')));
    return;
  }
  const bytes = await app.currentBytes(doc);
  const r = await invoke('moduli:verify', { pdf: bytes });
  if (app.activeDoc !== doc) return;
  c.textContent = '';
  if (!r.ok) { c.append(h('p', { class: 'pad' }, 'Verifica non riuscita: ' + r.error)); return; }
  const rep = r.result;
  const box = h('div', { class: 'mod-verify pad' });
  box.append(h('div', { class: 'mod-summary ' + rep.summary.level }, h('span', { class: 'mod-sem', 'aria-hidden': 'true' }), h('strong', {}, rep.summary.text)));
  if (rep.signatures.length) {
    box.append(h('p', { class: 'muted small' }, 'Senza connessione non si può controllare se un certificato è stato revocato né confrontarlo con l\'elenco ufficiale dei certificatori: Leggio controlla integrità del documento, firma e validità del certificato.'));
    for (const s of rep.signatures) box.append(sigCard(app, s, { onGo: (x) => { app.viewer.page = x.page + 1; } }));
    box.append(h('button', { class: 'btn', onclick: () => exportReport(app, doc, rep).catch((e) => app.reportError(e, 'Rapporto di verifica')) }, 'Esporta il rapporto in PDF…'));
  }
  c.append(box);
}

/** Rapporto di verifica in PDF, per il fascicolo. */
async function exportReport(app, doc, rep) {
  const { PDFLib } = app.lib;
  const pdf = await PDFLib.PDFDocument.create();
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica); const bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const safe = (s) => { let o = ''; for (const ch of String(s ?? '')) { try { font.encodeText(ch); o += ch; } catch { o += '?'; } } return o; };
  let page = pdf.addPage([595, 842]); let y = 790;
  const line = (t, { f = font, size = 10.5, color = PDFLib.rgb(0.1, 0.1, 0.12), indent = 0 } = {}) => {
    const words = safe(t).split(/\s+/); let cur = '';
    const flush = () => { if (y < 60) { page = pdf.addPage([595, 842]); y = 790; } page.drawText(cur, { x: 50 + indent, y, size, font: f, color }); y -= size * 1.45; cur = ''; };
    for (const w of words) { const tt = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(tt, size) > 495 - indent && cur) { flush(); cur = w; } else cur = tt; }
    if (cur) flush();
  };
  line('Rapporto di verifica delle firme digitali', { f: bold, size: 16 }); y -= 4;
  line(`Documento: ${doc.name}`); line(`Dimensione: ${rep.fileSize} byte`); line(`Verificato il: ${new Date().toLocaleString('it-IT')} con Leggio (verifica locale, senza controllo di revoca online)`);
  y -= 6; line('Esito: ' + rep.summary.text, { f: bold, size: 12 }); y -= 6;
  const colors = { ok: PDFLib.rgb(0.02, 0.46, 0.28), warn: PDFLib.rgb(0.7, 0.28, 0.03), bad: PDFLib.rgb(0.7, 0.1, 0.08) };
  rep.signatures.forEach((s, i) => {
    y -= 6; line(`Firma ${i + 1}${s.fieldName ? ' (' + s.fieldName + ')' : ''}`, { f: bold, size: 12 });
    line(s.verdict.title, { f: bold, color: colors[s.verdict.level] });
    const c = s.signer;
    if (c) line(`Firmatario: ${c.subject}${c.organization ? ' — ' + c.organization : ''}${c.fiscalCode ? ' — C.F. ' + c.fiscalCode : ''}`);
    line(`Data della firma: ${fmtDate(s.signingTime)}`);
    if (s.reason) line(`Motivo: ${s.reason}`);
    if (s.location) line(`Luogo: ${s.location}`);
    if (c) line(`Certificato: ${c.selfSigned ? 'autofirmato' : 'rilasciato da ' + (c.issuerOrg || c.issuer)}, valido dal ${fmtDate(c.notBefore, false)} al ${fmtDate(c.notAfter, false)}, numero di serie ${c.serial}`);
    line(`Integrità del documento firmato: ${s.integrity ? 'sì' : 'NO'} · Firma crittografica corretta: ${s.signatureValid ? 'sì' : 'NO'} · Copre tutto il file: ${s.coversWholeDocument ? 'sì' : 'no'}`);
    for (const d of s.verdict.detail || []) line('• ' + d, { indent: 10 });
  });
  const bytes = await pdf.save();
  await app.exportFile(bytes, `${baseName(doc.name)}_verifica_firme.pdf`);
}
