"""Confronto dei modelli di embedding per la ricerca per significato (recupero dei passaggi).

Per ogni domanda del banco: i passaggi del documento (~600 caratteri, con la pagina) vengono ordinati
per somiglianza con la domanda; si conta se la pagina della risposta è tra i primi k passaggi (recall@k).
Confronto anche con BM25 (ricerca per parole, senza modelli). Misura velocità di indicizzazione e RAM.
Uso: python3 script/embedding.py → risultati/embedding.json
"""
import json
import math
import os
import re
import time
from collections import Counter

import numpy as np

from comune import MODELLI, RISULTATI, Server, carica_documenti, pezzi_per_rag

MODELLI_EMB = {
    "multilingual-e5-small-Q8_0.gguf": ("query: ", "passage: "),
    "multilingual-e5-small-q8_0-twinsuns.gguf": ("query: ", "passage: "),
    "granite-embedding-107m-multilingual-Q8_0.gguf": ("", ""),
    "granite-embedding-278m-multilingual-Q8_0.gguf": ("", ""),
    "Qwen3-Embedding-0.6B-Q8_0.gguf": ("Instruct: Dato una domanda, trova il passaggio del documento che contiene la risposta\nQuery: ", ""),
}
K = (1, 3, 5)


def tok(s):
    return re.findall(r"\w{2,}", s.lower())


def bm25(pz, q, k1=1.5, b=0.75):
    docs = [tok(p["testo"]) for p in pz]
    N, avg = len(docs), sum(map(len, docs)) / len(docs)
    df = Counter(w for d in docs for w in set(d))
    sc = []
    for d in docs:
        tf = Counter(d)
        s = 0
        for w in set(tok(q)):
            if w in tf:
                idf = math.log(1 + (N - df[w] + .5) / (df[w] + .5))
                s += idf * tf[w] * (k1 + 1) / (tf[w] + k1 * (1 - b + b * len(d) / avg))
        sc.append(s)
    return np.array(sc)


def main():
    docs = carica_documenti()
    pezzi = {d["id"]: pezzi_per_rag(d["pagine"]) for d in docs}
    n_pz = sum(map(len, pezzi.values()))
    res = {}
    hits = {k: 0 for k in K}
    n = 0
    for d in docs:
        for q in d["domande"]:
            ordine = np.argsort(-bm25(pezzi[d["id"]], q["domanda"]))
            for k in K:
                hits[k] += q["pagina"] in [pezzi[d["id"]][i]["pagina"] for i in ordine[:k]]
            n += 1
    res["BM25 (parole, nessun modello)"] = {f"recall@{k}": round(100 * hits[k] / n, 1) for k in K}
    vecchi = json.loads((RISULTATI / "embedding.json").read_text()) if (RISULTATI / "embedding.json").exists() else {}
    for m, (pq, pp) in MODELLI_EMB.items():
        if m in vecchi and "--tutti" not in __import__("sys").argv:
            res[m] = vecchi[m]
            continue
        with Server(MODELLI / m, porta=8092, ctx=8192, embedding=True) as s:
            t0 = time.time()
            V = {i: np.array(s.embed([pp + p["testo"] for p in pz])) for i, pz in pezzi.items()}
            t_idx = time.time() - t0
            hits = {k: 0 for k in K}
            hits_ibr = {k: 0 for k in K}
            t0 = time.time()
            for d in docs:
                Vd = V[d["id"]] / np.linalg.norm(V[d["id"]], axis=1, keepdims=True)
                for q in d["domande"]:
                    qv = np.array(s.embed([pq + q["domanda"]])[0])
                    sim = Vd @ (qv / np.linalg.norm(qv))
                    ordine = np.argsort(-sim)
                    # ibrido: somma dei ranghi reciproci (embedding + BM25)
                    rb = np.argsort(np.argsort(-bm25(pezzi[d["id"]], q["domanda"])))
                    re_ = np.argsort(np.argsort(-sim))
                    ibr = np.argsort(-(1 / (60 + rb) + 1 / (60 + re_)))
                    for k in K:
                        hits[k] += q["pagina"] in [pezzi[d["id"]][i]["pagina"] for i in ordine[:k]]
                        hits_ibr[k] += q["pagina"] in [pezzi[d["id"]][i]["pagina"] for i in ibr[:k]]
            t_q = (time.time() - t0) / n
        res[m] = {**{f"recall@{k}": round(100 * hits[k] / n, 1) for k in K},
                  **{f"ibrido_recall@{k}": round(100 * hits_ibr[k] / n, 1) for k in K},
                  "file_mb": round(os.path.getsize(MODELLI / m) / 2**20), "dimensioni": int(V[docs[0]["id"]].shape[1]),
                  "passaggi_al_s": round(n_pz / t_idx, 1), "ms_per_domanda": round(1000 * t_q), "ram_picco_mb": round(s.ram_mb),
                  "caricamento_s": round(s.caricamento_s, 2)}
        print(m, res[m], flush=True)
    res["_info"] = {"domande": n, "passaggi": n_pz, "documenti": len(docs)}
    (RISULTATI / "embedding.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
