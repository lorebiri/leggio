// Proteggi con password, Rimuovi protezione, e ri-cifratura automatica al salvataggio.
import { encryptBytes, openDecrypted, passwordStrength, fromPValue, describePermissions, hasRestrictions, TUTTI_PERMESSI, PasswordError, ALGORITMI } from './logica/cifratura.js';
import { encryptionInfo } from './logica/pdfutil.js';
import { PDFDocument } from '@cantoo/pdf-lib';
import { st, copyName, salvaCopia, looksEncrypted, boxAvviso } from './comune.js';

// Intenzione di protezione legata ai byte (così Annulla/Ripeti la seguono): bytes → { opts } | { orig } | false
const intent = new WeakMap();

function strengthMeter(app, input) {
  const { h } = app.ui;
  const bar = h('div'); const label = h('div', { class: 'lg-meter-label' }, ' ');
  const colors = ['#d92d20', '#f04438', '#f79009', '#12b76a', '#067647'];
  const upd = () => {
    const s = passwordStrength(input.value);
    bar.style.width = input.value ? `${(s.score + 1) * 20}%` : '0';
    bar.style.background = colors[s.score];
    label.textContent = input.value ? `Robustezza: ${s.label}. ${s.hint}` : 'Suggerimento: una frase di 4 parole è facile da ricordare e difficile da indovinare.';
  };
  input.addEventListener('input', upd); upd();
  return h('div', {}, h('div', { class: 'lg-meter' }, bar), label);
}

function passwordPair(app, labelText, help) {
  const { h } = app.ui;
  return {
    type: 'custom', name: labelText, label: labelText, help,
    render(c) {
      const a = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', 'aria-label': labelText });
      const b = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', placeholder: 'Ripeti la password', 'aria-label': 'Conferma ' + labelText, style: { marginTop: '6px' } });
      const show = h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12.5px', marginTop: '6px' } }, h('input', { type: 'checkbox', onchange: (e) => { a.type = b.type = e.target.checked ? 'text' : 'password'; } }), 'Mostra la password');
      c.append(a, b, strengthMeter(app, a), show);
      return { get: () => ({ value: a.value, confirm: b.value }) };
    },
  };
}

