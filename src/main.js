const COLORS = ['#4FB8AF', '#D97757', '#8AA6D9', '#C9A24F', '#B287D9', '#6FBF73', '#E08FA8', '#5FA8C4'];
let colorIdx = 0;
const layers = {}; // id -> { name, geojson, leafletLayer, color, visible }
let layerCounter = 0;
const featureIndex = []; // flat list of every feature across all layers, for the table view
let highlightedEntry = null;

// Deine Shapefiles benennen die relevanten Attribute unterschiedlich
// (z.B. NUMMER/NAME/FLAECHE/NUTZ_BEZ bei Parzellen, NUMMER/FLAECHE/CODE_BEZ bei
// Teilflächen). Wir suchen daher pro Spalte eine Liste plausibler Feldnamen ab,
// statt einen festen Namen vorauszusetzen — das funktioniert auch für andere
// hochgeladene Shapefiles mit leicht abweichender Benennung.
const FIELD_CANDIDATES = {
  nummer: ['NUMMER', 'SCHLAG_NR', 'SCHLAGNR', 'FLIK_FLEK', 'FLIK', 'ID', 'NR'],
  name: ['NAME', 'BEZEICHNUNG', 'FLAECHENNAME', 'SCHLAGNAME'],
  groesse: ['FLAECHE', 'AKTFLAECHE', 'FLAECHE_HA', 'GROESSE', 'AREA'],
  kultur: ['NUTZ_BEZ', 'CODE_BEZ', 'KULTURART', 'FRUCHTART', 'NUTZUNG']
};

function pickField(props, candidates) {
  for (const key of candidates) {
    const v = props[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([51.16, 10.45], 6);

const basemaps = {
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
    maxZoom: 19
  })
};
const basemapLabels = { osm: 'Standard', topo: 'Topografisch', satellite: 'Satellit' };
const basemapOrder = ['osm', 'topo', 'satellite'];
let currentBasemap = 'osm';
basemaps.osm.addTo(map);

document.getElementById('btn-basemap').addEventListener('click', () => {
  basemaps[currentBasemap].remove();
  const nextIdx = (basemapOrder.indexOf(currentBasemap) + 1) % basemapOrder.length;
  currentBasemap = basemapOrder[nextIdx];
  basemaps[currentBasemap].addTo(map);
  document.getElementById('btn-basemap').textContent = 'Basiskarte: ' + basemapLabels[currentBasemap];
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
        const results = await parseShapefileZip(file);
        if (!results.length) {
          showError(file.name + ': Keine Shapefile-Bestandteile (.shp/.dbf) im Zip gefunden.');
          setStatus('Nichts Lesbares in ' + file.name);
          continue;
        }
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

// Entpackt ein Zip selbst (statt es blind an shp() zu übergeben) und gruppiert
// die enthaltenen Dateien anhand ihres gemeinsamen Basisnamens. So werden
// mehrere Shapefiles in einem Bundle sauber getrennt, fremde Dateien (z.B.
// .xlsx, .xml) werden ignoriert. Die Umprojektion nach WGS84 erfolgt explizit
// über proj4 anhand der jeweiligen .prj-Datei — nicht über das (unklar
// dokumentierte) automatische Verhalten von shp.parseShp().
async function parseShapefileZip(file) {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const groups = {};
  const relevantExt = ['shp', 'shx', 'dbf', 'prj', 'cpg'];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const fileName = path.split('/').pop();
    const dot = fileName.lastIndexOf('.');
    if (dot === -1) return;
    const base = fileName.slice(0, dot);
    const ext = fileName.slice(dot + 1).toLowerCase();
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
          const converter = proj4(prjText.trim(), 'WGS84');
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
        const cpgText = g.cpg ? (await g.cpg.async('text')).trim() : 'windows-1252';
        properties = shp.parseDbf(dbfBuf, cpgText);
      }

      const fc = shp.combine([geometries, properties]);
      results.push({ name: base, fc });
    } catch (err) {
      console.error('Fehler in Ebene', base, err);
      showError(base + ': Ebene konnte nicht gelesen werden — ' + (err.message || 'unbekannter Fehler'));
    }
  }
  return results;
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
        groesse: pickField(props, FIELD_CANDIDATES.groesse),
        kultur: pickField(props, FIELD_CANDIDATES.kultur)
      };
      featureIndex.push(entry);
      lyr.on('click', () => {
        highlightFeature(entry);
        selectFeatureInTable(entry);
      });
    }
  });
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
          <svg viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="#4FB8AF" stroke-width="1.6" fill="none"/></svg>
        </div>
        <div class="swatch" style="background:${l.color}"></div>
        <div class="layer-name" title="${l.name}">${l.name}</div>
        <div class="layer-count">${l.count}</div>
      </div>
      <div class="layer-actions">
        <button data-id="${id}" data-action="zoom">Zoom</button>
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
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted); padding:14px;">' +
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
  tablePanelEl.classList.remove('minimized');
  tablePanelEl.style.height = tableLastExpandedHeight + 'px';
  document.getElementById('table-minimize').textContent = '▁';
  tablePanelEl.classList.add('open');
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

const tablePanelEl = document.getElementById('table-panel');
const TABLE_DEFAULT_HEIGHT = 320;
const TABLE_MIN_HEIGHT = 140;
let tableLastExpandedHeight = TABLE_DEFAULT_HEIGHT;

