// === DMB Backlog — Подробная карточка задачи (Master-Detail) ===
// === Референс: Карточка задачи - референс.html ===
// === 24 атрибута, 6 табов, KPI Strip, связь с БД ===

// === STATE ===
let currentTask = null;
let modalMode = 'view';
let currentModal = null;
let onSaveCallback = null;

// === LOCK STATE ===
let _lockInfo = null; // { locked, lock_owner_id, lock_owner_name, lock_until, is_mine }
let _lockPollTimer = null;

// === VIEWER STATE ===
let _viewerPollTimer = null;
let _currentViewers = [];

// === CONFLICT STATE ===
let _conflictData = null; // { detail: { message, current_version, submitted_version, task } }
let _conflictApp = null;

// === HELPERS ===
function metricFormat(val) {
  if (val === null || val === undefined || val === '') return '—';
  return new Intl.NumberFormat('ru-RU').format(val);
}

// === COMMENTS STATE ===
let _commentsCache = [];
let _usersCache = [];
let _mentionedUserIds = [];
let _commentTaskId = null;
let _mentionSelectedIdx = -1;
let _mentionQueryStart = -1;

// === ATTACHMENTS STATE ===
let _attachmentsCache = [];
let _attachmentFormInitialized = false;

// === REPLY STATE ===
let _replyingTo = null;

function escapeHtml(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

function renderInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  return Array.isArray(teams) ? teams.join(', ') : teams;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name[0].toUpperCase();
}

