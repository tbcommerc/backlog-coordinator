import { notificationReturnHref } from '../notificationUtils.js';
import { escapeHtml } from '../htmlUtils.js';
import { confirmAction, formatErrorMessage } from '../uiFeedback.js';
import { renderViewState } from './viewState.js';

const ALLOWED_ROLES = new Set(['po/pl/cl', 'ba/участник команды']);
let state = null;

function unsavedQuarterlyChanges() {
  return document.getElementById('quarterly-goals-update-workspace')
    && [...(state?.saveQueues.values() || [])].some(entry => entry.running || entry.pending || entry.failed);
}

export async function confirmQuarterlyGoalsNavigation() {
  if (!unsavedQuarterlyChanges()) return true;
  if ([...state.saveQueues.values()].some(entry => entry.running || entry.pending)) {
    window.toast?.('Дождитесь окончания сохранения', 'info');
    return false;
  }
  return confirmAction({ title: 'Изменения не сохранены', message: 'Перейти и потерять изменения квартальных целей?', confirmText: 'Не сохранять', cancelText: 'Продолжить редактирование', destructive: true });
}

function warnAboutQuarterlyChanges(event) {
  if (!unsavedQuarterlyChanges()) return;
  event.preventDefault(); event.returnValue = '';
}

export function canUseQuarterlyGoalsUpdate(app) {
  const user = app?.store?.get('currentUser');
  if (user?.permissions?.admin === 'full') return true;
  const role = String(user?.role_name || '').trim().toLocaleLowerCase('ru-RU');
  return Boolean(user?.team_id && ALLOWED_ROLES.has(role));
}

export function quarterlyGoalsUpdateHref({ source = '' } = {}) {
  const suffix = source ? `?source=${encodeURIComponent(source)}` : '';
  return `#/quarterly-goals-update${suffix}`;
}

function routeSource() {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  return new URLSearchParams(hash.split('?')[1] || '').get('source') || '';
}

function backLink(source) {
  if (source === 'backlog') return ['#/backlog', 'В бэклог DMB'];
  if (source === 'team-backlog') return ['#/team-backlog', 'В бэклог команды'];
  if (source === 'notification') return [notificationReturnHref(), 'К уведомлениям'];
  return ['#/reports/detail?r=quarterly-goals', 'К отчёту'];
}

export function renderQuarterlyGoalsUpdate() {
  const [href, label] = backLink(routeSource());
  return `<section class="modal-overlay reporting-status-workspace animate-fade-in" id="quarterly-goals-update-workspace">
    <div class="reporting-status-dialog" role="region" aria-labelledby="quarterly-goals-update-title">
      <header class="reporting-status-hero">
        <div class="reporting-status-heading"><div><h1 id="quarterly-goals-update-title">Обновить прогресс и статусы</h1><p>Укажите факт выполнения и месяц старта — план, отклонение и светофор рассчитаются автоматически.</p></div></div>
        <div class="reporting-status-header-actions"><a class="btn btn-ghost btn-lg square-icon ui-btn reporting-status-close" data-modal-close href="${href}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><i data-lucide="x"></i></a></div>
      </header>
      <div id="quarterly-goals-update-content" class="reporting-status-content">${renderViewState({ kind: 'loading', title: 'Загружаем задачи квартала…' })}</div>
    </div>
  </section>`;
}

function filteredItems() {
  const query = String(state.search || '').toLocaleLowerCase('ru-RU');
  return (state.data?.items || []).filter(item => {
    if (state.missingOnly && item.progress != null) return false;
    if (state.staleOnly && !item.is_stale) return false;
    return !query || [item.public_id, item.title, item.team_name, item.project_name]
      .some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
  });
}

function lightLabel(item) {
  if (item.progress_indicator === 'red') return 'Красный';
  if (item.progress_indicator === 'yellow') return 'Жёлтый';
  return 'Зелёный';
}

function lightBadgeClass(item) {
  if (item.progress_indicator === 'red') return 'danger';
  if (item.progress_indicator === 'yellow') return 'warning';
  return 'success';
}

