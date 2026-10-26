import { chartPalette, chartJsTheme, applyChartJsTheme, loadChartFont } from '../ui/charts.js';
import { createPopover } from '../ui/popover.js';
import { selectionList } from '../ui/selectionList.js';
import { button as uiButton, control as uiControl, field as uiField, pageHeader as uiPageHeader } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';
import { progress as uiProgress } from '../ui/dataDisplay.js';
/**
 * DMB Backlog - Reports Page
 */
import { renderDidBacklog, initDidBacklog } from './didBacklog.js?v=14';
import { renderDirectorateReport, initDirectorateReport } from './directorateReport.js?v=20';
import { escapeHtml } from '../htmlUtils.js';
import { bindViewStateAction, renderViewState } from './viewState.js';
import { formatTaskPublicId } from '../taskPublicId.js';
import { canUseReportingStatusWorkspace, reportingStatusHref } from './reportingStatuses.js?v=21';
import { quarterlyGoalsUpdateHref } from './quarterlyGoalsUpdate.js?v=11';

function renderInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  return Array.isArray(teams) ? teams.join(', ') : teams;
}

const reportConfig = {
  'team-weekly': {
    name: 'Еженедельная встреча команды',
    desc: 'Результаты недели, риски, решения и следующие шаги',
    icon: 'calendar-range',
    gradient: 'grad-teal',
    customEndpoint: '/reports/team-weekly-report',
    isCustom: true,
    hideCharts: true,
    fields: ['public_id','title','team_name','project_name','owner_name','status_name','progress','result','next_step','next_step_due','signal'],
    filters: []
  },
  directorate: {
    name: 'Статус для Директорской оперативки',
    desc: 'Еженедельный статус для доклада Лидеру трайба',
    icon: 'briefcase',
    gradient: 'grad-rose',
    customEndpoint: '/reports/directorate-report',
    isCustom: true,
    filters: [],
    fields: ['team_name','business_customer','department_name','project_name','title','task_type_name','owner_name','directorate_status'],
    group: null,
    sort: null
  },
  'did-operational': {
    name: 'Статус для оперативки ДИД',
    desc: 'Статус по задачам ЦИ и трайба для руководства ДИД',
    icon: 'layers',
    gradient: 'grad-indigo',
    customEndpoint: '/reports/did-operational-report',
    isCustom: true,
    filters: [],
    fields: ['team_name','id','involved_teams','business_customer','project_name','deadline_name','task_type_name','title','progress','did_demo','did_status'],
    group: null,
    sort: null
  },
  'reg-directors': {
    name: 'Отчет для Рег. директоров',
    desc: 'Статус по задачам для региональных директоров - пользователей IBP',
    icon: 'users',
    gradient: 'grad-violet',
    inDevelopment: true,
    isDb: true,
    key: 'reg-directors',
    fields: ['id','title','team_name','project_name','status_name','priority_name','financial_effect','progress']
  },
  pip: {
    name: 'PI-планирование трайба',
    desc: 'Очередь задач после экспресс-оценки: контекст, решение и следующий статус',
    icon: 'milestone',
    gradient: 'grad-amber',
    isDb: true,
    key: 'pip',
    filters: [],
    managedFields: true,
    hideCharts: true,
    fields: ['id','title','task_type_name','team_name','effort_days','effort_rub','financial_effect','cv','priority_score'],
    group: null,
    sort: null
  },
  'did-backlog': {
    name: 'Бэклог для отправки на бизнес-заказчиков ДИД',
    desc: 'Квартальный портфель задач и финансовый эффект для бизнес-заказчиков',
    icon: 'send', gradient: 'grad-slate', isCustom: true,
    customEndpoint: '/reports/did-backlog', fields: [], filters: []
  },
  'quarterly-goals': {
    name: 'Светофоры по квартальным целям',
    desc: 'Статус квартальных целей и AD-HOC-задач команд трайба',
    icon: 'trending-up',
    gradient: 'grad-cyan',
    isDb: true,
    key: 'quarterly-goals',
    managedFields: true,
    hideCharts: true,
    filters: [],
    fields: ['id','title','task_type_name','team_name','start_shift_name','planned_progress','progress','progress_deviation_percent','progress_indicator','progress_freshness_label'],
    group: null,
    sort: null
  },
  'pd-estimates': {
    name: 'Сбор оценок для PD',
    desc: 'Сбор оценок от бизнес-заказчиков по итогам выполнения квартальных задач',
    icon: 'clipboard-check',
    gradient: 'grad-emerald',
    inDevelopment: true,
    isPlaceholder: true
  }
};

let currentReport = null;
let tasksCache = [];
let cachedReportData = null;
let reportSortField = null;
let reportSortDir = 'asc';
let reportColumnFilters = {};
let pipQueueFilter = 'all';

let dbReportsCache = {};
let cachedDbReport = null;
let reportingMeetings = [];
let canManageReportingMeetings = false;
let canPrepareReportingMeetings = false;
let meetingView = 'cards';
let meetingFilters = { kind: 'all', state: 'open', from: '', to: '' };
let teamWeeklyFilter = 'attention';
let teamWeeklyTeamId = '';

const PIP_DECISION_META = {
  accept: {
    label: 'Принять в работу',
    icon: 'circle-check-big',
    tone: 'success',
    consequence: 'Задача перейдёт в статус «Принята в работу» и покинет очередь PI.',
    reasonLabel: 'Комментарий к решению',
    reasonPlaceholder: 'Например: согласованный PI, ограничения или ключевые договорённости',
  },
  rework: {
    label: 'Вернуть на оценку',
    icon: 'rotate-ccw',
    tone: 'warning',
    consequence: 'Задача вернётся в «Экспресс-оценку» своей команды. Причина сохранится в истории.',
    reasonLabel: 'Что нужно уточнить или переоценить',
    reasonPlaceholder: 'Опишите конкретные вопросы по объёму, трудозатратам или зависимостям',
  },
  reject: {
    label: 'Отклонить',
    icon: 'circle-x',
    tone: 'danger',
    consequence: 'Задача перейдёт в статус «Отклонена» и покинет рабочую очередь.',
    reasonLabel: 'Основание отклонения',
    reasonPlaceholder: 'Зафиксируйте основание, чтобы решение было понятно команде и заказчику',
  },
};

export function getPipDecisionGaps(task = {}) {
  const gaps = [];
  if (!(Number(task.effort_days) > 0)) gaps.push({ code: 'effort', label: 'Нет итоговых трудозатрат' });
  if (task.priority_score == null || Number.isNaN(Number(task.priority_score))) gaps.push({ code: 'priority', label: 'Нет Priority Score' });
  if (task.financial_effect == null || Number.isNaN(Number(task.financial_effect))) gaps.push({ code: 'effect', label: 'Нет финансового эффекта' });
  return gaps;
}

export function calculatePipDecisionSummary(tasks = []) {
  const rows = Array.isArray(tasks) ? tasks : [];
  const priorities = rows
    .filter(task => task.priority_score != null && task.priority_score !== '')
    .map(task => Number(task.priority_score))
    .filter(Number.isFinite);
  return {
    total: rows.length,
    contextReady: rows.filter(task => getPipDecisionGaps(task).length === 0).length,
    totalEffort: rows.reduce((sum, task) => sum + (Number(task.effort_days) || 0), 0),
    totalEffect: rows.reduce((sum, task) => sum + (Number(task.financial_effect) || 0), 0),
    averagePriority: priorities.length ? Math.round(priorities.reduce((sum, value) => sum + value, 0) / priorities.length) : null,
  };
}

export function buildPipDecisionPayload({ decision, version, reason = '' } = {}) {
  if (!Object.hasOwn(PIP_DECISION_META, decision)) throw new Error('Выберите решение по задаче');
  const normalizedReason = String(reason || '').trim();
  if (['rework', 'reject'].includes(decision) && !normalizedReason) {
    throw new Error('Укажите причину возврата или отклонения задачи');
  }
  return { decision, version: Number(version || 0), reason: normalizedReason || null };
}

const meetingStateLabels = {
  date_pending: 'Нужно назначить дату',
  planned: 'Запланирована',
  held: 'Состоялась',
  cancelled: 'Отменена',
};

const meetingKindMeta = {
  team_weekly: { cadence: 'Каждую неделю · понедельник', icon: 'calendar-range', tone: 'cyan' },
  directorate: { cadence: 'Еженедельно · понедельник', icon: 'briefcase', tone: 'violet' },
  did: { cadence: 'Раз в 2 недели · вторник', icon: 'layers', tone: 'emerald' },
  key_projects: { cadence: 'Раз в месяц · плавающая дата', icon: 'key-round', tone: 'blue' },
};

function meetingMatchesFilters(meeting) {
  const open = meeting.state === 'planned' || meeting.state === 'date_pending';
  if (meetingFilters.kind !== 'all' && meeting.kind !== meetingFilters.kind) return false;
  if (meetingFilters.state === 'open' && !open) return false;
  if (meetingFilters.state !== 'all' && meetingFilters.state !== 'open' && meeting.state !== meetingFilters.state) return false;
  if (meetingFilters.from && (!meeting.scheduled_date || meeting.scheduled_date < meetingFilters.from)) return false;
  if (meetingFilters.to && (!meeting.scheduled_date || meeting.scheduled_date > meetingFilters.to)) return false;
  return true;
}

function renderMeetingToolbar() {
  const filtersActive = meetingFilters.kind !== 'all' || meetingFilters.state !== 'open'
    || Boolean(meetingFilters.from) || Boolean(meetingFilters.to);
  return `<div class="meeting-toolbar" aria-label="Фильтры календаря">
    <div class="meeting-toolbar-filters">
      <label>Тип<select class="input" data-meeting-filter="kind">
        <option value="all">Все встречи</option><option value="team_weekly">Командная еженедельная</option><option value="directorate">Директорская</option>
        <option value="did">ДИД</option><option value="key_projects">Ключевые проекты</option>
      </select></label>
      <label>Состояние<select class="input" data-meeting-filter="state">
        <option value="open">Предстоящие</option><option value="all">Все</option><option value="planned">Запланированные</option>
        <option value="date_pending">Без даты</option><option value="held">Состоявшиеся</option><option value="cancelled">Отменённые</option>
      </select></label>
      <label>Дата с<input class="input" type="date" data-meeting-filter="from" value="${escapeHtml(meetingFilters.from)}"></label>
      <label>Дата по<input class="input" type="date" data-meeting-filter="to" value="${escapeHtml(meetingFilters.to)}"></label>
    </div>
    <div class="meeting-toolbar-actions">
      <div class="meeting-view-switch" role="group" aria-label="Представление календаря">
        <button class="btn btn-sm ${meetingView === 'cards' ? 'btn-primary' : 'btn-secondary'}" data-meeting-view="cards">Карточки</button>
        <button class="btn btn-sm ${meetingView === 'timeline' ? 'btn-primary' : 'btn-secondary'}" data-meeting-view="timeline">Хронология</button>
      </div>
      <button class="btn btn-secondary btn-sm" data-meeting-reset ${filtersActive ? '' : 'disabled'}><i data-lucide="refresh-ccw"></i> Сбросить</button>
    </div>
  </div>`;
}

