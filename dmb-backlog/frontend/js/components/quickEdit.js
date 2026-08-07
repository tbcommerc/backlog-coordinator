import { showConfirmModal, showErrorModal } from './modal.js';
import { updateStickyOffsets } from './filterToolbar.js?v=45';

console.log('[DMB] quickEdit.js v20260804 loaded');

const DISPLAY_TO_FIELD = {
  status: 'status_id',
  priority: 'priority_id',
  team: 'team_id',
  channel: 'channel_id',
  business_customer: 'business_customer_id',
  department: 'department_id',
  project: 'project_id',
  task_type: 'task_type_id',
  deadline: 'deadline_id',
  owner: 'owner_id',
};

const EDITABLE_FIELDS = {
  text: ['title', 'description', 'comment', 'link_mockups', 'rejection_reason', 'metric_kr_unit'],
  number: ['effort_days', 'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery', 'effort_python_be',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics', 'actual_effort_be', 'actual_effort_fe', 'actual_effort_test', 'actual_effort_test_auto',
    'actual_effort_python_be', 'actual_effort_delivery',
    'financial_effect', 'metric_kr_plan', 'metric_kr_fact'],
  select: ['status_id', 'priority_id', 'team_id', 'deadline_id', 'task_type_id', 'channel_id', 'department_id', 'project_id', 'owner_id'],
  checkbox: ['did_demo'],
  date: ['date_received'],
  tags: ['tags']
};

const states = {};
const scopeOpts = {};

function getState(scope) {
  if (!states[scope]) states[scope] = { mode: false, changes: {}, history: [], historyIndex: -1 };
  return states[scope];
}

function pluralize(n, one, few, many) {
  const m = Math.abs(n);
  const mod10 = m % 10;
  const mod100 = m % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function renderQuickEditToolbar(scope) {
  return `
    <div id="qe-toolbar-${scope}" class="qe-toolbar" style="display:none;padding:12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="color:var(--warning);font-weight:600;">⚠ Режим быстрого редактирования</span>
        <span id="qe-count-${scope}" style="color:var(--text-secondary);font-size:13px;">Изменений: 0 в 0 задачах</span>
        <div style="flex:1;"></div>
        <button class="btn btn-secondary btn-sm" id="qe-undo-${scope}" title="Отменить 1 шаг" disabled>↩</button>
        <button class="btn btn-secondary btn-sm" id="qe-redo-${scope}" title="Вернуть изменения" disabled>↪</button>
        <button class="btn btn-secondary btn-sm" id="qe-cancel-${scope}">Отменить все</button>
        <button class="btn btn-primary btn-sm" id="qe-save-${scope}">Сохранить</button>
      </div>
    </div>
  `;
}

export function initQuickEdit(scope, opts = {}) {
  scopeOpts[scope] = opts;
  const st = getState(scope);
  st.mode = false;
  st.changes = {};
  st.history = [];
  st.historyIndex = -1;

  const toolbar = document.getElementById(`qe-toolbar-${scope}`);
  if (toolbar) toolbar.style.display = 'none';

  document.getElementById(`qe-save-${scope}`)?.addEventListener('click', () => { confirmAndSave(scope); });
  document.getElementById(`qe-cancel-${scope}`)?.addEventListener('click', () => { cancelAll(scope); });
  document.getElementById(`qe-undo-${scope}`)?.addEventListener('click', () => { undo(scope); });
  document.getElementById(`qe-redo-${scope}`)?.addEventListener('click', () => { redo(scope); });

  bindStickySupport(scope);

  if (!document.__qeGlobalBound) {
    document.__qeGlobalBound = true;

    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    document.addEventListener('keydown', (e) => {
      Object.keys(states).forEach(scope => {
        if (states[scope].mode) handleKeydown(scope, e);
      });
    });

    const cellHandler = (e) => {
      const target = e.target;
      if (!target || !target.dataset || !target.dataset.task || !target.dataset.field) return;
      Object.keys(states).forEach(scope => {
        if (states[scope].mode) handleCellChange(scope, target);
      });
    };
    document.addEventListener('change', cellHandler);
    document.addEventListener('input', cellHandler);
  }
}

function handleKeydown(scope, e) {
  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(scope); return; }
    if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo(scope); return; }
    if (e.code === 'KeyS') { e.preventDefault(); confirmAndSave(scope); return; }
  }
  if (e.key === 'Escape') { e.preventDefault(); requestExitQuickEdit(scope); }
}

