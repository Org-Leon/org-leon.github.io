import { test, expect } from '@playwright/test';

// Offline-Betrieb (siehe "Offline-Betrieb" in main.js, offline-store.js):
// Cloud per window.__ffTestCloud gestubbt (supabase.js), Netz per
// context.setOffline() umgeschaltet. Der Dev-Server hat keinen Service
// Worker — ein echtes Neuladen ohne Netz wird daher über den Testhaken
// boot() nachgestellt (selber Ablauf wie beim Seitenaufruf).
const USER = { id: 'test-user', email: 'test@example.com' };
const NO_BETRIEB = '__kein_betrieb__';

async function setupCloud(page, initialData) {
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

async function login(page) {
  await page.evaluate(async (user) => {
    window.__ffTestTk.loginFake(user.email);
    await window.__ffTestOffline.start(user);
  }, USER);
}

const outline = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
function planWith(name) {
  return { id: 'plan-' + name, name, tierart: null, gridScale: 1, gridSnap: true, outline: { points: outline }, compartments: [], equipment: [], updatedAt: '2026-01-01' };
}

test.describe('Offline-Betrieb', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Offline erfasster Stallplan übersteht einen Neustart ohne Netz', async ({ page, context }) => {
    await setupCloud(page, { workspaces: {} });
    await login(page);
    await context.setOffline(true);
    await page.evaluate(() => {
      window.__ffTestStallplaner.createPlan({ name: 'Offline-Stall' });
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }]);
    });
    await page.evaluate(() => window.__ffTestOffline.persist());
    expect(await page.evaluate(() => window.__ffTestOffline.pending())).toBe(true);

    // "Neustart": In-Memory-Stand verwerfen und wie beim Seitenaufruf starten
    // — ohne Netz, ohne erneuerbare Session.
    await page.evaluate(() => window.__ffTestOffline.clear());
    expect(await page.evaluate(() => window.__ffTestStallplaner.getActivePlan())).toBeNull();
    await page.evaluate(() => window.__ffTestOffline.boot());
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    expect(plan && plan.name).toBe('Offline-Stall');
    expect(plan.outline.points).toHaveLength(4);
    await expect(page.locator('#btn-sync')).toHaveClass(/is-offline/);
  });

  test('Offline-Änderungen werden hochgeladen, sobald wieder Netz da ist', async ({ page, context }) => {
    await setupCloud(page, { workspaces: {} });
    await login(page);
    await context.setOffline(true);
    await page.evaluate(() => {
      window.__ffTestStallplaner.createPlan({ name: 'Stall Nord' });
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }]);
    });
    expect(await page.evaluate(() => window.__ffTestOffline.sync())).toBe('offline');
    expect(await page.evaluate(() => window.__ffTestCloud.saves)).toBe(0);
    await expect(page.locator('#btn-sync')).toHaveClass(/has-pending/);

    await context.setOffline(false); // löst das 'online'-Event aus
    await expect.poll(() => page.evaluate(() => window.__ffTestCloud.saves)).toBe(1);
    const cloudPlans = await page.evaluate((key) => window.__ffTestCloud.row.data.workspaces[key].stallplaene, NO_BETRIEB);
    expect(cloudPlans.map(p => p.name)).toEqual(['Stall Nord']);
    await expect.poll(() => page.evaluate(() => window.__ffTestOffline.pending())).toBe(false);
    await expect(page.locator('#btn-sync')).not.toHaveClass(/has-pending/);
  });

  test('Mehrfach hintereinander speichern auf EINEM Gerät löst keine Konfliktfrage aus', async ({ page }) => {
    await setupCloud(page, { workspaces: { [NO_BETRIEB]: { stallplaene: [planWith('Start')] } } });
    await login(page);
    for (const name of ['Erster', 'Zweiter', 'Dritter']) {
      await page.evaluate((n) => {
        window.__ffTestStallplaner.createPlan({ name: n });
        window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
      }, name);
      const result = await Promise.race([
        page.evaluate(() => window.__ffTestOffline.sync()),
        page.locator('#sync-conflict-overlay').waitFor({ state: 'visible' }).then(() => 'KONFLIKTFRAGE')
      ]);
      expect(result).toBe('synced');
    }
    const names = await page.evaluate((key) => window.__ffTestCloud.row.data.workspaces[key].stallplaene.map(p => p.name), NO_BETRIEB);
    expect(names).toEqual(['Start', 'Erster', 'Zweiter', 'Dritter']);
  });

  test('Derselbe Betrieb auch anderswo geändert: Konfliktfrage, "Meine behalten" gewinnt, Sicherung bleibt', async ({ page }) => {
    await setupCloud(page, { workspaces: { [NO_BETRIEB]: { stallplaene: [planWith('Alt')] } } });
    await login(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.createPlan({ name: 'Meiner' });
      window.__ffTestStallplaner.setOutline([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }]);
    });
    await page.evaluate((key) => window.__ffTestCloud.setRemote(d => { d.workspaces[key].stallplaene[0].name = 'Vom Büro geändert'; }), NO_BETRIEB);

    const syncDone = page.evaluate(() => window.__ffTestOffline.sync());
    await expect(page.locator('#sync-conflict-overlay')).toBeVisible();
    await expect(page.locator('#sync-conflict-list')).toContainText('Inhalte ohne Betrieb');
    await page.locator('#sync-conflict-keep-mine').click();
    expect(await syncDone).toBe('synced');

    const names = await page.evaluate((key) => window.__ffTestCloud.row.data.workspaces[key].stallplaene.map(p => p.name), NO_BETRIEB);
    expect(names).toContain('Meiner');
    expect(names).not.toContain('Vom Büro geändert');
    const backups = await page.evaluate((id) => window.__ffTestOffline.backups(id), USER.id);
    expect(backups).toHaveLength(1);
    expect(JSON.stringify(backups[0].full)).toContain('Vom Büro geändert');
  });

  test('"Anderen Stand übernehmen" ersetzt den offenen Betrieb durch den Cloud-Stand', async ({ page }) => {
    await setupCloud(page, { workspaces: { [NO_BETRIEB]: { stallplaene: [planWith('Alt')] } } });
    await login(page);
    await page.evaluate(() => {
      window.__ffTestStallplaner.createPlan({ name: 'Meiner' });
    });
    await page.evaluate((key) => window.__ffTestCloud.setRemote(d => { d.workspaces[key].stallplaene[0].name = 'Vom Büro geändert'; }), NO_BETRIEB);
    const syncDone = page.evaluate(() => window.__ffTestOffline.sync());
    await page.locator('#sync-conflict-take-theirs').click();
    expect(await syncDone).toBe('synced');
    const plans = await page.evaluate(() => window.__ffTestStallplaner.serializeStallplaene().map(p => p.name));
    expect(plans).toEqual(['Vom Büro geändert']);
    expect(await page.evaluate(() => window.__ffTestOffline.pending())).toBe(false);
  });

  test('Anderer Betrieb anderswo geändert: kein Konflikt, beide Änderungen bleiben erhalten', async ({ page }) => {
    await setupCloud(page, { workspaces: { [NO_BETRIEB]: {}, 'Hof B': { stallplaene: [planWith('B')] } } });
    await login(page);
    await page.evaluate(() => { window.__ffTestStallplaner.createPlan({ name: 'Hier' }); });
    await page.evaluate(() => window.__ffTestCloud.setRemote(d => { d.workspaces['Hof B'].stallplaene[0].name = 'B neu'; }));
    expect(await page.evaluate(() => window.__ffTestOffline.sync())).toBe('synced');
    await expect(page.locator('#sync-conflict-overlay')).toBeHidden();
    const row = await page.evaluate(() => window.__ffTestCloud.row.data);
    expect(row.workspaces['Hof B'].stallplaene[0].name).toBe('B neu');
    expect(row.workspaces[NO_BETRIEB].stallplaene.map(p => p.name)).toEqual(['Hier']);
    // Der andere Betrieb ist auch lokal aktualisiert (für einen späteren Wechsel offline).
    const local = await page.evaluate(() => window.__ffTestOffline.record().full.workspaces['Hof B']);
    expect(local.stallplaene[0].name).toBe('B neu');
  });

  test('Betrieb wechseln funktioniert offline und merkt sich den Betrieb für den nächsten Start', async ({ page, context }) => {
    await setupCloud(page, { workspaces: { [NO_BETRIEB]: {}, 'Hof B': { stallplaene: [planWith('Stall von Hof B')] } } });
    await login(page);
    await context.setOffline(true);
    await page.evaluate(() => window.__ffTestOffline.switchTo('Hof B'));
    expect(await page.evaluate(() => window.__ffTestOffline.currentWorkspaceKey())).toBe('Hof B');
    expect(await page.evaluate(() => window.__ffTestStallplaner.getActivePlan().name)).toBe('Stall von Hof B');

    // Offline am Plan von Hof B weiterarbeiten, dann "Neustart".
    await page.evaluate(() => window.__ffTestStallplaner.addCompartment([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], { name: 'Bucht offline' }));
    await page.evaluate(() => window.__ffTestOffline.persist());
    await page.evaluate(() => window.__ffTestOffline.clear());
    expect(await page.evaluate(() => window.__ffTestStallplaner.getActivePlan())).toBeNull();
    await page.evaluate(() => window.__ffTestOffline.boot());
    expect(await page.evaluate(() => window.__ffTestOffline.currentWorkspaceKey())).toBe('Hof B');
    const plan = await page.evaluate(() => window.__ffTestStallplaner.getActivePlan());
    expect(plan.compartments.map(c => c.name)).toEqual(['Bucht offline']);
    await expect(page.locator('#btn-betrieb-label')).toContainText('Hof B');
  });

  test('Datei-Upload ohne Netz meldet verständlich, dass es nur online geht', async ({ page, context }) => {
    await page.evaluate(() => window.__ffTestTk.loginFake());
    await page.locator('.segment-btn', { hasText: 'Terminkalender' }).click();
    await page.evaluate(() => window.__ffTestTk.addEvent());
    await page.locator('.tk-card').first().click();
    await context.setOffline(true);
    await page.setInputFiles('#tk-file-add-input', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
    await expect(page.locator('#tk-attachment-status')).toContainText('Keine Internetverbindung');
  });
});
