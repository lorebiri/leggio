"""Calcola i punteggi automatici dai risultati grezzi.

Uso: python3 script/punteggi.py  → risultati/punteggi.json e tabella a schermo.

Criteri (dichiarati nel rapporto):
- importo: confronto numerico (12.500,00 = 12500.00 = 12.500 euro), tolleranza 1 centesimo;
- CIG, CUP: identici dopo aver tolto spazi e reso maiuscolo;
- scadenze: giusto se almeno una data del riferimento è tra quelle estratte, o se entrambe le liste sono vuote;
- controparte, RUP: giusto se compare il cognome / le parole significative del riferimento (titoli come dott., ing. ignorati);
- oggetto: giusto se l'estratto contiene almeno il 40% delle parole significative (>3 lettere) del riferimento,
  oppure se è più corto ma fedele (almeno 4 parole significative, l'80% delle quali prese dal riferimento);
- per tutti: se il riferimento è null, giusto solo se il modello risponde null.
- invenzione (estrazione): valore non null che non compare da nessuna parte nel documento
  (numeri e codici cercati nel testo; nomi cercati per cognome).
- domande: risposta giusta se contiene la risposta di riferimento o una delle varianti accettabili;
  pagina giusta se è quella del riferimento, o una pagina che contiene davvero la risposta.
- invenzione (domande e riassunti): numeri, importi, date o codici che non compaiono da nessuna parte nel documento.
"""
import json
import re
import unicodedata
from collections import defaultdict

from comune import RISULTATI, carica_documenti

TITOLI = {"dott", "dottssa", "dott.ssa", "ing", "arch", "prof", "avv", "sig", "sigra", "geom", "rag", "dr", "dssa",
          "srl", "spa", "s.r.l", "s.p.a", "ditta", "società", "societa", "studio", "il", "la", "lo", "di", "del", "della",
          "e", "dellʼ", "dell", "the"}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9,.\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def parole(s, minimo=2):
    return [w.strip(".,") for w in norm(s).split() if len(w.strip(".,")) > minimo and w.strip(".,") not in TITOLI]


def numero(s):
    """'€ 12.500,00 oltre IVA' → 12500.0 ; '2277.62' → 2277.62"""
    if s is None:
        return None
    m = re.search(r"\d[\d.\s]*(,\d+)?|\d+\.\d{1,2}\b", str(s))
    if not m:
        return None
    t = m.group(0).replace(" ", "")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d+\.\d{1,2}", t):
        pass
    else:
        t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return None


def codice(s):
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper()) or None


MESI = {m: i + 1 for i, m in enumerate(["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
                                         "settembre", "ottobre", "novembre", "dicembre"])}


