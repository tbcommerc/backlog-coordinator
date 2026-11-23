// Display names are labels; task foreign keys and draft identity are stable IDs.
export const TASK_REFERENCES = Object.freeze({
  status: {dict:'statuses', id:'statusId', field:'status_id'},
  priority: {dict:'priorities', id:'priorityId', field:'priority_id'},
  deadline: {dict:'deadlines', id:'deadlineId', field:'deadline_id'},
  team: {dict:'teams', id:'teamId', field:'team_id'},
  project: {dict:'projects', id:'projectId', field:'project_id'},
  type: {dict:'taskTypes', id:'taskTypeId', field:'task_type_id'},
  channel: {dict:'channels', id:'channelId', field:'channel_id'},
  customer: {dict:'customers', id:'customerId', field:'business_customer_id'},
  assignee: {dict:'users', id:'assigneeId', field:'owner_id'},
});

export function referenceId(value) {
  if (value === '' || value == null) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function uniqueReferenceByName(rows, name) {
  const matches = (rows || []).filter(row => row.name === name);
  return matches.length === 1 ? matches[0] : null;
}

export function taskReferenceId(state, key, catalog = {}) {
  const meta = TASK_REFERENCES[key];
  if (!meta || !state) return null;
  return referenceId(state[meta.id]) ?? referenceId(uniqueReferenceByName(catalog?.[meta.dict], state[key])?.id);
}

export function taskReferenceIdentity(state, key, catalog) {
  const id = taskReferenceId(state, key, catalog);
  return id == null ? `name:${state?.[key] || ''}` : `id:${id}`;
}

export function taskReferenceOptions(state, key, catalog = {}) {
  const meta = TASK_REFERENCES[key];
  const rows = (catalog?.[meta.dict] || []).filter(row => row.is_active !== false);
  const names = new Map();
  rows.forEach(row => names.set(row.name, (names.get(row.name) || 0) + 1));
  const options = rows.map(row => {
    let label = row.name;
    if (names.get(row.name) > 1) {
      const context = row.login || row.code || row.department_name
        || catalog?.departments?.find(item => item.id === row.department_id)?.name;
      label += ` (${context || 'ID ' + row.id})`;
    }
    return {value:String(row.id), label, id:row.id};
  });
  const labels = new Map();
  options.forEach(row => labels.set(row.label, (labels.get(row.label) || 0) + 1));
  options.forEach(row => { if (labels.get(row.label) > 1) row.label += ` · ID ${row.id}`; });
  const selected = taskReferenceId(state, key, catalog);
  if (selected != null && !options.some(row => row.id === selected)) {
    options.unshift({value:String(selected), id:selected,
      label:`${state?.[key] || 'ID ' + selected} (недоступно)`, disabled:true});
  }
  return options;
}

export function selectTaskReference(state, key, value, catalog = {}) {
  const meta = TASK_REFERENCES[key];
  const id = referenceId(value);
  const row = (catalog?.[meta.dict] || []).find(item => referenceId(item.id) === id && item.is_active !== false);
  if (value !== '' && (!row || id == null)) return false;
  state[meta.id] = id;
  state[key] = row?.name || '';
  if (key === 'customer') {
    state.customerDeptId = String(row?.department_id ?? '');
    state.customerDept = row?.department_name
      || catalog?.departments?.find(item => item.id === row?.department_id)?.name || '';
  }
  return true;
}

export function involvedTeamIds(state, catalog = {}) {
  const originalNames = state?.otherTeams || [];
  return originalNames.map((name, index) => referenceId(state?.otherTeamIds?.[index])
    ?? referenceId(uniqueReferenceByName(catalog?.teams, name)?.id)).filter(id => id != null);
}

export function involvedTeamOptions(state, catalog = {}) {
  const ids = involvedTeamIds(state, catalog);
  const rows = (catalog?.teams || []).map(row => ({id:referenceId(row.id), name:row.name}));
  ids.forEach((id,index) => {
    if (!rows.some(row=>row.id===id)) rows.push({id,name:state.otherTeams?.[index] || 'ID '+id, historical:true});
  });
  return rows.sort((a,b)=>Number(ids.includes(b.id))-Number(ids.includes(a.id)))
    .map(row=>({...row,selected:ids.includes(row.id)}));
}

export function toggleInvolvedTeam(state, value, catalog = {}) {
  const id=referenceId(value), options=involvedTeamOptions(state,catalog);
  if (!options.some(row=>row.id===id)) return false;
  const ids=involvedTeamIds(state,catalog);
  state.otherTeamIds=ids.includes(id)?ids.filter(item=>item!==id):[...ids,id];
  state.otherTeams=state.otherTeamIds.map(item=>options.find(row=>row.id===item)?.name || 'ID '+item);
  return true;
}

export function restoreReferenceDraft(draft, current, catalog = {}) {
  if (draft.referenceSchemaVersion === 1) return draft;
  // Old drafts stored names. Resolve only unambiguous changes; never guess a duplicate.
  Object.entries(TASK_REFERENCES).forEach(([key, meta]) => {
    draft[meta.id] = draft[key] === current[key] ? taskReferenceId(current, key, catalog)
      : referenceId(uniqueReferenceByName(catalog?.[meta.dict], draft[key])?.id);
  });
  draft.otherTeamIds = (draft.otherTeams || []).map(name => referenceId(uniqueReferenceByName(catalog?.teams, name)?.id));
  draft.referenceSchemaVersion = 1;
  return draft;
}
