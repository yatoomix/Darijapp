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

/* ---------------- état ---------------- */
const K = { data:'derja.data', prog:'derja.prog', queue:'derja.queue', days:'derja.days', mode:'derja.mode' };
const ls = {
  get(k, d){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

let SESSION = null;
let LOCAL_ONLY = ls.get(K.mode, null) === 'local';
let DATA  = ls.get(K.data,  null) || { items: window.SEED.items, verbs: window.SEED.verbs };
let PROG  = ls.get(K.prog,  {});          // "item:<id>" -> {ok,ko,score,seen,last}
let DAYS  = ls.get(K.days,  {});          // "2026-08-13" -> nb de réponses
let QUEUE = ls.get(K.queue, {});          // clé -> même forme, en attente d'envoi
let syncState = 'idle';                   // idle | syncing | error | offline

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

// tolérante : les chiffres arabizi sont interchangeables avec leurs digrammes
const norm = s => (s||'').toLowerCase().trim().replace(/[’'`]/g,'').replace(/\s+/g,' ')
  .replace(/9/g,'q').replace(/7/g,'h').replace(/5/g,'kh').replace(/8/g,'gh');
const fold = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();

function speak(t){
  try {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ar'; u.rate = .8;
    const v = (speechSynthesis.getVoices()||[]).find(x => (x.lang||'').startsWith('ar'));
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}

/* ---------------- accès aux items ---------------- */
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

function weight(e){ return e.score < 0 ? 4 : (e.seen === 0 ? 3 : (e.score < 3 ? 2 : 1)); }
function pick(list, type){
  if (!list.length) return null;
  const pool = [];
  for (const x of list) { const w = weight(get(type, x.id)); for (let i=0;i<w;i++) pool.push(x); }
  return pool[Math.floor(Math.random() * pool.length)];
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
    item_type: QUEUE[k].item_type,
    item_id: QUEUE[k].item_id,
    ok: QUEUE[k].ok, ko: QUEUE[k].ko, score: QUEUE[k].score, seen: QUEUE[k].seen,
    last_at: new Date(QUEUE[k].last || Date.now()).toISOString(),
    updated_at: new Date().toISOString()
  })).filter(r => !String(r.item_id).startsWith('seed:'));  // le contenu de repli n'existe pas en base

  if (!rows.length) { QUEUE = {}; saveQueue(); return; }
  setSync('syncing');
  const { error } = await sb.from('progress').upsert(rows, { onConflict: 'user_id,item_type,item_id' });
  if (error) { setSync('error'); return; }

  // activité du jour
  const d = today();
  if (DAYS[d]) await sb.from('activity').upsert(
    { user_id: SESSION.user.id, day: d, answers: DAYS[d] }, { onConflict: 'user_id,day' });

  for (const k of keys) delete QUEUE[k];
  saveQueue(); setSync('idle'); renderStats();
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
    // dernière écriture gagnante, sauf si un envoi local est encore en attente
    if (!local || (!QUEUE[k] && remote.seen >= local.seen)) PROG[k] = remote;
  }
  for (const r of ac.data) DAYS[r.day] = Math.max(DAYS[r.day] || 0, r.answers);
  saveProg(); saveDays();

  setSync('idle');
  renderAll();
}

function setSync(s){ syncState = s; renderWho(); }

/* ---------------- authentification ---------------- */
function renderWho(){
  const dot = $('sdot'), who = $('swho'), out = $('sout');
  if (SESSION) {
    const n = Object.keys(QUEUE).length;
    dot.className = 'dot ' + (syncState === 'error' ? 'off' : 'on');
    who.textContent = SESSION.user.email
      + (syncState === 'syncing' ? ' · synchro…' : syncState === 'error' ? ' · hors ligne' : n ? ` · ${n} en attente` : ' · à jour');
    out.style.display = '';
  } else {
    dot.className = 'dot';
    who.textContent = 'hors ligne — progression locale';
    out.style.display = '';
    out.textContent = 'Se connecter';
  }
}

async function boot(){
  const { data } = await sb.auth.getSession();
  SESSION = data.session;
  if (!SESSION && !LOCAL_ONLY) { $('gate').classList.add('show'); }
  renderWho(); renderAll();
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
  const email = $('gmail').value.trim();
  const fb = $('gfb');
  if (!/.+@.+\..+/.test(email)) { fb.innerHTML = '<div class="fb no">Adresse email invalide.</div>'; return; }
  fb.innerHTML = '<div class="fb ok"><span class="spin"></span> Envoi…</div>';
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false }
  });
  fb.innerHTML = error
    ? `<div class="fb no">${esc(error.message)}<br><span class="tiny">L'accès est sur invitation : si tu n'as pas été invité, aucun compte ne peut être créé.</span></div>`
    : '<div class="fb ok">Lien envoyé. Ouvre-le depuis cet appareil.</div>';
});
$('gmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('gsend').click(); });

$('glocal').addEventListener('click', () => {
  LOCAL_ONLY = true; ls.set(K.mode, 'local');
  $('gate').classList.remove('show'); renderWho();
});

$('sout').addEventListener('click', async () => {
  if (SESSION) {
    if (!confirm('Se déconnecter ? La progression déjà synchronisée est conservée en ligne.')) return;
    await push(); await sb.auth.signOut(); SESSION = null;
  }
  ls.set(K.mode, null); LOCAL_ONLY = false;
  $('gate').classList.add('show'); renderWho();
});

/* ---------------- navigation ---------------- */
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', function(){
  document.querySelectorAll('nav button').forEach(x => x.classList.remove('on'));
  this.classList.add('on');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
  $('p-' + this.dataset.p).classList.add('on');
  window.scrollTo(0,0);
}));

