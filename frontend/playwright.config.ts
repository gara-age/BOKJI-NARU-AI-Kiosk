import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 5'], browserName: 'chromium', channel: 'chrome' } },
    { name: 'desktop', use: { browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: [
    {
      command: '.\\.venv-py310\\Scripts\\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: '../backend',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: false,
      env: {
        ...process.env,
        ADMIN_PASSWORD: 'e2e-only-password',
        DATABASE_PATH: './runtime/e2e.sqlite3',
        OLLAMA_ENABLED: 'false',
        PUBLIC_DATA_MODE: 'seed',
        TTS_PROVIDER: 'edge',
        WAKE_WORD_ENABLED: 'false',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
    },
  ],
})
