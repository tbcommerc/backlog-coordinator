import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
for(const route of ['backlog','team-backlog'])test('deep link survives delayed optional shell module: '+route,async({page})=>{
 await mockApp(page);let release;const gate=new Promise(r=>release=r);await page.route('**/backlog-assistant/context-help.js',async route=>{await gate;await route.continue();});
 try{await page.goto('/#/'+route+'?task=41',{waitUntil:'domcontentloaded'});await expect(page.locator('#task-detail-overlay')).toBeVisible();}finally{release();}
});
for(const route of ['backlog','team-backlog'])for(const theme of ['light','dark'])test('contrast table labels and overdue dates: '+route+' '+theme,async({page},testInfo)=>{
 const {tasks}=await mockApp(page);tasks[0].deadline_name='1Q 2020';tasks[0].deadline_id=1;tasks[0].priority_name=null;await page.goto('/#/'+route);await page.locator('tr[data-task-id="41"]').waitFor();await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
 const row=page.locator('tr[data-task-id="41"]');const measurements=[];
 for(const state of ['normal','hover','selection']){
 if(state==='hover')await row.hover();if(state==='selection')await row.locator('input[type="checkbox"]').check();
 const results=await page.evaluate(()=>{
  const rgba=s=>{const m=s.match(/[\d.]+/g)?.map(Number)||[0,0,0];return [m[0],m[1],m[2],m[3]??1];};
  const blend=(f,b)=>f.slice(0,3).map((v,i)=>v*f[3]+b[i]*(1-f[3]));
  const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  const elements=[...document.querySelectorAll('table th, tr[data-task-id="41"] .text-muted, tr[data-task-id="41"] span')].filter(e=>e.getBoundingClientRect().width&&e.textContent.trim()&&(e.matches('th,.text-muted')||e.textContent==='1Q 2020'));
  return elements.map(e=>{let parents=[];for(let p=e;p;p=p.parentElement)parents.unshift(p);let bg=[255,255,255];for(const p of parents)bg=blend(rgba(getComputedStyle(p).backgroundColor),bg);const fg=blend(rgba(getComputedStyle(e).color),bg);const a=luminance(fg),b=luminance(bg);return {text:e.textContent.trim(),color:getComputedStyle(e).color,bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
 });expect(results.length).toBeGreaterThan(3);expect(results.some(r=>r.text==='1Q 2020')).toBe(true);for(const r of results)expect(r.ratio,JSON.stringify({state,...r})).toBeGreaterThanOrEqual(4.5);measurements.push({state,results});
 }console.log(JSON.stringify({route,theme,measurements:measurements.map(m=>({state:m.state,count:m.results.length,min:Math.min(...m.results.map(r=>r.ratio))}))}));await testInfo.attach('contrast-measurements',{body:JSON.stringify(measurements,null,2),contentType:'application/json'});
});