function renderMeetingTimeline(items) {
  if (!items.length) return '<div class="empty-state">По заданным фильтрам встреч нет</div>';
  return `<div class="meeting-timeline">${items.map(meeting => {
    const meta = meetingKindMeta[meeting.kind] || { tone: 'blue' };
    const timelineState = meeting.is_overdue ? 'overdue' : meeting.state;
    return `<article class="meeting-timeline-item meeting-tone--${meta.tone} is-${timelineState}" data-meeting-row="${meeting.id}">
      <button class="ui-surface-action meeting-timeline-main" data-meeting-jump="${meeting.id}">
        <time>${escapeHtml(formatMeetingDate(meeting.scheduled_date))}</time>
        <span class="meeting-timeline-title"><span class="meeting-timeline-kind-icon" aria-hidden="true"><i data-lucide="${meta.icon || 'calendar-days'}"></i></span><strong>${escapeHtml(meeting.title)}</strong></span>
        <span class="meeting-timeline-status is-${timelineState}">${escapeHtml(meeting.is_overdue ? 'Просрочена — требуется актуализировать факт' : meetingStateLabels[meeting.state] || meeting.state)}</span>
      </button>
      <div class="meeting-timeline-actions">
        ${canManageReportingMeetings && meeting.kind !== 'team_weekly' && (meeting.state === 'planned' || meeting.state === 'date_pending')
          ? `<button class="btn btn-primary btn-sm" data-meeting-action="schedule" data-meeting-id="${meeting.id}">${meeting.scheduled_date ? 'Изменить дату' : 'Назначить дату'}</button>`
          : ''}
        <button class="btn btn-secondary btn-sm" data-meeting-action="prepare" data-meeting-id="${meeting.id}">Статусы</button>
        <button class="btn btn-secondary btn-sm" data-meeting-action="history" data-meeting-id="${meeting.id}">История</button>
        <a class="btn btn-secondary btn-sm ui-btn" href="#/work-reports?meeting_id=${meeting.id}">Снимок задач</a>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function getMeetingCards(items) {
  const openStates = new Set(['planned', 'date_pending']);
  if (meetingFilters.state === 'open' || meetingFilters.state === 'planned' || meetingFilters.state === 'date_pending') {
    return ['team_weekly', 'directorate', 'did', 'key_projects']
      .map(kind => items.find(item => item.kind === kind && openStates.has(item.state)))
      .filter(Boolean);
  }
  return [];
}

function formatMeetingDate(value) {
  if (!value) return 'Дата не назначена';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}

function formatMeetingShortDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${value}T12:00:00`))
    .replace('.', '');
}

function formatMeetingPrimaryDate(value) {
  if (!value) return 'Дата не назначена';
  const meetingDate = new Date(`${value}T12:00:00`);
  const options = { day: 'numeric', month: 'short' };
  if (meetingDate.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat('ru-RU', options).format(meetingDate).replace(/\sг\.$/, '');
}

function localDateIso() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function getUpcomingMeetingDates(kind, meeting) {
  const fromDate = meeting.scheduled_date || '';
  return reportingMeetings
    .filter(item => item.id !== meeting.id && item.kind === kind && item.state === 'planned' && item.scheduled_date && item.scheduled_date >= fromDate)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .slice(0, 2);
}

function renderUpcomingMeetingDates(meeting) {
  const dates = getUpcomingMeetingDates(meeting.kind, meeting);
  const planAction = canManageReportingMeetings && meeting.kind !== 'team_weekly'
    ? `<button type="button" class="btn btn-secondary btn-sm ui-btn meeting-plan-button" data-meeting-action="plan" data-meeting-id="${meeting.id}"><i data-lucide="calendar-plus"></i>Планировать график</button>`
    : '';
  const heading = `<div class="meeting-section-heading"><div class="meeting-section-label">Следующие встречи</div>${planAction}</div>`;
  if (!dates.length) {
    const hint = meeting.kind === 'team_weekly'
      ? 'Следующий недельный срез будет создан автоматически.'
      : meeting.kind === 'did'
      ? (meeting.scheduled_date ? 'Других встреч в ближайшие 90 дней нет.' : 'После назначения первой даты появится график на каждые две недели.')
      : 'Проектный офис назначает дату каждой ежемесячной встречи.';
    return `<div class="meeting-upcoming is-empty">${heading}<p>${escapeHtml(hint)}</p></div>`;
  }
  return `<div class="meeting-upcoming">
    ${heading}
    <div class="meeting-date-list">${dates.map(item => `
      <span class="meeting-date-chip"><i data-lucide="calendar-days"></i>${escapeHtml(formatMeetingShortDate(item.scheduled_date))}</span>`).join('')}</div>
  </div>`;
}

function renderReportingMeetingCard(meeting, historical = false) {
  const isOpen = meeting.state === 'planned' || meeting.state === 'date_pending';
  const meta = meetingKindMeta[meeting.kind] || { cadence: '', icon: 'calendar-days', tone: 'blue' };
  const localToday = localDateIso();
  const canComplete = meeting.state === 'planned' && Boolean(meeting.scheduled_date) && meeting.scheduled_date <= localToday;
  const completionSummary = meeting.total_tasks
    ? `${meeting.filled_tasks} из ${meeting.total_tasks}`
    : 'Нет активных задач';
  const missingSummary = !meeting.total_tasks
    ? 'Статусы не требуются'
    : (meeting.missing_tasks ? `${meeting.missing_tasks} без статуса` : 'Все заполнено');
  const completionPercent = meeting.total_tasks ? Math.round((meeting.filled_tasks / meeting.total_tasks) * 100) : 0;
  const warning = meeting.teams_without_recipients
    ? `<div class="meeting-warning">У ${meeting.teams_without_recipients} команд нет активного PO/PL/CL или BA/участника — напоминание некому отправить</div>`
    : '';
  const completeHint = !meeting.scheduled_date
    ? 'Сначала назначьте дату встречи'
    : `Подтверждение доступно с ${formatMeetingDate(meeting.scheduled_date)}`;
  const stateLabel = meetingStateLabels[meeting.state] || meeting.state;
  const headerState = meeting.is_overdue ? ''
    : `<span class="meeting-state meeting-state--${meeting.state}">${escapeHtml(stateLabel)}</span>`;
  const overdueMessage = 'Дата просрочена. Требуется подтвердить факт проведения встречи, отменить или перенести её.';
  const overdueNotice = meeting.is_overdue ? `
    <div class="meeting-overdue-notice" title="${escapeHtml(overdueMessage)}" aria-label="${escapeHtml(overdueMessage)}"><span class="meeting-overdue-symbol" aria-hidden="true">!</span><span>${escapeHtml(overdueMessage)}</span></div>` : '';
  const lifecycleActions = canManageReportingMeetings && meeting.kind !== 'team_weekly' && isOpen && !historical ? `
      <button class="btn btn-success btn-sm ui-btn meeting-management-action is-success" data-meeting-action="complete" data-meeting-id="${meeting.id}" aria-label="Подтвердить, что встреча состоялась"${canComplete ? '' : ` disabled title="${escapeHtml(completeHint)}"`}><i data-lucide="check-circle"></i>Состоялась</button>
      <button class="btn btn-secondary btn-sm ui-btn meeting-management-action" data-meeting-action="schedule" data-meeting-id="${meeting.id}"><i data-lucide="calendar"></i>${meeting.scheduled_date ? 'Изменить дату' : 'Назначить дату'}</button>
      <button class="btn btn-danger btn-sm ui-btn meeting-management-action is-danger" data-meeting-action="cancel" data-meeting-id="${meeting.id}" aria-label="Отменить встречу"><i data-lucide="calendar-x-2"></i>Отменить</button>` : '';
  const manageActions = `<div class="meeting-management-actions" aria-label="Управление встречей">
      ${lifecycleActions}
      <a class="btn btn-secondary btn-sm ui-btn" href="#/work-reports?meeting_id=${meeting.id}">Снимок задач</a>
      <button class="btn btn-secondary btn-sm ui-btn meeting-management-action is-history" data-meeting-action="history" data-meeting-id="${meeting.id}"><i data-lucide="history"></i>История</button>
    </div>`;
  const statusActionLabel = isOpen && !historical ? 'Открыть статусы' : 'Открыть срез статусов';
  return `
    <article class="reporting-meeting-card meeting-tone--${meta.tone}${meeting.is_overdue ? ' is-overdue' : ''}${historical ? ' is-history-card' : ''}" data-meeting-card="${meeting.id}" tabindex="-1">
      <div class="meeting-card-head">
        <div class="meeting-card-meta"><span class="meeting-kind-icon"><i data-lucide="${meta.icon}"></i></span><div class="meeting-cadence">${escapeHtml(meta.cadence)}</div></div>
        <div class="meeting-card-title-row"><h3>${escapeHtml(meeting.title)}</h3>${headerState}</div>
      </div>
      <div class="meeting-date-control">
        <div class="meeting-primary-date${meeting.scheduled_date ? '' : ' is-pending'}${meeting.is_overdue ? ' is-overdue' : ''}">
          <div class="meeting-primary-date-head"><span>${historical ? 'Дата встречи' : 'Ближайшая встреча'}</span></div>
          <div class="meeting-primary-date-main">
            <strong title="${escapeHtml(formatMeetingDate(meeting.scheduled_date))}">${escapeHtml(formatMeetingPrimaryDate(meeting.scheduled_date))}</strong>
          </div>
          ${overdueNotice}
          ${meeting.original_scheduled_date && meeting.original_scheduled_date !== meeting.scheduled_date ? `<small>Перенесена с ${escapeHtml(formatMeetingDate(meeting.original_scheduled_date))}</small>` : ''}
        </div>
        <div class="meeting-upcoming-slot">${historical ? '' : renderUpcomingMeetingDates(meeting)}</div>
      </div>
      ${manageActions}
      <div class="meeting-fill-status${canPrepareReportingMeetings ? ' is-actionable' : ''}" ${canPrepareReportingMeetings ? `data-meeting-action="prepare" data-meeting-id="${meeting.id}" role="button" tabindex="0" aria-label="${statusActionLabel}. Готовность ${completionPercent}%"` : ''}>
        <div class="meeting-progress"><span>Готовность статусов</span><strong>${completionPercent}%</strong></div>
        ${uiProgress({ value: completionPercent, label: 'Готовность статусов', tone: completionPercent === 100 ? 'success' : 'accent' })}
        <div class="meeting-progress-detail"><span>${escapeHtml(completionSummary)}</span><span class="meeting-missing${meeting.missing_tasks ? '' : ' is-complete'}">${escapeHtml(missingSummary)}</span></div>
        ${canPrepareReportingMeetings ? `<div class="meeting-fill-cta"><i data-lucide="list-checks"></i>${statusActionLabel}</div>` : ''}
      </div>
      ${meeting.change_reason || warning ? `<div class="meeting-messages">
        ${meeting.change_reason ? `<div class="meeting-reason"><i data-lucide="info"></i><span>${escapeHtml(meeting.change_reason)}</span></div>` : ''}
        ${warning}
      </div>` : ''}
    </article>`;
}

function renderReportingMeetingsPanel() {
  const panel = document.getElementById('reporting-meetings-panel');
  if (!panel) return;
  const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('meeting');
  const requestedMeeting = requested && reportingMeetings.find(item => String(item.id) === requested);
  if (requestedMeeting && !meetingMatchesFilters(requestedMeeting)) {
    meetingFilters = { kind: 'all', state: 'all', from: '', to: '' };
  }
  const filtered = reportingMeetings.filter(meetingMatchesFilters)
    .sort((a, b) => String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')));
  const cards = getMeetingCards(filtered);
  panel.innerHTML = `
    ${renderMeetingToolbar()}
    ${meetingView === 'timeline' || !cards.length
      ? renderMeetingTimeline(filtered)
      : `<div class="reporting-meetings-grid">${cards.map(item => renderReportingMeetingCard(item, false)).join('')}</div>`}`;
  panel.querySelectorAll('[data-meeting-filter]').forEach(input => {
    input.value = meetingFilters[input.dataset.meetingFilter];
  });
  window.lucide?.createIcons();
  if (requested) setTimeout(() => {
    const card = [...panel.querySelectorAll('[data-meeting-card], [data-meeting-jump]')]
      .find(item => item.dataset.meetingCard === requested || item.dataset.meetingJump === requested);
    card?.classList.add('is-requested');
    card?.scrollIntoView({ block: 'center' });
    card?.focus();
  }, 0);
}

async function loadReportingMeetings(app) {
  const panel = document.getElementById('reporting-meetings-panel');
  if (!panel) return;
  try {
    const data = await app.api.get('/reporting-meetings?include_closed=true');
    reportingMeetings = Array.isArray(data?.items) ? data.items : [];
    canManageReportingMeetings = !!data?.can_manage;
    canPrepareReportingMeetings = !!data?.can_prepare;
    renderReportingMeetingsPanel();
  } catch (error) {
    panel.innerHTML = `<div class="card meeting-panel-error"><p>Не удалось загрузить календарь встреч.</p><button class="btn btn-secondary btn-sm" data-meeting-retry>Повторить</button></div>`;
  }
}

function showReportingMeetingForm(meeting, mode) {
  return new Promise(resolve => {
    const returnFocus = document.activeElement;
    document.getElementById('reporting-meeting-modal')?.remove();
    const isSchedule = mode === 'schedule';
    const isComplete = mode === 'complete';
    const hasDate = Boolean(meeting.scheduled_date);
    const title = isSchedule
      ? (hasDate ? 'Изменить дату встречи' : 'Назначить дату встречи')
      : (isComplete ? 'Встреча состоялась' : 'Отменить встречу');
    const confirmLabel = isSchedule ? 'Сохранить дату' : (isComplete ? 'Подтвердить' : 'Отменить встречу');
    const titleId = `reporting-meeting-modal-title-${meeting.id}`;
    const overlay = document.createElement('div');
    overlay.id = 'reporting-meeting-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-sm meeting-management-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <form class="meeting-management-form" novalidate>
          <div class="modal-header">
            <div><h3 class="modal-title" id="${titleId}">${escapeHtml(title)}</h3><p class="meeting-dialog-subtitle">${escapeHtml(meeting.title)}</p></div>
            ${uiButton({ label: 'Закрыть диалог', icon: 'x', iconOnly: true, variant: 'ghost', className: 'modal-close', attrs: { 'data-meeting-dialog-close': true } })}
          </div>
          <div class="modal-body">
            ${isSchedule ? `
              ${uiField({ id: 'meeting-scheduled-date', label: 'Дата встречи', type: 'date', value: meeting.scheduled_date || '', required: true, attrs: { name: 'scheduled_date', min: localDateIso() }, hint: !hasDate && meeting.kind === 'did' ? 'Новая оперативка ДИД должна приходиться на вторник.' : !hasDate && meeting.kind === 'directorate' ? 'Новая директорская оперативка должна приходиться на понедельник.' : '' })}
              ${hasDate ? uiField({ id: 'meeting-change-reason', label: 'Причина изменения даты', kind: 'textarea', attrs: { name: 'reason', rows: 3, placeholder: 'Укажите причину, если дата изменяется' }, hint: 'Обязательна при выборе даты, отличной от текущей.' }) : ''}` : isComplete ? `
              <div class="meeting-dialog-warning is-success"><i data-lucide="check-circle"></i><span>Текущие отчётные статусы будут зафиксированы и станут статусами предыдущей встречи. Заполнено ${meeting.filled_tasks || 0} из ${meeting.total_tasks || 0} задач.</span></div>` : `
              <div class="meeting-dialog-warning"><i data-lucide="triangle-alert"></i><span>Встреча будет отменена. Заполненные статусы перенесутся в следующую встречу, не заменяя уже подготовленные данные.</span></div>
              ${uiField({ id: 'meeting-cancel-reason', label: 'Причина отмены', kind: 'textarea', required: true, attrs: { name: 'reason', rows: 3, placeholder: 'Укажите причину отмены' } })}`}
            <div class="form-error meeting-dialog-error" role="alert" hidden></div>
          </div>
          <div class="modal-footer">
            ${uiButton({ label: 'Закрыть', size: 'small', attrs: { 'data-meeting-dialog-close': true } })}
            ${uiButton({ label: confirmLabel, variant: isSchedule || isComplete ? 'primary' : 'danger', size: 'small', attrs: { type: 'submit' } })}
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    window.lucide?.createIcons();

    const form = overlay.querySelector('form');
    const error = overlay.querySelector('.meeting-dialog-error');
    let settled = false;
    const close = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      returnFocus?.focus?.();
      resolve(value);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Tab') {
        const focusable = [...overlay.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')]
          .filter(item => !item.disabled && item.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeydown);
    overlay.querySelectorAll('[data-meeting-dialog-close]').forEach(item => item.addEventListener('click', () => close(null)));
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(null); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = new FormData(form);
      const reason = String(values.get('reason') || '').trim();
      if (isSchedule) {
        const scheduledDate = String(values.get('scheduled_date') || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
          error.textContent = 'Укажите дату встречи.';
          error.hidden = false;
          form.elements.scheduled_date?.focus();
          return;
        }
        if (scheduledDate < localDateIso() && scheduledDate !== meeting.scheduled_date) {
          error.textContent = 'Нельзя назначить встречу на прошедшую дату.';
          error.hidden = false;
          form.elements.scheduled_date?.focus();
          return;
        }
        if (hasDate && scheduledDate !== meeting.scheduled_date && !reason) {
          error.textContent = 'Укажите причину изменения даты.';
          error.hidden = false;
          form.elements.reason?.focus();
          return;
        }
        if (meeting.kind === 'did' && !hasDate && new Date(`${scheduledDate}T12:00:00`).getDay() !== 2) {
          error.textContent = 'Новая оперативка ДИД должна быть во вторник.';
          error.hidden = false;
          form.elements.scheduled_date?.focus();
          return;
        }
        if (meeting.kind === 'directorate' && !hasDate && new Date(`${scheduledDate}T12:00:00`).getDay() !== 1) {
          error.textContent = 'Новая директорская оперативка должна быть в понедельник.';
          error.hidden = false;
          form.elements.scheduled_date?.focus();
          return;
        }
        close({ scheduled_date: scheduledDate, reason: reason || null });
        return;
      }
      if (isComplete) {
        close({});
        return;
      }
      if (!reason) {
        error.textContent = 'Укажите причину отмены встречи.';
        error.hidden = false;
        form.elements.reason?.focus();
        return;
      }
      close({ reason });
    });
    requestAnimationFrame(() => form.querySelector('input, textarea')?.focus());
  });
}

function showMeetingDataDialog({ title, subtitle, body }) {
  document.getElementById('reporting-meeting-data-modal')?.remove();
  const returnFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'reporting-meeting-data-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal meeting-data-dialog" role="dialog" aria-modal="true" aria-labelledby="meeting-data-title">
    <div class="modal-header"><div><h3 class="modal-title" id="meeting-data-title">${escapeHtml(title)}</h3><p class="meeting-dialog-subtitle">${escapeHtml(subtitle || '')}</p></div>
    ${uiButton({ label: 'Закрыть диалог', icon: 'x', iconOnly: true, variant: 'ghost', className: 'modal-close', attrs: { 'data-meeting-data-close': true } })}</div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer">${uiButton({ label: 'Закрыть', size: 'small', attrs: { 'data-meeting-data-close': true } })}</div>
  </div>`;
  const close = () => { document.removeEventListener('keydown', keydown); overlay.remove(); returnFocus?.focus?.(); };
  const keydown = event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const items = [...overlay.querySelectorAll('button, textarea, input, select')].filter(item => !item.disabled && item.offsetParent !== null);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
  };
  overlay.querySelectorAll('[data-meeting-data-close]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', keydown);
  document.body.appendChild(overlay);
  overlay.querySelector('button, textarea, input')?.focus();
  window.lucide?.createIcons();
  return overlay;
}

