// ---------- Referenzwerte für Warenflussprüfungen (Ökolandbau) ----------
// Jeder Wert trägt eine Quelle (WF_QUELLEN). Ist nur ein Mittelwert belegt
// (z. B. LfL-Kalkulationsdaten), steht er als "typ" — die Plausibilität
// ergibt sich dann aus der in der Prüfung eingestellten Toleranz. Spannen
// (min/max) nur dort, wo eine Quelle sie nennt. Werte ohne eigene Quelle sind
// als annahme: true markiert und in der App entsprechend gekennzeichnet.
// Alle Werte sind in jeder Prüfung überschreibbar (Standort, Sorte, Jahr).
//
// Stand der Recherche: 01.10.2026.

export const WF_QUELLEN = {
  lfl: {
    kurz: 'LfL Bayern 2026',
    titel: 'LfL Bayern – Deckungsbeiträge und Kalkulationsdaten, Ökologischer Landbau (Stand 29.09.2026; Erträge: Mittel 2023–2025, TUM Lehrstuhl Ökologischer Landbau)',
    url: 'https://www.stmelf.bayern.de/idb/oekowinterweizen.html'
  },
  oekolandbau: {
    kurz: 'oekolandbau.de',
    titel: 'Ökolandbau.de (BLE) – Bio-Anbausteckbriefe (Saatstärken)',
    url: 'https://www.oekolandbau.de/bio-in-der-praxis/oekologische-landwirtschaft/oekologischer-pflanzenbau/bio-anbausteckbriefe/'
  },
  sachsenKartoffel: {
    kurz: 'LfULG Sachsen',
    titel: 'LfULG Sachsen – Kartoffeln im Ökolandbau (Pflanzgut ca. 2.500 kg/ha bei 40.000 Knollen/ha, Sortierung 35/55)',
    url: 'https://publikationen.sachsen.de/bdb/artikel/11917/documents/14821'
  },
  bzlEier: {
    kurz: 'BZL 2024',
    titel: 'BZL / landwirtschaft.de – Legeleistung je Henne (Bio-Henne Ø 290 Eier/Jahr, 2024)',
    url: 'https://www.landwirtschaft.de/infothek/landwirtschaft-in-zahlen/tier/wie-viele-eier-legt-eine-legehenne-pro-jahr'
  },
  thuenenHenne: {
    kurz: 'Thünen',
    titel: 'Thünen-Institut – Legehennenfütterung im Ökolandbau (Ø 116 g Futter je Henne und Tag)',
    url: 'https://literatur.thuenen.de/digbib_extern/dk041076.pdf'
  },
  oekolandbauBroiler: {
    kurz: 'oekolandbau.de',
    titel: 'Ökolandbau.de – Bio-Hähnchenmast (Futterverwertung ca. 1 : 2,4; Mindestschlachtalter 81 Tage bei schnellwachsenden Linien nach VO (EU) 2018/848)',
    url: 'https://www.oekolandbau.de/bio-in-der-praxis/oekologische-landwirtschaft/oekologische-tierhaltung/oekologische-gefluegelhaltung/bio-haehnchenmast/'
  },
  mayen: {
    kurz: 'Bieneninstitut Mayen',
    titel: 'Fachzentrum Bienen und Imkerei Mayen – Honigernte-Umfragen (Ø je Volk: 2022 34,4 kg; 2023 36,7 kg; 2024 31,6 kg)',
    url: 'https://www.bienenjournal.de/news/meldungen/so-gut-war-die-honigernte-2024/'
  },
  tllMutterkuh: {
    kurz: 'TLL Thüringen',
    titel: 'TLL – Leitlinie Mutterkuhhaltung (Ziel: ≥ 0,95 abgesetzte Kälber je Kuh und Jahr; Absetzgewicht 250–400 kg)',
    url: 'https://www.tll.de/www/daten/publikationen/leitlinien/ll_mkh.pdf'
  },
  dinkel: {
    kurz: 'LTZ / Saaten-Union',
    titel: 'LTZ Augustenberg / Saaten-Union – Dinkel: Kernausbeute beim Entspelzen ca. 65–70 % (Öko-Dinkel 58–65 %)',
    url: 'https://ltz.landwirtschaft-bw.de/,Lde/Startseite/Kulturpflanzen/Dinkel'
  },
  mehl: {
    kurz: 'DIN 10355',
    titel: 'Ausmahlungsgrad nach Mehltype (DIN 10355): Type 405 40–56 %, Type 550 64–71 %, Type 1050 82–85 %, Vollkorn 100 %',
    url: 'https://de.wikipedia.org/wiki/Ausmahlungsgrad'
  },
  saft: {
    kurz: 'Mostereien',
    titel: 'Lohnmostereien – Saftausbeute Äpfel ca. 60–80 l je 100 kg (sorten- und reifeabhängig)',
    url: 'https://www.mobile-obstverarbeitung.de/fragen-und-antworten/'
  },
  oel: {
    kurz: 'Rapsöl',
    titel: 'Rapsöl – Ölgehalt der Saat 40–45 %, Ausbeute bei Kaltpressung ca. ein Drittel der Saatmasse',
    url: 'https://de.wikipedia.org/wiki/Raps%C3%B6l'
  },
  molkerei: {
    kurz: 'Faustzahlen Molkerei',
    titel: 'Faustzahlen Milchverarbeitung – je kg Produkt: Schnittkäse ca. 10 l, Hartkäse 13–15 l, Butter 20–25 l, Quark ca. 4 kg, Joghurt ca. 1 l, Sahne ca. 7 l Milch',
    url: 'https://milchland.de/wp-content/uploads/2020/08/M_Chart_8.pdf'
  },
  annahme: {
    kurz: 'Annahme',
    titel: 'Annahme ohne eigene Quelle — bitte mit Sorten-/Betriebsangaben abgleichen und ggf. überschreiben',
    url: ''
  }
};

