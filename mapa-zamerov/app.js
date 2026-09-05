/* Mapa zámerov — logika. Vzhľad je v ui.css, kostra v index.html. */
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cis=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const sklon=n=>n===1?'zámer':(n<5?'zámery':'zámerov');
const FAZY=[['zámer','#D6165A'],['posúdené','#3B82D9'],['povolené','#12A67A'],
            ['dokončené','#7FC4EA']];
const FARBA=Object.fromEntries(FAZY);
const G='https://geoportal.bratislava.sk/hSite/rest/services';
const EXPORT=s=>G+'/'+s+'/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857'
  +'&imageSR=3857&size=512,512&format=png32&transparent=true&f=image';
const PODKLAD=['pozadie','v-zastavane','v-zelen','v-voda','v-tok','v-budovy','v-cesty','v-zeleznica'];
const DOMOV={center:[17.13,48.15],zoom:10.7};
/* 'faza' alebo 'typ' — podľa čoho sú body na mape zafarbené */
let farbitPodla='faza';

let Z=null, TYPY=[], TAZISKA={}, KONFIG={}, vsetkyTypy=false;
let filtr={q:'',mc:'',sk:'',pl:'',typ:new Set(),faza:new Set()};

/* Štartovací štýl je zámerne prázdny — len pozadie. Podklad z geoportálu
   sa pridáva až potom (pridajPodklad). Keď je geoportál pomalý alebo
   nedostupný, MapLibre inak nikdy nedohlási 'load' a stránka ostane
   prázdna aj s dátami, ktoré už máme stiahnuté. */
const map=new maplibregl.Map({
  container:'map', attributionControl:{compact:true},
  style:{version:8, glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources:{},
    layers:[{id:'pozadie',type:'background',paint:{'background-color':'#0B1117'}}]},
  center:DOMOV.center, zoom:DOMOV.zoom, minZoom:8, maxZoom:19,
});
function pridajPodklad(){
  map.addSource('osm',{type:'vector',maxzoom:18,attribution:'Geoportál Bratislava · OSM',
    tiles:[G+'/Hosted/Podkladov%C3%A1_mapa_OSM_UP/VectorTileServer/tile/{z}/{y}/{x}.pbf']});
  map.addSource('orto',{type:'raster',tileSize:256,maxzoom:19,
    attribution:'Ortofoto — Hlavné mesto SR Bratislava',
    tiles:[G+'/Hosted/Ortofoto/MapServer/tile/{z}/{y}/{x}']});
  map.addSource('mhd',{type:'raster',tiles:[EXPORT('doprava/Linky_MHD')],tileSize:512});
  [{id:'v-zastavane',type:'fill',source:'osm','source-layer':'zastavané územie',
    paint:{'fill-color':'#131C24'}},
   {id:'v-zelen',type:'fill',source:'osm','source-layer':'zeleň',
    paint:{'fill-color':'#10201A'}},
   {id:'v-voda',type:'fill',source:'osm','source-layer':'vodné plochy',
    paint:{'fill-color':'#0E1D28'}},
   {id:'v-tok',type:'line',source:'osm','source-layer':'vodné toky',
    paint:{'line-color':'#152734','line-width':1.3}},
   {id:'v-budovy',type:'fill',source:'osm','source-layer':'budovy',minzoom:13,
    paint:{'fill-color':'#1A2530'}},
   {id:'v-cesty',type:'line',source:'osm','source-layer':'cestná sieť',
    paint:{'line-color':'#252F39',
      'line-width':['interpolate',['linear'],['zoom'],10,.5,14,1.8,18,6]}},
   {id:'v-zeleznica',type:'line',source:'osm','source-layer':'železničná sieť',
    paint:{'line-color':'#2C3640','line-width':1,'line-dasharray':[3,2]}},
   {id:'orto',type:'raster',source:'orto',layout:{visibility:'none'}},
   {id:'mhd',type:'raster',source:'mhd',layout:{visibility:'none'}},
  ].forEach(v=>map.addLayer(v));
}
map.addControl(new maplibregl.ScaleControl({maxWidth:110}),'bottom-right');

