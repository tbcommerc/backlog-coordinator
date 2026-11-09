import { mockApp } from './backlogMock.mjs';

// In-memory presentation data only. Every API request is intercepted by mockApp.
export async function setupWorkDesignPilot(page, { theme = 'light', editable = false, empty = false } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-04T09:00:00Z'));
  await mockApp(page);
  await page.addInitScript(theme => localStorage.setItem('dmb_theme', theme), theme);
  const rows = [
    ['Уточнить источники данных для бюджетирования', 'in_progress', 'high', '2026-11-03', 'Бюджетирование IT-проектов'],
    ['Подготовить шаблон протокола проектной встречи', 'in_acceptance', 'normal', '2026-11-06', 'Автоматизация протоколов встреч'],
    ['Согласовать критерии готовности и порядок проверки результата с участниками межкомандного процесса', 'ready', 'high', '2026-11-09', 'Развитие внутреннего реестра и согласования требований'],
    ['Подготовить вопросы к ретроспективе', 'new', 'normal', null, null],
    ['Проверить согласованный результат', 'in_progress', 'normal', '2026-11-10', 'Квартальное планирование'],
    ['Обновить инструкцию по приёмке', 'ready', 'normal', '2026-11-12', null],
    ['Подготовить план демонстрации', 'ready', 'normal', '2026-11-13', 'Квартальное планирование'],
    ['Согласовать состав отчёта', 'new', 'normal', null, null],
  ].map(([title, status, priority, due_date, context], i) => ({
    id: 76 + i, public_id: `WRK-${76 + i}`, title, status, priority, due_date,
    context: context ? { title: context } : null, version: 1,
    description: 'Подготовить единый шаблон протокола: решения встречи, ответственные и сроки. Проверить его на двух проектных встречах и передать команде пример заполнения.',
    result_text: i === 1 ? 'Шаблон согласован с участниками. Добавлены разделы решений, поручений и открытых вопросов.' : null,
    assignee_id: 101, assignee_name: 'Александр Константинопольский',
    requester_id: 101, requester_name: 'Мария Соколова', acceptor_id: 102, acceptor_name: 'Виктор Стодольский',
    execution_team_id: 7, work_direction: 'organizational', assignment_state: 'accepted',
    acceptance_required: true, can_edit: editable, can_collaborate: true, can_check: false,
    available_actions: i === 1 ? ['done', 'in_progress', 'cancelled'] : ['in_acceptance', 'cancelled'],
    checklist: [{ id: 1, title: 'Согласовать структуру', completed: true }, { id: 2, title: 'Проверить на реальной встрече', completed: false }],
    checklist_progress: { done: 1, total: 2 },
  }));
  const writes = [];
  await page.route('**/api/v1/work-tasks**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== 'GET') {
      writes.push({ method: request.method(), path, data: request.postDataJSON() });
      return route.fulfill({ status: 503, json: { detail: 'Тестовая ошибка сохранения. Данные не изменены.' } });
    }
    let data;
    if (path.endsWith('/options')) data = { can_create: true, board_enabled: true,
      teams: [{ id: 7, name: 'Продуктовая команда' }], users: [
        { id: 101, name: 'Александр Константинопольский', team_id: 7 },
        { id: 102, name: 'Виктор Стодольский', team_id: 7 },
      ], projects: [] };
    else if (/\/work-tasks\/\d+$/.test(path)) data = rows.find(row => row.id === Number(path.split('/').at(-1)));
    else if (/\/(comments|history|attachments|dependencies|templates)$/.test(path)) data = [];
    else {
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const items = empty ? [] : rows.filter(row => row.title.toLowerCase().includes(query));
      data = { items, total: items.length, summary: { total: items.length },
        collection_counts: { mine: 8, acceptance: 2, requested: 5, team: 18, all: 43 },
        focus_counts: { today: 0, overdue: 1 } };
    }
    return route.fulfill({ json: data ?? [] });
  });
  await page.goto('/#/work-tasks');
  await page.locator('.work-task-workplace').waitFor();
  await page.locator('.work-results').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { rows, writes };
}