function defaultShiftId() {
  return state.data?.start_shifts?.find(shift => shift.month_number === 1)?.id || null;
}

function draftFor(item) {
  if (!item._draft) item._draft = { progress: item.progress, start_shift_id: item.start_shift_id };
  return item._draft;
}

function shiftControl(item) {
  const selectedId = draftFor(item).start_shift_id ?? defaultShiftId();
  const taskLabel = escapeHtml(`${item.public_id || item.task_id}: ${item.title || 'Без названия'}`);
  return `<div class="quarterly-shift-control" role="group" aria-label="Месяц старта для ${taskLabel}">
    ${(state.data.start_shifts || []).map(shift => `<button type="button" class="ui-surface-action quarterly-shift-option ${selectedId === shift.id ? 'is-selected' : ''}" data-quarterly-shift="${item.task_id}" data-shift-id="${shift.id}" aria-pressed="${selectedId === shift.id}" title="${escapeHtml(shift.name)}" ${item.can_edit ? '' : 'disabled'}><span>${shift.month_number}</span><small>месяц</small></button>`).join('')}
  </div>`;
}

function factControl(item) {
  const editable = Boolean(item.can_edit);
  const draft = draftFor(item);
  const hasFact = draft.progress != null;
  const progress = hasFact ? draft.progress : 0;
  const taskLabel = escapeHtml(`${item.public_id || item.task_id}: ${item.title || 'Без названия'}`);
  return `<div class="quarterly-fact-control ${hasFact ? '' : 'is-empty'}" style="--quarterly-progress: ${progress}%">
    <div class="quarterly-update-fact-value"><output data-quarterly-progress-value="${item.task_id}" aria-live="polite">${hasFact ? `${progress}%` : '—'}</output><span>${hasFact ? 'выполнено' : 'факт не указан'}</span></div>
    <input type="range" min="0" max="100" step="5" value="${progress}" data-quarterly-progress="${item.task_id}" ${editable ? '' : 'disabled'} aria-label="Факт выполнения для ${taskLabel}" aria-valuetext="${hasFact ? `${progress} процентов` : 'Не указан; измените ползунок, чтобы указать факт'}">
  </div>`;
}

function saveStateMarkup(item) {
  const initial = item.can_edit ? (item.progress_updated_at ? 'Сохранено' : 'Требует актуализации') : 'Только просмотр';
  const message = item._saveMessage || initial;
  return `${item.can_edit ? `<button type="button" class="btn btn-secondary btn-sm ui-btn" data-quarterly-confirm="${item.task_id}" ${draftFor(item).progress == null ? 'disabled' : ''}>Подтвердить факт</button>` : ''}<span class="quarterly-save-state" data-quarterly-save-state="${item.task_id}" data-state="${item._saveKind || ''}" role="status">${escapeHtml(message)}</span>
    <button type="button" class="btn btn-secondary btn-sm ui-btn quarterly-save-action" data-quarterly-retry="${item.task_id}" ${item._retryVisible ? '' : 'hidden'}>Повторить</button>
    <button type="button" class="btn btn-secondary btn-sm ui-btn quarterly-save-action" data-quarterly-undo="${item.task_id}" ${item._undoVisible ? '' : 'hidden'}>Отменить</button>`;
}

function taskIdentity(item) {
  return `<button type="button" class="ui-surface-action reporting-task-link" data-open-quarterly-task="${item.task_id}"><span>${escapeHtml(item.public_id || String(item.task_id))}</span><strong>${escapeHtml(item.title || 'Без названия')}</strong></button><small>${escapeHtml(item.team_name)} · ${escapeHtml(item.project_name)}</small>`;
}

