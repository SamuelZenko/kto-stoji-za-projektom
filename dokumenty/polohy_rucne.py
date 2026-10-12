# -*- coding: utf-8 -*-
"""Zapise rucne overene polohy z polohy_rucne.json do mapy zamerov.

Rucne overena poloha ma najvyssiu doveru, preto prepisuje aj bod oznaceny
ako „presna" (automat z parciel mohol trafit vedlajsiu parcelu). Kazdy zapis
dostane presnost „presna", zdroj_polohy „rucne" a text zdroja do polohy_zdroj,
aby bolo v karte vidiet, odkial poloha je a kto ju overil.

Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" polohy_rucne.py
"""
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
GJ = os.path.join(MAPA, "zamery.geojson")

rucne = json.load(io.open(os.path.join(TU, "polohy_rucne.json"), encoding="utf-8"))["zamery"]
podla_id = {z["id"]: z for z in rucne}
gj = json.load(io.open(GJ, encoding="utf-8"))

n = 0
chybne = list(podla_id)
for f in gj["features"]:
    p = f["properties"]
    z = podla_id.get(p["id"])
    if not z:
        continue
    chybne.remove(p["id"])
    stare = f["geometry"]["coordinates"]
    f["geometry"]["coordinates"] = [round(z["bod"][0], 6), round(z["bod"][1], 6)]
    p["presnost"] = "presná"
    p["zdroj_polohy"] = "ručne"
    p["poloha_zdroj"] = z["zdroj"]
    if z.get("poznamka"):
        p["poloha_poznamka"] = z["poznamka"]
    n += 1
    # posun v metroch, nech je vidiet, o kolko bola mapa vedla
    dx = (z["bod"][0] - stare[0]) * 111320 * 0.667
    dy = (z["bod"][1] - stare[1]) * 110540
    print("  %-62s posun %5.0f m" % (z["nazov"][:62], (dx * dx + dy * dy) ** 0.5))

if chybne:
    print("\nPOZOR, tieto id v mape nie su: %s" % ", ".join(chybne))

json.dump(gj, io.open(GJ, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
presne = sum(1 for f in gj["features"] if f["properties"].get("presnost") == "presná")
print("\nzapisanych rucnych poloh: %d" % n)
print("presnych spolu: %d z %d (priblizne: %d)" % (presne, len(gj["features"]), len(gj["features"]) - presne))
