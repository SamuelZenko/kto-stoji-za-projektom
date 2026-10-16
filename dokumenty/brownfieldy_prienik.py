# -*- coding: utf-8 -*-
"""Brownfieldy MIB (register 2022) × zámery z EIA.

Stiahne vrstvu „Brownfieldy nad 0,5 ha" z verejnej ArcGIS služby MIB
(BF_aktualizácia_2022_WFL1, vrstva 8), pre každý polygón nájde zámery
z registra EIA s presnou polohou, ktoré v ňom ležia, a zapíše
mapa-zamerov/brownfieldy.geojson pre dotykovú obrazovku.

Register je z roku 2022 — pole ZAMER hovorí, či vtedy MIB o zámere vedel.
Prienik s EIA hovorí, čo sa deje dnes. Obe informácie ostávajú zvlášť.

Spustenie z priečinka dokumenty/ (ArcGIS Pro Python):
  python brownfieldy_prienik.py
"""
import io, json, os, sys, collections, datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from osgeo import ogr

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
TU = os.path.dirname(os.path.abspath(__file__))
ZAMERY = os.path.join(TU, "..", "mapa-zamerov", "zamery.geojson")
VYSTUP = os.path.join(TU, "..", "mapa-zamerov", "brownfieldy.geojson")
SLUZBA = ("https://services8.arcgis.com/pRlN1m0su5BYaFAS/arcgis/rest/services/"
          "BF_aktualiz%C3%A1cia_2022_WFL1/FeatureServer/8")
CHCEME = ["OBJECTID", "SPEC_CISLO", "NAZOV", "ADRESA", "MC", "KU", "VYMERA_HA", "PR_VYU_POP", "N_FUNK_POP",
          "ZAMER", "DRUH_VLA", "NKP_NAZOV", "SEZ_POPIS", "ZONA_NAZOV", "ZONA_OZNACENIE", "KLASIFIKAC",
          "R2019", "R2022", "NOVY_BF"]
TOLERANCIA = 0.0003          # ~25 m v stupňoch — bod na hrane pozemku sa ešte ráta
PORADIE = {"zámer": 1, "posúdené": 2, "povolené": 3, "dokončené": 4}


def json_z(url):
    r = Request(url, headers={"User-Agent": "MIB mapa zamerov (brownfieldy_prienik.py)"})
    with urlopen(r, timeout=60) as o:
        d = json.loads(o.read().decode("utf-8"))
    if isinstance(d, dict) and "error" in d:
        raise SystemExit("ArcGIS chyba: %s" % d["error"])
    return d


"""Register píše názvy verzálkami. Všeobecné slová idú na malé, ostatné
(mená areálov, ulíc, firiem) ostávajú s veľkým písmenom. Skratky do troch
písmen (OLO, PKO, UK, BVS, STV, MŠK) ostávajú verzálkami."""
VSEOBECNE = set("""areál areal budova budovy bytové domy bývalá bývalé bývalý bývalej kolkáreň ubytovňa škôlka družstvo
ihrisko sklady sklad amfiteáter vojenský vojenská cudzinecká polícia dvojhalie smaltovne futbalové garáže hotel
kaštieľ park kúpalisko lesná správa modrá nemocnica nepostavený polyfunkčný dom neudržiavaná zeleň nevyužívaná
nevyužívaný plocha plochy priestor nezastavaný pozemok obchodné centrum obchodný obchody ceste opustená opustené
opustený parkovisko budovou priemyslu priemyselná stavba ťažby ťazby ťažbe projekt ruiny sanatórium skelet dvore dvor
skleník stará administratívna škola technické služby technický objekt unimobunky letisko vodný zdroj vodojem zarastené
stavenisko zbúraná základy závod mieru čeľadník ulica majer štadión kolónia študentský domov železničný železnici
hrádzi treťom rybníku betónová výroby výroba skleníkov nemocnice holom vrchu nivy pošta po pri na v s a""".split())


def veta(s):
    if not s:
        return ""
    von, nove = [], True
    for w in str(s).replace("  ", " ").strip().split(" "):
        jadro = w.strip(",.-()")
        if not jadro:
            continue
        if jadro.lower() in VSEOBECNE:
            t = w[0].upper() + w[1:].lower() if nove else w.lower()
        elif jadro.lower() in ("ii", "iii", "iv"):
            t = w.upper()                              # rímske číslice
        elif len(jadro) <= 3 and jadro.isupper() and jadro.isalpha():
            t = w                                      # skratky: OLO, PKO, UK, BVS, STV, MŠK
        else:
            t = w[0].upper() + w[1:].lower()
        von.append(t)
        nove = w.endswith(",") or w.endswith("-")
    return " ".join(von)


