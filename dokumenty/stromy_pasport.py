# -*- coding: utf-8 -*-
"""Stromy v sprave mesta — pasport drevin z Geoportalu (zp/pasport_STROMY_all).

281 887 stromov s vyskou (vyska_7, metre) a pri casti aj druhom (ns_slo).
Do mapy ide LEN poloha, vyska a druh. Pasport nesie aj mena dendrologov,
editorov, e-maily a donorov — tie sa nikdy nestahuju (outFields ich nema).

Format mapa-zamerov/stromy.json (kompaktny, delta kodovany):
  {"druhy": ["javor poľný", ...],
   "s": [dlon, dlat, vyska_dm, druh, dlon, dlat, ...]}
  lon/lat su cele cisla v mikrostupnoch (1e-6 °) ako rozdiel oproti
  predchadzajucemu stromu (zoradene podla lon), vyska v decimetroch,
  druh = index do `druhy` (-1 = neznamy). 282 tisic stromov ~ 3 MB,
  GitHub Pages to posle gzipovane.

Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" stromy_pasport.py
"""
import io
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VYSTUP = os.path.join(REPO, "mapa-zamerov", "stromy.json")
SLUZBA = ("https://geoportal.bratislava.sk/hSite/rest/services/zp/"
          "pasport_STROMY_all_do%C4%8Dasne/MapServer/2/query")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
KROK = 2000


def dopyt(**p):
    p.setdefault("f", "json")
    u = SLUZBA + "?" + urllib.parse.urlencode(p)
    for pokus in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "MIB-mapa/1.0"}),
                                        timeout=300, context=CTX) as o:
                return json.loads(o.read().decode("utf-8"))
        except Exception as e:
            if pokus == 3:
                raise
            time.sleep(5 * (pokus + 1))


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    stromy, offset, t0 = [], 0, time.time()
    while True:
        d = dopyt(where="typ_id=7", outFields="ns_slo,vyska_7", outSR=4326,
                  resultOffset=offset, resultRecordCount=KROK, returnGeometry="true",
                  geometryPrecision=6)
        f = d.get("features", [])
        for x in f:
            g, a = x.get("geometry") or {}, x.get("attributes") or {}
            # sluzba obcas vrati x/y ako "NaN" (retazec) — taky strom nema polohu
            if not isinstance(g.get("x"), (int, float)) or not isinstance(g.get("y"), (int, float)):
                continue
            v = a.get("vyska_7")
            stromy.append((round(g["x"] * 1e6), round(g["y"] * 1e6),
                           int(round(v * 10)) if isinstance(v, (int, float)) and v > 0 else 0,
                           (a.get("ns_slo") or "").strip()))
        offset += KROK
        if offset % 20000 == 0:
            print("  %d… (%.0f s)" % (len(stromy), time.time() - t0)); sys.stdout.flush()
        if len(f) < KROK:
            break
    # delta kodovanie: zoradit podla lon, ukladat rozdiely
    stromy.sort()
    druhy, idx = [], {}
    von, plon, plat = [], 0, 0
    for lon, lat, v, dr in stromy:
        if dr and dr not in idx:
            idx[dr] = len(druhy); druhy.append(dr)
        von.extend([lon - plon, lat - plat, v, idx.get(dr, -1)])
        plon, plat = lon, lat
    json.dump({"_zdroj": "Geoportál Bratislava, pasport drevín (zp/pasport_STROMY_all) — stromy v správe mesta; "
                         "len poloha, výška a druh",
               "_format": "s = [dlon, dlat, vyska_dm, druh, ...]; lon/lat delta v 1e-6°, zoradené podľa lon; druh = index do druhy, -1 neznámy",
               "_stiahnute": time.strftime("%Y-%m-%d"), "pocet": len(stromy), "druhy": druhy, "s": von},
              open(VYSTUP, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("stromov: %d, druhov: %d, %s (%.1f MB, %.0f min)"
          % (len(stromy), len(druhy), VYSTUP, os.path.getsize(VYSTUP) / 1e6, (time.time() - t0) / 60))


if __name__ == "__main__":
    main()
