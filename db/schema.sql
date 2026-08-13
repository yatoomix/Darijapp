-- ============================================================
--  DERJA — schéma complet
--  À coller dans Supabase → SQL Editor → Run
--  Idempotent : peut être relancé sans casser l'existant.
-- ============================================================

-- ------------------------------------------------------------
--  UTILITAIRE : mise à jour automatique de updated_at
-- ------------------------------------------------------------
-- search_path figé : empêche le détournement via un schéma malveillant
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- seul le trigger doit l'appeler, pas l'API REST
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- ------------------------------------------------------------
--  PROFILS
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Anonyme',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profils visibles par les connectes" on public.profiles;
create policy "profils visibles par les connectes"
  on public.profiles for select to authenticated using (true);

drop policy if exists "je modifie mon profil" on public.profiles;
create policy "je modifie mon profil"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- création automatique du profil à l'inscription
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- SECURITY DEFINER + exposée via /rest/v1/rpc : on révoque, seul le trigger l'invoque
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
--  ITEMS : mots et phrases
--  Une phrase = un mot + l'index du mot à masquer.
-- ------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('word', 'sentence')),
  category text not null,
  fr text not null,
  arabizi text not null default '',
  ar text not null default '',
  note text not null default '',
  cloze_index int,
  status text not null default 'ready' check (status in ('pending', 'ready')),
  verified boolean not null default false,
  is_seed boolean not null default false,
  created_by uuid references auth.users on delete set null,
  requested_by uuid references auth.users on delete set null,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- une phrase doit savoir quel mot masquer
  constraint sentence_needs_cloze
    check (kind <> 'sentence' or cloze_index is not null),
  -- une carte révisable doit avoir une traduction
  constraint ready_needs_translation
    check (status <> 'ready' or length(arabizi) > 0),
  -- l'index de masquage doit désigner un mot qui existe réellement
  constraint cloze_index_in_range check (
    kind <> 'sentence'
    or status <> 'ready'
    or (cloze_index >= 0 and cloze_index < array_length(string_to_array(arabizi, ' '), 1))
  )
);

create unique index if not exists items_fr_unique on public.items (kind, lower(fr));
create index if not exists items_category_idx on public.items (category);
create index if not exists items_pending_idx on public.items (status) where status = 'pending';

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();

alter table public.items enable row level security;

drop policy if exists "tout le monde lit les items" on public.items;
create policy "tout le monde lit les items"
  on public.items for select to authenticated using (true);

drop policy if exists "tout le monde ajoute un item" on public.items;
create policy "tout le monde ajoute un item"
  on public.items for insert to authenticated
  with check (created_by = auth.uid());

-- correction collaborative : à 4 personnes de confiance, c'est le bon réglage.
-- Pour restreindre : remplacer using (true) par using (created_by = auth.uid()).
drop policy if exists "tout le monde corrige un item" on public.items;
create policy "tout le monde corrige un item"
  on public.items for update to authenticated using (true) with check (true);

-- on ne supprime que ses propres ajouts, jamais le contenu initial
drop policy if exists "je supprime mes items" on public.items;
create policy "je supprime mes items"
  on public.items for delete to authenticated
  using (created_by = auth.uid() and is_seed = false);

-- ------------------------------------------------------------
--  VERBES
--  forms = {"present": [8 formes], "past": [8 formes]}
--  ordre : ana, nta, nti, houwa, hiya, hna, ntouma, houma
-- ------------------------------------------------------------
create table if not exists public.verbs (
  id uuid primary key default gen_random_uuid(),
  fr text not null,
  base text not null,
  ar text not null default '',
  pattern text not null default 'régulier',
  forms jsonb,
  status text not null default 'ready' check (status in ('pending', 'ready')),
  verified boolean not null default false,
  is_seed boolean not null default false,
  created_by uuid references auth.users on delete set null,
  requested_by uuid references auth.users on delete set null,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- un verbe révisable a bien 8 formes par temps
  constraint forms_shape check (
    status <> 'ready' or (
      forms is not null
      and jsonb_typeof(forms->'present') = 'array'
      and jsonb_typeof(forms->'past') = 'array'
      and jsonb_array_length(forms->'present') = 8
      and jsonb_array_length(forms->'past') = 8
    )
  )
);

create unique index if not exists verbs_fr_unique on public.verbs (lower(fr));
create index if not exists verbs_pending_idx on public.verbs (status) where status = 'pending';

drop trigger if exists verbs_touch on public.verbs;
create trigger verbs_touch before update on public.verbs
  for each row execute function public.touch_updated_at();

alter table public.verbs enable row level security;

drop policy if exists "tout le monde lit les verbes" on public.verbs;
create policy "tout le monde lit les verbes"
  on public.verbs for select to authenticated using (true);

drop policy if exists "tout le monde ajoute un verbe" on public.verbs;
create policy "tout le monde ajoute un verbe"
  on public.verbs for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "tout le monde corrige un verbe" on public.verbs;
create policy "tout le monde corrige un verbe"
  on public.verbs for update to authenticated using (true) with check (true);

drop policy if exists "je supprime mes verbes" on public.verbs;
create policy "je supprime mes verbes"
  on public.verbs for delete to authenticated
  using (created_by = auth.uid() and is_seed = false);

-- ------------------------------------------------------------
--  PROGRESSION (strictement privée)
-- ------------------------------------------------------------
create table if not exists public.progress (
  user_id uuid not null references auth.users on delete cascade,
  item_type text not null check (item_type in ('item', 'verb')),
  item_id uuid not null,
  ok int not null default 0,
  ko int not null default 0,
  score int not null default 0,
  seen int not null default 0,
  last_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create index if not exists progress_user_idx on public.progress (user_id, item_type);

alter table public.progress enable row level security;

drop policy if exists "ma progression seulement" on public.progress;
create policy "ma progression seulement"
  on public.progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
--  ACTIVITÉ QUOTIDIENNE (privée)
-- ------------------------------------------------------------
create table if not exists public.activity (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  answers int not null default 0,
  primary key (user_id, day)
);

alter table public.activity enable row level security;

drop policy if exists "mon activite seulement" on public.activity;
create policy "mon activite seulement"
  on public.activity for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
--  VÉRIFICATION
--  Doit renvoyer rowsecurity = true sur les 5 tables.
-- ------------------------------------------------------------
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'items', 'verbs', 'progress', 'activity')
order by tablename;
