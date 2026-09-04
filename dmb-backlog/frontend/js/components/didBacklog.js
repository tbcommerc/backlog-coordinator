import { escapeHtml } from '../htmlUtils.js';
import { renderViewState, bindViewStateAction } from './viewState.js';
import { formatErrorMessage } from '../uiFeedback.js';

export const DID_COLUMNS = [
  ['did_client_group', 'Группировка для клиентов ДИД', 12],
  ['team_name', 'Ответственная команда / кластер', 12],
  ['project_name', 'Проект', 10], ['title', 'Задача', 15],
  ['task_type_name', 'Тип задачи', 8],
  ['department_name', 'Подразделение Бизнес-заказчика', 12],
  ['business_customer_contact', 'Бизнес-заказчик', 9],
  ['deadline_name', 'Срок выполнения', 10], ['financial_effect', 'Фин. эффект, млн ₽', 12],
];
const ENDPOINT = '/reports/did-backlog';
export const defaultDidPrefs = quarter => ({ quarter, filters: {}, sortField: null, sortDir: 'asc', widths: Object.fromEntries(DID_COLUMNS.map(([k, , w]) => [k, w])) });
const gap = (row, key) => row.gaps.includes(key);
export const didValueKey = value => typeof value === 'number' ? String(value) : String(value ?? '').trim();
export function didDisplay(row, key) {
  if (gap(row, key)) return 'не заполнено';
  if (key === 'financial_effect') return Number(row[key]).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (key === 'task_type_name' && row[key].toLocaleLowerCase('ru-RU') === 'квартальная/годовая цель') return 'Цель';
  return String(row[key]);
}
export function didVisibleRows(rows, prefs) {
  const result = rows.filter(row => Object.entries(prefs.filters).every(([key, values]) => !values.length || (!gap(row, key) && values.includes(didValueKey(row[key])))));
  const key = prefs.sortField;
  if (!key) return result;
  return result.sort((a, b) => {
    if (gap(a, key) || gap(b, key)) return Number(gap(a, key)) - Number(gap(b, key)) || a.id - b.id;
    const comparison = key === 'financial_effect' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]), 'ru');
    return comparison * (prefs.sortDir === 'desc' ? -1 : 1) || a.id - b.id;
  });
}

export function renderDidBacklog() {
  return `<section class="did-report animate-fade-in" id="did-report">
    <div class="did-heading"><a class="btn btn-ghost btn-sm" href="#/reports" aria-label="К статусам для встреч">←</a><div><h1>Бэклог для отправки на бизнес-заказчиков ДИД</h1><p class="text-muted">Квартальный портфель задач и финансовый эффект для бизнес-заказчиков</p></div></div>
    <div class="action-bar"><span class="badge badge-info">Статус-отчёт</span><div class="did-actions">
      <button class="btn btn-secondary btn-sm" data-did-export="xlsx" disabled><i data-lucide="file-spreadsheet"></i>Excel</button>
      <button class="btn btn-secondary btn-sm" data-did-export="pdf" disabled><i data-lucide="printer"></i>PDF</button>
      <button class="btn btn-secondary btn-sm" data-did-refresh><i data-lucide="refresh-cw"></i>Обновить</button></div></div>
    <div id="did-content" aria-live="polite"><div class="card empty-state">Загрузка отчёта…</div></div>
  </section>`;
}

