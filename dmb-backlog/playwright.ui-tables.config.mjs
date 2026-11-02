import base from './playwright.config.mjs';

export default {
  ...base,
  testMatch: /(?:uiKitDataTable|uiKitMetricsIntegration|metricsToolbar)\.spec\.mjs$/,
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4188' },
  webServer: { ...base.webServer, env: { PORT: '4188' }, url: 'http://127.0.0.1:4188', reuseExistingServer: false },
};