function renderCard(item) {
  return `<article class="quarterly-update-card" data-quarterly-task="${item.task_id}" data-version="${item.version || 0}" data-light="${item.progress_indicator || 'none'}">
    <header class="quarterly-update-card-head">
      <div class="quarterly-update-card-identity">${taskIdentity(item)}</div>
      <span class="quarterly-light quarterly-light-${lightBadgeClass(item)}" data-quarterly-light="${item.task_id}"><i></i>${lightLabel(item)}</span>
    </header>
    <div class="quarterly-update-card-body">
      <section class="quarterly-progress-editor" aria-label="Факт выполнения"><span class="quarterly-field-label">Факт выполнения</span>${factControl(item)}</section>
      <section class="quarterly-start-editor" aria-label="Старт в квартале"><span class="quarterly-field-label">Старт в квартале</span>${shiftControl(item)}</section>
      <dl class="quarterly-update-metrics">
        <div><dt>План на сегодня</dt><dd data-quarterly-plan="${item.task_id}">${item.planned_progress == null ? '—' : `${item.planned_progress}%`}</dd></div>
        <div><dt>Отклонение</dt><dd data-quarterly-deviation="${item.task_id}">${item.progress_deviation_percent == null ? '—' : `${item.progress_deviation_percent} п.п.`}</dd></div>
      </dl>
    </div>
    <footer class="quarterly-update-card-footer"><span class="quarterly-autosave-label"><i data-lucide="cloud"></i>Автосохранение</span><span>${saveStateMarkup(item)}</span></footer>
  </article>`;
}

function renderLists() {
  const items = filteredItems();
  const cardList = document.querySelector('[data-quarterly-card-list]');
  const result = document.querySelector('[data-quarterly-result]');
  if (cardList) cardList.innerHTML = items.length ? items.map(renderCard).join('') : '<div class="quarterly-update-empty">Нет задач по выбранным условиям</div>';
  if (result) result.textContent = `${items.length} из ${state.data.summary.total_tasks} задач`;
  window.lucide?.createIcons();
}

function renderContent() {
  const root = document.getElementById('quarterly-goals-update-content');
  if (!root || !state?.data) return;
  const items = filteredItems();
  const summary = state.data.summary;
  root.innerHTML = `<section class="reporting-preparation quarterly-update-preparation">
    <div class="quarterly-update-context">
      <div><span class="quarterly-update-eyebrow">${escapeHtml(state.data.quarter)}</span><strong>План с первого месяца — ${state.data.base_planned_progress}%</strong><small>Факт, план и светофор пересчитываются после каждого изменения</small></div>
      <div class="quarterly-update-summary" aria-label="Фильтры по состоянию">
        <button type="button" class="btn btn-secondary btn-sm ui-btn quarterly-stat-filter" data-quarterly-filter="all" aria-pressed="true"><span data-quarterly-summary-total>${summary.total_tasks}</span><small>Все задачи</small></button>
        <button type="button" class="btn btn-secondary btn-sm ui-btn quarterly-stat-filter" data-quarterly-filter="missing" aria-pressed="false"><span data-quarterly-summary-missing>${summary.missing_fact}</span><small>Без факта</small></button>
        <button type="button" class="btn btn-secondary btn-sm ui-btn quarterly-stat-filter" data-quarterly-filter="stale" aria-pressed="false"><span data-quarterly-summary-stale>${summary.stale_fact}</span><small>Обновить</small></button>
      </div>
    </div>
    <div class="quarterly-update-toolbar"><label class="quarterly-update-search"><i data-lucide="search"></i><input class="input ui-control" type="search" data-quarterly-search aria-label="Поиск по задачам квартала" placeholder="Найти задачу, команду или проект" value="${escapeHtml(state.search)}"></label><span class="quarterly-update-result" data-quarterly-result>${items.length} из ${summary.total_tasks} задач</span></div>
    <div class="quarterly-update-list" data-quarterly-card-list>${items.length ? items.map(renderCard).join('') : '<div class="quarterly-update-empty">Нет задач по выбранным условиям</div>'}</div>
  </section>`;
  window.lucide?.createIcons();
}

function refreshSummary() {
  const items = state.data.items || [];
  state.data.summary.missing_fact = items.filter(item => item.progress == null).length;
  state.data.summary.stale_fact = items.filter(item => item.is_stale).length;
  document.querySelector('[data-quarterly-summary-missing]')?.replaceChildren(String(state.data.summary.missing_fact));
  document.querySelector('[data-quarterly-summary-stale]')?.replaceChildren(String(state.data.summary.stale_fact));
}

