import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Alle Tests laufen gegen denselben Vite-Dev-Server-Prozess (kein
  // Multi-Instanz-Setup) — zu viele parallele Worker überlasten ihn
  // (Navigation-Timeouts beim gleichzeitigen ersten Laden mehrerer Seiten).
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    navigationTimeout: 20000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000
  }
});
