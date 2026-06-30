// === DMB Backlog — Подробная карточка задачи (Master-Detail) ===
// === Референс: Карточка задачи - референс.html ===
// === 24 атрибута, 6 табов, KPI Strip, связь с БД ===

// === STATE ===
let currentTask = null;
let modalMode = 'view';
let currentModal = null;
let onSaveCallback = null;

// === HELPERS ===
function metricFormat(val) {
  if (val === null || val === undefined || val === '') return '—';
  return new Intl.NumberFormat('ru-RU').format(val);
}

function escapeHtml(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, m => map[m]);
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name[0].toUpperCase();
}

function avatarColor(name) {
  const colors = ['#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#f97316','#f59e0b','#10b981','#06b6d4','#0ea5e9'];
  if (!name) return colors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function cvClass(val) {
  if (val === null || val === '—') return '';
  const num = parseFloat(val);
  if (num >= 1.5) return 'text-success';
  if (num < 1) return 'text-danger';
  return 'text-warning';
}

function statusColor(status) {
  const map = {
    'НОВАЯ ЗАДАЧА': '#6b7280',
    'НАЗНАЧЕНА КОМАНДА': '#6b7280',
    'СБОР ТРЕБОВАНИЙ': '#6b7280',
    'ПРОВЕРКА ТРЕБОВАНИЙ': '#6b7280',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': '#6b7280',
    'ЭКСПРЕСС-ОЦЕНКА': '#6b7280',
    'ПРИНЯТИЕ РЕШЕНИЯ': '#f59e0b',
    'ПРИНЯТА В РАБОТУ': '#3b82f6',
    'ЭСКАЛАЦИЯ НА ЛТ': '#8b5cf6',
    'ХОЛД': '#8b5cf6',
    'ОТКЛОНЕНА': '#ef4444',
    'НЕ АКТУАЛЬНА': '#94a3b8',
    'ВЫПОЛНЕНА': '#10b981'
  };
  return map[status] || '#6b7280';
}

function statusBg(status) {
  const map = {
    'НОВАЯ ЗАДАЧА': '#f1f5f9',
    'НАЗНАЧЕНА КОМАНДА': '#f1f5f9',
    'СБОР ТРЕБОВАНИЙ': '#f1f5f9',
    'ПРОВЕРКА ТРЕБОВАНИЙ': '#f1f5f9',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': '#f1f5f9',
    'ЭКСПРЕСС-ОЦЕНКА': '#f1f5f9',
    'ПРИНЯТИЕ РЕШЕНИЯ': '#fef3c7',
    'ПРИНЯТА В РАБОТУ': '#dbeafe',
    'ЭСКАЛАЦИЯ НА ЛТ': '#ede9fe',
    'ХОЛД': '#ede9fe',
    'ОТКЛОНЕНА': '#fee2e2',
    'НЕ АКТУАЛЬНА': '#f1f5f9',
    'ВЫПОЛНЕНА': '#d1fae5'
  };
  return map[status] || '#f1f5f9';
}

function priorityColor(priority) {
  const map = { 'ВЫСОКИЙ': '#ef4444', 'СРЕДНИЙ': '#f59e0b', 'НИЗКИЙ': '#6b7280' };
  return map[priority] || '#6b7280';
}

function priorityBg(priority) {
  const map = { 'ВЫСОКИЙ': '#fee2e2', 'СРЕДНИЙ': '#fef3c7', 'НИЗКИЙ': '#f1f5f9' };
  return map[priority] || '#f1f5f9';
}

// === STATUS / PRIORITY BADGES ===
function renderStatusBadge(status) {
  if (!status) return '<span class="badge badge-low">—</span>';
  const color = statusColor(status);
  const bg = statusBg(status);
  const dotColor = status === 'ПРИНЯТА В РАБОТУ' ? '#3b82f6' : color;
  return `<span class="task-detail-badge" style="background:${bg};color:${color};border-color:${color}33">
    <span class="status-dot" style="background:${dotColor};${status === 'ПРИНЯТА В РАБОТУ' ? 'animation:pulse 2s infinite;' : ''}"></span>
    ${escapeHtml(status)}
  </span>`;
}

function renderPriorityBadge(priority) {
  if (!priority) return '<span class="badge badge-low">—</span>';
  const color = priorityColor(priority);
  const bg = priorityBg(priority);
  return `<span class="task-detail-badge" style="background:${bg};color:${color};border-color:${color}33">
    ${priority === 'ВЫСОКИЙ' ? '🚩 ' : ''}${escapeHtml(priority)}
  </span>`;
}

function renderTagBadge(tag) {
  return `<span class="task-detail-tag">${escapeHtml(tag)}</span>`;
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
  const initials = getInitials(name);
  const color = avatarColor(name);
  return `<div class="task-detail-avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${size*0.4}px">${initials}</div>`;
}

// ============================================================
//  KPI STRIP
// ============================================================
function renderKpiStrip(task) {
  const cv = task.financial_effect && task.effort_rub && task.effort_rub > 0
    ? (task.financial_effect / task.effort_rub).toFixed(2) : '—';
  const progress = task.progress || 0;
  const circumference = 2 * Math.PI * 15.5;
  const offset = circumference - (progress / 100) * circumference;
  const ownerName = task.owner_name || task.owner || '—';

  return `
    <div class="task-detail-kpi-strip">
      <!-- Прогресс (кольцо) -->
      <div class="task-detail-kpi-item">
        <div class="kpi-ring-wrap">
          <svg viewBox="0 0 36 36" class="kpi-ring">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e7e5e4" stroke-width="3"/>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#6366f1" stroke-width="3"
              stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
          </svg>
          <div class="kpi-ring-text">${progress}%</div>
        </div>
        <div class="kpi-label">Прогресс</div>
      </div>

      <!-- ICE Score -->
      <div class="task-detail-kpi-item kpi-border-left">
        <div class="kpi-value">${task.ice_score != null ? task.ice_score.toFixed(1) : '—'}</div>
        <div class="kpi-label">ICE Score</div>
      </div>

      <!-- C/V -->
      <div class="task-detail-kpi-item kpi-border-left">
        <div class="kpi-value ${cvClass(cv)}">${cv}</div>
        <div class="kpi-label">C / V</div>
      </div>

      <!-- Фин. эффект -->
      <div class="task-detail-kpi-item kpi-border-left">
        <div class="kpi-value">${task.financial_effect != null ? metricFormat(task.financial_effect) : '—'}</div>
        <div class="kpi-label">Фин. эффект, ₽</div>
      </div>

      <!-- Трудозатраты -->
      <div class="task-detail-kpi-item kpi-border-left">
        <div class="kpi-value">${task.effort_days != null ? task.effort_days : '—'}</div>
        <div class="kpi-label">Трудозатраты, ч/д</div>
      </div>

      <!-- Ответственный -->
      <div class="task-detail-kpi-item kpi-border-left">
        <div style="display:flex;align-items:center;gap:8px">
          ${avatarEl(ownerName, 28)}
          <div>
            <div class="kpi-owner-name">${escapeHtml(ownerName)}</div>
            <div class="kpi-label">Владелец</div>
          </div>
        </div>
      </div>
    </div>`;
}

// ============================================================
//  TAB: ОБЗОР
// ============================================================
function renderOverviewTab(task) {
  const statusName = task.status_name || task.status;
  const priorityName = task.priority_name || task.priority;
  const tags = task.tags ? (Array.isArray(task.tags) ? task.tags : String(task.tags).split(',').map(t => t.trim()).filter(Boolean)) : [];
  const involvedTeams = task.involved_teams
    ? (Array.isArray(task.involved_teams) ? task.involved_teams : String(task.involved_teams).split(',').map(t => t.trim()).filter(Boolean))
    : [];

  let html = `<div class="task-detail-section-card">`;

  // Блок 1: Общая информация
  html += sectionTitle('Блок 1 · Общая информация');
  html += infoRow('Название', `<strong>${escapeHtml(task.title || '')}</strong>`);
  html += infoRow('Тип задачи', escapeHtml(task.task_type_name || task.task_type || '—'));
  html += infoRow('Статус', renderStatusBadge(statusName));
  html += infoRow('Приоритет', renderPriorityBadge(priorityName));
  html += infoRow('Ключевой проект', task.key_project ? '<span class="task-detail-badge" style="background:#fef3c7;color:#d97706;border-color:#f59e0b33">⭐ Да</span>' : '<span class="text-muted">—</span>');
  html += infoRow('От руководства', task.is_from_leadership ? '<span class="task-detail-badge" style="background:#fef3c7;color:#d97706;border-color:#f59e0b33">Да</span>' : '<span class="text-muted">Нет</span>');
  html += infoRow('Регулярная задача', task.is_regular ? '<span class="task-detail-badge" style="background:#dbeafe;color:#2563eb;border-color:#3b82f633">Да</span>' : '<span class="text-muted">Нет</span>');

  if (tags.length) {
    html += infoRow('Теги', tags.map(t => renderTagBadge(t)).join(' '));
  }

  // Блок 2: Бизнес-контекст
  html += sectionTitle('Блок 2 · Бизнес-контекст');
  html += infoRow('Описание', escapeHtml(task.description || '—'), { fullWidth: true });
  html += infoRow('Бизнес-заказчик', escapeHtml(task.business_customer_name || task.business_customer || '—'));
  html += infoRow('Подразделение', escapeHtml(task.department_name || '—'));
  html += infoRow('Канал поступления', escapeHtml(task.channel_name || task.source_channel || '—'));
  html += infoRow('Проект', escapeHtml(task.project_name || task.project || '—'));
  html += infoRow('Дата поступления', task.date_received || '—');
  html += infoRow('Срок (дедлайн)', escapeHtml(task.deadline_name || task.deadline || '—'));
  html += infoRow('PO-дедлайн', escapeHtml(task.deadline_po_name || task.deadline_po || '—'));

  if (involvedTeams.length) {
    html += infoRow('Вовлечённые команды', involvedTeams.map(t => `<span class="task-detail-chip">${escapeHtml(t)}</span>`).join(' '));
  }

  // Статусы для разных аудиторий
  html += sectionTitle('Блок 3 · Статусы для разных аудиторий');
  html += infoRow('Статус для директорской', escapeHtml(task.directorate_status || '—'));
  html += infoRow('Статус для ДИД', escapeHtml(task.did_status || '—'));
  html += infoRow('Статус для ключевых проектов', escapeHtml(task.key_project_status || '—'));

  // Комментарии
  if (task.comment || task.status_comment || task.rejection_reason) {
    html += sectionTitle('Блок 4 · Комментарии');
    if (task.comment) html += infoRow('Комментарий', escapeHtml(task.comment), { fullWidth: true });
    if (task.status_comment) html += infoRow('Статус-комментарий', escapeHtml(task.status_comment), { fullWidth: true });
    if (task.rejection_reason) html += infoRow('Причина отклонения', escapeHtml(task.rejection_reason), { fullWidth: true, danger: true });
  }

  html += `</div>`;
  return html;
}

// ============================================================
//  TAB: КОМАНДА
// ============================================================
function renderTeamTab(task) {
  const ownerName = task.owner_name || task.owner;
  const poName = task.responsible_po_name;
  const baName = task.business_analyst_name;
  const itplName = task.it_product_lead_name;
  const customerName = task.business_customer_name || task.business_customer;

  let html = `<div class="task-detail-section-card">`;

  // Блок: Ответственные
  html += sectionTitle('Блок 1 · Ответственные');
  html += infoRow('Команда', `<span class="task-detail-chip task-detail-chip-indigo">${escapeHtml(task.team_name || task.team || '—')}</span>`);

  // Cards for roles
  html += `<div class="task-detail-roles-grid">`;

  const roles = [
    { name: ownerName, label: 'Владелец / PL', icon: '👤' },
    { name: poName, label: 'Ответственный PO', icon: '📋' },
    { name: baName, label: 'Бизнес-аналитик', icon: '📊' },
    { name: itplName, label: 'IT Product Lead', icon: '🖥️' },
    { name: customerName, label: 'Бизнес-заказчик', icon: '🤝' }
  ];

  roles.forEach(r => {
    if (!r.name) return;
    html += `<div class="task-detail-role-card">
      <div style="display:flex;align-items:center;gap:12px">
        ${avatarEl(r.name, 36)}
        <div>
          <div class="task-detail-role-label">${r.label}</div>
          <div class="task-detail-role-name">${escapeHtml(r.name)}</div>
        </div>
      </div>
    </div>`;
  });

  html += `</div>`;

  // Вовлечённые команды
  const involvedTeams = task.involved_teams
    ? (Array.isArray(task.involved_teams) ? task.involved_teams : String(task.involved_teams).split(',').map(t => t.trim()).filter(Boolean))
    : [];
  if (involvedTeams.length) {
    html += sectionTitle('Блок 2 · Вовлечённые команды');
    html += infoRow('Команды', involvedTeams.map(t => `<span class="task-detail-chip">${escapeHtml(t)}</span>`).join(' '));
  }

  html += `</div>`;
  return html;
}

// ============================================================
//  TAB: МЕТРИКИ
// ============================================================
function renderMetricsTab(task) {
  const cv = task.financial_effect && task.effort_rub && task.effort_rub > 0
    ? (task.financial_effect / task.effort_rub).toFixed(2) : '—';
  const cvNum = parseFloat(cv);
  const progress = task.progress || 0;

  let html = '';

  // ICE Score Hero
  if (task.ice_score != null) {
    html += `<div class="task-detail-metric-hero">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:16px">
        <div>
          <div class="metric-hero-label">ICE SCORE</div>
          <div class="metric-hero-value">${task.ice_score.toFixed(1)}</div>
        </div>
        <div style="text-align:right">
          <div class="metric-hero-label">C / V RATIO</div>
          <div style="font-size:28px;font-weight:700">${cv}</div>
        </div>
      </div>
      <div class="task-detail-ice-bars">
        <div class="ice-bar-item">
          <div class="ice-bar-label">Impact</div>
          <div class="progress-track"><div class="progress-fill ice-fill-impact" style="width:${Math.min(100, (task.ice_score || 0) * 10)}%"></div></div>
        </div>
        <div class="ice-bar-item">
          <div class="ice-bar-label">Confidence</div>
          <div class="progress-track"><div class="progress-fill ice-fill-confidence" style="width:${Math.min(100, (task.ice_score || 0) * 9)}%"></div></div>
        </div>
        <div class="ice-bar-item">
          <div class="ice-bar-label">Ease</div>
          <div class="progress-track"><div class="progress-fill ice-fill-ease" style="width:${Math.min(100, (task.ice_score || 0) * 8)}%"></div></div>
        </div>
      </div>
    </div>`;
  }

  // KPI Cards
  html += `<div class="task-detail-kpi-grid">`;

  // Фин. эффект
  html += `<div class="kpi-card-item">
    <div class="kpi-card-label">💰 Фин. эффект</div>
    <div class="kpi-card-value">${task.financial_effect != null ? metricFormat(task.financial_effect) + ' ₽' : '—'}</div>
    ${task.financial_effect && task.effort_rub && task.effort_rub > 0
      ? `<div class="kpi-card-trend">C/V: ${cv}x</div>` : ''}
  </div>`;

  // Трудозатраты
  html += `<div class="kpi-card-item">
    <div class="kpi-card-label">⏱ Трудозатраты</div>
    <div class="kpi-card-value">${task.effort_days != null ? task.effort_days + ' <span style="font-size:14px;color:#94a3b8;font-weight:400">ч/д</span>' : '—'}</div>
    <div class="kpi-card-sub">${task.effort_rub != null ? metricFormat(task.effort_rub) + ' ₽' : '—'}</div>
  </div>`;

  // Прогресс
  html += `<div class="kpi-card-item">
    <div class="kpi-card-label">📈 Прогресс</div>
    <div class="kpi-card-value">${progress}%</div>
    <div class="progress-track" style="margin-top:8px"><div class="progress-fill" style="width:${progress}%"></div></div>
  </div>`;

  // ICE Score в карточке
  if (task.ice_score != null) {
    html += `<div class="kpi-card-item">
      <div class="kpi-card-label">🎯 ICE Score</div>
      <div class="kpi-card-value">${task.ice_score.toFixed(1)}</div>
    </div>`;
  }

  html += `</div>`;

  // DoD
  if (task.dod) {
    html += `<div class="task-detail-dod-box">
      <div class="dod-title">✅ Definition of Done</div>
      <ul class="dod-list">
        ${task.dod.split('\n').filter(l => l.trim()).map(line => `<li>${escapeHtml(line.trim())}</li>`).join('')}
      </ul>
    </div>`;
  }

  // What-If
  if (task.what_if) {
    html += `<div class="task-detail-callout">
      <div class="callout-title">⚠️ What-If анализ</div>
      <p>${escapeHtml(task.what_if)}</p>
    </div>`;
  }

  return html;
}

// ============================================================
//  TAB: ДОКУМЕНТЫ
// ============================================================
function renderDocsTab(task) {
  let html = `<div class="task-detail-section-card">`;

  const hasMockups = !!task.link_mockups;
  const hasJira = !!task.link_jira;
  const hasDod = !!task.dod;
  const hasWhatIf = !!task.what_if;

  if (!hasMockups && !hasJira && !hasDod && !hasWhatIf) {
    html += `<div class="text-muted" style="text-align:center;padding:40px">Нет прикреплённых документов</div>`;
  } else {
    html += sectionTitle('Прикреплённые документы и ссылки');

    if (hasMockups) {
      html += `<a href="${escapeHtml(task.link_mockups)}" target="_blank" class="task-detail-doc-link">
        <div class="doc-link-icon" style="background:#6366f1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="doc-link-info">
          <div class="doc-link-title">Макеты / БТ</div>
          <div class="doc-link-url">${escapeHtml(task.link_mockups)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>`;
    }

    if (hasJira) {
      html += `<a href="${escapeHtml(task.link_jira)}" target="_blank" class="task-detail-doc-link">
        <div class="doc-link-icon" style="background:#10b981"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div>
        <div class="doc-link-info">
          <div class="doc-link-title">Jira Task</div>
          <div class="doc-link-url">${escapeHtml(task.link_jira)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>`;
    }

    if (hasDod) {
      html += `<div class="task-detail-doc-note">
        <div class="doc-note-title">📋 Definition of Done</div>
        <div class="doc-note-content">${escapeHtml(task.dod)}</div>
      </div>`;
    }

    if (hasWhatIf) {
      html += `<div class="task-detail-doc-note">
        <div class="doc-note-title">📊 What-If анализ</div>
        <div class="doc-note-content">${escapeHtml(task.what_if)}</div>
      </div>`;
    }
  }

  html += `</div>`;
  return html;
}

// ============================================================
//  TAB: ОТЧЁТНОСТЬ
// ============================================================
function renderReportsTab(task) {
  const statusName = task.status_name || task.status;
  const deadlineName = task.deadline_name || task.deadline || '—';
  const progress = task.progress || 0;

  let html = `<div class="task-detail-section-card">`;

  // Статус для директоров
  html += sectionTitle('Блок 1 · Статус для отчётов');
  html += `<div class="task-detail-report-row">
    <div class="report-row-header">
      <div class="report-row-icon" style="background:#7c3aed">📊</div>
      <div>
        <div class="report-row-title">Статус для директорской</div>
        <div class="report-row-status">${task.directorate_status || 'Не задан'}</div>
      </div>
    </div>
    ${task.directorate_status
      ? `<span class="task-detail-report-badge ${task.directorate_status === 'Выполнен' ? 'badge-green' : task.directorate_status === 'Риск' ? 'badge-red' : 'badge-amber'}">${escapeHtml(task.directorate_status)}</span>`
      : ''}
  </div>`;

  html += `<div class="task-detail-report-row">
    <div class="report-row-header">
      <div class="report-row-icon" style="background:#2563eb">📈</div>
      <div>
        <div class="report-row-title">Статус для ДИД</div>
        <div class="report-row-status">${task.did_status || 'Не задан'}</div>
      </div>
    </div>
    ${task.did_status
      ? `<span class="task-detail-report-badge ${task.did_status === 'Закрыта' ? 'badge-green' : task.did_status === 'Блокировано' ? 'badge-red' : 'badge-amber'}">${escapeHtml(task.did_status)}</span>`
      : ''}
  </div>`;

  html += sectionTitle('Блок 2 · Служебные поля');
  html += `<div class="task-detail-meta-grid">
    <div class="meta-item">
      <div class="meta-label">Состояние</div>
      <div class="meta-value" style="color:${progress >= 100 ? '#10b981' : progress > 0 ? '#f59e0b' : '#6b7280'}">${progress >= 100 ? '✅ Завершена' : progress > 0 ? '🔄 В работе' : '📋 Не начата'}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Дедлайн</div>
      <div class="meta-value">${escapeHtml(deadlineName)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Основной статус</div>
      <div class="meta-value">${renderStatusBadge(statusName)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Ключевой проект</div>
      <div class="meta-value">${task.key_project ? '⭐ Да' : '—'}</div>
    </div>
  </div>`;

  html += `</div>`;
  return html;
}

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
            ${item.changed_by_name ? avatarEl(item.changed_by_name, 20) : '<div class="task-detail-avatar" style="width:20px;height:20px;background:#94a3b8;font-size:8px">?</div>'}
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
//  RENDER FULL MODAL
// ============================================================
export function renderTaskDetailModal(task, app) {
  currentTask = task;
  modalMode = task ? 'view' : 'edit';

  const t = task || {};
  const statusName = t.status_name || t.status;
  const priorityName = t.priority_name || t.priority;
  const taskTypeName = t.task_type_name || t.task_type;
  const hasTaskId = !!t.id;

  return `
    <div class="modal-overlay" id="task-detail-overlay">
      <div class="task-detail-modal" id="task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        
        <!-- Modal Header -->
        <div class="task-detail-modal-header">
          <div class="task-detail-header-left">
            <div class="task-detail-badges-row">
              <span class="task-detail-id">${hasTaskId ? '#' + t.id : 'Новая задача'}</span>
              ${statusName ? renderStatusBadge(statusName) : ''}
              ${priorityName ? renderPriorityBadge(priorityName) : ''}
              ${taskTypeName ? `<span class="task-detail-badge" style="background:#f5f3ff;color:#5b21b6;border-color:#c7d2fe">${escapeHtml(taskTypeName)}</span>` : ''}
              ${t.key_project ? '<span class="task-detail-badge" style="background:#fef3c7;color:#d97706;border-color:#f59e0b33">⭐ Ключевой</span>' : ''}
            </div>
            <h2 class="task-detail-title" id="task-detail-title">${escapeHtml(t.title || 'Новая задача')}</h2>
          </div>
          <div class="task-detail-header-actions">
            <button class="task-detail-btn-icon" id="td-share-btn" title="Поделиться">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </button>
            <button class="task-detail-btn-icon" id="td-edit-btn" title="Редактировать">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <div class="task-detail-header-divider"></div>
            <button class="task-detail-btn-icon task-detail-btn-close" id="td-close-btn" title="Закрыть">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <!-- KPI Strip -->
        ${renderKpiStrip(t)}

        <!-- Tab Navigation -->
        <div class="task-detail-tabs">
          <button class="td-tab-btn active" data-tab="overview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Обзор
          </button>
          <button class="td-tab-btn" data-tab="team">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Команда
          </button>
          <button class="td-tab-btn" data-tab="metrics">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Метрики
          </button>
          <button class="td-tab-btn" data-tab="docs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Документы
          </button>
          <button class="td-tab-btn" data-tab="reports">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="M7 21h10"/><path d="M12 16v5"/></svg>
            Отчётность
          </button>
          <button class="td-tab-btn" data-tab="history">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            История
          </button>
        </div>

        <!-- Modal Body (Tab Content) -->
        <div class="task-detail-modal-body" id="td-modal-body">
          <div class="td-tab-panel active" id="tab-overview">
            ${renderOverviewTab(t)}
          </div>
          <div class="td-tab-panel" id="tab-team">
            ${renderTeamTab(t)}
          </div>
          <div class="td-tab-panel" id="tab-metrics">
            ${renderMetricsTab(t)}
          </div>
          <div class="td-tab-panel" id="tab-docs">
            ${renderDocsTab(t)}
          </div>
          <div class="td-tab-panel" id="tab-reports">
            ${renderReportsTab(t)}
          </div>
          <div class="td-tab-panel" id="tab-history">
            <div class="text-muted" style="text-align:center;padding:40px">Загрузка истории...</div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="task-detail-modal-footer">
          <div class="task-detail-footer-info">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Обновлено: ${t.updated_at ? new Date(t.updated_at).toLocaleString('ru-RU') : '—'}</span>
          </div>
          <div class="task-detail-footer-actions">
            <button class="task-detail-btn task-detail-btn-ghost" id="td-comment-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Комментарий
            </button>
            <button class="task-detail-btn task-detail-btn-primary" id="td-save-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              ${!hasTaskId ? 'Создать' : 'Редактировать'}
            </button>
          </div>
        </div>

      </div>
    </div>`;
}

// ============================================================
//  TAB SWITCHING
// ============================================================
function initTabs() {
  document.querySelectorAll('.td-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.td-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.td-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tabId = 'tab-' + btn.dataset.tab;
      document.getElementById(tabId)?.classList.add('active');
    });
  });
}