export function isQuickEdit(scope) {
  return !!getState(scope).mode;
}

export function getQuickEditChanges(scope) {
  return getState(scope).changes;
}

function bindStickySupport(scope) {
  if (!document.__qeStickyBound) {
    document.__qeStickyBound = true;
    window.addEventListener('resize', () => {
      Object.keys(states).forEach(s => { if (states[s].mode) updateQeStickyTop(s); });
    });
  }
  const sticky = document.querySelector('.sticky-toolbar');
  if (sticky && !sticky.__qeObserved && typeof MutationObserver !== 'undefined') {
    sticky.__qeObserved = true;
    new MutationObserver(() => {
      Object.keys(states).forEach(s => { if (states[s].mode) updateQeStickyTop(s); });
    }).observe(sticky, { childList: true, subtree: true, attributes: true });
  }
}

function updateQeStickyTop(scope) {
  const toolbar = document.getElementById(`qe-toolbar-${scope}`);
  if (!toolbar) return;
  const navbarHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height')) || 64;
  const sticky = document.querySelector('.sticky-toolbar');
  const stickyH = sticky ? sticky.getBoundingClientRect().height : 0;
  toolbar.style.top = (navbarHeight + stickyH) + 'px';
  updateStickyOffsets();
}

export function enterQuickEdit(scope) {
  const st = getState(scope);
  st.mode = true;
  const toolbar = document.getElementById(`qe-toolbar-${scope}`);
  if (toolbar) toolbar.style.display = 'block';
  updateQeStickyTop(scope);
  updateQuickEditCount(scope);
  if (scopeOpts[scope]?.renderView) scopeOpts[scope].renderView();
}

export function exitQuickEdit(scope) {
  const st = getState(scope);
  st.mode = false;
  st.changes = {};
  st.history = [];
  st.historyIndex = -1;
  const toolbar = document.getElementById(`qe-toolbar-${scope}`);
  if (toolbar) {
    toolbar.style.display = 'none';
    toolbar.style.top = '';
  }
  updateQuickEditCount(scope);
  updateStickyOffsets();
  if (scopeOpts[scope]?.renderView) scopeOpts[scope].renderView();
}

export async function requestExitQuickEdit(scope) {
  const st = getState(scope);
  if (Object.keys(st.changes).length > 0) {
    const confirmed = await showConfirmModal('Отменить все изменения? Значения вернутся к исходным. Пошаговый откат будет недоступен.', 'Отменить все изменения?');
    if (!confirmed) return false;
  }
  exitQuickEdit(scope);
  return true;
}

export function updateQuickEditCount(scope) {
  const st = getState(scope);
  const countEl = document.getElementById(`qe-count-${scope}`);
  const undoBtn = document.getElementById(`qe-undo-${scope}`);
  const redoBtn = document.getElementById(`qe-redo-${scope}`);
  const saveBtn = document.getElementById(`qe-save-${scope}`);
  if (countEl) {
    const taskCount = Object.keys(st.changes).length;
    const fieldCount = Object.keys(st.changes).reduce((acc, tid) => acc + Object.keys(st.changes[tid]).length, 0);
    countEl.textContent = `Изменений: ${fieldCount} в ${taskCount} ${pluralize(taskCount, 'задаче', 'задачах', 'задачах')}`;
  }
  if (undoBtn) undoBtn.disabled = st.historyIndex < 0;
  if (redoBtn) redoBtn.disabled = st.historyIndex >= st.history.length - 1;
  if (saveBtn) saveBtn.disabled = Object.keys(st.changes).length === 0;
  updateStickyOffsets();
}

function recordChange(scope, taskId, field, oldValue, newValue) {
  const st = getState(scope);
  st.history = st.history.slice(0, st.historyIndex + 1);
  st.history.push({ taskId, field, oldValue, newValue });
  st.historyIndex = st.history.length - 1;
  updateQuickEditCount(scope);
}

