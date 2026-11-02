import {test,expect} from '@playwright/test';
test('admin sorting has a native keyboard target, direction, first-page reset and retained focus',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitAdminReports.html?admin_tab=users');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(async()=>{const get=window.app.api.get.bind(window.app.api);window.app.api.get=async path=>path==='/admin/users'?Array.from({length:40},(_,i)=>({id:i+1,name:'User '+i,login:'qa-'+i,is_active:true,credential_state:'ready'})):get(path);await (await import('/js/components/admin.js?v=6')).initAdmin(window.app);});
 await page.getByRole('button',{name:'Страница 2',exact:true}).click();
 const sort=page.locator('.admin-sort-th[data-sort="name"]');await expect(sort).toHaveRole('button');
 await sort.focus();await page.keyboard.press('Enter');await expect(sort.locator('..')).toHaveAttribute('aria-sort','ascending');await expect(sort).toBeFocused();
 await expect(page.locator('.ui-pagination [aria-current]')).toHaveText('1');
 await page.keyboard.press('Enter');await expect(sort.locator('..')).toHaveAttribute('aria-sort','descending');await expect(sort).toBeFocused();
 expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});

test('visible tabs work during initial loading and late completion cannot replace the selection',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitAdminReports.html?admin_tab=teams');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(async()=>{const mod=await import('/js/components/admin.js?v=6');const get=window.app.api.get.bind(window.app.api);let first=true;window.app.api.get=path=>{if(path==='/admin/teams'&&first){first=false;return new Promise(resolve=>window.releaseInitialTeams=()=>resolve([]));}return get(path);};document.getElementById('page-content').innerHTML=mod.renderAdmin(window.app);window.pendingInitialAdmin=mod.initAdmin(window.app);});
 await page.getByRole('tab',{name:'Пользователи',exact:true}).click();await expect(page.locator('#admin-content')).toHaveAttribute('data-admin-tab','users');await expect(page.locator('.admin-sort-th').first()).toBeVisible();
 await page.evaluate(async()=>{window.releaseInitialTeams();await window.pendingInitialAdmin;});await expect(page.locator('#admin-content')).toHaveAttribute('data-admin-tab','users');await expect(page.getByRole('tab',{name:'Пользователи',exact:true})).toHaveAttribute('aria-selected','true');
 expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});

async function mountReport(page,key){
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async key=>{await import('/e2e/fixtures/spaStyles.js');location.hash='/reports/detail?r='+key;const m=await import('/js/components/reports.js');const items=[10,2].map(id=>({id,title:'QA '+id,team_name:'QA',task_type_name:'AD-HOC',progress:id,planned_progress:50,progress_indicator:'green',progress_freshness:'current'}));const app={store:{get:()=>({role_name:'Администратор',permissions:{admin:'full'}})},router:{navigate(){}},api:{get:async path=>path==='/reports/'?[{id:1,key,fields:['id','title','progress']}]:path.endsWith('/execute')?{items}:[]}};document.querySelector('main').innerHTML=m.renderReportPage(app);m.initReportPage(app);},key);
 await expect(page.locator('#report-body tbody tr').first()).toBeVisible();
}
test('report sort is keyboard accessible, numeric and retains focus',async({page})=>{
 await mountReport(page,'quarterly-goals');const sort=page.locator('.report-sort-btn[data-sort-field="id"]');await sort.focus();await page.keyboard.press('Enter');await expect(sort.locator('..').locator('..')).toHaveAttribute('aria-sort','ascending');await expect(sort).toBeFocused();
 await expect(page.locator('.quarterly-goals-detail tbody tr').first().locator('td').first()).toContainText('002');await page.keyboard.press('Enter');await expect(page.locator('.quarterly-goals-detail tbody tr').first().locator('td').first()).toContainText('010');await expect(sort).toBeFocused();
});
test('report without sorting has no false sort control',async({page})=>{await mountReport(page,'reg-directors');await expect(page.locator('.report-sort-btn')).toHaveCount(0);await expect(page.locator('#report-body th[aria-sort]')).toHaveCount(0);});

test('admin loading clears actions belonging to the previous tab',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitAdminReports.html?admin_tab=users');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{const get=window.app.api.get.bind(window.app.api);window.app.api.get=path=>path==='/admin/projects'?new Promise(resolve=>window.releaseProjects=()=>resolve([])):get(path);});
 await page.getByRole('tab',{name:'Проекты',exact:true}).click();await expect(page.locator('#admin-content .view-state-loading')).toBeVisible();await expect(page.locator('#admin-sticky-bar button')).toHaveCount(0);await expect(page.locator('#admin-sticky-bar input')).toHaveCount(0);
 await page.evaluate(()=>window.releaseProjects());await expect(page.getByRole('button',{name:'Добавить проект',exact:true})).toBeVisible();expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});
