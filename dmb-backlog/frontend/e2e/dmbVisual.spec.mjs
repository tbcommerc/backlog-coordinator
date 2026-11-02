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

for (const width of [1440,1280,390,320]) for(const theme of ['light','dark']) test(`DMB visual ${width} ${theme}`,async({page},info)=>{
 await mockBacklog(page);await page.setViewportSize({width,height:900});
 await page.goto('/#/backlog');
 await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.getByRole('heading',{name:'Бэклог DMB',exact:true})).toBeVisible();
 await expect(page.locator('#breadcrumb-nav')).toBeVisible();
 await expect(page.locator('#breadcrumb-nav a[href="#/dashboard"]')).toBeVisible();
 await expect(page.locator('#breadcrumb-nav [aria-current="page"]')).toHaveText('Бэклог DMB');
 expect(await page.locator('#breadcrumb-nav').evaluate(el => el.clientWidth > 0)).toBe(true);
 expect((await page.locator('#f-backlog-search').boundingBox()).width).toBeGreaterThan(200);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('dmb.png'),fullPage:true});
 await page.locator('#btn-ext-backlog').click();
 await expect(page.getByRole('dialog',{name:'Все фильтры',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('filters.png')});
});
