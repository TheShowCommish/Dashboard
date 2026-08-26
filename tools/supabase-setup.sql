-- ============================================================
-- supabase-setup.sql — the whole backend for dashboard sync.
--
-- Run this once, in the Supabase dashboard: SQL Editor -> New query ->
-- paste -> Run. It is safe to run again; every statement is guarded.
--
-- WHAT IT MAKES
--   deck_state — one row per synced path per user. The dashboard writes
--   'menu.plan', 'menu.bought', 'todos' and so on as separate rows on
--   purpose: two devices editing different paths then never collide, so
--   the phone ticking the shopping list while the wall display edits the
--   meal plan is not a conflict at all.
--
-- WHAT PROTECTS IT
--   Row-level security, keyed to the signed-in user. The anon key that
--   ships in the page can do nothing without a valid login: every
--   statement below is fenced by auth.uid(), and an anonymous request
--   has no auth.uid() to match.
--
--   user_id defaults to auth.uid() rather than being sent by the client,
--   so the browser cannot write a row onto somebody else's account even
--   if it tried — and the WITH CHECK clause refuses it if it does.
-- ============================================================

create table if not exists public.deck_state (
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  path       text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- The client pulls with `updated_at=gt.<last seen>`, so this is the
-- index that keeps a poll cheap as the table fills up.
create index if not exists deck_state_user_updated_idx
  on public.deck_state (user_id, updated_at desc);

-- Touch updated_at on every write. Doing it in the database rather than
-- trusting the client is what makes the pull watermark reliable: a phone
-- with a wrong clock cannot poison it.
create or replace function public.deck_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists deck_state_touch on public.deck_state;
create trigger deck_state_touch
  before insert or update on public.deck_state
  for each row execute function public.deck_state_touch();

alter table public.deck_state enable row level security;

-- One policy per verb, all saying the same thing: your rows, nobody
-- else's. Split rather than FOR ALL so a future change to one verb
-- cannot silently widen the others.
drop policy if exists deck_state_select on public.deck_state;
create policy deck_state_select on public.deck_state
  for select using (auth.uid() = user_id);

drop policy if exists deck_state_insert on public.deck_state;
create policy deck_state_insert on public.deck_state
  for insert with check (auth.uid() = user_id);

drop policy if exists deck_state_update on public.deck_state;
create policy deck_state_update on public.deck_state
  for update using (auth.uid() = user_id)
           with check (auth.uid() = user_id);

drop policy if exists deck_state_delete on public.deck_state;
create policy deck_state_delete on public.deck_state
  for delete using (auth.uid() = user_id);

-- ============================================================
-- AFTER RUNNING THIS
--
-- 1. Authentication -> Sign In / Providers: make sure Email is enabled.
--    Turn OFF "Confirm email" only if you want the very first link to
--    sign you straight in; leaving it on is fine, it just means the
--    first email is a confirmation and the second is the login.
--
-- 2. Authentication -> URL Configuration:
--      Site URL           https://<you>.github.io/Dashboard/
--      Redirect URLs      https://<you>.github.io/Dashboard/**
--    Add http://localhost:8020/** too if you develop locally.
--    A redirect URL that is not on this list is rejected, and the magic
--    link will bounce you to the site root instead of the page you were
--    on — that is the usual cause of "the link did nothing".
--
-- 3. Project Settings -> API: copy the Project URL and the anon key into
--    js/sync-config.js and commit it. Both are meant to be public. The
--    service_role key is NOT — it bypasses every policy above.
--
-- 4. Open the deck, Settings -> Sync, enter your email, click the link.
--    Then press "Upload this device" ONCE, on the device that already
--    has your real data. After that every device just signs in.
--
-- TO SEE WHAT IS STORED
--   select path, jsonb_pretty(value), updated_at
--     from deck_state order by updated_at desc;
--
-- TO START OVER (this deletes your synced data, not your login)
--   delete from deck_state;
-- ============================================================
