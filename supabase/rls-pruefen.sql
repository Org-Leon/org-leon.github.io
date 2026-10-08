-- FeldFolio+ — Zugriffsregeln prüfen (liest nur, ändert nichts)
--
-- Im Supabase-Dashboard ausführen: SQL Editor → New query → einfügen → Run.
-- Das Ergebnis (eine Tabelle) zeigt den IST-Zustand aller Regeln, an denen die
-- Sicherheit der App hängt — denn der öffentliche "anon"-Schlüssel steckt in
-- der App, den Schutz leisten allein diese Regeln auf dem Server.
--
-- SOLL (bitte mit dem Ergebnis vergleichen):
--   Tabellen      feldfolio_state, access_requests, access_allowlist, nutzungscodes:
--                 RLS = an
--   feldfolio_state   nur eigene Zeile: user_id = auth.uid() (lesen, anlegen, ändern)
--   Speicher      Bucket "feldfolio-photos" NICHT öffentlich; Regeln auf storage.objects
--                 nur für den eigenen Ordner: (storage.foldername(name))[1] = auth.uid()::text
--   access_requests   anlegen: jeder (anon) — begrenzt durch zugangsanfragen-limit.sql;
--                 lesen/ändern: nur Admins (@oekop.de)
--   access_allowlist  lesen/ändern: nur Admins
--   nutzungscodes siehe nutzungscodes.sql
--   Realtime      Regeln "ff sync …" auf realtime.messages (sync-kanal.sql)
--   Anmeldung     Trigger auf auth.users (check_signup_allowed): Registrierung nur
--                 für @oekop.de oder freigeschaltete Adressen
--   Funktionen    delete_my_account: security definer, nur für "authenticated"
--   Dashboard     Authentication → "Confirm email" und "Secure email change" an
--                 (die Admin-Rechte hängen an der bestätigten @oekop.de-Adresse)
--
-- Weicht etwas ab oder fehlt eine Zeile: Ergebnis kopieren und prüfen lassen.

select '1 RLS an?' as bereich, c.relname::text as name,
       case when c.relrowsecurity then 'RLS an' else 'RLS AUS !!!' end as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
union all
select '2 Regel ' || schemaname || '.' || tablename, policyname::text,
       cmd || ' für ' || array_to_string(roles, ',') || ' | using: ' || coalesce(qual, '–') || ' | check: ' || coalesce(with_check, '–')
  from pg_policies where schemaname in ('public', 'storage', 'realtime')
union all
select '3 Speicher-Bucket', id::text, case when public then 'ÖFFENTLICH !!!' else 'privat' end
  from storage.buckets
union all
select '4 Trigger ' || t.tgrelid::regclass::text, t.tgname::text, 'ruft ' || p.proname
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where not t.tgisinternal and t.tgrelid in ('auth.users'::regclass, 'public.access_requests'::regclass)
union all
select '5 Funktion', p.proname::text,
       case when p.prosecdef then 'security definer' else 'security invoker' end || ' | ausführbar für: '
       || coalesce((select string_agg(r.rolname, ',') from pg_roles r where r.rolname in ('anon', 'authenticated') and has_function_privilege(r.oid, p.oid, 'execute')), 'niemand von anon/authenticated')
  from pg_proc p where p.pronamespace = 'public'::regnamespace
union all
select '6 Tabellenrechte ' || table_name, grantee::text, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
 group by table_name, grantee
order by 1, 2;
