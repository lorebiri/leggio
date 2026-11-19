// Proposta discreta «Salva in rubrica» per il fornitore (cedente) e il cliente (cessionario) di una fattura
// elettronica. L'archivio si apre (e chiede la password) solo quando l'utente fa clic.
import { archivioPersonale } from '../lib/condiviso.js';
import { nomeContatto, CAMPI_CONTATTO } from '../lib/campi.js';
import { contattoDaFattura, trovaEsistente, completaContatto, salvaDaFattura } from '../lib/rubrica.js';

const etichetta = (k) => CAMPI_CONTATTO.find((c) => c.key === k)?.label || k;

/** Riquadro «Rubrica» per il riepilogo della fattura. f: risultato di parseFattura. → elemento | null */
export function propostaRubrica(app, f) {
  const archivio = archivioPersonale();
  if (!archivio || !f) return null;
  const parti = [['cedente', 'Fornitore'], ['cessionario', 'Cliente']]
    .map(([ruolo, titolo]) => ({ ruolo, titolo, contatto: contattoDaFattura(f[ruolo], ruolo, f) }))
    .filter((p) => p.contatto);
  if (!parti.length) return null;
  const { h } = app.ui;
  const box = h('div', { class: 'av-box rub-fattura' }, h('h3', {}, 'Rubrica'));

  const riga = (p) => {
    const el = h('div', { class: 'rub-fattura-riga' });
    const disegna = (stato = null) => {
      const esistente = archivio.aperto ? trovaEsistente(archivio, p.contatto) : null;
      const mancanti = esistente ? completaContatto(esistente, p.contatto) : null;
      const testo = h('div', { class: 'rub-fattura-chi' }, h('span', { class: 'rub-nota' }, p.titolo), h('strong', {}, nomeContatto(p.contatto)));
      const azioni = h('div', { class: 'av-row' });
      if (stato) azioni.append(h('span', { class: 'badge ok' }, stato));
      else if (esistente) {
        azioni.append(h('span', { class: 'badge accent', title: `In rubrica come «${nomeContatto(esistente)}»` }, 'Già in rubrica'));
        if (mancanti.campi.length) {
          azioni.append(h('button', { class: 'btn small', title: 'Mancano: ' + mancanti.campi.map(etichetta).join(', '), onclick: () => salva(true) }, 'Aggiorna i dati mancanti'));
        }
      } else azioni.append(h('button', { class: 'btn small', onclick: () => salva(false) }, 'Salva in rubrica'));
      el.replaceChildren(testo, azioni);
    };
    const salva = async (aggiorna) => {
      try {
        if (!(await archivio.apri())) return;
        const r = salvaDaFattura(archivio, p.contatto, { aggiorna: true });
        const nome = nomeContatto(r.contatto);
        const msg = r.stato === 'aggiunto' ? `«${nome}» aggiunto alla rubrica (gruppo «${p.contatto.gruppi[0]}»).`
          : r.stato === 'aggiornato' ? `«${nome}» era già in rubrica: completati ${r.campi.map(etichetta).join(', ')}.`
            : `«${nome}» era già in rubrica, con tutti i dati.`;
        app.ui.toast(msg, { kind: 'success', timeout: 7000, action: app.tools?.get?.('rubrica') ? { label: 'Apri la rubrica', run: () => app.tools.run('rubrica') } : undefined });
        disegna(r.stato === 'aggiunto' ? 'Aggiunto alla rubrica' : r.stato === 'aggiornato' ? 'Dati aggiornati' : (aggiorna ? 'Già completo' : 'Già in rubrica'));
      } catch (err) { app.reportError(err, 'Salvataggio in rubrica non riuscito'); }
    };
    disegna();
    return el;
  };
  box.append(...parti.map(riga));
  return box;
}
