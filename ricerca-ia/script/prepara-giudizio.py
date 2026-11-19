"""Prepara la valutazione "alla cieca" dei riassunti.

Per ogni documento raccoglie i riassunti di tutti i modelli, li mescola e li etichetta con lettere (A, B, C…):
chi valuta non sa quale modello li ha scritti. La corrispondenza lettera → modello resta in un file a parte.
Uso: python3 script/prepara-giudizio.py → risultati/giudizio/da-valutare.json + chiave.json
Dopo la valutazione: python3 script/prepara-giudizio.py --unisci → risultati/giudizio/riassunti.json
"""
import json
import random
import sys
from collections import defaultdict

from comune import RISULTATI, carica_documenti, testo_con_pagine

CARTELLA = RISULTATI / "giudizio"


def prepara():
    CARTELLA.mkdir(exist_ok=True)
    docs = {d["id"]: d for d in carica_documenti()}
    riass = defaultdict(dict)
    for f in sorted((RISULTATI / "grezzi").glob("*.jsonl")):
        for l in f.open():
            r = json.loads(l)
            if r["compito"] == "riassunto":
                riass[r["doc"]][f.stem] = r["out"]
    rnd = random.Random(42)
    da_valutare, chiave = [], {}
    for doc, per_modello in sorted(riass.items()):
        modelli = list(per_modello)
        rnd.shuffle(modelli)
        lettere = {chr(65 + i): m for i, m in enumerate(modelli)}
        chiave[doc] = lettere
        d = docs[doc]
        da_valutare.append({"doc": doc, "testo_file": f"banco/testi/{doc}.json", "riassunto_riferimento": d["riassunto"],
                            "punti_chiave": d["punti_chiave"],
                            "riassunti": {k: per_modello[m] for k, m in lettere.items()}})
    (CARTELLA / "da-valutare.json").write_text(json.dumps(da_valutare, indent=1, ensure_ascii=False))
    (CARTELLA / "chiave.json").write_text(json.dumps(chiave, indent=1))
    print(len(da_valutare), "documenti,", sum(len(x["riassunti"]) for x in da_valutare), "riassunti")


def unisci():
    chiave = json.loads((CARTELLA / "chiave.json").read_text())
    voti = json.loads((CARTELLA / "voti.json").read_text())
    per_modello = defaultdict(lambda: defaultdict(list))
    for v in voti:
        m = chiave[v["doc"]][v["lettera"]]
        for k in ("fedelta", "copertura", "italiano"):
            per_modello[m][k].append(v[k])
        per_modello[m]["invenzioni"].append(v["invenzioni"])
        per_modello[m]["con_invenzioni"].append(1 if v["invenzioni"] > 0 else 0)
    out = {m: {k: round(sum(x) / len(x), 2) for k, x in vals.items()} | {"n": len(vals["fedelta"])}
           for m, vals in per_modello.items()}
    (CARTELLA / "riassunti.json").write_text(json.dumps(out, indent=1))
    for m, r in sorted(out.items(), key=lambda x: -x[1]["fedelta"]):
        print(m.ljust(40), r)


if __name__ == "__main__":
    unisci() if "--unisci" in sys.argv else prepara()
