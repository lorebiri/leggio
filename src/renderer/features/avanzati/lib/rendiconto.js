// Pacchetto per la rendicontazione: raggruppa i giustificativi per voce di spesa (sottocartella) e produce il CSV
// di riepilogo. Logica pura.

/**
 * files: [{ rel, name }] relativi alla cartella scelta. La voce è la prima sottocartella; i file in radice
 * finiscono in «Senza voce». Ordine naturale (2 prima di 10).
 * → [{ voce, files: [...] }]
 */
export function raggruppaPerVoce(files, { senzaVoce = 'Senza voce' } = {}) {
  const map = new Map();
  for (const f of files) {
    const parts = String(f.rel || f.name).split(/[\\/]+/).filter(Boolean);
    const voce = parts.length > 1 ? parts[0] : senzaVoce;
    if (!map.has(voce)) map.set(voce, []);
    map.get(voce).push(f);
  }
  const coll = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
  return [...map.entries()].sort((a, b) => (a[0] === senzaVoce) - (b[0] === senzaVoce) || coll.compare(a[0], b[0]))
    .map(([voce, fs]) => ({ voce, files: fs.sort((x, y) => coll.compare(x.rel || x.name, y.rel || y.name)) }));
}

const numIt = (v) => (v == null ? '' : v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }));
function cella(v) { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

/**
 * righe: [{ voce, n, file, pagine, paginaNelPdf, data, importo, cig, cup, nota }]
 * CSV con separatore «;» e virgola decimale (Excel in italiano), con BOM UTF-8.
 */
export function csvRendiconto(righe, { totali = true } = {}) {
  const head = ['Voce di spesa', 'N. allegato', 'File', 'Pagine', 'Pagina nel PDF della voce', 'Data rilevata', 'Importo rilevato (EUR)', 'CIG', 'CUP', 'Note'];
  const lines = [head.join(';')];
  for (const r of righe) lines.push([r.voce, r.n, r.file, r.pagine, r.paginaNelPdf, r.data ? r.data.split('-').reverse().join('/') : '', numIt(r.importo), r.cig, r.cup, r.nota].map(cella).join(';'));
  if (totali) {
    const perVoce = new Map();
    for (const r of righe) perVoce.set(r.voce, (perVoce.get(r.voce) || 0) + (r.importo || 0));
    lines.push('');
    lines.push(['Totale per voce (importi rilevati automaticamente: da verificare)'].map(cella).join(';'));
    for (const [v, t] of perVoce) lines.push([v, '', '', '', '', '', numIt(t)].map(cella).join(';'));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function nomeVoce(voce) { return String(voce).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'voce'; }
