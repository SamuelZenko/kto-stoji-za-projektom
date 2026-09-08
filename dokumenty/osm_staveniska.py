# -*- coding: utf-8 -*-
"""Staveniska z OpenStreetMap — obchodne nazvy, polohy a nova vrstva.

OSM ma pri rozostavanych projektoch `landuse=construction` + `name` s menom
z bilbordu. Vyuzitie v troch krokoch:
  1) stavenisko do 30 m od presneho bodu zameru -> obchodny nazov (ak
     projekt este ziadny nema — znamka ma prednost)
  2) stavenisko, ktore sa vola ako zamer s priblizou polohou v tej istej
     MC -> zamer dostane polohu staveniska
  3) stavenisko bez zameru -> vrstva osm-staveniska.geojson (stavby,
     ktore register EIA nevidi)
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" osm_staveniska.py
"""
import csv
import io
import json
import math
import os
import re
import ssl
import sys
import urllib.parse as up
import urllib.request as ur

from shapely.geometry import shape, Point

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
CTX = ssl.create_default_context()
ZDROJE = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
          "https://overpass.private.coffee/api/interpreter"]
DOTAZ = """[out:json][timeout:300];
( way["name"]["landuse"="construction"](48.05,16.98,48.29,17.25);
  relation["name"]["landuse"="construction"](48.05,16.98,48.29,17.25);
  way["name"]["construction"](48.05,16.98,48.29,17.25); );
out tags center;"""
GEN = {"development", "invest", "real", "estate", "reality", "group", "slovakia", "bratislava", "projekt",
       "residential", "residence", "rezidencia", "home", "byty", "dom", "domy", "park", "city", "centrum",
       "office", "offices", "tower", "polyfunkcny", "polyfunkcna", "bytovy", "bytove", "obytny", "subor",
       "komplex", "objekt", "stavba", "blok", "etapa", "novostavba", "administrativna", "budova"}
DRUH = {"residential": "bývanie", "apartments": "bývanie", "dormitory": "internát", "office": "administratíva",
        "commercial": "obchod a služby", "retail": "obchod", "industrial": "výroba", "warehouse": "sklad",
        "school": "škola", "kindergarten": "škôlka", "hospital": "zdravotníctvo", "hotel": "hotel",
        "parking": "parkovanie", "construction": "", "yes": ""}


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


def tok(s):
    return {w for w in re.findall(r"[a-z0-9]+", bd(s)) if len(w) >= 4 and w not in GEN and not w.isdigit()}


def vzd(a, b):
    return math.hypot((a[0] - b[0]) * 74000, (a[1] - b[1]) * 111000)


def stiahni():
    import time
    for pokus in range(3):
        for u in ZDROJE:
            try:
                r = ur.Request(u, data=up.urlencode({"data": DOTAZ}).encode(), headers={"User-Agent": "MIB-mapa/1.0"})
                with ur.urlopen(r, timeout=300, context=CTX) as o:
                    return json.loads(o.read().decode("utf-8"))
            except Exception as e:
                print("   %s nevyšlo: %s" % (u.split("/")[2], str(e)[:60]))
        time.sleep(20 * (pokus + 1))
    raise SystemExit("Overpass neodpovedal")


# ── mestske casti (len Bratislava) ──────────────────────────────────
mc = json.load(open(os.path.join(MAPA, "mestske-casti.geojson"), encoding="utf-8"))
MC = {}
for f in mc["features"]:
    a = f["properties"]; MC[a.get("NAZOV_ZUJ") or a.get("MC_LABEL")] = shape(f["geometry"]).buffer(0)


def mc_bodu(x, y):
    p = Point(x, y)
    for n, g in MC.items():
        if g.contains(p):
            return n
    return None


# ── staveniska ──────────────────────────────────────────────────────
d = stiahni()
st = []
for e in d.get("elements", []):
    t = e.get("tags") or {}
    c = e.get("center")
    if not c or not t.get("name"):
        continue
    m = mc_bodu(c["lon"], c["lat"])
    if not m:
        continue                                   # Stupava, Rovinka…
    st.append({"osm": "%s/%s" % (e["type"], e["id"]), "n": t["name"].strip(), "x": c["lon"], "y": c["lat"], "mc": m,
               "druh": DRUH.get(t.get("construction") or "", t.get("construction") or ""),
               "od": t.get("start_date", ""), "web": t.get("website", ""), "dev": t.get("developer") or t.get("operator") or ""})
