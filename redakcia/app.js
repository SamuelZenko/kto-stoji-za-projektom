/* Redakcia mapy — dopĺňanie polôh, obrázkov a údajov k zámerom.
   Číta tie isté súbory ako mapa, zmeny drží v prehliadači (localStorage +
   IndexedDB pre obrázky) a na jedno tlačidlo ich zapíše do repozitára cez
   GitHub API (jeden commit: redakcia.json + obrázky). Token si vkladá
   používateľ sám, ostáva v jeho prehliadači. */
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>(s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cis=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,' ');
const REPO='SamuelZenko/kto-stoji-za-projektom', VETVA='main';
const MAPA='../mapa-zamerov/';
const FAZY=['zámer','posúdené','povolené','dokončené'];
const G='https://geoportal.bratislava.sk/hSite/rest/services';
const K_DRAFT='mib-redakcia-draft', K_TOKEN='mib-redakcia-token', K_KTO='mib-redakcia-kto';

let Z=[], RED={zamery:{},nove:{}}, DRAFT={zamery:{},nove:{}}, TYPY=[], OBCE=[], TAZISKA={};
let filtr={q:'',f:'',mc:''}, vybrane=null, limit=250;
const URLS={};                       // cesta obrázka → objectURL náhľadu

/* ---------- úložisko konceptu ---------- */
try{ DRAFT=Object.assign({zamery:{},nove:{}},JSON.parse(localStorage.getItem(K_DRAFT)||'{}')); }catch(e){}
function ulozDraft(){
  try{ localStorage.setItem(K_DRAFT,JSON.stringify(DRAFT)); }
  catch(e){ toast('Koncept sa nezmestil do prehliadača — ulož na GitHub.'); }
  const n=Object.keys(DRAFT.zamery).length+Object.keys(DRAFT.nove).length;
  $('#poc-zmien').textContent=n; $('#tl-uloz').disabled=!n;
}
/* obrázky v IndexedDB — localStorage má 5 MB, jedna fotka by ho zaplnila */
const IDB={
  db:null,
  open(){ return this.db?Promise.resolve(this.db):new Promise((ok,zle)=>{
    const r=indexedDB.open('mib-redakcia',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('obr');
    r.onsuccess=()=>{ this.db=r.result; ok(this.db); }; r.onerror=()=>zle(r.error); }); },
  async tx(mode,fn){ const db=await this.open(); return new Promise((ok,zle)=>{
    const t=db.transaction('obr',mode), rq=fn(t.objectStore('obr'));
    rq.onsuccess=()=>ok(rq.result); rq.onerror=()=>zle(rq.error); }); },
  put(k,v){ return this.tx('readwrite',s=>s.put(v,k)); },
  get(k){ return this.tx('readonly',s=>s.get(k)); },
  del(k){ return this.tx('readwrite',s=>s.delete(k)); },
};

/* ---------- dáta ---------- */
const ber=(s,zal)=>fetch(MAPA+s,{cache:'no-cache'}).then(r=>{ if(!r.ok) throw new Error(s); return r.json(); }).catch(e=>{ if(zal===undefined) throw e; return zal; });
async function nacitaj(){
  const [z,red,mc]=await Promise.all([ber('zamery.geojson'),ber('redakcia.json',{zamery:{},nove:{}}),ber('mestske-casti.geojson',null)]);
  Z=z.features.filter(f=>!f.properties.lin).map(f=>Object.assign({},f.properties,{sur:f.geometry.coordinates}));
  RED={zamery:red.zamery||{},nove:red.nove||{}};
  const pc={}; Z.forEach(p=>{ pc[p.typ||'Iné']=(pc[p.typ||'Iné']||0)+1; });
  TYPY=Object.keys(pc).sort((a,b)=>pc[b]-pc[a]);
  OBCE=[...new Set(Z.map(p=>p.obec).filter(Boolean))].sort();
  OBCE.forEach(o=>$('#mc').insertAdjacentHTML('beforeend','<option>'+esc(o)+'</option>'));
  if(mc) mc.features.forEach(f=>{ const a=f.properties||{}, nz=a.NAZOV_ZUJ||a.MC_LABEL||''; if(!nz||!f.geometry) return;
    const g=f.geometry, kr=g.type==='Polygon'?g.coordinates[0]:g.coordinates.reduce((x,y)=>y[0].length>x.length?y[0]:x,[]);
    TAZISKA[nz]=[kr.reduce((s,c)=>s+c[0],0)/kr.length, kr.reduce((s,c)=>s+c[1],0)/kr.length]; });
  const p=new URLSearchParams(location.search);
  if(p.get('mc')&&OBCE.includes(p.get('mc'))){ $('#mc').value=p.get('mc'); filtr.mc=p.get('mc'); nastavChip('bez-polohy'); }
  ulozDraft(); kresliZoznam();
  if(p.get('id')) vyber(p.get('id'));
}

/* záznam = publikované + rozpracované; rozpracovaný záznam je vždy celý */
const zaznam=(id)=>{ const n=id.startsWith('r-')?'nove':'zamery'; return DRAFT[n][id]||RED[n][id]||null; };
const jeNovy=id=>id.startsWith('r-');
const maPolohu=p=>{ const r=zaznam(p.id); return !!(r&&r.poloha)||p.presnost==='presná'; };
const maObrazok=p=>{ const r=zaznam(p.id); return !!(r&&r.obrazky&&r.obrazky.length); };
/* zoznam položiek: nové z redakcie navrch, potom register */
function polozky(){
  const nove=Object.assign({},RED.nove,DRAFT.nove);
  const n=Object.keys(nove).map(id=>Object.assign({id,novy:1},nove[id],{nazov:nove[id].nazov||'(bez názvu)',obec:nove[id].obec||'',typ:nove[id].typ||''}));
  return n.concat(Z);
}
function vyhovuje(p){
  if(filtr.mc && p.obec!==filtr.mc) return false;
  if(filtr.f==='bez-polohy' && maPolohu(p)) return false;
  if(filtr.f==='bez-obrazka' && (maObrazok(p)||(p.nahlady&&p.nahlady.length))) return false;
  if(filtr.f==='rozpracovane' && !(DRAFT.zamery[p.id]||DRAFT.nove[p.id])) return false;
  if(filtr.f==='redakcia' && !(RED.zamery[p.id]||RED.nove[p.id]||DRAFT.zamery[p.id]||DRAFT.nove[p.id])) return false;
  if(filtr.f==='nove' && !p.novy) return false;
  if(filtr.q){ const h=(p.nazov+' '+(zaznam(p.id)||{}).nazov+' '+(p.firma||'')+' '+(p.ico||'')+' '+(p.skupina||'')+' '+p.obec).toLowerCase(); if(!h.includes(filtr.q)) return false; }
  return true;
}
function kresliZoznam(){
  const vs=polozky(), v=vs.filter(vyhovuje);
  /* počty na čipoch — bez hľadaného textu, nech vidno, čo ostáva celkovo */
  const poc={'':vs.length,'bez-polohy':0,'bez-obrazka':0,'rozpracovane':0,'redakcia':0,'nove':0};
  vs.forEach(p=>{ if(!maPolohu(p)) poc['bez-polohy']++; if(!maObrazok(p)&&!(p.nahlady&&p.nahlady.length)) poc['bez-obrazka']++;
    if(DRAFT.zamery[p.id]||DRAFT.nove[p.id]) poc.rozpracovane++; if(RED.zamery[p.id]||RED.nove[p.id]||DRAFT.zamery[p.id]||DRAFT.nove[p.id]) poc.redakcia++; if(p.novy) poc.nove++; });
  $('#chipy').querySelectorAll('button').forEach(b=>b.querySelector('b').textContent=cis(poc[b.dataset.f]||0));
  $('#pocet').textContent=cis(v.length)+(v.length===1?' zámer':v.length<5?' zámery':' zámerov');
  $('#zoznam').innerHTML=v.slice(0,limit).map(p=>{
    const r=zaznam(p.id)||{}, zm=DRAFT.zamery[p.id]||DRAFT.nove[p.id];
    return '<div class="pol" data-id="'+esc(p.id)+'" aria-selected="'+(p.id===vybrane)+'">'
      +'<div class="n">'+esc(r.nazov||p.nazov)+'</div>'
      +'<div class="m">'+esc((p.obec||'').replace('Bratislava - ',''))+(p.typ?' · '+esc(p.typ):'')+(p.novy?' · nový':'')+'</div>'
      +'<div class="z"><span class="st"><i class="ik poloha'+(maPolohu(p)?'':' nie')+'" title="poloha"></i><i class="ik obr'+((maObrazok(p)||(p.nahlady&&p.nahlady.length))?'':' nie')+'" title="obrázok"></i>'+(zm?'<i class="ik zmena" title="rozpracované"></i>':'')+'</span></div>'
      +'</div>'; }).join('')
    +(v.length>limit?'<button class="tl viac" id="viac">Zobraziť ďalších '+cis(Math.min(250,v.length-limit))+'</button>':'');
  const b=$('#viac'); if(b) b.onclick=()=>{ limit+=250; kresliZoznam(); };
}
$('#zoznam').addEventListener('click',e=>{ const el=e.target.closest('.pol'); if(el) vyber(el.dataset.id); });
$('#q').addEventListener('input',()=>{ filtr.q=$('#q').value.trim().toLowerCase(); limit=250; kresliZoznam(); });
$('#mc').addEventListener('input',()=>{ filtr.mc=$('#mc').value; limit=250; kresliZoznam(); });
function nastavChip(f){ filtr.f=f; limit=250; $('#chipy').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.f===f)); }
$('#chipy').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; nastavChip(b.dataset.f); kresliZoznam(); });

