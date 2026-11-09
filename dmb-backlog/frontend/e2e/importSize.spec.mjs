import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
const limit=10*1024*1024;
async function open(page){await mockApp(page);await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#backlog-import-excel').click();}
for(const ext of ['csv','xlsx','xls'])test('size boundary before read: '+ext,async({page})=>{
 await open(page);
 await page.evaluate(()=>{window.readSizes=[];FileReader.prototype.readAsArrayBuffer=function(file){window.readSizes.push(file.size);};});
 const input=page.locator('#import-file-input');
 await input.setInputFiles({name:'boundary.'+ext,mimeType:'application/octet-stream',buffer:Buffer.alloc(limit)});
 await expect.poll(()=>page.evaluate(()=>window.readSizes)).toEqual([limit]);
 await input.setInputFiles({name:'oversize.'+ext,mimeType:'application/octet-stream',buffer:Buffer.alloc(limit+1)});
 await expect(page.locator('#import-error-summary')).toContainText('10 485 760');
 await expect(page.locator('#import-submit-btn')).toBeDisabled();
 expect(await page.evaluate(()=>window.readSizes)).toEqual([limit]);
});
test('oversize replaces preview, persists and recovers on valid file without sending',async({page})=>{
 await open(page);let requests=0;await page.route('**/api/v1/tasks/import',r=>{requests++;return r.fulfill({json:{total:1,created:1,skipped:0,errors:[]}});});
 const input=page.locator('#import-file-input');const valid={name:'ok.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nTask;Team')};
 await input.setInputFiles(valid);await expect(page.locator('#import-submit-btn')).toBeEnabled();
 await input.setInputFiles({name:'large.csv',mimeType:'text/csv',buffer:Buffer.alloc(limit+1)});
 await expect(page.locator('#import-error-summary')).toBeVisible();await expect(page.locator('#import-preview-section')).toBeHidden();await expect(page.locator('#import-submit-btn')).toBeDisabled();expect(requests).toBe(0);
 await input.setInputFiles(valid);await expect(page.locator('#import-error-summary')).toBeHidden();await expect(page.locator('#import-submit-btn')).toBeEnabled();
});
test('expanded Excel is rejected before POST',async({page})=>{
 await open(page);let requests=0;await page.route('**/api/v1/tasks/import',r=>{requests++;return r.fulfill({json:{}});});
 await page.evaluate(()=>{window.XLSX={read:()=>({SheetNames:['Tasks'],Sheets:{Tasks:{}}}),utils:{sheet_to_json:()=>[['title','team_id','description'],['Task','Team','я'.repeat(6*1024*1024)]]}};});
 await page.locator('#import-file-input').setInputFiles({name:'small.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('stub')});
 await expect(page.locator('#import-submit-btn')).toBeEnabled();await page.locator('#import-submit-btn').click();
 await expect(page.locator('#import-error-summary')).toContainText('После преобразования Excel');await expect(page.locator('#import-submit-btn')).toBeDisabled();expect(requests).toBe(0);
});
test('server 413 remains inline',async({page})=>{
 await open(page);await page.route('**/api/v1/tasks/import',r=>r.fulfill({status:413,json:{detail:'too large'}}));
 await page.locator('#import-file-input').setInputFiles({name:'ok.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nTask;Team')});await page.locator('#import-submit-btn').click();
 await expect(page.locator('#import-error-summary')).toContainText('10 МиБ');await expect(page.locator('#import-submit-btn')).toBeDisabled();
});
