import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';

for(const scope of ['backlog','team'])for(const theme of ['light','dark'])test(`empty table stays readable after resize and scroll: ${scope}/${theme}`,async({page})=>{
  await mockApp(page);
  await page.setViewportSize({width:1440,height:950});
  await page.goto('/#/'+(scope==='team'?'team-backlog':'backlog'));
  const table=page.locator(scope==='team'?'#team-tasks-table':'#tasks-table');
  await expect(table.getByRole('link',{name:'Открыть задачу: Первая задача',exact:true})).toBeVisible();
  await page.locator(`#f-${scope}-search`).fill('Проверка отсутствующего результата UI kit');
  const state=table.locator('.table-view-state-cell .view-state');await expect(state).toBeVisible();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const width of [390,768,1440,390]){
    await page.setViewportSize({width,height:950});
    await expect.poll(()=>state.evaluate(e=>Math.abs(e.getBoundingClientRect().width-e.closest('.table-container').clientWidth))).toBeLessThanOrEqual(1);
    await expect.poll(()=>state.evaluate(e=>{
      const box=e.closest('.table-container').getBoundingClientRect();
      return [...e.querySelectorAll('h3,p')].every(text=>{const r=text.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});
    })).toBe(true);
  }
  await table.locator('..').evaluate(e=>{e.scrollLeft=e.scrollWidth-e.clientWidth;});
  await expect.poll(()=>state.evaluate(e=>{
    const visible=e.closest('.table-container').getBoundingClientRect(),title=e.querySelector('h3').getBoundingClientRect();
    return title.left>=visible.left-1&&title.right<=visible.right+1;
  })).toBe(true);
});

for(const surface of ['workTasks','workProjects'])test(`page header keeps a full-width title on mobile: ${surface}`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/e2e/fixtures/uiKitConsistency.html?surface='+surface);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  const header=page.locator('.ui-page-header').first();
  await expect.poll(()=>header.evaluate(e=>{
    const title=e.querySelector('.toolbar-title-wrap').getBoundingClientRect(),header=e.getBoundingClientRect();
    return header.width-title.width;
  })).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

test('new work task has a visible required title label',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/e2e/fixtures/uiKitConsistency.html?surface=workTasks');
  await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
  const dialog=page.locator('dialog[open]');await expect(dialog.locator('#wf-title')).toBeVisible();
  const label=dialog.locator('label[for="wf-title"]');
  const box=await label.boundingBox();expect(box.width).toBeGreaterThan(50);expect(box.height).toBeGreaterThan(12);
  await expect(label).toContainText('Название');await expect(dialog.locator('#wf-title')).toHaveAttribute('required','');
  await expect(label).not.toHaveCSS('position','absolute');
});

for(const width of [1440,390])test(`feedback actions use the shared size scale: ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async()=>{
    const {renderViewState}=await import('/js/components/viewState.js');
    const host=document.createElement('section');host.id='live-feedback';host.innerHTML=renderViewState({title:'Пока нет запросов',actionLabel:'Создать первый запрос'});document.body.append(host);
  });
  const button=page.locator('#live-feedback button');
  expect(await button.evaluate(e=>e.getBoundingClientRect().height)).toBe(width===390?44:32);
});
