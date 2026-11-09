import { filterMatches } from '../ui/filterValues.js';
import { progress as kitProgress } from '../ui/dataDisplay.js';
console.log('[DMB] customerReport.js loaded');
import { openTaskModal } from './modal.js?v=125';
import { formatTaskPublicId } from '../taskPublicId.js';
import { button as uiButton, control as uiControl, pageHeader as uiPageHeader } from '../ui/primitives.js';

let tasksCache = null;

export function renderCustomerReport(app) {
  const user = app.store.get('currentUser');
  const userName = user?.name || 'Заказчик';

  return `
    <div class="page-header animate-fade-in">
      ${uiPageHeader({ title: 'Отчёт по задачам', description: 'Статусы задач, инициированных вами' })}
    </div>

    <div class="customer-stats-grid">
      <div class="customer-stat-card">
        <div class="customer-stat-icon" style="background:var(--info-light);color:var(--info);">
          <i data-lucide="inbox"></i>
        </div>
        <div class="customer-stat-body">
          <div class="customer-stat-value" id="customer-stat-total">—</div>
          <div class="customer-stat-label">Всего задач</div>
        </div>
      </div>
      <div class="customer-stat-card">
        <div class="customer-stat-icon" style="background:var(--success-light);color:var(--success);">
          <i data-lucide="play-circle"></i>
        </div>
        <div class="customer-stat-body">
          <div class="customer-stat-value" id="customer-stat-active">—</div>
          <div class="customer-stat-label">В работе</div>
        </div>
      </div>
      <div class="customer-stat-card">
        <div class="customer-stat-icon" style="background:var(--danger-light);color:var(--danger);">
          <i data-lucide="alert-triangle"></i>
        </div>
        <div class="customer-stat-body">
          <div class="customer-stat-value" id="customer-stat-risk">—</div>
          <div class="customer-stat-label">Под риском</div>
        </div>
      </div>
      <div class="customer-stat-card">
        <div class="customer-stat-icon" style="background:var(--warning-light);color:var(--warning);">
          <i data-lucide="check-circle"></i>
        </div>
        <div class="customer-stat-body">
          <div class="customer-stat-value" id="customer-stat-done">—</div>
          <div class="customer-stat-label">Выполнено</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Мои задачи</h2>
        <div class="ui-customer-report-actions">
          ${uiControl({ id: 'customer-status-filter', kind: 'select', options: [{ value: '', label: 'Все статусы' }, ...['СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ', 'ЭСКАЛАЦИЯ НА ЛТ', 'ХОЛД', 'ВЫПОЛНЕНА', 'ОТКЛОНЕНА'].map(value => ({ value, label: value }))], attrs: { 'aria-label': 'Статус задачи' } })}
          ${uiButton({ label: 'Обновить', icon: 'refresh-cw', iconOnly: true, attrs: { id: 'refresh-tasks-btn' } })}
        </div>
      </div>
      <div class="card-body">
        <div class="table-container" style="overflow-x:auto;">
          <table class="ui-table ui-table-data table" id="customer-tasks-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Статус</th>
                <th>Приоритет</th>
                <th>Команда</th>
                <th>Прогресс</th>
                <th>Срок</th>
              </tr>
            </thead>
            <tbody id="customer-tasks-tbody">
              ${renderSkeletonRows(6)}
            </tbody>
          </table>
        </div>
        <div class="flex justify-between items-center" style="margin-top:var(--space-4);">
          <span class="text-secondary" id="customer-tasks-count">Найдено: 0 задач</span>
        </div>
      </div>
    </div>
  `;
}

export async function initCustomerReport(app) {
  await loadTasks(app);

  document.getElementById('refresh-tasks-btn')?.addEventListener('click', () => loadTasks(app));
  document.getElementById('customer-status-filter')?.addEventListener('change', () => renderTasksTable(tasksCache?.items || [], document.getElementById('customer-status-filter').value));
}

async function loadTasks(app) {
  try {
    const data = await app.api.get('/customer/tasks?per_page=200');
    tasksCache = data;
    const items = data.items || [];

    const total = items.length;
    const active = items.filter(t => ['СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ'].includes(t.status)).length;
    const risk = items.filter(t => ['ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ', 'ОТКЛОНЕНА'].includes(t.status)).length;
    const done = items.filter(t => t.status === 'ВЫПОЛНЕНА').length;

    const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setStat('customer-stat-total', total);
    setStat('customer-stat-active', active);
    setStat('customer-stat-risk', risk);
    setStat('customer-stat-done', done);

    const filter = document.getElementById('customer-status-filter')?.value || '';
    renderTasksTable(items, filter);
  } catch (e) {
    document.getElementById('customer-tasks-tbody').innerHTML =
      `<tr><td colspan="7" class="text-center text-muted" >Ошибка загрузки: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderTasksTable(tasks, statusFilter) {
  const tbody = document.getElementById('customer-tasks-tbody');
  const countEl = document.getElementById('customer-tasks-count');

  const filtered = statusFilter ? tasks.filter(t => filterMatches(statusFilter,t.status)) : tasks;

  if (countEl) {
    countEl.textContent = `Найдено: ${filtered.length} задач`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" >
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <i data-lucide="inbox" style="width:32px;height:32px;color:var(--text-muted);"></i>
        <span>Задач пока нет</span>
      </div>
    </td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = filtered.map(task => `
    <tr data-task-id="${task.id}" style="cursor:pointer;">
      <td><span class="font-mono text-muted">${formatTaskPublicId(task)}</span></td>
      <td><strong>${escapeHtml(task.title)}</strong></td>
      <td>${renderStatus(task.status)}</td>
      <td>${renderPriority(task.priority)}</td>
      <td><span class="badge badge-info">${escapeHtml(task.team_name || '—')}</span></td>
      <td>${renderProgress(task.progress)}</td>
      <td>${escapeHtml(task.deadline || '—')}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const taskId = parseInt(tr.dataset.taskId);
      const task = filtered.find(t => t.id === taskId);
      if (task) openTaskModal(task);
    });
  });
}

function renderSkeletonRows(count) {
  return Array.from({ length: count }, () => `
    <tr class="skeleton-row">
      <td><div class="skeleton skeleton-block w-30"></div></td>
      <td><div class="skeleton skeleton-block w-80"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-30"></div></td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderStatus(status) {
  const statusClass = status ? status.replace(/\s+/g, '_') : 'backlog';
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
  return `<span class="badge ${colors[statusClass] || 'badge-status-backlog'}">${escapeHtml(status || 'СБОР ТРЕБОВАНИЙ')}</span>`;
}

function renderPriority(priority) {
  const map = { 'ВЫСОКИЙ': 'high', 'СРЕДНИЙ': 'medium', 'НИЗКИЙ': 'low' };
  const cls = map[priority] || 'medium';
  return `<span class="badge badge-${cls}">${escapeHtml(priority || 'СРЕДНИЙ')}</span>`;
}

function renderProgress(value) { return kitProgress({value,showValue:true,tone:Number(value)>=100?'success':'accent'}); }
