/* ============================================================
   Derja — logique de l'app
   Local-first : tout s'écrit d'abord en local, la synchro suit.
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://ypsnpwcznhcvfljuibnn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlwc25wd2N6bmhjdmZsanVpYm5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MzU1OTcsImV4cCI6MjEwMjIxMTU5N30.nq_coVUWxAv1ndNGrTbvJpnFkV7IiphEYdIP-ZjGuVQ';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const SESSION_SIZE = { word: 10, verb: 5, sentence: 5 };
const DAILY_GOAL = 20;

/* ---------------- état ---------------- */
const K = { data:'derja.data', prog:'derja.prog', queue:'derja.queue', days:'derja.days', mode:'derja.mode' };
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
const norm = s => (s||'').toLowerCase().trim().replace(/[’'`]/g,'').replace(/\s+/g,' ')
  .replace(/9/g,'q').replace(/7/g,'h').replace(/5/g,'kh').replace(/8/g,'gh');
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

/* --- animations --- */
function burst(sym){
  const b = $('burst');
  b.textContent = sym; b.classList.remove('go');
  void b.offsetWidth;                       // relance l'animation
  b.classList.add('go');
}
function shake(el){
  if (!el) return;
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

/* ---------------- données ---------------- */
const words     = () => DATA.items.filter(i => i.kind === 'word'     && i.status === 'ready');
const sentences = () => DATA.items.filter(i => i.kind === 'sentence' && i.status === 'ready');
const verbs     = () => DATA.verbs.filter(v => v.status === 'ready' && v.forms);
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

const weight = e => e.score < 0 ? 4 : (e.seen === 0 ? 3 : (e.score < 3 ? 2 : 1));
function pick(list, type){
  if (!list.length) return null;
  const pool = [];
  for (const x of list) { const w = weight(get(type, x.id)); for (let i=0;i<w;i++) pool.push(x); }
  return pool[Math.floor(Math.random() * pool.length)];
}
// tire n éléments distincts, les plus fragiles d'abord
function pickMany(list, type, n){
  const scored = list.map(x => {
    const e = get(type, x.id);
    return { x, prio: (e.score < 0 ? 0 : e.seen === 0 ? 1 : e.score < 3 ? 2 : 3) + Math.random() * .9 };
  }).sort((a,b) => a.prio - b.prio);
  return scored.slice(0, n).map(s => s.x);
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

/* ---------------- routeur ---------------- */
let current = 'home';
let booted = false;
function go(id, back = false){
  const v = $('v-' + id);
  if (!v) return;
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on','back'));
  v.classList.add('on'); if (back) v.classList.add('back');
  $('hdr').classList.toggle('show', id !== 'home');
  $('htitle').textContent = window.TITLES[id] || '';
  current = id;
  window.scrollTo(0,0);
  // la première navigation remplace l'entrée courante : sinon le bouton retour
  // du téléphone quitterait l'app au lieu de revenir à l'accueil
  if (!booted) { history.replaceState({ id }, '', '#' + id); booted = true; }
  else if (location.hash !== '#' + id) history.pushState({ id }, '', '#' + id);
  onEnter(id);
}
function onEnter(id){
  if (id === 'home')    renderHome();
  if (id === 'vocab')   vnext();
  if (id === 'conj')    { fillVerbs(); ctable(); cnew(); cscore(); }
  if (id === 'phr')     { fillScats(); snext(); }
  if (id === 'lex')     renderLex();
  if (id === 'stats')   renderStats();
  if (id === 'compare') renderCompare();
  if (id === 'add')     fillForm();
  if (id === 'session') startSession();
}
$('back').addEventListener('click', () => history.back());
window.addEventListener('popstate', e => {
  const id = (e.state && e.state.id) || (location.hash || '#home').slice(1) || 'home';
  const v = $('v-' + id);
  if (!v) return;
  document.querySelectorAll('.view').forEach(x => x.classList.remove('on','back'));
  v.classList.add('on','back');
  $('hdr').classList.toggle('show', id !== 'home');
  $('htitle').textContent = window.TITLES[id] || '';
  current = id; onEnter(id);
});
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
  const q = [
    ...pickMany(words(), 'item', SESSION_SIZE.word).map(x => ({ type:'word', x })),
    ...pickMany(verbs(), 'verb', SESSION_SIZE.verb).map(x => ({ type:'verb', x })),
    ...pickMany(sentences(), 'item', SESSION_SIZE.sentence).map(x => ({ type:'sentence', x }))
  ];
  return shuffle(q);
}

function startSession(){
  SES = { q: buildSession(), i: 0, ok: 0, miss: [], startStreak: streak() };
  $('sesrun').style.display = ''; $('sesdone').style.display = 'none';
  if (!SES.q.length) { $('sesq').textContent = 'Aucun contenu disponible.'; return; }
  sesStep();
}

function sesStep(){
  if (SES.i >= SES.q.length) return sesEnd();
  const { type, x } = SES.q[SES.i];
  $('sescount').textContent = `Question ${SES.i+1} sur ${SES.q.length}`;
  $('sestype').textContent = type === 'word' ? 'Vocabulaire' : type === 'verb' ? 'Conjugaison' : 'Phrase';
  $('sesbarfill').style.width = Math.round(SES.i / SES.q.length * 100) + '%';
  $('sesfb').innerHTML = '';
  const card = document.querySelector('#v-session .sesq');
  card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');

  if (type === 'word') {
    $('seslbl').textContent = x.category;
    $('sesq').textContent = x.fr;
    $('sesbody').innerHTML = `<button class="act pri" id="sreveal">Afficher la réponse</button>`;
    $('sreveal').onclick = () => {
      $('sesbody').innerHTML = `<div class="arz">${esc(x.arabizi)}</div><div class="ar">${esc(x.ar)}</div>
        ${x.note ? `<div class="tiny" style="margin-top:6px">${esc(x.note)}</div>` : ''}
        <div class="row" style="justify-content:center;margin-top:18px">
          <button class="act bad" id="sno">Raté</button><button class="act good" id="syes">Je savais</button></div>`;
      speak(x.ar);
      $('sno').onclick  = () => sesAnswer(false, 'item', x.id, x.fr, x.arabizi);
      $('syes').onclick = () => sesAnswer(true,  'item', x.id, x.fr, x.arabizi);
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
      const ok = norm($('sin2').value) === norm(good);
      if (!ok) shake($('sin2'));
      $('sesfb').innerHTML = ok ? `<div class="fb ok">✓ <b>${esc(good)}</b></div>`
                                : `<div class="fb no">✗ C'était <b>${esc(good)}</b></div>`;
      sesAnswer(ok, 'verb', x.id, `${x.fr} · ${PERS[p]}`, good, ok ? 700 : 1900);
    };
    $('sgo').onclick = check;
    $('sin2').onkeydown = e => { if (e.key === 'Enter') check(); };
    setTimeout(() => $('sin2')?.focus(), 60);
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
      const ok = norm($('sin3').value) === norm(good);
      if (!ok) shake($('sin3'));
      $('sesfb').innerHTML = ok
        ? `<div class="fb ok">✓ <b>${esc(x.arabizi)}</b></div>`
        : `<div class="fb no">✗ C'était <b>${esc(good)}</b><br><span class="tiny">${esc(x.arabizi)}${x.note ? ' — ' + esc(x.note) : ''}</span></div>`;
      speak(x.ar);
      sesAnswer(ok, 'item', x.id, x.fr, good, ok ? 900 : 2400);
    };
    $('sgo3').onclick = check;
    $('sin3').onkeydown = e => { if (e.key === 'Enter') check(); };
    $('sskip3').onclick = () => { $('sin3').value = ''; check(); };
    setTimeout(() => $('sin3')?.focus(), 60);
  }

  const sk = $('sskip2'); if (sk) sk.onclick = () => { $('sin2').value = ''; $('sgo').click(); };
}

function sesAnswer(ok, type, id, label, answer, delay){
  rec(type, id, ok);
  if (ok) { SES.ok++; burst('✓'); vibrate(14); }
  else    { SES.miss.push({ label, answer }); vibrate([12,60,12]); }
  SES.i++;
  setTimeout(sesStep, delay ?? (ok ? 550 : 1600));
}

function sesEnd(){
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
$('dagain').addEventListener('click', startSession);
$('dhome').addEventListener('click', () => go('home', true));

/* ============================================================
   VOCABULAIRE (entraînement libre)
   ============================================================ */
let vcur = null;
const vcat = $('vcat');

function fillCats(el, allLabel){
  const keep = el.value;
  const cs = [...new Set(DATA.items.map(i => i.category))].sort();
  el.innerHTML = (allLabel ? `<option value="*">${allLabel}</option>` : '')
    + cs.map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...el.options].some(o => o.value === keep)) el.value = keep;
}
function vnext(){
  const list = words().filter(w => vcat.value === '*' || w.category === vcat.value);
  vcur = pick(list, 'item');
  if (!vcur) { $('vfr').textContent = 'Aucune carte dans cette catégorie.'; return; }
  $('vcatlbl').textContent = vcur.category;
  $('vfr').textContent = vcur.fr;
  $('varz').textContent = vcur.arabizi;
  $('var').textContent  = vcur.ar;
  $('vhint').textContent = vcur.note || '';
  $('vback').style.display = 'none';
  $('vbtns').innerHTML = '<button class="act pri" id="vshow">Afficher la réponse</button>';
  $('vshow').onclick = vreveal;
  vprog();
}
function vreveal(){
  $('vback').style.display = 'block';
  $('vbtns').innerHTML = '<button class="act bad" id="vno">À revoir</button><button class="act good" id="vyes">Je savais</button>';
  $('vno').onclick  = () => { rec('item', vcur.id, false); vibrate([12,60,12]); vnext(); };
  $('vyes').onclick = () => { rec('item', vcur.id, true);  burst('✓'); vibrate(14); vnext(); };
  speak(vcur.ar);
}
function vprog(){
  const list = words().filter(w => vcat.value === '*' || w.category === vcat.value);
  const done = list.filter(w => get('item', w.id).score >= 3).length;
  $('vstat').textContent = `${done} / ${list.length} maîtrisés`;
  $('vbar').style.width = (list.length ? Math.round(done/list.length*100) : 0) + '%';
}
$('vspk').addEventListener('click', () => vcur && speak(vcur.ar));
vcat.addEventListener('change', vnext);

/* ============================================================
   LEXIQUE
   ============================================================ */
const lq = $('lq'), lcat = $('lcat'), lstat = $('lstat');

function statOf(x){
  const e = get('item', x.id);
  if (x.status === 'pending') return { k:'pending', t:'à traduire', cls:'pill w', e };
  if (e.score >= 3)  return { k:'ok',    t:'maîtrisé',  cls:'pill',   e };
  if (!e.seen)       return { k:'new',   t:'jamais vu', cls:'pill g', e };
  return { k:'learn', t: e.score < 0 ? 'à revoir' : 'en cours', cls:'pill g', e };
}
function lfiltered(){
  const q = fold(lq.value);
  return DATA.items.filter(x => {
    if (lcat.value !== '*' && x.category !== lcat.value) return false;
    const st = statOf(x);
    if (lstat.value === 'mine') { if (x.is_seed) return false; }
    else if (lstat.value !== '*' && st.k !== lstat.value) return false;
    if (q && !fold([x.category,x.fr,x.arabizi,x.ar,x.note].join(' ')).includes(q)) return false;
    return true;
  });
}
function renderLex(){
  const p = pending();
  $('lpending').style.display = p.length ? '' : 'none';
  $('lpendcount').textContent = p.length + (p.length > 1 ? ' cartes' : ' carte');
  const rows = lfiltered();
  $('lcount').textContent = `${rows.length} carte${rows.length>1?'s':''} sur ${DATA.items.length}`;
  $('ltable').innerHTML =
    '<tr><th>Catégorie</th><th>Français</th><th>Arabizi</th><th>Arabe</th><th>Statut</th><th>✓ / ✗</th><th></th></tr>'
    + (rows.length ? '' : '<tr><td colspan="7" class="tiny" style="padding:20px;text-align:center">Aucun résultat.</td></tr>')
    + rows.map(x => {
      const st = statOf(x), e = st.e;
      return `<tr>
        <td class="tiny">${esc(x.category)}${x.is_seed?'':' <span class="pill" style="font-size:10px">perso</span>'}${x.kind==='sentence'?' <span class="pill g" style="font-size:10px">phrase</span>':''}</td>
        <td>${esc(x.fr)}</td><td class="f">${esc(x.arabizi) || '<span class="tiny">—</span>'}</td>
        <td class="ar" style="font-size:19px">${esc(x.ar)}</td>
        <td><span class="${st.cls}">${st.t}</span></td>
        <td class="tiny" style="white-space:nowrap">${e.seen
          ? `<b style="color:#0b5b50">${e.ok}</b>/<b style="color:var(--bad)">${e.ko}</b>` : '—'}</td>
        <td style="white-space:nowrap">${x.ar?`<button class="spk" data-say="${esc(x.ar)}">🔊</button>`:''}
          ${x.is_seed?'':`<button class="spk" data-del="${esc(x.id)}">🗑</button>`}</td></tr>`;
    }).join('');
  $('ltable').querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say));
  $('ltable').querySelectorAll('[data-del]').forEach(b => b.onclick = () => delItem(b.dataset.del));
}
async function delItem(id){
  if (!confirm('Supprimer cette carte ?')) return;
  DATA.items = DATA.items.filter(i => i.id !== id); saveData();
  fillCats(vcat,'Toutes les catégories'); fillCats(lcat,'Toutes les catégories'); fillForm();
  renderLex();
  if (SESSION && !String(id).startsWith('seed:') && !String(id).startsWith('local:'))
    await sb.from('items').delete().eq('id', id);
}
[lq, lcat, lstat].forEach(el => el.addEventListener(el === lq ? 'input' : 'change', renderLex));
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