function avatarColor(name) {
  const colors = ['#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#f97316','#f59e0b','#10b981','#06b6d4','#0ea5e9'];
  if (!name) return colors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function cvClass(val) {
  if (val === null || val === '—') return '';
  const num = parseFloat(val);
  if (num >= 1.5) return 'text-success';
  if (num < 1) return 'text-danger';
  return 'text-warning';
}

function statusColor(status) {
  const map = {
    'НОВАЯ ЗАДАЧА': '#6b7280',
    'НАЗНАЧЕНА КОМАНДА': '#6b7280',
    'СБОР ТРЕБОВАНИЙ': '#6b7280',
    'ПРОВЕРКА ТРЕБОВАНИЙ': '#6b7280',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': '#6b7280',
    'ЭКСПРЕСС-ОЦЕНКА': '#6b7280',
    'ПРИНЯТИЕ РЕШЕНИЯ': '#f59e0b',
    'ПРИНЯТА В РАБОТУ': '#3b82f6',
    'ЭСКАЛАЦИЯ НА ЛТ': '#8b5cf6',
    'ХОЛД': '#8b5cf6',
    'ОТКЛОНЕНА': '#ef4444',
    'НЕ АКТУАЛЬНА': '#94a3b8',
    'ВЫПОЛНЕНА': '#10b981'
  };
  return map[status] || '#6b7280';
}

function statusBg(status) {
  const map = {
    'НОВАЯ ЗАДАЧА': '#f1f5f9',
    'НАЗНАЧЕНА КОМАНДА': '#f1f5f9',
    'СБОР ТРЕБОВАНИЙ': '#f1f5f9',
    'ПРОВЕРКА ТРЕБОВАНИЙ': '#f1f5f9',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': '#f1f5f9',
    'ЭКСПРЕСС-ОЦЕНКА': '#f1f5f9',
    'ПРИНЯТИЕ РЕШЕНИЯ': '#fef3c7',
    'ПРИНЯТА В РАБОТУ': '#dbeafe',
    'ЭСКАЛАЦИЯ НА ЛТ': '#ede9fe',
    'ХОЛД': '#ede9fe',
    'ОТКЛОНЕНА': '#fee2e2',
    'НЕ АКТУАЛЬНА': '#f1f5f9',
    'ВЫПОЛНЕНА': '#d1fae5'
  };
  return map[status] || '#f1f5f9';
}

function priorityColor(priority) {
  const map = { 'ВЫСОКИЙ': '#ef4444', 'СРЕДНИЙ': '#f59e0b', 'НИЗКИЙ': '#6b7280' };
  return map[priority] || '#6b7280';
}

function priorityBg(priority) {
  const map = { 'ВЫСОКИЙ': '#fee2e2', 'СРЕДНИЙ': '#fef3c7', 'НИЗКИЙ': '#f1f5f9' };
  return map[priority] || '#f1f5f9';
}

// === LOCK HELPERS ===
async function fetchLockStatus(taskId) {
  const api = window.app?.api;
  if (!api || !taskId) return null;
  try {
    return await api.get(`/tasks/${taskId}/lock`);
  } catch (e) {
    console.error('Failed to fetch lock status:', e);
    return null;
  }
}

async function acquireLock(taskId) {
  const api = window.app?.api;
  if (!api || !taskId) return null;
  try {
    return await api.post(`/tasks/${taskId}/lock`);
  } catch (e) {
    return { error: e.status || 500, detail: e.message || 'Lock failed' };
  }
}

async function releaseLock(taskId) {
  const api = window.app?.api;
  if (!api || !taskId) return;
  try {
    await api.delete(`/tasks/${taskId}/lock`);
  } catch (e) {
    console.error('Failed to release lock:', e);
  }
}

function startLockPolling(taskId) {
  stopLockPolling();
  _lockPollTimer = setInterval(async () => {
    if (modalMode !== 'view' || !currentTask?.id) return;
    const status = await fetchLockStatus(taskId);
    if (status && !status.error) {
      _lockInfo = status;
      renderLockBanner();
    }
  }, 30000);
}

function stopLockPolling() {
  if (_lockPollTimer) {
    clearInterval(_lockPollTimer);
    _lockPollTimer = null;
  }
}

// === VIEWER HELPERS ===
const VIEWER_POLL_INTERVAL = 15000;

async function registerViewer(taskId) {
  const api = window.app?.api;
  if (!api || !taskId) return null;
  try {
    return await api.post(`/tasks/${taskId}/viewers`);
  } catch (_) { return null; }
}

async function unregisterViewer(taskId) {
  const api = window.app?.api;
  if (!api || !taskId) return;
  try { await api.delete(`/tasks/${taskId}/viewers`); } catch (_) {}
}

async function fetchViewers(taskId) {
  const api = window.app?.api;
  if (!api || !taskId) return [];
  try {
    const data = await api.get(`/tasks/${taskId}/viewers`);
    return data.viewers || [];
  } catch (_) { return []; }
}

function startViewerPolling(taskId) {
  stopViewerPolling();
  _viewerPollTimer = setInterval(async () => {
    if (!document.getElementById('task-detail-overlay')) {
      stopViewerPolling();
      return;
    }
    _currentViewers = await fetchViewers(taskId);
    renderViewerBanner();
  }, VIEWER_POLL_INTERVAL);
}

function stopViewerPolling() {
  if (_viewerPollTimer) {
    clearInterval(_viewerPollTimer);
    _viewerPollTimer = null;
  }
  _currentViewers = [];
}

function renderViewerBanner() {
  const bannerEl = document.getElementById('td-viewer-banner');
  if (!bannerEl) return;

  if (_currentViewers.length > 0) {
    const names = _currentViewers.map(v => escapeHtml(v.user_name || 'Неизвестный'));
    const suffix = names.length === 1
      ? names[0]
      : names.slice(0, 2).join(', ') + (names.length > 2 ? ` и ещё ${names.length - 2}` : '');
    bannerEl.innerHTML = `<div class="task-detail-viewer-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      <span>${_currentViewers.length === 1 ? 'Просматривает' : 'Просматривают'}: <strong>${suffix}</strong></span>
    </div>`;
    bannerEl.style.display = 'block';
  } else {
    bannerEl.innerHTML = '';
    bannerEl.style.display = 'none';
  }
}

function renderLockBanner() {
  const bannerEl = document.getElementById('td-lock-banner');
  if (!bannerEl) return;

  if (_lockInfo && _lockInfo.locked && !_lockInfo.is_mine) {
    const name = _lockInfo.lock_owner_name || 'Неизвестный';
    const until = _lockInfo.lock_until
      ? new Date(_lockInfo.lock_until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : '';
    bannerEl.innerHTML = `<div class="task-detail-lock-banner">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span>Редактируется пользователем <strong>${escapeHtml(name)}</strong>${until ? ` (до ${until})` : ''}</span>
    </div>`;
    bannerEl.style.display = 'block';
  } else {
    bannerEl.innerHTML = '';
    bannerEl.style.display = 'none';
  }
}

// === CONFLICT RESOLUTION ===
const FIELDS_TO_DIFF = {
  title: 'Название', status_id: 'Статус', priority_id: 'Приоритет',
  team_id: 'Команда', project_id: 'Проект', task_type_id: 'Тип',
  channel_id: 'Канал', department_id: 'Подразделение',
  owner_id: 'Исполнитель',
  deadline_id: 'Дедлайн',
  effort_days: 'Трудозатраты (дни)', effort_rub: 'Трудозатраты (руб)',
  financial_effect: 'Фин. эффект',
  progress: 'Прогресс', description: 'Описание',
  comment: 'Комментарий',
  rejection_reason: 'Причина отклонения', link_mockups: 'Макеты', link_jira: 'Jira',
  tags: 'Теги', date_received: 'Дата получения',
};

function showConflictModal(errorData, app) {
  _conflictApp = app;
  const detail = errorData?.detail || errorData;
  _conflictData = detail;

  const serverTask = detail.task || {};
  const currentVer = detail.current_version ?? '?';
  const submittedVer = detail.submitted_version ?? '?';

  let overlay = document.getElementById('conflict-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'conflict-overlay';
  overlay.className = 'conflict-overlay';

  const diffRows = buildDiffRows(serverTask);
  const hasChanges = diffRows.length > 0;

  overlay.innerHTML = `
    <div class="conflict-modal conflict-modal--wide">
      <div class="conflict-modal-header">
        <div class="conflict-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div>
          <h3 class="conflict-title">Конфликт версий</h3>
          <p class="conflict-subtitle">Задача была изменена другим пользователем. Выберите значения для каждого изменённого поля.</p>
        </div>
      </div>
      <div class="conflict-versions">
        <span>Ваша версия: <strong>${submittedVer}</strong></span>
        <span class="conflict-arrow">&rarr;</span>
        <span>Текущая версия: <strong>${currentVer}</strong></span>
      </div>
      ${hasChanges
        ? `<div class="conflict-diff-wrap">
            <table class="diff-table diff-table--selectable">
              <thead>
                <tr>
                  <th style="width:28px;"></th>
                  <th style="width:28px;"></th>
                  <th>Поле</th>
                  <th>На сервере</th>
                  <th>Ваше значение</th>
                </tr>
              </thead>
              <tbody>${diffRows.join('')}</tbody>
            </table>
          </div>`
        : `<div class="diff-empty">Все поля совпадают — различий не обнаружено</div>`
      }
      <div class="conflict-actions conflict-actions--row">
        <button class="conflict-btn conflict-btn-primary" id="conflict-btn-save-selected" ${!hasChanges ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Сохранить выбранные
        </button>
        <button class="conflict-btn conflict-btn-danger" id="conflict-btn-force">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Принудительно сохранить
        </button>
        <button class="conflict-btn conflict-btn-secondary" id="conflict-btn-refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Обновить с сервера
        </button>
        <button class="conflict-btn conflict-btn-ghost" id="conflict-btn-cancel">Отмена</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('conflict-btn-save-selected')?.addEventListener('click', () => conflictSaveSelected(serverTask));
  document.getElementById('conflict-btn-force')?.addEventListener('click', () => conflictForceSave());
  document.getElementById('conflict-btn-refresh')?.addEventListener('click', () => conflictRefresh(serverTask));
  document.getElementById('conflict-btn-cancel')?.addEventListener('click', conflictCancel);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) conflictCancel();
  });
}

function conflictRefresh(serverTask) {
  closeConflictModal();
  if (serverTask && serverTask.id) {
    currentTask = serverTask;
    modalMode = 'view';
    const overlay = document.getElementById('task-detail-overlay');
    if (overlay) {
      overlay.remove();
    }
    openTaskModal(serverTask);
    window.toast?.('Данные обновлены с сервера', 'info');
  }
}

function buildDiffRows(serverTask) {
  const rows = [];
  for (const [field, label] of Object.entries(FIELDS_TO_DIFF)) {
    const serverVal = serverTask[field];
    const formEl = document.getElementById('edit-' + field.replace(/_/g, '-'));
    let localVal;
    if (formEl) {
      localVal = formEl.type === 'checkbox' ? formEl.checked : formEl.value;
    } else {
      localVal = currentTask?.[field];
    }

    const sv = String(serverVal ?? '');
    const lv = String(localVal ?? '');
    if (sv === lv) continue;

    const safeField = escapeHtml(field);
    const safeLabel = escapeHtml(label);
    const safeServer = escapeHtml(sv || '—');
    const safeLocal = escapeHtml(lv || '—');
    const rName = 'cr-' + field;

    rows.push(`<tr class="diff-row" data-field="${safeField}">
      <td class="diff-radio-cell"><input type="radio" name="${rName}" value="server" class="diff-radio" data-field="${safeField}" checked></td>
      <td class="diff-radio-cell"><input type="radio" name="${rName}" value="local" class="diff-radio" data-field="${safeField}"></td>
      <td class="diff-field">${safeLabel}</td>
      <td class="diff-server">${safeServer}</td>
      <td class="diff-local">${safeLocal}</td>
    </tr>`);
  }
  return rows;
}

async function conflictSaveSelected(serverTask) {
  if (!_conflictData) return;
  const api = _conflictApp?.api || window.app?.api;
  if (!api) return;

  const serverVersion = _conflictData.current_version;

  const data = {
    title: document.getElementById('edit-title')?.value?.trim() || currentTask?.title || 'Новая задача',
    status_id: getInt('edit-status'), priority_id: getInt('edit-priority'),
    team_id: getInt('edit-team'), project_id: getInt('edit-project'),
    task_type_id: getInt('edit-task-type'), channel_id: getInt('edit-channel'),
    department_id: getInt('edit-department'), owner_id: getInt('edit-owner'),
    business_customer_id: getInt('edit-business-customer'),
    deadline_id: getInt('edit-deadline'),
    effort_days: getInt('edit-effort-days'), effort_rub: getFloat('edit-effort-rub'),
    financial_effect: getFloat('edit-financial-effect'),
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    comment: document.getElementById('edit-comment')?.value || null,
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: document.getElementById('edit-tags')?.value || '',
    date_received: document.getElementById('edit-date-received')?.value || null,
    key_project_status: document.getElementById('edit-key-project-status')?.value || null,
    directorate_status: document.getElementById('edit-directorate-status')?.value || null,
    did_status: document.getElementById('edit-did-status')?.value || null,
    version: serverVersion,
  };

  const radios = document.querySelectorAll('.diff-radio:checked');
  radios.forEach(r => {
    const field = r.dataset.field;
    if (r.value === 'server' && serverTask[field] !== undefined) {
      const formEl = document.getElementById('edit-' + field.replace(/_/g, '-'));
      if (formEl) {
        if (formEl.type === 'checkbox') {
          formEl.checked = !!serverTask[field];
        } else {
          formEl.value = serverTask[field] ?? '';
        }
      }
      data[field] = serverTask[field];
    }
  });

  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) delete data[key];
  });

  try {
    await api.put(`/tasks/${currentTask.id}`, data);
    closeConflictModal();
    closeTaskDetailModal();
    if (onSaveCallback) onSaveCallback();
    window.toast?.('Задача сохранена с выбранными значениями', 'success');
  } catch (e) {
    if (e.status === 409) {
      showConflictModal(e.data || e, _conflictApp);
      window.toast?.('Конфликт не разрешён — задача по-прежнему изменена', 'error');
    } else {
      window.toast?.('Ошибка: ' + (e.message || 'не удалось сохранить'), 'error');
    }
  }
}

function getVal(id) { const el = document.getElementById(id); return el ? (el.value || null) : null; }
function getInt(id) { const v = getVal(id); return v ? parseInt(v) : null; }
function getFloat(id) { const v = getVal(id); return v ? parseFloat(v) : null; }

async function conflictForceSave() {
  if (!_conflictData) return;
  const api = _conflictApp?.api || window.app?.api;
  if (!api) return;

  const serverVersion = _conflictData.current_version;

  const data = {
    title: document.getElementById('edit-title')?.value?.trim() || currentTask?.title || 'Новая задача',
    status_id: getInt('edit-status'), priority_id: getInt('edit-priority'),
    team_id: getInt('edit-team'), project_id: getInt('edit-project'),
    task_type_id: getInt('edit-task-type'), channel_id: getInt('edit-channel'),
    department_id: getInt('edit-department'), owner_id: getInt('edit-owner'),
    business_customer_id: getInt('edit-business-customer'),
    deadline_id: getInt('edit-deadline'),
    effort_days: getInt('edit-effort-days'), effort_rub: getFloat('edit-effort-rub'),
    financial_effect: getFloat('edit-financial-effect'),
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    comment: document.getElementById('edit-comment')?.value || null,
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: document.getElementById('edit-tags')?.value || '',
    date_received: document.getElementById('edit-date-received')?.value || null,
    key_project_status: document.getElementById('edit-key-project-status')?.value || null,
    directorate_status: document.getElementById('edit-directorate-status')?.value || null,
    did_status: document.getElementById('edit-did-status')?.value || null,
    version: serverVersion,
  };
  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) delete data[key];
  });

  try {
    await api.put(`/tasks/${currentTask.id}`, data);
    closeConflictModal();
    closeTaskDetailModal();
    if (onSaveCallback) onSaveCallback();
    window.toast?.('Задача сохранена (принудительно, версия перезаписана)', 'success');
  } catch (e) {
    if (e.status === 409) {
      window.toast?.('Конфликт не разрешён — задача по-прежнему изменена', 'error');
    } else {
      window.toast?.('Ошибка: ' + (e.message || 'не удалось сохранить'), 'error');
    }
  }
}

function conflictCancel() {
  closeConflictModal();
}

function closeConflictModal() {
  const overlay = document.getElementById('conflict-overlay');
  if (overlay) overlay.remove();
  _conflictData = null;
  _conflictApp = null;
}

// === STATUS / PRIORITY BADGES ===
function renderStatusBadge(status) {
  if (!status) return '<span class="badge badge-low">—</span>';
  const color = statusColor(status);
  const bg = statusBg(status);
  const dotColor = status === 'ПРИНЯТА В РАБОТУ' ? '#3b82f6' : color;
  return `<span class="task-detail-badge" style="background:${bg};color:${color};border-color:${color}33">
    <span class="status-dot" style="background:${dotColor};${status === 'ПРИНЯТА В РАБОТУ' ? 'animation:pulse 2s infinite;' : ''}"></span>
    ${escapeHtml(status)}
  </span>`;
}

function renderPriorityBadge(priority) {
  if (!priority) return '<span class="badge badge-low">—</span>';
  const color = priorityColor(priority);
  const bg = priorityBg(priority);
  return `<span class="task-detail-badge" style="background:${bg};color:${color};border-color:${color}33">
    ${priority === 'ВЫСОКИЙ' ? '🚩 ' : ''}${escapeHtml(priority)}
  </span>`;
}

function renderTagBadge(tag) {
  return `<span class="task-detail-tag">${escapeHtml(tag)}</span>`;
}

// === SECTION TITLE ===
function sectionTitle(title) {
  return `<div class="task-detail-section-title">${escapeHtml(title)}</div>`;
}

// === INFO ROW (ключ-значение) ===
function infoRow(label, valueHtml, opts = {}) {
  const cls = opts.fullWidth ? ' task-detail-info-row-full' : '';
  const labelCls = opts.danger ? ' task-detail-label-danger' : '';
  return `<div class="task-detail-info-row${cls}">
    <div class="task-detail-label${labelCls}">${escapeHtml(label)}</div>
    <div class="task-detail-value">${valueHtml}</div>
  </div>`;
}

// === AVATAR ===
function avatarEl(name, size = 24) {
  if (!name) return '';
  const initials = getInitials(name);
  const color = avatarColor(name);
  return `<div class="task-detail-avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${size*0.4}px">${initials}</div>`;
}

// ============================================================
//  B-VARIANT KPI ROW (4 tiles)
// ============================================================
function renderBKpiRow(task) {
  const statusName = task.status_name || task.status || '—';
  const deadlineName = task.deadline_name || task.deadline || '—';
  const progress = task.progress || 0;
  const cv = task.financial_effect && task.effort_rub && task.effort_rub > 0
    ? (task.financial_effect / task.effort_rub).toFixed(2) : '—';
  const cvNum = parseFloat(cv);
  const cvCls = cvNum >= 1.5 ? 'b-cv-good' : cvNum < 1 ? 'b-cv-bad' : cvNum ? 'b-cv-mid' : 'b-cv-na';

  return `<div class="b-kpi-row">
    <div class="b-kpi-tile">
      <div class="b-kpi-top">
        <div class="b-kpi-icon amber">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div>
          <span class="b-kpi-label">Статус</span>
          <div class="b-kpi-value sm">${escapeHtml(statusName)}</div>
        </div>
      </div>
      <div class="b-kpi-sub">
        ${task.priority_name || task.priority ? `<span style="color:${priorityColor(task.priority_name || task.priority)}">${escapeHtml(task.priority_name || task.priority)}</span>` : ''}
      </div>
    </div>
    <div class="b-kpi-tile">
      <div class="b-kpi-top">
        <div class="b-kpi-icon blue">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div>
          <span class="b-kpi-label">Срок</span>
          <div class="b-kpi-value sm">${escapeHtml(deadlineName)}</div>
        </div>
      </div>
    </div>
    <div class="b-kpi-tile">
      <div class="b-kpi-top">
        <div class="b-kpi-icon green">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
        </div>
        <div>
          <span class="b-kpi-label">Прогресс</span>
          <div class="b-kpi-value">${progress}%</div>
        </div>
      </div>
      <div class="b-kpi-progress">
        <div class="b-kpi-progress-fill" style="width:${progress}%"></div>
      </div>
    </div>
    <div class="b-kpi-tile">
      <div class="b-kpi-top">
        <div class="b-kpi-icon purple">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div>
          <span class="b-kpi-label">C / V</span>
          <span class="b-cv ${cvCls}">${cv}</span>
        </div>
      </div>
      <div class="b-kpi-sub">
        ${task.financial_effect != null ? `<span>Эффект: ${metricFormat(task.financial_effect)} ₽</span>` : ''}
        ${task.effort_rub != null ? `<span>Затраты: ${metricFormat(task.effort_rub)} ₽</span>` : ''}
      </div>
    </div>
  </div>`;
}

// ============================================================
//  B-VARIANT: DASHBOARD OVERVIEW (all tiles)
// ============================================================
function renderOverviewDashboard(task) {
  const t = task || {};
  const statusName = t.status_name || t.status;
  const priorityName = t.priority_name || t.priority;
  const progress = t.progress || 0;
  const cv = t.financial_effect && t.effort_rub && t.effort_rub > 0
    ? (t.financial_effect / t.effort_rub).toFixed(2) : '—';
  const cvNum = parseFloat(cv);
  const tags = t.tags ? (Array.isArray(t.tags) ? t.tags : String(t.tags).split(',').map(x => x.trim()).filter(Boolean)) : [];
  const ownerName = t.owner_name || t.owner || '—';
  const teamName = t.team_name || t.team || '—';
  const dirDate = t.directorate_status_updated_at ? new Date(t.directorate_status_updated_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const didDate = t.did_status_updated_at ? new Date(t.did_status_updated_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

  let html = `<div class="b-tiles">`;

  // --- Tile: Properties (span 7) ---
  html += `<div class="b-tile b-t7">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      <h3>Свойства</h3>
    </div>
    <div class="b-props">
      <div class="b-prop-row">
        <div class="b-prop-label">Команда</div>
        <div class="b-prop-value">${escapeHtml(teamName)}</div>
      </div>
      <div class="b-prop-row">
        <div class="b-prop-label">Тип задачи</div>
        <div class="b-prop-value">${escapeHtml(t.task_type_name || t.task_type || '—')}</div>
      </div>
      <div class="b-prop-row">
        <div class="b-prop-label">Приоритет</div>
        <div class="b-prop-value">${priorityName ? renderPriorityBadge(priorityName) : '—'}</div>
      </div>
      <div class="b-prop-row">
        <div class="b-prop-label">Канал</div>
        <div class="b-prop-value">${escapeHtml(t.channel_name || t.source_channel || '—')}</div>
      </div>
      <div class="b-prop-row">
        <div class="b-prop-label">Подразделение</div>
        <div class="b-prop-value">${escapeHtml(t.department_name || t.customer_department || '—')}</div>
      </div>
      <div class="b-prop-row">
        <div class="b-prop-label">Проект</div>
        <div class="b-prop-value">${escapeHtml(t.project_name || t.project || '—')}</div>
      </div>
      <div class="b-prop-row">
        <div class="b-prop-label">Дата поступления</div>
        <div class="b-prop-value">${t.date_received || '—'}</div>
      </div>
    </div>
  </div>`;

  // --- Tile: Team / Labor (span 5) ---
  html += `<div class="b-tile b-t5">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <h3>Команда</h3>
    </div>
    <div class="b-props">
      <div class="b-prop-row">
        <div class="b-prop-label">Владелец / PL</div>
        <div class="b-prop-value" style="display:flex;align-items:center;gap:6px">
          ${avatarEl(ownerName, 20)}
          ${escapeHtml(ownerName)}
        </div>
      </div>
      ${t.business_customer_name ? `<div class="b-prop-row">
        <div class="b-prop-label">Бизнес-заказчик</div>
        <div class="b-prop-value" style="display:flex;align-items:center;gap:6px">
          ${avatarEl(t.business_customer_name, 20)}
          ${escapeHtml(t.business_customer_name)}
        </div>
      </div>` : ''}
      ${t.involved_teams && t.involved_teams.length ? `<div class="b-prop-row">
        <div class="b-prop-label">Вовлечённые команды</div>
        <div class="b-prop-value">${escapeHtml(renderInvolvedTeams(t.involved_teams))}</div>
      </div>` : ''}
    </div>
    ${t.effort_days != null ? `
    <div style="margin-top:12px;border-top:1px solid var(--border-color);padding-top:12px;">
      <div class="b-prop-label" style="margin-bottom:6px">Трудозатраты</div>
      <div class="b-kpi-value sm" style="margin-bottom:4px">${t.effort_days} ч/д</div>
      <div style="font-size:12px;color:var(--text-muted)">${t.effort_rub != null ? metricFormat(t.effort_rub) + ' ₽' : '—'}</div>
    </div>` : ''}
  </div>`;

  // --- Tile: Description (span 12) ---
  if (t.description) {
    html += `<div class="b-tile b-t12">
      <div class="b-tile-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <h3>Описание</h3>
      </div>
      <div style="font-size:13px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap">${escapeHtml(t.description)}</div>
    </div>`;
  }

  // --- Tile: Notes / Comments (span 12) ---
  const hasNotes = t.comment || (t.status_name === 'ОТКЛОНЕНА' && t.rejection_reason);
  if (hasNotes) {
    html += `<div class="b-tile b-t12">
      <div class="b-tile-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <h3>Комментарии</h3>
      </div>
      ${t.comment ? `<div style="margin-bottom:10px"><div class="b-prop-label" style="margin-bottom:4px">Общий комментарий</div><div style="font-size:13px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap">${escapeHtml(t.comment)}</div></div>` : ''}
      ${(t.status_name === 'ОТКЛОНЕНА' && t.rejection_reason) ? `<div><div class="b-prop-label" style="margin-bottom:4px;color:#ef4444">Причина отклонения</div><div style="font-size:13px;line-height:1.6;color:#ef4444;white-space:pre-wrap">${escapeHtml(t.rejection_reason)}</div></div>` : ''}
    </div>`;
  }

  // --- Tile: Finance (span 12) ---
  html += `<div class="b-tile b-t12">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <h3>Финансы</h3>
    </div>
    <div class="b-fin-grid">
      <div class="b-fin-cell">
        <div class="b-fin-value">${t.financial_effect != null ? metricFormat(t.financial_effect) + ' <span class="vs">₽</span>' : '—'}</div>
        <span class="b-fin-sub">Финансовый эффект</span>
      </div>
      <div class="b-fin-cell">
        <div class="b-fin-value">${t.effort_rub != null ? metricFormat(t.effort_rub) + ' <span class="vs">₽</span>' : '—'}</div>
        <span class="b-fin-sub">Трудозатраты</span>
      </div>
      <div class="b-fin-cell">
        <span class="b-cv lg ${cvNum >= 1.5 ? 'b-cv-good' : cvNum < 1 ? 'b-cv-bad' : cvNum ? 'b-cv-mid' : 'b-cv-na'}">
          <b>C / V</b> ${cv}
        </span>
        <span class="b-fin-sub">Соотношение</span>
      </div>
    </div>
  </div>`;

  // --- Tile: Meeting statuses (span 12) ---
  const hasDir = t.directorate_status;
  const hasDid = t.did_status;
  const hasKey = t.key_project_status;
  if (hasDir || hasDid || hasKey) {
    html += `<div class="b-tile b-t12">
      <div class="b-tile-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <h3>Статусы для встреч</h3>
      </div>
      <div class="b-ms-grid">
        ${hasDir ? `<div class="b-ms b-ms--dir">
          <div class="b-ms-header"><b>Директорская</b></div>
          <div class="b-ms-text">${escapeHtml(t.directorate_status)}</div>
          ${dirDate ? `<div class="b-ms-time"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${dirDate}</div>` : ''}
        </div>` : ''}
        ${hasDid ? `<div class="b-ms b-ms--did">
          <div class="b-ms-header"><b>ДИД</b></div>
          <div class="b-ms-text">${escapeHtml(t.did_status)}</div>
          ${didDate ? `<div class="b-ms-time"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${didDate}</div>` : ''}
        </div>` : ''}
        ${hasKey ? `<div class="b-ms b-ms--key">
          <div class="b-ms-header"><b>Ключевой проект</b></div>
          <div class="b-ms-text">${escapeHtml(t.key_project_status)}</div>
        </div>` : ''}
      </div>
    </div>`;
  }

  // --- Tile: Tags & Epics (span 12) ---
  if (tags.length || t.link_mockups || (t.link_jira && t.link_jira.length)) {
    html += `<div class="b-tile b-t12">
      <div class="b-tile-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        <h3>Теги и ссылки</h3>
      </div>
      <div class="b-tags">
        ${tags.map(tag => `<span class="b-tag">${escapeHtml(tag)}</span>`).join('')}
        ${t.link_mockups ? `<a class="b-tag" href="${escapeHtml(t.link_mockups)}" target="_blank" style="text-decoration:none;color:#1e40af;background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.2)">📎 Макеты</a>` : ''}
        ${renderLinkJiraTags(t.link_jira)}
      </div>
    </div>`;
  }

  // --- Tile: What-If (span 12) ---
  html += `</div>`;
  return html;
}

// ============================================================
//  TAB: ДОКУМЕНТЫ (replaced by Activity Block Files panel)
// ============================================================
function renderDocsTab(task) { return ''; }

// ============================================================
//  TAB: ОТЧЁТНОСТЬ (replaced by B-variant tiles)
// ============================================================
function renderReportsTab(task) { return ''; }

// ============================================================
//  TAB: ИСТОРИЯ
// ============================================================
async function renderHistoryTab(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api) return '<div class="text-muted" style="padding:20px">API недоступен</div>';

  try {
    const data = await api.get(`/tasks/${taskId}/history`);
    const items = Array.isArray(data) ? data : [];

    let html = `<div class="task-detail-section-card">`;
    html += sectionTitle('Audit Log · История изменений');

    if (items.length === 0) {
      html += `<div class="text-muted" style="text-align:center;padding:40px">История изменений пуста</div>`;
    } else {
      html += `<div class="task-detail-history-list">`;
      items.forEach(item => {
        const time = item.changed_at ? new Date(item.changed_at).toLocaleString('ru-RU') : '';
        const oldVal = item.old_value ? escapeHtml(item.old_value) : null;
        const newVal = item.new_value ? escapeHtml(item.new_value) : null;

        html += `<div class="history-item">
          <div class="history-item-header">
            ${item.changed_by_name ? avatarEl(item.changed_by_name, 20) : '<div class="task-detail-avatar" style="width:20px;height:20px;background:#94a3b8;font-size:8px">?</div>'}
            <span class="history-user">${escapeHtml(item.changed_by_name || 'Система')}</span>
            <span class="history-time">${time}</span>
          </div>
          <div class="history-item-body">
            <span class="history-field">${escapeHtml(item.field_label || item.field_name)}</span>:
            ${oldVal !== null ? `<span class="history-old">${oldVal}</span>` : ''}
            ${oldVal !== null && newVal !== null ? '<span class="history-arrow">→</span>' : ''}
            ${newVal !== null ? `<span class="history-new">${newVal}</span>` : ''}
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  } catch (e) {
    return `<div class="text-danger" style="padding:20px">Ошибка загрузки истории: ${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================
//  RENDER FULL MODAL (B-VARIANT DASHBOARD)
// ============================================================
export function renderTaskDetailModal(task, app) {
  currentTask = task;
  modalMode = task ? 'view' : 'edit';

  const t = task || {};
  const statusName = t.status_name || t.status;
  const priorityName = t.priority_name || t.priority;
  const taskTypeName = t.task_type_name || t.task_type;
  const hasTaskId = !!t.id;

  return `
    <div class="modal-overlay" id="task-detail-overlay">
      <div class="task-detail-modal" id="task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">

        <!-- B-Header -->
        <div class="b-head">
          <div class="b-head-left">
            <div class="b-head-top">
              <span class="b-head-id">${hasTaskId ? '#' + t.id : 'Новая задача'}</span>
              ${t.channel_name || t.source_channel ? `<span class="b-head-channel">${escapeHtml(t.channel_name || t.source_channel)}</span>` : ''}
              ${t.date_received ? `<span class="b-head-created">${escapeHtml(t.date_received)}</span>` : ''}
            </div>
            <h2 class="b-head-title" id="task-detail-title">${escapeHtml(t.title || 'Новая задача')}</h2>
          </div>
          <div class="b-head-right">
            <div class="b-head-updated">
              Updated <b>${t.updated_at ? new Date(t.updated_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</b>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="task-detail-btn-icon" id="td-share-btn" title="Поделиться">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              </button>
              <button class="task-detail-btn-icon" id="td-edit-btn" title="Редактировать">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="task-detail-btn-icon task-detail-btn-close" id="td-close-btn" title="Закрыть">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Activity Tabs Bar (fixed below header) -->
        <div class="b-act-tabs-bar" id="td-act-tabs-bar">
          <div class="b-act-tabs">
            <button class="b-act-tab active" data-act="overview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Обзор
            </button>
            <button class="b-act-tab" data-act="history">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              История <b id="act-history-count">—</b>
            </button>
            <button class="b-act-tab" data-act="comments">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Комментарии <b id="act-comments-count">—</b>
            </button>
            <button class="b-act-tab" data-act="files">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              Файлы <b id="act-files-count">—</b>
            </button>
          </div>
        </div>

        <!-- Scrollable Body: banners + KPI + tiles + activity panels -->
        <div id="td-tiles-container" class="task-detail-modal-body">

          <!-- Lock Banner -->
          <div id="td-lock-banner" style="display:none;"></div>

          <!-- Viewer Banner -->
          <div id="td-viewer-banner" style="display:none;"></div>

          <!-- B-KPI Row -->
          ${renderBKpiRow(t)}

          <!-- Tiles Grid (replaced in edit mode) -->
          <div id="td-tiles-grid">
            ${renderOverviewDashboard(t)}
          </div>

          <!-- Activity Panels (content only — tabs are above scroll) -->
          <div class="b-activity" id="td-activity">
            <div class="b-act-panel" id="act-panel-history">
              <div class="text-muted" style="text-align:center;padding:20px">Загрузка истории...</div>
            </div>
            <div class="b-act-panel" id="act-panel-comments">
              <div id="comments-list-container">
                <div class="text-muted" style="text-align:center;padding:20px">Загрузка комментариев...</div>
              </div>
              <div id="comment-form-container" style="margin-top:16px;border-top:1px solid var(--border-color);padding-top:16px;">
                <div id="reply-indicator" class="reply-indicator" style="display:none;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                  <span class="reply-indicator-text"></span>
                  <button class="reply-indicator-cancel" onclick="window.__cancelReply()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div style="position:relative;">
                  <textarea class="task-detail-input" id="comment-textarea" rows="3" placeholder="Напишите комментарий... Используйте @ для упоминания пользователей"></textarea>
                  <div id="mention-dropdown" class="mention-dropdown" style="display:none;"></div>
                </div>
                <div style="display:flex;justify-content:flex-end;margin-top:8px;">
                  <button class="task-detail-btn task-detail-btn-primary" id="comment-submit-btn" disabled>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Отправить
                  </button>
                </div>
              </div>
            </div>
            <div class="b-act-panel" id="act-panel-files">
              <div id="attachment-drop-zone" class="attachment-drop-zone">
                <input type="file" id="attachment-file-input" multiple style="display:none;" />
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div class="attachment-drop-text">Перетащите файлы сюда или <span class="attachment-drop-browse">выберите</span></div>
                <div class="attachment-drop-hint">Макс. размер: 50 МБ</div>
              </div>
              <div id="attachments-list-container" class="attachments-list-container"></div>
            </div>
          </div>

        </div>

        <!-- Sticky Edit Footer -->
        <div class="td-edit-bar" id="td-edit-bar">
          <div class="td-edit-bar-hint">
            <span style="font-size:12px;color:var(--text-muted);">Режим редактирования</span>
          </div>
          <div class="td-edit-bar-actions">
            <button class="task-detail-btn task-detail-btn-ghost" onclick="window.__cancelEdit()">Отмена</button>
            <button class="task-detail-btn task-detail-btn-primary" id="td-save-btn" onclick="window.__saveFromEdit()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Сохранить
            </button>
          </div>
        </div>

      </div>
    </div>`;
}

// ============================================================
//  ACTIVITY TAB SWITCHING (B-variant)
// ============================================================
function initActivityTabs() {
  document.querySelectorAll('.b-act-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.b-act-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.b-act-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const act = btn.dataset.act;
      const overviewEl = document.getElementById('td-tiles-grid');
      const kpiRow = overviewEl?.previousElementSibling;
      const lockBanner = document.getElementById('td-lock-banner');
      const viewerBanner = document.getElementById('td-viewer-banner');
      if (act === 'overview') {
        if (overviewEl) overviewEl.style.display = '';
        if (kpiRow && kpiRow.classList.contains('b-kpi-row')) kpiRow.style.display = '';
        if (lockBanner && _lockInfo && _lockInfo.locked) lockBanner.style.display = '';
        if (viewerBanner && _currentViewers.length > 0) viewerBanner.style.display = '';
      } else {
        if (overviewEl) overviewEl.style.display = 'none';
        if (kpiRow && kpiRow.classList.contains('b-kpi-row')) kpiRow.style.display = 'none';
        if (lockBanner) lockBanner.style.display = 'none';
        if (viewerBanner) viewerBanner.style.display = 'none';
        const panelId = 'act-panel-' + act;
        document.getElementById(panelId)?.classList.add('active');
        if (act === 'comments' && currentTask?.id) {
          loadComments(currentTask.id, window.app);
          initCommentForm(currentTask.id, window.app);
        }
        if (act === 'files' && currentTask?.id) {
          loadAttachments(currentTask.id, window.app);
          initAttachmentForm(currentTask.id, window.app);
        }
      }
    });
  });
}

// ============================================================
//  ATTACHMENTS
// ============================================================

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

function getFileIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📘';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📗';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📙';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z') || mimeType.includes('tar')) return '🗜️';
  if (mimeType.startsWith('text/')) return '📝';
  return '📄';
}

async function loadAttachments(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api || !taskId) return;
  try {
    const data = await api.get(`/tasks/${taskId}/attachments`);
    _attachmentsCache = data.items || [];
  } catch (e) {
    console.error('Failed to load attachments:', e);
    _attachmentsCache = [];
  }
  renderAttachmentsList();
}

function renderAttachmentsList() {
  const container = document.getElementById('attachments-list-container');
  if (!container) return;
  if (_attachmentsCache.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `<div class="attachments-list">${_attachmentsCache.map(renderAttachmentItem).join('')}</div>`;
}

function renderAttachmentItem(att) {
  const icon = getFileIcon(att.mime_type);
  const size = formatFileSize(att.file_size);
  const date = att.created_at ? new Date(att.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="attachment-item" data-id="${att.id}">
    <div class="attachment-item-icon">${icon}</div>
    <div class="attachment-item-info">
      <div class="attachment-item-name">
        <a href="${escapeHtml(att.download_url || '')}" target="_blank" download>${escapeHtml(att.original_name)}</a>
      </div>
      <div class="attachment-item-meta">
        ${size ? `<span>${size}</span>` : ''}
        ${att.user_name ? `<span>${escapeHtml(att.user_name)}</span>` : ''}
        ${date ? `<span>${date}</span>` : ''}
      </div>
    </div>
    <button class="attachment-item-delete" title="Удалить файл" onclick="window.__deleteAttachment(${att.task_id}, ${att.id})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
  </div>`;
}

window.__deleteAttachment = async function(taskId, attachmentId) {
  if (!confirm('Удалить этот файл?')) return;
  const api = window.app?.api;
  if (!api) return;
  try {
    await api.delete(`/tasks/${taskId}/attachments/${attachmentId}`);
    window.toast?.('Файл удалён', 'success');
    await loadAttachments(taskId, window.app);
  } catch (e) {
    window.toast?.('Ошибка удаления: ' + (e.message || 'неизвестная'), 'error');
  }
};

async function saveTaskLinks(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api) return;
  const mockupsInput = document.getElementById('link-mockups-input');
  const jiraInput = document.getElementById('link-jira-input');
  if (!mockupsInput || !jiraInput) return;

  const payload = {
    link_mockups: mockupsInput.value.trim() || null,
    link_jira: jiraInput.value.trim() || null,
  };

  const btn = document.getElementById('save-links-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохранение...'; }

  try {
    await api.put(`/tasks/${taskId}/links`, payload);
    window.toast?.('Ссылки сохранены', 'success');
    if (currentTask) {
      currentTask.link_mockups = payload.link_mockups;
      currentTask.link_jira = payload.link_jira;
    }
  } catch (e) {
    window.toast?.('Ошибка: ' + (e.message || 'не удалось сохранить'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Сохранить ссылки'; }
  }
}

async function uploadFile(taskId, file, app) {
  const api = app?.api || window.app?.api;
  if (!api) return;
  try {
    await api.upload(`/tasks/${taskId}/attachments`, file);
    window.toast?.(`Файл "${file.name}" загружен`, 'success');
    await loadAttachments(taskId, app);
  } catch (e) {
    window.toast?.(`Ошибка загрузки "${file.name}": ${e.message || 'неизвестная'}`, 'error');
  }
}

function initAttachmentForm(taskId, app) {
  if (_attachmentFormInitialized) return;

  const dropZone = document.getElementById('attachment-drop-zone');
  const fileInput = document.getElementById('attachment-file-input');
  const saveLinksBtn = document.getElementById('save-links-btn');

  if (!dropZone || !fileInput) return;
  _attachmentFormInitialized = true;

  if (saveLinksBtn) {
    saveLinksBtn.addEventListener('click', () => saveTaskLinks(taskId, app));
  }

  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('.attachment-drop-browse') || e.target === dropZone || e.target.closest('.attachment-drop-zone')) {
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    for (const file of files) {
      await uploadFile(taskId, file, app);
    }
    fileInput.value = '';
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('attachment-drop-zone-active');
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('attachment-drop-zone-active');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('attachment-drop-zone-active');
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await uploadFile(taskId, file, app);
    }
  });
}

// ============================================================
//  MODAL INIT (B-VARIANT)
// ============================================================
export function initTaskDetailModal(app) {
  const overlay = document.getElementById('task-detail-overlay');
  if (!overlay) return;

  // Activity tab switching
  initActivityTabs();

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTaskDetailModal();
  });

  // Close button
  document.getElementById('td-close-btn')?.addEventListener('click', closeTaskDetailModal);

  // Edit button → switch to edit mode
  document.getElementById('td-edit-btn')?.addEventListener('click', () => {
    if (modalMode === 'view') toggleToEditMode(app);
  });

  // Share button (copy link)
  document.getElementById('td-share-btn')?.addEventListener('click', () => {
    if (currentTask?.id) {
      navigator.clipboard?.writeText(window.location.origin + '/#/backlog?task=' + currentTask.id)
        .then(() => window.toast?.('Ссылка скопирована', 'info'))
        .catch(() => {});
    }
  });

  // Load history into activity panel
  if (currentTask?.id) {
    loadHistoryTab(currentTask.id, app);
  }

  // Check lock status and start polling
  if (currentTask?.id) {
    checkAndRenderLock(currentTask.id);
  }

  // Register as viewer and start viewer polling
  if (currentTask?.id) {
    registerViewer(currentTask.id).then(() => fetchViewers(currentTask.id).then(v => { _currentViewers = v; renderViewerBanner(); }));
    startViewerPolling(currentTask.id);
  }

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeTaskDetailModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Focus first element
  setTimeout(() => {
    const firstFocusable = document.querySelector('#task-detail-modal button, #task-detail-modal a, #task-detail-modal input');
    firstFocusable?.focus();
  }, 100);
}

async function loadHistoryTab(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api) return;
  try {
    const html = await renderHistoryTab(taskId, app);
    const panel = document.getElementById('act-panel-history');
    if (panel) panel.innerHTML = html;
    const countEl = document.getElementById('act-history-count');
    if (countEl) {
      try {
        const data = await api.get(`/tasks/${taskId}/history`);
        const items = Array.isArray(data) ? data : [];
        countEl.textContent = items.length || '0';
      } catch(_) { countEl.textContent = '—'; }
    }
  } catch (e) {
    const panel = document.getElementById('act-panel-history');
    if (panel) panel.innerHTML = `<div class="text-danger" style="padding:20px">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================
//  LOCK: check status on open
// ============================================================
async function checkAndRenderLock(taskId) {
  _lockInfo = await fetchLockStatus(taskId);
  renderLockBanner();
  if (_lockInfo && _lockInfo.locked && !_lockInfo.is_mine) {
    const editBtn = document.getElementById('td-edit-btn');
    if (editBtn) {
      editBtn.style.opacity = '0.4';
      editBtn.style.pointerEvents = 'none';
      editBtn.title = 'Задача редактируется другим пользователем';
    }
    const saveBtn = document.getElementById('td-save-btn');
    if (saveBtn && !currentTask?.id) {
      saveBtn.style.opacity = '1';
    } else if (saveBtn) {
      saveBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        Только чтение`;
      saveBtn.disabled = true;
    }
  }
  startLockPolling(taskId);
}

