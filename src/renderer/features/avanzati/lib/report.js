// Rapporto di verifica di un file firmato (.p7m) come PDF, generato con pdf-lib (funziona offline e nel browser).
import { testoSicuro } from './protocollo.js';

export const ESITI = {
  valid: { titolo: 'Firma valida', spiega: 'Il documento non è stato modificato dopo la firma; il certificato è qualificato ed era in corso di validità alla data della firma.' },
  warning: { titolo: 'Firma integra, da controllare', spiega: 'Il documento non risulta modificato, ma non tutto è verificabile (per esempio il certificato non è dichiarato qualificato o manca la data della firma): leggi i dettagli.' },
  invalid: { titolo: 'Firma NON valida', spiega: 'Almeno una firma non corrisponde: il documento potrebbe essere stato modificato dopo la firma.' },
};
export const LIMITI = 'Leggio lavora senza Internet: non controlla la revoca dei certificati (CRL/OCSP) né l\'elenco ufficiale dei certificatori accreditati. Per un controllo completo usa anche il verificatore del tuo prestatore di firma.';

export function fmtData(d) {
  if (!d) return '—';
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return '—';
  return x.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
}
export function integritaTesto(s) {
  return { valid: 'Integra', invalid: 'NON integra', unsupported: 'Non verificabile', unknown: 'Non verificata' }[s.integrity] || 'Non verificata';
}

