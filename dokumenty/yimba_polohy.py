# -*- coding: utf-8 -*-
"""Polohy projektov z yimba.sk a ich naviazanie na nase zamery.

Preco prave yimba: pri kazdom projekte ma v HTML marker so suradnicami
(`data-lat`, `data-long`) a — co je dolezitejsie — odkazuje na detail EIA na
enviroportali. Slug v tom odkaze je presne nase `id` zameru, takze sa neparuje
podla nazvu (kde „Polyfunkcny komplex HINOHARA PARK - 1. etapa" vs „Hinohara
Park" je hadanie), ale presne.

Vystup: yimba_projekty.json  — vsetko, co sa nacitalo zo stranok
        yimba_navrhy.json    — len to, co sa naviazalo na zamer v nasej mape

Mapa sa nemeni. Zapis robi polohy_zapis2.py po kontrole.

Pozor: skript chodi po cudzom webe. Chodi pomaly (0,7 s medzi stranami), hlasi
sa vlastnou hlavickou a vsetko si uklada, aby sa nemusel pustat opakovane.

Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" yimba_polohy.py
"""
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.request as ur

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
VSETKO = os.path.join(TU, "yimba_projekty.json")
NAVRHY = os.path.join(TU, "yimba_navrhy.json")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa-zamerov/1.0")
BAZA = "https://www.yimba.sk"
MARKER = re.compile(r'data-lat="([\d.]+)"\s+data-long="([\d.]+)"\s+title="([^"]*)"\s+data-link="([^"]*)"')
EIA = re.compile(r'enviroportal\.sk/eia/detail/([a-z0-9\-]+)')
H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
ODKAZ = re.compile(r'href="(/[a-z0-9\-]{4,70})"')
NIE_PROJEKT = set("""zoznam-projektov zoznam-clankov archiv-projektov videa o-nas kontakt
podpora reklama pravidla ochrana-osobnych-udajov prihlasenie registracia newsletter""".split())


def web(u):
    return ur.urlopen(ur.Request(u, headers={"User-Agent": UA}),
                      timeout=60, context=CTX).read().decode("utf-8", "replace")


def log(s):
    print(s)
    sys.stdout.flush()


# 1. zoznam projektov
slugy = []
for zoz in ("/zoznam-projektov", "/archiv-projektov"):
    try:
        h = web(BAZA + zoz)
    except Exception as e:
        log("zoznam %s chyba: %s" % (zoz, e))
        continue
    for s in ODKAZ.findall(h):
        s = s.strip("/")
        if s and s not in NIE_PROJEKT and "/" not in s and s not in slugy:
            slugy.append(s)
log("projektovych odkazov: %d" % len(slugy))

# 2. stranky projektov (s cache, aby sa opakovany beh nepytal znova)
proj = {}
if os.path.exists(VSETKO):
    proj = {p["slug"]: p for p in json.load(io.open(VSETKO, encoding="utf-8"))}
    log("z cache uz mam: %d" % len(proj))


def uloz():
    json.dump(sorted(proj.values(), key=lambda p: p["slug"]),
              io.open(VSETKO, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


nove = [s for s in slugy if s not in proj]
for i, s in enumerate(nove, 1):
    try:
        h = web(BAZA + "/" + s)
    except Exception as e:
        proj[s] = {"slug": s, "chyba": str(e)[:60], "body": [], "eia": []}
        log("  %3d/%d  %-44s CHYBA %s" % (i, len(nove), s[:44], str(e)[:40]))
        time.sleep(0.7)
        continue
    nazov = re.sub(r"<[^>]+>", "", (H1.search(h).group(1) if H1.search(h) else "")).strip()
    body = [{"lat": float(a), "lon": float(b), "nazov": c.strip(), "odkaz": d}
            for a, b, c, d in MARKER.findall(h)]
    eia = sorted(set(EIA.findall(h)))
    proj[s] = {"slug": s, "nazov": nazov, "body": body, "eia": eia}
    log("  %3d/%d  %-44s bodov=%d  EIA=%d" % (i, len(nove), (nazov or s)[:44], len(body), len(eia)))
    if i % 10 == 0:
        uloz()
    time.sleep(0.7)
uloz()

# 3. naviazanie na nase zamery
gj = json.load(io.open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
zam = {f["properties"]["id"]: f for f in gj["features"]}
navrhy, bez_bodu, bez_zameru = [], 0, 0
for p in proj.values():
    if not p.get("eia"):
        continue
    # bod projektu: marker, ktory ukazuje sam na seba, inak prvy
    vlastny = [b for b in p["body"] if b["odkaz"].strip("/") == p["slug"]] or p["body"]
    if not vlastny:
        bez_bodu += 1
        continue
    b = vlastny[0]
    for zid in p["eia"]:
        f = zam.get(zid)
        if not f:
            bez_zameru += 1
            continue
        stare = f["geometry"]["coordinates"]
        dx = (b["lon"] - stare[0]) * 111320 * 0.667
        dy = (b["lat"] - stare[1]) * 110540
        navrhy.append({
            "id": zid, "nazov": f["properties"]["nazov"], "obec": f["properties"].get("obec"),
            "faza": "5", "stav": "OK", "bod": [round(b["lon"], 6), round(b["lat"], 6)],
            "presnost": "projekt", "doterajsia_presnost": f["properties"].get("presnost"),
            "doterajsi_zdroj": f["properties"].get("zdroj_polohy"),
            "posun_m": round((dx * dx + dy * dy) ** 0.5),
            "zdroj": "yimba.sk, projekt „%s“ (%s/%s)" % (p.get("nazov") or p["slug"], BAZA, p["slug"]),
            "pozn": "marker „%s“ na stránke projektu; stránka odkazuje na tento spis EIA"
                    % b["nazov"]})

navrhy.sort(key=lambda z: -z["posun_m"])
json.dump(navrhy, io.open(NAVRHY, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

log("\n" + "=" * 74)
log("projektov so suradnicami: %d z %d" % (sum(1 for p in proj.values() if p.get("body")), len(proj)))
log("projektov s odkazom na EIA: %d" % sum(1 for p in proj.values() if p.get("eia")))
log("naviazanych na nase zamery: %d  (odkaz na EIA, ktory v mape nemame: %d)" % (len(navrhy), bez_zameru))
nove_pol = [z for z in navrhy if z["doterajsia_presnost"] != "presná"]
log("z toho zamerov, ktore dnes polohu NEMAJU: %d" % len(nove_pol))
log("\nnajvacsie posuny oproti dnesnej mape:")
for z in navrhy[:15]:
    log("  %6d m  %-16s %s" % (z["posun_m"], z["doterajsia_presnost"] or "?", z["nazov"][:52]))
log("\nvystup: %s" % NAVRHY)
