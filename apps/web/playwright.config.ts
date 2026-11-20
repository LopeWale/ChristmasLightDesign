import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command:
        './.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001',
      cwd: path.join(repoRoot, 'apps/recon-worker'),
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run start',
      cwd: __dirname,
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 45_000,
      env: {
        ...process.env,
        RECON_WORKER_URL: process.env.RECON_WORKER_URL || 'http://127.0.0.1:8001',
        GEMINI_MOCK_MODE: process.env.GEMINI_API_KEY
          ? process.env.GEMINI_MOCK_MODE || 'false'
          : 'true',
      },
    },
  ],
});
