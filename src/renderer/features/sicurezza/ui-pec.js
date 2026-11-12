// «Prepara per PEC»: più file da spedire; li comprime quanto basta per stare sotto il limite del messaggio
// e, se non basta, propone come dividerli in più invii.
import { SCALA } from './logica/comprimi.js';
import { payloadLimit, planSends, BASE64_OVERHEAD } from './logica/pec.js';
import { compressBytes } from './ui-comprimi.js';
import { signatureCount, boxAvviso, baseName } from './comune.js';

const MIN_LEGIBLE = 110;
const fmt = (n) => (n < 1e6 ? Math.max(1, Math.round(n / 1000)) + ' KB' : (n / 1e6).toFixed(1).replace('.', ',') + ' MB');
const isPdf = (f) => /\.pdf$/i.test(f.name) || (f.bytes[0] === 0x25 && f.bytes[1] === 0x50 && f.bytes[2] === 0x44 && f.bytes[3] === 0x46);

/** Soglia PEC unica dell'app (MB del messaggio), dalle Impostazioni. */
export function sogliaPec(app) { const v = Number(app.settings.get('sic.pec.limitMB', 30)); return v > 0 ? v : 30; }

export function pecSettings(app) {
  app.bus.on('settings:fields', (arr) => arr.push({ key: 'sic.pec.limitMB', field: {
    label: 'Limite di un messaggio PEC (MB)', type: 'number', value: 30, min: 1, step: 'any',
    help: 'Dipende dal gestore PEC del tuo ente: verificalo. Gli allegati in posta pesano circa un terzo in più del file (codifica base64): «Prepara per PEC» ne tiene conto.',
  } }));
}

/**
 * Logica senza interfaccia. files: [{ name, bytes }]. → { limit, items:[{ name, before, bytes, size, compressed, note }], sends, tooBig, step }
 * opts: { limitMB, legible, signal, onProgress, codec }
 */
export async function preparaPec(files, { limitMB = 30, legible = true, signal, onProgress, codec } = {}) {
  const limit = payloadLimit(limitMB);
  const base = files.map((f) => ({ name: f.name, before: f.bytes.length, bytes: f.bytes, size: f.bytes.length, compressible: isPdf(f) && !signatureCount(f.bytes), signed: isPdf(f) && signatureCount(f.bytes) > 0, pdf: isPdf(f) }));
  const total0 = base.reduce((s, x) => s + x.size, 0);
  const plan = (items) => planSends(items.map((x) => x.size), limit);
  if (total0 <= limit) return { limit, items: base, ...plan(base), step: null };
  const steps = SCALA.filter((s) => !legible || s.dpi >= MIN_LEGIBLE);
  const cache = new Map();
  let n = 0;
  const attempt = async (i) => {
    if (cache.has(i)) return cache.get(i);
    const out = [];
    for (const [k, x] of base.entries()) {
      if (signal?.aborted) throw new DOMException('Annullato', 'AbortError');
      onProgress?.(((n * base.length) + k) / (base.length * 4), `Tentativo ${n + 1}: ${x.name}`);
      if (!x.compressible) { out.push({ ...x }); continue; }
      try {
        const r = await compressBytes(x.bytes, { ...steps[i], signal, codec });
        out.push(r.size < x.size ? { ...x, bytes: r.bytes, size: r.size, compressed: true, dpi: steps[i].dpi } : { ...x });
      } catch (e) { if (e?.name === 'AbortError') throw e; out.push({ ...x, note: 'non comprimibile: ' + (e?.message || e) }); }
    }
    n++;
    const res = { items: out, total: out.reduce((s, x) => s + x.size, 0), sends: plan(out) };
    cache.clear(); cache.set(i, res); // memoria: si tiene solo l'ultimo tentativo
    return res;
  };
  const count = (r) => r.sends.sends.length + r.sends.tooBig.length;
  // 1) il gradino più forte dice il minimo numero di invii possibile
  let hi = steps.length - 1;
  const strongest = await attempt(hi);
  let best = { i: hi, r: strongest };
  const target = count(strongest);
  // 2) la qualità migliore che ottiene lo stesso numero di invii (ricerca binaria, al massimo ~3 tentativi)
  let lo = -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const r = await attempt(mid);
    if (count(r) <= target && r.sends.tooBig.length <= strongest.sends.tooBig.length) { hi = mid; best = { i: mid, r }; } else lo = mid;
  }
  if (best.i !== hi) best = { i: hi, r: await attempt(hi) };
  return { limit, items: best.r.items, ...best.r.sends, step: steps[best.i] };
}

