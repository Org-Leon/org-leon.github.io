-- FeldFolio+ — Gemeinsame Nutzungscode-Tabelle (Code -> Kultur je Bundesland)
--
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query →
-- diesen Inhalt einfügen → Run.
--
-- Wofür: Shape-Dateien mancher Bundesländer (z. B. Thüringen) enthalten nur
-- einen Nutzungscode. Die App lernt die Bedeutung aus dem Flächen- und
-- Nutzungsnachweis (PDF) oder der Kontrolleur trägt sie selbst ein. Jede so
-- gefundene Kombination wird hier als VORSCHLAG abgelegt; ein Admin
-- (@oekop.de) gibt ihn frei oder lehnt ihn ab. Freigegebene Codes lädt jede
-- App und übersetzt damit die Flächen aller Nutzer.
--
-- Rechte (Row Level Security):
--   - angemeldete Nutzer: freigegebene Codes und eigene Vorschläge lesen,
--     eigene Vorschläge anlegen (nur Status "vorschlag")
--   - Admins (bestätigte @oekop.de-Adresse): alles lesen, freigeben/ablehnen
-- Voraussetzung: In Supabase sind "Confirm email" und "Secure email change"
-- eingeschaltet — sonst könnte sich jemand eine @oekop.de-Adresse geben.

create table if not exists public.nutzungscodes (
  id                bigint generated always as identity primary key,
  land              text not null check (land ~ '^[A-Z]{2}$'),
  code              text not null check (code ~ '^[0-9]{1,8}$'),
  kultur            text not null check (char_length(kultur) between 1 and 250),
  quelle            text not null default 'fnn' check (quelle in ('fnn', 'manuell')),
  status            text not null default 'vorschlag' check (status in ('vorschlag', 'freigegeben', 'abgelehnt')),
  vorgeschlagen_von uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  geprueft_von      uuid references auth.users (id) on delete set null,
  geprueft_am       timestamptz,
  unique (land, code, kultur, vorgeschlagen_von)
);

create index if not exists nutzungscodes_status_idx on public.nutzungscodes (status);

-- Admin = angemeldet mit @oekop.de-Adresse (aus dem Token, nicht vom Client)
create or replace function public.nutzungscodes_ist_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@oekop.de', false);
$$;

alter table public.nutzungscodes enable row level security;

drop policy if exists "nutzungscodes lesen" on public.nutzungscodes;
create policy "nutzungscodes lesen" on public.nutzungscodes
  for select to authenticated
  using (status = 'freigegeben' or vorgeschlagen_von = auth.uid() or public.nutzungscodes_ist_admin());

drop policy if exists "nutzungscodes vorschlagen" on public.nutzungscodes;
create policy "nutzungscodes vorschlagen" on public.nutzungscodes
  for insert to authenticated
  with check (vorgeschlagen_von = auth.uid() and status = 'vorschlag' and geprueft_von is null and geprueft_am is null);

drop policy if exists "nutzungscodes pruefen" on public.nutzungscodes;
create policy "nutzungscodes pruefen" on public.nutzungscodes
  for update to authenticated
  using (public.nutzungscodes_ist_admin())
  with check (public.nutzungscodes_ist_admin());

drop policy if exists "nutzungscodes loeschen" on public.nutzungscodes;
create policy "nutzungscodes loeschen" on public.nutzungscodes
  for delete to authenticated
  using (public.nutzungscodes_ist_admin());

revoke all on public.nutzungscodes from anon;
grant select, insert, update, delete on public.nutzungscodes to authenticated;
