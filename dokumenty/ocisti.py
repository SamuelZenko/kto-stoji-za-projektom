# -*- coding: utf-8 -*-
"""Cistenie dat mapy — krok A1.

  1) von body mimo Bratislavy (prepadli cez zhodny nazov ulice)
  2) von plany a koncepcie (uzemne plany, PHSR) — nie su stavby
  3) doprava a technicka infrastruktura dostanu priznak `lin`,
     mapa ich ukazuje len na vyziadanie ako vlastnu vrstvu
  4) zlucenie duplicit: ten isty nazov + to iste ICO = jeden projekt,
     ostatne konania su v `dalsie`
  5) skupina: `sk_ist` = dolozena (kotva ICO alebo znacka v nazve firmy)
     alebo adresa (len zhoda sidla — indicia)
  6) faza: `faza_zdroj` = tabula (verejna vyhlaska) alebo eia

Prepise zamery.geojson, bez-polohy.json a doplnit-polohu/zamery.csv.
Spusta sa Python-om z ArcGIS Pro (jediny na stroji):
  "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" ocisti.py
"""
import collections
import csv
import io
import json
import os
import re
import sys
import urllib.parse as up

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA = os.path.join(REPO, "mapa-zamerov")
DOP = os.path.join(REPO, "doplnit-polohu")
sys.path.insert(0, r"C:\Users\samuel.zenko\Downloads\mib-register\mib-register")
try:
    import skupiny
    SKUPINY = skupiny.SKUPINY
except ImportError:
    SKUPINY = []
    print("POZOR: modul skupiny sa nenasiel, istota skupin sa neurci")

LINIOVE = {"Doprava", "Technická infraštruktúra"}
PORADIE_FAZ = {"zámer": 0, "posúdené": 1, "povolené": 2, "dokončené": 3}


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


def kluc(n):
    """Nazov bez oznacenia etapy, bloku, zmeny — aby sa konania toho isteho
    projektu stretli. Rovnaky vzorec ako v merani duplicit."""
    t = bd(n)
    t = re.sub(r"zmena navrhovanej cinnosti|zmena cinnosti|oznamenie o zmene", "", t)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\b(etapa|etap|blok|cast|i|ii|iii|iv|v|vi|so|a|b|c|d|\d+)\b", " ", t)
    return " ".join(w for w in t.split() if len(w) > 2)[:60]


gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
F = gj["features"]
print("na vstupe: %d bodov" % len(F))

# ── 1 · mimo Bratislavy ─────────────────────────────────────────────
von = [f for f in F if not (f["properties"].get("obec") or "").startswith("Bratislava")]
F = [f for f in F if f not in von]
print("1) mimo Bratislavy von: %d  (%s)" % (len(von), ", ".join(sorted({f["properties"]["obec"] for f in von})[:6])))

