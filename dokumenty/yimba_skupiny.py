# -*- coding: utf-8 -*-
"""Developer (skupina) a dalsie polia z yimba.sk — jednorazovo, na doplnenie
skupin v mape zamerov. Nadvazuje na yimba_polohy.py (zoznam projektov +
markery + odkazy na EIA v yimba_projekty.json).

Co robi:
 1. pre kazdy projekt stiahne stranku a vytiahne polia Stvrt / Developer / Typ /
    Architekt / Status / Realizacia + tabulku (podlazia, vyska, byty); ulozi do
    yimba_detaily.json (cache — opakovany beh nic nestahuje znova)
 2. sparuje projekty s nasimi zamermi:
      eia      — stranka yimby odkazuje na spis EIA = nase id (iste)
      poloha+nazov — marker projektu do 150 m od nasej presnej polohy a zhoda
                 vyznamneho slova v nazve (iste)
      poloha   — len do 60 m, bez zhody nazvu (na rucne posudenie)
      nazov    — len podobnost nazvu (na rucne posudenie)
 3. vystup:
      yimba_skupiny_navrhy.csv  — vsetky kandidati, stlpec Prijat (A = iste)
      ../mapa-zamerov/yimba.json — len iste paroviania; mapa ich zluci v prehliadaci
                                   a v karte pise „podla yimba.sk"

Stahuje sa pomaly (0,7 s), vlastna hlavicka. Beh:
"C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" yimba_skupiny.py [--bez-stahovania]
"""
import csv
import html
import io
import json
import math
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.request as ur

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
PROJEKTY = os.path.join(TU, "yimba_projekty.json")
DETAILY = os.path.join(TU, "yimba_detaily.json")
CSV_OUT = os.path.join(TU, "yimba_skupiny_navrhy.csv")
# do mapy ide az vysledok overenia v registroch (overenie_skupin.py); tipy ostavaju tu
JSON_OUT = os.path.join(TU, "yimba_tipy.json")
BAZA = "https://www.yimba.sk"
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa-zamerov/1.0")
POLE = re.compile(r'<div class="label">(.*?)</div>\s*<div class="description[^"]*">(.*?)</div>', re.S)
RIADOK = re.compile(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", re.S)
STOP = set("""bytovy bytove dom domy polyfunkcny polyfunkcna polyfunkcne objekt objekty bratislava etapa
etapy subor obytny obytna obytne komplex administrativna administrativne budova budovy ulica ulici cast zona
centrum stavba vystavba novostavba rezidencia rezidencie mestska mesto nove nova novy byvanie byty park
bratislave petrzalka ruzinov lamac raca dubravka vajnory karlova ves stare nove mesto zmena cinnosti
navrhovanej rekonstrukcia dostavba prestavba parkovisko parkovaci garaz garaze""".split())


def cisty(s):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    return re.sub(r"\s+", " ", s).strip()


def bd(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return s


def slova(s):
    return {w for w in re.findall(r"[a-z0-9]{3,}", bd(s)) if w not in STOP}


def web(u):
    return ur.urlopen(ur.Request(u, headers={"User-Agent": UA}), timeout=60, context=CTX).read().decode("utf-8", "replace")


def log(s):
    print(s); sys.stdout.flush()


# ---------- 1. detaily projektov ----------
proj = json.load(io.open(PROJEKTY, encoding="utf-8"))
det = {}
if os.path.exists(DETAILY):
    det = {d["slug"]: d for d in json.load(io.open(DETAILY, encoding="utf-8"))}


def uloz_det():
    json.dump(sorted(det.values(), key=lambda d: d["slug"]), io.open(DETAILY, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if "--bez-stahovania" not in sys.argv:
    nove = [p for p in proj if p["slug"] not in det and not p.get("chyba")]
    log("projektov: %d, uz v cache: %d, na stiahnutie: %d" % (len(proj), len(det), len(nove)))
    for i, p in enumerate(nove, 1):
        s = p["slug"]
        try:
            h = web(BAZA + "/" + s)
        except Exception as e:
            det[s] = {"slug": s, "chyba": str(e)[:60]}
            log("  %3d/%d  %-44s CHYBA %s" % (i, len(nove), s[:44], str(e)[:40]))
            time.sleep(0.7); continue
        d = {"slug": s, "nazov": p.get("nazov") or s, "url": BAZA + "/" + s}
        for k, v in POLE.findall(h):
            d[bd(cisty(k)).replace(" ", "_")] = cisty(v)
        for k, v in RIADOK.findall(h):
            d["t_" + bd(cisty(k)).replace(" ", "_")[:40]] = cisty(v)
        det[s] = d
        log("  %3d/%d  %-40s developer=%s" % (i, len(nove), d["nazov"][:40], d.get("developer", "—")[:30]))
        if i % 10 == 0:
            uloz_det()
        time.sleep(0.7)
    uloz_det()

# ---------- 2. parovanie ----------
gj = json.load(io.open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
feats = [f for f in gj["features"] if f.get("geometry") and f["geometry"]["type"] == "Point"]
zam = {f["properties"]["id"]: f for f in feats}


def vzd(lon1, lat1, lon2, lat2):
    dx = (lon1 - lon2) * 111320 * math.cos(math.radians(lat1))
    dy = (lat1 - lat2) * 110540
    return (dx * dx + dy * dy) ** 0.5


kand = []   # (istota, id, slug, posun, dovod)
for p in proj:
    d = det.get(p["slug"]) or {}
    if not d.get("developer"):
        continue
    sl_y = slova(d.get("nazov") or p.get("nazov") or "")
    vlastny = [b for b in p.get("body", []) if b["odkaz"].strip("/") == p["slug"]] or p.get("body", [])
    bod = vlastny[0] if vlastny else None
    videne = set()
    for zid in p.get("eia", []):
        if zid in zam:
            kand.append(("eia", zid, p["slug"], None, "stránka yimby odkazuje na tento spis EIA")); videne.add(zid)
    for f in feats:
        pr = f["properties"]; zid = pr["id"]
        if zid in videne:
            continue
        sl_z = slova(pr.get("nazov_obch") or "") | slova(pr.get("nazov") or "")
        zhoda = sl_y & sl_z
        m = None
        if bod and pr.get("presnost") == "presná":
            lon, lat = f["geometry"]["coordinates"]
            m = vzd(bod["lon"], bod["lat"], lon, lat)
        if m is not None and m <= 150 and zhoda:
            kand.append(("poloha+nazov", zid, p["slug"], round(m), "marker do 150 m + slovo „%s“" % sorted(zhoda)[0]))
        elif m is not None and m <= 60:
            kand.append(("poloha", zid, p["slug"], round(m), "marker do 60 m, názov nesedí"))
        elif zhoda and len(zhoda) >= max(2, min(len(sl_y), len(sl_z)) * 0.6) and len(sl_y) >= 1:
            kand.append(("nazov", zid, p["slug"], round(m) if m is not None else None,
                         "podobný názov (%s)" % ", ".join(sorted(zhoda)[:3])))

# jeden zamer moze mat viac kandidatov — nechame vsetky v CSV, do mapy ide najlepsi isty
poradie = {"eia": 0, "poloha+nazov": 1, "poloha": 2, "nazov": 3}
kand.sort(key=lambda k: (k[1], poradie[k[0]], k[3] or 0))
riadky, do_mapy = [], {}
for ist, zid, slug, posun, dovod in kand:
    pr = zam[zid]["properties"]; d = det[slug]
    iste = ist in ("eia", "poloha+nazov")
    # yimba niekedy ako „developera" uvedie samotne SPV (BestWine, s.r.o.) — to
    # skupinu nepridava a nesmie prepisat indiciu (Penta) nazvom firmy → len do CSV
    dv, fi = slova(d["developer"]), slova(pr.get("firma", ""))
    if dv and fi and dv <= fi:
        iste = False; dovod += "; developer = navrhovateľ (SPV), nie skupina"
    r = {"Prijat": "A" if iste else "", "istota": ist, "id": zid, "zamer": pr.get("nazov", ""),
         "firma_EIA": pr.get("firma", ""), "skupina_doteraz": pr.get("skupina", ""), "sk_ist_doteraz": pr.get("sk_ist", ""),
         "yimba_projekt": d.get("nazov", ""), "yimba_developer": d.get("developer", ""), "yimba_status": d.get("status", ""),
         "yimba_realizacia": d.get("realizacia", ""), "yimba_vyska": d.get("t_vyska_(v_metroch)", ""),
         "yimba_architekt": d.get("architekt", ""), "posun_m": posun if posun is not None else "", "dovod": dovod,
         "yimba_url": d["url"]}
    riadky.append(r)
    if iste and zid not in do_mapy:
        do_mapy[zid] = {"skupina": d["developer"], "url": d["url"], "nazov": d.get("nazov", ""),
                        "istota": ist, "status": d.get("status", ""), "realizacia": d.get("realizacia", ""),
                        "vyska": d.get("t_vyska_(v_metroch)", ""), "architekt": d.get("architekt", "")}

with io.open(CSV_OUT, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(riadky[0].keys()) if riadky else ["Prijat"], delimiter=";")
    w.writeheader(); w.writerows(riadky)
json.dump({"zdroj": "yimba.sk, pole Developer na stránke projektu, stiahnuté " + time.strftime("%Y-%m-%d"),
           "zamery": do_mapy}, io.open(JSON_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ---------- 3. suhrn ----------
dev = [d for d in det.values() if d.get("developer")]
log("\n" + "=" * 74)
log("projektov s polom Developer: %d z %d" % (len(dev), len(det)))
for ist in poradie:
    log("  %-13s %4d kandidátov" % (ist, sum(1 for k in kand if k[0] == ist)))
log("do mapy (isté, jeden na zámer): %d" % len(do_mapy))
nov = sum(1 for zid, y in do_mapy.items() if zam[zid]["properties"].get("sk_ist") != "dolozena")
log("  z toho zámerov bez doloženej skupiny: %d" % nov)
ine = [(zid, zam[zid]["properties"].get("skupina"), y["skupina"]) for zid, y in do_mapy.items()
       if zam[zid]["properties"].get("skupina") and bd(zam[zid]["properties"]["skupina"]).split()[0] not in bd(y["skupina"])]
log("  nezhoda s doterajšou skupinou (indíciou): %d" % len(ine))
for zid, a, b in ine[:15]:
    log("     %-50s mapa: %-22s yimba: %s" % (zid[:50], a[:22], b))
log("\nvystup: %s\n        %s" % (CSV_OUT, JSON_OUT))
