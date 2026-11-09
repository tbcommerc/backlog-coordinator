import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Windows baselines are intentionally separate from Linux functional CI.
export default defineConfig(base, {
  testMatch: /workDesignPilot\.spec\.mjs$/,
  metadata: { designVisual: true },
  updateSnapshots: 'none',
  workers: 2,
});
