"""Genera le tabelle in markdown per il rapporto (risultati/tabelle.md) da tutti i risultati misurati."""
import json

from comune import RISULTATI

NOMI = {
    "gemma-4-E2B-it-Q4_K_M": "Gemma 4 E2B",
    "Qwen3.5-4B-Q4_K_M": "Qwen3.5-4B",
    "Qwen3.5-2B-Q4_K_M": "Qwen3.5-2B",
    "Ministral-3-3B-Instruct-2512-Q4_K_M": "Ministral 3 3B",
    "granite-4.1-3b-Q4_K_M": "Granite 4.1 3B",
    "Velvet-2B-Q4_K_M": "Velvet-2B (italiano)",
    "Qwen3.5-0.8B-Q4_K_M": "Qwen3.5-0.8B",
}
ORDINE = list(NOMI)


def f(x, d=0, suff=""):
    if x is None:
        return "—"
    return (f"{x:.{d}f}".replace(".", ",") + suff) if isinstance(x, (int, float)) else str(x)


def main():
    p = json.loads((RISULTATI / "punteggi.json").read_text())
    vel = {json.loads(l)["modello"].replace(".gguf", ""): json.loads(l) for l in open(RISULTATI / "velocita.jsonl")}
    giu = json.loads((RISULTATI / "giudizio" / "riassunti.json").read_text())
    out = []

    out.append("### Velocità e memoria (CPU, 4 thread, build AVX2)\n")
    out.append("| Modello | File | Lettura documento (tok/s) | Scrittura risposta (tok/s) | Pronto a freddo | RAM di picco | Tempo medio per documento | Documento lungo (map-reduce) |")
    out.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for m in ORDINE:
        v, r = vel.get(m, {}), p.get(m, {})
        pp = v.get("pp2048") or v.get("prova_pp_ts")
        tg = v.get("tg128") or v.get("prova_tg_ts")
        out.append(f"| {NOMI[m]} | {f(v.get('file_mb', 0) / 1024, 2)} GB | {f(pp)} | {f(tg, 1)} | {f(v.get('prima_risposta_freddo_s'), 1)} s | "
                   f"{f(v.get('ram_picco_mb', 0) / 1024, 1)} GB | {f(r.get('t_doc_intero'))} s | {f(r.get('t_doc_lungo'))} s |")

    out.append("\n### Qualità sul banco di prova (20 documenti, 60 domande)\n")
    out.append("| Modello | Estrazione: campi giusti | Estrazione: valori inventati | Domande (documento intero): giuste / con pagina giusta | Domande (RAG): giuste / con pagina giusta | Riassunto: fedeltà | copertura | italiano | Riassunti con invenzioni |")
    out.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for m in ORDINE:
        r, g = p.get(m, {}), giu.get(m, {})
        out.append(f"| {NOMI[m]} | {f(r.get('estr_giusti'), 0, '%')} | {f(r.get('estr_inventati'), 0, '%')} | "
                   f"{f(r.get('qa_intero_giuste'), 0, '%')} / {f(r.get('qa_intero_giuste_con_pagina'), 0, '%')} | "
                   f"{f(r.get('qa_rag_giuste'), 0, '%')} / {f(r.get('qa_rag_giuste_con_pagina'), 0, '%')} | "
                   f"{f(g.get('fedelta'), 2)} | {f(g.get('copertura'), 2)} | {f(g.get('italiano'), 2)} | {f(100 * g.get('con_invenzioni', 0), 0, '%')} |")

    out.append("\n### Estrazione: campi giusti per tipo di dato\n")
    campi = ["oggetto", "importo", "cig", "cup", "scadenze", "controparte", "rup"]
    out.append("| Modello | " + " | ".join(c.upper() if c in ("cig", "cup", "rup") else c for c in campi) + " | JSON valido |")
    out.append("|---|" + "---:|" * (len(campi) + 1))
    for m in ORDINE:
        r = p.get(m, {})
        out.append(f"| {NOMI[m]} | " + " | ".join(f(r.get("campi", {}).get(c), 0, "%") for c in campi) + f" | {f(r.get('json_valido'), 0, '%')} |")

    out.append("\n### Tempi per singola operazione (medie)\n")
    out.append("| Modello | Estrazione | Riassunto | Domanda sul documento intero (documento già letto) | Domanda con RAG |")
    out.append("|---|---:|---:|---:|---:|")
    for m in ORDINE:
        r = p.get(m, {})
        out.append(f"| {NOMI[m]} | {f(r.get('t_estrazione'))} s | {f(r.get('t_riassunto'))} s | {f(r.get('t_qa_intero'), 1)} s | {f(r.get('t_qa_rag'), 1)} s |")

    e = json.loads((RISULTATI / "embedding.json").read_text())
    a = json.loads((RISULTATI / "archivio.json").read_text())
    out.append("\n### Modelli di embedding\n")
    out.append("| Modello | File | Passaggio giusto tra i primi 5 (domande) | idem, ibrido con BM25 | Archivio: documento giusto al 1° posto | Archivio: tra i primi 3 | Indicizzazione | RAM |")
    out.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    out.append(f"| BM25 (ricerca per parole, nessun modello) | — | {f(e['BM25 (parole, nessun modello)']['recall@5'], 0, '%')} | — | {f(a['BM25']['recall@1'], 0, '%')} | {f(a['BM25']['recall@3'], 0, '%')} | — | — |")
    for m, n in [("multilingual-e5-small-q8_0-twinsuns.gguf", "multilingual-e5-small (MIT)"),
                 ("multilingual-e5-small-Q8_0.gguf", "multilingual-e5-small, altra conversione GGUF (difettosa)"),
                 ("granite-embedding-107m-multilingual-Q8_0.gguf", "granite-embedding-107m-multilingual (Apache)"),
                 ("granite-embedding-278m-multilingual-Q8_0.gguf", "granite-embedding-278m-multilingual (Apache)"),
                 ("Qwen3-Embedding-0.6B-Q8_0.gguf", "Qwen3-Embedding-0.6B (Apache)")]:
        x, y = e.get(m, {}), a.get(m, {})
        out.append(f"| {n} | {x.get('file_mb')} MB | {f(x.get('recall@5'), 0, '%')} | {f(x.get('ibrido_recall@5'), 0, '%')} | "
                   f"{f(y.get('recall@1'), 0, '%')} | {f(y.get('recall@3'), 0, '%')} | {f(x.get('passaggi_al_s'), 1)} passaggi/s | {x.get('ram_picco_mb')} MB |")

    (RISULTATI / "tabelle.md").write_text("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
