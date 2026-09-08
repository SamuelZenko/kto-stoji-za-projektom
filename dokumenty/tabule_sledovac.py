# -*- coding: utf-8 -*-
"""Sledovac uradnych tabul stavebnych uradov 17 MC — krok 2.

Prejde tabule (RSS alebo HTML podla systemu MC), vezme dokumenty
stavebnych konani, ulozi ich do archivu (tabule_zaznamy.json — vyhlasky
z tabul po 15 dnoch miznu, archiv je jedina historia), z PDF vytiahne
druh rozhodnutia, nazov stavby, stavebnika (len pravnicke osoby), parcely
a k. u., najde parcely v katastri a spocita bod. Potom:
  - zaznam sediaci na zamer v mape -> faza dolozena vyhlaskou (aj pre MC,
    ktore nie su na CUET)
  - zaznam bez zameru -> vrstva tabule-stavby.geojson

Osobne udaje: text PDF sa neuklada, stavebnik sa uklada len s pravnou
formou alebo ICO. Rodinne domy, pripojky, oplotenia, reklamy, drazby,
zasielky sa vyhadzuju.
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" tabule_sledovac.py
"""
import hashlib
import html as H
import io
import json
import math
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
TU = os.path.dirname(os.path.abspath(__file__))
MAPA = os.path.join(os.path.dirname(TU), "mapa-zamerov")
ARCHIV = os.path.join(TU, "tabule_zaznamy.json")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa/1.0")
KN = ("https://geoportal.bratislava.sk/hSite/rest/services/kataster/"
      "Kataster_nehnute%C4%BEnost%C3%AD_C_a_E/MapServer/{}/query")
DNES = time.strftime("%Y-%m-%d")

# ── zdroje ──────────────────────────────────────────────────────────
ZDROJE = [
    ("Staré Mesto", "trimel", ["https://www.staremesto.sk/novinky/23494/stavebny-urad",
                               "https://www.staremesto.sk/novinky/23495/verejne-vyhlasky"]),
    ("Vrakuňa", "trimel", ["https://www.vrakuna.sk/novinky/4827/stavebny-urad"]),
    ("Nové Mesto", "trimel", ["https://banm.sk/zverejnovanie/1649/uradna-tabula",
                              "https://banm.sk/novinky/28623/eia-a-povolenia"]),
    ("Devín", "trimel", ["https://www.devin.sk/novinky/18334/uradna-tabula-stavebneho-uradu"]),
    ("Devínska Nová Ves", "trimel", ["https://www.devinskanovaves.sk/zverejnovanie/700/verejne-vyhlasky-stavebne-konania",
                                     "https://www.devinskanovaves.sk/zverejnovanie/511/verejne-vyhlasky"]),
    ("Petržalka", "rss", ["https://www.petrzalka.sk/uradna-tabula/"]),
    ("Podunajské Biskupice", "rss", ["https://www.biskupice.sk/?rss=200"]),
    ("Čunovo", "uradne", ["https://www.uradne.sk/rssfeed/690/tablenewsRSS"]),
    ("Dúbravka", "rss", ["http://feeds.feedburner.com/dubravka?format=xml"]),
    ("Záhorská Bystrica", "rss", ["https://zahorskabystrica.sk/feed/"]),
    ("Karlova Ves", "wp-subory", ["https://www.karlovaves.sk/stavebny-urad/",
                                  "https://www.karlovaves.sk/zverejnovanie/?cat=verejne-vyhlasky"]),
    ("Lamač", "alejtech", ["https://www.lamac.sk/samosprava/zverejnovanie/uradna-tabula-stavebneho-uradu"]),
    ("Rusovce", "rusovce", ["https://www.bratislava-rusovce.sk/uradna-tabula"]),
    ("Rača", "raca", ["https://www.raca.sk/uradna-tabula/"]),
    # Ružinov a Jarovce: weby z tejto siete neodpovedaju (8. 9. 2026) — doplnit
    # Vajnory: publikuje len na CUET
]
STAVEBNE = re.compile(r"stavebn|územn[eé]\s+rozhod|uzemn[eé]\s+rozhod|kolaud|povolen|rozhodnut|"
                      r"oznámenie o začatí|oznamenie o zacati|zmena stavby|dodatočn|umiestnen", re.I)
