/* Spoločné drobnosti dizajn systému TU—BA:
   1) klávesa G zapne/vypne červený 8-stĺpcový grid z manuálu,
   2) burger — na úzkych obrazovkách sa odkazy v lište schovajú pod ikonu.
   Nič iné; vzhľad je v tuba.css. */
(function(){
  /* ---------- kontrolný grid (klávesa G) ---------- */
  let g=document.getElementById('dm-grid');
  if(!g){
    g=document.createElement('div');
    g.id='dm-grid'; g.className='dm-grid'; g.setAttribute('aria-hidden','true');
    g.innerHTML='<i></i>'.repeat(8);
    document.body.appendChild(g);
  }
  g.hidden=true;                       // grid je pomôcka, nie súčasť stránky
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()!=='g'||e.ctrlKey||e.metaKey||e.altKey) return;
    if(/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName)) return;
    g.hidden=!g.hidden;
  });

  /* ---------- burger ----------
     Tlačidlo sa vloží do lišty pred lupu (ak je) a prepína triedu
     `otvorene`. Pod 1150 px sa navigácia zobrazí ako panel pod lištou;
     nad 1150 px je tlačidlo skryté cez CSS a panel je bežný riadok. */
  document.querySelectorAll('.tb-lista, .lista').forEach(lista=>{
    const nav=lista.querySelector('nav');
    if(!nav || !nav.querySelector('a') || lista.querySelector('.tb-burger')) return;
    const b=document.createElement('button');
    b.className='tb-burger'; b.type='button';
    b.setAttribute('aria-label','Menu'); b.setAttribute('aria-expanded','false');
    b.innerHTML='<i></i>';
    /* lupa (a iné tlačidlá za navigáciou) ostáva vpravo od burgeru */
    const zaNav=nav.nextElementSibling;
    lista.insertBefore(b, zaNav || null);
    const prepni=otvor=>{
      lista.classList.toggle('otvorene', otvor);
      b.setAttribute('aria-expanded', otvor?'true':'false');
    };
    b.addEventListener('click',e=>{ e.stopPropagation(); prepni(!lista.classList.contains('otvorene')); });
    nav.addEventListener('click',e=>{ if(e.target.closest('a')) prepni(false); });
    document.addEventListener('click',e=>{ if(!e.target.closest('.tb-lista, .lista')) prepni(false); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') prepni(false); });
    /* po roztiahnutí okna nech neostane visieť otvorený panel */
    window.addEventListener('resize',()=>{ if(window.innerWidth>1150) prepni(false); });
  });
})();