// ============================================================
//  EDIT MODE (B-VARIANT)
// ============================================================
function toggleToEditMode(app) {
  if (!currentTask?.id) {
    modalMode = 'edit';
    const container = document.getElementById('td-tiles-grid');
    if (!container) return;
    container.innerHTML = renderEditForm(currentTask || {});
    container.style.display = '';
    const kpiRow = container.previousElementSibling;
    if (kpiRow && kpiRow.classList.contains('b-kpi-row')) kpiRow.style.display = '';
    const editBtn = document.getElementById('td-edit-btn');
    if (editBtn) editBtn.style.display = 'none';
    const editBar = document.getElementById('td-edit-bar');
    if (editBar) editBar.style.display = 'flex';
    document.querySelectorAll('.b-act-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.b-act-tab').forEach(b => b.classList.remove('active'));
    const overviewTab = document.querySelector('.b-act-tab[data-act="overview"]');
    if (overviewTab) overviewTab.classList.add('active');
    container.scrollTop = 0;
    const range = document.getElementById('edit-progress');
    const label = document.getElementById('progress-label');
    if (range && label) range.addEventListener('input', () => { label.textContent = range.value + '%'; });
    const statusSelect = document.getElementById('edit-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        const wrapper = document.getElementById('edit-rejection-wrapper');
        if (wrapper) wrapper.style.display = parseInt(this.value) === 5 ? '' : 'none';
      });
    }
    populateSelects(app);
    return;
  }
  acquireLock(currentTask.id).then(result => {
    if (result && result.error) {
      const detail = result.detail || 'Задача редактируется другим пользователем';
      window.toast?.(detail, 'error');
      return;
    }
    modalMode = 'edit';
    const container = document.getElementById('td-tiles-grid');
    if (!container) return;
    container.innerHTML = renderEditForm(currentTask || {});
    container.style.display = '';
    const kpiRow = container.previousElementSibling;
    if (kpiRow && kpiRow.classList.contains('b-kpi-row')) kpiRow.style.display = '';
    const editBtn = document.getElementById('td-edit-btn');
    if (editBtn) editBtn.style.display = 'none';
    const editBar = document.getElementById('td-edit-bar');
    if (editBar) editBar.style.display = 'flex';
    document.querySelectorAll('.b-act-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.b-act-tab').forEach(b => b.classList.remove('active'));
    const overviewTab = document.querySelector('.b-act-tab[data-act="overview"]');
    if (overviewTab) overviewTab.classList.add('active');
    container.scrollTop = 0;
    const range = document.getElementById('edit-progress');
    const label = document.getElementById('progress-label');
    if (range && label) range.addEventListener('input', () => { label.textContent = range.value + '%'; });
    const statusSelect = document.getElementById('edit-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        const wrapper = document.getElementById('edit-rejection-wrapper');
        if (wrapper) wrapper.style.display = parseInt(this.value) === 5 ? '' : 'none';
      });
    }
    populateSelects(app);
  });
}

