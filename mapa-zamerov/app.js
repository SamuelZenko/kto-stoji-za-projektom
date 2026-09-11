/* Mapa zámerov — logika. Vzhľad je v ui.css, kostra v index.html. */
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cis=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const sklon=n=>n===1?'zámer':(n>=2&&n<5?'zámery':'zámerov');
/* Fázy podľa dizajn systému TU—BA: význam nesie výplň, nie dúha —
   zámer červená (akcent), posúdené čierna, povolené biela s obrysom,
   dokončené warm grey. Obrys je vždy čierny. */
const FAZY=[['zámer','#F3716D'],['posúdené','#000000'],['povolené','#FFFFFF'],
            ['dokončené','#B4B4B0']];
const FARBA=Object.fromEntries(FAZY);
const SIVA='#8A8A86';
const G='https://geoportal.bratislava.sk/hSite/rest/services';
const EXPORT=s=>G+'/'+s+'/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857'
  +'&imageSR=3857&size=512,512&format=png32&transparent=true&f=image';
const PODKLAD=['v-zastavane','v-zelen','v-voda','v-tok','v-budovy','v-cesty-lem','v-cesty-male','v-cesty-stredne',
  'v-cesty-velke','v-zeleznica','v-elektricka'];
/* Dve palety podkladu. Farebná je predvolená: zeleň zelená, voda modrá,
   zástavba teplá sivá — stále tlmené, aby body a bubliny ostali najtmavšie
   na mape. Tlmená je pôvodný „papier" v tónoch warm grey. */
const PALETY={
  farebna:{pozadie:'#EFEDE6',zastavane:'#E8E5DD',zelen:'#D2DFC4',voda:'#BDD3DF',tok:'#A9C4D3',budovy:'#DBD8CF',
    budovyObrys:'#CFCBC1',cesta:'#FFFFFF',lem:'#D9D5CB',zeleznica:'#A9A69E',elektricka:'#B9B6AE',halo:'rgba(255,255,255,.8)'},
  tlmena:{pozadie:'#EDEDEA',zastavane:'#E6E6E2',zelen:'#E1E4DD',voda:'#D2D6D4',tok:'#D2D6D4',budovy:'#DADAD6',
    budovyObrys:'#DADAD6',cesta:'#FFFFFF',lem:'#E0E0DC',zeleznica:'#B4B4B0',elektricka:'#BEBEBA',halo:'#EDEDEA'},
};
let paleta='farebna'; try{ if(localStorage.getItem('mib-podklad')==='tlmena') paleta='tlmena'; }catch(e){}
const DOMOV={center:[17.13,48.15],zoom:10.7};
/* 'faza' alebo 'typ' — podľa čoho sú body na mape zafarbené */
let farbitPodla='faza';

let Z=null, TYPY=[], TAZISKA={}, KONFIG={}, vsetkyTypy=false;
let filtr={q:'',mc:'',sk:'',pl:'',typ:new Set(),faza:new Set(),nove:false};
/* filtre vyčítané z hľadania v prirodzenom jazyku („byty v Petržalke
   povolené od 2024") — držia sa zvlášť, aby neprepisovali ručné voľby */
const prazdneNl=()=>({typ:new Set(),faza:new Set(),mc:'',pl:'',od:''});
let nl=prazdneNl(), doslovne=false;
/* 'body' alebo 'teplo' — body so zhlukmi, alebo teplotná mapa hustoty */
let zobrazenie='body';
/* Doprava a technická infraštruktúra sú líniové stavby — bod pre diaľnicu
   zavádza. V dátach majú príznak `lin` a do mapy idú len na vyžiadanie. */
let ukazLiniove=false;
/* Mestské časti, ktorých úradné tabule sledujeme (vlastné weby od 8. 9. 2026,
   Vajnory cez CUET). Ružinov a Jarovce zatiaľ nie — ich weby z našej siete
   neodpovedali; pri nich nemá zmysel tvrdiť „bez povolenia". */
const TABULA_MC=new Set(['Staré Mesto','Vrakuňa','Nové Mesto','Devín','Devínska Nová Ves','Petržalka',
  'Podunajské Biskupice','Čunovo','Dúbravka','Záhorská Bystrica','Karlova Ves','Lamač','Rusovce','Rača','Vajnory']);
const VYSKY={1:11,2:16,3:21,4:30,5:46};   // hladiny výškovej regulácie → metre

/* Štartovací štýl je zámerne prázdny — len pozadie. Podklad z geoportálu
   sa pridáva až potom (pridajPodklad). Keď je geoportál pomalý alebo
   nedostupný, MapLibre inak nikdy nedohlási 'load' a stránka ostane
   prázdna aj s dátami, ktoré už máme stiahnuté. */
const map=new maplibregl.Map({
  container:'map', attributionControl:{compact:true},
  style:{version:8, glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources:{},
    layers:[{id:'pozadie',type:'background',paint:{'background-color':'#EDEDEA'}}]},
  center:DOMOV.center, zoom:DOMOV.zoom, minZoom:8, maxZoom:19,
});
function pridajPodklad(){
  map.addSource('osm',{type:'vector',maxzoom:18,attribution:'Geoportál Bratislava · OSM',
    tiles:[G+'/Hosted/Podkladov%C3%A1_mapa_OSM_UP/VectorTileServer/tile/{z}/{y}/{x}.pbf']});
  map.addSource('orto',{type:'raster',tileSize:256,maxzoom:19,
    attribution:'Ortofoto — Hlavné mesto SR Bratislava',
    tiles:[G+'/Hosted/Ortofoto/MapServer/tile/{z}/{y}/{x}']});
  /* Vektorová mapa Geoportálu má vrstvy: zastavané územie, zeleň, vodné
     plochy a toky, budovy, cestná sieť (triedy _symbol 2–6 podľa rýchlosti)
     a železničná sieť (_symbol 0 vlak, 1 električka). Farby dáva paleta. */
  const P=PALETY[paleta], sirka=(a,b,c)=>['interpolate',['linear'],['zoom'],10,a,14,b,18,c];
  [{id:'v-zastavane',type:'fill',source:'osm','source-layer':'zastavané územie',paint:{'fill-color':P.zastavane}},
   {id:'v-zelen',type:'fill',source:'osm','source-layer':'zeleň',paint:{'fill-color':P.zelen}},
   {id:'v-voda',type:'fill',source:'osm','source-layer':'vodné plochy',paint:{'fill-color':P.voda}},
   {id:'v-tok',type:'line',source:'osm','source-layer':'vodné toky',
    paint:{'line-color':P.tok,'line-width':sirka(.8,1.6,3)}},
   {id:'v-budovy',type:'fill',source:'osm','source-layer':'budovy',minzoom:13,
    paint:{'fill-color':P.budovy,'fill-outline-color':P.budovyObrys}},
   /* lem pod hlavnými cestami dáva mape hĺbku bez ďalšej farby */
   {id:'v-cesty-lem',type:'line',source:'osm','source-layer':'cestná sieť',minzoom:12,
    filter:['in',['get','_symbol'],['literal',[5,6]]],
    paint:{'line-color':P.lem,'line-width':sirka(2.4,5,15)}},
   {id:'v-cesty-male',type:'line',source:'osm','source-layer':'cestná sieť',
    filter:['in',['get','_symbol'],['literal',[2,3]]],
    paint:{'line-color':P.cesta,'line-width':sirka(.3,1.2,5)}},
   {id:'v-cesty-stredne',type:'line',source:'osm','source-layer':'cestná sieť',
    filter:['==',['get','_symbol'],4],
    paint:{'line-color':P.cesta,'line-width':sirka(.8,2.2,8)}},
   {id:'v-cesty-velke',type:'line',source:'osm','source-layer':'cestná sieť',
    filter:['in',['get','_symbol'],['literal',[5,6]]],
    paint:{'line-color':P.cesta,'line-width':sirka(1.5,3.6,12)}},
   {id:'v-zeleznica',type:'line',source:'osm','source-layer':'železničná sieť',
    filter:['==',['get','_symbol'],0],
    paint:{'line-color':P.zeleznica,'line-width':sirka(.8,1.2,2),'line-dasharray':[4,2.5]}},
   {id:'v-elektricka',type:'line',source:'osm','source-layer':'železničná sieť',minzoom:12,
    filter:['==',['get','_symbol'],1],
    paint:{'line-color':P.elektricka,'line-width':sirka(.6,1,1.8)}},
   {id:'orto',type:'raster',source:'orto',layout:{visibility:'none'}},
  ].forEach(v=>map.addLayer(v));
  map.setPaintProperty('pozadie','background-color',P.pozadie);
}
/* prepnutie palety bez prestavby vrstiev */
function nastavPaletu(n){
  paleta=n; const P=PALETY[n]; if(!P) return;
  try{ localStorage.setItem('mib-podklad',n); }catch(e){}
  const nastav=(l,k,v)=>{ if(map.getLayer(l)) map.setPaintProperty(l,k,v); };
  nastav('pozadie','background-color',P.pozadie);
  nastav('v-zastavane','fill-color',P.zastavane); nastav('v-zelen','fill-color',P.zelen);
  nastav('v-voda','fill-color',P.voda); nastav('v-tok','line-color',P.tok);
  nastav('v-budovy','fill-color',P.budovy); nastav('v-budovy','fill-outline-color',P.budovyObrys);
  nastav('v-cesty-lem','line-color',P.lem);
  ['v-cesty-male','v-cesty-stredne','v-cesty-velke'].forEach(l=>nastav(l,'line-color',P.cesta));
  nastav('v-zeleznica','line-color',P.zeleznica); nastav('v-elektricka','line-color',P.elektricka);
  ['mc-txt','ulice-txt'].forEach(l=>nastav(l,'text-halo-color',P.halo));
}
map.addControl(new maplibregl.ScaleControl({maxWidth:110}),'bottom-right');

/* ---------- filtrovanie ---------- */
function vyhovuje(p,bez){
  if(p.lin && !ukazLiniove) return false;
  if(bez!=='typ' && filtr.typ.size && !filtr.typ.has(p.typ||'Iné')) return false;
  if(bez!=='faza' && filtr.faza.size && !filtr.faza.has(p.faza)) return false;
  if(bez!=='mc' && filtr.mc && p.obec!==filtr.mc) return false;
  if(bez!=='sk' && filtr.sk && (p.skupina||'')!==filtr.sk) return false;
  if(filtr.pl==='1' && !(p.plany&&p.plany.length)) return false;
  if(filtr.pl==='2' && !((p.nahlady&&p.nahlady.length)||(p.obrazky&&p.obrazky.length))) return false;
  if(filtr.pl==='3' && p.presnost!=='presná') return false;
  if(filtr.nove && !p.nove) return false;
  /* z hľadania vyčítané podmienky platia vždy — sú súčasťou otázky */
  if(nl.typ.size && !nl.typ.has(p.typ||'Iné')) return false;
  if(nl.faza.size && !nl.faza.has(p.faza)) return false;
  if(nl.mc && p.obec!==nl.mc) return false;
  if(nl.pl==='1' && !(p.plany&&p.plany.length)) return false;
  if(nl.pl==='2' && !((p.nahlady&&p.nahlady.length)||(p.obrazky&&p.obrazky.length))) return false;
  if(nl.pl==='3' && p.presnost!=='presná') return false;
  if(nl.od && !((p.zmena||'')>=nl.od)) return false;
  if(filtr.q){
    const h=(p.nazov+' '+(p.nazov_obch||'')+' '+p.firma+' '+p.ico+' '+(p.skupina||'')+' '+p.obec).toLowerCase();
    if(!h.includes(filtr.q)) return false;
  }
  return true;
}
const pocetFiltrov=()=>filtr.typ.size+filtr.faza.size+(filtr.mc?1:0)+(filtr.sk?1:0)+(filtr.pl?1:0)+(filtr.nove?1:0);
const pole=(p,k)=>{const v=p[k]; return typeof v==='string'?JSON.parse(v):v;};

function obnov(){
  if(!Z) return;
  const presne=[], hromada={}, pocFaz={};
  let n=0,npl=0,nob=0;
  Z.features.forEach(f=>{
    const p=f.properties; if(!vyhovuje(p)) return;
    n++;
    if(p.plany&&p.plany.length) npl++;
    if((p.nahlady&&p.nahlady.length)||(p.obrazky&&p.obrazky.length)) nob++;
    pocFaz[p.faza]=(pocFaz[p.faza]||0)+1;
    if(p.presnost==='presná') presne.push(f);
    else (hromada[p.obec]=hromada[p.obec]||[]).push(p);
  });
  const body=rozostup(presne);
  map.getSource('zamery').setData({type:'FeatureCollection',features:body});
  zahodDonuty();          // supercluster po setData prečísluje zhluky
  if(map.getSource('zamery-h')) map.getSource('zamery-h').setData({type:'FeatureCollection',features:presne});
  map.getSource('nezname').setData({type:'FeatureCollection',
    features:Object.keys(hromada).filter(o=>TAZISKA[o]).map(o=>({type:'Feature',
      geometry:{type:'Point',coordinates:TAZISKA[o]},
      properties:{obec:o,pocet:hromada[o].length}}))});

  $('#c-spolu').innerHTML=cis(n)+' <span>'+sklon(n)+'</span>';
  $('#c-vykresy').textContent=cis(npl);
  $('#c-poloha').textContent=cis(presne.length);
  $('#c-obrazky').textContent=cis(nob);
  if($('#vysledok')) $('#vysledok').textContent=cis(n)+' výsledkov';
  const pf=pocetFiltrov();
  $('#pocet-filtrov').hidden=!pf; $('#pocet-filtrov').textContent=pf;
  kresliLegendu(pocFaz, Object.values(hromada).reduce((a,b)=>a+b.length,0));
  kresliAktivne(); kresliKategorie(); kresliSuplik(); kresliNovinky();
}

/* Zámery na tom istom bode (stred tej istej ulice, jedna parcela, jeden
   objekt s viacerými konaniami — 139 zámerov na 53 miestach) by po
   rozpade zhluku ležali bod na bode: zhluk hlási tri, vidno dva. Preto
   sa také body rozostúpia po kružnici okolo skutočného miesta. Skutočné
   súradnice v dátach ostávajú, kópia sa robí len pre vykreslenie. */
function rozostup(prvky){
  const skup={};
  prvky.forEach(f=>{ const c=f.geometry.coordinates, k=c[0].toFixed(5)+','+c[1].toFixed(5);
    (skup[k]=skup[k]||[]).push(f); });
  const von=[];
  prvky.forEach(f=>{
    const c=f.geometry.coordinates, s=skup[c[0].toFixed(5)+','+c[1].toFixed(5)];
    if(s.length<2){ f.properties.rozostup=0; von.push(f); return; }
    const i=s.indexOf(f), n=s.length, r=Math.max(14, 4.5*n);   // metre
    const a=-Math.PI/2+i*2*Math.PI/n, k=Math.cos(c[1]*Math.PI/180);
    f.properties.rozostup=n;
    von.push({type:'Feature',properties:f.properties,
      geometry:{type:'Point',coordinates:[c[0]+r*Math.cos(a)/(111320*k), c[1]+r*Math.sin(a)/111320]}});
  });
  return von;
}

/* Legenda ukazuje presne tú vlastnosť, podľa ktorej sú body zafarbené —
   inak by farby v paneli tvrdili niečo iné než farby na mape. */
