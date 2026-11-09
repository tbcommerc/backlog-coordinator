import base from './playwright.config.mjs';

const port = Number(process.env.DMB_AGENT_UI_PORT || 4197);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid DMB_AGENT_UI_PORT');

export default {
    ...base,
    testMatch: /(?:meetingCapture(?:Background)?|backlogAssistant|agentChatResponsive)\.spec\.mjs$/,
    outputDir: process.env.DMB_AGENT_UI_OUTPUT || '../.runtime/agent-services-evidence/ui-fixture-results',
    workers: 1,
    use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
    webServer: {
        ...base.webServer,
        env: { PORT: String(port) },
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
    },
};
