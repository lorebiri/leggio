// Schermate delle novità della 0.3 prese dall'app vera (Electron), con dati di esempio INVENTATI.
// Uso: npx vite build && xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/schermate-0.3.mjs
// Risultato: marketing/0.3/*.png (1440×900). Usa una cartella dati temporanea: l'archivio vero non viene toccato.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as PDFLib from '@cantoo/pdf-lib';

const { _electron: electron } = createRequire(import.meta.url)('playwright');
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'marketing', '0.3');
mkdirSync(OUT, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'leggio-schermate-'));
const W = 1440; const H = 900;

// ------------------------------------------------------------------ dati inventati
const NOMI = ['Giovanna', 'Paolo', 'Lara', 'Davide', 'Silvia', 'Matteo', 'Elena', 'Stefano', 'Irene', 'Fabio', 'Marta', 'Tommaso', 'Sara', 'Nicola', 'Alessia', 'Pietro', 'Valeria', 'Enrico', 'Chiara', 'Michele'];
const COGNOMI = ['Ferri', 'Bonetti', 'Galli', 'Moretti', 'Fabbri', 'Santini', 'Bertoni', 'Pace', 'Gatti', 'Orlandi', 'Neri', 'Villa', 'Testa', 'Riva', 'Benassi', 'Donati', 'Monti', 'Fontana', 'Sala', 'Caruso'];
const GRUPPI = ['volontari', 'volontari', 'soci', 'soci', 'soci', 'revisori'];
const LETT = 'BCDFGHLMNPRSTVZ';
const MESI = 'ABCDEHLMPRST';
function cfFinto(i, ctrl) {
  const p15 = `${LETT[i % 15]}${LETT[(i * 7 + 3) % 15]}${LETT[(i * 3 + 5) % 15]}${LETT[(i * 11 + 1) % 15]}${LETT[(i * 5 + 2) % 15]}${LETT[(i * 13 + 4) % 15]}${String(60 + (i % 35)).padStart(2, '0')}${MESI[i % 12]}${String(1 + (i % 28) + (i % 2 ? 40 : 0)).padStart(2, '0')}Z999`;
  return p15 + ctrl(p15);
}
const piva = (b) => { let s = 0; for (let i = 0; i < 10; i++) { let d = +b[i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return b + ((10 - (s % 10)) % 10); };

async function documento(titolo, pagine = 3) {
  const d = await PDFLib.PDFDocument.create();
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica); const fb = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const testo = 'Le parti convengono quanto segue. L\'associazione si impegna a svolgere le attività descritte nel programma allegato, nel rispetto delle norme vigenti e con personale adeguatamente formato.';
  for (let p = 0; p < pagine; p++) {
    const pg = d.addPage([595, 842]);
    pg.drawText(titolo, { x: 60, y: 770, size: 18, font: fb, color: PDFLib.rgb(0.1, 0.2, 0.35) });
    pg.drawText(`Pagina ${p + 1} di ${pagine}`, { x: 60, y: 748, size: 10, font: f, color: PDFLib.rgb(0.4, 0.4, 0.4) });
    for (let r = 0; r < 26; r++) {
      const art = `Art. ${p * 26 + r + 1} — `;
      pg.drawText((art + testo).slice(0, 92), { x: 60, y: 710 - r * 22, size: 10.5, font: f });
    }
  }
  return d.save();
}
async function moduloRimborso() {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica); const fb = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  p.drawText('Associazione Esempio di Valbruna', { x: 60, y: 790, size: 11, font: f, color: PDFLib.rgb(0.35, 0.35, 0.35) });
  p.drawText('Richiesta di rimborso spese per volontari', { x: 60, y: 760, size: 17, font: fb });
  const form = d.getForm();
  const campi = [['Cognome', 'Cognome'], ['Nome', 'Nome'], ['Codice fiscale', 'Codice_fiscale'], ['Data di nascita', 'data_nascita'], ['Indirizzo', 'Indirizzo'], ['CAP', 'CAP'], ['Città', 'Citta'], ['Email', 'Email'], ['IBAN per il rimborso', 'IBAN'], ['Importo richiesto (€)', 'Importo'], ['Data', 'Data']];
  campi.forEach(([e, n], i) => {
    p.drawText(e, { x: 60, y: 706 - i * 40, size: 11, font: f });
    form.createTextField(n).addToPage(p, { x: 220, y: 700 - i * 40, width: 300, height: 22 });
  });
  p.drawText('Firma del volontario', { x: 330, y: 230, size: 11, font: f });
  p.drawLine({ start: { x: 330, y: 190 }, end: { x: 530, y: 190 }, thickness: 0.7 });
  return d.save();
}
const FATTURA = (pivaForn, pivaCli) => `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
<FatturaElettronicaHeader>
 <DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${pivaForn}</IdCodice></IdTrasmittente><ProgressivoInvio>00042</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>XYZ1234</CodiceDestinatario></DatiTrasmissione>
 <CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${pivaForn}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Cartoleria Arcobaleno di Esempio S.r.l.</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici>
  <Sede><Indirizzo>Via dei Quaderni</Indirizzo><NumeroCivico>12</NumeroCivico><CAP>59100</CAP><Comune>Valbruna</Comune><Provincia>PO</Provincia><Nazione>IT</Nazione></Sede></CedentePrestatore>
 <CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${pivaCli}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Associazione Esempio di Valbruna</Denominazione></Anagrafica></DatiAnagrafici>
  <Sede><Indirizzo>Piazza del Mercato 3</Indirizzo><CAP>59100</CAP><Comune>Valbruna</Comune><Provincia>PO</Provincia><Nazione>IT</Nazione></Sede></CessionarioCommittente>
</FatturaElettronicaHeader>
<FatturaElettronicaBody>
 <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2026-11-12</Data><Numero>318</Numero><ImportoTotaleDocumento>183.00</ImportoTotaleDocumento><Causale>Materiale per la festa di primavera</Causale></DatiGeneraliDocumento></DatiGenerali>
 <DatiBeniServizi>
  <DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Cartoncini colorati A4 (risma)</Descrizione><Quantita>5.00</Quantita><PrezzoUnitario>12.00</PrezzoUnitario><PrezzoTotale>60.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DettaglioLinee><NumeroLinea>2</NumeroLinea><Descrizione>Pennarelli e colla</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>90.00</PrezzoUnitario><PrezzoTotale>90.00</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
  <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>150.00</ImponibileImporto><Imposta>33.00</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo>
 </DatiBeniServizi>
 <DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>2026-12-12</DataScadenzaPagamento><ImportoPagamento>183.00</ImportoPagamento><IBAN>IT60X0542811101000000123456</IBAN></DettaglioPagamento></DatiPagamento>
</FatturaElettronicaBody>
</p:FatturaElettronica>`;