function kresliLegendu(poc,bez){
  if(zobrazenie==='teplo'){
    $('#legenda').innerHTML='<div class="r" style="cursor:default"><span class="teplo-pas"></span>'
      +'<span class="teplo-tx">menej</span><span class="teplo-tx">viac zámerov na km²</span></div>';
    return;
  }
  const podla = farbitPodla==='typ'
    ? TYPY.slice(0,6).map(t=>[t,BARVA_TYPU[t]||SIVA,'typ'])
    : FAZY.map(([f,c])=>[f,c,'faza']);
  $('#legenda').innerHTML=podla.map(([f,c,d])=>
    '<div class="r" data-d="'+d+'" data-v="'+esc(f)+'" aria-pressed="'+filtr[d].has(f)+'">'
    +'<span class="t" style="background:'+c+'"></span>'+esc(f)+'</div>').join('')
    +(farbitPodla==='typ' && TYPY.length>6
      ? '<div class="r" style="cursor:default"><span class="t" style="background:'+SIVA+'"></span>ostatné</div>' : '')
    +'<div class="r" style="cursor:default"><span class="t duta"></span>bez známej polohy</div>';
}
/* Prekreslí farbu bodov podľa aktuálne zvolenej vlastnosti. */
function prefarbi(){
  if(!map.getLayer('bod')) return;
  const vyraz = farbitPodla==='typ'
    ? ['match',['get','typ']].concat(
        TYPY.slice(0,6).flatMap(t=>[t,BARVA_TYPU[t]||SIVA]), [SIVA])
    : ['match',['get','faza']].concat(
        FAZY.flatMap(([f,c])=>[f,c]), [SIVA]);
  map.setPaintProperty('bod','circle-color',vyraz);
  kresliLegendu();
}
function kresliAktivne(){
  const k=[];
  filtr.typ.forEach(t=>k.push(['typ',t]));
  filtr.faza.forEach(t=>k.push(['faza',t]));
  if(filtr.mc) k.push(['mc',filtr.mc]);
  if(filtr.sk) k.push(['sk',filtr.sk]);
  if(filtr.pl) k.push(['pl',{'1':'S výkresmi','2':'S obrázkami','3':'S presnou polohou'}[filtr.pl]]);
  if(filtr.nove) k.push(['nove','Len novinky']);
  $('#blok-aktivne').hidden=!k.length;
  $('#aktivne').innerHTML=k.map(([d,v])=>
    '<span class="chip">'+esc(v)+'<b data-d="'+d+'" data-v="'+esc(v)+'">×</b></span>').join('');
}
function poctyTypov(){
  const p={};
  Z.features.forEach(f=>{const x=f.properties;
    if(vyhovuje(x,'typ')) p[x.typ||'Iné']=(p[x.typ||'Iné']||0)+1;});
  return p;
}
const BARVA_TYPU={};
function kresliKategorie(){
  const p=poctyTypov(), zoz=vsetkyTypy?TYPY:TYPY.slice(0,5);
  /* Bodka nesie farbu len vtedy, keď tá farba niečo znamená aj na mape. */
  const bod=t=>farbitPodla==='typ'
    ? 'background:'+(TYPY.indexOf(t)<6?(BARVA_TYPU[t]||SIVA):SIVA)
    : 'background:transparent;border:1.5px dashed var(--tx3)';
  $('#kategorie').innerHTML=zoz.map((t,i)=>
    '<div class="r" data-t="'+esc(t)+'" aria-pressed="'+filtr.typ.has(t)+'">'
    +'<span class="t" style="'+bod(t)+'"></span>'+esc(t)
    +'<span class="n">'+cis(p[t]||0)+'</span></div>').join('');
  $('#vsetky-kat').textContent=vsetkyTypy?'Zobraziť menej ←':'Zobraziť všetky kategórie →';
  $('#vsetky-kat').hidden=TYPY.length<=5;
}
/* Filtre sedia priamo v paneli (fáza, účel, MČ, skupina, podklady) —
   zásuvka „Filtrovať" už nie je, preto sú prvky voliteľné. */
function kresliSuplik(){
  const pf={};
  Z.features.forEach(f=>{const x=f.properties;
    if(vyhovuje(x,'faza')) pf[x.faza]=(pf[x.faza]||0)+1;});
  $('#f-fazy').innerHTML=FAZY.map(([f])=>
    '<button aria-pressed="'+filtr.faza.has(f)+'" data-f="'+esc(f)+'">'
    +f+' '+cis(pf[f]||0)+'</button>').join('');
  ['mc','sk'].forEach(id=>{
    const sel=$('#f-'+id); if(!sel) return;
    const bolo=sel.value, poc={}, kl=id==='mc'?'obec':'skupina';
    Z.features.forEach(f=>{const x=f.properties;
      if(vyhovuje(x,id)){const v=x[kl]||''; if(v) poc[v]=(poc[v]||0)+1;}});
    [...sel.options].forEach(o=>{if(o.value) o.textContent=o.value+' ('+(poc[o.value]||0)+')';});
    sel.value=bolo;
  });
}

/* ---------- detail ---------- */
let LUPA=[], lupaI=0, GAL=[], galI=0, aktivnaZal='v';
function ukaz(p,z){
  /* náhľad je objekt {n,p,u} — obrázok z archívu má iný popis aj odkaz
     než dokument, ktorý ho niesol. Starší tvar (len cesta) ostáva funkčný. */
  const obr=(pole(p,'nahlady')||[]).map(x=>typeof x==='string'?{n:x}:x);
  const plany=pole(p,'plany')||[], foto=pole(p,'obrazky')||[];
  GAL=[].concat(foto.map(x=>({s:x.u,p:x.p,u:x.u})),
                obr.map((x,i)=>({s:x.n,p:x.p||(plany[i]&&plany[i].p)||'podklad zo spisu',
                                 u:x.u||(plany[i]&&plany[i].u)||x.n})));
  galI=0; aktivnaZal=z||'v';
  const chyba='<span class="v chyba">register neuvádza</span>';
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML=
     '<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok">'+esc((p.typ||'—').toUpperCase())+'</span>'
      +'<span class="stitok b">'+esc((p.faza||'—').toUpperCase())+'</span></div>'
    +'<h2>'+esc(p.nazov_obch||p.nazov)+'</h2>'
    +(p.nazov_obch?'<div class="uradny">v registri: '+esc(p.nazov)
        +(p.nazov_zdroj?'<br><span title="'+esc(p.nazov_zdroj)+'">obchodný názov podľa: '+esc(p.nazov_zdroj)+'</span>':'')+'</div>':'')
    +'<div class="miesto">◉ '+esc(p.obec)
      +'<button class="na-mape" onclick="naMape(\''+esc(p.id)+'\')">⤢ Zobraziť na mape</button></div>'
    +'<div class="udaje">'
      +riadok('Investor', p.firma?esc(p.firma)+(p.ico?' · IČO '+esc(p.ico):'')
        +(p.red_investor&&p.zdroj!=='redakcia'?'<span class="pozn-stav">redakcia: '+esc(p.red_investor)+'</span>':''):null, true)
      +riadokSkupiny(p)
      +riadok('Architekt', p.red_architekt?'<span class="v">'+esc(p.red_architekt)+'<span class="pozn-stav">doplnila redakcia'+(p.red_kedy?' '+esc(p.red_kedy):'')+'</span></span>':null, true)
      +riadok('Typológia', esc(p.typ||''))
      +riadokStavu(p)
      +(p.zdroj==='redakcia'?'':riadok('Povoľuje', esc(p.urad||'')))
      +riadokPolohy(p)
      +(p.rozostup>1?riadok('Na mape','<span class="v">bod je posunutý o pár metrov'
        +'<span class="pozn-stav">na tom istom mieste '+(p.rozostup===2?'je ešte 1 zámer':'sú ešte '+(p.rozostup-1)+' zámery')
        +' — body sú rozostúpené, aby ich bolo vidno</span></span>',true):'')
      +'<div class="r" id="r-vyska" hidden><span class="k">Výšková regulácia</span><span class="v"></span></div>'
      +riadok('Aktualizované', esc(p.zmena||''))
    +'</div>'
    +(p.red_popis?'<p class="popis">'+esc(p.red_popis)+'<span class="pozn-stav">popis doplnila redakcia</span></p>':'')
    +dalsieKonania(p)
    +'<div class="zalozky">'
      +'<button data-z="v" '+(GAL.length?'':'disabled')+'>VIZUALIZÁCIE'+(foto.length?' ('+foto.length+')':'')+'</button>'
      +'<button data-z="d" '+(p.dok||plany.length?'':'disabled')+'>DOKUMENTY ('+(p.dok||plany.length)+')</button>'
    +'</div><div id="obsah-zal"></div>'
    +(p.zdroj==='redakcia'?'':'<a class="odkaz" href="https://www.enviroportal.sk/eia/detail/'+esc(p.id)
      +'" target="_blank" rel="noopener">Detail zámeru na enviroportáli →</a>')
    +(p.red_odkaz?'<a class="odkaz" href="'+esc(p.red_odkaz)+'" target="_blank" rel="noopener">Web projektu →</a>':'')
    /* presun bodu môže navrhnúť ktokoľvek — bez schválenia sa nič nezmení */
    +(p.zdroj==='redakcia'?'':'<button class="odkaz presun" onclick="zacniPresun(\''+esc(p.id)+'\')">'
      +(p.presnost==='presná'?'Bod nesedí? Navrhnúť opravu polohy':'Navrhnúť polohu na mape')
      +'<span>klikneš tam, kde stavba stojí — návrh ide redakcii na schválenie</span></button>')
    +(mojeNavrhy()[p.id]?'<div class="cakajuce">Tvoj návrh polohy z '+esc(mojeNavrhy()[p.id].kedy||'')+' čaká na schválenie redakciou.</div>':'')
    /* výzva na doplnenie je hlavná akcia karty — preto tlačidlo, nie drobný odkaz */
    +'<a class="odkaz doplnit" href="../redakcia/?id='+encodeURIComponent(p.id)+'">'
      +(p.zdroj==='redakcia'?'Upraviť v Redakcii':'Doplniť polohu, obrázky, architekta')
      +'<span>'+(p.zdroj==='redakcia'
        ? 'projekt pridala redakcia'+(p.red_kedy?' '+esc(p.red_kedy):'')
        : 'architekt, vizualizácie ani presná poloha v registri nie sú')+'</span></a>';
  $('#detail').querySelectorAll('.zalozky button').forEach(b=>b.onclick=()=>{
    aktivnaZal=b.dataset.z; kresliZalozku(p);});
  kresliZalozku(p);
  doplnVysku(p);
}
/* Skupina je doložená len vtedy, keď firma nesie značku alebo je to známe
   IČO. Samotná zhoda sídla je indícia — na jednej adrese sedia aj cudzie
   firmy — a karta to musí povedať, nie tvrdiť „stavia X". */
function riadokSkupiny(p){
  if(!p.skupina) return riadok('Skupina', null);
  if(p.sk_ist==='dolozena') return riadok('Skupina', esc(p.skupina));
  return riadok('Skupina', '<span class="v">sídli na adrese skupiny '+esc(p.skupina)
    +' <i class="ind" title="Len zhoda sídla firmy so sídlom skupiny. '
    +'Nie je to doložené vlastníctvom ani značkou.">indícia</i></span>', true);
}
/* Fáza je doložená vyhláškou len tam, kde mestská časť publikuje na
   centrálnej úradnej tabuli. Inde ostáva len stav z registra EIA, ktorý
   hovorí o posudzovaní, nie o stavbe. */
function riadokStavu(p){
  const mc=(p.obec||'').replace(/^Bratislava\s*[-–]\s*/,'');
  let pozn;
  if(p.faza_zdroj==='redakcia') pozn='doplnila redakcia'+(p.red_kedy?' '+esc(p.red_kedy):'')+' — ručne overený údaj, nie z registra';
  else if(p.faza_zdroj==='tabula') pozn='doložené vyhláškou'+(p.doklad?': '+esc(p.doklad):'');
  else if(!TABULA_MC.has(mc)) pozn='podľa registra EIA — úradná tabuľa MČ '+esc(mc)+' zatiaľ nie je napojená, '
    +'skutočné povolenie odtiaľ nevidíme';
  else pozn='podľa registra EIA — na úradnej tabuli MČ sa vyhláška nenašla (tabule sledujeme od 8. 9. 2026)';
  /* bodka má rovnakú farbu ako bod na mape, nech sa dá spárovať s legendou */
  return riadok('Stav', '<span class="v"><span class="farba" style="background:'
    +(FARBA[p.faza]||SIVA)+'"></span>'+esc(p.faza||'')
    +'<span class="pozn-stav">'+pozn+'</span></span>', true);
}
/* Odkiaľ je poloha: parcely z textu zámeru sú najpresnejšie (ťažisko
   pozemku), ulica je len priemer adries celej ulice. */
function riadokPolohy(p){
  if(p.presnost!=='presná') return riadok('Poloha', '<span class="v chyba">nie je známa</span>', true);
  if(p.zdroj_polohy==='redakcia')
    return riadok('Poloha', '<span class="v">'+esc(p.poloha_pozn||'ručne umiestnený bod')
      +'<span class="pozn-stav">doplnila redakcia'+(p.red_kedy?' '+esc(p.red_kedy):'')+'</span></span>', true);
  const parc=pole(p,'parcely')||[];
  if(p.zdroj_polohy==='parcela' && parc.length)
    return riadok('Poloha', '<span class="v">parcely '+esc(parc.join(', '))+(p.ku?' · k. ú. '+esc(p.ku):'')
      +'<span class="pozn-stav">ťažisko pozemkov uvedených v zámere, overené v katastri</span></span>', true);
  if(p.zdroj_polohy==='osm')
    return riadok('Poloha', '<span class="v">stavenisko<span class="pozn-stav">podľa rovnomenného staveniska '
      +'v OpenStreetMap ('+esc(p.osm||'')+') — komunitný údaj</span></span>', true);
  return riadok('Poloha', '<span class="v">'+esc(p.ulica||'presná')
    +'<span class="pozn-stav">'+(p.ulica?'stred ulice podľa adresných bodov — nie konkrétny pozemok':'z prvého zberu, bez uvedenej ulice')+'</span></span>', true);
}
/* Register vedie každé konanie zvlášť — etapy, bloky, zmeny. V mape je
   projekt raz a ostatné konania sú tu. */
function dalsieKonania(p){
  const d=pole(p,'dalsie')||[]; if(!d.length) return '';
  return '<div class="dalsie"><p class="st">ĎALŠIE KONANIA K PROJEKTU ('+d.length+')</p>'
    +d.map(x=>'<a href="https://www.enviroportal.sk/eia/detail/'+esc(x.id)+'" target="_blank" rel="noopener">'
      +'<span class="f">'+esc(x.faza||'')+'</span>'+esc(x.nazov)+'<span class="z">'+esc(x.zmena||'')+'</span></a>').join('')
    +'</div>';
}
function riadok(k,v,surove){
  return '<div class="r"><span class="k">'+k+'</span>'
    +(v?(surove?v:'<span class="v">'+v+'</span>'):'<span class="v chyba">neuvádza sa</span>')+'</div>';
}
function kresliZalozku(p){
  const plany=pole(p,'plany')||[];
  $('#detail').querySelectorAll('.zalozky button').forEach(b=>
    b.setAttribute('aria-selected', b.dataset.z===aktivnaZal));
  const c=$('#obsah-zal');
  if(aktivnaZal==='v'){
    if(!GAL.length){ c.innerHTML='<p class="pozn">K tomuto zámeru nemáme obrázok.</p>'; return; }
    const x=GAL[galI];
    c.innerHTML='<div class="galeria"><img src="'+esc(x.s)+'" alt="" id="gal-obr">'
      +'<button class="sip l" id="gal-l" '+(galI?'':'disabled')+'>‹</button>'
      +'<button class="sip p" id="gal-p" '+(galI<GAL.length-1?'':'disabled')+'>›</button>'
      +'<span class="popis">'+esc(x.p)+'</span>'
      +'<span class="poc">'+(galI+1)+' / '+GAL.length+'</span></div>';
    $('#gal-l').onclick=()=>{galI--; kresliZalozku(p);};
    $('#gal-p').onclick=()=>{galI++; kresliZalozku(p);};
    $('#gal-obr').onclick=()=>{LUPA=GAL; otvorLupu(galI);};
  } else {
    const zoz=(DOKY&&DOKY[p.id]&&DOKY[p.id].d)||null;
    if(!zoz&&!DOKY){
      c.innerHTML='<p class="pozn">Načítavam zoznam dokumentov zo spisu…</p>';
      nacitajDoky().then(()=>{ if(aktivnaZal==='d') kresliZalozku(p); });
      return;
    }
    kresliDokumenty(c,p,zoz||plany.map(x=>({p:x.p,u:(x.u||'').split('/').pop(),v:x.v,t:x.t,n:x.n,k:'Spis'})));
  }
}
/* ---------- dokumenty spisu ----------
   Spis na enviroportáli má často desiatky dokumentov, v mape sme dlho
   ukazovali len tie grafické. Celý zoznam je vo dokumenty.json a sťahuje
   sa až pri prvom otvorení záložky — do geojsonu by pridal ~1,5 MB. */
