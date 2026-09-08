# Úradné tabule 17 mestských častí — prieskum (krok 1), 8. 9. 2026

Cieľ: zistiť, odkiaľ a ako sa dajú strojovo brať verejné vyhlášky stavebných úradov (stavebné povolenia, územné rozhodnutia, kolaudácie), keď CUET pokrýva len 9 MČ a útržkovito.

## Výsledok v skratke

- **14 zo 17** tabúľ nájdených a čitateľných skriptom.
- **2 nedostupné** z tejto siete (Ružinov, Jarovce) — obe odmietajú spojenie aj z prehliadača; skúsiť z inej siete / neskôr. Ružinov je najväčší stavebný úrad, bez neho to nemá zmysel spúšťať.
- **1 bez vlastnej tabule** (Vajnory) — odkazuje priamo na CUET, tam už je.
- Weby stoja na **5 systémoch**, čiže treba ~5 parserov, nie 17. **9 tabúľ má RSS**, čo parser zjednoduší na čítanie XML.

## Po mestských častiach

| MČ | systém | tabuľa | RSS | poznámka |
|---|---|---|---|---|
| Staré Mesto | „novinky/ID" (trimel) | staremesto.sk/novinky/23495/verejne-vyhlasky | staremesto.sk/rss (10 položiek, mieša všetko) | vyhlášky s číslom spisu v názve; sekcia Stavebný úrad zvlášť |
| Vrakuňa | trimel | vrakuna.sk/novinky/4827/stavebny-urad | vrakuna.sk/rss | sekcia Stavebný úrad, 30 dokumentov s dátumom |
| Nové Mesto | trimel | banm.sk/zverejnovanie/1649/uradna-tabula | banm.sk/rss (mieša novinky) | detail dokumentu /zverejnovanie/detail/ID/…; „Park pod Kolibou 2, rozhodnutie" |
| Devín | trimel | devin.sk/18328/uradna-tabula | devin.sk/rss | má „Úradná tabuľa stavebného úradu" |
| Devínska Nová Ves | trimel | devinskanovaves.sk/zverejnovanie | devinskanovaves.sk/rss | sekcia „Verejné vyhlášky – stavebné konania" |
| Dúbravka | AlejTech (Kabernet) | dubravka.sk/…/Elektronicka-uradna-tabula | feedburner dubravka (20 položiek, 3 stavebné) | „Úradná tabuľa – Stavebný úrad" zvlášť; názvy s číslom spisu SU-… |
| Lamač | AlejTech + Digitálne mesto | lamac.sk/samosprava/zverejnovanie/uradna-tabula-stavebneho-uradu | — | samostatná tabuľa stavebného úradu, ~800 dátumov v zozname (dlhá história!) |
| Petržalka | WordPress | petrzalka.sk/uradna-tabula | RSS s kategóriami „Doručovanie verejnou vyhláškou", „Žiadosti + EIA" | 26 PDF na stránke; **na CUET nepublikuje, tu áno** |
| Rača | WordPress | raca.sk/uradna-tabula/ | raca.sk/uradna-tabula/feed/ (posledná položka 2023 — feed asi mŕtvy) | stránka aktuálna, RSS nie |
| Karlova Ves | WordPress | karlovaves.sk/stavebny-urad/ + /zverejnovanie/?cat=verejne-vyhlasky | rsslatest.xml (bez stavebných) | 42 PDF priamo v wp-content/uploads s dátumom v ceste |
| Záhorská Bystrica | WordPress | zahorskabystrica.sk/samosprava/uradna-tabula/ | zahorskabystrica.sk/feed/ (6 položiek) | „Oznámenie o začatí konania" v feede |
| Podunajské Biskupice | Galileo | biskupice.sk/zverejnovanie/uradna-tabula/ | biskupice.sk/?rss=200 (100 položiek, 13 stavebných) | najlepší RSS zo všetkých |
| Čunovo | uradne.sk (Digitálne mesto) | cunovo.eu/samosprava/uradna-tabula | uradne.sk/rssfeed/690/tablenewsRSS (341 položiek, 17 stavebných) | hosťovaná tabuľa s históriou |
| Rusovce | vlastný | bratislava-rusovce.sk/uradna-tabula | — | jednoduchý zoznam „dátum; subjekt; Rozhodnutie…" s PDF |
| Vajnory | — | odkaz na CUET | — | berie sa z CUET |
| Ružinov | ? | ruzinov.sk — **spojenie odmietnuté** (Python aj Chrome) | ? | overiť z inej siete; predtým na CUET 44 dokumentov za 2026 |
| Jarovce | ? | jarovce.sk — **spojenie odmietnuté** | ? | overiť z inej siete |

## Čo z toho plynie pre krok 2 (sledovač)

- **5 parserov** namiesto 17: trimel (5 MČ), AlejTech (2), WordPress (4, každý trochu inak), Galileo (1), uradne.sk (1) + Rusovce ručne. RSS tam, kde je zmysluplné (Petržalka, Biskupice, Čunovo, Dúbravka), inak HTML zoznam.
- Názvy dokumentov nesú číslo spisu a názov stavby („Rozhodnutie – Bytový súbor Hrubé Lúky – Agátová – SU 11874/2620/2026") → na párovanie so zámerom často stačí názov, PDF treba len na parcely.
- **História**: väčšina tabúľ ukazuje len aktuálne vyhlášky (15 dní), ale Lamač (~800 záznamov), Čunovo (341) a Biskupice (100) majú aj staršie — tie sa dajú vziať naraz.
- Odhad kroku 2 ostáva **8–12 h**, plus 1–2 h, ak sa Ružinov ukáže ako iný systém. Bez Ružinova nespúšťať — je to ~30 % všetkých konaní.
- Týždenný beh: každý dokument s kľúčovými slovami (stavebné povolenie, územné rozhodnutie, oznámenie o začatí, kolaudácia, zmena stavby) → názov, MČ, dátum, odkaz, PDF → parcely → kataster → bod; rodinné domy a prípojky von; osobné údaje sa neukladajú.

Skript prieskumu: `tabule_prieskum.py` (výstup `tabule_prieskum.json`).
