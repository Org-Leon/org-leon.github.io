-- FeldFolio+ — Zugangsanfragen begrenzen
--
-- Einmalig im Supabase-Dashboard ausführen: SQL Editor → New query →
-- diesen Inhalt einfügen → Run.
--
-- Wofür: "Zugang anfragen" funktioniert ohne Anmeldung (Tabelle access_requests).
-- Ohne Begrenzung könnte jemand die Tabelle mit Anfragen fluten. Dieser Trigger
-- prüft jede neue Anfrage auf dem Server:
--   - gültige E-Mail-Adresse, begrenzte Länge von Name und Nachricht
--   - je E-Mail-Adresse höchstens eine Anfrage in 24 Stunden
--   - insgesamt höchstens 20 Anfragen pro Stunde
--   - eine Anfrage beginnt immer als "pending" (kein selbst gesetzter Status)
-- Die Meldungen erscheinen so im Anmelde-Fenster der App.
--
-- "security definer": die Zählung muss alle Anfragen sehen, auch wenn der
-- (nicht angemeldete) Absender sie per RLS nicht lesen darf.

create or replace function public.access_requests_begrenzen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := lower(trim(new.email));
  if new.email is null or char_length(new.email) > 254 or new.email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Bitte eine gültige E-Mail-Adresse angeben.';
  end if;
  if char_length(coalesce(new.name, '')) > 120 or char_length(coalesce(new.message, '')) > 1000 then
    raise exception 'Name oder Nachricht ist zu lang.';
  end if;
  new.status := 'pending';
  if exists (select 1 from public.access_requests where email = new.email and created_at > now() - interval '24 hours') then
    raise exception 'Für diese E-Mail-Adresse liegt bereits eine Anfrage vor.';
  end if;
  if (select count(*) from public.access_requests where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Zu viele Anfragen — bitte später erneut versuchen.';
  end if;
  return new;
end;
$$;

drop trigger if exists access_requests_begrenzen on public.access_requests;
create trigger access_requests_begrenzen
  before insert on public.access_requests
  for each row execute function public.access_requests_begrenzen();