DROBNE = re.compile(r"zásielk|zasielk|písomnost|pisomnost|dražb|drazb|prenáj|prenaj|predaj|výrub|vyrub|"
                    r"rodinn[yý]\s+dom\b|rodinného domu|rodinny dom\b|prípojk|pripojk|oploten|reklamn|rozkopáv|rozkopav|"
                    r"garáž\b|garaz\b|studň|studn|\bVZN\b|zastupiteľ|zastupitel|volieb|kandidát|kandidat|chatk|záhradn|zahradn|"
                    r"zvláštne užívanie|zvlastne uzivanie|plynov|vodovod|kanaliz|optick|telekomunik|elektr|trafo|"
                    r"\bVN\b|\bNN\b|\bNNK\b|zakabel|verejn[eé] osvetlen|cyklo|chodník|chodnik|zastávk|zastavk|"
                    r"zásady|zasady|komisi|zápisnic|zapisnic|uznesen|rozpoč|rozpoc|pozván|pozvan|koncert|kávičk|"
                    r"\bbyt[eu]?\s+č|bytu\s+č|byt č|tepeln[eé] čerpadl|výmen[ay] rozvod|vymen[ay] rozvod|interiér|interier|"
                    r"zateplen|obnova bytového domu|obnova bytoveho domu|stavebné úpravy v byt|kaplnk|ambulanc|"
                    r"nabíjan|nabijan|rekreačn|rekreacn|chata|prístrešok|pristresok|altán|bazén|bazen|"
                    r"odvolan|prerušen|prerusen|zastaven|späťvzat|spatvzat|upovedomenie", re.I)
PARC = re.compile(
    r"parc\w*\.?\s*(?:reg\w*\.?\s*[„\"'“]?\s*[CE]\s*[„\"'”]?\s*(?:KN)?\s*)?(?:[čc]\.|[čc][ií]sl\w*)?\s*:?\s*"
    r"((?:\d{1,5}\s*/\s*\d{1,4}|\d{2,5})(?:\s*[,;]\s*(?:a\s+)?(?:\d{1,5}\s*/\s*\d{1,4}|\d{2,5}))*)", re.I)
KU_RE = re.compile(r"(?:(?<![a-záäčďéíĺľňóôšťúýž])k\.\s?[úu]\.|katastr[áa]ln\w{1,4}\s+[úu]zem\w+)\s*:?\s*"
                   r"([A-ZÁÄČĎÉÍĹĽŇÓÔŠŤÚÝŽ][a-záäčďéíĺľňóôšťúýž]+(?:\s+[A-ZÁÄČĎÉÍĹĽŇÓÔŠŤÚÝŽ][a-záäčďéíĺľňóôšťúýž]+)?)")
KU_ZNAME = ["Staré Mesto", "Nivy", "Ružinov", "Trnávka", "Nové Mesto", "Vinohrady", "Rača", "Vajnory", "Karlova Ves",
            "Dúbravka", "Lamač", "Devín", "Devínska Nová Ves", "Záhorská Bystrica", "Petržalka", "Jarovce", "Rusovce",
            "Čunovo", "Podunajské Biskupice", "Vrakuňa"]
FORMA = re.compile(r"(a\.\s?s\.|s\.\s?r\.\s?o\.|spol\.\s?s\s?r\.\s?o\.|k\.\s?s\.|n\.\s?o\.|družstvo|akciová spoločnosť|"
                   r"s\.\s?e\.|\bSE\b|\bGmbH\b|\bLtd\b)", re.I)
STAVEBNIK = re.compile(r"(?:stavebník|navrhovateľ|žiadateľ|investor)[a-z]*\s*[:\-–]?\s*(.{3,110}?)(?:,?\s*(?:IČO|so sídlom|sídlo|zast\.|zastúpen|v zastúpení|adresa)|\.\s|\n)", re.I | re.S)
ICO = re.compile(r"IČO\s*:?\s*(\d{2}\s?\d{3}\s?\d{3})")
STAVBA = re.compile(r"(?:stavb[auy]|stavebn[ýé]\s+objekt)\s*[:\-–]?\s*[„\"“]\s*([^“\"”\n]{5,140}?)\s*[“\"”]", re.I)
_t = [0.0]