/* ---------- filtrovanie ---------- */
function vyhovuje(p,bez){
  if(bez!=='typ' && filtr.typ.size && !filtr.typ.has(p.typ||'Iné')) return false;
  if(bez!=='faza' && filtr.faza.size && !filtr.faza.has(p.faza)) return false;
  if(bez!=='mc' && filtr.mc && p.obec!==filtr.mc) return false;
  if(bez!=='sk' && filtr.sk && (p.skupina||'')!==filtr.sk) return false;
  if(filtr.pl==='1' && !(p.plany&&p.plany.length)) return false;
  if(filtr.pl==='2' && !(p.nahlady&&p.nahlady.length)) return false;
  if(filtr.pl==='3' && p.presnost!=='presná') return false;
  if(filtr.q){
    const h=(p.nazov+' '+p.firma+' '+p.ico+' '+(p.skupina||'')+' '+p.obec).toLowerCase();
    if(!h.includes(filtr.q)) return false;
  }
  return true;
}
const pocetFiltrov=()=>filtr.typ.size+filtr.faza.size+(filtr.mc?1:0)+(filtr.sk?1:0)+(filtr.pl?1:0);
const pole=(p,k)=>{const v=p[k]; return typeof v==='string'?JSON.parse(v):v;};

function obnov(){
  if(!Z) return;
  const presne=[], hromada={}, pocFaz={};
  let n=0,npl=0,nob=0;
  Z.features.forEach(f=>{
    const p=f.properties; if(!vyhovuje(p)) return;
    n++;
    if(p.plany&&p.plany.length) npl++;
    if(p.nahlady&&p.nahlady.length) nob++;
    pocFaz[p.faza]=(pocFaz[p.faza]||0)+1;
    if(p.presnost==='presná') presne.push(f);
    else (hromada[p.obec]=hromada[p.obec]||[]).push(p);
  });
  map.getSource('zamery').setData({type:'FeatureCollection',features:presne});
  map.getSource('nezname').setData({type:'FeatureCollection',
    features:Object.keys(hromada).filter(o=>TAZISKA[o]).map(o=>({type:'Feature',
      geometry:{type:'Point',coordinates:TAZISKA[o]},
      properties:{obec:o,pocet:hromada[o].length}}))});

  $('#c-spolu').innerHTML=cis(n)+' <span>'+(n===1?'zámer':(n<5?'zámery':'zámerov'))+'</span>';
  $('#c-vykresy').textContent=cis(npl);
  $('#c-poloha').textContent=cis(presne.length);
  $('#c-obrazky').textContent=cis(nob);
  $('#vysledok').textContent=cis(n)+' výsledkov';
  const pf=pocetFiltrov();
  $('#pocet-filtrov').hidden=!pf; $('#pocet-filtrov').textContent=pf;
  kresliLegendu(pocFaz, Object.values(hromada).reduce((a,b)=>a+b.length,0));
  kresliAktivne(); kresliKategorie(); kresliSuplik();
}

/* Legenda ukazuje presne tú vlastnosť, podľa ktorej sú body zafarbené —
   inak by farby v paneli tvrdili niečo iné než farby na mape. */
