/* Rejoue la logique de planification sur 365 jours de révision quotidienne
   et vérifie qu'aucune carte n'est abandonnée. */
const SR = { S0:1, M:2.2, DMAX:0.6, SMIN:0.2, SMAX:180, DUE:0.35,
             FLOOR_DAYS:80, FLOOR_PRIO:0.45, NEW:0.35, NEW_SHARE:0.3 };
const DAY = 86400000;
let NOW = Date.now();

const stability = e => {
  const n = e.ok + e.ko, fail = n ? e.ko/n : 0;
  return Math.max(SR.SMIN, Math.min(SR.SMAX,
    SR.S0 * Math.pow(SR.M, Math.max(0, e.score-1)) * (1 - SR.DMAX*fail)));
};
const daysSince = e => e.last ? (NOW - e.last)/DAY : Infinity;
const retention = e => { const t = daysSince(e); return isFinite(t) ? 1/(1 + t/(9*stability(e))) : 0; };
const priority = e => {
  if (!e.seen) return SR.NEW;
  let p = 1 - retention(e);
  if (daysSince(e) > SR.FLOOR_DAYS) p = Math.max(p, SR.FLOOR_PRIO);
  return p;
};
const noise = () => 0.85 + Math.random()*0.3;
function pickMany(list, n, maxNew){
  const sc = list.map(e => ({ e, isNew:!e.seen, p:priority(e)*noise() })).sort((a,b)=>b.p-a.p);
  const out=[]; let nw=0;
  for (const s of sc){ if(out.length>=n) break;
    if(s.isNew){ if(maxNew!=null && nw>=maxNew) continue; nw++; }
    out.push(s.e); }
  return out;
}

// 136 cartes, difficulté intrinsèque variable
const cards = Array.from({length:136}, (_,i) => ({
  id:i, ok:0, ko:0, score:0, seen:0, last:0,
  hard: i < 20 ? 0.55 : i < 60 ? 0.25 : 0.10   // proba d'échec de l'apprenant
}));

const JOURS = 365, PAR_JOUR = 10;
for (let d=0; d<JOURS; d++){
  NOW += DAY;
  for (const c of pickMany(cards, PAR_JOUR, Math.ceil(PAR_JOUR*SR.NEW_SHARE))){
    const bon = Math.random() > c.hard * (c.score>=3 ? 0.35 : 1);  // on s'améliore
    c.seen++; c.last = NOW;
    if (bon){ c.ok++; c.score = c.score<0 ? 1 : c.score+1; } else { c.ko++; c.score = -1; }
  }
}

const jamais = cards.filter(c => !c.seen);
const gaps = cards.filter(c => c.seen).map(c => (NOW - c.last)/DAY);
const vues = cards.filter(c=>c.seen);
const moy = a => a.reduce((s,x)=>s+x,0)/a.length;

console.log(`Après ${JOURS} jours à ${PAR_JOUR} cartes/jour (${JOURS*PAR_JOUR} révisions)\n`);
console.log('cartes jamais vues              :', jamais.length);
console.log('délai max depuis dernière revue :', Math.max(...gaps).toFixed(0), 'jours');
console.log('délai moyen                     :', moy(gaps).toFixed(1), 'jours');
console.log('cartes non vues depuis > 80 j   :', gaps.filter(g=>g>80).length);
console.log();
const grp = [['difficiles (0-19)',0,20],['moyennes (20-59)',20,60],['faciles (60-135)',60,136]];
console.log('groupe                 révisions/carte   réussite   dernier passage');
for (const [nom,a,b] of grp){
  const g = cards.slice(a,b).filter(c=>c.seen);
  const rev = moy(g.map(c=>c.seen)), acc = moy(g.map(c=>c.ok/(c.ok+c.ko)))*100;
  const last = moy(g.map(c=>(NOW-c.last)/DAY));
  console.log(`${nom.padEnd(22)} ${rev.toFixed(1).padStart(10)}   ${acc.toFixed(0).padStart(7)}%   ${last.toFixed(0).padStart(10)} j`);
}
console.log('\nles cartes difficiles doivent être révisées nettement plus souvent que les faciles');
