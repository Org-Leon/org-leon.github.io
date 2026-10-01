-- FeldFolio+ — Konto löschen (Server-Funktion)
--
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query →
-- diesen Inhalt einfügen → Run.
--
-- Die App (deleteMyAccount() in src/supabase.js) löscht zuerst alle eigenen
-- Fotos/Dateien über die Storage-API und ruft danach diese Funktion auf. Sie
-- löscht den gespeicherten Arbeitsstand und den Nutzer selbst — immer nur den
-- gerade angemeldeten (auth.uid()), nie einen anderen.
--
-- "security definer": läuft mit den Rechten des Erstellers, weil normale
-- Nutzer keine Zeilen in auth.users löschen dürfen. search_path fest gesetzt,
-- damit sich die Funktion nicht über gleichnamige Objekte unterwandern lässt.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Nicht angemeldet';
  end if;

  delete from public.feldfolio_state where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- Nur angemeldete Nutzer dürfen die Funktion aufrufen.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