// ============================================================
//  EDIT FORM (B-VARIANT)
// ============================================================
function renderEditForm(task) {
  const t = task || {};
  const tags = t.tags ? (Array.isArray(t.tags) ? t.tags.join(', ') : String(t.tags)) : '';
  const statuses = [
    { value: 1, label: 'НОВАЯ ЗАДАЧА' }, { value: 2, label: 'НАЗНАЧЕНА КОМАНДА' },
    { value: 3, label: 'СБОР ТРЕБОВАНИЙ' }, { value: 4, label: 'ПРОВЕРКА ТРЕБОВАНИЙ' },
    { value: 5, label: 'УТОЧНЕНИЕ ТРЕБОВАНИЙ' }, { value: 6, label: 'ЭКСПРЕСС-ОЦЕНКА' },
    { value: 7, label: 'ПРИНЯТИЕ РЕШЕНИЯ' }, { value: 8, label: 'ПРИНЯТА В РАБОТУ' },
    { value: 9, label: 'ЭСКАЛАЦИЯ НА ЛТ' }, { value: 10, label: 'ХОЛД' },
    { value: 11, label: 'ОТКЛОНЕНА' }, { value: 12, label: 'НЕ АКТУАЛЬНА' },
    { value: 13, label: 'ВЫПОЛНЕНА' }
  ];
  const priorities = [
    { value: 1, label: 'ВЫСОКИЙ' }, { value: 2, label: 'СРЕДНИЙ' }, { value: 3, label: 'НИЗКИЙ' }
  ];
  const taskTypes = [
    { value: 1, label: 'Функциональность' }, { value: 2, label: 'Bug' },
    { value: 3, label: 'Техдолг' }, { value: 4, label: 'Исследование' },
    { value: 5, label: 'Интеграция' }, { value: 6, label: 'UI/UX' }, { value: 7, label: 'DevOps' }
  ];
  const channels = [
    { value: 1, label: 'Поручение ДИД' }, { value: 2, label: 'Поручение ДРП' },
    { value: 3, label: 'Заявка на портале' }, { value: 4, label: 'Письмо' },
    { value: 5, label: 'Совещание' }, { value: 6, label: 'Другое' }
  ];
  const deadlines = [
    { value: 1, label: '1Q 2026' }, { value: 2, label: '2Q 2026' },
    { value: 3, label: '3Q 2026' }, { value: 4, label: '4Q 2026' },
    { value: 5, label: 'Y2026' }, { value: 6, label: 'Y2027' },
    { value: 7, label: '1Q 2027' }, { value: 8, label: '2Q 2027' }
  ];
  const dirStatuses = [
    { value: 'В работе', label: 'В работе' }, { value: 'На контроле', label: 'На контроле' },
    { value: 'Риск', label: 'Риск' }, { value: 'Выполнен', label: 'Выполнен' },
    { value: 'Не актуальна', label: 'Не актуальна' }
  ];
  const didStatuses = [
    { value: 'В работе', label: 'В работе' }, { value: 'Требует решения', label: 'Требует решения' },
    { value: 'Закрыта', label: 'Закрыта' }, { value: 'Блокировано', label: 'Блокировано' }
  ];

  function bsel(id, opts, selected) {
    return `<select class="b-edit-select" id="${id}">
      ${opts.map(o => `<option value="${escapeHtml(String(o.value))}" ${(o.value === selected || o.label === selected) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }

  function binput(id, type, val, placeholder) {
    return `<input type="${type}" class="b-edit-input" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function bnum(id, val, placeholder) {
    return `<input type="number" class="b-edit-num" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function btextarea(id, val, placeholder, rows = 3) {
    return `<textarea class="b-edit-textarea" id="${id}" rows="${rows}" placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(val || '')}</textarea>`;
  }

  function apiSelect(id, currentId, currentName) {
    const val = currentId || currentName || '';
    const display = currentName || currentId || '';
    return `<select class="b-edit-select" id="${id}"><option value="${escapeHtml(String(val))}" ${val ? 'selected' : ''}>${escapeHtml(display || 'Загрузка...')}</option></select>`;
  }

  function field(label, inputHtml) {
    return `<div class="b-edit-field">
      <label class="b-edit-label">${escapeHtml(label)}</label>
      ${inputHtml}
    </div>`;
  }

  function FL(key, fallback) {
    return (window.app?.fieldLabels && window.app.fieldLabels[key]) || fallback || key;
  }

  let html = `<div class="b-tiles">`;

  // --- Edit: Properties tile (span 7) ---
  html += `<div class="b-tile b-t7">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <h3>Редактирование</h3>
    </div>
    ${field(FL('title'), binput('edit-title', 'text', t.title, 'Название задачи'))}
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field(FL('status_id'), bsel('edit-status', statuses, t.status_id || t.status_name || t.status))}
      ${field(FL('priority_id'), bsel('edit-priority', priorities, t.priority_id || t.priority_name || t.priority))}
    </div>
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field(FL('task_type_id'), bsel('edit-task-type', taskTypes, t.task_type_id || t.task_type_name || t.task_type))}
      ${field(FL('channel_id'), bsel('edit-channel', channels, t.channel_id || t.channel_name || t.source_channel))}
    </div>
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field(FL('team_id'), apiSelect('edit-team', t.team_id, t.team_name || t.team))}
      ${field(FL('project_id'), apiSelect('edit-project', t.project_id, t.project_name || t.project))}
    </div>
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field(FL('owner_id'), apiSelect('edit-owner', t.owner_id, t.owner_name || t.owner))}
      ${field(FL('business_customer_id'), apiSelect('edit-business-customer', t.business_customer_id, t.business_customer_name || t.business_customer))}
    </div>
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field(FL('department_id'), apiSelect('edit-department', t.department_id, t.department_name || t.customer_department))}
      ${field(FL('deadline_id'), bsel('edit-deadline', deadlines, t.deadline_id || t.deadline_name || t.deadline))}
    </div>
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field('Дата поступления', binput('edit-date-received', 'date', t.date_received || ''))}
      ${field('Прогресс', `
        <input type="range" min="0" max="100" value="${t.progress || 0}" class="b-edit-range" id="edit-progress">
        <div class="b-edit-range-label"><span>0%</span><b id="progress-label">${t.progress || 0}%</b><span>100%</span></div>
      `)}
    </div>
  </div>`;

  // --- Edit: Team tile (span 5) ---
  html += `<div class="b-tile b-t5">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      <h3>Финансы</h3>
    </div>
    <div class="b-edit-row-2">
      ${field(FL('effort_days'), bnum('edit-effort-days', t.effort_days ?? '', 'ч/д'))}
      ${field(FL('effort_rub'), bnum('edit-effort-rub', t.effort_rub ?? '', '₽'))}
    </div>
    <div style="margin-top:10px">
      ${field(FL('financial_effect'), bnum('edit-financial-effect', t.financial_effect ?? '', '₽'))}
    </div>
    <div style="margin-top:16px;border-top:1px solid var(--border-color);padding-top:12px;">
      <div class="b-tile-title" style="margin-bottom:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <h3>Статусы для встреч</h3>
      </div>
      <div style="margin-bottom:8px">
        <label class="b-edit-label">Директорская</label>
        <textarea class="b-edit-textarea" id="edit-directorate-status" rows="2" placeholder="Опишите статус...">${escapeHtml(t.directorate_status || '')}</textarea>
      </div>
      <div style="margin-bottom:8px">
        <label class="b-edit-label">ДИД</label>
        <textarea class="b-edit-textarea" id="edit-did-status" rows="2" placeholder="Опишите статус...">${escapeHtml(t.did_status || '')}</textarea>
      </div>
      <div>
        <label class="b-edit-label">Ключ. проект</label>
        ${bsel('edit-key-project-status', dirStatuses, t.key_project_status)}
      </div>
    </div>
  </div>`;

  // --- Edit: Description tile (span 12) ---
  html += `<div class="b-tile b-t12">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <h3>Описание</h3>
    </div>
    ${field(FL('description'), btextarea('edit-description', t.description, 'Описание задачи', 4))}
    <div style="margin-top:10px">
      ${field(FL('comment'), btextarea('edit-comment', t.comment, 'Общий комментарий', 2))}
    </div>
    <div id="edit-rejection-wrapper" style="margin-top:10px;display:${(t.status_name || t.status) === 'ОТКЛОНЕНА' ? '' : 'none'}">
      ${field(FL('rejection_reason'), btextarea('edit-rejection-reason', t.rejection_reason, 'Причина', 2))}
    </div>
  </div>`;

  // --- Edit: Links & Tags tile (span 12) ---
  html += `<div class="b-tile b-t12">
    <div class="b-tile-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <h3>Ссылки и теги</h3>
    </div>
    <div class="b-edit-row-2">
      ${field(FL('link_mockups'), binput('edit-link-mockups', 'text', t.link_mockups, 'https://...'))}
      ${field(FL('link_jira'), binput('edit-link-jira', 'text', Array.isArray(t.link_jira) ? t.link_jira.join(', ') : t.link_jira, 'https://...'))}
    </div>
    <div style="margin-top:10px">
      ${field(FL('tags'), binput('edit-tags', 'text', tags, 'regulatory, backend, security'))}
    </div>
  </div>`;

  html += `</div>`;
  return html;
}

// Global handlers for edit mode buttons
window.__cancelEdit = function() {
  modalMode = 'view';
  if (currentTask?.id) {
    releaseLock(currentTask.id);
    _lockInfo = null;
  }
  const container = document.getElementById('td-tiles-grid');
  if (container && currentTask) {
    container.innerHTML = renderOverviewDashboard(currentTask);
    container.style.display = '';
  }
  const kpiRow = container?.previousElementSibling;
  if (kpiRow && kpiRow.classList.contains('b-kpi-row')) kpiRow.style.display = '';
  const editBtn = document.getElementById('td-edit-btn');
  if (editBtn) editBtn.style.display = '';
  const editBar = document.getElementById('td-edit-bar');
  if (editBar) editBar.style.display = 'none';
};

window.__saveFromEdit = function() {
  saveTaskDetail(window.app);
};

// ============================================================
//  POPULATE API SELECTS
// ============================================================
async function populateSelects(app) {
  const api = app?.api || window.app?.api;
  if (!api) return;
  const t = currentTask || {};

  async function populateSelect(endpoint, selectId, currentId, currentName) {
    const select = document.getElementById(selectId);
    if (!select) return;
    try {
      const data = await api.get(endpoint);
      const items = Array.isArray(data) ? data : (data.items || data.data || []);
      select.innerHTML = '<option value="">Выберите</option>' +
        items.map(item => {
          const id = item.id;
          const name = item.name || item.title || item.label || '';
          const selected = (id != null && id === currentId) || (name && name === currentName) ? 'selected' : '';
          return `<option value="${escapeHtml(String(id != null ? id : name))}" ${selected}>${escapeHtml(name)}</option>`;
        }).join('');
    } catch (e) {
      console.error(`Failed to load ${endpoint}:`, e);
      if (currentId || currentName) {
        select.innerHTML = `<option value="${escapeHtml(String(currentId || currentName))}" selected>${escapeHtml(currentName || String(currentId || ''))}</option>`;
      }
    }
  }

  populateSelect('/teams', 'edit-team', t.team_id, t.team_name || t.team);
  populateSelect('/projects', 'edit-project', t.project_id, t.project_name || t.project);
  populateSelect('/departments', 'edit-department', t.department_id, t.department_name || t.customer_department);
  populateSelect('/admin/business-customers', 'edit-business-customer', t.business_customer_id, t.business_customer_name || t.business_customer);
  populateSelect('/users', 'edit-owner', t.owner_id, t.owner_name || t.owner);
}

// ============================================================
//  SAVE TASK
// ============================================================
async function saveTaskDetail(app) {
  const api = app?.api || window.app?.api;
  if (!api) return;

  const saveBtn = document.getElementById('td-save-btn');
  const originalHtml = saveBtn?.innerHTML || 'Сохранить';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>Сохранение...';
  }

  function getVal(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = el.value;
    if (v === '' || v === null || v === undefined) return null;
    return v;
  }

  function getInt(id) {
    const v = getVal(id);
    if (v === null) return null;
    const n = parseInt(v);
    return isNaN(n) ? null : n;
  }

  function getFloat(id) {
    const v = getVal(id);
    if (v === null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  const data = {
    title: document.getElementById('edit-title')?.value?.trim() || currentTask?.title || 'Новая задача',
    status_id: getInt('edit-status'),
    priority_id: getInt('edit-priority'),
    team_id: getInt('edit-team'),
    project_id: getInt('edit-project'),
    task_type_id: getInt('edit-task-type'),
    channel_id: getInt('edit-channel'),
    department_id: getInt('edit-department'),
    owner_id: getInt('edit-owner'),
    business_customer_id: getInt('edit-business-customer'),
    deadline_id: getInt('edit-deadline'),
    effort_days: getInt('edit-effort-days'),
    effort_rub: getFloat('edit-effort-rub'),
    financial_effect: getFloat('edit-financial-effect'),
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    comment: document.getElementById('edit-comment')?.value || null,
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: document.getElementById('edit-tags')?.value || '',
    date_received: document.getElementById('edit-date-received')?.value || null,
    key_project_status: document.getElementById('edit-key-project-status')?.value || null,
    directorate_status: document.getElementById('edit-directorate-status')?.value || null,
    did_status: document.getElementById('edit-did-status')?.value || null,
    version: currentTask?.version,
  };

  // Remove null/undefined
  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) delete data[key];
  });

  try {
    if (currentTask?.id) {
      await api.put(`/tasks/${currentTask.id}`, data);
    } else {
      await api.post('/tasks', data);
    }
    closeTaskDetailModal();
    if (onSaveCallback) onSaveCallback();
    window.toast?.(currentTask?.id ? 'Задача сохранена' : 'Задача создана', 'success');
  } catch (e) {
    if (e.status === 409) {
      showConflictModal(e.data || e, app);
    } else {
      window.toast?.('Ошибка: ' + (e.message || 'не удалось сохранить'), 'error');
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHtml;
    }
  }
}

