import {test,expect} from '@playwright/test';
const fixture='/e2e/fixtures/accountSecurity.html';
test.beforeEach(async({page})=>{
  await page.route('**/api/v1/**', route=>{
    const url=route.request().url();const data=url.includes('security-events')?{items:[]}:url.includes('sessions')?[]:{token:'one-use',expires_at:'2026-10-12T12:00:00Z'};
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
});
test('activation fragment is removed and submission contains only credentials',async({page})=>{
  await page.goto(fixture+'#/activate?token=secret-in-fragment');
  await expect(page).toHaveURL(/#\/activate$/);
  await expect(page.getByLabel('Одноразовый код')).toHaveValue('secret-in-fragment');
  await page.getByLabel(/^Новый пароль/).fill('Длинная секретная фраза');
  await page.getByLabel(/^Повтор пароля/).fill('Длинная секретная фраза');
  const pending=page.waitForRequest('**/auth/password/setup');
  await page.getByRole('button',{name:'Установить пароль'}).click();
  expect((await pending).postDataJSON()).toEqual({token:'secret-in-fragment',new_password:'Длинная секретная фраза'});
  await expect(page.getByRole('heading',{name:'Вход'})).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('secret-in-fragment');
});
test('customer security form validates confirmation and keeps password on rejected change',async({page})=>{
  await page.goto(fixture);
  await expect(page.getByRole('heading',{name:'Безопасность',exact:true})).toBeVisible();
  await page.getByLabel(/^Текущий пароль/).fill('старый пароль');
  await page.getByLabel(/^Новый пароль/).fill('Новая длинная фраза');
  await page.getByLabel(/^Повтор нового пароля/).fill('не совпадает');
  await page.getByRole('button',{name:'Изменить пароль и выйти со всех устройств'}).click();
  await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают.');
  await page.route('**/auth/password/change',r=>r.fulfill({status:401,contentType:'application/json',body:'{"detail":"CURRENT_PASSWORD_INVALID"}'}));
  await page.getByLabel(/^Повтор нового пароля/).fill('Новая длинная фраза');
  await page.getByRole('button',{name:'Изменить пароль и выйти со всех устройств'}).click();
  await expect(page.getByRole('alert')).toContainText('пароль неверен');
  await expect(page.getByLabel(/^Новый пароль/)).toHaveValue('Новая длинная фраза');
});
for(const width of [390,1280])test(`security fits viewport ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto(fixture);
  await expect(page.getByRole('heading',{name:'Безопасность',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('one-time secret closes and removes the code from DOM',async({page})=>{
  await page.goto(fixture);await page.evaluate(()=>showOneTimeSecret({token:'private-code',expires_at:'2026-10-12'},'ivan.petrov'));
  await expect(page.getByText('private-code',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByText('private-code',{exact:true})).toHaveCount(0);
});
