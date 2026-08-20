import { renderPriority, renderStatus } from './reports.js';

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
  { key: 'business_customer', label: fl.business_customer_id || 'Бизнес-заказчик' },
  { key: 'business_customer_name', label: fl.business_customer_id || 'Бизнес-заказчик (имя)' },
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

export const scriptManagedReportKeys = ['directorate', 'did-operational', 'pip', 'progress'];
const BOOLEAN_REPORT_FIELDS = ['did_demo'];

export function parseReportJson(str) {
  if (!str) return null;
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return null; }
}

export function renderReportForm(data, mode, escapeHtml) {
  const isEdit = mode === 'edit';
  const existingFields = parseReportJson(data.fields) || [];
  const existingFilters = parseReportJson(data.filters) || [];

  const fieldCheckboxes = getReportFields().map(f => {
    const checked = existingFields.includes(f.key) ? ' checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;color:var(--text-primary);cursor:pointer">
      <input type="checkbox" class="report-field-cb" value="${f.key}"${checked} style="width:14px;height:14px">
      ${f.label}
    </label>`;
  }).join('');

  const filterRows = existingFilters.map((f, i) => renderFilterRow(f, i)).join('');

  const groupOpts = REPORT_GROUP_OPTIONS.map(g =>
    `<option value="${g.value}"${data.group_by === g.value ? ' selected' : ''}>${g.label}</option>`
  ).join('');

  const sortOpts = REPORT_SORT_FIELDS.map(s =>
    `<option value="${s.value}"${data.sort_by === s.value ? ' selected' : ''}>${s.label}</option>`
  ).join('');

  const standardBadge = data.type === 'standard' ? `
    <div style="margin-bottom:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-size:11px;background:var(--bg-tertiary);color:var(--text-muted);padding:3px 8px;border-radius:6px">Стандартный отчёт</span>
      ${data.key ? `<span style="font-size:11px;background:var(--accent-dim);color:var(--accent);padding:3px 8px;border-radius:6px;font-family:monospace">key: ${data.key}</span>` : ''}
    </div>` : '';

  const isScriptManaged = scriptManagedReportKeys.includes(data.key);
  const scriptNotice = isScriptManaged ? `
    <div style="margin-bottom:16px;padding:10px 12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;color:var(--text-muted);font-size:12px;line-height:1.5">
      Отчёт выполняется по сценарию страницы «Статусы для встреч» — со своей квартальной фильтрацией и группировкой.
      Поля, фильтры и группировка заданы этим сценарием и вручную не настраиваются. Доступно изменение названия и описания.
    </div>` : '';

  return `
    ${standardBadge}
    ${scriptNotice}
    <div class="form-group">
      <label class="form-label">Название отчёта <span class="required">*</span></label>
      <input class="input modal-field" id="report-name" value="${escapeHtml(data.name || '')}" placeholder="Например: Задачи команды">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="input modal-field" id="report-description" rows="2" placeholder="Описание назначения отчёта">${escapeHtml(data.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Видимость</label>
      <select class="input modal-field" id="report-is-public">
        <option value="false"${data.is_public !== true ? ' selected' : ''}>Только я</option>
        <option value="true"${data.is_public === true ? ' selected' : ''}>Все пользователи</option>
      </select>
    </div>

    ${isScriptManaged ? `
    <div style="margin-top:16px;padding:14px;background:var(--bg-tertiary);border:1px dashed var(--border-color);border-radius:8px;color:var(--text-muted);font-size:12px;text-align:center">
      Настройка полей, фильтров и группировки для этого отчёта недоступна.
    </div>` : `
    <div style="margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border-color)">
      <strong style="font-size:13px">Поля для отображения</strong>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Отметьте галочками колонки, которые будут видны в отчёте</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;max-height:200px;overflow-y:auto;padding:4px 0">
      ${fieldCheckboxes}
    </div>

    <div style="margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border-color)">
      <strong style="font-size:13px">Фильтры</strong>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">Настройте условия фильтрации задач. Для оператора «В списке» значения указываются через запятую</div>
    </div>
    <div id="report-filters-container">
      ${filterRows}
    </div>
    <button class="btn btn-secondary btn-sm" id="report-add-filter" style="margin-top:8px">
      <i data-lucide="plus" style="width:12px;height:12px"></i> Добавить фильтр
    </button>

    <div style="margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border-color)">
      <strong style="font-size:13px">Группировка и сортировка</strong>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Группировка</label>
        <select class="input modal-field" id="report-group-by">${groupOpts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Сортировка по</label>
        <select class="input modal-field" id="report-sort-by">${sortOpts}</select>
      </div>
    </div>
    <div class="form-group" id="report-sort-order-group" style="${data.sort_by ? '' : 'display:none'}">
      <label class="form-label">Направление сортировки</label>
      <select class="input modal-field" id="report-sort-order">
        <option value="asc"${data.sort_order !== 'desc' ? ' selected' : ''}>По возрастанию (А→Я)</option>
        <option value="desc"${data.sort_order === 'desc' ? ' selected' : ''}>По убыванию (Я→А)</option>
      </select>
    </div>`}
  `;
}

export function renderFilterRow(filter, index) {
  const fieldOpts = getReportFields().map(f =>
    `<option value="${f.key}"${filter.field === f.key ? ' selected' : ''}>${f.label}</option>`
  ).join('');
  const opOpts = [
    { value: 'equals', label: 'Равно' },
    { value: 'not_equals', label: 'Не равно' },
    { value: 'contains', label: 'Содержит' },
    { value: 'gt', label: 'Больше' },
    { value: 'lt', label: 'Меньше' },
    { value: 'in', label: 'В списке' },
  ].map(o => `<option value="${o.value}"${filter.operator === o.value ? ' selected' : ''}>${o.label}</option>`).join('');

  const value = Array.isArray(filter.value) ? filter.value.join(', ') : (filter.value || '');

  return `
    <div class="report-filter-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px" data-filter-index="${index}">
      <select class="input report-filter-field" style="flex:1;min-width:120px;font-size:12px;padding:5px 8px">${fieldOpts}</select>
      <select class="input report-filter-op" style="width:100px;font-size:12px;padding:5px 8px">${opOpts}</select>
      <input class="input report-filter-value" value="${value.replace(/"/g, '&quot;')}" placeholder="Значение" style="flex:1;min-width:120px;font-size:12px;padding:5px 8px">
      <button class="report-filter-remove" style="padding:4px;border:none;background:transparent;cursor:pointer;color:#f43f5e;border-radius:4px" title="Удалить фильтр">
        <i data-lucide="x" style="width:14px;height:14px"></i>
      </button>
    </div>
  `;
}

export function getReportPayload(modalData, documentRef = document) {
  const isScriptManaged = scriptManagedReportKeys.includes(modalData && modalData.key);
  const selectedFields = Array.from(documentRef.querySelectorAll('.report-field-cb:checked')).map(cb => cb.value);
  const filterRows = documentRef.querySelectorAll('.report-filter-row');
  const filters = Array.from(filterRows).map(row => {
    const field = row.querySelector('.report-filter-field')?.value;
    const operator = row.querySelector('.report-filter-op')?.value || 'equals';
    const rawValue = row.querySelector('.report-filter-value')?.value || '';
    let value = rawValue;
    if (operator === 'in') {
      value = rawValue.split(',').map(s => s.trim()).filter(Boolean);
    } else if (operator === 'gt' || operator === 'lt') {
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

function adminReportCell(f, item) {
  let val = item[f];
  if (val === null || val === undefined) val = '—';
  if (typeof val === 'boolean') val = val ? 'Да' : 'Нет';
  if (f === 'progress' && val !== '—') {
    const p = Number(val) || 0;
    val = `<div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden"><div style="width:${p}%;height:100%;background:${p >= 100 ? 'var(--success)' : p > 0 ? 'var(--warning)' : 'var(--border-color)'}"></div></div><span style="font-size:11px">${p}%</span></div>`;
  } else if (f === 'cv' && val !== '—') val = `<span style="font-weight:600;color:${val >= 2 ? 'var(--success)' : val >= 1 ? 'var(--warning)' : 'var(--danger)'}">${val}</span>`;
  else if (f === 'financial_effect' && val !== '—') val = `${val} млн ₽`;
  else if (f === 'effort_rub' && val !== '—') val = `${val} тыс ₽`;
  else if (f === 'priority_name') val = val === '—' ? '—' : renderPriority(val);
  else if (f === 'status_name') val = val === '—' ? '—' : renderStatus(val);
  return val;
}

export async function executeAdminReport(reportId, app, report, escapeHtml) {
  const resultEl = documentRef.getElementById('report-execution-result');
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
      return `<th style="padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);border-bottom:2px solid var(--border-color);background:var(--bg-tertiary);white-space:nowrap">${def ? def.label : f}</th>`;
    }).join('');

    const rows = items.map(item => {
      const cells = displayFields.map(f => `<td style="padding:8px 10px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-primary);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${adminReportCell(f, item)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    let html = '';

    if (grouped && data.groups) {
      html = `<div style="padding:8px 0;font-size:12px;color:var(--text-muted)">${items.length} задач · ${data.groups.length} групп · Группировка по «${data.group_field}»</div>`;
      data.groups.forEach(grp => {
        html += `
          <div class="card" style="margin-bottom:12px;overflow:hidden">
            <div style="padding:10px 14px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-color)">
              <strong style="font-size:13px;color:var(--text-primary)">${escapeHtml(grp.name)}</strong>
              <span class="badge badge-info" style="font-size:11px">${grp.count}</span>
            </div>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse">
                <thead><tr>${headers}</tr></thead>
                <tbody>${grp.items.map(item => {
                  const cells = displayFields.map(f => `<td style="padding:8px 10px;border-bottom:1px solid var(--border-color);font-size:12px">${adminReportCell(f, item)}</td>`).join('');
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
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
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