/* ---------- editor ---------- */
function polozka(id){ return polozky().find(p=>p.id===id)||null; }
/* prvá úprava skopíruje publikovaný záznam do konceptu — koncept je vždy celý záznam */
function rozprac(id){
  const n=jeNovy(id)?'nove':'zamery';
  if(!DRAFT[n][id]) DRAFT[n][id]=JSON.parse(JSON.stringify(RED[n][id]||{}));
  return DRAFT[n][id];
}
function zapis(id,kluc,hodnota){
  const r=rozprac(id);
  if(hodnota===''||hodnota==null||(Array.isArray(hodnota)&&!hodnota.length)) delete r[kluc]; else r[kluc]=hodnota;
  r.kedy=new Date().toISOString().slice(0,10); r.kto=localStorage.getItem(K_KTO)||undefined;
  ulozDraft(); kresliZoznam();
}
function vyber(id){
  vybrane=id; const p=polozka(id); if(!p){ return; }
  const r=zaznam(id)||{}, novy=!!p.novy, zm=!!(DRAFT.zamery[id]||DRAFT.nove[id]);
  const pol=r.poloha||(p.presnost==='presná'?p.sur:null);
  const zdrojPolohy=r.poloha?'doplnené redakciou':p.presnost==='presná'?(p.zdroj_polohy==='parcela'?'parcely zo zámeru, overené v katastri':p.zdroj_polohy==='osm'?'stavenisko z OSM':'stred ulice z adresných bodov'):'chýba';
  const dotaz=encodeURIComponent((r.nazov||p.nazov).replace(/[„“"]/g,'')+' '+(p.obec||'Bratislava'));
  const sel=(zoz,v,prazdne)=>(prazdne?'<option value="">'+prazdne+'</option>':'')+zoz.map(x=>'<option'+(x===v?' selected':'')+'>'+esc(x)+'</option>').join('');
  $('#editor').innerHTML=
    '<div class="hlava"><h2 id="e-nadpis">'+esc(r.nazov||p.nazov)+'</h2>'
    +(novy?'<span class="stitok novy">nový · mimo registra</span>':'<span class="stitok">register EIA</span>')
    +(zm?'<span class="stitok red">rozpracované</span>':(RED.zamery[id]||RED.nove[id])?'<span class="stitok red">doplnené redakciou</span>':'')
    +'<div class="meta">'+(novy?'':'<span>'+esc(p.obec||'')+'</span><span>'+esc(p.typ||'')+'</span><span>'+esc(p.faza||'')+'</span>'
      +(p.firma?'<span>'+esc(p.firma.split(',')[0])+(p.ico?' · IČO '+esc(p.ico):'')+'</span>':'')
      +'<a href="https://www.enviroportal.sk/eia/detail/'+esc(id)+'" target="_blank" rel="noopener">spis na enviroportáli ↗</a>')
      +'<a href="'+MAPA+'?id='+encodeURIComponent(id)+'" target="_blank" rel="noopener">otvoriť v mape ↗</a></div></div>'

    +(novy?'<div class="blok"><h3>Základ</h3><div class="mriezka">'
      +'<div class="cely"><label>Názov projektu *</label><input id="e-nazov" value="'+esc(r.nazov||'')+'" placeholder="napr. Nové Lido"></div>'
      +'<div><label>Mestská časť *</label><select id="e-obec">'+sel(OBCE,r.obec,'— vyber —')+'</select></div>'
      +'<div><label>Účel</label><select id="e-typ">'+sel(TYPY,r.typ||'Bývanie')+'</select></div>'
      +'</div></div>':'')

    +'<div class="blok"><h3>Poloha <span class="stav '+(pol?'ok':'chyba')+'" id="e-poloha-stav">'+(pol?'✓ '+zdrojPolohy:'chýba — klikni do mapy alebo vlož odkaz')+'</span></h3>'
    +'<div class="poloha-rozloz"><div id="mini-mapa"><div class="mapa-tl"><button class="tl" id="m-orto" aria-pressed="false">Ortofoto</button></div><div class="mapa-pozn">klikni alebo potiahni bod</div></div>'
    +'<div><label>Vlož odkaz z Google Maps / Mapy.cz, alebo súradnice</label><input id="e-odkaz-poloha" placeholder="https://www.google.com/maps/@48.14,17.10,17z  alebo  48.1440, 17.1077" autocomplete="off">'
    +'<p class="pomoc" id="e-poloha-pomoc">V Google Maps klikni pravým na miesto a skopíruj súradnice, alebo skopíruj celú adresu z riadka prehliadača. Krátke odkazy (maps.app.goo.gl) najprv otvor.</p>'
    +'<div class="riadok-tl"><a class="tl" href="https://www.google.com/maps/search/'+dotaz+'" target="_blank" rel="noopener">Hľadať v Google Maps ↗</a>'
    +(pol?'<a class="tl" href="https://www.google.com/maps/search/'+pol[1].toFixed(6)+','+pol[0].toFixed(6)+'" target="_blank" rel="noopener">Overiť bod ↗</a>':'')
    +(r.poloha?'<button class="tl duch" id="e-poloha-zrus">Vrátiť pôvodnú</button>':'')+'</div>'
    +'<div style="margin-top:14px"><label>Súradnice</label><div class="sur" id="e-sur">'+(pol?pol[1].toFixed(6)+', '+pol[0].toFixed(6):'—')+'</div></div>'
    +'<div style="margin-top:12px"><label>Poznámka k polohe (napr. ktorá parcela, prečo tu)</label><input id="e-poloha-pozn" value="'+esc(r.poloha_pozn||'')+'" maxlength="200"></div>'
    +'</div></div></div>'

    +'<div class="blok"><h3>Obrázky a vizualizácie <span class="stav">'+(r.obrazky&&r.obrazky.length?r.obrazky.length+' v redakcii':'')+(p.nahlady&&p.nahlady.length?' · '+p.nahlady.length+' výkresov zo spisu':'')+'</span></h3>'
    +'<div class="drop" id="drop" tabindex="0"><b>Pretiahni sem obrázky, vlož zo schránky (Ctrl+V) alebo klikni</b>JPG, PNG, WebP — zmenšia sa na 1 600 px a uložia k mape. Vizualizácie len s právom ich zverejniť.</div>'
    +'<input type="file" id="e-subory" accept="image/*" multiple hidden>'
    +'<div class="url-riadok"><input id="e-obr-url" placeholder="…alebo vlož odkaz na obrázok na webe (https://…)"><button class="tl" id="e-obr-url-pridaj">Pridať odkaz</button></div>'
    +'<div class="galeria" id="galeria"></div></div>'

    +'<div class="blok"><h3>Údaje</h3><div class="mriezka">'
    +'<div class="cely"><label>'+(novy?'Odkaz na projekt / zdroj':'Obchodný názov (marketingový, napr. „Nový Ružinov“)')+'</label>'
      +(novy?'<input id="e-odkaz" value="'+esc(r.odkaz||'')+'" placeholder="https://…">':'<input id="e-nazov" value="'+esc(r.nazov||'')+'" placeholder="'+esc(p.nazov_obch||'')+'"><p class="pomoc">V karte sa ukáže nad úradným názvom s poznámkou „podľa redakcie“.</p>')+'</div>'
    +'<div><label>Fáza'+(novy?'':' (prepíše fázu z registra)')+'</label><select id="e-faza">'+sel(FAZY,r.faza,novy?'':'— podľa registra: '+(p.faza||'?')+' —')+'</select></div>'
    +'<div><label>Architekt / ateliér</label><input id="e-architekt" value="'+esc(r.architekt||'')+'"></div>'
    +'<div><label>Investor / developer</label><input id="e-investor" value="'+esc(r.investor||'')+'" placeholder="'+esc(novy?'':(p.firma||'').split(',')[0])+'"></div>'
    +(novy?'':'<div><label>Odkaz na web projektu</label><input id="e-odkaz" value="'+esc(r.odkaz||'')+'" placeholder="https://…"></div>')
    +'<div class="cely"><label>Popis (pár viet — čo sa stavia, koľko bytov, kedy)</label><textarea id="e-popis">'+esc(r.popis||'')+'</textarea></div>'
    +'</div></div>'

    +'<div class="pata"><span>'+(r.kedy?'naposledy upravené '+esc(r.kedy)+(r.kto?' · '+esc(r.kto):''):'bez redakčných úprav')+'</span>'
    +(zm?'<button class="tl duch mala" id="e-zahod">Zahodiť rozpracované zmeny</button>':'')
    +(novy&&!zm&&RED.nove[id]?'<button class="tl duch mala" id="e-zmaz">Odstrániť nový zámer</button>':'')
    +'</div>';
  $('#editor').scrollTop=0;
  kresliZoznam();

  /* polia → koncept */
  const nap=(sel,kluc,fn)=>{ const el=$(sel); if(!el) return; el.addEventListener('input',()=>zapis(id,kluc,fn?fn(el.value):el.value.trim())); };
  nap('#e-nazov','nazov'); nap('#e-obec','obec'); nap('#e-typ','typ'); nap('#e-faza','faza'); nap('#e-architekt','architekt');
  nap('#e-investor','investor'); nap('#e-odkaz','odkaz'); nap('#e-popis','popis'); nap('#e-poloha-pozn','poloha_pozn');
  const nz=$('#e-nazov'); if(nz) nz.addEventListener('input',()=>{ $('#e-nadpis').textContent=nz.value.trim()||p.nazov; });
  if($('#e-zahod')) $('#e-zahod').onclick=async()=>{ if(!confirm('Zahodiť rozpracované zmeny tohto zámeru?')) return;
    const n=jeNovy(id)?'nove':'zamery'; await zahodObrazky(DRAFT[n][id],RED[n][id]); delete DRAFT[n][id]; ulozDraft(); if(jeNovy(id)&&!RED.nove[id]){ vybrane=null; prazdny(); kresliZoznam(); } else vyber(id); };
  if($('#e-zmaz')) $('#e-zmaz').onclick=()=>{ if(!confirm('Odstrániť tento nový zámer z mapy? Zmena sa prejaví po uložení na GitHub.')) return; DRAFT.nove[id]={_zmazat:1}; ulozDraft(); vybrane=null; prazdny(); kresliZoznam(); };
  if($('#e-poloha-zrus')) $('#e-poloha-zrus').onclick=()=>{ zapis(id,'poloha',null); vyber(id); };
  /* odkaz sa spracuje po vložení (paste) alebo po pauze v písaní — nie pri
     každom znaku, inak by sa z „17.1077“ vzalo „17.1“ v polovici písania */
  const pole=$('#e-odkaz-poloha'); let cakac;
  const spracuj=t=>{
    t=(t||pole.value).trim(); if(!t) return;
    const s=rozober(t), pom=$('#e-poloha-pomoc');
    if(s){ nastavPolohu(id,s); pom.className='pomoc ok'; pom.textContent='Rozumiem: '+s[1].toFixed(6)+', '+s[0].toFixed(6)+' — bod je v mape, môžeš ho ešte potiahnuť.'; pole.value=''; }
    else if(/goo\.gl|maps\.app/.test(t)){ pom.className='pomoc chyba'; pom.textContent='Krátky odkaz neobsahuje súradnice. Otvor ho v prehliadači a skopíruj celú adresu z riadka, alebo pravým klikom súradnice.'; }
    else { pom.className='pomoc chyba'; pom.textContent='V texte nevidím súradnice z Bratislavy. Skús celú adresu z Google Maps alebo „48.1440, 17.1077“.'; }
  };
  pole.addEventListener('paste',e=>{ const t=(e.clipboardData||window.clipboardData).getData('text'); if(t){ e.preventDefault(); pole.value=t; spracuj(t); } });
  pole.addEventListener('input',()=>{ clearTimeout(cakac); cakac=setTimeout(()=>spracuj(),900); });
  pole.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(cakac); spracuj(); } });
  miniMapa(id,pol,p);
  obrazky(id,p);
}
function prazdny(){ $('#editor').innerHTML='<div class="prazdne"><h2>Vyber zámer vľavo</h2><p>Alebo pridaj nový, ktorý v registri nie je.</p></div>'; }
function nastavPolohu(id,s){
  zapis(id,'poloha',[+s[0].toFixed(6),+s[1].toFixed(6)]);
  $('#e-sur').textContent=s[1].toFixed(6)+', '+s[0].toFixed(6);
  const st=$('#e-poloha-stav'); st.className='stav ok'; st.textContent='✓ doplnené redakciou';
  if(MM.marker) MM.marker.setLngLat(s); else pridajMarker(id,s);
}

