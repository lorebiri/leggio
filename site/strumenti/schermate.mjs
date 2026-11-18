// Schermate della pagina del sito (site/img/), fatte con Playwright sulla versione web di Leggio.
// Tutti i documenti mostrati sono inventati e costruiti al volo (nessun dato vero).
//
// Avvio (dalla cartella del progetto):
//   npx vite build && mkdir -p dist/fixtures && cp test/fixtures/*.pdf dist/fixtures/
//   npx vite preview --port 5233 --strictPort &
//   node site/strumenti/schermate.mjs                 (PORT=5233 predefinita)
//   node site/strumenti/schermate.mjs stampa p7m      (solo alcune schermate)
//
// Se lo strumento «Copia documento fronte/retro» (id 'copia-documento') non c'è ancora, al posto della
// schermata disegna un'illustrazione segnaposto con lo stesso nome (img/copia-documento.png).
import { createRequire } from 'node:module';
import { statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, '../..');
const require = createRequire(join(RADICE, 'package.json'));
const { chromium } = require('playwright');
const forge = require('node-forge');
const { PDFDocument, StandardFonts } = require('@cantoo/pdf-lib');

const URL_APP = `http://localhost:${process.env.PORT || 5233}/`;
const CARTELLA = resolve(QUI, '../img');
const VISTA = { width: 1280, height: 800 };
const MAX_KB = 200;
const scelte = process.argv.slice(2);

const browser = await chromium.launch();
const esiti = [];

async function apriApp(tema = 'light') {
  const ctx = await browser.newContext({ viewport: VISTA, deviceScaleFactor: 1, colorScheme: tema, locale: 'it-IT' });
  await ctx.addInitScript((t) => {
    try {
      const k = 'leggio.settings.v1';
      const s = JSON.parse(localStorage.getItem(k) || '{}');
      localStorage.setItem(k, JSON.stringify({ ...s, theme: t, author: 'Ufficio protocollo' }));
    } catch { /* nulla */ }
  }, tema);
  const page = await ctx.newPage();
  const errori = [];
  page.on('pageerror', (e) => errori.push(e.message));
  await page.goto(URL_APP);
  await page.waitForFunction(() => !!window.__leggio);
  await page.waitForTimeout(800);
  await chiudiDialoghi(page);
  return { page, ctx, errori };
}

