// Verifica automatica dei riferimenti del banco di prova.
// Per ogni banco/riferimenti/<id>.json controlla, sul testo estratto in banco/testi/<id>.json:
//  - formato: campi obbligatori, esattamente 3 domande, pagine valide;
//  - CIG e CUP (se non null) presenti nel testo; importo presente (anche con formato diverso: avviso);
//  - per ogni domanda, la risposta o una delle "accettabili" presente nella pagina indicata
//    (e, se non nella pagina, segnala se compare altrove nel documento).
// Il confronto normalizza spazi, maiuscole, apostrofi/virgolette tipografiche e trattini.
// Uso: node script/verifica-riferimenti.mjs [id ...]
import fs from 'node:fs';
import path from 'node:path';

const qui = path.dirname(new URL(import.meta.url).pathname);
const banco = path.join(qui, '..', 'banco');
const dirRif = path.join(banco, 'riferimenti');
const dirTesti = path.join(banco, 'testi');

const norm = (s) => String(s)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[‘’‚‛′`]/g, "'")
  .replace(/[“”„«»]/g, '"')
  .replace(/[‐-―−]/g, '-')
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
// variante senza spazi: utile quando pdf.js spezza parole o codici
const compatto = (s) => norm(s).replace(/\s+/g, '');

const contiene = (testo, ago) => {
  if (ago == null || ago === '') return false;
  return norm(testo).includes(norm(ago)) || compatto(testo).includes(compatto(ago));
};

const TIPI = ['determina', 'delibera', 'bando', 'avviso', 'contratto', 'capitolato', 'fattura', 'circolare', 'verbale'];
const CAMPI = ['oggetto', 'importo', 'importo_note', 'cig', 'cup', 'scadenze', 'controparte', 'rup'];

const soli = process.argv.slice(2);
const files = fs.readdirSync(dirRif).filter((f) => f.endsWith('.json'))
  .filter((f) => !soli.length || soli.includes(path.basename(f, '.json'))).sort();

let errori = 0, avvisi = 0, domandeTot = 0;
for (const f of files) {
  const id = path.basename(f, '.json');
  const err = [], avv = [];
  let rif, txt;
  try { rif = JSON.parse(fs.readFileSync(path.join(dirRif, f), 'utf8')); } catch (e) { err.push('JSON non valido: ' + e.message); }
  try { txt = JSON.parse(fs.readFileSync(path.join(dirTesti, id + '.json'), 'utf8')); } catch (e) { err.push('testo estratto mancante'); }
  if (rif && txt) {
    if (rif.id !== id) err.push(`id "${rif.id}" diverso dal nome file`);
    for (const k of ['url', 'fonte', 'tipo', 'data_documento', 'campi', 'domande', 'riassunto', 'punti_chiave'])
      if (!(k in rif)) err.push('manca ' + k);
    if (!TIPI.includes(rif.tipo)) err.push('tipo non valido: ' + rif.tipo);
    if (rif.data_documento && !/^\d{4}-\d{2}-\d{2}$/.test(rif.data_documento)) err.push('data_documento non ISO');
    const c = rif.campi || {};
    for (const k of CAMPI) if (!(k in c)) err.push('campi: manca ' + k);
    if (!Array.isArray(c.scadenze)) err.push('scadenze non è un array');
    else for (const d of c.scadenze) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) err.push('scadenza non ISO: ' + d);
    const tutto = txt.pagine.map((p) => p.testo).join('\n');
    for (const k of ['cig', 'cup']) {
      if (c[k] != null && !contiene(tutto, c[k])) err.push(`${k.toUpperCase()} ${c[k]} non trovato nel testo`);
    }
    if (c.rup != null && !contiene(tutto, c.rup)) avv.push(`RUP "${c.rup}" non trovato letteralmente`);
    if (c.importo != null && !contiene(tutto, c.importo)) {
      // l'importo è scritto "come lo scriverebbe un operatore": se nel PDF ha un altro formato
      // (es. 2277.62) basta che compaia la stessa sequenza di cifre
      const cifre = (s) => String(s).replace(/[^0-9]/g, '');
      const tokens = tutto.match(/\d[\d.,\s]*\d/g) || [];
      if (tokens.some((t) => cifre(t).includes(cifre(c.importo)))) avv.push(`importo ${c.importo} presente nel testo con formato diverso`);
      else err.push(`importo ${c.importo} non trovato nel testo`);
    }
    if (!Array.isArray(rif.punti_chiave) || rif.punti_chiave.length < 4 || rif.punti_chiave.length > 6) avv.push('punti_chiave: attesi 4-6');
    const doms = rif.domande || [];
    if (doms.length !== 3) err.push(`attese 3 domande, trovate ${doms.length}`);
    doms.forEach((d, i) => {
      domandeTot++;
      const pag = txt.pagine.find((p) => p.n === d.pagina);
      if (!pag) { err.push(`D${i + 1}: pagina ${d.pagina} inesistente (doc di ${txt.numPagine} pagine)`); return; }
      const cand = [d.risposta, ...(d.accettabili || [])];
      if (contiene(pag.testo, d.risposta)) return;
      const variante = (d.accettabili || []).find((a) => contiene(pag.testo, a));
      if (variante) { avv.push(`D${i + 1}: risposta parafrasata, a pag. ${d.pagina} trovata la variante "${variante}"`); return; }
      const altrove = txt.pagine.filter((p) => cand.some((a) => contiene(p.testo, a))).map((p) => p.n);
      err.push(`D${i + 1}: "${d.risposta}" non trovata a pag. ${d.pagina}` + (altrove.length ? ` (compare a pag. ${altrove.join(', ')})` : ' né altrove'));
    });
  }
  errori += err.length; avvisi += avv.length;
  console.log(`${err.length ? 'ERRORE' : 'ok    '} ${id}`);
  for (const e of err) console.log('   - ' + e);
  for (const a of avv) console.log('   ~ avviso: ' + a);
}
console.log(`\n${files.length} riferimenti, ${domandeTot} domande: ${errori} errori, ${avvisi} avvisi`);
process.exit(errori ? 1 : 0);
