-- FeldFolio+ — Fehlerberichte („Fehler melden“ in der App)
--
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query →
-- diesen Inhalt einfügen → Run. Mehrfaches Ausführen schadet nicht.
-- Vorher admins.sql ausführen (Liste der Admins, Funktion ist_admin()).
--
-- Wofür: Nutzer melden Fehler, Verbesserungsvorschläge und Fragen direkt aus
-- der App (src/fehlerbericht.js). Jede Meldung wird hier als Vorgang mit
-- fortlaufender Nummer (#1, #2, …) abgelegt und von Admins in der App unter
-- Konto → Verwaltung → Fehlerberichte bearbeitet (Status, Priorität, Notiz).
--
-- Aufbau einer Meldung (übliche Fehlerbericht-Felder):
--   art, titel, schritte (Schritte zum Nachstellen), erwartet, tatsaechlich,
--   schwere, haeufigkeit, umgebung (Version, Browser, Gerät, Ansicht …),
--   protokoll (letzte Fehlermeldungen und Klickspur der App, bereinigt),
--   optional ein Bildschirmfoto (JPEG als data-URL, nur wenn der Nutzer es anhängt)
-- Bearbeitung: status (neu → bestaetigt → in_arbeit → erledigt | abgelehnt |
--   duplikat), prioritaet (p1–p4), duplikat_von, notiz, bearbeitet_von
--
-- Rechte (Row Level Security):
--   - angemeldete Nutzer: eigene Meldungen anlegen und lesen (nicht ändern)
--   - Admins (Liste admin_konten, admins.sql): alle lesen, bearbeiten, löschen;
--     der Inhalt einer Meldung bleibt dabei unverändert (Trigger)
--   - je Nutzer höchstens 10 Meldungen pro Stunde und 30 pro Tag
--   - Konto gelöscht -> seine Meldungen werden mit gelöscht (Datenschutz)
-- Voraussetzung: In Supabase sind "Confirm email" und "Secure email change"
-- eingeschaltet — sonst könnte sich jemand eine fremde Adresse geben.

create table if not exists public.fehlerberichte (
  id             uuid primary key default gen_random_uuid(),
  nummer         bigint generated always as identity unique,
  client_id      text not null unique check (char_length(client_id) between 8 and 64),
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz not null default now(),
  gemeldet_von   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email          text check (char_length(email) <= 254),
  art            text not null check (art in ('fehler', 'verbesserung', 'frage')),
  schwere        text not null default 'mittel' check (schwere in ('kritisch', 'hoch', 'mittel', 'niedrig')),
  haeufigkeit    text not null default 'unbekannt' check (haeufigkeit in ('immer', 'manchmal', 'einmal', 'unbekannt')),
  titel          text not null check (char_length(titel) between 3 and 200),
  schritte       text not null default '' check (char_length(schritte) <= 5000),
  erwartet       text not null default '' check (char_length(erwartet) <= 3000),
  tatsaechlich   text not null default '' check (char_length(tatsaechlich) <= 5000),
  umgebung       jsonb not null default '{}'::jsonb check (pg_column_size(umgebung) <= 20000),
  protokoll      jsonb not null default '[]'::jsonb check (pg_column_size(protokoll) <= 60000),
  screenshot     text check (screenshot is null or (screenshot like 'data:image/jpeg;base64,%' and char_length(screenshot) <= 1500000)),
  hat_bild       boolean generated always as (screenshot is not null) stored,
  status         text not null default 'neu' check (status in ('neu', 'bestaetigt', 'in_arbeit', 'erledigt', 'abgelehnt', 'duplikat')),
  prioritaet     text check (prioritaet in ('p1', 'p2', 'p3', 'p4')),
  duplikat_von   bigint,
  notiz          text check (char_length(notiz) <= 5000),
  bearbeitet_von uuid references auth.users (id) on delete set null
);

create index if not exists fehlerberichte_status_idx on public.fehlerberichte (status, erstellt_am desc);
create index if not exists fehlerberichte_von_idx on public.fehlerberichte (gemeldet_von, erstellt_am desc);

-- Admin = steht in der Liste admin_konten (admins.sql)
create or replace function public.fehlerberichte_ist_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.ist_admin();
$$;

-- Neue Meldung: Absender und Zeit vom Server, Bearbeitungsfelder leer, Mengenbegrenzung.
-- "security definer": die Zählung muss alle Meldungen des Nutzers sehen.
create or replace function public.fehlerberichte_neu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.gemeldet_von := auth.uid();
  new.email := lower(auth.jwt() ->> 'email');
  new.erstellt_am := now();
  new.geaendert_am := now();
  new.status := 'neu';
  new.prioritaet := null;
  new.duplikat_von := null;
  new.notiz := null;
  new.bearbeitet_von := null;
  if new.gemeldet_von is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if (select count(*) from public.fehlerberichte where gemeldet_von = new.gemeldet_von and erstellt_am > now() - interval '1 hour') >= 10
     or (select count(*) from public.fehlerberichte where gemeldet_von = new.gemeldet_von and erstellt_am > now() - interval '1 day') >= 30 then
    raise exception 'Zu viele Meldungen — bitte später erneut versuchen.';
  end if;
  return new;
end;
$$;

drop trigger if exists fehlerberichte_neu on public.fehlerberichte;
create trigger fehlerberichte_neu
  before insert on public.fehlerberichte
  for each row execute function public.fehlerberichte_neu();

-- Bearbeiten: nur die Bearbeitungsfelder ändern sich, der gemeldete Inhalt bleibt.
create or replace function public.fehlerberichte_bearbeiten()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := old.id; new.nummer := old.nummer; new.client_id := old.client_id;
  new.erstellt_am := old.erstellt_am; new.gemeldet_von := old.gemeldet_von; new.email := old.email;
  new.art := old.art; new.schwere := old.schwere; new.haeufigkeit := old.haeufigkeit;
  new.titel := old.titel; new.schritte := old.schritte; new.erwartet := old.erwartet;
  new.tatsaechlich := old.tatsaechlich; new.umgebung := old.umgebung; new.protokoll := old.protokoll;
  new.screenshot := old.screenshot;
  new.geaendert_am := now();
  new.bearbeitet_von := auth.uid();
  return new;
end;
$$;

drop trigger if exists fehlerberichte_bearbeiten on public.fehlerberichte;
create trigger fehlerberichte_bearbeiten
  before update on public.fehlerberichte
  for each row execute function public.fehlerberichte_bearbeiten();

alter table public.fehlerberichte enable row level security;

drop policy if exists "fehlerberichte lesen" on public.fehlerberichte;
create policy "fehlerberichte lesen" on public.fehlerberichte
  for select to authenticated
  using (gemeldet_von = auth.uid() or public.fehlerberichte_ist_admin());

drop policy if exists "fehlerberichte melden" on public.fehlerberichte;
create policy "fehlerberichte melden" on public.fehlerberichte
  for insert to authenticated
  with check (gemeldet_von = auth.uid());

drop policy if exists "fehlerberichte bearbeiten" on public.fehlerberichte;
create policy "fehlerberichte bearbeiten" on public.fehlerberichte
  for update to authenticated
  using (public.fehlerberichte_ist_admin())
  with check (public.fehlerberichte_ist_admin());

drop policy if exists "fehlerberichte loeschen" on public.fehlerberichte;
create policy "fehlerberichte loeschen" on public.fehlerberichte
  for delete to authenticated
  using (public.fehlerberichte_ist_admin());

revoke all on public.fehlerberichte from anon;
grant select, insert, update, delete on public.fehlerberichte to authenticated;
