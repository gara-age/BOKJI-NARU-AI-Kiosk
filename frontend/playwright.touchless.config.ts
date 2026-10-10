import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'touchless.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5173' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 5'], browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})
