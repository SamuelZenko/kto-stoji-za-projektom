# Dokumenty a skripty k mape

## Dokumenty

- `odhad-prve-doplnenie.png` / `.html` — čo treba do mapy doplniť prvýkrát a koľko hodín to stojí (kostra z registra EIA vs. redakčná vrstva ako Praha zítra). Zelené riadky sú hotové so skutočnými číslami. Stav k 7. 9. 2026.
- `zdroje-dat.txt` — odkiaľ sú ktoré dáta a ako sú spoľahlivé, po zdrojoch.
- `bratislava-zajtra-doplnenie.txt` — doplnenie koncepčného dokumentu: čo je zámer, čo funguje, čo treba rozhodnúť pri komunitnom modeli, riziká.

## Skripty (spúšťajú sa Python-om z ArcGIS Pro, jediným na stroji)

`"C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" <skript>`

Poradie pri prepočte dát mapy:

1. `ocisti.py` — vyhodí body mimo Bratislavy a plány a koncepcie, označí líniové stavby (`lin`), zlúči duplicitné konania (`dalsie`), určí istotu skupiny (`sk_ist`) a zdroj fázy (`faza_zdroj`). Prepíše aj `bez-polohy.json` a `doplnit-polohu/zamery.csv`. Dá sa spúšťať opakovane.
2. `oprav_polohy.py` — ulice znovu geokóduje v mestskej časti zámeru (vrstva adresných bodov pokrýva celé Slovensko, pôvodný zber sa pýtal len na názov ulice).
3. `oprav_polohy2.py` — presné body mimo Bratislavy alebo s ulicou v inej MČ vráti medzi približné.
4. `parcely_test.py 50` — vzorka; `parcely_test.py vsetky` — pre všetky stavby bez presnej polohy vytiahne z textu zámeru parcely a k. ú., nájde ich v katastri a spočíta ťažisko; výsledok `parcely_vsetky_vysledok.json`. Bod musí ležať v udanej MČ. Na 689 stavbách: 349 OK (51 %).
5. `parcely_zapis.py` — zapíše OK výsledky do mapy (`presnost`, `zdroj_polohy = parcela`, `parcely`, `ku`).
6. `nahlady3.py` — náhľady grafických podkladov zo všetkých spisov, strany otočené podľa smeru písma, každý dokument v samostatnom procese s limitom 2 min (jeden vektorový výkres vie MuPDF zaseknúť na desiatky minút). `nahlady3.py 8` je skúška bez zápisu.
7. `cuet_b1.py` — meranie, koľko povolených stavieb chýba v registri EIA podľa úradných tabúľ (CUET). Výsledok: z verejných zdrojov sa to zmerať nedá — 8 zo 17 mestských častí na CUET nepublikuje; vzorka 5 z 11 povolených stavieb v EIA nie je.

Po zmene dát treba v `mapa-zamerov/index.html` zvýšiť `?v=` pri `ui.css` a `app.js`, inak prehliadač podá starú verziu.

HTML odhadu sa dá po úprave vyrenderovať do PNG cez Chrome:
`chrome --headless=new --window-size=1180,2300 --force-device-scale-factor=2 --screenshot=odhad.png odhad-prve-doplnenie.html`