# ── 2 · plany a koncepcie ───────────────────────────────────────────
plany = [f for f in F if f["properties"].get("typ") == "Plány a koncepcie"]
F = [f for f in F if f["properties"].get("typ") != "Plány a koncepcie"]
json.dump([{"id": f["properties"]["id"], "nazov": f["properties"]["nazov"],
            "obec": f["properties"].get("obec"), "faza": f["properties"].get("faza"),
            "zmena": f["properties"].get("zmena")} for f in plany],
          open(os.path.join(MAPA, "plany-koncepcie.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("2) plany a koncepcie von: %d  (ulozene do plany-koncepcie.json)" % len(plany))

# ── 3 · liniove stavby ──────────────────────────────────────────────
lin = 0
for f in F:
    p = f["properties"]
    if p.get("typ") in LINIOVE:
        p["lin"] = 1
        lin += 1
    else:
        p.pop("lin", None)
print("3) doprava a infrastruktura s priznakom lin: %d" % lin)

# ── 4 · duplicity ───────────────────────────────────────────────────
skup = collections.OrderedDict()
for f in F:
    p = f["properties"]
    skup.setdefault((kluc(p["nazov"]), p.get("ico") or p["id"]), []).append(f)


def zluc(zoz):
    zoz = sorted(zoz, key=lambda f: (f["properties"].get("presnost") != "presná",
                                     f["properties"].get("zmena") or ""), )
    # presny bod ma prednost, potom najnovsi
    presne = [f for f in zoz if f["properties"].get("presnost") == "presná"]
    hl = max(presne, key=lambda f: f["properties"].get("zmena") or "") if presne \
        else max(zoz, key=lambda f: f["properties"].get("zmena") or "")
    p = hl["properties"]
    ostatne = [f for f in zoz if f is not hl]
    p["dalsie"] = [{"id": o["properties"]["id"], "nazov": o["properties"]["nazov"],
                    "stav": o["properties"].get("stav", ""), "faza": o["properties"].get("faza", ""),
                    "zmena": o["properties"].get("zmena", "")} for o in ostatne]
    p["faza"] = max((x["properties"].get("faza", "zámer") for x in zoz),
                    key=lambda z: PORADIE_FAZ.get(z, 0))
    p["zmena"] = max(x["properties"].get("zmena") or "" for x in zoz)
    p["dok"] = sum(x["properties"].get("dok") or 0 for x in zoz)
    # graficke podklady zo vsetkych konani, bez opakovania
    videne, pl = set(), []
    for x in zoz:
        for d in x["properties"].get("plany") or []:
            if d.get("u") not in videne:
                videne.add(d.get("u")); pl.append(d)
    if pl:
        p["plany"] = pl
        nah = [d["n"] for d in pl if d.get("n")]
        if nah:
            p["nahlady"] = nah; p["nahlad"] = nah[0]
    for x in zoz:
        if x["properties"].get("doklad") and not p.get("doklad"):
            p["doklad"] = x["properties"]["doklad"]
    return hl


F2, zlucene = [], 0
for zoz in skup.values():
    if len(zoz) == 1:
        F2.append(zoz[0])          # `dalsie` z predchadzajuceho behu ostava
    else:
        F2.append(zluc(zoz)); zlucene += len(zoz) - 1
F = F2
print("4) duplicity: zlucenych %d zaznamov -> %d projektov" % (zlucene, len(F)))

# ── 5 · istota skupiny ──────────────────────────────────────────────
podla_nazvu = {s["nazov"]: s for s in SKUPINY}
ist = collections.Counter()
for f in F:
    p = f["properties"]
    if not p.get("skupina"):
        p.pop("sk_ist", None); continue
    if not SKUPINY:                  # bez tabulky skupin (napr. v cloude) nechaj, co uz je
        ist[p.get("sk_ist", "?")] += 1; continue
    s = podla_nazvu.get(p["skupina"])
    firma = bd(p.get("firma") or "")
    dolozene = bool(s) and (str(p.get("ico") or "") in set(s.get("kotvy", []))
                            or any(t in firma for t in s.get("tokeny", [])))
    p["sk_ist"] = "dolozena" if dolozene else "adresa"
    ist[p["sk_ist"]] += 1
print("5) skupina: dolozena %d, len adresa %d" % (ist["dolozena"], ist["adresa"]))

# ── 6 · zdroj fazy ──────────────────────────────────────────────────
zdr = collections.Counter()
for f in F:
    p = f["properties"]
    p["faza_zdroj"] = "tabula" if p.get("doklad") else "eia"
    zdr[p["faza_zdroj"]] += 1
print("6) faza z uradnej tabule %d, len z EIA %d" % (zdr["tabula"], zdr["eia"]))

gj["features"] = F
json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

# ── tabulka a zoznam pre doplnanie polohy (ako tabulka.py) ─────────
riadky = []
for f in F:
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    presna = p.get("presnost") == "presná"
    riadky.append({"id": p["id"], "nazov": p["nazov"], "obec": p.get("obec", ""),
                   "typ": p.get("typ", ""), "faza": p.get("faza", ""),
                   "firma": (p.get("firma") or "").split(",")[0], "ico": p.get("ico", ""),
                   "dok": p.get("dok", 0), "obrazkov": len(p.get("nahlady") or []),
                   "suradnice": ("%.6f, %.6f" % (lat, lon)) if presna else "",
                   "zdroj": "z názvu ulice" if presna else "",
                   "chyba": "má polohu" if presna else "CHÝBA"})
riadky.sort(key=lambda r: (r["suradnice"] != "", r["obec"], r["nazov"]))
with open(os.path.join(DOP, "zamery.csv"), "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.writer(fh, delimiter=";")
    w.writerow(["id", "nazov", "mestska_cast", "ucel", "faza", "navrhovatel", "ico", "dokumentov",
                "obrazkov", "suradnice", "poloha", "zdroj_polohy", "poznamka", "hladat_v_mapach", "spis"])
    for r in riadky:
        dotaz = up.quote((r["nazov"].replace("„", "").replace("“", "") + " " + r["obec"])[:180])
        w.writerow([r["id"], r["nazov"], r["obec"], r["typ"], r["faza"], r["firma"], r["ico"], r["dok"],
                    r["obrazkov"], r["suradnice"], r["chyba"], r["zdroj"], "",
                    "https://www.google.com/maps/search/" + dotaz,
                    "https://www.enviroportal.sk/eia/detail/" + r["id"]])
json.dump([{"id": r["id"], "nazov": r["nazov"], "obec": r["obec"], "typ": r["typ"], "faza": r["faza"],
            "firma": r["firma"], "dok": r["dok"], "ma": bool(r["suradnice"]), "sur": r["suradnice"]}
           for r in riadky],
          open(os.path.join(MAPA, "bez-polohy.json"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))

typy = collections.Counter(f["properties"].get("typ") for f in F)
print("\nvysledok: %d stavieb, z toho liniovych %d, s presnou polohou %d"
      % (len(F), lin, sum(1 for f in F if f["properties"].get("presnost") == "presná")))
for k, v in typy.most_common():
    print("   %-28s %4d" % (k, v))
print("velkost zamery.geojson: %.0f kB" % (os.path.getsize(os.path.join(MAPA, "zamery.geojson")) / 1000))
