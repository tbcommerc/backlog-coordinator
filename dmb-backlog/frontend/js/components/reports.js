/**
 * DMB Backlog - Reports Page
 */
import { escapeHtml } from '../htmlUtils.js';
import { bindViewStateAction, renderViewState } from './viewState.js';
import { formatTaskPublicId } from '../taskPublicId.js';

function renderInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  return Array.isArray(teams) ? teams.join(', ') : teams;
}

const reportConfig = {
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
    desc: 'Отчет для проведения церемонии Product Increment Planning (PIP)',
    icon: 'milestone',
    gradient: 'grad-amber',
    inDevelopment: true,
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
    desc: 'Задачи, запланированные к реализации в следующем квартале с фин. эффектом по ним',
    icon: 'send',
    gradient: 'grad-slate',
    inDevelopment: true,
    isDb: true,
    key: 'did-backlog',
    filters: [],
    fields: ['id','title','business_customer_name','project_name','team_name','did_status','progress','deadline_name'],
    group: null,
    sort: null
  },
  progress: {
    name: 'Светофоры по квартальным задачам',
    desc: 'Текущий прогресс по выполнению задач текущего квартала, отклонения, риски',
    icon: 'trending-up',
    gradient: 'grad-cyan',
    inDevelopment: true,
    isDb: true,
    key: 'progress',
    managedFields: true,
    hideCharts: true,
    filters: [],
    fields: ['id','title','task_type_name','team_name','progress'],
    group: null,
    sort: null
  },
  'pd-estimates': {
    name: 'Сбор оценок для PD',
    desc: 'Сбор оценок от бизнес-заказчиков по итогам выполнения квартальных задач',
    icon: 'clipboard-check',
    gradient: 'grad-emerald',
    isPlaceholder: true
  }
};

let currentReport = null;
let tasksCache = [];
let cachedReportData = null;
let reportSortField = null;
let reportSortDir = 'asc';
let reportColumnFilters = {};

let dbReportsCache = {};
let cachedDbReport = null;
let reportingMeetings = [];
let canManageReportingMeetings = false;
let canPrepareReportingMeetings = false;
let meetingView = 'cards';
let meetingFilters = { kind: 'all', state: 'open', from: '', to: '' };

const meetingStateLabels = {
  date_pending: 'Нужно назначить дату',
  planned: 'Запланирована',
  held: 'Состоялась',
  cancelled: 'Отменена',
};

const meetingKindMeta = {
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
  return `<div class="meeting-toolbar" aria-label="Фильтры календаря">
    <label>Тип<select class="input" data-meeting-filter="kind">
      <option value="all">Все встречи</option><option value="directorate">Директорская</option>
      <option value="did">ДИД</option><option value="key_projects">Ключевые проекты</option>
    </select></label>
    <label>Состояние<select class="input" data-meeting-filter="state">
      <option value="open">Предстоящие</option><option value="all">Все</option><option value="planned">Запланированные</option>
      <option value="date_pending">Без даты</option><option value="held">Состоявшиеся</option><option value="cancelled">Отменённые</option>
    </select></label>
    <label>С<input class="input" type="date" data-meeting-filter="from" value="${escapeHtml(meetingFilters.from)}"></label>
    <label>По<input class="input" type="date" data-meeting-filter="to" value="${escapeHtml(meetingFilters.to)}"></label>
    <div class="meeting-view-switch" role="group" aria-label="Представление календаря">
      <button class="btn btn-sm ${meetingView === 'cards' ? 'btn-primary' : 'btn-secondary'}" data-meeting-view="cards">Карточки</button>
      <button class="btn btn-sm ${meetingView === 'timeline' ? 'btn-primary' : 'btn-secondary'}" data-meeting-view="timeline">Хронология</button>
    </div>
    <button class="btn btn-secondary btn-sm" data-meeting-export><i data-lucide="download"></i> iCalendar</button>
    <button class="btn btn-secondary btn-sm" data-meeting-reset>Сбросить</button>
  </div>`;
}

