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

const COLORS = ['#4FB8AF', '#D97757', '#8AA6D9', '#C9A24F', '#B287D9', '#6FBF73', '#E08FA8', '#5FA8C4'];
let colorIdx = 0;
const layers = {}; // id -> { name, geojson, leafletLayer, color, visible }
let layerCounter = 0;
const featureIndex = []; // flat list of every feature across all layers, for the table view
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

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);

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

function setBasemap(key) {
  basemaps[currentBasemap].remove();
  currentBasemap = key;
  basemaps[currentBasemap].addTo(map);
  document.getElementById('btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentBasemap];
}

document.getElementById('btn-basemap').addEventListener('click', () => {
  const nextIdx = (basemapOrder.indexOf(currentBasemap) + 1) % basemapOrder.length;
  setBasemap(basemapOrder[nextIdx]);
});

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

  return results;
}

// Manche Bundesländer (z.B. Bayern) exportieren "Feldstueck" (Geometrie +
// Name) und "Nutzung" (Kulturart-Code) als zwei separate, geometrisch
// identische Shapefiles im selben Zip statt einer gemeinsamen Ebene. Ohne
// Zusammenführung entstehen zwei sich exakt überlappende Ebenen, die je nur
// die Hälfte der Information zeigen (Feldstück: Name, kein Kulturart;
// Nutzung: Kulturart, kein Name). Wir verknüpfen sie hier über die
// gemeinsame Feldstück-ID (FID, mit FSNr als Fallback) zu einer Ebene.
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
    const props = f.properties || {};
    const nutzProps = nutzByKey.get(keyOf(props));
    return nutzProps ? { ...f, properties: { ...props, ...nutzProps } } : f;
  });

  const merged = { name: feldstueck.name, fc: { type: 'FeatureCollection', features: mergedFeatures } };
  const rest = results.filter((_, i) => i !== feldIdx && i !== nutzIdx);
  return [merged, ...rest];
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

  const leafletLayer = L.geoJSON(geojson, {
    style: () => ({ color: color, weight: 1.6, fillColor: color, fillOpacity: 0.22 }),
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 5, color: color, weight: 1.6, fillColor: color, fillOpacity: 0.6
    }),
    onEachFeature: (feature, lyr) => {
      const props = feature.properties || {};
      const center = lyr.getBounds ? lyr.getBounds().getCenter() : lyr.getLatLng();
      const entry = {
        idx: featureIndex.length,
        layerId: id,
        layerName: name,
        isTeilflaechen,
        props,
        center,
        leafletLayer: lyr,
        color,
        nummer: pickField(props, FIELD_CANDIDATES.nummer),
        featName: pickField(props, FIELD_CANDIDATES.name),
        groesse: pickGroesse(props),
        kultur: pickField(props, FIELD_CANDIDATES.kultur),
        flaechenId: pickField(props, FIELD_CANDIDATES.flaechenid)
      };
      featureIndex.push(entry);
      lyr.on('click', () => {
        highlightFeature(entry);
        selectFeatureInTable(entry);
      });

      const labelText = escapeHtml(entry.nummer) + (entry.featName ? '<br>' + escapeHtml(entry.featName) : '');
      if (labelText.trim()) labelAnchors.push(createLabelAnchorAt(center, labelText));
    }
  });
  labelAnchors.forEach(anchor => leafletLayer.addLayer(anchor));
  if (startVisible) leafletLayer.addTo(map);

  let count = 0;
  (geojson.features || []).forEach(() => count++);

  layers[id] = { name, geojson, leafletLayer, color, visible: startVisible, isTeilflaechen, count };
  renderLayerList();
  renderFeatureTable();
  fitAllLayers();
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
      featureIndex.splice(i, 1);
    }
  }
  featureIndex.forEach((entry, i) => { entry.idx = i; }); // Indizes neu durchnummerieren
  renderLayerList();
  renderFeatureTable();
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

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted); padding:14px;">' +
      (featureIndex.length ? 'Keine Flächen in dieser Ansicht (Teilflächen sind ausgeblendet).' : 'Noch keine Flächen geladen.') +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(entry => {
    const num = parseFloat(String(entry.groesse).replace(',', '.'));
    const groesseText = isFinite(num) ? num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha' : (entry.groesse || '–');
    const routeCell = entry.center
      ? `<a class="table-route-link" href="${googleMapsDirectionsUrl(entry.center.lat, entry.center.lng)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Route ↗</a>`
      : '–';
    return `<tr data-idx="${entry.idx}">
      <td>${escapeHtml(entry.nummer || '–')}</td>
      <td>${escapeHtml(entry.featName || '–')}</td>
      <td>${escapeHtml(entry.flaechenId || '–')}</td>
      <td>${groesseText}</td>
      <td>${escapeHtml(entry.kultur || '–')}</td>
      <td>${routeCell}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
    tr.addEventListener('click', () => selectFeatureFromTable(parseInt(tr.getAttribute('data-idx'), 10)));
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
    panel.style.height = lastExpandedHeight + 'px';
    minimizeBtn.textContent = '▁';
    panel.classList.add('open');
  }

  closeBtn.addEventListener('click', () => panel.classList.remove('open'));

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

  return { open };
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

// ---------- Reiter-Umschaltung ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.getAttribute('data-view');
    document.getElementById('view-viewer').classList.toggle('active', target === 'viewer');
    document.getElementById('view-compare').classList.toggle('active', target === 'compare');
    document.getElementById('view-zeichner').classList.toggle('active', target === 'zeichner');
    document.getElementById('view-obstbaum').classList.toggle('active', target === 'obstbaum');
    if (target === 'compare') {
      initCompareMap();
      setTimeout(() => compareMap && compareMap.invalidateSize(), 50);
    } else if (target === 'zeichner') {
      initZeichnerMap();
      setTimeout(() => zeichnerMap && zeichnerMap.invalidateSize(), 50);
    } else if (target === 'obstbaum') {
      initObstbaumMap();
      setTimeout(() => obstbaumMap && obstbaumMap.invalidateSize(), 50);
    } else {
      setTimeout(() => map.invalidateSize(), 50);
    }
  });
});

// ---------- Jahresvergleich ----------
let compareMap = null;
let compareBasemaps = null;
let compareBasemapOrder = ['osm', 'topo', 'satellite'];
let compareBasemapLabels = { osm: 'Standard', topo: 'Topografisch', satellite: 'Satellit' };
let currentCompareBasemap = 'osm';
let compareGeoLayer = null;
let compareViewMode = 'diff'; // 'diff' | 'onlyA' | 'onlyB'
let compareDataA = null; // { fc, fileName, layerName }
let compareDataB = null;
let compareRecords = [];

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

function initCompareMap() {
  if (compareMap) return;
  compareMap = L.map('compare-map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);
  compareBasemaps = createBasemaps();
  compareBasemaps.osm.addTo(compareMap);
  document.getElementById('compare-btn-basemap').addEventListener('click', () => {
    compareBasemaps[currentCompareBasemap].remove();
    const nextIdx = (compareBasemapOrder.indexOf(currentCompareBasemap) + 1) % compareBasemapOrder.length;
    currentCompareBasemap = compareBasemapOrder[nextIdx];
    compareBasemaps[currentCompareBasemap].addTo(compareMap);
    document.getElementById('compare-btn-basemap').textContent = 'Basiskarte: ' + compareBasemapLabels[currentCompareBasemap];
  });
}

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
  boundsWrap: document.getElementById('compare-map-wrap'),
  minHeight: TABLE_MIN_HEIGHT,
  defaultHeight: TABLE_DEFAULT_HEIGHT
});

document.getElementById('compare-btn-table').addEventListener('click', () => compareTablePanel.open());

function showCompareError(msg) {
  const el = document.getElementById('compare-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showCompareError._t);
  showCompareError._t = setTimeout(() => el.style.display = 'none', 7000);
}

async function loadCompareFile(file, slot) {
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
    const data = { fc: chosen.fc, fileName: file.name, layerName: chosen.name };
    if (slot === 'a') {
      compareDataA = data;
      document.getElementById('compare-file-a-name').textContent = file.name;
      document.getElementById('compare-drop-a').classList.add('filled');
    } else {
      compareDataB = data;
      document.getElementById('compare-file-b-name').textContent = file.name;
      document.getElementById('compare-drop-b').classList.add('filled');
    }
    document.getElementById('btn-compare-run').disabled = !(compareDataA && compareDataB);
  } catch (err) {
    console.error(err);
    showCompareError(file.name + ': Konnte Datei nicht lesen — ' + (err.message || 'unbekannter Fehler'));
  }
}

document.getElementById('compare-file-a').addEventListener('change', (e) => {
  if (e.target.files[0]) loadCompareFile(e.target.files[0], 'a');
});
document.getElementById('compare-file-b').addEventListener('change', (e) => {
  if (e.target.files[0]) loadCompareFile(e.target.files[0], 'b');
});

function parseHa(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function runComparison() {
  if (!compareDataA || !compareDataB) return;
  initCompareMap();

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
  if (!compareMap) return;
  if (compareGeoLayer) compareMap.removeLayer(compareGeoLayer);
  compareGeoLayer = L.featureGroup().addTo(compareMap);

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
    compareMap.fitBounds(compareGeoLayer.getBounds(), { padding: [30, 30] });
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
    compareMap.fitBounds(compareGeoLayer.getBounds(), { padding: [30, 30] });
  }
}

function zoomToCompareRecord(rec) {
  if (!rec || !rec._mapLayer) return;
  const b = rec._mapLayer.getBounds();
  if (b && b.isValid()) {
    compareMap.fitBounds(b, { padding: [60, 60], maxZoom: 17 });
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

function exportPdf(headers, rows, filename, title) {
  if (typeof window.jspdf === 'undefined') { showError('PDF-Export nicht verfügbar (Bibliothek konnte nicht geladen werden).'); return; }
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFontSize(12);
  doc.text(title || '', 14, 12);
  doc.autoTable({ head: [headers], body: rows, startY: 16, styles: { fontSize: 8 }, headStyles: { fillColor: [79, 184, 175] } });
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
  if (type === 'csv') exportCsv(headers, data, `flaechenuebersicht_${ts}.csv`);
  else if (type === 'xlsx') exportXlsx(headers, data, `flaechenuebersicht_${ts}.xlsx`, 'Flächen');
  else if (type === 'pdf') exportPdf(headers, data, `flaechenuebersicht_${ts}.pdf`, 'Flächenübersicht');
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
  if (type === 'csv') exportCsv(headers, data, `jahresvergleich_${ts}.csv`);
  else if (type === 'xlsx') exportXlsx(headers, data, `jahresvergleich_${ts}.xlsx`, 'Vergleich');
  else if (type === 'pdf') exportPdf(headers, data, `jahresvergleich_${ts}.pdf`, 'Jahresvergleich');
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

// Wechselt bei Bedarf auf den angegebenen Tab (nötig, damit dessen Karten-
// Container beim Screenshot eine echte Größe hat) und liefert eine restore()
// Funktion, die zum vorher aktiven Tab zurückwechselt.
function ensureTabActive(viewId) {
  const activeBtn = document.querySelector('.tab-btn.active');
  const targetBtn = document.querySelector(`.tab-btn[data-view="${viewId}"]`);
  const wasActive = activeBtn === targetBtn;
  if (!wasActive) targetBtn.click();
  return { wasActive, restore: () => { if (!wasActive) activeBtn.click(); } };
}

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
    await waitForTilesLoaded(satelliteLayer, 6000);
    await delay(400); // kurzer Puffer, damit der letzte Frame sicher gemalt ist
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
  const tab = ensureTabActive('viewer');
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

    const ts = new Date().toISOString().slice(0, 10);
    doc.save(`flaechenkarten_${ts}.pdf`);
    setStatus('Flächenkarten exportiert.');
  } finally {
    // Ursprünglichen Kartenzustand vollständig wiederherstellen.
    map.zoomControl.addTo(map);
    if (currentBasemap !== savedBasemap) setBasemap(savedBasemap);
    visibleLayerIds.forEach(id => layers[id] && layers[id].leafletLayer.addTo(map));
    map.setView(savedCenter, savedZoom);
    tab.restore();
    btn.disabled = false;
  }
}

document.getElementById('btn-export-flaechenkarten').addEventListener('click', exportFlaechenkarten);

// ---------- Flächenzeichner ----------
// Eigener Tab: Parzellen direkt auf der Karte zeichnen (Leaflet.draw) statt
// aus einem Shapefile zu laden. Größe wird per turf.area() aus der
// gezeichneten Geometrie berechnet, Name/Kulturart sind optional frei
// eintragbar, Export nutzt dieselbe Flächenkarten-PDF-Logik wie der Viewer.
let zeichnerMap = null;
let zeichnerBasemaps = null;
let currentZeichnerBasemap = 'osm';
let zeichnerLayerGroup = null;
const zeichnerParcels = []; // { id, nummer, name, kultur, areaHa, layer, color }
let zeichnerParcelCounter = 0;
let zeichnerColorIdx = 0;

function initZeichnerMap() {
  if (zeichnerMap) return;
  zeichnerMap = L.map('zeichner-map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);
  zeichnerBasemaps = createBasemaps();
  zeichnerBasemaps.osm.addTo(zeichnerMap);
  zeichnerLayerGroup = L.featureGroup().addTo(zeichnerMap);

  document.getElementById('zeichner-btn-basemap').addEventListener('click', () => {
    zeichnerBasemaps[currentZeichnerBasemap].remove();
    const nextIdx = (basemapOrder.indexOf(currentZeichnerBasemap) + 1) % basemapOrder.length;
    currentZeichnerBasemap = basemapOrder[nextIdx];
    zeichnerBasemaps[currentZeichnerBasemap].addTo(zeichnerMap);
    document.getElementById('zeichner-btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentZeichnerBasemap];
  });

  const drawBtn = document.getElementById('btn-zeichner-draw');
  if (typeof L.Draw === 'undefined') {
    drawBtn.disabled = true;
    showZeichnerError('Zeichenwerkzeug nicht verfügbar (Leaflet.draw konnte nicht geladen werden).');
    return;
  }

  const drawPolygon = new L.Draw.Polygon(zeichnerMap, {
    shapeOptions: { color: '#8CB26B', weight: 1.8, fillColor: '#8CB26B', fillOpacity: 0.22 },
    showArea: true,
    metric: true,
    allowIntersection: false
  });
  drawBtn.addEventListener('click', () => drawPolygon.enable());

  zeichnerMap.on(L.Draw.Event.DRAWSTART, () => {
    drawBtn.classList.add('active');
    drawBtn.textContent = 'Zeichnen läuft … (Esc zum Abbrechen)';
  });
  zeichnerMap.on(L.Draw.Event.DRAWSTOP, () => {
    drawBtn.classList.remove('active');
    drawBtn.textContent = 'Fläche zeichnen';
  });

  zeichnerMap.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    zeichnerLayerGroup.addLayer(layer);

    const areaHa = turf.area(layer.toGeoJSON()) / 10000;
    const color = COLORS[zeichnerColorIdx % COLORS.length];
    zeichnerColorIdx++;
    layer.setStyle({ color, weight: 1.6, fillColor: color, fillOpacity: 0.22 });

    zeichnerParcelCounter++;
    const entry = {
      id: 'parcel-' + zeichnerParcelCounter,
      nummer: zeichnerParcelCounter,
      name: '',
      kultur: '',
      areaHa,
      layer,
      color
    };
    zeichnerParcels.push(entry);
    layer.on('click', () => zoomToParcel(entry.id));
    renderParcelList();
    setZeichnerStatus(`Fläche ${entry.nummer} gezeichnet (${areaHa.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha).`);
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
  const p = zeichnerParcels.find(x => x.id === id);
  if (!p) return;
  const bounds = p.layer.getBounds();
  if (bounds.isValid()) zeichnerMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
}

function removeParcel(id) {
  const idx = zeichnerParcels.findIndex(x => x.id === id);
  if (idx === -1) return;
  zeichnerLayerGroup.removeLayer(zeichnerParcels[idx].layer);
  zeichnerParcels.splice(idx, 1);
  renderParcelList();
}

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
        <input class="parcel-name" data-id="${p.id}" placeholder="Flächenname (optional)" value="${escapeHtml(p.name)}">
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
      if (p) p.name = input.value;
    });
  });
  list.querySelectorAll('.parcel-kultur').forEach(input => {
    input.addEventListener('input', () => {
      const p = zeichnerParcels.find(x => x.id === input.getAttribute('data-id'));
      if (p) p.kultur = input.value;
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

async function exportZeichnerFlaechenkarten() {
  if (typeof html2canvas === 'undefined') { showZeichnerError('Flächenkarten-Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showZeichnerError('Flächenkarten-Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!zeichnerParcels.length) { showZeichnerError('Noch keine Fläche gezeichnet.'); return; }

  const btn = document.getElementById('btn-export-zeichner-flaechenkarten');
  btn.disabled = true;

  const tab = ensureTabActive('zeichner');
  const savedCenter = zeichnerMap.getCenter();
  const savedZoom = zeichnerMap.getZoom();
  const savedBasemap = currentZeichnerBasemap;

  zeichnerMap.removeLayer(zeichnerLayerGroup);
  if (currentZeichnerBasemap !== 'satellite') {
    zeichnerBasemaps[currentZeichnerBasemap].remove();
    currentZeichnerBasemap = 'satellite';
    zeichnerBasemaps.satellite.addTo(zeichnerMap);
    document.getElementById('zeichner-btn-basemap').textContent = 'Basiskarte: ' + basemapLabels.satellite;
  }
  zeichnerMap.removeControl(zeichnerMap.zoomControl);

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
        canvas = await captureParcelScreenshot(zeichnerMap, zeichnerBasemaps.satellite, 'zeichner-map', p.layer.toGeoJSON());
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für', p.nummer, err);
        showZeichnerError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        break;
      }

      if (i > 0) doc.addPage('a4', 'landscape');
      addFlaechenkartePage(doc, pageW, pageH, margin, canvas, {
        nummer: p.nummer,
        featName: p.name,
        groesse: String(p.areaHa),
        kultur: p.kultur,
        flaechenId: ''
      });
    }

    const ts = new Date().toISOString().slice(0, 10);
    doc.save(`flaechenkarten_gezeichnet_${ts}.pdf`);
    setZeichnerStatus('Flächenkarten exportiert.');
  } finally {
    zeichnerMap.zoomControl.addTo(zeichnerMap);
    if (currentZeichnerBasemap !== savedBasemap) {
      zeichnerBasemaps[currentZeichnerBasemap].remove();
      currentZeichnerBasemap = savedBasemap;
      zeichnerBasemaps[currentZeichnerBasemap].addTo(zeichnerMap);
      document.getElementById('zeichner-btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentZeichnerBasemap];
    }
    zeichnerLayerGroup.addTo(zeichnerMap);
    zeichnerMap.setView(savedCenter, savedZoom);
    tab.restore();
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
  { key: 'mispel', label: 'Mispel', color: '#7C6A4E' },
  { key: 'sonstige', label: 'Sonstige/Unbekannt', color: '#6B7280' }
];
const FRUIT_TYPES = [...FRUIT_TYPES_TOP6, ...FRUIT_TYPES_SONSTIGE];
const FRUIT_BY_KEY = Object.fromEntries(FRUIT_TYPES.map(f => [f.key, f]));
function fruitOf(key) { return FRUIT_BY_KEY[key] || { key, label: key, color: '#6B7280' }; }

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
let obstbaumMap = null;
let obstbaumBasemaps = null;
let currentObstbaumBasemap = 'osm';
let obstbaumLayerGroup = null;
let obstbaumTablePanel = null;
const obstbaumTrees = []; // { id, nummer, art, latlng, marker }
let obstbaumTreeCounter = 0;
let activeFruitKey = null;

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
  document.querySelectorAll('.fruit-btn, .fruit-list-row').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-key') === activeFruitKey);
  });
  document.getElementById('obstbaum-map').classList.toggle('placing', !!activeFruitKey);
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
  const entry = { id: 'baum-' + obstbaumTreeCounter, nummer: obstbaumTreeCounter, art: key, latlng, marker: null };

  const marker = L.marker(latlng, { icon: createTreeIcon(fruit.color), draggable: true });
  marker.bindTooltip(fruit.label, { direction: 'top', offset: [0, -10] });
  marker.on('click', (e) => { L.DomEvent.stopPropagation(e); zoomToTree(entry.id); });
  marker.on('dragend', () => { entry.latlng = marker.getLatLng(); });
  marker.addTo(obstbaumLayerGroup);
  entry.marker = marker;

  obstbaumTrees.push(entry);
  renderObstbaumSummary();
  renderObstbaumTable();
  setObstbaumStatus(`${fruit.label} gesetzt (${obstbaumTrees.length} insgesamt).`);
  return entry;
}

function removeTree(id) {
  const idx = obstbaumTrees.findIndex(t => t.id === id);
  if (idx === -1) return;
  obstbaumLayerGroup.removeLayer(obstbaumTrees[idx].marker);
  obstbaumTrees.splice(idx, 1);
  renderObstbaumSummary();
  renderObstbaumTable();
}

function zoomToTree(id) {
  const t = obstbaumTrees.find(x => x.id === id);
  if (!t) return;
  obstbaumMap.setView(t.latlng, Math.max(obstbaumMap.getZoom(), 18));
}

function fitObstbaumTrees() {
  if (!obstbaumTrees.length) return;
  const bounds = L.latLngBounds(obstbaumTrees.map(t => t.latlng));
  if (bounds.isValid()) obstbaumMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
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
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--muted); padding:14px;">Noch keine Bäume erfasst.</td></tr>';
    return;
  }
  tbody.innerHTML = obstbaumTrees.map(t => `<tr data-id="${t.id}">
      <td>${t.nummer}</td>
      <td>${fruitChipHtml(t.art)}</td>
      <td><button data-id="${t.id}" data-action="remove" class="table-remove-btn">Entfernen</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="remove"]')) return;
      zoomToTree(tr.getAttribute('data-id'));
    });
  });
  tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTree(btn.getAttribute('data-id'));
    });
  });
}

