import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
test('history renders attachment and empty values as user-facing text',async({page})=>{
 await page.goto('/e2e/fixtures/taskCardIncrement.html#/tasks?task=42');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>window.__taskCardFixture.history.push({field_name:'attachment',field_label:'attachment',old_value:'None',new_value:'audit.txt',changed_by_name:'Тест',changed_at:'2026-10-17T10:00:00Z'}));
 await page.locator('#task-tab-log').click();const row=page.locator('#mbody tr').filter({hasText:'audit.txt'});await expect(row).toContainText('Вложение');await expect(row).toContainText('—');await expect(row).not.toContainText('None');await expect(row).not.toContainText('attachment');
});
test('conflict choices name field and version and preserve cancelled draft',async({page})=>{
 await page.goto('/e2e/fixtures/taskCardIncrement.html#/tasks?task=42');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{window.app.api.patch=async()=>{throw {status:409,data:{detail:{task:{...window.__taskCardFixture.task,progress:20,version:2},current_version:2,submitted_version:1}}};};});
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.locator('[data-k="progress"]').fill('25');await page.locator('#saveBtn').click();
 const dialog=page.getByRole('alertdialog',{name:'Конфликт версий'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('columnheader',{name:'Серверная версия',exact:true})).toBeVisible();await expect(dialog.getByRole('columnheader',{name:'Моя версия',exact:true})).toBeVisible();
 await expect(dialog.getByRole('radio',{name:'Оставить серверное значение: Прогресс',exact:true})).toBeChecked();await dialog.getByRole('radio',{name:'Использовать моё значение: Прогресс',exact:true}).check();
 await page.locator('#cc-btn-cancel').click();await expect(page.locator('[data-k="progress"]')).toHaveValue('25');
});