def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


def cist(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def get(u, binarny=False, cas=40):
    c = 0.6 - (time.time() - _t[0])
    if c > 0:
        time.sleep(c)
    _t[0] = time.time()
    try:
        with ur.urlopen(ur.Request(u, headers={"User-Agent": UA, "Accept-Language": "sk"}), timeout=cas, context=CTX) as o:
            d = o.read(16_000_000)
            return (o.geturl(), d) if binarny else (o.geturl(), d.decode("utf-8", "replace"))
    except Exception as e:
        return u, (b"" if binarny else "")


def datum_iso(s):
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s or "")
    if m:
        return m.group(0)
    m = re.search(r"(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d\d)", s or "")
    if m:
        return "%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1)))
    try:
        import email.utils as eu
        return time.strftime("%Y-%m-%d", eu.parsedate(s))
    except Exception:
        return ""


def odkazy(h, zaklad):
    return [(up.urljoin(zaklad, H.unescape(m.group(1))), cist(m.group(2)), m.start())
            for m in re.finditer(r'<a[^>]+href=["\']?([^"\'\s>#]+)["\']?[^>]*>(.*?)</a>', h, re.S | re.I)]


def pdf_z(h, zaklad, mimo=()):
    von = []
    for m in re.finditer(r'href=["\']?([^"\'\s>]+\.pdf[^"\'\s>]*)', h, re.I):
        u = up.urljoin(zaklad, H.unescape(m.group(1)))
        if u not in von and u not in mimo:
            von.append(u)
    for m in re.finditer(r'href=["\']?([^"\'\s>]*e_download\.php[^"\'\s>]*)', h, re.I):
        u = up.urljoin(zaklad, H.unescape(m.group(1)).replace("&amp;", "&"))
        if u not in von:
            von.append(u)
    return von[:6]


# ── parsery zoznamov ────────────────────────────────────────────────
def z_trimel(u):
    uu, h = get(u)
    von = []
    nav_pdf = set(pdf_z(h, uu))
    for x, t, i in odkazy(h, uu):
        if not re.search(r"/novinka/\d+/|/zverejnovanie/detail/\d+", x) or len(t) < 6:
            continue
        m = re.search(r'datetime="(\d{4}-\d{2}-\d{2})"', h[i:i + 1500])
        # nazov v zozname ma predponu sekcie a datum: „Stavebný úrad 8.7.2026 …", „EIA a povolenia 15.10.2025 …"
        t = re.sub(r"^(Stavebný úrad|EIA a povolenia|Verejné vyhlášky|Úradná tabuľa)\s*(\d{1,2}\.\d{1,2}\.\d{4})?\s*", "", t).strip()
        von.append({"nazov": t, "url": x, "datum": m.group(1) if m else "", "kategoria": "", "pdf": [], "_nav": nav_pdf})
    return von


def z_rss(u):
    uu, h = get(u)
    von = []
    for it in re.findall(r"<item>(.*?)</item>", h, re.S):
        t = cist((re.search(r"<title>(.*?)</title>", it, re.S) or [None, ""])[1] if re.search(r"<title>", it) else "")
        l = cist((re.search(r"<link>(.*?)</link>", it, re.S) or [None, ""])[1] if re.search(r"<link>", it) else "")
        d = (re.search(r"<(?:pubDate|issuedate|dc:date)>(.*?)</", it, re.S) or [None, ""])[1] if re.search(r"<(?:pubDate|issuedate|dc:date)>", it) else ""
        k = ", ".join(cist(c) for c in re.findall(r"<(?:category|document_type)>(.*?)</", it, re.S))
        popis = H.unescape((re.search(r"<description>(.*?)</description>", it, re.S) or [None, ""])[1] if re.search(r"<description>", it) else "")
        pdf = pdf_z(popis, uu)
        for m in re.finditer(r'enclosure url="([^"]+)"', it):
            pdf.append(m.group(1))
        if not l.startswith("http"):
            l = "https://" + l
        von.append({"nazov": t, "url": l, "datum": datum_iso(d), "kategoria": k, "pdf": pdf})
    return von


