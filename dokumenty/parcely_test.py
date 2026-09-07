# -*- coding: utf-8 -*-
"""Test automatu na polohu z parciel — 50 projektov bez presnej polohy.

Postup pre kazdy projekt:
  1) z hlavneho dokumentu spisu (zamer, oznamenie o zmene, sprava
     o hodnoteni) sa vytiahne text (PyMuPDF, bez OCR)
  2) v texte sa hladaju parcelne cisla a katastralne uzemie
  3) parcely sa najdu v katastralnej vrstve geoportalu (register C,
     zaloha register E) a bod je tazisko ich zjednotenia
  4) bod musi lezat v mestskej casti, ktoru uvadza zamer — inak sa zahodi

Vystup: parcely_test_vysledok.json + suhrn na obrazovke. Geojson mapy
sa NEMENI — je to meranie, nie nasadenie.
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" parcely_test.py [pocet]
"""
import collections
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.parse as up
import urllib.request as ur
import zipfile

import pymupdf
from shapely.geometry import shape, Point, Polygon
from shapely.ops import unary_union

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA = os.path.join(REPO, "mapa-zamerov")
TU = os.path.dirname(os.path.abspath(__file__))
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa/1.0")
# pozor: adresa obsahuje %C4 — nesmie ist cez operator %, inak spadne formatovanie
KN = ("https://geoportal.bratislava.sk/hSite/rest/services/kataster/"
      "Kataster_nehnute%C4%BEnost%C3%AD_C_a_E/MapServer/{}/query")
# `parcely_test.py 50` = vzorka, `parcely_test.py vsetky` = cely beh nad
# vsetkymi stavbami bez presnej polohy (vysledok do parcely_vsetky_vysledok.json)
VSETKY = len(sys.argv) > 1 and sys.argv[1] == "vsetky"
POCET = 10 ** 6 if VSETKY else (int(sys.argv[1]) if len(sys.argv) > 1 else 50)
MAXMB, MAX_STRAN, MAX_DOK, MAX_PARCIEL = 25, 80, 3, 8
DEV = {"Bývanie", "Polyfunkcia", "Administratíva", "Vybavenosť", "Obchod a služby"}
HLAVNY = re.compile(r"z[áa]mer|ozn[áa]menie o zmene|spr[áa]va o hodnoten|textov[áa]|sprievodn", re.I)

# parcely: "parc. č. 123/4, 125, 126/1" aj "parcely registra C KN č. 855/13"
PARC = re.compile(
    r"parc\w*\.?\s*(?:reg\w*\.?\s*[„\"'“]?\s*[CE]\s*[„\"'”]?\s*(?:KN)?\s*)?"
    r"(?:[čc]\.|[čc][ií]sl\w*)?\s*:?\s*"
    r"((?:\d{1,5}\s*/\s*\d{1,4}|\d{2,5})(?:\s*[,;]\s*(?:a\s+)?(?:\d{1,5}\s*/\s*\d{1,4}|\d{2,5}))*)",
    re.I)
KU = re.compile(r"(?:(?<![a-záäčďéíĺľňóôšťúýž])k\.\s?[úu]\.|katastr[áa]ln\w{1,4}\s+[úu]zem\w+)\s*:?\s*"
                r"([A-ZÁÄČĎÉÍĹĽŇÓÔŠŤÚÝŽ][a-záäčďéíĺľňóôšťúýž]+(?:\s+[A-ZÁÄČĎÉÍĹĽŇÓÔŠŤÚÝŽ][a-záäčďéíĺľňóôšťúýž]+)?)")
KU_ZNAME = ["Staré Mesto", "Nivy", "Ružinov", "Trnávka", "Nové Mesto", "Vinohrady", "Rača", "Vajnory",
            "Karlova Ves", "Dúbravka", "Lamač", "Devín", "Devínska Nová Ves", "Záhorská Bystrica",
            "Petržalka", "Jarovce", "Rusovce", "Čunovo", "Podunajské Biskupice", "Vrakuňa"]


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


