import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ---- Content-Security-Policy ----
// Legt fest, woher die Seite Skripte, Stile, Bilder und Verbindungen laden darf —
// alles andere blockiert der Browser. Begrenzt den Schaden, falls doch einmal
// fremder Code in die Seite gerät (die Anmeldung liegt im Browser-Speicher).
// GitHub Pages kann keine Header setzen, daher als <meta>-Tag in index.html.
// NEUE EXTERNE QUELLE (Kartenserver, Bibliothek, API)? Hier eintragen, sonst
// lädt sie nicht — tests/e2e/csp.spec.js meldet Verstöße.
function cspPlugin() {
  let env = {};
  let dev = false;
  return {
    name: 'feldfolio-csp',
    configResolved(config) { env = loadEnv(config.mode, config.root, 'VITE_'); dev = config.command === 'serve'; },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // eingebettete Skripte (Theme vor dem ersten Rendern) über ihre Prüfsumme erlauben
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
          .map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
        let supabase = [];
        try { const u = new URL(env.VITE_SUPABASE_URL); supabase = [u.origin, 'wss://' + u.host]; } catch { /* nicht konfiguriert */ }
        // cdnjs NICHT als ganzer Host: dort liegen tausende Bibliotheken, mit denen sich eine
        // Policy umgehen ließe. Erlaubt sind nur die Dateien aus index.html (Skripte, Stile),
        // deren Bildordner (Leaflet-Symbole) und pdf.js (wird bei Bedarf nachgeladen).
        const cdn = (re) => [...new Set([...html.matchAll(re)].map(m => m[1]))];
        const cdnSkripte = cdn(/<script[^>]*\bsrc="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)"/g);
        const cdnStile = cdn(/<link[^>]*\bhref="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+\.css)"/g);
        const cdnBilder = cdnStile.map(u => u.replace(/[^/]+$/, 'images/'));
        const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
        const KARTEN = ['https://*.tile.openstreetmap.org', 'https://*.tile.opentopomap.org', 'https://server.arcgisonline.com'];
        // Nur Dev-Server: Vite-Verbindung (HMR) und die simulierten Server der Tests (*.test)
        const devVerbindung = dev ? ['ws:', 'http://localhost:*', 'https://*.test'] : [];
        const policy = {
          'default-src': ["'self'"],
          // kein 'unsafe-inline', kein 'unsafe-eval': OpenCV (braucht eval) läuft in
          // public/scan-sandbox.html mit eigener Policy, Turf kommt per npm (src/geo.js)
          'script-src': ["'self'", ...cdnSkripte, PDFJS, ...inline],
          'style-src': ["'self'", "'unsafe-inline'", ...cdnStile, 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:', ...cdnBilder, ...KARTEN, ...supabase.slice(0, 1), ...(dev ? ['https://*.test'] : [])],
          // blob:/data: = eigene, im Browser erzeugte Inhalte (kein Weg nach außen)
          'connect-src': ["'self'", 'blob:', 'data:', ...supabase, 'https://nominatim.openstreetmap.org', PDFJS, 'https://docs.opencv.org', ...devVerbindung],
          'media-src': ["'self'", 'blob:'],
          'worker-src': ["'self'", 'blob:'],
          'frame-src': ["'self'"],
          'object-src': ["'self'", 'blob:'],
          'manifest-src': ["'self'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"]
        };
        const content = Object.entries(policy).map(([k, v]) => k + ' ' + v.join(' ')).join('; ');
        return html.replace(/<meta charset="[^"]*"\s*\/?>/i, (m) => `${m}\n<meta http-equiv="Content-Security-Policy" content="${content}">`);
      }
    }
  };
}

