# -*- coding: utf-8 -*-
"""Priradenie ochrannych znamok k projektom → komercne nazvy.

Vstup: znamky_upv.json (majitel → znamky v realitnych triedach).
Pre kazdu znamku sa hladaju projekty toho isteho majitela (firma alebo
skupina) a porovnava sa znenie znamky s nazvom, ulicou, mestskou castou
a k. u. projektu:

  ista     — vsetky vyznamne slova znamky su v nazve projektu (napr.
             „Nové Nádvorie Dúbravka") → zapise sa rovno
  stredna  — znamka zdiela s projektom aspon jedno vyznamne slovo
             (ulica, lokalita: „Pribinova 1" ↔ projekt na Pribinovej)
             → zapise sa s istotou „stredná"
  navrh    — majitel ma jednu znamku a jeden projekt bez zhody slov
             → len do tabulky na posudenie

Vystup: nazvy-obchodne.json (mapa) + nazvy-navrh.csv (na kontrolu).
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" znamky_priradenie.py
"""
import csv
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
GEN = {"development", "invest", "investment", "real", "estate", "reality", "property", "group", "holding",
       "slovakia", "slovensko", "bratislava", "projekt", "project", "capital", "management", "company",
       "residential", "residence", "rezidencia", "home", "homes", "byty", "dom", "domy", "park", "city",
       "centrum", "center", "office", "offices", "tower", "towers", "nehnutelnosti", "living", "house",
       "garden", "gardens", "green", "apartments", "apartmany", "byvanie", "polyfunkcny", "polyfunkcna",
       "bytovy", "bytove", "obytny", "subor", "komplex", "objekt", "stavba", "blok", "etapa"}


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


def tok(s, mn=4):
    return {w for w in re.findall(r"[a-z0-9]+", bd(s)) if len(w) >= mn and w not in GEN and not w.isdigit()}


zn = json.load(open(os.path.join(TU, "znamky_upv.json"), encoding="utf-8"))
gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
P = [f["properties"] for f in gj["features"] if not f["properties"].get("lin")]
cesta_n = os.path.join(MAPA, "nazvy-obchodne.json")
try:
    stare = json.load(open(cesta_n, encoding="utf-8"))
except (OSError, ValueError):
    stare = {}
# rucne zapisy (retazce) a popis ostavaju; zaznamy zo znamok sa stavaju nanovo
nazvy = {k: v for k, v in stare.items() if k.startswith("_") or isinstance(v, str)}
nazvy["_popis"] = ("Komerčné názvy projektov k ID zámeru. Reťazec = ručne overený zápis. Objekt {nazov, zdroj, istota} = "
                   "z ochrannej známky ÚPV (skript dokumenty/znamky_priradenie.py): istá = slová známky sú v názve projektu, "
                   "stredná = zhoda v podstatnom slove. Kľúče s podčiarkovníkom mapa ignoruje.")
ULICA_CISLO = re.compile(r"^[A-Za-zÁ-ž\.\s]+\d+[A-Za-z]?$")     # „Pribinova 1" — adresa, nie meno projektu
PORADIE = {"ista": 0, "stredna": 1, "navrh": 2}

riadky, najlepsi = [], {}     # projekt_id -> (poradie, pocet slov znamky, zaznam)
for dopyt, znamky in zn.items():
    if not znamky:
        continue
    sk = znamky[0].get("skupina")
    # stavebne znamky maju triedu 36 (nehnutelnosti) alebo 37 (stavebnictvo);
    # 35/43 samotne su obchody, hotely, hokej
    znamky = [z for z in znamky if set(z.get("ncl", [])) & {"36", "37"}]
    kand = [p for p in P if bd(dopyt) in bd(p.get("firma") or "") or (sk and p.get("skupina") == sk)]
    if not kand:
        continue
    for z in znamky:
        zt = tok(z["znenie"])
        if not zt:
            continue
        slogan = len(zt) >= 4 or " by " in z["znenie"].lower()
        adresa = bool(ULICA_CISLO.match(z["znenie"].strip()))
        naj = []
        for p in kand:
            nt = tok(p.get("nazov", ""))                       # len nazov — ulica a MC klamu
            sp = zt & nt
            if slogan or adresa:
                if sp:
                    naj.append(("navrh", len(sp), p))
            elif zt <= nt:
                naj.append(("ista", len(sp), p))
            elif any(len(w) >= 5 for w in sp) and len(zt) <= 3:
                naj.append(("stredna", len(sp), p))
        if not naj and len(znamky) == 1 and len(kand) == 1:
            naj.append(("navrh", 0, kand[0]))
        for ist, sp, p in sorted(naj, key=lambda x: (PORADIE[x[0]], -x[1]))[:3]:
            riadky.append({"projekt_id": p["id"], "projekt": p["nazov"], "firma": (p.get("firma") or "").split(",")[0],
                           "skupina": p.get("skupina") or "", "znamka": z["znenie"], "majitel": z["majitel"],
                           "cislo": z["cislo"], "istota": ist, "zhoda_slov": sp})
            # do mapy ide len ista zhoda — „stredna" dava aj BITTNER Travel
            # ci BILLA ludom, tie ostavaju v tabulke na posudenie
            if ist != "ista" or isinstance(stare.get(p["id"]), str):
                continue
            # pre projekt ostane najistejsia znamka; pri rovnakej istote ta
            # s viac slovami („STANICA NIVY" pred „nivy"), slogany su uz vyradene
            kl = (PORADIE[ist], -len(zt))
            if p["id"] not in najlepsi or kl < najlepsi[p["id"]][0]:
                najlepsi[p["id"]] = (kl, {"nazov": z["znenie"], "istota": "istá" if ist == "ista" else "stredná",
                                          "zdroj": "ochranná známka ÚPV č. %s, majiteľ %s" % (z["cislo"], z["majitel"])})
zapis = {"ista": 0, "stredna": 0}
for pid, (kl, zaz) in najlepsi.items():
    nazvy[pid] = zaz
    zapis["ista" if zaz["istota"] == "istá" else "stredna"] += 1

json.dump(nazvy, open(cesta_n, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(os.path.join(TU, "nazvy-navrh.csv"), "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=["istota", "projekt", "znamka", "majitel", "cislo", "firma", "skupina", "zhoda_slov", "projekt_id"], delimiter=";")
    w.writeheader()
    for r in sorted(riadky, key=lambda r: (r["istota"] != "ista", r["istota"] != "stredna", r["projekt"])):
        w.writerow(r)
print("kandidátov v tabuľke: %d" % len(riadky))
print("zapísané do mapy: istá %d, stredná %d  (spolu v nazvy-obchodne.json: %d)"
      % (zapis["ista"], zapis["stredna"], sum(1 for k in nazvy if not k.startswith("_"))))
for r in [r for r in riadky if r["istota"] != "navrh"][:25]:
    print("   %-8s %-44s <- %s" % (r["istota"], r["projekt"][:44], r["znamka"][:30]))