/* Google Maps dáva rôzne tvary: @lat,lon,zoom · !3dlat!4dlon · ?q=lat,lon ·
   search/lat,+lon · ll=lat,lon; Mapy.cz x=lon&y=lat; a holé „lat, lon“
   alebo stupne 48°8'38"N 17°6'27"E. Berieme len body v Bratislave. */
function rozober(t){
  const vBA=(lat,lon)=>(lat>47.9&&lat<48.5&&lon>16.7&&lon<17.5)?[+lon,+lat]:null;
  let m;
  if((m=t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/))) return vBA(+m[1],+m[2]);
  if((m=t.match(/[?&](?:x|lon|lng)=(-?\d+\.\d+).*?[?&](?:y|lat)=(-?\d+\.\d+)/))) return vBA(+m[2],+m[1]);
  if((m=t.match(/[?&](?:y|lat)=(-?\d+\.\d+).*?[?&](?:x|lon|lng)=(-?\d+\.\d+)/))) return vBA(+m[1],+m[2]);
  if((m=t.match(/(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([NS])[^0-9]+(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([EW])/))){
    const lat=(+m[1]+m[2]/60+m[3]/3600)*(m[4]==='S'?-1:1), lon=(+m[5]+m[6]/60+m[7]/3600)*(m[8]==='W'?-1:1); return vBA(lat,lon); }
  const c=t.replace(/%2C/gi,',').match(/-?\d{2}[.,]\d{3,}/g);
  if(!c||c.length<2) return null;
  const a=parseFloat(c[0].replace(',','.')), b=parseFloat(c[1].replace(',','.'));
  return vBA(a,b)||vBA(b,a);
}

/* ---------- mini mapa ---------- */
const MM={map:null,marker:null};
function miniMapa(id,pol,p){
  if(MM.map){ try{ MM.map.remove(); }catch(e){} MM.map=null; MM.marker=null; }
  const stred=pol||TAZISKA[p.obec]||[17.11,48.15];
  const map=new maplibregl.Map({container:'mini-mapa',attributionControl:{compact:true},
    style:{version:8,sources:{},layers:[{id:'pozadie',type:'background',paint:{'background-color':'#0B1117'}}]},
    center:stred,zoom:pol?16:12.5,minZoom:9,maxZoom:19});
  MM.map=map;
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
  map.on('style.load',()=>{
    map.addSource('osm',{type:'vector',maxzoom:18,tiles:[G+'/Hosted/Podkladov%C3%A1_mapa_OSM_UP/VectorTileServer/tile/{z}/{y}/{x}.pbf']});
    map.addSource('orto',{type:'raster',tileSize:256,maxzoom:19,tiles:[G+'/Hosted/Ortofoto/MapServer/tile/{z}/{y}/{x}']});
    [{id:'v-zast',type:'fill',source:'osm','source-layer':'zastavané územie',paint:{'fill-color':'#131C24'}},
     {id:'v-zelen',type:'fill',source:'osm','source-layer':'zeleň',paint:{'fill-color':'#10201A'}},
     {id:'v-voda',type:'fill',source:'osm','source-layer':'vodné plochy',paint:{'fill-color':'#0E1D28'}},
     {id:'v-bud',type:'fill',source:'osm','source-layer':'budovy',minzoom:13,paint:{'fill-color':'#1E2A36'}},
     {id:'v-cesty',type:'line',source:'osm','source-layer':'cestná sieť',paint:{'line-color':'#2C3843','line-width':['interpolate',['linear'],['zoom'],10,.5,14,1.8,18,6]}},
     {id:'orto',type:'raster',source:'orto',layout:{visibility:'none'}},
    ].forEach(v=>map.addLayer(v));
    /* ostatné zámery s polohou — nech vidno, či bod nekoliduje so susedom */
    map.addSource('ost',{type:'geojson',data:{type:'FeatureCollection',features:Z.filter(q=>q.id!==id&&(zaznam(q.id)||{}).poloha||q.presnost==='presná').map(q=>({type:'Feature',geometry:{type:'Point',coordinates:(zaznam(q.id)||{}).poloha||q.sur},properties:{n:(zaznam(q.id)||{}).nazov||q.nazov}}))}});
    map.addLayer({id:'ost',type:'circle',source:'ost',paint:{'circle-color':'#5E7F96','circle-radius':4,'circle-stroke-width':1,'circle-stroke-color':'#0B1117'}});
    map.addLayer({id:'ost-txt',type:'symbol',source:'ost',minzoom:15,layout:{'text-field':['get','n'],'text-size':10.5,'text-anchor':'left','text-offset':[.7,0],'text-max-width':10,'text-font':['Noto Sans Regular'],'text-optional':true},paint:{'text-color':'#8FA3B5','text-halo-color':'#0B1117','text-halo-width':1.2}});
    if(pol) pridajMarker(id,pol);
  });
  map.on('click',e=>{ if(vybrane!==id) return; nastavPolohu(id,[e.lngLat.lng,e.lngLat.lat]); });
  $('#m-orto').onclick=()=>{ const b=$('#m-orto'), on=b.getAttribute('aria-pressed')!=='true'; b.setAttribute('aria-pressed',on);
    if(map.getLayer('orto')) map.setLayoutProperty('orto','visibility',on?'visible':'none'); };
}
function pridajMarker(id,s){
  MM.marker=new maplibregl.Marker({color:'#D6165A',draggable:true}).setLngLat(s).addTo(MM.map);
  MM.marker.on('dragend',()=>{ const l=MM.marker.getLngLat(); nastavPolohu(id,[l.lng,l.lat]); });
  MM.map.easeTo({center:s,zoom:Math.max(MM.map.getZoom(),15.5)});
}

/* ---------- obrázky ---------- */
function obrazky(id,p){
  const drop=$('#drop'), vstup=$('#e-subory');
  drop.onclick=()=>vstup.click();
  drop.onkeydown=e=>{ if(e.key==='Enter'||e.key===' ') vstup.click(); };
  vstup.onchange=()=>{ pridajSubory(id,[...vstup.files]); vstup.value=''; };
  ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('nad'); }));
  ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove('nad'); }));
  drop.addEventListener('drop',e=>{
    const f=[...(e.dataTransfer.files||[])].filter(x=>x.type.startsWith('image/'));
    if(f.length) return pridajSubory(id,f);
    const u=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain');
    if(u&&/^https?:\/\//.test(u)) pridajOdkaz(id,u.trim());
  });
  $('#e-obr-url-pridaj').onclick=()=>{ const u=$('#e-obr-url').value.trim(); if(u) { pridajOdkaz(id,u); $('#e-obr-url').value=''; } };
  kresliGaleriu(id);
}
document.addEventListener('paste',e=>{
  if(!vybrane) return;
  const f=[...(e.clipboardData.files||[])].filter(x=>x.type.startsWith('image/'));
  if(f.length){ e.preventDefault(); pridajSubory(vybrane,f); }
});
async function pridajSubory(id,subory){
  const r=rozprac(id); r.obrazky=r.obrazky||[];
  for(const f of subory){
    try{
      const blob=await zmensi(f);
      const cesta='redakcia/'+id.replace(/[^a-z0-9-]/gi,'').slice(0,40)+'-'+Date.now().toString(36)+'.jpg';
      await IDB.put(cesta,blob);
      r.obrazky.push({s:cesta,p:'',z:'',novy:1});
      toast('Obrázok pridaný ('+Math.round(blob.size/1024)+' kB)');
    }catch(e){ toast('Obrázok sa nepodarilo spracovať: '+e.message); }
  }
  zapis(id,'obrazky',r.obrazky); kresliGaleriu(id);
}
function pridajOdkaz(id,u){
  if(!/^https?:\/\/.+\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(u) && !confirm('Odkaz nevyzerá ako priamy obrázok (.jpg/.png). Pridať aj tak?')) return;
  const r=rozprac(id); r.obrazky=(r.obrazky||[]).concat([{u:u,p:'',z:''}]);
  zapis(id,'obrazky',r.obrazky); kresliGaleriu(id);
}
/* zmenšenie v prehliadači: dlhšia strana 1 600 px, JPEG — repo nemá rásť o megabajty */
async function zmensi(f){
  const bmp=await createImageBitmap(f);
  const k=Math.min(1,1600/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas'); c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
  c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  return new Promise(ok=>c.toBlob(b=>ok(b),'image/jpeg',.85));
}
async function nahlUrl(o){
  if(o.u) return o.u;
  if(!o.novy) return MAPA+o.s;
  if(URLS[o.s]) return URLS[o.s];
  const b=await IDB.get(o.s); if(!b) return '';
  return URLS[o.s]=URL.createObjectURL(b);
}
async function kresliGaleriu(id){
  const r=zaznam(id)||{}, zoz=r.obrazky||[], g=$('#galeria'); if(!g) return;
  const html=await Promise.all(zoz.map(async(o,i)=>'<div class="obr" data-i="'+i+'"><div class="nahl" style="background-image:url(\''+esc(await nahlUrl(o))+'\')">'
    +'<span class="druh'+(o.novy?' novy':'')+'">'+(o.u?'odkaz':o.novy?'nové · neuložené':'uložené')+'</span>'
    +'<div class="tlac">'+(i?'<button title="doľava" data-a="l">‹</button>':'')+(i<zoz.length-1?'<button title="doprava" data-a="p">›</button>':'')+'<button title="odstrániť" data-a="x">×</button></div></div>'
    +'<input data-k="p" value="'+esc(o.p||'')+'" placeholder="popis (napr. vizualizácia z ulice)">'
    +'<input data-k="z" value="'+esc(o.z||'')+'" placeholder="zdroj / autor (ateliér, developer)">'
    +'</div>'));
  g.innerHTML=html.join('');
  g.querySelectorAll('.obr').forEach(el=>{
    const i=+el.dataset.i;
    el.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{ const rr=rozprac(id); rr.obrazky[i][inp.dataset.k]=inp.value.trim(); zapis(id,'obrazky',rr.obrazky); }));
    el.querySelectorAll('button').forEach(b=>b.onclick=async()=>{
      const rr=rozprac(id), z=rr.obrazky, a=b.dataset.a;
      if(a==='x'){ const o=z.splice(i,1)[0]; if(o&&o.novy){ await IDB.del(o.s); delete URLS[o.s]; } }
      else if(a==='l'){ [z[i-1],z[i]]=[z[i],z[i-1]]; } else if(a==='p'){ [z[i+1],z[i]]=[z[i],z[i+1]]; }
      zapis(id,'obrazky',z); kresliGaleriu(id); });
  });
}
async function zahodObrazky(draft,pub){
  const ost=new Set(((pub&&pub.obrazky)||[]).map(o=>o.s).filter(Boolean));
  for(const o of ((draft&&draft.obrazky)||[])) if(o.novy&&!ost.has(o.s)){ try{ await IDB.del(o.s); }catch(e){} }
}

