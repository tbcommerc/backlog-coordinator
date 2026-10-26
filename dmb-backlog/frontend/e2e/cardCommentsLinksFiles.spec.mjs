import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
async function open(page,tab){await page.goto('/e2e/fixtures/taskCardIncrement.html#/tasks?task=42');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await page.locator('#task-tab-'+tab).click();}
for(const changed of [false,true])test('comment completion preserves only new draft: '+changed,async({page})=>{
 await open(page,'com');await page.evaluate(()=>{window.app.api.post=(url,payload)=>new Promise(resolve=>{window.finishComment=()=>{window.__taskCardFixture.comments.push({id:999,user_id:99,user_name:'QA',text:payload.text,replies:[],created_at:'2026-10-17T10:00:00Z'});resolve({});};});});
 await page.locator('#comment-textarea').fill('Отправленный текст');await page.locator('#comment-submit-btn').click();await expect(page.locator('#comment-submit-btn')).toHaveAttribute('aria-busy','true');
 if(changed)await page.locator('#comment-textarea').fill('Новый черновик');
 await page.evaluate(()=>window.finishComment());await expect(page.locator('#task-tab-com')).toContainText('3');await expect(page.locator('#comment-textarea')).toHaveValue(changed?'Новый черновик':'');
 if(changed){await expect(page.locator('#comment-submit-btn')).toBeEnabled();await expect(page.locator('#comment-draft-status')).toBeVisible();}else{await expect(page.locator('#comment-submit-btn')).toBeDisabled();await expect(page.locator('#comment-draft-status')).toBeHidden();}
});
test('deleting attachments refreshes heading and tab without reload',async({page})=>{
 await open(page,'sys');await page.evaluate(()=>{window.app.api.delete=async url=>{const a=window.__taskCardFixture.attachments;const id=Number(url.split('/attachments/')[1].split('?')[0]);a.splice(a.findIndex(x=>x.id===id),1);return {};};});
 const ids=await page.evaluate(()=>window.__taskCardFixture.attachments.map(x=>x.id));
 for(let i=0;i<ids.length;i++){await page.evaluate(id=>window.__deleteAttachment(42,id),ids[i]);const n=ids.length-i-1;await expect(page.locator('#task-files-heading')).toHaveText('Файлы'+(n?' · '+n:''));await expect(page.locator('#task-tab-sys')).toHaveText('Ссылки и файлы'+(n?' · '+n:''));expect(await page.evaluate(()=>window.__taskCardFixture.attachments.length)).toBe(n);}
});
for(const route of ['backlog','team-backlog'])for(const format of ['array','json','csv'])test('all Jira links: '+route+' '+format,async({page})=>{
 const {tasks}=await mockApp(page);const links=['https://jira.example.com/A-1','https://jira.example.com/A-2'];tasks[0].link_jira=format==='array'?links:format==='json'?JSON.stringify(links):links.join(', ');
 await page.addInitScript(()=>{for(const key of ['dmb_backlog_columns_v1','dmb_team_columns_v1'])localStorage.setItem(key,JSON.stringify({settings:{link_jira:true}}));});await page.goto('/#/'+route);const row=page.locator('tr[data-task-id="41"]');for(const href of links)await expect(row.locator('a[href="'+href+'"]')).toBeVisible();
});
