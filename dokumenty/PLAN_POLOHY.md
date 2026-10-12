# Plán: doplniť polohy 465 zámerom s približnou polohou

Stav k 12. 10. 2026: **523 presných, 465 približných** z 988 zámerov. Približná poloha znamená bod v ťažisku mestskej časti, teda až niekoľko kilometrov vedľa.

## Prečo poloha chýba

Enviroportál nepublikuje k zámerom žiadne súradnice. Polohu odvodzujeme z dokumentov spisu: z textu sa vytiahnu parcelné čísla a katastrálne územie, parcely sa nájdu v katastrálnej vrstve geoportálu a bod je ťažisko ich zjednotenia (`parcely_test.py`). Z 689 testovaných zámerov to dopadlo takto:

| Dôvod | Počet | Čo s tým |
|---|---|---|
| OK, poloha z parciel | 349 | hotové |
| parcela v texte nie je | 208 | ulica z textu, alebo vytiahnuť miesto lokálnym LLM |
| sken bez textu | 83 | OCR |
| parcela sa v katastri nenašla | 35 | hľadať vo všetkých k. ú. Bratislavy a v registri E |
| bod mimo udanej mestskej časti | 14 | veriť parcele, nie mestskej časti |

## Postup, od najlacnejšieho

### 1. Bod mimo udanej mestskej časti, 14 zámerov, 2 hodiny
Automat parcely našiel správne, ale zahodil bod, lebo nesedel s mestskou časťou zo zápisu EIA. Pri Klingerke 2 a 3 bola chyba v zdroji: EIA uvádza Staré Mesto, pretože navrhovateľ Kalos a Averta sídli na Dvořákovom nábreží, kým stavba stojí v Ružinove.

Urobiť: pri týchto 14 prejsť ručne a rozhodnúť, či je zlá mestská časť v EIA (potom zapísať bod z parciel) alebo zlá parcela (potom nechať približnú). Výsledok ide do `polohy_rucne.json`.

### 2. Parcela sa v katastri nenašla, 35 zámerov, pol dňa
Dve príčiny. Prvá: parcela sa od podania prečíslovala, typicky pri starých zámeroch, ako Klingerka 1 s parcelami 9247/1 a 9247/5 z roku 2014. Druhá: v texte je nesprávne katastrálne územie, napríklad „Ružinov“, ktoré ako k. ú. neexistuje, správne je Nivy.

Urobiť: hľadať parcelu vo všetkých katastrálnych územiach Bratislavy, nie len v tom udanom, a pri neúspechu skúsiť register E a archívnu vrstvu katastra. Čo nevyjde, doplniť ručne z ortofota.

### 3. Sken bez textu, 83 zámerov, 1 až 2 dni
Dokument je naskenovaný obrázok, PyMuPDF z neho nevytiahne text. Máme na to dve cesty: OCR cez Tesseract, alebo lokálny LLM v LM Studio, ktorý už v projekte je (`llm_pilot.py`). LLM je lepší, lebo okrem parciel rozumie aj vete „miesto realizácie“.

Urobiť: dávkovo pretlačiť 83 dokumentov, vytiahnuť parcely a miesto, potom pustiť existujúci automat na kataster.

### 4. Parcela v texte nie je, 208 zámerov, 2 až 3 dni
Najväčšia skupina. Dokument parcely neuvádza, ale takmer vždy uvádza ulicu alebo lokalitu vetou „miesto realizácie navrhovanej činnosti“.

Urobiť v tomto poradí:
1. ulica a číslo z textu proti adresným bodom, presnosť na dom,
2. názov projektu proti OpenStreetMap a proti vrstve stavenísk, ktorú už máme (`osm-staveniska.geojson`),
3. lokálny LLM nad prvými stranami dokumentu s otázkou na miesto, ulicu a parcely,
4. zvyšok ručne.

Pri každom kroku platí pravidlo z `parcely_test.py`: bod musí ležať v Bratislave a výsledok sa označí zdrojom, aby sa dal spätne overiť.

### 5. Ručné dopĺňanie zvyšku
V repozitári je na to pripravený nástroj `doplnit-polohu/index.html` s tabuľkou `zamery.csv`, kde je pri každom zámere odkaz na Google Maps aj na spis. Overené polohy sa zapisujú do `polohy_rucne.json` a nasadia skriptom `polohy_rucne.py`.

## Pravidlá, ktoré sa osvedčili

- **Ručná poloha má najvyššiu dôveru** a prepisuje aj polohu z parciel. Automat môže trafiť vedľajšiu parcelu.
- **Každá poloha nesie zdroj** v poli `poloha_zdroj`. Bez zdroja sa nezapisuje.
- **Mestskej časti zo zápisu EIA sa nedá veriť.** Býva to sídlo navrhovateľa, nie miesto stavby.
- **Adresa navrhovateľa nie je miesto stavby.** Mlynské nivy 56 je sídlo desiatok firiem, Národná diaľničná spoločnosť sídli na Mlynských nivách a stavia po celom Slovensku.

## Hotové 12. 10. 2026

Klingerka 1, 2 a 3 doplnené ručne, posun 2,6 až 3,3 km. Mechanizmus `polohy_rucne.json` plus `polohy_rucne.py` zavedený.
