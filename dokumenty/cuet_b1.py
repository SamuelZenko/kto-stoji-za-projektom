# -*- coding: utf-8 -*-
"""Krok B1 — kolko stavieb ma povolenie na uradnej tabuli, ale v EIA nie je.

Zdroj: CUET (Centralna uradna elektronicka tabula), vyhlasky mestskych casti
Bratislavy za posledne 2 roky. Kazdy dopyt sa stiahne raz a ulozi, druhe
spustenie na server nesiaha. Pauza 1 s medzi dopytmi.
"""
import collections
import hashlib
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
SP = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(SP, "cuet_b1")
os.makedirs(CACHE, exist_ok=True)
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-dossier/1.0")
OD = "07.09.2024"
MC = ["Staré Mesto", "Ružinov", "Vrakuňa", "Podunajské Biskupice", "Nové Mesto",
      "Rača", "Vajnory", "Karlova Ves", "Dúbravka", "Lamač", "Devín",
      "Devínska Nová Ves", "Záhorská Bystrica", "Petržalka", "Jarovce",
      "Rusovce", "Čunovo"]
DOPYTY = ["stavebné povolenie", "územné rozhodnutie"]
MAX_STRAN = 80
_t = [0.0]


def stiahni(params):
    u = "https://cuet.slovensko.sk/sk/?" + up.urlencode(params)
    kl = os.path.join(CACHE, hashlib.sha1(u.encode()).hexdigest() + ".html")
    if os.path.exists(kl):
        return open(kl, encoding="utf-8").read()
    c = 1.0 - (time.time() - _t[0])
    if c > 0:
        time.sleep(c)
    _t[0] = time.time()
    for pokus in range(3):
        try:
            h = ur.urlopen(ur.Request(u, headers={"User-Agent": UA, "Accept-Language": "sk"}),
                           timeout=90, context=CTX).read().decode("utf-8", "replace")
            open(kl, "w", encoding="utf-8").write(h)
            return h
        except Exception as e:
            time.sleep(4 * (pokus + 1))
    return ""


def cist(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def rozober(h):
    von = []
    for blok in re.split(r'<div class="resultItem">', h)[1:]:
        blok = blok.split('<div class="resultItem"')[0]
        z = {}
        for m in re.finditer(r'<div class="metadataDocumentName">(.*?)</div>(.*?)</div>', blok, re.S):
            z[cist(m.group(1)).rstrip(":")] = cist(m.group(2))
        odkaz = re.search(r'href="(/sk/dokument/[^"]+)"', blok)
        n = z.get("Názov dokumentu") or ""
        if not n:
            continue
        von.append({"nazov": n, "anotacia": z.get("Anotácia dokumentu") or "",
                    "zverejnovatel": z.get("Zverejňovateľ (Orgán verejnej moci)") or "",
                    "od": z.get("Zverejnené od") or "", "znacka": z.get("Registratúrna značka") or "",
                    "url": ("https://cuet.slovensko.sk" + odkaz.group(1)) if odkaz else ""})
    return von


# ── 1 · zber ────────────────────────────────────────────────────────
vsetky = {}
t0 = time.time()
for mc in MC:
    pub = "Mestská časť Bratislava - " + mc
    pred = len(vsetky)
    # datumovy filter CUET vracia 0 (overene), tak sa berie vsetko a datum sa
    # filtruje az tu. Strankuje sa, kym server vracia nove vysledky.
    for d in DOPYTY:
        videne = set()
        for strana in range(1, MAX_STRAN + 1):
            p = {"FullText": d, "MainSearchForm": "true", "PublisherName": pub}
            if strana > 1:
                p["page"] = strana
            r = rozober(stiahni(p))
            if not r:
                break
            kluce = tuple(x["url"] or x["nazov"] for x in r)
            if kluce in videne:
                break
            videne.add(kluce)
            for x in r:
                x["mc"] = mc
                vsetky[x["url"] or (x["nazov"] + x["od"])] = x
    moje = [x for x in vsetky.values() if x["mc"] == mc]
    roky = collections.Counter((x["od"] or "")[-4:] for x in moje)
    print("   %-22s %4d dokumentov  %s  (%.0f s)" % (
        mc, len(moje), " ".join("%s:%d" % (k, v) for k, v in sorted(roky.items())), time.time() - t0))
    sys.stdout.flush()


def datum(s):
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", s or "")
    return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1)) if m else ""


dok_vsetky = list(vsetky.values())
dok = [x for x in dok_vsetky if datum(x["od"]) >= "2024-09-07"]
print("\ndokumentov spolu: %d, za posledne 2 roky: %d" % (len(dok_vsetky), len(dok)))


# ── 2 · filter na stavby, ktore nas zaujimaju ───────────────────────
def bd(s):
    z = "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉÍĹĽŇÓÔÖŔŘŠŤÚÜÝŽ"
    n = "aacdeeillnooorrstuuuyzAACDEILLNOOORRSTUUYZ"
    return "".join(n[z.index(c)] if c in z else c for c in (s or "")).lower()


POVOL = re.compile(r"stavebn[eé]\s+povolen|[uú]zemn[eé]\s+rozhodnut|povolenie\s+stavby|"
                   r"rozhodnutie\s+o\s+umiestnen", re.I)
STAVBA = re.compile(r"bytov|polyfunk|administrat|obytn|apartm|hotel|obchodn|nadstavb|prístavb|pristavb|"
                    r"kancel|logist|hala\b|haly\b|sklad|v[yý]rob|škol|skol|škôlk|skolk|materská|"
                    r"parkovac[ií]\s+dom|garážov[yý]\s+dom|garazov|rezidenc|penzi[oó]n|dom\s+seniorov|"
                    r"zdravotn|poliklin|nemocnic|športov|sportov|telocvič|centrum|komplex|"
                    r"rodinn[yý]ch\s+domov|radov|bytov[eé]\s+domy", re.I)
