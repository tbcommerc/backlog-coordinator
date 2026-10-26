import {test,expect} from '@playwright/test';
async function open(page){await page.goto('/e2e/fixtures/taskCardIncrement.html#/tasks?task=42');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await page.locator('#task-tab-sys').click();await expect(page.locator('#attachment-upload-status')).toHaveCount(1);}
async function select(page,sizes){await page.locator('#attachment-file-input').evaluate((input,sizes)=>{const transfer=new DataTransfer();for(const [name,size] of sizes){const file=new File(['x'],name);Object.defineProperty(file,'size',{value:size});transfer.items.add(file);}input.files=transfer.files;input.dispatchEvent(new Event('change'));},sizes);}
test('over-limit stays inline, mixed batch accepts exact boundary and recovers',async({page})=>{
 await open(page);await select(page,[['large.bin',50*1024*1024+1],['boundary.bin',50*1024*1024]]);
 await expect(page.locator('#attachment-upload-status')).toContainText('Загружено: 1 из 2');await expect(page.locator('#attachment-upload-errors')).toContainText('52 428 800');
 expect(await page.evaluate(()=>window.__apiCalls.filter(x=>x[0]==='upload').length)).toBe(1);
 await expect(page.locator('#attachment-file-input')).toBeEnabled();await select(page,[['small.txt',1]]);await expect(page.locator('#attachment-upload-errors')).toBeEmpty();await expect(page.locator('#attachment-upload-status')).toContainText('Загружено: 1 из 1');
});
test('pending upload blocks another batch and restores controls on failure',async({page})=>{
 await open(page);await page.evaluate(()=>{window.app.api.upload=()=>new Promise((resolve,reject)=>{window.failUpload=()=>reject(Object.assign(new Error('server limit'),{status:413}));});});
 await select(page,[['small.txt',1]]);await expect(page.locator('#attachment-upload-status')).toContainText('Загрузка 1 из 1');await expect(page.locator('#attachment-file-input')).toBeDisabled();await expect(page.locator('#attachment-drop-zone')).toHaveAttribute('aria-busy','true');
 await page.evaluate(()=>window.failUpload());await expect(page.locator('#attachment-upload-errors')).toContainText('50 МиБ');await expect(page.locator('#attachment-file-input')).toBeEnabled();await expect(page.locator('#attachment-drop-zone')).toHaveAttribute('aria-busy','false');
});
