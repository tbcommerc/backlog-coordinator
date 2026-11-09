// The real SPA and components, with all API requests intercepted: no database writes.
export async function mockApp(page, { readonly = false, count = 3, conflict = false } = {}) {
  const user = { id: 101, name: 'Тест', team_id: 7, team_name: 'Продукт',
    role_name: readonly ? 'BA/Участник команды' : 'Администратор',
    permissions: { backlog_dmb: readonly ? 'read' : 'read_write', backlog_team: readonly ? 'read_own' : 'write_all', task_edit: readonly ? 'none' : 'all' } };
  const tasks = [
    { id: 41, title: 'Первая задача', description: 'уникальное описание', priority_name: 'ВЫСОКИЙ' },
    { id: 42, title: 'Вторая задача', description: 'другая', priority_name: 'СРЕДНИЙ' },
    { id: 43, title: 'Чужая задача', description: 'другая', priority_name: 'ВЫСОКИЙ', team_id: 8 },
  ].map(task => ({ team_id: 7, team_name: 'Продукт', version: 1, status_name: 'В РАБОТЕ', status_id: 1,
    progress: 0, owner_id: null, project_id: null, business_customer_id: null, task_type_id: null,
    created_at: '2026-09-01T09:00:00Z', ...task }));
  while (tasks.length < count) tasks.push({ ...tasks[0], id: 41 + tasks.length, title: `Задача ${41 + tasks.length}` });
  const reference = { statuses: [{ id: 1, name: 'В РАБОТЕ' }], priorities: [], deadlines: [],
    teams: [{ id: 7, name: 'Продукт' }], projects: [{ id: 1, name: 'Первый проект' }],
    task_types: [{ id: 1, name: 'AD-HOC' }], channels: [], departments: [],
    business_customers: [{ id: 1, name: 'Первый заказчик' }], did_client_groups: [], tags: [],
    users: [{ id: 101, name: 'Первый исполнитель' }] };
  const writes = [];
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json({ access_token: 'fixture-token', user });
    if (path === '/auth/me') return json(user);
    if (path === '/tasks/reference') return json(reference);
    if (path === '/tasks/') {
      const items = tasks.filter(task => !url.searchParams.has('team_id') || task.team_id === Number(url.searchParams.get('team_id')));
      return json({ items, total: items.length, page: 1, pages: 1, per_page: 1000 });
    }
    if (/^\/tasks\/\d+$/.test(path)) {
      const task = tasks.find(task => task.id === Number(path.split('/').at(-1)));
      if (['PUT', 'PATCH'].includes(route.request().method())) {
        const data = route.request().postDataJSON();
        if (conflict && data.version !== task.version) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: { task, current_version: task.version, submitted_version: data.version } }) });
        writes.push(data);
        Object.assign(task, data, { version: task.version + 1 });
      }
      return json(task);
    }
    if (path.includes('/lock')) return json({ locked: false, acquired: true });
    if (path.endsWith('/history') || path.endsWith('/comments') || path.endsWith('/attachments')) return json([]);
    if (path.endsWith('/reporting-context') || path.endsWith('/reporting-statuses/context')) return json({ items: [] });
    if (path === '/notifications/snapshot') return json({ revision: 1, summary: { unread: 0, requires_action: 0, today: 0, by_category: {} }, recent_items: [], recent_total: 0, action_items: [], action_total: 0 });
    if (path === '/admin/display-settings/shared') return json({ settings: {} });
    const key = path.replace(/^\/admin\//, '').replace(/^\//, '').replace(/\/$/, '').replaceAll('-', '_');
    return json(reference[key] || []);
  });
  return { tasks, writes };
}