function showReportingMeetingPlanner(meeting, app) {
  const openStates = new Set(['planned', 'date_pending']);
  const items = reportingMeetings
    .filter(item => item.kind === meeting.kind && openStates.has(item.state))
    .sort((a, b) => String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')));
  const rows = items.length ? items.map(item => `<article class="meeting-planner-row">
      <div><strong>${escapeHtml(formatMeetingDate(item.scheduled_date))}</strong><small>${escapeHtml(item.scheduled_date ? 'Запланирована' : 'Дата не назначена')}</small></div>
      <button type="button" class="btn btn-secondary btn-sm" data-planner-edit="${item.id}"><i data-lucide="pencil"></i>${item.scheduled_date ? 'Изменить' : 'Назначить'}</button>
    </article>`).join('') : '<div class="empty-state">Будущих встреч пока нет</div>';
  const overlay = showMeetingDataDialog({
    title: 'Планирование встреч',
    subtitle: meeting.title,
    body: `<div class="meeting-planner-intro">Здесь собраны все незавершённые экземпляры встречи. Можно скорректировать дату или добавить новую встречу.</div>
      <div class="meeting-planner-list">${rows}</div>
      <button type="button" class="btn btn-primary btn-sm meeting-planner-add" data-planner-add><i data-lucide="calendar-plus"></i>Добавить встречу</button>`,
  });
  overlay.addEventListener('click', async event => {
    const edit = event.target.closest('[data-planner-edit]');
    const add = event.target.closest('[data-planner-add]');
    if (!edit && !add) return;
    overlay.querySelector('[data-meeting-data-close]')?.click();
    if (edit) {
      const target = reportingMeetings.find(item => Number(item.id) === Number(edit.dataset.plannerEdit));
      if (target) await handleReportingMeetingAction({ dataset: { meetingId: String(target.id), meetingAction: 'schedule' }, disabled: false }, app);
      return;
    }
    const draft = { id: `new-${meeting.kind}`, kind: meeting.kind, title: meeting.title, scheduled_date: null };
    const values = await showReportingMeetingForm(draft, 'schedule');
    if (!values) return;
    try {
      await app.api.post('/reporting-meetings', { kind: meeting.kind, scheduled_date: values.scheduled_date });
      window.toast?.('Новая встреча добавлена', 'success');
      await loadReportingMeetings(app);
    } catch (error) {
      window.toast?.(error?.message || 'Не удалось добавить встречу', 'error');
    }
  });
}

async function showReportingMeetingHistory(meeting, app) {
  const labels = { scheduled: 'Дата назначена', rescheduled: 'Дата перенесена', completed: 'Встреча состоялась', cancelled: 'Встреча отменена' };
  const renderItems = items => items?.length ? `<div class="meeting-history-list">${items.map(item => `
      <article><div><strong>${escapeHtml(labels[item.action] || item.action)}</strong><time>${escapeHtml(item.changed_at ? new Date(item.changed_at).toLocaleString('ru-RU') : '—')}</time></div>
      <p>${item.old_date && item.new_date && item.old_date !== item.new_date ? `${escapeHtml(formatMeetingDate(item.old_date))} → ${escapeHtml(formatMeetingDate(item.new_date))}` : escapeHtml(formatMeetingDate(item.new_date || item.old_date))}</p>
      ${item.reason ? `<blockquote>${escapeHtml(item.reason)}</blockquote>` : ''}<small>${escapeHtml(item.changed_by_name || 'Система')}</small></article>`).join('')}</div>`
      : '<div class="empty-state">Изменений встреч этого типа пока нет</div>';
  const relatedMeetings = reportingMeetings.filter(item => item.kind === meeting.kind);
  const overlay = showMeetingDataDialog({ title: 'История встреч', subtitle: meeting.title, body: '<div class="card-reporting-loading content-loading-state">Загрузка истории…</div>' });
  try {
    const histories = await Promise.all(relatedMeetings.map(async item => {
      if (Array.isArray(item.history)) return item.history;
      const data = await app.api.get(`/reporting-meetings/${item.id}/history`);
      return data.items || [];
    }));
    const items = histories.flat().sort((a, b) =>
      String(b.changed_at || '').localeCompare(String(a.changed_at || '')) || Number(b.id || 0) - Number(a.id || 0));
    const body = overlay.querySelector('.modal-body');
    if (body) body.innerHTML = renderItems(items);
  } catch (error) {
    const body = overlay.querySelector('.modal-body');
    if (body) body.innerHTML = `<div class="meeting-panel-error"><p>Не удалось загрузить историю: ${escapeHtml(error?.message || 'ошибка сервера')}</p><p>Убедитесь, что backend перезапущен после обновления.</p></div>`;
  }
}

async function showReportingMeetingPreparation(meeting, app) {
  const overlay = showMeetingDataDialog({
    title: meeting.state === 'held' ? 'Зафиксированный срез статусов' : meeting.state === 'cancelled' ? 'Статусы отменённой встречи' : 'Статусы предстоящей встречи',
    subtitle: `${meeting.title} · ${formatMeetingDate(meeting.scheduled_date)}`,
    body: '<div class="card-reporting-loading content-loading-state">Загрузка статусов встречи…</div>',
  });
  try {
    const data = await app.api.get(`/reporting-meetings/${meeting.id}/preparation`);
    const rows = data.items || [];
    const body = `<div class="meeting-preparation-summary"><strong>${rows.filter(item => item.filled).length} из ${rows.length}</strong><span>задач в доступной области заполнено</span>
      <label><input type="checkbox" data-preparation-missing> Только незаполненные</label></div>
      <div class="meeting-preparation-list">${rows.map(item => `<article data-preparation-row data-filled="${item.filled}">
        <div class="meeting-preparation-task"><button class="ui-link" type="button" data-open-preparation-task="${item.task_id}">${escapeHtml(item.public_id)}</button><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.team_name || 'Без команды')}</small></div></div>
        ${item.can_edit ? `${uiControl({ kind: 'textarea', value: item.text || '', attrs: { rows: 3, maxlength: 5000, 'data-preparation-text': true, placeholder: 'Опишите прогресс, риски и следующие шаги', 'aria-label': 'Отчётный статус: ' + item.title } })}
          ${meeting.kind === 'did' ? `<label class="meeting-demo-check"><input type="checkbox" data-preparation-demo ${item.did_demo ? 'checked' : ''}> Демо для ДИД</label>` : ''}
          ${uiButton({ label: 'Сохранить', variant: 'primary', size: 'small', attrs: { 'data-save-preparation': true, 'data-task-id': item.task_id, 'data-version': item.version } })}`
          : `<p class="meeting-preparation-text">${item.text ? escapeHtml(item.text) : 'Статус не заполнен'}</p>`}
        <div class="meeting-status-version"><span>Версия ${item.version}</span>${item.updated_at ? `<small>${escapeHtml(new Date(item.updated_at).toLocaleString('ru-RU'))}${item.updated_by_name ? ` · ${escapeHtml(item.updated_by_name)}` : ''}</small>` : ''}</div>
        ${item.revisions?.length ? `<details class="meeting-status-revisions"><summary>История изменений · ${item.revisions.length}</summary>${item.revisions.map(revision => `<div><small>${escapeHtml(revision.changed_at ? new Date(revision.changed_at).toLocaleString('ru-RU') : '—')} · ${escapeHtml(revision.changed_by_name || 'Система')}</small><p>${escapeHtml(revision.new_text || 'Статус очищен')}</p></div>`).join('')}</details>` : ''}
      </article>`).join('')}</div>`;
    const modalBody = overlay.querySelector('.modal-body');
    if (modalBody) modalBody.innerHTML = body;
    overlay.querySelector('[data-preparation-missing]')?.addEventListener('change', event => {
      overlay.querySelectorAll('[data-preparation-row]').forEach(row => { row.hidden = event.target.checked && row.dataset.filled === 'true'; });
    });
    overlay.addEventListener('click', async event => {
      const taskButton = event.target.closest('[data-open-preparation-task]');
      if (taskButton) document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(taskButton.dataset.openPreparationTask) } }));
      const save = event.target.closest('[data-save-preparation]');
      if (!save || save.disabled) return;
      const row = save.closest('[data-preparation-row]');
      setButtonBusy(save, true);
      try {
        const result = await app.api.put(`/tasks/${save.dataset.taskId}/reporting-statuses/${meeting.id}`, {
          text: row.querySelector('[data-preparation-text]')?.value?.trim() || null,
          did_demo: !!row.querySelector('[data-preparation-demo]')?.checked,
          version: Number(save.dataset.version || 0),
        });
        save.dataset.version = result.version;
        row.dataset.filled = String(!!result.text);
        window.toast?.('Отчётный статус сохранён', 'success');
        await loadReportingMeetings(app);
      } catch (error) {
        if (error?.status === 409) await showReportingMeetingPreparation(meeting, app);
        window.toast?.(error?.status === 409 ? 'Данные обновлены другим пользователем. Загружена актуальная версия.' : 'Не удалось сохранить статус', 'error');
      } finally { setButtonBusy(save, false); }
    });
  } catch (error) {
    const modalBody = overlay.querySelector('.modal-body');
    const explanation = error?.status === 403
      ? 'Backend не подтвердил полный административный доступ текущего пользователя.'
      : error?.status === 404
        ? 'Запущенный backend не содержит endpoint просмотра статусов. Его необходимо перезапустить после обновления.'
        : 'Проверьте состояние backend и журнал приложения.';
    if (modalBody) modalBody.innerHTML = `<div class="meeting-panel-error" role="alert">
      <h4>Не удалось загрузить статусы встречи</h4>
      <p>${escapeHtml(error?.message || 'Ошибка сервера')} ${error?.status ? `(HTTP ${error.status})` : ''}</p>
      <p>${escapeHtml(explanation)}</p>
      <button class="btn btn-secondary btn-sm" type="button" data-preparation-retry>Повторить</button>
    </div>`;
    modalBody?.querySelector('[data-preparation-retry]')?.addEventListener('click', () => showReportingMeetingPreparation(meeting, app));
  }
}

async function handleReportingMeetingAction(button, app) {
  const meeting = reportingMeetings.find(item => Number(item.id) === Number(button.dataset.meetingId));
  if (!meeting) return;
  const action = button.dataset.meetingAction;
  if (action === 'plan') return showReportingMeetingPlanner(meeting, app);
  if (action === 'history') return showReportingMeetingHistory(meeting, app);
  if (action === 'prepare') return showReportingMeetingPreparation(meeting, app);
  let payload = { version: meeting.version || 0 };
  if (action === 'schedule') {
    const values = await showReportingMeetingForm(meeting, 'schedule');
    if (!values) return;
    payload = { ...payload, ...values };
  } else if (action === 'complete') {
    const confirmed = await showReportingMeetingForm(meeting, 'complete');
    if (!confirmed) return;
    payload = { ...payload, ...confirmed };
  } else if (action === 'cancel') {
    const values = await showReportingMeetingForm(meeting, 'cancel');
    if (!values) return;
    payload = { ...payload, ...values };
  }
  button.disabled = true;
  try {
    await app.api.post(`/reporting-meetings/${meeting.id}/${action}`, payload);
    window.toast?.(action === 'complete' ? 'Факт встречи зафиксирован' : action === 'cancel' ? 'Встреча отменена' : 'Дата встречи сохранена', 'success');
    await loadReportingMeetings(app);
  } catch (error) {
    if (error?.status === 409) await loadReportingMeetings(app);
    window.toast?.(error?.status === 409 ? 'Встреча была изменена другим пользователем. Показаны актуальные данные.' : error?.message || 'Не удалось обновить встречу', 'error');
    button.disabled = false;
  }
}

