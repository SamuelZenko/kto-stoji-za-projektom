# Dokumenty k mape

- `odhad-prve-doplnenie.png` / `.html` — čo treba do mapy doplniť prvýkrát a koľko hodín to stojí (kostra z registra EIA vs. redakčná vrstva ako Praha zítra). Stav k 7. 9. 2026.
- `zdroje-dat.txt` — odkiaľ sú ktoré dáta a ako sú spoľahlivé, po zdrojoch.
- `bratislava-zajtra-doplnenie.txt` — doplnenie koncepčného dokumentu: čo je zámer, čo funguje, čo treba rozhodnúť pri komunitnom modeli, riziká.
- `cuet_b1.py` — meranie, koľko povolených stavieb chýba v registri EIA podľa úradných tabúľ (CUET). Výsledok: z verejných zdrojov sa to zmerať nedá — 8 zo 17 mestských častí na CUET nepublikuje; vzorka 5 z 11 povolených stavieb v EIA nie je.

HTML odhadu sa dá po úprave vyrenderovať do PNG cez Chrome:
`chrome --headless=new --window-size=1180,2300 --force-device-scale-factor=2 --screenshot=odhad.png odhad-prve-doplnenie.html`