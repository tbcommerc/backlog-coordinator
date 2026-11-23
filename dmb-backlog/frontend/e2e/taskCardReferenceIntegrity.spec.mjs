import {test,expect} from '@playwright/test';

async function prepare(page, mode='normal', theme='light') {
  await page.goto(`/e2e/fixtures/taskCardIncrement.html?theme=${theme}#/backlog?task=42`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect(page.locator('#task-tab-sys')).toContainText('2');
  await page.evaluate(async mode=>{
    const {reference:r,task}=window.__taskCardFixture;
    const additions={statuses:[108,'Аудит статуса'],priorities:[107,'Аудит приоритета'],deadlines:[109,'Аудит срока'],teams:[101,'Аудит команды'],projects:[105,'Аудит проекта'],task_types:[106,'Аудит типа'],channels:[102,'Аудит канала'],departments:[103,'Аудит подразделения'],did_client_groups:[104,'Аудит клиента ДИД']};
    for(const [key,[id,name]] of Object.entries(additions))r[key].push({id,name});
    r.business_customers.push({id:111,name:'Аудит заказчика',department_id:103});
    r.users.push({id:110,name:'Аудит исполнителя',login:'audit.one',team_id:101,is_active:true});
    if(mode==='duplicates') {
      r.users.push({id:112,name:'Аудит исполнителя',login:'audit.two',team_id:101,is_active:true});
      r.departments.push({id:113,name:'Другое подразделение'});
      r.business_customers.push({id:112,name:'Аудит заказчика',department_id:113});
      r.projects.push({id:115,name:'Аудит проекта',code:'TWO'});r.projects.find(x=>x.id===105).code='ONE';
    }
    if(mode==='archived') {
      r.departments=r.departments.filter(x=>x.id!==task.department_id);
      r.did_client_groups=r.did_client_groups.filter(x=>x.id!==task.did_client_group_id);
      r.tags=r.tags.filter(x=>x.name!=='Q4');
    }
    if(mode==='failed') {
      window.__referenceGet=window.app.api.get.bind(window.app.api);
      window.app.api.get=async(path,opts)=>{
        if(path==='/tasks/reference'&&!window.__referencesRecovered)throw new Error('503 isolated reference failure');
        return window.__referenceGet(path,opts);
      };
    }
    const m=await import('/js/components/modal.js?v=99');m.closeModal();
  },mode);
  await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
  await page.evaluate(async()=>{const m=await import('/js/components/modal.js?v=99');m.openTaskModal(window.__taskCardFixture.task);});
  await expect(page.locator('#task-tab-sys')).toContainText('2');
}
async function edit(page) {
  await page.getByRole('button',{name:'Редактировать задачу',exact:true}).click();
  await expect(page.locator('[data-k="title"]')).toBeVisible();
}
async function save(page) {
  await page.locator('#saveBtn').click();await expect(page.locator('#saveBtn')).toHaveCount(0);
  return page.evaluate(()=>window.__apiCalls.filter(x=>x[0]==='patch').at(-1)?.[2]);
}

test('eleven selectors send typed IDs',async({page},info)=>{
  await prepare(page);await edit(page);
  const selected={status:'108',priority:'107',deadline:'109',team:'101',project:'105',type:'106',channel:'102',customer:'111',assignee:'110',customerDeptId:'103',didClientId:'104'};
  for(const [key,value] of Object.entries(selected))await page.locator(`[data-k="${key}"]`).selectOption(value,{force:true});
  await page.screenshot({path:info.outputPath('all-fields-full.png'),fullPage:true});
  expect(await save(page)).toMatchObject({status_id:108,priority_id:107,deadline_id:109,team_id:101,project_id:105,task_type_id:106,channel_id:102,business_customer_id:111,owner_id:110,department_id:103,did_client_group_id:104});
});

test('same names select the intended user, customer department and project',async({page},info)=>{
  await prepare(page,'duplicates');await edit(page);
  const users=page.locator('[data-k="assignee"]');
  await expect(users.locator('option[value="110"]')).toContainText('audit.one');
  await expect(users.locator('option[value="112"]')).toContainText('audit.two');
  await users.selectOption('110',{force:true});
  await page.locator('[data-k="customer"]').selectOption('112',{force:true});
  await expect(page.locator('[data-k="customerDeptId"]')).toHaveValue('113');
  await page.locator('[data-k="project"]').selectOption('115',{force:true});
  await page.screenshot({path:info.outputPath('duplicate-selection-full.png'),fullPage:true});
  expect(await save(page)).toMatchObject({owner_id:110,business_customer_id:112,department_id:113,project_id:115});
  await edit(page);await page.locator('[data-k="assignee"]').selectOption('112',{force:true});
  await expect(page.locator('#saveBtn')).toBeEnabled();
  expect(await save(page)).toMatchObject({owner_id:112});
});

test('unavailable department and DID remain selected until explicit clearing',async({page},info)=>{
  await prepare(page,'archived');await edit(page);
  for(const [key,value] of [['customerDeptId','3'],['didClientId','4']]){
    await expect(page.locator(`[data-k="${key}"]`)).toHaveValue(value);
    await expect(page.locator(`[data-k="${key}"] option:checked`)).toContainText('недоступно');
    await expect(page.locator(`[data-k="${key}"] option:checked`)).toBeDisabled();
  }
  await page.locator('[data-k="title"]').fill('Изменено без потери архива');
  const payload=await save(page);expect(payload).not.toHaveProperty('department_id');expect(payload).not.toHaveProperty('did_client_group_id');
  await edit(page);await page.locator('[data-k="customerDeptId"]').selectOption('');
  await page.screenshot({path:info.outputPath('historical-values-full.png'),fullPage:true});
  expect(await save(page)).toMatchObject({department_id:null});
});

test('historical tag can be kept or explicitly removed, and cannot be re-added',async({page})=>{
  await prepare(page,'archived');await edit(page);
  const tag=page.locator('[data-toggle="tags"][data-val="Q4"]');
  await expect(tag).toContainText('недоступно');await expect(tag).toHaveAttribute('aria-pressed','true');
  await tag.click();await expect(tag).toHaveCount(0);
  const payload=await save(page);expect(payload.tags).not.toContain('Q4');
});

for(const theme of ['light','dark'])for(const width of [1440,390])test(`reference failure preserves data and retries without losing draft: ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:width===390?844:1000});
  await prepare(page,'failed',theme);
  await expect(page.locator('#mbody')).toContainText('Не удалось загрузить справочники');
  await edit(page);await expect(page.locator('[data-k="priority"]')).toBeDisabled();
  await expect(page.locator('[data-k="assignee"]').locator('..').locator('.dict-combobox-trigger')).toBeDisabled();
  await page.locator('[data-k="title"]').fill('Сохранённый черновик при отказе');
  const overflow=await page.locator('.ui-task-edit-field .dict-combobox-trigger').evaluateAll(nodes=>nodes.some(node=>node.getBoundingClientRect().right>window.innerWidth+1));
  expect(overflow).toBe(false);
  await page.screenshot({path:info.outputPath('reference-failure-full.png'),fullPage:true});
  await page.evaluate(()=>{window.__referencesRecovered=true;});
  await page.locator('[data-read-kind="task-dictionaries"]').click();
  await expect(page.locator('[data-k="priority"]')).toBeEnabled();
  await expect(page.locator('[data-k="title"]')).toHaveValue('Сохранённый черновик при отказе');
  await page.locator('[data-k="priority"]').selectOption('107');
  expect(await save(page)).toMatchObject({priority_id:107,title:'Сохранённый черновик при отказе'});
});

test('involved teams use IDs even when an old name is reused',async({page})=>{
  await prepare(page);
  await page.evaluate(async()=>{
    const {task,reference}=window.__taskCardFixture;
    task.involved_teams=[987654321];task.involved_team_names=['Аудит команды'];
    const m=await import('/js/components/modal.js?v=99');m.closeModal();
  });
  await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
  await page.evaluate(async()=>{(await import('/js/components/modal.js?v=99')).openTaskModal(window.__taskCardFixture.task);});
  await expect(page.locator('#task-tab-sys')).toContainText('2');await edit(page);
  const old=page.locator('[data-toggle="otherTeams"][data-val="987654321"]');
  await expect(old).toHaveAttribute('aria-pressed','true');await old.click();
  await page.locator('[data-toggle="otherTeams"][data-val="101"]').click();
  await expect(page.locator('#saveBtn')).toBeEnabled();
  expect(await save(page)).toMatchObject({involved_teams:[101]});
});