8. `znamky_upv.py` — ochranné známky developerov z WebRegistrov ÚPV SR podľa majiteľa (415 majiteľov → 861 realitných známok, `znamky_upv.json`). Server vracia 500 bez session cookie a bez plnej sady parametrov z prehliadača.
9. `znamky_priradenie.py` — priradí známky k projektom podľa slov v názve; do mapy (`nazvy-obchodne.json`) idú len isté zhody, slogany a adresy ostávajú v `nazvy-navrh.csv` na posúdenie.10. `osm_staveniska.py` — pomenované staveniská z OpenStreetMap (Overpass, `landuse=construction` + `name`): do 30 m od presného bodu → obchodný názov (ak projekt nemá známku), rovnaký názov ako zámer s približnou polohou v tej istej MČ → poloha zámeru, bez zámeru → vrstva `osm-staveniska.geojson` (stavby pod prahom EIA). Spúšťať mesačne, OSM sa mení rýchlo. Zdroj s ID `osm` v MapLibre patrí podkladu — vrstva používa `osm-st`.11. `tabule_prieskum.py` — prieskum úradných tabúľ 17 MČ (výstup `tabule_prieskum.md`).
12. `tabule_sledovac.py` — sledovač úradných tabúľ stavebných úradov (16 MČ: 5 systémov — trimel, AlejTech, WordPress, Galileo, uradne.sk — + Rusovce, Jarovce cez obyčajné HTTP (windows-1250), Vajnory cez CUET). Archív `tabule_zaznamy.json` (vyhlášky z tabúľ po 15 dňoch miznú — archív je jediná história), z PDF druh rozhodnutia, stavba, stavebník (len právnická osoba), parcely → kataster → bod. Záznam sediaci na zámer (IČO, parcela alebo 2 významné slová, pri remíze nič) → fáza doložená vyhláškou; bez zámeru → vrstva `tabule-stavby.geojson`. Spúšťať týždenne. Ružinov zatiaľ nie — server neodpovedá na 80 ani 443, ani z inej siete.
## Redakcia (ručné dopĺňanie)

Aplikácia `redakcia/` (index.html + app.js) je editor nad mapou: zoznam zámerov s filtrami (bez polohy, bez obrázka, rozpracované), poloha klikom do mini mapy alebo vložením odkazu z Google Maps / Mapy.cz / súradníc, obrázky pretiahnutím alebo Ctrl+V (zmenšia sa v prehliadači na 1 600 px, JPEG), obchodný názov, fáza, architekt, investor, popis, odkaz; nové zámery mimo registra (id `r-…`). Koncept žije v prehliadači (localStorage + IndexedDB), tlačidlo *Uložiť na GitHub* pošle jeden commit cez GitHub API (Git Data API: blobs → tree → commit → ref) do `mapa-zamerov/redakcia.json` a `mapa-zamerov/redakcia/*.jpg`. Token (fine-grained, Contents: Read and write, len toto repo) si redaktor vkladá sám v dialógu Pripojenie; ostáva v jeho prehliadači.

Mapa (`app.js`, `zlucRedakciu`) zlúči `redakcia.json` pri načítaní: poloha → `presnost = presná`, `zdroj_polohy = redakcia`; názov → `nazov_obch` so zdrojom „redakcia“; fáza → `faza_zdroj = redakcia`; obrázky → záložka Vizualizácie; nové zámery → body so `zdroj = redakcia` (karta bez odkazu na enviroportál). `ocisti.py` berie redakčné polohy do úvahy pri tabuľkách bez polohy. Nič z redakcie sa nezapisuje do `zamery.geojson` — týždenný beh ho môže bezpečne prepísať.

## Automatický beh (GitHub Actions)

`.github/workflows/tyzdenny.yml` spúšťa každý pondelok 06:00 (a ručne cez *Actions → tyzdenny-beh → Run workflow*) skript `beh_tyzdenny.py`: úradné tabule → staveniská z OSM (prvý týždeň v mesiaci alebo prepínač `osm`) → `ocisti.py` → nová verzia `?v=` → commit a push zmien mapy. Archív vyhlášok `tabule_zaznamy.json` žije v súkromnom repe `kto-stoji-za-projektom-archiv` (deploy key v tajomstve `ARCHIV_KEY`), do verejného repa sa nikdy nedostane. Priebeh každého behu je v `beh_log.md`.

Čo v cloude zatiaľ nebeží: zber z Enviroportálu, parcely nových zámerov, ochranné známky (skripty sú tu, ale zber EIA leží mimo repa) — spúšťať lokálne raz mesačne, alebo doplniť do workflow.