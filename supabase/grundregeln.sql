-- FeldFolio+ — Grundregeln (Zugriffsschutz der Basistabellen und des Fotospeichers)
--
-- Diese Regeln BESTEHEN bereits auf dem Server; die Datei hält sie im Repo fest
-- (abgelesen mit rls-pruefen.sql am 08.10.2026) — zum Nachvollziehen und um ein
-- neues Projekt genauso einzurichten. Erneutes Ausführen ändert nichts: jede
-- Regel wird mit demselben Namen und Inhalt neu angelegt.
--
-- Der öffentliche "anon"-Schlüssel steckt in der App. Dass niemand fremde Daten
-- sieht, leisten allein diese Regeln (Row Level Security).
--
-- Nicht enthalten (eigene Dateien): nutzungscodes.sql, sync-kanal.sql,
-- zugangsanfragen-limit.sql, konto-loeschen.sql, registrierung.sql (wer darf sich
-- registrieren). Ebenfalls nicht enthalten: die Tabellen selbst.
--
-- Admin = Adresse steht in der Liste admin_konten (public.ist_admin(), siehe
-- admins.sql — muss vorher gelaufen sein). Das ist nur sicher, solange im
-- Dashboard unter Authentication "Confirm email" und "Secure email change"
-- eingeschaltet sind.

-- ---------- Arbeitsstand: jeder nur seine eigene Zeile ----------
alter table public.feldfolio_state enable row level security;

drop policy if exists "own row" on public.feldfolio_state;
create policy "own row" on public.feldfolio_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- Zugangsanfragen ----------
-- Anlegen darf jeder (auch ohne Anmeldung) — begrenzt durch zugangsanfragen-limit.sql.
-- Lesen und bearbeiten nur Admins.
alter table public.access_requests enable row level security;

drop policy if exists "anyone can submit a request" on public.access_requests;
create policy "anyone can submit a request" on public.access_requests
  for insert to anon, authenticated
  with check (true);

drop policy if exists "oekop admins can view requests" on public.access_requests;
create policy "oekop admins can view requests" on public.access_requests
  for select to authenticated
  using (public.ist_admin());

drop policy if exists "oekop admins can update requests" on public.access_requests;
create policy "oekop admins can update requests" on public.access_requests
  for update to authenticated
  using (public.ist_admin())
  with check (public.ist_admin());

-- ---------- Freigeschaltete Adressen: nur Admins ----------
alter table public.access_allowlist enable row level security;

drop policy if exists "oekop admins can manage allowlist" on public.access_allowlist;
create policy "oekop admins can manage allowlist" on public.access_allowlist
  for all to authenticated
  using (public.ist_admin())
  with check (public.ist_admin());

-- ---------- Fotos und Dokumente: privater Bucket, jeder nur sein Ordner ----------
-- Der Bucket "feldfolio-photos" ist NICHT öffentlich; Pfad = <user-id>/<datei>.
drop policy if exists "own photos read" on storage.objects;
create policy "own photos read" on storage.objects
  for select
  using (bucket_id = 'feldfolio-photos' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "own photos insert" on storage.objects;
create policy "own photos insert" on storage.objects
  for insert
  with check (bucket_id = 'feldfolio-photos' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "own photos delete" on storage.objects;
create policy "own photos delete" on storage.objects
  for delete
  using (bucket_id = 'feldfolio-photos' and (storage.foldername(name))[1] = (auth.uid())::text);