function kresliLegendu(poc,bez){
  const podla = farbitPodla==='typ'
    ? TYPY.slice(0,6).map(t=>[t,BARVA_TYPU[t]||'#8B98A3','typ'])
    : FAZY.map(([f,c])=>[f,c,'faza']);
  $('#legenda').innerHTML=podla.map(([f,c,d])=>
    '<div class="r" data-d="'+d+'" data-v="'+esc(f)+'" aria-pressed="'+filtr[d].has(f)+'">'
    +'<span class="t" style="background:'+c+'"></span>'+esc(f)+'</div>').join('')
    +(farbitPodla==='typ' && TYPY.length>6
      ? '<div class="r" style="cursor:default"><span class="t" style="background:#8B98A3"></span>ostatné</div>' : '')
    +'<div class="r" style="cursor:default"><span class="t duta"></span>bez známej polohy</div>';
}
/* Prekreslí farbu bodov podľa aktuálne zvolenej vlastnosti. */
function prefarbi(){
  if(!map.getLayer('bod')) return;
  const vyraz = farbitPodla==='typ'
    ? ['match',['get','typ']].concat(
        TYPY.slice(0,6).flatMap(t=>[t,BARVA_TYPU[t]||'#8B98A3']), ['#8B98A3'])
    : ['match',['get','faza']].concat(
        FAZY.flatMap(([f,c])=>[f,c]), ['#8B98A3']);
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
    ? 'background:'+(TYPY.indexOf(t)<6?(BARVA_TYPU[t]||'#8B98A3'):'#8B98A3')
    : 'background:transparent;border:1.5px solid var(--ln2)';
  $('#kategorie').innerHTML=zoz.map((t,i)=>
    '<div class="r" data-t="'+esc(t)+'" aria-pressed="'+filtr.typ.has(t)+'">'
    +'<span class="t" style="'+bod(t)+'"></span>'+esc(t)
    +'<span class="n">'+cis(p[t]||0)+'</span></div>').join('');
  $('#vsetky-kat').textContent=vsetkyTypy?'Zobraziť menej ←':'Zobraziť všetky kategórie →';
  $('#vsetky-kat').hidden=TYPY.length<=5;
}
function kresliSuplik(){
  const p=poctyTypov(), zoz=vsetkyTypy?TYPY:TYPY.slice(0,6);
  $('#f-typy').innerHTML=zoz.map(t=>
    '<label class="volba"><input type="checkbox" data-t="'+esc(t)+'"'
    +(filtr.typ.has(t)?' checked':'')+'> '+esc(t)+'<span class="n">'+cis(p[t]||0)+'</span></label>').join('');
  $('#viac-typy').hidden=TYPY.length<=6;
  $('#viac-typy').textContent=vsetkyTypy?'Zobraziť menej':'Zobraziť všetky';
  const pf={};
  Z.features.forEach(f=>{const x=f.properties;
    if(vyhovuje(x,'faza')) pf[x.faza]=(pf[x.faza]||0)+1;});
  $('#f-fazy').innerHTML=FAZY.map(([f])=>
    '<button aria-pressed="'+filtr.faza.has(f)+'" data-f="'+esc(f)+'">'
    +f+' '+cis(pf[f]||0)+'</button>').join('');
  ['mc','sk'].forEach(id=>{
    const sel=$('#f-'+id), bolo=sel.value, poc={}, kl=id==='mc'?'obec':'skupina';
    Z.features.forEach(f=>{const x=f.properties;
      if(vyhovuje(x,id)){const v=x[kl]||''; if(v) poc[v]=(poc[v]||0)+1;}});
    [...sel.options].forEach(o=>{if(o.value) o.textContent=o.value+' ('+(poc[o.value]||0)+')';});
    sel.value=bolo;
  });
}

