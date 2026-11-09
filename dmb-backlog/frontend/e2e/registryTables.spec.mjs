import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';
import { setupWorkDesignPilot } from './helpers/workDesignPilot.mjs';
import { workspace, management } from './fixtures/projectData.js';

const phase = process.env.TABLE_CAPTURE || 'after';
const options = { user_id:101, team_id:7, can_create:false, business_date:'2026-11-04', teams:[{id:7,name:'Продукт'}], users:[{id:101,name:'Мария Соколова'}], projects:[], meetings:[] };
const period = { id:7, year:2026, quarter:4, state:'active', availability:'active', plan:{target:'100',result_type:'volume',direction:'up'}, fact:{value:'90',as_of_date:'2026-11-03'}, result:{outcome:'not_achieved',progress:90,is_final:false}, capabilities:{} };
const metrics = ['Сократить время согласования требований', 'Повысить долю задач с согласованным результатом', 'Обеспечить доступность сервиса'].map((title,i)=>({id:i+1, public_id:`MET-00${i+1}`, title, unit:'%', owner:'Мария Соколова', model_version:'quarterly_v2', lifecycle_state:'tracking', period, display_precision:0}));

async function setup(page, surface, theme) {
  if (surface === 'work') return setupWorkDesignPilot(page, {theme});
  await mockApp(page);
  await page.clock.setFixedTime(new Date('2026-11-04T09:00:00Z'));
  await page.addInitScript(theme=>localStorage.setItem('dmb_theme',theme),theme);
  await page.route('**/api/v2/metrics**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/options') ? options : {items:metrics,total:3,page:1,pages:1,summary:{}}}));
  await page.route('**/api/v1/projects**',route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path.endsWith('/workspace')?workspace():path.endsWith('/management')?management():{
      items:['Развитие платформы','Бюджетирование IT-проектов','Автоматизация протоколов встреч'].map((name,i)=>({id:i+1,name,code:`PRJ-00${i+1}`,responsible:'Мария Соколова',status:'Активен',backlog_count:8+i,overdue:i,next_milestone:'2026-11-13'})),total:3,page:1,filter_options:{teams:[],owners:[]}};
    return route.fulfill({json:data});
  });
  await page.goto('/#/'+({backlog:'backlog',metrics:'metrics?year=2026&quarter=4&view=quarter',projects:'work-projects?cview=table',plan:'work-projects?project=1&section=backlog&year=2026&quarter=4'})[surface]);
}

for (const surface of ['backlog','metrics','work','projects','plan']) for (const theme of ['light','dark']) for (const width of [1440,390]) {
  test(`${surface} ${theme} ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await setup(page,surface,theme);
    const table=page.locator('table.ui-table-data').first();
    await expect(table.locator('tbody td').first()).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:info.outputPath(`${phase}.png`),fullPage:true,animations:'disabled'});
    if (phase==='before') return;
    await expect(table).toHaveAttribute('data-ui-table','registry');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const title=table.locator('.ui-table-title').first();
    await expect(title).toBeVisible();
    const style=await title.evaluate(el=>{const s=getComputedStyle(el);return {size:s.fontSize,weight:s.fontWeight};});
    expect(style).toEqual({size:'12px',weight:'600'});
    if(width===1440){
      const padding=await table.locator('tbody td').first().evaluate(el=>getComputedStyle(el).padding);
      expect(padding).toBe('10px 12px');
    }
    if(surface==='projects'){
      await title.click();
      await expect(page).toHaveURL(/project=1/);
    }
    if(surface==='work'){
      await title.click();
      await expect(page.locator('.work-card-title')).toBeVisible();
    }
  });
}
