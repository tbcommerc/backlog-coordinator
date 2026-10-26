import { escapeHtml } from '../htmlUtils.js';
import { formatErrorMessage } from '../uiFeedback.js';
import { button as uiButton, field as uiField } from '../ui/primitives.js';
import { canUseReportingStatusWorkspace, reportingStatusHref } from './reportingStatuses.js?v=21';

const ENDPOINT = '/reports/directorate-report';
const TEAM_COLORS = ['#5b5bd6', '#087e8b', '#b35c19', '#8b4fb3', '#26734d', '#b23a48', '#3267a8', '#7a5b12'];

let state = null;

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
    .format(new Date(`${value}T12:00:00`));
}

function localDateFromIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function directorateMeetingMeta(scheduledDate, now = new Date()) {
  const meetingDate = localDateFromIso(scheduledDate);
  if (!meetingDate) return { label: 'Дата встречи не назначена', state: 'unscheduled' };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateLabel = formatDate(scheduledDate);
  if (meetingDate.getTime() === today.getTime()) return { label: `Встреча сегодня · ${dateLabel}`, state: 'today' };
  if (meetingDate < today) return { label: `Встреча не завершена · ${dateLabel}`, state: 'overdue' };
  return { label: `Встреча запланирована · ${dateLabel}`, state: 'planned' };
}

export function directorateTaskCountLabel(count) {
  const value = Number(count) || 0;
  const mod10 = value % 10;
  const mod100 = value % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'задача' : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'задачи' : 'задач');
  return `${value} ${word}`;
}

function formatUpdated(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function teamColor(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = ((hash << 5) - hash + char.codePointAt(0)) | 0;
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length];
}

function allTasks() {
  return (state?.data?.teams || []).flatMap(team => team.tasks || []);
}

function selectedTeam() {
  return state?.data?.teams?.find(team => team.team_name === state.selectedTeam) || null;
}

