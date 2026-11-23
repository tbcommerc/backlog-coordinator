import {test,expect} from '@playwright/test';

async function open(page, theme='light') {
  await page.goto(`/e2e/fixtures/taskCardIncrement.html?theme=${theme}#/backlog?task=42`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect(page.locator('#task-tab-sys')).toContainText('2');
  await page.evaluate(async()=>{const m=await import('/js/components/modal.js?v=99');m.closeModal();});
  await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
}

for(const theme of ['light','dark']) for(const width of [1440,390]) {
  test(`title alone creates a task: ${theme} ${width}`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:width===390?844:1000});
    await open(page,theme);
    await page.evaluate(async()=>{
      window.__taskCardFixture.currentUser.team_id=null;
      const m=await import('/js/components/modal.js?v=99');m.openCreateTaskModal(window.app);
    });
    await expect(page.locator('#create-task-type option')).not.toHaveCount(1);
    await expect(page.locator('#create-team')).toHaveValue('');
    await page.locator('#create-priority').selectOption('');
    await page.locator('#create-date-received').fill('');
    await expect(page.locator('#create-save-btn')).toBeDisabled();
    await page.locator('#create-title').fill('Только название задачи');
    await expect(page.locator('#create-save-btn')).toBeEnabled();
    await expect(page.locator('#create-task-overlay [required]')).toHaveCount(1);
    await page.locator('#create-modal-body').evaluate(element=>{element.scrollTop=0;});
    await page.screenshot({path:testInfo.outputPath('title-only-create-full.png'),fullPage:true});
    await page.locator('#create-save-btn').click();
    await expect.poll(()=>page.evaluate(()=>window.__apiCalls.filter(x=>x[0]==='post'&&x[1]==='/tasks/').length)).toBe(1);
    const payload=await page.evaluate(()=>window.__apiCalls.find(x=>x[0]==='post'&&x[1]==='/tasks/')[2]);
    expect(payload.title).toBe('Только название задачи');
    for(const key of ['team_id','task_type_id','channel_id','date_received'])expect(payload[key]).toBeUndefined();
  });
}

test('editor can clear team, type, channel, date and progress',async({page},testInfo)=>{
  await open(page);
  await page.evaluate(async()=>{const m=await import('/js/components/modal.js?v=99');m.openTaskModal(window.__taskCardFixture.task);});
  await expect(page.locator('#task-tab-sys')).toContainText('2');
  await page.getByRole('button',{name:'Редактировать задачу',exact:true}).click();
  for(const key of ['team','type','channel'])await page.locator(`[data-k="${key}"]`).selectOption('',{force:true});
  await page.locator('[data-k="receivedAt"]').fill('');
  await page.locator('[data-k="progress"]').fill('');
  await page.locator('#mbody').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:testInfo.outputPath('optional-fields-cleared-full.png'),fullPage:true});
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toHaveCount(0);
  const payload=await page.evaluate(()=>window.__apiCalls.filter(x=>x[0]==='patch').at(-1)[2]);
  for(const key of ['team_id','task_type_id','channel_id','date_received'])expect(payload[key]).toBeNull();
  expect(payload.progress).toBe(0);
});
