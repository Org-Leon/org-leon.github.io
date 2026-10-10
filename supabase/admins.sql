-- FeldFolio+ — Admins über eine Liste statt über die Adress-Endung
--
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query →
-- diesen Inhalt einfügen → Run. Mehrfaches Ausführen schadet nicht.
-- Reihenfolge: VOR fehlerberichte.sql (dessen Admin-Prüfung nutzt ist_admin()).
--
-- Bisher war jede angemeldete @oekop.de-Adresse Admin. Jetzt ist Admin nur, wer
-- in der Tabelle admin_konten steht. Betroffen sind alle Admin-Rechte:
--   - Zugangsanfragen lesen/bearbeiten, Adressen freischalten (grundregeln.sql)
--   - Nutzungscode-Vorschläge freigeben/ablehnen (nutzungscodes.sql)
--   - Fehlerberichte bearbeiten (fehlerberichte.sql)
-- NICHT betroffen: Registrieren dürfen sich weiterhin alle @oekop.de-Adressen
-- (registrierung.sql) — das ist kein Admin-Recht.
--
-- Wer Admin ist, steht NICHT in dieser Datei (keine Adressen im Repo). Nach dem
-- Ausführen im SQL-Editor einmal von Hand eintragen:
--   Admin hinzufügen:  insert into public.admin_konten (email) values ('vorname.name@oekop.de');
--   Admin entfernen:   delete from public.admin_konten where email = 'vorname.name@oekop.de';
--   Liste ansehen:     select * from public.admin_konten;
-- Solange die Liste leer ist, gibt es keinen Admin.
-- Die Adresse muss bestätigt sein ("Confirm email" und "Secure email change"
-- im Dashboard eingeschaltet), sonst könnte sich jemand eine fremde Adresse geben.
--
-- Zwei-Faktor (TOTP, Authenticator-App): Admin-RECHTE gibt es nur mit einem
-- zweiten Faktor, der höchstens 12 Stunden alt ist — im Anmelde-Token steht
-- dann aal = 'aal2' und in amr ein Eintrag "totp" mit Zeitpunkt. Für die normale
-- Nutzung der App reicht weiterhin das Passwort; den Code fragt die App erst beim
-- Öffnen der Verwaltung ab (und richtet die Authenticator-App beim ersten Mal ein).
-- Voraussetzung im Dashboard: Authentication → Multi-Factor → TOTP aktiviert
-- (Standard). Authenticator verloren: im Dashboard unter Authentication → Users
-- beim Nutzer den Faktor löschen, dann in der App neu einrichten.

create table if not exists public.admin_konten (
  email       text primary key check (email = lower(email) and email like '%@%'),
  angelegt_am timestamptz not null default now()
);

-- Niemand liest oder ändert die Liste über die App; gepflegt wird sie hier im SQL-Editor.
alter table public.admin_konten enable row level security;
revoke all on public.admin_konten from anon, authenticated;

-- Steht der angemeldete Nutzer auf der Liste? Gibt KEINE Rechte — die App zeigt
-- damit nur die Verwaltung an und fragt dann den zweiten Faktor ab.
-- (E-Mail aus dem Anmelde-Token, nicht vom Client; "security definer": darf die
-- sonst gesperrte Liste lesen.)
create or replace function public.admin_konto()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_konten where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.admin_konto() from public, anon;
grant execute on function public.admin_konto() to authenticated;

-- Admin-Rechte: auf der Liste UND zweiter Faktor (TOTP) in den letzten 12 Stunden
create or replace function public.ist_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.admin_konto()
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as faktor
       where faktor ->> 'method' = 'totp'
         and (faktor ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 12 * 3600
     );
$$;
revoke all on function public.ist_admin() from public, anon;
grant execute on function public.ist_admin() to authenticated;

-- ---------- bestehende Admin-Prüfungen umstellen ----------
drop policy if exists "oekop admins can view requests" on public.access_requests;
create policy "oekop admins can view requests" on public.access_requests
  for select to authenticated
  using (public.ist_admin());

drop policy if exists "oekop admins can update requests" on public.access_requests;
create policy "oekop admins can update requests" on public.access_requests
  for update to authenticated
  using (public.ist_admin())
  with check (public.ist_admin());

drop policy if exists "oekop admins can manage allowlist" on public.access_allowlist;
create policy "oekop admins can manage allowlist" on public.access_allowlist
  for all to authenticated
  using (public.ist_admin())
  with check (public.ist_admin());

create or replace function public.nutzungscodes_ist_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.ist_admin();
$$;

-- Fehlerberichte: falls fehlerberichte.sql schon lief, hier ebenfalls umstellen
create or replace function public.fehlerberichte_ist_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.ist_admin();
$$;