// ============================================================
//  CLOSE MODAL
// ============================================================
export function closeTaskDetailModal() {
  stopLockPolling();
  stopViewerPolling();
  if (currentTask?.id) {
    unregisterViewer(currentTask.id);
  }
  const dropdown = document.getElementById('mention-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
  _commentFormInitialized = false;
  _attachmentFormInitialized = false;
  const taskId = currentTask?.id;
  const wasEditing = modalMode === 'edit';
  const overlay = document.getElementById('task-detail-overlay');
  if (overlay) {
    overlay.classList.add('modal-closing');
    setTimeout(() => {
      overlay.remove();
      currentTask = null;
      currentModal = null;
      modalMode = 'view';
    }, 200);
  }
  if (taskId && wasEditing) {
    releaseLock(taskId);
  }
  _lockInfo = null;
}

// ============================================================
//  OPEN TASK MODAL (главная точка входа)
// ============================================================
export function openTaskModal(task = null) {
  currentTask = task;
  modalMode = task ? 'view' : 'edit';

  const html = renderTaskDetailModal(task, window.app);
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  currentModal = wrapper.firstElementChild;
  document.body.appendChild(currentModal);

  initTaskDetailModal(window.app);

  if (window.lucide) {
    window.lucide.createIcons();
  }

  return currentModal;
}

// ============================================================
//  СОВМЕСТИМОСТЬ со старым API
// ============================================================
export function renderModal(task, app) {
  return renderTaskDetailModal(task, app);
}

export function initModal(app) {
  initTaskDetailModal(app);
}

export function renderTaskCard(task) {
  // Мини-карточка для канбан/карточек
  const prio = task.priority_name || task.priority || 'СРЕДНИЙ';
  const prioClass = prio === 'ВЫСОКИЙ' ? 'badge-high' : prio === 'СРЕДНИЙ' ? 'badge-medium' : 'badge-low';
  const p = task.progress || 0;
  const statusName = task.status_name || task.status;
  const teamName = task.team_name || '—';
  const deadlineName = task.deadline_name || task.deadline || '—';
  const ownerName = task.owner_name || task.owner || '—';
  const safeId = escapeHtml(String(task.id));
  const safePrio = escapeHtml(prio);
  return `
    <div class="task-card" data-id="${safeId}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span class="font-mono text-muted" style="font-size:11px;flex-shrink:0;">#${safeId}</span>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <span class="badge ${prioClass}" style="font-size:10px;">${safePrio}</span>
        </div>
      </div>
      <div class="task-card-title">${escapeHtml(task.title)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${renderStatusBadge(statusName)}
        <span class="badge badge-info" style="font-size:10px;">${escapeHtml(teamName)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="progress-bar" style="flex:1;height:6px;"><div class="progress-fill ${p >= 100 ? 'success' : ''}" style="width:${p}%;height:6px;"></div></div>
        <span style="font-size:10px;color:var(--text-muted);min-width:28px;text-align:right;">${escapeHtml(String(p))}%</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);">
        <span>${escapeHtml(deadlineName)}</span>
        <span>${escapeHtml(ownerName)}</span>
      </div>
    </div>`;
}

export function setOnTaskSaved(callback) {
  onSaveCallback = callback;
}

// ============================================================
//  CREATE TASK MODAL (dedicated form with required fields)
// ============================================================
export function openCreateTaskModal(app) {
  currentTask = null;
  modalMode = 'create';

  const html = renderCreateTaskForm();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  currentModal = wrapper.firstElementChild;
  document.body.appendChild(currentModal);

  initCreateTaskModal(app);

  if (window.lucide) {
    window.lucide.createIcons();
  }

  return currentModal;
}

function renderCreateTaskForm() {
  return `
    <div class="modal-overlay" id="create-task-overlay">
      <div class="task-detail-modal" id="create-task-modal" role="dialog" aria-modal="true" aria-labelledby="create-task-title">
        
        <!-- Modal Header -->
        <div class="task-detail-modal-header">
          <div class="task-detail-header-left">
            <div class="task-detail-badges-row">
              <span class="task-detail-id">Новая задача</span>
            </div>
            <h2 class="task-detail-title" id="create-task-title">Создать задачу</h2>
          </div>
          <div class="task-detail-header-actions">
            <button class="task-detail-btn-icon task-detail-btn-close" id="create-close-btn" title="Закрыть">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <!-- Modal Body -->
        <div class="task-detail-modal-body" id="create-modal-body" style="padding:24px;">
          ${renderCreateTaskFormFields()}
        </div>

        <!-- Modal Footer -->
        <div class="task-detail-modal-footer">
          <div class="task-detail-footer-info">
            <span style="font-size:12px;color:var(--text-muted);">* Обязательные поля</span>
          </div>
          <div class="task-detail-footer-actions">
            <button class="task-detail-btn task-detail-btn-ghost" id="create-cancel-btn" onclick="document.getElementById('create-close-btn')?.click()">Отмена</button>
            <button class="task-detail-btn task-detail-btn-primary" id="create-save-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Создать задачу
            </button>
          </div>
        </div>

      </div>
    </div>`;
}

function renderCreateTaskFormFields() {
  const priorities = [
    { value: 1, label: 'ВЫСОКИЙ' }, { value: 2, label: 'СРЕДНИЙ' }, { value: 3, label: 'НИЗКИЙ' }
  ];

  function select(id, opts, selected) {
    return `<select class="task-detail-input" id="${id}">
      ${opts.map(o => `<option value="${escapeHtml(String(o.value))}" ${o.value === selected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }

  function input(id, type, val, placeholder) {
    return `<input type="${type}" class="task-detail-input" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function textarea(id, val, placeholder, rows = 3) {
    return `<textarea class="task-detail-input" id="${id}" rows="${rows}" placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(val || '')}</textarea>`;
  }

  function apiSelect(id) {
    return `<select class="task-detail-input" id="${id}"><option value="">Загрузка...</option></select>`;
  }

  function field(label, inputHtml, opts = {}) {
    const cls = opts.fullWidth ? ' td-edit-field-full' : '';
    return `<div class="td-edit-field${cls}">
      <label class="td-edit-label">${escapeHtml(label)}</label>
      ${inputHtml}
    </div>`;
  }

  function FL(key, fallback) {
    return (window.app?.fieldLabels && window.app.fieldLabels[key]) || fallback || key;
  }

  let html = `<div class="td-edit-form">`;

  // Title (required)
  html += `<div class="td-edit-field td-edit-field-full">
    <label class="td-edit-label">${FL('title')} <span style="color:var(--danger,#ef4444);">*</span></label>
    <input type="text" class="task-detail-input" id="create-title" placeholder="Введите название задачи" autofocus>
    <div class="create-field-error" id="create-title-error" style="display:none;color:var(--danger,#ef4444);font-size:12px;margin-top:4px;">Поле обязательно для заполнения</div>
  </div>`;

  // Team & Priority row (required)
  html += `<div class="td-edit-row-2">`;
  html += `<div class="td-edit-field">
    <label class="td-edit-label">${FL('team_id')} <span style="color:var(--danger,#ef4444);">*</span></label>
    ${apiSelect('create-team')}
    <div class="create-field-error" id="create-team-error" style="display:none;color:var(--danger,#ef4444);font-size:12px;margin-top:4px;">Выберите команду</div>
  </div>`;
  html += field(FL('priority_id'), select('create-priority', priorities, 2));
  html += `</div>`;

  // Description (required)
  html += `<div class="td-edit-field td-edit-field-full">
    <label class="td-edit-label">${FL('description')} <span style="color:var(--danger,#ef4444);">*</span></label>
    <textarea class="task-detail-input" id="create-description" rows="4" placeholder="Опишите задачу..."></textarea>
    <div class="create-field-error" id="create-description-error" style="display:none;color:var(--danger,#ef4444);font-size:12px;margin-top:4px;">Поле обязательно для заполнения</div>
  </div>`;

  // Optional fields section
  html += `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color);">`;
  html += `<div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px;">Дополнительные поля</div>`;

  // Type & Channel
  html += `<div class="td-edit-row-2">`;
  html += field(FL('task_type_id'), select('create-task-type', [
    { value: 1, label: 'Функциональность' }, { value: 2, label: 'Bug' },
    { value: 3, label: 'Техдолг' }, { value: 4, label: 'Исследование' },
    { value: 5, label: 'Интеграция' }, { value: 6, label: 'UI/UX' }, { value: 7, label: 'DevOps' }
  ], ''));
  html += field(FL('channel_id'), select('create-channel', [
    { value: 1, label: 'Поручение ДИД' }, { value: 2, label: 'Поручение ДРП' },
    { value: 3, label: 'Заявка на портале' }, { value: 4, label: 'Письмо' },
    { value: 5, label: 'Совещание' }, { value: 6, label: 'Другое' }
  ], ''));
  html += `</div>`;

  // Project & Business Customer
  html += `<div class="td-edit-row-2">`;
  html += field(FL('project_id'), apiSelect('create-project'));
  html += field(FL('business_customer_id'), apiSelect('create-business-customer'));
  html += `</div>`;

  // Deadline & Date
  html += `<div class="td-edit-row-2">`;
  html += field(FL('deadline_id'), select('create-deadline', [
    { value: 1, label: '1Q 2026' }, { value: 2, label: '2Q 2026' },
    { value: 3, label: '3Q 2026' }, { value: 4, label: '4Q 2026' },
    { value: 5, label: 'Y2026' }, { value: 6, label: 'Y2027' },
    { value: 7, label: '1Q 2027' }, { value: 8, label: '2Q 2027' }
  ], ''));
  html += field('Дата поступления', input('create-date-received', 'date', new Date().toISOString().slice(0, 10)));
  html += `</div>`;

  // Financial & Effort
  html += `<div class="td-edit-row-3">`;
  html += field(FL('effort_days'), input('create-effort-days', 'number', '', 'ч/д'));
  html += field(FL('effort_rub'), input('create-effort-rub', 'number', '', '₽'));
  html += field(FL('financial_effect'), input('create-financial-effect', 'number', '', '₽'));
  html += `</div>`;

  // Links
  html += `<div class="td-edit-row-2">`;
  html += field(FL('link_mockups'), input('create-link-mockups', 'text', '', 'https://...'));
  html += field(FL('link_jira'), input('create-link-jira', 'text', '', 'https://...'));
  html += `</div>`;

  // Comment
  html += field(FL('comment'), textarea('create-comment', '', 'Общий комментарий', 2), { fullWidth: true });

  html += `</div>`; // end optional section
  html += `</div>`; // end form
  return html;
}

async function initCreateTaskModal(app) {
  const overlay = document.getElementById('create-task-overlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCreateTaskModal();
  });

  document.getElementById('create-close-btn')?.addEventListener('click', closeCreateTaskModal);

  document.getElementById('create-save-btn')?.addEventListener('click', () => saveCreateTask(app));

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeCreateTaskModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Populate API selects
  await populateCreateSelects(app);

  // Focus title
  setTimeout(() => {
    document.getElementById('create-title')?.focus();
  }, 100);
}

async function populateCreateSelects(app) {
  const api = app?.api || window.app?.api;
  if (!api) return;

  async function populate(endpoint, selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    try {
      const data = await api.get(endpoint);
      const items = Array.isArray(data) ? data : (data.items || data.data || []);
      select.innerHTML = '<option value="">Выберите</option>' +
        items.map(item => {
          const id = item.id;
          const name = item.name || item.title || item.label || '';
          return `<option value="${escapeHtml(String(id))}">${escapeHtml(name)}</option>`;
        }).join('');
    } catch (e) {
      console.error(`Failed to load ${endpoint}:`, e);
    }
  }

  populate('/teams', 'create-team');
  populate('/projects', 'create-project');
  populate('/admin/business-customers', 'create-business-customer');
}

function validateCreateForm() {
  let valid = true;

  // Title
  const title = document.getElementById('create-title');
  const titleError = document.getElementById('create-title-error');
  if (!title?.value?.trim()) {
    title?.classList.add('input-error');
    if (titleError) titleError.style.display = 'block';
    valid = false;
  } else {
    title?.classList.remove('input-error');
    if (titleError) titleError.style.display = 'none';
  }

  // Team
  const team = document.getElementById('create-team');
  const teamError = document.getElementById('create-team-error');
  if (!team?.value) {
    team?.classList.add('input-error');
    if (teamError) teamError.style.display = 'block';
    valid = false;
  } else {
    team?.classList.remove('input-error');
    if (teamError) teamError.style.display = 'none';
  }

  // Description
  const desc = document.getElementById('create-description');
  const descError = document.getElementById('create-description-error');
  if (!desc?.value?.trim()) {
    desc?.classList.add('input-error');
    if (descError) descError.style.display = 'block';
    valid = false;
  } else {
    desc?.classList.remove('input-error');
    if (descError) descError.style.display = 'none';
  }

  return valid;
}

async function saveCreateTask(app) {
  if (!validateCreateForm()) {
    window.toast?.('Заполните обязательные поля', 'error');
    return;
  }

  const api = app?.api || window.app?.api;
  if (!api) return;

  const saveBtn = document.getElementById('create-save-btn');
  const originalHtml = saveBtn?.innerHTML || 'Создать задачу';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>Создание...';
  }

  function getVal(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = el.value;
    if (v === '' || v === null || v === undefined) return null;
    return v;
  }

  function getInt(id) {
    const v = getVal(id);
    if (v === null) return null;
    const n = parseInt(v);
    return isNaN(n) ? null : n;
  }

  function getFloat(id) {
    const v = getVal(id);
    if (v === null) return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  const data = {
    title: document.getElementById('create-title')?.value?.trim() || '',
    team_id: getInt('create-team'),
    priority_id: getInt('create-priority') || 2,
    description: document.getElementById('create-description')?.value?.trim() || '',
    task_type_id: getInt('create-task-type'),
    channel_id: getInt('create-channel'),
    project_id: getInt('create-project'),
    business_customer_id: getInt('create-business-customer'),
    deadline_id: getInt('create-deadline'),
    date_received: document.getElementById('create-date-received')?.value || null,
    effort_days: getInt('create-effort-days'),
    effort_rub: getFloat('create-effort-rub'),
    financial_effect: getFloat('create-financial-effect'),
    link_mockups: document.getElementById('create-link-mockups')?.value || null,
    link_jira: document.getElementById('create-link-jira')?.value || null,
    comment: document.getElementById('create-comment')?.value || null,
  };

  // Remove null/undefined
  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) delete data[key];
  });

  try {
    await api.post('/tasks', data);
    closeCreateTaskModal();
    if (onSaveCallback) onSaveCallback();
    window.toast?.('Задача создана', 'success');
  } catch (e) {
    window.toast?.('Ошибка: ' + (e.message || 'не удалось создать задачу'), 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalHtml;
    }
  }
}

// ============================================================
//  COMMENTS FUNCTIONALITY
// ============================================================

function commentTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;
  if (days < 7) return `${days} д. назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderCommentItem(comment, depth) {
  depth = depth || 0;
  const name = comment.user_name || 'Пользователь';
  const initials = getInitials(name);
  const color = avatarColor(name);
  let text = escapeHtml(comment.text);
  if (comment.mentioned_user_ids && comment.mentioned_user_ids.length > 0) {
    _usersCache.forEach(u => {
      if (comment.mentioned_user_ids.includes(u.id)) {
        const re = new RegExp(`@${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        text = text.replace(re, `<span class="comment-mention">@${escapeHtml(u.name)}</span>`);
      }
    });
  }
  const replies = (comment.replies && comment.replies.length > 0)
    ? `<div class="comment-replies">${comment.replies.map(r => renderCommentItem(r, depth + 1)).join('')}</div>`
    : '';
  return `<div class="comment-item${depth > 0 ? ' comment-item-reply' : ''}">
    <div class="task-detail-avatar" style="width:32px;height:32px;background:${color};font-size:12px;flex-shrink:0;">${initials}</div>
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(name)}</span>
        <span class="comment-time">${commentTime(comment.created_at)}</span>
      </div>
      <div class="comment-text">${text}</div>
      <div class="comment-actions">
        <button class="comment-reply-btn" onclick="window.__setReplyTo(${comment.id}, '${escapeHtml(name).replace(/'/g, "\\'")}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          Ответить
        </button>
      </div>
      ${replies}
    </div>
  </div>`;
}

window.__setReplyTo = function(commentId, userName) {
  _replyingTo = { id: commentId, name: userName };
  const indicator = document.getElementById('reply-indicator');
  const textarea = document.getElementById('comment-textarea');
  if (indicator) {
    indicator.style.display = 'flex';
    indicator.querySelector('.reply-indicator-text').textContent = `Ответ на ${userName}`;
  }
  if (textarea) textarea.focus();
};

window.__cancelReply = cancelReply;

function cancelReply() {
  _replyingTo = null;
  const indicator = document.getElementById('reply-indicator');
  if (indicator) indicator.style.display = 'none';
}

async function loadComments(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api || !taskId) return;
  _commentTaskId = taskId;
  try {
    const [commentsData, usersData] = await Promise.allSettled([
      api.get(`/tasks/${taskId}/comments`),
      api.get('/users'),
    ]);
    if (commentsData.status === 'fulfilled') {
      _commentsCache = commentsData.value.items || [];
    } else {
      console.error('Failed to load comments:', commentsData.reason);
      _commentsCache = [];
    }
    if (usersData.status === 'fulfilled') {
      const raw = usersData.value.items || usersData.value || [];
      _usersCache = Array.isArray(raw) ? raw.filter(u => u.is_active !== false) : [];
    } else {
      console.error('Failed to load users:', usersData.reason);
    }
    renderCommentList();
  } catch (e) {
    console.error('Failed to load comments:', e);
    const container = document.getElementById('comments-list-container');
    if (container) container.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">Не удалось загрузить комментарии</div>';
  }
}

function renderCommentList() {
  const container = document.getElementById('comments-list-container');
  if (!container) return;
  if (_commentsCache.length === 0) {
    container.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">Комментариев пока нет</div>';
    return;
  }
  container.innerHTML = `<div class="comments-feed">${_commentsCache.map(renderCommentItem).join('')}</div>`;
}

let _commentFormInitialized = false;