// ============================================================
//  MODAL INIT
// ============================================================
export function initTaskDetailModal(app) {
  const overlay = document.getElementById('task-detail-overlay');
  if (!overlay) return;

  // Tab switching
  initTabs();

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTaskDetailModal();
  });

  // Close button
  document.getElementById('td-close-btn')?.addEventListener('click', closeTaskDetailModal);

  // Edit/Save button
  document.getElementById('td-save-btn')?.addEventListener('click', () => {
    if (modalMode === 'view') {
      toggleToEditMode(app);
    } else {
      saveTaskDetail(app);
    }
  });

  // Edit icon button
  document.getElementById('td-edit-btn')?.addEventListener('click', () => {
    if (modalMode === 'view') toggleToEditMode(app);
  });

  // Share button (copy link)
  document.getElementById('td-share-btn')?.addEventListener('click', () => {
    if (currentTask?.id) {
      navigator.clipboard?.writeText(window.location.origin + '/#/backlog?task=' + currentTask.id)
        .then(() => window.toast?.('Ссылка скопирована', 'info'))
        .catch(() => {});
    }
  });

  // Load history asynchronously
  if (currentTask?.id) {
    loadHistoryTab(currentTask.id, app);
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
    const panel = document.getElementById('tab-history');
    if (panel) panel.innerHTML = html;
  } catch (e) {
    const panel = document.getElementById('tab-history');
    if (panel) panel.innerHTML = `<div class="text-danger" style="padding:20px">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

// ============================================================
//  EDIT MODE
// ============================================================
function toggleToEditMode(app) {
  modalMode = 'edit';
  const body = document.getElementById('td-modal-body');
  if (!body) return;

  const t = currentTask || {};
  body.innerHTML = renderEditForm(t);

  const saveBtn = document.getElementById('td-save-btn');
  if (saveBtn) saveBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
    Сохранить`;

  const editBtn = document.getElementById('td-edit-btn');
  if (editBtn) editBtn.style.display = 'none';

  body.scrollTop = 0;

  // Init progress slider
  const range = document.getElementById('edit-progress');
  const label = document.getElementById('progress-label');
  if (range && label) {
    range.addEventListener('input', () => { label.textContent = range.value + '%'; });
  }

  // Rejection reason toggle
  const statusSelect = document.getElementById('edit-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', function () {
      const wrapper = document.getElementById('edit-rejection-wrapper');
      if (wrapper) wrapper.style.display = parseInt(this.value) === 5 ? '' : 'none';
    });
  }

  populateSelects(app);
}

