import { button as uiButton, control as uiControl, field as uiField, tab as uiTab } from '../ui/primitives.js';
import { renderPriority, renderStatus } from './reports.js?v=43';

export function getReportFields() {
  const fl = globalThis.window?.app?.fieldLabels || {};
  return [
  { key: 'id', label: fl.id || 'ID' },
  { key: 'title', label: fl.title || 'Название задачи' },
  { key: 'description', label: fl.description || 'Описание' },
  { key: 'team_name', label: fl.team_id || 'Команда' },
  { key: 'priority_name', label: fl.priority_id || 'Приоритет' },
  { key: 'status_name', label: fl.status_id || 'Статус' },
  { key: 'project_name', label: fl.project_id || 'Проект' },
  { key: 'business_customer_name', label: 'Бизнес-заказчик — название из справочника' },
  { key: 'department_name', label: fl.department_id || 'Подразделение' },
  { key: 'channel_name', label: fl.channel_id || 'Канал поступления' },
  { key: 'task_type_name', label: fl.task_type_id || 'Тип задачи' },
  { key: 'deadline_name', label: fl.deadline_id || 'Дедлайн' },
  { key: 'owner_name', label: fl.owner_id || 'Исполнитель' },
  { key: 'progress', label: fl.progress || 'Прогресс' },
  { key: 'effort_days', label: fl.effort_days || 'Трудозатраты (дни)' },
  { key: 'effort_rub', label: fl.effort_rub || 'Трудозатраты (руб)' },
  { key: 'financial_effect', label: fl.financial_effect || 'Фин. эффект' },
  { key: 'cv', label: fl.cv || 'C/V' },
  { key: 'priority_score', label: fl.priority_score || 'Priority Score' },
  { key: 'key_project_status', label: fl.key_project_status || 'Статус ключ. проекта' },
  { key: 'directorate_status', label: fl.directorate_status || 'Статус для директорской' },
  { key: 'did_status', label: fl.did_status || 'Статус для ДИД' },
  { key: 'involved_teams', label: fl.involved_teams || 'Вовлечённые команды' },
  { key: 'did_demo', label: fl.did_demo || 'Демо на оперативке' },
  { key: 'date_received', label: 'Дата получения' },
  { key: 'created_at', label: fl.created_at || 'Дата создания' },
  { key: 'updated_at', label: fl.updated_at || 'Дата обновления' },
  ];
}

export const REPORT_GROUP_OPTIONS = [
  { value: '', label: 'Без группировки' },
  { value: 'team_name', label: 'По командам' },
  { value: 'project_name', label: 'По проектам' },
  { value: 'status_name', label: 'По статусам' },
  { value: 'priority_name', label: 'По приоритетам' },
  { value: 'department_name', label: 'По подразделениям' },
];

const REPORT_SORT_FIELDS = [
  { value: '', label: 'Без сортировки' },
  { value: 'title', label: 'По названию' },
  { value: 'priority_name', label: 'По приоритету' },
  { value: 'status_name', label: 'По статусу' },
  { value: 'team_name', label: 'По команде' },
  { value: 'project_name', label: 'По проекту' },
  { value: 'progress', label: 'По прогрессу' },
  { value: 'financial_effect', label: 'По фин. эффекту' },
  { value: 'cv', label: 'По C/V' },
  { value: 'created_at', label: 'По дате создания' },
];

export const scriptManagedReportKeys = ['directorate', 'did-operational', 'pip', 'progress', 'did-backlog'];
const BOOLEAN_REPORT_FIELDS = ['did_demo'];
const NUMBER_REPORT_FIELDS = new Set(['id','progress','effort_days','effort_rub','financial_effect','cv','priority_score']);
const DATE_REPORT_FIELDS = new Set(['date_received','created_at','updated_at']);

function reportFieldType(field) {
  if (BOOLEAN_REPORT_FIELDS.includes(field)) return 'boolean';
  if (NUMBER_REPORT_FIELDS.has(field)) return 'number';
  if (DATE_REPORT_FIELDS.has(field)) return 'date';
  return 'text';
}