print("pomenovaných stavenísk v Bratislave: %d" % len(st))

gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
F = [f for f in gj["features"] if not f["properties"].get("lin")]
cesta_n = os.path.join(MAPA, "nazvy-obchodne.json")
nazvy = json.load(open(cesta_n, encoding="utf-8"))

nazov_pridany = poloha_pridana = 0
navrhy, pouzite = [], set()
for s in st:
    # 1) presny bod do 30 m
    bliz = sorted(((vzd((s["x"], s["y"]), f["geometry"]["coordinates"]), f) for f in F
                   if f["properties"].get("presnost") == "presná"), key=lambda t: t[0])
    if bliz and bliz[0][0] <= 30:
        f = bliz[0][1]; p = f["properties"]
        pouzite.add(s["osm"])
        if p["id"] not in nazvy:
            nazvy[p["id"]] = {"nazov": s["n"], "istota": "stredná",
                              "zdroj": "OpenStreetMap — pomenované stavenisko %s, %d m od bodu" % (s["osm"], bliz[0][0])}
            nazov_pridany += 1
        continue
    if bliz and bliz[0][0] <= 80:
        navrhy.append((s["n"], bliz[0][1]["properties"]["nazov"], int(bliz[0][0]), "presný bod do 80 m"))
    # 2) rovnaky nazov ako zamer s priblizou polohou v tej istej MC
    zt = tok(s["n"])
    if zt:
        kand = [f for f in F if f["properties"].get("presnost") != "presná"
                and (f["properties"].get("obec") or "") == s["mc"]
                and zt <= tok(f["properties"]["nazov"])]
        if len(kand) >= 1:
            for f in kand[:3]:
                p = f["properties"]
                f["geometry"]["coordinates"] = [round(s["x"], 6), round(s["y"], 6)]
                p["presnost"] = "presná"; p["zdroj_polohy"] = "osm"; p["osm"] = s["osm"]
                poloha_pridana += 1
                if p["id"] not in nazvy:
                    nazvy[p["id"]] = {"nazov": s["n"], "istota": "stredná", "zdroj": "OpenStreetMap — pomenované stavenisko %s" % s["osm"]}
            pouzite.add(s["osm"])
            continue
    # 3) nic — nova stavba mimo registra? (ak je do 150 m od hocijakeho bodu, len navrh)
    naj = min((vzd((s["x"], s["y"]), f["geometry"]["coordinates"]) for f in F), default=9e9)
    s["blizko_zamer"] = naj <= 150

nove = [s for s in st if s["osm"] not in pouzite]
json.dump({"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(s["x"], 6), round(s["y"], 6)]},
     "properties": {"n": s["n"], "mc": s["mc"], "druh": s["druh"], "od": s["od"], "osm": s["osm"], "web": s["web"],
                    "dev": s["dev"], "blizko": 1 if s["blizko_zamer"] else 0}} for s in nove]},
    open(os.path.join(MAPA, "osm-staveniska.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(nazvy, open(cesta_n, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(TU, "osm-navrh.csv"), "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.writer(fh, delimiter=";"); w.writerow(["stavenisko OSM", "zámer", "vzdialenosť m", "poznámka"])
    for r in navrhy:
        w.writerow(r)
print("1) obchodný názov zo staveniska (do 30 m):   %d" % nazov_pridany)
print("2) poloha pre zámer s rovnakým názvom:       %d" % poloha_pridana)
print("3) staveniská bez zámeru → nová vrstva:      %d  (z toho do 150 m od nejakého bodu %d)" % (len(nove), sum(1 for s in nove if s["blizko_zamer"])))
print("   návrhov na posúdenie (osm-navrh.csv):     %d" % len(navrhy))
print("\nnové staveniská:")
for s in sorted(nove, key=lambda s: s["mc"]):
    print("   %-22s %-34s %-16s %s" % (s["mc"].replace("Bratislava - ", ""), s["n"][:34], s["druh"], s["od"]))
