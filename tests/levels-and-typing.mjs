/* Vérifie le déblocage des niveaux (hystérésis, régression, cartes perso)
   et la tolérance de la comparaison en arabe. */
const UNLOCK=0.50, RELOCK=0.40, MASTERED=3;
let pass=0, fail=0;
const t=(nom,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log(`${ok?'✓':'✗'} ${nom}${ok?'':`  → ${JSON.stringify(got)} au lieu de ${JSON.stringify(want)}`}`);
  ok?pass++:fail++; };

// ---------- niveaux ----------
function makeWorld(){
  const items=[]; let id=0;
  for (const [lvl,n] of [[1,30],[2,45],[3,61]])
    for(let i=0;i<n;i++) items.push({id:'s'+(id++), level:lvl, is_seed:true, status:'ready', score:0});
  return items;
}
function rate(items,n){
  const p=items.filter(i=>i.is_seed && i.status==='ready' && i.level===n);
  return p.length ? p.filter(i=>i.score>=MASTERED).length/p.length : 1;
}
function current(items, reached, manual=1){
  let n=1;
  while(n<3){ const seuil = reached>n?RELOCK:UNLOCK; if(rate(items,n)>=seuil) n++; else break; }
  return {n:Math.max(n,manual), reached:n};
}
function maitriser(items,lvl,k){ items.filter(i=>i.level===lvl).slice(0,k).forEach(i=>i.score=MASTERED); }

let w=makeWorld();
t("départ : niveau 1", current(w,1).n, 1);
maitriser(w,1,14);                       // 46 %
t("46 % du niveau 1 → toujours niveau 1", current(w,1).n, 1);
maitriser(w,1,15);                       // 50 %
let r=current(w,1); t("50 % → niveau 2 ouvert", r.n, 2);
// on redescend à 46 % : hystérésis, on garde l'accès
w.filter(i=>i.level===1).slice(0,15).forEach((i,k)=>{ if(k===14) i.score=-1; });
t("retour à 46 % avec accès acquis → on garde le niveau 2", current(w,2).n, 2);
// on tombe à 36 %
w.filter(i=>i.level===1).slice(0,15).forEach((i,k)=>{ if(k>=11) i.score=-1; });
t("chute à 36 % → régression au niveau 1", current(w,2).n, 1);
// déblocage manuel
t("déblocage manuel force le niveau 3", current(w,1,3).n, 3);

// cartes ajoutées à la main : ne doivent RIEN changer
w=makeWorld(); maitriser(w,1,15);
const avant=current(w,1).n;
for(let i=0;i<40;i++) w.push({id:'p'+i, level:1, is_seed:false, status:'ready', score:0});
t("40 cartes perso ajoutées → niveau inchangé", current(w,1).n, avant);

// niveau vide (tout mis en niveau 1 par l'utilisateur)
const plat=makeWorld().map(i=>({...i, level:1})); maitriser(plat,1,68);
t("tout en niveau 1, 50 % atteint → niveaux 2 et 3 vides donc ouverts", current(plat,1).n, 3);

// ---------- normalisation arabe ----------
const normAr = s => (s||'')
  .replace(/[ً-ْٰـ]/g,'')
  .replace(/[آأإٱ]/g,'ا')
  .replace(/ى/g,'ي').replace(/ة/g,'ه')
  .replace(/ؤ/g,'و').replace(/ئ/g,'ي')
  .replace(/[^ء-ي]/g,'');
const same=(a,b)=>normAr(a)===normAr(b) && normAr(b)!=='';

console.log();
t("hamza sur alef ignorée",        same("أنا","انا"), true);
t("voyelles brèves ignorées",      same("كَتَبَ","كتب"), true);
t("ta marbouta = ha",              same("عائلة","عائله"), true);
t("alef maqsura = ya",             same("مشى","مشي"), true);
t("espaces et ponctuation",        same("صباح  الخير!","صباحالخير"), true);
t("mot réellement faux refusé",    same("خبز","حوت"), false);
t("réponse vide refusée",          same("","خبز"), false);
t("tatweel ignoré",                same("خـــبز","خبز"), true);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail?1:0);
