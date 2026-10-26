import { renderAgentV2, initAgentV2 } from './workspace.js?v=13';

const unavailable = {
  render: () => '<main class="agent-v2-page"><div class="agent-v2-error">Экран Assistant V2 не найден.</div></main>',
};

export function resolveAgentV2Route(path, app) {
  if (path === '/agent-v2') {
    return { render: renderAgentV2, init: () => initAgentV2(app) };
  }
  return unavailable;
}
