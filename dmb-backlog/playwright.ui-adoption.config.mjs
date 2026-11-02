import base from './playwright.config.mjs';
const port = process.env.UI_ADOPTION_PORT || '4192';

export default {
  ...base,
  testMatch: /(?:uiKitAdoption|uiKitRelationsReview|uiKitComplexFormsReview|workStage5|workTaskDrawer|workTasks|workSplitWorkspace|uiKitEntityPicker|uiKitRegistries|projectWorkspace|projects|workPagesUx|uiKitSettings|uiKitAdminReports|uiKitReportingWorkspaces|uiKitReportCompletion|teamWeeklyReport|uiKitBacklog|uiKitDialogAcceptance|adminAuditFixes|agentChatResponsive|customerPortalResponsive|requirementWorkspace|uiKitIntervals|uiKitDataTable|uiKitDetailComponents)\.spec\.mjs$/,
  workers: 2,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...base.webServer, command: 'node frontend/e2e/staticServer.mjs', url: `http://127.0.0.1:${port}`, env: { PORT: port }, reuseExistingServer: false },
};
