import { isSupabaseConfigured, signUp, signIn, signOut, getSession, saveState, loadState, uploadPhoto, getPhotoUrl, deletePhoto, requestAccess, listPendingAccessRequests, approveAccessRequest, declineAccessRequest } from './supabase.js';

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
  document.getElementById('btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentBasemap];
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
      ? `<a class="table-route-link" href="${googleMapsDirectionsUrl(entry.center.lat, entry.center.lng)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Route ↗</a>`
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
      <td><button class="notes-btn${hasNotes ? ' has-notes' : ''}" data-action="notes" data-idx="${entry.idx}" onclick="event.stopPropagation()" title="Notiz &amp; Fotos">📝</button></td>
      <td><button class="notes-btn${hasKulturplan ? ' has-notes' : ''}" data-action="kulturplan" data-idx="${entry.idx}" onclick="event.stopPropagation()" title="Anbauplanung">🌱</button></td>
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
    minimizeBtn.textContent = '▁';
    panel.classList.add('open');
  }

  function close() { panel.classList.remove('open'); }
  closeBtn.addEventListener('click', close);

  minimizeBtn.addEventListener('click', () => {
    const minimizing = !panel.classList.contains('minimized');
    if (minimizing) {
      lastExpandedHeight = panel.getBoundingClientRect().height;
      panel.classList.add('minimized');
      minimizeBtn.textContent = '▲';
    } else {
      panel.classList.remove('minimized');
      panel.style.height = lastExpandedHeight + 'px';
      minimizeBtn.textContent = '▁';
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
  terminkalender: 'Termine aus Excel importieren und in der Kalenderwoche navigieren'
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
  armedTool = null;
  // Die Werkzeugleiste ist nur im Flächenzeichner sichtbar (Teil von #topbar,
  // dort per .topbar-extra ein-/ausgeblendet) — ein weiterhin "scharfes"
  // Bearbeiten/Löschen/Teilen-Werkzeug beim Verlassen des Tabs wäre unsichtbar
  // und damit verwirrend, deshalb hier immer zurückgesetzt.
  if (target !== 'zeichner' && mapToolMode) { mapToolMode = null; setShapeToolbarStatus(''); }
  updateShapeToolbar();
  // Gleiches Prinzip für die Hofplan-Werkzeugleiste.
  if (target !== 'hofplan' && hofplanToolMode) hofplanToolMode = null;
  updateHofplanToolbar();
  if (target !== 'compare') { restoreCompareHiddenLayer(); compareTablePanel.close(); }
  document.getElementById('map').classList.toggle('placing', target === 'bienenflug');

  document.querySelectorAll('.segment-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === target));
  document.querySelectorAll('.sidebar-section').forEach(el => el.classList.toggle('active', el.getAttribute('data-view') === target));
  document.querySelectorAll('.topbar-extra').forEach(el => el.classList.toggle('active', el.getAttribute('data-view') === target));
  document.getElementById('brand-caption').textContent = SEGMENT_CAPTIONS[target] || '';
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

  // Terminkalender hat eine eigene, zweite Leaflet-Karteninstanz statt der
  // geteilten Parzellen-Karte — #map-wrap und #terminkalender-view schließen
  // sich deshalb gegenseitig aus statt wie die anderen Funktionen nur
  // Layer auf derselben Karte umzuschalten.
  document.getElementById('map-wrap').hidden = target === 'terminkalender';
  const tkView = document.getElementById('terminkalender-view');
  tkView.hidden = target !== 'terminkalender';
  // Shapefile-/GeoJSON-Upload und die geteilte Ebenenliste ergeben im
  // Terminkalender keinen Sinn (andere Datenwelt, eigene Karte) — dort
  // ausgeblendet statt immer sichtbar wie in den anderen Funktionen.
  document.getElementById('dropzone').hidden = target === 'terminkalender';
  document.getElementById('layer-section').hidden = target === 'terminkalender';
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
  updateShapeToolbar();
}

function undoLastShapeAction() {
  const action = shapeUndoStack.pop();
  if (!action) return;
  if (action.type === 'add') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) removeEntryEverywhere(entry);
    setShapeToolbarStatus('Zeichnen rückgängig gemacht.');
  } else if (action.type === 'delete' || action.type === 'split') {
    if (action.type === 'split') {
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
    setShapeToolbarStatus(action.type === 'split' ? 'Teilen rückgängig gemacht.' : 'Löschen rückgängig gemacht.');
  } else if (action.type === 'edit') {
    const entry = featureIndex.find(e => e.id === action.entryId);
    if (entry) {
      applyGeometryToEntry(entry, action.beforeGeometry);
      renderFeatureTable();
      renderParcelList();
    }
    setShapeToolbarStatus('Bearbeitung rückgängig gemacht.');
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

// ---------- Werkzeugleiste oberhalb der Karte ----------
// Bündelt Zeichnen/Bearbeiten/Teilen/Löschen/Rückgängig an einer Stelle,
// statt sie doppelt als Zeilen-Buttons in der Flächenzeichner-Liste UND der
// Flächentabelle vorzuhalten — die Werkzeuge wirken auf jede Fläche, die auf
// der Karte angeklickt wird, unabhängig vom gerade aktiven Reiter.
const shapeToolDrawBtn = document.getElementById('shape-tool-draw');
const shapeToolEditBtn = document.getElementById('shape-tool-edit');
const shapeToolSplitBtn = document.getElementById('shape-tool-split');
const shapeToolDeleteBtn = document.getElementById('shape-tool-delete');
const shapeToolUndoBtn = document.getElementById('shape-tool-undo');
const shapeToolbarStatusEl = document.getElementById('shape-toolbar-status');

function setShapeToolbarStatus(msg) { shapeToolbarStatusEl.textContent = msg || ''; }

function updateShapeToolbar() {
  shapeToolDrawBtn.classList.toggle('active', armedTool === 'draw-polygon');
  shapeToolEditBtn.classList.toggle('active', mapToolMode === 'edit');
  shapeToolDeleteBtn.classList.toggle('active', mapToolMode === 'delete');
  shapeToolSplitBtn.classList.toggle('active', mapToolMode === 'split' || armedTool === 'split-line');
  shapeToolUndoBtn.disabled = shapeUndoStack.length === 0;
}

// Bearbeiten/Löschen bleiben "scharf", bis man sie erneut anklickt (oder Esc
// drückt) — man kann so mehrere Flächen hintereinander anklicken, ohne das
// Werkzeug jedes Mal neu auswählen zu müssen.
function setMapToolMode(mode) {
  disableShapeEditing();
  mapToolMode = mapToolMode === mode ? null : mode;
  if (mapToolMode === 'edit') setShapeToolbarStatus('Fläche anklicken, um ihre Eckpunkte zu bearbeiten.');
  else if (mapToolMode === 'delete') setShapeToolbarStatus('Fläche anklicken, um sie zu löschen.');
  else setShapeToolbarStatus('');
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
    setShapeToolbarStatus('');
  } else {
    disableShapeEditing();
    mapToolMode = 'split';
    setShapeToolbarStatus('Fläche anklicken, um sie zu teilen.');
  }
  updateShapeToolbar();
});
shapeToolUndoBtn.addEventListener('click', undoLastShapeAction);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mapToolMode) { mapToolMode = null; setShapeToolbarStatus(''); updateShapeToolbar(); }
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

function setActiveFruitKey(key) {
  activeFruitKey = (activeFruitKey === key) ? null : key;
  armedTool = activeFruitKey ? 'place-tree' : (armedTool === 'place-tree' ? null : armedTool);
  document.querySelectorAll('.fruit-btn, .fruit-list-row').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-key') === activeFruitKey);
  });
  document.getElementById('map').classList.toggle('placing', !!activeFruitKey);
  setObstbaumStatus(activeFruitKey
    ? `${fruitOf(activeFruitKey).label} aktiv — auf die Karte klicken, um Bäume zu setzen.`
    : 'Bereit.');
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
      <td><button class="notes-btn${hasNotes ? ' has-notes' : ''}" data-id="${t.id}" data-action="notes" title="Notiz &amp; Fotos">📝</button></td>
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
function addHofplanShapeFromLayer(layer, kategorie, name, idOverride, colorOverride) {
  const shape = {
    id: idOverride || 'gebaeude-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    kategorie: kategorie || '',
    name: name || '',
    color: colorOverride || null,
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

function restoreHofplanShapeFromFeature(feature, kategorie, name, idOverride, color) {
  const layer = L.geoJSON(feature).getLayers()[0];
  const shape = addHofplanShapeFromLayer(layer, kategorie, name, idOverride, color);
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
  updateHofplanToolbar();
}

function undoLastHofplanAction() {
  const action = hofplanUndoStack.pop();
  if (!action) return;
  if (action.type === 'add') {
    const shape = hofplanShapes.find(s => s.id === action.shapeId);
    if (shape) removeHofplanShapeEverywhere(shape);
    setHofplanStatus('Zeichnen rückgängig gemacht.');
  } else if (action.type === 'delete') {
    restoreHofplanShapeFromFeature(action.feature, action.kategorie, action.name, undefined, action.color);
    setHofplanStatus('Löschen rückgängig gemacht.');
  } else if (action.type === 'edit') {
    const shape = hofplanShapes.find(s => s.id === action.shapeId);
    if (shape) { applyGeometryToHofplanShape(shape, action.beforeGeometry); renderHofplanList(); }
    setHofplanStatus('Bearbeitung rückgängig gemacht.');
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
    });
  });
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

