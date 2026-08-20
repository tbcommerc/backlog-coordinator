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
      ? `<div style="position:absolute;top:0;left:0;right:0;padding:4px 12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-size:11px;font-weight:600;border-radius:12px 12px 0 0;text-align:center;z-index:1">
          <i data-lucide="lock" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px"></i>
          Редактируется: ${escapeHtml(lock.lock_owner_name || 'Администратор')}
        </div>`
      : '';
    const previewItems = d.preview.map(v => {
      const label = d.showRate && v.code ? `${v.name}: ${v.code}` : v.name;
      const color = /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '';
      return color
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:${color}20;color:${color};margin:2px">${escapeHtml(label)}</span>`
        : `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:var(--bg-tertiary);color:var(--text-muted);margin:2px">${escapeHtml(label)}</span>`;
    }).join('');
    return `
      <div class="card rounded-xl p-5 card-hover admin-dict-card${isLocked ? ' dict-locked' : ''}" data-dict="${d.key}" style="cursor:${isLocked ? 'default' : 'pointer'};height:${isLocked ? '220' : '200'}px;position:relative;${isLocked ? 'opacity:0.85' : ''}">
        ${lockBanner}
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px${lockBanner ? ';margin-top:20px' : ''}">
          <div style="width:40px;height:40px;border-radius:10px;background:${isLocked ? '#f59e0b20' : 'var(--bg-tertiary)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i data-lucide="${isLocked ? 'lock' : d.icon}" style="width:18px;height:18px;color:${isLocked ? '#f59e0b' : 'var(--accent)'}"></i>
          </div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${d.label}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${d.count} значений</div>
          </div>
          ${isMine ? '<span style="font-size:10px;background:var(--success-light);color:var(--success);padding:2px 6px;border-radius:4px">Вы редактируете</span>' : '<i data-lucide="chevron-right" style="width:16px;height:16px;color:var(--text-muted)"></i>'}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${previewItems || '<span style="font-size:12px;color:var(--text-muted)">Нет значений</span>'}</div>
      </div>
    `;
  }).join('');

  return `
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

export function renderDictionaryForm(data, helpers) {
  if (data.dictKey === 'competencyCosts') return renderCompetencyCostDictionaryForm(data, helpers.escapeHtml);
  const { escapeHtml, safeHexColor, autoDictColor, dictCodePlaceholder } = helpers;
  const list = (data.items || []).map(item => {
    const color = safeHexColor(item.color, autoDictColor(item.name));
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px" data-item-id="${item.id || ''}">
        <input type="hidden" class="dict-color-input" value="${color}">
        <span class="dict-color-swatch" style="display:inline-block;width:28px;height:28px;border-radius:6px;background:${color};cursor:pointer;border:1px solid var(--border-color);flex-shrink:0;" onclick="openDictColorPalette(this)"></span>
        <input class="input dict-value-input" value="${escapeHtml(item.name)}" placeholder="Значение" style="flex:1" oninput="autoFillDictRow(this)">
        <input class="input dict-code-input" value="${escapeHtml(item.code || '')}" placeholder="${escapeHtml(dictCodePlaceholder(data.dictKey))}" style="width:100px" oninput="markDictEdited(this)">
        <button class="dict-remove-btn" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#f43f5e" title="Удалить"><i data-lucide="x" style="width:14px;height:14px"></i></button>
      </div>`;
  }).join('');
  return `
    <h4 style="font-size:14px;font-weight:600;margin-bottom:12px">${escapeHtml(data.dictLabel)}</h4>
    <div id="dict-items-container">${list || '<p class="text-muted" style="font-size:13px">Нет значений</p>'}</div>
    <button class="btn btn-primary btn-sm" id="dict-add-value" style="margin-top:8px"><i data-lucide="plus" style="width:14px;height:14px"></i> Добавить значение</button>`;
}

export function renderCompetencyCostDictionaryForm(data, escapeHtml = String) {
  const items = data.items || [];
  const competencies = [...new Set(items.map(item => item.competency))].sort();
  const years = [...new Set(items.map(item => item.year))].sort((a, b) => a - b);
  const header = `<th style="padding:8px;text-align:left;font-size:12px">Компетенция</th>${years.map(year => `<th data-year="${year}" style="padding:8px;text-align:center;font-size:12px">${year}</th>`).join('')}`;
  const rows = competencies.map(comp => {
    const cells = years.map(year => {
      const item = items.find(candidate => candidate.competency === comp && candidate.year === year);
      return `<td style="padding:4px"><input class="input comp-cost-input" data-comp="${escapeHtml(comp)}" data-year="${year}" data-id="${item ? item.id : ''}" value="${item ? item.rate : ''}" placeholder="0" style="width:90px" oninput="markDictEdited(this)"></td>`;
    }).join('');
    return `<tr><td style="padding:8px;font-weight:500;font-size:13px">${escapeHtml(comp)}</td>${cells}</tr>`;
  }).join('');
  return `
    <h4 style="font-size:14px;font-weight:600;margin-bottom:8px">${escapeHtml(data.dictLabel)}</h4>
    <p class="text-muted" style="font-size:12px;margin-bottom:12px">Ставки (руб/день) по годам. Для задачи берётся ставка года её дедлайна; без дедлайна — ставка последнего (актуального) года. Очистка ячейки удаляет ставку, сохранённые effort_rub задач пересчитаются.</p>
    <div style="overflow-x:auto"><table id="comp-cost-table" style="border-collapse:collapse;min-width:100%"><thead><tr style="border-bottom:1px solid var(--border-color)">${header}</tr></thead><tbody>${rows || '<tr><td style="padding:8px" class="text-muted">Нет значений</td></tr>'}</tbody></table></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-secondary btn-sm" id="cc-add-year"><i data-lucide="plus" style="width:14px;height:14px"></i> Добавить год</button><button class="btn btn-secondary btn-sm" id="cc-add-competency"><i data-lucide="plus" style="width:14px;height:14px"></i> Добавить компетенцию</button></div>`;
}

export function getDictionaryChanges(items, originalItems) {
  const validItems = items.filter(item => item.name.trim());
  const originalIds = new Set(originalItems.filter(item => item.id).map(item => item.id));
  const retainedIds = new Set(validItems.filter(item => item.id).map(item => item.id));
  return { validItems, deleteIds: [...originalIds].filter(id => !retainedIds.has(id)) };
}

export async function persistDictionaryItems(app, dictKey, validItems, deleteIds) {
  const config = DICTIONARY_CONFIG[dictKey];
  if (!config) throw new Error('Неизвестный справочник');
  for (const item of validItems) {
    const payload = { dict_type: config.type, name: item.name, code: item.code, color: item.color || '#6366f1', sort_order: 1 };
    if (item.id) await app.api.put(`/admin/${config.endpoint}/${item.id}`, payload);
    else await app.api.post(`/admin/${config.endpoint}`, payload);
  }
  for (const id of deleteIds) await app.api.delete(`/admin/${config.endpoint}/${id}`);
}

export async function acquireDictionaryLock(app, dictKey) {
  const config = DICTIONARY_CONFIG[dictKey];
  if (!config) throw new Error('Неизвестный справочник');
  await app.api.post(`/admin/${config.type}/lock`);
  return config.type;
}

export async function releaseDictionaryLock(app, dictType) {
  if (dictType) await app.api.delete(`/admin/${dictType}/lock`);
}
