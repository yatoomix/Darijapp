/* Rejoue la logique du routeur, dont le scénario exact du bug :
   naviguer, revenir par le geste iOS, puis ouvrir une autre page. */
let STACK = ['home'], current = 'home', booted = false;
const HIST = [];              // pile de l'historique du navigateur
let POS = -1;

function paint(id){ current = id; return true; }
function go(id, remplace){
  if (remplace || !booted) STACK[STACK.length-1] = id; else STACK.push(id);
  paint(id);
  const etat = { i: STACK.length-1, id };
  if (remplace || !booted) { HIST[POS < 0 ? (POS=0) : POS] = etat; booted = true; }
  else { HIST.length = POS+1; HIST.push(etat); POS++; }
}
function back(){
  if (POS <= 0) return;
  POS--;
  const e = { state: HIST[POS] };
  const i = (e.state && typeof e.state.i === 'number') ? e.state.i : 0;
  STACK = STACK.slice(0, i+1);
  paint((e.state && e.state.id) || STACK[i] || 'home');
}

let pass=0, fail=0;
const t=(n,g,w)=>{const ok=g===w;console.log(`${ok?'✓':'✗'} ${n}${ok?'':`  → « ${g} » au lieu de « ${w} »`}`);ok?pass++:fail++;};

go('home', true);
t("démarrage",                        current, 'home');
go('vocab');   t("accueil → vocabulaire", current, 'vocab');
go('card');    t("vocabulaire → carte",   current, 'card');
back();        t("retour → vocabulaire",  current, 'vocab');
go('conj');    t("puis conjugaison (le bug : renvoyait sur carte)", current, 'conj');
back();        t("retour → vocabulaire",  current, 'vocab');
back();        t("retour → accueil",      current, 'home');

// enchaînement profond puis retours multiples
go('vocab'); go('card'); go('home'); go('compare');
t("navigation profonde", current, 'compare');
back(); t("retour 1", current, 'home');
back(); t("retour 2", current, 'card');
back(); t("retour 3", current, 'vocab');
back(); t("retour 4", current, 'home');

// deux cartes de suite depuis la liste
go('vocab'); go('card'); back(); go('card');
t("ouvrir une 2e carte après retour", current, 'card');
t("pile cohérente", STACK.join('>'), 'home>vocab>card');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail?1:0);
