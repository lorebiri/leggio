"""Misure di velocità, caricamento e RAM per ogni modello (CPU, 4 thread).

Uso: python3 script/velocita.py modello1.gguf [modello2.gguf ...]
- llama-bench: token/s di lettura del prompt (pp512, pp2048) e di generazione (tg128);
- tempo di caricamento a freddo (cache del disco svuotata) e a caldo, fino al server pronto,
  e a freddo fino alla prima risposta (i pesi sono letti dal disco con mmap alla prima richiesta);
- RAM di picco (VmHWM) del server dopo aver letto un prompt di ~4000 token e generato 200 token, ctx 8192, cache dei prompt in RAM disattivata (-cram 0).
Scrive risultati/velocita.jsonl.
"""
import json
import os
import subprocess
import sys
import time

from comune import LLAMA, MODELLI, RISULTATI, THREAD, Server

TESTO = ("L'Amministrazione comunale, vista la determinazione dirigenziale e richiamato il decreto legislativo "
         "31 marzo 2023, n. 36, affida il servizio di manutenzione ordinaria degli immobili per un importo "
         "complessivo di euro 39.500,00 oltre IVA. ") * 400


def svuota_cache():
    subprocess.run(["sync"])
    try:
        with open("/proc/sys/vm/drop_caches", "w") as f:
            f.write("3")
        return True
    except OSError:
        return False


def bench(path):
    out = subprocess.run([str(LLAMA / "llama-bench"), "-m", str(path), "-t", str(THREAD), "-p", "512,2048",
                          "-n", "128", "-r", "3", "-o", "json"], capture_output=True, text=True, check=True).stdout
    res = {}
    for r in json.loads(out):
        chiave = f"pp{r['n_prompt']}" if r["n_prompt"] else f"tg{r['n_gen']}"
        res[chiave] = round(r["avg_ts"], 1)
        res[chiave + "_dev"] = round(r["stddev_ts"], 1)
    return res


def main():
    for nome in sys.argv[1:]:
        path = MODELLI / nome
        riga = {"modello": nome, "file_mb": round(os.path.getsize(path) / 2**20), "thread": THREAD,
                "build": LLAMA.parent.name}
        try:
            riga.update(bench(path))
        except subprocess.CalledProcessError:
            riga["bench"] = "llama-bench non carica il file: velocità misurate dal server (vedi prova_*)"
        riga["freddo_ok"] = svuota_cache()
        t0 = time.time()
        with Server(path, ctx=8192, extra=("-cram", "0")) as s:
            riga["caricamento_freddo_s"] = round(s.caricamento_s, 2)
            s.chat([{"role": "user", "content": "Ciao"}], 1)
            riga["prima_risposta_freddo_s"] = round(time.time() - t0, 2)
        with Server(path, ctx=8192, extra=("-cram", "0")) as s:
            riga["caricamento_caldo_s"] = round(s.caricamento_s, 2)
            t0 = time.time()
            _, m = s.chat([{"role": "user", "content": TESTO[:14000] + "\nRiassumi in 5 righe."}], 200, ignore_eos=True)
            riga.update(prova_prompt_n=m["prompt_n"], prova_s=round(time.time() - t0, 1),
                        prova_pp_ts=round(m["prompt_n"] / m["prompt_ms"] * 1000, 1), prova_tg_ts=round(m["gen_n"] / m["gen_ms"] * 1000, 1))
        riga["ram_picco_mb"] = round(s.ram_mb)
        print(riga, flush=True)
        with open(RISULTATI / "velocita.jsonl", "a") as f:
            f.write(json.dumps(riga) + "\n")


if __name__ == "__main__":
    main()
