import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const approved = resolve('../artifacts/task-card-design-proposal-2026-11-09');
const evidence = resolve('artifacts/task-card-reference-2026-11-11');
const description = 'Клиент должен видеть актуальный этап заявки и следующий шаг в личном кабинете. Сейчас статус приходится уточнять через поддержку; после изменения он будет доступен на странице заявки.';
const inspectBody = el => ({body:el.getBoundingClientRect().toJSON(),text:el.innerText,scrollHeight:el.scrollHeight,
  styles:[...el.querySelectorAll('input,textarea,select,.ui-readonly-label,.ui-readonly-value,.ui-btn,.form-label,.task-description-content,.text,.task-description-content p,strong,.ui-section-header h3')].filter(n=>n.getClientRects().length).map(n=>({tag:n.tagName,cls:n.className,text:n.textContent.slice(0,45),font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight,line:getComputedStyle(n).lineHeight,color:getComputedStyle(n).color,family:getComputedStyle(n).fontFamily,bg:getComputedStyle(n).backgroundColor,rect:n.getBoundingClientRect().toJSON()}))});

for (const [width,height] of [[1440,960],[390,844]]) {
  test(`approved main and editor on identical data ${width}`, async ({ page }) => {
    await mkdir(evidence, {recursive:true});
    await page.setViewportSize({width,height});
    await page.route('**/approved-proposal/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(name)];
      await route.fulfill({body:await readFile(resolve(approved,name)),contentType:mime});
    });
    await page.route('**/static/**', route => route.continue({url:route.request().url().replace('/static/','/')}));
    const measurements = {};
    for (const state of ['main','main-edit']) {
      await page.goto(`/approved-proposal/index.html?state=${state}`);
      await expect(page.locator('body')).toHaveAttribute('data-ready',state);
      await page.evaluate(()=>document.fonts.ready);
      measurements[`reference-${state}`] = await page.locator('.task-body').evaluate(inspectBody);
      await page.screenshot({path:resolve(evidence,`reference-${state}-${width}.png`)});
      if (state === 'main') {
        measurements['reference-main'].participantColumns = await page.locator('.ui-description-list').filter({hasText:'Ответственная команда'}).first().evaluate(el=>getComputedStyle(el).gridTemplateColumns);
        await page.locator('.task-body').evaluate(el=>el.scrollTop=350);
        await page.screenshot({path:resolve(evidence,`reference-main-lower-${width}.png`)});
      }
    }
    await page.goto('/e2e/fixtures/taskCardIncrement.html?profile=proposal#/tasks?task=42');
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    await expect(page.locator('.ui-task-detail-summary')).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('#task-detail-title').click();
    measurements['actual-main'] = await page.locator('#mbody').evaluate(inspectBody);
    const referenceText = measurements['reference-main'].styles;
    const actualText = measurements['actual-main'].styles;
    for (const before of referenceText.filter(item=>['ui-readonly-label','ui-readonly-value','text'].includes(item.cls) || item.tag==='STRONG' && item.text.startsWith('Ожидаемый результат'))) {
      const after = actualText.find(item=>item.tag===before.tag && item.text===before.text);
      expect(after,`matching text: ${before.text}`).toBeTruthy();
      for (const prop of ['color','family','weight']) expect(after[prop]).toBe(before[prop]);
    }
    await page.screenshot({path:resolve(evidence,`actual-main-${width}.png`)});
    measurements['actual-main'].participantColumns = await page.locator('.ui-description-list').filter({hasText:'Ответственная команда'}).first().evaluate(el=>getComputedStyle(el).gridTemplateColumns);
    expect(measurements['actual-main'].participantColumns).toBe(measurements['reference-main'].participantColumns);
    await expect(page.locator('.ui-task-detail-metrics')).toContainText('360 000');
    await expect(page.locator('.ui-task-detail-metrics')).toContainText('120 000');
    await page.locator('#mbody').evaluate(el=>el.scrollTop=350);
    await page.screenshot({path:resolve(evidence,`actual-main-lower-${width}.png`)});
    await page.locator('#mbody').evaluate(el=>el.scrollTop=0);
    await page.locator('[data-action="edit"]').click();
    await page.locator('[data-k="description"]').fill(description);
    await page.locator('[data-k="comment"]').fill('Согласовать названия этапов с поддержкой.');
    await page.locator('#task-detail-title').click();
    await page.locator('#mbody').evaluate(el=>el.scrollTop=0);
    await page.locator('.ui-task-edit-grid textarea').evaluateAll(items=>items.forEach(el=>el.scrollTop=0));
    measurements['actual-main-edit'] = await page.locator('#mbody').evaluate(inspectBody);
    await page.screenshot({path:resolve(evidence,`actual-main-edit-${width}.png`)});
    await expect(page.locator('[data-k="progress"]')).toHaveAttribute('type','number');
    await expect(page.locator('[data-k="title"]')).toHaveValue('Единый статус заявки в клиентском портале');
    const ref = measurements['reference-main-edit'];
    const actual = measurements['actual-main-edit'];
    const refControls = ref.styles.filter(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tag));
    const actualControls = actual.styles.filter(n=>['INPUT','TEXTAREA','SELECT'].includes(n.tag));
    for (const [referenceIndex,actualIndex] of [[0,0],[1,1],[3,2],[4,3],[5,4],[7,5],[8,6]]) {
      const before=refControls[referenceIndex], after=actualControls[actualIndex];
      expect(Math.abs((after.rect.y-actual.body.y)-(before.rect.y-ref.body.y))).toBeLessThanOrEqual(1);
      expect(after.rect.height).toBe(before.rect.height);
      // UI Kit requires a 12px minimum; the prototype's 14px root scaled controls to 11.375px.
      expect(parseFloat(after.font)).toBe(Math.max(12,parseFloat(before.font)));
      expect(after.weight).toBe(before.weight);
    }
    await writeFile(resolve(evidence,`geometry-${width}.json`),JSON.stringify(measurements,null,2));
  });
}