let DOKY=null, dokyBezi=null;
function nacitajDoky(){
  if(DOKY) return Promise.resolve(DOKY);
  if(dokyBezi) return dokyBezi;
  dokyBezi=fetch('dokumenty.json').then(r=>r.ok?r.json():{}).catch(()=>({}))
    .then(d=>{DOKY=d||{}; return DOKY;});
  return dokyBezi;
}
const ODKAZ_DOK=u=>/^https?:/.test(u||'')?u:'https://www.enviroportal.sk/eia/dokument/'+u;
function velB(v){ return v?(v>=1e6?(v/1e6).toFixed(1)+' MB':Math.round(v/1000)+' kB'):''; }
function kresliDokumenty(c,p,zoz){
  if(!zoz||!zoz.length){ c.innerHTML='<p class="pozn">Register k tomuto zámeru neuvádza dokumenty.</p>'; return; }
  const sk=[];
  zoz.forEach((d,i)=>{
    const n=(d.z?'Ďalšie konanie · '+d.z:(d.k||'Spis'))+(d.s?' · '+d.s:'');
    if(!sk.length||sk[sk.length-1].n!==n) sk.push({n:n,r:[]});
    sk[sk.length-1].r.push([d,i]);
  });
  const sN=zoz.filter(d=>d.n).length, sZ=zoz.filter(d=>(d.t||'')==='ZIP').length;
  c.innerHTML='<p class="dok-hl">Celý spis: <b>'+zoz.length+' dokumentov</b>'
    +(sN?' · náhľad máme k '+sN:'')+(sZ?' · '+sZ+'× archív ZIP':'')
    +'<span>Náhľady robíme len z výkresov, situácií a vizualizácií. Ostatné otvorí enviroportál.</span></p>'
    /* dlhé kroky (aj 180 dokumentov) sa ukazujú po desiatich, inak je karta stena textu */
    +sk.map(g=>'<div class="dok-sk"><p class="st">'+esc(g.n.toUpperCase())+' <i>'+g.r.length+'</i></p>'
      +'<div class="dok">'+g.r.map((x,j)=>riadokDok(x[0],x[1],j>=10)).join('')+'</div>'
      +(g.r.length>10?'<button class="viac-tl">Zobraziť všetkých '+g.r.length+'</button>':'')
      +'</div>').join('');
  c.querySelectorAll('.viac-tl').forEach(b=>b.onclick=()=>{
    b.parentNode.classList.add('rozbalene'); b.remove();});
  c.querySelectorAll('.dok .r').forEach(el=>el.onclick=()=>{
    const d=zoz[+el.dataset.i];
    if(el.dataset.zip!==undefined){
      const o=c.querySelector('.zip-obsah[data-pre="'+el.dataset.i+'"]');
      if(o){ o.hidden=!o.hidden; el.classList.toggle('otvorene',!o.hidden); return; }
    }
    if(d.n){
      const s=zoz.filter(x=>x.n);
      LUPA=s.map(x=>({s:x.n,p:x.p+(x.k?' · '+x.k:''),u:ODKAZ_DOK(x.u)}));
      otvorLupu(s.indexOf(d));
    } else window.open(ODKAZ_DOK(d.u),'_blank','noopener');
  });
  c.querySelectorAll('.zip-obsah .r').forEach(el=>el.onclick=e=>{
    e.stopPropagation();
    const d=zoz[+el.dataset.pre], v=(d.zc||[]).filter(x=>x.n);
    const x=(d.zc||[])[+el.dataset.j];
    if(x&&x.n){ LUPA=v.map(y=>({s:y.n,p:d.p+' → '+y.p,u:ODKAZ_DOK(d.u)})); otvorLupu(v.indexOf(x)); }
    else window.open(ODKAZ_DOK(d.u),'_blank','noopener');
  });
}
function riadokDok(d,i,skryty){
  const obs=d.zc||[], zip=(d.t||'')==='ZIP'&&obs.length;
  return '<div class="r'+(zip?' jezip':'')+(skryty?' viac':'')+'" data-i="'+i+'"'+(zip?' data-zip=""':'')+'>'
    +(d.n?'<img class="mini" src="'+esc(d.n)+'" alt="" loading="lazy">'
         :'<span class="mini prazdna">'+esc((d.t||'?').slice(0,4))+'</span>')
    +'<span class="nm">'+esc(d.p||'bez názvu')
      +(d.s&&d.s!==d.p?'<em>'+esc(d.s)+(zip?' · '+obs.length+' súborov v archíve':'')+'</em>'
        :(zip?'<em>'+obs.length+' súborov v archíve</em>':''))+'</span>'
    +'<span class="vel">'+velB(d.v)+(d.dt?'<em>'+esc(d.dt)+'</em>':'')+'</span></div>'
    +(zip?'<div class="zip-obsah" data-pre="'+i+'" hidden>'
      +obs.map((x,j)=>'<div class="r" data-pre="'+i+'" data-j="'+j+'">'
        +(x.n?'<img class="mini" src="'+esc(x.n)+'" alt="" loading="lazy">'
             :'<span class="mini prazdna">'+esc((x.p||'').split('.').pop().slice(0,4).toUpperCase())+'</span>')
        +'<span class="nm">'+esc(x.p)+'</span><span class="vel">'+velB(x.v)+'</span></div>').join('')
      +'</div>':'');
}
function zavriDetail(){ $('#detail').className='detail'; }
function naMape(id){
  const f=Z.features.find(x=>x.properties.id===id);
  if(f) map.easeTo({center:f.geometry.coordinates,zoom:Math.max(map.getZoom(),15.5)});
}

/* ---------- lupa ---------- */
function otvorLupu(i){
  if(!LUPA.length) return;
  lupaI=Math.max(0,Math.min(LUPA.length-1,i));
  const x=LUPA[lupaI];
  $('#lupa').classList.add('on');
  $('#lupa-obr').src=x.s||'';
  $('#lupa-obr').style.display=x.s?'block':'none';
  $('#lupa-popis').textContent=x.p+(x.s?'':' — náhľad nie je k dispozícii');
  $('#lupa-original').href=x.u;
  $('#lupa-vlavo').disabled=lupaI===0;
  $('#lupa-vpravo').disabled=lupaI===LUPA.length-1;
}
function zavriLupu(){ $('#lupa').classList.remove('on'); }
$('#lupa-vlavo').onclick=()=>otvorLupu(lupaI-1);
$('#lupa-vpravo').onclick=()=>otvorLupu(lupaI+1);
$('#lupa').addEventListener('click',e=>{ if(e.target.id==='lupa') zavriLupu(); });
document.addEventListener('keydown',e=>{
  if($('#lupa').classList.contains('on')){
    if(e.key==='Escape') zavriLupu();
    if(e.key==='ArrowLeft') otvorLupu(lupaI-1);
    if(e.key==='ArrowRight') otvorLupu(lupaI+1);
  } else if(e.key==='Escape'){ zrusPridavanie(); zavriDetail(); }
});

/* ---------- pridávanie bodu priamo v mape ----------
   Rozhranie je hotové na server: `odosli()` pošle záznam na API, keď je
   v komunita.json nastavené. Kým nie je, ostane v prehliadači a dá sa
   vyexportovať — nič sa nestratí a nič sa nemusí prepisovať. */
let pridavam=false, docasnyBod=null;
/* mapa je „zaneprázdnená", keď sa pridáva bod alebo navrhuje poloha —
   vtedy klik na mapu nemá otvárať karty */
const zaneprazdnene=()=>pridavam||!!presuvam;
const KLUC_MOJE='mib-moje-body';
const mojeBody=()=>{try{return JSON.parse(localStorage.getItem(KLUC_MOJE)||'[]');}catch(e){return [];}};

function zacniPridavanie(){
  pridavam=true;
  document.body.classList.add('pridavam');
  $('#navod').classList.add('on');
  $('#navod-txt').textContent='Klikni na mapu tam, kde projekt stojí';
  zavriDetail();
}
function zrusPridavanie(){
  pridavam=false; docasnyBod=null;
  document.body.classList.remove('pridavam');
  $('#navod').classList.remove('on');
  map.getSource('novy')&&map.getSource('novy').setData({type:'FeatureCollection',features:[]});
}
function formularBodu(lngLat){
  docasnyBod=[+lngLat.lng.toFixed(6), +lngLat.lat.toFixed(6)];
  map.getSource('novy').setData({type:'FeatureCollection',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:docasnyBod},properties:{}}]});
  $('#navod-txt').textContent='Bod umiestnený — vyplň údaje vpravo. Klikni znova, ak chceš posunúť.';
  const moznosti=t=>TYPY.map(x=>'<option'+(x===t?' selected':'')+'>'+esc(x)+'</option>').join('');
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML=
     '<button class="zavri" onclick="zrusPridavanie();zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">NOVÝ ZÁMER</span></div>'
    +'<h2>Pridať projekt</h2>'
    +'<div class="miesto">◉ '+docasnyBod[1].toFixed(5)+', '+docasnyBod[0].toFixed(5)+'</div>'
    +'<div class="form" style="display:flex;flex-direction:column;gap:12px">'
      +'<div><label>Názov projektu *</label><input id="n-nazov" placeholder="napr. Polyfunkčný súbor Nové Nivy"></div>'
      +'<div class="par">'
        +'<div><label>Účel</label><select id="n-typ">'+moznosti('Bývanie')+'</select></div>'
        +'<div><label>Fáza</label><select id="n-faza">'
          +FAZY.map(([f])=>'<option>'+f+'</option>').join('')+'</select></div></div>'
      +'<div><label>Popis</label><textarea id="n-popis" placeholder="O čo ide, v akom je stave…"></textarea></div>'
      +'<div class="par">'
        +'<div><label>Investor</label><input id="n-investor"></div>'
        +'<div><label>Architekt</label><input id="n-architekt"></div></div>'
      +'<div><label>Odkaz na obrázok</label><input id="n-obrazok" placeholder="https://…"></div>'
      +'<div><label>Odkaz na projekt</label><input id="n-odkaz" placeholder="https://…"></div>'
      +'<div><label>Kto pridáva *</label><input id="n-autor" placeholder="meno alebo ateliér"></div>'
    +'</div>'
    +'<button class="odkaz" style="border:0;cursor:pointer" id="n-uloz">Odoslať na schválenie</button>'
    +'<p class="pozn" id="n-stav">Záznam pôjde správcovi na schválenie. Kým ho neschváli, '
    +'vidíš ho len ty.</p>';
  $('#n-uloz').onclick=ulozNovy;
}
async function ulozNovy(){
  const v=id=>($('#'+id)?$('#'+id).value.trim():'');
  if(!v('n-nazov')||!v('n-autor')){
    $('#n-stav').innerHTML='<b style="color:var(--ac2)">Vyplň aspoň názov a kto pridáva.</b>'; return;
  }
  /* Bez polohy je záznam pre mapu bezcenný — radšej nič neuložíme. */
  if(!docasnyBod){
    $('#n-stav').innerHTML='<b style="color:var(--ac2)">Chýba poloha — klikni na mapu.</b>'; return;
  }
  const zaznam={nazov:v('n-nazov'), typ:v('n-typ'), faza:v('n-faza'), popis:v('n-popis'),
    investor:v('n-investor'), architekt:v('n-architekt'), obrazok:v('n-obrazok'),
    odkaz:v('n-odkaz'), autor:v('n-autor'),
    suradnice:docasnyBod, kedy:new Date().toISOString(), schvalene:false};
  $('#n-stav').textContent='odosielam…';
  if(KONFIG.api){
    try{
      const r=await fetch(KONFIG.api,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(zaznam)});
      if(!r.ok) throw new Error('HTTP '+r.status);
      $('#n-stav').innerHTML='<b style="color:#12A67A">Odoslané.</b> Správca to schváli a bod sa objaví všetkým.';
      zrusPridavanie(); nacitajKomunitu(); return;
    }catch(e){
      $('#n-stav').innerHTML='Server neodpovedal, ukladám do prehliadača. ('+esc(e.message)+')';
    }
  }
  const zoz=mojeBody(); zoz.push(zaznam);
  localStorage.setItem(KLUC_MOJE, JSON.stringify(zoz));
  kresliMoje();
  $('#n-stav').innerHTML='<b style="color:#12A67A">Uložené u teba.</b> Server zatiaľ nebeží, '
    +'takže bod vidíš len ty. <a href="../komunita/" style="color:var(--ac2)">Exportovať a poslať →</a>';
  setTimeout(()=>{zrusPridavanie(); zavriDetail();},2600);
}
function kresliMoje(){
  const zoz=mojeBody().filter(x=>Array.isArray(x.suradnice));
  if(!map.getSource('moje')) return;
  map.getSource('moje').setData({type:'FeatureCollection',
    features:zoz.map((x,i)=>({type:'Feature',geometry:{type:'Point',coordinates:x.suradnice},
      properties:{i:i,nazov:x.nazov,typ:x.typ,faza:x.faza,popis:x.popis,
        autor:x.autor,obrazok:x.obrazok,odkaz:x.odkaz,moj:1}}))});
}

/* ---------- návrh polohy ----------
   Ktokoľvek môže bod presunúť tam, kde stavba naozaj je. Nič sa nemení
   hneď: návrh ide ako verejná položka (issue) do repozitára mapy, redakcia
   ho v aplikácii Redakcia prevezme jedným klikom a po uložení sa bod
   presunie. Kto GitHub nemá, skopíruje text a pošle ho mailom. Ak je
   v komunita.json nastavené `api`, návrh sa pošle tam. */
let presuvam=null, presunMarker=null;
const KLUC_NAVRHY='mib-navrhy-polohy', KLUC_KTO='mib-navrh-kto';
const REPO_MAPY='SamuelZenko/kto-stoji-za-projektom';
const mojeNavrhy=()=>{try{return JSON.parse(localStorage.getItem(KLUC_NAVRHY)||'{}');}catch(e){return {};}};
function zacniPresun(id){
  const f=Z.features.find(x=>x.properties.id===id); if(!f) return;
  zrusPridavanie(); zavriDetail();
  presuvam={id:id,p:f.properties,puvod:f.properties.presnost==='presná'?f.geometry.coordinates:null,bod:null};
  document.body.classList.add('pridavam');
  $('#navod').classList.add('on');
  $('#navod-txt').textContent='Klikni na mapu tam, kde „'+(f.properties.nazov_obch||f.properties.nazov).slice(0,48)+'“ naozaj stojí';
  if(presuvam.puvod) map.easeTo({center:presuvam.puvod,zoom:Math.max(map.getZoom(),15)});
}
function polozNavrh(lngLat){
  const s=[+lngLat.lng.toFixed(6),+lngLat.lat.toFixed(6)];
  presuvam.bod=s;
  if(!presunMarker){
    presunMarker=new maplibregl.Marker({color:'#F3716D',draggable:true}).setLngLat(s).addTo(map);
    presunMarker.on('dragend',()=>{ const l=presunMarker.getLngLat();
      presuvam.bod=[+l.lng.toFixed(6),+l.lat.toFixed(6)]; formularNavrhu(); });
  } else presunMarker.setLngLat(s);
  $('#navod-txt').textContent='Bod položený — môžeš ho ešte potiahnuť. Potom vyplň, kto návrh posiela.';
  formularNavrhu();
}
function zrusPresun(){
  presuvam=null;
  if(presunMarker){ presunMarker.remove(); presunMarker=null; }
  document.body.classList.remove('pridavam'); $('#navod').classList.remove('on');
}
function formularNavrhu(){
  const p=presuvam.p, s=presuvam.bod;
  const kto=$('#nv-kto')?$('#nv-kto').value:(localStorage.getItem(KLUC_KTO)||'');
  const pozn=$('#nv-pozn')?$('#nv-pozn').value:'';
  const posun=presuvam.puvod?Math.round(vzdialenost(presuvam.puvod[0],presuvam.puvod[1],s[0],s[1])):null;
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zrusPresun();zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">NÁVRH POLOHY</span><span class="stitok">NA SCHVÁLENIE</span></div>'
    +'<h2>'+esc(p.nazov_obch||p.nazov)+'</h2>'
    +'<div class="miesto">◉ '+s[1].toFixed(5)+', '+s[0].toFixed(5)
      +(posun!==null?' · '+cis(posun)+' m od bodu v mape':' · zámer doteraz nemal presnú polohu')+'</div>'
    +'<div class="form" style="display:flex;flex-direction:column;gap:12px">'
      +'<div><label>Kto navrhuje *</label><input id="nv-kto" value="'+esc(kto)+'" placeholder="meno, ateliér alebo firma"></div>'
      +'<div><label>Odkiaľ to vieš (nepovinné)</label><textarea id="nv-pozn" placeholder="napr. stavebné povolenie, tabuľa na plote, vlastný projekt…">'+esc(pozn)+'</textarea></div>'
    +'</div>'
    +'<button class="odkaz" id="nv-odosli">'+(KONFIG.api?'Odoslať na schválenie':'Odoslať na schválenie cez GitHub →')+'</button>'
    +'<button class="odkaz presun" id="nv-kopiruj">Skopírovať text návrhu<span>pre tých, čo GitHub nemajú — pošli ho redakcii mailom</span></button>'
    +'<p class="pozn">Návrh sa objaví ako verejná položka v repozitári mapy. Redakcia ho prevezme v aplikácii Redakcia '
    +'a po uložení sa bod presunie. Do mapy sa bez schválenia nič nezapíše.</p>';
  $('#nv-odosli').onclick=odosliNavrh;
  $('#nv-kopiruj').onclick=()=>{ const n=zostavNavrh(); if(n) doSchranky(n.text,'Text návrhu skopírovaný'); };
}
function zostavNavrh(){
  const p=presuvam.p, s=presuvam.bod;
  const kto=$('#nv-kto').value.trim(), pozn=$('#nv-pozn').value.trim();
  if(!kto){ $('#nv-kto').focus(); hlaska('Napíš, kto návrh posiela.'); return null; }
  localStorage.setItem(KLUC_KTO,kto);
  const kedy=new Date().toISOString().slice(0,10);
  const karta=location.origin+location.pathname+'?id='+encodeURIComponent(p.id);
  const strojovo=JSON.stringify({id:p.id,poloha:s,kto:kto,pozn:pozn,kedy:kedy});
  const text='Návrh polohy pre zámer **'+(p.nazov_obch||p.nazov)+'** ('+(p.obec||'')+')\n\n'
    +'- Karta v mape: '+karta+'\n'
    +'- Navrhovaná poloha: '+s[1].toFixed(6)+', '+s[0].toFixed(6)
      +' — https://www.google.com/maps/search/?api=1&query='+s[1].toFixed(6)+','+s[0].toFixed(6)+'\n'
    +'- Doterajšia poloha v mape: '+(p.presnost==='presná'?'presná ('+(p.zdroj_polohy||'prvý zber')+')':'len ťažisko mestskej časti')+'\n'
    +'- Navrhuje: '+kto+'\n'+(pozn?'- Poznámka: '+pozn+'\n':'')
    +'\n<!-- navrh-polohy '+strojovo+' -->\n';
  return {nazov:'Návrh polohy: '+(p.nazov_obch||p.nazov).slice(0,80)+' ['+p.id+']',text:text,zaznam:{id:p.id,poloha:s,kto:kto,pozn:pozn,kedy:kedy}};
}
async function odosliNavrh(){
  const n=zostavNavrh(); if(!n) return;
  const id=presuvam.id;
  if(KONFIG.api){
    try{
      const r=await fetch(KONFIG.api,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(Object.assign({druh:'poloha'},n.zaznam))});
      if(!r.ok) throw new Error('HTTP '+r.status);
    }catch(e){ hlaska('Server neodpovedal ('+e.message+'), skús GitHub.'); return; }
  } else {
    window.open('https://github.com/'+REPO_MAPY+'/issues/new?title='+encodeURIComponent(n.nazov)
      +'&body='+encodeURIComponent(n.text),'_blank','noopener');
  }
  const m=mojeNavrhy(); m[id]=n.zaznam; localStorage.setItem(KLUC_NAVRHY,JSON.stringify(m));
  zrusPresun();
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">NÁVRH POLOHY</span></div>'
    +'<h2>Ďakujeme</h2>'
    +'<p class="text">'+(KONFIG.api?'Návrh je odoslaný. ':'V novej karte sa otvoril GitHub s vyplneným návrhom — stačí ho potvrdiť tlačidlom <b>Submit new issue</b>. ')
    +'Redakcia ho posúdi a po schválení sa bod v mape presunie.</p>'
    +'<button class="odkaz presun" onclick="doSchranky('+JSON.stringify(n.text).replace(/"/g,'&quot;')+',\'Text návrhu skopírovaný\')">Skopírovať text návrhu<span>keby sa GitHub neotvoril</span></button>';
}