// ---- Pflanzenbau ----
// ertrag: dt/ha (Hauptprodukt). saat: Saatgutbedarf kg/ha — aus Saatstärke
// (Körner/m²) × TKM (g) / 100; die Saatstärke ist belegt, die TKM meist eine
// Annahme (sortenabhängig!).
const saatKgHa = (kMin, kMax, tkm) => ({
  min: kMin != null ? Math.round(kMin * tkm / 100) : null,
  max: kMax != null ? Math.round(kMax * tkm / 100) : null,
  typ: Math.round(((kMin + (kMax ?? kMin)) / 2) * tkm / 100)
});
export const WF_KULTUREN = [
  { key: 'winterweizen', label: 'Winterweizen', ertrag: { typ: 41.2, quelle: 'lfl' },
    saat: { ...saatKgHa(300, 450, 45), quelle: 'oekolandbau', info: '300–450 Körner/m² (oekolandbau.de) × TKM 45 g (Annahme)' } },
  { key: 'dinkel', label: 'Dinkel (Vesen)', ertrag: { typ: 35.3, quelle: 'lfl' },
    saat: { typ: null, quelle: 'oekolandbau', info: '150–200 Vesen/m² (oekolandbau.de) — TKM der Vesen sortenabhängig, Bedarf bitte eintragen' } },
  { key: 'winterroggen', label: 'Winterroggen', ertrag: { typ: 33.1, quelle: 'lfl' },
    saat: { ...saatKgHa(200, 300, 35), quelle: 'oekolandbau', info: '200–300 Körner/m² (oekolandbau.de) × TKM 35 g (Annahme)' } },
  { key: 'wintertriticale', label: 'Wintertriticale', ertrag: { typ: 40.6, quelle: 'lfl' }, saat: null },
  { key: 'wintergerste', label: 'Wintergerste', ertrag: { typ: 38.9, quelle: 'lfl' }, saat: null },
  { key: 'sommergerste', label: 'Sommergerste', ertrag: { typ: 33.9, quelle: 'lfl' }, saat: null },
  { key: 'hafer', label: 'Hafer', ertrag: { typ: 34.2, quelle: 'lfl' },
    saat: { ...saatKgHa(300, 380, 35), quelle: 'oekolandbau', info: '300–380 Körner/m² (oekolandbau.de) × TKM 35 g (Annahme)' } },
  { key: 'koernermais', label: 'Körnermais (14 % Feuchte)', ertrag: { typ: 64.3, quelle: 'lfl' }, saat: null },
  { key: 'ackerbohne', label: 'Ackerbohne', ertrag: { typ: 19.6, quelle: 'lfl' },
    saat: { ...saatKgHa(35, 45, 500), quelle: 'oekolandbau', info: '35–45 keimf. Körner/m² (oekolandbau.de) × TKM 500 g (Annahme)' } },
  { key: 'futtererbse', label: 'Futtererbse', ertrag: { typ: 20.0, quelle: 'lfl' },
    saat: { min: Math.round(60 * 250 / 100), max: null, typ: Math.round(70 * 250 / 100), quelle: 'oekolandbau', info: '≥ 60 keimf. Körner/m² (oekolandbau.de) × TKM 250 g (Annahme)' } },
  { key: 'sojabohne', label: 'Sojabohne', ertrag: { typ: 30.3, quelle: 'lfl' }, saat: null },
  { key: 'lupine', label: 'Blaue Lupine', ertrag: { typ: 17.1, quelle: 'lfl' }, saat: null },
  { key: 'sonnenblume', label: 'Sonnenblume', ertrag: { typ: 19.1, quelle: 'lfl' }, saat: null },
  { key: 'speisekartoffel', label: 'Speisekartoffeln', ertrag: { typ: 240.4, quelle: 'lfl' },
    saat: { min: 2500, max: 2800, typ: 2650, quelle: 'sachsenKartoffel', info: 'Pflanzgut ca. 25 dt/ha (LfULG Sachsen) bis 28 dt/ha (LfL Bayern)' } },
  { key: 'grassilage', label: 'Grassilage (dt TM)', ertrag: { typ: 59.8, quelle: 'lfl', einheit: 'dt TM/ha' }, saat: null },
  { key: 'sonstige', label: 'Sonstige Kultur', ertrag: null, saat: null }
];

