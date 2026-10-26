import {test,expect} from '@playwright/test';

for(const theme of ['light','dark'])for(const width of [1440,390])test(`isolated core workspace: ${theme}/${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(await page.evaluate(()=>[...document.styleSheets].map(s=>s.href).filter(Boolean))).toHaveLength(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByLabel('Исполнитель')).toHaveAccessibleDescription('Выберите исполнителя.');
  await page.getByLabel('Исполнитель').focus();
  const errorColor=await page.locator('#core-owner-error').evaluate(el=>getComputedStyle(el).color);
  await expect(page.locator('#core-owner')).toHaveCSS('border-top-color',errorColor);
  await expect(page.locator('#core-busy')).toBeDisabled();await expect(page.locator('#core-busy')).toHaveAttribute('aria-busy','true');
  const target=width===390?44:32;
  for(const selector of ['#core-save','#core-title','#core-owner'])expect(await page.locator(selector).evaluate(el=>el.getBoundingClientRect().height)).toBe(target);
  const first=page.getByRole('tab',{name:'Основное',exact:true});await first.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel',{name:'История'})).toBeVisible();await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel',{name:'Основное'})).toBeVisible();
  await page.locator('#core-title').fill('ОченьДлинноеНазваниеБезПробелов'.repeat(10));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button',{name:'Все задачи',exact:true}).click();await expect(page.getByRole('button',{name:'Все задачи',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page).toHaveScreenshot(`core-${theme}-${width}.png`,{fullPage:true,animations:'disabled'});
});

test('core respects forced colors and reduced motion without SPA styles',async({page})=>{
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
  await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#core-owner')).toHaveCSS('appearance','auto');
  await expect(page.locator('#core-owner')).toHaveCSS('background-image','none');
  await expect(page.locator('.ui-button-spinner')).toHaveCSS('animation-name','none');
  await page.locator('#core-title').focus();await expect(page.locator('#core-title')).toHaveCSS('outline-style','solid');
});

test('core density never reduces coarse pointer targets',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});const page=await context.newPage();
  await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>document.documentElement.dataset.compact='true');
  for(const selector of ['#core-save','#core-title','#core-owner','.ui-checkbox'])expect(await page.locator(selector).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await context.close();
});
