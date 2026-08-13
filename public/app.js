/* ============================================================
   DerjApp — logique de l'app
   Local-first : tout s'écrit d'abord en local, la synchro suit.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://ypsnpwcznhcvfljuibnn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwc25wd2N6bmhjdmZsanVpYm5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MzU1OTcsImV4cCI6MjEwMjIxMTU5N30.nq_coVUWxAv1ndNGrTbvJpnFkV7IiphEYdIP-ZjGuVQ';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const SESSION_SIZE = { word: 8, verb: 4, sentence: 4, grammar: 4 };

/* ---------------- état ---------------- */
const K = { data:'derja.data', prog:'derja.prog', queue:'derja.queue', days:'derja.days',
            mode:'derja.mode', theme:'derja.theme', goal:'derja.goal', seenLessons:'derja.lessons',
            reached:'derja.reached', manual:'derja.manual', script:'derja.script',
            ses:'derja.ses' };
const ls = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

let SESSION = null;
let LOCAL_ONLY = ls.get(K.mode, null) === 'local';
let DATA  = ls.get(K.data,  null) || { items: window.SEED.items, verbs: window.SEED.verbs };
let PROG  = ls.get(K.prog,  {});
let DAYS  = ls.get(K.days,  {});
let QUEUE = ls.get(K.queue, {});
let syncState = 'idle';
let THEME = localStorage.getItem(K.theme) || 'light';   // stocké brut, lu aussi par le script d'amorçage
let DAILY_GOAL = ls.get(K.goal, 20);
let SEEN_LESSONS = ls.get(K.seenLessons, []);
let REACHED = ls.get(K.reached, 1);        // plus haut niveau atteint, pour l'hystérésis
let MANUAL_LEVEL = ls.get(K.manual, 1);    // déblocage forcé depuis les Paramètres
let SCRIPT = ls.get(K.script, 'arabizi');  // écriture attendue en saisie manuelle

const saveData  = () => ls.set(K.data, DATA);
const saveProg  = () => ls.set(K.prog, PROG);
const saveDays  = () => ls.set(K.days, DAYS);
const saveQueue = () => ls.set(K.queue, QUEUE);

/* ---------------- utilitaires ---------------- */
const $  = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtd = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today = () => fmtd(new Date());
const pct = o => o.seen ? Math.round(o.ok / o.seen * 100) : 0;
/* Normalisation de l'arabizi. Les équivalences systématiques sont traitées
   ici plutôt qu'en variantes carte par carte : chiffres et digrammes,
   ou/u, ch/sh, dj/j, et le q réalisé « g » en algérien. */
const norm = s => (s||'').toLowerCase().trim()
  .replace(/[’'`]/g,'')
  .replace(/9/g,'q').replace(/7/g,'h').replace(/5/g,'kh').replace(/8/g,'gh')
  .replace(/sh/g,'ch').replace(/dj/g,'j')
  .replace(/ou/g,'u').replace(/o/g,'u').replace(/w(?=[aeiou])/g,'u')
  .replace(/q/g,'g')
  .replace(/(.)\1+/g,'$1')
  .replace(/\s+/g,' ').trim();
const fold = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

function speak(t){
  try {
    if (!window.speechSynthesis || !t) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ar'; u.rate = .8;
    const v = (speechSynthesis.getVoices()||[]).find(x => (x.lang||'').startsWith('ar'));
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}
function vibrate(ms){ try { navigator.vibrate?.(ms); } catch {} }

/* ---------------- thème ---------------- */
function resolveTheme(t){
  return t === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : t;
}
function applyTheme(t){
  const real = resolveTheme(t);
  document.documentElement.setAttribute('data-theme', real === 'dark' ? 'dark' : '');
  if (real !== 'dark') document.documentElement.removeAttribute('data-theme');
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', real === 'dark' ? '#0d1524' : '#f7f4ef');
  document.querySelectorAll('#themetabs [data-theme-set]').forEach(b =>
    b.classList.toggle('pri', b.dataset.themeSet === t));
}
async function setTheme(t){
  THEME = t;
  try { localStorage.setItem(K.theme, t); } catch {}
  applyTheme(t);
  if (SESSION) await sb.from('profiles').update({ theme: t }).eq('id', SESSION.user.id);
}
// si le téléphone bascule pendant l'usage et qu'on est en « auto »
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (THEME === 'auto') applyTheme('auto');
});

/* --- animations --- */
/* Les retours visuels passent par le message et la couleur du champ.
   Pas d'animation : elles scintillaient et masquaient l'information. */
function burst(){ vibrate(12); }
function shake(el){
  if (!el) return;
  el.classList.add('wrong');
  setTimeout(() => el.classList.remove('wrong'), 1400);
}

/* ---------------- données ---------------- */
/* ---------------- niveaux ----------------
   Le niveau filtre ce qui est éligible ; la répétition espacée
   ordonne ce qui est urgent. Les deux ne se marchent pas dessus,
   et un niveau débloqué ne se referme jamais. */
const UNLOCK = 0.50;   // on ouvre le niveau suivant à 50 % de maîtrise
const RELOCK = 0.40;   // on ne referme qu'en dessous de 40 % : sans cet écart,
                       // une seule carte ratée ferait osciller le niveau à chaque séance
const NIVEAUX = 5;     // paliers de progression
const MASTERED = 3;    // bonnes réponses consécutives
const TYPED_AT = 4;    // au-delà, la carte passe en saisie manuelle

const lvl = x => (x.level || 1);

// seul le contenu initial sert de jauge : les cartes ajoutées à la main
// restent visibles mais ne peuvent ni bloquer ni diluer la progression
function levelDone(n){
  const items = DATA.items.filter(i => i.status === 'ready' && i.is_seed && lvl(i) === n);
  const vbs   = DATA.verbs.filter(v => v.status === 'ready' && v.forms && v.is_seed && lvl(v) === n);
  const total = items.length + vbs.length;
  if (!total) return { ok: 0, total: 0, rate: 1 };
  const ok = items.filter(x => get('item', x.id).score >= MASTERED).length
           + vbs.filter(x => get('verb', x.id).score >= MASTERED).length;
  return { ok, total, rate: ok / total };
}

function currentLevel(){
  let n = 1;
  while (n < NIVEAUX) {
    const seuil = REACHED > n ? RELOCK : UNLOCK;   // hystérésis
    if (levelDone(n).rate >= seuil) n++; else break;
  }
  if (n !== REACHED) { REACHED = n; ls.set(K.reached, n); }
  return Math.max(n, MANUAL_LEVEL);
}
const unlocked = () => currentLevel();

/* Consultation : tout est visible, toujours. Rien ne disparaît. */
const words     = () => DATA.items.filter(i => i.kind === 'word'     && i.status === 'ready');
const sentences = () => DATA.items.filter(i => i.kind === 'sentence' && i.status === 'ready');
const grammar   = () => DATA.items.filter(i => i.kind === 'grammar'  && i.status === 'ready');
const verbs     = () => DATA.verbs.filter(v => v.status === 'ready' && v.forms);

/* Entraînement : seul le niveau atteint est proposé. Le niveau ne cache
   rien dans l'app, il décide seulement de ce sur quoi on te teste. */
/* Quand un exercice est vide, il faut dire POURQUOI : verrouillé par le
   niveau, ou réellement sans contenu. Un « aucune phrase » sec laisse
   croire à un bug. */
function lockedMsg(total, dispo){
  if (dispo) return null;
  if (!total) return 'Aucun contenu pour l\'instant.';
  const n = unlocked(), d = levelDone(n);
  const cible = Math.ceil(d.total * UNLOCK);
  return `🔒 Continue de t'entraîner pour débloquer ça — ${d.ok} / ${cible} cartes du niveau ${n} maîtrisées.`;
}

/* TOUT ce qui sert à s'entraîner passe par TRAIN, et rien d'autre.
   Le filtre de niveau était dispersé dans chaque exercice et chaque
   compteur : il finissait toujours par en manquer un. Un test vérifie
   maintenant qu'aucun exercice n'appelle les listes complètes. */
const inLevel = x => lvl(x) <= unlocked();
const TRAIN = {
  words:     () => words().filter(inLevel),
  verbs:     () => verbs().filter(inLevel),
  sentences: () => sentences().filter(inLevel),
  grammar:   () => grammar().filter(inLevel),
  cats:      () => [...new Set(TRAIN.words().map(w => w.category))].sort(),
  catsPhr:   () => [...new Set(TRAIN.sentences().map(x => x.category))].sort()
};

/* Seul endroit autorisé à lire les listes complètes depuis un exercice :
   savoir combien de contenu existe au total, pour dire à l'utilisateur
   ce qu'il lui reste à débloquer. */
const TOTAL = {
  words:     c => words().filter(w => c === '*' || w.category === c).length,
  sentences: c => sentences().filter(x => c === '*' || x.category === c).length,
  verbs:     () => verbs().length,
  grammar:   () => grammar().length
};
const pending   = () => [...DATA.items.filter(i => i.status === 'pending'),
                         ...DATA.verbs.filter(v => v.status === 'pending')];

const pkey = (type, id) => type + ':' + id;
const get  = (type, id) => PROG[pkey(type,id)] || { ok:0, ko:0, score:0, seen:0, last:0 };

function rec(type, id, correct){
  const k = pkey(type, id);
  const e = PROG[k] || { ok:0, ko:0, score:0, seen:0, last:0 };
  e.seen++; e.last = Date.now();
  if (correct) { e.ok++; e.score = e.score < 0 ? 1 : e.score + 1; }
  else         { e.ko++; e.score = -1; }
  PROG[k] = e;
  DAYS[today()] = (DAYS[today()] || 0) + 1;
  QUEUE[k] = { item_type: type, item_id: id, ...e };
  saveProg(); saveDays(); saveQueue();
  schedulePush();
  return e;
}

/* ============================================================
   PLANIFICATION — répétition espacée
   On ne priorise pas sur la performance passée mais sur la
   probabilité d'avoir oublié la carte maintenant. Une carte
   parfaitement sue redevient prioritaire par le simple passage
   du temps, ce qui évite de ne plus jamais la revoir.
   ============================================================ */
const SR = {
  S0: 1,          // stabilité de départ, en jours
  M: 2.2,         // multiplicateur par bonne réponse consécutive
  DMAX: 0.6,      // pénalité maximale liée au taux d'échec
  SMIN: 0.2,
  SMAX: 180,
  DUE: 0.35,      // seuil à partir duquel une carte est « à revoir »
  FLOOR_DAYS: 80, // au-delà, toute carte remonte quoi qu'il arrive
  FLOOR_PRIO: 0.45,
  NEW: 0.35,      // priorité d'une carte jamais vue
  NEW_SHARE: 0.3  // part maximale de cartes neuves dans une séance
};
const DAY = 86400000;

// combien de temps la carte tient en mémoire, en jours
function stability(e){
  const n = e.ok + e.ko;
  const fail = n ? e.ko / n : 0;
  const s = SR.S0 * Math.pow(SR.M, Math.max(0, e.score - 1)) * (1 - SR.DMAX * fail);
  return Math.max(SR.SMIN, Math.min(SR.SMAX, s));
}
const daysSince = e => e.last ? (Date.now() - e.last) / DAY : Infinity;

// courbe d'oubli, calibrée pour tomber à 90 % quand t atteint la stabilité
function retention(e){
  const t = daysSince(e);
  return isFinite(t) ? 1 / (1 + t / (9 * stability(e))) : 0;
}
function priority(e){
  if (!e.seen) return SR.NEW;
  let p = 1 - retention(e);
  if (daysSince(e) > SR.FLOOR_DAYS) p = Math.max(p, SR.FLOOR_PRIO);
  return p;
}
// dans combien de jours la carte redevient-elle prioritaire (pour l'affichage)
function dueInDays(e){
  if (!e.seen) return 0;
  const target = Math.min(9 * stability(e) * SR.DUE / (1 - SR.DUE), SR.FLOOR_DAYS);
  return Math.max(0, Math.round(target - daysSince(e)));
}

/* ============================================================
   SAISIE MANUELLE
   ============================================================ */
/* On compare des formes normalisées : sans ça, l'app refuserait
   une bonne réponse pour une hamza ou une voyelle brève invisible. */
const normAr = s => (s || '')
  .replace(/[ً-ْٰـ]/g, '')   // voyelles brèves, shadda, tatweel
  .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
  .replace(/ى/g, 'ي')                   // ى → ي
  .replace(/ة/g, 'ه')                   // ة → ه
  .replace(/ؤ/g, 'و')                   // ؤ → و
  .replace(/ئ/g, 'ي')                   // ئ → ي
  .replace(/[^ء-ي]/g, '');              // ponctuation, espaces, chiffres

/* Une réponse est juste si elle correspond à l'écriture attendue OU à
   l'une des orthographes acceptées. Chaque candidate est testée dans les
   deux normalisations : une variante peut être en arabizi ou en arabe. */
function matchOne(saisi, candidate){
  if (!candidate) return false;
  const a = norm(saisi), b = norm(candidate);
  if (a && a === b) return true;
  const x = normAr(saisi), y = normAr(candidate);
  return !!x && x === y;
}
function sameAnswer(saisi, attendu, script, variants){
  if (!String(saisi || '').trim()) return false;
  if (matchOne(saisi, attendu)) return true;
  return (variants || []).some(v => matchOne(saisi, v));
}
/* Quand une réponse est refusée mais que l'utilisateur sait qu'elle est
   valable, il l'ajoute d'un geste : la carte apprend, et la réponse
   compte comme juste. Sinon on désapprend en croyant se corriger. */
async function addVariant(obj, table, texte){
  const v = String(texte || '').trim();
  if (!v || (obj.variants || []).includes(v)) return false;
  obj.variants = [...(obj.variants || []), v].slice(0, 12);
  saveData();
  if (SESSION && !String(obj.id).startsWith('seed:') && !String(obj.id).startsWith('local:')) {
    const { error } = await sb.from(table).update({ variants: obj.variants }).eq('id', obj.id);
    if (error) return false;
  }
  return true;
}

/* Propose le bouton dans le retour d'erreur et laisse le temps de cliquer. */
/* Pas de minuteur : une attente qu'on ne contrôle pas donne l'impression
   que l'app a figé. On avance quand on a fini de lire. */
function suiteApresErreur(html, onVariant, valider){
  $('sesfb').insertAdjacentHTML('beforeend',
    `<div class="row" style="margin-top:12px">
       <button class="act pri" id="nextbtn">Continuer →</button>
       ${html}
     </div>`);
  let fait = false;
  $('nextbtn').onclick = () => { if (!fait) { fait = true; valider(false); } };
  const vb = $('varbtn');
  if (vb) vb.onclick = async () => {
    if (fait) return; fait = true;
    await onVariant();
    vibrate(14);
    $('sesfb').innerHTML = '<div class="fb ok">✓ Orthographe ajoutée.</div>';
    setTimeout(() => valider(true), 500);
  };
}
const btnVariant = '<button class="act" id="varbtn" style="font-size:13px">✍️ Autre orthographe correcte</button>';

function offerVariant(obj, table, saisi, valider){
  const txt = String(saisi || '').trim();
  suiteApresErreur(txt ? btnVariant : '', () => addVariant(obj, table, txt), valider);
}

const verbVars = (v, tense, i) => (v.variants && v.variants[tense] && v.variants[tense][i]) || [];

/* Pour un verbe, la variante s'écrit dans SA case : accepter « khadam »
   partout reviendrait à valider une conjugaison fausse. */
async function addVerbVariant(v, tense, i, texte){
  const t = String(texte || '').trim();
  if (!t) return false;
  const obj = JSON.parse(JSON.stringify(v.variants || {}));
  if (!Array.isArray(obj[tense])) obj[tense] = Array.from({length:8}, () => []);
  if (!Array.isArray(obj[tense][i])) obj[tense][i] = [];
  if (obj[tense][i].includes(t)) return false;
  obj[tense][i] = [...obj[tense][i], t].slice(0, 8);
  v.variants = obj; saveData();
  if (SESSION && !String(v.id).startsWith('seed:')) {
    const { error } = await sb.from('verbs').update({ variants: obj }).eq('id', v.id);
    if (error) return false;
  }
  return true;
}
function offerVerbVariant(v, tense, i, saisi, valider){
  const txt = String(saisi || '').trim();
  suiteApresErreur(txt ? btnVariant : '', () => addVerbVariant(v, tense, i, txt), valider);
}

const parseVariants = t => String(t || '')
  .split(/[\n,;/]+/).map(v => v.trim()).filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);

