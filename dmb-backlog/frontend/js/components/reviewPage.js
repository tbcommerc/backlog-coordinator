console.log('[DMB] reviewPage.js loaded');

const REVIEW_STATUS_LABELS = {
  submitted: 'На ревью',
  in_review: 'На рассмотрении',
  in_progress: 'В проработке',
  returned: 'Возвращён',
  approved: 'Утверждён',
  rejected: 'Отклонён',
};

const REVIEW_STATUS_BADGES = {
  submitted: 'badge-info',
  in_review: 'badge-medium',
  in_progress: 'badge-warning',
  returned: 'badge-low',
  approved: 'badge-success',
  rejected: 'badge-danger',
};

export function renderReviewPage(app) {
  return `
    <div class="page-header animate-fade-in">
      <h1>Ревью запросов</h1>
      <p>Запросы на рассмотрение от бизнес-заказчиков</p>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Запросы на ревью</h2>
      </div>
      <div class="card-body">
        <div class="table-container" style="overflow-x:auto;">
          <table class="table" id="review-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
                <th>Автор</th>
                <th>Команда</th>
                <th>Статус</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody id="review-tbody">
              <tr><td colspan="6" class="text-center text-muted" style="padding:40px;">Загрузка...</td></tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-between items-center" style="margin-top:var(--space-4);">
          <span class="text-secondary" id="review-count">Найдено: 0 запросов</span>
        </div>
      </div>
    </div>
  `;
}

export async function initReviewPage(app) {
  await loadReviewList(app);
}

async function loadReviewList(app) {
  const tbody = document.getElementById('review-tbody');
  const countEl = document.getElementById('review-count');
  if (!tbody) return;

  try {
    const requests = await app.api.get('/agent/requests/review');
    const rows = Array.isArray(requests) ? requests : [];
    if (countEl) countEl.textContent = `Найдено: ${rows.length} запросов`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:40px;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
          <i data-lucide="inbox" style="width:32px;height:32px;color:var(--text-muted);"></i>
          <span>Запросов на ревью нет</span>
        </div>
      </td></tr>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr data-request-id="${r.id}" style="cursor:pointer;">
        <td><span class="font-mono text-muted">#${r.id}</span></td>
        <td><strong>${escapeHtml(r.title)}</strong></td>
        <td>${escapeHtml(r.author_name || '—')}</td>
        <td><span class="badge badge-info">${escapeHtml(r.team_name || '—')}</span></td>
        <td>${reviewStatusBadge(r.status)}</td>
        <td>${formatDate(r.created_at)}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        window.location.hash = `#/review/${tr.dataset.requestId}`;
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:40px;">Ошибка загрузки: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function reviewStatusBadge(status) {
  const label = REVIEW_STATUS_LABELS[status] || status || '—';
  const cls = REVIEW_STATUS_BADGES[status] || 'badge-medium';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function renderReviewDetailPage(app, requestId) {
  let req = null;
  try {
    req = await app.api.get(`/agent/requests/${requestId}`);
  } catch (e) {
    return `
      <div class="page-header animate-fade-in">
        <h1>Запрос</h1>
        <p>Ошибка загрузки: ${escapeHtml(e.message)}</p>
        <a href="#/review" class="btn btn-secondary btn-sm">Назад к ревью</a>
      </div>
    `;
  }

  const user = app.store.get('currentUser');
  const role = (user?.role_name || '').toLowerCase();
  const canReview = [
    'po/pl/cl', 'ba/участник команды', 'ba/бизнес-аналитик',
    'лидер трайба', 'проектный офис (админ)', 'администратор',
  ].includes(role);

  return `
    <div class="page-header animate-fade-in" style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3);">
      <div style="flex:1;min-width:0;">
        <h1>Запрос #${req.id}</h1>
        <p>${reviewStatusBadge(req.status)}</p>
      </div>
      <a href="#/review" class="btn btn-secondary btn-sm">
        <i data-lucide="arrow-left" style="width:14px;height:14px;"></i>
        Назад к ревью
      </a>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">${escapeHtml(req.title)}</h2>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:var(--space-5);flex-wrap:wrap;margin-bottom:var(--space-4);">
          <div><span class="text-muted">Автор:</span> <span>${escapeHtml(req.author_name || '—')}</span></div>
          <div><span class="text-muted">Команда:</span> <span class="badge badge-info">${escapeHtml(req.team_name || '—')}</span></div>
          <div><span class="text-muted">Создан:</span> <span>${formatDate(req.created_at)}</span></div>
          <div><span class="text-muted">Обновлён:</span> <span>${formatDate(req.updated_at)}</span></div>
        </div>

        ${req.assignee_name ? `<div style="margin-bottom:var(--space-4);padding:var(--space-3);background:var(--bg-tertiary);border-radius:var(--radius-md);">
          <span class="text-muted">Назначен на проработку:</span> <strong>${escapeHtml(req.assignee_name)}</strong>
        </div>` : ''}

        ${req.reject_reason ? `<div style="margin-bottom:var(--space-4);padding:var(--space-3);background:var(--danger-light);border-radius:var(--radius-md);border-left:3px solid var(--danger);">
          <div class="text-muted" style="font-size:var(--text-xs);margin-bottom:4px;">Причина отклонения:</div>
          <div>${escapeHtml(req.reject_reason)}</div>
        </div>` : ''}

        <div class="request-detail">${renderRequestDescription(req.description)}</div>

        ${req.draft ? `<details style="margin-top:var(--space-4);"><summary class="text-secondary" style="cursor:pointer;font-size:var(--text-sm);">Показать полный драфт (JSON)</summary><pre style="margin-top:var(--space-2);padding:var(--space-3);background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-md);overflow:auto;font-size:11px;max-height:400px;">${escapeHtml(JSON.stringify(req.draft, null, 2))}</pre></details>` : ''}
      </div>
    </div>

    ${canReview && ['submitted', 'in_review', 'returned'].includes(req.status) ? `
    <div class="card" id="review-actions-card">
      <div class="card-header">
        <h2 class="card-title">Действия</h2>
      </div>
      <div class="card-body">
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
          <button class="btn btn-success btn-sm" id="btn-approve">
            <i data-lucide="check" style="width:14px;height:14px;"></i>
            Принять в проработку
          </button>
          <button class="btn btn-danger btn-sm" id="btn-reject">
            <i data-lucide="x" style="width:14px;height:14px;"></i>
            Отклонить
          </button>
        </div>
      </div>
    </div>
    ` : ''}
  `;
}

export async function initReviewDetailPage(app, requestId) {
  const approveBtn = document.getElementById('btn-approve');
  const rejectBtn = document.getElementById('btn-reject');

  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      await showAssignModal(app, requestId);
    });
  }

  if (rejectBtn) {
    rejectBtn.addEventListener('click', async () => {
      await showRejectModal(app, requestId);
    });
  }

  if (window.lucide) window.lucide.createIcons();
}

