export function formatCreatedDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
}

export function supplementalTaskValue(key, task) {
  if (key === 'created_by') return task.created_by_name || '—';
  if (key === 'financial_effect_justification') return task[key] || '—';
  if (['key_project_status_updated_at','directorate_status_updated_at','did_status_updated_at'].includes(key)) return task[key] ? String(task[key]).slice(0,10) : '—';
  if (key === 'did_demo') return task.did_demo == null ? '—' : task.did_demo ? 'Да' : 'Нет';
  return undefined;
}

export function quickSaveConfirmation(count) {
  const lastTwo = count % 100;
  const singular = count % 10 === 1 && lastTwo !== 11;
  const few = count % 10 >= 2 && count % 10 <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  const noun = singular ? 'изменение' : few ? 'изменения' : 'изменений';
  return (singular ? 'Будет сохранено ' : 'Будут сохранены ') + count + ' ' + noun + '. Продолжить?';
}

// Semantic UI roles, independent of theme and concrete colour values.
export function taskStatusTone(status) {
  const name = String(status ?? '').trim().toLocaleUpperCase('ru-RU');
  return ({ 'В РАБОТЕ': 'info', 'ВЫПОЛНЕНА': 'success', 'ОТКЛОНЕНА': 'danger', 'ПРИНЯТА В РАБОТУ': 'info',
    'ПРИНЯТИЕ РЕШЕНИЯ': 'warning', 'ХОЛД': 'accent', 'ЭСКАЛАЦИЯ НА ЛТ': 'accent' })[name] || 'neutral';
}
export function taskPriorityTone(priority) {
  const name = String(priority ?? '').trim().toLocaleUpperCase('ru-RU');
  return ({ 'ВЫСОКИЙ': 'danger', 'СРЕДНИЙ': 'warning' })[name] || 'neutral';
}
