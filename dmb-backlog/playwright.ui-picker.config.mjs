import base from './playwright.config.mjs';

export default {
  ...base,
  testMatch: /(?:uiKitEntityPicker|uiKitMetricsIntegration)\.spec\.mjs$/,
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4189' },
  webServer: { ...base.webServer, env: { PORT: '4189' }, url: 'http://127.0.0.1:4189', reuseExistingServer: false },
};
