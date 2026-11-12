// Profilo dell'ente: modifica, inserimento «con un clic» sulla pagina, compilazione dei moduli.
// Estende il profilo personale dell'area «moduli» (stesso archivio, letto e aggiornato con la sua API).
import { CAMPI_ENTE, KEY_ENTE, normalizzaEnte, validaEnte, vociInseribili, valorePerCampo, sedeCompleta } from '../lib/ente.js';
import { createStore } from '../../moduli/lib/store.js';
import { testoSicuro } from '../lib/protocollo.js';

let store = null;
const personale = () => { try { store ||= createStore(); return store.getProfile(); } catch { return {}; } };
export const getEnte = (app) => normalizzaEnte(app.settings.get(KEY_ENTE, {}));

export function setupEnte(app) {
  app.services = app.services || {};
  /** Dati dell'ente (oggetto con le chiavi di CAMPI_ENTE). */
  app.services.profiloEnte = () => getEnte(app);
  /** Profilo personale (area moduli) + ente, per chi compila moduli e timbri. */
  app.services.profiloCompleto = () => ({ personale: personale(), ente: getEnte(app) });
}

export async function modificaProfiloEnte(app) {
  const p = getEnte(app);
  const v = await app.ui.dialog({
    title: 'Profilo dell\'ente', width: 620,
    message: 'Dati dell\'istituto da inserire con un clic in moduli, timbri di protocollo e dichiarazioni. Restano solo su questo computer. I tuoi dati personali (nome, codice fiscale…) sono in «I miei dati personali».',
    fields: CAMPI_ENTE.map((f) => ({ name: f.key, label: f.label, type: f.area ? 'textarea' : 'text', rows: 3, value: p[f.key] || '', placeholder: f.esempio ? `es. ${f.esempio}` : '' })),
    okLabel: 'Salva', validate: (x) => validaEnte(normalizzaEnte(x))[0] || null,
  });
  if (!v) return null;
  const ente = normalizzaEnte(v);
  app.settings.set(KEY_ENTE, ente);
  // estende il profilo personale: se lì ente / P.IVA / PEC sono vuoti, li completa (non sovrascrive nulla)
  try {
    store ||= createStore();
    const pp = store.getProfile();
    const add = { ente: pp.ente || ente.denominazione, partitaIva: pp.partitaIva || ente.partitaIva, ufficio: pp.ufficio || ente.ufficio };
    store.setProfile({ ...pp, ...Object.fromEntries(Object.entries(add).filter(([, x]) => x)) });
  } catch {}
  app.ui.toast('Profilo dell\'ente salvato', { kind: 'success' });
  return ente;
}

async function enteOChiedi(app) {
  let e = getEnte(app);
  if (!Object.keys(e).length) { app.ui.toast('Compila prima il profilo dell\'ente.', { kind: 'info' }); e = await modificaProfiloEnte(app); }
  return e && Object.keys(e).length ? e : null;
}

/** Strumento interattivo: scegli la voce e fai clic sulla pagina dove inserirla. */
export function inserisciEnteTool(app) {
  let off = null; let voce = null;
  return {
    async activate(_app, opts) {
      const { h } = app.ui;
      const e = getEnte(app);
      const voci = vociInseribili(e);
      if (!voci.length) {
        opts.append(h('span', {}, 'Il profilo dell\'ente è vuoto.'), h('button', { class: 'btn small', onclick: async () => { await modificaProfiloEnte(app); app.tools.deactivate(); } }, 'Compila il profilo…'));
        return;
      }
      const sel = h('select', { 'aria-label': 'Dato da inserire' }, voci.map((x, i) => h('option', { value: String(i) }, x.label)));
      const size = h('select', { 'aria-label': 'Dimensione' }, ['9', '10', '11', '12', '14'].map((s) => h('option', { value: s, selected: s === '10' }, s + ' pt')));
      opts.append(h('span', {}, 'Scegli il dato e fai clic sulla pagina:'), sel, size, h('button', { class: 'btn small', onclick: () => modificaProfiloEnte(app) }, 'Modifica profilo…'));
      voce = () => ({ ...voci[+sel.value], size: +size.value });
      app.viewer.setMode('tool', 'copy');
      const onClick = async (ev) => {
        const ov = ev.target.closest('.leggio-overlay'); if (!ov) return;
        const pageIndex = +ov.dataset.pageIndex;
        const pt = app.viewer.clientToPdf(pageIndex, ev.clientX, ev.clientY); if (!pt) return;
        const v = voce();
        await app.editWithPdfLib(`Inserito: ${v.label}`, async (pdfDoc, PDFLib) => {
          const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
          const page = pdfDoc.getPage(pageIndex);
          const rot = page.getRotation().angle % 360;
          v.testo.split('\n').forEach((riga, i) => {
            const d = (i + 1) * v.size * 1.25 - v.size * 0.25;
            const [x, y] = rot === 90 ? [pt[0] + d, pt[1]] : rot === 180 ? [pt[0], pt[1] + d] : rot === 270 ? [pt[0] - d, pt[1]] : [pt[0], pt[1] - d];
            page.drawText(testoSicuro(font, riga), { x, y, size: v.size, font, color: PDFLib.rgb(0, 0, 0), rotate: PDFLib.degrees(rot) });
          });
        });
      };
      app.viewer.container.addEventListener('click', onClick);
      off = () => app.viewer.container.removeEventListener('click', onClick);
    },
    deactivate() { off?.(); off = null; },
  };
}

/** Compila i campi dei moduli con i dati dell'ente (con conferma). */
export async function compilaConEnte(app) {
  const e = await enteOChiedi(app); if (!e) return;
  const doc = app.activeDoc;
  const d = await app.lib.openPdfLib(await app.currentBytes(doc), doc.password);
  let fields = [];
  try { fields = d.getForm().getFields(); } catch { fields = []; }
  const proposte = [];
  for (const f of fields) {
    if (f.constructor?.name !== 'PDFTextField' && typeof f.setText !== 'function') continue;
    const v = valorePerCampo(f.getName(), e);
    if (v) proposte.push({ nome: f.getName(), ...v });
  }
  if (!proposte.length) {
    const r = await app.ui.dialog({ title: 'Compila con i dati dell\'ente', message: fields.length ? 'Nessun campo del modulo corrisponde ai dati dell\'ente. Puoi inserirli facendo clic sulla pagina.' : 'Questo documento non ha campi compilabili. Puoi inserire i dati dell\'ente facendo clic sulla pagina.', okLabel: 'Inserisci con un clic', cancelLabel: 'Chiudi' });
    if (r) app.tools.run('insert-entity');
    return;
  }
  const v = await app.ui.dialog({ title: 'Compila con i dati dell\'ente', width: 560, message: 'Questi campi verranno compilati. Togli la spunta a quelli da lasciare come sono.',
    fields: proposte.map((p, i) => ({ name: 'c' + i, type: 'checkbox', value: true, label: `${p.nome} → ${p.value.replace(/\n/g, ' ')}` })), okLabel: 'Compila' });
  if (!v) return;
  const scelte = proposte.filter((_, i) => v['c' + i]);
  if (!scelte.length) return;
  await app.editWithPdfLib('Compilato con i dati dell\'ente', (pdfDoc) => {
    const form = pdfDoc.getForm();
    for (const s of scelte) { try { form.getTextField(s.nome).setText(s.value); } catch {} }
  });
}

export { sedeCompleta };