function setSaveState(taskId, kind, message) {
  const item = state.data.items.find(candidate => candidate.task_id === taskId);
  if (item) {
    item._saveKind = kind;
    item._saveMessage = message;
  }
  document.querySelectorAll(`[data-quarterly-save-state="${taskId}"]`).forEach(node => {
    node.textContent = message;
    node.dataset.state = kind;
  });
  document.querySelectorAll(`[data-quarterly-task="${taskId}"]`).forEach(node => {
    node.classList.toggle('is-saving', kind === 'saving');
    node.classList.toggle('is-saved', kind === 'saved');
    node.classList.toggle('is-error', kind === 'error');
  });
}

function toggleSaveAction(taskId, action, visible) {
  const item = state.data.items.find(candidate => candidate.task_id === taskId);
  if (item) item[`_${action}Visible`] = visible;
  document.querySelectorAll(`[data-quarterly-${action}="${taskId}"]`).forEach(node => { node.hidden = !visible; });
}

function syncItemPresentation(item) {
  const taskId = item.task_id;
  document.querySelectorAll(`[data-quarterly-plan="${taskId}"]`).forEach(node => { node.textContent = item.planned_progress == null ? 'Не применимо' : `${item.planned_progress}%`; });
  document.querySelectorAll(`[data-quarterly-deviation="${taskId}"]`).forEach(node => { node.textContent = item.progress_deviation_percent == null ? 'Нет факта' : `${item.progress_deviation_percent} п.п.`; });
  document.querySelectorAll(`[data-quarterly-light="${taskId}"]`).forEach(node => {
    node.textContent = lightLabel(item);
    node.classList.remove('quarterly-light-danger', 'quarterly-light-warning', 'quarterly-light-success');
    node.classList.add(`quarterly-light-${lightBadgeClass(item)}`);
    node.insertAdjacentHTML('afterbegin', '<i></i>');
  });
  document.querySelectorAll(`[data-quarterly-task="${taskId}"]`).forEach(node => { node.dataset.version = item.version || 0; node.dataset.light = item.progress_indicator || 'none'; });
}

function syncDraftControls(item) {
  const draft = draftFor(item);
  const hasFact = draft.progress != null;
  document.querySelectorAll(`[data-quarterly-progress="${item.task_id}"]`).forEach(node => {
    node.disabled = !item.can_edit;
    node.value = hasFact ? draft.progress : 0;
    node.setAttribute('aria-valuetext', hasFact ? `${draft.progress} процентов` : 'Не указан; измените ползунок, чтобы указать факт');
    node.closest('.quarterly-fact-control')?.style.setProperty('--quarterly-progress', `${hasFact ? draft.progress : 0}%`);
  });
  document.querySelectorAll(`[data-quarterly-progress-value="${item.task_id}"]`).forEach(node => {
    node.textContent = hasFact ? `${draft.progress}%` : '—';
    node.nextElementSibling.textContent = hasFact ? 'выполнено' : 'факт не указан';
    node.closest('.quarterly-fact-control')?.classList.toggle('is-empty', !hasFact);
  });
  document.querySelectorAll(`[data-quarterly-confirm="${item.task_id}"]`).forEach(node => { node.disabled = !item.can_edit || !hasFact; });
  const shiftId = draft.start_shift_id ?? defaultShiftId();
  document.querySelectorAll(`[data-quarterly-shift="${item.task_id}"]`).forEach(node => {
    const selected = Number(node.dataset.shiftId) === Number(shiftId);
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-pressed', String(selected));
  });
}

function queueSave(app, taskId, changes, { keepUndo = false } = {}) {
  const item = state.data.items.find(candidate => candidate.task_id === taskId);
  if (!item) return;
  const entry = state.saveQueues.get(taskId) || { running: false, pending: null, failed: null };
  entry.pending = { ...changes };
  entry.failed = null;
  state.saveQueues.set(taskId, entry);
  toggleSaveAction(taskId, 'retry', false);
  if (!keepUndo) toggleSaveAction(taskId, 'undo', false);
  processSaveQueue(app, taskId);
}

