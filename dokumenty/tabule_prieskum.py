# -*- coding: utf-8 -*-
"""Krok 1 — prieskum uradnych tabul 17 mestskych casti.

Pre kazdu MC: najde stranku uradnej tabule, zisti platformu, RSS,
kategorie, tvar odkazov na PDF, strankovanie a vypise ukazku dokumentov.
Nic nestahuje okrem HTML/RSS stranok. Vystup: tabule_prieskum.json + suhrn.
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" tabule_prieskum.py
"""
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
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
MC = [("Staré Mesto", "https://www.staremesto.sk"), ("Ružinov", "https://www.ruzinov.sk"),
      ("Vrakuňa", "https://www.vrakuna.sk"), ("Podunajské Biskupice", "https://www.mupb.sk"),
      ("Nové Mesto", "https://www.banm.sk"), ("Rača", "https://www.raca.sk"), ("Vajnory", "https://www.vajnory.sk"),
      ("Karlova Ves", "https://www.karlovaves.sk"), ("Dúbravka", "https://www.dubravka.sk"),
      ("Lamač", "https://www.lamac.sk"), ("Devín", "https://www.devin.sk"),
      ("Devínska Nová Ves", "https://www.devinskanovaves.sk"), ("Záhorská Bystrica", "https://www.zahorskabystrica.sk"),
      ("Petržalka", "https://www.petrzalka.sk"), ("Jarovce", "https://www.jarovce.sk"),
      ("Rusovce", "https://www.bratislava-rusovce.sk"), ("Čunovo", "https://www.cunovo.eu")]
CESTY = ["/uradna-tabula", "/uradna-tabula/", "/sk/uradna-tabula", "/sk/content/uradna-tabula",
         "/samosprava/uradna-tabula", "/uradna-tabula-1", "/uradne-oznamy", "/elektronicka-uradna-tabula"]
STAV = re.compile(r"stavebn|územn|uzemn|kolaud|vyhlášk|vyhlask|rozhodnut|povolen", re.I)


def get(u, cas=40):
    try:
        r = ur.Request(u, headers={"User-Agent": UA, "Accept-Language": "sk", "Accept": "text/html,application/xml;q=0.9,*/*;q=0.8"})
        with ur.urlopen(r, timeout=cas, context=CTX) as o:
            return o.geturl(), o.read(1_500_000).decode("utf-8", "replace"), o.status
    except Exception as e:
        return u, "", str(e)[:70]


def cist(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def odkazy(h, zaklad):
    von = []
    for m in re.finditer(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', h, re.S | re.I):
        von.append((up.urljoin(zaklad, H.unescape(m.group(1))), cist(m.group(2))[:120]))
    return von


def platforma(h):
    z = []
    if "wp-content" in h or "wp-json" in h: z.append("WordPress")
    if "esmao" in h.lower(): z.append("eSMAO")
    if "digitalnemesto" in h.lower() or "digitálne mesto" in h.lower(): z.append("Digitálne mesto")
    if "webex" in h.lower() or "alejtech" in h.lower(): z.append("WEBEX/Alejtech")
    if "joomla" in h.lower(): z.append("Joomla")
    if "drupal" in h.lower(): z.append("Drupal")
    if "typo3" in h.lower(): z.append("TYPO3")
    return ", ".join(z) or "?"


vysl = []
for mc, dom in MC:
    z = {"mc": mc, "web": dom, "tabula": "", "stav": "", "platforma": "", "rss": [], "pdf": 0, "dokumenty": 0,
         "kategorie": [], "strankovanie": "", "ukazky": []}
    u0, h0, st = get(dom)
    if not h0:
        z["stav"] = "web neodpovedá: %s" % st; vysl.append(z); print("   %-22s %s" % (mc, z["stav"])); continue
    # odkaz na tabulu z uvodnej stranky
    kand = [u for u, t in odkazy(h0, u0) if re.search(r"tabu[ľl]|tabula", (u + " " + t).lower()) and "facebook" not in u]
    kand = [u for u in kand if up.urlparse(u).netloc.endswith(up.urlparse(u0).netloc.replace("www.", ""))] or kand
    for c in CESTY:
        kand.append(up.urljoin(u0, c))
    videne = set()
    for u in kand:
        if u in videne:
            continue
        videne.add(u)
        uu, h, st2 = get(u)
        if not h or len(h) < 2000:
            continue
        ods = odkazy(h, uu)
        pdf = [o for o in ods if re.search(r"\.pdf(\?|$)", o[0], re.I)]
        dok = [o for o in ods if STAV.search(o[1])]
        if len(dok) + len(pdf) < 3:
            continue
        z["tabula"] = uu; z["stav"] = "OK"; z["platforma"] = platforma(h)
        z["pdf"] = len(pdf); z["dokumenty"] = len(dok)
        z["rss"] = sorted({up.urljoin(uu, H.unescape(m)) for m in re.findall(r'<link[^>]+type="application/(?:rss|atom)\+xml"[^>]+href="([^"]+)"', h)}
                          | {o[0] for o in ods if re.search(r"/feed|rss|\.xml$", o[0], re.I)})[:4]
        z["kategorie"] = sorted({t for u2, t in ods if re.search(r"kateg|typ=|oblast|sekcia|category", u2, re.I) and 3 < len(t) < 50})[:12]
        z["strankovanie"] = ", ".join(sorted({m for m in re.findall(r"[?&](page|strana|p|pg|start|offset)=\d+", h, re.I)}))[:60]
        z["ukazky"] = [t for u2, t in dok[:5]]
        break
        time.sleep(0.5)
    if not z["tabula"]:
        z["stav"] = "tabuľa sa nenašla (skúšaných %d adries)" % len(videne)
    vysl.append(z)
    print("   %-22s %-6s %-22s rss:%d pdf:%3d dok:%3d  %s" % (mc, z["stav"][:6], z["platforma"][:22], len(z["rss"]), z["pdf"], z["dokumenty"], z["tabula"][:60]))
    sys.stdout.flush()
    time.sleep(0.5)

json.dump(vysl, open(os.path.join(TU, "tabule_prieskum.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\nukážky dokumentov:")
for z in vysl:
    for t in z["ukazky"][:2]:
        print("   %-22s %s" % (z["mc"], t[:90]))
print("\nRSS:")
for z in vysl:
    for r in z["rss"]:
        print("   %-22s %s" % (z["mc"], r))
