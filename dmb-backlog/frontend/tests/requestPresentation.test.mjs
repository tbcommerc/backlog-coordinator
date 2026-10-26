import assert from 'node:assert/strict';

import {
  getSignalTarget,
  getRequestStage,
  humanizeSignal,
  numericScore,
  renderLegacyRequestDescription,
  renderLatestRevisionDiff,
  renderRequestHistory,
  renderRequestJourney,
  renderRequestParticipants,
  renderRequestSummary,
  renderRequirementSections,
  signalCount,
} from '../js/components/requestPresentation.js';

assert.equal(getRequestStage({ status: 'submitted' }).label, 'Ожидает ревью');
assert.equal(getRequestStage({ status: 'rejected' }).badge, 'badge-danger');
assert.equal(getRequestStage({ status: 'in_progress', task_status: 'ВЫПОЛНЕНА' }).label, 'Выполнен');

const rejectedJourney = renderRequestJourney({ status: 'rejected' });
assert.match(rejectedJourney, /Создан/);
assert.match(rejectedJourney, /Ревью/);
assert.match(rejectedJourney, /is-skipped/);
assert.match(rejectedJourney, /is-terminal/);
assert.match(rejectedJourney, /Отклонён/);

const returnedJourney = renderRequestJourney({ status: 'returned' });
assert.match(returnedJourney, /aria-current="step"/);
assert.match(returnedJourney, /Уточнение/);
assert.match(returnedJourney, /Этап 2 из 4 · Уточнение/);

assert.equal(humanizeSignal('Требуется уточнение: dependencies'), 'Нужно уточнить зависимости от других систем или команд');
assert.equal(signalCount({ open_questions: ['1'], conflicts: [{ message: '2' }], risks: ['3'] }), 3);

const content = renderRequirementSections({
  problem_statement: '<Потребность>',
  acceptance_criteria: ['Результат виден'],
});
assert.match(content, /Паспорт запроса/);
assert.match(content, /&lt;Потребность&gt;/);
assert.match(content, /Критерии приёмки/);
assert.match(content, /id="request-section-problem"/);
assert.match(content, /id="request-section-acceptance-criteria"/);

assert.equal(getSignalTarget('Требуется уточнение: dependencies'), 'request-section-dependencies');
assert.equal(getSignalTarget('Не описаны критерии проверки'), 'request-section-acceptance-criteria');
assert.equal(getSignalTarget('Ложные совпадения могут снижать доверие пользователей', 'Риски'), 'request-section-risks');
assert.equal(getSignalTarget({ text: 'Неясный текст', section_key: 'business_value' }, 'Открытые вопросы'), 'request-section-business-value');
assert.match(renderRequirementSections({
  problem_statement: 'Есть потребность',
  review_findings: [{ text: 'Не описана интеграция', section_key: 'data_integrations' }],
}), /id="request-section-data-integrations"/);

assert.equal(numericScore(null), null);
assert.equal(numericScore(''), null);
assert.equal(numericScore(undefined), null);
assert.equal(numericScore('72'), 72);
assert.match(renderLegacyRequestDescription('Первая строка\nВторая строка'), /Исходное описание/);
assert.match(renderLegacyRequestDescription('<script>'), /&lt;script&gt;/);
assert.match(renderLegacyRequestDescription('Полный текст', { supplemental: true }), /Полный сохранённый текст/);

const request = {
  status: 'in_review',
  author_name: 'Заказчик',
  reviewer_name: 'Ревьюер',
  created_at: '2026-08-25T10:00:00Z',
  updated_at: '2026-08-26T10:00:00Z',
};
assert.match(renderRequestSummary(request), /Ответственный/);
assert.doesNotMatch(renderRequestSummary(request), /Ожидаемый результат/);
assert.match(renderRequestSummary({ ...request, stage_started_at: '2026-08-26T10:00:00Z' }), /Текущий этап с/);
assert.doesNotMatch(renderRequestSummary(request), /<small>Статус<\/small>/);
assert.match(renderRequestHistory(request), /Ключевые события/);
assert.match(renderRequestHistory(request), /Начато ревью/);
assert.match(renderRequestHistory({ ...request, updated_at: request.created_at }), /Начато ревью/);
assert.match(renderRequestParticipants(request), /Участники и даты/);
assert.match(renderRequestParticipants(request), /Ревьюер/);

const revisionDiff = renderLatestRevisionDiff({ revision_history: [
  { revision: 1, draft: { problem_statement: 'Было' } },
  { revision: 2, draft: { problem_statement: 'Стало' } },
] });
assert.match(revisionDiff, /Что изменилось/);
assert.match(revisionDiff, /Было/);
assert.match(revisionDiff, /Стало/);

console.log('requestPresentation tests passed');

for (const [status, label] of Object.entries({completed: 'Выполнен', not_relevant: 'Не актуален', task_rejected: 'Задача отклонена', task_deleted: 'Задача удалена'})) {
  assert.equal(getRequestStage({status, task_status: 'ВЫПОЛНЕНА'}).label, label);
  assert.ok(renderRequestJourney({status}).includes(label));
}
assert.equal(getRequestStage({status: 'rejected', task_status: 'ВЫПОЛНЕНА'}).label, 'Отклонён');
assert.equal(getRequestStage({status: 'in_progress', task_id: 1, task_progress: 100}).group, 'work');