/* Clavier arabe intégré : iOS ne permet pas de changer la langue du clavier
   depuis une page web, et la plupart des gens n'ont pas de clavier arabe
   installé. On l'affiche sous le champ, jamais par-dessus. */
const AR_KEYS = [
  'ا','ب','ت','ث','ج','ح','خ',
  'د','ذ','ر','ز','س','ش','ص',
  'ض','ط','ظ','ع','غ','ف','ق',
  'ك','ل','م','ن','ه','و','ي',
  'ء','أ','إ','آ','ة','ى','ؤ'
];

let KP = null, KP_INPUT = null;

function buildKeypad(){
  const el = document.createElement('div');
  el.className = 'keypad';
  el.innerHTML = AR_KEYS.map(k => `<button type="button" class="key" data-k="${k}">${k}</button>`).join('')
    + '<button type="button" class="key wide" data-k=" ">espace</button>'
    + '<button type="button" class="key wide" data-del>⌫</button>'
    + '<button type="button" class="key close" data-close>✕</button>';
  el.addEventListener('mousedown', e => e.preventDefault());  // ne pas voler le focus
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    e.preventDefault();
    if (b.hasAttribute('data-close')) return closeKeypad();
    if (!KP_INPUT) return;
    if (b.hasAttribute('data-del')) KP_INPUT.value = KP_INPUT.value.slice(0, -1);
    else KP_INPUT.value += b.dataset.k;
    KP_INPUT.dispatchEvent(new Event('input', { bubbles: true }));
    vibrate(8);
  });
  document.body.appendChild(el);
  return el;
}

/* Le clavier est fixé en bas : on décale le bas de page d'autant,
   sinon il masquerait le champ ou le bouton Valider. */
