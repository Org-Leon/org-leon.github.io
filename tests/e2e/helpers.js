// Gemeinsame Helfer für die Playwright-Regressionstests. Zeichnen über
// Leaflet.draw lässt sich nicht zuverlässig per simuliertem Maus-Event
// auslösen (siehe AGENTS.md) — stattdessen wird der jeweilige Draw-Handler
// über die Werkzeugleiste scharf gestellt und danach direkt ein
// 'draw:created'-Event auf der (nur im Dev-Server über window.__ffTestMap
// verfügbaren) Karteninstanz gefeuert.

export async function gotoTab(page, label) {
  await page.locator('.segment-btn', { hasText: label }).click();
}

// Kontrolle → Reiter "Kalender" (dort liegen die Terminkarten).
export async function gotoKontrolleKalender(page) {
  await page.locator('#kontrolle-switcher').click();
  await page.locator('#kontrolle-tabs [data-ko-tab="kalender"]').click();
}

// Ersten Termin im Kalender öffnen (Kontrollmappe), optional einen Reiter
// der Mappe wählen: 'ueberblick' | 'protokolle' | 'dokumente' | 'notizen'.
export async function openFirstTermin(page, tab) {
  await page.locator('.tk-card').first().click();
  if (tab) await page.locator(`#kontrollmappe [data-km-tab="${tab}"]`).click();
}

export async function drawZeichnerPolygon(page, latlngs) {
  await page.locator('#shape-tool-draw').click();
  await page.evaluate((coords) => {
    const map = window.__ffTestMap;
    const layer = window.L.polygon(coords);
    map.fire('draw:created', { layer, layerType: 'polygon' });
  }, latlngs);
}

export async function drawHofplanRect(page, latlngs) {
  await page.locator('#hofplan-tool-rect').click();
  await page.evaluate((coords) => {
    const map = window.__ffTestMap;
    const layer = window.L.rectangle(coords);
    map.fire('draw:created', { layer, layerType: 'rectangle' });
  }, latlngs);
}

export async function drawHofplanPolygon(page, latlngs) {
  await page.locator('#hofplan-tool-poly').click();
  await page.evaluate((coords) => {
    const map = window.__ffTestMap;
    const layer = window.L.polygon(coords);
    map.fire('draw:created', { layer, layerType: 'polygon' });
  }, latlngs);
}

// Ein Rechteck ist immer eindeutig als Bounding-Box beschreibbar — kleine,
// beieinanderliegende Testkoordinaten reichen für die Regressionstests,
// die reale Position ist irrelevant.
export const TEST_RECT_A = [[51.10, 10.40], [51.1006, 10.4012]];
export const TEST_RECT_B = [[51.20, 10.50], [51.2006, 10.5012]];
export const TEST_POLY_A = [[51.10, 10.40], [51.10, 10.42], [51.12, 10.42], [51.12, 10.40]];

// Cloud-Stub (window.__ffTestCloud, siehe supabase.js) + Anmeldung mit
// lokalem Arbeitsstand — für Tests mit Betrieb-Wechsel/Offline-Abgleich.
export const TEST_USER = { id: 'test-user', email: 'test@example.com' };

export async function setupCloud(page, initialData) {
  await page.evaluate(({ data }) => {
    let tick = 0;
    // Wie Postgres-jsonb (Supabase): Objekt-Schlüssel werden beim Speichern
    // umsortiert (kürzere zuerst, dann alphabetisch) — die Reihenfolge der
    // gespeicherten Daten ist also NICHT die, in der sie geschrieben wurden.
    const jsonb = (v) => {
      if (Array.isArray(v)) return v.map(jsonb);
      if (v && typeof v === 'object') {
        const out = {};
        Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).forEach(k => { out[k] = jsonb(v[k]); });
        return out;
      }
      return v;
    };
    window.__ffTestCloud = {
      row: data ? { data: jsonb(data), updated_at: 't0' } : null,
      saves: 0,
      async load() { return this.row ? JSON.parse(JSON.stringify(this.row)) : null; },
      async save(d) {
        this.saves += 1;
        this.row = { data: jsonb(JSON.parse(JSON.stringify(d))), updated_at: 't' + (++tick) };
        return this.row.updated_at;
      },
      // Simuliert eine Änderung von einem anderen Gerät.
      setRemote(mutator) {
        const d = JSON.parse(JSON.stringify(this.row.data));
        mutator(d);
        this.row = { data: jsonb(d), updated_at: 'remote-' + (++tick) };
      }
    };
  }, { data: initialData });
}

export async function loginWithCloud(page, user = TEST_USER) {
  await page.evaluate(async (user) => {
    window.__ffTestTk.loginFake(user.email);
    await window.__ffTestOffline.start(user);
  }, user);
}

