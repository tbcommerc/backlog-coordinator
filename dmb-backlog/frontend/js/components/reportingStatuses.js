import { safeBacklogReturn } from '../backlogRouteState.js';
import { filterValues, filterMatches } from '../ui/filterValues.js';
import { tabNavigationTarget } from '../ui/controls.js';
import { loadMore } from '../ui/specialized.js';
import { notificationReturnHref } from '../notificationUtils.js';
import { escapeHtml } from '../htmlUtils.js';
import { confirmAction, formatErrorMessage } from '../uiFeedback.js';
import { renderViewState, bindViewStateAction } from './viewState.js';

const ALLOWED_ROLES = new Set(['po/pl/cl', 'ba/участник команды']);
const MEETING_META = {
  team_weekly: { label: 'Еженедельная встреча команды', icon: 'calendar-range' },
  directorate: { label: 'Директорская оперативка', icon: 'briefcase' },
  did: { label: 'Оперативка ДИД', icon: 'layers' },
  key_projects: { label: 'Ключевые проекты', icon: 'key-round' },
};
const PAGE_SIZE = 50;

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
  const raw=new URLSearchParams(globalThis.window?.location?.hash?.split('?')[1]||'').get('return_to');
  if(raw){const target=safeBacklogReturn(raw,null);if(target)return {href:target,label:'В бэклог'};}

  if (source === 'team-backlog') return { href: '#/team-backlog', label: 'В бэклог команды' };
  if (source === 'report') return { href: '#/reports', label: 'К отчётам' };
  if (source === 'notification') return { href: notificationReturnHref(), label: 'К уведомлениям' };
  return { href: '#/team-backlog', label: 'В бэклог команды' };
}

export function renderReportingStatuses(app) {
  const user = app.store.get('currentUser');
  const isAdmin = user?.permissions?.admin === 'full';
  const back = sourceBackLink(routeParams().get('source'));
  return `<section class="modal-overlay reporting-status-workspace animate-fade-in" id="reporting-status-workspace" aria-labelledby="reporting-status-title">
    <div class="reporting-status-dialog">
      <header class="reporting-status-hero">
        <div class="reporting-status-heading">
          <div><h1 id="reporting-status-title">Статусы к отчётным встречам</h1><p>${isAdmin ? 'Просмотрите, обновите и подтвердите готовность статусов всех команд в одном окне.' : 'Обновите и подтвердите готовность статусов задач своей команды до начала встречи.'}</p></div>
        </div>
        <div class="reporting-status-header-actions">
          <div class="reporting-status-scope"><i data-lucide="users"></i><span>${escapeHtml(isAdmin ? 'Все команды' : (user?.team_name || 'Ваша команда'))}</span><small>${escapeHtml(user?.role_name || '')}</small></div>
          <a class="btn btn-ghost btn-lg square-icon ui-btn reporting-status-close" data-modal-close href="${back.href}" title="${escapeHtml(back.label)}"><i data-lucide="x"></i></a>
        </div>
      </header>
      <div id="reporting-status-content" class="reporting-status-content">
        ${renderViewState({ kind: 'loading', title: 'Загружаем ближайшие встречи…' })}
      </div>
    </div>
  </section>`;
}

