/* Lance toutes les suites. À faire tourner avant chaque push. */
import { execFileSync } from 'child_process';
const suites = ['train-scope.mjs','wiring.mjs','router.mjs','answer-matching.mjs','levels-and-typing.mjs'];
let ko = 0;
for (const s of suites) {
  process.stdout.write(`\n=== ${s} ===\n`);
  try { process.stdout.write(execFileSync('node', [new URL(s, import.meta.url).pathname], {encoding:'utf8'})); }
  catch (e) { process.stdout.write(e.stdout || ''); ko++; }
}
console.log(ko ? `\n${ko} suite(s) en échec` : '\nToutes les suites passent.');
process.exit(ko ? 1 : 0);