export async function pecTool(app) {
  const { h } = app.ui;
  // si parte dal documento attivo; gli altri documenti aperti si aggiungono solo se scelti
  const files = app.activeDoc ? [{ name: app.activeDoc.name, bytes: await app.currentBytes(app.activeDoc), on: true, doc: app.activeDoc }] : [];
  const list = h('ul', { class: 'lg-att' });
  const render = () => {
    list.innerHTML = '';
    if (!files.length) list.append(h('li', { class: 'muted' }, 'Nessun file: aggiungi i documenti da spedire.'));
    for (const f of files) {
      const cb = h('input', { type: 'checkbox', checked: f.on, onchange: () => { f.on = cb.checked; } });
      list.append(h('li', {}, h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, cb, h('span', { class: 'nm' }, f.name), h('span', { class: 'meta', style: { marginLeft: 'auto' } }, fmt(f.bytes.length)))));
    }
  };
  render();
  const limitMB = sogliaPec(app);
  const v = await app.ui.dialog({
    title: 'Prepara per PEC', okLabel: 'Prepara', width: 560,
    body: h('div', {},
      h('p', {}, 'Scegli i file da allegare. Leggio li riduce quanto basta per stare in un messaggio e, se non basta, ti dice come dividerli in più invii. Gli originali non vengono toccati.'),
      list,
      h('div', { class: 'lg-row' }, app.docs.length > 1 ? h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const others = app.docs.filter((d) => !files.some((f) => f.doc === d));
        if (!others.length) return app.ui.toast('Tutti i documenti aperti sono già nell\'elenco.');
        const sel = await app.ui.dialog({ title: 'Aggiungi documenti aperti', okLabel: 'Aggiungi', fields: others.map((d, k) => ({ type: 'checkbox', name: 'd' + k, label: d.name, value: false })) });
        if (!sel) return;
        for (const [k, d] of others.entries()) if (sel['d' + k]) files.push({ name: d.name, bytes: await app.currentBytes(d), on: true, doc: d });
        render();
      } }, 'Aggiungi documenti aperti…') : null, h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const add = await app.platform.openFiles({ multiple: true, filters: [{ name: 'Tutti i file', extensions: ['*'] }], title: 'Scegli i file da allegare' });
        for (const f of add || []) files.push({ name: f.name, bytes: f.bytes, on: true });
        render();
      } }, 'Aggiungi file…'))),
    fields: [
      { type: 'number', name: 'limit', label: 'Limite di un messaggio (MB)', value: limitMB, min: 1, step: 'any', help: `È la soglia unica di Leggio (si cambia anche nelle Impostazioni). Dipende dal gestore PEC: verificalo. In posta gli allegati pesano circa un terzo in più: con ${String(limitMB).replace('.', ',')} MB di limite si possono allegare circa ${fmt(payloadLimit(limitMB))} di file.` },
      { type: 'checkbox', name: 'legible', label: 'Non scendere sotto una qualità leggibile (consigliato)', value: true },
    ],
    validate: (x) => (!files.some((f) => f.on) ? 'Scegli almeno un file.' : !(x.limit > 0) ? 'Indica il limite in MB.' : null),
  });
  if (!v) return;
  app.settings.set('sic.pec.limitMB', v.limit);
  const chosen = files.filter((f) => f.on);
  const t0 = performance.now();
  const r = await app.ui.withProgress('Preparazione per la PEC…', (p) => preparaPec(chosen, { limitMB: v.limit, legible: v.legible, signal: p.signal, onProgress: (f, t) => p.set(f, t) }));
  if (!r) return;
  const secs = ((performance.now() - t0) / 1000).toFixed(1).replace('.', ',');
  const totIn = chosen.reduce((s, f) => s + f.bytes.length, 0);
  const totOut = r.items.reduce((s, x) => s + x.size, 0);
  const one = r.sends.length === 1 && !r.tooBig.length;
  const sendBlocks = r.sends.map((idx, k) => {
    const sz = idx.reduce((s, i) => s + r.items[i].size, 0);
    return h('div', { class: 'lg-sic-avviso lg-sic-info' }, h('strong', {}, `${r.sends.length > 1 ? `Invio ${k + 1}` : 'Un solo invio'} — ${fmt(sz)} di allegati (in posta circa ${fmt(sz * BASE64_OVERHEAD)})`),
      h('ul', {}, idx.map((i) => h('li', {}, `${r.items[i].name}: ${r.items[i].compressed ? `${fmt(r.items[i].before)} → ${fmt(r.items[i].size)}` : fmt(r.items[i].size)}${r.items[i].signed ? ' (firmato: non compresso)' : ''}`))));
  });
  const lowRes = r.step && r.step.dpi < 150 && r.items.some((x) => x.compressed);
  const body = h('div', {},
    boxAvviso(app, one ? `Tutto in un solo messaggio: ${fmt(totIn)} → ${fmt(totOut)}.` : `Non ci sta in un solo messaggio nemmeno riducendo i file: servono ${r.sends.length} invii${r.tooBig.length ? ` più ${r.tooBig.length} file da dividere` : ''}.`, one ? 'ok' : 'warning'),
    ...sendBlocks,
    r.tooBig.length ? boxAvviso(app, `Troppo grandi anche da soli: ${r.tooBig.map((i) => `${r.items[i].name} (${fmt(r.items[i].size)})`).join(', ')}. Dividili in più parti con lo strumento «Dividi» (per dimensione massima) e ripeti.`, 'error') : null,
    lowRes ? boxAvviso(app, `Le immagini sono scese a ${r.step.dpi} punti per pollice: le scansioni potrebbero risultare poco leggibili. Apri un file per controllare prima di spedire.`) : null,
    h('p', { class: 'muted' }, `Tempo: ${secs} s. I file firmati digitalmente non vengono compressi per non invalidarne la firma.`));
  const ok = await app.ui.dialog({ title: 'Prepara per PEC', okLabel: 'Salva i file in una cartella…', cancelLabel: 'Chiudi', body, width: 600 });
  if (!ok) return;
  const folder = await app.platform.chooseFolder('Dove salvare i file per la PEC');
  if (!folder) return;
  let saved = 0;
  for (const [k, idx] of r.sends.entries()) for (const i of idx) {
    const it = r.items[i];
    const name = r.sends.length > 1 ? `Invio ${k + 1} - ${it.name}` : it.name;
    await app.platform.writeInFolder(folder, it.compressed ? name.replace(/\.pdf$/i, '') + '_pec.pdf' : name, it.bytes);
    saved++;
  }
  app.ui.toast(`${saved} file salvati${r.sends.length > 1 ? ` (${r.sends.length} invii, il numero è all'inizio del nome)` : ''}.`, { kind: 'success', timeout: 7000 });
  void baseName;
}
