# -*- coding: utf-8 -*-
"""Nahlady ku vsetkym dokumentom spisu — vratane obsahu ZIP archivov.

Nadvazuje na nahlady3.py. Rozdiel: kandidati sa neberu z pola `plany`
v geojsone (to bol vyber z prveho zberu), ale z mapa-zamerov/dokumenty.json,
kde je cely spis (eia_dokumenty.py). Pribudlo:
  * ZIP — archiv sa stiahne, precita sa zoznam suborov (ide do `zc`, mapa
    ho ukazuje po rozkliknuti) a z grafickych suborov vnutri sa urobia nahlady;
  * nazvy suborov nahladov su podla cisla dokumentu (d<cislo>.jpg,
    d<cislo>-<n>.jpg pre polozku v archive) — stabilne aj ked sa zamer premenuje.

Enviroportal nepodporuje HTTP Range, archiv sa teda musi stiahnut cely.
Preto rozpocty: ZIP_MAX_MB na jeden archiv a ROZPOCET_GB na cely beh.

Behy:
  python nahlady4.py --migruj      premenuje nahlady z nahlady3 na d<cislo>.jpg
  python nahlady4.py --pdf         dorobi nahlady z PDF podla celeho spisu
  python nahlady4.py --zip         stiahne archivy, zoznam obsahu + nahlady
  python nahlady4.py --zapis       prepocita plany/nahlady v zamery.geojson
Prepinace --limit N, --rozpocet GB obmedzia beh (skusobne behy).
"""
import argparse
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
DOKJ = os.path.join(MAPA, "dokumenty.json")
GEOJ = os.path.join(MAPA, "zamery.geojson")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 MIB-mapa/1.0")

MAX_MB = 6.0          # PDF, ktore stahujeme kvoli nahladu
ZIP_MAX_MB = 80.0     # archiv nad tuto velkost preskakujeme
SIRKA = 620           # sirka nahladu v px
NA_ZAMER = 6          # najviac nahladov na zamer z PDF
Z_ARCHIVU = 4         # najviac nahladov z jedneho archivu
LIMIT_S = 120         # casovy limit na jeden render (vektorove vykresy visia)
GRAFIKA = (".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp")

PREDNOST = [(r"situ[aá]c", 0), (r"vizualiz|perspekt|pohlad|poh[ľl]ad", 1),
            (r"[sš]ir[sš]ie vz[tť]ah|koordina|z[aá]kres", 2),
            (r"v[yý]kres|p[oô]dorys|rez\b|axonom|schem|sch[eé]m", 3),
            (r"mapa|graf|pr[ií]loha", 4)]
# dokumenty, ktore sa nesmu ukazat — mena, rodne cisla, vlastnictvo
ZAKAZ = re.compile(r"list vlastn|\bLV\b|vlastn[ií]ck|pln[aá] moc|splnomocn|zmluv|dohod|"
                   r"rodn[eé] [čc][ií]slo|ob[čc]iansk|preukaz|doklad|v[yý]pis|rozhodnut|"
                   r"stanovisk|vyjadren|ziados|žiados|potvrden|s[uú]hlas|protokol", re.I)


def poradie(t):
    t = (t or "").lower()
    for vz, r in PREDNOST:
        if re.search(vz, t):
            return r
    return 9


def nacitaj():
    dk = json.load(open(DOKJ, encoding="utf-8"))
    gj = json.load(open(GEOJ, encoding="utf-8"))
    return dk, gj


