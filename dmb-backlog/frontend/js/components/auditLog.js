let auditState = { page: 1, perPage: 50, filters: { user_id: '', action: '', entity_type: '', date_from: '', date_to: '' } };
let auditData = { items: [], total: 0, pages: 0 };
let auditFilters = { actions: [], entity_types: [], users: [] };

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getActionBadge(action) {
  const map = {
    create: '<span class="badge badge-success" style="font-size:11px">CREATE</span>',
    update: '<span class="badge badge-info" style="font-size:11px">UPDATE</span>',
    delete: '<span class="badge" style="font-size:11px;background:var(--danger-light);color:var(--danger)">DELETE</span>',
  };
  return map[action] || `<span class="badge" style="font-size:11px">${escapeHtml(action)}</span>`;
}

function getEntityTypeBadge(type) {
  const colors = {
    tasks: 'var(--accent)',
    teams: 'var(--success)',
    users: 'var(--warning)',
    roles: '#8b5cf6',
    projects: '#06b6d4',
    statuses: '#f97316',
    priorities: '#ec4899',
    channels: '#14b8a6',
    deadlines: '#64748b',
    departments: '#a855f7',
    'task-types': '#ef4444',
    'team-types': '#3b82f6',
    'project-statuses': '#84cc16',
    'business-customers': '#f59e0b',
    'notification-templates': '#6366f1',
    'column-labels': '#0ea5e9',
    'display-settings': '#10b981',
  };
  const c = colors[type] || 'var(--text-muted)';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:${c}18;color:${c};font-weight:500">${escapeHtml(type)}</span>`;
}

function parseDetails(details) {
  if (!details) return '—';
  try {
    const obj = typeof details === 'string' ? JSON.parse(details) : details;
    if (obj.path && obj.status_code) {
      return `<span style="font-size:11px;color:var(--text-muted)">${escapeHtml(obj.method || '')} ${escapeHtml(obj.path)}</span> <span style="font-size:10px;padding:1px 5px;border-radius:3px;background:${obj.status_code < 400 ? 'var(--success-light);color:var(--success)' : 'var(--danger-light);color:var(--danger)'}">${Number(obj.status_code) || 0}</span>`;
    }
    return escapeHtml(JSON.stringify(obj));
  } catch {
    return escapeHtml(details);
  }
}

async function loadAuditData(app) {
  const s = auditState;
  const params = new URLSearchParams({ page: s.page, per_page: s.perPage });
  if (s.filters.user_id) params.set('user_id', s.filters.user_id);
  if (s.filters.action) params.set('action', s.filters.action);
  if (s.filters.entity_type) params.set('entity_type', s.filters.entity_type);
  if (s.filters.date_from) params.set('date_from', s.filters.date_from);
  if (s.filters.date_to) params.set('date_to', s.filters.date_to);

  try {
    const data = await app.api.get(`/admin/audit-log?${params}`);
    auditData = data;
  } catch (e) {
    auditData = { items: [], total: 0, pages: 0 };
  }
}

async function loadAuditFilters(app) {
  try {
    auditFilters = await app.api.get('/admin/audit-log/filters');
  } catch (e) {
    auditFilters = { actions: [], entity_types: [], users: [] };
  }
}

function renderAuditTable() {
  const items = auditData.items || [];
  if (!items.length) {
    return '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">Нет записей аудита</td></tr>';
  }
  return items.map(item => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted);white-space:nowrap">${formatDateTime(item.created_at)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);font-size:13px;color:var(--text-primary);font-weight:500">${item.user_name ? escapeHtml(item.user_name) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color)">${getActionBadge(item.action)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color)">${getEntityTypeBadge(item.entity_type)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);font-size:13px;color:var(--text-secondary)">${item.entity_id || '—'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${parseDetails(item.details)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted);font-family:monospace">${escapeHtml(item.ip_address || '—')}</td>
    </tr>
  `).join('');
}

function renderPagination() {
  const { page, perPage } = auditState;
  const { total, pages } = auditData;
  if (pages <= 1) return '';

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  let pageButtons = '';
  const maxVisible = 5;
  let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
  let endPage = Math.min(pages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

  if (startPage > 1) {
    pageButtons += `<button class="btn btn-sm audit-page-btn" data-page="1" style="min-width:32px">1</button>`;
    if (startPage > 2) pageButtons += `<span style="color:var(--text-muted);padding:0 4px">...</span>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    pageButtons += `<button class="btn btn-sm audit-page-btn${i === page ? ' btn-primary' : ''}" data-page="${i}" style="min-width:32px">${i}</button>`;
  }
  if (endPage < pages) {
    if (endPage < pages - 1) pageButtons += `<span style="color:var(--text-muted);padding:0 4px">...</span>`;
    pageButtons += `<button class="btn btn-sm audit-page-btn" data-page="${pages}" style="min-width:32px">${pages}</button>`;
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--border-color)">
      <span style="font-size:12px;color:var(--text-muted)">Показано ${start}–${end} из ${total}</span>
      <div style="display:flex;align-items:center;gap:4px">
        <button class="btn btn-sm audit-page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled style="opacity:0.4;pointer-events:none"' : ''}>
          <i data-lucide="chevron-left" style="width:14px;height:14px"></i>
        </button>
        ${pageButtons}
        <button class="btn btn-sm audit-page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled style="opacity:0.4;pointer-events:none"' : ''}>
          <i data-lucide="chevron-right" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>
  `;
}

function renderFilterBar() {
  const s = auditState.filters;
  const selStyle = 'font-size:12px;padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);min-width:140px';

  const userOpts = auditFilters.users.map(u =>
    `<option value="${u.id}"${s.user_id == u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`
  ).join('');

  const actionOpts = auditFilters.actions.map(a =>
    `<option value="${escapeHtml(a)}"${s.action === a ? ' selected' : ''}>${escapeHtml(a.toUpperCase())}</option>`
  ).join('');

  const entityOpts = auditFilters.entity_types.map(e =>
    `<option value="${escapeHtml(e)}"${s.entity_type === e ? ' selected' : ''}>${escapeHtml(e)}</option>`
  ).join('');

  return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:6px">
        <i data-lucide="user" style="width:14px;height:14px;color:var(--text-muted)"></i>
        <select id="audit-filter-user" class="input" style="${selStyle}">
          <option value="">Все пользователи</option>
          ${userOpts}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <i data-lucide="zap" style="width:14px;height:14px;color:var(--text-muted)"></i>
        <select id="audit-filter-action" class="input" style="${selStyle}">
          <option value="">Все действия</option>
          ${actionOpts}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <i data-lucide="layers" style="width:14px;height:14px;color:var(--text-muted)"></i>
        <select id="audit-filter-entity" class="input" style="${selStyle}">
          <option value="">Все сущности</option>
          ${entityOpts}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <i data-lucide="calendar" style="width:14px;height:14px;color:var(--text-muted)"></i>
        <input type="date" id="audit-filter-date-from" class="input" value="${s.date_from}" style="${selStyle}">
        <span style="color:var(--text-muted);font-size:12px">—</span>
        <input type="date" id="audit-filter-date-to" class="input" value="${s.date_to}" style="${selStyle}">
      </div>
      <button id="audit-apply-filters" class="btn btn-primary btn-sm" style="margin-left:auto">
        <i data-lucide="search" style="width:14px;height:14px"></i> Применить
      </button>
      <button id="audit-reset-filters" class="btn btn-sm" style="background:var(--bg-tertiary);color:var(--text-secondary);border:1px solid var(--border-color)">
        <i data-lucide="x" style="width:14px;height:14px"></i> Сбросить
      </button>
    </div>
  `;
}

