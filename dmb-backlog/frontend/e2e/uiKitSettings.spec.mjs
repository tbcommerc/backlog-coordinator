import { test, expect } from '@playwright/test';

async function open(page,query='',section='appearance') {
  await page.goto(`/e2e/fixtures/uiKitSettings.html?${query}#/settings?section=${section}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
}
const writes=page=>page.evaluate(()=>window.__calls.filter(call=>call.method!=='get'));
test.afterEach(async({page})=>expect(await page.evaluate(()=>window.__blocked||[])).toEqual([]));

for(const theme of ['light','dark']) for(const width of [1440,900,768,390]) for(const compact of [false,true]) {
  test(`настройки: размеры и содержимое ${theme}/${width}/${compact?'compact':'default'}`,async({page})=>{
    await page.setViewportSize({width,height:1000});
    await open(page,`theme=${theme}&compact=${compact}`);
    for(const section of ['appearance','notifications','account']) {
      await page.locator(`[data-settings-target="${section}"]`).click();
      await expect(page.locator('i[data-lucide]')).toHaveCount(0);
      await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
      const dimensions=await page.locator('.settings-page').evaluate(root=>({
        overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        panelOverflow:root.querySelector('.settings-panel').scrollWidth-root.querySelector('.settings-panel').clientWidth,
        headersFit:[...root.querySelectorAll('.ui-page-header *')].every(el=>el.getBoundingClientRect().right<=document.documentElement.clientWidth+1),
        controls:[...root.querySelectorAll('.btn,.ui-tab,.ui-switch')].filter(el=>el.getClientRects().length).map(el=>({height:el.getBoundingClientRect().height,clipped:el.scrollWidth>el.clientWidth+1,name:el.textContent,kind:el.classList.contains('ui-switch')?'switch':'button'})),
      }));
      expect(dimensions.overflow).toBeLessThanOrEqual(1);
      expect(dimensions.panelOverflow).toBeLessThanOrEqual(1);
      expect(dimensions.headersFit).toBe(true);
      for(const control of dimensions.controls) {
        const height=width<=640?44:compact?28:32;
        if(control.kind==='button') expect(control.height,control.name).toBe(height);
        else expect(control.height).toBeGreaterThanOrEqual(height);
        expect(control.clipped,control.name).toBe(false);
      }
      if(theme==='light' && !compact && [1440,390].includes(width)) await page.screenshot({path:test.info().outputPath(`${section}-${width}.png`),fullPage:true});
    }
    await expect(page.getByText('Тестовый автор <скобки>',{exact:true})).toBeVisible();
    await expect(page.locator('[data-settings-view="account"] input')).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
  });
}

test('тема, цвет и плотность сохраняются; нажатия вне палитры не меняют корень',async({page})=>{
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>{if(!localStorage.getItem('dmb_theme')) localStorage.setItem('dmb_theme','system');});
  await open(page);
  await page.locator('[data-theme-choice="dark"]').click();
  await page.emulateMedia({colorScheme:'dark'}); await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('[data-accent-choice="emerald"]').focus(); await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-accent','emerald');
  await page.locator('[data-density="compact"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-compact','true');
  await page.getByRole('heading',{name:'Персональные настройки'}).click();
  await expect(page.locator('[data-accent-choice="emerald"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('html')).not.toHaveAttribute('aria-pressed');
  await page.reload();
  await expect(page.locator('[data-density="compact"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-accent-choice="emerald"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-theme-choice="dark"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-theme-choice="system"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.locator('[data-theme-choice="light"]').click();
  await page.emulateMedia({colorScheme:'light'}); await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  // A shell action uses the same owner, including after settings chose system.
  await page.locator('[data-theme-choice="system"]').click();
  await page.evaluate(()=>{localStorage.setItem('dmb_theme','light');window.__applyThemePreference('light');});
  await page.emulateMedia({colorScheme:'light'}); await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  expect(await writes(page)).toEqual([]);
});

test('вкладки: вертикальная/горизонтальная клавиатура, deep link и возврат',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await open(page,'','notifications');
  const appearance=page.getByRole('tab',{name:'Интерфейс'}), notifications=page.getByRole('tab',{name:'Уведомления'}), account=page.getByRole('tab',{name:'Учётная запись'});
  await expect(notifications).toHaveAttribute('aria-selected','true');
  await notifications.focus(); await page.keyboard.press('ArrowDown');
  await expect(account).toBeFocused();
  await expect(notifications).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Enter');
  await expect(account).toHaveAttribute('aria-selected','true');
  await expect(page).toHaveURL(/section=account$/);
  await page.reload(); await expect(account).toHaveAttribute('aria-selected','true');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('tablist')).toHaveAttribute('aria-orientation','horizontal');
  await account.focus(); await page.keyboard.press('ArrowRight');
  await expect(appearance).toBeFocused(); await page.keyboard.press('Space');
  await expect(appearance).toHaveAttribute('aria-selected','true');
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('tabpanel',{name:'Интерфейс'})).toBeVisible();
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
});

test('уведомления: ошибка чтения, повтор, доступная подпись и сохранение без дублей',async({page})=>{
  await open(page,'readError','notifications');
  await expect(page.locator('.view-state-error')).toBeVisible();
  await page.evaluate(()=>{window.__failRead=false;window.__hold=true;});
  await page.getByRole('button',{name:'Повторить'}).click();
  await expect(page.locator('#notif-prefs-list')).toHaveAttribute('aria-busy','true');
  await page.evaluate(()=>window.__release());
  const toggle=page.getByRole('switch',{name:'Новые комментарии',exact:true});
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAccessibleDescription('Автор и упомянутые получатели не дублируются');
  await expect(page.getByText('Всегда включено',{exact:true})).toHaveCount(3);
  await expect(page.getByRole('switch')).toHaveCount(1);
  await page.evaluate(()=>{window.__hold=true;});
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toBeDisabled(); await expect(toggle).toHaveAttribute('aria-busy','true');
  await page.keyboard.press('Space');
  expect(await writes(page)).toHaveLength(1);
  await page.evaluate(()=>window.__release());
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked();
  await expect(page.locator('#notif-prefs-save-status')).toContainText('Все изменения сохранены');
  expect((await writes(page))[0].data).toEqual({preferences:{comment:false}});
  await page.evaluate(()=>window.__renderSettings());
  await expect(toggle).not.toBeChecked();
});

test('ошибка сохранения откатывает переключатель; повтор применяет исходное намерение',async({page})=>{
  await open(page,'','notifications');
  const toggle=page.getByRole('switch',{name:'Новые комментарии',exact:true});
  await page.evaluate(()=>{window.__failWrite=true;});
  // Click the label area of the native input that covers the entire row.
  await toggle.click({position:{x:12,y:12}});
  await expect(page.locator('#notif-prefs-save-status')).toContainText('Изменения не сохранены');
  await expect(toggle).toBeChecked(); await expect(toggle).toBeEnabled();
  await page.evaluate(()=>{window.__failWrite=false;window.__hold=true;});
  await page.getByRole('button',{name:'Повторить'}).click();
  await expect(toggle).not.toBeChecked(); await expect(toggle).toBeDisabled();
  await page.evaluate(()=>window.__release());
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked();
  await expect(page.locator('#notif-prefs-save-status')).toContainText('Все изменения сохранены');
  expect((await writes(page)).map(call=>call.data)).toEqual([{preferences:{comment:false}},{preferences:{comment:false}}]);
});

test('сенсорный ввод и увеличение: переключатель и обычные кнопки помещаются',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
  const page=await context.newPage();
  try {
    await open(page,'theme=dark&compact=true');
    await page.evaluate(()=>{document.documentElement.style.zoom=1.5;});
    expect(await page.locator('[data-theme-choice="light"]').evaluate(el=>parseFloat(getComputedStyle(el).height))).toBe(44);
    await page.getByRole('tab',{name:'Уведомления'}).click();
    expect(await page.locator('.ui-switch').evaluate(el=>parseFloat(getComputedStyle(el).height))).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await writes(page)).toEqual([]);
  } finally { await context.close(); }
});
