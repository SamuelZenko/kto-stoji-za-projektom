# -*- coding: utf-8 -*-
"""Nahlady grafickych podkladov zo spisov — cely beh, s otocenim podla pisma.

Vykresy v spisoch byvaju ulozene nalezato alebo otocene o 90 stupnov.
PyMuPDF vie pri kazdom riadku textu smer pisania; berie sa prevladajuci
smer na strane a strana sa otoci tak, aby sa text cital zlava doprava.
Skeny bez textovej vrstvy ostanu tak, ako su.

Kazdy dokument sa renderuje v samostatnom procese s casovym limitom —
obcas pride vektorovy vykres, na ktorom MuPDF visi desiatky minut, a bez
limitu by zastavil cely beh (stalo sa pri 200. dokumente).

Prepisuje vsetky nahlady (aj tie z prveho behu, tie boli bez otocenia).
Beh: "C:/Program Files/ArcGIS/Pro/bin/Python/envs/arcgispro-py3/python.exe" nahlady3.py [skuska_n]
"""
import collections
import io
import json
import multiprocessing as mp
import os
import re
import ssl
import sys
import time
import urllib.request
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPA = os.path.join(REPO, "mapa-zamerov")
NAH = os.path.join(MAPA, "nahlady")
LOG_OTOC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_otocene.log")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa/1.0")
MAX_MB, SIRKA, NA_ZAMER, ROZPOCET_MB, LIMIT_S = 6.0, 620, 4, 9000, 120
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


def vyber_plany(p):
    return sorted([d for d in (p.get("plany") or [])
                   if (d.get("t") or "").upper() == "PDF"
                   and (not d.get("v") or d["v"] <= MAX_MB * 1e6)
                   and not ZAKAZ.search(d.get("p") or "")],
                  key=lambda d: (poradie(d.get("p")), d.get("v") or 9e9))[:NA_ZAMER]


def otocenie(page):
    """O kolko stupnov otocit stranu, aby sa text cital zlava doprava.
    Meria sa v suradniciach neotocenej strany. None = bez textovej vrstvy."""
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
    return k if n >= 20 else None


def _render(url, ciel, q):
    """Bezi v detskom procese — stiahne, otoci, vyrenderuje prvu stranu."""
    import pymupdf
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    try:
        r = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.enviroportal.sk/"})
        with urllib.request.urlopen(r, timeout=90, context=ctx) as o:
            data = o.read(int(MAX_MB * 1e6) + 1)
        if len(data) > MAX_MB * 1e6:
            q.put((0, None)); return
        mb = len(data) / 1e6
        if data[:4] == b"PK\x03\x04":
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                v = [x for x in z.namelist() if x.lower().endswith(".pdf")]
                if not v:
                    q.put((mb, None)); return
                data = z.read(v[0])
        if data[:5] != b"%PDF-":
            q.put((mb, None)); return
        d = pymupdf.open(stream=data, filetype="pdf")
        rot = None
        if d.page_count:
            st = d.load_page(0)
            # smer pisma je v NEOTOCENYCH suradniciach — vysledne otocenie
            # je priamo `o`, existujuci /Rotate strany sa nim nahradi
            o = otocenie(st)
            rot = o
            if rot is not None and rot != st.rotation:
                st.set_rotation(rot)
            m = SIRKA / max(1.0, st.rect.width)
            st.get_pixmap(matrix=pymupdf.Matrix(m, m), alpha=False).save(ciel, jpg_quality=68)
        d.close()
        q.put((mb, rot))
    except Exception as e:
        q.put(("chyba", str(e)[:80]))


