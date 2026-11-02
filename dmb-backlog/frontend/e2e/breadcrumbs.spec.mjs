import {test, expect} from '@playwright/test';
for (const width of [1440,390,320]) test(`breadcrumbs hierarchy ${width}`,async({page})=>{
 await page.setViewportSize({width,height:700});
 await page.route('**/api/v1/**',r=>r.fulfill({json:r.request().url().includes('/options')?{can_create:false,teams:[],users:[],projects:[]}:{items:[],total:0,summary:{}}}));
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks');
 await expect(page.locator('#breadcrumb-nav')).toContainText('Рабочие задачи');
 await page.evaluate(()=>{document.getElementById("fixture-sidebar").remove();window.app.store.get=()=>({id:1,permissions:{admin:'full'}});for(const r of Object.values(window.app.router.routes)){r.render=()=>'<h1>Заголовок</h1>';r.init=()=>{};}});
 for(const [path,name,parent] of [['/dashboard','Главная',null],['/backlog','Бэклог DMB','/dashboard'],['/customer/create','ИИ-ассистент','/customer'],['/reports/detail','Статус-отчёт','/reports'],['/account/security','Безопасность аккаунта','/dashboard'],['/analytics/tribe','Аналитика ЛТ','/dashboard'],['/admin','Администрирование','/dashboard'],['/work-projects?project=42','Обзор проекта','/work-projects'],['/work-tasks/42','Рабочая задача','/work-tasks']]){
  await page.evaluate(p=>{location.hash=p;},path);
  await expect(page.locator('#breadcrumb-nav [aria-current="page"]')).toHaveText(name);
  await expect(page.locator('#breadcrumb-nav')).toBeVisible();
  if(parent)await expect(page.locator(`#breadcrumb-nav a[href="#${parent}"]`)).toBeVisible();
  if(path === '/reports/detail') {
    await page.locator('#breadcrumb-nav a[href="#/reports"]').click();
    await expect(page.locator('#breadcrumb-nav [aria-current="page"]')).toHaveText('Статусы для встреч');
  }
 }
});