/* ---------- nový zámer ---------- */
$('#tl-novy').onclick=()=>{
  const id='r-'+Date.now().toString(36);
  DRAFT.nove[id]={nazov:'',obec:filtr.mc||'',typ:'Bývanie',faza:'zámer',kedy:new Date().toISOString().slice(0,10),kto:localStorage.getItem(K_KTO)||undefined};
  ulozDraft(); nastavChip(''); kresliZoznam(); vyber(id);
  setTimeout(()=>{ const n=$('#e-nazov'); if(n) n.focus(); },50);
};

/* ---------- GitHub ---------- */
const token=()=>localStorage.getItem(K_TOKEN)||'';
async function gh(cesta,opts){
  const r=await fetch('https://api.github.com'+cesta,Object.assign({headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token(),'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}},opts||{}));
  if(!r.ok){ let m=''; try{ m=(await r.json()).message||''; }catch(e){} throw new Error('GitHub '+r.status+(m?': '+m:'')); }
  return r.status===204?null:r.json();
}
async function overPripojenie(ticho){
  const el=$('#pripoj');
  if(!token()){ el.className='pripoj'; el.querySelector('span').textContent='bez pripojenia — nastaviť'; return false; }
  try{
    const u=await gh('/user'), rp=await gh('/repos/'+REPO);
    if(!(rp.permissions&&rp.permissions.push)) throw new Error('token nemá právo zapisovať do repa');
    el.className='pripoj ok'; el.querySelector('span').textContent=u.login+' · zápis povolený'; return true;
  }catch(e){ el.className='pripoj chyba'; el.querySelector('span').textContent='pripojenie zlyhalo'; if(!ticho) toast(e.message); return false; }
}
$('#pripoj').onclick=()=>{ $('#n-token').value=token(); $('#n-kto').value=localStorage.getItem(K_KTO)||''; $('#n-stav').textContent=''; $('#d-nastav').showModal(); };
$('#n-zavri').onclick=()=>$('#d-nastav').close();
$('#n-odpoj').onclick=()=>{ localStorage.removeItem(K_TOKEN); $('#n-token').value=''; overPripojenie(true); $('#n-stav').textContent='Token vymazaný z prehliadača.'; };
$('#n-uloz').onclick=async()=>{
  const t=$('#n-token').value.trim(); localStorage.setItem(K_KTO,$('#n-kto').value.trim());
  if(t) localStorage.setItem(K_TOKEN,t); else localStorage.removeItem(K_TOKEN);
  $('#n-stav').className='pomoc'; $('#n-stav').textContent='overujem…';
  const ok=await overPripojenie(true);
  $('#n-stav').className='pomoc '+(ok?'ok':'chyba'); $('#n-stav').textContent=ok?'Pripojené, môžeš ukladať.':(t?'Token nefunguje alebo nemá právo Contents: Read and write.':'Bez tokenu — zmeny ostanú len v prehliadači.');
  if(ok) setTimeout(()=>$('#d-nastav').close(),900);
};

/* vyčistený záznam do súboru: bez prázdnych polí a bez príznaku novy */
function cisty(r){
  const o={}; Object.keys(r).forEach(k=>{ const v=r[k]; if(v===''||v==null||(Array.isArray(v)&&!v.length)||k==='_zmazat') return; o[k]=v; });
  if(o.obrazky) o.obrazky=o.obrazky.map(x=>{ const y={}; if(x.s) y.s=x.s; if(x.u) y.u=x.u; if(x.p) y.p=x.p; if(x.z) y.z=x.z; return y; });
  return o;
}
const b64=blob=>new Promise(ok=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
const utf8b64=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64utf8=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g,'')),c=>c.charCodeAt(0)));

