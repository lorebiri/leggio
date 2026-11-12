// «Dividi PDF»: in più file per numero di pagine, intervalli, pagine bianche, segnalibri o dimensione massima.
import { PDFDocument } from '@cantoo/pdf-lib';
import * as D from '../logica/dividi.js';
import { senzaEstensione, nomeFileSicuro } from '../logica/util.js';
import { trovaPagineBianche, mostraErrore } from './comune.js';
import { apriVeloce } from '../logica/struttura.js';

export async function apriDividi(app) {
  const doc = app.activeDoc; const n = doc.pageCount;
  const ultimo = app.settings.get('pagine.dividi', { modo: 'ogni', ogni: 1, mb: 5 });
  const v = await app.ui.dialog({ title: 'Dividi PDF', message: `«${doc.name}» ha ${n} pagine. Ogni parte diventa un file separato; l'originale non cambia.`, width: 520, fields: [
    { name: 'modo', label: 'Come dividere', type: 'radio', value: ultimo.modo, options: [
      { value: 'ogni', label: 'Ogni N pagine' },
      { value: 'intervalli', label: 'Per intervalli scritti da me' },
      { value: 'bianche', label: 'A ogni pagina bianca (fogli separatori)' },
      { value: 'segnalibri', label: 'Per segnalibri principali (un file per capitolo)' },
      { value: 'dimensione', label: 'Per dimensione massima del file (allegati PEC, portali)' },
    ] },
    { name: 'ogni', label: 'Pagine per file (per «Ogni N pagine»)', type: 'number', min: 1, max: n, step: 1, value: Math.min(ultimo.ogni || 1, n) },
    { name: 'intervalli', label: 'Intervalli (per «Intervalli»): ogni gruppo separato da virgola diventa un file', type: 'text', value: '', placeholder: `es. 1-3, 4-10, 11-${n}` },
    { name: 'mb', label: 'Dimensione massima in MB (per «Dimensione»)', type: 'select', value: String(ultimo.mb || 5), options: [...D.PRESET_DIMENSIONE.map(([m, l]) => ({ value: String(m), label: l })), { value: '2', label: '2 MB' }, { value: '1', label: '1 MB' }, { value: '30', label: '30 MB' }, { value: '50', label: '50 MB' }],
      help: 'Il limite reale della PEC dipende dal tuo gestore: verifica con il tuo ufficio. Gli allegati pesano circa un terzo in più quando vengono spediti.' },
    { name: 'nome', label: 'Nome dei file', type: 'text', value: senzaEstensione(doc.name), help: 'Verranno chiamati nome_01.pdf, nome_02.pdf… (con «Segnalibri» si aggiunge il titolo)' },
  ], okLabel: 'Scegli la cartella e dividi', validate: (x) => {
    if (x.modo === 'ogni' && !(Number.isInteger(x.ogni) && x.ogni >= 1)) return 'Scrivi quante pagine per file (da 1 in su).';
    if (x.modo === 'ogni' && x.ogni >= n) return `Con ${x.ogni} pagine per file otterresti un solo file: scegli un numero più piccolo di ${n}.`;
    if (x.modo === 'intervalli') { try { D.pianoIntervalli(n, x.intervalli); } catch (e) { return e.message; } }
    if (!nomeFileSicuro(x.nome, '').trim()) return 'Scrivi un nome per i file.';
    return null;
  } });
  if (!v) return;
  app.settings.set('pagine.dividi', { modo: v.modo, ogni: v.ogni, mb: +v.mb });
  const base = nomeFileSicuro(v.nome);
  try {
    let parti;
    if (v.modo === 'ogni') parti = D.pianoOgni(n, v.ogni).map((indici) => ({ indici }));
    else if (v.modo === 'intervalli') parti = D.pianoIntervalli(n, v.intervalli).map((indici) => ({ indici }));
    else if (v.modo === 'bianche') {
      const bianche = await trovaPagineBianche(app, doc.pdf, [...Array(n).keys()]);
      if (!bianche) return;
      if (!bianche.length) return app.ui.dialog({ title: 'Dividi PDF', message: 'Non ho trovato pagine bianche da usare come separatori.', cancelLabel: null, okLabel: 'Chiudi' });
      parti = D.pianoSeparatori(n, bianche).map((indici) => ({ indici }));
      const ok = await app.ui.confirm(`Ho trovato ${bianche.length} pagine bianche: otterrai ${parti.length} file (le pagine bianche vengono tolte).`, { title: 'Dividi PDF', okLabel: 'Continua' });
      if (!ok) return;
    } else if (v.modo === 'segnalibri') {
      parti = D.pianoSegnalibri(await apriVeloce(await app.currentBytes(doc), doc.password));
    }
    const cartella = await app.platform.chooseFolder('Dove salvo i file divisi?');
    if (!cartella) return;
    const bytesDoc = await app.currentBytes(doc);
    const carica = () => apriVeloce(bytesDoc, doc.password);
    let scritti = 0; let troppo = 0;
    await app.ui.withProgress('Divisione del PDF', async (p) => {
      if (v.modo === 'dimensione') {
        p.set(0, 'Calcolo delle parti…');
        const pz = await D.pianoDimensione(carica, n, +v.mb * 1048576, { onProgress: (f) => p.set(f * 0.9, `Analizzate ${Math.round(f * n)} pagine di ${n}`), signal: p.signal });
        const nomi = D.nomiParti(base, pz);
        for (let k = 0; k < pz.length; k++) { await app.platform.writeInFolder(cartella, nomi[k], pz[k].bytes); scritti++; if (pz[k].troppoGrande) troppo++; }
      } else {
        const nomi = D.nomiParti(base, parti);
        scritti = await D.eseguiPiano(carica, parti, nomi, (nome, b) => app.platform.writeInFolder(cartella, nome, b), { onProgress: (f, nome) => p.set(f, `Salvato ${nome}`), signal: p.signal });
      }
    });
    if (!scritti) return;
    const msg = `Creati ${scritti} file${cartella === '__download__' ? ' (nei download)' : ''}.` + (troppo ? ` Attenzione: ${troppo} ${troppo === 1 ? 'parte supera comunque il limite perché contiene' : 'parti superano comunque il limite perché contengono'} una sola pagina molto pesante: prova prima a comprimere il PDF.` : '');
    app.ui.toast(msg, { kind: troppo ? 'warning' : 'success', timeout: 9000, action: cartella !== '__download__' ? { label: 'Apri cartella', run: () => app.platform.showInFolder(cartella) } : undefined });
  } catch (err) { mostraErrore(app, err, 'Dividi PDF'); }
}
