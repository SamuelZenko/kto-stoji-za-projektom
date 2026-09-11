# -*- coding: utf-8 -*-
"""Nove stromy vysadene mestom — z Geoportalu (Hosted/STROMY_Web_Public).

Verejna vrstva magistratu: kazdy strom ma druh (slovensky aj latinsky),
rok vysadby, projekt a pripadneho donora. Do mapy ide kompaktny JSON:
  {"_zdroj": ..., "s": [[lon, lat, "druh", rok, "projekt"], ...]}
Zaokruhlene na 6 desatinnych miest (~10 cm), bez mien donorov (fyzicke
osoby — nezverejnujeme).

Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" stromy_mesta.py
"""
import io
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VYSTUP = os.path.join(REPO, "mapa-zamerov", "stromy-mesta.json")
SLUZBA = ("https://geoportal.bratislava.sk/hSite/rest/services/Hosted/"
          "STROMY_Web_Public/FeatureServer/13/query")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE


def dopyt(**p):
    p.setdefault("f", "json")
    u = SLUZBA + "?" + urllib.parse.urlencode(p)
    with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "MIB-mapa/1.0"}),
                                timeout=120, context=CTX) as o:
        return json.loads(o.read().decode("utf-8"))


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    von, offset, krok = [], 0, 1000
    while True:
        d = dopyt(where="1=1", outFields="drevina_sk,drevina_lat,vysadba_rok,projekt,cestna_zel",
                  outSR=4326, resultOffset=offset, resultRecordCount=krok, returnGeometry="true")
        f = d.get("features", [])
        for x in f:
            g, a = x.get("geometry") or {}, x.get("attributes") or {}
            if g.get("x") is None:
                continue
            von.append([round(g["x"], 6), round(g["y"], 6),
                        (a.get("drevina_sk") or a.get("drevina_lat") or "").strip(),
                        a.get("vysadba_rok") or 0, (a.get("projekt") or "").strip()])
        print("  %d…" % len(von)); sys.stdout.flush()
        if len(f) < krok or not d.get("exceededTransferLimit", len(f) == krok):
            break
        offset += krok
    json.dump({"_zdroj": "Geoportál Bratislava, Hosted/STROMY_Web_Public — stromy vysadené mestom",
               "_polia": ["lon", "lat", "druh", "rok výsadby", "projekt"], "s": von},
              open(VYSTUP, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("stromov: %d, %s (%.0f kB)" % (len(von), VYSTUP, os.path.getsize(VYSTUP) / 1000))


if __name__ == "__main__":
    main()
