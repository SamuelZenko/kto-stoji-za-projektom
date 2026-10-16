/* Dotyková obrazovka k makete — tri režimy nad tými istými dátami ako mapa zámerov.
     PULZ        kde a kedy sa stavia (fázy, mestské časti, roky)
     OBJAV       113 brownfieldov z registra MIB 2022 × dnešné zámery z EIA
     KTO STAVIA  investori zjednotení podľa IČO
   Informačná architektúra (tri režimy, „spiaci obri") je z konceptu Zažni mesto,
   vzhľad je TU—BA. Po dvoch minútach bez dotyku sa obrazovka vráti na úvod. */
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cis=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const des=n=>String(n).replace('.',',');
const bezDiak=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const sklon=(n,a,b,c)=>n===1?a:(n>=2&&n<5?b:c);
const bezBA=s=>String(s||'').replace(/^Bratislava\s*[-–]\s*/,'');
const klucMC=s=>bezDiak(bezBA(s)).replace(/[^a-z]/g,'').slice(0,12);

const FAZY=[['zámer','#F3716D'],['posúdené','#000000'],['povolené','#FFFFFF'],['dokončené','#B4B4B0']];
const FARBA=Object.fromEntries(FAZY);
const SIVA='#8A8A86';
const G='https://geoportal.bratislava.sk/hSite/rest/services';
const WEB='https://samuelzenko.github.io/kto-stoji-za-projektom/mapa-zamerov/';
const BF_WEB='https://experience.arcgis.com/experience/e25edd3fc2e94da483798fd5dbf3500e/page/brownfieldy';
const DOMOV={center:[17.13,48.155],zoom:10.9};
const NECINNOST=120000;

/* ---------- obri: jedna silueta na typológiu pôvodného využitia ----------
   Stav nesie výplň aj tvár, nikdy len farba:
     spí          warm grey, zatvorené oči — v registri 2022 bez zámeru, v EIA nič
     plán 2022    biely, otvorené oči — MIB v roku 2022 o zámere vedel
     zámer v EIA  červený, otvorené oči a lúče — dnes je na území zámer v registri EIA */
const OBRI={
  priemysel:{b:'M16 112 V54 L44 34 v20 L72 34 v20 L100 34 v78 Z M26 44 V16 h13 v19 Z',e:[[46,80],[72,80]],m:[59,95]},
  doprava:{b:'M16 112 V62 Q60 28 104 62 V112 Z',e:[[38,78],[82,78]],m:[60,97]},
  kasarne:{b:'M28 112 V34 h12 v-9 h11 v9 h18 v-9 h11 v9 h12 v78 Z',e:[[47,78],[73,78]],m:[60,93]},
  pole:{b:'M20 112 V52 a16 16 0 0 1 32 0 V112 Z M62 112 V64 a13 13 0 0 1 26 0 V112 Z',e:[[29,82],[43,82]],m:[36,95]},
  administrativa:{b:'M28 112 V26 q0-8 8-8 h48 q8 0 8 8 V112 Z',x:'M42 36 h10 M68 36 h10 M42 52 h10 M68 52 h10',e:[[46,80],[74,80]],m:[60,95]},
  sport:{b:'M14 112 V80 q46-46 92 0 V112 Z',e:[[44,90],[76,90]],m:[60,102]},
  byvanie:{b:'M20 112 V66 L60 32 L100 66 V112 Z',e:[[46,84],[74,84]],m:[60,98]},
  kultura:{b:'M22 112 V46 h76 V112 Z',x:'M60 46 V28 l15 5 -15 5',e:[[46,78],[74,78]],m:[60,93]},
  rekreacia:{b:'M20 112 V82 a40 40 0 0 1 80 0 V112 Z',e:[[46,88],[74,88]],m:[60,100]},
  ine:{b:'M26 112 V50 q0-14 14-14 h40 q14 0 14 14 V112 Z',e:[[46,80],[74,80]],m:[60,94]},
};
const STAV={spi:{f:'#D9D9D6',t:'#000',o:0,nazov:'spí'},plan:{f:'#FFFFFF',t:'#000',o:1,nazov:'plán 2022'},
            eia:{f:'#F3716D',t:'#FFF',o:1,nazov:'zámer v EIA'}};
function obor(typ,stav,px){
  const g=OBRI[typ]||OBRI.ine, s=STAV[stav]||STAV.spi;
  const oci=g.e.map(([x,y])=>s.o?'<circle cx="'+x+'" cy="'+y+'" r="5.5" fill="'+s.t+'"/>'
    :'<path d="M'+(x-7)+' '+y+' q7 5 14 0" stroke="'+s.t+'" stroke-width="4" fill="none" stroke-linecap="round"/>').join('');
  const usta=s.o?'<path d="M'+(g.m[0]-7)+' '+g.m[1]+' q7 6 14 0" stroke="'+s.t+'" stroke-width="3.6" fill="none" stroke-linecap="round"/>'
    :'<path d="M'+(g.m[0]-4)+' '+g.m[1]+' h8" stroke="'+s.t+'" stroke-width="3.4" stroke-linecap="round"/>';
  let luce='';
  if(stav==='eia') for(let a=-150;a<=-30;a+=30){ const r=a*Math.PI/180;
    luce+='<line x1="'+(60+Math.cos(r)*58).toFixed(1)+'" y1="'+(70+Math.sin(r)*58).toFixed(1)+'" x2="'+(60+Math.cos(r)*70).toFixed(1)
      +'" y2="'+(70+Math.sin(r)*70).toFixed(1)+'" stroke="#000" stroke-width="5" stroke-linecap="round"/>'; }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+px+'" height="'+px+'" viewBox="-6 -6 132 124">'+luce
    +'<path d="'+g.b+'" fill="'+s.f+'" stroke="#000" stroke-width="5" stroke-linejoin="round"/>'
    +(g.x?'<path d="'+g.x+'" fill="none" stroke="'+s.t+'" stroke-width="3" stroke-linecap="round" opacity=".8"/>':'')
    +oci+usta+'</svg>';
}
const stavBF=p=>p.eia?'eia':(p.ma_zamer_2022?'plan':'spi');

/* ---------- mapa: tlmený podklad z geoportálu ---------- */
const map=new maplibregl.Map({container:'map',attributionControl:{compact:true},
  style:{version:8,glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',sources:{},
    layers:[{id:'pozadie',type:'background',paint:{'background-color':'#EDEDEA'}}]},
  center:DOMOV.center,zoom:DOMOV.zoom,minZoom:9.5,maxZoom:18,pitchWithRotate:false,dragRotate:false});