function initObstbaumMap() {
  if (obstbaumMap) return;
  obstbaumMap = L.map('obstbaum-map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);
  obstbaumBasemaps = createBasemaps();
  obstbaumBasemaps.osm.addTo(obstbaumMap);

  document.getElementById('obstbaum-btn-basemap').addEventListener('click', () => {
    obstbaumBasemaps[currentObstbaumBasemap].remove();
    const nextIdx = (basemapOrder.indexOf(currentObstbaumBasemap) + 1) % basemapOrder.length;
    currentObstbaumBasemap = basemapOrder[nextIdx];
    obstbaumBasemaps[currentObstbaumBasemap].addTo(obstbaumMap);
    document.getElementById('obstbaum-btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentObstbaumBasemap];
  });

  obstbaumLayerGroup = L.featureGroup().addTo(obstbaumMap);

  obstbaumMap.on('click', (e) => {
    if (!activeFruitKey) return;
    addTree(activeFruitKey, e.latlng);
  });

  obstbaumTablePanel = initResizablePanel({
    panel: document.getElementById('obstbaum-table-panel'),
    handle: document.getElementById('obstbaum-table-resize-handle'),
    minimizeBtn: document.getElementById('obstbaum-table-minimize'),
    closeBtn: document.getElementById('obstbaum-table-close'),
    boundsWrap: document.getElementById('obstbaum-map-wrap'),
    minHeight: TABLE_MIN_HEIGHT,
    defaultHeight: TABLE_DEFAULT_HEIGHT
  });
  document.getElementById('btn-obstbaum-table').addEventListener('click', () => {
    renderObstbaumTable();
    renderObstbaumSummary();
    obstbaumTablePanel.open();
  });
}

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
  const replacement = FRUIT_TYPES.map(f => f.key).find(k => k !== draggedKey && !favoriteFruitKeys.includes(k));
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
    btn.innerHTML = `<span class="fruit-dot" style="background:${fruit.color}"></span>${escapeHtml(fruit.label)}`;
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
  FRUIT_TYPES
    .filter(f => !favoriteFruitKeys.includes(f.key))
    .forEach(fruit => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'fruit-list-row';
      row.setAttribute('data-key', fruit.key);
      row.innerHTML = `<span class="fruit-dot" style="background:${fruit.color}"></span>${escapeHtml(fruit.label)}`;
      row.classList.toggle('active', fruit.key === activeFruitKey);
      row.addEventListener('click', () => setActiveFruitKey(fruit.key));
      makeFruitDraggable(row, fruit.key);
      list.appendChild(row);
    });
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
sonstigeToggle.addEventListener('click', () => {
  const willOpen = sonstigeList.hidden;
  sonstigeList.hidden = !willOpen;
  sonstigeToggle.classList.toggle('open', willOpen);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeFruitKey) setActiveFruitKey(null);
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
    let added = 0;
    features.forEach(f => {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      const [lng, lat] = f.geometry.coordinates;
      if (!isFinite(lat) || !isFinite(lng)) return;
      const props = f.properties || {};
      const key = FRUIT_BY_KEY[props.art] ? props.art : 'sonstige';
      addTree(key, L.latLng(lat, lng));
      added++;
    });
    document.getElementById('obstbaum-file-name').textContent = file.name;
    document.getElementById('obstbaum-drop').classList.add('filled');
    setObstbaumStatus(`${added} Baum/Bäume aus ${file.name} geladen.`);
    if (added) fitObstbaumTrees();
  } catch (err) {
    console.error(err);
    showObstbaumError(file.name + ': Konnte Kataster nicht lesen — ' + (err.message || 'unbekannter Fehler'));
  }
}
document.getElementById('obstbaum-file-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadBaumkatasterFile(e.target.files[0]);
});

