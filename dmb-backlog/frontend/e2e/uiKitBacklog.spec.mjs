import { expect, test } from '@playwright/test';

// All API traffic is local to the browser fixture; no database is used.
async function mockBacklog(page) {
  const tasks = [
    { id: 41, title: 'Согласовать требования', status_name: 'В РАБОТЕ', priority_name: 'ВЫСОКИЙ' },
    { id: 42, title: 'Обновить отчёт', status_name: 'ХОЛД', priority_name: 'СРЕДНИЙ' },
  ].map(task => ({ ...task, team_id: 7, team_name: 'Продукт', progress: 0, created_at: '2026-09-01T09:00:00Z' }));
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/work-tasks/options') return json({can_create:false,teams:[],users:[],projects:[]});
    if (path === '/reporting-meetings') return json([]);
    if (path === '/work-reports') return json({available:true,mode:'live',summary:{total:1,active:1,done:0,overdue:0,blocked:0,in_acceptance:0,proposals:0},items:[{id:41,title:'Проверочная рабочая задача',status:'in_progress',due_date:'2026-10-28'}],major_items:[],major_summary:{obligations:0,with_external_links:0}});
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json({ access_token: 'fixture-token', user: { id: 101 } });
    if (path === '/auth/me') return json({ id: 101, name: 'Аналитик', team_id: 7, team_name: 'Продукт', role_name: 'Участник команды', permissions: { customer_portal_mode: 'all', team_backlog: 'write' } });
    if (path === '/tasks/reference') return json({ statuses: [], priorities: [], deadlines: [], teams: [], projects: [], task_types: [], channels: [], departments: [], business_customers: [], did_client_groups: [], tags: [], users: [] });
    if (path === '/tasks/') return json({ items: tasks, total: tasks.length, page: 1, pages: 1, per_page: 1000 });
    if (path === '/notifications/snapshot') return json({ revision: 1, summary: { unread: 0, requires_action: 0, today: 0, by_category: {} }, recent_items: [], recent_total: 0, action_items: [], action_total: 0 });
    if (path === '/admin/display-settings/shared') return json({ settings: {} });
    return json({});
  });
}

for (const width of [1440, 390]) {
  test(`team backlog preserves search, quick filters and view switching at ${width}px`, async ({ page }) => {
    await mockBacklog(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/team-backlog');
    await expect(page.getByRole('heading', { name: 'Бэклог команды Продукт', level: 1 })).toBeVisible();
    const rows = page.locator('#team-tasks-table tbody tr[data-task-id]');
    await expect(rows).toHaveCount(2);
    const search = page.getByRole('textbox', { name: 'Поиск по ID, названию и описанию' });
    await search.fill('Согласовать');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Согласовать требования');
    await search.fill('');
    await expect(rows).toHaveCount(2);
    if (width < 1024) await page.locator('#quick-filters-mobile-toggle').click();
    const urgent = page.locator('.quick-filter-btn[data-filter="urgent"]');
    await urgent.click();
    await expect(urgent).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(1);
    await urgent.click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'Карточное представление', exact: true }).click();
    await expect(page.locator('#team-tasks-container')).toContainText('Обновить отчёт');
    await expect(page.locator('#team-tasks-table')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

for (const compact of [false,true]) for (const theme of ['light','dark']) test(`backlog and work report share rendered headers ${theme}/${compact}`,async({page},info)=>{
 await mockBacklog(page);await page.setViewportSize({width:1440,height:950});
 let baseline;
 for(const route of ['team-backlog','work-reports?meeting_id=1']){
  await page.goto('/#/'+route);
  // A concrete production consumer, not an isolated th or synthetic reference.
  const target=route==='team-backlog'?page.locator('#team-tasks-table thead').first():page.locator('.work-table thead').first();
  await expect(target).toBeVisible();
  await page.evaluate(({theme,compact})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact=String(compact);},{theme,compact});
  await page.addStyleTag({content:'*{transition:none!important}'});
  await page.evaluate(()=>document.fonts.ready);
  const actual=await target.evaluate(head=>{
   const th=[...head.querySelectorAll('th')].find(h=>h.textContent.trim()),label=th.querySelector('.th-label')||th,s=getComputedStyle(th),text=getComputedStyle(label);
   return {height:head.getBoundingClientRect().height,padding:s.padding,background:s.backgroundColor,font:text.fontSize,weight:text.fontWeight,transform:text.textTransform,spacing:text.letterSpacing};
  });
  expect(actual.height).toBeCloseTo(40,0);
  if(baseline)expect(actual).toEqual(baseline);else baseline=actual;
  await target.screenshot({path:info.outputPath(`${route.split('?')[0]}-${theme}-${compact}.png`)});
 }
});
