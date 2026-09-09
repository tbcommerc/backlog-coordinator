import { escapeHtml } from '../htmlUtils.js';
import { confirmAction, formatErrorMessage } from '../uiFeedback.js';
import { renderViewState, bindViewStateAction } from './viewState.js';

const ALLOWED_ROLES = new Set(['po/pl/cl', 'ba/участник команды']);
const MEETING_META = {
  directorate: { label: 'Директорская оперативка', icon: 'briefcase' },
  did: { label: 'Оперативка ДИД', icon: 'layers' },
  key_projects: { label: 'Ключевые проекты', icon: 'key-round' },
};

let workspaceState = null;

export function canUseReportingStatusWorkspace(app) {
  const resolvedApp = app || (typeof window !== 'undefined' ? window.app : null);
  const user = resolvedApp?.store?.get('currentUser');
  if (user?.permissions?.admin === 'full') return true;
  const role = String(user?.role_name || '').trim().toLocaleLowerCase('ru-RU');
  return Boolean(user?.team_id && ALLOWED_ROLES.has(role));
}

export function reportingStatusHref({ source = '', kind = '', meetingId = '' } = {}) {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (kind) params.set('kind', kind);
  if (meetingId) params.set('meeting_id', String(meetingId));
  const query = params.toString();
  return `#/reporting-statuses${query ? `?${query}` : ''}`;
}

function routeParams() {
  const query = (window.location.hash.split('?')[1] || '');
  return new URLSearchParams(query);
}

function formatMeetingDate(value) {
  if (!value) return 'Дата ещё не назначена';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`))
    .replace(/\sг\.$/, '');
}

function formatUpdated(value) {
  if (!value) return 'Ещё не обновлялся';
  return `Обновлено ${new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}

function sourceBackLink(source) {
  if (source === 'team-backlog') return { href: '#/team-backlog', label: 'В бэклог команды' };
  if (source === 'report') return { href: '#/reports', label: 'К отчётам' };
  if (source === 'notification') return { href: '#/notifications', label: 'К уведомлениям' };
  return { href: '#/team-backlog', label: 'В бэклог команды' };
}

export function renderReportingStatuses(app) {
  const user = app.store.get('currentUser');
  const isAdmin = user?.permissions?.admin === 'full';
  const back = sourceBackLink(routeParams().get('source'));
  return `<section class="modal-overlay reporting-status-workspace animate-fade-in" id="reporting-status-workspace">
    <div class="reporting-status-dialog" role="dialog" aria-modal="true" aria-labelledby="reporting-status-title">
      <header class="reporting-status-hero">
        <div class="reporting-status-heading">
          <div><h1 id="reporting-status-title">Статусы к отчётным встречам</h1><p>${isAdmin ? 'Просмотрите, обновите и подтвердите готовность статусов всех команд в одном окне.' : 'Обновите и подтвердите готовность статусов задач своей команды до начала встречи.'}</p></div>
        </div>
        <div class="reporting-status-header-actions">
          <div class="reporting-status-scope"><i data-lucide="users"></i><span>${escapeHtml(isAdmin ? 'Все команды' : (user?.team_name || 'Ваша команда'))}</span><small>${escapeHtml(user?.role_name || '')}</small></div>
          <a class="reporting-status-close" data-modal-close href="${back.href}" title="${escapeHtml(back.label)}"><i data-lucide="x"></i></a>
        </div>
      </header>
      <div id="reporting-status-content" class="reporting-status-content">
        ${renderViewState({ kind: 'loading', title: 'Загружаем ближайшие встречи…' })}
      </div>
    </div>
  </section>`;
}

export async function confirmReportingStatusNavigation() {
  if (!workspaceState?.dirty?.size || !document.getElementById('reporting-status-workspace')) return true;
  const confirmed = await confirmAction({
    title: 'Есть несохранённые статусы',
    message: `Изменено задач: ${workspaceState.dirty.size}. Перейти и потерять черновики?`,
    confirmText: 'Перейти',
  });
  if (confirmed) workspaceState.dirty.clear();
  return confirmed;
}

function currentMeetings(items) {
  const result = [];
  Object.keys(MEETING_META).forEach(kind => {
    const meeting = items.find(item => item.kind === kind && ['planned', 'date_pending'].includes(item.state));
    if (meeting) result.push(meeting);
  });
  return result;
}

function selectedMeeting() {
  return workspaceState?.meetings.find(item => item.id === workspaceState.selectedMeetingId) || null;
}

function renderMeetingTabs() {
  return `<div class="reporting-meeting-tabs" role="tablist" aria-label="Отчётные встречи">${workspaceState.meetings.map(meeting => {
    const meta = MEETING_META[meeting.kind] || { label: meeting.title, icon: 'calendar-days' };
    const active = meeting.id === workspaceState.selectedMeetingId;
    return `<button type="button" role="tab" aria-selected="${active}" class="reporting-meeting-tab${active ? ' is-active' : ''}" data-reporting-meeting="${meeting.id}">
      <i data-lucide="${meta.icon}"></i><span><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(formatMeetingDate(meeting.scheduled_date))}</small></span>
      ${meeting.state === 'date_pending' ? '<em>Нужна дата</em>' : ''}
    </button>`;
  }).join('')}</div>`;
}

