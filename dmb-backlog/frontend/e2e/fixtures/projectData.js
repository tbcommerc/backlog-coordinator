export const workspace = (project={id:1,name:'Направление'}) => ({
 project:{code:'DIR',description:'Развитие направления',status:'Активен',responsible:'Ответственный',...project},
 year:2026,years:[2026,2027],teams:[{id:10,name:'Команда'}],backlog_total:6,metrics_total:1,
 work:{total:4,active:2,done:1,overdue:1,blocked:1,in_acceptance:0},
 plan:{1:1,2:2,3:0,4:1,annual:1,unplanned:1}
});
