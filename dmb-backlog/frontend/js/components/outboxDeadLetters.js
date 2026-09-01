import { escapeHtml } from '../htmlUtils.js';
import { confirmAction, formatErrorMessage, showToast } from '../uiFeedback.js';


let state = { page: 1, perPage: 50, search: '', data: { items: [], total: 0, pages: 0 }, loading: true };


function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}


async function load(app) {
  state.loading = true;
  renderBody();
  const params = new URLSearchParams({
    page: String(state.page),
    per_page: String(state.perPage),
  });
  if (state.search) params.set('search', state.search);
  try {
    state.data = await app.api.get(`/admin/outbox/dead-letters?${params}`);
  } catch (error) {
    state.data = { items: [], total: 0, pages: 0, error: formatErrorMessage(error) };
  } finally {
    state.loading = false;
    renderBody();
  }
}


function eventPayload(item) {
  return escapeHtml(JSON.stringify(item.payload || {}, null, 2));
}


function renderRows() {
  if (state.loading) return '<tr><td colspan="8" class="admin-empty-cell">Загрузка…</td></tr>';
  if (state.data.error) return `<tr><td colspan="8" class="admin-empty-cell">${escapeHtml(state.data.error)}</td></tr>`;
  if (!state.data.items?.length) return `<tr><td colspan="8" class="admin-empty-cell outbox-empty-state">
    <i data-lucide="circle-check" aria-hidden="true"></i>
    <strong>Ошибок доставки нет</strong>
    <span>Все системные события были успешно отправлены.</span>
  </td></tr>`;
  return state.data.items.map(item => `
    <tr>
      <td>${item.id}</td>
      <td><strong>${escapeHtml(item.event_type)}</strong><div class="text-muted">${escapeHtml(item.aggregate_type)}${item.aggregate_id == null ? '' : ` #${item.aggregate_id}`}</div></td>
      <td>${item.aggregate_version ?? '—'}</td>
      <td>${item.attempts}</td>
      <td>${escapeHtml(formatDate(item.dead_lettered_at))}</td>
      <td class="audit-fields" title="${escapeHtml(item.last_error || '')}">${escapeHtml(item.last_error || '—')}</td>
      <td><details><summary>Показать</summary><pre class="outbox-payload">${eventPayload(item)}</pre></details></td>
      <td><button type="button" class="btn btn-primary btn-sm" data-requeue-id="${item.id}" data-attempts="${item.attempts}">Отправить снова</button></td>
    </tr>`).join('');
}


function renderPagination() {
  const pages = Number(state.data.pages || 0);
  if (pages <= 1) return '';
  return `<div class="admin-pagination">
    <button class="btn btn-sm" data-outbox-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>Назад</button>
    <span>Страница ${state.page} из ${pages} · событий: ${state.data.total || 0}</span>
    <button class="btn btn-sm" data-outbox-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Далее</button>
  </div>`;
}


function renderBody() {
  const body = document.getElementById('outbox-dead-letter-body');
  const pagination = document.getElementById('outbox-dead-letter-pagination');
  if (body) body.innerHTML = renderRows();
  if (pagination) pagination.innerHTML = renderPagination();
}


export function renderOutboxDeadLetters() {
  return `<div class="page-header animate-fade-in">
    <div><h1>Ошибки доставки событий</h1><p>События, которые система не смогла отправить автоматически</p></div>
  </div>
  <main class="outbox-page">
    <section class="outbox-explanation" aria-label="Как работать с ошибками доставки">
      <i data-lucide="info" aria-hidden="true"></i>
      <div><strong>Что это значит?</strong><p>Система несколько раз попыталась отправить эти события, но получила ошибку. Устраните её причину, а затем отправьте событие снова.</p></div>
    </section>
    <div class="admin-action-row outbox-toolbar">
      <input id="outbox-search" class="input" value="${escapeHtml(state.search)}" placeholder="Поиск по типу события или тексту ошибки" aria-label="Поиск ошибок доставки">
      <button id="outbox-search-btn" class="btn btn-secondary">Найти</button>
      <button id="outbox-refresh-btn" class="btn btn-ghost">Обновить</button>
    </div>
    <div class="admin-section outbox-table-wrap">
      <table class="admin-table outbox-table"><thead><tr><th>ID</th><th>Тип события</th><th>Версия</th><th>Попыток</th><th>Ошибка зафиксирована</th><th>Причина</th><th>Технические данные</th><th>Действие</th></tr></thead>
      <tbody id="outbox-dead-letter-body">${renderRows()}</tbody></table>
      <div id="outbox-dead-letter-pagination">${renderPagination()}</div>
    </div>
  </main>`;
}


export async function initOutboxDeadLetters(app) {
  const reloadFromSearch = () => {
    state.search = document.getElementById('outbox-search')?.value?.trim() || '';
    state.page = 1;
    load(app);
  };
  document.getElementById('outbox-search-btn')?.addEventListener('click', reloadFromSearch);
  document.getElementById('outbox-search')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') reloadFromSearch();
  });
  document.getElementById('outbox-refresh-btn')?.addEventListener('click', () => load(app));
  document.querySelector('.admin-section')?.addEventListener('click', async event => {
    const pageButton = event.target.closest('[data-outbox-page]');
    if (pageButton && !pageButton.disabled) {
      state.page = Number(pageButton.dataset.outboxPage);
      await load(app);
      return;
    }
    const button = event.target.closest('[data-requeue-id]');
    if (!button) return;
    const eventId = Number(button.dataset.requeueId);
    const attempts = Number(button.dataset.attempts);
    const confirmed = await confirmAction({
      title: `Отправить событие #${eventId} снова?`,
      message: 'Убедитесь, что причина ошибки устранена. Событие вернётся в очередь и будет отправлено повторно.',
      confirmText: 'Отправить снова',
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await app.api.post(`/admin/outbox/dead-letters/${eventId}/requeue`, {
        expected_attempts: attempts,
        client_request_id: crypto.randomUUID(),
      });
      showToast(`Событие #${eventId} поставлено на повторную отправку`, 'success');
      await load(app);
    } catch (error) {
      showToast(formatErrorMessage(error), 'error');
      button.disabled = false;
    }
  });
  await load(app);
}
