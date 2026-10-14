import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ui-preview.spec.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 5'], browserName: 'chromium', channel: 'chrome' } },
    { name: 'desktop', use: { browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5175',
    url: 'http://127.0.0.1:5175/ui-preview',
    reuseExistingServer: true,
  },
})