// ---------- Werkzeugleiste oberhalb der Karte (Hofplan) ----------
const hofplanToolRectBtn = document.getElementById('hofplan-tool-rect');
const hofplanToolPolyBtn = document.getElementById('hofplan-tool-poly');
const hofplanToolEditBtn = document.getElementById('hofplan-tool-edit');
const hofplanToolDeleteBtn = document.getElementById('hofplan-tool-delete');
const hofplanToolUndoBtn = document.getElementById('hofplan-tool-undo');

function updateHofplanToolbar() {
  hofplanToolRectBtn.classList.toggle('active', armedTool === 'draw-hofplan-rect');
  hofplanToolPolyBtn.classList.toggle('active', armedTool === 'draw-hofplan-poly');
  hofplanToolEditBtn.classList.toggle('active', hofplanToolMode === 'edit');
  hofplanToolDeleteBtn.classList.toggle('active', hofplanToolMode === 'delete');
  hofplanToolUndoBtn.disabled = hofplanUndoStack.length === 0;
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
  try {
    const bounds = highlightLayer.getBounds();
    if (bounds.isValid()) targetMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 20 });
    await waitForTilesFullyLoaded(satelliteLayer, mapElId, 6000);
    return await html2canvas(document.getElementById(mapElId), { useCORS: true, logging: false });
  } finally {
    targetMap.removeLayer(highlightLayer);
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
        properties: { kategorie: s.kategorie, farbe: hofplanEffectiveColor(s) }
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
          properties: { kategorie: s.kategorie, farbe: hofplanEffectiveColor(s) }
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
    accountDomainHint.textContent = '✓ oekop.de-Adresse — Registrierung sofort möglich.';
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
  if (accountSession) {
    accountBtn.textContent = accountSession.user.email;
    accountBtn.classList.add('logged-in');
  } else {
    accountBtn.textContent = 'Anmelden';
    accountBtn.classList.remove('logged-in');
  }
  // Das "+" in der Wortmarke (FeldFolio+) markiert die Cloud-Funktionen, die
  // erst nach der Anmeldung nutzbar sind — deshalb nur dann sichtbar.
  document.getElementById('brand-logo').classList.toggle('is-logged-in', !!accountSession);
}