def stiahni(u):
    r = ur.Request(u, headers={"User-Agent": UA, "Referer": "https://www.enviroportal.sk/"})
    data = ur.urlopen(r, timeout=180, context=CTX).read()
    if data[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            v = [x for x in z.namelist() if x.lower().endswith(".pdf")]
            if not v:
                return None
            data = z.read(v[0])
    return data if data[:5] == b"%PDF-" else None


def text_pdf(data):
    d = pymupdf.open(stream=data, filetype="pdf")
    t = "".join(d.load_page(i).get_text() for i in range(min(MAX_STRAN, d.page_count)))
    d.close()
    return t


def parcely_z_textu(t):
    von = []
    for m in PARC.finditer(t):
        for c in re.findall(r"\d{1,5}\s*/\s*\d{1,4}|\d{2,5}", m.group(1)):
            c = re.sub(r"\s+", "", c)
            if c not in von and not (c.isdigit() and int(c) < 10):
                von.append(c)
        if len(von) >= MAX_PARCIEL:
            break
    return von[:MAX_PARCIEL]


def ku_z_textu(t):
    # dlhsie nazvy najprv — inak „Devínska Nová Ves" trafí „Devín"
    for m in KU.finditer(t):
        k = bd(m.group(1))
        for z in sorted(KU_ZNAME, key=len, reverse=True):
            # regex chytí najviac dve slová, „Devínska Nová" je prefix názvu
            if k.startswith(bd(z)) or (len(k) >= 8 and bd(z).startswith(k)):
                return z
    return None


_kn_cache = {}


def parcela_kn(cpa, register=0):
    kl = (cpa, register)
    if kl in _kn_cache:
        return _kn_cache[kl]
    pole = "register_c_202411.CPA" if register == 0 else "register_E_202412.CPA"
    try:
        r = json.loads(ur.urlopen(ur.Request(KN.format(register) + "?" + up.urlencode({
            "where": "%s = '%s'" % (pole, cpa), "outFields": "*", "returnGeometry": "true",
            "outSR": "4326", "f": "json"}), headers={"User-Agent": UA}), timeout=60, context=CTX)
            .read().decode("utf-8"))
    except Exception:
        r = {}
    von = []
    for f in r.get("features", []):
        a = {k.split(".")[-1]: v for k, v in f["attributes"].items()}
        try:
            g = Polygon(f["geometry"]["rings"][0])
        except Exception:
            continue
        von.append((a.get("KU"), g))
    _kn_cache[kl] = von
    time.sleep(0.3)
    return von


# mestske casti — na overenie, ze bod padol do spravnej
mc = json.load(open(os.path.join(MAPA, "mestske-casti.geojson"), encoding="utf-8"))
MC = {}
for f in mc["features"]:
    a = f.get("properties") or {}
    MC[a.get("NAZOV_ZUJ") or a.get("MC_LABEL") or ""] = shape(f["geometry"]).buffer(0)

gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))

# `plany` v geojsone su len graficke prilohy. Textova cast zameru — kde
# byvaju parcely — je v celom spise, ten je v stiahnutych detailoch.
DET = r"C:\Users\SAMUEL~1.ZEN\AppData\Local\Temp\claude\C--Users-samuel-zenko\f9e78086-b3b2-4b0e-a0ba-588d4220313d\scratchpad\eia_detaily"
GRAF = re.compile(r"situ[aá]c|v[yý]kres|[sš]ir[sš]ie vz[tť]ah|koordina|mapa|z[aá]kres|vizualiz|"
                  r"p[oô]dorys|podorys|rez\b|rezy|pohľad|pohlad|ortofoto|fotodok|grafick", re.I)


def cely_spis(zid):
    p = os.path.join(DET, zid + ".json")
    if not os.path.exists(p):
        for f in os.listdir(DET):
            if f.startswith(zid[:40]):
                p = os.path.join(DET, f); break
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception:
        return []
    dk = d.get("dokumenty"); von = []
    if not isinstance(dk, dict):
        return []
    for k in dk.get("data") or []:
        for sk in k.get("items") or []:
            if not isinstance(sk, dict):
                continue
            for it in sk.get("items") or []:
                if isinstance(it, dict) and it.get("url"):
                    von.append({"p": str(it.get("label") or ""), "u": "https://www.enviroportal.sk" + it["url"],
                                "v": int(it.get("filesize") or 0), "t": str(it.get("type") or "").upper(),
                                "sk": str(sk.get("title") or "")})
    return von


