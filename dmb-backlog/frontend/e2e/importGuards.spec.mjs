import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
test('keyboard file selection, focus trap and Escape return focus',async({page})=>{
 await mockApp(page);await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');const trigger=page.locator('#backlog-import-excel');await trigger.click();
 const zone=page.locator('#import-drop-zone');await expect(zone).toBeFocused();
 for(const key of ['Enter','Space']){const chooser=page.waitForEvent('filechooser');await zone.press(key);await chooser;}
 await page.locator('#import-close-btn').focus();await page.keyboard.press('Shift+Tab');await expect(page.locator('#import-cancel-btn')).toBeFocused();
 await page.keyboard.press('Tab');await expect(page.locator('#import-close-btn')).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('#import-tasks-overlay')).toHaveCount(0);await expect(trigger).toBeFocused();
});
for(const [name,content] of [['empty.csv',''],['broken.xlsx','bad'],['quotes.csv','title;team_id\n"broken'],['nul.csv','title;team_id\nA;B\0'],['duplicate.csv','title; TITLE ;team_id\nA;B;C'],['aliases.csv','title;Название задачи;team_id\nA;B;C']]){
 test('invalid file clears stale preview: '+name,async({page})=>{
  await mockApp(page);await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#backlog-import-excel').click();const input=page.locator('#import-file-input');
  await input.setInputFiles({name:'valid.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nЗадача;Продукт')});await expect(page.locator('#import-submit-btn')).toBeEnabled();
  await input.setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(content)});await expect(page.locator('#import-submit-btn')).toBeDisabled();
  await expect(page.locator('#import-error-summary')).toBeVisible();
  await expect(page.locator('#import-drop-zone')).toContainText('Повторный импорт создаёт новые задачи');
 });
}
