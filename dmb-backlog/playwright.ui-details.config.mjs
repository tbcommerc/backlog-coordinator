import base from './playwright.config.mjs';

// Отдельный сервер: параллельный прогон другого чата не завершает наш сервер.
export default {
  ...base,
  testMatch: /(?:uiKitDetailComponents|uiKitMetricsIntegration|uiKitDialogAcceptance|workTaskDrawer|workSplitWorkspace)\.spec\.mjs$/,
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4187' },
  webServer: {
    ...base.webServer,
    env: { PORT: '4187' },
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: false,
  },
};
