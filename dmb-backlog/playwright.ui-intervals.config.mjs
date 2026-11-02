import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: /(?:uiKitIntervals|uiKitMetricsIntegration)\.spec\.mjs$/,
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4190' },
  webServer: { ...base.webServer, env: { PORT: '4190' }, url: 'http://127.0.0.1:4190', reuseExistingServer: false },
};
