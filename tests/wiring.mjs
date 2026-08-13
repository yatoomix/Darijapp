/* Garde-fou : chaque contrôle interactif du HTML doit être branché dans
   app.js. La recherche a cessé de fonctionner parce que son écouteur
   avait été supprimé lors d'une refonte, sans que rien ne le signale. */
import fs from 'fs';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js   = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/* éléments qui n'ont de sens que branchés */
const interactifs = [...html.matchAll(/<(input|select|textarea|button)\b[^>]*id="([^"]+)"[^>]*>/g)]
  .map(m => ({ tag: m[1], id: m[2], balise: m[0] }))
  // les boutons pilotés par data-go ou data-* sont branchés en masse
  .filter(e => !/data-(go|l|t|sc|auth|theme-set|goal|script|k|del|close)=/.test(e.balise));

/* Un identifiant peut être utilisé directement, ou passé en chaîne à un
   utilitaire — setEye('seseye', …), boutonsNiveau('dcflvl', …). Les deux
   comptent comme branché ; ne pas apparaître du tout ne compte pas. */
const branché = id => new RegExp(`['"\`]${id}['"\`]`).test(js);

let pass = 0, fail = 0;
const orphelins = interactifs.filter(e => !branché(e.id));
for (const e of orphelins) { console.log(`✗ <${e.tag} id="${e.id}"> n'est branché nulle part`); fail++; }
if (!orphelins.length) { console.log(`✓ les ${interactifs.length} contrôles interactifs sont branchés`); pass++; }

/* les champs de recherche et de filtre doivent réagir à la frappe */
const reactifs = [
  ['lq',    'input'],
  ['lcat',  'change'],
  ['lstat', 'change'],
  ['llvl',  'change'],
  ['vcat',  'change'],
  ['scat',  'change']
];
for (const [id, ev] of reactifs) {
  const ok = new RegExp(`${id}\\.addEventListener\\('${ev}'`).test(js)
          || new RegExp(`\\[[^\\]]*\\b${id}\\b[^\\]]*\\]\\.forEach`).test(js)
          || new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('${ev}'`).test(js);
  console.log(`${ok ? '✓' : '✗'} ${id} réagit à « ${ev} »`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
