/* Garde-fou : aucun exercice ne doit lire les listes complètes.
   Tout ce qui sert à s'entraîner passe par TRAIN.*, sinon on propose
   du contenu d'un niveau non débloqué. Cette erreur s'est répétée
   plusieurs fois — ce test la rend impossible à laisser passer. */
import fs from 'fs';
const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/* fonctions qui alimentent ou comptabilisent un exercice */
const EXERCICES = ['buildSession','vnext','vprog','cnew','cscore','snext','fillScats','fillTrainCats'];

function corps(nom){
  const i = src.indexOf(`function ${nom}(`);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i), k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) break; }
  }
  return src.slice(j, k + 1);
}

let pass = 0, fail = 0;
const t = (n, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${n}${ok ? '' : '  → ' + detail}`);
  ok ? pass++ : fail++;
};

for (const nom of EXERCICES) {
  const b = corps(nom);
  if (b === null) { t(`${nom} existe`, false, 'fonction introuvable'); continue; }
  const fautes = b.split('\n')
    .map((l, i) => ({ l: l.trim(), i: i + 1 }))
    .filter(({ l }) => /(?<!TRAIN\.)(?<!TOTAL\.)\b(words|verbs|sentences)\(\)/.test(l))
    // seule porte de sortie : TOTAL.*, pour annoncer ce qui reste à débloquer
    .filter(({ l }) => !l.includes('lockedMsg') && !l.includes('TOTAL.'));
  t(`${nom} n'utilise que TRAIN.*`, fautes.length === 0,
    fautes.map(f => `ligne ${f.i} : ${f.l.slice(0, 60)}`).join(' | '));
}

t('TRAIN est bien défini', /const TRAIN = \{/.test(src), 'absent');
t('TRAIN filtre par niveau', /const inLevel = x => lvl\(x\) <= unlocked\(\)/.test(src), 'absent');
t('les anciens alias ont disparu', !/\btr(Words|Verbs|Sentences)\b/.test(src), 'trWords/trVerbs/trSentences encore présents');
t('TOTAL est isolé', /const TOTAL = \{/.test(src), 'absent');
t('le lexique reste non filtré', /fillCats\(lcat, .Toutes les catégories.\)/.test(src), 'le lexique doit tout montrer');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
