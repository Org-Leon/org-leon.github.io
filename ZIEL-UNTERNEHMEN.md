# Ziel: FeldFolio unternehmensfähig für ca. 30 Nutzer

Festgelegt am 5. Oktober 2026 — **Status: geplant, noch nicht begonnen.**
Umsetzung erst nach ausdrücklicher Freigabe, Stufe für Stufe.

Last ist kein Problem (Supabase + statische App tragen 30 Nutzer locker). Der
Kern ist der Schritt von „jeder Nutzer hat seinen eigenen JSON-Blob“
(`feldfolio_state`) zu „ein Unternehmen arbeitet gemeinsam an denselben
Daten“ — plus Datenschutz, Betrieb und Lizenzen.

## Offene Grundsatzfragen (vor Stufe 2 klären)

- [ ] Sehen Kontrolleure alle Betriebe der Organisation oder nur zugewiesene?
- [ ] Wer ist Verantwortlicher im Sinne der DSGVO?
- [ ] Welche Aufbewahrungsfristen gelten für Kontrollprotokolle/Unterlagen?
- [ ] Nutzt das Unternehmen Microsoft 365 o.ä. (SSO-Login)?

## Stufe 1 — Recht & Sicherheit (Pflicht vor Rollout, ca. 1–2 Wochen)

- [ ] Supabase auf bezahlten Plan (Pro), Region EU/Frankfurt; Backups, optional PITR
- [ ] AVV/DPA mit Supabase, Verarbeitungsverzeichnis, kurze DSFA, Löschkonzept
- [x] Admin-Recht über Rollentabelle + RLS statt `@oekop.de`-Domainprüfung
      (`supabase/admins.sql`, Tabelle `admin_konten`, Funktion `ist_admin()`; 9. Oktober 2026)
- [ ] Alle RLS-Policies/Tabellen als SQL versioniert im Repo (`supabase/`)
- [ ] Konto löschen: Storage-Liste nicht auf 100 Dateien begrenzen
- [ ] Admin-Funktion „Nutzer sperren + Daten an Kollegen übergeben“
- [ ] Lizenzen: Esri-Luftbild → Länder-DOP (Open Data) oder Esri-Konto;
      Nominatim → Photon/BKG/eigener Dienst; Google Fonts + CDN-Bibliotheken
      (pdf.js, OpenCV) selbst hosten

## Stufe 2 — Gemeinsame Daten (größter Block, ca. 4–8 Wochen)

- [ ] Relationales Schema: `organisation`, `nutzer_rolle`, `betrieb`,
      `flaeche/layer`, `termin`, `protokoll`, `dokument`, `tierbestand`,
      `vergleichsjahr` — je Zeile `org_id`, `geaendert_am`, `geaendert_von`
- [ ] RLS: Organisation bzw. zugewiesene Betriebe
- [ ] Sync pro Datensatz statt Gesamt-Blob (IndexedDB offline bleibt);
      Umbau von serializeWorkspace/restoreWorkspace/syncWithCloud
- [ ] Konflikte pro Datensatz (zuletzt geändert gewinnt; Protokolle: Nachfrage)
- [ ] Unterschriften, Scans, Vergleichsjahr-Shapes als Dateien in den Storage
      (`org/betrieb/…` statt `user_id/…`)
- [ ] Protokolle nach Unterschrift schreibgeschützt, Änderungen als Version
- [ ] Termine zentral + Zuweisung/Vertretung durch Leitung
- [ ] Stammwerte zentral pro Organisation (WFP-Referenzen, N-Faktoren, Textbausteine)
- [ ] Migrationsskript: bestehende Nutzer-Blobs → neues Schema

## Stufe 3 — Betrieb & Qualität (ca. 1–2 Wochen)

- [ ] Getrennte Test- und Live-Umgebung (2 Supabase-Projekte, 2 Deploy-Ziele,
      z.B. Cloudflare Pages/Netlify statt `docs/`-Commit)
- [ ] CI: `npm test`, Build, Syntax-/CSS-Check bei jedem Push
- [ ] Schema-Migrationen per Supabase CLI; App erkennt veraltete Version
- [ ] Fehler-Monitoring (z.B. Sentry EU, ohne personenbezogene Daten) + Uptime-Check
- [ ] main.js (~17.800 Zeilen) in Module aufteilen

## Stufe 4 — Organisation (ca. 1–2 Wochen)

- [ ] Admin-Oberfläche: einladen, Rollen, sperren, Betriebe übertragen
- [ ] Optional SSO (Microsoft 365)
- [ ] Support-Kanal, Schulung, Release-Notizen (Handbuch existiert)

## Reihenfolge

1. Stufe 1 sofort
2. Pilot mit 3–5 Kontrolleuren (bisheriges Datenmodell, bezahlter Plan, Monitoring, CI)
3. Stufe 2 parallel bauen, Pilotdaten migrieren
4. Rollout an alle ca. 30 Nutzer

Laufende Kosten grob 50–200 € / Monat (Supabase Pro ~25 $, PITR optional
~100 $, Hosting 0–20 €, Monitoring 0–26 $).