export function renderAuditLog(app) {
  return `
    <div class="page-header animate-fade-in">
      <div>
        <h1>Аудит действий</h1>
        <p>Журнал всех изменений в системе с фильтрацией и поиском</p>
      </div>
    </div>
    <div style="padding:0 var(--space-3) var(--space-3)">
      <div id="audit-filter-bar"></div>
      <div class="admin-section" style="padding:0;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--bg-tertiary)">
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Дата/время</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Пользователь</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Действие</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Тип сущности</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">ID сущности</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Детали</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">IP-адрес</th>
            </tr>
          </thead>
          <tbody id="audit-table-body">
            <tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">
              <div style="display:flex;align-items:center;justify-content:center;gap:8px">
                <div class="spinner" style="width:16px;height:16px;border:2px solid var(--border-color);border-top-color:var(--accent);border-radius:50%;animation:spin 0.6s linear infinite"></div>
                Загрузка...
              </div>
            </td></tr>
          </tbody>
        </table>
        <div id="audit-pagination"></div>
      </div>
    </div>
    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  `;
}

export async function initAuditLog(app) {
  await Promise.all([loadAuditData(app), loadAuditFilters(app)]);
  refreshAuditView();

  document.getElementById('audit-apply-filters')?.addEventListener('click', () => {
    collectFilters();
    auditState.page = 1;
    loadAuditData(app).then(refreshAuditView);
  });

  document.getElementById('audit-reset-filters')?.addEventListener('click', () => {
    auditState.filters = { user_id: '', action: '', entity_type: '', date_from: '', date_to: '' };
    auditState.page = 1;
    loadAuditData(app).then(() => {
      clearFilterInputs();
      refreshAuditView();
    });
  });

  document.getElementById('audit-table-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.audit-page-btn');
    if (btn && btn.dataset.page) {
      auditState.page = parseInt(btn.dataset.page);
      loadAuditData(app).then(refreshAuditView);
    }
  });

  document.getElementById('audit-pagination')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.audit-page-btn');
    if (btn && btn.dataset.page) {
      auditState.page = parseInt(btn.dataset.page);
      loadAuditData(app).then(refreshAuditView);
    }
  });
}

function collectFilters() {
  auditState.filters.user_id = document.getElementById('audit-filter-user')?.value || '';
  auditState.filters.action = document.getElementById('audit-filter-action')?.value || '';
  auditState.filters.entity_type = document.getElementById('audit-filter-entity')?.value || '';
  auditState.filters.date_from = document.getElementById('audit-filter-date-from')?.value || '';
  auditState.filters.date_to = document.getElementById('audit-filter-date-to')?.value || '';
}

function clearFilterInputs() {
  const el = id => document.getElementById(id);
  if (el('audit-filter-user')) el('audit-filter-user').value = '';
  if (el('audit-filter-action')) el('audit-filter-action').value = '';
  if (el('audit-filter-entity')) el('audit-filter-entity').value = '';
  if (el('audit-filter-date-from')) el('audit-filter-date-from').value = '';
  if (el('audit-filter-date-to')) el('audit-filter-date-to').value = '';
}

function refreshAuditView() {
  const filterBar = document.getElementById('audit-filter-bar');
  const tbody = document.getElementById('audit-table-body');
  const pagination = document.getElementById('audit-pagination');

  if (filterBar) filterBar.innerHTML = renderFilterBar();
  if (tbody) tbody.innerHTML = renderAuditTable();
  if (pagination) pagination.innerHTML = renderPagination();

  if (window.lucide) window.lucide.createIcons();
}
