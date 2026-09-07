# -*- coding: utf-8 -*-
"""Ochranne znamky developerov z WebRegistrov UPV SR — hladanie podla majitela.

TMview vie hladat len znenie znamky. WebRegistre UPV (wbr.indprop.gov.sk)
maju vo formulari pole „prihlasovatel / majitel" a vysledky pridu ako
obycajna GET stranka — staci session cookie z uvodnej stranky a plna sada
parametrov, ktoru posiela prehliadac (s okliestenou vracia server 500).

Pyta sa na developerske skupiny (tokeny z tabulky skupin) a na firmy
navrhovatelov developerskych projektov. Pauza 1,5 s medzi dopytmi.
Vystup: znamky_upv.json  { dopyt: [ {znenie, majitel, ncl, stav, cislo, datum} ] }
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" znamky_upv.py
"""
import http.cookiejar as cj
import html as H
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.parse as up
import urllib.request as ur

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
VON = os.path.join(TU, "znamky_upv.json")
sys.path.insert(0, r"C:\Users\samuel.zenko\Downloads\mib-register\mib-register")
try:
    import skupiny
    SKUPINY = skupiny.SKUPINY
except ImportError:
    SKUPINY = []

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
jar = cj.CookieJar()
op = ur.build_opener(ur.HTTPCookieProcessor(jar), ur.HTTPSHandler(context=CTX))
B = "https://wbr.indprop.gov.sk/WebRegistre/OchrannaZnamka/SearchResults?"
NICE_REAL = {"35", "36", "37", "42", "43"}
DEV = {"Bývanie", "Polyfunkcia", "Administratíva", "Vybavenosť", "Obchod a služby"}
GEN = {"development", "invest", "investment", "real", "estate", "reality", "property", "group", "holding",
       "slovakia", "slovensko", "bratislava", "stavby", "projekt", "project", "land", "capital", "management",
       "company", "building", "construction", "partners", "fund", "developer", "residential", "residence",
       "home", "homes", "byty", "dom", "domy", "park", "city", "centrum", "center", "office", "tower",
       "nehnutelnosti", "immo", "sro", "as", "spol"}
_t = [0.0]


def get(u):
    c = 1.5 - (time.time() - _t[0])
    if c > 0:
        time.sleep(c)
    _t[0] = time.time()
    for i in range(3):
        try:
            return op.open(ur.Request(u, headers={"User-Agent": UA, "Accept-Language": "sk", "Accept": "text/html"}),
                           timeout=90).read().decode("utf-8", "replace")
        except Exception as e:
            if i == 2:
                print("   dopyt zlyhal: %s" % str(e)[:60]); return ""
            time.sleep(5)


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


