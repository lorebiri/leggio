// Lista virtualizzata: nel DOM ci sono solo le righe visibili (più un margine), così restano
// fluide anche 10.000 righe. L'altezza della riga si misura dal CSS (cambia con i caratteri grandi).

export function listaVirtuale({ h, render, altezzaMinima = 72, margine = 6, onVisibili, etichetta = 'Documenti' }) {
  const spazio = h('div', { class: 'ar-vl-spazio' });
  const strato = h('div', { class: 'ar-vl-strato', role: 'list', 'aria-label': etichetta });
  const el = h('div', { class: 'ar-vl', tabindex: '-1' }, spazio, strato);
  let righe = [];
  let alt = 0;
  let pending = false;
  let ultimo = '';

  function misura() {
    if (!el.isConnected) return altezzaMinima;
    const probe = render(righe[0] || null, 0, true);
    probe.style.visibility = 'hidden';
    strato.append(probe);
    const a = probe.offsetHeight || altezzaMinima;
    probe.remove();
    return Math.max(24, a);
  }

  function disegna(forza = false) {
    pending = false;
    if (!el.isConnected) return;
    if (!alt || forza) alt = misura();
    spazio.style.height = righe.length * alt + 'px';
    const top = el.scrollTop; const vista = el.clientHeight || 600;
    const da = Math.max(0, Math.floor(top / alt) - margine);
    const a = Math.min(righe.length, Math.ceil((top + vista) / alt) + margine);
    const chiave = `${da}:${a}:${alt}:${righe.length}`;
    if (!forza && chiave === ultimo) return;
    ultimo = chiave;
    const frag = document.createDocumentFragment();
    for (let i = da; i < a; i++) {
      const r = render(righe[i], i, false);
      r.style.top = i * alt + 'px'; r.style.height = alt + 'px';
      frag.append(r);
    }
    strato.replaceChildren(frag);
    onVisibili?.(righe.slice(Math.floor(top / alt), Math.min(righe.length, Math.ceil((top + vista) / alt) + 1)), da, a);
  }
  const pianifica = () => { if (!pending) { pending = true; requestAnimationFrame(() => disegna()); } };
  el.addEventListener('scroll', pianifica, { passive: true });
  const ro = new ResizeObserver(() => { alt = 0; ultimo = ''; pianifica(); });
  ro.observe(el);

  return {
    el,
    imposta(nuove, { inCima = true } = {}) { righe = nuove; if (inCima) el.scrollTop = 0; ultimo = ''; disegna(); },
    ridisegna() { ultimo = ''; disegna(true); },
    get righe() { return righe; },
    vaiA(i) { el.scrollTop = Math.max(0, i * (alt || altezzaMinima) - 20); pianifica(); },
    distruggi() { ro.disconnect(); },
  };
}