/* ============================================================
   VOCABULAIRE
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
  $('vshow').addEventListener('click', vreveal);
  vprog();
}
function vreveal(){
  $('vback').style.display = 'block';
  $('vbtns').innerHTML = '<button class="act bad" id="vno">À revoir</button><button class="act good" id="vyes">Je savais</button>';
  $('vno').addEventListener('click',  () => { rec('item', vcur.id, false); vnext(); renderLex(); renderStats(); });
  $('vyes').addEventListener('click', () => { rec('item', vcur.id, true);  vnext(); renderLex(); renderStats(); });
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

function statOf(x, type){
  const e = get(type, x.id);
  if (x.status === 'pending') return { k:'pending', t:'à traduire', cls:'pill g', e };
  if (e.score >= 3)  return { k:'ok',    t:'maîtrisé',  cls:'pill',   e };
  if (!e.seen)       return { k:'new',   t:'jamais vu', cls:'pill g', e };
  return { k:'learn', t: e.score < 0 ? 'à revoir' : 'en cours', cls:'pill g', e };
}

function lfiltered(){
  const q = fold(lq.value);
  return DATA.items.filter(x => {
    if (lcat.value !== '*' && x.category !== lcat.value) return false;
    const st = statOf(x, 'item');
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
      const st = statOf(x, 'item'), e = st.e;
      return `<tr>
        <td class="tiny">${esc(x.category)}${x.is_seed ? '' : ' <span class="pill" style="font-size:10px">perso</span>'}${x.kind==='sentence' ? ' <span class="pill g" style="font-size:10px">phrase</span>' : ''}</td>
        <td>${esc(x.fr)}</td>
        <td class="f">${esc(x.arabizi) || '<span class="tiny">—</span>'}</td>
        <td class="ar" style="font-size:19px">${esc(x.ar)}</td>
        <td><span class="${st.cls}">${st.t}</span></td>
        <td class="tiny" style="white-space:nowrap">${e.seen
          ? `<b style="color:#0b5b50">${e.ok}</b> / <b style="color:var(--bad)">${e.ko}</b> <span style="opacity:.6">(${pct(e)}%)</span>`
          : '—'}</td>
        <td style="white-space:nowrap">
          ${x.ar ? `<button class="spk" data-say="${esc(x.ar)}">🔊</button>` : ''}
          ${x.is_seed ? '' : `<button class="spk" data-del="${esc(x.id)}" title="Supprimer">🗑</button>`}
        </td></tr>`;
    }).join('');

  $('ltable').querySelectorAll('[data-say]').forEach(b => b.addEventListener('click', () => speak(b.dataset.say)));
  $('ltable').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => delItem(b.dataset.del)));
}

async function delItem(id){
  if (!confirm('Supprimer cette carte ?')) return;
  DATA.items = DATA.items.filter(i => i.id !== id); saveData();
  fillCats(vcat, 'Toutes les catégories'); fillCats(lcat, 'Toutes les catégories'); fillForm();
  renderLex(); vnext();
  if (SESSION && !String(id).startsWith('seed:')) await sb.from('items').delete().eq('id', id);
}

[lq, lcat, lstat].forEach(el => el.addEventListener(el === lq ? 'input' : 'change', renderLex));
$('lpendshow').addEventListener('click', () => { lstat.value = 'pending'; lq.value = ''; lcat.value = '*'; renderLex(); });

/* --- ajout de carte --- */
const fcat = $('fcat');
function fillForm(){
  const cs = [...new Set(DATA.items.map(i => i.category))].sort();
  fcat.innerHTML = cs.map(c => `<option>${esc(c)}</option>`).join('')
    + '<option value="__new">+ Nouvelle catégorie…</option>';
}
$('ltoggle').addEventListener('click', function(){
  const f = $('lform'), open = f.style.display === 'none';
  f.style.display = open ? 'block' : 'none';
  this.textContent = open ? 'Fermer' : '+ Nouvelle carte';
  if (open) $('ffr').focus();
});
$('fcancel').addEventListener('click', () => {
  $('lform').style.display = 'none'; $('ltoggle').textContent = '+ Nouvelle carte';
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
  if (on) { $('farz').value = ''; $('far').value = ''; }
});

