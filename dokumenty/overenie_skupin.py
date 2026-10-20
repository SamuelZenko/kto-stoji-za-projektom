# -*- coding: utf-8 -*-
"""Overenie developerskej skupiny za navrhovateľom (SPV) z verejného registra.

Postup (yimba = len nápoveda, do mapy ide výsledok z registra):
 1. pre každý zámer s IČO vytiahneme z RPO (lokálna kópia výpisov, rpo_cache.py)
    vlastnícku reťaz: SPV → spoločník → spoločník spoločníka … (max 4 úrovne)
 2. skupina je DOLOŽENÁ, keď:
      a) niektorá firma v reťazi je kotva skupiny (IČO v tabuľke) alebo jej
         názov nesie značku skupiny („PENTA REAL ESTATE HOLDING LIMITED“)
      b) samotné SPV nesie značku v názve
      c) SPV má tých istých štatutárov ako kotva skupiny (slabší dôkaz, označený)
 3. inak ostáva: tip z yimby (nepublikuje sa), alebo „reťaz prerušená v
    zahraničí“ (posledný spoločník je cudzia firma bez IČO), alebo nič

Výstup: skupiny_overene.csv (všetko, na kontrolu)
        ../mapa-zamerov/skupiny-overene.json (len doložené; mapa ich zlúči v prehliadači)

Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" overenie_skupin.py
"""
import csv
import io
import json
import os
import re
import sys
import unicodedata

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
sys.path.insert(0, TU)
import rpo_cache
sys.path.insert(0, rpo_cache.MIB)
from skupiny import SKUPINY          # ručná tabuľka skupín nástroja mib-register (kotvy IČO + tokeny)

CSV_OUT = os.path.join(TU, "skupiny_overene.csv")
JSON_OUT = os.path.join(MAPA, "skupiny-overene.json")
PRAVNA = re.compile(r"\b(s\s?r\s?o|spol s r o|a\s?s|k\s?s|v\s?o\s?s|se|j\s?s\s?a|ltd|limited|gmbh|b\s?v|n\s?v|holding|group|development|investments?|real estate)\b")


