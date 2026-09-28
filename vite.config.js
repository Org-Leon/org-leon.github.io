import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

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
    host: true
  },
  build: {
    outDir: 'docs'
  },
  plugins: [
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
          { name: 'Terminkalender', short_name: 'Termine', url: '?view=terminkalender', icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }] },
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
            // Dokumentenscanner (OpenCV/jscanify) — wird erst beim ersten
            // Öffnen des Scanners geladen und danach offline vorgehalten.
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