// ============================================================
//  EDIT FORM
// ============================================================
function renderEditForm(task) {
  const t = task || {};
  const tags = t.tags ? (Array.isArray(t.tags) ? t.tags.join(', ') : String(t.tags)) : '';
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

  function select(id, opts, selected) {
    return `<select class="task-detail-input" id="${id}">
      ${opts.map(o => `<option value="${escapeHtml(String(o.value))}" ${(o.value === selected || o.label === selected) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }

  function input(id, type, val, placeholder) {
    return `<input type="${type}" class="task-detail-input" id="${id}" value="${escapeHtml(String(val ?? ''))}" placeholder="${escapeHtml(placeholder || '')}">`;
  }

  function textarea(id, val, placeholder, rows = 3) {
    return `<textarea class="task-detail-input" id="${id}" rows="${rows}" placeholder="${escapeHtml(placeholder || '')}">${escapeHtml(val || '')}</textarea>`;
  }

  function apiSelect(id, currentId, currentName) {
    const val = currentId || currentName || '';
    const display = currentName || currentId || '';
    return `<select class="task-detail-input" id="${id}"><option value="${escapeHtml(String(val))}" ${val ? 'selected' : ''}>${escapeHtml(display || 'Загрузка...')}</option></select>`;
  }

  function field(label, inputHtml, opts = {}) {
    const cls = opts.fullWidth ? ' td-edit-field-full' : '';
    return `<div class="td-edit-field${cls}">
      <label class="td-edit-label">${escapeHtml(label)}</label>
      ${inputHtml}
    </div>`;
  }

  let html = `<div class="td-edit-form">`;

  // Основное
  html += field('Название', input('edit-title', 'text', t.title, 'Название задачи'), { fullWidth: true });
  html += `<div class="td-edit-row-2">`;
  html += field('Статус', select('edit-status', statuses, t.status_id || t.status_name || t.status));
  html += field('Приоритет', select('edit-priority', priorities, t.priority_id || t.priority_name || t.priority));
  html += `</div>`;

  html += `<div class="td-edit-row-2">`;
  html += field('Тип задачи', select('edit-task-type', taskTypes, t.task_type_id || t.task_type_name || t.task_type));
  html += field('Канал поступления', select('edit-channel', channels, t.channel_id || t.channel_name || t.source_channel));
  html += `</div>`;

  // Команда и проект (API)
  html += `<div class="td-edit-row-2">`;
  html += field('Команда', apiSelect('edit-team', t.team_id, t.team_name || t.team));
  html += field('Проект', apiSelect('edit-project', t.project_id, t.project_name || t.project));
  html += `</div>`;

  // Ответственные (API)
  html += `<div class="td-edit-row-2">`;
  html += field('Владелец', apiSelect('edit-owner', t.owner_id, t.owner_name || t.owner));
  html += field('Ответственный PO', apiSelect('edit-responsible-po', t.responsible_po_id, t.responsible_po_name));
  html += `</div>`;

  html += `<div class="td-edit-row-2">`;
  html += field('Бизнес-аналитик', apiSelect('edit-business-analyst', t.business_analyst_id, t.business_analyst_name));
  html += field('IT Product Lead', apiSelect('edit-it-product-lead', t.it_product_lead_id, t.it_product_lead_name));
  html += `</div>`;

  // Бизнес-контекст
  html += `<div class="td-edit-row-2">`;
  html += field('Бизнес-заказчик', apiSelect('edit-business-customer', t.business_customer_id, t.business_customer_name || t.business_customer));
  html += field('Подразделение', apiSelect('edit-department', t.department_id, t.department_name || t.customer_department));
  html += `</div>`;

  // Сроки
  html += `<div class="td-edit-row-2">`;
  html += field('Дедлайн', select('edit-deadline', deadlines, t.deadline_id || t.deadline_name || t.deadline));
  html += field('PO-дедлайн', select('edit-deadline-po', deadlines, t.deadline_po_id || t.deadline_po_name || t.deadline_po));
  html += `</div>`;

  html += `<div class="td-edit-row-3">`;
  html += field('Дата поступления', input('edit-date-received', 'date', t.date_received || ''));
  html += field('Прогресс', `
    <input type="range" min="0" max="100" value="${t.progress || 0}" class="task-detail-range" id="edit-progress">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:2px">
      <span>0%</span>
      <span style="font-weight:600;color:var(--text-primary)" id="progress-label">${t.progress || 0}%</span>
      <span>100%</span>
    </div>
  `);
  html += field('ICE Score', input('edit-ice-score', 'number', t.ice_score ?? '', '0.0–10.0'));
  html += `</div>`;

  // Финансы
  html += `<div class="td-edit-row-3">`;
  html += field('Трудозатраты (дни)', input('edit-effort-days', 'number', t.effort_days ?? '', 'ч/д'));
  html += field('Трудозатраты (₽)', input('edit-effort-rub', 'number', t.effort_rub ?? '', '₽'));
  html += field('Фин. эффект (₽)', input('edit-financial-effect', 'number', t.financial_effect ?? '', '₽'));
  html += `</div>`;

  // Статусы для аудиторий
  html += `<div class="td-edit-row-3">`;
  html += field('Статус для директорской', select('edit-directorate-status', dirStatuses, t.directorate_status));
  html += field('Статус для ДИД', select('edit-did-status', didStatuses, t.did_status));
  html += field('Статус для ключ. проекта', select('edit-key-project-status', dirStatuses, t.key_project_status));
  html += `</div>`;

  // Чекбоксы
  html += `<div class="td-edit-row-3 td-edit-checkboxes">`;
  html += `<label class="td-edit-checkbox"><input type="checkbox" id="edit-key-project" ${t.key_project ? 'checked' : ''}> Ключевой проект</label>`;
  html += `<label class="td-edit-checkbox"><input type="checkbox" id="edit-is-from-leadership" ${t.is_from_leadership ? 'checked' : ''}> От руководства</label>`;
  html += `<label class="td-edit-checkbox"><input type="checkbox" id="edit-is-regular" ${t.is_regular ? 'checked' : ''}> Регулярная</label>`;
  html += `</div>`;

  // Текстовые поля
  html += field('Описание', textarea('edit-description', t.description, 'Описание задачи', 4), { fullWidth: true });
  html += field('DoD (Definition of Done)', textarea('edit-dod', t.dod, 'Критерии готовности', 3), { fullWidth: true });
  html += field('What-If анализ', textarea('edit-what-if', t.what_if, 'What-If анализ', 2), { fullWidth: true });

  // Комментарии
  html += field('Комментарий', textarea('edit-comment', t.comment, 'Общий комментарий', 2), { fullWidth: true });
  html += field('Статус-комментарий', textarea('edit-status-comment', t.status_comment, 'Комментарий по статусу', 2), { fullWidth: true });

  // Причина отклонения (conditional)
  const isRejected = (t.status_name || t.status) === 'ОТКЛОНЕНА' || t.status_id === 5;
  html += `<div id="edit-rejection-wrapper" style="${isRejected ? '' : 'display:none'}">`;
  html += field('Причина отклонения', textarea('edit-rejection-reason', t.rejection_reason, 'Причина отклонения', 2), { fullWidth: true });
  html += `</div>`;

  // Ссылки
  html += `<div class="td-edit-row-2">`;
  html += field('Ссылка на макеты', input('edit-link-mockups', 'text', t.link_mockups, 'https://...'));
  html += field('Ссылка на Jira', input('edit-link-jira', 'text', t.link_jira, 'https://...'));
  html += `</div>`;

  // Теги
  html += field('Теги (через запятую)', input('edit-tags', 'text', tags, 'regulatory, backend, security'), { fullWidth: true });

  html += `</div>`;
  return html;
}

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

  populateSelect('/teams', 'edit-team', t.team_id, t.team_name || t.team);
  populateSelect('/projects', 'edit-project', t.project_id, t.project_name || t.project);
  populateSelect('/departments', 'edit-department', t.department_id, t.department_name || t.customer_department);
  populateSelect('/admin/business-customers', 'edit-business-customer', t.business_customer_id, t.business_customer_name || t.business_customer);
  populateSelect('/users', 'edit-owner', t.owner_id, t.owner_name || t.owner);
  populateSelect('/users', 'edit-responsible-po', t.responsible_po_id, t.responsible_po_name);
  populateSelect('/users', 'edit-business-analyst', t.business_analyst_id, t.business_analyst_name);
  populateSelect('/users', 'edit-it-product-lead', t.it_product_lead_id, t.it_product_lead_name);
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
    responsible_po_id: getInt('edit-responsible-po'),
    business_analyst_id: getInt('edit-business-analyst'),
    it_product_lead_id: getInt('edit-it-product-lead'),
    business_customer_id: getInt('edit-business-customer'),
    deadline_id: getInt('edit-deadline'),
    deadline_po_id: getInt('edit-deadline-po'),
    effort_days: getInt('edit-effort-days'),
    effort_rub: getFloat('edit-effort-rub'),
    financial_effect: getFloat('edit-financial-effect'),
    ice_score: getFloat('edit-ice-score'),
    progress: parseInt(document.getElementById('edit-progress')?.value) || 0,
    description: document.getElementById('edit-description')?.value || '',
    dod: document.getElementById('edit-dod')?.value || null,
    what_if: document.getElementById('edit-what-if')?.value || null,
    comment: document.getElementById('edit-comment')?.value || null,
    status_comment: document.getElementById('edit-status-comment')?.value || '',
    rejection_reason: document.getElementById('edit-rejection-reason')?.value || null,
    link_mockups: document.getElementById('edit-link-mockups')?.value || null,
    link_jira: document.getElementById('edit-link-jira')?.value || null,
    tags: document.getElementById('edit-tags')?.value || '',
    date_received: document.getElementById('edit-date-received')?.value || null,
    key_project: document.getElementById('edit-key-project')?.checked || false,
    key_project_status: document.getElementById('edit-key-project-status')?.value || null,
    directorate_status: document.getElementById('edit-directorate-status')?.value || null,
    did_status: document.getElementById('edit-did-status')?.value || null,
    is_from_leadership: document.getElementById('edit-is-from-leadership')?.checked || false,
    is_regular: document.getElementById('edit-is-regular')?.checked || false,
  };

  // Remove null/undefined
  Object.keys(data).forEach(key => {
    if (data[key] === null || data[key] === undefined) delete data[key];
  });

  try {
    if (currentTask?.id) {
      await api.put(`/tasks/${currentTask.id}`, data);
    } else {
      await api.post('/tasks', data);
    }
    closeTaskDetailModal();
    if (onSaveCallback) onSaveCallback();
    window.toast?.(currentTask?.id ? 'Задача сохранена' : 'Задача создана', 'success');
  } catch (e) {
    window.toast?.('Ошибка: ' + (e.message || 'не удалось сохранить'), 'error');
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
export function closeTaskDetailModal() {
  const overlay = document.getElementById('task-detail-overlay');
  if (overlay) {
    overlay.classList.add('modal-closing');
    setTimeout(() => {
      overlay.remove();
      currentTask = null;
      currentModal = null;
      modalMode = 'view';
    }, 200);
  }
}

// ============================================================
//  OPEN TASK MODAL (главная точка входа)
// ============================================================
export function openTaskModal(task = null) {
  currentTask = task;
  modalMode = task ? 'view' : 'edit';

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

export function renderTaskCard(task) {
  // Мини-карточка для канбан/карточек
  const prio = task.priority_name || task.priority || 'СРЕДНИЙ';
  const prioClass = prio === 'ВЫСОКИЙ' ? 'badge-high' : prio === 'СРЕДНИЙ' ? 'badge-medium' : 'badge-low';
  const p = task.progress || 0;
  const statusName = task.status_name || task.status;
  const teamName = task.team_name || '—';
  const deadlineName = task.deadline_name || task.deadline || '—';
  const ownerName = task.owner_name || task.owner || '—';
  const safeId = escapeHtml(String(task.id));
  const safePrio = escapeHtml(prio);
  return `
    <div class="task-card" data-id="${safeId}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span class="font-mono text-muted" style="font-size:11px;flex-shrink:0;">#${safeId}</span>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <span class="badge ${prioClass}" style="font-size:10px;">${safePrio}</span>
        </div>
      </div>
      <div class="task-card-title">${escapeHtml(task.title)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${renderStatusBadge(statusName)}
        <span class="badge badge-info" style="font-size:10px;">${escapeHtml(teamName)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="progress-bar" style="flex:1;height:6px;"><div class="progress-fill ${p >= 100 ? 'success' : ''}" style="width:${p}%;height:6px;"></div></div>
        <span style="font-size:10px;color:var(--text-muted);min-width:28px;text-align:right;">${escapeHtml(String(p))}%</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);">
        <span>${escapeHtml(deadlineName)}</span>
        <span>${escapeHtml(ownerName)}</span>
      </div>
    </div>`;
}

export function setOnTaskSaved(callback) {
  onSaveCallback = callback;
}

// Legacy API
export function closeModal() { closeTaskDetailModal(); }
export function openConfirmModal(message, onConfirm) { /* not needed in new version */ }