function initCommentForm(taskId, app) {
  if (_commentFormInitialized) return;
  const textarea = document.getElementById('comment-textarea');
  const submitBtn = document.getElementById('comment-submit-btn');
  const dropdown = document.getElementById('mention-dropdown');
  if (!textarea || !submitBtn || !dropdown) return;
  _commentFormInitialized = true;

  textarea.addEventListener('input', () => {
    submitBtn.disabled = !textarea.value.trim();
    detectMention(textarea, dropdown);
  });

  textarea.addEventListener('keydown', (e) => {
    const isOpen = dropdown.style.display !== 'none';
    if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = dropdown.querySelectorAll('.mention-item');
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') _mentionSelectedIdx = Math.min(_mentionSelectedIdx + 1, items.length - 1);
      else _mentionSelectedIdx = Math.max(_mentionSelectedIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('selected', i === _mentionSelectedIdx));
      return;
    }
    if (isOpen && e.key === 'Enter' && _mentionSelectedIdx >= 0) {
      e.preventDefault();
      const items = dropdown.querySelectorAll('.mention-item');
      const selected = items[_mentionSelectedIdx];
      if (selected) {
        const userId = parseInt(selected.dataset.userId, 10);
        const userName = selected.dataset.userName;
        insertMention(textarea, userId, userName, dropdown);
      }
      return;
    }
    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      dropdown.style.display = 'none';
      _mentionSelectedIdx = -1;
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !isOpen) {
      e.preventDefault();
      submitComment(taskId, app);
    }
  });

  textarea.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; _mentionSelectedIdx = -1; }, 150);
  });

  submitBtn.addEventListener('click', () => submitComment(taskId, app));

  dropdown.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('.mention-item');
    if (item) {
      const userId = parseInt(item.dataset.userId, 10);
      const userName = item.dataset.userName;
      insertMention(textarea, userId, userName, dropdown);
    }
  });
}

function detectMention(textarea, dropdown) {
  const val = textarea.value;
  const pos = textarea.selectionStart;
  const textBefore = val.substring(0, pos);
  const atIndex = textBefore.lastIndexOf('@');
  if (atIndex === -1) {
    dropdown.style.display = 'none';
    return;
  }
  const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : '';
  if (charBefore !== '' && charBefore !== ' ' && charBefore !== '\n') {
    dropdown.style.display = 'none';
    return;
  }
  const query = textBefore.substring(atIndex + 1);
  if (query.includes(' ') || query.includes('\n')) {
    dropdown.style.display = 'none';
    return;
  }
  const lq = query.toLowerCase();
  const filtered = _usersCache.filter(u => {
    const name = (u.name || '').toLowerCase();
    const login = (u.login || u.email || '').toLowerCase();
    return name.includes(lq) || login.includes(lq);
  }).slice(0, 8);
  if (filtered.length === 0) {
    dropdown.style.display = 'none';
    return;
  }
  _mentionQueryStart = atIndex;
  _mentionSelectedIdx = 0;
  dropdown.innerHTML = filtered.map((u, i) => {
    const initials = getInitials(u.name);
    const color = avatarColor(u.name);
    return `<div class="mention-item${i === 0 ? ' selected' : ''}" data-user-id="${u.id}" data-user-name="${escapeHtml(u.name || u.login || u.email)}">
      <div class="task-detail-avatar" style="width:24px;height:24px;background:${color};font-size:9px;">${initials}</div>
      <span>${escapeHtml(u.name || u.login || u.email)}</span>
    </div>`;
  }).join('');
  dropdown.style.display = 'block';
}

function insertMention(textarea, userId, userName, dropdown) {
  const val = textarea.value;
  const pos = textarea.selectionStart;
  const textBefore = val.substring(0, pos);
  const atIndex = textBefore.lastIndexOf('@');
  const textAfter = val.substring(pos);
  const newText = textBefore.substring(0, atIndex) + '@' + userName + ' ' + textAfter;
  textarea.value = newText;
  const newPos = atIndex + userName.length + 2;
  textarea.selectionStart = textarea.selectionEnd = newPos;
  textarea.focus();
  if (!_mentionedUserIds.includes(userId)) _mentionedUserIds.push(userId);
  dropdown.style.display = 'none';
  _mentionSelectedIdx = -1;
  const submitBtn = document.getElementById('comment-submit-btn');
  if (submitBtn) submitBtn.disabled = !textarea.value.trim();
}

async function submitComment(taskId, app) {
  const api = app?.api || window.app?.api;
  const textarea = document.getElementById('comment-textarea');
  const submitBtn = document.getElementById('comment-submit-btn');
  if (!api || !textarea || !submitBtn) return;

  const text = textarea.value.trim();
  if (!text) return;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>Отправка...';

  try {
    const payload = { text };
    if (_mentionedUserIds.length > 0) {
      payload.mentioned_user_ids = [..._mentionedUserIds];
    }
    if (_replyingTo) {
      payload.parent_id = _replyingTo.id;
    }
    await api.post(`/tasks/${taskId}/comments`, payload);
    textarea.value = '';
    _mentionedUserIds = [];
    cancelReply();
    window.toast?.('Комментарий добавлен', 'success');
    await loadComments(taskId, app);
  } catch (e) {
    window.toast?.('Ошибка: ' + (e.message || 'не удалось отправить'), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Отправить';
  }
}

function closeCreateTaskModal() {
  const overlay = document.getElementById('create-task-overlay');
  if (overlay) {
    overlay.classList.add('modal-closing');
    setTimeout(() => {
      overlay.remove();
      currentTask = null;
      modalMode = 'view';
    }, 200);
  }
}

// Legacy API
export function closeModal() { closeTaskDetailModal(); }
export function openConfirmModal(message, onConfirm) { /* not needed in new version */ }

export function showConfirmModal(message, title = 'Подтверждение', okText = 'ОК', cancelText = 'Отмена', danger = false) {
  return new Promise((resolve) => {
    const existing = document.getElementById('confirm-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1200';

    const okBtnStyle = danger
      ? 'background:var(--danger);color:white;border:none;'
      : '';

    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border-radius:12px;padding:24px;max-width:400px;width:90%;position:relative;">
        <h3 style="margin:0 0 16px 0;font-size:16px;color:var(--text-primary);">${escapeHtml(title)}</h3>
        <p style="margin:0 0 20px 0;font-size:14px;color:var(--text-secondary);">${escapeHtml(message)}</p>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-secondary btn-sm" id="confirm-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn btn-primary btn-sm" id="confirm-ok" style="${okBtnStyle}">${escapeHtml(okText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('#confirm-ok');
    const cancelBtn = overlay.querySelector('#confirm-cancel');

    okBtn?.focus();

    function handleOk() {
      overlay.remove();
      resolve(true);
    }

    function handleCancel() {
      overlay.remove();
      resolve(false);
    }

    okBtn?.addEventListener('click', handleOk);
    cancelBtn?.addEventListener('click', handleCancel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        handleCancel();
      }
    });

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        handleCancel();
        document.removeEventListener('keydown', handleKeydown);
      }
    }
    document.addEventListener('keydown', handleKeydown);
  });
}

const ERROR_CODE_MAP = {
  400: { label: 'Неверный запрос', desc: 'Сервер не смог обработать запрос из-за некорректных данных' },
  401: { label: 'Сессия истекла', desc: 'Авторизация истекла — войдите в систему заново' },
  403: { label: 'Нет прав', desc: 'У вас недостаточно прав для изменения этой задачи' },
  404: { label: 'Не найдено', desc: 'Задача не найдена — возможно, она была удалена' },
  409: { label: 'Конфликт версий', desc: 'Задача была изменена другим пользователем — обновите страницу' },
  422: { label: 'Ошибка валидации', desc: 'Одно или несколько полей содержат недопустимые данные' },
  423: { label: 'Заблокировано', desc: 'Задача редактируется другим пользователем' },
  429: { label: 'Слишком много запросов', desc: 'Подождите немного и попробуйте снова' },
  500: { label: 'Ошибка сервера', desc: 'Внутренняя ошибка — обратитесь к администратору' },
  502: { label: 'Сервер недоступен', desc: 'Бэкенд временно не отвечает — попробуйте позже' },
  503: { label: 'Сервер перегружен', desc: 'Сервер временно не обрабатывает запросы' },
};

function getErrorInfo(httpStatus, rawError) {
  const code = parseInt(httpStatus) || 0;
  const map = ERROR_CODE_MAP[code];
  if (!map) return { label: `HTTP ${httpStatus}`, desc: rawError || 'Неизвестная ошибка' };

  let desc = map.desc;
  const err = (rawError || '').toLowerCase();
  if (code === 500) {
    if (err.includes('notifications')) desc = 'Ошибка системы уведомлений — обратитесь к администратору';
    else if (err.includes('constraint') || err.includes('not null')) desc = 'Ошибка целостности данных — обратитесь к администратору';
    else if (err.includes('unique')) desc = 'Нарушение уникальности — обратитесь к администратору';
    else if (err.includes('foreign key')) desc = 'Ошибка связи с другой таблицей — обратитесь к администратору';
  }
  if (code === 422) {
    if (err.includes('string too long')) desc = 'Превышена максимальная длина поля';
    else if (err.includes('greater than') || err.includes('less than')) desc = 'Значение поля выходит за допустимые пределы';
    else if (err.includes('not a valid')) desc = 'Недопустимое значение поля';
  }
  return { label: map.label, desc };
}