map.touchZoomRotate.disableRotation();
function pridajPodklad(){
  map.addSource('osm',{type:'vector',maxzoom:18,attribution:'Geoportál Bratislava · OSM',
    tiles:[G+'/Hosted/Podkladov%C3%A1_mapa_OSM_UP/VectorTileServer/tile/{z}/{y}/{x}.pbf']});
  const w=(a,b,c)=>['interpolate',['linear'],['zoom'],10,a,14,b,18,c];
  [{id:'p-zast',type:'fill','source-layer':'zastavané územie',paint:{'fill-color':'#E6E6E2'}},
   {id:'p-zelen',type:'fill','source-layer':'zeleň',paint:{'fill-color':'#DFE3DA'}},
   {id:'p-voda',type:'fill','source-layer':'vodné plochy',paint:{'fill-color':'#CFD5D4'}},
   {id:'p-tok',type:'line','source-layer':'vodné toky',paint:{'line-color':'#CFD5D4','line-width':w(.8,1.6,3)}},
   {id:'p-budovy',type:'fill','source-layer':'budovy',minzoom:13,paint:{'fill-color':'#DADAD6'}},
   {id:'p-cesty',type:'line','source-layer':'cestná sieť',filter:['in',['get','_symbol'],['literal',[2,3,4]]],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#FFFFFF','line-width':w(.3,1.4,6)}},
   {id:'p-cesty-v',type:'line','source-layer':'cestná sieť',filter:['in',['get','_symbol'],['literal',[5,6]]],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#FFFFFF','line-width':w(1.4,3.4,12)}},
   {id:'p-zel',type:'line','source-layer':'železničná sieť',filter:['==',['get','_symbol'],0],
    paint:{'line-color':'#B4B4B0','line-width':1,'line-dasharray':[4,2.5]}},
  ].forEach(v=>map.addLayer(Object.assign({source:'osm'},v)));
}

/* ---------- stav ---------- */
let Z=[], BF=[], MC=null, INV=[], INV_IDX={}, TAZ={};
const S={rezim:'pulz', fazy:new Set(FAZY.map(f=>f[0])), mc:'', bf:null, bfFilter:'', q:'',
  investor:null, zamer:null, ukazZamery:true, ukazBF:true};
let pripravene=false;

/* ---------- dáta ---------- */
const ber=(s,zal)=>fetch(s,{cache:'no-cache'}).then(r=>{ if(!r.ok) throw new Error(s+' '+r.status); return r.json(); })
  .catch(e=>{ if(zal!==undefined) return zal; throw e; });
const DATA=Promise.all([ber('zamery.geojson'),ber('brownfieldy.geojson'),ber('mestske-casti.geojson'),
  ber('redakcia.json',null),ber('nazvy-obchodne.json',{})]);

/* názov investora bez adresy: „SLOVNAFT, a. s., Vlčie hrdlo 1" → „SLOVNAFT, a. s." */
const FORMA=/^(.*?\b(?:s\.\s*r\.\s*o\.|a\.\s*s\.|spol\.\s*s\s*r\.\s*o\.|k\.\s*s\.|v\.\s*o\.\s*s\.|š\.\s*p\.|n\.\s*o\.|o\.\s*z\.|SE\b))/i;
const cistyNazov=f=>{ f=String(f||'').trim(); const m=f.match(FORMA); return (m?m[1]:f.split(',')[0]).replace(/\s+/g,' ').trim(); };

function priprav(z,bf,mc,red,naz){
  /* redakcia: ručne overená poloha, názov a fáza majú prednosť (rovnako ako mapa) */
  const podla={}; z.features.forEach(f=>podla[f.properties.id]=f);
  Object.entries((red&&red.zamery)||{}).forEach(([id,r])=>{ const f=podla[id]; if(!f) return; const p=f.properties;
    if(r.poloha){ f.geometry={type:'Point',coordinates:r.poloha}; p.presnost='presná'; }
    if(r.nazov) p.nazov_obch=r.nazov; if(r.faza) p.faza=r.faza; });
  z.features.forEach(f=>{ const n=naz&&naz[f.properties.id]; if(n) f.properties.nazov_obch=typeof n==='string'?n:n.nazov; });
  /* líniové stavby (diaľnice, trate) bod na mape zavádza — tu ich nekreslíme, v číslach ostávajú */
  Z=z.features.map(f=>{ const p=f.properties;
    return {id:p.id,nazov:p.nazov_obch||p.nazov,faza:FARBA[p.faza]?p.faza:'',typ:p.typ||'Iné',obec:bezBA(p.obec),
      rok:+(String(p.zmena||'').slice(0,4))||null,firma:p.firma||'',ico:String(p.ico||'').replace(/\D/g,''),
      skupina:p.skupina||'',presna:p.presnost==='presná'&&!!f.geometry,lin:!!p.lin,
      xy:f.geometry&&f.geometry.type==='Point'?f.geometry.coordinates:null}; });
  BF=bf.features.map(f=>Object.assign({geom:f.geometry,stav:stavBF(f.properties)},f.properties));
  BF.zdroj=bf.zdroj||{};
  MC=mc;
  mc.features.forEach(f=>{ const a=f.properties||{}, n=a.NAZOV_ZUJ||a.MC_LABEL||''; if(!n||!f.geometry) return;
    const g=f.geometry, kr=g.type==='Polygon'?g.coordinates[0]:g.coordinates.reduce((x,y)=>y[0].length>x.length?y[0]:x,[]);
    TAZ[klucMC(n)]=[kr.reduce((s,c)=>s+c[0],0)/kr.length,kr.reduce((s,c)=>s+c[1],0)/kr.length]; });
  /* investori: jedno IČO = jeden investor; názov je najčastejší zápis bez adresy */
  const inv={};
  Z.forEach(z=>{ const k=z.ico||('bez:'+bezDiak(cistyNazov(z.firma))); if(!z.firma&&!z.ico) return;
    const i=inv[k]||(inv[k]={k:k,ico:z.ico,zapisy:{},zamery:[],skupina:''});
    const n=cistyNazov(z.firma); if(n) i.zapisy[n]=(i.zapisy[n]||0)+1;
    if(z.skupina&&!i.skupina) i.skupina=z.skupina; i.zamery.push(z); z.inv=k; });
  INV=Object.values(inv).map(i=>{ const zz=Object.entries(i.zapisy).sort((a,b)=>b[1]-a[1]);
    i.nazov=zz.length?zz[0][0]:'neuvedený'; i.zapisov=zz.length; i.n=i.zamery.length;
    i.fazy=FAZY.map(([f])=>i.zamery.filter(z=>z.faza===f).length);
    i.bf=BF.filter(b=>b.zamery.some(x=>(x.ico&&x.ico.replace(/\D/g,'')===i.ico))).length; return i; })
    .sort((a,b)=>b.n-a.n||a.nazov.localeCompare(b.nazov,'sk'));
  INV.forEach(i=>INV_IDX[i.k]=i);
}

/* ---------- vrstvy ---------- */
function nacitajObrazok(svg){ return new Promise((ok,zle)=>{ const im=new Image(); im.onload=()=>ok(im); im.onerror=zle;
  im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); }); }
async function pridajIkony(){
  const px=2, ulohy=[];
  for(const t in OBRI) for(const s in STAV) ulohy.push(nacitajObrazok(obor(t,s,44*px)).then(im=>{
    if(!map.hasImage('obor-'+t+'-'+s)) map.addImage('obor-'+t+'-'+s,im,{pixelRatio:px}); }));
  const c=document.createElement('canvas'); c.width=c.height=48*px; const g=c.getContext('2d'); g.scale(px,px);
  g.fillStyle='rgba(255,255,255,.6)'; g.strokeStyle=SIVA; g.lineWidth=1.6; g.setLineDash([3,3]);
  g.beginPath(); g.arc(24,24,22,0,Math.PI*2); g.fill(); g.stroke();
  if(!map.hasImage('kruh')) map.addImage('kruh',g.getImageData(0,0,c.width,c.height),{pixelRatio:px});
  await Promise.all(ulohy);
}
function pridajVrstvy(){
  map.addSource('mc',{type:'geojson',data:MC});
  map.addLayer({id:'mc-hranica',type:'line',source:'mc',paint:{'line-color':'#000','line-opacity':.4,'line-width':1,'line-dasharray':[4,3]}});
  map.addLayer({id:'mc-vyber',type:'line',source:'mc',filter:['==',['get','NAZOV_ZUJ'],''],paint:{'line-color':'#000','line-width':2.5}});

  /* brownfieldy: plocha podľa stavu, obrys čierny; ikona obra a názov z bodu vnútri územia */
  const bfData={type:'FeatureCollection',features:BF.map(b=>({type:'Feature',geometry:b.geom,
    properties:{id:b.id,stav:b.stav}}))};
  map.addSource('bf',{type:'geojson',data:bfData,promoteId:'id'});
  map.addLayer({id:'bf-plocha',type:'fill',source:'bf',paint:{
    'fill-color':['match',['get','stav'],'eia','#F3716D','plan','#FFFFFF','#B4B4B0'],
    'fill-opacity':['case',['boolean',['feature-state','vyber'],false],.75,['match',['get','stav'],'eia',.42,'plan',.7,.45]]}});
  map.addLayer({id:'bf-obrys',type:'line',source:'bf',paint:{'line-color':'#000',
    'line-width':['case',['boolean',['feature-state','vyber'],false],3.5,1.1]}});
  map.addSource('bf-bod',{type:'geojson',data:{type:'FeatureCollection',features:BF.map(b=>({type:'Feature',
    geometry:{type:'Point',coordinates:b.stred},properties:{id:b.id,nazov:b.nazov,ikona:'obor-'+b.typ+'-'+b.stav,ha:b.ha,
      poradie:(b.stav==='eia'?3:b.stav==='plan'?2:1)*1000+b.ha}}))}});
  /* Ikona sedí na bode, názov začína vpravo od nej — nikdy cez ňu (pôvodná
     verzia mala názov vycentrovaný na ikone a písmená sa prekrývali s obrom).
     Keď sa názov nezmestí, zmizne len názov, obor ostáva. */
  map.addLayer({id:'bf-ikona',type:'symbol',source:'bf-bod',layout:{
    'icon-image':['get','ikona'],'icon-size':['interpolate',['linear'],['zoom'],10,.5,13,.75,16,1],
    'icon-allow-overlap':true,'symbol-sort-key':['-',0,['get','poradie']],
    'text-field':['step',['zoom'],'',11.6,['get','nazov']],'text-font':['Noto Sans Regular'],
    'text-size':['interpolate',['linear'],['zoom'],11,12,15,15],'text-anchor':'left','text-justify':'left',
    'text-offset':['interpolate',['linear'],['zoom'],10,['literal',[1.2,0]],13,['literal',[1.5,0]],16,['literal',[1.7,0]]],
    'text-max-width':11,'text-optional':true},
    paint:{'text-color':'#000','text-halo-color':'rgba(255,255,255,.92)','text-halo-width':2}});

  /* zámery: zhluky s prstencom fáz ako na mape zámerov */
  const sucet=f=>['+',['case',['==',['get','faza'],f],1,0]];
  map.addSource('zamery',{type:'geojson',data:{type:'FeatureCollection',features:[]},cluster:true,clusterRadius:46,clusterMaxZoom:13,
    clusterProperties:{f1:sucet('zámer'),f2:sucet('posúdené'),f3:sucet('povolené'),f4:sucet('dokončené')}});
  map.addLayer({id:'zh',type:'circle',source:'zamery',filter:['has','point_count'],layout:{visibility:'none'},paint:{'circle-radius':1}});
  map.addLayer({id:'bod',type:'circle',source:'zamery',filter:['!',['has','point_count']],paint:{
    'circle-color':['match',['get','faza'],'zámer','#F3716D','posúdené','#000000','povolené','#FFFFFF','dokončené','#B4B4B0',SIVA],
    'circle-radius':['interpolate',['linear'],['zoom'],10,6,14,9,18,13],
    'circle-stroke-width':['case',['==',['get','hl'],1],4,1.8],'circle-stroke-color':['case',['==',['get','hl'],1],'#F3716D','#000']}});
  map.addLayer({id:'bod-txt',type:'symbol',source:'zamery',filter:['!',['has','point_count']],minzoom:14.5,
    layout:{'text-field':['get','nazov'],'text-font':['Noto Sans Regular'],'text-size':14,'text-anchor':'left',
      'text-offset':[1.2,0],'text-max-width':13,'text-optional':true},
    paint:{'text-color':'#000','text-halo-color':'#fff','text-halo-width':2}});
  /* zámery bez presnej polohy: čiarkovaný kruh na mestskú časť — nikdy bod v strede MČ */
  map.addSource('nez',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'nez',type:'symbol',source:'nez',maxzoom:12.5,layout:{'icon-image':'kruh','icon-allow-overlap':true,
    'text-allow-overlap':true,'icon-size':['interpolate',['linear'],['get','n'],1,.6,30,.9,120,1.3],
    'text-field':['to-string',['get','n']],'text-size':14,'text-font':['Noto Sans Regular']},paint:{'text-color':'#48484A'}},'bf-plocha');

  map.on('click','bod',e=>{ const id=e.features[0].properties.id; ukazZamer(Z.find(z=>z.id===id)); });
  map.on('click','bf-ikona',e=>vyberBF(e.features[0].properties.id));
  map.on('click','bf-plocha',e=>{ if(map.queryRenderedFeatures(e.point,{layers:['bod','bf-ikona']}).length) return;
    vyberBF(e.features[0].properties.id); });
  map.on('click','nez',e=>{ S.mc=e.features[0].properties.mc; S.rezim='pulz'; nastavRezim('pulz'); });
  map.on('render',()=>{ if(map.getSource('zamery')&&map.isSourceLoaded('zamery')) kresliDonuty(); });
}

