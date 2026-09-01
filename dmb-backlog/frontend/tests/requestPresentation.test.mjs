import assert from 'node:assert/strict';

import {
  getSignalTarget,
  getRequestStage,
  humanizeSignal,
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

const request = {
  status: 'in_review',
  author_name: 'Заказчик',
  reviewer_name: 'Ревьюер',
  created_at: '2026-08-25T10:00:00Z',
  updated_at: '2026-08-26T10:00:00Z',
};
assert.match(renderRequestSummary(request), /Сейчас отвечает/);
assert.match(renderRequestSummary(request), /Срок уточняется/);
assert.match(renderRequestHistory(request), /Ключевые события/);
assert.match(renderRequestHistory(request), /Начато ревью/);
assert.match(renderRequestParticipants(request), /Участники и сроки/);
assert.match(renderRequestParticipants(request), /Ревьюер/);

console.log('requestPresentation tests passed');
