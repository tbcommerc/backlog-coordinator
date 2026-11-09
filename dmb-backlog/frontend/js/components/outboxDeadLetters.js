import { counter } from '../ui/dataDisplay.js';
import { pagination } from '../ui/forms.js';
import { escapeHtml } from '../htmlUtils.js';
import { confirmAction, formatErrorMessage, showToast } from '../uiFeedback.js';
import { button, control, icon, pageHeader } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';
import { renderViewState } from './viewState.js';


let state = { page: 1, perPage: 50, search: '', data: { items: [], total: 0, pages: 0 }, loading: true, lastUpdatedAt: null };


function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : '—';
}


let outboxReadEpoch = 0;

async function load(app) {
  const root = document.getElementById('outbox-dead-letter-body');
  if (!root) return;
  const epoch = ++outboxReadEpoch;
  const current = () => epoch === outboxReadEpoch && root.isConnected && document.getElementById('outbox-dead-letter-body') === root;
  state.loading = true;
  renderBody();
  const params = new URLSearchParams({
    page: String(state.page),
    per_page: String(state.perPage),
  });
  if (state.search) params.set('search', state.search);
  try {
    const result = await app.api.get(`/admin/outbox/dead-letters?${params}`);
    if (!current()) return;
    state.data = result;
    state.lastUpdatedAt = new Date();
  } catch (error) {
    if (!current()) return;
    state.data = { items: [], total: 0, pages: 0, error: formatErrorMessage(error) };
  } finally {
    if (current()) {
      state.loading = false;
      renderBody();
    }
  }
}


function eventPayload(item) {
  return escapeHtml(JSON.stringify(item.payload || {}, null, 2));
}


function attemptTone(attempts) {
  const count = Number(attempts || 0);
  if (count >= 10) return 'danger';
  if (count >= 5) return 'warning';
  return 'neutral';
}