$('fadd').addEventListener('click', async () => {
  const ask = $('fask').checked;
  const cat = fcat.value === '__new' ? $('fcatnew').value.trim() : fcat.value;
  const fr = $('ffr').value.trim(), arz = $('farz').value.trim();
  const ar = $('far').value.trim(), note = $('fnote').value.trim();
  const fb = $('ffb');

  if (!cat || !fr)        return fb.innerHTML = '<div class="fb no">La catégorie et le français sont obligatoires.</div>';
  if (!ask && !arz)       return fb.innerHTML = '<div class="fb no">Renseigne l\'arabizi, ou coche « cherche-moi la traduction ».</div>';
  if (DATA.items.some(i => fold(i.fr) === fold(fr) && i.kind === 'word'))
    return fb.innerHTML = `<div class="fb no">Une carte « ${esc(fr)} » existe déjà.</div>`;

  const row = { kind:'word', category:cat, fr, arabizi: ask ? '' : arz, ar: ask ? '' : (ar || arz),
                note, status: ask ? 'pending' : 'ready', verified:false };

  if (SESSION) {
    const { data, error } = await sb.from('items')
      .insert({ ...row, created_by: SESSION.user.id, requested_by: ask ? SESSION.user.id : null })
      .select().single();
    if (error) return fb.innerHTML = `<div class="fb no">${esc(error.message)}</div>`;
    DATA.items.push(data);
  } else {
    DATA.items.push({ ...row, id: 'local:' + Date.now(), is_seed:false, cloze_index:null });
  }
  saveData();
  fillCats(vcat, 'Toutes les catégories'); fillCats(lcat, 'Toutes les catégories'); fillForm();
  renderLex(); renderStats();

  fb.innerHTML = ask
    ? `<div class="fb ok">✓ « ${esc(fr)} » enregistrée en attente de traduction.</div>`
    : `<div class="fb ok">✓ « ${esc(fr)} » ajoutée à tes révisions.</div>`;
  ['ffr','farz','far','fnote'].forEach(i => $(i).value = '');
  $('ffr').focus();
});

/* ============================================================
   CONJUGAISON
   ============================================================ */
const PERS = ['ana (je)','nta (tu, m.)','nti (tu, f.)','houwa (il)','hiya (elle)','hna (nous)','ntouma (vous)','houma (ils)'];
const cverb = $('cverb'), ctense = $('ctense');
let cq = null;

function fillVerbs(){
  cverb.innerHTML = verbs().map((v,i) => `<option value="${i}">${esc(v.fr)} — ${esc(v.base)}</option>`).join('');
}
function ctable(){
  const list = verbs(), v = list[+cverb.value];
  if (!v) return $('ctable').innerHTML = '<tr><td class="tiny">Aucun verbe disponible.</td></tr>';
  const f = v.forms[ctense.value];
  $('ctable').innerHTML =
    `<tr><th colspan="2">${esc(v.fr)} · <span class="ar" style="font-size:18px">${esc(v.ar)}</span> · <span class="pill g">${esc(v.pattern)}</span></th></tr>`
    + f.map((x,i) => `<tr><td>${PERS[i]}</td><td class="f">${esc(x)}</td></tr>`).join('');
}
cverb.addEventListener('change', ctable);
ctense.addEventListener('change', ctable);