def render_s_limitom(url, ciel):
    q = mp.Queue()
    p = mp.Process(target=_render, args=(url, ciel, q))
    p.start()
    p.join(LIMIT_S)
    if p.is_alive():
        p.terminate(); p.join(5)
        return "limit", None
    try:
        return q.get(timeout=5)
    except Exception:
        return "chyba", "bez vysledku"


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    os.makedirs(NAH, exist_ok=True)
    gj = json.load(open(os.path.join(MAPA, "zamery.geojson"), encoding="utf-8"))
    uloha = []
    for f in gj["features"]:
        p = f["properties"]
        for i, d in enumerate(vyber_plany(p)):
            uloha.append((p["id"], i, d))
    print("dokumentov na spracovanie: %d" % len(uloha))
    SKUSKA = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if SKUSKA:
        uloha = [u for u in uloha if u[1] == 0][:SKUSKA]

    mb, hot, chyb, limit, otoc = 0.0, 0, 0, 0, collections.Counter()
    t0 = time.time()
    for n, (zid, i, dok) in enumerate(uloha, 1):
        ciel = os.path.join(NAH, "%s-%d.jpg" % (zid[:100], i))
        if mb > ROZPOCET_MB:
            print("   rozpočet vyčerpaný"); break
        v, rot = render_s_limitom(dok["u"], ciel)
        if v == "limit":
            limit += 1
            print("   časový limit: %s" % os.path.basename(ciel))
        elif v == "chyba":
            chyb += 1
            if SKUSKA:
                print("   chyba %s: %s" % (zid[:40], rot))
        else:
            mb += v
            if os.path.exists(ciel):
                hot += 1; otoc[rot] += 1
                if rot:
                    with open(LOG_OTOC, "a", encoding="utf-8") as lg:
                        lg.write("%s\t%s\n" % (os.path.basename(ciel), rot))
            if SKUSKA:
                print("   %-60s otočené o %s" % (os.path.basename(ciel), rot))
        time.sleep(0.2)
        if n % 100 == 0:
            print("   %4d/%d  hotových %d, chýb %d, limit %d, %.0f MB, %.0f min"
                  % (n, len(uloha), hot, chyb, limit, mb, (time.time() - t0) / 60))
            sys.stdout.flush()

    if SKUSKA:
        print("skúška hotová, geojson neprepisujem"); return
    # zapis do geojson — nahlad patri k dokumentu, zoznam nahladov sa z toho odvodi
    mam = set(os.listdir(NAH))
    poc = 0
    for f in gj["features"]:
        p = f["properties"]
        for d in p.get("plany") or []:
            d.pop("n", None)
        obr = []
        for i, d in enumerate(vyber_plany(p)):
            s = "%s-%d.jpg" % (p["id"][:100], i)
            if s in mam:
                d["n"] = "nahlady/" + s; obr.append("nahlady/" + s)
        if obr:
            p["nahlad"] = obr[0]; p["nahlady"] = obr; poc += 1
        else:
            p.pop("nahlad", None); p.pop("nahlady", None)
    # nahlady, ku ktorym uz nepatri ziadny dokument (zlucene alebo vyhodene zamery)
    platne = {os.path.basename(d["n"]) for f in gj["features"] for d in (f["properties"].get("plany") or []) if d.get("n")}
    zmazane = 0
    for s in list(mam):
        if s.endswith(".jpg") and s not in platne:
            os.remove(os.path.join(NAH, s)); zmazane += 1
    json.dump(gj, open(os.path.join(MAPA, "zamery.geojson"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    vel = sum(os.path.getsize(os.path.join(NAH, x)) for x in os.listdir(NAH)) / 1e6
    print("\nzámerov s galériou: %d" % poc)
    print("obrázkov spolu: %d, %.0f MB  (zmazaných osirelých %d)" % (len(os.listdir(NAH)), vel, zmazane))
    print("otočenie strán: %s" % ", ".join("%s°: %d" % (k if k is not None else "bez textu", v) for k, v in otoc.most_common()))
    print("chýb: %d, časový limit: %d, stiahnuté %.0f MB za %.0f min" % (chyb, limit, mb, (time.time() - t0) / 60))


if __name__ == "__main__":
    mp.freeze_support()
    main()
