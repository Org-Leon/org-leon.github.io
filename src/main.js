import { isSupabaseConfigured, signUp, signIn, signOut, getSession, saveState, loadState, uploadPhoto, getPhotoUrl, deletePhoto, requestAccess, listPendingAccessRequests, approveAccessRequest, declineAccessRequest } from './supabase.js';
import { readLocalState, writeLocalState, deleteLocalState, readLastUser, writeLastUser, addBackup, listBackups } from './offline-store.js';
import { registerSW } from 'virtual:pwa-register';
// Icon-Font selbst NICHT über das npm-Paket eingebunden (5+ MB Variable-Font
// mit allen ~3000 Icons) — stattdessen ein auf die tatsächlich genutzten
// Icon-Namen zugeschnittenes, auf eine feste Achsen-Instanz reduziertes
// woff2 (~270 KB, siehe scripts/subset-icons.mjs), per @font-face in
// style.css eingebunden.

// ---------- Hell-/Dunkelmodus ----------
// Die eigentliche Anwendung des gespeicherten Themes passiert schon synchron
// im <head> (index.html), damit beim Neuladen nichts falsch aufblitzt — hier
// nur noch der Umschalt-Klick.
document.getElementById('theme-toggle').addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('oekoviewer-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('oekoviewer-theme', 'light');
  }
});

// ---------- Mobile: Sidebar als Einschub ----------
// Ab der Media-Query-Breite in style.css wird #sidebar per CSS zu einem
// festen Einschub von links (transform, siehe dort) — hier nur die
// Auf/Zu-Logik: Menü-Button, Klick auf das Backdrop dahinter, Esc, und
// automatisches Schließen sobald eine Funktion gewählt oder eine Datei
// abgelegt wird (auf Desktop-Breiten sind all das no-ops, da die Sidebar
// dort ohnehin permanent sichtbar bleibt und das Backdrop unsichtbar ist).
function closeMobileSidebar() { document.body.classList.remove('sidebar-open'); }
function toggleMobileSidebar() { document.body.classList.toggle('sidebar-open'); }
document.getElementById('btn-sidebar-toggle').addEventListener('click', toggleMobileSidebar);
document.getElementById('btn-current-view').addEventListener('click', toggleMobileSidebar);
// Am Handy steckt der Hell/Dunkel-Schalter in der Schublade (Kopfzeile zu eng).
document.getElementById('btn-theme-mobile').addEventListener('click', () => document.getElementById('theme-toggle').click());
document.getElementById('sidebar-backdrop').addEventListener('click', closeMobileSidebar);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileSidebar(); });

const COLORS = ['#4FB8AF', '#D97757', '#8AA6D9', '#C9A24F', '#B287D9', '#6FBF73', '#E08FA8', '#5FA8C4'];
let colorIdx = 0;
const layers = {}; // id -> { name, geojson, leafletLayer, color, visible }
let layerCounter = 0;
const featureIndex = []; // flat list of every feature across all layers, for the table view
let featureEntryCounter = 0;
let highlightedEntry = null;

// Deine Shapefiles benennen die relevanten Attribute unterschiedlich, je nach
// Bundesland/Software-Export — DBF-Feldnamen sind zudem GROSS-/Kleinschreibung-
// empfindlich (props['NAME'] !== props['Name']), daher tauchen manche Felder
// hier bewusst in mehreren Schreibweisen auf. Bekannte Formate (Stand: unsere
// Bundesland-Testdateien in test-shapes/, siehe todo.txt für den Detail-Stand
// je Bundesland):
//  - NUMMER/NAME/FLAECHE/NUTZ_BEZ  (Parzellen, u.a. Brandenburg/Mecklenburg-
//    Vorpommern/Sachsen-Anhalt/Schleswig-Holstein — Referenzformat)
//  - SCHLAG_NR/TF_BEZ/CODE_BEZ     (Teilflächen, gleiche Länder)
//  - OBJEKT_ID/FLIK/SCHLAG_NR      ("teilschlaege"-Format, Niedersachsen: hat
//    weder Name/Größe/Kulturart im Datensatz)
//  - SCHLAG_ID/SCHLAG_BEZ/SC_FL_BRUT/SC_HA_CODE/NC (sächsische "Schläge"-Exporte)
//  - FSNr/Name/LFlaeche + Schlag/Flaeche/Nutzung (Bayern "Feldstueck"+"Nutzung":
//    zwei getrennte, geometrisch identische Shapefiles — werden in
//    mergeFeldstueckNutzung() zu einer Ebene zusammengeführt)
//  - schlagnr_a/lage_bez/netto_groe/ncode_aktu/flik_aktue (Hessen "Antragsschläge")
//  - SCHLAGNR/SCHLAGBEZ/FLIK       (NRW "TS_"/"BLE_"-Format: kein Größen- oder
//    Kulturartfeld im Datensatz)
//  - SCHLAGNR/LAGE_BEZ/GR/NCODE/CODE_BEZ/FLIK (Saarland "schlag_"-Format)
//  - SCHLAGNR/SCHLAGFLAE/KTA_AJ    (Rheinland-Pfalz "SchlaegeExport": Größe in
//    m², kein Name-/Flächenidentifikator-Feld im Datensatz)
//  - schlag_nr/bez/flaeche_ha/nutz_code (Baden-Württemberg/Brandenburg "fiona"-Export)
//  - GEOWD_ID/GEOWD_GEO_ (Thüringen "Antragsflächen Hauptnutzung": mehrere
//    DBF-Felder werden beim 10-Zeichen-Kürzen auf denselben Namen abgeschnitten,
//    z.B. 6x "GEOWD_GEO_" — props behält dadurch nur den JEWEILS LETZTEN
//    gleichnamigen Wert; Name/Kulturart/Flächenidentifikator gehen so verloren,
//    siehe TODO in todo.txt)
// Achtung bei "kultur": manche Felder, die wie Kulturarten aussehen, sind es
// nicht — ZWECK/MASSNAHME (Sachsen) und "interventi"/GEOWD_FREE (NRW/RLP/BW/
// Thüringen) sind Förderkulissen-Kürzel (z.B. "EGS,AZL,OEBL"), keine Kulturarten,
// und bleiben daher bewusst außen vor. Wo nur ein Nutzungscode (NC/nutz_code/
// ncode_aktu/Nutzung/SC_HA_CODE/KTA_AJ/NCODE) ohne Klartext-Zuordnung existiert,
// wird der Code selbst angezeigt statt einer erfundenen Übersetzung.
const FIELD_CANDIDATES = {
  nummer: ['NUMMER', 'SCHLAG_NR', 'SCHLAGNR', 'SCHLAG_ID', 'TF_ID', 'SCHLAG', 'FSNr', 'schlagnr_a', 'schlag_nr', 'GEOWD_ID', 'ID', 'NR'],
  name: ['NAME', 'Name', 'BEZEICHNUNG', 'FLAECHENNAME', 'SCHLAGNAME', 'SCHLAGBEZ', 'SCHLAG_BEZ', 'TF_BEZ', 'lage_bez', 'LAGE_BEZ', 'bez'],
  kultur: ['NUTZ_BEZ', 'CODE_BEZ', 'KULTURART', 'FRUCHTART', 'NUTZUNG', 'Nutzung', 'NC', 'nutz_code', 'ncode_aktu', 'SC_HA_CODE', 'KTA_AJ', 'NCODE'],
  // Zusätzlicher, von Nummer/Name unabhängiger amtlicher Flächenidentifikator
  // (FLIK/FLEK-Code o.ä.) — heißt je nach Bundesland anders und ist nicht
  // überall vorhanden (siehe todo.txt).
  flaechenid: ['FLEK', 'FLIK', 'FB_BEZEICH', 'FLIK_FLEK', 'FID', 'flik_aktue']
};

// Die Flächengröße braucht eine Sonderbehandlung: manche Quellen liefern sie
// nicht in Hektar, sondern in Ar (NRW-Referenzflächen/BLE, 1 ha = 100 a) oder
// in m² (Rheinland-Pfalz SCHLAGFLAE) — daher hier je Kandidat ein
// Umrechnungsfaktor auf Hektar statt einer reinen Namensliste wie bei den
// anderen Spalten.
const GROESSE_CANDIDATES = [
  { field: 'FLAECHE', scale: 1 },
  { field: 'Flaeche', scale: 1 },
  { field: 'AKTFLAECHE', scale: 1 },
  { field: 'FLAECHE_HA', scale: 1 },
  { field: 'flaeche_ha', scale: 1 },
  { field: 'GROESSE', scale: 1 },
  { field: 'AREA', scale: 1 },
  { field: 'TF_FLAECHE', scale: 1 },
  { field: 'SC_FL_BRUT', scale: 1 },
  { field: 'SC_FLAE_GI', scale: 1 },
  { field: 'LFlaeche', scale: 1 },
  { field: 'netto_groe', scale: 1 },
  { field: 'beantr_gro', scale: 1 },
  { field: 'GEOWD_GEO_', scale: 1 },
  { field: 'GR', scale: 1 },
  { field: 'FLNETTO', scale: 0.01 }, // Ar -> ha
  { field: 'SCHLAGFLAE', scale: 0.0001 } // m² -> ha
];

function pickField(props, candidates) {
  for (const key of candidates) {
    const v = props[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function pickGroesse(props) {
  for (const { field, scale } of GROESSE_CANDIDATES) {
    const v = props[field];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const n = parseFloat(String(v).trim().replace(',', '.'));
    if (isFinite(n)) return String(n * scale);
  }
  return '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Fasst den Besichtigt-Status einer Liste von Flächen-Entries (Viewer- oder
// Obstbaumkataster-Tabelle, beide teilen dieselbe Entry-Form mit .groesse/.besichtigt)
// für die Zusammenfassungszeile über der Tabelle zusammen.
function computeBesichtigtStats(rows) {
  let checkedCount = 0, totalHa = 0, checkedHa = 0;
  rows.forEach(entry => {
    const ha = parseFloat(String(entry.groesse).replace(',', '.'));
    const haVal = isFinite(ha) ? ha : 0;
    totalHa += haVal;
    if (entry.besichtigt) {
      checkedCount++;
      checkedHa += haVal;
    }
  });
  return { totalCount: rows.length, checkedCount, totalHa, checkedHa };
}

function renderBesichtigtSummary(elId, rows) {
  const el = document.getElementById(elId);
  const stats = computeBesichtigtStats(rows);
  if (!stats.totalCount) {
    el.innerHTML = '<span style="color:var(--muted);">Noch keine Flächen geladen.</span>';
    return;
  }
  const pctCount = Math.round((stats.checkedCount / stats.totalCount) * 100);
  const pctHa = stats.totalHa > 0 ? Math.round((stats.checkedHa / stats.totalHa) * 100) : 0;
  const fmtHa = n => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  el.innerHTML =
    `<span>Besichtigt: <strong>${stats.checkedCount} / ${stats.totalCount}</strong> Flächen (${pctCount} %)</span>` +
    `<span><strong>${fmtHa(stats.checkedHa)} / ${fmtHa(stats.totalHa)}</strong> ha (${pctHa} %)</span>`;
}

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);
// Nur im Dev-Server sichtbar (import.meta.env.DEV wird im Produktions-Build
// zu `false` und der Zweig per Dead-Code-Elimination entfernt) — die
// Playwright-Regressionstests (tests/e2e/) brauchen Zugriff auf die
// modul-interne map-Instanz, z.B. um map.fire('draw:created', {...}) direkt
// auszulösen, da Leaflet.draw synthetische Maus-Events unzuverlässig
// verarbeitet.
if (import.meta.env.DEV) window.__ffTestMap = map;

// Alle Werkzeuge (Zeichnen, Baum setzen, Bienenstock setzen) teilen sich jetzt
// denselben Karten-Klick-Event — armedTool sorgt dafür, dass immer nur genau
// ein Werkzeug auf einen Kartenklick reagiert, statt dass sich mehrere
// gegenseitig ins Gehege kommen.
let armedTool = null; // null | 'draw-polygon' | 'place-tree' | 'place-hive' | 'split-line'

// ---------- Flächen-Werkzeugleiste (oberhalb der Karte) ----------
// mapToolMode bestimmt, was ein Klick auf eine vorhandene Fläche auf der
// Karte auslöst, solange "Bearbeiten"/"Löschen"/"Teilen" in der
// Werkzeugleiste aktiv ist — unabhängig von armedTool, das nur läuft, wenn
// tatsächlich ein Leaflet.draw-Zeichenmodus aktiv ist (Polygon/Schnittlinie).
let mapToolMode = null; // null | 'edit' | 'delete' | 'split'
const shapeUndoStack = [];
const shapeRedoStack = [];
const SHAPE_UNDO_MAX = 20;
let shapeEditBeforeGeometry = null; // Geometrie-Schnappschuss beim Start einer Eckpunkt-Bearbeitung, fürs Rückgängig

// Eine Leaflet-Kachelebene kann immer nur auf EINER Karte aktiv sein — Viewer,
// Jahresvergleich und Flächenzeichner haben je eine eigene Leaflet-Map-Instanz
// und brauchen daher jeweils eigene Kachelebenen-Objekte statt sich dieselben
// zu teilen.
function createBasemaps() {
  return {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
      maxZoom: 19
    }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxZoom: 17
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      maxZoom: 19,
      crossOrigin: true // nötig, damit html2canvas die Kartenkacheln beim Flächenkarten-Export auslesen darf
    })
  };
}
const basemapLabels = { osm: 'Standard', topo: 'Topografisch', satellite: 'Satellit' };
const basemapOrder = ['osm', 'topo', 'satellite'];

const basemaps = createBasemaps();
let currentBasemap = 'osm';
basemaps.osm.addTo(map);

// Alle fünf Funktionen teilen sich jetzt eine Karte und damit eine einzige
// Basiskarten-Auswahl im gemeinsamen Topbar.
function setBasemap(key) {
  basemaps[currentBasemap].remove();
  currentBasemap = key;
  basemaps[currentBasemap].addTo(map);
  document.getElementById('btn-basemap-label').textContent = 'Basiskarte: ' + basemapLabels[currentBasemap];
  document.getElementById('btn-basemap').title = 'Basiskarte: ' + basemapLabels[currentBasemap] + ' — antippen zum Wechseln';
}

function cycleBasemap() {
  const nextIdx = (basemapOrder.indexOf(currentBasemap) + 1) % basemapOrder.length;
  setBasemap(basemapOrder[nextIdx]);
}

document.getElementById('btn-basemap').addEventListener('click', cycleBasemap);

document.getElementById('btn-fit').addEventListener('click', fitAllLayers);

map.on('mousemove', (e) => {
  document.getElementById('coord-readout').textContent =
    e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
});

// ---------- Drop zone ----------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('drag');
}));
dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

function setStatus(msg) { document.getElementById('status').textContent = msg; }

function showError(msg) {
  const el = document.getElementById('error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showError._t);
  showError._t = setTimeout(() => el.style.display = 'none', 6000);
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    try {
      setStatus('Lese ' + file.name + ' …');
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'zip') {
        let results = await parseShapefileZip(file);
        if (!results.length) {
          showError(file.name + ': Keine Shapefile-Bestandteile (.shp/.dbf) im Zip gefunden.');
          setStatus('Nichts Lesbares in ' + file.name);
          continue;
        }
        results = mergeFeldstueckNutzung(results);
        results.forEach(r => addLayer(r.name, r.fc));
        setStatus(file.name + ': ' + results.length + ' Ebene(n) geladen.');
      } else if (ext === 'geojson' || ext === 'json') {
        const text = await file.text();
        const geojson = JSON.parse(text);
        addLayer(file.name.replace(/\.\w+$/, ''), geojson);
        setStatus(file.name + ' geladen.');
      } else {
        showError(file.name + ': Format nicht unterstützt (erwartet .zip, .geojson, .json)');
      }
    } catch (err) {
      console.error(err);
      showError(file.name + ': Konnte Datei nicht lesen — ' + (err.message || 'unbekannter Fehler'));
      setStatus('Fehler beim Lesen von ' + file.name);
    }
  }
  fileInput.value = '';
}

// Rechnet rekursiv jede Koordinate eines GeoJSON-Geometrie-Objekts über eine
// Transformationsfunktion um — funktioniert unabhängig von der Verschachtelungs-
// tiefe (Point, LineString, Polygon, MultiPolygon, ...).
function reprojectCoords(coords, transformFn) {
  if (typeof coords[0] === 'number') {
    const [x, y] = transformFn(coords[0], coords[1]);
    return coords.length > 2 ? [x, y, coords[2]] : [x, y];
  }
  return coords.map(c => reprojectCoords(c, transformFn));
}

function reprojectGeometry(geom, transformFn) {
  if (!geom) return geom;
  if (geom.type === 'GeometryCollection') {
    return Object.assign({}, geom, { geometries: geom.geometries.map(g => reprojectGeometry(g, transformFn)) });
  }
  return Object.assign({}, geom, { coordinates: reprojectCoords(geom.coordinates, transformFn) });
}

// Errät die Textkodierung einer .dbf ohne begleitende .cpg-Datei: manche
// Bundesland-Exporte sind windows-1252 (Umlaute als Einzelbyte), andere UTF-8
// (Umlaute als Mehrbyte-Folge) — ein fest verdrahteter Default ist für die
// jeweils andere Gruppe garantiert falsch (kaputte Umlaute). Wir lesen daher
// nur den Datensatz-Teil (ohne Kopf) und prüfen, ob er als striktes UTF-8
// gültig ist; wenn nicht, war es windows-1252.
function detectDbfEncoding(dbfBuf) {
  const view = new DataView(dbfBuf);
  const headerLen = view.getUint16(8, true);
  const recordsBuf = dbfBuf.slice(headerLen);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(recordsBuf);
    return 'utf-8';
  } catch (err) {
    return 'windows-1252';
  }
}

// Entpackt ein Zip selbst (statt es blind an shp() zu übergeben) und gruppiert
// die enthaltenen Dateien anhand ihres gemeinsamen Basisnamens. So werden
// mehrere Shapefiles in einem Bundle sauber getrennt, fremde Dateien (z.B.
// .xlsx, .xml) werden ignoriert. Die Umprojektion nach WGS84 erfolgt explizit
// über proj4 anhand der jeweiligen .prj-Datei — nicht über das (unklar
// dokumentierte) automatische Verhalten von shp.parseShp().

function extractWktParam(wkt, name) {
  const m = wkt.match(new RegExp('PARAMETER\\["' + name + '"\\s*,\\s*(-?[0-9.]+)', 'i'));
  return m ? parseFloat(m[1]) : null;
}

// Manche .prj-Dateien nutzen noch das alte deutsche Vermessungssystem DHDN
// ("Deutsches Hauptdreiecksnetz", Bessel-1841-Ellipsoid, Gauß-Krüger) statt
// des heutigen ETRS89/UTM — und lassen dabei die nötigen Datums-Verschiebungs-
// parameter (TOWGS84) zu WGS84 weg. proj4 rechnet dann zwar die Gauß-Krüger-
// Projektion korrekt zurück, gleicht aber den Versatz zwischen den beiden
// Referenzellipsoiden NICHT aus — das ergibt einen systematischen Fehler von
// grob 100-150 Metern, genug um Flächen sichtbar zu verschieben (z.B. in
// Nachbargrundstücke/Wohngebiete). Wir erkennen das Datum am Namen und
// ergänzen die fehlende Transformation; ist bereits ein TOWGS84-Parameter in
// der WKT enthalten, übernimmt proj4 den ohnehin korrekt und wir fassen
// nichts an.
function resolveProjDefinition(prjText) {
  const wkt = prjText.trim();
  if (/towgs84/i.test(wkt)) return wkt;
  if (!/hauptdreiecksnetz|\bDHDN\b/i.test(wkt)) return wkt;

  const lon0 = extractWktParam(wkt, 'Central_Meridian') ?? 9;
  const x0 = extractWktParam(wkt, 'False_Easting') ?? 3500000;
  const y0 = extractWktParam(wkt, 'False_Northing') ?? 0;
  const k = extractWktParam(wkt, 'Scale_Factor') ?? 1;
  // 612.4,77.0,440.2,-0.054,0.057,-2.797,2.55: dieselben Helmert-Parameter,
  // die der Datenlieferant selbst in einer begleitenden .prj-Datei desselben
  // Datensatzes für EPSG:31466 angibt (siehe todo.txt) — kein generischer
  // Schätzwert, sondern die vom Anbieter für genau diese Region genannte
  // Transformation.
  return `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=${k} +x_0=${x0} +y_0=${y0} `
    + `+ellps=bessel +towgs84=612.4,77.0,440.2,-0.054,0.057,-2.797,2.55 +units=m +no_defs`;
}

// NRW liefert im Teilschläge-Shapefile (TS_*.dbf) weder Kulturart noch
// Größe (siehe FIELD_CANDIDATES-Kommentar oben) — beides steckt aber, wenn
// die Begleit-XML des Antragsprogramms im Zip liegt (Dateiname enthält
// "NTNW", data-experts-Format), direkt darin: die Kulturart sogar schon als
// fertiger Klartext ("459 - Grünland"), keine Code-Übersetzung nötig.
// Rückgabe: Map "SCHLAGNR_TEILSCHLAG" -> { kultur, groesseHa }.
async function extractNrwNutzungMap(entry) {
  try {
    const text = await entry.async('text');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    const map = new Map();
    doc.querySelectorAll('parzelle').forEach(p => {
      const schlagNr = p.querySelector('schlag > nummer')?.textContent?.trim();
      if (!schlagNr) return;
      const teilschlag = p.querySelector('teilschlag')?.textContent?.trim() || '';
      const bezRoh = p.querySelector('nutzungaj > bezeichnung')?.textContent?.trim() || '';
      const kultur = bezRoh.replace(/^\d+\s*-\s*/, '').trim(); // "459 - Grünland" -> "Grünland"
      const nettoflaeche = parseFloat(p.querySelector('nettoflaeche')?.textContent || '');
      if (!kultur) return;
      map.set(schlagNr + '_' + teilschlag, {
        kultur,
        groesseHa: isFinite(nettoflaeche) ? nettoflaeche / 10000 : null // m² -> ha
      });
    });
    return map.size ? map : null;
  } catch (err) {
    console.warn('Konnte NRW-Nutzungs-XML nicht lesen:', err.message);
    return null;
  }
}

function mergeNrwNutzung(results, nutzungMap) {
  results.forEach(r => {
    (r.fc.features || []).forEach(f => {
      const props = f.properties || {};
      if (!('SCHLAGNR' in props)) return;
      const key = String(props.SCHLAGNR).trim() + '_' + String(props.TEILSCHLAG || '').trim();
      const info = nutzungMap.get(key);
      if (!info) return;
      props.NCODE = info.kultur; // FIELD_CANDIDATES.kultur kennt "NCODE" bereits
      if (info.groesseHa != null) props.FLAECHE_HA = info.groesseHa; // FIELD_CANDIDATES-Größe kennt dieses Feld bereits
    });
  });
}

// Niedersachsens Teilschläge-Shapefile enthält nur OBJEKT_ID/FLIK/SCHLAG_NR
// — weder Name noch Kulturart. Der Hauptantrag (Sammelantrag-XML, ANDI/GELA-
// Exportformat, Dateiname = reine Betriebs-Registriernummer ohne erkennbares
// Präfix) enthält beides pro Schlag als Attribute, z.B.
// <schlag flik="..." nr="27" bezeichnung="Albers" kultur_fach_code="452" .../>.
// Da der Dateiname nicht zuverlässig erkennbar ist, wird stattdessen der
// INHALT jeder unbekannten .xml im Zip auf genau dieses Attributmuster
// geprüft — findet sich keins, bleibt die Datei einfach unberücksichtigt.
// kultur_fach_code ist wie in Bayern ein bundesweit einheitlich
// nummerierter Nutzungscode (Stichproben in den Testdaten stimmen mit der
// bayerischen FNN-Liste überein) — als Klartext-Fallback wird deshalb
// bewusst BAYERN_NUTZUNGSCODE_KLARTEXT verwendet statt einer eigens für
// Niedersachsen recherchierten Liste; unbekannte Codes bleiben roh stehen.
function extractNiedersachsenSchlagMap(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    const schlaege = doc.querySelectorAll('schlag[nr][kultur_fach_code]');
    if (!schlaege.length) return null;
    const map = new Map();
    schlaege.forEach(s => {
      const nr = s.getAttribute('nr');
      if (!nr) return;
      map.set(nr, {
        name: (s.getAttribute('bezeichnung') || '').trim(),
        code: (s.getAttribute('kultur_fach_code') || '').trim()
      });
    });
    return map.size ? map : null;
  } catch (err) {
    return null;
  }
}

function mergeNiedersachsenSchlaege(results, schlagMap) {
  results.forEach(r => {
    (r.fc.features || []).forEach(f => {
      const props = f.properties || {};
      if (!('SCHLAG_NR' in props)) return;
      const info = schlagMap.get(String(props.SCHLAG_NR).trim());
      if (!info) return;
      if (info.name) props.SCHLAGNAME = info.name; // FIELD_CANDIDATES.name kennt dieses Feld bereits
      if (info.code) {
        const klartext = bayernNutzungscodeKlartext(info.code);
        props.NCODE = klartext || info.code; // FIELD_CANDIDATES.kultur kennt "NCODE" bereits
      }
    });
  });
}

// Manche Bundesländer liefern den amtlichen FLIK-Flächenidentifikator gar
// nicht im Shapefile selbst (z.B. Brandenburgs Parzellen-DBF hat kein FLIK-
// Feld), sondern nur in der begleitenden "..._flaechenuebersicht.xlsx" —
// dort in einer Tabelle mit Spalten wie "Flik" und "Parzellennummer". Wir
// lesen diese Zuordnung aus und liefern eine Map Nummer -> FLIK zurück.
async function extractFlikMapFromWorkbook(entry) {
  if (typeof XLSX === 'undefined') return null;
  try {
    const buf = await entry.async('arraybuffer');
    const wb = XLSX.read(buf, { type: 'array' });
    const nummerKeys = ['Parzellennummer', 'Nummer', 'Schlagnummer', 'Flächennummer'];
    const flikKeys = ['Flik', 'FLIK', 'Flek', 'FLEK'];
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const nummerCol = cols.find(c => nummerKeys.includes(c));
      const flikCol = cols.find(c => flikKeys.includes(c));
      if (!nummerCol || !flikCol) continue;
      const map = new Map();
      rows.forEach(r => {
        const nummer = r[nummerCol];
        const flik = r[flikCol];
        if (nummer !== undefined && nummer !== null && flik) map.set(String(nummer).trim(), String(flik).trim());
      });
      if (map.size) return map;
    }
  } catch (err) {
    console.warn('Konnte Flächenübersicht-Excel nicht lesen:', err.message);
  }
  return null;
}

async function parseShapefileZip(file) {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const groups = {};
  let flaechenuebersichtEntry = null;
  let nrwNutzungXmlEntry = null;
  const otherXmlEntries = []; // Kandidaten für die Niedersachsen-Sammelantrag-XML (kein festes Namensmuster, siehe extractNiedersachsenSchlagMap)
  const relevantExt = ['shp', 'shx', 'dbf', 'prj', 'cpg'];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    // macOS packt beim Zippen oft einen __MACOSX/-Ordner mit ._-Metadaten-
    // Schattendateien für jede echte Datei mit rein — keine echten Shapefile-
    // Bestandteile, würden aber sonst als kaputte Fake-Ebene versucht.
    if (path.startsWith('__MACOSX/')) return;
    const fileName = path.split('/').pop();
    if (fileName.startsWith('._')) return;
    const dot = fileName.lastIndexOf('.');
    if (dot === -1) return;
    const base = fileName.slice(0, dot);
    const ext = fileName.slice(dot + 1).toLowerCase();
    if (ext === 'xlsx' && /flaechenuebersicht/i.test(fileName)) flaechenuebersichtEntry = entry;
    if (ext === 'xml') {
      if (/NTNW/i.test(fileName)) nrwNutzungXmlEntry = entry;
      else otherXmlEntries.push(entry);
    }
    if (!relevantExt.includes(ext)) return; // .xlsx, .xml usw. werden übersprungen
    groups[base] = groups[base] || {};
    groups[base][ext] = entry;
  });

  const results = [];
  for (const base of Object.keys(groups)) {
    const g = groups[base];
    if (!g.shp) continue; // ohne .shp keine Geometrie
    try {
      const shpBuf = await g.shp.async('arraybuffer');
      // Rohgeometrien im Quell-Koordinatensystem, KEINE automatische Umprojektion
      const rawGeometries = shp.parseShp(shpBuf);

      let geometries = rawGeometries;
      if (g.prj) {
        const prjText = await g.prj.async('text');
        try {
          const converter = proj4(resolveProjDefinition(prjText), 'WGS84');
          geometries = rawGeometries.map(geom =>
            geom ? reprojectGeometry(geom, (x, y) => converter.forward([x, y])) : geom
          );
        } catch (projErr) {
          console.error('Projektionsfehler in', base, projErr);
          showError(base + ': Projektion aus .prj konnte nicht angewendet werden — Lage evtl. falsch.');
        }
      } else {
        showError(base + ': keine .prj gefunden — Koordinaten werden unverändert übernommen, Lage kann falsch sein.');
      }

      let properties = [];
      if (g.dbf) {
        const dbfBuf = await g.dbf.async('arraybuffer');
        const cpgText = g.cpg ? (await g.cpg.async('text')).trim() : detectDbfEncoding(dbfBuf);
        properties = shp.parseDbf(dbfBuf, cpgText);
      }

      const fc = shp.combine([geometries, properties]);
      results.push({ name: base, fc });
    } catch (err) {
      console.error('Fehler in Ebene', base, err);
      showError(base + ': Ebene konnte nicht gelesen werden — ' + (err.message || 'unbekannter Fehler'));
    }
  }

  if (flaechenuebersichtEntry) {
    const flikMap = await extractFlikMapFromWorkbook(flaechenuebersichtEntry);
    if (flikMap) {
      const parzellenResult = results.find(r => /parzelle|schlag|feldst(ü|ue)ck/i.test(r.name));
      if (parzellenResult) {
        (parzellenResult.fc.features || []).forEach(f => {
          const props = f.properties || {};
          if (pickField(props, FIELD_CANDIDATES.flaechenid)) return; // schon vorhanden, nicht überschreiben
          const nummer = pickField(props, FIELD_CANDIDATES.nummer);
          const flik = nummer && flikMap.get(nummer);
          if (flik) props.FLIK = flik;
        });
      }
    }
  }

  if (nrwNutzungXmlEntry) {
    const nutzungMap = await extractNrwNutzungMap(nrwNutzungXmlEntry);
    if (nutzungMap) mergeNrwNutzung(results, nutzungMap);
  }

  // Niedersachsen-Sammelantrag-XML hat kein festes Namensmuster — jede
  // übrige .xml im Zip auf das erkennbare <schlag nr=... kultur_fach_code=...>
  // -Muster prüfen; die erste passende gewinnt.
  for (const entry of otherXmlEntries) {
    let text;
    try { text = await entry.async('text'); } catch (err) { continue; }
    const schlagMap = extractNiedersachsenSchlagMap(text);
    if (schlagMap) { mergeNiedersachsenSchlaege(results, schlagMap); break; }
  }

  // Bundesland-spezifische Nutzungscodes zuletzt übersetzen, nachdem alle
  // XML-Anreicherungen oben (die z.T. selbst erst NCODE befüllen) gelaufen
  // sind.
  results.forEach(r => {
    (r.fc.features || []).forEach(f => applyBundeslandNutzungscode(f.properties || {}));
  });

  return results;
}

// Amtliche Codierungsliste für das bayerische Flächen- und Nutzungsnachweis
// (FNN) 2022 (Stand: Februar 2022, iBALIS) — Nutzungscode (NC) -> Kulturart
// im Klartext. Nur für Bayern gültig: andere Bundesländer verwenden eigene
// Nutzungscode-Systematiken, die NICHT mit dieser Liste kompatibel sind
// (siehe mergeFeldstueckNutzung(), wo diese Tabelle ausschließlich auf das
// Bayern-spezifische "Feldstueck"+"Nutzung"-Format angewendet wird).
// Schlüssel bewusst ohne führende Nullen (siehe bayernNutzungscodeKlartext).
const BAYERN_NUTZUNGSCODE_KLARTEXT = {
  112: 'Winterdurum (Hartweizen)', 113: 'Sommerdurum (Hartweizen)',
  114: 'Winterdinkel', 120: 'Sommerdinkel',
  115: 'Winterweizen (Weichweizen)', 116: 'Sommerweizen (Weichweizen)',
  118: 'Winteremmer, Wintereinkorn', 119: 'Sommeremmer, Sommereinkorn',
  121: 'Winterroggen, Winter-Waldstaudenroggen', 122: 'Sommerroggen, Sommer-Waldstaudenroggen',
  125: 'Wintermenggetreide mit Weizen', 126: 'Wintermenggetreide ohne Weizen',
  131: 'Wintergerste', 132: 'Sommergerste',
  142: 'Winterhafer', 143: 'Sommerhafer',
  144: 'Sommermenggetreide mit Weizen', 145: 'Sommermenggetreide ohne Weizen',
  156: 'Wintertriticale', 157: 'Sommertriticale',
  171: 'Körnermais',
  181: 'Rispenhirse (Panicum), Rutenhirse', 182: 'Buchweizen',
  183: 'Sorghumhirse (Körnersorghum)', 186: 'Amarant (Fuchsschwanz)',
  187: 'Quinoa (Gänsefuß-Arten)', 188: 'Reis im Trockenanbau',
  210: 'Erbsen', 220: 'Ackerbohnen', 221: 'Wicken', 230: 'Lupinen',
  240: 'Gemenge Erbsen/Bohnen', 250: 'Gemenge Leguminosen mit Stützfrucht',
  292: 'Linsen (Speiselinse)', 330: 'Sojabohnen',
  311: 'Winterraps', 312: 'Sommerraps', 315: 'Winterrübsen', 316: 'Sommerrübsen',
  320: 'Sonnenblumen', 341: 'Öllein, Faserflachs',
  392: 'Krambe, Echter Meerkohl', 393: 'Leindotter', 512: 'Iberischer Drachenkopf',
  411: 'Silomais', 412: 'Gemenge mit Silomais', 413: 'Runkelrübe, Futterrübe',
  414: 'Kohl-, Steckrüben', 421: 'Klee', 422: 'Kleegras, Klee-/Luzernegras-Gemisch',
  423: 'Luzerne', 424: 'Ackergras', 425: 'Klee-Luzerne-Gemisch',
  428: 'Wechselgrünland', 429: 'Sonstige Futterpflanze',
  430: 'Esparsette, Serradella kleinkörnig',
  441: 'Grünlandeinsaat – Wiesen', 442: 'Grünlandeinsaat – Mähweiden', 443: 'Grünlandeinsaat – Weiden',
  451: 'Wiesen (einschl. Streuobstwiesen)', 452: 'Mähweiden', 453: 'Weiden',
  454: 'Hutungen (Futternutzung)', 455: 'Anerkannte Almen, Alpen',
  458: 'Streuwiesen (Streu-/Futternutzung)', 460: 'Sommerweiden für Wanderschafe',
  545: 'Stillgelegte Ackerflächen nach FELEG', 546: 'Stillgelegte Dauergrünlandflächen nach FELEG',
  560: 'Stillgelegte Ackerflächen i. R. von AUM',
  564: 'Aufgeforstete Acker-/Grünlandflächen nach Art. 32 VO(EU) 1307/2013',
  567: 'Stillgelegte Dauergrünlandflächen i. R. von AUM',
  583: 'Nicht landwirtschaftliche Fläche aufgrund Maßnahme gem. Natura 2000 oder Wasserrahmenrichtlinie',
  590: 'Brache mit Einsaat von einjährigen Blühmischungen',
  591: 'Ackerland aus der Erzeugung genommen', 592: 'Dauergrünland aus der Erzeugung genommen',
  844: 'Unbestockte Rebflächen',
  54: 'Beihilfefähige Ackerstreifen an Waldrändern (ÖVF)',
  57: 'Pufferstreifen und Feldrand auf Dauergrünland (ÖVF)',
  58: 'Pufferstreifen und Feldrand auf Ackerland (ÖVF)',
  59: 'Niederwald mit Kurzumtrieb – KUP (ÖVF)',
  61: 'Aufgeforstete Acker-/Grünlandflächen nach Art. 32 VO(EU) 1307/2013 (ÖVF)',
  62: 'Brachliegende Flächen (ÖVF)', 63: 'Chinaschilf (Miscanthus) (ÖVF)',
  64: 'Silphium (Durchwachsene Silphie) (ÖVF)',
  65: 'Brache mit Honigpflanzen – einjährig (ÖVF)', 66: 'Brache mit Honigpflanzen – mehrjährig (ÖVF)',
  601: 'Stärkekartoffeln', 602: 'Kartoffeln', 603: 'Zuckerrüben', 604: 'Topinambur', 605: 'Süßkartoffel',
  802: 'Silphium (Durchwachsene Silphie)', 803: 'Sudangras', 804: 'Sida (Virginiamalve)', 805: 'Igniscum',
  852: 'Chinaschilf (Miscanthus)', 853: 'Riesenweizengras (Szarvasigras)', 854: 'Rohrglanzgras',
  866: 'Pflanzenmischung mit Hanf', 870: 'Energiepflanzen im Mischanbau', 871: 'Energieblühmischungen ohne Hanf',
  822: 'Streuobstanlage (ohne Wiesen-/Ackernutzung)', 825: 'Kernobst, z.B. Äpfel, Birnen',
  826: 'Steinobst, z.B. Kirschen, Pflaumen',
  827: 'Beerenobst, z.B. Johannis-, Stachel-, Heidel- und Himbeeren',
  829: 'Sonstige Obstanlagen (z.B. Holunder, Sanddorn)',
  833: 'Haselnüsse', 834: 'Walnüsse', 835: 'Sonstige Schalenfrüchte', 838: 'Baumschulen (nicht für Beerenobst)',
  841: 'Niederwald mit Kurzumtrieb (KUP)', 843: 'Bestockte Rebfläche', 845: 'Rebschule',
  848: 'Tafeltrauben', 850: 'Sonstige Dauerkulturen', 851: 'Rhabarber', 856: 'Hopfen',
  860: 'Spargel', 861: 'Artischocke', 865: 'Trüffel',
  766: 'Pfingstrosen/Päonien (Gemeine Pfingstrose, Strauch-Pfingstrose)',
  912: 'Samenvermehrung für Gras gem. Saatgutverkehrsgesetz oder Erhaltungsmischungsverordnung',
  914: 'Kleinparzellen auf Ackerland',
  921: 'Samenvermehrung für Klee gem. Saatgutverkehrsgesetz oder Erhaltungsmischungsverordnung (ÖVF)',
  922: 'Samenvermehrung für Luzerne gem. Saatgutverkehrsgesetz oder Erhaltungsmischungsverordnung (ÖVF)',
  920: 'Nicht landw. genutzte Haus- und Nutzgärten',
  930: 'Bewirtschaftete Teichflächen', 940: 'Nicht bewirtschaftete Teichflächen',
  941: 'Grünbrache im ökologischen Landbau (Hauptfutterfläche)',
  958: 'Naturschutzflächen (keine landwirtschaftliche Verwertung)',
  983: 'Christbaumkulturen außerhalb des Waldes',
  990: 'Maximal 3 Jahre nichtlandwirtschaftlich genutzte Fläche (z.B. Holzlager)',
  994: 'Landwirtschaftliche Lagerung (max. 3 Jahre) auf Dauergrünland',
  996: 'Landwirtschaftliche Lagerung (max. 3 Jahre) auf Ackerland',
  690: 'Sammelcode Samenvermehrung von Wildkräutern',
  610: 'Sammelcode Gemüse', 611: 'Sammelcode Gemüse-Kreuzblütler', 612: 'Schwarzer Senf',
  613: 'Gemüsekohl (Kopfkohl, Wirsing, Rot-/Weißkohl, Spitzkohl, Grünkohl, Kohlrabi, Markstammkohl, Blumenkohl, Romanesco, Brokkoli, Rosenkohl, Zierkohl)',
  614: 'Brauner Senf (Brauner Senf/Sareptasenf)', 615: 'Brunnenkresse',
  616: 'Senfrauke (Garten-Senfrauke, Rucola)', 617: 'Gartenkresse',
  618: 'Gartenrettiche (Weiße/Rote Rettiche, Ölrettich, Radieschen)', 619: 'Weißer Senf; Gelber Senf',
  621: 'Sammelcode Gemüse-Nachtschattengewächse', 622: 'Tomaten', 623: 'Auberginen',
  624: 'Spanischer Pfeffer (Paprika, Chilli, Peperoni)', 625: 'Schwarze Tollkirsche',
  626: 'Sammelcode Gemüse-Kürbisgewächse', 627: 'Salatgurke (Gurke, Salatgurke, Einlegegurke)',
  628: 'Zuckermelone (Cucumis melo)', 629: 'Riesenkürbis (Riesenkürbis, Hokkaidokürbis)',
  630: 'Gartenkürbis (Cucurbita pepo) (Gartenkürbis, Steirischer Kürbis, Zucchini, Spaghettikürbis, Zierkürbis)',
  631: 'Melone (Citrullus, Wassermelone)',
  632: 'Sammelcode andere Gemüsearten – auch zur Samenvermehrung',
  633: 'Zwiebel (Speisezwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Winterheckenzwiebel, Bärlauch)',
  634: 'Möhre (Möhre/Karotte, Futtermöhre)',
  635: 'Gartenbohne (Garten-, Busch-, Stangen-, Feuer-, Prunkbohne) (ÖVF)',
  636: 'Feldsalate (Feldsalat/Ackersalat/Rapunzel)',
  637: 'Lattich (Garten-Salat/Lattich, Lollo Rosso, Romana-Salat/Römischer Salat)',
  638: 'Spinat', 639: 'Mangold, Rote Beete/Rote Rübe', 640: 'Melde (Garten-Melde)',
  641: 'Sellerie (Knollen-Sellerie, Bleich-Sellerie, Stangen-Sellerie)',
  642: 'Ampfer (Wiesen-Sauerampfer)', 643: 'Pastinaken',
  644: 'Zichorien/Wegwarten (Chicoree, Radicchio, krausblättrige Endivie, ganzblättrige Endivie, Zichorie)',
  645: 'Kichererbsen', 646: 'Meerrettich', 647: 'Schwarzwurzeln',
  648: 'Fenchel (Gemüsefenchel/Körnerfenchel)',
  650: 'Sammelcode Küchenkräuter, Heil- und Gewürzpflanzen',
  651: 'Anethum (Dill, Gurkenkraut)', 652: 'Kerbel (Kerbel/echter Kerbel, Wiesenkerbel)',
  653: 'Bibernellen (Anis)', 654: 'Kümmel (Echter Kümmel)', 655: 'Kreuzkümmel (Echter Kreuzkümmel)',
  656: 'Schwarzkümmel (Echter Schwarzkümmel, Jungfer im Grünen)', 657: 'Koriander',
  658: 'Liebstöckel/Maggikraut', 659: 'Petroselinum (Petersilie)', 660: 'Basilikum', 661: 'Rosmarin',
  662: 'Salbei (Küchen-, Heilsalbei, Buntschopf-Salbei)', 663: 'Borretsch',
  664: 'Oregano (Echter Majoran, Oregano/Dost/Wilder Majoran)', 665: 'Bohnenkräuter',
  666: 'Hyssopus (Ysop/Eisenkraut)', 667: 'Verbenen (Echtes Eisenkraut)',
  668: 'Lavendel (Echter Lavendel, Speik-Lavendel, Hybrid-Lavendel)',
  669: 'Thymiane (Thymian, Gartenthymian, Echter Thymian)', 670: 'Melissen (Zitronenmelisse)',
  671: 'Enziane', 672: 'Minzen (Pfefferminze, Grüne Minze)', 673: 'Artemisia (Wermut, Estragon, Beifuß)',
  674: 'Ringelblumen (Garten-Ringelblume)',
  675: 'Sonnenhut (Schmalblättriger Sonnenhut, Purpur-Sonnenhut)', 676: 'Wegeriche (Spitzwegerich)',
  677: 'Kamillen (Echte Kamille)', 678: 'Schafgarben (Gelbe Schafgarbe)', 679: 'Baldriane (Echter Baldrian)',
  680: 'Johanniskräuter (Echtes Johanniskraut)', 681: 'Frauenmantel', 682: 'Mariendisteln',
  683: 'Galega (Geißraute)', 684: 'Löwenzahn',
  685: 'Engelwurzen (Arznei-Engelwurz, Echter Engelwurz)', 686: 'Malven (Wilde Malve)', 687: 'Arnika',
  701: 'Hanf', 702: 'Rollrasen, Vegetationsmappen für Dachbegrünung', 703: 'Färber-Waid',
  704: 'Glanzgräser (Kanariensaat/Echtes Glanzgras)', 705: 'Virginischer Tabak',
  706: 'Mohn (Schlaf-, Back-, Klatschmohn)', 707: 'Erdbeeren', 708: 'Färberdisteln',
  709: 'Brennnesseln (Gr. Brennnessel)', 777: 'Phacelia zur Samenvermehrung',
  720: 'Sammelcode Zierpflanzen – auch zur Samenvermehrung', 520: 'Silberbrandschopf (Hahnenkamm)',
  721: 'Goldlack', 722: 'Einjähriges Silberblatt', 723: 'Garten-/Sommerlevkoje',
  724: 'Kugelamarant (Echter Kugelamarant)', 725: 'Taglilien (Essbare Taglilie)',
  726: 'Lilien (Türkenbund)', 727: 'Narzissen/Osterglocken', 728: 'Knorpelmöhren (Bischofskraut)',
  729: 'Hasenohren (rundblättriges Hasenohr)', 730: 'Seidenpflanzen (Indianer-Seidenpflanze)',
  731: 'Hyazinthe (Garten-Hyazinthe)', 732: 'Milchstern (Kap-Milchstern)', 733: 'Astern (Sommeraster)',
  734: 'Chrysanthemen (Garten-Chrysantheme, Winteraster)', 735: 'Strohblumen (Garten-Strohblume)',
  736: 'Edelweiß (Alpen-Edelweiß)', 737: 'Margeriten',
  738: 'Rudbeckien (Schwarzäugige Rudbeckie/Sonnenhut, Leuchtender Sonnenhut, Schlitzblättriger Sonnenhut)',
  739: 'Tagetes (Aufrechte Studentenblume, Tagetes patula, Tagetes tenuifolia)',
  740: 'Wucherblumen (Mutterkraut)', 741: 'Strandflieder (Geflügelter Strandflieder)',
  742: 'Spreublumen (Einjährige Papierblume)', 743: 'Zinnien', 744: 'Taubnesseln (Weiße Taubnessel)',
  745: 'Gladiolen (Gartengladiole)', 746: 'Tulpen (Garten-Tulpe)',
  747: 'Christophskräuter (Trauben-Silberkerze)', 748: 'Feldrittersporne (Gewöhnlicher Feldrittersporn)',
  749: 'Scabiosen (Samt-Skabiose, Kugel-Skabiose)', 750: 'Dahlien (Garten-Dahlie)',
  751: 'Rodiola (Rosenwurz)', 752: 'Krokusse (Safran, Garten-Krokus)',
  753: 'Hibiskus (Chinesischer Roseneibisch)', 754: 'Strauch-/Bechermalven',
  755: 'Wolfsmilch (Weißrand-Wolfsmilch)', 756: 'Löwenmäulchen (Großes Löwenmaul)',
  757: 'Montbretien (Garten-Montbretie)', 758: 'Halskräuter (Blaues Halskraut)',
  759: 'Gipskräuter (Schleierkraut)', 760: 'Pampasgräser (Amerikanisches Pampasgras)',
  761: 'Kosmeen (Gemeines Schmuckkörbchen)', 762: 'Nachtkerzen (Diptam)',
  763: 'Oenothera/Nachtkerzen (Gewöhnliche Nachtkerze)', 764: 'Königskerzen (Großblütige Königskerze)',
  765: 'Kapuzinerkressen (Große Kapuzinerkresse)', 767: 'Schwertlilien (Deutsche Schwertlilie)',
  768: 'Wiesenknopf (Kleiner Wiesenknopf, Pimpinelle)', 769: 'Zieste (Deutscher Ziest)',
  770: 'Vergissmeinnicht (Wald-Vergissmeinnicht)', 771: 'Portulak',
  772: 'Nelken (Bartnelke, Land-/Edelnelke)', 773: 'Ageratum (Gewöhnlicher Leberbalsam)',
  774: 'Lonas (Gelber Leberbalsam)', 775: 'Kornblumen',
  776: 'Veilchen (Horn-Veilchen, Garten-Stiefmütterchen, Wildes Stiefmütterchen)',
  790: 'Anemonen (Herbstanemone, Japanische Anemone)', 796: 'Fetthenne, Mauerpfeffer (Sedum)',
  798: 'Ramtillkraut', 970: 'Sonstige Ackerkultur (nicht in dieser Liste enthalten)'
};

// Wandelt einen bayerischen Nutzungscode (als Zahl oder String, mit oder
// ohne führende Nullen) in die Kulturart im Klartext um — null, falls der
// Code nicht in der Liste steht (z.B. weil er in Wahrheit schon ein anderer
// Wert ist, siehe Aufrufer).
function bayernNutzungscodeKlartext(rawCode) {
  const n = parseInt(String(rawCode).trim(), 10);
  if (!isFinite(n)) return null;
  return BAYERN_NUTZUNGSCODE_KLARTEXT[n] || null;
}

// ---------- Weitere Bundesländer: Nutzungscode -> Kulturart im Klartext ----------
// Baden-Württemberg, Stand 06.03.2026.
// Quelle: https://www.rv.de/site/LRA_RV_Responsive/get/documents_E1338061234/chancenpool/LRA_Ravensburg_Objekte/01-Ihr%20Anliegen/Land-%20und%20Forstwirtschaft/LA%20Agrarf%C3%B6rderung/2026%20GA%20-%20Nutzcodeliste.pdf
const BW_NUTZUNGSCODE_KLARTEXT = {
  10: 'Zuckermais', 20: 'Koppelschafweiden',
  30: 'Hof-, Wege- und Gebäudeflächen', 40: 'Konditionalitäts-Landschaftselement',
  43: 'Kulturen in Substrat/ ohne Bodenkontakt', 49: 'Unbestockte Obstbaufläche',

  112: 'Winterdurum (Hartweizen)', 113: 'Sommerdurum (Hartweizen)',
  114: 'Winterdinkel', 115: 'Winterweichweizen',
  116: 'Sommerweichweizen', 118: 'Winteremmer/-einkorn',
  119: 'Sommeremmer/-einkorn', 120: 'Sommerdinkel',
  121: 'Winterroggen', 122: 'Sommerroggen',
  125: 'Wintermenggetreide', 131: 'Wintergerste', 132: 'Sommergerste',
  142: 'Winterhafer', 143: 'Sommerhafer', 144: 'Sommermenggetreide',
  156: 'Wintertriticale', 157: 'Sommertriticale',
  171: 'Körnermais (CCM)',
  181: 'Rispenhirse', 182: 'Buchweizen', 183: 'Sorghumhirse (Körnersorghum)',
  184: 'Kolbenhirse', 186: 'Amarant (Fuchsschwanz)', 187: 'Quinoa', 189: 'Chia',

  210: 'Sommer-Erbsen zur Körnergewinnung',
  211: 'Sommer-Gemüseerbse (Markerbse, Schalerbse, Zuckererbse)',
  212: 'Platterbse',
  213: 'Winter-Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  220: 'Ackerbohne/Puffbohne/Pferdebohne/Dicke Bohne',
  221: 'Wicken (Pannonische, Zottel-, Saatwicke)',
  222: 'Linsen (Speiselinse)', 230: 'Lupinen',
  240: 'Erbsen/Bohnen-Gemenge',
  250: 'Gemenge Leguminosen/Getreide (Leguminose überwiegt)',

  311: 'Winterraps', 312: 'Sommerraps',
  315: 'Winterrübsen (Rübsen, Rübsamen, Rübsaat)',
  316: 'Sommerrübsen (Rübsen, Rübsamen, Rübsaat)',
  320: 'Sonnenblumen', 330: 'Sojabohnen',
  341: 'Lein (Gemeiner Lein, Flachs)', 393: 'Leindotter',

  411: 'Silomais/Silomais-Gemenge', 413: 'Futterrüben (Runkelrüben)',
  421: 'Rot-/Weiß-/Alexandriner-/Inkarnat-/Erd-/Schweden-/Persischer Klee',
  422: 'Kleegras, Luzerne-Gras-Gemenge',
  423: 'Luzerne, Hopfen-/Gelbklee, Bastard-/Sandluzerne',
  424: 'Ackergras', 425: 'Klee-Luzerne-Gemisch',
  426: 'Bockshornklee, Schabziger Klee', 427: 'Hornklee, Hornschotenklee',
  429: 'Esparsette', 430: 'Serradella', 431: 'Steinklee',
  432: 'Kleemischung aus NC 421, 427, 431',
  434: 'Gras-Leguminosen-Gemisch (Leguminose überwiegt)',
  441: 'Wiesen (Grünlandneueinsaat weniger als 5 Jahre zurückliegend)',
  442: 'Mähweiden (Grünlandneueinsaat weniger als 5 Jahre zurückliegend)',
  443: 'Weiden (Grünlandneueinsaat weniger als 5 Jahre zurückliegend)',

  451: 'Wiesen (einschl. Streuobstwiesen)', 452: 'Mähweiden', 453: 'Weiden',
  454: 'Hutungen', 455: 'Almen und Alpen', 458: 'Streuwiesen',
  460: 'Sommerschafweiden', 481: 'Streuobst ohne Wiesennutzung',
  492: 'Weidegebiete als Teil eines etablierten lokalen Bewirtschaftungsverfahrens',

  513: 'Braunelle',

  563: 'Stillgelegte Ackerflächen nach LPR',
  567: 'Stillgelegte Dauergrünlandflächen n. LPR',
  575: 'Blühfläche (nur FAKT E8)',
  584: 'aus ehemals DZ-fähiger Fläche durch Natura 2000-Auflagen entstandene nicht landwirtschaftliche Fläche',
  585: 'aus ehemals DZ-fähiger Fläche durch WRRL-Auflagen entstandene nicht landwirtschaftliche Fläche',
  587: 'Landw. Fläche im Paludianbau ohne landw. Erzeugung',
  590: 'Brache mit jährlicher Neueinsaat von Blühmischungen (nur FAKT E7)',
  591: 'Ackerland aus der Erzeugung genommen',
  592: 'Dauergrünland aus der Erzeugung genommen',
  593: 'Dauerkultur aus der Erzeugung genommen',

  601: 'Stärkekartoffeln', 602: 'Speisekartoffeln', 603: 'Zuckerrüben',
  604: 'Topinambur', 605: 'Süßkartoffeln', 606: 'Pflanzkartoffeln',
  610: 'beetweiser Anbau v. Gemüse ab 5 Kulturen',
  611: 'beetweiser Anbau v. Gemüse bis 4 Kulturen',
  613: 'Gemüsekohl', 615: 'Brunnenkresse',
  616: 'Senfrauke (Garten-Senfrauke, Rucola)', 617: 'Gartenkresse',
  618: 'Gartenrettiche (Weiße/rote Rettiche, Ölrettich, Radieschen)',
  619: 'Weißer Senf, Gelber Senf',
  620: 'Gemüseraps (Raps, Steckrübe, Kohlrübe)',
  622: 'Tomaten', 623: 'Auberginen',
  624: 'Spanischer Pfeffer einschl. Paprika, Chilli, Peperoni',
  625: 'Schwarze Tollkirsche', 627: 'Salatgurke', 628: 'Zuckermelone',
  629: 'Riesenkürbis', 630: 'Gartenkürbis einschl. Zucchini und Zierkürbis',
  631: 'Melone',
  632: 'Winterlauch (Zwiebel einschl. Knoblauch, Lauch, Schnittlauch und Bärlauch)',
  633: 'Sommerlauch (Zwiebel einschl. Knoblauch, Lauch, Schnittlauch und Bärlauch)',
  634: 'Möhre', 635: 'Gartenbohne',
  636: 'Feldsalate einschl. Ackersalat und Rapunzel',
  637: 'Salat/Lattich, Lollo Rosso, Romana-Salat/Römischer Salat',
  638: 'Spinat', 639: 'Mangold, Rote Beete/Rote Rübe',
  641: 'Sellerie', 642: 'Ampfer (Wiesen-Sauerampfer)', 643: 'Pastinaken',
  644: 'Zichorien/Wegwarten (Chicorée, Radicchio, krausblättrige Endivie, ganzblättrige Endivie, Zichorie)',
  645: 'Kichererbsen', 646: 'Meerrettich', 647: 'Schwarzwurzeln',
  648: 'Fenchel (Gemüse-/Körnerfenchel)', 649: 'Gemüserübsen',
  650: 'beetweiser Anbau von Küchenkräutern/ Heil- und Gewürzpflanzen ab 5 Kulturen',
  651: 'Dill, Gurkenkraut',
  652: 'Kerbel (Kerbel/echter Kerbel, Wiesenkerbel)',
  653: 'Anis', 654: 'Kümmel (Echter Kümmel)', 656: 'Schwarzkümmel',
  657: 'Koriander', 658: 'Liebstöckel/Maggikraut', 659: 'Petersilie',
  660: 'Basilikum', 661: 'Rosmarin', 662: 'Salbei',
  664: 'Oregano, Majoran', 665: 'Bohnenkraut',
  667: 'Verbenen (Echtes Eisenkraut)', 668: 'Lavendel', 669: 'Thymian',
  670: 'Melissen (Zitronenmelisse)', 672: 'Minzen (Pfefferminze, Grüne Minze)',
  673: 'Artemisia (Wermut, Estragon, Beifuß)',
  674: 'Ringelblumen (Garten-Ringelblume)',
  675: 'Sonnenhut', 676: 'Wegeriche (Spitzwegerich)',
  677: 'Kamillen (Echte Kamille)', 678: 'Schafgarben (Gelbe Schafgarbe)',
  680: 'Johanniskräuter (Echtes Johanniskraut)', 682: 'Mariendisteln',
  684: 'Löwenzahn', 685: 'Engelwurz', 686: 'Malven (Wilde Malve)',
  690: 'beetweiser Anbau von Küchenkräutern/ Heil- und Gewürzpflanzen bis 4 Kulturen',

  701: 'Hanf', 702: 'Rollrasen', 705: 'Tabak',
  706: 'Mohn (Schlafmohn, Backmohn)', 707: 'Erdbeeren',
  708: 'Färberdistel/Saflor', 709: 'Brennnesseln',
  718: 'beetweiser Anbau von Zierpflanzen bis 4 Kulturen',
  720: 'beetweiser Anbau von Zierpflanzen ab 5 Kulturen',
  727: 'Narzissen / Osterglocken', 737: 'Margeriten',
  745: 'Gladiolen (Gartengladiole)', 746: 'Tulpen (Garten-Tulpe)',
  749: 'Scabiosen (Samt-, Kugel-Skabiose)', 750: 'Dahlien (Garten-Dahlie)',
  764: 'Königskerzen (Großblütige Königskerze)',
  766: 'Pfingstrosen/Päonien (Gemeine Pfingstrose, Strauch-Pfingstrose)',
  772: 'Nelken (Bartnelke, Land-/Edelnelke)', 775: 'Kornblumen',
  777: 'Phacelia (als Hauptkultur, z.B. Saatgutvermehrung)',
  788: 'Geranien', 793: 'Leimkraut/Taubenkropf-Leimkraut',
  796: 'Fetthenne, Mauerpfeffer (Sedum)', 798: 'Ramtillkraut',

  801: 'Sonstige Energiepflanze (Acker)',
  802: 'Silphium (Durchwachsene Silphie)', 803: 'Sudangras',
  804: 'Virginiamalve (Sida)', 805: 'Staudenknöterich (Igniscum)',
  821: 'Kern- und Steinobst (Mischanbau)', 825: 'Kernobst z.B. Äpfel, Birnen',
  826: 'Steinobst z.B. Kirschen, Pflaumen',
  827: 'Beerenobst z.B. Johannis-, Stachel-, Himbeeren',
  829: 'Sonstige Obstanlagen z.B. Holunder, Sanddorn',
  833: 'Haselnüsse', 834: 'Walnüsse', 835: 'sonstige Schalenfrüchte',
  838: 'Baumschulen, nicht für Beerenobst',
  839: 'Beerenobst zur Vermehrung (in Baumschulen)',
  841: 'Niederwald mit Kurzumtrieb (KUP lt. GAPDZV)',
  843: 'Bestockte Rebfläche', 844: 'Unbestockte Rebfläche',
  845: 'Rebschulfläche', 848: 'Tafeltrauben', 850: 'Sonstige Dauerkulturen',
  851: 'Rhabarber', 852: 'Chinaschilf (Miscanthus)',
  853: 'Riesenweizengras (Szarvasi-Gras)', 854: 'Rohrglanzgras',
  856: 'Hopfen', 859: 'Hopfen, vorübergehend stillgelegt',
  860: 'Spargel', 861: 'Artischocke', 865: 'Trüffel',
  866: 'Pflanzenmischung mit Hanf',
  871: 'Wildpflanzenmischung zur Energieerzeugung (FAKT E14)',

  912: 'Grassamenvermehrung', 913: 'Wildpflanzenvermehrung',
  914: 'Versuchsflächen mit mehreren beihilfefähigen Kulturarten',
  915: 'Ackerrandstreifen', 917: 'Mischkulturen',
  920: 'Haus- und Nutzgarten',
  925: 'Biotope mit landwirtschaftlicher Nutzung Dauergrünland',
  927: 'Flächen mit LPR-Verpflichtung auf nichtlandwirtschaftlicher Fläche',
  930: 'Bewirtschaftete Gewässer/ Teichflächen',

  961: 'Flächen mit LPR-Pflegeverpflichtung auf landwirtschaftlicher Fläche (nur bei LPR-Code 309)',
  982: 'Sonstige KUP', 983: 'Weihnachtsbäume',
  990: 'Alle anderen Flächen (keine LF)',
  994: 'Unbefestigte Mieten-, Stroh-, Futter-, Dunglager- und Maschinenstellplätze auf DGL',
  995: 'Forstflächen (Waldbodenflächen)',
  996: 'Unbefestigte Mieten-, Stroh-, Futter-, Dunglager- und Maschinenstellplätze auf AL'
};

// Sachsen, Stand 06.03.2026.
// Quelle: https://www.landwirtschaft.sachsen.de/download/SN26_FV_NC.pdf
const SACHSEN_NUTZUNGSCODE_KLARTEXT = {
  // NC 70-78: bundesweit einheitliche Konditionalitäts-Landschaftselemente (GLÖZ 8),
  // fehlen in der Sachsen-eigenen NC-Liste (dort separat geführt), tauchen aber in
  // Sachsen-Schlägen auf — Klartext hier aus der Hessen-Liste übernommen (gleiche Codes/Bezeichnungen).
  70: 'Hecken oder Knicks >10m', 71: 'Baumreihe >50m',
  72: 'Feldgehölze 50 - 2.000 m²', 73: 'Feuchtgebiete < 2.000 m²',
  74: 'Einzelbäume', 75: 'Tümpel, Sölle und Doline',
  76: 'Natur-, Stein- oder Trockenmauer', 77: 'Fels- und Steinriegel, naturversteinte Fläche',
  78: 'Feldraine',
  112: 'Winterdurum (Hartweizen)', 113: 'Sommerdurum (Hartweizen)',
  114: 'Winter-Dinkel', 115: 'Winterweichweizen',
  116: 'Sommerweichweizen', 118: 'Winter-Emmer/-Einkorn',
  119: 'Sommer-Emmer/-Einkorn', 120: 'Sommer-Dinkel',
  121: 'Winterroggen, Winter-Waldstaudenroggen', 122: 'Sommerroggen, Sommer-Waldstaudenroggen',
  125: 'Wintermenggetreide', 126: 'Wintermenggetreide ohne Weizen',
  131: 'Wintergerste', 132: 'Sommergerste',
  142: 'Winterhafer', 143: 'Sommerhafer',
  144: 'Sommermenggetreide', 145: 'Sommermenggetreide ohne Weizen',
  150: 'Gemenge Getreide/Leguminose (Getreide überwiegt)', 156: 'Wintertriticale',
  157: 'Sommertriticale', 171: 'Mais (ohne Silomais NC 411)',
  181: 'Rispenhirse', 182: 'Buchweizen',
  183: 'Mohren-/Zuckerhirse (ohne Sudangras NC 803)', 186: 'Amarant, Fuchsschwanz',
  187: 'Quinoa', 189: 'Chia',

  210: 'Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  211: 'Gemüseerbse (Markerbse, Schalerbse, Zuckererbse)', 212: 'Platterbse',
  213: 'Winter-Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  220: 'Ackerbohne/Puffbohne/Pferdebohne/Dicke Bohne', 221: 'Wicken (Pannonische Wicke, Zottelwicke, Saatwicke)',
  222: 'Linsen', 230: 'Lupinen (Süßlupine, weiße Lupine, blaue/schmalblättrige Lupine, gelbe Lupine, Andenlupine)',
  240: 'Erbsen/Bohnen', 250: 'Gemenge Leguminose/Getreide (Leguminose überwiegt)',

  311: 'Winterraps', 312: 'Sommerraps',
  315: 'Winterrübsen (Rübsen, Rübsamen, Rübsaat)', 316: 'Sommerrübsen (Rübsen, Rübsamen, Rübsaat)',
  320: 'Sonnenblumen', 330: 'Sojabohnen',
  341: 'Lein, Flachs', 393: 'Leindotter',

  411: 'Silomais (als Hauptfutter)', 413: 'Futterrübe/Runkelrübe',
  414: 'Kohlrübe, Steckrübe', 421: 'Rot-/Weiß-/Alexandriner-/Inkarnat-/Erd-/Schweden-/Persischer Klee',
  422: 'Kleegras', 423: 'Luzerne, Hopfenklee/Gelbklee, Bastardluzerne/Sandluzerne',
  424: 'Ackergras', 425: 'Klee-Luzerne-Gemisch',
  426: 'Bockshornklee, Schabziger Klee', 427: 'Hornklee, Hornschotenklee',
  429: 'Esparsette', 430: 'Serradella',
  431: 'Steinklee', 432: 'Kleemischung aus NC 421, 427, 431 (stickstoffbindend)',
  433: 'Luzerne-Gras', 434: 'Gras-Leguminosen Gemisch (Leguminosen überwiegt)',

  451: 'Wiesen', 452: 'Mähweiden',
  453: 'Weiden und Almen', 454: 'Hutungen',
  458: 'Streuwiesen', 480: 'Streuobstfläche mit Grünlandnutzung',
  492: 'Dauergrünland unter etablierten lokalen Praktiken (z.B. Heide)',

  911: '(Beta-)Rübensamenvermehrung', 912: 'Grassamenvermehrung',
  913: 'Wildsamenvermehrung', 914: 'Versuchsflächen mit mehreren beihilfefähigen Kulturarten',
  917: 'Mischkulturen', 919: 'Saatmais (Saatgutvermehrung)',

  564: 'nach VO 1257/1999 oder VO (EG) Nr. 1698/2005 oder VO 1305/2013 oder VO 2021/2115 aufgeforstete Flächen',
  568: 'aufgeforstete Dauergrünlandflächen, weder nach VO 1257/99 oder VO 1698/2005 oder VO 1305/2013',
  584: 'Nicht landwirtschaftliche, aber nach §11 (1) Nr.3 Bst. a) aa oder cc) der GAPDZV beihilfefähige Fläche (Maßnahmen aus Natura2000)',
  585: 'Nicht landwirtschaftliche, aber nach §11 (1) Nr.3 Bst. a) bb) der GAPDZV beihilfefähige Fläche (Maßnahmen aus der Wasserrahmenrichtlinie)',

  591: 'Ackerland aus der Erzeugung genommen', 592: 'Dauergrünland aus der Erzeugung genommen',
  593: 'Dauerkulturen aus der Erzeugung genommen',

  601: 'Stärkekartoffeln', 602: 'Kartoffeln (Speise)',
  603: 'Zuckerrüben', 604: 'Topinambur',
  605: 'Süßkartoffel',

  610: 'beetweiser Anbau von Gemüse ab 5 Kulturen', 611: 'beetweiser Anbau von Gemüse bis 4 Kulturen',
  612: 'Schwarzer Senf',
  613: 'Gemüsekohl (Kopfkohl, Wirsing, Rot-/Weißkohl, Spitzkohl, Grünkohl, Kohlrabi, Markstammkohl, Blumenkohl, Romanesco, Brokkoli, Rosenkohl, Zierkohl)',
  614: 'Brauner Senf/Sareptasenf', 615: 'Echte Brunnenkresse',
  616: 'Garten-Senfrauke, Rucola', 617: 'Gartenkresse',
  618: 'Gartenrettiche (Weiße/rote Rettiche, schwarzer Winterrettich, Ölrettich, Radieschen)', 619: 'Weißer Senf, Gelber Senf',
  620: 'Steckrübe, Kohlrübe (Gemüseanbau)', 622: 'Tomaten',
  623: 'Auberginen', 624: 'Paprika, Chilli, Peperoni',
  625: 'Schwarze Tollkirsche', 627: 'Gurke (Salatgurke, Einlegegurke)',
  628: 'Zuckermelone', 629: 'Riesenkürbis (Riesenkürbis, Hokkaidokürbis)',
  630: 'Gartenkürbis (Gartenkürbis, Steirischer Kürbis, Zucchini, Spaghettikürbis, Zierkürbis)', 631: 'Melone (Wassermelone)',
  632: 'Winterlauch (Speise-Zwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Bärlauch)',
  633: 'Sommerlauch (Speise-Zwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Bärlauch)',
  634: 'Möhre (Möhre/Karotte, Futtermöhre)', 635: 'Gartenbohne (Gartenbohne/Buschbohne/Stangenbohne, Feuerbohne/Prunkbohne)',
  636: 'Feldsalat/Ackersalat/ Rapunzel', 637: 'Lattich (Garten-Salat/Lattich, Lollo Rosso, Romana-Salat/Römischer Salat)',
  638: 'Spinat', 639: 'Mangold, Rote Beete/Rote Rübe',
  640: 'Melde (Garten-Melde)', 641: 'Sellerie (Knollen-Sellerie, Bleich-Sellerie, Stangen-Sellerie)',
  642: 'Ampfer (Wiesen-Sauerampfer)', 643: 'Pastinaken',
  644: 'Zichorien/Wegwarten (Chicorée, Radicchio, krausblättrige Endivie, ganzblättrige Endivie, Zichorie)',
  645: 'Kichererbsen', 646: 'Meerettich',
  647: 'Schwarzwurzeln', 648: 'Fenchel (Gemüsefenchel, Körnerfenchel)',
  649: 'Gemüserübsen (Stoppelrübe, Weiße Rübe, Bayerische Rübe, Mairübe, Chinakohl, Pak-Choi, Teltower Rübchen, Stielmus, Herbstrübe)',

  650: 'beetweiser Anbau von Küchenkräuter/Heil-und Gewürzpflanzen ab 5 Kulturen',
  690: 'beetweiser Anbau von Küchenkräuter/Heil-und Gewürzpflanzen bis 4 Kulturen',
  651: 'Dill, Gurkenkraut', 652: 'Kerbel (Kerbel/echter Kerbel, Wiesenkerbel)',
  653: 'Anis', 654: 'Kümmel',
  655: 'Kreuzkümmel', 656: 'Schwarzkümmel (Echter Schwarzkümmel, Jungfer im Grünen)',
  657: 'Koriander', 658: 'Liebstöckel/Maggikraut',
  659: 'Petersilie', 660: 'Basilikum',
  661: 'Rosmarin', 662: 'Salbei (Küchen-/Heilsalbei, Buntschopf-Salbei)',
  663: 'Borretsch', 664: 'Oregano (Echter Majoran, Oregano/Dost/Wilder Majoran)',
  665: 'Bohnenkraut', 666: 'Ysop/Eisenkraut',
  667: 'Verbenen (Echtes Eisenkraut)', 668: 'Lavendel (Echter Lavendel, Speik-Lavendel, Hybrid-Lavendel)',
  669: 'Thymian', 670: 'Melisse (Zitronenmelisse)',
  671: 'Enzian', 672: 'Minzen (Pfefferminze, Grüne Minze)',
  673: 'Wermut, Estragon, Beifuß', 674: 'Ringelblumen (Garten-Ringelblume)',
  675: 'Sonnenhut (Schmalblättriger Sonnenhut, Purpur-Sonnenhut)', 676: 'Wegerich (Spitzwegerich)',
  677: 'Kamillen (Echte Kamille)', 678: 'Schafgarben (Gelbe Schafgarbe)',
  679: 'Baldrian (Echter Baldrian)', 680: 'Echtes Johanniskraut/Hyperikum',
  681: 'Frauenmantel', 682: 'Mariendisteln',
  683: 'Geißraute', 684: 'Löwenzahn',
  685: 'Engelwurzen (Arznei-Engelwurz, Echter Engelwurz)', 686: 'Malven (Wilde Malve)',
  687: 'echte Arnika (Arnica montana)',

  701: 'Hanf', 702: 'Rollrasen, Vegetationsmappen für Dachbegrünung',
  703: 'Färber-Waid', 704: 'Kanariensaat/Echtes Glanzgras',
  705: 'Virginischer Tabak', 706: 'Mohn (Schlafmohn, Backmohn)',
  707: 'Erdbeeren', 708: 'Färberdisteln',
  709: 'Brennnesseln (Große Brennnessel)', 710: 'Färberkrapp (Rubia tinctorum)',

  718: 'beetweiser Anbau Zierpflanzen bis 4 Kulturen', 720: 'beetweiser Anbau Zierpflanzen ab 5 Kulturen',
  721: 'Goldlack', 722: 'Einjähriges Silberblatt',
  723: 'Garten-/Sommerlevkoje', 724: 'Kugelamarant (Echter Kugelamarant)',
  725: 'Taglilien (Essbare Taglilie)', 726: 'Lilien (Türkenbund)',
  727: 'Narzissen / Osterglocken', 728: 'Bischofskraut',
  729: 'Hasenohren (rundblättriges Hasenohr)', 730: 'Seidenpflanzen (Indianer-Seidenpflanze)',
  731: 'Hyazinthe (Garten-Hyazinthe)', 732: 'Milchstern',
  733: 'Astern (Sommeraster)', 734: 'Chrysanthemen (Garten-Chrysantheme, Winteraster)',
  735: 'Strohblumen', 736: 'Edelweiß',
  737: 'Margeriten', 738: 'Rudbeckien (Schwarzäugige Rudbeckie/Sonnenhut, Leuchtender Sonnenhut, Schlitzblättriger Sonnenhut)',
  739: 'Tagetes/Studentenblume', 740: 'Wucherblumen (Mutterkraut)',
  741: 'Strandflieder (Geflügelter Strandflieder)', 742: 'Spreublumen (Einjährige Papierblume)',
  743: 'Zinnien', 744: 'Taubnesseln (Weiße Taubnessel)',
  745: 'Gladiolen', 746: 'Tulpen',
  747: 'Trauben-Silberkerze', 748: 'Rittersporn',
  749: 'Skabiosen', 750: 'Dahlien',
  751: 'Rosenwurz', 752: 'Krokusse (Safran, Garten-Krokus)',
  753: 'Hibiskus (Chinesischer Roseneibisch)', 754: 'Strauch-/Bechermalven (Bechermalve)',
  755: 'Wolfsmilch', 756: 'Löwenmäulchen (Großes Löwenmaul)',
  757: 'Montbretien', 758: 'Halskräuter (Blaues Halskraut)',
  759: 'Gipskräuter (Schleierkraut)', 760: 'Pampasgräser (Amerikanisches Pampasgras)',
  761: 'Kosmeen (Gemeines Schmuckkörbchen)', 762: 'Nachtkerzen (Diptam)',
  763: 'Nachtkerzen (Oenothera)', 764: 'Königskerzen (Großblütige Königskerze)',
  765: 'Kapuzinerkresse', 766: 'Pfingstrosen/Päonien (Gemeine Pfingstrose, Strauch-Pfingstrose)',
  767: 'Schwertlilien (Deutsche Schwertlilie)', 768: 'Wiesenknopf (Kleiner Wiesenknopf, Pimpinelle)',
  769: 'Zieste (Deutscher Ziest, Knollen-Ziest)', 770: 'Vergissmeinnicht (Wald-Vergissmeinnicht)',
  771: 'Portulak', 772: 'Nelken (Bartnelke, Land-/Edelnelke)',
  773: 'Gewöhnlicher Leberbalsam (Ageratum)', 774: 'Gelber Leberbalsam (Lonas)',
  775: 'Kornblumen', 776: 'Veilchen (Horn-Veilchen, Garten-Stiefmütterchen, Wildes Stiefmütterchen)',
  777: 'Phacelia (als Hauptkultur z.B. Saatgutvermehrung)', 778: 'Alpendistel',
  779: 'Amacrinum', 780: 'Begonien',
  781: 'Calla/Drachenwurz', 782: 'Glockenblumen (Campanula)',
  783: 'Schildblume (Chelone)', 784: 'Christrose-/Schnee-/Weihnachtsrose, Korischer Nieswurz',
  785: 'Eukalyptus', 786: 'Fingerhut',
  787: 'Fuchsien', 788: 'Geranien',
  789: 'Veronica/Hebe/Ehrenpreis', 790: 'Anemonen (Herbstanemone, Japanische Anemone)',
  791: 'Knollenbegonien', 792: 'Kornrade',
  793: 'Leimkraut/Taubenkropf-Leimkraut', 794: 'Orchideen',
  795: 'Pelargonien', 796: 'Fetthenne, Mauerpfeffer (Sedum)',
  797: 'Rhizinus', 798: 'Ramtillkraut',
  799: 'Husarenknopf (Sanvitalia)',
  510: 'Goldrute (Solidago)', 511: 'Streptocarpus/Drehfrucht',
  512: 'Iberischer Drachenkopf', 513: 'Braunellen',
  514: 'Hauswurz (Sempervivum)', 515: 'Mühlenbeckia/Drahtsträucher',
  516: 'Knöterich (Persicaria)', 517: 'Garten-Petunie',
  518: 'Polygonum', 519: 'Köcherblümchen (Cuphea)',
  520: 'Silberbrandschopf',

  802: 'Silphium (Durchwachsene Silphie, Becherpflanze)', 803: 'Sudangras',
  804: 'Virginiamalve', 805: 'Staudenknöterich, Igniscum',
  852: 'Chinaschilf/Miscanthus', 853: 'Riesenweizengras/Szarvasi-Gras/Hirschgras',
  854: 'Rohrglanzgras', 866: 'Pflanzenmischung mit Hanf',

  824: 'sonst. Obstanlagen in Vollanbau (ohne Äpfel, Birnen, Pfirsiche)', 825: 'Kernobst z.B. Äpfel, Birnen',
  826: 'Steinobst, z. B. Kirschen, Pflaumen', 827: 'Beerenobst, z.B. Johannis-, Stachel-, Himbeeren',
  829: 'Sonstige Obstanlagen z.B. Holunder, Aronia, Maulbeeren', 833: 'Haselnüsse',
  834: 'Walnüsse', 838: 'Baumschulen, nicht für Beerenobst',
  839: 'Beerenobst zur Vermehrung (in Baumschulen)', 841: 'KUP (inkl. Vermehrungsflächen/Baumschulen) lt. GAPDZV',
  842: 'Rebland', 850: 'Sonstige Dauerkulturen',
  851: 'Rhabarber', 856: 'Hopfen',
  859: 'Hopfen vorübergehend stillgelegt (Gerüst steht noch)', 860: 'Spargel',
  861: 'Artischocke', 862: 'Heidekraut',
  863: 'Rosen (Baumschulen), Schnittrosen', 864: 'Rhododendron',
  865: 'Trüffel',

  549: 'Stilllegung für Naturschutz und Landschaftspflege (5-Jahresprogramm) (auf AL)',
  559: 'Stilllegung für Naturschutz und Landschaftspflege (5-Jahresprogramm) (auf GL)',
  575: 'Blühfläche (AUKM-Maßnahme)', 882: 'Winterhartes Gemenge Getreide/Leguminose (Getreide überwiegt)',
  923: 'Grünland ohne landwirtschaftliche Nutzung', 925: 'Biotope mit landwirtschaftlicher Nutzung',

  930: 'Bewirtschaftete Gewässer/Teichflächen', 983: 'Weihnachtsbäume',
  990: 'Alle anderen Flächen (keine LF)', 994: 'Vorübergehende, unbefestigte Mieten, Stroh-, Futter- oder Dunglagerplätze auf DGL',
  996: 'Vorübergehende, unbefestigte Mieten, Stroh-, Futter oder Dunglagerplätze auf AL',
  999: 'Ackerkultur einer Gattung/Art, die in der aktuellen Liste nicht aufgeführt ist'
};

// Hessen, Merkblatt zum Gemeinsamen Antrag 2026, Anlage 1 "Codeliste A 2026" (S. 67-69).
// Quelle: https://www.wibank.de/resource/blob/wibank/615584/0c70ccd70565e1540b8faf96849c8ce3/merkblatt-zum-ga-2026-data.pdf
const HESSEN_NUTZUNGSCODE_KLARTEXT = {
  70: 'Hecken oder Knicks >10m Kondi', 71: 'Baumreihe >50m Kondi',
  72: 'Feldgehölze 50 - 2.000 m² Kondi', 73: 'Feuchtgebiete < 2.000 m² Kondi',
  74: 'Einzelbäume Kondi', 75: 'Tümpel Sölle und Doline Kondi',
  76: 'Natur-, Stein- oder Trockenmauer Kondi', 77: 'Fels- und Steinriegel, naturversteinte Fläche Kondi',
  78: 'Feldraine Kondi',

  112: 'Winterhartweizen/Durum', 113: 'Sommerhartweizen/Durum',
  114: 'Winter-Dinkel', 115: 'Winterweichweizen',
  116: 'Sommerweichweizen', 118: 'Winter-Emmer/-Einkorn',
  119: 'Sommer-Emmer/-Einkorn', 120: 'Sommer-Dinkel',
  121: 'Winterroggen, Winter-Waldstaudenroggen', 122: 'Sommerroggen, Sommer-Waldstaudenroggen',
  125: 'Wintermenggetreide', 131: 'Wintergerste',
  132: 'Sommergerste', 142: 'Winterhafer',
  143: 'Sommerhafer', 144: 'Sommermenggetreide',
  150: 'Gemenge Getreide/Leguminose (Getreide überwiegt, ohne Mais)',
  151: 'Gemenge Getreide/Leguminose (Getreide überwiegt, mit Mais)',
  156: 'Wintertriticale', 157: 'Sommertriticale',
  171: 'Mais (ohne Silomais NC 411)', 181: 'Rispenhirse',
  182: 'Buchweizen', 183: 'Mohren-/Zuckerhirse (ohne Sudangras NC 803)',
  184: 'Kolbenhirse', 186: 'Amarant, Fuchsschwanz',
  187: 'Quinoa', 188: 'Reis im Trockenanbau',
  189: 'Chia', 882: 'Winterhartes Gemenge Getreide/Leguminose (Getreide überwiegt)',

  573: 'Uferrandstreifenprogramm (HALM 2 C.3.6)', 575: 'Blühfläche (AUKM-Maßnahme, HALM 2 C.3.2)',
  576: 'Schutzstreifen Erosion (HALM 2 C.3.3)', 577: 'Dauergrünland mit PV-Anlagen (nur für HALM2 SB)',

  210: 'Sommer-Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  211: 'Sommer-Gemüseerbse (Markerbse, Schalerbse, Zuckererbse)', 212: 'Platterbse',
  213: 'Winter-Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  220: 'Ackerbohne/Puffbohne/Pferdebohne/Dicke Bohne', 221: 'Wicken (Pannonische, Zottelwicke, Saatwicke)',
  222: 'Linsen', 230: 'Lupinen (Süßlupine, weiße Lupine, blaue/schmalblättrige Lupine, gelbe Lupine, Anden-Lupine)',
  240: 'Erbsen/Bohnen', 250: 'Gemenge Leguminose/Getreide (Leguminose überwiegt, ohne Mais)',
  251: 'Gemenge Leguminose/Getreide (Leguminose überwiegt, mit Mais)', 883: 'Winterhartes Leguminosengemenge',

  311: 'Winterraps', 312: 'Sommerraps',
  315: 'Winterrübsen (Rübsen, Rübsamen, Rübsaat)', 316: 'Sommerrübsen (Rübsen, Rübsamen, Rübsaat)',
  320: 'Sonnenblumen', 330: 'Sojabohnen',
  341: 'Lein, Flachs', 392: 'Meerkohl/Krambe',
  393: 'Leindotter',

  411: 'Silomais (als Hauptfutter)', 413: 'Futterrübe/Runkelrübe',
  414: 'Kohlrübe, Steckrübe', 421: 'Rot-/Weiß-/Alexandriner-/Inkarnat-/Erd-/Schweden-/Persischer Klee',
  422: 'Kleegras', 423: 'Luzerne',
  424: 'Ackergras', 425: 'Klee-Luzerne-Gemisch',
  426: 'Bockshornklee, Schabziger Klee', 427: 'Hornklee, Hornschotenklee',
  429: 'Esparsette', 430: 'Serradella',
  431: 'Steinklee', 432: 'Kleemischung aus NC 421, 427, 431 (stickstoffbindend)',
  433: 'Luzerne-Gras', 434: 'Gras-Leguminosen Gemisch (Leguminosen überwiegt)',

  444: 'DGL Neueinsaat als Ersatz für genehmigten DGL Umbruch', 459: 'Grünland',
  480: 'Streuobst mit Grünlandnutzung', 492: 'Dauergrünland unter etablierten lokalen Praktiken (z.B. Heide)',
  972: 'Grünland (nicht DZ und/oder AGZ fähig)',

  910: 'Wildäsungsfläche', 912: 'Grassamenvermehrung',
  913: 'Wildsamenvermehrung', 914: 'Versuchsflächen mit mehreren beihilfefähigen Kulturarten',
  919: 'Saatmais (Saatgutvermehrung)',

  564: 'Nicht landwirtschaftliche, aber §11 (1) Nr.3 Bst. c) der GAPDZV förderfähige Fläche (Aufforstungsverpflichtung nach VO 1257/1999 oder VO (EG) Nr. 1698/2005 oder VO 1305/2013 oder VO 2021/2115 oder bei Eingehung damit in Einklang stehender öffentlich finanzierter Maßnahme aufgeforstete Fläche)',
  584: 'Nicht landwirtschaftliche, aber nach §11 (1) Nr.3 Bst. a) aa) oder cc) der GAPDZV förderfähige Fläche (Infolge Anwendung Natura2000)',
  585: 'Nicht landwirtschaftliche, aber nach §11 (1) Nr.3 Bst. a) bb) der GAPDZV förderfähige Fläche (Infolge Anwendung der Wasserrahmenrichtlinie)',
  587: 'Landwirtschaftliche Fläche im Paludi Verfahren ohne landwirtschaftliches Erzeugnis',

  590: 'Brache mit Einsaat von einjährigen Blühmischungen', 591: 'Ackerland aus der Erzeugung genommen',
  592: 'Dauergrünland aus der Erzeugung genommen', 593: 'Dauerkulturen aus der Erzeugung genommen',

  601: 'Stärkekartoffeln', 602: 'Kartoffeln (Speise)',
  603: 'Zuckerrüben', 604: 'Topinambur',
  605: 'Süßkartoffeln',

  610: 'beetweiser Anbau von Gemüse ab 5 Kulturen', 611: 'beetweiser Anbau von Gemüse bis 4 Kulturen',
  612: 'Schwarzer Senf',
  613: 'Gemüsekohl (Kopfkohl, Wirsing, Rot-/Weißkohl, Spitzkohl, Grünkohl, Kohlrabi, Markstammkohl, Blumenkohl, Romanesco, Brokkoli, Rosenkohl, Zierkohl)',
  614: 'Brauner Senf/Sareptasenf', 615: 'Echte Brunnenkresse',
  616: 'Garten-Senfrauke, Rucola', 617: 'Gartenkresse',
  618: 'Gartenrettiche (Weiße/rote Rettiche, schwarzer Winterrettich, Ölrettich, Radieschen)',
  619: 'Weißer Senf, Gelber Senf', 620: 'Steckrübe, Kohlrübe (Gemüsebau)',
  622: 'Tomaten', 623: 'Auberginen',
  624: 'Paprika, Chilli, Peperoni', 625: 'Schwarze Tollkirsche',
  627: 'Gurke (Salatgurke, Einlegegurke)', 628: 'Zuckermelone',
  629: 'Riesenkürbis (Riesenkürbis, Hokkaidokürbis)',
  630: 'Gartenkürbis (Gartenkürbis, Steirischer Kürbis, Zucchini, Spaghettikürbis, Zierkürbis)',
  631: 'Melone (Wassermelone)',
  632: 'Winterlauch (Speise-Zwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Winterheckenzwiebel, Bärlauch)',
  633: 'Sommerlauch (Speise-Zwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Winterheckenzwiebel, Bärlauch)',
  634: 'Möhre (Möhre/Karotte, Futtermöhre)',
  635: 'Gartenbohne (Gartenbohne/Buschbohne/Stangenbohne, Feuerbohne/Prunkbohne)',
  636: 'Feldsalat/Ackersalat/ Rapunzel',
  637: 'Lattich (Garten-Salat/Lattich, Lollo Rosso, Romana-Salat/ Römischer Salat)',
  638: 'Spinat', 639: 'Mangold, Rote Beete/Rote Rübe',
  640: 'Melde (Garten-Melde)', 641: 'Sellerie (Knollen-Sellerie, Bleich-Sellerie, Stangen-Sellerie)',
  642: 'Ampfer (Wiesen-Sauerampfer)', 643: 'Pastinaken',
  644: 'Zichorien/Wegwarten (Chicoree, Radiccio, krausblättrige Endivie, ganzblättrige Endivie, Zichorie)',
  645: 'Kichererbsen', 646: 'Meerrettich',
  647: 'Schwarzwurzeln', 648: 'Fenchel (Gemüsefenchel, Körnerfenchel)',

  650: 'beetweiser Anbau von Küchenkräuter/Heil- und Gewürzpflanzen ab 5 Kulturen',
  690: 'beetweiser Anbau von Küchenkräuter/Heil- und Gewürzpflanzen bis 4 Kulturen',
  651: 'Dill, Gurkenkraut', 652: 'Kerbel (Kerbel/echter Kerbel, Wiesenkerbel)',
  653: 'Anis', 654: 'Kümmel',
  655: 'Kreuzkümmel', 656: 'Schwarzkümmel (Echter Schwarzkümmel, Jungfer im Grünen)',
  657: 'Koriander', 658: 'Liebstöckel/Maggikraut',
  659: 'Petersilie',

  660: 'Basilikum', 661: 'Rosmarin',
  662: 'Salbei (Küchen-/Heilsalbei, Buntschopf-Salbei)', 663: 'Borretsch',
  664: 'Oregano (Echter Majoran, Oregano/Dost/Wilder Majoran)', 665: 'Bohnenkraut',
  666: 'Ysop/Eisenkraut', 667: 'Verbenen (Echtes Eisenkraut)',
  668: 'Lavendel (Echter Lavendel, Speik-Lavendel, Hybrid-Lavendel)', 669: 'Thymian',
  670: 'Melisse (Zitronenmelisse)', 671: 'Enzian',
  672: 'Minzen (Pfefferminze, Grüne Minze)', 673: 'Wermut, Estragon, Beifuß',
  674: 'Ringelblumen (Garten-Ringelblume)', 675: 'Sonnenhut (Schmalblättriger Sonnenhut, Purpur-Sonnenhut)',
  676: 'Wegerich (Spitzwegerich)', 677: 'Kamillen (Echte Kamille)',
  678: 'Schafgarben (Gelbe Schafgarbe)', 679: 'Baldrian (Echter Baldrian)',
  680: 'Echtes Johanniskraut/Hyperikum', 681: 'Frauenmantel',
  682: 'Mariendisteln', 683: 'Geißraute',
  684: 'Löwenzahn', 685: 'Engelwurzen (Arznei-Engelwurz, Echter Engelwurz)',
  686: 'Malven (Wilde Malve)', 687: 'echte Arnika (Arnica montana)',

  701: 'Hanf (THC-arme Sorten)', 702: 'Rollrasen, Vegetationsmatten für Dachbegrünung',
  703: 'Färber-Waid', 704: 'Kanariensaat/Echtes Glanzgras',
  705: 'Virginischer Tabak', 706: 'Mohn (Schlafmohn, Backmohn)',
  707: 'Erdbeeren (Freiland)', 708: 'Färberdisteln',
  709: 'Brennnesseln (Große Brennnessel)', 710: 'Färberkrapp (Rubia tinctorum)',

  718: 'beetweiser Anbau von Zierpflanzen bis 4 Kulturen', 720: 'beetweiser Anbau von Zierpflanzen ab 5 Kulturen',
  721: 'Goldlack', 722: 'Einjähriges Silberblatt',
  723: 'Garten-/Sommerlevkoje', 724: 'Kugelamarant (Echter Kugelamarant)',
  725: 'Taglilien (Essbare Taglilie)', 726: 'Lilien (Türkenbund)',
  727: 'Narzissen / Osterglocken', 728: 'Bischofskraut',
  729: 'Hasenohren (rundblättriges Hasenohr)', 730: 'Seidenpflanzen (Indianer-Seidenpflanze)',
  731: 'Hyazinthe (Garten-Hyazinthe)', 732: 'Milchstern',
  733: 'Astern (Sommeraster)', 734: 'Chrysanthemen (Garten-Chrysantheme, Winteraster)',
  735: 'Strohblumen', 736: 'Edelweiß',
  737: 'Margeriten', 738: 'Rudbeckien (Schwarzäugige Rudbeckie/Sonnenhut, Leuchtender Sonnenhut, Schlitzblättriger Sonnenhut)',
  739: 'Tagetes/Studentenblume', 740: 'Wucherblumen (Mutterkraut)',
  741: 'Strandflieder (Geflügelter Strandflieder)', 742: 'Spreublumen (Einjährige Papierblume)',

  743: 'Zinnien', 744: 'Taubnesseln (Weiße Taubnessel)',
  745: 'Gladiolen', 746: 'Tulpen',
  747: 'Trauben-Silberkerze', 748: 'Rittersporn',
  749: 'Skabiosen', 750: 'Dahlien',
  751: 'Rosenwurz', 752: 'Krokusse (Safran, Garten-Krokus)',
  753: 'Hibiskus (Chinesischer Roseneibisch)', 754: 'Strauch-/Bechermalven (Bechermalve)',
  755: 'Wolfsmilch', 756: 'Löwenmäulchen (Großes Löwenmaul)',
  757: 'Montbretien', 758: 'Halskräuter (Blaues Halskraut)',
  759: 'Gipskräuter (Schleierkraut)', 760: 'Pampasgräser (Amerikanisches Pampasgras)',
  761: 'Kosmeen (Gemeines Schmuckkörbchen)', 762: 'Nachtkerzen (Diptam)',
  763: 'Nachtkerzen (Oenothera)', 764: 'Königskerzen (Großblütige Königskerze)',
  765: 'Kapuzinerkresse', 766: 'Pfingstrosen/Päonien (Gemeine Pfingstrose, Strauch-Pfingstrose)',
  767: 'Schwertlilien (Deutsche Schwertlilie)', 768: 'Wiesenknopf (Kleiner Wiesenknopf, Pimpinelle)',
  769: 'Zieste (Deutscher Ziest, Knollen-Ziest)', 770: 'Vergissmeinnicht (Wald-Vergissmeinnicht)',
  771: 'Portulak', 772: 'Nelken (Bartnelke, Land-/Edelnelke)',
  773: 'Gewöhnlicher Leberbalsam (Ageratum)', 774: 'Gelber Leberbalsam (Lonas)',
  775: 'Kornblumen', 776: 'Veilchen (Horn-Veilchen, Garten-Stiefmütterchen, Wildes Stiefmütterchen)',
  777: 'Phacelia (als Hauptkultur z.B. Saatgutvermehrung)', 778: 'Alpendistel',
  779: 'Amacrinum', 780: 'Begonien',
  781: 'Calla/Drachenwurz', 782: 'Glockenblumen (Campanula)',
  783: 'Schildblume (Chelone)', 784: 'Christrose-/Schnee-/Weihnachtsrose, Korischer Nieswurz',
  785: 'Eukalyptus', 786: 'Fingerhut',
  787: 'Fuchsien', 788: 'Geranien',
  789: 'Veronica/Hebe/Ehrenpreis', 790: 'Anemonen (Herbstanemone, Japanische Anemone)',
  791: 'Knollenbegonien', 792: 'Kornrade',
  793: 'Leimkraut/Taubenkropf-Leimkraut', 794: 'Orchideen',
  795: 'Pelargonien', 796: 'Fetthenne, Mauerpfeffer',
  797: 'Rhizinus', 798: 'Ramtillkraut',
  799: 'Husarenknopf', 510: 'Goldrute (Solidago)',
  511: 'Streptocarpus/Drehfrucht', 512: 'Iberischer Drachenkopf',
  513: 'Braunellen', 514: 'Hauswurz (Sempervivum)',
  515: 'Mühlenbeckia/Drahtsträucher', 516: 'Knöterich (Persicaria)',

  517: 'Garten-Petunie', 518: 'Polygonum',
  519: 'Köcherblümchen (Cuphea)', 520: 'Silberbrandschopf',

  802: 'Silphium (Durchwachsene Silphie, Becherpflanze)', 803: 'Sudangras',
  804: 'Virginiamalve', 805: 'Staudenknöterich, Igniscum',
  806: 'Rutenhirse/Switchgras', 852: 'Chinaschilf/Miscanthus',
  853: 'Riesenweizengras/Szarvasi-Gras/Hirschgras', 854: 'Rohrglanzgras',
  866: 'Pflanzenmischung mit Hanf', 871: 'Wildpflanzenmischung zur Energieerzeugung',

  822: 'Streuobst (ohne Wiesennutzung)', 825: 'Kernobst z.B. Äpfel, Birnen',
  826: 'Steinobst, z.B. Kirschen, Pflaumen', 827: 'Beerenobst, z.B. Johannis-, Stachel-, Himbeeren',
  829: 'Sonstige Obstanlagen z.B. Holunder, Sanddorn, Aronia, Maulbeeren', 833: 'Haselnüsse',
  834: 'Walnüsse', 838: 'Baumschulen, nicht für Beerenobst',
  839: 'Beerenobst zur Vermehrung (in Baumschulen)', 841: 'KUP lt. GAPDZV',
  842: 'Rebland', 845: 'Rebschulfläche',
  846: 'Unterlagsrebfläche', 848: 'Tafeltrauben',
  849: 'Weinbergbrache', 850: 'Sonstige Dauerkulturen',
  851: 'Rhabarber', 856: 'Hopfen',
  860: 'Spargel', 861: 'Artischocke',
  862: 'Heidekraut', 863: 'Rosen (Baumschulen), Schnittrosen',
  864: 'Rhododendron', 865: 'Trüffel',

  920: 'Haus- und Nutzgärten', 930: 'Bewirtschaftete Gewässer/Teichflächen',
  981: 'Pilze unter Glas', 982: 'Sonstige KUP',
  983: 'Weihnachtsbäume', 990: 'Alle anderen Flächen (keine LF)',
  994: 'Vorübergehende, unbefestigte Mieten, Stroh-, Futter- oder Dunglagerplätze auf DGL',
  995: 'Forstflächen (Waldbodenflächen)',
  996: 'Vorübergehende, unbefestigte Mieten, Stroh-, Futter oder Dunglagerplätze auf AL',
  997: 'Sonstige Infrastrukturmaßnahmen'
};

// Nordrhein-Westfalen, Merkblatt Sammelantrag 2026 (S. 4-9).
// Quelle: https://www.landwirtschaftskammer.de/foerderung/formulare/merkblaetter/mb-sammelantrag-2026-flaechenverzeichnis-hinweise.pdf
// Dient nur als Fallback, falls die begleitende NTNW-XML fehlt — normalerweise
// liefert die XML den Klartext direkt, siehe extractNrwNutzungMap() oben.
const NRW_NUTZUNGSCODE_KLARTEXT = {
  88: 'ÖR 1a Freiwillige Stilllegung', 90: 'ÖR 1b Blühfläche auf AL',
  92: 'ÖR 1c Blühfläche auf DK', 93: 'ÖR 1d Altgrasstreifen DGL',

  112: 'Winterdurum (Hartweizen)', 113: 'Sommerdurum (Hartweizen)',
  114: 'Winter-Dinkel', 115: 'Winterweichweizen',
  116: 'Sommerweichweizen', 118: 'Winter-Emmer/-Einkorn',
  119: 'Sommer-Emmer/-Einkorn', 120: 'Sommer-Dinkel',
  121: 'Winterroggen', 122: 'Sommerroggen',
  125: 'Wintermenggetreide', 131: 'Wintergerste',
  132: 'Sommergerste', 142: 'Winterhafer',
  143: 'Sommerhafer', 144: 'Sommermenggetreide',
  150: 'Gemenge Getr./Leg. (mehr Getr./ohne Mais)', 156: 'Wintertriticale',
  157: 'Sommertriticale', 171: 'Mais (ohne Silomais)',
  917: 'Mais-Mischkulturen', 181: 'Rispenhirse',
  182: 'Buchweizen', 183: 'Mohren-/Zuckerhirse',
  186: 'Amarant, Fuchsschwanz', 187: 'Quinoa',
  188: 'Reis im Trockenanbau', 189: 'Chia',

  210: 'Futtererbsen', 211: 'Gemüseerbse',
  212: 'Platterbse', 220: 'Ackerbohnen/Dicke Bohne',
  221: 'Wicken', 222: 'Linsen',
  230: 'Lupinen', 240: 'Erbsen/Bohnen - Gemische',
  250: 'Gemenge Leg./Getr. (mehr Leg./ohne Mais)',

  311: 'Winterraps', 312: 'Sommerraps',
  315: 'Winterrübsen', 316: 'Sommerrübsen',
  320: 'Sonnenblumen', 330: 'Sojabohnen',
  341: 'Lein, Flachs', 392: 'Meerkohl/Krambe',
  393: 'Leindotter',

  411: 'Silomais', 413: 'Futterrübe/Runkelrübe',
  414: 'Kohlrübe, Steckrüben', 421: 'Klee',
  422: 'Kleegras', 423: 'Luzerne',
  424: 'Ackergras', 425: 'Klee-Luzerne-Gemisch',
  426: 'Bockshornklee', 427: 'Hornklee, Hornschotenklee',
  429: 'Esparsette', 430: 'Serradella',
  431: 'Steinklee', 432: 'Kleemischung',
  433: 'Luzerne-Gras', 434: 'Gras-Leguminosen (mehr Leg.)',

  459: 'Grünland', 480: 'Streuobst (Grünlandnutzung)',
  492: 'Heide (DGL etabl. Praktiken)',

  510: 'Goldrute', 511: 'Streptocarpus/Drehfrucht',
  512: 'Iberischer Drachenkopf', 513: 'Braunellen',
  514: 'Hauswurz', 515: 'Mühlenbeckia/Drahtsträucher',
  516: 'Knöterich', 517: 'Garten-Petunie',
  518: 'Polygonum', 519: 'Köcherblümchen',

  560: 'Brache (im Rahmen VNS)', 564: 'Aufforstung Ländl. Raum',
  573: 'Uferrandstreifen (AUM-Maßnahme)', 576: 'Erosionsschutzstreifen (AUM-Maßnahme)',
  583: 'Naturschutzfläche (1307/2013i)',

  590: 'Brache (einj. Blühmisch.)', 591: 'Ackerland aus Erzeugung genommen',
  592: 'DGL aus Erzeugung genommen', 593: 'DK aus der Erzeugung genommen',

  602: 'Kartoffeln', 603: 'Zuckerrüben',
  604: 'Topinambur',

  610: 'beetweiser Anbau von Gemüse ab 5 Kulturen', 611: 'beetweiser Anbau von Gemüse bis 4 Kulturen',
  612: 'Schwarzer Senf', 613: 'Gemüsekohl (auch Zierkohl)',
  614: 'Brauner Senf', 616: 'Garten-Senfrauke, Rucola',
  617: 'Gartenkresse', 618: 'Gartenrettiche',
  619: 'Weißer Senf, Gelber Senf', 620: 'Gemüserübe',
  622: 'Tomaten', 623: 'Auberginen',
  624: 'Paprika, Chilli, Peperoni', 627: 'Gurken',
  628: 'Zuckermelone', 629: 'Riesenkürbis',
  630: 'Gartenkürbis', 631: 'Melone',
  633: 'Zwiebeln/Lauch', 634: 'Möhre (auch Futtermöhre)',
  635: 'Gartenbohne', 636: 'Feldsalat (auch Rapunzel)',
  637: 'Salat (Garten, Lollo Rosso.)', 638: 'Spinat',
  639: 'Mangold, Rote Beete/Rote Rübe', 640: 'Melde',
  641: 'Sellerie (Knollen/Bleich/Stang)', 642: 'Ampfer (Wiesen-Sauerampfer)',
  643: 'Pastinaken', 644: 'Zichorien/Wegwarten',
  645: 'Kichererbsen', 646: 'Meerrettich',
  647: 'Schwarzwurzeln', 648: 'Fenchel (Gemüse/Körner)',
  649: 'Gemüserübsen',

  650: 'beetweise Anbau Kräuter/Gewürz ab 5 Kulturen', 690: 'beetweise Anbau Kräuter/Gewürz bis 4 Kulturen',
  651: 'Anethum (Dill, Gurkenkraut)', 652: 'Kerbel (auch Wiesenkerbel)',
  653: 'Bibernellen (Anis)', 654: 'Kümmel',
  656: 'Schwarzkümmel', 657: 'Koriander',
  658: 'Liebstöckel/Maggikraut', 659: 'Petersilie',
  660: 'Basilikum', 661: 'Rosmarin',
  662: 'Salbei (auch Buntschopf)', 663: 'Borretsch',
  664: 'Oregano (Majoran, Dost)', 665: 'Bohnenkräuter',
  667: 'Verbenen (echtes Eisenkraut)', 668: 'Lavendel',
  669: 'Thymian (auch Gartenthymian)', 670: 'Melisse (Zitronenmelisse)',
  671: 'Enziane', 672: 'Minzen (Pfefferm., Grüne M.)',
  673: 'Wermut, Estragon, Beifuß', 674: 'Ringelblumen',
  675: 'Sonnenhut (Schmalbl., Purpur)', 676: 'Wegeriche (Spitzwegerich)',
  677: 'Kamillen (Echte Kamille)', 678: 'Schafgarben (Gelbe Schafgarbe)',
  679: 'Baldriane (Echter Baldrian)', 680: 'Johanniskräuter (Echtes J.)',
  681: 'Frauenmantel', 682: 'Mariendisteln',
  683: 'Galega (Geißraute)', 684: 'Löwenzahn',
  685: 'Engelwurzen', 686: 'Malven (Wilde Malve)',
  687: 'echte Arnika (Arnica montana)',

  701: 'Hanf', 702: 'Rollrasen',
  703: 'Färber-Waid', 704: 'Glanzgräser',
  705: 'Virginischer Tabak', 706: 'Mohn (Schlafmohn, Backmohn)',
  707: 'Erdbeeren', 708: 'Färberdisteln',
  709: 'Brennnesseln (Große Brennn.)', 710: 'Färberkrapp (Rubia tinctorum)',

  718: 'beetweise Anbau Zierpflanzen bis 4 Kulturen', 720: 'beetweise Anbau Zierpflanzen ab 5 Kulturen',
  722: 'Einjähriges Silberblatt', 723: 'Garten-/ Sommerlevkoje',
  726: 'Lilien (Türkenbund)', 727: 'Narzissen / Osterglocken',
  728: 'Knorpelmöhren (Bischofskraut)', 730: 'Seidenpflanzen',
  732: 'Milchstern (Kap-Milchstern)', 733: 'Astern (Sommeraster)',
  734: 'Chrysantheme, Winteraster', 735: 'Strohblumen (Garten)',
  736: 'Edelweiß (Alpen-Edelweiß)', 737: 'Margeriten',
  738: 'Rudbeckien (Sonnenhut)', 739: 'Tagetes',
  740: 'Wucherblumen (Mutterkraut)', 741: 'Strandflieder (Geflügelter S.)',
  743: 'Zinnien', 744: 'Taubnesseln (Weiße Taubnessel)',
  745: 'Gladiolen (Gartengladiole)', 746: 'Tulpen (Garten-Tulpe)',
  747: 'Trauben-Silberkerze', 748: 'Rittersporn',
  750: 'Dahlien (Garten-Dahlie)', 751: 'Rhodiola (Rosenwurz)',
  752: 'Krokusse (Safran, Garten-K.)', 753: 'Hibiskus',
  755: 'Wolfsmilch (Weißrand)', 756: 'Löwenmäulchen',
  757: 'Garten-Montbretie', 759: 'Gipskräuter (Schleierkraut)',
  760: 'Amerikanisches Pampasgras', 761: 'Kosmeen (Schmuckkörbchen)',
  764: 'Königskerzen (Großblütige K.)', 765: 'Kapuzinerkresse',
  766: 'Pfingstrosen (auch Strauch)', 768: 'Wiesenknopf (Kl. W., Pimpine.)',
  769: 'Zieste (Deutscher, Knollen)', 770: 'Vergissmeinnicht (Wald-Verg.)',
  771: 'Portulak', 772: 'Nelken (Bartn., Land/Edel)',
  773: 'Ageratum (Gew. Leberbalsam)', 775: 'Kornblumen',
  776: 'Veilchen und Stiefmütterchen', 777: 'Phacelia',
  778: 'Alpendistel', 780: 'Begonien',
  782: 'Glockenblumen (Campanula)', 783: 'Schildblume (Chelone)',
  784: 'Korischer Nieswurz, Rosen', 785: 'Eukalyptus',
  786: 'Fingerhut', 787: 'Fuchsien',
  788: 'Geranien', 789: 'Veronica/Hebe/Ehrenpreis',
  790: 'Anemonen', 792: 'Kornrade',
  793: 'Taubenkropf-/Leimkraut', 795: 'Pelargonien',
  796: 'Fetthenne, Mauerpfeffer', 797: 'Rhizinus',
  798: 'Ramtillkraut', 799: 'Husarenknopf (Sanvitalia)',

  802: 'Silphium (Durchwachs., Becher)', 803: 'Sudangras, Zuckerhirse',
  804: 'Sida (Virginiamalve)', 806: 'Rutenhirse/Switchgras',

  81: 'Agroforstsystem (Streifen)',

  822: 'Streuobst (ohne Wiesennutzung)', 825: 'Kernobst z.B. Äpfel, Birnen',
  826: 'Steinobst z.B. Kirsche, Pflaume', 827: 'Beerenobst',
  829: 'Sonstige Obstanlagen', 833: 'Haselnüsse',
  834: 'Walnüsse', 838: 'Baumschulen (ohne Beerenobst)',
  839: 'Beerenobst zur Vermehrung', 840: 'Korbweiden',
  841: 'Niederwald mit Kurzumtrieb', 842: 'Rebland',
  850: 'Sonstige Dauerkulturen', 851: 'Rhabarber',
  852: 'Chinaschilf/Miscanthus', 853: 'Riesenweizengras/Szarvasi-Gras',
  854: 'Rohrglanzgras', 860: 'Spargel',
  861: 'Artischocke', 862: 'Heidekraut',
  863: 'Rosen, Schnittrosen', 865: 'Trüffel',
  866: 'Pflanzenmischung mit Hanf', 871: 'Wildpflanzenmischung (AUM-Maßnahme)',

  910: 'Wildacker auf lw. Fläche', 911: 'Rübensamenvermehrung',
  912: 'Grassamenvermehrung', 913: 'Wildsamenvermehrung',
  914: 'Versuchsflächen (nur DZ-fähig)', 915: 'Randstreifen (Acker/DK)',
  918: 'Mehrjährige Buntbrache (AUM-Maßnahme)', 919: 'Saatmais (Saatgutvermehrung)',
  924: 'Vertragsnaturs. ohne DZ', 956: 'Aufforstung',
  972: 'NFF: Dauergrünlandnutzung', 973: 'NFF: Ackernutzung',
  983: 'Weihnachtsbäume', 994: 'Unbefestigte Mieten DGL',
  995: 'Forstflächen', 996: 'Unbefestigte Mieten AL',
  997: 'Anbau in Pflanzgefäßen', 999: 'Gattung/Art (nicht in Liste)'
};

// Rheinland-Pfalz, KTA-Liste 2026, Stand 25.03.2026.
// Quelle: https://add.rlp.de/fileadmin/add/Abteilung_4/Foerderungen/Agrarwirtschaft/Gemeinsamer_Antrag/KTA-Liste_RP_2026.pdf
const RP_NUTZUNGSCODE_KLARTEXT = {
  83: 'Agroforststreifen ohne ÖR',
  88: 'ÖR 1a Brache (Selbst-/Begrünung)', 89: 'ÖR 1a Brache (aktive Begrünung)',
  90: 'ÖR 1b Blühfläche/-streifen auf AL', 92: 'ÖR 1c Blühfläche/-streifen auf DK',
  93: 'ÖR 1d Altgrasstreifen / -flächen', 94: 'ÖR 3 Agroforststreifen',

  112: 'Winterdurum (Hartweizen)', 113: 'Sommerdurum (Hartweizen)',
  114: 'Winter-Dinkel', 120: 'Sommer-Dinkel',
  115: 'Winterweichweizen', 116: 'Sommerweichweizen',
  118: 'Winter-Emmer/-Einkorn', 119: 'Sommer-Emmer/-Einkorn',
  121: 'Winterroggen, Winter-Waldstaudenroggen', 122: 'Sommerroggen, Sommer-Waldstaudenroggen',
  125: 'Wintermenggetreide', 126: 'Wintermenggetreide ohne Weizen',
  131: 'Wintergerste', 132: 'Sommergerste',
  142: 'Winterhafer', 143: 'Sommerhafer',
  144: 'Sommermenggetreide', 145: 'Sommermenggetreide ohne Weizen',
  156: 'Wintertriticale', 157: 'Sommertriticale',
  150: 'Gemenge Sommergetreide/Leguminose (Getreide überwiegt)',
  171: 'Mais (ohne Silomais NC 411)',
  181: 'Rispenhirse', 182: 'Buchweizen',
  183: 'Mohren-/Zuckerhirse (ohne Sudangras NC 803)', 184: 'Kolbenhirse',
  186: 'Amarant, Fuchsschwanz', 187: 'Quinoa',
  188: 'Reis im Trockenanbau', 189: 'Chia',
  882: 'Winterhartes Gemenge Getreide/Leguminose (Getreide überwiegt)',

  210: 'Sommer-Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  211: 'Sommer-Gemüseerbse (Markerbse, Schalerbse, Zuckererbse)',
  212: 'Platterbse',
  213: 'Winter-Erbsen (Markerbse, Schalerbse, Zuckererbse, Futtererbse, Peluschke)',
  220: 'Ackerbohne/Puffbohne/Pferdebohne/Dicke Bohne',
  221: 'Wicken (Pannonische Wicke, Zottelwicke, Saatwicke)',
  222: 'Linsen',
  230: 'Lupinen (Süßlupine, weiße Lupine, blaue/schmalblättrige Lupine, gelbe Lupine, Anden-Lupine)',
  240: 'Erbsen/Bohnen',
  250: 'Gemenge Leguminose/Getreide (Leguminose überwiegt)',

  311: 'Winterraps', 312: 'Sommerraps',
  315: 'Winterrübsen (Rübsen, Rübsamen, Rübsaat)', 316: 'Sommerrübsen (Rübsen, Rübsamen, Rübsaat)',
  317: 'Ölrettich', 320: 'Sonnenblumen',
  330: 'Sojabohnen', 341: 'Lein, Flachs',
  392: 'Meerkohl/Krambe', 393: 'Leindotter',

  410: 'Mais-Gemenge', 411: 'Silomais (als Hauptfutter)', 413: 'Futterrübe/Runkelrübe',
  421: 'Rot-/Weiß-/Alexandriner-/Inkarnat-/Erd-/Schweden-/Persischer Klee',
  422: 'Kleegras',
  423: 'Luzerne, Hopfenklee/Gelbklee, Bastardluzerne/Sandluzerne',
  424: 'Ackergras',
  425: 'Klee-Luzerne-Gemisch',
  426: 'Bockshornklee, Schabziger Klee',
  427: 'Hornklee, Hornschotenklee',
  429: 'Esparsette', 430: 'Serradella', 431: 'Steinklee',
  432: 'Kleemischung aus NC 421, 427, 431 (stickstoffbindend)',
  433: 'Luzerne-Gras',
  434: 'Gras-Leguminosen Gemisch (Leguminosen überwiegt)',

  441: 'Wiesen (Grünlandneueinsaat 1. bis inkl. 5. Jahr)',
  442: 'Mähweiden (Grünlandneueinsaat 1. bis inkl. 5. Jahr)',
  443: 'Weiden (Grünlandneueinsaat 1 bis inkl. 5. Jahr)',
  450: 'DGL Neueinsaat als Ersatz für genehmigten DGL-Umbruch',
  451: 'Wiesen', 452: 'Mähweiden', 453: 'Weiden und Almen', 454: 'Hutungen',
  480: 'Streuobstfläche mit Grünlandnutzung',
  492: 'Dauergrünland unter etablierten lokalen Praktiken (z.B. Heide)',

  910: 'Wildäsungsfläche', 911: '(Beta-)Rübensamenvermehrung',
  912: 'Grassamenvermehrung', 913: 'Wildsamenvermehrung',
  914: 'Versuchsflächen mit mehreren beihilfefähigen Kulturarten',
  917: 'Mischkulturen ohne Mais',

  556: 'Erstaufforstung EAFP alt und EAFP 2000',
  586: 'Nach §11 (1) Nr.3 Bst. b) der GAPDZV förderfähige Fläche (In Folge einer Maßnahme, die Paludikulturen zur Erzeugung von nicht in Anhang I AEUV aufgeführten Erzeugnissen erlaubt)',
  587: 'Landwirtschaftliche Fläche im Paludi Verfahren ohne landwirtschaftliches Erzeugnis',

  590: 'Ackerbrache mit jährlicher Einsaat von Blühmischungen',
  591: 'Ackerland aus der Erzeugung genommen',
  592: 'Dauergrünland aus der Erzeugung genommen',
  593: 'Dauerkulturen aus der Erzeugung genommen',
  595: 'Ackerbrache mit mehrjährigen Blühmischungen',

  601: 'Stärkekartoffeln', 602: 'Kartoffeln (Speise)', 603: 'Zuckerrüben',
  604: 'Topinambur', 605: 'Süßkartoffel', 606: 'Pflanzkartoffeln',

  610: 'beetweiser Anbau von Gemüse ab 5 Kulturen',
  611: 'beetweiser Anbau von Gemüse bis 4 Kulturen',
  649: 'Gemüserübsen (Stoppelrübe, Weiße Rübe, Bayerische Rübe, Mairübe, Chinakohl, Pak-Choi, Teltower Rübchen, Stielmus, Herbstrübe)',
  613: 'Gemüsekohl (Kopfkohl, Wirsing, Rot-/Weißkohl, Spitzkohl, Grünkohl, Kohlrabi, Markstammkohl, Blumenkohl, Romanesco, Brokkoli, Rosenkohl, Zierkohl)',
  614: 'Brauner Senf/Sareptasenf', 612: 'Schwarzer Senf',
  615: 'Echte Brunnenkresse', 616: 'Garten-Senfrauke, Rucola', 617: 'Gartenkresse',
  618: 'Gartenrettiche (Weiße/rote Rettiche, schwarzer Winterrettich, Ölrettich, Radieschen)',
  619: 'Weißer Senf, Gelber Senf', 620: 'Steckrübe, Kohlrübe (Gemüseanbau)',
  622: 'Tomaten', 623: 'Auberginen', 624: 'Paprika, Chilli, Peperoni',
  625: 'Schwarze Tollkirsche', 627: 'Gurke (Salatgurke, Einlegegurke)',
  628: 'Zuckermelone', 629: 'Riesenkürbis (Riesenkürbis, Hokkaidokürbis)',
  630: 'Gartenkürbis (Gartenkürbis, Steirischer Kürbis, Zucchini, Spaghettikürbis, Zierkürbis)',
  631: 'Melone (Wassermelone)',
  632: 'Winterlauch (Speise-Zwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Bärlauch)',
  633: 'Sommerlauch (Speise-Zwiebel, Schalotte, Lauch, Knoblauch, Schnittlauch, Bärlauch)',
  634: 'Möhre (Möhre/Karotte, Futtermöhre)',
  635: 'Gartenbohne (Gartenbohne/Buschbohne/Stangenbohne, Feuerbohne/Prunkbohne)',
  636: 'Feldsalat/Ackersalat/ Rapunzel',
  637: 'Lattich (Garten-Salat/Lattich, Lollo Rosso, Romana-Salat/Römischer Salat)',
  638: 'Spinat', 639: 'Mangold, Rote Beete/Rote Rübe', 640: 'Melde (Garten-Melde)',
  641: 'Sellerie (Knollen-Sellerie, Bleich-Sellerie, Stangen-Sellerie)',
  642: 'Ampfer (Wiesen-Sauerampfer)', 643: 'Pastinaken',
  644: 'Zichorien/Wegwarten (Chicorée, Radicchio, krausblättrige Endivie, ganzblättrige Endivie, Zichorie)',
  645: 'Kichererbsen', 646: 'Meerettich', 647: 'Schwarzwurzeln',
  648: 'Fenchel (Gemüsefenchel, Körnerfenchel)',

  650: 'beetweiser Anbau von Küchenkräuter/ Heil- und Gewürzpflanzen ab 5 Kulturen',
  690: 'beetweiser Anbau von Küchenkräuter/Heil-und Gewürzpflanzen bis 4 Kulturen',
  651: 'Dill, Gurkenkraut', 652: 'Kerbel (Kerbel/echter Kerbel, Wiesenkerbel)',
  653: 'Anis', 654: 'Kümmel', 655: 'Kreuzkümmel',
  656: 'Schwarzkümmel (Echter Schwarzkümmel, Jungfer im Grünen)',
  657: 'Koriander', 658: 'Liebstöckel/Maggikraut', 659: 'Petersilie',
  660: 'Basilikum', 661: 'Rosmarin',
  662: 'Salbei (Küchen-/Heilsalbei, Buntschopf-Salbei)', 663: 'Borretsch',
  664: 'Oregano (Echter Majoran, Oregano/Dost/Wilder Majoran)', 665: 'Bohnenkraut',
  666: 'Ysop/Eisenkraut', 667: 'Verbenen (Echtes Eisenkraut)',
  668: 'Lavendel (Echter Lavendel, Speik-Lavendel, Hybrid-Lavendel)', 669: 'Thymian',
  670: 'Melisse (Zitronenmelisse)', 671: 'Enzian',
  672: 'Minzen (Pfefferminze, Grüne Minze)', 673: 'Wermut, Estragon, Beifuß',
  674: 'Ringelblumen (Garten-Ringelblume)',
  675: 'Sonnenhut (Schmalblättriger Sonnenhut, Purpur-Sonnenhut)',
  676: 'Wegerich (Spitzwegerich)', 677: 'Kamillen (Echte Kamille)',
  678: 'Schafgarben (Gelbe Schafgarbe)', 679: 'Baldrian (Echter Baldrian)',
  680: 'Echtes Johanniskraut/Hyperikum', 681: 'Frauenmantel', 682: 'Mariendisteln',
  683: 'Geißraute', 684: 'Löwenzahn',
  685: 'Engelwurzen (Arznei-Engelwurz, Echter Engelwurz)', 686: 'Malven (Wilde Malve)',
  687: 'echte Arnika (Arnica montana)',

  701: 'Hanf', 702: 'Rollrasen, Vegetationsmatten für Dachbegrünung',
  703: 'Färber-Waid', 704: 'Kanariensaat/Echtes Glanzgras',
  705: 'Virginischer Tabak', 706: 'Mohn (Schlafmohn, Backmohn)',
  707: 'Erdbeeren', 708: 'Färberdisteln',
  709: 'Brennnesseln (Große Brennnessel)', 710: 'Färberkrapp (Rubia tinctorum)',

  718: 'beetweiser Anbau Zierpflanzen bis 4 Kulturen',
  720: 'beetweiser Anbau von Zierpflanzen ab 5 Kulturen',
  721: 'Goldlack', 722: 'Einjähriges Silberblatt', 723: 'Garten-/Sommerlevkoje',
  724: 'Kugelamarant (Echter Kugelamarant)', 725: 'Taglilien (Essbare Taglilie)',
  726: 'Lilien (Türkenbund)', 727: 'Narzissen / Osterglocken', 728: 'Bischofskraut',
  729: 'Hasenohren (rundblättriges Hasenohr)',
  730: 'Seidenpflanzen (Indianer-Seidenpflanze)', 731: 'Hyazinthe (Garten-Hyazinthe)',
  732: 'Milchstern', 733: 'Astern (Sommeraster)',
  734: 'Chrysanthemen (Garten-Chrysantheme, Winteraster)', 735: 'Strohblumen',
  736: 'Edelweiß', 737: 'Margeriten',
  738: 'Rudbeckien (Schwarzäugige Rudbeckie/Sonnenhut, Leuchtender Sonnenhut, Schlitzblättriger Sonnenhut)',
  739: 'Tagetes/Studentenblume', 740: 'Wucherblumen (Mutterkraut)',
  741: 'Strandflieder (Geflügelter Strandflieder)',
  742: 'Spreublumen (Einjährige Papierblume)', 743: 'Zinnien',
  744: 'Taubnesseln (Weiße Taubnessel)', 745: 'Gladiolen', 746: 'Tulpen',
  747: 'Trauben-Silberkerze', 748: 'Rittersporn',
  749: 'Skabiosen', 750: 'Dahlien', 751: 'Rosenwurz',
  752: 'Krokusse (Safran, Garten-Krokus)', 753: 'Hibiskus (Chinesischer Roseneibisch)',
  754: 'Strauch-/Bechermalven (Bechermalve)', 755: 'Wolfsmilch',
  756: 'Löwenmäulchen (Großes Löwenmaul)', 757: 'Montbretien',
  758: 'Halskräuter (Blaues Halskraut)', 759: 'Gipskräuter (Schleierkraut)',
  760: 'Pampasgräser (Amerikanisches Pampasgras)',
  761: 'Kosmeen (Gemeines Schmuckkörbchen)', 762: 'Nachtkerzen (Diptam)',
  763: 'Nachtkerzen (Oenothera)', 764: 'Königskerzen (Großblütige Königskerze)',
  765: 'Kapuzinerkresse',
  766: 'Pfingstrosen/Päonien (Gemeine Pfingstrose, Strauch-Pfingstrose)',
  767: 'Schwertlilien (Deutsche Schwertlilie)',
  768: 'Wiesenknopf (Kleiner Wiesenknopf, Pimpinelle)',
  769: 'Zieste (Deutscher Ziest, Knollen-Ziest)',
  770: 'Vergissmeinnicht (Wald-Vergissmeinnicht)', 771: 'Portulak',
  772: 'Nelken (Bartnelke, Land-/Edelnelke)',
  773: 'Gewöhnlicher Leberbalsam (Ageratum)', 774: 'Gelber Leberbalsam (Lonas)',
  775: 'Kornblumen',
  776: 'Veilchen (Horn-Veilchen, Garten-Stiefmütterchen, Wildes Stiefmütterchen)',
  777: 'Phacelia (als Hauptkultur z.B. Saatgutvermehrung)', 778: 'Alpendistel',
  779: 'Amacrinum', 780: 'Begonien', 781: 'Calla/Drachenwurz',
  782: 'Glockenblumen (Campanula)', 783: 'Schildblume (Chelone)',
  784: 'Christrose-/Schnee-/Weihnachtsrose, Korischer Nieswurz', 785: 'Eukalyptus',
  786: 'Fingerhut', 787: 'Fuchsien', 788: 'Geranien',
  789: 'Veronica/Hebe/Ehrenpreis',
  790: 'Anemonen (Herbstanemone, Japanische Anemone)', 791: 'Knollenbegonien',
  792: 'Kornrade', 793: 'Leimkraut/Taubenkropf-Leimkraut', 794: 'Orchideen',
  795: 'Pelargonien', 796: 'Fetthenne, Mauerpfeffer (Sedum)', 797: 'Rhizinus',
  798: 'Ramtillkraut', 799: 'Husarenknopf (Sanvitalia)',
  510: 'Goldrute (Solidago)', 511: 'Streptocarpus/Drehfrucht',
  512: 'Iberischer Drachenkopf', 513: 'Braunellen', 514: 'Hauswurz (Sempervivum)',
  515: 'Mühlenbeckia/Drahtsträucher', 516: 'Knöterich (Persicaria)',
  517: 'Garten-Petunie', 518: 'Polygonum', 519: 'Köcherblümchen (Cuphea)',
  520: 'Silberbrandschopf',

  802: 'Silphium (Durchwachsene Silphie, Becherpflanze)', 803: 'Sudangras',
  804: 'Virginiamalve', 805: 'Staudenknöterich, Igniscum',
  806: 'Rutenhirse/Switchgras', 852: 'Chinaschilf/Miscanthus',
  853: 'Riesenweizengras/Szarvasi-Gras/Hirschgras', 854: 'Rohrglanzgras',
  866: 'Pflanzenmischung mit Hanf', 871: 'Wildpflanzenmischung zur Energieerzeugung',

  821: 'Kern- und Steinobst', 825: 'Kernobst z.B. Äpfel, Birnen',
  826: 'Steinobst, z. B. Kirschen, Pflaumen',
  827: 'Beerenobst, z.B. Johannis-, Stachel-, Himbeeren',
  829: 'Sonstige Obstanlagen z.B. Holunder, Aronia, Maulbeeren',
  833: 'Haselnüsse', 834: 'Walnüsse', 835: 'sonstige Schalenfrüchte',
  838: 'Baumschulen, nicht für Beerenobst',
  839: 'Beerenobst zur Vermehrung (in Baumschulen)', 841: 'KUP lt. GAPDZV',
  843: 'Bestockte Rebfläche', 844: 'Unbestockte Rebfläche', 845: 'Rebschulfläche',
  846: 'Unterlagsrebfläche', 848: 'Tafeltrauben', 850: 'Sonstige Dauerkulturen',
  851: 'Rhabarber', 856: 'Hopfen',
  859: 'Hopfen vorübergehend stillgelegt (Gerüst steht noch)', 860: 'Spargel',
  861: 'Artischocke', 862: 'Heidekraut', 863: 'Rosen (Baumschulen), Schnittrosen',
  864: 'Rhododendron', 865: 'Trüffel',

  41: 'Wiesen Umwandlung AUKM (Ackerstatus)',
  42: 'Mähweiden Umwandlung AUKM (Ackerstatus)',
  43: 'Weiden Umwandlung AUKM (Ackerstatus)',
  44: 'Hutung Umwandlung AUKM (Ackerstatus)',
  48: 'Streuobstwiese Umwandlung AUKM (Ackerstatus)',
  470: 'Grünland Zielflächen für ganzjährige Weidehaltung VN Grünland ohne BF',
  849: 'Weinbergbrache AUKM', 915: 'Ackerrandstreifen und Blühflächen',
  928: 'Saum- und Bandstrukturen',

  920: 'Haus- und Nutzgärten', 930: 'Bewirtschaftete Gewässer/Teichflächen',
  940: 'Unbewirtschaftes Gewässer', 941: 'Gründüngung im Hauptfruchtanbau',
  960: 'Dämme und Deiche',
  980: 'Pilzbeet- und Gemüseflächen in Gebäuden (nicht im Gewächshaus)',
  981: 'Hof-, Wege- und Gebäudefläche', 982: 'Abbau-/Öd-/Un-/Geringstland',
  983: 'Weihnachtsbäume', 990: 'Alle anderen Flächen (keine LF)',
  991: 'Nicht landwirt. Flächen in der Verfügungsgewalt des Antragstellers, die gemäß GAPKondV als umweltsensibles Dauergrünland bestimmt worden sind',
  994: 'Vorübergehende, unbefestigte Mieten, Stroh-, Futter- oder Dunglagerplätze auf DGL',
  995: 'Forstflächen (Waldbodenflächen)',
  996: 'Vorübergehende, unbefestigte Mieten, Stroh-, Futter oder Dunglagerplätze auf AL'
};

// Registry: für jedes bekannte Bundesland-Shapefile-Format (erkennbar an
// einem charakteristischen DBF-Feld, siehe FIELD_CANDIDATES-Kommentar oben)
// das Feld mit dem rohen Nutzungscode und die zugehörige amtliche
// Code->Klartext-Tabelle. codeField ist bewusst jeweils ein Feldname, den
// FIELD_CANDIDATES.kultur bereits kennt — pickField() findet den übersetzten
// Klartext dadurch automatisch, ohne dass FIELD_CANDIDATES selbst geändert
// werden muss.
const BUNDESLAND_NC_CONFIGS = [
  // Bayern läuft separat über mergeFeldstueckNutzung() (zwei-Shapefile-Format).
  {
    name: 'Baden-Württemberg',
    quelle: 'https://www.rv.de/.../2026 GA - Nutzcodeliste.pdf',
    codeField: 'nutz_code',
    table: BW_NUTZUNGSCODE_KLARTEXT,
    detect: props => 'nutz_code' in props
  },
  {
    name: 'Sachsen',
    quelle: 'https://www.landwirtschaft.sachsen.de/download/SN26_FV_NC.pdf',
    codeField: 'SC_HA_CODE',
    table: SACHSEN_NUTZUNGSCODE_KLARTEXT,
    detect: props => 'SC_HA_CODE' in props
  },
  // Sachsen liefert Teilflächen in einem eigenen DBF (_teilflaechen.dbf) mit dem
  // Code im Feld "NC" statt "SC_HA_CODE" — nur zusammen mit "TF_TYP" erkennen,
  // damit ein generisches "NC"-Feld aus anderen Bundesländern nicht fälschlich matcht.
  {
    name: 'Sachsen (Teilflächen)',
    quelle: 'https://www.landwirtschaft.sachsen.de/download/SN26_FV_NC.pdf',
    codeField: 'NC',
    table: SACHSEN_NUTZUNGSCODE_KLARTEXT,
    detect: props => 'NC' in props && 'TF_TYP' in props
  },
  {
    name: 'Hessen',
    quelle: 'https://www.wibank.de/.../merkblatt-zum-ga-2026-data.pdf (ab S. 67)',
    codeField: 'ncode_aktu',
    table: HESSEN_NUTZUNGSCODE_KLARTEXT,
    detect: props => 'ncode_aktu' in props
  },
  {
    name: 'Rheinland-Pfalz',
    quelle: 'https://add.rlp.de/.../KTA-Liste_RP_2026.pdf',
    codeField: 'KTA_AJ',
    table: RP_NUTZUNGSCODE_KLARTEXT,
    detect: props => 'KTA_AJ' in props
  },
  // NRW: Kulturart steckt normalerweise nicht im DBF, sondern (falls die
  // Begleit-XML im Zip liegt) direkt als Klartext in der NTNW-XML, siehe
  // extractNrwNutzungMap()/mergeNrwNutzung() weiter unten. Diese Tabelle
  // dient nur als Fallback für den seltenen Fall, dass NCODE doch einmal
  // roh im DBF steht.
  {
    name: 'Nordrhein-Westfalen',
    quelle: 'https://www.landwirtschaftskammer.de/.../mb-sammelantrag-2026-flaechenverzeichnis-hinweise.pdf (ab S. 4)',
    codeField: 'NCODE',
    table: NRW_NUTZUNGSCODE_KLARTEXT,
    detect: props => 'NCODE' in props
  }
];

function translateNutzungscodeMitTabelle(rawCode, table) {
  const n = parseInt(String(rawCode).trim(), 10);
  if (!isFinite(n)) return null;
  return table[n] || null;
}

// Erkennt anhand der vorhandenen Felder, aus welchem der oben registrierten
// Bundesland-Formate ein Feature stammt, und übersetzt den rohen
// Nutzungscode direkt im selben Feld in Klartext (Rohcode bleibt zusätzlich
// unter "<Feld>_Code" erhalten). Unbekannte Codes bleiben bewusst
// unverändert stehen statt eine erfundene Übersetzung zu zeigen.
function applyBundeslandNutzungscode(props) {
  for (const cfg of BUNDESLAND_NC_CONFIGS) {
    if (!cfg.detect(props)) continue;
    const raw = props[cfg.codeField];
    if (!raw) return;
    const klartext = translateNutzungscodeMitTabelle(raw, cfg.table);
    if (klartext) {
      props[cfg.codeField + '_Code'] = raw;
      props[cfg.codeField] = klartext;
    }
    return;
  }
}

// Manche Bundesländer (z.B. Bayern) exportieren "Feldstueck" (Geometrie +
// Name) und "Nutzung" (Kulturart-Code) als zwei separate, geometrisch
// identische Shapefiles im selben Zip statt einer gemeinsamen Ebene. Ohne
// Zusammenführung entstehen zwei sich exakt überlappende Ebenen, die je nur
// die Hälfte der Information zeigen (Feldstück: Name, kein Kulturart;
// Nutzung: Kulturart, kein Name). Wir verknüpfen sie hier über die
// gemeinsame Feldstück-ID (FID, mit FSNr als Fallback) zu einer Ebene und
// übersetzen dabei den Nutzungscode direkt in die Kulturart im Klartext
// (nur für dieses bayerische Format gültig, siehe BAYERN_NUTZUNGSCODE_KLARTEXT).
function mergeFeldstueckNutzung(results) {
  const feldIdx = results.findIndex(r => /feldst(ü|ue)ck/i.test(r.name));
  const nutzIdx = results.findIndex(r => /^nutzung/i.test(r.name));
  if (feldIdx === -1 || nutzIdx === -1) return results;

  const keyOf = (props) => String(props.FID ?? props.Fid ?? props.fid ?? '') + '|' + String(props.FSNr ?? props.Fsnr ?? props.fsnr ?? '');

  const nutzung = results[nutzIdx];
  const nutzByKey = new Map();
  (nutzung.fc.features || []).forEach(f => {
    const props = f.properties || {};
    const key = keyOf(props);
    if (!nutzByKey.has(key)) nutzByKey.set(key, props);
  });

  const feldstueck = results[feldIdx];
  const mergedFeatures = (feldstueck.fc.features || []).map(f => {
    const props = { ...(f.properties || {}) };
    const nutzProps = nutzByKey.get(keyOf(props));
    if (nutzProps) Object.assign(props, nutzProps);
    // Nutzung enthält bislang nur den rohen Nutzungscode (z.B. "115") — in
    // die Kulturart im Klartext übersetzen, roh-Code als NutzungCode für
    // Nachvollziehbarkeit zusätzlich aufheben. Unbekannte Codes (z.B. neu
    // hinzugekommene, noch nicht in der Liste erfasste) bleiben unverändert
    // als Code stehen statt eine erfundene Übersetzung zu zeigen.
    if (props.Nutzung) {
      const klartext = bayernNutzungscodeKlartext(props.Nutzung);
      if (klartext) {
        props.NutzungCode = props.Nutzung;
        props.Nutzung = klartext;
      }
    }
    return { ...f, properties: props };
  });

  const merged = { name: feldstueck.name, fc: { type: 'FeatureCollection', features: mergedFeatures } };
  const rest = results.filter((_, i) => i !== feldIdx && i !== nutzIdx);
  return [merged, ...rest];
}

// Baut den featureIndex-Eintrag für ein einzelnes Feature einer Ebene und
// verdrahtet dessen Klick-Handler + Labelanker — von addLayer() für den
// Erstaufbau und von addFeatureToLayer() für nachträglich einzeln
// hinzugefügte Features (z.B. im Flächenzeichner gezeichnete Flächen)
// gemeinsam genutzt, damit beide Wege exakt dieselbe Eintragsform erzeugen.
// Ein Fotoeintrag ist {path, name} (name = Jahr_Betrieb_Art-Anzeigename,
// siehe zuordnungFileName) — ältere gespeicherte Stände kennen nur den
// nackten Storage-Pfad als String, daher hier normalisieren statt überall
// sonst zwei Formen unterscheiden zu müssen.
function normalizePhotoEntry(v) {
  return typeof v === 'string' ? { path: v, name: null } : v;
}

// Liest die Foto-Pfadliste robust aus GeoJSON-properties ein — normalerweise
// bereits ein Array (siehe setParcelNotes/addParcelPhoto unten), aber falls
// eine Datei extern bearbeitet oder manuell hochgeladen wurde, auch ein
// JSON-String oder ein fehlerhafter Wert möglich, statt daran zu crashen.
function parsePhotoList(value) {
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string' || (v && typeof v.path === 'string')).map(normalizePhotoEntry);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string' || (v && typeof v.path === 'string')).map(normalizePhotoEntry) : [];
    } catch { return []; }
  }
  return [];
}

// Ein Kulturplan-Eintrag: { id, jahr, kultur, startMonth, endMonth, duengung }
// — startMonth/endMonth sind 1-12 (Monatsraster, siehe Anbauplanung weiter
// unten). Liest robust wie parsePhotoList, statt bei kaputten/fremden Daten
// abzustürzen.
function parseKulturplan(value) {
  const isValid = e => e && typeof e === 'object' && typeof e.kultur === 'string'
    && Number.isFinite(e.startMonth) && Number.isFinite(e.endMonth) && Number.isFinite(e.jahr);
  if (Array.isArray(value)) return value.filter(isValid);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(isValid) : [];
    } catch { return []; }
  }
  return [];
}

function buildFeatureEntry(feature, lyr, layerId, layerName, isTeilflaechen, color) {
  const props = feature.properties || {};
  const center = lyr.getBounds ? lyr.getBounds().getCenter() : lyr.getLatLng();
  const entry = {
    idx: featureIndex.length,
    id: 'feat-' + (featureEntryCounter++), // stabile Kennung, bleibt gültig auch wenn andere Einträge entfernt werden und .idx sich verschiebt
    layerId,
    layerName,
    isTeilflaechen,
    props,
    center,
    leafletLayer: lyr,
    labelAnchor: null,
    color,
    nummer: pickField(props, FIELD_CANDIDATES.nummer),
    featName: pickField(props, FIELD_CANDIDATES.name),
    groesse: pickGroesse(props),
    kultur: pickField(props, FIELD_CANDIDATES.kultur),
    flaechenId: pickField(props, FIELD_CANDIDATES.flaechenid),
    besichtigt: false,
    notes: typeof props.feldfolio_notes === 'string' ? props.feldfolio_notes : '',
    photos: parsePhotoList(props.feldfolio_photos),
    kulturplan: parseKulturplan(props.feldfolio_kulturplan)
  };
  featureIndex.push(entry);
  // Solange ein Flächen-Werkzeug (Bearbeiten/Löschen/Teilen) in der
  // Werkzeugleiste über der Karte aktiv ist, lenkt ein Klick auf die Fläche
  // dieses Werkzeug um, statt sie nur auszuwählen — siehe mapToolMode weiter
  // oben und die Werkzeugleisten-Verdrahtung weiter unten.
  lyr.on('click', () => {
    if (mapToolMode === 'edit') { toggleShapeEdit(entry); return; }
    if (mapToolMode === 'delete') { deleteShapeViaTool(entry); return; }
    if (mapToolMode === 'split') { mapToolMode = null; updateShapeToolbar(); startParcelSplit(entry); return; }
    // Selbst gezeichnete Flächen (Flächenzeichner) landen technisch als ganz
    // normaler Eintrag in derselben layers-Ebenenliste wie hochgeladene
    // Shapefiles (siehe addFeatureToLayer) — ein Klick darauf soll aber
    // direkt in den Flächenzeichner wechseln statt nur die Viewer-Tabelle zu
    // öffnen, damit man sie dort sofort bearbeiten kann.
    if (zeichnerParcels.some(p => p.id === entry.id)) {
      highlightFeature(entry);
      setActiveSegment('zeichner');
      const row = document.querySelector(`#zeichner-list [data-id="${entry.id}"]`)?.closest('.parcel-item');
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    highlightFeature(entry);
    selectFeatureInTable(entry);
  });
  const labelText = escapeHtml(entry.nummer) + (entry.featName ? '<br>' + escapeHtml(entry.featName) : '');
  if (labelText.trim()) entry.labelAnchor = createLabelAnchorAt(center, labelText);
  // Leaflet.draw stattet jedes Polygon automatisch mit einer .editing-Instanz
  // aus (L.Edit.Poly), unabhängig davon, ob es gezeichnet, hochgeladen oder
  // aus der Cloud wiederhergestellt wurde — universell hier verdrahtet, damit
  // "Form bearbeiten" für JEDE Fläche verfügbar ist (siehe toggleShapeEdit
  // weiter unten). Das 'edit'-Ereignis feuert bei jedem Eckpunkt-Zug.
  lyr.on('edit', () => syncShapeGeometryLive(entry));
  return entry;
}

function addLayer(name, geojson) {
  const id = 'layer-' + (layerCounter++);
  const color = COLORS[colorIdx % COLORS.length];
  colorIdx++;
  // Teilflächen sind Detail-Unterteilungen einzelner Parzellen — standardmäßig
  // aus, da meist nur die Parzellen selbst von Interesse sind. Über den
  // Sichtbarkeits-Schalter in der Ebenenliste bzw. die Checkbox in der
  // Tabelle bleiben sie optional zuschaltbar.
  const isTeilflaechen = /teilfl(ä|ae)che/i.test(name);
  const startVisible = !isTeilflaechen;

  // Labelanker (Nummer + Name je Fläche, wie im Jahresvergleich) können erst
  // NACH dem L.geoJSON()-Aufruf zur Gruppe hinzugefügt werden — onEachFeature
  // läuft synchron WÄHREND des Konstruktoraufrufs, die Variable leafletLayer
  // ist zu diesem Zeitpunkt noch nicht zugewiesen.
  const labelAnchors = [];
  const builtEntries = [];

  const leafletLayer = L.geoJSON(geojson, {
    // Canvas- statt SVG-Renderer für alle Ebenen — verhindert einen html2canvas/
    // Leaflet-Eigenheit-Bug, bei dem der SVG-Overlay-Pane beim Flächenkarten-
    // Export versetzt zu den Kartenkacheln landet (siehe captureParcelScreenshot).
    renderer: L.canvas(),
    style: () => ({ color: color, weight: 1.6, fillColor: color, fillOpacity: 0.22 }),
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 5, color: color, weight: 1.6, fillColor: color, fillOpacity: 0.6
    }),
    onEachFeature: (feature, lyr) => {
      const entry = buildFeatureEntry(feature, lyr, id, name, isTeilflaechen, color);
      if (entry.labelAnchor) labelAnchors.push(entry.labelAnchor);
      builtEntries.push(entry);
    }
  });
  labelAnchors.forEach(anchor => leafletLayer.addLayer(anchor));
  if (startVisible) leafletLayer.addTo(map);

  let count = 0;
  (geojson.features || []).forEach(() => count++);

  layers[id] = { name, geojson, leafletLayer, color, visible: startVisible, isTeilflaechen, count };
  // Eine wiederhergestellte/erneut hochgeladene "Flächenzeichner"-Ebene (z.B.
  // nach Neuladen oder Betrieb-Wechsel) muss ihre Flächen wieder in
  // zeichnerParcels eintragen, sonst kennt der Flächenzeichner sie nicht mehr
  // (keine "Form bearbeiten"/"Teilen"-Buttons in dessen eigener Liste, und die
  // Nummerierung neu gezeichneter Flächen würde wieder bei 1 anfangen, siehe
  // nextZeichnerNummer()).
  if (name === 'Flächenzeichner' && !isTeilflaechen) {
    zeichnerLayerId = id;
    // areaHa ist ein Flächenzeichner-eigenes Feld (buildFeatureEntry kennt nur
    // das allgemeine groesse-Feld) — für wiederhergestellte Flächen fehlt es
    // sonst und lässt renderParcelList() beim Formatieren abstürzen.
    builtEntries.forEach(entry => { entry.areaHa = turf.area(entry.leafletLayer.toGeoJSON()) / 10000; });
    zeichnerParcels.push(...builtEntries);
  }
  renderLayerList();
  renderFeatureTable();
  renderParcelList();
  fitAllLayers();
  // Neue Fläche könnte bereits gesetzte Obstbäume neu "einfangen" — ohne
  // geladene Flächen bleiben Bäume sonst dauerhaft ohne Flächen-Zuordnung,
  // auch wenn später passende Flächen nachgeladen werden.
  reassignAllTreesToParcels();
}

// Fügt EIN Feature nachträglich zu einer bereits bestehenden Ebene hinzu
// (statt eine komplette neue Ebene aufzubauen) — genutzt vom Flächenzeichner,
// dessen gezeichnete Flächen einzeln nacheinander entstehen. L.GeoJSON.addData()
// ruft onEachFeature für nur das neue Feature erneut auf und hängt es an die
// bestehende Layer-Gruppe an, ohne die vorhandenen Features neu aufzubauen.
function addFeatureToLayer(layerId, feature, colorOverride) {
  const l = layers[layerId];
  const color = colorOverride || l.color;
  let newEntry = null;
  const onEachFeature = (feat, lyr) => {
    newEntry = buildFeatureEntry(feat, lyr, layerId, l.name, l.isTeilflaechen, color);
    if (colorOverride && lyr.setStyle) lyr.setStyle({ color: colorOverride, fillColor: colorOverride });
    if (newEntry.labelAnchor) l.leafletLayer.addLayer(newEntry.labelAnchor);
  };
  // L.GeoJSON merkt sich seine Konstruktor-Optionen nicht für addData() erneut
  // nutzbar, daher hier direkt per Handler statt über die Layer-eigene Option.
  l.leafletLayer.options.onEachFeature = onEachFeature;
  l.leafletLayer.addData(feature);
  delete l.leafletLayer.options.onEachFeature;
  l.geojson.features.push(feature);
  l.count++;
  renderLayerList();
  renderFeatureTable();
  reassignAllTreesToParcels();
  return newEntry;
}

// Entfernt genau EIN Feature aus seiner Ebene (im Unterschied zu removeLayer(),
// das immer die ganze Ebene entfernt) — für die Einzel-Löschung gezeichneter
// Flächen im Flächenzeichner.
function removeFeatureEntry(entry) {
  const l = layers[entry.layerId];
  if (!l) return;
  l.leafletLayer.removeLayer(entry.leafletLayer);
  if (entry.labelAnchor) l.leafletLayer.removeLayer(entry.labelAnchor);
  l.geojson.features = l.geojson.features.filter(f => f !== entry.leafletLayer.feature);
  l.count--;
  const idx = featureIndex.indexOf(entry);
  if (idx !== -1) featureIndex.splice(idx, 1);
  featureIndex.forEach((e, i) => e.idx = i);
  if (highlightedEntry === entry) highlightedEntry = null;
  renderLayerList();
  renderFeatureTable();
  reassignAllTreesToParcels();
}

// Aktualisiert Name/Kulturart eines Eintrags nachträglich — nur für
// Flächenzeichner-Flächen relevant, deren Name/Kulturart frei eintragbar
// sind (uploadete Flächen sind aus der DBF abgeleitet und nicht editierbar).
function updateDrawnParcelEntry(entry, { name, kultur }) {
  if (name !== undefined) { entry.featName = name; entry.props.NAME = name; }
  if (kultur !== undefined) { entry.kultur = kultur; entry.props.KULTURART = kultur; }
  if (entry.leafletLayer.feature) entry.leafletLayer.feature.properties = entry.props;
  if (entry.labelAnchor && entry.labelAnchor.setTooltipContent) {
    const labelText = escapeHtml(entry.nummer) + (entry.featName ? '<br>' + escapeHtml(entry.featName) : '');
    entry.labelAnchor.setTooltipContent(labelText);
  }
  renderFeatureTable();
}

// Schreibt Notiz/Fotos einer Fläche synchron in entry.props UND
// leafletLayer.feature.properties zurück (gleiches Muster wie
// updateDrawnParcelEntry oben) — dadurch landet die Änderung automatisch im
// geteilten layers[id].geojson (dieselbe Objektreferenz) und damit ohne
// zusätzlichen Code auch in serializeCurrentState() fürs Cloud-Speichern.
function setParcelNotes(entry, notes) {
  entry.notes = notes;
  entry.props.feldfolio_notes = notes;
  if (entry.leafletLayer.feature) entry.leafletLayer.feature.properties = entry.props;
}

// name (optional) ist der Anzeige-/Downloadname nach dem Jahr_Betrieb_Art-
// Schema (siehe zuordnungFileName weiter unten) — null, wenn beim Hochladen
// kein Betrieb/Termin zugeordnet war.
function addParcelPhoto(entry, path, name) {
  entry.photos.push({ path, name: name || null });
  entry.props.feldfolio_photos = entry.photos;
  if (entry.leafletLayer.feature) entry.leafletLayer.feature.properties = entry.props;
}

function removeParcelPhoto(entry, path) {
  entry.photos = entry.photos.filter(p => p.path !== path);
  entry.props.feldfolio_photos = entry.photos;
  if (entry.leafletLayer.feature) entry.leafletLayer.feature.properties = entry.props;
}

// Gleiches Muster wie setParcelNotes — schreibt den kompletten Kulturplan
// (alle Jahre) synchron in entry.props zurück, damit er automatisch mit dem
// geteilten layers[id].geojson und damit dem Cloud-Speichern mitreist.
function setParcelKulturplan(entry, plan) {
  entry.kulturplan = plan;
  entry.props.feldfolio_kulturplan = plan;
  if (entry.leafletLayer.feature) entry.leafletLayer.feature.properties = entry.props;
}

function renderLayerList() {
  const list = document.getElementById('layer-list');
  const ids = Object.keys(layers);
  document.getElementById('empty-hint').style.display = ids.length ? 'none' : 'block';
  list.innerHTML = '';
  ids.forEach(id => {
    const l = layers[id];
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.innerHTML = `
      <div class="layer-row">
        <div class="vis-toggle ${l.visible ? 'on' : ''}" data-id="${id}" data-action="toggle">
          <svg viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>
        </div>
        <div class="swatch" style="background:${l.color}"></div>
        <div class="layer-name" title="${l.name}">${l.name}</div>
        <div class="layer-count">${l.count}</div>
      </div>
      <div class="layer-actions">
        <button data-id="${id}" data-action="zoom">Zoom</button>
        <button data-id="${id}" data-action="table">Tabelle</button>
        <button data-id="${id}" data-action="remove" class="danger">Entfernen</button>
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const action = el.getAttribute('data-action');
      if (action === 'toggle') toggleLayer(id);
      if (action === 'zoom') zoomToLayer(id);
      if (action === 'table') openFeatureTable();
      if (action === 'remove') removeLayer(id);
    });
  });
}

function toggleLayer(id) {
  const l = layers[id];
  l.visible = !l.visible;
  if (l.visible) l.leafletLayer.addTo(map);
  else map.removeLayer(l.leafletLayer);
  renderLayerList();
}

function zoomToLayer(id) {
  const l = layers[id];
  const b = l.leafletLayer.getBounds();
  if (b.isValid()) map.fitBounds(b, { padding: [24, 24] });
}

function removeLayer(id) {
  const l = layers[id];
  map.removeLayer(l.leafletLayer);
  delete layers[id];
  // zugehörige Einträge aus dem Flächen-Index entfernen
  for (let i = featureIndex.length - 1; i >= 0; i--) {
    if (featureIndex[i].layerId === id) {
      if (highlightedEntry === featureIndex[i]) highlightedEntry = null;
      if (shapeEditingEntryId === featureIndex[i].id) shapeEditingEntryId = null;
      featureIndex.splice(i, 1);
    }
  }
  featureIndex.forEach((entry, i) => { entry.idx = i; }); // Indizes neu durchnummerieren
  // Wird die komplette Flächenzeichner-Ebene entfernt (z.B. über "Entfernen"
  // in der Ebenenliste statt einzeln über den Flächenzeichner), müssen ihre
  // Einträge auch aus zeichnerParcels verschwinden — sonst blieben dort
  // Karteileichen mit toten leafletLayer-Referenzen zurück.
  if (id === zeichnerLayerId) {
    zeichnerLayerId = null;
    zeichnerParcels.length = 0;
    renderParcelList();
  } else {
    for (let i = zeichnerParcels.length - 1; i >= 0; i--) {
      if (zeichnerParcels[i].layerId === id) zeichnerParcels.splice(i, 1);
    }
  }
  renderLayerList();
  renderFeatureTable();
  reassignAllTreesToParcels(); // Bäume, deren Fläche gerade entfernt wurde, wieder als "ohne Fläche" markieren
}

function fitAllLayers() {
  const ids = Object.keys(layers).filter(id => layers[id].visible);
  if (!ids.length) return;
  let bounds = null;
  ids.forEach(id => {
    const b = layers[id].leafletLayer.getBounds();
    if (b.isValid()) bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
  });
  if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
}

function googleMapsDirectionsUrl(lat, lng) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '&travelmode=driving';
}

function highlightFeature(entry) {
  if (highlightedEntry && highlightedEntry.leafletLayer.setStyle) {
    highlightedEntry.leafletLayer.setStyle({ color: highlightedEntry.color, weight: 1.6 });
  }
  if (entry.leafletLayer.setStyle) {
    entry.leafletLayer.setStyle({ color: '#ffffff', weight: 4 });
  }
  highlightedEntry = entry;
}

function getVisibleFeatureRows() {
  const includeTeilflaechen = document.getElementById('table-include-teilflaechen').checked;
  return featureIndex
    .filter(entry => includeTeilflaechen || !entry.isTeilflaechen)
    .slice()
    .sort((a, b) => {
      if (a.layerName !== b.layerName) return a.layerName.localeCompare(b.layerName);
      return String(a.nummer).localeCompare(String(b.nummer), undefined, { numeric: true });
    });
}

function renderFeatureTable() {
  const tbody = document.getElementById('feature-table-body');
  const rows = getVisibleFeatureRows();
  document.getElementById('table-count').textContent = rows.length;
  renderBesichtigtSummary('table-besichtigt-summary', rows);

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="color:var(--muted); padding:14px;">' +
      (featureIndex.length ? 'Keine Flächen in dieser Ansicht (Teilflächen sind ausgeblendet).' : 'Noch keine Flächen geladen.') +
      '</td></tr>';
    return;
  }

  const treeCounts = computeObstbaumParcelTreeCounts();
  tbody.innerHTML = rows.map(entry => {
    const num = parseFloat(String(entry.groesse).replace(',', '.'));
    const groesseText = isFinite(num) ? num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha' : (entry.groesse || '–');
    const routeCell = entry.center
      ? `<a class="table-route-link" href="${googleMapsDirectionsUrl(entry.center.lat, entry.center.lng)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Route <span class="material-symbols-rounded icon">open_in_new</span></a>`
      : '–';
    const counts = treeCounts.get(entry.id);
    const treesCell = counts && counts.size
      ? [...counts.entries()].map(([key, n]) => fruitChipHtml(key, ` <span class="n">${n}</span>`)).join('')
      : '<span style="color:var(--muted);">–</span>';
    const hasNotes = entry.notes || entry.photos.length;
    const hasKulturplan = entry.kulturplan.length > 0;
    return `<tr data-idx="${entry.idx}">
      <td>${escapeHtml(entry.nummer || '–')}</td>
      <td>${escapeHtml(entry.featName || '–')}</td>
      <td>${escapeHtml(entry.flaechenId || '–')}</td>
      <td>${groesseText}</td>
      <td>${escapeHtml(entry.kultur || '–')}</td>
      <td>${treesCell}</td>
      <td class="besichtigt-cell"><input type="checkbox" class="besichtigt-checkbox" ${entry.besichtigt ? 'checked' : ''} onclick="event.stopPropagation()"></td>
      <td><button class="notes-btn${hasNotes ? ' has-notes' : ''}" data-action="notes" data-idx="${entry.idx}" onclick="event.stopPropagation()" title="Notiz &amp; Fotos"><span class="material-symbols-rounded icon">sticky_note_2</span></button></td>
      <td><button class="notes-btn${hasKulturplan ? ' has-notes' : ''}" data-action="kulturplan" data-idx="${entry.idx}" onclick="event.stopPropagation()" title="Anbauplanung"><span class="material-symbols-rounded icon">eco</span></button></td>
      <td>${routeCell}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
    tr.addEventListener('click', () => selectFeatureFromTable(parseInt(tr.getAttribute('data-idx'), 10)));
  });
  tbody.querySelectorAll('.besichtigt-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.closest('tr').getAttribute('data-idx'), 10);
      featureIndex[idx].besichtigt = cb.checked;
      renderBesichtigtSummary('table-besichtigt-summary', getVisibleFeatureRows());
    });
  });
  tbody.querySelectorAll('[data-action="notes"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      openNotesModal('parcel', featureIndex[idx]);
    });
  });
  tbody.querySelectorAll('[data-action="kulturplan"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      openKulturplanModal(featureIndex[idx]);
    });
  });
}

function highlightTableRow(idx) {
  document.querySelectorAll('#feature-table-body tr.row-selected').forEach(r => r.classList.remove('row-selected'));
  const row = document.querySelector('#feature-table-body tr[data-idx="' + idx + '"]');
  if (row) row.classList.add('row-selected');
}

// Öffnet/holt die Tabellen-Bodenleiste nach vorn und markiert die Zeile der
// angeklickten Fläche — ersetzt das frühere separate Attribut-Panel.
function selectFeatureInTable(entry) {
  featureTablePanel.open();
  renderFeatureTable();
  const row = document.querySelector('#feature-table-body tr[data-idx="' + entry.idx + '"]');
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  highlightTableRow(entry.idx);
}

function selectFeatureFromTable(idx) {
  const entry = featureIndex[idx];
  if (!entry) return;
  highlightFeature(entry);
  highlightTableRow(entry.idx);
  const lyr = entry.leafletLayer;
  if (lyr.getBounds) {
    map.fitBounds(lyr.getBounds(), { padding: [40, 40], maxZoom: 17 });
  } else if (lyr.getLatLng) {
    map.setView(lyr.getLatLng(), 17);
  }
}

document.getElementById('table-include-teilflaechen').addEventListener('change', renderFeatureTable);

const TABLE_DEFAULT_HEIGHT = 320;
const TABLE_MIN_HEIGHT = 140;

// Verkabelt ein Bodenleisten-Panel (Viewer-Tabelle & Vergleichs-Tabelle nutzen
// exakt dasselbe Verhalten: auf-/zuklappen, minimieren, per Ziehgriff
// größenändern) — als Fabrik statt Duplikat, damit beide Panels garantiert
// gleich funktionieren.
function initResizablePanel({ panel, handle, minimizeBtn, closeBtn, boundsWrap, minHeight, defaultHeight }) {
  let lastExpandedHeight = defaultHeight;

  function open() {
    panel.classList.remove('minimized');
    // Gegen dieselbe 85%-Grenze wie beim Ziehen deckeln — auf kurzen (mobilen)
    // Bildschirmen wäre die feste defaultHeight (320px) sonst oft größer als
    // die ganze Karte.
    const maxHeight = boundsWrap.getBoundingClientRect().height * 0.85;
    panel.style.height = Math.min(lastExpandedHeight, maxHeight) + 'px';
    minimizeBtn.querySelector('.icon').textContent = 'expand_more';
    panel.classList.add('open');
  }

  function close() { panel.classList.remove('open'); }
  closeBtn.addEventListener('click', close);

  minimizeBtn.addEventListener('click', () => {
    const minimizing = !panel.classList.contains('minimized');
    if (minimizing) {
      lastExpandedHeight = panel.getBoundingClientRect().height;
      panel.classList.add('minimized');
      minimizeBtn.querySelector('.icon').textContent = 'expand_less';
    } else {
      panel.classList.remove('minimized');
      panel.style.height = lastExpandedHeight + 'px';
      minimizeBtn.querySelector('.icon').textContent = 'expand_more';
    }
  });

  // Ziehgriff zum Größenändern (Maus + Touch)
  let dragging = false;
  function startDrag(e) {
    if (panel.classList.contains('minimized')) return;
    dragging = true;
    panel.classList.add('dragging');
    e.preventDefault();
  }
  function moveDrag(clientY) {
    if (!dragging) return;
    const wrapRect = boundsWrap.getBoundingClientRect();
    const maxHeight = wrapRect.height * 0.85;
    let newHeight = wrapRect.bottom - clientY;
    newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
    panel.style.height = newHeight + 'px';
    lastExpandedHeight = newHeight;
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
  }
  handle.addEventListener('mousedown', startDrag);
  window.addEventListener('mousemove', (e) => moveDrag(e.clientY));
  window.addEventListener('mouseup', endDrag);
  handle.addEventListener('touchstart', (e) => startDrag(e), { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (dragging && e.touches[0]) moveDrag(e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchend', endDrag);

  return { open, close };
}

const featureTablePanel = initResizablePanel({
  panel: document.getElementById('table-panel'),
  handle: document.getElementById('table-resize-handle'),
  minimizeBtn: document.getElementById('table-minimize'),
  closeBtn: document.getElementById('table-close'),
  boundsWrap: document.getElementById('map-wrap'),
  minHeight: TABLE_MIN_HEIGHT,
  defaultHeight: TABLE_DEFAULT_HEIGHT
});

function openFeatureTable() {
  renderFeatureTable();
  featureTablePanel.open();
}

// ---------- Standort (GPS) ----------
let locationMarker = null;
let locationCircle = null;
let watchingLocation = false;

function onLocationFound(e) {
  const radius = e.accuracy / 2;
  if (!locationMarker) {
    locationMarker = L.circleMarker(e.latlng, {
      radius: 7, color: '#ffffff', weight: 2, fillColor: '#2E86FF', fillOpacity: 1
    }).addTo(map);
    locationCircle = L.circle(e.latlng, {
      radius, color: '#2E86FF', weight: 1, fillColor: '#2E86FF', fillOpacity: 0.12
    }).addTo(map);
  } else {
    locationMarker.setLatLng(e.latlng);
    locationCircle.setLatLng(e.latlng).setRadius(radius);
  }
}

function onLocationError(e) {
  showError('Standort konnte nicht ermittelt werden: ' + e.message + ' (Standortfreigabe im Browser erteilt?)');
  stopLocating();
}

function stopLocating() {
  map.stopLocate();
  watchingLocation = false;
  const btn = document.getElementById('btn-locate');
  btn.classList.remove('active');
  btn.title = 'Mein Standort';
  btn.setAttribute('aria-label', 'Mein Standort');
}

map.on('locationfound', onLocationFound);
map.on('locationerror', onLocationError);

document.getElementById('btn-locate').addEventListener('click', () => {
  if (watchingLocation) {
    stopLocating();
    return;
  }
  watchingLocation = true;
  const btn = document.getElementById('btn-locate');
  btn.classList.add('active');
  btn.title = 'Standort wird verfolgt…';
  btn.setAttribute('aria-label', 'Standort wird verfolgt…');
  map.locate({ setView: true, maxZoom: 17, watch: true, enableHighAccuracy: true });
});

// ---------- Funktions-Umschaltung (SelectButton) ----------
// Ersetzt die frühere Reiter-Logik: es gibt nur noch EINE Karte, die beim
// Wechseln nie neu aufgebaut oder verschoben wird — nur die Sidebar-Sektion,
// eventuelle Topbar-Zusatzelemente und das gerade "scharfe" Kartenwerkzeug
// (Zeichnen/Baum setzen/Bienenstock setzen) ändern sich.
const SEGMENT_CAPTIONS = {
  viewer: 'Shapefiles & GeoJSON lokal auf der Karte darstellen',
  compare: 'Zwei Parzellen-Stände gegenüberstellen — Zugänge, Abgänge, Änderungen',
  zeichner: 'Eigene Parzellen direkt auf der Karte zeichnen',
  obstbaum: 'Obstbäume als farbige Punkte auf der Karte erfassen',
  bienenflug: 'Bienenstöcke markieren — theoretischer Flugradius 3 km',
  hofplan: 'Hof- und Gebäudepläne direkt auf dem Satellitenbild einzeichnen',
  terminkalender: 'Termine aus Excel importieren und in der Kalenderwoche navigieren',
  stallplaner: 'Stallgrundrisse zeichnen, in Abteile einteilen und gegen die EU-Öko-VO abgleichen'
};

// Kurzer Funktionsname für die Handy-Kopfzeile (dort ist die Funktionsliste
// in der Schublade versteckt — ohne Titel wüsste man nicht, wo man ist).
const SEGMENT_TITLES = {
  viewer: 'Karte', compare: 'Jahresvergleich', zeichner: 'Flächenzeichner', obstbaum: 'Obstbaumkataster',
  bienenflug: 'Bienenflugkarte', hofplan: 'Hofplan', terminkalender: 'Terminkalender', stallplaner: 'Stallplaner'
};

function setActiveSegment(target) {
  // Auf schmalen Bildschirmen liegt die Sidebar als Einschub über der Karte —
  // eine Funktion auszuwählen soll die Karte gleich freigeben (no-op auf Desktop).
  closeMobileSidebar();
  // Zuerst das ggf. scharfe Werkzeug der vorherigen Sektion entwaffnen, bevor
  // die neue Sektion (ggf. mit eigenem Werkzeug) aktiv wird.
  if (armedTool === 'draw-polygon' && zeichnerDrawPolygon) zeichnerDrawPolygon.disable();
  if (armedTool === 'split-line' && zeichnerDrawLine) zeichnerDrawLine.disable();
  disableShapeEditing();
  if (armedTool === 'place-tree') setActiveFruitKey(null);
  if (armedTool === 'draw-hofplan-rect' && hofplanDrawRect) hofplanDrawRect.disable();
  if (armedTool === 'draw-hofplan-poly' && hofplanDrawPoly) hofplanDrawPoly.disable();
  disableHofplanEditing();
  disableStallplanerDrawing();
  armedTool = null;
  // Die schwebende Werkzeugleiste (#edit-toolbar) zeigt je nach Tab nur eine
  // ihrer beiden Gruppen (Zeichner/Hofplan) — ein weiterhin "scharfes"
  // Bearbeiten/Löschen/Teilen-Werkzeug der GERADE VERLASSENEN Gruppe wäre
  // dann unsichtbar und damit verwirrend, deshalb hier immer zurückgesetzt.
  if (target !== 'zeichner' && mapToolMode) mapToolMode = null;
  updateShapeToolbar();
  if (target !== 'hofplan' && hofplanToolMode) hofplanToolMode = null;
  updateHofplanToolbar();
  if (target !== 'compare') { restoreCompareHiddenLayer(); compareTablePanel.close(); }
  document.getElementById('map').classList.toggle('placing', target === 'bienenflug');

  document.querySelectorAll('.segment-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === target));
  document.querySelectorAll('.sidebar-section').forEach(el => el.classList.toggle('active', el.getAttribute('data-view') === target));
  document.querySelectorAll('.topbar-extra').forEach(el => el.classList.toggle('active', el.getAttribute('data-view') === target));
  // #edit-toolbar selbst trägt keine eigene .topbar-extra-Sichtbarkeit (das
  // generische data-view-Matching oben ist auf genau EINEN Tab zugeschnitten,
  // die Leiste soll aber auf zwei Tabs erscheinen) — daher hier separat
  // sichtbar geschaltet, sobald eine ihrer beiden Gruppen aktiv sein könnte.
  document.getElementById('edit-toolbar').classList.toggle('active', target === 'zeichner' || target === 'hofplan');
  document.getElementById('brand-caption').textContent = SEGMENT_CAPTIONS[target] || '';
  document.getElementById('current-view-title').textContent = SEGMENT_TITLES[target] || 'Karte';
  // Nach dem Wechsel (armedTool wird unten ggf. neu gesetzt) aktualisieren.
  setTimeout(updateMapPlaceChip, 0);
  // "Auf Inhalt zoomen" fittet auf layers/featureIndex — im Jahresvergleich
  // wird stattdessen automatisch auf das Vergleichsergebnis gezoomt, daher
  // dort ausgeblendet statt einer Funktion ohne Bezug zur aktuellen Ansicht.
  document.getElementById('btn-fit').hidden = target === 'compare';
  // Im Jahresvergleich wandert GPS ganz nach rechts, hinter den Diff/Jahr-A/
  // Jahr-B-Umschalter — in den anderen Ansichten bleibt die normale Reihenfolge.
  document.getElementById('btn-locate').style.order = target === 'compare' ? '5' : '';

  if (target === 'zeichner') initZeichnerMap();
  else if (target === 'obstbaum') initObstbaumMap();
  else if (target === 'bienenflug') { initBienenflugMap(); armedTool = 'place-hive'; }
  else if (target === 'compare') refreshCompareJahrBOptions();
  else if (target === 'hofplan') initHofplanMap();
  else if (target === 'stallplaner') initStallplaner();
  if (target === 'stallplaner') requestStallplanerWakeLock(); else releaseStallplanerWakeLock();

  // Terminkalender hat eine eigene, zweite Leaflet-Karteninstanz statt der
  // geteilten Parzellen-Karte, Stallplaner hat gar keine Karte (eigenes
  // SVG) — #map-wrap schließt sich mit beiden aus statt wie die anderen
  // Funktionen nur Layer auf derselben Karte umzuschalten.
  document.getElementById('map-wrap').hidden = target === 'terminkalender' || target === 'stallplaner';
  const tkView = document.getElementById('terminkalender-view');
  tkView.hidden = target !== 'terminkalender';
  document.getElementById('stallplaner-view').hidden = target !== 'stallplaner';
  // Shapefile-/GeoJSON-Upload und die geteilte Ebenenliste ergeben in
  // Terminkalender/Stallplaner keinen Sinn (andere Datenwelt, keine geteilte
  // Karte) — dort ausgeblendet statt immer sichtbar wie in den anderen
  // Funktionen.
  document.getElementById('dropzone').hidden = target === 'terminkalender' || target === 'stallplaner';
  document.getElementById('layer-section').hidden = target === 'terminkalender' || target === 'stallplaner';
  if (target === 'terminkalender') openTerminkalender();
}

// Es gibt keinen eigenen "Viewer"-Button mehr — Viewer ist die Standardansicht.
// Klick auf den bereits aktiven Funktions-Button schaltet dorthin zurück,
// klick auf einen anderen wechselt direkt zur neuen Funktion.
document.querySelectorAll('.segment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-view');
    setActiveSegment(btn.classList.contains('active') ? 'viewer' : target);
  });
});

// ---------- Jahresvergleich ----------
let compareGeoLayer = null;
let compareViewMode = 'diff'; // 'diff' | 'onlyA' | 'onlyB'
let compareDataA = null; // { fc, fileName, layerName }
let compareDataB = null;
let compareRecords = [];
let compareHiddenLayerId = null; // Jahr-B-Quellebene, während der Vergleichsansicht ausgeblendet (sonst doppelte Darstellung)

// Blendet die als Jahr B genutzte Ebene wieder ein, falls sie für die
// Vergleichsansicht ausgeblendet wurde — beim Verlassen des Jahresvergleichs
// oder vor einem neuen Vergleichslauf aufgerufen.
function restoreCompareHiddenLayer() {
  if (compareHiddenLayerId && layers[compareHiddenLayerId] && layers[compareHiddenLayerId].visible) {
    layers[compareHiddenLayerId].leafletLayer.addTo(map);
  }
  compareHiddenLayerId = null;
  if (compareGeoLayer) { map.removeLayer(compareGeoLayer); compareGeoLayer = null; }
}

const STATUS_COLORS = {
  zugang: '#6FBF73',
  abgang: '#D97757',
  veraendert: '#C9A24F',
  unveraendert: '#5A6270'
};
const STATUS_LABELS = {
  zugang: 'Zugang',
  abgang: 'Abgang',
  veraendert: 'Verändert',
  unveraendert: 'Unverändert'
};


document.querySelectorAll('.cvt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cvt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    compareViewMode = btn.getAttribute('data-mode');
    if (compareRecords.length) renderCompareMapLayers(compareRecords, false);
  });
});

const compareTablePanel = initResizablePanel({
  panel: document.getElementById('compare-table-panel'),
  handle: document.getElementById('compare-table-resize-handle'),
  minimizeBtn: document.getElementById('compare-table-minimize'),
  closeBtn: document.getElementById('compare-table-close'),
  boundsWrap: document.getElementById('map-wrap'),
  minHeight: TABLE_MIN_HEIGHT,
  defaultHeight: TABLE_DEFAULT_HEIGHT
});

function showCompareError(msg) {
  const el = document.getElementById('compare-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showCompareError._t);
  showCompareError._t = setTimeout(() => el.style.display = 'none', 7000);
}

// Sucht in den Feature-Eigenschaften nach einem Feldnamen, der "jahr" enthält
// (z.B. JAHR, Jahr, WJAHR, ajahr_aktu) — deckt die Antrags-/Wirtschaftsjahr-Felder
// der bisher gesehenen Bundesländer ab (Sachsen: JAHR, Bayern: Jahr, NRW: WJAHR,
// Hessen: ajahr_aktu). Fallback auf Datumsfelder (z.B. BW: dat_bearb, Hessen: updated_at).
function extractJahrAusFeature(feature) {
  const props = (feature && feature.properties) || {};
  const keys = Object.keys(props);
  for (const key of keys) {
    if (!/jahr/i.test(key)) continue;
    const v = props[key];
    if (v === null || v === undefined) continue;
    const m = String(v).match(/(19|20)\d{2}/);
    if (m) return m[0];
  }
  for (const key of keys) {
    if (!/dat|datum|zeit|updated|erstellt|created/i.test(key)) continue;
    const v = props[key];
    if (v === null || v === undefined) continue;
    const m = String(v).match(/(19|20)\d{2}/);
    if (m) return m[0];
  }
  return null;
}

function extractJahrAusMetadaten(fc, fileName) {
  const features = (fc && fc.features) || [];
  for (let i = 0; i < Math.min(features.length, 20); i++) {
    const jahr = extractJahrAusFeature(features[i]);
    if (jahr) return jahr;
  }
  // Letzter Fallback: viele Ämter benennen die Export-Datei nach dem Antragsjahr
  // (z.B. "2025_Mustermann_Shape.zip") — Metadaten in Fläche/DBF gehen vor.
  if (fileName) {
    const m = fileName.match(/(19|20)\d{2}/);
    if (m) return m[0];
  }
  return null;
}

// Jahr B kommt jetzt aus dem geteilten Datenbestand (layers) statt aus einem
// eigenen Upload — Kandidaten sind alle nicht-Teilflächen-Ebenen mit
// Flächengeometrie. Bei mehreren geladenen Ebenen wählt eine kleine Auswahlliste,
// Standardwert ist die zuletzt hinzugefügte (Objektschlüssel-Reihenfolge = Einfügereihenfolge).
function getCompareJahrBCandidates() {
  return Object.keys(layers)
    .filter(id => !layers[id].isTeilflaechen && (layers[id].geojson.features || []).some(f =>
      f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')))
    .map(id => ({ id, name: layers[id].name }));
}

function getSelectedJahrBLayerId() {
  const candidates = getCompareJahrBCandidates();
  if (!candidates.length) return null;
  const select = document.getElementById('compare-jahrb-picker');
  if (candidates.length === 1) return candidates[0].id;
  return candidates.some(c => c.id === select.value) ? select.value : candidates[candidates.length - 1].id;
}

function updateCompareRunEnabled() {
  document.getElementById('btn-compare-run').disabled = !(compareDataA && getSelectedJahrBLayerId());
}

// Aktualisiert die Jahr-B-Auswahlliste (nur sichtbar bei mehr als einer
// Kandidaten-Ebene) — aufgerufen beim Wechsel in den Jahresvergleich sowie
// jedes Mal, wenn sich der geteilte Datenbestand ändert (neue Ebene geladen/entfernt).
function refreshCompareJahrBOptions() {
  const candidates = getCompareJahrBCandidates();
  const wrap = document.getElementById('compare-jahrb-picker-wrap');
  const select = document.getElementById('compare-jahrb-picker');
  wrap.hidden = candidates.length <= 1;
  if (candidates.length > 1) {
    const prevValue = select.value;
    select.innerHTML = candidates.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    select.value = candidates.some(c => c.id === prevValue) ? prevValue : candidates[candidates.length - 1].id;
  }
  updateCompareYearButtons();
  updateCompareRunEnabled();
}
document.getElementById('compare-jahrb-picker').addEventListener('change', () => {
  updateCompareYearButtons();
  updateCompareRunEnabled();
});

function updateCompareYearButtons() {
  const btnA = document.querySelector('.cvt-btn[data-mode="onlyA"]');
  const btnB = document.querySelector('.cvt-btn[data-mode="onlyB"]');
  if (btnA) btnA.textContent = (compareDataA && compareDataA.jahr) ? 'Nur ' + compareDataA.jahr : 'Nur Jahr A';
  const jahrBLayerId = getSelectedJahrBLayerId();
  const jahrB = jahrBLayerId ? extractJahrAusMetadaten(layers[jahrBLayerId].geojson, layers[jahrBLayerId].name) : null;
  if (btnB) btnB.textContent = jahrB ? 'Nur ' + jahrB : 'Nur Jahr B';
}

async function loadCompareFile(file) {
  try {
    let results = await parseShapefileZip(file);
    if (!results.length) {
      showCompareError(file.name + ': Keine Shapefile-Bestandteile gefunden.');
      return;
    }
    results = mergeFeldstueckNutzung(results);
    // Für den Vergleich zählt nur die Parzellen-Ebene — Teilflächen o.ä. werden ignoriert.
    let chosen = results.find(r => /parzelle/i.test(r.name)) || results.find(r => /feldst(ü|ue)ck/i.test(r.name));
    if (!chosen) {
      chosen = results[0];
      showCompareError(file.name + ': Keine Ebene mit "Parzellen" im Namen gefunden — verwende stattdessen "' + chosen.name + '".');
    }
    compareDataA = { fc: chosen.fc, fileName: file.name, layerName: chosen.name, jahr: extractJahrAusMetadaten(chosen.fc, file.name) };
    document.getElementById('compare-file-a-name').textContent = file.name;
    document.getElementById('compare-drop-a').classList.add('filled');
    updateCompareYearButtons();
    updateCompareRunEnabled();
  } catch (err) {
    console.error(err);
    showCompareError(file.name + ': Konnte Datei nicht lesen — ' + (err.message || 'unbekannter Fehler'));
  }
}

document.getElementById('compare-file-a').addEventListener('change', (e) => {
  if (e.target.files[0]) loadCompareFile(e.target.files[0]);
});

function parseHa(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function runComparison() {
  const jahrBLayerId = getSelectedJahrBLayerId();
  if (!compareDataA || !jahrBLayerId) return;

  // Jahr B ist jetzt eine ganz normal geladene Ebene — sie bleibt gleichzeitig
  // "normale Kartenebene" UND "Vergleichs-Eingabe"; damit sie nicht doppelt
  // (einmal normal, einmal als farbige Status-Fläche) übereinander liegt, wird
  // sie für die Dauer der Vergleichsansicht ausgeblendet (restoreCompareHiddenLayer()
  // blendet sie beim Verlassen des Jahresvergleichs oder vor dem nächsten Lauf
  // wieder ein).
  restoreCompareHiddenLayer();
  const jahrBLayer = layers[jahrBLayerId];
  compareDataB = { fc: jahrBLayer.geojson, fileName: jahrBLayer.name, layerName: jahrBLayer.name, jahr: extractJahrAusMetadaten(jahrBLayer.geojson, jahrBLayer.name) };
  updateCompareYearButtons();
  map.removeLayer(jahrBLayer.leafletLayer);
  compareHiddenLayerId = jahrBLayerId;

  const compareCritGroesse = document.getElementById('crit-groesse').checked;
  const compareCritKultur = document.getElementById('crit-kultur').checked;

  const mapA = new Map();
  (compareDataA.fc.features || []).forEach(f => {
    const nr = pickField(f.properties || {}, FIELD_CANDIDATES.nummer);
    if (nr) mapA.set(nr, f);
  });
  const mapB = new Map();
  (compareDataB.fc.features || []).forEach(f => {
    const nr = pickField(f.properties || {}, FIELD_CANDIDATES.nummer);
    if (nr) mapB.set(nr, f);
  });

  const allNummern = new Set([...mapA.keys(), ...mapB.keys()]);
  const records = [];

  allNummern.forEach(nr => {
    const fA = mapA.get(nr) || null;
    const fB = mapB.get(nr) || null;
    const propsA = fA ? (fA.properties || {}) : {};
    const propsB = fB ? (fB.properties || {}) : {};

    const name = pickField(propsB, FIELD_CANDIDATES.name) || pickField(propsA, FIELD_CANDIDATES.name);
    const groesseA = fA ? pickGroesse(propsA) : '';
    const groesseB = fB ? pickGroesse(propsB) : '';
    const kulturA = fA ? pickField(propsA, FIELD_CANDIDATES.kultur) : '';
    const kulturB = fB ? pickField(propsB, FIELD_CANDIDATES.kultur) : '';

    let status;
    if (!fA) {
      status = 'zugang';
    } else if (!fB) {
      status = 'abgang';
    } else {
      const hA = parseHa(groesseA);
      const hB = parseHa(groesseB);
      const sizeChanged = (hA !== null && hB !== null) ? Math.abs(hA - hB) > 0.01 : (groesseA !== groesseB);
      const kulturChanged = kulturA.trim().toLowerCase() !== kulturB.trim().toLowerCase();
      const relevantChange = (compareCritGroesse && sizeChanged) || (compareCritKultur && kulturChanged);
      status = relevantChange ? 'veraendert' : 'unveraendert';
    }

    const hA = parseHa(groesseA);
    const hB = parseHa(groesseB);
    const delta = (hA !== null && hB !== null) ? (hB - hA) : null;

    records.push({ nummer: nr, name, status, groesseA, groesseB, delta, kulturA, kulturB, featureA: fA, featureB: fB, _mapLayer: null });
  });

  const order = { zugang: 0, abgang: 1, veraendert: 2, unveraendert: 3 };
  records.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return String(a.nummer).localeCompare(String(b.nummer), undefined, { numeric: true });
  });

  compareRecords = records;
  renderCompareSummary(records);
  renderCompareTable(records);
  renderCompareMapLayers(records);
  compareTablePanel.open();
}

document.getElementById('btn-compare-run').addEventListener('click', runComparison);

// Mindestens ein Kriterium muss aktiv bleiben; bei Änderung sofort neu vergleichen,
// falls bereits ein Ergebnis vorliegt.
['crit-groesse', 'crit-kultur'].forEach(id => {
  document.getElementById(id).addEventListener('change', (e) => {
    const other = id === 'crit-groesse' ? 'crit-kultur' : 'crit-groesse';
    if (!e.target.checked && !document.getElementById(other).checked) {
      e.target.checked = true; // mindestens eines muss ausgewählt bleiben
      return;
    }
    if (compareRecords.length) runComparison();
  });
});

function renderCompareSummary(records) {
  const counts = { zugang: 0, abgang: 0, veraendert: 0, unveraendert: 0 };
  let deltaSum = 0;
  records.forEach(r => {
    counts[r.status]++;
    if (r.delta !== null) deltaSum += r.delta;
  });
  const el = document.getElementById('compare-summary');
  el.classList.add('show');
  const deltaText = (deltaSum >= 0 ? '+' : '') + deltaSum.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
  el.innerHTML =
    '<div class="stat"><span class="n">' + counts.zugang + '</span><span class="l">Zugänge</span></div>' +
    '<div class="stat"><span class="n">' + counts.abgang + '</span><span class="l">Abgänge</span></div>' +
    '<div class="stat"><span class="n">' + counts.veraendert + '</span><span class="l">Verändert</span></div>' +
    '<div class="stat"><span class="n">' + deltaText + '</span><span class="l">Nettodifferenz</span></div>';
  document.getElementById('compare-legend').classList.add('show');
}

function renderCompareTable(records) {
  const tbody = document.getElementById('compare-table-body');
  document.getElementById('compare-table-count').textContent = records.length;
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted); padding:14px;">Keine gemeinsamen oder abweichenden Flächennummern gefunden.</td></tr>';
    return;
  }
  tbody.innerHTML = records.map((r, i) => {
    const gA = parseHa(r.groesseA);
    const gB = parseHa(r.groesseB);
    const gAText = gA !== null ? gA.toFixed(2) : (r.groesseA || '–');
    const gBText = gB !== null ? gB.toFixed(2) : (r.groesseB || '–');
    const deltaText = r.delta !== null ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(2) : '–';
    const kulturText = escapeHtml(r.kulturA || '–') + (r.kulturA !== r.kulturB ? ' → ' + escapeHtml(r.kulturB || '–') : '');
    return '<tr data-idx="' + i + '">' +
      '<td><span class="status-pill" style="background:' + STATUS_COLORS[r.status] + '">' + STATUS_LABELS[r.status] + '</span></td>' +
      '<td>' + escapeHtml(r.nummer) + '</td>' +
      '<td>' + escapeHtml(r.name || '–') + '</td>' +
      '<td>' + gAText + '</td>' +
      '<td>' + gBText + '</td>' +
      '<td>' + deltaText + '</td>' +
      '<td>' + kulturText + '</td>' +
      '</tr>';
  }).join('');
  tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
    tr.addEventListener('click', () => zoomToCompareRecord(compareRecords[parseInt(tr.getAttribute('data-idx'), 10)]));
  });
}

function compareRecordPopupHtml(r) {
  const gA = parseHa(r.groesseA);
  const gB = parseHa(r.groesseB);
  const gAText = gA !== null ? gA.toFixed(2) + ' ha' : '–';
  const gBText = gB !== null ? gB.toFixed(2) + ' ha' : '–';
  return '<b>' + escapeHtml(r.nummer) + '</b>' + (r.name ? ' – ' + escapeHtml(r.name) : '') + '<br>' +
    'Status: ' + STATUS_LABELS[r.status] + '<br>' +
    'Größe A: ' + gAText + ' · Größe B: ' + gBText + '<br>' +
    'Kultur: ' + escapeHtml(r.kulturA || '–') + (r.kulturA !== r.kulturB ? ' → ' + escapeHtml(r.kulturB || '–') : '');
}

// Berechnet geometrisch, welches Stück einer Fläche zwischen den beiden Jahren
// dazugekommen (in B, aber nicht in A) bzw. weggefallen ist (in A, aber nicht
// in B). Läuft über turf.difference; bei fehlerhafter/selbstüberschneidender
// Geometrie (kommt bei realen Shapefiles vor) wird sauber abgebrochen, ohne
// die restliche Anzeige zu stören — dann bleibt nur der Umriss-Vergleich übrig.
function computeGeometryDiff(featureA, featureB) {
  const result = { gained: null, lost: null, core: null };
  if (typeof turf === 'undefined' || !featureA || !featureB) return result;
  try {
    result.gained = turf.difference(featureB, featureA); // in B, nicht in A
  } catch (err) {
    console.warn('Geometrie-Differenz (Zugewinn) fehlgeschlagen:', err.message);
  }
  try {
    result.lost = turf.difference(featureA, featureB); // in A, nicht in B
  } catch (err) {
    console.warn('Geometrie-Differenz (Verlust) fehlgeschlagen:', err.message);
  }
  try {
    result.core = turf.intersect(featureA, featureB); // Bestandsfläche: in beiden Jahren
  } catch (err) {
    console.warn('Geometrie-Schnittmenge (Bestand) fehlgeschlagen:', err.message);
  }
  return result;
}

// Label (Nummer + Name) mittig auf eine Fläche setzen — über einen unsichtbaren
// Anker-Punkt mit dauerhaft eingeblendetem Tooltip, damit pro Fläche genau EIN
// Label erscheint, unabhängig davon aus wie vielen Teil-Layern sie besteht.
// Wird sowohl vom Viewer (addLayer) als auch vom Jahresvergleich genutzt.
function createLabelAnchorAt(latlng, text) {
  const anchor = L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0, interactive: false });
  anchor.bindTooltip(text, { permanent: true, direction: 'center', className: 'feature-label' });
  return anchor;
}

function addFeatureLabel(feature, text, group) {
  if (!feature) return;
  let latlng;
  try {
    latlng = L.geoJSON(feature).getBounds().getCenter();
  } catch (err) {
    return;
  }
  createLabelAnchorAt(latlng, text).addTo(group);
}

function renderCompareMapLayers(records, fitView) {
  if (fitView === undefined) fitView = true;
  if (compareGeoLayer) map.removeLayer(compareGeoLayer);
  compareGeoLayer = L.featureGroup().addTo(map);

  if (compareViewMode === 'onlyA' || compareViewMode === 'onlyB') {
    renderSingleYearLayers(records, compareViewMode, fitView);
    return;
  }

  records.forEach(r => {
    const color = STATUS_COLORS[r.status];
    let mapLayer = null;
    const labelText = escapeHtml(r.nummer) + (r.name ? '<br>' + escapeHtml(r.name) : '');

    if (r.status === 'zugang' && r.featureB) {
      mapLayer = L.geoJSON(r.featureB, { style: { color, weight: 1.8, fillColor: color, fillOpacity: 0.35 } });
      addFeatureLabel(r.featureB, labelText, compareGeoLayer);
    } else if (r.status === 'abgang' && r.featureA) {
      mapLayer = L.geoJSON(r.featureA, { style: { color, weight: 1.8, fillColor: color, fillOpacity: 0.35, dashArray: '4,3' } });
      addFeatureLabel(r.featureA, labelText, compareGeoLayer);
    } else if (r.status === 'veraendert') {
      const parts = [];
      // Kontext: alte Grenze gestrichelt-grau, neue Grenze farbig als dünner Umriss
      if (r.featureA) parts.push(L.geoJSON(r.featureA, { style: { color: '#9096a1', weight: 1.4, fillOpacity: 0, dashArray: '4,3' } }));
      if (r.featureB) parts.push(L.geoJSON(r.featureB, { style: { color, weight: 1.6, fillOpacity: 0 } }));

      // Fläche in drei eindeutig unterscheidbare Teile zerlegen: Bestand
      // (in beiden Jahren gleich), Zugewinn, Verlust.
      if (r.featureA && r.featureB) {
        const diff = computeGeometryDiff(r.featureA, r.featureB);
        if (diff.core) {
          parts.push(L.geoJSON(diff.core, { style: { color: '#5F7A93', weight: 0, fillColor: '#5F7A93', fillOpacity: 0.45 } }));
        }
        if (diff.gained) {
          parts.push(L.geoJSON(diff.gained, { style: { color: '#1B9C7D', weight: 1, fillColor: '#2EE6B8', fillOpacity: 0.75 } }));
        }
        if (diff.lost) {
          parts.push(L.geoJSON(diff.lost, { style: { color: '#A32E52', weight: 1, fillColor: '#E0507A', fillOpacity: 0.75 } }));
        }
        if (!diff.core && !diff.gained && !diff.lost) {
          // Geometrie-Diff nicht berechenbar (z.B. ungültiges Polygon) — Fläche
          // trotzdem flächig einfärben, damit "Verändert" sichtbar bleibt.
          parts.push(L.geoJSON(r.featureB, { style: { color, weight: 0, fillColor: color, fillOpacity: 0.18 } }));
        }
      }
      if (parts.length) mapLayer = L.featureGroup(parts);
      addFeatureLabel(r.featureB || r.featureA, labelText, compareGeoLayer);
    } else {
      const feat = r.featureB || r.featureA;
      if (feat) {
        mapLayer = L.geoJSON(feat, { style: { color, weight: 1, fillColor: color, fillOpacity: 0.08 } });
        addFeatureLabel(feat, labelText, compareGeoLayer);
      }
    }

    if (mapLayer) {
      mapLayer.bindPopup(compareRecordPopupHtml(r));
      mapLayer.addTo(compareGeoLayer);
      r._mapLayer = mapLayer;
    }
  });

  if (fitView && compareGeoLayer.getLayers().length) {
    map.fitBounds(compareGeoLayer.getBounds(), { padding: [30, 30] });
  }
}

// Isolierte Ansicht nur eines Jahres — zeigt ausschließlich die Flächen, die in
// diesem Jahr existieren (bei "Nur Jahr A" fehlen z.B. die erst später
// hinzugekommenen "Zugang"-Flächen, weil es sie in Jahr A schlicht noch nicht
// gab). Die Status-Färbung bleibt erhalten, damit man auch isoliert sieht,
// welche Flächen sich zum anderen Jahr hin verändern.
function renderSingleYearLayers(records, which, fitView) {
  const featKey = which === 'onlyA' ? 'featureA' : 'featureB';
  records.forEach(r => {
    const feat = r[featKey];
    if (!feat) return; // existiert in diesem Jahr nicht
    const color = STATUS_COLORS[r.status];
    const labelText = escapeHtml(r.nummer) + (r.name ? '<br>' + escapeHtml(r.name) : '');
    const mapLayer = L.geoJSON(feat, { style: { color, weight: 1.6, fillColor: color, fillOpacity: 0.3 } });
    mapLayer.bindPopup(compareRecordPopupHtml(r));
    mapLayer.addTo(compareGeoLayer);
    addFeatureLabel(feat, labelText, compareGeoLayer);
    r._mapLayer = mapLayer;
  });

  if (fitView && compareGeoLayer.getLayers().length) {
    map.fitBounds(compareGeoLayer.getBounds(), { padding: [30, 30] });
  }
}

function zoomToCompareRecord(rec) {
  if (!rec || !rec._mapLayer) return;
  const b = rec._mapLayer.getBounds();
  if (b && b.isValid()) {
    map.fitBounds(b, { padding: [60, 60], maxZoom: 17 });
    rec._mapLayer.openPopup(b.getCenter());
  }
}

// ---------- Tabellen-Export (CSV / Excel / PDF) ----------
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc).join(';')].concat(rows.map(r => r.map(esc).join(';')));
  return '﻿' + lines.join('\r\n'); // BOM, damit Excel Umlaute korrekt anzeigt
}

function exportCsv(headers, rows, filename) {
  downloadBlob(toCsv(headers, rows), filename, 'text/csv;charset=utf-8;');
}

function exportXlsx(headers, rows, filename, sheetName) {
  if (typeof XLSX === 'undefined') { showError('Excel-Export nicht verfügbar (Bibliothek konnte nicht geladen werden).'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Daten');
  XLSX.writeFile(wb, filename);
}

// ---------- FeldFolio Plus: dezenter Schriftzug in PDF-Exporten ----------
// Rendert den kompletten Wortmarken-Schriftzug ("Feld" + "F" + Apfel-Grafik +
// "lio", exakt dieselbe Struktur/Klassen wie #brand-logo in der Kopfzeile)
// einmalig als Bild um (jsPDF kann kein SVG/Web-Font direkt einbetten, nur
// Raster-Bilder) und cached das Ergebnis als {dataUrl, aspectRatio}, damit
// nicht bei jedem Export erneut gerendert werden muss. Feste Markenfarbe
// (Light-Mode-Grün) statt var(--accent), da das PDF-Papier immer weiß ist,
// unabhängig vom gerade aktiven Dark-/Hellmodus der App.
let feldfolioLogoDataUrlPromise = null;
function getFeldFolioLogoDataUrl() {
  if (!feldfolioLogoDataUrlPromise) {
    feldfolioLogoDataUrlPromise = (async () => {
      if (typeof html2canvas === 'undefined') return null;
      const source = document.getElementById('brand-logo');
      if (!source) return null;
      const clone = source.cloneNode(true);
      clone.style.position = 'fixed';
      clone.style.left = '-99999px';
      clone.style.top = '0';
      clone.style.margin = '0';
      clone.style.padding = '6px 10px';
      clone.style.fontSize = '64px';
      clone.style.color = '#607E60';
      clone.style.background = '#ffffff';
      document.body.appendChild(clone);
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const canvas = await html2canvas(clone, { backgroundColor: '#ffffff', scale: 2 });
        return { dataUrl: canvas.toDataURL('image/png'), aspectRatio: canvas.width / canvas.height };
      } catch {
        return null;
      } finally {
        document.body.removeChild(clone);
      }
    })();
  }
  return feldfolioLogoDataUrlPromise;
}

// Stempelt den Schriftzug klein und halbtransparent in die untere rechte Ecke
// jeder Seite eines fertigen PDF-Dokuments — rein dekoratives Branding, daher
// bewusst zurückhaltend (kleine Größe, reduzierte Deckkraft) statt wie ein
// aufdringliches Wasserzeichen über dem eigentlichen Seiteninhalt zu liegen.
// logo darf null sein (z.B. wenn das Bild nicht gerendert werden konnte) —
// dann wird einfach nichts gestempelt, kein Fehler.
function stampFeldFolioLogo(doc, logo) {
  if (!logo) return;
  const h = 6;
  const w = h * logo.aspectRatio;
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const hasGState = typeof doc.setGState === 'function' && typeof doc.GState === 'function';
    if (hasGState) doc.setGState(new doc.GState({ opacity: 0.55 }));
    doc.addImage(logo.dataUrl, 'PNG', pageW - w - 6, pageH - h - 6, w, h);
    if (hasGState) doc.setGState(new doc.GState({ opacity: 1 }));
  }
}

async function exportPdf(headers, rows, filename, title) {
  if (typeof window.jspdf === 'undefined') { showError('PDF-Export nicht verfügbar (Bibliothek konnte nicht geladen werden).'); return; }
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFontSize(12);
  doc.text(title || '', 14, 12);
  doc.autoTable({ head: [headers], body: rows, startY: 16, styles: { fontSize: 8 }, headStyles: { fillColor: [79, 184, 175] } });
  stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
  doc.save(filename);
}

function exportViewerTable(type) {
  const rows = getVisibleFeatureRows();
  if (!rows.length) { showError('Keine Flächen zum Exportieren geladen.'); return; }
  const headers = ['Schlagnr./Flächennr.', 'Flächenname', 'Flächenidentifikator', 'Größe (ha)', 'Kulturart', 'Ebene'];
  const data = rows.map(e => {
    const n = parseFloat(String(e.groesse).replace(',', '.'));
    const groesseText = isFinite(n) ? n.toFixed(2) : (e.groesse || '');
    return [e.nummer || '', e.featName || '', e.flaechenId || '', groesseText, e.kultur || '', e.layerName || ''];
  });
  const ts = new Date().toISOString().slice(0, 10);
  if (type === 'csv') exportCsv(headers, data, zuordnungFileName('Flächenübersicht', 'csv') || `flaechenuebersicht_${ts}.csv`);
  else if (type === 'xlsx') exportXlsx(headers, data, zuordnungFileName('Flächenübersicht', 'xlsx') || `flaechenuebersicht_${ts}.xlsx`, 'Flächen');
  else if (type === 'pdf') exportPdf(headers, data, zuordnungFileName('Flächenübersicht', 'pdf') || `flaechenuebersicht_${ts}.pdf`, 'Flächenübersicht');
}

function exportCompareTable(type) {
  if (!compareRecords.length) { showCompareError('Kein Vergleichsergebnis zum Exportieren — erst "Vergleichen" ausführen.'); return; }
  const headers = ['Status', 'Nummer', 'Name', 'Größe A (ha)', 'Größe B (ha)', 'Δ ha', 'Kulturart A', 'Kulturart B'];
  const data = compareRecords.map(r => {
    const gA = parseHa(r.groesseA);
    const gB = parseHa(r.groesseB);
    return [
      STATUS_LABELS[r.status],
      r.nummer || '',
      r.name || '',
      gA !== null ? gA.toFixed(2) : (r.groesseA || ''),
      gB !== null ? gB.toFixed(2) : (r.groesseB || ''),
      r.delta !== null ? r.delta.toFixed(2) : '',
      r.kulturA || '',
      r.kulturB || ''
    ];
  });
  const ts = new Date().toISOString().slice(0, 10);
  if (type === 'csv') exportCsv(headers, data, zuordnungFileName('Jahresvergleich', 'csv') || `jahresvergleich_${ts}.csv`);
  else if (type === 'xlsx') exportXlsx(headers, data, zuordnungFileName('Jahresvergleich', 'xlsx') || `jahresvergleich_${ts}.xlsx`, 'Vergleich');
  else if (type === 'pdf') exportPdf(headers, data, zuordnungFileName('Jahresvergleich', 'pdf') || `jahresvergleich_${ts}.pdf`, 'Jahresvergleich');
}

document.querySelectorAll('.export-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.getAttribute('data-export');
    const target = btn.getAttribute('data-target');
    if (target === 'viewer') exportViewerTable(type);
    else exportCompareTable(type);
  });
});

// ---------- Flächenkarten exportieren (Screenshot + Infos, eine Fläche pro PDF-Seite) ----------
// Von Viewer UND Flächenzeichner genutzt (siehe exportFlaechenkarten() /
// exportZeichnerFlaechenkarten() weiter unten).
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function waitForTilesLoaded(layer, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    function finish() { if (done) return; done = true; layer.off('load', finish); resolve(); }
    layer.once('load', finish);
    setTimeout(finish, timeoutMs);
  });
}

// Leaflet feuert das 'load'-Event der Kachelebene bereits, sobald alle
// angeforderten Kacheln entweder geladen ODER fehlgeschlagen sind — bei
// Rate-Limiting des Kachel-Servers (z.B. ArcGIS unter Last durch mehrere
// schnell aufeinanderfolgende Exports) führt das zu einzelnen schwarzen/
// leeren Kachel-Feldern im Screenshot. Deshalb zusätzlich gezielt nach
// <img>-Kacheln suchen, die nicht sauber geladen sind, und diese mehrfach
// neu anfordern, bevor der Screenshot aufgenommen wird.
async function waitForTilesFullyLoaded(satelliteLayer, mapElId, timeoutMs) {
  await waitForTilesLoaded(satelliteLayer, timeoutMs);
  await delay(400); // kurzer Puffer, damit der letzte Frame sicher gemalt ist

  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const broken = [...document.querySelectorAll(`#${mapElId} img.leaflet-tile`)]
      .filter(img => !img.complete || img.naturalWidth === 0);
    if (!broken.length) break;
    broken.forEach(img => { const src = img.src; img.src = ''; img.src = src; });
    await delay(700);
  }
}

// Wechselt bei Bedarf auf den angegebenen Tab (nötig, damit dessen Karten-
// Container beim Screenshot eine echte Größe hat) und liefert eine restore()
// Funktion, die zum vorher aktiven Tab zurückwechselt.
// Zeichnet eine Fläche als schlichten weißen Umriss auf dem Luftbild (ohne
// Füllung, wie bei einem klassischen Feldstück-Ausdruck), zoomt darauf und
// liefert einen Screenshot der Karte zurück. Wichtig: als eigener Canvas-
// Layer statt einen bestehenden SVG-Layer umzustylen — html2canvas berechnet
// die CSS-Transform-Verschiebung von Leaflets SVG-Overlay-Pane beim Screenshot
// falsch und rendert den Umriss dadurch versetzt zu den Kacheln. Ein
// <canvas>-Layer wird von html2canvas als reines Pixelbild kopiert und bleibt
// exakt an der richtigen Stelle.
async function captureParcelScreenshot(targetMap, satelliteLayer, mapElId, feature) {
  const highlightLayer = L.geoJSON(feature, {
    renderer: L.canvas(),
    style: { color: '#ffffff', weight: 3, opacity: 1, fillOpacity: 0 }
  }).addTo(targetMap);
  try {
    const bounds = highlightLayer.getBounds();
    if (bounds.isValid()) {
      targetMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
    }
    await waitForTilesFullyLoaded(satelliteLayer, mapElId, 6000);
    return await html2canvas(document.getElementById(mapElId), { useCORS: true, logging: false });
  } finally {
    targetMap.removeLayer(highlightLayer);
  }
}

// Schreibt Titel/Infozeile + Kartenbild einer Fläche auf die aktuelle PDF-Seite.
function addFlaechenkartePage(doc, pageW, pageH, margin, canvas, row) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(String(row.nummer || '–') + (row.featName ? ' – ' + row.featName : ''), margin, margin + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const num = parseFloat(String(row.groesse).replace(',', '.'));
  const groesseText = isFinite(num)
    ? num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha'
    : (row.groesse || '–');
  const subtitleParts = ['Größe: ' + groesseText, 'Kulturart: ' + (row.kultur || '–')];
  if (row.flaechenId) subtitleParts.push('Flächen-ID: ' + row.flaechenId);
  doc.text(subtitleParts.join('    ·    '), margin, margin + 11);

  const imageTop = margin + 18;
  const maxW = pageW - margin * 2;
  const maxH = pageH - imageTop - margin;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
  const imgW = canvas.width * scale;
  const imgH = canvas.height * scale;
  const imgX = (pageW - imgW) / 2;
  doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', imgX, imageTop, imgW, imgH);
}

async function exportFlaechenkarten() {
  if (typeof html2canvas === 'undefined') { showError('Flächenkarten-Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showError('Flächenkarten-Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  const rows = getVisibleFeatureRows();
  if (!rows.length) { showError('Keine Flächen zum Exportieren geladen.'); return; }

  const btn = document.getElementById('btn-export-flaechenkarten');
  btn.disabled = true;

  // Ausgangszustand merken, um ihn nach dem Export exakt wiederherzustellen.
  const savedCenter = map.getCenter();
  const savedZoom = map.getZoom();
  const savedBasemap = currentBasemap;
  const visibleLayerIds = Object.keys(layers).filter(id => layers[id].visible);

  visibleLayerIds.forEach(id => map.removeLayer(layers[id].leafletLayer));
  if (currentBasemap !== 'satellite') setBasemap('satellite');
  map.removeControl(map.zoomControl);

  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setStatus(`Exportiere Flächenkarten … (${i + 1}/${rows.length})`);

      let canvas;
      try {
        canvas = await captureParcelScreenshot(map, basemaps.satellite, 'map', row.leafletLayer.feature);
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für', row.nummer, err);
        showError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        break;
      }

      if (i > 0) doc.addPage('a4', 'landscape');
      addFlaechenkartePage(doc, pageW, pageH, margin, canvas, row);
    }

    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    const ts = new Date().toISOString().slice(0, 10);
    doc.save(zuordnungFileName('Flächenkarte', 'pdf') || `flaechenkarten_${ts}.pdf`);
    setStatus('Flächenkarten exportiert.');
  } finally {
    // Ursprünglichen Kartenzustand vollständig wiederherstellen.
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    visibleLayerIds.forEach(id => layers[id] && layers[id].leafletLayer.addTo(map));
    map.setView(savedCenter, savedZoom);
    btn.disabled = false;
  }
}

document.getElementById('btn-export-flaechenkarten').addEventListener('click', exportFlaechenkarten);

// ---------- Flächenzeichner ----------
// Eigener Tab: Parzellen direkt auf der Karte zeichnen (Leaflet.draw) statt
// aus einem Shapefile zu laden. Größe wird per turf.area() aus der
// gezeichneten Geometrie berechnet, Name/Kulturart sind optional frei
// eintragbar, Export nutzt dieselbe Flächenkarten-PDF-Logik wie der Viewer.
let zeichnerInitDone = false;
let zeichnerDrawPolygon = null; // Leaflet.draw-Handler, damit setActiveSegment() das Zeichnen beim Verlassen des Tabs abbrechen kann
let zeichnerDrawLine = null; // Leaflet.draw-Handler für die Schnittlinie bei "Fläche teilen"
let zeichnerLayerId = null; // id der synthetischen "Flächenzeichner"-Ebene im geteilten layers-Bestand
const zeichnerParcels = []; // featureIndex-Einträge der gezeichneten Flächen (gleicher Bestand wie überall sonst, nur gefiltert für diese Liste) — bei Neuladen/Betrieb-Wechsel aus einer wiederhergestellten "Flächenzeichner"-Ebene erneut befüllt, siehe addLayer()
let zeichnerColorIdx = 0;
let shapeEditingEntryId = null; // id der Fläche (beliebiger Herkunft — gezeichnet, hochgeladen oder wiederhergestellt), deren Eckpunkte gerade per Ziehen bearbeitbar sind (immer nur eine gleichzeitig)
let shapeGeometryCommitTimer = null;
let zeichnerSplitTargetId = null; // id der Fläche, die gerade per Schnittlinie geteilt wird

// Liefert die nächste freie, lückenlose Fläche-Nummer für neu gezeichnete
// Flächen — aus dem aktuellen Bestand berechnet statt aus einem simplen
// Zähler, der nach einem Neuladen/Betrieb-Wechsel nicht mehr zum tatsächlich
// geladenen Stand passt (sonst fängt "Fläche 1" nach jedem Neuladen wieder
// von vorne an, obwohl schon Flächen 1-3 existieren).
function nextZeichnerNummer() {
  let max = 0;
  zeichnerParcels.forEach(p => {
    const n = parseInt(p.props.NUMMER, 10);
    if (isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

// Legt beim allerersten Zeichnen die geteilte "Flächenzeichner"-Ebene an —
// alle weiteren gezeichneten Flächen werden per addFeatureToLayer() an
// dieselbe Ebene angehängt, statt jedes Mal eine neue Ebene zu erzeugen.
function ensureZeichnerLayer() {
  if (zeichnerLayerId) return zeichnerLayerId;
  const id = 'layer-' + (layerCounter++);
  const color = COLORS[zeichnerColorIdx % COLORS.length];
  const leafletLayer = L.geoJSON({ type: 'FeatureCollection', features: [] }, { renderer: L.canvas(), style: () => ({}) }).addTo(map);
  layers[id] = { name: 'Flächenzeichner', geojson: { type: 'FeatureCollection', features: [] }, leafletLayer, color, visible: true, isTeilflaechen: false, count: 0 };
  zeichnerLayerId = id;
  return id;
}

function initZeichnerMap() {
  if (zeichnerInitDone) return;
  zeichnerInitDone = true;

  if (typeof L.Draw === 'undefined') {
    shapeToolDrawBtn.disabled = true;
    shapeToolSplitBtn.disabled = true;
    showZeichnerError('Zeichenwerkzeug nicht verfügbar (Leaflet.draw konnte nicht geladen werden).');
    return;
  }

  zeichnerDrawPolygon = new L.Draw.Polygon(map, {
    shapeOptions: { color: '#8CB26B', weight: 1.8, fillColor: '#8CB26B', fillOpacity: 0.22 },
    showArea: true,
    metric: true,
    allowIntersection: false
  });

  // Schnittlinien-Werkzeug für "Fläche teilen" — wird nicht direkt über die
  // Werkzeugleiste scharf gestellt, sondern erst nach Anklicken einer
  // konkreten Zielfläche (siehe startParcelSplit weiter unten), da es immer
  // eine Zielfläche braucht (zeichnerSplitTargetId).
  zeichnerDrawLine = new L.Draw.Polyline(map, {
    shapeOptions: { color: '#EB5C4E', weight: 2.5, dashArray: '6,6' },
    metric: true,
    allowIntersection: true
  });

  map.on(L.Draw.Event.DRAWSTART, (e) => {
    if (e.layerType === 'polyline') {
      armedTool = 'split-line';
      setZeichnerStatus('Schnittlinie quer über die Fläche ziehen, mit Doppelklick abschließen (Esc zum Abbrechen).');
    } else if (armedTool === 'draw-polygon') {
      // armedTool wird vom "Zeichnen"-Button VOR dem enable() gesetzt (siehe
      // shapeToolDrawBtn weiter unten) — layerType allein reicht hier nicht
      // zur Unterscheidung, da der Hofplan-Abschnitt ebenfalls einen
      // L.Draw.Polygon-Handler mit demselben layerType 'polygon' nutzt.
      setZeichnerStatus('Zeichnen läuft … Eckpunkte anklicken, mit Doppelklick abschließen (Esc zum Abbrechen).');
    }
    // Andere Werte (z.B. 'draw-hofplan-rect'/'draw-hofplan-poly') gehören zu
    // einem anderen Zeichenwerkzeug — dessen eigener DRAWSTART-Handler kümmert
    // sich um Statuszeile/Toolbar, hier bewusst nichts tun.
    updateShapeToolbar();
  });
  map.on(L.Draw.Event.DRAWSTOP, (e) => {
    if (e.layerType === 'polyline') {
      if (armedTool === 'split-line') { armedTool = null; zeichnerSplitTargetId = null; }
    } else if (armedTool === 'draw-polygon') {
      armedTool = null;
    }
    updateShapeToolbar();
  });

  // Rechtsklick während des Zeichnens entfernt den zuletzt gesetzten Punkt
  // (deleteLastVertex ist eine öffentliche Methode von L.Draw.Polygon/
  // Polyline, sonst nur über die von uns nicht genutzte Standard-Toolbar
  // erreichbar).
  map.on('contextmenu', (e) => {
    if (armedTool === 'draw-polygon') { L.DomEvent.preventDefault(e); zeichnerDrawPolygon.deleteLastVertex(); }
    else if (armedTool === 'split-line') { L.DomEvent.preventDefault(e); zeichnerDrawLine.deleteLastVertex(); }
  });

  // Gezeichnete Flächen landen direkt im geteilten Datenbestand (layers/
  // featureIndex) statt in einer eigenen, nur dem Flächenzeichner bekannten
  // Liste — dadurch sind sie sofort auch im Viewer, im Jahresvergleich (als
  // Jahr B) und im Obstbaumkataster (Baum-Zuordnung) nutzbar.
  map.on(L.Draw.Event.CREATED, (e) => {
    if (e.layerType === 'polyline') {
      finishParcelSplit(e.layer);
      return;
    }
    // Guard nötig, seit der Hofplan-Abschnitt ebenfalls Polygone (und
    // Rechtecke) über denselben globalen CREATED-Event zeichnet — ohne diesen
    // Check würde ein dort gezeichnetes Gebäude hier zusätzlich fälschlich
    // als neue Flächenzeichner-Parzelle angelegt.
    if (armedTool !== 'draw-polygon') return;
    const layer = e.layer;
    const areaHa = turf.area(layer.toGeoJSON()) / 10000;
    const color = COLORS[zeichnerColorIdx % COLORS.length];
    zeichnerColorIdx++;
    const nummer = nextZeichnerNummer();

    const feature = {
      type: 'Feature',
      geometry: layer.toGeoJSON().geometry,
      properties: { NUMMER: nummer, NAME: '', KULTURART: '', FLAECHE_HA: Number(areaHa.toFixed(4)) }
    };
    const layerId = ensureZeichnerLayer();
    const entry = addFeatureToLayer(layerId, feature, color);
    entry.id = 'parcel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    entry.areaHa = areaHa;
    zeichnerParcels.push(entry);
    pushShapeUndo({ type: 'add', entryId: entry.id });
    renderParcelList();
    setZeichnerStatus(`Fläche ${nummer} gezeichnet (${areaHa.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha).`);
  });
}

function setZeichnerStatus(msg) { document.getElementById('zeichner-status').textContent = msg; }

function showZeichnerError(msg) {
  const el = document.getElementById('zeichner-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showZeichnerError._t);
  showZeichnerError._t = setTimeout(() => el.style.display = 'none', 6000);
}

function zoomToParcel(id) {
  const entry = zeichnerParcels.find(x => x.id === id);
  if (!entry || !entry.leafletLayer.getBounds) return;
  const bounds = entry.leafletLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
}

function removeParcel(id) {
  const entry = zeichnerParcels.find(x => x.id === id);
  if (!entry) return;
  pushShapeUndo({
    type: 'delete',
    layerId: entry.layerId,
    color: entry.color,
    feature: cloneFeature(entry.leafletLayer.feature),
    wasZeichnerOrigin: true
  });
  removeEntryEverywhere(entry);
  updateShapeToolbar();
}

// Kurzer Statustext an der richtigen Stelle — je nachdem, ob die betroffene
// Fläche zur Flächenzeichner-Ebene gehört (Zeichner-Statuszeile) oder
// hochgeladen/wiederhergestellt ist (allgemeine Viewer-Statuszeile).
function shapeStatus(entry, msg) {
  if (entry.layerId === zeichnerLayerId) setZeichnerStatus(msg);
  else setStatus(msg);
}

function cloneFeature(feature) { return JSON.parse(JSON.stringify(feature)); }

// Entfernt eine Fläche vollständig aus allen Beständen (featureIndex über
// removeFeatureEntry, zusätzlich zeichnerParcels und eine ggf. laufende
// Eckpunkt-Bearbeitung) — gemeinsam genutzt von Löschen-Werkzeug, "Entfernen"
// und den Rückgängig-Pfaden von Zeichnen/Teilen, damit diese Aufräum-Logik
// nur an einer Stelle gepflegt werden muss.
function removeEntryEverywhere(entry) {
  if (shapeEditingEntryId === entry.id) { shapeEditingEntryId = null; shapeEditBeforeGeometry = null; }
  const zIdx = zeichnerParcels.findIndex(p => p.id === entry.id);
  if (zIdx !== -1) zeichnerParcels.splice(zIdx, 1);
  removeFeatureEntry(entry); // rendert bereits Ebenenliste/Flächentabelle neu
  renderParcelList();
}

// ---------- Rückgängig ----------
// Ein gemeinsamer Verlaufsspeicher für Zeichnen/Bearbeiten/Löschen/Teilen —
// jeder Eintrag trägt genug Rohdaten (geklonte GeoJSON-Feature, betroffene
// Ebene/Farbe), um die Aktion ohne separaten Code-Pfad je Aktionsart wieder
// herzustellen.
function pushShapeUndo(action) {
  shapeUndoStack.push(action);
  if (shapeUndoStack.length > SHAPE_UNDO_MAX) shapeUndoStack.shift();
  // Eine echte neue Aktion verwirft die Redo-Historie (Standard-Undo/Redo-
  // Semantik) — anders als pushShapeUndoKeepRedo(), das redoLastShapeAction()
  // selbst benutzt, um die soeben wiederhergestellte Aktion erneut auf den
  // Undo-Stack zu legen, ohne den Rest der Redo-Historie zu verwerfen.
  shapeRedoStack.length = 0;
  updateShapeToolbar();
}

function pushShapeUndoKeepRedo(action) {
  shapeUndoStack.push(action);
  if (shapeUndoStack.length > SHAPE_UNDO_MAX) shapeUndoStack.shift();
  updateShapeToolbar();
}

// Baut beim Rückgängig-Machen zusätzlich die passende Redo-Gegenaktion —
// da das rückgängig gemachte Objekt dabei gerade entfernt/verändert wird,
// muss die Redo-Aktion alle nötigen Daten selbst mitbringen (nicht nur eine
// ID, die es dann evtl. gar nicht mehr gibt).
function undoLastShapeAction() {
  const action = shapeUndoStack.pop();
  if (!action) return;
  let redoAction = null;
  if (action.type === 'add') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) {
      redoAction = {
        type: 'add',
        layerId: entry.layerId,
        color: entry.color,
        feature: cloneFeature(entry.leafletLayer.feature),
        wasZeichnerOrigin: zeichnerParcels.some(p => p.id === entry.id)
      };
      removeEntryEverywhere(entry);
    }
    setZeichnerStatus('Zeichnen rückgängig gemacht.');
  } else if (action.type === 'delete' || action.type === 'split') {
    let removedPieces = null;
    if (action.type === 'split') {
      removedPieces = action.newEntryIds
        .map(id => featureIndex.find(x => x.id === id))
        .filter(Boolean)
        .map(e => ({ feature: cloneFeature(e.leafletLayer.feature), color: e.color }));
      action.newEntryIds.forEach(id => {
        const e = featureIndex.find(x => x.id === id);
        if (e) removeEntryEverywhere(e);
      });
    }
    const entry = addFeatureToLayer(action.layerId, action.feature, action.color);
    if (action.wasZeichnerOrigin) {
      entry.areaHa = turf.area(entry.leafletLayer.toGeoJSON()) / 10000;
      zeichnerParcels.push(entry);
    }
    renderParcelList();
    redoAction = action.type === 'split'
      ? { type: 'split', entryId: entry.id, pieces: removedPieces }
      : { type: 'delete', entryId: entry.id };
    setZeichnerStatus(action.type === 'split' ? 'Teilen rückgängig gemacht.' : 'Löschen rückgängig gemacht.');
  } else if (action.type === 'edit') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) {
      const currentGeometry = cloneFeature(entry.leafletLayer.feature).geometry;
      applyGeometryToEntry(entry, action.beforeGeometry);
      renderFeatureTable();
      renderParcelList();
      redoAction = { type: 'edit', entryId: entry.id, geometry: currentGeometry };
    }
    setZeichnerStatus('Bearbeitung rückgängig gemacht.');
  }
  if (redoAction) shapeRedoStack.push(redoAction);
  reassignAllTreesToParcels();
  updateShapeToolbar();
}

function redoLastShapeAction() {
  const action = shapeRedoStack.pop();
  if (!action) return;
  if (action.type === 'add') {
    const entry = addFeatureToLayer(action.layerId, action.feature, action.color);
    if (action.wasZeichnerOrigin) {
      entry.areaHa = turf.area(entry.leafletLayer.toGeoJSON()) / 10000;
      zeichnerParcels.push(entry);
    }
    renderParcelList();
    pushShapeUndoKeepRedo({ type: 'add', entryId: entry.id });
    setZeichnerStatus('Zeichnen wiederhergestellt.');
  } else if (action.type === 'delete') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) {
      pushShapeUndoKeepRedo({
        type: 'delete',
        layerId: entry.layerId,
        color: entry.color,
        feature: cloneFeature(entry.leafletLayer.feature),
        wasZeichnerOrigin: zeichnerParcels.some(p => p.id === entry.id)
      });
      removeEntryEverywhere(entry);
    }
    setZeichnerStatus('Löschen wiederhergestellt.');
  } else if (action.type === 'split') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) {
      const undoFeature = cloneFeature(entry.leafletLayer.feature);
      const undoColor = entry.color;
      const layerId = entry.layerId;
      const isZeichnerOrigin = zeichnerParcels.some(p => p.id === entry.id);
      removeEntryEverywhere(entry);
      const newEntryIds = [];
      (action.pieces || []).forEach(p => {
        const newEntry = addFeatureToLayer(layerId, p.feature, p.color);
        if (isZeichnerOrigin) {
          newEntry.id = 'parcel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
          newEntry.areaHa = turf.area(newEntry.leafletLayer.toGeoJSON()) / 10000;
          zeichnerParcels.push(newEntry);
        }
        newEntryIds.push(newEntry.id);
      });
      renderParcelList();
      pushShapeUndoKeepRedo({ type: 'split', layerId, color: undoColor, feature: undoFeature, wasZeichnerOrigin: isZeichnerOrigin, newEntryIds });
    }
    setZeichnerStatus('Teilen wiederhergestellt.');
  } else if (action.type === 'edit') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) {
      const beforeGeometry = cloneFeature(entry.leafletLayer.feature).geometry;
      applyGeometryToEntry(entry, action.geometry);
      renderFeatureTable();
      renderParcelList();
      pushShapeUndoKeepRedo({ type: 'edit', entryId: entry.id, beforeGeometry });
    }
    setZeichnerStatus('Bearbeitung wiederhergestellt.');
  }
  reassignAllTreesToParcels();
  updateShapeToolbar();
}

// Setzt die Geometrie eines Eintrags direkt (ohne Eckpunkt-Bearbeitung) auf
// einen früheren Stand zurück — für Rückgängig einer Formänderung.
function applyGeometryToEntry(entry, geometry) {
  const depth = geometry.type === 'MultiPolygon' ? 2 : 1;
  entry.leafletLayer.setLatLngs(L.GeoJSON.coordsToLatLngs(geometry.coordinates, depth));
  entry.leafletLayer.feature.geometry = geometry;
  entry.center = entry.leafletLayer.getBounds().getCenter();
  if (entry.labelAnchor && entry.labelAnchor.setLatLng) entry.labelAnchor.setLatLng(entry.center);
  const areaHa = turf.area(entry.leafletLayer.toGeoJSON()) / 10000;
  entry.areaHa = areaHa;
  entry.groesse = String(areaHa);
  entry.props.FLAECHE_HA = Number(areaHa.toFixed(4));
}

// Löschen-Werkzeug in der Kartenleiste: Klick auf eine Fläche entfernt sie
// sofort (mit Rückgängig-Möglichkeit statt einer zusätzlichen Rückfrage).
function deleteShapeViaTool(entry) {
  const label = entry.nummer || entry.featName || '';
  pushShapeUndo({
    type: 'delete',
    layerId: entry.layerId,
    color: entry.color,
    feature: cloneFeature(entry.leafletLayer.feature),
    wasZeichnerOrigin: zeichnerParcels.some(p => p.id === entry.id)
  });
  removeEntryEverywhere(entry);
  shapeStatus(entry, `Fläche ${label} gelöscht.`);
  updateShapeToolbar();
}

// ---------- Eckpunkte einer Fläche per Ziehen anpassen ----------
// Nutzt L.Edit.Poly aus Leaflet.draw (steckt automatisch in jedem Polygon,
// egal ob gezeichnet, hochgeladen oder aus der Cloud wiederhergestellt, siehe
// die .on('edit', …)-Verdrahtung in buildFeatureEntry) — kein eigenes
// Zieh-Handling nötig, nur enable()/disable() und das Nachziehen von
// Fläche/Mittelpunkt/Baum-Zuordnung, wenn sich die Form ändert. Funktioniert
// für jede Fläche in featureIndex, nicht nur gezeichnete.
function disableShapeEditing() {
  if (!shapeEditingEntryId) return;
  const entry = featureIndex.find(x => x.id === shapeEditingEntryId);
  if (entry && entry.leafletLayer.editing) {
    entry.leafletLayer.editing.disable();
    if (shapeEditBeforeGeometry && JSON.stringify(shapeEditBeforeGeometry) !== JSON.stringify(entry.leafletLayer.feature.geometry)) {
      pushShapeUndo({ type: 'edit', entryId: entry.id, beforeGeometry: shapeEditBeforeGeometry });
    }
  }
  shapeEditBeforeGeometry = null;
  shapeEditingEntryId = null;
  updateShapeToolbar();
}

function toggleShapeEdit(entry) {
  if (!entry || !entry.leafletLayer.editing) return;
  if (shapeEditingEntryId === entry.id) {
    disableShapeEditing();
  } else {
    disableShapeEditing(); // vorherige Bearbeitung zuerst sauber beenden (inkl. Rückgängig-Eintrag)
    shapeEditBeforeGeometry = cloneFeature(entry.leafletLayer.feature).geometry;
    entry.leafletLayer.editing.enable();
    shapeEditingEntryId = entry.id;
    shapeStatus(entry, `Fläche ${entry.nummer || ''}: Eckpunkte ziehen, um Form/Standort zu ändern.`);
  }
  renderFeatureTable();
  renderParcelList();
  updateShapeToolbar();
}

// Feuert bei JEDEM Eckpunkt-Zug (auch während des Ziehens) — hält Geometrie
// und Label-Position sofort sichtbar aktuell, verschiebt die teureren
// Neuberechnungen (Fläche, Baum-Zuordnung, Tabellen-Neuaufbau) aber per
// Debounce ans Ende der Zieh-Geste, statt bei jedem Zwischenschritt neu zu
// rendern.
function syncShapeGeometryLive(entry) {
  const freshGeoJson = entry.leafletLayer.toGeoJSON();
  // Gleiche Objektreferenz wie in layers[id].geojson.features (siehe
  // addFeatureToLayer) — die Mutation reicht, kein erneutes Einsetzen nötig.
  entry.leafletLayer.feature.geometry = freshGeoJson.geometry;
  entry.center = entry.leafletLayer.getBounds().getCenter();
  if (entry.labelAnchor && entry.labelAnchor.setLatLng) entry.labelAnchor.setLatLng(entry.center);
  clearTimeout(shapeGeometryCommitTimer);
  shapeGeometryCommitTimer = setTimeout(() => commitShapeGeometry(entry), 200);
}

function commitShapeGeometry(entry) {
  const newAreaHa = turf.area(entry.leafletLayer.toGeoJSON()) / 10000;
  entry.areaHa = newAreaHa;
  entry.groesse = String(newAreaHa);
  entry.props.FLAECHE_HA = Number(newAreaHa.toFixed(4));
  reassignAllTreesToParcels();
  renderFeatureTable();
  renderParcelList();
  shapeStatus(entry, `Fläche ${entry.nummer || ''} angepasst (${newAreaHa.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha).`);
}

// ---------- Fläche teilen ----------
// Zerschneidet eine Fläche entlang einer frei gezeichneten Linie in zwei
// Teilflächen — funktioniert für jede geladene Fläche, nicht nur gezeichnete.
function startParcelSplit(entry) {
  initZeichnerMap(); // stellt sicher, dass zeichnerDrawLine existiert, auch wenn der Flächenzeichner-Tab noch nie geöffnet wurde
  if (!zeichnerDrawLine) { showZeichnerError('Schnittwerkzeug nicht verfügbar.'); return; }
  disableShapeEditing();
  zeichnerSplitTargetId = entry.id;
  zeichnerDrawLine.enable();
}

// Verlängert die gezogene Linie an beiden Enden weit über die Fläche hinaus
// und baut daraus ein großes Halbebenen-Rechteck auf einer Seite — turf.
// intersect() liefert damit die eine Teilfläche, turf.difference() die
// komplementäre andere. Robuster als ein direkter Linienschnitt, da die
// gezogene Linie die Fläche nicht exakt bis zum Rand treffen muss.
function splitPolygonByLine(polygonFeature, linePoints) {
  const bbox = turf.bbox(polygonFeature);
  const diagKm = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[2], bbox[3]]), { units: 'kilometers' });
  const ext = Math.max(diagKm * 3, 0.5);

  const first = linePoints[0];
  const last = linePoints[linePoints.length - 1];
  const bearingFwd = turf.bearing(turf.point(first), turf.point(last));
  const startExt = turf.destination(turf.point(first), ext, bearingFwd + 180, { units: 'kilometers' }).geometry.coordinates;
  const endExt = turf.destination(turf.point(last), ext, bearingFwd, { units: 'kilometers' }).geometry.coordinates;
  const extendedLine = [startExt, ...linePoints, endExt];

  const perpBearing = bearingFwd + 90;
  const offsetSide = extendedLine.map(pt =>
    turf.destination(turf.point(pt), ext, perpBearing, { units: 'kilometers' }).geometry.coordinates
  );
  const halfPoly = turf.polygon([[...extendedLine, ...offsetSide.slice().reverse(), extendedLine[0]]]);

  let pieceA = null, pieceB = null;
  try {
    pieceA = turf.intersect(polygonFeature, halfPoly);
    pieceB = turf.difference(polygonFeature, halfPoly);
  } catch {
    return null;
  }
  if (!pieceA || !pieceB) return null;
  return { pieceA, pieceB };
}

function finishParcelSplit(lineLayer) {
  const targetId = zeichnerSplitTargetId;
  zeichnerSplitTargetId = null;
  const entry = featureIndex.find(x => x.id === targetId);
  if (!entry) { setZeichnerStatus('Zielfläche nicht mehr vorhanden — Teilen abgebrochen.'); return; }

  const linePoints = lineLayer.toGeoJSON().geometry.coordinates;
  if (linePoints.length < 2) { shapeStatus(entry, 'Schnittlinie braucht mindestens zwei Punkte.'); return; }

  const result = splitPolygonByLine(entry.leafletLayer.feature, linePoints);
  if (!result) {
    showZeichnerError('Fläche konnte nicht geteilt werden — Schnittlinie muss die Fläche komplett durchqueren.');
    return;
  }
  const { pieceA, pieceB } = result;
  const areaA = turf.area(pieceA) / 10000;
  const areaB = turf.area(pieceB) / 10000;
  if (areaA <= 0 || areaB <= 0) {
    showZeichnerError('Fläche konnte nicht geteilt werden — beide Teile müssen eine sichtbare Größe haben.');
    return;
  }

  const layerId = entry.layerId;
  const color = entry.color;
  const isZeichnerOrigin = zeichnerParcels.some(p => p.id === entry.id);
  const baseName = entry.featName || '';
  const baseNummer = entry.props.NUMMER;

  const undoAction = {
    type: 'split',
    layerId, color,
    feature: cloneFeature(entry.leafletLayer.feature),
    wasZeichnerOrigin: isZeichnerOrigin,
    newEntryIds: []
  };

  removeEntryEverywhere(entry);

  [[pieceA, areaA, 'A'], [pieceB, areaB, 'B']].forEach(([piece, areaHa, suffix]) => {
    const nummer = isZeichnerOrigin ? nextZeichnerNummer() : `${baseNummer}-${suffix}`;
    const feature = {
      type: 'Feature',
      geometry: piece.geometry,
      properties: { ...entry.props, NUMMER: nummer, NAME: baseName ? `${baseName} (Teil ${suffix})` : '', FLAECHE_HA: Number(areaHa.toFixed(4)) }
    };
    const newEntry = addFeatureToLayer(layerId, feature, color);
    if (isZeichnerOrigin) {
      newEntry.id = 'parcel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      newEntry.areaHa = areaHa;
      zeichnerParcels.push(newEntry);
    }
    undoAction.newEntryIds.push(newEntry.id);
  });
  pushShapeUndo(undoAction);

  renderParcelList();
  reassignAllTreesToParcels();
  shapeStatus(entry, `Fläche geteilt in ${areaA.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha und ${areaB.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha.`);
}

// ---------- Schwebende Werkzeugleiste: frei verschiebbar per Drag&Drop ----------
// #edit-toolbar ist EIN gemeinsames, an Illustrator angelehntes Panel für
// beide Zeichenwerkzeuge (Flächenzeichner-Gruppe hier, Hofplan-Gruppe weiter
// unten) — schwebt über der Karte statt in #topbar zu stecken, damit es sich
// unabhängig von den festen Kartensteuerungen (Basiskarte/Auf Inhalt zoomen/
// GPS, bleiben in #topbar) verschieben lässt. Nach dem Muster von
// wireKulturplanBarDrag() (Pointer Events: pointerdown auf dem Griff,
// pointermove/pointerup am document, Start-Offset merken, Listener nach
// pointerup wieder entfernen). Beim Loslassen nah am oberen/unteren
// Kartenrand schaltet die Leiste auf horizontale Ausrichtung um und dockt
// dort an, sonst bleibt sie vertikal an der losgelassenen Stelle.
function wireEditToolbarDrag(toolbar, handle, boundsWrap) {
  const DOCK_THRESHOLD = 50;

  function clampToWrap(leftPx, topPx) {
    const wrapRect = boundsWrap.getBoundingClientRect();
    const left = Math.min(Math.max(leftPx, 0), Math.max(wrapRect.width - toolbar.offsetWidth, 0));
    const top = Math.min(Math.max(topPx, 0), Math.max(wrapRect.height - toolbar.offsetHeight, 0));
    return { left, top };
  }

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const barRect = toolbar.getBoundingClientRect();
    const offsetX = e.clientX - barRect.left;
    const offsetY = e.clientY - barRect.top;
    toolbar.classList.add('dragging');

    function onMove(ev) {
      const wrapRect = boundsWrap.getBoundingClientRect();
      const { left, top } = clampToWrap(ev.clientX - wrapRect.left - offsetX, ev.clientY - wrapRect.top - offsetY);
      toolbar.style.left = left + 'px';
      toolbar.style.top = top + 'px';
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      toolbar.classList.remove('dragging');

      const wrapRect = boundsWrap.getBoundingClientRect();
      const barRect = toolbar.getBoundingClientRect();
      const distTop = barRect.top - wrapRect.top;
      const distBottom = wrapRect.bottom - barRect.bottom;
      if (distTop <= DOCK_THRESHOLD || distBottom <= DOCK_THRESHOLD) {
        toolbar.classList.add('horizontal');
        const dockedTop = distTop <= DOCK_THRESHOLD ? 12 : wrapRect.height - toolbar.offsetHeight - 12;
        const { left, top } = clampToWrap(barRect.left - wrapRect.left, dockedTop);
        toolbar.style.left = left + 'px';
        toolbar.style.top = top + 'px';
      } else {
        toolbar.classList.remove('horizontal');
      }
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}
wireEditToolbarDrag(document.getElementById('edit-toolbar'), document.getElementById('edit-toolbar-handle'), document.getElementById('map-wrap'));

// ---------- Werkzeugleiste: Flächenzeichner-Gruppe ----------
// Bündelt Zeichnen/Bearbeiten/Teilen/Löschen/Rückgängig/Wiederherstellen an
// einer Stelle, statt sie doppelt als Zeilen-Buttons in der Flächenzeichner-
// Liste UND der Flächentabelle vorzuhalten — die Werkzeuge wirken auf jede
// Fläche, die auf
// der Karte angeklickt wird, unabhängig vom gerade aktiven Reiter.
const shapeToolDrawBtn = document.getElementById('shape-tool-draw');
const shapeToolEditBtn = document.getElementById('shape-tool-edit');
const shapeToolSplitBtn = document.getElementById('shape-tool-split');
const shapeToolDeleteBtn = document.getElementById('shape-tool-delete');
const shapeToolUndoBtn = document.getElementById('shape-tool-undo');
const shapeToolRedoBtn = document.getElementById('shape-tool-redo');

function updateShapeToolbar() {
  shapeToolDrawBtn.classList.toggle('active', armedTool === 'draw-polygon');
  shapeToolEditBtn.classList.toggle('active', mapToolMode === 'edit');
  shapeToolDeleteBtn.classList.toggle('active', mapToolMode === 'delete');
  shapeToolSplitBtn.classList.toggle('active', mapToolMode === 'split' || armedTool === 'split-line');
  shapeToolUndoBtn.disabled = shapeUndoStack.length === 0;
  shapeToolRedoBtn.disabled = shapeRedoStack.length === 0;
}

// Bearbeiten/Löschen bleiben "scharf", bis man sie erneut anklickt (oder Esc
// drückt) — man kann so mehrere Flächen hintereinander anklicken, ohne das
// Werkzeug jedes Mal neu auswählen zu müssen. Die Werkzeugleiste zeigt nur
// noch Icons (siehe #edit-toolbar) — Hinweistexte laufen daher über die
// normale Statuszeile (setZeichnerStatus), nicht mehr über ein eigenes
// Textfeld in der Werkzeugleiste selbst.
function setMapToolMode(mode) {
  disableShapeEditing();
  mapToolMode = mapToolMode === mode ? null : mode;
  if (mapToolMode === 'edit') setZeichnerStatus('Fläche anklicken, um ihre Eckpunkte zu bearbeiten.');
  else if (mapToolMode === 'delete') setZeichnerStatus('Fläche anklicken, um sie zu löschen.');
  updateShapeToolbar();
}

shapeToolDrawBtn.addEventListener('click', () => {
  initZeichnerMap(); // funktioniert von jedem Reiter aus, auch ohne den Flächenzeichner-Tab je geöffnet zu haben
  // Vor enable() setzen, nicht erst im DRAWSTART-Handler — der muss anhand von
  // armedTool zwischen diesem Werkzeug und dem gleichartigen Hofplan-Freiform-
  // Werkzeug unterscheiden (beide nutzen layerType 'polygon').
  armedTool = 'draw-polygon';
  if (zeichnerDrawPolygon) zeichnerDrawPolygon.enable();
});
shapeToolEditBtn.addEventListener('click', () => setMapToolMode('edit'));
shapeToolDeleteBtn.addEventListener('click', () => setMapToolMode('delete'));
shapeToolSplitBtn.addEventListener('click', () => {
  if (mapToolMode === 'split' || armedTool === 'split-line') {
    mapToolMode = null;
    if (zeichnerDrawLine) zeichnerDrawLine.disable();
  } else {
    disableShapeEditing();
    mapToolMode = 'split';
    setZeichnerStatus('Fläche anklicken, um sie zu teilen.');
  }
  updateShapeToolbar();
});
shapeToolUndoBtn.addEventListener('click', undoLastShapeAction);
shapeToolRedoBtn.addEventListener('click', redoLastShapeAction);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mapToolMode) { mapToolMode = null; updateShapeToolbar(); }
});

// ---- Zeichnen auf der Karte per Touch: Fertig / Letzter Punkt / Abbrechen ----
// Leaflet.draw schließt eine Fläche sonst nur per Doppelklick bzw. Klick auf
// den ersten Punkt ab und entfernt den letzten Punkt nur per Rechtsklick
// (siehe contextmenu-Handler) — auf dem Handy gibt es beides nicht.
function activeMapDrawHandler() {
  if (armedTool === 'draw-polygon') return zeichnerDrawPolygon;
  if (armedTool === 'split-line') return zeichnerDrawLine;
  if (armedTool === 'draw-hofplan-poly') return hofplanDrawPoly;
  if (armedTool === 'draw-hofplan-rect') return hofplanDrawRect;
  return null;
}
function updateMapDrawActions() {
  const handler = activeMapDrawHandler();
  const drawing = !!(handler && handler.enabled());
  document.getElementById('edit-toolbar').classList.toggle('is-drawing', drawing);
  document.getElementById('map-draw-actions').hidden = !drawing;
  if (!drawing) return;
  // Rechteck wird gezogen, nicht Punkt für Punkt gesetzt — dort nur Abbrechen.
  const pointBased = typeof handler.deleteLastVertex === 'function';
  const count = pointBased && handler._markers ? handler._markers.length : 0;
  const undoBtn = document.getElementById('map-draw-undo');
  const finishBtn = document.getElementById('map-draw-finish');
  undoBtn.hidden = !pointBased;
  finishBtn.hidden = !pointBased;
  undoBtn.disabled = count === 0;
  finishBtn.disabled = count < (armedTool === 'split-line' ? 2 : 3);
}
map.on('draw:drawstart draw:drawstop draw:drawvertex', () => setTimeout(updateMapDrawActions, 0));
document.getElementById('map-draw-undo').addEventListener('click', () => {
  const handler = activeMapDrawHandler();
  if (handler && handler.enabled() && handler.deleteLastVertex) handler.deleteLastVertex();
  updateMapDrawActions();
});
document.getElementById('map-draw-finish').addEventListener('click', () => {
  const handler = activeMapDrawHandler();
  if (handler && handler.enabled() && handler.completeShape) handler.completeShape();
  setTimeout(updateMapDrawActions, 0);
});
document.getElementById('map-draw-cancel').addEventListener('click', () => {
  const handler = activeMapDrawHandler();
  if (handler && handler.enabled()) handler.disable();
  setTimeout(updateMapDrawActions, 0);
});

updateShapeToolbar();

function renderParcelList() {
  const list = document.getElementById('zeichner-list');
  document.getElementById('zeichner-empty-hint').style.display = zeichnerParcels.length ? 'none' : 'block';
  list.innerHTML = '';
  zeichnerParcels.forEach(p => {
    const item = document.createElement('div');
    item.className = 'parcel-item';
    item.innerHTML = `
      <div class="parcel-row">
        <div class="swatch" style="background:${p.color}"></div>
        <div class="parcel-nummer">#${p.nummer}</div>
        <input class="parcel-name" data-id="${p.id}" placeholder="Flächenname (optional)" value="${escapeHtml(p.featName)}">
        <div class="parcel-size">${p.areaHa.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha</div>
      </div>
      <input class="parcel-kultur" data-id="${p.id}" placeholder="Kulturart (optional)" value="${escapeHtml(p.kultur)}">
      <div class="layer-actions">
        <button data-id="${p.id}" data-action="zoom">Zoom</button>
        <button data-id="${p.id}" data-action="remove" class="danger">Entfernen</button>
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.parcel-name').forEach(input => {
    input.addEventListener('input', () => {
      const p = zeichnerParcels.find(x => x.id === input.getAttribute('data-id'));
      if (p) updateDrawnParcelEntry(p, { name: input.value });
    });
  });
  list.querySelectorAll('.parcel-kultur').forEach(input => {
    input.addEventListener('input', () => {
      const p = zeichnerParcels.find(x => x.id === input.getAttribute('data-id'));
      if (p) updateDrawnParcelEntry(p, { kultur: input.value });
    });
  });
  list.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const action = el.getAttribute('data-action');
      if (action === 'zoom') zoomToParcel(id);
      if (action === 'remove') removeParcel(id);
    });
  });
}

// Speichert die gezeichneten Flächen als reguläres GeoJSON — analog zum
// Baumkataster-Export im Obstbaumkataster-Tab, z.B. für die Weiterverwendung
// in einem GIS-Programm oder zum Sichern außerhalb des Browsers. Die
// Feature-Objekte stecken (Geometrie + stets aktuelle NAME/KULTURART-Props
// dank updateDrawnParcelEntry()) bereits fertig in entry.leafletLayer.feature.
function exportZeichnerGeoJSON() {
  if (!zeichnerParcels.length) { showZeichnerError('Noch keine Fläche gezeichnet.'); return; }
  const fc = { type: 'FeatureCollection', features: zeichnerParcels.map(p => p.leafletLayer.feature) };
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(fc, null, 2), zuordnungFileName('Flächen Zeichner', 'geojson') || `flaechenzeichner_${ts}.geojson`, 'application/geo+json');
  setZeichnerStatus('Als GeoJSON gespeichert.');
}
document.getElementById('btn-export-zeichner-geojson').addEventListener('click', exportZeichnerGeoJSON);

async function exportZeichnerFlaechenkarten() {
  if (typeof html2canvas === 'undefined') { showZeichnerError('Flächenkarten-Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showZeichnerError('Flächenkarten-Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!zeichnerParcels.length) { showZeichnerError('Noch keine Fläche gezeichnet.'); return; }

  const btn = document.getElementById('btn-export-zeichner-flaechenkarten');
  btn.disabled = true;

  const savedCenter = map.getCenter();
  const savedZoom = map.getZoom();
  const savedBasemap = currentBasemap;

  const zeichnerLeafletLayer = zeichnerLayerId ? layers[zeichnerLayerId].leafletLayer : null;
  if (zeichnerLeafletLayer) map.removeLayer(zeichnerLeafletLayer);
  if (currentBasemap !== 'satellite') setBasemap('satellite');
  map.removeControl(map.zoomControl);

  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  try {
    for (let i = 0; i < zeichnerParcels.length; i++) {
      const p = zeichnerParcels[i];
      setZeichnerStatus(`Exportiere Flächenkarten … (${i + 1}/${zeichnerParcels.length})`);

      let canvas;
      try {
        canvas = await captureParcelScreenshot(map, basemaps.satellite, 'map', p.leafletLayer.toGeoJSON());
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für', p.nummer, err);
        showZeichnerError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        break;
      }

      if (i > 0) doc.addPage('a4', 'landscape');
      addFlaechenkartePage(doc, pageW, pageH, margin, canvas, {
        nummer: p.nummer,
        featName: p.featName,
        groesse: String(p.areaHa),
        kultur: p.kultur,
        flaechenId: ''
      });
    }

    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    const ts = new Date().toISOString().slice(0, 10);
    doc.save(zuordnungFileName('Flächenkarte Zeichner', 'pdf') || `flaechenkarten_gezeichnet_${ts}.pdf`);
    setZeichnerStatus('Flächenkarten exportiert.');
  } finally {
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    if (zeichnerLeafletLayer) zeichnerLeafletLayer.addTo(map);
    map.setView(savedCenter, savedZoom);
    btn.disabled = false;
  }
}

document.getElementById('btn-export-zeichner-flaechenkarten').addEventListener('click', exportZeichnerFlaechenkarten);

// ---------- Obstbaumkataster ----------
// Eigener Tab: Obstbäume als farbige Punkte erfassen. Die 6 häufigsten
// Obstarten in Deutschland (Streuobst-Kontext) sind als Standard-Favoriten
// direkt als Buttons wählbar, alle weiteren über die "Sonstige"-Liste. Jede
// Art hat eine feste Farbe, die konsistent für Kartenpunkte, Tabellen-Chips,
// Summen und die PDF-Legende verwendet wird. Welche Arten als Favoriten
// angezeigt werden, ist per Drag&Drop änderbar (siehe favoriteFruitKeys).
const FRUIT_TYPES_TOP6 = [
  { key: 'apfel', label: 'Apfel', color: '#D6483C' },
  { key: 'birne', label: 'Birne', color: '#C7B23A' },
  { key: 'suesskirsche', label: 'Süßkirsche', color: '#8E2A4B' },
  { key: 'sauerkirsche', label: 'Sauerkirsche', color: '#B23A5E' },
  { key: 'pflaume', label: 'Pflaume/Zwetschge', color: '#5B4B8A' },
  { key: 'walnuss', label: 'Walnuss', color: '#8A6238' }
];
const FRUIT_TYPES_SONSTIGE = [
  { key: 'mirabelle', label: 'Mirabelle', color: '#E0B23D' },
  { key: 'reneklode', label: 'Renekloden', color: '#7A9B4E' },
  { key: 'quitte', label: 'Quitte', color: '#C9A227' },
  { key: 'aprikose', label: 'Aprikose', color: '#E08A3C' },
  { key: 'pfirsich', label: 'Pfirsich', color: '#E68F82' },
  { key: 'haselnuss', label: 'Haselnuss', color: '#A47449' },
  { key: 'esskastanie', label: 'Esskastanie', color: '#6B4A32' },
  { key: 'holunder', label: 'Holunder', color: '#3C4A6B' },
  { key: 'mispel', label: 'Mispel', color: '#7C6A4E' }
];

// Statt einer festen "Sonstige/Unbekannt"-Art können Nutzer eigene Obstarten
// anlegen (Name + automatisch vergebene Farbe) — z.B. regionale Sorten, die
// in der Standardliste fehlen. Bleiben per localStorage erhalten.
const OBSTBAUM_CUSTOM_FRUITS_KEY = 'oekoviewer-obstbaum-custom-fruits';
function loadCustomFruits() {
  try {
    const arr = JSON.parse(localStorage.getItem(OBSTBAUM_CUSTOM_FRUITS_KEY));
    if (Array.isArray(arr)) {
      return arr.filter(f => f && typeof f.key === 'string' && typeof f.label === 'string' && typeof f.color === 'string');
    }
  } catch (err) {}
  return [];
}
function saveCustomFruits() {
  try { localStorage.setItem(OBSTBAUM_CUSTOM_FRUITS_KEY, JSON.stringify(customFruits)); } catch (err) {}
}
let customFruits = loadCustomFruits();

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = n => Math.round(255 * f(n)).toString(16).padStart(2, '0');
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}
// Golden-Angle-Rotation über den Farbkreis, damit aufeinanderfolgende eigene
// Arten sich immer deutlich in der Farbe unterscheiden statt sich zu ähneln.
function nextCustomFruitColor() {
  const hue = (customFruits.length * 137.5) % 360;
  return hslToHex(hue, 55, 46);
}

function allFruitTypes() { return [...FRUIT_TYPES_TOP6, ...FRUIT_TYPES_SONSTIGE, ...customFruits]; }
let FRUIT_BY_KEY = {};
function rebuildFruitIndex() { FRUIT_BY_KEY = Object.fromEntries(allFruitTypes().map(f => [f.key, f])); }
rebuildFruitIndex();
function fruitOf(key) { return FRUIT_BY_KEY[key] || { key, label: key, color: '#6B7280' }; }

function addCustomFruit(label) {
  const trimmed = (label || '').trim();
  if (!trimmed) return null;
  const exists = allFruitTypes().some(f => f.label.toLowerCase() === trimmed.toLowerCase());
  if (exists) { setObstbaumStatus(`„${trimmed}" gibt es bereits.`); return null; }
  const slug = trimmed.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'obstart';
  let key = 'custom-' + slug;
  let n = 2;
  while (FRUIT_BY_KEY[key]) { key = 'custom-' + slug + '-' + (n++); }
  const fruit = { key, label: trimmed, color: nextCustomFruitColor(), custom: true };
  customFruits.push(fruit);
  saveCustomFruits();
  rebuildFruitIndex();
  return fruit;
}

const OBSTBAUM_FAVORITES_KEY = 'oekoviewer-obstbaum-favorites';
function loadFavoriteFruits() {
  try {
    const arr = JSON.parse(localStorage.getItem(OBSTBAUM_FAVORITES_KEY));
    if (Array.isArray(arr) && arr.length === FRUIT_TYPES_TOP6.length && arr.every(k => FRUIT_BY_KEY[k])) return arr;
  } catch (err) {}
  return null;
}
function saveFavoriteFruits() {
  try { localStorage.setItem(OBSTBAUM_FAVORITES_KEY, JSON.stringify(favoriteFruitKeys)); } catch (err) {}
}

let favoriteFruitKeys = loadFavoriteFruits() || FRUIT_TYPES_TOP6.map(f => f.key);
let obstbaumInitDone = false;
let obstbaumLayerGroup = null;
let obstbaumTablePanel = null;
const obstbaumTrees = []; // { id, nummer, art, latlng, marker, parcelId }
let obstbaumTreeCounter = 0;
let activeFruitKey = null;

// Flächen kommen jetzt aus dem geteilten Datenbestand (layers/featureIndex,
// siehe Viewer weiter oben) — dieselben Flächen, die im Viewer/Jahresvergleich/
// Flächenzeichner sichtbar sind, stehen hier automatisch zur Baum-Zuordnung
// bereit, ohne separat für das Obstbaumkataster hochgeladen werden zu müssen.

// Ordnet eine Koordinate der ersten geladenen Fläche zu, die sie enthält
// (null, falls keine Fläche geladen ist oder der Punkt außerhalb aller liegt).
function findObstbaumParcelForLatLng(latlng) {
  if (!featureIndex.length || typeof turf === 'undefined' || !turf.booleanPointInPolygon) return null;
  const pt = turf.point([latlng.lng, latlng.lat]);
  for (const entry of featureIndex) {
    const geomType = entry.leafletLayer.feature && entry.leafletLayer.feature.geometry && entry.leafletLayer.feature.geometry.type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') continue;
    try {
      if (turf.booleanPointInPolygon(pt, entry.leafletLayer.feature)) return entry;
    } catch (err) {}
  }
  return null;
}

function reassignAllTreesToParcels() {
  obstbaumTrees.forEach(t => { t.parcelId = findObstbaumParcelForLatLng(t.latlng)?.id || null; });
  renderObstbaumTable();
  renderFeatureTable();
}

// Baumanzahl je Obstart, gruppiert nach zugeordneter Fläche (Bäume ohne
// Fläche — parcelId null — tauchen hier nicht auf).
function computeObstbaumParcelTreeCounts() {
  const map = new Map();
  obstbaumTrees.forEach(t => {
    if (!t.parcelId) return;
    if (!map.has(t.parcelId)) map.set(t.parcelId, new Map());
    const counts = map.get(t.parcelId);
    counts.set(t.art, (counts.get(t.art) || 0) + 1);
  });
  return map;
}

// Wie computeObstbaumParcelTreeCounts(), aber mit den vollständigen
// Baum-Einträgen statt nur Zählungen — für den Flächenkarten-Export, der die
// Bäume je Fläche zusätzlich räumlich in Bild-Gruppen aufteilen muss.
function computeObstbaumParcelTreeLists() {
  const map = new Map();
  obstbaumTrees.forEach(t => {
    if (!t.parcelId) return;
    if (!map.has(t.parcelId)) map.set(t.parcelId, []);
    map.get(t.parcelId).push(t);
  });
  return map;
}

function setObstbaumStatus(msg) { document.getElementById('obstbaum-status').textContent = msg; }

function showObstbaumError(msg) {
  const el = document.getElementById('obstbaum-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showObstbaumError._t);
  showObstbaumError._t = setTimeout(() => el.style.display = 'none', 6000);
}

// Schwebender Hinweis auf der Karte, solange Bäume/Bienenstände gesetzt
// werden (am Desktop per CSS ausgeblendet — dort steht das in der Seitenleiste).
function updateMapPlaceChip() {
  const chip = document.getElementById('map-place-chip');
  const dot = document.getElementById('map-place-chip-dot');
  const text = document.getElementById('map-place-chip-text');
  const doneBtn = document.getElementById('map-place-chip-done');
  if (armedTool === 'place-tree' && activeFruitKey) {
    const fruit = fruitOf(activeFruitKey);
    dot.style.background = fruit.color;
    text.textContent = `${fruit.label} — auf die Karte tippen`;
    doneBtn.hidden = false;
    chip.hidden = false;
  } else if (armedTool === 'place-hive') {
    dot.style.background = '#E0A93B';
    text.textContent = 'Tippen setzt einen Bienenstand';
    doneBtn.hidden = true;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
}
document.getElementById('map-place-chip-done').addEventListener('click', () => {
  if (activeFruitKey) setActiveFruitKey(activeFruitKey); // erneuter Aufruf mit derselben Art = ausschalten
});

function setActiveFruitKey(key) {
  activeFruitKey = (activeFruitKey === key) ? null : key;
  // Am Handy liegt die Obstart-Auswahl in der Schublade über der Karte —
  // nach der Wahl direkt zur Karte, damit man gleich setzen kann.
  if (activeFruitKey) closeMobileSidebar();
  armedTool = activeFruitKey ? 'place-tree' : (armedTool === 'place-tree' ? null : armedTool);
  document.querySelectorAll('.fruit-btn, .fruit-list-row').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-key') === activeFruitKey);
  });
  document.getElementById('map').classList.toggle('placing', !!activeFruitKey);
  setObstbaumStatus(activeFruitKey
    ? `${fruitOf(activeFruitKey).label} aktiv — auf die Karte tippen/klicken, um Bäume zu setzen.`
    : 'Bereit.');
  updateMapPlaceChip();
}

// Baumpunkte als L.marker (mit farbigem DivIcon) statt L.circleMarker, weil
// nur "echte" Marker in Leaflet nativ per Drag verschiebbar sind
// (draggable: true) — bei einem Path wie circleMarker gäbe es das nicht ohne
// Zusatz-Plugin.
function createTreeIcon(color) {
  return L.divIcon({
    className: 'tree-marker-icon',
    html: `<span style="background:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function addTree(key, latlng) {
  const fruit = fruitOf(key);
  obstbaumTreeCounter++;
  const entry = {
    id: 'baum-' + obstbaumTreeCounter,
    nummer: obstbaumTreeCounter,
    art: key,
    latlng,
    marker: null,
    parcelId: findObstbaumParcelForLatLng(latlng)?.id || null,
    notes: '',
    photos: []
  };

  const marker = L.marker(latlng, { icon: createTreeIcon(fruit.color), draggable: true });
  marker.bindTooltip(fruit.label, { direction: 'top', offset: [0, -10] });
  marker.on('click', (e) => { L.DomEvent.stopPropagation(e); zoomToTree(entry.id); selectTreeInTable(entry.id); });
  // Rechtsklick auf einen Baum löscht ihn sofort — schnellste Korrektur bei
  // Fehlklicks beim Setzen, ohne erst die Baumtabelle öffnen zu müssen.
  marker.on('contextmenu', (e) => {
    L.DomEvent.stopPropagation(e);
    if (e.originalEvent) e.originalEvent.preventDefault();
    removeTree(entry.id);
  });
  marker.on('dragend', () => {
    entry.latlng = marker.getLatLng();
    entry.parcelId = findObstbaumParcelForLatLng(entry.latlng)?.id || null;
    renderObstbaumTable();
    renderFeatureTable();
  });
  marker.addTo(obstbaumLayerGroup);
  entry.marker = marker;

  obstbaumTrees.push(entry);
  renderObstbaumSummary();
  renderObstbaumTable();
  renderFeatureTable();
  setObstbaumStatus(`${fruit.label} gesetzt (${obstbaumTrees.length} insgesamt).`);
  return entry;
}

function removeTree(id) {
  const idx = obstbaumTrees.findIndex(t => t.id === id);
  if (idx === -1) return;
  const fruit = fruitOf(obstbaumTrees[idx].art);
  obstbaumLayerGroup.removeLayer(obstbaumTrees[idx].marker);
  obstbaumTrees.splice(idx, 1);
  renderObstbaumSummary();
  renderObstbaumTable();
  renderFeatureTable();
  setObstbaumStatus(`${fruit.label} entfernt (${obstbaumTrees.length} verbleibend).`);
}

function zoomToTree(id) {
  const t = obstbaumTrees.find(x => x.id === id);
  if (!t) return;
  map.setView(t.latlng, Math.max(map.getZoom(), 18));
}

// Zoomt auf alles, was für den Obstbaumkataster relevant ist — geladene
// Flächen UND gesetzte Bäume.
function fitObstbaumContent() {
  let bounds = null;
  Object.values(layers).forEach(l => {
    const b = l.leafletLayer.getBounds();
    if (b.isValid()) bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
  });
  obstbaumTrees.forEach(t => {
    bounds = bounds ? bounds.extend(t.latlng) : L.latLngBounds(t.latlng, t.latlng);
  });
  if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
}

function parcelLabelFor(parcelId) {
  if (!parcelId) return '–';
  const p = featureIndex.find(x => x.id === parcelId);
  return p ? escapeHtml(p.nummer || p.featName || '–') : '–';
}

function fruitChipHtml(key, extra) {
  const fruit = fruitOf(key);
  return `<span class="fruit-chip"><span class="fruit-dot" style="background:${fruit.color}"></span>${escapeHtml(fruit.label)}${extra || ''}</span>`;
}

function renderObstbaumSummary() {
  const el = document.getElementById('obstbaum-summary-row');
  document.getElementById('obstbaum-table-count').textContent = obstbaumTrees.length;
  const counts = new Map();
  obstbaumTrees.forEach(t => counts.set(t.art, (counts.get(t.art) || 0) + 1));
  if (!counts.size) {
    el.innerHTML = '<span style="color:var(--muted); font-size:11.5px;">Noch keine Bäume erfasst.</span>';
    return;
  }
  el.innerHTML = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => fruitChipHtml(key, ` <span class="n">${n}</span>`))
    .join('');
}

function renderObstbaumTable() {
  const tbody = document.getElementById('obstbaum-table-body');
  if (!obstbaumTrees.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted); padding:14px;">Noch keine Bäume erfasst.</td></tr>';
    return;
  }
  tbody.innerHTML = obstbaumTrees.map(t => {
    const hasNotes = t.notes || t.photos.length;
    return `<tr data-id="${t.id}">
      <td>${t.nummer}</td>
      <td>${fruitChipHtml(t.art)}</td>
      <td>${parcelLabelFor(t.parcelId)}</td>
      <td><button class="notes-btn${hasNotes ? ' has-notes' : ''}" data-id="${t.id}" data-action="notes" title="Notiz &amp; Fotos"><span class="material-symbols-rounded icon">sticky_note_2</span></button></td>
      <td><button data-id="${t.id}" data-action="remove" class="table-remove-btn">Entfernen</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="remove"]') || e.target.closest('[data-action="notes"]')) return;
      const id = tr.getAttribute('data-id');
      zoomToTree(id);
      highlightTreeRow(id);
    });
  });
  tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTree(btn.getAttribute('data-id'));
    });
  });
  tbody.querySelectorAll('[data-action="notes"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = obstbaumTrees.find(x => x.id === btn.getAttribute('data-id'));
      if (t) openNotesModal('tree', t);
    });
  });
}

function highlightTreeRow(id) {
  document.querySelectorAll('#obstbaum-table-body tr.row-selected').forEach(r => r.classList.remove('row-selected'));
  const row = document.querySelector('#obstbaum-table-body tr[data-id="' + id + '"]');
  if (row) row.classList.add('row-selected');
}

// Öffnet die Baumtabelle (schließt dafür die Flächentabelle, beide teilen
// sich denselben Bereich unter der Karte) und markiert die Zeile des per
// Klick auf der Karte ausgewählten Baums.
function selectTreeInTable(id) {
  document.getElementById('table-panel').classList.remove('open');
  obstbaumTablePanel.open();
  renderObstbaumTable();
  renderObstbaumSummary();
  highlightTreeRow(id);
  const row = document.querySelector('#obstbaum-table-body tr[data-id="' + id + '"]');
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function initObstbaumMap() {
  if (obstbaumInitDone) return;
  obstbaumInitDone = true;

  obstbaumLayerGroup = L.featureGroup().addTo(map);

  map.on('click', (e) => {
    if (armedTool !== 'place-tree' || !activeFruitKey) return;
    addTree(activeFruitKey, e.latlng);
  });

  obstbaumTablePanel = initResizablePanel({
    panel: document.getElementById('obstbaum-table-panel'),
    handle: document.getElementById('obstbaum-table-resize-handle'),
    minimizeBtn: document.getElementById('obstbaum-table-minimize'),
    closeBtn: document.getElementById('obstbaum-table-close'),
    boundsWrap: document.getElementById('map-wrap'),
    minHeight: TABLE_MIN_HEIGHT,
    defaultHeight: TABLE_DEFAULT_HEIGHT
  });
  document.getElementById('btn-obstbaum-table').addEventListener('click', () => {
    document.getElementById('table-panel').classList.remove('open');
    renderObstbaumTable();
    renderObstbaumSummary();
    obstbaumTablePanel.open();
  });

  // Flächentabelle ist jetzt dieselbe wie im Viewer (geteilter Datenbestand) —
  // Öffnen schließt lediglich die Baumtabelle, da beide denselben Bodenbereich
  // der Karte teilen.
  document.getElementById('btn-obstbaum-parcel-table').addEventListener('click', () => {
    document.getElementById('obstbaum-table-panel').classList.remove('open');
    openFeatureTable();
  });
}

// Flächen kommen jetzt ausschließlich aus dem geteilten Datenbestand
// (layers/featureIndex) — ein eigener Obstbaumkataster-Upload sowie eine
// separate Flächenliste/-tabelle entfallen dadurch vollständig, siehe
// findObstbaumParcelForLatLng() weiter oben und renderFeatureTable()/
// highlightFeature()/zoomToLayer()/removeLayer() im Viewer-Abschnitt.

// Obstart-Buttons (Favoriten) + "Sonstige"-Liste aufbauen — unabhängig vom
// (erst beim ersten Tab-Wechsel lazy initialisierten) Kartenobjekt.
// Welche Arten oben als Favoriten erscheinen, ist per Drag&Drop editierbar:
// eine Sonstige-Art auf einen Favoriten-Button ziehen tauscht die beiden,
// ein Favorit auf die Sonstige-Liste gezogen stuft ihn wieder zurück (die
// frei werdende Stelle im Raster wird automatisch mit der nächsten
// Sonstige-Art aufgefüllt, damit die Anzahl der Favoriten konstant bleibt).
function makeFruitDraggable(el, key) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', key);
    e.dataTransfer.effectAllowed = 'move';
  });
}

function promoteToFavorite(draggedKey, targetKey) {
  if (!draggedKey || draggedKey === targetKey || !FRUIT_BY_KEY[draggedKey]) return;
  const draggedIdx = favoriteFruitKeys.indexOf(draggedKey);
  const targetIdx = favoriteFruitKeys.indexOf(targetKey);
  if (targetIdx === -1) return;
  if (draggedIdx === -1) {
    favoriteFruitKeys[targetIdx] = draggedKey; // kam aus "Sonstige" -> ersetzt das Ziel
  } else {
    [favoriteFruitKeys[draggedIdx], favoriteFruitKeys[targetIdx]] = [favoriteFruitKeys[targetIdx], favoriteFruitKeys[draggedIdx]];
  }
  saveFavoriteFruits();
  renderFruitPicker();
}

function demoteFromFavorite(draggedKey) {
  const idx = favoriteFruitKeys.indexOf(draggedKey);
  if (idx === -1) return; // war schon nicht (mehr) Favorit
  const replacement = allFruitTypes().map(f => f.key).find(k => k !== draggedKey && !favoriteFruitKeys.includes(k));
  if (!replacement) return;
  favoriteFruitKeys[idx] = replacement;
  saveFavoriteFruits();
  renderFruitPicker();
}

function renderFruitPicker() {
  const grid = document.getElementById('obstbaum-fruit-grid');
  grid.innerHTML = '';
  favoriteFruitKeys.forEach(key => {
    const fruit = fruitOf(key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fruit-btn';
    btn.setAttribute('data-key', key);
    btn.innerHTML = `<span class="fruit-dot" style="background:${fruit.color}"></span><span class="fruit-label">${escapeHtml(fruit.label)}</span>`;
    btn.classList.toggle('active', key === activeFruitKey);
    btn.addEventListener('click', () => setActiveFruitKey(key));
    makeFruitDraggable(btn, key);
    btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('drag-over'); });
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      btn.classList.remove('drag-over');
      promoteToFavorite(e.dataTransfer.getData('text/plain'), key);
    });
    grid.appendChild(btn);
  });

  const list = document.getElementById('obstbaum-sonstige-list');
  list.innerHTML = '';
  allFruitTypes()
    .filter(f => !favoriteFruitKeys.includes(f.key))
    .forEach(fruit => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fruit-list-row';
      row.setAttribute('data-key', fruit.key);
      row.innerHTML = `<span class="fruit-dot" style="background:${fruit.color}"></span><span class="fruit-label">${escapeHtml(fruit.label)}</span>`;
      row.classList.toggle('active', fruit.key === activeFruitKey);
      row.addEventListener('click', () => setActiveFruitKey(fruit.key));
      makeFruitDraggable(row, fruit.key);
      list.appendChild(row);
    });

  const addRow = document.createElement('div');
  addRow.className = 'fruit-add-row';
  addRow.innerHTML = `<input type="text" id="obstbaum-custom-fruit-input" placeholder="Eigene Obstart…" maxlength="30">
    <button type="button" id="obstbaum-custom-fruit-add" title="Obstart hinzufügen">+</button>`;
  list.appendChild(addRow);
  const customInput = document.getElementById('obstbaum-custom-fruit-input');
  const customAddBtn = document.getElementById('obstbaum-custom-fruit-add');
  function submitCustomFruit() {
    const fruit = addCustomFruit(customInput.value);
    if (!fruit) { customInput.focus(); return; }
    customInput.value = '';
    renderFruitPicker();
    setObstbaumStatus(`„${fruit.label}" hinzugefügt.`);
  }
  customAddBtn.addEventListener('click', submitCustomFruit);
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitCustomFruit(); }
  });
  customInput.addEventListener('click', (e) => e.stopPropagation());
  customInput.addEventListener('dragover', (e) => e.stopPropagation());
}
renderFruitPicker();

const sonstigeList = document.getElementById('obstbaum-sonstige-list');
sonstigeList.addEventListener('dragover', (e) => { e.preventDefault(); sonstigeList.classList.add('drag-over'); });
sonstigeList.addEventListener('dragleave', () => sonstigeList.classList.remove('drag-over'));
sonstigeList.addEventListener('drop', (e) => {
  e.preventDefault();
  sonstigeList.classList.remove('drag-over');
  demoteFromFavorite(e.dataTransfer.getData('text/plain'));
});

const sonstigeToggle = document.getElementById('obstbaum-sonstige-toggle');
function closeSonstigeDropdown() {
  sonstigeList.hidden = true;
  sonstigeToggle.classList.remove('open');
}
sonstigeToggle.addEventListener('click', () => {
  const willOpen = sonstigeList.hidden;
  sonstigeList.hidden = !willOpen;
  sonstigeToggle.classList.toggle('open', willOpen);
});
// Capture-Phase nötig: das "+"-Formular in der Liste ruft bei Klick
// renderFruitPicker() auf, was die Liste neu aufbaut und e.target damit vom
// DOM löst — in der Bubble-Phase wäre sonstigeList.contains(e.target) dann
// fälschlich false und die Liste ginge sofort wieder zu.
document.addEventListener('click', (e) => {
  if (sonstigeList.hidden) return;
  if (sonstigeList.contains(e.target) || sonstigeToggle.contains(e.target)) return;
  closeSonstigeDropdown();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeFruitKey) setActiveFruitKey(null);
  if (e.key === 'Escape' && !sonstigeList.hidden) closeSonstigeDropdown();
  // Eigener Escape-Handler statt uns auf Leaflet.draws internes keyup auf dem
  // Karten-Container zu verlassen — das feuert nur, wenn der Container selbst
  // den Tastaturfokus hat, was nach einem Kartenklick nicht zuverlässig der
  // Fall ist.
  if (e.key === 'Escape' && armedTool === 'draw-polygon' && zeichnerDrawPolygon) zeichnerDrawPolygon.disable();
  if (e.key === 'Escape' && armedTool === 'split-line' && zeichnerDrawLine) zeichnerDrawLine.disable();
});

// ---------- Baumkataster laden/speichern (Format: GeoJSON) ----------
// Speichert/lädt als reguläres GeoJSON (Punkte + Obstart-Eigenschaft) —
// von Hand editierbares JSON (z.B. um Koordinaten oder Obstart nachträglich
// zu korrigieren) und gleichzeitig mit jedem Standard-GIS-Tool kompatibel.
async function loadBaumkatasterFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const features = data.features || [];
    const pointFeatures = features.filter(f => f.geometry && f.geometry.type === 'Point');
    const parcelFeatures = features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));

    // Enthält die Datei (z.B. aus "Kataster speichern" inkl. Flächen) auch
    // Flächen-Geometrien, diese zuerst laden — sonst müsste dieselbe Datei
    // zusätzlich noch einmal über "Flächen laden" hochgeladen werden. Vorher
    // laden ist wichtig, damit beim gleich folgenden Setzen der Baum-Punkte
    // direkt die richtige Flächen-Zuordnung berechnet werden kann.
    if (parcelFeatures.length) {
      addLayer(file.name.replace(/\.\w+$/, ''), { type: 'FeatureCollection', features: parcelFeatures });
    }

    let added = 0;
    pointFeatures.forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      if (!isFinite(lat) || !isFinite(lng)) return;
      const props = f.properties || {};
      let key = props.art || '';
      if (key && !FRUIT_BY_KEY[key]) {
        // Unbekannte Art (z.B. eigene Art aus einer anderen Installation) —
        // anhand des mitgespeicherten Klartext-Labels als eigene Art wiederherstellen.
        const restored = addCustomFruit(props.label || key);
        key = restored ? restored.key : key;
      }
      if (!key) key = 'unbekannt';
      addTree(key, L.latLng(lat, lng));
      added++;
    });
    document.getElementById('obstbaum-file-name').textContent = file.name;
    document.getElementById('obstbaum-drop').classList.add('filled');
    const parts = [];
    if (added) parts.push(`${added} Baum/Bäume`);
    if (parcelFeatures.length) parts.push(`${parcelFeatures.length} Fläche(n)`);
    setObstbaumStatus(`${parts.length ? parts.join(' + ') : 'Nichts Lesbares'} aus ${file.name} geladen.`);
    renderFruitPicker(); // ggf. wiederhergestellte eigene Arten in "Sonstige" sichtbar machen
    if (added || parcelFeatures.length) fitObstbaumContent();
  } catch (err) {
    console.error(err);
    showObstbaumError(file.name + ': Konnte Kataster nicht lesen — ' + (err.message || 'unbekannter Fehler'));
  }
}
document.getElementById('obstbaum-file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadBaumkatasterFile(e.target.files[0]);
});

// Property-Namen bewusst aus FIELD_CANDIDATES/GROESSE_CANDIDATES gewählt,
// damit eine mit Flächen exportierte Kataster-Datei sich direkt wieder als
// Fläche laden lässt (Viewer, Jahresvergleich, Obstbaumkataster, Zeichner).
function obstbaumParcelToGeoJSONFeature(p) {
  const num = parseFloat(String(p.groesse).replace(',', '.'));
  return {
    type: 'Feature',
    geometry: p.leafletLayer.feature.geometry,
    properties: {
      NUMMER: p.nummer,
      NAME: p.featName,
      KULTURART: p.kultur,
      FLAECHE_HA: isFinite(num) ? Number(num.toFixed(4)) : '',
      FLIK: p.flaechenId
    }
  };
}

function exportBaumkataster(includeParcels) {
  if (!obstbaumTrees.length) { showObstbaumError('Noch keine Bäume erfasst.'); return; }
  const treeFeatures = obstbaumTrees.map(t => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [t.latlng.lng, t.latlng.lat] },
    properties: { nummer: t.nummer, art: t.art, label: fruitOf(t.art).label }
  }));
  const parcelFeatures = includeParcels ? featureIndex.map(obstbaumParcelToGeoJSONFeature) : [];
  const fc = { type: 'FeatureCollection', features: [...parcelFeatures, ...treeFeatures] };
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(fc, null, 2), zuordnungFileName('Obstbaumkataster', 'geojson') || `baumkataster_${ts}.geojson`, 'application/geo+json');
  setObstbaumStatus(includeParcels ? 'Baumkataster inkl. Flächen gespeichert.' : 'Baumkataster gespeichert.');
}

// ---------- Export-Popup: Bäume optional zusammen mit Flächen exportieren ----------
function openObstbaumExportModal() {
  if (!obstbaumTrees.length) { showObstbaumError('Noch keine Bäume erfasst.'); return; }
  const hasParcels = featureIndex.length > 0;
  const checkbox = document.getElementById('obstbaum-export-include-parcels');
  checkbox.checked = hasParcels;
  checkbox.disabled = !hasParcels;
  document.getElementById('obstbaum-export-no-parcels-hint').hidden = hasParcels;
  document.getElementById('obstbaum-export-modal-overlay').hidden = false;
}
function closeObstbaumExportModal() {
  document.getElementById('obstbaum-export-modal-overlay').hidden = true;
}
document.getElementById('btn-export-baumkataster').addEventListener('click', openObstbaumExportModal);
document.getElementById('obstbaum-export-modal-cancel').addEventListener('click', closeObstbaumExportModal);
document.getElementById('obstbaum-export-modal-confirm').addEventListener('click', () => {
  const includeParcels = document.getElementById('obstbaum-export-include-parcels').checked;
  closeObstbaumExportModal();
  exportBaumkataster(includeParcels);
});
document.getElementById('obstbaum-export-modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'obstbaum-export-modal-overlay') closeObstbaumExportModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const modal = document.getElementById('obstbaum-export-modal-overlay');
  if (!modal.hidden) closeObstbaumExportModal();
});

// ---------- Flächenkarten exportieren (PDF mit Legende + Summen) ----------
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function treeDistanceMeters(a, b) {
  return turf.distance([a.latlng.lng, a.latlng.lat], [b.latlng.lng, b.latlng.lat], { units: 'meters' });
}

// Radius, innerhalb dessen Bäume noch auf ein gemeinsames, eng gezoomtes
// Bild passen sollen — kleiner als eine typische Flächenausdehnung, damit
// einzelne Bäume auf dem Kartenbild klar erkennbar bleiben statt als kleine
// Punkte in einer großen Übersichtsaufnahme zu verschwinden. Liegen Bäume
// derselben Fläche weiter auseinander, entstehen dafür automatisch mehrere
// Bilder (siehe addObstbaumParcelPages).
const TREE_VISIBILITY_RADIUS = 70;

// Gruppiert nahe beieinanderstehende Bäume (z.B. eine Streuobstwiese) auf
// eine gemeinsame Flächenkarten-Seite, statt stur eine Seite pro Baum zu
// erzeugen — sonst wären bei eng stehenden Bäumen unnötig viele, fast
// identische Seiten die Folge. Single-Linkage: ein Baum gehört zu einer
// Gruppe, sobald er innerhalb des Radius zu IRGENDEINEM Baum der Gruppe
// liegt — so bleiben auch länglich angeordnete Baumreihen zusammenhängend.
function clusterTrees(trees, radiusMeters) {
  const clusters = [];
  const visited = new Set();
  trees.forEach(t => {
    if (visited.has(t.id)) return;
    const cluster = [t];
    visited.add(t.id);
    let grew = true;
    while (grew) {
      grew = false;
      trees.forEach(other => {
        if (visited.has(other.id)) return;
        if (cluster.some(c => treeDistanceMeters(c, other) <= radiusMeters)) {
          cluster.push(other);
          visited.add(other.id);
          grew = true;
        }
      });
    }
    clusters.push(cluster);
  });
  return clusters;
}

// Schreibt Titel/Infozeile + Fruchtart-Legende + Kartenbild einer Fläche
// (mit ihren zugeordneten Bäumen) auf die aktuelle PDF-Seite. titleSuffix
// kennzeichnet bei einer auf mehrere Bilder aufgeteilten Fläche, das
// wievielte Bild das ist (z.B. " (Bild 2/3)").
function addObstbaumParcelPage(doc, pageW, pageH, margin, canvas, parcelEntry, counts, titleSuffix) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(String(parcelEntry.nummer || '–') + (parcelEntry.featName ? ' – ' + parcelEntry.featName : '') + (titleSuffix || ''), margin, margin + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const num = parseFloat(String(parcelEntry.groesse).replace(',', '.'));
  const groesseText = isFinite(num)
    ? num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha'
    : (parcelEntry.groesse || '–');
  const subtitleParts = ['Größe: ' + groesseText, 'Kulturart: ' + (parcelEntry.kultur || '–')];
  if (parcelEntry.flaechenId) subtitleParts.push('Flächen-ID: ' + parcelEntry.flaechenId);
  doc.text(subtitleParts.join('    ·    '), margin, margin + 11);

  doc.setFontSize(10);
  let legendX = margin;
  let legendY = margin + 18;
  [...counts.entries()].forEach(([key, n]) => {
    const fruit = fruitOf(key);
    const rgb = hexToRgb(fruit.color);
    const label = `${fruit.label}: ${n}`;
    if (legendX + doc.getTextWidth(label) + 6 > pageW - margin) { legendX = margin; legendY += 5.5; }
    doc.setFillColor(rgb.r, rgb.g, rgb.b);
    doc.circle(legendX + 1.3, legendY - 1.2, 1.3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.text(label, legendX + 4, legendY);
    legendX += doc.getTextWidth(label) + 10;
  });

  const imageTop = legendY + 6;
  const maxW = pageW - margin * 2;
  const maxH = pageH - imageTop - margin;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
  const imgW = canvas.width * scale;
  const imgH = canvas.height * scale;
  const imgX = (pageW - imgW) / 2;
  doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', imgX, imageTop, imgW, imgH);
}

// Nimmt einen Screenshot der Karte auf, gezoomt auf eine Gruppe von
// Baumpunkten (statt auf die ganze Fläche) — damit einzelne Bäume auf dem
// Bild klar erkennbar bleiben. Die Fläche selbst wird trotzdem als weißer
// Umriss eingeblendet (sofern sie im Ausschnitt sichtbar ist), damit der
// räumliche Bezug erhalten bleibt.
async function captureTreeClusterScreenshot(targetMap, satelliteLayer, mapElId, feature, treeLatLngs) {
  const highlightLayer = feature ? L.geoJSON(feature, {
    renderer: L.canvas(),
    style: { color: '#ffffff', weight: 3, opacity: 1, fillOpacity: 0 }
  }).addTo(targetMap) : null;
  try {
    if (treeLatLngs.length === 1) {
      targetMap.setView(treeLatLngs[0], 20);
    } else {
      targetMap.fitBounds(L.latLngBounds(treeLatLngs), { padding: [70, 70], maxZoom: 20 });
    }
    await waitForTilesFullyLoaded(satelliteLayer, mapElId, 6000);
    return await html2canvas(document.getElementById(mapElId), { useCORS: true, logging: false });
  } finally {
    if (highlightLayer) targetMap.removeLayer(highlightLayer);
  }
}

// Ein oder mehrere PDF-Seiten je Fläche mit zugeordneten Bäumen — liegen die
// Bäume einer Fläche weiter auseinander, als auf ein eng gezoomtes Bild
// passt, wird die Fläche auf mehrere Bilder aufgeteilt (siehe
// TREE_VISIBILITY_RADIUS), jedes davon mit eigener Legende für die darauf
// sichtbaren Bäume. Die Baumpunkte selbst sind normale DOM-Elemente
// (divIcon) und erscheinen daher automatisch mit im Screenshot.
async function addObstbaumParcelPages(doc, parcelsWithTrees, treeLists, pageW, pageH, margin, pageIdx, grandTotal) {
  for (let i = 0; i < parcelsWithTrees.length; i++) {
    const parcelEntry = parcelsWithTrees[i];
    const trees = treeLists.get(parcelEntry.id);
    const subClusters = clusterTrees(trees, TREE_VISIBILITY_RADIUS);

    // Wird eine Fläche auf mehrere Bilder aufgeteilt (Bäume liegen weiter
    // auseinander, als auf ein eng gezoomtes Bild passt), zusätzlich eine
    // Übersichtsseite mit der ganzen Fläche voranstellen — sonst ist beim
    // Durchblättern nicht erkennbar, wo die einzelnen Ausschnitte overall
    // liegen. Bei nur einem Bild wäre die Übersicht identisch zum Einzelbild
    // und entfällt daher.
    if (subClusters.length > 1) {
      setObstbaumStatus(`Exportiere Flächenkarten … (${i + 1}/${parcelsWithTrees.length}, Übersicht)`);
      let overviewCanvas;
      try {
        overviewCanvas = await captureParcelScreenshot(map, basemaps.satellite, 'map', parcelEntry.leafletLayer.feature);
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für', parcelEntry.nummer, err);
        showObstbaumError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        return pageIdx;
      }
      if (pageIdx > 0) doc.addPage('a4', 'landscape');
      pageIdx++;
      // Fließt bewusst NICHT in grandTotal ein — die Einzelbild-Seiten unten
      // zählen alle Bäume dieser Fläche bereits vollständig, sonst würde
      // jeder Baum doppelt in der Gesamtsumme landen.
      const overviewCounts = new Map();
      trees.forEach(t => overviewCounts.set(t.art, (overviewCounts.get(t.art) || 0) + 1));
      addObstbaumParcelPage(doc, pageW, pageH, margin, overviewCanvas, parcelEntry, overviewCounts, ' (Übersicht)');
    }

    for (let j = 0; j < subClusters.length; j++) {
      const subCluster = subClusters[j];
      const progress = subClusters.length > 1 ? `, Bild ${j + 1}/${subClusters.length}` : '';
      setObstbaumStatus(`Exportiere Flächenkarten … (${i + 1}/${parcelsWithTrees.length}${progress})`);

      let canvas;
      try {
        canvas = await captureTreeClusterScreenshot(
          map, basemaps.satellite, 'map',
          parcelEntry.leafletLayer.feature, subCluster.map(t => t.latlng)
        );
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für', parcelEntry.nummer, err);
        showObstbaumError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        return pageIdx;
      }
      if (pageIdx > 0) doc.addPage('a4', 'landscape');
      pageIdx++;

      const counts = new Map();
      subCluster.forEach(t => counts.set(t.art, (counts.get(t.art) || 0) + 1));
      counts.forEach((n, key) => grandTotal.set(key, (grandTotal.get(key) || 0) + n));

      const titleSuffix = subClusters.length > 1 ? ` (Bild ${j + 1}/${subClusters.length})` : '';
      addObstbaumParcelPage(doc, pageW, pageH, margin, canvas, parcelEntry, counts, titleSuffix);
    }
  }
  return pageIdx;
}

// Eine PDF-Seite je geografischer Baumgruppe (Single-Linkage-Cluster) — für
// Bäume ohne zugeordnete Fläche bzw. wenn gar keine Flächen geladen sind.
async function addObstbaumClusterPages(doc, clusters, pageW, pageH, margin, pageIdx, grandTotal, titlePrefix) {
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    setObstbaumStatus(`Exportiere Flächenkarten${titlePrefix ? ' (' + titlePrefix + ')' : ''} … (${i + 1}/${clusters.length})`);

    if (cluster.length === 1) {
      map.setView(cluster[0].latlng, 20);
    } else {
      map.fitBounds(L.latLngBounds(cluster.map(t => t.latlng)), { padding: [70, 70], maxZoom: 20 });
    }
    await waitForTilesFullyLoaded(basemaps.satellite, 'map', 6000);

    let canvas;
    try {
      canvas = await html2canvas(document.getElementById('map'), { useCORS: true, logging: false });
    } catch (err) {
      console.error('Kartenbild-Erfassung fehlgeschlagen für Gruppe', i + 1, err);
      showObstbaumError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
      return pageIdx;
    }

    if (pageIdx > 0) doc.addPage('a4', 'landscape');
    pageIdx++;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    const title = (titlePrefix ? titlePrefix + ' – ' : '') + `Gruppe ${i + 1} (${cluster.length} Baum/Bäume)`;
    doc.text(title, margin, margin + 4);

    // Zählung je Obstart auf dieser Seite — der Farbpunkt davor dient
    // zugleich als Legende (Farbe -> Obstart), extra Legendenblock nicht nötig.
    const pageCounts = new Map();
    cluster.forEach(t => pageCounts.set(t.art, (pageCounts.get(t.art) || 0) + 1));
    pageCounts.forEach((n, key) => grandTotal.set(key, (grandTotal.get(key) || 0) + n));

    doc.setFontSize(10);
    let legendX = margin;
    let legendY = margin + 11;
    [...pageCounts.entries()].forEach(([key, n]) => {
      const fruit = fruitOf(key);
      const rgb = hexToRgb(fruit.color);
      const label = `${fruit.label}: ${n}`;
      if (legendX + doc.getTextWidth(label) + 6 > pageW - margin) { legendX = margin; legendY += 5.5; }
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.circle(legendX + 1.3, legendY - 1.2, 1.3, 'F');
      doc.setFont('helvetica', 'normal');
      doc.text(label, legendX + 4, legendY);
      legendX += doc.getTextWidth(label) + 10;
    });

    const imageTop = legendY + 6;
    const maxW = pageW - margin * 2;
    const maxH = pageH - imageTop - margin;
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
    const imgW = canvas.width * scale;
    const imgH = canvas.height * scale;
    const imgX = (pageW - imgW) / 2;
    doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', imgX, imageTop, imgW, imgH);
  }
  return pageIdx;
}

async function exportObstbaumFlaechenkarten() {
  if (typeof html2canvas === 'undefined') { showObstbaumError('Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showObstbaumError('Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!obstbaumTrees.length) { showObstbaumError('Noch keine Bäume erfasst.'); return; }

  const btn = document.getElementById('btn-export-obstbaum-flaechenkarten');
  btn.disabled = true;

  const savedCenter = map.getCenter();
  const savedZoom = map.getZoom();
  const savedBasemap = currentBasemap;

  if (currentBasemap !== 'satellite') setBasemap('satellite');
  map.removeControl(map.zoomControl);

  const grandTotal = new Map();

  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  try {
    let pageIdx = 0;
    if (featureIndex.length) {
      // Flächen geladen: ein oder mehrere eng gezoomte Bilder je Fläche mit
      // zugeordneten Bäumen, Bäume ohne Fläche fallen weiterhin unter die
      // geografische Gruppierung.
      const treeLists = computeObstbaumParcelTreeLists();
      const parcelsWithTrees = featureIndex
        .filter(p => treeLists.has(p.id))
        .sort((a, b) => String(a.nummer).localeCompare(String(b.nummer), undefined, { numeric: true }));
      pageIdx = await addObstbaumParcelPages(doc, parcelsWithTrees, treeLists, pageW, pageH, margin, pageIdx, grandTotal);

      const unassigned = obstbaumTrees.filter(t => !t.parcelId);
      if (unassigned.length) {
        const clusters = clusterTrees(unassigned, TREE_VISIBILITY_RADIUS);
        pageIdx = await addObstbaumClusterPages(doc, clusters, pageW, pageH, margin, pageIdx, grandTotal, 'Nicht zugeordnet');
      }
    } else {
      const clusters = clusterTrees(obstbaumTrees, TREE_VISIBILITY_RADIUS);
      pageIdx = await addObstbaumClusterPages(doc, clusters, pageW, pageH, margin, pageIdx, grandTotal, '');
    }

    // Abschlussseite: Gesamtsumme je Obstart über alle Gruppen hinweg.
    doc.addPage('a4', 'landscape');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Gesamtübersicht', margin, margin + 6);

    let y = margin + 20;
    let total = 0;
    [...grandTotal.entries()].sort((a, b) => b[1] - a[1]).forEach(([key, n]) => {
      const fruit = fruitOf(key);
      const rgb = hexToRgb(fruit.color);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.rect(margin, y - 3.2, 4, 4, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11.5);
      doc.text(`${fruit.label}: ${n}`, margin + 8, y);
      total += n;
      y += 7.5;
    });
    doc.setFont('helvetica', 'bold');
    doc.text(`Gesamt: ${total} Bäume`, margin, y + 5);

    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    const ts = new Date().toISOString().slice(0, 10);
    doc.save(zuordnungFileName('Flächenkarte Obstbaum', 'pdf') || `obstbaumkataster_flaechenkarten_${ts}.pdf`);
    setObstbaumStatus('Flächenkarten exportiert.');
  } finally {
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    map.setView(savedCenter, savedZoom);
    btn.disabled = false;
  }
}

document.getElementById('btn-export-obstbaum-flaechenkarten').addEventListener('click', exportObstbaumFlaechenkarten);

// ---------- Bienenflugkarte ----------
// Eigener Tab: Bienenstöcke als Punkte markieren, jeweils mit dem
// theoretischen Flugradius (3 km, Standardannahme für Honigbienen) als
// Kreis um den Punkt. Bewusst simpel gehalten — anders als im
// Obstbaumkataster gibt es nur EINE Punktart, daher kein Art-Picker: jeder
// Kartenklick setzt direkt einen neuen Bienenstock.
const BIENENFLUG_RADIUS_METERS = 3000;

let bienenflugInitDone = false;
let bienenflugLayerGroup = null;
const bienenflugPoints = []; // { id, nummer, latlng, marker, circle }
let bienenflugCounter = 0;
let bienenflugHighlighted = null;

function setBienenflugStatus(msg) { document.getElementById('bienenflug-status').textContent = msg; }

function showBienenflugError(msg) {
  const el = document.getElementById('bienenflug-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showBienenflugError._t);
  showBienenflugError._t = setTimeout(() => el.style.display = 'none', 6000);
}

function createBeehiveIcon() {
  return L.divIcon({
    className: 'beehive-marker-icon',
    html: `<svg viewBox="0 0 24 24" width="26" height="26">
      <path d="M12 2C7.5 2 5.5 6 5.5 10L5.5 20C5.5 21.1 6.2 22 7.5 22L16.5 22C17.8 22 18.5 21.1 18.5 20L18.5 10C18.5 6 16.5 2 12 2Z" fill="#D9A544" stroke="#8A6238" stroke-width="1.2"/>
      <path d="M5.6 8L18.4 8" stroke="#8A6238" stroke-width="1"/>
      <path d="M5.3 12.5L18.7 12.5" stroke="#8A6238" stroke-width="1"/>
      <path d="M5.5 17L18.5 17" stroke="#8A6238" stroke-width="1"/>
      <circle cx="12" cy="19.5" r="1.7" fill="#3C2A18"/>
    </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 23]
  });
}

function highlightBeehive(entry) {
  if (bienenflugHighlighted && bienenflugHighlighted.circle) {
    bienenflugHighlighted.circle.setStyle({ color: '#D9A544', weight: 2 });
  }
  entry.circle.setStyle({ color: '#ffffff', weight: 3 });
  bienenflugHighlighted = entry;
}

// Zeigt den frei vergebenen Namen an, falls gesetzt, sonst die fortlaufende
// Nummer als Standardbezeichnung ("Bienenstock 3").
function beehiveLabel(entry) {
  return entry.name ? entry.name : `Bienenstock ${entry.nummer}`;
}

function addBeehive(latlng) {
  bienenflugCounter++;
  const entry = { id: 'bienenstock-' + bienenflugCounter, nummer: bienenflugCounter, name: '', latlng, marker: null, circle: null };

  // Canvas-Renderer statt SVG (Standard), damit der Kreis beim Flächenkarten-
  // Export exakt lagerichtig im Screenshot landet (siehe captureParcelScreenshot
  // weiter oben für den Hintergrund dieser html2canvas-Eigenheit).
  const circle = L.circle(latlng, {
    renderer: L.canvas(),
    radius: BIENENFLUG_RADIUS_METERS,
    color: '#D9A544', weight: 2, fillColor: '#D9A544', fillOpacity: 0.12
  }).addTo(bienenflugLayerGroup);

  const marker = L.marker(latlng, { icon: createBeehiveIcon(), draggable: true });
  marker.bindTooltip(beehiveLabel(entry), { direction: 'top', offset: [0, -20] });
  marker.on('click', (e) => { L.DomEvent.stopPropagation(e); zoomToBeehive(entry.id); });
  marker.on('drag', () => circle.setLatLng(marker.getLatLng()));
  marker.on('dragend', () => { entry.latlng = marker.getLatLng(); });
  marker.addTo(bienenflugLayerGroup);

  entry.marker = marker;
  entry.circle = circle;
  bienenflugPoints.push(entry);
  renderBienenflugList();
  setBienenflugStatus(`Bienenstock ${entry.nummer} gesetzt (${bienenflugPoints.length} insgesamt).`);
  return entry;
}

function removeBeehive(id) {
  const idx = bienenflugPoints.findIndex(e => e.id === id);
  if (idx === -1) return;
  const entry = bienenflugPoints[idx];
  bienenflugLayerGroup.removeLayer(entry.marker);
  bienenflugLayerGroup.removeLayer(entry.circle);
  if (bienenflugHighlighted === entry) bienenflugHighlighted = null;
  bienenflugPoints.splice(idx, 1);
  renderBienenflugList();
}

function zoomToBeehive(id) {
  const entry = bienenflugPoints.find(e => e.id === id);
  if (!entry) return;
  highlightBeehive(entry);
  map.fitBounds(entry.circle.getBounds(), { padding: [30, 30] });
}

function renderBienenflugList() {
  const list = document.getElementById('bienenflug-list');
  document.getElementById('bienenflug-empty-hint').style.display = bienenflugPoints.length ? 'none' : 'block';
  list.innerHTML = '';
  bienenflugPoints.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.innerHTML = `
      <div class="layer-row">
        <div class="swatch" style="background:#D9A544"></div>
        <input class="parcel-name" data-id="${entry.id}" placeholder="Bienenstock ${entry.nummer}" value="${escapeHtml(entry.name)}">
      </div>
      <div class="layer-actions">
        <button data-id="${entry.id}" data-action="zoom">Zoom</button>
        <button data-id="${entry.id}" data-action="remove" class="danger">Entfernen</button>
      </div>
    `;
    list.appendChild(item);
  });
  list.querySelectorAll('.parcel-name').forEach(input => {
    input.addEventListener('input', () => {
      const entry = bienenflugPoints.find(e => e.id === input.getAttribute('data-id'));
      if (!entry) return;
      entry.name = input.value;
      entry.marker.setTooltipContent(beehiveLabel(entry));
    });
  });
  list.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const action = el.getAttribute('data-action');
      if (action === 'zoom') zoomToBeehive(id);
      if (action === 'remove') removeBeehive(id);
    });
  });
}

function initBienenflugMap() {
  if (bienenflugInitDone) return;
  bienenflugInitDone = true;
  bienenflugLayerGroup = L.featureGroup().addTo(map);

  map.on('click', (e) => {
    if (armedTool === 'place-hive') addBeehive(e.latlng);
  });
}

async function captureBeehiveScreenshot(entry) {
  map.fitBounds(entry.circle.getBounds(), { padding: [40, 40], maxZoom: 16 });
  await waitForTilesFullyLoaded(basemaps.satellite, 'map', 6000);
  return await html2canvas(document.getElementById('map'), { useCORS: true, logging: false });
}

function addBienenflugPage(doc, pageW, pageH, margin, canvas, entry) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  const title = entry.name ? `${entry.name} (Bienenstock ${entry.nummer})` : `Bienenstock ${entry.nummer}`;
  doc.text(title, margin, margin + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const coordText = entry.latlng.lat.toFixed(5) + ', ' + entry.latlng.lng.toFixed(5);
  doc.text(`Koordinaten: ${coordText}    ·    Theoretischer Flugradius: 3 km`, margin, margin + 11);

  const imageTop = margin + 18;
  const maxW = pageW - margin * 2;
  const maxH = pageH - imageTop - margin;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
  const imgW = canvas.width * scale;
  const imgH = canvas.height * scale;
  const imgX = (pageW - imgW) / 2;
  doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', imgX, imageTop, imgW, imgH);
}

async function exportBienenflugFlaechenkarten() {
  if (typeof html2canvas === 'undefined') { showBienenflugError('Flächenkarten-Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showBienenflugError('Flächenkarten-Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!bienenflugPoints.length) { showBienenflugError('Noch kein Bienenstock gesetzt.'); return; }

  const btn = document.getElementById('btn-export-bienenflug-flaechenkarten');
  btn.disabled = true;

  const savedCenter = map.getCenter();
  const savedZoom = map.getZoom();
  const savedBasemap = currentBasemap;

  if (currentBasemap !== 'satellite') setBasemap('satellite');
  map.removeControl(map.zoomControl);

  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  try {
    for (let i = 0; i < bienenflugPoints.length; i++) {
      const entry = bienenflugPoints[i];
      setBienenflugStatus(`Exportiere Flächenkarten … (${i + 1}/${bienenflugPoints.length})`);

      let canvas;
      try {
        canvas = await captureBeehiveScreenshot(entry);
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für Bienenstock', entry.nummer, err);
        showBienenflugError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        break;
      }

      if (i > 0) doc.addPage('a4', 'landscape');
      addBienenflugPage(doc, pageW, pageH, margin, canvas, entry);
    }

    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    const ts = new Date().toISOString().slice(0, 10);
    doc.save(zuordnungFileName('Flächenkarte Bienenflug', 'pdf') || `bienenflugkarten_${ts}.pdf`);
    setBienenflugStatus('Flächenkarten exportiert.');
  } finally {
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    map.setView(savedCenter, savedZoom);
    btn.disabled = false;
  }
}

document.getElementById('btn-export-bienenflug-flaechenkarten').addEventListener('click', exportBienenflugFlaechenkarten);

// ---------- Hofplan ----------
// Freies Zeichentool für Hof-/Gebäudepläne auf der Satellitenkarte: Gebäude
// (Wohnhaus, Maschinenhalle, Stall, …) als Rechteck oder Freiform-Polygon
// direkt einzeichnen, Kategorie/Name per Dropdown bzw. Textfeld zuweisen.
// Eigener, unabhängiger Datenbestand (hofplanShapes) auf einer eigenen
// Kartenebene — bewusst NICHT über layers/featureIndex registriert wie
// Flächenzeichner-Parzellen, da Gebäude-Metadaten (Typ/Name) nicht in die
// Flächentabelle gehören. Architektur mischt zwei bestehende Muster: die
// Zeichnen/Bearbeiten/Löschen/Undo-Werkzeugleiste des Flächenzeichners und
// die eigene, lazy initialisierte Kartenebene + Kategorie-Katalog des
// Obstbaumkatasters.
const GEBAEUDE_KATALOG = [
  { kategorie: 'Wohnhaus', farbe: '#B5533C' },
  { kategorie: 'Hofgebäude/Betriebsgebäude', farbe: '#8C7A5E' },
  { kategorie: 'Maschinenhalle', farbe: '#4A6FA5' },
  { kategorie: 'Stall', farbe: '#6E5B3E' },
  { kategorie: 'Lagerhalle/Scheune', farbe: '#A68A3C' },
  { kategorie: 'Fahrsilo/Güllebehälter', farbe: '#5C7A7A' },
  { kategorie: 'Sonstiges', farbe: '#7D7D7D' }
];
const HOFPLAN_DEFAULT_COLOR = '#7D7D7D';

function gebaeudeColor(kategorie) {
  const gruppe = GEBAEUDE_KATALOG.find(g => g.kategorie === kategorie);
  return gruppe ? gruppe.farbe : HOFPLAN_DEFAULT_COLOR;
}

// Frei wählbare Farbe hat Vorrang vor der Kategorie-Standardfarbe — so lässt
// sich z.B. ein zweiter Stall optisch von einem ersten unterscheiden, ohne
// dafür eine eigene Kategorie anlegen zu müssen.
function hofplanEffectiveColor(shape) {
  return shape.color || gebaeudeColor(shape.kategorie);
}

let hofplanInitDone = false;
let hofplanLayerGroup = null;
let hofplanDrawRect = null;
let hofplanDrawPoly = null;
const hofplanShapes = []; // { id, kategorie, name, color, leafletLayer, labelAnchor, areaQm }
let hofplanToolMode = null; // null | 'edit' | 'delete'
let hofplanEditingId = null;
let hofplanEditBeforeGeometry = null;
let hofplanGeometryCommitTimer = null;
const hofplanUndoStack = [];
const hofplanRedoStack = [];
const HOFPLAN_UNDO_MAX = 20;

function setHofplanStatus(msg) { document.getElementById('hofplan-status').textContent = msg; }

function showHofplanError(msg) {
  const el = document.getElementById('hofplan-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showHofplanError._t);
  showHofplanError._t = setTimeout(() => el.style.display = 'none', 6000);
}

function hofplanLabelText(shape) {
  const typ = shape.kategorie || 'Gebäude';
  return shape.name ? `${escapeHtml(typ)}<br>${escapeHtml(shape.name)}` : escapeHtml(typ);
}

function updateHofplanShapeStyle(shape) {
  const color = hofplanEffectiveColor(shape);
  if (shape.leafletLayer.setStyle) shape.leafletLayer.setStyle({ color, fillColor: color });
  if (shape.labelAnchor && shape.labelAnchor.setTooltipContent) {
    shape.labelAnchor.setTooltipContent(hofplanLabelText(shape));
  }
}

function computeHofplanArea(shape) {
  try { return turf.area(shape.leafletLayer.toGeoJSON()); } catch (err) { return 0; }
}

// Erzeugt einen Gebäude-Eintrag aus einem bereits vorhandenen Leaflet-Layer
// (frisch gezeichnet, aus einem Rückgängig-Schritt rekonstruiert oder beim
// Laden des Workspace wiederhergestellt) — verdrahtet Klick-Routing
// (Bearbeiten/Löschen je nach hofplanToolMode) und das dauerhafte Label,
// löst aber selbst KEINEN Rückgängig-Eintrag aus (das macht der jeweilige
// Aufrufer gezielt, siehe CREATED-Handler weiter unten).
function addHofplanShapeFromLayer(layer, kategorie, name, idOverride, colorOverride, stallplanIdOverride) {
  const shape = {
    id: idOverride || 'gebaeude-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    kategorie: kategorie || '',
    name: name || '',
    color: colorOverride || null,
    // Verknüpfung mit einem Stallplan (siehe Stallplan-Aktionen weiter
    // unten in renderHofplanList()) — nur bei kategorie==='Stall' über die
    // UI gesetzt/genutzt, bleibt bei anderen Gebäudetypen ungenutzt null.
    stallplanId: stallplanIdOverride || null,
    leafletLayer: layer,
    labelAnchor: null,
    areaQm: 0
  };
  const color = hofplanEffectiveColor(shape);
  layer.setStyle({ color, weight: 2, fillColor: color, fillOpacity: 0.32 });
  layer.addTo(hofplanLayerGroup);
  layer.on('click', () => {
    if (hofplanToolMode === 'edit') { toggleHofplanEdit(shape); return; }
    if (hofplanToolMode === 'delete') { deleteHofplanShape(shape); return; }
    // Kein Hofplan-Werkzeug scharf (z.B. Klick von einem ganz anderen Tab
    // aus, Hofplan-Gebäude bleiben nach dem ersten Öffnen überall auf der
    // Karte sichtbar) — direkt in den Hofplaner wechseln und dorthin zoomen,
    // statt dass der Klick ins Leere geht.
    setActiveSegment('hofplan');
    zoomToHofplanShape(shape.id);
  });
  layer.on('edit', () => syncHofplanGeometryLive(shape));
  shape.areaQm = computeHofplanArea(shape);
  const center = layer.getBounds().getCenter();
  shape.labelAnchor = createLabelAnchorAt(center, hofplanLabelText(shape));
  shape.labelAnchor.addTo(hofplanLayerGroup);
  hofplanShapes.push(shape);
  return shape;
}

function removeHofplanShapeEverywhere(shape) {
  if (hofplanEditingId === shape.id) { hofplanEditingId = null; hofplanEditBeforeGeometry = null; }
  const idx = hofplanShapes.findIndex(x => x.id === shape.id);
  if (idx !== -1) hofplanShapes.splice(idx, 1);
  hofplanLayerGroup.removeLayer(shape.leafletLayer);
  if (shape.labelAnchor) hofplanLayerGroup.removeLayer(shape.labelAnchor);
  renderHofplanList();
}

function restoreHofplanShapeFromFeature(feature, kategorie, name, idOverride, color, stallplanId) {
  const layer = L.geoJSON(feature).getLayers()[0];
  const shape = addHofplanShapeFromLayer(layer, kategorie, name, idOverride, color, stallplanId);
  renderHofplanList();
  return shape;
}

// ---------- Rückgängig (Hofplan) ----------
// Eigener, kleiner Verlaufsspeicher statt Wiederverwendung des Flächenzeichner-
// Stacks — Gebäude sind ein eigenständiger Datenbestand (siehe oben), analog
// zur bereits bestehenden Trennung von clearAllLayers/clearAllTrees/
// clearAllBeehives je Feature-Typ.
function pushHofplanUndo(action) {
  hofplanUndoStack.push(action);
  if (hofplanUndoStack.length > HOFPLAN_UNDO_MAX) hofplanUndoStack.shift();
  // Neue Aktion verwirft die Redo-Historie — siehe pushHofplanUndoKeepRedo(),
  // das redoLastHofplanAction() selbst nutzt, um die wiederhergestellte
  // Aktion erneut auf den Undo-Stack zu legen, ohne den Rest der Redo-
  // Historie zu verwerfen.
  hofplanRedoStack.length = 0;
  updateHofplanToolbar();
}

function pushHofplanUndoKeepRedo(action) {
  hofplanUndoStack.push(action);
  if (hofplanUndoStack.length > HOFPLAN_UNDO_MAX) hofplanUndoStack.shift();
  updateHofplanToolbar();
}

function undoLastHofplanAction() {
  const action = hofplanUndoStack.pop();
  if (!action) return;
  let redoAction = null;
  if (action.type === 'add') {
    const shape = hofplanShapes.find(s => s.id === action.shapeId);
    if (shape) {
      redoAction = {
        type: 'add',
        kategorie: shape.kategorie,
        name: shape.name,
        color: shape.color,
        stallplanId: shape.stallplanId,
        feature: cloneFeature(shape.leafletLayer.toGeoJSON())
      };
      removeHofplanShapeEverywhere(shape);
    }
    setHofplanStatus('Zeichnen rückgängig gemacht.');
  } else if (action.type === 'delete') {
    const shape = restoreHofplanShapeFromFeature(action.feature, action.kategorie, action.name, undefined, action.color, action.stallplanId);
    redoAction = { type: 'delete', shapeId: shape.id };
    setHofplanStatus('Löschen rückgängig gemacht.');
  } else if (action.type === 'edit') {
    const shape = hofplanShapes.find(s => s.id === action.shapeId);
    if (shape) {
      const currentGeometry = cloneFeature(shape.leafletLayer.toGeoJSON()).geometry;
      applyGeometryToHofplanShape(shape, action.beforeGeometry);
      renderHofplanList();
      redoAction = { type: 'edit', shapeId: shape.id, geometry: currentGeometry };
    }
    setHofplanStatus('Bearbeitung rückgängig gemacht.');
  }
  if (redoAction) hofplanRedoStack.push(redoAction);
  updateHofplanToolbar();
}

function redoLastHofplanAction() {
  const action = hofplanRedoStack.pop();
  if (!action) return;
  if (action.type === 'add') {
    const layer = L.geoJSON(action.feature).getLayers()[0];
    const shape = addHofplanShapeFromLayer(layer, action.kategorie, action.name, undefined, action.color, action.stallplanId);
    renderHofplanList();
    pushHofplanUndoKeepRedo({ type: 'add', shapeId: shape.id });
    setHofplanStatus('Zeichnen wiederhergestellt.');
  } else if (action.type === 'delete') {
    const shape = hofplanShapes.find(s => s.id === action.shapeId);
    if (shape) {
      pushHofplanUndoKeepRedo({
        type: 'delete',
        kategorie: shape.kategorie,
        name: shape.name,
        color: shape.color,
        stallplanId: shape.stallplanId,
        feature: cloneFeature(shape.leafletLayer.toGeoJSON())
      });
      removeHofplanShapeEverywhere(shape);
    }
    setHofplanStatus('Löschen wiederhergestellt.');
  } else if (action.type === 'edit') {
    const shape = hofplanShapes.find(s => s.id === action.shapeId);
    if (shape) {
      const beforeGeometry = cloneFeature(shape.leafletLayer.toGeoJSON()).geometry;
      applyGeometryToHofplanShape(shape, action.geometry);
      renderHofplanList();
      pushHofplanUndoKeepRedo({ type: 'edit', shapeId: shape.id, beforeGeometry });
    }
    setHofplanStatus('Bearbeitung wiederhergestellt.');
  }
  updateHofplanToolbar();
}

function deleteHofplanShape(shape) {
  const label = shape.name || shape.kategorie;
  pushHofplanUndo({
    type: 'delete',
    kategorie: shape.kategorie,
    name: shape.name,
    color: shape.color,
    stallplanId: shape.stallplanId,
    feature: cloneFeature(shape.leafletLayer.toGeoJSON())
  });
  removeHofplanShapeEverywhere(shape);
  setHofplanStatus(label ? `Gebäude „${label}" gelöscht.` : 'Gebäude gelöscht.');
  updateHofplanToolbar();
}

// ---------- Eckpunkte eines Gebäudes per Ziehen anpassen ----------
// Nutzt dasselbe L.Edit.Poly/L.Edit.Rectangle aus Leaflet.draw wie der
// Flächenzeichner (steckt automatisch in jedem per L.Draw oder L.GeoJSON
// erzeugten Polygon/Rechteck) — nur enable()/disable() nötig.
function disableHofplanEditing() {
  if (!hofplanEditingId) return;
  const shape = hofplanShapes.find(s => s.id === hofplanEditingId);
  if (shape && shape.leafletLayer.editing) {
    shape.leafletLayer.editing.disable();
    const afterGeometry = shape.leafletLayer.toGeoJSON().geometry;
    if (hofplanEditBeforeGeometry && JSON.stringify(hofplanEditBeforeGeometry) !== JSON.stringify(afterGeometry)) {
      pushHofplanUndo({ type: 'edit', shapeId: shape.id, beforeGeometry: hofplanEditBeforeGeometry });
    }
  }
  hofplanEditBeforeGeometry = null;
  hofplanEditingId = null;
  updateHofplanToolbar();
}

function toggleHofplanEdit(shape) {
  if (!shape || !shape.leafletLayer.editing) return;
  if (hofplanEditingId === shape.id) {
    disableHofplanEditing();
  } else {
    disableHofplanEditing(); // vorherige Bearbeitung zuerst sauber beenden (inkl. Rückgängig-Eintrag)
    hofplanEditBeforeGeometry = cloneFeature(shape.leafletLayer.toGeoJSON()).geometry;
    shape.leafletLayer.editing.enable();
    hofplanEditingId = shape.id;
    const label = shape.name || shape.kategorie;
    setHofplanStatus(`${label ? 'Gebäude „' + label + '"' : 'Gebäude'}: Eckpunkte ziehen, um Form/Standort zu ändern.`);
  }
  renderHofplanList();
  updateHofplanToolbar();
}

function applyGeometryToHofplanShape(shape, geometry) {
  const depth = geometry.type === 'MultiPolygon' ? 2 : 1;
  shape.leafletLayer.setLatLngs(L.GeoJSON.coordsToLatLngs(geometry.coordinates, depth));
  const center = shape.leafletLayer.getBounds().getCenter();
  if (shape.labelAnchor && shape.labelAnchor.setLatLng) shape.labelAnchor.setLatLng(center);
  shape.areaQm = computeHofplanArea(shape);
}

// Feuert bei jedem Eckpunkt-Zug — Label-Position sofort mitziehen, die
// teurere Flächen-Neuberechnung + Listen-Update per Debounce ans Ende der
// Zieh-Geste verschieben (gleiches Prinzip wie syncShapeGeometryLive beim
// Flächenzeichner).
function syncHofplanGeometryLive(shape) {
  const center = shape.leafletLayer.getBounds().getCenter();
  if (shape.labelAnchor && shape.labelAnchor.setLatLng) shape.labelAnchor.setLatLng(center);
  clearTimeout(hofplanGeometryCommitTimer);
  hofplanGeometryCommitTimer = setTimeout(() => {
    shape.areaQm = computeHofplanArea(shape);
    renderHofplanList();
  }, 200);
}

function zoomToHofplanShape(id) {
  const shape = hofplanShapes.find(s => s.id === id);
  if (!shape || !shape.leafletLayer.getBounds) return;
  const bounds = shape.leafletLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 20 });
}

function renderHofplanList() {
  const list = document.getElementById('hofplan-list');
  document.getElementById('hofplan-empty-hint').style.display = hofplanShapes.length ? 'none' : 'block';
  list.innerHTML = '';
  hofplanShapes.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'parcel-item';
    const optionsHtml = GEBAEUDE_KATALOG.map(g =>
      `<option value="${escapeHtml(g.kategorie)}" ${s.kategorie === g.kategorie ? 'selected' : ''}>${escapeHtml(g.kategorie)}</option>`
    ).join('');
    item.innerHTML = `
      <div class="parcel-row">
        <input type="color" class="hofplan-color-input" data-id="${s.id}" value="${hofplanEffectiveColor(s)}" title="Farbe ändern">
        <div class="parcel-nummer">#${i + 1}</div>
        <input class="parcel-name" data-id="${s.id}" placeholder="Gebäudename (optional)" value="${escapeHtml(s.name)}">
        <div class="parcel-size">${Math.round(s.areaQm).toLocaleString('de-DE')} m²</div>
      </div>
      <select class="parcel-kultur" data-id="${s.id}">
        <option value="" ${s.kategorie ? '' : 'selected'}>– Gebäudetyp wählen –</option>
        ${optionsHtml}
      </select>
      <div class="layer-actions">
        ${s.color ? `<button data-id="${s.id}" data-action="reset-color">Farbe zurücksetzen</button>` : ''}
        ${s.kategorie === 'Stall' ? `<button data-id="${s.id}" data-action="open-stallplan">${hofplanLinkedStallplanExists(s) ? 'Stallplan öffnen' : 'Stallplan anlegen'}</button>` : ''}
        <button data-id="${s.id}" data-action="zoom">Zoom</button>
        <button data-id="${s.id}" data-action="remove" class="danger">Entfernen</button>
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.hofplan-color-input').forEach(input => {
    input.addEventListener('input', () => {
      const s = hofplanShapes.find(x => x.id === input.getAttribute('data-id'));
      if (s) { s.color = input.value; updateHofplanShapeStyle(s); }
    });
    input.addEventListener('change', () => renderHofplanList());
  });
  list.querySelectorAll('.parcel-name').forEach(input => {
    input.addEventListener('input', () => {
      const s = hofplanShapes.find(x => x.id === input.getAttribute('data-id'));
      if (s) { s.name = input.value; updateHofplanShapeStyle(s); }
    });
  });
  list.querySelectorAll('.parcel-kultur').forEach(select => {
    select.addEventListener('change', () => {
      const s = hofplanShapes.find(x => x.id === select.getAttribute('data-id'));
      if (s) { s.kategorie = select.value; updateHofplanShapeStyle(s); renderHofplanList(); }
    });
  });
  list.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const action = el.getAttribute('data-action');
      const s = hofplanShapes.find(x => x.id === id);
      if (action === 'zoom') zoomToHofplanShape(id);
      if (action === 'remove' && s) deleteHofplanShape(s);
      if (action === 'reset-color' && s) { s.color = null; updateHofplanShapeStyle(s); renderHofplanList(); }
      if (action === 'open-stallplan' && s) openOrCreateStallplanFor(s);
    });
  });
}
// Verknüpfung Hofplan-Gebäude (kategorie==='Stall') <-> Stallplaner-Plan:
// existiert schon einer, direkt dorthin wechseln; sonst neu anlegen und
// verknüpfen. Bewusst nur in diese Richtung (Hofplan -> Stallplaner) —
// löscht der Nutzer später das Gebäude, bleibt der Stallplan als
// eigenständiger Datensatz erhalten (kein Datenverlust durch eine
// Kartenänderung), nur die Verknüpfung verschwindet mit dem Gebäude.
function hofplanLinkedStallplanExists(s) {
  return !!(s.stallplanId && stallplaene.some(p => p.id === s.stallplanId));
}
function openOrCreateStallplanFor(shape) {
  let plan = shape.stallplanId ? stallplaene.find(p => p.id === shape.stallplanId) : null;
  if (!plan) {
    plan = createEmptyStallplan(shape.name || shape.kategorie || 'Stall');
    stallplaene.push(plan);
    shape.stallplanId = plan.id;
    renderHofplanList(); // Button-Beschriftung "anlegen" -> "öffnen"
  }
  setActiveSegment('stallplaner');
  setActiveStallplan(plan.id);
}
// Dev-only Testhaken (analog window.__ffTestMap/__ffTestStallplaner) — für
// die Hofplan<->Stallplaner-Verknüpfung.
if (import.meta.env.DEV) {
  window.__ffTestHofplan = {
    getShapes() { return hofplanShapes; },
    serializeShapes() { return serializeWorkspace().hofplanShapes; }
  };
}

function initHofplanMap() {
  if (hofplanInitDone) return;
  hofplanInitDone = true;

  hofplanLayerGroup = L.featureGroup().addTo(map);

  if (typeof L.Draw === 'undefined') {
    hofplanToolRectBtn.disabled = true;
    hofplanToolPolyBtn.disabled = true;
    showHofplanError('Zeichenwerkzeug nicht verfügbar (Leaflet.draw konnte nicht geladen werden).');
    return;
  }

  hofplanDrawRect = new L.Draw.Rectangle(map, {
    shapeOptions: { color: HOFPLAN_DEFAULT_COLOR, weight: 2, fillColor: HOFPLAN_DEFAULT_COLOR, fillOpacity: 0.32 }
  });
  hofplanDrawPoly = new L.Draw.Polygon(map, {
    shapeOptions: { color: HOFPLAN_DEFAULT_COLOR, weight: 2, fillColor: HOFPLAN_DEFAULT_COLOR, fillOpacity: 0.32 },
    showArea: true,
    metric: true,
    allowIntersection: false
  });

  // Eigene DRAWSTART/DRAWSTOP/CREATED-Handler, per armedTool von den
  // gleichnamigen Flächenzeichner-Handlern unterschieden (siehe dortiger
  // Guard bei layerType 'polygon' — Rechteck nutzt ohnehin einen eigenen,
  // dort nicht behandelten layerType 'rectangle').
  map.on(L.Draw.Event.DRAWSTART, () => {
    if (armedTool === 'draw-hofplan-rect') setHofplanStatus('Rechteck aufziehen, um ein Gebäude zu zeichnen (Esc zum Abbrechen).');
    else if (armedTool === 'draw-hofplan-poly') setHofplanStatus('Eckpunkte anklicken, mit Doppelklick abschließen (Esc zum Abbrechen).');
    updateHofplanToolbar();
  });
  map.on(L.Draw.Event.DRAWSTOP, () => {
    if (armedTool === 'draw-hofplan-rect' || armedTool === 'draw-hofplan-poly') armedTool = null;
    updateHofplanToolbar();
  });
  map.on('contextmenu', (e) => {
    if (armedTool === 'draw-hofplan-poly') { L.DomEvent.preventDefault(e); hofplanDrawPoly.deleteLastVertex(); }
  });
  map.on(L.Draw.Event.CREATED, (e) => {
    if (armedTool !== 'draw-hofplan-rect' && armedTool !== 'draw-hofplan-poly') return;
    const shape = addHofplanShapeFromLayer(e.layer, '', '');
    pushHofplanUndo({ type: 'add', shapeId: shape.id });
    renderHofplanList();
    setHofplanStatus(`Gebäude gezeichnet (${Math.round(shape.areaQm).toLocaleString('de-DE')} m²) — Typ in der Liste zuweisen.`);
  });
}

// ---------- Werkzeugleiste: Hofplan-Gruppe (Teil von #edit-toolbar) ----------
const hofplanToolRectBtn = document.getElementById('hofplan-tool-rect');
const hofplanToolPolyBtn = document.getElementById('hofplan-tool-poly');
const hofplanToolEditBtn = document.getElementById('hofplan-tool-edit');
const hofplanToolDeleteBtn = document.getElementById('hofplan-tool-delete');
const hofplanToolUndoBtn = document.getElementById('hofplan-tool-undo');
const hofplanToolRedoBtn = document.getElementById('hofplan-tool-redo');

function updateHofplanToolbar() {
  hofplanToolRectBtn.classList.toggle('active', armedTool === 'draw-hofplan-rect');
  hofplanToolPolyBtn.classList.toggle('active', armedTool === 'draw-hofplan-poly');
  hofplanToolEditBtn.classList.toggle('active', hofplanToolMode === 'edit');
  hofplanToolDeleteBtn.classList.toggle('active', hofplanToolMode === 'delete');
  hofplanToolUndoBtn.disabled = hofplanUndoStack.length === 0;
  hofplanToolRedoBtn.disabled = hofplanRedoStack.length === 0;
}

// Bearbeiten/Löschen bleiben "scharf", bis man sie erneut anklickt (oder Esc
// drückt) — mehrere Gebäude hintereinander anklicken, ohne das Werkzeug
// jedes Mal neu auswählen zu müssen (gleiches Prinzip wie setMapToolMode).
function setHofplanToolMode(mode) {
  disableHofplanEditing();
  hofplanToolMode = hofplanToolMode === mode ? null : mode;
  if (hofplanToolMode === 'edit') setHofplanStatus('Gebäude anklicken, um seine Eckpunkte zu bearbeiten.');
  else if (hofplanToolMode === 'delete') setHofplanStatus('Gebäude anklicken, um es zu löschen.');
  updateHofplanToolbar();
}

hofplanToolRectBtn.addEventListener('click', () => {
  initHofplanMap();
  armedTool = 'draw-hofplan-rect';
  if (hofplanDrawRect) hofplanDrawRect.enable();
});
hofplanToolPolyBtn.addEventListener('click', () => {
  initHofplanMap();
  armedTool = 'draw-hofplan-poly';
  if (hofplanDrawPoly) hofplanDrawPoly.enable();
});
hofplanToolEditBtn.addEventListener('click', () => setHofplanToolMode('edit'));
hofplanToolDeleteBtn.addEventListener('click', () => setHofplanToolMode('delete'));
hofplanToolUndoBtn.addEventListener('click', undoLastHofplanAction);
hofplanToolRedoBtn.addEventListener('click', redoLastHofplanAction);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (hofplanToolMode) { hofplanToolMode = null; updateHofplanToolbar(); }
  if (armedTool === 'draw-hofplan-rect' && hofplanDrawRect) hofplanDrawRect.disable();
  if (armedTool === 'draw-hofplan-poly' && hofplanDrawPoly) hofplanDrawPoly.disable();
});

updateHofplanToolbar();

// Speichert die gezeichneten Gebäude als reguläres GeoJSON, analog zum
// Flächenzeichner-Export.
function exportHofplanGeoJSON() {
  if (!hofplanShapes.length) { showHofplanError('Noch kein Gebäude gezeichnet.'); return; }
  const fc = {
    type: 'FeatureCollection',
    features: hofplanShapes.map(s => ({
      type: 'Feature',
      geometry: s.leafletLayer.toGeoJSON().geometry,
      properties: { kategorie: s.kategorie, name: s.name, farbe: hofplanEffectiveColor(s), flaeche_qm: Math.round(s.areaQm) }
    }))
  };
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(fc, null, 2), zuordnungFileName('Hofplan', 'geojson') || `hofplan_${ts}.geojson`, 'application/geo+json');
  setHofplanStatus('Als GeoJSON gespeichert.');
}
document.getElementById('btn-export-hofplan-geojson').addEventListener('click', exportHofplanGeoJSON);

// ---------- Lageplan exportieren (ein Satellitenbild mit allen Gebäuden + Legende) ----------
// Im Unterschied zu den übrigen Flächenkarten-Exporten (eine Seite pro
// Fläche) hier bewusst EINE Gesamtübersicht: alle Gebäude zusammen als ein
// PDF, mit Legende statt Einzel-Infozeile — ein Hofplan ist als Ganzes
// gedacht, nicht als Sammlung einzelner Blätter.
async function captureHofplanScreenshot(targetMap, satelliteLayer, mapElId, featureCollection) {
  const highlightLayer = L.geoJSON(featureCollection, {
    renderer: L.canvas(),
    style: (feature) => {
      const color = feature.properties.farbe;
      return { color, weight: 2.5, opacity: 1, fillColor: color, fillOpacity: 0.4 };
    }
  }).addTo(targetMap);
  // Gebäudenamen (bzw. Kategorie ohne Namen) als Label direkt auf dem
  // Kartenbild — dieselbe Beschriftung wie auf der Live-Karte
  // (hofplanLabelText), nur als eigene temporäre Layer, da hofplanLayerGroup
  // für den Export ausgeblendet ist und ihre Labels sonst fehlen würden.
  const labelLayers = featureCollection.features
    .filter(feature => feature.properties.label)
    .map((feature) => {
      const center = L.geoJSON(feature).getBounds().getCenter();
      return createLabelAnchorAt(center, feature.properties.label).addTo(targetMap);
    });
  try {
    const bounds = highlightLayer.getBounds();
    if (bounds.isValid()) targetMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 20 });
    await waitForTilesFullyLoaded(satelliteLayer, mapElId, 6000);
    return await html2canvas(document.getElementById(mapElId), { useCORS: true, logging: false });
  } finally {
    targetMap.removeLayer(highlightLayer);
    labelLayers.forEach(l => targetMap.removeLayer(l));
  }
}

function computeHofplanLegend() {
  const seen = new Map();
  hofplanShapes.forEach(s => {
    const label = s.kategorie || 'Ohne Typ';
    const color = hofplanEffectiveColor(s);
    seen.set(label + '|' + color, { label, color });
  });
  return [...seen.values()];
}

function addHofplanUebersichtPage(doc, pageW, pageH, margin, canvas, legendItems) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Hofplan – Lageplan', margin, margin + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const legendY = margin + 11;
  const swatch = 3.2;
  let lx = margin;
  legendItems.forEach((item) => {
    doc.setFillColor(item.color);
    doc.rect(lx, legendY - swatch, swatch, swatch, 'F');
    doc.text(item.label, lx + swatch + 1.6, legendY);
    lx += swatch + 1.6 + doc.getTextWidth(item.label) + 8;
  });

  const imageTop = legendY + 6;
  const maxW = pageW - margin * 2;
  const maxH = pageH - imageTop - margin;
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
  const imgW = canvas.width * scale;
  const imgH = canvas.height * scale;
  const imgX = (pageW - imgW) / 2;
  doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', imgX, imageTop, imgW, imgH);
}

async function exportHofplanUebersicht() {
  if (typeof html2canvas === 'undefined') { showHofplanError('Lageplan-Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showHofplanError('Lageplan-Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!hofplanShapes.length) { showHofplanError('Noch kein Gebäude gezeichnet.'); return; }

  const btn = document.getElementById('btn-export-hofplan-uebersicht');
  btn.disabled = true;

  // Ein noch scharf gestelltes Zeichenwerkzeug hinterlässt sonst seinen
  // Hinweis-Tooltip ("Click and drag to draw rectangle." o.ä.) mitten im
  // Screenshot, da der Tooltip Teil des Karten-DOM ist und von html2canvas
  // mit erfasst wird.
  if (armedTool === 'draw-hofplan-rect' && hofplanDrawRect) hofplanDrawRect.disable();
  if (armedTool === 'draw-hofplan-poly' && hofplanDrawPoly) hofplanDrawPoly.disable();
  disableHofplanEditing();

  const savedCenter = map.getCenter();
  const savedZoom = map.getZoom();
  const savedBasemap = currentBasemap;

  map.removeLayer(hofplanLayerGroup);
  if (currentBasemap !== 'satellite') setBasemap('satellite');
  map.removeControl(map.zoomControl);

  try {
    const fc = {
      type: 'FeatureCollection',
      features: hofplanShapes.map(s => ({
        type: 'Feature',
        geometry: s.leafletLayer.toGeoJSON().geometry,
        properties: { kategorie: s.kategorie, farbe: hofplanEffectiveColor(s), label: hofplanLabelText(s) }
      }))
    };

    setHofplanStatus('Exportiere Lageplan …');
    let canvas;
    try {
      canvas = await captureHofplanScreenshot(map, basemaps.satellite, 'map', fc);
    } catch (err) {
      console.error('Kartenbild-Erfassung für Hofplan fehlgeschlagen', err);
      showHofplanError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
      return;
    }

    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    addHofplanUebersichtPage(doc, pageW, pageH, 12, canvas, computeHofplanLegend());
    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    const ts = new Date().toISOString().slice(0, 10);
    doc.save(zuordnungFileName('Hofplan Lageplan', 'pdf') || `hofplan_lageplan_${ts}.pdf`);
    setHofplanStatus('Lageplan exportiert.');
  } finally {
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    hofplanLayerGroup.addTo(map);
    map.setView(savedCenter, savedZoom);
    btn.disabled = false;
  }
}
document.getElementById('btn-export-hofplan-uebersicht').addEventListener('click', exportHofplanUebersicht);

// ---------- Gesamtexport (Flächenzeichner + Obstbaumkataster + Hofplan) ----------
// Kombiniert genau die Funktionen, die auch einzeln als GeoJSON exportierbar
// sind (Bienenflugkarte hat keinen eigenen GeoJSON-Export und bleibt daher
// hier bewusst außen vor) — einmal als eine gemeinsame .geojson-Datei,
// einmal als ein gemeinsames PDF mit Deckblatt + einem Abschnitt je
// Funktion. Nutzt für das PDF dieselben Seiten-Bausteine wie die einzelnen
// Flächenkarten-Exporte (addFlaechenkartePage/addObstbaumParcelPages/
// addObstbaumClusterPages/addHofplanUebersichtPage), nur mit einem
// gemeinsamen jsPDF-Dokument statt je einem eigenen.
function exportKombiniertesGeoJSON() {
  const zeichnerFeatures = zeichnerParcels.map(p => ({
    ...cloneFeature(p.leafletLayer.feature),
    properties: { ...p.leafletLayer.feature.properties, quelle: 'Flächenzeichner' }
  }));
  const obstbaumFeatures = obstbaumTrees.map(t => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [t.latlng.lng, t.latlng.lat] },
    properties: { nummer: t.nummer, art: t.art, label: fruitOf(t.art).label, quelle: 'Obstbaumkataster' }
  }));
  const hofplanFeatures = hofplanShapes.map(s => ({
    type: 'Feature',
    geometry: s.leafletLayer.toGeoJSON().geometry,
    properties: { kategorie: s.kategorie, name: s.name, farbe: hofplanEffectiveColor(s), flaeche_qm: Math.round(s.areaQm), quelle: 'Hofplan' }
  }));
  const allFeatures = [...zeichnerFeatures, ...obstbaumFeatures, ...hofplanFeatures];
  if (!allFeatures.length) { showError('Noch keine Inhalte zum Exportieren vorhanden.'); return; }
  const fc = { type: 'FeatureCollection', features: allFeatures };
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(fc, null, 2), zuordnungFileName('FeldFolio', 'geojson') || `FeldFolio_${ts}.geojson`, 'application/geo+json');
  setStatus('Gesamtübersicht als GeoJSON gespeichert.');
}
document.getElementById('btn-export-gesamt-geojson').addEventListener('click', exportKombiniertesGeoJSON);

async function exportKombiniertesPDF() {
  if (typeof html2canvas === 'undefined') { showError('Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showError('Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!zeichnerParcels.length && !obstbaumTrees.length && !hofplanShapes.length) {
    showError('Noch keine Inhalte zum Exportieren vorhanden.');
    return;
  }

  const btnPdf = document.getElementById('btn-export-gesamt-pdf');
  const btnGeo = document.getElementById('btn-export-gesamt-geojson');
  btnPdf.disabled = true;
  btnGeo.disabled = true;

  const savedCenter = map.getCenter();
  const savedZoom = map.getZoom();
  const savedBasemap = currentBasemap;
  // Alle Ebenen (inkl. der Flächenzeichner-Ebene, die wie jede andere Fläche
  // Teil von layers{} ist) und die Hofplan-Ebene ausblenden — jeder Abschnitt
  // zeigt sonst zusätzlich noch die farbig gefüllten Formen der jeweils
  // ANDEREN Funktionen im Hintergrund. Baumpunkte (obstbaumLayerGroup) sind
  // bewusst NICHT Teil von layers{} und bleiben daher sichtbar.
  const visibleLayerIds = Object.keys(layers).filter(id => layers[id].visible);
  visibleLayerIds.forEach(id => map.removeLayer(layers[id].leafletLayer));
  if (hofplanLayerGroup) map.removeLayer(hofplanLayerGroup);
  if (armedTool === 'draw-hofplan-rect' && hofplanDrawRect) hofplanDrawRect.disable();
  if (armedTool === 'draw-hofplan-poly' && hofplanDrawPoly) hofplanDrawPoly.disable();
  disableHofplanEditing();
  if (currentBasemap !== 'satellite') setBasemap('satellite');
  map.removeControl(map.zoomControl);

  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  try {
    // Deckblatt
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('FeldFolio – Gesamtübersicht', margin, margin + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.text(activeZuordnung ? activeZuordnung.betrieb : 'Kein Betrieb zugeordnet', margin, margin + 22);
    doc.text(new Date().toLocaleDateString('de-DE'), margin, margin + 29);
    doc.setFontSize(11);
    let sy = margin + 42;
    if (zeichnerParcels.length) { doc.text(`${zeichnerParcels.length} gezeichnete Fläche(n)`, margin, sy); sy += 7; }
    if (obstbaumTrees.length) { doc.text(`${obstbaumTrees.length} Baum/Bäume`, margin, sy); sy += 7; }
    if (hofplanShapes.length) { doc.text(`${hofplanShapes.length} Gebäude`, margin, sy); sy += 7; }

    let pageIdx = 1; // Deckblatt zählt bereits als erste Seite

    if (zeichnerParcels.length) {
      doc.addPage('a4', 'landscape');
      pageIdx++;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Flächenzeichner', margin, margin + 6);
      for (let i = 0; i < zeichnerParcels.length; i++) {
        const p = zeichnerParcels[i];
        setStatus(`Gesamtexport … Flächenzeichner (${i + 1}/${zeichnerParcels.length})`);
        let canvas;
        try {
          canvas = await captureParcelScreenshot(map, basemaps.satellite, 'map', p.leafletLayer.toGeoJSON());
        } catch (err) {
          console.error('Kartenbild-Erfassung fehlgeschlagen für', p.nummer, err);
          showError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
          return;
        }
        // Immer eine neue Seite, auch beim ersten Durchlauf — die aktuelle
        // Seite trägt bereits die Abschnitts-Überschrift, addFlaechenkartePage
        // schreibt sonst ihren eigenen Titel darüber (Überlappung).
        doc.addPage('a4', 'landscape');
        pageIdx++;
        addFlaechenkartePage(doc, pageW, pageH, margin, canvas, {
          nummer: p.nummer, featName: p.featName, groesse: String(p.areaHa), kultur: p.kultur, flaechenId: ''
        });
      }
    }

    if (obstbaumTrees.length) {
      doc.addPage('a4', 'landscape');
      pageIdx++;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Obstbaumkataster', margin, margin + 6);
      const grandTotal = new Map();
      if (featureIndex.length) {
        const treeLists = computeObstbaumParcelTreeLists();
        const parcelsWithTrees = featureIndex
          .filter(p => treeLists.has(p.id))
          .sort((a, b) => String(a.nummer).localeCompare(String(b.nummer), undefined, { numeric: true }));
        pageIdx = await addObstbaumParcelPages(doc, parcelsWithTrees, treeLists, pageW, pageH, margin, pageIdx, grandTotal);
        const unassigned = obstbaumTrees.filter(t => !t.parcelId);
        if (unassigned.length) {
          const clusters = clusterTrees(unassigned, TREE_VISIBILITY_RADIUS);
          pageIdx = await addObstbaumClusterPages(doc, clusters, pageW, pageH, margin, pageIdx, grandTotal, 'Nicht zugeordnet');
        }
      } else {
        const clusters = clusterTrees(obstbaumTrees, TREE_VISIBILITY_RADIUS);
        pageIdx = await addObstbaumClusterPages(doc, clusters, pageW, pageH, margin, pageIdx, grandTotal, '');
      }
    }

    if (hofplanShapes.length) {
      doc.addPage('a4', 'landscape');
      pageIdx++;
      setStatus('Gesamtexport … Hofplan');
      const fc = {
        type: 'FeatureCollection',
        features: hofplanShapes.map(s => ({
          type: 'Feature',
          geometry: s.leafletLayer.toGeoJSON().geometry,
          properties: { kategorie: s.kategorie, farbe: hofplanEffectiveColor(s), label: hofplanLabelText(s) }
        }))
      };
      let canvas;
      try {
        canvas = await captureHofplanScreenshot(map, basemaps.satellite, 'map', fc);
      } catch (err) {
        console.error('Kartenbild-Erfassung für Hofplan fehlgeschlagen', err);
        showError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        return;
      }
      addHofplanUebersichtPage(doc, pageW, pageH, margin, canvas, computeHofplanLegend());
    }

    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    const ts = new Date().toISOString().slice(0, 10);
    doc.save(zuordnungFileName('FeldFolio', 'pdf') || `FeldFolio_${ts}.pdf`);
    setStatus('Gesamtübersicht als PDF exportiert.');
  } finally {
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    visibleLayerIds.forEach(id => layers[id] && layers[id].leafletLayer.addTo(map));
    if (hofplanLayerGroup) hofplanLayerGroup.addTo(map);
    map.setView(savedCenter, savedZoom);
    btnPdf.disabled = false;
    btnGeo.disabled = false;
  }
}
document.getElementById('btn-export-gesamt-pdf').addEventListener('click', exportKombiniertesPDF);

// ---------- FeldFolio Plus: Cloud-Konto ----------
// Login-gated Cloud-Speicherung des gesamten Arbeitsstands (geteilte Ebenen +
// Obstbäume + Bienenstöcke) — alles andere in der App funktioniert weiterhin
// vollständig ohne Anmeldung, das hier ist ein reiner Zusatz obendrauf.
const accountModal = document.getElementById('account-modal-overlay');
const accountBtn = document.getElementById('btn-account');
const accountNotConfigured = document.getElementById('account-not-configured');
const accountAuthWrap = document.getElementById('account-auth-wrap');
const accountAuthForm = document.getElementById('account-auth-form');
const accountAuthHint = document.getElementById('account-auth-hint');
const accountBtnSubmit = document.getElementById('account-btn-submit');
const accountPasswordInput = document.getElementById('account-password');
const accountModeButtons = document.querySelectorAll('.auth-mode-btn');
const accountLoggedIn = document.getElementById('account-logged-in');
const accountAuthError = document.getElementById('account-auth-error');
const accountSyncStatus = document.getElementById('account-sync-status');
const accountModeSwitch = document.querySelector('.auth-mode-switch');
const accountEmailInput = document.getElementById('account-email');
const accountDomainHint = document.getElementById('account-domain-hint');
const accountRequestBlock = document.getElementById('account-request-block');
const accountRequestEmail = document.getElementById('account-request-email');
const accountRequestName = document.getElementById('account-request-name');
const accountRequestMessage = document.getElementById('account-request-message');
const accountRequestError = document.getElementById('account-request-error');
const accountRequestStatus = document.getElementById('account-request-status');
const accountRequestSubmitBtn = document.getElementById('account-request-submit');
const accountAdminSection = document.getElementById('account-admin-requests');
const accountAdminList = document.getElementById('account-admin-requests-list');
const accountAdminError = document.getElementById('account-admin-error');
let accountSession = null;
let authMode = 'signin';
// ---- Zustand des Offline-Abgleichs (siehe "Offline-Betrieb" weiter unten) ----
const LOCAL_SAVE_INTERVAL_MS = 10000;
let offlineRec = null; // Spiegel des lokalen Datensatzes des angemeldeten Nutzers
let persistCache = { key: null, ws: null, shared: null };
let syncPromise = null;
let syncQueued = false;
let syncState = 'idle'; // 'idle' | 'syncing' | 'offline' | 'error'
let syncErrorMessage = '';
let lastSyncedAt = null;

// Registrierung ist grundsätzlich nur für @oekop.de-Adressen offen, alle
// anderen müssen erst eine Zugangsanfrage stellen (siehe access_requests/
// access_allowlist + Server-Trigger, Migrations-SQL im Plan). Diese Prüfung
// hier ist nur für die Nutzerführung — die eigentliche Durchsetzung passiert
// serverseitig per Datenbank-Trigger, ein Client-Check allein wäre keine
// Sicherheit.
function isOekopEmail(email) {
  return /@oekop\.de$/i.test((email || '').trim());
}

// Ein Formular für Anmelden/Registrieren statt zwei Buttons nebeneinander —
// der Tab-Umschalter oben macht unmissverständlich klar, in welchem Modus
// man gerade ist (Hinweistext, Button-Beschriftung und Passwort-Autocomplete
// wechseln mit).
const AUTH_MODE_TEXT = {
  signin: {
    hint: 'Mit bestehendem Cloud-Konto anmelden, um den aktuellen Stand zu speichern und auf einem anderen Gerät weiterzuarbeiten.',
    submit: 'Anmelden',
    autocomplete: 'current-password'
  },
  signup: {
    hint: 'Neues Cloud-Konto erstellen, um den aktuellen Stand künftig zu speichern und auf einem anderen Gerät weiterzuarbeiten.',
    submit: 'Registrieren',
    autocomplete: 'new-password'
  }
};

function setAuthMode(mode) {
  authMode = mode;
  accountModeSwitch.hidden = false;
  accountAuthForm.hidden = false;
  accountRequestBlock.hidden = true;
  accountModeButtons.forEach(btn => {
    const active = btn.getAttribute('data-mode') === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  const t = AUTH_MODE_TEXT[mode];
  accountAuthHint.textContent = t.hint;
  accountBtnSubmit.textContent = t.submit;
  accountPasswordInput.autocomplete = t.autocomplete;
  showAccountError('');
  updateDomainHint();
}

accountModeButtons.forEach(btn => {
  btn.addEventListener('click', () => setAuthMode(btn.getAttribute('data-mode')));
});

// Reiner Komfort-Hinweis beim Tippen der E-Mail im Registrieren-Modus, keine
// Sicherheitsprüfung (siehe isOekopEmail oben).
function updateDomainHint() {
  if (authMode !== 'signup') { accountDomainHint.hidden = true; return; }
  const email = accountEmailInput.value.trim();
  if (!email.includes('@')) { accountDomainHint.hidden = true; return; }
  accountDomainHint.hidden = false;
  if (isOekopEmail(email)) {
    accountDomainHint.innerHTML = '<span class="material-symbols-rounded icon">check</span> oekop.de-Adresse — Registrierung sofort möglich.';
  } else {
    accountDomainHint.innerHTML = 'Diese Adresse benötigt eine Freischaltung. <button type="button" id="account-domain-hint-request" class="inline-link">Direkt Zugang anfragen</button>';
    document.getElementById('account-domain-hint-request').addEventListener('click', () => openRequestBlock(email));
  }
}
accountEmailInput.addEventListener('input', updateDomainHint);

function showAccountError(msg) {
  accountAuthError.textContent = msg;
  accountAuthError.hidden = !msg;
}

function renderAccountModal() {
  accountNotConfigured.hidden = isSupabaseConfigured;
  accountAuthWrap.hidden = !isSupabaseConfigured || !!accountSession;
  accountLoggedIn.hidden = !isSupabaseConfigured || !accountSession;
  accountSyncStatus.textContent = '';
  if (accountSession) document.getElementById('account-email-display').textContent = accountSession.user.email;

  // "Admin" ist hier bewusst einfach über die vertraute Domain definiert —
  // dieselbe Domain, die auch zur Sofort-Registrierung berechtigt (siehe
  // isOekopEmail). Keine separate Rollen-Tabelle in diesem ersten Ausbauschritt.
  const isAdmin = !!accountSession && isOekopEmail(accountSession.user.email);
  accountAdminSection.hidden = !isAdmin;
  if (isAdmin) refreshAdminRequests();
}

function showAdminError(msg) {
  accountAdminError.textContent = msg;
  accountAdminError.hidden = !msg;
}

function renderAdminRequests(list) {
  if (!list.length) {
    accountAdminList.innerHTML = '<p class="modal-hint">Keine offenen Anfragen.</p>';
    return;
  }
  accountAdminList.innerHTML = list.map(r => `
    <div class="admin-request-row" data-id="${r.id}">
      <div class="admin-request-info">
        <strong>${escapeHtml(r.email)}</strong>${r.name ? ' · ' + escapeHtml(r.name) : ''}
        <span class="admin-request-date">${new Date(r.created_at).toLocaleDateString('de-DE')}</span>
        ${r.message ? `<p class="admin-request-msg">${escapeHtml(r.message)}</p>` : ''}
      </div>
      <div class="admin-request-actions">
        <button type="button" data-action="approve" data-id="${r.id}" data-email="${escapeHtml(r.email)}">Freischalten</button>
        <button type="button" data-action="decline" data-id="${r.id}">Ablehnen</button>
      </div>
    </div>`).join('');
  accountAdminList.querySelectorAll('[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      showAdminError('');
      try {
        await approveAccessRequest(btn.getAttribute('data-id'), btn.getAttribute('data-email'));
        await refreshAdminRequests();
      } catch (err) {
        btn.disabled = false;
        showAdminError(err.message || 'Freischalten fehlgeschlagen.');
      }
    });
  });
  accountAdminList.querySelectorAll('[data-action="decline"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      showAdminError('');
      try {
        await declineAccessRequest(btn.getAttribute('data-id'));
        await refreshAdminRequests();
      } catch (err) {
        btn.disabled = false;
        showAdminError(err.message || 'Ablehnen fehlgeschlagen.');
      }
    });
  });
}

async function refreshAdminRequests() {
  showAdminError('');
  try {
    renderAdminRequests(await listPendingAccessRequests());
  } catch (err) {
    showAdminError(err.message || 'Anfragen konnten nicht geladen werden.');
  }
}

document.getElementById('account-admin-refresh').addEventListener('click', refreshAdminRequests);

function updateAccountButton() {
  // Am Handy nur das Symbol (Beschriftung per CSS ausgeblendet), die
  // E-Mail steht dann im Tooltip bzw. im Konto-Dialog.
  const label = document.getElementById('btn-account-label');
  if (accountSession) {
    label.textContent = accountSession.user.email;
    accountBtn.title = 'FeldFolio+ Konto: ' + accountSession.user.email;
    accountBtn.classList.add('logged-in');
  } else {
    label.textContent = 'Anmelden';
    accountBtn.title = 'Anmelden (FeldFolio+ Konto)';
    accountBtn.classList.remove('logged-in');
  }
  // Das "+" in der Wortmarke (FeldFolio+) markiert die Cloud-Funktionen, die
  // erst nach der Anmeldung nutzbar sind — deshalb nur dann sichtbar.
  document.getElementById('brand-logo').classList.toggle('is-logged-in', !!accountSession);
  // Der Terminkalender ist ohne Anmeldung ohnehin nur ein "bitte anmelden"-
  // Hinweis (siehe #terminkalender-not-logged-in) — der eigene, groß
  // abgesetzte Umschalter-Button lenkt in der normalen (nicht angemeldeten)
  // Ansicht nur unnötig ab und erscheint daher erst nach der Anmeldung.
  document.getElementById('terminkalender-switcher').hidden = !accountSession;
  // Cloud-Sync gibt es nur mit Konto — ohne Anmeldung ist der Schalter
  // wirkungslos und nimmt in der Kopfzeile nur Platz weg. Offline mit dem
  // zuletzt angemeldeten Nutzer gestartet (accountSession.offline) bleibt er
  // sichtbar: dann zeigt er "offline"/"noch nicht hochgeladen" an.
  document.getElementById('btn-sync').hidden = !accountSession;
}

function openAccountModal() { setAuthMode('signin'); renderAccountModal(); accountModal.hidden = false; }
function closeAccountModal() { accountModal.hidden = true; }

accountBtn.addEventListener('click', openAccountModal);
['account-modal-close-1', 'account-modal-close-2', 'account-modal-close-3'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeAccountModal);
});
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !accountModal.hidden) closeAccountModal(); });

initAccountAndState();

// ---------- Als Web-App installieren ----------
// Android/Chrome/Edge melden über 'beforeinstallprompt', dass die Seite
// installierbar ist (Manifest + Service Worker, nur im Produktions-Build) —
// das Ereignis wird aufgehoben und über den eigenen Button ausgelöst, statt
// die unauffällige Browser-Leiste abzuwarten. Safari (iPhone/iPad) kennt so
// etwas nicht: dort zeigt der Button eine kurze Anleitung übers Teilen-Menü.
let deferredInstallPrompt = null;
function isRunningAsInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIosSafari() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}
function updateInstallButton() {
  const btn = document.getElementById('btn-install-app');
  btn.hidden = isRunningAsInstalledApp() || !(deferredInstallPrompt || isIosSafari());
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});
document.getElementById('btn-install-app').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    promptEvent.prompt();
    try { await promptEvent.userChoice; } catch {}
    updateInstallButton();
  } else if (isIosSafari()) {
    closeMobileSidebar();
    document.getElementById('install-ios-overlay').hidden = false;
  }
});
document.getElementById('install-ios-close').addEventListener('click', () => {
  document.getElementById('install-ios-overlay').hidden = true;
});
document.getElementById('install-ios-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'install-ios-overlay') e.target.hidden = true;
});
updateInstallButton();

// App-Verknüpfungen (Manifest "shortcuts", langes Drücken aufs App-Symbol)
// öffnen direkt eine Funktion: ?view=stallplaner / ?view=terminkalender.
// Erst nach dem vollständigen Laden des Moduls — setActiveSegment() greift
// auf Zustand zu, der weiter unten in dieser Datei erst angelegt wird.
setTimeout(() => {
  const startView = new URLSearchParams(location.search).get('view');
  if (startView && SEGMENT_TITLES[startView] && startView !== 'viewer') setActiveSegment(startView);
}, 0);

// ---------- Offline-App (Service Worker, siehe vite.config.js) ----------
// Nur im Produktions-Build. Eine neue Version wird erst nach Bestätigung
// aktiviert — sonst würde die Seite mitten in der Arbeit neu geladen.
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  const updateApp = registerSW({
    onNeedRefresh() {
      if (document.getElementById('app-update-toast')) return;
      const toast = document.createElement('div');
      toast.id = 'app-update-toast';
      toast.setAttribute('role', 'status');
      toast.innerHTML = '<span>Neue Version von FeldFolio verfügbar.</span><button type="button" class="primary">Neu laden</button><button type="button" aria-label="Später">Später</button>';
      const [reloadBtn, laterBtn] = toast.querySelectorAll('button');
      reloadBtn.addEventListener('click', async () => { await persistLocalState(); updateApp(true); });
      laterBtn.addEventListener('click', () => toast.remove());
      document.body.appendChild(toast);
    }
  });
}

accountAuthForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showAccountError('');
  const email = document.getElementById('account-email').value.trim();
  const password = accountPasswordInput.value;
  try {
    if (authMode === 'signup') {
      const data = await signUp(email, password);
      if (data.session) {
        accountSession = data.session;
        updateAccountButton();
        renderAccountModal();
        startUserState(accountSession.user);
        refreshAutoSyncTimer();
      } else {
        showAccountError('Registrierung erfolgreich — bitte E-Mail bestätigen und dann anmelden.');
      }
    } else {
      const data = await signIn(email, password);
      accountSession = data.session;
      updateAccountButton();
      renderAccountModal();
      startUserState(accountSession.user);
      refreshAutoSyncTimer();
    }
  } catch (err) {
    // Registrierung für eine noch nicht freigeschaltete Nicht-oekop.de-Adresse
    // schlägt serverseitig immer fehl (siehe Trigger check_signup_allowed) —
    // statt der rohen (oft kryptischen) Datenbank-Fehlermeldung direkt die
    // Zugangsanfrage anbieten, das ist der eigentlich erwartbare nächste Schritt.
    if (authMode === 'signup' && !isOekopEmail(email)) {
      openRequestBlock(email);
    } else {
      showAccountError(err.message || (authMode === 'signup' ? 'Registrierung fehlgeschlagen.' : 'Anmeldung fehlgeschlagen.'));
    }
  }
});

function showRequestError(msg) {
  accountRequestError.textContent = msg;
  accountRequestError.hidden = !msg;
}

function openRequestBlock(email) {
  accountModeSwitch.hidden = true;
  accountAuthForm.hidden = true;
  accountRequestBlock.hidden = false;
  accountRequestEmail.value = email;
  accountRequestName.value = '';
  accountRequestMessage.value = '';
  accountRequestStatus.textContent = '';
  accountRequestSubmitBtn.disabled = false;
  showRequestError('');
}

document.getElementById('account-request-cancel').addEventListener('click', () => setAuthMode('signup'));

accountRequestSubmitBtn.addEventListener('click', async () => {
  showRequestError('');
  const email = accountRequestEmail.value.trim();
  try {
    await requestAccess({
      email,
      name: accountRequestName.value.trim(),
      message: accountRequestMessage.value.trim()
    });
    accountRequestStatus.textContent = 'Anfrage gesendet — du bekommst Bescheid, sobald sie freigeschaltet ist.';
    accountRequestSubmitBtn.disabled = true;
  } catch (err) {
    showRequestError(err.message || 'Anfrage konnte nicht gesendet werden.');
  }
});

document.getElementById('account-btn-signout').addEventListener('click', async () => {
  const userId = currentUserId();
  // Beim Abmelden wird der lokale Stand dieses Nutzers gelöscht (fremde
  // Geräte!) — noch nicht hochgeladene Änderungen vorher möglichst retten.
  if (hasPendingLocalChanges() && navigator.onLine) await syncWithCloud();
  if (hasPendingLocalChanges() &&
      !confirm('Es gibt Änderungen, die noch nicht in der Cloud gespeichert sind (z.B. offline erfasst). Beim Abmelden gehen sie auf diesem Gerät verloren. Trotzdem abmelden?')) return;
  try { await signOut(); } catch {}
  if (userId) {
    try { await deleteLocalState(userId); await writeLastUser(null); } catch {}
  }
  offlineRec = null;
  persistCache = { key: null, ws: null, shared: null };
  syncState = 'idle';
  accountSession = null;
  updateAccountButton();
  closeAccountModal();
  refreshAutoSyncTimer();
});

// ---------- FeldFolio Plus: Automatische Cloud-Synchronisation ----------
// Speichert den aktuellen Arbeitsstand periodisch im Hintergrund über
// saveFullState() (siehe weiter unten), statt dass man nach jeder Änderung
// selbst an "Cloud speichern" denken muss — über den Sync-Schalter in der
// Kopfzeile ein-/ausschaltbar, die Einstellung bleibt per localStorage über
// ein Neuladen hinweg erhalten. Läuft nur, wenn sowohl der Schalter an ist
// als auch eine Anmeldung besteht (refreshAutoSyncTimer() wird darum bei
// jeder An-/Abmeldung erneut aufgerufen, siehe oben).
const AUTO_SYNC_STORAGE_KEY = 'feldfolio-autosync';
const AUTO_SYNC_INTERVAL_MS = 30000;
let autoSyncEnabled = true;
try {
  const savedAutoSync = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
  if (savedAutoSync !== null) autoSyncEnabled = savedAutoSync === 'true';
} catch {}
let autoSyncTimer = null;
const btnSync = document.getElementById('btn-sync');

function updateSyncButton() {
  btnSync.classList.toggle('active', autoSyncEnabled);
  btnSync.setAttribute('aria-checked', String(autoSyncEnabled));
  updateSyncIndicator();
}

// Gespeichert wird immer lokal (siehe persistLocalState()), der Schalter
// steuert nur den automatischen Abgleich mit der Cloud.
async function runAutoSync() {
  if (!autoSyncEnabled || !isSupabaseConfigured || !accountSession) return;
  await syncWithCloud();
}

function refreshAutoSyncTimer() {
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
  updateSyncButton();
  if (autoSyncEnabled && isSupabaseConfigured && accountSession) {
    autoSyncTimer = setInterval(runAutoSync, AUTO_SYNC_INTERVAL_MS);
  }
}

btnSync.addEventListener('click', () => {
  autoSyncEnabled = !autoSyncEnabled;
  try { localStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(autoSyncEnabled)); } catch {}
  refreshAutoSyncTimer();
});

// Sofort synchronisieren, sobald der Tab in den Hintergrund wechselt (App-
// Wechsel, Bildschirm sperren, …) statt bis zum nächsten Intervall-Tick zu
// warten — das ist der Moment, in dem ungespeicherte Änderungen am ehesten
// verloren gehen könnten, z.B. weil der Tab danach ganz geschlossen wird.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  persistLocalState();
  runAutoSync();
});

updateSyncButton();

// ---------- FeldFolio Plus: Pro-Betrieb getrennte Arbeitsstände ----------
// Ebenen/Flächenzeichner/Obstbaumkataster/Bienenflugkarte gehören zu genau
// einem "Arbeitsstand" (Workspace) — identifiziert über den Betriebsnamen aus
// der Betrieb-Zuordnung (siehe weiter unten), oder NO_BETRIEB_KEY, solange
// kein Betrieb ausgewählt ist. Terminkalender-Termine und die Betriebsliste
// selbst (manualBetriebe) sind bewusst NICHT Teil eines Workspace, sondern
// gelten immer betriebsübergreifend ("shared"). In der Cloud liegt weiterhin
// nur EIN JSON-Blob pro Nutzer (keine neue Tabelle/Migration nötig) — die
// Blob-Form ist jetzt { workspaces: { [betrieb]: {...} }, terminkalenderEvents,
// manualBetriebe } statt der früheren flachen Form.
const NO_BETRIEB_KEY = '__kein_betrieb__';
let currentWorkspaceKey = NO_BETRIEB_KEY;

// Ältere gespeicherte Stände kennen noch die flache Form (layers/obstbaumTrees/
// bienenflugPoints direkt auf oberster Ebene, kein workspaces-Feld) — hier
// einmalig in den "kein Betrieb"-Workspace übernehmen, statt sie beim ersten
// Laden nach diesem Umbau kommentarlos verschwinden zu lassen.
function migrateFullStateShape(full) {
  if (!full.workspaces || typeof full.workspaces !== 'object') {
    full.workspaces = {};
    if (full.layers || full.obstbaumTrees || full.bienenflugPoints) {
      full.workspaces[NO_BETRIEB_KEY] = {
        layers: full.layers || [],
        obstbaumTrees: full.obstbaumTrees || [],
        bienenflugPoints: full.bienenflugPoints || []
      };
    }
  }
  return full;
}

// Nur der Teil des Arbeitsstands, der zu einem einzelnen Betrieb gehört —
// geteilte Ebenen als GeoJSON (identisch zur Upload-Form), Bäume/Bienenstöcke
// als einfache Punktlisten. Notiz/Fotos an Flächen stecken bereits in
// l.geojson (siehe setParcelNotes/addParcelPhoto — schreiben direkt in die
// geteilte properties-Objektreferenz), reisen hier also automatisch mit.
function serializeWorkspace() {
  return {
    layers: Object.values(layers).map(l => ({ name: l.name, geojson: l.geojson })),
    obstbaumTrees: obstbaumTrees.map(t => ({ art: t.art, lat: t.latlng.lat, lng: t.latlng.lng, notes: t.notes, photos: t.photos })),
    bienenflugPoints: bienenflugPoints.map(p => ({ name: p.name, lat: p.latlng.lat, lng: p.latlng.lng })),
    hofplanShapes: hofplanShapes.map(s => ({ kategorie: s.kategorie, name: s.name, color: s.color, stallplanId: s.stallplanId || null, geometry: s.leafletLayer.toGeoJSON().geometry })),
    stallplaene: stallplaene.map(p => structuredClone(p))
  };
}

// Rekonstruiert einen Workspace über exakt dieselben Funktionen, die auch
// beim normalen Datei-Upload/Kartenklick laufen (addLayer/addTree/addBeehive)
// — kein separater Rekonstruktions-Code-Pfad nötig. Ebenen zuerst, damit
// addTree() die Flächen-Zuordnung sofort korrekt berechnen kann.
function restoreWorkspace(data) {
  if (!data) return;
  (data.layers || []).forEach(l => addLayer(l.name, l.geojson));
  if ((data.obstbaumTrees || []).length) {
    initObstbaumMap();
    data.obstbaumTrees.forEach(t => {
      const entry = addTree(t.art, L.latLng(t.lat, t.lng));
      entry.notes = t.notes || '';
      entry.photos = Array.isArray(t.photos) ? t.photos.map(normalizePhotoEntry) : [];
    });
    renderObstbaumTable();
  }
  if ((data.bienenflugPoints || []).length) {
    initBienenflugMap();
    data.bienenflugPoints.forEach(p => {
      const entry = addBeehive(L.latLng(p.lat, p.lng));
      if (p.name) {
        entry.name = p.name;
        entry.marker.setTooltipContent(beehiveLabel(entry));
        renderBienenflugList();
      }
    });
  }
  if ((data.hofplanShapes || []).length) {
    initHofplanMap();
    data.hofplanShapes.forEach(s => {
      const layer = L.geoJSON({ type: 'Feature', geometry: s.geometry, properties: {} }).getLayers()[0];
      addHofplanShapeFromLayer(layer, s.kategorie || '', s.name || '', undefined, s.color || null, s.stallplanId || null);
    });
    renderHofplanList();
  }
  if ((data.stallplaene || []).length) {
    stallplaene = data.stallplaene.map(p => {
      const plan = structuredClone(p);
      plan.compartments = (plan.compartments || []).map(normalizeCompartment);
      plan.equipment = (plan.equipment || []).map(normalizeEquipment);
      return plan;
    });
    resetStallplanerInteraction();
    activeStallplanId = stallplaene[0].id;
    stallplanerStep = stallplaene[0].outline ? 'abteile' : 'umriss';
    stallplanerUndoStack = [];
    stallplanerRedoStack = [];
    resetStallplanerViewBox();
    renderStallplanerPlanPicker();
    renderStallplanerSidebar();
    renderStallplan();
  }
}

// Entfernt den kompletten aktuell geladenen Workspace-Inhalt von der Karte —
// über dieselben Einzel-Entfern-Funktionen wie ein manuelles Löschen, damit
// keine zweite Aufräum-Logik gepflegt werden muss. Flächenzeichner-Buchführung
// (zeichnerLayerId/zeichnerParcels/…) kennt removeLayer() nicht, da gezeichnete
// Flächen nur eine weitere ganz normale Ebene sind — daher hier separat
// zurückgesetzt.
function clearAllLayers() {
  Object.keys(layers).forEach(id => removeLayer(id));
  zeichnerLayerId = null;
  zeichnerParcels.length = 0;
  zeichnerColorIdx = 0;
  shapeEditingEntryId = null;
  renderParcelList();
}
function clearAllTrees() {
  while (obstbaumTrees.length) removeTree(obstbaumTrees[0].id);
}
function clearAllBeehives() {
  while (bienenflugPoints.length) removeBeehive(bienenflugPoints[0].id);
}
function clearAllHofplanShapes() {
  while (hofplanShapes.length) removeHofplanShapeEverywhere(hofplanShapes[0]);
}
function clearAllStallplaene() {
  resetStallplanerInteraction();
  stallplaene = [];
  activeStallplanId = null;
  stallplanerStep = 'umriss';
  stallplanerUndoStack = [];
  stallplanerRedoStack = [];
  resetStallplanerViewBox();
  renderStallplanerPlanPicker();
  renderStallplanerSidebar();
  renderStallplan();
}
function clearWorkspace() {
  clearAllLayers();
  clearAllTrees();
  clearAllBeehives();
  clearAllHofplanShapes();
  clearAllStallplaene();
}

// terminkalenderEvents/manualBetriebe gelten immer betriebsübergreifend,
// werden also unabhängig vom aktuellen Workspace wiederhergestellt.
function restoreSharedState(full) {
  if ((full.terminkalenderEvents || []).length) {
    terminkalenderEvents = full.terminkalenderEvents.map(e => ({
      ...e, date: new Date(e.date), dateEnd: e.dateEnd ? new Date(e.dateEnd) : null,
      attachments: Array.isArray(e.attachments) ? e.attachments : [],
      probenprotokolle: Array.isArray(e.probenprotokolle) ? e.probenprotokolle : [],
      crossChecks: Array.isArray(e.crossChecks) ? e.crossChecks : []
    }));
    renderTerminkalenderSummary();
    renderTerminkalenderGrid();
  }
  manualBetriebe = Array.isArray(full.manualBetriebe) ? full.manualBetriebe : [];
}

// Explizites Speichern (Notizen, Termine, Betriebsliste, …): immer zuerst
// lokal, dann Abgleich mit der Cloud. Ohne Netz ist das kein Fehler — die
// Änderung ist lokal sicher und wird später hochgeladen; nur echte
// Server-Fehler werden an den Aufrufer weitergereicht.
async function saveFullState() {
  await persistLocalState();
  const result = await syncWithCloud();
  if (result === 'error') throw new Error(syncErrorMessage || 'Synchronisation fehlgeschlagen.');
}

// Wechselt den aktiven Workspace — funktioniert auch offline: der bisherige
// Stand wird lokal gesichert, der Ziel-Betrieb aus dem lokalen Stand geladen.
// Mit Netz wird vorher abgeglichen, damit der Ziel-Betrieb aktuell ist.
async function switchWorkspace(oldKey, newKey) {
  if (!offlineRec) throw new Error('Nicht angemeldet.');
  await persistLocalState();
  if (navigator.onLine) await syncWithCloud();
  clearWorkspace();
  currentWorkspaceKey = newKey;
  restoreWorkspace(offlineRec.full.workspaces[newKey]);
  rebaselineLocalState();
}

// Prüft den aktuell GELADENEN (In-Memory-)Workspace auf Inhalt — anders als
// ein leeres serialisiertes Workspace-Objekt zu prüfen, da hier der gerade
// sichtbare Stand gemeint ist, bevor er überhaupt gespeichert wurde.
function currentWorkspaceHasContent() {
  return !!(Object.keys(layers).length || obstbaumTrees.length || bienenflugPoints.length || hofplanShapes.length || stallplaene.length);
}

// Hängt die vier Bestandslisten zweier serialisierter Workspaces aneinander
// (Ziel-Betrieb zuerst) — für "Inhalte ohne Betrieb einem Betrieb
// zuordnen": bestehender Inhalt des Ziel-Betriebs bleibt erhalten, die
// verschobenen Inhalte kommen dazu, statt ihn zu überschreiben.
function mergeWorkspaces(target, moved) {
  return {
    layers: [...(target.layers || []), ...(moved.layers || [])],
    obstbaumTrees: [...(target.obstbaumTrees || []), ...(moved.obstbaumTrees || [])],
    bienenflugPoints: [...(target.bienenflugPoints || []), ...(moved.bienenflugPoints || [])],
    hofplanShapes: [...(target.hofplanShapes || []), ...(moved.hofplanShapes || [])],
    stallplaene: [...(target.stallplaene || []), ...(moved.stallplaene || [])]
  };
}

// Verschiebt den aktuell geladenen "Kein Betrieb"-Workspace in einen echten
// Betrieb, statt ihn beim nächsten Wechsel nur unverändert in seinem eigenen
// Slot zu belassen (das macht switchWorkspace() bereits automatisch, lässt
// die Inhalte aber dauerhaft von den echten Betrieben getrennt). Ablauf wie
// switchWorkspace(), nur dass der NO_BETRIEB-Stand in den Ziel-Workspace
// EINGEMISCHT statt nur zurückgeschrieben wird, und der NO_BETRIEB-Slot
// danach leer ist.
async function assignNoBetriebContentTo(z) {
  if (!offlineRec) throw new Error('Nicht angemeldet.');
  await persistLocalState();
  if (navigator.onLine) await syncWithCloud();
  const rec = offlineRec;
  const movedContent = serializeWorkspace();
  rec.full.workspaces[z.betrieb] = mergeWorkspaces(rec.full.workspaces[z.betrieb] || {}, movedContent);
  rec.full.workspaces[NO_BETRIEB_KEY] = {};
  rec.gen++;
  rec.dirtyGen[z.betrieb] = rec.gen;
  rec.dirtyGen[NO_BETRIEB_KEY] = rec.gen;
  clearWorkspace();
  currentWorkspaceKey = z.betrieb;
  restoreWorkspace(rec.full.workspaces[z.betrieb]);
  setActiveZuordnung(z);
  rebaselineLocalState();
  await writeLocalState(currentUserId(), rec).catch(() => {});
  syncWithCloud();
}

// ---------- FeldFolio Plus: Offline-Betrieb (lokal speichern + nachsynchronisieren) ----------
// Im Stall gibt es oft keinen Empfang. Deshalb gilt: jede Änderung landet
// zuerst lokal (IndexedDB, siehe offline-store.js), die Cloud wird danach
// abgeglichen, sobald Netz da ist. Hochgeladen werden nur die seit dem
// letzten Abgleich lokal geänderten Betriebe (dirtyGen) bzw. Termine/
// Betriebsliste (sharedDirtyGen). Ein Konflikt liegt nur vor, wenn genau
// dieser Betrieb seit dem letzten Abgleich AUCH in der Cloud geändert wurde
// (Vergleich mit "base") — zwei gleichzeitig offene Geräte, die an
// verschiedenen Betrieben arbeiten, stören sich damit nicht.
// (Zustand des Offline-Abgleichs steht weiter oben bei accountSession —
// updateSyncButton() läuft schon beim Laden des Moduls.)

function currentUserId() {
  return accountSession && accountSession.user ? accountSession.user.id : null;
}
function emptyFullState() {
  return { workspaces: {}, terminkalenderEvents: [], manualBetriebe: [] };
}
function newOfflineRecord(user) {
  return { full: emptyFullState(), base: null, baseUpdatedAt: null, gen: 0, dirtyGen: {}, sharedDirtyGen: 0, zuordnung: null, user };
}
function serializeSharedState() {
  return {
    terminkalenderEvents: terminkalenderEvents.map(e => ({
      ...e, date: e.date.toISOString(), dateEnd: e.dateEnd ? e.dateEnd.toISOString() : null
    })),
    manualBetriebe: manualBetriebe.slice()
  };
}
// Ein leerer Workspace (alle Listen leer) zählt wie ein fehlender — sonst
// würde schon das bloße Öffnen eines Betriebs als Änderung gelten.
function workspaceKeyJson(ws) {
  if (!ws || Object.values(ws).every(v => Array.isArray(v) && v.length === 0)) return 'EMPTY';
  return JSON.stringify(ws);
}
function sharedKeyJson(full) {
  return JSON.stringify({ t: (full && full.terminkalenderEvents) || [], m: (full && full.manualBetriebe) || [] });
}
// Vergleich Cloud <-> lokale Basis unabhängig von der Schlüssel-Reihenfolge:
// Supabase speichert den Stand als Postgres-jsonb, und jsonb sortiert die
// Objekt-Schlüssel beim Speichern um. Derselbe Inhalt kommt also in anderer
// Reihenfolge zurück — ein reiner JSON.stringify-Vergleich hielt das für
// eine Änderung auf einem anderen Gerät und fragte bei jedem Abgleich nach.
function canonicalJson(value) {
  return JSON.stringify(value, (key, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted = {};
    Object.keys(v).sort().forEach(k => { sorted[k] = v[k]; });
    return sorted;
  });
}
function sameWorkspace(a, b) {
  const empty = (ws) => !ws || Object.values(ws).every(v => Array.isArray(v) && v.length === 0);
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  return canonicalJson(a) === canonicalJson(b);
}
function sameShared(a, b) {
  return canonicalJson({ t: (a && a.terminkalenderEvents) || [], m: (a && a.manualBetriebe) || [] }) ===
    canonicalJson({ t: (b && b.terminkalenderEvents) || [], m: (b && b.manualBetriebe) || [] });
}
function hasPendingLocalChanges() {
  return !!offlineRec && (Object.keys(offlineRec.dirtyGen).length > 0 || offlineRec.sharedDirtyGen > 0);
}
function isNetworkError(err) {
  if (!navigator.onLine) return true;
  const msg = String((err && (err.message || err)) || '');
  return /Failed to fetch|NetworkError|Load failed|network|fetch/i.test(msg);
}

// Nach jedem Wiederherstellen in den Speicher (Start, Betrieb-Wechsel,
// Konfliktlösung): den gerade sichtbaren Stand als Vergleichsbasis merken,
// OHNE ihn als lokale Änderung zu markieren — die serialisierte Form weicht
// nach einem Laden oft minimal vom gespeicherten Blob ab (Feldreihenfolge,
// normalisierte Felder), das darf keinen Scheinkonflikt auslösen.
function rebaselineLocalState() {
  if (!offlineRec) return;
  const ws = serializeWorkspace();
  const shared = serializeSharedState();
  persistCache = { key: currentWorkspaceKey, ws: workspaceKeyJson(ws), shared: sharedKeyJson(shared) };
  if (persistCache.ws !== 'EMPTY' || offlineRec.full.workspaces[currentWorkspaceKey]) offlineRec.full.workspaces[currentWorkspaceKey] = ws;
  offlineRec.full.terminkalenderEvents = shared.terminkalenderEvents;
  offlineRec.full.manualBetriebe = shared.manualBetriebe;
}

// Schreibt den aktuellen Stand lokal weg, falls sich etwas geändert hat —
// läuft alle 10 s, beim Verlassen/Verstecken der Seite und vor jedem
// Cloud-Abgleich, unabhängig davon, ob gerade Netz da ist.
async function persistLocalState() {
  const userId = currentUserId();
  if (!userId || !offlineRec) return false;
  const rec = offlineRec;
  let changed = false;
  const ws = serializeWorkspace();
  const wsJson = workspaceKeyJson(ws);
  if (persistCache.key !== currentWorkspaceKey) {
    persistCache = { key: currentWorkspaceKey, ws: workspaceKeyJson(rec.full.workspaces[currentWorkspaceKey]), shared: persistCache.shared };
  }
  if (wsJson !== persistCache.ws) {
    rec.gen++;
    rec.full.workspaces[currentWorkspaceKey] = ws;
    rec.dirtyGen[currentWorkspaceKey] = rec.gen;
    persistCache.ws = wsJson;
    changed = true;
  }
  const shared = serializeSharedState();
  const sharedJson = sharedKeyJson(shared);
  if (persistCache.shared === null) persistCache.shared = sharedKeyJson(rec.full);
  if (sharedJson !== persistCache.shared) {
    rec.gen++;
    rec.full.terminkalenderEvents = shared.terminkalenderEvents;
    rec.full.manualBetriebe = shared.manualBetriebe;
    rec.sharedDirtyGen = rec.gen;
    persistCache.shared = sharedJson;
    changed = true;
  }
  const z = activeZuordnung ? { ...activeZuordnung } : null;
  if (JSON.stringify(rec.zuordnung || null) !== JSON.stringify(z)) {
    rec.zuordnung = z;
    changed = true;
  }
  if (changed) {
    try {
      await writeLocalState(userId, rec);
    } catch (err) {
      syncErrorMessage = 'Lokales Speichern fehlgeschlagen: ' + (err.message || err);
      syncState = 'error';
    }
  }
  updateSyncIndicator();
  return changed;
}

// Gleicht mit der Cloud ab (nur eine Runde gleichzeitig, weitere Aufrufe
// während einer laufenden Runde werden zu genau einer Folgerunde gebündelt).
function syncWithCloud() {
  if (syncPromise) { syncQueued = true; return syncPromise; }
  syncPromise = (async () => {
    try {
      return await runCloudSync();
    } finally {
      syncPromise = null;
      if (syncQueued) { syncQueued = false; syncWithCloud(); }
    }
  })();
  return syncPromise;
}

async function runCloudSync() {
  const userId = currentUserId();
  if (!userId || !offlineRec) return 'no-user';
  await persistLocalState();
  const cloudAvailable = isSupabaseConfigured || (import.meta.env.DEV && !!window.__ffTestCloud);
  if (!cloudAvailable || !navigator.onLine || accountSession.offline) {
    syncState = 'offline';
    updateSyncIndicator();
    return 'offline';
  }
  syncState = 'syncing';
  updateSyncIndicator();
  const rec = offlineRec;
  const genAtStart = rec.gen;
  let row;
  try {
    row = await loadState();
  } catch (err) {
    return failSync(err);
  }
  const cloud = migrateFullStateShape(row && row.data ? row.data : {});
  cloud.terminkalenderEvents = cloud.terminkalenderEvents || [];
  cloud.manualBetriebe = cloud.manualBetriebe || [];
  const base = rec.base;
  const dirtyKeys = Object.keys(rec.dirtyGen);
  const sharedDirty = rec.sharedDirtyGen > 0;
  const conflictKeys = base ? dirtyKeys.filter(k => !sameWorkspace(cloud.workspaces[k], base.workspaces[k])) : [];
  const sharedConflict = !!base && sharedDirty && !sameShared(cloud, base);

  let keepMine = true;
  if (conflictKeys.length || sharedConflict) {
    keepMine = await askSyncConflict(conflictKeys, sharedConflict);
    try {
      await addBackup(userId, keepMine ? 'Cloud-Stand vor dem Überschreiben' : 'Lokaler Stand vor dem Verwerfen', keepMine ? cloud : rec.full);
    } catch {}
  }

  const merged = structuredClone(cloud);
  const pushedKeys = [];
  dirtyKeys.forEach(k => {
    if (!keepMine && conflictKeys.includes(k)) return;
    merged.workspaces[k] = rec.full.workspaces[k] || {};
    pushedKeys.push(k);
  });
  const pushShared = sharedDirty && (keepMine || !sharedConflict);
  if (pushShared) {
    merged.terminkalenderEvents = rec.full.terminkalenderEvents;
    merged.manualBetriebe = rec.full.manualBetriebe;
  }

  let updatedAt = row ? row.updated_at : null;
  if (pushedKeys.length || pushShared) {
    try {
      updatedAt = await saveState(merged);
    } catch (err) {
      return failSync(err);
    }
  }

  // Lokalen Datensatz nachziehen. Änderungen, die WÄHREND des Abgleichs
  // passiert sind (gen > genAtStart), bleiben als "noch offen" markiert.
  const theirsKeys = keepMine ? [] : conflictKeys;
  const newBase = structuredClone(merged);
  Object.keys(merged.workspaces).forEach(k => {
    const stillDirty = rec.dirtyGen[k] > genAtStart;
    if (k === currentWorkspaceKey && !(k in rec.dirtyGen) && !theirsKeys.includes(k) &&
        !sameWorkspace(merged.workspaces[k], base ? base.workspaces[k] : rec.full.workspaces[k])) {
      // Der gerade geöffnete Betrieb wurde anderswo geändert, hier aber nicht:
      // nicht mitten in der Arbeit austauschen. Basis bleibt die alte — eine
      // spätere lokale Änderung führt dadurch zur Konfliktfrage statt das
      // andere Gerät still zu überschreiben.
      if (base) newBase.workspaces[k] = base.workspaces[k];
      else delete newBase.workspaces[k];
      return;
    }
    if (!stillDirty) rec.full.workspaces[k] = merged.workspaces[k];
  });
  pushedKeys.concat(theirsKeys).forEach(k => { if (!(rec.dirtyGen[k] > genAtStart)) delete rec.dirtyGen[k]; });
  if (!(rec.sharedDirtyGen > genAtStart)) {
    if (pushShared || (sharedConflict && !keepMine)) rec.sharedDirtyGen = 0;
    if (!rec.sharedDirtyGen && (sharedConflict && !keepMine)) {
      rec.full.terminkalenderEvents = merged.terminkalenderEvents;
      rec.full.manualBetriebe = merged.manualBetriebe;
    }
  }
  if (!sharedDirty && !sameShared(merged, base || rec.full)) {
    // Termine/Betriebe anderswo geändert, hier nicht — wie beim offenen
    // Betrieb: Basis nicht vorziehen (siehe oben).
    newBase.terminkalenderEvents = base ? base.terminkalenderEvents : rec.full.terminkalenderEvents;
    newBase.manualBetriebe = base ? base.manualBetriebe : rec.full.manualBetriebe;
  }
  rec.base = newBase;
  rec.baseUpdatedAt = updatedAt;
  await writeLocalState(userId, rec).catch(() => {});

  // "Andere Version übernehmen" für den offenen Betrieb bzw. die Termine:
  // jetzt auch sichtbar machen.
  if (theirsKeys.includes(currentWorkspaceKey)) {
    clearWorkspace();
    restoreWorkspace(merged.workspaces[currentWorkspaceKey]);
  }
  if (sharedConflict && !keepMine) restoreSharedState(merged);
  if (theirsKeys.includes(currentWorkspaceKey) || (sharedConflict && !keepMine)) rebaselineLocalState();

  syncState = 'idle';
  syncErrorMessage = '';
  lastSyncedAt = new Date();
  updateSyncIndicator();
  return 'synced';
}

function failSync(err) {
  syncState = isNetworkError(err) ? 'offline' : 'error';
  syncErrorMessage = err && err.message ? err.message : String(err || 'Synchronisation fehlgeschlagen.');
  updateSyncIndicator();
  return syncState;
}

// Dialog statt confirm(), weil die beiden Möglichkeiten klar benannte
// Buttons brauchen ("OK/Abbrechen" wäre hier missverständlich).
function askSyncConflict(keys, sharedConflict) {
  const overlay = document.getElementById('sync-conflict-overlay');
  const names = keys.map(k => (k === NO_BETRIEB_KEY ? 'Inhalte ohne Betrieb' : k));
  if (sharedConflict) names.push('Termine / Betriebsliste');
  document.getElementById('sync-conflict-list').innerHTML = names.map(n => `<li>${escapeHtml(n)}</li>`).join('');
  overlay.hidden = false;
  return new Promise(resolve => {
    const done = (keepMine) => {
      overlay.hidden = true;
      mineBtn.removeEventListener('click', onMine);
      theirsBtn.removeEventListener('click', onTheirs);
      resolve(keepMine);
    };
    const mineBtn = document.getElementById('sync-conflict-keep-mine');
    const theirsBtn = document.getElementById('sync-conflict-take-theirs');
    const onMine = () => done(true);
    const onTheirs = () => done(false);
    mineBtn.addEventListener('click', onMine);
    theirsBtn.addEventListener('click', onTheirs);
  });
}

function updateSyncIndicator() {
  const pending = hasPendingLocalChanges();
  const offline = !navigator.onLine || syncState === 'offline' || !!(accountSession && accountSession.offline);
  btnSync.classList.toggle('is-offline', !!accountSession && offline);
  btnSync.classList.toggle('has-pending', !!accountSession && pending);
  btnSync.classList.toggle('sync-error', !!accountSession && syncState === 'error');
  btnSync.classList.toggle('syncing', syncState === 'syncing');
  const label = btnSync.querySelector('.sync-toggle-label');
  if (label) label.textContent = accountSession && offline ? 'Offline' : 'Sync';
  let title;
  if (!accountSession) {
    title = autoSyncEnabled ? 'Automatische Cloud-Synchronisation: an (wird erst nach der Anmeldung aktiv)' : 'Automatische Cloud-Synchronisation: aus';
  } else if (offline) {
    title = pending
      ? 'Offline — Änderungen sind auf diesem Gerät gespeichert und werden hochgeladen, sobald wieder Internet da ist.'
      : 'Offline — alles ist auf diesem Gerät gespeichert.';
  } else if (syncState === 'error') {
    title = 'Synchronisation fehlgeschlagen: ' + syncErrorMessage + (pending ? ' — Änderungen sind lokal gesichert.' : '');
  } else if (!autoSyncEnabled) {
    title = 'Automatische Cloud-Synchronisation: aus' + (pending ? ' — Änderungen nur auf diesem Gerät gespeichert.' : '');
  } else if (pending) {
    title = 'Änderungen noch nicht in der Cloud — werden gleich hochgeladen.';
  } else {
    title = 'Automatische Cloud-Synchronisation: an' + (lastSyncedAt ? ` — zuletzt synchronisiert um ${lastSyncedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : '');
  }
  btnSync.title = title;
  btnSync.setAttribute('aria-label', title);
  document.body.classList.toggle('is-offline', !navigator.onLine);
}

// Lädt den lokalen Stand in die Oberfläche — funktioniert ohne Netz.
function restoreFromOfflineRecord() {
  const rec = offlineRec;
  restoreSharedState(rec.full);
  currentWorkspaceKey = rec.zuordnung ? rec.zuordnung.betrieb : NO_BETRIEB_KEY;
  clearWorkspace();
  restoreWorkspace(rec.full.workspaces[currentWorkspaceKey]);
  setActiveZuordnung(rec.zuordnung ? { ...rec.zuordnung } : null);
  rebaselineLocalState();
}

// Start mit einem (ggf. nur lokal bekannten) Nutzer: erst den lokalen Stand
// zeigen (sofort, auch ohne Netz), dann — falls online — mit der Cloud
// abgleichen.
async function startUserState(user) {
  try { await writeLastUser({ id: user.id, email: user.email }); } catch {}
  let rec = null;
  try { rec = await readLocalState(user.id); } catch {}
  if (rec) {
    offlineRec = { ...newOfflineRecord(user), ...rec, user: { id: user.id, email: user.email } };
    restoreFromOfflineRecord();
  } else {
    offlineRec = newOfflineRecord({ id: user.id, email: user.email });
    rebaselineLocalState();
  }
  updateSyncIndicator();
  if (accountSession && !accountSession.offline && navigator.onLine) await initialCloudLoad(!rec);
}

async function initialCloudLoad(firstOnThisDevice) {
  if (!firstOnThisDevice && hasPendingLocalChanges()) {
    // Offline-Änderungen vom letzten Mal: hochladen bzw. Konflikt klären.
    await syncWithCloud();
    return;
  }
  let row;
  try {
    row = await loadState();
  } catch (err) {
    failSync(err);
    accountSyncStatus.textContent = 'Fehler: ' + (err.message || 'Laden fehlgeschlagen.');
    return;
  }
  const userId = currentUserId();
  if (!row) {
    // Noch nie in der Cloud gespeichert: der lokale Stand ist der Anfang.
    offlineRec.base = null;
    return;
  }
  const cloud = migrateFullStateShape(row.data);
  cloud.terminkalenderEvents = cloud.terminkalenderEvents || [];
  cloud.manualBetriebe = cloud.manualBetriebe || [];
  offlineRec.full = structuredClone(cloud);
  offlineRec.base = cloud;
  offlineRec.baseUpdatedAt = row.updated_at;
  offlineRec.dirtyGen = {};
  offlineRec.sharedDirtyGen = 0;
  restoreSharedState(offlineRec.full);
  clearWorkspace();
  restoreWorkspace(offlineRec.full.workspaces[currentWorkspaceKey]);
  rebaselineLocalState();
  await writeLocalState(userId, offlineRec).catch(() => {});
  syncState = 'idle';
  lastSyncedAt = new Date();
  accountSyncStatus.textContent = 'Geladen.';
  updateSyncIndicator();
}

async function initAccountAndState() {
  if (!isSupabaseConfigured) return;
  let session = null;
  try { session = await getSession(); } catch {}
  if (!session) {
    // Ohne Netz lässt sich eine abgelaufene Session nicht erneuern — dann mit
    // dem zuletzt angemeldeten Nutzer und seinem lokalen Stand weiterarbeiten,
    // der Abgleich folgt, sobald wieder Internet da ist.
    const last = await readLastUser();
    if (last && !navigator.onLine) {
      let rec = null;
      try { rec = await readLocalState(last.id); } catch {}
      if (rec) session = { user: last, offline: true };
    }
  }
  accountSession = session;
  updateAccountButton();
  if (session) await startUserState(session.user);
  refreshAutoSyncTimer();
}

window.addEventListener('online', async () => {
  updateSyncIndicator();
  if (accountSession && accountSession.offline) {
    // Offline gestartet: jetzt die echte Session holen.
    let session = null;
    try { session = await getSession(); } catch {}
    if (!session || session.user.id !== accountSession.user.id) { updateSyncIndicator(); return; }
    accountSession = session;
    updateAccountButton();
    refreshAutoSyncTimer();
  }
  if (accountSession) syncWithCloud();
});
window.addEventListener('offline', updateSyncIndicator);
window.addEventListener('pagehide', () => { persistLocalState(); });
setInterval(() => { if (!document.hidden) persistLocalState(); }, LOCAL_SAVE_INTERVAL_MS);

if (import.meta.env.DEV) {
  // Testhaken für die Offline-Logik (Cloud per window.__ffTestCloud in
  // supabase.js gestubbt, analog window.__ffTestUploadPhotoOverride).
  window.__ffTestOffline = {
    start: (user) => startUserState(user),
    persist: () => persistLocalState(),
    sync: () => syncWithCloud(),
    record: () => (offlineRec ? structuredClone(offlineRec) : null),
    readStored: (userId) => readLocalState(userId),
    pending: () => hasPendingLocalChanges(),
    currentWorkspaceKey: () => currentWorkspaceKey,
    // Neustart der App nachstellen (gleicher Ablauf wie beim Seitenaufruf).
    boot: () => initAccountAndState(),
    // In-Memory-Stand verwerfen (wie beim Schließen der App).
    clear: () => { clearWorkspace(); setActiveZuordnung(null); currentWorkspaceKey = NO_BETRIEB_KEY; },
    // Betrieb wechseln wie über den Betrieb-Dialog.
    switchTo: (betrieb) => applyZuordnungSelection(betrieb ? { betrieb, year: new Date().getFullYear(), terminId: null, terminLabel: null } : null),
    backups: (userId) => listBackups(userId)
  };
}

// ---------- FeldFolio Plus: Notiz & Fotos an Fläche/Baum ----------
// Wie der Cloud-Konto-Bereich rein additiv und komplett hinter dem Login —
// ohne Session zeigt das Modal denselben "bitte anmelden"-Hinweis wie der
// Account-Bereich, statt zu crashen oder still nichts zu tun.
const notesModal = document.getElementById('notes-modal-overlay');
const notesNotConfigured = document.getElementById('notes-not-configured');
const notesEditor = document.getElementById('notes-editor');
const notesTextarea = document.getElementById('notes-textarea');
const notesPhotoGrid = document.getElementById('notes-photo-grid');
const notesPhotoInput = document.getElementById('notes-photo-input');
const notesError = document.getElementById('notes-error');
const notesSyncStatus = document.getElementById('notes-sync-status');
let notesTarget = null; // { kind: 'parcel'|'tree', entry }

function showNotesError(msg) {
  notesError.textContent = msg;
  notesError.hidden = !msg;
}

// entry.photos ist {path, name}[] — Anzeige braucht pro Bild eine frisch
// geholte Signed URL (Bucket ist privat, siehe supabase.js); name (falls
// vorhanden) setzt darüber den Jahr_Betrieb_Art-Downloadnamen.
async function renderNotesPhotoGrid() {
  const photos = notesTarget.entry.photos;
  if (!photos.length) { notesPhotoGrid.innerHTML = ''; return; }
  notesPhotoGrid.innerHTML = photos.map(() => '<div class="notes-photo-thumb notes-photo-loading"></div>').join('');
  const urls = await Promise.all(photos.map(p => getPhotoUrl(p.path, p.name).catch(() => null)));
  notesPhotoGrid.innerHTML = photos.map((p, i) => urls[i]
    ? `<div class="notes-photo-thumb"><img src="${urls[i]}" alt=""><button type="button" class="notes-photo-remove" data-path="${escapeHtml(p.path)}" title="Foto löschen"><span class="material-symbols-rounded icon">close</span></button></div>`
    : '<div class="notes-photo-thumb notes-photo-error" title="Foto konnte nicht geladen werden"><span class="material-symbols-rounded icon">warning</span></div>'
  ).join('');
  notesPhotoGrid.querySelectorAll('.notes-photo-remove').forEach(btn => {
    btn.addEventListener('click', () => removeNotesPhoto(btn.getAttribute('data-path')));
  });
}

function openNotesModal(kind, entry) {
  notesTarget = { kind, entry };
  showNotesError('');
  notesSyncStatus.textContent = '';
  const loggedIn = isSupabaseConfigured && !!accountSession;
  notesNotConfigured.hidden = loggedIn;
  notesEditor.hidden = !loggedIn;
  if (loggedIn) {
    notesTextarea.value = entry.notes || '';
    renderNotesPhotoGrid();
  }
  notesModal.hidden = false;
}

function closeNotesModal() { notesModal.hidden = true; notesTarget = null; }

['notes-modal-close-1', 'notes-modal-close-2'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeNotesModal);
});
notesModal.addEventListener('click', (e) => { if (e.target === notesModal) closeNotesModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !notesModal.hidden) closeNotesModal(); });

// Aktualisiert Tabellenzeile + Notiz-Icon nach jeder Änderung, ohne die
// ganze Tabelle (und damit die Scroll-Position/Auswahl) neu aufzubauen.
function refreshNotesIndicator() {
  if (notesTarget.kind === 'parcel') renderFeatureTable();
  else renderObstbaumTable();
}

document.getElementById('notes-btn-save').addEventListener('click', async () => {
  const { kind, entry } = notesTarget;
  const text = notesTextarea.value;
  if (kind === 'parcel') setParcelNotes(entry, text); else entry.notes = text;
  refreshNotesIndicator();
  notesSyncStatus.textContent = 'Speichere …';
  try {
    await saveFullState();
    notesSyncStatus.textContent = 'Gespeichert.';
  } catch (err) {
    notesSyncStatus.textContent = 'Fehler: ' + (err.message || 'Speichern fehlgeschlagen.');
  }
});

notesPhotoInput.addEventListener('change', async () => {
  const file = notesPhotoInput.files[0];
  notesPhotoInput.value = '';
  if (!file) return;
  const { kind, entry } = notesTarget;
  showNotesError('');
  notesSyncStatus.textContent = 'Foto wird hochgeladen …';
  try {
    const path = await uploadPhoto(file);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const name = zuordnungFileName(kind === 'parcel' ? 'Foto Fläche' : 'Foto Baum', ext);
    if (kind === 'parcel') addParcelPhoto(entry, path, name); else entry.photos.push({ path, name });
    refreshNotesIndicator();
    await renderNotesPhotoGrid();
    await saveFullState();
    notesSyncStatus.textContent = 'Foto gespeichert.';
  } catch (err) {
    showNotesError(err.message || 'Foto-Upload fehlgeschlagen.');
    notesSyncStatus.textContent = '';
  }
});

async function removeNotesPhoto(path) {
  const { kind, entry } = notesTarget;
  notesSyncStatus.textContent = 'Lösche …';
  try {
    await deletePhoto(path);
    if (kind === 'parcel') removeParcelPhoto(entry, path); else entry.photos = entry.photos.filter(p => p.path !== path);
    refreshNotesIndicator();
    await renderNotesPhotoGrid();
    await saveFullState();
    notesSyncStatus.textContent = 'Gelöscht.';
  } catch (err) {
    notesSyncStatus.textContent = 'Fehler: ' + (err.message || 'Löschen fehlgeschlagen.');
  }
}

// ---------- FeldFolio Plus: Anbauplanung (Gartenbau-Kulturplan) ----------
// Konkretisiert pro Fläche, welche Kultur wann angebaut wird — feiner als die
// offizielle Nutzungsart/NC im Nutzungsverzeichnis (oft nur grob, z.B.
// "Freilandgemüse", und unterjährig nicht änderbar), obwohl auf derselben
// Fläche mehrere Kulturen nacheinander stehen können (siehe Ergänzungsblatt
// Gartenbau). Gleiches Cloud-Konto-Gating wie Notiz/Fotos, Speicherung direkt
// in entry.props (siehe setParcelKulturplan oben) — reist also automatisch
// mit dem geteilten layers[id].geojson mit, keine eigene Tabelle nötig.
const KP_MONTHS = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUNI', 'JULI', 'AUG', 'SEPT', 'OKT', 'NOV', 'DEZ'];

// Bekannte Gartenbau-Kulturen gruppiert nach Kulturart, je mit einer eigenen
// Balkenfarbe — dient sowohl als Autovervollständigung (Datalist) als auch
// zur automatischen Einfärbung neuer Balken (siehe kulturColor unten). Freie
// Eingaben, die keinem Namen hier entsprechen, behalten die neutrale
// Standardfarbe (--accent-dim).
const KULTUR_CATALOG = [
  { kategorie: 'Blattgemüse', farbe: '#5B8C3A', namen: ['Spinat', 'Kopfsalat', 'Eisbergsalat', 'Feldsalat', 'Rucola', 'Mangold', 'Endivie', 'Radicchio', 'Pflücksalat', 'Bataviasalat', 'Portulak'] },
  { kategorie: 'Kohlgemüse', farbe: '#3E6B5C', namen: ['Weißkohl', 'Rotkohl', 'Wirsing', 'Blumenkohl', 'Brokkoli', 'Kohlrabi', 'Rosenkohl', 'Grünkohl', 'Chinakohl', 'Pak Choi'] },
  { kategorie: 'Wurzel-/Knollengemüse', farbe: '#C1793A', namen: ['Möhren', 'Rote Bete', 'Pastinaken', 'Petersilienwurzel', 'Rettich', 'Radieschen', 'Schwarzwurzel', 'Steckrübe', 'Knollensellerie'] },
  { kategorie: 'Zwiebelgemüse', farbe: '#7A5C8C', namen: ['Zwiebeln', 'Lauch', 'Knoblauch', 'Schalotten', 'Frühlingszwiebeln'] },
  { kategorie: 'Fruchtgemüse', farbe: '#C1543A', namen: ['Tomaten', 'Gurken', 'Zucchini', 'Kürbis', 'Paprika', 'Auberginen', 'Melonen', 'Zuckermais'] },
  { kategorie: 'Hülsenfrüchte', farbe: '#8CAA4E', namen: ['Buschbohnen', 'Stangenbohnen', 'Erbsen', 'Zuckerschoten', 'Dicke Bohnen'] },
  { kategorie: 'Kartoffeln/Knollen', farbe: '#8A6A45', namen: ['Kartoffeln', 'Topinambur'] },
  { kategorie: 'Kräuter', farbe: '#4B8C82', namen: ['Petersilie', 'Basilikum', 'Dill', 'Schnittlauch', 'Koriander', 'Kerbel', 'Majoran', 'Thymian'] },
  { kategorie: 'Dauerkulturen', farbe: '#9B6B8C', namen: ['Erdbeeren', 'Spargel', 'Rhabarber'] },
  { kategorie: 'Brache/Gründüngung', farbe: '#9C8F73', namen: ['Brache', 'Gründüngung: Wicken/Erbsen', 'Gründüngung: Phacelia', 'Gründüngung: Senf'] }
];

// Exakter Treffer zuerst, sonst Teilstring-Abgleich (deckt z.B. "Möhren
// (Bund)" oder die zusammengesetzten Gründüngung-Einträge ab) — liefert null
// für unbekannte Kulturen, Aufrufer fällt dann auf die neutrale Standardfarbe
// zurück.
function kulturColor(name) {
  const lower = (name || '').trim().toLowerCase();
  if (!lower) return null;
  for (const gruppe of KULTUR_CATALOG) {
    if (gruppe.namen.some(n => n.toLowerCase() === lower)) return gruppe.farbe;
  }
  for (const gruppe of KULTUR_CATALOG) {
    if (gruppe.namen.some(n => lower.includes(n.toLowerCase()))) return gruppe.farbe;
  }
  return null;
}

let kulturplanTarget = null; // entry (immer eine Fläche, anders als bei Notiz/Fotos)
let kulturplanYear = new Date().getFullYear();
let kulturplanEditingId = null; // id des gerade im Formular bearbeiteten Eintrags, null = "neu anlegen"
let kulturplanDragMoved = false; // unterscheidet Klick (öffnet Bearbeiten) von Drag-Ende (nicht öffnen)

const kulturplanModal = document.getElementById('kulturplan-modal-overlay');
const kulturplanNotConfigured = document.getElementById('kulturplan-not-configured');
const kulturplanEditor = document.getElementById('kulturplan-editor');
const kulturplanYearLabel = document.getElementById('kulturplan-year-label');
const kulturplanTimelineEl = document.getElementById('kulturplan-timeline');
const kulturplanKulturInput = document.getElementById('kulturplan-kultur-input');
const kulturplanStartSelect = document.getElementById('kulturplan-start-select');
const kulturplanEndSelect = document.getElementById('kulturplan-end-select');
const kulturplanFlaecheInput = document.getElementById('kulturplan-flaeche-input');
const kulturplanDuengungInput = document.getElementById('kulturplan-duengung-input');
const kulturplanError = document.getElementById('kulturplan-error');
const kulturplanSyncStatus = document.getElementById('kulturplan-sync-status');
const kulturplanBtnAdd = document.getElementById('kulturplan-btn-add');
const kulturplanBtnDelete = document.getElementById('kulturplan-btn-delete');
const kulturplanBtnCancelEdit = document.getElementById('kulturplan-btn-cancel-edit');

KP_MONTHS.forEach((label, i) => {
  const month = String(i + 1);
  kulturplanStartSelect.add(new Option(label, month));
  kulturplanEndSelect.add(new Option(label, month));
});

const kulturplanSuggestionsList = document.getElementById('kulturplan-kultur-suggestions');
KULTUR_CATALOG.forEach(gruppe => {
  gruppe.namen.forEach(n => kulturplanSuggestionsList.appendChild(new Option(n)));
});

function showKulturplanError(msg) {
  kulturplanError.textContent = msg;
  kulturplanError.hidden = !msg;
}

// Aktualisiert nur das Anbauplanungs-Icon in der Flächentabelle, ohne die ganze
// Anbauplanung neu aufzubauen — gleiches Muster wie refreshNotesIndicator().
function refreshKulturplanIndicator() { renderFeatureTable(); }

function resetKulturplanForm() {
  kulturplanEditingId = null;
  kulturplanKulturInput.value = '';
  kulturplanStartSelect.value = '1';
  kulturplanEndSelect.value = '1';
  kulturplanFlaecheInput.value = '';
  kulturplanDuengungInput.value = '';
  kulturplanBtnAdd.textContent = 'Hinzufügen';
  kulturplanBtnDelete.hidden = true;
  kulturplanBtnCancelEdit.hidden = true;
  showKulturplanError('');
}

function fillKulturplanFormFrom(entryData) {
  kulturplanEditingId = entryData.id;
  kulturplanKulturInput.value = entryData.kultur;
  kulturplanStartSelect.value = String(entryData.startMonth);
  kulturplanEndSelect.value = String(entryData.endMonth);
  kulturplanFlaecheInput.value = entryData.flaeche != null ? String(entryData.flaeche) : '';
  kulturplanDuengungInput.value = entryData.duengung || '';
  kulturplanBtnAdd.textContent = 'Speichern';
  kulturplanBtnDelete.hidden = false;
  kulturplanBtnCancelEdit.hidden = false;
  showKulturplanError('');
}

function openKulturplanModal(entry) {
  kulturplanTarget = entry;
  kulturplanYear = new Date().getFullYear();
  showKulturplanError('');
  kulturplanSyncStatus.textContent = '';
  const loggedIn = isSupabaseConfigured && !!accountSession;
  kulturplanNotConfigured.hidden = loggedIn;
  kulturplanEditor.hidden = !loggedIn;
  if (loggedIn) {
    resetKulturplanForm();
    renderKulturplanEditor();
  }
  kulturplanModal.hidden = false;
}
function closeKulturplanModal() { kulturplanModal.hidden = true; kulturplanTarget = null; }

['kulturplan-modal-close-1', 'kulturplan-modal-close-2'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeKulturplanModal);
});
kulturplanModal.addEventListener('click', (e) => { if (e.target === kulturplanModal) closeKulturplanModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !kulturplanModal.hidden) closeKulturplanModal(); });

document.getElementById('kulturplan-year-prev').addEventListener('click', () => { kulturplanYear--; renderKulturplanEditor(); });
document.getElementById('kulturplan-year-next').addEventListener('click', () => { kulturplanYear++; renderKulturplanEditor(); });
kulturplanBtnCancelEdit.addEventListener('click', () => { resetKulturplanForm(); renderKulturplanEditor(); });

async function persistKulturplanChange(successMsg) {
  setParcelKulturplan(kulturplanTarget, kulturplanTarget.kulturplan);
  refreshKulturplanIndicator();
  kulturplanSyncStatus.textContent = 'Speichere …';
  try {
    await saveFullState();
    kulturplanSyncStatus.textContent = successMsg || 'Gespeichert.';
  } catch (err) {
    kulturplanSyncStatus.textContent = 'Fehler: ' + (err.message || 'Speichern fehlgeschlagen.');
  }
}

kulturplanBtnAdd.addEventListener('click', async () => {
  const kultur = kulturplanKulturInput.value.trim();
  const startMonth = parseInt(kulturplanStartSelect.value, 10);
  const endMonth = parseInt(kulturplanEndSelect.value, 10);
  const flaecheRaw = kulturplanFlaecheInput.value.trim();
  const flaeche = flaecheRaw ? parseFloat(flaecheRaw.replace(',', '.')) : null;
  const duengung = kulturplanDuengungInput.value.trim();
  showKulturplanError('');
  if (!kultur) { showKulturplanError('Bitte eine Kultur eintragen.'); return; }
  if (endMonth < startMonth) { showKulturplanError('Der Endmonat darf nicht vor dem Startmonat liegen.'); return; }
  if (flaecheRaw && (!isFinite(flaeche) || flaeche < 0)) { showKulturplanError('Bitte eine gültige Fläche in m² eintragen.'); return; }

  if (kulturplanEditingId) {
    const existing = kulturplanTarget.kulturplan.find(e => e.id === kulturplanEditingId);
    if (existing) { existing.kultur = kultur; existing.startMonth = startMonth; existing.endMonth = endMonth; existing.flaeche = flaeche; existing.duengung = duengung; }
  } else {
    kulturplanTarget.kulturplan.push({
      id: 'kp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      jahr: kulturplanYear, kultur, startMonth, endMonth, flaeche, duengung
    });
  }
  resetKulturplanForm();
  renderKulturplanEditor();
  await persistKulturplanChange();
});

kulturplanBtnDelete.addEventListener('click', async () => {
  if (!kulturplanEditingId) return;
  kulturplanTarget.kulturplan = kulturplanTarget.kulturplan.filter(e => e.id !== kulturplanEditingId);
  resetKulturplanForm();
  renderKulturplanEditor();
  await persistKulturplanChange('Gelöscht.');
});

// Weist überlappenden Einträgen unterschiedliche "Spuren" (Zeilen) zu, damit
// z.B. eine parallele Gründüngung nicht dieselbe Zeile wie die Hauptkultur
// belegt — einfacher Greedy-Algorithmus (erste freie Spur ab Startmonat),
// kein Anspruch auf eine optimale Zeilenzahl.
function assignKulturplanLanes(entries) {
  const sorted = [...entries].sort((a, b) => a.startMonth - b.startMonth);
  const laneEnds = []; // letzter belegter Monat je Spur
  const laneOf = new Map();
  sorted.forEach(e => {
    let lane = laneEnds.findIndex(end => end < e.startMonth);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.endMonth); }
    else { laneEnds[lane] = e.endMonth; }
    laneOf.set(e.id, lane);
  });
  return { laneOf, laneCount: laneEnds.length };
}

// Pointer-basiertes Verschieben/Skalieren eines Balkens — bewusst nur auf
// volle Monate einrastend (kein pixelgenaues Ziehen), das hält die Bedienung
// einfach und lesbar. Live-Feedback per direktem grid-column-Update während
// des Ziehens, gespeichert wird erst bei pointerup.
function wireKulturplanBarDrag(barEl, entryData) {
  const handleLeft = barEl.querySelector('.kp-bar-handle-left');
  const handleRight = barEl.querySelector('.kp-bar-handle-right');

  function startDrag(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    const laneRect = barEl.parentElement.getBoundingClientRect();
    const monthWidth = laneRect.width / 12;
    const startX = e.clientX;
    const origStart = entryData.startMonth;
    const origEnd = entryData.endMonth;
    kulturplanDragMoved = false;

    function onMove(ev) {
      const deltaPx = ev.clientX - startX;
      if (Math.abs(deltaPx) > 3) kulturplanDragMoved = true;
      const deltaMonths = Math.round(deltaPx / monthWidth);
      if (mode === 'move') {
        const span = origEnd - origStart;
        const newStart = Math.min(Math.max(origStart + deltaMonths, 1), 12 - span);
        entryData.startMonth = newStart;
        entryData.endMonth = newStart + span;
      } else if (mode === 'resize-left') {
        entryData.startMonth = Math.min(Math.max(origStart + deltaMonths, 1), origEnd);
      } else if (mode === 'resize-right') {
        entryData.endMonth = Math.max(Math.min(origEnd + deltaMonths, 12), origStart);
      }
      barEl.style.gridColumn = `${entryData.startMonth} / ${entryData.endMonth + 1}`;
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (kulturplanDragMoved) {
        if (kulturplanEditingId === entryData.id) fillKulturplanFormFrom(entryData);
        persistKulturplanChange('Verschoben — gespeichert.');
        renderKulturplanEditor();
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  barEl.addEventListener('pointerdown', (e) => startDrag(e, 'move'));
  handleLeft.addEventListener('pointerdown', (e) => startDrag(e, 'resize-left'));
  handleRight.addEventListener('pointerdown', (e) => startDrag(e, 'resize-right'));
  barEl.addEventListener('click', (e) => {
    if (e.target.closest('.kp-bar-handle')) return;
    if (kulturplanDragMoved) { kulturplanDragMoved = false; return; }
    fillKulturplanFormFrom(entryData);
    renderKulturplanEditor();
  });
}

function renderKulturplanEditor() {
  kulturplanYearLabel.textContent = String(kulturplanYear);
  const entries = kulturplanTarget.kulturplan.filter(e => e.jahr === kulturplanYear);
  const monthsHeader = '<div class="kp-months-header">' + KP_MONTHS.map(m => `<div class="kp-month-label">${m}</div>`).join('') + '</div>';

  if (!entries.length) {
    kulturplanTimelineEl.innerHTML = monthsHeader + '<p class="kp-timeline-empty">Noch keine Kultur für dieses Jahr eingetragen.</p>';
    return;
  }

  const { laneOf, laneCount } = assignKulturplanLanes(entries);
  const lanes = Array.from({ length: laneCount }, () => []);
  entries.forEach(e => lanes[laneOf.get(e.id)].push(e));

  const lanesHtml = lanes.map(laneEntries => {
    const barsHtml = laneEntries.map(e => {
      const flaecheText = e.flaeche != null ? `${e.flaeche.toLocaleString('de-DE')} m²` : '';
      const color = kulturColor(e.kultur);
      const label = flaecheText ? `${e.kultur} · ${flaecheText}` : e.kultur;
      const title = `${e.kultur}${flaecheText ? ' · ' + flaecheText : ''} (${KP_MONTHS[e.startMonth - 1]}–${KP_MONTHS[e.endMonth - 1]})`;
      return `
      <div class="kp-bar${e.id === kulturplanEditingId ? ' selected' : ''}" data-id="${escapeHtml(e.id)}"
           style="grid-column: ${e.startMonth} / ${e.endMonth + 1};${color ? ` background:${color};` : ''}"
           title="${escapeHtml(title)}">
        <span class="kp-bar-handle kp-bar-handle-left"></span>
        <span class="kp-bar-label">${escapeHtml(label)}</span>
        <span class="kp-bar-handle kp-bar-handle-right"></span>
      </div>`;
    }).join('');
    return `<div class="kp-lane">${barsHtml}</div>`;
  }).join('');

  kulturplanTimelineEl.innerHTML = monthsHeader + lanesHtml;
  kulturplanTimelineEl.querySelectorAll('.kp-bar').forEach(barEl => {
    const entryData = kulturplanTarget.kulturplan.find(e => e.id === barEl.getAttribute('data-id'));
    wireKulturplanBarDrag(barEl, entryData);
  });
}

// ---------- FeldFolio Plus: Terminkalender ----------
// Eigener Tab mit eigener, zweiter Leaflet-Karteninstanz (getrennt von der
// geteilten Parzellen-Karte) — Cloud-Konto-Funktion wie Notiz/Fotos, siehe
// dortiges Gating-Muster (accountSession). Termine kommen aus einem
// Excel-Export ("Intact Platform", Spalten wie Kunde/Auditart/Straße/PLZ/Ort/
// Auditdatum) statt aus .ics — der Export enthält bereits strukturierte
// Adressfelder (keine Text-Heuristik nötig wie zuvor bei .ics) und keine
// Uhrzeiten, nur Tagesdaten — deshalb Tageskarten statt Stundenraster.
// XLSX-Parsing läuft über die bereits per CDN geladene SheetJS-Bibliothek
// (globales XLSX, siehe index.html — dieselbe, die auch für den Excel-Export
// genutzt wird), keine neue Abhängigkeit nötig. Zusammenführen neuer Uploads
// per Nr. Auditauftrag (AO-Code), Adressen werden über die öffentliche
// Nominatim-API (OpenStreetMap) geokodiert — nur einmalig pro Termin,
// Ergebnis wird mit gespeichert.
let terminkalenderEvents = []; // { id, kunde, auditart, ..., date: Date, lat, lng, geocodeStatus }
let terminkalenderInitDone = false;
let terminkalenderMap = null;
let terminkalenderMarkersLayer = null;
let terminkalenderWeekStart = getMondayOfWeek(new Date());
let terminkalenderSelectedId = null;

// Termine entstehen sonst ausschließlich über den Excel-Import — für
// Regressionstests (z.B. des Dokumentenscanners) braucht es einen
// direkten, dev-only Weg, einen Testtermin anzulegen und auszuwählen,
// analog zu window.__ffTestMap oben.
if (import.meta.env.DEV) {
  window.__ffTestTk = {
    addEvent(overrides = {}) {
      const ev = {
        id: 'test-' + Date.now() + Math.random().toString(36).slice(2),
        kunde: 'Testbetrieb', auditart: 'Test', dienstleistungen: '', format: '',
        date: new Date(), bestaetigt: false, prioritaet: '', unangemeldet: false,
        telefon: '', mobil: '', email: '', strasse: '', plz: '', ort: '', address: null,
        hinweis: '', kundennummer: '', lat: null, lng: null, geocodeStatus: 'none',
        hasTime: false, dateEnd: null, attachments: [], probenprotokolle: [], crossChecks: [],
        ...overrides
      };
      terminkalenderEvents.push(ev);
      renderTerminkalenderGrid();
      return ev.id;
    },
    getEvent(id) { return terminkalenderEvents.find(e => e.id === id); },
    // Der Terminkalender-Umschalter ist ohne Anmeldung ausgeblendet (siehe
    // updateAccountButton()) — für Tests eine echte Anmeldung ohne echtes
    // Supabase-Konto vortäuschen, statt den kompletten Login-Flow zu
    // durchlaufen.
    loginFake(email = 'test@example.com') {
      accountSession = { user: { id: 'test-user', email } };
      updateAccountButton();
    },
    logoutFake() {
      accountSession = null;
      updateAccountButton();
    }
  };
}

const tkSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Lokales Datum im Format des <input type="date"> (toISOString wäre UTC und
// läge nachts um Mitternacht einen Tag daneben).
function tkDateInputValue(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMondayOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Montag=0 … Sonntag=6
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Standard-ISO-8601-Wochennummer: über den Donnerstag der Woche bestimmt,
// da die ISO-Woche zu dem Jahr gehört, das den Donnerstag dieser Woche enthält.
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function parseGermanDate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

// ---- Excel-Parser (Intact-Platform-Export: Titelzeile, dann Kopfzeile,
// dann eine Zeile je Termin) — Kopfzeile ist Zeile 2 (Index 1), daher range:1.
function parseXlsxFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { range: 1, defval: '' });
  return rows.map(row => {
    const kunde = String(row['Kunde'] || '').trim();
    const date = parseGermanDate(row['Auditdatum (von)']);
    if (!kunde || !date) return null; // leere/kaputte Zeilen überspringen
    const strasse = String(row['Straße'] || '').trim();
    const plz = String(row['PLZ'] || '').trim();
    const ort = String(row['Ort'] || '').trim();
    const address = [strasse, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
    const id = String(row['Nr. Auditauftrag'] || '').trim() ||
      [row['Kundennummer'], row['Auditdatum (von)'], row['Auditart']].filter(Boolean).join('|');
    return {
      id,
      kunde,
      auditart: String(row['Auditart'] || '').trim(),
      dienstleistungen: String(row['Dienstleistungen'] || '').trim(),
      format: String(row['Format'] || '').trim(),
      date,
      bestaetigt: String(row['Bestätigungsstatus'] || '').trim() === 'Termine bestätigt',
      prioritaet: String(row['Priorität'] || '').trim(),
      unangemeldet: String(row['Audit unangemeldet'] || '').trim() === '1',
      telefon: String(row['Telefon'] || '').trim(),
      mobil: String(row['Mobil'] || '').trim(),
      email: String(row['E-Mail'] || '').trim(),
      strasse, plz, ort, address,
      hinweis: String(row['Hinweis Auditor 1'] || '').trim(),
      kundennummer: String(row['Kundennummer'] || '').trim(),
      lat: null, lng: null, geocodeStatus: 'none',
      // Excel liefert nur ein Datum — Uhrzeit kommt optional über eine
      // zusätzlich hochgeladene .ics-Datei dazu (siehe applyIcsTimes unten).
      hasTime: false, dateEnd: null,
      // Fotos/Dateien bzw. Probenahmeprotokolle, die man einem Termin manuell
      // hinzufügt (siehe renderTerminkalenderAttachments/
      // formularSectionHtml unten) — bleiben bei einem erneuten
      // Excel-Upload immer erhalten (siehe mergeTerminkalenderEvents).
      attachments: [], probenprotokolle: [], crossChecks: []
    };
  }).filter(Boolean);
}

// ---- Zusammenführen per Nr. Auditauftrag (AO-Code) ----
function mergeTerminkalenderEvents(parsed) {
  const byId = new Map(terminkalenderEvents.map(e => [e.id, e]));
  let added = 0, updated = 0;
  parsed.forEach(p => {
    const existing = byId.get(p.id);
    if (existing) {
      const addressChanged = existing.address !== p.address;
      const prevLat = existing.lat, prevLng = existing.lng, prevStatus = existing.geocodeStatus;
      // Eine per .ics ergänzte Uhrzeit bleibt erhalten, solange sich das
      // Excel-Datum für diesen Termin nicht geändert hat (sonst wäre die
      // alte Uhrzeit für einen anderen Tag nicht mehr gültig).
      const sameDay = existing.date && existing.date.toDateString() === p.date.toDateString();
      const prevDate = existing.date, prevHasTime = existing.hasTime, prevDateEnd = existing.dateEnd;
      const prevAttachments = existing.attachments;
      const prevProbenprotokolle = existing.probenprotokolle;
      const prevCrossChecks = existing.crossChecks;
      Object.assign(existing, p);
      if (!addressChanged) { existing.lat = prevLat; existing.lng = prevLng; existing.geocodeStatus = prevStatus; }
      if (sameDay && prevHasTime) { existing.date = prevDate; existing.hasTime = true; existing.dateEnd = prevDateEnd; }
      existing.attachments = prevAttachments || [];
      existing.probenprotokolle = prevProbenprotokolle || [];
      existing.crossChecks = prevCrossChecks || [];
      updated++;
    } else {
      terminkalenderEvents.push(p);
      added++;
    }
  });
  return { added, updated };
}

// ---- Terminuhrzeiten aus .ics ergänzen ----
// Der Excel-Export liefert nur ein Datum, keine Uhrzeit. Eine zusätzliche
// .ics-Datei (z.B. Kalender-Export desselben Auftragssystems) enthält echte
// Uhrzeiten — Zuordnung läuft über den Auditauftrags-Code ("AO-XXXXXX"), der
// im .ics-Termintitel steckt und exakt der Excel-Spalte "Nr. Auditauftrag"
// entspricht (= id), nicht über die .ics-UID.
const TK_AO_CODE_RE = /AO-\d+/;

function unfoldIcsLines(text) {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  rawLines.forEach(line => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  });
  return lines;
}

function parseIcsDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  return z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) : new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

// Schlanker Parser wie zuvor beim direkten .ics-Import — deckt nur ab, was
// hier gebraucht wird (SUMMARY/DTSTART/DTEND), keine Wiederholungsregeln/
// Zeitzonen-Blöcke. Unbekannte BEGIN/END-Blöcke innerhalb eines VEVENT
// werden übersprungen statt zum Absturz zu führen.
function parseIcsFile(text) {
  const lines = unfoldIcsLines(text);
  const events = [];
  let cur = null;
  let skipDepth = 0;
  lines.forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('BEGIN:')) {
      const blockName = line.slice(6).trim();
      if (blockName === 'VEVENT') cur = { summary: '', start: null, end: null };
      else if (cur) skipDepth++;
      return;
    }
    if (line.startsWith('END:')) {
      const blockName = line.slice(4).trim();
      if (blockName === 'VEVENT') { if (cur && cur.start) events.push(cur); cur = null; }
      else if (skipDepth > 0) skipDepth--;
      return;
    }
    if (!cur || skipDepth > 0) return;
    const idx = line.indexOf(':');
    if (idx === -1) return;
    let key = line.slice(0, idx);
    const semi = key.indexOf(';');
    if (semi !== -1) key = key.slice(0, semi);
    const value = line.slice(idx + 1);
    if (key === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    else if (key === 'DTSTART') cur.start = parseIcsDate(value.trim());
    else if (key === 'DTEND') cur.end = parseIcsDate(value.trim());
  });
  return events.filter(e => e.start);
}

function applyIcsTimes(icsEvents) {
  let matched = 0, unmatched = 0;
  icsEvents.forEach(ic => {
    const m = TK_AO_CODE_RE.exec(ic.summary);
    const ev = m ? terminkalenderEvents.find(e => e.id === m[0]) : null;
    if (ev) {
      ev.date = ic.start;
      ev.dateEnd = ic.end || null;
      ev.hasTime = true;
      matched++;
    } else {
      unmatched++;
    }
  });
  return { matched, unmatched };
}

// ---- Geokodierung (OpenStreetMap Nominatim, öffentlich, kein API-Key) ----
async function geocodeMissingAddresses() {
  const pending = terminkalenderEvents.filter(e => e.address && e.lat == null && e.geocodeStatus !== 'failed');
  for (let i = 0; i < pending.length; i++) {
    const ev = pending[i];
    setTerminkalenderStatus(`Geokodiere Adressen … ${i + 1}/${pending.length}`);
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(ev.address));
      const data = await res.json();
      if (data && data[0]) {
        ev.lat = parseFloat(data[0].lat);
        ev.lng = parseFloat(data[0].lon);
        ev.geocodeStatus = 'ok';
      } else {
        ev.geocodeStatus = 'failed';
      }
    } catch {
      ev.geocodeStatus = 'failed';
    }
    renderTerminkalenderSummary();
    // Nominatim-Nutzungsbedingungen: max. 1 Anfrage/Sekunde.
    if (i < pending.length - 1) await tkSleep(1100);
  }
  renderTerminkalenderGrid();
}

function eventRouteUrl(ev) {
  if (ev.lat != null && ev.lng != null) return googleMapsDirectionsUrl(ev.lat, ev.lng);
  if (ev.address) return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(ev.address) + '&travelmode=driving';
  return null;
}

// Reduziert eine roh aus der Excel übernommene Telefonnummer (z.B. "0341
// 3150555") auf die für tel:-Links zulässigen Zeichen (Ziffern + führendes
// "+"), damit ein Tap auf die Zeile auf dem Handy zuverlässig den Wähler öffnet.
function telHref(raw) {
  return raw.replace(/[^\d+]/g, '');
}

const TK_ICON_PIN = '<span class="material-symbols-rounded icon tk-contact-icon-pin" aria-hidden="true">location_on</span>';
const TK_ICON_PHONE = '<span class="material-symbols-rounded icon" aria-hidden="true">call</span>';
const TK_ICON_MAIL = '<span class="material-symbols-rounded icon" aria-hidden="true">mail</span>';

// Baut die klickbaren Kontakt-Zeilen (Adresse mit Google-Maps-Link, Telefon/
// Mobil mit tel:-Link + Telefonhörer-Symbol in Accent-Farbe, E-Mail mit
// mailto:-Link) — als ganze Zeile tappbar statt nur ein kleines Icon, damit
// das auf dem Handy zuverlässig trifft.
function renderTerminkalenderContactRows(ev) {
  const routeUrl = eventRouteUrl(ev);
  const rows = [];
  if (ev.address) {
    rows.push(`<a class="tk-contact-row" href="${routeUrl}" target="_blank" rel="noopener">
      <span class="tk-contact-icon">${TK_ICON_PIN}</span>
      <span class="tk-contact-text">${escapeHtml(ev.address)}</span>
    </a>`);
  }
  if (ev.telefon) {
    rows.push(`<a class="tk-contact-row tk-contact-row-call" href="tel:${escapeHtml(telHref(ev.telefon))}">
      <span class="tk-contact-icon">${TK_ICON_PHONE}</span>
      <span class="tk-contact-text">Telefon: ${escapeHtml(ev.telefon)}</span>
    </a>`);
  }
  if (ev.mobil) {
    rows.push(`<a class="tk-contact-row tk-contact-row-call" href="tel:${escapeHtml(telHref(ev.mobil))}">
      <span class="tk-contact-icon">${TK_ICON_PHONE}</span>
      <span class="tk-contact-text">Mobil: ${escapeHtml(ev.mobil)}</span>
    </a>`);
  }
  if (ev.email) {
    rows.push(`<a class="tk-contact-row" href="mailto:${escapeHtml(ev.email)}">
      <span class="tk-contact-icon">${TK_ICON_MAIL}</span>
      <span class="tk-contact-text">${escapeHtml(ev.email)}</span>
    </a>`);
  }
  if (!rows.length) return '<p class="empty-hint">Keine Adresse/Kontaktdaten bekannt.</p>';
  return `<div class="tk-contact-list">${rows.join('')}</div>`;
}

// ---- UI-Elemente ----
const terminkalenderNotLoggedIn = document.getElementById('terminkalender-not-logged-in');
const terminkalenderControls = document.getElementById('terminkalender-controls');
const terminkalenderLoginGate = document.getElementById('terminkalender-login-gate');
const terminkalenderMainView = document.getElementById('terminkalender-main');
const terminkalenderStatusEl = document.getElementById('terminkalender-status');
const terminkalenderSummaryEl = document.getElementById('terminkalender-summary');

function setTerminkalenderStatus(msg) { terminkalenderStatusEl.textContent = msg; }

function renderTerminkalenderSummary() {
  if (!terminkalenderEvents.length) {
    terminkalenderSummaryEl.textContent = 'Noch keine Termine geladen.';
    return;
  }
  const withAddress = terminkalenderEvents.filter(e => e.address).length;
  const geocoded = terminkalenderEvents.filter(e => e.lat != null).length;
  const unbestaetigt = terminkalenderEvents.filter(e => !e.bestaetigt).length;
  terminkalenderSummaryEl.textContent =
    `${terminkalenderEvents.length} Termine geladen, davon ${withAddress} mit Adresse, ${geocoded} geokodiert, ${unbestaetigt} unbestätigt.`;
}

// Öffnet den Terminkalender-Tab: prüft Login, initialisiert die zweite Karte
// erst jetzt (Leaflet braucht einen sichtbaren Container mit echter Größe),
// stößt danach ein invalidateSize() an, da die Karte beim init evtl. noch
// unsichtbar war.
function openTerminkalender() {
  const loggedIn = isSupabaseConfigured && !!accountSession;
  terminkalenderNotLoggedIn.hidden = loggedIn;
  terminkalenderControls.hidden = !loggedIn;
  terminkalenderLoginGate.hidden = loggedIn;
  terminkalenderMainView.hidden = !loggedIn;
  if (!loggedIn) return;
  initTerminkalenderMap();
  renderTerminkalenderSummary();
  renderTerminkalenderGrid();
  requestAnimationFrame(() => terminkalenderMap && terminkalenderMap.invalidateSize());
}

function initTerminkalenderMap() {
  if (terminkalenderInitDone) return;
  terminkalenderInitDone = true;
  terminkalenderMap = L.map('terminkalender-map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    maxZoom: 19
  }).addTo(terminkalenderMap);
  terminkalenderMarkersLayer = L.layerGroup().addTo(terminkalenderMap);
}

function renderTerminkalenderMapPins(eventsWithCoords) {
  if (!terminkalenderMap) return;
  terminkalenderMarkersLayer.clearLayers();
  const latlngs = [];
  eventsWithCoords.forEach(e => {
    const marker = L.marker([e.lat, e.lng]).bindTooltip(e.kunde);
    marker.on('click', () => selectTerminkalenderEvent(e.id));
    marker.addTo(terminkalenderMarkersLayer);
    latlngs.push([e.lat, e.lng]);
  });
  if (latlngs.length) terminkalenderMap.fitBounds(latlngs, { padding: [30, 30], maxZoom: 13 });
}

function renderTerminkalenderDetail(ev) {
  const el = document.getElementById('terminkalender-detail');
  if (!ev) { el.innerHTML = '<p class="empty-hint">Termin anklicken, um Details zu sehen.</p>'; return; }
  let dateStr = ev.date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  if (ev.hasTime) {
    dateStr += ', ' + ev.date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (ev.dateEnd) dateStr += ' – ' + ev.dateEnd.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  const badges = [`<span class="tk-badge ${ev.bestaetigt ? 'tk-badge-ok' : 'tk-badge-warn'}">${ev.bestaetigt ? 'Bestätigt' : 'Unbestätigt'}</span>`];
  if (ev.prioritaet && ev.prioritaet !== 'Normal') badges.push(`<span class="tk-badge tk-badge-warn">${escapeHtml(ev.prioritaet)}</span>`);
  if (ev.unangemeldet) badges.push('<span class="tk-badge tk-badge-warn">Unangemeldet</span>');
  const isActiveZuordnung = activeZuordnung && activeZuordnung.terminId === ev.id;
  el.innerHTML = `
    <h3>${escapeHtml(ev.kunde)}</h3>
    <p class="tk-detail-time">${dateStr}</p>
    <div class="tk-badges">${badges.join('')}</div>
    <label class="tk-move-row">
      <span>Termin verschieben auf</span>
      <input type="date" id="tk-move-date" value="${tkDateInputValue(ev.date)}">
    </label>
    <div class="tk-betrieb-assign">
      <button type="button" class="tk-betrieb-assign-btn${isActiveZuordnung ? ' active' : ''}" id="tk-betrieb-assign-btn">
        ${isActiveZuordnung
          ? '<span class="material-symbols-rounded icon">check</span> Betrieb zugeordnet'
          : '<span class="material-symbols-rounded icon">business</span> Als Betrieb zuordnen'}
      </button>
      <p class="modal-hint" id="tk-betrieb-assign-status"></p>
    </div>
    <p class="tk-detail-desc"><strong>${escapeHtml(ev.auditart)}</strong>${ev.format ? ' · ' + escapeHtml(ev.format) : ''}</p>
    ${renderTerminkalenderContactRows(ev)}
    ${ev.hinweis ? `<p class="tk-detail-desc">${escapeHtml(ev.hinweis).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="tk-attachments">
      <div class="tk-attachments-head">Fotos &amp; Dateien</div>
      <div class="tk-attachments-grid" id="tk-attachments-grid"></div>
      <div class="tk-attachments-actions">
        <label class="tk-attachment-btn tk-attachment-btn-primary">
          <input type="file" id="tk-photo-capture-input" accept="image/*" capture="environment" hidden>
          <span class="material-symbols-rounded icon">photo_camera</span> Foto aufnehmen
        </label>
        <label class="tk-attachment-btn">
          <input type="file" id="tk-file-add-input" hidden>
          <span class="material-symbols-rounded icon">attach_file</span> Datei hinzufügen
        </label>
        <button type="button" class="tk-attachment-btn" id="tk-scan-btn">
          <span class="material-symbols-rounded icon">document_scanner</span> Dokument scannen
        </button>
      </div>
      <p class="modal-hint" id="tk-attachment-status"></p>
    </div>
    ${formularSectionsHtml(ev)}
  `;
  renderTerminkalenderAttachments(ev);
  document.getElementById('tk-photo-capture-input').addEventListener('change', (e) => handleTerminkalenderFileAdd(ev, e));
  document.getElementById('tk-file-add-input').addEventListener('change', (e) => handleTerminkalenderFileAdd(ev, e));
  document.getElementById('tk-betrieb-assign-btn').addEventListener('click', () => toggleTerminkalenderZuordnung(ev));
  document.getElementById('tk-scan-btn').addEventListener('click', () => openScanModal(ev));
  // Verschieben per Datumsfeld — Drag&Drop der Karten geht auf Touch nicht.
  document.getElementById('tk-move-date').addEventListener('change', (e) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
    if (!m) return;
    const target = new Date(+m[1], +m[2] - 1, +m[3]);
    terminkalenderWeekStart = getMondayOfWeek(target);
    moveTerminkalenderEvent(ev.id, target);
  });
  wireFormularSections(ev);
}

// Ordnet den Termin direkt aus der Kalenderansicht heraus als aktiven Betrieb
// zu (bzw. entfernt die Zuordnung wieder) — nutzt dieselbe
// applyZuordnungSelection()-Logik wie die Auswahl im Kopfzeilen-Dropdown,
// inkl. automatischem Wechsel des Ebenen/Baum/Bienenflug-Workspace, falls sich
// dadurch der Betrieb ändert (siehe switchWorkspace weiter unten).
async function toggleTerminkalenderZuordnung(ev) {
  if (betriebSwitchInProgress) return;
  const btn = document.getElementById('tk-betrieb-assign-btn');
  const statusEl = document.getElementById('tk-betrieb-assign-status');
  const currentlyActive = activeZuordnung && activeZuordnung.terminId === ev.id;
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = currentlyActive ? 'Entferne Zuordnung …' : 'Ordne zu …';
  try {
    if (currentlyActive) {
      await applyZuordnungSelection(null);
    } else {
      await applyZuordnungSelection({ betrieb: ev.kunde, year: ev.date.getFullYear(), terminId: ev.id, terminLabel: `${tkFmtDate(ev.date)} · ${ev.auditart}` });
    }
    // applyZuordnungSelection() -> setActiveZuordnung() rendert Grid + Detail
    // bereits neu (siehe dort) — hier ist nichts weiter zu tun.
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Fehler: ' + (err.message || 'Zuordnung fehlgeschlagen.');
    if (btn) btn.disabled = false;
  }
}

// entry.attachments enthält nur Storage-Pfade + Metadaten — Anzeige braucht
// pro Datei eine frisch geholte Signed URL (privater Bucket, gleiches Muster
// wie die Flächen-Notizen-Fotos). Bilder werden als Vorschau angezeigt,
// andere Dateitypen als Icon + Dateiname.
async function renderTerminkalenderAttachments(ev) {
  const grid = document.getElementById('tk-attachments-grid');
  if (!grid) return;
  const attachments = ev.attachments || [];
  if (!attachments.length) { grid.innerHTML = '<p class="empty-hint">Noch keine Anhänge.</p>'; return; }
  grid.innerHTML = attachments.map(() => '<div class="tk-attachment tk-attachment-loading"></div>').join('');
  const urls = await Promise.all(attachments.map(a => getPhotoUrl(a.path, a.name).catch(() => null)));
  grid.innerHTML = attachments.map((a, i) => {
    const url = urls[i];
    if (!url) return `<div class="tk-attachment tk-attachment-error" title="${escapeHtml(a.name)} konnte nicht geladen werden"><span class="material-symbols-rounded icon">warning</span></div>`;
    const isImage = (a.type || '').startsWith('image/');
    const inner = isImage
      ? `<img src="${url}" alt="${escapeHtml(a.name)}">`
      : `<span class="tk-attachment-icon material-symbols-rounded icon">description</span><span class="tk-attachment-name">${escapeHtml(a.name)}</span>`;
    return `<div class="tk-attachment">
      <a href="${url}" target="_blank" rel="noopener" class="tk-attachment-link" title="${escapeHtml(a.name)}">${inner}</a>
      <button type="button" class="tk-attachment-remove" data-path="${escapeHtml(a.path)}" title="Entfernen"><span class="material-symbols-rounded icon">close</span></button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.tk-attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTerminkalenderAttachment(ev.id, btn.getAttribute('data-path')));
  });
}

// Gemeinsame Upload-/Benennungs-/ev.attachments-Logik — genutzt sowohl von
// den beiden Datei-Input-Feldern (via handleTerminkalenderFileAdd) als auch
// direkt vom Dokumentenscanner (siehe weiter unten), der sein fertiges PDF
// als File-Objekt übergibt, ohne den Umweg über ein <input>-Change-Event.
async function uploadTerminkalenderAttachment(ev, file, artOverride) {
  if (!file) return;
  try {
    const path = await uploadPhoto(file);
    // Termine kennen ihren Betrieb (Kunde) und ihr Datum bereits selbst — die
    // Jahr_Betrieb_Art-Benennung braucht hier also keine globale Zuordnung
    // (siehe zuordnungFileName), sondern wird direkt aus dem Termin abgeleitet.
    // artOverride erlaubt Aufrufern mit eigener Namenskonvention (siehe
    // exportProbenprotokollPdf) einen aussagekräftigeren Wert als die drei
    // generischen Standardfälle.
    const isImage = (file.type || '').startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    const ext = (file.name.split('.').pop() || (isImage ? 'jpg' : isPdf ? 'pdf' : 'dat')).toLowerCase();
    const art = artOverride || (isImage ? 'Foto Termin' : isPdf ? 'Scan Termin' : 'Datei Termin');
    const name = `${ev.date.getFullYear()}_${sanitizeFileNamePart(ev.kunde)}_${art}.${ext}`;
    ev.attachments = ev.attachments || [];
    ev.attachments.push({ path, name, size: file.size, type: file.type || '' });
    renderTerminkalenderGrid();
    if (terminkalenderSelectedId === ev.id) {
      renderTerminkalenderDetail(ev);
      const statusEl = document.getElementById('tk-attachment-status');
      if (statusEl) statusEl.textContent = 'Hochgeladen — nicht vergessen zu speichern.';
    }
  } catch (err) {
    const statusEl = document.getElementById('tk-attachment-status');
    if (statusEl) statusEl.textContent = 'Fehler: ' + (err.message || 'Datei konnte nicht hochgeladen werden.');
  }
}

function handleTerminkalenderFileAdd(ev, e) {
  const input = e.target;
  const file = input.files[0];
  input.value = '';
  uploadTerminkalenderAttachment(ev, file);
}

async function removeTerminkalenderAttachment(id, path) {
  const ev = terminkalenderEvents.find(e => e.id === id);
  if (!ev) return;
  const statusEl = document.getElementById('tk-attachment-status');
  if (statusEl) statusEl.textContent = 'Lösche …';
  try {
    await deletePhoto(path);
    ev.attachments = (ev.attachments || []).filter(a => a.path !== path);
    renderTerminkalenderGrid();
    renderTerminkalenderDetail(ev);
    const freshStatus = document.getElementById('tk-attachment-status');
    if (freshStatus) freshStatus.textContent = 'Entfernt — nicht vergessen zu speichern.';
  } catch (err) {
    const currentStatus = document.getElementById('tk-attachment-status');
    if (currentStatus) currentStatus.textContent = 'Fehler: ' + (err.message || 'Löschen fehlgeschlagen.');
  }
}

// ---------- Dokumentenscanner (Terminkalender-Anhänge) ----------
// Kamera-basierter Mehrseiten-Scanner (wie Adobe Scan) auf Basis von
// jscanify (https://github.com/puffinsoft/jscanify) für Kantenerkennung +
// Entzerrung. jscanify selbst ist winzig (~2,6 KB), setzt aber OpenCV.js
// voraus (~9 MB WASM) — anders als die übrigen, durchweg kleinen
// CDN-Libraries dieser App wird das NICHT statisch in index.html geladen
// (würde jeden App-Start verlängern, für alle, auch die, die nie
// scannen), sondern beim ersten Öffnen des Scanners per <script>-Tag
// nachgeladen (ensureScanLibs()). Beide Libraries werden bewusst NICHT
// über npm eingebunden: jscanifys npm-Paket hat canvas/jsdom als
// Node-only-Abhängigkeiten (30 MB, im Browser-Bundle nicht nutzbar) — der
// vom Projekt selbst bereitgestellte Browser-Build (jscanify.min.js,
// definiert global `jscanify`) ist hier die richtige Wahl, genau wie
// Leaflet/jsPDF/html2canvas/turf auch per <script>-Tag statt npm laufen.
const SCAN_OPENCV_URL = 'https://docs.opencv.org/4.7.0/opencv.js';
const SCAN_JSCANIFY_URL = 'https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.min.js';
const SCAN_DETECT_INTERVAL_MS = 200; // bewusst nicht die 10ms aus dem jscanify-Beispiel — unnötiger Akku-/CPU-Verbrauch für eine Live-Vorschau

let scanLibsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Skript konnte nicht geladen werden: ${src}`));
    document.head.appendChild(s);
  });
}
function ensureScanLibs() {
  if (!scanLibsPromise) {
    scanLibsPromise = (async () => {
      await loadScript(SCAN_OPENCV_URL);
      // OpenCV.js definiert `cv` synchron beim Laden, initialisiert die
      // WASM-Runtime aber asynchron danach — erst ab onRuntimeInitialized
      // sind cv.imread() & Co. nutzbar.
      await new Promise((resolve) => {
        if (window.cv && window.cv.Mat) resolve();
        else window.cv['onRuntimeInitialized'] = resolve;
      });
      await loadScript(SCAN_JSCANIFY_URL);
    })();
  }
  return scanLibsPromise;
}

let scanJscanify = null;
let scanStream = null;
let scanDetectTimer = null;
let scanPages = []; // { dataUrl, width, height } je bestätigter Seite
let scanCurrentEvent = null;
let scanCropRawCanvas = null; // eingefrorenes Rohbild während der Ecken-Korrektur
let scanCropCorners = null; // { topLeftCorner:{x,y}, ... } in % der Bildfläche (0-100), auflösungsunabhängig

const scanModal = document.getElementById('scan-modal-overlay');
const scanCameraView = document.getElementById('scan-camera-view');
const scanCropView = document.getElementById('scan-crop-view');
const scanVideo = document.getElementById('scan-video');
const scanRawCanvas = document.getElementById('scan-raw-canvas');
const scanPreviewCanvas = document.getElementById('scan-preview-canvas');
const scanStatusEl = document.getElementById('scan-status');
const scanThumbnailsEl = document.getElementById('scan-thumbnails');
const scanBtnCapture = document.getElementById('scan-btn-capture');
const scanBtnFinish = document.getElementById('scan-btn-finish');
const scanCropStage = document.getElementById('scan-crop-stage');
const scanCropFrame = document.getElementById('scan-crop-frame');

// #scan-crop-frame bekommt seine Pixel-Maße exakt im Seitenverhältnis des
// aufgenommenen Fotos gesetzt (statt das <img> per CSS max-width/
// max-height selbst "letterboxen" zu lassen) — Bild, SVG-Overlay und
// Eckpunkt-Griffe liegen dadurch alle auf derselben Box und bleiben exakt
// pixelgenau zum sichtbaren Bildinhalt ausgerichtet, unabhängig vom
// Seitenverhältnis von Foto zu Bildschirm (Kamerafotos sind fast nie im
// selben Seitenverhältnis wie der Bildschirm). Gleiches
// Skalierungsmuster wie an anderer Stelle bereits verwendet (z.B.
// buildPdfFromScanPages/addFlaechenkartePage: Math.min(maxW/w, maxH/h)).
function layoutScanCropFrame(imgWidth, imgHeight) {
  const maxW = scanCropStage.clientWidth;
  const maxH = scanCropStage.clientHeight;
  const scale = Math.min(maxW / imgWidth, maxH / imgHeight);
  scanCropFrame.style.width = (imgWidth * scale) + 'px';
  scanCropFrame.style.height = (imgHeight * scale) + 'px';
}
// Bei Drehung/Größenänderung des Bildschirms während offener Ecken-
// Korrektur (z.B. Orientierungswechsel) neu vermessen, sonst bliebe der
// Rahmen auf der alten Bildschirmgröße stehen.
window.addEventListener('resize', () => {
  if (!scanCropView.hidden && scanCropRawCanvas) {
    layoutScanCropFrame(scanCropRawCanvas.width, scanCropRawCanvas.height);
  }
});

function setScanStatus(msg) { scanStatusEl.textContent = msg; }

function startScanDetectLoop() {
  clearInterval(scanDetectTimer);
  scanDetectTimer = setInterval(runScanDetectFrame, SCAN_DETECT_INTERVAL_MS);
}

async function openScanModal(ev) {
  scanCurrentEvent = ev;
  scanPages = [];
  renderScanThumbnails();
  scanModal.hidden = false;
  scanCameraView.hidden = false;
  scanCropView.hidden = true;
  scanBtnCapture.disabled = true;
  scanBtnFinish.disabled = true;
  setScanStatus('Scan-Werkzeug wird geladen …');
  try {
    await ensureScanLibs();
  } catch (err) {
    console.error('Scan-Bibliotheken konnten nicht geladen werden', err);
    setScanStatus('Scan-Werkzeug konnte nicht geladen werden — bitte stattdessen „Foto aufnehmen" nutzen.');
    return;
  }
  scanJscanify = scanJscanify || new window.jscanify();
  setScanStatus('Kamera wird gestartet …');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    console.error('Kamerazugriff fehlgeschlagen', err);
    setScanStatus('Kein Kamerazugriff — bitte stattdessen „Foto aufnehmen" nutzen.');
    return;
  }
  scanVideo.srcObject = scanStream;
  await scanVideo.play();
  setScanStatus('Dokument in den Rahmen halten.');
  scanBtnCapture.disabled = false;
  startScanDetectLoop();
}

function runScanDetectFrame() {
  if (!scanVideo.videoWidth) return;
  scanRawCanvas.width = scanVideo.videoWidth;
  scanRawCanvas.height = scanVideo.videoHeight;
  scanRawCanvas.getContext('2d').drawImage(scanVideo, 0, 0);
  let highlighted;
  try {
    highlighted = scanJscanify.highlightPaper(scanRawCanvas);
  } catch (err) {
    return; // vereinzelte Frame-Fehler ignorieren, nächster Versuch folgt automatisch
  }
  scanPreviewCanvas.width = highlighted.width;
  scanPreviewCanvas.height = highlighted.height;
  scanPreviewCanvas.getContext('2d').drawImage(highlighted, 0, 0);
}

function stopScanCamera() {
  clearInterval(scanDetectTimer);
  scanDetectTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}

function closeScanModal() {
  if (scanPages.length && !confirm('Noch nicht als PDF gespeicherte Seiten verwerfen?')) return;
  stopScanCamera();
  scanModal.hidden = true;
  scanCurrentEvent = null;
}
document.getElementById('scan-btn-close').addEventListener('click', closeScanModal);

// ---- Aufnahme + Ecken-Korrektur ----
document.getElementById('scan-btn-capture').addEventListener('click', () => {
  if (!scanRawCanvas.width) return;
  clearInterval(scanDetectTimer);

  scanCropRawCanvas = document.createElement('canvas');
  scanCropRawCanvas.width = scanRawCanvas.width;
  scanCropRawCanvas.height = scanRawCanvas.height;
  scanCropRawCanvas.getContext('2d').drawImage(scanRawCanvas, 0, 0);

  const img = cv.imread(scanCropRawCanvas);
  const contour = scanJscanify.findPaperContour(img);
  const corners = contour ? scanJscanify.getCornerPoints(contour) : null;
  img.delete();
  if (contour) contour.delete();

  const w = scanCropRawCanvas.width, h = scanCropRawCanvas.height;
  const toPct = (p) => ({ x: (p.x / w) * 100, y: (p.y / h) * 100 });
  scanCropCorners = corners && corners.topLeftCorner && corners.topRightCorner && corners.bottomLeftCorner && corners.bottomRightCorner
    ? {
        topLeftCorner: toPct(corners.topLeftCorner),
        topRightCorner: toPct(corners.topRightCorner),
        bottomLeftCorner: toPct(corners.bottomLeftCorner),
        bottomRightCorner: toPct(corners.bottomRightCorner)
      }
    // Kein Papier erkannt: grobe Startposition nahe der Bildränder, statt
    // die Ecken-Korrektur ganz zu verweigern — Nutzer kann sie manuell
    // aufs Dokument ziehen.
    : {
        topLeftCorner: { x: 10, y: 10 },
        topRightCorner: { x: 90, y: 10 },
        bottomLeftCorner: { x: 10, y: 90 },
        bottomRightCorner: { x: 90, y: 90 }
      };

  document.getElementById('scan-crop-image').src = scanCropRawCanvas.toDataURL('image/jpeg', 0.9);
  scanCameraView.hidden = true;
  scanCropView.hidden = false;
  // Erst nachdem der Rahmen sichtbar ist (clientWidth/-Height sonst 0)
  // vermessen, dann die Griffe auf Basis der fertigen Rahmengröße setzen.
  layoutScanCropFrame(w, h);
  renderScanCropHandles();
});

function renderScanCropHandles() {
  ['topLeftCorner', 'topRightCorner', 'bottomLeftCorner', 'bottomRightCorner'].forEach((key) => {
    const handle = scanCropFrame.querySelector(`.scan-crop-handle[data-corner="${key}"]`);
    const p = scanCropCorners[key];
    handle.style.left = p.x + '%';
    handle.style.top = p.y + '%';
  });
  updateScanCropPolygon();
}

function updateScanCropPolygon() {
  const order = ['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'];
  const points = order.map(k => `${scanCropCorners[k].x},${scanCropCorners[k].y}`).join(' ');
  document.getElementById('scan-crop-polygon').setAttribute('points', points);
}

// Eckpunkt-Griffe per Drag verschieben — gleiches Pointer-Events-Muster wie
// wireEditToolbarDrag()/wireKulturplanBarDrag() (pointerdown auf dem
// Griff, pointermove/pointerup am document, Listener nach pointerup
// wieder entfernen). Positionen werden in % der Bildfläche gehalten, damit
// die Griffe unabhängig von der tatsächlichen Anzeigegröße korrekt sitzen.
scanCropFrame.querySelectorAll('.scan-crop-handle').forEach((handle) => {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const corner = handle.getAttribute('data-corner');
    function onMove(ev) {
      const rect = scanCropFrame.getBoundingClientRect();
      const x = Math.min(Math.max(((ev.clientX - rect.left) / rect.width) * 100, 0), 100);
      const y = Math.min(Math.max(((ev.clientY - rect.top) / rect.height) * 100, 0), 100);
      scanCropCorners[corner] = { x, y };
      handle.style.left = x + '%';
      handle.style.top = y + '%';
      updateScanCropPolygon();
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
});

document.getElementById('scan-crop-retake').addEventListener('click', () => {
  scanCropView.hidden = true;
  scanCameraView.hidden = false;
  startScanDetectLoop();
});

document.getElementById('scan-crop-confirm').addEventListener('click', () => {
  const w = scanCropRawCanvas.width, h = scanCropRawCanvas.height;
  const toPx = (p) => ({ x: (p.x / 100) * w, y: (p.y / 100) * h });
  const cornerPoints = {
    topLeftCorner: toPx(scanCropCorners.topLeftCorner),
    topRightCorner: toPx(scanCropCorners.topRightCorner),
    bottomLeftCorner: toPx(scanCropCorners.bottomLeftCorner),
    bottomRightCorner: toPx(scanCropCorners.bottomRightCorner)
  };
  const extracted = scanJscanify.extractPaper(scanCropRawCanvas, w, h, cornerPoints);
  const finalCanvas = extracted || scanCropRawCanvas;
  scanPages.push({ dataUrl: finalCanvas.toDataURL('image/jpeg', 0.9), width: finalCanvas.width, height: finalCanvas.height });
  renderScanThumbnails();
  scanBtnFinish.disabled = false;

  scanCropView.hidden = true;
  scanCameraView.hidden = false;
  startScanDetectLoop();
});

function renderScanThumbnails() {
  scanThumbnailsEl.innerHTML = scanPages.map((p, i) => `
    <div class="scan-thumb">
      <img src="${p.dataUrl}" alt="Seite ${i + 1}">
      <button type="button" class="scan-thumb-remove" data-idx="${i}" title="Seite entfernen">
        <span class="material-symbols-rounded icon">close</span>
      </button>
    </div>
  `).join('');
  scanThumbnailsEl.querySelectorAll('.scan-thumb-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      scanPages.splice(parseInt(btn.getAttribute('data-idx'), 10), 1);
      renderScanThumbnails();
      scanBtnFinish.disabled = scanPages.length === 0;
    });
  });
}

document.getElementById('scan-btn-finish').addEventListener('click', async () => {
  if (!scanPages.length || !scanCurrentEvent) return;
  const ev = scanCurrentEvent;
  const pages = scanPages;
  stopScanCamera();
  scanModal.hidden = true;
  scanCurrentEvent = null;
  const blob = buildPdfFromScanPages(pages);
  const ts = new Date().toISOString().slice(0, 10);
  const file = new File([blob], `Scan_${ts}.pdf`, { type: 'application/pdf' });
  await uploadTerminkalenderAttachment(ev, file);
});

// Eigenständiger "jede Seite füllt eine eigene PDF-Seite"-Helfer, ohne
// Bezug zu den bestehenden, an Karten-Screenshots gekoppelten
// jsPDF-Exporten (addFlaechenkartePage & Co.) — hier gibt es weder Titel
// noch Legende noch eine Karte, nur die gescannten Seiten selbst.
function buildPdfFromScanPages(pages) {
  const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  pages.forEach((p, i) => {
    if (i > 0) doc.addPage('a4', 'portrait');
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;
    const scale = Math.min(maxW / p.width, maxH / p.height);
    const imgW = p.width * scale;
    const imgH = p.height * scale;
    const imgX = (pageW - imgW) / 2;
    const imgY = (pageH - imgH) / 2;
    doc.addImage(p.dataUrl, 'JPEG', imgX, imgY, imgW, imgH);
  });
  return doc.output('blob');
}

function selectTerminkalenderEvent(id) {
  terminkalenderSelectedId = id;
  const ev = terminkalenderEvents.find(e => e.id === id);
  document.querySelectorAll('.tk-card').forEach(el => el.classList.toggle('selected', el.getAttribute('data-id') === id));
  renderTerminkalenderDetail(ev);
  if (ev && ev.lat != null && terminkalenderMap) terminkalenderMap.setView([ev.lat, ev.lng], 15);
}

const TK_WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function eventsForVisibleWeek() {
  const weekEnd = new Date(terminkalenderWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return terminkalenderEvents.filter(e => e.date >= terminkalenderWeekStart && e.date < weekEnd);
}

// Verschiebt einen Termin per Drag&Drop auf einen anderen Wochentag — eine
// evtl. per .ics ergänzte Uhrzeit bleibt dabei erhalten (nur der Kalendertag
// ändert sich), reine Datumstermine bleiben weiterhin ohne Uhrzeit. Rein
// lokale Änderung, wie bei allen anderen Terminkalender-Bearbeitungen erst mit
// "In Cloud speichern" dauerhaft.
function moveTerminkalenderEvent(id, targetDate) {
  const ev = terminkalenderEvents.find(e => e.id === id);
  if (!ev) return;
  if (ev.date.toDateString() === targetDate.toDateString()) return;
  const durationMs = ev.dateEnd ? ev.dateEnd - ev.date : null;
  const newDate = new Date(targetDate);
  newDate.setHours(ev.date.getHours(), ev.date.getMinutes(), ev.date.getSeconds(), 0);
  ev.date = newDate;
  if (durationMs != null) ev.dateEnd = new Date(newDate.getTime() + durationMs);
  if (ev.id === terminkalenderSelectedId) renderTerminkalenderDetail(ev);
  renderTerminkalenderGrid();
  setTerminkalenderStatus('Termin verschoben — nicht vergessen zu speichern.');
}

// Termine haben ohne .ics-Ergänzung keine Uhrzeit — statt eines fixen
// Stundenrasters daher eine Kartenliste je Wochentag, mit Uhrzeit-Präfix
// sobald eine per .ics bekannt ist. Karten sind per Drag&Drop auf einen
// anderen Tag verschiebbar.
function renderTerminkalenderGrid() {
  const weekEvents = eventsForVisibleWeek();

  const { week, year } = getISOWeek(terminkalenderWeekStart);
  const weekEndDisplay = new Date(terminkalenderWeekStart);
  weekEndDisplay.setDate(weekEndDisplay.getDate() + 6);
  const fmtShort = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  document.getElementById('tk-week-label').textContent =
    `KW ${week} · ${year} (${fmtShort(terminkalenderWeekStart)}–${fmtShort(weekEndDisplay)})`;

  let html = '';
  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(terminkalenderWeekStart);
    dayDate.setDate(dayDate.getDate() + d);
    const dayEvents = weekEvents
      .filter(e => e.date.toDateString() === dayDate.toDateString())
      .sort((a, b) => {
        if (a.hasTime && b.hasTime) return a.date - b.date;
        if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1; // Termine mit Uhrzeit zuerst
        return a.kunde.localeCompare(b.kunde, 'de');
      });

    const cardsHtml = dayEvents.map(e => {
      const selected = e.id === terminkalenderSelectedId ? ' selected' : '';
      const pin = e.lat != null ? ' <span class="material-symbols-rounded icon">location_on</span>' : '';
      const clip = (e.attachments && e.attachments.length) ? ' <span class="material-symbols-rounded icon">attach_file</span>' : '';
      const betriebMark = (activeZuordnung && activeZuordnung.terminId === e.id) ? ' <span class="material-symbols-rounded icon">business</span>' : '';
      const statusClass = e.bestaetigt ? 'tk-card-ok' : 'tk-card-warn';
      const timePrefix = e.hasTime ? e.date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' · ' : '';
      return `<div class="tk-card ${statusClass}${selected}" data-id="${escapeHtml(e.id)}" title="${escapeHtml(e.kunde)}" draggable="true">
        <div class="tk-card-title">${escapeHtml(e.kunde)}</div>
        <div class="tk-card-sub">${timePrefix}${escapeHtml(e.auditart)}${pin}${clip}${betriebMark}</div>
      </div>`;
    }).join('');

    const countBadge = dayEvents.length ? ` <span class="tk-day-count">${dayEvents.length}</span>` : '';
    html += `<div class="tk-day-col">
      <div class="tk-day-head">${TK_WEEKDAY_LABELS[d]} ${dayDate.getDate()}.${dayDate.getMonth() + 1}.${countBadge}</div>
      <div class="tk-day-body" data-date="${dayDate.toISOString()}">${cardsHtml || '<p class="tk-day-empty">–</p>'}</div>
    </div>`;
  }

  const grid = document.getElementById('terminkalender-grid');
  grid.innerHTML = html;
  grid.querySelectorAll('.tk-card').forEach(el => {
    el.addEventListener('click', () => {
      selectTerminkalenderEvent(el.getAttribute('data-id'));
      // Am Handy liegen die Details unter Liste und Karte — hinscrollen,
      // sonst passiert beim Antippen scheinbar nichts.
      if (window.matchMedia('(max-width: 860px)').matches) {
        document.getElementById('terminkalender-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.getAttribute('data-id'));
    });
  });
  grid.querySelectorAll('.tk-day-body').forEach(el => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('tk-drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('tk-drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('tk-drop-target');
      const id = e.dataTransfer.getData('text/plain');
      if (id) moveTerminkalenderEvent(id, new Date(el.getAttribute('data-date')));
    });
  });

  renderTerminkalenderMapPins(weekEvents.filter(e => e.lat != null));
}

function gotoWeek(delta) {
  terminkalenderWeekStart = new Date(terminkalenderWeekStart);
  terminkalenderWeekStart.setDate(terminkalenderWeekStart.getDate() + delta * 7);
  renderTerminkalenderGrid();
}

document.getElementById('tk-prev-week').addEventListener('click', () => gotoWeek(-1));
document.getElementById('tk-next-week').addEventListener('click', () => gotoWeek(1));
document.getElementById('tk-today').addEventListener('click', () => {
  terminkalenderWeekStart = getMondayOfWeek(new Date());
  renderTerminkalenderGrid();
});

document.getElementById('terminkalender-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  document.getElementById('terminkalender-file-name').textContent = file.name;
  document.getElementById('terminkalender-drop').classList.add('filled');
  setTerminkalenderStatus('Lese Datei …');
  try {
    const buf = await file.arrayBuffer();
    const parsed = parseXlsxFile(buf);
    if (!parsed.length) throw new Error('Keine gültigen Termine in der Datei gefunden.');
    const { added, updated } = mergeTerminkalenderEvents(parsed);
    renderTerminkalenderSummary();
    renderTerminkalenderGrid();
    setTerminkalenderStatus(`${added} neu, ${updated} aktualisiert.`);
    await geocodeMissingAddresses();
    setTerminkalenderStatus('Fertig.');
  } catch (err) {
    setTerminkalenderStatus('Fehler: ' + (err.message || 'Datei konnte nicht gelesen werden.'));
  }
});

document.getElementById('terminkalender-ics-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  document.getElementById('terminkalender-ics-file-name').textContent = file.name;
  document.getElementById('terminkalender-ics-drop').classList.add('filled');
  if (!terminkalenderEvents.length) { setTerminkalenderStatus('Bitte zuerst die Excel-Termine hochladen.'); return; }
  setTerminkalenderStatus('Lese Uhrzeiten …');
  try {
    const text = await file.text();
    const icsEvents = parseIcsFile(text);
    if (!icsEvents.length) throw new Error('Keine Termine in der .ics-Datei gefunden.');
    const { matched, unmatched } = applyIcsTimes(icsEvents);
    renderTerminkalenderGrid();
    setTerminkalenderStatus(`${matched} Uhrzeiten übernommen, ${unmatched} ohne passenden Termin.`);
  } catch (err) {
    setTerminkalenderStatus('Fehler: ' + (err.message || '.ics-Datei konnte nicht gelesen werden.'));
  }
});

document.getElementById('terminkalender-btn-save').addEventListener('click', async () => {
  setTerminkalenderStatus('Speichere …');
  try {
    await saveFullState();
    setTerminkalenderStatus('Gespeichert.');
  } catch (err) {
    setTerminkalenderStatus('Fehler: ' + (err.message || 'Speichern fehlgeschlagen.'));
  }
});

// ---------- FeldFolio Plus: Betrieb/Termin-Zuordnung ----------
// Verbindet den Terminkalender mit den Flächen-Werkzeugen: eine globale, in
// der Kopfzeile sitzende Auswahl (Betrieb oder ein konkreter Termin), die
// bestimmt, wie neue Exporte und hochgeladene Fotos/Dateien in Jahresvergleich/
// Flächenzeichner/Obstbaumkataster/Bienenflugkarte benannt werden: statt des
// bisherigen generischen Datumsnamens dann Jahr_Betrieb_Art (siehe
// zuordnungFileName). Terminkalender-Anhänge kennen ihren Betrieb/Jahr schon
// über das jeweilige Termin selbst (siehe handleTerminkalenderFileAdd) und
// hängen absichtlich NICHT von dieser globalen Auswahl ab. Betriebe kommen
// automatisch aus den eindeutigen Kundennamen der hochgeladenen Termine.xlsx,
// plus manuell ergänzbaren Namen (manualBetriebe, Cloud-persistiert) für
// Betriebe ohne aktuellen Termin.
let manualBetriebe = [];
let activeZuordnung = null; // { betrieb, year, terminId, terminLabel } | null

function sanitizeFileNamePart(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '-').trim();
}

// null, wenn keine Zuordnung aktiv ist — Aufrufer fallen dann auf den
// bisherigen generischen Dateinamen zurück (siehe Export-Funktionen).
function zuordnungFileName(art, ext) {
  if (!activeZuordnung) return null;
  return `${activeZuordnung.year}_${sanitizeFileNamePart(activeZuordnung.betrieb)}_${art}.${ext}`;
}

function getBetriebNamesFromTermine() {
  return [...new Set(terminkalenderEvents.map(e => e.kunde).filter(Boolean))];
}

function getAllBetriebNamen() {
  return [...new Set([...getBetriebNamesFromTermine(), ...manualBetriebe])].sort((a, b) => a.localeCompare(b, 'de'));
}

const btnBetrieb = document.getElementById('btn-betrieb');
const btnBetriebLabel = document.getElementById('btn-betrieb-label');
const betriebModal = document.getElementById('betrieb-modal-overlay');
const betriebNotConfigured = document.getElementById('betrieb-not-configured');
const betriebEditor = document.getElementById('betrieb-editor');
const betriebSearch = document.getElementById('betrieb-search');
const betriebCurrent = document.getElementById('betrieb-current');
const betriebCurrentLabel = document.getElementById('betrieb-current-label');
const betriebNoassignHint = document.getElementById('betrieb-noassign-hint');
const betriebListEl = document.getElementById('betrieb-list');
const betriebError = document.getElementById('betrieb-error');
const betriebManualInput = document.getElementById('betrieb-manual-input');
const betriebSwitchStatus = document.getElementById('betrieb-switch-status');
let betriebSwitchInProgress = false;

function showBetriebError(msg) {
  betriebError.textContent = msg;
  betriebError.hidden = !msg;
}

function tkFmtDate(d) {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function updateBetriebButton() {
  btnBetrieb.classList.toggle('active', !!activeZuordnung);
  btnBetriebLabel.innerHTML = activeZuordnung
    ? `<span class="material-symbols-rounded icon">business</span> <span class="btn-betrieb-name">${escapeHtml(activeZuordnung.betrieb)}</span>`
    : '<span class="material-symbols-rounded icon">business</span> <span class="btn-betrieb-name">Betrieb wählen</span>';
  btnBetrieb.title = activeZuordnung ? `Betrieb: ${activeZuordnung.betrieb} — antippen zum Wechseln` : 'Betrieb/Termin zuordnen';
}

function updateBetriebCurrentBox() {
  if (activeZuordnung) {
    betriebCurrent.hidden = false;
    betriebCurrentLabel.textContent = activeZuordnung.terminId
      ? `${activeZuordnung.betrieb} — ${activeZuordnung.terminLabel}`
      : activeZuordnung.betrieb;
  } else {
    betriebCurrent.hidden = true;
  }
}

function setActiveZuordnung(z) {
  activeZuordnung = z;
  updateBetriebButton();
  updateBetriebCurrentBox();
  // Aktualisiert das Betrieb-Icon an den Kalenderkarten und das Zuordnen-Icon im
  // Detail-Panel — läuft für JEDEN Auswahlweg (Kopfzeilen-Dropdown UND der
  // "Als Betrieb zuordnen"-Button im Terminkalender selbst), da beide über
  // diese Funktion gehen.
  if (typeof renderTerminkalenderGrid === 'function') renderTerminkalenderGrid();
  if (typeof terminkalenderSelectedId !== 'undefined' && terminkalenderSelectedId) {
    const selectedEv = terminkalenderEvents.find(e => e.id === terminkalenderSelectedId);
    if (selectedEv) renderTerminkalenderDetail(selectedEv);
  }
}

// Solange im "Kein Betrieb"-Workspace etwas geladen ist, bekommt jede Zeile
// zusätzlich einen "Zuordnen"-Button (siehe renderBetriebList) — der klare
// Weg für "das hier ohne Betrieb Gezeichnete jetzt einem Betrieb zuordnen",
// statt nur wortlos zu wechseln (was den Inhalt in seinem eigenen Slot
// beließe, siehe assignNoBetriebContentTo weiter oben).
function canAssignNoBetriebContent() {
  return currentWorkspaceKey === NO_BETRIEB_KEY && currentWorkspaceHasContent();
}

function renderBetriebList() {
  const q = betriebSearch.value.trim().toLowerCase();
  const betriebe = getAllBetriebNamen().filter(n => !q || n.toLowerCase().includes(q));
  const manualSet = new Set(manualBetriebe);
  const showAssign = canAssignNoBetriebContent();

  let html = '<div class="betrieb-list-group"><div class="betrieb-list-group-title">Betriebe</div>';
  if (betriebe.length) {
    html += betriebe.map(name => `
      <div class="betrieb-row" data-action="select-betrieb" data-name="${escapeHtml(name)}">
        <span class="betrieb-row-main">${escapeHtml(name)}</span>
        ${showAssign ? `<button type="button" class="betrieb-row-assign" data-action="assign-betrieb" data-name="${escapeHtml(name)}" title="Inhalte ohne Betrieb diesem Betrieb zuordnen">Zuordnen</button>` : ''}
        ${manualSet.has(name) ? `<button type="button" class="betrieb-row-remove" data-action="remove-manual" data-name="${escapeHtml(name)}" title="Manuell hinzugefügten Betrieb entfernen"><span class="material-symbols-rounded icon">close</span></button>` : ''}
      </div>`).join('');
  } else {
    html += '<div class="betrieb-list-empty">Keine Betriebe gefunden.</div>';
  }
  html += '</div>';

  if (q) {
    const termine = terminkalenderEvents.filter(e => `${e.kunde} ${e.auditart} ${tkFmtDate(e.date)}`.toLowerCase().includes(q))
      .sort((a, b) => a.date - b.date)
      .slice(0, 30);
    html += '<div class="betrieb-list-group"><div class="betrieb-list-group-title">Termine</div>';
    if (termine.length) {
      html += termine.map(e => `
        <div class="betrieb-row" data-action="select-termin" data-id="${escapeHtml(e.id)}">
          <span class="betrieb-row-main">${escapeHtml(e.kunde)}<span class="betrieb-row-sub"> · ${tkFmtDate(e.date)} · ${escapeHtml(e.auditart)}</span></span>
          ${showAssign ? `<button type="button" class="betrieb-row-assign" data-action="assign-termin" data-id="${escapeHtml(e.id)}" title="Inhalte ohne Betrieb diesem Betrieb zuordnen">Zuordnen</button>` : ''}
        </div>`).join('');
    } else {
      html += '<div class="betrieb-list-empty">Keine Termine gefunden.</div>';
    }
    html += '</div>';
  }

  betriebListEl.innerHTML = html;
}

// Wechselt — falls nötig — den geladenen Ebenen/Baum/Bienenflug-Workspace auf
// den zum gewählten Betrieb gehörenden (siehe switchWorkspace weiter oben):
// wählt man nur einen ANDEREN Termin DESSELBEN bereits aktiven Betriebs, ist
// der Workspace identisch — dann wird nur die Zuordnung (fürs Dateinamen-
// Schema) aktualisiert, ohne Karten-Neuladen.
async function applyZuordnungSelection(z) {
  const newKey = z ? z.betrieb : NO_BETRIEB_KEY;
  if (newKey === currentWorkspaceKey) {
    setActiveZuordnung(z);
    closeBetriebModal();
    return;
  }
  betriebSwitchInProgress = true;
  betriebSwitchStatus.textContent = `Wechsle zu „${newKey === NO_BETRIEB_KEY ? 'kein Betrieb' : newKey}" …`;
  try {
    await switchWorkspace(currentWorkspaceKey, newKey);
    currentWorkspaceKey = newKey;
    setActiveZuordnung(z);
    betriebSwitchStatus.textContent = '';
    closeBetriebModal();
  } catch (err) {
    betriebSwitchStatus.textContent = 'Fehler: ' + (err.message || 'Betrieb-Wechsel fehlgeschlagen.');
  } finally {
    betriebSwitchInProgress = false;
  }
}

// Wie applyZuordnungSelection(), aber verschiebt statt nur zu wechseln —
// siehe assignNoBetriebContentTo() weiter oben.
async function applyAssignSelection(z) {
  betriebSwitchInProgress = true;
  betriebSwitchStatus.textContent = `Ordne Inhalte „${z.betrieb}" zu …`;
  try {
    await assignNoBetriebContentTo(z);
    betriebSwitchStatus.textContent = '';
    closeBetriebModal();
  } catch (err) {
    betriebSwitchStatus.textContent = 'Fehler: ' + (err.message || 'Zuordnen fehlgeschlagen.');
  } finally {
    betriebSwitchInProgress = false;
  }
}

betriebListEl.addEventListener('click', async (e) => {
  if (betriebSwitchInProgress) return;
  const row = e.target.closest('[data-action]');
  if (!row) return;
  const action = row.getAttribute('data-action');
  if (action === 'select-betrieb') {
    await applyZuordnungSelection({ betrieb: row.getAttribute('data-name'), year: new Date().getFullYear(), terminId: null, terminLabel: null });
  } else if (action === 'select-termin') {
    const ev = terminkalenderEvents.find(x => x.id === row.getAttribute('data-id'));
    if (!ev) return;
    await applyZuordnungSelection({ betrieb: ev.kunde, year: ev.date.getFullYear(), terminId: ev.id, terminLabel: `${tkFmtDate(ev.date)} · ${ev.auditart}` });
  } else if (action === 'assign-betrieb') {
    await applyAssignSelection({ betrieb: row.getAttribute('data-name'), year: new Date().getFullYear(), terminId: null, terminLabel: null });
  } else if (action === 'assign-termin') {
    const ev = terminkalenderEvents.find(x => x.id === row.getAttribute('data-id'));
    if (!ev) return;
    await applyAssignSelection({ betrieb: ev.kunde, year: ev.date.getFullYear(), terminId: ev.id, terminLabel: `${tkFmtDate(ev.date)} · ${ev.auditart}` });
  } else if (action === 'remove-manual') {
    const name = row.getAttribute('data-name');
    const wasActive = activeZuordnung && !activeZuordnung.terminId && activeZuordnung.betrieb === name;
    manualBetriebe = manualBetriebe.filter(n => n !== name);
    if (wasActive) {
      // applyZuordnungSelection() wechselt den Workspace UND speichert dabei
      // bereits den aktualisierten manualBetriebe-Stand mit — ein zusätzliches
      // saveFullState() danach wäre nur ein überflüssiger zweiter Request.
      await applyZuordnungSelection(null);
      renderBetriebList();
    } else {
      renderBetriebList();
      try { await saveFullState(); } catch (err) { showBetriebError(err.message || 'Speichern fehlgeschlagen.'); }
    }
  }
});

betriebSearch.addEventListener('input', renderBetriebList);

document.getElementById('betrieb-manual-add').addEventListener('click', async () => {
  const name = betriebManualInput.value.trim();
  if (!name) return;
  showBetriebError('');
  if (!getAllBetriebNamen().includes(name)) manualBetriebe.push(name);
  betriebManualInput.value = '';
  renderBetriebList();
  try {
    await saveFullState();
  } catch (err) {
    showBetriebError(err.message || 'Speichern fehlgeschlagen.');
  }
});
betriebManualInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('betrieb-manual-add').click(); }
});

document.getElementById('betrieb-btn-clear').addEventListener('click', () => {
  if (betriebSwitchInProgress) return;
  applyZuordnungSelection(null);
});

function openBetriebModal() {
  showBetriebError('');
  betriebSwitchStatus.textContent = '';
  betriebSearch.value = '';
  const loggedIn = isSupabaseConfigured && !!accountSession;
  betriebNotConfigured.hidden = loggedIn;
  betriebEditor.hidden = !loggedIn;
  if (loggedIn) {
    updateBetriebCurrentBox();
    betriebNoassignHint.hidden = !canAssignNoBetriebContent();
    renderBetriebList();
  }
  betriebModal.hidden = false;
}
function closeBetriebModal() { betriebModal.hidden = true; }

btnBetrieb.addEventListener('click', openBetriebModal);
['betrieb-modal-close-1', 'betrieb-modal-close-2'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeBetriebModal);
});
betriebModal.addEventListener('click', (e) => { if (e.target === betriebModal) closeBetriebModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !betriebModal.hidden) closeBetriebModal(); });

// ======================================================================
// ---------- Stallplaner ----------
// Eigenständiges Grundriss-Zeichenwerkzeug, bewusst OHNE Kartenbezug
// (anders als Hofplan) — rohes SVG statt Leaflet. Koordinaten liegen in
// Rastereinheiten (nicht Pixel), sodass Zoom/Maßstabsänderung nie eine
// Punktkoordinate anfassen muss: Fläche = shoelace(points) * gridScale².
// ======================================================================

// EU-Öko-VO-Flächenwerte: Anhang I VO (EU) 2018/848 i.d.F. DVO (EU)
// 2020/464 (Mindestanforderungen Stallfläche je Tier/Kategorie). Geprüft
// wird ausschließlich die Stallfläche (kein Auslauf — dieses Werkzeug
// zeichnet nur Innenraum-Grundrisse). Zwei Einheiten:
//  - 'qm_pro_tier': benötigteFläche = Tierzahl * indoorQm
//  - 'kg_je_qm': für Geflügel — entweder mit Gewichtsvorgabe
//    (indoorKgJeQm, braucht ein Ø-Gewicht je Tier) oder mit fester
//    Stückzahlvorgabe (indoorTiereJeQm, kein Gewicht nötig).
// Die >350kg-Zeile bei Rindern/Pferden hat laut VO zusätzlich eine
// "mindestens 1 m²/100kg"-Nebenbedingung — hier bewusst vereinfacht
// weggelassen (siehe Hinweistext in der UI), reine indoorQm-Prüfung
// deckt die große Mehrheit der Fälle ab. Fest hinterlegt, nicht
// nutzerseitig editierbar (siehe Rücksprache mit dem Auftraggeber) —
// KEINE Rechtsberatung, im Zweifel gegen den Originaltext prüfen.
const OEKO_VO_KATEGORIEN = [
  // Rinder
  { id: 'rind_kalb', tierart: 'rinder', label: 'Kälber (bis 100 kg)', unit: 'qm_pro_tier', indoorQm: 1.5 },
  { id: 'rind_jungvieh', tierart: 'rinder', label: 'Jungvieh (bis 200 kg)', unit: 'qm_pro_tier', indoorQm: 2.5 },
  { id: 'rind_wachsend', tierart: 'rinder', label: 'Wachsende Rinder (bis 350 kg)', unit: 'qm_pro_tier', indoorQm: 4.0 },
  { id: 'rind_adult', tierart: 'rinder', label: 'Rinder (über 350 kg)', unit: 'qm_pro_tier', indoorQm: 5 },
  { id: 'rind_milchkuh', tierart: 'rinder', label: 'Milchkühe', unit: 'qm_pro_tier', indoorQm: 6 },
  { id: 'rind_zuchtbulle', tierart: 'rinder', label: 'Zuchtbullen', unit: 'qm_pro_tier', indoorQm: 10 },
  // Schafe/Ziegen
  { id: 'schaf_adult', tierart: 'schafe_ziegen', label: 'Schafe (adult)', unit: 'qm_pro_tier', indoorQm: 1.5 },
  { id: 'schaf_lamm', tierart: 'schafe_ziegen', label: 'Lämmer', unit: 'qm_pro_tier', indoorQm: 0.35 },
  { id: 'ziege_adult', tierart: 'schafe_ziegen', label: 'Ziegen (adult)', unit: 'qm_pro_tier', indoorQm: 1.5 },
  { id: 'ziege_kitz', tierart: 'schafe_ziegen', label: 'Kitze', unit: 'qm_pro_tier', indoorQm: 0.35 },
  // Pferde/Equiden (gleiche Gewichtsstaffelung wie Rinder)
  { id: 'pferd_100', tierart: 'pferde', label: 'Pferde (bis 100 kg)', unit: 'qm_pro_tier', indoorQm: 1.5 },
  { id: 'pferd_200', tierart: 'pferde', label: 'Pferde (bis 200 kg)', unit: 'qm_pro_tier', indoorQm: 2.5 },
  { id: 'pferd_350', tierart: 'pferde', label: 'Pferde (bis 350 kg)', unit: 'qm_pro_tier', indoorQm: 4.0 },
  { id: 'pferd_adult', tierart: 'pferde', label: 'Pferde (über 350 kg)', unit: 'qm_pro_tier', indoorQm: 5 },
  // Schweine
  { id: 'schwein_saeugend', tierart: 'schweine', label: 'Säugende Sauen mit Ferkeln (je Sau)', unit: 'qm_pro_tier', indoorQm: 7.5 },
  { id: 'schwein_ferkel', tierart: 'schweine', label: 'Abgesetzte Ferkel (bis 35 kg)', unit: 'qm_pro_tier', indoorQm: 0.6 },
  { id: 'schwein_35_50', tierart: 'schweine', label: 'Mastschweine (35–50 kg)', unit: 'qm_pro_tier', indoorQm: 0.8 },
  { id: 'schwein_50_85', tierart: 'schweine', label: 'Mastschweine (50–85 kg)', unit: 'qm_pro_tier', indoorQm: 1.1 },
  { id: 'schwein_85_110', tierart: 'schweine', label: 'Mastschweine (85–110 kg)', unit: 'qm_pro_tier', indoorQm: 1.3 },
  { id: 'schwein_mast', tierart: 'schweine', label: 'Mastschweine (über 110 kg)', unit: 'qm_pro_tier', indoorQm: 1.5 },
  { id: 'schwein_trocken', tierart: 'schweine', label: 'Trockenstehende/tragende Sauen', unit: 'qm_pro_tier', indoorQm: 2.5 },
  { id: 'schwein_eber', tierart: 'schweine', label: 'Zuchteber', unit: 'qm_pro_tier', indoorQm: 6 },
  // Geflügel (Gewichts-/Stückzahl-basiert)
  { id: 'gefl_zucht', tierart: 'gefluegel', label: 'Zuchttiere', unit: 'kg_je_qm', indoorTiereJeQm: 6 },
  { id: 'gefl_junghennen', tierart: 'gefluegel', label: 'Junghennen/Junghähne (Aufzucht)', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_legehenne', tierart: 'gefluegel', label: 'Legehennen', unit: 'kg_je_qm', indoorTiereJeQm: 6 },
  { id: 'gefl_broiler_fest', tierart: 'gefluegel', label: 'Masthähnchen (fester Stall)', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_broiler_mobil', tierart: 'gefluegel', label: 'Masthähnchen (mobiler Stall)', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_kapaun', tierart: 'gefluegel', label: 'Kapaune/Poularden', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_pute', tierart: 'gefluegel', label: 'Puten', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_gans', tierart: 'gefluegel', label: 'Gänse', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_ente', tierart: 'gefluegel', label: 'Enten', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  { id: 'gefl_perlhuhn', tierart: 'gefluegel', label: 'Perlhühner', unit: 'kg_je_qm', indoorKgJeQm: 21 },
  // Kaninchen
  { id: 'kanin_saeugend_leicht', tierart: 'kaninchen', label: 'Säugende Häsinnen (bis 6 kg)', unit: 'qm_pro_tier', indoorQm: 0.6 },
  { id: 'kanin_saeugend_schwer', tierart: 'kaninchen', label: 'Säugende Häsinnen (über 6 kg)', unit: 'qm_pro_tier', indoorQm: 0.72 },
  { id: 'kanin_zucht', tierart: 'kaninchen', label: 'Tragende/Zuchthäsinnen', unit: 'qm_pro_tier', indoorQm: 0.5 },
  { id: 'kanin_mast', tierart: 'kaninchen', label: 'Masttiere', unit: 'qm_pro_tier', indoorQm: 0.2 },
  { id: 'kanin_aufzucht', tierart: 'kaninchen', label: 'Tiere nach dem Absetzen (bis 6 Monate)', unit: 'qm_pro_tier', indoorQm: 0.2 },
  { id: 'kanin_rammler', tierart: 'kaninchen', label: 'Zuchtrammler', unit: 'qm_pro_tier', indoorQm: 0.6 }
];

const STALLPLANER_EQUIPMENT_ICON_NAMES = {
  traenke: 'water_drop', raufe: 'grass', futterautomat: 'restaurant', nest: 'egg',
  sitzstange: 'drag_handle', tuer: 'door_front', fenster: 'window', futtergang: 'route'
};
// Ausstattung ist nicht immer nur ein Punkt: eine Sitzstange ist eine
// Linie, eine Tür/ein Fenster sitzt als Linie in der Wand, ein Futtergang
// ist eine Fläche zwischen Abteilen, eine Futterraufe kann ebenfalls
// Stallfläche wegnehmen. Die Form ist unabhängig vom Typ frei wählbar
// (siehe #stallplaner-equip-geometry-toggle) — das hier ist nur der
// sinnvolle Vorschlag, der beim Anklicken eines Typs automatisch
// vorausgewählt wird.
const STALLPLANER_EQUIP_DEFAULT_GEOMETRY = {
  sitzstange: 'line', tuer: 'line', fenster: 'line', futtergang: 'area'
};

function benoetigteFlaecheOekoVo(kategorie, tieranzahl, avgGewichtKg) {
  if (!kategorie || !tieranzahl) return 0;
  if (kategorie.unit === 'qm_pro_tier') return tieranzahl * kategorie.indoorQm;
  if (kategorie.indoorTiereJeQm) return tieranzahl / kategorie.indoorTiereJeQm;
  return (tieranzahl * (avgGewichtKg || 0)) / kategorie.indoorKgJeQm;
}
// Ein Abteil kann mehrere Tier-Kategorien gleichzeitig beherbergen (z.B.
// Kälber + Milchkühe im selben Abteil) — die benötigte Fläche je Kategorie
// wird aufsummiert und als Ganzes gegen die gezeichnete Abteilfläche geprüft.
function compartmentBenoetigteFlaeche(c) {
  return (c.tierbestand || []).reduce((sum, tb) => {
    const kategorie = OEKO_VO_KATEGORIEN.find(k => k.id === tb.kategorieId);
    return sum + (kategorie ? benoetigteFlaecheOekoVo(kategorie, tb.tieranzahl, tb.avgGewichtKg) : 0);
  }, 0);
}
function newTierbestandEntry() {
  return { id: 'tb-' + Date.now() + Math.random().toString(36).slice(2), kategorieId: null, tieranzahl: 0, avgGewichtKg: null };
}
// Rückwärtskompatibel für Stallpläne aus der ersten Version (eine einzelne
// kategorieId/tieranzahl/avgGewichtKg-Kombination je Abteil statt einer
// tierbestand-Liste) — greift beim Laden einer alten .json-Exportdatei oder
// eines alten Cloud-Stands.
function normalizeCompartment(c) {
  if (!Array.isArray(c.tierbestand)) {
    c.tierbestand = c.kategorieId
      ? [{ id: newTierbestandEntry().id, kategorieId: c.kategorieId, tieranzahl: c.tieranzahl || 0, avgGewichtKg: c.avgGewichtKg || null }]
      : [];
  }
  delete c.kategorieId; delete c.tieranzahl; delete c.avgGewichtKg;
  return c;
}
// Rückwärtskompatibel für Ausstattung aus der ersten Version (einzelnes
// x/y-Punktpaar statt einer points-Liste, immer Punktform) — greift beim
// Laden einer alten .json-Exportdatei oder eines alten Cloud-Stands.
function normalizeEquipment(e) {
  if (!Array.isArray(e.points)) {
    e.points = [{ x: e.x, y: e.y }];
    delete e.x; delete e.y;
  }
  if (!e.geometryKind) e.geometryKind = 'point';
  return e;
}

// ---- Zustand ----
let stallplaene = [];
let activeStallplanId = null;
let stallplanerInitDone = false;
// null|'draw-outline'|'draw-compartment'|'place-equipment'|'edit-vertex'|'measure'|'delete'
let stallplanerMode = null;
let stallplanerEquipType = 'traenke';
let stallplanerEquipGeometryKind = 'point'; // 'point' | 'line' | 'area'
let stallplanerDrawPoints = null; // Punkte des gerade laufenden Zeichenvorgangs
let stallplanerEditTargetKind = null; // 'outline' | 'compartment' | 'equipment'
let stallplanerEditTargetId = null; // Abteil-/Ausstattungs-Id, oder null für Umriss
let stallplanerUndoStack = [];
let stallplanerRedoStack = [];
const STALLPLANER_UNDO_MAX = 20;
// ---- Geführter Vermessen-Modus (siehe startStallplanMeasureWalk()) ----
let stallplanerMeasureTargetKind = null; // 'outline' | 'compartment'
let stallplanerMeasureTargetId = null;
let stallplanerMeasureOriginalPoints = null; // Skizzen-Punkte bei Start (Drehrichtung wird daraus abgeleitet)
let stallplanerMeasureLengths = null; // bereits eingetragene echte Längen (Meter), Index = Kante
let stallplanerMeasureIndex = 0;
// ---- Vor-Ort-Oberfläche (siehe renderStallplanerChrome()) ----
let stallplanerStep = 'umriss'; // 'umriss' | 'abteile' | 'ausstattung' | 'tiere'
let stallplanerSheetPanel = null; // id des sichtbaren .stallplaner-panel im Bottom Sheet
let stallplanerSelection = null; // { kind: 'outline'|'compartment'|'equipment', id }
// Laufende Maß-Eingabe: { type: 'rect'|'walls'|'split', target, start, segments, ... }
let stallplanerTask = null;
let stallplanerFlashMsg = null;
let stallplanerFlashTimer = null;
let stallplanerWakeLock = null;
// Wächst automatisch mit dem Inhalt mit (nie schrumpfend), solange die
// Ansicht nicht manuell verändert wurde — sobald der Nutzer zoomt, per Drag
// verschiebt, oder eine Form zur Bearbeitung anklickt (siehe
// focusStallplanShape()), übernimmt stallplanerViewLocked und das
// automatische Mitwachsen pausiert, bis "Ansicht anpassen" das wieder
// zurücksetzt. Ohne diese Unterscheidung würde jede Mutation (z.B. ein
// Vertex-Drag) die manuell gesetzte Ansicht sofort wieder überschreiben.
let stallplanerViewBox = { x: 0, y: 0, w: 20, h: 15 };
let stallplanerViewLocked = false;
const STALLPLANER_VIEW_MIN_W = 1.5;
const STALLPLANER_VIEW_MAX_W = 400;

function activeStallplan() {
  return stallplaene.find(p => p.id === activeStallplanId) || null;
}
function newStallplanId() { return 'stallplan-' + Date.now() + Math.random().toString(36).slice(2); }
function createEmptyStallplan(name) {
  return {
    id: newStallplanId(), name: name || 'Neuer Stallplan', tierart: null,
    gridScale: 1, gridSnap: true, outline: null, compartments: [], equipment: [],
    updatedAt: new Date().toISOString()
  };
}

// ---- Geometrie-Hilfsfunktionen ----
function shoelaceArea(points) {
  if (!points || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
function polygonCentroid(points) {
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}
// Grobe Selbstüberschneidungs-Erkennung (nur zur visuellen Warnung, blockiert
// das Zeichnen nicht) — prüft alle nicht direkt benachbarten Kantenpaare.
function polygonSelfIntersects(points) {
  if (!points || points.length < 4) return false;
  const segs = points.map((p, i) => [p, points[(i + 1) % points.length]]);
  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  const segIntersect = ([a, b], [c, d]) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === segs.length - 1)) continue; // benachbart, teilt sich einen Eckpunkt
      if (segIntersect(segs[i], segs[j])) return true;
    }
  }
  return false;
}

// Akzeptiert "12,40" genauso wie "12.4" — Handy-Tastaturen liefern je nach
// Sprache Komma oder Punkt, type="number" verschluckt das Komma teils.
function parseDecimalInput(value) {
  const str = String(value == null ? '' : value).trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(str)) return NaN;
  return parseFloat(str);
}
function pointInPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// Grenzen eines achsenparallelen Rechtecks, sonst null — nur solche Flächen
// lassen sich per "In Buchten teilen" aufteilen.
function axisAlignedRectBounds(points) {
  if (!points || points.length !== 4) return null;
  const eps = 1e-6;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > eps && Math.abs(a.y - b.y) > eps) return null;
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return bounds.maxX - bounds.minX > eps && bounds.maxY - bounds.minY > eps ? bounds : null;
}
// Zwei gleich gerichtete Wände hintereinander (z.B. zweimal "rechts") sind
// eine Wand — sonst würde das spätere Vermessen dort eine Ecke erwarten.
function simplifyCollinearPoints(points) {
  const out = points.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
      const dot = (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y);
      if (Math.abs(cross) < 1e-9 && dot >= 0) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

// Baut ein Polygon aus einer groben Skizze und echten, vor Ort gemessenen
// Kantenlängen neu auf — für den geführten Vermessen-Modus (siehe
// startStallplanMeasureWalk()). Kantenlängen allein legen die Form eines
// Vielecks mit mehr als drei Seiten NICHT fest (es bleibt wie ein
// Scharniergelenk verformbar) — die fehlenden Winkel kommen aus der Skizze:
//   * Ecken, die in der Skizze ungefähr rechtwinklig (bzw. gerade) sind
//     (± STALLPLAN_RIGHT_ANGLE_TOLERANCE), werden auf exakt 90° (bzw. 0°)
//     gesetzt — gebaut wird meist rechtwinklig, die Skizze mit dem Finger
//     ist nie genau.
//   * Alle anderen Ecken (schräge Wände) behalten zunächst ihren Winkel aus
//     der Skizze; NUR diese Winkel werden so nachgestellt, dass sich die
//     Form mit den gemessenen Längen schließt.
// Früher wurde jede Ecke auf 90° gezwungen — eine Skizze mit schräger Wand
// ließ sich dann mit ihren eigenen Längen nicht schließen und wurde zu
// einem verzogenen Viereck.
const STALLPLAN_RIGHT_ANGLE_TOLERANCE = (15 * Math.PI) / 180;
function normalizeStallplanAngle(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
function reconstructPolygonFromSketch(originalPoints, lengths) {
  const n = originalPoints.length;
  const dirs = originalPoints.map((a, i) => {
    const b = originalPoints[(i + 1) % n];
    return Math.atan2(b.y - a.y, b.x - a.x);
  });

  // Kanten, die über eingerastete Ecken verbunden sind, bilden eine starre
  // "Kette" mit festen Richtungsunterschieden (Union-Find mit Winkel-Offset:
  // Richtung(i) = Richtung(Wurzel) + offset[i]).
  const parent = dirs.map((_, i) => i);
  const offset = dirs.map(() => 0);
  const find = (i) => {
    if (parent[i] === i) return i;
    const p = parent[i];
    const root = find(p);
    offset[i] += offset[p];
    parent[i] = root;
    return root;
  };
  let freeCorners = 0;
  for (let j = 0; j < n; j++) {
    const prev = (j - 1 + n) % n;
    const turn = normalizeStallplanAngle(dirs[j] - dirs[prev]);
    const snapped = [-Math.PI / 2, 0, Math.PI / 2].find(t => Math.abs(turn - t) <= STALLPLAN_RIGHT_ANGLE_TOLERANCE);
    if (snapped === undefined) { freeCorners++; continue; }
    const ra = find(prev), rb = find(j);
    if (ra === rb) continue; // schließt den Kreis — bei einer Rechteck-Skizze ohnehin stimmig
    parent[rb] = ra;
    offset[rb] = offset[prev] + snapped - offset[j];
  }
  dirs.forEach((_, i) => find(i));

  // Eine Richtung je Kette. Die Kette der ersten Kante bleibt exakt wie
  // skizziert (Lage des Plans ändert sich nicht), die übrigen starten beim
  // Mittel ihrer Skizzen-Richtungen und werden unten nachgestellt.
  const roots = [...new Set(parent)];
  const theta = {};
  roots.forEach(r => {
    let sx = 0, sy = 0;
    dirs.forEach((d, i) => { if (parent[i] === r) { sx += Math.cos(d - offset[i]); sy += Math.sin(d - offset[i]); } });
    theta[r] = Math.atan2(sy, sx);
  });
  theta[parent[0]] = dirs[0] - offset[0];
  const freeRoots = roots.filter(r => r !== parent[0]);

  const residual = (th) => {
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      const a = th[parent[i]] + offset[i];
      x += lengths[i] * Math.cos(a);
      y += lengths[i] * Math.sin(a);
    }
    return { x, y };
  };
  // Levenberg-Marquardt auf den freien Kettenrichtungen: kleinste
  // Schlusslücke bei gegebenen Längen. Meist nur 1–2 Unbekannte.
  if (freeRoots.length) {
    let lambda = 1e-3;
    let r = residual(theta);
    for (let iter = 0; iter < 60 && Math.hypot(r.x, r.y) > 1e-10; iter++) {
      const J = freeRoots.map(root => {
        let jx = 0, jy = 0;
        for (let i = 0; i < n; i++) {
          if (parent[i] !== root) continue;
          const a = theta[root] + offset[i];
          jx -= lengths[i] * Math.sin(a);
          jy += lengths[i] * Math.cos(a);
        }
        return { x: jx, y: jy };
      });
      const A = J.map((ja, k) => J.map((jb, l) => ja.x * jb.x + ja.y * jb.y + (k === l ? lambda : 0)));
      const g = J.map(jk => -(jk.x * r.x + jk.y * r.y));
      const delta = solveSmallLinearSystem(A, g);
      if (!delta) break;
      const trial = { ...theta };
      freeRoots.forEach((root, k) => { trial[root] += delta[k]; });
      const rTrial = residual(trial);
      if (Math.hypot(rTrial.x, rTrial.y) < Math.hypot(r.x, r.y)) {
        Object.assign(theta, trial);
        r = rTrial;
        lambda = Math.max(lambda * 0.3, 1e-9);
      } else {
        lambda *= 10;
        if (lambda > 1e6) break;
      }
    }
  }

  const walked = [{ ...originalPoints[0] }];
  for (let i = 0; i < n; i++) {
    const a = theta[parent[i]] + offset[i];
    const prev = walked[i];
    walked.push({ x: prev.x + Math.cos(a) * lengths[i], y: prev.y + Math.sin(a) * lengths[i] });
  }
  // Was sich auch so nicht schließen lässt (Messungenauigkeit), wird nach
  // der Kompassregel (Bowditch-Ausgleich, Standardverfahren beim Schließen
  // einer Vermessung) proportional zur zurückgelegten Strecke verteilt,
  // statt es an einer einzelnen Kante "zu verstecken".
  const closeError = { x: walked[n].x - walked[0].x, y: walked[n].y - walked[0].y };
  const totalLen = lengths.reduce((s, l) => s + l, 0) || 1;
  let cumulative = 0;
  const adjusted = walked.slice(0, n).map((p, i) => {
    const frac = cumulative / totalLen;
    cumulative += lengths[i];
    return { x: p.x - closeError.x * frac, y: p.y - closeError.y * frac };
  });
  return { points: adjusted, misclosure: Math.hypot(closeError.x, closeError.y), freeCorners };
}
// Gauß-Elimination mit Pivotsuche für die (winzigen) Normalgleichungen oben.
function solveSmallLinearSystem(A, b) {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) {
    let pivot = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-14) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[m] / row[i]);
}

// ---- SVG-Rendering ----
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}
function pointsAttr(points) { return points.map(p => `${p.x},${p.y}`).join(' '); }

function resetStallplanerViewBox() {
  stallplanerViewBox = { x: 0, y: 0, w: 20, h: 15 };
  stallplanerViewLocked = false;
}
function growStallplanerViewBoxTo(points) {
  if (!points.length) return;
  const pad = 2;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(stallplanerViewBox.x, Math.min(...xs) - pad);
  const minY = Math.min(stallplanerViewBox.y, Math.min(...ys) - pad);
  const maxX = Math.max(stallplanerViewBox.x + stallplanerViewBox.w, Math.max(...xs) + pad);
  const maxY = Math.max(stallplanerViewBox.y + stallplanerViewBox.h, Math.max(...ys) + pad);
  stallplanerViewBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
// stallplanerViewBox ist der gewünschte Ausschnitt; das SVG hat aber je nach
// Gerät ein anderes Seitenverhältnis (Handy hochkant!). Angezeigt wird daher
// immer der auf das Seitenverhältnis erweiterte Ausschnitt — und genau der
// gilt auch für alle Bildschirm↔Plan-Umrechnungen. Vorher wurde der Inhalt
// per preserveAspectRatio="meet" eingepasst, die Umrechnung ignorierte den
// Rand aber — auf dem Handy landeten Tipps dadurch an der falschen Stelle.
function stallplanDisplayBox() {
  const vb = stallplanerViewBox;
  const rect = document.getElementById('stallplan-svg').getBoundingClientRect();
  if (!rect.width || !rect.height || !vb.w || !vb.h) return { ...vb };
  const target = rect.width / rect.height;
  if (vb.w / vb.h < target) {
    const w = vb.h * target;
    return { x: vb.x - (w - vb.w) / 2, y: vb.y, w, h: vb.h };
  }
  const h = vb.w / target;
  return { x: vb.x, y: vb.y - (h - vb.h) / 2, w: vb.w, h };
}
function applyStallplanerViewBox() {
  const svg = document.getElementById('stallplan-svg');
  const d = stallplanDisplayBox();
  svg.setAttribute('viewBox', `${d.x} ${d.y} ${d.w} ${d.h}`);
}
// Zentriert die Ansicht auf eine bestimmte Form (z.B. beim Anklicken eines
// Abteils im Bearbeiten-Modus) — behebt "wieder zurück zum bearbeiteten
// Abteil finden", wenn die Ansicht vorher weit weggezoomt/verschoben war.
function focusStallplanShape(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY, 2) * 0.3;
  const w = Math.max(maxX - minX + pad * 2, 3);
  const h = Math.max(maxY - minY + pad * 2, 2.25);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  stallplanerViewBox = { x: cx - w / 2, y: cy - h / 2, w, h };
  stallplanerViewLocked = true;
  applyStallplanerViewBox();
  renderStallplanGrid();
  rescaleStallplanDynamicElements();
}
// "Ansicht anpassen" — verlässt den manuell gesperrten Zustand wieder und
// zoomt/zentriert einmalig neu auf den gesamten Planinhalt.
function fitStallplanerView() {
  const plan = activeStallplan();
  resetStallplanerViewBox();
  if (plan) {
    const allPoints = [];
    if (plan.outline) allPoints.push(...plan.outline.points);
    plan.compartments.forEach(c => allPoints.push(...c.points));
    plan.equipment.forEach(e => allPoints.push(...e.points));
    growStallplanerViewBoxTo(allPoints);
  }
  applyStallplanerViewBox();
  renderStallplanGrid();
  rescaleStallplanDynamicElements();
}
function clampStallplanZoomWidth(w) {
  return Math.min(Math.max(w, STALLPLANER_VIEW_MIN_W), STALLPLANER_VIEW_MAX_W);
}

function renderStallplanGrid() {
  const g = document.getElementById('stallplan-grid');
  g.innerHTML = '';
  const d = stallplanDisplayBox();
  const startX = Math.floor(d.x), endX = Math.ceil(d.x + d.w);
  const startY = Math.floor(d.y), endY = Math.ceil(d.y + d.h);
  for (let x = startX; x <= endX; x++) {
    g.appendChild(svgEl('line', { x1: x, y1: startY, x2: x, y2: endY, class: 'stallplan-grid-line' + (x % 5 === 0 ? ' major' : '') }));
  }
  for (let y = startY; y <= endY; y++) {
    g.appendChild(svgEl('line', { x1: startX, y1: y, x2: endX, y2: y, class: 'stallplan-grid-line' + (y % 5 === 0 ? ' major' : '') }));
  }
}

// Bildschirm-Pixel je Rastereinheit bei der aktuellen viewBox — Text-/
// Griffgrößen werden daraus rückgerechnet (Zielgröße_px / scale), damit sie
// beim Hineinzoomen (siehe Mausrad-Handler) eine gleichbleibende
// Bildschirmgröße behalten statt mit dem Inhalt mitzuwachsen und bei
// starkem Zoom riesig/unleserlich zu werden — reine SVG-Attribute wie
// font-size/r sind sonst in Rastereinheiten, nicht Bildschirm-Pixeln.
function stallplanScreenScale() {
  const rect = document.getElementById('stallplan-svg').getBoundingClientRect();
  const d = stallplanDisplayBox();
  if (!rect.width || !d.w) return 30;
  return rect.width / d.w;
}
// Gerundet statt der rohen Division: ein sehr langer, sich bei jedem
// Neu-Render minimal veränderter Dezimalwert (Rundungsrauschen durch
// getBoundingClientRect()) lässt Text-Bounding-Boxen zwischen zwei Frames
// hauchdünn "wackeln" — genug, damit z.B. Playwright seine
// Stabilitätsprüfung vor einem Klick nie als erfüllt ansieht.
function stallplanScreenSize(px) { return Math.round((px / stallplanScreenScale()) * 1000) / 1000; }
// Nach reinen viewBox-Änderungen ohne vollen Re-Render (Mausrad-Zoom,
// Fokussieren einer Form, "Ansicht anpassen") — Panning ändert den Maßstab
// nicht und braucht daher keinen Aufruf.
function rescaleStallplanDynamicElements() {
  document.querySelectorAll('.stallplan-compartment-label').forEach(fitStallplanCompartmentLabel);
  document.querySelectorAll('.stallplan-edge-label').forEach(el => el.setAttribute('font-size', stallplanScreenSize(11)));
  document.querySelectorAll('.stallplan-equipment-icon').forEach(el => el.setAttribute('font-size', stallplanScreenSize(16)));
  document.querySelectorAll('.stallplan-equipment-bg').forEach(el => el.setAttribute('r', stallplanScreenSize(11)));
  document.querySelectorAll('.stallplan-vertex-handle').forEach(el => el.setAttribute('r', stallplanScreenSize(7)));
  document.querySelectorAll('.stallplan-vertex-hit').forEach(el => el.setAttribute('r', stallplanScreenSize(22)));
  document.querySelectorAll('.stallplan-draw-point').forEach(el => el.setAttribute('r', stallplanScreenSize(5)));
  document.querySelectorAll('.stallplan-walls-start, .stallplan-walls-end').forEach(el => el.setAttribute('r', stallplanScreenSize(8)));
  document.querySelectorAll('.stallplan-measure-end').forEach(el => el.setAttribute('r', stallplanScreenSize(6)));
  document.querySelectorAll('#stallplan-draw-preview-layer .stallplan-edge-label').forEach(el => el.setAttribute('font-size', stallplanScreenSize(12)));
  document.querySelectorAll('.stallplan-edge-label-hit').forEach(el => {
    const cx = parseFloat(el.getAttribute('x')) + parseFloat(el.getAttribute('width')) / 2;
    const cy = parseFloat(el.getAttribute('y')) + parseFloat(el.getAttribute('height')) / 2;
    const w = stallplanScreenSize(56), h = stallplanScreenSize(32);
    el.setAttribute('x', cx - w / 2); el.setAttribute('y', cy - h / 2);
    el.setAttribute('width', w); el.setAttribute('height', h);
  });
}

// Sichtbar bleibt der Griff klein, getroffen wird ein unsichtbarer Kreis
// mit 22 px Radius — ein Finger trifft sonst die 12-px-Punkte kaum.
function makeVertexHandle(p, kind, compartmentId, index) {
  const g = svgEl('g', { class: 'stallplan-vertex' });
  g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: stallplanScreenSize(22), class: 'stallplan-vertex-hit' }));
  g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: stallplanScreenSize(7), class: 'stallplan-vertex-handle' }));
  wireStallplanVertexDrag(g, kind, compartmentId, index);
  return g;
}
// Drag-Bewegungen zeichnen höchstens einmal pro Bildschirm-Frame neu (vorher
// ein voller renderStallplan() je pointermove — auf dem Handy spürbar zäh).
let stallplanFrameCb = null;
function scheduleStallplanFrame(cb) {
  const pending = stallplanFrameCb;
  stallplanFrameCb = cb;
  if (!pending) requestAnimationFrame(flushStallplanFrame);
}
function flushStallplanFrame() {
  const cb = stallplanFrameCb;
  stallplanFrameCb = null;
  if (cb) cb();
}
// Gemeinsamer Ablauf für alle Drags: nur der auslösende Finger zählt (ein
// zweiter Finger zum Zoomen verschiebt nichts), pointercancel beendet
// sauber, und der letzte Frame wird beim Loslassen noch angewendet.
function trackStallplanDrag(downEvent, onMove, onEnd) {
  const pointerId = downEvent.pointerId;
  function move(ev) {
    if (ev.pointerId !== pointerId) return;
    scheduleStallplanFrame(() => onMove(ev));
  }
  function up(ev) {
    if (ev.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    flushStallplanFrame();
    if (onEnd) onEnd(ev);
  }
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}
// ownerId ist eine Abteil- oder Ausstattungs-Id, je nach kind — bei
// kind==='outline' ungenutzt (es gibt nur einen Umriss je Plan).
function stallplanPointsFor(plan, kind, ownerId) {
  if (kind === 'outline') return plan.outline.points;
  if (kind === 'compartment') return plan.compartments.find(c => c.id === ownerId).points;
  return plan.equipment.find(x => x.id === ownerId).points;
}
function wireStallplanVertexDrag(handleEl, kind, ownerId, index) {
  handleEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    pushStallplanerUndo();
    trackStallplanDrag(e, (ev) => {
      const plan = activeStallplan();
      if (!plan) return;
      stallplanPointsFor(plan, kind, ownerId)[index] = snapStallplanPoint(stallplanSvgPoint(ev), plan);
      renderStallplan();
    }, () => renderStallplanerSidebar());
  });
}
// Verschiebt eine ganze Ausstattung (alle Punkte um denselben Versatz) —
// bei einem Punkt-Element ist das schlicht der eine Punkt, bei Linie/
// Fläche das komplette Element. Einzelne Eckpunkte einer Linie/Fläche
// lassen sich zusätzlich über wireStallplanVertexDrag() (im Bearbeiten-
// Modus, nach Auswahl) einzeln verschieben.
function wireStallplanEquipmentBodyDrag(gEl, equipId) {
  gEl.addEventListener('pointerdown', (e) => {
    if (stallplanerMode !== 'edit-vertex' || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    pushStallplanerUndo();
    const startGrid = stallplanSvgPoint(e);
    let startPoints = null;
    trackStallplanDrag(e, (ev) => {
      const plan = activeStallplan();
      const item = plan && plan.equipment.find(x => x.id === equipId);
      if (!item) return;
      if (!startPoints) startPoints = item.points.map(p => ({ ...p }));
      const cur = stallplanSvgPoint(ev);
      const dx = cur.x - startGrid.x, dy = cur.y - startGrid.y;
      item.points = startPoints.map(p => snapStallplanPoint({ x: p.x + dx, y: p.y + dy }, plan));
      renderStallplan();
    });
  });
}

// Kantenlängen-Beschriftungen (klickbar, öffnet ein Zahlenfeld zur
// zentimetergenauen Eingabe) — nur an der aktuell zur Bearbeitung
// ausgewählten Form sichtbar, sonst würde die Zeichenfläche bei vielen
// Abteilen sofort unübersichtlich.
// isOpen: true für eine Linie (letzter Punkt schließt NICHT zurück zum
// ersten, anders als Umriss/Abteil/Flächen-Ausstattung).
function appendEdgeLengthLabels(g, points, gridScale, kind, compartmentId, isOpen) {
  const n = points.length;
  const edgeCount = isOpen ? n - 1 : n;
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const lenM = Math.hypot(b.x - a.x, b.y - a.y) * gridScale;
    const wrap = svgEl('g', { class: 'stallplan-edge-label-wrap' });
    // Eigenes, großzügig bemessenes Klickziel statt direkt auf den Text-
    // Glyphen zu klicken — enge Text-Bounding-Boxen sind je nach Zoomstufe
    // hauchdünn und schwer zuverlässig zu treffen (auch automatisiert).
    const hit = svgEl('rect', {
      x: mid.x - stallplanScreenSize(28), y: mid.y - stallplanScreenSize(16),
      width: stallplanScreenSize(56), height: stallplanScreenSize(32),
      class: 'stallplan-edge-label-hit'
    });
    const label = svgEl('text', { x: mid.x, y: mid.y, class: 'stallplan-edge-label', 'font-size': stallplanScreenSize(11) });
    label.textContent = lenM.toFixed(2) + ' m';
    wrap.appendChild(hit);
    wrap.appendChild(label);
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      openEdgeLengthEditor(kind, compartmentId, i, mid, lenM);
    });
    g.appendChild(wrap);
  }
}

function renderStallplanOutline(plan) {
  const g = document.getElementById('stallplan-outline-layer');
  g.innerHTML = '';
  if (!plan.outline) return;
  const selfX = polygonSelfIntersects(plan.outline.points);
  const selected = stallplanerSelection && stallplanerSelection.kind === 'outline';
  g.appendChild(svgEl('polygon', { points: pointsAttr(plan.outline.points), class: 'stallplan-outline' + (selfX ? ' self-intersect' : '') + (selected ? ' selected' : '') }));
  if (stallplanerMode === 'edit-vertex' && stallplanerEditTargetKind === 'outline') {
    plan.outline.points.forEach((p, i) => g.appendChild(makeVertexHandle(p, 'outline', null, i)));
    appendEdgeLengthLabels(g, plan.outline.points, plan.gridScale, 'outline', null);
  }
}
function fitStallplanCompartmentLabel(label) {
  const scale = stallplanScreenScale();
  const wPx = parseFloat(label.getAttribute('data-fit-w')) * scale;
  const hPx = parseFloat(label.getAttribute('data-fit-h')) * scale;
  const chars = parseFloat(label.getAttribute('data-fit-chars')) || 1;
  const px = Math.min(13, (wPx - 8) / (chars * 0.6), (hPx - 4) / 2.4);
  label.style.display = px < 7 ? 'none' : '';
  label.setAttribute('font-size', stallplanScreenSize(Math.max(px, 7)));
}
function renderStallplanCompartments(plan) {
  const g = document.getElementById('stallplan-compartments-layer');
  g.innerHTML = '';
  plan.compartments.forEach(c => {
    const area = shoelaceArea(c.points) * plan.gridScale * plan.gridScale;
    const benoetigt = c.tierbestand.length ? compartmentBenoetigteFlaeche(c) : null;
    const compliant = benoetigt == null ? null : area >= benoetigt;
    const selfX = polygonSelfIntersects(c.points);
    const wrap = svgEl('g', {
      class: 'stallplan-compartment' + (compliant === false ? ' non-compliant' : '') + (selfX ? ' self-intersect' : '') +
        (stallplanerSelection && stallplanerSelection.kind === 'compartment' && stallplanerSelection.id === c.id ? ' selected' : ''),
      'data-id': c.id
    });
    wrap.appendChild(svgEl('polygon', { points: pointsAttr(c.points) }));
    const center = polygonCentroid(c.points);
    const areaText = `${area.toFixed(1)} m²`;
    const xs = c.points.map(p => p.x), ys = c.points.map(p => p.y);
    // Zweizeilig (Name / Fläche) und an die Abteilgröße angepasst — in einer
    // Buchtenreihe sind die Abteile oft schmaler als eine einzeilige
    // Beschriftung, die Texte liefen sonst ineinander.
    const label = svgEl('text', {
      x: center.x, y: center.y, class: 'stallplan-compartment-label',
      'data-fit-w': Math.max(...xs) - Math.min(...xs), 'data-fit-h': Math.max(...ys) - Math.min(...ys),
      'data-fit-chars': Math.max(c.name.length, areaText.length)
    });
    const nameLine = svgEl('tspan', { x: center.x, dy: '-0.55em' });
    nameLine.textContent = c.name;
    const areaLine = svgEl('tspan', { x: center.x, dy: '1.15em' });
    areaLine.textContent = areaText;
    label.appendChild(nameLine);
    label.appendChild(areaLine);
    fitStallplanCompartmentLabel(label);
    wrap.appendChild(label);
    g.appendChild(wrap);
    if (stallplanerMode === 'edit-vertex' && stallplanerEditTargetKind === 'compartment' && stallplanerEditTargetId === c.id) {
      appendEdgeLengthLabels(wrap, c.points, plan.gridScale, 'compartment', c.id);
      c.points.forEach((p, i) => g.appendChild(makeVertexHandle(p, 'compartment', c.id, i)));
    }
  });
}
// Mittelpunkt fürs Icon: bei Linie/Fläche der Flächen-/Streckenschwerpunkt
// statt nur des ersten Punkts, damit das Symbol mittig sitzt statt an
// einer Ecke zu kleben.
function stallplanEquipmentIconAnchor(e) {
  if (e.points.length === 1) return e.points[0];
  if (e.geometryKind === 'area') return polygonCentroid(e.points);
  // Linie: Mittelpunkt der Gesamtlänge (nicht nur Durchschnitt der
  // Eckpunkte, sonst läge er bei ungleich langen Segmenten daneben).
  let total = 0;
  const segLens = [];
  for (let i = 0; i < e.points.length - 1; i++) {
    const l = Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
    segLens.push(l); total += l;
  }
  let target = total / 2, i = 0;
  while (i < segLens.length && target > segLens[i]) { target -= segLens[i]; i++; }
  const a = e.points[i], b = e.points[Math.min(i + 1, e.points.length - 1)];
  const segLen = segLens[i] || 1;
  const t = target / segLen;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function renderStallplanEquipment(plan) {
  const g = document.getElementById('stallplan-equipment-layer');
  g.innerHTML = '';
  plan.equipment.forEach(e => {
    const selected = stallplanerMode === 'edit-vertex' && stallplanerEditTargetKind === 'equipment' && stallplanerEditTargetId === e.id;
    const picked = stallplanerSelection && stallplanerSelection.kind === 'equipment' && stallplanerSelection.id === e.id;
    const wrap = svgEl('g', { class: 'stallplan-equipment stallplan-equipment-' + e.geometryKind + (picked ? ' selected' : ''), 'data-id': e.id });
    if (e.geometryKind === 'area') {
      wrap.appendChild(svgEl('polygon', { points: pointsAttr(e.points), class: 'stallplan-equipment-shape' }));
    } else if (e.geometryKind === 'line') {
      wrap.appendChild(svgEl('polyline', { points: pointsAttr(e.points), class: 'stallplan-equipment-shape' }));
    }
    const anchor = stallplanEquipmentIconAnchor(e);
    const iconGroup = svgEl('g', { transform: `translate(${anchor.x},${anchor.y}) rotate(${e.rotationDeg || 0})` });
    iconGroup.appendChild(svgEl('circle', { r: stallplanScreenSize(11), class: 'stallplan-equipment-bg' }));
    const icon = svgEl('text', { class: 'material-symbols-rounded stallplan-equipment-icon', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': stallplanScreenSize(16) });
    icon.textContent = STALLPLANER_EQUIPMENT_ICON_NAMES[e.type] || 'help';
    iconGroup.appendChild(icon);
    wrap.appendChild(iconGroup);
    g.appendChild(wrap);
    wireStallplanEquipmentBodyDrag(wrap, e.id);
    if (selected) {
      e.points.forEach((p, i) => g.appendChild(makeVertexHandle(p, 'equipment', e.id, i)));
      if (e.points.length >= 2) appendEdgeLengthLabels(g, e.points, plan.gridScale, 'equipment', e.id, e.geometryKind === 'line');
    }
  });
}
// Mehrpunkt-Zeichnen läuft für Umriss/Abteil UND für Linien-/Flächen-
// Ausstattung über denselben stallplanerDrawPoints-Mechanismus — nur
// Punkt-Ausstattung wird weiterhin per einzelnem Klick sofort gesetzt.
function stallplanDrawModeActive() {
  return stallplanerMode === 'draw-outline' || stallplanerMode === 'draw-compartment' ||
    (stallplanerMode === 'place-equipment' && stallplanerEquipGeometryKind !== 'point');
}
// Schließbar (Klick nah am Start beendet die Form) ist alles außer einer
// Linie — eine Linie hat kein "Innen", ein Schließen zurück zum
// Startpunkt ergäbe keinen Sinn.
function stallplanDrawIsClosable() {
  return stallplanerMode === 'draw-outline' || stallplanerMode === 'draw-compartment' ||
    (stallplanerMode === 'place-equipment' && stallplanerEquipGeometryKind === 'area');
}
// Klickt/hovert man beim Zeichnen nah genug am ersten gesetzten Punkt,
// schließt sich der Umriss/das Abteil/die Flächen-Ausstattung automatisch —
// Toleranz in Bildschirm-Pixeln (zoomunabhängig, siehe
// stallplanScreenSize()), nicht in Rastereinheiten, sonst wäre die
// Trefferfläche beim Herauszoomen riesig und beim Hineinzoomen winzig.
const STALLPLAN_CLOSE_TOLERANCE_PX = 24;
function isNearStallplanDrawStart(p) {
  if (!stallplanDrawIsClosable() || !stallplanerDrawPoints || stallplanerDrawPoints.length < 3) return false;
  const start = stallplanerDrawPoints[0];
  return Math.hypot(p.x - start.x, p.y - start.y) <= stallplanScreenSize(STALLPLAN_CLOSE_TOLERANCE_PX);
}
function renderStallplanDrawPreview(cursor) {
  const g = document.getElementById('stallplan-draw-preview-layer');
  g.innerHTML = '';
  if (!stallplanerDrawPoints || !stallplanerDrawPoints.length) return;
  const canClose = !!cursor && isNearStallplanDrawStart(cursor);
  // Statt einer offenen Linie bis zum Cursor schon die schließende Kante
  // zurück zum Startpunkt einzeichnen — dieselbe Rückmeldung, die auch
  // Illustrator/Figma beim Pfadzeichnen geben ("hier klicken zum Schließen").
  const pts = canClose ? [...stallplanerDrawPoints, stallplanerDrawPoints[0]] : (cursor ? [...stallplanerDrawPoints, cursor] : stallplanerDrawPoints);
  g.appendChild(svgEl('polyline', { points: pointsAttr(pts), class: 'stallplan-draw-preview' }));
  stallplanerDrawPoints.forEach((p, i) => {
    const highlight = i === 0 && canClose;
    g.appendChild(svgEl('circle', {
      cx: p.x, cy: p.y,
      r: stallplanScreenSize(highlight ? 9 : 5),
      class: 'stallplan-draw-point' + (highlight ? ' closable' : '')
    }));
  });
}

function renderStallplan() {
  const plan = activeStallplan();
  if (!plan) {
    ['stallplan-outline-layer', 'stallplan-compartments-layer', 'stallplan-equipment-layer', 'stallplan-draw-preview-layer'].forEach(id => {
      document.getElementById(id).innerHTML = '';
    });
    renderStallplanGrid();
    return;
  }
  // Solange die Ansicht nicht manuell gezoomt/verschoben/auf eine Form
  // fokussiert wurde, wächst sie automatisch mit dem Inhalt mit — danach
  // übersteuert das automatische Mitwachsen nicht mehr jede Mutation.
  if (!stallplanerViewLocked) {
    const allPoints = [];
    if (plan.outline) allPoints.push(...plan.outline.points);
    plan.compartments.forEach(c => allPoints.push(...c.points));
    plan.equipment.forEach(e => allPoints.push(...e.points));
    if (stallplanerDrawPoints) allPoints.push(...stallplanerDrawPoints);
    allPoints.push(...stallplanTaskPoints(plan));
    growStallplanerViewBoxTo(allPoints);
  }
  applyStallplanerViewBox();
  renderStallplanGrid();
  renderStallplanOutline(plan);
  renderStallplanCompartments(plan);
  renderStallplanEquipment(plan);
  if (stallplanerTask) renderStallplanTaskPreview();
}

// ---- Maus/Touch → SVG-Koordinaten ----
function stallplanSvgPoint(evt) {
  const svg = document.getElementById('stallplan-svg');
  const rect = svg.getBoundingClientRect();
  const vb = stallplanDisplayBox();
  return {
    x: vb.x + ((evt.clientX - rect.left) / rect.width) * vb.w,
    y: vb.y + ((evt.clientY - rect.top) / rect.height) * vb.h
  };
}
function snapStallplanPoint(p, plan) {
  return plan.gridSnap ? { x: Math.round(p.x), y: Math.round(p.y) } : p;
}
function stallplanScreenPoint(gridPoint) {
  const svg = document.getElementById('stallplan-svg');
  const rect = svg.getBoundingClientRect();
  const wrapRect = document.getElementById('stallplaner-canvas').getBoundingClientRect();
  const vb = stallplanDisplayBox();
  return {
    left: rect.left - wrapRect.left + ((gridPoint.x - vb.x) / vb.w) * rect.width,
    top: rect.top - wrapRect.top + ((gridPoint.y - vb.y) / vb.h) * rect.height
  };
}

// ---- Kantenlängen zentimetergenau eingeben (statt nur grobem Raster-Snap
// beim Ziehen) — ändert die Position des ZWEITEN Eckpunkts der Kante entlang
// derselben Richtung, der erste bleibt fest. Da sich benachbarte Kanten
// eines Polygons immer einen Eckpunkt teilen, verändert das zwangsläufig
// auch die Länge der Nachbarkante — exakt das aus jedem Vektor-Werkzeug
// bekannte Verhalten, keine isolierte "nur diese eine Kante"-Bearbeitung
// möglich. ----
function setEdgeLength(points, edgeIndex, newLengthMeters, gridScale) {
  const n = points.length;
  const a = points[edgeIndex], bIdx = (edgeIndex + 1) % n, b = points[bIdx];
  const dx = b.x - a.x, dy = b.y - a.y;
  const curLen = Math.hypot(dx, dy);
  if (curLen < 1e-9) return;
  const newLenGrid = newLengthMeters / gridScale;
  points[bIdx] = { x: a.x + (dx / curLen) * newLenGrid, y: a.y + (dy / curLen) * newLenGrid };
}
function openEdgeLengthEditor(kind, compartmentId, edgeIndex, midPointGrid, currentLengthM) {
  const input = document.getElementById('stallplan-edge-length-input');
  const pos = stallplanScreenPoint(midPointGrid);
  input.style.left = pos.left + 'px';
  input.style.top = pos.top + 'px';
  input.value = currentLengthM.toFixed(2);
  input.dataset.kind = kind;
  input.dataset.compartmentId = compartmentId || '';
  input.dataset.edgeIndex = String(edgeIndex);
  input.hidden = false;
  input.focus();
  input.select();
}
function closeEdgeLengthEditor() {
  document.getElementById('stallplan-edge-length-input').hidden = true;
}
function commitEdgeLengthEditor() {
  const input = document.getElementById('stallplan-edge-length-input');
  if (input.hidden) return;
  const plan = activeStallplan();
  const kind = input.dataset.kind;
  const compartmentId = input.dataset.compartmentId || null;
  const edgeIndex = parseInt(input.dataset.edgeIndex, 10);
  const newLenM = parseDecimalInput(input.value);
  closeEdgeLengthEditor();
  if (!plan || !Number.isFinite(newLenM) || newLenM <= 0) return;
  const points = stallplanPointsFor(plan, kind, compartmentId);
  pushStallplanerUndo();
  setEdgeLength(points, edgeIndex, newLenM, plan.gridScale);
  renderStallplan();
  renderStallplanerSidebar();
}
const stallplanEdgeLengthInput = document.getElementById('stallplan-edge-length-input');
stallplanEdgeLengthInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitEdgeLengthEditor(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeEdgeLengthEditor(); }
});
stallplanEdgeLengthInput.addEventListener('blur', () => commitEdgeLengthEditor());
stallplanEdgeLengthInput.addEventListener('click', (e) => e.stopPropagation());

// ---- Geführter Vermessen-Modus ----
// Führt beim Vor-Ort-Termin Kante für Kante durch den ausgewählten Umriss/
// das Abteil (Reihenfolge wie in der Skizze), sammelt die echten
// Laser-Maße und baut die Form am Ende in einem Schritt rechtwinklig neu
// auf (reconstructPolygonFromSketch()) — bewusst erst am Ende, nicht nach
// jeder einzelnen Kante, da die Zwischenzustände sonst bei jedem Schritt
// sichtbar "hin- und herspringen" würden, obwohl der Drehsinn ohnehin erst
// mit allen Kanten zusammen feststeht.
function startStallplanMeasureWalk(kind, compartmentId, points) {
  if (points.length < 3) return;
  stallplanerMeasureTargetKind = kind;
  stallplanerMeasureTargetId = compartmentId;
  stallplanerMeasureOriginalPoints = points.map(p => ({ ...p }));
  stallplanerMeasureLengths = [];
  stallplanerMeasureIndex = 0;
  focusStallplanShape(points);
  showStallplanMeasureStep();
}
function currentStallplanMeasureEdge() {
  const n = stallplanerMeasureOriginalPoints.length;
  return [stallplanerMeasureOriginalPoints[stallplanerMeasureIndex], stallplanerMeasureOriginalPoints[(stallplanerMeasureIndex + 1) % n]];
}
function showStallplanMeasureStep() {
  const plan = activeStallplan();
  const n = stallplanerMeasureOriginalPoints.length;
  if (stallplanerSheetPanel !== 'stallplaner-measure-panel') openStallplanerSheet('stallplaner-measure-panel', 'Vermessen');
  document.getElementById('stallplaner-measure-progress').textContent = `Kante ${stallplanerMeasureIndex + 1} von ${n}`;
  const [a, b] = currentStallplanMeasureEdge();
  const roughLenM = Math.hypot(b.x - a.x, b.y - a.y) * plan.gridScale;
  const input = document.getElementById('stallplaner-measure-input');
  input.value = '';
  input.placeholder = `≈ ${roughLenM.toFixed(2)} m laut Skizze`;
  document.getElementById('stallplaner-measure-back').disabled = stallplanerMeasureIndex === 0;
  renderStallplanMeasureHighlight();
  renderStallplanerChrome();
  input.focus();
}
// Zeigt im Plan, wo man gerade steht: die zu messende Kante dick und orange
// (mit dunklem Rand, damit sie auf jeder Füllung auffällt), bereits
// gemessene Kanten grün mit ihrem eingetragenen Maß. Nutzt die (sonst nur
// beim Skizzieren aktive) Vorschau-Ebene — kein zusätzlicher SVG-Layer.
function renderStallplanMeasureHighlight() {
  const g = document.getElementById('stallplan-draw-preview-layer');
  g.innerHTML = '';
  const pts = stallplanerMeasureOriginalPoints;
  if (!pts) return;
  const n = pts.length;
  const edge = (i) => [pts[i], pts[(i + 1) % n]];
  // Beschriftung neben (nicht auf) die Kante, nach außen weg vom
  // Flächenmittelpunkt — sonst streicht die Linie den Text durch.
  const center = polygonCentroid(pts);
  const label = (a, b, text, cls, px) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if (nx * (mid.x - center.x) + ny * (mid.y - center.y) < 0) { nx = -nx; ny = -ny; }
    const off = stallplanScreenSize(px + 6);
    const t = svgEl('text', { x: mid.x + nx * off, y: mid.y + ny * off, class: 'stallplan-edge-label ' + cls, 'font-size': stallplanScreenSize(px) });
    t.textContent = text;
    g.appendChild(t);
  };
  for (let i = 0; i < stallplanerMeasureIndex; i++) {
    const [a, b] = edge(i);
    g.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'stallplan-measure-done' }));
    const len = stallplanerMeasureLengths[i];
    if (len != null) label(a, b, formatStallplanMeters(len) + ' m', 'stallplan-measure-done-label', 12);
  }
  const [a, b] = edge(stallplanerMeasureIndex);
  g.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'stallplan-measure-halo' }));
  g.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'stallplan-measure-highlight' }));
  [a, b].forEach(p => g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: stallplanScreenSize(6), class: 'stallplan-measure-end' })));
  label(a, b, '? m', 'stallplan-measure-current-label', 15);
}
function submitStallplanMeasureStep() {
  const input = document.getElementById('stallplaner-measure-input');
  const val = parseDecimalInput(input.value);
  if (!Number.isFinite(val) || val <= 0) { input.focus(); return; }
  stallplanerMeasureLengths[stallplanerMeasureIndex] = val;
  advanceStallplanMeasureStep();
}
function skipStallplanMeasureStep() {
  const plan = activeStallplan();
  const [a, b] = currentStallplanMeasureEdge();
  stallplanerMeasureLengths[stallplanerMeasureIndex] = Math.hypot(b.x - a.x, b.y - a.y) * plan.gridScale;
  advanceStallplanMeasureStep();
}
function advanceStallplanMeasureStep() {
  stallplanerMeasureIndex++;
  if (stallplanerMeasureIndex < stallplanerMeasureOriginalPoints.length) showStallplanMeasureStep();
  else finishStallplanMeasureWalk();
}
function backStallplanMeasureStep() {
  if (stallplanerMeasureIndex === 0) return;
  stallplanerMeasureIndex--;
  showStallplanMeasureStep();
  const prevVal = stallplanerMeasureLengths[stallplanerMeasureIndex];
  if (prevVal != null) document.getElementById('stallplaner-measure-input').value = prevVal;
}
function finishStallplanMeasureWalk() {
  const plan = activeStallplan();
  const lengthsGrid = stallplanerMeasureLengths.map(l => l / plan.gridScale);
  const { points: newPoints, misclosure, freeCorners } = reconstructPolygonFromSketch(stallplanerMeasureOriginalPoints, lengthsGrid);
  pushStallplanerUndo(); // ein einziger Undo-Schritt für die ganze Vermessung
  if (stallplanerMeasureTargetKind === 'outline') {
    plan.outline.points = newPoints;
  } else {
    const c = plan.compartments.find(x => x.id === stallplanerMeasureTargetId);
    if (c) c.points = newPoints;
  }
  const misclosureM = misclosure * plan.gridScale;
  closeStallplanMeasurePanel();
  stallplanerMode = null;
  renderStallplan();
  renderStallplanerSidebar();
  // Schräge Ecken erwähnen — dort stammt der Winkel (angepasst) aus der
  // Skizze, nicht aus einer Messung.
  const schraegHinweis = freeCorners ? ` ${freeCorners} schräge ${freeCorners === 1 ? 'Ecke' : 'Ecken'}: Winkel aus der Skizze, an die Maße angepasst.` : '';
  stallplanerFlash(misclosureM > 0.05
    ? `Vermessen abgeschlossen — Schlussfehler ${misclosureM.toFixed(2)} m, bitte Maße stichprobenartig prüfen.${schraegHinweis}`
    : `Vermessen abgeschlossen — Schlussfehler ${misclosureM.toFixed(2)} m.${schraegHinweis}`);
}
function cancelStallplanMeasureWalk() {
  closeStallplanMeasurePanel();
  stallplanerMode = null;
  renderStallplanerChrome();
}
function closeStallplanMeasurePanel() {
  if (stallplanerSheetPanel === 'stallplaner-measure-panel') hideStallplanerSheet();
  document.getElementById('stallplan-draw-preview-layer').innerHTML = '';
  stallplanerMeasureTargetKind = null;
  stallplanerMeasureTargetId = null;
  stallplanerMeasureOriginalPoints = null;
  stallplanerMeasureLengths = null;
  stallplanerMeasureIndex = 0;
}
document.getElementById('stallplaner-measure-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitStallplanMeasureStep(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelStallplanMeasureWalk(); }
});
document.getElementById('stallplaner-measure-next').addEventListener('click', submitStallplanMeasureStep);
document.getElementById('stallplaner-measure-skip').addEventListener('click', skipStallplanMeasureStep);
document.getElementById('stallplaner-measure-back').addEventListener('click', backStallplanMeasureStep);
document.getElementById('stallplaner-measure-cancel').addEventListener('click', cancelStallplanMeasureWalk);

// ---- Undo/Redo (Snapshot-basiert statt Action-Objekten — siehe Plan:
// Stallplaner hat ~10 Mutationsarten über 3 Entitätstypen, ein kompletter
// Plan-Snapshot ist wenige KB JSON und günstiger als 10 Inverse-Aktionen
// einzeln zu pflegen). ----
function pushStallplanerUndo() {
  const plan = activeStallplan();
  if (!plan) return;
  stallplanerUndoStack.push(structuredClone(plan));
  if (stallplanerUndoStack.length > STALLPLANER_UNDO_MAX) stallplanerUndoStack.shift();
  stallplanerRedoStack.length = 0;
  renderStallplanerChrome();
}
function replaceActiveStallplan(next) {
  const idx = stallplaene.findIndex(p => p.id === activeStallplanId);
  if (idx !== -1) stallplaene[idx] = next;
}
function undoStallplaner() {
  const plan = activeStallplan();
  if (!plan || !stallplanerUndoStack.length) return;
  stallplanerRedoStack.push(structuredClone(plan));
  replaceActiveStallplan(stallplanerUndoStack.pop());
  stallplanerEditTargetKind = null;
  stallplanerEditTargetId = null;
  renderStallplan();
  renderStallplanerSidebar();
  renderStallplanerChrome();
}
function redoStallplaner() {
  const plan = activeStallplan();
  if (!plan || !stallplanerRedoStack.length) return;
  stallplanerUndoStack.push(structuredClone(plan));
  replaceActiveStallplan(stallplanerRedoStack.pop());
  stallplanerEditTargetKind = null;
  stallplanerEditTargetId = null;
  renderStallplan();
  renderStallplanerSidebar();
  renderStallplanerChrome();
}

// ---- Zeichnen-Zustandsmaschine ----
function finishStallplanDraw() {
  const plan = activeStallplan();
  const isEquip = stallplanerMode === 'place-equipment';
  const minPoints = (isEquip && stallplanerEquipGeometryKind === 'line') ? 2 : 3;
  if (!plan || !stallplanerDrawPoints || stallplanerDrawPoints.length < minPoints) { cancelStallplanDraw(); return; }
  pushStallplanerUndo();
  if (stallplanerMode === 'draw-outline') {
    plan.outline = { points: stallplanerDrawPoints };
  } else if (stallplanerMode === 'draw-compartment') {
    plan.compartments.push({
      id: 'abteil-' + Date.now() + Math.random().toString(36).slice(2),
      name: `Abteil ${plan.compartments.length + 1}`,
      points: stallplanerDrawPoints, tierbestand: []
    });
  } else if (isEquip) {
    plan.equipment.push({
      id: 'eq-' + Date.now() + Math.random().toString(36).slice(2),
      type: stallplanerEquipType, geometryKind: stallplanerEquipGeometryKind,
      points: stallplanerDrawPoints, rotationDeg: 0, label: ''
    });
  }
  stallplanerDrawPoints = null;
  const finishedOutline = stallplanerMode === 'draw-outline';
  // Ausstattung bleibt scharf, damit sich gleich die nächste Linie/Fläche
  // desselben Typs zeichnen lässt (wie beim Punkt-Setzen auch schon).
  if (!isEquip) stallplanerMode = null;
  if (finishedOutline) stallplanerStep = 'abteile';
  renderStallplanerChrome();
  renderStallplan();
  // renderStallplan() lässt die Zeichenvorschau-Ebene unangetastet (sie
  // gehört nicht zu den Plan-Daten) — ohne diesen Aufruf bliebe die
  // gestrichelte Vorschaulinie/die Punkt-Marker des letzten Klicks über
  // dem fertigen Umriss/Abteil liegen.
  renderStallplanDrawPreview(null);
  renderStallplanerSidebar();
}
function cancelStallplanDraw() {
  stallplanerDrawPoints = null;
  renderStallplanDrawPreview(null);
  renderStallplanerChrome();
}
function disableStallplanerDrawing() {
  resetStallplanerInteraction();
  renderStallplanerChrome();
}

const stallplanSvgEl = document.getElementById('stallplan-svg');
// Nach einem Verschieben/Pinch feuert der Browser noch einen click — der
// darf weder einen Punkt setzen noch etwas auswählen (Capture-Phase, damit
// auch die Klick-Handler der Ebenen darunter nichts davon mitbekommen).
let stallplanSuppressClick = false;
let stallplanSuppressTimer = null;
function suppressNextStallplanClick() {
  stallplanSuppressClick = true;
  clearTimeout(stallplanSuppressTimer);
  stallplanSuppressTimer = setTimeout(() => { stallplanSuppressClick = false; }, 400);
}
stallplanSvgEl.addEventListener('click', (e) => {
  if (!stallplanSuppressClick) return;
  stallplanSuppressClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

stallplanSvgEl.addEventListener('click', (e) => {
  const plan = activeStallplan();
  if (!plan) return;
  const task = stallplanerTask;
  if (task && task.target === 'compartment' && (task.type === 'rect' || (task.type === 'walls' && !task.segments.length))) {
    task.start = pickStallplanStartPoint(stallplanSvgPoint(e), plan);
    renderStallplan();
    return;
  }
  if (task) return;
  if (stallplanerMode === 'place-equipment' && stallplanerEquipGeometryKind === 'point') {
    const p = snapStallplanPoint(stallplanSvgPoint(e), plan);
    pushStallplanerUndo();
    plan.equipment.push({ id: 'eq-' + Date.now() + Math.random().toString(36).slice(2), type: stallplanerEquipType, geometryKind: 'point', points: [p], rotationDeg: 0, label: '' });
    renderStallplan();
    renderStallplanerChrome();
    return;
  }
  if (stallplanDrawModeActive()) {
    const raw = stallplanSvgPoint(e);
    if (isNearStallplanDrawStart(raw)) { finishStallplanDraw(); return; }
    const p = snapStallplanPoint(raw, plan);
    stallplanerDrawPoints = stallplanerDrawPoints || [];
    stallplanerDrawPoints.push(p);
    renderStallplan();
    renderStallplanDrawPreview(p);
    return;
  }
  // Tipp ins Leere ohne Werkzeug hebt eine Auswahl auf (Formen selbst
  // behandeln ihre Klicks in den Ebenen-Handlern weiter unten).
  if (stallplanerMode === null && stallplanerSelection &&
      !e.target.closest('#stallplan-outline-layer, #stallplan-compartments-layer, #stallplan-equipment-layer')) {
    selectStallplanItem(null);
  }
});
stallplanSvgEl.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || stallplanPointers.size > 1) return;
  if (stallplanDrawModeActive() && stallplanerDrawPoints && stallplanerDrawPoints.length) {
    const plan = activeStallplan();
    if (plan) renderStallplanDrawPreview(snapStallplanPoint(stallplanSvgPoint(e), plan));
  }
});
stallplanSvgEl.addEventListener('dblclick', (e) => {
  if (stallplanDrawModeActive()) { e.preventDefault(); finishStallplanDraw(); }
});
// Rechtsklick entfernt beim Zeichnen den zuletzt gesetzten Punkt wieder
// (Desktop — auf Touch übernimmt das der Button "Letzter Punkt").
stallplanSvgEl.addEventListener('contextmenu', (e) => {
  if (stallplanDrawModeActive() && stallplanerDrawPoints && stallplanerDrawPoints.length) {
    e.preventDefault();
    stallplanerDrawPoints.pop();
    const plan = activeStallplan();
    renderStallplanDrawPreview(plan ? snapStallplanPoint(stallplanSvgPoint(e), plan) : null);
  }
});

// ---- Zoomen (Mausrad, Zwei-Finger-Pinch — jederzeit) + Verschieben (ein
// Finger/Maus nur ohne aktives Werkzeug, sonst wäre der Tipp schon für
// Zeichnen/Platzieren belegt; zwei Finger immer). ----
function zoomStallplanAround(anchorGrid, anchorScreenFrac, newW, startBox) {
  const w = clampStallplanZoomWidth(newW);
  const h = startBox.h * (w / startBox.w);
  stallplanerViewBox = { x: anchorGrid.x - anchorScreenFrac.x * w, y: anchorGrid.y - anchorScreenFrac.y * h, w, h };
  stallplanerViewLocked = true;
  applyStallplanerViewBox();
  renderStallplanGrid();
  rescaleStallplanDynamicElements();
}
stallplanSvgEl.addEventListener('wheel', (e) => {
  const plan = activeStallplan();
  if (!plan) return;
  e.preventDefault();
  const rect = stallplanSvgEl.getBoundingClientRect();
  const vb = stallplanDisplayBox();
  const frac = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  const anchor = { x: vb.x + frac.x * vb.w, y: vb.y + frac.y * vb.h };
  zoomStallplanAround(anchor, frac, vb.w * (e.deltaY > 0 ? 1.15 : 1 / 1.15), vb);
}, { passive: false });

const stallplanPointers = new Map(); // pointerId -> { x, y } (Bildschirm)
let stallplanGesture = null; // { type: 'pan'|'pinch', ... }
function stallplanPinchState() {
  const [a, b] = [...stallplanPointers.values()];
  return { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}
stallplanSvgEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button > 0) return;
  stallplanPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const rect = stallplanSvgEl.getBoundingClientRect();
  if (stallplanPointers.size === 2) {
    // Zweiter Finger: laufende Skizze/Verschieben pausieren, Pinch starten.
    const { dist, mid } = stallplanPinchState();
    const box = stallplanDisplayBox();
    const frac = { x: (mid.x - rect.left) / rect.width, y: (mid.y - rect.top) / rect.height };
    stallplanGesture = { type: 'pinch', rect, startDist: dist, startBox: box, anchor: { x: box.x + frac.x * box.w, y: box.y + frac.y * box.h } };
    return;
  }
  if (stallplanPointers.size === 1 && stallplanerMode === null && !stallplanerTask) {
    e.preventDefault();
    stallplanGesture = { type: 'pan', rect, startX: e.clientX, startY: e.clientY, startBox: stallplanDisplayBox(), moved: false };
    stallplanSvgEl.style.cursor = 'grabbing';
  }
});
document.addEventListener('pointermove', (e) => {
  if (!stallplanPointers.has(e.pointerId)) return;
  stallplanPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = stallplanGesture;
  if (!g) return;
  if (g.type === 'pinch' && stallplanPointers.size >= 2) {
    const { dist, mid } = stallplanPinchState();
    const frac = { x: (mid.x - g.rect.left) / g.rect.width, y: (mid.y - g.rect.top) / g.rect.height };
    scheduleStallplanFrame(() => zoomStallplanAround(g.anchor, frac, g.startBox.w * (g.startDist / dist), g.startBox));
  } else if (g.type === 'pan') {
    const dxPx = e.clientX - g.startX, dyPx = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dxPx, dyPx) < 4) return; // Zittern beim Tippen ist kein Verschieben
    g.moved = true;
    scheduleStallplanFrame(() => {
      stallplanerViewBox = {
        x: g.startBox.x - (dxPx / g.rect.width) * g.startBox.w,
        y: g.startBox.y - (dyPx / g.rect.height) * g.startBox.h,
        w: g.startBox.w, h: g.startBox.h
      };
      applyStallplanerViewBox();
      renderStallplanGrid();
    });
  }
});
function endStallplanPointer(e) {
  if (!stallplanPointers.has(e.pointerId)) return;
  stallplanPointers.delete(e.pointerId);
  const g = stallplanGesture;
  if (!g) return;
  flushStallplanFrame();
  if (g.type === 'pinch') {
    if (stallplanPointers.size < 2) { stallplanGesture = null; suppressNextStallplanClick(); }
  } else if (g.type === 'pan') {
    stallplanGesture = null;
    renderStallplanerChrome(); // setzt den Cursor zurück
    if (g.moved) { stallplanerViewLocked = true; suppressNextStallplanClick(); }
  }
}
document.addEventListener('pointerup', endStallplanPointer);
document.addEventListener('pointercancel', endStallplanPointer);

// Größe der Zeichenfläche ändert sich z.B., wenn das Sheet auf- oder
// zugeht oder das Handy gedreht wird — viewBox-Seitenverhältnis und
// Griffgrößen hängen daran.
new ResizeObserver(() => {
  if (document.getElementById('stallplaner-view').hidden) return;
  applyStallplanerViewBox();
  renderStallplanGrid();
  rescaleStallplanDynamicElements();
}).observe(stallplanSvgEl);

document.addEventListener('keydown', (e) => {
  if (document.getElementById('stallplaner-view').hidden) return;
  if (e.key === 'Escape' && stallplanDrawModeActive()) cancelStallplanDraw();
  else if (e.key === 'Enter' && stallplanDrawModeActive()) finishStallplanDraw();
});

document.getElementById('stallplan-outline-layer').addEventListener('click', (e) => {
  if (e.target.tagName !== 'polygon' || stallplanerTask) return;
  const plan = activeStallplan();
  if (!plan) return;
  if (stallplanerMode === null) {
    e.stopPropagation();
    selectStallplanItem('outline');
  } else if (stallplanerMode === 'edit-vertex') {
    // Nur beim tatsächlichen Wechsel der Auswahl neu fokussieren — sonst
    // würde ein erneuter Klick auf die bereits ausgewählte Form eine evtl.
    // zusätzlich manuell nachjustierte Zoomstufe wieder verwerfen.
    const changed = stallplanerEditTargetKind !== 'outline';
    stallplanerEditTargetKind = 'outline';
    stallplanerEditTargetId = null;
    if (changed) focusStallplanShape(plan.outline.points);
    renderStallplan();
  } else if (stallplanerMode === 'measure') {
    startStallplanMeasureWalk('outline', null, plan.outline.points);
  } else if (stallplanerMode === 'delete') {
    if (!confirm('Umriss wirklich löschen?')) return;
    pushStallplanerUndo();
    plan.outline = null;
    stallplanerStep = 'umriss';
    renderStallplan();
    renderStallplanerSidebar();
  }
});
document.getElementById('stallplan-compartments-layer').addEventListener('click', (e) => {
  const wrap = e.target.closest('.stallplan-compartment');
  if (!wrap || stallplanerTask) return;
  const plan = activeStallplan();
  if (!plan) return;
  const id = wrap.getAttribute('data-id');
  if (stallplanerMode === null) {
    e.stopPropagation();
    selectStallplanItem('compartment', id);
  } else if (stallplanerMode === 'edit-vertex') {
    const changed = stallplanerEditTargetKind !== 'compartment' || stallplanerEditTargetId !== id;
    stallplanerEditTargetKind = 'compartment';
    stallplanerEditTargetId = id;
    if (changed) {
      const target = plan.compartments.find(c => c.id === id);
      if (target) focusStallplanShape(target.points);
    }
    renderStallplan();
  } else if (stallplanerMode === 'measure') {
    const target = plan.compartments.find(c => c.id === id);
    if (target) startStallplanMeasureWalk('compartment', id, target.points);
  } else if (stallplanerMode === 'delete') {
    pushStallplanerUndo();
    plan.compartments = plan.compartments.filter(c => c.id !== id);
    renderStallplan();
    renderStallplanerSidebar();
  }
});
document.getElementById('stallplan-equipment-layer').addEventListener('click', (e) => {
  const wrap = e.target.closest('.stallplan-equipment');
  if (!wrap || stallplanerTask) return;
  const plan = activeStallplan();
  if (!plan) return;
  const id = wrap.getAttribute('data-id');
  const item = plan.equipment.find(x => x.id === id);
  if (!item) return;
  if (stallplanerMode === null) {
    e.stopPropagation();
    selectStallplanItem('equipment', id);
    return;
  }
  // Nur Linie/Fläche haben mehrere Eckpunkte, die sich einzeln auswählen/
  // bearbeiten lassen — ein Punkt-Element lässt sich direkt per Ganz-
  // Element-Drag verschieben (siehe wireStallplanEquipmentBodyDrag()).
  if (stallplanerMode === 'edit-vertex' && item.geometryKind !== 'point') {
    const changed = stallplanerEditTargetKind !== 'equipment' || stallplanerEditTargetId !== id;
    stallplanerEditTargetKind = 'equipment';
    stallplanerEditTargetId = id;
    if (changed) focusStallplanShape(item.points);
    renderStallplan();
  } else if (stallplanerMode === 'delete') {
    pushStallplanerUndo();
    plan.equipment = plan.equipment.filter(x => x.id !== id);
    renderStallplan();
  }
});

// ---- Vor-Ort-Oberfläche: Schrittleiste, Aktionsleiste, Hinweis, Startkarte ----
// Der Stallplan wird im Stall mit Handy/Tablet erfasst: statt einer Leiste
// unbeschrifteter Icons führt eine feste Schrittfolge (Umriss → Abteile →
// Ausstattung → Tiere) durch den Plan, die untere Leiste zeigt nur die im
// aktuellen Schritt sinnvollen Aktionen, und der Hinweis oben sagt immer
// genau, was als Nächstes zu tun ist.
const STALLPLANER_STEPS = ['umriss', 'abteile', 'ausstattung', 'tiere'];
const STALLPLANER_TASK_PANELS = ['stallplaner-panel-rect', 'stallplaner-panel-walls', 'stallplaner-panel-split', 'stallplaner-measure-panel'];
const STALLPLANER_EQUIP_LABELS = {
  traenke: 'Tränke', raufe: 'Raufe', futterautomat: 'Futterautomat', nest: 'Nest',
  sitzstange: 'Sitzstange', tuer: 'Tür', fenster: 'Fenster', futtergang: 'Futtergang'
};

function isWideStallplanerLayout() {
  return window.matchMedia('(min-width: 861px)').matches;
}

function stallplanerFlash(msg) {
  document.getElementById('stallplaner-status').textContent = msg;
  stallplanerFlashMsg = msg;
  clearTimeout(stallplanerFlashTimer);
  stallplanerFlashTimer = setTimeout(() => { stallplanerFlashMsg = null; renderStallplanerChrome(); }, 5000);
  renderStallplanerChrome();
}

function stallplanerHintText(plan) {
  if (stallplanerFlashMsg) return stallplanerFlashMsg;
  if (!plan) return '';
  const task = stallplanerTask;
  if (task && task.type === 'walls') {
    if (task.target === 'compartment' && !task.segments.length) return 'Tippe die Ecke an, an der das Abteil beginnt (orange) — oder gib gleich die erste Wand ein.';
    return 'Länge der nächsten Wand eintippen, dann die Richtung antippen.';
  }
  if (task && task.type === 'rect' && task.target === 'compartment') return 'Startecke antippen (orange). Das Abteil wird von dort ins Stallinnere aufgespannt.';
  if (task) return '';
  if (stallplanerMeasureOriginalPoints) {
    return `Kante ${stallplanerMeasureIndex + 1} von ${stallplanerMeasureOriginalPoints.length} messen (orange markiert) und unten eintragen.`;
  }
  if (stallplanDrawModeActive()) {
    if (stallplanerMode === 'place-equipment' && stallplanerEquipGeometryKind === 'line') return 'Anfang und Ende antippen, dann „Fertig".';
    return 'Ecken nacheinander antippen. Zum Schließen den ersten Punkt antippen oder „Fertig".';
  }
  switch (stallplanerMode) {
    case 'place-equipment': return `${STALLPLANER_EQUIP_LABELS[stallplanerEquipType] || 'Ausstattung'}: Stelle im Plan antippen — auch mehrmals nacheinander.`;
    case 'edit-vertex': return 'Form antippen, dann Ecken ziehen oder eine Maßzahl antippen, um sie zu ändern.';
    case 'measure': return 'Umriss oder Abteil antippen, das du vermessen willst.';
    case 'delete': return 'Antippen, was gelöscht werden soll.';
  }
  const m2 = (pts) => (shoelaceArea(pts) * plan.gridScale * plan.gridScale).toFixed(1).replace('.', ',');
  if (stallplanerStep === 'umriss') return plan.outline ? `Stall: ${m2(plan.outline.points)} m². Weiter mit „2 Abteile" — oder „Vermessen", um Maße zu korrigieren.` : '';
  if (stallplanerStep === 'abteile') return plan.compartments.length
    ? 'Abteil antippen für Details. Weiter mit „3 Ausstattung" oder „4 Tiere".'
    : '„Teilen" legt eine Buchtenreihe an, „Abteil" ein einzelnes Abteil.';
  if (stallplanerStep === 'ausstattung') return '„Platzieren" antippen, Art wählen und im Plan antippen. Antippen einer Ausstattung zeigt sie an.';
  if (stallplanerStep === 'tiere') {
    if (!plan.compartments.length) return 'Erst Abteile anlegen (Schritt 2), dann hier Tierzahlen eintragen.';
    return isWideStallplanerLayout() ? 'Tierart und Tierzahlen links in der Abteil-Liste eintragen.' : 'Tierart und Tierzahlen unten je Abteil eintragen.';
  }
  return '';
}

function renderStallplanerChrome() {
  const plan = activeStallplan();
  const done = {
    umriss: !!(plan && plan.outline),
    abteile: !!(plan && plan.compartments.length),
    ausstattung: !!(plan && plan.equipment.length),
    tiere: !!(plan && plan.compartments.some(c => c.tierbestand.some(tb => tb.kategorieId && tb.tieranzahl)))
  };
  document.querySelectorAll('.stallplaner-step').forEach(btn => {
    const step = btn.getAttribute('data-step');
    btn.classList.toggle('active', step === stallplanerStep);
    btn.classList.toggle('done', done[step]);
    btn.querySelector('.stallplaner-step-num').textContent = done[step] ? '✓' : String(STALLPLANER_STEPS.indexOf(step) + 1);
    btn.disabled = !plan;
  });

  const drawing = stallplanDrawModeActive();
  const hasGeometry = !!plan && !!(plan.outline || plan.compartments.length || plan.equipment.length);
  const visibleByKey = {
    'drawing': drawing,
    'create-outline': stallplanerStep === 'umriss' && !!plan && !plan.outline,
    'abteile': stallplanerStep === 'abteile',
    'ausstattung': stallplanerStep === 'ausstattung',
    'tiere': stallplanerStep === 'tiere',
    'geometry': stallplanerStep !== 'tiere' && hasGeometry,
    'measure': stallplanerStep !== 'tiere' && !!plan && !!(plan.outline || plan.compartments.length)
  };
  document.querySelectorAll('#stallplaner-actions .stallplaner-act').forEach(btn => {
    const key = btn.getAttribute('data-show');
    btn.hidden = drawing ? key !== 'drawing' : !visibleByKey[key];
  });
  document.querySelectorAll('#stallplaner-view [data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tool') === stallplanerMode);
  });
  // Ein aktives Ausstattungs-Werkzeug beendet man mit demselben Button —
  // "Fertig" sagt das deutlicher als ein nur hervorgehobenes "Platzieren".
  document.querySelector('#stallplaner-tool-equipment span:last-child').textContent = stallplanerMode === 'place-equipment' ? 'Fertig' : 'Platzieren';
  document.getElementById('stallplaner-actionbar').hidden = !plan || STALLPLANER_TASK_PANELS.includes(stallplanerSheetPanel);
  document.getElementById('stallplaner-undo').disabled = !stallplanerUndoStack.length;
  document.getElementById('stallplaner-redo').disabled = !stallplanerRedoStack.length;

  const startCard = document.getElementById('stallplaner-start-card');
  const showOutlineStart = !!plan && stallplanerStep === 'umriss' && !plan.outline && !plan.compartments.length &&
    !plan.equipment.length && stallplanerMode === null && !stallplanerSheetPanel;
  startCard.hidden = !!plan && !showOutlineStart;
  document.getElementById('stallplaner-start-noplan').hidden = !!plan;
  document.getElementById('stallplaner-start-outline').hidden = !showOutlineStart;

  const hint = document.getElementById('stallplaner-draw-hint');
  const text = startCard.hidden ? stallplanerHintText(plan) : '';
  hint.textContent = text;
  hint.hidden = !text;
  hint.classList.toggle('flash', !!stallplanerFlashMsg);

  const cursors = {
    'draw-outline': 'crosshair', 'draw-compartment': 'crosshair',
    'place-equipment': 'copy', 'measure': 'crosshair', 'delete': 'not-allowed'
  };
  // Kein Werkzeug aktiv -> Ziehen verschiebt die Ansicht, "grab" signalisiert das.
  stallplanSvgEl.style.cursor = stallplanerTask ? 'crosshair' : (cursors[stallplanerMode] || (stallplanerMode === 'edit-vertex' ? 'default' : 'grab'));
}

// ---- Bottom Sheet (ein gemeinsamer Platz für alle Eingaben) ----
function openStallplanerSheet(panelId, title) {
  document.querySelectorAll('#stallplaner-sheet .stallplaner-panel').forEach(p => { p.hidden = p.id !== panelId; });
  if (panelId !== 'stallplaner-panel-selection') document.getElementById('stallplaner-panel-selection').innerHTML = '';
  if (panelId !== 'stallplaner-panel-animals') document.getElementById('stallplaner-animals-list').innerHTML = '';
  document.getElementById('stallplaner-sheet-title').textContent = title;
  document.getElementById('stallplaner-sheet').hidden = false;
  stallplanerSheetPanel = panelId;
  renderStallplanerChrome();
}
// Nur ausblenden, ohne Seiteneffekte — Aufräumen der jeweiligen Aufgabe
// übernimmt cancelStallplanerSheet() bzw. die Aufgabe selbst.
function hideStallplanerSheet() {
  document.getElementById('stallplaner-sheet').hidden = true;
  document.querySelectorAll('#stallplaner-sheet .stallplaner-panel').forEach(p => { p.hidden = true; });
  // Dynamisch gerenderte Karten leeren — sonst lägen veraltete, versteckte
  // Kopien derselben Abteil-Karte weiter im DOM.
  document.getElementById('stallplaner-panel-selection').innerHTML = '';
  document.getElementById('stallplaner-animals-list').innerHTML = '';
  stallplanerSheetPanel = null;
  renderStallplanerChrome();
}
function cancelStallplanerSheet() {
  const panel = stallplanerSheetPanel;
  if (panel === 'stallplaner-measure-panel') { cancelStallplanMeasureWalk(); return; }
  if (panel === 'stallplaner-panel-equipment' && stallplanerMode === 'place-equipment') {
    cancelStallplanDraw();
    stallplanerMode = null;
  }
  if (panel === 'stallplaner-panel-selection') stallplanerSelection = null;
  endStallplanTask();
  hideStallplanerSheet();
  renderStallplan();
  renderStallplanerSidebar();
}
document.getElementById('stallplaner-sheet-close').addEventListener('click', cancelStallplanerSheet);
document.querySelectorAll('#stallplaner-sheet [data-sheet-cancel]').forEach(btn => btn.addEventListener('click', cancelStallplanerSheet));

// Beendet Werkzeug, laufende Skizze, Aufgabe (Rechteck/Wände/Teilen),
// Vermessen und Auswahl — Ausgangspunkt für jede neue Aktion.
function resetStallplanerInteraction() {
  if (stallplanerDrawPoints) cancelStallplanDraw();
  if (stallplanerMeasureOriginalPoints) closeStallplanMeasurePanel();
  endStallplanTask();
  stallplanerMode = null;
  stallplanerEditTargetKind = null;
  stallplanerEditTargetId = null;
  stallplanerSelection = null;
  closeEdgeLengthEditor();
  document.getElementById('stallplaner-more-menu').hidden = true;
  if (stallplanerSheetPanel) hideStallplanerSheet();
}

function setStallplanerStep(step) {
  resetStallplanerInteraction();
  stallplanerStep = step;
  if (step === 'tiere' && !isWideStallplanerLayout() && activeStallplan()) openStallplanerAnimalsPanel();
  renderStallplan();
  renderStallplanerSidebar();
}
document.querySelectorAll('.stallplaner-step').forEach(btn => {
  btn.addEventListener('click', () => setStallplanerStep(btn.getAttribute('data-step')));
});

function activateStallplanerTool(tool) {
  const next = stallplanerMode === tool ? null : tool;
  resetStallplanerInteraction();
  stallplanerMode = next;
  // Eine neu gestartete Zeichnung soll immer sichtbar mitwachsen, auch
  // wenn die Ansicht vorher manuell weggezoomt/verschoben war.
  if (next === 'draw-outline' || next === 'draw-compartment') stallplanerViewLocked = false;
  if (next === 'place-equipment') openStallplanerSheet('stallplaner-panel-equipment', 'Ausstattung platzieren');
  renderStallplanerChrome();
  renderStallplan();
}
document.querySelectorAll('#stallplaner-view [data-tool]').forEach(btn => {
  btn.addEventListener('click', () => activateStallplanerTool(btn.getAttribute('data-tool')));
});

function updateStallplanerEquipGeometryToggle() {
  document.querySelectorAll('#stallplaner-equip-geometry-toggle [data-geometry]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-geometry') === stallplanerEquipGeometryKind);
  });
}
document.querySelectorAll('#stallplaner-equip-grid [data-equip]').forEach(btn => {
  if (btn.getAttribute('data-equip') === stallplanerEquipType) btn.classList.add('active');
  btn.addEventListener('click', () => {
    if (stallplanerDrawPoints) cancelStallplanDraw();
    stallplanerEquipType = btn.getAttribute('data-equip');
    // Schlägt eine zum Typ passende Form vor (z.B. Sitzstange -> Linie),
    // bleibt aber jederzeit über den Formen-Umschalter überschreibbar.
    stallplanerEquipGeometryKind = STALLPLANER_EQUIP_DEFAULT_GEOMETRY[stallplanerEquipType] || 'point';
    document.querySelectorAll('#stallplaner-equip-grid [data-equip]').forEach(b => b.classList.toggle('active', b === btn));
    updateStallplanerEquipGeometryToggle();
    renderStallplanerChrome();
  });
});
document.querySelectorAll('#stallplaner-equip-geometry-toggle [data-geometry]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (stallplanerDrawPoints) cancelStallplanDraw();
    stallplanerEquipGeometryKind = btn.getAttribute('data-geometry');
    updateStallplanerEquipGeometryToggle();
    renderStallplanerChrome();
  });
});
updateStallplanerEquipGeometryToggle();

// Skizzieren ohne Doppelklick/Rechtsklick (Touch hat beides nicht).
document.getElementById('stallplaner-draw-finish').addEventListener('click', () => finishStallplanDraw());
document.getElementById('stallplaner-draw-cancel').addEventListener('click', () => {
  cancelStallplanDraw();
  stallplanerMode = null;
  renderStallplanerChrome();
  renderStallplan();
});
document.getElementById('stallplaner-draw-undo-point').addEventListener('click', () => {
  if (!stallplanerDrawPoints || !stallplanerDrawPoints.length) return;
  stallplanerDrawPoints.pop();
  if (!stallplanerDrawPoints.length) stallplanerDrawPoints = null;
  renderStallplanDrawPreview(null);
});

document.getElementById('stallplaner-undo').addEventListener('click', undoStallplaner);
document.getElementById('stallplaner-redo').addEventListener('click', redoStallplaner);
document.getElementById('stallplaner-fit-view').addEventListener('click', fitStallplanerView);
document.getElementById('stallplaner-act-pdf').addEventListener('click', () => exportStallplanPDF());

const stallplanerMoreMenu = document.getElementById('stallplaner-more-menu');
document.getElementById('stallplaner-more-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  stallplanerMoreMenu.hidden = !stallplanerMoreMenu.hidden;
  document.getElementById('stallplaner-more-btn').setAttribute('aria-expanded', String(!stallplanerMoreMenu.hidden));
});
stallplanerMoreMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => {
  if (!stallplanerMoreMenu.hidden) {
    stallplanerMoreMenu.hidden = true;
    document.getElementById('stallplaner-more-btn').setAttribute('aria-expanded', 'false');
  }
});

document.getElementById('stallplaner-start-new-plan').addEventListener('click', () => {
  document.getElementById('stallplaner-new-plan').click();
});

document.querySelectorAll('#stallplaner-view [data-act]').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.getAttribute('data-act');
    if (act === 'rect-outline') openStallplanRectPanel('outline');
    else if (act === 'sketch-outline') activateStallplanerTool('draw-outline');
    else if (act === 'rect-compartment') openStallplanRectPanel('compartment');
    else if (act === 'walls-outline') openStallplanWallsPanel('outline');
    else if (act === 'walls-compartment') openStallplanWallsPanel('compartment');
    else if (act === 'add-compartment') {
      resetStallplanerInteraction();
      openStallplanerSheet('stallplaner-panel-add-compartment', 'Abteil hinzufügen');
    } else if (act === 'split') {
      const sel = stallplanerSelection;
      openStallplanSplitPanel(sel && sel.kind === 'compartment' ? { kind: 'compartment', id: sel.id } : { kind: 'outline' });
    } else if (act === 'animals') {
      resetStallplanerInteraction();
      openStallplanerAnimalsPanel();
    }
  });
});

// ---- Aufgaben mit Maß-Eingabe (Rechteck, Wand für Wand, Buchten teilen) ----
function endStallplanTask() {
  if (!stallplanerTask) return;
  stallplanerTask = null;
  document.getElementById('stallplan-draw-preview-layer').innerHTML = '';
}

function defaultStallplanCompartmentStart(plan) {
  return plan.outline ? { ...plan.outline.points[0] } : { x: 0, y: 0 };
}

// Tippen während einer Aufgabe wählt die Startecke: rastet auf die nächste
// vorhandene Ecke (Umriss/Abteile) im Fingerbereich ein, sonst aufs Raster.
function pickStallplanStartPoint(raw, plan) {
  const tol = stallplanScreenSize(STALLPLAN_CLOSE_TOLERANCE_PX);
  let best = null, bestDist = Infinity;
  const candidates = [];
  if (plan.outline) candidates.push(...plan.outline.points);
  plan.compartments.forEach(c => candidates.push(...c.points));
  candidates.forEach(p => {
    const d = Math.hypot(p.x - raw.x, p.y - raw.y);
    if (d < bestDist) { bestDist = d; best = p; }
  });
  if (best && bestDist <= tol) return { ...best };
  return snapStallplanPoint(raw, plan);
}

// Stellt ein im Plan-Koordinatensystem (Rastereinheiten) aus Metern
// gemessenes Rechteck an der Startecke auf — bei Abteilen in den Quadranten,
// der im Stallinneren liegt (Startecke kann jede Umriss-Ecke sein).
function stallplanRectFromStart(plan, start, lengthM, widthM, target) {
  const w = lengthM / plan.gridScale, h = widthM / plan.gridScale;
  const make = (sx, sy) => [
    { x: start.x, y: start.y }, { x: start.x + sx * w, y: start.y },
    { x: start.x + sx * w, y: start.y + sy * h }, { x: start.x, y: start.y + sy * h }
  ];
  if (target === 'compartment' && plan.outline) {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const pts = make(sx, sy);
      if (pointInPolygon(polygonCentroid(pts), plan.outline.points)) return pts;
    }
  }
  return make(1, 1);
}

function openStallplanRectPanel(target) {
  const plan = activeStallplan();
  if (!plan) return;
  resetStallplanerInteraction();
  stallplanerTask = { type: 'rect', target, start: target === 'compartment' ? defaultStallplanCompartmentStart(plan) : { x: 0, y: 0 } };
  document.getElementById('stallplaner-rect-length').value = '';
  document.getElementById('stallplaner-rect-width').value = '';
  document.getElementById('stallplaner-rect-error').hidden = true;
  document.getElementById('stallplaner-rect-hint').textContent = target === 'outline'
    ? 'Innenmaße des Stalls. Die Länge wird waagerecht gezeichnet.'
    : 'Startecke im Plan antippen (orange), dann Maße eingeben.';
  openStallplanerSheet('stallplaner-panel-rect', target === 'outline' ? 'Rechteckiger Stall' : 'Rechteckiges Abteil');
  renderStallplan();
  document.getElementById('stallplaner-rect-length').focus();
}

function readStallplanRectInputs() {
  return {
    lengthM: parseDecimalInput(document.getElementById('stallplaner-rect-length').value),
    widthM: parseDecimalInput(document.getElementById('stallplaner-rect-width').value)
  };
}

function applyStallplanRect() {
  const plan = activeStallplan();
  const task = stallplanerTask;
  if (!plan || !task || task.type !== 'rect') return;
  const { lengthM, widthM } = readStallplanRectInputs();
  const errorEl = document.getElementById('stallplaner-rect-error');
  if (!(lengthM > 0) || !(widthM > 0)) {
    errorEl.textContent = 'Bitte Länge und Breite in Metern eingeben, z.B. 24,5.';
    errorEl.hidden = false;
    return;
  }
  const points = stallplanRectFromStart(plan, task.start, lengthM, widthM, task.target);
  commitStallplanTaskShape(plan, task.target, points);
}
document.getElementById('stallplaner-rect-apply').addEventListener('click', applyStallplanRect);
['stallplaner-rect-length', 'stallplaner-rect-width'].forEach(id => {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    document.getElementById('stallplaner-rect-error').hidden = true;
    renderStallplan();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (id === 'stallplaner-rect-length') document.getElementById('stallplaner-rect-width').focus();
    else applyStallplanRect();
  });
});

// Übernimmt eine per Maß-Eingabe entstandene Form als Umriss bzw. neues
// Abteil — ein Undo-Schritt, danach automatisch weiter zum nächsten Schritt.
function commitStallplanTaskShape(plan, target, points) {
  pushStallplanerUndo();
  if (target === 'outline') {
    plan.outline = { points };
  } else {
    plan.compartments.push({
      id: 'abteil-' + Date.now() + Math.random().toString(36).slice(2),
      name: `Abteil ${plan.compartments.length + 1}`,
      points, tierbestand: []
    });
  }
  endStallplanTask();
  hideStallplanerSheet();
  stallplanerViewLocked = false;
  const areaM2 = (shoelaceArea(points) * plan.gridScale * plan.gridScale).toFixed(1).replace('.', ',');
  if (target === 'outline') {
    stallplanerStep = 'abteile';
    fitStallplanerView();
    renderStallplan();
    renderStallplanerSidebar();
    stallplanerFlash(`Stall mit ${areaM2} m² angelegt. Jetzt Abteile anlegen oder den Stall in Buchten teilen.`);
  } else {
    renderStallplan();
    renderStallplanerSidebar();
    stallplanerFlash(`Abteil mit ${areaM2} m² angelegt.`);
  }
}

const STALLPLAN_WALL_DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } };
const STALLPLAN_WALL_DIR_OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };

function openStallplanWallsPanel(target) {
  const plan = activeStallplan();
  if (!plan) return;
  resetStallplanerInteraction();
  stallplanerTask = { type: 'walls', target, start: target === 'compartment' ? defaultStallplanCompartmentStart(plan) : { x: 0, y: 0 }, segments: [] };
  document.getElementById('stallplaner-walls-length').value = '';
  document.getElementById('stallplaner-walls-error').hidden = true;
  document.getElementById('stallplaner-walls-hint').textContent = target === 'outline'
    ? 'An einer Stallecke beginnen und einmal im Kreis messen — Länge eintippen, Richtung antippen, nächste Wand.'
    : 'Ab der orangen Startecke Wand für Wand um das Abteil herum messen.';
  updateStallplanWallsSummary();
  openStallplanerSheet('stallplaner-panel-walls', target === 'outline' ? 'Stall Wand für Wand' : 'Abteil Wand für Wand');
  renderStallplan();
  document.getElementById('stallplaner-walls-length').focus();
}

function stallplanWallsPoints(task, plan) {
  const pts = [{ ...task.start }];
  task.segments.forEach(seg => {
    const last = pts[pts.length - 1];
    const d = STALLPLAN_WALL_DIRS[seg.dir];
    pts.push({ x: last.x + d.x * seg.lengthM / plan.gridScale, y: last.y + d.y * seg.lengthM / plan.gridScale });
  });
  return pts;
}

function formatStallplanMeters(m) {
  return (Math.round(m * 100) / 100).toFixed(2).replace('.', ',');
}

function updateStallplanWallsSummary() {
  const task = stallplanerTask;
  const plan = activeStallplan();
  const el = document.getElementById('stallplaner-walls-summary');
  if (!task || !plan) { el.textContent = ''; return; }
  document.getElementById('stallplaner-walls-undo').disabled = !task.segments.length;
  document.getElementById('stallplaner-walls-close').disabled = task.segments.length < 2;
  if (!task.segments.length) { el.textContent = 'Noch keine Wand eingegeben.'; return; }
  const pts = stallplanWallsPoints(task, plan);
  const end = pts[pts.length - 1];
  const gapM = Math.hypot(end.x - task.start.x, end.y - task.start.y) * plan.gridScale;
  el.textContent = `${task.segments.length} ${task.segments.length === 1 ? 'Wand' : 'Wände'} · bis zum Startpunkt fehlen ${formatStallplanMeters(gapM)} m`;
}

// Hält die bisher eingegebenen Wände mittig im Bild — der Stall wächst beim
// Eintippen sonst aus dem sichtbaren Bereich bzw. unter den Hinweis.
function focusStallplanWalls() {
  const plan = activeStallplan();
  const task = stallplanerTask;
  if (!plan || !task || task.type !== 'walls') return;
  const pts = stallplanWallsPoints(task, plan);
  if (pts.length > 1) focusStallplanShape(pts);
}
function addStallplanWall(dir) {
  const task = stallplanerTask;
  if (!task || task.type !== 'walls') return;
  const input = document.getElementById('stallplaner-walls-length');
  const errorEl = document.getElementById('stallplaner-walls-error');
  const lengthM = parseDecimalInput(input.value);
  if (!(lengthM > 0)) {
    errorEl.textContent = 'Erst die Länge der Wand in Metern eintippen, dann die Richtung.';
    errorEl.hidden = false;
    input.focus();
    return;
  }
  const last = task.segments[task.segments.length - 1];
  if (last && STALLPLAN_WALL_DIR_OPPOSITE[last.dir] === dir) {
    errorEl.textContent = 'Diese Richtung läuft auf der letzten Wand zurück — bitte eine andere Richtung wählen.';
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  task.segments.push({ dir, lengthM });
  input.value = '';
  input.focus();
  updateStallplanWallsSummary();
  focusStallplanWalls();
  renderStallplan();
  renderStallplanerChrome();
}
document.querySelectorAll('#stallplaner-walls-pad [data-dir]').forEach(btn => {
  btn.addEventListener('click', () => addStallplanWall(btn.getAttribute('data-dir')));
});
document.getElementById('stallplaner-walls-length').addEventListener('input', () => {
  document.getElementById('stallplaner-walls-error').hidden = true;
});
document.getElementById('stallplaner-walls-undo').addEventListener('click', () => {
  const task = stallplanerTask;
  if (!task || task.type !== 'walls' || !task.segments.length) return;
  const removed = task.segments.pop();
  document.getElementById('stallplaner-walls-length').value = String(removed.lengthM).replace('.', ',');
  updateStallplanWallsSummary();
  focusStallplanWalls();
  renderStallplan();
});

function closeStallplanWalls() {
  const plan = activeStallplan();
  const task = stallplanerTask;
  if (!plan || !task || task.type !== 'walls') return;
  const errorEl = document.getElementById('stallplaner-walls-error');
  if (task.segments.length < 2) {
    errorEl.textContent = 'Mindestens zwei Wände eingeben.';
    errorEl.hidden = false;
    return;
  }
  const pts = stallplanWallsPoints(task, plan);
  const end = pts[pts.length - 1];
  const dxM = (task.start.x - end.x) * plan.gridScale, dyM = (task.start.y - end.y) * plan.gridScale;
  const eps = 0.005;
  let points = pts;
  let note = '';
  if (Math.abs(dxM) < eps && Math.abs(dyM) < eps) {
    points = pts.slice(0, -1); // letzte Wand endet genau am Start
  } else if (Math.abs(dxM) < eps || Math.abs(dyM) < eps) {
    note = ` Letzte Wand (${formatStallplanMeters(Math.hypot(dxM, dyM))} m) automatisch ergänzt.`;
  } else if (!confirm(`Die Wände treffen den Startpunkt nicht (${formatStallplanMeters(Math.abs(dxM))} m waagerecht und ${formatStallplanMeters(Math.abs(dyM))} m senkrecht daneben). Mit einer schrägen Wand schließen?`)) {
    return;
  }
  points = simplifyCollinearPoints(points);
  if (points.length < 3) {
    errorEl.textContent = 'Die Wände ergeben keine Fläche — bitte prüfen.';
    errorEl.hidden = false;
    return;
  }
  commitStallplanTaskShape(plan, task.target, points);
  if (note) stallplanerFlash(document.getElementById('stallplaner-status').textContent + note);
}
document.getElementById('stallplaner-walls-close').addEventListener('click', closeStallplanWalls);

// Buchten teilen: nur für achsenparallele Rechtecke (typische Buchtenreihe),
// Breiten entlang der gewählten Richtung, Rest wird die letzte Bucht.
function stallplanSplitTargetPoints(plan, target) {
  if (!target) return null;
  if (target.kind === 'outline') return plan.outline ? plan.outline.points : null;
  const c = plan.compartments.find(x => x.id === target.id);
  return c ? c.points : null;
}

function openStallplanSplitPanel(target) {
  const plan = activeStallplan();
  if (!plan) return;
  let points = stallplanSplitTargetPoints(plan, target);
  // Kein Umriss, aber genau ein Abteil -> das ist offensichtlich gemeint.
  if (!points && target.kind === 'outline' && plan.compartments.length === 1) {
    target = { kind: 'compartment', id: plan.compartments[0].id };
    points = plan.compartments[0].points;
  }
  if (!points) { stallplanerFlash('Zum Teilen zuerst den Stall-Umriss anlegen.'); return; }
  const bounds = axisAlignedRectBounds(points);
  if (!bounds) { stallplanerFlash('Teilen geht nur bei rechteckigen Flächen — ein Abteil lässt sich sonst über „Abteil" einzeln anlegen.'); return; }
  resetStallplanerInteraction();
  const wM = (bounds.maxX - bounds.minX) * plan.gridScale, hM = (bounds.maxY - bounds.minY) * plan.gridScale;
  stallplanerTask = { type: 'split', target, bounds, dir: wM >= hM ? 'x' : 'y' };
  const name = target.kind === 'outline' ? 'Ganzer Stall' : (plan.compartments.find(c => c.id === target.id) || {}).name;
  document.getElementById('stallplaner-split-target').textContent = `${name}: ${formatStallplanMeters(wM)} m × ${formatStallplanMeters(hM)} m`;
  document.getElementById('stallplaner-split-widths').value = '';
  document.getElementById('stallplaner-split-count').value = '';
  document.getElementById('stallplaner-split-error').hidden = true;
  updateStallplanSplitDirButtons();
  openStallplanerSheet('stallplaner-panel-split', 'In Buchten teilen');
  renderStallplan();
}

function updateStallplanSplitDirButtons() {
  const task = stallplanerTask;
  document.querySelectorAll('#stallplaner-panel-split [data-split-dir]').forEach(b => {
    b.classList.toggle('active', !!task && b.getAttribute('data-split-dir') === task.dir);
  });
}
document.querySelectorAll('#stallplaner-panel-split [data-split-dir]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!stallplanerTask || stallplanerTask.type !== 'split') return;
    stallplanerTask.dir = btn.getAttribute('data-split-dir');
    updateStallplanSplitDirButtons();
    renderStallplanTaskPreview();
  });
});

// Liefert { widths } oder { error } — Breiten in Metern entlang der
// Teilungsrichtung. Erlaubt "4; 4; 3,5", "4 4 3,5", "3 × 4" oder eine
// Anzahl gleich breiter Buchten.
function parseStallplanSplitWidths(totalM) {
  const countRaw = document.getElementById('stallplaner-split-count').value.trim();
  const widthsRaw = document.getElementById('stallplaner-split-widths').value.trim();
  if (countRaw) {
    const n = parseInt(countRaw, 10);
    if (!(n >= 2) || String(n) !== countRaw) return { error: 'Anzahl bitte als ganze Zahl ab 2 eingeben.' };
    return { widths: Array(n).fill(totalM / n) };
  }
  if (!widthsRaw) return { error: 'Breiten oder Anzahl der Buchten eingeben.' };
  let widths;
  const times = widthsRaw.match(/^(\d+)\s*[x×*]\s*([\d.,]+)\s*m?$/i);
  if (times) {
    const w = parseDecimalInput(times[2]);
    widths = Array(parseInt(times[1], 10)).fill(w);
  } else {
    widths = widthsRaw.split(/[;+\s]+/).filter(Boolean).map(s => parseDecimalInput(s.replace(/m$/i, '')));
  }
  if (!widths.length || widths.some(w => !(w > 0))) return { error: 'Breiten bitte als Meter eingeben, z.B. „4; 4; 3,5".' };
  const sum = widths.reduce((s, w) => s + w, 0);
  if (sum > totalM + 0.01) return { error: `Die Breiten ergeben ${formatStallplanMeters(sum)} m — mehr als die ${formatStallplanMeters(totalM)} m, die zur Verfügung stehen.` };
  if (totalM - sum > 0.05) widths.push(totalM - sum);
  if (widths.length < 2) return { error: 'Das ergibt nur eine Bucht — bitte mindestens zwei.' };
  return { widths };
}

function stallplanSplitRects(plan, task, widths) {
  const b = task.bounds;
  const rects = [];
  let pos = task.dir === 'x' ? b.minX : b.minY;
  widths.forEach(wM => {
    const w = wM / plan.gridScale;
    const next = pos + w;
    rects.push(task.dir === 'x'
      ? [{ x: pos, y: b.minY }, { x: next, y: b.minY }, { x: next, y: b.maxY }, { x: pos, y: b.maxY }]
      : [{ x: b.minX, y: pos }, { x: b.maxX, y: pos }, { x: b.maxX, y: next }, { x: b.minX, y: next }]);
    pos = next;
  });
  return rects;
}

function stallplanSplitTotalM(plan, task) {
  const b = task.bounds;
  return (task.dir === 'x' ? b.maxX - b.minX : b.maxY - b.minY) * plan.gridScale;
}

function applyStallplanSplit() {
  const plan = activeStallplan();
  const task = stallplanerTask;
  if (!plan || !task || task.type !== 'split') return;
  const errorEl = document.getElementById('stallplaner-split-error');
  const result = parseStallplanSplitWidths(stallplanSplitTotalM(plan, task));
  if (result.error) { errorEl.textContent = result.error; errorEl.hidden = false; return; }
  const original = task.target.kind === 'compartment' ? plan.compartments.find(c => c.id === task.target.id) : null;
  if (original && original.tierbestand.length &&
      !confirm(`„${original.name}" hat eingetragene Tiere — beim Teilen gehen diese Angaben verloren. Trotzdem teilen?`)) return;
  pushStallplanerUndo();
  let insertAt = plan.compartments.length;
  if (original) {
    insertAt = plan.compartments.indexOf(original);
    plan.compartments.splice(insertAt, 1);
  }
  const rects = stallplanSplitRects(plan, task, result.widths);
  const firstNumber = plan.compartments.length + 1;
  const newCompartments = rects.map((points, i) => ({
    id: 'abteil-' + Date.now() + Math.random().toString(36).slice(2),
    name: `Bucht ${firstNumber + i}`,
    points, tierbestand: []
  }));
  plan.compartments.splice(insertAt, 0, ...newCompartments);
  endStallplanTask();
  hideStallplanerSheet();
  stallplanerStep = 'abteile';
  renderStallplan();
  renderStallplanerSidebar();
  stallplanerFlash(`${rects.length} Buchten angelegt. Antippen, um sie umzubenennen oder Tiere einzutragen.`);
}
document.getElementById('stallplaner-split-apply').addEventListener('click', applyStallplanSplit);
['stallplaner-split-widths', 'stallplaner-split-count'].forEach(id => {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    document.getElementById('stallplaner-split-error').hidden = true;
    renderStallplanTaskPreview();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyStallplanSplit(); } });
});

// Vorschau der laufenden Aufgabe in der (sonst beim Skizzieren genutzten)
// Vorschau-Ebene — wird bei jedem renderStallplan() neu gezeichnet.
function renderStallplanTaskPreview() {
  const g = document.getElementById('stallplan-draw-preview-layer');
  const plan = activeStallplan();
  const task = stallplanerTask;
  g.innerHTML = '';
  if (!plan || !task) return;
  const marker = (p, cls) => g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: stallplanScreenSize(8), class: cls }));
  const wallLabel = (a, b, lengthM) => {
    const t = svgEl('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, class: 'stallplan-edge-label', 'font-size': stallplanScreenSize(12) });
    t.textContent = formatStallplanMeters(lengthM) + ' m';
    g.appendChild(t);
  };
  if (task.type === 'rect') {
    const { lengthM, widthM } = readStallplanRectInputs();
    if (lengthM > 0 && widthM > 0) {
      const pts = stallplanRectFromStart(plan, task.start, lengthM, widthM, task.target);
      g.appendChild(svgEl('polygon', { points: pointsAttr(pts), class: 'stallplan-walls-closing' }));
    }
    if (task.target === 'compartment') marker(task.start, 'stallplan-walls-start');
  } else if (task.type === 'walls') {
    const pts = stallplanWallsPoints(task, plan);
    if (pts.length > 1) {
      g.appendChild(svgEl('polyline', { points: pointsAttr(pts), class: 'stallplan-walls-line' }));
      g.appendChild(svgEl('line', { x1: pts[pts.length - 1].x, y1: pts[pts.length - 1].y, x2: task.start.x, y2: task.start.y, class: 'stallplan-walls-closing' }));
      task.segments.forEach((seg, i) => wallLabel(pts[i], pts[i + 1], seg.lengthM));
    }
    marker(task.start, 'stallplan-walls-start');
    if (pts.length > 1) marker(pts[pts.length - 1], 'stallplan-walls-end');
  } else if (task.type === 'split') {
    const b = task.bounds;
    g.appendChild(svgEl('polygon', { points: pointsAttr([{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }]), class: 'stallplan-walls-line' }));
    const result = parseStallplanSplitWidths(stallplanSplitTotalM(plan, task));
    if (result.widths) {
      stallplanSplitRects(plan, task, result.widths).slice(0, -1).forEach(r => {
        const [a, b2] = task.dir === 'x' ? [r[1], r[2]] : [r[3], r[2]];
        g.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b2.x, y2: b2.y, class: 'stallplan-walls-closing' }));
      });
    }
  }
}

function stallplanTaskPoints(plan) {
  const task = stallplanerTask;
  if (!task) return [];
  if (task.type === 'walls') return stallplanWallsPoints(task, plan);
  if (task.type === 'rect') {
    const { lengthM, widthM } = readStallplanRectInputs();
    return lengthM > 0 && widthM > 0 ? stallplanRectFromStart(plan, task.start, lengthM, widthM, task.target) : [task.start];
  }
  return [];
}

// ---- Auswahl: Antippen ohne Werkzeug zeigt Details ----
function selectStallplanItem(kind, id) {
  stallplanerSelection = kind ? { kind, id: id || null } : null;
  renderStallplan();
  if (!kind || (kind === 'compartment' && isWideStallplanerLayout())) {
    // Breite Ansicht: Abteile stehen ohnehin in der Seitenleiste — dort
    // hervorheben statt dieselbe Karte ein zweites Mal im Sheet zu zeigen.
    if (stallplanerSheetPanel === 'stallplaner-panel-selection') hideStallplanerSheet();
    renderStallplanerSidebar();
    const card = kind && document.querySelector(`#stallplaner-abteile-list .stallplan-abteil-row[data-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  renderStallplanSelectionPanel();
}

function renderStallplanSelectionPanel() {
  const plan = activeStallplan();
  const sel = stallplanerSelection;
  const panel = document.getElementById('stallplaner-panel-selection');
  if (!plan || !sel) return;
  let title = '';
  if (sel.kind === 'compartment') {
    const c = plan.compartments.find(x => x.id === sel.id);
    if (!c) { cancelStallplanerSheet(); return; }
    title = c.name;
    renderStallplanAbteilCards(panel, plan, [c]);
  } else if (sel.kind === 'outline') {
    if (!plan.outline) { cancelStallplanerSheet(); return; }
    title = 'Stall-Umriss';
    const pts = plan.outline.points;
    const area = shoelaceArea(pts) * plan.gridScale * plan.gridScale;
    const walls = pts.map((p, i) => formatStallplanMeters(Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y) * plan.gridScale)).join(' · ');
    panel.innerHTML = `
      <p class="stallplaner-panel-hint"><strong>${area.toFixed(1).replace('.', ',')} m²</strong> — Wände: ${escapeHtml(walls)} m</p>
      <div class="stallplaner-panel-actions">
        <button type="button" class="stallplaner-panel-btn" data-sel-act="measure"><span class="material-symbols-rounded icon">straighten</span> Maße</button>
        ${axisAlignedRectBounds(pts) ? '<button type="button" class="stallplaner-panel-btn" data-sel-act="split"><span class="material-symbols-rounded icon">view_week</span> Teilen</button>' : ''}
        <button type="button" class="stallplaner-panel-btn" data-sel-act="delete"><span class="material-symbols-rounded icon">delete</span> Löschen</button>
      </div>`;
    panel.querySelectorAll('[data-sel-act]').forEach(btn => btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-sel-act');
      if (act === 'measure') { resetStallplanerInteraction(); stallplanerMode = 'measure'; startStallplanMeasureWalk('outline', null, plan.outline.points); }
      else if (act === 'split') openStallplanSplitPanel({ kind: 'outline' });
      else if (act === 'delete' && confirm('Umriss wirklich löschen?')) {
        pushStallplanerUndo();
        plan.outline = null;
        resetStallplanerInteraction();
        stallplanerStep = 'umriss';
        renderStallplan();
        renderStallplanerSidebar();
      }
    }));
  } else if (sel.kind === 'equipment') {
    const item = plan.equipment.find(x => x.id === sel.id);
    if (!item) { cancelStallplanerSheet(); return; }
    title = STALLPLANER_EQUIP_LABELS[item.type] || 'Ausstattung';
    const form = { point: 'Punkt', line: 'Linie', area: 'Fläche' }[item.geometryKind] || '';
    panel.innerHTML = `
      <p class="stallplaner-panel-hint">${escapeHtml(form)} — zum Verschieben „Bearbeiten" wählen und ziehen.</p>
      <div class="stallplaner-panel-actions">
        <button type="button" class="stallplaner-panel-btn" data-sel-act="delete"><span class="material-symbols-rounded icon">delete</span> Löschen</button>
      </div>`;
    panel.querySelector('[data-sel-act="delete"]').addEventListener('click', () => {
      pushStallplanerUndo();
      plan.equipment = plan.equipment.filter(x => x.id !== item.id);
      resetStallplanerInteraction();
      renderStallplan();
      renderStallplanerSidebar();
    });
  }
  if (stallplanerSheetPanel !== 'stallplaner-panel-selection') openStallplanerSheet('stallplaner-panel-selection', title);
  else document.getElementById('stallplaner-sheet-title').textContent = title;
}

function openStallplanerAnimalsPanel() {
  renderStallplanAnimalsPanel();
  openStallplanerSheet('stallplaner-panel-animals', 'Tiere je Abteil');
}
function renderStallplanAnimalsPanel() {
  const plan = activeStallplan();
  if (!plan) return;
  document.getElementById('stallplaner-sheet-tierart').value = plan.tierart || '';
  const list = document.getElementById('stallplaner-animals-list');
  if (!plan.compartments.length) {
    list.innerHTML = '<p class="stallplaner-panel-hint">Noch keine Abteile — erst in Schritt 2 anlegen.</p>';
    return;
  }
  renderStallplanAbteilCards(list, plan, plan.compartments);
}
document.getElementById('stallplaner-sheet-tierart').addEventListener('change', (e) => {
  setStallplanTierart(e.target.value || null);
});

// ---- Bildschirm anlassen, solange der Stallplaner offen ist ----
// Wake Lock API: sonst geht das Display beim Messen mit dem Zollstock aus.
async function requestStallplanerWakeLock() {
  try {
    if (!('wakeLock' in navigator) || stallplanerWakeLock || document.visibilityState !== 'visible') return;
    stallplanerWakeLock = await navigator.wakeLock.request('screen');
    stallplanerWakeLock.addEventListener('release', () => { stallplanerWakeLock = null; });
  } catch {
    stallplanerWakeLock = null;
  }
}
function releaseStallplanerWakeLock() {
  if (!stallplanerWakeLock) return;
  stallplanerWakeLock.release().catch(() => {});
  stallplanerWakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !document.getElementById('stallplaner-view').hidden) requestStallplanerWakeLock();
});

// ---- Sidebar + Abteil-Karten ----
function renderStallplanerPlanPicker() {
  const select = document.getElementById('stallplaner-plan-select');
  select.innerHTML = stallplaene.map(p => `<option value="${p.id}"${p.id === activeStallplanId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  document.getElementById('stallplaner-empty-hint').hidden = stallplaene.length > 0;
  document.getElementById('stallplaner-settings').hidden = !activeStallplanId;
}

// Eine Abteil-Karte (Name, Fläche, Tierbestand, Öko-VO-Ampel, Aktionen) —
// dieselbe Quelle für Seitenleiste, Auswahl-Sheet und Tiere-Sheet, damit
// alle drei immer gleich aussehen und sich gleich verhalten. Ein Abteil
// kann mehrere Tier-Kategorien gleichzeitig beherbergen (z.B. Kälber +
// Milchkühe im selben Abteil) — daher eine verschachtelte Liste von
// Kategorie-Zeilen je Abteil statt nur eines einzelnen Kategorie-Felds.
function stallplanAbteilCardHtml(plan, c) {
  const kategorien = OEKO_VO_KATEGORIEN.filter(k => k.tierart === plan.tierart);
  const area = shoelaceArea(c.points) * plan.gridScale * plan.gridScale;
  const benoetigt = c.tierbestand.length ? compartmentBenoetigteFlaeche(c) : null;
  const badge = benoetigt == null ? ''
    : area >= benoetigt
      ? `<span class="stallplan-badge ok">✓ ${(area - benoetigt).toFixed(1)} m² Reserve</span>`
      : `<span class="stallplan-badge fail">✗ ${(benoetigt - area).toFixed(1)} m² fehlend</span>`;
  const tbRows = c.tierbestand.map(tb => {
    const kategorie = OEKO_VO_KATEGORIEN.find(k => k.id === tb.kategorieId);
    const showWeight = kategorie && kategorie.indoorKgJeQm != null;
    return `
      <div class="stallplan-tb-row">
        <select class="stallplan-tb-kategorie" data-c="${c.id}" data-tb="${tb.id}"${plan.tierart ? '' : ' disabled'}>
          <option value="">– Kategorie –</option>
          ${kategorien.map(k => `<option value="${k.id}"${k.id === tb.kategorieId ? ' selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}
        </select>
        <input type="number" inputmode="numeric" min="0" class="stallplan-tb-anzahl" data-c="${c.id}" data-tb="${tb.id}" value="${tb.tieranzahl || 0}" placeholder="Tierzahl" aria-label="Tierzahl">
        ${showWeight ? `<input type="text" inputmode="decimal" class="stallplan-tb-gewicht" data-c="${c.id}" data-tb="${tb.id}" value="${tb.avgGewichtKg ? String(tb.avgGewichtKg).replace('.', ',') : ''}" placeholder="Ø-Gewicht kg" aria-label="Durchschnittsgewicht in kg">` : ''}
        <button type="button" class="stallplan-tb-remove" data-c="${c.id}" data-tb="${tb.id}" title="Kategorie entfernen"><span class="material-symbols-rounded icon">close</span></button>
      </div>`;
  }).join('');
  const selected = stallplanerSelection && stallplanerSelection.kind === 'compartment' && stallplanerSelection.id === c.id;
  return `
    <div class="stallplan-abteil-row${selected ? ' selected' : ''}" data-id="${c.id}">
      <input type="text" class="stallplan-abteil-name" data-id="${c.id}" value="${escapeHtml(c.name)}" aria-label="Name des Abteils">
      <span class="stallplan-abteil-area">${area.toFixed(1)} m²</span>
      <div class="stallplan-tierbestand-list">${tbRows}</div>
      <button type="button" class="stallplan-tb-add" data-c="${c.id}"${plan.tierart ? '' : ' disabled title="Erst die Tierart wählen"'}>+ Kategorie</button>
      ${badge}
      <div class="stallplan-abteil-actions">
        <button type="button" class="stallplan-abteil-act" data-card-act="measure" data-id="${c.id}"><span class="material-symbols-rounded icon">straighten</span> Maße</button>
        ${axisAlignedRectBounds(c.points) ? `<button type="button" class="stallplan-abteil-act" data-card-act="split" data-id="${c.id}"><span class="material-symbols-rounded icon">view_week</span> Teilen</button>` : ''}
        <button type="button" class="stallplan-abteil-act stallplan-abteil-remove" data-id="${c.id}" title="Abteil löschen"><span class="material-symbols-rounded icon">delete</span> Löschen</button>
      </div>
    </div>`;
}

// Nach jeder Änderung an einer Karte alle Stellen neu zeichnen, an denen
// Abteil-Daten sichtbar sind (Plan, Seitenleiste, offenes Sheet).
function refreshStallplanAfterCardChange() {
  renderStallplan();
  renderStallplanerSidebar();
}

function renderStallplanAbteilCards(container, plan, compartments) {
  container.innerHTML = compartments.map(c => stallplanAbteilCardHtml(plan, c)).join('');
  const findC = (el) => plan.compartments.find(x => x.id === (el.getAttribute('data-c') || el.getAttribute('data-id')));
  const findTb = (el) => { const c = findC(el); return c && c.tierbestand.find(x => x.id === el.getAttribute('data-tb')); };
  container.querySelectorAll('.stallplan-abteil-name').forEach(input => input.addEventListener('change', () => {
    const c = findC(input);
    if (!c) return;
    pushStallplanerUndo();
    c.name = input.value.trim() || c.name;
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('.stallplan-tb-add').forEach(btn => btn.addEventListener('click', () => {
    const c = findC(btn);
    if (!c) return;
    pushStallplanerUndo();
    c.tierbestand.push(newTierbestandEntry());
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('.stallplan-tb-remove').forEach(btn => btn.addEventListener('click', () => {
    const c = findC(btn);
    if (!c) return;
    pushStallplanerUndo();
    c.tierbestand = c.tierbestand.filter(tb => tb.id !== btn.getAttribute('data-tb'));
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('.stallplan-tb-kategorie').forEach(sel => sel.addEventListener('change', () => {
    const tb = findTb(sel);
    if (!tb) return;
    pushStallplanerUndo();
    tb.kategorieId = sel.value || null;
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('.stallplan-tb-anzahl').forEach(input => input.addEventListener('change', () => {
    const tb = findTb(input);
    if (!tb) return;
    pushStallplanerUndo();
    tb.tieranzahl = Math.max(0, parseInt(input.value, 10) || 0);
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('.stallplan-tb-gewicht').forEach(input => input.addEventListener('change', () => {
    const tb = findTb(input);
    if (!tb) return;
    pushStallplanerUndo();
    const kg = parseDecimalInput(input.value);
    tb.avgGewichtKg = kg > 0 ? kg : null;
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('.stallplan-abteil-remove').forEach(btn => btn.addEventListener('click', () => {
    const c = findC(btn);
    if (!c) return;
    if (c.tierbestand.length && !confirm(`„${c.name}" mit eingetragenen Tieren löschen?`)) return;
    pushStallplanerUndo();
    plan.compartments = plan.compartments.filter(x => x.id !== c.id);
    if (stallplanerSelection && stallplanerSelection.id === c.id) {
      stallplanerSelection = null;
      if (stallplanerSheetPanel === 'stallplaner-panel-selection') hideStallplanerSheet();
    }
    refreshStallplanAfterCardChange();
  }));
  container.querySelectorAll('[data-card-act]').forEach(btn => btn.addEventListener('click', () => {
    const c = findC(btn);
    if (!c) return;
    if (btn.getAttribute('data-card-act') === 'measure') {
      resetStallplanerInteraction();
      stallplanerMode = 'measure';
      startStallplanMeasureWalk('compartment', c.id, c.points);
    } else {
      openStallplanSplitPanel({ kind: 'compartment', id: c.id });
    }
  }));
}

function renderStallplanerSidebar() {
  renderStallplanerPlanPicker();
  const plan = activeStallplan();
  if (!plan) { renderStallplanerChrome(); return; }
  document.getElementById('stallplaner-name-input').value = plan.name;
  document.getElementById('stallplaner-tierart-select').value = plan.tierart || '';
  document.getElementById('stallplaner-grid-scale').value = String(plan.gridScale);
  document.getElementById('stallplaner-grid-snap').checked = plan.gridSnap;

  const abteileArea = plan.compartments.reduce((s, c) => s + shoelaceArea(c.points) * plan.gridScale * plan.gridScale, 0);
  const outlineArea = plan.outline ? shoelaceArea(plan.outline.points) * plan.gridScale * plan.gridScale : 0;
  document.getElementById('stallplaner-total-area').textContent = plan.outline
    ? `— Umriss ${outlineArea.toFixed(1)} m², Abteile gesamt ${abteileArea.toFixed(1)} m²`
    : '';

  document.getElementById('stallplaner-abteile-empty-hint').hidden = plan.compartments.length > 0;
  renderStallplanAbteilCards(document.getElementById('stallplaner-abteile-list'), plan, plan.compartments);

  // Offene Sheets mit Abteil-Daten gleich mitaktualisieren.
  if (stallplanerSheetPanel === 'stallplaner-panel-animals') renderStallplanAnimalsPanel();
  else if (stallplanerSheetPanel === 'stallplaner-panel-selection') renderStallplanSelectionPanel();
  renderStallplanerChrome();
}

function setStallplanTierart(tierart) {
  const plan = activeStallplan();
  if (!plan) return;
  pushStallplanerUndo();
  plan.tierart = tierart;
  // Kategorie-Zuordnungen gehören zur alten Tierart — ungültig geworden,
  // zurückgesetzt statt als unsichtbare Karteileiche zu behalten.
  plan.compartments.forEach(c => { c.tierbestand.forEach(tb => { tb.kategorieId = null; }); });
  refreshStallplanAfterCardChange();
}

// ---- Plan-Verwaltung ----
function setActiveStallplan(id) {
  resetStallplanerInteraction();
  activeStallplanId = id;
  stallplanerUndoStack = [];
  stallplanerRedoStack = [];
  const plan = activeStallplan();
  stallplanerStep = plan && plan.outline ? 'abteile' : 'umriss';
  resetStallplanerViewBox();
  if (plan) fitStallplanerView();
  renderStallplan();
  renderStallplanerSidebar();
}
document.getElementById('stallplaner-new-plan').addEventListener('click', () => {
  const plan = createEmptyStallplan(`Stallplan ${stallplaene.length + 1}`);
  stallplaene.push(plan);
  setActiveStallplan(plan.id);
});
document.getElementById('stallplaner-plan-select').addEventListener('change', (e) => setActiveStallplan(e.target.value));
document.getElementById('stallplaner-name-input').addEventListener('change', (e) => {
  const plan = activeStallplan();
  if (!plan) return;
  plan.name = e.target.value.trim() || plan.name;
  renderStallplanerPlanPicker();
});
document.getElementById('stallplaner-tierart-select').addEventListener('change', (e) => {
  setStallplanTierart(e.target.value || null);
});
document.getElementById('stallplaner-grid-scale').addEventListener('change', (e) => {
  const plan = activeStallplan();
  if (!plan) return;
  plan.gridScale = parseFloat(e.target.value) || 1;
  renderStallplan();
  renderStallplanerSidebar();
});
document.getElementById('stallplaner-grid-snap').addEventListener('change', (e) => {
  const plan = activeStallplan();
  if (plan) plan.gridSnap = e.target.checked;
});
document.getElementById('btn-stallplaner-delete-plan').addEventListener('click', () => {
  const plan = activeStallplan();
  if (!plan) return;
  if (!confirm(`Stallplan "${plan.name}" wirklich löschen?`)) return;
  stallplaene = stallplaene.filter(p => p.id !== plan.id);
  setActiveStallplan(stallplaene.length ? stallplaene[0].id : null);
});

// ---- Datei-Export/-Import (.json, editierbares Format zusätzlich zum
// automatischen Cloud-Sync über serializeWorkspace/restoreWorkspace) ----
document.getElementById('btn-stallplaner-export-json').addEventListener('click', () => {
  const plan = activeStallplan();
  if (!plan) return;
  downloadBlob(JSON.stringify(plan, null, 2), zuordnungFileName(plan.name || 'Stallplan', 'json') || `stallplan_${plan.id}.json`, 'application/json');
  document.getElementById('stallplaner-status').textContent = 'Als Datei gespeichert.';
});
document.getElementById('stallplaner-import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const statusEl = document.getElementById('stallplaner-status');
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.compartments) || !Array.isArray(data.equipment)) {
      throw new Error('Datei enthält keinen gültigen Stallplan.');
    }
    data.id = newStallplanId(); // Kollision mit vorhandener Id vermeiden
    data.compartments = data.compartments.map(normalizeCompartment);
    data.equipment = data.equipment.map(normalizeEquipment);
    stallplaene.push(data);
    setActiveStallplan(data.id);
    statusEl.textContent = 'Stallplan geladen.';
  } catch (err) {
    statusEl.textContent = 'Fehler: ' + (err.message || 'Datei konnte nicht geladen werden.');
  }
});

// ---- PDF-Export (Seite 1: Plan, Seite 2: Abteilgrößen-Tabelle) ----
async function exportStallplanPDF() {
  const plan = activeStallplan();
  const statusEl = document.getElementById('stallplaner-status');
  if (!plan) return;
  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
    statusEl.textContent = 'PDF-Export nicht verfügbar (Bibliothek konnte nicht geladen werden).';
    return;
  }
  if (!plan.outline) { stallplanerFlash('Noch kein Umriss angelegt — erst Schritt 1.'); return; }

  const btn = document.getElementById('btn-export-stallplaner-pdf');
  btn.disabled = true;
  stallplanerFlash('PDF wird erstellt …');
  try {
    // Vertex-Griffe/Zeichenvorschau würden sonst mit ins Screenshot-Bild
    // rutschen (gleiches Problem wie bei Hofplans Kartenscreenshot,
    // captureHofplanScreenshot) — vor dem Capture ausgeblendet.
    const wrap = document.getElementById('stallplaner-canvas');
    wrap.classList.add('stallplaner-exporting');
    let canvas;
    try {
      canvas = await html2canvas(wrap, { backgroundColor: '#ffffff', logging: false });
    } finally {
      wrap.classList.remove('stallplaner-exporting');
    }

    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    const margin = 12;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(`Stallplan – ${plan.name}`, margin, margin + 4);
    const imageTop = margin + 10;
    const maxW = pageW - margin * 2, maxH = pageH - imageTop - margin;
    const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
    const imgW = canvas.width * scale, imgH = canvas.height * scale;
    doc.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', (pageW - imgW) / 2, imageTop, imgW, imgH);

    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(`${plan.name} – Abteilgrößen`, margin, margin + 4);
    const rows = plan.compartments.map(c => {
      const area = shoelaceArea(c.points) * plan.gridScale * plan.gridScale;
      // Mehrere Kategorien je Abteil möglich — Kategorie-Spalte listet alle
      // mit ihrer jeweiligen Tierzahl auf, Tierzahl-Spalte zeigt die Summe.
      const kategorieText = c.tierbestand.length
        ? c.tierbestand.map(tb => {
            const k = OEKO_VO_KATEGORIEN.find(x => x.id === tb.kategorieId);
            return k ? `${k.label} (${tb.tieranzahl || 0})` : null;
          }).filter(Boolean).join(', ') || '–'
        : '–';
      const gesamtTierzahl = c.tierbestand.reduce((s, tb) => s + (tb.tieranzahl || 0), 0);
      const benoetigt = c.tierbestand.length ? compartmentBenoetigteFlaeche(c) : null;
      const status = benoetigt == null ? '–' : (area >= benoetigt ? 'OK' : 'zu klein');
      return [c.name, kategorieText, String(gesamtTierzahl), area.toFixed(1), benoetigt == null ? '–' : benoetigt.toFixed(1), status];
    });
    doc.autoTable({
      startY: margin + 10,
      head: [['Abteil', 'Kategorie', 'Tierzahl', 'Fläche (m²)', 'Benötigt (m²)', 'Öko-VO']],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 184, 175] },
      margin: { left: margin, right: margin }
    });
    doc.setFontSize(8);
    doc.text(
      'Flächenwerte laut Anhang I VO (EU) 2018/848 i.d.F. DVO (EU) 2020/464 — keine Rechtsberatung, im Zweifel Originaltext prüfen.',
      margin, doc.internal.pageSize.getHeight() - 6
    );

    stampFeldFolioLogo(doc, await getFeldFolioLogoDataUrl());
    doc.save(zuordnungFileName(plan.name || 'Stallplan', 'pdf') || `stallplan_${plan.id}.pdf`);
    stallplanerFlash('Als PDF gespeichert.');
  } catch (err) {
    stallplanerFlash('Fehler beim PDF-Export: ' + (err.message || ''));
  } finally {
    btn.disabled = false;
  }
}
document.getElementById('btn-export-stallplaner-pdf').addEventListener('click', exportStallplanPDF);

function initStallplaner() {
  if (stallplanerInitDone) return;
  stallplanerInitDone = true;
  applyStallplanerViewBox();
  renderStallplanGrid();
  renderStallplanerSidebar();
}

// Dev-only Testhaken (analog window.__ffTestMap/__ffTestTk) — rohes
// SVG-Pointer-Drag ist laut AGENTS.md Punkt 2 genauso wenig zuverlässig per
// synthetischem Maus-Event simulierbar wie Leaflet.draw.
if (import.meta.env.DEV) {
  window.__ffTestStallplaner = {
    createPlan(overrides = {}) {
      const plan = { ...createEmptyStallplan(overrides.name), ...overrides };
      stallplaene.push(plan);
      setActiveStallplan(plan.id);
      return plan.id;
    },
    getActivePlan() { return activeStallplan(); },
    // Direkter Zugriff auf die reine Rekonstruktions-Mathematik, ohne den
    // UI-Ablauf des geführten Vermessen-Modus durchzuspielen — für einen
    // gezielten Test der Geometrie (rechtwinklige Ecken, Schlussfehler-
    // Ausgleich).
    reconstructRectilinear(points, lengths) { return reconstructPolygonFromSketch(points, lengths); },
    // Rundlauf-Test für die Workspace-Persistenz (serializeWorkspace/
    // restoreWorkspace sind modul-intern, nicht auf window) — ruft exakt
    // dieselben Funktionen auf, die auch beim echten Cloud-Speichern/Laden
    // laufen.
    serializeStallplaene() { return serializeWorkspace().stallplaene; },
    restoreStallplaene(data) { restoreWorkspace({ stallplaene: data }); },
    setOutline(points) {
      const plan = activeStallplan();
      if (!plan) return;
      pushStallplanerUndo();
      plan.outline = { points };
      renderStallplan();
      renderStallplanerSidebar();
    },
    addCompartment(points, overrides = {}) {
      const plan = activeStallplan();
      if (!plan) return null;
      pushStallplanerUndo();
      const c = {
        id: 'abteil-' + Date.now() + Math.random().toString(36).slice(2),
        name: `Abteil ${plan.compartments.length + 1}`,
        points, tierbestand: [], ...overrides
      };
      plan.compartments.push(c);
      renderStallplan();
      renderStallplanerSidebar();
      return c.id;
    },
    addEquipment(type, x, y) {
      const plan = activeStallplan();
      if (!plan) return null;
      pushStallplanerUndo();
      const item = { id: 'eq-' + Date.now() + Math.random().toString(36).slice(2), type, geometryKind: 'point', points: [{ x, y }], rotationDeg: 0, label: '' };
      plan.equipment.push(item);
      renderStallplan();
      renderStallplanerSidebar();
      return item.id;
    },
    // Für Linien-/Flächen-Ausstattung (Sitzstange, Tür/Fenster, Futtergang, …).
    addEquipmentShape(type, geometryKind, points) {
      const plan = activeStallplan();
      if (!plan) return null;
      pushStallplanerUndo();
      const item = { id: 'eq-' + Date.now() + Math.random().toString(36).slice(2), type, geometryKind, points, rotationDeg: 0, label: '' };
      plan.equipment.push(item);
      renderStallplan();
      renderStallplanerSidebar();
      return item.id;
    },
    setVertex(kind, ownerId, index, x, y) {
      const plan = activeStallplan();
      if (!plan) return;
      pushStallplanerUndo();
      stallplanPointsFor(plan, kind, ownerId)[index] = { x, y };
      renderStallplan();
      renderStallplanerSidebar();
    }
  };
}

// ---------- FeldFolio Plus: Probenahmeprotokoll (Terminkalender-Anhänge) ----------
// Füllt das amtliche Probenahmeprotokoll (FB.09.06.01 V7) je Termin aus und
// exportiert es unverändert im Originallayout als PDF — public/
// probenahmeprotokoll-vorlage.pdf wird zur Laufzeit über pdf-lib geladen und
// ihre echten AcroForm-Felder befüllt (siehe exportProbenprotokollPdf), statt
// wie die übrigen Exporte dieser App das Layout mit jsPDF nachzubauen.
// Feldnamen/-typen/-koordinaten wurden per Node/pdf-lib aus der Originaldatei
// ausgelesen — exakte Übernahme inkl. vorhandener Tippfehler/Doppel-
// Leerzeichen im Original nötig, sonst schlägt form.getField(name) beim
// Export fehl.
//
// Protokolle gehören zu einem konkreten Termin (ev.probenprotokolle, analog
// ev.attachments) statt zu einem Betrieb-Workspace — ein Termin kennt Kunde/
// Adresse/Kundennummer bereits selbst, eine globale Betrieb-Zuordnung ist
// dafür nicht nötig. Bedienung läuft komplett aus dem Terminkalender-
// Detailpanel heraus (renderTerminkalenderDetail, siehe dort): eine Liste
// direkt unter "Fotos & Dateien", "Neues Protokoll" öffnet das große
// Formular als Modal-Overlay. Der fertige Export wird NICHT heruntergeladen,
// sondern über uploadTerminkalenderAttachment() direkt als Anhang bei
// "Fotos & Dateien" desselben Termins gespeichert — exakt das bestehende
// Verhalten des Dokumentenscanners (buildPdfFromScanPages weiter unten).
//
// Seit dem Cross-Check-Formular (FB.09.06.10) ist das Ganze ein kleines
// Formular-System: TK_FORMULARE (weiter unten) beschreibt je Formular
// Vorlage, Felder, Unterschriften und Listen-Texte; Modal, Pflichtfeld-
// Prüfung, Unterschriften, Anlagen und Export sind für alle Formulare
// dieselben Funktionen. activeProbenprotokollKind sagt, welches gerade offen
// ist (Namen der Funktionen/IDs stammen noch aus der Zeit mit nur einem
// Formular und wurden bewusst beibehalten).
const PROBENEHMER_NAME_STORAGE_KEY = 'feldfolio-probenehmer-name';
let activeProbenprotokollKind = 'probenprotokoll';
let activeProbenprotokollEventId = null;
let activeProbenprotokollId = null;

// Treibt sowohl das Formular-Rendering als auch den PDF-Export — beide
// verwenden dieselbe Quelle, damit Feldnamen nie auseinanderlaufen können.
const PROBENPROTOKOLL_SECTIONS = [
  {
    title: 'Kopfdaten',
    fields: [
      { name: 'Nr Analysenproben', label: 'Nr. Analyseproben', type: 'text', required: true, scan: true },
      { name: 'Nr der Gegenproben', label: 'Nr. Gegenproben', type: 'text', scan: true },
      { name: 'Name des Unternehmens', label: 'Name des Unternehmens', type: 'text', required: true },
      { name: 'Straße Hausnummer', label: 'Straße, Hausnummer', type: 'text', required: true },
      { name: 'PLZ  Ort', label: 'PLZ, Ort', type: 'text', required: true },
      { name: 'Kundennummer', label: 'Kundennummer', type: 'text', required: true },
      { name: 'Bundesland', label: 'Bundesland', type: 'text', required: true }
    ]
  },
  {
    title: 'Beprobtes Produkt',
    fields: [
      { name: 'Probe', label: 'Beprobtes Produkt', type: 'text' },
      { name: 'Group10', label: 'Herkunft', type: 'radio', options: [
        { value: 'Auswahl1', label: 'Eigene Produktion' },
        { value: 'Auswahl 2', label: 'Zukaufs- und Handelsware' }
      ] }
    ]
  },
  {
    title: 'Zukaufs- und Handelsware',
    fields: [
      { name: 'Lieferant', label: 'Lieferant', type: 'text' },
      { name: 'Lieferdatum', label: 'Lieferdatum', type: 'text' },
      { name: 'Liefermenge', label: 'Liefermenge', type: 'text' },
      { name: 'Lagermenge Lieferung', label: 'Davon noch lagernd am Betrieb', type: 'text' }
    ]
  },
  {
    title: 'Eigene Produktion',
    fields: [
      { name: 'Produktionsmenge', label: 'Datum Produktion/Ernte/Abfüllung', type: 'text' },
      { name: 'Charge', label: 'Chargennummer/MHD', type: 'text' },
      { name: 'Menge', label: 'Menge der Charge/Ernte', type: 'text' },
      { name: 'Lagermenge', label: 'Davon noch lagernd am Betrieb', type: 'text' }
    ]
  },
  {
    title: 'Probenahmeort',
    fields: [
      { name: 'Probeort1', label: 'Lagerbezeichnung', type: 'checkbox', textField: 'Ort Lager' },
      { name: 'Probeort2', label: 'Produktionsstätte', type: 'checkbox', textField: 'Ort Produktion' },
      { name: 'Probeort3', label: 'Feldstücksname', type: 'checkbox', textField: 'Feldstück' },
      { name: 'Probeort4', label: 'Bienenstandorte', type: 'checkbox', textField: 'Ort Bienen' },
      { name: 'Probeort5', label: 'Sonstiges', type: 'checkbox', textField: 'sonstiger Ort' }
    ]
  },
  {
    title: 'Probenahme',
    fields: [
      { name: 'DatumZeitpunkt und Ort der Probenahme', label: 'Datum', type: 'text', required: true },
      { name: 'UhrzeitZeitpunkt und Ort der Probenahme', label: 'Uhrzeit', type: 'text', required: true },
      { name: 'Probenmenge', label: 'Probenmenge', type: 'text' },
      { name: 'Analyse (Wirkstoff)', label: 'Ggf. zu analysierender Wirkstoff', type: 'text' }
    ]
  },
  {
    title: 'Grund der Probenahme',
    fields: [
      { name: 'Group9', label: 'Grund', type: 'radio', options: [
        { value: 'Auswahl1', label: 'Routine' },
        { value: 'Auswahl2', label: 'Verdacht' },
        { value: 'Auswahl3', label: 'Sonstiges' }
      ] },
      { name: 'Grund sonst', label: 'Sonstiges — Erläuterung', type: 'text' },
      { name: 'Abdift', label: 'Bei Abdrift', type: 'checkbox' }
    ]
  },
  {
    title: 'Anlagen',
    fields: [
      { name: 'Anlage1', label: 'Rezeptur/Mischprotokoll', type: 'checkbox' },
      { name: 'Anlage2', label: 'Etikett/Foto der Charge', type: 'checkbox' },
      { name: 'Anlage3', label: 'Zukaufsbeleg', type: 'checkbox' },
      { name: 'Anlage4', label: 'Flurkarte/Skizze', type: 'checkbox' },
      { name: 'Anlage5', label: 'Sonstiges', type: 'checkbox', textField: 'Anlage sonst' }
    ]
  },
  {
    title: 'Anmerkungen',
    fields: [
      { name: 'Erläuterung zur Probenahme Flurstücksname u nummer bzw Gebäudebezeichnung LagerChargennummer', label: 'Anmerkungen zur Probenahme', type: 'textarea' }
    ]
  },
  {
    title: 'Bestätigungen',
    hint: 'Die drei Erklärungen des Betriebsleiters sind Pflicht — außer „Die Annahme und Verwahrung wurde abgelehnt“ ist angekreuzt.',
    fields: [
      { name: 'Probenehmer Name', label: 'Name Probenehmer', type: 'text', required: true },
      { name: 'Der Beauftragung eines akkreditierten Labors als Unterauftragnehmer der Kontrollstelle wird zugestimmt', label: 'Der Beauftragung eines akkreditierten Labors als Unterauftragnehmer der Kontrollstelle wird zugestimmt', type: 'checkbox', requiredUnless: 'Die Annahme und Verwahrung wurde abgelehnt', shortLabel: 'Zustimmung zur Laborbeauftragung' },
      { name: 'Über die Bedeutung der Gegenprobe und Lagerung der Gegenproben wurde ich informiert', label: 'Über die Bedeutung der Gegenprobe und Lagerung der Gegenproben wurde ich informiert', type: 'checkbox', requiredUnless: 'Die Annahme und Verwahrung wurde abgelehnt', shortLabel: 'Information über die Gegenprobe' },
      { name: 'Die Annahme und Verwahrung wurde abgelehnt', label: 'Die Annahme und Verwahrung wurde abgelehnt', type: 'checkbox' },
      { name: 'Die genannten Angaben werden bestätigt', label: 'Die genannten Angaben werden bestätigt', type: 'checkbox', requiredUnless: 'Die Annahme und Verwahrung wurde abgelehnt', shortLabel: 'Bestätigung der Angaben' },
      { name: 'Text1', label: 'Ort, Datum', type: 'text' }
    ]
  }
];

// Flache Sicht auf alle Feldnamen (inkl. der an eine Checkbox gekoppelten
// Text-Felder wie "Ort Lager") — Grundlage für Vorbefüllung, Werte-Objekt-
// Initialisierung und den PDF-Export-Durchlauf.
function formularAllFields(sections) {
  const out = [];
  sections.forEach(sec => sec.fields.forEach(f => {
    out.push({ name: f.name, type: f.type, options: f.options, dependsOn: f.dependsOn });
    if (f.textField) out.push({ name: f.textField, type: 'text', dependsOn: f.dependsOn });
  }));
  return out;
}
const PROBENPROTOKOLL_ALL_FIELDS = formularAllFields(PROBENPROTOKOLL_SECTIONS);

// Beide Unterschriften werden als PNG (Canvas-Signaturpad) direkt auf die
// Seite gezeichnet — die Vorlage enthält bewusst KEIN Signaturfeld mehr (das
// ursprüngliche "Signaturfeld 1" war eine kryptographische PDF-Signatur und
// wurde beim Bereinigen der Vorlage entfernt). Koordinaten per pdf.js aus den
// Beschriftungen der Vorlage gemessen: "Unterschrift des Probenehmers" endet
// bei x≈373 (Zeile y≈148–178), "Unterschrift des Betriebsinhabers …" steht
// bei y≈42 unter der Linie, die Unterschrift gehört darüber.
const PROBENPROTOKOLL_SIGNATURE_BOXES = {
  signatureProbenehmer: { x: 380, y: 148, width: 175, height: 30 },
  signatureBetriebsinhaber: { x: 240, y: 54, width: 220, height: 34 }
};

// ---------- Cross Check (FB.09.06.10, Anfrage an eine andere Kontrollstelle) ----------
// public/crosscheck-vorlage.pdf ist das Originalformular V07 unverändert
// (enthält keine Vorbelegung/Unterschrift). Feldnamen per Node/pdf-lib
// ausgelesen; Radio-Werte je Kästchen über die /AP-Schlüssel der Widgets
// zugeordnet (Group1: Auswahl1 = Empfänger, Auswahl2 = Lieferant; Group2:
// Auswahl1 = Lieferantenprüfung, Auswahl2 = Empfängerprüfung; Group3:
// Auswahl1 = zeitnahe Beleg-Prüfung, Auswahl2 = Routineprüfung).
// "Bearbeitungsnummer" und "Ergebnis der Prüfung" füllt die angefragte
// Kontrollstelle aus — dafür gibt es bewusst keine Eingaben.
const CROSSCHECK_EMPFAENGERPRUEFUNG = { field: 'Group2', value: 'Auswahl2' };
const CROSSCHECK_SECTIONS = [
  {
    title: 'Anfrage an die Kontrollstelle',
    fields: [
      { name: 'Kontrollstelle', label: 'Kontrollstelle', type: 'text', required: true },
      { name: 'Codenummer', label: 'Codenummer (z. B. DE-ÖKO-006)', shortLabel: 'Codenummer', type: 'text', required: true }
    ]
  },
  {
    title: 'ÖkoP-kontrolliertes Unternehmen',
    fields: [
      { name: 'Name', label: 'Name', shortLabel: 'Name des Unternehmens', type: 'text', required: true },
      { name: 'Anschrift', label: 'Adresse', shortLabel: 'Adresse des Unternehmens', type: 'textarea', rows: 2, required: true }
    ]
  },
  {
    title: 'Empfänger bzw. Lieferant',
    fields: [
      { name: 'Group1', label: 'Angaben zum', shortLabel: 'Empfänger oder Lieferant', type: 'radio', required: true, options: [
        { value: 'Auswahl1', label: 'Empfänger' },
        { value: 'Auswahl2', label: 'Lieferanten' }
      ] },
      { name: 'Name_2', label: 'Name', shortLabel: 'Name Empfänger/Lieferant', type: 'text', required: true },
      { name: 'Anschrift_2', label: 'Adresse', shortLabel: 'Adresse Empfänger/Lieferant', type: 'textarea', rows: 2 }
    ]
  },
  {
    title: 'Angaben zur Lieferung',
    fields: [
      { name: 'ProduktRow1', label: 'Produkt', type: 'textarea', rows: 3, required: true },
      { name: 'Lieferdatum  LieferzeitraumRow1', label: 'Lieferdatum / Lieferzeitraum', type: 'textarea', rows: 3, required: true },
      { name: 'MengeRow1', label: 'Menge', type: 'textarea', rows: 3, required: true },
      { name: 'Nummer und Datum Lieferschein  RechnungRow1', label: 'Nummer und Datum Lieferschein / Rechnung', shortLabel: 'Lieferschein/Rechnung', type: 'textarea', rows: 3, required: true }
    ]
  },
  {
    title: 'Anlagen',
    fields: [
      { name: 'Lieferschein', label: 'Lieferschein', type: 'checkbox' },
      { name: 'Rechnung', label: 'Rechnung', type: 'checkbox' },
      { name: 'Gutschrift', label: 'Gutschrift', type: 'checkbox' },
      { name: 'Sonstige', label: 'sonstiges', type: 'checkbox', textField: 'sonstiges' }
    ]
  },
  {
    title: 'Zentrale Fragestellung',
    hint: 'Bei der Empfängerprüfung mindestens eine der beiden Fragen ankreuzen.',
    fields: [
      { name: 'Group2', label: 'Prüfung', shortLabel: 'Zentrale Fragestellung', type: 'radio', required: true, options: [
        { value: 'Auswahl1', label: 'Lieferantenprüfung — stammt die Lieferung vom Kunden, als Warenausgang verbucht?' },
        { value: 'Auswahl2', label: 'Empfängerprüfung' }
      ] },
      { name: 'Check Box2', label: 'Empfängerprüfung: die Lieferung verbucht wurde', type: 'checkbox', dependsOn: CROSSCHECK_EMPFAENGERPRUEFUNG },
      { name: 'Check Box3', label: 'Empfängerprüfung: noch weitere Lieferungen dieses Produktes in Empfang genommen wurden', type: 'checkbox', dependsOn: CROSSCHECK_EMPFAENGERPRUEFUNG }
    ]
  },
  {
    title: 'Weitergehende Fragestellung',
    fields: [
      { name: 'weitergehende Fragestellung', label: 'Weitergehende Fragestellung', type: 'textarea' }
    ]
  },
  {
    title: 'Mit der Bitte um',
    fields: [
      { name: 'Group3', label: 'Art der Prüfung', shortLabel: 'Mit der Bitte um', type: 'radio', required: true, options: [
        { value: 'Auswahl1', label: 'zeitnahe Beleg-Prüfung (begründete Zweifel, kurzfristige Rücksendung)' },
        { value: 'Auswahl2', label: 'Routineprüfung (Rückmeldung nur, falls Bio-Status nicht bestätigt)' }
      ] },
      { name: 'Datum', label: 'Datum', type: 'text', required: true }
    ]
  }
];
const CROSSCHECK_ALL_FIELDS = formularAllFields(CROSSCHECK_SECTIONS);

// Unterschrift auf der Linie "Datum, Unterschrift Kontrolleur / Kontroll-
// stelle" (Unterstriche bei y≈212 von x≈47 bis ≈385), rechts neben dem
// Datumsfeld (x 46–159) — per pdf.js aus der Vorlage gemessen.
const CROSSCHECK_SIGNATURE_BOX = { x: 172, y: 211, width: 200, height: 26 };

// Die Vorlage hat nur formularweit Schriftgröße "auto" (0 Tf) — pdf-lib würde
// kurze Texte in den 75 pt hohen Tabellenzellen riesig setzen. Feste Größen passend zur
// jeweiligen Feldhöhe.
function crossCheckFontSize(field) {
  const h = field.acroField.getWidgets()[0].getRectangle().height;
  if (field.isMultiline()) return h < 30 ? 8 : 9;
  return Math.max(7.5, Math.min(9, h - 1.5));
}

// Alle Formulare, die an einem Termin hängen können. listKey = Array am
// Termin (ev.probenprotokolle / ev.crossChecks), idPrefix = Präfix der
// Listen-IDs im Detailpanel (#tk-<idPrefix>-new/-list).
const TK_FORMULARE = {
  probenprotokoll: {
    listKey: 'probenprotokolle',
    idPrefix: 'probenprotokoll',
    containerId: 'tk-probenprotokolle',
    title: 'Probenahmeprotokoll',
    listTitle: 'Probenahmeprotokolle',
    newLabel: 'Neues Protokoll',
    emptyText: 'Noch keine Protokolle.',
    deleteLabel: 'Protokoll löschen',
    deleteConfirm: 'Protokoll wirklich löschen?',
    icon: 'description',
    // Relativ zur App (BASE_URL) — sie läuft ggf. unter einem Unterpfad.
    template: `${import.meta.env.BASE_URL}probenahmeprotokoll-vorlage.pdf`,
    fileArt: 'Probenahmeprotokoll',
    sections: PROBENPROTOKOLL_SECTIONS,
    allFields: PROBENPROTOKOLL_ALL_FIELDS,
    anlagenSection: 'Anlagen',
    signatureHint: 'Keine Rechtsberatung — bitte im Zweifel das amtliche Formular gegenprüfen.',
    signatures: [
      { key: 'signatureProbenehmer', label: 'Unterschrift des Probenehmers', canvasId: 'pp-sig-probenehmer', box: PROBENPROTOKOLL_SIGNATURE_BOXES.signatureProbenehmer },
      { key: 'signatureBetriebsinhaber', label: 'Unterschrift des Betriebsinhabers', fullLabel: 'Unterschrift des Betriebsinhabers oder seines Stellvertreters', canvasId: 'pp-sig-betriebsinhaber', box: PROBENPROTOKOLL_SIGNATURE_BOXES.signatureBetriebsinhaber }
    ],
    prefill(ev, values) {
      let rememberedName = '';
      try { rememberedName = localStorage.getItem(PROBENEHMER_NAME_STORAGE_KEY) || ''; } catch {}
      values['Name des Unternehmens'] = ev.kunde;
      values['Straße Hausnummer'] = ev.strasse || '';
      values['PLZ  Ort'] = [ev.plz, ev.ort].filter(Boolean).join(' ');
      values['Kundennummer'] = ev.kundennummer || '';
      values['DatumZeitpunkt und Ort der Probenahme'] = new Date().toLocaleDateString('de-DE');
      values['Probenehmer Name'] = rememberedName;
    },
    onInput(p, name, value) {
      if (name === 'Probenehmer Name') {
        try { localStorage.setItem(PROBENEHMER_NAME_STORAGE_KEY, value); } catch {}
      }
    },
    rowTitle: p => p.values['Probe'] || '(kein Produkt angegeben)',
    rowDate: p => p.values['DatumZeitpunkt und Ort der Probenahme']
  },
  crosscheck: {
    listKey: 'crossChecks',
    idPrefix: 'crosscheck',
    containerId: 'tk-crosschecks',
    title: 'Cross Check',
    listTitle: 'Cross Checks',
    newLabel: 'Neuer Cross Check',
    emptyText: 'Noch keine Cross Checks.',
    deleteLabel: 'Cross Check löschen',
    deleteConfirm: 'Cross Check wirklich löschen?',
    icon: 'fact_check',
    template: `${import.meta.env.BASE_URL}crosscheck-vorlage.pdf`,
    fileArt: 'Cross Check',
    sections: CROSSCHECK_SECTIONS,
    allFields: CROSSCHECK_ALL_FIELDS,
    anlagenSection: 'Anlagen',
    signatureHint: 'Unterschrift erscheint auf der Linie „Datum, Unterschrift Kontrolleur / Kontrollstelle“ der Anfrage. Den Teil „Ergebnis der Prüfung“ füllt die angefragte Kontrollstelle aus.',
    signatures: [
      { key: 'signatureKontrolleur', label: 'Unterschrift Kontrolleur / Kontrollstelle', canvasId: 'cc-sig-kontrolleur', box: CROSSCHECK_SIGNATURE_BOX }
    ],
    fontSize: crossCheckFontSize,
    prefill(ev, values) {
      values['Name'] = ev.kunde;
      values['Anschrift'] = [ev.strasse, [ev.plz, ev.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n');
      values['Datum'] = new Date().toLocaleDateString('de-DE');
    },
    // Wer angefragt wird, bestimmt die Prüfung: beim Empfänger die
    // Empfängerprüfung, beim Lieferanten die Lieferantenprüfung — wird
    // vorgeschlagen, solange noch keine gewählt ist.
    onInput(p, name, value) {
      if (name === 'Group1' && !p.values['Group2']) {
        p.values['Group2'] = value === 'Auswahl1' ? 'Auswahl2' : 'Auswahl1';
        const radio = document.querySelector(`#probenprotokoll-modal-form [data-field="Group2"][value="${p.values['Group2']}"]`);
        if (radio) radio.checked = true;
      }
    },
    extraMissing(p) {
      if (p.values['Group2'] === 'Auswahl2' && !p.values['Check Box2'] && !p.values['Check Box3']) {
        return [{ field: 'Check Box2', label: 'Frage zur Empfängerprüfung' }];
      }
      return [];
    },
    rowTitle: p => p.values['Name_2'] || '(kein Empfänger/Lieferant)',
    rowDate: p => p.values['Datum']
  }
};

function tkFormularDef(kind) { return TK_FORMULARE[kind]; }

// Ein Feld mit dependsOn (z. B. die beiden Fragen der Empfängerprüfung) zählt
// nur, solange die übergeordnete Auswahl passt — sonst ist es im Formular
// ausgegraut und wird im Export leer gelassen.
function formularFieldActive(f, values) {
  return !f.dependsOn || values[f.dependsOn.field] === f.dependsOn.value;
}

function createFormular(ev, kind) {
  const def = tkFormularDef(kind);
  const values = {};
  def.allFields.forEach(f => { values[f.name] = f.type === 'checkbox' ? false : ''; });
  def.prefill(ev, values);

  const now = new Date().toISOString();
  const p = {
    id: (kind === 'probenprotokoll' ? 'protokoll-' : kind + '-') + Date.now() + Math.random().toString(36).slice(2),
    betrieb: ev.kunde,
    terminId: ev.id,
    createdAt: now, updatedAt: now,
    values,
    anlagenDateien: []
  };
  def.signatures.forEach(s => { p[s.key] = null; });
  ev[def.listKey] = ev[def.listKey] || [];
  ev[def.listKey].push(p);
  return p;
}

function createProbenprotokoll(ev) {
  return createFormular(ev, 'probenprotokoll');
}

function deleteFormular(ev, kind, id) {
  const def = tkFormularDef(kind);
  const p = (ev[def.listKey] || []).find(x => x.id === id);
  if (!p) return;
  if (!confirm(def.deleteConfirm)) return;
  ev[def.listKey] = ev[def.listKey].filter(x => x.id !== id);
  if (activeProbenprotokollKind === kind && activeProbenprotokollEventId === ev.id && activeProbenprotokollId === id) closeProbenprotokollModal();
  if (terminkalenderSelectedId === ev.id) renderTerminkalenderDetail(ev);
}

// Rendert den Listen-Ausschnitt eines Formulars (Probenahmeprotokolle, Cross
// Checks) innerhalb des Terminkalender-Detailpanels — Aufruf und
// Verdrahtung analog zu renderTerminkalenderAttachments()/den dortigen
// Button-Listenern (main.js, renderTerminkalenderDetail).
function formularSectionHtml(ev, kind) {
  const def = tkFormularDef(kind);
  const list = ev[def.listKey] || [];
  const rows = list.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(p => {
    const complete = probenprotokollMissing(p, kind).length === 0;
    const datum = def.rowDate(p) || '–';
    return `<div class="probenprotokoll-row">
      <button type="button" class="probenprotokoll-row-main" data-action="open-protokoll" data-id="${escapeHtml(p.id)}">
        <span class="probenprotokoll-row-title">${escapeHtml(def.rowTitle(p))}</span>
        <span class="probenprotokoll-row-sub">${escapeHtml(datum)} · ${complete ? 'vollständig' : 'unvollständig'}</span>
      </button>
      <button type="button" class="probenprotokoll-row-delete" data-action="delete-protokoll" data-id="${escapeHtml(p.id)}" title="Löschen">
        <span class="material-symbols-rounded icon">delete</span>
      </button>
    </div>`;
  }).join('');
  return `
    <div class="tk-attachments" id="${def.containerId}">
      <div class="tk-attachments-head">${escapeHtml(def.listTitle)}</div>
      <div id="tk-${def.idPrefix}-list">${rows || `<p class="empty-hint">${escapeHtml(def.emptyText)}</p>`}</div>
      <div class="tk-attachments-actions">
        <button type="button" class="tk-attachment-btn tk-attachment-btn-primary" id="tk-${def.idPrefix}-new">
          <span class="material-symbols-rounded icon">${def.icon}</span> ${escapeHtml(def.newLabel)}
        </button>
      </div>
    </div>`;
}

function formularSectionsHtml(ev) {
  return Object.keys(TK_FORMULARE).map(kind => formularSectionHtml(ev, kind)).join('');
}

function wireFormularSections(ev) {
  Object.keys(TK_FORMULARE).forEach(kind => {
    const def = tkFormularDef(kind);
    document.getElementById(`tk-${def.idPrefix}-new`).addEventListener('click', () => {
      const p = createFormular(ev, kind);
      openFormular(kind, ev.id, p.id);
    });
    document.getElementById(`tk-${def.idPrefix}-list`).addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-action="delete-protokoll"]');
      if (delBtn) { deleteFormular(ev, kind, delBtn.getAttribute('data-id')); return; }
      const openBtn = e.target.closest('[data-action="open-protokoll"]');
      if (openBtn) openFormular(kind, ev.id, openBtn.getAttribute('data-id'));
    });
  });
}

function getActiveProbenprotokoll() {
  const ev = terminkalenderEvents.find(e => e.id === activeProbenprotokollEventId);
  if (!ev) return null;
  const def = tkFormularDef(activeProbenprotokollKind);
  const p = (ev[def.listKey] || []).find(x => x.id === activeProbenprotokollId);
  return p ? { ev, p, def, kind: activeProbenprotokollKind } : null;
}

function openFormular(kind, evId, id) {
  const def = tkFormularDef(kind);
  activeProbenprotokollKind = kind;
  activeProbenprotokollEventId = evId;
  activeProbenprotokollId = id;
  document.getElementById('probenprotokoll-modal-title').textContent = def.title;
  document.getElementById('probenprotokoll-modal-delete-label').textContent = def.deleteLabel;
  document.getElementById('probenprotokoll-modal-overlay').hidden = false;
  renderProbenprotokollForm();
}

function openProbenprotokoll(evId, id) {
  openFormular('probenprotokoll', evId, id);
}

function closeProbenprotokollModal() {
  const evId = activeProbenprotokollEventId;
  activeProbenprotokollEventId = null;
  activeProbenprotokollId = null;
  document.getElementById('probenprotokoll-modal-overlay').hidden = true;
  document.getElementById('probenprotokoll-modal-form').innerHTML = '';
  // Neu angelegte/bearbeitete Formulare ändern Titel/Status der Zeile in
  // der Liste (siehe formularSectionHtml) — die wurde beim Öffnen nicht neu
  // gerendert, muss also spätestens beim Schließen aktualisiert werden,
  // sonst zeigt sie einen veralteten Stand.
  if (evId === terminkalenderSelectedId) {
    const ev = terminkalenderEvents.find(e => e.id === evId);
    if (ev) renderTerminkalenderDetail(ev);
  }
}

// Fehlende Pflichtangaben eines Formulars — { field } für Formularfelder,
// { signature } für Unterschriften. Erklärungen mit requiredUnless entfallen,
// sobald das genannte Feld (Annahme abgelehnt) angekreuzt ist.
function probenprotokollMissing(p, kind = activeProbenprotokollKind) {
  const def = tkFormularDef(kind);
  const missing = [];
  def.sections.forEach(sec => sec.fields.forEach(f => {
    const v = p.values[f.name];
    const filled = typeof v === 'string' ? v.trim() !== '' : !!v;
    const needed = f.required || (f.requiredUnless && !p.values[f.requiredUnless]);
    if (needed && !filled) missing.push({ field: f.name, label: f.shortLabel || f.label });
  }));
  if (def.extraMissing) missing.push(...def.extraMissing(p));
  def.signatures.forEach(s => {
    if (!p[s.key]) missing.push({ signature: s.key, canvasId: s.canvasId, label: s.label });
  });
  return missing;
}

// Markiert fehlende Felder im offenen Formular und zeigt die Liste über den
// Aktions-Buttons. Läuft erst nach dem ersten Export-Versuch
// (probenprotokollValidationShown), danach bei jeder Eingabe erneut, damit
// die Markierung verschwindet, sobald ein Feld ausgefüllt ist.
let probenprotokollValidationShown = false;
function markProbenprotokollMissing(p) {
  const form = document.getElementById('probenprotokoll-modal-form');
  const errorEl = document.getElementById('probenprotokoll-modal-error');
  form.querySelectorAll('.pp-invalid').forEach(el => el.classList.remove('pp-invalid'));
  const missing = probenprotokollMissing(p);
  missing.forEach(m => {
    const el = m.field
      ? form.querySelector(`[data-field="${CSS.escape(m.field)}"]`)?.closest('.pp-field')
      : document.getElementById(m.canvasId)?.closest('.pp-signature-block');
    if (el) el.classList.add('pp-invalid');
  });
  errorEl.hidden = missing.length === 0;
  errorEl.textContent = missing.length ? 'Bitte noch ausfüllen: ' + missing.map(m => m.label).join(', ') + '.' : '';
  return missing;
}

function refreshProbenprotokollValidation(p) {
  if (probenprotokollValidationShown) markProbenprotokollMissing(p);
}

// Graut abhängige Felder (dependsOn) aus, solange die übergeordnete Auswahl
// nicht passt.
function updateFormularDependencies(p) {
  const ref = getActiveProbenprotokoll();
  if (!ref) return;
  const form = document.getElementById('probenprotokoll-modal-form');
  ref.def.allFields.forEach(f => {
    if (!f.dependsOn) return;
    const active = formularFieldActive(f, p.values);
    form.querySelectorAll(`[data-field="${CSS.escape(f.name)}"]`).forEach(el => {
      el.disabled = !active;
      el.closest('.pp-field')?.classList.toggle('pp-field-inactive', !active);
    });
  });
}

function probenprotokollFieldRowHtml(f, values) {
  const id = 'pp-field-' + f.name.replace(/[^a-zA-Z0-9]/g, '_');
  const req = (f.required || f.requiredUnless) ? ' <span class="pp-required" title="Pflichtfeld">*</span>' : '';
  if (f.type === 'text') {
    const input = `<input type="text" id="${id}" class="account-input" data-field="${escapeHtml(f.name)}" value="${escapeHtml(values[f.name] || '')}">`;
    // scan: Knopf für den Barcode-Scanner direkt neben dem Feld.
    const control = f.scan
      ? `<div class="pp-input-with-action">${input}<button type="button" class="pp-scan-btn" data-scan-field="${escapeHtml(f.name)}" title="Barcode scannen" aria-label="${escapeHtml(f.label)} per Barcode scannen"><span class="material-symbols-rounded icon">barcode_scanner</span></button></div>`
      : input;
    return `<div class="pp-field">
      <label class="compare-label" for="${id}">${escapeHtml(f.label)}${req}</label>
      ${control}
    </div>`;
  }
  if (f.type === 'textarea') {
    return `<div class="pp-field pp-field-wide">
      <label class="compare-label" for="${id}">${escapeHtml(f.label)}${req}</label>
      <textarea id="${id}" class="account-input" rows="${f.rows || 4}" data-field="${escapeHtml(f.name)}">${escapeHtml(values[f.name] || '')}</textarea>
    </div>`;
  }
  if (f.type === 'checkbox') {
    const textHtml = f.textField
      ? `<input type="text" class="account-input" placeholder="Bezeichnung" data-field="${escapeHtml(f.textField)}" value="${escapeHtml(values[f.textField] || '')}">`
      : '';
    return `<div class="pp-field pp-checkbox-row modal-checkbox-row">
      <label><input type="checkbox" data-field="${escapeHtml(f.name)}" ${values[f.name] ? 'checked' : ''}> ${escapeHtml(f.label)}${req}</label>
      ${textHtml}
    </div>`;
  }
  if (f.type === 'radio') {
    return `<div class="pp-field pp-field-wide">
      <span class="compare-label">${escapeHtml(f.label)}${req}</span>
      <div class="pp-radio-group">
        ${f.options.map(o => `<label class="pp-radio-option"><input type="radio" name="pp-radio-${id}" data-field="${escapeHtml(f.name)}" value="${escapeHtml(o.value)}" ${values[f.name] === o.value ? 'checked' : ''}> ${escapeHtml(o.label)}</label>`).join('')}
      </div>
    </div>`;
  }
  return '';
}

// Anlagen-Dateien (Foto/Dokument) hängen an das Protokoll, nicht an den
// Termin — eigenes kleines Array statt ev.attachments, damit sie beim
// PDF-Export gezielt als zusätzliche Seiten eingebettet werden können (siehe
// exportProbenprotokollPdf), statt einfach nur als weiterer Termin-Anhang
// danebenzuliegen. Rendering/Upload-Mechanik ist bewusst identisch zu
// renderTerminkalenderAttachments()/uploadTerminkalenderAttachment()
// (main.js) — gleiche .tk-attachment*-CSS-Klassen, gleiches Signed-URL-
// Ladeschema.
async function renderProbenprotokollAnlagenGrid(p) {
  const grid = document.getElementById('pp-anlagen-grid');
  if (!grid) return;
  const files = p.anlagenDateien || [];
  if (!files.length) { grid.innerHTML = '<p class="empty-hint">Keine Anlagen-Dateien.</p>'; return; }
  grid.innerHTML = files.map(() => '<div class="tk-attachment tk-attachment-loading"></div>').join('');
  const urls = await Promise.all(files.map(a => getPhotoUrl(a.path, a.name).catch(() => null)));
  grid.innerHTML = files.map((a, i) => {
    const url = urls[i];
    if (!url) return `<div class="tk-attachment tk-attachment-error" title="${escapeHtml(a.name)} konnte nicht geladen werden"><span class="material-symbols-rounded icon">warning</span></div>`;
    const isImage = (a.type || '').startsWith('image/');
    const inner = isImage
      ? `<img src="${url}" alt="${escapeHtml(a.name)}">`
      : `<span class="tk-attachment-icon material-symbols-rounded icon">description</span><span class="tk-attachment-name">${escapeHtml(a.name)}</span>`;
    return `<div class="tk-attachment">
      <a href="${url}" target="_blank" rel="noopener" class="tk-attachment-link" title="${escapeHtml(a.name)}">${inner}</a>
      <button type="button" class="tk-attachment-remove" data-path="${escapeHtml(a.path)}" title="Entfernen"><span class="material-symbols-rounded icon">close</span></button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.tk-attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => removeProbenprotokollAnlage(p, btn.getAttribute('data-path')));
  });
}

async function addProbenprotokollAnlage(p, file) {
  const statusEl = document.getElementById('pp-anlage-status');
  if (!file) return;
  try {
    const path = await uploadPhoto(file);
    p.anlagenDateien = p.anlagenDateien || [];
    p.anlagenDateien.push({ path, name: file.name, size: file.size, type: file.type || '' });
    p.updatedAt = new Date().toISOString();
    renderProbenprotokollAnlagenGrid(p);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Fehler: ' + (err.message || 'Datei konnte nicht hochgeladen werden.');
  }
}

async function removeProbenprotokollAnlage(p, path) {
  const statusEl = document.getElementById('pp-anlage-status');
  try {
    await deletePhoto(path);
    p.anlagenDateien = (p.anlagenDateien || []).filter(a => a.path !== path);
    p.updatedAt = new Date().toISOString();
    renderProbenprotokollAnlagenGrid(p);
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Fehler: ' + (err.message || 'Löschen fehlgeschlagen.');
  }
}

function probenprotokollAnlagenFilesHtml() {
  return `
    <div class="tk-attachments pp-anlagen-files">
      <div class="tk-attachments-head">Anlagen-Dateien (werden beim Export als zusätzliche Seiten eingefügt)</div>
      <div class="tk-attachments-grid" id="pp-anlagen-grid"></div>
      <div class="tk-attachments-actions">
        <label class="tk-attachment-btn">
          <input type="file" id="pp-anlage-file-input" hidden>
          <span class="material-symbols-rounded icon">attach_file</span> Foto/Dokument hinzufügen
        </label>
      </div>
      <p class="modal-hint" id="pp-anlage-status"></p>
    </div>`;
}

function renderProbenprotokollForm() {
  const ref = getActiveProbenprotokoll();
  if (!ref) return;
  const { p, def } = ref;
  probenprotokollValidationShown = false;
  const errorEl = document.getElementById('probenprotokoll-modal-error');
  errorEl.hidden = true;
  errorEl.textContent = '';
  const sectionsHtml = def.sections.map(sec => `
    <fieldset class="pp-section">
      <legend>${escapeHtml(sec.title)}</legend>
      ${sec.hint ? `<p class="modal-hint">${escapeHtml(sec.hint)}</p>` : ''}
      <div class="pp-section-grid">${sec.fields.map(f => probenprotokollFieldRowHtml(f, p.values)).join('')}</div>
      ${sec.title === def.anlagenSection ? probenprotokollAnlagenFilesHtml() : ''}
    </fieldset>`).join('');
  const signaturesHtml = `
    <fieldset class="pp-section">
      <legend>${def.signatures.length > 1 ? 'Unterschriften' : 'Unterschrift'}</legend>
      <p class="modal-hint">${escapeHtml(def.signatureHint)}</p>
      <div class="pp-signature-grid">
        ${def.signatures.map(s => `
        <div class="pp-signature-block">
          <span class="compare-label">${escapeHtml(s.fullLabel || s.label)} <span class="pp-required" title="Pflichtfeld">*</span></span>
          <canvas class="pp-signature-pad" id="${s.canvasId}" width="480" height="140"></canvas>
          <button type="button" class="pp-signature-clear" data-sig="${s.key}">
            <span class="material-symbols-rounded icon">refresh</span> Löschen
          </button>
        </div>`).join('')}
      </div>
    </fieldset>`;
  document.getElementById('probenprotokoll-modal-form').innerHTML = sectionsHtml + signaturesHtml;
  wireProbenprotokollFormInputs(p, def);
  updateFormularDependencies(p);
  def.signatures.forEach(s => setupSignaturePad(s.canvasId, p, s.key));
  renderProbenprotokollAnlagenGrid(p);
  document.getElementById('pp-anlage-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    addProbenprotokollAnlage(p, file);
  });
}

function wireProbenprotokollFormInputs(p, def) {
  const form = document.getElementById('probenprotokoll-modal-form');
  form.querySelectorAll('[data-field]').forEach(el => {
    const name = el.getAttribute('data-field');
    const isCheckOrRadio = el.type === 'checkbox' || el.type === 'radio';
    el.addEventListener(isCheckOrRadio ? 'change' : 'input', () => {
      if (el.type === 'checkbox') p.values[name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) p.values[name] = el.value; }
      else p.values[name] = el.value;
      p.updatedAt = new Date().toISOString();
      if (def.onInput) def.onInput(p, name, p.values[name]);
      updateFormularDependencies(p);
      refreshProbenprotokollValidation(p);
    });
  });
  form.querySelectorAll('[data-scan-field]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = form.querySelector(`input[data-field="${CSS.escape(btn.getAttribute('data-scan-field'))}"]`);
      openBarcodeScanner(code => applyScannedCode(input, code));
    });
  });
}

// Freihändiges Zeichnen per Pointer Events (kein Vorbild in dieser App — der
// Dokumentenscanner nutzt Canvas nur zum Video-Frame-Halten/4-Eck-Zuschnitt,
// keine Tinte). Pointer Capture direkt auf dem Canvas statt des sonst in
// dieser App üblichen document-weiten Drag-Musters, da ein einzelner
// durchgehender Strichzug gezeichnet wird, nicht ein einzelner Punkt verschoben.
function setupSignaturePad(canvasId, protokoll, key) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let drawing = false;
  let lastX = 0, lastY = 0;

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    const pos = pointerPos(e);
    lastX = pos.x; lastY = pos.y;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const pos = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x; lastY = pos.y;
  });
  const endStroke = () => {
    if (!drawing) return;
    drawing = false;
    protokoll[key] = canvas.toDataURL('image/png');
    refreshProbenprotokollValidation(protokoll);
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  if (protokoll[key]) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = protokoll[key];
  }

  const clearBtn = document.querySelector(`.pp-signature-clear[data-sig="${key}"]`);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      protokoll[key] = null;
      refreshProbenprotokollValidation(protokoll);
    });
  }
}

document.getElementById('probenprotokoll-modal-close').addEventListener('click', closeProbenprotokollModal);
document.getElementById('probenprotokoll-modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('probenprotokoll-modal-overlay')) closeProbenprotokollModal();
});
document.getElementById('probenprotokoll-modal-delete').addEventListener('click', () => {
  const ref = getActiveProbenprotokoll();
  if (ref) deleteFormular(ref.ev, ref.kind, ref.p.id);
});

// ---------- Barcode-Scanner (Nr. Analyseproben / Gegenproben) ----------
// Probenbeutel tragen die Probenummer als Barcode. Wo der Browser einen
// eigenen Erkenner hat (BarcodeDetector, Chrome auf Android), wird der
// genutzt; sonst (iPhone, Desktop) @zxing/browser. ZXing ist per npm
// gebündelt und wird erst beim ersten Scannen nachgeladen — als Teil des
// Builds hält der Service Worker es vor, der Scanner geht also auch ohne
// Empfang im Stall.
const BARCODE_NATIVE_FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'];
const barcodeOverlay = document.getElementById('barcode-overlay');
const barcodeVideo = document.getElementById('barcode-video');
const barcodeStatusEl = document.getElementById('barcode-status');
const barcodeTorchBtn = document.getElementById('barcode-torch');
let barcodeStream = null;
let barcodeStopDecode = null;
// Zählt jedes Öffnen/Schließen hoch — ein währenddessen geschlossener oder
// neu geöffneter Scanner macht nach einem await nicht mit altem Zustand weiter.
let barcodeSession = 0;

// Startet die Erkennung auf dem laufenden Video; ruft onCode genau einmal
// auf. Rückgabe: Funktion zum Abbrechen.
async function startBarcodeDecoding(video, onCode) {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = BARCODE_NATIVE_FORMATS.filter(f => supported.includes(f));
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        let stopped = false;
        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              const code = codes.find(c => c.rawValue);
              if (code && !stopped) { stopped = true; onCode(code.rawValue); return; }
            }
          } catch {}
          setTimeout(tick, 120);
        };
        tick();
        return () => { stopped = true; };
      }
    } catch {}
  }
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
  let done = false;
  let controls = null;
  controls = await reader.decodeFromVideoElement(video, (result) => {
    if (!result || done) return;
    done = true;
    if (controls) controls.stop();
    onCode(result.getText());
  });
  if (done) controls.stop();
  return () => { done = true; controls.stop(); };
}

async function openBarcodeScanner(onCode) {
  const session = ++barcodeSession;
  barcodeOverlay.hidden = false;
  barcodeOverlay.classList.remove('found');
  barcodeTorchBtn.hidden = true;
  barcodeTorchBtn.setAttribute('aria-pressed', 'false');
  barcodeStatusEl.textContent = 'Kamera wird gestartet …';
  let stream;
  try {
    stream = import.meta.env.DEV && window.__ffTestBarcodeStream
      ? window.__ffTestBarcodeStream()
      : await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
  } catch (err) {
    console.error('Kamerazugriff fehlgeschlagen', err);
    if (session === barcodeSession) barcodeStatusEl.textContent = 'Kein Kamerazugriff — bitte die Nummer von Hand eintippen.';
    return;
  }
  if (session !== barcodeSession) { stream.getTracks().forEach(t => t.stop()); return; }
  barcodeStream = stream;
  barcodeVideo.srcObject = stream;
  try { await barcodeVideo.play(); } catch {}

  // Taschenlampe (dunkle Ställe) — nur anbieten, wenn die Kamera sie kann.
  const track = stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  barcodeTorchBtn.hidden = !caps.torch;

  barcodeStatusEl.textContent = 'Barcode in den Rahmen halten.';
  let stop;
  try {
    stop = await startBarcodeDecoding(barcodeVideo, (code) => {
      if (session !== barcodeSession) return;
      if (navigator.vibrate) navigator.vibrate(60);
      closeBarcodeScanner();
      onCode(String(code).trim());
    });
  } catch (err) {
    console.error('Barcode-Erkennung konnte nicht gestartet werden', err);
    if (session === barcodeSession) barcodeStatusEl.textContent = 'Barcode-Erkennung nicht verfügbar — bitte die Nummer von Hand eintippen.';
    return;
  }
  if (session !== barcodeSession) { stop(); return; }
  barcodeStopDecode = stop;
}

function closeBarcodeScanner() {
  barcodeSession++;
  if (barcodeStopDecode) { barcodeStopDecode(); barcodeStopDecode = null; }
  if (barcodeStream) { barcodeStream.getTracks().forEach(t => t.stop()); barcodeStream = null; }
  barcodeVideo.srcObject = null;
  barcodeOverlay.hidden = true;
}

document.getElementById('barcode-close').addEventListener('click', closeBarcodeScanner);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !barcodeOverlay.hidden) closeBarcodeScanner();
});
barcodeTorchBtn.addEventListener('click', async () => {
  const track = barcodeStream && barcodeStream.getVideoTracks()[0];
  if (!track) return;
  const on = barcodeTorchBtn.getAttribute('aria-pressed') !== 'true';
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    barcodeTorchBtn.setAttribute('aria-pressed', String(on));
  } catch {}
});

// Gescannte Nummer ins Feld übernehmen. Mehrere Proben = mehrere Nummern:
// ist schon etwas eingetragen, wird die neue Nummer mit Komma angehängt
// (doppelt gescannte Nummern nicht zweimal).
function applyScannedCode(input, code) {
  if (!code || !input) return;
  const parts = input.value.split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.includes(code)) parts.push(code);
  input.value = parts.join(', ');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const field = input.closest('.pp-field');
  if (field) {
    field.classList.add('pp-scanned');
    setTimeout(() => field.classList.remove('pp-scanned'), 1200);
  }
}

// Dev-only: echter Decoder-Durchlauf im Test — ein Canvas mit QR-Code dient
// als "Kamera" (window.__ffTestBarcodeStream), der Rest läuft unverändert.
if (import.meta.env.DEV) {
  window.__ffTestBarcode = {
    async qrCanvas(text, size = 360) {
      const { QRCodeWriter, BarcodeFormat } = await import('@zxing/library');
      const matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, new Map());
      const canvas = document.createElement('canvas');
      canvas.width = matrix.getWidth();
      canvas.height = matrix.getHeight();
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let y = 0; y < matrix.getHeight(); y++) {
        for (let x = 0; x < matrix.getWidth(); x++) {
          if (matrix.get(x, y)) ctx.fillRect(x, y, 1, 1);
        }
      }
      return canvas;
    },
    isOpen: () => !barcodeOverlay.hidden,
    streamActive: () => !!barcodeStream && barcodeStream.getTracks().some(t => t.readyState === 'live')
  };
}

// Zeichnet ein Unterschrift-PNG seitenverhältnistreu zentriert in eine feste
// Box (statt zu verzerren) — dasselbe Scale-to-fit-Muster wie beim Logo-/
// Hofplan-Übersicht-Einbetten in bestehenden PDF-Exporten dieser App.
function drawSignatureFitted(page, img, box) {
  const scale = Math.min(box.width / img.width, box.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = box.x + (box.width - w) / 2;
  const y = box.y + (box.height - h) / 2;
  page.drawImage(img, { x, y, width: w, height: h });
}

// Holt die rohen Bytes einer Anlagen-Datei (für die Einbettung als
// zusätzliche PDF-Seite) — Produktionscode über die ohnehin für die Anzeige
// genutzte Signed URL (getPhotoUrl), dev-only Override analog
// window.__ffTestUploadPhotoOverride (supabase.js), damit Playwright-Tests
// ohne echtes Supabase-Storage auskommen.
async function getAttachmentBytes(path) {
  if (import.meta.env.DEV && window.__ffTestFetchBytesOverride) {
    return window.__ffTestFetchBytesOverride(path);
  }
  const url = await getPhotoUrl(path);
  const resp = await fetch(url);
  return new Uint8Array(await resp.arrayBuffer());
}

// A4 in pdf-lib-Punkten (595.28 x 841.89) — für angehängte Bild-Seiten, da
// die Vorlage selbst ebenfalls A4 ist (595 x 842, siehe Node/pdf-lib-
// Inspektion der Originaldatei).
const PROBENPROTOKOLL_A4 = [595.28, 841.89];

async function embedProbenprotokollAnlage(pdfDoc, anlage) {
  const bytes = await getAttachmentBytes(anlage.path);
  const type = anlage.type || '';
  if (type === 'application/pdf') {
    const srcDoc = await PDFLib.PDFDocument.load(bytes);
    const copied = await pdfDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    copied.forEach(pg => pdfDoc.addPage(pg));
    return;
  }
  if (!type.startsWith('image/')) return; // unbekannter Typ — bleibt reine Datei-Referenz, wird nicht eingebettet
  const img = type === 'image/png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  const page = pdfDoc.addPage(PROBENPROTOKOLL_A4);
  const margin = 20;
  const maxW = page.getWidth() - margin * 2;
  const maxH = page.getHeight() - margin * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: (page.getWidth() - w) / 2, y: (page.getHeight() - h) / 2, width: w, height: h });
}

async function exportProbenprotokollPdf(ev, p, def = tkFormularDef('probenprotokoll')) {
  if (typeof PDFLib === 'undefined') { showError('PDF-Export nicht verfügbar (Bibliothek konnte nicht geladen werden).'); return; }
  try {
    const templateBytes = await fetch(def.template).then(r => r.arrayBuffer());
    const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    def.allFields.forEach(f => {
      // Abhängige Felder (z. B. Fragen der Empfängerprüfung bei gewählter
      // Lieferantenprüfung) bleiben leer, auch wenn sie vorher mal gesetzt waren.
      const value = formularFieldActive(f, p.values) ? p.values[f.name] : (f.type === 'checkbox' ? false : '');
      if (f.type === 'checkbox') {
        const box = form.getCheckBox(f.name);
        if (value) box.check(); else box.uncheck();
      } else if (f.type === 'radio') {
        const group = form.getRadioGroup(f.name);
        if (value) group.select(value); else group.clear();
      } else {
        const field = form.getTextField(f.name);
        // Felder ohne eigenes /DA (nur formularweit, auto-Größe): Darstellung
        // je Feld setzen — setFontSize() verlangt ein vorhandenes /DA.
        if (def.fontSize) field.acroField.setDefaultAppearance(`/Helv ${def.fontSize(field)} Tf 0 g`);
        field.setText(value || '');
      }
    });

    const page = pdfDoc.getPage(0);
    for (const s of def.signatures) {
      if (!p[s.key]) continue;
      const img = await pdfDoc.embedPng(p[s.key]);
      drawSignatureFitted(page, img, s.box);
    }

    form.flatten();

    for (const anlage of (p.anlagenDateien || [])) {
      await embedProbenprotokollAnlage(pdfDoc, anlage);
    }

    const bytes = await pdfDoc.save();
    const name = `${ev.date.getFullYear()}_${sanitizeFileNamePart(ev.kunde)}_${def.fileArt}.pdf`;
    const file = new File([bytes], name, { type: 'application/pdf' });
    await uploadTerminkalenderAttachment(ev, file, def.fileArt);
    closeProbenprotokollModal();
  } catch (err) {
    showError('PDF-Export fehlgeschlagen: ' + (err.message || String(err)));
  }
}

document.getElementById('probenprotokoll-modal-export').addEventListener('click', () => {
  const ref = getActiveProbenprotokoll();
  if (!ref) return;
  probenprotokollValidationShown = true;
  const missing = markProbenprotokollMissing(ref.p);
  if (missing.length) {
    document.querySelector('#probenprotokoll-modal-form .pp-invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  exportProbenprotokollPdf(ref.ev, ref.p, ref.def);
});

// Dev-only Testhaken (analog window.__ffTestMap/__ffTestStallplaner) — echtes
// Canvas-Pointer-Zeichnen ist laut AGENTS.md Punkt 2 genauso wenig
// zuverlässig per synthetischem Maus-Event simulierbar wie SVG-Vertex-Drag.
// Je Formular ein Haken mit derselben Schnittstelle.
if (import.meta.env.DEV) {
  const formularTestHook = (kind) => {
    const hook = {
      create(eventId) {
        const ev = terminkalenderEvents.find(e => e.id === eventId);
        if (!ev) return null;
        return createFormular(ev, kind).id;
      },
      getActive() {
        const ref = getActiveProbenprotokoll();
        return ref && ref.kind === kind ? ref.p : null;
      },
      get(eventId, id) {
        const ev = terminkalenderEvents.find(e => e.id === eventId);
        return ev ? (ev[tkFormularDef(kind).listKey] || []).find(x => x.id === id) || null : null;
      },
      setValue(eventId, id, name, value) {
        const p = hook.get(eventId, id);
        if (p) p.values[name] = value;
      },
      setSignature(eventId, id, key, dataUrl) {
        const p = hook.get(eventId, id);
        if (p) p[key] = dataUrl;
      },
      missing(eventId, id) {
        const p = hook.get(eventId, id);
        return p ? probenprotokollMissing(p, kind) : null;
      }
    };
    return hook;
  };
  window.__ffTestProbenprotokoll = formularTestHook('probenprotokoll');
  window.__ffTestCrossCheck = formularTestHook('crosscheck');
}

// ---------- Dev-Tooling: Jahresvergleich-Inputs aus test-shapes/ vorbefüllen ----------
// Vorerst deaktiviert: test-shapes/ enthält jetzt 16 einzelne Bundesland-
// Dateien statt eines Jahr-A/B-Paares, dev-prefill.js braucht ein Update auf
// ein aktuelles Dateipaar, bevor das wieder sinnvoll aktiviert werden kann.
// if (import.meta.env.DEV) {
//   import('./dev-prefill.js').then(m => m.prefillCompareInputs());
// }
