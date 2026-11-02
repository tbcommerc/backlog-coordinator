const actions = { import: 'Импорт', create: 'Создание', update: 'Изменение', delete: 'Удаление', bulk_update: 'Массовое изменение', archive: 'Архивация', restore: 'Восстановление' };
const entities = { stories: 'Истории', timeline: 'События таймлайна', tasks_bulk: 'Массовая обработка задач', user_notification_preferences: 'Настройки уведомлений', 'reporting-meetings': 'Отчётные встречи', reporting_meetings: 'Отчётные встречи', task_comments: 'Комментарии задач', 'quick-estimate': 'Экспресс-оценка', admin: 'Администрирование', agent: 'ИИ-ассистент', agent_sessions: 'Диалоги ИИ-ассистента', dictionary_items: 'Значения справочников', auth: 'Вход в систему', notifications: 'Уведомления', meeting_captures: 'Поручения из встреч', requirement_requests: 'Запросы требований', task_attachments: 'Вложения задач', task_reporting_statuses: 'Отчётные статусы задач', task: 'Задача', tasks: 'Задачи', team: 'Команда', teams: 'Команды', user: 'Пользователь', users: 'Пользователи', role: 'Роль', roles: 'Роли', project: 'Проект', projects: 'Проекты', dictionary: 'Справочник', dictionary_item: 'Значение справочника', priority: 'Приоритет', priorities: 'Приоритеты', status: 'Статус', statuses: 'Статусы', tag: 'Тег', tags: 'Теги', 'business-customers': 'Бизнес-заказчики', 'display-settings': 'Настройки отображения', 'field-labels': 'Названия полей', 'column-labels': 'Названия колонок', 'notification-templates': 'Шаблоны уведомлений', 'competency-costs': 'Стоимость компетенций', 'task-types': 'Типы задач', 'team-types': 'Типы команд', 'project-statuses': 'Статусы проектов', channels: 'Каналы', deadlines: 'Сроки', departments: 'Подразделения', report: 'Отчёт', reports: 'Отчёты' };
export const auditActionLabel = value => actions[String(value || '').toLowerCase()] || 'Другое действие';
Object.assign(entities, {
  work_tasks: 'Рабочие задачи', work_attachments: 'Вложения рабочих задач',
  work_dependencies: 'Зависимости рабочих задач', work_history: 'История рабочих задач',
  work_resolutions: 'Результаты рабочих задач', work_comments: 'Комментарии рабочих задач',
  work_task_templates: 'Шаблоны рабочих задач', work_meeting_snapshots: 'Снимки рабочих задач для встреч',
  request_work_links: 'Связи запросов с рабочими задачами', meeting_actions: 'Поручения встреч',
  kr_metrics: 'Метрики', kr_periods: 'Периоды метрик', kr_measurements: 'Замеры метрик',
  kr_history: 'История метрик', kr_comments: 'Комментарии метрик', kr_links: 'Связи метрик',
  kr_reporting_statuses: 'Отчётные статусы метрик', kr_files: 'Файлы метрик',
});
export const auditEntityLabel = value => {
  const key = String(value || '').trim().toLowerCase();
  return entities[key] || (key ? `Другой объект (${key})` : 'Другой объект');
};
export const credentialLabel = value => ({ ready: 'Готова ко входу', invited: 'Ожидает активации', reset_required: 'Требуется смена пароля' })[value || 'invited'] || 'Неизвестное состояние';