async function chiudiDialoghi(page) {
  for (let i = 0; i < 4 && (await page.evaluate(() => !!document.querySelector('.dlg'))); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
}

// Formato dei file: WebP (più leggero) per tutte, tranne copia-documento che resta PNG (nome già usato nella pagina).
const FORMATO = { 'copia-documento': 'png' };

/** Converte un PNG in WebP con il codificatore di Chromium (nessuna dipendenza in più). */
async function inWebp(png, qualita = 0.86) {
  const p = await browser.newPage();
  try {
    const dataUrl = await p.evaluate(async ({ b64, qualita }) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', qualita);
    }, { b64: png.toString('base64'), qualita });
    if (!dataUrl.startsWith('data:image/webp')) throw new Error('questo Chromium non sa scrivere WebP');
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally { await p.close(); }
}

async function salva(page, nome, opz = {}) {
  await page.mouse.move(VISTA.width - 2, VISTA.height - 2);
  await page.waitForTimeout(opz.attesa ?? 400);
  // via i messaggi temporanei (toast): coprirebbero la schermata
  await page.evaluate(() => document.querySelectorAll('#toast-root > *').forEach((t) => t.remove())).catch(() => {});
  const png = await page.screenshot(opz.clip ? { clip: opz.clip } : {});
  const est = FORMATO[nome] || 'webp';
  const dati = est === 'webp' ? await inWebp(png) : png;
  const file = join(CARTELLA, `${nome}.${est}`);
  writeFileSync(file, dati);
  const kb = Math.round(statSync(file).size / 1024);
  esiti.push({ nome, kb });
  console.log(`${kb > MAX_KB ? 'GRANDE' : 'OK    '} img/${nome}.${est} — ${kb} kB`);
}

/** Apre un PDF costruito nella pagina con pdf-lib (corpo: funzione serializzata che riceve L e d). */
async function apriCostruito(page, nome, corpo, arg) {
  await page.evaluate(async ({ nome, corpo, arg }) => {
    const app = window.__leggio; const L = app.lib.PDFLib;
    const d = await L.PDFDocument.create();
    // eslint-disable-next-line no-new-func
    await new Function('L', 'd', 'arg', `return (${corpo})(L, d, arg);`)(L, d, arg);
    await app.openBytes(await d.save(), { name: nome });
    await new Promise((r) => setTimeout(r, 1000));
  }, { nome, corpo: corpo.toString(), arg });
}

// ---------- documenti di esempio ----------

const fattura = async (L, d) => {
  const f = await d.embedFont(L.StandardFonts.Helvetica);
  const fb = await d.embedFont(L.StandardFonts.HelveticaBold);
  const p = d.addPage([595, 842]);
  const blu = L.rgb(0.12, 0.3, 0.45);
  p.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: blu });
  p.drawText('Cooperativa Esempio s.c.', { x: 50, y: 810, size: 16, font: fb, color: L.rgb(1, 1, 1) });
  p.drawText('Via dei Mille 1 · 00100 Città · P. IVA 00000000000', { x: 50, y: 770, size: 9, font: f });
  p.drawText('FATTURA n. 42/2026', { x: 50, y: 730, size: 18, font: fb, color: blu });
  p.drawText('Data: 12 novembre 2026', { x: 50, y: 710, size: 10, font: f });
  p.drawText('Spett.le Comune di Esempio', { x: 360, y: 730, size: 10, font: fb });
  p.drawText('Ufficio Servizi Informatici', { x: 360, y: 716, size: 10, font: f });
  p.drawText('Piazza del Municipio 1', { x: 360, y: 702, size: 10, font: f });
  const cols = [50, 250, 300, 380, 430, 545];
  const righe = [
    ['Descrizione', 'Q.tà', 'Prezzo', 'IVA', 'Importo'],
    ['Manutenzione impianto', '1', '100,00', '22%', '122,00'],
    ['Licenza software annuale', '2', '250,00', '22%', '610,00'],
    ['Formazione del personale', '3', '80,00', '22%', '292,80'],
    ['Assistenza telefonica', '6', '15,00', '22%', '109,80'],
  ];
  const top = 660; const h = 26;
  p.drawRectangle({ x: 50, y: top - h, width: 495, height: h, color: L.rgb(0.9, 0.94, 0.96) });
  righe.forEach((r, i) => r.forEach((t, k) => {
    const y = top - (i + 1) * h + 9;
    const font = i === 0 ? fb : f;
    const w = font.widthOfTextAtSize(t, 10);
    const x = k >= 1 ? cols[k + 1] - 6 - w : cols[k] + 6;
    p.drawText(t, { x, y, size: 10, font });
  }));
  for (let i = 0; i <= righe.length; i++) p.drawLine({ start: { x: 50, y: top - i * h }, end: { x: 545, y: top - i * h }, thickness: 0.6 });
  for (const x of cols) p.drawLine({ start: { x, y: top }, end: { x, y: top - righe.length * h }, thickness: 0.6 });
  p.drawText('Totale documento', { x: 330, y: top - righe.length * h - 30, size: 12, font: fb });
  p.drawText('€ 1.134,60', { x: 470, y: top - righe.length * h - 30, size: 12, font: fb });
  p.drawText('Pagamento: bonifico a 30 giorni · Documento di esempio', { x: 50, y: 80, size: 9, font: f, color: L.rgb(0.4, 0.4, 0.4) });
};

