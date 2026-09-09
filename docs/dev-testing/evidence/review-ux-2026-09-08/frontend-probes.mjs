// Read-only audit probes: synthetic values only, no network and no application mutations.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../../../..');
const presentationUrl = pathToFileURL(resolve(root, 'dmb-backlog/frontend/js/components/requestPresentation.js')).href;
const presentation = await import(presentationUrl);
const elements = new Map();
const storage = new Map();
function element(id, value = '') {
  const item = { id, value, innerHTML: '', textContent: '', scrollTop: 0, isConnected: true,
    addEventListener() {}, toggleAttribute() {},
    classList: { toggle() {}, remove() {} } };
  elements.set(id, item);
  return item;
}
globalThis.document = {
  getElementById: id => elements.get(id) || null,
  querySelectorAll: () => [],
  createElement: () => ({
    textContent: '',
    get innerHTML() { return this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); },
  }),
};
globalThis.window = { requestAnimationFrame: callback => callback(), toast() {} };
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
element('review-search');
element('review-status-filter', 'all');
element('review-sort', 'oldest');
element('review-list-content');
element('review-count');
element('review-queue-card');
element('review-summary');

const sourcePath = resolve(root, 'dmb-backlog/frontend/js/components/reviewPage.js');
let source = readFileSync(sourcePath, 'utf8').replace("from './requestPresentation.js'", `from '${presentationUrl}'`);
source += '\nexport { renderReviewCard, filteredReviewRows, findNextReviewId, updateStatus, loadReviewQueue, renderReviewList, qualityScore }; export function setAuditRows(rows) { reviewRows = rows; }';
const review = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const outputs = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected); outputs.push({ name, actual }); }

const signalDraft = { review_findings: [{ severity: 'warning', field: 'acceptance_criteria', message: 'Нет измеримого порога' }], quality_issues: ['Неизмеримый критерий'] };
check('review_findings и quality_issues не входят в счётчик', presentation.signalCount(signalDraft), 0);
const naturalQuestion = 'Какие данные передаются при интеграции?';
const naturalDraft = { open_questions: [naturalQuestion] };
const naturalTarget = presentation.getSignalTarget(naturalQuestion, 'Открытые вопросы');
check('Естественный вопрос ведёт в отсутствующий раздел', presentation.renderRequirementSections(naturalDraft).includes(`id="${naturalTarget}"`), false);
const structuredQuestion = { text: 'Уточнить источники', section_key: 'data_integrations' };
check('Структурный вопрос ведёт в отсутствующий раздел', presentation.renderRequirementSections({ open_questions: [structuredQuestion] }).includes(`id="${presentation.getSignalTarget(structuredQuestion)}"`), false);

const done = { id: 901, title: 'Synthetic request', status: 'in_progress', task_id: 55, task_status: 'ВЫПОЛНЕНА', task_progress: 100, draft: {} };
check('Detail знает, что задача выполнена', presentation.getRequestStage(done).label, 'Выполнен');
check('Карточка выполненного запроса пишет В проработке', review.renderReviewCard(done).includes('В проработке'), true);
check('Неизвестное качество представляется как ноль', review.qualityScore({ draft: {} }), 0);

const legacyHtml = await review.renderReviewDetailPage({ api: { get: async () => ({ id: 909, title: 'Legacy', description: 'LEGACY_DESCRIPTION_MARKER', status: 'submitted', available_actions: ['claim'], draft: {} }) } }, 909);
check('Описание legacy-запроса потеряно на review detail', legacyHtml.includes('LEGACY_DESCRIPTION_MARKER'), false);
review.setAuditRows([{ id: 901, title: 'Synthetic request', status: 'submitted', available_actions: ['claim'], draft: {} }]);
check('Поиск видимого ID не находит запрос', review.filteredReviewRows({ search: '901', filter: 'all', sort: 'oldest' }).length, 0);

await review.loadReviewQueue({ api: { get: async () => { throw new Error('Synthetic network failure'); } } });
check('При ошибке очередь показывает error', elements.get('review-list-content').innerHTML.includes('Не удалось загрузить запросы'), true);
check('Счётчик при ошибке остаётся в загрузке', elements.get('review-count').textContent, 'Загрузка…');
review.renderReviewList();
check('Изменение фильтра заменяет ошибку старыми данными', elements.get('review-list-content').innerHTML.includes('Synthetic request'), true);

storage.set('dmb.review.queue.v2', JSON.stringify({ search: '', filter: 'action', sort: 'oldest' }));
review.setAuditRows([1, 2].map(id => ({ id, title: `Synthetic ${id}`, status: 'in_review', available_actions: ['approve'], draft: {} })));
const app = { api: { put: async () => ({ status: 'in_progress' }) }, router: { refreshCurrentRoute: async () => {} } };
check('После первого решения следующий — второй', review.findNextReviewId(1), 2);
await review.updateStatus(app, 1, { status: 'in_progress' }, 'Synthetic success');
check('После второго решения следующий — уже обработанный первый', review.findNextReviewId(2), 1);
process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), probesPassed: outputs.length, outputs }, null, 2)}\n`);
