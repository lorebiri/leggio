// Assistente IA: finestra «Assistente IA» (attivazione, requisiti, download o importazione, rimozione).
import { chiama, suAvanzamento } from '../servizio.js';
import { valuta, servono, mancanti, spazioSufficiente, formatoGB, AVVERTENZA_PRIMA_VOLTA, NOMI_COMPONENTI } from '../lib/requisiti.js';

const ORDINE = ['motore', 'principale', 'leggero', 'embedding'];

export async function apriConfigura(app, { motivo = '' } = {}) {
  const { h } = app.ui;
  const corpo = h('div', { class: 'ia-conf' });
  let stato = null;
  let progresso = null; // { componente, fase, fatti, totale }
  let errore = '';

  const s = app.settings;
  const modelloScelto = () => s.get('ia.modello', '') || valuta(stato).consigliato;

  const disegna = () => {
    if (!stato) { corpo.replaceChildren(h('p', {}, 'Controllo del computer…')); return; }
    const v = valuta(stato);
    const attivo = !!s.get('ia.attivo', false);
    const scelto = modelloScelto();
    const serve = [...new Set([...servono('domande', scelto), ...servono('archivio')])];
    const manca = mancanti(stato, serve);
    const scaricando = !!stato.download || !!(progresso && !['fatto', 'finito', 'errore', 'annullato'].includes(progresso.fase));

    const righePc = h('ul', { class: 'ia-pc' },
      h('li', {}, `Processore: ${stato.cpu.modello || 'sconosciuto'}${stato.cpu.avx2 === true ? ' (AVX2: sì)' : stato.cpu.avx2 === false ? ' (AVX2: NO)' : ''}`),
      h('li', {}, `Memoria (RAM): ${formatoGB(stato.ram.totale)}, libera ora ${formatoGB(stato.ram.libera)}`),
      stato.discoLibero ? h('li', {}, `Spazio libero sul disco: ${formatoGB(stato.discoLibero)}`) : null);

    const modelli = h('div', { class: 'ia-modelli', role: 'radiogroup', 'aria-label': 'Modello per le risposte' },
      ...['principale', 'leggero'].map((k) => {
        const m = stato.modelli[k];
        return h('label', { class: 'radio ia-modello' },
          h('input', { type: 'radio', name: 'ia-modello', value: k, checked: scelto === k, onchange: () => { s.set('ia.modello', k); disegna(); } }),
          h('span', {}, h('strong', {}, `${m.nome}${v.consigliato === k ? ' (consigliato per questo PC)' : ''}`),
            h('br'), `${m.descrizione} File ${formatoGB(m.byte)}, usa fino a ${String(m.ram).replace('.', ',')} GB di RAM. Licenza ${m.licenza} (${m.autore}).`));
      }));

    const comp = h('table', { class: 'ia-comp' },
      ...ORDINE.filter((c) => serve.includes(c) || (c === 'leggero' && stato.modelli.leggero.installato) || (c === 'principale' && stato.modelli.principale.installato)).map((c) => {
        const info = c === 'motore' ? stato.motore : stato.modelli[c];
        const p = progresso?.componente === c ? progresso : null;
        let st = info.installato ? '✓ installato' : `da scaricare (${formatoGB(info.byte)})`;
        if (p?.fase === 'scarico' && p.totale) st = `scarico… ${Math.floor((p.fatti / p.totale) * 100)}%`;
        if (p?.fase === 'installo') st = 'installo…';
        return h('tr', {},
          h('th', {}, NOMI_COMPONENTI[c]),
          h('td', {}, c === 'motore' ? `${info.nome} (licenza ${info.licenza})` : info.nome),
          h('td', { class: info.installato ? 'ia-ok' : '' }, st),
          h('td', {}, info.installato || scaricando ? null : h('button', { type: 'button', class: 'btn small', title: 'Usa un file già scaricato (chiavetta, cartella di rete): viene controllata l\'impronta SHA-256', onclick: () => importa(c) }, 'Importa da file…')));
      }));

    const barra = scaricando && progresso?.totale ? h('div', { class: 'ia-barra' }, h('div', { style: { width: Math.floor((progresso.fatti / progresso.totale) * 100) + '%' } })) : null;

    const azioni = h('div', { class: 'ia-azioni' });
    if (!v.adatto) azioni.append(h('p', { class: 'ia-blocco' }, v.bloccante));
    else if (scaricando) azioni.append(h('button', { type: 'button', class: 'btn', onclick: () => chiama(app, 'annulla-download').catch(() => {}) }, 'Interrompi il download'));
    else if (manca.componenti.length) {
      const spazio = spazioSufficiente(stato, manca.byte);
      azioni.append(h('button', { type: 'button', class: 'btn primary', disabled: !spazio, onclick: () => scarica(manca.componenti) }, `Scarica e installa (${formatoGB(manca.byte)})`));
      if (!spazio) azioni.append(h('p', { class: 'ia-blocco' }, 'Non c\'è abbastanza spazio sul disco.'));
      azioni.append(h('p', { class: 'help' }, 'Fonti fisse (GitHub e Hugging Face), ogni file è controllato con la sua impronta SHA-256. Se la rete dell\'ufficio blocca il download, usa «Importa da file…».'));
    } else {
      azioni.append(h('label', { class: 'checkbox ia-attiva' },
        h('input', { type: 'checkbox', checked: attivo, onchange: (e) => { s.set('ia.attivo', e.target.checked); app.bus.emit('ia:cambiato'); disegna(); } }),
        h('span', {}, 'Assistente IA attivo')));
    }

    const installati = ORDINE.reduce((t, c) => t + ((c === 'motore' ? stato.motore : stato.modelli[c])?.installato ? (c === 'motore' ? stato.motore : stato.modelli[c]).byte : 0), 0);
    const rimuovi = installati && !scaricando ? h('button', { type: 'button', class: 'btn danger small', onclick: rimuoviTutto }, `Rimuovi l'assistente dal PC (libera circa ${formatoGB(installati)})`) : null;

    corpo.replaceChildren(
      motivo ? h('p', { class: 'ia-motivo' }, motivo) : null,
      h('p', { class: 'ia-avviso' }, AVVERTENZA_PRIMA_VOLTA),
      h('h3', {}, 'Questo computer'), righePc,
      ...v.avvisi.map((a) => h('p', { class: 'ia-attenzione' }, a)),
      h('h3', {}, 'Modello per le risposte'), modelli,
      h('h3', {}, 'Componenti'), comp, barra, errore ? h('p', { class: 'ia-blocco', role: 'alert' }, errore) : null,
      azioni, rimuovi);
  };

  const aggiorna = async () => {
    try { stato = await chiama(app, 'stato', { controllaCpu: true }); } catch (e) { errore = e.message; }
    disegna();
  };

  const off = suAvanzamento(app, (d) => {
    progresso = d;
    if (d.fase === 'errore' || d.fase === 'annullato') errore = d.errore || 'Download non riuscito.';
    if (['fatto', 'finito', 'errore', 'annullato'].includes(d.fase)) aggiorna(); else disegna();
    if (d.fase === 'finito' && !s.get('ia.attivo', false)) { s.set('ia.attivo', true); app.bus.emit('ia:cambiato'); app.ui.toast('Assistente IA pronto: apri un PDF e usa «Chiedi al documento».', { kind: 'success' }); }
  });

  async function scarica(componenti) {
    errore = '';
    try { await chiama(app, 'scarica', { componenti }); progresso = { fase: 'inizio' }; disegna(); } catch (e) { errore = e.message; disegna(); }
  }
  async function importa(c) {
    errore = '';
    try { const ok = await chiama(app, 'importa', { componente: c }); if (ok) app.ui.toast(`${NOMI_COMPONENTI[c]}: file controllato e installato.`, { kind: 'success' }); } catch (e) { errore = e.message; }
    aggiorna();
  }
  async function rimuoviTutto() {
    const ok = await app.ui.confirm('Vengono cancellati motore, modelli e indice della ricerca per significato. I tuoi documenti non vengono toccati. Potrai riscaricarli quando vuoi.', { title: 'Rimuovere l\'assistente IA?', okLabel: 'Rimuovi', danger: true });
    if (!ok) return;
    try { await chiama(app, 'rimuovi', { componente: 'tutto' }); s.set('ia.attivo', false); app.bus.emit('ia:cambiato'); } catch (e) { errore = e.message; }
    aggiorna();
  }

  disegna();
  aggiorna();
  try {
    await app.ui.dialog({ title: 'Assistente IA (sul tuo computer)', width: 640, body: corpo, okLabel: 'Chiudi', cancelLabel: null });
  } finally { off(); }
}
