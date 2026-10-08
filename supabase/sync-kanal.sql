-- FeldFolio+ — Privater Sync-Kanal (Realtime)
--
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query →
-- diesen Inhalt einfügen → Run.
--
-- Wofür: Nach jedem Speichern sendet ein Gerät über einen Realtime-Kanal das
-- Signal "es gibt Neues" (keine Daten), damit die anderen Geräte desselben
-- Nutzers sofort abgleichen. Der Kanal heißt "ff-sync-<user-id>". Mit diesen
-- Regeln darf nur der angemeldete Nutzer selbst in SEINEM Kanal senden und
-- mithören — vorher konnte das jeder, der die User-ID kannte.
--
-- Danach (wenn alle Geräte die neue App-Version haben): im Dashboard unter
-- Realtime → Settings "Allow public access" ausschalten. Dann gibt es gar
-- keine öffentlichen Kanäle mehr. Vorher nicht — ältere App-Versionen nutzen
-- noch den öffentlichen Kanal und hätten sonst keinen Sofort-Abgleich
-- (der normale Abgleich alle 30 s und beim Öffnen der App läuft trotzdem).

drop policy if exists "ff sync mithoeren" on realtime.messages;
create policy "ff sync mithoeren" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'ff-sync-' || (select auth.uid())::text
  );

drop policy if exists "ff sync senden" on realtime.messages;
create policy "ff sync senden" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'ff-sync-' || (select auth.uid())::text
  );