export function showErrorModal(saved, errors, errorDetails) {
  return new Promise((resolve) => {
    const existing = document.getElementById('error-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'error-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1200';

    const isDetailed = errorDetails.length > 0 && typeof errorDetails[0] === 'object';

    let detailsHtml = '';
    if (isDetailed) {
      detailsHtml = `
        <div style="margin-top:16px;max-height:400px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-color);">
                <th style="text-align:left;padding:8px 8px;color:var(--text-secondary);font-weight:600;white-space:nowrap;">ID задачи</th>
                <th style="text-align:left;padding:8px 8px;color:var(--text-secondary);font-weight:600;">Атрибут</th>
                <th style="text-align:center;padding:8px 8px;color:var(--text-secondary);font-weight:600;white-space:nowrap;">Код</th>
                <th style="text-align:left;padding:8px 8px;color:var(--text-secondary);font-weight:600;">Описание</th>
              </tr>
            </thead>
            <tbody>
              ${errorDetails.map(d => {
                const info = getErrorInfo(d.httpStatus, d.error);
                const statusCode = parseInt(d.httpStatus) || 0;
                const badgeColor = statusCode >= 500 ? 'var(--danger)' : statusCode >= 400 ? 'var(--warning)' : 'var(--text-secondary)';
                const badgeBg = statusCode >= 500 ? 'var(--danger-light)' : statusCode >= 400 ? 'var(--warning-light)' : 'var(--bg-tertiary)';
                return `
                  <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:8px 8px;vertical-align:top;">
                      <strong style="font-family:monospace;">#${d.taskId}</strong>
                    </td>
                    <td style="padding:8px 8px;vertical-align:top;">
                      <span style="font-size:13px;">${escapeHtml(d.fields || '—')}</span>
                    </td>
                    <td style="padding:8px 8px;text-align:center;vertical-align:top;">
                      <span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;color:${badgeColor};background:${badgeBg};">
                        ${d.httpStatus}
                      </span>
                      <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${escapeHtml(info.label)}</div>
                    </td>
                    <td style="padding:8px 8px;vertical-align:top;">
                      <span style="font-size:13px;color:var(--text-primary);">${escapeHtml(info.desc)}</span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      detailsHtml = errorDetails.length > 0
        ? `<div style="margin-top:16px;max-height:300px;overflow-y:auto;">
            ${errorDetails.map(d => `<div style="padding:8px 12px;margin-bottom:6px;background:var(--danger-light);border-radius:6px;font-size:13px;color:var(--danger);border-left:3px solid var(--danger);">${escapeHtml(d)}</div>`).join('')}
           </div>`
        : '';
    }

    overlay.innerHTML = `
      <div style="background:var(--bg-primary);border-radius:12px;padding:24px;max-width:${isDetailed ? '750px' : '500px'};width:90%;position:relative;">
        <h3 style="margin:0 0 12px 0;font-size:16px;color:var(--text-primary);">Результат сохранения</h3>
        <div style="display:flex;gap:16px;margin-bottom:16px;">
          <div style="flex:1;padding:12px;background:var(--success-light);border-radius:8px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:var(--success);">${saved}</div>
            <div style="font-size:12px;color:var(--text-secondary);">Сохранено</div>
          </div>
          <div style="flex:1;padding:12px;background:var(--danger-light);border-radius:8px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:var(--danger);">${errors}</div>
            <div style="font-size:12px;color:var(--text-secondary);">Ошибок</div>
          </div>
        </div>
        ${detailsHtml}
        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-primary btn-sm" id="error-ok">Понятно</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('#error-ok');
    okBtn?.focus();

    function handleClose() {
      overlay.remove();
      resolve();
    }

    okBtn?.addEventListener('click', handleClose);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) handleClose();
    });

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        handleClose();
        document.removeEventListener('keydown', handleKeydown);
      }
    }
    document.addEventListener('keydown', handleKeydown);
  });
}

const FIELD_GROUPS = {
  'status_priority': { label: 'Статус и приоритет', fields: ['status_id', 'priority_id', 'progress'] },
  'deadlines': { label: 'Сроки', fields: ['deadline_id', 'date_received'] },
  'responsible': { label: 'Ответственные', fields: ['owner_id'] },
  'ownership': { label: 'Принадлежность', fields: ['team_id', 'project_id', 'task_type_id', 'channel_id', 'department_id', 'business_customer_id'] },
  'meetings': { label: 'Для встреч', fields: ['key_project_status', 'directorate_status', 'did_status'] },
  'estimation': { label: 'Оценка', fields: ['effort_days', 'effort_rub', 'financial_effect'] },
  'text_links': { label: 'Тексты и ссылки', fields: ['rejection_reason', 'comment', 'link_jira', 'link_mockups'] },
  'tags': { label: 'Метки', fields: ['tags'] }
};

const FIELD_LABELS_BULK = {
  status_id: 'Статус', priority_id: 'Приоритет', progress: 'Прогресс %',
  deadline_id: 'Дедлайн', date_received: 'Дата получения',
  owner_id: 'Владелец',
  team_id: 'Команда', project_id: 'Проект', task_type_id: 'Тип задачи', channel_id: 'Канал', department_id: 'Подразделение', business_customer_id: 'Бизнес-заказчик',
  key_project_status: 'Статус ключ. проекта', directorate_status: 'Статус для директорской', did_status: 'Статус для ДИД',
  effort_days: 'Трудозатраты дни', effort_rub: 'Трудозатраты руб', financial_effect: 'Фин. эффект',
  rejection_reason: 'Причина отклонения', comment: 'Комментарий', link_jira: 'Ссылка на Jira', link_mockups: 'Ссылка на макеты',
  tags: 'Теги'
};

const FIELD_TYPES_BULK = {
  status_id: 'select', priority_id: 'select', progress: 'number',
  deadline_id: 'select', date_received: 'date',
  owner_id: 'select',
  team_id: 'select', project_id: 'select', task_type_id: 'select', channel_id: 'select', department_id: 'select', business_customer_id: 'select',
  key_project_status: 'select', directorate_status: 'text', did_status: 'text',
  effort_days: 'number', effort_rub: 'number', financial_effect: 'number',
  rejection_reason: 'textarea', comment: 'textarea', link_jira: 'text', link_mockups: 'text',
  tags: 'tags'
};

const REQUIRES_REASON_STATUSES_BULK = ['ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА', 'ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ'];

export function showBulkOpsModal(app, scope, tasks) {
  return new Promise((resolve) => {
    const existing = document.getElementById('bulk-modal-overlay');
    if (existing) return;

    let step = 1;
    let excluded = new Set();
    let selectedFields = [];
    let fieldValues = {};
    let userModified = false;
    let currentPage = 1;
    const PAGE_SIZE = 100;

    const overlay = document.createElement('div');
    overlay.id = 'bulk-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1100';

    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPaddingRight = document.body.style.paddingRight;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = scrollbarWidth + 'px';

    function closeBulkModal() {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.paddingRight = prevBodyPaddingRight;
      overlay.remove();
    }

    const totalTasks = tasks.length;
    const totalPages = Math.ceil(totalTasks / PAGE_SIZE);

    function getSelectedCount() {
      return totalTasks - excluded.size;
    }

    function getPageTasks() {
      const start = (currentPage - 1) * PAGE_SIZE;
      return tasks.slice(start, start + PAGE_SIZE);
    }

    function getPageTaskIds() {
      return getPageTasks().map(t => t.id);
    }

    function renderStep() {
      const subtitle = step === 1 ? 'Шаг 1 из 2 — выбор задач' : 'Шаг 2 из 2 — изменение полей';
      let bodyContent = '';

      if (step === 1) {
        const selected = getSelectedCount();
        const pageTaskIds = getPageTaskIds();
        const pageSelectedCount = pageTaskIds.filter(id => !excluded.has(id)).length;
        const selectAllDisabled = pageSelectedCount === pageTaskIds.length;
        const clearAllDisabled = pageSelectedCount === 0;

        let rowsHtml = '';
        const tasksToShow = getPageTasks();
        for (const t of tasksToShow) {
          const isOff = excluded.has(t.id);
          rowsHtml += `
            <div class="bc-row ${isOff ? 'bc-row-off' : ''}" data-task-id="${t.id}" style="display:grid;grid-template-columns:22px 46px 1fr 150px 120px;gap:0;border-bottom:1px solid var(--border-color);cursor:pointer;">
              <div style="display:flex;align-items:center;justify-content:center;padding:8px;">
                <input type="checkbox" class="bc-cb" value="${t.id}" ${isOff ? '' : 'checked'} style="margin:0;accent-color:var(--accent);">
              </div>
              <div style="padding:8px;font-family:monospace;font-size:12px;color:var(--text-muted);">#${t.id}</div>
              <div style="padding:8px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.title || '—')}</div>
              <div style="padding:8px;font-size:12px;color:var(--text-secondary);">${escapeHtml(t.status_name || t.status || '—')}</div>
              <div style="padding:8px;font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums;">${escapeHtml(t.deadline_name || t.deadline || '—')}</div>
            </div>
          `;
        }

        const paginationHtml = `
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 12px;flex-shrink:0;background:var(--bg-tertiary);">
            <button id="bc-page-prev" class="bc-link-btn" ${currentPage === 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''}>←</button>
            <span style="font-size:12px;color:var(--text-secondary);">Страница <strong>${currentPage}</strong> из <strong>${totalPages}</strong></span>
            <button id="bc-page-next" class="bc-link-btn" ${currentPage === totalPages ? 'disabled style="opacity:.4;cursor:default;"' : ''}>→</button>
          </div>
        `;

        const emptyMsg = totalTasks === 0 ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">В текущем фильтре нет задач. Закройте окно и измените фильтр в реестре.</div>` : '';

        bodyContent = `
          <div style="display:flex;flex-direction:column;flex:1;min-height:0;padding:12px 16px 16px 16px;">
            <p style="margin:0 0 12px 0;font-size:13px;color:var(--text-secondary);line-height:1.5;">В список попали задачи с учетом примененных на странице фильтров. Выберите из них те, по которым хотите сделать массовую корректировку атрибутов.</p>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-shrink:0;">
              <span style="font-size:14px;">Выбрано <strong id="bc-count" style="color:var(--accent);">${selected}</strong> из ${totalTasks}</span>
              <div style="display:flex;gap:12px;font-size:13px;">
                <button id="bc-select-all" class="bc-link-btn" ${selectAllDisabled ? 'disabled style="opacity:.5;cursor:default;"' : ''}>Выбрать все</button>
                <span style="color:var(--text-muted);">·</span>
                <button id="bc-clear-all" class="bc-link-btn" ${clearAllDisabled ? 'disabled style="opacity:.5;cursor:default;"' : ''}>Снять все</button>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;flex:1;border-radius:8px;border:1px solid var(--border-color);overflow:hidden;min-height:0;">
              <div class="bc-table-head" style="display:grid;grid-template-columns:22px 46px 1fr 150px 120px;gap:0;background:var(--bg-tertiary);border-radius:8px 8px 0 0;flex-shrink:0;">
                <div style="padding:8px;"></div>
                <div style="padding:8px;font-size:10.5px;uppercase;letter-spacing:.06em;color:var(--text-muted);">ID</div>
                <div style="padding:8px;font-size:10.5px;uppercase;letter-spacing:.06em;color:var(--text-muted);">ЗАДАЧА</div>
                <div style="padding:8px;font-size:10.5px;uppercase;letter-spacing:.06em;color:var(--text-muted);">СТАТУС</div>
                <div style="padding:8px;font-size:10.5px;uppercase;letter-spacing:.06em;color:var(--text-muted);">СРОК</div>
              </div>
              <div class="bc-rows-container" style="flex:1;overflow-y:auto;min-height:0;padding-left:4px;">
                ${emptyMsg || rowsHtml}
              </div>
              ${paginationHtml}
            </div>
          </div>
        `;
      } else {
        const selected = getSelectedCount();
        let fieldsRowsHtml = '';
        for (const item of selectedFields) {
          const fl = FIELD_LABELS_BULK[item.field] || item.field;
          let controlHtml = '';
          const ftype = FIELD_TYPES_BULK[item.field] || 'text';

          if (ftype === 'select') {
            const opts = getSelectOptions(item.field);
            controlHtml = `<select class="bc-field-val" data-field="${item.field}" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;">${opts}</select>`;
          } else if (ftype === 'select_yesno') {
            controlHtml = `<select class="bc-field-val" data-field="${item.field}" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;"><option value="">—</option><option value="true">Да</option><option value="false">Нет</option></select>`;
          } else if (ftype === 'number') {
            controlHtml = `<input type="number" class="bc-field-val" data-field="${item.field}" value="${item.value ?? ''}" placeholder="0" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;">`;
          } else if (ftype === 'date') {
            controlHtml = `<input type="date" class="bc-field-val" data-field="${item.field}" value="${item.value ?? ''}" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;">`;
          } else if (ftype === 'textarea') {
            controlHtml = `<textarea class="bc-field-val" data-field="${item.field}" rows="2" placeholder="Введите значение" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;resize:none;">${escapeHtml(item.value || '')}</textarea>`;
          } else {
            controlHtml = `<input type="text" class="bc-field-val" data-field="${item.field}" value="${escapeHtml(item.value || '')}" placeholder="Введите значение" style="width:100%;padding:6px 8px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;">`;
          }

          fieldsRowsHtml += `
            <div class="bc-field-row" data-field="${item.field}" style="display:grid;grid-template-columns:190px 1fr 28px;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-color);align-items:center;">
              <div style="font-size:13px;color:var(--text-secondary);padding:0 8px;">${fl}</div>
              <div>${controlHtml}</div>
              <button class="bc-field-remove" data-field="${item.field}" style="width:28px;height:28px;border:none;background:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center;border-radius:4px;">✕</button>
            </div>
          `;
        }

        const addFieldBtn = `
          <button id="bc-add-field" style="width:100%;padding:10px;border:1px dashed var(--border-color);border-radius:8px;background:none;cursor:pointer;color:var(--text-secondary);font-size:13px;margin-top:12px;">+ Добавить поле</button>
        `;

        const fieldPickerHtml = `
          <div id="bc-field-picker" class="hidden" style="margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">
            <input type="text" id="bc-field-search" placeholder="Найти поле по названию…" style="width:100%;padding:8px 10px;font-size:13px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-input);color:var(--text-primary);box-sizing:border-box;margin-bottom:10px;">
            <div id="bc-field-list" style="max-height:240px;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:4px;"></div>
          </div>
        `;

        const summaryText = selectedFields.length === 0
          ? '<span style="color:var(--text-muted);font-size:13px;">Пока нечего применять — добавьте хотя бы одно поле со значением</span>'
          : `<span style="font-size:13px;">Будет изменено ${selectedFields.length} ${pluralize(selectedFields.length, 'поле', 'поля', 'полей')} у <strong>${selected}</strong> ${pluralize(selected, 'задачи', 'задач', 'задач')}: ${selectedFields.map(f => FIELD_LABELS_BULK[f.field] || f.field).join(', ')}</span>`;

        bodyContent = `
          <div style="display:flex;flex-direction:column;padding:12px 16px 16px 16px;flex:1;min-height:0;">
            <p style="margin:0 0 12px 0;font-size:13px;color:var(--text-secondary);line-height:1.5;">Изменения применятся к <strong>${selected}</strong> ${pluralize(selected, 'задаче', 'задачам', 'задачам')}. Добавьте поля, которые нужно изменить — значение будет одинаковым у всех выбранных задач.</p>
            <div style="flex:1;overflow-y:auto;min-height:0;">
              <div id="bc-fields-list" style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);padding:4px 8px;margin-bottom:12px;">
                ${fieldsRowsHtml || '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Поля не выбраны</div>'}
              </div>
              ${addFieldBtn}
              ${fieldPickerHtml}
            </div>
            <div id="bc-summary" style="margin-top:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;font-size:13px;color:var(--text-secondary);flex-shrink:0;">${summaryText}</div>
          </div>
        `;
      }

      overlay.innerHTML = `
        <div class="modal" style="background:var(--bg-primary);border-radius:12px;max-width:720px;width:95%;position:relative;max-height:90vh;display:flex;flex-direction:column;">
          <div style="padding:8px 16px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:12px;">
            <div style="display:flex;gap:8px;">
              <span style="width:24px;height:24px;border-radius:50%;background:${step >= 1 ? 'var(--accent)' : 'var(--bg-secondary)'};color:${step >= 1 ? 'white' : 'var(--text-muted)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">1</span>
              <span style="width:24px;height:24px;border-radius:50%;background:${step >= 2 ? 'var(--accent)' : 'var(--bg-secondary)'};color:${step >= 2 ? 'white' : 'var(--text-muted)'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">2</span>
            </div>
            <div style="flex:1;">
              <div style="font-size:14px;font-weight:600;color:var(--text-primary);">Массовые операции</div>
              <div id="bc-subtitle" style="font-size:11px;color:var(--text-muted);">${subtitle}</div>
            </div>
            <button id="bc-modal-close" style="width:32px;height:32px;border:none;background:none;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:18px;">✕</button>
          </div>
          <div class="modal-body-scroll" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;">${bodyContent}</div>
          <div style="padding:4px 16px 2px 16px;display:flex;justify-content:space-between;gap:12px;">
            <button id="bc-cancel" class="btn btn-secondary btn-sm">Отмена</button>
            <div style="display:flex;gap:8px;">
              ${step === 2 ? '<button id="bc-back" class="btn btn-secondary btn-sm">← Назад к выбору задач</button>' : ''}
              <button id="bc-next" class="btn btn-primary btn-sm" ${step === 1 && getSelectedCount() === 0 ? 'disabled' : ''}>${step === 1 ? 'Далее - что изменить' : `Применить к ${getSelectedCount()} ${pluralize(getSelectedCount(), 'задаче', 'задачам', 'задачам')}`}</button>
            </div>
          </div>
        </div>
      `;

      bindStepEvents();
    }

    function getSelectOptions(field) {
      let opts = '<option value="">—</option>';
      switch (field) {
        case 'status_id': (window.app?.statuses || []).forEach(s => { opts += `<option value="${s.id}">${escapeHtml(s.name)}</option>`; }); break;
        case 'priority_id': (window.app?.priorities || []).forEach(p => { opts += `<option value="${p.id}">${escapeHtml(p.name)}</option>`; }); break;
        case 'team_id': (window.app?.teams || []).forEach(t => { opts += `<option value="${t.id}">${escapeHtml(t.name)}</option>`; }); break;
        case 'project_id': (window.app?.projects || []).forEach(p => { opts += `<option value="${p.id}">${escapeHtml(p.name)}</option>`; }); break;
        case 'task_type_id': (window.app?.taskTypes || []).forEach(t => { opts += `<option value="${t.id}">${escapeHtml(t.name)}</option>`; }); break;
        case 'channel_id': (window.app?.channels || []).forEach(c => { opts += `<option value="${c.id}">${escapeHtml(c.name)}</option>`; }); break;
        case 'department_id': (window.app?.departments || []).forEach(d => { opts += `<option value="${d.id}">${escapeHtml(d.name)}</option>`; }); break;
        case 'business_customer_id': (window.app?.businessCustomers || []).forEach(b => { opts += `<option value="${b.id}">${escapeHtml(b.name)}</option>`; }); break;
        case 'deadline_id': (window.app?.deadlines || []).forEach(d => { opts += `<option value="${d.id}">${escapeHtml(d.name)}</option>`; }); break;
        case 'owner_id': (window.app?.users || []).forEach(u => { opts += `<option value="${u.id}">${escapeHtml(u.name)}</option>`; }); break;
        case 'key_project_status': opts = '<option value="">—</option><option value="В работе">В работе</option><option value="На уточнении">На уточнении</option><option value="Выполнено">Выполнено</option>'; break;
      }
      return opts;
    }

    function pluralize(n, one, few, many) {
      const m = Math.abs(n);
      const mod10 = m % 10;
      const mod100 = m % 100;
      if (mod10 === 1 && mod100 !== 11) return one;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
      return many;
    }

    function bindStepEvents() {
      const nextBtn = overlay.querySelector('#bc-next');
      const cancelBtn = overlay.querySelector('#bc-cancel');
      const closeBtn = overlay.querySelector('#bc-modal-close');
      const backBtn = overlay.querySelector('#bc-back');

      cancelBtn?.addEventListener('click', handleClose);
      closeBtn?.addEventListener('click', handleClose);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) handleClose(); });

      if (step === 1) {
        const selectAllBtn = overlay.querySelector('#bc-select-all');
        const clearAllBtn = overlay.querySelector('#bc-clear-all');
        const countEl = overlay.querySelector('#bc-count');
        const prevBtn = overlay.querySelector('#bc-page-prev');
        const nextPageBtn = overlay.querySelector('#bc-page-next');

        function updatePageButtons() {
          if (prevBtn) prevBtn.disabled = currentPage === 1;
          if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
          if (prevBtn) prevBtn.style.opacity = currentPage === 1 ? '0.4' : '1';
          if (nextPageBtn) nextPageBtn.style.opacity = currentPage === totalPages ? '0.4' : '1';
        }

        function updateSelectClearButtons() {
          const pageTaskIds = getPageTaskIds();
          const pageSelectedCount = pageTaskIds.filter(id => !excluded.has(id)).length;
          if (selectAllBtn) {
            selectAllBtn.disabled = false;
            selectAllBtn.style.opacity = '';
            selectAllBtn.style.cursor = '';
          }
          if (clearAllBtn) {
            clearAllBtn.disabled = pageSelectedCount === 0;
            if (clearAllBtn.disabled) {
              clearAllBtn.style.opacity = '0.5';
              clearAllBtn.style.cursor = 'default';
            } else {
              clearAllBtn.style.opacity = '';
              clearAllBtn.style.cursor = '';
            }
          }
        }

        selectAllBtn?.addEventListener('click', () => {
          if (selectAllBtn.disabled) return;
          userModified = true;
          getPageTaskIds().forEach(id => excluded.delete(id));
          document.querySelectorAll('.bc-cb').forEach(cb => { cb.checked = true; });
          document.querySelectorAll('.bc-row').forEach(row => row.classList.remove('bc-row-off'));
          if (countEl) countEl.textContent = getSelectedCount();
          nextBtn && (nextBtn.disabled = getSelectedCount() === 0);
          updateSelectClearButtons();
        });

        clearAllBtn?.addEventListener('click', () => {
          if (clearAllBtn.disabled) return;
          userModified = true;
          getPageTaskIds().forEach(id => excluded.add(id));
          document.querySelectorAll('.bc-cb').forEach(cb => { cb.checked = false; });
          document.querySelectorAll('.bc-row').forEach(row => row.classList.add('bc-row-off'));
          if (countEl) countEl.textContent = getSelectedCount();
          nextBtn && (nextBtn.disabled = getSelectedCount() === 0);
          updateSelectClearButtons();
        });

        prevBtn?.addEventListener('click', () => {
          if (currentPage > 1) {
            currentPage--;
            renderStep();
          }
        });

        nextPageBtn?.addEventListener('click', () => {
          if (currentPage < totalPages) {
            currentPage++;
            renderStep();
          }
        });

        document.querySelectorAll('.bc-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return;
            const cb = row.querySelector('.bc-cb');
            if (cb) {
              cb.checked = !cb.checked;
              cb.dispatchEvent(new Event('change'));
            }
          });
        });

        document.querySelectorAll('.bc-cb').forEach(cb => {
          cb.addEventListener('change', () => {
            const taskId = parseInt(cb.value);
            const row = cb.closest('.bc-row');
            if (cb.checked) {
              excluded.delete(taskId);
              row?.classList.remove('bc-row-off');
            } else {
              excluded.add(taskId);
              row?.classList.add('bc-row-off');
              userModified = true;
            }
            if (countEl) countEl.textContent = getSelectedCount();
            nextBtn && (nextBtn.disabled = getSelectedCount() === 0);
            updateSelectClearButtons();
          });
        });

        nextBtn?.addEventListener('click', () => {
          step = 2;
          renderStep();
        });
      } else {
        backBtn?.addEventListener('click', () => {
          step = 1;
          currentPage = 1;
          renderStep();
        });

        document.querySelectorAll('.bc-field-remove').forEach(btn => {
          btn.addEventListener('click', () => {
            const field = btn.dataset.field;
            selectedFields = selectedFields.filter(f => f.field !== field);
            delete fieldValues[field];
            renderStep();
          });
        });

        document.querySelectorAll('.bc-field-val').forEach(input => {
          input.addEventListener('input', () => {
            const field = input.dataset.field;
            const val = input.type === 'checkbox' ? input.checked : input.value;
            const item = selectedFields.find(f => f.field === field);
            if (item) item.value = val;
            fieldValues[field] = val;
            updateSummary();
          });
        });

        const addFieldBtn = overlay.querySelector('#bc-add-field');
        const fieldPicker = overlay.querySelector('#bc-field-picker');
        const fieldSearch = overlay.querySelector('#bc-field-search');
        const fieldList = overlay.querySelector('#bc-field-list');

        addFieldBtn?.addEventListener('click', () => {
          fieldPicker?.classList.toggle('hidden');
          if (!fieldPicker?.classList.contains('hidden')) {
            renderFieldList('');
            fieldSearch?.focus();
          }
        });

        fieldSearch?.addEventListener('input', () => {
          renderFieldList(fieldSearch.value);
        });

        function renderFieldList(query) {
          if (!fieldList) return;
          const q = query.toLowerCase();
          let html = '';
          for (const [groupKey, group] of Object.entries(FIELD_GROUPS)) {
            const groupLabel = group.label;
            const filteredFields = group.fields.filter(f => {
              if (selectedFields.some(sf => sf.field === f)) return false;
              if (q && !FIELD_LABELS_BULK[f].toLowerCase().includes(q)) return false;
              return true;
            });
            if (filteredFields.length === 0) continue;
            html += `<div style="grid-column:1/-1;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 2px 0;border-bottom:1px solid var(--border-color);margin-bottom:2px;">${groupLabel}</div>`;
            for (const f of filteredFields) {
              html += `<button class="bc-field-option" data-field="${f}" style="padding:6px 8px;font-size:12px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;text-align:left;">${FIELD_LABELS_BULK[f] || f}</button>`;
            }
          }
          fieldList.innerHTML = html || '<div style="grid-column:1/-1;padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">Ничего не найдено</div>';
          fieldList.querySelectorAll('.bc-field-option').forEach(opt => {
            opt.addEventListener('click', () => {
              const field = opt.dataset.field;
              if (!selectedFields.some(f => f.field === field)) {
                selectedFields.push({ field, value: '' });
                fieldValues[field] = '';
              }
              fieldPicker?.classList.add('hidden');
              renderStep();
            });
          });
        }

        nextBtn?.addEventListener('click', async () => {
          const fieldsPayload = {};
          let hasReason = true;
          for (const item of selectedFields) {
            if (item.value === '' || item.value === null || item.value === undefined) continue;
            fieldsPayload[item.field] = item.value;
            if (item.field === 'status_id') {
              const statusOpt = (window.app?.statuses || []).find(s => s.id == item.value);
              if (statusOpt && REQUIRES_REASON_STATUSES_BULK.includes(statusOpt.name) && !fieldsPayload.rejection_reason) {
                hasReason = false;
              }
            }
          }
          if (!hasReason) {
            if (!selectedFields.some(f => f.field === 'rejection_reason')) {
              selectedFields.push({ field: 'rejection_reason', value: '' });
              fieldValues['rejection_reason'] = '';
            }
            window.toast?.('Для выбранного статуса требуется указать причину отклонения', 'warning');
            renderStep();
            return;
          }
          if (Object.keys(fieldsPayload).length === 0) {
            window.toast?.('Добавьте хотя бы одно поле со значением', 'warning');
            return;
          }
          const selected = getSelectedCount();
          const confirmed = await showConfirmModal(
            `Применить изменения? У ${selected} ${pluralize(selected, 'задачи', 'задач', 'задач')} будет изменено: ${selectedFields.map(f => FIELD_LABELS_BULK[f.field]).join(', ')}.`,
            'Подтверждение',
            `Применить к ${selected} ${pluralize(selected, 'задаче', 'задачам', 'задачам')}`,
            'Отмена'
          );
          if (!confirmed) return;
          try {
            const result = await app.api.post('/tasks/bulk', {
              action: 'update',
              task_ids: tasks.filter(t => !excluded.has(t.id)).map(t => t.id),
              fields: fieldsPayload
            });
            closeBulkModal();
            resolve({ success: true, count: selected });
            window.toast?.(`Изменено ${selected} ${pluralize(selected, 'задача', 'задачи', 'задач')}`, 'success');
          } catch (e) {
            window.toast?.('Ошибка: ' + (e.message || 'Не удалось выполнить массовое изменение'), 'error');
            closeBulkModal();
            resolve({ success: false, error: e });
          }
        });
      }
    }

    function updateSummary() {
      const summaryEl = overlay.querySelector('#bc-summary');
      if (!summaryEl) return;
      const count = getSelectedCount();
      if (selectedFields.length === 0) {
        summaryEl.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Пока нечего применять — добавьте хотя бы одно поле со значением</span>';
      } else {
        summaryEl.innerHTML = `<span style="font-size:13px;">Будет изменено ${selectedFields.length} ${pluralize(selectedFields.length, 'поле', 'поля', 'полей')} у <strong>${count}</strong> ${pluralize(count, 'задачи', 'задач', 'задач')}: ${selectedFields.map(f => FIELD_LABELS_BULK[f.field] || f.field).join(', ')}</span>`;
      }
    }

    async function handleClose() {
      if (userModified || selectedFields.length > 0) {
        const confirmed = await showConfirmModal(
          'Закрыть без применения? Настройки массовой операции не сохранятся - выбор задач и добавленные поля будут сброшены.',
          'Закрыть без применения?',
          'Закрыть и сбросить',
          'Вернуться'
        );
        if (!confirmed) return;
      }
      closeBulkModal();
      resolve({ success: false });
    }

    document.body.appendChild(overlay);
    renderStep();
  });
}

