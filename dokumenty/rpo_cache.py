# -*- coding: utf-8 -*-
"""Lokálna kópia výpisov RPO (api.statistics.sk) uložených nástrojom mib-register
v `.cache` (sha1(url).txt). Postaví index IČO → výpis so spoločníkmi a štatutármi,
aby overenie skupín bežalo aj keď RPO API neodpovedá (20. 10. 2026 timeouty).

Použitie:  import rpo_cache; R = rpo_cache.nacitaj(); R.entita("48099171")
"""
import io
import json
import os
import re
import time

MIB = r"C:\Users\samuel.zenko\OneDrive - Hlavne mesto SR Bratislava\Pracovná plocha\mib-register"
CACHE = os.path.join(MIB, ".cache")
TU = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(TU, "rpo_cache_index.json")


def _ziva(pole):
    z = [x for x in (pole or []) if not x.get("validTo")]
    return (z or pole or [{}])[-1]


def _ico(s):
    c = re.sub(r"\D", "", str(s or ""))
    return c.zfill(8)[:8] if c else ""      # zahraničný spoločník nemá IČO → prázdne, nie 00000000


def _osoba(o):
    return (o.get("personName") or {}).get("formatedName") or o.get("fullName") or ""


def _entita(d, mtime):
    ico = _ico(_ziva(d.get("identifiers")).get("value"))
    if not ico:
        return None
    adr = _ziva(d.get("addresses"))
    return {
        "ico": ico,
        "meno": _ziva(d.get("fullNames")).get("value", ""),
        "zanik": str(d.get("termination") or "")[:10],
        "sidlo": " ".join(str(x) for x in [adr.get("street", ""), adr.get("buildingNumber", ""),
                                           (adr.get("municipality") or {}).get("value", "")] if x).strip(),
        "statutari": [_osoba(s) for s in (d.get("statutoryBodies") or []) if not s.get("validTo") and _osoba(s)],
        "spolocnici": [{"meno": s.get("fullName") or _osoba(s), "ico": _ico(s.get("identifier")),
                        "stat": str(((s.get("address") or {}).get("country") or {}).get("value") or ""),
                        "typ": str(((s.get("stakeholderType") or {}).get("value")) or "")}
                       for s in (d.get("stakeholders") or []) if not s.get("validTo")],
        "vypis": time.strftime("%Y-%m-%d", time.localtime(mtime)),
    }


def _orsr(ico):
    """Náhrada, keď RPO API neodpovedá (20. 10. 2026): výpis z www.orsr.sk cez parser
    nástroja mib-register (register_dossier.orsr_ico/orsr_vypis — pauza 3,5 s, cache).
    Firemný spoločník z ORSR nemá IČO ani štát, len meno — značka v názve stačí."""
    import sys
    if MIB not in sys.path:
        sys.path.insert(0, MIB)
    import register_dossier as RD
    RD.HOOK = lambda *a: None
    try:
        odkazy = RD.orsr_ico(ico)
        if not odkazy:
            return None
        v = RD.orsr_vypis(odkazy[0][1])
    except Exception:
        return None
    if not v or not v.get("meno"):
        return None
    return {
        "ico": _ico(v.get("ico")) or _ico(ico),
        "meno": v["meno"], "zanik": "", "sidlo": v.get("sidlo", ""),
        "statutari": v.get("konatelia", []),
        "spolocnici": [{"meno": m, "ico": _ico(i), "stat": "", "typ": ""} for m, i in v.get("spolocnici", [])],
        "vypis": time.strftime("%Y-%m-%d"), "zdroj": "ORSR",
    }


class Register:
    def __init__(self, ent):
        self.ent = ent
        self.online = False      # True = chýbajúce výpisy doťahovať z ORSR
        self.dotiahnute = 0

    def entita(self, ico):
        e = self.ent.get(_ico(ico))
        if e is None and self.online and _ico(ico):
            e = _orsr(_ico(ico))
            if e:
                self.ent[e["ico"]] = e; self.dotiahnute += 1
                if self.dotiahnute % 10 == 0:
                    self.uloz()
            else:
                self.ent[_ico(ico)] = None   # nenašlo sa — nepýtať sa znova v tomto behu
        return e

    def uloz(self):
        json.dump({k: v for k, v in self.ent.items() if v}, io.open(INDEX, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=0)

    def retaz(self, ico, max_hlbka=4):
        """Vlastnícka reťaz nahor: [(entita, spoločník-dict)], kým sú výpisy k dispozícii."""
        von, videne, cur = [], set(), _ico(ico)
        for _ in range(max_hlbka):
            e = self.entita(cur)
            if not e or cur in videne:
                break
            videne.add(cur)
            firmy = [s for s in e["spolocnici"] if s["ico"]]
            von.append((e, firmy))
            if not firmy:
                break
            cur = firmy[0]["ico"]      # hlavná vetva = prvý firemný spoločník
        return von


def postav():
    ent = {}
    for n in os.listdir(CACHE):
        p = os.path.join(CACHE, n)
        try:
            t = io.open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        if '"stakeholders"' not in t and '"statutoryBodies"' not in t:
            continue
        try:
            d = json.loads(t)
        except ValueError:
            continue
        if not isinstance(d, dict) or "identifiers" not in d:
            continue
        e = _entita(d, os.path.getmtime(p))
        if e and (e["ico"] not in ent or not e["zanik"]):
            ent[e["ico"]] = e
    json.dump(ent, io.open(INDEX, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    return ent


def nacitaj(prebuduj=False):
    if not prebuduj and os.path.exists(INDEX):
        return Register(json.load(io.open(INDEX, encoding="utf-8")))
    return Register(postav())


if __name__ == "__main__":
    import sys
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    R = nacitaj(prebuduj=True)
    print("výpisov v cache:", len(R.ent), "| so spoločníkmi-firmami:",
          sum(1 for e in R.ent.values() if any(s["ico"] for s in e["spolocnici"])))
    for ico in sys.argv[1:]:
        print("\n==", ico)
        for e, firmy in R.retaz(ico):
            print("  %s (%s) — spoločníci: %s" % (e["meno"], e["ico"],
                  "; ".join("%s%s" % (s["meno"], " [%s]" % s["ico"] if s["ico"] else "") for s in e["spolocnici"]) or "—"))