// ---- Tierhaltung ----
// leistung: Produkt je Bezugsgröße und Jahr; futter: Futterbedarf je
// Bezugsgröße. basis = was als "Anzahl" eingetragen wird.
export const WF_TIERE = [
  { key: 'milchkuh', label: 'Milchkühe', basis: 'Ø Kühe',
    leistung: { label: 'Milch', einheit: 'kg je Kuh/Jahr', typ: 7049, quelle: 'lfl', info: 'Fleckvieh, 4,11 % Fett / 3,37 % Eiweiß; vermarktet ca. 6.503 kg' },
    futter: { label: 'Kraftfutter', einheit: 'kg FM je Kuh/Jahr', typ: 1902, quelle: 'lfl', info: 'dazu ca. 5.040 kg TM Grundfutter je Kuh/Jahr' } },
  { key: 'mutterkuh', label: 'Mutterkühe', basis: 'Ø Kühe',
    leistung: { label: 'abgesetzte Kälber', einheit: 'je Kuh/Jahr', typ: 0.95, min: 0.95, quelle: 'tllMutterkuh', info: 'Zielwert; Absetzgewicht 250–400 kg' },
    futter: null },
  { key: 'mastschwein', label: 'Mastschweine', basis: 'verkaufte Mastschweine',
    leistung: { label: 'Schlachtgewicht', einheit: 'kg je Tier', typ: 102, quelle: 'lfl', info: 'Mast 29 → 132,5 kg LG, 790 g Tageszunahme, 129 Tage, 2,5 % Verluste' },
    futter: { label: 'Mastfutter', einheit: 'kg je Tier', typ: 316, quelle: 'lfl', info: 'Futterverwertung 1 : 3,1' } },
  { key: 'zuchtsau', label: 'Zuchtsauen', basis: 'Ø Sauen',
    leistung: { label: 'verkaufte Ferkel', einheit: 'je Sau/Jahr', typ: 19.3, quelle: 'lfl', info: '2,0 Würfe/Jahr, Verkaufsgewicht ca. 28 kg' },
    futter: { label: 'Futter Sau + Aufzucht', einheit: 'kg je Sau/Jahr', typ: 2203, quelle: 'lfl', info: 'Sauenfutter 1.383 kg + Ferkelaufzucht 820 kg' } },
  { key: 'legehenne', label: 'Legehennen', basis: 'Ø Hennen',
    leistung: { label: 'Eier', einheit: 'Stück je Henne/Jahr', typ: 290, quelle: 'bzlEier' },
    futter: { label: 'Legehennenfutter', einheit: 'kg je Henne/Jahr', typ: 42.3, quelle: 'thuenenHenne', info: '116 g je Tag' } },
  { key: 'masthuhn', label: 'Masthähnchen', basis: 'kg Lebendgewicht erzeugt',
    leistung: null,
    futter: { label: 'Mastfutter', einheit: 'kg je kg Zuwachs', typ: 2.4, quelle: 'oekolandbauBroiler', info: 'Mindestschlachtalter 81 Tage bei schnellwachsenden Linien' } },
  { key: 'sonstige', label: 'Sonstige Tierart', basis: 'Anzahl', leistung: null, futter: null }
];