function openKeypad(input){
  if (!KP) KP = buildKeypad();
  KP_INPUT = input;
  KP.style.display = 'grid';
  requestAnimationFrame(() => {
    document.body.style.paddingBottom = KP.offsetHeight + 16 + 'px';
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
function closeKeypad(){
  if (KP) KP.style.display = 'none';
  KP_INPUT = null;
  document.body.style.paddingBottom = '';
  document.querySelectorAll('[data-kp-open]').forEach(b => {
    b.removeAttribute('data-kp-open'); b.textContent = '⌨️ Clavier arabe';
  });
}
const keypadOpen = () => !!KP_INPUT;

/* Rend le clavier disponible sur n'importe quel champ arabe de l'app —
   ajout de carte, correction — sans attendre d'atteindre une carte à saisie. */
function withKeypad(input){
  if (!input || input.dataset.kp) return;
  input.dataset.kp = '1';
  const bar = document.createElement('div');
  bar.className = 'row'; bar.style.marginTop = '7px';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'act';
  btn.style.cssText = 'padding:7px 12px;font-size:12.5px';
  btn.textContent = '⌨️ Clavier arabe';
  bar.appendChild(btn);
  input.after(bar);
  btn.onclick = () => {
    if (btn.hasAttribute('data-kp-open')) return closeKeypad();
    closeKeypad();
    btn.setAttribute('data-kp-open', '1');
    btn.textContent = '⌨️ Masquer le clavier';
    openKeypad(input);
  };
  input.addEventListener('focus', () => { if (!keypadOpen()) btn.click(); });
}

// champ de saisie adapté à l'écriture demandée
function answerField(script){
  const i = document.createElement('input');
  i.type = 'text'; i.id = 'typed';
  i.autocomplete = 'off'; i.spellcheck = false;
  i.setAttribute('autocapitalize', 'off');
  i.setAttribute('autocorrect', 'off');
  if (script === 'ar') {
    i.dir = 'rtl'; i.lang = 'ar';
    i.placeholder = 'اكتب هنا';
    i.inputMode = 'none';        // empêche le clavier du système de recouvrir l'écran
    i.style.fontSize = '24px';
    i.style.fontFamily = '"Geeza Pro","Noto Naskh Arabic",serif';
  } else {
    i.placeholder = 'La traduction en arabizi…';
  }
  return i;
}

// ±15 % : deux séances ne sont jamais identiques, sans casser l'ordre
const noise = () => 0.85 + Math.random() * 0.3;

function pick(list, type){
  if (!list.length) return null;
  let best = null, bestW = -1;
  for (const x of list) {
    // le +0.001 garantit qu'on renvoie toujours une carte, même tout juste révisée
    const w = (priority(get(type, x.id)) + 0.001) * noise();
    if (w > bestW) { bestW = w; best = x; }
  }
  return best;
}

// tire n cartes distinctes, les plus urgentes d'abord, en limitant les nouveautés
function pickMany(list, type, n, maxNew){
  const scored = list.map(x => {
    const e = get(type, x.id);
    return { x, isNew: !e.seen, p: priority(e) * noise() };
  }).sort((a, b) => b.p - a.p);

  const out = [];
  let nouvelles = 0;
  for (const s of scored) {
    if (out.length >= n) break;
    if (s.isNew) {
      if (maxNew != null && nouvelles >= maxNew) continue;
      nouvelles++;
    }
    out.push(s.x);
  }
  // s'il reste de la place (peu de cartes disponibles), on complète
  if (out.length < n) for (const s of scored) {
    if (out.length >= n) break;
    if (!out.includes(s.x)) out.push(s.x);
  }
  return out;
}

function streak(){
  let n = 0; const d = new Date();
  if (!DAYS[fmtd(d)]) d.setDate(d.getDate()-1);
  while (DAYS[fmtd(d)]) { n++; d.setDate(d.getDate()-1); }
  return n;
}

/* ---------------- synchronisation ---------------- */
let pushTimer = null;
function schedulePush(){
  if (!SESSION || pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; push(); }, 8000);
}

async function push(){
  if (!SESSION) return;
  const keys = Object.keys(QUEUE);
  if (!keys.length) return;
  const rows = keys.map(k => ({
    user_id: SESSION.user.id,
    item_type: QUEUE[k].item_type, item_id: QUEUE[k].item_id,
    ok: QUEUE[k].ok, ko: QUEUE[k].ko, score: QUEUE[k].score, seen: QUEUE[k].seen,
    last_at: new Date(QUEUE[k].last || Date.now()).toISOString(),
    updated_at: new Date().toISOString()
  })).filter(r => !String(r.item_id).startsWith('seed:') && !String(r.item_id).startsWith('local:'));

  if (!rows.length) { QUEUE = {}; saveQueue(); return; }
  setSync('syncing');
  const { error } = await sb.from('progress').upsert(rows, { onConflict: 'user_id,item_type,item_id' });
  if (error) { setSync('error'); return; }

  const d = today();
  if (DAYS[d]) await sb.from('activity').upsert(
    { user_id: SESSION.user.id, day: d, answers: DAYS[d] }, { onConflict: 'user_id,day' });

  for (const k of keys) delete QUEUE[k];
  saveQueue(); setSync('idle');
}

async function pull(){
  if (!SESSION) return;
  setSync('syncing');
  const [it, vb, pr, ac] = await Promise.all([
    sb.from('items').select('*').order('category'),
    sb.from('verbs').select('*').order('fr'),
    sb.from('progress').select('*'),
    sb.from('activity').select('*')
  ]);
  if (it.error || vb.error || pr.error) { setSync('error'); return; }

  DATA = { items: it.data, verbs: vb.data }; saveData();
  for (const r of pr.data) {
    const k = pkey(r.item_type, r.item_id);
    const local = PROG[k];
    const remote = { ok:r.ok, ko:r.ko, score:r.score, seen:r.seen, last:r.last_at ? Date.parse(r.last_at) : 0 };
    if (!local || (!QUEUE[k] && remote.seen >= local.seen)) PROG[k] = remote;
  }
  for (const r of ac.data) DAYS[r.day] = Math.max(DAYS[r.day] || 0, r.answers);
  saveProg(); saveDays();
  setSync('idle'); renderAll();
}

function setSync(s){ syncState = s; renderWho(); }

/* ---------------- routeur ----------------
   La pile est la référence, pas l'URL. Reconstruire la vue depuis
   location.hash se désynchronisait dès que le geste de retour d'iOS
   arrivait après un clic : on retombait sur la page précédente. */
let current = 'home';
let booted = false;
let STACK = ['home'];

function paint(id){
  const v = $('v-' + id);
  if (!v) return false;
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on'));
  v.classList.add('on');
  $('hdr').classList.toggle('show', id !== 'home');
  $('htitle').textContent = window.TITLES[id] || '';
  current = id;
  closeKeypad();
  window.scrollTo(0, 0);
  onEnter(id);
  return true;
}

function go(id, remplace){
  if (!$('v-' + id)) return;
  if (remplace || !booted) STACK[STACK.length - 1] = id;
  else STACK.push(id);
  paint(id);
  const etat = { i: STACK.length - 1, id };
  if (remplace || !booted) { history.replaceState(etat, '', '#' + id); booted = true; }
  else history.pushState(etat, '', '#' + id);
}

window.addEventListener('popstate', e => {
  const i = (e.state && typeof e.state.i === 'number') ? e.state.i : 0;
  STACK = STACK.slice(0, i + 1);
  const id = (e.state && e.state.id) || STACK[i] || 'home';
  if (!paint(id)) { STACK = ['home']; paint('home'); }
});

function onEnter(id){
  if (id === 'home')    renderHome();
  if (id === 'vocab')   { vnext(); renderLex(); }
  if (id === 'conj')    { renderVerbList(); cnew(); cscore(); }
  if (id === 'phr')     { fillScats(); snext(); }
  if (id === 'stats')   renderStats();
  if (id === 'compare') renderCompare();
  if (id === 'add')     fillForm();
  if (id === 'account') renderAccount();
  if (id === 'gram')    { fillLessons(); gxnext(); }
  if (id === 'card')    renderCard();
  if (id === 'verb')    renderVerb();
  if (id === 'session') startSession();
  if (id !== 'gram' && $('lesson')) closeLessons();
}
$('back').addEventListener('click', () => history.back());
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

/* ---------------- accueil ---------------- */
function renderHome(){
  const st = streak(), t = DAYS[today()] || 0;
  const done = t >= DAILY_GOAL;
  $('hflame').innerHTML = st ? `<b>${st}</b><span>jour${st>1?'s':''} 🔥</span>` : '';
  $('herod').textContent = done
    ? `Objectif atteint : ${t} réponses aujourd'hui. Tu peux continuer.`
    : t ? `${t} sur ${DAILY_GOAL} réponses aujourd'hui.`
        : `${DAILY_GOAL} questions mêlant vocabulaire, conjugaison et phrases.`;
  $('heroprog').style.width = Math.min(100, Math.round(t / DAILY_GOAL * 100)) + '%';
  $('herogo').textContent = done ? 'Refaire une séance' : t ? 'Continuer' : 'Commencer';
  document.querySelector('.hero').classList.toggle('done', done);

  const w = words(), sn = sentences(), vb = verbs();
  const mast = w.filter(x => get('item', x.id).score >= 3).length;
  $('tvocab').textContent = `${mast} / ${w.length} maîtrisés`;
  $('bvocab').style.width = (w.length ? Math.round(mast/w.length*100) : 0) + '%';
  $('tconj').textContent = `${vb.length} verbes`;
  $('tphr').textContent  = `${sn.length} phrases`;
  $('tlex').textContent  = `${DATA.items.length} cartes`;
  const p = pending().length;
  if (p) $('tlex').innerHTML = `${DATA.items.length} cartes · <span class="pill w">${p} à traduire</span>`;
  const n = unlocked(), d = levelDone(Math.min(n, NIVEAUX));
  $('tlevel').innerHTML = n >= NIVEAUX && d.rate >= UNLOCK
    ? `Niveau ${NIVEAUX} · tout le contenu est ouvert`
    : `Niveau ${n} · <b>${d.ok}/${d.total}</b> maîtrisés — ${Math.round(d.rate*100)} %`;
  $('blevel').style.width = Math.round(Math.min(1, d.rate / UNLOCK) * 100) + '%';
  $('tstats').textContent = st ? `${st} j de série` : 'Tes chiffres';
  $('tcompare').textContent = SESSION ? 'Compare-toi aux autres membres.' : 'Nécessite un compte.';
  renderVer();
}
function renderVer(){ const v = $('vmode'); if (v) v.textContent = SESSION ? 'connecté' : (LOCAL_ONLY ? 'mode local' : 'déconnecté'); }

function renderWho(){
  const dot = $('sdot'), who = $('swho');
  if (!dot) return;
  if (SESSION) {
    const n = Object.keys(QUEUE).length;
    dot.className = 'dot ' + (syncState === 'error' ? 'off' : 'on');
    who.textContent = syncState === 'syncing' ? 'synchro…' : syncState === 'error' ? 'hors ligne' : n ? `${n} en attente` : 'à jour';
  } else { dot.className = 'dot'; who.textContent = 'mode local'; }
  renderVer();
}

/* ============================================================
   SÉANCE DU JOUR
   ============================================================ */
let SES = null;

function buildSession(){
  const cap = n => Math.max(1, Math.ceil(n * SR.NEW_SHARE));
  const q = [
    ...pickMany(TRAIN.words(),     'item', SESSION_SIZE.word,     cap(SESSION_SIZE.word)).map(x => ({ type:'word', x })),
    ...pickMany(TRAIN.verbs(),     'verb', SESSION_SIZE.verb,     cap(SESSION_SIZE.verb)).map(x => ({ type:'verb', x })),
    ...pickMany(TRAIN.sentences(), 'item', SESSION_SIZE.sentence, cap(SESSION_SIZE.sentence)).map(x => ({ type:'sentence', x })),
    ...pickMany(TRAIN.grammar(),   'item', SESSION_SIZE.grammar,  cap(SESSION_SIZE.grammar)).map(x => ({ type:'grammar', x }))
  ];

  /* Au niveau 1, verbes et phrases sont verrouillés : sans ce complément
     la séance ne ferait que 10 questions au lieu des 20 annoncées. */
  const vise = Object.values(SESSION_SIZE).reduce((a,b) => a+b, 0);
  if (q.length < vise) {
    const deja = new Set(q.map(e => e.x.id));
    const rab = pickMany(TRAIN.words().filter(w => !deja.has(w.id)), 'item',
                         vise - q.length, cap(vise - q.length));
    q.push(...rab.map(x => ({ type:'word', x })));
  }
  return shuffle(q);
}

function saveSes(){
  if (!SES) return;
  ls.set(K.ses, { day: today(), i: SES.i, ok: SES.ok, miss: SES.miss,
                  startStreak: SES.startStreak,
                  q: SES.q.map(e => ({ t: e.type, id: e.x.id })) });
}
/* On ne garde que des identifiants : si le contenu a changé entre-temps,
   on repart proprement sur une séance neuve plutôt que sur une carte fantôme. */
function loadSes(){
  const r = ls.get(K.ses, null);
  if (!r || r.day !== today() || r.i >= r.q.length) return null;
  const q = r.q.map(e => {
    const x = e.t === 'verb' ? DATA.verbs.find(v => v.id === e.id)
                             : DATA.items.find(i => i.id === e.id);
    return x ? { type: e.t, x } : null;
  });
  if (q.some(e => !e)) return null;
  return { q, i: r.i, ok: r.ok, miss: r.miss || [], startStreak: r.startStreak || 0 };
}

function startSession(neuve){
  // retour depuis une fiche : on reprend la question en cours, sans message
  if (!neuve && SES && SES.i < SES.q.length) {
    $('sesrun').style.display = ''; $('sesdone').style.display = 'none';
    return sesStep();
  }
  const reprise = neuve ? null : loadSes();
  SES = reprise || { q: buildSession(), i: 0, ok: 0, miss: [], startStreak: streak() };
  if (!neuve && reprise) $('sesfb').innerHTML =
    `<div class="fb ok">Séance reprise à la question ${reprise.i + 1}.</div>`;
  $('sesrun').style.display = ''; $('sesdone').style.display = 'none';
  if (!SES.q.length) { $('sesq').textContent = 'Aucun contenu disponible.'; return; }
  sesStep();
}

/* Ouvre la fiche de l'élément en cours. Le retour reprend la séance
   exactement où elle en était : la position est enregistrée à chaque
   question, pas seulement à chaque réponse. */
function setEye(btn, type, x){
  const b = $(btn);
  if (!b) return;
  b.style.display = x ? '' : 'none';
  b.onclick = () => { if (type === 'verb') openVerb(x.id); else openCard(x.id); };
}

function setSpeak(txt){
  const b = $('sesspk');
  if (!b) return;
  b.style.display = txt ? '' : 'none';
  b.onclick = () => speak(txt);
}

function sesStep(){
  closeKeypad();
  if (SES.i >= SES.q.length) return sesEnd();
  const { type, x } = SES.q[SES.i];
  saveSes();                       // la position est retenue avant même de répondre
  setEye('seseye', type, null);   // masqué tant que la réponse n'est pas dévoilée
  $('sescount').textContent = `Question ${SES.i+1} sur ${SES.q.length}`;
  $('sestype').textContent = { word:'Vocabulaire', verb:'Conjugaison',
    sentence:'Phrase', grammar:'Grammaire' }[type] || '';
  $('sesbarfill').style.width = Math.round(SES.i / SES.q.length * 100) + '%';
  $('sesfb').innerHTML = '';
  setSpeak(null);                     // pas d'audio tant que la réponse est cachée

  if (type === 'word') {
    $('seslbl').textContent = x.category;
    $('sesq').textContent = x.fr;
    const e = get('item', x.id);

    // au-delà de 4 bonnes réponses d'affilée, reconnaître ne suffit plus :
    // on passe à la restitution, qui est un exercice bien plus exigeant
    if (e.score >= TYPED_AT && (x.arabizi || x.ar)) return sesTyped(x);

    $('sesbody').innerHTML = `<button class="act pri" id="sreveal">Afficher la réponse</button>`;
    $('sreveal').onclick = () => {
      $('sesbody').innerHTML = `<div class="arz">${esc(x.arabizi)}</div><div class="ar">${esc(x.ar)}</div>
        ${x.note ? `<div class="tiny" style="margin-top:6px">${esc(x.note)}</div>` : ''}
        <div class="row" style="justify-content:center;margin-top:18px">
          <button class="act bad" id="sno">Raté</button><button class="act good" id="syes">Je savais</button></div>`;
      setSpeak(x.ar); speak(x.ar); setEye('seseye', 'item', x);
      // la réponse est déjà à l'écran : on enchaîne sans faire patienter
      $('sno').onclick  = () => sesAnswer(false, 'item', x.id, x.fr, x.arabizi, 180);
      $('syes').onclick = () => sesAnswer(true,  'item', x.id, x.fr, x.arabizi, 180);
    };
  }

  if (type === 'verb') {
    const p = Math.floor(Math.random()*8), t = Math.random() < .5 ? 'present' : 'past';
    const good = x.forms[t][p];
    $('seslbl').textContent = (t === 'present' ? 'Présent' : 'Passé') + ' · ' + x.pattern;
    $('sesq').innerHTML = `${esc(x.fr)} → <span class="pill">${PERS[p]}</span>`;
    $('sesbody').innerHTML = `<input type="text" id="sin2" placeholder="La forme en arabizi…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="row" style="justify-content:center;margin-top:12px">
        <button class="act pri" id="sgo">Vérifier</button><button class="act" id="sskip2">Je ne sais pas</button></div>`;
    const check = () => {
      const ok = sameAnswer($('sin2').value, good, 'arabizi', verbVars(x, t, p));
      if (!ok) shake($('sin2'));
      $('sesfb').innerHTML = ok ? `<div class="fb ok">✓ <b>${esc(good)}</b></div>`
                                : `<div class="fb no">✗ C'était <b>${esc(good)}</b></div>`;
      setEye('seseye', 'verb', x);
      if (ok) return sesAnswer(true, 'verb', x.id, `${x.fr} · ${PERS[p]}`, good, 500);
      offerVerbVariant(x, t, p, $('sin2').value,
        bon => sesAnswer(bon, 'verb', x.id, `${x.fr} · ${PERS[p]}`, good, 180));
    };
    $('sgo').onclick = check;
    $('sin2').onkeydown = e => { if (e.key === 'Enter') check(); };
    setTimeout(() => $('sin2')?.focus(), 60);
  }

  if (type === 'grammar') {
    $('seslbl').innerHTML = `<span class="pill">${esc(x.lesson || 'Grammaire')}</span>`;
    $('sesq').textContent = x.fr;
    $('sesbody').innerHTML = `<input type="text" id="sing" placeholder="Ta réponse en arabizi…"
        autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="row" style="justify-content:center;margin-top:12px">
        <button class="act pri" id="sgog">Vérifier</button>
        <button class="act" id="sskipg">Je ne sais pas</button></div>`;
    const verifier = () => {
      const ok = sameAnswer($('sing').value, x.arabizi, 'arabizi', x.variants);
      if (!ok) shake($('sing'));
      $('sesfb').innerHTML = ok
        ? `<div class="fb ok">✓ <b>${esc(x.arabizi)}</b>${x.note ? ` — ${esc(x.note)}` : ''}</div>`
        : `<div class="fb no">✗ La réponse est <b>${esc(x.arabizi)}</b>${x.note ? `<br><span class="tiny">${esc(x.note)}</span>` : ''}</div>`;
      setSpeak(x.ar); setEye('seseye', 'item', x);
      if (ok) return sesAnswer(true, 'item', x.id, x.fr, x.arabizi, 550);
      offerVariant(x, 'items', $('sing').value,
        bon => sesAnswer(bon, 'item', x.id, x.fr, x.arabizi, 180));
    };
    $('sgog').onclick = verifier;
    $('sskipg').onclick = () => { $('sing').value = ''; verifier(); };
    $('sing').onkeydown = e => { if (e.key === 'Enter') verifier(); };
    setTimeout(() => $('sing')?.focus(), 60);
  }

  if (type === 'sentence') {
    const w = x.arabizi.split(' '), idx = Math.min(x.cloze_index ?? 0, w.length-1), good = w[idx];
    $('seslbl').textContent = x.category;
    $('sesq').textContent = x.fr;
    $('sesbody').innerHTML = `<div class="arz" style="margin-bottom:14px">${w.map((y,i)=> i===idx?'<span class="hl">_____</span>':esc(y)).join(' ')}</div>
      <input type="text" id="sin3" placeholder="Le mot manquant…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="row" style="justify-content:center;margin-top:12px">
        <button class="act pri" id="sgo3">Vérifier</button><button class="act" id="sskip3">Je ne sais pas</button></div>`;
    const check = () => {
      const ok = sameAnswer($('sin3').value, good, 'arabizi', x.variants);
      if (!ok) shake($('sin3'));
      $('sesfb').innerHTML = ok
        ? `<div class="fb ok">✓ <b>${esc(x.arabizi)}</b></div>`
        : `<div class="fb no">✗ C'était <b>${esc(good)}</b><br><span class="tiny">${esc(x.arabizi)}${x.note ? ' — ' + esc(x.note) : ''}</span></div>`;
      speak(x.ar);
      setEye('seseye', 'item', x);
      if (ok) { setSpeak(x.ar); return sesAnswer(true, 'item', x.id, x.fr, good, 550); }
      setSpeak(x.ar); setEye('seseye', 'item', x);
      offerVariant(x, 'items', $('sin3').value,
        bon => sesAnswer(bon, 'item', x.id, x.fr, good, 180));
    };
    $('sgo3').onclick = check;
    $('sin3').onkeydown = e => { if (e.key === 'Enter') check(); };
    $('sskip3').onclick = () => { $('sin3').value = ''; check(); };
    setTimeout(() => $('sin3')?.focus(), 60);
  }

  const sk = $('sskip2'); if (sk) sk.onclick = () => { $('sin2').value = ''; $('sgo').click(); };
}

/* carte à saisie : on écrit la traduction au lieu de la reconnaître */
function sesTyped(x){
  // si la carte n'existe que dans une écriture, on impose celle-là
  const dispo = SCRIPT === 'ar' ? (x.ar ? 'ar' : 'arabizi') : (x.arabizi ? 'arabizi' : 'ar');
  $('seslbl').innerHTML = `${esc(x.category)} · <span class="pill">à écrire</span>`;

  const body = $('sesbody');
  body.innerHTML = `<div class="row" id="scripttabs" style="gap:6px;justify-content:center;margin-bottom:12px">
      <button class="act${dispo==='arabizi'?' pri':''}" data-sc="arabizi" ${x.arabizi?'':'disabled'}>Arabizi</button>
      <button class="act${dispo==='ar'?' pri':''}" data-sc="ar" ${x.ar?'':'disabled'}>عربي</button>
    </div>`;

  const zone = document.createElement('div');
  body.appendChild(zone);

  function monter(script){
    zone.innerHTML = '';
    const input = answerField(script);
    zone.appendChild(input);
    if (script === 'ar') openKeypad(input); else closeKeypad();

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.style.cssText = 'justify-content:center;margin-top:12px';
    actions.innerHTML = `<button class="act pri" id="tgo">Vérifier</button>
                         <button class="act" id="tskip">Je ne sais pas</button>`;
    zone.appendChild(actions);

    const attendu = script === 'ar' ? x.ar : x.arabizi;
    const verifier = () => {
      const ok = sameAnswer(input.value, attendu, script, x.variants);
      if (!ok) shake(input);
      $('sesfb').innerHTML = ok
        ? `<div class="fb ok">✓ <b>${esc(attendu)}</b></div>`
        : `<div class="fb no">✗ C'était <b>${esc(attendu)}</b><br>
             <span class="tiny">${esc(x.arabizi)} — ${esc(x.ar)}</span></div>`;
      speak(x.ar);
      setEye('seseye', 'item', x);
      if (ok) { setSpeak(x.ar); return sesAnswer(true, 'item', x.id, x.fr, attendu, 550); }
      setSpeak(x.ar); setEye('seseye', 'item', x);
      offerVariant(x, 'items', input.value,
        bon => sesAnswer(bon, 'item', x.id, x.fr, attendu, 180));
    };
    $('tgo').onclick = verifier;
    $('tskip').onclick = () => { input.value = ''; verifier(); };
    input.onkeydown = ev => { if (ev.key === 'Enter') verifier(); };
    if (script !== 'ar') setTimeout(() => input.focus(), 60);
  }

  body.querySelectorAll('#scripttabs [data-sc]').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    body.querySelectorAll('#scripttabs [data-sc]').forEach(o => o.classList.toggle('pri', o === b));
    SCRIPT = b.dataset.sc; ls.set(K.script, SCRIPT);
    if (SESSION) sb.from('profiles').update({ script_pref: SCRIPT }).eq('id', SESSION.user.id);
    monter(SCRIPT);
  });
  monter(dispo);
}