/* ---------- komunitné body ---------- */
function csvRiadky(t){
  const von=[]; let r=[],p='',v=false;
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(v){ if(c==='"'){ if(t[i+1]==='"'){p+='"';i++;} else v=false; } else p+=c; }
    else if(c==='"') v=true;
    else if(c===','||c===';'){ r.push(p); p=''; }
    else if(c==='\n'){ r.push(p); von.push(r); r=[]; p=''; }
    else if(c!=='\r') p+=c;
  }
  if(p||r.length){ r.push(p); von.push(r); }
  return von;
}
const suradnice=t=>{
  const c=(t||'').match(/-?\d+[.,]\d+/g); if(!c||c.length<2) return null;
  const a=parseFloat(c[0].replace(',','.')), b=parseFloat(c[1].replace(',','.'));
  let lat=a, lon=b; if(a>16&&a<19&&b>47&&b<49){ lat=b; lon=a; }
  return (lat>47.9&&lat<48.5&&lon>16.7&&lon<17.5)?[lon,lat]:null;
};
async function nacitajKomunitu(){
  const h=localStorage.getItem('mib-komunita-harok')||KONFIG.harok||'';
  if(!h){ $('#kom-pocet').textContent=''; return; }
  try{
    const r=csvRiadky((await (await fetch(h)).text()).replace(/^﻿/,''));
    const hl=r[0].map(x=>x.trim().toLowerCase());
    const idx=n=>hl.findIndex(x=>x.startsWith(n));
    const iN=idx('nazov'), iS=idx('suradnice'), iSch=idx('schval');
    const prvky=[];
    r.slice(1).forEach(x=>{
      const ok=(x[iSch]||'').trim().toLowerCase();
      if(iSch>=0 && !['ano','áno','x','true','1','ok'].includes(ok)) return;
      const s=suradnice(x[iS]); if(!s||!x[iN]) return;
      prvky.push({type:'Feature',geometry:{type:'Point',coordinates:s},
        properties:{nazov:x[iN],typ:x[idx('typ')]||'',faza:x[idx('faza')]||'',
          popis:x[idx('popis')]||'',autor:x[idx('autor')]||'',
          investor:x[idx('investor')]||'',architekt:x[idx('architekt')]||'',
          obrazok:x[idx('obrazok')]||'',odkaz:x[idx('odkaz')]||''}});
    });
    map.getSource('komunita').setData({type:'FeatureCollection',features:prvky});
    $('#kom-pocet').textContent='('+prvky.length+')';
  }catch(e){ $('#kom-pocet').textContent='(nedá sa načítať)'; }
}
/* karta vyhlášky z úradnej tabule MČ — úradný dokument, ale bez zámeru v EIA */
function ukazTabulu(p){
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok">'+esc((p.druh||'vyhláška').toUpperCase())+'</span>'
      +'<span class="stitok b">ÚRADNÁ TABUĽA MČ</span></div>'
    +'<h2>'+esc(p.n)+'</h2>'
    +'<div class="miesto">◉ '+esc(p.mc||'')+(p.datum?' · '+esc(p.datum):'')+'</div>'
    +'<div class="udaje">'
      +riadok('Stavebník', p.stavebnik?esc(p.stavebnik)+(p.ico?' · IČO '+esc(p.ico):''):null)
      +riadok('Parcely', p.parcely?esc(p.parcely)+(p.ku?' · k. ú. '+esc(p.ku):''):null)
      +riadok('V registri EIA', '<span class="v chyba">nie je — stavba pod zákonným prahom</span>', true)
    +'</div>'
    +'<a class="odkaz" href="'+esc(p.url)+'" target="_blank" rel="noopener">Dokument z úradnej tabule →</a>'
    +(p.detail&&p.detail!==p.url?'<a class="odkaz" href="'+esc(p.detail)+'" target="_blank" rel="noopener">Záznam na tabuli MČ →</a>':'')
    +'<p class="pozn">Zdroj: verejná vyhláška stavebného úradu MČ '+esc(p.mc||'')+'. Poloha je ťažisko parciel '
    +'uvedených v dokumente, overené v katastri. Register EIA túto stavbu nevidí.</p>';
}
/* karta staveniska z OSM — údaje od komunity OpenStreetMap, nie z úradu */
function ukazOsm(p){
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok" style="background:#F3716D">STAVENISKO</span>'
      +(p.druh?'<span class="stitok b">'+esc(p.druh.toUpperCase())+'</span>':'')+'</div>'
    +'<h2>'+esc(p.n)+'</h2>'
    +'<div class="miesto">◉ '+esc(p.mc||'')+'</div>'
    +'<div class="udaje">'
      +riadok('Investor', p.dev?esc(p.dev):null)
      +riadok('Začiatok stavby', p.od?esc(p.od):null)
      +riadok('V registri EIA', '<span class="v chyba">nie je — stavba pod zákonným prahom, alebo iné konanie</span>', true)
    +'</div>'
    +(p.web?'<a class="odkaz" href="'+esc(p.web)+'" target="_blank" rel="noopener">Web projektu →</a>':'')
    +'<a class="odkaz" href="https://www.openstreetmap.org/'+esc(p.osm)+'" target="_blank" rel="noopener">Stavenisko v OpenStreetMap →</a>'
    +'<p class="pozn">Zdroj: OpenStreetMap (ODbL) — rozostavaný projekt zakreslený a pomenovaný '
    +'komunitou mapperov, nie úradný údaj. Register EIA ho nevidí; kto stavia, sa dá dohľadať cez '
    +'<a href="../" style="color:var(--ac2)">Kto stojí za projektom</a>.</p>';
}
function ukazKomunitu(p){
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">'+(p.moj?'ČAKÁ NA ODOSLANIE':'KOMUNITNÝ ZÁZNAM')+'</span>'
      +(p.typ?'<span class="stitok">'+esc(p.typ.toUpperCase())+'</span>':'')+'</div>'
    +'<h2>'+esc(p.nazov)+'</h2>'
    +(p.obrazok?'<div class="galeria"><img src="'+esc(p.obrazok)+'" alt=""></div>':'')
    +'<div class="udaje">'
      +riadok('Investor', p.investor?esc(p.investor):null)
      +riadok('Architekt', p.architekt?esc(p.architekt):null)
      +riadok('Fáza', p.faza?esc(p.faza):null)
      +riadok('Pridal', p.autor?esc(p.autor):null)
    +'</div>'
    +(p.popis?'<p style="font-size:13.5px;color:var(--tx2);margin:0">'+esc(p.popis)+'</p>':'')
    +(p.moj?'<div class="cakajuce">Tento bod máš zatiaľ len u seba v prehliadači. '
      +'Server na zbieranie ešte nebeží — keď ho spustíme, odošle sa automaticky.</div>':'')
    +(p.odkaz?'<a class="odkaz" href="'+esc(p.odkaz)+'" target="_blank" rel="noopener">Viac o projekte →</a>':'')
    +'<p class="pozn">Nie je to údaj z registra, ale od komunity.</p>';
}

/* ---------- štart ----------
   Dáta sťahujeme hneď, súbežne s mapou. Keby sme čakali na 'load',
   pomalý alebo nedostupný podklad z geoportálu nechá stránku prázdnu —
   a to sa reálne stáva. */
/* no-cache = podmienené stiahnutie: keď sa dáta nezmenili, príde 304 a
   nič sa neťahá; keď zmenili, nedostaneš starú kópiu z prehliadača. */
const ber=(s,zal)=>{
  const p=fetch(s,{cache:'no-cache'}).then(r=>r.json());
  return zal===undefined?p:p.catch(()=>zal);
};
const DATA=Promise.all([
  ber('komunita.json',{}),
  ber('mestske-casti.geojson'),
  ber('zamery.geojson'),
  ber('ulice.geojson',null),
  ber('nazvy-obchodne.json',{}),
  ber('osm-staveniska.geojson',null),
  ber('tabule-stavby.geojson',null),
  ber('redakcia.json',null),
  ber('stav.json',{})]);

/* ---------- redakčná vrstva ----------
   Ručné doplnenia z aplikácie /redakcia/ (poloha, obrázky, obchodný názov,
   fáza, architekt…) sa zlúčia do bodov až tu, v prehliadači — hneď po
   uložení, bez čakania na týždenný beh. Každé pole má v karte napísané,
   že je od redakcie. Nové zámery mimo registra dostanú `zdroj:'redakcia'`. */
function zlucRedakciu(z,red){
  if(!red) return;
  const podla={}; z.features.forEach(f=>podla[f.properties.id]=f);
  const obr=r=>(r.obrazky||[]).map(o=>({u:o.u||o.s,p:(o.p||'vizualizácia')+(o.z?' — '+o.z:'')}));
  Object.entries(red.zamery||{}).forEach(([id,r])=>{
    const f=podla[id]; if(!f) return; const p=f.properties;
    if(r.poloha){ f.geometry={type:'Point',coordinates:r.poloha}; p.presnost='presná'; p.zdroj_polohy='redakcia'; if(r.poloha_pozn) p.poloha_pozn=r.poloha_pozn; }
    if(r.nazov){ p.nazov_obch=r.nazov; p.nazov_zdroj='redakcia'+(r.kto?' ('+r.kto+')':''); }
    if(r.faza){ p.faza=r.faza; p.faza_zdroj='redakcia'; }
    ['popis','architekt','investor','odkaz'].forEach(k=>{ if(r[k]) p['red_'+k]=r[k]; });
    if(r.obrazky&&r.obrazky.length) p.obrazky=obr(r);
    p.red_kedy=r.kedy||''; p.redakcia=1;
  });
  Object.entries(red.nove||{}).forEach(([id,r])=>{
    if(!r.poloha||!r.nazov) return;
    const p={id:id,nazov:r.nazov,obec:r.obec||'',typ:r.typ||'Iné',faza:r.faza||'zámer',faza_zdroj:'redakcia',
      firma:r.investor||'',presnost:'presná',zdroj_polohy:'redakcia',zdroj:'redakcia',redakcia:1,
      zmena:r.kedy||'',red_kedy:r.kedy||'',dok:0};
    ['popis','architekt','investor','odkaz'].forEach(k=>{ if(r[k]) p['red_'+k]=r[k]; });
    if(r.poloha_pozn) p.poloha_pozn=r.poloha_pozn;
    if(r.obrazky&&r.obrazky.length) p.obrazky=obr(r);
    z.features.push({type:'Feature',geometry:{type:'Point',coordinates:r.poloha},properties:p});
  });
}

