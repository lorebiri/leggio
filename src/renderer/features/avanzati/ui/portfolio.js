// Portfolio PDF (Collection): elenco dei file inclusi, apertura in schede, salvataggio.
import { looksLikeP7m } from '../lib/cades.js';
import { isFattura } from '../lib/fattura.js';

/** Cerca una sequenza ASCII nei byte (veloce, senza decodificare tutto il file). */
export function containsAscii(bytes, word, limit = bytes.length) {
  const w = [...word].map((c) => c.charCodeAt(0));
  const first = w[0]; const end = Math.min(limit, bytes.length) - w.length;
  for (let i = bytes.indexOf(first); i >= 0 && i <= end; i = bytes.indexOf(first, i + 1)) {
    let k = 1; while (k < w.length && bytes[i + k] === w[k]) k++;
    if (k === w.length) return true;
  }
  return false;
}

/** Allegati del documento (pdf.js v6: Map senza contenuto, che si legge a parte; versioni precedenti: oggetto con content). */
export async function listAttachments(pdf) {
  const att = await pdf.getAttachments().catch(() => null);
  if (!att) return [];
  const entries = att instanceof Map ? [...att.entries()] : Object.entries(att);
  return entries.map(([id, a]) => ({
    id, filename: a.filename || id, description: a.description || '',
    async getContent() { if (a.content) return a.content; return typeof pdf.getAttachmentContent === 'function' ? pdf.getAttachmentContent(id) : null; },
  }));
}

export async function isPortfolio(doc) {
  let pageMode = null;
  try { pageMode = await doc.pdf.getPageMode(); } catch {}
  const marker = containsAscii(doc.bytes, '/Collection');
  if (!marker && pageMode !== 'UseAttachments') return 0;
  const n = (await listAttachments(doc.pdf)).length;
  return marker || n ? n : 0;
}

export function setupPortfolio(app, deps) {
  app.bus.on('document:loaded', async ({ doc }) => {
    try {
      const n = await isPortfolio(doc);
      if (!n || !app.docs.includes(doc)) return;
      doc.data.portfolio = true;
      app.ui.toast(`Questo PDF è un portfolio: contiene ${n} ${n === 1 ? 'file' : 'file'}.`, { kind: 'info', timeout: 10000, action: { label: 'Mostra i file', run: () => { app.activate(doc); showPortfolio(app, deps); } } });
    } catch {}
  });
}

export async function showPortfolio(app, deps) {
  const { h } = app.ui;
  const doc = app.activeDoc;
  const entries = await listAttachments(doc.pdf);
  for (const e of entries) { try { e.content = await e.getContent(); } catch { e.content = null; } }
  const pane = deps.openPane(app, { title: 'File del portfolio', subtitle: doc.name, id: 'portfolio' });
  if (!entries.length) {
    pane.body.append(h('div', { class: 'av-narrow' }, h('p', {}, 'Questo documento non contiene file inclusi.'), h('p', { class: 'av-note' }, 'Un portfolio PDF è una raccolta di più file (PDF, Word, immagini…) dentro un unico PDF.')));
    return;
  }
  const kb = (n) => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  const pdfs = entries.filter((e) => isPdf(e.content));
  pane.actions.append(pdfs.length > 1 ? h('button', { class: 'btn primary', onclick: async () => { for (const e of pdfs) await apri(e); } }, `Apri tutti i PDF (${pdfs.length})`) : null);
  pane.body.append(h('div', { class: 'av-narrow' },
    h('ul', { class: 'av-list' }, entries.map((e) => h('li', {},
      h('div', { class: 'av-row' }, h('div', { class: 'av-grow' }, h('div', { class: 'av-list-name' }, e.filename || 'senza nome'), h('small', { class: 'av-note' }, [e.description, kb(e.content?.length || 0)].filter(Boolean).join(' — '))),
        h('button', { class: 'btn small', onclick: () => apri(e) }, isPdf(e.content) ? 'Apri in una scheda' : 'Apri'),
        h('button', { class: 'btn small', onclick: () => salva(e) }, 'Salva…')))))));

  async function apri(e) {
    const b = e.content; const name = e.filename || 'file';
    if (!b) return;
    if (isPdf(b)) { await app.openBytes(b, { name }); return; }
    if (looksLikeP7m(b)) return deps.openSignedFile(app, { bytes: b, name });
    if (isFattura(b)) return deps.openFattura(app, b, name);
    return salva(e);
  }
  async function salva(e) {
    const name = (e.filename || 'file').replace(/[\\/:*?"<>|]/g, '_');
    const ext = name.includes('.') ? name.split('.').pop() : '*';
    await app.exportFile(e.content, name, [{ name: ext.toUpperCase(), extensions: [ext] }]);
  }
}

function isPdf(b) { return !!b && containsAscii(b, '%PDF-', 1024); }