function renderOverview() {
  const unknown = state.loading || state.data.error;
  const visible = unknown ? '—' : state.data.items?.length || 0;
  const total = unknown ? '—' : Number(state.data.total || 0);
  const updated = state.data.error ? 'Не удалось обновить; состояние очереди неизвестно' : state.loading ? 'Обновляем…' : state.lastUpdatedAt
    ? `Обновлено ${state.lastUpdatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : 'Данные ещё не обновлены';
  return `<div class="outbox-overview-metrics" aria-live="polite">
    <div class="outbox-metric is-danger"><span>Требуют внимания</span><strong>${total}</strong></div>
    <div class="outbox-metric"><span>Показано на странице</span><strong>${visible}</strong></div>
    <div class="outbox-update-state"><i data-lucide="clock-3" aria-hidden="true"></i><span>${escapeHtml(updated)}</span></div>
  </div>`;
}


function renderRows() {
  const tableState = props => `<tr><td colspan="7" class="outbox-table-state">${renderViewState(props)}</td></tr>`;
  if (state.loading) return tableState({ kind: 'loading', title: 'Загружаем события…' });
  if (state.data.error) return tableState({ kind: 'error', title: 'Не удалось загрузить события', message: state.data.error, actionLabel: 'Повторить' });
  if (!state.data.items?.length) return tableState({ kind: 'empty', title: state.search ? 'Ничего не найдено' : 'Ошибок доставки нет', message: state.search ? 'Измените запрос или сбросьте поиск.' : 'В очереди нет событий с исчерпанными попытками. События в обработке могут ещё ожидать доставки.', actionLabel: state.search ? 'Сбросить поиск' : '' });
  return state.data.items.map(item => `
    <tr>
      <td data-label="Событие"><div class="outbox-event-cell"><span class="outbox-event-id">#${escapeHtml(item.id)}</span><strong>${escapeHtml(item.event_type)}</strong></div></td>
      <td data-label="Объект"><div class="outbox-aggregate"><strong>${escapeHtml(item.aggregate_type || '—')}</strong><span>${item.aggregate_id == null ? 'Без ID' : `ID ${escapeHtml(item.aggregate_id)}`} · версия ${escapeHtml(item.aggregate_version ?? '—')}</span></div></td>
      <td data-label="Попыток">${counter({value:item.attempts,tone:attemptTone(item.attempts),label:'Попыток доставки',className:'outbox-attempts'})}</td>
      <td data-label="Дата сбоя"><time class="outbox-date" datetime="${escapeHtml(item.dead_lettered_at || '')}">${escapeHtml(formatDate(item.dead_lettered_at))}</time></td>
      <td data-label="Причина"><div class="outbox-error-message" title="${escapeHtml(item.last_error || '')}">${icon('alert-circle')}<span>${escapeHtml(item.last_error || 'Причина не указана')}</span></div></td>
      <td data-label="Данные"><details class="outbox-details"><summary class="ui-disclosure-text btn btn-secondary btn-sm"><i data-lucide="braces" aria-hidden="true"></i><span>JSON</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary><pre class="outbox-payload">${eventPayload(item)}</pre></details></td>
      <td data-label="Действие">${button({ label: 'Отправить снова', icon: 'rotate-ccw', variant: 'primary', size: 'small', className: 'outbox-requeue', attrs: { 'data-requeue-id': item.id, 'data-attempts': item.attempts } })}</td>
    </tr>`).join('');
}


function renderPagination() {
  const pages = Number(state.data.pages || 0);
  if (pages <= 1) return '';
  return pagination({page:state.page,pages,total:state.data.total,disabled:state.loading,label:'Страницы ошибок доставки'}).replaceAll('data-page=', 'data-outbox-page=');
}


function renderBody() {
  const body = document.getElementById('outbox-dead-letter-body');
  const pagination = document.getElementById('outbox-dead-letter-pagination');
  const overview = document.getElementById('outbox-overview-metrics');
  const total = document.getElementById('outbox-total-count');
  if (body) body.innerHTML = renderRows();
  if (pagination) pagination.innerHTML = renderPagination();
  if (overview) overview.innerHTML = renderOverview();
  if (total) total.textContent = state.loading || state.data.error ? 'Количество неизвестно' : `${Number(state.data.total || 0)} событий`;
  body?.closest('table')?.setAttribute('aria-busy', String(state.loading));
  setButtonBusy(document.getElementById('outbox-refresh-btn'), state.loading, 'Обновляем…');
  setButtonBusy(document.getElementById('outbox-search-btn'), state.loading, 'Ищем…');
  window.lucide?.createIcons();
}


export function renderOutboxDeadLetters() {
  return `<header class="page-header animate-fade-in">${pageHeader({ title: 'Ошибки доставки событий', description: 'Контроль событий, которые не удалось передать во внешние сервисы', className: 'outbox-page-header', actions: button({ label: 'Обновить', icon: 'refresh-cw', size: 'small', attrs: { id: 'outbox-refresh-btn' } }) })}</header>
  <div class="outbox-page">
    <section class="outbox-overview" aria-label="Состояние очереди ошибок">
      <div class="outbox-overview-copy"><span class="outbox-overview-icon">${icon('alert-triangle')}</span><div><strong>Контроль ошибок доставки</strong><p>Устраните причину сбоя во внешнем сервисе, затем верните событие в очередь кнопкой «Отправить снова».</p></div></div>
      <div id="outbox-overview-metrics">${renderOverview()}</div>
    </section>
    <div class="admin-action-row outbox-toolbar" role="search">
      <label class="outbox-search-field" for="outbox-search"><span class="sr-only">Поиск ошибок доставки</span>${icon('search')}${control({ id: 'outbox-search', type: 'search', value: state.search, attrs: { placeholder: 'Тип события, объект или текст ошибки', autocomplete: 'off' } })}</label>
      ${button({ label: 'Найти', icon: 'search', attrs: { id: 'outbox-search-btn' } })}
      <span class="outbox-toolbar-hint">Поиск выполняется по всей очереди ошибок</span>
    </div>
    <div class="admin-section outbox-table-wrap">
      <div class="outbox-table-heading"><div><h2>События с ошибкой</h2><p>Повторная отправка доступна отдельно для каждого события</p></div><span id="outbox-total-count">${escapeHtml(state.data.total || 0)} событий</span></div>
      <table class="ui-table ui-table-data admin-table outbox-table"><thead><tr><th>Событие</th><th>Объект</th><th>Попыток</th><th>Зафиксировано</th><th>Причина</th><th>Данные</th><th>Действие</th></tr></thead>
      <tbody id="outbox-dead-letter-body">${renderRows()}</tbody></table>
      <div id="outbox-dead-letter-pagination">${renderPagination()}</div>
    </div>
  </div>`;
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
    if (event.target.closest('[data-view-state-action]')) {
      if (!state.data.error) {
        document.getElementById('outbox-search').value = '';
        reloadFromSearch();
      } else await load(app);
      return;
    }
    const pageButton = event.target.closest('[data-outbox-page]');
    if (pageButton && !pageButton.disabled) {
      state.page = Number(pageButton.dataset.outboxPage);
      await load(app);
      return;
    }
    const button = event.target.closest('[data-requeue-id]');
    if (!button || button.disabled) return;
    const eventId = Number(button.dataset.requeueId);
    const attempts = Number(button.dataset.attempts);
    const confirmed = await confirmAction({
      title: `Отправить событие #${eventId} снова?`,
      message: 'Убедитесь, что причина ошибки устранена. Событие вернётся в очередь и будет отправлено повторно.',
      confirmText: 'Отправить снова',
    });
    if (!confirmed) return;
    setButtonBusy(button, true, 'Отправляем…');
    try {
      await app.api.post(`/admin/outbox/dead-letters/${eventId}/requeue`, {
        expected_attempts: attempts,
        client_request_id: crypto.randomUUID(),
      });
      showToast(`Событие #${eventId} поставлено на повторную отправку`, 'success');
      await load(app);
    } catch (error) {
      showToast(formatErrorMessage(error), 'error');
    } finally {
      setButtonBusy(button, false);
    }
  });
  await load(app);
}