/** Dialogo «Proteggi con password». → opzioni o null */
async function askProtection(app, { title = 'Proteggi con password', preset = {}, intro } = {}) {
  const { h } = app.ui;
  const perm = { ...TUTTI_PERMESSI, ...(preset.permissions || {}) };
  const permBox = (c) => {
    const mk = (k, text) => { const i = h('input', { type: 'checkbox', checked: !!perm[k] }); return [i, h('label', {}, i, text)]; };
    const stampa = h('select', { class: 'input', 'aria-label': 'Stampa' },
      h('option', { value: 'high', selected: perm.stampa === 'high' }, 'Consentita'),
      h('option', { value: 'low', selected: perm.stampa === 'low' }, 'Solo a bassa risoluzione'),
      h('option', { value: 'none', selected: perm.stampa === 'none' }, 'Non consentita'));
    const [cCopia, lCopia] = mk('copia', 'Copiare testo e immagini');
    const [cMod, lMod] = mk('modifica', 'Modificare il contenuto');
    const [cCom, lCom] = mk('commenti', 'Aggiungere commenti');
    const [cMod2, lMod2] = mk('moduli', 'Compilare i moduli e firmare');
    const [cAss, lAss] = mk('assemblaggio', 'Inserire, ruotare, eliminare pagine');
    c.append(h('div', { class: 'lg-row' }, h('span', {}, 'Stampa:'), stampa), h('div', { class: 'lg-grid2' }, lCopia, lMod, lCom, lMod2, lAss));
    return { get: () => ({ stampa: stampa.value, copia: cCopia.checked, modifica: cMod.checked, commenti: cCom.checked, moduli: cMod2.checked, assemblaggio: cAss.checked }) };
  };
  const v = await app.ui.dialog({
    title, width: 520, okLabel: 'Proteggi',
    body: intro ? boxAvviso(app, intro, 'info') : null,
    fields: [
      { type: 'checkbox', name: 'useOpen', label: 'Chiedi una password per aprire il documento', value: preset.useOpen ?? true },
      passwordPair(app, 'Password di apertura', 'Senza questa password il documento non si apre. Leggio non può recuperarla se la dimentichi.'),
      { type: 'checkbox', name: 'useRestr', label: 'Limita stampa, copia e modifica (password per le autorizzazioni)', value: preset.useRestr ?? false },
      { type: 'custom', name: 'perm', label: 'Cosa è consentito a chi apre il documento', render: permBox },
      { type: 'password', name: 'owner', label: 'Password per le autorizzazioni (facoltativa)', help: 'Serve per togliere le limitazioni. Se la lasci vuota, Leggio ne crea una casuale: le limitazioni non si potranno più togliere con questa password.' },
      { type: 'select', name: 'algorithm', label: 'Compatibilità', value: 'AES-256', options: ALGORITMI },
      { type: 'info', text: 'Nota: le limitazioni di stampa e copia sono rispettate da Acrobat, Anteprima e dai lettori seri, ma alcuni programmi le ignorano. Per dati riservati usa sempre la password di apertura.' },
    ],
    onOpen(form) {
      const f = [...form.querySelectorAll('.dlg-body > .field')];
      const [useOpen, pwBox, useRestr, permBox, ownerBox, algBox] = f;
      const more = h('button', { type: 'button', class: 'btn small', style: { marginBottom: '10px' }, onclick: () => { algBox.hidden = !algBox.hidden; } }, 'Compatibilità con programmi molto vecchi…');
      algBox.before(more);
      const sync = () => {
        pwBox.hidden = !useOpen.querySelector('input').checked;
        permBox.hidden = ownerBox.hidden = !useRestr.querySelector('input').checked;
      };
      algBox.hidden = true;
      useOpen.addEventListener('change', sync); useRestr.addEventListener('change', sync); sync();
    },
    validate(x) {
      const pw = x['Password di apertura'];
      if (!x.useOpen && !x.useRestr) return 'Scegli almeno una protezione.';
      if (x.useOpen) {
        if (!pw.value) return 'Scrivi la password di apertura.';
        if (pw.value !== pw.confirm) return 'Le due password di apertura non coincidono.';
        if (pw.value.length < 4) return 'La password di apertura è troppo corta (almeno 4 caratteri, meglio 12).';
      }
      if (x.useRestr && x.owner && x.useOpen && x.owner === pw.value) return 'La password per le autorizzazioni deve essere diversa da quella di apertura.';
      if (x.useRestr && !hasRestrictions(x.perm)) return 'Hai consentito tutto: togli la spunta da almeno un permesso, oppure non limitare.';
      return null;
    },
  });
  if (!v) return null;
  return {
    userPassword: v.useOpen ? v['Password di apertura'].value : '',
    ownerPassword: v.useRestr ? v.owner : '',
    permissions: v.useRestr ? v.perm : TUTTI_PERMESSI,
    algorithm: v.algorithm,
  };
}

export async function protect(app) {
  const doc = app.activeDoc;
  const current = await app.currentBytes(doc);
  if (looksEncrypted(current) && intent.get(current) !== false) {
    const ok = await app.ui.confirm('Il documento è già protetto. Vuoi sostituire la protezione attuale con una nuova?', { title: 'Documento già protetto', okLabel: 'Sostituisci' });
    if (!ok) return;
  }
  const opts = await askProtection(app);
  if (!opts) return;
  const mode = await app.ui.dialog({
    title: 'Dove applicare la protezione', okLabel: 'Continua',
    fields: [{ type: 'radio', name: 'm', value: 'doc', options: [
      { value: 'doc', label: 'Al documento aperto (sarà protetto quando lo salvi)' },
      { value: 'copy', label: 'Salva una copia protetta (l\'originale resta senza password)' }] }],
  });
  if (!mode) return;
  await app.ui.withProgress('Protezione in corso…', async (p) => {
    p.set(null, 'Cifratura del documento…');
    let plain = current;
    if (looksEncrypted(current)) plain = await (await openDecrypted(current, doc.password ?? '')).doc.save({ useObjectStreams: false });
    const out = await encryptBytes(plain, opts);
    const full = { ...opts, ownerPassword: out.ownerPassword };
    if (mode.m === 'copy') { await salvaCopia(app, out, copyName(doc, 'protetto')); return; }
    const prevPw = doc.password;
    const done = await app.applyEdit('Protezione con password', async () => {
      doc.password = opts.userPassword || full.ownerPassword; // per riaprire i byte cifrati
      return out;
    }).catch((e) => { doc.password = prevPw; throw e; });
    if (done) {
      intent.set(doc.bytes, { opts: full });
      app.ui.toast('Protezione impostata: salva il documento per renderla definitiva sul file.', { kind: 'success', timeout: 6000 });
    }
  }, { cancellable: false });
}