def cist(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def riadky(h):
    tb = re.search(r"<table.*?</table>", h, re.S)
    if not tb:
        return []
    von = []
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", tb.group(0), re.S):
        b = [cist(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(b) < 11 or not b[0].startswith("Označiť"):
            continue
        von.append({"znenie": b[3], "cislo": b[4] or b[5], "datum": b[6], "stav": b[7],
                    "pravny": b[8], "majitel": b[9], "ncl": [x.strip() for x in b[10].split(",") if x.strip()]})
    return von


def strany(h):
    """Odkazy na dalsie strany vysledkov (2, 3, …) — absolutne URL."""
    von = []
    for href, txt in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>\s*(\d+)\s*</a>', h):
        if "SearchResults" in href and txt.isdigit() and int(txt) > 1:
            von.append((int(txt), H.unescape(href)))
    return sorted(set(von))


def hladaj(majitel):
    p = {"HlaskaStav": "VyhodHlasku", "ItemPPType": "NotSelected", "SearchType": "BasicSearch",
         "SearchResultsMaxReached": "False", "HighlightSearchCriteria": "True", "SearchExternalDatabases": "False",
         "IsFulltextSearch": "False", "SearchTimeout": "False", "SearchCBO_PrihlasovatelMajitel": majitel,
         "SearchCBO_PoslednyRokPlatnosti": "False", "SearchCBO_AktualnaPlatnostKonciNasledujuciMesiac": "False",
         "IsSearchSimilarMPT": "True", "IsSearchSimilarMTD": "True", "IsSearchSimilarMTOP": "True",
         "IsSearchSimilarPrihlasovatelovMajitelov": "True", "IsSearchSimilarPovodcov": "True",
         "IsSearchSimilarZnenieReprodukciuOZ": "True", "IsSearchSimilarCisloZakladnehoPatentu": "True"}
    h = get(B + up.urlencode(p))
    von = riadky(h)
    videne = set()
    for n, href in strany(h)[:9]:          # max 10 stran = 500 znamok na majitela
        if n in videne:
            continue
        videne.add(n)
        u = href if href.startswith("http") else "https://wbr.indprop.gov.sk" + href
        von += riadky(get(u))
    return von


def ma_zmysel(z, dopyt):
    if not z["znenie"] or z["znenie"] == "-":
        return False
    if not (set(z["ncl"]) & NICE_REAL):
        return False
    if re.search(r"zamietnut|zastaven|vzat", z["stav"], re.I) or re.search(r"zanik|vymaz|zru[sš]", z["pravny"], re.I):
        return False
    # podobnostne hladanie vracia aj cudzich majitelov — musi obsahovat dopyt
    return bd(dopyt) in bd(z["majitel"])


# ── koho sa pytat ───────────────────────────────────────────────────
dopyty = []
for s in SKUPINY:
    for t in s.get("tokeny", [])[:2]:
        if len(t) >= 4:
            dopyty.append((t, s["nazov"]))
gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
firmy = {}
PF = re.compile(r"\b(a\.?\s?s\.?|s\.?\s?r\.?\s?o\.?|spol\.?|k\.?\s?s\.?|j\.?\s?s\.?\s?a\.?|ltd|gmbh|se)\b", re.I)
for f in gj["features"]:
    p = f["properties"]
    if p.get("typ") not in DEV or p.get("lin"):
        continue
    fn = PF.sub(" ", (p.get("firma") or "").split(",")[0])
    fn = re.sub(r"[\"„“”()]", " ", fn).strip(" .-–")
    tok = [t for t in re.findall(r"[A-Za-zÁ-ž0-9&'\-]+", fn) if bd(t) not in GEN and not t.isdigit()]
    if not tok or len(" ".join(tok)) < 4:
        continue
    kl = " ".join(tok[:3])
    firmy.setdefault(kl, set()).add(p["id"])
for kl, ids in sorted(firmy.items(), key=lambda x: -len(x[1])):
    if kl.lower() not in {d[0].lower() for d in dopyty}:
        dopyty.append((kl, None))
print("dopytov: %d (skupiny %d, firmy %d)" % (len(dopyty), sum(1 for d in dopyty if d[1]), sum(1 for d in dopyty if not d[1])))

# ── zber ────────────────────────────────────────────────────────────
try:
    vysl = json.load(open(VON, encoding="utf-8"))
except (OSError, ValueError):
    vysl = {}
get("https://wbr.indprop.gov.sk/WebRegistre/OchrannaZnamka")     # session
t0 = time.time()
for i, (d, sk) in enumerate(dopyty, 1):
    if d in vysl:
        continue
    zn = [z for z in hladaj(d) if ma_zmysel(z, d)]
    videne, cist_zn = set(), []
    for z in zn:
        k = bd(z["znenie"])
        if k not in videne:
            videne.add(k); z["skupina"] = sk; cist_zn.append(z)
    vysl[d] = cist_zn
    if cist_zn or i % 10 == 0:
        print("   %3d/%d  %-28s %3d známok  %s" % (i, len(dopyty), d[:28], len(cist_zn),
              ", ".join(z["znenie"][:24] for z in cist_zn[:5])))
        sys.stdout.flush()
    if i % 10 == 0:
        json.dump(vysl, open(VON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(vysl, open(VON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
n = sum(len(v) for v in vysl.values())
print("\nhotovo: %d dopytov, %d realitných známok, %.0f min" % (len(vysl), n, (time.time() - t0) / 60))
