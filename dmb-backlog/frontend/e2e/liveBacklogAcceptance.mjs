// Live QA only. No traces, screenshots, credential output, or protected-data preparation.
import {chromium} from '@playwright/test';import{readFile,writeFile}from 'node:fs/promises';import{randomUUID}from 'node:crypto';
const origin='http://127.0.0.1:8000';const results=[];let phase='startup',browser;
const check=(value,name)=>{if(!value)throw Error(name);results.push({check:name,status:'PASS'});};
async function login(roleMatch){
 let parsed=JSON.parse(await readFile(new URL('../../../.runtime/test-accounts.json',import.meta.url),'utf8'));let account=parsed.accounts.find(a=>a.is_active===true&&a.credential_state==='ready'&&roleMatch.test(a.role));parsed=null;
 if(!account)throw Error('No suitable ready QA account');
 const group=phase;phase=group+' / initial UI';
 const context=await browser.newContext();await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();await page.goto(origin+'/#/backlog',{waitUntil:'domcontentloaded'});
 await page.locator('#login-email, #page-content').first().waitFor({state:'visible',timeout:30000});
 if(await page.locator('#login-email').isVisible()){
  phase=group+' / normal login';
  if(new URL(page.url()).origin!==origin)throw Error('Unexpected login origin');await page.locator('#login-email').fill(account.login);
  if(new URL(page.url()).origin!==origin)throw Error('Unexpected login origin');await page.locator('#login-password').fill(account.password);account=null;
  await page.getByRole('button',{name:'Войти в систему',exact:true}).click();
 }else account=null;
 phase=group+' / authenticated UI';
 await page.locator('#page-content').waitFor({state:'visible',timeout:30000});check(new URL(page.url()).origin===origin,'Authenticated on authorized origin');
 phase=group;return{context,page};
}
try{
 browser=await chromium.launch({headless:true});
 for(const [label,match]of [['team',/^(?:BA\/Участник команды|PO\/PL\/CL)$/i],['readonly',/Лидер трайба/i]]){
  phase='live profile '+label;const {context,page}=await login(match);
  const caps=await page.evaluate(()=>{const u=window.app.store.get('currentUser');return{teamId:u.team_id,edit:u.permissions.task_edit,dmb:u.permissions.backlog_dmb};});
  const scope=label==='team'?'team':'all';await page.goto(origin+'/#/backlog?bv=2&scope='+scope,{waitUntil:'domcontentloaded'});await page.locator('#tasks-content[data-ready="true"]').waitFor({timeout:30000});check(await page.locator('#tasks-table').isVisible(),label+' register loads');
  if(scope==='team')check(await page.evaluate(async()=>{const u=window.app.store.get('currentUser');const d=await window.app.api.get('/tasks/?per_page=1000&team_id='+u.team_id);return d.items.every(t=>t.team_id===u.team_id&&t.metric_id==null);}), 'Team API excludes other teams and metrics');
  if(caps.edit==='none')check(await page.locator('#backlog-inline-edit').isDisabled(),'Read-only profile cannot enter quick editor');
  await context.close();
 }
 phase='live ordinary Task create/update/delete';const {context,page}=await login(/админ/i);const title='QA объединение бэклога '+randomUUID();let id;
 try{
  const metadata=await page.evaluate(async()=>{const r=await window.app.api.get('/tasks/reference');const u=window.app.store.get('currentUser');return{teamId:u.team_id||r.teams[0]?.id,typeId:r.task_types.find(t=>t.name==='AD-HOC')?.id||r.task_types[0]?.id,channelId:r.channels[0]?.id,canDelete:u.permissions.task_delete==='all'};});
  check(metadata.teamId&&metadata.typeId&&metadata.channelId&&metadata.canDelete,'Existing references and cleanup authority available');
  const payload={title,team_id:metadata.teamId,task_type_id:metadata.typeId,channel_id:metadata.channelId,date_received:new Date().toISOString().slice(0,10),client_request_id:randomUUID()};
  id=await page.evaluate(async data=>(await window.app.api.post('/tasks/',data)).id,payload);check(Number.isSafeInteger(id),'Ordinary QA task created');
  await page.goto(origin+'/#/backlog?bv=2&scope=all&q='+encodeURIComponent(title),{waitUntil:'domcontentloaded'});await page.locator('#tasks-content[data-ready="true"]').waitFor({timeout:30000});check(await page.locator('tr[data-task-id="'+id+'"]').count()===1,'Created task appears in full filtered register');
  await page.locator('#backlog-inline-edit').click();await page.locator('[data-task="'+id+'"][data-field="title"]').fill(title+' — проверено');await page.locator('#qe-save-backlog').click();await page.getByRole('button',{name:'ОК',exact:true}).click();await page.locator('#qe-toolbar-backlog').waitFor({state:'hidden',timeout:20000});
  check(await page.evaluate(async({id,title})=>(await window.app.api.get('/tasks/'+id)).title===title,{id,title:title+' — проверено'}),'Quick edit persisted on PostgreSQL with current version');
  await page.locator('tr[data-task-id="'+id+'"] a[href*="task="]').click();await page.locator('#task-detail-overlay').waitFor();check(new URL(page.url()).hash.includes('scope=all'),'Task card retains list scope');
 }finally{
  if(id){try{await page.evaluate(async id=>{const row=await window.app.api.get('/tasks/'+id);await window.app.api.delete('/tasks/'+id+'?version='+row.version);},id);results.push({check:'Only created ordinary QA task removed',status:'PASS'});}catch{results.push({check:'QA task cleanup',status:'FAIL',taskId:id});}}
  await context.close();
 }
}catch(error){results.push({check:phase,errorType:error?.name||'Error',status:'FAIL',reason:'Live step failed; credentials and request details intentionally omitted'});process.exitCode=1;}
finally{await browser?.close();await writeFile(new URL('../../../.runtime/backlog-unification-live.json',import.meta.url),JSON.stringify({mode:'live PostgreSQL; agents disabled',results},null,2));console.log(JSON.stringify(results));}
