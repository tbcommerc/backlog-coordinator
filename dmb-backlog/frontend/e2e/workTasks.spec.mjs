import { test, expect } from '@playwright/test';
test('create and preserve conflict draft', async ({page}) => {
 let created;
 const task={id:1,public_id:'WRK-1',title:'Проверка',description:'Отчёт',work_direction:'organizational',execution_team_id:10,assignee_id:1,due_date:'2026-11-01',acceptor_id:null,status:'new',assignment_state:'accepted',version:1,available_actions:['ready','cancelled'],can_edit:true,can_collaborate:true,can_place:true};
 await page.route('**/api/v1/work-tasks**', async route => {
  const req=route.request(), path=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path.endsWith('/options'))return reply({can_create:true,teams:[{id:10,name:'Команда'}],users:[{id:1,name:'Исполнитель',team_id:10}],projects:[]});
  if(req.method()==='POST'){created=req.postDataJSON();return reply({...task,...created},201);}
  if(req.method()==='PATCH')return reply({detail:'Конфликт версии'},409);
  if(/\/(comments|history|attachments)$/.test(path))return reply([]);
  if(path.endsWith('/1'))return reply(task);
  return reply({items:[task],total:1,summary:{total:1,done:0,overdue:0,in_acceptance:0}});
 });
 await page.goto('/e2e/fixtures/workTasks.html?presentation=modal');
 await page.getByRole('button',{name:'Создать задачу'}).click();
 await page.locator('#wf-title').fill('Новое поручение');
 await page.getByRole('button',{name:'Создать',exact:true}).click();
 await expect(page.locator('dialog')).toHaveCount(0);
 expect(created.title).toBe('Новое поручение'); expect(created.execution_team_id).toBe(10);
 await page.getByRole('button',{name:'WRK-1 · Проверка'}).click();
 await page.locator('#wf-title').fill('Мой черновик');
 await page.getByRole('button',{name:'Сохранить изменения'}).click();
 await expect(page.getByRole('alert')).toContainText('Черновик сохранён');
 await page.keyboard.press('Escape');
 await expect(page.locator('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'WRK-1 · Проверка'})).toBeFocused();
 await page.getByRole('button',{name:'WRK-1 · Проверка'}).click();
 await expect(page.locator('#wf-title')).toHaveValue('Мой черновик');
 await page.screenshot({path:'test-results/work-dialog.png'});
});
test('mobile empty list fits viewport', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/v1/work-tasks**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({items:[],total:0,summary:{total:0,done:0,overdue:0,in_acceptance:0}})}));
 await page.goto('/e2e/fixtures/workTasks.html');
 await expect(page.getByText('Задачи не найдены')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
