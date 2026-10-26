import { test, expect } from '@playwright/test';
for(const theme of ['light','dark'])for(const width of [390,1440]){
  test(`вход: геометрия, клавиатура, busy и ошибка ${theme}/${width}`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await page.goto(`/e2e/fixtures/uiKitLogin.html?theme=${theme}`);
    const email=page.getByRole('textbox',{name:'Логин',exact:true}),password=page.getByLabel('Пароль',{exact:true});
    await email.fill('test@example.test');await password.fill('test-secret');
    const toggle=page.locator('#login-pw-toggle');
    await expect(toggle).toHaveAccessibleName('Показать пароль');
    await toggle.focus();await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type','text');await expect(toggle).toHaveAttribute('aria-pressed','true');
    await expect(toggle).toHaveAccessibleName('Скрыть пароль');
    await page.keyboard.press('Space');await expect(password).toHaveAttribute('type','password');
    const bounds=await toggle.boundingBox();expect(bounds.width).toBe(bounds.height);expect(bounds.height).toBe(width===390?44:32);
    expect(await email.evaluate(el=>el.getBoundingClientRect().height)).toBe(width===390?44:32);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
    await page.evaluate(()=>window.__hold=true);await page.getByRole('button',{name:'Войти в систему'}).click();
    const submit=page.locator('#login-btn');await expect(submit).toBeDisabled();await expect(submit).toHaveAttribute('aria-busy','true');
    await password.press('Enter');expect(await page.evaluate(()=>window.__calls.length)).toBe(1);
    await page.evaluate(()=>window.__release());await expect(page.getByRole('alert')).toBeVisible();
    await expect(submit).toBeEnabled();await expect(password).toHaveValue('test-secret');
    await page.screenshot({path:test.info().outputPath(`login-${theme}-${width}.png`)});
    await page.evaluate(()=>{window.__hold=false;window.__fail=false;});await submit.click();await expect(page.getByRole('status')).toHaveText('Вход выполнен');
  });
}

test('вход на низком экране прокручивается от заголовка до действия', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/e2e/fixtures/uiKitLogin.html');
  await expect(page.getByRole('heading', { name: 'Добро пожаловать' })).toBeInViewport();
  await page.locator('#login-btn').scrollIntoViewIfNeeded();
  await expect(page.locator('#login-btn')).toBeInViewport();
  await page.locator('#login-title').scrollIntoViewIfNeeded();
  await expect(page.locator('#login-title')).toBeInViewport();
});
