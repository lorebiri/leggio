"""Banco di prova: esegue estrazione, domande con pagina e riassunto per un modello.

Uso: python3 script/valuta.py <file.gguf> [--nome NOME] [--senza-schema] [--solo id1,id2]
Scrive risultati/grezzi/<nome>.jsonl (una riga per richiesta) e risultati/grezzi/<nome>-meta.json.
I punteggi si calcolano a parte con script/punteggi.py.
"""
import argparse
import json
import time

import numpy as np

from comune import (MODELLI, RISULTATI, Server, carica_documenti, pezzi_per_rag, testo_con_pagine)

SISTEMA = ("Sei l'assistente di un ufficio pubblico italiano. Lavori solo sul documento fornito: "
           "non aggiungere informazioni che non ci sono. Rispondi in italiano corretto.")

SCHEMA_ESTRAZIONE = {
    "type": "object",
    "properties": {
        "oggetto": {"type": "string"},
        "importo": {"type": ["string", "null"]},
        "cig": {"type": ["string", "null"]},
        "cup": {"type": ["string", "null"]},
        "scadenze": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
        "controparte": {"type": ["string", "null"]},
        "rup": {"type": ["string", "null"]},
    },
    "required": ["oggetto", "importo", "cig", "cup", "scadenze", "controparte", "rup"],
}
COMPITO_ESTRAZIONE = (
    "Estrai dal documento questi dati e rispondi SOLO con un oggetto JSON:\n"
    "- oggetto: l'oggetto dell'atto in breve;\n"
    "- importo: l'importo principale in euro, scritto come nel documento (es. \"40.000,00\"), o null;\n"
    "- cig: il Codice Identificativo Gara (10 caratteri), o null;\n"
    "- cup: il Codice Unico di Progetto (15 caratteri), o null;\n"
    "- scadenze: le date di scadenza o i termini, nel formato AAAA-MM-GG (lista vuota se non ci sono);\n"
    "- controparte: la ditta, il fornitore, l'aggiudicatario o il destinatario principale, o null;\n"
    "- rup: il nome del responsabile del procedimento (RUP), o null.\n"
    "Se un dato non c'è nel documento scrivi null: non inventare.")

SCHEMA_DOMANDA = {
    "type": "object",
    "properties": {"risposta": {"type": "string"}, "pagina": {"type": ["integer", "null"]}},
    "required": ["risposta", "pagina"],
}


def compito_domanda(d):
    return (f"Domanda: {d}\nRispondi in modo breve usando solo il documento, e indica il numero della pagina "
            "(il numero dopo '=== Pagina') in cui si trova la risposta. Se la risposta non c'è, scrivi "
            "\"non presente\" e pagina null. Rispondi SOLO con un oggetto JSON {\"risposta\": ..., \"pagina\": ...}.")


COMPITO_RIASSUNTO = ("Scrivi un riassunto del documento in 5 righe (5 frasi brevi), in italiano corretto: chi, cosa, "
                     "quanto, entro quando e perché. Usa solo informazioni presenti nel documento. "
                     "Scrivi solo il riassunto, senza titoli né elenchi.")


def msg(contesto, compito):
    return [{"role": "system", "content": SISTEMA},
            {"role": "user", "content": f"DOCUMENTO:\n{contesto}\n\n---\n{compito}"}]


def json_sicuro(t):
    try:
        i, j = t.index("{"), t.rindex("}")
        return json.loads(t[i:j + 1])
    except (ValueError, json.JSONDecodeError):
        return None


def gruppi_di_pagine(srv, pagine, budget):
    """Raggruppa pagine consecutive in pezzi di al più `budget` token (per map-reduce)."""
    gruppi, cur, n = [], [], 0
    for p in pagine:
        if not p["testo"].strip():
            continue
        k = srv.tokens(p["testo"]) + 8
        if cur and n + k > budget:
            gruppi.append(cur)
            cur, n = [], 0
        cur.append(p)
        n += k
    if cur:
        gruppi.append(cur)
    return gruppi


