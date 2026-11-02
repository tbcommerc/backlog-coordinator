import { createPopover } from '../ui/popover.js';
import { selectionList, filterSelectionList } from '../ui/selectionList.js';
import { escapeHtml } from '../htmlUtils.js';
import { renderViewState, bindViewStateAction } from './viewState.js';
import { formatErrorMessage } from '../uiFeedback.js';
import { canUseReportingStatusWorkspace, reportingStatusHref } from './reportingStatuses.js?v=21';

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
const COLUMN_LABELS = { did_client_group: 'Клиент ДИД', team_name: 'Команда', task_type_name: 'Тип', business_customer_contact: 'Заказчик', department_name: 'Подразделение', deadline_name: 'Срок', financial_effect: 'Эффект, млн ₽' };
export const defaultDidPrefs = quarter => ({ quarter, filters: {}, sortField: null, sortDir: 'asc', widths: Object.fromEntries(DID_COLUMNS.map(([k, , w]) => [k, w])) });
const gap = (row, key) => row.gaps.includes(key);
export const didValueKey = value => typeof value === 'number' ? String(value) : String(value ?? '').trim();
export function didDisplay(row, key) {
  if (gap(row, key)) return 'не заполнено';
  if (key === 'financial_effect') return Number(row[key]).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (key === 'task_type_name' && row[key].toLocaleLowerCase('ru-RU') === 'квартальная/годовая цель') return 'Цель';
  return String(row[key]);
}
export function didVisibleRows(rows, prefs, referenceOrders = {}) {
  const result = rows.filter(row => Object.entries(prefs.filters).every(([key, values]) => !values.length || (!gap(row, key) && values.includes(didValueKey(row[key])))));
  const key = prefs.sortField;
  if (!key) return result;
  return result.sort((a, b) => {
    if (gap(a, key) || gap(b, key)) return Number(gap(a, key)) - Number(gap(b, key)) || a.id - b.id;
    const semanticOrder = row => {
      if (key === 'did_client_group') return row.group_order;
      const dictionary = { task_type_name: 'task_type', deadline_name: 'deadline' }[key];
      return dictionary ? referenceOrders[dictionary]?.[String(row[key] || '').trim().toLocaleLowerCase('ru-RU')] : null;
    };
    const aOrder = semanticOrder(a), bOrder = semanticOrder(b);
    const comparison = aOrder != null || bOrder != null
      ? (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER)
      : key === 'financial_effect' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]), 'ru');
    return comparison * (prefs.sortDir === 'desc' ? -1 : 1) || a.id - b.id;
  });
}

export function renderDidBacklog(app) {
  return `<section class="did-report animate-fade-in" id="did-report">
    <header class="did-heading toolbar-title-row"><div class="toolbar-title-wrap"><h1 class="toolbar-title">Бэклог для бизнес-заказчиков ДИД</h1><p class="toolbar-subtitle">Квартальный портфель задач для отправки бизнес-заказчикам</p></div><div class="toolbar-actions did-actions">
      ${canUseReportingStatusWorkspace(app) ? `<a class="btn btn-primary btn-sm" href="${reportingStatusHref({ source: 'report', kind: 'did' })}"><i data-lucide="clipboard-edit"></i>Заполнить статусы</a>` : ''}
      <button class="btn btn-secondary btn-sm" data-did-export="xlsx" disabled><i data-lucide="file-spreadsheet"></i>Excel</button>
      <button class="btn btn-secondary btn-sm" data-did-export="pdf" disabled><i data-lucide="printer"></i>PDF</button>
      <span class="toolbar-actions-divider" aria-hidden="true"></span><button class="btn btn-secondary btn-sm square-icon" data-did-refresh aria-label="Обновить отчёт" title="Обновить отчёт"><i data-lucide="refresh-cw"></i></button></div></header>
    <div id="did-content"><div class="card">${renderViewState({ kind: 'loading', title: 'Загрузка отчёта…' })}</div></div>
  </section>`;
}

