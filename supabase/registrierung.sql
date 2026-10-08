-- FeldFolio+ — Wer darf sich registrieren?
--
-- Diese Funktion BESTEHT bereits auf dem Server; die Datei hält sie im Repo fest
-- (abgelesen mit rls-pruefen.sql am 08.10.2026). Erneutes Ausführen der Funktion
-- ändert nichts.
--
-- Regel: Registrieren darf sich, wer eine @oekop.de-Adresse hat oder dessen
-- Adresse ein Admin freigeschaltet hat (Tabelle access_allowlist — NICHT der
-- Status einer Zugangsanfrage). Alle anderen bekommen "signup_not_allowed";
-- die App bietet dann "Zugang anfragen" an.
--
-- "security definer": die Prüfung muss die Freischaltliste lesen, obwohl der
-- (noch nicht angemeldete) Nutzer das per RLS nicht darf.

create or replace function public.check_signup_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) like '%@oekop.de' then
    return new;
  end if;
  if exists (select 1 from public.access_allowlist where email = lower(new.email)) then
    return new;
  end if;
  raise exception 'signup_not_allowed';
end;
$$;

-- Der Trigger trg_check_signup_allowed auf auth.users ruft diese Funktion beim
-- Anlegen eines Kontos. Er besteht bereits; seine genaue Definition zeigt
-- rls-pruefen.sql (Abschnitt 4). Für ein NEUES Projekt:
--
--   create trigger trg_check_signup_allowed
--     before insert on auth.users
--     for each row execute function public.check_signup_allowed();