// ------------------------------------------------------------------ avvio
const app = await electron.launch({
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, LEGGIO_USER_DATA: join(dir, 'dati'), LEGGIO_NO_UPDATE_CHECK: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  executablePath: process.env.ELECTRON_PATH || createRequire(join(ROOT, 'package.json'))('electron'),
});
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => console.log('ERRORE PAGINA:', e.message));
const fatte = [];
async function foto(nome) {
  await page.waitForTimeout(350);
  // gli avvisi temporanei di passaggi precedenti non devono coprire la schermata
  await page.evaluate(() => document.querySelectorAll('#toast-root .toast').forEach((t) => t.remove()));
  const p = join(OUT, nome + '.png');
  await page.screenshot({ path: p });
  fatte.push(p); console.log('  ', nome);
}
const stubApri = (p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: Array.isArray(p) ? p : [p] }); }, p);
const dlg = '#overlay-root .dlg';
const ok = (sel = dlg) => page.click(`${sel} button[type=submit]`);
const chiudiDialoghi = async () => { for (let i = 0; i < 4 && await page.$(dlg); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } };
async function apriFile(p, nome) {
  await stubApri(p);
  await page.evaluate(() => window.__leggio.openDialog());
  await page.waitForFunction((n) => window.__leggio.activeDoc?.name === n, nome, { timeout: 20000 });
  await page.waitForTimeout(900);
}
async function chiudiDoc() {
  const c = page.evaluate(() => window.__leggio.closeDoc());
  await page.waitForTimeout(400);
  if (await page.$(`${dlg} button:has-text("Non salvare")`)) await page.click(`${dlg} button:has-text("Non salvare")`);
  await c;
}

