// Erzeugt aus der vollen material-symbols/rounded-Variable-Font (~5,3 MB, alle
// ~3000 Icons) eine winzige, auf die tatsächlich in dieser App genutzten
// Icon-Namen zugeschnittene woff2-Datei — Material-Symbols-Icons werden über
// Ligaturen dargestellt (der Icon-Name als Text löst per OpenType-GSUB-Regel
// die Ersetzung durch das eigentliche Glyphenbild aus), subset-font/harfbuzz
// bekommt daher genau diesen Text übergeben, nicht nur eine Zeichenliste —
// sonst blieben die nötigen Ligatur-Regeln draußen und die Icons würden als
// literaler Name statt als Glyphe angezeigt.
//
// Manuell erneut ausführen (`node scripts/subset-icons.mjs`), wenn ein neuer
// Icon-Name in main.js/index.html verwendet wird, der hier noch nicht in
// ICON_NAMES steht — sonst zeigt genau dieses eine Icon nur den Rohtext.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import subsetFont from 'subset-font';

const ICON_NAMES = [
  'account_circle', 'add', 'add_box', 'arrow_back', 'arrow_downward',
  'arrow_forward', 'arrow_upward', 'attach_file', 'backspace',
  'barcode_scanner', 'business', 'cameraswitch', 'category', 'check',
  'close', 'cloud_off', 'cloud_upload', 'content_cut', 'crop', 'dark_mode',
  'delete', 'description', 'document_scanner', 'door_front', 'drag_handle',
  'drag_indicator', 'draw', 'eco', 'edit', 'egg', 'expand_less',
  'expand_more', 'fact_check', 'fit_screen', 'flashlight_on', 'grass',
  'grid_on', 'handyman', 'install_mobile', 'ios_share', 'layers',
  'light_mode', 'location_on', 'menu', 'more_horiz', 'my_location',
  'open_in_new', 'pets', 'photo_camera', 'photo_library', 'picture_as_pdf',
  'polyline', 'radio_button_checked', 'rectangle', 'redo', 'refresh',
  'restaurant', 'rotate_right', 'route', 'sticky_note_2', 'straighten',
  'undo', 'view_week', 'warning', 'water_drop', 'window'
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcFont = path.join(__dirname, '..', 'node_modules', 'material-symbols', 'material-symbols-rounded.woff2');
const outDir = path.join(__dirname, '..', 'src', 'assets');
const outFont = path.join(outDir, 'material-symbols-rounded-subset.woff2');

const buffer = await readFile(srcFont);
// Die Variable-Font-Interpolationsdaten (FILL/wght/GRAD/opsz) machen den
// Großteil der Dateigröße aus, obwohl diese App überall dieselben festen
// Werte nutzt (.icon-Basisklasse, siehe style.css) — auf genau diese eine
// Instanz fixieren statt die volle Variationsbreite mitzuschleppen bringt
// die Größe von mehreren MB auf wenige hundert KB runter.
const subsetBuffer = await subsetFont(buffer, ICON_NAMES.join(' '), {
  targetFormat: 'woff2',
  variationAxes: { FILL: 0, wght: 400, GRAD: 0, opsz: 20 }
});
await mkdir(outDir, { recursive: true });
await writeFile(outFont, subsetBuffer);

console.log(`Subset geschrieben: ${outFont}`);
console.log(`Original: ${(buffer.length / 1024).toFixed(0)} KB -> Subset: ${(subsetBuffer.length / 1024).toFixed(1)} KB (${ICON_NAMES.length} Icons)`);