function reportOperators(field) {
  const type = reportFieldType(field);
  if (type === 'number' || type === 'date') return [['equals','Равно'],['not_equals','Не равно'],['gt','Больше/позже'],['lt','Меньше/раньше']];
  if (type === 'boolean') return [['equals','Равно'],['not_equals','Не равно']];
  return [['equals','Равно'],['not_equals','Не равно'],['contains','Содержит'],['in','В списке']];
}

export function parseReportJson(str) {
  if (!str) return null;
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return null; }
}

function escapeReportValue(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function renderReportForm(data, mode, escapeHtml) {
  const existingFields = [...new Set((parseReportJson(data.fields) || []).map(key => key === 'business_customer' ? 'business_customer_name' : key))];
  const existingFilters = (parseReportJson(data.filters) || []).map(filter => ({ ...filter, field: filter.field === 'business_customer' ? 'business_customer_name' : filter.field }));
  const fields = getReportFields();
  const selected = existingFields.map(key => fields.find(field => field.key === key) || { key, label: `Неизвестное поле: ${key}`, legacy: true });
  const availableFields = fields.map(field => `<label class="report-field-option" data-search="${escapeReportValue(field.label.toLowerCase())}">
    <input type="checkbox" class="report-field-cb" value="${field.key}"${existingFields.includes(field.key) ? ' checked' : ''}> <span>${escapeReportValue(field.label)}</span>
  </label>`).join('');
  const selectedFields = selected.map(field => `<div class="report-selected-field${field.legacy ? ' is-legacy' : ''}" data-field="${escapeReportValue(field.key)}">
    <span class="report-selected-drag" aria-hidden="true">⋮⋮</span><span>${escapeReportValue(field.label)}</span>
    <span class="report-selected-actions"><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn report-field-up" aria-label="Переместить вверх">↑</button><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn report-field-down" aria-label="Переместить вниз">↓</button></span>
  </div>`).join('');
  const filterRows = existingFilters.map((filter, index) => renderFilterRow(filter, index)).join('');

  const isScriptManaged = scriptManagedReportKeys.includes(data.key);
  return `
    <div class="report-wizard" data-step="1" data-script-managed="${isScriptManaged}">
      ${data.type === 'standard' ? `<div class="report-system-badge">Системный отчёт${data.key ? ` · ${escapeReportValue(data.key)}` : ''}</div>` : ''}
      <div class="report-wizard-steps" role="tablist" aria-label="Шаги настройки отчёта">
        ${['Основное','Поля','Фильтры','Сортировка'].map((label,index) => uiTab({ id: 'report-step-' + (index + 1), label: (index + 1) + '. ' + label, panelId: 'report-panel-' + (index + 1), selected: index === 0, disabled: isScriptManaged && index > 0, className: 'report-step' + (index === 0 ? ' active' : ''), attrs: { 'data-report-step': index + 1 } })).join('')}
      </div>
      <div class="report-wizard-layout"><div class="report-wizard-main">
        <section class="report-step-panel active" data-report-panel="1" id="report-panel-1" role="tabpanel" aria-labelledby="report-step-1">
          <div id="report-form-error" class="report-form-error" hidden></div>
          ${uiField({ id: 'report-name', label: 'Название отчёта', value: data.name || '', required: true, controlClassName: 'modal-field', attrs: { placeholder: 'Например: Задачи команды' } })}
          ${uiField({ id: 'report-description', label: 'Описание', kind: 'textarea', value: data.description || '', controlClassName: 'modal-field', attrs: { rows: 3, placeholder: 'Для чего нужен отчёт' } })}
          ${uiField({ id: 'report-is-public', label: 'Видимость', kind: 'select', value: data.is_public === true, options: [{ value: false, label: 'Только я' }, { value: true, label: 'Все пользователи' }], controlClassName: 'modal-field' })}
          ${isScriptManaged ? '<div class="report-managed-notice">Поля, фильтры и группировка управляются системным сценарием. Можно изменить только название, описание и видимость.</div>' : ''}
        </section>
        <section class="report-step-panel" data-report-panel="2" id="report-panel-2" role="tabpanel" aria-labelledby="report-step-2" hidden>
          ${uiControl({ id: 'report-field-search', type: 'search', attrs: { placeholder: 'Найти поле…', 'aria-label': 'Поиск полей' } })}
          <div class="report-fields-actions">${uiButton({ label: 'Выбрать всё', variant: 'ghost', size: 'small', attrs: { id: 'report-fields-all' } })}${uiButton({ label: 'Очистить', variant: 'ghost', size: 'small', attrs: { id: 'report-fields-clear' } })}</div>
          <div class="report-fields-layout"><div class="report-fields-available">${availableFields}</div><div><h4>Выбранные поля и порядок</h4><div id="report-selected-fields" class="report-selected-fields">${selectedFields || '<p class="text-muted report-no-fields">Поля не выбраны</p>'}</div></div></div>
        </section>
        <section class="report-step-panel" data-report-panel="3" id="report-panel-3" role="tabpanel" aria-labelledby="report-step-3" hidden><p class="text-muted">Условия объединяются оператором «И».</p><div id="report-filters-container">${filterRows}</div>${uiButton({ label: 'Добавить фильтр', variant: 'secondary', size: 'small', icon: 'plus', attrs: { id: 'report-add-filter' } })}</section>
        <section class="report-step-panel" data-report-panel="4" id="report-panel-4" role="tabpanel" aria-labelledby="report-step-4" hidden><div class="report-sort-grid">${uiField({ id: 'report-group-by', label: 'Группировка', kind: 'select', value: data.group_by || '', options: REPORT_GROUP_OPTIONS, controlClassName: 'modal-field' })}${uiField({ id: 'report-sort-by', label: 'Сортировка', kind: 'select', value: data.sort_by || '', options: REPORT_SORT_FIELDS, controlClassName: 'modal-field' })}</div><div id="report-sort-order-group" style="${data.sort_by ? '' : 'display:none'}">${uiField({ id: 'report-sort-order', label: 'Направление', kind: 'select', value: data.sort_order || 'asc', options: [{ value: 'asc', label: 'По возрастанию' }, { value: 'desc', label: 'По убыванию' }], controlClassName: 'modal-field' })}</div></section>
      </div><aside class="report-wizard-preview"><h4>Структура отчёта</h4><div id="report-preview-summary"></div></aside></div>
      <div class="report-wizard-nav">${uiButton({ label: 'Назад', attrs: { id: 'report-step-prev', disabled: true } })}${uiButton({ label: 'Далее', variant: 'primary', attrs: { id: 'report-step-next', hidden: isScriptManaged } })}</div>
    </div>
  `;
}

export function renderFilterRow(filter, index) {
  const field = filter.field || getReportFields()[0].key;
  const type = reportFieldType(field);
  const value = Array.isArray(filter.value) ? filter.value.join(', ') : (filter.value ?? '');
  return `<div class="report-filter-row" data-filter-index="${index}" data-field-type="${type}">
    ${uiControl({ kind: 'select', value: field, options: getReportFields().map(item => ({ value: item.key, label: item.label })), className: 'report-filter-field', attrs: { 'aria-label': 'Поле фильтра' } })}
    ${uiControl({ kind: 'select', value: filter.operator || 'equals', options: reportOperators(field).map(([value, label]) => ({ value, label })), className: 'report-filter-op', attrs: { 'aria-label': 'Условие фильтра' } })}
    ${uiControl({ kind: type === 'boolean' ? 'select' : 'input', type, value: type === 'boolean' && value === '' ? true : value, options: [{ value: true, label: 'Да' }, { value: false, label: 'Нет' }], className: 'report-filter-value', attrs: { placeholder: 'Значение', 'aria-label': 'Значение фильтра' } })}
    ${uiButton({ label: 'Удалить фильтр', icon: 'x', iconOnly: true, variant: 'ghost', size: 'small', className: 'report-filter-remove' })}
  </div>`;
}

export function getReportPayload(modalData, documentRef = document) {
  const isScriptManaged = scriptManagedReportKeys.includes(modalData && modalData.key);
  const orderedFields = Array.from(documentRef.querySelectorAll('.report-selected-field[data-field]')).map(row => row.dataset.field);
  const selectedFields = orderedFields.length ? orderedFields : Array.from(documentRef.querySelectorAll('.report-field-cb:checked')).map(cb => cb.value);
  const filterRows = documentRef.querySelectorAll('.report-filter-row');
  const filters = Array.from(filterRows).map(row => {
    const field = row.querySelector('.report-filter-field')?.value;
    const operator = row.querySelector('.report-filter-op')?.value || 'equals';
    const rawValue = row.querySelector('.report-filter-value')?.value || '';
    let value = rawValue;
    if (operator === 'in') {
      value = rawValue.split(',').map(s => s.trim()).filter(Boolean);
    } else if ((operator === 'gt' || operator === 'lt') && reportFieldType(field) === 'number') {
      const num = parseFloat(rawValue);
      value = Number.isNaN(num) ? rawValue : num;
    } else if (BOOLEAN_REPORT_FIELDS.includes(field) && typeof rawValue === 'string') {
      const t = rawValue.trim().toLowerCase();
      if (t === 'true' || t === '1') value = true;
      else if (t === 'false' || t === '0') value = false;
    }
    return { field, operator, value };
  }).filter(f => {
    if (!f.field) return false;
    if (f.operator === 'not_equals') return true;
    if (Array.isArray(f.value)) return f.value.length > 0;
    return f.value !== '' && f.value !== null && f.value !== undefined;
  });

  if (isScriptManaged) {
    return {
      name: documentRef.getElementById('report-name')?.value || '',
      description: documentRef.getElementById('report-description')?.value || null,
      is_public: documentRef.getElementById('report-is-public')?.value === 'true',
      fields: (modalData && modalData.fields) || null,
      filters: (modalData && modalData.filters) || null,
      group_by: (modalData && modalData.group_by) || null,
      sort_by: (modalData && modalData.sort_by) || null,
      sort_order: (modalData && modalData.sort_order) || 'asc',
    };
  }

  return {
    name: documentRef.getElementById('report-name')?.value || '',
    description: documentRef.getElementById('report-description')?.value || null,
    is_public: documentRef.getElementById('report-is-public')?.value === 'true',
    fields: selectedFields.length ? JSON.stringify(selectedFields) : null,
    filters: filters.length ? JSON.stringify(filters) : null,
    group_by: documentRef.getElementById('report-group-by')?.value || null,
    sort_by: documentRef.getElementById('report-sort-by')?.value || null,
    sort_order: documentRef.getElementById('report-sort-order')?.value || 'asc',
  };
}

export function validateReportForm(modalData, documentRef = document) {
  const errors = [];
  if (!(documentRef.getElementById('report-name')?.value || '').trim()) errors.push({ step: 1, message: 'Введите название отчёта' });
  if (!scriptManagedReportKeys.includes(modalData?.key)) {
    const fields = Array.from(documentRef.querySelectorAll('.report-selected-field[data-field]'));
    if (!fields.length) errors.push({ step: 2, message: 'Выберите хотя бы одно поле' });
    for (const row of documentRef.querySelectorAll('.report-filter-row')) {
      const field = row.querySelector('.report-filter-field')?.value;
      const type = reportFieldType(field);
      const operator = row.querySelector('.report-filter-op')?.value || 'equals';
      const value = row.querySelector('.report-filter-value')?.value ?? '';
      if (!String(value).trim()) errors.push({ step: 3, message: 'Заполните или удалите пустой фильтр' });
      if (type === 'number' && value !== '' && !Number.isFinite(Number(value))) errors.push({ step: 3, message: 'Числовой фильтр содержит некорректное значение' });
      if (!reportOperators(field).some(([candidate]) => candidate === operator)) errors.push({ step: 3, message: 'Оператор не соответствует типу поля' });
    }
  }
  return errors;
}

export function updateReportFilterRow(row) {
  if (!row) return;
  const field = row.querySelector('.report-filter-field')?.value || 'id';
  const previousValue = row.querySelector('.report-filter-value')?.value || '';
  const replacement = renderFilterRow({ field, operator: 'equals', value: previousValue }, Number(row.dataset.filterIndex || 0));
  const holder = document.createElement('div');
  holder.innerHTML = replacement.trim();
  row.replaceWith(holder.firstElementChild);
}

function adminReportCell(f, item) {
  let val = item[f];
  if (val === null || val === undefined) val = '—';
  if (typeof val === 'boolean') val = val ? 'Да' : 'Нет';
  if (f === 'progress' && val !== '—') {
    const p = Number(val) || 0;
    val = `<div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden"><div style="width:${p}%;height:100%;background:${p >= 100 ? 'var(--success)' : p > 0 ? 'var(--warning)' : 'var(--border-color)'}"></div></div><span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);">${p}%</span></div>`;
  } else if (f === 'cv' && val !== '—') val = `<span style="font-weight:600;color:${val >= 2 ? 'var(--success)' : val >= 1 ? 'var(--warning)' : 'var(--danger)'}">${val}</span>`;
  else if (f === 'financial_effect' && val !== '—') val = `${val} млн ₽`;
  else if (f === 'effort_rub' && val !== '—') val = `${val} тыс ₽`;
  else if (f === 'priority_name') val = val === '—' ? '—' : renderPriority(val);
  else if (f === 'status_name') val = val === '—' ? '—' : renderStatus(val);
  return val;
}

export async function executeAdminReport(reportId, app, report, escapeHtml) {
  const resultEl = document.getElementById('report-execution-result');
  if (!resultEl) return;
  resultEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)"><i data-lucide="loader" style="width:24px;height:24px;animation:spin 1s linear infinite;display:block;margin:0 auto 8px"></i>Выполнение отчёта...</div>';
  if (window.lucide) lucide.createIcons();

  try {
    const data = await app.api.get(`/reports/${reportId}/execute`);
    const items = data.items || [];
    const grouped = data.grouped;

    if (!items.length) {
      resultEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Нет задач, соответствующих фильтрам</div>';
      return;
    }

      const displayFields = parseReportJson(report.fields) || getReportFields().slice(0, 8).map(f => f.key);

    const headers = displayFields.map(f => {
      const def = getReportFields().find(rf => rf.key === f);
      return `<th style="text-align:left;white-space:nowrap">${def ? def.label : f}</th>`;
    }).join('');

    const rows = items.map(item => {
      const cells = displayFields.map(f => `<td style="color:var(--text-primary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${adminReportCell(f, item)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    let html = '';

    if (grouped && data.groups) {
      html = `<div style="padding:8px 0;font-size:12px;color:var(--text-muted)">${items.length} задач · ${data.groups.length} групп · Группировка по «${escapeReportValue(data.group_field)}»</div>`;
      data.groups.forEach(grp => {
        html += `
          <div class="card" style="margin-bottom:12px;overflow:hidden">
            <div style="padding:10px 14px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-color)">
              <strong style="font-size:13px;color:var(--text-primary)">${escapeHtml(grp.name)}</strong>
              <span class="badge badge-info" style="">${grp.count}</span>
            </div>
            <div class="ui-table-scroll ui-table-surface">
              <table class="ui-table ui-table-admin" style="width:100%;border-collapse:collapse">
                <thead><tr>${headers}</tr></thead>
                <tbody>${grp.items.map(item => {
                  const cells = displayFields.map(f => `<td >${adminReportCell(f, item)}</td>`).join('');
                  return `<tr>${cells}</tr>`;
                }).join('')}</tbody>
              </table>
            </div>
          </div>`;
      });
    } else {
      html = `
        <div style="padding:8px 0;font-size:12px;color:var(--text-muted)">${items.length} задач</div>
        <div class="card" style="overflow:hidden">
          <div class="ui-table-scroll ui-table-surface">
            <table class="ui-table ui-table-admin" style="width:100%;border-collapse:collapse">
              <thead><tr>${headers}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }

    resultEl.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    resultEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)">Ошибка выполнения отчёта: ${escapeHtml(e.message || 'Неизвестная ошибка')}</div>`;
  }
}
