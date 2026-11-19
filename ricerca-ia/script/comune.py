"""Parti comuni del banco di prova: documenti, server llama.cpp, misure.

Tutto gira in locale: llama-server (llama.cpp) su CPU, 4 thread, nessuna API esterna.
"""
import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path

import requests

QUI = Path(__file__).resolve().parent
RADICE = QUI.parent
BANCO = RADICE / "banco"
RISULTATI = RADICE / "risultati"
LAVORO = Path(os.environ.get("IA_LAVORO", "/home/user/ia-lavoro"))
MODELLI = LAVORO / "modelli"
LLAMA = Path(os.environ.get("LLAMA_BIN", LAVORO / "llama.cpp" / "build-avx2" / "bin"))
THREAD = int(os.environ.get("IA_THREAD", "4"))


def carica_documenti():
    """Documenti del banco con testo (pdf.js, come Leggio) e riferimenti preparati a mano."""
    docs = []
    for rif in sorted((BANCO / "riferimenti").glob("*.json")):
        r = json.loads(rif.read_text())
        t = json.loads((BANCO / "testi" / (r["id"] + ".json")).read_text())
        r["pagine"] = t["pagine"]
        docs.append(r)
    return docs


def testo_con_pagine(pagine):
    return "\n\n".join(f"=== Pagina {p['n']} ===\n{p['testo']}" for p in pagine if p["testo"].strip())


class Server:
    """Avvia llama-server, misura il tempo di caricamento e la RAM di picco (VmHWM)."""

    def __init__(self, modello, porta=8091, ctx=16384, embedding=False, extra=()):
        self.modello = Path(modello)
        self.porta = porta
        self.url = f"http://127.0.0.1:{porta}"
        args = [str(LLAMA / "llama-server"), "-m", str(self.modello), "--port", str(porta),
                "-t", str(THREAD), "-tb", str(THREAD), "-c", str(ctx), "-np", "1", "--no-webui"]
        if embedding:
            args += ["--embedding", "-b", "8192", "-ub", "8192"]
        else:
            args += ["--jinja"]
        args += list(extra) + ([] if embedding else os.environ.get("IA_EXTRA", "").split())
        self.args = args
        (LAVORO / "log").mkdir(parents=True, exist_ok=True)
        self.log = open(LAVORO / "log" / f"server-{self.modello.stem}.log", "a")

    def __enter__(self):
        t0 = time.time()
        self.proc = subprocess.Popen(self.args, stdout=self.log, stderr=subprocess.STDOUT)
        while True:
            if self.proc.poll() is not None:
                raise RuntimeError(f"llama-server terminato: vedi log di {self.modello.name}")
            try:
                if requests.get(self.url + "/health", timeout=2).status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(0.1)
        self.caricamento_s = time.time() - t0
        return self

    def picco_ram_mb(self):
        for riga in Path(f"/proc/{self.proc.pid}/status").read_text().splitlines():
            if riga.startswith("VmHWM:"):
                return int(riga.split()[1]) / 1024
        return None

    def __exit__(self, *a):
        self.ram_mb = self.picco_ram_mb()
        self.proc.send_signal(signal.SIGINT)
        try:
            self.proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.log.close()

    def tokens(self, testo):
        r = requests.post(self.url + "/tokenize", json={"content": testo}, timeout=600)
        return len(r.json()["tokens"])

    def chat(self, messaggi, max_tokens=400, schema=None, **kw):
        corpo = {"messages": messaggi, "max_tokens": max_tokens, "temperature": 0, "seed": 1,
                 "cache_prompt": True, "chat_template_kwargs": {"enable_thinking": False},
                 "reasoning_format": "none"}
        if schema:
            corpo["response_format"] = {"type": "json_schema", "json_schema": {"name": "risposta", "schema": schema}}
        corpo.update(kw)
        t0 = time.time()
        r = requests.post(self.url + "/v1/chat/completions", json=corpo, timeout=3600)
        r.raise_for_status()
        j = r.json()
        testo = j["choices"][0]["message"].get("content") or ""
        testo = re.sub(r"<think>.*?</think>", "", testo, flags=re.S).strip()
        tm = j.get("timings", {})
        return testo, {"s": round(time.time() - t0, 2), "prompt_n": tm.get("prompt_n"), "prompt_ms": tm.get("prompt_ms"),
                       "gen_n": tm.get("predicted_n"), "gen_ms": tm.get("predicted_ms"),
                       "cache_n": tm.get("cache_n")}

    def embed(self, testi, max_tok=500):
        # I modelli piccoli (e5, granite) leggono al massimo 512 token: i passaggi troppo lunghi vengono accorciati
        corti = []
        for t in testi:
            n = self.tokens(t)
            while n > max_tok:
                t = t[: int(len(t) * max_tok / n * 0.95)]
                n = self.tokens(t)
            corti.append(t)
        r = requests.post(self.url + "/v1/embeddings", json={"input": corti}, timeout=3600)
        r.raise_for_status()
        return [d["embedding"] for d in r.json()["data"]]


def pezzi_per_rag(pagine, lung=600, sovrapp=100):
    """Divide il testo in passaggi di ~lung caratteri, ognuno con la sua pagina."""
    out = []
    for p in pagine:
        t = re.sub(r"\s+", " ", p["testo"]).strip()
        if not t:
            continue
        i = 0
        while i < len(t):
            fine = min(len(t), i + lung)
            if fine < len(t):  # taglia a fine parola
                sp = t.rfind(" ", i + lung - 80, fine)
                fine = sp if sp > i else fine
            out.append({"pagina": p["n"], "testo": t[i:fine]})
            if fine >= len(t):
                break
            i = max(fine - sovrapp, i + 1)
    return out
