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
9. `znamky_priradenie.py` — priradí známky k projektom podľa slov v názve; do mapy (`nazvy-obchodne.json`) idú len isté zhody, slogany a adresy ostávajú v `nazvy-navrh.csv` na posúdenie.