/* ---------- detail ---------- */
let LUPA=[], lupaI=0, GAL=[], galI=0, aktivnaZal='v';
function ukaz(p,z){
  const obr=pole(p,'nahlady')||[], plany=pole(p,'plany')||[], foto=pole(p,'obrazky')||[];
  GAL=[].concat(foto.map(x=>({s:x.u,p:x.p,u:x.u})),
                obr.map((s,i)=>({s:s,p:(plany[i]&&plany[i].p)||'podklad zo spisu',
                                 u:(plany[i]&&plany[i].u)||s})));
  galI=0; aktivnaZal=z||'v';
  const chyba='<span class="v chyba">register neuvádza</span>';
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML=
     '<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok">'+esc((p.typ||'—').toUpperCase())+'</span>'
      +'<span class="stitok b">'+esc((p.faza||'—').toUpperCase())+'</span></div>'
    +'<h2>'+esc(p.nazov)+'</h2>'
    +'<div class="miesto">◉ '+esc(p.obec)
      +'<button class="na-mape" onclick="naMape(\''+esc(p.id)+'\')">⤢ Zobraziť na mape</button></div>'
    +'<div class="udaje">'
      +riadok('Investor', p.firma?esc(p.firma)+(p.ico?' · IČO '+esc(p.ico):''):null)
      +riadok('Skupina', p.skupina?esc(p.skupina):null)
      +riadok('Architekt', null)
      +riadok('Typológia', esc(p.typ||''))
      +riadok('Stav', esc(p.faza||''))
      +riadok('Povoľuje', esc(p.urad||''))
      +riadok('Poloha', p.presnost==='presná'?(esc(p.ulica||'presná'))
        :'<span class="v chyba">nie je známa</span>', true)
      +riadok('Aktualizované', esc(p.zmena||''))
    +'</div>'
    +'<div class="zalozky">'
      +'<button data-z="v" '+(GAL.length?'':'disabled')+'>VIZUALIZÁCIE</button>'
      +'<button data-z="d" '+(plany.length?'':'disabled')+'>DOKUMENTY ('+plany.length+')</button>'
    +'</div><div id="obsah-zal"></div>'
    +'<a class="odkaz" href="https://www.enviroportal.sk/eia/detail/'+esc(p.id)
      +'" target="_blank" rel="noopener">Detail zámeru na enviroportáli →</a>'
    +'<p class="pozn">Architekt a harmonogram v registri nie sú — tie vie doplniť '
    +'len autor projektu cez <a href="../komunita/" style="color:var(--ac2)">komunitné dáta</a>.</p>';
  $('#detail').querySelectorAll('.zalozky button').forEach(b=>b.onclick=()=>{
    aktivnaZal=b.dataset.z; kresliZalozku(p);});
  kresliZalozku(p);
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
    c.innerHTML='<div class="dok">'+plany.map((x,i)=>'<div class="r" data-i="'+i+'">'
      +(x.n?'<img class="mini" src="'+esc(x.n)+'" alt="" loading="lazy">'
           :'<span class="mini prazdna">'+esc((x.t||'PDF').slice(0,4))+'</span>')
      +'<span class="nm">'+esc(x.p)+'</span>'
      +'<span class="vel">'+(x.v?(x.v>=1e6?(x.v/1e6).toFixed(1)+' MB':Math.round(x.v/1000)+' kB'):'')+'</span>'
      +'</div>').join('')+'</div>';
    c.querySelectorAll('.dok .r').forEach(el=>el.onclick=()=>{
      LUPA=plany.map(x=>({s:x.n||null,p:x.p,u:x.u}));
      otvorLupu(+el.dataset.i);});
  }
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
  ber('ulice.geojson',null)]);

