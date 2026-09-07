# -*- coding: utf-8 -*-
"""Oprava presnych poloh, cast 2 — co nesedi s hranicami, ide medzi priblizne.

  - presny bod mimo Bratislavy (8) — chybne geokodovanie z prveho zberu
  - ulica najdena len v INEJ mestskej casti, nez zamer uvadza (22) —
    skor faloshna zhoda slova („Technická" z „technická infraštruktúra")
    nez zle uvedena mestska cast
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" oprav_polohy2.py
"""
import io
import json
import math
import os
import sys

from shapely.geometry import shape, Point
from shapely.ops import unary_union

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
MAPA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mapa-zamerov")
mc = json.load(open(os.path.join(MAPA, "mestske-casti.geojson"), encoding="utf-8"))
MC, taz = {}, {}
for f in mc["features"]:
    a = f["properties"]; nz = a.get("NAZOV_ZUJ") or a.get("MC_LABEL")
    g = shape(f["geometry"]).buffer(0); MC[nz] = g; taz[nz] = (g.centroid.x, g.centroid.y)
ba = unary_union(list(MC.values()))

gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
mimo = inde = 0
for f in gj["features"]:
    p = f["properties"]
    if p.get("presnost") != "presná":
        continue
    pt = Point(f["geometry"]["coordinates"])
    dovod = None
    if not ba.contains(pt):
        dovod = "mimo"; mimo += 1
    elif p.get("zdroj_polohy") == "ulica v inej MČ":
        dovod = "inde"; inde += 1
    if not dovod:
        continue
    p["presnost"] = "približná"
    for k in ("ulica", "zdroj_polohy"):
        p.pop(k, None)
    t = taz.get(p.get("obec"))
    if t:
        h = abs(hash(p["id"])) % 1000
        f["geometry"]["coordinates"] = [round(t[0] + math.cos(h) * 0.004, 6), round(t[1] + math.sin(h) * 0.003, 6)]
json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("vratene medzi priblizne: mimo Bratislavy %d, ulica v inej MC %d" % (mimo, inde))
print("presnych spolu: %d z %d" % (sum(1 for f in gj["features"] if f["properties"].get("presnost") == "presná"), len(gj["features"])))
