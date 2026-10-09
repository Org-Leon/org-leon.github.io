# FeldFolio – Benutzerhandbuch

Stand: 9. Oktober 2026

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
12. [Dashboard und Betrieb](#12-dashboard-und-betrieb)
13. [Warenflussprüfung](#13-warenflussprüfung)
14. [Konto, Speichern und Offline-Nutzung](#14-konto-speichern-und-offline-nutzung)
15. [Hinweise und Grenzen](#15-hinweise-und-grenzen)
16. [Wenn etwas nicht klappt](#16-wenn-etwas-nicht-klappt)

---

## 1. Erste Schritte

### Aufbau der App

- **Kopfzeile:** links das Menü (am Handy) und der Name der aktuellen Funktion, in der Mitte die Flächensuche, rechts Speicherstatus, Betrieb, Hell-/Dunkelmodus und Konto.
- **Funktionsauswahl:** die Kacheln oben in der Seitenleiste (Karte, Flächenübersicht, Jahresvergleich, Flächenzeichner, Obstbaumkataster, Bienenflugkarte, Hofplan, Stallplaner, Tierbestand). Mit Konto kommen darüber die breiten Kacheln **Dashboard** und **Betrieb** dazu. Angemeldet startet die App im Dashboard.
- **Seitenleiste:** zeigt die Einstellungen und Exporte der gewählten Funktion. Am Handy ist sie eine Schublade, die du über das Menü öffnest.
- **Hauptbereich:** die Karte oder die jeweilige Ansicht.

Ein Tipp auf die bereits aktive Kachel führt zurück zur Karte.

### Design (Test)

Über das Paletten-Symbol in der Kopfzeile (am Handy: in der Schublade unten „Design wechseln (Test)“) schaltest du zwischen dem Standard-Design und dem Test-Design „Feldbuch“ um. Das Feldbuch-Design zeigt dieselben Funktionen in anderer Gestaltung: Papier und Tinte, harte Kanten, Linien wie in einem Kontrollbogen. Hell und Dunkel gibt es in beiden Designs. Die Wahl bleibt auf dem Gerät gespeichert. Beschriftungen und Abläufe sind gleich; die Bilder und Beschreibungen in diesem Handbuch gelten für beide.

### Mit und ohne Konto

Ohne Konto kannst du Flächen laden, ansehen, zeichnen, auswerten und exportieren. Die Daten bleiben dann nur so lange erhalten, wie die Seite geöffnet ist.

Mit einem **FeldFolio+-Konto** kommt dazu:

- Dein Arbeitsstand wird gespeichert, auf dem Gerät und in der Cloud.
- Du arbeitest auf Handy, Tablet und PC mit demselben Stand weiter.
- Das **Dashboard** mit Übersicht, Kalender und Dokumenten sowie die Seite **Betrieb** mit Protokollen und Unterlagen.
- Betriebe: jeder Betrieb hat seinen eigenen Arbeitsstand.
- Im Jahresvergleich der Abgleich mit der Schlagliste samt Umstellungsstatus (siehe [Umstellung (Schlagliste)](#umstellung-schlagliste)).

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

Teilflächen-Ebenen und die bayerische Ebene „Gewässerrandstreifen“ sind zunächst ausgeblendet, weil sie innerhalb anderer Flächen liegen. Sie zählen in Flächenübersicht und Exporten nicht mit.

**Bayern:** Der Export aus iBALIS enthält Feldstücke und deren Nutzungen (Schläge). Die App zeigt **je Schlag eine Fläche** mit eigener Größe und Kultur; Name und FLIK kommen vom Feldstück. Hat ein Feldstück mehrere Schläge, steht die Nummer als „Feldstück/Schlag“ da (z. B. „15/2“), sonst nur die Feldstücknummer.

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

Gezählt werden alle Flächen aus geladenen Shape-Dateien und aus dem Flächenzeichner. Teilflächen-Ebenen und Gewässerrandstreifen-Ebenen zählen nicht mit.

**Fehlende Kulturen:** Haben Flächen nur einen Nutzungscode statt einer Kultur (z. B. in Thüringen bei Codes, die die App noch nicht kennt) oder gar keine Kultur, erscheint oben der Kasten „Fehlende Kulturen“. Er listet jeden unbekannten Code mit Bundesland, Anzahl der Flächen und Hektar.

- **Nutzungsnachweis (PDF) laden:** Die App vergleicht den Flächen- und Nutzungsnachweis mit den Flächen, lernt daraus die Bedeutung der Codes und ergänzt Flächen ohne Kultur über die FLIK.
- **Selbst eintragen:** Kultur ins Feld neben dem Code schreiben (Vorschläge erscheinen beim Tippen) und **„Übernehmen“** tippen.
- Die Kultur gilt sofort für alle Flächen mit diesem Code, auch im Jahresvergleich.
- **Für alle Nutzer:** Mit Konto geht jede gefundene oder eingetragene Zuordnung als Vorschlag an die Verwaltung. Ist sie freigegeben, übersetzt die App diesen Code bei allen Nutzern automatisch. Wie viele deiner Vorschläge noch warten, steht im Kasten. Ohne Konto gilt die Zuordnung nur auf deinem Gerät; der Vorschlag wird nachgereicht, sobald du dich anmeldest.
- Eine eigene Zuordnung hat auf deinem Gerät Vorrang vor einer freigegebenen.

Export in der Seitenleiste: Gesamtübersicht (PDF) und Flächenliste (Excel).

### Reiter „Fruchtfolge“

Die Fruchtfolge entsteht aus den hinterlegten Jahren des Betriebs (dieselben wie im Jahresvergleich). Jahre kannst du auch direkt hier hinzufügen.

- **Kennzahlen:** hinterlegte Jahre, Schläge, Leguminosenanteil im neuesten Jahr, Schläge mit Hinweis.
- **Leguminosen auf der Ackerfläche:** eine Säule je Jahr. Grünland und Dauerkulturen zählen nicht zur Ackerfläche.
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
- Lädst du für ein Jahr eine zweite Datei, fragt die App, ob beide **zusammengeführt** werden sollen, z. B. wenn ein Betrieb Flächen in zwei Bundesländern hat (Thüringen und Sachsen-Anhalt). Sagst du nein, kannst du das Jahr stattdessen ersetzen. Der Papierkorb entfernt ein Jahr.
- Das Jahr liest die App aus den Daten (z. B. Feld „ANTJAHR“ in Thüringen) oder aus der Antrags-XML im Zip (Sachsen-Anhalt: „Antragsjahr“).

Die Jahre bleiben beim Betrieb gespeichert und gelten auch für die Fruchtfolge.

### Vergleichen

- Unter „Vergleichen“ zwei Jahre wählen. Voreingestellt sind die beiden neuesten. Verglichen wird immer vom älteren zum neueren Jahr.
- „Als verändert zählt“: Flächengröße und/oder Kulturart.
- Die Karte färbt die Flächen: Zugang, Abgang, umnummeriert, verändert, unverändert. Bei veränderten Flächen siehst du, welches Stück dazugekommen (türkis) oder weggefallen ist (rot, gestrichelt).
- **Kennzeichen am Flächennamen** fassen die Änderung zusammen: „neu“, „weg“, „+0,20 ha“ / „−0,37 ha“ oder „Kultur“. Hat sich bei einer Fläche nur die Kultur geändert, ist sie nur blass mit gelber, gestrichelter Linie gezeichnet. So fallen echte Flächenänderungen sofort auf.
- **Umnummeriert:** Hat eine Fläche im neueren Jahr nur eine andere Nummer, liegt aber (fast) genau an derselben Stelle, zeigt die App sie als einen Eintrag „Umnummeriert“ mit alter und neuer Nummer (z. B. „14 → 19“). Es wird also kein Abgang und kein Zugang eingetragen.
- Die Tabelle zeigt Größe und Kultur beider Jahre und die Differenz. Export als CSV, Excel oder PDF.

Eine Größenänderung zählt ab 0,01 ha als „verändert“. Kleinere Unterschiede werden angezeigt, die Fläche bleibt aber „unverändert“.

### Knöpfe über der Karte

Links der Vergleich (z. B. „2024 → 2025“), daneben ein Knopf je Jahr. Ein Tipp auf eine Jahreszahl zeigt nur die Flächen dieses Jahres.

### Umstellung (Schlagliste)

Nur mit Konto. Du gleichst die Schlagliste aus dem externen Programm (Excel „Felder & Kulturen“) mit den Shape-Dateien eines Jahres ab. Daraus berechnet die App für jede Fläche den Umstellungsstatus. Danach exportierst du die Liste wieder, um sie im externen Programm zu importieren.

**Umstellungsstatus:** Er zählt ab dem Datum in „Zugang Fläche“ (Umstellungsbeginn) bis zum Stichtag:

- unter 12 Monaten: **konv.** (1. Jahr, konventionell)
- 12 bis 24 Monate: **Umstellung** (2. Jahr)
- ab 24 Monaten: **Bio** (ab dem 3. Jahr, ökologisch)

So gehst du vor:

1. Erst die Shape-Dateien hinterlegen, am besten auch das Vorjahr. Dann im grün umrandeten Kasten **„Abgleich Schlagliste“** direkt unter den hinterlegten Jahren die Excel-Datei laden. Später öffnest du den Abgleich dort mit **„Abgleich prüfen“**. Rechts neben der Karte öffnet sich „Schlagliste abgleichen“ (am Handy unten).
2. Oben wählst du, mit welchem Jahr abgeglichen wird (voreingestellt das neueste), und den Stichtag (voreingestellt heute).
3. Die App ordnet Listenzeilen und Flächen über FLIK, Schlagnummer, Nummer in der Bezeichnung, Name und Größe zu. Eindeutige Fälle stehen unter **„Automatisch zugeordnet“**. Umnummerierte Flächen erkennt sie über das Vorjahr. Weicht die Größe ab, bleibt es immer ein Zweifelsfall.
4. Was noch zu tun ist, steht in Abschnitten. Jeder offene Punkt ist ein **Fall**. Oben siehst du, wie viele schon geklärt sind (siehe „Fortschritt“ unten).

**Woran die App Flächen erkennt (wichtig bei Thüringen, wo die Shapes keine Flächennamen haben):**

- **FLIK in der Bezeichnung**, auch gekürzt („77 AL49352V01“ statt „DETHLIAL49352V01“), mit Zusätzen („/1“, „(82.1)“) oder ohne Nutzungsart („49352D12“). Kleine Tippfehler wie „1“ statt „I“ oder ein falsches Zeichen erkennt sie als „FLIK ähnlich“.
- **Bayern:** Vorn in der Bezeichnung steht die Feldstücknummer, die Liste führt die Schläge. Die App ordnet über Feldstücknummer, Größe des Schlags und Kultur zu, so werden auch mehrere Schläge eines Feldstücks (z. B. Acker und Gewässerrandstreifen) richtig getrennt.
- **Teilschläge** aus der Bezeichnung („8 8.1 …“, „… (82.1)“). Die genaueste Nummer zählt am meisten.
- **Schlagnummer:** Passt die Schlagnummer der Liste nicht zur Nummer vorn in der Bezeichnung, ist sie eine interne Zählung des externen Programms. Dann nutzt die App sie nicht und lässt sie beim Export unverändert.
- **Bundesland:** Das Land aus der FLIK muss zur Spalte „Bundesland“ passen. So wird z. B. Schlag 1 in Thüringen nicht mit Parzelle 1 in Sachsen-Anhalt verwechselt.
- **Name oder Nummer und Größe** zusammen genau gleich reicht für eine sichere Zuordnung.
- **Zusammengelegt:** Ergeben mehrere Listenzeilen mit gleicher FLIK zusammen genau die Größe einer Fläche, zeigt die App „Zusammengelegt?“. Mit **„Als zusammengelegt übernehmen“** bekommt die größte Zeile die Fläche, die übrigen einen Abgang.
- **Landschaftselemente** (Hecken, Baumreihen, Feldgehölze, Feldraine, Tümpel u. ä.) gehören zum Schlag und werden in der Schlagliste nicht geführt. Die App erkennt sie an der Kultur oder an der Art in der FLIK (in Thüringen z. B. „HK“ für Hecken, „BR“ für Baumreihen, „FG“ für Feldgehölze). Sie stehen nur zur Info im Abschnitt „Landschaftselemente und ausgeblendet“ und kommen nicht in den Export. Erkennt die App ein solches Element nicht, steht es unter „Neu in den Shapes“. Dort blendest du es mit **„Ausblenden“** aus.

**Abgleich auf der Karte:** Die Karte zeigt die Flächen des Abgleichsjahres in Farben:

- grau-blau: zugeordnet
- orange: prüfen
- blau: neu
- rot: Teilstück dazugekommen
- gestrichelt: weggefallen oder nicht mehr da

**Mehrere Jahre:** Sind mehrere Jahre hinterlegt, vergleicht die App beim Öffnen des Abgleichs das Abgleichsjahr automatisch mit seinem Vorjahr (auch nach einem Wechsel des Jahres im Panel). Über der Karte zeigt der Knopf „Vergleich“ (z. B. „2025 → 2026“) die Abgleich-Ansicht. Ein Tipp auf eine Jahreszahl zeigt **nur** die Flächen dieses Jahres, ohne die Farben des Abgleichs — so siehst du, wie der Stand in diesem Jahr war. Tippst du danach einen Fall im Panel an, kehrt die Karte zur Abgleich-Ansicht zurück.

Tippst du einen Fall im Panel an (oder das Zielkreuz daneben), fliegt die Karte hin und hebt die Fläche hervor. Tippst du eine Fläche auf der Karte an, springt das Panel zum passenden Fall. So siehst du bei jedem Fall, was sich an der Fläche tatsächlich geändert hat. Kleine Kennzeichen am Fall fassen das zusammen, z. B. „+1,56 ha neu“, „−0,37 ha weg“ oder „Nr. 14 → 19“.

Die Abschnitte im Einzelnen:

- **Kritische Änderungen:** An die Fläche ist seit dem Vorjahr ein Teilstück dazugekommen, das damals zu keiner Fläche des Betriebs gehörte. Auf der Karte ist es rot. Ein solches Teilstück hat oft einen eigenen Umstellungsbeginn. Dann trägst du dessen Datum ein und tippst auf **„Unterfläche anlegen“**. Hat das Teilstück denselben Status wie die Fläche, tippst du auf **„Gehört dazu (gleicher Status)“**. Schmale Splitter aus leicht verschobenen Grenzlinien (unter 5 m breit) zählt die App nicht als Teilstück.
- **Zweifelsfälle prüfen:** Die App zeigt ihren Vorschlag und den Grund, z. B. „Fläche weicht ab · Shape +0,90 ha gegenüber Liste“. Passt er, tippst du auf **„Passt“**. Sonst wählst du eine andere Fläche oder „keine Fläche (nicht im Betrieb)“. Bis du bestätigst, bleibt die Zeile beim Export unverändert. Bestätigte Fälle bleiben abgehakt im Abschnitt stehen („zugeordnet: …“). Mit **„ändern“** holst du einen Fall zurück in die Prüfung.
- **Neu in den Shapes:** Diese Flächen stehen nicht in der Liste. Du trägst den **Umstellungsbeginn** ein. Der Knopf „1.1.“ datiert auf den 1. Januar des Jahres zurück, z. B. für Bayern. Die App hilft mit Vorschlägen:
  - **Gleicher Feldblock:** Hat die Fläche dieselbe FLIK wie eine schon zugeordnete Fläche (z. B. ein Blühstreifen im Schlag), schlägt die App deren Umstellungsdatum vor. Gibt es im Feldblock mehrere Listenzeilen, zählt die größte, nicht ein kleines Teilstück mit eigenem Datum. „Feldblock-Datum für alle übernehmen“ erledigt alle auf einmal.
  - **Vorjahr:** Ist die Fläche im Vorjahr von einer anderen abgeteilt worden, steht das da („War 2025 Teil von Nr. 2 …“).
  - **Ohne Hinweis:** Ein Sammelknopf bietet das häufigste Umstellungsdatum des Bundeslands aus der Liste an. Vorher fragt die App nach, einzelne Daten kannst du danach noch ändern.
  - Mit **„Datum übernehmen“** übernimmst du einen Vorschlag. Ist es eine Fläche, die in der Liste anders heißt, ordnest du stattdessen die passende Listenzeile zu.
  - **„Ausblenden“** ist für Hecken, Feldgehölze u. ä., die nicht in die Schlagliste gehören. Die Fläche wandert in den Abschnitt „Landschaftselemente und ausgeblendet“, ist kein offener Fall mehr und kommt nicht in den Export. Dort holst du sie mit **„wieder einblenden“** zurück. Auf der Karte sind solche Flächen blassgrün und gestrichelt.
- **Kulturen:** Die Kulturen aus den Shapes übersetzt die App in den Kulturkatalog des externen Programms, z. B. „Winterweichweizen“ → „Winterweizen“, „Winter-Emmer/-Einkorn“ → „Winteremmer, Wintereinkorn“. Bei Thüringen übersetzt sie dafür zuerst den Kulturcode in Klartext. Neben jeder Kultur steht, wie sicher die Zuordnung ist: „gleich“, „Regel“, „ähnlich – prüfen“ oder „unbekannt“. Bei „ähnlich“ bestätigst du mit **„Passt“** oder wählst eine andere Kultur: Ins Feld tippen, die passende Kultur aus den Vorschlägen wählen (Suche im ganzen Katalog) und mit **„Passt“** übernehmen. Erst „Passt“ hakt die Kultur ab; eine Eingabe, die nicht im Katalog steht, weist die App zurück. Hilfe dabei gibt die Schlagliste: Steht bei den Flächen mit dieser Kultur in der Liste schon genau der Vorschlag (z. B. Blühfläche → Grünbrache), gilt er als bestätigt („wie in der Liste“). Steht dort etwas anderes, zeigt die App „Bisher: …“ mit **„übernehmen“**. Weil die Liste die Kultur des Vorjahres enthält, ist das nur ein Hinweis; bei eindeutigen Kulturen zeigt die App ihn deshalb nicht. Darunter steht die **Kategorie** aus der Kategorienliste des externen Programms. Jede Kultur hat eine feste Kategorie (z. B. Körnermais → Mais, Erbsen → Körnerleguminosen, Hanf → Hanf). Steht in deiner Liste für dieselbe Kultur eine andere Kategorie, gilt die aus der Liste. Nur bei Teichflächen, Unbefestigten Mieten und „Unbekannt“ wählst du sie selbst. Ändern kannst du jede Kategorie über die Auswahl. Deine Wahl merkt sich die App auch für andere Betriebe. Ganz oben schaltet „Kulturen aus den Shapes übernehmen“ das Ganze ab.
- **Nutzungsnachweis (PDF) laden:** Steht bei einer Fläche nur ein Nutzungscode (z. B. „942“) oder fehlt die Kultur ganz (z. B. Thüringen bis 2025), lädst du im Abschnitt „Kulturen“ den Ausdruck des Flächen- und Nutzungsnachweises.
  - **Codes lernen:** Die App liest daraus, welcher Code welche Kultur ist. Sie übernimmt nur Codes, die in den Shapes vorkommen.
  - **Flächen ohne Kultur:** Die App ordnet die Zeilen des Ausdrucks über die FLIK (bei mehreren Flächen mit derselben FLIK zusätzlich über Größe bzw. Schlagnummer) den Flächen zu und übernimmt deren Kultur.
  - Liegt der Nutzungsnachweis als PDF schon im Zip der Shape-Dateien (z. B. Bayern), passiert das beim Laden automatisch.
  - Gelernte Codes merkt sich die App je Bundesland, auch für andere Betriebe. Mit Konto gehen sie außerdem als Vorschlag an die Verwaltung und gelten nach der Freigabe für alle Nutzer (siehe [Flächenübersicht](#4-flächenübersicht)).
- **Nicht in den Shapes:** Diese Listenzeilen haben keine Fläche in den Shapes. Auf der Karte erscheint ihre Vorjahresform (gestrichelt) nur, wenn die App die Zeile im Vorjahr sicher einer Fläche zuordnen konnte; sonst gar nicht. Du hast diese Möglichkeiten:
  - **„Abgang eintragen am“** mit Datum.
  - **„Unverändert lassen“**: kein Abgang, die Zeile bleibt beim Export, wie sie ist.
  - **„Nach Antrag zugegangen“** (siehe unten).
  - **„… mit Zeile zusammenfügen“**: Die Fläche ist in einer anderen Zeile aufgegangen. Diese Zeile bekommt einen Abgang, im Panel steht „Zusammengefügt mit …“. Mit **„lösen“** nimmst du das zurück.
  - Eine freie Fläche aus den Shapes zuordnen.
- **Geteilt?** Ist eine Fläche in mehrere geteilt worden (z. B. Feldstück 3 in die Schläge 3/1 und 3/2), passt die Listenzeile zu keiner einzelnen Fläche mehr. Ergeben die neuen Flächen zusammen die Größe der Zeile, zeigt die App beim Zweifelsfall bzw. bei der Zeile ohne Fläche den Vorschlag **„Geteilt?“** mit den Teilen und der Summe. Erst wenn du **„Als Teilung übernehmen“** tippst, passiert etwas: Die Zeile bekommt die größte Fläche und behält ihre Schlüssel. Jede weitere Fläche wird beim Export eine neue Zeile mit demselben Umstellungsdatum und Status. Unter „Neu in den Shapes“ steht bei diesen Flächen „Aus der Teilung von …“. Mit **„Teilung lösen“** nimmst du es zurück.
- **Teilstücke in der Liste:** Steht ein Teilstück als eigene Zeile in der Liste (gleiche Nummer vorn in der Bezeichnung, z. B. mit eigenem Zugang) und ergibt es zusammen mit der Hauptzeile genau die Fläche aus den Shapes, erkennt die App das von selbst: kein Abgang, und die Hauptzeile bekommt beim Export nur den Rest der Größe.
- **Ohne Fläche, bleiben unverändert:** In diesem Abschnitt stehen alle Zeilen ohne Fläche, die keinen Abgang bekommen, mit dem Grund (Umstellungsdatum nach dem 15.05., nach Antrag zugegangen, unverändert gelassen, Teilstück von …).
- **Nach dem Agrarantrag zugegangen:** Flächen, die erst nach dem 15.05. des Abgleichsjahres zum Betrieb gekommen sind, stehen schon in der Liste, aber noch nicht in den Shapes. Sie sind kein Abgang. Zeilen mit einem Umstellungsdatum nach dem 15.05. erkennt die App von selbst und zeigt sie in diesem eigenen Abschnitt, ohne offenen Fall. Hat eine solche Fläche ein älteres Datum, z. B. ein Bio-Zugang mit dem Umstellungsdatum des Vorbewirtschafters, tippst du unter „Nicht in den Shapes“ auf **„Nach Antrag zugegangen“**. Beim Export bleiben diese Zeilen ohne Abgang; nur der Umstellungsstatus wird zum Stichtag fortgeschrieben. Mit **„doch nicht“** wird die Zeile wieder ein normaler Fall.

**Fortschritt:** Oben im Panel steht, wie viele Fälle schon geklärt sind, mit Balken und Prozentzahl. Ein erledigter Fall bekommt einen grünen Haken, ein erledigter Abschnitt den Hinweis „erledigt“ und klappt zu. Abschnitte, die du selbst zu- oder aufgeklappt hast, bleiben so, während du weiterarbeitest. Das Auge zeigt, welche kritischen und neuen Fälle du schon auf der Karte angesehen hast. Sind alle Fälle geklärt, gibt es eine kleine Feier und den Hinweis „bereit für den Export“. Den Stand siehst du auch in der Seitenleiste.

**Rückgängig und Zurücksetzen:**

- **„Rückgängig“** oben im Panel nimmt die letzte Entscheidung zurück, z. B. ein „Passt“, ein Datum oder einen Abgang. Die App springt dabei zu dem Fall zurück, sodass du ihn gleich neu bearbeiten kannst. Das geht mehrmals hintereinander (bis zu 30 Schritte, solange die App offen ist).
- **„Zurücksetzen“** unten im Panel (oder „Abgleich zurücksetzen“ in der Seitenleiste) verwirft nach einer Rückfrage alle Entscheidungen dieses Abgleichs: Zuordnungen, Umstellungsdaten, Abgänge, Unterflächen und die hier gewählten Kulturen. Die Schlagliste selbst bleibt geladen. Auch das Zurücksetzen lässt sich mit „Rückgängig“ zurücknehmen.

**Für Import exportieren (Excel)** erzeugt die Liste im gleichen Format wie die Vorlage. Sind noch Fälle offen, fragt die App vorher nach.

**Was der Export ändert:** Schlagnummer (nur wenn sie in der Liste die echte Schlagnummer ist) und Bezeichnung (z. B. nach einer Umnummerierung; der Name aus der Liste bleibt, solange er dem der Fläche ähnelt, Zusätze wie „_Abdrift 2025“ gehen also nicht verloren), „ha“ aus der Shape-Datei, Kultur und Kategorie (wenn „Kulturen aus den Shapes übernehmen“ an ist; ohne Kategorie bleiben bei vorhandenen Zeilen beide Spalten unverändert), „Status Feldstück“, „Abgang Fläche“ und „Fläche besichtigt im Jahr“. Diese Spalte kommt aus dem Haken „Besichtigt“ in der Flächentabelle. Neue Flächen mit Umstellungsbeginn hängt der Export als neue Zeilen an, mit leeren Schlüsseln (PK Feld, PK Kultur). Eine **Unterfläche** steht als eigene Zeile direkt unter ihrer Fläche: gleiche Schlagnummer, Bezeichnung mit „– Teilstück“ und Jahr, eigene Größe, eigenes Umstellungsdatum und eigener Status, leere Schlüssel. Die Fläche selbst behält nur die restliche Größe. Die Schlüssel und die Kundennummer bleiben immer unverändert. Landschaftselemente kommen nicht in den Export. Zeilen ohne Bezeichnung und Fläche bleiben, wie sie sind.

**Spalte „Import Information“:** Daran erkennt das externe Programm beim Import, was zu tun ist:

- **New:** neue Zeile, also eine neue Fläche oder eine Unterfläche.
- **Updated:** An der bestehenden Zeile hat sich mindestens eine Spalte geändert, z. B. Bezeichnung, Größe, Kultur, Status, Abgang oder „Fläche besichtigt im Jahr“.
- **Not updated:** An der Zeile hat sich nichts geändert.

Zeilen ohne Bezeichnung und Fläche behalten auch hier ihren bisherigen Eintrag.

**Statusbezeichnungen:** Die App übernimmt die Texte, die in deiner Liste schon vorkommen (ein Text zählt dabei für die früheste Umstellungsstufe, in der er vorkommt, weil eine Liste dem Stichtag hinterherhinken kann), z. B. „Nichtökologische Erzeugnisse (aus dem 1. Umstellungsjahr)“ und „Ökologische Erzeugnisse“. Fehlende Texte prüfst du im Panel unter „Statusbezeichnungen im externen Programm“. Sie müssen beim Import wörtlich stimmen. Die App merkt sie sich.

Mit Schlagliste zeigt die Vergleichstabelle zusätzlich die Spalte **„Umstellung“**, und im Popup einer Fläche steht ihr Status. Schlagliste und Zuordnungen bleiben beim Betrieb gespeichert. „Schlagliste entfernen“ löscht beides.

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

## 12. Dashboard und Betrieb

Beides gibt es mit Konto. In der Seitenleiste stehen dafür oben zwei breite Kacheln:

- **Dashboard** mit den Reitern **Übersicht**, **Kalender** und **Dokumente**. Angemeldet ist die Übersicht die erste Seite: beim Start der App und direkt nach dem Anmelden.
- **Betrieb** für die Seite des gewählten Betriebs. Unter dem Namen der Kachel steht, welcher Betrieb gerade gewählt ist.

### Betrieb

Die zentrale Seite für den gewählten Betrieb, zu erreichen über die Kachel „Betrieb“ in der Seitenleiste.

- **Kopfkarte:** Name, Kundennummer, Ort, Verbände; Knöpfe für Route, Anrufen und E-Mail; Kontaktdaten; „Wechseln“.
- **Betriebsfunktionen:** Kacheln direkt unter der Kopfkarte für Flächenübersicht, Fruchtfolge, Flächenzeichner, Hofplan, Stallplaner, Tierbestand, Obstbäume und Bienenflug.
- **Unterlagen der Kontrolle:** je eine Kachel für Probenahmeprotokolle, Cross Checks, Warenflussprüfungen, Fotos & Dokumente und Notizen. Jede Kachel zeigt die letzten Einträge und legt neue direkt am aktuellen Termin an. Ist eine Probenahme oder ein Cross Check beauftragt, ist die Kachel markiert („beauftragt · offen“ oder „beauftragt · erledigt“).
- **Flächen:** Kurzform der Flächenübersicht mit Gesamtfläche und den größten Kulturen.
- **Termine dieses Betriebs:** oben der aktuelle Termin (der zugeordnete, sonst der nächste) mit seinen Aufträgen als Schilder und dem Knopf „Kontrollmappe öffnen“. Ein roter Punkt am Auftrag heißt „unbestätigt“. Darunter stehen die weiteren Termine mit Zählern für Protokolle, Prüfungen und Dateien; ein Tipp öffnet die Kontrollmappe.

Ohne gewählten Betrieb bietet die Seite die nächsten Termine zur Auswahl an.

### Dashboard: Reiter „Übersicht“

Die Übersicht besteht aus **Bausteinen**, die du dir selbst zusammenstellst. Voreingestellt sind:

- **Kennzahlen:** Termine heute, Termine und Aufträge diese Woche.
- **Heute & nächste Tage:** die Termine der nächsten 7 Tage mit Route und Anruf. Ein Tipp öffnet die Kontrollmappe.
- **Karte der Termine:** die Termine einer Kalenderwoche, die eine Adresse haben. Mit den Pfeilen blätterst du wochenweise, „Diese Woche“ springt zurück. Daneben steht, wie viele Termine die Woche hat und wie viele davon keine Adresse haben. Ein Tipp auf einen Punkt öffnet die Kontrollmappe.
- **Neueste Dokumente:** die zuletzt hinzugefügten Fotos und Dateien; „Alle Dokumente“ führt in den Reiter „Dokumente“.
- **Zuletzt bearbeitete Protokolle:** Probenahme, Cross Check und Warenfluss über alle Termine.
- **Schnellzugriff:** heutigen Termin öffnen, Kalender, Dokumente, Betrieb wählen, Termine importieren.

**Anpassen:** Der Knopf „Anpassen“ oben rechts schaltet in den Bearbeiten-Modus. Die Übersicht ist dann ein Raster, auf dem du die Bausteine frei anordnest:

- **Verschieben:** Baustein an seiner Kopfzeile (mit dem Titel und den sechs Punkten) mit Maus oder Finger an eine beliebige Stelle ziehen. Die anderen Bausteine bleiben stehen und weichen nur aus, wenn sie im Weg sind. Lücken sind erlaubt.
- **Größe ändern:** an einem Rand oder einer Ecke ziehen (die Ecke unten rechts ist markiert) — so wird ein Baustein breiter, schmaler, höher oder niedriger. Passt der Inhalt nicht hinein, lässt er sich im Baustein scrollen.
- **✕:** Baustein ausblenden.
- **Lücken schließen:** rückt alle Bausteine so weit wie möglich nach oben.

Unter „Weitere Bausteine“ blendest du zusätzliche ein: **Zu erledigen** (unbestätigte und unangemeldete Termine, Termine ohne Adresse, wartende Uploads, unvollständige Protokolle), **Aktueller Betrieb**, **Aufträge nach Art** (nächste 30 Tage) und **Meine Notiz** (ein Merkzettel nur für dich). „Standard“ stellt die Voreinstellung wieder her, „Fertig“ beendet das Anpassen.

Neue Bausteine erscheinen unten. Deine Anordnung und die Notiz werden im Konto gespeichert und gelten auf allen deinen Geräten. Am Handy (schmaler Bildschirm) stehen die Bausteine in derselben Reihenfolge untereinander; auf dem breiten Bildschirm ist die freie Anordnung wieder da. Außerhalb von „Anpassen“ ist das Raster fest, damit nichts versehentlich verrutscht.

### Dashboard: Reiter „Kalender“

- **Termine importieren** (Seitenleiste): Termine als Excel-Datei (.xlsx) aus dem Portal laden. Uhrzeiten kommen optional aus einer Kalenderdatei (.ics).
- **Woche oder Liste;** am Handy immer als Liste.
- **Karte:** blendet eine Karte mit den Terminen der Woche ein.
- **Termin verschieben:** am PC per Ziehen, sonst über das Datumsfeld in der Kontrollmappe.
- **Unangemeldete Audits** (Spalte „Audit unangemeldet“ der Terminliste) sind im Kalender farbig hervorgehoben; in der Kontrollmappe steht das Schild „Unangemeldet“.
- Aufträge desselben Betriebs zur selben Zeit werden zu **einem Termin** zusammengefasst. Verbände (Demeter, Bioland, Naturland …) erscheinen als farbige Schilder, Probenahme und CC-Anfrage als Schilder mit Symbol.

### Dashboard: Reiter „Dokumente“

Der Dateiexplorer zeigt **alle Fotos und Dokumente aller Termine** an einer Stelle. Dazu gehören auch die Anlagen der Protokolle (nur zum Ansehen) und Dateien, die noch auf den Upload warten. Die Zahl am Reiter in der Seitenleiste nennt die Anzahl.

- **Ordner:** links der Ordnerbaum — „Alle Dokumente“, darunter je Betrieb ein Ordner und darin je Termin einer. Über der Liste stehen dieselben Ordner als Kacheln, oben der Pfad zum Zurückspringen. Am Handy gibt es nur Pfad und Kacheln.
- **Suche** nach Dateiname, Betrieb oder Termin.
- **Filter:** Alle, Fotos, PDF, Sonstige.
- **Sortierung:** Neueste oder älteste zuerst, Name, Größe, Betrieb.
- **Liste oder Kacheln:** Kacheln zeigen bei Fotos ein Vorschaubild. Deine Wahl merkt sich die App.
- **Je Datei:** antippen öffnet den Viewer (dort blätterst du durch alle angezeigten Dateien), dazu „Umbenennen“, „Herunterladen“, „Zum Termin“ (öffnet die Kontrollmappe) und „Löschen“.
- **Als ZIP herunterladen:** packt alle gerade angezeigten Dateien in eine ZIP-Datei, sortiert in Ordner nach Betrieb und Termin. Ohne Internet sind nur Dateien dabei, die du schon einmal angesehen hast.
- **Datei hinzufügen:** erscheint, wenn du im Ordner eines Termins bist.

Hochgeladen wird weiterhin am Termin: Foto, Scan und Fotomappe findest du in der Kontrollmappe unter „Dokumente“. Von dort führt „Im Dateiexplorer“ direkt in den Ordner des Termins.

### Kontrollmappe

Ein Tipp auf einen Termin öffnet die Kontrollmappe (am Handy im Vollbild). Im Kopf: Betrieb, Datum, Status, Route, Anrufen, „Als Betrieb zuordnen“.

**Überblick:** die Aufträge des Termins, Termin verschieben, Kontakt, Hinweise.

**Protokolle:**

- **Probenahmeprotokoll** und **Cross Check:** Formulare, die Betriebsdaten vorbelegen. Pflichtangaben sind markiert; der Export als PDF landet bei den Dokumenten des Termins.
  - Probenummern lassen sich per **Barcode-Scanner** eintragen.
  - **Anlagen:** Im Abschnitt mit den Anlagen fügst du Fotos oder Dateien hinzu oder tippst auf **„Dokument scannen“** (wie unter „Dokumente“). Der Scan hängt dann direkt am Protokoll und wird beim Export als zusätzliche Seiten angefügt.
  - Im exportierten PDF stehen die Eingaben in normaler Schriftgröße in ihren Feldern. Lange Texte werden kleiner gesetzt, damit sie ins Feld passen.
  - **Unterschriften:** direkt im Feld oder mit „Vergrößern“ in einem großen Unterschriftenfeld (am Handy am besten quer halten). Deine eigene Unterschrift aus dem Profil setzt du per Knopf ein.
- **Warenflussprüfungen:** siehe [Kapitel 13](#13-warenflussprüfung).

**Dokumente:**

- **Foto aufnehmen:** Das Foto wird sofort gesichert. Danach fragt die App nach einem Namen, mit Vorschlägen zum Antippen: Lieferschein, Rechnung, Etikett, Zertifikat, Lieferantenliste, Sortimentsliste, Wiederverkäuferliste, HIT-Auszug, FNN, Verstoß Beleg, Futtermittel, Saatgut, Lager, Stall, Auslauf, Bestandsregister, Reinigungsmittel und Schädlingsbekämpfung. Hinter den Vorschlag kannst du Details schreiben. „Ohne Namen“ behält den Standardnamen.
- **Datei hinzufügen.**
- **Dokument scannen:** mehrere Seiten aufnehmen (Kamera, Kamera-App oder Galerie), Ecken prüfen, Filter wählen, drehen. „Fertig“ erstellt eine PDF-Datei; danach benennst du das Dokument.
- **Fotomappe:** mehrere Fotos zu einer PDF-Datei mit Bezeichnung zusammenfassen.
- **Umbenennen:** der Stift oben links an jedem Anhang.
- **Ansehen:** Ein Tipp auf einen Anhang öffnet den Dokumenten- und Fotoviewer. PDFs und Fotos lassen sich dort auch in einem neuen Tab öffnen. Andere Dateien (z. B. Webseiten oder SVG-Grafiken) kannst du aus Sicherheitsgründen nur herunterladen.

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

### Eingesehene Unterlagen

Oben in der Prüfung kreuzt du an, welche Unterlagen du eingesehen hast. Die Auswahl passt zum Bereich, z. B. Schlagkartei und Ernteaufzeichnungen im Pflanzenbau, Bestandsregister und Futtermittelbelege in der Tierhaltung, Rezepturen in der Verarbeitung. Was fehlt, trägst du unter „Sonstiges“ ein. Im Prüftext steht daraus die Zeile „Eingesehene Unterlagen: …“.

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

**Zwischen Geräten:** Ein Foto, Scan oder eine Änderung am Termin geht wenige Sekunden nach dem Speichern in die Cloud. Deine anderen Geräte (z. B. der Laptop) werden dabei angestoßen und holen das Neue sofort ab, wenn sie online sind und die App offen ist. Sonst passiert es spätestens, sobald du wieder in die App wechselst. Ist auf dem anderen Gerät gerade ein Protokoll offen, kommt das Neue nach dem Schließen.

### Ohne Empfang arbeiten

Die App funktioniert ohne Verbindung weiter, wenn du auf dem Gerät schon angemeldet warst. Änderungen, Fotos und Scans bleiben auf dem Gerät und werden übertragen, sobald wieder Empfang da ist. Kartenhintergründe brauchen Empfang.

Wurde derselbe Betrieb inzwischen auf einem anderen Gerät geändert, fragt die App beim Abgleich nach, welcher Stand gelten soll.

### Daten auf diesem Gerät schützen (Geräteschutz)

Damit du ohne Empfang arbeiten kannst, liegen deine Kontrolldaten auch auf dem Gerät: Termine, Protokolle, Flächen, Pläne, noch nicht hochgeladene Fotos und geöffnete Dokumente. Der Geräteschutz verschlüsselt diese Daten mit deinem Konto-Passwort. Geht ein Handy oder Tablet verloren, kann ohne dein Passwort niemand sie lesen.

- **Einrichten:** Der Schutz ist von Anfang an eingeschaltet. Er wird beim Anmelden mit deinem Passwort eingerichtet. Warst du schon vorher angemeldet, fragt die App einmal nach deinem Passwort („Daten auf diesem Gerät schützen“). Dafür braucht es einmal Internet, weil das Passwort geprüft wird. Mit „Ohne Schutz weiter“ lässt du ihn aus.
- **Entsperren:** Beim Öffnen der App und nach einer Weile ohne Bedienung zeigt die App „FeldFolio ist gesperrt“. Gib dein Konto-Passwort ein; das geht auch ohne Empfang. Sperrt sich die App nach einer Weile ohne Bedienung, laufen Abgleich und Uploads im Hintergrund weiter.
- **Fingerabdruck oder Gesicht:** Unter **Konto & Einstellungen → Sicherheit** richtest du mit „Mit Fingerabdruck oder Gesicht entsperren“ zusätzlich das Entsperren über die Gerätesperre ein. Das geht nur auf Geräten, die es für Web-Apps anbieten (z. B. Windows Hello, aktuelle Android-Geräte, iPhone/iPad ab iOS 18). Das Passwort funktioniert immer.
- **Sofort sperren:** im Konto-Menü „Jetzt sperren“, zum Beispiel bevor du das Tablet aus der Hand gibst.
- **Einstellungen** unter **Konto & Einstellungen → Sicherheit → Daten auf diesem Gerät:**
  - „Automatisch sperren nach“: 5, 15 (Voreinstellung), 30 oder 60 Minuten ohne Bedienung, oder „Nur beim Öffnen der App“.
  - „Verschlüsseln und App sperren“: Ausschalten und wieder Einschalten geht jeweils nur mit deinem Passwort. Die Einstellung gilt für dieses Gerät.
- **Passwort geändert:** Änderst du dein Passwort in der App, gilt hier sofort das neue. Hast du es auf einem anderen Gerät geändert, fragt die App beim nächsten Anmelden hier einmal nach dem bisherigen Passwort.
- **Passwort vergessen:** Ohne das Passwort, mit dem die Daten geschützt wurden, lassen sie sich nicht öffnen. Unter „Passwort vergessen oder geändert?“ auf dem Sperrbildschirm kannst du sie auf diesem Gerät löschen. Was schon mit der Cloud abgeglichen war, lädt die App danach neu; nicht abgeglichene Änderungen gehen verloren. Ein neues Passwort setzt du über „Passwort vergessen?“ beim Anmelden.

Der Geräteschutz ersetzt nicht die Sperre des Geräts selbst: Richte auf jedem Dienstgerät eine Bildschirmsperre (PIN, Fingerabdruck) ein. Geht ein Gerät verloren, melde dich in den Einstellungen mit „Auf allen Geräten abmelden“ überall ab.

### Fehler melden

Klappt etwas nicht, fehlt dir eine Funktion oder hast du eine Frage, meldest du das direkt aus der App: im Konto-Menü **„Fehler melden“** (nur angemeldet). Die Meldung geht an das FeldFolio-Team und bekommt eine Nummer (z. B. #12).

- **Art:** „Fehler“, „Verbesserung“ oder „Frage“.
- **Kurzbeschreibung** (Pflicht), dann je nach Art:
  - bei Fehlern „Was hast du gemacht? (Schritte zum Nachstellen)“, „Was hast du erwartet?“ und „Was ist stattdessen passiert?“, dazu **Auswirkung** (Kritisch, Hoch, Mittel, Niedrig) und **Wie oft?**;
  - bei Verbesserungen und Fragen ein Feld zum Beschreiben.
  Je genauer die Schritte, desto schneller lässt sich der Fehler finden.
- **Bildschirmfoto:** Die App macht beim Öffnen ein Bild der aktuellen Ansicht (Kartenhintergründe bleiben dabei grau). Es geht nur mit, wenn du **„Bildschirmfoto anhängen“** ankreuzt — es kann Betriebsdaten zeigen. Antippen vergrößert es. Mit „Eigenes Bild wählen“ hängst du stattdessen ein anderes Bild an, z. B. ein Bildschirmfoto deines Geräts.
- **Technische Angaben** gehen immer mit: Version der App, Browser, Gerät, aktuelle Ansicht, Verbindungs- und Speicherstand sowie die letzten Fehlermeldungen und Klicks der App. Inhalte, E-Mail-Adressen und längere Nummern (z. B. Ohrmarken) werden vorher entfernt. Unter „Technische Angaben (werden mitgesendet)“ siehst du genau, was mitgeht.
- **Ohne Empfang** wird die Meldung auf dem Gerät gespeichert und automatisch gesendet, sobald wieder Verbindung da ist.
- **Meine Meldungen** (zweiter Reiter) zeigt deine Meldungen mit Nummer und Stand: Neu, Bestätigt, In Arbeit, Erledigt, Abgelehnt oder Duplikat.

Tritt in der App ein unerwarteter Fehler auf, erscheint unten rechts kurz „Da ist etwas schiefgelaufen.“ mit dem Knopf **„Fehler melden“**; die Fehlermeldung steht dann schon im Bericht.

### Konto-Dialog

- **Profil:** Name, Telefon, Kontrollstelle, Kürzel/Prüfernummer und deine Unterschrift. Name und Unterschrift werden in Protokollen vorbelegt.
- **Sicherheit:** Daten auf diesem Gerät schützen (siehe oben), Passwort ändern.
- **Sync & Gerät:** automatischer Abgleich, Sicherungen des Arbeitsstands.
- **Abmelden:** wahlweise mit Löschen der Daten auf diesem Gerät (empfohlen auf fremden Geräten) und auf allen Geräten abmelden. Nach dem Abmelden ist kein Betrieb mehr gewählt, und seine Flächen und Pläne verschwinden aus der Ansicht. Meldest du dich wieder an, ist der zuletzt gewählte Betrieb wieder da.
- **Konto löschen.**
- **Verwaltung** (nur für freigeschaltete Admin-Konten): offene Zugangsanfragen freischalten oder ablehnen, **Fehlerberichte** bearbeiten und **Nutzungscodes – Vorschläge** prüfen. Je Bundesland und Code stehen dort alle vorgeschlagenen Kulturen, mit der Zahl der Nutzer und der Herkunft (Nutzungsnachweis oder eingetragen). **„Freigeben“** macht eine Kultur für alle gültig und lehnt die anderen Vorschläge für denselben Code ab; **„Ablehnen“** verwirft einen Vorschlag.
  Unter **Fehlerberichte** stehen die Meldungen aller Nutzer (Auswahl „Offene“ oder „Alle“). Ein Tipp auf eine Meldung zeigt alle Angaben, das Bildschirmfoto, die Umgebung und das Protokoll. Dort setzt du **Status**, **Priorität** (P1 bis P4) und bei Duplikaten die Nummer der ursprünglichen Meldung, dazu eine **interne Notiz**; „Speichern“ übernimmt das, der Melder sieht den neuen Stand. „Als Markdown kopieren“ gibt eine Meldung im üblichen Format für Fehler-Tickets weiter, der Knopf mit dem Pfeil lädt die ganze Liste als Datei herunter.

---

## 15. Hinweise und Grenzen

- **Hektar-Angaben:** Einzelne Flächen mit Größe aus der Shape-Datei werden mit bis zu vier Nachkommastellen gezeigt (auf den Quadratmeter genau). Summen und Kennzahlen haben zwei Stellen. Größen, die aus der Form berechnet sind (gezeichnete Flächen, Shape-Dateien ohne Größenangabe), haben zwei Stellen und sind mit * gekennzeichnet.
- **Shape-Dateien der Bundesländer** sind unterschiedlich aufgebaut. Manche enthalten keine Kulturart (z. B. Thüringen); dann steht dort „Ohne Angabe“. Bei Thüringen liest die App die FLIK mit aus (Flächentabelle, Suche). Ein Schlag kann dort aus mehreren FLIK-Stücken bestehen, deshalb ist die Schlagnummer nicht eindeutig. Die 6-stelligen Thüringer Kulturcodes kennt die App bisher nur, soweit sie in einem Beispielantrag 2026 vorkamen. Unbekannte Codes erscheinen als Zahl. Im Abgleich lädst du dann den Nutzungsnachweis (PDF) oder wählst die Kultur von Hand aus. Die Shapes bis 2025 enthalten gar keine Kultur; die kommt über den Nutzungsnachweis dazu.
- **Jahresvergleich und Fruchtfolge** verbinden Schläge über die Schlagnummer. Ändert sich nur die Nummer, erkennt der Jahresvergleich das an der Lage („Umnummeriert“). In der Fruchtfolge gilt der Schlag dann weiter als neu.
- **Schlagliste:** Die Zuordnung ist ein Vorschlag. Die Übersetzung der Kulturen in den Katalog des externen Programms läuft über Namensregeln; bei „ähnlich“ und „unbekannt“ immer selbst entscheiden. Zweifelsfälle immer selbst prüfen. Die Statusbezeichnungen müssen wörtlich wie im externen Programm eingetragen sein, sonst kann der Import sie nicht zuordnen. Sonderfälle wie eine verkürzte Umstellungszeit rechnet die App nicht. Sie zählt immer 12 bzw. 24 Monate ab dem eingetragenen Datum.
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
| Dashboard und Betrieb fehlen in der Funktionsauswahl | Beide gibt es nur angemeldet. |
| Sperrbildschirm nimmt das Passwort nicht an | Die Daten auf dem Gerät sind mit dem Passwort geschützt, das beim Einrichten galt. Hast du es seitdem auf einem anderen Gerät geändert, gib das bisherige ein. Sonst unter „Passwort vergessen oder geändert?“ die Daten auf diesem Gerät löschen (Abgeglichenes kommt aus der Cloud zurück). |
| Etwas funktioniert nicht wie erwartet | Im Konto-Menü „Fehler melden“ wählen und die Schritte beschreiben. |
| App zeigt einen alten Stand | Seite neu laden. Die installierte App einmal schließen und wieder öffnen. |
| Kein Kartenbild | Kartenhintergründe brauchen Empfang. Flächen und Daten bleiben nutzbar. |