export function filterReportingStatusItems(items, { search = '', missingOnly = false, recentlySavedIds = new Set() } = {}) {
  const query = String(search || '').toLocaleLowerCase('ru-RU');
  return (items || []).filter(item => {
    if (missingOnly && item.filled && !recentlySavedIds.has(item.task_id)) return false;
    if (!query) return true;
    return [item.public_id, item.title, item.team_name].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
  });
}

export function confirmableReportingStatusIds(items, dirty = new Map()) {
  return (items || []).filter(item => {
    const draft = dirty.get(item.task_id);
    const text = draft ? draft.text : item.text;
    const isReady = draft ? Boolean(draft.is_ready) : Boolean(item.is_ready);
    return Boolean(item.can_edit && !isReady && String(text || '').trim());
  }).map(item => item.task_id);
}

function filteredItems() {
  return filterReportingStatusItems(workspaceState.data?.items, workspaceState);
}

function renderStatusCard(item, meeting) {
  const draft = workspaceState.dirty.get(item.task_id);
  const text = draft ? draft.text : (item.text || '');
  const didDemo = draft ? draft.did_demo : Boolean(item.did_demo);
  const isReady = draft ? Boolean(draft.is_ready) : Boolean(item.is_ready);
  const directorateAttention = draft
    ? Boolean(draft.directorate_attention)
    : Boolean(item.directorate_attention);
  const editable = Boolean(item.can_edit);
  const previous = item.previous_status;
  return `<article class="reporting-task-status${isReady ? ' is-filled' : ' is-missing'}${draft ? ' is-dirty' : ''}" data-reporting-task="${item.task_id}" data-version="${item.version || 0}">
    <div class="reporting-task-status-head">
      <button type="button" class="reporting-task-link" data-open-reporting-task="${item.task_id}"><span>${escapeHtml(item.public_id)}</span><strong>${escapeHtml(item.title || 'Без названия')}</strong><i data-lucide="arrow-up-right"></i></button>
      <span class="reporting-task-state"><i data-lucide="${isReady ? 'circle-check' : 'circle-dashed'}"></i>${isReady ? 'Готово' : 'Не подтверждено'}</span>
    </div>
    <div class="reporting-previous-status"><span>Предыдущая встреча${previous?.meeting_date ? ` · ${escapeHtml(formatMeetingDate(previous.meeting_date))}` : ''}</span><p>${previous?.text ? escapeHtml(previous.text) : 'Статус не предоставлялся'}</p></div>
    <label class="reporting-status-editor"><span class="reporting-status-editor-label">Статус к выбранной встрече</span><textarea class="input" rows="3" maxlength="5000" data-reporting-text="${item.task_id}" placeholder="Что сделано, что мешает и какой следующий шаг…" ${editable ? '' : 'disabled'}>${escapeHtml(text)}</textarea></label>
    <div class="reporting-task-status-footer">
      <div class="reporting-workspace-meta"><span>${escapeHtml(formatUpdated(item.updated_at))}${item.updated_by_name ? ` · ${escapeHtml(item.updated_by_name)}` : ''}</span><span data-reporting-error="${item.task_id}" role="alert">${escapeHtml(item._saveError || '')}</span></div>
      <div class="reporting-status-actions">
        ${meeting.kind === 'did' ? `<label class="reporting-demo-toggle"><input type="checkbox" data-reporting-demo="${item.task_id}" ${didDemo ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>На демо ДИД</span></label>` : ''}
        ${meeting.kind === 'directorate' ? `<label class="reporting-attention-toggle${directorateAttention ? ' is-active' : ''}"><input type="checkbox" data-reporting-attention="${item.task_id}" ${directorateAttention ? 'checked' : ''} ${editable ? '' : 'disabled'}><i data-lucide="star"></i><span>Показать лидеру трайба</span></label>` : ''}
        ${editable ? `<button type="button" class="btn ${isReady ? 'btn-secondary' : 'btn-primary'} btn-sm" data-save-reporting-task="${item.task_id}" ${draft || (!isReady && text.trim()) ? '' : 'disabled'}><i data-lucide="badge-check"></i>${draft && isReady ? 'Сохранить' : isReady ? 'Готово' : 'Подтвердить готовность'}</button>` : ''}
      </div>
    </div>
  </article>`;
}

function renderPreparation() {
  const content = document.getElementById('reporting-status-content');
  if (!content || !workspaceState) return;
  const meeting = selectedMeeting();
  const data = workspaceState.data;
  const summary = data?.summary || { total_tasks: 0, filled_tasks: 0, missing_tasks: 0 };
  const items = filteredItems();
  const confirmableCount = confirmableReportingStatusIds(data?.items, workspaceState.dirty).length;
  const percent = summary.total_tasks ? Math.round(summary.filled_tasks / summary.total_tasks * 100) : 0;
  const readOnly = data?.scope?.read_only || !(data?.items || []).some(item => item.can_edit);
  content.innerHTML = `${renderMeetingTabs()}
    <section class="reporting-preparation" aria-busy="false">
      <h2 class="sr-only">${escapeHtml(meeting?.title || '')} · ${escapeHtml(formatMeetingDate(meeting?.scheduled_date))}</h2>
      ${meeting?.state === 'date_pending' ? `<div class="reporting-status-notice"><i data-lucide="calendar-clock"></i><span>Проектный офис ещё не назначил дату. Статусы можно будет изменять после планирования встречи.</span></div>` : ''}
      ${readOnly && meeting?.state !== 'date_pending' ? `<div class="reporting-status-notice"><i data-lucide="eye"></i><span>Для вашей роли доступен срез статусов без редактирования.</span></div>` : ''}
      <div class="reporting-status-toolbar">
        <label class="reporting-status-search"><i data-lucide="search"></i><span class="sr-only">Поиск задач</span><input class="input" type="search" data-reporting-search placeholder="Поиск по ID или названию" value="${escapeHtml(workspaceState.search)}"></label>
        <button type="button" class="btn btn-secondary btn-sm reporting-status-missing${workspaceState.missingOnly ? ' is-active' : ''}" data-reporting-missing aria-pressed="${workspaceState.missingOnly}"><i data-lucide="alert-circle"></i>Только без статуса <span>${summary.missing_tasks}</span></button>
        <span class="reporting-status-result">${items.length} из ${summary.total_tasks} задач</span>
        <div class="reporting-readiness" style="--readiness:${percent}%" aria-label="Готовность статусов: ${percent}%"><strong>${percent}%</strong><span>${summary.filled_tasks} из ${summary.total_tasks} готово</span></div>
        ${readOnly ? '' : `<div class="reporting-status-bulk"><span data-reporting-dirty>${workspaceState.dirty.size ? `Изменено: ${workspaceState.dirty.size}` : 'Все изменения сохранены'}</span><button type="button" class="btn btn-secondary btn-sm" data-save-reporting-all ${workspaceState.dirty.size ? '' : 'disabled'}><i data-lucide="save"></i>Сохранить все</button><button type="button" class="btn btn-primary btn-sm" data-confirm-reporting-all ${confirmableCount ? '' : 'disabled'}><i data-lucide="badge-check"></i>Подтвердить все</button></div>`}
      </div>
      <div class="reporting-task-status-list">${items.length ? items.map(item => renderStatusCard(item, meeting)).join('') : renderViewState({ kind: 'empty', title: 'Задачи не найдены', message: 'Измените поиск или отключите фильтр.' })}</div>
    </section>`;
  window.lucide?.createIcons();
}

async function loadPreparation(app) {
  const content = document.getElementById('reporting-status-content');
  const meeting = selectedMeeting();
  if (!content || !meeting) return;
  content.innerHTML = `${renderMeetingTabs()}<div class="reporting-preparation">${renderViewState({ kind: 'loading', title: 'Загружаем статусы команды…' })}</div>`;
  window.lucide?.createIcons();
  try {
    workspaceState.data = await app.api.get(`/reporting-meetings/${meeting.id}/preparation`);
    workspaceState.dirty.clear();
    workspaceState.recentlySavedIds.clear();
    renderPreparation();
  } catch (error) {
    content.innerHTML = `${renderMeetingTabs()}<div class="reporting-preparation">${renderViewState({ kind: 'error', title: error?.status === 403 ? 'Нет доступа к заполнению' : 'Не удалось загрузить статусы', message: formatErrorMessage(error), actionLabel: error?.status === 403 ? '' : 'Повторить' })}</div>`;
    if (error?.status !== 403) bindViewStateAction(content, () => loadPreparation(app));
    window.lucide?.createIcons();
  }
}

function captureDraft(taskId, { preserveReadiness = false } = {}) {
  const root = document.getElementById('reporting-status-workspace');
  const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
  const text = root?.querySelector(`[data-reporting-text="${taskId}"]`)?.value || '';
  const didDemo = Boolean(root?.querySelector(`[data-reporting-demo="${taskId}"]`)?.checked);
  const directorateAttention = Boolean(root?.querySelector(`[data-reporting-attention="${taskId}"]`)?.checked);
  workspaceState.dirty.set(taskId, {
    text,
    did_demo: didDemo,
    directorate_attention: directorateAttention,
    is_ready: preserveReadiness ? Boolean(item?.is_ready) : false,
  });
  root?.querySelector(`[data-reporting-task="${taskId}"]`)?.classList.add('is-dirty');
  const button = root?.querySelector(`[data-save-reporting-task="${taskId}"]`);
  if (button) button.disabled = !text.trim();
  const all = root?.querySelector('[data-save-reporting-all]');
  if (all) all.disabled = false;
  const confirmableCount = confirmableReportingStatusIds(workspaceState.data.items, workspaceState.dirty).length;
  const confirmAll = root?.querySelector('[data-confirm-reporting-all]');
  if (confirmAll) confirmAll.disabled = confirmableCount === 0;
  const dirty = root?.querySelector('[data-reporting-dirty]');
  if (dirty) dirty.textContent = `Изменено: ${workspaceState.dirty.size}`;
  if (item) item._draft = true;
}

function updateSummaryInState() {
  const items = workspaceState.data.items;
  const filled = items.filter(item => item.is_ready).length;
  workspaceState.data.summary = { total_tasks: items.length, filled_tasks: filled, missing_tasks: items.length - filled };
}

async function saveTaskStatus(app, taskId, { render = true } = {}) {
  const draft = workspaceState.dirty.get(taskId);
  const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
  const meeting = selectedMeeting();
  const card = document.querySelector(`[data-reporting-task="${taskId}"]`);
  if (!draft || !item || !meeting) return false;
  const button = card?.querySelector('[data-save-reporting-task]');
  const errorNode = card?.querySelector('[data-reporting-error]');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  if (errorNode) errorNode.textContent = '';
  try {
    const result = await app.api.put(`/tasks/${taskId}/reporting-statuses/${meeting.id}`, { ...draft, version: Number(card?.dataset.version || item.version || 0) });
    item.text = result.text || '';
    item.did_demo = Boolean(result.did_demo);
    item.is_ready = Boolean(result.is_ready);
    item.directorate_attention = Boolean(result.directorate_attention);
    item.version = result.version || 0;
    item.updated_at = result.updated_at;
    item.updated_by_name = app.store.get('currentUser')?.name || '';
    item.filled = item.is_ready;
    delete item._draft;
    delete item._saveError;
    workspaceState.dirty.delete(taskId);
    workspaceState.recentlySavedIds.add(taskId);
    updateSummaryInState();
    if (render) renderPreparation();
    return true;
  } catch (error) {
    item._saveError = error?.status === 409 ? 'Статус уже изменён. Обновите страницу перед повтором.' : formatErrorMessage(error);
    if (errorNode) errorNode.textContent = item._saveError;
    window.toast?.(error?.status === 409 ? 'Конфликт версий: черновик остался в форме' : formatErrorMessage(error), 'error');
    return false;
  } finally {
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

async function saveStatusBatch(app, ids, successMessage) {
  let saved = 0;
  for (const taskId of ids) {
    if (await saveTaskStatus(app, taskId, { render: false })) saved += 1;
  }
  renderPreparation();
  if (saved) window.toast?.(`${successMessage}: ${saved}`, 'success');
}

export async function initReportingStatuses(app) {
  const root = document.getElementById('reporting-status-workspace');
  if (!root) return;
  const pageScroller = root.closest('.main-content');
  if (pageScroller) pageScroller.scrollTop = 0;
  const params = routeParams();
  workspaceState = { meetings: [], selectedMeetingId: null, data: null, dirty: new Map(), recentlySavedIds: new Set(), search: '', missingOnly: false };
  try {
    const response = await app.api.get('/reporting-meetings?include_closed=false&include_completeness=false');
    workspaceState.meetings = currentMeetings(response.items || []);
    if (!workspaceState.meetings.length) {
      root.querySelector('#reporting-status-content').innerHTML = renderViewState({ kind: 'empty', title: 'Нет встреч для подготовки', message: 'Проектный офис ещё не сформировал ближайший календарь.' });
      return;
    }
    const requestedId = Number(params.get('meeting_id'));
    const requestedKind = params.get('kind');
    const selected = workspaceState.meetings.find(item => item.id === requestedId)
      || workspaceState.meetings.find(item => item.kind === requestedKind)
      || workspaceState.meetings[0];
    workspaceState.selectedMeetingId = selected.id;
    await loadPreparation(app);
  } catch (error) {
    const content = root.querySelector('#reporting-status-content');
    content.innerHTML = renderViewState({ kind: 'error', title: 'Не удалось загрузить встречи', message: formatErrorMessage(error), actionLabel: 'Повторить' });
    bindViewStateAction(content, () => initReportingStatuses(app));
  }

  root.addEventListener('click', async event => {
    const meetingTab = event.target.closest('[data-reporting-meeting]');
    if (meetingTab && Number(meetingTab.dataset.reportingMeeting) !== workspaceState.selectedMeetingId) {
      if (!(await confirmReportingStatusNavigation())) return;
      workspaceState.selectedMeetingId = Number(meetingTab.dataset.reportingMeeting);
      workspaceState.data = null;
      await loadPreparation(app);
      return;
    }
    if (event.target.closest('[data-reporting-missing]')) {
      workspaceState.recentlySavedIds.clear();
      workspaceState.missingOnly = !workspaceState.missingOnly;
      renderPreparation();
      return;
    }
    const openTask = event.target.closest('[data-open-reporting-task]');
    if (openTask) {
      document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(openTask.dataset.openReportingTask), tab: 'rep' } }));
      return;
    }
    const save = event.target.closest('[data-save-reporting-task]');
    if (save) {
      const taskId = Number(save.dataset.saveReportingTask);
      const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
      let draft = workspaceState.dirty.get(taskId);
      if (!draft && item) {
        draft = { text: item.text || '', did_demo: Boolean(item.did_demo), directorate_attention: Boolean(item.directorate_attention), is_ready: false };
        workspaceState.dirty.set(taskId, draft);
      }
      if (draft) draft.is_ready = true;
      await saveTaskStatus(app, taskId);
      return;
    }
    const confirmAll = event.target.closest('[data-confirm-reporting-all]');
    if (confirmAll) {
      confirmAll.disabled = true;
      confirmAll.setAttribute('aria-busy', 'true');
      const ids = confirmableReportingStatusIds(workspaceState.data.items, workspaceState.dirty);
      ids.forEach(taskId => {
        const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
        let draft = workspaceState.dirty.get(taskId);
        if (!draft && item) {
          draft = { text: item.text || '', did_demo: Boolean(item.did_demo), directorate_attention: Boolean(item.directorate_attention), is_ready: false };
          workspaceState.dirty.set(taskId, draft);
        }
        if (draft) draft.is_ready = true;
      });
      await saveStatusBatch(app, ids, 'Подтверждено статусов');
      return;
    }
    const saveAll = event.target.closest('[data-save-reporting-all]');
    if (saveAll) {
      saveAll.disabled = true;
      saveAll.setAttribute('aria-busy', 'true');
      const ids = [...workspaceState.dirty.keys()];
      await saveStatusBatch(app, ids, 'Сохранено статусов');
      return;
    }
  });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-reporting-text]')) captureDraft(Number(event.target.dataset.reportingText));
    if (event.target.matches('[data-reporting-search]')) {
      workspaceState.search = event.target.value.trim();
      const cards = root.querySelector('.reporting-task-status-list');
      if (cards) cards.innerHTML = filteredItems().map(item => renderStatusCard(item, selectedMeeting())).join('') || renderViewState({ kind: 'empty', title: 'Задачи не найдены' });
      window.lucide?.createIcons();
    }
  });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-reporting-demo]')) captureDraft(Number(event.target.dataset.reportingDemo));
    if (event.target.matches('[data-reporting-attention]')) captureDraft(
      Number(event.target.dataset.reportingAttention),
      { preserveReadiness: true },
    );
  });
}
