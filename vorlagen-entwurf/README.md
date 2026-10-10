# Vorlagen-Entwurf (nur zum Testen)

Modernisierte Fassungen der beiden Formularvorlagen im FeldFolio-Design.
**Die App nutzt weiterhin die Originale** in `public/` — dieser Ordner wird
nicht mit ausgeliefert (Vite kopiert nur `public/`).

| Datei | Inhalt |
|---|---|
| `probenahmeprotokoll-vorlage-modern.pdf` | Probenahmeprotokoll FB.09.06.01, leer, ausfüllbar |
| `crosscheck-vorlage-modern.pdf` | Cross Check FB.09.06.10, leer, ausfüllbar |
| `muster/*-muster.pdf` | Beispiele, ausgefüllt über den **echten App-Export** (Testdaten) |

## Kompatibel mit der App

- Gleiche Formularfeld-Namen, -Typen und Auswahlwerte wie die Originale
  (inkl. Eigenheiten wie `PLZ  Ort` oder `Auswahl 2`).
- Unterschriften liegen genau dort, wo die App sie einzeichnet
  (`PROBENPROTOKOLL_SIGNATURE_BOXES`, `CROSSCHECK_SIGNATURE_BOX` in `src/main.js`).

Zum Übernehmen würde es daher reichen, die beiden Dateien nach `public/` zu
kopieren (Dateinamen der Originale: `probenahmeprotokoll-vorlage.pdf`,
`crosscheck-vorlage.pdf`). Vorher fachlich prüfen lassen: Es handelt sich um
gelenkte QM-Dokumente — Texte wurden 1:1 übernommen, aber Layout und
Ausgabestand-Angaben müssen von der Freigabe (AW) abgesegnet werden.

## Neu erzeugen

```
npm run dev                              # für die Muster (optional)
node scripts/build-vorlagen-entwurf.mjs
```

Layout: `scripts/vorlagen-entwurf/builder.js` (pdf-lib wie in der App über das CDN).
