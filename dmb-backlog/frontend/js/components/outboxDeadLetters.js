import { escapeHtml } from '../htmlUtils.js';
import { confirmAction, formatErrorMessage, showToast } from '../uiFeedback.js';


let state = { page: 1, perPage: 50, search: '', data: { items: [], total: 0, pages: 0 }, loading: true, lastUpdatedAt: null };


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
    state.lastUpdatedAt = new Date();
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


function attemptTone(attempts) {
  const count = Number(attempts || 0);
  if (count >= 10) return ' is-critical';
  if (count >= 5) return ' is-warning';
  return '';
}


function renderOverview() {
  const visible = state.data.items?.length || 0;
  const total = Number(state.data.total || 0);
  const updated = state.lastUpdatedAt
    ? `Обновлено ${state.lastUpdatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : 'Данные ещё не обновлены';
  return `<div class="outbox-overview-metrics" aria-live="polite">
    <div class="outbox-metric is-danger"><span>Требуют внимания</span><strong>${total}</strong></div>
    <div class="outbox-metric"><span>Показано на странице</span><strong>${visible}</strong></div>
    <div class="outbox-update-state"><i data-lucide="clock-3" aria-hidden="true"></i><span>${escapeHtml(updated)}</span></div>
  </div>`;
}


function renderRows() {
  if (state.loading) return '<tr><td colspan="7" class="admin-empty-cell outbox-loading-state"><i data-lucide="loader-circle" aria-hidden="true"></i><span>Загружаем события…</span></td></tr>';
  if (state.data.error) return `<tr><td colspan="7" class="admin-empty-cell outbox-error-state"><i data-lucide="cloud-off" aria-hidden="true"></i><strong>Не удалось загрузить события</strong><span>${escapeHtml(state.data.error)}</span></td></tr>`;
  if (!state.data.items?.length) return `<tr><td colspan="7" class="admin-empty-cell outbox-empty-state">
    <i data-lucide="circle-check" aria-hidden="true"></i>
    <strong>Ошибок доставки нет</strong>
    <span>${state.search ? 'По текущему запросу ничего не найдено.' : 'Все системные события были успешно отправлены.'}</span>
  </td></tr>`;
  return state.data.items.map(item => `
    <tr>
      <td data-label="Событие"><div class="outbox-event-cell"><span class="outbox-event-id">#${escapeHtml(item.id)}</span><strong>${escapeHtml(item.event_type)}</strong></div></td>
      <td data-label="Объект"><div class="outbox-aggregate"><strong>${escapeHtml(item.aggregate_type || '—')}</strong><span>${item.aggregate_id == null ? 'Без ID' : `ID ${escapeHtml(item.aggregate_id)}`} · версия ${escapeHtml(item.aggregate_version ?? '—')}</span></div></td>
      <td data-label="Попыток"><span class="outbox-attempts${attemptTone(item.attempts)}">${escapeHtml(item.attempts)}</span></td>
      <td data-label="Зафиксировано"><time class="outbox-date" datetime="${escapeHtml(item.dead_lettered_at || '')}">${escapeHtml(formatDate(item.dead_lettered_at))}</time></td>
      <td data-label="Причина"><div class="outbox-error-message" title="${escapeHtml(item.last_error || '')}"><i data-lucide="circle-alert" aria-hidden="true"></i><span>${escapeHtml(item.last_error || 'Причина не указана')}</span></div></td>
      <td data-label="Данные"><details class="outbox-details"><summary><i data-lucide="braces" aria-hidden="true"></i><span>JSON</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary><pre class="outbox-payload">${eventPayload(item)}</pre></details></td>
      <td data-label="Действие"><button type="button" class="btn btn-primary btn-sm outbox-requeue" data-requeue-id="${escapeHtml(item.id)}" data-attempts="${escapeHtml(item.attempts)}"><i data-lucide="rotate-ccw" aria-hidden="true"></i>Отправить снова</button></td>
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
  const overview = document.getElementById('outbox-overview-metrics');
  const total = document.getElementById('outbox-total-count');
  if (body) body.innerHTML = renderRows();
  if (pagination) pagination.innerHTML = renderPagination();
  if (overview) overview.innerHTML = renderOverview();
  if (total) total.textContent = `${Number(state.data.total || 0)} событий`;
  window.lucide?.createIcons();
}


export function renderOutboxDeadLetters() {
  return `<div class="page-header outbox-page-header animate-fade-in">
    <div class="outbox-title-block"><span class="outbox-kicker"><i data-lucide="shield-alert" aria-hidden="true"></i>Администрирование</span><h1>Ошибки доставки событий</h1><p>Контроль событий, которые не удалось передать во внешние сервисы</p></div>
    <button id="outbox-refresh-btn" class="btn btn-secondary"><i data-lucide="refresh-cw" aria-hidden="true"></i>Обновить</button>
  </div>
  <main class="outbox-page">
    <section class="outbox-overview" aria-label="Состояние очереди ошибок">
      <div class="outbox-overview-copy"><span class="outbox-overview-icon"><i data-lucide="triangle-alert" aria-hidden="true"></i></span><div><strong>Очередь требует проверки</strong><p>Устраните причину сбоя во внешнем сервисе, затем верните событие в очередь кнопкой «Отправить снова».</p></div></div>
      <div id="outbox-overview-metrics">${renderOverview()}</div>
    </section>
    <div class="admin-action-row outbox-toolbar" role="search">
      <label class="outbox-search-field" for="outbox-search"><i data-lucide="search" aria-hidden="true"></i><input id="outbox-search" class="input" type="search" value="${escapeHtml(state.search)}" placeholder="Тип события, объект или текст ошибки" autocomplete="off"></label>
      <button id="outbox-search-btn" class="btn btn-secondary"><i data-lucide="search" aria-hidden="true"></i>Найти</button>
      <span class="outbox-toolbar-hint">Поиск выполняется по всей очереди ошибок</span>
    </div>
    <div class="admin-section outbox-table-wrap">
      <div class="outbox-table-heading"><div><h2>События с ошибкой</h2><p>Повторная отправка доступна отдельно для каждого события</p></div><span id="outbox-total-count">${escapeHtml(state.data.total || 0)} событий</span></div>
      <table class="admin-table outbox-table"><thead><tr><th>Событие</th><th>Объект</th><th>Попыток</th><th>Зафиксировано</th><th>Причина</th><th>Данные</th><th>Действие</th></tr></thead>
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
