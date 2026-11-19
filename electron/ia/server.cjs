// Assistente IA — processi del motore (llama-server di llama.cpp) separati dall'app.
// Due processi al massimo: uno per le risposte ("chat") e uno per la ricerca per significato ("embed").
// Ascoltano solo su 127.0.0.1, con una chiave casuale: nessun altro programma del PC può usarli.
// Partono alla prima richiesta e si chiudono dopo alcuni minuti di inattività, per restituire la RAM.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const INATTIVITA_MS = 5 * 60 * 1000;
const ATTESA_AVVIO_MS = 180 * 1000;

function portaLibera() {
  return new Promise((ok, ko) => {
    const s = net.createServer();
    s.unref();
    s.on('error', ko);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

/** Thread per il calcolo: lascia un processore libero per il resto del PC, al massimo 4 (oltre non conviene). */
function threadConsigliati(logici = os.cpus()?.length || 2) {
  return Math.max(1, Math.min(4, logici - 1));
}

/** Argomenti di llama-server per i due usi. */
function argomenti(tipo, { modello, porta, chiave, thread, ctx }) {
  const base = ['-m', modello, '--host', '127.0.0.1', '--port', String(porta), '--api-key', chiave,
    '-t', String(thread), '-tb', String(thread), '--no-webui', '-np', '1'];
  if (tipo === 'embed') return [...base, '--embedding', '-c', String(ctx || 8192), '-b', '8192', '-ub', '8192'];
  // contesto 8.192 token e nessuna cache dei prompt in RAM: RAM di picco misurata 4,2 GB con il modello principale
  return [...base, '--jinja', '-c', String(ctx || 8192), '-cram', '0'];
}

/** Informazioni utili dalle righe del motore: istruzioni del processore (AVX2) e libreria CPU caricata. */
function leggiSistema(testo) {
  const out = {};
  const si = /system_info:[^\n]*/.exec(testo);
  if (si) { out.systemInfo = si[0].slice(0, 400); const m = /AVX2 = (\d)/.exec(si[0]); if (m) out.avx2 = m[1] === '1'; }
  const be = /loaded CPU backend from [^\n]*?ggml-cpu-([a-z0-9_]+)\.(dll|so|dylib)/i.exec(testo);
  if (be) {
    out.varianteCpu = be[1];
    // varianti per processori senza AVX2 (llama.cpp le usa da sole: funzionano, ma molto più lente)
    if (out.avx2 === undefined) out.avx2 = !/^(x64|sse42|sandybridge|ivybridge|piledriver)$/i.test(be[1]);
  }
  if (/ggml_metal|MTL|Apple M\d/i.test(testo)) out.metal = true;
  return out;
}

// ---------- processi rimasti accesi ----------
// Se Leggio si chiude in modo anomalo (crash, processo ucciso) i figli llama-server resterebbero accesi
// occupando GB di RAM. Ogni processo avviato viene scritto in un file; all'avvio successivo quelli rimasti
// vengono chiusi, ma solo se sono davvero llama-server (controllo del nome del programma).
function leggiPid(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')).filter((x) => Number.isInteger(x?.pid)); } catch { return []; } }
function scriviPid(file, lista) { try { if (lista.length) fs.writeFileSync(file, JSON.stringify(lista)); else fs.rmSync(file, { force: true }); } catch { /* facoltativo */ } }
function registraPid(file, pid) { if (file && pid) scriviPid(file, [...leggiPid(file).filter((x) => x.pid !== pid), { pid, padre: process.pid, avvio: Date.now() }]); }
function togliPid(file, pid) { if (file && pid) scriviPid(file, leggiPid(file).filter((x) => x.pid !== pid)); }

function nomeProcesso(pid) {
  const { execFileSync } = require('node:child_process');
  try {
    if (process.platform === 'linux') return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
    if (process.platform === 'win32') return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).split(',')[0].replace(/"/g, '').trim();
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch { return ''; }
}

/** Chiude i llama-server rimasti da una sessione precedente. → quanti ne ha chiusi */
function chiudiOrfani(file) {
  let n = 0;
  const miei = [];
  for (const x of leggiPid(file)) {
    const { pid } = x;
    if (x.padre === process.pid) { miei.push(x); continue; } // avviati da questa sessione: restano
    try { process.kill(pid, 0); } catch { continue; } // non esiste più
    if (!/llama-server/i.test(path.basename(nomeProcesso(pid)))) continue; // pid riusato da un altro programma
    try { process.kill(pid); n++; } catch { /* */ }
  }
  scriviPid(file, miei);
  return n;
}

class Processo {
  constructor(tipo, { binario, log, fetchFn, spawnFn, fileRegistro, inattivitaMs, filePid }) {
    Object.assign(this, { tipo, binario, log, fetchFn, spawnFn, fileRegistro, inattivitaMs, filePid });
    this.proc = null; this.url = ''; this.chiave = ''; this.modello = ''; this.avvio = null; this.timer = null; this.sistema = {}; this.uscita = '';
  }

  attivo() { return !!this.proc && this.proc.exitCode === null && !this.proc.killed; }

  async pronto(modello, opz = {}) {
    if (this.attivo() && this.modello === modello) { this.#tocca(); return this; }
    if (this.avvio && this.modello === modello) return this.avvio;
    await this.ferma();
    this.modello = modello;
    this.avvio = this.#avvia(modello, opz).finally(() => { this.avvio = null; });
    return this.avvio;
  }

  async #avvia(modello, { thread = threadConsigliati(), ctx } = {}) {
    const porta = await portaLibera();
    this.chiave = crypto.randomBytes(24).toString('hex');
    this.url = `http://127.0.0.1:${porta}`;
    const args = argomenti(this.tipo, { modello, porta, chiave: this.chiave, thread, ctx });
    let registro = '';
    const scrivi = (d) => {
      const s = d.toString();
      if (registro.length < 200000) registro += s;
      try { fs.appendFileSync(this.fileRegistro, s); } catch { /* registro facoltativo */ }
    };
    try { fs.writeFileSync(this.fileRegistro, `--- ${new Date().toISOString()} ${path.basename(this.binario)} ${this.tipo}\n`); } catch { /* */ }
    const t0 = Date.now();
    const p = this.spawnFn(this.binario, args, { cwd: path.dirname(this.binario), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    registraPid(this.filePid, p.pid);
    p.stdout?.on('data', scrivi); p.stderr?.on('data', scrivi);
    let uscito = null;
    p.on('exit', (code, sig) => { uscito = { code, sig }; this.uscita = `codice ${code ?? sig}`; togliPid(this.filePid, p.pid); if (this.proc === p) this.proc = null; });
    p.on('error', (e) => { uscito = { code: -1, e }; this.uscita = e.message; });
    while (Date.now() - t0 < ATTESA_AVVIO_MS) {
      if (uscito) {
        const coda = registro.split('\n').filter((r) => / E |error|failed/i.test(r)).slice(-3).join(' · ');
        throw new Error(`Il motore dell'assistente si è chiuso all'avvio (${this.uscita}). ${coda}`.trim());
      }
      try {
        const r = await this.fetchFn(this.url + '/health', { headers: { Authorization: `Bearer ${this.chiave}` } });
        if (r.status === 200) break;
      } catch { /* non ancora in ascolto */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!this.attivo()) throw new Error('Il motore dell\'assistente non è partito.');
    if (Date.now() - t0 >= ATTESA_AVVIO_MS) { await this.ferma(); throw new Error('Il motore dell\'assistente non ha risposto in tempo.'); }
    this.sistema = leggiSistema(registro);
    this.caricamentoMs = Date.now() - t0;
    this.log?.('info', 'ia: motore pronto', { tipo: this.tipo, modello: path.basename(modello), ms: this.caricamentoMs, ...this.sistema });
    this.#tocca();
    return this;
  }

  #tocca() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.log?.('info', 'ia: motore fermato per inattività', { tipo: this.tipo }); this.ferma(); }, this.inattivitaMs);
    this.timer.unref?.();
  }

  async richiesta(percorso, corpo, { signal } = {}) {
    this.#tocca();
    const r = await this.fetchFn(this.url + percorso, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.chiave}` },
      body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => null);
    this.#tocca();
    if (!r.ok) throw new Error(`Il motore ha risposto con un errore (${r.status}): ${j?.error?.message || ''}`.trim());
    return j;
  }

  async ferma() {
    clearTimeout(this.timer);
    const p = this.proc;
    this.proc = null;
    if (!p || p.exitCode !== null) return;
    await new Promise((ok) => {
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } ok(); }, 5000);
      p.once('exit', () => { clearTimeout(t); ok(); });
      try { p.kill(); } catch { clearTimeout(t); ok(); }
    });
  }
}

class Motore {
  /** opz: { binario, cartellaRegistri, log, fetchFn, spawnFn, inattivitaMs } */
  constructor({ binario, cartellaRegistri, log, fetchFn = globalThis.fetch, spawnFn = spawn, inattivitaMs = INATTIVITA_MS }) {
    const comune = { binario, log, fetchFn, spawnFn, inattivitaMs, filePid: path.join(cartellaRegistri, 'processi.json') };
    this.chatP = new Processo('chat', { ...comune, fileRegistro: path.join(cartellaRegistri, 'registro-motore.txt') });
    this.embedP = new Processo('embed', { ...comune, fileRegistro: path.join(cartellaRegistri, 'registro-motore-ricerca.txt') });
  }

  /** Risposta del modello. → { testo, tempi: { promptN, promptMs, genN, genMs, cacheN }, ms } */
  async chat(modello, { messaggi, schema, maxToken = 300 }, { signal } = {}) {
    const p = await this.chatP.pronto(modello);
    const corpo = {
      messages: messaggi, max_tokens: maxToken, temperature: 0, seed: 1, cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false }, reasoning_format: 'none',
    };
    if (schema) corpo.response_format = { type: 'json_schema', json_schema: { name: 'risposta', schema } };
    const t0 = Date.now();
    const j = await p.richiesta('/v1/chat/completions', corpo, { signal });
    const testo = String(j?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const t = j?.timings || {};
    return { testo, ms: Date.now() - t0, tempi: { promptN: t.prompt_n, promptMs: t.prompt_ms, genN: t.predicted_n, genMs: t.predicted_ms, cacheN: t.cache_n } };
  }

  /** Vettori per la ricerca per significato. */
  async embed(modello, testi, { signal } = {}) {
    const p = await this.embedP.pronto(modello);
    const j = await p.richiesta('/v1/embeddings', { input: testi }, { signal });
    return (j?.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  /** Conta i token (serve per tagliare i passaggi troppo lunghi per il modello di embedding). */
  async tokens(tipo, testo) {
    const p = tipo === 'embed' ? this.embedP : this.chatP;
    if (!p.attivo()) return null;
    const j = await p.richiesta('/tokenize', { content: testo });
    return j?.tokens?.length ?? null;
  }

  stato() {
    const s = (p) => ({ attivo: p.attivo(), modello: p.modello ? path.basename(p.modello) : '', caricamentoMs: p.caricamentoMs || null, ...p.sistema });
    return { chat: s(this.chatP), embed: s(this.embedP) };
  }

  async ferma() { await Promise.all([this.chatP.ferma(), this.embedP.ferma()]); }
}

module.exports = { Motore, argomenti, leggiSistema, threadConsigliati, portaLibera, chiudiOrfani, leggiPid };