function handleCellChange(scope, el) {
  const taskId = parseInt(el.dataset.task);
  const field = el.dataset.field;
  const original = el.dataset.original;
  let newValue = el.type === 'checkbox' ? el.checked : el.value;
  let oldValue = original;

  if (el.type === 'checkbox') {
    oldValue = original === 'true';
  } else if (el.type === 'number') {
    newValue = newValue !== '' ? parseFloat(newValue) : null;
    oldValue = original !== '' ? parseFloat(original) : null;
  } else if (el.tagName === 'SELECT') {
    newValue = newValue !== '' ? parseInt(newValue) : null;
    oldValue = original !== '' ? parseInt(original) : null;
  } else if (field === 'tags') {
    newValue = String(newValue || '').split(',').map(x => x.trim()).filter(Boolean);
    oldValue = String(original || '').split(',').map(x => x.trim()).filter(Boolean);
  }

  const st = getState(scope);
  if (String(newValue) === String(oldValue)) {
    if (st.changes[taskId] && st.changes[taskId][field]) {
      delete st.changes[taskId][field];
      if (Object.keys(st.changes[taskId]).length === 0) {
        delete st.changes[taskId];
      }
    }
  } else {
    if (!st.changes[taskId]) st.changes[taskId] = {};
    st.changes[taskId][field] = { oldValue, newValue };
    recordChange(scope, taskId, field, oldValue, newValue);
  }

  const row = el.closest('tr');
  const td = el.closest('td');
  if (row) {
    const rowTaskId = parseInt(row.dataset.taskId);
    const hasTaskChanges = st.changes[rowTaskId] && Object.keys(st.changes[rowTaskId]).length > 0;
    row.style.borderLeft = hasTaskChanges ? '3px solid var(--warning)' : '';
  }
  if (td) {
    const hasFieldChanges = st.changes[taskId] && st.changes[taskId][field];
    td.style.background = hasFieldChanges ? 'rgba(245, 158, 11, 0.2)' : '';
  }
}

function undo(scope) {
  const st = getState(scope);
  if (st.historyIndex < 0) return;
  const action = st.history[st.historyIndex];
  if (st.changes[action.taskId] && st.changes[action.taskId][action.field]) {
    if (st.changes[action.taskId][action.field].oldValue === action.oldValue) {
      delete st.changes[action.taskId][action.field];
      if (Object.keys(st.changes[action.taskId]).length === 0) {
        delete st.changes[action.taskId];
      }
    }
  }
  st.historyIndex--;
  updateQuickEditCount(scope);
  if (scopeOpts[scope]?.renderView) scopeOpts[scope].renderView();
}

function redo(scope) {
  const st = getState(scope);
  if (st.historyIndex >= st.history.length - 1) return;
  st.historyIndex++;
  const action = st.history[st.historyIndex];
  if (!st.changes[action.taskId]) st.changes[action.taskId] = {};
  st.changes[action.taskId][action.field] = { oldValue: action.oldValue, newValue: action.newValue };
  updateQuickEditCount(scope);
  if (scopeOpts[scope]?.renderView) scopeOpts[scope].renderView();
}

async function confirmAndSave(scope) {
  const st = getState(scope);
  const count = Object.keys(st.changes).reduce((acc, tid) => acc + Object.keys(st.changes[tid]).length, 0);
  if (count === 0) {
    window.toast?.('Нет изменений для сохранения', 'info');
    return;
  }
  const confirmed = await showConfirmModal(`Будет сохранено ${count} изменений. Продолжить?`, 'Сохранить изменения');
  if (!confirmed) return;
  await saveQuickEditChanges(scope);
}

async function cancelAll(scope) {
  const st = getState(scope);
  if (Object.keys(st.changes).length === 0) {
    exitQuickEdit(scope);
    return;
  }
  const confirmed = await showConfirmModal('Отменить все изменения? Значения вернутся к исходным. Пошаговый откат будет недоступен.', 'Отменить все изменения?');
  if (!confirmed) return;
  st.changes = {};
  st.history = [];
  st.historyIndex = -1;
  updateQuickEditCount(scope);
  if (scopeOpts[scope]?.renderView) scopeOpts[scope].renderView();
}

