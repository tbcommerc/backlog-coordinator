console.log('[DMB] customerPortal.js loaded');
let tasksCache = null;

export function renderCustomerPortal(app) {
  const user = app.store.get('currentUser');
  const userName = user?.name || 'Заказчик';

  return `
    <div class="page-header animate-fade-in">
      <h1>Мои задачи</h1>
      <p>Добро пожаловать, ${userName}</p>
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
        <h2 class="card-title">Мои запросы</h2>
        <a href="#/customer/create" class="btn btn-primary btn-sm">
          <i data-lucide="bot" style="width:14px;height:14px;"></i>
          Новый запрос
        </a>
      </div>
      <div class="card-body">
        <div class="table-container" style="overflow-x:auto;">
          <table class="table" id="customer-requests-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Статус</th>
                <th>Дата создания</th>
              </tr>
            </thead>
            <tbody id="customer-requests-tbody">
              <tr><td colspan="4" class="text-center text-muted" style="padding:40px;">Загрузка...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-between items-center" style="margin-top:var(--space-4);">
          <span class="text-secondary" id="customer-requests-count">Найдено: 0 запросов</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Мои задачи</h2>
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="customer-status-filter" class="input" style="width:auto;padding:6px 10px;font-size:12px;">
            <option value="">Все статусы</option>
            <option value="СБОР ТРЕБОВАНИЙ">СБОР ТРЕБОВАНИЙ</option>
            <option value="ПРОВЕРКА ТРЕБОВАНИЙ">ПРОВЕРКА ТРЕБОВАНИЙ</option>
            <option value="УТОЧНЕНИЕ ТРЕБОВАНИЙ">УТОЧНЕНИЕ ТРЕБОВАНИЙ</option>
            <option value="ЭКСПРЕСС-ОЦЕНКА">ЭКСПРЕСС-ОЦЕНКА</option>
            <option value="ПРИНЯТИЕ РЕШЕНИЯ">ПРИНЯТИЕ РЕШЕНИЯ</option>
            <option value="ПРИНЯТА В РАБОТУ">ПРИНЯТА В РАБОТУ</option>
            <option value="ЭСКАЛАЦИЯ НА ЛТ">ЭСКАЛАЦИЯ НА ЛТ</option>
            <option value="ХОЛД">ХОЛД</option>
            <option value="ВЫПОЛНЕНА">ВЫПОЛНЕНА</option>
            <option value="ОТКЛОНЕНА">ОТКЛОНЕНА</option>
          </select>
          <button class="btn btn-secondary btn-sm" id="refresh-tasks-btn" aria-label="Обновить">
            <i data-lucide="refresh-cw" style="width:14px;height:14px;"></i>
          </button>
          <a href="#/customer/create" class="btn btn-primary btn-sm">
            <i data-lucide="bot" style="width:14px;height:14px;"></i>
            ИИ-ассистент
          </a>
        </div>
      </div>
      <div class="card-body">
        <div class="table-container" style="overflow-x:auto;">
          <table class="table" id="customer-tasks-table">
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
              <tr><td colspan="7" class="text-center text-muted" style="padding:40px;">Загрузка...</td></tr>
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

export async function initCustomerPortal(app) {
  await loadTasks(app);
  await loadRequests(app);

  document.getElementById('refresh-tasks-btn')?.addEventListener('click', () => loadTasks(app));
  document.getElementById('customer-status-filter')?.addEventListener('change', () => {
    const filter = document.getElementById('customer-status-filter').value;
    renderTasksTable(tasksCache?.items || [], filter);
  });

  if (window.lucide) window.lucide.createIcons();
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
      `<tr><td colspan="7" class="text-center text-muted" style="padding:40px;">Ошибка загрузки: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderTasksTable(tasks, statusFilter) {
  const tbody = document.getElementById('customer-tasks-tbody');
  const countEl = document.getElementById('customer-tasks-count');

  const filtered = statusFilter ? tasks.filter(t => t.status === statusFilter) : tasks;

  if (countEl) {
    countEl.textContent = `Найдено: ${filtered.length} задач`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:40px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <i data-lucide="inbox" style="width:32px;height:32px;color:var(--text-muted);"></i>
        <span>Задач пока нет</span>
      </div>
    </td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = filtered.map(task => `
    <tr data-task-id="${task.id}">
      <td><span class="font-mono text-muted">#${task.id}</span></td>
      <td><strong>${escapeHtml(task.title)}</strong></td>
      <td>${renderStatus(task.status)}</td>
      <td>${renderPriority(task.priority)}</td>
      <td><span class="badge badge-info">${escapeHtml(task.team_name || '—')}</span></td>
      <td>${renderProgress(task.progress)}</td>
      <td>${escapeHtml(task.deadline || '—')}</td>
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

function renderProgress(progress) {
  const p = progress || 0;
  let colorClass = '';
  if (p >= 100) colorClass = 'success';
  else if (p > 0) colorClass = 'warning';
  return `
    <div style="display:flex;align-items:center;gap:8px;min-width:100px;">
      <div class="progress-bar" style="flex:1;">
        <div class="progress-fill ${colorClass}" style="width:${p}%"></div>
      </div>
      <span style="font-size:var(--text-xs);color:var(--text-secondary);min-width:30px;text-align:right;">${p}%</span>
    </div>
  `;
}

/* ==================== REQUIREMENT REQUESTS ==================== */

const REQUEST_STATUS_LABELS = {
  draft: 'Черновик',
  submitted: 'На ревью',
  in_review: 'На рассмотрении',
  approved: 'Утверждён',
  rejected: 'Отклонён',
};

const REQUEST_STATUS_BADGES = {
  draft: 'badge-low',
  submitted: 'badge-info',
  in_review: 'badge-medium',
  approved: 'badge-success',
  rejected: 'badge-danger',
};

function requestStatusBadge(status) {
  const label = REQUEST_STATUS_LABELS[status] || status || '—';
  const cls = REQUEST_STATUS_BADGES[status] || 'badge-medium';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

async function loadRequests(app) {
  try {
    const requests = await app.api.get('/agent/requests');
    const rows = Array.isArray(requests) ? requests : [];
    renderRequestsTable(rows);
  } catch (e) {
    const tbody = document.getElementById('customer-requests-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:40px;">Ошибка загрузки: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderRequestsTable(requests) {
  const tbody = document.getElementById('customer-requests-tbody');
  const countEl = document.getElementById('customer-requests-count');
  if (countEl) countEl.textContent = `Найдено: ${requests.length} запросов`;

  if (!tbody) return;
  if (requests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding:40px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <i data-lucide="bot" style="width:32px;height:32px;color:var(--text-muted);"></i>
        <span>Запросов пока нет — создайте через ИИ-ассистента</span>
      </div>
    </td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = requests.map(r => `
    <tr data-request-id="${r.id}">
      <td><span class="font-mono text-muted">#${r.id}</span></td>
      <td><strong>${escapeHtml(r.title)}</strong></td>
      <td>${requestStatusBadge(r.status)}</td>
      <td>${r.created_at ? formatDate(r.created_at) : '—'}</td>
    </tr>
  `).join('');

}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export async function renderRequestPage(app, requestId) {
  let req = null;
  try {
    req = await app.api.get(`/agent/requests/${requestId}`);
  } catch (e) {
    return `
      <div class="page-header animate-fade-in">
        <h1>Запрос</h1>
        <p>Ошибка загрузки: ${escapeHtml(e.message)}</p>
        <a href="#/customer" class="btn btn-secondary btn-sm">Назад к моим запросам</a>
      </div>
    `;
  }

  return `
    <div class="page-header animate-fade-in" style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3);">
      <div style="flex:1;min-width:0;">
        <h1>Запрос #${req.id}</h1>
        <p>${requestStatusBadge(req.status)}</p>
      </div>
      <a href="#/customer" class="btn btn-secondary btn-sm">
        <i data-lucide="arrow-left" style="width:14px;height:14px;"></i>
        Назад к запросам
      </a>
    </div>

    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h2 class="card-title">${escapeHtml(req.title)}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;" id="request-status-actions">
          ${renderStatusActions(req.status)}
        </div>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:var(--space-5);flex-wrap:wrap;margin-bottom:var(--space-4);">
          <div><span class="text-muted">Создан:</span> <span>${formatDate(req.created_at)}</span></div>
          <div><span class="text-muted">Обновлён:</span> <span>${formatDate(req.updated_at)}</span></div>
        </div>
        <div class="request-detail">${renderRequestDescription(req.description)}</div>
        ${req.draft ? `<details style="margin-top:var(--space-4);"><summary class="text-secondary" style="cursor:pointer;font-size:var(--text-sm);">Показать полный драфт (JSON)</summary><pre style="margin-top:var(--space-2);padding:var(--space-3);background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-md);overflow:auto;font-size:11px;max-height:400px;">${escapeHtml(JSON.stringify(req.draft, null, 2))}</pre></details>` : ''}
      </div>
    </div>
  `;
}

export function initRequestPage(app, requestId) {
  const container = document.getElementById('request-status-actions');
  if (!container) return;

  container.querySelectorAll('[data-request-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.requestStatus;
      btn.disabled = true;
      try {
        await app.api.put(`/agent/requests/${requestId}/status`, { status });
        const page = document.getElementById('page-content');
        if (page) {
          page.innerHTML = await renderRequestPage(app, requestId);
          if (window.lucide) window.lucide.createIcons();
          initRequestPage(app, requestId);
        }
      } catch (e) {
        btn.disabled = false;
        const detail = window.formatErrorMessage?.(e) || 'Не удалось обновить статус';
        window.toast?.(`Не удалось обновить статус: ${detail}`, 'error');
      }
    });
  });
}

function renderStatusActions(status) {
  const btn = (s, label, primary) => `<button class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm" data-request-status="${s}">${label}</button>`;
  if (status === 'submitted') {
    return btn('in_review', 'Взять в работу') + btn('approved', 'Утвердить', true) + btn('rejected', 'Отклонить');
  }
  if (status === 'in_review') {
    return btn('approved', 'Утвердить', true) + btn('rejected', 'Отклонить');
  }
  if (status === 'approved' || status === 'rejected') {
    return btn('submitted', 'Вернуть на ревью');
  }
  return '';
}

function renderRequestDescription(description) {
  if (!description) return '<span class="text-muted">Описание пусто</span>';
  const lines = String(description).split('\n');
  let html = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^\*\*(.+?):\*\*(.*)$/);
    if (m) {
      html += `<div class="request-detail-row"><span class="request-detail-key">${escapeHtml(m[1].trim())}</span><span class="request-detail-val">${escapeHtml(m[2].trim())}</span></div>`;
    } else if (trimmed.startsWith('- ')) {
      html += `<div class="request-detail-list"><span class="request-detail-bullet">•</span><span>${escapeHtml(trimmed.slice(2))}</span></div>`;
    } else {
      html += `<div class="request-detail-text">${escapeHtml(trimmed)}</div>`;
    }
  }
  return html;
}
