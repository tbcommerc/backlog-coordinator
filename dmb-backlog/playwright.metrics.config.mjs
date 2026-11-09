import base from './playwright.config.mjs';

export default {
  ...base,
  testMatch: /(?:metricsQuarterly|metricsSimplification|uiKitMetricsIntegration|metricsToolbar)\.spec\.mjs$/,
  workers: 2,
  use: {...base.use, baseURL: 'http://127.0.0.1:4198'},
  webServer: process.env.METRICS_EXTERNAL_SERVER === '1' ? undefined : {
    ...base.webServer, env: {PORT: '4198'}, url: 'http://127.0.0.1:4198', reuseExistingServer: false,
  },
};
