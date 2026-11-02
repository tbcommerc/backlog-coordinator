import { renderAgentV2, initAgentV2 } from './workspace.js?v=14';

const unavailable = {
  render: () => '<section class="agent-v2-page"><div class="agent-v2-error">Экран Assistant V2 не найден.</div></section>',
};

export function resolveAgentV2Route(path, app) {
  if (path === '/agent-v2') {
    return { render: renderAgentV2, init: () => initAgentV2(app) };
  }
  return unavailable;
}