let spustene=false;
async function spusti(){
  if(spustene) return; spustene=true;
  let mc,z,ul,naz,osm,tab,red,stav;
  try{ pridajPodklad(); }
  catch(e){ console.warn('podklad sa nepridal:',e.message); }
  try{ [KONFIG,mc,z,ul,naz,osm,tab,red,stav]=await DATA; }
  catch(e){ $('#c-spolu').textContent='Dáta sa nenačítali'; spustene=false; return; }
  Z=z;
  /* komerčné názvy sú ručný zoznam — register ich nepozná a ochranné
     známky sa podľa majiteľa hľadať nedajú, tak sa dopĺňajú rukou */
  z.features.forEach(f=>{ const n=naz&&naz[f.properties.id]; if(!n) return;
    if(typeof n==='string') f.properties.nazov_obch=n;
    else if(n.nazov){ f.properties.nazov_obch=n.nazov; f.properties.nazov_zdroj=(n.zdroj||'')+(n.istota?' · istota '+n.istota:''); } });
  /* redakcia prepíše názov aj polohu — je to ručne overený údaj */
  zlucRedakciu(z,red);
  oznacNovinky(z,tab,stav);
  mc.features.forEach(f=>{
    const a=f.properties||{}, nz=a.NAZOV_ZUJ||a.MC_LABEL||''; if(!nz||!f.geometry) return;
    const g=f.geometry;
    const kr=g.type==='Polygon'?g.coordinates[0]
      :g.coordinates.reduce((x,y)=>y[0].length>x.length?y[0]:x,[]);
    TAZISKA[nz]=[kr.reduce((s,c)=>s+c[0],0)/kr.length, kr.reduce((s,c)=>s+c[1],0)/kr.length];
  });

  if(ul){
    map.addSource('ulice',{type:'geojson',data:ul});
    map.addLayer({id:'ulice-txt',type:'symbol',source:'ulice',minzoom:13.5,
      layout:{'text-field':['get','n'],'symbol-placement':'line','text-size':11,
        'text-font':['Noto Sans Regular'],'text-letter-spacing':.03,
        'text-max-angle':38,'symbol-spacing':270},
      paint:{'text-color':'#8A8A86','text-halo-color':PALETY[paleta].halo,'text-halo-width':1.4}});
  }
  map.addSource('hranice',{type:'geojson',data:mc});
  map.addLayer({id:'hranice-c',type:'line',source:'hranice',
    paint:{'line-color':'#000000','line-opacity':.45,'line-width':1,'line-dasharray':[4,3]}});
  map.addSource('mcnazvy',{type:'geojson',data:{type:'FeatureCollection',
    features:Object.keys(TAZISKA).map(o=>({type:'Feature',
      geometry:{type:'Point',coordinates:TAZISKA[o]},
      properties:{n:o.replace(/^Bratislava\s*[-–]\s*/,'').toUpperCase()}}))}});
  map.addLayer({id:'mc-txt',type:'symbol',source:'mcnazvy',
    layout:{'text-field':['get','n'],'text-size':['interpolate',['linear'],['zoom'],10,10,14,13],
      'text-font':['Noto Sans Regular'],'text-letter-spacing':.16,'text-max-width':9},
    paint:{'text-color':'#6E6E6A','text-halo-color':PALETY[paleta].halo,'text-halo-width':1.6}});

  /* ikony kreslené v prehliadači: bublina pod popisky bodov (naťahovací
     rámček ako v Praha zítra) a štvorce pre stavby mimo registra */
  pridajIkony();

  /* Zhlukovanie — pravidlá, ktoré má čitateľ vidieť bez vysvetľovania:
       zoom ≤ 13   body do 48 px od seba sú jedna čierna bublina s číslom;
                   pri pohľade na celé mesto vyjde zhruba jedna na lokalitu
       zoom 14     každý zámer samostatne (bez názvu)
       zoom ≥ 14.5 názvy v bielych pilulkách
     Polomer 20 px z prvej verzie robil desiatky bublín „2“ a „3“ medzi
     samostatnými bodmi — vyzeralo to náhodne, lebo o zlúčení rozhodovali
     pixle, nie hustota. Veľkosť bubliny rastie s počtom po krokoch,
     dvojica je sotva väčšia než bod. */
  /* zhluk si nesie počty fáz — z nich je prstenec okolo bubliny */
  const sucet=f=>['+',['case',['==',['get','faza'],f],1,0]];
  map.addSource('zamery',{type:'geojson',data:{type:'FeatureCollection',features:[]},
    cluster:true, clusterRadius:48, clusterMaxZoom:13,
    clusterProperties:{f1:sucet('zámer'),f2:sucet('posúdené'),f3:sucet('povolené'),f4:sucet('dokončené')}});
  /* Zhluk = čierna bublina s číslom — motív bubliny na linke z logotypu —
     a okolo nej tenký prstenec s pomerom fáz, nech je pomer zámerov
     a povolených vidno bez rozkliknutia. Prstenec sa nedá nakresliť
     štýlom, preto sú zhluky HTML značky (kresliDonuty). Vrstva 'zh' ostáva
     skrytá ako kotva poradia pre plošné vrstvy a pre expanziu po kliku. */
  map.addLayer({id:'zh',type:'circle',source:'zamery',filter:['has','point_count'],
    layout:{visibility:'none'},paint:{'circle-color':'#000000','circle-radius':10}});
  /* teplotná mapa potrebuje surové body, nie zhluky — vlastný zdroj s tými
     istými dátami; prepína sa v ponuke Vrstvy */
  map.addSource('zamery-h',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'teplo',type:'heatmap',source:'zamery-h',layout:{visibility:'none'},
    paint:{'heatmap-weight':1,
      'heatmap-intensity':['interpolate',['linear'],['zoom'],9,.7,13,1.6,16,3],
      'heatmap-radius':['interpolate',['linear'],['zoom'],9,16,12,30,15,55],
      'heatmap-opacity':.85,
      'heatmap-color':['interpolate',['linear'],['heatmap-density'],
        0,'rgba(243,113,109,0)',.12,'rgba(251,213,211,.55)',.35,'#F3B0AE',.65,'#F3716D',1,'#000000']}});
  map.addLayer({id:'bod',type:'circle',source:'zamery',filter:['!',['has','point_count']],
    paint:{'circle-color':['match',['get','faza'],'zámer','#F3716D','posúdené','#000000',
        'povolené','#FFFFFF','dokončené','#B4B4B0',SIVA],
      'circle-radius':['interpolate',['linear'],['zoom'],10,4.5,14,7,18,11],
      /* líniové stavby majú hrubý sivý prstenec, nech sa dajú od budov rozoznať */
      'circle-stroke-width':['case',['==',['get','lin'],1],3.5,1.5],
      'circle-stroke-color':['case',['==',['get','lin'],1],SIVA,'#000000']}});
  /* odznak novinky: malá červená bodka vpravo hore pri bode (posun platí
     pre celú vrstvu, preto je to samostatná vrstva len pre nové) */
  map.addLayer({id:'bod-nove',type:'circle',source:'zamery',
    filter:['all',['!',['has','point_count']],['==',['get','nove'],1]],
    paint:{'circle-color':'#F3716D','circle-radius':['interpolate',['linear'],['zoom'],10,3,14,4,18,5.5],
      'circle-stroke-width':1.5,'circle-stroke-color':'#FFFFFF',
      'circle-translate':['interpolate',['linear'],['zoom'],10,[4,-4],14,[6,-6],18,[9,-9]]}});
  /* popisky ako biele pilulky s čiernym rámčekom — ikona sa natiahne na text */
  map.addLayer({id:'bod-txt',type:'symbol',source:'zamery',
    filter:['!',['has','point_count']],minzoom:14.5,
    layout:{'text-field':['coalesce',['get','nazov_obch'],['get','nazov']],'text-size':11,'text-anchor':'left',
      'text-offset':[1.1,0],'text-max-width':12,'text-font':['Noto Sans Regular'],
      'text-optional':true,'text-justify':'left',
      'icon-image':'bublina','icon-text-fit':'both','icon-text-fit-padding':[4,8,4,8],'icon-optional':false},
    paint:{'text-color':'#000000'}});

  /* Zámery bez známej polohy: jeden čiarkovaný kruh na mestskú časť, rovnaký
     znak ako v legende. Len pri pohľade na mesto (do zoomu 12) a pod
     zhlukmi — v pôvodnej verzii sedeli sivé kruhy „90“ a „47“ cez čierne
     bubliny a vyzerali ako ďalšie zhluky. */
  map.addSource('nezname',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'nez',type:'symbol',source:'nezname',maxzoom:12,
    layout:{'icon-image':'kruh-ciarkovany','icon-allow-overlap':true,'text-allow-overlap':true,
      'icon-size':['interpolate',['linear'],['get','pocet'],1,.55,20,.8,150,1.2],
      'text-field':['get','pocet'],'text-size':11,'text-font':['Noto Sans Regular']},
    paint:{'text-color':'#6E6E6A'}},'zh');

  map.addSource('komunita',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addSource('moje',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  [['kom','komunita','#FFFFFF'],['moj','moje','#FBD5D3']].forEach(([id,src,c])=>{
    map.addLayer({id:id,type:'circle',source:src,
      paint:{'circle-color':c,
        'circle-radius':['interpolate',['linear'],['zoom'],10,4.5,14,7,18,11],
        'circle-stroke-width':2,'circle-stroke-color':'#F3716D'}});
    map.addLayer({id:id+'-txt',type:'symbol',source:src,minzoom:13,
      layout:{'text-field':['get','nazov'],'text-size':11,'text-anchor':'left',
        'text-offset':[1.1,0],'text-max-width':12,'text-font':['Noto Sans Regular'],
        'text-optional':true,'icon-image':'bublina','icon-text-fit':'both','icon-text-fit-padding':[4,8,4,8]},
      paint:{'text-color':'#000000'}});
    map.on('click',id,e=>ukazKomunitu(e.features[0].properties));
  });
  map.addSource('novy',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'novy-b',type:'circle',source:'novy',
    paint:{'circle-color':'#F3716D','circle-radius':11,'circle-stroke-width':3,
      'circle-stroke-color':'#000'}});

  /* staveniská z OpenStreetMap, ktoré k žiadnemu zámeru nesedia — stavby
     pod prahom EIA. Iný tvar (červený štvorec), aby sa nemiešali s registrom. */
  if(osm && osm.features){
    /* zdroj sa nesmie volať 'osm' — tak sa volá podkladová vektorová mapa */
    map.addSource('osm-st',{type:'geojson',data:osm});
    map.addLayer({id:'osm-b',type:'symbol',source:'osm-st',
      layout:{visibility:$('#v-osm').checked?'visible':'none','icon-image':'stvorec-cerveny','icon-allow-overlap':true,
        'icon-size':['interpolate',['linear'],['zoom'],10,.45,14,.7,18,1]}});
    map.addLayer({id:'osm-txt',type:'symbol',source:'osm-st',minzoom:13,
      layout:{visibility:$('#v-osm').checked?'visible':'none','text-field':['get','n'],'text-size':11,'text-anchor':'left',
        'text-offset':[1.1,0],'text-max-width':12,'text-font':['Noto Sans Regular'],
        'text-optional':true,'icon-image':'bublina','icon-text-fit':'both','icon-text-fit-padding':[4,8,4,8]},
      paint:{'text-color':'#E4534F'}});
    map.on('click','osm-b',e=>{ if(!zaneprazdnene()) ukazOsm(e.features[0].properties); });
    map.on('mouseenter','osm-b',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave','osm-b',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='';});
    $('#stav-osm').textContent='('+osm.features.length+')';
    $('#legenda-osm').hidden=!$('#v-osm').checked;
  } else { $('#stav-osm').textContent='(nedá sa načítať)'; }

  /* vyhlášky stavebných úradov, ktoré k žiadnemu zámeru nesedia — povolené
     stavby pod prahom EIA, z úradných tabúľ MČ (sledované od 8. 9. 2026) */
  if(tab && tab.features){
    map.addSource('tab-st',{type:'geojson',data:tab});
    map.addLayer({id:'tab-b',type:'symbol',source:'tab-st',
      layout:{visibility:$('#v-tabule').checked?'visible':'none','icon-image':'stvorec-cierny','icon-allow-overlap':true,
        'icon-size':['interpolate',['linear'],['zoom'],10,.45,14,.7,18,1]}});
    map.addLayer({id:'tab-txt',type:'symbol',source:'tab-st',minzoom:13,
      layout:{visibility:$('#v-tabule').checked?'visible':'none','text-field':['get','n'],'text-size':11,'text-anchor':'left',
        'text-offset':[1.1,0],'text-max-width':12,'text-font':['Noto Sans Regular'],
        'text-optional':true,'icon-image':'bublina','icon-text-fit':'both','icon-text-fit-padding':[4,8,4,8]},
      paint:{'text-color':'#000000'}});
    map.on('click','tab-b',e=>{ if(!zaneprazdnene()) ukazTabulu(e.features[0].properties); });
    map.on('mouseenter','tab-b',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave','tab-b',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='';});
    $('#stav-tabule').textContent='('+tab.features.length+')';
    $('#legenda-tabule').hidden=!$('#v-tabule').checked;
  } else { $('#stav-tabule').textContent='(nedá sa načítať)'; }

  [...new Set(z.features.map(f=>f.properties.obec).filter(Boolean))].sort()
    .forEach(o=>$('#f-mc').insertAdjacentHTML('beforeend','<option>'+esc(o)+'</option>'));
  [...new Set(z.features.map(f=>f.properties.skupina).filter(Boolean))].sort()
    .forEach(o=>$('#f-sk').insertAdjacentHTML('beforeend','<option>'+esc(o)+'</option>'));
  /* farby typov sa priradia raz zo všetkých, aby sa nepremiešali,
     keď sa líniové stavby zapnú alebo vypnú */
  const pcv={}; z.features.forEach(f=>{const t=f.properties.typ||'Iné'; pcv[t]=(pcv[t]||0)+1;});
  /* účel stavby: čierno-biela škála + červená, nie dúha */
  const paletaTypov=['#000000','#F3716D','#FFFFFF','#8A8A86','#F3B0AE','#D9D9D6',
                '#55555A','#B4B4B0','#FBD5D3','#6E6E6A','#8A8A86'];
  Object.keys(pcv).sort((a,b)=>pcv[b]-pcv[a]).forEach((t,i)=>BARVA_TYPU[t]=paletaTypov[i%paletaTypov.length]);
  zostavTypy();
  const nl=z.features.filter(f=>f.properties.lin).length;
  $('#stav-lin').textContent='('+cis(nl)+')';
  prefarbi();

  obnov(); kresliMoje(); nacitajKomunitu(); kresliPostup();
  map.on('render',()=>{ if(map.getSource('zamery')&&map.isSourceLoaded('zamery')) kresliDonuty(); });

  /* ?id=… otvorí kartu zámeru — odkazy z redakcie a zo zoznamov */
  const chceneId=new URLSearchParams(location.search).get('id');
  if(chceneId){ const f=z.features.find(x=>x.properties.id===chceneId);
    if(f){ ukaz(f.properties); if(f.properties.presnost==='presná') map.jumpTo({center:f.geometry.coordinates,zoom:16}); } }

  /* ?3d=1 zapne 3D budovy hneď po načítaní — nech sa dá poslať odkaz,
     ktorý ich rovno ukáže, bez hľadania v ponuke Vrstvy */
  if(new URLSearchParams(location.search).get('3d')==='1'){
    const c=$('#v-3d'); c.checked=true; c.dispatchEvent(new Event('change'));
  }

  map.on('click',e=>{ if(pridavam) formularBodu(e.lngLat); else if(presuvam) polozNavrh(e.lngLat); });
  map.on('click','bod',e=>{ if(!zaneprazdnene()) ukaz(e.features[0].properties); });
  map.on('click','nez',e=>{ if(!zaneprazdnene()) ukazNezname(e.features[0].properties.obec); });
  ['zh','bod','nez','kom','moj'].forEach(l=>{
    map.on('mouseenter',l,()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave',l,()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='';});
  });
}
/* Ikony kreslené na plátno — bez externých obrázkov. Bublina je
   naťahovací rámček (stretchX/Y), do ktorého MapLibre vloží text. */
function pridajIkony(){
  const px=2;                                   // pixelRatio pre ostré hrany
  const platno=(w,h,kresli)=>{ const c=document.createElement('canvas'); c.width=w*px; c.height=h*px;
    const g=c.getContext('2d'); g.scale(px,px); kresli(g); return g.getImageData(0,0,c.width,c.height); };
  if(!map.hasImage('bublina')) map.addImage('bublina', platno(28,28,g=>{
    g.fillStyle='#FFFFFF'; g.strokeStyle='#000000'; g.lineWidth=1.2;
    g.beginPath(); g.roundRect(1,1,26,26,4); g.fill(); g.stroke(); }),
    {pixelRatio:px, stretchX:[[8,20]], stretchY:[[8,20]], content:[6,6,22,22]});
  const stvorec=farba=>platno(24,24,g=>{
    g.fillStyle='#FFFFFF'; g.strokeStyle=farba; g.lineWidth=3;
    g.beginPath(); g.rect(3,3,18,18); g.fill(); g.stroke(); });
  if(!map.hasImage('stvorec-cerveny')) map.addImage('stvorec-cerveny', stvorec('#F3716D'), {pixelRatio:px});
  if(!map.hasImage('stvorec-cierny')) map.addImage('stvorec-cierny', stvorec('#000000'), {pixelRatio:px});
  /* čiarkovaný kruh pre „bez známej polohy“ — kreslí sa v 48 px, mierka podľa počtu */
  if(!map.hasImage('kruh-ciarkovany')) map.addImage('kruh-ciarkovany', platno(48,48,g=>{
    g.fillStyle='rgba(255,255,255,.55)'; g.strokeStyle='#8A8A86'; g.lineWidth=1.5; g.setLineDash([3,3]);
    g.beginPath(); g.arc(24,24,22,0,Math.PI*2); g.fill(); g.stroke(); }), {pixelRatio:px});
}

/* 'style.load' príde hneď po rozparsovaní štýlu, 'load' až keď dobehnú
   dlaždice podkladu. Geoportál býva pomalý a občas nedostupný, tak sa
   chytáme toho skoršieho — vrstvy sa dajú pridať aj bez dlaždíc. */
map.on('style.load',spusti);
map.on('load',spusti);
const hliadka=setInterval(()=>{
  if(spustene){ clearInterval(hliadka); return; }
  try{ if(map.getStyle()&&map.getStyle().layers.length){ clearInterval(hliadka); spusti(); } }
  catch(e){}
},700);

/* Zoznam kategórií podľa toho, čo je práve v hre — líniové typy len
   keď je ich vrstva zapnutá, inak by v paneli svietili s nulou. */
function zostavTypy(){
  const pc={};
  Z.features.forEach(f=>{ const p=f.properties; if(p.lin&&!ukazLiniove) return;
    const t=p.typ||'Iné'; pc[t]=(pc[t]||0)+1; });
  TYPY=Object.keys(pc).sort((a,b)=>pc[b]-pc[a]);
}
function ukazNezname(obec){
  const z=Z.features.filter(f=>f.properties.obec===obec
    && f.properties.presnost!=='presná' && vyhovuje(f.properties));
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">BEZ ZNÁMEJ POLOHY</span></div>'
    +'<h2>'+esc(obec)+'</h2>'
    +'<div class="miesto">'+z.length+' zámerov, pri ktorých register neuvádza ulicu</div>'
    +'<a class="odkaz" href="../redakcia/?mc='+encodeURIComponent(obec)+'">Doplniť polohy →</a>'
    +'<div class="dok">'+z.slice(0,60).map(f=>'<div class="r" data-id="'+esc(f.properties.id)+'">'
      +'<span class="mini prazdna">'+esc((f.properties.faza||'').slice(0,4))+'</span>'
      +'<span class="nm">'+esc(f.properties.nazov)+'</span></div>').join('')+'</div>';
  $('#detail').querySelectorAll('.dok .r').forEach(el=>el.onclick=()=>{
    const f=Z.features.find(x=>x.properties.id===el.dataset.id); if(f) ukaz(f.properties);});
}

/* ---------- čo je nové ----------
   Okno je 30 dní dozadu od dátumu posledného behu (stav.json), nie od
   dneška — nech sa zoznam nemení medzi behmi. Zámer je nový, keď sa mu
   v okne zmenil záznam v registri (`zmena`) alebo ho doplnila redakcia
   (`red_kedy`). Vyhlášky mimo EIA majú vlastný dátum z tabule. Fázy
   doložené vyhláškou dátum nemajú — tie sa tu neuvádzajú. */
const NOVE_DNI=30;
let NOVINKY={od:'',do:'',register:[],redakcia:[],mimo:[]}, TAB=null;
function oznacNovinky(z,tab,stav){
  TAB=tab||null;
  const doS=(stav&&stav.beh?stav.beh:new Date().toISOString()).slice(0,10);
  const od=new Date(doS+'T00:00:00Z'); od.setUTCDate(od.getUTCDate()-NOVE_DNI);
  const odS=od.toISOString().slice(0,10);
  NOVINKY={od:odS,do:doS,register:[],redakcia:[],mimo:[]};
  z.features.forEach(f=>{
    const p=f.properties, co=[];
    if((p.red_kedy||'').slice(0,10)>=odS){ co.push('redakcia'); NOVINKY.redakcia.push(p); }
    if(p.zdroj!=='redakcia' && (p.zmena||'').slice(0,10)>=odS){ co.push('register'); NOVINKY.register.push(p); }
    if(co.length){ p.nove=1; p.nove_co=co.join(','); }
  });
  if(tab&&tab.features)
    NOVINKY.mimo=tab.features.filter(f=>(f.properties.datum||'')>=odS).map(f=>f.properties);
}
const datumSk=d=>d?d.slice(8,10).replace(/^0/,'')+'. '+d.slice(5,7).replace(/^0/,'')+'.':'';
function kresliNovinky(){
  const el=$('#novinky'); if(!el) return;
  const reg=NOVINKY.register.filter(p=>vyhovuje(p)), red=NOVINKY.redakcia.filter(p=>vyhovuje(p));
  const r=(k,n,t)=>'<button class="r" data-n="'+k+'" '+(n?'':'disabled')+'><b>'+cis(n)+'</b>'+t+'</button>';
  el.innerHTML='<h4>ČO JE NOVÉ <span>od '+datumSk(NOVINKY.od)+' do '+datumSk(NOVINKY.do)+'</span></h4>'
    +'<div class="nov">'
    +r('register',reg.length,reg.length===1?'zmena v registri EIA':'zmeny v registri EIA')
    +r('redakcia',red.length,'doplnila redakcia')
    +r('mimo',NOVINKY.mimo.length,NOVINKY.mimo.length===1?'vyhláška úradu mimo EIA':'vyhlášky úradov mimo EIA')
    +'</div>'
    +'<button class="nov-mapa" id="nov-mapa" aria-pressed="'+filtr.nove+'">'
      +(filtr.nove?'Ukázať všetky zámery':'Len novinky na mape')+'</button>';
  el.querySelectorAll('.nov .r').forEach(b=>b.onclick=()=>ukazNovinky(b.dataset.n));
  $('#nov-mapa').onclick=()=>{ filtr.nove=!filtr.nove; obnov(); };
}
function ukazNovinky(druh){
  const zoz=druh==='register'?NOVINKY.register.filter(p=>vyhovuje(p))
    :druh==='redakcia'?NOVINKY.redakcia.filter(p=>vyhovuje(p)):NOVINKY.mimo;
  const nadpis={register:'Zmeny v registri EIA',redakcia:'Doplnila redakcia',mimo:'Vyhlášky úradov mimo EIA'}[druh];
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok" style="background:#F3716D">NOVÉ</span>'
      +'<span class="stitok b">'+datumSk(NOVINKY.od).toUpperCase()+' – '+datumSk(NOVINKY.do).toUpperCase()+'</span></div>'
    +'<h2>'+esc(nadpis)+'</h2>'
    +'<div class="miesto">'+zoz.length+' '+(druh==='mimo'?(zoz.length===1?'vyhláška':zoz.length<5?'vyhlášky':'vyhlášok'):sklon(zoz.length))+'</div>'
    +'<div class="dok">'+zoz.slice().sort((a,b)=>((b.zmena||b.datum||b.red_kedy||'')).localeCompare(a.zmena||a.datum||a.red_kedy||''))
      .map((p,i)=>'<div class="r" data-i="'+i+'">'
        +(p.nahlad?'<img class="mini" src="'+esc(p.nahlad)+'" alt="" loading="lazy">'
                  :'<span class="mini prazdna">'+esc((p.faza||p.druh||'').slice(0,4))+'</span>')
        +'<span class="nm">'+esc(p.nazov_obch||p.nazov||p.n||'')+'<em>'+esc(p.obec||p.mc||'')
          +(druh==='register'?' · '+esc(p.faza||''):'')+'</em></span>'
        +'<span class="vel">'+esc(datumSk((p.zmena||p.datum||p.red_kedy||'').slice(0,10)))+'</span></div>').join('')
    +'</div>'
    +(druh==='mimo'?'<p class="pozn">Povolené stavby pod prahom EIA z úradných tabúľ mestských častí. '
      +'Na mape sú vo vrstve „Vyhlášky stavebných úradov“.</p>':'');
  const zor=zoz.slice().sort((a,b)=>((b.zmena||b.datum||b.red_kedy||'')).localeCompare(a.zmena||a.datum||a.red_kedy||''));
  $('#detail').querySelectorAll('.dok .r').forEach(r=>r.onclick=()=>{
    const p=zor[+r.dataset.i];
    if(druh==='mimo'){
      const c=$('#v-tabule'); if(!c.checked){ c.checked=true; c.dispatchEvent(new Event('change')); }
      ukazTabulu(p);
      const f=TAB&&TAB.features.find(x=>x.properties.id===p.id);
      if(f) map.easeTo({center:f.geometry.coordinates,zoom:Math.max(map.getZoom(),15.5)});
    } else { ukaz(p); if(p.presnost==='presná') naMape(p.id); }
  });
}

/* ---------- zhluky s prstencom fáz ----------
   Štýl MapLibre nevie nakresliť výseč, tak je každý zhluk HTML značka:
   čierna bublina s číslom a okolo tenký prstenec rozdelený podľa fáz
   (pomer zámerov, posúdených, povolených, dokončených). Pri farbení podľa
   účelu je prstenec prázdny, aby netvrdil niečo iné než legenda. */
const DONUTY={};
function zahodDonuty(){ for(const k in DONUTY){ DONUTY[k].marker.remove(); delete DONUTY[k]; } }
function kresliDonuty(){
  const vidno={};
  if(zobrazenie==='body'){
    let fs=[]; try{ fs=map.querySourceFeatures('zamery',{filter:['has','point_count']}); }catch(e){}
    for(const f of fs){
      const p=f.properties, id=p.cluster_id; if(vidno[id]) continue;
      const kluc=[p.point_count,p.f1,p.f2,p.f3,p.f4,farbitPodla].join('|');
      let d=DONUTY[id];
      if(!d||d.kluc!==kluc){
        if(d) d.marker.remove();
        const el=donutEl(p);
        el.onclick=ev=>{ ev.stopPropagation(); if(zaneprazdnene()) return;
          map.getSource('zamery').getClusterExpansionZoom(id)
            .then(zz=>map.easeTo({center:f.geometry.coordinates,zoom:zz+.4})); };
        d={kluc:kluc,marker:new maplibregl.Marker({element:el}).setLngLat(f.geometry.coordinates)};
        DONUTY[id]=d;
      }
      if(!d.naMape){ d.marker.addTo(map); d.naMape=true; }
      vidno[id]=1;
    }
  }
  for(const id in DONUTY){ if(!vidno[id]&&DONUTY[id].naMape){ DONUTY[id].marker.remove(); DONUTY[id].naMape=false; } }
}
function donutEl(p){
  const n=p.point_count, r=n<5?10:n<10?13:n<20?16:n<50?20:25;
  const R=r+4.4, S=2*(r+7), c=S/2, sirka=3.2;
  const casti=farbitPodla==='faza'?[['zámer',p.f1],['posúdené',p.f2],['povolené',p.f3],['dokončené',p.f4]]:[];
  const spolu=casti.reduce((s,x)=>s+(+x[1]||0),0);
  let a=-Math.PI/2, vysece='';
  const bod=(ang)=>[c+R*Math.cos(ang),c+R*Math.sin(ang)];
  casti.forEach(([f,k])=>{ k=+k||0; if(!k||!spolu) return;
    const podiel=k/spolu;
    if(podiel>=.999){ vysece+='<circle cx="'+c+'" cy="'+c+'" r="'+R+'" fill="none" stroke="'+FARBA[f]+'" stroke-width="'+sirka+'"/>'; return; }
    const b=a+2*Math.PI*podiel, [x0,y0]=bod(a), [x1,y1]=bod(b);
    vysece+='<path d="M'+x0.toFixed(2)+' '+y0.toFixed(2)+' A'+R+' '+R+' 0 '+(podiel>.5?1:0)+' 1 '
      +x1.toFixed(2)+' '+y1.toFixed(2)+'" fill="none" stroke="'+FARBA[f]+'" stroke-width="'+sirka+'"/>';
    a=b; });
  const el=document.createElement('div'); el.className='donut';
  el.innerHTML='<svg width="'+S+'" height="'+S+'" viewBox="0 0 '+S+' '+S+'">'
    +'<circle cx="'+c+'" cy="'+c+'" r="'+R+'" fill="none" stroke="#D9D9D6" stroke-width="'+sirka+'"/>'
    +vysece
    /* dve vlasové linky ohraničia prstenec — inak by biela výseč „povolené" splynula s pozadím */
    +'<circle cx="'+c+'" cy="'+c+'" r="'+(R-sirka/2-.4)+'" fill="none" stroke="#000" stroke-width=".8"/>'
    +'<circle cx="'+c+'" cy="'+c+'" r="'+(R+sirka/2+.4)+'" fill="none" stroke="#000" stroke-width=".8"/>'
    +'<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="#000"/>'
    +'<text x="'+c+'" y="'+c+'" text-anchor="middle" dominant-baseline="central" font-size="'+(n<10?10.5:n<50?12:13.5)+'">'
      +(n>=1000?(n/1000).toFixed(1)+'k':n)+'</text></svg>';
  el.title=n+' '+sklon(n)+(spolu?' · '+casti.filter(x=>+x[1]).map(x=>x[0]+' '+x[1]).join(', '):'');
  return el;
}

/* ---------- body alebo teplotná mapa ---------- */
function nastavZobrazenie(v){
  zobrazenie=v;
  const body=v==='body';
  ['bod','bod-nove'].forEach(l=>map.getLayer(l)&&map.setLayoutProperty(l,'visibility',body?'visible':'none'));
  if(map.getLayer('bod-txt')) map.setLayoutProperty('bod-txt','visibility',body&&$('#v-nazvy').checked?'visible':'none');
  if(map.getLayer('nez')) map.setLayoutProperty('nez','visibility',body?'visible':'none');
  if(map.getLayer('teplo')) map.setLayoutProperty('teplo','visibility',body?'none':'visible');
  kresliDonuty(); kresliLegendu();
}

/* ---------- hľadanie v prirodzenom jazyku ----------
   „byty v Petržalke povolené od 2024" → účel Bývanie, MČ Petržalka, fáza
   povolené, zmena v registri od 2024; zvyšok slov ide do textového
   hľadania. Skloňovanie rieši hrubý kmeň bez diakritiky — na názvy
   mestských častí a pár slov to stačí, model tu netreba. */
const bezDiak=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const kmen=s=>{ s=bezDiak(s).replace(/^vsi$/,'ves');
  return s.length>4?s.replace(/(iach|ych|ymi|ych|ach|och|eho|ej|ou|om|im|ich|e|a|y|u|i|o)$/,''):s; };
const NL_TYPY=[[/^(byt|byvan|bytov|obytn|rezident|dom)/,'Bývanie'],[/^(kancel|administrat|office|biznis|business)/,'Administratíva'],
  [/^polyfunk/,'Polyfunkcia'],[/^(sklad|vyrob|hal|logist|priemys|fabrik|zavod)/,'Výroba a sklady'],
  [/^(obchod|sluzb|retail|nakup|predajn)/,'Obchod a služby'],[/^(skol|skolk|nemocnic|vybaven|sport|kultur|zdravot)/,'Vybavenosť'],
  [/^(zelen|park|namest|verejn)/,'Zeleň a verejný priestor'],[/^(cest|dialnic|doprav|krizovat|most|zeleznic)/,'Doprava'],
  [/^(kanaliz|vodovod|energet|technick|infrastrukt|plyn)/,'Technická infraštruktúra']];
const NL_FAZY=[[/^(zamer|navrh|pripravovan|planovan)/,'zámer'],[/^(posuden|posudzovan|hodnoten)/,'posúdené'],
  [/^(povolen|schvalen|stavebn)/,'povolené'],[/^(dokoncen|hotov|skolaudovan|postaven)/,'dokončené']];
const NL_STOP=new Set(['v','vo','na','od','do','po','a','s','so','z','zo','len','iba','vsetky','vsetko','zamery','zamer',
  'projekty','projekt','stavby','stavba','roku','rok','rokov','ktore','co','ktory','mc','casti','cast','mestskej','mestska']);
function rozumiem(text){
  const n=prazdneNl(), zvysok=[];
  const slova=text.split(/\s+/).filter(Boolean);
  const mcs=[...new Set((Z?Z.features:[]).map(f=>f.properties.obec).filter(Boolean))]
    .map(o=>({obec:o,kmene:o.replace(/^Bratislava\s*[-–]\s*/,'').split(/\s+/).map(kmen)}));
  for(let i=0;i<slova.length;i++){
    const s=slova[i], sk=kmen(s), bd=bezDiak(s);
    if(/^(20\d\d)$/.test(bd)){ n.od=bd; continue; }
    if(bd==='tento' && bezDiak(slova[i+1]||'')==='rok'){ n.od=String(new Date().getFullYear()); i++; continue; }
    /* mestská časť môže mať dve-tri slová */
    const mc=mcs.find(m=>m.kmene.every((k,j)=>slova[i+j]&&kmen(slova[i+j])===k&&k.length>=3));
    if(mc){ n.mc=mc.obec; i+=mc.kmene.length-1; continue; }
    const t=NL_TYPY.find(([re])=>re.test(bd)); if(t){ n.typ.add(t[1]); continue; }
    const f=NL_FAZY.find(([re])=>re.test(bd)); if(f){ n.faza.add(f[1]); continue; }
    if(/^(vykres|plan|situac)/.test(bd)){ n.pl='1'; continue; }
    if(/^(obrazk|obrazok|vizualiz|foto|render)/.test(bd)){ n.pl='2'; continue; }
    if(/^presn/.test(bd) && /^poloh/.test(bezDiak(slova[i+1]||''))){ n.pl='3'; i++; continue; }
    if(NL_STOP.has(bd)) continue;
    zvysok.push(s);
  }
  n.typ.forEach(t=>{ if(!TYPY.includes(t)) n.typ.delete(t); });
  return {nl:n, zvysok:zvysok.join(' ').toLowerCase()};
}
function kresliRozumiem(){
  const el=$('#rozumiem'); if(!el) return;
  const k=[...nl.typ,...nl.faza];
  if(nl.mc) k.push(nl.mc.replace(/^Bratislava\s*[-–]\s*/,''));
  if(nl.pl) k.push({'1':'s výkresmi','2':'s obrázkami','3':'s presnou polohou'}[nl.pl]);
  if(nl.od) k.push('od '+nl.od);
  el.hidden=!k.length;
  el.innerHTML=k.length?'<span>Rozumiem:</span>'+k.map(x=>'<i>'+esc(x)+'</i>').join('')
    +(filtr.q?'<i class="txt">„'+esc(filtr.q)+'“</i>':'')
    +'<button id="doslovne">hľadať doslovne</button>':'';
  const b=$('#doslovne'); if(b) b.onclick=()=>{ doslovne=true; hladaj(); };
}
function hladaj(){
  const t=$('#q').value.trim();
  if(doslovne||!t){ nl=prazdneNl(); filtr.q=t.toLowerCase(); }
  else { const r=rozumiem(t); nl=r.nl; filtr.q=r.zvysok; }
  kresliRozumiem(); obnov();
  /* hľadanie platí aj pre staveniská z OSM a vyhlášky */
  const fq=filtr.q?['in',filtr.q,['downcase',['get','n']]]:null;
  ['osm-b','osm-txt','tab-b','tab-txt'].forEach(l=>{ if(map.getLayer(l)) map.setFilter(l,fq); });
}

/* ---------- postup redakcie ----------
   Hotový zámer = presná poloha aj obrázok. Číslo hovorí, koľko práce
   ostáva — nezávisí od filtrov. */
function kresliPostup(){
  const el=$('#postup'); if(!el||!Z) return;
  const st=Z.features.map(f=>f.properties).filter(p=>!p.lin);
  const maObr=p=>(p.nahlady&&p.nahlady.length)||(p.obrazky&&p.obrazky.length);
  const hot=st.filter(p=>p.presnost==='presná'&&maObr(p)).length;
  const bezPol=st.filter(p=>p.presnost!=='presná').length, bezObr=st.filter(p=>!maObr(p)).length;
  const red=st.filter(p=>p.redakcia).length, pc=Math.round(100*hot/st.length);
  el.innerHTML='<div class="hl"><span class="st">POSTUP DOPĹŇANIA</span><b>'+cis(hot)+' z '+cis(st.length)+'</b></div>'
    +'<div class="pas" title="hotový zámer má presnú polohu aj obrázok"><i style="width:'+pc+'%"></i></div>'
    +'<p>'+pc+' % má polohu aj obrázok · ostáva '+cis(bezPol)+' bez polohy a '+cis(bezObr)+' bez obrázka'
    +(red?' · redakcia doplnila '+cis(red):'')+' <a href="../redakcia/">doplniť →</a></p>';
}

/* ---------- ovládanie ---------- */
$('#q').addEventListener('input',()=>{ doslovne=false; hladaj(); });
$('#tl-hladaj').onclick=()=>$('#q').focus();
$('#kategorie').addEventListener('click',e=>{
  const r=e.target.closest('.r'); if(!r) return;
  filtr.typ.has(r.dataset.t)?filtr.typ.delete(r.dataset.t):filtr.typ.add(r.dataset.t); obnov();});
$('#vsetky-kat').onclick=()=>{vsetkyTypy=!vsetkyTypy; kresliKategorie();};
$('#legenda').addEventListener('click',e=>{
  const r=e.target.closest('.r[data-v]'); if(!r) return;
  const s=filtr[r.dataset.d], v=r.dataset.v;
  s.has(v)?s.delete(v):s.add(v); obnov();});
document.getElementsByName('farby').forEach(i=>i.onchange=()=>{
  farbitPodla=i.value; prefarbi(); kresliKategorie(); zahodDonuty(); kresliDonuty();});
$('#aktivne').addEventListener('click',e=>{
  const b=e.target.closest('b'); if(!b) return;
  const d=b.dataset.d, v=b.dataset.v;
  if(d==='typ') filtr.typ.delete(v); else if(d==='faza') filtr.faza.delete(v);
  else if(d==='nove') filtr.nove=false;
  else { filtr[d]=''; const s=$('#f-'+d); if(s) s.value=''; }
  obnov();});

$('#f-fazy').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  filtr.faza.has(b.dataset.f)?filtr.faza.delete(b.dataset.f):filtr.faza.add(b.dataset.f); obnov();});
['mc','sk','pl'].forEach(k=>$('#f-'+k).addEventListener('input',e=>{filtr[k]=e.target.value; obnov();}));
$('#vymaz').onclick=()=>{
  filtr={q:filtr.q,mc:'',sk:'',pl:'',typ:new Set(),faza:new Set(),nove:false};
  $('#f-mc').value=''; $('#f-sk').value=''; $('#f-pl').value=''; obnov();};
document.getElementsByName('zobraz').forEach(i=>i.onchange=()=>nastavZobrazenie(i.value));

$('#tl-vrstvy').onclick=e=>{e.stopPropagation(); $('#pop-vrstvy').classList.toggle('on');};
document.addEventListener('click',e=>{
  if(!e.target.closest('#pop-vrstvy')&&!e.target.closest('#tl-vrstvy'))
    $('#pop-vrstvy').classList.remove('on');});
document.querySelectorAll('input[name=pod]').forEach(r=>r.onchange=()=>{
  const v=r.value, mapa=v==='mapa'||v==='tlmena';
  if(map.getLayer('orto')) map.setLayoutProperty('orto','visibility',v==='orto'?'visible':'none');
  PODKLAD.forEach(l=>map.getLayer(l)&&map.setLayoutProperty(l,'visibility',mapa?'visible':'none'));
  if(mapa) nastavPaletu(v==='tlmena'?'tlmena':'farebna');
  else if(map.getLayer('pozadie')) map.setPaintProperty('pozadie','background-color',v==='orto'?'#000000':'#EDEDEA');});
/* pamätaná voľba podkladu */
(()=>{ const r=document.querySelector('input[name=pod][value='+(paleta==='tlmena'?'tlmena':'mapa')+']'); if(r) r.checked=true; })();
const prep=(id,...vrstvy)=>$('#'+id).onchange=e=>vrstvy.forEach(v=>{
  if(map.getLayer(v)) map.setLayoutProperty(v,'visibility',e.target.checked?'visible':'none');});
prep('v-ulice','ulice-txt'); prep('v-hranice','hranice-c'); prep('v-mc','mc-txt');
$('#v-nazvy').onchange=e=>{ if(map.getLayer('bod-txt'))
  map.setLayoutProperty('bod-txt','visibility',e.target.checked&&zobrazenie==='body'?'visible':'none'); };

/* ---------- linky MHD ----------
   Sluzba doprava/Linky_MHD na geoportali ma vrchol kazdych 50 az 150 m
   a 36 zo 154 liniek nema geometriu vobec — zblizka z nej vychadzali
   rovne skratky cez bloky. Trasy su teraz z OpenStreetMap, teda z toho
   isteho zdroja ako ulice v podklade, takze sadnu na cestu presne. */
let mhdStav='ne';
$('#v-mhd').onchange=async e=>{
  $('#legenda-mhd').hidden=!e.target.checked;
  if(!e.target.checked){
    if(map.getLayer('mhd-v')) map.setLayoutProperty('mhd-v','visibility','none');
    return;
  }
  if(mhdStav==='hotove'){
    map.setLayoutProperty('mhd-v','visibility','visible'); return;
  }
  if(mhdStav==='chyba'){ e.target.checked=false; return; }
  $('#stav-mhd').textContent='(sťahujem…)';
  let g;
  try{ g=await (await fetch('mhd.geojson',{cache:'force-cache'})).json(); }
  catch(err){
    mhdStav='chyba'; e.target.checked=false; $('#legenda-mhd').hidden=true;
    $('#stav-mhd').textContent='(nedá sa načítať)'; return;
  }
  map.addSource('mhd',{type:'geojson',data:g});
  map.addLayer({id:'mhd-v',type:'line',source:'mhd',
    layout:{'line-cap':'round','line-join':'round',
      'line-sort-key':['get','r']},          // električka nakoniec, nech je vrchu
    paint:{
      'line-color':['match',['get','r'],3,'#000000',2,'#F3716D','#A5A5A1'],
      'line-opacity':['match',['get','r'],3,.9,2,.85,.6],
      'line-width':['interpolate',['linear'],['zoom'],
        10,['match',['get','r'],3,1.6,2,1.1,.6],
        14,['match',['get','r'],3,3,2,2.2,1.2],
        18,['match',['get','r'],3,7,2,5,2.6]]},
  }, map.getLayer('ulice-txt')?'ulice-txt':undefined);
  mhdStav='hotove';
  $('#stav-mhd').textContent='('+cis(g.features.length)+')';
};

/* ---------- 3D budovy ----------
   91 539 budov celej Bratislavy sa v jednom súbore stiahnuť nedá, tak
   sú rozsekané do mriežky asi 1,5 × 1,7 km. Mapa si ťahá len dlaždice,
   na ktoré sa práve pozeráš, a raz stiahnuté si drží. */
const BUD_ZOOM=13.5;
let budovy3d='nenacitane';
const BUD={index:null, su:new Set(), mam:new Map(), bezi:false};
/* plochý pôdorys budov z podkladu by sa s 3D telesami zdvojoval */
const ploche=v=>{ if(map.getLayer('v-budovy'))
  map.setLayoutProperty('v-budovy','visibility',v?'visible':'none'); };

$('#v-3d').onchange=async e=>{
  $('#legenda-3d').hidden=!e.target.checked;
  if(!e.target.checked){
    if(map.getLayer('bud3d')) map.setLayoutProperty('bud3d','visibility','none');
    ploche(true); $('#stav-3d').textContent=''; return;
  }
  if(budovy3d==='chyba'){ e.target.checked=false; $('#legenda-3d').hidden=true; return; }
  if(budovy3d==='hotove'){
    map.setLayoutProperty('bud3d','visibility','visible'); ploche(false);
    if(map.getPitch()<20) map.easeTo({pitch:55});
    dotiahniBudovy(); return;
  }
  $('#stav-3d').textContent='(pripravujem…)';
  try{
    BUD.index=await (await fetch('budovy/index.json',{cache:'no-cache'})).json();
  }catch(err){
    budovy3d='chyba'; e.target.checked=false; $('#legenda-3d').hidden=true;
    $('#stav-3d').textContent='(nedá sa načítať)';
    hlaska('3D budovy sa nepodarilo načítať: '+(err.message||err)); return;
  }
  BUD.index.bunky.forEach(([x,y])=>BUD.su.add(x+'_'+y));
  map.addSource('bud3d',{type:'geojson',
    data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'bud3d',type:'fill-extrusion',source:'bud3d',minzoom:13,
    paint:{
      /* farba podľa výšky — bežná zástavba splýva s podkladom,
         výškové budovy vystúpia; ide o to, aby bolo vidieť, čo prečnieva */
      'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','v'],9],
        3,'#E4E4E0', 12,'#D9D9D6', 25,'#A5A5A1', 45,'#55555A', 70,'#F3716D'],
      'fill-extrusion-height':['coalesce',['get','v'],9],
      'fill-extrusion-base':0,
      'fill-extrusion-opacity':.94},
  }, map.getLayer('ulice-txt')?'ulice-txt':undefined);
  /* mäkšie svetlo, nech telesá nesvietia nad tmavým podkladom */
  map.setLight({anchor:'viewport',color:'#ffffff',intensity:.45,position:[1.4,205,32]});
  budovy3d='hotove'; ploche(false);
  if(map.getPitch()<20) map.easeTo({pitch:55});
  dotiahniBudovy();
};

