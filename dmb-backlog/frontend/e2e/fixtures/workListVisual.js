import {renderWorkTasks,initWorkTasks} from '/static/js/components/workTasks.js';
import {renderSidebar} from '/static/js/components/sidebar.js';
import {initModalAccessibility} from '/static/js/modalAccessibility.js';
const rows=[
 {id:76,title:'Уточнить источники данных для бюджетирования',status:'in_progress',priority:'high',blocked_reason:'Ожидаем выгрузку из реестра',due_date:'2026-10-19',context:{title:'Бюджетирование IT-проектов'},checklist_progress:{done:0,total:2}},
 {id:77,title:'Подготовить шаблон протокола проектной встречи',status:'in_acceptance',priority:'normal',due_date:'2026-10-22',context:{title:'Автоматизация протоколов встреч'},checklist_progress:{done:1,total:2},acceptor_name:'В. Стодольский'},
 {id:78,title:'Подготовиться к обзору рабочих задач',status:'ready',due_date:'2026-10-21',priority:'normal'},
 {id:79,title:'Согласовать подробные критерии готовности и порядок проверки результата с участниками межкомандного процесса',status:'new',due_date:'2026-10-25',priority:'urgent',context:{title:'Очень длинное название проекта развития внутреннего реестра и согласования требований'}},
 ...Array.from({length:4},(_,i)=>({id:80+i,title:['Собрать вопросы к ретроспективе','Проверить согласованный результат','Подготовить план демонстрации','Обновить инструкцию по приёмке'][i],status:'ready',priority:'normal',due_date:'2026-10-28'}))
].map(r=>({public_id:'WRK-'+r.id,description:'Ожидаемый результат и критерии его проверки',version:1,assignee_id:1,assignee_name:'Александр Константинопольский',execution_team_id:10,requester_id:1,assignment_state:'accepted',available_actions:[],...r}));
const app={store:{get:()=>({id:1,team_id:10,permissions:{}})},router:{refreshCurrentRoute:()=>{}},api:{get:async path=>path.endsWith('/options')?{can_create:true,board_enabled:true,teams:[{id:10,name:'Продукт'}],users:[],projects:[]}:/work-tasks\/\d+$/.test(path)?rows.find(r=>r.id===Number(path.split('/').pop())):path.includes('/work-tasks?')?{items:rows,total:8,collection_counts:{mine:8,acceptance:2,requested:9,team:15,all:40}}:[],post:async()=>{throw Error('Демонстрация: запись отключена');},patch:async()=>{throw Error('Демонстрация: запись отключена');}}};
document.getElementById('visual-sidebar').innerHTML=renderSidebar();
document.getElementById('page-content').innerHTML=renderWorkTasks();
initModalAccessibility();await initWorkTasks(app);
