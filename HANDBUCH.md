# FeldFolio – Benutzerhandbuch

Stand: 4. Oktober 2026

FeldFolio ist ein Werkzeug für die Öko-Kontrolle: Flächen eines Betriebs auf der Karte ansehen und auswerten, Hof und Stall erfassen und die Kontrolle selbst mit Terminen, Protokollen und Dokumenten begleiten. Die App läuft im Browser auf PC, Tablet und Handy und funktioniert vor Ort auch ohne Empfang.

## Inhalt

1. [Erste Schritte](#1-erste-schritte)
2. [Betrieb wählen](#2-betrieb-wählen)
3. [Karte](#3-karte)
4. [Flächenübersicht](#4-flächenübersicht)
5. [Jahresvergleich](#5-jahresvergleich)
6. [Flächenzeichner](#6-flächenzeichner)
7. [Obstbaumkataster](#7-obstbaumkataster)
8. [Bienenflugkarte](#8-bienenflugkarte)
9. [Hofplan](#9-hofplan)
10. [Stallplaner](#10-stallplaner)
11. [Tierbestand](#11-tierbestand)
12. [Kontrolle](#12-kontrolle)
13. [Warenflussprüfung](#13-warenflussprüfung)
14. [Konto, Speichern und Offline-Nutzung](#14-konto-speichern-und-offline-nutzung)
15. [Hinweise und Grenzen](#15-hinweise-und-grenzen)
16. [Wenn etwas nicht klappt](#16-wenn-etwas-nicht-klappt)

---

## 1. Erste Schritte

### Aufbau der App

- **Kopfzeile:** links das Menü (am Handy) und der Name der aktuellen Funktion, in der Mitte die Flächensuche, rechts Speicherstatus, Betrieb, Hell-/Dunkelmodus und Konto.
- **Funktionsauswahl:** die Kacheln oben in der Seitenleiste (Karte, Flächenübersicht, Jahresvergleich, Flächenzeichner, Obstbaumkataster, Bienenflugkarte, Hofplan, Stallplaner, Tierbestand). Mit Konto kommt darüber die Kachel **Kontrolle** dazu.
- **Seitenleiste:** zeigt die Einstellungen und Exporte der gewählten Funktion. Am Handy ist sie eine Schublade, die du über das Menü öffnest.
- **Hauptbereich:** die Karte oder die jeweilige Ansicht.

Ein Tipp auf die bereits aktive Kachel führt zurück zur Karte.

### Mit und ohne Konto

Ohne Konto kannst du Flächen laden, ansehen, zeichnen, auswerten und exportieren. Die Daten bleiben dann nur so lange erhalten, wie die Seite geöffnet ist.

Mit einem **FeldFolio+-Konto** kommt dazu:

- Dein Arbeitsstand wird gespeichert, auf dem Gerät und in der Cloud.
- Du arbeitest auf Handy, Tablet und PC mit demselben Stand weiter.
- Die Funktion **Kontrolle** mit Terminen, Protokollen und Dokumenten.
- Betriebe: jeder Betrieb hat seinen eigenen Arbeitsstand.

Anmelden und registrieren: Konto-Symbol oben rechts. Dort gibt es auch „Passwort vergessen?“ und „Zugang anfragen“.

### App auf dem Gerät installieren

FeldFolio lässt sich wie eine App auf dem Startbildschirm ablegen:

- **Android / Chrome / Edge:** In der Seitenleiste oder im Konto-Dialog auf „App installieren“ tippen.
- **iPhone / iPad (Safari):** Auf „Teilen“ tippen, dann „Zum Home-Bildschirm“ wählen.

Die installierte App startet im Vollbild und funktioniert auch ohne Empfang.

### Flächensuche

Das Suchfeld in der Kopfzeile (am PC auch mit **Strg + K**) durchsucht die geladenen Flächen nach Schlagnummer, Name und FLIK. Ein Treffer springt zur Fläche auf der Karte.

---

## 2. Betrieb wählen

Über den Betriebs-Knopf in der Kopfzeile ordnest du deine Arbeit einem Betrieb zu (nur mit Konto).

- **Anstehende Termine** stehen oben. Ein Tipp wählt den Betrieb zusammen mit diesem Termin.
- Darunter stehen **alle Betriebe** alphabetisch, jeweils mit Anzahl der Termine und dem nächsten oder letzten Termin.
- Mit dem Suchfeld findest du Betriebe und Termine; Enter wählt den ersten passenden Betrieb.
- Betriebe ohne Termin kannst du unten von Hand anlegen.

Was die Auswahl bewirkt:

- Karte, Flächen, Bäume, Bienenstöcke, Hofplan, Stallpläne und die hinterlegten Jahre gehören zum gewählten Betrieb. Beim Wechsel lädt die App den Stand des anderen Betriebs.
- Exporte und Fotos werden nach dem Schema `Jahr_Betrieb_Art` benannt.
- Auf der Karte markiert ein roter Pin mit Namen die Hofstelle des Betriebs (wenn eine Adresse bekannt ist).

Hast du ohne Betrieb gearbeitet, kannst du diese Inhalte im Dialog mit „Zuordnen“ nachträglich einem Betrieb geben.

---

## 3. Karte

### Flächen laden

„Karten-Datei laden“ in der Seitenleiste (oder Datei hineinziehen):

- **Shapefile als .zip** – so, wie es aus dem Antragsportal des Bundeslandes kommt.
- **GeoJSON** (.geojson / .json).

Jede Datei erscheint unter **Ebenen**. Je Ebene gibt es:

- einen Schalter zum Ein- und Ausblenden,
- „Zoomen“ auf die Ebene,
- die **Flächentabelle**,
- „Löschen“.

Teilflächen-Ebenen sind zunächst ausgeblendet, weil sie innerhalb anderer Flächen liegen.

### Karte bedienen

- **Basiskarte:** Standard, Topo oder Luftbild (am Handy schaltet der Ebenen-Knopf durch).
- **Auf Inhalt zoomen:** zeigt alle geladenen Flächen.
- **Mein Standort:** zeigt deine Position per GPS.
- **Flächennamen** erscheinen erst, wenn du hineinzoomst. Herausgezoomt siehst du nur die Umrisse und den Betriebspin.
- Ein Tipp auf eine Fläche zeigt ihre Daten und markiert sie in der Tabelle.

### Kulturen anzeigen

Sind für den Betrieb Jahre hinterlegt (siehe [Jahresvergleich](#5-jahresvergleich)), erscheint über der Karte der Knopf **„Kulturen“**:

- Die Karte zeigt die Flächen eines Jahres, gefärbt nach Kultur.
- Daneben steht je Jahr ein Knopf mit der Jahreszahl.
- Unten links steht eine einklappbare Legende mit Kulturen und Hektar.
- Ein Tipp auf eine Fläche zeigt die Kulturfolge über alle Jahre.

Ein zweiter Tipp auf „Kulturen“ zeigt wieder die normalen Ebenen.

### Flächentabelle

Die Tabelle unter der Karte listet die Flächen einer Ebene mit Schlagnummer, Name, Flächenidentifikator (z. B. FLIK), Größe, Kulturart und Anzahl Bäume. Dazu je Fläche:

- **Besichtigt** (nur angemeldet): Haken setzen. Über der Tabelle steht mit Fortschrittsbalken, wie viele Flächen und Hektar besichtigt sind; besichtigte Zeilen sind grün hinterlegt. Am Handy ist „Besichtigt“ die erste Spalte mit einem großen Haken und bleibt beim seitlichen Scrollen stehen.
- **Notiz** und Fotos zur Fläche (mit Konto).
- **Route:** öffnet die Navigation zur Fläche.

Export der Tabelle als CSV, Excel oder PDF. Mit „Teilflächen einschließen“ zählen auch Teilflächen mit.

### Exporte

- **Flächenkarten (PDF):** eine Seite je Fläche mit Luftbild und Daten.
- **Gesamtübersicht (PDF):** Bericht über den ganzen Betrieb mit Kennzahlen, Kulturen, Flächenliste und Karten.
- **Alles als GeoJSON:** alle Flächen in einer Datei.

---

## 4. Flächenübersicht

Die Flächenübersicht hat zwei Reiter: **Flächen** und **Fruchtfolge**.

### Reiter „Flächen“

- **Kennzahlen:** Gesamtfläche, Kulturarten, durchschnittliche Flächengröße, davon gezeichnet.
- **Kulturarten:** Ring und Balken mit Hektar und Anteil. Ein Tipp auf eine Kultur filtert die Tabelle. Die Zeilen lassen sich markieren und kopieren (z. B. nach Excel).
- **Herkunft der Flächen** und **die größten Flächen.**
- **Alle Flächen:** Tabelle mit Suche und Sortierung. Ein Tipp auf eine Zeile springt zur Fläche auf der Karte.

Gezählt werden alle Flächen aus geladenen Shape-Dateien und aus dem Flächenzeichner. Teilflächen-Ebenen zählen nicht mit.

Export in der Seitenleiste: Gesamtübersicht (PDF) und Flächenliste (Excel).

### Reiter „Fruchtfolge“

Die Fruchtfolge entsteht aus den hinterlegten Jahren des Betriebs (dieselben wie im Jahresvergleich). Jahre kannst du auch direkt hier hinzufügen.

- **Kennzahlen:** hinterlegte Jahre, Schläge, Leguminosenanteil im neuesten Jahr, Schläge mit Hinweis.
- **Leguminosen an der Ackerfläche:** eine Säule je Jahr. Grünland und Dauerkulturen zählen nicht zur Ackerfläche.
- **Hinweise zur Fruchtfolge:**
  - gleiche Kultur in direkt aufeinanderfolgenden Jahren,
  - drei oder mehr Jahre Getreide in Folge,
  - keine Leguminose in fünf oder mehr Jahren.
  
  Mehrjährige Kulturen (Kleegras, Luzerne, Grünland, Obst) lösen keinen Hinweis aus.
- **Kulturfolge je Schlag:** Tabelle mit einer Zeile je Schlag und einer Spalte je Jahr. Leguminosen sind grün umrandet. „Nur mit Hinweis“ blendet unauffällige Schläge aus. Export als CSV, Excel oder PDF.
- Ein Tipp auf einen Schlag öffnet die Karte, gefärbt nach Kultur, und zoomt auf den Schlag.

Die Hinweise sind Anhaltspunkte für die Kontrolle, keine Bewertung (siehe [Hinweise und Grenzen](#15-hinweise-und-grenzen)).

---

## 5. Jahresvergleich

Vergleicht die Flächen eines Betriebs zwischen zwei Jahren und zeigt Zugänge, Abgänge und Veränderungen.

### Jahre hinterlegen

- Unter „Hinterlegte Jahre“ die Shape-Dateien der Antragsjahre hinzufügen (.zip oder .geojson, auch mehrere auf einmal).
- Das Jahr wird aus den Daten oder dem Dateinamen erkannt. Fehlt es, ist die Zeile orange markiert und du trägst die Jahreszahl ein.
- Eine schon geladene Kartenebene übernimmst du mit „Als Jahr“.
- Lädst du ein Jahr erneut, fragt die App, ob es ersetzt werden soll. Der Papierkorb entfernt ein Jahr.

Die Jahre bleiben beim Betrieb gespeichert und gelten auch für die Fruchtfolge.

### Vergleichen

- Unter „Vergleichen“ zwei Jahre wählen. Voreingestellt sind die beiden neuesten. Verglichen wird immer vom älteren zum neueren Jahr.
- „Als verändert zählt“: Flächengröße und/oder Kulturart.
- Die Karte färbt die Flächen: Zugang, Abgang, verändert, unverändert. Bei veränderten Flächen siehst du, welches Stück dazugekommen oder weggefallen ist.
- Die Tabelle zeigt Größe und Kultur beider Jahre und die Differenz. Export als CSV, Excel oder PDF.

Eine Größenänderung zählt ab 0,01 ha als „verändert“. Kleinere Unterschiede werden angezeigt, die Fläche bleibt aber „unverändert“.

### Knöpfe über der Karte

Links der Vergleich (z. B. „2024 → 2025“), daneben ein Knopf je hinterlegtem Jahr. Ein Tipp auf eine Jahreszahl zeigt nur die Flächen dieses Jahres.

---

## 6. Flächenzeichner

Eigene Flächen auf der Karte zeichnen, zum Beispiel wenn es keine Shape-Datei gibt.

- **Zeichnen:** Eckpunkte auf die Karte setzen und mit „Fertig“ abschließen. „Letzter Punkt“ nimmt einen Punkt zurück.
- **Bearbeiten, Teilen, Löschen:** Werkzeug wählen, dann die Fläche auf der Karte antippen.
- **Rückgängig / Wiederherstellen.**
- In der Liste trägst du Name und Kulturart ein. Die Größe wird aus der Form berechnet.

Am PC schließt ein Doppelklick die Fläche, ein Rechtsklick nimmt den letzten Punkt zurück, Esc bricht ab.

Gezeichnete Flächen stehen auch unter „Ebenen“ und in allen anderen Funktionen bereit. Export: Flächenkarten (PDF) und GeoJSON.

---

## 7. Obstbaumkataster

Obstbäume auf der Karte erfassen.

- Obstart wählen, dann Bäume auf die Karte tippen. Die Obstart bleibt aktiv, bis du sie erneut antippst (oder Esc drückst).
- Bäume verschieben: ziehen. Löschen: Rechtsklick.
- Weitere Obstarten unter „Sonstige Obstart“.
- Tabellen „Bäume“ und „Flächen“: Bäume werden der Fläche zugeordnet, auf der sie stehen.
- Notiz und Fotos je Baum (mit Konto).

Export: Flächenkarten (PDF) und „Kataster speichern“ (GeoJSON). Ein gespeichertes Kataster lässt sich wieder laden.

---

## 8. Bienenflugkarte

Auf die Karte tippen, um einen Bienenstock zu setzen. Der Flugradius von 3 km wird automatisch als Kreis angezeigt. Bienenstöcke lassen sich verschieben und benennen. Export: Flächenkarten (PDF).

---

## 9. Hofplan

Gebäude auf dem Luftbild einzeichnen.

- „Rechteck“ oder „Freiform“ wählen und das Gebäude einzeichnen. Freiform mit „Fertig“ abschließen.
- In der Liste Gebäudetyp und Name eintragen.
- Bei einem Stall lässt sich aus der Liste direkt ein **Stallplan** anlegen und öffnen.

Export: Lageplan (PDF) und GeoJSON.

---

## 10. Stallplaner

Einen Stall vermessen, in Abteile teilen und gegen die Mindestflächen der Öko-Verordnung prüfen. Der Stallplaner ist für die Bedienung mit dem Finger vor Ort gebaut. Die Schrittleiste oben führt durch:

1. **Umriss:** den Stall als Rechteck anlegen, frei skizzieren oder Wand für Wand vermessen.
2. **Abteile:** den Stall in Buchten teilen. Was nach den eingetragenen Breiten übrig bleibt, wird die letzte Bucht.
3. **Ausstattung:** Einrichtung im Plan platzieren.
4. **Tiere:** je Bucht Tierart, Kategorie und Anzahl eintragen, auch mehrere Tierarten in einer Bucht.

Die App vergleicht die Fläche je Bucht mit dem Bedarf der eingetragenen Tiere. Grundlage sind die Flächenwerte nach Anhang I der VO (EU) 2018/848 in der Fassung der DVO (EU) 2020/464.

Mehrere Stallpläne je Betrieb sind möglich. Export: Stallplan (PDF, heller oder dunkler Hintergrund) und als Datei speichern; eine gespeicherte Datei lässt sich wieder laden.

---

## 11. Tierbestand

Wertet einen Auszug aus der HI-Tier-Datenbank (HIT) aus: Bestand, Zu- und Abgänge, Altersklassen, Stickstoffanfall und Tierbesatz. Bisher für Rinder.

### Auszug laden

- In HI-Tier das **Bestandsregister** für den Zeitraum seit der letzten Kontrolle als PDF speichern.
- In FeldFolio unter „Tierbestand“ die PDF-Datei laden (Seitenleiste oder Feld in der leeren Ansicht).
- Ein neuer Auszug ersetzt den alten, nach Rückfrage. Der Tierbestand wird beim Betrieb gespeichert.

**Datenschutz:** Übernommen werden nur die Tierzeilen und der Zeitraum. Name, Anschrift, Telefonnummer und Betriebsnummer aus dem Kopf des Auszugs werden nicht gelesen und nicht gespeichert. Gespeichert werden je Tier Ohrmarke, Geburtsdatum, Geschlecht, Rasse, Ohrmarke der Mutter, Zu- und Abgang mit Art und der Betriebsnummer von Vorbesitzer bzw. Übernehmer.

Unter den Kennzahlen prüft die App die **Kontrollsummen** des Auszugs (Anzahl Datensätze, Endbestand, GVE). Steht dort eine Abweichung, wurde der Auszug nicht vollständig gelesen.

### Was die Ansicht zeigt

- **Kennzahlen:** Bestand am Stichtag (Ende des Zeitraums), Zugänge, Abgänge, Durchschnittsbestand in Großvieheinheiten (GV).
- **Bestandsentwicklung:** Anfangsbestand + Zugänge − Abgänge = Bestand am Stichtag. Zugänge nach Art (Geburt im Betrieb, Zugang/Zukauf …) und Abgänge nach Art (Abgang/Verkauf, Schlachtung, Hausschlachtung, Verendung, Tod, Ausfuhr), jeweils mit den Betriebsnummern, von denen Tiere kamen bzw. an die sie gingen. Dazu die Verluste in Prozent des Durchschnittsbestands und die Zu- und Abgänge je Monat.
- **Bestand nach Alter und Geschlecht:** Kälber bis 6 Monate, Jungrinder 6–12 Monate, Rinder 1–2 Jahre, männliche Rinder ab 2 Jahre, Färsen und Kühe. Als Kuh zählt ein weibliches Tier ab 2 Jahren, das im Auszug als Mutter eines anderen Tieres steht.
- **Tiere:** Liste mit Ohrmarke, Alter, Rasse, Zugang und Abgang. Filter für Bestand, Zugänge, Abgänge oder alle; Suche; Export als Excel in der Seitenleiste.

Beim Öffnen der Ansicht und nach dem Laden eines Auszugs blenden die Karten nacheinander ein, die Zahlen zählen hoch und die Balken wachsen. Ist am Gerät „Bewegung reduzieren“ eingestellt, erscheint alles sofort.

### Düngung und Tierbesatz

- **Fläche:** wird aus der Flächenübersicht des Betriebs übernommen, wenn Flächen geladen sind. Du kannst sie überschreiben.
- **Stickstoff:** Die App rechnet den Stickstoffanfall aus dem Durchschnittsbestand des Zeitraums, hochgerechnet auf ein Jahr, und zeigt die Kilogramm je Hektar im Verhältnis zur Grenze von 170 kg N je Hektar und Jahr. Dazu steht die Mindestfläche, die der Bestand braucht.
- **Kühe:** Wähle, ob die Kühe Mutterkühe (68 kg N) oder Milchkühe (85 kg N) sind.
- **Tierbesatz:** Großvieheinheiten je Hektar im Durchschnitt des Zeitraums. Die GV folgen dem Schlüssel des Auszugs (bis 6 Monate 0,3 · 6 bis 24 Monate 0,6 · darüber 1,0).

Die Stickstoffwerte je Tier sind aus Anhang IV der VO (EG) 889/2008 abgeleitet (170 kg N geteilt durch die zulässige Tierzahl je Hektar). Sie sind eine Orientierung und ersetzen keine Düngebedarfsermittlung. Andere Tierarten des Betriebs sind nicht enthalten.

### Warenflussprüfung „Bestandsentwicklung Rinder“

Mit „Warenflussprüfung erstellen“ in der Karte „Bestandsentwicklung im Zeitraum“ schreibt die App aus dem Tierbestand einen Prüftext für den Kontrollbericht:

- Bestand zur letzten Jahreskontrolle (Beginn des Auszugs),
- Zugänge, aufgeteilt in Geburten im Betrieb und Zukäufe,
- Abgänge, aufgeteilt in Verkauf/Abgabe, Schlachtung, Hausschlachtung, Verendung usw., dazu die Verluste in Prozent,
- Bestand zum Kontrollzeitpunkt mit den Altersklassen,
- das Ergebnis der Rechnung und Stellen zum Ausfüllen (vor Ort gezählter Bestand, Öko-Status zugekaufter Tiere).

Die Prüfung wird am aktuellen Termin des Betriebs gespeichert und steht dort bei den Warenflussprüfungen. Dafür musst du angemeldet sein und einen Betrieb mit Termin gewählt haben. Der Text ist frei bearbeitbar; solange du ihn nicht änderst, folgt er einem neu geladenen Auszug. Du kannst die Prüfung auch in der Kontrollmappe über „Neue Warenflussprüfung“ anlegen.

### Zuordnung zu Stallabteilen

Gibt es für den Betrieb Stallpläne mit Abteilen, lassen sich die Tiere hier zuordnen:

- Je Abteil Kategorie und Anzahl wählen und „Zuordnen“ antippen. Das Kreuz an einem Eintrag nimmt ihn wieder heraus.
- Oben steht, wie viele Rinder des Bestands schon einem Abteil zugeordnet sind und wie viele noch fehlen.
- Jedes Abteil zeigt, ob seine Fläche für die zugeordneten Tiere reicht.

Die Zuordnung ist dieselbe wie im Stallplaner beim Abteil unter „Tiere“. Die Kategorien richten sich dort nach dem Gewicht; der Auszug kennt nur das Alter, die passende Kategorie wählst du selbst.

---

## 12. Kontrolle

Die Kontrolle gibt es mit Konto. Sie hat drei Reiter: **Betrieb**, **Übersicht** und **Kalender**.

### Reiter „Betrieb“

Die zentrale Seite für den gewählten Betrieb. Ist ein Betrieb gewählt, startet die Kontrolle hier.

- **Kopfkarte:** Name, Kundennummer, Ort, Verbände; Knöpfe für Route, Anrufen und E-Mail; Kontaktdaten; „Wechseln“.
- **Betriebsfunktionen:** Kacheln direkt unter der Kopfkarte für Flächenübersicht, Fruchtfolge, Flächenzeichner, Hofplan, Stallplaner, Tierbestand, Obstbäume und Bienenflug.
- **Unterlagen der Kontrolle:** je eine Kachel für Probenahmeprotokolle, Cross Checks, Warenflussprüfungen, Fotos & Dokumente und Notizen. Jede Kachel zeigt die letzten Einträge und legt neue direkt am aktuellen Termin an. Ist eine Probenahme oder ein Cross Check beauftragt, ist die Kachel markiert („beauftragt · offen“ oder „beauftragt · erledigt“).
- **Flächen:** Kurzform der Flächenübersicht mit Gesamtfläche und den größten Kulturen.
- **Termine dieses Betriebs:** oben der aktuelle Termin (der zugeordnete, sonst der nächste) mit seinen Aufträgen als Schilder und dem Knopf „Kontrollmappe öffnen“. Ein roter Punkt am Auftrag heißt „unbestätigt“. Darunter stehen die weiteren Termine mit Zählern für Protokolle, Prüfungen und Dateien; ein Tipp öffnet die Kontrollmappe.

Ohne gewählten Betrieb bietet die Seite die nächsten Termine zur Auswahl an.

### Reiter „Übersicht“

Kennzahlen (Termine heute, Termine und Aufträge diese Woche) und die Liste „Heute & nächste Tage“.

### Reiter „Kalender“

- **Termine importieren** (Seitenleiste): Termine als Excel-Datei (.xlsx) aus dem Portal laden. Uhrzeiten kommen optional aus einer Kalenderdatei (.ics).
- **Woche oder Liste;** am Handy immer als Liste.
- **Karte:** blendet eine Karte mit den Terminen der Woche ein.
- **Termin verschieben:** am PC per Ziehen, sonst über das Datumsfeld in der Kontrollmappe.
- Aufträge desselben Betriebs zur selben Zeit werden zu **einem Termin** zusammengefasst. Verbände (Demeter, Bioland, Naturland …) erscheinen als farbige Schilder, Probenahme und CC-Anfrage als Schilder mit Symbol.

### Kontrollmappe

Ein Tipp auf einen Termin öffnet die Kontrollmappe (am Handy im Vollbild). Im Kopf: Betrieb, Datum, Status, Route, Anrufen, „Als Betrieb zuordnen“.

**Überblick:** die Aufträge des Termins, Termin verschieben, Kontakt, Hinweise.

**Protokolle:**

- **Probenahmeprotokoll** und **Cross Check:** Formulare, die Betriebsdaten vorbelegen. Pflichtangaben sind markiert; der Export als PDF landet bei den Dokumenten des Termins.
  - Probenummern lassen sich per **Barcode-Scanner** eintragen.
  - **Unterschriften:** direkt im Feld oder mit „Vergrößern“ in einem großen Unterschriftenfeld (am Handy am besten quer halten). Deine eigene Unterschrift aus dem Profil setzt du per Knopf ein.
- **Warenflussprüfungen:** siehe [Kapitel 13](#13-warenflussprüfung).

**Dokumente:**

- **Foto aufnehmen:** Das Foto wird sofort gesichert. Danach fragt die App nach einem Namen, mit Vorschlägen wie Lieferschein, Etikett oder Zertifikat. „Ohne Namen“ behält den Standardnamen.
- **Datei hinzufügen.**
- **Dokument scannen:** mehrere Seiten aufnehmen (Kamera, Kamera-App oder Galerie), Ecken prüfen, Filter wählen, drehen. „Fertig“ erstellt eine PDF-Datei; danach benennst du das Dokument.
- **Fotomappe:** mehrere Fotos zu einer PDF-Datei mit Bezeichnung zusammenfassen.
- **Umbenennen:** der Stift oben links an jedem Anhang.
- **Ansehen:** Ein Tipp auf einen Anhang öffnet den Dokumenten- und Fotoviewer.

Bei schlechtem Empfang warten Uploads in einer Warteschlange und werden automatisch nachgeholt. Der Status steht an jeder Datei und im Speicherstatus der Kopfzeile. Ein fehlgeschlagener Upload lässt sich per Antippen neu starten.

**Notizen:** freier Text zum Termin.

---

## 13. Warenflussprüfung

Eine Warenflussprüfung legst du in der Kontrollmappe unter „Protokolle“ oder auf der Betriebsseite an. Zur Wahl stehen:

| Bereich | Was geprüft wird |
|---|---|
| Pflanzenbau | zuerst Saat- und Pflanzgut, dann Ernte und Ertrag je Hektar |
| Tierhaltung | tierische Leistung, Futterbedarf |
| Imkerei | Honigernte je Volk |
| Verarbeitung | Ausbeute von Rohware zu Produkt (Mühle, Bäckerei, Brauerei, Kaffeerösterei, Molkerei, Obst/Wein, Ölmühle, Tofu, Metzgerei) |
| Handel | Mengenbilanz aus Bestand, Zukauf und Verkauf |
| Warenflusskette | mehrere Stufen, die aufeinander aufbauen |
| Bestandsentwicklung Rinder | Freitext aus dem Tierbestand (HIT-Auszug): Bestand zur letzten Jahreskontrolle, Zugänge, Abgänge, Bestand zur Kontrolle (siehe [Tierbestand](#11-tierbestand)) |

### So rechnet die Prüfung

- Du wählst Kultur, Tierart oder Prozess. Die App trägt einen **Referenzwert** mit Quelle ein. Der Wert ist überschreibbar, zum Beispiel für den Standort.
- Aus deinen Angaben rechnet die App den Ist-Wert und bewertet ihn: **plausibel**, **prüfen** oder **auffällig**.
- Die **Toleranz** stellst du oben ein. Standard: 25 % für Erträge und Leistungen, 5 % für Verarbeitungsausbeuten, 2 % für die Mengenbilanz.
- **Zeitraum:** frei eintragen oder über den Kalender-Knopf wählen (Kalenderjahr, Wirtschaftsjahr oder von/bis).

### Flächen aus der Flächenübersicht

Im Pflanzenbau (Ertrag und Saatgut) und in der Warenflusskette (Stufe „Erzeugung · Pflanzenbau“) übernimmt die Prüfung die Hektar aus der Flächenübersicht des Betriebs:

- **Kultur wählen:** Die Fläche wird mit der Summe aller passenden Flächen des Betriebs gefüllt. Unter dem Feld steht „Flächenübersicht“; der Hinweis dazu nennt die Kulturen und die Anzahl der Flächen.
- **„Kulturen aus Flächenübersicht übernehmen“:** legt für jede Kultur des Betriebs, zu der es einen Referenzwert gibt, eine Zeile mit Fläche an. Kulturen ohne Referenzwert (z. B. Wiesen) werden genannt, aber nicht übernommen.
- Die Fläche bleibt überschreibbar. Ein von Hand eingetragener Wert wird nicht mehr ersetzt.
- Im Prüftext steht bei übernommenen Flächen „lt. Flächenübersicht“.

Voraussetzung: Der Betrieb des Termins ist als Betrieb gewählt und seine Flächen sind geladen. Sonst steht in der Prüfung ein Hinweis, und du trägst die Fläche von Hand ein. Die Kulturen werden am Namen zugeordnet (z. B. „Winterweichweizen“ zu Winterweizen); prüfe die übernommene Fläche bei ungewöhnlichen Bezeichnungen.

### Mengenbilanz

Anfangsbestand + Erzeugung + Zukauf − Verkauf − Eigenverbrauch/Verluste = Soll-Endbestand, verglichen mit der Inventur. Die Mengenbilanz ist zunächst ausgeblendet und lässt sich hinzufügen und wieder ausblenden. Im Handel ist sie immer sichtbar.

### Warenflusskette

Für Betriebe, bei denen Erzeugung und Verarbeitung zusammenhängen, oder für mehrstufige Verarbeitung.

- Jede Stufe hat eine Art (Erzeugung Tierhaltung, Erzeugung Pflanzenbau, Verarbeitung, Zukauf/Ware), ein Produkt und eine Einheit.
- Eine Verarbeitungsstufe nimmt ihre Rohware aus einer früheren Stufe. Die eingesetzte Menge zählt dort als Abgang „an Folgestufe(n)“.
- Mehrere Verarbeitungen aus derselben Stufe sind möglich (z. B. Milch → Käse und Milch → Butter).
- Das Flussbild oben zeigt die Kette mit Mengen und Bewertung.

Beispiele: Milchkühe → Milch → Schnittkäse → Verkauf. Karkassen (Zukauf) → Hühnerbrühe → Verkauf; für Prozesse ohne hinterlegten Wert wählst du „Sonstiger Prozess“ und trägst die Ausbeute aus der Rezeptur ein.

Passen die Einheiten zweier Stufen nicht zusammen, erscheint ein Hinweis. Umgerechnet wird nicht automatisch.

### Prüftext

Unter der Tabelle schreibt die App aus der Berechnung laufend einen **Prüftext**: Zusammenfassung, Befunde mit möglichen Ursachen, Klärungspunkte für den Betrieb und das Ergebnis.

- „Kopieren“ übernimmt den Text.
- „Im Freitext bearbeiten“ wechselt in den Textmodus. Solange du den Text nicht änderst, folgt er der Tabelle. Nach deiner Bearbeitung bleibt er stehen; ändert sich die Tabelle danach, weist ein Hinweis darauf hin und bietet „Text aktualisieren“ an.
- Stellen in eckigen Klammern sind zum Ausfüllen gedacht.

Löschen: in der Prüfung unten links oder in der Liste über den Papierkorb, jeweils mit Rückfrage.

---

## 14. Konto, Speichern und Offline-Nutzung

### Speichern

Mit Konto speichert die App von selbst. Der **Speicherstatus** in der Kopfzeile zeigt den Stand, zum Beispiel „Gespeichert“, „Nicht synchron“ oder „Lädt hoch“. Änderungen werden zuerst auf dem Gerät gesichert und bei Verbindung mit der Cloud abgeglichen.

### Ohne Empfang arbeiten

Die App funktioniert ohne Verbindung weiter, wenn du auf dem Gerät schon angemeldet warst. Änderungen, Fotos und Scans bleiben auf dem Gerät und werden übertragen, sobald wieder Empfang da ist. Kartenhintergründe brauchen Empfang.

Wurde derselbe Betrieb inzwischen auf einem anderen Gerät geändert, fragt die App beim Abgleich nach, welcher Stand gelten soll.

### Konto-Dialog

- **Profil:** Name, Telefon, Kontrollstelle, Kürzel/Prüfernummer und deine Unterschrift. Name und Unterschrift werden in Protokollen vorbelegt.
- **Sicherheit:** Passwort ändern.
- **Sync & Gerät:** automatischer Abgleich, Sicherungen des Arbeitsstands.
- **Abmelden:** wahlweise mit Löschen der Daten auf diesem Gerät (empfohlen auf fremden Geräten) und auf allen Geräten abmelden.
- **Konto löschen.**

---

## 15. Hinweise und Grenzen

- **Hektar-Angaben:** Einzelne Flächen mit Größe aus der Shape-Datei werden mit bis zu vier Nachkommastellen gezeigt (auf den Quadratmeter genau). Summen und Kennzahlen haben zwei Stellen. Größen, die aus der Form berechnet sind (gezeichnete Flächen, Shape-Dateien ohne Größenangabe), haben zwei Stellen und sind mit * gekennzeichnet.
- **Shape-Dateien der Bundesländer** sind unterschiedlich aufgebaut. Manche enthalten keine Kulturart (z. B. Thüringen); dann steht dort „Ohne Angabe“.
- **Jahresvergleich und Fruchtfolge** verbinden Schläge über die Schlagnummer. Ändert sich die Nummer zwischen den Jahren, gilt der Schlag als neu.
- **Fruchtfolge-Hinweise** erkennen Kulturen am Namen. Ungewöhnliche Bezeichnungen und Gemenge können falsch eingeordnet werden.
- **Referenzwerte der Warenflussprüfung** sind Orientierungswerte aus veröffentlichten Quellen (z. B. LfL Bayern, oekolandbau.de); die Quelle steht am Wert. Einzelne Verarbeitungswerte stammen aus allgemeinen Nachschlagewerken. Gibt deine Kontrollstelle eigene Werte vor, trage diese ein.
- **Stallplaner:** Die Flächenwerte ersetzen nicht den Verordnungstext. Im Zweifel den Originaltext prüfen.
- **Tierbestand:** bisher nur für das HIT-Bestandsregister „Standard“ für Rinder als PDF. Die Stickstoffwerte je Tier sind Orientierungswerte; Kühe werden daran erkannt, dass sie im Auszug als Mutter stehen.
- FeldFolio unterstützt die Kontrolle, trifft aber keine Bewertung und ist keine Rechtsberatung.

---

## 16. Wenn etwas nicht klappt

| Problem | Was hilft |
|---|---|
| Datei lässt sich nicht laden | Shapefile als unveränderte .zip laden. Die Meldung nennt die Ebene, die nicht lesbar war; die übrigen Ebenen werden trotzdem geladen. |
| Flächen ohne Kulturart oder Größe | Die Shape-Datei enthält diese Angabe nicht. Die Größe wird dann aus der Form berechnet (*). |
| Jahr wird nicht erkannt | Jahreszahl in der Zeile des hinterlegten Jahres eintragen. |
| „Nicht synchron“ in der Kopfzeile | Es gibt Änderungen, die noch nicht in der Cloud sind. Bei Empfang gleicht die App von selbst ab. |
| Foto oder Scan erscheint nicht | Der Upload wartet auf Empfang. Der Status steht an der Datei im Reiter „Dokumente“; antippen startet ihn neu. |
| Tierbestand: „kein HIT-Bestandsregister erkannt“ | Das Bestandsregister in HI-Tier als PDF speichern (nicht als Bild oder Scan) und unverändert laden. |
| Kontrolle fehlt in der Funktionsauswahl | Die Kontrolle gibt es nur angemeldet. |
| App zeigt einen alten Stand | Seite neu laden. Die installierte App einmal schließen und wieder öffnen. |
| Kein Kartenbild | Kartenhintergründe brauchen Empfang. Flächen und Daten bleiben nutzbar. |
