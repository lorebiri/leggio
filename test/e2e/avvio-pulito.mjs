// Collaudo nell'app vera dell'AVVIO PULITO (Playwright + Electron), casi a–d e opzione «riapri».
// Prima: npm ci && npx vite build. Avvio (Linux senza schermo): xvfb-run -a node test/e2e/avvio-pulito.mjs
// Ogni prova usa una cartella dati nuova (LEGGIO_USER_DATA) e copie dei PDF di prova.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { preparaCartella, avvia, chiudi, uccidi, stato, apri, chiudiDoc, impostazione, registro } from './avvio-comune.mjs';

const R = registro();
const nome = (p) => (p ? p.split(/[\\/]/).pop() : p);
const nomi = (s) => s.docs.map(nome);
const cartelle = [];
const nuova = () => { const c = preparaCartella(); cartelle.push(c.dir); return c; };

// (a) l'utente chiude il documento (o la scheda) e poi l'app
{
  const c = nuova();
  let s = await avvia(c.dati);
  await apri(s, c.A); await apri(s, c.B);
  await chiudiDoc(s, c.A); // scheda non attiva, chiusa e subito dopo l'app: nella 0.2.1 ricompariva
  await chiudi(s);
  s = await avvia(c.dati);
  let st = await stato(s);
  R.ok('(a) chiusa una scheda e subito l\'app: all\'avvio schermata iniziale, nessun documento', st.home && st.docs.length === 0 && !st.dialoghi.length, st);
  R.ok('(a) i recenti sono in vista', st.recenti.includes(c.A) && st.recenti.includes(c.B), st.recenti);
  await chiudi(s);
  // anche con l'opzione «riapri» attiva il documento chiuso non torna
  s = await avvia(c.dati);
  await impostazione(s, 'avanzati.reopenAtStartup', true);
  await apri(s, c.A); await apri(s, c.B); await chiudiDoc(s, c.A);
  await chiudi(s);
  s = await avvia(c.dati);
  st = await stato(s);
  R.ok('(a) con «riapri» attivo: torna solo il documento lasciato aperto, mai quello chiuso', JSON.stringify(nomi(st)) === '["fattura.pdf"]', st);
  await chiudi(s);
}