MALE = re.compile(r"rodinn[yý]\s+dom\b|rodinného\s+domu|pr[ií]pojk|oploten|reklamn|drobn[aá]\s+stavb|"
                  r"prekl[aá]dk|optick|telekomunik|plynov|vodovod|kanaliz|elektr|trafostan|"
                  r"chodn[ií]k|komunik[aá]ci|cest[ay]\b|kri[žz]ovatk|parkovisk|zastávk|zastavk|"
                  r"cyklo|verejn[eé]\s+osvetl|odstr[aá]nen|búracie|buracie|studň|studn|"
                  r"bazén|bazen|altán|altan|záhradn|zahradn|chat[ay]\b|dielň|dieln", re.I)

kand = []
for x in dok:
    t = x["nazov"] + " " + x["anotacia"]
    if not POVOL.search(t):
        continue
    if STAVBA.search(t) and not (MALE.search(t) and not re.search(r"bytov|polyfunk|administrat|obytn", t, re.I)):
        kand.append(x)
print("z toho stavebne/uzemne rozhodnutia o vacsich stavbach: %d" % len(kand))


# ── 3 · zlucenie dokumentov do projektov ────────────────────────────
STOP = {"rozhodnutie", "stavebne", "povolenie", "uzemne", "oznamenie", "zacati", "konania",
        "stavba", "stavby", "stavbu", "objekt", "objektu", "bratislava", "mestska", "cast",
        "verejna", "vyhlaska", "bytovy", "bytove", "polyfunkcny", "polyfunkcna", "dom", "domy",
        "domov", "obytny", "subor", "zmena", "dokoncenim", "predlzenie", "platnosti",
        "navrhu", "umiestneni", "umiestnenie", "novostavba", "nadstavba", "pristavba",
        "administrativna", "budova", "komplex", "centrum", "etapa", "cislo", "znacka", "popis",
        "informacie", "stavbach", "posudzovanych", "procese", "ulica", "ulici", "ulice"}


def tokeny(s):
    s = re.sub(r"[^a-z0-9 ]", " ", bd(s))
    return {w for w in s.split() if len(w) >= 4 and w not in STOP and not w.isdigit()}


projekty = []
for x in sorted(kand, key=lambda x: x["od"]):
    tk = tokeny(x["nazov"] + " " + x["anotacia"][:160])
    if not tk:
        continue
    for pj in projekty:
        if pj["mc"] == x["mc"] and len(tk & pj["tk"]) >= max(2, int(0.5 * min(len(tk), len(pj["tk"])))):
            pj["dok"].append(x); pj["tk"] |= tk
            break
    else:
        projekty.append({"mc": x["mc"], "tk": set(tk), "dok": [x]})
print("po zluceni do projektov: %d" % len(projekty))


# ── 4 · porovnanie s registrom EIA ──────────────────────────────────
gj = json.load(open(os.path.join(SP, "stranka", "mapa-zamerov", "zamery.geojson"), encoding="utf-8"))
det = os.path.join(SP, "eia_detaily")
eia = []
for f in gj["features"]:
    p = f["properties"]
    eia.append({"id": p["id"], "nazov": p["nazov"], "tk": tokeny(p["nazov"] + " " + (p.get("ulica") or "")),
                "firma": bd(re.sub(r",.*$", "", p.get("firma") or ""))})
for pj in projekty:
    naj, kde = 0, None
    for e in eia:
        sp = len(pj["tk"] & e["tk"])
        if sp > naj:
            naj, kde = sp, e
    text = bd(" ".join(d["nazov"] + " " + d["anotacia"] for d in pj["dok"]))
    firma = any(e["firma"] and len(e["firma"]) > 6 and e["firma"] in text for e in eia)
    pj["v_eia"] = naj >= 2 or firma
    pj["zhoda"] = (kde["nazov"][:60] if kde and naj >= 2 else ("firma" if firma else ""))

chyba = [p for p in projekty if not p["v_eia"]]
print("\n" + "=" * 70)
print("VYSLEDOK B1")
print("=" * 70)
print("projektov s povolenim / uzemnym rozhodnutim (2 roky): %d" % len(projekty))
print("   z nich sa naslo v registri EIA:                    %d" % (len(projekty) - len(chyba)))
print("   CHYBA v EIA:                                       %d  (%.0f %%)" % (len(chyba), 100.0 * len(chyba) / max(1, len(projekty))))
print("\npodla mestskej casti (chyba / spolu):")
c1 = collections.Counter(p["mc"] for p in chyba); c2 = collections.Counter(p["mc"] for p in projekty)
for mc in MC:
    if c2[mc]:
        print("   %-22s %3d / %3d" % (mc, c1[mc], c2[mc]))
print("\nukazky chybajucich:")
for p in chyba[:40]:
    d = p["dok"][0]
    print("   %-20s %s | %s" % (p["mc"][:20], d["od"], (d["nazov"] + " — " + d["anotacia"])[:95]))

von = [{"mc": p["mc"], "v_eia": p["v_eia"], "zhoda": p["zhoda"],
        "dokumenty": [{k: d[k] for k in ("od", "nazov", "anotacia", "url")} for d in p["dok"]]}
       for p in projekty]
json.dump(von, open(os.path.join(SP, "cuet_b1_vysledok.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\nulozene: cuet_b1_vysledok.json")
