import { renderCaseList, initCaseList, renderNewCase, initNewCase, renderCaseWorkspace, initCaseWorkspace } from './caseWorkspace.js?v=2';
import { renderNewRequirement, initNewRequirement, renderRequirementWorkspace, initRequirementWorkspace, renderReviewGate, initReviewGate } from './requirementWorkspace.js?v=2';
import { renderDiffReview, initDiffReview } from './diffReview.js?v=2';

const unavailable = {
  render: () => '<main class="assistant-v2-page"><div class="assistant-v2-error">Этот экран ИИ-ассистента 2.0 не найден.</div></main>',
};

export function resolveAssistantV2Route(path, app) {
  if (path === '/assistant-v2') return { render: renderCaseList, init: initCaseList };
  if (path === '/assistant-v2/cases/new') return { render: renderNewCase, init: initNewCase };
  if (path === '/assistant-v2/requirements/new') return { render: renderNewRequirement, init: initNewRequirement };
  let match = path.match(/^\/assistant-v2\/cases\/([0-9a-f-]{36})$/i);
  if (match) return { render: () => renderCaseWorkspace(app, match[1]), init: () => initCaseWorkspace(app, match[1]) };
  match = path.match(/^\/assistant-v2\/requirements\/([0-9a-f-]{36})$/i);
  if (match) return { render: () => renderRequirementWorkspace(app, match[1]), init: () => initRequirementWorkspace(app, match[1]) };
  match = path.match(/^\/assistant-v2\/reviews\/([0-9a-f-]{36})$/i);
  if (match) return { render: () => renderReviewGate(app, match[1]), init: () => initReviewGate(app, match[1]) };
  match = path.match(/^\/assistant-v2\/diffs\/([0-9a-f-]{36})$/i);
  if (match) return { render: () => renderDiffReview(app, match[1]), init: () => initDiffReview(app, match[1]) };
  return unavailable;
}