/* ---------- čo je na mape ---------- */
function vyhovujeZamer(z){
  if(z.lin) return false;
  if(S.rezim==='kto'&&S.investor) return z.inv===S.investor;
  if(S.rezim==='objav'&&S.bf){ const b=BF.find(x=>x.id===S.bf); return !!b&&b.zamery.some(x=>x.id===z.id); }
  if(S.rezim==='pulz'){ if(!S.fazy.has(z.faza)) return false; if(S.mc&&z.obec!==S.mc) return false; }
  return true;
}
function obnovMapu(){
  if(!pripravene) return;
  const vid=S.ukazZamery?Z.filter(vyhovujeZamer):[];
  map.getSource('zamery').setData({type:'FeatureCollection',features:vid.filter(z=>z.presna&&z.xy).map(z=>({type:'Feature',
    geometry:{type:'Point',coordinates:z.xy},properties:{id:z.id,nazov:z.nazov,faza:z.faza,hl:S.zamer===z.id?1:0}}))});
  const pocty={};
  vid.filter(z=>!z.presna).forEach(z=>{ const k=klucMC(z.obec); if(TAZ[k]) pocty[k]=(pocty[k]||{n:0,mc:z.obec}), pocty[k].n++; });
  map.getSource('nez').setData({type:'FeatureCollection',features:Object.entries(pocty).map(([k,v])=>({type:'Feature',
    geometry:{type:'Point',coordinates:TAZ[k]},properties:{n:v.n,mc:v.mc}}))});
  const bfVid=S.ukazBF?'visible':'none';
  ['bf-plocha','bf-obrys','bf-ikona'].forEach(l=>map.setLayoutProperty(l,'visibility',bfVid));
  BF.forEach(b=>map.setFeatureState({source:'bf',id:b.id},{vyber:S.bf===b.id}));
  const mcZ=MC.features.find(f=>klucMC(f.properties.NAZOV_ZUJ)===klucMC(S.mc));
  map.setFilter('mc-vyber',['==',['get','NAZOV_ZUJ'],S.rezim==='pulz'&&mcZ?mcZ.properties.NAZOV_ZUJ:'']);
  kresliLegendu();
}