def bd(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def norm(s):
    s = re.sub(r"[^a-z0-9& ]", " ", bd(s).replace("&", " & "))
    return re.sub(r"\s+", " ", s).strip()


def ico8(s):
    c = re.sub(r"\D", "", str(s or ""))
    return c.zfill(8)[:8] if c else ""


# ---------- tabuľka skupín: mib-register + aliasy z yimby ----------
# yimba píše skupiny rôzne (J&T Real Estate / JTRE, Corwin / Corwin Capital) — tu sa zjednotia
ALIAS = {
    "penta real estate": ("PENTA", "Penta Real Estate", ["penta"]),
    "j&t real estate": ("JTRE", "J&T Real Estate", ["jtre", "j & t real estate", "j&t real estate"]),
    "jtre": ("JTRE", "J&T Real Estate", []),
    "yit slovakia": ("YIT", "YIT Slovakia", ["yit"]),
    "hb reavis": ("HBR", "HB Reavis", []),
    "corwin": ("CORWIN", "Corwin", []), "corwin capital": ("CORWIN", "Corwin", []),
    "cresco group": ("CRESCO", "Cresco Real Estate", ["cresco"]), "cresco real estate": ("CRESCO", "Cresco Real Estate", []),
    "immocap": ("IMMOCAP", "Immocap", []), "vi group": ("VIGROUP", "VI Group", []),
    "proxenta": ("PROXENTA", "Proxenta", []), "itb development": ("ITB", "ITB Development", []),
    "bencont group": ("BENCONT", "Bencont", ["bencont"]), "lucron": ("LUCRON", "Lucron / Vydrica Development", []),
    "alto real estate": ("ALTO", "Alto Real Estate", []),
    "grafobal group development": ("GRAFOBAL", "Grafobal Group", ["grafobal"]),
    "iuris group": ("IURIS", "Iuris Group", ["iuris"]), "finep": ("FINEP", "FINEP", ["finep"]),
    "metrostav slovakia": ("METROSTAV", "Metrostav", ["metrostav"]), "retep slovakia": ("RETEP", "Retep Slovakia", ["retep"]),
    "inter development": ("INTERDEV", "Inter Development", []), "elite holding": ("ELITE", "ELITE Holding", ["elite holding"]),
    "macho consulting": ("MACHO", "Macho Consulting", ["macho"]), "archikod": ("ARCHIKOD", "Archikód", ["archikod"]),
    "lentimex development": ("LENTIMEX", "Lentimex", ["lentimex"]), "esterhazy real estate": ("ESTERHAZY", "Esterhazy Real Estate", ["esterhazy"]),
}
skupiny = {}
for s in SKUPINY:
    skupiny[s["kod"]] = {"kod": s["kod"], "nazov": s["nazov"], "kotvy": set(ico8(k) for k in s["kotvy"]),
                         "tokeny": set(norm(t) for t in s["tokeny"])}
for k, (kod, nazov, extra) in ALIAS.items():
    g = skupiny.setdefault(kod, {"kod": kod, "nazov": nazov, "kotvy": set(), "tokeny": set()})
    g["tokeny"].add(k); g["tokeny"].update(extra)


def skupina_podla_nazvu(meno):
    """Značka skupiny v názve firmy (PENTA REAL ESTATE HOLDING LIMITED → PENTA)."""
    n = norm(meno)
    best = None
    for g in skupiny.values():
        for t in g["tokeny"]:
            if t and re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", n):
                if best is None or len(t) > len(best[1]):
                    best = (g, t)
    return best


# ---------- vstupy ----------
R = rpo_cache.nacitaj()
R.online = "--orsr" in sys.argv      # chýbajúce výpisy doťahovať z www.orsr.sk (pomalé, 3,5 s na dopyt)
gj = json.load(io.open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
tipy = json.load(io.open(os.path.join(TU, "yimba_tipy.json"), encoding="utf-8"))["zamery"] \
    if os.path.exists(os.path.join(TU, "yimba_tipy.json")) else {}
# štatutári kotiev (pre slabší dôkaz c)
kotvy_statutari = {}
for g in skupiny.values():
    for k in g["kotvy"]:
        e = R.entita(k)
        if e:
            for st in e["statutari"]:
                kotvy_statutari.setdefault(norm(st), set()).add(g["kod"])


def over(p):
    """Vráti dict: vysledok, skupina (kod), dokaz, retaz, vypis."""
    ico = ico8(p.get("ico"))
    firma = p.get("firma") or ""
    out = {"vysledok": "", "kod": "", "dokaz": "", "retaz": "", "vypis": "", "pozn": ""}
    # b) značka v názve SPV
    z = skupina_podla_nazvu(firma)
    if z:
        out.update(vysledok="doložená", kod=z[0]["kod"], dokaz="značka „%s“ v názve navrhovateľa" % z[1])
    if not ico:
        if not out["vysledok"]:
            out["pozn"] = "bez IČO v EIA"
        return out
    # reťaz sa stavia krok po kroku a končí pri prvej zhode — s ORSR fallbackom
    # (3,5 s na dopyt) sa tak nedoťahujú výpisy, ktoré už nie sú potrebné
    retaz, videne, cur = [], set(), ico
    for _ in range(4):
        e = R.entita(cur)
        if not e or cur in videne:
            break
        videne.add(cur)
        firmy = [s for s in e["spolocnici"] if s["ico"]]
        retaz.append((e, firmy))
        if any(s["ico"] in g["kotvy"] for s in e["spolocnici"] for g in skupiny.values()) \
                or any(skupina_podla_nazvu(s["meno"]) for s in e["spolocnici"]) or not firmy:
            break
        cur = firmy[0]["ico"]
    if not retaz:
        out["pozn"] = "výpis RPO nie je v lokálnej kópii" + (" ani v ORSR" if R.online else "")
        return out
    out["vypis"] = retaz[0][0]["vypis"] + (" ORSR" if retaz[0][0].get("zdroj") == "ORSR" else " RPO")
    kroky = []
    for e, firmy in retaz:
        kroky.append(e["meno"])
        # a) kotva alebo značka v reťazi (SPV sama aj každý firemný spoločník)
        for g in skupiny.values():
            if e["ico"] in g["kotvy"] and e["ico"] != ico:
                out.update(vysledok="doložená", kod=g["kod"], dokaz="spoločník %s je kotva skupiny (IČO %s)" % (e["meno"], e["ico"]))
        for s in e["spolocnici"]:
            if s["ico"] and any(s["ico"] in g["kotvy"] for g in skupiny.values()):
                g = next(g for g in skupiny.values() if s["ico"] in g["kotvy"])
                out.update(vysledok="doložená", kod=g["kod"], dokaz="spoločník %s (IČO %s) je kotva skupiny" % (s["meno"], s["ico"]))
                kroky.append(s["meno"]); break
            zz = skupina_podla_nazvu(s["meno"])
            if zz and not out["vysledok"]:
                out.update(vysledok="doložená", kod=zz[0]["kod"], dokaz="spoločník „%s“ nesie značku skupiny" % s["meno"])
                kroky.append(s["meno"]); break
        if out["vysledok"]:
            break
    posledna = retaz[-1][0]
    cudzi = [s for s in posledna["spolocnici"] if not s["ico"] and s["typ"] and "osoba" not in s["typ"].lower()
             and s["stat"] and "slovensk" not in s["stat"].lower()]
    out["retaz"] = " → ".join(kroky)
    if out["vysledok"]:
        return out
    # c) spoloční štatutári s kotvou
    spv = retaz[0][0]
    kody = set()
    for st in spv["statutari"]:
        kody |= kotvy_statutari.get(norm(st), set())
    if len(kody) == 1:
        kod = kody.pop()
        out.update(vysledok="doložená (štatutári)", kod=kod,
                   dokaz="štatutári %s sú zároveň štatutármi kotvy skupiny" % spv["meno"])
        return out
    if cudzi:
        out["pozn"] = "reťaz prerušená v zahraničí: %s (%s)" % (cudzi[0]["meno"], cudzi[0]["stat"])
    elif not any(s["ico"] for s in posledna["spolocnici"]):
        out["pozn"] = "spoločníci sú fyzické osoby / bez IČO"
    return out


# ---------- beh ----------
riadky, do_mapy, stat = [], {}, {}
for f in gj["features"]:
    p = f["properties"]
    if p.get("zdroj") == "redakcia":
        continue
    o = over(p)
    tip = tipy.get(p["id"], {})
    tip_kod = ""
    if tip.get("skupina"):
        a = ALIAS.get(norm(tip["skupina"]))
        tip_kod = a[0] if a else ""
    konflikt = bool(o["kod"] and tip_kod and o["kod"] != tip_kod)
    vys = o["vysledok"] or ("tip yimba (neoverené)" if tip.get("skupina") else "")
    r = {"id": p["id"], "zamer": p.get("nazov", ""), "firma": p.get("firma", ""), "ico": ico8(p.get("ico")),
         "skupina_doteraz": p.get("skupina", ""), "sk_ist_doteraz": p.get("sk_ist", ""),
         "vysledok": vys, "skupina_overena": skupiny[o["kod"]]["nazov"] if o["kod"] else "",
         "dokaz": o["dokaz"], "retaz": o["retaz"], "vypis_RPO": o["vypis"],
         "yimba_tip": tip.get("skupina", ""), "konflikt_s_yimbou": "ÁNO" if konflikt else "", "pozn": o["pozn"]}
    riadky.append(r)
    stat[vys or "—"] = stat.get(vys or "—", 0) + 1
    if o["vysledok"].startswith("doložená"):
        do_mapy[p["id"]] = {"skupina": r["skupina_overena"], "dokaz": o["dokaz"], "retaz": o["retaz"],
                            "vypis": o["vypis"], "sila": "štatutári" if "štatutári" in o["vysledok"] else "register"}

if R.online:
    R.uloz()
    print("dotiahnuté z ORSR:", R.dotiahnute)
riadky.sort(key=lambda r: (r["vysledok"] == "", r["vysledok"], r["skupina_overena"], r["zamer"]))
with io.open(CSV_OUT, "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(riadky[0].keys()), delimiter=";")
    w.writeheader(); w.writerows(riadky)
json.dump({"zdroj": "RPO (api.statistics.sk) — vlastnícka reťaz spoločníkov; lokálna kópia výpisov nástroja mib-register",
           "zamery": do_mapy}, io.open(JSON_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("zámerov: %d" % len(riadky))
for k, v in sorted(stat.items(), key=lambda kv: -kv[1]):
    print("  %-28s %4d" % (k, v))
print("doložených doteraz (sk_ist=dolozena): %d  → teraz do mapy: %d" % (
    sum(1 for r in riadky if r["sk_ist_doteraz"] == "dolozena"), len(do_mapy)))
podla = {}
for r in riadky:
    if r["skupina_overena"]:
        podla[r["skupina_overena"]] = podla.get(r["skupina_overena"], 0) + 1
print("podľa skupín:", ", ".join("%s %d" % kv for kv in sorted(podla.items(), key=lambda kv: -kv[1])))
print("konflikty s yimbou:", sum(1 for r in riadky if r["konflikt_s_yimbou"]))
for r in [r for r in riadky if r["konflikt_s_yimbou"]][:10]:
    print("   %-45s register: %-20s yimba: %s" % (r["zamer"][:45], r["skupina_overena"], r["yimba_tip"]))
print("indície (adresa) bez doloženia, ktoré yimba tipuje:", sum(1 for r in riadky if r["vysledok"].startswith("tip")))
print("\nvýstup: %s\n        %s" % (CSV_OUT, JSON_OUT))
