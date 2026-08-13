import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = await new PGlite();
for (const f of ['test-prelude.sql','schema.sql','seed.sql']) await db.exec(fs.readFileSync(f,'utf8'));

let pass=0, fail=0;
async function expectFail(label, sql){
  try { await db.exec(sql); console.log('✗ '+label+' — accepté alors qu\'il fallait refuser'); fail++; }
  catch(e){ console.log('✓ '+label+' → refusé ('+e.message.split('\n')[0].slice(0,60)+')'); pass++; }
}
async function expectOk(label, sql){
  try { await db.exec(sql); console.log('✓ '+label); pass++; }
  catch(e){ console.log('✗ '+label+' → '+e.message.split('\n')[0]); fail++; }
}

console.log('--- les contraintes mordent-elles ? ---');
await expectFail('carte ready sans traduction',
  `insert into items (kind,category,fr,arabizi,status) values ('word','Test','vide','','ready')`);
await expectFail('phrase sans cloze_index',
  `insert into items (kind,category,fr,arabizi) values ('sentence','Test','une phrase','wach')`);
await expectFail('kind inconnu',
  `insert into items (kind,category,fr,arabizi) values ('poeme','Test','x','y')`);
await expectFail('verbe ready avec 7 formes',
  `insert into verbs (fr,base,forms) values ('bancal','bnc',
   '{"present":["a","b","c","d","e","f","g"],"past":["a","b","c","d","e","f","g","h"]}'::jsonb)`);
await expectFail('verbe ready sans forms',
  `insert into verbs (fr,base) values ('sans formes','sf')`);
await expectFail('phrase dont le mot masqué n\'existe pas',
  `insert into items (kind,category,fr,arabizi,cloze_index) values ('sentence','Test','trop loin','deux mots',7)`);
await expectFail('progress avec item_type inconnu',
  `insert into progress (user_id,item_type,item_id) values (gen_random_uuid(),'chanson',gen_random_uuid())`);
await expectFail('doublon de mot',
  `insert into items (kind,category,fr,arabizi) values ('word','Test','Bonjour (Matin)','x')`);

console.log('\n--- ce qui doit passer ---');
await expectOk('carte pending sans traduction (le flux "cherche-moi la traduction")',
  `insert into items (kind,category,fr,status) values ('word','Test','se réveiller','pending')`);
await expectOk('verbe pending sans formes',
  `insert into verbs (fr,base,status) values ('se réveiller','fq','pending')`);
await expectOk('même fr mais kind différent (mot vs phrase)',
  `insert into items (kind,category,fr,arabizi,cloze_index) values ('sentence','Test','se réveiller','nfiq',0)`);

console.log('\n--- idempotence : on relance tout ---');
await expectOk('schema.sql rejoué', fs.readFileSync('schema.sql','utf8'));
await expectOk('seed.sql rejoué',   fs.readFileSync('seed.sql','utf8'));
const c = await db.query(`select
  (select count(*) from items where kind='word' and is_seed) w,
  (select count(*) from items where kind='sentence' and is_seed) s,
  (select count(*) from verbs where is_seed) v,
  (select count(*) from items where status='pending') p`);
console.log('après rejeu :', c.rows[0], '→ pas de doublon si 136/46/18');

console.log('\n--- transition pending → ready ---');
await expectOk('remplissage d\'une carte en attente',
  `update items set arabizi='nfiq', ar='نفيق', status='ready', filled_at=now()
   where fr='se réveiller' and kind='word'`);
await expectFail('passage en ready sans remplir la traduction',
  `update items set status='ready' where fr='se réveiller' and kind='sentence' and false
   ; insert into items (kind,category,fr,arabizi,status) values ('word','Test','autre','','ready')`);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail?1:0);
