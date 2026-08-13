/* Rejoue la logique du routeur, dont le scénario exact du bug :
   naviguer, revenir par le geste iOS, puis ouvrir une autre page. */
let STACK = ['home'], current = 'home', booted = false;
const HIST = [];              // pile de l'historique du navigateur
let POS = -1;

function paint(id){ current = id; return true; }
function go(id, remplace){
  if (id === current && !remplace && booted) return;      // pas de doublon
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
  const id = (e.state && e.state.id) || STACK[i] || 'home';
  STACK = STACK.slice(0, i+1);
  STACK[i] = id;                                          // pile auto-réparée
  paint(id);
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

// --- les deux défauts signalés ---
console.log('\n--- défauts de navigation signalés ---');
go('home', true); go('vocab'); go('card'); back(); go('conj');
t("après retour, une nouvelle page n'y renvoie pas", current, 'conj');

go('home'); go('vocab'); go('vocab'); go('vocab');
back();
t("taper 3x la même tuile ne bloque pas le retour", current, 'home');

go('vocab'); go('card'); go('home');       // « retour à l'accueil » depuis la fin de séance
back();
t("retour depuis l'accueil regagné", current, 'card');
back();
t("puis vocabulaire", current, 'vocab');

/* ---- reprise de séance après consultation d'une fiche ---- */
console.log('\n--- séance : consulter une fiche puis revenir ---');
let SES = null;
const q = Array.from({length:20}, (_,i) => ({ type:'word', x:{id:'w'+i} }));
function startSession(neuve){
  if (!neuve && SES && SES.i < SES.q.length) return 'reprise-memoire';
  SES = { q, i:0, ok:0, miss:[] };
  return 'nouvelle';
}
let p2=0, f2=0;
const u=(n,g,w)=>{const ok=g===w;console.log(`${ok?'✓':'✗'} ${n}${ok?'':`  → ${g}`}`);ok?p2++:f2++;};

u("démarrage", startSession(), 'nouvelle');
SES.i = 7;                                  // on a répondu à 7 questions
u("consultation d'une fiche puis retour", startSession(), 'reprise-memoire');
u("position conservée", SES.i, 7);
u("bouton « nouvelle séance » repart de zéro", startSession(true), 'nouvelle');
u("compteur remis à zéro", SES.i, 0);
SES.i = 20;
u("séance terminée → une relance crée une nouvelle", startSession(), 'nouvelle');

console.log(`\n${pass + p2} réussis, ${fail + f2} échoués`);
process.exit((fail + f2) ? 1 : 0);
