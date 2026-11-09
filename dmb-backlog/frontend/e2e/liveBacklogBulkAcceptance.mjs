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
 browser=await chromium.launch({headless:true});phase='live bulk and policy';const admin=await login(/админ/i);const{page}=admin;const ids=[];let teamSession;
 try{
  const metadata=await page.evaluate(async()=>{const r=await window.app.api.get('/tasks/reference');const u=window.app.store.get('currentUser');return{teams:r.teams.map(t=>({id:t.id})),teamId:u.team_id,typeId:r.task_types[0]?.id,channelId:r.channels[0]?.id,canDelete:u.permissions.task_delete==='all'};});check(metadata.typeId&&metadata.channelId&&metadata.canDelete,'Existing references and cleanup authority available');
  async function create(teamId){const data={title:'QA bulk объединение '+randomUUID(),team_id:teamId,task_type_id:metadata.typeId,channel_id:metadata.channelId,date_received:new Date().toISOString().slice(0,10),client_request_id:randomUUID()};const id=await page.evaluate(async d=>(await window.app.api.post('/tasks/',d)).id,data);if(!Number.isSafeInteger(id))throw Error('No created Task ID');ids.push(id);return id;}
  const own=metadata.teamId||metadata.teams[0]?.id;const a=await create(own),b=await create(own);
  const versions=await page.evaluate(async ids=>Object.fromEntries(await Promise.all(ids.map(async id=>[id,(await window.app.api.get('/tasks/'+id)).version]))),[a,b]);const request={action:'update',task_ids:[a,b],versions,fields:{progress:10}};
  const preview=await page.evaluate(d=>window.app.api.post('/tasks/bulk/preview',d),request);check(preview.can_apply&&preview.changed_tasks===2,'Bulk preview includes exactly both QA Tasks');
  await page.evaluate(({id,version})=>window.app.api.put('/tasks/'+id,{progress:5,version}),{id:a,version:versions[a]});
  const rejected=await page.evaluate(async d=>{try{await window.app.api.post('/tasks/bulk',d);return 0;}catch(e){return e.status;}},request);check(rejected===409,'Bulk rejects a version changed after preview');
  const unchanged=await page.evaluate(id=>window.app.api.get('/tasks/'+id),b);check(unchanged.progress===0&&unchanged.version===versions[b],'Conflict rolls back the whole bulk; second Task unchanged');
  const fresh=await page.evaluate(async ids=>Object.fromEntries(await Promise.all(ids.map(async id=>[id,(await window.app.api.get('/tasks/'+id)).version]))),[a,b]);request.versions=fresh;
  const applied=await page.evaluate(d=>window.app.api.post('/tasks/bulk',d),request);check(applied.changed_tasks===2&&applied.changed_task_ids.length===2&&!!applied.operation_id,'Fresh bulk commits both Tasks with operation ID');
  const after=await page.evaluate(async ids=>Promise.all(ids.map(id=>window.app.api.get('/tasks/'+id))),[a,b]);check(after.every(t=>t.progress===10),'Only the requested progress value is applied');
  const replay=await page.evaluate(async d=>{try{await window.app.api.post('/tasks/bulk',d);return 0;}catch(e){return e.status;}},request);check(replay===409,'An old-version update cannot execute a second time');
  const afterReplay=await page.evaluate(async ids=>Promise.all(ids.map(id=>window.app.api.get('/tasks/'+id))),[a,b]);check(afterReplay.every((t,i)=>t.version===after[i].version),'Rejected replay does not advance versions');
  teamSession=await login(/^(?:BA\/Участник команды|PO\/PL\/CL)$/i);const teamId=await teamSession.page.evaluate(()=>window.app.store.get('currentUser').team_id);const foreign=metadata.teams.find(t=>t.id!==teamId)?.id;check(teamId&&foreign,'Existing distinct teams available for object-policy negatives');
  const teamTask=await create(teamId),foreignTask=await create(foreign);const negativeRows=await page.evaluate(async ids=>Promise.all(ids.map(id=>window.app.api.get('/tasks/'+id))),[teamTask,foreignTask]);
  const deniedForeign=await teamSession.page.evaluate(async({id,version})=>{try{await window.app.api.put('/tasks/'+id,{title:'QA denied foreign mutation',version});return 0;}catch(e){return e.status;}},{id:foreignTask,version:negativeRows[1].version});check(deniedForeign===403,'Team editor cannot mutate a foreign ordinary QA Task');
  const deniedTransfer=await teamSession.page.evaluate(async({id,version,target})=>{try{await window.app.api.put('/tasks/'+id,{team_id:target,version});return 0;}catch(e){return e.status;}},{id:teamTask,version:negativeRows[0].version,target:foreign});check(deniedTransfer===403,'Team editor cannot transfer its QA Task to another team');
  const retained=await page.evaluate(id=>window.app.api.get('/tasks/'+id),teamTask);check(retained.team_id===teamId,'Rejected transfer preserves the original responsible team');
 }finally{
  await teamSession?.context.close();
  for(const id of ids){try{await page.evaluate(async id=>{const row=await window.app.api.get('/tasks/'+id);await window.app.api.delete('/tasks/'+id+'?version='+row.version);},id);results.push({check:'Only a Task created by this run was removed',status:'PASS'});}catch{results.push({check:'Ordinary QA Task cleanup',status:'FAIL',taskId:id});process.exitCode=1;}}
  await admin.context.close();
 }
}catch(error){results.push({check:phase,errorType:error?.name||'Error',status:'FAIL',reason:'Live step failed; credentials and request details intentionally omitted'});process.exitCode=1;}
finally{await browser?.close();await writeFile(new URL('../../../.runtime/backlog-unification-live-bulk.json',import.meta.url),JSON.stringify({mode:'live PostgreSQL; only ordinary QA Tasks; no protected preparation',results},null,2));console.log(JSON.stringify(results));}
