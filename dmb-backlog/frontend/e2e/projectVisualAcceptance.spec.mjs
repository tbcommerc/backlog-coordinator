import {test,expect} from '@playwright/test';
import {setup} from './fixtures/projectManagementSetup.js';

for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`project composition ${width} ${theme}`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});await setup(page,'#/work-projects?project=1&section=gantt&year=2026&quarter=4');
 await page.locator('html').evaluate((el,t)=>el.dataset.theme=t,theme);
 // The production order is significant: the page stylesheet follows work-tasks.
 await expect(page.locator('link[href*="project-management.css"]')).toHaveCount(1);
 await expect(page.locator('.project-gantt-bar')).toHaveCount(1);
 await expect(page.locator('.project-gantt-key')).not.toHaveAttribute('open');
 await page.screenshot({path:testInfo.outputPath('project-full.png'),fullPage:true});
 expect(await page.locator('.project-gantt-bar').first().evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(700);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.getByLabel('Поиск задач',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 await page.getByLabel('Поиск задач',{exact:true}).fill('Проверка');
 await expect(page.getByRole('button',{name:'Применить фильтры',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Применить фильтры',exact:true}).click();
 await expect(page).toHaveURL(/pq=/);
 await expect(page.locator('[data-plan-clear=pq]')).toContainText('Проверка');
});
