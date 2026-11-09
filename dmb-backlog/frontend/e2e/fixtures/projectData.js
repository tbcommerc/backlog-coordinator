export const workspace = (project={id:1,name:'Направление'}) => ({
 project:{code:'DIR',description:'Развитие направления',status:'Активен',responsible:'Ответственный',...project},
 year:2026,years:[2026,2027],teams:[{id:10,name:'Команда'}],backlog_total:6,metrics_total:1,
 work:{total:4,active:2,done:1,overdue:1,blocked:1,in_acceptance:0},
 plan:{1:1,2:2,3:0,4:1,annual:1,unplanned:1}
});

export const management = () => ({
 items:[{id:7,public_id:'TASK-7',kind:'backlog',title:'Улучшение процесса',owner:'Ответственный',team:'Команда',deadline:'4Q 2026',status:'В работе',status_code:'in_progress',version:2,can_edit:true,precision:'exact',spans:[{start:'2026-10-01',end:'2026-11-13'}],starts_on:'2026-10-01',ends_on:'2026-11-13',baseline_start:'2026-10-01',baseline_end:'2026-10-30',is_milestone:true,milestone_on:'2026-11-13',expected_result:'Согласован процесс',change_reason:'Уточнены требования',issues:['shifted'],delay_days:14}],
 total:1,page:1,summary:{planned:1,milestones:1,milestones_done:0,attention:1,completed_work:1,undated:1},
 start:'2026-10-01',end_exclusive:'2027-01-01',today:'2026-11-03',chart_start:'2026-10-01',chart_end:'2026-12-31',
 milestones:[],attention:[],recent_results:[{id:3,title:'Принятый результат',completed_at:'2026-10-15',result:'Согласовано'}]
});