/* ============================================================
   CONJUGAISON (entraînement libre)
   ============================================================ */
const PERS = ['ana (je)','nta (tu, m.)','nti (tu, f.)','houwa (il)','hiya (elle)','hna (nous)','ntouma (vous)','houma (ils)'];
const cverb = $('cverb'), ctense = $('ctense');
let cq = null;

function fillVerbs(){ cverb.innerHTML = verbs().map((v,i) => `<option value="${i}">${esc(v.fr)} — ${esc(v.base)}</option>`).join(''); }
function ctable(){
  const v = verbs()[+cverb.value];
  if (!v) return $('ctable').innerHTML = '<tr><td class="tiny">Aucun verbe.</td></tr>';
  $('ctable').innerHTML = `<tr><th colspan="2">${esc(v.fr)} · <span class="ar" style="font-size:18px">${esc(v.ar)}</span> · <span class="pill g">${esc(v.pattern)}</span></th></tr>`
    + v.forms[ctense.value].map((x,i) => `<tr><td>${PERS[i]}</td><td class="f">${esc(x)}</td></tr>`).join('');
}
cverb.addEventListener('change', ctable);
ctense.addEventListener('change', ctable);

function cnew(){
  const v = pick(verbs(), 'verb');
  if (!v) { $('cq').textContent = 'Aucun verbe.'; return; }
  const p = Math.floor(Math.random()*8), t = Math.random() < .5 ? 'present' : 'past';
  cq = { v, p, t };
  $('cprompt').textContent = (t==='present'?'Présent':'Passé') + ' · ' + v.pattern;
  $('cq').innerHTML = `${esc(v.fr)} <span class="ar" style="font-size:18px">${esc(v.ar)}</span> → <span class="pill">${PERS[p]}</span>`;
  $('cin').value = ''; $('cfb').innerHTML = '';
}
function cscore(){
  let ok=0, n=0;
  for (const v of verbs()) { const e = get('verb', v.id); ok += e.ok; n += e.seen; }
  $('cscore').textContent = `${ok} / ${n} correctes` + (n ? ` (${Math.round(ok/n*100)}%)` : '');
}
function ccheck(){
  if (!cq) return;
  const good = cq.v.forms[cq.t][cq.p];
  const ok = norm($('cin').value) === norm(good);
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
  const cs = [...new Set(sentences().map(s => s.category))].sort();
  scat.innerHTML = '<option value="*">Toutes les catégories</option>' + cs.map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...scat.options].some(o => o.value === keep)) scat.value = keep;
}
const sword = s => { const w = s.arabizi.split(' '); return w[Math.min(s.cloze_index ?? 0, w.length-1)]; };
function snext(){
  const list = sentences().filter(s => scat.value === '*' || s.category === scat.value);
  scur = pick(list, 'item');
  if (!scur) { $('sfr').textContent = 'Aucune phrase.'; return; }
  const w = scur.arabizi.split(' '), idx = Math.min(scur.cloze_index ?? 0, w.length-1);
  $('sfr').textContent = scur.fr;
  $('scloze').innerHTML = w.map((x,i) => i===idx ? '<span class="hl">_____</span>' : esc(x)).join(' ');
  $('sin').value=''; $('sfb').innerHTML=''; $('sfull').style.display='none';
  let ok=0,n=0; for (const s of sentences()) { const e=get('item',s.id); ok+=e.ok; n+=e.seen; }
  $('sscore').textContent = `${ok} / ${n} correctes`;
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
  const ok = norm($('sin').value) === norm(sword(scur));
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
    cal += `<div title="${key} — ${n} réponses" style="width:20px;height:20px;border-radius:5px;background:rgba(15,123,108,${op})"></div>`;
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
        <td class="tiny"><b style="color:#0b5b50">${x.e.ok}</b>/<b style="color:var(--bad)">${x.e.ko}</b></td></tr>`).join('');

  const cs = [...new Set(DATA.items.map(i=>i.category))].sort();
  $('pcat').innerHTML = '<tr><th>Catégorie</th><th>Maîtrisés</th><th>Progression</th></tr>'
    + cs.map(c => {
      const list = DATA.items.filter(i => i.category===c && i.status==='ready');
      const dn = list.filter(i => get('item',i.id).score>=3).length;
      const p = list.length?Math.round(dn/list.length*100):0;
      return `<tr><td>${esc(c)}</td><td class="tiny">${dn} / ${list.length}</td>
        <td><div class="bar" style="margin:0"><i style="width:${p}%"></i></div></td></tr>`;
    }).join('');

  const q = Object.keys(QUEUE).length;
  $('psync').innerHTML = `
    <tr><td>Compte</td><td class="f">${SESSION?esc(SESSION.user.email):'aucun — mode local'}</td></tr>
    <tr><td>Contenu</td><td class="f">${DATA.items.length} items · ${DATA.verbs.length} verbes</td></tr>
    <tr><td>En attente d'envoi</td><td class="f">${q}</td></tr>
    <tr><td>Cartes à traduire</td><td class="f">${pending().length}</td></tr>`;
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
  const [lbRes, catRes, meRes] = await Promise.all([
    sb.rpc('leaderboard'),
    sb.rpc('category_group_stats'),
    sb.from('profiles').select('share_stats').eq('id', SESSION.user.id).single()
  ]);

  if (lbRes.error) { $('lb').innerHTML = `<div class="fb no">${esc(lbRes.error.message)}</div>`; return; }
  const rows = lbRes.data.filter(r => r.answers > 0);
  const medal = i => ['🥇','🥈','🥉'][i] || '';
  $('lb').innerHTML = rows.length ? rows.map((r,i) => `
    <div class="rank ${r.is_me?'me':''}">
      <span class="pos">${medal(i) ? `<span class="medal">${medal(i)}</span>` : i+1}</span>
      <span class="nm">${esc(r.name)}${r.is_me?' <span class="tiny">(toi)</span>':''}</span>
      <span class="sc"><b>${r.answers}</b> réponses<br><span class="tiny">${r.accuracy}% · ${r.mastered} maîtrisés</span></span>
    </div>`).join('')
    : '<p class="tiny">Personne n\'a encore révisé. Sois le premier.</p>';

  if (meRes.data) $('cshare').checked = !!meRes.data.share_stats;

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
    <td class="tiny" style="color:${c.diff>=0?'#0b5b50':'var(--bad)'}">${c.diff>0?'+':''}${c.diff} pts</td></tr>`;

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

/* ---------------- authentification ---------------- */
async function boot(){
  const { data } = await sb.auth.getSession();
  SESSION = data.session;
  if (!SESSION && !LOCAL_ONLY) $('gate').classList.add('show');
  renderWho(); renderAll();
  const start = (location.hash || '#home').slice(1) || 'home';
  go($('v-' + start) ? start : 'home');
  if (SESSION) { await pull(); await push(); }
}
sb.auth.onAuthStateChange((_e, s) => {
  const was = !!SESSION;
  SESSION = s;
  if (SESSION) {
    LOCAL_ONLY = false; ls.set(K.mode, null);
    $('gate').classList.remove('show');
    if (!was) pull();
  }
  renderWho();
});
$('gsend').addEventListener('click', async () => {
  const email = $('gmail').value.trim(), fb = $('gfb');
  if (!/.+@.+\..+/.test(email)) return fb.innerHTML = '<div class="fb no">Adresse email invalide.</div>';
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Envoi…</div>';
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } });
  fb.innerHTML = error
    ? `<div class="fb no">${esc(error.message)}<br><span class="tiny">L'accès est sur invitation : sans invitation, aucun compte ne peut être créé.</span></div>`
    : '<div class="fb ok">Lien envoyé. Ouvre-le depuis cet appareil.</div>';
});
$('gmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('gsend').click(); });
$('glocal').addEventListener('click', () => {
  LOCAL_ONLY = true; ls.set(K.mode,'local'); $('gate').classList.remove('show'); renderWho(); renderHome();
});
$('sout').addEventListener('click', async () => {
  if (SESSION) {
    if (!confirm('Se déconnecter ? La progression synchronisée est conservée en ligne.')) return;
    await push(); await sb.auth.signOut(); SESSION = null;
  }
  ls.set(K.mode, null); LOCAL_ONLY = false;
  $('gate').classList.add('show'); renderWho();
});

/* ---------------- rendu global ---------------- */
function renderAll(){
  fillCats(vcat,'Toutes les catégories');
  fillCats(lcat,'Toutes les catégories');
  fillForm(); fillVerbs(); fillScats();
  renderHome();
  if (current === 'lex')   renderLex();
  if (current === 'stats') renderStats();
}

window.addEventListener('online',  () => { setSync('idle'); push(); });
window.addEventListener('offline', () => setSync('error'));
window.addEventListener('beforeunload', () => { if (SESSION && Object.keys(QUEUE).length) push(); });

boot();

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