function sesAnswer(ok, type, id, label, answer, delay){
  rec(type, id, ok);
  if (ok) { SES.ok++; burst('✓'); vibrate(14); }
  else    { SES.miss.push({ label, answer }); vibrate([12,60,12]); }
  SES.i++; saveSes();
  setTimeout(sesStep, delay ?? (ok ? 400 : 600));
}

function sesEnd(){
  ls.set(K.ses, null);
  $('sesrun').style.display = 'none'; $('sesdone').style.display = '';
  $('sesbarfill').style.width = '100%';
  const p = Math.round(SES.ok / SES.q.length * 100);
  $('dbig').textContent = p >= 80 ? '🎉' : p >= 50 ? '👏' : '💪';
  $('dtitle').textContent = p >= 80 ? 'Excellent' : p >= 50 ? 'Bien joué' : 'Séance bouclée';
  $('dscore').textContent = `${SES.ok} / ${SES.q.length}`;
  $('dsub').textContent = `${p}% de réussite`;

  const st = streak();
  $('dstreak').innerHTML = st > SES.startStreak
    ? `🔥 <b>Série portée à ${st} jour${st>1?'s':''}.</b> Reviens demain pour la prolonger.`
    : `🔥 Série en cours : <b>${st} jour${st>1?'s':''}</b>.`;

  $('dmiss').innerHTML = SES.miss.length
    ? '<tr><th>Question</th><th>Réponse</th></tr>' + SES.miss.map(m =>
        `<tr><td>${esc(m.label)}</td><td class="f">${esc(m.answer)}</td></tr>`).join('')
    : '<tr><td class="tiny" style="padding:16px;text-align:center">Sans faute. Répète-les quand même à voix haute.</td></tr>';

  if (p >= 80) burst('🎉');
  push();
}
$('sesquit').addEventListener('click', () => history.back());
$('dagain').addEventListener('click', () => startSession(true));
$('dhome').addEventListener('click', () => { STACK = ['home']; go('home', true); });

/* ============================================================
   VOCABULAIRE (entraînement libre)
   ============================================================ */
let vcur = null;
const vcat = $('vcat');

/* Le sélecteur des questions ne propose que des catégories jouables. */
function fillTrainCats(){
  const keep = vcat.value;
  vcat.innerHTML = '<option value="*">Toutes les catégories</option>'
    + TRAIN.cats().map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...vcat.options].some(o => o.value === keep)) vcat.value = keep;
}

function fillCats(el, allLabel){
  const keep = el.value;
  const cs = [...new Set(DATA.items.map(i => i.category))].sort();
  el.innerHTML = (allLabel ? `<option value="*">${allLabel}</option>` : '')
    + cs.map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...el.options].some(o => o.value === keep)) el.value = keep;
}
function vnext(){
  const list = TRAIN.words().filter(w => vcat.value === '*' || w.category === vcat.value);
  vcur = pick(list, 'item');
  if (!vcur) {
    const tot = TOTAL.words(vcat.value);
    $('vcatlbl').textContent = '';
    $('vfr').textContent = lockedMsg(tot, false) || 'Aucune carte dans cette catégorie.';
    $('vback').style.display = 'none'; $('vbtns').innerHTML = '';
    return;
  }
  $('vcatlbl').textContent = vcur.category;
  $('vfr').textContent = vcur.fr;
  $('varz').textContent = vcur.arabizi;
  $('var').textContent  = vcur.ar;
  $('vhint').textContent = vcur.note || '';
  setEye('voeil', 'item', null);   // dévoilé avec la réponse
  $('vback').style.display = 'none';
  $('vbtns').innerHTML = '<button class="act pri" id="vshow">Afficher la réponse</button>';
  $('vshow').onclick = vreveal;
  vprog();
}
function vreveal(){
  setEye('voeil', 'item', vcur);
  $('vback').style.display = 'block';
  $('vbtns').innerHTML = '<button class="act bad" id="vno">À revoir</button><button class="act good" id="vyes">Je savais</button>';
  $('vno').onclick  = () => { rec('item', vcur.id, false); vibrate([12,60,12]); vnext(); };
  $('vyes').onclick = () => { rec('item', vcur.id, true);  burst('✓'); vibrate(14); vnext(); };
  speak(vcur.ar);
}
function vprog(){
  const list = TRAIN.words().filter(w => vcat.value === '*' || w.category === vcat.value);
  const done = list.filter(w => get('item', w.id).score >= 3).length;
  $('vstat').textContent = `${done} / ${list.length} maîtrisés`;
  $('vstat2').textContent = `${done} / ${list.length}`;
  $('vbar').style.width = (list.length ? Math.round(done/list.length*100) : 0) + '%';
}
$('vspk').addEventListener('click', () => vcur && speak(vcur.ar));
vcat.addEventListener('change', vnext);

/* ============================================================
   LEXIQUE
   ============================================================ */
const lq = $('lq'), lcat = $('lcat'), lstat = $('lstat'), llvl = $('llvl');

function statOf(x){
  const e = get('item', x.id);
  if (x.status === 'pending') return { k:'pending', t:'à traduire', cls:'pill w', e };
  if (!e.seen)                return { k:'new',     t:'jamais vu',  cls:'pill g', e };
  const due = dueInDays(e);
  if (due === 0)     return { k:'due',   t:'à revoir', cls:'pill w', e, due };
  if (e.score >= 3)  return { k:'ok',    t:'maîtrisé', cls:'pill',   e, due };
  return { k:'learn', t:'en cours', cls:'pill g', e, due };
}
const humanDue = d =>
  d === 0 ? 'maintenant'
  : d === 1 ? 'demain'
  : d < 31 ? `dans ${d} j`
  : d < 365 ? `dans ${Math.round(d/30)} mois`
  : 'dans plus d\'un an';
function lfiltered(){
  const q = fold(lq.value);
  return DATA.items.filter(x => {
    if (lcat.value !== '*' && x.category !== lcat.value) return false;
    if (llvl.value !== '*' && String(lvl(x)) !== llvl.value) return false;
    const st = statOf(x);
    if (lstat.value === 'mine') { if (x.is_seed) return false; }
    else if (lstat.value === 'learn') { if (st.k !== 'learn' && st.k !== 'due') return false; }
    else if (lstat.value !== '*' && st.k !== lstat.value) return false;
    if (q && !fold([x.category,x.fr,x.arabizi,x.ar,x.note].join(' ')).includes(q)) return false;
    return true;
  });
}
/* ---------------- listes et pages détaillées ---------------- */
const CAT_ABBR = { 'Salutations':'Salut.', 'Questions':'Quest.', 'Famille':'Fam.',
  'Verbes':'Verbe', 'Nombres & temps':'Temps', 'Nourriture':'Nourr.',
  'Voyage':'Voyage', 'Adjectifs':'Adj.', 'Quotidien':'Quot.' };
const abbr = c => CAT_ABBR[c] || (c.length > 7 ? c.slice(0,6) + '.' : c);

/* couleur de maîtrise : gris jamais vu, rouge fragile, orange en cours, vert acquis */
function mastery(e){
  if (!e.seen) return { c:'', t:'jamais vue' };
  const taux = e.ok / e.seen;
  if (e.score < 0 || taux < 0.5) return { c:'rouge',  t:'fragile' };
  if (e.score >= MASTERED)       return { c:'vert',   t:'acquise' };
  return { c:'orange', t:'en cours' };
}

function rowHTML(x, type){
  const e = get(type, x.id), m = mastery(e);
  const fr = type === 'verb' ? x.fr : x.fr;
  const sub = type === 'verb' ? x.base : x.arabizi;
  const note = type === 'verb' ? x.pattern : x.note;
  const cat = type === 'verb' ? 'Verbe' : abbr(x.category);
  return `<button class="lrow" data-open="${esc(x.id)}" data-type="${type}">
    <span class="m ${m.c}" title="${m.t}"></span>
    <span class="lmain">
      <span class="lfr">${esc(fr)}<span class="lcat">${esc(cat)}</span></span>
      <span class="larz">${esc(sub) || '—'}</span>
      ${note ? `<span class="lnote">${esc(note)}</span>` : ''}
    </span>
    <span class="lchev">›</span>
  </button>`;
}