async function saveQuickEditChanges(scope) {
  const st = getState(scope);
  const opts = scopeOpts[scope] || {};
  const tasks = opts.getTasks ? opts.getTasks() : [];
  const saveBtn = document.getElementById(`qe-save-${scope}`);
  if (saveBtn) {
    saveBtn.textContent = 'Сохраняю…';
    saveBtn.disabled = true;
  }
  let saved = 0;
  let errors = 0;
  const errorDetails = [];
  for (const [taskId, fields] of Object.entries(st.changes)) {
    const task = tasks.find(t => t.id == taskId);
    if (!task) continue;
    const data = {};
    const fieldNames = [];
    for (const [field, ch] of Object.entries(fields)) {
      data[field] = ch.newValue;
      const label = opts.getColumnLabel ? (opts.getColumnLabel(field) || field) : field;
      fieldNames.push(`${label}: ${ch.oldValue ?? '—'} → ${ch.newValue ?? '—'}`);
    }
    data.version = task.version;
    try {
      const resp = await opts.app.api.put(`/tasks/${taskId}`, data);
      saved++;
      if (resp && resp.version !== undefined) {
        task.version = resp.version;
      }
    } catch (e) {
      errors++;
      const errorMsg = e.message || String(e);
      errorDetails.push({
        taskId,
        taskTitle: task.title,
        fields: fieldNames.join(', '),
        httpStatus: e.status || '?',
        error: errorMsg,
      });
    }
  }
  if (saveBtn) {
    saveBtn.textContent = 'Сохранить';
    saveBtn.disabled = false;
  }
  if (errors > 0) {
    await showErrorModal(saved, errors, errorDetails);
  } else {
    window.toast?.(`Сохранено ${saved} ${pluralize(saved, 'задача', 'задачи', 'задач')}`, 'success');
  }
  st.changes = {};
  st.history = [];
  st.historyIndex = -1;
  exitQuickEdit(scope);
  if (opts.afterSave) await opts.afterSave();
}

export function getQuickEditField(col) {
  return DISPLAY_TO_FIELD[col] || col;
}

export function isEditableField(col) {
  const field = DISPLAY_TO_FIELD[col] || col;
  return EDITABLE_FIELDS.text.includes(field) ||
         EDITABLE_FIELDS.number.includes(field) ||
         EDITABLE_FIELDS.select.includes(field) ||
         EDITABLE_FIELDS.checkbox.includes(field) ||
         EDITABLE_FIELDS.date.includes(field) ||
         EDITABLE_FIELDS.tags.includes(field);
}

