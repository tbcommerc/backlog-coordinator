import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './frontend/e2e',
  testMatch: 'deploymentStand.spec.mjs',
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  outputDir: '../.test-results-deployment/live-browser',
  use: {
    baseURL: process.env.DMB_DEMO_BASE_URL || 'http://127.0.0.1:8000',
    browserName: 'chromium', viewport: {width: 1440, height: 1000}, trace: 'off',
    launchOptions: {args: process.env.DMB_DEMO_TLS_SPKI ? ['--ignore-certificate-errors-spki-list=' + process.env.DMB_DEMO_TLS_SPKI] : []},
  },
});
