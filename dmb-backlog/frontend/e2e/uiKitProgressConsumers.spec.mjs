import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
for(const scope of ['backlog','team-backlog'])test('unknown and boundary progress in '+scope,async({page})=>{
 await page.setViewportSize({width:1600,height:1000});const data=await mockApp(page);data.tasks.forEach((task,i)=>task.progress=[null,0,100][i]);await page.goto('/#/'+scope);
 for(const [i,value]of [null,0,100].entries()){const row=page.locator('tr[data-task-id="'+(41+i)+'"]');if(scope==='team-backlog'&&i===2)continue;const progress=row.getByRole('progressbar');await expect(progress).toBeVisible();if(value===null){await expect(progress).not.toHaveAttribute('aria-valuenow');await expect(progress).toHaveAttribute('aria-valuetext','Нет данных');}else await expect(progress).toHaveAttribute('aria-valuenow',String(value));}
 expect(data.writes).toEqual([]);
});
test('mini task cards preserve unknown progress and show each value once',async({page})=>{
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');await page.evaluate(async()=>{const {renderTaskCard}=await import('/js/components/modal.js');document.querySelector('main').innerHTML=[null,0,100].map((progress,i)=>'<section data-fixture-progress="'+i+'">'+renderTaskCard({id:41+i,title:'QA progress',progress})+'</section>').join('');});
 for(const [i,value]of [null,0,100].entries()){const root=page.locator('[data-fixture-progress="'+i+'"]');await expect(root.getByRole('progressbar')).toHaveCount(1);await expect(root.locator('.ui-progress-value')).toHaveText(value===null?'Нет данных':value+'%');if(value===null)await expect(root).not.toContainText('null%');}
});