def nadpis(s):
    """NOVÉ MESTO → Nové Mesto (názvy mestských častí majú veľké všetky slová)"""
    return " ".join(w.capitalize() for w in str(s or "").split())


# skratky, ktoré v texte registra ostávajú verzálkami (zvyšok ide na vetnú formu)
SKRATKY = set("ESET ÚPN ÚPN-Z NKP ŽSR ZSR MČ BVS STV OLO PKO UK MŠK EIA SR NB BA SPP ZAD09 BF MIB EÚ".split())


def prva(s):
    """SÚKROMNÍ VLASTNÍCI → Súkromní vlastníci; skratky do 4 písmen (ESET, ÚPN, NKP, ZSR) ostávajú"""
    slova = str(s or "").strip().split(" ")
    von = []
    for i, w in enumerate(slova):
        jadro = w.strip(",.;:()\"'*/-")
        if jadro.upper() in SKRATKY or any(c.isdigit() for c in jadro):
            von.append(w)
        else:
            von.append(w.lower())
    t = " ".join(von)
    return t[:1].upper() + t[1:]


# typológia pôvodného využitia → kľúč ikony „obra" (koncept Zažni mesto: každá typológia je spiaci obor)
TYP = [("PRIEMYS", "priemysel"), ("ADMINISTRAT", "administrativa"), ("DOPRAV", "doprava"), ("POĽNOHOSP", "pole"),
       ("ŠPORT", "sport"), ("REZIDEN", "byvanie"), ("ARMÁD", "kasarne"), ("REKREÁC", "rekreacia"), ("KULTÚR", "kultura")]


def typ_kluc(s):
    s = (s or "").upper()
    return next((k for pref, k in TYP if pref in s), "ine")


