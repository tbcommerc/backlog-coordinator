import { button as uiButton, control as uiControl, field as uiField, icon as uiIcon } from '../ui/primitives.js';
import { escapeHtml as escapeText } from '../htmlUtils.js';

/** Рендеринг карточек административных справочников. */
function competencyCostCardData(adminData) {
  const items = adminData.competencyCosts || [];
  const byComp = {};
  items.forEach(i => {
    if (!byComp[i.competency]) byComp[i.competency] = {};
    byComp[i.competency][i.year] = i.rate;
  });
  const competencies = Object.keys(byComp).sort();
  const preview = competencies.slice(0, 3).map(comp => {
    const rates = byComp[comp];
    const latestYear = Math.max(...Object.keys(rates).map(Number));
    return { name: comp, code: String(rates[latestYear]) };
  });
  return { count: competencies.length, preview };
}

export function renderDictionariesTab(adminData, dictLocks, escapeHtml) {
  const ccCard = competencyCostCardData(adminData);
  const dicts = [
    { key: 'did-client-groups', dictType: 'did-client-groups', label: 'Клиенты ДИД', icon: 'building', count: '—', preview: [] },
    { key: 'priorities', dictType: 'priority', label: 'Приоритеты', icon: 'flag', count: (adminData.priorities || []).length, preview: (adminData.priorities || []).slice(0, 3) },
    { key: 'statuses', dictType: 'status', label: 'Статусы задачи', icon: 'circle', count: (adminData.statuses || []).length, preview: (adminData.statuses || []).slice(0, 3) },
    { key: 'taskTypes', dictType: 'task_type', label: 'Типы задач', icon: 'tag', count: (adminData.taskTypes || []).length, preview: (adminData.taskTypes || []).slice(0, 3) },
    { key: 'channels', dictType: 'channel', label: 'Каналы', icon: 'radio', count: (adminData.channels || []).length, preview: (adminData.channels || []).slice(0, 3) },
    { key: 'deadlines', dictType: 'deadline', label: 'Сроки', icon: 'clock', count: (adminData.deadlines || []).length, preview: (adminData.deadlines || []).slice(0, 3) },
    { key: 'departments', dictType: 'department', label: 'Подразделения', icon: 'building', count: (adminData.departments || []).length, preview: (adminData.departments || []).slice(0, 3) },
    { key: 'teamTypes', dictType: 'team_type', label: 'Типы команд', icon: 'layers', count: (adminData.teamTypes || []).length, preview: (adminData.teamTypes || []).slice(0, 3) },
    { key: 'projectStatuses', dictType: 'project_status', label: 'Статусы проектов', icon: 'git-branch', count: (adminData.projectStatuses || []).length, preview: (adminData.projectStatuses || []).slice(0, 3) },
    { key: 'competencyCosts', dictType: 'competency_cost', label: 'Стоимость компетенций', icon: 'coins', count: ccCard.count, preview: ccCard.preview, showRate: true },
    { key: 'tags', dictType: 'tag', label: 'Теги', icon: 'tags', count: (adminData.tags || []).length, preview: (adminData.tags || []).slice(0, 3) },
  ];

  const cards = dicts.map(d => {
    const lock = dictLocks[d.dictType];
    const isLocked = lock && lock.locked && !lock.is_mine;
    const isMine = lock && lock.locked && lock.is_mine;
    const lockBanner = isLocked
      ? `<div style="position:absolute;top:0;left:0;right:0;padding:4px 12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-size:var(--type-meta-size);line-height:var(--type-meta-line);font-weight:600;border-radius:12px 12px 0 0;text-align:center;z-index:1">
          <i data-lucide="lock" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px"></i>
          Редактируется: ${escapeHtml(lock.lock_owner_name || 'Администратор')}
        </div>`
      : '';
    const previewItems = d.preview.map(v => {
      const label = d.showRate && v.code ? `${v.name}: ${v.code}` : v.name;
      const color = /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '';
      return color
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);background:${color}20;color:${color};margin:2px">${escapeHtml(label)}</span>`
        : `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);background:var(--bg-tertiary);color:var(--text-muted);margin:2px">${escapeHtml(label)}</span>`;
    }).join('');
    return `
      <div class="card rounded-xl p-5 card-hover admin-dict-card${isLocked ? ' dict-locked' : ''}" data-dict="${d.key}" role="button" tabindex="0" aria-label="${escapeHtml(d.label)}" aria-disabled="${Boolean(isLocked)}" style="cursor:${isLocked ? 'default' : 'pointer'};height:${isLocked ? '220' : '200'}px;position:relative;${isLocked ? 'opacity:0.85' : ''}">
        ${lockBanner}
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px${lockBanner ? ';margin-top:20px' : ''}">
          <div style="width:40px;height:40px;border-radius:10px;background:${isLocked ? '#f59e0b20' : 'var(--bg-tertiary)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i data-lucide="${isLocked ? 'lock' : d.icon}" style="width:18px;height:18px;color:${isLocked ? '#f59e0b' : 'var(--accent)'}"></i>
          </div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${d.label}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${d.count} значений</div>
          </div>
          ${isMine ? '<span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);background:var(--success-light);color:var(--success);padding:2px 6px;border-radius:4px">Вы редактируете</span>' : '<i data-lucide="chevron-right" style="width:16px;height:16px;color:var(--text-muted)"></i>'}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${previewItems || '<span style="font-size:12px;color:var(--text-muted)">Нет значений</span>'}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="admin-action-row admin-list-action-row"><div><strong style="font-size:13px;color:var(--text-primary)">Справочники системы</strong><div style="margin-top:2px;font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-muted)">${dicts.length} групп значений</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${cards}</div>
  `;
}

export const DICTIONARY_CONFIG = Object.freeze({
  priorities: { type: 'priority', endpoint: 'priorities', dataKey: 'priorities', label: 'Приоритеты' },
  statuses: { type: 'status', endpoint: 'statuses', dataKey: 'statuses', label: 'Статусы задачи' },
  taskTypes: { type: 'task_type', endpoint: 'task-types', dataKey: 'taskTypes', label: 'Типы задач' },
  channels: { type: 'channel', endpoint: 'channels', dataKey: 'channels', label: 'Каналы' },
  deadlines: { type: 'deadline', endpoint: 'deadlines', dataKey: 'deadlines', label: 'Сроки' },
  departments: { type: 'department', endpoint: 'departments', dataKey: 'departments', label: 'Подразделения' },
  teamTypes: { type: 'team_type', endpoint: 'team-types', dataKey: 'teamTypes', label: 'Типы команд' },
  projectStatuses: { type: 'project_status', endpoint: 'project-statuses', dataKey: 'projectStatuses', label: 'Статусы проектов' },
  competencyCosts: { type: 'competency_cost', endpoint: 'competency-costs', dataKey: 'competencyCosts', label: 'Стоимость компетенций' },
  tags: { type: 'tag', endpoint: 'tags', dataKey: 'tags', label: 'Теги' },
});

let dictionaryRowSequence = 0;

export function renderDictionaryRowAction(active, isNew = false) {
  return uiButton({ label: !active ? 'Восстановить' : isNew ? 'Удалить новую строку' : 'Архивировать', icon: !active ? 'rotate-ccw' : isNew ? 'x' : 'archive', iconOnly: true, variant: 'ghost', size: 'small', className: (active ? 'dict-remove-btn' : 'dict-restore-btn') + ' dict-row-action' });
}

// Existing and draft rows share labels, error IDs, controls and actions.
export function renderDictionaryRow(item, { dictKey, safeHexColor, autoDictColor, dictCodePlaceholder, isNew = false }) {
  const id = `dict-row-${++dictionaryRowSequence}`;
  const active = item.is_active !== false;
  const color = safeHexColor(item.color, autoDictColor(item.name));
  const usage = Number(item.usage_count || 0);
  return `<div class="dict-editor-row${active ? '' : ' is-archived'}${isNew ? ' is-dirty is-new' : ''}" draggable="${active}" data-item-id="${escapeText(item.id || '')}" data-active="${active}" data-usage="${usage}" data-original-name="${escapeText(item.name || '')}" data-original-code="${escapeText(item.code || '')}">
    ${uiButton({ label: 'Изменить порядок', icon: 'grip-vertical', iconOnly: true, variant: 'ghost', size: 'small', className: 'dict-drag-handle', attrs: { disabled: !active, title: 'Перетащить или переместить стрелками вверх/вниз' } })}
    <input type="hidden" class="dict-color-input" value="${color}">
    ${uiButton({ label: 'Выбрать цвет', iconMarkup: `<span class="dict-color-dot" style="background:${color}" aria-hidden="true"></span>`, iconOnly: true, variant: 'ghost', size: 'small', className: 'dict-color-swatch', attrs: { disabled: !active, 'aria-haspopup': 'dialog', 'aria-expanded': false } })}
    ${uiField({ id: id + '-name', label: 'Название', value: item.name || '', disabled: !active, error: 'Введите название', errorHidden: true, errorClassName: 'dict-row-error', className: 'dict-editor-field', controlClassName: 'dict-value-input', attrs: { placeholder: 'Значение' } })}
    ${uiField({ id: id + '-code', label: 'Код', value: item.code || '', disabled: !active, error: 'Проверьте код', errorHidden: true, errorClassName: 'dict-row-error', className: 'dict-editor-field dict-code-field', controlClassName: 'dict-code-input', attrs: { placeholder: dictCodePlaceholder(dictKey) } })}
    <span class="dict-usage-badge" title="Количество связанных записей">${uiIcon('link')}${usage}</span>
    <span class="dict-row-state">${!active ? 'В архиве' : isNew ? 'Новое' : ''}</span>
    ${renderDictionaryRowAction(active, isNew)}
  </div>`;
}

export function renderCompetencyRateControl({ competency, year, id = '', rate = '' }) {
  return uiControl({ value: rate, className: 'comp-cost-input', attrs: { 'data-comp': competency, 'data-year': year, 'data-id': id, placeholder: '0', 'aria-label': `${competency}, ${year}, рублей в день` } });
}

export function renderDictionaryForm(data, helpers) {
  if (data.dictKey === 'competencyCosts') return renderCompetencyCostDictionaryForm(data, helpers.escapeHtml);
  const { escapeHtml } = helpers;
  const renderRow = item => renderDictionaryRow(item, { ...helpers, dictKey: data.dictKey });
  const activeItems = (data.items || []).filter(item => item.is_active !== false).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const archivedItems = (data.items || []).filter(item => item.is_active === false).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const list = activeItems.map(renderRow).join('');
  const archive = archivedItems.map(renderRow).join('');
  return `
    <div class="dict-editor-head"><div><h4>${escapeHtml(data.dictLabel)}</h4><p>Изменения вступят в силу после сохранения. Перетащите строку или используйте стрелки вверх/вниз на кнопке изменения порядка.</p></div><div class="dict-editor-stats" role="status" aria-live="polite"><span><strong id="dict-active-count">${activeItems.length}</strong> активных</span><span><strong id="dict-archive-count">${archivedItems.length}</strong> в архиве</span><span><strong id="dict-pending-count">0</strong> изменений</span></div></div>
    <div class="dict-editor-toolbar"><div class="admin-list-search">${uiIcon('search')}${uiControl({ id: 'dict-search', type: 'search', value: data.viewSearch || '', attrs: { placeholder: 'Поиск по названию или коду', autocomplete: 'off', 'aria-label': 'Поиск значений' } })}</div>${uiButton({ label: 'Добавить значение', icon: 'plus', variant: 'primary', size: 'small', attrs: { id: 'dict-add-value' } })}</div>
    <div id="dict-search-result" role="status" hidden><span></span><button type="button" class="btn btn-ghost btn-sm" id="dict-search-reset">Сбросить поиск</button></div>
    <div class="dict-validation-summary" id="dict-validation-summary" role="alert" hidden></div>
    <div id="dict-items-container" class="dict-editor-list">${list || '<p class="dict-empty-state">Нет активных значений</p>'}</div>
    <details class="dict-archive"${data.archiveOpen ? ' open' : ''}${archivedItems.length ? '' : ' hidden'} id="dict-archive"><summary class="ui-disclosure-text">Архив <span id="dict-archive-summary-count">${archivedItems.length}</span></summary><div id="dict-archive-container" class="dict-editor-list">${archive}</div></details>`;
}

export function renderCompetencyCostDictionaryForm(data, escapeHtml = String) {
  const items = data.items || [];
  const competencies = [...new Set(items.map(item => item.competency))].sort();
  const years = [...new Set(items.map(item => item.year))].sort((a, b) => a - b);
  const header = `<th style="text-align:left">Компетенция</th>${years.map(year => `<th data-year="${year}" style="text-align:center">${year}</th>`).join('')}`;
  const rows = competencies.map(comp => {
    const cells = years.map(year => {
      const item = items.find(candidate => candidate.competency === comp && candidate.year === year);
      return `<td class="competency-rate-cell">${renderCompetencyRateControl({ competency: comp, year, id: item?.id || '', rate: item?.rate ?? '' })}</td>`;
    }).join('');
    return `<tr><td style="font-weight:500">${escapeHtml(comp)}</td>${cells}</tr>`;
  }).join('');
  return `
    <h4 style="font-size:14px;font-weight:600;margin-bottom:8px">${escapeHtml(data.dictLabel)}</h4>
    <p class="text-muted" style="font-size:12px;margin-bottom:12px">Ставки (руб/день) по годам. Для задачи берётся ставка года её дедлайна; без дедлайна — ставка последнего (актуального) года. Очистка ячейки удаляет ставку, сохранённые effort_rub задач пересчитаются.</p>
    <div class="ui-table-scroll ui-table-surface"><table class="ui-table ui-table-admin" id="comp-cost-table" style="border-collapse:collapse;min-width:100%"><thead><tr style="border-bottom:1px solid var(--border-color)">${header}</tr></thead><tbody>${rows || '<tr><td  class="text-muted">Нет значений</td></tr>'}</tbody></table></div>
    <div class="cc-inline-editor" id="cc-inline-editor" hidden>
      <label class="form-label" id="cc-inline-label" for="cc-inline-value"></label>
      <div class="cc-inline-editor-row">
        ${uiControl({ id: 'cc-inline-value', attrs: { 'aria-describedby': 'cc-inline-error' } })}
        ${uiButton({ label: 'Добавить', variant: 'primary', size: 'small', attrs: { id: 'cc-inline-confirm' } })}
        ${uiButton({ label: 'Отмена', variant: 'ghost', size: 'small', attrs: { id: 'cc-inline-cancel' } })}
      </div>
      <p class="cc-inline-error" id="cc-inline-error" role="alert" aria-live="polite"></p>
    </div>
    <div class="cc-add-actions">${uiButton({ label: 'Добавить год', icon: 'plus', size: 'small', attrs: { id: 'cc-add-year' } })}${uiButton({ label: 'Добавить компетенцию', icon: 'plus', size: 'small', attrs: { id: 'cc-add-competency' } })}</div>`;
}

export function getDictionaryChanges(items, originalItems) {
  const validItems = items.filter(item => item.name.trim());
  const originalIds = new Set(originalItems.filter(item => item.id).map(item => item.id));
  const retainedIds = new Set(validItems.filter(item => item.id).map(item => item.id));
  return { validItems, deleteIds: [...originalIds].filter(id => !retainedIds.has(id)) };
}

export async function persistDictionaryItems(app, dictKey, validItems, version) {
  const config = DICTIONARY_CONFIG[dictKey];
  if (!config) throw new Error('Неизвестный справочник');
  return app.api.put(`/admin/dictionaries/${config.type}/batch`, {
    version,
    items: validItems.map((item, index) => ({
      id: item.id || null,
      name: item.name.trim(),
      code: (item.code || '').trim() || null,
      color: item.color || '#6366f1',
      sort_order: index,
    })),
  });
}

export async function acquireDictionaryLock(app, dictKey) {
  const config = DICTIONARY_CONFIG[dictKey];
  if (!config) throw new Error('Неизвестный справочник');
  const lock = await app.api.post(`/admin/${config.type}/lock`);
  return { type: config.type, version: lock.version || 0 };
}

export async function releaseDictionaryLock(app, dictType) {
  if (dictType) await app.api.delete(`/admin/${dictType}/lock`);
}