function renderLex(){
  const p = pending();
  $('lpending').style.display = p.length ? '' : 'none';
  $('lpendcount').textContent = p.length + (p.length > 1 ? ' cartes' : ' carte');
  const rows = lfiltered();
  $('lcount').textContent = `${rows.length} carte${rows.length>1?'s':''} sur ${DATA.items.length}`;
  if (!rows.length) {
    $('llist').innerHTML = '<p class="tiny" style="padding:20px;text-align:center">Aucun résultat.</p>';
    return;
  }
  // regroupées par palier : on voit d'un coup d'œil ce qui est ouvert
  const parNiveau = [...rows].sort((a, b) =>
    lvl(a) - lvl(b) || a.category.localeCompare(b.category) || a.fr.localeCompare(b.fr));
  const n = unlocked();
  let courant = null, html = '';
  for (const x of parNiveau) {
    if (lvl(x) !== courant) {
      courant = lvl(x);
      const nb = parNiveau.filter(y => lvl(y) === courant).length;
      html += `<div class="lsep">Niveau ${courant} · ${nb} carte${nb>1?'s':''}${
        courant > n ? ' · pas encore débloqué' : ''}</div>`;
    }
    html += rowHTML(x, 'item');
  }
  $('llist').innerHTML = html;
  bindRows($('llist'));
}

function renderVerbList(){
  const list = DATA.verbs.slice().sort((a,b) => a.fr.localeCompare(b.fr));
  $('vlist').innerHTML = list.map(v => rowHTML(v, 'verb')).join('');
  bindRows($('vlist'));
}

function bindRows(box){
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    if (b.dataset.type === 'verb') openVerb(b.dataset.open); else openCard(b.dataset.open);
  });
}

/* ---------- carte ---------- */
let CARD = null;
function openCard(id){
  CARD = DATA.items.find(i => i.id === id);
  if (!CARD) return;
  go('card');
}
function renderCard(){
  const x = CARD; if (!x) return;
  const e = get('item', x.id), m = mastery(e);
  $('dcfr').textContent = x.fr;
  $('dcarz').textContent = x.arabizi || '—';
  $('dcar').textContent = x.ar || '';
  $('dcstats').innerHTML = `
    <tr><td>Maîtrise</td><td class="f"><span class="m ${m.c}" style="display:inline-block;margin-right:7px"></span>${m.t}</td></tr>
    <tr><td>Réponses</td><td class="f">${e.seen ? `${e.ok} justes · ${e.ko} ratées · ${pct(e)} %` : 'jamais révisée'}</td></tr>
    <tr><td>Série en cours</td><td class="f">${Math.max(0, e.score)} d'affilée</td></tr>
    <tr><td>Prochaine révision</td><td class="f">${e.seen ? humanDue(dueInDays(e)) : 'à la prochaine séance'}</td></tr>
    <tr><td>Catégorie</td><td class="f">${esc(x.category)}</td></tr>
    <tr><td>Type</td><td class="f">${ {word:'mot', sentence:'phrase', grammar:'exercice de grammaire'}[x.kind] }${
      x.lesson ? ` · ${esc(x.lesson)}` : ''}</td></tr>
    <tr><td>Difficulté</td><td class="f">Niveau ${lvl(x)}${lvl(x) > unlocked() ? ' <span class="pill g">hors entraînement</span>' : ''}</td></tr>
    <tr><td>Prononciation</td><td class="f">${esc(x.note) || '—'}</td></tr>
    <tr><td>Orthographes acceptées</td><td class="f">${
      (x.variants || []).length
        ? x.variants.map(v => `<span class="pill g" style="margin:0 4px 4px 0;display:inline-block">${esc(v)}</span>`).join('')
        : '<span class="tiny">aucune — seule l\'écriture ci-dessus est acceptée</span>'}</td></tr>
    <tr><td>Traduction</td><td class="f">${x.verified ? '<span class="pill">vérifiée</span>' : '<span class="pill g">non vérifiée</span>'}</td></tr>
    <tr><td>Origine</td><td class="f">${x.is_seed ? 'contenu initial' : 'ajoutée par un membre'}</td></tr>`;
  $('dcdel').style.display = x.is_seed ? 'none' : '';
  $('dcread').style.display = ''; $('dcform').style.display = 'none';
}
$('dcspk').addEventListener('click', () => CARD && speak(CARD.ar));

$('dcedit').addEventListener('click', () => {
  const x = CARD;
  fillCats($('dccat'), null); $('dccat').value = x.category;
  $('dcffr').value = x.fr; $('dcfarz').value = x.arabizi;
  $('dcfar').value = x.ar; $('dcfnote').value = x.note;
  $('dcfver').checked = !!x.verified;
  boutonsNiveau('dcflvl', lvl(x));
  $('dcread').style.display = 'none'; $('dcform').style.display = '';
  $('dcfb').innerHTML = '';
});
document.querySelectorAll('#dcflvl [data-l]').forEach(b => b.addEventListener('click', () =>
  document.querySelectorAll('#dcflvl [data-l]').forEach(o => o.classList.toggle('pri', o === b))));
$('dccancel').addEventListener('click', renderCard);

$('dcsave').addEventListener('click', async () => {
  const x = CARD, fb = $('dcfb');
  const patch = {
    category: $('dccat').value,
    fr: $('dcffr').value.trim(),
    arabizi: $('dcfarz').value.trim(),
    ar: $('dcfar').value.trim(),
    note: $('dcfnote').value.trim(),
    variants: parseVariants($('dcfvar').value),
    verified: $('dcfver').checked,
    level: niveauChoisi('dcflvl', lvl(x))
  };
  if (!patch.fr) { shake($('dcffr')); return fb.innerHTML = '<div class="fb no">Le français est obligatoire.</div>'; }
  if (x.status === 'ready' && !patch.arabizi) { shake($('dcfarz'));
    return fb.innerHTML = '<div class="fb no">Une carte révisable doit avoir une traduction.</div>'; }

  Object.assign(x, patch); saveData();
  if (SESSION && !String(x.id).startsWith('seed:') && !String(x.id).startsWith('local:')) {
    const { error } = await sb.from('items').update(patch).eq('id', x.id);
    if (error) return fb.innerHTML = `<div class="fb no">${esc(error.message)}</div>`;
  }
  burst('✓'); renderCard(); renderLex(); renderHome();
  fillTrainCats(); fillCats(lcat, 'Toutes les catégories');
});
$('dcdel').addEventListener('click', async () => {
  if (!CARD || CARD.is_seed) return;
  if (!confirm('Supprimer cette carte pour tout le monde ?')) return;
  const id = CARD.id;
  DATA.items = DATA.items.filter(i => i.id !== id); saveData();
  if (SESSION && !String(id).startsWith('seed:') && !String(id).startsWith('local:'))
    await sb.from('items').delete().eq('id', id);
  renderLex(); renderHome(); history.back();
});

/* ---------- verbe ---------- */
let VERB = null, VTENSE = 'present';
function openVerb(id){
  VERB = DATA.verbs.find(v => v.id === id);
  if (!VERB) return;
  VTENSE = 'present'; go('verb');
}
function renderVerb(){
  const v = VERB; if (!v) return;
  const e = get('verb', v.id), m = mastery(e);
  $('dvfr').textContent = v.fr;
  $('dvar').textContent = v.ar || '';
  $('dvbase').textContent = `${v.base} · ${v.pattern}`;
  document.querySelectorAll('#dvtense [data-t]').forEach(b =>
    b.classList.toggle('pri', b.dataset.t === VTENSE));
  $('dvtable').innerHTML = (v.forms?.[VTENSE] || []).map((f,i) => {
    const vs = verbVars(v, VTENSE, i);
    return `<tr><td>${PERS[i]}</td><td class="f">${esc(f)}${
      vs.length ? `<div class="tiny" style="font-weight:400;margin-top:2px">aussi : ${vs.map(esc).join(', ')}</div>` : ''
    }</td></tr>`;
  }).join('')
    || '<tr><td class="tiny">Formes manquantes.</td></tr>';
  $('dvstats').innerHTML = `
    <tr><td>Maîtrise</td><td class="f"><span class="m ${m.c}" style="display:inline-block;margin-right:7px"></span>${m.t}</td></tr>
    <tr><td>Réponses</td><td class="f">${e.seen ? `${e.ok} justes · ${e.ko} ratées · ${pct(e)} %` : 'jamais révisé'}</td></tr>
    <tr><td>Prochaine révision</td><td class="f">${e.seen ? humanDue(dueInDays(e)) : 'à la prochaine séance'}</td></tr>
    <tr><td>Difficulté</td><td class="f">Niveau ${lvl(v)}${lvl(v) > unlocked() ? ' <span class="pill g">hors entraînement</span>' : ''}</td></tr>
    <tr><td>Traduction</td><td class="f">${v.verified ? '<span class="pill">vérifiée</span>' : '<span class="pill g">non vérifiée</span>'}</td></tr>`;
  $('dvread').style.display = ''; $('dvform').style.display = 'none';
}
document.querySelectorAll('#dvtense [data-t]').forEach(b => b.addEventListener('click', () => {
  VTENSE = b.dataset.t; renderVerb();
}));

$('dvedit').addEventListener('click', () => {
  const v = VERB;
  $('dvffr').value = v.fr; $('dvfbase').value = v.base;
  $('dvfar').value = v.ar; $('dvfpat').value = v.pattern;
  boutonsNiveau('dvflvl', lvl(v));
  $('dvforms').innerHTML = ['present','past'].map(t => `
    <div class="tiny" style="margin-top:10px;font-weight:600">${t === 'present' ? 'Présent' : 'Passé'}</div>
    ${(v.forms?.[t] || Array(8).fill('')).map((f,i) => `
      <div class="row" style="gap:8px;margin-top:6px">
        <span class="tiny" style="width:104px;flex:none">${PERS[i]}</span>
        <input type="text" data-f="${t}" data-i="${i}" value="${esc(f)}" style="flex:1">
      </div>`).join('')}`).join('');
  $('dvread').style.display = 'none'; $('dvform').style.display = '';
  $('dvfb').innerHTML = '';
});
document.querySelectorAll('#dvflvl [data-l]').forEach(b => b.addEventListener('click', () =>
  document.querySelectorAll('#dvflvl [data-l]').forEach(o => o.classList.toggle('pri', o === b))));
$('dvcancel').addEventListener('click', renderVerb);

$('dvsave').addEventListener('click', async () => {
  const v = VERB, fb = $('dvfb');
  const forms = { present: [], past: [] };
  $('dvforms').querySelectorAll('[data-f]').forEach(i => forms[i.dataset.f][+i.dataset.i] = i.value.trim());
  if (forms.present.some(f => !f) || forms.past.some(f => !f))
    return fb.innerHTML = '<div class="fb no">Les 16 formes doivent être remplies : la base refuse un verbe incomplet.</div>';

  const patch = {
    fr: $('dvffr').value.trim(), base: $('dvfbase').value.trim(),
    ar: $('dvfar').value.trim(), pattern: $('dvfpat').value.trim() || 'régulier',
    level: niveauChoisi('dvflvl', lvl(v)),
    forms
  };
  if (!patch.fr || !patch.base) return fb.innerHTML = '<div class="fb no">Français et base sont obligatoires.</div>';

  Object.assign(v, patch); saveData();
  if (SESSION && !String(v.id).startsWith('seed:')) {
    const { error } = await sb.from('verbs').update(patch).eq('id', v.id);
    if (error) return fb.innerHTML = `<div class="fb no">${esc(error.message)}</div>`;
  }
  burst('✓'); renderVerb(); renderVerbList();
});

$('lpendshow').addEventListener('click', () => { lstat.value='pending'; lq.value=''; lcat.value='*'; renderLex(); });
$('ladd2').addEventListener('click', () => go('add'));
$('lexport').addEventListener('click', () => {
  const out = $('lout');
  out.value = lfiltered().map(c => `${c.fr}\t${c.arabizi} | ${c.ar}${c.note ? ' | ' + c.note : ''}`).join('\n');
  out.style.display = 'block'; $('lexphelp').style.display = 'block';
  out.focus(); out.select();
  try { navigator.clipboard?.writeText(out.value); } catch {}
});