$('#tl-uloz').onclick=async()=>{
  if(!token()||!(await overPripojenie(true))){ $('#pripoj').click(); return; }
  /* nové zámery bez názvu alebo polohy sú pre mapu bezcenné — radšej zastaviť */
  for(const [id,r] of Object.entries(DRAFT.nove)){ if(r._zmazat) continue;
    if(!r.nazov||!r.poloha||!r.obec){ vyber(id); toast('Nový zámer potrebuje názov, mestskú časť a polohu.'); return; } }
  const d=$('#d-uloz'), log=$('#u-log'); log.innerHTML=''; $('#u-nadpis').textContent='Ukladám na GitHub…'; $('#u-zavri').disabled=true; d.showModal();
  const L=(t,c)=>{ log.insertAdjacentHTML('beforeend','<div class="'+(c||'')+'">'+esc(t)+'</div>'); log.scrollTop=1e6; };
  try{
    L('čítam aktuálny stav repozitára…');
    const ref=await gh('/repos/'+REPO+'/git/ref/heads/'+VETVA), hlava=ref.object.sha;
    const commit=await gh('/repos/'+REPO+'/git/commits/'+hlava);
    /* zlúčenie do najnovšej verzie súboru — medzitým mohol zapísať týždenný beh alebo kolega */
    let pub={zamery:{},nove:{}};
    try{ const f=await gh('/repos/'+REPO+'/contents/mapa-zamerov/redakcia.json?ref='+VETVA); pub=JSON.parse(b64utf8(f.content)); }catch(e){ L('redakcia.json v repe ešte nie je, vytvorím ho'); }
    pub.zamery=pub.zamery||{}; pub.nove=pub.nove||{};
    const strom=[]; let nObr=0, nZ=0;
    const predtym=new Set(); Object.values(pub.zamery).concat(Object.values(pub.nove)).forEach(r=>(r.obrazky||[]).forEach(o=>o.s&&predtym.add(o.s)));
    for(const n of ['zamery','nove']) for(const [id,r] of Object.entries(DRAFT[n])){
      nZ++;
      if(r._zmazat){ delete pub[n][id]; continue; }
      for(const o of (r.obrazky||[])) if(o.novy&&o.s){
        const blob=await IDB.get(o.s); if(!blob){ L('obrázok '+o.s+' sa v prehliadači nenašiel, preskakujem','chyba'); r.obrazky=r.obrazky.filter(x=>x!==o); continue; }
        L('nahrávam '+o.s+' ('+Math.round(blob.size/1024)+' kB)');
        const bl=await gh('/repos/'+REPO+'/git/blobs',{method:'POST',body:JSON.stringify({content:await b64(blob),encoding:'base64'})});
        strom.push({path:'mapa-zamerov/'+o.s,mode:'100644',type:'blob',sha:bl.sha}); nObr++;
      }
      const c=cisty(r); if(Object.keys(c).filter(k=>!['kedy','kto'].includes(k)).length) pub[n][id]=c; else delete pub[n][id];
    }
    /* obrázky, na ktoré už nič neodkazuje, z repa von */
    const teraz=new Set(); Object.values(pub.zamery).concat(Object.values(pub.nove)).forEach(r=>(r.obrazky||[]).forEach(o=>o.s&&teraz.add(o.s)));
    predtym.forEach(s=>{ if(!teraz.has(s)){ strom.push({path:'mapa-zamerov/'+s,mode:'100644',type:'blob',sha:null}); L('mažem nepoužitý '+s); } });
    pub._popis=pub._popis||'Redakčná vrstva — ručné doplnenia z aplikácie /redakcia/. Mapa ich zlúči pri načítaní; každý údaj odtiaľto je v karte označený ako doplnený redakciou.';
    pub._aktualizovane=new Date().toISOString().slice(0,10);
    strom.push({path:'mapa-zamerov/redakcia.json',mode:'100644',type:'blob',content:JSON.stringify(pub,null,1)});
    L('zapisujem redakcia.json ('+cis(Object.keys(pub.zamery).length)+' doplnených zámerov, '+cis(Object.keys(pub.nove).length)+' nových)');
    const tree=await gh('/repos/'+REPO+'/git/trees',{method:'POST',body:JSON.stringify({base_tree:commit.tree.sha,tree:strom})});
    const kto=localStorage.getItem(K_KTO)||'redakcia';
    const nc=await gh('/repos/'+REPO+'/git/commits',{method:'POST',body:JSON.stringify({message:'Redakcia: '+nZ+' '+(nZ===1?'zámer':nZ<5?'zámery':'zámerov')+(nObr?', '+nObr+' obr.':'')+' ('+kto+')',tree:tree.sha,parents:[hlava]})});
    await gh('/repos/'+REPO+'/git/refs/heads/'+VETVA,{method:'PATCH',body:JSON.stringify({sha:nc.sha,force:false})});
    L('commit '+nc.sha.slice(0,7)+' hotový','ok');
    /* koncept je v repe — vyčistiť prehliadač */
    for(const n of ['zamery','nove']) for(const r of Object.values(DRAFT[n])) for(const o of (r.obrazky||[])) if(o.novy&&o.s){ try{ await IDB.del(o.s); }catch(e){} }
    Object.keys(URLS).forEach(k=>{ URL.revokeObjectURL(URLS[k]); delete URLS[k]; });
    DRAFT={zamery:{},nove:{}}; ulozDraft(); RED=pub;
    $('#u-nadpis').textContent='Uložené'; $('#u-pozn').textContent='GitHub Pages stránku prestaví zhruba do dvoch minút, potom to uvidíš v mape. Zoznam vľavo už ukazuje nový stav.';
    kresliZoznam(); if(vybrane) vyber(vybrane);
  }catch(e){
    L('CHYBA: '+e.message,'chyba'); L('Nič sa nestratilo — zmeny ostávajú v prehliadači, skús to znova. Ak to hlási 409/422, medzitým niekto zapísal do repa: stačí kliknúť Uložiť ešte raz.');
    $('#u-nadpis').textContent='Uloženie zlyhalo';
  }
  $('#u-zavri').disabled=false;
};
$('#u-zavri').onclick=()=>$('#d-uloz').close();

/* ---------- drobnosti ---------- */
let toastT;
function toast(t){ const el=$('#toast'); el.textContent=t; el.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),3200); }
window.addEventListener('beforeunload',e=>{ /* koncept je v localStorage, nič nehrozí — len pripomenutie pri zatváraní s neuloženými */ });
document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='s'){ e.preventDefault(); if(!$('#tl-uloz').disabled) $('#tl-uloz').click(); } });

nacitaj().catch(e=>{ $('#pocet').textContent='Dáta sa nenačítali: '+e.message; });
overPripojenie(true);