async function showAssignModal(app, requestId) {
  const req = await app.api.get(`/agent/requests/${requestId}`);
  const teamId = req.team_id;
  if (!teamId) {
    window.toast?.('У запроса не указана команда', 'warning');
    return;
  }

  const baList = await app.api.get(`/agent/teams/${teamId}/ba`);
  const options = baList.map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${escapeHtml(u.role || '—')})</option>`).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <h3>Назначить на проработку</h3>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <label class="form-label">Ответственный BA</label>
        <select id="assignee-select" class="input" style="width:100%;">
          <option value="">— Выберите —</option>
          ${options}
        </select>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" id="modal-cancel">Отмена</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm">Назначить</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modal-close').addEventListener('click', close);
  modal.querySelector('#modal-cancel').addEventListener('click', close);
  modal.querySelector('#modal-confirm').addEventListener('click', async () => {
    const assigneeId = parseInt(modal.querySelector('#assignee-select').value);
    if (!assigneeId) {
      window.showFieldError?.(modal.querySelector('#assignee-select'), 'Выберите ответственного');
      return;
    }
    try {
      await app.api.put(`/agent/requests/${requestId}/status`, {
        status: 'in_progress',
        assignee_id: assigneeId,
      });
      close();
      window.location.hash = `#/review/${requestId}`;
      window.location.reload();
    } catch (e) {
      window.toast?.(window.formatErrorMessage?.(e) || 'Не удалось назначить ответственного', 'error');
    }
  });
}

async function showRejectModal(app, requestId) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <h3>Отклонить запрос</h3>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <label class="form-label">Причина отклонения (обязательно)</label>
        <textarea id="reject-reason" class="input" rows="4" style="width:100%;" placeholder="Укажите причину..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" id="modal-cancel">Отмена</button>
        <button class="btn btn-danger btn-sm" id="modal-confirm">Отклонить</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modal-close').addEventListener('click', close);
  modal.querySelector('#modal-cancel').addEventListener('click', close);
  modal.querySelector('#modal-confirm').addEventListener('click', async () => {
    const reason = modal.querySelector('#reject-reason').value.trim();
    if (!reason) {
      window.showFieldError?.(modal.querySelector('#reject-reason'), 'Укажите причину отклонения');
      return;
    }
    try {
      await app.api.put(`/agent/requests/${requestId}/status`, {
        status: 'rejected',
        reject_reason: reason,
      });
      close();
      window.location.hash = `#/review/${requestId}`;
      window.location.reload();
    } catch (e) {
      window.toast?.(window.formatErrorMessage?.(e) || 'Не удалось отклонить запрос', 'error');
    }
  });
}

function renderRequestDescription(description) {
  if (!description) return '<p class="text-muted">Описание отсутствует</p>';
  return description
    .split('\n')
    .map(line => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return `<h4 style="margin-top:var(--space-3);margin-bottom:var(--space-2);">${escapeHtml(line.slice(2, -2))}</h4>`;
      }
      if (line.startsWith('- ')) {
        return `<li>${escapeHtml(line.slice(2))}</li>`;
      }
      if (line.trim()) {
        return `<p>${escapeHtml(line)}</p>`;
      }
      return '';
    })
    .join('');
}
