import { test, expect } from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await expect(page.locator('i[data-lucide]')).toHaveCount(0);
});

test('all accent palettes keep primary, danger and success text readable in both themes',async({page})=>{
  for(const theme of ['light','dark']) {
    await page.getByLabel('Тема',{exact:true}).selectOption(theme);
    for(const accent of ['indigo','emerald','amber','rose','sky','violet','cyan','orange','teal','purple']) {
      await page.getByLabel('Акцент',{exact:true}).selectOption(accent);
      const pairs=await page.locator('#actions :is(.btn-primary,.btn-danger,.btn-success)').evaluateAll(elements=>elements.map(el=>{
        const c=getComputedStyle(el);
        const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        const a=luminance(c.color),b=luminance(c.backgroundColor);
        return {label:el.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      }));
      for(const pair of pairs) expect(pair.ratio,`${theme}/${accent}/${pair.label}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('tabs support keyboard navigation and manual activation',async({page})=>{
  const main=page.getByRole('tab',{name:'Основное'}),history=page.getByRole('tab',{name:'История'});
  await main.focus();await page.keyboard.press('ArrowRight');
  await expect(history).toBeFocused();await expect(main).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Enter');await expect(history).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#sample-history-panel')).toBeVisible();
  await expect(page.locator('#sample-main-panel')).toBeHidden();
  await page.keyboard.press('Home');await expect(main).toBeFocused();
});

test('busy state restores content; dialog cancellation returns focus',async({page})=>{
  const busy=page.locator('#demo-busy');await busy.click();
  await expect(busy).toHaveAttribute('aria-busy','true');await expect(busy).toBeDisabled();
  await expect(busy).toHaveText('Проверить ожидание');await expect(busy).toBeEnabled();
  const trigger=page.getByRole('button',{name:'Открыть подтверждение'});await trigger.click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();await expect(page.locator('#dialog-result')).toHaveText('Действие отменено');
});

test('form retains input during validation and associates the error',async({page})=>{
  await page.getByLabel('Название задачи').fill('Сохранённый ввод');
  await page.getByRole('button',{name:'Проверить форму'}).click();
  await expect(page.getByLabel('Исполнитель',{exact:true})).toBeFocused();
  await expect(page.getByLabel('Название задачи')).toHaveValue('Сохранённый ввод');
  await page.getByLabel('Исполнитель',{exact:true}).selectOption('analyst');
  await page.getByRole('button',{name:'Проверить форму'}).click();
  await expect(page.locator('#sample-owner')).not.toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#form-result')).toContainText('Данные никуда не отправлены');
});

test('shared checkbox toggles from its label and keyboard', async ({ page }) => {
  const checkbox = page.getByRole('checkbox', { name: 'Показывать в реестре' });
  await expect(checkbox).toBeChecked();
  await page.getByText('Показывать в реестре', { exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
});

test('switch supports label and track clicks, keyboard, busy and disabled states', async ({ page }) => {
  const toggle=page.getByRole('switch',{name:'Комментарии команды',exact:true});
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAccessibleDescription('Изменение применяется сразу.');
  // The native input covers the label, track and space between them.
  await toggle.click({position:{x:8,y:8}});
  await expect(toggle).toBeDisabled(); await expect(toggle).toHaveAttribute('aria-busy','true');
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked();
  await expect(page.locator('#switch-result')).toHaveText('Комментарии выключены');
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toBeChecked(); await expect(toggle).toBeEnabled();
  const off=page.getByRole('switch',{name:'Показывать подсказки',exact:true});
  const bounds=await off.boundingBox();
  await off.click({position:{x:bounds.width-16,y:bounds.height/2}});
  await expect(off).toBeChecked();
  await expect(page.getByRole('switch',{name:'Управляется организацией'})).toBeDisabled();
  await expect(page.getByRole('switch',{name:'Сохраняем изменения…'})).toHaveAttribute('aria-busy','true');
});

test('toggle buttons keep their size and expose keyboard selection', async ({ page }) => {
  const control=page.locator('[data-demo-toggle]').first();
  const before=await control.boundingBox();
  await expect(control).toHaveAttribute('aria-pressed','true');
  await control.focus(); await page.keyboard.press('Space');
  await expect(control).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Enter');
  await expect(control).toHaveAttribute('aria-pressed','true');
  const after=await control.boundingBox();
  expect(after.height).toBe(before.height);
  expect(after.width).toBe(before.width);
  await expect(page.getByRole('button',{name:'Недоступный фильтр',exact:true})).toBeDisabled();
});

test('controls adapt to density and touch; V2 follows the global theme',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  const height=()=>page.locator('#sample-primary').evaluate(el=>el.getBoundingClientRect().height);
  expect(await height()).toBe(32);
  await page.getByLabel('Плотность',{exact:true}).selectOption('true');expect(await height()).toBe(28);
  await page.setViewportSize({width:390,height:844});expect(await height()).toBeGreaterThanOrEqual(44);
  for(const theme of ['light','dark']) {
    await page.getByLabel('Тема',{exact:true}).selectOption(theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
    const colors=await page.locator('.agent-v2-availability').evaluate(el=>({actual:getComputedStyle(el).backgroundColor,expected:getComputedStyle(document.querySelector('.catalog-section')).backgroundColor}));
    expect(colors.actual).toBe(colors.expected);
  }
});

for (const [theme, width] of [['light', 1440], ['dark', 1440], ['light', 390]]) {
  test(`catalog visual contract: ${theme}, ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel('Тема', { exact: true }).selectOption(theme);
    if (width < 640) {
      await expect.poll(async () => {
        const heights = await page.locator('input.ui-control:visible, select.ui-control:visible').evaluateAll(controls => controls.map(control => control.getBoundingClientRect().height));
        return Math.min(...heights);
      }).toBeGreaterThanOrEqual(44);
    }
    await expect(page).toHaveScreenshot(`ui-kit-${theme}-${width}.png`, { fullPage: true, animations: 'disabled' });
  });
}