function openAccountModal() { setAuthMode('signin'); renderAccountModal(); accountModal.hidden = false; }
function closeAccountModal() { accountModal.hidden = true; }

accountBtn.addEventListener('click', openAccountModal);
['account-modal-close-1', 'account-modal-close-2', 'account-modal-close-3'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeAccountModal);
});
accountModal.addEventListener('click', (e) => { if (e.target === accountModal) closeAccountModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !accountModal.hidden) closeAccountModal(); });

if (isSupabaseConfigured) {
  getSession().then(session => {
    accountSession = session;
    updateAccountButton();
    if (session) autoLoadCloudState();
    refreshAutoSyncTimer();
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
        autoLoadCloudState();
        refreshAutoSyncTimer();
      } else {
        showAccountError('Registrierung erfolgreich — bitte E-Mail bestätigen und dann anmelden.');
      }
    } else {
      const data = await signIn(email, password);
      accountSession = data.session;
      updateAccountButton();
      renderAccountModal();
      autoLoadCloudState();
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
  await signOut();
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
let autoSyncInFlight = false;
const btnSync = document.getElementById('btn-sync');

function updateSyncButton() {
  btnSync.classList.toggle('active', autoSyncEnabled);
  btnSync.setAttribute('aria-checked', String(autoSyncEnabled));
  if (!autoSyncEnabled) {
    btnSync.title = 'Automatische Cloud-Synchronisation: aus';
  } else if (!isSupabaseConfigured || !accountSession) {
    btnSync.title = 'Automatische Cloud-Synchronisation: an (wird erst nach der Anmeldung aktiv)';
  } else {
    btnSync.title = `Automatische Cloud-Synchronisation: an — speichert alle ${AUTO_SYNC_INTERVAL_MS / 1000}s im Hintergrund`;
  }
}

async function runAutoSync() {
  if (autoSyncInFlight || !autoSyncEnabled || !isSupabaseConfigured || !accountSession) return;
  autoSyncInFlight = true;
  btnSync.classList.add('syncing');
  try {
    await saveFullState();
    btnSync.title = `Automatische Cloud-Synchronisation: an — zuletzt synchronisiert um ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    btnSync.title = 'Automatische Cloud-Synchronisation: Fehler — ' + (err.message || 'Synchronisation fehlgeschlagen.');
  } finally {
    autoSyncInFlight = false;
    btnSync.classList.remove('syncing');
  }
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
  if (document.hidden) runAutoSync();
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

// Holt den kompletten Cloud-Stand frisch (nicht aus einem lokalen Zwischen-
// stand) — wichtig beim Betrieb-Wechsel, damit die Arbeitsstände anderer
// Betriebe/Geräte nicht durch einen veralteten lokalen Blob überschrieben
// werden (siehe switchWorkspace).
async function getFreshFullState() {
  const row = await loadState();
  return migrateFullStateShape((row && row.data) || {});
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
    hofplanShapes: hofplanShapes.map(s => ({ kategorie: s.kategorie, name: s.name, color: s.color, geometry: s.leafletLayer.toGeoJSON().geometry }))
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
      addHofplanShapeFromLayer(layer, s.kategorie || '', s.name || '', undefined, s.color || null);
    });
    renderHofplanList();
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
function clearWorkspace() {
  clearAllLayers();
  clearAllTrees();
  clearAllBeehives();
  clearAllHofplanShapes();
}

// terminkalenderEvents/manualBetriebe gelten immer betriebsübergreifend,
// werden also unabhängig vom aktuellen Workspace wiederhergestellt.
function restoreSharedState(full) {
  if ((full.terminkalenderEvents || []).length) {
    terminkalenderEvents = full.terminkalenderEvents.map(e => ({
      ...e, date: new Date(e.date), dateEnd: e.dateEnd ? new Date(e.dateEnd) : null,
      attachments: Array.isArray(e.attachments) ? e.attachments : []
    }));
    renderTerminkalenderSummary();
    renderTerminkalenderGrid();
  }
  manualBetriebe = Array.isArray(full.manualBetriebe) ? full.manualBetriebe : [];
}

// Ersetzt im frisch geladenen Cloud-Stand nur den Slot des aktuell aktiven
// Workspace durch den In-Memory-Stand (übrige Betriebe bleiben unverändert,
// da full vom Server kommt) und schreibt shared-Felder immer mit — Ersatz für
// das frühere direkte saveState(serializeCurrentState()) an jeder Speicherstelle.
async function saveFullState() {
  const full = await getFreshFullState();
  full.workspaces[currentWorkspaceKey] = serializeWorkspace();
  full.terminkalenderEvents = terminkalenderEvents.map(e => ({
    ...e, date: e.date.toISOString(), dateEnd: e.dateEnd ? e.dateEnd.toISOString() : null
  }));
  full.manualBetriebe = manualBetriebe;
  await saveState(full);
}

// Wechselt den aktiven Workspace: sichert zuerst den bisherigen Stand (aus dem
// frisch geholten Cloud-Blob heraus, damit andere Betriebe/Geräte nicht
// überschrieben werden), leert dann die Karte und baut den Ziel-Workspace aus
// demselben, gerade gelesenen Blob wieder auf — ein Read + ein Write pro
// Wechsel, kein Extra-Request für den Ziel-Workspace nötig.
async function switchWorkspace(oldKey, newKey) {
  const full = await getFreshFullState();
  full.workspaces[oldKey] = serializeWorkspace();
  full.terminkalenderEvents = terminkalenderEvents.map(e => ({
    ...e, date: e.date.toISOString(), dateEnd: e.dateEnd ? e.dateEnd.toISOString() : null
  }));
  full.manualBetriebe = manualBetriebe;
  await saveState(full);
  clearWorkspace();
  restoreWorkspace(full.workspaces[newKey]);
}

// Prüft den aktuell GELADENEN (In-Memory-)Workspace auf Inhalt — anders als
// ein leeres serialisiertes Workspace-Objekt zu prüfen, da hier der gerade
// sichtbare Stand gemeint ist, bevor er überhaupt gespeichert wurde.
function currentWorkspaceHasContent() {
  return !!(Object.keys(layers).length || obstbaumTrees.length || bienenflugPoints.length || hofplanShapes.length);
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
    hofplanShapes: [...(target.hofplanShapes || []), ...(moved.hofplanShapes || [])]
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
  const movedContent = serializeWorkspace();
  const full = await getFreshFullState();
  full.workspaces[z.betrieb] = mergeWorkspaces(full.workspaces[z.betrieb] || {}, movedContent);
  full.workspaces[NO_BETRIEB_KEY] = {};
  full.terminkalenderEvents = terminkalenderEvents.map(e => ({
    ...e, date: e.date.toISOString(), dateEnd: e.dateEnd ? e.dateEnd.toISOString() : null
  }));
  full.manualBetriebe = manualBetriebe;
  await saveState(full);
  clearWorkspace();
  restoreWorkspace(full.workspaces[z.betrieb]);
  currentWorkspaceKey = z.betrieb;
  setActiveZuordnung(z);
}

function restoreState(full) {
  if (!full) return;
  restoreSharedState(full);
  clearWorkspace();
  restoreWorkspace((full.workspaces || {})[currentWorkspaceKey]);
}

// Lädt den Cloud-Stand automatisch, sobald eine Anmeldung feststeht — beim
// Start (bestehende Session) UND direkt nach einem Anmelden/Registrieren
// (siehe die zwei Aufrufstellen unten) — damit "Cloud laden" nicht mehr von
// Hand angestoßen werden muss. Der Button im Konto-Bereich bleibt trotzdem
// bestehen, für ein manuelles Nachladen (z.B. nach einer Änderung auf einem
// anderen Gerät).
async function autoLoadCloudState() {
  try {
    const row = await loadState();
    if (!row) return;
    restoreState(migrateFullStateShape(row.data));
    accountSyncStatus.textContent = 'Geladen.';
  } catch (err) {
    accountSyncStatus.textContent = 'Fehler: ' + (err.message || 'Laden fehlgeschlagen.');
  }
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
    ? `<div class="notes-photo-thumb"><img src="${urls[i]}" alt=""><button type="button" class="notes-photo-remove" data-path="${escapeHtml(p.path)}" title="Foto löschen">✕</button></div>`
    : '<div class="notes-photo-thumb notes-photo-error" title="Foto konnte nicht geladen werden">⚠</div>'
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

// Aktualisiert nur das 🌱-Icon in der Flächentabelle, ohne die ganze
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

const tkSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
      // Fotos/Dateien, die man einem Termin manuell hinzufügt (siehe
      // renderTerminkalenderAttachments unten) — bleiben bei einem erneuten
      // Excel-Upload immer erhalten (siehe mergeTerminkalenderEvents).
      attachments: []
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
      Object.assign(existing, p);
      if (!addressChanged) { existing.lat = prevLat; existing.lng = prevLng; existing.geocodeStatus = prevStatus; }
      if (sameDay && prevHasTime) { existing.date = prevDate; existing.hasTime = true; existing.dateEnd = prevDateEnd; }
      existing.attachments = prevAttachments || [];
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

const TK_ICON_PIN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.72 11.19 7.02 11.45a1.5 1.5 0 0 0 1.96 0C13.28 21.19 20 15.25 20 10c0-4.42-3.58-8-8-8z" fill="#EA4335"/><circle cx="12" cy="10" r="3.2" fill="#ffffff"/></svg>';
const TK_ICON_PHONE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg>';
const TK_ICON_MAIL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm14.5 2.4L12 11.5 5.5 6.4v1.7L12 13.5l6.5-5.4z"/></svg>';

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
    <div class="tk-betrieb-assign">
      <button type="button" class="tk-betrieb-assign-btn${isActiveZuordnung ? ' active' : ''}" id="tk-betrieb-assign-btn">
        ${isActiveZuordnung ? '✓ Betrieb zugeordnet' : '🏢 Als Betrieb zuordnen'}
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
          📷 Foto aufnehmen
        </label>
        <label class="tk-attachment-btn">
          <input type="file" id="tk-file-add-input" hidden>
          📎 Datei hinzufügen
        </label>
      </div>
      <p class="modal-hint" id="tk-attachment-status"></p>
    </div>
  `;
  renderTerminkalenderAttachments(ev);
  document.getElementById('tk-photo-capture-input').addEventListener('change', (e) => handleTerminkalenderFileAdd(ev, e));
  document.getElementById('tk-file-add-input').addEventListener('change', (e) => handleTerminkalenderFileAdd(ev, e));
  document.getElementById('tk-betrieb-assign-btn').addEventListener('click', () => toggleTerminkalenderZuordnung(ev));
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
    if (!url) return `<div class="tk-attachment tk-attachment-error" title="${escapeHtml(a.name)} konnte nicht geladen werden">⚠</div>`;
    const isImage = (a.type || '').startsWith('image/');
    const inner = isImage
      ? `<img src="${url}" alt="${escapeHtml(a.name)}">`
      : `<span class="tk-attachment-icon">📄</span><span class="tk-attachment-name">${escapeHtml(a.name)}</span>`;
    return `<div class="tk-attachment">
      <a href="${url}" target="_blank" rel="noopener" class="tk-attachment-link" title="${escapeHtml(a.name)}">${inner}</a>
      <button type="button" class="tk-attachment-remove" data-path="${escapeHtml(a.path)}" title="Entfernen">✕</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.tk-attachment-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTerminkalenderAttachment(ev.id, btn.getAttribute('data-path')));
  });
}

async function handleTerminkalenderFileAdd(ev, e) {
  const input = e.target;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const path = await uploadPhoto(file);
    // Termine kennen ihren Betrieb (Kunde) und ihr Datum bereits selbst — die
    // Jahr_Betrieb_Art-Benennung braucht hier also keine globale Zuordnung
    // (siehe zuordnungFileName), sondern wird direkt aus dem Termin abgeleitet.
    const isImage = (file.type || '').startsWith('image/');
    const ext = (file.name.split('.').pop() || (isImage ? 'jpg' : 'dat')).toLowerCase();
    const art = isImage ? 'Foto Termin' : 'Datei Termin';
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
      const pin = e.lat != null ? ' 📍' : '';
      const clip = (e.attachments && e.attachments.length) ? ' 📎' : '';
      const betriebMark = (activeZuordnung && activeZuordnung.terminId === e.id) ? ' 🏢' : '';
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
    el.addEventListener('click', () => selectTerminkalenderEvent(el.getAttribute('data-id')));
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
  btnBetriebLabel.textContent = activeZuordnung ? `🏢 ${activeZuordnung.betrieb}` : 'Betrieb wählen';
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
  // Aktualisiert das 🏢-Zeichen an den Kalenderkarten und das Zuordnen-Icon im
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
        ${manualSet.has(name) ? `<button type="button" class="betrieb-row-remove" data-action="remove-manual" data-name="${escapeHtml(name)}" title="Manuell hinzugefügten Betrieb entfernen">✕</button>` : ''}
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

// ---------- Dev-Tooling: Jahresvergleich-Inputs aus test-shapes/ vorbefüllen ----------
// Vorerst deaktiviert: test-shapes/ enthält jetzt 16 einzelne Bundesland-
// Dateien statt eines Jahr-A/B-Paares, dev-prefill.js braucht ein Update auf
// ein aktuelles Dateipaar, bevor das wieder sinnvoll aktiviert werden kann.
// if (import.meta.env.DEV) {
//   import('./dev-prefill.js').then(m => m.prefillCompareInputs());
// }