def main():
    meta = json_z(SLUZBA + "?f=json")
    maju = {f["name"] for f in meta.get("fields", [])}
    polia = [p for p in CHCEME if p in maju]
    chybaju = [p for p in CHCEME if p not in maju]
    print("vrstva:", meta.get("name"), "| polia OK:", len(polia), "| v službe nie sú:", chybaju or "—")
    pocet = json_z(SLUZBA + "/query?" + urlencode({"where": "1=1", "returnCountOnly": "true", "f": "json"}))["count"]
    gj = json_z(SLUZBA + "/query?" + urlencode({"where": "1=1", "outFields": ",".join(polia), "returnGeometry": "true",
                                                "outSR": 4326, "orderByFields": "OBJECTID ASC",
                                                "resultRecordCount": 2000, "f": "geojson"}))
    if len(gj["features"]) != pocet:
        raise SystemExit("stiahnutých %d, služba hlási %d — skúste znova" % (len(gj["features"]), pocet))
    print("brownfieldov:", pocet)

    with io.open(ZAMERY, encoding="utf-8") as fh:
        z = json.load(fh)
    # stred ulice („ulica v MČ") nie je pozemok — na Mlynských nivách sedí
    # 13 zámerov na jednom bode; do prieniku s pozemkom brownfieldu nepatria
    presne = [f for f in z["features"] if f["geometry"] and f["properties"].get("presnost") == "presná"
              and f["properties"].get("zdroj_polohy") != "ulica v MČ"]
    body = []
    for f in presne:
        g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"]))
        body.append((g if g.GetGeometryName() == "POINT" else g.PointOnSurface(), f["properties"]))
    print("zámerov s presnou polohou:", len(body))

    von, spolu, s_eia, so_zamerom_2022 = [], 0, 0, 0
    for f in gj["features"]:
        a = f["properties"]
        tvar = ogr.CreateGeometryFromJson(json.dumps(f["geometry"]))
        stred = tvar.PointOnSurface()            # bod vždy vnútri polygónu — sem ide ikona a názov
        poly = tvar.Buffer(TOLERANCIA)
        zam = []
        for pt, p in body:
            if poly.Contains(pt):
                zam.append({"id": p["id"], "nazov": p.get("nazov_obch") or p.get("nazov") or "", "faza": p.get("faza") or "",
                            "rok": (p.get("zmena") or "")[:4], "typ": p.get("typ") or "", "firma": p.get("firma") or "",
                            "ico": p.get("ico") or "", "skupina": p.get("skupina") or ""})
        zam.sort(key=lambda x: (-PORADIE.get(x["faza"], 0), x["rok"]), reverse=False)
        zam.sort(key=lambda x: x["rok"], reverse=True)
        inv = collections.OrderedDict()
        for x in zam:
            k = x["ico"] or x["firma"]
            if not k:
                continue
            i = inv.setdefault(k, {"firma": x["firma"], "ico": x["ico"], "skupina": x["skupina"], "n": 0})
            i["n"] += 1
        naj = max((PORADIE.get(x["faza"], 0) for x in zam), default=0)
        faza_naj = next((k for k, v in PORADIE.items() if v == naj), "")
        # pole ZAMER je voľný text; „NEZISTENÝ" (aj s preklepmi) = MIB v roku 2022 o zámere nevedel
        zamer_txt = (a.get("ZAMER") or "").strip()
        zamer22 = bool(zamer_txt) and not zamer_txt.upper().startswith("NEZISTEN")
        so_zamerom_2022 += zamer22
        s_eia += bool(zam); spolu += len(zam)
        von.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "id": str(a.get("SPEC_CISLO") or a.get("OBJECTID")),
            "nazov": veta(a.get("NAZOV")), "nazov_register": a.get("NAZOV") or "",
            "mc": nadpis(a.get("MC")), "ku": nadpis(a.get("KU")), "adresa": veta(a.get("ADRESA")),
            "ha": round(float(a.get("VYMERA_HA") or 0), 1), "stred": [round(stred.GetX(), 6), round(stred.GetY(), 6)],
            "vlastnik": prva(a.get("DRUH_VLA")), "vyuzitie": prva(a.get("PR_VYU_POP")), "typ": typ_kluc(a.get("PR_VYU_POP")),
            "ciel": prva(a.get("N_FUNK_POP")),
            "zamer_2022": "" if not zamer22 else prva(zamer_txt), "ma_zamer_2022": int(zamer22),
            "zataz": int("S ENVIRON" in (a.get("SEZ_POPIS") or "").upper()), "pamiatka": prva(a.get("NKP_NAZOV")),
            "zona": veta(a.get("ZONA_NAZOV") or a.get("ZONA_OZNACENIE")), "trieda": a.get("KLASIFIKAC") or "",
            "novy_2022": int(bool(a.get("NOVY_BF"))),
            "zamery": zam, "zamery_pocet": len(zam), "faza_naj": faza_naj, "eia": int(bool(zam)),
            "investori": list(inv.values()),
        }})
    von.sort(key=lambda f: -f["properties"]["ha"])
    out = {"type": "FeatureCollection", "name": "brownfieldy",
           "zdroj": {"sluzba": SLUZBA, "edicia": "2022", "stiahnute": datetime.date.today().isoformat(),
                     # posledná úprava dát v službe (ms od 1970) — dátum publikovania nie je dátum prieskumu
                     "upravene": datetime.datetime.fromtimestamp(
                         (meta.get("editingInfo") or {}).get("dataLastEditDate", 0) / 1000, datetime.timezone.utc).date().isoformat()
                         if (meta.get("editingInfo") or {}).get("dataLastEditDate") else "",
                     "pocet": pocet, "so_zamerom_2022": so_zamerom_2022, "s_eia_zamerom": s_eia, "eia_zamerov": spolu,
                     "tolerancia_st": TOLERANCIA, "poznamka": "prienik len s presnými polohami EIA — spodný odhad"},
           "features": von}
    with io.open(VYSTUP, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("register 2022 so zámerom: %d | dnes s presným EIA zámerom: %d (zámerov %d) → %s (%.0f kB)"
          % (so_zamerom_2022, s_eia, spolu, VYSTUP, os.path.getsize(VYSTUP) / 1000))
    for f in von:
        p = f["properties"]
        if p["zamery_pocet"]:
            print("  %-44s %6.1f ha  %2d  %-9s %s" % (p["nazov"][:44], p["ha"], p["zamery_pocet"], p["faza_naj"], p["zamery"][0]["nazov"][:40]))
    print("názvy:", " | ".join(f["properties"]["nazov"] for f in von))


if __name__ == "__main__":
    main()
