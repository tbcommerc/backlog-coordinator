import test from 'node:test';
import assert from 'node:assert/strict';
import {taskReferenceId, taskReferenceOptions, taskReferenceIdentity, selectTaskReference,
  involvedTeamIds, restoreReferenceDraft, involvedTeamOptions, toggleInvolvedTeam} from '../js/taskCardReferences.js';

const catalog = {
  users:[{id:11,name:'Иван Иванов',login:'ivan.one'},{id:22,name:'Иван Иванов',login:'ivan.two'}],
  customers:[{id:31,name:'Заказчик',department_id:101},{id:32,name:'Заказчик',department_id:102}],
  departments:[{id:101,name:'Розница'},{id:102,name:'Бизнес'}],
  projects:[{id:41,name:'Проект',code:'ONE'},{id:42,name:'Проект',code:'TWO'}],
  teams:[{id:51,name:'Команда'}],
};

test('same names retain different IDs and distinguishable option labels', () => {
  for (const [key, ids] of [['assignee',[11,22]],['customer',[31,32]],['project',[41,42]]]) {
    const state = {};
    const options = taskReferenceOptions(state,key,catalog);
    assert.deepEqual(options.map(item=>item.value),ids.map(String));
    assert.equal(new Set(options.map(item=>item.label)).size,2);
    for (const id of ids) { assert.equal(selectTaskReference(state,key,String(id),catalog),true); assert.equal(taskReferenceId(state,key,catalog),id); }
  }
});

test('customer department follows the selected ID, including duplicate names', () => {
  const state = {};
  selectTaskReference(state,'customer','32',catalog);
  assert.equal(state.customerId,32);assert.equal(state.customerDeptId,'102');assert.equal(state.customerDept,'Бизнес');
  selectTaskReference(state,'customer','31',catalog);
  assert.equal(state.customerId,31);assert.equal(state.customerDeptId,'101');
});

test('renames preserve identity while changing between equal labels is dirty', () => {
  assert.equal(taskReferenceIdentity({assigneeId:11,assignee:'Старое имя'},'assignee',catalog),taskReferenceIdentity({assigneeId:11,assignee:'Новое имя'},'assignee',catalog));
  assert.notEqual(taskReferenceIdentity({assigneeId:11,assignee:'Иван Иванов'},'assignee',catalog),taskReferenceIdentity({assigneeId:22,assignee:'Иван Иванов'},'assignee',catalog));
});

test('unavailable stored reference remains selected but cannot be newly assigned', () => {
  const state={assigneeId:99,assignee:'Бывший исполнитель'};
  const option=taskReferenceOptions(state,'assignee',catalog).find(item=>item.value==='99');
  assert.equal(option.disabled,true);assert.match(option.label,/Бывший исполнитель.*недоступно/);
  assert.equal(taskReferenceId(state,'assignee',catalog),99);
  assert.equal(selectTaskReference(state,'assignee','99',catalog),false);
  assert.equal(selectTaskReference(state,'assignee','',catalog),true);assert.equal(taskReferenceId(state,'assignee',catalog),null);
});

test('legacy names never guess duplicates and stored IDs survive an empty catalog', () => {
  assert.equal(taskReferenceId({assignee:'Иван Иванов'},'assignee',catalog),null);
  assert.equal(taskReferenceId({assigneeId:11,assignee:'Иван Иванов'},'assignee',{}),11);
  assert.equal(taskReferenceId({team:'Команда'},'team',catalog),51);
  const draft=restoreReferenceDraft({assignee:'Иван Иванов',team:'Команда',otherTeams:[]},{assignee:'Другой',assigneeId:1,teamId:51,team:'Команда'},catalog);
  assert.equal(draft.assigneeId,null);assert.equal(draft.teamId,51);
});

test('involved team IDs remain stable across renames or temporary reference failure', () => {
  assert.deepEqual(involvedTeamIds({otherTeams:['Старое имя'],otherTeamIds:[51]},{}),[51]);
  assert.deepEqual(involvedTeamIds({otherTeams:['Команда']},catalog),[51]);
});

test('deleted and recreated team names do not replace historical involved IDs', () => {
  const state={otherTeams:['Команда'],otherTeamIds:[49]};
  const options=involvedTeamOptions(state,catalog);
  assert.equal(options.find(row=>row.id===49).historical,true);
  assert.equal(options.find(row=>row.id===51).selected,false);
  toggleInvolvedTeam(state,'49',catalog);toggleInvolvedTeam(state,'51',catalog);
  assert.deepEqual(state.otherTeams,['Команда']);assert.deepEqual(state.otherTeamIds,[51]);
});
