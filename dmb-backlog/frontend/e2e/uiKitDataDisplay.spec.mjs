import { test, expect } from '@playwright/test';

for (const theme of ['light','dark']) for (const width of [390,768,1280,1440]) {
  test(`общие данные и действия: ${theme}, ${width}`, async ({page})=>{
    await page.setViewportSize({width,height:1000});
    await page.goto('/ui-catalog/index.html');
    await page.getByLabel('Тема',{exact:true}).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-ready','true');
    for (const compact of ['false','true']) {
      await page.getByLabel('Плотность',{exact:true}).selectOption(compact);
      const geometry=await page.locator('#collaboration').evaluate(root=>({
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        icons:[...root.querySelectorAll('.square-icon')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})),
        controls:[...root.querySelectorAll('button')].map(el=>({clipped:el.scrollWidth>el.clientWidth+1,height:el.getBoundingClientRect().height})),
      }));
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      for (const item of geometry.icons) {expect(item.width).toBe(item.height);expect(item.height).toBe(width<=640?44:28);}
      for (const item of geometry.controls) {expect(item.clipped).toBe(false);expect(item.height).toBeGreaterThanOrEqual(width<=640?44:28);}
    }
    await expect(page.getByRole('progressbar',{name:'Готовность задачи'})).toHaveAttribute('aria-valuenow','65');
    await expect(page.getByRole('progressbar',{name:'Прогресс без данных'})).not.toHaveAttribute('aria-valuenow');
    const reply=page.getByRole('button',{name:'Ответить пользователю Анна Смирнова'});
    await reply.focus();await page.keyboard.press('Space');
    await expect(page.locator('#collaboration-result')).toContainText('Выбран ответ');
    await page.getByRole('button',{name:'Скачать Схема клиентского пути.pdf'}).click();
    await expect(page.locator('#collaboration-result')).toContainText('Выбрано скачивание');
    await page.getByRole('button',{name:'Удалить Схема клиентского пути.pdf'}).click();
    await expect(page.locator('#collaboration-result')).toContainText('Демонстрационный файл сохранён');
    if(width===390 || width===1440) await page.locator('#collaboration').screenshot({path:test.info().outputPath(`collaboration-${theme}-${width}.png`)});
  });
}

test('surface and link actions retain keyboard focus and touch targets with zoom', async({browser})=>{
  const context=await browser.newContext({viewport:{width:1280,height:1000},hasTouch:true});
  const page=await context.newPage();
  try {
    await page.goto('/ui-catalog/index.html');
    await page.evaluate(()=>document.documentElement.style.zoom=1.5);
    for(const action of await page.locator('#action-recipes button').all()) {
      await action.focus();await page.keyboard.press('Enter');
      await expect(page.locator('#content-action-result')).toContainText('Действие доступно');
      const css=await action.evaluate(el=>({height:parseFloat(getComputedStyle(el).height),outline:getComputedStyle(el).outlineStyle}));
      expect(css.height).toBeGreaterThanOrEqual(44);expect(css.outline).not.toBe('none');
    }
  } finally {await context.close();}
});