let spustene=false;
async function spusti(){
  if(spustene) return; spustene=true;
  let mc,z,ul;
  try{ pridajPodklad(); }
  catch(e){ console.warn('podklad sa nepridal:',e.message); }
  try{ [KONFIG,mc,z,ul]=await DATA; }
  catch(e){ $('#c-spolu').textContent='Dáta sa nenačítali'; spustene=false; return; }
  Z=z;
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
      paint:{'text-color':'#7B8B99','text-halo-color':'#0B1117','text-halo-width':1.4}});
  }
  map.addSource('hranice',{type:'geojson',data:mc});
  map.addLayer({id:'hranice-c',type:'line',source:'hranice',
    paint:{'line-color':'#333F4A','line-width':1,'line-dasharray':[4,3]}});
  map.addSource('mcnazvy',{type:'geojson',data:{type:'FeatureCollection',
    features:Object.keys(TAZISKA).map(o=>({type:'Feature',
      geometry:{type:'Point',coordinates:TAZISKA[o]},
      properties:{n:o.replace(/^Bratislava\s*[-–]\s*/,'').toUpperCase()}}))}});
  map.addLayer({id:'mc-txt',type:'symbol',source:'mcnazvy',
    layout:{'text-field':['get','n'],'text-size':['interpolate',['linear'],['zoom'],10,10,14,13],
      'text-font':['Noto Sans Regular'],'text-letter-spacing':.16,'text-max-width':9},
    paint:{'text-color':'#5D6B77','text-halo-color':'#0B1117','text-halo-width':1.6}});

  map.addSource('zamery',{type:'geojson',data:{type:'FeatureCollection',features:[]},
    cluster:true, clusterRadius:20, clusterMaxZoom:13});
  /* Zhluk je neutrálny — farba je vyhradená pre význam (fáza / účel),
     a zhluk mieša viacero hodnôt naraz, takže by klamal. */
  map.addLayer({id:'zh-kruh',type:'circle',source:'zamery',filter:['has','point_count'],
    paint:{'circle-color':'rgba(122,144,166,.16)',
      'circle-radius':['step',['get','point_count'],17,10,23,100,30]}});
  map.addLayer({id:'zh',type:'circle',source:'zamery',filter:['has','point_count'],
    paint:{'circle-color':'#3D5165','circle-opacity':.96,
      'circle-stroke-width':1.4,'circle-stroke-color':'rgba(180,200,218,.34)',
      'circle-radius':['step',['get','point_count'],13,10,17,100,21]}});
  map.addLayer({id:'zh-txt',type:'symbol',source:'zamery',filter:['has','point_count'],
    layout:{'text-field':['get','point_count_abbreviated'],'text-size':12.5,
      'text-font':['Noto Sans Regular']},paint:{'text-color':'#fff'}});
  map.addLayer({id:'bod',type:'circle',source:'zamery',filter:['!',['has','point_count']],
    paint:{'circle-color':['match',['get','faza'],'zámer','#D6165A','posúdené','#3B82D9',
        'povolené','#12A67A','dokončené','#7FC4EA','#8B98A3'],
      'circle-radius':['interpolate',['linear'],['zoom'],10,4.5,14,7,18,11],
      'circle-stroke-width':1.5,'circle-stroke-color':'rgba(11,17,23,.85)'}});
  map.addLayer({id:'bod-txt',type:'symbol',source:'zamery',
    filter:['!',['has','point_count']],minzoom:14.5,
    layout:{'text-field':['get','nazov'],'text-size':11,'text-anchor':'left',
      'text-offset':[.9,0],'text-max-width':12,'text-font':['Noto Sans Regular'],
      'text-optional':true},
    paint:{'text-color':'#DCE4EC','text-halo-color':'#0B1117','text-halo-width':1.5}});

  map.addSource('nezname',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'nez',type:'circle',source:'nezname',
    paint:{'circle-color':'rgba(148,163,179,.09)',
      'circle-radius':['interpolate',['linear'],['get','pocet'],1,14,150,32],
      'circle-stroke-width':1.2,'circle-stroke-color':'#54626D'}});
  map.addLayer({id:'nez-txt',type:'symbol',source:'nezname',
    layout:{'text-field':['get','pocet'],'text-size':12,'text-font':['Noto Sans Regular']},
    paint:{'text-color':'#94A3B3'}});

  map.addSource('komunita',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addSource('moje',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  [['kom','komunita','#8B6FD4'],['moj','moje','#B79BEE']].forEach(([id,src,c])=>{
    map.addLayer({id:id,type:'circle',source:src,
      paint:{'circle-color':c,'circle-opacity':.92,
        'circle-radius':['interpolate',['linear'],['zoom'],10,4.5,14,7,18,11],
        'circle-stroke-width':2,'circle-stroke-color':'rgba(11,17,23,.85)'}});
    map.addLayer({id:id+'-txt',type:'symbol',source:src,minzoom:13,
      layout:{'text-field':['get','nazov'],'text-size':11,'text-anchor':'left',
        'text-offset':[.9,0],'text-max-width':12,'text-font':['Noto Sans Regular'],
        'text-optional':true},
      paint:{'text-color':'#C3B4EC','text-halo-color':'#0B1117','text-halo-width':1.5}});
    map.on('click',id,e=>ukazKomunitu(e.features[0].properties));
  });
  map.addSource('novy',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'novy-b',type:'circle',source:'novy',
    paint:{'circle-color':'#D6165A','circle-radius':11,'circle-stroke-width':3,
      'circle-stroke-color':'#fff'}});

  [...new Set(z.features.map(f=>f.properties.obec).filter(Boolean))].sort()
    .forEach(o=>$('#f-mc').insertAdjacentHTML('beforeend','<option>'+esc(o)+'</option>'));
  [...new Set(z.features.map(f=>f.properties.skupina).filter(Boolean))].sort()
    .forEach(o=>$('#f-sk').insertAdjacentHTML('beforeend','<option>'+esc(o)+'</option>'));
  const pc={}; z.features.forEach(f=>{const t=f.properties.typ||'Iné'; pc[t]=(pc[t]||0)+1;});
  TYPY=Object.keys(pc).sort((a,b)=>pc[b]-pc[a]);
  const paleta=['#D6165A','#3B82D9','#12A67A','#7FC4EA','#C08A4A','#8B6FD4',
                '#4E9E86','#B0607F','#5E7F96','#7C8B99','#8B98A3'];
  TYPY.forEach((t,i)=>BARVA_TYPU[t]=paleta[i%paleta.length]);
  prefarbi();

  obnov(); kresliMoje(); nacitajKomunitu();

  map.on('click',e=>{ if(pridavam) formularBodu(e.lngLat); });
  map.on('click','zh',e=>{ if(pridavam) return;
    map.getSource('zamery').getClusterExpansionZoom(e.features[0].properties.cluster_id)
      .then(zz=>map.easeTo({center:e.features[0].geometry.coordinates,zoom:zz+.4}));});
  map.on('click','bod',e=>{ if(!pridavam) ukaz(e.features[0].properties); });
  map.on('click','nez',e=>{ if(!pridavam) ukazNezname(e.features[0].properties.obec); });
  ['zh','bod','nez','kom','moj'].forEach(l=>{
    map.on('mouseenter',l,()=>{ if(!pridavam) map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave',l,()=>{ if(!pridavam) map.getCanvas().style.cursor='';});
  });
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

function ukazNezname(obec){
  const z=Z.features.filter(f=>f.properties.obec===obec
    && f.properties.presnost!=='presná' && vyhovuje(f.properties));
  $('#detail').className='detail on'; $('#detail').scrollTop=0;
  $('#detail').innerHTML='<button class="zavri" onclick="zavriDetail()">×</button>'
    +'<div class="stitky"><span class="stitok b">BEZ ZNÁMEJ POLOHY</span></div>'
    +'<h2>'+esc(obec)+'</h2>'
    +'<div class="miesto">'+z.length+' zámerov, pri ktorých register neuvádza ulicu</div>'
    +'<a class="odkaz" href="../doplnit-polohu/?mc='+encodeURIComponent(obec)+'">Doplniť polohy →</a>'
    +'<div class="dok">'+z.slice(0,60).map(f=>'<div class="r" data-id="'+esc(f.properties.id)+'">'
      +'<span class="mini prazdna">'+esc((f.properties.faza||'').slice(0,4))+'</span>'
      +'<span class="nm">'+esc(f.properties.nazov)+'</span></div>').join('')+'</div>';
  $('#detail').querySelectorAll('.dok .r').forEach(el=>el.onclick=()=>{
    const f=Z.features.find(x=>x.properties.id===el.dataset.id); if(f) ukaz(f.properties);});
}

/* ---------- ovládanie ---------- */
$('#q').addEventListener('input',()=>{filtr.q=$('#q').value.trim().toLowerCase(); obnov();});
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
  farbitPodla=i.value; prefarbi(); kresliKategorie();});
$('#aktivne').addEventListener('click',e=>{
  const b=e.target.closest('b'); if(!b) return;
  const d=b.dataset.d, v=b.dataset.v;
  if(d==='typ') filtr.typ.delete(v); else if(d==='faza') filtr.faza.delete(v);
  else { filtr[d]=''; const s=$('#f-'+d); if(s) s.value=''; }
  obnov();});

const otvorSuplik=o=>{$('#suplik').classList.toggle('on',o); $('#zavoj').classList.toggle('on',o);};
$('#otvor-filtre').onclick=()=>otvorSuplik(true);
$('#zavri-filtre').onclick=()=>otvorSuplik(false);
$('#zavoj').onclick=()=>otvorSuplik(false);
$('#viac-typy').onclick=()=>{vsetkyTypy=!vsetkyTypy; kresliSuplik();};
$('#f-typy').addEventListener('change',e=>{
  const t=e.target.dataset.t; if(!t) return;
  e.target.checked?filtr.typ.add(t):filtr.typ.delete(t); obnov();});
$('#f-fazy').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  filtr.faza.has(b.dataset.f)?filtr.faza.delete(b.dataset.f):filtr.faza.add(b.dataset.f); obnov();});
['mc','sk','pl'].forEach(k=>$('#f-'+k).addEventListener('input',e=>{filtr[k]=e.target.value; obnov();}));
$('#vymaz').onclick=()=>{
  filtr={q:filtr.q,mc:'',sk:'',pl:'',typ:new Set(),faza:new Set()};
  $('#f-mc').value=''; $('#f-sk').value=''; $('#f-pl').value=''; obnov();};