def uloz_dok(dk):
    json.dump(dk, open(DOKJ, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- render
def _render(ciel, q, cesta):
    """Bezi v detskom procese: zo suboru na disku vyrenderuje prvu stranu do JPG.
    Samostatny proces preto, lebo MuPDF vie na vektorovom vykrese visiet.
    Subor ide cez disk, nie ako bajty — kopia do detskeho procesu zdvojovala
    pamat a pri 80 MB archivoch to zhodilo cely beh."""
    import pymupdf
    try:
        mb = os.path.getsize(cesta) / 1e6
        with open(cesta, "rb") as f:
            hlava = f.read(5)
        if hlava == b"%PDF-":
            d = pymupdf.open(cesta, filetype="pdf")
        else:
            d = pymupdf.open(cesta)      # obrazok — MuPDF si typ zisti sam
        rot = None
        if d.page_count:
            st = d.load_page(0)
            try:
                rot = otocenie(st)
            except Exception:
                rot = None
            if rot is not None and rot != st.rotation:
                st.set_rotation(rot)
            m = SIRKA / max(1.0, st.rect.width)
            if not d.is_pdf:
                m = min(m, 1.0)        # rastrovy obrazok nezvacsujeme
            st.get_pixmap(matrix=pymupdf.Matrix(m, m), alpha=False).save(ciel, jpg_quality=68)
        d.close()
        q.put((mb, rot))
    except Exception as e:
        q.put(("chyba", str(e)[:90]))


def otocenie(page):
    """O kolko stupnov otocit stranu, aby sa text cital zlava doprava."""
    smer = collections.Counter()
    d = page.get_text("dict")
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


def render(ciel, cesta):
    q = mp.Queue()
    p = mp.Process(target=_render, args=(ciel, q, cesta))
    p.start(); p.join(LIMIT_S)
    if p.is_alive():
        p.terminate(); p.join(5); return "limit", None
    try:
        return q.get(timeout=5)
    except Exception:
        return "chyba", "bez vysledku"


def odkaz(u):
    return u if str(u).startswith("http") else "https://www.enviroportal.sk/eia/dokument/%s" % u


DOCASNY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_docasne")


def stiahni_do_suboru(u, strop_mb, cesta):
    """Stiahne dokument po kusoch na disk. Vracia velkost v MB, 0 pri chybe
    alebo ak je vacsi ako strop."""
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    strop = int(strop_mb * 1e6)
    try:
        r = urllib.request.Request(odkaz(u), headers={"User-Agent": UA,
                                                      "Referer": "https://www.enviroportal.sk/"})
        n = 0
        with urllib.request.urlopen(r, timeout=300, context=ctx) as o, open(cesta, "wb") as f:
            while True:
                kus = o.read(1 << 20)
                if not kus:
                    break
                n += len(kus)
                if n > strop:
                    return 0.0
                f.write(kus)
        return n / 1e6
    except Exception:
        return 0.0


def spracuj(d, strop_mb):
    """Jeden dokument: stiahne a podla obsahu (nie podla typu v registri —
    kazde tretie „PDF" je v skutocnosti ZIP) urobi nahlad alebo rozbali archiv.
    Vsetko ide cez disk (_docasne/), v pamati je najviac jeden subor z archivu.
    Vracia (stiahnute MB, pocet novych nahladov)."""
    os.makedirs(DOCASNY, exist_ok=True)
    cesta = os.path.join(DOCASNY, "d%s.bin" % d["u"])
    clen = os.path.join(DOCASNY, "d%s-clen.bin" % d["u"])
    try:
        mb = stiahni_do_suboru(d["u"], strop_mb, cesta)
        if not mb:
            return 0.0, 0
        novych = 0
        with open(cesta, "rb") as f:
            hlava = f.read(2)
        if hlava == b"PK":
            try:
                with zipfile.ZipFile(cesta) as z:
                    polozky = [i for i in z.infolist() if not i.is_dir()]
                    obsah = [{"p": i.filename.replace("\\", "/").split("/")[-1] or i.filename,
                              "v": i.file_size} for i in polozky]
                    vyber = sorted([(j, i) for j, i in enumerate(polozky)
                                    if i.filename.lower().endswith(GRAFIKA)
                                    and not ZAKAZ.search(i.filename) and i.file_size <= 40e6],
                                   key=lambda x: (poradie(x[1].filename), x[1].file_size))[:Z_ARCHIVU]
                    for j, i in vyber:
                        ciel = os.path.join(NAH, "d%s-%d.jpg" % (d["u"], j))
                        try:
                            with z.open(i) as zdroj, open(clen, "wb") as f:
                                while True:
                                    kus = zdroj.read(1 << 20)
                                    if not kus:
                                        break
                                    f.write(kus)
                        except Exception:
                            continue
                        render(ciel, clen)
                        if os.path.exists(ciel):
                            obsah[j]["n"] = "nahlady/d%s-%d.jpg" % (d["u"], j); novych += 1
                    d["zc"] = obsah
                    # archiv s jednym vykresom: nahlad patri rovno dokumentu
                    prvy = next((x for x in obsah if x.get("n")), None)
                    if prvy and not d.get("n"):
                        d["n"] = prvy["n"]
            except Exception:
                d["zc"] = []
            return mb, novych
        ciel = os.path.join(NAH, "d%s.jpg" % d["u"])
        render(ciel, cesta)
        if os.path.exists(ciel):
            d["n"] = "nahlady/d%s.jpg" % d["u"]; novych = 1
        return mb, novych
    finally:
        for s in (cesta, clen):
            try:
                os.remove(s)
            except OSError:
                pass


# ---------------------------------------------------------------- kroky
def migruj(dk, gj):
    """Nahlady z nahlady3.py boli pomenovane podla zameru (<id>-<i>.jpg).
    Premenuju sa na d<cislo dokumentu>.jpg a zapisu sa do dokumenty.json."""
    mam = set(os.listdir(NAH)) if os.path.isdir(NAH) else set()
    podla_u = {}
    for f in gj["features"]:
        for d in f["properties"].get("plany") or []:
            if d.get("n"):
                podla_u[os.path.basename(d["n"])] = str(d.get("u", "")).rstrip("/").split("/")[-1]
    pr, sp = 0, 0
    for stary, u in podla_u.items():
        if not u or stary not in mam:
            continue
        novy = "d%s.jpg" % u
        if novy not in mam:
            os.rename(os.path.join(NAH, stary), os.path.join(NAH, novy)); pr += 1
            mam.discard(stary); mam.add(novy)
    for z in dk.values():
        for d in z["d"]:
            if "d%s.jpg" % d["u"] in mam:
                d["n"] = "nahlady/d%s.jpg" % d["u"]; sp += 1
    print("premenovaných náhľadov: %d, priradených k dokumentom: %d" % (pr, sp))
    return dk


TYPY_NAHLAD = ("PDF", "JPG", "JPEG", "PNG", "TIF", "TIFF")


def kandidati_pdf(z):
    """Grafické dokumenty zo spisu, ktoré ešte nemajú náhľad. Typ z registra
    je len indícia — kazdy tretí „PDF" je v skutočnosti ZIP, `spracuj` si to
    zistí z obsahu."""
    v = [d for d in z["d"]
         if (d.get("t") or "").upper() in TYPY_NAHLAD and not d.get("c")
         and 0 < (d.get("v") or 0) <= MAX_MB * 1e6
         and not ZAKAZ.search(d.get("p") or "") and poradie(d.get("p")) < 9]
    return sorted(v, key=lambda d: (poradie(d.get("p")), d.get("v") or 9e9))


def pdf_pass(dk, limit=0, rozpocet_gb=6.0):
    uloha = []
    for zid, z in dk.items():
        mam = sum(1 for d in z["d"] if d.get("n"))
        for d in kandidati_pdf(z):
            if mam >= NA_ZAMER:
                break
            if d.get("n") or d.get("zc") is not None \
                    or os.path.exists(os.path.join(NAH, "d%s.jpg" % d["u"])):
                continue
            uloha.append((zid, d)); mam += 1
    if limit:
        uloha = uloha[:limit]
    print("PDF na render: %d" % len(uloha))
    mb, hot, chyb = 0.0, 0, 0
    t0 = time.time()
    for n, (zid, d) in enumerate(uloha, 1):
        if mb > rozpocet_gb * 1000:
            print("   rozpočet vyčerpaný"); break
        v, novych = spracuj(d, MAX_MB)
        mb += v; hot += novych
        if not novych:
            chyb += 1
        time.sleep(0.2)
        if n % 100 == 0:
            print("   %4d/%d náhľadov %d, bez výsledku %d, %.0f MB, %.0f min"
                  % (n, len(uloha), hot, chyb, mb, (time.time() - t0) / 60)); sys.stdout.flush()
            uloz_dok(dk)
    print("nové náhľady z dokumentov: %d (bez výsledku %d, stiahnuté %.1f GB, %.0f min)"
          % (hot, chyb, mb / 1000, (time.time() - t0) / 60))
    return dk


def zip_pass(dk, limit=0, rozpocet_gb=15.0):
    """Archívy: stiahnuť, uložiť zoznam obsahu, vyrenderovať grafiku vnútri."""
    uloha = []
    for zid, z in dk.items():
        mam = sum(1 for d in z["d"] if d.get("n"))
        for d in z["d"]:
            if (d.get("t") or "").upper() != "ZIP" or d.get("zc") is not None:
                continue
            if not (0 < (d.get("v") or 0) <= ZIP_MAX_MB * 1e6):
                d["zc"] = []          # priveľký archív — obsah nevypisujeme
                continue
            uloha.append((mam, zid, d))
    uloha.sort(key=lambda x: (x[0], x[2].get("v") or 0))   # najprv zámery bez náhľadu
    if limit:
        uloha = uloha[:limit]
    print("archívov na spracovanie: %d (%.1f GB)"
          % (len(uloha), sum((d.get("v") or 0) for _, _, d in uloha) / 1e9))
    gb, hot, obr, chyb = 0.0, 0, 0, 0
    t0 = time.time()
    for n, (_, zid, d) in enumerate(uloha, 1):
        if gb > rozpocet_gb:
            print("   rozpočet vyčerpaný"); break
        mb, novych = spracuj(d, ZIP_MAX_MB)
        gb += mb / 1000; obr += novych
        if d.get("zc"):
            hot += 1
        else:
            d["zc"] = d.get("zc") or []; chyb += 1
        time.sleep(0.3)
        if n % 20 == 0:
            print("   %4d/%d archívov %d, náhľadov %d, chýb %d, %.1f GB, %.0f min"
                  % (n, len(uloha), hot, obr, chyb, gb, (time.time() - t0) / 60)); sys.stdout.flush()
            uloz_dok(dk)
    print("archívov prečítaných: %d, náhľadov z archívov: %d, chýb %d, stiahnuté %.1f GB, %.0f min"
          % (hot, obr, chyb, gb, (time.time() - t0) / 60))
    return dk


def zapis_geojson(dk, gj):
    """Do geojsonu ide len to, co mapa potrebuje hned: graficke dokumenty
    (filter „len s vykresmi") a zoznam nahladov pre galeriu. Cely spis ostava
    v dokumenty.json a stahuje sa az pri otvoreni zalozky."""
    mam = set(os.listdir(NAH)) if os.path.isdir(NAH) else set()
    pocet, pn = 0, 0
    for f in gj["features"]:
        p = f["properties"]
        z = dk.get(p["id"])
        if not z:
            continue
        graf = [d for d in z["d"] if poradie(d.get("p")) < 9 or d.get("n")]
        graf = sorted(graf, key=lambda d: (0 if d.get("n") else 1, poradie(d.get("p"))))[:12]
        p["plany"] = [{k: v for k, v in
                       (("p", d.get("p")), ("u", odkaz(d["u"])), ("v", d.get("v")),
                        ("t", d.get("t")), ("n", d.get("n"))) if v} for d in graf]
        # galeria: kazdy nahlad si nesie popis a odkaz na originalny dokument,
        # aby sedeli aj obrazky vytiahnute z archivov
        nah = [{"n": d["n"], "p": d.get("p") or "podklad zo spisu", "u": odkaz(d["u"])}
               for d in graf if d.get("n") and os.path.basename(d["n"]) in mam]
        vzate = {x["n"] for x in nah}
        if len(nah) < NA_ZAMER:
            for d in z["d"]:
                for x in d.get("zc") or []:
                    if (x.get("n") and len(nah) < NA_ZAMER and x["n"] not in vzate
                            and os.path.basename(x["n"]) in mam):
                        nah.append({"n": x["n"], "p": "%s → %s" % (d.get("p") or "archív", x["p"]),
                                    "u": odkaz(d["u"])})
                        vzate.add(x["n"])
        if nah:
            p["nahlad"], p["nahlady"] = nah[0]["n"], nah; pn += 1
        else:
            p.pop("nahlad", None); p.pop("nahlady", None)
        p["dok"] = len(z["d"])
        pocet += 1
    json.dump(gj, open(GEOJ, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("zámerov s dokumentmi: %d, s galériou: %d" % (pocet, pn))
    if os.path.isdir(NAH):
        vel = sum(os.path.getsize(os.path.join(NAH, x)) for x in os.listdir(NAH)) / 1e6
        print("náhľadov v repozitári: %d, %.0f MB" % (len(os.listdir(NAH)), vel))


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    a = argparse.ArgumentParser()
    a.add_argument("--migruj", action="store_true")
    a.add_argument("--pdf", action="store_true")
    a.add_argument("--zip", action="store_true")
    a.add_argument("--zapis", action="store_true")
    a.add_argument("--limit", type=int, default=0)
    a.add_argument("--rozpocet", type=float, default=0)
    n = a.parse_args()
    os.makedirs(NAH, exist_ok=True)
    dk, gj = nacitaj()
    if n.migruj:
        dk = migruj(dk, gj); uloz_dok(dk)
    if n.pdf:
        dk = pdf_pass(dk, n.limit, n.rozpocet or 6.0); uloz_dok(dk)
    if n.zip:
        dk = zip_pass(dk, n.limit, n.rozpocet or 15.0); uloz_dok(dk)
    if n.zapis:
        zapis_geojson(dk, gj)


if __name__ == "__main__":
    mp.freeze_support()
    main()
