const labels = {
  draft: 'Черновик',
  captured: 'Поручение зафиксировано',
  clarifying: 'Требует уточнения',
  ready_for_analysis: 'Готово к подготовке требования',
  handed_off: 'Передано в бизнес-требование',
  duplicate: 'Дубликат',
  deferred: 'Отложено',
  rejected: 'Отклонено',
  archived: 'В архиве',
  drafting: 'Подготовка',
  validating: 'Проверка полноты',
  ready_for_review: 'Готово к проверке',
  in_review: 'На проверке',
  approved: 'Утверждено',
  returned: 'Возвращено на доработку',
  approved_baseline: 'Утверждено',
  superseded: 'Есть новая версия',
  proposed: 'Ожидает решения',
  partially_accepted: 'Частично принято',
  accepted: 'Принято',
  applied: 'Перенесено в задачу',
  stale: 'Нужно обновить',
  cancelled: 'Отменено',
  open: 'Открыто',
  resolved: 'Решено',
  escalated: 'Передано ответственному',
  pending: 'Нужно решение',
};

const fieldLabels = {
  requested_action: 'Требуемое действие',
  expected_outcome: 'Ожидаемый результат',
  business_problem: 'Бизнес-проблема и ценность',
  scope_in: 'Что входит в объём',
  scope_out: 'Что не входит в объём',
  purpose: 'Проблема или цель',
  target_outcome: 'Целевой результат',
  actors: 'Участники',
  primary_scenarios: 'Основные сценарии',
  business_rules: 'Бизнес-правила',
  assumptions: 'Допущения',
  acceptance_criteria: 'Критерии приёмки',
  traceability: 'Связь с исходными данными',
  unresolved_items: 'Незакрытый вопрос',
  sources: 'Исходная информация',
  conflicts: 'Противоречие',
  decisions: 'Подтверждение источника',
  unknowns: 'Дополнительное уточнение',
  title: 'Название',
  description: 'Описание',
  comment: 'Комментарий',
  link_mockups: 'Ссылка на макеты',
  link_requirements: 'Ссылка на требования',
};

export function statusLabel(value) {
  return labels[value] || 'Статус не определён';
}

export function fieldLabel(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  const key = parts.find(part => part !== 'passport' && !/^\d+$/.test(part));
  return fieldLabels[key] || (path === '/' ? 'Требование в целом' : 'Другое уточнение');
}

export function severityLabel(value) {
  return ({ info: 'К сведению', warning: 'Важно', blocking: 'Блокирует передачу', critical: 'Критично', major: 'Существенно', minor: 'Незначительно' })[value] || 'Важность не указана';
}

export function claimTypeLabel(value) {
  return ({ source_statement: 'Факт из источника', source_intent: 'Намерение заказчика', operator_interpretation: 'Формулировка оператора', agent_hypothesis: 'Предположение ассистента', human_decision: 'Решение человека' })[value] || 'Факт';
}

export function sourceOriginLabel(value) {
  return ({ verbatim: 'Дословный текст', operator_retelling: 'Пересказ оператора', authorized_snapshot: 'Снимок из DMB', operator_input: 'Запись оператора' })[value] || 'Источник';
}

export function channelLabel(value) {
  return ({ meeting: 'Встреча', email: 'Письмо', chat: 'Чат', other: 'Другой канал' })[value] || String(value || 'Канал не указан');
}

export function operationLabel(value) {
  return ({ add: 'Добавить', replace: 'Изменить', remove: 'Удалить' })[value] || 'Изменить';
}

export function riskLabel(value) {
  return ({ low: 'низкий', medium: 'средний', high: 'высокий', unknown: 'не оценён' })[value] || 'не оценён';
}

export function targetLabel(value) {
  return ({ task: 'задача', request: 'запрос', goal: 'цель' })[value] || 'объект';
}

export function findingMessage(finding) {
  const rule = String(finding?.rule_id || '');
  const messages = {
    S1_SOURCE_REQUIRED: 'Добавьте исходный текст или пересказ поручения.',
    S1_REQUESTED_ACTION: 'Подтвердите, какое действие требуется.',
    S1_EXPECTED_OUTCOME: 'Подтвердите ожидаемый результат.',
    S1_BUSINESS_PROBLEM: 'Зафиксируйте бизнес-проблему или ценность.',
    S1_SCOPE_IN: 'Укажите, что входит в объём поручения.',
    S1_SCOPE_OUT: 'Укажите, что не входит в объём поручения.',
    S1_BLOCKING_GAP: 'Закройте вопрос или укажите ответственного и следующий шаг.',
    S1_CRITICAL_CONFLICT: 'Разрешите противоречие или передайте его ответственному.',
    S1_FIDELITY_CONFIRMATION: 'Подтвердите, что паспорт соответствует исходному тексту.',
    BR_ACCEPTANCE_MEASURABLE: 'Сформулируйте критерий как наблюдаемый и проверяемый результат.',
    BR_BLOCKING_GAP: 'Закройте блокирующий вопрос до передачи на проверку.',
  };
  if (messages[rule]) return messages[rule];
  if (rule.endsWith('_CONFIRMATION')) return 'Подтвердите эту формулировку по исходному тексту.';
  if (rule.startsWith('BR_')) return `Заполните раздел «${fieldLabel(finding?.path)}».`;
  return String(finding?.rationale || 'Проверьте заполнение этого раздела.');
}
