# -*- coding: utf-8 -*-
"""Oprava „presnych" poloh — krok A2.

Vrstva adresnych bodov na mestskom geoportali pokryva cele Slovensko
(1,7 miliona bodov), nie len Bratislavu. Povodne geokodovanie sa pytalo
len na nazov ulice, takze Bajkalska skoncila v Presove a Rozhavska
v Roznave — 47 zo 187 „presnych" bodov lezalo mimo mesta.

Tu sa kazda ulica hlada znova, ale v tej mestskej casti, ktoru uvadza
zamer (`Obec = 'Bratislava-Ruzinov'`). Ked tam nie je, skusi sa cela
Bratislava; ked ani to, bod sa vrati medzi priblizne.

Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" oprav_polohy.py
"""
import io
import json
import math
import os
import ssl
import sys
import time
import urllib.parse as up
import urllib.request as ur

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA = os.path.join(REPO, "mapa-zamerov")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_adresy_cache.json")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
ADR = ("https://geoportal.bratislava.sk/hSite/rest/services/budovy/"
       "Adresn%C3%A9_body/MapServer/0/query")


def j(u, pokusov=3):
    for i in range(pokusov):
        try:
            return json.loads(ur.urlopen(ur.Request(u, headers={"User-Agent": "Mozilla/5.0 MIB-mapa/1.0"}),
                                         timeout=90, context=CTX).read().decode("utf-8", "replace"))
        except Exception as e:
            if i == pokusov - 1:
                print("   dopyt zlyhal: %s" % str(e)[:60]); return {}
            time.sleep(3 * (i + 1))


try:
    cache = json.load(open(CACHE, encoding="utf-8"))
except (OSError, ValueError):
    cache = {}


def body_ulice(ulica, obec):
    """Priemer adresnych bodov ulice v danej obci; None, ked tam ulica nie je."""
    kl = obec + "|" + ulica
    if kl in cache:
        return cache[kl]
    v = j(ADR + "?" + up.urlencode({
        "where": "Ulica = '%s' AND Obec = '%s'" % (ulica.replace("'", "''"), obec.replace("'", "''")),
        "outFields": "Ulica", "returnGeometry": "true", "outSR": "4326", "f": "json",
        "resultRecordCount": 60}))
    b = [(g["x"], g["y"]) for g in ((f.get("geometry") or {}) for f in v.get("features", []))
         if g.get("x") and g.get("y")]
    cache[kl] = [round(sum(c[0] for c in b) / len(b), 6), round(sum(c[1] for c in b) / len(b), 6)] if b else None
    time.sleep(0.25)
    return cache[kl]


def body_ulice_ba(ulica):
    kl = "BA|" + ulica
    if kl in cache:
        return cache[kl]
    v = j(ADR + "?" + up.urlencode({
        "where": "Ulica = '%s' AND Obec LIKE 'Bratislava%%'" % ulica.replace("'", "''"),
        "outFields": "Obec", "returnGeometry": "true", "outSR": "4326", "f": "json",
        "resultRecordCount": 60}))
    fs = v.get("features", [])
    obce = {(f.get("attributes") or {}).get("Obec") for f in fs}
    b = [(g["x"], g["y"]) for g in ((f.get("geometry") or {}) for f in fs) if g.get("x") and g.get("y")]
    # ulica v dvoch mestskych castiach naraz = nevieme, ktora — radsej nic
    cache[kl] = ([round(sum(c[0] for c in b) / len(b), 6), round(sum(c[1] for c in b) / len(b), 6)]
                 if b and len(obce) == 1 else None)
    time.sleep(0.25)
    return cache[kl]


mc = json.load(open(os.path.join(MAPA, "mestske-casti.geojson"), encoding="utf-8"))
taziska = {}
for f in mc["features"]:
    a = f.get("properties") or {}
    nz = a.get("NAZOV_ZUJ") or a.get("MC_LABEL") or ""
    g = f["geometry"]
    kr = g["coordinates"][0] if g["type"] == "Polygon" else max(g["coordinates"], key=lambda p: len(p[0]))[0]
    taziska[nz] = [sum(c[0] for c in kr) / len(kr), sum(c[1] for c in kr) / len(kr)]

gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
v_mc = cela_ba = vratene = 0
for f in gj["features"]:
    p = f["properties"]
    if p.get("presnost") != "presná" or not p.get("ulica"):
        continue
    obec = (p.get("obec") or "").replace("Bratislava - ", "Bratislava-")
    xy = body_ulice(p["ulica"], obec)
    if xy:
        v_mc += 1; p["zdroj_polohy"] = "ulica v MČ"
    else:
        xy = body_ulice_ba(p["ulica"])
        if xy:
            cela_ba += 1; p["zdroj_polohy"] = "ulica v inej MČ"
    if xy:
        f["geometry"]["coordinates"] = xy
    else:
        # ulica v Bratislave nie je — bod sa vrati k tazisku mestskej casti
        vratene += 1
        p["presnost"] = "približná"; p.pop("ulica", None); p.pop("zdroj_polohy", None)
        t = taziska.get(p.get("obec"))
        if t:
            h = abs(hash(p["id"])) % 1000
            f["geometry"]["coordinates"] = [round(t[0] + math.cos(h) * 0.004, 6), round(t[1] + math.sin(h) * 0.003, 6)]
    if (v_mc + cela_ba + vratene) % 40 == 0:
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)

json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print("ulica najdena v udanej MČ:      %d" % v_mc)
print("ulica najdena inde v Bratislave: %d" % cela_ba)
print("vratene medzi priblizne:         %d" % vratene)
print("presnych spolu: %d" % sum(1 for f in gj["features"] if f["properties"].get("presnost") == "presná"))
