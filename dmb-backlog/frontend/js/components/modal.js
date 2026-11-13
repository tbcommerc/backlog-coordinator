import { pagination as kitPagination } from '../ui/forms.js';
import { taskStatusTone, taskPriorityTone } from '../taskDisplay.js';
import { badge as uiBadge } from '../ui/primitives.js';
import { mountRelations } from './workRelations.js?v=3';
import { mountWorkList } from './workTasks.js?v=25';
import { csvRows, downloadCsv, parseCsvRows, decodeCsvContent } from '../taskCsv.js';
import { createPopover } from '../ui/popover.js';
import { bindTooltip } from '../ui/tooltip.js';
import { safeExternalUrl } from '../urlUtils.js';
import { avatar as uiAvatar, tag as uiTag, progress as uiProgress } from '../ui/dataDisplay.js';
import { renderAttachments } from './taskAttachments.js?v=3';
import { focusCommentTarget, renderComments, renderMentionOptions } from './taskComments.js?v=4';
import { formatTaskPublicId } from '../taskPublicId.js';
import { calculateCv, calculateTaskCv, cvZone } from '../taskMetrics.js';
import { highlightSearchText } from '../htmlUtils.js';
import { getTaskCommentPermission, getTaskEditPermission } from '../taskCardPermissions.js';
import { buildCompetencyRateTable, competencyRateForYear, deadlineYearFromReference } from '../taskCardRates.js';
import { createTaskCardRequestGate } from '../taskCardRequestGate.js';
import { createTaskCommentDraftSession, parseCommentTarget } from '../taskCommentDraft.js';
import { renderTaskCardMarkdown } from '../taskCardMarkdown.js';
import { button as uiButton, control as uiControl, fieldFrame as uiFieldFrame, tab as uiTab } from '../ui/primitives.js';
import { setButtonBusy, tabNavigationTarget } from '../ui/controls.js';
import { descriptionList as uiDescriptionList, sectionCard as uiSectionCard } from '../ui/detailComponents.js';
import { renderViewState } from './viewState.js';
import { enhanceDialogOverlay } from '../modalAccessibility.js';
import { taskNumber, sumTaskMeasurements, taskMeasurementCost, sumTaskCosts } from '../taskCardNumbers.js';

// === DMB Backlog — Подробная карточка задачи (Master-Detail) ===
// === Референс: Карточка задачи - референс.html ===
// === 24 атрибута, 6 табов, KPI Strip, связь с БД ===

// === STATE ===
let currentTask = null;
let modalMode = 'view';
let currentModal = null;
let onSaveCallback = null;
let _createTaskContext = {};
let _createTaskDirty = false;
let _createTaskInitialSnapshot = '';
let _createTaskSaving = false;
let _createReferenceUsers = [];
const CREATE_TASK_DRAFT_VERSION = 1;
const EDIT_TASK_DRAFT_VERSION = 1;
let _discardPromptPromise = null;
let _taskBeforeUnloadBound = false;
let _taskExternalLinkGuardBound = false;
let _taskFocusTrapRoot = null;
let _taskFocusTrapHandler = null;
let _taskModalReturnFocus = null;
let _taskModalBaseDocumentTitle = null;
let _createTaskKeyHandler = null;
let _createTaskRequestId = null;
let _statusProgressSuggestionPending = false;
let _createDuplicateOverrideSignature = null;
let _cardSaveRequestId = null;
let _cardQuickSaveTimer = null;
let _taskNetworkStateBound = false;
let _taskRealtimeBound = false;
const _taskCardRequestGate = createTaskCardRequestGate();
const _taskCommentDraftSession = createTaskCommentDraftSession();
let _commentTargetHandled = null;
let _cardReadStates = {};

function cardReadState(kind) {
  return _cardReadStates[kind] ||= { loading: false, loaded: false, error: '' };
}

function cardReadFeedback(kind, subject) {
  const state = cardReadState(kind);
  if (state.loading) return renderViewState({ kind: 'loading', scope: 'partial', title: 'Загружаем ' + subject + '…' });
  if (!state.error) return '';
  return renderViewState({ kind: state.loaded ? 'stale' : 'error', scope: 'partial',
    title: state.loaded ? 'Не удалось обновить ' + subject : 'Не удалось загрузить ' + subject,
    message: state.loaded ? 'Показаны ранее загруженные данные. Повторите обновление.' : 'Проверьте подключение и повторите попытку.',
    actionLabel: 'Повторить', actionAttrs: { 'data-action': 'retry-card-read', 'data-read-kind': kind } });
}

async function cardReadRequest(kind, taskId, operation, onSuccess, render) {
  const state = cardReadState(kind);
  if (state.loading || !cardMatchesCurrentTask(taskId)) return;
  const request = _taskCardRequestGate.start(kind, taskId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  state.loading = true;
  state.error = '';
  render();
  try {
    const result = await Promise.race([operation(controller.signal), new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Read cancelled or timed out')), { once: true });
    })]);
    if (!_taskCardRequestGate.isCurrent(request.token, taskId) || !cardMatchesCurrentTask(taskId)) return;
    onSuccess(result);
    state.loaded = true;
  } catch (error) {
    if (request.signal.aborted || !_taskCardRequestGate.isCurrent(request.token, taskId) || !cardMatchesCurrentTask(taskId)) return;
    state.error = 'read-failed';
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
    if (_taskCardRequestGate.finish(request.token) && cardMatchesCurrentTask(taskId)) {
      state.loading = false;
      render();
    }
  }
}

function newTaskRequestId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isTaskNetworkOffline() {
  return navigator.onLine === false;
}

function updateTaskNetworkState() {
  const offline = isTaskNetworkOffline();
  document.querySelectorAll('.task-network-status').forEach(status => {
    status.hidden = !offline;
    status.textContent = offline ? 'Нет подключения' : '';
  });
  document.querySelectorAll('.form-error-retry').forEach(button => { button.disabled = offline; });
  if (document.getElementById('create-task-overlay')) updateCreateFormReadiness();
  const cardSaveButton = document.getElementById('saveBtn');
  if (cardSaveButton) {
    cardSaveButton.disabled = offline || cardState.saving || (cardState.editing && !cardState.dirty);
    cardSaveButton.setAttribute('aria-disabled', cardSaveButton.disabled ? 'true' : 'false');
  }
}

function ensureTaskNetworkState() {
  if (!_taskNetworkStateBound) {
    window.addEventListener('online', updateTaskNetworkState);
    window.addEventListener('offline', updateTaskNetworkState);
    _taskNetworkStateBound = true;
  }
  updateTaskNetworkState();
}

function setTaskModalDocumentTitle(task) {
  if (!task?.id) return;
  if (_taskModalBaseDocumentTitle === null) {
    _taskModalBaseDocumentTitle = document.title || 'Backlog Coordinator';
  }
  const rawTitle = String(task.title || task.name || 'Без названия').trim() || 'Без названия';
  const compactTitle = rawTitle.length > 70 ? `${rawTitle.slice(0, 67)}…` : rawTitle;
  document.title = `${formatTaskPublicId(task)} · ${compactTitle} — ${_taskModalBaseDocumentTitle}`;
}

function restoreTaskModalDocumentTitle() {
  if (_taskModalBaseDocumentTitle === null) return;
  document.title = _taskModalBaseDocumentTitle;
  _taskModalBaseDocumentTitle = null;
}

function hasUnsavedTaskChanges() {
  return Boolean(
    cardState?.dirty
    || cardReportingDirtyCount()
    || _taskCommentDraftSession.hasChanges(currentTask?.id)
    || _createTaskDirty
  );
}

function ensureTaskBeforeUnloadGuard() {
  if (_taskBeforeUnloadBound) return;
  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedTaskChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  _taskBeforeUnloadBound = true;
}

function renderExternalTaskChangeBanner(detail) {
  const body = document.getElementById('mbody') || document.getElementById('td-tiles-container');
  if (!body || !currentTask?.id) return;
  let banner = document.getElementById('td-external-update-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'td-external-update-banner';
    banner.className = 'alert alert-warning';
    banner.setAttribute('role', 'status');
    body.prepend(banner);
  }
  const hasDraft = modalMode === 'edit'
    || cardState.dirty
    || cardReportingDirtyCount() > 0
    || _taskCommentDraftSession.hasChanges(currentTask?.id);
  banner.innerHTML = hasDraft
    ? '<strong>Задача изменена другим пользователем.</strong> Ваш черновик сохранён. При сохранении откроется сравнение версий — не перезагружайте карточку.'
    : '<strong>Задача изменилась.</strong> <button type="button" class="btn btn-sm btn-secondary" id="td-reload-external-task">Загрузить актуальную версию</button>';
  if (!hasDraft) {
    document.getElementById('td-reload-external-task')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const taskId = Number(currentTask?.id);
      const overlay = document.getElementById('task-detail-overlay');
      const api = window.app?.api;
      if (!api || !cardMatchesCurrentTask(taskId)) return;
      const request = _taskCardRequestGate.start('external-task-reload', taskId);
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        const fresh = await api.get(`/tasks/${taskId}`, { signal: request.signal });
        if (!_taskCardRequestGate.isCurrent(request.token, taskId)
          || !cardMatchesCurrentTask(taskId)
          || Number(fresh?.id) !== taskId
          || overlay !== document.getElementById('task-detail-overlay')) return;
        stopLockPolling();
        stopViewerPolling();
        unregisterViewer(taskId);
        deactivateTaskModalFocusTrap();
        overlay?.remove();
        if (currentModal === overlay) currentModal = null;
        openTaskModal(fresh);
      } catch (error) {
        if (request.signal.aborted || error?.name === 'AbortError' || !_taskCardRequestGate.isCurrent(request.token, taskId)) return;
        window.toast?.(window.formatErrorMessage?.(error) || 'Не удалось обновить карточку', 'error');
      } finally {
        _taskCardRequestGate.finish(request.token);
        if (button.isConnected) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        }
      }
    });
  }
}

function ensureTaskRealtimeEvents() {
  if (_taskRealtimeBound) return;
  document.addEventListener('dmb:session-ended',revokeTaskModalAccess);
  document.addEventListener('dmb:task-changed', event => {
    const detail = event.detail || {};
    const aggregate = detail.aggregate || {};
    if (!currentTask?.id || Number(aggregate.id) !== Number(currentTask.id)) return;
    if (detail.type === 'task.activity.changed') {
      const activity = detail.payload?.activity;
      if (activity === 'comment') loadComments(currentTask.id, window.app);
      if (activity === 'attachment') loadAttachments(currentTask.id, window.app);
      return;
    }
    const incomingVersion = Number(aggregate.version);
    if (Number.isFinite(incomingVersion) && incomingVersion <= Number(currentTask.version || 0)) return;
    renderExternalTaskChangeBanner(detail);
  });
  _taskRealtimeBound = true;
}

function ensureTaskExternalLinkGuard() {
  if (_taskExternalLinkGuardBound) return;
  document.addEventListener('click', async event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || !hasUnsavedTaskChanges()) return;
    let destination;
    try { destination = new URL(link.href, window.location.href); } catch (_) { return; }
    if (!/^https?:$/.test(destination.protocol) || destination.origin === window.location.origin) return;
    event.preventDefault();
    if (cardState.saving || _createTaskSaving || _commentSubmitting) {
      window.toast?.(_commentSubmitting ? 'Дождитесь завершения отправки комментария' : 'Дождитесь завершения сохранения', 'info');
      return;
    }
    const confirmed = await confirmTaskCardDiscard('Есть несохранённые изменения. Открыть внешнюю ссылку?');
    if (!confirmed) return;
    const opensSeparately = link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey;
    if (opensSeparately) {
      window.open(destination.href, '_blank', 'noopener,noreferrer');
      return;
    }
    const createOverlay = document.getElementById('create-task-overlay');
    const taskOverlay = document.getElementById('task-detail-overlay');
    if (createOverlay) closeCreateTaskModal();
    if (taskOverlay) {
      clearCardEditDraft();
      closeTaskDetailModal();
    }
    window.location.assign(destination.href);
  }, true);
  _taskExternalLinkGuardBound = true;
}

function activateTaskModalFocusTrap(root) {
  deactivateTaskModalFocusTrap();
  _taskFocusTrapRoot = root;
  _taskFocusTrapHandler = event => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const activeDialog = document.getElementById('confirm-modal-overlay')
      || document.getElementById('card-conflict-overlay')
      || document.getElementById('prioritiser-requirements-overlay')
      || _taskFocusTrapRoot;
    if (!activeDialog?.isConnected) return;
    const focusable = Array.from(activeDialog.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', _taskFocusTrapHandler);
}

function deactivateTaskModalFocusTrap() {
  if (_taskFocusTrapHandler) document.removeEventListener('keydown', _taskFocusTrapHandler);
  _taskFocusTrapHandler = null;
  _taskFocusTrapRoot = null;
}

function rememberTaskModalReturnFocus(taskId = null) {
  const active = document.activeElement;
  const taskElement = taskId != null
    ? document.querySelector(`[data-id="${Number(taskId)}"], [data-task-id="${Number(taskId)}"]`)
    : null;
  _taskModalReturnFocus = {
    element: active && active !== document.body ? active : taskElement,
    taskId: taskId == null ? null : Number(taskId),
  };
}

function takeTaskModalReturnFocus() {
  const context = _taskModalReturnFocus;
  _taskModalReturnFocus = null;
  return context;
}

function restoreTaskModalReturnFocus(context) {
  if (!context || document.getElementById('task-detail-overlay') || document.getElementById('create-task-overlay')) return;
  let target = context.element?.isConnected ? context.element : null;
  if (!target && Number.isFinite(context.taskId)) {
    target = document.querySelector(`[data-id="${context.taskId}"], [data-task-id="${context.taskId}"]`);
  }
  if (!target && /^#\/backlog(?:\?|$)/.test(window.location.hash)) target=document.getElementById('tasks-count')||document.getElementById('tasks-container');
  if (!target) return;
  const hadTabindex = target.hasAttribute('tabindex');
  if (!hadTabindex && !target.matches('button, a[href], input, select, textarea')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest' });
  if (!hadTabindex) target.addEventListener('blur',()=>target.removeAttribute('tabindex'),{once:true});
}

function createTaskFormSnapshot() {
  const overlay = document.getElementById('create-task-overlay');
  if (!overlay) return '';
  return JSON.stringify(Array.from(overlay.querySelectorAll('input, select, textarea')).filter(control => !control.classList.contains('dict-search-input')).map(control => [
    control.id,
    control.type === 'checkbox' ? control.checked : control.value,
  ]));
}

function createTaskDraftStorageKey() {
  const userId = window.app?.store?.get('currentUser')?.id || 'anonymous';
  return `dmb:create-task-draft:v${CREATE_TASK_DRAFT_VERSION}:user:${userId}`;
}

function updateCreateDraftSavedStatus(savedAt = null) {
  const status = document.getElementById('create-draft-saved-status');
  if (!status) return;
  if (!savedAt) {
    status.hidden = true;
    status.textContent = '';
    return;
  }
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return;
  status.textContent = `Черновик сохранён в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  status.hidden = false;
}

function saveCreateTaskDraft() {
  const snapshot = createTaskFormSnapshot();
  if (!snapshot || snapshot === _createTaskInitialSnapshot) {
    clearCreateTaskDraft();
    return;
  }
  try {
    const savedAt = new Date().toISOString();
    localStorage.setItem(createTaskDraftStorageKey(), JSON.stringify({ snapshot, savedAt }));
    updateCreateDraftSavedStatus(savedAt);
  } catch (_) { /* localStorage can be unavailable in private/restricted mode */ }
}

function clearCreateTaskDraft() {
  try { localStorage.removeItem(createTaskDraftStorageKey()); } catch (_) { /* no-op */ }
  updateCreateDraftSavedStatus();
}

function applyCreateTaskSnapshot(snapshot) {
  try {
    const values = JSON.parse(snapshot);
    if (!Array.isArray(values)) return false;
    values.forEach(([id, value]) => {
      const control = document.getElementById(id);
      if (!control) return;
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else if (control.tagName !== 'SELECT' || Array.from(control.options).some(option => option.value === String(value))) control.value = value ?? '';
    });
    return true;
  } catch (_) {
    return false;
  }
}

function restoreCreateTaskDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(createTaskDraftStorageKey()) || 'null');
    if (!draft?.snapshot || !applyCreateTaskSnapshot(draft.snapshot)) return false;
    updateCreateDraftSavedStatus(draft.savedAt);
    return createTaskFormSnapshot() !== _createTaskInitialSnapshot;
  } catch (_) {
    clearCreateTaskDraft();
    return false;
  }
}

function updateCreateTaskDirty() {
  _createTaskDirty = createTaskFormSnapshot() !== _createTaskInitialSnapshot;
  updateHeaderUnsavedIndicator('create-unsaved-indicator', _createTaskDirty, _createTaskSaving, createTaskChangedFieldNames().length);
  saveCreateTaskDraft();
}

function updateHeaderUnsavedIndicator(id, dirty, saving = false, count = 0) {
  const indicator = document.getElementById(id);
  if (!indicator) return;
  indicator.hidden = !dirty && !saving;
  indicator.classList.toggle('is-saving', saving);
  indicator.innerHTML = `<i aria-hidden="true"></i>${saving ? 'Сохраняем…' : `Не сохранено${count ? ` · ${count}` : ''}`}`;
}

function taskTitleSimilarity(left, right) {
  const normalize = value => String(value || '').toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
  const a = normalize(left), b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const bigrams = value => {
    const result = new Map();
    for (let i = 0; i < value.length - 1; i++) result.set(value.slice(i, i + 2), (result.get(value.slice(i, i + 2)) || 0) + 1);
    return result;
  };
  const aa = bigrams(a), bb = bigrams(b);
  let overlap = 0;
  aa.forEach((count, pair) => { overlap += Math.min(count, bb.get(pair) || 0); });
  return (2 * overlap) / Math.max(1, a.length + b.length - 2);
}

function showCreateDuplicateWarning(tasks) {
  return new Promise(resolve => {
    document.getElementById('confirm-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1200';
    const dialog = document.createElement('div');
    dialog.className = 'create-duplicate-dialog app-modal app-modal--medium';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'create-duplicate-title');
    const title = document.createElement('h3');
    title.id = 'create-duplicate-title';
    title.textContent = 'Возможные дубликаты';
    const text = document.createElement('p');
    text.textContent = 'Найдены задачи с похожими названиями. Проверьте их перед созданием новой.';
    const list = document.createElement('div');
    list.className = 'create-duplicate-list';
    const currentPath = window.location.hash.slice(1).split('?')[0] || '/backlog';
    tasks.forEach(task => {
      const link = document.createElement('a');
      link.className = 'create-duplicate-item';
      const params=new URLSearchParams(window.location.hash.split('?')[1]||'');params.set('task',String(task.id));
      link.href = `#${currentPath}?${params.toString()}`;
      link.target = '_blank';
      link.rel = 'noopener';
      const id = document.createElement('b');
      id.textContent = formatTaskPublicId(task);
      const name = document.createElement('span');
      name.textContent = task.title || 'Без названия';
      link.append(id, name);
      list.appendChild(link);
    });
    const actions = document.createElement('div');
    actions.className = 'create-duplicate-actions';
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'btn btn-secondary btn-sm'; back.textContent = 'Вернуться к названию';
    const proceed = document.createElement('button');
    proceed.type = 'button'; proceed.className = 'btn btn-primary btn-sm'; proceed.textContent = 'Всё равно создать';
    actions.append(back, proceed);
    const header = document.createElement('div');
    header.className = 'app-modal__header';
    header.appendChild(title);
    const body = document.createElement('div');
    body.className = 'app-modal__body';
    body.append(text, list);
    actions.classList.add('app-modal__footer');
    dialog.append(header, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const finish = result => { overlay.remove(); document.removeEventListener('keydown', onKeydown); resolve(result); };
    const onKeydown = event => { if (event.key === 'Escape') finish(false); };
    back.addEventListener('click', () => finish(false));
    proceed.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(false); });
    document.addEventListener('keydown', onKeydown);
    back.focus();
  });
}

async function confirmCreateTaskIsNotDuplicate(app, title) {
  const signature = String(title || '').trim().toLocaleLowerCase('ru-RU');
  if (!signature || signature === _createDuplicateOverrideSignature) return true;
  const words = signature.split(/\s+/).filter(word => word.length >= 4).sort((a, b) => b.length - a.length);
  const query = words[0] || signature;
  try {
    const api = app?.api || window.app?.api;
    const result = await api.get(`/tasks/?search=${encodeURIComponent(query)}&page=1&per_page=50`);
    const candidates = (result?.items || [])
      .map(task => ({ ...task, similarity: taskTitleSimilarity(signature, task.title) }))
      .filter(task => task.similarity >= 0.48)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
    if (!candidates.length) return true;
    const proceed = await showCreateDuplicateWarning(candidates);
    if (proceed) _createDuplicateOverrideSignature = signature;
    return proceed;
  } catch (error) {
    console.warn('Duplicate task check failed:', error);
    return true;
  }
}

function cardEditDraftStorageKey(taskId = currentTask?.id) {
  const userId = window.app?.store?.get('currentUser')?.id || 'anonymous';
  return `dmb:edit-task-draft:v${EDIT_TASK_DRAFT_VERSION}:user:${userId}:task:${taskId}`;
}

function saveCardEditDraft() {
  if (!cardState.editing || !cardState.dirty || !cardState.draft || !currentTask?.id) return;
  try {
    localStorage.setItem(cardEditDraftStorageKey(), JSON.stringify({
      taskVersion: currentTask.version || 0,
      draft: cardState.draft,
      savedAt: new Date().toISOString(),
    }));
  } catch (_) { /* localStorage can be unavailable in private/restricted mode */ }
}

function clearCardEditDraft(taskId = currentTask?.id) {
  if (!taskId) return;
  try { localStorage.removeItem(cardEditDraftStorageKey(taskId)); } catch (_) { /* no-op */ }
}

function restoreCardEditDraft() {
  if (!currentTask?.id) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(cardEditDraftStorageKey()) || 'null');
    if (!saved?.draft) return false;
    if (Number(saved.taskVersion || 0) !== Number(currentTask.version || 0)) {
      clearCardEditDraft();
      cardToast('Черновик редактирования устарел и не был восстановлен', 'warn');
      return false;
    }
    cardState.draft = saved.draft;
    cardState.dirty = cardDiffChanges(cardState.current, cardState.draft).length > 0;
    return cardState.dirty;
  } catch (_) {
    clearCardEditDraft();
    return false;
  }
}

function createRequiredControls() {
  return Object.values(TASK_FORM_SCHEMA)
    .filter(field => field.required)
    .map(field => document.getElementById(field.createId))
    .filter(Boolean);
}

function updateCreateFormReadiness(changedControl = null) {
  const requiredControls = createRequiredControls();
  requiredControls.forEach(control => {
    const empty = !String(control.value || '').trim();
    if (control === changedControl || !empty) {
      control.classList.toggle('input-error', empty);
      control.setAttribute('aria-invalid', empty ? 'true' : 'false');
      const error = document.getElementById(control.id + '-error');
      if (error) error.hidden = !empty;
    }
  });
  const ready = requiredControls.length > 0 && requiredControls.every(control => String(control.value || '').trim());
  const saveButton = document.getElementById('create-save-btn');
  if (saveButton) {
    saveButton.disabled = !ready || _createTaskSaving || isTaskNetworkOffline();
    saveButton.setAttribute('aria-disabled', ready && !_createTaskSaving && !isTaskNetworkOffline() ? 'false' : 'true');
    saveButton.title = ready ? '' : 'Заполните обязательные поля';
  }
  return ready;
}

function attachDictionarySearch(root, configs) {
  configs.forEach(({ selector, label, preferredValues = null }) => {
    const select = root?.querySelector(selector);
    if (!select || select.closest('.dict-search-control')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'dict-search-control';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dict-combobox-trigger ui-control';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', label);
    const panel = document.createElement('div');
    panel.className = 'dict-search-popover';
    panel.hidden = true;
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'dict-search-input ui-control';
    search.placeholder = 'Поиск…';
    search.setAttribute('aria-label', `Поиск: ${label}`);
    const optionsList = document.createElement('div');
    optionsList.className = 'dict-search-options';
    optionsList.setAttribute('role', 'listbox');
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger, panel);
    panel.append(search);
    select.classList.add('dict-native-select');
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const originalOptions = Array.from(select.options).map(option => ({
      value: option.value,
      text: option.textContent || '',
      disabled: option.disabled,
    }));
    let teamValues = new Set((preferredValues || []).map(String));
    let showAll = !preferredValues;
    let scopeButton = null;
    if (preferredValues) {
      scopeButton = document.createElement('button');
      scopeButton.type = 'button';
      scopeButton.className = 'ui-link dict-search-scope';
      panel.append(scopeButton);
    }
    panel.append(optionsList);
    const selectedText = () => originalOptions.find(option => option.value === select.value)?.text || select.value || 'Не выбрано';
    const updateTrigger = () => {
      trigger.innerHTML = '<span>' + escapeHtml(selectedText()) + '</span><span class="dict-combobox-chevron" aria-hidden="true">⌄</span>';
    };
    const closePanel = () => {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      search.value = '';
    };
    const openPanel = () => {
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      renderOptions('');
      requestAnimationFrame(() => search.focus());
    };
    const renderOptions = query => {
      const selectedValue = select.value;
      const normalized = String(query || '').trim().toLocaleLowerCase('ru-RU');
      const matches = option => !normalized || option.text.toLocaleLowerCase('ru-RU').includes(normalized);
      const visible = originalOptions.filter((option, index) => {
        if ((index === 0 && option.value === '') || option.value === selectedValue) return true;
        if (normalized) return matches(option);
        return showAll || teamValues.has(option.value);
      }).sort((a, b) => {
        if (!showAll || normalized) return 0;
        return Number(teamValues.has(b.value)) - Number(teamValues.has(a.value));
      });
      optionsList.innerHTML = visible.length
        ? visible.map(option => '<button type="button" class="btn btn-secondary btn-sm ui-btn dict-search-option' + (option.value === selectedValue ? ' is-selected' : '') + '" role="option" aria-selected="' + (option.value === selectedValue ? 'true' : 'false') + '" data-value="' + escapeHtml(option.value) + '"' + (option.disabled ? ' disabled' : '') + '>' + escapeHtml(option.text) + '</button>').join('')
        : '<div class="dict-search-empty">Ничего не найдено</div>';
      if (scopeButton) scopeButton.textContent = showAll ? 'Только моя команда' : `Показать всех · ${originalOptions.filter(option => option.value !== '').length}`;
    };
    select._dictionarySearchRefresh = values => {
      teamValues = new Set((values || []).map(String));
      showAll = false;
      search.value = '';
      renderOptions('');
    };
    search.addEventListener('input', () => renderOptions(search.value));
    select.addEventListener('change', () => {
      updateTrigger();
    });
    trigger.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
    trigger.addEventListener('keydown', event => {
      if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openPanel();
    });
    optionsList.addEventListener('click', event => {
      const option = event.target.closest('.dict-search-option');
      if (!option || option.disabled) return;
      select.value = option.dataset.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closePanel();
      trigger.focus();
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); trigger.focus(); return; }
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      optionsList.querySelector('.dict-search-option:not([disabled])')?.focus();
    });
    optionsList.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); trigger.focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const options = Array.from(optionsList.querySelectorAll('.dict-search-option:not([disabled])'));
      const index = options.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
      event.preventDefault();
      options[next]?.focus();
    });
    scopeButton?.addEventListener('click', () => {
      showAll = !showAll;
      renderOptions(search.value);
    });
    const onDocumentPointer = event => {
      if (!wrapper.isConnected) { document.removeEventListener('pointerdown', onDocumentPointer, true); return; }
      if (!wrapper.contains(event.target)) closePanel();
    };
    document.addEventListener('pointerdown', onDocumentPointer, true);
    updateTrigger();
    renderOptions('');
  });
}

function userValuesForTeam(users, teamId, useNames = false) {
  if (teamId == null || teamId === '') return [];
  return (users || [])
    .filter(user => Number(user.team_id) === Number(teamId))
    .map(user => useNames ? (user.name || user.login || user.email || '') : String(user.id))
    .filter(Boolean);
}

function showTaskFormErrorSummary(summaryId, message, target) {
  const summary = document.getElementById(summaryId);
  if (!summary) return;
  summary.hidden = false;
  summary.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  summary.appendChild(text);
  if (target) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'ui-link form-error-summary-link';
    link.textContent = 'Перейти к полю';
    link.addEventListener('click', () => {
      focusTaskFormErrorTarget(target);
    });
    summary.appendChild(link);
  }
  summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function focusTaskFormErrorTarget(target) {
  if (!target) return;
  const highlight = target.closest('.icell, .field, .task-title-card, .task-desc, .b-edit-field') || target;
  highlight.classList.remove('task-error-attention');
  void highlight.offsetWidth;
  highlight.classList.add('task-error-attention');
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  window.setTimeout(() => target.focus({ preventScroll: true }), 260);
  window.setTimeout(() => highlight.classList.remove('task-error-attention'), 2200);
}

function clearTaskFormErrorSummary(summaryId) {
  const summary = document.getElementById(summaryId);
  if (summary) summary.hidden = true;
}

function isRetryableTaskSaveError(error) {
  const status = Number(error?.status || 0);
  return status === 0 || status >= 500;
}

function addTaskSaveRetryAction(summaryId, onRetry) {
  const summary = document.getElementById(summaryId);
  if (!summary || summary.hidden) return;
  summary.querySelector('.form-error-retry')?.remove();
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'ui-link form-error-summary-link form-error-retry';
  retry.textContent = 'Повторить сохранение';
  retry.disabled = isTaskNetworkOffline();
  retry.addEventListener('click', () => {
    retry.disabled = true;
    onRetry();
  }, { once: true });
  summary.appendChild(retry);
}

async function runTaskSaveWithSingleRetry(operation, onRetry) {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableTaskSaveError(error)) throw error;
    if (error?.code === 'SAVE_TIMEOUT') throw error;
    if (isTaskNetworkOffline()) throw error;
    onRetry?.();
    await new Promise(resolve => setTimeout(resolve, 650));
    return operation();
  }
}

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
let _commentsLoadedTaskId = null;
let _commentsLoadSequence = 0;
let _usersCache = [];
let _mentionedUserIds = [];
let _commentTaskId = null;
let _mentionSelectedIdx = -1;
let _mentionQueryStart = -1;
let _pendingCommentSubmission = null;
let _commentSubmitting = false;

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

function renderLinkJiraTags(links) {
  if (!links || !links.length) return '';
  if (typeof links === 'string') {
    const s = links.trim();
    if (s.charAt(0) === '[') {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) links = arr;
      } catch (e) { /* keep string */ }
    } else {
      links = [links];
    }
  }
  return links.filter(Boolean).map(url => {
    const safeUrl = safeExternalUrl(url);
    return safeUrl ? `<a class="ui-entity-link b-tag" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🔗 Jira</a>` : '';
  }).join('');
}

function cvClass(val) {
  if (val === null || val === '—') return '';
  const num = parseFloat(val);
  if (num >= 1.5) return 'text-success';
  if (num < 1) return 'text-danger';
  return 'text-warning';
}

function priorityColor(priority) {
  return `var(--${{ danger: 'danger-text', warning: 'warning-text', neutral: 'text-secondary' }[taskPriorityTone(priority)]})`;
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
    if (!cardMatchesCurrentTask(taskId)) return;
    // POST is both an atomic acquire and a lease heartbeat for the current
    // editor. View mode remains read-only and only observes lease state.
    const status = modalMode === 'edit'
      ? await acquireLock(taskId)
      : await fetchLockStatus(taskId);
    if (!cardMatchesCurrentTask(taskId)) return;
    if (status?.error) {
      const lockInfo = await fetchLockStatus(taskId);
      if (!cardMatchesCurrentTask(taskId)) return;
      _lockInfo = lockInfo;
      renderLockBanner();
      return;
    }
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
    if (!document.getElementById('task-detail-overlay') || !cardMatchesCurrentTask(taskId)) {
      stopViewerPolling();
      return;
    }
    // Presence is a renewable lease as well: keep our own last_seen_at alive
    // while the card remains open, then read the other active viewers.
    await registerViewer(taskId);
    if (!cardMatchesCurrentTask(taskId)) return;
    const viewers = await fetchViewers(taskId);
    if (!cardMatchesCurrentTask(taskId)) return;
    _currentViewers = viewers;
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
    <div class="conflict-modal conflict-modal--wide" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
      <div class="conflict-modal-header app-modal__header">
        <div class="conflict-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div>
          <h3 class="conflict-title" id="conflict-title">Конфликт версий</h3>
          <p class="conflict-subtitle">Задача была изменена другим пользователем. Выберите значения для каждого изменённого поля.</p>
        </div>
      </div>
      <div class="app-modal__body">
      <div class="conflict-versions">
        <span>Ваша версия: <strong>${submittedVer}</strong></span>
        <span class="conflict-arrow">&rarr;</span>
        <span>Текущая версия: <strong>${currentVer}</strong></span>
      </div>
      ${hasChanges
        ? `<div class="conflict-diff-wrap">
            <table class="ui-table ui-table-editor diff-table diff-table--selectable">
              <thead>
                <tr>
                  <th scope="col">Серверная версия</th>
                  <th scope="col">Моя версия</th>
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
      </div>
      <div class="conflict-actions conflict-actions--row app-modal__footer">
        <button class="btn btn-secondary btn-sm ui-btn conflict-btn conflict-btn-primary" id="conflict-btn-save-selected" ${!hasChanges ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Сохранить выбранные
        </button>
        <button class="btn btn-secondary btn-sm ui-btn conflict-btn conflict-btn-danger" id="conflict-btn-force">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Принудительно сохранить
        </button>
        <button class="btn btn-secondary btn-sm ui-btn conflict-btn conflict-btn-secondary" id="conflict-btn-refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Обновить с сервера
        </button>
        <button class="btn btn-secondary btn-sm ui-btn conflict-btn conflict-btn-ghost" id="conflict-btn-cancel" data-modal-close>Отмена</button>
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
      <td class="diff-radio-cell"><input type="radio" name="${rName}" value="server" aria-label="Оставить серверное значение: ${safeLabel}" class="diff-radio" data-field="${safeField}" checked></td>
      <td class="diff-radio-cell"><input type="radio" name="${rName}" value="local" aria-label="Использовать моё значение: ${safeLabel}" class="diff-radio" data-field="${safeField}"></td>
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
    metric_kr_plan: getFloat('edit-metric-kr-plan'),
    metric_kr_fact: getFloat('edit-metric-kr-fact'),
    metric_kr_unit: document.getElementById('edit-metric-kr-unit')?.value || null,
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    comment: document.getElementById('edit-comment')?.value || null,
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: (() => {
      const sel = document.getElementById('edit-tags');
      const selected = sel ? [...sel.selectedOptions].map(o => o.value) : [];
      const extra = (document.getElementById('edit-tags-new')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
      return [...selected, ...extra].filter((v, i, a) => a.indexOf(v) === i);
    })(),
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
    metric_kr_plan: getFloat('edit-metric-kr-plan'),
    metric_kr_fact: getFloat('edit-metric-kr-fact'),
    metric_kr_unit: document.getElementById('edit-metric-kr-unit')?.value || null,
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    comment: document.getElementById('edit-comment')?.value || null,
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: (() => {
      const sel = document.getElementById('edit-tags');
      const selected = sel ? [...sel.selectedOptions].map(o => o.value) : [];
      const extra = (document.getElementById('edit-tags-new')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
      return [...selected, ...extra].filter((v, i, a) => a.indexOf(v) === i);
    })(),
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
  return uiBadge({ label: status || '—', tone: taskStatusTone(status) });
}

function renderPriorityBadge(priority) {
  return uiBadge({ label: priority || '—', tone: taskPriorityTone(priority) });
}

function renderTagBadge(tag) {
  return uiTag({ label: tag, className: 'task-detail-tag' });
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
  return uiAvatar({ name, size, className: 'task-detail-avatar' });
}

// ============================================================
//  B-VARIANT KPI ROW (4 tiles)
// ============================================================
function renderBKpiRow(task) {
  const statusName = task.status_name || task.status || '—';
  const deadlineName = task.deadline_name || task.deadline || '—';
  const progress = task.progress || 0;
  const cvValue = calculateTaskCv(task);
  const cv = cvValue == null ? 'Нет данных' : cvValue.toFixed(2);
  const zone = cvZone(cvValue);
  const cvCls = zone === 'good' ? 'b-cv-good' : zone === 'warning' ? 'b-cv-mid' : 'b-cv-bad';

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
        ${task.financial_effect != null ? `<span>Эффект: ${metricFormat(task.financial_effect)} млн ₽</span>` : ''}
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
  const cvValue = calculateTaskCv(t);
  const cv = cvValue == null ? 'Нет данных' : cvValue.toFixed(2);
  const cvDisplayZone = cvZone(cvValue);
  const cvDisplayClass = cvDisplayZone === 'good' ? 'b-cv-good' : cvDisplayZone === 'warning' ? 'b-cv-mid' : 'b-cv-bad';
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
        <div class="b-fin-value">${t.financial_effect != null ? metricFormat(t.financial_effect) + ' <span class="vs">млн ₽</span>' : '—'}</div>
        <span class="b-fin-sub">Финансовый эффект</span>
      </div>
      <div class="b-fin-cell">
        <div class="b-fin-value">${t.effort_rub != null ? metricFormat(t.effort_rub) + ' <span class="vs">₽</span>' : '—'}</div>
        <span class="b-fin-sub">Трудозатраты</span>
      </div>
      <div class="b-fin-cell">
        <span class="b-cv lg ${cvDisplayClass}">
          <b>C / V</b> ${cv}
        </span>
        <span class="b-fin-sub">Соотношение</span>
      </div>
      <div class="b-fin-cell">
        <div class="b-fin-value">${t.metric_kr_plan != null ? metricFormat(t.metric_kr_plan) + (t.metric_kr_unit ? ' <span class="vs">' + escapeHtml(t.metric_kr_unit) + '</span>' : '') : '—'}</div>
        <span class="b-fin-sub">Метрический KR (план)</span>
      </div>
      <div class="b-fin-cell">
        <div class="b-fin-value">${t.metric_kr_fact != null ? metricFormat(t.metric_kr_fact) + (t.metric_kr_unit ? ' <span class="vs">' + escapeHtml(t.metric_kr_unit) + '</span>' : '') : '—'}</div>
        <span class="b-fin-sub">Метрический KR (факт)</span>
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
        ${tags.map(tag => {
          const name = typeof tag === 'object' && tag !== null ? String(tag.name || '') : String(tag);
          const color = typeof tag === 'object' && tag !== null ? (tag.color || '') : '';
          return name ? uiTag({ label: name, color, className: 'b-tag' }) : '';
        }).join('')}
        ${safeExternalUrl(t.link_mockups) ? `<a class="ui-entity-link b-tag" href="${escapeHtml(safeExternalUrl(t.link_mockups))}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">📎 Макеты</a>` : ''}
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
            ${item.changed_by_name ? avatarEl(item.changed_by_name, 20) : uiAvatar({ name: '', size: 20, className: 'task-detail-avatar' })}
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
//  RENDER FULL MODAL (B-VARIANT DASHBOARD) — LEGACY (заменено v18)
// ============================================================
function renderTaskDetailModalLegacy(task, app) {
  currentTask = task;
  modalMode = task ? 'view' : 'edit';

  const t = task || {};
  const statusName = t.status_name || t.status;
  const priorityName = t.priority_name || t.priority;
  const taskTypeName = t.task_type_name || t.task_type;
  const hasTaskId = !!t.id;

  return `
    <div class="modal-overlay ui-task-dialog-overlay" id="task-detail-overlay">
      <div class="task-detail-modal" id="task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">

        <!-- B-Header -->
        <div class="b-head">
          <div class="b-head-left">
            <div class="b-head-top">
              <span class="b-head-id">${hasTaskId ? formatTaskPublicId(t) : 'Новая задача'}</span>
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
              <button class="btn btn-secondary btn-sm ui-btn task-detail-btn-icon" id="td-share-btn" title="Поделиться">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              </button>
              <button class="btn btn-secondary btn-sm ui-btn task-detail-btn-icon" id="td-edit-btn" title="Редактировать">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn-secondary btn-sm ui-btn task-detail-btn-icon task-detail-btn-close" id="td-close-btn" title="Закрыть" aria-label="Закрыть карточку задачи">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Activity Tabs Bar (fixed below header) -->
        <div class="b-act-tabs-bar" id="td-act-tabs-bar">
          <div class="b-act-tabs">
            <button class="btn btn-secondary btn-sm ui-btn b-act-tab active" data-act="overview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Обзор
            </button>
            <button class="btn btn-secondary btn-sm ui-btn b-act-tab" data-act="history">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              История <b id="act-history-count">—</b>
            </button>
            <button class="btn btn-secondary btn-sm ui-btn b-act-tab" data-act="comments">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Комментарии <b id="act-comments-count">—</b>
            </button>
            <button class="btn btn-secondary btn-sm ui-btn b-act-tab" data-act="files">
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
              <div class="content-loading-state" style="text-align:center;padding:20px">Загрузка истории…</div>
            </div>
            <div class="b-act-panel" id="act-panel-comments">
              <div id="comments-list-container">
                <div class="content-loading-state" style="text-align:center;padding:20px">Загрузка комментариев…</div>
              </div>
              <div id="comment-form-container" style="margin-top:16px;border-top:1px solid var(--border-color);padding-top:16px;">
                <div id="reply-indicator" class="reply-indicator" style="display:none;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                  <span class="reply-indicator-text"></span>
                  <button class="btn btn-ghost btn-sm square-icon ui-btn reply-indicator-cancel" onclick="window.__cancelReply()">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div style="position:relative;">
                  <textarea class="input ui-control task-detail-input" id="comment-textarea" rows="3" placeholder="Напишите комментарий... Используйте @ для упоминания пользователей"></textarea>
                  <div id="mention-dropdown" class="ui-mention-popover" hidden></div>
                </div>
                <div style="display:flex;justify-content:flex-end;margin-top:8px;">
                  <button class="btn btn-secondary btn-sm ui-btn task-detail-btn task-detail-btn-primary" id="comment-submit-btn" disabled>
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
                <div class="attachment-drop-hint">Макс. размер: 50 МиБ</div>
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
            <button class="btn btn-secondary btn-sm ui-btn task-detail-btn task-detail-btn-ghost" onclick="window.__cancelEdit()">Отмена</button>
            <button class="btn btn-secondary btn-sm ui-btn task-detail-btn task-detail-btn-primary" id="td-save-btn" onclick="window.__saveFromEdit()">
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

async function loadAttachments(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api || !taskId) return;
  await cardReadRequest('attachments', Number(taskId), signal => api.get(`/tasks/${taskId}/attachments`, { signal }), data => {
    _attachmentsCache = data.items || [];
    cardState.filesCount = _attachmentsCache.length;
  }, () => {
    const filesHeading = document.getElementById('task-files-heading');
    if (filesHeading) filesHeading.lastChild.textContent = 'Файлы' + (cardState.filesCount ? ' · ' + cardState.filesCount : '');
    cardRenderTabs();
    renderAttachmentsList();
  });
}

function renderAttachmentsList() {
  const container = document.getElementById('attachments-list-container');
  if (!container) return;
  const state = cardReadState('attachments');
  const feedback = cardReadFeedback('attachments', 'файлы');
  if (!state.loaded && (state.loading || state.error)) { container.innerHTML = feedback; return; }
  renderAttachments(container, _attachmentsCache, { canDelete: cardEditPermission().allowed, variant: 'task-detail' });
  if (feedback) container.insertAdjacentHTML('afterbegin', feedback);
}

window.__deleteAttachment = async function(taskId, attachmentId) {
  if (!cardMatchesCurrentTask(taskId)) return;
  const permission = cardEditPermission();
  if (!permission.allowed) {
    window.toast?.(permission.reason, 'warning');
    return;
  }
  const approved = await window.confirmAction?.({
    title: 'Удалить вложение?',
    message: 'Файл будет удалён из задачи. Это действие нельзя отменить.',
    confirmText: 'Удалить',
    destructive: true,
  });
  if (!approved) return;
  const currentPermission = cardEditPermission();
  if (!cardMatchesCurrentTask(taskId) || !currentPermission.allowed) {
    if (!currentPermission.allowed) window.toast?.(currentPermission.reason, 'warning');
    return;
  }
  const api = window.app?.api;
  if (!api) return;
  try {
    const requestId = newTaskRequestId();
    await api.delete(`/tasks/${taskId}/attachments/${attachmentId}?client_request_id=${encodeURIComponent(requestId)}`);
    window.toast?.('Файл удалён', 'success');
    await loadAttachments(taskId, window.app);
  } catch (e) {
    window.toast?.('Ошибка удаления: ' + (e.message || 'неизвестная'), 'error');
  }
};

window.__downloadAttachment = async function(taskId, attachmentId) {
  if (!cardMatchesCurrentTask(taskId)) return;
  const api = window.app?.api;
  if (!api) return;
  const attachment = _attachmentsCache.find(item => item.id === attachmentId);
  try {
    await api.download(
      `/tasks/${taskId}/attachments/${attachmentId}/download`,
      attachment?.original_name || 'attachment'
    );
  } catch (e) {
    window.toast?.('Ошибка скачивания: ' + (e.message || 'неизвестная'), 'error');
  }
};

async function saveTaskLinks(taskId, app) {
  if (!cardMatchesCurrentTask(taskId)) return;
  const permission = cardEditPermission();
  if (!permission.allowed) {
    window.toast?.(permission.reason, 'warning');
    return;
  }
  const api = app?.api || window.app?.api;
  if (!api) return;
  const mockupsInput = document.getElementById('link-mockups-input');
  const jiraInput = document.getElementById('link-jira-input');
  if (!mockupsInput || !jiraInput) return;

  const payload = {
    version: currentTask?.version ?? 0,
    link_mockups: mockupsInput.value.trim() || null,
    link_jira: jiraInput.value.trim() || null,
  };

  const btn = document.getElementById('save-links-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохранение...'; }

  try {
    const updatedTask = await api.put(`/tasks/${taskId}/links`, payload);
    window.toast?.('Ссылки сохранены', 'success');
    if (currentTask) {
      currentTask.link_mockups = payload.link_mockups;
      currentTask.link_jira = payload.link_jira;
      if (updatedTask?.version !== undefined) currentTask.version = updatedTask.version;
    }
  } catch (e) {
    window.toast?.('Ошибка: ' + (e.message || 'не удалось сохранить'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Сохранить ссылки'; }
  }
}

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_SIZE_ERROR = 'Максимальный размер вложения — 50 МиБ (52 428 800 байт). Уменьшите файл или выберите другой.';

async function uploadFile(taskId, file, app) {
  if (file.size > MAX_ATTACHMENT_BYTES) return ATTACHMENT_SIZE_ERROR;
  if (!cardMatchesCurrentTask(taskId)) return 'Карточка задачи закрыта или изменена.';
  const permission = cardEditPermission();
  if (!permission.allowed) {
    return permission.reason;
  }
  const api = app?.api || window.app?.api;
  if (!api) return 'Сервис загрузки недоступен.';
  const clientRequestId = newTaskRequestId();
  try {
    await api.upload(`/tasks/${taskId}/attachments`, file, { client_request_id: clientRequestId });
    window.toast?.(`Файл "${file.name}" загружен`, 'success');
    await loadAttachments(taskId, app);
  } catch (e) {
    return e.status === 413 ? ATTACHMENT_SIZE_ERROR : (e.message || 'Не удалось загрузить файл. Повторите попытку.');
  }
}

function initAttachmentForm(taskId, app) {
  if (_attachmentFormInitialized) return;
  if (!cardMatchesCurrentTask(taskId)) return;
  if (!cardEditPermission().allowed) return;

  const dropZone = document.getElementById('attachment-drop-zone');
  const fileInput = document.getElementById('attachment-file-input');
  const saveLinksBtn = document.getElementById('save-links-btn');

  if (!dropZone || !fileInput) return;
  _attachmentFormInitialized = true;
  let uploading = false;
  const feedback = document.createElement('div');
  feedback.id = 'attachment-upload-feedback';
  feedback.innerHTML = '<div role="status" id="attachment-upload-status"></div><ul role="alert" id="attachment-upload-errors"></ul>';
  dropZone.after(feedback);
  const status = feedback.querySelector('#attachment-upload-status');
  const errors = feedback.querySelector('#attachment-upload-errors');
  async function uploadBatch(files) {
    if (uploading || !files.length) return;
    uploading = true; fileInput.disabled = true;
    dropZone.setAttribute('aria-disabled', 'true');
    dropZone.setAttribute('aria-busy', 'true');
    errors.replaceChildren();
    let loaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (!cardMatchesCurrentTask(taskId)) break;
        status.textContent = 'Загрузка ' + (index + 1) + ' из ' + files.length + ': ' + file.name;
        const error = await uploadFile(taskId, file, app);
        if (error) { const item = document.createElement('li'); item.textContent = file.name + ': ' + error; errors.appendChild(item); }
        else loaded++;
      }
      status.textContent = 'Загрузка завершена. Загружено: ' + loaded + ' из ' + files.length + '.';
    } finally {
      uploading = false; fileInput.disabled = false; fileInput.value = '';
      dropZone.setAttribute('aria-disabled', 'false');
      dropZone.setAttribute('aria-busy', 'false');
    }
  }

  if (saveLinksBtn) {
    saveLinksBtn.addEventListener('click', () => saveTaskLinks(taskId, app));
  }

  dropZone.addEventListener('click', (e) => {
    if (uploading) return;
    if (e.target.closest('.attachment-drop-browse') || e.target === dropZone || e.target.closest('.attachment-drop-zone')) {
      fileInput.click();
    }
  });

  dropZone.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (!uploading) fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files);
    await uploadBatch(files);
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
    await uploadBatch(files);
  });
}

// ============================================================
//  MODAL INIT (B-VARIANT) — LEGACY (заменено v18)
// ============================================================
function initTaskDetailModalLegacy(app) {
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
      navigator.clipboard?.writeText(window.location.origin + '/' + (()=>{const q=new URLSearchParams(window.location.hash.split('?')[1]||'');q.set('task',currentTask.id);return '#/backlog?'+q.toString();})())
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
  const lockInfo = await fetchLockStatus(taskId);
  if (!cardMatchesCurrentTask(taskId)) return;
  _lockInfo = lockInfo;
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
  const tags = t.tags ? (Array.isArray(t.tags) ? t.tags.map(x => typeof x === 'object' && x !== null ? String(x.name || '') : String(x)).filter(Boolean) : String(t.tags).split(',').map(x => x.trim()).filter(Boolean)) : [];
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
    return `<select class="input ui-control b-edit-select" id="${id}">
      ${opts.map(o => `<option value="${escapeHtml(String(o.value))}" ${(o.value === selected || o.label === selected) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }

  function binput(id, type, val, placeholder) {
    return `<input type="${type}" class="input ui-control b-edit-input" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function bnum(id, val, placeholder) {
    return `<input type="number" class="input ui-control b-edit-num" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function btextarea(id, val, placeholder, rows = 3) {
    return `<textarea class="input ui-control b-edit-textarea" id="${id}" rows="${rows}" placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(val || '')}</textarea>`;
  }

  function apiSelect(id, currentId, currentName) {
    const val = currentId || currentName || '';
    const display = currentName || currentId || '';
    return `<select class="input ui-control b-edit-select" id="${id}"><option value="${escapeHtml(String(val))}" ${val ? 'selected' : ''}>${escapeHtml(display || 'Загрузка...')}</option></select>`;
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
        <input type="range" min="0" max="100" step="5" value="${Math.round((t.progress || 0) / 5) * 5}" class="b-edit-range" id="edit-progress" aria-label="Прогресс, процентов">
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
    <div class="b-edit-row-2" style="margin-top:10px">
      ${field(FL('metric_kr_plan'), bnum('edit-metric-kr-plan', t.metric_kr_plan ?? '', 'план'))}
      ${field(FL('metric_kr_fact'), bnum('edit-metric-kr-fact', t.metric_kr_fact ?? '', 'факт'))}
    </div>
    <div style="margin-top:10px">
      ${field(FL('metric_kr_unit'), binput('edit-metric-kr-unit', 'text', t.metric_kr_unit || '', 'шт, %, руб...'))}
    </div>
    <div style="margin-top:16px;border-top:1px solid var(--border-color);padding-top:12px;">
      <div class="b-tile-title" style="margin-bottom:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <h3>Статусы для встреч</h3>
      </div>
      <div style="margin-bottom:8px">
        <label class="b-edit-label">Директорская</label>
        <textarea class="input ui-control b-edit-textarea" id="edit-directorate-status" rows="2" placeholder="Опишите статус...">${escapeHtml(t.directorate_status || '')}</textarea>
      </div>
      <div style="margin-bottom:8px">
        <label class="b-edit-label">ДИД</label>
        <textarea class="input ui-control b-edit-textarea" id="edit-did-status" rows="2" placeholder="Опишите статус...">${escapeHtml(t.did_status || '')}</textarea>
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
      ${field(FL('tags'), `
        <select class="input ui-control b-edit-select" id="edit-tags" multiple style="width:100%">
          ${(window.app?.tags || []).map(tg => {
            const name = String(tg.name || '');
            return `<option value="${escapeHtml(name)}" ${tags.includes(name) ? 'selected' : ''}>${escapeHtml(name)}</option>`;
          }).join('')}
        </select>
        <input type="text" class="input ui-control b-edit-input" id="edit-tags-new" placeholder="Новые теги через запятую" style="margin-top:6px">
        <div style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted);margin-top:4px;">Выберите из списка или введите новые — они создадутся автоматически</div>
      `)}
    </div>
  </div>`;

  html += `</div>`;
  return html;
}

// Global handlers for edit mode buttons
window.__cancelEdit = async function() {
  const confirmed = await showConfirmModal(
    'Внесённые изменения не будут сохранены. Отменить редактирование?',
    'Отменить изменения?',
    'Отменить изменения',
    'Продолжить редактирование',
    true
  );
  if (!confirmed) return;
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

  populateSelect('/teams/', 'edit-team', t.team_id, t.team_name || t.team);
  populateSelect('/projects', 'edit-project', t.project_id, t.project_name || t.project);
  populateSelect('/admin/departments', 'edit-department', t.department_id, t.department_name || t.customer_department);
  populateSelect('/admin/business-customers', 'edit-business-customer', t.business_customer_id, t.business_customer_name || t.business_customer);
  populateSelect('/users/', 'edit-owner', t.owner_id, t.owner_name || t.owner);

  const customerSelect = document.getElementById('edit-business-customer');
  if (customerSelect) {
    customerSelect.addEventListener('change', function() {
      const deptSelect = document.getElementById('edit-department');
      if (!deptSelect) return;
      const customer = (window.app?.businessCustomers || []).find(b => String(b.id) === this.value);
      if (customer && customer.department_id != null) {
        deptSelect.value = String(customer.department_id);
      }
    });
  }
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
    metric_kr_plan: getFloat('edit-metric-kr-plan'),
    metric_kr_fact: getFloat('edit-metric-kr-fact'),
    metric_kr_unit: document.getElementById('edit-metric-kr-unit')?.value || null,
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    comment: document.getElementById('edit-comment')?.value || null,
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: (() => {
      const sel = document.getElementById('edit-tags');
      const selected = sel ? [...sel.selectedOptions].map(o => o.value) : [];
      const extra = (document.getElementById('edit-tags-new')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
      return [...selected, ...extra].filter((v, i, a) => a.indexOf(v) === i);
    })(),
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
      await api.post('/tasks/', data);
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
export function closeTaskDetailModal(options = {}) {
  const {skipNetwork=false,preserveRoute=false,immediate=false,restoreFocus=true}=options||{};
  if (!immediate&&document.getElementById('task-detail-overlay')?.classList.contains('modal-closing')) return;
  const taskId = currentTask?.id;
  const closingModal = document.getElementById('task-detail-overlay');
  restoreTaskModalDocumentTitle();
  deactivateTaskModalFocusTrap();
  if (_cardRouteTabHandler) { document.removeEventListener('task-tab-change', _cardRouteTabHandler); _cardRouteTabHandler = null; }
  const returnFocus = takeTaskModalReturnFocus();
  if(!preserveRoute)window.app?.router?.clearTaskRoute?.();
  _taskCardRequestGate.cancelAll();
  if (taskId) _taskCommentDraftSession.clear(taskId);
  cardState.dirty = false;
  cardState.editing = false;
  cardState.draft = null;
  cardState.prioritiserRunning = '';
  clearCardReportingDrafts();
  stopLockPolling();
  stopViewerPolling();
  if (currentTask?.id) {
    unregisterViewer(currentTask.id);
  }
  const dropdown = document.getElementById('mention-dropdown');
  dropdown?._uiPopover?.close({ restoreFocus: false });
  _commentFormInitialized = false;
  _attachmentFormInitialized = false;
  clearTimeout(_cardAttachmentHydrationTimer);
  _cardAttachmentHydrationTimer = null;
  _commentsCache = [];
  _commentsLoadedTaskId = null;
  _attachmentsCache = [];
  _usersCache = [];
  _mentionedUserIds = [];
  _mentionSelectedIdx = -1;
  _mentionQueryStart = -1;
  _replyingTo = null;
  _commentTaskId = null;
  _commentTargetHandled = null;
  _pendingCommentSubmission = null;
  _commentSubmitting = false;
  const wasEditing = modalMode === 'edit';
  const overlay = closingModal;
  if (overlay) {
    overlay.classList.add('modal-closing');
    const finishClose=() => {
      overlay.remove();
      if (Number(currentTask?.id) === Number(taskId)) currentTask = null;
      if (currentModal === overlay) currentModal = null;
      if (!currentTask) modalMode = 'view';
      if (restoreFocus&&!document.getElementById('task-detail-overlay')) restoreTaskModalReturnFocus(returnFocus);
    };
    if(immediate)finishClose();else setTimeout(finishClose,200);
  }
  if (taskId && wasEditing && !skipNetwork) {
    releaseLock(taskId);
  }
  _lockInfo = null;
}

// ============================================================
//  OPEN TASK MODAL (главная точка входа)
// ============================================================
export function revokeTaskModalAccess(){closeTaskDetailModal({skipNetwork:true,preserveRoute:true,immediate:true,restoreFocus:false});currentTask=null;currentModal=null;cardState.current=null;cardState.history=[];cardDict=null;cardMaps=null;onSaveCallback=null;const create=document.getElementById('create-task-overlay');if(create){clearCreateTaskDraft();closeCreateTaskModal();create.remove();}}

export function openTaskModal(task = null) {
  ensureTaskRealtimeEvents();
  rememberTaskModalReturnFocus(task?.id);
  if (task?.id) window.app?.router?.pushTaskRoute?.(task.id);
  currentTask = task;
  modalMode = task ? 'view' : 'edit';
  setTaskModalDocumentTitle(task);

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

export function renderTaskCard(task, searchQuery = '') {
  // Мини-карточка для канбан/карточек
  const prio = task.priority_name || task.priority || '';
  const prioClass = prio === 'ВЫСОКИЙ' ? 'badge-high' : prio === 'СРЕДНИЙ' ? 'badge-medium' : 'badge-low';
  const p = task.progress;
  const statusName = task.status_name || task.status;
  const teamName = task.team_name || '—';
  const deadlineName = task.deadline_name || task.deadline || '—';
  const ownerName = task.owner_name || task.owner || '—';
  const safeId = escapeHtml(formatTaskPublicId(task));
  const safePrio = escapeHtml(prio || '—');
  const highlight = value => highlightSearchText(value, searchQuery);
  return `
    <div class="task-card" data-id="${escapeHtml(task.id)}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span class="font-mono text-muted" style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);flex-shrink:0;">${highlight(formatTaskPublicId(task))}</span>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <span class="badge ${prioClass}" style="">${safePrio}</span>
        </div>
      </div>
      <div class="task-card-title"><button type="button" class="ui-surface-action task-card-open" data-open-task aria-label="Открыть ${safeId}: ${escapeHtml(task.title)}">${highlight(task.title)}</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${renderStatusBadge(statusName)}
        <span class="badge badge-info" style="">${escapeHtml(teamName)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        ${uiProgress({ value: p, tone: p >= 100 ? 'success' : 'accent', showValue:true })}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border-color);font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted);">
        <span>${escapeHtml(deadlineName)}</span>
        <span>${escapeHtml(ownerName)}</span>
      </div>
    </div>`;
}

function taskSaveContext(){const u=window.app?.store?.get('currentUser');return `${window.location.hash.split('?')[0]}:${u?.id}:${u?.team_id}`;}
export function setOnTaskSaved(callback) {
  const owner=taskSaveContext();onSaveCallback=callback?()=>owner===taskSaveContext()?callback():undefined:null;
}
function notifyTaskSaved(){try{Promise.resolve(onSaveCallback?.()).catch(()=>console.warn('Task saved; list refresh failed'));}catch{console.warn('Task saved; list refresh failed');}}

// ============================================================
//  CREATE TASK MODAL (dedicated form with required fields)
// ============================================================
export function openCreateTaskModal(app, options = {}) {
  ensureTaskRealtimeEvents();
  _createTaskContext = options;
  rememberTaskModalReturnFocus();
  currentTask = null;
  modalMode = 'create';
  _createTaskDirty = false;
  _createTaskInitialSnapshot = '';
  ensureTaskBeforeUnloadGuard();
  ensureTaskExternalLinkGuard();

  const html = renderCreateTaskForm();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  currentModal = wrapper.firstElementChild;
  document.body.appendChild(currentModal);

  initCreateTaskModal(app);
  ensureTaskNetworkState();

  if (window.lucide) {
    window.lucide.createIcons();
  }

  return currentModal;
}

function renderCreateTaskForm() {
  return `
    <div class="modal-overlay" id="create-task-overlay">
      <div class="task-detail-modal modal" id="create-task-modal" role="dialog" aria-modal="true" aria-labelledby="create-task-title">
        
        <!-- Modal Header -->
        <div class="mhead">
          <div class="head-row1"><div class="row-badges">${uiBadge({ label: 'Новая задача', tone: 'neutral', className: 'task-head-chip' })}<span class="header-unsaved-indicator" id="create-unsaved-indicator" role="status" aria-live="polite" hidden><i aria-hidden="true"></i>Не сохранено</span></div>
          <div class="row-actions">
            ${uiButton({ label: 'Закрыть форму создания задачи', iconMarkup: cardIcon('x'), iconOnly: true, size: 'large', variant: 'ghost', className: 'iconbtn close', attrs: { id: 'create-close-btn', title: 'Закрыть' } })}</div></div>
          <h2 class="head-title" id="create-task-title">Создание новой задачи</h2>
        </div>

        <!-- Modal Body -->
        <div class="mbody" id="create-modal-body">
          <div class="form-error-summary" id="create-form-error-summary" role="alert" hidden></div>
          ${renderCreateTaskFormFieldsV30()}
        </div>

        <!-- Modal Footer -->
        <div class="mfoot">
          <div class="fmeta"><b>*</b> Обязательные поля</div>
          <div class="factions">
            ${uiButton({ label: 'Очистить форму', attrs: { id: 'create-clear-draft-btn' } })}
            <span class="create-draft-saved-status" id="create-draft-saved-status" role="status" aria-live="polite" hidden></span>
            <span class="task-network-status" role="status" hidden></span>
            ${uiButton({ label: 'Отмена', attrs: { id: 'create-cancel-btn' } })}
            ${uiButton({ label: 'Создать задачу', variant: 'primary', iconMarkup: cardIcon('check'), attrs: { id: 'create-save-btn', disabled: true, 'aria-disabled': true, title: 'Заполните обязательные поля' } })}
          </div>
        </div>

      </div>
    </div>`;
}

const TASK_FORM_SCHEMA = Object.freeze({
  title: { label: 'Название', required: true, createId: 'create-title', type: 'text', maxLength: 255 },
  description: { label: 'Описание', createId: 'create-description', type: 'textarea', maxLength: 10000 },
  team: { label: 'Ответственная команда', required: true, createId: 'create-team', type: 'select', dict: 'teams' },
  type: { label: 'Тип задачи', required: true, createId: 'create-task-type', type: 'select', dict: 'taskTypes' },
  channel: { label: 'Канал поступления', required: true, createId: 'create-channel', type: 'select', dict: 'channels' },
  receivedAt: { label: 'Дата получения', required: true, createId: 'create-date-received', type: 'date' },
  project: { label: 'Проект', createId: 'create-project', type: 'select', dict: 'projects' },
  priority: { label: 'Приоритет', createId: 'create-priority', type: 'select', dict: 'priorities' },
  deadline: { label: 'Срок выполнения', createId: 'create-deadline', type: 'select', dict: 'deadlines' },
  customer: { label: 'Бизнес-заказчик', createId: 'create-business-customer', type: 'select', dict: 'customers' },
  assignee: { label: 'Исполнитель', createId: 'create-owner', type: 'select', dict: 'users' },
  comment: { label: 'Комментарий', createId: 'create-comment', type: 'textarea', maxLength: 5000 },
  mockupUrl: { label: 'Макеты', createId: 'create-link-mockups', type: 'url' },
  jiraLinks: { label: 'Jira', createId: 'create-link-jira', type: 'url' },
});

function taskFormMeta(key) {
  return TASK_FORM_SCHEMA[key] || { label: key };
}

function taskFormLabel(key, requiredMark = '') {
  const meta = taskFormMeta(key);
  return meta.label + (meta.required ? ' ' + requiredMark : '');
}

function taskFormCreateControl(key, opts = {}) {
  const meta = taskFormMeta(key), id = meta.createId;
  return uiControl({
    id, kind: meta.type === 'select' || meta.type === 'textarea' ? meta.type : 'input',
    type: meta.type, value: opts.value ?? '', required: meta.required,
    className: key === 'title' ? 'title-input' : '',
    options: [{ value: '', label: opts.placeholder || 'Загрузка...' }],
    attrs: { rows: meta.type === 'textarea' ? opts.rows || 4 : undefined,
      maxlength: meta.maxLength, autofocus: key === 'title', placeholder: opts.placeholder || '',
      'aria-describedby': meta.required ? id + '-error' : undefined },
  });
}

function taskFormEditControl(key, value) {
  const meta = taskFormMeta(key);
  if (meta.type === 'select') return cardSel(key, cardNameList(meta.dict), value);
  if (meta.type === 'date') return cardDateC(key, value);
  if (meta.type === 'textarea') return '<div class="character-count-wrap">' + cardTaC(key, value, key === 'comment' ? 3 : 4, meta.maxLength) + taskCharacterCounter(key, 'edit') + '</div>';
  return uiControl({ type: meta.type, value: value ?? '', attrs: { 'data-k': key, 'aria-label': meta.label, maxlength: meta.maxLength, placeholder: meta.type === 'url' ? 'https://...' : undefined } });
}

function renderCreateTaskFormFieldsV30() {
  const errors = { title: 'Введите название задачи', team: 'Выберите ответственную команду', type: 'Выберите тип задачи', channel: 'Выберите канал поступления', receivedAt: 'Укажите дату получения' };
  const field = (key, opts = {}) => {
    const meta = taskFormMeta(key);
    const control = taskFormCreateControl(key, opts);
    return uiFieldFrame({
      id: meta.createId, label: meta.label, required: meta.required,
      controlMarkup: meta.maxLength ? '<div class="character-count-wrap">' + control + taskCharacterCounter(key) + '</div>' : control,
      error: errors[key] || '', errorHidden: true, errorClassName: 'create-field-error',
      className: opts.className || 'icell' + (opts.span2 ? ' span2cell' : ''),
    });
  };
  let h = '<div class="task-top">'
    + field('title', { className: 'task-title-card', placeholder: 'Введите название задачи' })
    + field('description', { className: 'task-desc', placeholder: 'Опишите задачу' }) + '</div>';

  h += cardSec('Паспорт задачи', 'file') + '<div class="bento">';
  h += '<div class="cl sp3"><div class="cl-h">' + cardIcon('team') + '<span>Регистрация</span></div><div class="cl-grid exec">'
    + field('team') + field('type') + field('channel')
    + field('receivedAt', { value: new Date().toISOString().slice(0, 10) }) + '</div></div>';
  h += '<div class="cl half"><div class="cl-h">' + cardIcon('folder') + '<span>Классификация</span></div><div class="cl-grid duo">'
    + field('project', { placeholder: 'Не выбран' }) + field('priority')
    + field('deadline', { placeholder: 'Не выбран', span2: true }) + '</div></div>';
  h += '<div class="cl half"><div class="cl-h">' + cardIcon('user') + '<span>Участники</span></div><div class="cl-grid duo">'
    + field('customer', { placeholder: 'Не выбран' }) + field('assignee', { placeholder: 'Не назначен' })
    + field('comment', { rows: 3, placeholder: 'Общий комментарий', span2: true }) + '</div></div></div>';
  h += cardSec('Ссылки', 'link') + cardGrid(
    field('mockupUrl', { placeholder: 'https://...', className: 'field' }),
    field('jiraLinks', { placeholder: 'https://...', className: 'field' })
  );
  return h;
}

function renderCreateTaskFormFields() {
  const priorities = [
    { value: 1, label: 'ВЫСОКИЙ' }, { value: 2, label: 'СРЕДНИЙ' }, { value: 3, label: 'НИЗКИЙ' }
  ];

  function select(id, opts, selected) {
    return `<select class="input ui-control task-detail-input" id="${id}">
      ${opts.map(o => `<option value="${escapeHtml(String(o.value))}" ${o.value === selected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }

  function input(id, type, val, placeholder) {
    return `<input type="${type}" class="input ui-control task-detail-input" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function textarea(id, val, placeholder, rows = 3) {
    return `<textarea class="input ui-control task-detail-input" id="${id}" rows="${rows}" placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(val || '')}</textarea>`;
  }

  function apiSelect(id) {
    return `<select class="input ui-control task-detail-input" id="${id}"><option value="">Загрузка...</option></select>`;
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
    <input type="text" class="input ui-control task-detail-input" id="create-title" placeholder="Введите название задачи" autofocus>
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
    <textarea class="input ui-control task-detail-input" id="create-description" rows="4" placeholder="Опишите задачу..."></textarea>
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
  html += field('Подразделение заказчика', apiSelect('create-customer-department'));
  html += field('Клиент ДИД', apiSelect('create-did-client'));
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
  activateTaskModalFocusTrap(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) requestCloseCreateTaskModal();
  });

  document.getElementById('create-close-btn')?.addEventListener('click', requestCloseCreateTaskModal);
  document.getElementById('create-cancel-btn')?.addEventListener('click', requestCloseCreateTaskModal);
  const handleCreateFormChange = event => {
    if (!_createTaskSaving) _createTaskRequestId = null;
    if (event.target?.id === 'create-title') _createDuplicateOverrideSignature = null;
    const control = event.target;
    if (event.type === 'change' && control?.type === 'url') control.value = trimTaskLinkEdges(control.value);
    if (control?.classList.contains('input-error')) {
      control.classList.remove('input-error');
      control.setAttribute('aria-invalid', 'false');
      const fieldError = document.getElementById(control.id + '-error');
      if (fieldError) fieldError.hidden = true;
    }
    if (!overlay.querySelector('.input-error')) clearTaskFormErrorSummary('create-form-error-summary');
    updateCreateTaskDirty();
    updateTaskCharacterCounters(overlay);
    updateCreateFormReadiness(event.target);
    if (event.target?.id === 'create-team') {
      document.getElementById('create-owner')?._dictionarySearchRefresh?.(userValuesForTeam(_createReferenceUsers, event.target.value));
    }
  };
  overlay.addEventListener('input', handleCreateFormChange);
  overlay.addEventListener('change', handleCreateFormChange);

  document.getElementById('create-save-btn')?.addEventListener('click', () => saveCreateTask(app));
  document.getElementById('create-clear-draft-btn')?.addEventListener('click', async () => {
    if (!_createTaskDirty) return;
    const confirmed = await confirmTaskCardDiscard('Все введённые данные новой задачи будут удалены. Очистить форму?');
    if (!confirmed) return;
    clearCreateTaskDraft();
    applyCreateTaskSnapshot(_createTaskInitialSnapshot);
    clearCreateApiErrors();
    _createTaskDirty = false;
    updateHeaderUnsavedIndicator('create-unsaved-indicator', false);
    updateCreateFormReadiness();
    document.getElementById('create-title')?.focus();
    window.toast?.('Форма очищена', 'info');
  });

  if (_createTaskKeyHandler) document.removeEventListener('keydown', _createTaskKeyHandler);
  _createTaskKeyHandler = async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!_createTaskSaving) saveCreateTask(app);
      return;
    }
    if (e.key === 'Escape') {
      const closed = await requestCloseCreateTaskModal();
      if (closed && _createTaskKeyHandler) {
        document.removeEventListener('keydown', _createTaskKeyHandler);
        _createTaskKeyHandler = null;
      }
    }
  };
  document.addEventListener('keydown', _createTaskKeyHandler);

  // Populate API selects
  await populateCreateSelects(app);
  _createTaskInitialSnapshot = createTaskFormSnapshot();
  _createTaskDirty = restoreCreateTaskDraft();
  updateTaskCharacterCounters(overlay);
  updateHeaderUnsavedIndicator('create-unsaved-indicator', _createTaskDirty, false, createTaskChangedFieldNames().length);
  updateCreateFormReadiness();
  attachDictionarySearch(overlay, [
    { selector: '#create-team', label: 'Ответственная команда' },
    { selector: '#create-project', label: 'Проект' },
    { selector: '#create-business-customer', label: 'Бизнес-заказчик' },
    { selector: '#create-owner', label: 'Исполнитель', preferredValues: userValuesForTeam(_createReferenceUsers, document.getElementById('create-team')?.value) },
  ]);
  if (_createTaskDirty) window.toast?.('Черновик новой задачи восстановлен', 'info');

  // Focus title
  setTimeout(() => {
    document.getElementById('create-title')?.focus();
  }, 100);
}

async function populateCreateSelects(app) {
  const api = app?.api || window.app?.api;
  if (!api) return;
  function populate(items, selectId, placeholder = 'Выберите', preferredName = '') {
    const select = document.getElementById(selectId);
    if (!select) return;
    const list = Array.isArray(items) ? items : [];
    select.innerHTML = '<option value="">' + escapeHtml(placeholder) + '</option>' + list.map(item => {
      const name = item.name || item.title || item.label || '';
      return '<option value="' + escapeHtml(String(item.id)) + '">' + escapeHtml(name) + '</option>';
    }).join('');
    const preferred = list.find(item => String(item.name || '').toLocaleUpperCase('ru-RU') === preferredName.toLocaleUpperCase('ru-RU'));
    if (preferred) select.value = String(preferred.id);
  }
  try {
    const ref = await api.get('/tasks/reference');
    _createReferenceUsers = Array.isArray(ref.users) ? ref.users : [];
    populate(ref.teams, 'create-team');
    const currentUser = app?.store?.get('currentUser') || window.app?.store?.get('currentUser');
    const teamSelect = document.getElementById('create-team');
    if (teamSelect && currentUser?.team_id != null && Array.from(teamSelect.options).some(option => option.value === String(currentUser.team_id))) {
      teamSelect.value = String(currentUser.team_id);
    }
    if(teamSelect && _createTaskContext.teamId!=null && Array.from(teamSelect.options).some(o=>o.value===String(_createTaskContext.teamId)))teamSelect.value=String(_createTaskContext.teamId);
    if(teamSelect && currentUser?.permissions?.task_edit==='team'){teamSelect.value=String(currentUser.team_id||'');teamSelect.disabled=true;}
    populate(ref.task_types, 'create-task-type');
    populate(ref.channels, 'create-channel');
    populate(ref.projects, 'create-project', 'Не выбран');
    populate(ref.priorities, 'create-priority', 'Выберите', 'СРЕДНИЙ');
    const prioritySelect = document.getElementById('create-priority');
    if (prioritySelect && !prioritySelect.value && ref.priorities?.length) prioritySelect.value = String(ref.priorities[0].id);
    populate(ref.deadlines, 'create-deadline', 'Не выбран');
    populate(ref.business_customers, 'create-business-customer', 'Не выбран');
    populate(ref.departments, 'create-customer-department', 'Не выбрано');
    populate(ref.did_client_groups, 'create-did-client', 'Не выбран');
    const allContacts = ref.business_customers || [];
    const contactSelect = document.getElementById('create-business-customer');
    const departmentSelect = document.getElementById('create-customer-department');
    departmentSelect?.addEventListener('change', () => {
      const preferred = departmentSelect.value ? allContacts.filter(i => Number(i.department_id) === Number(departmentSelect.value)) : allContacts;
      populate(preferred, 'create-business-customer', 'Не выбрано');
      if (preferred.length < allContacts.length) contactSelect.insertAdjacentHTML('beforeend', '<option value="__all">Показать всех контактных лиц…</option>');
    });
    contactSelect?.addEventListener('change', () => { if (contactSelect.value === '__all') populate(allContacts, 'create-business-customer', 'Не выбрано'); });
    populate(ref.users, 'create-owner', 'Не назначен');
  } catch (e) {
    window.toast?.('Не удалось загрузить справочники для создания задачи', 'error');
  }
}

function validateCreateForm() {
  let firstInvalid = null;
  createRequiredControls().forEach(control => {
    const id = control.id, error = document.getElementById(id + '-error');
    const empty = !String(control?.value || '').trim();
    control?.classList.toggle('input-error', empty);
    control?.setAttribute('aria-invalid', empty ? 'true' : 'false');
    if (error) error.hidden = !empty;
    if (empty) firstInvalid ||= control;
  });
  if (firstInvalid) focusTaskFormErrorTarget(firstInvalid);
  updateCreateFormReadiness();
  if (firstInvalid) showTaskFormErrorSummary('create-form-error-summary', 'Заполните обязательные поля перед созданием задачи.', firstInvalid);
  if (firstInvalid) return false;

  const receivedAt = document.getElementById('create-date-received')?.value || '';
  if (receivedAt && isTaskDateInFuture(receivedAt)) {
    const dateControl = showCreateApiFieldError('create-date-received', 'Дата поступления не может быть в будущем.');
    focusTaskFormErrorTarget(dateControl);
    showTaskFormErrorSummary('create-form-error-summary', 'Проверьте дату поступления задачи.', dateControl);
    return false;
  }
  return true;
}

function taskCharacterCounter(key, mode = 'create') {
  const meta = taskFormMeta(key);
  const selector = mode === 'create' ? `#${meta.createId}` : `[data-k="${key}"]`;
  return `<span class="task-character-counter" data-character-counter="${escapeHtml(selector)}" aria-live="polite">0 / ${meta.maxLength}</span>`;
}

function updateTaskCharacterCounters(root = document) {
  root?.querySelectorAll?.('[data-character-counter]').forEach(counter => {
    const control = root.querySelector(counter.dataset.characterCounter);
    if (!control) return;
    const length = String(control.value || '').length;
    const limit = Number(control.maxLength || 0);
    counter.textContent = `${length} / ${limit}`;
    counter.classList.toggle('near-limit', limit > 0 && length >= limit * 0.9);
  });
}

function trimTaskLinkEdges(value) {
  return String(value || '').trim();
}

const CREATE_API_FIELD_IDS = Object.freeze({
  title: 'create-title',
  team_id: 'create-team',
  task_type_id: 'create-task-type',
  channel_id: 'create-channel',
  date_received: 'create-date-received',
  priority_id: 'create-priority',
  project_id: 'create-project',
  business_customer_id: 'create-business-customer',
  owner_id: 'create-owner',
  deadline_id: 'create-deadline',
  link_mockups: 'create-link-mockups',
  link_jira: 'create-link-jira',
});

function clearCreateApiErrors() {
  document.querySelectorAll('#create-task-overlay .create-field-error').forEach(error => { error.hidden = true; });
  document.querySelectorAll('#create-task-overlay .input-error').forEach(control => {
    control.classList.remove('input-error');
    control.setAttribute('aria-invalid', 'false');
  });
}

function showCreateApiFieldError(id, message) {
  const control = document.getElementById(id);
  if (!control) return null;
  control.classList.add('input-error');
  control.setAttribute('aria-invalid', 'true');
  let error = document.getElementById(id + '-error');
  if (!error) {
    error = document.createElement('div');
    error.id = id + '-error';
    error.className = 'create-field-error';
    control.closest('.icell, .task-title-card, .field')?.appendChild(error);
  }
  error.textContent = message;
  error.hidden = false;
  control.setAttribute('aria-describedby', error.id);
  return control;
}

function applyCreateApiErrors(error) {
  const details = error?.data?.detail;
  if (!Array.isArray(details)) return false;
  clearCreateApiErrors();
  let firstInvalid = null;
  details.forEach(item => {
    const fieldName = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
    const id = CREATE_API_FIELD_IDS[fieldName];
    if (id) firstInvalid ||= showCreateApiFieldError(id, item.msg || 'Проверьте значение');
  });
  if (firstInvalid) focusTaskFormErrorTarget(firstInvalid);
  if (firstInvalid) showTaskFormErrorSummary('create-form-error-summary', 'Исправьте отмеченные поля и повторите создание.', firstInvalid);
  return Boolean(firstInvalid);
}

async function saveCreateTask(app) {
  if (_createTaskSaving) return;
  if (isTaskNetworkOffline()) {
    window.toast?.('Нет подключения. Сохранение станет доступно после восстановления сети.', 'info');
    updateTaskNetworkState();
    return;
  }
  clearCreateApiErrors();
  clearTaskFormErrorSummary('create-form-error-summary');
  if (!validateCreateForm()) {
    window.toast?.('Заполните обязательные поля', 'error');
    return;
  }

  const api = app?.api || window.app?.api;
  if (!api) return;

  const saveBtn = document.getElementById('create-save-btn');
  if (saveBtn) {
    _createTaskSaving = true;
    updateHeaderUnsavedIndicator('create-unsaved-indicator', _createTaskDirty, true, createTaskChangedFieldNames().length);
    setButtonBusy(saveBtn, true, 'Создаём…');
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
    client_request_id: _createTaskRequestId || (_createTaskRequestId = newTaskRequestId()),
    title: document.getElementById('create-title')?.value?.trim() || '',
    team_id: getInt('create-team'),
    priority_id: getInt('create-priority'),
    description: document.getElementById('create-description')?.value?.trim() || null,
    task_type_id: getInt('create-task-type'),
    channel_id: getInt('create-channel'),
    project_id: getInt('create-project'),
    business_customer_id: getInt('create-business-customer'),
    department_id: getInt('create-customer-department'),
    did_client_group_id: getInt('create-did-client'),
    owner_id: getInt('create-owner'),
    deadline_id: getInt('create-deadline'),
    date_received: document.getElementById('create-date-received')?.value || null,
    effort_days: getInt('create-effort-days'),
    effort_rub: getFloat('create-effort-rub'),
    financial_effect: getFloat('create-financial-effect'),
    link_mockups: trimTaskLinkEdges(document.getElementById('create-link-mockups')?.value) || null,
    link_jira: trimTaskLinkEdges(document.getElementById('create-link-jira')?.value) || null,
    comment: document.getElementById('create-comment')?.value || null,
  };

  // Remove null/undefined
  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) delete data[key];
  });

  try {
    setButtonBusy(saveBtn, true, 'Проверяем дубликаты…');
    const proceedAfterDuplicateCheck = await confirmCreateTaskIsNotDuplicate(app, data.title);
    if (!proceedAfterDuplicateCheck) {
      document.getElementById('create-title')?.focus();
      return;
    }
    setButtonBusy(saveBtn, true, 'Создаём…');
    const createdTask = await runTaskSaveWithSingleRetry(
      () => taskSaveRequestWithTimeout(signal => api.post('/tasks/', data, { signal })),
      () => { setButtonBusy(saveBtn, true, 'Повторяем…'); }
    );
    clearCreateTaskDraft();
    _createTaskRequestId = null;
    _createTaskDirty = false;
    closeCreateTaskModal();
    if (onSaveCallback) {
      try { await Promise.resolve(onSaveCallback()); } catch (refreshError) { console.warn('Task list refresh failed:', refreshError); }
    }
    window.toast?.('Задача создана', 'success');
    setTimeout(async () => {
      let taskToOpen = createdTask;
      if (createdTask?.id) {
        try { taskToOpen = await api.get(`/tasks/${createdTask.id}`); } catch (_) { /* create response is sufficient */ }
      }
      if (taskToOpen?.id) openTaskModal(taskToOpen);
    }, 240);
  } catch (e) {
    if (applyCreateApiErrors(e)) window.toast?.('Исправьте отмеченные поля', 'error');
    else {
      const message = 'Не удалось создать задачу: ' + (e.message || 'ошибка сервера');
      showTaskFormErrorSummary('create-form-error-summary', message, document.getElementById('create-title'));
      if (isRetryableTaskSaveError(e)) addTaskSaveRetryAction('create-form-error-summary', () => saveCreateTask(app));
      window.toast?.(message, 'error');
    }
  } finally {
    _createTaskSaving = false;
    updateHeaderUnsavedIndicator('create-unsaved-indicator', _createTaskDirty, false, createTaskChangedFieldNames().length);
    setButtonBusy(saveBtn, false);
    updateCreateFormReadiness();
  }
}

// ============================================================
//  COMMENTS FUNCTIONALITY
// ============================================================

function currentCommentTaskId(taskId = currentTask?.id) {
  const id = Number(taskId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function renderReplyIndicator(reply = _replyingTo) {
  const indicator = document.getElementById('reply-indicator');
  if (!indicator) return;
  indicator.style.display = reply ? 'flex' : 'none';
  const text = indicator.querySelector('.reply-indicator-text');
  if (text) text.textContent = reply ? `Ответ на ${reply.name || 'комментарий'}` : '';
}

function updateCommentDraftStatus(taskId = currentTask?.id) {
  const status = document.getElementById('comment-draft-status');
  if (!status) return;
  status.hidden = !_taskCommentDraftSession.hasChanges(taskId);
}

window.__setReplyTo = function(commentId, userName) {
  const permission = cardCommentPermission();
  if (!permission.allowed) {
    window.toast?.(permission.reason, 'warning');
    return;
  }
  const taskId = currentCommentTaskId();
  if (!taskId) return;
  _taskCommentDraftSession.begin(taskId);
  const draft = _taskCommentDraftSession.setReply(commentId, userName);
  _replyingTo = draft.reply;
  renderReplyIndicator();
  updateCommentDraftStatus(taskId);
  const textarea = document.getElementById('comment-textarea');
  if (textarea) textarea.focus();
};

window.__cancelReply = cancelReply;

function cancelReply() {
  const taskId = currentCommentTaskId();
  if (taskId && _taskCommentDraftSession.snapshot(taskId)) {
    _taskCommentDraftSession.begin(taskId);
    _taskCommentDraftSession.clearReply();
  }
  _replyingTo = null;
  renderReplyIndicator();
  updateCommentDraftStatus(taskId);
}

async function loadComments(taskId, app) {
  const api = app?.api || window.app?.api;
  if (!api || !taskId) return;
  const requestedTaskId = Number(taskId);
  const sequence = ++_commentsLoadSequence;
  _commentTaskId = requestedTaskId;
  try {
    const [commentsData, usersData] = await Promise.allSettled([
      api.get(`/tasks/${taskId}/comments`),
      api.get('/users/'),
    ]);
    if (Number(currentTask?.id) !== requestedTaskId || sequence !== _commentsLoadSequence) return;
    if (commentsData.status === 'fulfilled') {
      _commentsCache = commentsData.value.items || [];
      _commentsLoadedTaskId = requestedTaskId;
      cardState.commentsCount = cardCommentCount(_commentsCache);
      cardRenderTabs();
    } else {
      console.error('Failed to load comments:', commentsData.reason);
      _commentsCache = [];
      _commentsLoadedTaskId = null;
    }
    if (usersData.status === 'fulfilled') {
      const raw = usersData.value.items || usersData.value || [];
      _usersCache = Array.isArray(raw) ? raw.filter(u => u.is_active !== false) : [];
    } else {
      console.error('Failed to load users:', usersData.reason);
    }
    renderCommentList();
  } catch (e) {
    if (Number(currentTask?.id) !== requestedTaskId) return;
    console.error('Failed to load comments:', e);
    const container = document.getElementById('comments-list-container');
    if (container) container.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">Не удалось загрузить комментарии</div>';
  }
}

function renderCommentList() {
  const container = document.getElementById('comments-list-container');
  renderComments(container, _commentsCache, _usersCache, { canReply: cardCommentPermission().allowed, variant: 'task-detail' });
  const targetId = parseCommentTarget(window.location.hash);
  const targetKey = targetId && currentTask?.id ? `${currentTask.id}:${targetId}` : null;
  if (container && _commentsLoadedTaskId === Number(currentTask?.id) && cardState.tab === 'com' && targetKey && _commentTargetHandled !== targetKey) {
    requestAnimationFrame(() => {
      if (!container.isConnected || container !== document.getElementById('comments-list-container') || cardState.tab !== 'com' || `${currentTask?.id}:${parseCommentTarget(window.location.hash)}` !== targetKey || _commentTargetHandled === targetKey) return;
      const focused = focusCommentTarget(container, targetId);
      _commentTargetHandled = targetKey;
      if (!focused) {
        cardToast('Комментарий по ссылке не найден или больше недоступен', 'warn');
        (document.getElementById('comment-textarea') || document.getElementById('task-tab-com'))?.focus({ preventScroll: true });
      }
    });
  }
}

let _commentFormInitialized = false;

function initCommentForm(taskId, app) {
  if (_commentFormInitialized) return;
  const permission = cardCommentPermission();
  if (!permission.allowed) return;
  const textarea = document.getElementById('comment-textarea');
  const submitBtn = document.getElementById('comment-submit-btn');
  const dropdown = document.getElementById('mention-dropdown');
  if (!textarea || !submitBtn || !dropdown) return;
  const activeTaskId = currentCommentTaskId(taskId);
  if (!activeTaskId) return;
  _commentFormInitialized = true;
  dropdown._uiPopover = createPopover({ trigger: textarea, panel: dropdown, role: 'listbox', label: 'Пользователи для упоминания', focus: false,
    onClose: () => { textarea.removeAttribute('aria-activedescendant'); _mentionSelectedIdx = -1; } });

  const draft = _taskCommentDraftSession.begin(activeTaskId);
  textarea.value = draft.text;
  _mentionedUserIds = [...draft.mentionedUserIds];
  _replyingTo = draft.reply;
  submitBtn.disabled = !textarea.value.trim();
  renderReplyIndicator();
  updateCommentDraftStatus(activeTaskId);

  textarea.addEventListener('input', () => {
    _taskCommentDraftSession.begin(activeTaskId);
    _taskCommentDraftSession.setText(textarea.value);
    _mentionedUserIds = _mentionedUserIds.filter(userId => {
      const user = _usersCache.find(item => Number(item.id) === Number(userId));
      const name = user?.name || user?.login || user?.email;
      return !name || textarea.value.includes(`@${name}`);
    });
    _taskCommentDraftSession.setMentionedUserIds(_mentionedUserIds);
    submitBtn.disabled = !textarea.value.trim();
    updateCommentDraftStatus(activeTaskId);
    detectMention(textarea, dropdown);
  });

  textarea.addEventListener('keydown', (e) => {
    const isOpen = dropdown._uiPopover?.isOpen === true;
    if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = dropdown.querySelectorAll('.mention-item');
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') _mentionSelectedIdx = Math.min(_mentionSelectedIdx + 1, items.length - 1);
      else _mentionSelectedIdx = Math.max(_mentionSelectedIdx - 1, 0);
      setMentionSelection(textarea, dropdown, _mentionSelectedIdx);
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
      hideMentionDropdown(textarea, dropdown);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !isOpen) {
      e.preventDefault();
      submitComment(taskId, app);
    }
  });

  textarea.addEventListener('blur', () => {
    setTimeout(() => hideMentionDropdown(textarea, dropdown), 150);
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

function hideMentionDropdown(textarea, dropdown) {
  dropdown?._uiPopover?.close({ restoreFocus: false });
  textarea?.setAttribute('aria-expanded', 'false');
  textarea?.removeAttribute('aria-activedescendant');
  _mentionSelectedIdx = -1;
}

function setMentionSelection(textarea, dropdown, index) {
  const items = Array.from(dropdown?.querySelectorAll('.mention-item') || []);
  items.forEach((item, itemIndex) => {
    const selected = itemIndex === index;
    item.classList.toggle('selected', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  const active = items[index];
  if (active?.id) textarea?.setAttribute('aria-activedescendant', active.id);
  else textarea?.removeAttribute('aria-activedescendant');
}

function detectMention(textarea, dropdown) {
  const val = textarea.value;
  const pos = textarea.selectionStart;
  const textBefore = val.substring(0, pos);
  const atIndex = textBefore.lastIndexOf('@');
  if (atIndex === -1) {
    hideMentionDropdown(textarea, dropdown);
    return;
  }
  const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : '';
  if (charBefore !== '' && charBefore !== ' ' && charBefore !== '\n') {
    hideMentionDropdown(textarea, dropdown);
    return;
  }
  const query = textBefore.substring(atIndex + 1);
  if (query.includes(' ') || query.includes('\n')) {
    hideMentionDropdown(textarea, dropdown);
    return;
  }
  const lq = query.toLowerCase();
  const filtered = _usersCache.filter(u => {
    const name = (u.name || '').toLowerCase();
    const login = (u.login || u.email || '').toLowerCase();
    return name.includes(lq) || login.includes(lq);
  }).slice(0, 8);
  if (filtered.length === 0) {
    hideMentionDropdown(textarea, dropdown);
    return;
  }
  _mentionQueryStart = atIndex;
  _mentionSelectedIdx = 0;
  renderMentionOptions(dropdown, filtered);
  dropdown._uiPopover?.open();
  dropdown._uiPopover?.position();
  textarea.setAttribute('aria-expanded', 'true');
  setMentionSelection(textarea, dropdown, 0);
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
  const taskId = currentCommentTaskId();
  if (taskId) {
    _taskCommentDraftSession.begin(taskId);
    _taskCommentDraftSession.setText(newText);
    _taskCommentDraftSession.setMentionedUserIds(_mentionedUserIds);
  }
  hideMentionDropdown(textarea, dropdown);
  const submitBtn = document.getElementById('comment-submit-btn');
  if (submitBtn) submitBtn.disabled = !textarea.value.trim();
  updateCommentDraftStatus(taskId);
}

async function submitComment(taskId, app) {
  const permission = cardCommentPermission();
  if (!permission.allowed) {
    window.toast?.(permission.reason, 'warning');
    return;
  }
  const api = app?.api || window.app?.api;
  const textarea = document.getElementById('comment-textarea');
  const submitBtn = document.getElementById('comment-submit-btn');
  const activeTaskId = currentCommentTaskId(taskId);
  if (!api || !textarea || !submitBtn || !activeTaskId || !cardMatchesCurrentTask(activeTaskId) || _commentSubmitting) return;

  _taskCommentDraftSession.begin(activeTaskId);
  _taskCommentDraftSession.setText(textarea.value);
  _taskCommentDraftSession.setMentionedUserIds(_mentionedUserIds);
  if (_replyingTo) _taskCommentDraftSession.setReply(_replyingTo);
  const submittedDraft = _taskCommentDraftSession.current();
  const text = submittedDraft.text.trim();
  if (!text) return;
  const request = _taskCardRequestGate.start('comment-submit', activeTaskId);

  _commentSubmitting = true;
  submitBtn.disabled = true;
  submitBtn.setAttribute('aria-busy', 'true');
  submitBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>Отправка...';

  try {
    const payload = { text };
    if (submittedDraft.mentionedUserIds.length > 0) {
      payload.mentioned_user_ids = [...submittedDraft.mentionedUserIds];
    }
    if (submittedDraft.reply) {
      payload.parent_id = submittedDraft.reply.id;
    }
    const fingerprint = JSON.stringify(payload);
    if (!_pendingCommentSubmission || _pendingCommentSubmission.fingerprint !== fingerprint) {
      _pendingCommentSubmission = { fingerprint, id: newTaskRequestId() };
    }
    payload.client_request_id = _pendingCommentSubmission.id;
    const submissionId = _pendingCommentSubmission.id;
    await api.post(`/tasks/${activeTaskId}/comments`, payload, { signal: request.signal });
    if (!_taskCardRequestGate.isCurrent(request.token, activeTaskId) || !cardMatchesCurrentTask(activeTaskId)) return;
    if (_pendingCommentSubmission?.id === submissionId) _pendingCommentSubmission = null;
    const latestDraft = _taskCommentDraftSession.snapshot(activeTaskId);
    const unchanged = latestDraft
      && latestDraft.text === submittedDraft.text
      && JSON.stringify(latestDraft.mentionedUserIds) === JSON.stringify(submittedDraft.mentionedUserIds)
      && JSON.stringify(latestDraft.reply) === JSON.stringify(submittedDraft.reply);
    if (unchanged) {
      _taskCommentDraftSession.clear(activeTaskId);
      if (Number(currentTask?.id) === activeTaskId) _taskCommentDraftSession.begin(activeTaskId);
      const activeTextarea = document.getElementById('comment-textarea');
      if (activeTextarea) activeTextarea.value = '';
      textarea.value = '';
      _mentionedUserIds = [];
      _replyingTo = null;
      renderReplyIndicator();
    }
    updateCommentDraftStatus(activeTaskId);
    window.toast?.('Комментарий добавлен', 'success');
    await loadComments(activeTaskId, app);
  } catch (e) {
    if (request.signal.aborted || e?.name === 'AbortError' || !_taskCardRequestGate.isCurrent(request.token, activeTaskId)) return;
    window.toast?.('Ошибка: ' + (e.message || 'не удалось отправить'), 'error');
  } finally {
    if (_taskCardRequestGate.finish(request.token) && cardMatchesCurrentTask(activeTaskId)) {
      _commentSubmitting = false;
      const activeSubmit = document.getElementById('comment-submit-btn') || submitBtn;
      const activeTextarea = document.getElementById('comment-textarea') || textarea;
      activeSubmit.disabled = !activeTextarea.value.trim();
      activeSubmit.removeAttribute('aria-busy');
      submitBtn.disabled = !activeTextarea.value.trim();
      submitBtn.removeAttribute('aria-busy');
      submitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Отправить';
    }
  }
}

async function requestCloseCreateTaskModal() {
  if (_createTaskSaving) {
    window.toast?.('Дождитесь завершения создания задачи', 'info');
    return false;
  }
  if (_createTaskDirty) {
    const confirmed = await confirmTaskCardDiscard('Форма будет закрыта. Введённые данные сохранятся в черновике. Закрыть форму?');
    if (!confirmed) return false;
  }
  closeCreateTaskModal();
  return true;
}

function closeCreateTaskModal() {
  deactivateTaskModalFocusTrap();
  if (_createTaskKeyHandler) {
    document.removeEventListener('keydown', _createTaskKeyHandler);
    _createTaskKeyHandler = null;
  }
  const returnFocus = takeTaskModalReturnFocus();
  _createTaskDirty = false;
  _createTaskInitialSnapshot = '';
  const overlay = document.getElementById('create-task-overlay');
  if (overlay) {
    overlay.classList.add('modal-closing');
    setTimeout(() => {
      overlay.remove();
      currentTask = null;
      modalMode = 'view';
      restoreTaskModalReturnFocus(returnFocus);
    }, 200);
  }
}

// Legacy API
export function closeModal() { closeTaskDetailModal(); }
export function openConfirmModal(message, onConfirm) { /* not needed in new version */ }

export function showConfirmModal(message, title = 'Подтверждение', okText = 'ОК', cancelText = 'Отмена', danger = false) {
  return new Promise((resolve) => {
    const existing = document.getElementById('confirm-modal-overlay');
    if (existing) {existing.querySelector('#confirm-cancel')?.click();existing.remove();}
    const focusOrigin=document.activeElement;let settled=false;

    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1200';

    overlay.innerHTML = `
      <div class="app-modal app-modal--small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-message">
        <div class="app-modal__header"><h3 class="app-modal__title" id="confirm-modal-title">${escapeHtml(title)}</h3></div>
        <div class="app-modal__body"><p class="app-modal__subtitle" id="confirm-modal-message">${escapeHtml(message)}</p></div>
        <div class="app-modal__footer">
          <button type="button" class="btn btn-secondary btn-sm" id="confirm-cancel" data-modal-close>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" id="confirm-ok">${escapeHtml(okText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('#confirm-ok');
    const cancelBtn = overlay.querySelector('#confirm-cancel');

    if (danger) cancelBtn?.focus();
    else okBtn?.focus();

    function finish(answer){if(settled)return;settled=true;document.removeEventListener('keydown',handleKeydown);overlay.remove();if(focusOrigin?.isConnected)focusOrigin.focus();resolve(answer);}
    function handleOk(){finish(true);}
    function handleCancel(){finish(false);}

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

function showEditExitModal() {
  return new Promise(resolve => {
    document.getElementById('confirm-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '1200';
    overlay.innerHTML = `
      <div class="app-modal app-modal--medium" role="alertdialog" aria-modal="true" aria-labelledby="edit-exit-title">
        <div class="app-modal__header"><h3 class="app-modal__title" id="edit-exit-title">Отменить изменения?</h3></div>
        <div class="app-modal__body"><p class="app-modal__subtitle">Все несохранённые изменения будут потеряны. Это действие нельзя отменить.</p></div>
        <div class="app-modal__footer">
          <button type="button" class="btn btn-secondary btn-sm" data-edit-exit="continue">Продолжить редактирование</button>
          <button type="button" class="btn btn-primary btn-sm" data-edit-exit="save">Сохранить изменения</button>
          <button type="button" class="btn btn-danger btn-sm" data-edit-exit="discard">Отменить изменения</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    let settled = false;
    const finish = decision => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      resolve(decision);
    };
    const handleKeydown = event => {
      if (event.key === 'Escape') finish('continue');
    };

    overlay.querySelectorAll('[data-edit-exit]').forEach(button => {
      button.addEventListener('click', () => finish(button.dataset.editExit));
    });
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish('continue');
    });
    document.addEventListener('keydown', handleKeydown);
    overlay.querySelector('[data-edit-exit="save"]')?.focus();
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
          <table class="ui-table ui-table-data" style="width:100%">
            <thead>
              <tr style="border-bottom:2px solid var(--border-color);">
                <th style="text-align:left;white-space:nowrap">ID задачи</th>
                <th style="text-align:left">Атрибут</th>
                <th style="text-align:center;white-space:nowrap">Код</th>
                <th style="text-align:left">Описание</th>
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
                    <td style="vertical-align:top">
                      <strong style="font-family:var(--font-mono);">${formatTaskPublicId(d.taskId)}</strong>
                    </td>
                    <td style="vertical-align:top">
                      <span style="font-size:13px;">${escapeHtml(d.fields || '—')}</span>
                    </td>
                    <td style="text-align:center;vertical-align:top">
                      <span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;color:${badgeColor};background:${badgeBg};">
                        ${d.httpStatus}
                      </span>
                      <div style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted);margin-top:3px;">${escapeHtml(info.label)}</div>
                    </td>
                    <td style="vertical-align:top">
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
      <div class="app-modal ${isDetailed ? 'app-modal--large' : 'app-modal--medium'}" role="dialog" aria-modal="true" aria-labelledby="error-modal-title">
        <div class="app-modal__header">
          <h3 class="app-modal__title" id="error-modal-title">Результат сохранения</h3>
          <button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" data-modal-close aria-label="Закрыть">&times;</button>
        </div>
        <div class="app-modal__body">
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
        </div>
        <div class="app-modal__footer">
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
    overlay.querySelector('[data-modal-close]')?.addEventListener('click', handleClose);
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
  'ownership': { label: 'Принадлежность', fields: ['team_id', 'project_id', 'task_type_id', 'channel_id', 'department_id', 'business_customer_id', 'did_client_group_id'] },
  'meetings': { label: 'Для встреч', fields: ['key_project_status', 'directorate_status', 'did_status'] },
  'estimation': { label: 'Оценка', fields: ['effort_days', 'effort_rub', 'financial_effect'] },
  'text_links': { label: 'Тексты и ссылки', fields: ['rejection_reason', 'comment_add', 'link_jira', 'link_mockups'] },
  'tags': { label: 'Метки', fields: ['tags_add', 'tags_remove'] }
};

const FIELD_LABELS_BULK = {
  did_client_group_id: 'Клиент ДИД',
  status_id: 'Статус', priority_id: 'Приоритет', progress: 'Прогресс %',
  deadline_id: 'Дедлайн', date_received: 'Дата получения',
  owner_id: 'Владелец',
  team_id: 'Команда', project_id: 'Проект', task_type_id: 'Тип задачи', channel_id: 'Канал', department_id: 'Подразделение', business_customer_id: 'Бизнес-заказчик',
  key_project_status: 'Статус ключ. проекта', directorate_status: 'Статус для директорской', did_status: 'Статус для ДИД',
  effort_days: 'Трудозатраты дни', effort_rub: 'Трудозатраты руб', financial_effect: 'Фин. эффект',
  rejection_reason: 'Причина отклонения', comment_add: 'Добавить комментарий', link_jira: 'Ссылка на Jira', link_mockups: 'Ссылка на макеты',
  tags_add: 'Добавить теги', tags_remove: 'Удалить теги'
};

const FIELD_TYPES_BULK = {
  did_client_group_id: 'select',
  status_id: 'select', priority_id: 'select', progress: 'number',
  deadline_id: 'select', date_received: 'date',
  owner_id: 'select',
  team_id: 'select', project_id: 'select', task_type_id: 'select', channel_id: 'select', department_id: 'select', business_customer_id: 'select',
  key_project_status: 'select', directorate_status: 'text', did_status: 'text',
  effort_days: 'number', effort_rub: 'number', financial_effect: 'number',
  rejection_reason: 'textarea', comment_add: 'comment', link_jira: 'text', link_mockups: 'text',
  tags_add: 'tags', tags_remove: 'tags'
};

const FIELD_HINTS_BULK = {
  tags_add: 'Существующие теги сохранятся',
  tags_remove: 'Остальные теги не изменятся',
  status_id: 'Статус изменится у всех выбранных задач',
  team_id: 'Доступность зависит от ваших прав на команды',
  owner_id: 'Один владелец будет назначен всем задачам',
  comment_add: 'Комментарий будет добавлен в ленту каждой задачи, существующие комментарии сохранятся',
};

function hasBulkValue(value) {
  return !(value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0));
}

function bulkPluralize(n, one, few, many) {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function formatBulkValue(field, value) {
  if (!hasBulkValue(value)) return 'значение не задано';
  if (Array.isArray(value)) return value.join(', ');
  const sources = {
    status_id: window.app?.statuses,
    priority_id: window.app?.priorities,
    team_id: window.app?.teams,
    deadline_id: window.app?.deadlines,
    task_type_id: window.app?.taskTypes,
    channel_id: window.app?.channels,
    department_id: window.app?.departments,
    project_id: window.app?.projects,
    owner_id: window.app?.users,
    business_customer_id: window.app?.businessCustomers,
    did_client_group_id: window.app?.didClientGroups,
  };
  const item = (sources[field] || []).find(option => option.id == value);
  return item?.name || item?.label || String(value);
}

function renderBulkSummary(selectedFields, selected) {
  const configured = selectedFields.filter(item => hasBulkValue(item.value));
  if (configured.length === 0) {
    return '<span style="color:var(--text-muted);font-size:13px;">Пока нечего применять — добавьте поле и задайте новое значение.</span>';
  }
  return `
    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;">
      <strong style="font-size:13px;color:var(--text-primary);">Итог изменений</strong>
      <span style="font-size:12px;color:var(--text-muted);">${selected} ${bulkPluralize(selected, 'задача', 'задачи', 'задач')}</span>
    </div>
    <div style="display:grid;gap:5px;">${configured.map(item => `
      <div style="display:grid;grid-template-columns:minmax(130px,1fr) 1.4fr;gap:8px;font-size:12px;">
        <span style="color:var(--text-secondary);">${escapeHtml(FIELD_LABELS_BULK[item.field] || item.field)}</span>
        <strong style="color:var(--text-primary);overflow-wrap:anywhere;">→ ${escapeHtml(formatBulkValue(item.field, item.value))}</strong>
      </div>`).join('')}
    </div>`;
}

const REQUIRES_REASON_STATUSES_BULK = ['ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА', 'ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ'];

function showBulkResultModal(result, tasks, fallbackError = '') {
  const existing = document.getElementById('bulk-result-overlay');
  existing?.remove();
  const taskMap = new Map((tasks || []).map(task => [Number(task.id), task]));
  const groups = [
    { key: 'changed', label: 'Изменено', ids: result?.changed_task_ids || [], color: 'var(--success)' },
    { key: 'unchanged', label: 'Без изменений', ids: result?.unchanged_task_ids || [], color: 'var(--text-muted)' },
    { key: 'error', label: result?.outcome_unknown?'Требуют проверки':'Ошибка', ids: result?.error_task_ids || [], color: 'var(--danger)', errors: result?.errors || (fallbackError ? [fallbackError] : []) },
  ].filter(group => group.ids.length || group.errors?.length);
  const overlay = document.createElement('div');
  overlay.id = 'bulk-result-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '1110';
  const groupHtml = groups.map((group, index) => `
    <details ${index === 0 || group.key === 'error' ? 'open' : ''} style="border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">
      <summary class="ui-disclosure-text" style="cursor:pointer;padding:10px 12px;font-size:13px;font-weight:600;color:${group.color};">${group.label} · ${group.ids.length}</summary>
      <div style="padding:0 12px 12px;display:grid;gap:6px;max-height:190px;overflow:auto;">
        ${(group.errors || []).map(error => `<div style="font-size:12px;color:var(--danger);">${escapeHtml(error)}</div>`).join('')}
        ${group.ids.map(id => `<div style="display:grid;grid-template-columns:130px 1fr;gap:8px;font-size:12px;"><span style="font-family:var(--font-mono);color:var(--text-muted);">${formatTaskPublicId(taskMap.get(Number(id)) || id)}</span><span>${escapeHtml(taskMap.get(Number(id))?.title || 'Задача')}</span></div>`).join('')}
      </div>
      ${group.key === 'error' && group.ids.length ? `<div style="padding:0 12px 10px;text-align:right;"><button class="btn btn-secondary btn-xs" data-copy-error-ids>Копировать ID</button></div>` : ''}
    </details>`).join('');
  overlay.innerHTML = `<div class="modal modal-md" role="dialog" aria-modal="true" aria-labelledby="bulk-result-title">
    <div class="modal-header"><div><div class="modal-title" id="bulk-result-title">Результат массовой операции</div><div class="app-modal__subtitle">${result?.operation_id ? `Операция ${escapeHtml(result.operation_id.slice(0, 8))}` : result?.outcome_unknown?'Результат не подтверждён. Проверьте задачи перед повтором.':'Операция не выполнена'}</div></div><button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" data-modal-close aria-label="Закрыть">&times;</button></div>
    <div class="modal-body" style="display:grid;gap:8px;">${groupHtml || '<div style="font-size:13px;color:var(--text-muted);">Нет данных о результате</div>'}</div>
    <div class="modal-footer"><button class="btn btn-primary btn-sm" data-close-bulk-result>Закрыть</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('[data-close-bulk-result]')?.addEventListener('click', close);
  overlay.querySelector('[data-modal-close]')?.addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.querySelector('[data-copy-error-ids]')?.addEventListener('click', async () => {
    const ids = (result?.error_task_ids || []).join(', ');
    try { await navigator.clipboard.writeText(ids); window.toast?.('ID скопированы', 'success'); }
    catch (_) { window.toast?.(`ID: ${ids}`, 'warning'); }
  });
  overlay.querySelector('[data-close-bulk-result]')?.focus();
}

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
    const totalPages = Math.max(1, Math.ceil(totalTasks / PAGE_SIZE));

    function showBulkError(message) {
      const error = overlay.querySelector('#bc-error');
      if (error) { error.textContent = message; error.hidden = false; }
    }

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
        const selectAllDisabled = selected === totalTasks;
        const clearAllDisabled = selected === 0;

        let rowsHtml = '';
        const tasksToShow = getPageTasks();
        for (const t of tasksToShow) {
          const isOff = excluded.has(t.id);
          rowsHtml += `
            <div class="bc-row ${isOff ? 'bc-row-off' : ''}" data-task-id="${t.id}" style="gap:0;border-bottom:1px solid var(--border-color);cursor:pointer;">
              <div style="display:flex;align-items:center;justify-content:center;padding:8px;">
                <input type="checkbox" class="bc-cb" value="${t.id}" aria-label="Выбрать ${escapeHtml(formatTaskPublicId(t))}" ${isOff ? '' : 'checked'} style="margin:0;accent-color:var(--accent);">
              </div>
              <div style="padding:8px;font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${formatTaskPublicId(t)}</div>
              <div class="bc-task-title" style="padding:8px;font-size:13px;overflow-wrap:anywhere;">${escapeHtml(t.title || '—')}</div>
              <div style="padding:8px;font-size:12px;color:var(--text-secondary);">${escapeHtml(t.status_name || t.status || '—')}</div>
              <div style="padding:8px;font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums;">${escapeHtml(t.deadline_name || t.deadline || '—')}</div>
            </div>
          `;
        }

        const paginationHtml = kitPagination({page:currentPage,pages:totalPages,label:'Страницы выбранных задач',previousAttrs:{id:'bc-page-prev'},nextAttrs:{id:'bc-page-next'}});

        const emptyMsg = totalTasks === 0 ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">В текущем фильтре нет задач. Закройте окно и измените фильтр в реестре.</div>` : '';

        bodyContent = `
          <div class="bc-selection" style="padding:12px 16px 16px 16px;">
            <p style="margin:0 0 12px 0;font-size:13px;color:var(--text-secondary);line-height:1.5;">В список попали задачи с учетом примененных на странице фильтров. Выберите из них те, по которым хотите сделать массовую корректировку атрибутов.</p>
            <div class="bc-selection-controls" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-shrink:0;">
              <span style="font-size:14px;">Выбрано <strong id="bc-count" style="color:var(--accent);">${selected}</strong> из ${totalTasks}</span>
              <div style="display:flex;gap:12px;font-size:13px;">
                <button id="bc-select-all" class="btn btn-secondary btn-sm ui-btn bc-link-btn" ${selectAllDisabled ? 'disabled style="opacity:.5"' : ''}>Выбрать все</button>
                <span style="color:var(--text-muted);">·</span>
                <button id="bc-clear-all" class="btn btn-secondary btn-sm ui-btn bc-link-btn" ${clearAllDisabled ? 'disabled style="opacity:.5"' : ''}>Снять все</button>
              </div>
            </div>
            <div class="bc-task-list" style="border-radius:8px;border:1px solid var(--border-color);overflow:hidden;">
              <div class="bc-table-head" style="gap:0;background:var(--bg-tertiary);border-radius:8px 8px 0 0;flex-shrink:0;">
                <div style="padding:8px;"></div>
                <div style="padding:8px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);uppercase;letter-spacing:.06em;color:var(--text-muted);">ID</div>
                <div style="padding:8px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);uppercase;letter-spacing:.06em;color:var(--text-muted);">ЗАДАЧА</div>
                <div style="padding:8px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);uppercase;letter-spacing:.06em;color:var(--text-muted);">СТАТУС</div>
                <div style="padding:8px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);uppercase;letter-spacing:.06em;color:var(--text-muted);">СРОК</div>
              </div>
              <div class="bc-rows-container" style="padding-left:4px;">
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
            controlHtml = `<select class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" style="width:100%;box-sizing:border-box">${opts}</select>`;
          } else if (ftype === 'select_yesno') {
            controlHtml = `<select class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" style="width:100%;box-sizing:border-box"><option value="">—</option><option value="true">Да</option><option value="false">Нет</option></select>`;
          } else if (ftype === 'number') {
            controlHtml = `<input type="number" class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" value="${item.value ?? ''}" placeholder="0" style="width:100%;box-sizing:border-box">`;
          } else if (ftype === 'date') {
            controlHtml = `<input type="date" class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" value="${item.value ?? ''}" style="width:100%;box-sizing:border-box">`;
          } else if (ftype === 'comment') {
            const mentionOptions = (window.app?.users || []).map(user =>
              `<option value="${user.id}" ${(item.mentionedUserIds || []).includes(user.id) ? 'selected' : ''}>${escapeHtml(user.name)}</option>`
            ).join('');
            controlHtml = `<textarea class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" rows="3" maxlength="5000" placeholder="Введите комментарий" style="width:100%;box-sizing:border-box;resize:vertical">${escapeHtml(item.value || '')}</textarea>
              <label style="display:block;margin-top:8px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted);">Упомянуть пользователей</label>
              <select multiple class="input ui-control bc-comment-mentions" data-field="${item.field}" aria-label="Упомянуть пользователей" size="3" style="width:100%;margin-top:4px;box-sizing:border-box">${mentionOptions}</select>`;
          } else if (ftype === 'textarea') {
            controlHtml = `<textarea class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" rows="2" placeholder="Введите значение" style="width:100%;box-sizing:border-box;resize:none">${escapeHtml(item.value || '')}</textarea>`;
          } else if (ftype === 'tags') {
            controlHtml = `<input type="text" class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" value="${escapeHtml(Array.isArray(item.value) ? item.value.join(', ') : (item.value || ''))}" placeholder="Введите теги через запятую" style="width:100%;box-sizing:border-box">`;
          } else {
            controlHtml = `<input type="text" class="input ui-control bc-field-val" data-field="${item.field}" aria-label="${escapeHtml(fl)}" value="${escapeHtml(item.value || '')}" placeholder="Введите значение" style="width:100%;box-sizing:border-box">`;
          }

          fieldsRowsHtml += `
            <div class="bc-field-row" data-field="${item.field}" aria-label="${escapeHtml(fl)}" style="display:grid;grid-template-columns:minmax(170px,210px) 1fr 32px;gap:10px;padding:12px;border:1px solid var(--border-color);border-radius:8px;align-items:center;background:var(--bg-primary);margin-bottom:8px;">
              <div style="padding-right:4px;"><div style="font-size:13px;font-weight:600;color:var(--text-primary);">${fl}</div>${FIELD_HINTS_BULK[item.field] ? `<div style="font-size:var(--type-meta-size);color:var(--text-muted);margin-top:3px;line-height:var(--type-meta-line);">${FIELD_HINTS_BULK[item.field]}</div>` : ''}</div>
              <div>${controlHtml}</div>
              <button class="btn btn-ghost btn-sm square-icon ui-btn bc-field-remove" data-field="${item.field}" title="Убрать поле" aria-label="Убрать поле ${escapeHtml(fl)}" style="display:flex;align-items:center;justify-content:center">✕</button>
            </div>
          `;
        }

        const addFieldBtn = `
          <button id="bc-add-field" class="btn btn-secondary btn-sm" style="width:100%;border-style:dashed;margin-top:4px;justify-content:center;">+ Добавить ещё одно поле</button>
        `;

        const fieldPickerHtml = `
          <div id="bc-field-picker" class="hidden" style="margin-top:12px;padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-secondary);">
            <input class="input ui-control" type="text" id="bc-field-search" placeholder="Найти поле по названию…" style="width:100%;box-sizing:border-box;margin-bottom:10px">
            <div id="bc-field-list" style="max-height:280px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;"></div>
          </div>
        `;

        const summaryText = renderBulkSummary(selectedFields, selected);

        bodyContent = `
          <div style="display:flex;flex-direction:column;padding:12px 16px 16px 16px;flex:1;min-height:0;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;padding:12px;background:var(--bg-tertiary);border-radius:8px;">
              <div><div style="font-size:14px;font-weight:600;color:var(--text-primary);">Настройте изменения</div><div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">Новое значение будет одинаковым у всех выбранных задач.</div></div>
              <span style="white-space:nowrap;padding:5px 9px;border-radius:999px;background:var(--accent);color:white;font-size:12px;font-weight:600;">${selected} ${pluralize(selected, 'задача', 'задачи', 'задач')}</span>
            </div>
            <div style="flex:1;overflow-y:auto;min-height:0;">
              <div id="bc-fields-list" style="border-radius:8px;background:var(--bg-secondary);padding:8px;margin-bottom:8px;">
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
        <div class="modal modal-md" role="dialog" aria-modal="true" aria-labelledby="bc-modal-title">
          <div class="modal-header">
            <div style="display:flex;gap:8px;">
              <span style="width:24px;height:24px;border-radius:50%;background:${step >= 1 ? 'var(--accent)' : 'var(--bg-secondary)'};color:${step >= 1 ? 'white' : 'var(--text-muted)'};display:flex;align-items:center;justify-content:center;font-size:var(--type-meta-size);line-height:var(--type-meta-line);font-weight:600;">1</span>
              <span style="width:24px;height:24px;border-radius:50%;background:${step >= 2 ? 'var(--accent)' : 'var(--bg-secondary)'};color:${step >= 2 ? 'white' : 'var(--text-muted)'};display:flex;align-items:center;justify-content:center;font-size:var(--type-meta-size);line-height:var(--type-meta-line);font-weight:600;">2</span>
            </div>
            <div style="flex:1;">
              <div class="modal-title" id="bc-modal-title">Массовые операции</div>
              <div class="app-modal__subtitle" id="bc-subtitle">${subtitle}</div>
            </div>
            <button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" id="bc-modal-close" data-modal-close aria-label="Закрыть">✕</button>
          </div>
          <div class="modal-body modal-body-scroll" style="display:flex;flex-direction:column;">${bodyContent}<p id="bc-error" class="fd-error" role="alert" hidden></p></div>
          <div class="modal-footer" style="justify-content:space-between;">
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
        case 'did_client_group_id': (window.app?.didClientGroups || []).forEach(d => { opts += `<option value="${d.id}">${escapeHtml(d.name)}</option>`; }); break;
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
        overlay.querySelectorAll('.ui-pagination-pages [data-page]').forEach(btn => btn.addEventListener('click', () => { currentPage = Number(btn.dataset.page); renderStep(); }));
        const prevBtn = overlay.querySelector('#bc-page-prev');
        const nextPageBtn = overlay.querySelector('#bc-page-next');

        function updatePageButtons() {
          if (prevBtn) prevBtn.disabled = currentPage === 1;
          if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
          if (prevBtn) prevBtn.style.opacity = currentPage === 1 ? '0.4' : '1';
          if (nextPageBtn) nextPageBtn.style.opacity = currentPage === totalPages ? '0.4' : '1';
        }

        function updateSelectClearButtons() {
          const selectedCount = getSelectedCount();
          if (selectAllBtn) {
            selectAllBtn.disabled = selectedCount === totalTasks;
            selectAllBtn.style.opacity = selectAllBtn.disabled ? '0.5' : '';
            selectAllBtn.style.cursor = selectAllBtn.disabled ? 'default' : '';
          }
          if (clearAllBtn) {
            clearAllBtn.disabled = selectedCount === 0;
            clearAllBtn.style.opacity = clearAllBtn.disabled ? '0.5' : '';
            clearAllBtn.style.cursor = clearAllBtn.disabled ? 'default' : '';
          }
        }

        selectAllBtn?.addEventListener('click', () => {
          if (selectAllBtn.disabled) return;
          userModified = true;
          excluded.clear();
          document.querySelectorAll('.bc-cb').forEach(cb => { cb.checked = true; });
          document.querySelectorAll('.bc-row').forEach(row => row.classList.remove('bc-row-off'));
          if (countEl) countEl.textContent = getSelectedCount();
          nextBtn && (nextBtn.disabled = getSelectedCount() === 0);
          updateSelectClearButtons();
        });

        clearAllBtn?.addEventListener('click', () => {
          if (clearAllBtn.disabled) return;
          userModified = true;
          excluded = new Set(tasks.map(t => t.id));
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
            const val = FIELD_TYPES_BULK[field] === 'tags'
              ? input.value.split(',').map(tag => tag.trim()).filter(Boolean)
              : (input.type === 'checkbox' ? input.checked : input.value);
            const item = selectedFields.find(f => f.field === field);
            if (item) item.value = val;
            fieldValues[field] = val;
            updateSummary();
          });
        });

        document.querySelectorAll('.bc-comment-mentions').forEach(select => {
          select.addEventListener('change', () => {
            const item = selectedFields.find(field => field.field === select.dataset.field);
            if (item) item.mentionedUserIds = [...select.selectedOptions].map(option => Number(option.value));
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
            html += `<div style="grid-column:1/-1;font-size:var(--type-meta-size);line-height:var(--type-meta-line);font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 0 2px 0;border-bottom:1px solid var(--border-color);margin-bottom:2px;">${groupLabel}</div>`;
            for (const f of filteredFields) {
              html += `<button class="btn btn-secondary btn-sm bc-field-option" data-field="${f}">${FIELD_LABELS_BULK[f] || f}</button>`;
            }
          }
          fieldList.innerHTML = html || '<div style="grid-column:1/-1;padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">Ничего не найдено</div>';
          fieldList.querySelectorAll('.bc-field-option').forEach(opt => {
            opt.addEventListener('click', () => {
              const field = opt.dataset.field;
              if (!selectedFields.some(f => f.field === field)) {
                selectedFields.push({ field, value: '', mentionedUserIds: [] });
                fieldValues[field] = '';
              }
              fieldPicker?.classList.add('hidden');
              renderStep();
            });
          });
        }

        nextBtn?.addEventListener('click', async () => {
          const fieldsPayload = {};
          const commentItem = selectedFields.find(item => item.field === 'comment_add' && hasBulkValue(item.value));
          const otherConfiguredItems = selectedFields.filter(item => item.field !== 'comment_add' && hasBulkValue(item.value));
          if (commentItem && otherConfiguredItems.length) {
            showBulkError('Добавление комментария выполняется отдельной операцией');
            return;
          }
          const bulkAction = commentItem ? 'comment' : 'update';
          let hasReason = true;
          for (const item of selectedFields) {
            if (item.value === '' || item.value === null || item.value === undefined || (Array.isArray(item.value) && item.value.length === 0)) continue;
            if (item.field === 'comment_add') {
              fieldsPayload.comment_text = item.value;
              fieldsPayload.mentioned_user_ids = item.mentionedUserIds || [];
            } else {
              fieldsPayload[item.field] = item.value;
            }
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
            renderStep();
            showBulkError('Для выбранного статуса требуется указать причину отклонения');
            overlay.querySelector('[data-field="rejection_reason"].bc-field-val')?.focus();
            return;
          }
          if (Object.keys(fieldsPayload).length === 0) {
            showBulkError('Добавьте хотя бы одно поле со значением');
            return;
          }
          const selected = getSelectedCount();
          const taskIds = tasks.filter(t => !excluded.has(t.id)).map(t => t.id);
          const versions = Object.fromEntries(
            tasks.filter(t => !excluded.has(t.id)).map(t => [t.id, Number(t.version || 0)])
          );
          const configured = selectedFields.filter(item => hasBulkValue(item.value));
          const changesText = configured
            .map(item => `${FIELD_LABELS_BULK[item.field] || item.field}: ${formatBulkValue(item.field, item.value)}`)
            .join('; ');
          let preview;
          try {
            nextBtn.disabled = true;
            nextBtn.textContent = 'Проверяю…';
            preview = await app.api.post('/tasks/bulk/preview', {
              action: bulkAction, task_ids: taskIds, versions, fields: fieldsPayload
            });
          } catch (e) {
            const validationErrors = Array.isArray(e.data) ? e.data : e.data?.detail;
            const reason = Array.isArray(validationErrors)
              ? validationErrors.map(item => item.msg).filter(Boolean).join('; ')
              : e.message;
            showBulkError('Не удалось проверить массовую операцию: ' + (reason || 'ошибка сервера'));
            nextBtn.disabled = false;
            nextBtn.textContent = `Применить к ${selected} ${pluralize(selected, 'задаче', 'задачам', 'задачам')}`;
            return;
          }
          nextBtn.disabled = false;
          nextBtn.textContent = `Применить к ${selected} ${pluralize(selected, 'задаче', 'задачам', 'задачам')}`;
          if (!preview.can_apply) {
            const reasons = [...(preview.errors || [])];
            if (preview.inaccessible_tasks > 0) reasons.push(`Нет прав: ${preview.inaccessible_tasks}`);
            showBulkError(`Операцию нельзя применить. ${reasons.join('. ')}`);
            return;
          }
          const previewText = `Изменятся задачи: ${preview.changed_tasks}; без изменений: ${preview.unchanged_tasks}; изменений полей: ${preview.applied_changes}; пропущено совпадающих значений: ${preview.skipped_changes}; уведомлений: ${preview.notifications}.`;
          const confirmed = await showConfirmModal(
            `${previewText} ${changesText}.`,
            'Подтверждение',
            `Применить к ${selected} ${pluralize(selected, 'задаче', 'задачам', 'задачам')}`,
            'Отмена'
          );
          if (!confirmed) return;
          try {
            const result = await app.api.post('/tasks/bulk', {
              action: bulkAction,
              task_ids: taskIds,
              versions,
              fields: fieldsPayload
            });
            closeBulkModal();
            resolve({ success: true, count: result?.changed_tasks ?? selected, result });
            showBulkResultModal(result, tasks);
            const changed = result?.changed_tasks ?? selected;
            const unchanged = result?.unchanged_tasks ?? 0;
            const operationLabel = result?.operation_id ? ` · операция ${result.operation_id.slice(0, 8)}` : '';
            const unchangedLabel = unchanged > 0 ? `, без изменений: ${unchanged}` : '';
            window.toast?.(`Изменено задач: ${changed}${unchangedLabel}${operationLabel}`, 'success');
          } catch (e) {
            window.toast?.('Ошибка: ' + (e.message || 'Не удалось выполнить массовое изменение'), 'error');
            closeBulkModal();
            showBulkResultModal({
              changed_task_ids: [], unchanged_task_ids: [], error_task_ids: taskIds,
              outcome_unknown:!e.status||e.status>=500,
              errors: [e.message || 'Не удалось выполнить массовое изменение'],
            }, tasks, e.message);
            resolve({ success: false, error: e, outcomeUnknown:!e.status||e.status>=500 });
          }
        });
      }
    }

    function updateSummary() {
      const summaryEl = overlay.querySelector('#bc-summary');
      if (!summaryEl) return;
      const count = getSelectedCount();
      summaryEl.innerHTML = renderBulkSummary(selectedFields, count);
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
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
  const sizeError = "Файл слишком большой. Максимум — 10 МиБ (10 485 760 байт). Уменьшите файл или разделите его на части.";
  const existing = document.getElementById('import-tasks-overlay');
  if (existing) existing.remove();

  const REQUIRED_IMPORT_FIELDS = ['title', 'team_id'];

  const ROW_INT_FIELDS = ['effort_days', 'progress'];
  const ROW_FLOAT_FIELDS = [
    'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be',
    'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto',
    'effort_delivery', 'actual_effort_days', 'actual_effort_designee',
    'actual_effort_analytics', 'actual_effort_be', 'actual_effort_python_be',
    'actual_effort_fe', 'actual_effort_test', 'actual_effort_test_auto',
    'actual_effort_delivery', 'financial_effect', 'cv',
    'metric_kr_plan', 'metric_kr_fact'
  ];

  const IMPORT_FIELDS = [
    { key: 'title' }, { key: 'team_id' }, { key: 'description' }, { key: 'date_received' },
    { key: 'did_client_group_id' },
    { key: 'channel_id' }, { key: 'business_customer_id' }, { key: 'department_id' },
    { key: 'project_id' }, { key: 'task_type_id' }, { key: 'involved_teams' },
    { key: 'priority_id' }, { key: 'status_id' }, { key: 'deadline_id' },
    { key: 'effort_days' }, { key: 'effort_rub' },
    { key: 'effort_designee' }, { key: 'effort_analytics' },
    { key: 'effort_be' }, { key: 'effort_python_be' }, { key: 'effort_fe' },
    { key: 'effort_test' }, { key: 'effort_test_auto' }, { key: 'effort_delivery' },
    { key: 'actual_effort_days' }, { key: 'actual_effort_designee' }, { key: 'actual_effort_analytics' },
    { key: 'actual_effort_be' }, { key: 'actual_effort_python_be' }, { key: 'actual_effort_fe' },
    { key: 'actual_effort_test' }, { key: 'actual_effort_test_auto' }, { key: 'actual_effort_delivery' },
    { key: 'financial_effect' }, { key: 'financial_effect_justification' }, { key: 'cv' },
    { key: 'progress' }, { key: 'link_mockups' }, { key: 'link_jira' },
    { key: 'rejection_reason' }, { key: 'comment' }, { key: 'owner_id' },
    { key: 'key_project_status' }, { key: 'directorate_status' }, { key: 'did_status' },
    { key: 'did_demo' }, { key: 'metric_kr_plan' }, { key: 'metric_kr_fact' }, { key: 'metric_kr_unit' }
  ];

  const FIELD_LABEL_FALLBACK = {
    title: 'Название задачи', team_id: 'Ответственная команда', description: 'Описание задачи',
    date_received: 'Дата получения', channel_id: 'Канал поступления',
    did_client_group_id: 'Клиент ДИД',
    business_customer_id: 'Бизнес-заказчик', department_id: 'Подразделение Бизнес-заказчика',
    project_id: 'Проект', task_type_id: 'Тип задачи', involved_teams: 'Другие вовлеченные команды',
    priority_id: 'Приоритет', status_id: 'Статус задачи', deadline_id: 'Срок выполнения',
    effort_days: 'Оценка трудозатрат (ЭО) (ч/д)', effort_rub: 'Стоимость по ЭО (руб)',
    effort_designee: 'Designee (ЭО)', effort_analytics: 'Аналитика (ЭО)',
    effort_be: 'Разработка BE (ЭО)', effort_python_be: 'Разработка python BE (ЭО)',
    effort_fe: 'Разработка FE (ЭО)', effort_test: 'Test (ЭО)', effort_test_auto: 'Test Auto (ЭО)',
    effort_delivery: 'Delivery (ЭО)',
    actual_effort_days: 'Фактические трудозатраты (ч/д)', actual_effort_designee: 'Designee (ФТЗ)',
    actual_effort_analytics: 'Аналитика (ФТЗ)', actual_effort_be: 'Разработка BE (ФТЗ)',
    actual_effort_python_be: 'Разработка python BE (ФТЗ)', actual_effort_fe: 'Разработка FE (ФТЗ)',
    actual_effort_test: 'Test (ФТЗ)', actual_effort_test_auto: 'Test Auto (ФТЗ)',
    actual_effort_delivery: 'Delivery (ФТЗ)',
    financial_effect: 'Финансовый эффект (value в млн руб.)',
    financial_effect_justification: 'Обоснование по расчету финансового эффекта',
    cv: 'C/V', progress: 'Прогресс', link_mockups: 'Ссылка на макеты',
    link_jira: 'Ссылки на Jira', rejection_reason: 'Обоснование решения (при отклонении)',
    comment: 'Комментарий', owner_id: 'Исполнитель',
    key_project_status: 'Статус для встречи по ключевым проектам',
    directorate_status: 'Статус для Директорской оперативки',
    did_status: 'Статус для оперативки ДИД', did_demo: 'Демо для оперативного статуса ДИД',
    metric_kr_plan: 'Значение для метрического KR (план)',
    metric_kr_fact: 'Значение для метрического KR (факт)',
    metric_kr_unit: 'Единица измерения (метрический KR)'
  };

  function fieldLabel(key) {
    return (window.app?.fieldLabels && window.app.fieldLabels[key]) || FIELD_LABEL_FALLBACK[key] || key;
  }

  function downloadTemplate() {
    const header = IMPORT_FIELDS.map(f => fieldLabel(f.key));
    const exampleValues = {
      title: 'Пример задачи', team_id: 'Пример команды', description: 'Описание задачи',
      date_received: '2026-01-01', channel_id: 'Почта', business_customer_id: 'ДИД',
      department_id: 'УСИ', project_id: 'Проект', task_type_id: 'КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ',
      involved_teams: '1;2', priority_id: 'СРЕДНИЙ', status_id: 'НОВАЯ ЗАДАЧА',
      deadline_id: '1Q 2026', effort_days: '5', effort_rub: '150000',
      effort_designee: '', effort_analytics: '', effort_be: '', effort_python_be: '',
      effort_fe: '', effort_test: '', effort_test_auto: '', effort_delivery: '',
      actual_effort_days: '', actual_effort_designee: '', actual_effort_analytics: '',
      actual_effort_be: '', actual_effort_python_be: '', actual_effort_fe: '',
      actual_effort_test: '', actual_effort_test_auto: '', actual_effort_delivery: '',
      financial_effect: '1.5', financial_effect_justification: '', cv: '',
      progress: '0', link_mockups: '', link_jira: 'https://jira.example.com/ABC-1;https://jira.example.com/ABC-2',
      rejection_reason: '', comment: '', owner_id: 'Иванов Иван',
      key_project_status: '', directorate_status: '', did_status: '',
      did_demo: 'false', metric_kr_plan: '', metric_kr_fact: '', metric_kr_unit: ''
    };
    const exampleRow = IMPORT_FIELDS.map(f => exampleValues[f.key] ?? '');
    downloadCsv(csvRows([header, exampleRow]), 'task_import_template.csv');
  }

  const returnFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'import-tasks-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="import-tasks-modal app-modal app-modal--medium" role="dialog" aria-modal="true" aria-labelledby="import-tasks-title">
      <div class="app-modal__header">
        <h2 class="app-modal__title" id="import-tasks-title">Импорт задач из файла</h2>
        <button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" id="import-close-btn" data-modal-close aria-label="Закрыть">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div class="app-modal__body">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <a class="ui-entity-link" href="#" id="download-template-link" style="font-size:13px;text-decoration:none;display:flex;align-items:center;gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Скачать шаблон CSV
        </a>
        <span style="font-size:12px;color:var(--text-muted);">Обязательные: ${REQUIRED_IMPORT_FIELDS.map(k => fieldLabel(k)).join(', ')}</span>
      </div>

      <div id="import-drop-zone" autofocus role="button" tabindex="0" aria-label="Выбрать CSV или Excel файл" style="border:2px dashed var(--border-color);border-radius:8px;padding:32px;text-align:center;cursor:pointer;margin-bottom:16px;transition:all 0.2s;">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="display:block;margin:0 auto 12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p style="margin:0 0 8px 0;color:var(--text-primary);font-size:14px;">Перетащите CSV или Excel файл сюда или нажмите для выбора</p>
        <p style="margin:0;color:var(--text-muted);font-size:12px;">Поддерживаются форматы CSV и Excel (.xlsx, .xls). Максимум — 10 МиБ; для Excel ограничение действует также после преобразования в CSV. В CSV разделитель — запятая или точка с запятой. Повторный импорт создаёт новые задачи: удалите уже импортированные строки перед повторной отправкой. В Excel читается только первый лист; поместите заголовки в его первую строку, а задачи — ниже.</p>
        <input type="file" id="import-file-input" accept=".csv,.xlsx,.xls" style="display:none;">
      </div>

      <div id="import-preview-section" style="display:none;margin-bottom:16px;">
        <div id="import-file-details" style="font-size:12px;margin-bottom:10px;"></div>
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">Предпросмотр (первые 5 строк):</div>
        <div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;max-height:200px;overflow-y:auto;">
          <table class="ui-table ui-table-data" style="width:100%">
            <thead id="import-preview-thead" style="position:sticky;top:0;background:var(--bg-tertiary);"></thead>
            <tbody id="import-preview-tbody"></tbody>
          </table>
        </div>
      </div>

      <div id="import-error-summary" role="alert" style="display:none;margin-bottom:16px;padding:12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;">
        <div style="font-size:13px;color:var(--danger);font-weight:600;margin-bottom:8px;">Проверка файла:</div>
        <ul id="import-error-list" style="margin:0;padding-left:20px;font-size:12px;color:var(--danger);"></ul>
      </div>

      <div id="import-row-errors" style="display:none;margin-bottom:16px;padding:12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);border-radius:8px;">
        <div style="font-size:13px;color:#d97706;font-weight:600;margin-bottom:4px;">Потенциальные ошибки строк: <span id="import-row-errors-count">0</span></div>
        <div style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted);margin-bottom:8px;">Предварительная проверка: импорт не блокируется, финальный результат определит сервер.</div>
        <ul id="import-row-errors-list" style="margin:0;padding-left:20px;font-size:12px;color:#b45309;max-height:140px;overflow-y:auto;"></ul>
      </div>

      <div id="import-result" role="status" aria-live="polite" tabindex="-1" aria-label="Результат импорта" style="display:none;margin-bottom:16px;padding:16px;border-radius:8px;">
        <div id="import-result-content" style="font-size:14px;"></div>
        <div id="import-result-actions" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid var(--border-color);display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="import-copy-report" style="">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:6px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Скопировать отчёт
          </button>
          <button class="btn btn-secondary btn-sm" id="import-download-report" style="">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Скачать отчёт (.txt)
          </button>
        </div>
      </div>

      </div>

      <div class="app-modal__footer">
        <button class="btn btn-secondary btn-sm" id="import-cancel-btn" style="">Отмена</button>
        <button class="btn btn-primary btn-sm" id="import-submit-btn" disabled style="">Импортировать</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  let submissionComplete = false;
  let importing = false;
  let importedAny = false;
  let importClosed = false;
  let selectedFile = null;
  let previewData = null;
  let errors = [];
  let rowErrors = [];

  const closeImportModal = () => {
    if (importing || importClosed) return;
    importClosed = true;
    if (importedAny && onSuccess) onSuccess();
    overlay.classList.add('modal-closing');
    setTimeout(() => { overlay.remove(); if (returnFocus?.isConnected) returnFocus.focus(); }, 200);
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
  dropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!importing) fileInput.click(); }
  });
  dropZone.focus();

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
    if (file && /\.(csv|xlsx|xls)$/i.test(file.name)) {
      handleFile(file);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    if (importing) return;
    const resultBlock = overlay.querySelector("#import-result");
    resultBlock.style.display = "none";
    overlay.querySelector("#import-result-content").textContent = "";
    submissionComplete = false;
    selectedFile = file;
    previewData = null;
    errors = [];
    rowErrors = [];
    renderPreview(); renderErrors(); renderRowErrors();
    overlay.querySelector('#import-submit-btn').disabled = true;
    if (file.size > MAX_IMPORT_BYTES) {
      errors = [sizeError];
      renderErrors();
      return;
    }
    const ext = (file.name || '').toLowerCase().split('.').pop();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (selectedFile !== file) return;
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: true });
          const firstSheet = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheet];
          const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          if (aoa.length < 2) throw new Error('Файл не содержит строк задач');
          if (aoa.length > 0) {
            const headers = (aoa[0] || []).map((h, i) => (h != null ? String(h).trim() : `Колонка ${i + 1}`));
            const dataRows = aoa.slice(1).filter(row => row.some(cell => cell != null && cell !== '')).map(row =>
              row.map(cell => {
                if (cell instanceof Date) {
                  const y = cell.getFullYear();
                  const m = String(cell.getMonth() + 1).padStart(2, '0');
                  const d = String(cell.getDate()).padStart(2, '0');
                  return `${y}-${m}-${d}`;
                }
                return (cell != null ? String(cell) : '');
              })
            );
            previewData = { headers, rows: dataRows, delimiter: ';', format: ext.toUpperCase(), encoding: 'преобразование в UTF-8 CSV', sheet: firstSheet };
            errors = validateData(headers);
            rowErrors = validateRows(previewData);
            renderPreview();
            renderErrors();
            renderRowErrors();
            overlay.querySelector('#import-submit-btn').disabled = errors.length > 0;
          }
        } catch (err) {
          errors = ['Ошибка чтения Excel: ' + err.message];
          renderErrors();
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (selectedFile !== file) return;
        try {
          const decoded = decodeCsvContent(e.target.result, true);
          parseAndPreview(decoded.text, decoded.encoding);
        }
        catch (err) { errors = [err.message]; renderErrors(); }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  function parseAndPreview(content, encoding) {
    const { rows, delimiter } = parseCsvRows(content);
    if (rows.length < 2) throw new Error('Файл не содержит строк задач');

    const headers = rows[0].map((h, i) => h.trim() || `Колонка ${i + 1}`);
    const dataRows = rows.slice(1);

    previewData = { headers, rows: dataRows, delimiter, format: 'CSV', encoding };
    errors = validateData(headers);
    rowErrors = validateRows(previewData);

    renderPreview();
    renderErrors();
    renderRowErrors();

    overlay.querySelector('#import-submit-btn').disabled = errors.length > 0;
  }

  function validateData(headers) {
    const errs = [];
    const normalized = headers.map(_normHeader);
    const seen = new Set();
    for (const header of normalized) {
      const field = IMPORT_FIELDS.find(f => [f.key, fieldLabel(f.key), FIELD_LABEL_FALLBACK[f.key]].filter(Boolean).map(_normHeader).includes(header));
      const key = field?.key || header;
      if (seen.has(key)) errs.push('Повторяющаяся колонка: ' + header);
      seen.add(key);
    }
    const hasTitle = normalized.some(h => h === 'название задачи' || h === 'title');
    const hasTeam = normalized.some(h => h === 'ответственная команда' || h === 'team_id');
    if (!hasTitle) {
      errs.push('Не найдена обязательная колонка "Название задачи" (первая строка файла или первого листа Excel)');
    }
    if (!hasTeam) {
      errs.push('Не найдена обязательная колонка "Ответственная команда" (первая строка файла или первого листа Excel)');
    }
    return errs;
  }

  function _normHeader(h) {
    return String(h != null ? h : '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function _isRealDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function _isValidDateLike(v) {
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return _isRealDate(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{2})[.\/](\d{2})[.\/](\d{2}|\d{4})$/);
    if (m) return _isRealDate(+m[3], +m[2], +m[1]);
    return false;
  }

  function _isValidIntStr(v) {
    const s = String(v).trim();
    if (!/^-?\d+(\.0+)?$/.test(s)) return false;
    return Number.isInteger(Number(s));
  }

  function _isValidFloatStr(v) {
    const s = String(v).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return false;
    return Number.isFinite(Number(s));
  }

  function validateRows(data) {
    const out = [];
    if (!data || !data.headers || !data.rows) return out;

    const normalized = data.headers.map(_normHeader);
    const col = {};
    for (const f of IMPORT_FIELDS) {
      const aliases = [f.key, fieldLabel(f.key), FIELD_LABEL_FALLBACK[f.key]].filter(Boolean).map(_normHeader);
      const idx = normalized.findIndex(header => aliases.includes(header));
      if (idx !== -1) col[f.key] = idx;
    }

    data.rows.forEach((row, i) => {
      if (!row || !row.some(c => c != null && String(c).trim() !== '')) return;
      const rowNum = i + 2;
      const cell = k => (col[k] !== undefined ? String(row[col[k]] != null ? row[col[k]] : '').trim() : '');

      for (const k of REQUIRED_IMPORT_FIELDS) {        if (col[k] === undefined) continue;
        if (cell(k) === '') {
          const label = fieldLabel(k);
          out.push({ row: rowNum, message: `Поле "${label}" обязательно для заполнения` });
        }
      }

      if (col.title !== undefined && [...cell('title')].length > 255) {
        out.push({ row: rowNum, message: 'Название задачи не должно превышать 255 символов' });
      }
      if (col.did_demo !== undefined && cell('did_demo') !== '' &&
          !['true','false','1','0','yes','no','да','нет','y','n'].includes(cell('did_demo').toLowerCase())) {
        out.push({ row: rowNum, message: 'Поле «Демо ДИД»: ожидается да/нет, true/false, yes/no, y/n или 1/0' });
      }
      if (col.date_received !== undefined) {
        const v = cell('date_received');
        if (v !== '' && !_isValidDateLike(v)) {
          out.push({ row: rowNum, message: `Неверный формат даты: "${v}"` });
        }
      }

      for (const k of ROW_INT_FIELDS) {
        if (col[k] === undefined) continue;
        const v = cell(k);
        if (v === '') continue;
        if (k === 'progress') {
          const num = Number(v);
          if (!_isValidIntStr(v) || num < 0 || num > 100) {
            out.push({ row: rowNum, message: `Неверный формат прогресса: "${v}"` });
          }
        } else if (!_isValidIntStr(v) || Number(v) < 0 || Number(v) > 10000) {
          out.push({ row: rowNum, message: `Неверный числовой формат: "${v}"` });
        }
      }

      for (const k of ROW_FLOAT_FIELDS) {
        if (col[k] === undefined) continue;
        const v = cell(k);
        const permitsNegative = ['actual_effort_days', 'cv', 'metric_kr_plan', 'metric_kr_fact'].includes(k);
        if (v === '' || (_isValidFloatStr(v) && (permitsNegative || Number(v) >= 0))) continue;
        out.push({ row: rowNum, message: `Неверный числовой формат: "${v}"` });
      }
    });

    return out;
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
    const mapping = previewData.headers.map(header => {
      const field = IMPORT_FIELDS.find(f => [f.key, fieldLabel(f.key), FIELD_LABEL_FALLBACK[f.key]].filter(Boolean).map(_normHeader).includes(_normHeader(header)));
      return escapeHtml(header) + ' → ' + escapeHtml(field ? field.key : 'игнорируется');
    });
    overlay.querySelector('#import-file-details').innerHTML =
      escapeHtml(previewData.format + ' · ' + previewData.encoding + ' · разделитель: ' + previewData.delimiter + (previewData.sheet ? ' · лист: ' + previewData.sheet : '')) +
      '<br>Всего строк: ' + previewData.rows.length + '. Показаны первые 5; справочники и сохранение проверяет сервер.' +
      '<details><summary class="ui-disclosure-text">Сопоставление колонок (предварительное)</summary>' + mapping.join('<br>') + '</details>';

    thead.innerHTML = `<tr>${previewData.headers.map(h => `<th style="text-align:left;border-bottom:1px solid var(--border-color);white-space:nowrap">${escapeHtml(h)}</th>`).join('')}</tr>`;

    const previewRows = previewData.rows.slice(0, 5);
    tbody.innerHTML = previewRows.map(row => {
      return `<tr>
        ${row.map((cell, i) => `<td style="border-bottom:1px solid var(--border-color);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(String(cell ?? '').slice(0,300))}${String(cell ?? '').length>300?'…':''}</td>`).join('')}
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
    errorList.innerHTML = errors.map(e => `<li>${escapeHtml(e)}</li>`).join('');
  }

  function renderRowErrors() {
    const block = overlay.querySelector('#import-row-errors');
    const list = overlay.querySelector('#import-row-errors-list');
    const countEl = overlay.querySelector('#import-row-errors-count');

    if (rowErrors.length === 0) {
      block.style.display = 'none';
      return;
    }

    block.style.display = 'block';
    countEl.textContent = rowErrors.length;
    list.innerHTML = rowErrors.slice(0, 20).map(e => {
      return `<li>Строка ${e.row}: ${escapeHtml(e.message)}</li>`;
    }).join('');
    if (rowErrors.length > 20) {
      list.insertAdjacentHTML('beforeend', `<li>... и ещё ${rowErrors.length - 20} ошибок</li>`);
    }
  }

  function buildReportText(result, fileName) {
    const lines = [];
    lines.push('Отчёт об импорте задач из CSV');
    lines.push(`Дата: ${new Date().toLocaleString('ru-RU')}`);
    lines.push(`Файл: ${fileName || '—'}`);
    lines.push('----------------------------------------');
    const errs = result.errors || [];
    const total = result.total ?? errs.length + (result.created ?? 0);
    lines.push(`Всего строк: ${total}`);
    lines.push(`Импортировано: ${result.created ?? 0}`);
    lines.push(`Пропущено: ${result.skipped ?? 0}`);
    lines.push(`Ошибок: ${errs.length}`);
    lines.push('----------------------------------------');
    if (errs.length === 0) {
      lines.push('Ошибок нет.');
    } else {
      lines.push('Ошибки:');
      errs.forEach(e => {
        const row = e.row ? `Строка ${e.row}` : 'Файл';
        const field = e.field_label ? `Поле "${e.field_label}"` : '';
        const value = e.value ? `Значение: "${e.value}"` : '';
        lines.push(`- [${row}] ${field} ${value} — ${e.message}`);
      });
    }
    return lines.join('\r\n');
  }

  function copyReport(result, fileName) {
    const text = buildReportText(result, fileName);
    const done = () => window.toast?.('Отчёт скопирован в буфер обмена', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function downloadReport(result, fileName) {
    const text = buildReportText(result, fileName);
    const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `import_report_${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  overlay.querySelector('#import-submit-btn').addEventListener('click', async () => {
    if (importing || submissionComplete || !selectedFile || !previewData) return;
    importing = true;
    fileInput.disabled = true;

    const btn = overlay.querySelector('#import-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Импорт...';

    try {
      const formData = new FormData();
      const ext = (selectedFile.name || '').toLowerCase().split('.').pop();
      if (ext === 'xlsx' || ext === 'xls') {
        const delimiter = previewData.delimiter || ';';
        const csvContent = [
          previewData.headers.join(delimiter),
          ...previewData.rows.map(row => row.map(cell => {
            const str = String(cell != null ? cell : '');
            if (str.includes(delimiter) || str.includes('"') || str.includes('\n')) {
              return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
          }).join(delimiter))
        ].join('\r\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        if (blob.size > MAX_IMPORT_BYTES) {
          errors = ['После преобразования Excel в CSV превышен лимит. ' + sizeError];
          renderErrors();
          return;
        }
        const csvFile = new File([blob], selectedFile.name.replace(/\.xlsx?$/i, '.csv'), { type: 'text/csv' });
        formData.append('file', csvFile);
      } else {
        formData.append('file', selectedFile);
      }

      const result = await app.api.post('/tasks/import', formData, true);
      submissionComplete = true;

      const resultDiv = overlay.querySelector('#import-result');
      resultDiv.style.display = 'block';
      const hasErrors = result.errors && result.errors.length > 0;
      resultDiv.style.border = '1px solid ' + (hasErrors ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)');
      resultDiv.style.background = hasErrors ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)';

      const errs = result.errors || [];
      let html = hasErrors
        ? `<div style="color:var(--danger);font-weight:600;">Импорт завершён с ошибками</div>`
        : `<div style="color:var(--success);font-weight:600;">Импорт завершён!</div>`;
      html += `<div style="margin-top:8px;display:flex;gap:24px;flex-wrap:wrap;">
        <span>Всего строк: <strong>${result.total ?? errs.length + (result.created ?? 0)}</strong></span>
        <span style="color:var(--success);">Импортировано: <strong>${result.created ?? 0}</strong></span>
        <span style="color:var(--danger);">Пропущено: <strong>${result.skipped ?? 0}</strong></span>
        <span>Ошибок: <strong>${errs.length}</strong></span>
      </div>`;
      if (errs.length > 0) {
        html += `<div style="margin-top:10px;font-size:12px;color:var(--text-secondary);">Полный список ошибок — в отчёте (кнопки ниже).</div>`;
        html += `<ul style="margin:8px 0 0 0;padding-left:20px;font-size:12px;max-height:160px;overflow-y:auto;">`;
        errs.slice(0, 10).forEach(e => {
          html += `<li><strong>${e.row == null ? "Ошибка импорта" : `Строка ${escapeHtml(String(e.row))}`}:</strong> ${escapeHtml(e.message || JSON.stringify(e))}</li>`;
        });
        if (errs.length > 10) {
          html += `<li>... и ещё ${errs.length - 10} ошибок</li>`;
        }
        html += `</ul>`;
      }

      overlay.querySelector('#import-result-content').innerHTML = html;
      resultDiv.focus();

      const actions = overlay.querySelector('#import-result-actions');
      actions.style.display = 'flex';
      overlay.querySelector('#import-retry-download')?.remove();
      const failedRows = [...new Set(errs.filter(e => e.fatal === true).map(e => e.row))];
      const canExportFailed = result.total === previewData.rows.length && result.skipped > 0 &&
        failedRows.length === result.skipped && failedRows.every(row => Number.isInteger(row) && row >= 2 && row <= result.total + 1);
      if (canExportFailed) {
        const retry = document.createElement('button');
        retry.id = 'import-retry-download'; retry.className = 'btn btn-secondary btn-sm';
        retry.textContent = 'Скачать только пропущенные строки (.csv)';
        retry.addEventListener('click', () => {
          const rows = [previewData.headers, ...failedRows.sort((a,b) => a-b).map(row => previewData.rows[row-2])];
          const content = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(';')).join('\r\n');
          downloadCsv(content, 'import_failed_rows.csv');
        });
        actions.appendChild(retry);
      }
      const guidance = document.createElement('p');
      guidance.textContent = canExportFailed ? 'Исправьте скачанные пропущенные строки и выберите исправленный файл. Успешные строки в него не включены.' : 'Повторная отправка этого файла отключена. При общем сбое сверяйтесь с отчётом; не повторяйте успешно созданные строки.';
      overlay.querySelector('#import-result-content').appendChild(guidance);
      const copyBtn = overlay.querySelector('#import-copy-report');
      const downloadBtn = overlay.querySelector('#import-download-report');
      copyBtn.replaceWith(copyBtn.cloneNode(true));
      downloadBtn.replaceWith(downloadBtn.cloneNode(true));
      overlay.querySelector('#import-copy-report').addEventListener('click', () => {
        copyReport(result, selectedFile.name);
      });
      overlay.querySelector('#import-download-report').addEventListener('click', () => {
        downloadReport(result, selectedFile.name);
      });

      importedAny = importedAny || result.created > 0;
      overlay.querySelector('#import-cancel-btn').textContent = 'Закрыть';
    } catch (e) {
      errors = [e.status === 413 ? sizeError : 'Ошибка импорта: ' + (e.message || 'Неизвестная ошибка')];
      renderErrors();
    } finally {
      importing = false;
      fileInput.disabled = false;
      btn.disabled = submissionComplete || errors.length > 0;
      btn.textContent = submissionComplete ? 'Выберите исправленный файл' : 'Импортировать';
    }
  });
}

// ============================================================
//  КАРТОЧКА ЗАДАЧИ v30 (порт референса «Карточка задачи последняя»)
//  Структура, классы и логика соответствуют референсу v30,
//  но работают поверх реального API: /tasks/{id}, лок, вьюверы,
//  409-конфликт, комментарии с @, файлы, история.
// ============================================================

const CARD_IC = {
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L12 4.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v7H4V6h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  warning: '<path d="M10.3 3.6 2.4 17.5A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.5L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5c2 .8 3.5 2.6 3.5 5.5"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'
};

function cardIcon(n) {
  return '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (CARD_IC[n] || '') + '</svg>';
}

const CARD_ROLES = [
  { key: 'designee', field: 'effort_designee', actual: 'actual_effort_designee', name: 'Designee' },
  { key: 'analytics', field: 'effort_analytics', actual: 'actual_effort_analytics', name: 'Аналитика' },
  { key: 'be', field: 'effort_be', actual: 'actual_effort_be', name: 'Разработка BE' },
  { key: 'python', field: 'effort_python_be', actual: 'actual_effort_python_be', name: 'Разработка python BE' },
  { key: 'fe', field: 'effort_fe', actual: 'actual_effort_fe', name: 'Разработка FE' },
  { key: 'test', field: 'effort_test', actual: 'actual_effort_test', name: 'Test' },
  { key: 'testAuto', field: 'effort_test_auto', actual: 'actual_effort_test_auto', name: 'Test Auto' },
  { key: 'delivery', field: 'effort_delivery', actual: 'actual_effort_delivery', name: 'Delivery' },
];

const CARD_RATES_MAP = {
  designee: 'Designee', analytics: 'Аналитика', be: 'Разработка BE', python: 'Разработка python BE',
  fe: 'Разработка FE', test: 'Tester', testAuto: 'Tester Auto', delivery: 'Delivery',
};

const CARD_TABS = [
  ['main', 'Основное', 'file'],
  ['rep', 'Отчётные статусы', 'flag'],
  ['com', 'Комментарии', 'msg'],
  ['sys', 'Ссылки и файлы', 'link'],
  ['log', 'Лог изменений', 'clock'],
  ['work', 'Рабочие задачи', 'file'],
];

let cardState = { tab: 'main', editing: false, dirty: false, saving: false, prioritiserRunning: '', replyFor: null, current: null, draft: null, history: [], commentsCount: 0, filesCount: 0, descriptionExpanded: false };
let cardRates = null;
let cardDict = null;
let cardMaps = null;
let cardAi = null;
let cardPs = null;
let cardReportingContext = null;
let cardReportingLoading = false;
let cardReportingDrafts = new Map();
let cardReportingEditors = new Set();
let _cardEscHandler = null;
let _cardToastTimer = null;
let _cardRouteTabHandler = null;
let _cardSavedHighlightTimer = null;
let _cardAttachmentHydrationTimer = null;

function cardCurrentUser() {
  return window.app?.store?.get?.('currentUser') || {};
}

function cardMatchesCurrentTask(taskId) {
  const requestedId = Number(taskId);
  return Number.isSafeInteger(requestedId)
    && requestedId > 0
    && requestedId === Number(currentTask?.id);
}

function cardEditPermission() {
  return getTaskEditPermission(cardCurrentUser(), currentTask || cardState.current || {});
}

function cardCommentPermission() {
  return getTaskCommentPermission(cardCurrentUser(), currentTask || cardState.current || {});
}

function cardReportingDraftKey(kind, meetingId) {
  return String(kind || '') + ':' + String(meetingId ?? '');
}

function cardReportingMeetingId(item) {
  return item?.current_meeting?.id == null ? '' : String(item.current_meeting.id);
}

function cardReportingBaseline(item) {
  const kind = String(item?.kind || '');
  const current = item?.current_status || {};
  return {
    kind,
    meetingId: cardReportingMeetingId(item),
    text: String(current.text || ''),
    didDemo: kind === 'did' ? !!current.did_demo : false,
    version: Number(current.version || 0),
  };
}

function cardFindReportingItem(kind, meetingId) {
  const expectedKey = cardReportingDraftKey(kind, meetingId);
  return (cardReportingContext?.items || []).find(item =>
    cardReportingDraftKey(item?.kind, cardReportingMeetingId(item)) === expectedKey
  ) || null;
}

function cardReportingValuesForItem(item) {
  const baseline = cardReportingBaseline(item);
  const draft = cardReportingDrafts.get(cardReportingDraftKey(baseline.kind, baseline.meetingId));
  return draft ? { ...draft, version: baseline.version } : baseline;
}

function cardReportingDirtyCount() {
  return cardReportingDrafts.size;
}

function cardReportingDraftNames() {
  const fallback = { directorate: 'Директорская оперативка', did: 'Оперативка ДИД', key_projects: 'Ключевые проекты' };
  return Array.from(cardReportingDrafts.values()).map(draft => {
    const item = cardFindReportingItem(draft.kind, draft.meetingId);
    return 'Отчётный статус: ' + (item?.title || fallback[draft.kind] || draft.kind || 'встреча');
  });
}

function clearCardReportingDrafts() {
  cardReportingDrafts.clear();
  cardReportingEditors.clear();
}

function cardSetReportingDraft(kind, meetingId, text, didDemo) {
  const item = cardFindReportingItem(kind, meetingId);
  if (!item) return null;
  const baseline = cardReportingBaseline(item);
  const draft = {
    ...baseline,
    text: String(text ?? ''),
    didDemo: baseline.kind === 'did' ? !!didDemo : false,
  };
  const key = cardReportingDraftKey(baseline.kind, baseline.meetingId);
  if (draft.text === baseline.text && draft.didDemo === baseline.didDemo) {
    cardReportingDrafts.delete(key);
    return null;
  }
  cardReportingDrafts.set(key, draft);
  return draft;
}

function cardCaptureReportingDraft(target) {
  const card = target?.closest?.('.ui-task-report');
  const kind = card?.dataset.reportingKind || target?.dataset.reportingText || target?.dataset.reportingDemo;
  const meetingId = card?.dataset.reportingMeetingId || target?.dataset.reportingMeetingId;
  if (!kind || meetingId == null || meetingId === '') return null;
  const textInput = card?.querySelector(`[data-reporting-text="${kind}"]`);
  const demoInput = card?.querySelector(`[data-reporting-demo="${kind}"]`);
  const draft = cardSetReportingDraft(kind, meetingId, textInput?.value || '', demoInput?.checked || false);
  card?.classList.toggle('is-dirty', Boolean(draft));
  const badge = card?.querySelector('.ui-task-report-head>.ui-badge');
  if (badge) badge.outerHTML = uiBadge({ label: draft ? 'Черновик' : cardFindReportingItem(kind, meetingId)?.current_status?.text ? 'Готов' : 'Не заполнен', tone: draft ? 'warning' : 'neutral' });
  return draft;
}

export function normalizeTaskCardTab(tab) {
  const normalized = tab === 'files' ? 'sys' : tab;
  return CARD_TABS.some(item => item[0] === normalized) ? normalized : 'main';
}

function cardTabFromRoute() {
  const query = window.location.hash.slice(1).split('?')[1] || '';
  const params = new URLSearchParams(query);
  const requested = params.get('tab') || (parseCommentTarget(params) ? 'com' : 'main');
  return normalizeTaskCardTab(requested);
}

async function cardActivateTab(tab, app, syncRoute = true) {
  const validTab = normalizeTaskCardTab(tab);
  cardState.tab = validTab;
  cardState.replyFor = null;
  if (syncRoute) window.app?.router?.updateTaskTabRoute?.(validTab);
  if (validTab === 'com') {
    _commentTargetHandled = null;
    _commentFormInitialized = false;
    setTimeout(() => { initCommentForm(currentTask?.id, app); renderCommentList(); }, 0);
  }
  cardRenderTabs();
  cardRenderBody();
  cardRenderFooter();
  if (validTab === 'log') await cardLoadHistory(app);
  if (validTab === 'rep') await cardLoadReportingContext(app);
  if (validTab === 'sys') await loadAttachments(currentTask.id, app);
  if (validTab === 'sys') await loadAttachments(currentTask.id, app);
  return validTab;
}

function cardCur() { return cardState.editing ? cardState.draft : cardState.current; }

function cardNow() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function cardPerson(n) {
  return String(n ?? '').trim() || '—';
}
function cardCustomerDepartment(customerName, fallback = '') {
  if (!customerName || !cardDict) return fallback;
  const customer = (cardDict.customers || []).find(item =>
    [item?.name, item?.login, item?.email].some(value => value === customerName)
  );
  if (!customer) return fallback;
  if (customer.department_name || customer.customer_department) {
    return customer.department_name || customer.customer_department;
  }
  const department = (cardDict.departments || []).find(item =>
    Number(item?.id) === Number(customer.department_id)
  );
  return department?.name || fallback;
}
function cardFmtDate(v) { return v ? new Date(v).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function cardFmtDT(v) { return v ? new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function cardFmtMoney(v) { return v == null ? '—' : Number(v).toLocaleString('ru-RU') + ' ₽'; }
function cardFmtNum(v, d) { return (v == null || v === '') ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: (d == null ? 1 : d) }); }
function cardUrlOk(v) { return /^https?:\/\/\S+\.\S+/.test(v || ''); }
function cardNl2br(s) { return escapeHtml(s).replace(/\n/g, '<br>'); }
function cardPretty(v) {
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (v === null || v === '' || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return String(v);
}
function cardParseLinks(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.charAt(0) === '[') {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.filter(Boolean);
      } catch (e) { /* fall through */ }
    }
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}
function cardNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function cardBuildRates(items) {
  return buildCompetencyRateTable(items);
}
function cardRate(key) {
  if (!cardRates) return null;
  const comp = CARD_RATES_MAP[key];
  if (!comp || !cardRates[comp] || !Object.keys(cardRates[comp]).length) return null;
  const task = cardCur() || {};
  const year = deadlineYearFromReference(
    { name: task.deadline },
    cardDict?.deadlines || [],
  );
  return competencyRateForYear(cardRates, comp, year);
}
function cardCalcCost(o) {
  return sumTaskCosts(CARD_ROLES.map(r => [o?.[r.key], cardRate(r.key)]));
}
function cardCalcSum(o) {
  return sumTaskMeasurements(CARD_ROLES.map(r => o?.[r.key]));
}
function cardCvCalc(cost, fin) { return calculateCv(cost, fin); }
function cardCvCls(v) { if (v == null) return ''; return v < 0.3 ? 'cv-good' : (v <= 1 ? 'cv-warn' : 'cv-bad'); }
function cardDiffPct(eo, ftz) {
  eo = taskNumber(eo); ftz = taskNumber(ftz);
  if (eo === null || ftz === null) return { txt: '—', cls: 'd-neutral' };
  if (eo === 0) return ftz === 0 ? { txt: '0%', cls: 'd-neutral' } : { txt: 'Нет базы', cls: 'd-neutral' };
  const p = Math.round((ftz - eo) / eo * 100);
  if (p < 0) return { txt: p + '%', cls: 'd-good' };
  if (p > 0) return { txt: '+' + p + '%', cls: 'd-bad' };
  return { txt: '0%', cls: 'd-neutral' };
}
function cardStatusHex(status) {
  const tokens = { success: 'success-text', danger: 'danger-text', info: 'info-text', warning: 'warning-text', accent: 'accent-text', neutral: 'text-secondary' };
  return `var(--${tokens[taskStatusTone(status)]})`;
}
function cardGradePill(v) {
  if (!v) return '—';
  const cls = ({ A: 'g-a', B: 'g-b', C: 'g-c', D: 'g-d', E: 'g-e' })[v] || 'b-gray';
  const desc = { A: 'выше всяких ожиданий', B: 'выше ожиданий', C: 'в рамках ожиданий', D: 'ниже ожиданий', E: 'сильно ниже ожиданий, провал' }[v] || '';
  return '<span class="pill status ' + cls + '" title="' + desc + '">' + escapeHtml(v) + '</span>';
}
function cardSel(k, options, v) {
  const opts = options.filter(value => value !== '');
  if (v && opts.indexOf(v) === -1) opts.unshift(v);
  return uiControl({ kind: 'select', value: v || '', options: [{ value: '', label: 'Не выбрано' }, ...opts.map(value => ({ value, label: value }))], attrs: { 'data-k': k, 'aria-label': cardFieldLabel(k) } });
}
function cardSelScore(k, v) {
  return uiControl({ kind: 'select', value: v, options: [{ value: '', label: '—' }, ...['A', 'B', 'C', 'D', 'E'].map(value => ({ value, label: value }))], attrs: { 'data-k': k, 'aria-label': cardFieldLabel(k) } });
}
function cardNumC(k, v, s, max = null) { return uiControl({ type: 'number', value: v ?? '', attrs: { step: s || 1, min: 0, max, 'data-k': k, 'aria-label': cardFieldLabel(k) } }); }
function cardTxtC(k, v) { return uiControl({ value: v, attrs: { 'data-k': k, 'aria-label': cardFieldLabel(k) } }); }
function cardTaC(k, v, r, maxLength) { return uiControl({ kind: 'textarea', value: v, attrs: { rows: r || 4, 'data-k': k, 'aria-label': cardFieldLabel(k), maxlength: maxLength } }); }
function cardDateC(k, v) { return uiControl({ type: 'date', value: v || '', attrs: { 'data-k': k, 'aria-label': cardFieldLabel(k) } }); }

function cardProgressEditor(value) {
  const progress = Math.min(100, Math.max(0, Math.round(+value || 0)));
  return '<div class="ui-task-progress-editor" style="--progress-position:' + progress + '%"><output class="ui-task-progress-value" data-progress-value>' + progress + '%</output><input type="range" min="0" max="100" step="1" data-k="progress" value="' + progress + '" aria-label="Прогресс, процентов"></div>';
}
function cardF(l, inner, o) {
  o = o || {};
  const editAttrs = o.editKey && cardEditPermission().allowed ? ' inline-edit-target" data-inline-edit="' + o.editKey + '" role="button" tabindex="0" aria-label="Изменить: ' + escapeHtml(l) + '" title="Нажмите, чтобы изменить"' : '"';
  return '<div class="field ' + (o.span2 ? 'span2 ' : '') + (o.span4 ? 'span4 ' : '') + '"><div class="flabel"><span class="flt">' + escapeHtml(l) + '</span>' + (o.lock ? '<span class="lk">' + cardIcon('lock') + '</span>' : '') + '</div><div class="fval' + editAttrs + '>' + inner + '</div></div>';
}
function cardIcell(l, inner, o) {
  o = o || {};
  const editAttrs = o.editKey && cardEditPermission().allowed ? ' inline-edit-target" data-inline-edit="' + o.editKey + '" role="button" tabindex="0" aria-label="Изменить: ' + escapeHtml(l) + '" title="Нажмите, чтобы изменить"' : '"';
  return '<div class="icell ' + (o.span2 ? 'span2cell' : '') + '"><div class="ilab"><span class="flt">' + escapeHtml(l) + '</span>' + (o.lock ? '<span class="lk">' + cardIcon('lock') + '</span>' : '') + '</div><div class="ival' + (o.valueClass ? ' ' + o.valueClass : '') + editAttrs + '>' + inner + '</div></div>';
}
function cardV(v) { return '<div>' + v + '</div>'; }
function cardROv(v) { return '<div class="task-readonly-value">' + v + '</div>'; }
function cardGrid() { return '<div class="grid">' + Array.prototype.slice.call(arguments).join('') + '</div>'; }
function cardGrid4() { return '<div class="grid4">' + Array.prototype.slice.call(arguments).join('') + '</div>'; }
function cardChipsStatic(arr) {
  return arr.length ? '<div class="chips">' + arr.map(x => '<span class="chip static">' + cardIcon('team') + escapeHtml(x) + '</span>').join('') + '</div>' : '—';
}
function cardChipsTeams(all, selArr, field) {
  const ordered = all.slice().sort((a, b) => (selArr.indexOf(b) >= 0 ? 1 : 0) - (selArr.indexOf(a) >= 0 ? 1 : 0));
  return '<div class="chips">' + ordered.map(x => '<button type="button" class="btn btn-secondary btn-sm ui-btn chip ' + (selArr.indexOf(x) >= 0 ? 'on' : '') + '" aria-pressed="' + (selArr.indexOf(x) >= 0) + '" data-toggle="' + field + '" data-val="' + escapeHtml(x) + '">' + (selArr.indexOf(x) >= 0 ? cardIcon('check') : cardIcon('plus')) + escapeHtml(x) + '</button>').join('') + '</div>';
}
function cardChipsTags(all, selArr, field, editable) {
  if (!editable) return selArr.length ? '<div class="chips">' + selArr.map(x => '<span class="chip static">' + cardIcon('tag') + escapeHtml(x) + '</span>').join('') + '</div>' : '—';
  return '<div class="chips">' + all.map(x => '<button type="button" class="btn btn-secondary btn-sm ui-btn chip ' + (selArr.indexOf(x) >= 0 ? 'on' : '') + '" aria-pressed="' + (selArr.indexOf(x) >= 0) + '" data-toggle="' + field + '" data-val="' + escapeHtml(x) + '">' + (selArr.indexOf(x) >= 0 ? cardIcon('check') : cardIcon('plus')) + escapeHtml(x) + '</button>').join('') + '</div>';
}
function cardSec(t, i) { return '<h3 class="sec"><span class="sic">' + cardIcon(i) + '</span>' + escapeHtml(t) + '</h3>'; }
function cardLnk(u) { const safe = safeExternalUrl(u); return safe ? '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + cardIcon('link') + escapeHtml(u) + '</a>' : 'Некорректная ссылка'; }

function buildCardState(task) {
  const t = task || {};
  const eo = {}, ftz = {};
  CARD_ROLES.forEach(r => {
    eo[r.key] = cardNum(t[r.field]);
    ftz[r.key] = cardNum(t[r.actual]);
  });
  const involved = Array.isArray(t.involved_team_names)
    ? t.involved_team_names
    : (Array.isArray(t.involved_teams) ? t.involved_teams.map(String) : []);
  const tagNames = Array.isArray(t.tags)
    ? t.tags.map(x => (typeof x === 'string' ? x : (x && x.name) || '')).filter(Boolean)
    : [];
  const num = v => (v == null || v === '') ? null : Number(v);
  const fin = v => num(v);
  return {
    id: t.id,
    publicId: formatTaskPublicId(t),
    title: t.title || '',
    description: t.description || '',
    comment: t.comment || '',
    receivedAt: t.date_received || '',
    team: t.team_name || t.team || '',
    channel: t.channel_name || t.source_channel || '',
    channelId: t.channel_id == null ? null : Number(t.channel_id),
    didClientId: String(t.did_client_group_id ?? ''),
    customerDeptId: String(t.department_id ?? ''),
    didClientName: t.did_client_group_name || '',
    customer: t.business_customer_name || '',
    customerDept: t.department_name || t.customer_department || '',
    project: t.project_name || t.project || '',
    type: t.task_type_name || t.task_type || '',
    taskTypeId: t.task_type_id == null ? null : Number(t.task_type_id),
    otherTeams: involved,
    tags: tagNames,
    priority: t.priority_name || t.priority || '',
    status: t.status_name || t.status || '',
    deadline: t.deadline_name || t.deadline || '',
    deadlineId: t.deadline_id == null ? null : Number(t.deadline_id),
    assignee: t.owner_name || t.owner || '',
    progress: num(t.progress) || 0,
    effortDays: num(t.effort_days),
    eo: eo, ftz: ftz,
    cv: t.cv,
    finEffect: fin(t.financial_effect),
    finJust: t.financial_effect_justification || '',
    metricKrPlan: num(t.metric_kr_plan),
    metricKrFact: num(t.metric_kr_fact),
    metricKrUnit: t.metric_kr_unit || '',
    priorityScore: t.priority_score == null ? null : Number(t.priority_score),
    priorityJust: t.priority_justification || '',
    weightPercent: num(t.assessment_weight),
    forecastPercent: num(t.completion_forecast),
    hardScore: t.hard_score || '',
    softScore: t.soft_score || '',
    statuses: {
      directorate: { cur: t.directorate_status || '', prev: t.prev_directorate_status || '', at: t.directorate_status_updated_at || '' },
      did: { cur: t.did_status || '', prev: t.prev_did_status || '', at: t.did_status_updated_at || '' },
      key: { cur: t.key_project_status || '', prev: t.prev_key_project_status || '', at: t.key_project_status_updated_at || '' },
    },
    demoDid: !!t.did_demo,
    mockupUrl: t.link_mockups || '',
    jiraLinks: cardParseLinks(t.link_jira),
    reqLinks: cardParseLinks(t.link_requirements),
    author: t.created_by_name || '—',
    createdAt: t.created_at || '',
    updatedAt: t.updated_at || '',
  };
}

async function cardLoadDict(app, expectedTaskId = currentTask?.id) {
  const api = app?.api || window.app?.api;
  const taskId = Number(expectedTaskId);
  if (!api || !cardMatchesCurrentTask(taskId)) return false;
  const request = _taskCardRequestGate.start('task-dictionaries', taskId);
  const norm = r => Array.isArray(r) ? r : ((r && r.items) || []);
  const [ref, legacyTaskTypes, legacyChannels] = await Promise.all([
    api.get('/tasks/reference', { signal: request.signal }).catch(() => null),
    api.get('/admin/task-types', { signal: request.signal }).catch(() => []),
    api.get('/admin/channels', { signal: request.signal }).catch(() => []),
  ]);
  if (!_taskCardRequestGate.isCurrent(request.token, taskId) || !cardMatchesCurrentTask(taskId)) {
    _taskCardRequestGate.finish(request.token);
    return false;
  }
  const cached = app || window.app || {};
  cardDict = {
    teams: norm(ref?.teams || cached.teams),
    users: norm(ref?.users || cached.users).filter(u => u.is_active !== false),
    projects: norm(ref?.projects || cached.projects),
    statuses: norm(ref?.statuses || cached.statuses),
    priorities: norm(ref?.priorities || cached.priorities),
    deadlines: norm(ref?.deadlines || cached.deadlines),
    taskTypes: norm(ref?.task_types || cached.taskTypes),
    channels: norm(ref?.channels || cached.channels),
    didClientGroups: norm(ref?.did_client_groups || cached.didClientGroups),
    customers: norm(ref?.business_customers || cached.businessCustomers),
    departments: norm(ref?.departments || cached.departments),
    tags: norm(ref?.tags || cached.tags),
  };
  cardBuildMaps();
  const recoverLegacyRef = (state, nameKey, idKey, legacyItems, canonicalItems) => {
    if (!state || state[nameKey] || state[idKey] == null) return;
    const legacy = norm(legacyItems).find(x => Number(x?.id) === Number(state[idKey]));
    if (!legacy?.name) return;
    const key = String(legacy.name).trim().toLocaleLowerCase('ru-RU');
    const canonical = norm(canonicalItems).find(x => String(x?.name || '').trim().toLocaleLowerCase('ru-RU') === key);
    if (!canonical) return;
    state[nameKey] = canonical.name;
    state[idKey] = Number(canonical.id);
  };
  recoverLegacyRef(cardState.current, 'type', 'taskTypeId', legacyTaskTypes, cardDict.taskTypes);
  recoverLegacyRef(cardState.current, 'channel', 'channelId', legacyChannels, cardDict.channels);
  recoverLegacyRef(cardState.draft, 'type', 'taskTypeId', legacyTaskTypes, cardDict.taskTypes);
  recoverLegacyRef(cardState.draft, 'channel', 'channelId', legacyChannels, cardDict.channels);
  _taskCardRequestGate.finish(request.token);
  return true;
}
function cardNameList(key) {
  return (cardDict && cardDict[key] ? cardDict[key] : []).map(x => (x && (x.name || x.login || x.email)) || '').filter(Boolean);
}
function cardBuildMaps() {
  const idMap = key => {
    const m = {};
    (cardDict && cardDict[key] ? cardDict[key] : []).forEach(x => {
      const n = x && (x.name || x.title || x.login || x.email);
      if (n) m[n] = x.id;
    });
    return m;
  };
  const statuses = idMap('statuses'), priorities = idMap('priorities'), deadlines = idMap('deadlines'),
    teams = idMap('teams'), projects = idMap('projects'), taskTypes = idMap('taskTypes'),
    channels = idMap('channels'), customers = idMap('customers'), users = idMap('users');
  const idOf = (m, n) => { if (!n) return null; const id = m[n]; return id === undefined ? null : id; };
  cardMaps = {
    statusId: n => idOf(statuses, n), priorityId: n => idOf(priorities, n),
    deadlineId: n => idOf(deadlines, n), teamId: n => idOf(teams, n),
    projectId: n => idOf(projects, n), typeId: n => idOf(taskTypes, n),
    channelId: n => idOf(channels, n), customerId: n => idOf(customers, n),
    userId: n => idOf(users, n),
  };
}

function cardRenderHeader() {
  const el = document.getElementById('mhead');
  if (!el) return;
  const t = cardCur();
  const meta = '<button class="ui-link ui-task-dialog-id" data-action="copy-id" title="Скопировать ID">' + escapeHtml(t.publicId || formatTaskPublicId(t.id)) + '</button>'
    + uiBadge({ label: t.type, tone: 'neutral', attrs: { id: 'hType' } })
    + '<span class="ui-task-dialog-project">' + escapeHtml(t.project || '') + '</span>';
  const actions = uiButton({ label: 'Копировать ссылку на задачу', iconMarkup: cardIcon('link'), iconOnly: true, variant: 'ghost', attrs: { 'data-action': 'copy-link' } })
    + uiButton({ label: 'Закрыть карточку задачи', iconMarkup: cardIcon('x'), iconOnly: true, variant: 'ghost', attrs: { 'data-action': 'close', title: 'Закрыть (Esc)' } });
  el.innerHTML = '<div class="ui-task-dialog-head-row"><div class="ui-task-dialog-meta">' + meta + '</div><div class="ui-task-dialog-actions">' + actions + '</div></div>'
    + '<div class="ui-task-dialog-title-row"><h1 class="ui-task-dialog-title" id="task-detail-title" title="' + escapeHtml(cardState.editing ? cardState.current.title : t.title) + '">' + escapeHtml(cardState.editing ? cardState.current.title : t.title) + '</h1>'
    + (cardState.editing ? uiBadge({ label: 'Редактирование', tone: 'accent', className: 'ui-task-dialog-edit-badge' }) : '') + '</div>';
}

function cardRenderTabs() {
  const el = document.getElementById('tabs');
  if (!el) return;
  const focusedTab = document.activeElement?.closest?.('#tabs [data-tab]')?.dataset?.tab || '';
  const label = x => {
    if (x[0] === 'com') return 'Комментарии' + (cardState.commentsCount ? ' · ' + cardState.commentsCount : '');
    if (x[0] === 'sys') return 'Ссылки и файлы' + (cardState.filesCount ? ' · ' + cardState.filesCount : '');
    if (x[0] === 'log') return 'Лог изменений' + (cardState.history.length ? ' · ' + cardState.history.length : '');
    return x[1];
  };
  el.innerHTML = CARD_TABS.map(x => {
    const selected = cardState.tab === x[0];
    return uiTab({ id: 'task-tab-' + x[0], label: label(x), panelId: 'mbody', selected, className: 'ui-task-dialog-tab', attrs: { 'data-tab': x[0] } });
  }).join('');
  cardSyncTabsOverflow();
  if (focusedTab) document.getElementById('task-tab-' + normalizeTaskCardTab(focusedTab))?.focus({ preventScroll: true });
}


function cardSyncTabsOverflow() {
  const shell = document.getElementById('task-tabs-shell');
  const tabs = document.getElementById('tabs');
  if (!shell || !tabs) return;
  const maxScroll = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
  const hasOverflow = maxScroll > 2;
  const canScrollLeft = hasOverflow && tabs.scrollLeft > 2;
  const canScrollRight = hasOverflow && tabs.scrollLeft < maxScroll - 2;
  shell.classList.toggle('has-overflow', hasOverflow);
  shell.classList.toggle('can-scroll-left', canScrollLeft);
  shell.classList.toggle('can-scroll-right', canScrollRight);
  const left = shell.querySelector('[data-action="scroll-tabs-left"]');
  const right = shell.querySelector('[data-action="scroll-tabs-right"]');
  if (left) left.disabled = !canScrollLeft;
  if (right) right.disabled = !canScrollRight;
}

function cardSyncDescriptionDisclosure() {
  const shell = document.querySelector('#task-detail-overlay .task-description-shell');
  const content = shell?.querySelector('.task-description-content');
  const button = shell?.querySelector('.task-description-toggle');
  if (!shell || !content || !button) return;
  const collapsedHeight = Number.parseFloat(getComputedStyle(shell).getPropertyValue('--task-description-collapsed-height')) || 240;
  const isCollapsible = content.scrollHeight > collapsedHeight + 1;
  if (!isCollapsible) cardState.descriptionExpanded = false;
  shell.classList.toggle('is-collapsible', isCollapsible);
  shell.classList.toggle('is-expanded', isCollapsible && cardState.descriptionExpanded);
  button.hidden = !isCollapsible;
  button.setAttribute('aria-expanded', String(isCollapsible && cardState.descriptionExpanded));
  button.textContent = cardState.descriptionExpanded ? 'Свернуть' : 'Показать полностью';
}

function cardKpiCard(l, v, lock) {
  return '<div class="kpi"><div class="kl"><span class="flt">' + escapeHtml(l) + '</span>' + (lock ? '<span class="lk">' + cardIcon('lock') + '</span>' : '') + '</div><div class="kv">' + v + '</div></div>';
}
function cardEffectiveFin(t) { return t.finEffect; }
function cardEffectiveFinJust(t) { return t.finJust || ''; }
const CARD_PRIORITISER_REQUIREMENTS = {
  value: [
    { key: 'task_id', label: 'ID задачи', value: t => t.publicId || t.id },
    { key: 'task_type', label: 'Тип задачи', value: t => t.type },
    { key: 'team', label: 'Ответственная команда', value: t => t.team },
    { key: 'title', label: 'Название задачи', value: t => t.title },
  ],
  priority: [
    { key: 'task_id', label: 'ID задачи', value: t => t.publicId || t.id },
    { key: 'task_type', label: 'Тип задачи', value: t => t.type },
    { key: 'team', label: 'Ответственная команда', value: t => t.team },
    { key: 'title', label: 'Название задачи', value: t => t.title },
    { key: 'effort_man_days', label: 'Оценка трудозатрат, ч/д', value: t => t.effortDays },
    { key: 'business_customer', label: 'Бизнес-заказчик', value: t => t.customer },
    { key: 'deadline', label: 'Срок выполнения', value: t => t.deadline },
  ],
};
const CARD_PRIORITISER_FIELD_LABELS = Object.values(CARD_PRIORITISER_REQUIREMENTS)
  .flat()
  .reduce((labels, item) => { labels[item.key] = item.label; return labels; }, {});

function cardPrioritiserValueFilled(value) {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');
}

function cardPrioritiserRequirements(kind, serverMissing = null) {
  const task = cardState.current || buildCardState(currentTask || {});
  const missingKeys = Array.isArray(serverMissing) ? new Set(serverMissing) : null;
  const requirements = (CARD_PRIORITISER_REQUIREMENTS[kind] || []).map(item => ({
    key: item.key,
    label: item.label,
    filled: missingKeys?.has(item.key) ? false : cardPrioritiserValueFilled(item.value(task)),
  }));
  if (missingKeys) {
    missingKeys.forEach(key => {
      if (!requirements.some(item => item.key === key)) {
        requirements.push({ key, label: CARD_PRIORITISER_FIELD_LABELS[key] || 'Необходимое поле', filled: false });
      }
    });
  }
  return requirements;
}

function cardPrioritiserChecklist(items, className = '') {
  return '<ul class="agent-check-list' + (className ? ' ' + className : '') + '">' + items.map(item =>
    '<li class="agent-check-item ' + (item.filled ? 'ready' : 'missing') + '">' +
      '<span class="agent-check-mark" aria-hidden="true">' + (item.filled ? '✓' : '!') + '</span>' +
      '<span>' + escapeHtml(item.label) + '</span>' +
      '<span class="agent-check-state">' + (item.filled ? 'Заполнено' : 'Не заполнено') + '</span>' +
    '</li>'
  ).join('') + '</ul>';
}

function showPrioritiserRequirementsModal(kind, items) {
  document.getElementById('prioritiser-requirements-overlay')?.remove();
  const origin = document.activeElement;
  const calculation = kind === 'value' ? 'финансового эффекта' : 'приоритета';
  const overlay = document.createElement('div');
  overlay.id = 'prioritiser-requirements-overlay';
  overlay.className = 'modal-overlay prioritiser-requirements-overlay';
  overlay.style.zIndex = '1250';
  overlay.innerHTML = '<div class="prioritiser-requirements-modal ui-task-requirements app-modal app-modal--small" role="dialog" aria-modal="true" aria-labelledby="prioritiser-requirements-title">' +
    '<div class="app-modal__header"><h3 class="app-modal__title" id="prioritiser-requirements-title">Не хватает данных для расчёта ' + calculation + '</h3>' +
    uiButton({label:'Закрыть',variant:'ghost',iconMarkup:cardIcon('x'),iconOnly:true,className:'prioritiser-requirements-x',attrs:{'data-modal-close':true}}) + '</div>' +
    '<div class="app-modal__body"><p>Заполните отмеченные поля в карточке задачи и повторите расчёт.</p>' +
    cardPrioritiserChecklist(items, 'agent-check-list-modal') + '</div>' +
    '<div class="prioritiser-requirements-actions app-modal__footer">' + uiButton({label:'Закрыть',variant:'primary',attrs:{'data-action':'close-requirements'}}) + '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  enhanceDialogOverlay(overlay, origin);

  const closeButton = overlay.querySelector('[data-action="close-requirements"]');
  const close = () => {
    overlay.remove();
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  };
  overlay.querySelector('.prioritiser-requirements-x')?.addEventListener('click', close);
  closeButton?.addEventListener('click', close);
  closeButton?.focus();
}

function cardPrioritiserButton(kind, label = 'AI-расчёт') {
  const running = cardState.prioritiserRunning === kind;
  const action = kind === 'value' ? 'ai-calc-fin' : 'ps-calc';
  const requirements = cardPrioritiserRequirements(kind);
  const permission = cardEditPermission();
  const tooltipId = 'agent-check-' + kind;
  const disabled = Boolean(cardState.prioritiserRunning || !permission.allowed);
  const tooltipBody = permission.allowed
    ? '<span class="agent-check-title">Для расчёта нужны поля</span>' + cardPrioritiserChecklist(requirements)
    : '<span class="agent-check-title">Расчёт недоступен</span><span>' + escapeHtml(permission.reason) + '</span>';
  return '<span class="agent-check-wrap">' + uiButton({ label: running ? 'Расчёт…' : label, variant: 'ai', iconMarkup: cardIcon('spark'), attrs: { 'data-action': action, 'aria-describedby': tooltipId, 'aria-busy': running, disabled } })
    + '<span class="agent-check-tooltip" id="' + tooltipId + '" role="tooltip">' + tooltipBody + '</span></span>';
}
function cardKpiBlock(t, e) {
  const cost = cardCalcCost(t.eo), fcost = cardCalcCost(t.ftz);
  const ftzT = cardCalcSum(t.ftz), eoSum = cardCalcSum(t.eo);
  const displayFin = cardEffectiveFin(t), displayFinJust = cardEffectiveFinJust(t);
  const cvE = (t.cv == null || t.cv === '') ? cardCvCalc(cost, displayFin) : Number(t.cv);
  const cvF = cardCvCalc(fcost, displayFin);
  let h = '<div class="kpi2"><div class="kpigroup"><div class="kglabel">План (ЭО)</div><div class="kpirow3">'
    + cardKpiCard('Оценка трудозатрат (ЭО)', '<span data-dyn="eo">' + cardFmtNum(eoSum) + '</span> <small>ч/д</small>', true)
    + cardKpiCard('Стоимость по ЭО', '<span data-dyn="cost">' + cardFmtMoney(cost) + '</span>', true)
    + cardKpiCard('C/V по ЭО', '<span data-dyn="cvE" class="' + cardCvCls(cvE) + '">' + (cvE == null ? '—' : cvE.toLocaleString('ru-RU')) + '</span>', true)
    + '</div></div><div class="kpigroup"><div class="kglabel">Факт (ФТЗ)</div><div class="kpirow3">'
    + cardKpiCard('Фактические трудозатраты', '<span data-dyn="ftz">' + cardFmtNum(ftzT) + '</span> <small>ч/д</small>', true)
    + cardKpiCard('Стоимость по ФТЗ', '<span data-dyn="fcost">' + cardFmtMoney(fcost) + '</span>', true)
    + cardKpiCard('C/V по ФТЗ', '<span data-dyn="cvF" class="' + cardCvCls(cvF) + '">' + (cvF == null ? '—' : cvF.toLocaleString('ru-RU')) + '</span>', true)
    + '</div></div></div>';
  h += '<div class="psrow">';
  h += '<div class="kpi"><div class="kl"><span class="flt">Priority Score</span><span class="lk">' + cardIcon('lock') + '</span>'
    + cardPrioritiserButton('priority') + '</div>';
  h += '<div class="kv big"><span data-dyn="ps" class="' + cardPsCls(t.priorityScore) + '">' + (t.priorityScore == null ? '—' : t.priorityScore) + '</span> <small>/ 100</small></div>';
  h += '<div class="psbar"><span id="psBar" style="width:' + (t.priorityScore || 0) + '%"></span></div>';
  h += '<div class="just"><div class="flabel"><span class="flt">Обоснование агента</span></div><div class="fval"><span class="txt">' + (t.priorityJust ? cardNl2br(t.priorityJust) : '—') + '</span></div></div>';
  h += '</div>';
  h += '<div class="kpi"><div class="kl"><span class="flt">Финансовый эффект</span>'
    + cardPrioritiserButton('value') + '</div>';
  h += e
    ? '<div class="fval"><input class="input ui-control" type="number" step="0.1" min="0" data-k="finEffect" aria-label="Финансовый эффект" value="' + (t.finEffect == null ? '' : t.finEffect) + '" style="max-width:140px;display:inline-block"> <small style="color:var(--tfaint)">млн ₽</small></div>'
    : '<div class="kv big"><span data-dyn="fin">' + cardFmtNum(displayFin, 2) + '</span> <small>млн ₽</small></div>';
  h += '<div class="psbar hide"></div>';
  h += '<div class="just"><div class="flabel"><span class="flt">Обоснование расчёта</span></div><div class="fval">' + (e ? cardTaC('finJust', t.finJust, 5) : '<span class="txt">' + (displayFinJust ? cardNl2br(displayFinJust) : '—') + '</span>') + '</div><div class="aipop" id="finPop"></div></div>';
  h += '</div></div>';
  return h;
}
function cardStatV30(label, value) {
  return '<div class="stat"><div class="slab">' + label + '<span class="lk" title="Только чтение">' + cardIcon('lock') + '</span></div><div class="sval">' + value + '</div></div>';
}
function cardKpiBlockV30(t, e) {
  const cost = cardCalcCost(t.eo), fcost = cardCalcCost(t.ftz);
  const dyn = (key, value) => '<span data-dyn="' + key + '">' + value + '</span>';
  const metric = (label, value, note) => '<div class="ui-task-detail-metric"><span class="ui-task-detail-note">' + label + '</span><div class="ui-task-detail-metric-value">' + value + '</div>' + note + '</div>';
  let h = '<div class="ui-task-detail-metrics">';
  h += metric('Трудозатраты, план', dyn('eo', cardFmtNum(cardCalcSum(t.eo))) + ' ч/д', '<span class="ui-task-detail-note">Факт: ' + dyn('ftz', cardFmtNum(cardCalcSum(t.ftz))) + ' ч/д</span>');
  h += metric('Стоимость, план', dyn('cost', cardFmtMoney(cost)), '<span class="ui-task-detail-note">Факт: ' + dyn('fcost', cardFmtMoney(fcost)) + '</span>');
  h += metric('Priority Score <span class="ui-task-detail-metric-help" tabindex="0" role="note" aria-label="Priority Score — рекомендация агента от 0 до 100; не заменяет выбранный приоритет" title="Рекомендация агента от 0 до 100; не заменяет выбранный приоритет">' + cardMainIcon('info') + '</span>', dyn('ps', t.priorityScore == null ? '—' : t.priorityScore) + ' <span class="ui-task-detail-note">/ 100</span>', '<span class="ui-task-detail-note">Рекомендация агента</span>');
  h += metric('Финансовый эффект', dyn('finDisplay', t.finEffect == null ? 'Не рассчитан' : cardFmtNum(t.finEffect, 2) + ' млн ₽'), cardPrioritiserButton('value', 'Рассчитать'));
  return h + '</div><div id="psPop"></div><div id="finPop"></div>';
}

function cardBodyMain(t, e) {
  const teams = cardNameList('teams');
  const users = cardNameList('users');
  const projects = cardNameList('projects');
  const types = cardNameList('taskTypes');
  const priorities = cardNameList('priorities');
  const statuses = cardNameList('statuses');
  const deadlines = cardNameList('deadlines');
  const channels = cardNameList('channels');
  const customers = cardNameList('customers');
  const tags = cardNameList('tags');
  let h = '';
  h += cardSec('Исполнение и команды', 'user');
  h += cardGrid4(
    cardF('Статус задачи', e ? cardSel('status', statuses, t.status) : cardV(uiBadge({ label: t.status, tone: taskStatusTone(t.status) }))),
    cardF('Приоритет', e ? cardSel('priority', priorities, t.priority) : cardV(uiBadge({ label: t.priority, tone: /^высок/i.test(t.priority || '') ? 'warning' : taskPriorityTone(t.priority) }))),
    cardF('Срок выполнения', e ? cardSel('deadline', deadlines, t.deadline) : cardV('<span class="vchip">' + cardIcon('cal') + escapeHtml(t.deadline) + '</span>')),
    cardF('Прогресс', e ? cardProgressEditor(t.progress) : cardV(uiProgress({ value: t.progress, showValue: true }))),
    cardF('Ответственная команда', e ? cardSel('team', teams, t.team) : cardV('<span class="vchip">' + cardIcon('team') + escapeHtml(t.team) + '</span>')),
    cardF('Исполнитель', e ? cardSel('assignee', users, t.assignee) : cardV('<span class="vchip">' + uiAvatar({ name: t.assignee, size: 24 }) + '' + escapeHtml(cardPerson(t.assignee)) + '</span>')),
    cardF('Проект', e ? cardSel('project', projects, t.project) : cardV('<span class="vchip">' + cardIcon('folder') + escapeHtml(t.project) + '</span>')),
    cardF('Тип задачи', e ? cardSel('type', types, t.type) : cardV('<span class="badge nodot b-violet">' + escapeHtml(t.type) + '</span>')),
    cardF('Другие вовлечённые команды · ' + t.otherTeams.length, e ? cardChipsTeams(teams, t.otherTeams, 'otherTeams') : cardChipsStatic(t.otherTeams), { span4: true }),
    cardF('Метки (теги)', cardChipsTags(tags, t.tags, 'tags', e), { span4: true }),
  );
  h += cardSec('Оценка', 'trend');
  h += cardGrid4(
    cardF('Вес оценки', e ? cardNumC('weightPercent', t.weightPercent, 1) : cardV(t.weightPercent == null ? '—' : t.weightPercent + '%')),
    cardF('Прогноз выполнения', e ? cardNumC('forecastPercent', t.forecastPercent, 1) : cardV(t.forecastPercent == null ? '—' : t.forecastPercent + '%')),
    cardF('Оценка за завершенность (Hard)', e ? cardSelScore('hardScore', t.hardScore) : cardV(t.hardScore ? '<span class="badge nodot">' + escapeHtml(t.hardScore) + '</span>' : '—')),
    cardF('Оценка за взаимодействие (Soft)', e ? cardSelScore('softScore', t.softScore) : cardV(t.softScore ? '<span class="badge nodot">' + escapeHtml(t.softScore) + '</span>' : '—')),
  );
  h += cardSec('Контекст и заказчик', 'folder');
  h += cardGrid4(
    cardF('Канал поступления', e ? cardSel('channel', channels, t.channel) : cardV(escapeHtml(t.channel))),
    cardF('Дата получения', e ? cardDateC('receivedAt', t.receivedAt) : cardV(cardFmtDate(t.receivedAt))),
    cardF('Бизнес-заказчик', e ? '<div style="display:flex;gap:8px;align-items:center">' + uiAvatar({ name: t.customer, size: 24, id: 'custAva' }) + '' + cardSel('customer', customers, t.customer) + '</div>' : cardV('<span class="vchip">' + uiAvatar({ name: t.customer, size: 24 }) + '' + escapeHtml(cardPerson(t.customer)) + '</span>')),
    cardF('Подразделение бизнес-заказчика', cardROv(escapeHtml(t.customerDept || '—')), { lock: true }),
  );
  h += cardSec('Описание задачи', 'file');
  h += cardGrid(cardF('Описание задачи', e ? cardTaC('description', t.description, 4) : cardV('<span class="txt">' + cardNl2br(t.description) + '</span>'), { span2: true }));
  h += cardSec('Комментарий', 'msg');
  h += cardGrid(cardF('Комментарий', e ? cardTaC('comment', t.comment, 4) : cardV('<span class="txt">' + (t.comment ? cardNl2br(t.comment) : '<span class="text-muted">—</span>') + '</span>'), { span2: true }));
  h += cardSec('Ключевые показатели', 'trend');
  h += cardKpiBlock(t, e);
  return h;
}

function cardCustomerReference(key, items, value, fallback, editing, departmentId) {
  items = items || [];
  if (!editing) return cardV(escapeHtml(items.find(i => String(i.id) === String(value))?.name || fallback || '—'));
  const preferred = items;
  const shown = preferred.slice();
  const selected = items.find(i => String(i.id) === String(value));
  if (selected && !shown.includes(selected)) shown.unshift(selected);
  return '<select class="input ui-control" data-k="' + key + '" aria-label="' + escapeHtml(cardFieldLabel(key)) + '"><option value="">Не выбрано</option>' + shown.map(i => '<option value="' + i.id + '"' + (String(i.id) === String(value) ? ' selected' : '') + '>' + escapeHtml(i.name) + '</option>').join('') + (shown.length < items.length ? '<option value="__all">Показать всех контактных лиц…</option>' : '') + '</select>';
}

function cardMainField(label, markup, key = '', editing = false, className = '') {
  const interactive = key && !editing && cardEditPermission().allowed;
  return {
    label,
    valueMarkup: '<span class="desc-val ui-task-detail-value">' + markup + '</span>',
    className: 'icell ui-task-detail-field ' + className,
    attrs: interactive ? { 'data-inline-edit': key, role: 'button', tabindex: '0', 'aria-label': 'Изменить: ' + label, title: 'Нажмите, чтобы изменить' } : {},
  };
}

function cardMainSection(title, content, options = {}) {
  return uiSectionCard({ title, content, variant: 'plain', className: 'ui-task-detail-section', ...options });
}

function cardMainIcon(name) {
  const shape = name === 'info' ? '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
    : name === 'up' ? '<path d="m18 15-6-6-6 6"/>' : '<path d="m6 9 6 6 6-6"/>';
  return '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + shape + '</svg>';
}

function cardMainEditField(key, label, markup, options = {}) {
  const id = 'task-edit-' + key;
  const control = markup.replace(/<(input|select|textarea)\b/, '<$1 id="' + id + '"');
  return uiFieldFrame({ id, label, controlMarkup: '<div class="desc-val">' + control + '</div>',
    required: key === 'title', className: 'icell ui-task-edit-field' + (options.full ? ' ui-task-edit-full' : ''), hint: options.hint || '' });
}

function cardMainExtraFields(t, e) {
  const f = (label, value, key = '') => cardMainField(label, value, key, e);
  const active = key => e && (!cardState.entryField || cardState.entryField === key);
  return uiDescriptionList({ className: 'ui-task-detail-grid', items: [
    f('Подразделение', cardCustomerReference('customerDeptId', cardDict?.departments, t.customerDeptId, t.customerDept, active('customerDeptId')), 'customerDeptId'),
    f('Клиент ДИД', cardCustomerReference('didClientId', cardDict?.didClientGroups, t.didClientId, t.didClientName, active('didClientId')), 'didClientId'),
    f('Канал поступления', active('channel') ? taskFormEditControl('channel', t.channel) : escapeHtml(t.channel || 'Не указан'), 'channel'),
    f('Дата получения', active('receivedAt') ? taskFormEditControl('receivedAt', t.receivedAt) : cardFmtDate(t.receivedAt), 'receivedAt'),
    f('Метрический KR', 'План: ' + (t.metricKrPlan == null ? 'Не задан' : cardFmtNum(t.metricKrPlan) + ' ' + escapeHtml(t.metricKrUnit || '')) + ' · Факт: ' + (t.metricKrFact == null ? 'Не измерен' : cardFmtNum(t.metricKrFact) + ' ' + escapeHtml(t.metricKrUnit || ''))),
  ] });
}

function cardMainAssessment(t, e) {
  const active = key => e && (!cardState.entryField || cardState.entryField === key);
  return uiDescriptionList({ className: 'ui-task-detail-grid assessment', items: [
    cardMainField('Общая оценка трудозатрат, ч/д', active('effortDays') ? cardNumC('effortDays', t.effortDays, 1, 10000) : (t.effortDays == null ? 'Не оценено' : cardFmtNum(t.effortDays) + ' ч/д'), 'effortDays', e),
    cardMainField('Вес оценки, %', active('weightPercent') ? cardNumC('weightPercent', t.weightPercent, 1, 100) : (t.weightPercent == null ? 'Не задан' : cardFmtNum(t.weightPercent) + '%'), 'weightPercent', e),
    cardMainField('Прогноз выполнения, %', active('forecastPercent') ? cardNumC('forecastPercent', t.forecastPercent, 1, 100) : (t.forecastPercent == null ? 'Не задан' : cardFmtNum(t.forecastPercent) + '%'), 'forecastPercent', e),
    cardMainField('Оценка завершённости (Hard)', cardGradePill(t.hardScore)),
    cardMainField('Оценка взаимодействия (Soft)', cardGradePill(t.softScore)),
  ] });
}

function cardMainJustifications(t, e) {
  const cvE = t.cv == null || t.cv === '' ? cardCvCalc(cardCalcCost(t.eo), t.finEffect) : Number(t.cv);
  const cvF = cardCvCalc(cardCalcCost(t.ftz), t.finEffect);
  return uiDescriptionList({ className: 'ui-task-detail-grid', items: [
    cardMainField('C/V по ЭО', '<span data-dyn="cvE">' + (cvE == null ? 'Нет расчёта' : cvE.toLocaleString('ru-RU')) + '</span>'),
    cardMainField('C/V по ФТЗ', '<span data-dyn="cvF">' + (cvF == null ? 'Нет расчёта' : cvF.toLocaleString('ru-RU')) + '</span>'),
    cardMainField('Обоснование агента', (t.priorityJust ? cardNl2br(t.priorityJust) : 'Обоснование пока не добавлено') + '<div>' + cardPrioritiserButton('priority') + '</div>'),
    cardMainField('Обоснование расчёта', e ? cardTaC('finJust', t.finJust, 3) : (t.finJust ? cardNl2br(t.finJust) : 'Обоснование пока не добавлено')),
  ] });
}

function cardMainFullEditor(t) {
  const f = cardMainEditField;
  let h = '<div class="ui-task-detail-composition ui-task-edit-composition"><div class="ui-task-edit-grid">';
  h += f('title', 'Название', uiControl({ value: t.title, attrs: { 'data-k': 'title', maxlength: 255, 'aria-label': 'Название задачи' } }), { full: true });
  h += f('status', 'Статус', cardSel('status', cardNameList('statuses'), t.status));
  h += f('assignee', 'Исполнитель', taskFormEditControl('assignee', t.assignee));
  h += f('deadline', 'Срок', taskFormEditControl('deadline', t.deadline));
  h += f('priority', 'Приоритет', taskFormEditControl('priority', t.priority));
  h += f('progress', 'Прогресс, %', cardNumC('progress', t.progress, 1, 100));
  h += f('team', 'Ответственная команда', taskFormEditControl('team', t.team), { hint: 'Команда ответственности задачи' });
  h += f('description', 'Описание', cardTaC('description', t.description, 3, taskFormMeta('description').maxLength), { full: true });
  h += f('comment', 'Внутренний комментарий', cardTaC('comment', t.comment, 3, taskFormMeta('comment').maxLength), { full: true });
  h += '</div><p class="ui-task-detail-hint">' + cardMainIcon('info') + 'Изменения применятся только после сохранения.</p>';
  h += '<div class="ui-task-edit-secondary">' + cardMainSection('Участники и классификация', uiDescriptionList({ className: 'ui-task-detail-grid', items: [
    cardMainField('Бизнес-заказчик', taskFormEditControl('customer', t.customer)),
    cardMainField('Проект', taskFormEditControl('project', t.project)),
    cardMainField('Тип задачи', taskFormEditControl('type', t.type)),
    cardMainField('Вовлечённые команды', cardChipsTeams(cardNameList('teams'), t.otherTeams, 'otherTeams')),
    cardMainField('Метки', cardChipsTags(cardNameList('tags'), t.tags, 'tags', true)),
  ] }) + cardMainExtraFields(t, true));
  h += cardMainSection('Оценка и прогноз', cardMainAssessment(t, true) + uiDescriptionList({ className: 'ui-task-detail-grid', items: [cardMainField('Финансовый эффект, млн ₽', cardNumC('finEffect', t.finEffect, .1) + cardPrioritiserButton('value'))] }));
  h += cardMainSection('Трудозатраты, стоимость и обоснования', '<div class="ui-table-scroll">' + cardEffortTable(t, true) + '</div>' + cardMainJustifications(t, true));
  return h + '</div><div id="psPop"></div><div id="finPop"></div></div>';
}

function cardBodyMainV30(t, e) {
  if (e && !cardState.entryField) return cardMainFullEditor(t);
  const edit = key => e && cardState.entryField === key;
  const f = (label, value, key = '', cls = '') => cardMainField(label, value, key, e, cls);
  const person = (value, id) => value ? '<span class="ui-task-detail-person">' + uiAvatar({ name: value, size: 24, id }) + '<span>' + escapeHtml(value) + '</span></span>' : 'Не назначен';
  const textControl = (key, value, empty = 'Не указан') => edit(key) ? taskFormEditControl(key, value) : escapeHtml(value || empty);
  const list = items => uiDescriptionList({ className: 'ui-task-detail-grid', items });
  const more = cardState.attributesExpanded || ['customerDeptId', 'didClientId', 'channel', 'receivedAt'].includes(cardState.entryField);
  const effortOpen = ['effortDays', 'weightPercent', 'forecastPercent', 'finEffect', 'finJust'].includes(cardState.entryField);
  let h = '<div class="ui-task-detail-composition">';
  if (edit('title')) h += '<div class="ui-task-edit-grid">' + cardMainEditField('title', 'Название', uiControl({ value: t.title, attrs: { 'data-k': 'title', maxlength: 255, 'aria-label': 'Название задачи' } }), { full: true }) + '</div>';
  h += '<section class="ui-task-detail-summary" aria-label="Рабочая сводка">' + uiDescriptionList({ className: 'ui-task-detail-summary-grid', items: [
    f('Статус', edit('status') ? cardSel('status', cardNameList('statuses'), t.status) : uiBadge({ label: t.status || 'Не задан', tone: taskStatusTone(t.status) }), 'status'),
    f('Исполнитель', edit('assignee') ? taskFormEditControl('assignee', t.assignee) : person(t.assignee, 'assigneeAva'), 'assignee'),
    f('Срок', textControl('deadline', t.deadline), 'deadline'),
    f('Приоритет', edit('priority') ? taskFormEditControl('priority', t.priority) : uiBadge({ label: t.priority || 'Не задан', tone: /^высок/i.test(t.priority || '') ? 'warning' : taskPriorityTone(t.priority) }), 'priority'),
    f('Прогресс', edit('progress') ? cardNumC('progress', t.progress, 1, 100) : uiProgress({ value: t.progress, showValue: true }), 'progress', 'ui-task-detail-progress'),
  ] }) + '</section>';
  const description = edit('description') ? taskFormEditControl('description', t.description) : '<div class="task-description-shell' + (cardState.descriptionExpanded ? ' is-expanded' : '') + '"><div class="txt task-description-content" id="task-description-content">' + (t.description ? renderTaskCardMarkdown(t.description) : '<p>Описание пока не добавлено.</p>') + '</div><div class="task-description-fade" aria-hidden="true"></div><button type="button" class="ui-link task-description-toggle" data-action="toggle-description" aria-controls="task-description-content" aria-expanded="' + (cardState.descriptionExpanded ? 'true' : 'false') + '" hidden>Показать полностью</button></div>';
  const comment = '<div class="ui-task-detail-optional task-comment">' + (edit('comment') ? cardMainEditField('comment', 'Внутренний комментарий', taskFormEditControl('comment', t.comment), { full: true }) : '<div class="ui-task-detail-note">' + (t.comment ? '<span>Внутренний комментарий</span><p>' + cardNl2br(t.comment) + '</p>' : 'Внутренний комментарий не добавлен') + '</div>' + (cardEditPermission().allowed && !e ? uiButton({ label: t.comment ? 'Изменить комментарий' : 'Добавить комментарий', variant: 'ghost', iconMarkup: cardIcon(t.comment ? 'edit' : 'plus'), attrs: { 'data-inline-edit': 'comment' } }) : '')) + '</div>';
  h += cardMainSection('Описание', uiDescriptionList({ className: 'ui-task-detail-text-grid', items: [f('Описание задачи', description, 'description', 'ui-task-detail-label-hidden')] }) + comment);
  if (!e) h += cardPipDecisionBanner(true);
  const feature = window.app?.features?.agent_v2;
  if (!e && feature?.enabled && feature?.pilot_allowed && feature?.operator_role) h += '<div class="task-requirement-entry">' + uiButton({ label: 'Открыть БТ в Агенте V2', variant: 'ai', attrs: { 'data-action': 'open-requirement-workspace' } }) + '</div>';
  const attrs = list([
    f('Ответственная команда', textControl('team', t.team, 'Не указана'), 'team'),
    f('Бизнес-заказчик', edit('customer') ? taskFormEditControl('customer', t.customer) : person(t.customer, 'custAva'), 'customer'),
    f('Проект', textControl('project', t.project), 'project'),
    f('Тип задачи', edit('type') ? taskFormEditControl('type', t.type) : uiBadge({ label: t.type || 'Не задан' }), 'type'),
    f('Вовлечённые команды', edit('otherTeams') ? cardChipsTeams(cardNameList('teams'), t.otherTeams, 'otherTeams') : escapeHtml(t.otherTeams.join(' · ') || 'Не указаны'), 'otherTeams'),
    f('Метки', edit('tags') ? cardChipsTags(cardNameList('tags'), t.tags, 'tags', true) : '<span class="ui-task-detail-chips">' + (t.tags.length ? t.tags.map(label => uiBadge({ label })).join('') : 'Не добавлены') + '</span>', 'tags'),
  ]);
  h += cardMainSection('Участники и классификация', attrs + '<div class="ui-task-detail-extra" id="task-extra-attributes"' + (more ? '' : ' hidden') + '>' + cardMainExtraFields(t, e) + '</div>', { actions: uiButton({ label: more ? 'Скрыть атрибуты' : 'Все атрибуты', variant: 'ghost', iconMarkup: cardMainIcon(more ? 'up' : 'down'), attrs: { 'data-action': 'toggle-card-attributes', 'aria-expanded': String(!!more), 'aria-controls': 'task-extra-attributes' } }) });
  h += cardMainSection('Оценки и показатели', cardKpiBlockV30(t, false));
  h += '<details class="ui-collapse-section ui-task-detail-effort effort-disclosure"' + (effortOpen ? ' open' : '') + '><summary class="ui-disclosure-text">Трудозатраты, стоимость и обоснования</summary><div class="ui-table-scroll">' + cardEffortTable(t, false) + '</div>' + cardMainSection('Оценка и прогноз', cardMainAssessment(t, e)) + cardMainSection('Обоснования и показатели C/V', cardMainJustifications(t, false)) + '</details>';
  return h + '</div>';
}

function cardEffortTable(t, e) {
  let rows = '';
  CARD_ROLES.forEach(r => {
    const eoV = t.eo[r.key], ftzV = t.ftz[r.key];
    const eoRub = taskMeasurementCost(eoV, cardRate(r.key));
    const ftzRub = taskMeasurementCost(ftzV, cardRate(r.key));
    const d = cardDiffPct(eoV, ftzV);
    rows += '<tr><td><b>' + r.name + '</b></td><td class="num">' + cardFmtNum(cardRate(r.key)) + '</td><td class="num">' + (e ? cardNumC('eo.' + r.key, eoV, 0.5) : cardFmtNum(eoV)) + '</td><td class="num" title="Тянется из внешней БД (Jira)">' + cardFmtNum(ftzV) + '</td><td class="num" data-costrow="' + r.key + '">' + cardFmtMoney(eoRub) + '</td><td class="num" data-ftzrow="' + r.key + '">' + cardFmtMoney(ftzRub) + '</td><td class="num"><span class="diff ' + d.cls + '" data-diffrow="' + r.key + '">' + d.txt + '</span></td></tr>';
  });
  const eoSum = cardCalcSum(t.eo), ftzSum = cardCalcSum(t.ftz), dt = cardDiffPct(eoSum, ftzSum);
  return '<table class="ui-table ui-table-data tbl"><colgroup><col style="width:23%"><col style="width:13%"><col style="width:10%"><col style="width:10%"><col style="width:15%"><col style="width:15%"><col style="width:14%"></colgroup><thead><tr><th>Компетенция</th><th class="num">Ставка, ₽/ч-д</th><th class="num">ЭО, ч/д</th><th class="num">ФТЗ, ч/д</th><th class="num">ЭО, ₽</th><th class="num">ФТЗ, ₽</th><th class="num">Разница</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td>Итого</td><td class="num">—</td><td class="num">' + cardFmtNum(eoSum) + '</td><td class="num">' + cardFmtNum(ftzSum) + '</td><td class="num"><span data-dyn="costTotal">' + cardFmtMoney(cardCalcCost(t.eo)) + '</span></td><td class="num"><span data-dyn="fcostTotal">' + cardFmtMoney(cardCalcCost(t.ftz)) + '</span></td><td class="num"><span class="diff ' + dt.cls + '" data-dyn="diffTotal">' + dt.txt + '</span></td></tr></tfoot></table>';
}
function cardEffortDisclosure(t, e) {
  return cardMainSection('Трудозатраты и стоимость: план (ЭО) / факт (ФТЗ)',
    '<div class="ui-table-scroll">' + cardEffortTable(t, e) + '</div><p class="ui-task-detail-note">Фактические трудозатраты поступают из внешней БД, связанной с Jira. Разница меньше 0 — факт ниже оценки, больше 0 — перерасход.</p>',
    { collapsible: true, open: e, className: 'ui-task-detail-disclosure effort-disclosure' });
}

function cardReportingDate(value) {
  if (!value) return 'Дата ещё не назначена';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(value + 'T12:00:00'));
}
function cardReportingItem(item) {
  const meeting = item.current_meeting;
  const current = item.current_status || {};
  const previous = item.previous_status || {};
  const meetingId = cardReportingMeetingId(item);
  const values = cardReportingValuesForItem(item);
  const reportingDirty = cardReportingDrafts.has(cardReportingDraftKey(item.kind, meetingId));
  const canEdit = !!item.can_edit;
  const editing = canEdit && (cardReportingEditors.has(cardReportingDraftKey(item.kind, meetingId)) || reportingDirty);
  const attrs = { 'data-reporting-kind': item.kind, 'data-meeting-id': meetingId };
  const editButton = canEdit ? uiButton({ label: current.text ? 'Изменить' : 'Добавить статус', variant: current.text ? 'ghost' : 'secondary', iconMarkup: cardIcon(current.text ? 'edit' : 'plus'), attrs: { ...attrs, 'data-action': 'edit-reporting-status' } }) : '';
  const compact = !editing && !current.text && !previous.text && !current.did_demo;
  const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Moscow'});
  const date = meeting?.scheduled_date ? (meeting.scheduled_date < today ? 'Встреча: ' : 'Следующая: ') + cardReportingDate(meeting.scheduled_date) : cardReportingDate(null);
  let h = '<section class="ui-task-report' + (compact ? ' ui-task-report--compact' : '') + (reportingDirty ? ' is-dirty' : '') + '" data-reporting-kind="' + escapeHtml(item.kind) + '" data-reporting-meeting-id="' + escapeHtml(meetingId) + '">';
  h += '<div class="ui-task-report-head"><div><h3>' + escapeHtml(item.title) + '</h3><p class="ui-task-secondary-meta">' + escapeHtml(date) + '</p></div>' + (compact ? editButton : uiBadge({ label: reportingDirty ? 'Черновик' : current.text ? 'Готов' : 'Не заполнен', tone: reportingDirty ? 'warning' : current.text ? 'success' : 'neutral' })) + '</div>';
  if (compact) return h + (!canEdit ? '<p class="ui-task-secondary-meta">' + escapeHtml(item.edit_reason || 'Доступно только для просмотра') + '</p>' : '') + '</section>';
  h += '<div class="ui-task-report-body"><div><div class="ui-task-secondary-label">Предыдущий' + (item.previous_meeting?.scheduled_date ? ' · ' + escapeHtml(cardReportingDate(item.previous_meeting.scheduled_date)) : ' статус') + '</div><p class="' + (previous.text ? 'ui-task-secondary-text' : 'ui-task-secondary-meta') + '">' + (previous.text ? cardNl2br(previous.text) : 'Статус не заполнен.') + '</p></div><div><div class="ui-task-secondary-label">Статус к ближайшей встрече</div>';
  h += editing ? uiControl({ kind: 'textarea', value: values.text, attrs: { 'data-reporting-text': item.kind, 'data-reporting-meeting-id': meetingId, rows: 3, maxlength: 5000, placeholder: 'Опишите прогресс, риски и следующие шаги', 'aria-label': 'Статус к ближайшей встрече: ' + item.title } }) : '<p class="' + (current.text ? 'ui-task-secondary-text' : 'ui-task-secondary-meta') + '">' + (current.text ? cardNl2br(current.text) : 'Статус ещё не заполнен.') + '</p>';
  if (item.kind === 'did') h += editing ? '<label class="ui-task-report-demo"><input type="checkbox" data-reporting-demo="did" data-reporting-meeting-id="' + escapeHtml(meetingId) + '"' + (values.didDemo ? ' checked' : '') + '> Демо для ДИД</label>' : '<p class="ui-task-secondary-meta">Демо для ДИД: ' + (values.didDemo ? 'да' : 'нет') + '</p>';
  h += '</div></div><div class="ui-task-report-foot"><span class="ui-task-secondary-meta">' + (reportingDirty ? 'Изменения не сохранены' : current.updated_at ? 'Сохранён ' + escapeHtml(cardFmtDT(current.updated_at)) + (current.updated_by_name ? ' · ' + escapeHtml(current.updated_by_name) : '') : canEdit ? 'Статус ещё не заполнялся' : escapeHtml(item.edit_reason || 'Доступно только для просмотра')) + '</span>';
  h += editing ? '<div class="ui-task-secondary-actions">' + uiButton({ label: 'Отменить', attrs: { ...attrs, 'data-action': 'cancel-reporting-status' } }) + uiButton({ label: 'Сохранить статус', variant: 'primary', iconMarkup: cardIcon('check'), attrs: { ...attrs, 'data-action': 'save-reporting-status', 'data-version': values.version } }) + '</div>' : editButton;
  return h + '</div></section>';
}
function cardBodyRep() {
  const feedback = cardReadFeedback('reporting-context', 'отчётные статусы');
  if (!cardReportingContext) return cardSec('Отчётные статусы для встреч', 'flag') + (feedback || renderViewState({ kind: 'loading', scope: 'partial', title: 'Загрузка отчётных статусов…' }));
  if (!cardReportingContext.items.length) return feedback + renderViewState({ kind: 'empty', scope: 'partial', title: 'Нет назначенных встреч', message: 'Отчётные статусы появятся после назначения встречи.' });
  return cardSecondaryHeading('Статусы к встречам', 'Каждая встреча сохраняется отдельно', uiBadge({ label: cardSecondaryCount(cardReportingContext.items.length, ['встреча','встречи','встреч']) })) + feedback + '<div class="ui-task-reports">'
    + cardReportingContext.items.map(cardReportingItem).join('') + '</div>';
}

async function cardLoadReportingContext(app, expectedTaskId = currentTask?.id) {
  const api = app?.api || window.app?.api;
  const taskId = Number(expectedTaskId);
  if (!api || !cardMatchesCurrentTask(taskId)) return null;
  await cardReadRequest('reporting-context', taskId,
    signal => api.get(`/tasks/${taskId}/reporting-statuses/context`, { signal }),
    context => { cardReportingContext = context; },
    () => { cardReportingLoading = cardReadState('reporting-context').loading; if (cardState.tab === 'rep') cardRenderBody(); });
  return cardReportingContext;
}

async function cardSaveReportingStatus(button, app) {
  const api = app?.api || window.app?.api;
  const taskId = Number(currentTask?.id);
  const kind = button.dataset.reportingKind;
  const meetingId = button.dataset.meetingId;
  const item = cardFindReportingItem(kind, meetingId);
  const values = item ? cardReportingValuesForItem(item) : null;
  if (!api || !values || !cardMatchesCurrentTask(taskId)) {
    cardToast('Не удалось определить сохраняемый отчётный статус', 'err');
    return;
  }
  if (item?.can_edit !== true) {
    cardToast(item?.edit_reason || 'Этот отчётный статус доступен только для просмотра', 'warn');
    return;
  }
  const draftKey = cardReportingDraftKey(kind, meetingId);
  button.disabled = true;
  try {
    await api.put(`/tasks/${taskId}/reporting-statuses/${meetingId}`, {
      text: values.text.trim() || null,
      did_demo: kind === 'did' ? values.didDemo : false,
      version: Number(button.dataset.version || values.version || 0),
    });
    if (!cardMatchesCurrentTask(taskId)) return;
    cardReportingDrafts.delete(draftKey);
    cardReportingEditors.delete(draftKey);
    await cardLoadReportingContext(app);
    cardUpdateDirty();
    cardToast('Отчётный статус сохранён', 'ok');
  } catch (error) {
    button.disabled = false;
    cardToast(error?.status === 409 ? 'Статус уже изменён. Обновите вкладку и повторите.' : 'Не удалось сохранить отчётный статус', 'err');
  }
}

function cardSecondaryHeading(title, subtitle = '', actions = '') {
  return '<div class="ui-task-secondary-head"><div><h2>' + escapeHtml(title) + '</h2>' + (subtitle ? '<p class="ui-task-secondary-meta">' + escapeHtml(subtitle) + '</p>' : '') + '</div>' + actions + '</div>';
}
function cardSecondaryCount(number, forms) {
  const last = number % 10, pair = number % 100;
  return number + ' ' + forms[pair >= 11 && pair <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2];
}
function cardCommentCount(items = []) {
  return items.reduce((sum, item) => sum + 1 + cardCommentCount(item.replies || []), 0);
}
function cardBodyCom() {
  const n = cardCommentCount(_commentsCache);
  const permission = cardCommentPermission();
  const draft = _taskCommentDraftSession.snapshot(currentTask?.id);
  const form = permission.allowed
    ? '<section id="comment-form-container" class="ui-task-composer" aria-label="Новый комментарий">'
      + '<div id="reply-indicator" class="reply-indicator" style="display:none;">'
      + '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>'
      + '<span class="reply-indicator-text"></span>'
      + '<button type="button" class="btn btn-ghost btn-sm square-icon ui-btn reply-indicator-cancel" onclick="window.__cancelReply()" aria-label="Отменить ответ"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
      + '<div class="ui-task-composer-input"><label class="ui-task-secondary-label" for="comment-textarea">Ваш комментарий</label><textarea class="ui-control" id="comment-textarea" rows="3" aria-label="Текст нового комментария" aria-controls="mention-dropdown" aria-autocomplete="list" aria-expanded="false" placeholder="Напишите комментарий. Для упоминания введите @">' + escapeHtml(draft?.text || '') + '</textarea><div id="mention-dropdown" class="ui-mention-popover" hidden></div></div>'
      + '<div class="ui-task-composer-foot"><span class="ui-task-secondary-meta" id="comment-draft-status" role="status" aria-live="polite"' + (draft?.text ? '' : ' hidden') + '>Черновик сохранён в карточке</span><button type="button" class="btn btn-primary btn-sm ui-btn" id="comment-submit-btn"' + (draft?.text?.trim() ? '' : ' disabled') + '><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Отправить</button></div>'
      + '</section>'
    : '<div class="reporting-status-note" role="note" style="margin-top:16px;">' + escapeHtml(permission.reason) + '</div>';
  return '<div class="ui-task-discussion">' + cardSecondaryHeading('Обсуждение задачи', '', '<span class="ui-task-secondary-meta">' + (n ? cardSecondaryCount(n, ['комментарий','комментария','комментариев']) : 'Нет комментариев') + '</span>')
    + '<div id="comments-list-container">' + renderViewState({ kind: 'loading', scope: 'partial', title: 'Загрузка комментариев…' }) + '</div>' + form + '</div>';
}
function cardBodyFiles() {
  const n = cardState.filesCount;
  const permission = cardEditPermission();
  const uploader = permission.allowed
    ? '<input type="file" id="attachment-file-input" class="attachment-file-input-hidden" multiple tabindex="-1" aria-hidden="true">'
      + '<div id="attachment-drop-zone" class="ui-task-file-drop" role="button" tabindex="0" aria-label="Добавить файлы к задаче" aria-describedby="attachment-drop-hint">'
      + '<strong>' + cardIcon('upload') + ' Перетащите файлы сюда</strong><p class="ui-task-secondary-meta" id="attachment-drop-hint">или выберите файлы · до 50 МиБ на файл</p></div>'
    : '<div class="reporting-status-note" role="note">' + escapeHtml(permission.reason) + '</div>';
  return '<section class="ui-task-material-section ui-task-files">' + cardSecondaryHeading('Файлы', '', permission.allowed ? uiButton({ label: 'Добавить файлы', iconMarkup: cardIcon('upload'), attrs: { 'data-action': 'pick-attachments' } }) : '')
    + '<div id="attachments-list-container" class="attachments-list-container"></div>' + uploader + '</section>';
}

function cardHydrateAttachments() {
  if (cardState.tab !== 'sys') return;
  clearTimeout(_cardAttachmentHydrationTimer);
  _attachmentFormInitialized = false;
  _cardAttachmentHydrationTimer = setTimeout(() => {
    _cardAttachmentHydrationTimer = null;
    if (cardState.tab !== 'sys' || !currentTask?.id) return;
    renderAttachmentsList();
    initAttachmentForm(currentTask.id, window.app);
  }, 0);
}

function cardLinksField(label, links, e, addId, delAct, addAct, ph) {
  let inner = '';
  if (e) {
    inner = links.map((u, i) => { const safe = safeExternalUrl(u); return '<div class="jrow">' + (safe ? '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + cardIcon('link') + escapeHtml(u) + '</a>' : '<span>Некорректная ссылка</span>') + '<button class="iconbtn" data-action="' + delAct + '" data-idx="' + i + '" title="Удалить">' + cardIcon('x') + '</button></div>'; }).join('')
      + '<div class="jadd">' + uiControl({ type: 'url', id: addId, attrs: { placeholder: ph, 'aria-label': label + ': новая ссылка' } }) + uiButton({ label: 'Добавить', iconMarkup: cardIcon('plus'), attrs: { 'data-action': addAct } }) + '</div>';
  } else {
    inner = links.map(u => '<div class="jrow">' + cardLnk(u) + '</div>').join('') || '—';
  }
  return cardF(label, inner, { span2: true });
}
function cardBodySys(t, e) {
  const row = (label, content) => '<div class="ui-task-material-row"><div><div class="ui-task-secondary-label">' + escapeHtml(label) + '</div>' + content + '</div></div>';
  const links = values => values.map(url => { const safe = safeExternalUrl(url); return safe ? '<a class="ui-task-material-link" href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer"><span>' + escapeHtml(url) + '</span>' + cardIcon('external') + '</a>' : '<span class="ui-task-secondary-meta">Некорректная ссылка</span>'; }).join('') || '<span class="ui-task-secondary-meta">Не добавлены</span>';
  let h = '<section class="ui-task-material-section">' + cardSecondaryHeading('Материалы и требования', '', !e && cardEditPermission().allowed ? uiButton({ label: 'Изменить ссылки', iconMarkup: cardIcon('edit'), attrs: { 'data-action': 'edit' } }) : '');
  h += row('Макеты', e ? cardTxtC('mockupUrl', t.mockupUrl) : links(t.mockupUrl ? [t.mockupUrl] : []));
  h += e ? cardLinksField('Ссылки на Jira', t.jiraLinks, e, 'newJira', 'del-jira', 'add-jira', 'https://jira…/ISSUE-123') : row('Jira', links(t.jiraLinks));
  h += e ? cardLinksField('Бизнес-требования', t.reqLinks, e, 'newReq', 'del-req', 'add-req', 'https://docs…/requirements') : row('Бизнес-требования', links(t.reqLinks));
  h += '</section>';
  h += cardBodyFiles();
  h += uiSectionCard({ title: 'Системная информация', variant: 'plain', collapsible: true, open: false, className: 'ui-task-material-system', content: uiDescriptionList({ items: [{ label: 'Автор', value: cardPerson(t.author) }, { label: 'Создана', value: cardFmtDT(t.createdAt) }, { label: 'Обновлена', value: cardFmtDT(t.updatedAt) }] }) });
  return h;
}

const CARD_HISTORY_REFERENCE_KEYS = {
  team_id: 'teams',
  channel_id: 'channels',
  business_customer_id: 'customers',
  department_id: 'departments',
  project_id: 'projects',
  task_type_id: 'taskTypes',
  priority_id: 'priorities',
  status_id: 'statuses',
  previous_status_id: 'statuses',
  deadline_id: 'deadlines',
  owner_id: 'users',
  created_by: 'users',
};

const CARD_PIP_DECISION_META = {
  accept: {
    label: 'Принята в работу',
    consequence: 'Задача прошла PI-планирование и перешла в работу.',
    tone: 'accept',
    icon: 'check',
  },
  rework: {
    label: 'Возвращена на экспресс-оценку',
    consequence: 'Команде нужно уточнить оценку и снова передать задачу на PI-планирование.',
    tone: 'rework',
    icon: 'edit',
  },
  reject: {
    label: 'Отклонена',
    consequence: 'Задача завершила PI-планирование с решением не брать её в работу.',
    tone: 'reject',
    icon: 'alert',
  },
};

function parsePipDecisionHistoryValue(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const meta = CARD_PIP_DECISION_META[parsed?.decision];
    if (!meta) return null;
    return {
      decision: parsed.decision,
      reason: String(parsed.reason || '').trim() || null,
      ...meta,
    };
  } catch (_) {
    return null;
  }
}

export function getLatestPipDecision(history = []) {
  const items = (Array.isArray(history) ? history : [])
    .filter(item => item?.field_name === 'pip_decision')
    .map(item => ({ item, outcome: parsePipDecisionHistoryValue(item.new_value) }))
    .filter(entry => entry.outcome)
    .sort((left, right) => {
      const timeDiff = (Date.parse(right.item.changed_at || '') || 0) - (Date.parse(left.item.changed_at || '') || 0);
      return timeDiff || (Number(right.item.id) || 0) - (Number(left.item.id) || 0);
    });
  if (!items.length) return null;
  const { item, outcome } = items[0];
  return {
    ...outcome,
    changedAt: item.changed_at || null,
    changedByName: item.changed_by_name || 'Система',
    historyId: item.id ?? null,
  };
}

export function renderPipDecisionOutcome(history = [], { compact = false } = {}) {
  const outcome = getLatestPipDecision(history);
  if (!outcome) return '';
  const reason = outcome.reason
    ? '<div class="pip-history-reason"><span>Комментарий к решению</span><strong>' + escapeHtml(outcome.reason) + '</strong></div>'
    : '<div class="pip-history-reason is-empty"><span>Комментарий к решению</span><strong>Не указан</strong></div>';
  const action = compact
    ? uiButton({ label: 'Открыть лог', iconMarkup: cardIcon('clock'), className: 'pip-history-open', attrs: { 'data-action': 'open-pip-history' } })
    : '';
  return '<section class="pip-history-summary is-' + outcome.tone + (compact ? ' is-compact' : '') + '" aria-label="Последнее PI-решение">'
    + '<div class="pip-history-icon">' + cardIcon(outcome.icon) + '</div>'
    + '<div class="pip-history-content"><span class="pip-history-eyebrow">Последнее PI-решение</span><div class="pip-history-title"><strong>' + escapeHtml(outcome.label) + '</strong><span>' + escapeHtml(outcome.consequence) + '</span></div>'
    + '<div class="pip-history-meta"><span>' + escapeHtml(cardFmtDT(outcome.changedAt)) + '</span><span>' + escapeHtml(outcome.changedByName) + '</span></div>' + reason + '</div>' + action + '</section>';
}

function cardPipDecisionBanner(compact = false) {
  return renderPipDecisionOutcome(cardState.history, { compact });
}

function cardHistoryValue(fieldName, value) {
  if (value == null || value === '' || value === 'None' || value === 'null') return null;
  if (fieldName === 'pip_decision') {
    const outcome = parsePipDecisionHistoryValue(value);
    return outcome ? outcome.label + (outcome.reason ? ` — ${outcome.reason}` : '') : value;
  }
  const dictionaryKey = CARD_HISTORY_REFERENCE_KEYS[fieldName];
  if (!dictionaryKey) return value;
  const item = (cardDict?.[dictionaryKey] || []).find(entry => Number(entry?.id) === Number(value));
  return item?.name || item?.title || item?.login || item?.email || value;
}

function cardHistoryDate(value) {
  if (!value) return 'Дата не указана';
  const date = new Date(value), today = new Date();
  if (Number.isNaN(date.getTime())) return 'Дата не указана';
  const time = date.toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'});
  if (date.toDateString() === today.toDateString()) return time;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера, ' + time;
  return date.toLocaleDateString('ru-RU', {day:'numeric',month:'short',...(date.getFullYear() !== today.getFullYear() ? {year:'numeric'} : {})}) + ', ' + time;
}
function cardBodyLog() {
  const items = [...cardState.history].sort((a, b) => (Date.parse(b.changed_at) || 0) - (Date.parse(a.changed_at) || 0) || (Number(b.id) || 0) - (Number(a.id) || 0));
  const state = cardReadState('task-history');
  const feedback = cardReadFeedback('task-history', 'историю изменений');
  if (!state.loaded && (state.loading || state.error)) return feedback;
  if (!items.length) return feedback + renderViewState({ kind: 'empty', scope: 'partial', title: 'История изменений пуста' });
  const rows = items.map(r => {
      const oldValue = cardHistoryValue(r.field_name, r.old_value);
      const newValue = cardHistoryValue(r.field_name, r.new_value);
      const name = r.changed_by_name || 'Система';
      const label = r.field_label || window.app?.fieldLabels?.[r.field_name] || (r.field_name === 'attachment' ? 'Вложение' : r.field_name || 'Поле');
      return '<article class="ui-task-history-item"><time class="ui-task-secondary-meta" datetime="' + escapeHtml(r.changed_at || '') + '">' + escapeHtml(cardHistoryDate(r.changed_at)) + '</time>' + uiAvatar({ name, size: 28 }) + '<div class="ui-task-history-copy"><strong>' + escapeHtml(name) + '</strong><p>' + escapeHtml(label) + '</p>' + (oldValue != null || newValue != null ? '<div class="ui-task-history-change">' + (oldValue != null ? '<del>' + escapeHtml(String(oldValue)) + '</del>' + cardIcon('arrow-right') : '') + '<span>' + escapeHtml(newValue != null ? String(newValue) : 'Не указано') + '</span></div>' : '') + '</div></article>';
  }).join('');
  return feedback + cardSecondaryHeading('История изменений', '', '<span class="ui-task-secondary-meta">Сначала новые · ' + cardSecondaryCount(items.length,['запись','записи','записей']) + '</span>') + cardPipDecisionBanner(false) + '<div class="ui-task-history">' + rows + '</div>';
}

function cardRenderBody() {
  const el = document.getElementById('mbody');
  if (!el) return;
  const t = cardCur(), e = cardState.editing;
  const fullEdit = e && !cardState.entryField;
  let h = '';
  if (cardState.tab === 'main') h = cardBodyMainV30(t, e);
  else if (cardState.tab === 'rep') h = cardBodyRep();
  else if (cardState.tab === 'com') h = cardBodyCom();
  else if (cardState.tab === 'sys') h = cardBodySys(t, fullEdit);
  else if (cardState.tab === 'work') h = '<div id="task-work-list"></div><div id="task-work-relations"></div>';
  else h = cardBodyLog();
  el.classList.toggle('ui-task-secondary', cardState.tab !== 'main');
  el.setAttribute('role', 'tabpanel');
  el.setAttribute('aria-labelledby', 'task-tab-' + cardState.tab);
  el.setAttribute('tabindex', '0');
  el.innerHTML = '<div id="td-lock-banner" style="display:none;"></div><div id="td-viewer-banner" style="display:none;"></div><div class="form-error-summary" id="card-form-error-summary" role="alert" hidden></div>' + h;
  if (cardState.tab === 'work') { mountWorkList(el.querySelector('#task-work-list'), window.app, currentTask.id, null, false, false, {canCreate:cardEditPermission().allowed, composition:'task-detail'}); mountRelations(el.querySelector('#task-work-relations'), window.app, 'major', currentTask.id, () => currentTask.version, {canEdit:cardEditPermission().allowed, composition:'task-detail'}); }
  cardSyncDescriptionDisclosure();
  cardRefreshDynamic();
  cardRenderPrioritiserValueProposal();
  renderLockBanner();
  renderViewerBanner();
  if (e) attachDictionarySearch(el, [
    { selector: '[data-k="team"]', label: 'Ответственная команда' },
    { selector: '[data-k="project"]', label: 'Проект' },
    { selector: '[data-k="customer"]', label: 'Бизнес-заказчик', preferredValues: (cardDict.customers || []).filter(c => String(c.department_id) === String(t.customerDeptId)).map(c => c.name) },
    { selector: '[data-k="assignee"]', label: 'Исполнитель', preferredValues: userValuesForTeam(cardDict?.users, cardMaps?.teamId(t.team), true) },
  ]);
  el.querySelectorAll('.agent-check-wrap').forEach(wrapper => {
    const trigger = wrapper.querySelector('button');
    const panel = wrapper.querySelector('[role="tooltip"]');
    if (trigger && panel && !panel.dataset.uiBound) {
      panel.dataset.uiBound = 'true';
      bindTooltip({ trigger, panel });
    }
  });
  cardHydrateAttachments();
  if (cardState.tab === 'com') {
    const taskId = Number(currentTask?.id);
    _commentFormInitialized = false;
    requestAnimationFrame(() => {
      if (!cardMatchesCurrentTask(taskId) || cardState.tab !== 'com') return;
      renderCommentList();
      initCommentForm(taskId, window.app);
    });
  }
}

function cardRenderFooter() {
  const el = document.getElementById('mfoot');
  if (!el) return;
  const t = cardCur();
  if (cardState.tab === 'rep' && !cardState.editing) {
    el.innerHTML = '<div class="fmeta">Каждая встреча сохраняется отдельно.</div><div class="factions"><span class="dirty" id="dirty" role="status" aria-live="polite"><i></i>Несохранённых статусов · ' + cardReportingDirtyCount() + '</span>' + uiButton({ label: 'Закрыть', attrs: { 'data-action': 'close' } }) + '</div>';
    cardUpdateDirty();
    return;
  }
  const lockedByOther = _lockInfo && _lockInfo.locked && !_lockInfo.is_mine;
  const editPermission = cardEditPermission();
  const editingTitle = cardState.entryField
    ? 'Быстрое редактирование · ' + escapeHtml(cardFieldLabel(cardState.entryField))
    : 'Редактирование карточки';
  const meta = cardState.editing
    ? '<span id="card-change-summary" role="status" aria-live="polite">Изменений пока нет</span>'
    : 'Обновлено ' + cardFmtDT(t.updatedAt);
  const contextualMeta = !cardState.editing && !editPermission.allowed ? escapeHtml(editPermission.reason) : !cardState.editing && cardState.tab === 'com' ? 'Комментарии публикуются отдельно от изменений задачи.' : !cardState.editing && cardState.tab === 'sys' ? 'Файлы добавляются сразу. Ссылки — после сохранения задачи.' : !cardState.editing && cardState.tab === 'log' ? 'История фиксирует сохранённые изменения.' : !cardState.editing && cardState.tab === 'work' ? 'Рабочие задачи сохраняются отдельно.' : meta;
  let h = '<div class="fmeta">' + contextualMeta + '</div><div class="factions"><span class="task-network-status" role="status" hidden></span><span class="dirty" id="dirty"><i></i>Не сохранено</span>';
  h += cardState.editing
    ? uiButton({ label: 'Отменить', iconMarkup: cardIcon('x'), attrs: { id: 'cardCancelBtn', 'data-action': 'cancel' } })
      + uiButton({ label: 'Сохранить', variant: 'primary', iconMarkup: cardIcon('check'), attrs: { id: 'saveBtn', 'data-action': 'save', disabled: true } })
    : ['com', 'sys', 'log', 'work'].includes(cardState.tab)
      ? uiButton({ label: 'Закрыть', attrs: { 'data-action': 'close' } })
    : editPermission.allowed
      ? uiButton({ label: 'Редактировать задачу', variant: 'primary', iconMarkup: cardIcon('edit'), attrs: { 'data-action': 'edit', disabled: !!lockedByOther, title: lockedByOther ? 'Задача редактируется другим пользователем' : undefined } })
      : uiButton({ label: 'Только просмотр', iconMarkup: cardIcon('lock'), attrs: { disabled: true, title: editPermission.reason, 'aria-label': 'Только просмотр. ' + editPermission.reason } });
  el.innerHTML = h + '</div>';
  cardUpdateDirty();
}

function cardRender() {
  cardRenderHeader();
  cardRenderTabs();
  cardRenderBody();
  cardRenderFooter();
  const modal = document.getElementById('task-detail-modal');
  if (modal) modal.classList.toggle('editing', cardState.editing);
  if(currentTask?.id)document.dispatchEvent(new CustomEvent('task-card-rendered',{detail:{taskId:currentTask.id}}));

}

function cardRefreshDynamic() {
  const t = cardCur();
  const cost = cardCalcCost(t.eo), fcost = cardCalcCost(t.ftz);
  const ftzT = cardCalcSum(t.ftz), eoSum = cardCalcSum(t.eo);
  const cvE = cardCvCalc(cost, t.finEffect), cvF = cardCvCalc(fcost, t.finEffect);
  const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  set('task-detail-title', el => { const title = cardState.editing ? cardState.current.title : t.title; el.textContent = title; el.title = title; });
  set('hType', el => { el.textContent = t.type || '—'; });
  set('hStatus', el => { el.textContent = t.status; el.className = 'badge ui-badge task-head-chip'; el.dataset.uiTone = taskStatusTone(t.status); });
  set('hPrio', el => { el.textContent = t.priority; el.className = 'badge ui-badge task-head-chip'; el.dataset.uiTone = taskPriorityTone(t.priority); });
  set('hTeam', el => { el.textContent = t.team; });
  set('hAssignee', el => { el.textContent = cardPerson(t.assignee); });
  set('assigneeAva', el => { el.outerHTML = uiAvatar({ name: t.assignee, id: 'assigneeAva', size: Number(el.dataset.uiSize) }); });
  set('hDeadline', el => { el.textContent = t.deadline; });
  set('hProject', el => { el.textContent = t.project; });
  set('custAva', el => { el.outerHTML = uiAvatar({ name: t.customer, id: 'custAva', size: Number(el.dataset.uiSize) }); });
  set('custDept', el => { el.textContent = t.customerDept || '—'; });
  set('ringFg', el => { el.style.strokeDashoffset = (94.25 * (1 - (+t.progress || 0) / 100)).toFixed(2); });
  set('ringTxt', el => { el.textContent = t.progress + '%'; });
  set('titleCount', el => { const length = String(t.title || '').length; el.textContent = length + ' / 255'; el.classList.toggle('near-limit', length >= 230); });
  updateTaskCharacterCounters(document.getElementById('task-detail-overlay'));
  set('psBar', el => { el.style.width = (t.priorityScore || 0) + '%'; });
  document.querySelectorAll('#task-detail-overlay [data-dyn]').forEach(el => {
    const k = el.dataset.dyn;
    if (k === 'eo') el.textContent = cardFmtNum(eoSum);
    else if (k === 'cost') el.textContent = cardFmtMoney(cost);
    else if (k === 'fcost') el.textContent = cardFmtMoney(fcost);
    else if (k === 'ftz') el.textContent = cardFmtNum(ftzT);
    else if (k === 'fin') el.textContent = cardFmtNum(t.finEffect, 2);
    else if (k === 'finDisplay') el.textContent = t.finEffect == null ? 'Не рассчитан' : cardFmtNum(t.finEffect, 2) + ' млн ₽';
    else if (k === 'ps') { el.textContent = (t.priorityScore == null ? '—' : t.priorityScore); el.className = cardPsCls(t.priorityScore); }
    else if (k === 'cvE') { el.textContent = (cvE == null ? '—' : cvE.toLocaleString('ru-RU')); el.className = cardCvCls(cvE); }
    else if (k === 'cvF') { el.textContent = (cvF == null ? '—' : cvF.toLocaleString('ru-RU')); el.className = cardCvCls(cvF); }
    else if (k === 'costTotal') el.textContent = cardFmtMoney(cost);
    else if (k === 'fcostTotal') el.textContent = cardFmtMoney(fcost);
    else if (k === 'diffTotal') { const d = cardDiffPct(eoSum, ftzT); el.textContent = d.txt; el.className = 'diff ' + d.cls; }
  });
  document.querySelectorAll('#task-detail-overlay [data-costrow]').forEach(el => {
    el.textContent = cardFmtMoney(taskMeasurementCost(t.eo[el.dataset.costrow], cardRate(el.dataset.costrow)));
  });
  document.querySelectorAll('#task-detail-overlay [data-ftzrow]').forEach(el => {
    el.textContent = cardFmtMoney(taskMeasurementCost(t.ftz[el.dataset.ftzrow], cardRate(el.dataset.ftzrow)));
  });
  document.querySelectorAll('#task-detail-overlay [data-diffrow]').forEach(el => {
    const d = cardDiffPct(t.eo[el.dataset.diffrow], t.ftz[el.dataset.diffrow]);
    el.textContent = d.txt; el.className = 'diff ' + d.cls;
  });
}
function cardUpdateDirty() {
  const d = document.getElementById('dirty');
  const changes = cardState.editing && cardState.draft
    ? cardDiffChanges(cardState.current, cardState.draft)
    : [];
  const changesCount = changes.length;
  const reportingFooter = cardState.tab === 'rep' && !cardState.editing;
  const reportingChangesCount = cardReportingDirtyCount();
  if (d) {
    const footerDirty = reportingFooter ? reportingChangesCount > 0 : cardState.dirty && !cardState.editing;
    d.style.display = footerDirty ? 'inline-flex' : 'none';
    d.innerHTML = '<i></i>' + (reportingFooter ? 'Несохранённых статусов' : 'Не сохранено') + ' · ' + (reportingFooter ? reportingChangesCount : changesCount);
  }
  const summary = document.getElementById('card-change-summary');
  if (summary) {
    const visibleFields = changes.slice(0, 3).map(change => change.field);
    const remaining = Math.max(0, changesCount - visibleFields.length);
    const fieldWord = changesCount % 10 === 1 && changesCount % 100 !== 11 ? 'поле' : changesCount % 10 >= 2 && changesCount % 10 <= 4 && (changesCount % 100 < 12 || changesCount % 100 > 14) ? 'поля' : 'полей';
    summary.textContent = changesCount ? 'Не сохранено · ' + changesCount + ' ' + fieldWord : 'Изменений пока нет';
    summary.title = visibleFields.join(', ') + (remaining ? ' и ещё ' + remaining : '');
  }
  const saveButton = document.getElementById('saveBtn');
  if (saveButton) {
    setButtonBusy(saveButton, cardState.saving);
    saveButton.disabled = !cardState.dirty || cardState.saving;
    const label = 'Сохранить';
    // Keep the clicked node alive when blur/change fires between pointer events.
    if (!cardState.saving && saveButton.textContent.trim() !== label) saveButton.innerHTML = cardIcon('check') + '<span>' + label + '</span>';
  }
  const cancelButton = document.getElementById('cardCancelBtn');
  if (cancelButton) {
    cancelButton.disabled = cardState.saving;
    const label = 'Отменить';
    if (cancelButton.textContent.trim() !== label) cancelButton.innerHTML = '<span>' + label + '</span>';
  }
  document.querySelectorAll('#task-detail-overlay .field-modified').forEach(field => field.classList.remove('field-modified'));
  if (!cardState.editing || !cardState.draft) return;
  document.querySelectorAll('#task-detail-overlay [data-k]').forEach(control => {
    if (!cardStatePathChanged(control.dataset.k)) return;
    control.closest('.ival, .fval, .task-title-row, .desc-val')?.classList.add('field-modified');
  });
  [['otherTeams', 'otherTeams'], ['tags', 'tags']].forEach(([toggle, key]) => {
    if (!cardStatePathChanged(key)) return;
    document.querySelector(`#task-detail-overlay [data-toggle="${toggle}"]`)?.closest('.ival, .fval')?.classList.add('field-modified');
  });
  if (cardState.editing) {
    if (cardState.dirty) saveCardEditDraft();
    else clearCardEditDraft();
  }
}

async function taskSaveRequestWithTimeout(request, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('save-timeout'), timeoutMs);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error('Сервер не ответил за 15 секунд. Повторите сохранение.');
      timeoutError.name = 'TaskSaveTimeoutError';
      timeoutError.code = 'SAVE_TIMEOUT';
      timeoutError.status = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cardHighlightSavedFields(changes) {
  clearTimeout(_cardSavedHighlightTimer);
  document.querySelectorAll('#task-detail-overlay .field-saved').forEach(el => el.classList.remove('field-saved'));
  const aliases = {
    title: 'Название', description: 'Описание', receivedAt: 'Дата получения', channel: 'Канал поступления',
    customer: 'Бизнес-заказчик', project: 'Проект', type: 'Тип задачи', priority: 'Приоритет',
    status: 'Статус задачи', deadline: 'Срок выполнения', team: 'Ответственная команда', assignee: 'Исполнитель',
    progress: 'Прогресс', finEffect: 'Финансовый эффект', finJust: 'Обоснование расчёта',
    mockupUrl: 'Ссылка на макеты', statuses: 'Отчётные статусы', demoDid: 'Демо для ДИД',
    tags: 'Метки', otherTeams: 'Другие вовлечённые команды', jiraLinks: 'Jira', reqLinks: 'бизнес-требования',
  };
  const labelElements = Array.from(document.querySelectorAll('#task-detail-overlay .flt, #task-detail-overlay .ilab, #task-detail-overlay .flabel, #task-detail-overlay .jlab, #task-detail-overlay .bc-title, #task-detail-overlay .slab, #task-detail-overlay .ui-readonly-label'));
  changes.forEach(change => {
    let target = null;
    if (change.key === 'title') target = document.querySelector('#task-detail-overlay .task-title-row');
    else if (change.key === 'description') target = document.querySelector('#task-detail-overlay .desc-val');
    else {
      const expected = String(aliases[change.key] || change.field.replace(' (ЭО)', '')).toLocaleLowerCase('ru-RU');
      const label = labelElements.find(el => el.textContent.trim().toLocaleLowerCase('ru-RU').includes(expected));
      const container = label?.closest('.icell, .field, .task-title-card, .task-desc, .repcard, .bigcard, .cl, .ui-readonly-field');
      target = container?.querySelector(':scope > .ival, :scope > .fval, .task-title-row, .desc-val') || container;
    }
    target?.classList.add('field-saved');
  });
  _cardSavedHighlightTimer = setTimeout(() => {
    document.querySelectorAll('#task-detail-overlay .field-saved').forEach(el => el.classList.remove('field-saved'));
  }, 2400);
}

function cardStatePathValue(source, path) {
  return String(path || '').split('.').reduce((value, part) => value == null ? undefined : value[part], source);
}

function cardStatePathChanged(path) {
  return JSON.stringify(cardStatePathValue(cardState.current, path) ?? null)
    !== JSON.stringify(cardStatePathValue(cardState.draft, path) ?? null);
}

function cardFirstChangedPath() {
  if (!cardState.editing || !cardState.draft) return null;
  const paths = CARD_DIFF_TRACK.flatMap(([path]) => {
    if (path === 'statuses') return ['statuses.directorate.cur', 'statuses.did.cur', 'statuses.key.cur'];
    return [path];
  });
  paths.push(...CARD_ROLES.map(role => `eo.${role.key}`));
  return paths.find(cardStatePathChanged) || null;
}

async function cardRevealFirstChangedField(app) {
  const path = cardFirstChangedPath();
  if (!path) return;
  const tab = path.startsWith('statuses.') || path === 'demoDid' ? 'rep'
    : (path === 'jiraLinks' || path === 'reqLinks' ? 'sys' : 'main');
  if (cardState.tab !== tab) cardActivateTab(tab, app);
  await new Promise(resolve => requestAnimationFrame(resolve));
  let target = Array.from(document.querySelectorAll('#task-detail-overlay [data-k]'))
    .find(control => control.dataset.k === path);
  if (!target && (path === 'otherTeams' || path === 'tags')) {
    target = document.querySelector(`#task-detail-overlay [data-toggle="${path}"]`);
  }
  if (!target) return;
  const details = target.closest('details');
  if (details) details.open = true;
  target.closest('.ival, .fval, .task-title-row, .desc-val')?.classList.add('field-modified');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (typeof target.focus === 'function') target.focus({ preventScroll: true });
}

function cardSetPath(o, p, v) {
  const parts = p.split('.');
  let x = o;
  for (let i = 0; i < parts.length - 1; i++) x = x[parts[i]];
  x[parts[parts.length - 1]] = v;
}

function cardToast(msg, type) {
  const t = document.getElementById('card-toast');
  if (!t) { window.toast?.(msg, type === 'ok' ? 'success' : type === 'warn' ? 'info' : 'error'); return; }
  t.className = 'toast show';
  t.innerHTML = cardIcon(type === 'ok' ? 'check' : 'alert') + '<span>' + escapeHtml(msg) + '</span>';
  clearTimeout(_cardToastTimer);
  _cardToastTimer = setTimeout(() => { t.classList.remove('show'); }, 2800);
}

function cardToastAction(msg, label, action) {
  const t = document.getElementById('card-toast');
  if (!t) { cardToast(msg, 'ok'); return; }
  t.className = 'toast show card-toast-action';
  t.innerHTML = cardIcon('check') + '<span>' + escapeHtml(msg) + '</span><button type="button" class="btn btn-secondary btn-sm ui-btn toast-action-btn">' + escapeHtml(label) + '</button>';
  clearTimeout(_cardToastTimer);
  const button = t.querySelector('.toast-action-btn');
  button?.addEventListener('click', async () => {
    button.disabled = true;
    await action();
  }, { once: true });
  _cardToastTimer = setTimeout(() => { t.classList.remove('show'); }, 7000);
}

function createTaskChangedFieldNames() {
  if (!_createTaskInitialSnapshot) return [];
  try {
    const initial = new Map(JSON.parse(_createTaskInitialSnapshot));
    const current = new Map(JSON.parse(createTaskFormSnapshot()));
    const extraLabels = {
      'create-effort-days': 'Трудозатраты',
      'create-effort-rub': 'Стоимость',
      'create-financial-effect': 'Финансовый эффект',
    };
    const labelsById = Object.values(TASK_FORM_SCHEMA).reduce((labels, field) => {
      labels[field.createId] = field.label;
      return labels;
    }, extraLabels);
    return Array.from(current.entries())
      .filter(([id, value]) => initial.get(id) !== value)
      .map(([id]) => labelsById[id] || 'Дополнительное поле')
      .filter((label, index, labels) => labels.indexOf(label) === index);
  } catch (_) {
    return [];
  }
}

function taskUnsavedChangeNames() {
  if (_createTaskDirty) return createTaskChangedFieldNames();
  const fields = [];
  if (cardState.editing && cardState.current && cardState.draft) {
    fields.push(...cardDiffChanges(cardState.current, cardState.draft).map(change => change.field));
  }
  fields.push(...cardReportingDraftNames());
  if (_taskCommentDraftSession.hasChanges(currentTask?.id)) fields.push('Черновик комментария');
  return fields;
}

function appendUnsavedChangesSummary(message, fields = taskUnsavedChangeNames()) {
  if (!fields.length) return message;
  const shown = fields.slice(0, 3).join(', ');
  const remaining = fields.length - 3;
  return `${message} Изменено полей: ${fields.length}. ${shown}${remaining > 0 ? ` и ещё ${remaining}` : ''}.`;
}

export async function confirmTaskCardDiscard(message = 'Все несохранённые изменения карточки будут потеряны. Продолжить?', options = {}) {
  const changeNames = Array.isArray(options.changeNames) ? options.changeNames : taskUnsavedChangeNames();
  const hasChanges = options.hasChanges ?? hasUnsavedTaskChanges();
  if (!hasChanges) return true;
  if (_discardPromptPromise) return _discardPromptPromise;
  _discardPromptPromise = showConfirmModal(
    appendUnsavedChangesSummary(message, changeNames),
    'Несохранённые изменения',
    'Потерять изменения',
    'Остаться',
    true
  );
  try {
    return await _discardPromptPromise;
  } finally {
    _discardPromptPromise = null;
  }
}

export async function confirmAndCloseTaskFormsForNavigation() {
  const taskOverlay = document.getElementById('task-detail-overlay');
  const createOverlay = document.getElementById('create-task-overlay');
  if (!taskOverlay && !createOverlay) return true;
  if (cardState.saving || _createTaskSaving || _commentSubmitting) {
    window.toast?.(_commentSubmitting ? 'Дождитесь завершения отправки комментария' : (createOverlay ? 'Дождитесь завершения создания задачи' : 'Дождитесь завершения сохранения'), 'info');
    return false;
  }
  if (taskOverlay && cardState.dirty && (cardState.tab !== 'rep' || cardReportingDirtyCount() === 0)) await cardRevealFirstChangedField(window.app);
  const confirmed = await confirmTaskCardDiscard(
    createOverlay
      ? 'Все введённые данные новой задачи будут потеряны. Перейти на другую страницу?'
      : 'Все несохранённые изменения карточки будут потеряны. Перейти на другую страницу?'
  );
  if (!confirmed) return false;
  if (createOverlay) closeCreateTaskModal();
  if (taskOverlay) {
    clearCardReportingDrafts();
    clearCardEditDraft();
    closeTaskDetailModal();
  }
  return true;
}

async function cardRequestClose() {
  if (cardState.saving || _commentSubmitting) {
    cardToast(_commentSubmitting ? 'Дождитесь завершения отправки комментария' : 'Дождитесь завершения сохранения', 'warn');
    return false;
  }
  if (cardState.dirty && (cardState.tab !== 'rep' || cardReportingDirtyCount() === 0)) await cardRevealFirstChangedField(window.app);
  const confirmed = await confirmTaskCardDiscard();
  if (!confirmed) return false;
  clearCardReportingDrafts();
  clearCardEditDraft();
  closeTaskDetailModal();
  return true;
}

function cardPsCls(v) {
  if (v == null) return '';
  return v >= 70 ? 'cv-good' : (v >= 40 ? 'cv-warn' : 'cv-bad');
}

function cardFocusEditField(key) {
  if (!key) return;
  requestAnimationFrame(() => {
    const target = document.querySelector('#task-detail-overlay [data-k="' + key + '"], #task-detail-overlay [data-toggle="' + key + '"]');
    if (!target) return;
    const focusTarget = target.closest('.dict-search-control')?.querySelector('.dict-combobox-trigger') || target;
    focusTarget.focus({ preventScroll: true });
    if (typeof focusTarget.select === 'function' && (focusTarget.tagName === 'INPUT' || focusTarget.tagName === 'TEXTAREA')) focusTarget.select();
    if (focusTarget.classList.contains('dict-combobox-trigger')) requestAnimationFrame(() => focusTarget.click());
  });
}

async function cardStartEdit(app, focusKey = '') {
  if (!currentTask?.id) return;
  const taskId = Number(currentTask.id);
  const permission = cardEditPermission();
  if (!permission.allowed) {
    cardToast(permission.reason, 'warn');
    return;
  }
  if (_lockInfo && _lockInfo.locked && !_lockInfo.is_mine) {
    cardToast('Задача редактируется другим пользователем', 'warn');
    return;
  }
  const lock = await acquireLock(taskId);
  if (!lock || lock.error) {
    if (lock && lock.status === 423) cardToast('Задача уже редактируется другим пользователем', 'warn');
    else cardToast('Не удалось захватить задачу: ' + (lock?.detail || 'ошибка'), 'warn');
    return;
  }
  if (!cardMatchesCurrentTask(taskId)) {
    releaseLock(taskId);
    return;
  }
  const currentPermission = cardEditPermission();
  if (!currentPermission.allowed) {
    releaseLock(taskId);
    cardToast(currentPermission.reason, 'warn');
    return;
  }
  _lockInfo = { locked: true, is_mine: true, lock_owner_name: 'Вы' };
  renderLockBanner();
  cardState.draft = JSON.parse(JSON.stringify(cardState.current));
  cardState.editing = true;
  cardState.entryField = focusKey || '';
  cardState.dirty = restoreCardEditDraft();
  cardState.replyFor = null;
  cardAi = null;
  cardPs = null;
  modalMode = 'edit';
  const cardBodyScrollTop = document.getElementById('mbody')?.scrollTop || 0;
  cardRender();
  const renderedCardBody = document.getElementById('mbody');
  if (renderedCardBody) renderedCardBody.scrollTop = cardBodyScrollTop;
  if (cardState.dirty) cardToast('Черновик редактирования восстановлен', 'ok');
  cardFocusEditField(focusKey || 'title');
}

async function cardCancelEdit(app) {
  clearTimeout(_cardQuickSaveTimer);
  if (cardState.saving) {
    cardToast('Дождитесь завершения сохранения', 'warn');
    return;
  }
  if (cardState.dirty) {
    const decision = await showEditExitModal();
    if (decision === 'continue') return;
    if (decision === 'save') {
      await cardSaveEdit(app);
      return;
    }
  }
  if (currentTask?.id) releaseLock(currentTask.id);
  clearCardEditDraft();
  _lockInfo = null;
  cardState.editing = false;
  cardState.entryField = '';
  cardState.draft = null;
  cardState.dirty = false;
  cardState.replyFor = null;
  cardAi = null;
  cardPs = null;
  modalMode = 'view';
  cardRender();
  cardToast('Изменения отменены', 'warn');
}

function isTaskDateInFuture(value) {
  if (!value) return false;
  const selected = new Date(`${value}T00:00:00`);
  if (Number.isNaN(selected.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return selected > today;
}

function cardQuickEditContains(target) {
  if (!cardState.editing || !cardState.entryField || !target) return false;
  const controls = Array.from(document.querySelectorAll('#task-detail-overlay [data-k], #task-detail-overlay [data-toggle]'))
    .filter(control => control.dataset.k === cardState.entryField || control.dataset.toggle === cardState.entryField);
  return controls.some(control => {
    const editor = control.closest('.ival, .fval, .task-title-row, .desc-val, .dict-search-control') || control;
    return editor.contains(target);
  });
}

function normalizedTaskStatus(value) {
  return String(value || '').trim().toLocaleUpperCase('ru-RU');
}

function cardValidate(d) {
  if (!String(d.title || '').trim()) return { message: 'Укажите название задачи — поле обязательно.', key: 'title' };
  if (d.type !== cardState.current.type && (!String(d.type || '').trim() || d.type === '—')) return { message: 'Укажите тип задачи — поле обязательно.', key: 'type' };
  if (!String(d.team || '').trim() || d.team === '—') return { message: 'Укажите ответственную команду — поле обязательно.', key: 'team' };
  if (d.effortDays != null && (!Number.isInteger(Number(d.effortDays)) || Number(d.effortDays) < 0 || Number(d.effortDays) > 10000)) return { message: 'Общая оценка трудозатрат должна быть целым числом от 0 до 10 000.', key: 'effortDays' };
  if (d.weightPercent != null && (!Number.isFinite(Number(d.weightPercent)) || Number(d.weightPercent) < 0 || Number(d.weightPercent) > 100)) return { message: 'Вес оценки должен быть от 0 до 100%.', key: 'weightPercent' };
  if (d.forecastPercent != null && (!Number.isFinite(Number(d.forecastPercent)) || Number(d.forecastPercent) < 0 || Number(d.forecastPercent) > 100)) return { message: 'Прогноз выполнения должен быть от 0 до 100%.', key: 'forecastPercent' };
  if (isTaskDateInFuture(d.receivedAt)) return { message: 'Дата поступления не может быть в будущем.', key: 'receivedAt' };
  const status = normalizedTaskStatus(d.status);
  if (d.progress == null || d.progress === '' || !Number.isInteger(Number(d.progress)) || Number(d.progress) < 0 || Number(d.progress) > 100) return { message: 'Укажите прогресс целым числом от 0 до 100%.', key: 'progress' };
  const progress = Number(d.progress);
  if (status === 'ВЫПОЛНЕНА' && progress !== 100) return { message: 'Для выполненной задачи прогресс должен быть равен 100%.', key: 'progress', syncKey: 'status' };
  if (progress === 100 && status !== 'ВЫПОЛНЕНА') return { message: 'Прогресс 100% допустим только для статуса «Выполнена».', key: 'status', syncKey: 'progress' };
  if (d.mockupUrl && !cardUrlOk(d.mockupUrl)) return { message: 'Некорректная ссылка на макеты (ожидается http(s)://…).', key: 'mockupUrl' };
  if (d.channel !== cardState.current.channel && !(cardMaps?.channelId?.(d.channel) != null)) return { message: 'Не удалось определить выбранный канал. Обновите карточку и повторите.', key: 'channel' };
  if (d.type !== cardState.current.type && !(cardMaps?.typeId?.(d.type) != null)) return { message: 'Не удалось определить выбранный тип задачи. Обновите карточку и повторите.', key: 'type' };
  return null;
}

function cardApiErrorInfos(error) {
  const details = Array.isArray(error?.data?.detail) ? error.data.detail : [];
  const keyByApiField = {
    title: 'title', team_id: 'team', task_type_id: 'type', channel_id: 'channel',
    date_received: 'receivedAt', project_id: 'project', priority_id: 'priority',
    deadline_id: 'deadline', business_customer_id: 'customer', owner_id: 'assignee',
    link_mockups: 'mockupUrl', description: 'description', comment: 'comment', effort_days: 'effortDays',
    assessment_weight: 'weightPercent', completion_forecast: 'forecastPercent',
  };
  return details.map(item => {
    const apiField = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : null;
    const key = keyByApiField[apiField];
    return key ? { key, message: item.msg || 'Проверьте значение' } : null;
  }).filter(Boolean);
}

function cardClearFieldError(key) {
  document.querySelectorAll('#task-detail-overlay [data-k]').forEach(control => {
    if (control.dataset.k !== key) return;
    control.classList.remove('input-error');
    control.removeAttribute('aria-invalid');
  });
  document.querySelectorAll('#task-detail-overlay .card-field-error').forEach(field => {
    if (field.dataset.errorKey !== key) return;
    field.classList.remove('card-field-error');
    delete field.dataset.errorKey;
    field.querySelector('.card-field-error-message')?.remove();
  });
}

function cardShowFieldError(key, message) {
  const controls = Array.from(document.querySelectorAll('#task-detail-overlay [data-k]')).filter(control => control.dataset.k === key);
  const target = controls[0] || null;
  controls.forEach(control => {
    control.classList.add('input-error');
    control.setAttribute('aria-invalid', 'true');
  });
  const field = target?.closest('.icell, .field, .task-title-card, .task-desc');
  if (field) {
    field.classList.add('card-field-error');
    field.dataset.errorKey = key;
    field.querySelector('.card-field-error-message')?.remove();
    const errorText = document.createElement('div');
    errorText.className = 'card-field-error-message';
    errorText.textContent = message;
    field.appendChild(errorText);
  }
  return target;
}

const CARD_DIFF_TRACK = [
  ['didClientId', 'Клиент ДИД'], ['customerDeptId', 'Подразделение заказчика'],
  ['title', 'Название задачи'], ['description', 'Описание задачи'], ['comment', 'Внутренний комментарий задачи'], ['receivedAt', 'Дата получения'],
  ['channel', 'Канал поступления'], ['customer', 'Бизнес-заказчик'], ['project', 'Проект'],
  ['type', 'Тип задачи'], ['priority', 'Приоритет'], ['status', 'Статус задачи'],
  ['deadline', 'Срок выполнения'], ['team', 'Ответственная команда'], ['assignee', 'Исполнитель'],
  ['progress', 'Прогресс'], ['effortDays', 'Общая оценка трудозатрат'], ['weightPercent', 'Вес оценки'],
  ['forecastPercent', 'Прогноз выполнения'], ['finEffect', 'Финансовый эффект'], ['finJust', 'Обоснование фин. эффекта'],
  ['mockupUrl', 'Ссылка на макеты'], ['statuses', 'Отчётные статусы'], ['demoDid', 'Демо для ДИД'],
  ['tags', 'Метки (теги)'], ['otherTeams', 'Другие вовлечённые команды'],
  ['jiraLinks', 'Ссылки на Jira'], ['reqLinks', 'Ссылки на бизнес-требования'],
];

function cardFieldLabel(key) {
  return CARD_DIFF_TRACK.find(([field]) => field === key)?.[1] || key;
}
function cardDiffChanges(a, b) {
  const ch = [];
  CARD_DIFF_TRACK.forEach(p => {
    if (JSON.stringify(a[p[0]]) !== JSON.stringify(b[p[0]])) ch.push({ key: p[0], field: p[1], old: cardPretty(a[p[0]]), nw: cardPretty(b[p[0]]) });
  });
  CARD_ROLES.forEach(r => { if (+a.eo[r.key] !== +b.eo[r.key]) ch.push({ key: `eo.${r.key}`, field: r.name + ' (ЭО)', old: cardPretty(a.eo[r.key]), nw: cardPretty(b.eo[r.key]) }); });
  return ch;
}

function cardPayload(source = cardState.draft) {
  const d = source;
  const m = cardMaps || {};
  const p = {
    title: String(d.title || '').trim(),
    description: d.description || null,
    comment: d.comment || null,
    date_received: d.receivedAt || null,
    status_id: m.statusId ? m.statusId(d.status) : null,
    priority_id: m.priorityId ? m.priorityId(d.priority) : null,
    deadline_id: m.deadlineId ? m.deadlineId(d.deadline) : null,
    team_id: m.teamId ? m.teamId(d.team) : null,
    project_id: m.projectId ? m.projectId(d.project) : null,
    task_type_id: (m.typeId && m.typeId(d.type) != null) ? m.typeId(d.type) : (d.type === cardState.current.type ? cardState.current.taskTypeId : null),
    channel_id: (m.channelId && m.channelId(d.channel) != null) ? m.channelId(d.channel) : (d.channel === cardState.current.channel ? cardState.current.channelId : null),
    did_client_group_id: d.didClientId ? Number(d.didClientId) : null,
    department_id: d.customerDeptId ? Number(d.customerDeptId) : null,
    business_customer_id: m.customerId ? m.customerId(d.customer) : null,
    owner_id: m.userId ? m.userId(d.assignee) : null,
    involved_teams: d.otherTeams.map(n => (m.teamId ? m.teamId(n) : null)).filter(id => id != null),
    tags: d.tags,
    progress: Number(d.progress),
    effort_days: d.effortDays != null && d.effortDays !== '' ? Math.round(+d.effortDays) : null,
    financial_effect: d.finEffect != null && d.finEffect !== '' ? +d.finEffect : null,
    financial_effect_justification: d.finJust || null,
    assessment_weight: d.weightPercent != null && d.weightPercent !== '' ? +d.weightPercent : null,
    completion_forecast: d.forecastPercent != null && d.forecastPercent !== '' ? +d.forecastPercent : null,
    hard_score: d.hardScore || null,
    soft_score: d.softScore || null,
    link_mockups: d.mockupUrl || null,
    link_jira: d.jiraLinks,
    link_requirements: d.reqLinks,
    version: currentTask?.version || 0,
  };
  CARD_ROLES.forEach(r => { p[r.field] = cardNum(d.eo[r.key]); });
  return p;
}

function cardPatchPayload() {
  const currentPayload = cardPayload(cardState.current);
  const draftPayload = cardPayload(cardState.draft);
  const patch = { version: currentTask?.version || 0 };
  Object.keys(draftPayload).forEach(field => {
    if (field === 'version') return;
    if (JSON.stringify(currentPayload[field] ?? null) !== JSON.stringify(draftPayload[field] ?? null)) {
      patch[field] = draftPayload[field];
    }
  });
  return patch;
}

async function cardReloadTask(app, expectedTaskId = currentTask?.id) {
  const api = app?.api || window.app?.api;
  const taskId = Number(expectedTaskId);
  if (!api || !cardMatchesCurrentTask(taskId)) return null;
  const request = _taskCardRequestGate.start('task-reload', taskId);
  try {
    const data = await api.get(`/tasks/${taskId}`, { signal: request.signal });
    if (!_taskCardRequestGate.isCurrent(request.token, taskId)
      || !cardMatchesCurrentTask(taskId)
      || Number(data?.id) !== taskId) return null;
    currentTask = data;
    setTaskModalDocumentTitle(data);
    cardState.current = buildCardState(data);
    await cardLoadHistory(app, taskId);
    return cardMatchesCurrentTask(taskId) ? data : null;
  } catch (error) {
    if (request.signal.aborted || error?.name === 'AbortError' || !_taskCardRequestGate.isCurrent(request.token, taskId)) return null;
    throw error;
  } finally {
    _taskCardRequestGate.finish(request.token);
  }
}

async function cardLoadHistory(app, expectedTaskId = currentTask?.id) {
  const api = app?.api || window.app?.api;
  const taskId = Number(expectedTaskId);
  if (!api || !cardMatchesCurrentTask(taskId)) return;
  await cardReadRequest('task-history', taskId, signal => api.get(`/tasks/${taskId}/history`, { signal }),
    data => { cardState.history = Array.isArray(data) ? data : []; },
    () => { cardRenderTabs(); if (cardState.tab === 'log') cardRenderBody(); });
}

async function cardUndoSavedChanges(app, previousSnapshot, expectedTaskId = currentTask?.id, savedVersion = null) {
  const api = app?.api || window.app?.api;
  const taskId = Number(expectedTaskId);
  if (!api || !previousSnapshot || !cardMatchesCurrentTask(taskId)) return;
  if (!Number.isInteger(savedVersion) || currentTask.version !== savedVersion) {
    cardToast('Задача уже изменилась. Отмена этого сохранения недоступна', 'warn');
    return;
  }
  const permission = cardEditPermission();
  if (!permission.allowed) {
    cardToast(permission.reason, 'warn');
    return;
  }
  if (cardState.editing || cardState.saving) {
    cardToast('Сначала завершите текущее редактирование', 'warn');
    return;
  }
  const lock = await acquireLock(taskId);
  if (!lock || lock.error) {
    cardToast(lock?.status === 423 ? 'Отмена недоступна: задача уже редактируется' : 'Не удалось начать отмену', 'warn');
    return;
  }
  if (!cardMatchesCurrentTask(taskId)) {
    releaseLock(taskId);
    return;
  }
  const currentPermission = cardEditPermission();
  if (!currentPermission.allowed) {
    releaseLock(taskId);
    cardToast(currentPermission.reason, 'warn');
    return;
  }
  _lockInfo = { locked: true, is_mine: true, lock_owner_name: 'Вы' };
  try {
    const currentPayload = cardPayload(cardState.current);
    const previousPayload = cardPayload(previousSnapshot);
    const patch = { version: savedVersion, client_request_id: newTaskRequestId() };
    Object.keys(previousPayload).forEach(field => {
      if (field === 'version') return;
      if (JSON.stringify(currentPayload[field] ?? null) !== JSON.stringify(previousPayload[field] ?? null)) patch[field] = previousPayload[field];
    });
    if (Object.keys(patch).length === 2) {
      cardToast('Отменять нечего', 'info');
      return;
    }
    await api.patch(`/tasks/${taskId}`, patch);
    const reloaded = await cardReloadTask(app, taskId);
    if (!reloaded) return;
    cardRender();
    cardHighlightSavedFields(cardDiffChanges(cardState.current, previousSnapshot));
    cardToast('Последнее сохранение отменено', 'ok');
  } catch (error) {
    if (!cardMatchesCurrentTask(taskId)) return;
    if (error?.status === 409) cardToast('Задача уже изменилась. Отмена не выполнена', 'warn');
    else cardToast('Не удалось отменить сохранение', 'err');
  } finally {
    releaseLock(taskId);
    if (cardMatchesCurrentTask(taskId)) _lockInfo = null;
  }
}

async function cardSaveEdit(app) {
  if (cardState.saving) return;
  const permission = cardEditPermission();
  if (!permission.allowed) {
    cardToast(permission.reason, 'warn');
    return;
  }
  if (isTaskNetworkOffline()) {
    cardToast('Нет подключения. Сохранение станет доступно после восстановления сети.', 'warn');
    updateTaskNetworkState();
    return;
  }
  if(!cardEditPermission().allowed){cardToast(cardEditPermission().reason||'Редактирование недоступно','warn');return;}
  const api = app?.api || window.app?.api;
  if (!api || !currentTask?.id) return;
  const taskId = Number(currentTask.id);
  const err = cardValidate(cardState.draft);
  if (err?.syncKey) {
    const key = err.syncKey;
    await cardSuggestStatusProgressSync(key, cardState.draft[key]);
    return;
  }
  if (err) {
    const target = cardShowFieldError(err.key, err.message);
    showTaskFormErrorSummary('card-form-error-summary', err.message, target);
    cardToast(err.message, 'err');
    focusTaskFormErrorTarget(target);
    return;
  }
  clearTaskFormErrorSummary('card-form-error-summary');
  const changes = cardDiffChanges(cardState.current, cardState.draft);
  const previousSnapshot = JSON.parse(JSON.stringify(cardState.current));
  if (!changes.length) {
    releaseLock(taskId);
    clearCardEditDraft();
    _lockInfo = null;
    cardState.editing = false;
    cardState.entryField = '';
    cardState.draft = null;
    cardState.dirty = false;
    cardState.replyFor = null;
    cardAi = null;
    cardPs = null;
    modalMode = 'view';
    cardRender();
    cardToast('Изменений нет', 'info');
    return;
  }
  cardState.saving = true;
  cardUpdateDirty();
  const btn = document.getElementById('saveBtn');

  try {
    const patchPayload = { ...cardPatchPayload(), client_request_id: _cardSaveRequestId || (_cardSaveRequestId = newTaskRequestId()) };
    const savedResponse = await runTaskSaveWithSingleRetry(
      () => taskSaveRequestWithTimeout(signal => api.patch(`/tasks/${taskId}`, patchPayload, { signal })),
      () => setButtonBusy(btn, true, 'Повторяем…')
    );
    releaseLock(taskId);
    _lockInfo = null;
    const reloaded = await cardReloadTask(app, taskId);
    if (!reloaded) return;
    _cardSaveRequestId = null;
    clearCardEditDraft();
    cardState.editing = false;
    cardState.entryField = '';
    cardState.draft = null;
    cardState.dirty = false;
    cardState.replyFor = null;
    cardAi = null;
    cardPs = null;
    modalMode = 'view';
    cardRender();
    cardHighlightSavedFields(changes);
    notifyTaskSaved();
    cardToast('Сохранено · изменений: ' + changes.length, 'ok');
    const savedTaskId = Number(currentTask?.id);
    cardToastAction('Сохранено · изменений: ' + changes.length, 'Отменить', () => cardUndoSavedChanges(app, previousSnapshot, savedTaskId, savedResponse?.version));
  } catch (e) {
    if (!cardMatchesCurrentTask(taskId)) return;
    if(e?.status===403)document.dispatchEvent(new CustomEvent('dmb:task-access-denied',{detail:{taskId}}));
    if (e && e.status === 409) {
      cardShowConflict(e.data?.detail ?? e.data, app);
    } else if (e && e.status === 423) {
      const message = 'Задача уже редактируется другим пользователем. Ваши изменения сохранены в форме.';
      showTaskFormErrorSummary('card-form-error-summary', message, document.querySelector('[data-k="title"]'));
      cardToast(message, 'warn');
    } else {
      const infos = cardApiErrorInfos(e);
      const targets = infos.map(info => cardShowFieldError(info.key, info.message)).filter(Boolean);
      const message = infos.length
        ? `Исправьте отмеченные поля (${infos.length}) и повторите сохранение.`
        : 'Ошибка: ' + (e?.message || 'не удалось сохранить');
      showTaskFormErrorSummary('card-form-error-summary', message, targets[0] || null);
      if (isRetryableTaskSaveError(e)) addTaskSaveRetryAction('card-form-error-summary', () => cardSaveEdit(app));
      focusTaskFormErrorTarget(targets[0]);
      cardToast(message, 'err');
    }
  } finally {
    if (cardMatchesCurrentTask(taskId)) {
      cardState.saving = false;
      cardUpdateDirty();

    }
  }
}

function cardShowConflict(detail, app) {
  if (!detail || typeof detail !== 'object' || !detail.task || detail.current_version == null) {
    const message = 'Задача изменилась на сервере. Сохранение не выполнено; ваши изменения остались в форме. Закройте редактирование и обновите карточку перед повторным сохранением.';
    showTaskFormErrorSummary('card-form-error-summary', message);
    cardToast(message, 'warn');
    return;
  }
  const serverTask = detail.task || {};
  const currentVer = detail.current_version ?? '?';
  const submittedVer = detail.submitted_version ?? '?';
  let overlay = document.getElementById('card-conflict-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'card-conflict-overlay';
  overlay.className = 'conflict-overlay';
  const rows = cardConflictRows(serverTask);
  const hasChanges = rows.length > 0;
  overlay.innerHTML = `
    <div class="conflict-modal conflict-modal--wide" role="alertdialog" aria-modal="true" aria-labelledby="card-conflict-title">
      <div class="conflict-modal-header app-modal__header">
        <div class="conflict-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div>
          <h3 class="conflict-title" id="card-conflict-title">Конфликт версий</h3>
          <p class="conflict-subtitle">Задача была изменена другим пользователем. Выберите значения для каждого изменённого поля.</p>
        </div>
      </div>
      <div class="app-modal__body">
      <div class="conflict-versions">
        <span>Ваша версия: <strong>${submittedVer}</strong></span>
        <span class="conflict-arrow">&rarr;</span>
        <span>Текущая версия: <strong>${currentVer}</strong></span>
      </div>
      ${hasChanges
        ? `<div class="conflict-diff-wrap"><table class="ui-table ui-table-editor diff-table diff-table--selectable ui-task-conflict-table">
            <thead><tr><th scope="col">Серверная версия</th><th scope="col">Моя версия</th><th>Поле</th><th>На сервере</th><th>Ваше значение</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : '<div class="diff-empty">Все поля совпадают — различий не обнаружено</div>'}
      </div>
      <div class="ui-task-conflict-actions app-modal__footer">
        ${uiButton({label:'Сохранить выбранные',variant:'primary',attrs:{id:'cc-btn-save',disabled:!hasChanges}})}
        ${uiButton({label:'Принудительно сохранить',attrs:{id:'cc-btn-force'}})}
        ${uiButton({label:'Обновить с сервера',attrs:{id:'cc-btn-refresh'}})}
        ${uiButton({label:'Отмена',attrs:{id:'cc-btn-cancel','data-modal-close':true}})}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('cc-btn-save')?.addEventListener('click', () => cardConflictMerge(serverTask, app, currentVer));
  document.getElementById('cc-btn-force')?.addEventListener('click', () => cardConflictForce(app, currentVer));
  document.getElementById('cc-btn-refresh')?.addEventListener('click', () => cardConflictRefresh(serverTask, app));
  document.getElementById('cc-btn-cancel')?.addEventListener('click', cardConflictClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cardConflictClose(); });
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cardConflictClose();
  });
  document.getElementById('cc-btn-save')?.focus();
}

function cardConflictRows(serverTask) {
  const payload = cardPatchPayload();
  const labels = {
    title: 'Название', status_id: 'Статус', priority_id: 'Приоритет', deadline_id: 'Срок',
    team_id: 'Команда', owner_id: 'Исполнитель', project_id: 'Проект', task_type_id: 'Тип',
    channel_id: 'Канал', business_customer_id: 'Бизнес-заказчик', involved_teams: 'Другие команды',
    tags: 'Метки', progress: 'Прогресс', description: 'Описание', comment: 'Внутренний комментарий задачи', date_received: 'Дата получения',
    effort_days: 'Общая оценка трудозатрат', assessment_weight: 'Вес оценки', completion_forecast: 'Прогноз выполнения',
    financial_effect: 'Финансовый эффект (₽)', financial_effect_justification: 'Обоснование фин. эффекта',
    directorate_status: 'Статус (директорская)', did_status: 'Статус (ДИД)', key_project_status: 'Статус (ключ. проекты)',
    did_demo: 'Демо для ДИД', link_mockups: 'Макеты', link_jira: 'Jira', link_requirements: 'Требования',
    effort_designee: 'Designee (ЭО)', effort_analytics: 'Аналитика (ЭО)', effort_be: 'Разработка BE (ЭО)',
    effort_python_be: 'python BE (ЭО)', effort_fe: 'FE (ЭО)', effort_test: 'Test (ЭО)',
    effort_test_auto: 'Test Auto (ЭО)', effort_delivery: 'Delivery (ЭО)',
  };
  const fmt = v => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ') || '—';
    if (typeof v === 'boolean') return v ? 'да' : 'нет';
    return String(v);
  };
  return Object.keys(payload).filter(k => k !== 'version').map(field => {
    const sv = serverTask[field];
    const lv = payload[field];
    if (JSON.stringify(sv ?? null) === JSON.stringify(lv ?? null)) return null;
    const rName = 'ccr-' + field;
    return `<tr class="diff-row" data-field="${escapeHtml(field)}">
      <td class="diff-radio-cell"><input type="radio" name="${rName}" value="server" aria-label="Оставить серверное значение: ${escapeHtml(labels[field] || field)}" class="diff-radio" data-field="${escapeHtml(field)}" checked></td>
      <td class="diff-radio-cell"><input type="radio" name="${rName}" value="local" aria-label="Использовать моё значение: ${escapeHtml(labels[field] || field)}" class="diff-radio" data-field="${escapeHtml(field)}"></td>
      <td class="diff-field">${escapeHtml(labels[field] || field)}</td>
      <td class="diff-server">${escapeHtml(fmt(sv))}</td>
      <td class="diff-local">${escapeHtml(fmt(lv))}</td>
    </tr>`;
  }).filter(Boolean).join('');
}

async function cardDoSave(payload, app) {
  const api = app?.api || window.app?.api;
  if (!api || !currentTask?.id) return;
  const taskId = Number(currentTask.id);
  const permission = cardEditPermission();
  if (!permission.allowed) {
    cardToast(permission.reason, 'warn');
    return;
  }
  cardState.saving = true;
  cardUpdateDirty();
  try {
    await api.patch(`/tasks/${taskId}`, payload);
    if (!cardMatchesCurrentTask(taskId)) return;
    releaseLock(taskId);
    _lockInfo = null;
    const reloaded = await cardReloadTask(app, taskId);
    if (!reloaded) return;
    clearCardEditDraft();
    cardState.editing = false; cardState.entryField = ''; cardState.draft = null; cardState.dirty = false; cardState.replyFor = null; cardAi = null;
    modalMode = 'view';
    cardRender();
    cardToast('Сохранено', 'ok');
  } catch (e2) {
    if (!cardMatchesCurrentTask(taskId)) return;
    if (e2 && e2.status === 409) {
      cardShowConflict(e2.data?.detail ?? e2.data, app);
    } else {
      cardToast('Ошибка: ' + (e2.message || 'не удалось сохранить'), 'err');
    }
  } finally {
    if (cardMatchesCurrentTask(taskId)) {
      cardState.saving = false;
      cardUpdateDirty();
    }
  }
}
async function cardConflictMerge(serverTask, app, currentVer) {
  const payload = cardPatchPayload();
  document.querySelectorAll('#card-conflict-overlay .diff-radio:checked').forEach(r => {
    const field = r.dataset.field;
    if (r.value === 'server') delete payload[field];
  });
  payload.version = currentVer;
  cardConflictClose();
  await cardDoSave(payload, app);
}
async function cardConflictForce(app, currentVer) {
  const payload = cardPatchPayload();
  payload.version = currentVer;
  cardConflictClose();
  await cardDoSave(payload, app);
}
function cardConflictRefresh(serverTask, app) {
  cardConflictClose();
  const taskId = Number(serverTask?.id || currentTask?.id);
  currentTask = serverTask;
  cardState.current = buildCardState(serverTask);
  cardState.editing = false; cardState.entryField = ''; cardState.draft = null; cardState.dirty = false; cardState.replyFor = null; cardAi = null;
  modalMode = 'view';
  if (taskId) releaseLock(taskId);
  clearCardEditDraft();
  _lockInfo = null;
  cardReloadTask(app, taskId).then(reloaded => { if (reloaded) cardRender(); });
  cardToast('Данные обновлены с сервера', 'info');
}
function cardConflictClose() {
  const o = document.getElementById('card-conflict-overlay');
  if (o) o.remove();
}

function cardRenderPrioritiserValueProposal() {
  const pop = document.getElementById('finPop');
  if (!pop || !cardAi || cardAi.target !== 'fin') return;
  const busy = cardState.prioritiserRunning === 'value-approve';
  pop.innerHTML = '<div class="ah">' + cardIcon('spark') + 'Предложение агента</div>' +
    '<div class="av">Финансовый эффект: ' + cardFmtNum(cardAi.fin, 2) + ' млн ₽</div>' +
    '<div class="at">' + cardNl2br(cardAi.text) + '</div>' +
    '<div class="ai-suggestion-actions">' +
      uiButton({ label: 'Отклонить', size: 'small', attrs: { 'data-action': 'ai-value-reject', disabled: busy } }) +
      uiButton({ label: busy ? 'Сохранение…' : 'Принять результат', variant: 'primary', size: 'small', iconMarkup: cardIcon('check'), attrs: { 'data-action': 'ai-value-accept', disabled: busy, 'aria-busy': busy } }) +
    '</div>';
  pop.classList.add('show');
}

async function cardAcceptPrioritiserValue(app) {
  if (!cardAi || cardAi.target !== 'fin' || cardState.prioritiserRunning || !currentTask?.id) return;
  const permission = cardEditPermission();
  if (!permission.allowed) {
    cardToast(permission.reason, 'warn');
    return;
  }
  const api = app?.api || window.app?.api;
  if (!api) return;
  const taskId = Number(currentTask.id);
  const request = _taskCardRequestGate.start('prioritiser-value-approve', taskId);
  cardState.prioritiserRunning = 'value-approve';
  cardRenderBody();
  try {
    const updatedTask = await api.post(`/tasks/${taskId}/prioritiser/value/approve`, {
      version: currentTask?.version || cardAi.version || 0,
      value_mln: cardAi.fin,
      justification: cardAi.text,
    }, { signal: request.signal });
    if (!_taskCardRequestGate.isCurrent(request.token, taskId) || Number(currentTask?.id) !== taskId) return;
    if (Number(updatedTask?.id) !== taskId) throw new Error('Сервер вернул данные другой задачи');
    cardAi = null;
    currentTask = updatedTask;
    cardState.current = buildCardState(updatedTask);
    if (cardState.tab === 'main') cardRender();
    else { cardRenderHeader(); cardRenderTabs(); cardRenderFooter(); }
    cardToast('Финансовый эффект принят и сохранён', 'ok');
  } catch (error) {
    if (request.signal.aborted || error?.name === 'AbortError' || !_taskCardRequestGate.isCurrent(request.token, taskId)) return;
    if (error?.status === 409) cardToast('Задача изменилась после расчёта. Рассчитайте эффект повторно.', 'warn');
    else if (error?.status === 423) cardToast('Задача редактируется другим пользователем', 'warn');
    else cardToast('Ошибка сохранения: ' + (error?.message || 'не удалось принять результат'), 'err');
  } finally {
    if (_taskCardRequestGate.finish(request.token) && Number(currentTask?.id) === taskId) {
      cardState.prioritiserRunning = '';
      if (cardState.tab === 'main') cardRenderBody();
      else cardRenderFooter();
    }
  }
}

async function cardRunPrioritiser(kind, app) {
  if (cardState.prioritiserRunning || !currentTask?.id) return;
  const permission = cardEditPermission();
  if (!permission.allowed) {
    cardToast(permission.reason, 'warn');
    return;
  }
  if (cardState.editing) {
    cardToast('Перед расчётом сохраните или отмените изменения карточки', 'warn');
    return;
  }
  const requirements = cardPrioritiserRequirements(kind);
  if (requirements.some(item => !item.filled)) {
    showPrioritiserRequirementsModal(kind, requirements);
    return;
  }
  const api = app?.api || window.app?.api;
  if (!api) return;
  const taskId = Number(currentTask.id);
  const request = _taskCardRequestGate.start('prioritiser-calculation', taskId);
  cardState.prioritiserRunning = kind;
  cardRenderBody();
  try {
    const result = await api.post(`/tasks/${taskId}/prioritiser/${kind}`, {
      version: currentTask?.version || 0,
    }, { signal: request.signal });
    if (!_taskCardRequestGate.isCurrent(request.token, taskId) || Number(currentTask?.id) !== taskId) return;
    if (kind === 'value') {
      const valueMln = Number(result?.value_mln);
      if (!Number.isFinite(valueMln) || valueMln < 0) {
        throw new Error('Агент вернул некорректный финансовый эффект');
      }
      cardAi = {
        target: 'fin',
        fin: valueMln,
        text: String(result.justification || ''),
        version: Number(result.version ?? currentTask?.version ?? 0),
      };
      if (cardState.tab === 'main') cardRenderBody();
      cardToast('Финансовый эффект рассчитан. Проверьте и примите результат.', 'info');
    } else {
      if (Number(result?.id) !== taskId) throw new Error('Сервер вернул данные другой задачи');
      currentTask = result;
      cardState.current = buildCardState(result);
      if (cardState.tab === 'main') cardRender();
      else { cardRenderHeader(); cardRenderTabs(); cardRenderFooter(); }
      cardToast('Приоритет рассчитан и сохранён', 'ok');
    }
  } catch (error) {
    if (request.signal.aborted || error?.name === 'AbortError' || !_taskCardRequestGate.isCurrent(request.token, taskId)) return;
    if (error?.status === 409) cardToast('Задача изменена другим пользователем. Обновите страницу и повторите.', 'warn');
    else if (error?.status === 423) cardToast('Задача редактируется другим пользователем', 'warn');
    else {
      const missing = error?.data?.missing_attributes;
      if (Array.isArray(missing) && missing.length) {
        showPrioritiserRequirementsModal(kind, cardPrioritiserRequirements(kind, missing));
      } else {
        cardToast('Ошибка: ' + (error?.message || 'агент не выполнил расчёт'), 'err');
      }
    }
  } finally {
    if (_taskCardRequestGate.finish(request.token) && Number(currentTask?.id) === taskId) {
      cardState.prioritiserRunning = '';
      if (cardState.tab === 'main') cardRenderBody();
      else cardRenderFooter();
    }
  }
}

async function cardSuggestStatusProgressSync(changedKey, changedValue) {
  if (_statusProgressSuggestionPending || !cardState.editing || !cardState.draft) return;
  const draft = cardState.draft;
  const status = normalizedTaskStatus(draft.status);
  const progress = Number(draft.progress);
  let targetKey = null;
  let targetValue = null;
  let message = '';
  if (changedKey === 'status' && status === 'ВЫПОЛНЕНА' && progress !== 100) {
    targetKey = 'progress';
    targetValue = 100;
    message = 'Для статуса «Выполнена» требуется прогресс 100%. Установить его в черновике? Затем нажмите «Сохранить», чтобы сохранить задачу.';
  } else if (changedKey === 'progress' && progress === 100 && status !== 'ВЫПОЛНЕНА') {
    targetKey = 'status';
    targetValue = 'ВЫПОЛНЕНА';
    message = 'Прогресс достиг 100%. Изменить статус в черновике на «Выполнена»? Затем нажмите «Сохранить», чтобы сохранить задачу.';
  }
  if (!targetKey) return;

  _statusProgressSuggestionPending = true;
  try {
    const confirmed = await showConfirmModal(message, 'Согласовать статус и прогресс', 'Изменить', 'Оставить как есть');
    if (!confirmed || !cardState.editing || !cardState.draft) return;
    if (changedKey === 'status' && normalizedTaskStatus(cardState.draft.status) !== normalizedTaskStatus(changedValue)) return;
    if (changedKey === 'progress' && Number(cardState.draft.progress) !== Number(changedValue)) return;
    cardSetPath(cardState.draft, targetKey, targetValue);
    document.querySelectorAll(`#task-detail-overlay [data-k="${targetKey}"]`).forEach(control => { control.value = String(targetValue); });
    cardClearFieldError(targetKey);
    cardState.dirty = cardDiffChanges(cardState.current, cardState.draft).length > 0;
    cardUpdateDirty();
    cardRefreshDynamic();
    cardToast(targetKey === 'progress' ? 'Прогресс установлен на 100%' : 'Статус изменён на «Выполнена»', 'ok');
  } finally {
    _statusProgressSuggestionPending = false;
  }
}

function cardOnField(ev, app = window.app) {
  if (cardState.tab === 'rep' && (ev.target.matches('[data-reporting-text]') || ev.target.matches('[data-reporting-demo]'))) {
    cardCaptureReportingDraft(ev.target);
    cardUpdateDirty();
    return;
  }
  if (!cardState.editing) return;
  const el = ev.target;
  const k = el.dataset && el.dataset.k;
  if (!k) return;
  if (!cardState.saving) _cardSaveRequestId = null;
  cardClearFieldError(k);
  if (!document.querySelector('#task-detail-overlay .card-field-error')) clearTaskFormErrorSummary('card-form-error-summary');
  if (ev.type === 'change' && el.type === 'url') el.value = trimTaskLinkEdges(el.value);
  let v = el.value;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number' || el.type === 'range') {
    v = (v === '') ? null : (k === 'progress' ? Number(v) : Math.max(0, +v));
  }
  cardSetPath(cardState.draft, k, v);
  if (k === 'customer') {
    cardState.draft.customerDept = cardCustomerDepartment(v, '');
    cardState.draft.customerDeptId = String((cardDict.customers || []).find(i => i.name === v)?.department_id ?? '');
  }
  cardState.dirty = cardDiffChanges(cardState.current, cardState.draft).length > 0;
  cardUpdateDirty();
  if (k === 'customerDeptId') { cardState.draft.customerDept = (cardDict.departments || []).find(i => String(i.id) === String(v))?.name || ''; cardRenderBody(); }
  if (k === 'progress') {
    document.querySelectorAll('#task-detail-overlay [data-k="progress"]').forEach(el2 => { if (el2 !== el) el2.value = v; });
    const progressEditor = el.closest('.ui-task-progress-editor');
    if (progressEditor) {
      progressEditor.style.setProperty('--progress-position', v + '%');
      const progressValue = progressEditor.querySelector('[data-progress-value]');
      if (progressValue) progressValue.textContent = v + '%';
    }
  }
  if (ev.type === 'change' && (k === 'status' || k === 'progress')) {
    void cardSuggestStatusProgressSync(k, v);
  }
  if (k === 'team') {
    const teamId = cardMaps?.teamId(v);
    document.querySelector('#task-detail-overlay [data-k="assignee"]')?._dictionarySearchRefresh?.(userValuesForTeam(cardDict?.users, teamId, true));
  }
  if (k === 'demoDid') {
    cardRenderBody();
    cardUpdateDirty();
  }
  cardRefreshDynamic();
}

async function cardConfirmTabChange(nextTab) {
  if (normalizeTaskCardTab(nextTab) === cardState.tab || cardState.tab !== 'rep' || cardReportingDirtyCount() === 0) return true;
  const confirmed = await confirmTaskCardDiscard(
    'Несохранённые отчётные статусы будут потеряны. Переключить вкладку?',
    { hasChanges: true, changeNames: cardReportingDraftNames() }
  );
  if (confirmed) clearCardReportingDrafts();
  return confirmed;
}

async function cardOnClick(ev, app) {
  const actEl = ev.target.closest('[data-action]');
  if (actEl) {
    const a = actEl.dataset.action;
    if (a === 'retry-card-read') {
      const kind = actEl.dataset.readKind;
      const taskId = currentTask.id;
      const tab = cardState.tab;
      if (kind === 'attachments') await loadAttachments(currentTask.id, app);
      else if (kind === 'task-history') await cardLoadHistory(app);
      else if (kind === 'reporting-context') await cardLoadReportingContext(app);
      if (cardMatchesCurrentTask(taskId) && cardState.tab === tab && !actEl.isConnected) {
        const retry = Array.from(document.querySelectorAll('#task-detail-overlay [data-read-kind]')).find(button => button.dataset.readKind === kind);
        (retry || document.getElementById('task-tab-' + tab))?.focus({ preventScroll: true });
      }
      return;
    }
    if (a === 'open-requirement-workspace') {
      const taskId = currentTask?.id;
      if (taskId && await cardRequestClose()) window.location.hash = '#/agent-v2?object_type=task&object_id=' + encodeURIComponent(taskId);
      return;
    }
    if (a === 'close') { cardRequestClose(); return; }
    if (a === 'toggle-card-attributes') { cardState.attributesExpanded = !cardState.attributesExpanded; cardRenderBody(); return; }
    if (a === 'toggle-description') {
      cardState.descriptionExpanded = !cardState.descriptionExpanded;
      cardSyncDescriptionDisclosure();
      return;
    }
    if (a === 'scroll-tabs-left' || a === 'scroll-tabs-right') {
      const tabs = document.getElementById('tabs');
      if (tabs) tabs.scrollBy({ left: (a === 'scroll-tabs-left' ? -1 : 1) * Math.max(180, tabs.clientWidth * .65), behavior: 'smooth' });
      return;
    }
    if (a === 'open-pip-history') { await cardActivateTab('log', app); return; }
    if (a === 'edit') { cardStartEdit(app); return; }
    if (a === 'cancel') { cardCancelEdit(app); return; }
    if (a === 'save') { cardSaveEdit(app); return; }
    if (a === 'edit-reporting-status' || a === 'cancel-reporting-status') {
      const kind = actEl.dataset.reportingKind, meetingId = actEl.dataset.meetingId;
      if (!cardFindReportingItem(kind, meetingId)?.can_edit) return;
      const key = cardReportingDraftKey(kind, meetingId);
      if (a === 'edit-reporting-status') cardReportingEditors.add(key);
      else { cardReportingEditors.delete(key); cardReportingDrafts.delete(key); }
      cardRenderBody(); cardUpdateDirty();
      document.querySelector('[data-reporting-text="' + kind + '"]')?.focus();
      return;
    }
    if (a === 'pick-attachments') { document.getElementById('attachment-file-input')?.click(); return; }
    if (a === 'save-reporting-status') { cardSaveReportingStatus(actEl, app); return; }
    if (a === 'copy-id') {
      const publicId = formatTaskPublicId(currentTask);
      try { navigator.clipboard.writeText(publicId); cardToast('ID ' + publicId + ' скопирован', 'ok'); }
      catch (_) { cardToast('ID: ' + publicId, 'ok'); }
      return;
    }
    if (a === 'copy-link') {
      const url = new URL(window.location.href);
      const currentPath = window.location.hash.slice(1).split('?')[0] || '/backlog';
      const params = new URLSearchParams(currentPath==='/backlog'?(window.location.hash.split('?')[1]||''):'');
      params.set('task',String(currentTask.id));params.set('bv','2');
      if(!params.has('scope'))params.set('scope',['read','read_write'].includes(window.app?.store?.get('currentUser')?.permissions?.backlog_dmb)?'all':'team');
      if (cardState.tab !== 'main') params.set('tab', cardState.tab);
      const commentTarget = cardState.tab === 'com' ? parseCommentTarget(window.location.hash) : null;
      if (commentTarget) params.set('comment', String(commentTarget));
      url.hash = `/backlog?${params.toString()}`;
      try {
        await navigator.clipboard.writeText(url.toString());
        cardToast('Ссылка на задачу скопирована', 'ok');
      } catch (_) {
        const helper = document.createElement('textarea');
        helper.value = url.toString();
        helper.style.position = 'fixed'; helper.style.opacity = '0';
        document.body.appendChild(helper); helper.select();
        const copied = document.execCommand('copy');
        helper.remove();
        cardToast(copied ? 'Ссылка на задачу скопирована' : url.toString(), copied ? 'ok' : 'warn');
      }
      return;
    }
    if (a === 'ai-calc-fin') { await cardRunPrioritiser('value', app); return; }
    if (a === 'ps-calc') { await cardRunPrioritiser('priority', app); return; }
    if (a === 'ai-value-accept') { await cardAcceptPrioritiserValue(app); return; }
    if (a === 'ai-value-reject') {
      cardAi = null;
      cardRenderBody();
      cardToast('Предложение агента отклонено', 'info');
      return;
    }
    if (a === 'add-jira') {
      const inp = document.getElementById('newJira');
      if (inp && inp.value.trim()) {
        if (!cardUrlOk(inp.value.trim())) { cardToast('Некорректная ссылка Jira', 'err'); return; }
        cardState.draft.jiraLinks.push(inp.value.trim()); cardState.dirty = true; cardRenderBody(); cardUpdateDirty();
      }
      return;
    }
    if (a === 'del-jira') { cardState.draft.jiraLinks.splice(+actEl.dataset.idx, 1); cardState.dirty = true; cardRenderBody(); cardUpdateDirty(); return; }
    if (a === 'add-req') {
      const inp = document.getElementById('newReq');
      if (inp && inp.value.trim()) {
        if (!cardUrlOk(inp.value.trim())) { cardToast('Некорректная ссылка на требования', 'err'); return; }
        cardState.draft.reqLinks.push(inp.value.trim()); cardState.dirty = true; cardRenderBody(); cardUpdateDirty();
      }
      return;
    }
    if (a === 'del-req') { cardState.draft.reqLinks.splice(+actEl.dataset.idx, 1); cardState.dirty = true; cardRenderBody(); cardUpdateDirty(); return; }
    return;
  }
  if (ev.target.closest('.task-description-content a')) return;
  const inlineEdit = ev.target.closest('[data-inline-edit]');
  if (inlineEdit && !cardState.editing) {
    await cardStartEdit(app, inlineEdit.dataset.inlineEdit);
    return;
  }
  const tabEl = ev.target.closest('[data-tab]');
  if (tabEl) {
    if (!(await cardConfirmTabChange(tabEl.dataset.tab))) {
      document.getElementById('task-tab-' + cardState.tab)?.focus({ preventScroll: true });
      return;
    }
    const activeTab = await cardActivateTab(tabEl.dataset.tab, app);
    document.getElementById('task-tab-' + activeTab)?.focus({ preventScroll: true });
    return;
  }
  const chip = ev.target.closest('[data-toggle]');
  if (chip && cardState.editing) {
    const field = chip.dataset.toggle;
    const val = chip.dataset.val;
    const arr = cardState.draft[field];
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1); else arr.push(val);
    cardState.dirty = true;
    cardRenderBody();
    cardUpdateDirty();
    Array.from(document.querySelectorAll('#task-detail-overlay [data-toggle]'))
      .find(button => button.dataset.toggle === field && button.dataset.val === val)?.focus({ preventScroll: true });
    return;
  }
}

function cardReset() {
  clearTimeout(_cardQuickSaveTimer);
  clearTimeout(_cardAttachmentHydrationTimer);
  _taskCardRequestGate.cancelAll();
  _cardReadStates = {};
  _taskCommentDraftSession.clearAll();
  _cardAttachmentHydrationTimer = null;
  cardState = { tab: 'main', editing: false, dirty: false, saving: false, prioritiserRunning: '', replyFor: null, current: null, draft: null, history: [], commentsCount: 0, filesCount: 0, descriptionExpanded: false };
  cardRates = null; cardDict = null; cardMaps = null; cardAi = null; cardPs = null;
  cardReportingContext = null; cardReportingLoading = false;
  clearCardReportingDrafts();
  _commentsCache = [];
  _commentsLoadedTaskId = null;
  _attachmentsCache = [];
  _usersCache = [];
  _mentionedUserIds = [];
  _mentionSelectedIdx = -1;
  _mentionQueryStart = -1;
  _replyingTo = null;
  _commentTaskId = null;
  _commentTargetHandled = null;
  _pendingCommentSubmission = null;
  _commentSubmitting = false;
  _statusProgressSuggestionPending = false;
  if (_cardEscHandler) { document.removeEventListener('keydown', _cardEscHandler); _cardEscHandler = null; }
  if (_cardRouteTabHandler) { document.removeEventListener('task-tab-change', _cardRouteTabHandler); _cardRouteTabHandler = null; }
}

async function cardInit(app) {
  const api = app?.api || window.app?.api;
  const taskId = Number(currentTask?.id);
  const overlay = document.getElementById('task-detail-overlay');
  const isActive = () => cardMatchesCurrentTask(taskId)
    && overlay?.isConnected
    && overlay === document.getElementById('task-detail-overlay');
  cardRender();
  if (!api || !isActive()) return;
  if (cardState.tab === 'rep') await cardLoadReportingContext(app, taskId);
  if (!isActive()) return;
  const ratesData = await api.get('/admin/competency-costs').catch(() => []);
  if (!isActive()) return;
  cardRates = cardBuildRates(ratesData);
  if (!(await cardLoadDict(app, taskId)) || !isActive()) return;
  cardRender();
  await cardLoadHistory(app, taskId);
  if (!isActive()) return;
  if (cardState.tab === 'main' || cardState.tab === 'log') cardRenderBody();
  await Promise.all([loadComments(taskId, app), loadAttachments(taskId, app)]);
  if (!isActive()) return;
  cardState.commentsCount = cardCommentCount(_commentsCache);
  cardState.filesCount = _attachmentsCache.length;
  cardRenderTabs();
  if (cardState.tab === 'com') { _commentFormInitialized = false; initCommentForm(taskId, app); }
  checkAndRenderLock(taskId);
  registerViewer(taskId).then(async () => {
    if (!isActive()) return;
    const viewers = await fetchViewers(taskId);
    if (!isActive()) return;
    _currentViewers = viewers;
    renderViewerBanner();
  });
  startViewerPolling(taskId);
  cardRenderTabs();
}

export function renderTaskDetailModal(task, app) {
  _taskCardRequestGate.cancelAll();
  _cardReadStates = {};
  _taskCommentDraftSession.clearAll();
  currentTask = task;
  if (task?.id) _taskCommentDraftSession.begin(task.id);
  modalMode = task ? 'view' : 'edit';
  cardState.current = buildCardState(task || {});
  cardState.tab = cardTabFromRoute();
  cardState.editing = false; cardState.entryField = ''; cardState.dirty = false; cardState.saving = false; cardState.prioritiserRunning = ''; cardState.replyFor = null;
  cardState.history = []; cardState.commentsCount = 0; cardState.filesCount = 0; cardState.descriptionExpanded = false;
  cardRates = null; cardDict = null; cardMaps = null; cardAi = null; cardPs = null;
  cardReportingContext = null; cardReportingLoading = false;
  clearCardReportingDrafts();
  _commentsCache = [];
  _commentsLoadedTaskId = null;
  _attachmentsCache = [];
  _usersCache = [];
  _mentionedUserIds = [];
  _mentionSelectedIdx = -1;
  _mentionQueryStart = -1;
  _replyingTo = null;
  _commentTaskId = task?.id ? Number(task.id) : null;
  _commentTargetHandled = null;
  _pendingCommentSubmission = null;
  _commentSubmitting = false;
  return `
    <div class="modal-overlay ui-task-dialog-overlay" id="task-detail-overlay">
      <div class="task-detail-modal ui-task-dialog" id="task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <div class="ui-task-dialog-head" id="mhead"></div>
        <div class="ui-task-dialog-tabs-shell" id="task-tabs-shell">
          <button type="button" class="ui-surface-action ui-task-dialog-scroll ui-task-dialog-scroll-left" data-action="scroll-tabs-left" aria-label="Прокрутить вкладки влево" disabled>‹</button>
          <div class="ui-tabs ui-task-dialog-tabs" id="tabs" role="tablist" aria-label="Разделы карточки задачи" aria-orientation="horizontal"></div>
          <button type="button" class="ui-surface-action ui-task-dialog-scroll ui-task-dialog-scroll-right" data-action="scroll-tabs-right" aria-label="Прокрутить вкладки вправо" disabled>›</button>
        </div>
        <div class="ui-task-dialog-body" id="mbody" role="tabpanel" tabindex="0"></div>
        <div class="ui-task-dialog-foot" id="mfoot"></div>
      </div>
      <div class="toast" id="card-toast"></div>
    </div>`;
}

export function initTaskDetailModal(app) {
  const overlay = document.getElementById('task-detail-overlay');
  if (!overlay) return;
  activateTaskModalFocusTrap(overlay);
  ensureTaskBeforeUnloadGuard();
  ensureTaskExternalLinkGuard();
  ensureTaskNetworkState();

  overlay.addEventListener('click', async (e) => {
    if (cardState.editing && cardState.entryField && !cardQuickEditContains(e.target) && !e.target.closest('[data-action]')) {
      e.preventDefault();
      await cardCancelEdit(app);
      return;
    }
    if (e.target === overlay) { cardRequestClose(); return; }
    cardOnClick(e, app);
  });
  overlay.addEventListener('input', e => cardOnField(e, app));
  overlay.addEventListener('change', e => cardOnField(e, app));
  document.getElementById('tabs')?.addEventListener('scroll', cardSyncTabsOverflow, { passive: true });
  overlay.addEventListener('keydown', async e => {
    const currentTab = e.target.closest?.('[role="tab"][data-tab]');
    if (currentTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(e.key)) {
      const activation = e.key === 'Enter' || e.key === ' ';
      const nextTab = activation ? currentTab : tabNavigationTarget(document.getElementById('tabs'), e);
      if (!nextTab) return;
      e.preventDefault();
      if (!activation) {
        document.querySelectorAll('#tabs [role="tab"]').forEach(tab => { tab.tabIndex = tab === nextTab ? 0 : -1; });
        nextTab.focus({ preventScroll: true });
        return;
      }
      if (!(await cardConfirmTabChange(nextTab.dataset.tab))) {
        currentTab.focus({ preventScroll: true });
        return;
      }
      const activeTab = await cardActivateTab(nextTab.dataset.tab, app);
      document.getElementById('task-tab-' + activeTab)?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest?.('.task-description-content a')) return;
    if (cardState.editing || (e.key !== 'Enter' && e.key !== ' ')) return;
    const inlineEdit = e.target.closest('[data-inline-edit]');
    if (!inlineEdit) return;
    e.preventDefault();
    cardStartEdit(app, inlineEdit.dataset.inlineEdit);
  });

  if (!window._cardResizeBound) {
    window.addEventListener('resize', () => { cardSyncTabsOverflow(); cardSyncDescriptionDisclosure(); });
    window._cardResizeBound = true;
  }

  if (_cardEscHandler) document.removeEventListener('keydown', _cardEscHandler);
  _cardEscHandler = (e) => {
    if (e.key === 'Escape' && document.querySelector(
      '#confirm-modal-overlay, #card-conflict-overlay, #prioritiser-requirements-overlay'
    )) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && cardState.editing) {
      e.preventDefault();
      cardSaveEdit(app);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && cardState.editing) {
      e.preventDefault();
      cardSaveEdit(app);
      return;
    }
    if (e.key === 'Escape' && cardState.editing) {
      e.preventDefault();
      cardCancelEdit(app);
      return;
    }
    if (e.key === 'Escape') cardRequestClose();
  };
  document.addEventListener('keydown', _cardEscHandler);

  if (_cardRouteTabHandler) document.removeEventListener('task-tab-change', _cardRouteTabHandler);
  _cardRouteTabHandler = async event => {
    if (Number(event.detail?.taskId) !== Number(currentTask?.id)) return;
    const requestedTab = normalizeTaskCardTab(event.detail?.tab || 'main');
    const currentTab = cardState.tab;
    if (!(await cardConfirmTabChange(requestedTab))) {
      window.app?.router?.updateTaskTabRoute?.(currentTab);
      document.getElementById('task-tab-' + currentTab)?.focus({ preventScroll: true });
      return;
    }
    await cardActivateTab(requestedTab, app, false);
  };
  document.addEventListener('task-tab-change', _cardRouteTabHandler);

  cardInit(app);

  setTimeout(() => {
    if (!overlay.isConnected || (document.activeElement && overlay.contains(document.activeElement))) return;
    if (cardState.tab === 'com' && parseCommentTarget(window.location.hash)) return;
    const first = overlay.querySelector('button, a, input');
    first?.focus();
  }, 150);
}
