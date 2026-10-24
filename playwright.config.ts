import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real app against the Firebase Emulator Suite
 * (auth + database + functions). `npm run test:e2e` starts the emulators for you.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testMatch: /journey\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  // E2E_FREE=1 → the app talks to the plain-HTTP API (free-plan / Vercel path) instead of the callable,
  // so Playwright also starts the local API server.
  webServer: [
    ...(process.env.E2E_FREE ? [{ command: 'npm run api:dev', port: 8787, reuseExistingServer: false, timeout: 60_000 }] : []),
    {
      command: `npm run ${process.env.E2E_FREE ? 'dev:free' : 'dev:emu'} -- --port 5173 --strictPort`,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI && !process.env.E2E_FREE,
      timeout: 60_000,
    },
  ],
});
