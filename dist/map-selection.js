export const MAP_STORAGE_KEY='speed-for-need-map';
export const MAPS=Object.freeze([
  Object.freeze({id:'coast',name:'Solana Coast',tagline:'COASTAL CITY',description:'Downtown, hillside neighbourhoods and the Sunset Mile. Your familiar coastal playground.',style:'coast'}),
  Object.freeze({id:'drift',name:'Drift Race Track',tagline:'REAL TRACK',description:'Nicholas-3D’s authored asphalt circuit. Technical bends, guardrails and a full five-car race.',style:'drift'}),
]);
const valid=id=>MAPS.some(map=>map.id===id);
/** A URL choice wins; an existing saved choice comes next. Existing links retain the Coast. */
export function readSelectedMap(search='',storage){
  const requested=new URLSearchParams(search).get('map');
  if(valid(requested))return requested;
  if(requested==='default'||requested==='la')return 'coast';
  try{const saved=storage?.getItem(MAP_STORAGE_KEY);if(valid(saved))return saved;}catch{}
  return 'coast';
}
export function mapUrl(href,id){
  if(!valid(id))throw new RangeError('Unknown map');
  const url=new URL(href);url.searchParams.set('map',id);return url.href;
}
/** Reload on a map change so a second world's meshes and physics cannot remain allocated. */
export function bindMapSelection({selected='coast',storage}={}){
  const panel=document.querySelector('#maps-panel'),home=document.querySelector('#home'),opener=document.querySelector('#home-maps');
  if(!panel||!home||!opener)return {open(){},close(){}};
  const cards=[...panel.querySelectorAll('[data-map]')],enter=panel.querySelector('#map-enter'),status=panel.querySelector('#map-current');
  let pending=valid(selected)?selected:'coast';
  function sync(){
    for(const card of cards){const chosen=card.dataset.map===pending;card.setAttribute('aria-pressed',String(chosen));card.querySelector('.map-equipped').textContent=card.dataset.map===selected?'CURRENT MAP':'EXPLORE';}
    const map=MAPS.find(item=>item.id===pending);status.textContent=map.name;enter.textContent=pending===selected?'BACK TO MAIN MENU ↗':'LOAD '+map.name.toUpperCase()+' ↗';
  }
  function close(restoreFocus=true){panel.hidden=true;home.classList.remove('maps-open');opener.setAttribute('aria-expanded','false');if(restoreFocus&&!home.hidden)opener.focus();}
  function open(){
    pending=valid(selected)?selected:'coast';sync();
    document.querySelector('#options-panel').hidden=true;
    document.querySelector('#garage-panel').hidden=true;
    panel.hidden=false;home.classList.add('maps-open');opener.setAttribute('aria-expanded','true');
    cards.find(card=>card.dataset.map===pending)?.focus();
  }
  opener.addEventListener('click',open);
  panel.querySelector('#maps-back').addEventListener('click',()=>close());
  for(const card of cards)card.addEventListener('click',()=>{pending=card.dataset.map;sync();});
  enter.addEventListener('click',()=>{
    if(pending===selected){close();return;}
    try{storage?.setItem(MAP_STORAGE_KEY,pending);}catch{}
    location.assign(mapUrl(location.href,pending));
  });
  for(const id of ['#home-drive','#home-garage','#home-options'])document.querySelector(id)?.addEventListener('click',()=>close(false));
  document.addEventListener('keydown',event=>{
    if(panel.hidden||home.hidden)return;
    // The driving listener also uses Enter and arrows: consume panel keys before it.
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();let index=cards.findIndex(card=>card.dataset.map===pending);
      index=event.key==='Home'?0:event.key==='End'?cards.length-1:(index+(event.key==='ArrowLeft'?-1:1)+cards.length)%cards.length;
      pending=cards[index].dataset.map;sync();cards[index].focus();
    }
    if(event.key==='Tab'){
      const focusable=[...panel.querySelectorAll('button:not(:disabled),a[href]')];
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  },true);
  sync();return {open,close};
}
