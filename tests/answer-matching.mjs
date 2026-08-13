/* Vérifie la tolérance de la saisie : normalisation + orthographes acceptées. */
const norm = s => (s||'').toLowerCase().trim().replace(/[’'`]/g,'').replace(/\s+/g,' ')
  .replace(/9/g,'q').replace(/7/g,'h').replace(/5/g,'kh').replace(/8/g,'gh');
const normAr = s => (s||'')
  .replace(/[ً-ْٰـ]/g,'')
  .replace(/[آأإٱ]/g,'ا')
  .replace(/ى/g,'ي').replace(/ة/g,'ه')
  .replace(/ؤ/g,'و').replace(/ئ/g,'ي')
  .replace(/[^ء-ي]/g,'');
function matchOne(saisi, c){
  if (!c) return false;
  const a=norm(saisi), b=norm(c); if (a && a===b) return true;
  const x=normAr(saisi), y=normAr(c); return !!x && x===y;
}
function sameAnswer(saisi, attendu, script, variants){
  if (!String(saisi||'').trim()) return false;
  if (matchOne(saisi, attendu)) return true;
  return (variants||[]).some(v => matchOne(saisi, v));
}
const parseVariants = t => String(t||'').split(/[\n,;/]+/).map(v=>v.trim()).filter(Boolean)
  .filter((v,i,a)=>a.indexOf(v)===i).slice(0,12);

let pass=0, fail=0;
const t=(n,g,w)=>{const ok=g===w;console.log(`${ok?'✓':'✗'} ${n}`);ok?pass++:fail++;};

const V = parseVariants('khadam, khedem, 5edem');
console.log('variantes analysées :', JSON.stringify(V), '\n');

t("khedem (attendu)",            sameAnswer('khedem','khedem','arabizi',V), true);
t("khadam (variante)",           sameAnswer('khadam','khedem','arabizi',V), true);
t("5edem (chiffre → kh)",        sameAnswer('5edem','khedem','arabizi',V), true);
t("KHADAM (majuscules)",         sameAnswer('KHADAM','khedem','arabizi',V), true);
t("  khadam  (espaces)",         sameAnswer('  khadam  ','khedem','arabizi',V), true);
t("mot faux refusé",             sameAnswer('nakoul','khedem','arabizi',V), false);
t("vide refusé",                 sameAnswer('','khedem','arabizi',V), false);
t("sans variantes, strict",      sameAnswer('khadam','khedem','arabizi',[]), false);
t("3 et 7 normalisés",           sameAnswer('7ta3','7ta3','arabizi',[]), true);
t("9 → q",                       sameAnswer('9ahwa','qahwa','arabizi',[]), true);
t("variante en arabe acceptée",  sameAnswer('خدم','khedem','ar',['خدم']), true);
t("arabe : hamza tolérée",       sameAnswer('أنا','انا','ar',[]), true);
t("doublons retirés",            parseVariants('a, a, b').length, 2);
t("séparateurs multiples",       parseVariants('a / b ; c').length, 3);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail?1:0);