/* --- ajout de carte --- */
const fcat = $('fcat');
function fillForm(){
  const cs = [...new Set(DATA.items.map(i => i.category))].sort();
  fcat.innerHTML = cs.map(c => `<option>${esc(c)}</option>`).join('') + '<option value="__new">+ Nouvelle catégorie…</option>';
}
$('fkind').addEventListener('change', function(){
  const verbe = this.value === 'verb';
  $('fcatwrap').style.display = verbe ? 'none' : '';
  $('faskwrap').style.display = verbe ? 'none' : '';
  $('fnotewrap').style.display = verbe ? 'none' : '';
  $('fverbnote').style.display = verbe ? '' : 'none';
  $('flabarz').textContent = verbe ? 'Base du verbe (optionnel)' : 'Arabizi';
});
fcat.addEventListener('change', function(){
  const n = $('fcatnew');
  n.style.display = this.value === '__new' ? 'block' : 'none';
  if (this.value === '__new') n.focus();
});
$('fask').addEventListener('change', function(){
  const on = this.checked;
  $('farz').disabled = on; $('far').disabled = on;
  $('farz').style.opacity = $('far').style.opacity = on ? .4 : 1;
  if (on) { $('farz').value=''; $('far').value=''; }
});
$('fadd').addEventListener('click', async () => {
  if ($('fkind').value === 'verb') return addVerbe();
  const ask = $('fask').checked;
  const cat = fcat.value === '__new' ? $('fcatnew').value.trim() : fcat.value;
  const fr = $('ffr').value.trim(), arz = $('farz').value.trim();
  const ar = $('far').value.trim(), note = $('fnote').value.trim();
  const fb = $('ffb');
  if (!cat || !fr)  return fb.innerHTML = '<div class="fb no">La catégorie et le français sont obligatoires.</div>';
  if (!ask && !arz) return fb.innerHTML = '<div class="fb no">Renseigne l\'arabizi, ou coche « cherche-moi la traduction ».</div>';
  if (DATA.items.some(i => fold(i.fr) === fold(fr) && i.kind === 'word'))
    return fb.innerHTML = `<div class="fb no">Une carte « ${esc(fr)} » existe déjà.</div>`;

  const row = { kind:'word', category:cat, fr, arabizi: ask?'':arz, ar: ask?'':(ar||arz),
                note, status: ask?'pending':'ready', verified:false };
  if (SESSION) {
    const { data, error } = await sb.from('items')
      .insert({ ...row, created_by: SESSION.user.id, requested_by: ask ? SESSION.user.id : null })
      .select().single();
    if (error) return fb.innerHTML = `<div class="fb no">${esc(error.message)}</div>`;
    DATA.items.push(data);
  } else DATA.items.push({ ...row, id:'local:'+Date.now(), is_seed:false, cloze_index:null });

  saveData();
  fillCats(vcat,'Toutes les catégories'); fillCats(lcat,'Toutes les catégories'); fillForm();
  burst('✓');
  fb.innerHTML = ask
    ? `<div class="fb ok">✓ « ${esc(fr)} » enregistrée en attente de traduction.</div>`
    : `<div class="fb ok">✓ « ${esc(fr)} » ajoutée à tes révisions.</div>`;
  ['ffr','farz','far','fnote'].forEach(i => $(i).value = '');
  $('ffr').focus();
});

/* Un verbe ne peut pas être ajouté complet depuis l'app : saisir 16 formes
   justes suppose de savoir conjuguer. On enregistre donc la demande, et la
   conjugaison est remplie ensuite, comme les traductions en attente. */
async function addVerbe(){
  const fr = $('ffr').value.trim(), fb = $('ffb');
  if (!fr) return fb.innerHTML = '<div class="fb no">Le français est obligatoire.</div>';
  if (DATA.verbs.some(v => fold(v.fr) === fold(fr)))
    return fb.innerHTML = `<div class="fb no">Le verbe « ${esc(fr)} » existe déjà.</div>`;
  const row = { fr, base: $('farz').value.trim(), ar: $('far').value.trim(),
                status: 'pending', level: 2, verified: false };
  if (SESSION) {
    const { data, error } = await sb.from('verbs')
      .insert({ ...row, created_by: SESSION.user.id, requested_by: SESSION.user.id })
      .select().single();
    if (error) return fb.innerHTML = `<div class="fb no">${esc(error.message)}</div>`;
    DATA.verbs.push(data);
  } else DATA.verbs.push({ ...row, id: 'local:' + Date.now(), is_seed: false, variants: {} });
  saveData(); burst('✓'); renderVerbList(); renderHome();
  fb.innerHTML = `<div class="fb ok">✓ « ${esc(fr)} » enregistré. Sa conjugaison sera complétée avant qu'il n'entre en révision.</div>`;
  ['ffr','farz','far','fnote'].forEach(i => $(i).value = '');
}

/* ============================================================
   CONJUGAISON (entraînement libre)
   ============================================================ */
const PERS = ['ana (je)','nta (tu, m.)','nti (tu, f.)','houwa (il)','hiya (elle)','hna (nous)','ntouma (vous)','houma (ils)'];
let cq = null;


function cnew(){
  const v = pick(TRAIN.verbs(), 'verb');
  if (!v) {
    $('cprompt').textContent = '';
    $('cq').textContent = lockedMsg(TOTAL.verbs(), false) || 'Aucun verbe.';
    $('cin').style.display = 'none'; $('cok').style.display = 'none'; $('cskip').style.display = 'none';
    return;
  }
  $('cin').style.display = ''; $('cok').style.display = ''; $('cskip').style.display = '';
  const p = Math.floor(Math.random()*8), t = Math.random() < .5 ? 'present' : 'past';
  cq = { v, p, t };
  $('cprompt').textContent = (t==='present'?'Présent':'Passé') + ' · ' + v.pattern;
  $('cq').innerHTML = `${esc(v.fr)} <span class="ar" style="font-size:18px">${esc(v.ar)}</span> → <span class="pill">${PERS[p]}</span>`;
  $('cin').value = ''; $('cfb').innerHTML = '';
}
function cscore(){
  let ok=0, n=0;
  for (const v of TRAIN.verbs()) { const e = get('verb', v.id); ok += e.ok; n += e.seen; }
  $('cscore').textContent = `${ok} / ${n} correctes` + (n ? ` (${Math.round(ok/n*100)}%)` : '');
  $('cscore2').textContent = `${ok} / ${n}`;
}
function ccheck(){
  if (!cq) return;
  const good = cq.v.forms[cq.t][cq.p];
  const ok = sameAnswer($('cin').value, good, 'arabizi', verbVars(cq.v, cq.t, cq.p));
  rec('verb', cq.v.id, ok); cscore();
  if (ok) { burst('✓'); vibrate(14); } else { shake($('cin')); vibrate([12,60,12]); }
  $('cfb').innerHTML = ok ? `<div class="fb ok">✓ <b>${esc(good)}</b></div>`
                          : `<div class="fb no">✗ La bonne forme est <b>${esc(good)}</b>.</div>`;
  setTimeout(cnew, ok ? 900 : 2600);
}
$('cok').addEventListener('click', ccheck);
$('cin').addEventListener('keydown', e => { if (e.key === 'Enter') ccheck(); });
$('cskip').addEventListener('click', () => {
  if (!cq) return;
  $('cfb').innerHTML = `<div class="fb no">→ <b>${esc(cq.v.forms[cq.t][cq.p])}</b></div>`;
  setTimeout(cnew, 2200);
});

/* ============================================================
   PHRASES (entraînement libre)
   ============================================================ */
const scat = $('scat');
let scur = null;
function fillScats(){
  const keep = scat.value;
  const cs = TRAIN.catsPhr();
  scat.innerHTML = '<option value="*">Toutes les catégories</option>' + cs.map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...scat.options].some(o => o.value === keep)) scat.value = keep;
}
const sword = s => { const w = s.arabizi.split(' '); return w[Math.min(s.cloze_index ?? 0, w.length-1)]; };
function snext(){
  const list = TRAIN.sentences().filter(s => scat.value === '*' || s.category === scat.value);
  scur = pick(list, 'item');
  if (!scur) {
    const tot = TOTAL.sentences(scat.value);
    $('sfr').textContent = lockedMsg(tot, false) || 'Aucune phrase.';
    $('scloze').textContent = '';
    $('sin').style.display = 'none'; $('sok').style.display = 'none'; $('sskip').style.display = 'none';
    return;
  }
  $('sin').style.display = ''; $('sok').style.display = ''; $('sskip').style.display = '';
  const w = scur.arabizi.split(' '), idx = Math.min(scur.cloze_index ?? 0, w.length-1);
  $('sfr').textContent = scur.fr;
  $('scloze').innerHTML = w.map((x,i) => i===idx ? '<span class="hl">_____</span>' : esc(x)).join(' ');
  $('sin').value=''; $('sfb').innerHTML=''; $('sfull').style.display='none';
  let ok=0,n=0; for (const s of TRAIN.sentences()) { const e=get('item',s.id); ok+=e.ok; n+=e.seen; }
  $('sscore').textContent = `${ok} / ${n} correctes`;
  $('sscore2').textContent = `${ok} / ${n}`;
}
function sreveal(ok){
  $('sfb').innerHTML = ok ? `<div class="fb ok">✓ <b>${esc(sword(scur))}</b></div>`
                          : `<div class="fb no">✗ C'était <b>${esc(sword(scur))}</b></div>`;
  $('sarz').textContent = scur.arabizi; $('sar').textContent = scur.ar;
  $('snote').textContent = scur.note ? '↳ ' + scur.note : '';
  $('sfull').style.display = 'block';
  speak(scur.ar);
}
$('sok').addEventListener('click', () => {
  if (!scur) return;
  const ok = sameAnswer($('sin').value, sword(scur), 'arabizi', scur.variants);
  rec('item', scur.id, ok);
  if (ok) { burst('✓'); vibrate(14); } else { shake($('sin')); vibrate([12,60,12]); }
  sreveal(ok);
});
$('sin').addEventListener('keydown', e => { if (e.key === 'Enter') $('sok').click(); });
$('sskip').addEventListener('click', () => scur && sreveal(false));
$('snext').addEventListener('click', snext);
$('sspk').addEventListener('click', () => scur && speak(scur.ar));
scat.addEventListener('change', snext);

/* ============================================================
   PROGRESSION
   ============================================================ */
const kpi = (l,v,s) => `<div style="border:1px solid var(--line);border-radius:12px;padding:14px">
  <div class="tiny">${l}</div><div style="font-size:26px;font-weight:700;letter-spacing:-.5px;margin:2px 0">${v}</div>
  <div class="tiny">${s||''}</div></div>`;

function renderStats(){
  const w = words(), sn = sentences(), vb = verbs();
  let mast=0, seen=0, ok=0, ko=0;
  for (const x of [...w,...sn]) { const e=get('item',x.id); if(e.score>=3)mast++; if(e.seen)seen++; ok+=e.ok; ko+=e.ko; }
  let vok=0, vn=0; for (const v of vb) { const e=get('verb',v.id); vok+=e.ok; vn+=e.seen; }
  const totOk=ok+vok, totN=ok+ko+vn;
  $('pkpi').innerHTML =
      kpi('Cartes maîtrisées', `${mast} / ${w.length+sn.length}`, `${seen} déjà vues`)
    + kpi('Réussite globale', (totN?Math.round(totOk/totN*100):0)+'%', `${totOk} bonnes sur ${totN}`)
    + kpi('Conjugaison', `${vok} / ${vn}`, vn?Math.round(vok/vn*100)+'% de réussite':'pas commencé')
    + kpi('Série', `${streak()} j`, 'jours consécutifs');

  const d = new Date(); d.setDate(d.getDate()-29);
  let cal='';
  for (let i=0;i<30;i++){
    const key=fmtd(d), n=DAYS[key]||0;
    const op = n===0?.08 : n<10?.3 : n<30?.6 : 1;
    cal += `<div title="${key} — ${n} réponses" style="width:20px;height:20px;border-radius:5px;background:rgba(var(--heat),${op})"></div>`;
    d.setDate(d.getDate()+1);
  }
  $('pcal').innerHTML = cal;
  const st = streak();
  $('pstreak').textContent = st ? `Série en cours : ${st} jour${st>1?'s':''} d'affilée.`
                               : "Aucune série. Une seule carte suffit à la relancer.";

  const weak = [
    ...[...w,...sn].map(x => ({ l:x.fr, r:x.arabizi, e:get('item',x.id), t:x.kind==='sentence'?'phrase':'mot' })),
    ...vb.map(v => ({ l:v.fr, r:v.base, e:get('verb',v.id), t:'verbe' }))
  ].filter(x => x.e.ko>0).sort((a,b)=>(b.e.ko-b.e.ok)-(a.e.ko-a.e.ok)||b.e.ko-a.e.ko).slice(0,12);
  $('pweak').innerHTML = '<tr><th>Type</th><th>Item</th><th>Réponse</th><th>✓ / ✗</th></tr>'
    + (weak.length?'':'<tr><td colspan="4" class="tiny" style="padding:18px;text-align:center">Rien à signaler.</td></tr>')
    + weak.map(x => `<tr><td class="tiny">${x.t}</td><td>${esc(x.l)}</td><td class="f">${esc(x.r)}</td>
        <td class="tiny"><b style="color:var(--ok-ink)">${x.e.ok}</b>/<b style="color:var(--bad)">${x.e.ko}</b></td></tr>`).join('');

  const cs = [...new Set(DATA.items.map(i=>i.category))].sort();
  $('pcat').innerHTML = '<tr><th>Catégorie</th><th>Maîtrisés</th><th>Progression</th></tr>'
    + cs.map(c => {
      const list = DATA.items.filter(i => i.category===c && i.status==='ready');
      const dn = list.filter(i => get('item',i.id).score>=3).length;
      const p = list.length?Math.round(dn/list.length*100):0;
      return `<tr><td>${esc(c)}</td><td class="tiny">${dn} / ${list.length}</td>
        <td><div class="bar" style="margin:0"><i style="width:${p}%"></i></div></td></tr>`;
    }).join('');

}
$('psyncnow').addEventListener('click', async () => {
  if (!SESSION) return $('pfb').innerHTML = '<div class="fb no">Connecte-toi pour synchroniser.</div>';
  $('pfb').innerHTML = '<div class="fb ok"><span class="spin"></span> Synchronisation…</div>';
  await push(); await pull();
  $('pfb').innerHTML = '<div class="fb ok">✓ À jour.</div>';
});
$('pexp').addEventListener('click', () => {
  const t = $('pdata');
  t.value = JSON.stringify({ prog:PROG, days:DAYS, custom:DATA.items.filter(i=>!i.is_seed) });
  t.style.display='block'; t.focus(); t.select();
  try { navigator.clipboard?.writeText(t.value); } catch {}
  $('pfb').innerHTML = '<div class="fb ok">Sauvegarde copiée.</div>';
});

