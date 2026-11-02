import {test,expect} from '@playwright/test';

for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`compact card ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:800});
 await page.goto('/e2e/fixtures/workTasks.html');
 await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
 await page.addScriptTag({url:'/static/js/lib/lucide.min.js'});
 await page.evaluate(async theme=>{
  const {boardCard}=await import('/static/js/components/workBoard.js');
  document.documentElement.dataset.theme=theme;
  document.querySelector('main').innerHTML=`<ul style="list-style:none;margin:24px auto;padding:0;width:calc(100% - 32px);max-width:280px">${boardCard({id:73,public_id:'WRK-73',title:'Собрать требования к календарю проектных событий',context:{title:'Календарь ключевых событий и квартального планирования'},assignee_name:'В. Стодольский',status:'in_progress',is_overdue:true,due_date:'2026-10-24',checklist_progress:{done:0,total:2}},null)}</ul>`;
  window.lucide.createIcons();
 },theme);
 const card=page.locator('[data-board-card="73"]');
 await expect(card.locator('.work-board-title')).toHaveText('Собрать требования к календарю проектных событий');
 await expect(card.locator('.work-board-person')).toContainText('В. Стодольский');
 await expect(card.getByLabel('Чек-лист: 0 из 2')).toBeVisible();
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const bounds=await card.boundingBox();expect(bounds.height).toBeLessThan(210);
 const positions=await card.locator('.work-board-meta > span').evaluateAll(items=>items.map(el=>Math.round(el.getBoundingClientRect().top)));
 expect(Math.max(...positions)-Math.min(...positions)).toBeLessThan(3);
 await expect(card.locator('.work-board-meta svg')).toHaveCount(3);
 await expect(card.getByRole('button',{name:'Действия WRK-73'}).locator('svg')).toBeVisible();
 await card.screenshot({path:info.outputPath('card.png')});
});
