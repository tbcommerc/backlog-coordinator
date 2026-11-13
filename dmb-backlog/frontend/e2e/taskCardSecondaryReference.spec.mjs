import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const approved = resolve('../artifacts/task-card-design-proposal-2026-11-09');
const output = resolve('artifacts/task-card-secondary-reference-2026-11-11');
const tabs = {report:'rep',comments:'com',files:'sys',history:'log',work:'work'};
for (const width of [1440,390]) test(`secondary reference comparison ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===1440?960:844});
  await page.clock.setFixedTime(new Date('2026-11-09T12:00:00Z'));
  await mkdir(output,{recursive:true});
  await page.route('**/approved-proposal/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({body:await readFile(resolve(approved,name)),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(name)]});
  });
  await page.route('**/static/**',route=>route.continue({url:route.request().url().replace('/static/','/')}));
  const data={};
  for(const [reference,tab] of Object.entries(tabs)){
    await page.goto('/approved-proposal/index.html?state='+reference);
    await expect(page.locator('body')).toHaveAttribute('data-ready',reference);
    await page.evaluate(()=>document.fonts.ready);
    const referenceGeometry=await page.locator('.task-body').evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),rows:[...el.querySelectorAll('.work-row,.comment,.link-row')].map(row=>({className:row.className,height:row.getBoundingClientRect().height}))}));
    await page.screenshot({path:resolve(output,`reference-${reference}-${width}.png`)});
    await page.goto('/e2e/fixtures/taskCardIncrement.html?profile=proposal#/tasks?task=42');
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    await page.locator('#task-tab-'+tab).click();
    if(tab==='rep')await expect(page.locator('.ui-task-report')).toHaveCount(3);
    if(tab==='sys')await expect(page.locator('.attachment-item')).toHaveCount(2);
    if(tab==='work')await expect(page.locator('.ui-task-work-row')).toHaveCount(3);
    if(tab==='log')await expect(page.locator('.ui-task-history-item')).toHaveCount(5);
    if(tab==='com'){
      await expect(page.locator('#comment-textarea')).toBeVisible();
      await page.locator('#comment-textarea').fill('Добавила сценарий в критерии приёмки.');
    }
    await page.locator('#task-detail-title').click();
    await page.locator('#mbody').evaluate(el=>{el.scrollTop=0;});
    await page.evaluate(()=>document.fonts.ready);
    data[tab]=await page.locator('#mbody').evaluate(el=>({rect:el.getBoundingClientRect().toJSON(),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,overflow:el.scrollWidth>el.clientWidth+1,text:el.innerText}));
    data[tab].reference=referenceGeometry;
    data[tab].rows=await page.locator('#mbody').evaluate(el=>[...el.querySelectorAll('.ui-task-work-row,.comment-item,.ui-task-material-row')].map(row=>({className:row.className,height:row.getBoundingClientRect().height})));
    await page.screenshot({path:resolve(output,`actual-${reference}-${width}.png`)});
  }
  await writeFile(resolve(output,`geometry-${width}.json`),JSON.stringify(data,null,2));
});
