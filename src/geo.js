// Geometrie-Funktionen (Turf 7, per npm mitgebaut).
//
// Früher kam Turf 6.5 als fertiges Skript von cdnjs. Das erzeugt beim Laden
// Code zur Laufzeit (new Function) — mit einer strengen Content-Security-Policy
// ohne 'unsafe-eval' ist das verboten. Turf 7 kommt ohne aus.
//
// Die App ruft weiter `turf.union(a, b)`, `turf.difference(a, b)` und
// `turf.intersect(a, b)` mit zwei Flächen auf (Schreibweise von Turf 6.5);
// Turf 7 erwartet dafür eine FeatureCollection. Dieses Modul übersetzt das,
// damit die Aufrufstellen unverändert bleiben. Nur die tatsächlich genutzten
// Funktionen sind enthalten — eine neue hier ergänzen.
import {
  area, bbox, bearing, booleanPointInPolygon, destination, distance, length,
  multiPolygon, point, polygon, polygonToLine, featureCollection,
  union as union7, difference as difference7, intersect as intersect7
} from '@turf/turf';

// Geometrie (Polygon/MultiPolygon) oder Feature -> Feature
const alsFeature = (g) => (g && g.type === 'Feature' ? g : { type: 'Feature', properties: {}, geometry: g });
const paar = (a, b) => featureCollection([alsFeature(a), alsFeature(b)]);

export const turf = {
  area, bbox, bearing, booleanPointInPolygon, destination, distance, length,
  multiPolygon, point, polygon, polygonToLine,
  union: (a, b, options) => union7(paar(a, b), options),
  difference: (a, b) => difference7(paar(a, b)),
  intersect: (a, b, options) => intersect7(paar(a, b), options)
};