def unisci_estrazioni(parti):
    out = {"oggetto": None, "importo": None, "cig": None, "cup": None, "scadenze": [], "controparte": None, "rup": None}
    for p in parti:
        if not p:
            continue
        for k in out:
            if k == "scadenze":
                for s in p.get("scadenze") or []:
                    if s not in out["scadenze"]:
                        out["scadenze"].append(s)
            elif not out[k] and p.get(k) not in (None, "", "null"):
                out[k] = p.get(k)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modello")
    ap.add_argument("--nome")
    ap.add_argument("--ctx", type=int, default=16384)
    ap.add_argument("--max-doc", type=int, default=10000, help="token oltre i quali si usa map-reduce")
    ap.add_argument("--pezzo", type=int, default=3500, help="token per pezzo nel map-reduce")
    ap.add_argument("--senza-schema", action="store_true")
    ap.add_argument("--embed", default="granite-embedding-278m-multilingual-Q8_0.gguf")
    ap.add_argument("--solo")
    ap.add_argument("--salta-rag", action="store_true")
    a = ap.parse_args()
    nome = a.nome or a.modello.replace(".gguf", "") + ("-senzaschema" if a.senza_schema else "")
    out_dir = RISULTATI / "grezzi"
    out_dir.mkdir(parents=True, exist_ok=True)
    docs = carica_documenti()
    if a.solo:
        docs = [d for d in docs if d["id"] in a.solo.split(",")]

    # 1) RAG: passaggi e vettori con il modello di embedding (server separato, poi chiuso)
    rag = {}
    if not a.senza_schema and not a.salta_rag:
        prefq, prefp = ("query: ", "passage: ") if "e5" in a.embed else ("", "")
        with Server(MODELLI / a.embed, porta=8092, ctx=8192, embedding=True) as es:
            for d in docs:
                pz = pezzi_per_rag(d["pagine"])
                V = np.array(es.embed([prefp + p["testo"] for p in pz]))
                V /= np.linalg.norm(V, axis=1, keepdims=True)
                Q = np.array(es.embed([prefq + q["domanda"] for q in d["domande"]]))
                Q /= np.linalg.norm(Q, axis=1, keepdims=True)
                rag[d["id"]] = [[pz[i] for i in np.argsort(-(V @ q))[:5]] for q in Q]

    f = open(out_dir / f"{nome}.jsonl", "w")

    def scrivi(**kw):
        f.write(json.dumps(kw, ensure_ascii=False) + "\n")
        f.flush()

    schema_e = None if a.senza_schema else SCHEMA_ESTRAZIONE
    schema_q = None if a.senza_schema else SCHEMA_DOMANDA
    t_inizio = time.time()
    with Server(MODELLI / a.modello, ctx=a.ctx) as srv:
        meta = {"modello": a.modello, "caricamento_s": round(srv.caricamento_s, 2), "ctx": a.ctx}
        print(f"{nome}: caricato in {srv.caricamento_s:.1f}s", flush=True)
        for d in docs:
            t_doc = time.time()
            testo = testo_con_pagine(d["pagine"])
            ntok = srv.tokens(testo)
            lungo = ntok > a.max_doc
            if not lungo:
                # Estrazione, riassunto e domande sullo stesso prefisso (il documento resta in cache)
                r, m = srv.chat(msg(testo, COMPITO_ESTRAZIONE), 400, schema_e)
                scrivi(doc=d["id"], compito="estrazione", modo="intero", out=r, json=json_sicuro(r), **m)
                r, m = srv.chat(msg(testo, COMPITO_RIASSUNTO), 400)
                scrivi(doc=d["id"], compito="riassunto", modo="intero", out=r, **m)
                for i, q in enumerate(d["domande"]):
                    r, m = srv.chat(msg(testo, compito_domanda(q["domanda"])), 150, schema_q)
                    scrivi(doc=d["id"], compito="domanda", modo="intero", q=i, out=r, json=json_sicuro(r), **m)
            else:
                # Documento lungo: map-reduce a pezzi
                gruppi = gruppi_di_pagine(srv, d["pagine"], a.pezzo)
                parti, sint, mm = [], [], []
                for g in gruppi:
                    tg = testo_con_pagine(g)
                    r, m = srv.chat(msg(tg, COMPITO_ESTRAZIONE), 400, schema_e)
                    parti.append(json_sicuro(r)); mm.append(m)
                    r, m = srv.chat(msg(tg, "Riassumi in 3 frasi questa parte del documento, solo con informazioni presenti."), 200)
                    sint.append(f"(pagine {g[0]['n']}-{g[-1]['n']}) {r}"); mm.append(m)
                somma = lambda k: sum((x.get(k) or 0) for x in mm)
                agg = {"s": round(somma("s"), 2), "prompt_n": somma("prompt_n"), "prompt_ms": somma("prompt_ms"),
                       "gen_n": somma("gen_n"), "gen_ms": somma("gen_ms"), "pezzi": len(gruppi)}
                ue = unisci_estrazioni(parti)
                scrivi(doc=d["id"], compito="estrazione", modo="map-reduce", out=json.dumps(ue, ensure_ascii=False), json=ue, **agg)
                r, m = srv.chat(msg("\n\n".join(sint), "Questi sono i riassunti delle parti di un documento. " + COMPITO_RIASSUNTO), 400)
                scrivi(doc=d["id"], compito="riassunto", modo="map-reduce", out=r, **m)
            # Domande con recupero dei passaggi (RAG): contesto piccolo, vale per tutti i documenti
            for i, q in enumerate(d["domande"]):
                if d["id"] not in rag:
                    break
                ctx_rag = "\n\n".join(f"=== Pagina {p['pagina']} ===\n{p['testo']}" for p in sorted(rag[d["id"]][i], key=lambda p: p["pagina"]))
                r, m = srv.chat(msg(ctx_rag, compito_domanda(q["domanda"])), 150, schema_q)
                scrivi(doc=d["id"], compito="domanda", modo="rag", q=i, out=r, json=json_sicuro(r),
                       pagine_recuperate=[p["pagina"] for p in rag[d["id"]][i]], **m)
            scrivi(doc=d["id"], compito="tempo_documento", token_doc=ntok, lungo=lungo, s=round(time.time() - t_doc, 1))
            print(f"  {d['id']}: {ntok} token, {'map-reduce' if lungo else 'intero'}, {time.time() - t_doc:.0f}s", flush=True)
    meta.update(ram_picco_mb=round(srv.ram_mb), totale_s=round(time.time() - t_inizio))
    (out_dir / f"{nome}-meta.json").write_text(json.dumps(meta, indent=1))
    print(meta)


if __name__ == "__main__":
    main()