export async function initDidBacklog(app) {
  const root = document.getElementById('did-report');
  if (!root) return;
  const breadcrumb = document.getElementById('breadcrumb-nav');
  if (breadcrumb) breadcrumb.innerHTML = '<a href="#/reports" class="breadcrumb-parent">Статусы для встреч</a><span class="breadcrumb-separator">/</span><span class="breadcrumb-current">Бэклог для бизнес-заказчиков ДИД</span>';
  const content = root.querySelector('#did-content');
  let prefs, calendar, rows = [], total = 0, saved = false, saveError = false, loading = true, canExport = false;
  let requestVersion = 0, saveVersion = 0, saveQueue = Promise.resolve(), openFilter = null;
  const alive = () => root.isConnected;
  const visible = () => didVisibleRows(rows, prefs);
  const iconRefresh = () => window.lucide?.createIcons();
  function showLoadError(error, retry) {
    content.innerHTML = `<div class="card">${renderViewState({ kind: 'error', title: 'Не удалось загрузить отчёт', message: formatErrorMessage(error), actionLabel: 'Повторить' })}</div>`;
    bindViewStateAction(content, retry);
    iconRefresh();
  }
  const controls = () => root.querySelectorAll('[data-did-export]').forEach(button => { button.disabled = loading || !canExport; });
  function render() {
    if (!alive() || !prefs) return;
    const view = visible();
    const empties = view.reduce((n, r) => n + r.gaps.length, 0), gaps = view.filter(r => r.gaps.length).length;
    const hasFilters = Object.values(prefs.filters).some(v => v.length);
    const resized = DID_COLUMNS.some(([key, , width]) => Math.abs(prefs.widths[key] - width) > .001);
    content.innerHTML = `<div class="did-quarter-bar card"><label>Квартал<select class="input" data-did-quarter ${loading ? 'disabled' : ''}>${calendar.quarters.map(q => `<option ${q === prefs.quarter ? 'selected' : ''}>${escapeHtml(q)}</option>`).join('')}</select></label>
      <p>«Квартальная/годовая цель» и «AD-HOC» за выбранный квартал. Годовые цели — в IV квартале. Исключены «Холд», «Отклонена», «Не актуальна».</p>
      <span class="did-completeness ${empties ? 'has-gaps' : 'complete'}">${view.length ? (empties ? `Не заполнено: ${empties} · задач с пробелами: ${gaps} из ${view.length}` : '✓ Все данные заполнены') : 'Нет данных для проверки'}</span></div>
      <div class="card did-table-card" aria-busy="${loading}"><table class="did-table"><colgroup>${DID_COLUMNS.map(([key]) => `<col style="width:${prefs.widths[key]}%">`).join('')}</colgroup><thead><tr>${DID_COLUMNS.map(([key, label], index) => {
        const selected = prefs.filters[key] || [];
        return `<th scope="col" aria-sort="${prefs.sortField === key ? (prefs.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><div class="did-th"><button class="did-sort" data-did-sort="${key}">${escapeHtml(label)}${prefs.sortField === key ? (prefs.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button><button class="did-filter ${selected.length ? 'active' : ''}" data-did-filter="${key}" aria-label="Фильтр: ${escapeHtml(label)}" aria-expanded="${openFilter === key}"><i data-lucide="filter"></i>${selected.length || ''}</button></div>${index < 8 ? `<span class="did-resize" data-did-resize="${index}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Ширина: ${escapeHtml(label)}" aria-valuemin="4" aria-valuemax="${prefs.widths[key] + prefs.widths[DID_COLUMNS[index + 1][0]] - 4}" aria-valuenow="${prefs.widths[key]}"></span>` : ''}</th>`;
      }).join('')}</tr></thead><tbody>${loading ? '<tr><td colspan="9" class="did-empty">Загрузка отчёта…</td></tr>' : view.length ? view.map(row => `<tr data-did-task="${row.id}" tabindex="0" aria-label="Открыть задачу: ${escapeHtml(row.title || 'не заполнено')}">${DID_COLUMNS.map(([key]) => `<td class="${gap(row, key) ? 'did-gap' : ''} ${key === 'financial_effect' ? 'did-number' : ''}" title="${escapeHtml(gap(row, key) ? 'Значение не заполнено' : String(row[key]))}"><span class="${key === 'title' ? 'did-title' : 'did-value'} ${['did_client_group', 'team_name'].includes(key) && !gap(row, key) ? 'did-badge' : ''}">${escapeHtml(didDisplay(row, key))}</span></td>`).join('')}</tr>`).join('') : `<tr><td colspan="9" class="did-empty"><strong>${total ? 'Нет совпадений' : 'Нет задач'}</strong><p>${total ? 'Измените или сбросьте фильтры.' : 'За выбранный квартал нет задач, соответствующих правилам отчёта.'}</p></td></tr>`}</tbody></table>
      <div class="did-footer"><span>${view.length} из ${total} задач</span>${hasFilters ? '<button class="btn btn-ghost btn-sm" data-did-clear>Сбросить все фильтры</button>' : ''}${resized ? '<button class="btn btn-ghost btn-sm" data-did-widths>Вернуть исходные ширины</button>' : ''}<span class="did-save-state" role="status">${saveError ? 'Не удалось сохранить настройки' : saved ? '✓ Настройки сохранены' : ''}</span><button class="btn btn-ghost btn-sm" data-did-reset>Сбросить настройки</button></div></div><p class="did-width-hint">Ширину колонок можно менять, потянув границу заголовка. Для клавиатуры — стрелки влево и вправо.</p>`;
    controls(); iconRefresh();
  }
  function persist() {
    const version = ++saveVersion, snapshot = JSON.parse(JSON.stringify(prefs));
    saveQueue = saveQueue.catch(() => {}).then(() => app.api.put(`${ENDPOINT}/preferences`, snapshot)).then(() => {
      if (version === saveVersion && alive()) { saved = true; saveError = false; updateSaveState(); }
    }).catch(() => { if (version === saveVersion && alive()) { saveError = true; updateSaveState(); } });
  }
  function updateSaveState() {
    const el = root.querySelector('.did-save-state');
    if (el) el.textContent = saveError ? 'Не удалось сохранить настройки' : saved ? '✓ Настройки сохранены' : '';
  }
  async function load() {
    const version = ++requestVersion;
    loading = true; closeFilter(); render(); controls();
    try {
      const data = await app.api.get(`${ENDPOINT}?quarter=${encodeURIComponent(prefs.quarter)}`);
      if (!alive() || version !== requestVersion) return;
      rows = data.tasks; total = data.total_tasks; canExport = data.can_export; loading = false; render();
    } catch (error) {
      if (!alive() || version !== requestVersion) return;
      showLoadError(error, load);
      loading = true; controls();
    }
  }
  function closeFilter() { root.querySelector('.did-filter-panel')?.remove(); root.querySelectorAll('[data-did-filter]').forEach(b => b.setAttribute('aria-expanded', 'false')); openFilter = null; }
  function filterPanel(key, button) {
    if (openFilter === key) { closeFilter(); return; }
    closeFilter(); openFilter = key;
    const values = [...new Set(rows.filter(r => !gap(r, key)).map(r => didValueKey(r[key])))].sort((a, b) => a.localeCompare(b, 'ru'));
    const panel = document.createElement('div'); panel.className = 'did-filter-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', `Фильтр: ${DID_COLUMNS.find(c => c[0] === key)[1]}`);
    panel.innerHTML = `<div class="did-filter-panel-head"><strong>${escapeHtml(DID_COLUMNS.find(c => c[0] === key)[1])}</strong><button class="btn btn-ghost btn-sm" data-did-close aria-label="Закрыть фильтр">×</button></div><input class="input" type="search" placeholder="Поиск значения" aria-label="Поиск значения"><div class="did-filter-values">${values.map(v => `<label><input type="checkbox" value="${escapeHtml(v)}" ${(prefs.filters[key] || []).includes(v) ? 'checked' : ''}> <span>${escapeHtml(key === 'financial_effect' ? Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : v)}</span></label>`).join('') || '<p>Нет заполненных значений</p>'}</div><button class="btn btn-secondary btn-sm" data-did-filter-clear>Очистить фильтр</button>`;
    root.appendChild(panel); button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 390))}px`;
    panel.querySelector('input[type=search]').focus();
    panel.querySelector('input[type=search]').oninput = event => panel.querySelectorAll('.did-filter-values label').forEach(label => { label.hidden = !label.textContent.toLocaleLowerCase('ru-RU').includes(event.target.value.toLocaleLowerCase('ru-RU')); });
    panel.onchange = () => {
      prefs.filters[key] = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(el => el.value);
      // Keep the popover mounted while rebuilding only the table beneath it.
      render(); persist();
    };
    panel.querySelector('[data-did-filter-clear]').onclick = () => { delete prefs.filters[key]; closeFilter(); render(); persist(); };
    panel.querySelector('[data-did-close]').onclick = closeFilter;
    panel.onkeydown = event => { if (event.key === 'Escape') { closeFilter(); root.querySelector(`[data-did-filter="${key}"]`)?.focus(); } };
  }
  async function exportView(format) {
    if (loading || !canExport) return;
    const command = { ...prefs, ordered_ids: visible().map(r => r.id) };
    try {
      const result = await app.api.post(`${ENDPOINT}/export/${format}`, command);
      if (!alive()) return;
      if (format === 'xlsx') {
        const bytes = Uint8Array.from(atob(result.content), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        const frame = document.createElement('iframe'); frame.className = 'did-print-frame'; frame.title = 'Печатная версия отчёта';
        frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
        frame.srcdoc = result.html; root.appendChild(frame);
        frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
      }
    } catch (error) { window.toast?.(error.message || 'Не удалось выгрузить отчёт', 'error'); }
  }
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (button?.hasAttribute('data-did-refresh')) { if (prefs) await load(); else await initialize(); return; }
    if (!prefs || loading) return;
    if (button?.dataset.didExport) { await exportView(button.dataset.didExport); return; }
    if (button?.dataset.didFilter) { filterPanel(button.dataset.didFilter, button); return; }
    if (!event.target.closest('.did-filter-panel')) closeFilter();
    if (button?.dataset.didSort) { const key = button.dataset.didSort; prefs.sortDir = prefs.sortField === key && prefs.sortDir === 'asc' ? 'desc' : 'asc'; prefs.sortField = key; render(); persist(); }
    else if (button?.hasAttribute('data-did-clear')) { prefs.filters = {}; render(); persist(); }
    else if (button?.hasAttribute('data-did-widths')) { prefs.widths = defaultDidPrefs(prefs.quarter).widths; render(); persist(); }
    else if (button?.hasAttribute('data-did-reset')) {
      ++saveVersion; loading = true; controls();
      try { await saveQueue; await app.api.delete(`${ENDPOINT}/preferences`); saved = false; saveError = false; }
      catch { saveError = true; }
      prefs = defaultDidPrefs(calendar.current_quarter); await load();
    } else if (!event.target.closest('thead, .did-filter-panel')) {
      const row = event.target.closest('[data-did-task]');
      if (row) { try { const { openTaskModal, setOnTaskSaved } = await import('./modal.js'); const task = await app.api.get(`/tasks/${row.dataset.didTask}`); setOnTaskSaved(() => { if (alive()) load(); }); openTaskModal(task); } catch (error) { window.toast?.(error.message, 'error'); } }
    }
  });
  root.addEventListener('change', event => {
    if (!event.target.matches('[data-did-quarter]')) return;
    prefs.quarter = event.target.value; prefs.filters = {}; prefs.sortField = null; prefs.sortDir = 'asc'; persist(); load();
  });
  function resize(index, delta, start) {
    const left = DID_COLUMNS[index][0], right = DID_COLUMNS[index + 1][0];
    const change = Math.max(4 - start[left], Math.min(delta, start[right] - 4));
    prefs.widths[left] = start[left] + change; prefs.widths[right] = start[right] - change;
    root.querySelectorAll('col').forEach((col, i) => { col.style.width = `${prefs.widths[DID_COLUMNS[i][0]]}%`; });
  }
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-did-resize]'); if (!handle || loading) return;
    event.preventDefault(); closeFilter(); handle.setPointerCapture(event.pointerId);
    const index = Number(handle.dataset.didResize), start = { ...prefs.widths }, x = event.clientX;
    const width = root.querySelector('table').getBoundingClientRect().width;
    handle.onpointermove = e => resize(index, (e.clientX - x) / width * 100, start);
    const finish = () => { handle.onpointermove = null; handle.onpointerup = null; handle.onpointercancel = null; render(); persist(); };
    handle.onpointerup = finish; handle.onpointercancel = finish;
  });
  root.addEventListener('keydown', event => {
    if (event.target.matches('[data-did-task]') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.click(); }
    const handle = event.target.closest('[data-did-resize]');
    if (handle && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); const index = Number(handle.dataset.didResize);
      resize(index, event.key === 'ArrowLeft' ? -1 : 1, { ...prefs.widths }); render(); persist(); root.querySelector(`[data-did-resize="${index}"]`)?.focus();
    }
  });
  async function initialize() {
    try {
      const [dates, stored] = await Promise.all([app.api.get(`${ENDPOINT}/quarters`), app.api.get(`${ENDPOINT}/preferences`).catch(() => ({ saved: false, prefs: null }))]);
      if (!alive()) return;
      calendar = dates; prefs = stored.prefs || defaultDidPrefs(dates.current_quarter); saved = stored.saved;
      if (!dates.quarters.includes(prefs.quarter)) prefs.quarter = dates.current_quarter;
      await load();
    } catch (error) { if (alive()) showLoadError(error, initialize); }
  }
  await initialize();
}