// Die per <script>/<link> eingebundenen CDN-Bibliotheken (index.html) werden
// beim Installieren des Service Workers gleich mit vorgeladen — über das
// Laufzeit-Caching allein wären sie erst ab dem ZWEITEN Seitenaufruf offline
// da (beim ersten kontrolliert der Service Worker die Seite noch nicht).
// Direkt aus index.html gelesen, damit die Liste nie veraltet.
const CDN_URLS = [...new Set(readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  .match(/https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\/[^"'\s]+/g) || [])]
  .map(url => url.replace(/&amp;/g, '&'));

// Offline-Fähigkeit (Stallplan im Stall ohne Empfang): der Service Worker
// hält die App selbst (Build-Dateien, Vorlagen) sowie die per CDN geladenen
// Bibliotheken vor, damit die Seite auch ohne Netz startet. Die Daten selbst
// liegen lokal in IndexedDB (src/offline-store.js). Nur im Produktions-Build
// aktiv — der Dev-Server bleibt unverändert.
export default defineConfig({
  // Relative Pfade im Build: GitHub Pages liefert das Repo unter einem
  // Unterpfad aus (…github.io/ShapeViewer/). Mit absoluten Pfaden
  // (/assets, /sw.js, /manifest.webmanifest) zeigten Skripte, Manifest und
  // Service Worker auf die Domain-Wurzel — die App war dann nicht
  // installierbar. './' funktioniert unter Unterpfad und eigener Domain.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // Nur auf diesem Rechner erreichbar. Zum Testen vom Handy im selben WLAN:
    // "npm run dev:lan" (dann ist der Dev-Server im ganzen Netzwerk sichtbar —
    // nicht in fremden Netzen verwenden).
    host: false,
    fs: {
      // Standard-Sperren von Vite + die echten Betriebsdateien in test-shapes/:
      // der Dev-Server liefert sie nicht aus.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/test-shapes/**']
    }
  },
  build: {
    outDir: 'docs'
  },
  plugins: [
    cspPlugin(),
    VitePWA({
      // Neue Version erst nach Bestätigung aktivieren (Hinweis in der App),
      // statt mitten in der Arbeit die Seite auszutauschen.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon-feldfolio.svg', 'apple-touch-icon.png', 'probenahmeprotokoll-vorlage.pdf', 'crosscheck-vorlage.pdf'],
      manifest: {
        // Relativ zur start_url aufgelöst -> Ordner der App, nicht die Domain-Wurzel.
        id: './',
        name: 'FeldFolio',
        short_name: 'FeldFolio',
        description: 'Flächen, Hofplan, Stallplaner und Termine — auch offline im Stall nutzbar.',
        lang: 'de',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        categories: ['business', 'productivity', 'utilities'],
        // Langes Drücken aufs App-Symbol: direkt in eine Funktion springen
        // (ausgewertet über ?view= in main.js).
        shortcuts: [
          { name: 'Stallplaner', short_name: 'Stallplan', url: '?view=stallplaner', icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Kontrolle', short_name: 'Kontrolle', url: '?view=kontrolle', icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Flächenzeichner', short_name: 'Flächen', url: '?view=zeichner', icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }] }
        ],
        background_color: '#12151A',
        theme_color: '#12151A',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,pdf}'],
        // Das Hauptskript ist ~1,7 MB (SheetJS, Turf mitgebaut). Workbox lässt Dateien über
        // 2 MiB sonst stillschweigend aus dem Offline-Cache — dann startete die App offline nicht.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Versionierte CDN-URLs ändern sich nie -> keine Revision nötig.
        additionalManifestEntries: CDN_URLS.map(url => ({ url, revision: null })),
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Leaflet, jsPDF, html2canvas, pdf-lib, Turf, SheetJS, … (index.html).
            // Versionierte URLs ändern sich nie — Cache zuerst. Status 0 =
            // "opaque" Antwort der normalen <script>-Tags ohne CORS.
            urlPattern: ({ url }) => url.origin === 'https://cdnjs.cloudflare.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-bibliotheken',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Dokumentenscanner (OpenCV.js, ~9 MB) — wird beim ersten Öffnen
            // des Terminkalenders im Hintergrund vorgeladen (main.js,
            // prefetchScanLibsForOffline) und danach offline vorgehalten.
            urlPattern: ({ url }) => url.origin === 'https://docs.opencv.org' || url.origin === 'https://cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: {
              cacheName: 'scanner-bibliotheken',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'schriften',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
          // Kartenkacheln (OSM, OpenTopoMap, Esri) werden bewusst NICHT
          // gespeichert — deren Nutzungsbedingungen untersagen Massen-Caching;
          // offline bleibt der Kartenhintergrund daher leer.
        ]
      },
      devOptions: { enabled: false }
    })
  ]
});
