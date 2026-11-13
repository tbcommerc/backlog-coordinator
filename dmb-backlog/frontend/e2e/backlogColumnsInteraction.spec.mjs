import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
async function open(page){await mockApp(page);await page.setViewportSize({width:1440,height:900});await page.goto('/#/backlog?bv=2&scope=all');await page.getByRole('button',{name:'Настройка отображения столбцов',exact:true}).click();return page.getByRole('dialog',{name:'Настройка колонок'});}
const order=p=>p.locator('.col-drag-item').evaluateAll(rows=>rows.map(r=>r.dataset.col));
async function drag(page,from,to,outside=false){const a=await from.locator('.col-drag-handle').boundingBox(),b=await to.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+15,b.y+b.height-3,{steps:12});if(outside)await page.mouse.move(10,10,{steps:5});await page.mouse.up();}
test('pointer reorder, invalid drop and keyboard restoration',async({page})=>{
 const p=await open(page),rows=p.locator('.col-drag-item'),original=await order(p);
 await drag(page,rows.nth(1),rows.nth(2));expect((await order(p)).slice(0,3)).toEqual([original[0],original[2],original[1]]);
 await expect(p.locator('[data-column-announcement]')).toContainText('позиция 3');
 await expect(p.locator(`input[data-col="${original[1]}"]`)).toBeFocused();
 const changed=await order(p);await drag(page,rows.nth(1),rows.nth(3),true);expect(await order(p)).toEqual(changed);
 await expect(p.locator('input[data-col="id"]')).toBeDisabled();
 await p.locator(`input[data-col="${original[1]}"]`).press('Alt+ArrowUp');expect(await order(p)).toEqual(original);
 await p.locator(`input[data-col="${original[1]}"]`).press('Escape');await expect(p).toBeHidden();
 await expect(page.getByRole('button',{name:'Настройка отображения столбцов',exact:true})).toBeFocused();
});
test('filtered keyboard order and accessible search/undo',async({page})=>{
 const p=await open(page),search=p.getByRole('searchbox',{name:'Найти столбец'});await search.fill('статус');
 const rows=p.locator('.col-drag-item:visible'),first=await rows.first().getAttribute('data-col'),second=await rows.nth(1).getAttribute('data-col');
 await rows.first().locator('input').press('Alt+ArrowDown');const keys=await order(p);expect(keys.indexOf(first)).toBeGreaterThan(keys.indexOf(second));
 await expect(p.locator(`input[data-col="${first}"]`)).toBeFocused();
 await search.fill('несуществующий столбец');await expect(p.getByRole('status')).toContainText('Найдено: 0');await search.fill('');
 const before=await p.locator('input[type=checkbox]:checked').count();await p.getByRole('button',{name:'Выбрать все',exact:true}).click();await p.getByRole('button',{name:'Отменить выбор столбцов'}).click();expect(await p.locator('input[type=checkbox]:checked').count()).toBe(before);await expect(search).toBeFocused();
 await p.getByRole('button',{name:'Закрыть настройки колонок'}).press('End');await expect(p.getByRole('button',{name:'Закрыть настройки колонок'})).toBeInViewport();
});
test('Escape cancels active drag and forced colors retain focus and labels',async({page})=>{
 const p=await open(page),rows=p.locator('.col-drag-item'),before=await order(p);
 const a=await rows.nth(1).locator('.col-drag-handle').boundingBox(),b=await rows.nth(3).boundingBox();
 await page.mouse.move(a.x+3,a.y+3);await page.mouse.down();await page.mouse.move(b.x+15,b.y+20,{steps:8});
 await page.keyboard.press('Escape');await page.mouse.up();await expect(p).toBeHidden();
 await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Настройка отображения столбцов',exact:true}).press('ArrowDown');
 await expect(p).toBeVisible();expect(await order(p)).toEqual(before);await expect(p.getByRole('button',{name:'Закрыть настройки колонок'})).toBeFocused();
 const cb=p.getByRole('checkbox',{name:'Задача',exact:true});await cb.focus();
 await expect(cb).toHaveAccessibleDescription(/Alt/);await expect(cb).toHaveAccessibleName('Задача');
 expect(await cb.locator('..').evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
 await page.setViewportSize({width:390,height:844});await cb.press('End');
 await expect(p.getByRole('checkbox',{name:'Комментарий',exact:true})).toBeFocused();await expect(p.getByRole('button',{name:'Закрыть настройки колонок'})).toBeInViewport();
});