$('#tl-vrstvy').onclick=e=>{e.stopPropagation(); $('#pop-vrstvy').classList.toggle('on');};
document.addEventListener('click',e=>{
  if(!e.target.closest('#pop-vrstvy')&&!e.target.closest('#tl-vrstvy'))
    $('#pop-vrstvy').classList.remove('on');});
document.querySelectorAll('input[name=pod]').forEach(r=>r.onchange=()=>{
  const v=r.value;
  map.setLayoutProperty('orto','visibility',v==='orto'?'visible':'none');
  PODKLAD.forEach(l=>map.setLayoutProperty(l,'visibility',v==='mapa'?'visible':'none'));});
const prep=(id,...vrstvy)=>$('#'+id).onchange=e=>vrstvy.forEach(v=>{
  if(map.getLayer(v)) map.setLayoutProperty(v,'visibility',e.target.checked?'visible':'none');});
prep('v-ulice','ulice-txt'); prep('v-hranice','hranice-c'); prep('v-mc','mc-txt');
prep('v-mhd','mhd'); prep('v-nazvy','bod-txt');
prep('v-komunita','kom','kom-txt','moj','moj-txt');

$('#tl-plus').onclick=()=>map.zoomIn();
$('#tl-minus').onclick=()=>map.zoomOut();
$('#tl-domov').onclick=()=>map.easeTo({...DOMOV,bearing:0,pitch:0});
$('#tl-kompas').onclick=()=>map.easeTo({bearing:0,pitch:0});
$('#tl-pridat').onclick=()=>pridavam?zrusPridavanie():zacniPridavanie();
$('#navod-zrus').onclick=()=>{zrusPridavanie(); zavriDetail();};

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
  tahadlo:'#tahadlo', kluc:'mib-sirka-panela', zakl:326, min:250, max:640, smer:1,
  sirku:w=>{$('#ovladanie').style.width=w+'px';},
  daj:()=>$('#ovladanie').offsetWidth});
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
  if(!pridavam) ponukaMiesta(e);
});
/* zatvára len ľavý klik mimo ponuky — pravý ju práve otvoril */
document.addEventListener('mousedown',e=>{
  if(e.button===0 && !e.target.closest('#ponuka')) zavriPonuku();});
map.on('dragstart',zavriPonuku);
map.on('zoomstart',zavriPonuku);

/* odkaz na miesto: #lat,lon,zoom — DOMOV zostáva celé mesto, nech sa
   tlačidlom ⌖ dá vrátiť na prehľad aj po otvorení zdieľaného odkazu */
(function(){
  const m=(location.hash||'').match(/^#(-?\d+\.?\d*),(-?\d+\.?\d*)(?:,(\d+\.?\d*))?$/);
  if(!m) return;
  map.jumpTo({center:[+m[2],+m[1]], zoom:m[3]?+m[3]:16});
})();
