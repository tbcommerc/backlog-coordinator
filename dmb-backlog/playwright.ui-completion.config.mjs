import base from './playwright.config.mjs';
export default {
  ...base,
  testMatch: /(?:uiKitWorkflows|uiKitDetailComponents|uiKitDataTable|uiKitEntityPicker|uiKitIntervals|uiKitMetricsIntegration|uiKitDialogAcceptance|metricsToolbar|workTaskDrawer|workSplitWorkspace|meetingCapture|meetingCaptureBackground)\.spec\.mjs$/,
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4191' },
  webServer: { ...base.webServer, env: { PORT: '4191' }, url: 'http://127.0.0.1:4191', reuseExistingServer: false },
};
