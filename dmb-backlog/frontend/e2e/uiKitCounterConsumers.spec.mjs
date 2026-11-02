import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])test(`counts stay Counter rather than InfoChip ${theme}`,async({page})=>{
 await page.setViewportSize({width:320,height:800});
 for(const [value,label,tone]of [['0','0','neutral'],['unknown','—','neutral'],['5','5','warning'],['12','12','danger']]){
  await page.goto(`/e2e/fixtures/uiKitRegistries.html?surface=outbox&theme=${theme}&attempts=${value}`);await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');const count=page.locator('.outbox-attempts');await expect(count).toHaveClass(/ui-counter/);await expect(count).toHaveText(label);await expect(count).toHaveAttribute('data-ui-tone',tone);await expect(count).toHaveAccessibleName(value==='unknown'?'Попыток доставки: неизвестно':`Попыток доставки: ${value}`);await expect(count).toHaveCSS('border-radius','9999px');expect(await count.evaluate(e=>e.classList.contains('ui-info-chip'))).toBe(false);
 }
 await page.goto(`/e2e/fixtures/uiKitRegistries.html?surface=audit&theme=${theme}`);await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await expect(page.locator('#audit-total-badge')).toHaveClass(/ui-counter/);await expect(page.locator('#audit-total-badge')).toHaveAccessibleName('Всего событий: 120');
 await page.goto(`/e2e/fixtures/uiKitRegistries.html?surface=audit&theme=${theme}&error`);await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await expect(page.locator('#audit-total-badge')).toHaveText('—');await expect(page.locator('#audit-total-badge')).toHaveAccessibleName('Всего событий: неизвестно');
});

test('Counter typography belongs to the family rather than its button or link parent',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitRegistries.html?surface=outbox');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 const sizes=await page.evaluate(async()=>{const {counter}=await import('/js/ui/dataDisplay.js');const root=document.createElement('div');root.innerHTML='<button style="line-height:16px;font-weight:700">'+counter({value:61})+'</button><a style="line-height:18px;font-weight:400">'+counter({value:61})+'</a>';document.body.append(root);return [...root.querySelectorAll('.ui-counter')].map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontWeight,line:getComputedStyle(e).lineHeight}));});expect(sizes[0]).toEqual(sizes[1]);
});
