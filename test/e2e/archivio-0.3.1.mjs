// Collaudo nell'app vera (Playwright + Electron) delle novità 0.3.1 dell'archivio personale.
// Va eseguito su un Linux SENZA portachiavi (es. container o CI con xvfb): è il caso dell'avviso.
//  1. archivio nuovo: avviso del portachiavi una volta, password con indicatore di robustezza, nessun avviso al riavvio;
//  2. archivio della 0.3.0 con password (test/fixtures/personale-0.3.0/file-password): sblocco con il dialogo vero,
//     password sbagliata, chiave rafforzata a N=131072;
//  3. promemoria del backup dopo la prima firma, «Non ricordarmelo più»;
//  4. chiave.json e copia rovinate: finestra di recupero, archivio messo da parte (non cancellato).
// Uso: npx vite build && xvfb-run -a node test/e2e/archivio-0.3.1.mjs
import { avvia, chiudi, preparaCartella, ROOT } from './avvio-comune.mjs';
import { cpSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let falliti = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falliti++; };
const titolo = (s) => s.page.evaluate(() => document.querySelector('.backdrop:not(.closing) .dlg h2')?.textContent || null);
const aspettaDialogo = (s, t = 15000) => s.page.waitForSelector('.backdrop:not(.closing) .dlg', { timeout: t });
const nonOra = (s) => s.page.click('.backdrop:not(.closing) .dlg .dlg-foot .btn:not(.primary):not(.pers-mai-piu)');
const ok2 = (s) => s.page.click('.backdrop:not(.closing) .dlg button[type=submit]');

try {
  console.log('1. archivio nuovo senza portachiavi');
  const c1 = preparaCartella();
  let s = await avvia(c1.dati, [], { attesa: 1000 });
  await aspettaDialogo(s);
  ok(/protezione di base/.test(await titolo(s)), 'avviso del portachiavi alla creazione');
  ok(/manca il portachiavi.*permessi del file.*password/s.test(await s.page.textContent('.dlg')), 'testo semplice: portachiavi, permessi del file, password');
  await ok2(s);
  await s.page.waitForSelector('.dlg input[type=password]');
  const pw = s.page.locator('.dlg input[type=password]').first();
  await pw.fill('password1');
  ok((await s.page.textContent('.pers-forza')).includes('Debole'), 'indicatore: «password1» è debole');
  await pw.fill('tramonto sul lago di como');
  ok((await s.page.textContent('.pers-forza')).includes('Ottima'), 'indicatore: una frase lunga è ottima');
  await s.page.locator('.dlg input[type=password]').nth(1).fill('tramonto sul lago di como');
  await ok2(s);
  await s.page.waitForFunction(async () => (await window.__leggioPersonale.archivio.stato()).password, null, { timeout: 10000 });
  ok(true, 'password impostata dall\'avviso');
  await chiudi(s);
  s = await avvia(c1.dati, [], { attesa: 4000 });
  ok(!(await titolo(s)), 'al riavvio nessun avviso');
  await chiudi(s);

  console.log('2. archivio della 0.3.0 con password');
  const c2 = preparaCartella();
  cpSync(join(ROOT, 'test/fixtures/personale-0.3.0/file-password'), join(c2.dati, 'personale'), { recursive: true });
  s = await avvia(c2.dati, [], { attesa: 2000 });
  await s.page.evaluate(() => { window.__leggio.tools.run('personal-archive'); });
  await s.page.waitForSelector('.dlg input[type=password]');
  await s.page.fill('.dlg input[type=password]', 'sbagliata');
  await ok2(s);
  await s.page.waitForFunction(() => /Password errata/.test(document.querySelector('.dlg')?.textContent || ''), null, { timeout: 10000 });
  ok(true, 'password sbagliata: «Password errata.» e si richiede');
  await s.page.fill('.dlg input[type=password]', 'password-030');
  const t0 = Date.now();
  await ok2(s);
  await s.page.waitForFunction(() => window.__leggioPersonale.archivio.aperto, null, { timeout: 15000 });
  console.log(`     sblocco con rafforzamento: ${Date.now() - t0} ms`);
  const k = JSON.parse(readFileSync(join(c2.dati, 'personale/chiave.json'), 'utf8'));
  ok(JSON.parse(Buffer.from(k.protetta.dati, 'base64').toString()).N === 131072, 'chiave rafforzata a N=131072');
  ok(readFileSync(join(c2.dati, 'personale/chiave.json.bak')).equals(readFileSync(join(c2.dati, 'personale/chiave.json'))), 'copia di riserva allineata');
  ok(await s.page.evaluate(() => window.__leggioPersonale.archivio.firme().length) === 1, 'firma della 0.3.0 presente');
  await chiudi(s);

  console.log('3. promemoria del backup');
  const c3 = preparaCartella();
  s = await avvia(c3.dati, [], { attesa: 1000 });
  await aspettaDialogo(s); await nonOra(s); // avviso del portachiavi: «Più tardi»
  await s.page.evaluate(async () => { const a = window.__leggioPersonale.archivio; await a.aggiungiFirma({ nome: 'Mia', immagine: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]) }); await a.salvaOra(); });
  await aspettaDialogo(s);
  ok(await titolo(s) === 'Fai una copia di sicurezza?', 'promemoria dopo la prima firma');
  await s.page.click('.pers-mai-piu');
  await s.page.waitForTimeout(400);
  ok(JSON.parse(await s.page.evaluate(() => localStorage.getItem('leggio.personale.promemoria.v1'))).maiPiu === true, '«Non ricordarmelo più» ricordato');
  await chiudi(s);

  console.log('4. chiave rovinata: finestra di recupero');
  writeFileSync(join(c3.dati, 'personale/chiave.json'), 'rotto'); writeFileSync(join(c3.dati, 'personale/chiave.json.bak'), 'rotto');
  s = await avvia(c3.dati, [], { attesa: 2000 });
  await s.page.evaluate(() => { window.__leggio.tools.run('personal-archive'); });
  await aspettaDialogo(s);
  ok(/chiave .* danneggiata/.test(await titolo(s)), 'messaggio chiaro sulla chiave danneggiata');
  await ok2(s);
  await s.page.waitForFunction(() => /Ripristina un backup/.test(document.querySelector('.backdrop:not(.closing) .dlg h2')?.textContent || ''), null, { timeout: 10000 });
  ok(true, 'dopo averlo messo da parte propone di importare un backup');
  const parte = readdirSync(c3.dati).find((f) => f.startsWith('personale-illeggibile-'));
  ok(!!parte && existsSync(join(c3.dati, parte, 'indice.dat')), 'archivio vecchio messo da parte, non cancellato');
  await chiudi(s).catch(() => {});
} catch (e) { console.error(e); falliti++; }

console.log(falliti ? `\n${falliti} controlli NON superati` : '\nTutti i controlli superati');
process.exit(falliti ? 1 : 0);
