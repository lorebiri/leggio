// «Leggi ad alta voce»: sintesi vocale del sistema (offline), dalla pagina corrente, con la frase letta evidenziata.
import { paroleInOrdine } from './lib/testo.js';
import { dividiFrasi } from './lib/frasi.js';
import { testoPagina } from './comune.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

function vociOrdinate() {
  const voci = synth?.getVoices() || [];
  const it = voci.filter((v) => /^it/i.test(v.lang));
  return [...it, ...voci.filter((v) => !/^it/i.test(v.lang))];
}

function attendiVoci() {
  return new Promise((res) => {
    if (!synth) return res([]);
    const v = synth.getVoices();
    if (v.length) return res(v);
    const t = setTimeout(() => res(synth.getVoices()), 1500);
    synth.addEventListener('voiceschanged', () => { clearTimeout(t); res(synth.getVoices()); }, { once: true });
  });
}

export function registraLettura(app) {
  const st = { attivo: false, pagina: 0, frasi: [], parole: [], idx: 0, pausa: false, gen: 0, ui: null, docId: null };

  function pulisciEvidenziazione() { document.querySelectorAll('.conv-tts-hl').forEach((e) => e.remove()); }
  function evidenzia() {
    pulisciEvidenziazione();
    if (!st.attivo || !st.frasi[st.idx]) return;
    const f = st.frasi[st.idx];
    const ov = app.viewer.getOverlay(st.pagina);
    if (!ov) return;
    // riquadri per riga
    const righe = [];
    for (let i = f.start; i < f.end; i++) {
      const w = st.parole[i]; if (!w) continue;
      const last = righe[righe.length - 1];
      if (last && Math.abs(last.y0 - w.y0) < 2 && Math.abs(last.y1 - w.y1) < 4) { last.x0 = Math.min(last.x0, w.x0); last.x1 = Math.max(last.x1, w.x1); }
      else righe.push({ ...w });
    }
    for (const r of righe) {
      const css = app.viewer.pdfRectToCss(st.pagina, [r.x0, r.y0, r.x1, r.y1]);
      ov.append(app.ui.h('div', { class: 'conv-tts-hl', style: { left: css.left - 2 + 'px', top: css.top - 1 + 'px', width: css.width + 4 + 'px', height: css.height + 2 + 'px' } }));
    }
  }

  async function caricaPagina(i) {
    const doc = app.activeDoc;
    const t = await testoPagina(doc.pdf, i, { withFonts: false });
    const page = await doc.pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    page.cleanup();
    // posizioni in punti PDF (indipendenti da zoom e rotazione della vista)
    st.parole = paroleInOrdine(t.frags).map((w) => {
      const [x0, y0] = vp.convertToPdfPoint(w.x0, w.bottom);
      const [x1, y1] = vp.convertToPdfPoint(w.x1, w.top);
      return { text: w.text, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
    });
    st.frasi = dividiFrasi(st.parole.map((w) => w.text));
    st.pagina = i; st.idx = 0;
  }

  function aggiornaUi() {
    if (!st.ui) return;
    st.ui.play.textContent = st.attivo && !st.pausa ? 'Pausa' : st.attivo ? 'Riprendi' : 'Leggi';
    st.ui.play.setAttribute('aria-pressed', String(st.attivo && !st.pausa));
    st.ui.info.textContent = st.attivo ? `Pagina ${st.pagina + 1}` : '';
  }

  function parla() {
    const gen = st.gen;
    if (!st.attivo) return;
    const f = st.frasi[st.idx];
    if (!f) return prossimaPagina(gen);
    const u = new SpeechSynthesisUtterance(f.text);
    const voce = vociOrdinate().find((v) => v.voiceURI === app.settings.get('tts.voce')) || vociOrdinate()[0];
    if (voce) { u.voice = voce; u.lang = voce.lang; } else u.lang = 'it-IT';
    u.rate = Number(app.settings.get('tts.velocita', 1)) || 1;
    u.onstart = () => { if (gen === st.gen) evidenzia(); };
    u.onend = () => { if (gen !== st.gen || !st.attivo) return; st.idx++; parla(); };
    u.onerror = (e) => { if (gen !== st.gen || e.error === 'interrupted' || e.error === 'canceled') return; app.ui.toast('La sintesi vocale si è interrotta: ' + e.error, { kind: 'warning' }); ferma(); };
    synth.speak(u);
  }

  async function prossimaPagina(gen) {
    const doc = app.activeDoc;
    let i = st.pagina + 1;
    while (doc && i < doc.pageCount) {
      await caricaPagina(i);
      if (gen !== st.gen || !st.attivo) return;
      if (st.frasi.length) { app.viewer.page = i + 1; aggiornaUi(); return parla(); }
      i++;
    }
    ferma();
    app.ui.toast('Lettura terminata');
  }

  async function avvia() {
    if (!synth) return app.ui.toast('La sintesi vocale non è disponibile su questo computer.', { kind: 'error' });
    const voci = await attendiVoci();
    if (!voci.length) return app.ui.toast('Nessuna voce installata. Su Windows: Impostazioni › Ora e lingua › Voce; su macOS: Impostazioni › Accessibilità › Contenuto letto.', { kind: 'warning', timeout: 9000 });
    st.gen++; synth.cancel();
    st.attivo = true; st.pausa = false; st.docId = app.activeDoc.id;
    await caricaPagina(app.viewer.pageIndex);
    if (!st.frasi.length) {
      const prima = st.pagina;
      await prossimaPagina(st.gen);
      if (!st.attivo && prima === app.activeDoc.pageCount - 1) app.ui.toast('In questa pagina non c’è testo da leggere. Se è una scansione, usa prima «Rendi ricercabile (OCR)».', { kind: 'warning' });
      return;
    }
    aggiornaUi(); parla();
  }
  function ferma() {
    st.gen++; st.attivo = false; st.pausa = false;
    synth?.cancel(); pulisciEvidenziazione(); aggiornaUi();
  }
  function playPausa() {
    if (!st.attivo) return avvia();
    if (st.pausa) { st.pausa = false; synth.resume(); }
    else { st.pausa = true; synth.pause(); }
    aggiornaUi();
  }
  function salta(delta) {
    if (!st.attivo) return;
    st.gen++; synth.cancel();
    st.idx = Math.max(0, Math.min(st.frasi.length - 1, st.idx + delta));
    st.pausa = false; aggiornaUi(); parla();
  }

  app.bus.on('page:rendered', ({ pageIndex }) => { if (st.attivo && pageIndex === st.pagina) evidenzia(); });
  app.bus.on('document:activated', () => { if (st.attivo && app.activeDoc?.id !== st.docId) ferma(); });
  app.bus.on('document:changed', () => { if (st.attivo) ferma(); });

  app.registerTool({
    id: 'read-aloud', name: 'Leggi ad alta voce', category: 'vista', icon: 'speaker',
    description: 'Legge il testo dalla pagina corrente',
    keywords: 'leggi ad alta voce sintesi vocale ascolta voce lettura audio parla tts',
    interactive: {
      activate(app2, opts) {
        const { h } = app.ui;
        const play = h('button', { class: 'btn small primary', onclick: playPausa }, 'Leggi');
        const stop = h('button', { class: 'btn small', onclick: ferma }, 'Ferma');
        const prev = h('button', { class: 'btn small', title: 'Frase precedente', 'aria-label': 'Frase precedente', onclick: () => salta(-1) }, '⏮');
        const next = h('button', { class: 'btn small', title: 'Frase successiva', 'aria-label': 'Frase successiva', onclick: () => salta(1) }, '⏭');
        const vel = h('select', { 'aria-label': 'Velocità', onchange: () => { app.settings.set('tts.velocita', vel.value); if (st.attivo && !st.pausa) salta(0); } },
          [['0.7', 'Lenta'], ['0.85', 'Calma'], ['1', 'Normale'], ['1.2', 'Svelta'], ['1.5', 'Veloce'], ['2', 'Molto veloce']].map(([v, l]) => h('option', { value: v, selected: String(app.settings.get('tts.velocita', 1)) === v }, l)));
        const voce = h('select', { 'aria-label': 'Voce', class: 'conv-voce', onchange: () => { app.settings.set('tts.voce', voce.value); if (st.attivo && !st.pausa) salta(0); } });
        const riempi = () => {
          voce.innerHTML = '';
          for (const v of vociOrdinate()) voce.append(h('option', { value: v.voiceURI, selected: v.voiceURI === app.settings.get('tts.voce') }, `${v.name} (${v.lang})`));
          if (!voce.options.length) voce.append(h('option', { value: '' }, 'Nessuna voce'));
        };
        riempi(); attendiVoci().then(riempi);
        const info = h('span', { class: 'conv-hint', 'aria-live': 'polite' });
        opts.append(play, stop, prev, next, h('label', { class: 'conv-inline' }, 'Velocità ', vel), h('label', { class: 'conv-inline' }, 'Voce ', voce), info);
        st.ui = { play, info };
        avvia();
      },
      deactivate() { ferma(); st.ui = null; },
    },
  });
}