document.getElementById('btn-table').addEventListener('click', () => {
  renderFeatureTable();
  tablePanelEl.classList.remove('minimized');
  tablePanelEl.style.height = tableLastExpandedHeight + 'px';
  document.getElementById('table-minimize').textContent = '▁';
  tablePanelEl.classList.add('open');
});
document.getElementById('table-close').addEventListener('click', () => {
  tablePanelEl.classList.remove('open');
});

document.getElementById('table-minimize').addEventListener('click', () => {
  const minimizing = !tablePanelEl.classList.contains('minimized');
  if (minimizing) {
    tableLastExpandedHeight = tablePanelEl.getBoundingClientRect().height;
    tablePanelEl.classList.add('minimized');
    document.getElementById('table-minimize').textContent = '▲';
  } else {
    tablePanelEl.classList.remove('minimized');
    tablePanelEl.style.height = tableLastExpandedHeight + 'px';
    document.getElementById('table-minimize').textContent = '▁';
  }
});

// Ziehgriff zum Größenändern (Maus + Touch)
(function setupTableResize() {
  const handle = document.getElementById('table-resize-handle');
  let dragging = false;

  function startDrag(e) {
    if (tablePanelEl.classList.contains('minimized')) return;
    dragging = true;
    tablePanelEl.classList.add('dragging');
    e.preventDefault();
  }
  function moveDrag(clientY) {
    if (!dragging) return;
    const wrapRect = document.getElementById('map-wrap').getBoundingClientRect();
    const maxHeight = wrapRect.height * 0.85;
    let newHeight = wrapRect.bottom - clientY;
    newHeight = Math.max(TABLE_MIN_HEIGHT, Math.min(maxHeight, newHeight));
    tablePanelEl.style.height = newHeight + 'px';
    tableLastExpandedHeight = newHeight;
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    tablePanelEl.classList.remove('dragging');
  }

  handle.addEventListener('mousedown', startDrag);
  window.addEventListener('mousemove', (e) => moveDrag(e.clientY));
  window.addEventListener('mouseup', endDrag);

  handle.addEventListener('touchstart', (e) => startDrag(e), { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (dragging && e.touches[0]) moveDrag(e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener('touchend', endDrag);
})();

// ---------- Standort (GPS) ----------
let locationMarker = null;
let locationCircle = null;
let watchingLocation = false;

function onLocationFound(e) {
  const radius = e.accuracy / 2;
  if (!locationMarker) {
    locationMarker = L.circleMarker(e.latlng, {
      radius: 7, color: '#ffffff', weight: 2, fillColor: '#4FB8AF', fillOpacity: 1
    }).addTo(map);
    locationCircle = L.circle(e.latlng, {
      radius, color: '#4FB8AF', weight: 1, fillColor: '#4FB8AF', fillOpacity: 0.12
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
  btn.textContent = '📍 Mein Standort';
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
  btn.textContent = '📍 Standort wird verfolgt…';
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
    if (target === 'compare') {
      initCompareMap();
      setTimeout(() => compareMap && compareMap.invalidateSize(), 50);
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
  compareBasemaps = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende', maxZoom: 19
    }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap-Mitwirkende, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>', maxZoom: 17
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri', maxZoom: 19
    })
  };
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

function showCompareError(msg) {
  const el = document.getElementById('compare-error-toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showCompareError._t);
  showCompareError._t = setTimeout(() => el.style.display = 'none', 7000);
}

async function loadCompareFile(file, slot) {
  try {
    const results = await parseShapefileZip(file);
    if (!results.length) {
      showCompareError(file.name + ': Keine Shapefile-Bestandteile gefunden.');
      return;
    }
    // Für den Vergleich zählt nur die Parzellen-Ebene — Teilflächen o.ä. werden ignoriert.
    let chosen = results.find(r => /parzelle/i.test(r.name));
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
    const groesseA = fA ? pickField(propsA, FIELD_CANDIDATES.groesse) : '';
    const groesseB = fB ? pickField(propsB, FIELD_CANDIDATES.groesse) : '';
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
function addFeatureLabel(feature, text, group) {
  if (!feature) return;
  let latlng;
  try {
    latlng = L.geoJSON(feature).getBounds().getCenter();
  } catch (err) {
    return;
  }
  const anchor = L.circleMarker(latlng, { radius: 0, opacity: 0, fillOpacity: 0, interactive: false });
  anchor.bindTooltip(text, { permanent: true, direction: 'center', className: 'compare-feature-label' });
  anchor.addTo(group);
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
  const headers = ['Schlagnr./Flächennr.', 'Flächenname', 'Größe (ha)', 'Kulturart', 'Ebene'];
  const data = rows.map(e => {
    const n = parseFloat(String(e.groesse).replace(',', '.'));
    const groesseText = isFinite(n) ? n.toFixed(2) : (e.groesse || '');
    return [e.nummer || '', e.featName || '', groesseText, e.kultur || '', e.layerName || ''];
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

// ---------- Dev-Tooling: Jahresvergleich-Inputs aus test-shapes/ vorbefüllen ----------
if (import.meta.env.DEV) {
  import('./dev-prefill.js').then(m => m.prefillCompareInputs());
}