/* ============================================================
   COMPARAISON
   ============================================================ */
async function renderCompare(){
  if (!SESSION) {
    $('lb').innerHTML = '<p class="tiny">Le classement nécessite un compte. En mode local, ta progression reste sur cet appareil.</p>';
    $('cstrong').innerHTML = $('cweak').innerHTML = '';
    return;
  }
  $('lb').innerHTML = '<p class="tiny"><span class="spin"></span> Chargement…</p>';
  const [lbRes, catRes] = await Promise.all([
    sb.rpc('leaderboard'),
    sb.rpc('category_group_stats')
  ]);

  if (lbRes.error) { $('lb').innerHTML = `<div class="fb no">${esc(lbRes.error.message)}</div>`; return; }
  const rows = lbRes.data.filter(r => r.answers > 0);
  const medal = i => ['🥇','🥈','🥉'][i] || '';
  $('lb').innerHTML = rows.length ? rows.map((r,i) => `
    <div class="rank ${r.is_me?'me':''}">
      <span class="pos">${medal(i) ? `<span class="medal">${medal(i)}</span>` : i+1}</span>
      <span class="nm">${esc(r.name)}${r.is_me?' <span class="tiny">(toi)</span>':''}
        <span class="tiny" style="display:block">${r.ok} bonnes · ${r.accuracy} % · ${r.mastered} acquises</span></span>
      <span class="sc"><b style="font-size:17px">${r.score}</b><br><span class="tiny">points</span></span>
    </div>`).join('')
    : '<p class="tiny">Personne n\'a encore révisé. Sois le premier.</p>';

  if (catRes.error) return;
  const cats = catRes.data
    .filter(c => c.my_seen >= 3)
    .map(c => {
      const me = Math.round(c.my_ok*100/c.my_seen);
      const others_seen = Number(c.group_seen) - Number(c.my_seen);
      const others_ok   = Number(c.group_ok)   - Number(c.my_ok);
      const grp = others_seen > 0 ? Math.round(others_ok*100/others_seen) : null;
      return { cat:c.category, me, grp, diff: grp === null ? 0 : me - grp, seen:Number(c.my_seen) };
    })
    .sort((a,b) => b.diff - a.diff);

  const line = c => `<tr><td>${esc(c.cat)}</td>
    <td class="f">${c.me}%</td>
    <td class="tiny">${c.grp === null ? 'seul dessus' : `groupe ${c.grp}%`}</td>
    <td class="tiny" style="color:${c.diff>=0?'var(--ok-ink)':'var(--bad)'}">${c.diff>0?'+':''}${c.diff} pts</td></tr>`;

  const head = '<tr><th>Catégorie</th><th>Toi</th><th>Groupe</th><th>Écart</th></tr>';
  const strong = cats.filter(c => c.diff > 0).slice(0,5);
  const weak   = cats.filter(c => c.diff <= 0).slice(-5).reverse();

  $('cstrong').innerHTML = head + (strong.length ? strong.map(line).join('')
    : `<tr><td colspan="4" class="tiny" style="padding:14px">Pas encore assez de données. Il faut au moins 3 réponses dans une catégorie.</td></tr>`);
  $('cweak').innerHTML = head + (weak.length ? weak.map(line).join('')
    : `<tr><td colspan="4" class="tiny" style="padding:14px">Rien à signaler pour l'instant.</td></tr>`);
}

$('cshare').addEventListener('change', async function(){
  if (!SESSION) return;
  const { error } = await sb.from('profiles').update({ share_stats: this.checked }).eq('id', SESSION.user.id);
  $('cshfb').innerHTML = error
    ? `<div class="fb no">${esc(error.message)}</div>`
    : `<div class="fb ok">${this.checked ? 'Tu apparais dans le classement.' : 'Tu es masqué du classement.'}</div>`;
});

/* ============================================================
   RÉVISION DES LEÇONS DE GRAMMAIRE
   Les leçons sont les cartes déjà présentes dans la vue Grammaire :
   on les lit une fois au démarrage, puis on les rejoue une par une.
   ============================================================ */
let LESSONS = [], li = 0;

function loadLessons(){
  LESSONS = [...document.querySelectorAll('#gramlist > .card')].map(c => c.outerHTML);
}
function lessonTitle(i){
  const m = LESSONS[i].match(/<h3[^>]*>(.*?)<\/h3>/);
  return m ? m[1].replace(/<[^>]+>/g,'') : `Leçon ${i+1}`;
}
function openLessons(i = 0){
  if (!LESSONS.length) loadLessons();
  if (!LESSONS.length) return;
  li = Math.max(0, Math.min(i, LESSONS.length-1));
  $('gramlist').style.display = 'none';
  $('lesson').style.display = '';
  $('gramstart').textContent = 'Reprendre';
  renderLesson();
}
function closeLessons(){
  $('lesson').style.display = 'none';
  $('gramlist').style.display = '';
}
function renderLesson(reverse = false){
  const box = $('lesson');
  $('lbody').innerHTML = LESSONS[li];
  $('lsncount').textContent = `Leçon ${li+1} sur ${LESSONS.length} · ${lessonTitle(li)}`;
  $('lprev').disabled = li === 0;
  $('lnext').textContent = li === LESSONS.length-1 ? 'Terminer' : 'Suivante →';

  if (!SEEN_LESSONS.includes(li)) { SEEN_LESSONS.push(li); ls.set(K.seenLessons, SEEN_LESSONS); }

  $('ldots').innerHTML = LESSONS.map((_, i) =>
    `<i class="${i === li ? 'on' : SEEN_LESSONS.includes(i) ? 'seen' : ''}" data-l="${i}"></i>`).join('');
  $('ldots').querySelectorAll('[data-l]').forEach(d =>
    d.onclick = () => { const t = +d.dataset.l; const rev = t < li; li = t; renderLesson(rev); });

  box.classList.remove('swap','rev'); void box.offsetWidth;
  box.classList.add('swap'); if (reverse) box.classList.add('rev');
  window.scrollTo(0,0);
}
function nextLesson(){
  if (li === LESSONS.length-1) { burst('🎓'); closeLessons(); return; }
  li++; renderLesson(false);
}
function prevLesson(){ if (li > 0) { li--; renderLesson(true); } }

$('gramstart').addEventListener('click', () => {
  // reprend à la première leçon non encore vue
  let start = 0;
  for (let i = 0; i < LESSONS.length || i === 0; i++) {
    if (!LESSONS.length) break;
    if (!SEEN_LESSONS.includes(i)) { start = i; break; }
  }
  openLessons(start);
});
$('lnext').addEventListener('click', nextLesson);
$('lprev').addEventListener('click', prevLesson);
$('lclose').addEventListener('click', closeLessons);

/* balayage horizontal — on ignore les gestes majoritairement verticaux
   pour ne pas bloquer le défilement de la page */
(function(){
  const el = $('lesson');
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); tracking = true;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!tracking) return; tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 > 700) return;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) nextLesson(); else prevLesson();
  }, { passive: true });
})();
// au clavier, pour le bureau
document.addEventListener('keydown', e => {
  if (current !== 'gram' || $('lesson').style.display === 'none') return;
  if (e.key === 'ArrowRight') nextLesson();
  if (e.key === 'ArrowLeft')  prevLesson();
});

/* ---------------- exercices de grammaire ---------------- */
const gxsel = $('gxlesson');
let gxcur = null;

function fillLessons(){
  const keep = gxsel.value;
  const cs = [...new Set(TRAIN.grammar().map(x => x.lesson).filter(Boolean))].sort();
  gxsel.innerHTML = '<option value="*">Toutes les leçons</option>'
    + cs.map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...gxsel.options].some(o => o.value === keep)) gxsel.value = keep;
}
function gxnext(){
  const list = TRAIN.grammar().filter(x => gxsel.value === '*' || x.lesson === gxsel.value);
  gxcur = pick(list, 'item');
  let ok = 0, n = 0;
  for (const x of TRAIN.grammar()) { const e = get('item', x.id); ok += e.ok; n += e.seen; }
  $('gxscore').textContent = `${ok} / ${n}`;
  if (!gxcur) {
    $('gxlbl').textContent = '';
    $('gxq').textContent = lockedMsg(TOTAL.grammar(), false) || 'Aucun exercice.';
    ['gxin','gxok','gxskip'].forEach(i => $(i).style.display = 'none');
    return;
  }
  ['gxin','gxok','gxskip'].forEach(i => $(i).style.display = '');
  $('gxlbl').textContent = gxcur.lesson || 'Grammaire';
  $('gxq').textContent = gxcur.fr;
  $('gxin').value = ''; $('gxfb').innerHTML = '';
}
function gxcheck(){
  if (!gxcur) return;
  const ok = sameAnswer($('gxin').value, gxcur.arabizi, 'arabizi', gxcur.variants);
  rec('item', gxcur.id, ok);
  if (!ok) shake($('gxin'));
  $('gxfb').innerHTML = ok
    ? `<div class="fb ok">✓ <b>${esc(gxcur.arabizi)}</b>${gxcur.note ? ` — ${esc(gxcur.note)}` : ''}</div>`
    : `<div class="fb no">✗ La réponse est <b>${esc(gxcur.arabizi)}</b>${gxcur.note ? `<br><span class="tiny">${esc(gxcur.note)}</span>` : ''}</div>`;
  setTimeout(gxnext, ok ? 800 : 2200);
}
$('gxok').addEventListener('click', gxcheck);
$('gxskip').addEventListener('click', () => { if (gxcur) { $('gxin').value = ''; gxcheck(); } });
$('gxin').addEventListener('keydown', e => { if (e.key === 'Enter') gxcheck(); });
gxsel.addEventListener('change', gxnext);

/* ---------------- paramètres ---------------- */
document.querySelectorAll('#themetabs [data-theme-set]').forEach(b =>
  b.addEventListener('click', () => setTheme(b.dataset.themeSet)));

function renderScriptPref(){
  document.querySelectorAll('#scriptpref [data-script]').forEach(b =>
    b.classList.toggle('pri', b.dataset.script === SCRIPT));
}
document.querySelectorAll('#scriptpref [data-script]').forEach(b =>
  b.addEventListener('click', async () => {
    SCRIPT = b.dataset.script; ls.set(K.script, SCRIPT); renderScriptPref();
    if (SESSION) await sb.from('profiles').update({ script_pref: SCRIPT }).eq('id', SESSION.user.id);
  }));

/* Les boutons de niveau sont générés : passer de 3 à 5 paliers ne doit
   pas demander de retoucher le HTML à trois endroits. */
function boutonsNiveau(id, actuel){
  const el = $(id);
  el.innerHTML = Array.from({length:NIVEAUX}, (_,k) => k+1)
    .map(n => `<option value="${n}"${n===actuel?' selected':''}>Niveau ${n}</option>`).join('');
}
const niveauChoisi = (id, defaut) => +($(id)?.value || defaut);