async function dotiahniBudovy(){
  if(budovy3d!=='hotove' || !$('#v-3d').checked || BUD.bezi) return;
  if(map.getZoom()<BUD_ZOOM){
    /* nič nesťahujeme, ale keď už niečo máme, nech svieti počet a nie výzva */
    if(BUD.mam.size) ukazPocet();
    else $('#stav-3d').textContent='(priblíž si mapu)';
    return;
  }
  const i=BUD.index, b=map.getBounds();
  const chcem=[];
  for(let x=Math.floor(b.getWest()/i.krokX); x<=Math.floor(b.getEast()/i.krokX); x++)
    for(let y=Math.floor(b.getSouth()/i.krokY); y<=Math.floor(b.getNorth()/i.krokY); y++){
      const k=x+'_'+y;
      if(BUD.su.has(k) && !BUD.mam.has(k)) chcem.push(k);
    }
  if(!chcem.length){ ukazPocet(); return; }
  BUD.bezi=true;
  $('#stav-3d').textContent='(sťahujem '+chcem.length+'…)';
  await Promise.all(chcem.map(async k=>{
    try{
      const g=await (await fetch('budovy/'+k+'.json',{cache:'force-cache'})).json();
      BUD.mam.set(k, g.features);
    }catch(err){ BUD.mam.set(k, []); }
  }));
  const vsetko=[];
  BUD.mam.forEach(f=>{ for(const x of f) vsetko.push(x); });
  map.getSource('bud3d').setData({type:'FeatureCollection',features:vsetko});
  BUD.bezi=false;
  ukazPocet();
}
function ukazPocet(){
  let n=0; BUD.mam.forEach(f=>n+=f.length);
  $('#stav-3d').textContent=n?'('+cis(n)+')':'';
}
map.on('moveend',dotiahniBudovy);
prep('v-komunita','kom','kom-txt','moj','moj-txt');
prep('v-osm','osm-b','osm-txt');
$('#v-osm').addEventListener('change',e=>{ $('#legenda-osm').hidden=!e.target.checked; });
prep('v-tabule','tab-b','tab-txt');
$('#v-tabule').addEventListener('change',e=>{ $('#legenda-tabule').hidden=!e.target.checked; });