def data_iso(s):
    s = str(s).strip().lower()
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}"
    m = re.search(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", s)
    if m:
        return f"{int(m[3]):04d}-{int(m[2]):02d}-{int(m[1]):02d}"
    m = re.search(r"(\d{1,2})\s+(" + "|".join(MESI) + r")\s+(\d{4})", s)
    if m:
        return f"{int(m[3]):04d}-{MESI[m[2]]:02d}-{int(m[1]):02d}"
    return None


def vuoto(v):
    return v is None or (isinstance(v, str) and norm(v) in ("", "null", "none", "non presente", "n.d.", "nd", "non indicato"))


def numeri_nel_testo(testo):
    """Insieme dei numeri (normalizzati) e dei codici presenti nel documento."""
    nums = set()
    for m in re.finditer(r"\d[\d.,]*\d|\d", testo):
        n = numero(m.group(0))
        if n is not None:
            nums.add(round(n, 2))
    date = {data_iso(m.group(0)) for m in re.finditer(r"\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[a-z]+\s+\d{4}", testo.lower())}
    codici = set(re.findall(r"[A-Z0-9]{8,}", re.sub(r"\s+", "", testo.upper())))
    return nums, date, re.sub(r"[^A-Z0-9]", "", testo.upper())


def affermazioni_non_supportate(out, testo, info):
    """Numeri (>=3 cifre), importi e date nella risposta che non compaiono nel documento."""
    nums, date, tutto = info
    sbagliati = []
    for m in re.finditer(r"\d{1,2}\s+(?:" + "|".join(MESI) + r")\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}", out.lower()):
        d = data_iso(m.group(0))
        if d and d not in date:
            sbagliati.append(m.group(0))
    senza_date = re.sub(r"\d{1,2}\s+(?:" + "|".join(MESI) + r")\s+\d{4}|\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}", " ", out.lower())
    for m in re.finditer(r"\d[\d.,]*\d", senza_date):
        g = m.group(0).strip(".,")
        if len(re.sub(r"\D", "", g)) < 3:
            continue
        n = numero(g)
        if n is not None and round(n, 2) not in nums and codice(g) not in tutto:
            sbagliati.append(g)
    return sbagliati


def valuta_campo(k, v, rif, testo_n, info):
    """→ (giusto: bool, inventato: bool)"""
    if vuoto(rif) or (k == "scadenze" and not rif):
        if k == "scadenze":
            return (not v), bool(v) and any(data_iso(x) and data_iso(x) not in info[1] for x in v)
        if vuoto(v):
            return True, False
        # ha messo un valore dove il riferimento non ne ha
        if k in ("cig", "cup"):
            return False, codice(v) not in info[2]
        if k == "importo":
            n = numero(v)
            return False, n is not None and round(n, 2) not in info[0]
        p = parole(v, 3)
        return False, bool(p) and not any(w in testo_n for w in p)
    if k == "scadenze":
        iso = {data_iso(x) for x in (v or [])} - {None}
        inv = any(d not in info[1] for d in iso)
        return bool(iso & set(rif)), inv
    if vuoto(v):
        return False, False
    if k in ("cig", "cup"):
        return codice(v) == codice(rif), codice(v) not in info[2]
    if k == "importo":
        n, r = numero(v), numero(rif)
        return (n is not None and r is not None and abs(n - r) < 0.011), (n is not None and round(n, 2) not in info[0])
    pr, pv = parole(rif, 2), norm(v)
    if k == "oggetto":
        sig = [w for w in parole(rif, 3)]
        ok = sum(w in pv for w in sig) / max(1, len(sig)) >= 0.4
        # oggetto più corto ma fedele: almeno 4 parole significative, quasi tutte prese dal riferimento
        out_sig = parole(v, 3)
        rn = norm(rif)
        if not ok and len(out_sig) >= 4:
            ok = sum(w in rn for w in out_sig) / len(out_sig) >= 0.8
        return ok, False
    if k == "rup":
        cogn = [w for w in pr if not w.isdigit()]
        ok = bool(cogn) and cogn[-1] in pv
        return ok, not any(w in testo_n for w in parole(v, 3))
    ok = sum(w in pv for w in pr) / max(1, len(pr)) >= 0.6
    return ok, bool(parole(v, 3)) and not any(w in testo_n for w in parole(v, 3))


def risposta_giusta(out, q):
    o = norm(out)
    cand = [q["risposta"]] + q.get("accettabili", [])
    for c in cand:
        c = norm(c)
        if c and c in o:
            return True
        n = numero(c)
        if n is not None and re.search(r"\d", c) and len(re.sub(r"\D", "", c)) >= 3:
            if any(numero(m.group(0)) == n for m in re.finditer(r"\d[\d.,]*\d", out)):
                return True
    return False


def pagina_giusta(pag, q, pagine):
    if pag is None:
        return False
    try:
        pag = int(pag)
    except (TypeError, ValueError):
        return False
    if pag == q["pagina"]:
        return True
    p = next((p for p in pagine if p["n"] == pag), None)
    if not p:
        return False
    t = norm(p["testo"])
    return any(norm(c) and norm(c) in t for c in [q["risposta"]] + q.get("accettabili", []))


def main():
    docs = {d["id"]: d for d in carica_documenti()}
    info = {i: numeri_nel_testo("\n".join(p["testo"] for p in d["pagine"])) for i, d in docs.items()}
    testo_n = {i: norm("\n".join(p["testo"] for p in d["pagine"])) for i, d in docs.items()}
    tabella = {}
    dettagli = {}
    for f in sorted((RISULTATI / "grezzi").glob("*.jsonl")):
        nome = f.stem
        righe = [json.loads(l) for l in f.open()]
        if not righe:
            continue
        meta_f = f.with_name(nome + "-meta.json")
        meta = json.loads(meta_f.read_text()) if meta_f.exists() else {}
        acc = defaultdict(list)
        per_campo = defaultdict(list)
        det = []
        for r in righe:
            d = docs.get(r["doc"])
            if not d:
                continue
            if r["compito"] == "estrazione":
                j = r.get("json")
                acc["json_valido"].append(j is not None)
                j = j or {}
                for k, rif in d["campi"].items():
                    if k == "importo_note":
                        continue
                    ok, inv = valuta_campo(k, j.get(k), rif, testo_n[d["id"]], info[d["id"]])
                    per_campo[k].append(ok)
                    acc["estr_giusti"].append(ok)
                    if not vuoto(j.get(k)) and j.get(k) != []:
                        acc["estr_inventati"].append(inv)
                    det.append({"doc": d["id"], "campo": k, "rif": rif, "out": j.get(k), "giusto": ok, "inventato": inv})
                acc["t_estrazione"].append(r["s"])
            elif r["compito"] == "domanda":
                q = d["domande"][r["q"]]
                j = r.get("json") or {}
                risp = str(j.get("risposta", r["out"]))
                g = risposta_giusta(risp, q)
                pg = pagina_giusta(j.get("pagina"), q, d["pagine"])
                astenuto = "non presente" in norm(risp)
                inv = affermazioni_non_supportate(risp, None, info[d["id"]])
                acc[f"qa_{r['modo']}_giuste"].append(g)
                acc[f"qa_{r['modo']}_giuste_con_pagina"].append(g and pg)
                acc[f"qa_{r['modo']}_astensioni"].append(astenuto)
                acc[f"qa_{r['modo']}_inventate"].append(bool(inv))
                acc[f"t_qa_{r['modo']}"].append(r["s"])
                if r["modo"] == "rag":
                    acc["rag_pagina_recuperata"].append(q["pagina"] in r.get("pagine_recuperate", []))
                det.append({"doc": d["id"], "q": r["q"], "modo": r["modo"], "rif": q["risposta"], "pag_rif": q["pagina"],
                            "out": risp, "pagina": j.get("pagina"), "giusta": g, "pagina_ok": pg, "non_supportato": inv})
            elif r["compito"] == "riassunto":
                inv = affermazioni_non_supportate(r["out"], None, info[d["id"]])
                acc["riass_con_numeri_inventati"].append(bool(inv))
                acc["t_riassunto"].append(r["s"])
                acc["riass_righe"].append(len([x for x in re.split(r"(?<=[.!?])\s+", r["out"].strip()) if x]))
                det.append({"doc": d["id"], "riassunto": r["out"], "modo": r["modo"], "non_supportato": inv})
            elif r["compito"] == "tempo_documento":
                acc["t_doc"].append(r["s"])
                acc["t_doc_" + ("lungo" if r["lungo"] else "intero")].append(r["s"])
            if r.get("prompt_n") and r.get("prompt_ms"):
                acc["_pp_n"].append(r["prompt_n"]); acc["_pp_ms"].append(r["prompt_ms"])
            if r.get("gen_n") and r.get("gen_ms"):
                acc["_tg_n"].append(r["gen_n"]); acc["_tg_ms"].append(r["gen_ms"])
        media = lambda xs: round(100 * sum(xs) / len(xs), 1) if xs else None
        m_s = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
        riga = {k: (m_s(v) if k.startswith("t_") or k == "riass_righe" else media(v)) for k, v in acc.items() if not k.startswith("_")}
        riga["n_valori_estratti"] = len(acc["estr_inventati"])
        riga["campi"] = {k: media(v) for k, v in per_campo.items()}
        if acc["_pp_ms"]:
            riga["pp_eff_ts"] = round(sum(acc["_pp_n"]) / (sum(acc["_pp_ms"]) / 1000), 1)
            riga["tg_eff_ts"] = round(sum(acc["_tg_n"]) / (sum(acc["_tg_ms"]) / 1000), 1)
        riga.update({k: meta.get(k) for k in ("caricamento_s", "ram_picco_mb", "totale_s")})
        tabella[nome] = riga
        dettagli[nome] = det
    (RISULTATI / "punteggi.json").write_text(json.dumps(tabella, indent=1, ensure_ascii=False))
    (RISULTATI / "dettagli.json").write_text(json.dumps(dettagli, indent=1, ensure_ascii=False))
    chiavi = ["estr_giusti", "estr_inventati", "json_valido", "qa_intero_giuste", "qa_intero_giuste_con_pagina",
              "qa_rag_giuste", "qa_rag_giuste_con_pagina", "qa_rag_inventate", "riass_con_numeri_inventati", "t_doc", "ram_picco_mb"]
    print("modello".ljust(36) + " ".join(k[:12].rjust(12) for k in chiavi))
    for n, r in tabella.items():
        print(n[:36].ljust(36) + " ".join(str(r.get(k)).rjust(12) for k in chiavi))


if __name__ == "__main__":
    main()
