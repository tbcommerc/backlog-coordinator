import {test, expect} from '@playwright/test';
const task={id:1,public_id:'WRK-1',title:'Подготовить требования к интеграции',assignee_name:'Исполнитель',status:'in_progress',due_date:'2026-10-25',context:{title:'Проект'}};
const items=Array.from({length:12},(_,i)=>({...task,id:i+1,public_id:`WRK-${i+1}`}));
const summary={total:12,active:8,done:2,overdue:1,blocked:1,in_acceptance:2,proposals:0};
test('work pages keep data in the first viewport at desktop and enlarged scale',async({page},testInfo)=>{
 await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname;await route.fulfill({json:path.endsWith('/options')?{can_create:true,teams:[],users:[],projects:[{id:1,name:'IB'}]}:path.endsWith('/reporting-meetings')?[]:path.endsWith('/work-reports')?{available:true,mode:'live',as_of:'2026-10-17',summary,items,major_summary:{obligations:6,with_external_links:0},major_items:[]}:path.endsWith('/major-tasks')?{total:6,items:items.slice(0,6)}:{items,summary,total:12}});});
 for(const width of [1440,1280]){
  await page.setViewportSize({width,height:600});await page.goto('/e2e/fixtures/workTasks.html');
  await page.evaluate(()=>{const main=document.querySelector('main');main.classList.add('main-content');main.style.marginLeft='248px';main.style.marginTop='64px';});
  for(const name of ['Tasks','Reports','Projects']){
   await page.evaluate(async name=>{const m=await import(`/static/js/components/work${name}.js`);document.querySelector('main').innerHTML=m[`renderWork${name}`]();await m[`initWork${name}`](window.app);},name);
   if(name==='Projects')await page.locator('#work-project').selectOption('1');
   await expect(page.locator('.work-table tbody tr').first()).toBeVisible();
   const geometry=await page.evaluate(()=>{const rows=[...document.querySelectorAll(document.querySelector('.work-queue') ? '[data-work-row]' : '.work-table tbody tr')].map(x=>x.getBoundingClientRect());return {top:Math.round(rows[0].top),visibleRows:rows.filter(x=>x.bottom<=innerHeight).length,overflow:document.documentElement.scrollWidth>innerWidth};});
   console.log(name,width,JSON.stringify(geometry));expect(geometry.overflow).toBe(false);
   // Keep navigation within the original first-viewport budget.
   expect(geometry.top).toBeLessThanOrEqual(name==='Projects'?450:name==='Reports'?280:260);
   expect(geometry.visibleRows).toBeGreaterThanOrEqual(name==='Projects'?4:name==='Reports'?8:4);
   await page.screenshot({path:testInfo.outputPath(`${name}-${width}.png`)});
  }
 }
});