export function importTasksFromExcel(app, onSuccess) {
  const existing = document.getElementById('import-tasks-overlay');
  if (existing) existing.remove();

  const DB_KEYS = [
    'id', 'title', 'description', 'date_received', 'channel_id', 'business_customer_id',
    'department_id', 'project_id', 'task_type_id', 'priority_id', 'status_id', 'deadline_id',
    'effort_days', 'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be',
    'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics', 'actual_effort_be',
    'actual_effort_fe', 'actual_effort_test', 'actual_effort_test_auto',
    'financial_effect', 'financial_effect_justification',
    'progress', 'link_mockups', 'link_jira', 'rejection_reason',
    'comment', 'owner_id', 'key_project_status', 'directorate_status',
    'did_status', 'did_demo', 'metric_kr_plan', 'metric_kr_fact',
    'involved_teams', 'created_by'
  ];

  function downloadTemplate() {
    const fieldLabels = window.app?.fieldLabels || {};
    const headerLabels = DB_KEYS.map(key => fieldLabels[key] || key);

    const exampleValues = {
      id: '',
      title: 'Пример задачи',
      description: 'Описание задачи',
      date_received: '2026-01-01',
      channel_id: '',
      business_customer_id: '',
      department_id: '',
      project_id: '',
      task_type_id: '',
      priority_id: '1',
      status_id: '1',
      deadline_id: '1',
      effort_days: '5',
      effort_rub: '100000',
      effort_designee: '',
      effort_analytics: '',
      effort_be: '',
      effort_python_be: '',
      effort_fe: '',
      effort_test: '',
      effort_test_auto: '',
      effort_delivery: '',
      actual_effort_days: '',
      actual_effort_designee: '',
      actual_effort_analytics: '',
      actual_effort_be: '',
      actual_effort_fe: '',
      actual_effort_test: '',
      actual_effort_test_auto: '',
      financial_effect: '1.5',
      financial_effect_justification: '',
      progress: '0',
      link_mockups: '',
      link_jira: '',
      rejection_reason: '',
      comment: '',
      owner_id: '',
      key_project_status: '',
      directorate_status: '',
      did_status: '',
      did_demo: 'false',
      metric_kr_plan: '',
      metric_kr_fact: '',
      involved_teams: '',
      created_by: ''
    };

    const header = headerLabels.join(';');
    const exampleRow = DB_KEYS.map(key => exampleValues[key] !== undefined ? exampleValues[key] : '').join(';');
    const csv = '\uFEFF' + header + '\n' + exampleRow + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'task_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const overlay = document.createElement('div');
  overlay.id = 'import-tasks-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="import-tasks-modal" style="background:var(--bg-primary);border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:90vh;overflow-y:auto;position:relative;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="margin:0;font-size:18px;color:var(--text-primary);">Импорт задач из Excel</h2>
        <button class="btn btn-ghost btn-sm" id="import-close-btn" style="padding:4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <a href="#" id="download-template-link" style="font-size:13px;color:var(--accent);text-decoration:none;display:flex;align-items:center;gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Скачать шаблон CSV
        </a>
      </div>

      <div id="import-drop-zone" style="border:2px dashed var(--border-color);border-radius:8px;padding:32px;text-align:center;cursor:pointer;margin-bottom:16px;transition:all 0.2s;">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p style="margin:0 0 8px 0;color:var(--text-primary);font-size:14px;">Перетащите CSV файл сюда или нажмите для выбора</p>
        <p style="margin:0;color:var(--text-muted);font-size:12px;">Поддерживается только формат CSV</p>
        <input type="file" id="import-file-input" accept=".csv" style="display:none;">
      </div>

      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
        <input type="checkbox" id="import-first-row-header" checked style="margin:0;">
        Первая строка содержит заголовки
      </label>

      <div id="import-preview-section" style="display:none;margin-bottom:16px;">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Preview (первые 5 строк):</div>
        <div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;max-height:200px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead id="import-preview-thead" style="position:sticky;top:0;background:var(--bg-tertiary);"></thead>
            <tbody id="import-preview-tbody"></tbody>
          </table>
        </div>
      </div>

      <div id="import-error-summary" style="display:none;margin-bottom:16px;padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;">
        <div style="font-size:13px;color:var(--danger);font-weight:600;margin-bottom:8px;">Ошибки при проверке:</div>
        <ul id="import-error-list" style="margin:0;padding-left:20px;font-size:12px;color:var(--danger);"></ul>
      </div>

      <div id="import-result" style="display:none;margin-bottom:16px;padding:16px;border-radius:8px;">
        <div id="import-result-content" style="font-size:14px;"></div>
      </div>

      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button class="btn btn-secondary btn-sm" id="import-cancel-btn" style="padding:8px 16px;">Отмена</button>
        <button class="btn btn-primary btn-sm" id="import-submit-btn" disabled style="padding:8px 16px;">Импортировать</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let selectedFile = null;
  let previewData = null;
  let errors = [];

  const closeImportModal = () => {
    overlay.classList.add('modal-closing');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#import-close-btn').addEventListener('click', closeImportModal);
  overlay.querySelector('#import-cancel-btn').addEventListener('click', closeImportModal);
  overlay.querySelector('#download-template-link').addEventListener('click', (e) => {
    e.preventDefault();
    downloadTemplate();
  });

  const dropZone = overlay.querySelector('#import-drop-zone');
  const fileInput = overlay.querySelector('#import-file-input');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent)';
    dropZone.style.background = 'color-mix(in srgb, var(--accent) 5%, transparent)';
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border-color)';
    dropZone.style.background = 'transparent';
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-color)';
    dropZone.style.background = 'transparent';
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      handleFile(file);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      parseAndPreview(content);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function parseAndPreview(content) {
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    const firstRowHeader = overlay.querySelector('#import-first-row-header').checked;
    const delimiter = content.includes(';') ? ';' : ',';

    const rows = [];
    for (const line of lines) {
      const cells = [];
      let inQuotes = false;
      let current = '';
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim());
      rows.push(cells);
    }

    const headers = firstRowHeader ? rows[0] : rows[0].map((_, i) => `Колонка ${i + 1}`);
    const dataRows = firstRowHeader ? rows.slice(1) : rows;

    previewData = { headers, rows: dataRows, delimiter };
    errors = validateData(dataRows, headers);

    renderPreview();
    renderErrors();

    overlay.querySelector('#import-submit-btn').disabled = errors.length > 0;
  }

  function validateData(dataRows, headers) {
    const errs = [];
    const titleIdx = headers.findIndex(h => h.toLowerCase() === 'title');
    const teamIdIdx = headers.findIndex(h => h.toLowerCase() === 'team_id');
    const idIdx = headers.findIndex(h => h.toLowerCase() === 'id');

    if (titleIdx === -1) {
      errs.push('Отсутствует обязательная колонка "title"');
    }
    if (teamIdIdx === -1) {
      errs.push('Отсутствует обязательная колонка "team_id"');
    }

    dataRows.slice(0, 20).forEach((row, i) => {
      const rowNum = i + 2;
      if (idIdx !== -1 && row[idIdx]) {
        const id = parseInt(row[idIdx]);
        if (!isNaN(id) && id > 0) {
          errs.push({ row: rowNum, id, message: `Задача с ID ${id} уже существует` });
        }
      }
    });

    return errs;
  }

  function renderPreview() {
    const previewSection = overlay.querySelector('#import-preview-section');
    const thead = overlay.querySelector('#import-preview-thead');
    const tbody = overlay.querySelector('#import-preview-tbody');

    if (!previewData) {
      previewSection.style.display = 'none';
      return;
    }

    previewSection.style.display = 'block';
    thead.innerHTML = `<tr>${previewData.headers.map(h => `<th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--border-color);white-space:nowrap;">${escapeHtml(h)}</th>`).join('')}</tr>`;

    const previewRows = previewData.rows.slice(0, 5);
    tbody.innerHTML = previewRows.map(row => {
      const idIdx = previewData.headers.findIndex(h => h.toLowerCase() === 'id');
      const isConflict = idIdx !== -1 && row[idIdx] && parseInt(row[idIdx]) > 0;
      return `<tr style="background:${isConflict ? 'rgba(245,158,11,0.1)' : 'transparent'};">
        ${row.map((cell, i) => `<td style="padding:6px 12px;border-bottom:1px solid var(--border-color);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(cell || '')}</td>`).join('')}
      </tr>`;
    }).join('');
  }

  function renderErrors() {
    const errorSummary = overlay.querySelector('#import-error-summary');
    const errorList = overlay.querySelector('#import-error-list');

    if (errors.length === 0) {
      errorSummary.style.display = 'none';
      return;
    }

    errorSummary.style.display = 'block';
    const generalErrors = errors.filter(e => typeof e === 'string');
    const rowErrors = errors.filter(e => typeof e === 'object');

    let html = '';
    if (generalErrors.length > 0) {
      html += generalErrors.map(e => `<li>${escapeHtml(e)}</li>`).join('');
    }
    if (rowErrors.length > 0) {
      rowErrors.slice(0, 10).forEach(e => {
        html += `<li>Строка ${e.row}: ${escapeHtml(e.message)}</li>`;
      });
      if (rowErrors.length > 10) {
        html += `<li>... и ещё ${rowErrors.length - 10} ошибок</li>`;
      }
    }
    errorList.innerHTML = html;
  }

  overlay.querySelector('#import-first-row-header').addEventListener('change', () => {
    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = (e) => parseAndPreview(e.target.result);
      reader.readAsText(selectedFile, 'UTF-8');
    }
  });

  overlay.querySelector('#import-submit-btn').addEventListener('click', async () => {
    if (!selectedFile || !previewData) return;

    const btn = overlay.querySelector('#import-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Импорт...';

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const result = await app.api.post('/tasks/import', formData, true);

      const resultDiv = overlay.querySelector('#import-result');
      resultDiv.style.display = 'block';

      let html = `<div style="color:var(--success);font-weight:600;">Импорт завершён!</div>`;
      html += `<div style="margin-top:8px;">Создано задач: <strong>${result.created}</strong></div>`;
      if (result.updated > 0) {
        html += `<div>Обновлено: <strong>${result.updated}</strong></div>`;
      }
      if (result.errors && result.errors.length > 0) {
        html += `<div style="margin-top:8px;color:var(--danger);">Ошибок: <strong>${result.errors.length}</strong></div>`;
        html += `<ul style="margin:8px 0 0 0;padding-left:20px;font-size:12px;max-height:100px;overflow-y:auto;">`;
        result.errors.slice(0, 5).forEach(e => {
          html += `<li>Строка ${e.row}: ${escapeHtml(e.message)}</li>`;
        });
        if (result.errors.length > 5) {
          html += `<li>... и ещё ${result.errors.length - 5} ошибок</li>`;
        }
        html += `</ul>`;
      }

      overlay.querySelector('#import-result-content').innerHTML = html;

      if (result.errors && result.errors.length === 0) {
        setTimeout(() => {
          closeImportModal();
          if (onSuccess) onSuccess();
        }, 1500);
      }
    } catch (e) {
      window.toast?.('Ошибка импорта: ' + (e.message || 'Неизвестная ошибка'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Импортировать';
    }
  });
}