function cnew(){
  const list = verbs();
  const v = pick(list, 'verb');
  if (!v) { $('cq').textContent = 'Aucun verbe disponible.'; return; }
  const p = Math.floor(Math.random()*8), t = Math.random() < .5 ? 'present' : 'past';
  cq = { v, p, t };
  $('cprompt').textContent = (t === 'present' ? 'Présent' : 'Passé') + ' · ' + v.pattern;
  $('cq').innerHTML = `${esc(v.fr)} <span class="ar" style="font-size:18px">${esc(v.ar)}</span> → <span class="pill">${PERS[p]}</span>`;
  $('cin').value = ''; $('cfb').innerHTML = ''; $('cin').focus();
}
function cscore(){
  let ok = 0, n = 0;
  for (const v of verbs()) { const e = get('verb', v.id); ok += e.ok; n += e.seen; }
  $('cscore').textContent = `${ok} / ${n} correctes` + (n ? ` (${Math.round(ok/n*100)}%)` : '');
}
function ccheck(){
  if (!cq) return;
  const good = cq.v.forms[cq.t][cq.p];
  const ok = norm($('cin').value) === norm(good);
  rec('verb', cq.v.id, ok); cscore(); renderStats();
  $('cfb').innerHTML = ok
    ? `<div class="fb ok">✓ <b>${esc(good)}</b> — dis-le à voix haute, puis continue.</div>`
    : `<div class="fb no">✗ La bonne forme est <b>${esc(good)}</b>. Répète-la 3 fois avant de passer.</div>`;
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
   PHRASES
   ============================================================ */
const scat = $('scat');
let scur = null;

function fillScats(){
  const keep = scat.value;
  const cs = [...new Set(sentences().map(s => s.category))].sort();
  scat.innerHTML = '<option value="*">Toutes les catégories</option>' + cs.map(c => `<option>${esc(c)}</option>`).join('');
  if (keep && [...scat.options].some(o => o.value === keep)) scat.value = keep;
}
const sword = s => s.arabizi.split(' ')[Math.min(s.cloze_index ?? 0, s.arabizi.split(' ').length - 1)];

function snext(){
  const list = sentences().filter(s => scat.value === '*' || s.category === scat.value);
  scur = pick(list, 'item');
  if (!scur) { $('sfr').textContent = 'Aucune phrase dans cette catégorie.'; return; }
  const w = scur.arabizi.split(' '), idx = Math.min(scur.cloze_index ?? 0, w.length - 1);
  $('sfr').textContent = scur.fr;
  $('scloze').innerHTML = w.map((x,i) => i === idx ? '<span class="hl">_____</span>' : esc(x)).join(' ');
  $('sin').value = ''; $('sfb').innerHTML = ''; $('sfull').style.display = 'none';
  let ok = 0, n = 0;
  for (const s of sentences()) { const e = get('item', s.id); ok += e.ok; n += e.seen; }
  $('sscore').textContent = `${ok} / ${n} correctes`;
}
function sreveal(ok){
  $('sfb').innerHTML = ok
    ? `<div class="fb ok">✓ <b>${esc(sword(scur))}</b></div>`
    : `<div class="fb no">✗ C'était <b>${esc(sword(scur))}</b></div>`;
  $('sarz').textContent = scur.arabizi;
  $('sar').textContent  = scur.ar;
  $('snote').textContent = scur.note ? '↳ ' + scur.note : '';
  $('sfull').style.display = 'block';
  speak(scur.ar);
}
$('sok').addEventListener('click', () => {
  if (!scur) return;
  const ok = norm($('sin').value) === norm(sword(scur));
  rec('item', scur.id, ok); renderStats(); sreveal(ok);
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

function streak(){
  let n = 0; const d = new Date();
  if (!DAYS[fmtd(d)]) d.setDate(d.getDate()-1);
  while (DAYS[fmtd(d)]) { n++; d.setDate(d.getDate()-1); }
  return n;
}

function renderStats(){
  const w = words(), sn = sentences(), vb = verbs();
  let mast = 0, seen = 0, ok = 0, ko = 0;
  for (const x of [...w, ...sn]) { const e = get('item', x.id); if (e.score >= 3) mast++; if (e.seen) seen++; ok += e.ok; ko += e.ko; }
  let vok = 0, vn = 0;
  for (const v of vb) { const e = get('verb', v.id); vok += e.ok; vn += e.seen; }
  const totOk = ok + vok, totN = ok + ko + vn;

  $('pkpi').innerHTML =
      kpi('Cartes maîtrisées', `${mast} / ${w.length + sn.length}`, `${seen} déjà vues`)
    + kpi('Réussite globale', (totN ? Math.round(totOk/totN*100) : 0) + '%', `${totOk} bonnes sur ${totN}`)
    + kpi('Conjugaison', `${vok} / ${vn}`, vn ? Math.round(vok/vn*100)+'% de réussite' : 'pas encore commencé')
    + kpi('Vocabulaire & phrases', `${ok} / ${ok+ko}`, (ok+ko) ? Math.round(ok/(ok+ko)*100)+'% de réussite' : 'pas encore commencé');

  const d = new Date(); d.setDate(d.getDate()-29);
  let cal = '';
  for (let i=0;i<30;i++){
    const key = fmtd(d), n = DAYS[key] || 0;
    const op = n === 0 ? .08 : n < 10 ? .3 : n < 30 ? .6 : 1;
    cal += `<div title="${key} — ${n} réponses" style="width:20px;height:20px;border-radius:5px;background:rgba(15,123,108,${op})"></div>`;
    d.setDate(d.getDate()+1);
  }
  $('pcal').innerHTML = cal;
  const st = streak();
  $('pstreak').textContent = st
    ? `Série en cours : ${st} jour${st>1?'s':''} d'affilée.`
    : "Aucune série en cours. Une seule carte suffit à la relancer.";

  const weak = [
    ...[...w,...sn].map(x => ({ l:x.fr, r:x.arabizi, e:get('item',x.id), t: x.kind === 'sentence' ? 'phrase' : 'mot' })),
    ...vb.map(v => ({ l:v.fr, r:v.base, e:get('verb',v.id), t:'verbe' }))
  ].filter(x => x.e.ko > 0).sort((a,b) => (b.e.ko-b.e.ok) - (a.e.ko-a.e.ok) || b.e.ko - a.e.ko).slice(0,12);

  $('pweak').innerHTML = '<tr><th>Type</th><th>Item</th><th>Réponse</th><th>✓ / ✗</th></tr>'
    + (weak.length ? '' : '<tr><td colspan="4" class="tiny" style="padding:18px;text-align:center">Rien à signaler pour l\'instant.</td></tr>')
    + weak.map(x => `<tr><td class="tiny">${x.t}</td><td>${esc(x.l)}</td><td class="f">${esc(x.r)}</td>
        <td class="tiny"><b style="color:#0b5b50">${x.e.ok}</b> / <b style="color:var(--bad)">${x.e.ko}</b></td></tr>`).join('');

  const cs = [...new Set(DATA.items.map(i => i.category))].sort();
  $('pcat').innerHTML = '<tr><th>Catégorie</th><th>Maîtrisés</th><th>Progression</th></tr>'
    + cs.map(c => {
      const list = DATA.items.filter(i => i.category === c && i.status === 'ready');
      const dn = list.filter(i => get('item', i.id).score >= 3).length;
      const p = list.length ? Math.round(dn/list.length*100) : 0;
      return `<tr><td>${esc(c)}</td><td class="tiny">${dn} / ${list.length}</td>
        <td><div class="bar" style="margin:0"><i style="width:${p}%"></i></div></td></tr>`;
    }).join('');

  const q = Object.keys(QUEUE).length;
  $('psync').innerHTML = `
    <tr><td>Compte</td><td class="f">${SESSION ? esc(SESSION.user.email) : 'aucun — mode local'}</td></tr>
    <tr><td>Contenu</td><td class="f">${DATA.items.length} items · ${DATA.verbs.length} verbes</td></tr>
    <tr><td>En attente d'envoi</td><td class="f">${q} modification${q>1?'s':''}</td></tr>
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
  t.value = JSON.stringify({ prog:PROG, days:DAYS, custom:DATA.items.filter(i => !i.is_seed) });
  t.style.display = 'block'; t.focus(); t.select();
  try { navigator.clipboard?.writeText(t.value); } catch {}
  $('pfb').innerHTML = '<div class="fb ok">Sauvegarde copiée.</div>';
});

/* ---------------- rendu global ---------------- */
function renderVer(){
  const v = $('vmode');
  if (v) v.textContent = SESSION ? 'connecté' : (LOCAL_ONLY ? 'mode local' : 'déconnecté');
}
function renderAll(){
  renderVer();
  fillCats(vcat, 'Toutes les catégories');
  fillCats(lcat, 'Toutes les catégories');
  fillForm(); fillVerbs(); fillScats();
  vnext(); ctable(); cnew(); cscore(); snext(); renderLex(); renderStats();
}

window.addEventListener('online',  () => { setSync('idle'); push(); });
window.addEventListener('offline', () => setSync('error'));
window.addEventListener('beforeunload', () => { if (SESSION && Object.keys(QUEUE).length) push(); });

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
