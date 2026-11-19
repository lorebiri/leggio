// Assistente IA — cosa si scarica, da dove e con quale impronta SHA-256.
// Fonti FISSE: release con tag immutabile di llama.cpp su GitHub e revisioni (commit) fissate su Hugging Face.
// Un file con impronta diversa viene rifiutato. Scelte e misure: docs/IA-FATTIBILITA.md (ramo claude/ia-fattibilita).
//
// Per aggiornare: cambiare tag/revisione, dimensione e impronta insieme, poi ripassare il banco di prova.

const TAG_MOTORE = 'b12540';
const BASE_MOTORE = `https://github.com/ggml-org/llama.cpp/releases/download/${TAG_MOTORE}/`;

/** Pacchetti del motore llama.cpp (licenza MIT) per sistema e processore. Su macOS usa Metal, altrove la CPU. */
const MOTORE = {
  'win32-x64': { file: `llama-${TAG_MOTORE}-bin-win-cpu-x64.zip`, byte: 24812775, sha256: 'a99b3f8d90956610186232815f43414967d3ded08dd509b0e5f26c9459742647' },
  'win32-arm64': { file: `llama-${TAG_MOTORE}-bin-win-cpu-arm64.zip`, byte: 12991188, sha256: '3f67da99451128e2c87048465941cd131f440d0af6297fde475314128dd2c4bc' },
  'darwin-arm64': { file: `llama-${TAG_MOTORE}-bin-macos-arm64.tar.gz`, byte: 16443903, sha256: '3cd5875903cf7f87f85f0717177e1fdcdbfb3f54163e2c2b67009d4709e7b79e' },
  'darwin-x64': { file: `llama-${TAG_MOTORE}-bin-macos-x64.tar.gz`, byte: 12221907, sha256: '70371a6f4a90d78e2a5542b06d944cb5300cc593d9a56a54fade7fd1d175accb' },
  'linux-x64': { file: `llama-${TAG_MOTORE}-bin-ubuntu-x64.tar.gz`, byte: 23010544, sha256: '804bed1f58978c3577751bd9cbdfb8c17ee23c934e5afa82be561dfed0ac18fa' },
};

const hf = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;

/** Modelli (file GGUF). `ram` = RAM di picco misurata (GB) con contesto di 8.192 token. */
const MODELLI = {
  principale: {
    nome: 'Gemma 4 E2B', autore: 'Google', licenza: 'Apache-2.0', ram: 4.2,
    descrizione: 'Il più affidabile nelle risposte: consigliato con almeno 8 GB di RAM.',
    file: 'gemma-4-E2B-it-Q4_K_M.gguf', byte: 3106738272, sha256: '740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8',
    url: hf('unsloth/gemma-4-E2B-it-GGUF', '0314792d7f1f7e229411f620751375812bb9faf2', 'gemma-4-E2B-it-Q4_K_M.gguf'),
    licenzaUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  leggero: {
    nome: 'Qwen3.5-2B', autore: 'Alibaba Qwen', licenza: 'Apache-2.0', ram: 2.0,
    descrizione: 'Più leggero (metà memoria): per i PC con poca RAM libera. Risposte un po\' meno precise.',
    file: 'Qwen3.5-2B-Q4_K_M.gguf', byte: 1280835840, sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    url: hf('unsloth/Qwen3.5-2B-GGUF', 'f6d5376be1edb4d416d56da11e5397a961aca8ae', 'Qwen3.5-2B-Q4_K_M.gguf'),
    licenzaUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  embedding: {
    nome: 'granite-embedding-107m-multilingual', autore: 'IBM', licenza: 'Apache-2.0', ram: 0.3,
    descrizione: 'Per la ricerca per significato (piccolo e veloce).',
    file: 'granite-embedding-107m-multilingual-Q8_0.gguf', byte: 121020096, sha256: '15691dfe830257f569a1e3521977351d16eac18e48e414908dc98ed9b8455e07',
    url: hf('bartowski/granite-embedding-107m-multilingual-GGUF', '52fed1c818636b7cb8c4e4e3ae73189efeb78081', 'granite-embedding-107m-multilingual-Q8_0.gguf'),
    licenzaUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
};

function motorePer(platform = process.platform, arch = process.arch) {
  const m = MOTORE[`${platform}-${arch}`];
  return m ? { ...m, url: BASE_MOTORE + m.file, tag: TAG_MOTORE, licenza: 'MIT', nome: `llama.cpp ${TAG_MOTORE}` } : null;
}

module.exports = { TAG_MOTORE, MOTORE, MODELLI, motorePer };
