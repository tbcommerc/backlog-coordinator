import { mockApp } from './helpers/backlogMock.mjs';
import { setupWorkDesignPilot } from './helpers/workDesignPilot.mjs';

const options = { user_id:101, team_id:7, can_create:false, business_date:'2026-11-04', teams:[{id:7,name:'Продукт'}], users:[{id:101,name:'Мария Соколова'}], projects:[], meetings:[] };
const period = { id:7, year:2026, quarter:4, state:'active', availability:'active', plan:{target:'100',result_type:'volume',direction:'up'}, fact:{value:'90',as_of_date:'2026-11-03'}, result:{outcome:'not_achieved',progress:90,is_final:false}, capabilities:{} };
const titles = ['Сократить время согласования требований', 'Повысить долю задач с согласованным результатом', 'Обеспечить доступность сервиса'];
const metrics = Array.from({length:25},(_,i)=>({id:i+1,public_id:`MET-${i+1}`,title:titles[i%3],unit:'%',owner:'Мария Соколова',model_version:'quarterly_v2',lifecycle_state:'tracking',period,quarters:[period,period,period,period],display_precision:0}));

export async function setup(page, surface, theme) {
  if (surface === 'work') {
    const data = await setupWorkDesignPilot(page, {theme});
    await page.route('**/api/v1/work-tasks?**', route=>route.fulfill({json:{items:Array.from({length:24},(_,i)=>({...data.rows[i%8],id:76+i,public_id:`WRK-${76+i}`})),total:24,summary:{total:24},collection_counts:{mine:24}}}));
    await page.reload();
    return;
  }
  await mockApp(page, {count:205});
  await page.clock.setFixedTime(new Date('2026-11-04T09:00:00Z'));
  await page.addInitScript(theme=>localStorage.setItem('dmb_theme',theme),theme);
  await page.route('**/api/v2/metrics**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/options') ? options : {items:metrics,total:25,page:1,pages:1,summary:{}}}));
  await page.route('**/api/v1/projects**',route=>route.fulfill({json:{items:Array.from({length:24},(_,i)=>({id:i+1,name:['Развитие платформы','Бюджетирование IT-проектов','Автоматизация протоколов встреч'][i%3],code:`PRJ-${i+1}`,responsible:'Мария Соколова',status:'Активен',backlog_count:8+i,overdue:i,next_milestone:'2026-11-13'})),total:24,page:1,filter_options:{teams:[],owners:[]}}}));
  await page.goto('/#/'+({backlog:'backlog',metrics:'metrics?year=2026&quarter=4&view=quarter',projects:'work-projects?cview=table'})[surface]);
}