const lettera = async (L, d, { pagine = 4 } = {}) => {
  const f = await d.embedFont(L.StandardFonts.TimesRoman);
  const fb = await d.embedFont(L.StandardFonts.TimesRomanBold);
  const paragrafi = [
    'Il Comune di Esempio rende noto che sono aperte le domande per i contributi destinati alle associazioni del territorio. Questo documento è inventato e serve soltanto a mostrare il funzionamento di Leggio.',
    'Possono presentare domanda le associazioni iscritte al registro comunale da almeno un anno, con sede nel territorio e con un progetto rivolto alla cittadinanza.',
    'La domanda va inviata entro il 15 dicembre 2026 tramite posta elettronica certificata, allegando il modulo compilato, la copia di un documento d\'identità del legale rappresentante e il preventivo delle spese.',
    'Le domande saranno valutate da una commissione secondo i criteri indicati nell\'allegato 1. L\'elenco dei progetti ammessi sarà pubblicato all\'albo pretorio online.',
    'Per informazioni è possibile rivolgersi all\'Ufficio Servizi al Cittadino, dal lunedì al venerdì dalle 9 alle 12.',
  ];
  const titoli = ['Oggetto: avviso pubblico per l\'assegnazione di contributi', 'Allegato 1 – criteri di valutazione', 'Allegato 2 – modulo di domanda', 'Allegato 3 – riepilogo delle spese', 'Allegato 4 – informativa sulla privacy', 'Allegato 5 – note finali'];
  const scrivi = (p, testo, y) => {
    let riga = '';
    for (const w of testo.split(' ')) {
      if (f.widthOfTextAtSize(`${riga} ${w}`, 11) > 470) { p.drawText(riga.trim(), { x: 60, y, size: 11, font: f }); y -= 15; riga = ''; }
      riga += ` ${w}`;
    }
    p.drawText(riga.trim(), { x: 60, y, size: 11, font: f });
    return y - 26;
  };
  for (let n = 0; n < pagine; n++) {
    const p = d.addPage([595, 842]);
    p.drawRectangle({ x: 60, y: 772, width: 6, height: 30, color: L.rgb(0.06, 0.46, 0.43) });
    p.drawText('COMUNE DI ESEMPIO', { x: 74, y: 788, size: 16, font: fb });
    p.drawText('Area Servizi al Cittadino', { x: 74, y: 772, size: 11, font: f });
    p.drawText(titoli[n % titoli.length], { x: 60, y: 715, size: 13, font: fb });
    let y = 685;
    if (n % 3 === 1) { // una tabellina
      for (let r = 0; r < 6; r++) {
        p.drawRectangle({ x: 60, y: y - r * 22 - 6, width: 470, height: 22, color: r === 0 ? L.rgb(0.85, 0.93, 0.91) : L.rgb(1, 1, 1), borderColor: L.rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        p.drawText(r === 0 ? 'Criterio' : `Criterio ${r}`, { x: 68, y: y - r * 22, size: 10, font: r === 0 ? fb : f });
        p.drawText(r === 0 ? 'Punti' : String(10 * r), { x: 470, y: y - r * 22, size: 10, font: r === 0 ? fb : f });
      }
      y -= 160;
    } else if (n % 3 === 2) { // un grafico a barre
      [0.55, 0.8, 0.4, 0.95, 0.7].forEach((v, i) => p.drawRectangle({ x: 80 + i * 90, y: y - 170, width: 50, height: 160 * v, color: L.rgb(0.06 + i * 0.08, 0.46, 0.43 + i * 0.05) }));
      y -= 200;
    }
    for (let k = 0; k < paragrafi.length && y > 140; k++) y = scrivi(p, paragrafi[(k + n) % paragrafi.length], y);
    p.drawText(`Pagina ${n + 1} di ${pagine}`, { x: 270, y: 50, size: 9, font: f });
  }
};

/** FatturaPA inventata (formato FPA12) per la schermata della fattura elettronica. */
const FATTURA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPA12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
<FatturaElettronicaHeader>
 <DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>00000000000</IdCodice></IdTrasmittente><ProgressivoInvio>00042</ProgressivoInvio><FormatoTrasmissione>FPA12</FormatoTrasmissione><CodiceDestinatario>UFABCD</CodiceDestinatario></DatiTrasmissione>
 <CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>00000000000</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Cooperativa Esempio s.c.</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici>
  <Sede><Indirizzo>Via dei Mille</Indirizzo><NumeroCivico>1</NumeroCivico><CAP>00100</CAP><Comune>Città</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione></Sede></CedentePrestatore>
 <CessionarioCommittente><DatiAnagrafici><CodiceFiscale>00000000000</CodiceFiscale><Anagrafica><Denominazione>Comune di Esempio</Denominazione></Anagrafica></DatiAnagrafici>
  <Sede><Indirizzo>Piazza del Municipio 1</Indirizzo><CAP>00100</CAP><Comune>Esempio</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione></Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
 <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2026-11-12</Data><Numero>42/2026</Numero><ImportoTotaleDocumento>1134.60</ImportoTotaleDocumento><Causale>Servizi informatici - documento di esempio</Causale></DatiGeneraliDocumento>
  <DatiOrdineAcquisto><IdDocumento>ORD-118</IdDocumento><CodiceCUP>B12C34000560001</CodiceCUP><CodiceCIG>Z1A2B3C4D5</CodiceCIG></DatiOrdineAcquisto></DatiGenerali>
 <DatiBeniServizi>
  <DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Manutenzione impianto</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>100.00</PrezzoUnitario><PrezzoTotale>100.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DettaglioLinee><NumeroLinea>2</NumeroLinea><Descrizione>Licenza software annuale</Descrizione><Quantita>2.00</Quantita><PrezzoUnitario>250.00</PrezzoUnitario><PrezzoTotale>500.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DettaglioLinee><NumeroLinea>3</NumeroLinea><Descrizione>Formazione del personale</Descrizione><Quantita>3.00</Quantita><PrezzoUnitario>80.00</PrezzoUnitario><PrezzoTotale>240.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DettaglioLinee><NumeroLinea>4</NumeroLinea><Descrizione>Assistenza telefonica</Descrizione><Quantita>6.00</Quantita><PrezzoUnitario>15.00</PrezzoUnitario><PrezzoTotale>90.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>930.00</ImponibileImporto><Imposta>204.60</Imposta><EsigibilitaIVA>S</EsigibilitaIVA><RiferimentoNormativo>Scissione dei pagamenti art. 17-ter</RiferimentoNormativo></DatiRiepilogo>
 </DatiBeniServizi>
 <DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-12-12</DataScadenzaPagamento><ImportoPagamento>930.00</ImportoPagamento><IstitutoFinanziario>Banca di Prova</IstitutoFinanziario><IBAN>IT60X0542811101000000123456</IBAN></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody>
</p:FatturaElettronica>`;

// ---------- scene ----------

const SCENE = {
  async 'copia-documento'() {
    const { page, ctx, errori } = await apriApp();
    const presente = await page.evaluate(() => {
      const t = window.__leggio.tools;
      return !!(t.get?.('copia-documento') || t.list?.().some((x) => x.id === 'copia-documento'));
    });
    if (!presente) {
      await ctx.close();
      console.log('INFO   strumento «copia-documento» non ancora presente: disegno il segnaposto');
      return segnaposto();
    }
    // due scansioni A4 (fronte e retro) con una tessera di prova un po' storta
    await page.evaluate(async () => {
      const app = window.__leggio; const L = app.lib.PDFLib;
      const d = await L.PDFDocument.create();
      const tessera = async (lato) => {
        const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const g = c.getContext('2d');
        g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, c.width, c.height);
        g.save(); g.translate(360, 330); g.rotate(lato === 'fronte' ? -0.05 : 0.035);
        const W = 506, H = 319;
        g.fillStyle = lato === 'fronte' ? '#dfe9f3' : '#e8eef0'; g.strokeStyle = '#9fb3c4'; g.lineWidth = 2;
        g.beginPath(); g.roundRect(0, 0, W, H, 22); g.fill(); g.stroke();
        g.fillStyle = '#1f4e79'; g.font = 'bold 26px sans-serif'; g.fillText('DOCUMENTO DI PROVA', 24, 44);
        g.font = '17px sans-serif'; g.fillStyle = '#334';
        if (lato === 'fronte') {
          g.fillStyle = '#c9d3dc'; g.fillRect(24, 70, 130, 170);
          g.fillStyle = '#334'; ['COGNOME  ROSSI', 'NOME  MARIA', 'NATA IL  01.01.1980', 'SCADENZA  01.01.2030'].forEach((t, i) => g.fillText(t, 180, 100 + i * 36));
        } else {
          ['INDIRIZZO  VIA ESEMPIO 1', 'COMUNE  ESEMPIO'].forEach((t, i) => g.fillText(t, 24, 100 + i * 34));
          g.font = '20px monospace'; g.fillText('C<ITA0000000<<<<<<<<<<<<<<<', 24, 250); g.fillText('ROSSI<<MARIA<<<<<<<<<<<<<<<<', 24, 282);
        }
        g.restore();
        return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer());
      };
      for (const lato of ['fronte', 'retro']) {
        const p = d.addPage([595.28, 841.89]);
        p.drawImage(await d.embedJpg(await tessera(lato)), { x: 0, y: 0, width: 595.28, height: 841.89 });
      }
      await app.openBytes(await d.save(), { name: 'scansione-documento.pdf' });
      await new Promise((r) => setTimeout(r, 1000));
      app.tools.run('copia-documento');
    });
    await page.waitForSelector('.cd-coppia', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.cd-stato.ok, .cd-stato.warn').length >= 2, null, { timeout: 30000 }).catch(() => {});
    // via il suggerimento dell'OCR (è una scansione), poi una filigrana d'esempio
    await page.getByRole('button', { name: 'Non ora' }).click({ timeout: 2000 }).catch(() => {});
    await page.getByLabel(/Filigrana/).fill('Comune di Esempio').catch(() => {});
    await page.getByLabel(/Finalità/).fill('iscrizione al nido').catch(() => {});
    await page.evaluate(() => document.querySelector('.cd-coppia')?.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => { const c = document.querySelector('.cd-coppia'); const sc = c?.closest('[class*="pane"], main, .av-pane'); if (sc) sc.scrollTop -= 40; });
    await salva(page, 'copia-documento', { attesa: 800 });
    // il risultato: un foglio A4 con fronte e retro in scala reale
    await page.getByRole('button', { name: 'Crea il PDF' }).click();
    await page.waitForFunction(() => /fronte-retro/.test(window.__leggio.activeDoc?.name || ''), null, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Non ora' }).click({ timeout: 1500 }).catch(() => {});
    await page.evaluate(() => { window.__leggio.viewer.pdfViewer.currentScaleValue = 'page-fit'; });
    await page.waitForTimeout(800);
    // solo il foglio A4, con un po' di margine
    const r = await page.evaluate(() => { const b = document.querySelector('.pdfViewer .page').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
    const m = 12; const y = Math.max(0, r.y - m);
    const clip = { x: Math.max(0, r.x - m), y, width: r.width + 2 * m, height: Math.min(VISTA.height - 30, r.y + r.height + m) - y };
    await salva(page, 'copia-documento-risultato', { attesa: 600, clip });
    await fine(ctx, errori, 'copia-documento');
  },

  async 'modifica-tabella'() {
    const { page, ctx, errori } = await apriApp();
    await apriCostruito(page, 'fattura-42.pdf', fattura);
    await page.evaluate(() => window.__leggio.tools.run('edit-content'));
    await page.waitForTimeout(1500);
    const pt = await page.evaluate(() => {
      const app = window.__leggio; const vp = app.viewer.getViewport(0); const r = app.viewer.getOverlay(0).getBoundingClientRect();
      const [x, y] = vp.convertToViewportPoint(350, 660 - 3 * 26 + 12); return { x: r.left + x, y: r.top + y };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForSelector('.lgm-editor', { timeout: 10000 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1.250,00');
    await salva(page, 'modifica-tabella', { attesa: 600 });
    await fine(ctx, errori, 'modifica-tabella');
  },

  async p7m() {
    const p7m = await creaP7m();
    const { page, ctx, errori } = await apriApp();
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__leggio.openFile({ name: 'determina-118.pdf.p7m', bytes });
      await new Promise((r) => setTimeout(r, 1500));
    }, Buffer.from(p7m).toString('base64'));
    await salva(page, 'p7m', { attesa: 800 });
    await fine(ctx, errori, 'p7m');
  },

  async stampa() {
    const { page, ctx, errori } = await apriApp();
    await apriCostruito(page, 'avviso-pubblico.pdf', lettera, { pagine: 6 });
    await page.evaluate(() => { window.__leggio.tools.run('core-print'); });
    await page.waitForSelector('.dlg', { timeout: 10000 });
    await salva(page, 'stampa', { attesa: 1500 });
    await fine(ctx, errori, 'stampa');
  },

  async 'oscura-documento'() {
    const { page, ctx, errori } = await apriApp();
    const CARD = [60, 520, 400, 734];
    await documentoDiProva(page, CARD);
    await page.getByRole('button', { name: 'Documento d\'identità…' }).click();
    await page.waitForSelector('.dlg');
    await page.getByLabel('Documento', { exact: true }).selectOption('cie');
    await page.getByLabel('Lato', { exact: true }).selectOption('retro');
    await page.click('.dlg button[type=submit]');
    await page.waitForTimeout(300);
    await trascinaSuTessera(page, CARD);
    await salva(page, 'oscura-documento', { attesa: 600 });
    await fine(ctx, errori, 'oscura-documento');
  },

  async 'fattura-xml'() {
    const { page, ctx, errori } = await apriApp();
    await page.evaluate(async (xml) => {
      await window.__leggio.openFile({ name: 'IT00000000000_00042.xml', bytes: new TextEncoder().encode(xml) });
      await new Promise((r) => setTimeout(r, 1500));
    }, FATTURA_XML);
    await salva(page, 'fattura-xml', { attesa: 600 });
    await fine(ctx, errori, 'fattura-xml');
  },

  async 'titulus-ugov'() {
    const { page, ctx, errori } = await apriApp();
    await apriCostruito(page, 'Fattura_Cooperativa_n42_2026.pdf', async (L, d) => {
      const f = await d.embedFont(L.StandardFonts.Helvetica); const fb = await d.embedFont(L.StandardFonts.HelveticaBold);
      const p = d.addPage([595, 842]);
      const t = (s, x, y, o = {}) => p.drawText(s, { x, y, size: 10, font: f, ...o });
      p.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: L.rgb(0.12, 0.3, 0.45) });
      t('Cooperativa Esempio s.c.', 50, 775, { size: 16, font: fb });
      t('Via dei Mille 1 - 00100 Citta - P. IVA 01234567890', 50, 757);
      t('FATTURA n. 42/2026 del 12/11/2026', 50, 715, { size: 16, font: fb });
      t('Destinatario: Comune di Esempio - Codice ufficio UFABCD', 50, 690);
      t('Ordine n. ORD-118 del 02/10/2026 - CIG Z1A2B3C4D5 - CUP B12C34000560001', 50, 672);
      t('Manutenzione impianto', 50, 630); t('100,00', 500, 630);
      t('Licenza software annuale', 50, 612); t('500,00', 500, 612);
      p.drawLine({ start: { x: 50, y: 600 }, end: { x: 545, y: 600 }, thickness: 0.6 });
      t('Imponibile 600,00 - IVA 22% 132,00', 50, 582);
      t('Totale documento EUR 732,00', 50, 562, { font: fb, size: 12 });
      t('Pagamento: bonifico IBAN IT60X0542811101000000123456 entro il 12/12/2026', 50, 537);
      t('Documento di esempio', 50, 80, { color: L.rgb(0.4, 0.4, 0.4) });
    });
    await page.evaluate(() => window.__leggio.sidebar.show('controlli'));
    await page.waitForSelector('.side-content >> text=Per U-GOV', { timeout: 15000 });
    await salva(page, 'titulus-ugov', { attesa: 800 });
    await fine(ctx, errori, 'titulus-ugov');
  },

  async 'oscura-filigrana'() {
    const { page, ctx, errori } = await apriApp();
    const CARD = [60, 520, 400, 734];
    await documentoDiProva(page, CARD);
    await page.getByRole('button', { name: 'Documento d\'identità…' }).click();
    await page.waitForSelector('.dlg');
    await page.getByLabel('Documento', { exact: true }).selectOption('cie');
    await page.getByLabel('Lato', { exact: true }).selectOption('retro');
    await page.click('.dlg button[type=submit]');
    await page.waitForTimeout(300);
    await trascinaSuTessera(page, CARD);
    await page.getByRole('button', { name: 'Applica oscuramento…' }).click();
    await page.waitForSelector('.dlg');
    await page.getByLabel('Filigrana: «Copia per uso esclusivo di…» (facoltativa)').fill('Comune di Esempio');
    await page.getByLabel('Finalità (facoltativa)').fill('iscrizione al nido');
    await page.getByText('Applica al documento aperto').click();
    await page.click('.dlg button[type=submit]');
    await page.waitForSelector('.dlg >> text=Oscuramento completato', { timeout: 60000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__leggio.tools.deactivate?.(); window.__leggio.viewer.pdfViewer.currentScaleValue = 'page-width'; });
    await page.waitForTimeout(1200);
    await salva(page, 'oscura-filigrana', { attesa: 800 });
    await fine(ctx, errori, 'oscura-filigrana');
  },

  async commenti() {
    const { page, ctx, errori } = await apriApp();
    await apriCostruito(page, 'avviso-pubblico.pdf', lettera, { pagine: 2 });
    const punto = (x, y) => page.evaluate(([x, y]) => {
      const app = window.__leggio; const vp = app.viewer.getViewport(0); const r = app.viewer.getOverlay(0).getBoundingClientRect();
      const [a, b] = vp.convertToViewportPoint(x, y); return { x: r.left + a, y: r.top + b };
    }, [x, y]);
    // timbro «RICEVUTO»
    await page.evaluate(() => window.__leggio.tools.run('stamp'));
    await page.waitForTimeout(400);
    let a = await punto(390, 790);
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(1500);
    // evidenziatore sulla prima riga del testo
    await page.evaluate(() => { window.__leggio.tools.deactivate(); window.__leggio.tools.run('highlight'); });
    await page.waitForTimeout(1000);
    const riga = await page.locator('.textLayer span', { hasText: 'Il Comune di Esempio rende' }).first().boundingBox();
    await page.mouse.move(riga.x + 1, riga.y + riga.height / 2); await page.mouse.down();
    await page.mouse.move(riga.x + riga.width - 1, riga.y + riga.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    await chiudiDialoghi(page);
    await page.evaluate(() => window.__leggio.tools.deactivate());
    await page.getByRole('button', { name: 'Commenti', exact: true }).first().click().catch(() => {});
    await salva(page, 'commenti', { attesa: 1000 });
    await fine(ctx, errori, 'commenti');
  },

  async ocr() {
    const { page, ctx, errori } = await apriApp();
    await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('fixtures/conv-scansione.pdf')).arrayBuffer());
      await window.__leggio.openBytes(bytes, { name: 'scansione-delibera.pdf' });
      await new Promise((r) => setTimeout(r, 1200));
      window.__leggio.tools.run('ocr');
    });
    await page.waitForTimeout(1500);
    await salva(page, 'ocr', { attesa: 600 });
    await fine(ctx, errori, 'ocr');
  },

  async pagine() {
    const { page, ctx, errori } = await apriApp();
    await apriCostruito(page, 'avviso-pubblico.pdf', lettera, { pagine: 6 });
    await page.evaluate(() => window.__leggio.tools.run('organize'));
    await salva(page, 'pagine', { attesa: 1500 });
    await fine(ctx, errori, 'pagine');
  },

  async strumenti() {
    const { page, ctx, errori } = await apriApp();
    await apriCostruito(page, 'avviso-pubblico.pdf', lettera, { pagine: 2 });
    await page.evaluate(() => window.__leggio.tools.openHub());
    await salva(page, 'strumenti', { attesa: 1000 });
    await fine(ctx, errori, 'strumenti');
  },

  async inizio() {
    const { page, ctx, errori } = await apriApp('light');
    await salva(page, 'inizio', { attesa: 800 });
    await fine(ctx, errori, 'inizio');
  },

  async 'inizio-scuro'() {
    const { page, ctx, errori } = await apriApp('dark');
    await salva(page, 'inizio-scuro', { attesa: 800 });
    await fine(ctx, errori, 'inizio-scuro');
  },

  async 'lettura-scuro'() {
    const { page, ctx, errori } = await apriApp('dark');
    await apriCostruito(page, 'avviso-pubblico.pdf', lettera, { pagine: 6 });
    await page.evaluate(async () => {
      const app = window.__leggio; app.tools.run('core-two-pages');
      await new Promise((r) => setTimeout(r, 500));
      app.viewer.pdfViewer.currentPageNumber = 2;
    });
    await salva(page, 'lettura-scuro', { attesa: 1500 });
    await fine(ctx, errori, 'lettura-scuro');
  },
};

/** Retro di un documento d'identità di prova su una pagina A4, aperto con lo strumento «Oscura» attivo. */
async function documentoDiProva(page, CARD) {
  await page.evaluate(async (CARD) => {
    const app = window.__leggio; const L = app.lib.PDFLib;
    const d = await L.PDFDocument.create();
    const p = d.addPage([595, 842]);
    const f = await d.embedFont(L.StandardFonts.Courier);
    const fs = await d.embedFont(L.StandardFonts.Helvetica);
    const [x0, y0, x1, y1] = CARD; const W = x1 - x0; const H = y1 - y0;
    const c = document.createElement('canvas'); c.width = 680; c.height = 428; const g = c.getContext('2d');
    g.fillStyle = '#e6edf3'; g.fillRect(0, 0, 680, 428); g.fillStyle = '#cfd9e2'; g.fillRect(0, 300, 680, 128);
    const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    p.drawImage(await d.embedJpg(jpg), { x: x0, y: y0, width: W, height: H });
    p.drawText('DOCUMENTO DI PROVA – RETRO', { x: x0 + 10, y: y1 - 18, size: 9, font: fs });
    p.drawText('RSSMRA80A41H501U', { x: x0 + 10, y: y1 - 0.18 * H, size: 11, font: f });
    p.drawText('VIA ESEMPIO 1 CITTA', { x: x0 + 10, y: y1 - 0.40 * H, size: 11, font: f });
    p.drawText('C<ITA0000000<<<<<<<<<<<<<<<', { x: x0 + 10, y: y1 - 0.72 * H, size: 11, font: f });
    p.drawText('ROSSI<<MARIA<<<<<<<<<<<<<<<', { x: x0 + 10, y: y1 - 0.90 * H, size: 11, font: f });
    p.drawText('Allegato alla domanda di iscrizione al servizio mensa', { x: 60, y: 460, size: 12, font: fs });
    await app.openBytes(await d.save(), { name: 'copia-documento-identita.pdf' });
    await new Promise((r) => setTimeout(r, 900));
    app.tools.run('redact');
  }, CARD);
  await page.waitForTimeout(500);
}

/** Trascina un riquadro attorno alla tessera (coordinate PDF in CARD). */
async function trascinaSuTessera(page, CARD) {
  const pts = await page.evaluate((CARD) => {
    const app = window.__leggio; const vp = app.viewer.getViewport(0); const r = app.viewer.getOverlay(0).getBoundingClientRect();
    const a = vp.convertToViewportPoint(CARD[0], CARD[3]); const b = vp.convertToViewportPoint(CARD[2], CARD[1]);
    return { x0: r.left + a[0], y0: r.top + a[1], x1: r.left + b[0], y1: r.top + b[1] };
  }, CARD);
  await page.mouse.move(pts.x0, pts.y0); await page.mouse.down();
  await page.mouse.move((pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2, { steps: 5 });
  await page.mouse.move(pts.x1, pts.y1, { steps: 5 }); await page.mouse.up();
}

async function fine(ctx, errori, nome) {
  if (errori.length) console.log(`ERRORE ${nome}: ${errori.join(' | ')}`);
  await ctx.close();
}

/** Busta CAdES (.p7m) di prova con un PDF dentro, firmata con un certificato inventato. */
async function creaP7m() {
  const pd = await PDFDocument.create();
  const f = await pd.embedFont(StandardFonts.Helvetica); const fb = await pd.embedFont(StandardFonts.HelveticaBold);
  const p = pd.addPage([595, 842]);
  p.drawText('COMUNE DI ESEMPIO', { x: 60, y: 770, size: 16, font: fb });
  p.drawText('Determinazione dirigenziale n. 118 del 10/11/2026', { x: 60, y: 730, size: 13, font: fb });
  p.drawText('Oggetto: affidamento del servizio di manutenzione (documento di esempio)', { x: 60, y: 700, size: 11, font: f });
  [
    'IL DIRIGENTE',
    'Visto il regolamento comunale per l\'acquisto di beni e servizi;',
    'Considerato che il contratto di manutenzione scade il 31 dicembre 2026;',
    'Ritenuto necessario garantire la continuità del servizio;',
    '',
    'DETERMINA',
    '1. di affidare il servizio di manutenzione per l\'anno 2027;',
    '2. di impegnare la spesa sul capitolo di bilancio indicato in allegato;',
    '3. di pubblicare il presente atto all\'albo pretorio online.',
    '',
    'Documento inventato, usato solo per mostrare Leggio.',
  ].forEach((t, i) => p.drawText(t, { x: 60, y: 650 - i * 22, size: 11, font: /^[A-Z ]+$/.test(t) ? fb : f }));
  p.drawText('Il Dirigente – firmato digitalmente', { x: 340, y: 300, size: 11, font: f });
  const pdf = await pd.save();
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate(); cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.UTC(2025, 0, 1)); cert.validity.notAfter = new Date(Date.UTC(2030, 0, 1));
  cert.setSubject([{ name: 'commonName', value: 'MARIA ROSSI' }, { name: 'organizationName', value: 'Comune di Esempio' }, { name: 'countryName', value: 'IT' }]);
  cert.setIssuer([{ name: 'commonName', value: 'Autorità di certificazione di prova' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(Buffer.from(pdf).toString('binary')); p7.addCertificate(cert);
  p7.addSigner({ key: keys.privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date(Date.UTC(2026, 10, 10, 9, 30)) }] });
  p7.sign();
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

/** Illustrazione al posto della schermata di «Copia documento fronte/retro», finché lo strumento non presente. */
async function segnaposto() {
  const ctx = await browser.newContext({ viewport: VISTA, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const carta = (x, y, w, h, lato, rot = 0) => `
    <g transform="translate(${x} ${y}) rotate(${rot} ${w / 2} ${h / 2})">
      <rect width="${w}" height="${h}" rx="${h * 0.07}" fill="${lato === 'fronte' ? '#dbe8f2' : '#e5edf0'}" stroke="#8fa8bc" stroke-width="2"/>
      <rect x="${w * 0.05}" y="${h * 0.1}" width="${w * 0.9}" height="${h * 0.1}" rx="4" fill="#1f4e79" opacity=".85"/>
      ${lato === 'fronte'
    ? `<rect x="${w * 0.06}" y="${h * 0.3}" width="${w * 0.24}" height="${h * 0.58}" rx="6" fill="#b9c7d3"/>
         ${[0, 1, 2, 3].map((i) => `<rect x="${w * 0.36}" y="${h * (0.34 + i * 0.13)}" width="${w * (0.5 - i * 0.06)}" height="${h * 0.055}" rx="3" fill="#8798a8"/>`).join('')}`
    : `${[0, 1].map((i) => `<rect x="${w * 0.06}" y="${h * (0.32 + i * 0.13)}" width="${w * (0.6 - i * 0.15)}" height="${h * 0.055}" rx="3" fill="#8798a8"/>`).join('')}
         ${[0, 1, 2].map((i) => `<rect x="${w * 0.06}" y="${h * (0.66 + i * 0.09)}" width="${w * 0.88}" height="${h * 0.045}" rx="2" fill="#6f8293"/>`).join('')}`}
    </g>`;
  const foglio = (x, y, w, h, dentro, etichetta) => `
    <g transform="translate(${x} ${y})">
      <rect x="6" y="10" width="${w}" height="${h}" rx="6" fill="#000" opacity=".08"/>
      <rect width="${w}" height="${h}" rx="6" fill="#fffefb" stroke="#d6d1c4"/>
      ${dentro}
      <text x="${w / 2}" y="${h + 34}" text-anchor="middle" font-size="20" fill="#4a4f57">${etichetta}</text>
    </g>`;
  const A4 = [170, 240];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800" font-family="Segoe UI, system-ui, sans-serif">
    <defs><linearGradient id="sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f2ec"/><stop offset="1" stop-color="#e9e6dd"/></linearGradient>
      <marker id="fr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#0f766e"/></marker></defs>
    <rect width="1280" height="800" fill="url(#sf)"/>
    <text x="640" y="92" text-anchor="middle" font-size="38" font-weight="600" fill="#1c1e22" font-family="Iowan Old Style, Palatino, Georgia, serif">Copia documento fronte/retro</text>
    <text x="640" y="132" text-anchor="middle" font-size="21" fill="#565a62">Due scansioni A4 → una pagina A4 con fronte e retro a grandezza reale (85,6 × 54 mm)</text>
    ${foglio(110, 230, ...A4, carta(22, 26, 96, 61, 'fronte', -4), 'Scansione del fronte')}
    ${foglio(320, 230, ...A4, carta(30, 34, 96, 61, 'retro', 3), 'Scansione del retro')}
    <path d="M540 350 C 610 350, 640 350, 700 350" fill="none" stroke="#0f766e" stroke-width="5" stroke-linecap="round" marker-end="url(#fr)"/>
    <text x="620" y="320" text-anchor="middle" font-size="18" fill="#0f766e" font-weight="600">trova, ritaglia</text>
    <text x="620" y="392" text-anchor="middle" font-size="18" fill="#0f766e" font-weight="600">e raddrizza</text>
    ${foglio(760, 175, 300, 424, `${carta(68, 70, 164, 103, 'fronte')}${carta(68, 205, 164, 103, 'retro')}
      <text x="150" y="360" text-anchor="middle" font-size="13" fill="#7a7f88" font-style="italic">Copia per uso … – data</text>`, 'Pronta da stampare, tutto sul tuo computer')}
    <text x="640" y="760" text-anchor="middle" font-size="15" fill="#7a7f88">Illustrazione: la schermata dell'app arriverà con la prossima versione.</text>
  </svg>`;
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  await salva(page, 'copia-documento', { attesa: 100 });
  await ctx.close();
}

try {
  for (const [nome, scena] of Object.entries(SCENE)) {
    if (scelte.length && !scelte.includes(nome)) continue;
    try { await scena(); } catch (e) { esiti.push({ nome, errore: e.message }); console.log(`NO     ${nome}: ${e.message}`); }
  }
} finally {
  await browser.close();
}
const male = esiti.filter((e) => e.errore || e.kb > MAX_KB);
process.exit(male.length ? 1 : 0);
