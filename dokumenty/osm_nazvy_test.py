# -*- coding: utf-8 -*-
"""Test: obchodne nazvy stavieb z OpenStreetMap podla polohy.

Znamka nema adresu, zamer nema znacku — ale obe maju polohu. OSM ma pri
budovach a staveniskach `name`. Pre kazdy presny bod mapy sa hlada
pomenovana budova / stavenisko do 80 m. Len meranie, nic sa nezapisuje.
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" osm_nazvy_test.py
"""
import io
import json
import math
import os
import re
import ssl
import sys
import urllib.parse as up
import urllib.request as ur

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
CTX = ssl.create_default_context()
ZDROJE = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
# pomenovane budovy, staveniska a arealy v Bratislave — jeden dopyt, vsetko so stredom
DOTAZ = """[out:json][timeout:300];
(
  way["name"]["building"](48.05,16.98,48.29,17.25);
  way["name"]["landuse"="construction"](48.05,16.98,48.29,17.25);
  way["name"]["construction"](48.05,16.98,48.29,17.25);
  relation["name"]["building"](48.05,16.98,48.29,17.25);
  relation["name"]["landuse"="construction"](48.05,16.98,48.29,17.25);
  node["name"]["construction"](48.05,16.98,48.29,17.25);
);
out tags center;"""
GEN = re.compile(r"^(bytov[yý] dom|polyfunk|garáž|garaz|škola|skola|materská|kostol|hotel|obchod|billa|lidl|tesco|kaufland|"
                 r"parkovisko|čerpacia|cerpacia|pošta|posta|dom kultúry)", re.I)


def stiahni():
    for u in ZDROJE:
        try:
            r = ur.Request(u, data=up.urlencode({"data": DOTAZ}).encode(), headers={"User-Agent": "MIB-mapa/1.0"})
            with ur.urlopen(r, timeout=300, context=CTX) as o:
                return json.loads(o.read().decode("utf-8"))
        except Exception as e:
            print("   %s nevyšlo: %s" % (u.split("/")[2], str(e)[:60]))
    raise SystemExit("Overpass neodpovedal")


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


d = stiahni()
objekty = []
for e in d.get("elements", []):
    t = e.get("tags") or {}
    c = e.get("center") or ({"lat": e.get("lat"), "lon": e.get("lon")} if e.get("lat") else None)
    if not c or not t.get("name"):
        continue
    druh = "stavenisko" if (t.get("landuse") == "construction" or t.get("construction")) else "budova"
    objekty.append({"n": t["name"], "lat": c["lat"], "lon": c["lon"], "druh": druh, "typ": t.get("building") or t.get("construction") or ""})
print("pomenovaných objektov v OSM: %d (z toho stavenísk %d)" % (len(objekty), sum(1 for o in objekty if o["druh"] == "stavenisko")))

gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
presne = [f for f in gj["features"] if f["properties"].get("presnost") == "presná" and not f["properties"].get("lin")]


def vzd(a, b):
    dx = (a[0] - b[0]) * 74000; dy = (a[1] - b[1]) * 111000
    return math.hypot(dx, dy)


zhody, nove = [], 0
for f in presne:
    p = f["properties"]; x, y = f["geometry"]["coordinates"]
    bliz = sorted(((vzd((x, y), (o["lon"], o["lat"])), o) for o in objekty if abs(o["lon"] - x) < 0.0015 and abs(o["lat"] - y) < 0.001), key=lambda t: t[0])
    bliz = [(dd, o) for dd, o in bliz if dd <= 80 and not GEN.match(o["n"])]
    if not bliz:
        continue
    dd, o = bliz[0]
    # nove info = meno z OSM nie je v nazve zameru
    je_nove = bd(o["n"]).split()[0] not in bd(p["nazov"])
    nove += je_nove
    zhody.append((p["nazov"][:46], o["n"][:28], o["druh"], int(dd), je_nove, p.get("nazov_obch") or ""))

print("presných bodov: %d | s pomenovaným objektom do 80 m: %d (%.0f %%) | z toho meno NIE je v názve zámeru: %d"
      % (len(presne), len(zhody), 100.0 * len(zhody) / max(1, len(presne)), nove))
print("\nukážky (zámer <- OSM meno, druh, vzdialenosť):")
for z in [z for z in zhody if z[4]][:30]:
    print("   %-46s <- %-28s %-10s %3d m" % z[:4])
json.dump(zhody, open(os.path.join(TU, "osm_nazvy_test.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
