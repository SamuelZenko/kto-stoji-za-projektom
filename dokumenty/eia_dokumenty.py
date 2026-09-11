# -*- coding: utf-8 -*-
"""Zber CELEHO zoznamu dokumentov ku kazdemu zameru z EIA API.

Preco vznikol: prvy zber si z kazdeho spisu odlozil len graficke prilohy
(pole `plany` v zamery.geojson). V spise ich vsak byva ovela viac — text
zameru, studie, rozhodnutia, prilohy v ZIP-e. Karta v mape potom ukazovala
zlomok toho, co je na enviroportali.

Zdroj: https://www.enviroportal.sk/api/eia_projects/<seoId>  (JSON)
Struktura: dokumenty.data[] = kroky konania (Zamer, Rozsah hodnotenia,
Sprava o hodnoteni, ...), v kazdom items[] = sekcie {title, items[]},
kazdy dokument = {type, label, id, url, filesize, date}.

Zapisuje mapa-zamerov/dokumenty.json:
  { "<id zameru>": { "d": [ {p,u,v,t,dt,k,s[,z]} ... ] } }
    p = nazov, u = cislo dokumentu (odkaz .../eia/dokument/<u>),
    v = velkost v B, t = typ (PDF/RTF/ZIP/...), dt = datum,
    k = krok konania, s = sekcia, z = id ineho konania (dalsie konania)

Do geojson sa nezapisuje nic — zoznam je velky a mapa si ho dotiahne az
pri otvoreni zalozky Dokumenty.

Beh: python eia_dokumenty.py [pocet_zamerov_na_skusku]
"""
import collections
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA = os.path.join(REPO, "mapa-zamerov")
VYSTUP = os.path.join(MAPA, "dokumenty.json")
API = "https://www.enviroportal.sk/api/eia_projects/%s"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa/1.0")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# dokumenty, ktore sa nesmu ukazat ako nahlad — mena, rodne cisla, vlastnictvo.
# Rovnaky vyznam ako v nahlady3.py; tu sluzi len na priznak "c" (citlivy),
# odkaz na enviroportal ostava, nahlad sa nerobi.
ZAKAZ = re.compile(r"list vlastn|\bLV\b|vlastn[ií]ck|pln[aá] moc|splnomocn|zmluv|dohod|"
                   r"rodn[eé] [čc][ií]slo|ob[čc]iansk|preukaz|doklad|v[yý]pis", re.I)


def stiahni(seo, pokusov=3):
    for i in range(pokusov):
        try:
            r = urllib.request.Request(API % seo, headers={"User-Agent": UA,
                                                           "Accept": "application/json"})
            with urllib.request.urlopen(r, timeout=45, context=CTX) as o:
                return json.loads(o.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 + 3 * i)
        except Exception:
            time.sleep(2 + 3 * i)
    return None


def dokumenty(det, konanie=None):
    """Zoznam vsetkych dokumentov zo spisu, v poradi krokov konania."""
    von = []
    dk = (det or {}).get("dokumenty") or {}
    for krok in dk.get("data") or []:
        kn = (krok.get("step") or "").strip()
        for sek in krok.get("items") or []:
            if not isinstance(sek, dict) or not sek.get("items"):
                continue          # {type:text} = poznamka, nie dokument
            sn = (sek.get("title") or "").strip()
            for d in sek["items"]:
                if not d.get("id"):
                    continue
                nz = (d.get("label") or "").strip()
                t = (d.get("type") or "").upper()
                if not t or t == "EMPTY":
                    t = (nz.rsplit(".", 1)[-1].upper() if "." in nz[-6:] else "")
                z = {"p": nz, "u": str(d["id"]), "t": t,
                     "v": int(d["filesize"]) if (d.get("filesize") or "").isdigit() else 0,
                     "dt": (d.get("date") or "").replace(" ", ""), "k": kn, "s": sn}
                if konanie:
                    z["z"] = konanie
                if ZAKAZ.search(nz):
                    z["c"] = 1
                von.append(z)
    return von


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
    zam = [f["properties"] for f in gj["features"] if f["properties"].get("faza_zdroj") != "redakcia"]
    skuska = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if skuska:
        zam = zam[:skuska]

    von, stat = {}, collections.Counter()
    velkost = collections.Counter()
    t0 = time.time()
    for n, p in enumerate(zam, 1):
        det = stiahni(p["id"])
        if det is None:
            stat["nedostupne"] += 1
            continue
        d = dokumenty(det)
        # dalsie konania k projektu su samostatne spisy, ich dokumenty patria k zameru
        for x in p.get("dalsie") or []:
            if not x.get("id"):
                continue
            d2 = stiahni(x["id"])
            if d2:
                d += dokumenty(d2, konanie=x.get("nazov") or x["id"])
            time.sleep(0.25)
        if d:
            von[p["id"]] = {"d": d}
            stat["dokumentov"] += len(d)
            for x in d:
                velkost[x["t"] or "?"] += x["v"]
                stat["typ_" + (x["t"] or "?")] += 1
                if x["v"] > 0:
                    stat["bajtov"] += x["v"]
        stat["zamerov"] += 1
        time.sleep(0.25)
        if n % 50 == 0:
            print("   %4d/%d  dokumentov %d, %.1f GB, %.0f min"
                  % (n, len(zam), stat["dokumentov"], stat["bajtov"] / 1e9,
                     (time.time() - t0) / 60))
            sys.stdout.flush()

    if skuska:
        print(json.dumps(von, ensure_ascii=False, indent=1)[:3000])
        print("skúška — dokumenty.json neprepisujem")
    else:
        json.dump(von, open(VYSTUP, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        print("\nzapísané %s (%.1f MB)" % (VYSTUP, os.path.getsize(VYSTUP) / 1e6))
    print("zámerov: %d, dokumentov: %d, spolu %.1f GB, nedostupných spisov: %d"
          % (stat["zamerov"], stat["dokumentov"], stat["bajtov"] / 1e9, stat["nedostupne"]))
    for t, c in sorted(((k[4:], v) for k, v in stat.items() if k.startswith("typ_")),
                       key=lambda x: -x[1]):
        print("   %-6s %5d ks, %7.1f GB" % (t or "?", c, velkost[t or "?"] / 1e9))
    print("čas: %.0f min" % ((time.time() - t0) / 60))


if __name__ == "__main__":
    main()
