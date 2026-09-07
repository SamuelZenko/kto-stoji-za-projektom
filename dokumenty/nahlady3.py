# -*- coding: utf-8 -*-
"""Nahlady grafickych podkladov zo spisov — cely beh, s otocenim podla pisma.

Vykresy v spisoch byvaju ulozene nalezato alebo otocene o 90 stupnov.
PyMuPDF vie pri kazdom riadku textu smer pisania; berie sa prevladajuci
smer na strane a strana sa otoci tak, aby sa text cital zlava doprava.
Skeny bez textovej vrstvy ostanu tak, ako su.

Prepisuje vsetky nahlady (aj tie z prveho behu, tie boli bez otocenia).
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" nahlady3.py
"""
import collections
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.request
import zipfile

import pymupdf

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA = os.path.join(REPO, "mapa-zamerov")
NAH = os.path.join(MAPA, "nahlady")
os.makedirs(NAH, exist_ok=True)
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa/1.0")
MAX_MB, SIRKA, NA_ZAMER, ROZPOCET_MB = 6.0, 620, 4, 9000
PREDNOST = [(r"situ[aá]c", 0), (r"vizualiz|perspekt", 1),
            (r"[sš]ir[sš]ie vz[tť]ah|koordina|z[aá]kres", 2),
            (r"v[yý]kres|p[oô]dorys|rez\b", 3)]
# dokumenty, ktore sa nesmu ukazat — mena, rodne cisla, vlastnictvo
ZAKAZ = re.compile(r"list vlastn|\bLV\b|vlastn[ií]ck|pln[aá] moc|splnomocn|zmluv|dohod|"
                   r"rodn[eé] [čc][ií]slo|ob[čc]iansk|preukaz|doklad|v[yý]pis|rozhodnut|"
                   r"stanovisk|vyjadren|ziados|žiados|potvrden|s[uú]hlas|protokol", re.I)


def poradie(p):
    t = (p or "").lower()
    for vz, r in PREDNOST:
        if re.search(vz, t):
            return r
    return 9


def otocenie(page):
    """O kolko stupnov otocit stranu, aby sa text cital zlava doprava.
    Vrati None, ked strana nema textovu vrstvu."""
    smer = collections.Counter()
    try:
        d = page.get_text("dict")
    except Exception:
        return None
    for b in d.get("blocks", []):
        for l in b.get("lines", []):
            dx, dy = l.get("dir", (1, 0))
            n = sum(len(s.get("text", "")) for s in l.get("spans", []))
            if n < 3:
                continue
            if abs(dx) >= abs(dy):
                smer[0 if dx > 0 else 180] += n
            else:
                smer[90 if dy < 0 else 270] += n
    if not smer:
        return None
    k, n = smer.most_common(1)[0]
    if n < 20:
        return None
    return k