function renderPending(){
  const mots    = DATA.items.filter(i => i.kind === 'word'     && i.status === 'pending').length;
  const phrases = DATA.items.filter(i => i.kind === 'sentence' && i.status === 'pending').length;
  const verbes  = DATA.verbs.filter(v => v.status === 'pending').length;
  const total   = mots + phrases + verbes;
  const nonVerif = DATA.items.filter(i => i.status === 'ready' && !i.verified).length
                 + DATA.verbs.filter(v => v.status === 'ready' && !v.verified).length;
  $('acpend').innerHTML = `
    <tr><td>Mots à traduire</td><td class="f">${mots}</td></tr>
    <tr><td>Phrases à traduire</td><td class="f">${phrases}</td></tr>
    <tr><td>Verbes à conjuguer</td><td class="f">${verbes}</td></tr>
    <tr><td><b>Total en attente</b></td><td class="f">${total || 'aucune'}</td></tr>
    <tr><td>Non vérifiées par un locuteur</td><td class="f">${nonVerif}</td></tr>`;
  $('acpendgo').disabled = !total;
}
$('acpendgo').addEventListener('click', () => {
  go('vocab');
  setTimeout(() => { lstat.value = 'pending'; lq.value = ''; lcat.value = '*'; llvl.value = '*'; renderLex(); }, 60);
});

function renderLevelBox(){
  const n = unlocked();
  const rows = Array.from({length:NIVEAUX}, (_,k) => k+1).map(i => {
    const d = levelDone(i);
    const etat = i < n ? 'ouvert' : i === n ? 'en cours' : 'verrouillé';
    return `<tr><td>Niveau ${i}</td>
      <td class="tiny">${d.total ? `${d.ok}/${d.total} maîtrisés` : '—'}</td>
      <td><span class="${i <= n ? 'pill' : 'pill g'}">${etat}</span></td></tr>`;
  }).join('');
  $('lvlinfo').innerHTML = rows +
    `<tr><td>Déblocage manuel</td><td colspan="2" class="tiny">${MANUAL_LEVEL > 1 ? 'niveau ' + MANUAL_LEVEL : 'aucun'}</td></tr>`;
}
$('lvlforce').addEventListener('click', async () => {
  if (MANUAL_LEVEL >= NIVEAUX) return $('lvlfb').innerHTML = '<div class="fb ok">Tout le contenu est déjà ouvert.</div>';
  MANUAL_LEVEL = Math.min(NIVEAUX, Math.max(MANUAL_LEVEL, unlocked()) + 1);
  ls.set(K.manual, MANUAL_LEVEL);
  renderLevelBox(); renderHome(); renderLex();
  $('lvlfb').innerHTML = `<div class="fb ok">Niveau ${MANUAL_LEVEL} ouvert.</div>`;
  if (SESSION) await sb.from('profiles').update({ unlocked_level: MANUAL_LEVEL }).eq('id', SESSION.user.id);
});

function renderGoal(){
  document.querySelectorAll('#goaltabs [data-goal]').forEach(b =>
    b.classList.toggle('pri', +b.dataset.goal === DAILY_GOAL));
}
document.querySelectorAll('#goaltabs [data-goal]').forEach(b =>
  b.addEventListener('click', async () => {
    DAILY_GOAL = +b.dataset.goal;
    ls.set(K.goal, DAILY_GOAL); renderGoal(); renderHome();
    if (SESSION) await sb.from('profiles').update({ daily_goal: DAILY_GOAL }).eq('id', SESSION.user.id);
  }));

/* ---------------- authentification ---------------- */
async function boot(){
  const { data } = await sb.auth.getSession();
  SESSION = data.session;
  if (!SESSION && !LOCAL_ONLY) $('gate').classList.add('show');
  renderWho(); renderAll();
  const depart = (location.hash || '#home').slice(1) || 'home';
  STACK = ['home'];
  go($('v-' + depart) ? depart : 'home', true);
  loadLessons();
  applyTheme(THEME); renderGoal(); renderScriptPref();
  if (SESSION) { await loadPrefs(); await pull(); await push(); }
}
sb.auth.onAuthStateChange((_e, s) => {
  const was = !!SESSION;
  SESSION = s;
  if (SESSION) {
    LOCAL_ONLY = false; ls.set(K.mode, null);
    $('gate').classList.remove('show');
    if (!was) { loadPrefs(); pull(); if (current === 'home') renderHome(); }
  }
  renderWho();
  if (current === 'account') renderAccount();
});
/* --- bascule code / mot de passe --- */
document.querySelectorAll('#gtabs [data-auth]').forEach(b => b.addEventListener('click', () => {
  const mode = b.dataset.auth;
  document.querySelectorAll('#gtabs [data-auth]').forEach(x => x.classList.toggle('pri', x === b));
  $('gcode').style.display = mode === 'code' ? '' : 'none';
  $('gpwd').style.display  = mode === 'pwd'  ? '' : 'none';
  $('gfb').innerHTML = '';
}));

/* --- connexion par code à 6 chiffres --- */
const humanAuthError = m => {
  if (/rate limit|too many/i.test(m))
    return "Limite d'envoi atteinte. Le service email de Supabase est plafonné à 2 messages par heure tant qu'un SMTP externe n'est pas branché. Réessaie dans une heure, ou connecte-toi avec un mot de passe.";
  if (/signups not allowed/i.test(m))
    return "Aucun compte pour cette adresse. L'accès est sur invitation.";
  if (/invalid|expired/i.test(m))
    return 'Code invalide ou expiré. Redemande un code.';
  return m;
};

async function sendCode(){
  const email = $('gmail').value.trim(), fb = $('gfb');
  if (!/.+@.+\..+/.test(email)) return fb.innerHTML = '<div class="fb no">Adresse email invalide.</div>';
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Envoi…</div>';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) { fb.innerHTML = `<div class="fb no">${esc(humanAuthError(error.message))}</div>`; return; }
  $('gcodebox').style.display = 'block';
  fb.innerHTML = '<div class="fb ok">Code envoyé. Saisis-le ci-dessus — reste dans cette app.</div>';
  setTimeout(() => $('gtoken')?.focus(), 80);
}
async function verifyCode(){
  const email = $('gmail').value.trim(), token = $('gtoken').value.replace(/\D/g,''), fb = $('gfb');
  if (token.length !== 6) { shake($('gtoken')); return fb.innerHTML = '<div class="fb no">Le code fait 6 chiffres.</div>'; }
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Vérification…</div>';
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) { shake($('gtoken')); fb.innerHTML = `<div class="fb no">${esc(humanAuthError(error.message))}</div>`; return; }
  fb.innerHTML = '<div class="fb ok">✓ Connecté.</div>';
  burst('✓');
}
$('gsend').addEventListener('click', sendCode);
$('gresend').addEventListener('click', sendCode);
$('gverify').addEventListener('click', verifyCode);
$('gmail').addEventListener('keydown', e => { if (e.key === 'Enter') sendCode(); });
$('gtoken').addEventListener('keydown', e => { if (e.key === 'Enter') verifyCode(); });
// saisie automatique du code reçu par SMS/email sur iOS
$('gtoken').addEventListener('input', function(){
  this.value = this.value.replace(/\D/g,'').slice(0,6);
  if (this.value.length === 6) verifyCode();
});

/* --- connexion par mot de passe --- */
$('glogin').addEventListener('click', async () => {
  const email = $('gmail2').value.trim(), password = $('gpass').value, fb = $('gfb');
  if (!/.+@.+\..+/.test(email) || !password)
    return fb.innerHTML = '<div class="fb no">Email et mot de passe requis.</div>';
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Connexion…</div>';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    shake($('gpass'));
    fb.innerHTML = /invalid login/i.test(error.message)
      ? "<div class=\"fb no\">Email ou mot de passe incorrect. Si tu n'as jamais défini de mot de passe, connecte-toi d'abord avec un code.</div>"
      : `<div class="fb no">${esc(error.message)}</div>`;
    return;
  }
  fb.innerHTML = '<div class="fb ok">✓ Connecté.</div>'; burst('✓');
});
$('gpass').addEventListener('keydown', e => { if (e.key === 'Enter') $('glogin').click(); });

$('glocal').addEventListener('click', () => {
  LOCAL_ONLY = true; ls.set(K.mode,'local'); $('gate').classList.remove('show'); renderWho(); renderHome();
});

/* --- écran de compte --- */
$('sout').addEventListener('click', () => {
  if (SESSION) go('account');
  else { ls.set(K.mode, null); LOCAL_ONLY = false; $('gate').classList.add('show'); }
});
function renderAccount(){
  const st = streak();
  $('acinfo').innerHTML = SESSION ? `
    <tr><td>Email</td><td class="f">${esc(SESSION.user.email)}</td></tr>
    <tr><td>Série</td><td class="f">${st} jour${st>1?'s':''}</td></tr>
    <tr><td>Contenu</td><td class="f">${DATA.items.length} items · ${DATA.verbs.length} verbes</td></tr>
    <tr><td>Synchronisation</td><td class="f">${Object.keys(QUEUE).length ? Object.keys(QUEUE).length + ' en attente' : 'à jour'}</td></tr>`
    : '<tr><td colspan="2" class="tiny">Mode local — aucun compte. Le thème et l\'objectif restent sur cet appareil.</td></tr>';
  applyTheme(THEME); renderGoal(); renderScriptPref(); renderLevelBox(); renderPending();
  $('acver').textContent = $('ver').textContent;
  ['cshare','acpass','acsave'].forEach(id => { const e = $(id); if (e) e.disabled = !SESSION; });
}

/* préférences stockées côté compte : elles suivent l'utilisateur d'un appareil à l'autre */
async function loadPrefs(){
  if (!SESSION) return;
  const { data } = await sb.from('profiles')
    .select('theme, daily_goal, share_stats, script_pref, unlocked_level').eq('id', SESSION.user.id).single();
  if (!data) return;
  if (data.theme && data.theme !== THEME) {
    THEME = data.theme;
    try { localStorage.setItem(K.theme, THEME); } catch {}
    applyTheme(THEME);
  }
  if (data.daily_goal && data.daily_goal !== DAILY_GOAL) {
    DAILY_GOAL = data.daily_goal; ls.set(K.goal, DAILY_GOAL); renderGoal(); renderHome();
  }
  if (data.script_pref && data.script_pref !== SCRIPT) {
    SCRIPT = data.script_pref; ls.set(K.script, SCRIPT); renderScriptPref();
  }
  if (data.unlocked_level && data.unlocked_level > MANUAL_LEVEL) {
    MANUAL_LEVEL = data.unlocked_level; ls.set(K.manual, MANUAL_LEVEL);
  }
  const c = $('cshare'); if (c) c.checked = !!data.share_stats;
}
$('acsave').addEventListener('click', async () => {
  const p = $('acpass').value, fb = $('acfb');
  if (p.length < 8) { shake($('acpass')); return fb.innerHTML = '<div class="fb no">8 caractères minimum.</div>'; }
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Enregistrement…</div>';
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) return fb.innerHTML = `<div class="fb no">${esc(error.message)}</div>`;
  $('acpass').value = ''; burst('✓');
  fb.innerHTML = '<div class="fb ok">✓ Mot de passe défini. Tu peux désormais te connecter sans email.</div>';
});
$('aclogout').addEventListener('click', async () => {
  if (!confirm('Se déconnecter ? La progression synchronisée est conservée en ligne.')) return;
  await push(); await sb.auth.signOut(); SESSION = null;
  ls.set(K.mode, null); LOCAL_ONLY = false;
  $('gate').classList.add('show'); renderWho();
});

/* ---------------- rendu global ---------------- */
function renderAll(){
  fillCats(vcat,'Toutes les catégories');
  fillCats(lcat,'Toutes les catégories');
  fillForm(); fillScats(); fillLessons(); renderVerbList();
  renderHome();
  if (current === 'vocab') renderLex();
  if (current === 'stats') renderStats();
}

window.addEventListener('online',  () => { setSync('idle'); push(); });
window.addEventListener('offline', () => setSync('error'));
window.addEventListener('beforeunload', () => { if (SESSION && Object.keys(QUEUE).length) push(); });

['far','dcfar','dvfar'].forEach(id => withKeypad($(id)));

boot();

/* ---------------- mises à jour ----------------
   iOS garde les PWA en veille : sans vérification explicite, l'app
   peut rester des jours sur une version périmée sans le signaler. */
let swReg = null, reloading = false;

async function checkUpdate(){
  if (!swReg) return 'indisponible';
  try {
    await swReg.update();
    if (swReg.waiting) { swReg.waiting.postMessage({ type: 'SKIP_WAITING' }); return 'nouvelle'; }
    return 'ajour';
  } catch { return 'erreur'; }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; reloading = true; location.reload();
  });
  window.addEventListener('load', async () => {
    try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch {}
    checkUpdate();
  });
  // au retour dans l'app après une mise en veille
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
}

$('acupdate')?.addEventListener('click', async () => {
  const fb = $('acupfb');
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Vérification…</div>';
  const r = await checkUpdate();
  fb.innerHTML = r === 'nouvelle'
    ? '<div class="fb ok">Nouvelle version trouvée, rechargement…</div>'
    : r === 'ajour'
      ? `<div class="fb ok">✓ Tu es déjà sur la dernière version (${$('ver').textContent}).</div>`
      : '<div class="fb no">Vérification impossible — pas de réseau ?</div>';
});