try {
  await page.waitForFunction(() => !!window.__leggio && !!window.__leggioPersonale, null, { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); win.center(); }, [W, H]);
  await page.waitForTimeout(800);
  const vp = await page.evaluate(() => [innerWidth, innerHeight]);
  console.log('finestra', vp.join('×'));

  // ---------------------------------------------------------------- dati di esempio
  const pivaForn = piva('0975318642'); const pivaAss = piva('0864213579');
  await page.evaluate(async ([NOMI, COGNOMI, GRUPPI, pivaAss]) => {
    const P = window.__leggioPersonale; await P.apri();
    const a = P.archivio;
    a.salvaProfilo({ nome: 'Giovanna', cognome: 'Ferri', citta: 'Valbruna', ente: 'Associazione Esempio di Valbruna', ufficio: 'Segreteria', qualifica: 'Segretaria' });
    window.__cfFinto = null;
    const lista = [];
    for (let i = 0; i < 20; i++) {
      lista.push({ id: 'c-esempio-' + i, nome: NOMI[i], cognome: COGNOMI[i], email: `${NOMI[i].toLowerCase()}.${COGNOMI[i].toLowerCase()}@esempio.it`, telefono: `333 ${String(1000000 + i * 7919).slice(0, 7)}`, citta: 'Valbruna', cap: '59100', provincia: 'PO', indirizzo: `Via delle Rose ${i + 1}`, gruppi: [GRUPPI[i % GRUPPI.length]] });
    }
    lista.push({ id: 'c-esempio-ente', ragioneSociale: 'Associazione Esempio di Valbruna', partitaIva: pivaAss, pec: 'associazione.esempio@pec.esempio.it', codiceSdi: 'XYZ1234', citta: 'Valbruna', gruppi: ['enti'] });
    a.salvaContatti(lista);
    await a.salvaOra();
  }, [NOMI, COGNOMI, GRUPPI, pivaAss]);
  // codici fiscali inventati (comune «Z999»: non esiste) e uno sbagliato per mostrare l'avviso
  await page.evaluate(async () => {
    const a = window.__leggioPersonale.archivio;
    // il carattere di controllo lo calcola il validatore dell'app
    const L = 'BCDFGHLMNPRSTVZ'; const M = 'ABCDEHLMPRST';
    const D = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
    const ctrl = (s) => { let t = 0; for (let i = 0; i < 15; i++) { const c = s[i]; t += i % 2 === 0 ? D[c] : /\d/.test(c) ? +c : c.charCodeAt(0) - 65; } return String.fromCharCode(65 + (t % 26)); };
    window.__cfFinto = (i) => { const p15 = `${L[(i + 2) % 15]}${L[(i * 7 + 1) % 15]}${L[(i * 3 + 4) % 15]}${L[(i * 11 + 6) % 15]}${L[(i * 5 + 3) % 15]}${L[(i * 13 + 8) % 15]}${70 + (i % 25)}${M[i % 12]}${String(1 + (i % 28) + (i % 2 ? 0 : 40)).padStart(2, '0')}Z999`; return p15 + ctrl(p15); };
    a.contatti().filter((c) => c.nome).forEach((c, i) => {
      const p15 = `${L[i % 15]}${L[(i * 7 + 3) % 15]}${L[(i * 3 + 5) % 15]}${L[(i * 11 + 1) % 15]}${L[(i * 5 + 2) % 15]}${L[(i * 13 + 4) % 15]}${60 + (i % 35)}${M[i % 12]}${String(1 + (i % 28) + (i % 2 ? 0 : 40)).padStart(2, '0')}Z999`;
      a.salvaContatto({ ...c, codiceFiscale: p15 + ctrl(p15), dataNascita: `${String(1 + (i % 28)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/19${60 + (i % 35)}`, iban: i < 6 ? 'IT60X0542811101000000123456' : '' });
    });
    // un contatto con un codice fiscale sbagliato e un IBAN con un errore di battitura
    const c = a.contatti().find((x) => x.nome === 'Paolo');
    a.salvaContatto({ ...c, codiceFiscale: c.codiceFiscale.slice(0, 15) + (c.codiceFiscale[15] === 'A' ? 'B' : 'A'), iban: 'IT61X0542811101000000123456', pec: 'paolo.bonetti@gmail.com' });
    await a.salvaOra();
  });

  // ---------------------------------------------------------------- 1. archivio personale
  console.log('1. archivio personale');
  await page.evaluate(() => window.__leggio.tools.run('personal-archive'));
  await page.waitForSelector('.pers-main h3');
  await foto('01-archivio-protezione-backup');

  // ---------------------------------------------------------------- 2. crea firma
  console.log('2. crea firma');
  await page.evaluate(() => { document.querySelector('.av-pane .av-pane-head .btn:last-child')?.click(); });
  await page.evaluate(() => window.__leggio.tools.run('signatures-library'));
  await page.waitForSelector('button:has-text("Nuova firma o sigla")');
  await page.click('button:has-text("Nuova firma o sigla")');
  await page.waitForSelector('.sig-pad');
  // una firma disegnata «a mano»: anelli e una coda, come una firma vera
  const bb = await (await page.$('.sig-pad')).boundingBox();
  const tratto = async (pts) => { await page.mouse.move(bb.x + pts[0][0], bb.y + pts[0][1]); await page.mouse.down(); for (const [x, y] of pts.slice(1)) await page.mouse.move(bb.x + x, bb.y + y, { steps: 2 }); await page.mouse.up(); };
  const g = []; for (let t = 0; t <= 1; t += 0.012) { const x = 60 + t * 330; g.push([x + 18 * Math.cos(t * 26), 120 - 34 * Math.sin(t * 13) * (1 - t * 0.5) + 14 * Math.sin(t * 26)]); }
  await tratto(g);
  const f2 = []; for (let t = 0; t <= 1; t += 0.03) f2.push([300 + t * 200, 150 - 10 * Math.sin(t * 6) - t * 18]);
  await tratto(f2);
  await foto('02-crea-firma-disegna');
  await page.click('.sig-tab[data-tab=type]');
  await page.fill('.sig-text', 'Giovanna Ferri');
  await page.waitForTimeout(500);
  await foto('03-crea-firma-scrivi');
  // foto di una firma su carta: carta giallina, ombra, inchiostro blu (scritta con il carattere incluso, inclinata)
  const fotoB64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1400; c.height = 620; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1400, 620); g.addColorStop(0, '#f7f3e6'); g.addColorStop(0.6, '#e2dccb'); g.addColorStop(1, '#a29b88');
    x.fillStyle = g; x.fillRect(0, 0, 1400, 620);
    const img = x.getImageData(0, 0, 1400, 620); for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; } x.putImageData(img, 0, 0);
    x.save(); x.translate(250, 380); x.rotate(-0.06); x.fillStyle = '#23347e'; x.font = '150px "Leggio Dancing Script"'; x.fillText('Giovanna Ferri', 0, 0); x.restore();
    x.strokeStyle = '#23347e'; x.lineWidth = 5; x.beginPath(); x.moveTo(300, 430); x.bezierCurveTo(600, 470, 900, 400, 1150, 445); x.stroke();
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  });
  const fotoPath = join(dir, 'firma-su-carta.jpg');
  writeFileSync(fotoPath, Buffer.from(fotoB64, 'base64'));
  await stubApri(fotoPath);
  await page.click('.sig-tab[data-tab=image]');
  await page.click(`${dlg} button:has-text("Scegli foto o scansione")`);
  await page.waitForSelector(`${dlg} .foto-wrap:not([hidden])`);
  await page.waitForTimeout(700);
  await foto('04-crea-firma-foto-pulita');
  // prima e dopo, affiancati nella finestra di Leggio
  await ok();
  await page.waitForFunction(() => window.__leggioPersonale.archivio.firme().some((f) => f.origine === 'foto'));
  await page.evaluate(async (b64) => {
    const a = window.__leggioPersonale.archivio;
    const f = a.firme().find((x) => x.origine === 'foto');
    const dopo = await a.immagine(f.blob);
    const box = document.createElement('div');
    box.id = 'prima-dopo';
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#f4f3ef);display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:90px 48px 48px;align-content:center;font:600 20px/1.3 var(--font,system-ui);color:var(--ink,#222)';
    box.innerHTML = `<div style="position:absolute;top:150px;left:48px;font-size:28px">Firma da foto: prima e dopo la pulizia automatica</div>
      <figure style="margin:0;display:grid;gap:12px;align-content:start"><figcaption>Prima: foto con il telefono</figcaption><img src="data:image/jpeg;base64,${b64}" style="width:100%;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.2)"></figure>
      <figure style="margin:0;display:grid;gap:12px;align-content:start"><figcaption>Dopo: sfondo e colore della carta tolti</figcaption><div style="background:repeating-conic-gradient(#e8e8e8 0 25%,#fff 0 50%) 0 0/18px 18px;border-radius:8px;padding:30px;display:grid;place-items:center;min-height:300px;box-shadow:0 2px 8px rgba(0,0,0,.2)"><img src="${dopo}" style="max-width:100%"></div></figure>`;
    document.body.append(box);
  }, fotoB64);
  await foto('05-firma-foto-prima-e-dopo');
  await page.evaluate(() => document.getElementById('prima-dopo')?.remove());
  await page.evaluate(() => { document.querySelector('.av-pane .av-pane-head .btn:last-child')?.click(); });

  // ---------------------------------------------------------------- 3. sigla tutte le pagine, luogo data e firma
  console.log('3. sigla tutte le pagine, luogo-data-firma');
  // una firma disegnata e una sigla scritta, mie
  await page.evaluate(async () => {
    const a = window.__leggioPersonale.archivio;
    const tela = (testo, size, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#1d3f9a'; x.font = `${size}px "Leggio Great Vibes"`; x.textBaseline = 'middle'; x.fillText(testo, 20, h / 2); return c.toDataURL('image/png'); };
    await a.aggiungiFirma({ nome: 'La mia firma', tipo: 'firma', immagine: tela('Giovanna Ferri', 110, 760, 200), w: 760, h: 200, origine: 'scritta' });
    await a.aggiungiFirma({ nome: 'La mia sigla', tipo: 'sigla', immagine: tela('G.F.', 110, 230, 180), w: 230, h: 180, origine: 'scritta' });
  });
  const conv = join(dir, 'Convenzione-servizio-civico.pdf');
  writeFileSync(conv, await documento('Convenzione per il servizio civico', 3));
  await apriFile(conv, 'Convenzione-servizio-civico.pdf');
  await page.evaluate(() => window.__leggio.tools.run('fill-sign'));
  await page.waitForTimeout(600);
  let attesa = page.evaluate(() => window.__leggioModuli.session.siglaTutte());
  await page.waitForSelector(`${dlg} h2:has-text("Sigla tutte")`);
  await foto('06-sigla-tutte-le-pagine-scelta');
  await page.click(`${dlg} input[value="tranne-ultima"]`);
  await ok(); await attesa;
  // ultima pagina, in basso: luogo, data e firma
  await page.evaluate(() => { const v = window.__leggio.viewer; v.pdfViewer.currentPageNumber = 3; });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const c = window.__leggio.viewer.container; c.scrollTop += c.clientHeight * 0.55; });
  await page.waitForTimeout(500);
  attesa = page.evaluate(() => window.__leggioModuli.session.luogoDataFirma());
  await page.waitForSelector(`${dlg} h2:has-text("Luogo, data e firma")`);
  await page.selectOption(`${dlg} select >> nth=1`, 'Letto, confermato e sottoscritto');
  await foto('07-luogo-data-firma-scelta');
  await ok(); await attesa;
  await page.evaluate(() => window.__leggioModuli.session.applyNow());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__leggio.tools.deactivate());
  await page.evaluate(() => { const v = window.__leggio.viewer; v.pdfViewer.currentScaleValue = 'page-fit'; });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const v = window.__leggio.viewer; v.pdfViewer.currentPageNumber = 3; });
  await page.waitForTimeout(900);
  await foto('08-luogo-data-firma-applicato');
  await page.evaluate(() => { const v = window.__leggio.viewer; v.pdfViewer.currentPageNumber = 2; });
  await page.waitForTimeout(900);
  await foto('09-sigla-su-ogni-pagina');

  // ---------------------------------------------------------------- 4. timbri
  console.log('4. timbri');
  await page.evaluate(() => { const v = window.__leggio.viewer; v.pdfViewer.currentScaleValue = 'auto'; v.pdfViewer.currentPageNumber = 1; });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__leggio.tools.run('fill-sign'));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__leggioModuli.session.timbroMenu(document.querySelector('button[data-azione=altro]')));
  await page.waitForTimeout(500);
  await foto('10-timbri-modelli');
  await page.click('.ctx-menu button:has-text("Ricevuto il")');
  await page.waitForSelector(`${dlg} h2:has-text("Ricevuto il")`);
  await page.fill(`${dlg} input[type=range]`, '-6').catch(() => {});
  await ok();
  await page.waitForTimeout(600);
  // in alto a destra, come si timbra la posta in arrivo
  await page.evaluate(() => {
    const s = window.__leggioModuli.session; const it = s.board.selected; if (!it) return;
    const w = it.rect[2] - it.rect[0]; const h = it.rect[3] - it.rect[1];
    it.rect = [595 - 50 - w, 842 - 40 - h, 595 - 50, 842 - 40]; s.board.drawPage(it.pageIndex); s.board.select(null);
  });
  await page.evaluate(() => window.__leggioModuli.session.applyNow());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__leggio.tools.deactivate());
  await page.evaluate(() => { window.__leggio.viewer.container.scrollTop = 0; });
  await page.waitForTimeout(700);
  await foto('11-timbro-ricevuto-il');
  // timbro dell'ente
  await page.evaluate(() => window.__leggio.tools.run('fill-sign'));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__leggioModuli.session.quickMenu(document.querySelector('button[data-azione=altro]')));
  await page.click('.ctx-menu button:has-text("Crea il timbro")');
  await page.waitForSelector(`${dlg} h2:has-text("Timbro dell")`);
  await page.fill('.tim-form input[type=text]', 'ASSOCIAZIONE ESEMPIO DI VALBRUNA • ODV');
  await page.fill('.tim-form textarea', 'SEGRETERIA');
  await page.waitForTimeout(400);
  await foto('12-timbro-ente');
  await ok(); await page.waitForTimeout(500);
  await chiudiDialoghi();
  await page.evaluate(() => window.__leggio.tools.deactivate());
  await page.waitForTimeout(300);
  await chiudiDoc();

  // ---------------------------------------------------------------- 5. rubrica
  console.log('5. rubrica');
  await page.evaluate(() => window.__leggioPersonale.apriRubrica());
  await page.waitForSelector('.rub-lista .rub-riga');
  await page.waitForTimeout(400);
  await foto('13-rubrica-elenco-gruppi');
  // scheda di Paolo (codice fiscale e IBAN sbagliati, email non PEC)
  await page.fill('.rub-ricerca input, input.rub-ricerca', 'bonetti').catch(async () => { await page.keyboard.type('bonetti'); });
  await page.waitForTimeout(400);
  await page.click('.rub-lista .rub-riga >> nth=0');
  await page.waitForTimeout(500);
  await foto('14-rubrica-scheda-avvisi');
  await page.dblclick('.rub-lista .rub-riga >> nth=0');
  await page.waitForSelector(dlg);
  await page.waitForTimeout(400);
  await foto('15-rubrica-modifica-validazioni');
  await chiudiDialoghi();
  // import da CSV
  const csv = join(dir, 'iscritti-corso.csv');
  writeFileSync(csv, '﻿Nome;Cognome;C.F.;E-mail;Cellulare;Comune;Gruppo\r\n' + ['Laura;Rinaldi', 'Marco;Vitale', 'Anna;Ruggeri', 'Luca;Ferrara', 'Sofia;Leone', 'Giorgio;Longo'].map((n, i) => `${n};;${n.split(';')[0].toLowerCase()}@esempio.it;34${i} 1234567;Valbruna;corso 2027`).join('\r\n'));
  await stubApri(csv);
  await page.click('.av-pane button:has-text("Importa")');
  await page.waitForSelector(`${dlg} select`, { timeout: 15000 });
  await page.waitForTimeout(500);
  await foto('16-rubrica-import-csv-colonne');
  await chiudiDialoghi();
  await page.evaluate(() => { document.querySelector('.av-pane .av-pane-head .btn:last-child')?.click(); });
  // fattura elettronica
  const xml = join(dir, 'IT' + pivaForn + '_00042.xml');
  writeFileSync(xml, FATTURA(pivaForn, pivaAss));
  await stubApri(xml);
  await page.evaluate(() => window.__leggio.openDialog());
  await page.waitForTimeout(3500);
  const proposta = await page.$('text=Salva in rubrica');
  if (proposta) await proposta.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await foto('17-fattura-salva-in-rubrica');
  await chiudiDialoghi();
  while (await page.evaluate(() => window.__leggio.docs.length)) await chiudiDoc();
  await page.evaluate(() => { document.querySelector('.av-pane .av-pane-head .btn:last-child')?.click(); });

  // ---------------------------------------------------------------- 6. compila a nome di
  console.log('6. compila a nome di');
  const mod = join(dir, 'Richiesta-rimborso-volontari.pdf');
  writeFileSync(mod, await moduloRimborso());
  await apriFile(mod, 'Richiesta-rimborso-volontari.pdf');
  attesa = page.evaluate(() => window.__leggio.tools.run('autofill-profile'));
  await page.waitForSelector(`${dlg} input`);
  await page.keyboard.type('galli'); await page.waitForTimeout(400);
  await foto('18-compila-a-nome-di-scelta');
  await page.keyboard.press('Enter');
  await page.waitForSelector(`${dlg} .mod-autofill`);
  await page.waitForTimeout(400);
  await foto('19-compila-a-nome-di-anteprima');
  await ok(); await attesa; await page.waitForTimeout(1200);
  await foto('20-compila-a-nome-di-compilato');

  // ---------------------------------------------------------------- 7. serie
  console.log('7. compilazione in serie');
  await page.evaluate(async (pivaAss) => {
    const a = window.__leggioPersonale.archivio;
    const N = ['Alice', 'Bruno', 'Carla', 'Dario', 'Ester', 'Filippo', 'Greta', 'Ivo', 'Luisa', 'Mauro']; const C = ['Albani', 'Berti', 'Conti', 'Dini', 'Esposti', 'Fini', 'Grandi', 'Lodi', 'Marchi', 'Nardi', 'Olmi', 'Parri', 'Quaranta', 'Ruini', 'Sarti', 'Tosi', 'Ugolini', 'Valli', 'Zanetti', 'Bassi'];
    const lista = [];
    for (let i = 0; i < 200; i++) {
      const cf = window.__cfFinto(i);
      lista.push({ id: 'serie-esempio-' + i, nome: N[i % 10], cognome: C[Math.floor(i / 10)], codiceFiscale: i === 6 || i === 57 ? cf.slice(0, 15) + (cf[15] === 'A' ? 'B' : 'A') : cf, dataNascita: i === 23 ? '' : `${String(1 + (i % 28)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/19${70 + (i % 25)}`, email: `volontario${i + 1}@esempio.it`, citta: 'Valbruna', cap: '59100', indirizzo: `Via dei Tigli ${i + 1}`, iban: 'IT60X0542811101000000123456', gruppi: ['volontari 2027'] });
    }
    a.salvaContatti(lista); await a.salvaOra();
  }, pivaAss);
  await chiudiDialoghi();
  await page.evaluate(() => { window.__leggio.tools.run('mail-merge'); });
  await page.waitForSelector('.serie-dlg');
  await page.locator('.serie-dlg .dlg-foot button', { hasText: 'Avanti' }).click();
  await page.waitForSelector('.serie-dlg input[value="gruppo"]');
  await page.click('.serie-dlg input[value="gruppo"]').catch(() => {});
  const sel = await page.$('.serie-dlg select');
  if (sel) { const opts = await sel.$$eval('option', (os) => os.map((o) => [o.value, o.textContent])); const v = opts.find(([, t]) => /volontari 2027/.test(t)); if (v) await sel.selectOption(v[0]); }
  await page.waitForTimeout(400);
  await foto('21-serie-dati');
  await page.locator('.serie-dlg .dlg-foot button', { hasText: 'Avanti' }).click();
  await page.waitForSelector('.serie-anteprima-pagina canvas', { timeout: 20000 });
  await page.waitForTimeout(800);
  await foto('22-serie-corrispondenze-anteprima');
  await page.locator('.serie-dlg .dlg-foot button', { hasText: 'Avanti' }).click();
  await page.waitForSelector('.serie-dlg .serie-segnaposto');
  await page.waitForTimeout(300);
  await foto('23-serie-opzioni');
  const uscita = join(dir, 'uscita'); mkdirSync(uscita);
  await stubApri(uscita);
  await page.locator('.serie-dlg .dlg-foot button', { hasText: /^Genera/ }).click();
  let presa = false;
  for (let i = 0; i < 600; i++) {
    const s = await page.evaluate(() => ({ prog: !!document.querySelector('.progress-dlg'), testo: document.querySelector('.progress-text')?.textContent || '', fine: [...document.querySelectorAll('#overlay-root .dlg h2')].some((h) => /Compilazione in serie (completata|interrotta)/.test(h.textContent)) }));
    if (s.prog && !presa && Number((s.testo.match(/^(\d+) di/) || [])[1]) >= 60) { presa = true; await page.screenshot({ path: join(OUT, '24-serie-avanzamento.png') }); fatte.push(join(OUT, '24-serie-avanzamento.png')); console.log('   24-serie-avanzamento'); }
    if (s.fine) break;
    await page.waitForTimeout(5);
  }
  await foto('25-serie-riepilogo');
  await chiudiDialoghi();
  await chiudiDoc();

  // ---------------------------------------------------------------- 8. registro delle firme
  console.log('8. registro');
  await page.evaluate(async () => {
    const a = window.__leggioPersonale.archivio;
    const tela = (testo) => { const c = document.createElement('canvas'); c.width = 700; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#111'; x.font = '100px "Leggio Dancing Script"'; x.textBaseline = 'middle'; x.fillText(testo, 20, 100); return c.toDataURL('image/png'); };
    const p = a.contatti().find((c) => c.nome === 'Paolo'); const e = a.contatti().find((c) => c.nome === 'Elena');
    const fp = await a.aggiungiFirma({ nome: 'Firma del presidente', proprietario: p.id, immagine: tela('Paolo Bonetti'), w: 700, h: 200 });
    const fe = await a.aggiungiFirma({ nome: 'Sigla della tesoriera', tipo: 'sigla', proprietario: e.id, immagine: tela('E.B.'), w: 300, h: 200 });
    a.registra({ firma: fp, documento: 'Verbale-assemblea-ottobre.pdf', pagine: '4' });
    a.registra({ firma: fe, documento: 'Rendiconto-2026.pdf', pagine: '1, 2, 3, 4, 5, 6' });
    a.registra({ firma: fp, documento: 'Lettera-al-Comune.pdf', pagine: '1' });
    await a.salvaOra();
  });
  await page.evaluate(() => window.__leggio.tools.run('signatures-log'));
  await page.waitForSelector('.pers-log');
  await foto('26-registro-delle-firme');
  await page.click('.pers-nav-btn:has-text("Cosa c")');
  await foto('27-archivio-cosa-c-e');
  await page.click('.pers-nav-btn:has-text("Firme e sigle")');
  await page.waitForTimeout(600);
  await foto('28-archivio-firme-e-sigle');
} catch (err) {
  console.error('ERRORE:', err);
  await page.screenshot({ path: join(dir, 'errore.png') }).catch(() => {});
  console.error('schermata dell\'errore:', join(dir, 'errore.png'));
  process.exitCode = 1;
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.destroy()).catch(() => {});
  try { app.process().kill('SIGKILL'); } catch { /* */ }
}
console.log(`\n${fatte.length} schermate in ${OUT}`);
