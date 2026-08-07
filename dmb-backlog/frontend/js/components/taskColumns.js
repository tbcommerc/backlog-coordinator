console.log('[DMB] taskColumns.js v1 loaded');

export const TASK_COLUMNS = [
  { key: 'id', labelKey: 'id', group: 'основные', def: true },
  { key: 'title', labelKey: 'title', group: 'основные', def: true },
  { key: 'description', labelKey: 'description', group: 'основные', def: false },
  { key: 'date_received', labelKey: 'date_received', group: 'основные', def: false },
  { key: 'status', labelKey: 'status_id', group: 'основные', def: true },
  { key: 'priority', labelKey: 'priority_id', group: 'основные', def: true },
  { key: 'team', labelKey: 'team_id', group: 'основные', def: true },
  { key: 'channel', labelKey: 'channel_id', group: 'основные', def: false },
  { key: 'business_customer', labelKey: 'business_customer_id', group: 'основные', def: false },
  { key: 'department', labelKey: 'department_id', group: 'основные', def: false },
  { key: 'project', labelKey: 'project_id', group: 'основные', def: false },
  { key: 'task_type', labelKey: 'task_type_id', group: 'основные', def: false },
  { key: 'involved_teams', labelKey: 'involved_teams', group: 'основные', def: false },
  { key: 'deadline', labelKey: 'deadline_id', group: 'основные', def: true },
  { key: 'owner', labelKey: 'owner_id', group: 'основные', def: false },
  { key: 'created_by', labelKey: 'created_by', group: 'основные', def: false },
  { key: 'created_at', labelKey: 'created_at', group: 'основные', def: false },
  { key: 'updated_at', labelKey: 'updated_at', group: 'основные', def: false },

  { key: 'effort_days', labelKey: 'effort_days', group: 'трудозатраты', def: true },
  { key: 'effort_rub', labelKey: 'effort_rub', group: 'трудозатраты', def: false },
  { key: 'effort_designee', labelKey: 'effort_designee', group: 'трудозатраты', def: false },
  { key: 'effort_analytics', labelKey: 'effort_analytics', group: 'трудозатраты', def: false },
  { key: 'effort_be', labelKey: 'effort_be', group: 'трудозатраты', def: false },
  { key: 'effort_python_be', labelKey: 'effort_python_be', group: 'трудозатраты', def: false },
  { key: 'effort_fe', labelKey: 'effort_fe', group: 'трудозатраты', def: false },
  { key: 'effort_test', labelKey: 'effort_test', group: 'трудозатраты', def: false },
  { key: 'effort_test_auto', labelKey: 'effort_test_auto', group: 'трудозатраты', def: false },
  { key: 'effort_delivery', labelKey: 'effort_delivery', group: 'трудозатраты', def: false },
  { key: 'actual_effort_days', labelKey: 'actual_effort_days', group: 'трудозатраты', def: false },
  { key: 'actual_effort_designee', labelKey: 'actual_effort_designee', group: 'трудозатраты', def: false },
  { key: 'actual_effort_analytics', labelKey: 'actual_effort_analytics', group: 'трудозатраты', def: false },
  { key: 'actual_effort_be', labelKey: 'actual_effort_be', group: 'трудозатраты', def: false },
  { key: 'actual_effort_fe', labelKey: 'actual_effort_fe', group: 'трудозатраты', def: false },
  { key: 'actual_effort_test', labelKey: 'actual_effort_test', group: 'трудозатраты', def: false },
  { key: 'actual_effort_test_auto', labelKey: 'actual_effort_test_auto', group: 'трудозатраты', def: false },
  { key: 'actual_effort_python_be', labelKey: 'actual_effort_python_be', group: 'трудозатраты', def: false },
  { key: 'actual_effort_delivery', labelKey: 'actual_effort_delivery', group: 'трудозатраты', def: false },

  { key: 'financial_effect', labelKey: 'financial_effect', group: 'ценность', def: true },
  { key: 'financial_effect_justification', labelKey: 'financial_effect_justification', group: 'ценность', def: false },
  { key: 'cv', labelKey: 'cv', group: 'ценность', def: true },
  { key: 'metric_kr_plan', labelKey: 'metric_kr_plan', group: 'ценность', def: false },
  { key: 'metric_kr_fact', labelKey: 'metric_kr_fact', group: 'ценность', def: false },
  { key: 'metric_kr_unit', labelKey: 'metric_kr_unit', group: 'ценность', def: false },

  { key: 'progress', labelKey: 'progress', group: 'основные', def: true },
  { key: 'key_project_status', labelKey: 'key_project_status', group: 'статусы', def: false },
  { key: 'key_project_status_updated_at', labelKey: 'key_project_status_updated_at', group: 'статусы', def: false },
  { key: 'directorate_status', labelKey: 'directorate_status', group: 'статусы', def: false },
  { key: 'directorate_status_updated_at', labelKey: 'directorate_status_updated_at', group: 'статусы', def: false },
  { key: 'did_status', labelKey: 'did_status', group: 'статусы', def: false },
  { key: 'did_status_updated_at', labelKey: 'did_status_updated_at', group: 'статусы', def: false },
  { key: 'did_demo', labelKey: 'did_demo', group: 'статусы', def: false },

  { key: 'link_mockups', labelKey: 'link_mockups', group: 'прочее', def: false },
  { key: 'link_jira', labelKey: 'link_jira', group: 'прочее', def: false },
  { key: 'tags', labelKey: 'tags', group: 'прочее', def: false },
  { key: 'rejection_reason', labelKey: 'rejection_reason', group: 'прочее', def: false },
  { key: 'comment', labelKey: 'comment', group: 'прочее', def: false },
];