export async function initDidBacklog(app) {
  const root = document.getElementById('did-report');
  if (!root) return;
  const breadcrumb = document.getElementById('breadcrumb-nav');
  if (breadcrumb) breadcrumb.innerHTML = '<a href="#/dashboard" class="breadcrumb-parent">Главная</a><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="#/reports" class="breadcrumb-parent">Статусы для встреч</a><span class="breadcrumb-separator">/</span><span class="breadcrumb-current" aria-current="page">Бэклог для бизнес-заказчиков ДИД</span>';
  const content = root.querySelector('#did-content');
  let prefs, calendar, rows = [], sortOrders = {}, total = 0, saved = false, saveError = false, loading = true, canExport = false;
  let requestVersion = 0, saveVersion = 0, saveQueue = Promise.resolve(), openFilter = null, filterPopover = null;
  const alive = () => root.isConnected;
  const visible = () => didVisibleRows(rows, prefs, sortOrders);
  const iconRefresh = () => window.lucide?.createIcons();
  function showLoadError(error, retry) {
    content.innerHTML = `<div class="card">${renderViewState({ kind: 'error', title: 'Не удалось загрузить отчёт', message: formatErrorMessage(error), actionLabel: 'Повторить' })}</div>`;
    bindViewStateAction(content, retry);
    iconRefresh();
  }
  const controls = () => root.querySelectorAll('[data-did-export]').forEach(button => { button.disabled = loading || !canExport; });
  function render() {
    if (!alive() || !prefs) return;
    const scroll = root.querySelector('.did-table-scroll');
    const scrollPosition = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
    const rulesOpen = root.querySelector('.did-rules')?.open || false;
    const view = visible();
    const empties = view.reduce((n, r) => n + r.gaps.length, 0), gaps = view.filter(r => r.gaps.length).length;
    const hasFilters = Object.values(prefs.filters).some(v => v.length);
    const resized = DID_COLUMNS.some(([key, , width]) => Math.abs(prefs.widths[key] - width) > .001);
    content.innerHTML = `<div class="did-controls"><div class="did-quarter-bar"><label for="did-quarter"><i data-lucide="calendar-days" aria-hidden="true"></i>Квартал</label><select id="did-quarter" class="input" data-did-quarter ${loading ? 'disabled' : ''}>${calendar.quarters.map(q => `<option ${q === prefs.quarter ? 'selected' : ''}>${escapeHtml(q)}</option>`).join('')}</select><span class="did-scope">Цели и AD-HOC</span><details class="did-rules" ${rulesOpen ? 'open' : ''}><summary><i data-lucide="info" aria-hidden="true"></i>Правила отчёта<i data-lucide="chevron-down" aria-hidden="true"></i></summary><div>Задачи типов «Квартальная/годовая цель» и «AD-HOC» за выбранный квартал. Годовые цели включаются в IV квартал. Исключены статусы «Холд», «Отклонена», «Не актуальна».</div></details></div>
      ${hasFilters ? `<div class="active-filters-row did-active-filters" aria-label="Активные фильтры">${DID_COLUMNS.filter(([key]) => prefs.filters[key]?.length).map(([key, label]) => `<span class="active-filter-chip"><span class="chip-label">${escapeHtml(COLUMN_LABELS[key] || label)}:</span><span class="chip-value" title="${escapeHtml(prefs.filters[key].join(', '))}">${escapeHtml(prefs.filters[key].length === 1 ? prefs.filters[key][0] : `Выбрано: ${prefs.filters[key].length}`)}</span><button class="btn btn-ghost btn-sm square-icon ui-btn chip-clear" data-did-remove-filter="${key}" aria-label="Снять фильтр: ${escapeHtml(label)}">×</button></span>`).join('')}<button class="btn btn-ghost btn-sm" data-did-clear>Сбросить фильтры</button></div>` : ''}</div>
      <div class="did-completeness ${loading ? 'content-loading-state' : ''} ${view.length ? (empties ? 'has-gaps' : 'complete') : ''}" role="status"><i data-lucide="${empties ? 'alert-circle' : view.length ? 'check-circle' : 'info'}" aria-hidden="true"></i><span>${loading ? 'Загрузка данных…' : view.length ? (empties ? `<strong>Не заполнено полей: ${empties}</strong><span>В ${gaps} из ${view.length} задач. Отмечены в таблице.</span>` : '<strong>Все данные заполнены</strong><span>Отчёт готов к отправке.</span>') : 'Нет данных для проверки'}</span></div>
      <div class="card did-table-card" aria-busy="${loading}"><div class="did-table-scroll" tabindex="0" role="region" aria-label="Таблица бэклога ДИД"><table class="ui-table ui-table-data did-table"><caption class="sr-only">Бэклог для бизнес-заказчиков ДИД — ${escapeHtml(prefs.quarter)}</caption><colgroup>${DID_COLUMNS.map(([key]) => `<col style="width:${prefs.widths[key]}%">`).join('')}</colgroup><thead><tr>${DID_COLUMNS.map(([key, label], index) => {
        const selected = prefs.filters[key] || [];
        return `<th scope="col" aria-sort="${prefs.sortField === key ? (prefs.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"><div class="did-th"><button class="btn btn-secondary btn-sm ui-btn did-sort" data-did-sort="${key}" title="Сортировать: ${escapeHtml(label)}"><span class="did-sort-label">${escapeHtml(COLUMN_LABELS[key] || label)}</span>${prefs.sortField === key ? `<span class="did-sort-indicator" aria-hidden="true">${prefs.sortDir === 'asc' ? '↑' : '↓'}</span>` : ''}</button><button class="btn btn-secondary btn-sm ui-btn did-filter ${selected.length ? 'active' : ''}" data-did-filter="${key}" aria-label="Фильтр: ${escapeHtml(label)}" aria-expanded="${openFilter === key}"><i data-lucide="filter"></i>${selected.length || ''}</button></div>${index < 8 ? `<span class="did-resize" data-did-resize="${index}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Ширина: ${escapeHtml(label)}" aria-valuemin="4" aria-valuemax="${prefs.widths[key] + prefs.widths[DID_COLUMNS[index + 1][0]] - 4}" aria-valuenow="${prefs.widths[key]}"></span>` : ''}</th>`;
      }).join('')}</tr></thead><tbody>${loading ? `<tr><td colspan="9" class="did-empty"><div class="did-empty-content">${renderViewState({ kind: 'loading', title: 'Загрузка отчёта…' })}</div></td></tr>` : view.length ? view.map(row => `<tr data-did-task="${row.id}" tabindex="0" aria-label="Открыть задачу: ${escapeHtml(row.title || 'не заполнено')}">${DID_COLUMNS.map(([key]) => `<td class="${gap(row, key) ? 'did-gap' : ''} ${key === 'financial_effect' ? 'did-number' : ''}" title="${escapeHtml(gap(row, key) ? 'Значение не заполнено' : String(row[key]))}"><span class="${key === 'title' ? 'did-title' : 'did-value'} ${['did_client_group', 'team_name'].includes(key) && !gap(row, key) ? 'did-badge' : ''}">${escapeHtml(didDisplay(row, key))}</span></td>`).join('')}</tr>`).join('') : `<tr><td colspan="9" class="did-empty"><div class="did-empty-content"><strong>${total ? 'Нет совпадений' : 'Нет задач'}</strong><p>${total ? 'Измените или сбросьте фильтры.' : 'За выбранный квартал нет задач, соответствующих правилам отчёта.'}</p></div></td></tr>`}</tbody></table>
      </div><div class="did-footer"><span class="did-row-count">${view.length} из ${total} задач</span>${resized ? '<button class="btn btn-ghost btn-sm" data-did-widths>Вернуть ширины</button>' : ''}<span class="did-save-state" role="status">${saveError ? 'Не удалось сохранить настройки' : saved ? '✓ Настройки сохранены' : ''}</span><button class="btn btn-ghost btn-sm" data-did-reset title="Сбросить квартал, фильтры, сортировку и ширины колонок"><i data-lucide="rotate-ccw"></i>Сбросить настройки</button></div></div>`;
    if (scrollPosition && !loading) { const nextScroll = root.querySelector('.did-table-scroll'); nextScroll.scrollLeft = scrollPosition.left; nextScroll.scrollTop = scrollPosition.top; }
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
      rows = data.tasks; sortOrders = data.sort_orders || {}; total = data.total_tasks; canExport = data.can_export; loading = false; render();
    } catch (error) {
      if (!alive() || version !== requestVersion) return;
      showLoadError(error, load);
      loading = true; controls();
    }
  }
  function closeFilter() {
    filterPopover?.close({restoreFocus:false}); filterPopover = null;
    openFilter = null;
  }
  function filterPanel(key, button) {
    if (openFilter === key) { closeFilter(); return; }
    closeFilter(); openFilter = key;
    const dictionary = { task_type_name: 'task_type', deadline_name: 'deadline' }[key];
    const orderByValue = new Map(rows.filter(r => !gap(r, key)).map(r => [didValueKey(r[key]),
      key === 'did_client_group' ? r.group_order : dictionary ? sortOrders[dictionary]?.[String(r[key] || '').trim().toLocaleLowerCase('ru-RU')] : null]));
    const values = [...new Set(rows.filter(r => !gap(r, key)).map(r => didValueKey(r[key])))].sort((a, b) => {
      const ao = orderByValue.get(a), bo = orderByValue.get(b);
      if (ao != null || bo != null) return (ao ?? Number.MAX_SAFE_INTEGER) - (bo ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b, 'ru');
      if (key === 'financial_effect') return Number(a) - Number(b);
      return a.localeCompare(b, 'ru');
    });
    const label = DID_COLUMNS.find(c => c[0] === key)[1];
    const panel = document.createElement('div'); panel.className = 'did-filter-panel ui-filter-popover';
    panel.innerHTML = `<div class="ui-popover-header ui-popover-title">${escapeHtml(label)}</div><div class="ui-popover-field"><input class="input ui-control" type="search" placeholder="Поиск значения…" aria-label="Поиск значения"></div><div class="ui-filter-options">${selectionList({items:values.map(value=>({value,label:key === 'financial_effect' ? Number(value).toLocaleString('ru-RU', {minimumFractionDigits:1,maximumFractionDigits:1}) : value})),selected:prefs.filters[key] || []})}</div><div class="ui-popover-actions"><button type="button" class="btn btn-secondary btn-sm ui-btn" data-did-filter-clear>Очистить</button><button type="button" class="btn btn-primary btn-sm ui-btn" data-did-filter-apply>Применить</button></div>`;
    filterPopover = createPopover({trigger:button,panel,label:`Фильтр: ${label}`,removeOnClose:true,
      resolveTrigger:()=>root.querySelector(`[data-did-filter="${key}"]`) || button,
      onClose:()=>{openFilter=null;filterPopover=null;}});
    panel.querySelector('input[type=search]').oninput = event => filterSelectionList(panel.querySelector('.ui-selection-list'),event.target.value);
    panel.querySelector('[data-did-filter-clear]').onclick = () => panel.querySelectorAll('input[type=checkbox]').forEach(input=>{input.checked=false;});
    panel.querySelector('[data-did-filter-apply]').onclick = () => {
      prefs.filters[key] = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(el=>el.value);
      closeFilter(); render(); persist();
      root.querySelector(`[data-did-filter="${key}"]`)?.focus();
    };
    filterPopover.open();
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
    else if (button?.dataset.didRemoveFilter) { delete prefs.filters[button.dataset.didRemoveFilter]; render(); persist(); }
    else if (button?.hasAttribute('data-did-widths')) { prefs.widths = defaultDidPrefs(prefs.quarter).widths; render(); persist(); }
    else if (button?.hasAttribute('data-did-reset')) {
      ++saveVersion; loading = true; controls();
      try { await saveQueue; await app.api.delete(`${ENDPOINT}/preferences`); saved = false; saveError = false; }
      catch { saveError = true; }
      prefs = defaultDidPrefs(calendar.current_quarter); await load();
    } else if (!event.target.closest('thead, .did-filter-panel')) {
      const row = event.target.closest('[data-did-task]');
      if (row) { try { const { openTaskModal, setOnTaskSaved } = await import('./modal.js?v=118'); const task = await app.api.get(`/tasks/${row.dataset.didTask}`); setOnTaskSaved(() => { if (alive()) load(); }); openTaskModal(task); } catch (error) { window.toast?.(error.message, 'error'); } }
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
