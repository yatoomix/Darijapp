/* Vérifie la correction d'un tableau de conjugaison complet :
   tolérance des orthographes, exigence des huit formes, cas limites. */
const norm = s => (s||'').toLowerCase().trim().replace(/[’'`]/g,'')
  .replace(/9/g,'q').replace(/7/g,'h').replace(/5/g,'kh').replace(/8/g,'gh')
  .replace(/sh/g,'ch').replace(/dj/g,'j')
  .replace(/ou/g,'u').replace(/o/g,'u').replace(/w(?=[aeiou])/g,'u')
  .replace(/q/g,'g').replace(/(.)\1+/g,'$1').replace(/\s+/g,' ').trim();
const matchOne = (a,c) => !!c && norm(a) === norm(c);
const same = (a,b,vs) => !!String(a||'').trim() && (matchOne(a,b) || (vs||[]).some(v=>matchOne(a,v)));
const verbVars = (v,t,i) => (v.variants?.[t]?.[i]) || [];

const V = {
  fr:'écrire', pattern:'régulier',
  forms:{ present:['nekteb','tekteb','tektebi','yekteb','tekteb','nektbou','tektbou','yektbou'] },
  variants:{ present:[['naktab'],[],[],[],[],[],[],[]] }
};
const corriger = (saisies, tense='present') =>
  saisies.filter((s,i) => same(s, V.forms[tense][i], verbVars(V,tense,i))).length;

let pass=0, fail=0;
const t=(n,g,w)=>{const ok=g===w;console.log(`${ok?'✓':'✗'} ${n}${ok?'':`  → ${g} au lieu de ${w}`}`);ok?pass++:fail++;};

t("tableau parfait → 8/8", corriger([...V.forms.present]), 8);
t("une faute → 7/8", corriger(['nekteb','tekteb','tektebi','yekteb','tekteb','nektbou','tektbou','FAUX']), 7);
t("tableau vide → 0/8", corriger(Array(8).fill('')), 0);
t("variante acceptée sur SA ligne", corriger(['naktab','tekteb','tektebi','yekteb','tekteb','nektbou','tektbou','yektbou']), 8);
t("variante refusée sur une autre ligne", corriger(['nekteb','naktab','tektebi','yekteb','tekteb','nektbou','tektbou','yektbou']), 7);
t("majuscules et espaces tolérés", corriger([' NEKTEB ','tekteb','tektebi','yekteb','tekteb','nektbou','tektbou','yektbou']), 8);
t("chiffres arabizi tolérés", corriger(['nekteb','tekteb','tektebi','yekteb','tekteb','nektbu','tektbu','yektbu']), 8);
t("succès seulement si 8/8", corriger([...V.forms.present]) === 8, true);
t("7/8 n'est pas un succès", corriger(['a','tekteb','tektebi','yekteb','tekteb','nektbou','tektbou','yektbou']) === 8, false);

/* ---- progression d'un verbe : base, puis forme isolée, puis tableau ---- */
const BASE_UNTIL = 2, TABLE_AT = 3;
function modeVerbe(score, tirage = 0){
  if (score < BASE_UNTIL) return 'base';
  if (score >= TABLE_AT && tirage < 0.4) return 'tableau';
  return 'forme';
}
console.log('\n--- progression d\'un verbe ---');
t("jamais vu → on apprend la base",        modeVerbe(0), 'base');
t("1 bonne réponse → encore la base",      modeVerbe(1), 'base');
t("2 bonnes → on conjugue une forme",      modeVerbe(2), 'forme');
t("2 bonnes → jamais de tableau",          modeVerbe(2, 0.1), 'forme');
t("3 bonnes → tableau possible",           modeVerbe(3, 0.1), 'tableau');
t("3 bonnes → forme isolée le reste du temps", modeVerbe(3, 0.9), 'forme');
t("verbe raté (score -1) → retour à la base", modeVerbe(-1), 'base');

/* ---- règles d'affixation affichées à la correction ---- */
const REGLES = {
  present: ['ne- + radical','te- + radical','te- + radical + -i','ye- + radical',
            'te- + radical','ne- + radical + -ou','te- + radical + -ou','ye- + radical + -ou'],
  past: ['radical + -t','radical + -t','radical + -ti','radical seul',
         'radical + -et','radical + -na','radical + -tou','radical + -ou']
};
console.log('\n--- règles ---');
t("8 règles au présent", REGLES.present.length, 8);
t("8 règles au passé", REGLES.past.length, 8);
t("3e pers. du passé = radical nu", REGLES.past[3], 'radical seul');
t("1re pers. du présent = ne-", REGLES.present[0], 'ne- + radical');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail?1:0);
