export const groupNames={circulation:'Circulation',respiration:'Respiration',digestion:'Digestion',nerfs:'Système nerveux',muscles:'Muscles',reproduction:'Reproduction',soie:'Production de soie',exosquelette:'Exosquelette',tete:'Tête et crochets',bouche:'Bouche',patte1:'Pattes 1 · avant',patte2:'Pattes 2',patte3:'Pattes 3',patte4:'Pattes 4 · arrière'};
const $=id=>document.getElementById(id);
export class Interface {
  constructor(parts,actions){
    this.parts=parts;this.actions=actions;this.open=false;this.selected=null;
    $('part-count').textContent=`${parts.length} parties`;
    const content=document.createElement('div');$('atlas-list').append(content);this.entries=[];
    for(const [key,label] of Object.entries(groupNames)){
      const items=parts.filter(p=>p.data.groupe===key);if(!items.length)continue;
      const section=document.createElement('section');section.className='atlas-group';
      const heading=document.createElement('h3');heading.textContent=label;section.append(heading);
      for(const p of items){
        const button=document.createElement('button');button.className='atlas-entry';button.dataset.part=p.data.id;button.setAttribute('aria-pressed','false');
        const name=document.createElement('span');name.textContent=p.data.nom;
        const mark=document.createElement('span');mark.textContent='↗';mark.setAttribute('aria-hidden','true');button.append(name,mark);section.append(button);
        button.addEventListener('click',()=>{this.atlas(false);actions.select(p,true);$('part-close').focus({preventScroll:true});});
        this.entries.push({button,section,text:normalize(`${p.data.nom} ${p.data.terme} ${label}`)});
      }
      content.append(section);
    }
    if(window.Lenis)this.lenis=new Lenis({wrapper:$('atlas-list'),content,duration:1.2,syncTouch:false});
    $('atlas-toggle').addEventListener('click',()=>this.atlas(!this.open));
    $('atlas-close').addEventListener('click',()=>this.atlas(false));
    $('atlas-search').addEventListener('input',()=>this.filter());
    $('part-close').addEventListener('click',()=>{actions.select(null);$('scene').focus({preventScroll:true});});
    $('isolate').addEventListener('click',()=>actions.isolate());
    $('explode').addEventListener('click',()=>actions.explode());
    $('reset').addEventListener('click',()=>actions.reset());
    $('scalpel').addEventListener('input',e=>actions.cut(Number(e.target.value)/1000));
    document.querySelectorAll('[data-axis]').forEach(button=>button.addEventListener('click',()=>actions.axis(button.dataset.axis)));
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){if(this.open)this.atlas(false);else actions.select(null);}
      if(e.key==='Tab'&&this.open){
        const focusable=[...$('atlas').querySelectorAll('button,input,[tabindex="0"]')].filter(e=>!e.hidden&&e.getClientRects().length);
        const first=focusable[0],last=focusable.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
  }
  atlas(open){
    this.open=open;const panel=$('atlas');panel.classList.toggle('open',open);panel.inert=!open;
    $('atlas-toggle').setAttribute('aria-expanded',String(open));
    if(open){this.actions.gesture();$('atlas-search').focus({preventScroll:true});this.lenis?.resize();}
    else $('atlas-toggle').focus({preventScroll:true});
  }
  filter(){
    const query=normalize($('atlas-search').value);let count=0;
    for(const e of this.entries){e.button.hidden=!e.text.includes(query);if(!e.button.hidden)count++;}
    for(const section of new Set(this.entries.map(e=>e.section)))section.hidden=![...section.querySelectorAll('button')].some(b=>!b.hidden);
    $('atlas-empty').hidden=count!==0;this.lenis?.resize();
  }
  card(part,isolated){
    this.selected=part;const card=$('part-card');card.classList.toggle('open',!!part);card.inert=!part;
    document.body.classList.toggle('card-open',!!part);
    if(part){const d=part.data;$('part-group').textContent=groupNames[d.groupe];$('part-name').textContent=d.nom;$('part-term').textContent=d.terme;$('part-text').textContent=d.texte;$('announcer').textContent=d.nom;}
    $('isolate').textContent=isolated?'Tout retrouver ↙':'Isoler ↗';$('isolate').setAttribute('aria-pressed',String(isolated));
    this.entries.forEach(e=>e.button.setAttribute('aria-pressed',String(e.button.dataset.part===part?.data.id)));
  }
  rail(value,axis,exploded){
    if(value===this.railValue&&axis===this.railAxis&&exploded===this.railExploded)return;
    this.railValue=value;this.railAxis=axis;this.railExploded=exploded;
    const percentage=Math.round(value*100);$('rail-handle').style.left=`${value*100}%`;$('rail-progress').style.width=`${value*100}%`;
    const label=exploded?'Éclatée':value<.002?'Intacte':`Coupe · ${percentage} %`;
    $('cut-state').textContent=label;$('scalpel').setAttribute('aria-valuetext',label);
    $('explode').setAttribute('aria-pressed',String(exploded));
    document.querySelectorAll('[data-axis]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.axis===axis)));
  }
}
function normalize(text){return text.toLowerCase().replace(/œ/g,'oe').replace(/æ/g,'ae').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
