// Read-only local visual acceptance. Credentials never leave this process.
import {chromium} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const origin='http://127.0.0.1:8000';
const output=new URL('../../../.runtime/evidence/segmented-a-2026-11-04/',import.meta.url);
const results=[];await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try{
 for(const [profile,role,routes] of [
  ['member',/^BA\/Участник команды$/i,['backlog','metrics','work-tasks','settings','express-estimate','quarterly-goals-update']],
  ['admin',/админ/i,['reporting-meetings']]
 ]){
  if(process.argv.includes('--admin-only')&&profile!=='admin')continue;
  if(process.argv.includes('--backlog-only')&&profile!=='member')continue;
  let data=JSON.parse(await readFile(new URL('../../../.runtime/test-accounts.json',import.meta.url),'utf8'));
  let account=data.accounts.find(a=>a.is_active&&a.credential_state==='ready'&&role.test(a.role));data=null;
  if(!account){results.push({profile,status:'unavailable-ready-profile'});continue}
  console.log('Live profile: '+profile);
  const context=await browser.newContext({viewport:{width:1366,height:900}});
  await context.route('**/*',r=>{
   const request=r.request(),url=new URL(request.url());
   if(url.origin!==origin)return r.abort();
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!/\/auth\/(?:login|refresh|logout)$/.test(url.pathname))return r.abort();
   return r.continue();
  });
  const page=await context.newPage();await page.goto(origin+'/#/backlog',{waitUntil:'domcontentloaded'});
  if(new URL(page.url()).origin!==origin)throw Error('Unexpected origin');
  await page.locator('#login-email').fill(account.login);await page.locator('#login-password').fill(account.password);account=null;
  await page.getByRole('button',{name:'Войти в систему',exact:true}).click();await page.locator('#page-content').waitFor({timeout:30000});console.log('Live session ready: '+profile);
  for(const theme of ['light','dark'])for(const route of routes){
   if(process.argv.includes('--backlog-only')&&route!=='backlog')continue;
   console.log('Live surface: '+route+' / '+theme);
   await page.evaluate(t=>localStorage.setItem('dmb_theme',t),theme);await page.goto(origin+'/#/'+route,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
   try{
    await page.locator('.ui-segmented:visible').first().waitFor({timeout:60000});await page.locator('.ui-segmented:visible').first().locator('[aria-pressed=true]').waitFor();
    if(route==='backlog')await page.locator('#tasks-content[data-ready=true]').waitFor({timeout:45000});
    if(route==='work-tasks')await page.locator('[data-work-row]').first().waitFor({timeout:30000});
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
    const geometry=await page.locator('.ui-segmented:visible').evaluateAll(es=>es.map(g=>{const b=g.querySelector('[aria-pressed=true]'),t=g.querySelector('.ui-segment-thumb');return{label:g.getAttribute('aria-label'),height:g.getBoundingClientRect().height,selected:g.querySelectorAll('[aria-pressed=true]').length,ready:g.hasAttribute('data-segment-ready'),offset:b&&t?Math.abs(b.getBoundingClientRect().x-t.getBoundingClientRect().x):null}}));
    await page.screenshot({path:fileURLToPath(new URL(`${profile}-${route}-${theme}-1366.png`,output)),fullPage:true});
    results.push({profile,route,theme,status:geometry.every(g=>g.selected===1&&g.ready&&g.offset<1)?'PASS':'FAIL',geometry});
    if(route==='reporting-meetings'){
     await page.locator('[data-meeting-view=timeline]').click();
     await page.locator('[data-meeting-view=timeline][aria-pressed=true]').waitFor();
     await page.screenshot({path:fileURLToPath(new URL(`${profile}-${route}-${theme}-timeline.png`,output)),fullPage:true});
    }
    if(route==='settings'){
     await page.setViewportSize({width:390,height:844});await page.screenshot({path:fileURLToPath(new URL(`${profile}-${route}-${theme}-390.png`,output)),fullPage:true});await page.setViewportSize({width:1366,height:900});
    }
   }catch(error){if(!await page.locator('#login-password').isVisible())await page.screenshot({path:fileURLToPath(new URL(`${profile}-${route}-${theme}-diagnostic.png`,output)),fullPage:true});results.push({profile,route,theme,status:'not-observed',reason:String(error.message).split('\n')[0]});}
  }
  await context.close();
 }
}finally{await browser.close();const filename=process.argv.includes('--admin-only')?'results-admin.json':process.argv.includes('--backlog-only')?'results-backlog.json':'results.json';await writeFile(new URL(filename,output),JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({profile,route,theme,status})=>({profile,route,theme,status}))));}
