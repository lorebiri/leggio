"""Ricerca nell'archivio: richieste parafrasate → documento giusto tra i 20 del banco.

Ogni documento è diviso in passaggi; il punteggio di un documento è quello del suo passaggio migliore.
Confronto: BM25 (parole), embedding, ibrido (fusione dei ranghi). Misure: recall@1, recall@3, MRR.
Uso: python3 script/archivio.py [modelli...] → risultati/archivio.json
"""
import json
import sys

import numpy as np

from comune import BANCO, MODELLI, RISULTATI, Server, carica_documenti, pezzi_per_rag
from embedding import MODELLI_EMB, bm25

PREFISSI = dict(MODELLI_EMB)
PREFISSI["multilingual-e5-small-q8_0-twinsuns.gguf"] = ("query: ", "passage: ")
PREFISSI.setdefault("granite-embedding-107m-multilingual-Q8_0.gguf", ("", ""))
PREFISSI["Qwen3-Embedding-0.6B-Q8_0.gguf"] = ("Instruct: Data una richiesta di ricerca, trova il documento d'ufficio pertinente\nQuery: ", "")


def misure(ranghi):
    r = np.array(ranghi)
    return {"recall@1": round(100 * np.mean(r == 0), 1), "recall@3": round(100 * np.mean(r < 3), 1),
            "MRR": round(float(np.mean(1 / (r + 1))), 3)}


def rango_doc(punteggi, doc_di, giusto):
    migliore = {}
    for s, d in zip(punteggi, doc_di):
        migliore[d] = max(migliore.get(d, -1e9), s)
    ordine = sorted(migliore, key=lambda d: -migliore[d])
    return ordine.index(giusto)


def main():
    docs = carica_documenti()
    rich = json.loads((BANCO / "ricerca-archivio.json").read_text())["richieste"]
    pz, doc_di = [], []
    for d in docs:
        for p in pezzi_per_rag(d["pagine"]):
            pz.append(p); doc_di.append(d["id"])
    res = {}
    rb = [rango_doc(bm25(pz, r["q"]), doc_di, r["doc"]) for r in rich]
    res["BM25"] = misure(rb)
    for m in sys.argv[1:] or PREFISSI:
        pq, pp = PREFISSI[m]
        with Server(MODELLI / m, porta=8092, ctx=8192, embedding=True) as s:
            V = np.array(s.embed([pp + p["testo"] for p in pz]))
            V /= np.linalg.norm(V, axis=1, keepdims=True)
            re_, ri = [], []
            for r in rich:
                q = np.array(s.embed([pq + r["q"]])[0])
                sim = V @ (q / np.linalg.norm(q))
                re_.append(rango_doc(sim, doc_di, r["doc"]))
                a = np.argsort(np.argsort(-sim)); b = np.argsort(np.argsort(-bm25(pz, r["q"])))
                ri.append(rango_doc(1 / (60 + a) + 1 / (60 + b), doc_di, r["doc"]))
        res[m] = misure(re_)
        res[m + " + BM25 (ibrido)"] = misure(ri)
        print(m, res[m], res[m + " + BM25 (ibrido)"], flush=True)
    res["_info"] = {"richieste": len(rich), "passaggi": len(pz), "documenti": len(docs)}
    (RISULTATI / "archivio.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