function uniqueValues(tasks, key) {
  return [...new Set(tasks.map(task => task[key] || '').filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

export function directorateVisibleTasks(tasks, { project = '', type = '' } = {}) {
  return (tasks || []).filter(task => (
    (!project || task.project_name === project)
    && (!type || task.task_type_name === type)
  ));
}

function filteredTasks(team) {
  return directorateVisibleTasks(team?.tasks, state);
}

export function directorateCustomerLine(task) {
  return [...new Set([task.department_name, task.business_customer_name].filter(Boolean))].join(', ');
}

function renderTaskCard(task, { attentionSection = false } = {}) {
  const showPrevious = state.statusViews.get(task.id) === 'previous';
  const customer = directorateCustomerLine(task);
  const currentDate = formatDate(state.data?.meeting?.scheduled_date);
  const previousDate = formatDate(task.previous_meeting_date);
  const currentText = task.directorate_status || 'Статус не заполнен';
  const previousText = task.previous_directorate_status || 'На предыдущей встрече статус не предоставлялся';
  const currentPanelId = `directorate-status-current-${task.id}`;
  const previousPanelId = `directorate-status-previous-${task.id}`;
  const attentionControl = task.can_edit_attention
    ? `<button type="button" class="btn btn-ghost btn-sm square-icon ui-btn directorate-star${task.directorate_attention ? ' is-active' : ''}" data-directorate-attention="${task.id}" aria-pressed="${Boolean(task.directorate_attention)}" title="${task.directorate_attention ? 'Убрать из показа лидеру трайба' : 'Показать лидеру трайба'}"><i data-lucide="star"></i></button>`
    : (task.directorate_attention ? '<span class="directorate-star is-active is-readonly" title="Требует показа лидеру трайба"><i data-lucide="star"></i></span>' : '');
  return `<article class="directorate-task-card${attentionSection ? ' is-attention' : ''}" data-open-directorate-task="${task.id}" tabindex="0" aria-label="Открыть задачу ${escapeHtml(task.title || 'Без названия')}">
    <div class="directorate-task-layout">
      <aside class="directorate-task-info" aria-label="Информация о задаче">
        <span class="directorate-task-info-label">Информация о задаче</span>
        <header class="directorate-task-head">
          <div class="directorate-task-title">
            <span class="directorate-task-id">${escapeHtml(task.public_id || String(task.id))}</span>
            <h4>${escapeHtml(task.title || 'Без названия')}</h4>
          </div>
          ${attentionControl}
        </header>
        ${task.task_type_name ? `<span class="directorate-type">${escapeHtml(task.task_type_name)}</span>` : ''}
        <dl class="directorate-task-meta">
          ${customer ? `<div><dt><i data-lucide="building-2"></i>Контур / заказчик</dt><dd>${escapeHtml(customer)}</dd></div>` : ''}
          ${task.owner_name ? `<div><dt><i data-lucide="user"></i>Ответственный</dt><dd>${escapeHtml(task.owner_name)}</dd></div>` : ''}
          ${task.directorate_status_updated_at ? `<div><dt><i data-lucide="clock-3"></i>Обновлено</dt><dd><time datetime="${escapeHtml(task.directorate_status_updated_at)}">${escapeHtml(formatUpdated(task.directorate_status_updated_at))}</time></dd></div>` : ''}
        </dl>
      </aside>
      <div class="directorate-task-status">
        <div class="directorate-status-tabs" role="tablist" aria-label="Версия статуса">
          <button type="button" role="tab" aria-selected="${!showPrevious}" aria-controls="${currentPanelId}" class="btn btn-secondary btn-sm ui-btn ${showPrevious ? '' : 'is-active'}" data-directorate-status-view="current" data-task-id="${task.id}">Текущий статус</button>
          <button type="button" role="tab" aria-selected="${showPrevious}" aria-controls="${previousPanelId}" class="btn btn-secondary btn-sm ui-btn ${showPrevious ? 'is-active' : ''}" data-directorate-status-view="previous" data-task-id="${task.id}" ${task.previous_meeting_date ? '' : 'disabled'}>Предыдущий${previousDate ? ` · ${escapeHtml(previousDate)}` : ''}</button>
        </div>
        <div class="directorate-status-stack">
          <div id="${currentPanelId}" role="tabpanel" data-status-version="current" class="directorate-status-text${showPrevious ? '' : ' is-active'}" aria-hidden="${showPrevious}">
            <span class="directorate-status-caption">Текущий статус${currentDate ? ` · ${escapeHtml(currentDate)}` : ''}</span>
            <div class="directorate-status-copy">${escapeHtml(currentText)}</div>
          </div>
          <div id="${previousPanelId}" role="tabpanel" data-status-version="previous" class="directorate-status-text${showPrevious ? ' is-active' : ''}${task.previous_directorate_status ? '' : ' is-empty'}" aria-hidden="${!showPrevious}">
            <span class="directorate-status-caption">Предыдущий статус${previousDate ? ` · ${escapeHtml(previousDate)}` : ''}</span>
            <div class="directorate-status-copy">${escapeHtml(previousText)}</div>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function renderTeamPicker(teams) {
  return `<nav class="directorate-team-picker" aria-label="Команды отчёта">${teams.map(team => {
    const active = team.team_name === state.selectedTeam;
    const color = teamColor(team.team_name);
    return `<button type="button" class="ui-surface-action directorate-team${active ? ' is-active' : ''}${team.total ? '' : ' is-empty'}" data-directorate-team="${escapeHtml(team.team_name)}" aria-pressed="${active}" aria-label="${escapeHtml(team.team_name)}: ${escapeHtml(directorateTaskCountLabel(team.total))}" style="--team-color:${color}">
      <span class="directorate-team-dot" aria-hidden="true"></span><span class="directorate-team-name">${escapeHtml(team.team_name)}</span><strong aria-hidden="true">${team.total}</strong>
    </button>`;
  }).join('')}</nav>`;
}

function renderFilters(team, shownCount) {
  const projects = uniqueValues(team.tasks, 'project_name');
  const types = uniqueValues(team.tasks, 'task_type_name');
  const active = Boolean(state.project || state.type);
  const result = active ? `${shownCount} из ${team.total}` : directorateTaskCountLabel(team.total);
  return `<div class="directorate-filter-bar" aria-label="Фильтры отчёта">
    <div class="directorate-filter-summary"><i data-lucide="sliders-horizontal"></i><span>Отбор задач</span><strong>${escapeHtml(result)}</strong></div>
    <div class="directorate-filters">
      ${uiField({ id: 'directorate-project', label: 'Проект', kind: 'select', value: state.project, options: [{ value: '', label: 'Все проекты' }, ...projects.map(value => ({ value, label: value }))], attrs: { 'data-directorate-filter': 'project' } })}
      ${uiField({ id: 'directorate-type', label: 'Тип', kind: 'select', value: state.type, options: [{ value: '', label: 'Все типы задач' }, ...types.map(value => ({ value, label: value }))], attrs: { 'data-directorate-filter': 'type' } })}
      ${uiButton({ label: 'Сбросить', icon: 'rotate-ccw', variant: 'ghost', size: 'small', className: 'directorate-filter-reset', attrs: { 'data-directorate-reset': '', disabled: !active, 'aria-label': 'Сбросить фильтры' } })}
    </div>
  </div>`;
}

function renderControlPanel(teams, team, shownCount) {
  const populatedTeams = teams.filter(item => Number(item.total) > 0).length;
  const totalTasks = teams.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  return `<section class="directorate-control-panel" aria-labelledby="directorate-control-title">
    <header class="directorate-control-head">
      <div class="directorate-control-title"><span class="directorate-control-icon"><i data-lucide="layout-dashboard"></i></span><div><h2 id="directorate-control-title">Команды отчёта</h2><p>Переключайтесь между статусами без перезагрузки страницы</p></div></div>
      <div class="directorate-control-metrics" aria-label="Сводка отчёта"><span><strong>${populatedTeams}</strong> с данными</span><span><strong>${totalTasks}</strong> всего задач</span></div>
    </header>
    <div class="directorate-team-zone">
      <div class="directorate-section-label"><span>Выберите команду</span><strong>${escapeHtml(team.team_name)}</strong></div>
      ${renderTeamPicker(teams)}
    </div>
    ${renderFilters(team, shownCount)}
  </section>`;
}

function renderProjectGroups(tasks) {
  const groups = new Map();
  tasks.forEach(task => {
    const project = task.project_name || 'Без проекта';
    if (!groups.has(project)) groups.set(project, []);
    groups.get(project).push(task);
  });
  return [...groups.entries()].map(([project, items]) => `<section class="directorate-project" aria-label="Проект: ${escapeHtml(project)}">
    <header><div><span class="directorate-project-dot"></span><div class="directorate-project-heading"><span class="directorate-project-kicker">Проект</span><h3>${escapeHtml(project)}</h3></div></div><span class="directorate-project-count">Задач: <strong>${items.length}</strong></span></header>
    <div class="directorate-task-list">${items.map(task => renderTaskCard(task)).join('')}</div>
  </section>`).join('');
}

function renderContent() {
  const root = document.getElementById('directorate-report-content');
  if (!root || !state?.data) return;
  const teams = state.data.teams || [];
  if (!teams.length) {
    root.innerHTML = `<div class="directorate-empty"><i data-lucide="clipboard-check"></i><h2>Нет готовых статусов</h2><p>Отчёт появится, когда команда заполнит статус и подтвердит его готовность.</p></div>`;
    window.lucide?.createIcons();
    return;
  }
  if (!selectedTeam()) state.selectedTeam = teams[0].team_name;
  const team = selectedTeam();
  const tasks = filteredTasks(team);
  const attention = tasks.filter(task => task.directorate_attention);
  const regular = tasks.filter(task => !task.directorate_attention);
  const emptyTitle = team.total ? 'Задачи не найдены' : 'Нет готовых статусов';
  const emptyText = team.total ? 'Измените или сбросьте фильтры.' : 'Команда пока не добавила в отчёт готовые статусы.';
  root.innerHTML = `${renderControlPanel(teams, team, tasks.length)}
    ${attention.length ? `<section class="directorate-attention"><header><div><span class="directorate-attention-icon"><i data-lucide="star"></i></span><div><span>Фокус встречи</span><h3>Требует показа лидеру трайба</h3></div></div><strong>${attention.length}</strong></header><div class="directorate-task-list">${attention.map(task => renderTaskCard(task, { attentionSection: true })).join('')}</div></section>` : ''}
    ${regular.length ? `<div class="directorate-projects">${renderProjectGroups(regular)}</div>` : (attention.length ? '' : `<div class="directorate-empty is-compact"><h2>${emptyTitle}</h2><p>${emptyText}</p></div>`)}`;
  window.lucide?.createIcons();
}

function renderExcel(data) {
  const tasks = (data.teams || []).flatMap(team => team.tasks || []);
  const headers = ['Команда', 'Проект', 'Задача', 'Тип', 'Бизнес-заказчик', 'Исполнитель', 'Статус', 'Предыдущий статус', 'Показать лидеру'];
  const rows = tasks.map(task => [task.team_name, task.project_name, task.title, task.task_type_name, directorateCustomerLine(task), task.owner_name, task.directorate_status, task.previous_directorate_status, task.directorate_attention ? 'Да' : 'Нет']);
  if (typeof XLSX !== 'undefined') {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet['!cols'] = [{ wch: 20 }, { wch: 24 }, { wch: 42 }, { wch: 18 }, { wch: 28 }, { wch: 24 }, { wch: 60 }, { wch: 60 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Директорская оперативка');
    XLSX.writeFile(workbook, 'directorate_report.xlsx');
  }
}

async function load(app) {
  const root = document.getElementById('directorate-report-content');
  if (root) root.innerHTML = '<div class="directorate-loading content-loading-state"><span class="spinner"></span><p>Собираем готовые статусы…</p></div>';
  try {
    const data = await app.api.get(ENDPOINT);
    state.data = data;
    if (!data.teams?.some(team => team.team_name === state.selectedTeam)) state.selectedTeam = data.teams?.[0]?.team_name || '';
    renderContent();
    const count = document.getElementById('directorate-report-total');
    if (count) count.textContent = directorateTaskCountLabel(data.total_tasks);
    const meeting = document.getElementById('directorate-meeting-date');
    if (meeting) {
      const meetingMeta = directorateMeetingMeta(data.meeting?.scheduled_date);
      meeting.textContent = meetingMeta.label;
      meeting.dataset.state = meetingMeta.state;
    }
  } catch (error) {
    if (root) root.innerHTML = `<div class="directorate-empty"><i data-lucide="triangle-alert"></i><h2>Не удалось загрузить отчёт</h2><p>${escapeHtml(formatErrorMessage(error))}</p><button type="button" class="btn btn-secondary" data-directorate-retry>Повторить</button></div>`;
    window.lucide?.createIcons();
  }
}

export function renderDirectorateReport(app) {
  return `<div class="directorate-report animate-fade-in">
    <header class="directorate-page-header">
      ${uiButton({ label: 'Вернуться к отчётам', icon: 'arrow-left', iconOnly: true, variant: 'ghost', size: 'small', attrs: { 'data-directorate-back': '' } })}
      <div class="directorate-page-heading">
        <h1>Статусы к Директорской оперативке</h1>
        <div class="directorate-page-meta">
          <span id="directorate-meeting-date" class="directorate-meeting-badge">Проверяем дату встречи…</span>
          <span class="directorate-report-count">В отчёт включено: <strong id="directorate-report-total">Загрузка…</strong></span>
        </div>
      </div>
      <div class="directorate-header-actions">
        ${canUseReportingStatusWorkspace(app) ? `<a class="btn btn-primary btn-sm" href="${reportingStatusHref({ source: 'report', kind: 'directorate' })}"><i data-lucide="pencil"></i>Заполнить статусы</a>` : ''}
        ${uiButton({ label: 'Excel', icon: 'file-spreadsheet', size: 'small', attrs: { 'data-directorate-excel': '' } })}
        ${uiButton({ label: 'Обновить', icon: 'refresh-cw', size: 'small', attrs: { 'data-directorate-refresh': '' } })}
      </div>
    </header>
    <main id="directorate-report-content" class="directorate-report-content"><div class="directorate-loading content-loading-state"><span class="spinner"></span><p>Собираем готовые статусы…</p></div></main>
  </div>`;
}

export function initDirectorateReport(app) {
  state = { app, data: null, selectedTeam: '', project: '', type: '', statusViews: new Map() };
  load(app);
  const page = document.querySelector('.directorate-report');
  page?.addEventListener('click', async event => {
    if (event.target.closest('[data-directorate-back]')) { app.router.navigate('/reports'); return; }
    if (event.target.closest('[data-directorate-refresh], [data-directorate-retry]')) { await load(app); return; }
    if (event.target.closest('[data-directorate-excel]')) { if (state.data) renderExcel(state.data); return; }
    const teamButton = event.target.closest('[data-directorate-team]');
    if (teamButton) {
      state.selectedTeam = teamButton.dataset.directorateTeam;
      state.project = '';
      state.type = '';
      renderContent();
      return;
    }
    if (event.target.closest('[data-directorate-reset]')) {
      state.project = '';
      state.type = '';
      renderContent();
      return;
    }
    const view = event.target.closest('[data-directorate-status-view]');
    if (view) {
      const taskId = Number(view.dataset.taskId);
      const selectedView = view.dataset.directorateStatusView;
      state.statusViews.set(taskId, selectedView);
      const card = view.closest('.directorate-task-card');
      card?.querySelectorAll('[data-directorate-status-view]').forEach(tab => {
        const active = tab.dataset.directorateStatusView === selectedView;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      card?.querySelectorAll('.directorate-status-text[role="tabpanel"]').forEach(panel => {
        const active = panel.id === `directorate-status-${selectedView}-${taskId}`;
        panel.classList.toggle('is-active', active);
        panel.setAttribute('aria-hidden', String(!active));
      });
      return;
    }
    const attention = event.target.closest('[data-directorate-attention]');
    if (attention) {
      const taskId = Number(attention.dataset.directorateAttention);
      const task = allTasks().find(item => item.id === taskId);
      if (!task || !state.data?.meeting?.id) return;
      attention.disabled = true;
      try {
        const result = await app.api.put(`/tasks/${taskId}/reporting-statuses/${state.data.meeting.id}/directorate-attention`, { enabled: !task.directorate_attention, version: task.reporting_status_version });
        task.directorate_attention = Boolean(result.directorate_attention);
        task.reporting_status_version = result.version;
        renderContent();
      } catch (error) {
        attention.disabled = false;
        window.toast?.(formatErrorMessage(error), 'error');
      }
      return;
    }
    const card = event.target.closest('[data-open-directorate-task]');
    if (card) document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(card.dataset.openDirectorateTask), tab: 'rep' } }));
  });
  page?.addEventListener('change', event => {
    const filter = event.target.closest('[data-directorate-filter]');
    if (!filter) return;
    state[filter.dataset.directorateFilter] = filter.value;
    renderContent();
  });
  page?.addEventListener('keydown', event => {
    const card = event.target.closest('[data-open-directorate-task]');
    if (card && event.target === card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(card.dataset.openDirectorateTask), tab: 'rep' } }));
    }
  });
}