const FALLBACK_LABELS = {
  id: 'ID', title: 'Задача', description: 'Описание', date_received: 'Дата получения',
  status: 'Статус', priority: 'Приоритет', team: 'Команда',
  channel: 'Канал', business_customer: 'Бизнес-заказчик', department: 'Подразделение',
  project: 'Проект', task_type: 'Тип задачи', involved_teams: 'Вовлечённые команды',
  deadline: 'Дедлайн',
  owner: 'Владелец',
  created_by: 'Автор задачи', created_at: 'Дата создания',
  updated_at: 'Дата последнего изменения',
  effort_days: 'Трудозатраты (дни)', effort_rub: 'Трудозатраты (руб)',
  effort_designee: 'Designee (ЭО)', effort_analytics: 'Аналитика (ЭО)',
  effort_be: 'Разработка BE (ЭО)', effort_python_be: 'Разработка python BE (ЭО)',
  effort_fe: 'Разработка FE (ЭО)', effort_test: 'Test (ЭО)',
  effort_test_auto: 'Test Auto (ЭО)', effort_delivery: 'Delivery (ЭО)',
  actual_effort_days: 'Фактические трудозатраты (ч/д)',
  actual_effort_designee: 'Designee (ФТЗ)', actual_effort_analytics: 'Аналитика (ФТЗ)',
  actual_effort_be: 'Разработка BE (ФТЗ)', actual_effort_fe: 'Разработка FE (ФТЗ)',
  actual_effort_test: 'Test (ФТЗ)', actual_effort_test_auto: 'Test Auto (ФТЗ)',
  actual_effort_python_be: 'Разработка python BE (ФТЗ)', actual_effort_delivery: 'Delivery (ФТЗ)',
  financial_effect: 'Фин. эффект', financial_effect_justification: 'Обоснование фин. эффекта',
  cv: 'C/V',
  progress: 'Прогресс',
  key_project_status: 'Статус ключ. проекта',
  key_project_status_updated_at: 'Дата статуса ключ. проекта',
  directorate_status: 'Статус для директорской',
  directorate_status_updated_at: 'Дата статуса (директорская)',
  did_status: 'Статус для ДИД', did_status_updated_at: 'Дата статуса (ДИД)',
  did_demo: 'Демо для ДИД',
  metric_kr_plan: 'Метрический KR (план)', metric_kr_fact: 'Метрический KR (факт)',
  metric_kr_unit: 'Единица измерения (метрический KR)',
  link_mockups: 'Ссылка на макеты', link_jira: 'Ссылка на Jira',
  tags: 'Метки (теги)',
  rejection_reason: 'Причина отклонения', comment: 'Комментарий',
};

export function buildColumnLabels(fieldLabels) {
  const labels = {};
  TASK_COLUMNS.forEach(c => {
    const db = fieldLabels && fieldLabels[c.labelKey];
    labels[c.key] = db || FALLBACK_LABELS[c.key] || c.key;
  });
  return labels;
}

export function buildColumnSettings(saved = {}, defaults = {}) {
  const settings = {};
  TASK_COLUMNS.forEach(c => {
    if (saved[c.key] !== undefined) {
      settings[c.key] = !!saved[c.key];
    } else if (defaults[c.key] !== undefined) {
      settings[c.key] = !!defaults[c.key];
    } else {
      settings[c.key] = c.def;
    }
  });
  return settings;
}

export function getAllColumnKeys() {
  return TASK_COLUMNS.map(c => c.key);
}
