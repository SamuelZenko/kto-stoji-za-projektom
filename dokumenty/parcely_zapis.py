# -*- coding: utf-8 -*-
"""Zapise polohy z parciel (vystup parcely_test.py vsetky) do mapy.

Berie len vysledky so stavom OK — bod lezi v mestskej casti, ktoru zamer
uvadza. Bod dostane presnost „presná", zdroj_polohy „parcela" a zoznam
parciel, aby bolo v karte vidiet, odkial poloha je.
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" parcely_zapis.py
"""
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
v = json.load(open(os.path.join(TU, "parcely_vsetky_vysledok.json"), encoding="utf-8"))
ok = {x["id"]: x for x in v if x.get("stav") == "OK" and x.get("bod")}
gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
n = 0
for f in gj["features"]:
    p = f["properties"]
    x = ok.get(p["id"])
    if not x or p.get("presnost") == "presná":
        continue
    f["geometry"]["coordinates"] = x["bod"]
    p["presnost"] = "presná"
    p["zdroj_polohy"] = "parcela"
    p["parcely"] = x["parcely"][:6]
    if x.get("ku"):
        p["ku"] = x["ku"]
    n += 1
json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("zapisanych poloh z parciel: %d" % n)
print("presnych spolu: %d z %d" % (sum(1 for f in gj["features"] if f["properties"].get("presnost") == "presná"), len(gj["features"])))