/** Righe descrittive di un firmatario (usate dal pannello e dal rapporto). */
export function righeFirmatario(s) {
  const c = s.certificate;
  return [
    ['Firmatario', s.name + (s.fiscalCode ? ` (C.F. ${s.fiscalCode})` : '')],
    s.organization ? ['Organizzazione', s.organization] : null,
    ['Integrità della firma', `${integritaTesto(s)} — ${s.integrityDetail || ''}`],
    ['Data della firma (dichiarata)', fmtData(s.signingTime)],
    s.timestamp ? ['Marca temporale', `${fmtData(s.timestamp.time)}${s.timestamp.tsa ? ' — ' + s.timestamp.tsa : ''}`] : null,
    ['Certificato rilasciato da', c?.selfSigned ? 'Nessun certificatore: certificato AUTOFIRMATO (creato da chi firma, senza valore di firma qualificata)' : (s.issuer || '—')],
    c ? ['Validità del certificato', `dal ${fmtData(c.notBefore)} al ${fmtData(c.notAfter)}`] : null,
    ['Certificato valido alla data della firma', s.certValidAtSigning == null ? 'Non determinabile (manca la data della firma)' : s.certValidAtSigning ? 'Sì' : 'NO'],
    c ? ['Tipo di certificato', c.qualified ? 'Qualificato (eIDAS)' : c.selfSigned ? 'Autofirmato' : 'Non dichiarato qualificato'] : null,
    c ? ['Numero di serie del certificato', c.serial] : null,
    ['Algoritmo', s.digestAlgorithm],
  ].filter(Boolean);
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** → Uint8Array del PDF. info: { nomeFile, dimensione, sha256, contenuto, stato } */
export async function rapportoPdf(PDFLib, result, info) {
  const doc = await PDFLib.PDFDocument.create();
  doc.setTitle(`Rapporto di verifica - ${info.nomeFile}`);
  doc.setLanguage('it-IT');
  doc.setCreator('Leggio');
  const reg = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const A4 = [595.28, 841.89]; const M = 50; const W = A4[0] - 2 * M;
  let page = doc.addPage(A4); let y = A4[1] - M;
  const ink = PDFLib.rgb(0.11, 0.13, 0.16); const muted = PDFLib.rgb(0.38, 0.42, 0.46);
  const colori = { valid: PDFLib.rgb(0.02, 0.46, 0.28), warning: PDFLib.rgb(0.71, 0.28, 0.03), invalid: PDFLib.rgb(0.7, 0.14, 0.09) };
  const wrap = (t, f, s, w) => {
    const out = []; const testo = testoSicuro(f, t);
    for (const par of testo.split('\n')) {
      let line = '';
      for (const word of par.split(/\s+/)) {
        const tryL = line ? line + ' ' + word : word;
        if (f.widthOfTextAtSize(tryL, s) <= w) line = tryL;
        else {
          if (line) out.push(line);
          let wd = word;
          while (f.widthOfTextAtSize(wd, s) > w && wd.length > 1) { let k = wd.length; while (k > 1 && f.widthOfTextAtSize(wd.slice(0, k), s) > w) k--; out.push(wd.slice(0, k)); wd = wd.slice(k); }
          line = wd;
        }
      }
      out.push(line);
    }
    return out;
  };
  const ensure = (h) => { if (y - h < M) { page = doc.addPage(A4); y = A4[1] - M; } };
  const text = (t, { f = reg, s = 10, c = ink, x = M, w = W, gap = 3 } = {}) => {
    for (const l of wrap(t, f, s, w)) { ensure(s + gap); y -= s; page.drawText(l, { x, y, size: s, font: f, color: c }); y -= gap; }
  };
  const row = (k, v) => {
    const kw = 170;
    const lines = wrap(String(v ?? '—'), reg, 9.5, W - kw);
    ensure(lines.length * 12.5 + 2);
    y -= 9.5;
    page.drawText(testoSicuro(bold, k), { x: M, y, size: 9, font: bold, color: muted });
    lines.forEach((l, i) => { page.drawText(l, { x: M + kw, y: y - i * 12.5, size: 9.5, font: reg, color: ink }); });
    y -= (lines.length - 1) * 12.5 + 5;
  };
  text('Rapporto di verifica della firma digitale', { f: bold, s: 17, gap: 8 });
  text(`Generato da Leggio il ${fmtData(new Date())}`, { s: 9, c: muted, gap: 12 });
  const esito = ESITI[info.stato] || ESITI.warning;
  ensure(54);
  page.drawRectangle({ x: M, y: y - 48, width: W, height: 48, color: PDFLib.rgb(1, 1, 1), borderColor: colori[info.stato] || colori.warning, borderWidth: 2 });
  page.drawText(testoSicuro(bold, esito.titolo), { x: M + 12, y: y - 20, size: 14, font: bold, color: colori[info.stato] || colori.warning });
  const sp = wrap(esito.spiega, reg, 9, W - 24);
  sp.slice(0, 2).forEach((l, i) => page.drawText(l, { x: M + 12, y: y - 34 - i * 11, size: 9, font: reg, color: ink }));
  y -= 62;
  text('File verificato', { f: bold, s: 11.5, gap: 6 });
  row('Nome del file', info.nomeFile);
  row('Dimensione', `${info.dimensione.toLocaleString('it-IT')} byte`);
  row('Impronta SHA-256', info.sha256);
  row('Documento contenuto', info.contenuto || (result.detached ? 'Non incluso (firma separata)' : '—'));
  row('Buste di firma', String(result.levels.filter((l) => l.kind !== 'tsd').length) + (result.levels.length > 1 ? ' (firme annidate: una busta dentro l\'altra)' : ''));
  y -= 6;
  let n = 0;
  result.levels.forEach((lv, li) => {
    if (lv.kind === 'tsd') {
      text(`Marca temporale (busta ${li + 1})`, { f: bold, s: 11.5, gap: 6 });
      for (const t of lv.timestamps) row('Marca temporale', `${fmtData(t.time)}${t.tsa ? ' — ' + t.tsa : ''}`);
      return;
    }
    const walk = (s, contro) => {
      n++;
      y -= 4;
      text(`${contro ? 'Controfirma' : 'Firma'} ${n}${result.levels.length > 1 ? ` (busta ${li + 1} di ${result.levels.length})` : ''}`, { f: bold, s: 11.5, gap: 6, c: colori[s.integrity === 'valid' && s.certValidAtSigning !== false && s.certificate?.qualified ? 'valid' : s.integrity === 'invalid' ? 'invalid' : 'warning'] });
      for (const [k, v] of righeFirmatario(s)) row(k, v);
      s.counterSigners?.forEach((cs) => walk(cs, true));
    };
    lv.signers.forEach((s) => walk(s, false));
  });
  y -= 8;
  text('Cosa non è stato verificato', { f: bold, s: 11.5, gap: 6 });
  text(LIMITI, { s: 9.5, c: muted });
  return doc.save();
}