// ---- Imkerei ----
export const WF_IMKEREI = {
  honig: { label: 'Honig', einheit: 'kg je Volk/Jahr', typ: 34.2, min: 31.6, max: 36.7, quelle: 'mayen', info: 'Bundesdurchschnitt 2022–2024 (alle Betriebsweisen); regional und jährlich stark schwankend' }
};

// ---- Verarbeitung: Ausbeute (Ausgabe je Einheit Rohware) ----
export const WF_PROZESSE = [
  { key: 'dinkel-entspelzen', label: 'Dinkel entspelzen (Vesen → Kern)', ein: 'kg Vesen', aus: 'kg Kern', typ: 0.65, min: 0.58, max: 0.70, quelle: 'dinkel' },
  { key: 'mehl-405', label: 'Weizen → Mehl Type 405', ein: 'kg Getreide', aus: 'kg Mehl', typ: 0.48, min: 0.40, max: 0.56, quelle: 'mehl' },
  { key: 'mehl-550', label: 'Weizen → Mehl Type 550', ein: 'kg Getreide', aus: 'kg Mehl', typ: 0.675, min: 0.64, max: 0.71, quelle: 'mehl' },
  { key: 'mehl-1050', label: 'Weizen → Mehl Type 1050', ein: 'kg Getreide', aus: 'kg Mehl', typ: 0.835, min: 0.82, max: 0.85, quelle: 'mehl' },
  { key: 'mehl-vollkorn', label: 'Getreide → Vollkornmehl', ein: 'kg Getreide', aus: 'kg Mehl', typ: 1.0, quelle: 'mehl' },
  { key: 'apfelsaft', label: 'Äpfel → Saft', ein: 'kg Äpfel', aus: 'l Saft', typ: 0.68, min: 0.60, max: 0.80, quelle: 'saft' },
  { key: 'rapsoel', label: 'Raps → Öl (Kaltpressung)', ein: 'kg Saat', aus: 'kg Öl', typ: 0.33, quelle: 'oel' },
  { key: 'schnittkaese', label: 'Milch → Schnittkäse', ein: 'l Milch', aus: 'kg Käse', typ: 0.10, quelle: 'molkerei' },
  { key: 'hartkaese', label: 'Milch → Hartkäse', ein: 'l Milch', aus: 'kg Käse', typ: 0.071, min: 1 / 15, max: 1 / 13, quelle: 'molkerei' },
  { key: 'butter', label: 'Milch → Butter', ein: 'l Milch', aus: 'kg Butter', typ: 0.045, min: 1 / 25, max: 1 / 20, quelle: 'molkerei' },
  { key: 'quark', label: 'Milch → Quark', ein: 'kg Milch', aus: 'kg Quark', typ: 0.25, quelle: 'molkerei' },
  { key: 'joghurt', label: 'Milch → Joghurt', ein: 'l Milch', aus: 'kg Joghurt', typ: 1.0, quelle: 'molkerei' },
  { key: 'sahne', label: 'Milch → Sahne', ein: 'l Milch', aus: 'kg Sahne', typ: 0.14, quelle: 'molkerei' },
  { key: 'sonstige', label: 'Sonstiger Prozess', ein: 'Rohware', aus: 'Produkt', typ: null, quelle: 'annahme' }
];