function exportBaumkataster() {
  if (!obstbaumTrees.length) { showObstbaumError('Noch keine Bäume erfasst.'); return; }
  const fc = {
    type: 'FeatureCollection',
    features: obstbaumTrees.map(t => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.latlng.lng, t.latlng.lat] },
      properties: { nummer: t.nummer, art: t.art, label: fruitOf(t.art).label }
    }))
  };
  const ts = new Date().toISOString().slice(0, 10);
  downloadBlob(JSON.stringify(fc, null, 2), `baumkataster_${ts}.geojson`, 'application/geo+json');
  setObstbaumStatus('Baumkataster gespeichert.');
}
document.getElementById('btn-export-baumkataster').addEventListener('click', exportBaumkataster);

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

async function exportObstbaumFlaechenkarten() {
  if (typeof html2canvas === 'undefined') { showObstbaumError('Export nicht verfügbar (html2canvas konnte nicht geladen werden).'); return; }
  if (typeof window.jspdf === 'undefined') { showObstbaumError('Export nicht verfügbar (jsPDF konnte nicht geladen werden).'); return; }
  if (!obstbaumTrees.length) { showObstbaumError('Noch keine Bäume erfasst.'); return; }

  const btn = document.getElementById('btn-export-obstbaum-flaechenkarten');
  btn.disabled = true;

  const tab = ensureTabActive('obstbaum');
  const savedCenter = obstbaumMap.getCenter();
  const savedZoom = obstbaumMap.getZoom();
  const savedBasemap = currentObstbaumBasemap;

  if (currentObstbaumBasemap !== 'satellite') {
    obstbaumBasemaps[currentObstbaumBasemap].remove();
    currentObstbaumBasemap = 'satellite';
    obstbaumBasemaps.satellite.addTo(obstbaumMap);
    document.getElementById('obstbaum-btn-basemap').textContent = 'Basiskarte: ' + basemapLabels.satellite;
  }
  obstbaumMap.removeControl(obstbaumMap.zoomControl);

  const clusters = clusterTrees(obstbaumTrees, 120);
  const grandTotal = new Map();

  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  try {
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      setObstbaumStatus(`Exportiere Flächenkarten … (${i + 1}/${clusters.length})`);

      const bounds = L.latLngBounds(cluster.map(t => t.latlng));
      obstbaumMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 19 });

      await waitForTilesLoaded(obstbaumBasemaps.satellite, 6000);
      await delay(400);

      let canvas;
      try {
        canvas = await html2canvas(document.getElementById('obstbaum-map'), { useCORS: true, logging: false });
      } catch (err) {
        console.error('Kartenbild-Erfassung fehlgeschlagen für Gruppe', i + 1, err);
        showObstbaumError('Kartenbild konnte nicht erfasst werden (evtl. CORS-Einschränkung der Kachel-Quelle).');
        break;
      }

      if (i > 0) doc.addPage('a4', 'landscape');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(`Gruppe ${i + 1} (${cluster.length} Baum/Bäume)`, margin, margin + 4);

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

    const ts = new Date().toISOString().slice(0, 10);
    doc.save(`obstbaumkataster_flaechenkarten_${ts}.pdf`);
    setObstbaumStatus('Flächenkarten exportiert.');
  } finally {
    obstbaumMap.zoomControl.addTo(obstbaumMap);
    if (currentObstbaumBasemap !== savedBasemap) {
      obstbaumBasemaps[currentObstbaumBasemap].remove();
      currentObstbaumBasemap = savedBasemap;
      obstbaumBasemaps[currentObstbaumBasemap].addTo(obstbaumMap);
      document.getElementById('obstbaum-btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentObstbaumBasemap];
    }
    obstbaumMap.setView(savedCenter, savedZoom);
    tab.restore();
    btn.disabled = false;
  }
}

document.getElementById('btn-export-obstbaum-flaechenkarten').addEventListener('click', exportObstbaumFlaechenkarten);

// ---------- Dev-Tooling: Jahresvergleich-Inputs aus test-shapes/ vorbefüllen ----------
// Vorerst deaktiviert: test-shapes/ enthält jetzt 16 einzelne Bundesland-
// Dateien statt eines Jahr-A/B-Paares, dev-prefill.js braucht ein Update auf
// ein aktuelles Dateipaar, bevor das wieder sinnvoll aktiviert werden kann.
// if (import.meta.env.DEV) {
//   import('./dev-prefill.js').then(m => m.prefillCompareInputs());
// }