async function processSaveQueue(app, taskId) {
  const session = state;
  const entry = state.saveQueues.get(taskId);
  const item = state.data.items.find(candidate => candidate.task_id === taskId);
  if (!entry || !item || entry.running || !entry.pending) return;
  entry.running = true;
  entry.failed = null;
  toggleSaveAction(taskId, 'retry', false);
  const changes = entry.pending;
  entry.pending = null;
  const previous = { progress: item.progress, start_shift_id: item.start_shift_id ?? defaultShiftId() };
  setSaveState(taskId, 'saving', 'Сохраняем…');
  try {
    const result = await app.api.put(`/reports/quarterly-goals/tasks/${taskId}`, { progress: changes.progress, start_shift_id: changes.start_shift_id, version: item.version || 0, ...(changes.confirm_progress ? { confirm_progress: true } : {}) });
    if (state !== session) return;
    Object.assign(item, result);
    state.undoByTask.set(taskId, previous);
    if (!entry.pending) item._draft = { progress: item.progress, start_shift_id: item.start_shift_id };
    refreshSummary();
    syncItemPresentation(item);
    if (!entry.pending) syncDraftControls(item);
    setSaveState(taskId, entry.pending ? 'saving' : 'saved', entry.pending ? 'Сохраняем следующее изменение…' : 'Сохранено');
    toggleSaveAction(taskId, 'undo', !entry.pending);
    window.toast?.('Данные светофора обновлены', 'success');
  } catch (error) {
    if (state !== session) return;
    entry.failed = changes;
    const message = error?.status === 409 ? 'Данные уже изменились. Обновите страницу или повторите после проверки.' : formatErrorMessage(error);
    setSaveState(taskId, 'error', message);
    toggleSaveAction(taskId, 'retry', true);
    window.toast?.(message, 'error');
  } finally {
    entry.running = false;
    if (state === session && entry.pending) processSaveQueue(app, taskId);
  }
}