/* zhluky: čierna bublina s číslom a prstencom pomeru fáz */
const DONUTY={};
function kresliDonuty(){
  const vidno={}; let fs=[];
  try{ fs=map.querySourceFeatures('zamery',{filter:['has','point_count']}); }catch(e){}
  for(const f of fs){ const p=f.properties, id=p.cluster_id; if(vidno[id]) continue;
    const kluc=[p.point_count,p.f1,p.f2,p.f3,p.f4].join('|'); let d=DONUTY[id];
    if(!d||d.kluc!==kluc){ if(d) d.marker.remove();
      const el=donut(p); el.onclick=ev=>{ ev.stopPropagation();
        map.getSource('zamery').getClusterExpansionZoom(id).then(zz=>map.easeTo({center:f.geometry.coordinates,zoom:zz+.4})); };
      d=DONUTY[id]={kluc:kluc,marker:new maplibregl.Marker({element:el}).setLngLat(f.geometry.coordinates)}; }
    if(!d.naMape){ d.marker.addTo(map); d.naMape=true; } vidno[id]=1; }
  for(const id in DONUTY) if(!vidno[id]&&DONUTY[id].naMape){ DONUTY[id].marker.remove(); DONUTY[id].naMape=false; }
}
function donut(p){
  const n=p.point_count, r=n<5?13:n<10?16:n<20?19:n<50?23:28, R=r+5, S2=2*(r+8), c=S2/2, w=3.6;
  const casti=[['zámer',p.f1],['posúdené',p.f2],['povolené',p.f3],['dokončené',p.f4]], spolu=casti.reduce((s,x)=>s+(+x[1]||0),0);
  let a=-Math.PI/2, vys='';
  casti.forEach(([f,k])=>{ k=+k||0; if(!k||!spolu) return; const q=k/spolu;
    if(q>=.999){ vys+='<circle cx="'+c+'" cy="'+c+'" r="'+R+'" fill="none" stroke="'+FARBA[f]+'" stroke-width="'+w+'"/>'; return; }
    const b=a+2*Math.PI*q;
    vys+='<path d="M'+(c+R*Math.cos(a)).toFixed(2)+' '+(c+R*Math.sin(a)).toFixed(2)+' A'+R+' '+R+' 0 '+(q>.5?1:0)+' 1 '
      +(c+R*Math.cos(b)).toFixed(2)+' '+(c+R*Math.sin(b)).toFixed(2)+'" fill="none" stroke="'+FARBA[f]+'" stroke-width="'+w+'"/>'; a=b; });
  const el=document.createElement('div'); el.className='donut';
  el.innerHTML='<svg width="'+S2+'" height="'+S2+'"><circle cx="'+c+'" cy="'+c+'" r="'+R+'" fill="none" stroke="#D9D9D6" stroke-width="'+w+'"/>'+vys
    +'<circle cx="'+c+'" cy="'+c+'" r="'+(R-w/2-.4)+'" fill="none" stroke="#000" stroke-width=".8"/>'
    +'<circle cx="'+c+'" cy="'+c+'" r="'+(R+w/2+.4)+'" fill="none" stroke="#000" stroke-width=".8"/>'
    +'<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="#000"/><text x="'+c+'" y="'+c+'" text-anchor="middle" dominant-baseline="central" font-size="'
    +(n<10?13:15)+'">'+n+'</text></svg>';
  return el;
}