def z_wp_subory(u):
    uu, h = get(u)
    von = []
    for x, t, i in odkazy(h, uu):
        if not re.search(r"\.pdf(\?|$)", x, re.I) or len(t) < 8 or "Stiahnuť" in t:
            continue
        m = re.search(r"/uploads/(\d{4})/(\d{2})/", x)
        okolie = cist(h[max(0, i - 600):i])
        d = datum_iso(okolie) or ("%s-%s-01" % (m.group(1), m.group(2)) if m else "")
        von.append({"nazov": t, "url": x, "datum": d, "kategoria": "", "pdf": [x]})
    videne, cist_v = set(), []
    for v in von:
        if v["url"] not in videne:
            videne.add(v["url"]); cist_v.append(v)
    return cist_v


def z_alejtech(u):
    uu, h = get(u)
    von = []
    for blok in re.findall(r'<div class=article-item>(.*?)</div>\s*</div>', h, re.S):
        m = re.search(r'<h2><a href=([^\s>]+)>(.*?)</a></h2>', blok, re.S)
        if not m:
            continue
        d = re.search(r'class=date>\s*(\d{1,2}\.\d{1,2}\.\d{4})', blok)
        von.append({"nazov": cist(m.group(2)), "url": up.urljoin(uu, m.group(1)), "datum": datum_iso(d.group(1) if d else ""),
                    "kategoria": "stavebný úrad", "pdf": []})
    return von


def z_rusovce(u):
    uu, h = get(u)
    von = []
    for r in re.findall(r"<tr>(.*?)</tr>", h, re.S):
        b = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
        if len(b) < 2:
            continue
        d = datum_iso(cist(b[0])); t = cist(b[1])
        if not d or len(t) < 10:
            continue
        pdf = pdf_z(b[1], uu)
        von.append({"nazov": t[:220], "url": (pdf[0] if pdf else uu + "#" + d), "datum": d, "kategoria": "", "pdf": pdf})
    return von


def z_raca(u):
    uu, h = get(u)
    von = []
    for blok in re.findall(r'<div class="w-100 row officeboard-item"(.*?)</div>\s*</div>\s*</div>', h, re.S):
        d = re.search(r'class="date[^"]*">([^<]+)<', blok); t = re.search(r"<h5>(.*?)</h5>", blok, re.S)
        k = re.search(r'class="category[^"]*">([^<]+)<', blok); pdf = pdf_z(blok, uu)
        if not t:
            continue
        von.append({"nazov": cist(t.group(1)), "url": (pdf[0] if pdf else uu + "#" + cist(t.group(1))[:40]), "datum": datum_iso(d.group(1) if d else ""),
                    "kategoria": cist(k.group(1)) if k else "", "pdf": pdf})
    return von


PARSERY = {"trimel": z_trimel, "rss": z_rss, "uradne": z_rss, "wp-subory": z_wp_subory, "alejtech": z_alejtech,
           "rusovce": z_rusovce, "raca": z_raca}


# ── zber ────────────────────────────────────────────────────────────
try:
    archiv = json.load(open(ARCHIV, encoding="utf-8"))
except (OSError, ValueError):
    archiv = {}
nove = 0
for mc, typ, urls in ZDROJE:
    poloz, chyba = [], 0
    for u in urls:
        try:
            poloz += PARSERY[typ](u)
        except Exception as e:
            chyba += 1; print("   %s: %s -> %s" % (mc, u[:50], str(e)[:60]))
    stav = [p for p in poloz if STAVEBNE.search(p["nazov"] + " " + p.get("kategoria", "")) and not DROBNE.search(p["nazov"])]
    n_nove = 0
    for p in stav:
        kl = hashlib.sha1(p["url"].encode("utf-8")).hexdigest()[:16]
        if kl in archiv:
            continue
        archiv[kl] = {"mc": mc, "nazov": p["nazov"][:220], "datum": p.get("datum", ""), "kategoria": p.get("kategoria", ""),
                      "url": p["url"], "pdf": p.get("pdf", []), "_nav": sorted(p.get("_nav", [])), "prve_videnie": DNES, "stav": "nove"}
        n_nove += 1
    nove += n_nove
    print("   %-22s poloziek %3d, stavebnych %3d, novych %3d%s" % (mc, len(poloz), len(stav), n_nove, "  (chyby %d)" % chyba if chyba else ""))
    sys.stdout.flush()