/* ---------- líniové stavby (doprava, technická infraštruktúra) ---------- */
$('#v-liniove').onchange=e=>{
  ukazLiniove=e.target.checked;
  $('#legenda-lin').hidden=!ukazLiniove;
  zostavTypy(); prefarbi(); obnov();
};

/* ---------- pomocné: bod v polygóne ----------
   Stačí lúčový test — polygónov je pár tisíc a pýtame sa raz za kliknutie. */
function vKruhu(pt,ring){
  let dnu=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>pt[1])!==(yj>pt[1]) && pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi) dnu=!dnu;
  }
  return dnu;
}
function vPolygone(pt,g){
  const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  return polys.some(rings=>vKruhu(pt,rings[0]) && !rings.slice(1).some(r=>vKruhu(pt,r)));
}
const vBode=(fc,pt)=>{ const f=fc.features.find(f=>vPolygone(pt,f.geometry)); return f?f.properties:null; };
/* klik do plochy pod bodom má otvoriť bod, nie plochu */
const nadBodom=e=>map.queryRenderedFeatures(e.point,{layers:['bod','zh','nez','kom','moj','osm-b','tab-b'].filter(l=>map.getLayer(l))}).length>0;

/* ---------- výšková regulácia ----------
   Územná štúdia výškového zónovania — 3 829 plôch v piatich hladinách
   (11, 16, 21, 30, 46 m). Statická kópia z geoportálu, vrstva
   Hosted/Výšková_regulácia, stiahnutá 7. 9. 2026. */
