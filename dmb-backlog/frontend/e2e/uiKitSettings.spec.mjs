import { test, expect } from '@playwright/test';

async function open(page,query='',section='appearance') {
  await page.goto(`/e2e/fixtures/uiKitSettings.html?${query}#/settings?section=${section}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
}
const writes=page=>page.evaluate(()=>window.__calls.filter(call=>call.method!=='get'));
test.afterEach(async({page})=>expect(await page.evaluate(()=>window.__blocked||[])).toEqual([]));

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