/* ---------- legenda ---------- */
function kresliLegendu(){
  let h='';
  if(S.ukazZamery) h+='<span class="nadpis">Zámery</span>'+FAZY.map(([f,c])=>'<span class="r"><span class="bod" style="background:'+c+'"></span>'+f+'</span>').join('')
    +'<span class="r"><span class="kruh"></span>bez presnej polohy</span>';
  if(S.ukazBF) h+='<span class="nadpis">Brownfieldy</span>'+['spi','plan','eia'].map(s=>'<span class="r">'+obor('priemysel',s,30)+STAV[s].nazov+'</span>').join('');
  $('#legenda').innerHTML=h; $('#legenda').hidden=!h;
}

/* ---------- PULZ ---------- */
function pulz(){
  const vid=Z.filter(z=>!z.lin&&(!S.mc||z.obec===S.mc));
  const vf=vid.filter(z=>S.fazy.has(z.faza));
  const presne=vf.filter(z=>z.presna).length;
  const poMC={}; Z.filter(z=>!z.lin&&S.fazy.has(z.faza)).forEach(z=>{ if(z.obec) poMC[z.obec]=(poMC[z.obec]||0)+1; });
  const mcs=Object.entries(poMC).sort((a,b)=>b[1]-a[1]), max=mcs.length?mcs[0][1]:1;
  return '<p class="stitok">Pulz mesta · register EIA</p>'
    +'<h2>'+(S.mc?esc(S.mc):'Kde a kedy sa stavia')+'</h2>'
    +'<div class="cifry"><div class="cifra"><b>'+cis(vf.length)+'</b><span>'+sklon(vf.length,'zámer','zámery','zámerov')+(S.mc?' v mestskej časti':' v meste')+'</span></div>'
    +'<div class="cifra"><b>'+cis(presne)+'</b><span>s presnou polohou</span></div>'
    +'<div class="cifra"><b class="cervena">'+cis(vf.length-presne)+'</b><span>len mestská časť — na mape čiarkovaný kruh</span></div></div>'
    +'<div class="fazy" id="fazy">'+FAZY.map(([f,c])=>'<button data-f="'+f+'" class="'+(S.fazy.has(f)?'':'off')+'" aria-pressed="'+S.fazy.has(f)+'">'
      +'<b><span class="bod" style="background:'+c+'"></span>'+cis(vid.filter(z=>z.faza===f).length)+'</b>'+f+'</button>').join('')+'</div>'
    +'<div class="graf"><p class="stitok" style="margin-bottom:8px">Posledná udalosť v registri podľa roku</p>'+graf(vf)+'</div>'
    +'<div class="skrol"><div class="riadky">'
      +(S.mc?'<button class="riadok" data-mc=""><span>← Celé mesto</span><b></b></button>':'')
      +mcs.map(([m,n])=>'<button class="riadok'+(m===S.mc?' on':'')+'" data-mc="'+esc(m)+'"><span>'+esc(m)+'</span><b>'+n+'</b>'
        +'<span class="pas"><i style="width:'+(100*n/max).toFixed(1)+'%"></i></span></button>').join('')+'</div></div>'
    +'<p class="pozn">Rok je dátum poslednej zmeny konania v registri EIA, nie začiatok stavby. Líniové stavby (cesty, trate, siete) sú mimo mapy aj čísel.</p>';
}
function graf(vf){
  const od=2008, roky=[]; let mx=1; const teraz=new Date().getFullYear();
  for(let r=od;r<=teraz;r++){ const v=vf.filter(z=>z.rok===r); const k=FAZY.map(([f])=>v.filter(z=>z.faza===f).length);
    roky.push([r,k]); mx=Math.max(mx,v.length); }
  const W=536, H=150, B=24, sw=W/roky.length, hk=(H-B-8)/mx;
  let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Počet zámerov podľa roku">';
  roky.forEach(([r,k],i)=>{ let y=H-B; k.forEach((n,j)=>{ if(!n) return; const h=n*hk; y-=h;
      s+='<rect x="'+(i*sw+2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(sw-4).toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+FAZY[j][1]+'" stroke="#000" stroke-width=".8"/>'; });
    if(r%4===0||r===teraz) s+='<text x="'+(i*sw+sw/2).toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+r+'</text>'; });
  s+='<line class="os" x1="0" x2="'+W+'" y1="'+(H-B)+'" y2="'+(H-B)+'"/><text x="0" y="12">'+mx+'</text></svg>';
  return s;
}

/* ---------- OBJAV ---------- */
const BF_FILTRE=[['','Všetky'],['eia','zámer v EIA'],['plan','plán 2022'],['spi','spí']];
function objav(){
  if(S.bf) return detailBF(BF.find(b=>b.id===S.bf));
  const q=bezDiak(S.q.trim());
  const zoz=BF.filter(b=>(!S.bfFilter||b.stav===S.bfFilter)
      && (!q||(/^\d+$/.test(q)?b.id===q:bezDiak(b.nazov+' '+b.mc+' '+b.adresa+' '+b.zona).includes(q))))
    .sort((a,b)=>({eia:0,plan:1,spi:2}[a.stav]-{eia:0,plan:1,spi:2}[b.stav])||b.ha-a.ha);
  const ha=zoz.reduce((s,b)=>s+b.ha,0);
  return '<p class="stitok">Brownfieldy · register MIB, edícia 2022</p>'
    +'<h2>Nevyužité územia</h2>'
    +'<div class="hladaj"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
      +'<input id="q" type="search" inputmode="search" autocomplete="off" placeholder="Názov, mestská časť alebo číslo" value="'+esc(S.q)+'">'
      +(S.q?'<button class="zmaz" id="zmaz" aria-label="Vymazať">×</button>':'')+'</div>'
    +'<div class="filtre">'+BF_FILTRE.map(([k,t])=>'<button data-bff="'+k+'" class="'+(S.bfFilter===k?'on':'')+'">'
      +(k?obor('ine',k,24):'')+t+' <b>'+BF.filter(b=>!k||b.stav===k).length+'</b></button>').join('')+'</div>'
    +'<p class="tlm" style="font-size:15px">'+zoz.length+' '+sklon(zoz.length,'územie','územia','území')+' · '+des(ha.toFixed(1))+' ha evidovanej výmery</p>'
    +'<div class="skrol"><div class="zoznam">'+(zoz.length?zoz.map(b=>'<button class="uzemie" data-bf="'+esc(b.id)+'">'
      +'<span class="obor">'+obor(b.typ,b.stav,52)+'</span>'
      +'<span><span class="n">'+esc(b.nazov)+'</span><span class="m">'+esc(b.mc)+(b.stav==='eia'?' · '+b.zamery_pocet+' '+sklon(b.zamery_pocet,'zámer','zámery','zámerov')+' v EIA':'')+'</span></span>'
      +'<span class="ha">'+des(b.ha)+' ha</span></button>').join('')
      :'<p class="tlm" style="padding:20px 0">Nič sa nenašlo. Skús iný názov alebo zruš filter.</p>')+'</div></div>'
    +'<p class="pozn">Výmera je súčet evidovaných hodnôt z registra, nie plocha z geometrie. Register je z roku 2022, dáta v službe naposledy upravené '
      +esc(fmtDatum(BF.zdroj.upravene))+'. Prienik so zámermi EIA počítame len zo zámerov s polohou na pozemku, preto je to spodný odhad.</p>';
}
function fmtDatum(d){ if(!d) return 'neuvedené'; const [y,m,dd]=d.split('-'); return (+dd)+'. '+(+m)+'. '+y; }
function riadok(k,v){ return '<div class="r"><span class="k">'+k+'</span>'+(v?'<span class="v">'+v+'</span>':'<span class="v chyba">register neuvádza</span>')+'</div>'; }
function detailBF(b){
  if(!b) return '';
  const st={eia:['eia','Dnes je tu zámer v EIA'],plan:['plan','V roku 2022 sa tu plánovalo'],spi:['spi','Spí — o zámere nevieme']}[b.stav];
  const inv=b.investori||[];
  return '<button class="spat" id="spat">← Všetky územia</button>'
    +'<div class="hlava"><span class="obor">'+obor(b.typ,b.stav,104)+'</span><div>'
      +'<span class="stav '+st[0]+'">'+st[1]+'</span><h2 style="margin-top:10px">'+esc(b.nazov)+'</h2></div></div>'
    +'<div class="skrol" style="display:flex;flex-direction:column;gap:18px">'
    +'<div class="udaje">'+riadok('Mestská časť',esc(b.mc))+riadok('Výmera',des(b.ha)+' ha')
      +riadok('Vlastník',esc(b.vlastnik))+riadok('Pôvodne',esc(b.vyuzitie))+riadok('Územný plán',esc(b.ciel))
      +(b.zataz?riadok('Záťaž','<b style="font-weight:500">evidovaná environmentálna záťaž</b>'):'')
      +(b.pamiatka?riadok('Pamiatka',esc(b.pamiatka)):'')+(b.zona?riadok('Zóna',esc(b.zona)):'')
      +riadok('Evidenčné číslo',esc(b.id))+'</div>'
    +'<div class="blok"><p class="stitok">Čo o zámere vedel register v roku 2022</p><p>'
      +(b.zamer_2022?esc(b.zamer_2022):'<span class="tlm">Nič. Register uvádza „nezistený".</span>')+'</p></div>'
    +'<div class="blok'+(b.zamery.length?' cerveny':'')+'"><p class="stitok">Čo sa deje dnes · register EIA</p>'
      +(b.zamery.length?b.zamery.map(z=>'<button class="zamer" data-zamer="'+esc(z.id)+'"><span class="bod" style="background:'+(FARBA[z.faza]||SIVA)+'"></span>'
        +'<span>'+esc(z.nazov)+'</span><span class="m">'+esc(z.faza)+(z.rok?' · '+z.rok:'')+(z.firma?' · '+esc(cistyNazov(z.firma)):'')+'</span></button>').join('')
        :'<p class="tlm">Na pozemku nie je žiadny zámer s presnou polohou. Môže tu byť zámer, ktorého polohu nepoznáme.</p>')+'</div>'
    +(inv.length?'<div class="blok"><p class="stitok">Kto za tým stojí</p>'+inv.map(i=>{ const k=i.ico||('bez:'+bezDiak(cistyNazov(i.firma)));
        return '<button class="investor" data-inv="'+esc(k)+'"><span class="n">'+esc(cistyNazov(i.firma))+'</span><span class="pocet">'+((INV_IDX[k]||{}).n||i.n)+'</span>'
          +'<span class="m">'+(i.ico?'IČO '+esc(i.ico):'bez IČO')+(i.skupina?' · skupina '+esc(i.skupina):'')+' · všetky zámery v meste →</span></button>'; }).join('')+'</div>':'')
    +'</div>'+qrBlok(b.zamery.length?WEB+'?id='+encodeURIComponent(b.zamery[0].id):BF_WEB,
      b.zamery.length?'Zámer si otvor v mobile — výkresy, dokumenty a celý spis.':'Celý register brownfieldov MIB s mapou a štúdiou.');
}

/* ---------- KTO STAVIA ---------- */
function kto(){
  if(S.investor) return detailInv(INV_IDX[S.investor]);
  const q=bezDiak(S.q.trim());
  const zoz=INV.filter(i=>!q||(/^\d+$/.test(q)?i.ico.startsWith(q):bezDiak(i.nazov+' '+i.skupina).includes(q)));
  const viac=INV.filter(i=>i.zapisov>1).length, ico=INV.filter(i=>i.ico).length;
  return '<p class="stitok">Investori · podľa IČO zo spisov EIA</p><h2>Kto stavia</h2>'
    +'<div class="cifry"><div class="cifra"><b>'+cis(ico)+'</b><span>investorov s IČO</span></div>'
    +'<div class="cifra"><b>'+cis(viac)+'</b><span>zapísaných viacerými spôsobmi, tu zlúčených</span></div>'
    +'<div class="cifra"><b class="cervena">'+cis(Z.filter(z=>!z.ico).length)+'</b><span>zámerov bez IČO v spise</span></div></div>'
    +'<div class="hladaj"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
      +'<input id="q" type="search" inputmode="search" autocomplete="off" placeholder="Firma, skupina alebo IČO" value="'+esc(S.q)+'">'
      +(S.q?'<button class="zmaz" id="zmaz" aria-label="Vymazať">×</button>':'')+'</div>'
    +'<div class="skrol"><div>'+zoz.slice(0,80).map(i=>'<button class="investor" data-inv="'+esc(i.k)+'">'
      +'<span class="n">'+esc(i.nazov)+'</span><span class="pocet">'+i.n+'</span>'
      +'<span class="m"><span class="mini">'+i.fazy.map((n,j)=>('<i style="background:'+FAZY[j][1]+'"></i>').repeat(Math.min(n,8))).join('')+'</span>'
        +(i.ico?'IČO '+esc(i.ico):'bez IČO')+(i.skupina?' · '+esc(i.skupina):'')+(i.bf?' · '+i.bf+' brownfield':'')+'</span></button>').join('')
      +(zoz.length>80?'<p class="pozn" style="padding:14px 0">Ďalších '+(zoz.length-80)+' — spresni hľadanie.</p>':'')+'</div></div>'
    +'<p class="pozn">Názov investora je najčastejší zápis v spisoch bez adresy. Skupina je doložená značkou alebo známym IČO, inak ide o zhodu sídla.</p>';
}
function detailInv(i){
  if(!i) return '';
  const zz=[...i.zamery].sort((a,b)=>(b.rok||0)-(a.rok||0)), mimo=zz.filter(z=>!z.presna&&!z.lin).length;
  const zapisy=Object.keys(i.zapisy);
  return '<button class="spat" id="spat">← Všetci investori</button>'
    +'<p class="stitok">'+(i.ico?'IČO '+esc(i.ico):'bez IČO')+(i.skupina?' · skupina '+esc(i.skupina):'')+'</p>'
    +'<h2>'+esc(i.nazov)+'</h2>'
    +'<div class="cifry"><div class="cifra"><b>'+i.n+'</b><span>'+sklon(i.n,'zámer','zámery','zámerov')+' v Bratislave</span></div>'
    +'<div class="cifra"><b>'+i.fazy[2]+'</b><span>povolené</span></div>'
    +'<div class="cifra"><b class="cervena">'+mimo+'</b><span>bez presnej polohy</span></div></div>'
    +(zapisy.length>1?'<p class="pozn">V spisoch zapísaný '+zapisy.length+' spôsobmi: '+zapisy.slice(0,4).map(esc).join(' · ')+(zapisy.length>4?' …':'')+'</p>':'')
    +'<div class="skrol"><div class="blok">'+zz.map(z=>'<button class="zamer" data-zamer="'+esc(z.id)+'"><span class="bod" style="background:'+(FARBA[z.faza]||SIVA)+'"></span>'
      +'<span>'+esc(z.nazov)+'</span><span class="m">'+esc(z.faza||'—')+(z.rok?' · '+z.rok:'')+' · '+esc(z.obec)+(z.presna?'':' · poloha len podľa MČ')+'</span></button>').join('')+'</div></div>'
    +qrBlok(WEB+'?id='+encodeURIComponent(zz[0].id),'Celý dossier investora a spisy otvoríš v mobile.');
}

/* ---------- karta zámeru (z mapy alebo zo zoznamu) ---------- */
let predZamerom=null;
function ukazZamer(z){
  if(!z) return; predZamerom=predZamerom||{rezim:S.rezim}; S.zamer=z.id; obnovMapu();
  const i=INV_IDX[z.inv];
  $('#obsah').innerHTML='<button class="spat" id="spat-z">← Späť</button>'
    +'<p class="stitok">'+esc(z.typ)+' · '+esc(z.obec)+'</p><h2>'+esc(z.nazov)+'</h2>'
    +'<div class="udaje">'+riadok('Fáza',z.faza?'<span class="bod" style="background:'+FARBA[z.faza]+';margin-right:8px;vertical-align:-1px"></span>'+esc(z.faza):'')
      +riadok('Investor',z.firma?esc(cistyNazov(z.firma))+(z.ico?' · IČO '+esc(z.ico):''):'')
      +(z.skupina?riadok('Skupina',esc(z.skupina)):'')+riadok('Posledná zmena',z.rok?String(z.rok):'')
      +riadok('Poloha',z.presna?'na mape presne':'len mestská časť — presné miesto spis neuvádza')+'</div>'
    +(i&&i.n>1?'<button class="investor" data-inv="'+esc(i.k)+'"><span class="n">Čo ešte chystá '+esc(i.nazov)+'</span><span class="pocet">'+(i.n-1)+'</span>'
      +'<span class="m">ďalších zámerov v meste →</span></button>':'')
    +'<div style="flex:1"></div>'+qrBlok(WEB+'?id='+encodeURIComponent(z.id),'Výkresy, vizualizácie a celý spis EIA otvoríš v mobile.');
  if(z.presna&&z.xy) map.easeTo({center:z.xy,zoom:Math.max(map.getZoom(),15),offset:[0,0]});
  dokresliQR();
}

/* QR: obrazovka je verejná, nič sa na nej neprihlasuje — pokračovanie je v mobile */
function qrBlok(url,txt){ return '<div class="qr"><div class="kod" data-qr="'+esc(url)+'"></div><p>'+esc(txt)+'</p></div>'; }
function dokresliQR(){ document.querySelectorAll('[data-qr]').forEach(el=>{
  if(el.dataset.ok||typeof QRCode==='undefined') return; el.dataset.ok=1;
  try{ new QRCode(el,{text:el.dataset.qr,width:240,height:240,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}); }
  catch(e){ el.closest('.qr').hidden=true; } }); }

/* ---------- prepínanie ---------- */
function kresliPanel(){
  predZamerom=null; S.zamer=null;
  $('#obsah').innerHTML=S.rezim==='pulz'?pulz():S.rezim==='objav'?objav():kto();
  dokresliQR(); obnovMapu();
}
function nastavRezim(r){
  if(r!==S.rezim){ S.q=''; }
  S.rezim=r; document.querySelectorAll('#rezimy button').forEach(b=>{ b.classList.toggle('on',b.dataset.rezim===r); b.setAttribute('aria-current',b.dataset.rezim===r?'page':'false'); });
  if(r==='objav'){ S.ukazBF=true; }
  syncVrstvy(); kresliPanel();
}
function vyberBF(id){
  const b=BF.find(x=>x.id===id); if(!b) return;
  S.rezim='objav'; S.bf=id; nastavRezim('objav');
  const g=b.geom, kr=g.type==='Polygon'?g.coordinates[0]:g.coordinates.flatMap(p=>p[0]);
  const xs=kr.map(c=>c[0]), ys=kr.map(c=>c[1]);
  map.fitBounds([[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]],{padding:120,maxZoom:16.2,duration:900});
}
function vyberInv(k){
  S.rezim='kto'; S.investor=k; S.bf=null; nastavRezim('kto');
  const i=INV_IDX[k]; if(!i) return; const b=i.zamery.filter(z=>z.presna&&z.xy).map(z=>z.xy);
  if(b.length===1) map.easeTo({center:b[0],zoom:15});
  else if(b.length) map.fitBounds([[Math.min(...b.map(x=>x[0])),Math.min(...b.map(x=>x[1]))],
    [Math.max(...b.map(x=>x[0])),Math.max(...b.map(x=>x[1]))]],{padding:140,maxZoom:15,duration:900});
}
function syncVrstvy(){
  [['#v-zamery','ukazZamery'],['#v-bf','ukazBF']].forEach(([s,k])=>{ $(s).classList.toggle('on',S[k]); $(s).setAttribute('aria-pressed',S[k]); });
}

/* jeden poslucháč na panel — obsah sa prekresľuje, tlačidlá sa menia */
$('#obsah').addEventListener('click',e=>{
  const t=e.target.closest('button'); if(!t) return;
  if(t.id==='spat'){ S.bf=null; S.investor=null; kresliPanel(); map.easeTo(Object.assign({duration:800},DOMOV)); return; }
  if(t.id==='spat-z'){ const r=predZamerom; predZamerom=null; S.zamer=null; if(r) S.rezim=r.rezim; kresliPanel(); return; }
  if(t.id==='zmaz'){ S.q=''; kresliPanel(); return; }
  if(t.dataset.f){ const f=t.dataset.f; if(S.fazy.has(f)&&S.fazy.size>1) S.fazy.delete(f); else S.fazy.add(f); kresliPanel(); return; }
  if(t.dataset.mc!==undefined){ S.mc=S.mc===t.dataset.mc?'':t.dataset.mc; kresliPanel(); letNaMC(); return; }
  if(t.dataset.bff!==undefined){ S.bfFilter=t.dataset.bff; kresliPanel(); return; }
  if(t.dataset.bf){ vyberBF(t.dataset.bf); return; }
  if(t.dataset.inv){ vyberInv(t.dataset.inv); return; }
  if(t.dataset.zamer){ ukazZamer(Z.find(z=>z.id===t.dataset.zamer)); return; }
});
/* písanie do hľadania prekreslí len zoznam, nie pole — inak by vyskočila klávesnica */
$('#obsah').addEventListener('input',e=>{ if(e.target.id!=='q') return; S.q=e.target.value;
  const poz=e.target.selectionStart; kresliPanel(); const q=$('#q'); if(q){ q.focus(); q.setSelectionRange(poz,poz); } });
function letNaMC(){
  if(!S.mc){ map.easeTo(Object.assign({duration:800},DOMOV)); return; }
  const f=MC.features.find(x=>klucMC(x.properties.NAZOV_ZUJ)===klucMC(S.mc)); if(!f) return;
  const kr=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates.flatMap(p=>p[0]);
  map.fitBounds([[Math.min(...kr.map(c=>c[0])),Math.min(...kr.map(c=>c[1]))],[Math.max(...kr.map(c=>c[0])),Math.max(...kr.map(c=>c[1]))]],{padding:80,duration:900});
}
document.querySelectorAll('#rezimy button').forEach(b=>b.onclick=()=>{ S.bf=null; S.investor=null; nastavRezim(b.dataset.rezim); });
$('#v-zamery').onclick=()=>{ S.ukazZamery=!S.ukazZamery; syncVrstvy(); obnovMapu(); if(!S.ukazZamery) kresliDonuty(); };
$('#v-bf').onclick=()=>{ S.ukazBF=!S.ukazBF; syncVrstvy(); obnovMapu(); };
$('#tl-plus').onclick=()=>map.zoomIn(); $('#tl-minus').onclick=()=>map.zoomOut();
$('#tl-domov').onclick=()=>map.easeTo(Object.assign({duration:800},DOMOV));

/* ---------- úvod a nečinnosť ---------- */
let casovac=null;
function uvodCisla(){
  const eia=BF.filter(b=>b.eia).length;
  $('#uvod-cisla').innerHTML='<div class="cifra"><b>'+cis(Z.length)+'</b><span>stavebných zámerov v registri EIA</span></div>'
    +'<div class="cifra"><b>'+cis(INV.filter(i=>i.ico).length)+'</b><span>investorov podľa IČO</span></div>'
    +'<div class="cifra"><b>'+BF.length+'</b><span>brownfieldov v registri MIB 2022</span></div>'
    +'<div class="cifra"><b class="cervena">'+eia+'</b><span>z nich má dnes zámer v EIA</span></div>';
}
function naUvod(){ $('#uvod').hidden=false; S.bf=null; S.investor=null; S.mc=''; S.q=''; S.bfFilter='';
  S.fazy=new Set(FAZY.map(f=>f[0])); S.ukazZamery=S.ukazBF=true; if(document.activeElement) document.activeElement.blur();
  nastavRezim('pulz'); map.jumpTo(DOMOV); }
function budik(){ clearTimeout(casovac); casovac=setTimeout(naUvod,NECINNOST); }
['pointerdown','keydown','wheel'].forEach(t=>document.addEventListener(t,budik,{passive:true}));
$('#uvod').addEventListener('click',()=>{ $('#uvod').hidden=true; budik(); });
$('#uvod').addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' ') $('#uvod').hidden=true; });