let VYSKA=null, vyskaSlub=null;
function nacitajVysku(){
  if(!vyskaSlub) vyskaSlub=fetch('vyska.geojson',{cache:'force-cache'}).then(r=>r.json())
    .then(g=>{VYSKA=g; return g;}).catch(e=>{vyskaSlub=null; throw e;});
  return vyskaSlub;
}
const FARBA_VYSKY=['match',['get','v'],1,'#D9D9D6',2,'#B4B4B0',3,'#8A8A86',4,'#F3B0AE',5,'#F3716D','#8A8A86'];
$('#v-vyska').onchange=async e=>{
  $('#legenda-vyska').hidden=!e.target.checked;
  if(!e.target.checked){ ['vyska-f','vyska-l'].forEach(l=>map.getLayer(l)&&map.setLayoutProperty(l,'visibility','none')); return; }
  if(map.getLayer('vyska-f')){ ['vyska-f','vyska-l'].forEach(l=>map.setLayoutProperty(l,'visibility','visible')); return; }
  $('#stav-vyska').textContent='(sťahujem…)';
  let g;
  try{ g=await nacitajVysku(); }
  catch(err){ e.target.checked=false; $('#legenda-vyska').hidden=true; $('#stav-vyska').textContent='(nedá sa načítať)'; return; }
  map.addSource('vyska',{type:'geojson',data:g});
  const pod=map.getLayer('zh')?'zh':undefined;
  map.addLayer({id:'vyska-f',type:'fill',source:'vyska',
    paint:{'fill-color':FARBA_VYSKY,'fill-opacity':.45}}, pod);
  map.addLayer({id:'vyska-l',type:'line',source:'vyska',minzoom:12,
    paint:{'line-color':'#000000','line-opacity':.25,'line-width':.6}}, pod);
  $('#stav-vyska').textContent='('+cis(g.features.length)+')';
  map.on('click','vyska-f',ev=>{
    if(zaneprazdnene()||nadBodom(ev)) return;
    if(map.getLayer('upn-f') && map.queryRenderedFeatures(ev.point,{layers:['upn-f']}).length) return;
    const p=ev.features[0].properties;
    new maplibregl.Popup({closeButton:false,maxWidth:'280px'}).setLngLat(ev.lngLat)
      .setHTML('<b>do '+(VYSKY[p.v]||'?')+' m</b> · '+esc(p.f||'')
        +(p.i?'<br><span style="opacity:.75">'+esc(p.i)+'</span>':'')
        +(p.r?'<br><span style="opacity:.75">'+esc(p.r)+'</span>':'')).addTo(map);
  });
  map.on('mouseenter','vyska-f',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','vyska-f',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='';});
};
/* Do karty zámeru s presnou polohou doplní, aká výška je na tom mieste
   povolená. Vrstva sa stiahne až pri prvom takom zámere. */
async function doplnVysku(p){
  if(p.presnost!=='presná') return;
  const f=Z.features.find(x=>x.properties.id===p.id); if(!f) return;
  let g; try{ g=await nacitajVysku(); }catch(e){ return; }
  const r=$('#r-vyska'); if(!r) return;          // karta sa medzitým zavrela
  const v=vBode(g,f.geometry.coordinates); if(!v) return;
  r.hidden=false;
  r.querySelector('.v').innerHTML='do <b>'+(VYSKY[v.v]||'?')+' m</b> · '+esc(v.f||'')
    +(v.i?' <span style="color:var(--tx3)">· '+esc(v.i)+'</span>':'');
}

/* ---------- žiadosti o zmenu územného plánu ----------
   Vrstva up/Zamery_2022_verejne z geoportálu — 89 žiadostí o zmeny
   a doplnky ÚPN s navrhovanou funkciou a výškou. Nie je to register
   výstavby, ale hovorí, kde sa niečo chystá skôr, než to príde do EIA. */
const KOD_FUNKCIE={101:'viacpodlažná zástavba obytného územia',102:'málopodlažná zástavba obytného územia',
  201:'občianska vybavenosť celomestského a nadmestského významu',202:'občianska vybavenosť lokálneho významu',
  301:'priemyselná výroba',302:'distribučné centrá, sklady, stavebníctvo',
  501:'zmiešané územia bývania a občianskej vybavenosti',502:'zmiešané územia obchodu a služieb'};
const funkcia=k=>{ if(!k) return ''; const c=String(k).split(/[,\s]+/).filter(Boolean);
  return c.map(x=>(KOD_FUNKCIE[x]?x+' · '+KOD_FUNKCIE[x]:x)).join('; '); };
$('#v-upn').onchange=async e=>{
  if(!e.target.checked){ ['upn-f','upn-l'].forEach(l=>map.getLayer(l)&&map.setLayoutProperty(l,'visibility','none')); return; }
  if(map.getLayer('upn-f')){ ['upn-f','upn-l'].forEach(l=>map.setLayoutProperty(l,'visibility','visible')); return; }
  $('#stav-upn').textContent='(sťahujem…)';
  let g;
  try{ g=await (await fetch('upn-ziadosti.geojson',{cache:'force-cache'})).json(); }
  catch(err){ e.target.checked=false; $('#stav-upn').textContent='(nedá sa načítať)'; return; }
  map.addSource('upn',{type:'geojson',data:g});
  const pod=map.getLayer('zh')?'zh':undefined;
  map.addLayer({id:'upn-f',type:'fill',source:'upn',paint:{'fill-color':'#F3716D','fill-opacity':.22}}, pod);
  map.addLayer({id:'upn-l',type:'line',source:'upn',
    paint:{'line-color':'#000000','line-width':1.4,'line-dasharray':[2,1.5]}}, pod);
  $('#stav-upn').textContent='('+g.features.length+')';
  map.on('click','upn-f',ev=>{ if(!pridavam && !nadBodom(ev)) ukazUpn(ev.features[0].properties); });
  map.on('mouseenter','upn-f',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','upn-f',()=>{ if(!zaneprazdnene()) map.getCanvas().style.cursor='';});
};
function ukazUpn(p){
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">ŽIADOSŤ O ZMENU ÚZEMNÉHO PLÁNU</span></div>'
    +'<h2>Žiadosť č. '+esc(p.c)+'</h2>'
    +'<div class="miesto">◉ '+esc(p.mc||'')+(p.vym?' · '+(p.vym/10000).toFixed(1)+' ha':'')+'</div>'
    +'<div class="udaje">'
      +riadok('Platný ÚPN', funkcia(p.fp)?esc(funkcia(p.fp))+(p.kp?' · kód '+esc(p.kp):''):null)
      +riadok('Navrhovaná zmena', (funkcia(p.fn)||p.kn)?esc(funkcia(p.fn)||'')+(p.kn?(funkcia(p.fn)?' · ':'')+'kód '+esc(p.kn):''):null)
      +riadok('Výšková zonácia', p.vys?esc(p.vys):null)
      +riadok('Brownfield', p.bf?esc(p.bf):null)
      +riadok('ÚPN zóny', p.upnz?esc(p.upnz):null)
    +'</div>'
    +(p.u?'<p class="st">URBANISTICKÉ POŽIADAVKY</p><p class="text">'+esc(p.u).replace(/\n/g,'<br>')+'</p>':'')
    +(p.d?'<p class="st">DOPRAVNÉ POŽIADAVKY</p><p class="text">'+esc(p.d).replace(/\n/g,'<br>')+'</p>':'')
    +'<p class="pozn">Zdroj: geoportál Bratislavy, vrstva <i>Zámery 2022 verejné</i> — žiadosti o zmeny '
    +'a doplnky územného plánu. Nie je to stavebné konanie ani povolenie.</p>';
}

$('#tl-plus').onclick=()=>map.zoomIn();
$('#tl-minus').onclick=()=>map.zoomOut();
$('#tl-domov').onclick=()=>map.easeTo({...DOMOV,bearing:0,pitch:0});
$('#tl-kompas').onclick=()=>map.easeTo({bearing:0,pitch:0});
$('#tl-pridat').onclick=()=>pridavam?zrusPridavanie():zacniPridavanie();
$('#navod-zrus').onclick=()=>{zrusPridavanie(); zrusPresun(); zavriDetail();};

/* ---------- šírka panelov ----------
   Ukladá sa, aby si ju nemusel nastavovať pri každom otvorení.
   `smer` je +1, keď ťahadlo sedí na pravej hrane panela (bočný panel),
   a -1, keď na ľavej (karta detailu sa rozťahuje doľava). */
function tahadloSirky({tahadlo, sirku, daj, kluc, zakl, min, max, smer}){
  const t=$(tahadlo);
  const nastav=w=>sirku(Math.round(Math.max(min, Math.min(max, w))));
  const zapamataj=()=>{try{localStorage.setItem(kluc, daj());}catch(e){}};
  let bolo=0; try{ bolo=+localStorage.getItem(kluc)||0; }catch(e){}
  if(bolo>=min&&bolo<=max) nastav(bolo);

  /* pohyb a pustenie počúvame na okne, nie na ťahadle — kurzor pri
     rýchlom ťahaní z neho ujde a zachytávanie ukazovateľa nemusí vyjsť */
  let tiaham=false, od=0, zaciatok=0;
  t.addEventListener('pointerdown',e=>{
    tiaham=true; od=e.clientX; zaciatok=daj();
    t.classList.add('ide'); document.body.classList.add('tiaham');
    try{ t.setPointerCapture(e.pointerId); }catch(err){}
    e.preventDefault();
  });
  window.addEventListener('pointermove',e=>{
    if(tiaham) nastav(zaciatok + smer*(e.clientX - od));
  });
  const koniec=()=>{
    if(!tiaham) return;
    tiaham=false;
    t.classList.remove('ide'); document.body.classList.remove('tiaham'); zapamataj();
  };
  window.addEventListener('pointerup',koniec);
  window.addEventListener('pointercancel',koniec);
  t.addEventListener('dblclick',()=>{nastav(zakl); zapamataj();});
}
tahadloSirky({
  tahadlo:'#tahadlo-d', kluc:'mib-sirka-detailu', zakl:448, min:360, max:820, smer:-1,
  sirku:w=>document.documentElement.style.setProperty('--detail-w',w+'px'),
  daj:()=>$('#detail').offsetWidth});

/* ---------- otáčanie a naklonenie ----------
   Pravý klik teraz patrí ponuke, tak sa rotácia presunula na stlačené
   koliesko a na Shift + ťahanie. */
map.dragRotate.disable();
(function(){
  const c=map.getCanvasContainer();
  let otacam=false, px=0, py=0;
  c.addEventListener('mousedown',e=>{
    if(e.button!==1 && !(e.button===0 && e.shiftKey)) return;
    otacam=true; px=e.clientX; py=e.clientY;
    map.dragPan.disable(); document.body.classList.add('tiaham');
    e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!otacam) return;
    map.setBearing(map.getBearing() - (e.clientX-px)*0.42);
    map.setPitch(Math.max(0, Math.min(72, map.getPitch() - (e.clientY-py)*0.36)));
    px=e.clientX; py=e.clientY;
  });
  window.addEventListener('mouseup',()=>{
    if(!otacam) return;
    otacam=false; map.dragPan.enable(); document.body.classList.remove('tiaham');
  });
  // koliesko myši inak v Chrome spustí automatické rolovanie
  c.addEventListener('auxclick',e=>{ if(e.button===1) e.preventDefault(); });
})();
map.on('rotate',ukazKompas); map.on('pitch',ukazKompas);
function ukazKompas(){
  const b=map.getBearing(), p=map.getPitch();
  document.body.classList.toggle('otocena', Math.abs(b)>0.5 || p>0.5);
  $('#ruzica').style.transform='rotate('+(-b)+'deg)';
}

/* ---------- ponuka po pravom kliku ---------- */
function hlaska(t){
  const h=$('#hlaska'); h.textContent=t; h.classList.add('on');
  clearTimeout(hlaska.t); hlaska.t=setTimeout(()=>h.classList.remove('on'),2400);
}
async function doSchranky(text,sprava){
  try{ await navigator.clipboard.writeText(text); hlaska(sprava); }
  catch(e){
    // schránka je bez https zakázaná — aspoň nech sa dá text označiť
    const p=document.createElement('textarea');
    p.value=text; p.style.cssText='position:fixed;top:-200px'; document.body.appendChild(p);
    p.select();
    try{ document.execCommand('copy'); hlaska(sprava); }
    catch(e2){ hlaska('Skopíruj ručne: '+text); }
    p.remove();
  }
}
const suradniceText=l=>l.lat.toFixed(6)+', '+l.lng.toFixed(6);
const odkazNaMiesto=l=>location.origin+location.pathname
  +'#'+l.lat.toFixed(6)+','+l.lng.toFixed(6)+','+map.getZoom().toFixed(1);

function zavriPonuku(){ $('#ponuka').classList.remove('on'); }

function ponukaMiesta(e){
  const l=e.lngLat, n=$('#ponuka');
  // zámery v okolí — 300 m stačí na blok, nie na celú štvrť
  const blizke=(Z?Z.features:[]).filter(f=>f.properties.presnost==='presná'
    && vyhovuje(f.properties)
    && vzdialenost(l.lng,l.lat,f.geometry.coordinates[0],f.geometry.coordinates[1])<300);
  const ikona=d=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    +'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+d+'</svg>';
  n.innerHTML='<div class="hl"><b>'+suradniceText(l)+'</b>'
      +'<span>'+(blizke.length?blizke.length+' '+sklon(blizke.length)+' do 300 m'
                              :'v okolí 300 m nič nemáme')+'</span></div>'
    +'<button data-a="pridat">'+ikona('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><path d="M12 7v6M9 10h6"/>')
      +'Pridať sem zámer</button>'
    +'<button data-a="sur">'+ikona('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>')
      +'Kopírovať súradnice</button>'
    +'<button data-a="odkaz">'+ikona('<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>')
      +'Kopírovať odkaz na toto miesto</button>'
    +'<div class="ciara"></div>'
    +(blizke.length?'<button data-a="okolie">'+ikona('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>')
      +'Zámery v okolí<span class="k">'+blizke.length+'</span></button>':'')
    +'<button data-a="google">'+ikona('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>')
      +'Otvoriť v Google Maps<span class="k">↗</span></button>'
    +'<button data-a="zbgis">'+ikona('<path d="M4 7l5-2 6 2 5-2v12l-5 2-6-2-5 2z"/><path d="M9 5v12M15 7v12"/>')
      +'Otvoriť v ZBGIS (kataster)<span class="k">↗</span></button>'
    +'<div class="ciara"></div>'
    +'<button data-a="sem">'+ikona('<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/>')
      +'Priblížiť sem</button>';

  n.classList.add('on');
  // aby sa ponuka nevysunula mimo okna
  const r=n.getBoundingClientRect(), pl=$('#plocha').getBoundingClientRect();
  n.style.left=Math.min(e.point.x, pl.width - r.width - 12)+'px';
  n.style.top=Math.min(e.point.y, pl.height - r.height - 12)+'px';

  n.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    zavriPonuku();
    switch(b.dataset.a){
      case 'pridat': zacniPridavanie(); formularBodu(l); break;
      case 'sur': doSchranky(suradniceText(l),'Súradnice skopírované'); break;
      case 'odkaz': doSchranky(odkazNaMiesto(l),'Odkaz na toto miesto skopírovaný'); break;
      case 'okolie': ukazOkolie(l,blizke); break;
      case 'google': window.open('https://www.google.com/maps/search/?api=1&query='
        +l.lat.toFixed(6)+','+l.lng.toFixed(6),'_blank','noopener'); break;
      case 'zbgis': window.open('https://zbgis.skgeodesy.sk/mkzbgis/sk/kataster?bm=zbgis'
        +'&z='+Math.round(Math.max(map.getZoom(),17))
        +'&c='+l.lng.toFixed(6)+','+l.lat.toFixed(6),'_blank','noopener'); break;
      case 'sem': map.easeTo({center:[l.lng,l.lat],zoom:Math.max(map.getZoom()+2,16)}); break;
    }
  });
}
/* hrubá vzdialenosť v metroch — na 300 m v Bratislave to stačí */
function vzdialenost(x1,y1,x2,y2){
  const k=Math.cos(y1*Math.PI/180);
  return Math.hypot((x2-x1)*k, y2-y1)*111320;
}
function ukazOkolie(l,zoznam){
  const zor=zoznam.slice().sort((a,b)=>
    vzdialenost(l.lng,l.lat,a.geometry.coordinates[0],a.geometry.coordinates[1])
    -vzdialenost(l.lng,l.lat,b.geometry.coordinates[0],b.geometry.coordinates[1]));
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">V OKOLÍ 300 M</span></div>'
    +'<h2>'+zor.length+' '+sklon(zor.length)+'</h2>'
    +'<div class="miesto">'+suradniceText(l)+'</div>'
    +'<div class="dok">'+zor.map(f=>{
      const p=f.properties, m=Math.round(vzdialenost(l.lng,l.lat,
        f.geometry.coordinates[0],f.geometry.coordinates[1]));
      return '<div class="r" data-id="'+esc(p.id)+'">'
        +(p.nahlad?'<img class="mini" src="'+esc(p.nahlad)+'" alt="" loading="lazy">'
                 :'<span class="mini prazdna">'+esc((p.faza||'').slice(0,4))+'</span>')
        +'<span class="nm">'+esc(p.nazov)+'</span>'
        +'<span class="vel">'+m+' m</span></div>';}).join('')+'</div>';
  $('#detail').querySelectorAll('.dok .r').forEach(r=>r.onclick=()=>{
    const f=Z.features.find(x=>x.properties.id===r.dataset.id);
    if(f){ ukaz(f.properties); naMape(f.properties.id); }});
}

map.on('contextmenu',e=>{
  if(e.originalEvent) e.originalEvent.preventDefault();
  if(!zaneprazdnene()) ponukaMiesta(e);
});
/* zatvára len ľavý klik mimo ponuky — pravý ju práve otvoril */
document.addEventListener('mousedown',e=>{
  if(e.button===0 && !e.target.closest('#ponuka')) zavriPonuku();});
map.on('dragstart',zavriPonuku);
map.on('zoomstart',zavriPonuku);

/* háčik pre testy (headless harness číta stav mapy cez iframe) */
window.MAPA={map:map, get nl(){return nl;}, get filtr(){return filtr;}, get novinky(){return NOVINKY;}};

/* odkaz na miesto: #lat,lon,zoom — DOMOV zostáva celé mesto, nech sa
   tlačidlom ⌖ dá vrátiť na prehľad aj po otvorení zdieľaného odkazu */
(function(){
  const m=(location.hash||'').match(/^#(-?\d+\.?\d*),(-?\d+\.?\d*)(?:,(\d+\.?\d*))?$/);
  if(!m) return;
  map.jumpTo({center:[+m[2],+m[1]], zoom:m[3]?+m[3]:16});
})();