// (b) l'utente chiude l'app con il documento ancora aperto
{
  const c = nuova();
  let s = await avvia(c.dati);
  await apri(s, c.A);
  await s.page.evaluate(() => { window.__leggio.viewer.scaleValue = '1.5'; });
  await s.page.waitForTimeout(300);
  await s.page.evaluate(() => { window.__leggio.viewer.page = 4; });
  await s.page.waitForTimeout(1200);
  await chiudi(s);
  s = await avvia(c.dati);
  let st = await stato(s);
  R.ok('(b) app chiusa con il documento aperto: all\'avvio nessun documento riaperto da solo', st.home && st.docs.length === 0 && !st.dialoghi.length, st);
  R.ok('(b) pulsante «Riapri l\'ultimo documento» con il nome del file', /Riapri l'ultimo documento/.test(st.riapri || '') && /contratto\.pdf/.test(st.riapri || ''), st.riapri);
  await s.page.click('.home [data-azione="riapri-ultimo"]');
  await s.page.waitForTimeout(1500);
  st = await stato(s);
  R.ok('(b) «Riapri l\'ultimo documento» apre il file alla pagina e allo zoom di prima', st.attivo === c.A && st.pagina === 4 && String(st.zoom) === '1.5', st);
  // riaperto dai recenti dopo averlo chiuso: stessa posizione
  await s.page.evaluate(() => { window.__leggio.viewer.page = 2; });
  await s.page.waitForTimeout(1200);
  await chiudiDoc(s, c.A);
  await s.page.waitForTimeout(300);
  await s.page.click(`.home .recent-item:has(small:text-is("${c.A}"))`);
  await s.page.waitForTimeout(1500);
  st = await stato(s);
  R.ok('(b) riaperto dai recenti torna alla pagina dove era stato chiuso', st.attivo === c.A && st.pagina === 2, st);
  await chiudi(s);
  // con l'opzione attiva torna il comportamento di prima
  s = await avvia(c.dati);
  await impostazione(s, 'avanzati.reopenAtStartup', true);
  await apri(s, c.A);
  await chiudi(s);
  s = await avvia(c.dati);
  st = await stato(s);
  R.ok('(b) con «riapri» attivo: il documento lasciato aperto si riapre', JSON.stringify(nomi(st)) === '["contratto.pdf"]' && !st.dialoghi.length, st);
  await chiudi(s);
}

// (c) Leggio aperto con doppio clic su un altro PDF
{
  const c = nuova();
  let s = await avvia(c.dati);
  await apri(s, c.A);
  await chiudi(s);
  s = await avvia(c.dati, [c.C]);
  let st = await stato(s);
  R.ok('(c) doppio clic su un altro PDF: si apre solo quel file', JSON.stringify(nomi(st)) === '["doppio-clic.pdf"]' && st.attivo === c.C, st);
  await impostazione(s, 'avanzati.reopenAtStartup', true);
  await apri(s, c.A);
  await chiudi(s);
  s = await avvia(c.dati, [c.C]);
  st = await stato(s);
  R.ok('(c) anche con «riapri» attivo il doppio clic apre solo quel file', JSON.stringify(nomi(st)) === '["doppio-clic.pdf"]' && st.attivo === c.C, st);
  await chiudi(s);
}

// (d) crash o chiusura forzata
{
  const c = nuova();
  let s = await avvia(c.dati);
  await apri(s, c.A); await apri(s, c.B); await apri(s, c.C);
  await chiudiDoc(s, c.C); // chiuso prima del crash: non deve essere proposto
  // modifica non salvata su B, copiata nel recupero automatico
  await s.page.evaluate(async () => { const a = window.__leggio; await a.editWithPdfLib('Ruota', async (p, L) => { p.getPage(0).setRotation(L.degrees(90)); }); await a.recovery.snapshot(a.activeDoc); });
  await s.page.waitForTimeout(500);
  await uccidi(s);
  s = await avvia(c.dati);
  let st = await stato(s);
  R.ok('(d) dopo il crash nessun documento si riapre da solo', st.docs.length === 0, st);
  R.ok('(d) domanda «Sessione interrotta» con i documenti aperti al momento del crash', st.dialoghi.includes('Sessione interrotta') && /ripristinare i 2 documenti/.test(st.testoDialogo) && /contratto\.pdf/.test(st.testoDialogo) && /fattura\.pdf/.test(st.testoDialogo), st);
  R.ok('(d) il documento chiuso prima del crash non è proposto', !/doppio-clic\.pdf/.test(st.testoDialogo), st.testoDialogo);
  R.ok('(d) la bozza con le modifiche non salvate è indicata', /modifiche non salvate/.test(st.testoDialogo), st.testoDialogo);
  await s.page.click('#overlay-root .dlg button[type=submit]');
  await s.page.waitForTimeout(2500);
  st = await stato(s);
  R.ok('(d) «Ripristina» riapre i due documenti, quello modificato come da salvare', st.docs.length === 2 && st.docs.includes(c.A) && st.docs.includes(c.B) && JSON.stringify(st.sporchi) === JSON.stringify([c.B]), st);
  await uccidi(s);
  // «Non ora»: niente si apre, la bozza resta per il menu Aiuto
  s = await avvia(c.dati);
  st = await stato(s);
  R.ok('(d) dopo un secondo crash la domanda torna (i documenti erano di nuovo aperti)', st.dialoghi.includes('Sessione interrotta'), st);
  await s.page.click('#overlay-root .dlg input[value=later]');
  await s.page.click('#overlay-root .dlg button[type=submit]');
  await s.page.waitForTimeout(800);
  st = await stato(s);
  R.ok('(d) «Non ora»: schermata iniziale, nessun documento', st.home && st.docs.length === 0, st);
  const bozze = await s.page.evaluate(async () => (await window.__leggio.recovery.backend.list()).length);
  R.ok('(d) «Non ora»: la bozza resta nel recupero automatico', bozze >= 1, bozze);
  await chiudi(s);
  s = await avvia(c.dati);
  st = await stato(s);
  R.ok('(d) dopo una chiusura regolare non c\'è più la domanda sulla sessione', !st.dialoghi.includes('Sessione interrotta'), st);
  await uccidi(s);
}

// migrazione dalla 0.2.x: vecchia sessione e vecchio interruttore attivo nelle impostazioni
{
  const c = nuova();
  let s = await avvia(c.dati);
  await apri(s, c.A); await apri(s, c.B); // finiscono fra i recenti
  await s.page.evaluate(([a, b]) => {
    const d = JSON.parse(localStorage.getItem('leggio.settings.v1') || '{}');
    d['avanzati.session'] = { docs: [{ path: a, page: 3 }, { path: b, page: 1 }], active: a, at: Date.now() };
    d['avanzati.restoreSession'] = true;
    localStorage.setItem('leggio.settings.v1', JSON.stringify(d));
  }, [c.A, c.B]);
  // la 0.2 non aveva il file di sessione: lo si toglie e si chiude senza passare dalla logica nuova
  rmSync(join(c.dati, 'sessione.json'), { force: true });
  await s.page.evaluate(() => window.leggio.invoke('app:confirm-close'));
  await new Promise((r) => s.app.once('close', r));
  s = await avvia(c.dati);
  const st = await stato(s);
  R.ok('migrazione 0.2: niente riapertura automatica', st.home && st.docs.length === 0 && !st.dialoghi.length, st);
  R.ok('migrazione 0.2: recenti conservati', st.recenti.includes(c.A) && st.recenti.includes(c.B), st.recenti);
  R.ok('migrazione 0.2: «Riapri l\'ultimo documento» propone il documento attivo della vecchia sessione', /contratto\.pdf/.test(st.riapri || ''), st.riapri);
  const imp = await s.page.evaluate(() => JSON.parse(localStorage.getItem('leggio.settings.v1')));
  R.ok('migrazione 0.2: vecchie chiavi tolte, opzione nuova non attiva', !('avanzati.session' in imp) && !('avanzati.restoreSession' in imp) && imp['avanzati.reopenAtStartup'] !== true, imp);
  await chiudi(s);
}

for (const d of cartelle) rmSync(d, { recursive: true, force: true });
process.exit(R.fine() ? 1 : 0);