export async function confirmReportingStatusNavigation() {
  if (workspaceState?.saving) return false;
  if (!workspaceState?.dirty?.size || !document.getElementById('reporting-status-workspace')) return true;
  const confirmed = await confirmAction({
    title: 'Есть несохранённые статусы',
    message: `Изменено задач: ${workspaceState.dirty.size}. Перейти и потерять черновики?`,
    confirmText: 'Не сохранять', cancelText: 'Продолжить редактирование', destructive: true,
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
    const timing = meeting.is_overdue ? 'Просрочена' : meeting.state === 'date_pending' ? 'Нужна дата' : '';
    return `<button type="button" role="tab" id="reporting-meeting-tab-${meeting.id}" aria-controls="reporting-preparation-panel" aria-selected="${active}" tabindex="${active ? '0' : '-1'}" class="btn btn-secondary btn-sm ui-btn ui-tab reporting-meeting-tab${active ? ' is-active' : ''}${meeting.is_overdue ? ' is-overdue' : ''}" data-reporting-meeting="${meeting.id}">
      <i data-lucide="${meta.icon}"></i><span><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(formatMeetingDate(meeting.scheduled_date))}</small></span>
      ${timing ? `<em>${timing}</em>` : ''}
    </button>`;
  }).join('')}</div>`;
}

export function filterReportingStatusItems(items, { search = '', missingOnly = false, recentlySavedIds = new Set(), teamId = '', readiness = 'all', dirty = new Map() } = {}) {
  const query = String(search || '').toLocaleLowerCase('ru-RU');
  return (items || []).filter(item => {
    if (missingOnly && item.filled && !recentlySavedIds.has(item.task_id)) return false;
    if (!filterMatches(teamId,item.team_id)) return false;
    const draft = dirty.get(item.task_id);
    const text = draft ? draft.text : item.text;
    const ready = draft ? Boolean(draft.is_ready) : Boolean(item.is_ready);
    const states=filterValues(readiness);
    const matches=states.some(value=>value==='all'||value==='needs'&&(!ready||recentlySavedIds.has(item.task_id))||value==='drafts'&&!ready&&Boolean(String(text||'').trim())||value==='ready'&&ready);
    if (states.length&&!matches) return false;
    if (!query) return true;
    return [item.public_id, item.title, item.team_name].some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
  });
}

export function confirmableReportingStatusIds(items, dirty = new Map()) {
  return (items || []).filter(item => {
    const draft = dirty.get(item.task_id);
    const text = draft ? draft.text : item.text;
    const isReady = draft ? Boolean(draft.is_ready) : Boolean(item.is_ready);
    const weekly = draft?.weekly || item.weekly;
    const weeklyReady = !weekly || (
      Boolean(String(weekly.next_step || '').trim())
      && (weekly.signal !== 'decision' || Boolean(String(weekly.decision_request || '').trim()))
    );
    return Boolean(item.can_edit && !isReady && String(text || '').trim() && weeklyReady);
  }).map(item => item.task_id);
}

function filteredItems() {
  return filterReportingStatusItems(workspaceState.data?.items, {
    ...workspaceState,
    teamId: workspaceState.teamId,
    readiness: workspaceState.readiness,
    dirty: workspaceState.dirty,
  });
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
  const previousOpen = typeof window === 'undefined' || !window.matchMedia?.('(max-width: 560px)').matches ? ' open' : '';
  const isWeekly = meeting.kind === 'team_weekly';
  const weekly = draft?.weekly || item.weekly || { signal: 'on_track', next_step: '', next_step_due: '', decision_request: '' };
  const weeklyReady = !isWeekly || (
    Boolean(String(weekly.next_step || '').trim())
    && (weekly.signal !== 'decision' || Boolean(String(weekly.decision_request || '').trim()))
  );
  const canConfirm = Boolean(!isReady && text.trim() && weeklyReady);
  const weeklyFields = isWeekly ? `<div class="reporting-weekly-fields">
    <label><span>Сигнал встречи</span><select class="input" data-reporting-weekly-signal="${item.task_id}" ${editable ? '' : 'disabled'}>
      <option value="on_track" ${weekly.signal === 'on_track' ? 'selected' : ''}>Всё по плану</option>
      <option value="risk" ${weekly.signal === 'risk' ? 'selected' : ''}>Риск</option>
      <option value="blocker" ${weekly.signal === 'blocker' ? 'selected' : ''}>Блокер</option>
      <option value="decision" ${weekly.signal === 'decision' ? 'selected' : ''}>Нужно решение</option>
    </select></label>
    <label class="reporting-weekly-next"><span>Следующий шаг</span><input class="input" data-reporting-weekly-next="${item.task_id}" maxlength="2000" value="${escapeHtml(weekly.next_step || '')}" placeholder="Одно проверяемое действие" ${editable ? '' : 'disabled'}></label>
    <label><span>Срок шага</span><input class="input" type="date" data-reporting-weekly-due="${item.task_id}" value="${escapeHtml(weekly.next_step_due || '')}" ${editable ? '' : 'disabled'}></label>
    <label class="reporting-weekly-decision" ${weekly.signal === 'decision' ? '' : 'hidden'}><span>Какое решение требуется</span><input class="input" data-reporting-weekly-decision="${item.task_id}" maxlength="2000" value="${escapeHtml(weekly.decision_request || '')}" placeholder="Сформулируйте вопрос для встречи" ${editable ? '' : 'disabled'}></label>
  </div>` : '';
  return `<article class="reporting-task-status${isWeekly ? ' is-weekly' : ''}${isReady ? ' is-filled' : ' is-missing'}${draft ? ' is-dirty' : ''}" data-reporting-task="${item.task_id}" data-version="${item.version || 0}">
    <div class="reporting-task-status-head">
      <button type="button" class="ui-link reporting-task-link" data-open-reporting-task="${item.task_id}"><span>${escapeHtml(item.public_id)}</span><strong>${escapeHtml(item.title || 'Без названия')}</strong><i data-lucide="arrow-up-right"></i></button>
      <span class="reporting-task-state"><i data-lucide="${isReady ? 'badge-check' : 'circle-dashed'}"></i>${draft ? 'Изменено · требует подтверждения' : isReady ? 'Готово' : 'Не подтверждено'}</span>
    </div>
    <details class="reporting-previous-status"${previousOpen}><summary class="ui-disclosure-text">Предыдущая встреча${previous?.meeting_date ? ` · ${escapeHtml(formatMeetingDate(previous.meeting_date))}` : ''}</summary><p>${previous?.text ? escapeHtml(previous.text) : 'Статус не предоставлялся'}</p></details>
    <label class="reporting-status-editor"><span class="reporting-status-editor-label">${isWeekly ? 'Результат недели' : 'Статус к выбранной встрече'}</span><textarea class="input" rows="4" maxlength="5000" data-reporting-text="${item.task_id}" placeholder="${isWeekly ? 'Что реально изменилось за неделю' : 'Результат · Риски и блокеры · Следующий шаг и срок'}" ${editable ? '' : 'disabled'}>${escapeHtml(text)}</textarea><small class="reporting-status-counter" data-reporting-counter="${item.task_id}">${String(text).length} / 5000</small></label>
    ${weeklyFields}
    <div class="reporting-task-status-footer">
      <div class="reporting-workspace-meta"><span>${escapeHtml(formatUpdated(item.updated_at))}${item.updated_by_name ? ` · ${escapeHtml(item.updated_by_name)}` : ''}</span><span data-reporting-error="${item.task_id}" role="alert">${escapeHtml(item._saveError || '')}</span></div>
      <div class="reporting-status-actions">
        ${meeting.kind === 'did' ? `<label class="reporting-demo-toggle"><input type="checkbox" data-reporting-demo="${item.task_id}" ${didDemo ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>На демо ДИД</span></label>` : ''}
        ${meeting.kind === 'directorate' ? `<label class="reporting-attention-toggle${directorateAttention ? ' is-active' : ''}"><input type="checkbox" aria-label="Показать лидеру трайба" data-reporting-attention="${item.task_id}" ${directorateAttention ? 'checked' : ''} ${editable ? '' : 'disabled'}><i data-lucide="star"></i><span>Показать лидеру трайба</span></label>` : ''}
        ${editable ? `<button type="button" class="btn ${draft || !isReady ? 'btn-primary' : 'btn-secondary'} btn-sm" data-save-reporting-task="${item.task_id}" ${draft ? (text.trim() && weeklyReady ? '' : 'disabled') : (canConfirm ? '' : 'disabled')}><i data-lucide="badge-check"></i>${draft || !isReady ? 'Сохранить и подтвердить' : 'Готово'}</button>` : ''}
      </div>
    </div>
  </article>`;
}

function renderTaskListContent(items, meeting) {
  if (!items.length) return renderViewState({ kind: 'empty', title: 'Задачи не найдены', message: 'Измените поиск или фильтры.' });
  const visibleItems = items.slice(0, workspaceState.visibleLimit);
  const more = visibleItems.length < items.length
    ? loadMore({loaded:visibleItems.length,total:items.length,attrs:{class:'reporting-status-load-more','data-reporting-load-more':''}})
    : '';
  return `${visibleItems.map(item => renderStatusCard(item, meeting)).join('')}${more}`;
}

function renderPreparation() {
  const content = document.getElementById('reporting-status-content');
  if (!content || !workspaceState) return;
  const meeting = selectedMeeting();
  const data = workspaceState.data;
  const summary = data?.summary || { total_tasks: 0, filled_tasks: 0, missing_tasks: 0 };
  const items = filteredItems();
  const confirmableCount = confirmableReportingStatusIds(items, workspaceState.dirty).length;
  const percent = summary.total_tasks ? Math.round(summary.filled_tasks / summary.total_tasks * 100) : 0;
  const readOnly = data?.scope?.read_only || !(data?.items || []).some(item => item.can_edit);
  content.innerHTML = `${renderMeetingTabs()}
    <section class="reporting-preparation" id="reporting-preparation-panel" role="tabpanel" aria-labelledby="reporting-meeting-tab-${meeting?.id}" aria-busy="false">
      <h2 class="sr-only">${escapeHtml(meeting?.title || '')} · ${escapeHtml(formatMeetingDate(meeting?.scheduled_date))}</h2>
      ${meeting?.state === 'date_pending' ? `<div class="reporting-status-notice"><i data-lucide="calendar-clock"></i><span>Проектный офис ещё не назначил дату. Статусы можно будет изменять после планирования встречи.</span></div>` : ''}
      ${meeting?.is_overdue ? `<div class="reporting-status-notice is-danger"><i data-lucide="alert-triangle"></i><span><strong>Встреча просрочена.</strong> Проектному офису нужно подтвердить факт проведения, перенести или отменить её.</span><a class="btn btn-secondary btn-sm" href="#/reporting-meetings">Управление встречами</a></div>` : ''}
      ${readOnly && meeting?.state !== 'date_pending' ? `<div class="reporting-status-notice"><i data-lucide="eye"></i><span>Для вашей роли доступен срез статусов без редактирования.</span></div>` : ''}
      <div class="reporting-status-toolbar">
        <label class="reporting-status-search"><i data-lucide="search"></i><span class="sr-only">Поиск задач</span><input class="input" type="search" data-reporting-search placeholder="Поиск по ID или названию" value="${escapeHtml(workspaceState.search)}"></label>
        ${workspaceState.isAdmin ? `<label class="reporting-status-team"><span class="sr-only">Команда</span><select class="input" data-reporting-team data-ui-filter-value="${escapeHtml(workspaceState.teamId)}"><option value="">Все команды</option>${workspaceState.teams.map(team => `<option value="${team.id}" ${String(workspaceState.teamId) === String(team.id) ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('')}</select></label>` : `<span class="reporting-status-team reporting-status-team-summary">${escapeHtml(data?.scope?.team_name || 'Ваша команда')}</span>`}
        <label class="reporting-status-readiness-select"><span class="sr-only">Состояние статуса</span><select class="input" data-reporting-readiness data-ui-filter-value="${escapeHtml(workspaceState.readiness)}"><option value="needs" ${workspaceState.readiness === 'needs' ? 'selected' : ''}>Требуют подтверждения</option><option value="drafts" ${workspaceState.readiness === 'drafts' ? 'selected' : ''}>Черновики</option><option value="ready" ${workspaceState.readiness === 'ready' ? 'selected' : ''}>Готовы</option><option value="all" ${workspaceState.readiness === 'all' ? 'selected' : ''}>Все статусы</option></select></label>
        <span class="reporting-status-result">${items.length} из ${summary.total_tasks} задач</span>
        <div class="reporting-readiness" style="--readiness:${percent}%" aria-label="Готовность статусов: ${percent}%"><strong>${percent}%</strong><span>${summary.filled_tasks} из ${summary.total_tasks} готово</span></div>
        ${readOnly ? '' : `<div class="reporting-status-bulk"><span data-reporting-dirty aria-live="polite">${workspaceState.dirty.size ? `Изменено: ${workspaceState.dirty.size}` : 'Все изменения сохранены'}</span><button type="button" class="btn btn-secondary" data-save-reporting-all ${workspaceState.dirty.size ? '' : 'disabled'}><i data-lucide="save"></i>Сохранить черновики</button><button type="button" class="btn btn-primary" data-confirm-reporting-all ${confirmableCount ? '' : 'disabled'}><i data-lucide="badge-check"></i>Сохранить и подтвердить${confirmableCount ? ` · ${confirmableCount}` : ''}</button></div>`}
      </div>
      <div class="reporting-task-status-list">${renderTaskListContent(items, meeting)}</div>
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
    workspaceState.teams = [...new Map((workspaceState.data.items || [])
      .filter(item => item.team_id)
      .map(item => [item.team_id, { id: item.team_id, name: item.team_name || `Команда ${item.team_id}` }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    workspaceState.visibleLimit = PAGE_SIZE;
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
  const signal = root?.querySelector(`[data-reporting-weekly-signal="${taskId}"]`)?.value;
  const weekly = signal ? {
    signal,
    next_step: root?.querySelector(`[data-reporting-weekly-next="${taskId}"]`)?.value || '',
    next_step_due: root?.querySelector(`[data-reporting-weekly-due="${taskId}"]`)?.value || null,
    decision_request: root?.querySelector(`[data-reporting-weekly-decision="${taskId}"]`)?.value || '',
  } : null;
  workspaceState.dirty.set(taskId, {
    text,
    did_demo: didDemo,
    directorate_attention: directorateAttention,
    weekly,
    is_ready: preserveReadiness ? Boolean(item?.is_ready) : false,
  });
  const card = root?.querySelector(`[data-reporting-task="${taskId}"]`);
  card?.classList.add('is-dirty');
  card?.classList.remove('is-filled');
  const state = card?.querySelector('.reporting-task-state');
  if (state) state.innerHTML = '<i data-lucide="pencil-line"></i>Изменено · требует подтверждения';
  const counter = root?.querySelector(`[data-reporting-counter="${taskId}"]`);
  if (counter) counter.textContent = `${text.length} / 5000`;
  const button = root?.querySelector(`[data-save-reporting-task="${taskId}"]`);
  if (button) {
    button.disabled = !text.trim()
      || Boolean(weekly && !weekly.next_step.trim())
      || Boolean(weekly?.signal === 'decision' && !weekly.decision_request.trim());
    button.classList.remove('btn-secondary');
    button.classList.add('btn-primary');
    button.innerHTML = '<i data-lucide="badge-check"></i>Сохранить и подтвердить';
  }
  const all = root?.querySelector('[data-save-reporting-all]');
  if (all) all.disabled = false;
  const confirmableCount = confirmableReportingStatusIds(filteredItems(), workspaceState.dirty).length;
  const confirmAll = root?.querySelector('[data-confirm-reporting-all]');
  if (confirmAll) confirmAll.disabled = confirmableCount === 0;
  const dirty = root?.querySelector('[data-reporting-dirty]');
  if (dirty) dirty.textContent = `Изменено: ${workspaceState.dirty.size}`;
  if (item) item._draft = true;
  window.lucide?.createIcons();
}

function updateSummaryInState() {
  const items = workspaceState.data.items;
  const filled = items.filter(item => item.is_ready).length;
  workspaceState.data.summary = { total_tasks: items.length, filled_tasks: filled, missing_tasks: items.length - filled };
}

function refreshWorkspaceIndicators() {
  const summary = workspaceState.data.summary;
  const items = filteredItems();
  const percent = summary.total_tasks ? Math.round(summary.filled_tasks / summary.total_tasks * 100) : 0;
  const readiness = document.querySelector('.reporting-readiness');
  if (readiness) {
    readiness.style.setProperty('--readiness', `${percent}%`);
    readiness.setAttribute('aria-label', `Готовность статусов: ${percent}%`);
    const value = readiness.querySelector('strong');
    const caption = readiness.querySelector('span');
    if (value) value.textContent = `${percent}%`;
    if (caption) caption.textContent = `${summary.filled_tasks} из ${summary.total_tasks} готово`;
  }
  const result = document.querySelector('.reporting-status-result');
  if (result) result.textContent = `${items.length} из ${summary.total_tasks} задач`;
  const dirtyLabel = document.querySelector('[data-reporting-dirty]');
  if (dirtyLabel) dirtyLabel.textContent = workspaceState.dirty.size ? `Изменено: ${workspaceState.dirty.size}` : 'Все изменения сохранены';
  const saveAll = document.querySelector('[data-save-reporting-all]');
  if (saveAll) {
    saveAll.disabled = !workspaceState.dirty.size;
    saveAll.removeAttribute('aria-busy');
  }
  const confirmAll = document.querySelector('[data-confirm-reporting-all]');
  if (confirmAll) {
    const count = confirmableReportingStatusIds(items, workspaceState.dirty).length;
    confirmAll.disabled = !count;
    confirmAll.removeAttribute('aria-busy');
    confirmAll.innerHTML = `<i data-lucide="badge-check"></i>Сохранить и подтвердить${count ? ` · ${count}` : ''}`;
  }
}

function refreshSavedStatusCards(taskIds) {
  const meeting = selectedMeeting();
  taskIds.forEach(taskId => {
    const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
    const card = document.querySelector(`[data-reporting-task="${taskId}"]`);
    if (item && card) card.outerHTML = renderStatusCard(item, meeting);
  });
  refreshWorkspaceIndicators();
  window.lucide?.createIcons();
}

function applySavedStatus(app, result) {
  const item = workspaceState.data.items.find(candidate => candidate.task_id === result.task_id);
  if (!item) return;
  item.text = result.text || '';
  item.did_demo = Boolean(result.did_demo);
  item.is_ready = Boolean(result.is_ready);
  item.directorate_attention = Boolean(result.directorate_attention);
  item.weekly = result.weekly || null;
  item.version = result.version || 0;
  item.updated_at = result.updated_at;
  item.updated_by_name = app.store.get('currentUser')?.name || '';
  item.filled = item.is_ready;
  delete item._draft;
  delete item._saveError;
  workspaceState.dirty.delete(item.task_id);
  workspaceState.recentlySavedIds.add(item.task_id);
  return item;
}

function beginReportingSave() {
  if (workspaceState.saving) return null;
  workspaceState.saving = true;
  const root = document.getElementById('reporting-status-workspace');
  root?.setAttribute('aria-busy', 'true');
  const controls = [...(root?.querySelectorAll('button, input, select, textarea') || [])].map(control => [control, control.disabled]);
  controls.forEach(([control]) => { control.disabled = true; });
  return () => {
    workspaceState.saving = false;
    root?.removeAttribute('aria-busy');
    controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
  };
}

async function saveTaskStatus(app, taskId) {
  const draft = workspaceState.dirty.get(taskId);
  const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
  const meeting = selectedMeeting();
  const card = document.querySelector(`[data-reporting-task="${taskId}"]`);
  if (!draft || !item || !meeting) return false;
  const finishSave = beginReportingSave();
  if (!finishSave) return false;
  const button = card?.querySelector('[data-save-reporting-task]');
  const errorNode = card?.querySelector('[data-reporting-error]');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  if (errorNode) errorNode.textContent = '';
  try {
    const result = await app.api.put(`/tasks/${taskId}/reporting-statuses/${meeting.id}`, { ...draft, is_ready: true, version: Number(card?.dataset.version || item.version || 0) });
    applySavedStatus(app, result);
    updateSummaryInState();
    refreshSavedStatusCards([taskId]);
    window.toast?.('Статус сохранён и подтверждён', 'success');
    return true;
  } catch (error) {
    item._saveError = error?.status === 409 ? 'Статус уже изменён. Обновите страницу перед повтором.' : formatErrorMessage(error);
    if (errorNode) errorNode.textContent = item._saveError;
    window.toast?.(error?.status === 409 ? 'Конфликт версий: черновик остался в форме' : formatErrorMessage(error), 'error');
    return false;
  } finally {
    finishSave();
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

async function saveStatusBatch(app, ids, successMessage, { confirmReady = false } = {}) {
  const meeting = selectedMeeting();
  if (!meeting || !ids.length) return;
  const finishSave = beginReportingSave();
  if (!finishSave) return;
  const dirtyLabel = document.querySelector('[data-reporting-dirty]');
  if (dirtyLabel) dirtyLabel.textContent = `Сохраняем: ${ids.length}…`;
  try {
    const items = ids.map(taskId => {
      const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
      const draft = workspaceState.dirty.get(taskId);
      return { task_id: taskId, ...draft, ...(confirmReady ? { is_ready: true } : {}), version: Number(item?.version || 0) };
    });
    const result = await app.api.put(`/reporting-meetings/${meeting.id}/statuses/batch`, { items });
    (result.items || []).forEach(saved => applySavedStatus(app, saved));
    updateSummaryInState();
    refreshSavedStatusCards((result.items || []).map(saved => saved.task_id));
    window.toast?.(`${successMessage}: ${result.saved_count || result.items?.length || 0}`, 'success');
  } catch (error) {
    const message = error?.status === 409
      ? 'Пакет не сохранён: один из статусов уже изменён. Обновите страницу.'
      : formatErrorMessage(error);
    const currentDirtyLabel = document.querySelector('[data-reporting-dirty]');
    if (currentDirtyLabel) currentDirtyLabel.textContent = `Не сохранено: ${ids.length}`;
    window.toast?.(message, 'error');
  } finally {
    finishSave();
    const saveAll = document.querySelector('[data-save-reporting-all]');
    const confirmAll = document.querySelector('[data-confirm-reporting-all]');
    if (saveAll) {
      saveAll.disabled = !workspaceState.dirty.size;
      saveAll.removeAttribute('aria-busy');
    }
    if (confirmAll) {
      confirmAll.disabled = !confirmableReportingStatusIds(filteredItems(), workspaceState.dirty).length;
      confirmAll.removeAttribute('aria-busy');
    }
  }
}

function warnAboutReportingDrafts(event) {
  if (!workspaceState?.dirty?.size || !document.getElementById('reporting-status-workspace')) return;
  event.preventDefault();
  event.returnValue = '';
}

export async function initReportingStatuses(app) {
  const root = document.getElementById('reporting-status-workspace');
  if (!root) return;
  workspaceState?.listeners?.abort();
  const listeners = new AbortController();
  const pageScroller = root.closest('.main-content');
  if (pageScroller) pageScroller.scrollTop = 0;
  const params = routeParams();
  const user = app.store.get('currentUser');
  workspaceState = {
    meetings: [], selectedMeetingId: null, data: null, dirty: new Map(), recentlySavedIds: new Set(),
    search: '', missingOnly: false, readiness: 'needs', teamId: '', teams: [], visibleLimit: PAGE_SIZE,
    isAdmin: user?.permissions?.admin === 'full',
    listeners,
  };
  window.removeEventListener('beforeunload', warnAboutReportingDrafts);
  window.addEventListener('beforeunload', warnAboutReportingDrafts);
  try {
    const response = await app.api.get('/reporting-meetings?include_closed=false&include_completeness=false');
    workspaceState.meetings = currentMeetings(response.items || []);
    const requestedId = Number(params.get('meeting_id'));
    if (params.has('meeting_id') && !workspaceState.meetings.some(item => item.id === requestedId)) {
      root.querySelector('#reporting-status-content').innerHTML = renderViewState({ kind: 'empty', title: 'Встреча недоступна', message: 'Встреча по ссылке завершена, удалена или недоступна вам. Вернитесь к уведомлениям и выберите другое действие.' });
      return;
    }
    if (!workspaceState.meetings.length) {
      root.querySelector('#reporting-status-content').innerHTML = renderViewState({ kind: 'empty', title: 'Нет встреч для подготовки', message: 'Проектный офис ещё не сформировал ближайший календарь.' });
      return;
    }
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
    if (workspaceState.saving) { event.preventDefault(); return; }
    const meetingTab = event.target.closest('[data-reporting-meeting]');
    if (meetingTab && Number(meetingTab.dataset.reportingMeeting) !== workspaceState.selectedMeetingId) {
      if (!(await confirmReportingStatusNavigation())) return;
      workspaceState.selectedMeetingId = Number(meetingTab.dataset.reportingMeeting);
      workspaceState.data = null;
      await loadPreparation(app);
      root.querySelector(`[data-reporting-meeting="${workspaceState.selectedMeetingId}"]`)?.focus();
      return;
    }
    if (event.target.closest('[data-reporting-missing]')) {
      workspaceState.recentlySavedIds.clear();
      workspaceState.missingOnly = !workspaceState.missingOnly;
      renderPreparation();
      return;
    }
    if (event.target.closest('[data-reporting-load-more]')) {
      const firstNewIndex=workspaceState.visibleLimit;
      workspaceState.visibleLimit += PAGE_SIZE;
      const cards = root.querySelector('.reporting-task-status-list');
      if (cards) {cards.innerHTML = renderTaskListContent(filteredItems(), selectedMeeting());const next=cards.querySelectorAll('[data-reporting-task]')[firstNewIndex];const focus=next?.querySelector('button,textarea,input')||cards.querySelector('[data-reporting-load-more]')||next;if(focus){if(!focus.matches('button,textarea,input'))focus.tabIndex=-1;focus.focus();}}
      window.lucide?.createIcons();
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
        draft = { text: item.text || '', did_demo: Boolean(item.did_demo), directorate_attention: Boolean(item.directorate_attention), weekly: item.weekly || null, is_ready: false };
        workspaceState.dirty.set(taskId, draft);
      }
      await saveTaskStatus(app, taskId);
      return;
    }
    const confirmAll = event.target.closest('[data-confirm-reporting-all]');
    if (confirmAll) {
      const ids = confirmableReportingStatusIds(filteredItems(), workspaceState.dirty);
      ids.forEach(taskId => {
        const item = workspaceState.data.items.find(candidate => candidate.task_id === taskId);
        let draft = workspaceState.dirty.get(taskId);
        if (!draft && item) {
          draft = { text: item.text || '', did_demo: Boolean(item.did_demo), directorate_attention: Boolean(item.directorate_attention), weekly: item.weekly || null, is_ready: false };
          workspaceState.dirty.set(taskId, draft);
        }
      });
      await saveStatusBatch(app, ids, 'Подтверждено статусов', { confirmReady: true });
      return;
    }
    const saveAll = event.target.closest('[data-save-reporting-all]');
    if (saveAll) {
      const ids = [...workspaceState.dirty.keys()];
      await saveStatusBatch(app, ids, 'Сохранено статусов');
      return;
    }
  }, { signal: listeners.signal });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-reporting-text]')) captureDraft(Number(event.target.dataset.reportingText));
    if (event.target.matches('[data-reporting-weekly-next]')) captureDraft(Number(event.target.dataset.reportingWeeklyNext));
    if (event.target.matches('[data-reporting-weekly-decision]')) captureDraft(Number(event.target.dataset.reportingWeeklyDecision));
    if (event.target.matches('[data-reporting-search]')) {
      workspaceState.search = event.target.value.trim();
      workspaceState.visibleLimit = PAGE_SIZE;
      const cards = root.querySelector('.reporting-task-status-list');
      const items = filteredItems();
      if (cards) cards.innerHTML = renderTaskListContent(items, selectedMeeting());
      const result = root.querySelector('.reporting-status-result');
      if (result) result.textContent = `${items.length} из ${workspaceState.data.summary.total_tasks} задач`;
      window.lucide?.createIcons();
    }
  }, { signal: listeners.signal });
  root.addEventListener('change', event => {
    if (event.target.matches('[data-reporting-demo]')) captureDraft(Number(event.target.dataset.reportingDemo));
    if (event.target.matches('[data-reporting-attention]')) {
      event.target.closest('.reporting-attention-toggle')?.classList.toggle('is-active', event.target.checked);
      captureDraft(Number(event.target.dataset.reportingAttention), { preserveReadiness: true });
    }
    if (event.target.matches('[data-reporting-weekly-signal]')) {
      const card = event.target.closest('[data-reporting-task]');
      const decision = card?.querySelector('.reporting-weekly-decision');
      if (decision) decision.hidden = event.target.value !== 'decision';
      captureDraft(Number(event.target.dataset.reportingWeeklySignal));
    }
    if (event.target.matches('[data-reporting-weekly-due]')) {
      captureDraft(Number(event.target.dataset.reportingWeeklyDue));
    }
    if (event.target.matches('[data-reporting-team]')) {
      workspaceState.teamId = event.target.value;
      workspaceState.visibleLimit = PAGE_SIZE;
      renderPreparation();
    }
    if (event.target.matches('[data-reporting-readiness]')) {
      workspaceState.readiness = event.target.value;
      workspaceState.visibleLimit = PAGE_SIZE;
      renderPreparation();
    }
  }, { signal: listeners.signal });
  root.addEventListener('keydown', async event => {
    const tablist = event.target.closest('[role="tablist"]');
    const next = tablist && tabNavigationTarget(tablist, event);
    if (!next) return;
    event.preventDefault();
    tablist.querySelectorAll('[role="tab"]').forEach(tab => { tab.tabIndex = tab === next ? 0 : -1; });
    next.focus();
  }, { signal: listeners.signal });
}