if VSETKY:
    kand = [f for f in gj["features"] if not f["properties"].get("lin")
            and f["properties"].get("presnost") != "presná"]
else:
    kand = [f for f in gj["features"] if f["properties"].get("typ") in DEV
            and f["properties"].get("presnost") != "presná"
            and any((d.get("t") or "").upper() == "PDF" for d in f["properties"].get("plany") or [])]
kand.sort(key=lambda f: f["properties"].get("zmena") or "", reverse=True)
kand = kand[:POCET]
VYSTUP = os.path.join(TU, "parcely_vsetky_vysledok.json" if VSETKY else "parcely_test_vysledok.json")
print("testujem %d projektov (%s)" % (len(kand), "vsetky stavby bez presnej polohy" if VSETKY else "developerske, bez presnej polohy, s PDF v spise"))

vysl, stav = [], collections.Counter()
t0 = time.time()
for n, f in enumerate(kand, 1):
    p = f["properties"]
    z = {"id": p["id"], "nazov": p["nazov"], "obec": p.get("obec"), "stav": "", "parcely": [], "ku": None, "bod": None, "dok": ""}
    vsetky = [d for d in cely_spis(p["id"]) if d["t"] == "PDF" and 2e5 < d["v"] <= MAXMB * 1e6]
    # textova cast: nie graficka priloha, najlepsie „zámer" / „oznámenie" / „správa";
    # z nich najvacsi (textova cast zameru ma desiatky stran)
    text_dok = [d for d in vsetky if not GRAF.search(d["p"])]
    hl = [d for d in text_dok if HLAVNY.search(d["p"]) or HLAVNY.search(d["sk"])]
    dk = sorted(hl or text_dok or vsetky, key=lambda d: -d["v"])[:MAX_DOK]
    parc, ku, text_ok = [], None, False
    for d in dk:
        try:
            data = stiahni(d["u"])
        except Exception:
            continue
        if not data:
            continue
        try:
            t = text_pdf(data)
        except Exception:
            continue
        if len(t.strip()) > 400:
            text_ok = True
        parc = parcely_z_textu(t)
        ku = ku_z_textu(t) or ku
        z["dok"] = d.get("p", "")[:50]
        time.sleep(0.4)
        if parc:
            break
    if not text_ok:
        z["stav"] = "sken bez textu"
    elif not parc:
        z["stav"] = "parcela v texte nie je"
    else:
        z["parcely"], z["ku"] = parc, ku
        mc_poly = MC.get(p.get("obec"))
        tvary = []
        for c in parc:
            for k, g in parcela_kn(c, 0) or parcela_kn(c, 1):
                if ku and k != ku:
                    continue
                if not ku and mc_poly is not None and not mc_poly.contains(g.centroid):
                    continue
                tvary.append(g)
        if not tvary:
            z["stav"] = "parcela sa v katastri nenasla"
        else:
            c = unary_union([g.buffer(0) for g in tvary]).centroid
            if mc_poly is not None and not mc_poly.contains(c):
                z["stav"] = "bod mimo udanej MC"
            else:
                z["stav"] = "OK"; z["bod"] = [round(c.x, 6), round(c.y, 6)]
    stav[z["stav"]] += 1
    vysl.append(z)
    print("   %2d/%d  %-8s %-48s %s" % (n, len(kand), z["stav"][:8], p["nazov"][:48],
                                        (", ".join(parc[:3]) + (" k.ú. " + ku if ku else "")) if parc else ""))
    sys.stdout.flush()
    if n % 25 == 0:   # priebezne ulozenie, keby beh spadol
        json.dump(vysl, open(VYSTUP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

json.dump(vysl, open(VYSTUP, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n" + "=" * 66)
print("VYSLEDOK — %d projektov, %.0f min" % (len(vysl), (time.time() - t0) / 60))
for k, v in stav.most_common():
    print("   %-32s %3d  (%.0f %%)" % (k, v, 100.0 * v / max(1, len(vysl))))
