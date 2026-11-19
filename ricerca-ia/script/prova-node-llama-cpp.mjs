// Prova dell'integrazione con node-llama-cpp (il motore che userebbe Leggio dentro Electron).
// Misura: caricamento, lettura di un prompt di ~3600 token, generazione, output con JSON schema.
// Uso: node script/prova-node-llama-cpp.mjs <file.gguf>   (con node-llama-cpp installato; vedi docs/IA-FATTIBILITA.md)
import fs from 'node:fs';
import path from 'node:path';
import { getLlama, LlamaChatSession } from 'node-llama-cpp';

const file = process.argv[2];
const testo = JSON.parse(fs.readFileSync(new URL('../banco/testi/02-determina-comune-verona.json', import.meta.url)))
  .pagine.map((p) => `=== Pagina ${p.n} ===\n${p.testo}`).join('\n\n');

const t0 = performance.now();
const llama = await getLlama({ gpu: false });
const model = await llama.loadModel({ modelPath: path.resolve(file) });
const t1 = performance.now();
const context = await model.createContext({ contextSize: 8192, threads: 4 });
const session = new LlamaChatSession({ contextSequence: context.getSequence(),
  systemPrompt: "Sei l'assistente di un ufficio pubblico italiano. Lavori solo sul documento fornito." });

const grammar = await llama.createGrammarForJsonSchema({
  type: 'object',
  properties: { importo: { type: 'string' }, cig: { type: 'string' }, rup: { type: 'string' } },
  required: ['importo', 'cig', 'rup'],
});
let primo = null;
const t2 = performance.now();
const risposta = await session.prompt(`DOCUMENTO:\n${testo}\n\n---\nEstrai importo dell'affidamento, CIG e responsabile del procedimento. Rispondi in JSON.`,
  { grammar, maxTokens: 120, temperature: 0, onTextChunk: () => { primo ??= performance.now(); } });
const t3 = performance.now();
const nTok = model.tokenize(testo).length;
const nOut = model.tokenize(risposta).length;
console.log(JSON.stringify({
  versione_node_llama_cpp: JSON.parse(fs.readFileSync((new URL('../node_modules/node-llama-cpp/package.json', import.meta.url)))).version,
  modello: path.basename(file), caricamento_s: +((t1 - t0) / 1000).toFixed(2),
  token_documento: nTok, lettura_prompt_s: +((primo - t2) / 1000).toFixed(1), lettura_ts: +(nTok / ((primo - t2) / 1000)).toFixed(1),
  generazione_ts: +(nOut / ((t3 - primo) / 1000)).toFixed(1), risposta: grammar.parse(risposta),
  ram_mb: Math.round(process.memoryUsage().rss / 2 ** 20),
}, null, 1));
await llama.dispose();
