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
  'account_circle', 'account_tree', 'add', 'add_box', 'admin_panel_settings', 'arrow_back',
  'arrow_downward', 'arrow_forward', 'arrow_upward', 'assignment',
  'attach_file', 'backspace', 'balance', 'barcode_scanner', 'business',
  'calendar_month', 'calendar_view_week', 'call', 'cameraswitch', 'category',
  'check', 'chevron_left', 'chevron_right', 'close', 'cloud_done',
  'cloud_off', 'cloud_upload', 'compare', 'compare_arrows', 'content_copy', 'content_cut',
  'crop', 'crop_free', 'crop_square', 'cycle', 'dark_mode', 'dashboard', 'delete',
  'description', 'devices', 'directions', 'document_scanner', 'donut_large',
  'donut_small', 'door_front', 'download', 'drag_handle', 'drag_indicator',
  'draw', 'eco', 'edit', 'edit_note', 'egg', 'event_busy', 'event_upcoming',
  'add_circle', 'block', 'call_split', 'celebration', 'checklist', 'done_all', 'event_available', 'grid_view', 'help', 'merge', 'remove_circle',
  'expand_less', 'expand_more', 'fact_check', 'fit_screen', 'flashlight_on',
  'folder_open', 'format_color_fill', 'format_color_reset', 'grass',
  'grid_on', 'handyman', 'history', 'hive', 'home_work', 'info',
  'install_mobile', 'ios_share', 'key', 'layers', 'light_mode',
  'location_on', 'lock', 'fingerprint', 'bug_report', 'verified_user', 'timer', 'play_arrow', 'stop', 'directions_car', 'lightbulb', 'send', 'image', 'logout', 'mail', 'manage_accounts', 'map', 'menu',
  'more_horiz', 'my_location', 'open_in_full', 'open_in_new', 'palette', 'park', 'pending_actions', 'pin', 'bar_chart', 'bolt', 'folder', 'folder_zip', 'tune', 'unfold_less', 'view_list',
  'person', 'pets', 'photo_camera', 'photo_library', 'picture_as_pdf',
  'polyline', 'radio_button_checked', 'rectangle', 'redo', 'refresh',
  'restaurant', 'rotate_right', 'route', 'schedule', 'screen_rotation', 'science', 'search',
  'shield', 'space_dashboard', 'sticky_note_2', 'storefront', 'straighten', 'swap_horiz', 'sync',
  'restart_alt', 'table_view', 'task_alt', 'today', 'touch_app', 'undo', 'unfold_more',
  'upload_file', 'view_agenda', 'view_week', 'vertical_align_top', 'visibility', 'visibility_off',
  'warning', 'water_drop', 'window', 'zoom_in', 'zoom_out'
];
// Nur im Test-Design "Feldbuch" (design-feldbuch.css): Symbole passend zu
// Akte und Feldkarte, die dort per CSS an die Stelle der normalen treten.
const FELDBUCH_ICON_NAMES = [
  'explore', 'landscape', 'ink_pen', 'nature', 'cottage', 'fence',
  'inventory_2', 'agriculture', 'menu_book', 'event_note'
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

// Zweite Datei fürs Test-Design "Feldbuch": Stil "Sharp" (eckig) mit dünnem
// Strich, wirkt wie gestochen — dieselben Namen plus die Themen-Symbole. Lädt
// der Browser nur, wenn das Feldbuch-Design aktiv ist.
const sharpSrc = path.join(__dirname, '..', 'node_modules', 'material-symbols', 'material-symbols-sharp.woff2');
const sharpOut = path.join(outDir, 'material-symbols-sharp-feldbuch.woff2');
const sharpBuffer = await subsetFont(await readFile(sharpSrc), [...ICON_NAMES, ...FELDBUCH_ICON_NAMES].join(' '), {
  targetFormat: 'woff2',
  variationAxes: { FILL: 0, wght: 300, GRAD: 0, opsz: 24 }
});
await writeFile(sharpOut, sharpBuffer);
console.log(`Feldbuch-Subset geschrieben: ${sharpOut} (${(sharpBuffer.length / 1024).toFixed(1)} KB)`);
