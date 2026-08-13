-- stubs des objets fournis par Supabase, pour tester le schéma hors Supabase
create schema if not exists auth;
create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
do $$ begin
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
