# -*- coding: utf-8 -*-
"""Tyzdenny beh — to iste, co sa spusta rucne, len za sebou a s tolerantnym
zlyhanim. Bezi v GitHub Actions (.github/workflows/tyzdenny.yml) alebo
lokalne: python beh_tyzdenny.py [--osm] [--bez-tabul]

  1) tabule_sledovac.py  — uradne tabule 16 MC (vzdy; vyhlasky miznu po 15 dnoch)
  2) osm_staveniska.py   — staveniska z OSM (prvy tyzden v mesiaci, alebo --osm)
  3) ocisti.py           — prepocet tabuliek pre stranku Doplnit polohy
  4) verzia ?v= v mapa-zamerov/index.html podla datumu, aby prehliadac
     nepodal stare subory
Vysledok zapise do beh_log.md (posledne behy hore).
"""
import datetime as dt
import io
import os
import re
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
TU = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TU)
DNES = dt.date.today()
OSM = "--osm" in sys.argv or DNES.day <= 7
BEZ_TABUL = "--bez-tabul" in sys.argv
zaznam = ["## %s" % DNES.isoformat()]


def spusti(skript, *arg):
    t0 = time.time()
    r = subprocess.run([sys.executable, os.path.join(TU, skript), *arg], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=TU, timeout=3 * 3600)
    von = (r.stdout or "").strip().splitlines()
    chvost = " | ".join(x.strip() for x in von[-3:]) if von else ""
    stav = "OK" if r.returncode == 0 else "CHYBA %d" % r.returncode
    print("=== %s: %s (%.0f s)\n%s" % (skript, stav, time.time() - t0, r.stdout[-3000:]))
    if r.returncode != 0:
        print((r.stderr or "")[-2000:])
    zaznam.append("- `%s` — %s, %.0f s — %s" % (skript, stav, time.time() - t0, chvost[:300]))
    return r.returncode == 0


if not BEZ_TABUL:
    spusti("tabule_sledovac.py")
if OSM:
    spusti("osm_staveniska.py")
else:
    zaznam.append("- `osm_staveniska.py` — preskočené (beží len v prvom týždni mesiaca)")
spusti("ocisti.py")

# verzia suborov mapy — bez toho prehliadac drzi stare data az 10 minut a viac
idx = os.path.join(REPO, "mapa-zamerov", "index.html")
t = open(idx, encoding="utf-8").read()
nova = DNES.strftime("%Y%m%d") + "w"
t2 = re.sub(r"\?v=\d{8}[a-z]?", "?v=" + nova, t)
if t2 != t:
    open(idx, "w", encoding="utf-8", newline="").write(t2)
    zaznam.append("- verzia mapy `?v=%s`" % nova)

# stav.json — kedy sa co naposledy obnovilo; cita ho stranka Tok dat
import json
stav_p = os.path.join(REPO, "mapa-zamerov", "stav.json")
try:
    stav = json.load(open(stav_p, encoding="utf-8"))
except (OSError, ValueError):
    stav = {}
stav["beh"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
if not BEZ_TABUL:
    stav["tabule"] = DNES.isoformat()
if OSM:
    stav["osm"] = DNES.isoformat()
stav.setdefault("eia", "2026-09-04"); stav.setdefault("parcely", "2026-09-07"); stav.setdefault("znamky", "2026-09-07")
stav["interval_dni"] = 7
json.dump(stav, open(stav_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

log = os.path.join(TU, "beh_log.md")
stare = open(log, encoding="utf-8").read() if os.path.exists(log) else "# Behy\n"
hl, _, telo = stare.partition("\n")
open(log, "w", encoding="utf-8").write(hl + "\n\n" + "\n".join(zaznam) + "\n" + telo.lstrip("\n"))
print("\n".join(zaznam))