export function renderQuickEditCell(scope, col, task) {
  const field = DISPLAY_TO_FIELD[col] || col;
  const taskId = task.id;
  const st = getState(scope);
  const currentValue = task[field];
  const change = st.changes[taskId]?.[field];
  const value = change ? change.newValue : currentValue;

  if (EDITABLE_FIELDS.tags.includes(field)) {
    const toNames = v => Array.isArray(v)
      ? v.map(x => typeof x === 'object' && x !== null ? String(x.name || '') : String(x)).filter(Boolean).join(', ')
      : String(v || '');
    const curNames = toNames(currentValue);
    const valNames = toNames(value);
    return `<input type="text" value="${escapeHtml(valNames)}" data-task="${taskId}" data-field="${field}" data-original="${escapeHtml(curNames)}" style="width:100%;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;" placeholder="теги через запятую">`;
  }
  if (EDITABLE_FIELDS.text.includes(field)) {
    return `<input type="text" value="${escapeHtml(value || '')}" data-task="${taskId}" data-field="${field}" data-original="${escapeHtml(currentValue || '')}" style="width:100%;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  }
  if (EDITABLE_FIELDS.number.includes(field)) {
    return `<input type="number" value="${value != null ? value : ''}" data-task="${taskId}" data-field="${field}" data-original="${currentValue != null ? currentValue : ''}" style="width:80px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  }
  if (EDITABLE_FIELDS.checkbox.includes(field)) {
    return `<input type="checkbox" ${value ? 'checked' : ''} data-task="${taskId}" data-field="${field}" data-original="${currentValue ? 'true' : 'false'}" style="margin:0;">`;
  }
  if (EDITABLE_FIELDS.date.includes(field)) {
    return `<input type="date" value="${value || ''}" data-task="${taskId}" data-field="${field}" data-original="${currentValue || ''}" style="padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  }
  if (EDITABLE_FIELDS.select.includes(field)) {
    return renderSelectForEdit(col, taskId, field, value, currentValue);
  }
  return '';
}

function renderSelectForEdit(col, taskId, field, value, currentValue) {
  let options = '';
  let displayValue = value;

  switch (field) {
    case 'status_id':
      options = window.app?.statuses?.map(s => `<option value="${s.id}" ${s.id == value ? 'selected' : ''}>${s.name}</option>`).join('') || '';
      displayValue = window.app?.statuses?.find(s => s.id == value)?.name || value;
      break;
    case 'priority_id':
      options = window.app?.priorities?.map(p => `<option value="${p.id}" ${p.id == value ? 'selected' : ''}>${p.name}</option>`).join('') || '';
      displayValue = window.app?.priorities?.find(p => p.id == value)?.name || value;
      break;
    case 'team_id':
      options = window.app?.teams?.map(t => `<option value="${t.id}" ${t.id == value ? 'selected' : ''}>${t.name}</option>`).join('') || '';
      displayValue = window.app?.teams?.find(t => t.id == value)?.name || value;
      break;
    case 'deadline_id':
      options = window.app?.deadlines?.map(d => `<option value="${d.id}" ${d.id == value ? 'selected' : ''}>${d.name}</option>`).join('') || '';
      displayValue = window.app?.deadlines?.find(d => d.id == value)?.name || value;
      break;
    case 'task_type_id':
      options = window.app?.taskTypes?.map(t => `<option value="${t.id}" ${t.id == value ? 'selected' : ''}>${t.name}</option>`).join('') || '';
      displayValue = window.app?.taskTypes?.find(t => t.id == value)?.name || value;
      break;
    case 'channel_id':
      options = window.app?.channels?.map(c => `<option value="${c.id}" ${c.id == value ? 'selected' : ''}>${c.name}</option>`).join('') || '';
      displayValue = window.app?.channels?.find(c => c.id == value)?.name || value;
      break;
    case 'department_id':
      options = window.app?.departments?.map(d => `<option value="${d.id}" ${d.id == value ? 'selected' : ''}>${d.name}</option>`).join('') || '';
      displayValue = window.app?.departments?.find(d => d.id == value)?.name || value;
      break;
    case 'project_id':
      options = window.app?.projects?.map(p => `<option value="${p.id}" ${p.id == value ? 'selected' : ''}>${p.name}</option>`).join('') || '';
      displayValue = window.app?.projects?.find(p => p.id == value)?.name || value;
      break;
    case 'owner_id':
      const users = window.app?.users || [];
      options = users.map(u => `<option value="${u.id}" ${u.id == value ? 'selected' : ''}>${u.name}</option>`).join('');
      displayValue = users.find(u => u.id == value)?.name || value;
      break;
    default:
      return `<span>${displayValue || '—'}</span>`;
  }

  return `<select data-task="${taskId}" data-field="${field}" data-original="${currentValue || ''}" style="width:100%;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;background:var(--bg-primary);">${options}</select>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function hasUnsavedChanges() {
  return Object.keys(states).some(s => {
    const st = states[s];
    return st.mode && Object.keys(st.changes).length > 0;
  });
}

export function confirmDiscardChanges(okText = 'Продолжить', message = 'Есть несохранённые изменения. Продолжить и потерять их?') {
  if (!hasUnsavedChanges()) return Promise.resolve(true);
  return showConfirmModal(message, 'Несохранённые изменения', okText, 'Отмена', false);
}

export function clearQuickEditState() {
  Object.keys(states).forEach(s => {
    states[s].mode = false;
    states[s].changes = {};
    states[s].history = [];
    states[s].historyIndex = -1;
  });
}