def render(url, ciel):
    r = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.enviroportal.sk/"})
    with urllib.request.urlopen(r, timeout=120, context=CTX) as o:
        data = o.read(int(MAX_MB * 1e6) + 1)
    if len(data) > MAX_MB * 1e6:
        return 0, None
    mb = len(data) / 1e6
    if data[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            v = [x for x in z.namelist() if x.lower().endswith(".pdf")]
            if not v:
                return mb, None
            data = z.read(v[0])
    if data[:5] != b"%PDF-":
        return mb, None
    d = pymupdf.open(stream=data, filetype="pdf")
    rot = None
    if d.page_count:
        st = d.load_page(0)
        # smer pisma sa meria v suradniciach NEOTOCENEJ strany, takze
        # vysledne otocenie je priamo `o` — existujuci /Rotate strany sa
        # nahradi, nie pripocita (inak sa strana s /Rotate 90 otoci o 180)
        o = otocenie(st)
        rot = o if o is not None else None
        if rot is not None and rot != st.rotation:
            st.set_rotation(rot)
        m = SIRKA / max(1.0, st.rect.width)
        st.get_pixmap(matrix=pymupdf.Matrix(m, m), alpha=False).save(ciel, jpg_quality=68)
    d.close()
    return mb, rot


gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
uloha = []
for f in gj["features"]:
    p = f["properties"]
    plany = sorted([d for d in (p.get("plany") or [])
                    if (d.get("t") or "").upper() == "PDF"
                    and (not d.get("v") or d["v"] <= MAX_MB * 1e6)
                    and not ZAKAZ.search(d.get("p") or "")],
                   key=lambda d: (poradie(d.get("p")), d.get("v") or 9e9))
    for i, d in enumerate(plany[:NA_ZAMER]):
        uloha.append((p["id"], i, d))
print("dokumentov na spracovanie: %d" % len(uloha))
# skuska: `nahlady3.py 8` spracuje len 8 dokumentov a geojson neprepise
SKUSKA = int(sys.argv[1]) if len(sys.argv) > 1 else 0
if SKUSKA:
    uloha = [u for u in uloha if u[1] == 0][:SKUSKA]

mb, hot, chyb, otoc = 0.0, 0, 0, collections.Counter()
t0 = time.time()
for n, (zid, i, dok) in enumerate(uloha, 1):
    ciel = os.path.join(NAH, "%s-%d.jpg" % (zid[:100], i))
    if mb > ROZPOCET_MB:
        print("   rozpočet vyčerpaný"); break
    try:
        m, rot = render(dok["u"], ciel)
        mb += m
        if os.path.exists(ciel):
            hot += 1; otoc[rot] += 1
            if rot:   # otocene strany do logu, aby sa dali skontrolovat ocami
                with open(os.path.join(os.path.dirname(NAH), "..", "dokumenty", "_otocene.log"), "a", encoding="utf-8") as lg:
                    lg.write("%s\t%s\n" % (os.path.basename(ciel), rot))
        if SKUSKA:
            print("   %-60s otočené o %s" % (os.path.basename(ciel), rot))
    except Exception as e:
        chyb += 1
        if SKUSKA:
            print("   chyba %s: %s" % (zid[:40], str(e)[:60]))
    time.sleep(0.3)
    if n % 100 == 0:
        print("   %4d/%d  hotových %d, chýb %d, %.0f MB, %.0f min" % (n, len(uloha), hot, chyb, mb, (time.time() - t0) / 60))
        sys.stdout.flush()

if SKUSKA:
    print("skúška hotová, geojson neprepisujem"); raise SystemExit
# zapis do geojson — nahlad patri k dokumentu, zoznam nahladov sa z toho odvodi
mam = set(os.listdir(NAH))
poc = 0
for f in gj["features"]:
    p = f["properties"]
    plany = sorted([d for d in (p.get("plany") or [])
                    if (d.get("t") or "").upper() == "PDF"
                    and (not d.get("v") or d["v"] <= MAX_MB * 1e6)
                    and not ZAKAZ.search(d.get("p") or "")],
                   key=lambda d: (poradie(d.get("p")), d.get("v") or 9e9))
    for d in p.get("plany") or []:
        d.pop("n", None)
    obr = []
    for i, d in enumerate(plany[:NA_ZAMER]):
        s = "%s-%d.jpg" % (p["id"][:100], i)
        if s in mam:
            d["n"] = "nahlady/" + s; obr.append("nahlady/" + s)
    if obr:
        p["nahlad"] = obr[0]; p["nahlady"] = obr; poc += 1
    else:
        p.pop("nahlad", None); p.pop("nahlady", None)

json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
vel = sum(os.path.getsize(os.path.join(NAH, x)) for x in os.listdir(NAH)) / 1e6
print("\nzámerov s galériou: %d" % poc)
print("obrázkov spolu: %d, %.0f MB" % (len(os.listdir(NAH)), vel))
print("otočenie strán: %s" % ", ".join("%s°: %d" % (k if k is not None else "bez textu", v) for k, v in otoc.most_common()))
print("chýb: %d, stiahnuté %.0f MB za %.0f min" % (chyb, mb, (time.time() - t0) / 60))