export async function unprotect(app) {
  const doc = app.activeDoc;
  const bytes = await app.currentBytes(doc);
  let probe;
  try { probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { throw new Error('Il documento non è leggibile: ' + e.message); }
  const info = encryptionInfo(probe);
  if (!info) { app.ui.toast('Questo documento non è protetto: non c\'è niente da togliere.', { kind: 'info' }); return; }
  const perms = fromPValue(info.P);
  const restr = hasRestrictions(perms);
  const v = await app.ui.dialog({
    title: 'Rimuovi protezione', okLabel: 'Rimuovi protezione', width: 500,
    body: boxAvviso(app, `Protezione attuale: ${info.algorithm}. ${restr ? 'Limitazioni: ' + describePermissions(perms).filter((x) => x.includes('non') || x.includes('bassa')).join(', ') + '.' : 'Nessuna limitazione oltre alla password di apertura.'}`, 'info'),
    fields: [
      { type: 'password', name: 'pw', label: restr ? 'Password per le autorizzazioni (del proprietario)' : 'Password del documento', value: restr ? '' : (doc.password || ''), help: restr ? 'Per togliere le limitazioni serve la password del proprietario: chi l\'ha impostata ha deciso che il documento non si può stampare o modificare liberamente.' : 'È la password che usi per aprirlo.' },
      { type: 'radio', name: 'm', value: 'copy', options: [
        { value: 'copy', label: 'Salva una copia senza protezione (consigliato)' },
        { value: 'doc', label: 'Togli la protezione dal documento aperto (si può annullare)' }] },
    ],
    validate: (x) => (x.pw ? null : 'Scrivi la password.'),
  });
  if (!v) return;
  // verifica della password con pdf.js: distingue utente e proprietario
  const { pdfjs } = app.lib;
  let isOwner = false;
  try {
    const t = pdfjs.getDocument({ data: bytes.slice(), password: v.pw, isEvalSupported: false });
    await t.promise; await t.destroy();
  } catch { throw new Error('Password errata. Controlla maiuscole, minuscole e il tasto Bloc Maiusc, poi riprova.'); }
  if (restr) isOwner = await checkOwnerPassword(bytes, v.pw);
  if (restr && !isOwner) throw new Error('Questa è la password di apertura, non quella del proprietario: con essa il documento si legge ma le limitazioni non si possono togliere. Chiedi la password per le autorizzazioni a chi ti ha mandato il file.');
  let plain;
  try { plain = await (await openDecrypted(bytes, v.pw)).doc.save({ useObjectStreams: true }); }
  catch (e) { if (e instanceof PasswordError) throw new Error('Password errata.'); throw e; }
  if (v.m === 'copy') { await salvaCopia(app, plain, copyName(doc, 'senza_protezione')); return; }
  const ok = await app.applyEdit('Protezione rimossa', async () => plain);
  if (ok) { intent.set(doc.bytes, false); app.ui.toast('Protezione rimossa: salva per scrivere il file senza password.', { kind: 'success' }); }
}

/** La password è quella del proprietario (autorizzazioni)? Verifica con le voci /O e /U. */
async function checkOwnerPassword(bytes, pw) {
  const { checkOwner } = await import('./logica/proprietario.js');
  return checkOwner(bytes, pw);
}

/** Save hook: se il documento doveva restare protetto ma le modifiche hanno tolto la cifratura, la rimette. */
export function installSaveHook(app) {
  const bus = app.bus;
  bus.on('document:loaded', ({ doc }) => {
    st(doc).lastBytes = doc.bytes;
    if (looksEncrypted(doc.bytes)) {
      intent.set(doc.bytes, { orig: true });
      // informazioni sulla cifratura originale (in background, non blocca l'apertura)
      PDFDocument.load(doc.bytes, { ignoreEncryption: true, updateMetadata: false })
        .then((d) => { st(doc).origEnc = encryptionInfo(d); })
        .catch(() => {});
    }
  });
  bus.on('document:changed', ({ doc, label }) => {
    const s = st(doc);
    if (label !== 'undo' && label !== 'redo' && !intent.has(doc.bytes)) {
      const prev = s.lastBytes && intent.get(s.lastBytes);
      if (prev) intent.set(doc.bytes, prev);
    }
    s.lastBytes = doc.bytes;
  });
  app.registerSaveHook(async (bytes, doc) => {
    const s = st(doc);
    const it = intent.get(bytes) ?? intent.get(doc.bytes) ?? (s.lastBytes && intent.get(s.lastBytes));
    if (!it || looksEncrypted(bytes)) return bytes;
    let opts = it.opts;
    if (!opts && it.orig) {
      if (s.reprotect === false) return bytes;
      opts = s.reprotect || await askReprotect(app, doc, s.origEnc);
      s.reprotect = opts || false;
      if (!opts) return bytes;
    }
    try {
      const out = await encryptBytes(bytes, opts);
      // il nucleo verifica il file da salvare con doc.password: deve aprire il risultato
      doc.password = opts.userPassword || out.ownerPassword;
      return out;
    }
    catch (e) { app.reportError(e, 'Non è stato possibile proteggere di nuovo il documento'); return bytes; }
  });
}

async function askReprotect(app, doc, info) {
  const perms = info ? fromPValue(info.P) : TUTTI_PERMESSI;
  const restr = hasRestrictions(perms);
  const v = await app.ui.dialog({
    title: 'Il documento era protetto', okLabel: 'Salva protetto', cancelLabel: 'Salva senza protezione', width: 520,
    message: `«${doc.name}» era protetto da password. Le modifiche fatte richiedono di riscrivere il file: vuoi che resti protetto?`,
    fields: [
      { type: 'password', name: 'user', label: 'Password di apertura', value: doc.password || '', help: doc.password ? 'È quella con cui hai aperto il documento. Puoi cambiarla.' : 'Il documento si apriva senza password: lascia vuoto per mantenerlo così.' },
      restr ? { type: 'info', text: `Le limitazioni restano uguali all'originale: ${describePermissions(perms).join(', ')}.` } : null,
      restr ? { type: 'password', name: 'owner', label: 'Password per le autorizzazioni', help: 'Leggio non conosce quella originale: scrivine una nuova (se la lasci vuota ne viene creata una casuale).' } : null,
    ].filter(Boolean),
    validate: (x) => (!x.user && !restr ? 'Scrivi una password di apertura, oppure scegli «Salva senza protezione».' : null),
  });
  if (!v) return null;
  return { userPassword: v.user || '', ownerPassword: v.owner || '', permissions: perms, algorithm: info?.algorithm === 'AES-128' ? 'AES-128' : 'AES-256' };
}

/** Per i servizi: protegge byte arbitrari. */
export async function protectBytes(bytes, opts, password) {
  let plain = bytes;
  if (looksEncrypted(bytes)) plain = await (await openDecrypted(bytes, password ?? '')).doc.save({ useObjectStreams: false });
  return encryptBytes(plain, opts);
}
export async function unprotectBytes(bytes, password) {
  return (await openDecrypted(bytes, password ?? '')).doc.save({ useObjectStreams: true });
}