function resolveReportFields(config) {
  if (config.isDb && !config.managedFields && cachedDbReport && cachedDbReport.fields) {
    try {
      const parsed = JSON.parse(cachedDbReport.fields);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (e) {}
  }
  return config.fields || [];
}

async function fetchDbReports(app) {
  try {
    const reports = await app.api.get('/reports/');
    (Array.isArray(reports) ? reports : (reports.items || [])).forEach(rep => {
      if (rep.key) dbReportsCache[rep.key] = rep;
    });
  } catch (e) {
    console.warn('Reports API unavailable:', e);
  }
}

let reportFilterDropdown = null;
let reportFilterPopover = null;
let reportFilterDropdownField = null;

function isRiskStatus(s) {
  return s === 'ХОЛД' || s === 'ЭСКАЛАЦИЯ НА ЛТ';
}

function isActiveStatus(s) {
  return ['СБОР ТРЕБОВАНИЙ','ПРОВЕРКА ТРЕБОВАНИЙ','УТОЧНЕНИЕ ТРЕБОВАНИЙ','ЭКСПРЕСС-ОЦЕНКА','ПРИНЯТИЕ РЕШЕНИЯ','ПРИНЯТА В РАБОТУ'].includes(s);
}

export function renderPriority(priority) {
  const map = { 'ВЫСОКИЙ': 'high', 'СРЕДНИЙ': 'medium', 'НИЗКИЙ': 'low' };
  const norm = String(priority || '').toUpperCase();
  const cls = map[norm] || 'medium';
  return `<span class="badge badge-${cls}">${escapeHtml(priority || 'СРЕДНИЙ')}</span>`;
}

export function renderStatus(status) {
  const raw = status || '';
  const statusClass = raw.toUpperCase().replace(/\s+/g, '_');
  const colors = {
    'НОВАЯ_ЗАДАЧА': 'badge-status-backlog',
    'НАЗНАЧЕНА_КОМАНДА': 'badge-status-backlog',
    'СБОР_ТРЕБОВАНИЙ': 'badge-status-backlog',
    'ПРОВЕРКА_ТРЕБОВАНИЙ': 'badge-status-backlog',
    'УТОЧНЕНИЕ_ТРЕБОВАНИЙ': 'badge-status-backlog',
    'ЭКСПРЕСС-ОЦЕНКА': 'badge-status-backlog',
    'ПРИНЯТИЕ_РЕШЕНИЯ': 'badge-status-review',
    'ПРИНЯТА_В_РАБОТУ': 'badge-status-in_progress',
    'ЭСКАЛАЦИЯ_НА_ЛТ': 'badge-status-on_hold',
    'ХОЛД': 'badge-status-on_hold',
    'ОТКЛОНЕНА': 'badge-danger',
    'НЕ_АКТУАЛЬНА': 'badge-low',
    'ВЫПОЛНЕНА': 'badge-status-done'
  };
  return `<span class="badge ${colors[statusClass] || 'badge-status-backlog'}">${escapeHtml(raw || 'СБОР ТРЕБОВАНИЙ')}</span>`;
}

function renderProgress(progress, task = null) {
  const hasFact = progress != null;
  const p = hasFact ? progress : 0;
  const indicator = task?.progress_indicator;
  const colors = { green: '#16a34a', yellow: '#f59e0b', red: '#dc2626' };
  const indicatorColor = colors[indicator];
  let colorClass = !indicatorColor && p >= 100 ? 'success' : (!indicatorColor && p > 0 ? 'warning' : '');
  const planText = task?.planned_progress != null ? ` · план ${task.planned_progress}%` : '';
  const deviationText = task?.progress_deviation_percent != null
    ? `Отклонение от плана: ${task.progress_deviation_percent} п.п.`
    : (!hasFact && indicator === 'red' ? 'Факт не заполнен' : '');
  const factText = hasFact ? `${p}%` : 'Нет факта';
  return `
    <div style="display:flex;align-items:center;gap:8px;min-width:160px;" title="${escapeHtml(deviationText)}">
      ${indicatorColor ? `<span style="width:10px;height:10px;border-radius:50%;background:${indicatorColor};box-shadow:0 0 0 3px ${indicatorColor}22;flex-shrink:0"></span>` : ''}
      ${uiProgress({ value: hasFact ? p : null, tone: ({ green: 'success', yellow: 'warning', red: 'danger' })[indicator] || colorClass || 'accent' })}
      <span style="font-size:var(--text-xs);color:var(--text-secondary);min-width:82px;text-align:right;white-space:nowrap">${factText}${planText}</span>
    </div>`;
}

function renderQuarterlyFact(task) {
  if (task.progress == null) return '<span class="quarterly-no-fact">Не заполнен</span>';
  const value = Math.max(0, Math.min(100, Number(task.progress) || 0));
  return `<div class="quarterly-fact-value">${uiProgress({ value })}<strong>${value}%</strong></div>`;
}

function renderTrafficLight(task) {
  const indicator = task.progress_indicator;
  const meta = {
    green: ['Зелёный'],
    yellow: ['Жёлтый'],
    red: ['Красный'],
  }[indicator] || ['Не определён'];
  return `<span class="quarterly-light quarterly-light--${escapeHtml(indicator || 'unknown')}"><i aria-hidden="true"></i><span>${meta[0]}<small>${escapeHtml(task.traffic_reason || '')}</small></span></span>`;
}

function renderProgressFreshness(task) {
  const code = task.progress_freshness || 'unconfirmed';
  const tones = { current: 'success', missing: 'danger', stale: 'warning', unconfirmed: 'warning' };
  const updated = task.progress_updated_at
    ? new Date(task.progress_updated_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '';
  return `<span class="badge badge-${tones[code] || 'low'}">${escapeHtml(task.progress_freshness_label || 'Не подтверждён')}</span>${updated ? `<small class="quarterly-freshness-date">Обновлён ${updated}</small>` : ''}`;
}

function renderCell(task, field) {
  switch (field) {
    case 'id': return `<span class="font-mono text-muted">${formatTaskPublicId(task)}</span>`;
    case 'title': return `<strong>${escapeHtml(task.title)}</strong>`;
    case 'status': return renderStatus(task.status_name || task.status);
    case 'status_name': return renderStatus(task.status_name || task.status);
    case 'priority': return renderPriority(task.priority_name || task.priority);
    case 'priority_name': return renderPriority(task.priority_name || task.priority);
    case 'progress': return currentReport === 'quarterly-goals' ? renderQuarterlyFact(task) : renderProgress(task.progress, task);
    case 'start_shift_name': return escapeHtml(task.start_shift_name || 'С первого месяца квартала');
    case 'planned_progress': return task.planned_progress == null ? '<span class="text-muted">До старта</span>' : `<strong>${task.planned_progress}%</strong>`;
    case 'progress_deviation_percent': return task.progress_deviation_percent == null
      ? '<span class="quarterly-no-fact">Нет факта</span>'
      : `${task.progress_deviation_percent} п.п.`;
    case 'progress_indicator': return renderTrafficLight(task);
    case 'progress_freshness_label': return renderProgressFreshness(task);
    case 'team_name': return `<span class="badge badge-info">${escapeHtml(task.team_name || '—')}</span>`;
    case 'project': return escapeHtml(task.project_name || task.project || '—');
    case 'project_name': return escapeHtml(task.project_name || task.project || '—');
    case 'deadline': return escapeHtml(task.deadline_name || task.deadline || '—');
    case 'deadline_name': return escapeHtml(task.deadline_name || task.deadline || '—');
    case 'effort_days': return task.effort_days != null ? `${task.effort_days} ч/д` : '—';
    case 'effort_rub': return task.effort_rub != null
      ? `${Number(task.effort_rub).toLocaleString('ru-RU')} ₽`
      : '—';
    case 'financial_effect': return task.financial_effect != null ? `${task.financial_effect} млн ₽` : '—';
    case 'cv': return task.cv != null ? escapeHtml(String(task.cv)) : '—';
    case 'priority_score': return task.priority_score != null ? escapeHtml(String(task.priority_score)) : '—';
    case 'business_customer': return escapeHtml(task.business_customer_name || task.business_customer || '—');
    case 'department_name': return escapeHtml(task.department_name || '—');
    case 'channel_name': return escapeHtml(task.channel_name || '—');
    case 'task_type_name': return escapeHtml(task.task_type_name || '—');
    case 'owner': return escapeHtml(task.owner_name || task.owner || '—');
    case 'owner_name': return escapeHtml(task.owner_name || task.owner || '—');
    case 'directorate_status': return renderDirectorateStatus(task.directorate_status);
    case 'did_status': return renderDidStatus(task.did_status);
    case 'did_demo': return task.did_demo ? '<span class="badge badge-success">Да</span>' : '<span class="badge badge-low">Нет</span>';
    case 'involved_teams': return escapeHtml(renderInvolvedTeams(task.involved_teams));
    case 'key_project_status': return renderDirectorateStatus(task.key_project_status);
    default: return escapeHtml(task[field] || '—');
  }
}

function smartCap(str) {
  if (!str) return str;
  return str.split(/(\s+)/).map(word => {
    if (word.length <= 2) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join('');
}

function renderDirectorateStatus(status) {
  if (!status) return '—';
  const colors = {
    'В работе': 'badge-status-in_progress',
    'На контроле': 'badge-warning',
    'Риск': 'badge-danger',
    'Выполнен': 'badge-status-done',
    'Не актуальна': 'badge-low',
  };
  const cls = colors[status] || 'badge-status-backlog';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function renderDidStatus(status) {
  if (!status) return '—';
  const colors = {
    'В работе': 'badge-status-in_progress',
    'Требует решения': 'badge-warning',
    'Закрыта': 'badge-status-done',
    'Блокировано': 'badge-danger',
  };
  const cls = colors[status] || 'badge-status-backlog';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

const fieldLabels = {
  id: 'ID', public_id: 'ID', title: 'Задача', team_name: 'Команда',
  project: 'Проект', project_name: 'Проект',
  status: 'Статус', priority: 'Приоритет', deadline: 'Срок',
  progress: '%', financial_effect: 'Фин. эффект',
  effort_days: 'Трудозатраты по экспресс-оценке',
  effort_rub: 'Оценка трудозатрат, руб.', cv: 'C/V', priority_score: 'Priority Score',
  business_customer: 'Бизнес-заказчик', department_name: 'Подразделение',
  business_customer_name: 'Бизнес-заказчик',
  channel_name: 'Канал', task_type_name: 'Тип задачи',
  owner: 'Исполнитель', directorate_status: 'Статус',
  did_status: 'Статус', key_project_status: 'Статус',
  did_demo: 'Демо', date_received: 'Дата поступления',
  involved_teams: 'Вовлечённые команды',
  deadline_name: 'Срок', owner_name: 'Владелец',
  start_shift_name: 'Старт в квартале', planned_progress: 'План',
  progress_deviation_percent: 'Отставание', progress_indicator: 'Светофор',
  progress_freshness_label: 'Актуальность факта', result: 'Результат недели',
  next_step: 'Следующий шаг', next_step_due: 'Срок шага', signal: 'Сигнал встречи'
};

function getFieldLabel(field) {
  const fl = window.app?.fieldLabels || {};
  const base = field.replace(/_name$/, '_id');
  if (currentReport === 'quarterly-goals' && field === 'progress') return 'Факт';
  return fl[field] || fl[base] || fieldLabels[field] || field;
}

function applyFilterValue(task, field, op, value) {
  switch (op) {
    case 'eq': {
      if (typeof value === 'string' && typeof task[field] === 'string') {
        return task[field].toLowerCase() === value.toLowerCase();
      }
      return task[field] === value;
    }
    case 'neq': return task[field] !== value;
    case 'in': return Array.isArray(value) && value.includes(task[field]);
    case 'gt': return parseFloat(task[field]) > value;
    case 'lt': return parseFloat(task[field]) < value;
    case 'contains': return String(task[field] || '').includes(String(value));
    case 'empty': return task[field] === null || task[field] === undefined || task[field] === '';
    case 'notEmpty': return task[field] !== null && task[field] !== undefined && task[field] !== '';
    default: return true;
  }
}

function applyReportFilters(kind, tasks) {
  const config = reportConfig[kind];
  if (!config || !config.filters) return tasks;
  const andFilters = config.filters.filter(f => f.logic === 'and');
  const orFilters = config.filters.filter(f => f.logic === 'or');
  return tasks.filter(task => {
    const andPass = andFilters.length === 0 || andFilters.every(f => applyFilterValue(task, f.field, f.op, f.value));
    const orPass = orFilters.length === 0 || orFilters.some(f => applyFilterValue(task, f.field, f.op, f.value));
    return andPass && orPass;
  });
}

function closeFilterDropdown() {
  reportFilterPopover?.close();
  reportFilterPopover = null;
}

function renderFilterDropdown(field, triggerEl) {
  const wasOpen = reportFilterDropdownField === field;
  closeFilterDropdown();
  if (wasOpen) return;
  const values = [...new Set(tasksCache.map(t => String(t[field] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const activeVals = reportColumnFilters[field] || [];
  const dd = document.createElement('div');
  dd.className = 'report-filter-panel';
  dd.innerHTML = `<div class="ui-popover-header"><strong class="ui-popover-title">Фильтр</strong>
    <button type="button" class="btn btn-ghost btn-sm" data-clear-field="${escapeHtml(field)}">Сбросить</button></div>
    <label class="ui-selection-option"><input type="checkbox" data-select-all><span>Выбрать все</span><span class="ui-selection-count" data-selection-count></span></label>
    ${selectionList({ items: values.map(value => ({ value, label: value })), selected: activeVals })}`;
  const syncSelection = () => {
    const checked = dd.querySelectorAll('input[value]:checked').length;
    const all = dd.querySelector('[data-select-all]');
    all.checked = checked === values.length && values.length > 0;
    all.indeterminate = checked > 0 && checked < values.length;
    dd.querySelector('[data-selection-count]').textContent = `${checked}/${values.length}`;
  };
  syncSelection();
  dd.addEventListener('change', event => {
    if (event.target.matches('[data-select-all]')) dd.querySelectorAll('input[value]').forEach(input => { input.checked = event.target.checked; });
    syncSelection(); applyFilterFromDropdown(field, dd); reportFilterPopover?.position();
  });
  dd.addEventListener('click', event => {
    if (!event.target.closest('[data-clear-field]')) return;
    dd.querySelectorAll('input[type=checkbox]').forEach(input => { input.checked = false; });
    syncSelection(); applyFilterFromDropdown(field, dd); reportFilterPopover?.position();
  });
  reportFilterDropdown = dd;
  reportFilterDropdownField = field;
  reportFilterPopover = createPopover({ trigger: triggerEl, panel: dd, label: 'Фильтр отчёта', removeOnClose: true,
    resolveTrigger: () => document.querySelector(`.filter-trigger[data-field="${CSS.escape(field)}"]`),
    onClose: () => { reportFilterDropdown = null; reportFilterDropdownField = null; },
  });
  reportFilterPopover.open();
}

function applyFilterFromDropdown(field, dd) {
  const valCbs = dd.querySelectorAll('input[type=checkbox][value]');
  const checked = dd.querySelectorAll('input[type=checkbox][value]:checked');
  reportColumnFilters[field] = Array.from(checked).map(c => c.value).filter(Boolean);
  const selectAll = dd.querySelector('input[data-select-all]');
  if (selectAll) {
    const checkedCount = checked.length;
    selectAll.checked = checkedCount === valCbs.length && valCbs.length > 0;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < valCbs.length;
  }
  const totalSpan = dd.querySelector('[data-selection-count]');
  if (totalSpan) {
    totalSpan.textContent = checked.length + '/' + valCbs.length;
  }
  const config = reportConfig[currentReport];
  if (config.isCustom && cachedReportData) {
    renderReportContent(config, currentReport, cachedReportData);
  } else {
    const filtered = applyReportFilters(currentReport, tasksCache);
    renderReportContent(config, currentReport, filtered);
  }
}

function getReportQueryParams() {
  const query = (window.location.hash.split('?')[1] || '').split('#')[0];
  return new URLSearchParams(query);
}

function renderPipMetric(label, value, suffix = '') {
  return `<div class="pip-summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}${suffix ? ` <small>${escapeHtml(suffix)}</small>` : ''}</strong></div>`;
}

function renderPipDecisionWorkspace(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const summary = calculatePipDecisionSummary(list);
  const params = getReportQueryParams();
  const transferred = Number(params.get('transferred') || 0);
  const fromExpress = params.get('source') === 'express-estimate';
  const canDecide = window.app?.store?.get('currentUser')?.permissions?.pip_decision === 'available';
  const visible = list.filter(task => {
    const hasGaps = getPipDecisionGaps(task).length > 0;
    return pipQueueFilter === 'gaps' ? hasGaps : pipQueueFilter === 'ready' ? !hasGaps : true;
  });
  const transferredText = transferred > 0
    ? `${transferred} ${formatCount(transferred)} передано из экспресс-оценки.`
    : 'Экспресс-оценка завершена, задачи добавлены в очередь решений.';
  const flowNotice = fromExpress ? `
    <div class="pip-handoff-notice" role="status">
      <i data-lucide="badge-check"></i>
      <div><strong>Передача в PI выполнена</strong><span>${escapeHtml(transferredText)} Проверьте контекст и зафиксируйте решение по каждой задаче.</span></div>
    </div>` : '';
  const cards = visible.map(task => {
    const gaps = getPipDecisionGaps(task);
    const contextReady = gaps.length === 0;
    return `
      <article class="pip-task-card${contextReady ? ' is-context-ready' : ' has-context-gaps'}" data-pip-task-id="${task.id}">
        <div class="pip-task-main">
          <div class="pip-task-heading">
            <a href="#/backlog?task=${task.id}&source=pip" class="pip-task-id">${escapeHtml(formatTaskPublicId(task))}</a>
            <span class="pip-context-badge ${contextReady ? 'is-ready' : 'has-gaps'}"><i data-lucide="${contextReady ? 'badge-check' : 'triangle-alert'}"></i>${contextReady ? 'Контекст заполнен' : `${gaps.length} ${gaps.length === 1 ? 'пробел' : 'пробела'}`}</span>
          </div>
          <h3>${escapeHtml(task.title || 'Без названия')}</h3>
          <div class="pip-task-meta">
            <span><i data-lucide="users"></i>${escapeHtml(task.team_name || 'Без команды')}</span>
            <span><i data-lucide="folder-kanban"></i>${escapeHtml(task.project_name || 'Без проекта')}</span>
            <span><i data-lucide="tag"></i>${escapeHtml(task.task_type_name || 'Тип не указан')}</span>
          </div>
        </div>
        <dl class="pip-task-metrics">
          <div><dt>Трудозатраты</dt><dd>${task.effort_days != null ? `${escapeHtml(String(task.effort_days))} ч/д` : '—'}</dd></div>
          <div><dt>Фин. эффект</dt><dd>${task.financial_effect != null ? `${Number(task.financial_effect).toLocaleString('ru-RU')} млн ₽` : '—'}</dd></div>
          <div><dt>Priority Score</dt><dd>${task.priority_score != null ? escapeHtml(String(task.priority_score)) : '—'}</dd></div>
        </dl>
        <div class="pip-task-decision">
          ${gaps.length ? `<div class="pip-context-gaps" aria-label="Недостающие данные">${gaps.map(gap => `<span>${escapeHtml(gap.label)}</span>`).join('')}</div>` : '<p class="pip-context-ok"><i data-lucide="circle-check"></i>Данных достаточно для обсуждения</p>'}
          ${canDecide
            ? `<button type="button" class="btn btn-primary btn-sm pip-open-decision" data-task-id="${task.id}"><i data-lucide="scale"></i>Принять решение</button>`
            : '<p class="pip-view-only"><i data-lucide="lock-keyhole"></i>Решение фиксирует лидер трайба или проектный офис</p>'}
        </div>
      </article>`;
  }).join('');
  const empty = list.length === 0
    ? `<div class="pip-queue-empty"><i data-lucide="party-popper"></i><h3>Очередь решений разобрана</h3><p>Задач в статусе «Принятие решения» сейчас нет.</p><a class="btn btn-secondary btn-sm" href="#/express-estimate">Открыть экспресс-оценку</a></div>`
    : `<div class="pip-queue-empty"><i data-lucide="list-filter"></i><h3>Нет задач в этом фильтре</h3><p>Переключите представление, чтобы увидеть остальную очередь.</p></div>`;

  return `
    <section class="pip-flow-card" aria-labelledby="pip-flow-title">
      <div class="pip-flow-heading"><div><span class="pip-eyebrow">Сквозной процесс</span><h2 id="pip-flow-title">От бэклога до решения</h2></div><a href="#/express-estimate" class="btn btn-ghost btn-sm"><i data-lucide="arrow-left"></i>Экспресс-оценка</a></div>
      <ol class="pip-flow-steps">
        <li class="is-done"><span>1</span><div><strong>Бэклог</strong><small>Задача подготовлена</small></div></li>
        <li class="is-done"><span>2</span><div><strong>Экспресс-оценка</strong><small>Объём и трудозатраты</small></div></li>
        <li class="is-current" aria-current="step"><span>3</span><div><strong>PI-планирование</strong><small>Текущее решение</small></div></li>
        <li><span>4</span><div><strong>Результат</strong><small>В работу, на оценку или отклонить</small></div></li>
      </ol>
      ${flowNotice}
    </section>
    <section class="pip-summary-grid" aria-label="Сводка очереди решений">
      ${renderPipMetric('Ожидают решения', summary.total)}
      ${renderPipMetric('Полный контекст', `${summary.contextReady} из ${summary.total}`)}
      ${renderPipMetric('Трудозатраты', summary.totalEffort.toLocaleString('ru-RU'), 'ч/д')}
      ${renderPipMetric('Финансовый эффект', summary.totalEffect.toLocaleString('ru-RU'), 'млн ₽')}
      ${renderPipMetric('Средний Priority Score', summary.averagePriority ?? '—')}
    </section>
    <section class="pip-queue" aria-labelledby="pip-queue-title">
      <div class="pip-queue-toolbar">
        <div><h2 id="pip-queue-title">Очередь решений</h2><p>Сначала показаны задачи с более высоким Priority Score.</p></div>
        <div class="pip-filter-group" role="group" aria-label="Фильтр полноты контекста">
          ${[['all', `Все · ${summary.total}`], ['ready', `Контекст заполнен · ${summary.contextReady}`], ['gaps', `Есть пробелы · ${summary.total - summary.contextReady}`]].map(([value, label]) => `<button type="button" class="btn btn-sm ${pipQueueFilter === value ? 'btn-primary is-active' : 'btn-secondary'}" data-pip-filter="${value}" aria-pressed="${pipQueueFilter === value}">${escapeHtml(label)}</button>`).join('')}
        </div>
      </div>
      <div class="pip-task-list">${cards || empty}</div>
    </section>`;
}

function showPipDecisionModal(task, app) {
  document.getElementById('pip-decision-modal')?.remove();
  const gaps = getPipDecisionGaps(task);
  const overlay = document.createElement('div');
  overlay.id = 'pip-decision-modal';
  overlay.className = 'modal-overlay pip-decision-overlay';
  overlay.innerHTML = `
    <div class="app-modal app-modal--medium pip-decision-modal" role="dialog" aria-modal="true" aria-labelledby="pip-decision-title">
      <div class="app-modal__header pip-decision-header">
        <div><span class="pip-eyebrow">${escapeHtml(formatTaskPublicId(task))}</span><h2 id="pip-decision-title">Решение по задаче</h2><p>${escapeHtml(task.title || 'Без названия')}</p></div>
        <button type="button" class="btn btn-ghost btn-icon" data-pip-modal-close data-modal-close aria-label="Закрыть"><i data-lucide="x"></i></button>
      </div>
      <div class="app-modal__body">
        <div class="pip-decision-context">
          <div><span>Команда</span><strong>${escapeHtml(task.team_name || '—')}</strong></div>
          <div><span>Трудозатраты</span><strong>${task.effort_days != null ? `${escapeHtml(String(task.effort_days))} ч/д` : '—'}</strong></div>
          <div><span>Фин. эффект</span><strong>${task.financial_effect != null ? `${Number(task.financial_effect).toLocaleString('ru-RU')} млн ₽` : '—'}</strong></div>
          <div><span>Priority Score</span><strong>${task.priority_score ?? '—'}</strong></div>
        </div>
        ${gaps.length ? `<div class="pip-modal-gaps"><i data-lucide="triangle-alert"></i><div><strong>Контекст неполный</strong><span>${escapeHtml(gaps.map(gap => gap.label).join(' · '))}. Решение доступно, но эти пробелы стоит учесть.</span></div></div>` : ''}
        <fieldset class="pip-decision-options"><legend>Выберите результат PI-планирования</legend>
          ${Object.entries(PIP_DECISION_META).map(([value, meta]) => `<label class="pip-decision-option is-${meta.tone}"><input type="radio" name="pip-decision" value="${value}"><span class="pip-decision-option-icon"><i data-lucide="${meta.icon}"></i></span><span><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(meta.consequence)}</small></span></label>`).join('')}
        </fieldset>
        <div class="pip-decision-consequence" id="pip-decision-consequence" role="status">Выберите результат, чтобы увидеть последствия перехода.</div>
        <div class="form-group pip-decision-reason">
          <label class="form-label" for="pip-decision-reason">Комментарий к решению</label>
          <textarea class="input" id="pip-decision-reason" rows="4" maxlength="2000" placeholder="Сначала выберите результат"></textarea>
          <small id="pip-decision-reason-help">Для принятия комментарий необязателен; для возврата и отклонения — обязателен.</small>
          <div class="input-error" id="pip-decision-error" role="alert" hidden></div>
        </div>
      </div>
      <div class="app-modal__footer pip-decision-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-pip-modal-close>Отмена</button>
        <button type="button" class="btn btn-primary btn-sm" id="pip-decision-submit" disabled><i data-lucide="check"></i>Зафиксировать решение</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  window.lucide?.createIcons();

  const submit = overlay.querySelector('#pip-decision-submit');
  const reason = overlay.querySelector('#pip-decision-reason');
  const error = overlay.querySelector('#pip-decision-error');
  let submitting = false;
  const close = () => { if (!submitting) overlay.remove(); };
  overlay.querySelectorAll('[data-pip-modal-close]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });

  const updateState = () => {
    const decision = overlay.querySelector('input[name="pip-decision"]:checked')?.value;
    const meta = PIP_DECISION_META[decision];
    const required = ['rework', 'reject'].includes(decision);
    submit.disabled = !decision || (required && !reason.value.trim()) || submitting;
    reason.required = required;
    reason.placeholder = meta?.reasonPlaceholder || 'Сначала выберите результат';
    overlay.querySelector('label[for="pip-decision-reason"]').textContent = meta?.reasonLabel || 'Комментарий к решению';
    overlay.querySelector('#pip-decision-reason-help').textContent = required ? 'Обязательное поле: причина сохранится в истории задачи.' : 'Необязательно: зафиксируйте важные договорённости PI.';
    overlay.querySelector('#pip-decision-consequence').textContent = meta?.consequence || 'Выберите результат, чтобы увидеть последствия перехода.';
    error.hidden = true;
  };
  overlay.querySelectorAll('input[name="pip-decision"]').forEach(input => input.addEventListener('change', updateState));
  reason.addEventListener('input', updateState);
  overlay.querySelector('input[name="pip-decision"]')?.focus();

  submit.addEventListener('click', async () => {
    try {
      const decision = overlay.querySelector('input[name="pip-decision"]:checked')?.value;
      const payload = buildPipDecisionPayload({ decision, version: task.version, reason: reason.value });
      submitting = true;
      updateState();
      submit.innerHTML = '<span class="spinner" aria-hidden="true"></span>Сохраняем…';
      await app.api.put(`/tasks/${task.id}/pip-decision`, payload);
      overlay.remove();
      window.toast?.({ accept: 'Задача принята в работу', rework: 'Задача возвращена в экспресс-оценку', reject: 'Задача отклонена' }[decision], 'success');
      await loadReportData(app);
    } catch (requestError) {
      submitting = false;
      updateState();
      submit.innerHTML = '<i data-lucide="check"></i>Зафиксировать решение';
      window.lucide?.createIcons();
      error.textContent = requestError?.status === 409 ? 'Задача уже изменилась. Очередь будет обновлена — откройте решение повторно.' : (window.formatErrorMessage?.(requestError) || requestError.message || 'Не удалось сохранить решение');
      error.hidden = false;
      if (requestError?.status === 409) await loadReportData(app);
    }
  });
}

function filteredAndSortedReportRows(list, ignoredFilterFields = []) {
  list = Array.isArray(list) ? list : [];
  let filtered = list;
  const hasFilters = Object.keys(reportColumnFilters).some(k => reportColumnFilters[k] && reportColumnFilters[k].length);
  if (hasFilters) {
    filtered = list.filter(task =>
      Object.entries(reportColumnFilters).every(([field, vals]) => {
        if (ignoredFilterFields.includes(field)) return true;
        if (!vals || !vals.length) return true;
        return vals.includes(String(task[field] ?? '').trim());
      })
    );
  }

  if (reportSortField) {
    filtered = [...filtered].sort((a, b) => {
      if (['progress', 'planned_progress', 'progress_deviation_percent'].includes(reportSortField)) {
        const left = a[reportSortField] == null ? Number.NEGATIVE_INFINITY : Number(a[reportSortField]);
        const right = b[reportSortField] == null ? Number.NEGATIVE_INFINITY : Number(b[reportSortField]);
        return reportSortDir === 'asc' ? left - right : right - left;
      }
      const va = String(a[reportSortField] ?? '').toLowerCase();
      const vb = String(b[reportSortField] ?? '').toLowerCase();
      return reportSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  return filtered;
}

function renderReportTable(list, fields) {
  list = Array.isArray(list) ? list : [];
  const filtered = filteredAndSortedReportRows(list);

  const hasAnyFilter = Object.keys(reportColumnFilters).some(k => reportColumnFilters[k] && reportColumnFilters[k].length);

  const headers = fields.map(f => {
    const label = getFieldLabel(f);
    const sorted = reportSortField === f;
    const arrow = sorted ? (reportSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const activeVals = reportColumnFilters[f] || [];
    const hasActive = activeVals.length > 0;
    const count = activeVals.length;

    return `<th data-sort="${f}" style="cursor:pointer;user-select:none;white-space:nowrap;text-align:left;border-bottom:1px solid var(--border-color);position:relative">
      <div style="display:flex;align-items:center;gap:4px;justify-content:space-between">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${label}${arrow}</span>
        ${uiButton({ label: `Фильтр: ${label}${count ? `, выбрано ${count}` : ''}`, icon: 'filter', iconOnly: true, size: 'small', variant: 'ghost', className: 'filter-trigger', attrs: { 'data-field': f, 'aria-pressed': hasActive } })}
      </div>
    </th>`;
  }).join('');

  const widths = {
    id: 90, title: 320, task_type_name: 170, team_name: 190,
    effort_days: 155, effort_rub: 165, financial_effect: 135,
    cv: 90, priority_score: 115, progress: currentReport === 'quarterly-goals' ? 150 : 235,
    start_shift_name: 210, planned_progress: 90,
    progress_deviation_percent: 115, progress_indicator: 175, progress_freshness_label: 155,
  };
  const tableWidth = fields.reduce((sum, field) => sum + (widths[field] || 140), 0);
  const colgroup = `<colgroup>${fields.map(f => `<col style="width:${widths[f] || 140}px">`).join('')}</colgroup>`;

  const rows = filtered.map(task => {
    const cells = fields.map(f => `<td style="border-bottom:1px solid var(--border-color);overflow:hidden;text-overflow:ellipsis;${f === 'title' ? 'white-space:normal' : 'white-space:nowrap'}">${renderCell(task, f)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  let footerHtml = `<span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted)">${filtered.length} из ${list.length} задач</span>`;

  if (hasAnyFilter) {
    footerHtml += `<span style="margin-left:12px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:#3b82f6;cursor:pointer;text-decoration:underline" id="report-clear-filters">Сбросить все фильтры</span>`;
  }

  return `
    <div class="table-container" style="overflow-x:auto">
      <table class="ui-table ui-table-data table report-balanced-table" style="width:100%;min-width:${tableWidth}px;table-layout:fixed">
        ${colgroup}
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows || '<tr><td colspan="99" style="text-align:center;color:var(--text-muted)">Нет совпадений</td></tr>'}</tbody>
      </table>
      <div style="padding:8px 12px;">
        ${footerHtml}
      </div>
    </div>`;
}

function quarterlyAverage(items, field) {
  const values = items.map(item => item[field]).filter(value => value != null).map(Number);
  return values.length ? `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}%` : '—';
}

export function summarizeQuarterlyTeams(tasks) {
  const grouped = new Map();
  tasks.forEach(task => {
    const name = task.team_name || 'Без команды';
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(task);
  });
  return [...grouped.entries()].map(([name, items]) => {
    const green = items.filter(item => item.progress_indicator === 'green').length;
    const yellow = items.filter(item => item.progress_indicator === 'yellow').length;
    const red = items.filter(item => item.progress_indicator === 'red').length;
    const dataIssues = items.filter(item => item.progress_freshness !== 'current').length;
    const confirmedAttention = items.filter(item =>
      item.progress_freshness === 'current' && ['yellow', 'red'].includes(item.progress_indicator)
    ).length;
    return { name, items, green, yellow, red, dataIssues, confirmedAttention, attention: dataIssues + confirmedAttention };
  }).sort((a, b) => b.attention - a.attention || a.name.localeCompare(b.name, 'ru'));
}

export function renderQuarterlyTeamSummary(tasks) {
  const colorFiltered = filteredAndSortedReportRows(tasks, ['team_name']);
  const activeTeam = (reportColumnFilters.team_name || [])[0] || '';
  const teams = summarizeQuarterlyTeams(colorFiltered);

  const rows = teams.map(team => `
    <tr class="${activeTeam === team.name ? 'is-selected' : ''}">
      <td><button type="button" class="ui-surface-action quarterly-team-select" data-quarterly-team="${escapeHtml(team.name)}">${escapeHtml(team.name)}</button></td>
      <td><strong>${team.items.length}</strong></td><td>${team.green}</td><td>${team.yellow}</td><td>${team.red}</td>
      <td>${quarterlyAverage(team.items, 'planned_progress')}</td><td>${quarterlyAverage(team.items, 'progress')}</td>
      <td><strong class="${team.confirmedAttention ? 'text-danger' : 'text-success'}">${team.confirmedAttention}</strong></td>
      <td><strong class="${team.dataIssues ? 'text-warning' : 'text-success'}">${team.dataIssues}</strong></td>
    </tr>`).join('');

  return `<section class="card quarterly-team-summary" aria-labelledby="quarterly-team-summary-title">
    <div class="card-header quarterly-team-summary__header">
      <div><h2 class="card-title" id="quarterly-team-summary-title">Сводка по командам</h2><p>Команды с наибольшим числом отклонений показаны первыми.</p></div>
      ${activeTeam ? `<button type="button" class="btn btn-ghost btn-sm" data-quarterly-team=""><i data-lucide="x"></i>Все команды</button>` : ''}
    </div>
    <div class="table-container"><table class="ui-table ui-table-data table quarterly-team-table"><thead><tr><th>Команда</th><th>Всего</th><th><span class="quarterly-dot is-green"></span>Зелёные</th><th><span class="quarterly-dot is-yellow"></span>Жёлтые</th><th><span class="quarterly-dot is-red"></span>Красные</th><th>Средний план</th><th>Средний факт</th><th>Подтверждённое отставание</th><th>Проблемы данных</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="text-muted">Нет команд по выбранному цвету</td></tr>'}</tbody></table></div>
  </section>`;
}

function renderQuarterlyGoalsBody(tasks, fields) {
  const visible = filteredAndSortedReportRows(tasks);
  const activeTeam = (reportColumnFilters.team_name || [])[0];
  const missing = visible.filter(item => item.progress_freshness === 'missing').length;
  const needsRefresh = visible.filter(item => ['unconfirmed', 'stale'].includes(item.progress_freshness)).length;
  const confirmedGap = visible.filter(item => item.progress_freshness === 'current' && ['yellow', 'red'].includes(item.progress_indicator)).length;
  return `<section class="quarterly-data-quality" aria-label="Качество данных отчёта">
      <div><i data-lucide="database-zap" aria-hidden="true"></i><span><strong>${missing + needsRefresh} требуют обновления</strong><small>${missing} без факта · ${needsRefresh} устарели или не подтверждены</small></span></div>
      <div><i data-lucide="chart-no-axes-column-decreasing" aria-hidden="true"></i><span><strong>${confirmedGap} с подтверждённым отставанием</strong><small>По актуальному факту</small></span></div>
    </section>${renderQuarterlyTeamSummary(tasks)}
    <section class="quarterly-goals-detail" aria-labelledby="quarterly-goals-detail-title">
      <div class="quarterly-goals-detail__header"><div><h2 id="quarterly-goals-detail-title">Детализация целей и AD-HOC</h2><p>${activeTeam ? `Команда: ${escapeHtml(activeTeam)}` : 'Все команды текущего квартала'}</p></div><span>${visible.length} из ${tasks.length} задач</span></div>
      ${renderReportTable(tasks, fields)}
    </section>`;
}

function exportReportExcel(kind, tasks, app) {
  const config = reportConfig[kind];
  if (!config || !tasks.length) return;
  const fields = resolveReportFields(config);
  const headers = fields.map(f => getFieldLabel(f));
  const rows = tasks.map(task => fields.map(f => {
    const val = task[f];
    return val !== null && val !== undefined ? String(val) : '';
  }));
  if (typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = fields.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Отчёт');
    XLSX.writeFile(wb, `${kind}_report.xlsx`);
  } else {
    const csv = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${kind}_report.csv`;
    link.click();
  }
}

function openMeetingReport(kind, app) {
  currentReport = kind;
  app.router.navigate('/reports/detail?r=' + kind);
}

async function loadReportData(app) {
  const config = reportConfig[currentReport];
  if (!config) return;
  try {
    Object.keys(reportChartInstances).forEach(k => { reportChartInstances[k]?.destroy(); delete reportChartInstances[k]; });
    if (config.isPlaceholder) {
      renderPlaceholderReport(config, currentReport);
      return;
    }
    if (config.isDb) {
      await fetchDbReports(app);
      const rep = dbReportsCache[config.key];
      if (!rep) {
        throw new Error('Отчёт не зарегистрирован в системе. Обновите страницу или обратитесь к администратору.');
      }
      cachedDbReport = rep;
      const execData = await app.api.get(`/reports/${rep.id}/execute`);
      cachedReportData = execData;
      tasksCache = execData.items || [];
      reportSortField = null;
      reportSortDir = 'asc';
      reportColumnFilters = {};
      renderReportContent(config, currentReport, execData);
      return;
    }
    if (config.customEndpoint) {
      const data = await app.api.get(config.customEndpoint);
      cachedReportData = data;
      if (currentReport === 'team-weekly') tasksCache = data.items || [];
      renderReportContent(config, currentReport, data);
    } else {
      const data = await app.api.get('/tasks/?per_page=1000');
      tasksCache = data.items || [];
      reportSortField = null;
      reportSortDir = 'asc';
      reportColumnFilters = {};
      const filtered = applyReportFilters(currentReport, tasksCache);
      renderReportContent(config, currentReport, filtered);
    }
  } catch (e) {
    const body = document.getElementById('report-body');
    if (body) {
      body.innerHTML = renderViewState({ kind: e.status === 403 ? 'forbidden' : 'error', title: 'Не удалось загрузить отчёт', message: e.message, actionLabel: 'Повторить' });
      bindViewStateAction(body, () => loadReportData(app));
    }
  }
}

const WEEKLY_SIGNAL_META = {
  decision: { label: 'Нужно решение', icon: 'message-square-warning' },
  blocker: { label: 'Блокер', icon: 'octagon-alert' },
  risk: { label: 'Риск', icon: 'triangle-alert' },
  on_track: { label: 'По плану', icon: 'circle-check' },
};

function formatWeeklyDate(value, options = { day: 'numeric', month: 'short' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', options).format(new Date(`${value}T12:00:00`)).replace('.', '');
}

function weeklySummary(items) {
  const ready = items.filter(item => item.is_ready).length;
  const completed = items.filter(item => item.is_completed_this_week).length;
  const attention = items.filter(item => ['decision', 'blocker', 'risk'].includes(item.signal)).length;
  const deltas = items.map(item => item.progress_delta).filter(value => Number.isFinite(value));
  return {
    total: items.length,
    ready,
    completed,
    active: Math.max(0, items.length - completed),
    attention,
    stale: items.length - ready,
    readiness: items.length ? Math.round(ready / items.length * 100) : 0,
    delta: deltas.length ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : null,
  };
}

function weeklyTaskCard(item) {
  const signal = WEEKLY_SIGNAL_META[item.signal] || WEEKLY_SIGNAL_META.on_track;
  const delta = Number.isFinite(item.progress_delta)
    ? `<span class="team-weekly-delta ${item.progress_delta >= 0 ? 'is-positive' : 'is-negative'}">${item.progress_delta >= 0 ? '+' : ''}${item.progress_delta} п.п.</span>`
    : '';
  return `<article class="team-weekly-task signal-${escapeHtml(item.signal || 'on_track')}" data-weekly-task="${item.task_id}">
    <header class="team-weekly-task-head">
      <button type="button" class="ui-link team-weekly-task-title" data-open-weekly-task="${item.task_id}"><span>${escapeHtml(item.public_id)}</span><strong>${escapeHtml(item.title || 'Без названия')}</strong><i data-lucide="arrow-up-right"></i></button>
      <span class="team-weekly-signal"><i data-lucide="${signal.icon}"></i>${signal.label}</span>
    </header>
    <div class="team-weekly-task-grid">
      <section><span>Результат недели</span><p>${escapeHtml(item.result || 'Ещё не заполнен')}</p></section>
      <section><span>Следующий шаг</span><p>${escapeHtml(item.next_step || 'Не указан')}${item.next_step_due ? `<small>До ${escapeHtml(formatWeeklyDate(item.next_step_due, { day: 'numeric', month: 'long' }))}</small>` : ''}</p></section>
    </div>
    ${item.decision_request ? `<div class="team-weekly-decision"><i data-lucide="message-square-warning"></i><div><span>Вопрос на встречу</span><strong>${escapeHtml(item.decision_request)}</strong></div></div>` : ''}
    <footer class="team-weekly-task-meta">
      <span><i data-lucide="folder-kanban"></i>${escapeHtml(item.project_name || 'Без проекта')}</span>
      <span><i data-lucide="user-round"></i>${escapeHtml(item.owner_name || 'Не назначен')}</span>
      <span><i data-lucide="activity"></i>${Number(item.progress || 0)}% ${delta}</span>
      <span><i data-lucide="circle-dot"></i>${escapeHtml(item.status_name || 'Без статуса')}</span>
    </footer>
  </article>`;
}

export function renderTeamWeeklyReport(data) {
  const allItems = Array.isArray(data.items) ? data.items : [];
  const teams = Array.isArray(data.teams) ? data.teams : [];
  if (teamWeeklyTeamId && !teams.some(team => String(team.id) === String(teamWeeklyTeamId))) teamWeeklyTeamId = '';
  if (!teamWeeklyTeamId && teams.length === 1) teamWeeklyTeamId = String(teams[0].id);
  const teamItems = teamWeeklyTeamId
    ? allItems.filter(item => String(item.team_id) === String(teamWeeklyTeamId))
    : allItems;
  const summary = weeklySummary(teamItems);
  const visible = teamItems.filter(item => {
    if (teamWeeklyFilter === 'attention') return ['decision', 'blocker', 'risk'].includes(item.signal);
    if (teamWeeklyFilter === 'completed') return item.is_completed_this_week;
    if (teamWeeklyFilter === 'stale') return !item.is_ready;
    return true;
  });
  const meeting = data.meeting || {};
  const range = meeting.scheduled_date && meeting.week_end
    ? `${formatWeeklyDate(meeting.scheduled_date)}–${formatWeeklyDate(meeting.week_end, { day: 'numeric', month: 'long' })}`
    : 'Текущая неделя';
  const activeTeam = teams.find(team => String(team.id) === String(teamWeeklyTeamId));
  const teamLabel = activeTeam?.name || (teams.length > 1 ? 'Все команды' : teams[0]?.name || 'Команда');
  const nextDue = teamItems.map(item => item.next_step_due).filter(Boolean).sort()[0];
  const filters = [
    ['attention', 'Требуют внимания', summary.attention],
    ['completed', 'Завершено', summary.completed],
    ['stale', 'Без обновления', summary.stale],
    ['all', 'Все задачи', summary.total],
  ];
  return `<section class="team-weekly-report" aria-labelledby="team-weekly-focus-title">
    <div class="team-weekly-context">
      <div><span>Пульс команды</span><strong>${escapeHtml(teamLabel)}</strong><small>${escapeHtml(range)}</small></div>
      ${teams.length > 1 ? `<label><span class="sr-only">Команда</span><select class="input" data-team-weekly-team><option value="">Все команды</option>${teams.map(team => `<option value="${team.id}" ${String(team.id) === String(teamWeeklyTeamId) ? 'selected' : ''}>${escapeHtml(team.name)}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="team-weekly-kpis" aria-label="Сводка недели">
      <button class="ui-surface-action" type="button" data-weekly-filter="all"><i data-lucide="badge-check"></i><span><small>Готовность</small><strong>${summary.readiness}%</strong><em>${summary.ready} из ${summary.total}</em></span></button>
      <button class="ui-surface-action" type="button" data-weekly-filter="completed"><i data-lucide="circle-check-big"></i><span><small>Завершено</small><strong>${summary.completed}</strong><em>за неделю</em></span></button>
      <button class="ui-surface-action" type="button" data-weekly-filter="all"><i data-lucide="workflow"></i><span><small>В работе</small><strong>${summary.active}</strong><em>активных</em></span></button>
      <button class="ui-surface-action" type="button" data-weekly-filter="attention"><i data-lucide="triangle-alert"></i><span><small>Внимание</small><strong>${summary.attention}</strong><em>риск/решение</em></span></button>
      <button class="ui-surface-action" type="button" data-weekly-filter="stale"><i data-lucide="clock-alert"></i><span><small>Без обновления</small><strong>${summary.stale}</strong><em>нужен статус</em></span></button>
    </div>
    <div class="team-weekly-layout">
      <main class="team-weekly-main">
        <div class="team-weekly-section-head"><div><span>Повестка</span><h2 id="team-weekly-focus-title">Фокус встречи</h2></div><strong>${visible.length}</strong></div>
        <div class="team-weekly-filterbar" role="group" aria-label="Фильтр задач">${filters.map(([key, label, count]) => `<button type="button" class="btn btn-secondary btn-sm ui-btn ${teamWeeklyFilter === key ? 'is-active' : ''}" data-weekly-filter="${key}" aria-pressed="${teamWeeklyFilter === key}">${label}<span>${count}</span></button>`).join('')}</div>
        <div class="team-weekly-list">${visible.length ? visible.map(weeklyTaskCard).join('') : renderViewState({ kind: 'empty', title: 'В этой группе нет задач', message: 'Выберите другой фильтр или обновите статусы.' })}</div>
      </main>
      <aside class="team-weekly-rhythm">
        <div class="team-weekly-rhythm-head"><span><i data-lucide="activity"></i></span><div><small>Динамика</small><h2>Ритм команды</h2></div></div>
        <div class="team-weekly-readiness-ring" style="--weekly-readiness:${summary.readiness}%"><strong>${summary.readiness}%</strong><span>статусов готово</span></div>
        <dl>
          <div><dt>Средний сдвиг прогресса</dt><dd>${summary.delta == null ? '—' : `${summary.delta >= 0 ? '+' : ''}${summary.delta} п.п.`}</dd></div>
          <div><dt>Ближайший следующий шаг</dt><dd>${nextDue ? escapeHtml(formatWeeklyDate(nextDue, { day: 'numeric', month: 'long' })) : '—'}</dd></div>
          <div><dt>Решений требуется</dt><dd>${teamItems.filter(item => item.signal === 'decision').length}</dd></div>
          <div><dt>Блокеров</dt><dd>${teamItems.filter(item => item.signal === 'blocker').length}</dd></div>
        </dl>
        <a class="btn btn-primary" href="${reportingStatusHref({ source: 'report', kind: 'team_weekly', meetingId: meeting.id || '' })}"><i data-lucide="clipboard-pen-line"></i>Обновить пульс</a>
      </aside>
    </div>
  </section>`;
}

function renderReportContent(config, reportKey, data) {
  const body = document.getElementById('report-body');
  if (!body) return;

  if (reportKey === 'team-weekly') {
    body.innerHTML = renderTeamWeeklyReport(data || {});
    window.lucide?.createIcons();
    return;
  }

  if (config.isCustom && data && data.teams) {
    if (!data.teams.length) {
      body.innerHTML = renderReportTable([], config.fields);
      return;
    }
    body.innerHTML = data.teams.map((team, teamIndex) => {
      const storageKey = 'did-team-collapsed-' + team.team_name;
      const isCollapsed = localStorage.getItem(storageKey) === 'true';
      return `
        <div class="card" style="margin-bottom:var(--space-4);">
          <div class="card-header did-team-header" data-team="${escapeHtml(team.team_name)}" style="cursor:pointer;">
            <div style="display:flex;align-items:center;gap:8px;">
              ${uiButton({ label: `Развернуть или свернуть команду ${team.team_name}`, icon: 'chevron-down', iconOnly: true, variant: 'ghost', size: 'small', className: 'did-team-toggle', attrs: { 'aria-expanded': !isCollapsed, 'aria-controls': `did-team-body-${teamIndex}` } })}
              <h3 class="card-title">${escapeHtml(smartCap(team.team_name))}</h3>
            </div>
            <span class="badge badge-info">${team.total} ${formatCount(team.total)}</span>
          </div>
          <div id="did-team-body-${teamIndex}" class="report-group-body ${isCollapsed ? 'collapsed' : ''}" ${isCollapsed ? 'hidden' : ''}>
            ${renderReportTable(team.tasks, config.fields)}
          </div>
        </div>`;
    }).join('');

    if (window.lucide) lucide.createIcons();

    body.querySelectorAll('.did-team-header').forEach(header => {
      header.addEventListener('click', function (e) {
        if (e.target.closest('.filter-trigger')) return;
        const teamName = this.dataset.team;
        const card = this.closest('.card');
        const groupBody = card.querySelector('.report-group-body');
        const toggle = card.querySelector('.did-team-toggle');
        const isCollapsed = groupBody.classList.toggle('collapsed');
        localStorage.setItem('did-team-collapsed-' + teamName, isCollapsed);
        groupBody.hidden = isCollapsed;
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
      });
    });
    return;
  }

  const tasks = Array.isArray(data) ? data : (data && data.items ? data.items : []);
  if (reportKey === 'pip') {
    body.innerHTML = renderPipDecisionWorkspace(tasks);
    window.lucide?.createIcons();
    return;
  }
  const total = tasks.length;
  const high = tasks.filter(t => String(t.priority_name || t.priority || '').toUpperCase() === 'ВЫСОКИЙ').length;
  const statusField = config.isDb ? 'status_name' : (reportKey === 'directorate' ? 'directorate_status' : reportKey === 'did' ? 'did_status' : 'status');
  const riskStatuses = reportKey === 'directorate' ? ['Риск','На контроле'] : reportKey === 'did' ? ['Блокировано','Требует решения'] : ['Холд','Эскалация на ЛТ','Отклонена','Не актуальна'];
  const risk = tasks.filter(t => riskStatuses.some(s => String(t[statusField] || '').toUpperCase() === s.toUpperCase())).length;
  const avg = total ? Math.round(tasks.reduce((s, t) => s + (t.progress || 0), 0) / total) : 0;

  if (reportKey === 'quarterly-goals') {
    const green = tasks.filter(t => t.progress_indicator === 'green').length;
    const yellow = tasks.filter(t => t.progress_indicator === 'yellow').length;
    const red = tasks.filter(t => t.progress_indicator === 'red').length;
    const redDataIssues = tasks.filter(t =>
      t.progress_indicator === 'red' && t.progress_freshness !== 'current'
    ).length;
    const redConfirmed = red - redDataIssues;
    const progressCounts = {
      'progress-total': total,
      'progress-green': green,
      'progress-yellow': yellow,
      'progress-red': red,
    };
    Object.entries(progressCounts).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
    const redContext = document.getElementById('progress-red-context');
    if (redContext) {
      redContext.textContent = `${redConfirmed} по прогрессу · ${redDataIssues} из-за данных`;
    }
    updateProgressWidgetState();
  }

  if (!config.isCustom && !config.hideCharts) renderReportCharts(tasks);

  const totalEl = document.getElementById('report-total');
  const highEl = document.getElementById('report-high');
  const riskEl = document.getElementById('report-risk');
  const avgEl = document.getElementById('report-avg');
  if (totalEl) totalEl.textContent = total;
  if (highEl) highEl.textContent = high;
  if (riskEl) riskEl.textContent = risk;
  if (avgEl) avgEl.textContent = avg + '%';

  const fields = resolveReportFields(config);

  if (!tasks.length) {
    body.innerHTML = '<div class="empty-state"><p class="text-muted">Нет данных для отображения</p></div>';
    return;
  }

  if (reportKey === 'quarterly-goals') {
    body.innerHTML = renderQuarterlyGoalsBody(tasks, fields);
    window.lucide?.createIcons();
    return;
  }

  if (data && data.grouped && data.groups) {
    body.innerHTML = data.groups.map(group => `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-header">
          <h3 class="card-title">${escapeHtml(group.name)}</h3>
          <span class="badge badge-info">${group.count} ${formatCount(group.count)}</span>
        </div>
        ${renderReportTable(group.items, fields)}
      </div>
    `).join('');
    return;
  }

  if (config.group) {
    const groupField = config.group;
    const groups = {};
    tasks.forEach(t => {
      const key = t[groupField] || 'Без группы';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    body.innerHTML = sortedGroups.map(([groupName, groupTasks]) => `
      <div class="card" style="margin-bottom:var(--space-4);">
        <div class="card-header">
          <h3 class="card-title">${escapeHtml(groupName)}</h3>
          <span class="badge badge-info">${groupTasks.length} ${formatCount(groupTasks.length)}</span>
        </div>
        ${renderReportTable(groupTasks, fields)}
      </div>
    `).join('');
  } else {
    body.innerHTML = renderReportTable(tasks, fields);
  }
}

function renderPlaceholderReport(config, reportKey) {
  const body = document.getElementById('report-body');
  if (!body) return;
  body.innerHTML = `
    <div class="empty-state" style="text-align:center;padding:var(--space-8);">
      <i data-lucide="${config.icon}" style="width:48px;height:48px;color:var(--text-muted);margin:0 auto 12px;display:block;"></i>
      <h3 style="font-size:var(--text-lg);font-weight:600;color:var(--text-primary);margin-bottom:8px;">${config.name}</h3>
      <p class="text-muted" style="max-width:420px;margin:0 auto;">Отчёт в разработке. Здесь появится содержимое страницы.</p>
    </div>`;
  if (window.lucide) lucide.createIcons();
}

function formatCount(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'задача';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'задачи';
  return 'задач';
}

function renderReportCountLoader() {
  return '<span class="spinner report-count-spinner" aria-hidden="true"></span><span class="sr-only">Загрузка количества задач</span>';
}

function setReportCountLoading() {
  document.querySelectorAll('[id^="count-"]').forEach(el => {
    el.innerHTML = renderReportCountLoader();
    el.setAttribute('aria-label', 'Загрузка количества задач');
  });
}

function setReportCount(el, value, label) {
  el.textContent = value;
  el.setAttribute('aria-label', label);
}

export function bindReportCardNavigation(app, root = document.getElementById('reports-content')) {
  if (!root || root.dataset.reportNavigationBound === 'true') return false;
  root.dataset.reportNavigationBound = 'true';

  const openCard = target => {
    const card = target?.closest?.('.report-card');
    if (!card || !root.contains(card)) return false;
    openMeetingReport(card.dataset.report, app);
    return true;
  };

  root.addEventListener('click', event => openCard(event.target));
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (openCard(event.target)) event.preventDefault();
  });
  return true;
}

export function renderReports(app) {
  const standardKeys = ['directorate', 'did-operational', 'pip', 'did-backlog', 'quarterly-goals', 'pd-estimates'];
  const customKeys = ['reg-directors'];

  function renderCard(key, cfg) {
    return `
      <div class="cursor-pointer ${cfg.gradient} report-card" data-report="${key}" role="link" tabindex="0" aria-label="Открыть отчёт: ${escapeHtml(cfg.name)}" style="border-radius:16px;padding:24px;color:white;display:flex;flex-direction:column;min-height:282px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-shrink:0;">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i data-lucide="${cfg.icon}" style="width:20px;height:20px;"></i>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            ${cfg.inDevelopment ? '<span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);font-weight:600;background:rgba(250,204,21,0.22);color:#fde047;border:1px solid rgba(250,204,21,0.5);padding:3px 9px;border-radius:999px;white-space:nowrap;">В разработке</span>' : ''}
            <i data-lucide="arrow-up-right" style="width:20px;height:20px;opacity:0.6;flex-shrink:0;"></i>
          </div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;min-height:0;">
          <div class="rc-name">${cfg.name}</div>
          <div class="rc-desc">${cfg.desc}</div>
        </div>
        <div style="margin-top:auto;flex-shrink:0;">
          ${cfg.isPlaceholder ? '' : `
            <div class="report-count" id="count-${key}" role="status" aria-live="polite" aria-label="Загрузка количества задач">${renderReportCountLoader()}</div>
            <div style="font-size:12px;opacity:0.8;line-height:18px;height:18px;">задач</div>
          `}
        </div>
      </div>`;
  }

  const standardCards = standardKeys.map(k => renderCard(k, reportConfig[k])).join('');
  const customCards = customKeys.map(k => renderCard(k, reportConfig[k])).join('');
  const weekly = reportConfig['team-weekly'];
  const weeklyCard = `<div class="team-weekly-feature report-card" data-report="team-weekly" role="link" tabindex="0" aria-label="Открыть отчёт: ${escapeHtml(weekly.name)}">
    <div class="team-weekly-feature-icon"><i data-lucide="${weekly.icon}"></i></div>
    <div class="team-weekly-feature-copy"><span>Командный пульс</span><h2>${weekly.name}</h2><p>${weekly.desc}</p></div>
    <div class="team-weekly-feature-readiness"><strong class="report-count" id="count-team-weekly" role="status" aria-live="polite" aria-label="Загрузка количества задач">${renderReportCountLoader()}</strong><span>задач в текущей неделе</span></div>
    <div class="team-weekly-feature-action"><span>Открыть встречу</span><i data-lucide="arrow-right"></i></div>
  </div>`;

  return `
    <div class="page-header reporting-status-page-header animate-fade-in">
      ${uiPageHeader({
        title: 'Статусы для встреч',
        description: 'Готовые отчёты для оперативок и директорских',
        className: 'reports-page-header',
        actions: `<div class="flex gap-2 flex-wrap"><a class="btn btn-primary btn-sm" href="${quarterlyGoalsUpdateHref({ source: 'report' })}"><i data-lucide="gauge"></i>Обновить прогресс и статусы</a>${canUseReportingStatusWorkspace(app) ? `<a class="btn btn-secondary btn-sm" href="${reportingStatusHref({ source: 'report' })}"><i data-lucide="pencil"></i>Заполнить статусы встреч</a>` : ''}</div>`,
      })}
    </div>
    <div id="reports-content">
    ${weeklyCard}
    <div style="margin-bottom:32px;">
      <h3 class="text-xs font-bold text-muted" style="text-transform:uppercase;letter-spacing:0.05em;margin-bottom:16px;">Стандартные отчёты</h3>
      <div class="reports-grid">
        ${standardCards}
      </div>
    </div>
    <div>
      <h3 class="text-xs font-bold text-muted" style="text-transform:uppercase;letter-spacing:0.05em;margin-bottom:16px;">Пользовательские отчёты</h3>
      <div class="reports-grid">
        ${customCards}
        <div class="card" style="display:flex;align-items:center;justify-content:center;border:2px dashed var(--border-color);cursor:pointer;border-radius:16px;padding:24px;" onclick="toast('Создание пользовательского отчёта — в разработке','info')">
          <div style="text-align:center;">
            <i data-lucide="plus-circle" style="width:40px;height:40px;color:var(--text-muted);margin:0 auto 8px;display:block;"></i>
            <div style="font-size:14px;font-weight:600;color:var(--text-primary);">Добавить свой отчёт</div>
            <div class="text-xs text-muted">Настраиваемый под себя</div>
          </div>
        </div>
      </div>
    </div>
    </div>`;
}

export function renderReportingMeetingsManagement() {
  return `<div class="page-header animate-fade-in">
    ${uiPageHeader({ title: 'Управление отчётными встречами', description: 'Расписание, готовность статусов и фиксация версий после проведения встречи' })}
  </div>
  <aside class="meeting-status-help" aria-labelledby="meeting-status-help-title">
    <div class="meeting-status-help-head">
      <span class="meeting-status-help-icon"><i data-lucide="info"></i></span>
      <div><h2 id="meeting-status-help-title">Как работают отчётные статусы</h2><p>Коротко о подготовке и фиксации статусов к каждой встрече.</p></div>
      ${canManageReportingMeetings ? '<span class="badge badge-info">Управление доступно</span>' : ''}
    </div>
    <section class="meeting-status-help-flow" aria-label="Жизненный цикл статусов">
      <div><span>1</span><strong>Подготовка</strong><small>Команды обновляют и подтверждают статусы</small></div>
      <i data-lucide="arrow-right"></i>
      <div><span>2</span><strong>Проведение</strong><small>Проектный офис фиксирует состоявшуюся встречу</small></div>
      <i data-lucide="arrow-right"></i>
      <div><span>3</span><strong>История</strong><small>Подтверждённые статусы сохраняются как срез</small></div>
    </section>
  </aside>
  <section id="reporting-meetings-panel" class="reporting-meetings-panel"><div class="card content-loading-state">Загрузка отчётных встреч…</div></section>`;
}

export async function initReportingMeetingsManagement(app) {
  await loadReportingMeetings(app);
  const panel = document.getElementById('reporting-meetings-panel');
  panel?.addEventListener('click', event => {
      const button = event.target.closest('[data-meeting-action]');
      if (button) handleReportingMeetingAction(button, app);
      const view = event.target.closest('[data-meeting-view]');
      if (view) { meetingView = view.dataset.meetingView; renderReportingMeetingsPanel(); }
      const reset = event.target.closest('[data-meeting-reset]');
      if (reset) { meetingFilters = { kind: 'all', state: 'open', from: '', to: '' }; renderReportingMeetingsPanel(); }
      const retry = event.target.closest('[data-meeting-retry]');
      if (retry) loadReportingMeetings(app);
      const jump = event.target.closest('[data-meeting-jump]');
      if (jump) {
        meetingView = 'cards';
        meetingFilters.state = 'all';
        renderReportingMeetingsPanel();
        requestAnimationFrame(() => document.querySelector(`[data-meeting-card="${jump.dataset.meetingJump}"]`)?.focus?.());
      }
  });
  panel?.addEventListener('change', event => {
      const input = event.target.closest('[data-meeting-filter]');
      if (!input) return;
      meetingFilters[input.dataset.meetingFilter] = input.value;
      renderReportingMeetingsPanel();
  });
  panel?.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.meeting-fill-status.is-actionable')) {
        event.preventDefault();
        handleReportingMeetingAction(event.target, app);
      }
  });
}

export async function initReports(app) {
  bindReportCardNavigation(app);
  setReportCountLoading();
  try {
    const data = await app.api.get('/tasks/?per_page=1000');
    tasksCache = data.items || [];

    await fetchDbReports(app);

    await Promise.all(Object.keys(reportConfig).map(async key => {
      const config = reportConfig[key];
      const el = document.getElementById(`count-${key}`);
      if (!el || config.isPlaceholder) return;
      if (config.isDb) {
        const rep = dbReportsCache[config.key];
        if (!rep) { setReportCount(el, '—', 'Количество задач недоступно'); return; }
        try {
          const execData = await app.api.get(`/reports/${rep.id}/execute`);
          const count = (execData && execData.total != null) ? execData.total : 0;
          setReportCount(el, count, `Задач: ${count}`);
        } catch (e) { setReportCount(el, '—', 'Количество задач недоступно'); }
        return;
      }
      if (config.customEndpoint) {
        try {
          const d = await app.api.get(config.customEndpoint);
          const count = d?.total_tasks ?? d?.summary?.total ?? 0;
          setReportCount(el, count, `Задач: ${count}`);
        } catch (e) { setReportCount(el, '—', 'Количество задач недоступно'); }
        return;
      }
      const filtered = applyReportFilters(key, tasksCache);
      setReportCount(el, filtered.length, `Задач: ${filtered.length}`);
    }));

    document.getElementById('refresh-reports')?.addEventListener('click', () => {
      initReports(app);
    });
  } catch (e) {
    console.error('Reports load error:', e);
    const content = document.getElementById('reports-content');
    if (content) {
      content.innerHTML = renderViewState({
        kind: 'error',
        message: window.formatErrorMessage?.(e) || 'Повторите попытку позже.',
        actionLabel: 'Повторить',
      });
      bindViewStateAction(content, async () => {
        const page = document.getElementById('page-content');
        if (!page) return;
        page.innerHTML = renderReports(app);
        window.lucide?.createIcons();
        await initReports(app);
      });
      window.lucide?.createIcons();
    }
  }
}

function updateProgressWidgetState() {
  const active = reportColumnFilters.progress_indicator || [];
  document.querySelectorAll('.progress-widget').forEach(widget => {
    const filter = widget.dataset.progressFilter;
    const isActive = filter === 'all'
      ? active.length === 0
      : filter === 'deviations'
        ? active.length === 2 && active.includes('yellow') && active.includes('red')
        : active.length === 1 && active[0] === filter;
    widget.setAttribute('aria-pressed', String(isActive));
    widget.style.outline = isActive ? '2px solid var(--accent)' : 'none';
    widget.style.outlineOffset = isActive ? '-2px' : '';
  });
}

const reportChartInstances = {};
const reportChartLoads = new Map();

let reportChartThemeObserver;
function getReportChartColors() {
  const theme = chartJsTheme();
  return { textColor: theme.text, gridColor: theme.grid, bgCard: theme.background };
}

async function createReportChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const generation = Symbol();
  reportChartLoads.set(canvasId, generation);
  await loadChartFont();
  if (reportChartLoads.get(canvasId) !== generation) return;
  reportChartLoads.delete(canvasId);
  if (!canvas.isConnected || document.getElementById(canvasId) !== canvas) return;
  if (reportChartInstances[canvasId]) {
    reportChartInstances[canvasId].destroy();
  }
  const ctx = canvas.getContext('2d');
  reportChartInstances[canvasId] = new window.Chart(ctx, config);
  applyChartJsTheme(reportChartInstances[canvasId]);
  if (!reportChartThemeObserver) {
    reportChartThemeObserver = new MutationObserver(() => {
      Object.entries(reportChartInstances).forEach(([key, chart]) => {
        if (!chart.canvas?.isConnected) { chart.destroy(); delete reportChartInstances[key]; }
        else applyChartJsTheme(chart);
      });
      if (!Object.keys(reportChartInstances).length) { reportChartThemeObserver.disconnect(); reportChartThemeObserver = null; }
    });
    reportChartThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
  }
}

function renderReportCharts(tasks) {
  const { textColor, gridColor } = getReportChartColors();

  function commonOpts(title) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: { display: false },
        title: {
          display: !!title,
          text: title || '',
          color: textColor,
          font: { size: 13, weight: '600' },
          padding: { bottom: 12 },
        },
      },
      scales: {
        x: {
          ticks: { color: textColor, font: { size: 11 } },
          grid: { color: gridColor },
        },
        y: {
          ticks: { color: textColor, font: { size: 11 } },
          grid: { color: gridColor },
          beginAtZero: true,
        },
      },
    };
  }

  const byStatus = {};
  const byPriority = {};
  const byTeam = {};

  tasks.forEach(t => {
    const st = t.status_name || t.status || 'Не указан';
    byStatus[st] = (byStatus[st] || 0) + 1;
    byPriority[t.priority_name || t.priority || 'СРЕДНИЙ'] = (byPriority[t.priority_name || t.priority || 'СРЕДНИЙ'] || 0) + 1;
    const team = t.team_name || 'Без команды';
    byTeam[team] = (byTeam[team] || 0) + 1;
  });

  const palette = chartPalette();
  const statusTones = { 'НОВАЯ ЗАДАЧА':0, 'НАЗНАЧЕНА КОМАНДА':3, 'СБОР ТРЕБОВАНИЙ':0, 'ПРОВЕРКА ТРЕБОВАНИЙ':3, 'УТОЧНЕНИЕ ТРЕБОВАНИЙ':3, 'ЭКСПРЕСС-ОЦЕНКА':3, 'ПРИНЯТИЕ РЕШЕНИЯ':1, 'ПРИНЯТА В РАБОТУ':2, 'ЭСКАЛАЦИЯ НА ЛТ':8, 'ХОЛД':5, 'ОТКЛОНЕНА':5, 'НЕ АКТУАЛЬНА':6, 'ВЫПОЛНЕНА':2 };

  const statusLabels = Object.keys(byStatus);
  const statusValues = Object.values(byStatus);
  const statusColorsArr = statusLabels.map(l => palette[statusTones[String(l || '').toUpperCase()] ?? 6]);

  createReportChart('chart-report-status', {
    type: 'bar',
    data: {
      labels: statusLabels,
      datasets: [{
        label: 'Задач',
        data: statusValues,
        backgroundColor: statusColorsArr,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      ...commonOpts('Распределение по статусам'),
      plugins: {
        ...commonOpts().plugins,
        legend: { display: false },
      },
      scales: {
        ...commonOpts().scales,
        x: { ...commonOpts().scales.x, grid: { display: false } },
      },
    },
  });

  const priorityLabels = Object.keys(byPriority);
  const priorityValues = Object.values(byPriority);
  const priorityColors = priorityLabels.map(l => {
    if (l === 'ВЫСОКИЙ') return palette[5];
    if (l === 'СРЕДНИЙ') return palette[1];
    return palette[6];
  });
  const priorityTotal = priorityValues.reduce((s, v) => s + v, 0);

  createReportChart('chart-report-priority', {
    type: 'doughnut',
    data: {
      labels: priorityLabels,
      datasets: [{
        data: priorityValues,
        backgroundColor: priorityColors,
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        animateRotate: true,
        duration: 1000,
        easing: 'easeOutQuart',
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: textColor,
            font: { size: 11 },
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        title: {
          display: true,
          text: 'По приоритету',
          color: textColor,
          font: { size: 13, weight: '600' },
          padding: { bottom: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = ((ctx.parsed / priorityTotal) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  const teamSorted = Object.entries(byTeam).sort((a, b) => b[1] - a[1]);
  const teamColors = palette;

  createReportChart('chart-report-team', {
    type: 'bar',
    data: {
      labels: teamSorted.map(d => d[0]),
      datasets: [{
        label: 'Задач',
        data: teamSorted.map(d => d[1]),
        backgroundColor: teamSorted.map((_, i) => teamColors[i % teamColors.length]),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      ...commonOpts('По командам'),
      indexAxis: 'y',
      plugins: {
        ...commonOpts().plugins,
        legend: { display: false },
      },
      scales: {
        x: { ...commonOpts().scales.x, grid: { display: false }, beginAtZero: true },
        y: { ...commonOpts().scales.y, grid: { display: false } },
      },
    },
  });
}

function getReportKeyFromUrl() {
  const m = window.location.hash.match(/[?&]r=([^&]+)/);
  const key = m ? decodeURIComponent(m[1]) : null;
  return key === 'progress' ? 'quarterly-goals' : key;
}

export function renderReportPage(app) {
  currentReport = getReportKeyFromUrl() || currentReport;
  if (currentReport === 'directorate') return renderDirectorateReport(app);
  if (currentReport === 'did-backlog') return renderDidBacklog(app);
  const config = reportConfig[currentReport];
  if (!config) return '<p class="text-muted">Отчёт не выбран</p>';

  const reportingKind = currentReport === 'team-weekly' ? 'team_weekly' : currentReport === 'directorate' ? 'directorate' : currentReport === 'did-operational' ? 'did' : '';
  const reportActions = `
    ${currentReport === 'pip' ? '<a class="btn btn-secondary btn-sm" href="#/express-estimate"><i data-lucide="calculator"></i>Экспресс-оценка</a>' : currentReport === 'quarterly-goals' ? `<a class="btn btn-primary btn-sm" href="${quarterlyGoalsUpdateHref({ source: 'report-detail' })}"><i data-lucide="gauge"></i>Обновить данные</a>` : (canUseReportingStatusWorkspace(app) ? `<a class="btn btn-primary btn-sm" href="${reportingStatusHref({ source: 'report', kind: reportingKind })}"><i data-lucide="clipboard-pen-line"></i>${currentReport === 'team-weekly' ? 'Подготовить встречу' : 'Заполнить статусы'}</a>` : '')}
    ${!config.isPlaceholder ? `${uiButton({ label: 'Excel', icon: 'file-spreadsheet', size: 'small', attrs: { id: 'report-excel' } })}` : ''}
    ${uiButton({ label: 'Обновить', icon: 'refresh-cw', size: 'small', attrs: { id: 'report-refresh' } })}`;

  const reportHeader = currentReport === 'quarterly-goals' ? `
    <header class="quarterly-report-top">
      ${uiButton({ label: 'Назад к списку отчётов', icon: 'arrow-left', iconOnly: true, variant: 'ghost', className: 'quarterly-report-back', attrs: { id: 'report-back-btn' } })}
      <div class="quarterly-report-heading">
        <div class="quarterly-report-title-line">
          <h1>${config.name}</h1>
          <span class="badge badge-info">Статус-отчёт</span>
        </div>
        <p>${config.desc}</p>
      </div>
      <div class="quarterly-report-actions">${reportActions}</div>
    </header>` : `
    <div style="display:flex;align-items:flex-start;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap;">
      ${uiButton({ label: 'Назад к списку отчётов', icon: 'arrow-left', iconOnly: true, variant: 'ghost', attrs: { id: 'report-back-btn' } })}
      <div style="flex:1;min-width:0;">
        <h1 style="font-weight:var(--font-bold);color:var(--text-primary);">${config.name}</h1>
        <p style="color:var(--text-muted);font-size:var(--text-sm);margin-top:var(--space-1);">${config.desc}</p>
      </div>
    </div>
    <div class="action-bar action-bar--end" style="justify-content:space-between;">
      <span class="badge badge-info" style="">${config.isPlaceholder ? 'В разработке' : currentReport === 'pip' ? 'Очередь решений' : 'Статус-отчёт'}</span>
      <div class="flex gap-2" style="flex-wrap:wrap;">${reportActions}</div>
    </div>`;

  return `
    <div class="animate-fade-in">
      ${reportHeader}

      ${currentReport === 'pip' ? '' : currentReport === 'quarterly-goals' ? `
      <div class="quarterly-kpis" id="progress-widgets" aria-label="Фильтр по светофору">
        <button type="button" class="ui-surface-action quarterly-kpi progress-widget" data-progress-filter="all">
          <div class="stat-icon" style="background:var(--info-light);color:var(--info);"><i data-lucide="list"></i></div>
          <div class="stat-value" id="progress-total">0</div>
          <div class="stat-label">Всего</div>
        </button>
        <button type="button" class="ui-surface-action quarterly-kpi progress-widget" data-progress-filter="green">
          <div class="stat-icon" style="background:var(--success-light);color:var(--success);"><i data-lucide="circle-check"></i></div>
          <div class="stat-value" id="progress-green">0</div>
          <div class="stat-label">Зелёные</div>
        </button>
        <button type="button" class="ui-surface-action quarterly-kpi progress-widget" data-progress-filter="yellow">
          <div class="stat-icon" style="background:#f59e0b20;color:#f59e0b;"><i data-lucide="circle"></i></div>
          <div class="stat-value" id="progress-yellow">0</div>
          <div class="stat-label">Жёлтые</div>
        </button>
        <button type="button" class="ui-surface-action quarterly-kpi progress-widget" data-progress-filter="red">
          <div class="stat-icon" style="background:var(--danger-light);color:var(--danger);"><i data-lucide="circle"></i></div>
          <div class="stat-value" id="progress-red">0</div>
          <div class="stat-label">Красные</div>
          <small class="quarterly-widget-context" id="progress-red-context">0 по прогрессу · 0 из-за данных</small>
        </button>
      </div>
      ` : !config.isCustom && !config.isPlaceholder ? `
      <div class="dashboard-stats" style="margin-bottom:var(--space-6);">
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--info-light);color:var(--info);">
            <i data-lucide="list"></i>
          </div>
          <div class="stat-value" id="report-total">0</div>
          <div class="stat-label">Всего задач</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--danger-light);color:var(--danger);">
            <i data-lucide="arrow-up"></i>
          </div>
          <div class="stat-value" id="report-high">0</div>
          <div class="stat-label">Высокий приоритет</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--warning-light);color:var(--warning);">
            <i data-lucide="alert-triangle"></i>
          </div>
          <div class="stat-value" id="report-risk">0</div>
          <div class="stat-label">В риске</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:var(--success-light);color:var(--success);">
            <i data-lucide="trending-up"></i>
          </div>
          <div class="stat-value" id="report-avg">0%</div>
          <div class="stat-label">Средний прогресс</div>
        </div>
      </div>

      ${!config.hideCharts ? `<div class="chart-grid-3">
        <div class="card" style="padding:16px;border-radius:12px;">
          <div style="height:200px;"><canvas id="chart-report-status"></canvas></div>
        </div>
        <div class="card" style="padding:16px;border-radius:12px;">
          <div style="height:200px;"><canvas id="chart-report-priority"></canvas></div>
        </div>
        <div class="card" style="padding:16px;border-radius:12px;">
          <div style="height:200px;"><canvas id="chart-report-team"></canvas></div>
        </div>
      </div>` : ''}
      ` : ''}

      <div id="report-body">
        <div class="text-center content-loading-state" style="padding:var(--space-8);">Загрузка…</div>
      </div>
    </div>`;
}

export function initReportPage(app) {
  currentReport = getReportKeyFromUrl() || currentReport;
  if (!currentReport) return;
  if (currentReport === 'directorate') { initDirectorateReport(app); return; }
  if (currentReport === 'did-backlog') { initDidBacklog(app); return; }
  if (currentReport === 'pip') pipQueueFilter = 'all';
  loadReportData(app);

  // Update breadcrumb with actual report name
  const config = reportConfig[currentReport];
  if (config) {
    const bc = document.getElementById('breadcrumb-nav');
    if (bc) {
      const parentHref = currentReport === 'pip' ? '#/express-estimate' : '#/reports';
      const parentLabel = currentReport === 'pip' ? 'Экспресс-оценка' : 'Статусы для встреч';
      bc.innerHTML = `
        <a href="${parentHref}" class="breadcrumb-parent">${parentLabel}</a>
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-current">${config.name}</span>`;
    }
  }

  document.getElementById('report-back-btn')?.addEventListener('click', () => {
    Object.keys(reportChartInstances).forEach(k => { reportChartInstances[k]?.destroy(); delete reportChartInstances[k]; });
    const destination = currentReport === 'pip' && getReportQueryParams().get('source') === 'express-estimate'
      ? '/express-estimate'
      : '/reports';
    currentReport = null;
    app.router.navigate(destination);
  });

  document.getElementById('report-refresh')?.addEventListener('click', () => {
    loadReportData(app);
  });

  document.getElementById('progress-widgets')?.addEventListener('click', (e) => {
    const widget = e.target.closest('.progress-widget');
    if (!widget || currentReport !== 'quarterly-goals' || !cachedReportData) return;
    const filter = widget.dataset.progressFilter;
    const current = reportColumnFilters.progress_indicator || [];
    const requested = filter === 'deviations' ? ['yellow', 'red'] : (filter === 'all' ? [] : [filter]);
    const alreadyActive = requested.length === current.length && requested.every(value => current.includes(value));
    if (alreadyActive && filter !== 'all') delete reportColumnFilters.progress_indicator;
    else if (requested.length) reportColumnFilters.progress_indicator = requested;
    else delete reportColumnFilters.progress_indicator;
    renderReportContent(reportConfig['quarterly-goals'], 'quarterly-goals', cachedReportData);
  });

  document.getElementById('report-excel')?.addEventListener('click', () => {
    if (currentReport && tasksCache.length) {
      const config = reportConfig[currentReport];
      let visible = tasksCache;
      if (!config.isDb || currentReport === 'quarterly-goals') {
        visible = applyReportFilters(currentReport, tasksCache);
        visible = filteredAndSortedReportRows(visible);
      }
      exportReportExcel(currentReport, visible, app);
    }
  });

  document.getElementById('report-body')?.addEventListener('click', async (e) => {
    const config = reportConfig[currentReport];

    const weeklyFilter = e.target.closest('[data-weekly-filter]');
    if (weeklyFilter && currentReport === 'team-weekly' && cachedReportData) {
      teamWeeklyFilter = weeklyFilter.dataset.weeklyFilter || 'attention';
      renderReportContent(config, currentReport, cachedReportData);
      return;
    }
    const weeklyTask = e.target.closest('[data-open-weekly-task]');
    if (weeklyTask && currentReport === 'team-weekly') {
      document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(weeklyTask.dataset.openWeeklyTask), tab: 'rep' } }));
      return;
    }

    const teamButton = e.target.closest('[data-quarterly-team]');
    if (teamButton && currentReport === 'quarterly-goals' && cachedReportData) {
      const teamName = teamButton.dataset.quarterlyTeam;
      if (teamName) reportColumnFilters.team_name = [teamName];
      else delete reportColumnFilters.team_name;
      renderReportContent(config, currentReport, cachedReportData);
      return;
    }

    const decisionButton = e.target.closest('.pip-open-decision');
    if (decisionButton) {
      const task = tasksCache.find(item => Number(item.id) === Number(decisionButton.dataset.taskId));
      if (task) showPipDecisionModal(task, app);
      return;
    }

    const pipFilter = e.target.closest('[data-pip-filter]');
    if (pipFilter && currentReport === 'pip') {
      pipQueueFilter = pipFilter.dataset.pipFilter || 'all';
      renderReportContent(config, currentReport, cachedReportData);
      return;
    }

    if (e.target.closest('.filter-trigger')) {
      if (config.isCustom || (config.isDb && currentReport !== 'quarterly-goals')) return;
      e.stopPropagation();
      const trigger = e.target.closest('.filter-trigger');
      const field = trigger.dataset.field;
      renderFilterDropdown(field, trigger);
      return;
    }

    if (e.target.closest('#report-clear-filters')) {
      closeFilterDropdown();
      reportColumnFilters = {};
      if ((config.isCustom || config.isDb) && cachedReportData) {
        renderReportContent(config, currentReport, cachedReportData);
      } else {
        const filtered = applyReportFilters(currentReport, tasksCache);
        renderReportContent(config, currentReport, filtered);
      }
      return;
    }

    const th = e.target.closest('th[data-sort]');
    if (!th) return;

    if (config.isCustom || (config.isDb && currentReport !== 'quarterly-goals')) return;

    const field = th.dataset.sort;
    if (reportSortField === field) {
      reportSortDir = reportSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      reportSortField = field;
      reportSortDir = 'asc';
    }
    if (currentReport === 'quarterly-goals' && cachedReportData) {
      renderReportContent(config, currentReport, cachedReportData);
    } else {
      const filtered = applyReportFilters(currentReport, tasksCache);
      renderReportContent(config, currentReport, filtered);
    }
  });
  document.getElementById('report-body')?.addEventListener('change', event => {
    if (!event.target.matches('[data-team-weekly-team]') || currentReport !== 'team-weekly' || !cachedReportData) return;
    teamWeeklyTeamId = event.target.value;
    renderReportContent(reportConfig[currentReport], currentReport, cachedReportData);
  });
}