/* ---------- štart ----------
   Podklad z geoportálu býva pomalý; vrstvy s dátami sa pridajú hneď po
   načítaní štýlu, nečaká sa na dlaždice. */
let spustene=false;
async function spusti(){
  if(spustene) return; spustene=true;
  try{ pridajPodklad(); }catch(e){ console.warn('podklad:',e.message); }
  let z,bf,mc,red,naz;
  try{ [z,bf,mc,red,naz]=await DATA; }
  catch(e){ $('#obsah').innerHTML='<h2>Dáta sa nenačítali</h2><p class="tlm">'+esc(e.message)+'</p>'; return; }
  priprav(z,bf,mc,red,naz);
  await pridajIkony(); pridajVrstvy(); pripravene=true;
  uvodCisla(); kresliPanel();
  const p=new URLSearchParams(location.search);
  if(p.get('uvod')==='0') $('#uvod').hidden=true;
  if(p.get('rezim')) nastavRezim(p.get('rezim'));
  if(p.get('bf')) vyberBF(p.get('bf'));
  if(p.get('inv')) vyberInv(p.get('inv'));
}
map.on('style.load',spusti); map.on('load',spusti);
const hliadka=setInterval(()=>{ if(spustene){ clearInterval(hliadka); return; }
  try{ if(map.getStyle()&&map.getStyle().layers.length){ clearInterval(hliadka); spusti(); } }catch(e){} },700);
