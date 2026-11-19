#!/usr/bin/env bash
# Esegue in sequenza, per ogni modello candidato: download (con SHA-256), misure di velocità, banco di prova.
# I modelli stanno FUORI dal repo ($IA_LAVORO/modelli) e vengono cancellati dopo l'uso:
# al massimo 2 modelli linguistici sul disco alla volta (quello in prova + il successivo in download).
# Uso: bash script/esegui-tutto.sh  (dalla cartella ricerca-ia)
set -euo pipefail
cd "$(dirname "$0")"
LAVORO=${IA_LAVORO:-/home/user/ia-lavoro}
M=$LAVORO/modelli
mkdir -p "$M"
MODELLI=(
  "unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf"
  "unsloth/Qwen3.5-4B-GGUF/Qwen3.5-4B-Q4_K_M.gguf"
  "ibm-granite/granite-4.1-3b-GGUF/granite-4.1-3b-Q4_K_M.gguf"
  "mistralai/Ministral-3-3B-Instruct-2512-GGUF/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"
  "unsloth/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q4_K_M.gguf"
  "SistInf/Velvet-2B-GGUF/Velvet-2B-Q4_K_M.gguf"
  "unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf"
)
scarica() {
  local repo=${1%/*} file=${1##*/}
  if [ ! -f "$M/$file" ]; then
    curl -sSL --retry 4 -o "$M/$file.part" "https://huggingface.co/$repo/resolve/main/$file" && mv "$M/$file.part" "$M/$file"
  fi
  local sha; sha=$(sha256sum "$M/$file" | cut -d' ' -f1)
  grep -q "$file" ../risultati/sha256.txt 2>/dev/null || echo "$sha  $file  https://huggingface.co/$repo/resolve/main/$file" >> ../risultati/sha256.txt
}
for i in "${!MODELLI[@]}"; do
  cur=${MODELLI[$i]}; f=${cur##*/}
  scarica "$cur"
  next=${MODELLI[$((i+1))]:-}
  [ -n "$next" ] && { scarica "$next" & }
  # Velvet: il GGUF della comunità usa un pre-tokenizzatore che llama.cpp non conosce ("velvet-2b")
  # e un parametro RoPE che oltre 4.000 token produce testo senza senso: si correggono all'avvio.
  case "$f" in Velvet*) export IA_EXTRA="--override-kv tokenizer.ggml.pre=str:tekken --rope-freq-base 1000000";; *) unset IA_EXTRA;; esac
  grep -q "\"$f\"" ../risultati/velocita.jsonl 2>/dev/null || python3 velocita.py "$f"
  [ -f "../risultati/grezzi/${f%.gguf}-meta.json" ] || python3 valuta.py "$f"
  wait
  [ "${TIENI:-}" = 1 ] || rm -f "$M/$f"
done
python3 punteggi.py