function exportReportingMeetings() {
  const items = reportingMeetings.filter(meeting => meetingMatchesFilters(meeting) && meeting.scheduled_date);
  const escapeIcs = value => String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DMB Platform//Reporting Meetings//RU'];
  items.forEach(meeting => {
    const day = meeting.scheduled_date.replaceAll('-', '');
    lines.push('BEGIN:VEVENT', `UID:reporting-meeting-${meeting.id}@dmb.local`, `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${escapeIcs(meeting.title)}`, `DESCRIPTION:${escapeIcs(meetingStateLabels[meeting.state] || meeting.state)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'reporting-meetings.ics' });
  link.click();
  URL.revokeObjectURL(url);
  window.toast?.(items.length ? `Экспортировано встреч: ${items.length}` : 'Нет встреч с датой для экспорта', items.length ? 'success' : 'info');
}

function renderMeetingTimeline(items) {
  if (!items.length) return '<div class="empty-state">По заданным фильтрам встреч нет</div>';
  return `<div class="meeting-timeline">${items.map(meeting => {
    const meta = meetingKindMeta[meeting.kind] || { tone: 'blue' };
    return `<article class="meeting-timeline-item meeting-tone--${meta.tone}" data-meeting-row="${meeting.id}">
      <button class="meeting-timeline-main" data-meeting-jump="${meeting.id}">
        <time>${escapeHtml(formatMeetingDate(meeting.scheduled_date))}</time>
        <strong>${escapeHtml(meeting.title)}</strong>
        <span>${escapeHtml(meeting.is_overdue ? 'Просрочена — требуется актуализировать факт' : meetingStateLabels[meeting.state] || meeting.state)}</span>
      </button>
      <div class="meeting-timeline-actions">
        <button class="btn btn-secondary btn-sm" data-meeting-action="prepare" data-meeting-id="${meeting.id}">Статусы</button>
        <button class="btn btn-secondary btn-sm" data-meeting-action="history" data-meeting-id="${meeting.id}">История</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function getMeetingCards(items) {
  const openStates = new Set(['planned', 'date_pending']);
  if (meetingFilters.state === 'open' || meetingFilters.state === 'planned' || meetingFilters.state === 'date_pending') {
    return ['directorate', 'did', 'key_projects']
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

function localDateIso() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function getUpcomingMeetingDates(kind, meeting) {
  const fromDate = meeting.scheduled_date || '';
  return reportingMeetings
    .filter(item => item.kind === kind && item.state === 'planned' && item.scheduled_date && item.scheduled_date >= fromDate)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    .slice(0, 4);
}

function renderUpcomingMeetingDates(meeting) {
  const dates = getUpcomingMeetingDates(meeting.kind, meeting);
  if (!dates.length) {
    const hint = meeting.kind === 'did'
      ? 'После назначения первой даты появится график на каждые две недели.'
      : 'Проектный офис назначает дату каждой ежемесячной встречи.';
    return `<div class="meeting-upcoming is-empty"><div class="meeting-section-label">Ближайшие даты</div><p>${escapeHtml(hint)}</p></div>`;
  }
  return `<div class="meeting-upcoming">
    <div class="meeting-section-label">Ближайшие даты</div>
    <div class="meeting-date-list">${dates.map((item, index) => `
      <span class="meeting-date-chip${item.id === meeting.id ? ' is-current' : ''}">
        ${index === 0 ? '<i data-lucide="calendar-check-2"></i>' : '<i data-lucide="calendar-days"></i>'}
        ${escapeHtml(formatMeetingShortDate(item.scheduled_date))}
      </span>`).join('')}</div>
  </div>`;
}

function renderReportingMeetingCard(meeting, historical = false) {
  const isOpen = meeting.state === 'planned' || meeting.state === 'date_pending';
  const meta = meetingKindMeta[meeting.kind] || { cadence: '', icon: 'calendar-days', tone: 'blue' };
  const localToday = localDateIso();
  const canComplete = meeting.state === 'planned' && Boolean(meeting.scheduled_date) && meeting.scheduled_date <= localToday;
  const completeness = meeting.total_tasks
    ? `${meeting.filled_tasks} из ${meeting.total_tasks} задач заполнено`
    : 'Нет активных задач';
  const completionPercent = meeting.total_tasks ? Math.round((meeting.filled_tasks / meeting.total_tasks) * 100) : 0;
  const warning = meeting.teams_without_recipients
    ? `<div class="meeting-warning">У ${meeting.teams_without_recipients} команд нет активного PO/PL/CL — напоминание некому отправить</div>`
    : '';
  const dateActions = canManageReportingMeetings && isOpen && !historical ? `
    <div class="meeting-date-actions">
      <button class="meeting-date-action" data-meeting-action="schedule" data-meeting-id="${meeting.id}"><i data-lucide="calendar-cog"></i>${meeting.scheduled_date ? 'Изменить дату' : 'Назначить дату'}</button>
      <button class="meeting-date-action is-danger" data-meeting-action="cancel" data-meeting-id="${meeting.id}" aria-label="Отменить встречу"><i data-lucide="calendar-x-2"></i><span>Отменить</span></button>
    </div>` : '';
  const manageActions = canManageReportingMeetings && isOpen && canComplete ? `
    <button class="meeting-action is-success" data-meeting-action="complete" data-meeting-id="${meeting.id}"><i data-lucide="circle-check-big"></i>Встреча состоялась</button>` : '';
  const actions = `${isOpen && canPrepareReportingMeetings ? `<button class="meeting-action is-primary" data-meeting-action="prepare" data-meeting-id="${meeting.id}"><i data-lucide="list-checks"></i>Статусы встречи</button>` : ''}
    ${manageActions}
    <button class="meeting-action is-secondary" data-meeting-action="history" data-meeting-id="${meeting.id}"><i data-lucide="history"></i>История</button>`;
  return `
    <article class="reporting-meeting-card meeting-tone--${meta.tone}${meeting.is_overdue ? ' is-overdue' : ''}${historical ? ' is-history-card' : ''}" data-meeting-card="${meeting.id}" tabindex="-1">
      <div class="meeting-card-head">
        <div class="meeting-card-meta"><span class="meeting-kind-icon"><i data-lucide="${meta.icon}"></i></span><div class="meeting-cadence">${escapeHtml(meta.cadence)}</div></div>
        <span class="meeting-state meeting-state--${meeting.is_overdue ? 'overdue' : meeting.state}">${escapeHtml(meeting.is_overdue ? 'Просрочена' : meetingStateLabels[meeting.state] || meeting.state)}</span>
        <h3>${escapeHtml(meeting.title)}</h3>
      </div>
      <div class="meeting-primary-date${meeting.scheduled_date ? '' : ' is-pending'}">
        <div class="meeting-primary-date-head"><span>${historical ? 'Дата встречи' : 'Ближайшая встреча'}</span></div>
        <div class="meeting-primary-date-main">
          <strong>${escapeHtml(formatMeetingDate(meeting.scheduled_date))}</strong>
          ${dateActions}
        </div>
        ${meeting.original_scheduled_date && meeting.original_scheduled_date !== meeting.scheduled_date ? `<small>Перенесена с ${escapeHtml(formatMeetingDate(meeting.original_scheduled_date))}</small>` : ''}
      </div>
      <div class="meeting-upcoming-slot">${historical ? '' : renderUpcomingMeetingDates(meeting)}</div>
      <div class="meeting-fill-status${canPrepareReportingMeetings ? ' is-actionable' : ''}" ${canPrepareReportingMeetings ? `data-meeting-action="prepare" data-meeting-id="${meeting.id}" role="button" tabindex="0" aria-label="Открыть подготовку статусов"` : ''}>
        <div class="meeting-progress"><span>${escapeHtml(completeness)}</span><strong>${completionPercent}%</strong></div>
        <div class="meeting-progress-track" aria-label="Заполнено ${completionPercent}%"><span style="width:${completionPercent}%"></span></div>
        <div class="meeting-missing${meeting.missing_tasks ? '' : ' is-complete'}">${meeting.missing_tasks ? `${meeting.missing_tasks} задач ещё не заполнено` : 'Все статусы заполнены'}</div>
      </div>
      <div class="meeting-messages">
        ${meeting.change_reason ? `<div class="meeting-reason"><i data-lucide="info"></i><span>${escapeHtml(meeting.change_reason)}</span></div>` : ''}
        ${warning}
      </div>
      <div class="meeting-actions">${actions}</div>
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
    <div class="meeting-panel-heading">
      <div><h2>Календарь отчётных встреч</h2><p>Проектный офис назначает дату и фиксирует факт; PO/PL/CL заполняют статусы в карточках задач.</p></div>
      ${canManageReportingMeetings ? '<span class="badge badge-info">Управление доступно</span>' : ''}
    </div>
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
            <button type="button" class="modal-close" data-meeting-dialog-close aria-label="Закрыть диалог">&times;</button>
          </div>
          <div class="modal-body">
            ${isSchedule ? `
              <div class="form-group">
                <label class="form-label" for="meeting-scheduled-date">Дата встречи <span class="required">*</span></label>
                <input class="input" id="meeting-scheduled-date" name="scheduled_date" type="date" min="${localDateIso()}" value="${escapeHtml(meeting.scheduled_date || '')}" required>
                ${meeting.kind === 'did' && !hasDate ? '<div class="form-hint">Первая дата оперативки ДИД должна приходиться на вторник.</div>' : ''}
              </div>
              ${hasDate ? `<div class="form-group">
                <label class="form-label" for="meeting-change-reason">Причина изменения даты</label>
                <textarea class="input" id="meeting-change-reason" name="reason" rows="3" placeholder="Укажите причину, если дата изменяется"></textarea>
                <div class="form-hint">Обязательна при выборе даты, отличной от текущей.</div>
              </div>` : ''}` : isComplete ? `
              <div class="meeting-dialog-warning is-success"><i data-lucide="circle-check-big"></i><span>Текущие отчётные статусы будут зафиксированы и станут статусами предыдущей встречи. Заполнено ${meeting.filled_tasks || 0} из ${meeting.total_tasks || 0} задач.</span></div>
              ${meeting.missing_tasks ? `<label class="meeting-force-confirm"><input type="checkbox" name="force"> Завершить встречу, несмотря на ${meeting.missing_tasks} незаполненных задач</label>` : ''}` : `
              <div class="meeting-dialog-warning"><i data-lucide="triangle-alert"></i><span>Встреча будет отменена. Заполненные статусы перенесутся в следующую встречу, не заменяя уже подготовленные данные.</span></div>
              <div class="form-group">
                <label class="form-label" for="meeting-cancel-reason">Причина отмены <span class="required">*</span></label>
                <textarea class="input" id="meeting-cancel-reason" name="reason" rows="3" placeholder="Укажите причину отмены" required></textarea>
              </div>`}
            <div class="form-error meeting-dialog-error" role="alert" hidden></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary btn-sm" data-meeting-dialog-close>Закрыть</button>
            <button type="submit" class="btn ${isSchedule || isComplete ? 'btn-primary' : 'btn-danger'} btn-sm">${escapeHtml(confirmLabel)}</button>
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
          error.textContent = 'Первая дата оперативки ДИД должна быть вторником.';
          error.hidden = false;
          form.elements.scheduled_date?.focus();
          return;
        }
        close({ scheduled_date: scheduledDate, reason: reason || null });
        return;
      }
      if (isComplete) {
        if (meeting.missing_tasks && !form.elements.force?.checked) {
          error.textContent = 'Подтвердите завершение встречи с неполными статусами.';
          error.hidden = false;
          form.elements.force?.focus();
          return;
        }
        close({ force: !!form.elements.force?.checked });
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
    <button class="modal-close" type="button" data-meeting-data-close aria-label="Закрыть диалог">&times;</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-footer"><button class="btn btn-secondary btn-sm" type="button" data-meeting-data-close>Закрыть</button></div>
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

async function showReportingMeetingHistory(meeting, app) {
  const labels = { scheduled: 'Дата назначена', rescheduled: 'Дата перенесена', completed: 'Встреча состоялась', cancelled: 'Встреча отменена' };
  const renderItems = items => items?.length ? `<div class="meeting-history-list">${items.map(item => `
      <article><div><strong>${escapeHtml(labels[item.action] || item.action)}</strong><time>${escapeHtml(item.changed_at ? new Date(item.changed_at).toLocaleString('ru-RU') : '—')}</time></div>
      <p>${item.old_date && item.new_date && item.old_date !== item.new_date ? `${escapeHtml(formatMeetingDate(item.old_date))} → ${escapeHtml(formatMeetingDate(item.new_date))}` : escapeHtml(formatMeetingDate(item.new_date || item.old_date))}</p>
      ${item.reason ? `<blockquote>${escapeHtml(item.reason)}</blockquote>` : ''}<small>${escapeHtml(item.changed_by_name || 'Система')}</small></article>`).join('')}</div>`
      : '<div class="empty-state">Изменений встречи пока нет</div>';
  if (Array.isArray(meeting.history)) {
    showMeetingDataDialog({ title: 'История встречи', subtitle: meeting.title, body: renderItems(meeting.history) });
    return;
  }
  const overlay = showMeetingDataDialog({ title: 'История встречи', subtitle: meeting.title, body: '<div class="card-reporting-loading">Загрузка истории…</div>' });
  try {
    const data = await app.api.get(`/reporting-meetings/${meeting.id}/history`);
    const body = overlay.querySelector('.modal-body');
    if (body) body.innerHTML = renderItems(data.items || []);
  } catch (error) {
    const body = overlay.querySelector('.modal-body');
    if (body) body.innerHTML = `<div class="meeting-panel-error"><p>Не удалось загрузить историю: ${escapeHtml(error?.message || 'ошибка сервера')}</p><p>Убедитесь, что backend перезапущен после обновления.</p></div>`;
  }
}

async function showReportingMeetingPreparation(meeting, app) {
  const overlay = showMeetingDataDialog({
    title: meeting.state === 'held' ? 'Зафиксированный срез статусов' : meeting.state === 'cancelled' ? 'Статусы отменённой встречи' : 'Статусы предстоящей встречи',
    subtitle: `${meeting.title} · ${formatMeetingDate(meeting.scheduled_date)}`,
    body: '<div class="card-reporting-loading">Загрузка статусов встречи…</div>',
  });
  try {
    const data = await app.api.get(`/reporting-meetings/${meeting.id}/preparation`);
    const rows = data.items || [];
    const body = `<div class="meeting-preparation-summary"><strong>${rows.filter(item => item.filled).length} из ${rows.length}</strong><span>задач в доступной области заполнено</span>
      <label><input type="checkbox" data-preparation-missing> Только незаполненные</label></div>
      <div class="meeting-preparation-list">${rows.map(item => `<article data-preparation-row data-filled="${item.filled}">
        <div class="meeting-preparation-task"><button type="button" data-open-preparation-task="${item.task_id}">${escapeHtml(item.public_id)}</button><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.team_name || 'Без команды')}</small></div></div>
        ${item.can_edit ? `<textarea class="input" rows="3" maxlength="5000" data-preparation-text placeholder="Опишите прогресс, риски и следующие шаги">${escapeHtml(item.text || '')}</textarea>
          ${meeting.kind === 'did' ? `<label class="meeting-demo-check"><input type="checkbox" data-preparation-demo ${item.did_demo ? 'checked' : ''}> Демо для ДИД</label>` : ''}
          <button class="btn btn-primary btn-sm" type="button" data-save-preparation data-task-id="${item.task_id}" data-version="${item.version}">Сохранить</button>`
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
      if (!save) return;
      const row = save.closest('[data-preparation-row]');
      save.disabled = true;
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
      } finally { save.disabled = false; }
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
  const p = progress || 0;
  const indicator = task?.progress_indicator;
  const colors = { green: '#16a34a', yellow: '#f59e0b', red: '#dc2626' };
  const indicatorColor = colors[indicator];
  let colorClass = !indicatorColor && p >= 100 ? 'success' : (!indicatorColor && p > 0 ? 'warning' : '');
  const planText = task?.planned_progress != null ? ` · план ${task.planned_progress}%` : '';
  const deviationText = task?.progress_deviation_percent != null ? `Относительное отставание: ${task.progress_deviation_percent}%` : '';
  return `
    <div style="display:flex;align-items:center;gap:8px;min-width:160px;" title="${escapeHtml(deviationText)}">
      ${indicatorColor ? `<span style="width:10px;height:10px;border-radius:50%;background:${indicatorColor};box-shadow:0 0 0 3px ${indicatorColor}22;flex-shrink:0"></span>` : ''}
      <div class="progress-bar" style="flex:1;">
        <div class="progress-fill ${colorClass}" style="width:${p}%;${indicatorColor ? `background:${indicatorColor}` : ''}"></div>
      </div>
      <span style="font-size:var(--text-xs);color:var(--text-secondary);min-width:82px;text-align:right;white-space:nowrap">${p}%${planText}</span>
    </div>`;
}

function renderCell(task, field) {
  switch (field) {
    case 'id': return `<span class="font-mono text-muted">${formatTaskPublicId(task)}</span>`;
    case 'title': return `<strong>${escapeHtml(task.title)}</strong>`;
    case 'status': return renderStatus(task.status_name || task.status);
    case 'status_name': return renderStatus(task.status_name || task.status);
    case 'priority': return renderPriority(task.priority_name || task.priority);
    case 'priority_name': return renderPriority(task.priority_name || task.priority);
    case 'progress': return renderProgress(task.progress, task);
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
  id: 'ID', title: 'Задача', team_name: 'Команда',
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
  deadline_name: 'Срок', owner_name: 'Владелец'
};

function getFieldLabel(field) {
  const fl = window.app?.fieldLabels || {};
  const base = field.replace(/_name$/, '_id');
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
  if (reportFilterDropdown) {
    reportFilterDropdown.remove();
    reportFilterDropdown = null;
    reportFilterDropdownField = null;
  }
}

function renderFilterDropdown(field, triggerEl) {
  const wasOpen = reportFilterDropdownField === field;
  closeFilterDropdown();
  if (wasOpen) return;

  const values = [...new Set(tasksCache.map(t => String(t[field] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const activeVals = reportColumnFilters[field] || [];

  const rect = triggerEl.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.style.cssText = 'position:fixed;z-index:10000;min-width:180px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:6px;max-height:280px;overflow-y:auto;';

  let left = rect.left;
  if (left + 200 > window.innerWidth) left = window.innerWidth - 200;
  dd.style.left = left + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';

  const allSelected = activeVals.length === values.length && values.length > 0;
  const someSelected = activeVals.length > 0 && !allSelected;

  let html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-bottom:1px solid #f1f5f9;margin-bottom:2px;">';
  html += '<span style="font-size:11px;font-weight:600;color:#64748b;">Фильтр</span>';
  html += activeVals.length ? '<span style="font-size:10px;color:#3b82f6;cursor:pointer" data-clear-field="' + field + '">Сбросить</span>' : '';
  html += '</div>';

  const allCheckedAttr = allSelected ? ' checked' : '';
  const allIndeterminate = someSelected ? ' indeterminate' : '';
  html += '<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;cursor:pointer;border-radius:4px;transition:background 0.1s;">';
  html += '<input type="checkbox" data-select-all ' + allCheckedAttr + allIndeterminate + ' style="accent-color:#3b82f6;cursor:pointer">';
  html += '<span style="color:#334155;font-weight:500">Выбрать все</span>';
  html += '<span style="margin-left:auto;font-size:10px;color:#94a3b8">' + activeVals.length + '/' + values.length + '</span>';
  html += '</label>';

  if (values.length) {
    html += '<div style="border-top:1px solid #f1f5f9;margin:4px 0;"></div>';
    values.forEach(v => {
      const checked = activeVals.includes(v) ? ' checked' : '';
      html += '<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;cursor:pointer;border-radius:4px;transition:background 0.1s;">';
      html += '<input type="checkbox" value="' + v.replace(/"/g, '&quot;') + '"' + checked + ' style="accent-color:#3b82f6;cursor:pointer">';
      html += '<span style="color:#334155">' + v + '</span>';
      html += '</label>';
    });
  } else {
    html += '<div style="padding:12px 8px;text-align:center;font-size:12px;color:#94a3b8">Нет значений</div>';
  }

  dd.innerHTML = html;

  dd.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.dataset.selectAll !== undefined) {
      const checkboxes = dd.querySelectorAll('input[type=checkbox][value]');
      const allChecked = cb.checked;
      checkboxes.forEach(c => c.checked = allChecked);
    }
    applyFilterFromDropdown(field, dd);
  });

  dd.addEventListener('click', (e) => {
    const clearBtn = e.target.closest('[data-clear-field]');
    if (clearBtn) {
      const checkboxes = dd.querySelectorAll('input[type=checkbox]');
      checkboxes.forEach(c => c.checked = false);
      const selectAll = dd.querySelector('input[data-select-all]');
      if (selectAll) selectAll.checked = false;
      applyFilterFromDropdown(field, dd);
    }
  });

  document.body.appendChild(dd);
  reportFilterDropdown = dd;
  reportFilterDropdownField = field;

  document.addEventListener('click', reportFilterOutsideClick, true);
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
  const totalSpan = dd.querySelector('label:first-child span:last-child');
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

function reportFilterOutsideClick(e) {
  if (reportFilterDropdown && !reportFilterDropdown.contains(e.target)) {
    const trigger = e.target.closest('.filter-trigger');
    if (trigger && trigger.dataset.field === reportFilterDropdownField) return;
    closeFilterDropdown();
    document.removeEventListener('click', reportFilterOutsideClick, true);
  }
}

function renderReportTable(list, fields) {
  if (!list || !list.length) return '<p class="text-muted" style="padding:var(--space-4);">Нет задач</p>';

  let filtered = list;
  const hasFilters = Object.keys(reportColumnFilters).some(k => reportColumnFilters[k] && reportColumnFilters[k].length);
  if (hasFilters) {
    filtered = list.filter(task =>
      Object.entries(reportColumnFilters).every(([field, vals]) => {
        if (!vals || !vals.length) return true;
        return vals.includes(String(task[field] || '').trim());
      })
    );
  }

  if (reportSortField) {
    filtered = [...filtered].sort((a, b) => {
      const va = String(a[reportSortField] || '').toLowerCase();
      const vb = String(b[reportSortField] || '').toLowerCase();
      return reportSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  const hasAnyFilter = Object.keys(reportColumnFilters).some(k => reportColumnFilters[k] && reportColumnFilters[k].length);

  const headers = fields.map(f => {
    const label = getFieldLabel(f);
    const sorted = reportSortField === f;
    const arrow = sorted ? (reportSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const activeVals = reportColumnFilters[f] || [];
    const hasActive = activeVals.length > 0;
    const count = activeVals.length;

    return `<th data-sort="${f}" style="cursor:pointer;user-select:none;white-space:nowrap;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;border-bottom:1px solid var(--border-color);background:var(--bg-tertiary);position:relative">
      <div style="display:flex;align-items:center;gap:4px;justify-content:space-between">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${label}${arrow}</span>
        <span class="filter-trigger" data-field="${f}" style="flex-shrink:0;cursor:pointer;padding:3px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;${hasActive ? 'color:#3b82f6;background:#eff6ff' : 'color:#94a3b8'}" title="Фильтр">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          ${count > 0 ? `<span style="font-size:9px;margin-left:1px;font-weight:700">${count}</span>` : ''}
        </span>
      </div>
    </th>`;
  }).join('');

  const canMakePipDecision = currentReport === 'pip' && window.app?.store?.get('currentUser')?.permissions?.pip_decision === 'available';
  const widths = {
    id: 90, title: 320, task_type_name: 170, team_name: 190,
    effort_days: 155, effort_rub: 165, financial_effect: 135,
    cv: 90, priority_score: 115, progress: 235,
  };
  const tableWidth = fields.reduce((sum, field) => sum + (widths[field] || 140), 0)
    + (canMakePipDecision ? 205 : 0);
  const colgroup = `<colgroup>${fields.map(f => `<col style="width:${widths[f] || 140}px">`).join('')}${canMakePipDecision ? '<col style="width:205px">' : ''}</colgroup>`;
  const actionHeader = canMakePipDecision
    ? '<th style="width:205px;padding:8px 12px;white-space:nowrap;background:var(--bg-tertiary);border-bottom:1px solid var(--border-color);font-size:11px;text-transform:uppercase;color:var(--text-muted)">Действия</th>'
    : '';

  const rows = filtered.map(task => {
    const cells = fields.map(f => `<td style="padding:8px 12px;border-bottom:1px solid var(--border-color);font-size:13px;overflow:hidden;text-overflow:ellipsis;${f === 'title' ? 'white-space:normal' : 'white-space:nowrap'}">${renderCell(task, f)}</td>`).join('');
    const actions = canMakePipDecision ? `
      <td style="padding:8px 12px;border-bottom:1px solid var(--border-color);white-space:nowrap">
        <div style="display:flex;gap:6px">
          <button class="btn btn-danger btn-xs pip-decision-btn" data-task-id="${task.id}" data-task-version="${task.version ?? 0}" data-decision="reject">Отклонить</button>
          <button class="btn btn-primary btn-xs pip-decision-btn" data-task-id="${task.id}" data-task-version="${task.version ?? 0}" data-decision="accept">В работу</button>
        </div>
      </td>` : '';
    return `<tr>${cells}${actions}</tr>`;
  }).join('');

  let footerHtml = `<span style="font-size:11px;color:var(--text-muted)">${filtered.length} из ${list.length} задач</span>`;

  if (hasAnyFilter) {
    footerHtml += `<span style="margin-left:12px;font-size:11px;color:#3b82f6;cursor:pointer;text-decoration:underline" id="report-clear-filters">Сбросить все фильтры</span>`;
  }

  return `
    <div class="table-container" style="overflow-x:auto">
      <table class="table report-balanced-table" style="width:100%;min-width:${tableWidth}px;border-collapse:collapse;table-layout:fixed">
        ${colgroup}
        <thead><tr>${headers}${actionHeader}</tr></thead>
        <tbody>${rows || '<tr><td colspan="99" style="text-align:center;padding:24px;color:var(--text-muted)">Нет совпадений</td></tr>'}</tbody>
      </table>
      <div style="padding:8px 12px;">
        ${footerHtml}
      </div>
    </div>`;
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
        renderPlaceholderReport(config, currentReport);
        return;
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
    if (body) body.innerHTML = `<p class="text-muted" style="padding:var(--space-8);">Ошибка загрузки: ${escapeHtml(e.message)}</p>`;
  }
}

function renderReportContent(config, reportKey, data) {
  const body = document.getElementById('report-body');
  if (!body) return;

  if (config.isCustom && data && data.teams) {
    body.innerHTML = data.teams.map(team => {
      const storageKey = 'did-team-collapsed-' + team.team_name;
      const isCollapsed = localStorage.getItem(storageKey) === 'true';
      return `
        <div class="card" style="margin-bottom:var(--space-4);">
          <div class="card-header did-team-header" data-team="${escapeHtml(team.team_name)}" style="cursor:pointer;">
            <div style="display:flex;align-items:center;gap:8px;">
              <i data-lucide="chevron-${isCollapsed ? 'right' : 'down'}" class="did-chevron" style="width:16px;height:16px;transition:transform 0.2s;flex-shrink:0;"></i>
              <h3 class="card-title">${escapeHtml(smartCap(team.team_name))}</h3>
            </div>
            <span class="badge badge-info">${team.total} ${formatCount(team.total)}</span>
          </div>
          <div class="report-group-body ${isCollapsed ? 'collapsed' : ''}">
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
        const chevron = card.querySelector('.did-chevron');
        const isCollapsed = groupBody.classList.toggle('collapsed');
        localStorage.setItem('did-team-collapsed-' + teamName, isCollapsed);
        chevron.setAttribute('data-lucide', isCollapsed ? 'chevron-right' : 'chevron-down');
        if (window.lucide) lucide.createIcons();
      });
    });
    return;
  }

  const tasks = Array.isArray(data) ? data : (data && data.items ? data.items : []);
  const total = tasks.length;
  const high = tasks.filter(t => String(t.priority_name || t.priority || '').toUpperCase() === 'ВЫСОКИЙ').length;
  const statusField = config.isDb ? 'status_name' : (reportKey === 'directorate' ? 'directorate_status' : reportKey === 'did' ? 'did_status' : 'status');
  const riskStatuses = reportKey === 'directorate' ? ['Риск','На контроле'] : reportKey === 'did' ? ['Блокировано','Требует решения'] : ['Холд','Эскалация на ЛТ','Отклонена','Не актуальна'];
  const risk = tasks.filter(t => riskStatuses.some(s => String(t[statusField] || '').toUpperCase() === s.toUpperCase())).length;
  const avg = total ? Math.round(tasks.reduce((s, t) => s + (t.progress || 0), 0) / total) : 0;

  if (reportKey === 'progress') {
    const yellow = tasks.filter(t => t.progress_indicator === 'yellow').length;
    const red = tasks.filter(t => t.progress_indicator === 'red').length;
    const progressCounts = {
      'progress-total': total,
      'progress-deviations': yellow + red,
      'progress-yellow': yellow,
      'progress-red': red,
    };
    Object.entries(progressCounts).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
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

export function renderReports(app) {
  const standardKeys = ['directorate', 'did-operational', 'pip', 'did-backlog', 'progress', 'pd-estimates'];
  const customKeys = ['reg-directors'];

  function renderCard(key, cfg) {
    return `
      <div class="cursor-pointer ${cfg.gradient} report-card" data-report="${key}" style="border-radius:16px;padding:24px;color:white;display:flex;flex-direction:column;min-height:282px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-shrink:0;">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i data-lucide="${cfg.icon}" style="width:20px;height:20px;"></i>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            ${cfg.inDevelopment ? '<span style="font-size:10px;font-weight:600;background:rgba(250,204,21,0.22);color:#fde047;border:1px solid rgba(250,204,21,0.5);padding:3px 9px;border-radius:999px;white-space:nowrap;">В разработке</span>' : ''}
            <i data-lucide="arrow-up-right" style="width:20px;height:20px;opacity:0.6;flex-shrink:0;"></i>
          </div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;min-height:0;">
          <div class="rc-name">${cfg.name}</div>
          <div class="rc-desc">${cfg.desc}</div>
        </div>
        <div style="margin-top:auto;flex-shrink:0;">
          ${cfg.isPlaceholder ? `
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:999px;">В разработке</span>
          ` : `
            <div style="font-size:24px;font-weight:700;line-height:29px;height:29px;" id="count-${key}">0</div>
            <div style="font-size:12px;opacity:0.8;line-height:18px;height:18px;">задач</div>
          `}
        </div>
      </div>`;
  }

  const standardCards = standardKeys.map(k => renderCard(k, reportConfig[k])).join('');
  const customCards = customKeys.map(k => renderCard(k, reportConfig[k])).join('');

  return `
    <div class="page-header animate-fade-in">
      <h1>Статусы для встреч</h1>
      <p>Готовые отчёты для оперативок и директорских</p>
    </div>
    <div id="reports-content">
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
    <h1>Управление отчётными встречами</h1>
    <p>Расписание, готовность статусов и фиксация версий после проведения встречи</p>
  </div>
  <section class="meeting-version-flow" aria-label="Жизненный цикл статусов">
    <div><span>1</span><strong>Предстоящая встреча</strong><small>Команды готовят текущие статусы</small></div>
    <i data-lucide="arrow-right"></i>
    <div><span>2</span><strong>Фиксация факта</strong><small>Проектный офис подтверждает проведение</small></div>
    <i data-lucide="arrow-right"></i>
    <div><span>3</span><strong>Историческая версия</strong><small>Статусы становятся неизменяемым срезом</small></div>
  </section>
  <section id="reporting-meetings-panel" class="reporting-meetings-panel"><div class="card">Загрузка отчётных встреч…</div></section>`;
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
      if (event.target.closest('[data-meeting-export]')) exportReportingMeetings();
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
        if (!rep) { el.textContent = '—'; return; }
        try {
          const execData = await app.api.get(`/reports/${rep.id}/execute`);
          el.textContent = (execData && execData.total != null) ? execData.total : 0;
        } catch (e) { el.textContent = '—'; }
        return;
      }
      if (config.customEndpoint) {
        try {
          const d = await app.api.get(config.customEndpoint);
          el.textContent = (d && d.total_tasks != null) ? d.total_tasks : 0;
        } catch (e) { el.textContent = '—'; }
        return;
      }
      const filtered = applyReportFilters(key, tasksCache);
      el.textContent = filtered.length;
    }));

    document.querySelectorAll('.report-card').forEach(card => {
      card.addEventListener('click', () => {
        const kind = card.dataset.report;
        openMeetingReport(kind, app);
      });
    });

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

function getReportChartColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    textColor: dark ? '#e2e8f0' : '#334155',
    gridColor: dark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(15, 23, 42, 0.08)',
    bgCard: dark ? '#1e293b' : '#ffffff',
  };
}

function createReportChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (reportChartInstances[canvasId]) {
    reportChartInstances[canvasId].destroy();
  }
  const ctx = canvas.getContext('2d');
  reportChartInstances[canvasId] = new window.Chart(ctx, config);
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

  const statusColors = {
    'НОВАЯ ЗАДАЧА': '#6366f1', 'НАЗНАЧЕНА КОМАНДА': '#8b5cf6',
    'СБОР ТРЕБОВАНИЙ': '#6366f1', 'ПРОВЕРКА ТРЕБОВАНИЙ': '#a78bfa',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': '#c4b5fd', 'ЭКСПРЕСС-ОЦЕНКА': '#8b5cf6',
    'ПРИНЯТИЕ РЕШЕНИЯ': '#f59e0b', 'ПРИНЯТА В РАБОТУ': '#10b981',
    'ЭСКАЛАЦИЯ НА ЛТ': '#f97316', 'ХОЛД': '#f43f5e',
    'ОТКЛОНЕНА': '#ef4444', 'НЕ АКТУАЛЬНА': '#94a3b8',
    'ВЫПОЛНЕНА': '#22c55e',
  };

  const statusLabels = Object.keys(byStatus);
  const statusValues = Object.values(byStatus);
  const statusColorsArr = statusLabels.map(l => statusColors[String(l || '').toUpperCase()] || '#94a3b8');

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
    if (l === 'ВЫСОКИЙ') return '#f43f5e';
    if (l === 'СРЕДНИЙ') return '#f59e0b';
    return '#94a3b8';
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
  const teamColors = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#ec4899', '#14b8a6', '#f97316'];

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
  return m ? decodeURIComponent(m[1]) : null;
}

export function renderReportPage(app) {
  currentReport = currentReport || getReportKeyFromUrl();
  const config = reportConfig[currentReport];
  if (!config) return '<p class="text-muted">Отчёт не выбран</p>';

  return `
    <div class="animate-fade-in">
      <div style="display:flex;align-items:flex-start;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="report-back-btn" style="margin-top:4px;flex-shrink:0;">
          <i data-lucide="arrow-left" style="width:18px;height:18px;"></i>
        </button>
        <div style="flex:1;min-width:0;">
          <h1 style="font-weight:var(--font-bold);color:var(--text-primary);">${config.name}</h1>
          <p style="color:var(--text-muted);font-size:var(--text-sm);margin-top:var(--space-1);">${config.desc}</p>
        </div>
      </div>

      <div class="action-bar action-bar--end" style="justify-content:space-between;">
        <span class="badge badge-info" style="font-size:var(--text-xs);">${config.isPlaceholder ? 'В разработке' : 'Статус-отчёт'}</span>
        <div class="flex gap-2" style="flex-wrap:wrap;">
          ${!config.isPlaceholder ? `
          <button class="btn btn-secondary btn-sm" id="report-excel">
            <i data-lucide="file-spreadsheet" style="width:14px;height:14px;"></i>
            Excel
          </button>` : ''}
          <button class="btn btn-secondary btn-sm" id="report-refresh">
            <i data-lucide="refresh-cw" style="width:14px;height:14px;"></i>
            Обновить
          </button>
        </div>
      </div>

      ${currentReport === 'progress' ? `
      <div class="dashboard-stats" id="progress-widgets" style="margin-bottom:var(--space-6);">
        <button type="button" class="stat-card progress-widget" data-progress-filter="all" style="text-align:left;cursor:pointer;font-family:inherit">
          <div class="stat-icon" style="background:var(--info-light);color:var(--info);"><i data-lucide="list"></i></div>
          <div class="stat-value" id="progress-total">0</div>
          <div class="stat-label">Всего задач</div>
        </button>
        <button type="button" class="stat-card progress-widget" data-progress-filter="deviations" style="text-align:left;cursor:pointer;font-family:inherit">
          <div class="stat-icon" style="background:var(--warning-light);color:var(--warning);"><i data-lucide="activity"></i></div>
          <div class="stat-value" id="progress-deviations">0</div>
          <div class="stat-label">Есть отклонения</div>
        </button>
        <button type="button" class="stat-card progress-widget" data-progress-filter="yellow" style="text-align:left;cursor:pointer;font-family:inherit">
          <div class="stat-icon" style="background:#f59e0b20;color:#f59e0b;"><i data-lucide="circle"></i></div>
          <div class="stat-value" id="progress-yellow">0</div>
          <div class="stat-label">Жёлтый светофор</div>
        </button>
        <button type="button" class="stat-card progress-widget" data-progress-filter="red" style="text-align:left;cursor:pointer;font-family:inherit">
          <div class="stat-icon" style="background:var(--danger-light);color:var(--danger);"><i data-lucide="circle"></i></div>
          <div class="stat-value" id="progress-red">0</div>
          <div class="stat-label">Красный светофор</div>
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
        <div class="text-center text-muted" style="padding:var(--space-8);">Загрузка...</div>
      </div>
    </div>`;
}

export function initReportPage(app) {
  currentReport = currentReport || getReportKeyFromUrl();
  if (!currentReport) return;
  loadReportData(app);

  // Update breadcrumb with actual report name
  const config = reportConfig[currentReport];
  if (config) {
    const bc = document.getElementById('breadcrumb-nav');
    if (bc) {
      bc.innerHTML = `
        <a href="#/reports" class="breadcrumb-parent">Статусы для встреч</a>
        <span class="breadcrumb-separator">/</span>
        <span class="breadcrumb-current">${config.name}</span>`;
    }
  }

  document.getElementById('report-back-btn')?.addEventListener('click', () => {
    Object.keys(reportChartInstances).forEach(k => { reportChartInstances[k]?.destroy(); delete reportChartInstances[k]; });
    currentReport = null;
    app.router.navigate('/reports');
  });

  document.getElementById('report-refresh')?.addEventListener('click', () => {
    loadReportData(app);
  });

  document.getElementById('progress-widgets')?.addEventListener('click', (e) => {
    const widget = e.target.closest('.progress-widget');
    if (!widget || currentReport !== 'progress' || !cachedReportData) return;
    const filter = widget.dataset.progressFilter;
    const current = reportColumnFilters.progress_indicator || [];
    const requested = filter === 'deviations' ? ['yellow', 'red'] : (filter === 'all' ? [] : [filter]);
    const alreadyActive = requested.length === current.length && requested.every(value => current.includes(value));
    if (alreadyActive && filter !== 'all') delete reportColumnFilters.progress_indicator;
    else if (requested.length) reportColumnFilters.progress_indicator = requested;
    else delete reportColumnFilters.progress_indicator;
    renderReportContent(reportConfig.progress, 'progress', cachedReportData);
  });

  document.getElementById('report-excel')?.addEventListener('click', () => {
    if (currentReport && tasksCache.length) {
      const config = reportConfig[currentReport];
      let visible = tasksCache;
      if (!config.isDb) {
        visible = applyReportFilters(currentReport, tasksCache);
        const hasFilters = Object.keys(reportColumnFilters).some(k => reportColumnFilters[k] && reportColumnFilters[k].length);
        if (hasFilters) {
          visible = visible.filter(task =>
            Object.entries(reportColumnFilters).every(([field, vals]) => !vals || !vals.length || vals.includes(String(task[field] || '').trim()))
          );
        }
        if (reportSortField) {
          visible = [...visible].sort((a, b) => {
            const va = String(a[reportSortField] || '').toLowerCase();
            const vb = String(b[reportSortField] || '').toLowerCase();
            return reportSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          });
        }
      }
      exportReportExcel(currentReport, visible, app);
    }
  });

  document.getElementById('report-body')?.addEventListener('click', (e) => {
    const config = reportConfig[currentReport];

    const decisionButton = e.target.closest('.pip-decision-btn');
    if (decisionButton) {
      const decision = decisionButton.dataset.decision;
      const taskId = Number(decisionButton.dataset.taskId);
      const version = Number(decisionButton.dataset.taskVersion);
      if (!taskId || !['reject', 'accept'].includes(decision)) return;
      if (decision === 'reject' && !window.confirm('Отклонить эту задачу?')) return;

      const rowButtons = decisionButton.closest('tr')?.querySelectorAll('.pip-decision-btn') || [];
      rowButtons.forEach(btn => { btn.disabled = true; });
      app.api.put(`/tasks/${taskId}/pip-decision`, { decision, version })
        .then(() => {
          window.toast?.(decision === 'reject' ? 'Задача отклонена' : 'Задача принята в работу', 'success');
          return loadReportData(app);
        })
        .catch(err => {
          rowButtons.forEach(btn => { btn.disabled = false; });
          window.toast?.(window.formatErrorMessage?.(err) || err.message || 'Не удалось изменить статус', 'error');
        });
      return;
    }

    if (e.target.closest('.filter-trigger')) {
      if (config.isCustom || config.isDb) return;
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

    if (config.isCustom || config.isDb) return;

    const field = th.dataset.sort;
    if (reportSortField === field) {
      reportSortDir = reportSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      reportSortField = field;
      reportSortDir = 'asc';
    }
    const filtered = applyReportFilters(currentReport, tasksCache);
    renderReportContent(config, currentReport, filtered);
  });
}