function setActiveFilter(filter) {
  state.missingOnly = filter === 'missing';
  state.staleOnly = filter === 'stale';
  document.querySelectorAll('[data-quarterly-filter]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.quarterlyFilter === filter)));
  const missing = document.querySelector('[data-quarterly-missing]');
  const stale = document.querySelector('[data-quarterly-stale]');
  missing?.classList.toggle('is-active', state.missingOnly);
  missing?.setAttribute('aria-pressed', String(state.missingOnly));
  stale?.classList.toggle('is-active', state.staleOnly);
  stale?.setAttribute('aria-pressed', String(state.staleOnly));
  renderLists();
}

export async function initQuarterlyGoalsUpdate(app) {
  const root = document.getElementById('quarterly-goals-update-workspace');
  if (!root) return;
  const pageScroller = root.closest('.main-content');
  if (pageScroller) pageScroller.scrollTop = 0;
  state = { data: null, search: '', missingOnly: false, staleOnly: false, saveQueues: new Map(), undoByTask: new Map() };
  window.removeEventListener('beforeunload', warnAboutQuarterlyChanges);
  window.addEventListener('beforeunload', warnAboutQuarterlyChanges);
  try {
    state.data = await app.api.get('/reports/quarterly-goals/preparation');
    renderContent();
  } catch (error) {
    root.querySelector('#quarterly-goals-update-content').innerHTML = renderViewState({ kind: 'error', title: 'Не удалось загрузить задачи', message: formatErrorMessage(error) });
    return;
  }

  root.addEventListener('input', event => {
    if (event.target.matches('[data-quarterly-search]')) {
      state.search = event.target.value;
      renderLists();
    }
    if (event.target.matches('[data-quarterly-progress]')) {
      const taskId = Number(event.target.dataset.quarterlyProgress);
      const value = Number(event.target.value);
      const item = state.data.items.find(candidate => candidate.task_id === taskId);
      if (item) draftFor(item).progress = value;
      root.querySelectorAll(`[data-quarterly-progress-value="${taskId}"]`).forEach(output => { output.textContent = `${value}%`; });
      root.querySelectorAll(`[data-quarterly-progress="${taskId}"]`).forEach(input => {
        if (input !== event.target) input.value = String(value);
        input.setAttribute('aria-valuetext', `${value} процентов`);
        const control = input.closest('.quarterly-fact-control');
        control?.style.setProperty('--quarterly-progress', `${value}%`);
        control?.classList.remove('is-empty');
        const status = control?.querySelector('.quarterly-update-fact-value span');
        if (status) status.textContent = 'выполнено';
      });
    }
  });
  root.addEventListener('change', event => {
    const progress = event.target.closest('[data-quarterly-progress]');
    const taskId = Number(progress?.dataset.quarterlyProgress);
    if (!taskId) return;
    const item = state.data.items.find(candidate => candidate.task_id === taskId);
    if (!item) return;
    const draft = draftFor(item);
    if (progress) draft.progress = Number(progress.value);
    syncDraftControls(item);
    queueSave(app, taskId, { progress: draft.progress, start_shift_id: draft.start_shift_id ?? defaultShiftId() });
  });
  root.addEventListener('click', event => {
    const progressInput = event.target.closest('[data-quarterly-progress]');
    if (progressInput) {
      const taskId = Number(progressInput.dataset.quarterlyProgress);
      const item = state.data.items.find(candidate => candidate.task_id === taskId);
      const draft = item ? draftFor(item) : null;
      if (item && draft.progress == null) {
        draft.progress = Number(progressInput.value);
        syncDraftControls(item);
        queueSave(app, taskId, { progress: draft.progress, start_shift_id: draft.start_shift_id ?? defaultShiftId() });
      }
    }
    const confirm = event.target.closest('[data-quarterly-confirm]');
    if (confirm && !confirm.disabled) {
      const taskId = Number(confirm.dataset.quarterlyConfirm);
      const item = state.data.items.find(candidate => candidate.task_id === taskId);
      if (item?.can_edit && draftFor(item).progress != null) queueSave(app, taskId, { ...draftFor(item), start_shift_id: draftFor(item).start_shift_id ?? defaultShiftId(), confirm_progress: true });
    }
    const statFilter = event.target.closest('[data-quarterly-filter]');
    if (statFilter) setActiveFilter(statFilter.dataset.quarterlyFilter);
    const shift = event.target.closest('[data-quarterly-shift]');
    if (shift) {
      const taskId = Number(shift.dataset.quarterlyShift);
      const item = state.data.items.find(candidate => candidate.task_id === taskId);
      if (item) {
        const draft = draftFor(item);
        draft.start_shift_id = Number(shift.dataset.shiftId);
        syncDraftControls(item);
        queueSave(app, taskId, { progress: draft.progress, start_shift_id: draft.start_shift_id });
      }
    }
    const retry = event.target.closest('[data-quarterly-retry]');
    if (retry) {
      const taskId = Number(retry.dataset.quarterlyRetry);
      const entry = state.saveQueues.get(taskId);
      const item = state.data.items.find(candidate => candidate.task_id === taskId);
      if (item) queueSave(app, taskId, entry?.failed || { ...draftFor(item) });
    }
    const undo = event.target.closest('[data-quarterly-undo]');
    if (undo) {
      const taskId = Number(undo.dataset.quarterlyUndo);
      const previous = state.undoByTask.get(taskId);
      const item = state.data.items.find(candidate => candidate.task_id === taskId);
      if (previous && item) {
        item._draft = { ...previous };
        syncDraftControls(item);
        state.undoByTask.delete(taskId);
        queueSave(app, taskId, previous, { keepUndo: true });
      }
    }
    const openTask = event.target.closest('[data-open-quarterly-task]');
    if (openTask) document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(openTask.dataset.openQuarterlyTask) } }));
  });
}
