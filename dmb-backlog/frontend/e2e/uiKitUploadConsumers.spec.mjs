import {test,expect} from '@playwright/test';
test('Upload name remains stable while its separate status changes',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitRegistries.html?surface=outbox');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(async()=>{const {fileUpload}=await import('/js/ui/specialized.js');document.querySelector('#page-content').innerHTML=fileUpload({id:'example-upload',label:'Добавить файл',hint:'До 50 МБ'});});const input=page.locator('#example-upload');await expect(input).toHaveAccessibleName('Добавить файл');await expect(input).toHaveAccessibleDescription('До 50 МБ');
 await page.evaluate(async()=>{const {setUploadState}=await import('/js/ui/specialized.js');setUploadState(document.querySelector('.ui-upload'),'error','Проверочная ошибка');});await expect(input).toHaveAccessibleName('Добавить файл');await expect(input).toHaveAccessibleDescription('Проверочная ошибка');await expect(input).toHaveAttribute('aria-invalid','true');
});