print("archív: %d záznamov, nových %d" % (len(archiv), nove))


# ── PDF: druh, stavba, stavebnik, parcely ───────────────────────────
mcg = json.load(open(os.path.join(MAPA, "mestske-casti.geojson"), encoding="utf-8"))
MC = {}
for f in mcg["features"]:
    a = f["properties"]; MC[(a.get("NAZOV_ZUJ") or a.get("MC_LABEL") or "").replace("Bratislava - ", "")] = shape(f["geometry"]).buffer(0)
_kn = {}


def parcela_kn(cpa, register=0):
    kl = (cpa, register)
    if kl in _kn:
        return _kn[kl]
    pole = "register_c_202411.CPA" if register == 0 else "register_E_202412.CPA"
    try:
        r = json.loads(ur.urlopen(ur.Request(KN.format(register) + "?" + up.urlencode({
            "where": "%s = '%s'" % (pole, cpa), "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "json"}),
            headers={"User-Agent": UA}), timeout=60, context=CTX).read().decode("utf-8"))
    except Exception:
        r = {}
    von = []
    for f in r.get("features", []):
        a = {k.split(".")[-1]: v for k, v in f["attributes"].items()}
        try:
            von.append((a.get("KU"), Polygon(f["geometry"]["rings"][0])))
        except Exception:
            pass
    _kn[kl] = von
    time.sleep(0.3)
    return von


def ku_z(t):
    for m in KU_RE.finditer(t):
        k = bd(m.group(1))
        for z in sorted(KU_ZNAME, key=len, reverse=True):
            if k.startswith(bd(z)) or (len(k) >= 8 and bd(z).startswith(k)):
                return z
    return None


def druh_z(nazov, text=""):
    """Druh rozhodnutia — najprv z nazvu dokumentu, text PDF len ked nazov
    nepovie nic. Oznamenie o zacati / ziadost / informacia NIE je
    rozhodnutie, aj ked spomina kolaudaciu ci povolenie."""
    n = bd(nazov)
    if re.search(r"zacat|ziados|informaci|upovedom|zverejnenie informacie|podani", n):
        return "začatie konania"
    if re.search(r"kolaudacne rozhodnut|povoluje uzivan|kolaudacia stavby", n) or ("kolaud" in n and "rozhodnut" in n):
        return "kolaudácia"
    if re.search(r"zmena stavby pred", n):
        return "zmena stavby"
    if re.search(r"stavebne povolenie|povoluje stavbu|povolenie stavby", n):
        return "stavebné povolenie"
    if re.search(r"uzemne rozhodnut|rozhodnutie o umiestnen|umiestnenie stavby", n):
        return "územné rozhodnutie"
    if "predlz" in n:
        return "predĺženie"
    t = bd(text[:2500])
    if "rozhodnut" in n and t:
        if re.search(r"kolaudacne rozhodnutie|povoluje uzivanie", t): return "kolaudácia"
        if re.search(r"zmena stavby pred", t): return "zmena stavby"
        if re.search(r"stavebne povolenie|povoluje stavbu|p o v o l u j e", t): return "stavebné povolenie"
        if re.search(r"uzemne rozhodnutie|rozhodnutie o umiestneni", t): return "územné rozhodnutie"
    return "iné"


def spracuj_pdf(z):
    pdfs = z.get("pdf") or []
    if not pdfs and z.get("url", "").startswith("http") and not z["url"].lower().endswith(".pdf"):
        uu, h = get(z["url"])
        pdfs = [p for p in pdf_z(h, uu) if p not in set(z.get("_nav") or [])]
        z["pdf"] = pdfs
    t = ""
    for pu in pdfs[:2]:
        uu, data = get(pu, binarny=True, cas=90)
        if not data or len(data) > 15e6:
            continue
        if data[:4] == b"PK\x03\x04":
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    v = [x for x in zf.namelist() if x.lower().endswith(".pdf")]
                    data = zf.read(v[0]) if v else b""
            except Exception:
                data = b""
        if data[:5] != b"%PDF-":
            continue
        try:
            d = pymupdf.open(stream=data, filetype="pdf")
            t = "\n".join(d.load_page(i).get_text() for i in range(min(8, d.page_count))); d.close()
        except Exception:
            t = ""
        if len(t.strip()) > 300:
            break
    e = {"druh": druh_z(z["nazov"], t), "sken": len(t.strip()) <= 300}
    m = STAVBA.search(t)
    e["stavba"] = cist(m.group(1)) if m else ""
    m = STAVEBNIK.search(t)
    kand = cist(m.group(1)) if m else ""
    ico = ICO.search(t)
    # stavebnik sa uklada LEN s pravnou formou — zivnostnik ma ICO, ale je fyzicka osoba
    e["stavebnik"] = kand[:110] if (kand and FORMA.search(kand)) else ""
    e["ico"] = ico.group(1).replace(" ", "") if (ico and e["stavebnik"]) else ""
    parc = []
    for m in PARC.finditer(t):
        for c in re.findall(r"\d{1,5}\s*/\s*\d{1,4}|\d{2,5}", m.group(1)):
            c = re.sub(r"\s+", "", c)
            if c not in parc and not (c.isdigit() and int(c) < 10):
                parc.append(c)
        if len(parc) >= 8:
            break
    e["parcely"] = parc[:8]; e["ku"] = ku_z(t)
    e["bod"] = None
    if parc:
        mcp = MC.get(z["mc"]); tvary = []
        for c in parc[:6]:
            for k, g in parcela_kn(c, 0) or parcela_kn(c, 1):
                if e["ku"] and k != e["ku"]:
                    continue
                if not e["ku"] and mcp is not None and not mcp.contains(g.centroid):
                    continue
                tvary.append(g)
        if tvary:
            c = unary_union([g.buffer(0) for g in tvary]).centroid
            if mcp is None or mcp.contains(c):
                e["bod"] = [round(c.x, 6), round(c.y, 6)]
    return e


spracovane = 0
for kl, z in archiv.items():
    if z.get("stav") != "nove":
        continue
    try:
        z["extrakt"] = spracuj_pdf(z)
    except Exception as ex:
        z["extrakt"] = {"chyba": str(ex)[:80]}
    z["stav"] = "spracovane"; z.pop("_nav", None)
    spracovane += 1
    if spracovane % 10 == 0:
        json.dump(archiv, open(ARCHIV, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(archiv, open(ARCHIV, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("spracovaných PDF: %d" % spracovane)


# ── parovanie so zamermi a vrstva ───────────────────────────────────
GEN = {"stavba", "stavby", "bytovy", "bytove", "polyfunkcny", "polyfunkcna", "obytny", "subor", "objekt", "komplex",
       "dom", "domy", "budova", "rozhodnutie", "povolenie", "oznamenie", "vyhlaska", "verejna", "bratislava", "etapa",
       "blok", "casti", "cast", "stavebne", "uzemne", "kolaudacne", "konania", "zacati", "zmena", "pred", "dokoncenim",
       # nazvy mestskych casti — su v nazve kazdeho druheho projektu, nic nerozlisia
       "devinska", "nova", "lamac", "lamaci", "petrzalka", "petrzalke", "raca", "raci", "ruzinov", "ruzinove", "vrakuna",
       "vrakuni", "dubravka", "dubravke", "karlova", "biskupice", "podunajske", "stare", "mesto", "nove", "bratislave",
       "vajnory", "rusovce", "cunovo", "jarovce", "zahorska", "bystrica", "devin", "mestska", "prístavba", "pristavba",
       "rekonstrukcia", "dostavba", "nadstavba", "modernizacia", "informacia", "navrh", "ziadost", "vydanie"}


def tok(s):
    return {w for w in re.findall(r"[a-z0-9]+", bd(s)) if len(w) >= 4 and w not in GEN and not w.isdigit()}


PORADIE_FAZ = {"zámer": 0, "posúdené": 1, "povolené": 2, "dokončené": 3}
gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
F = gj["features"]
# ICO firmy, ktora ma v tej istej MC viac zamerov (Bory Home…), sam o sebe nic neurci
ico_poc = {}
for f in F:
    p = f["properties"]
    k = (str(p.get("ico") or ""), (p.get("obec") or "").replace("Bratislava - ", ""))
    ico_poc[k] = ico_poc.get(k, 0) + 1
sparovane = fazy = 0
vrstva = []
for kl, z in archiv.items():
    e = z.get("extrakt") or {}
    if e.get("chyba"):
        continue
    # parovanie musi byt prisne — vyhlaska „Rekonštrukcia bytu č. 45" nesmie
    # sadnut na „Rekonštrukcia OD Lamač". Sedi len ICO, spolocna parcela,
    # alebo aspon dve vyznamne slova (5+ znakov) v nazve; pri remize nic.
    kand = []
    for f in F:
        p = f["properties"]
        if (p.get("obec") or "").replace("Bratislava - ", "") != z["mc"]:
            continue
        sk = 0
        if e.get("ico") and e["ico"] == str(p.get("ico") or ""):
            sk += 3 if ico_poc.get((e["ico"], z["mc"]), 0) == 1 else 1
        if e.get("parcely") and p.get("parcely") and set(e["parcely"]) & set(p["parcely"]) and (not e.get("ku") or e["ku"] == p.get("ku")):
            sk += 3
        spol = {w for w in tok(z["nazov"] + " " + e.get("stavba", "")) & tok(p["nazov"]) if len(w) >= 5}
        if len(spol) >= 2:
            sk += 2
        elif len(spol) == 1 and any(len(w) >= 9 for w in spol):
            sk += 1
        if sk >= 2:
            kand.append((sk, p))
    kand.sort(key=lambda x: -x[0])
    if kand and (len(kand) == 1 or kand[0][0] > kand[1][0]):
        sk, p = kand[0]
        z["zamer_id"] = p["id"]; sparovane += 1
        nova = {"kolaudácia": "dokončené", "stavebné povolenie": "povolené", "zmena stavby": "povolené"}.get(e.get("druh"))
        if nova and PORADIE_FAZ.get(nova, 0) > PORADIE_FAZ.get(p.get("faza", "zámer"), 0):
            p["faza"] = nova; fazy += 1
        if nova or e.get("druh") == "územné rozhodnutie":
            p["faza_zdroj"] = "tabula"
            p["doklad"] = "%s — %s (%s, úradná tabuľa MČ)" % (z["nazov"][:80], e.get("druh", ""), z.get("datum", ""))
    elif (e.get("bod") and e.get("druh") in ("stavebné povolenie", "územné rozhodnutie", "kolaudácia", "zmena stavby")
          and not DROBNE.search(e.get("stavba", "") + " " + z["nazov"]) and (e.get("stavebnik") or re.search(r"bytov|polyfunk|obytn|hala|centrum|škol|skol|areál|areal|administrat|nájomn|najomn", bd(e.get("stavba", "") + z["nazov"])))):
        vrstva.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": e["bod"]},
                       "properties": {"n": e.get("stavba") or z["nazov"][:120], "druh": e["druh"], "mc": z["mc"], "datum": z.get("datum", ""),
                                      "stavebnik": e.get("stavebnik", ""), "ico": e.get("ico", ""), "parcely": ", ".join(e.get("parcely", [])[:5]),
                                      "ku": e.get("ku") or "", "url": (z.get("pdf") or [z["url"]])[0], "detail": z["url"], "id": kl}})
json.dump(archiv, open(ARCHIV, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump({"type": "FeatureCollection", "features": vrstva}, open(os.path.join(MAPA, "tabule-stavby.geojson"), "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
druhy = {}
for z in archiv.values():
    d = (z.get("extrakt") or {}).get("druh", "?"); druhy[d] = druhy.get(d, 0) + 1
print("druhy v archíve: %s" % ", ".join("%s %d" % kv for kv in sorted(druhy.items(), key=lambda x: -x[1])))
print("s bodom z parciel: %d | spárované so zámerom: %d (fáza zvýšená %d) | nová vrstva tabule-stavby: %d"
      % (sum(1 for z in archiv.values() if (z.get("extrakt") or {}).get("bod")), sparovane, fazy, len(vrstva)))
