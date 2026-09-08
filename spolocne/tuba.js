/* Spoločné drobnosti dizajn systému TU—BA:
   klávesa G zapne/vypne červený 8-stĺpcový grid z manuálu (kontrola
   zarovnania), mimo textových polí. Nič iné. */
(function(){
  if(document.getElementById('dm-grid')) return;
  const g=document.createElement('div');
  g.id='dm-grid'; g.className='dm-grid'; g.hidden=true; g.setAttribute('aria-hidden','true');
  g.innerHTML='<i></i>'.repeat(8);
  document.body.appendChild(g);
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()!=='g'||e.ctrlKey||e.metaKey||e.altKey) return;
    if(/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName)) return;
    g.hidden=!g.hidden;
  });
})();
