console.log('[DMB] expressEstimate.js v3 loaded');

const EFFORT_FIELDS = ['effort_ba', 'effort_sa', 'effort_fe', 'effort_be', 'effort_test', 'effort_design'];
const EFFORT_LABELS = { effort_ba: 'BA', effort_sa: 'SA', effort_fe: 'FE', effort_be: 'BE', effort_test: 'Test', effort_design: 'Design' };

let expressData = null;
let expressCurrentApp = null;
let saveTimers = {};

export function renderExpressEstimate(app) {
    const user = app.store.get('currentUser');
    const teamName = user?.team_name || '—';
    return `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-6);flex-wrap:wrap;gap:12px;">
        <div>
            <h1 style="font-size:20px;font-weight:700;margin:0;">Экспресс-оценка</h1>
            <p style="margin:4px 0 0;color:var(--text-secondary);font-size:14px;">
                Команда: <strong>${teamName}</strong> — оценка трудозатрат по задачам
            </p>
        </div>
        <div style="display:flex;gap:8px;">
            <button id="express-refresh-btn" class="btn btn-secondary btn-sm">
                <i data-lucide="refresh-cw" style="width:16px;height:16px;"></i> Обновить
            </button>
        </div>
    </div>

    <div id="express-tasks-container">
        <div class="table-container" style="overflow-x:auto;">
            <table class="table" id="express-tasks-table">
                <thead>
                    <tr>
                        <th style="min-width:300px;">Задача</th>
                        <th style="width:70px;text-align:center;">BA</th>
                        <th style="width:70px;text-align:center;">SA</th>
                        <th style="width:70px;text-align:center;">FE</th>
                        <th style="width:70px;text-align:center;">BE</th>
                        <th style="width:70px;text-align:center;">Test</th>
                        <th style="width:70px;text-align:center;">Design</th>
                        <th style="width:80px;text-align:center;">Итого</th>
                        <th style="width:70px;text-align:center;">Действия</th>
                    </tr>
                </thead>
                <tbody id="express-tasks-tbody">
                    ${renderSkeleton(6)}
                </tbody>
            </table>
        </div>
    </div>

    <div style="margin-top:var(--space-4);">
        <span class="text-secondary" id="express-tasks-count">Загрузка...</span>
    </div>
    `;
}

function renderSkeleton(count) {
    return Array.from({ length: count }, () => `
        <tr class="skeleton-row">
            <td><div class="skeleton skeleton-block w-80"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
            <td><div class="skeleton skeleton-block w-30"></div></td>
        </tr>
    `).join('');
}

export async function initExpressEstimate(app) {
    expressCurrentApp = app;
    document.getElementById('express-refresh-btn')?.addEventListener('click', () => loadData(app));
    await loadData(app);
}

async function loadData(app) {
    const tbody = document.getElementById('express-tasks-tbody');
    const countEl = document.getElementById('express-tasks-count');
    try {
        const resp = await app.api.get('/quick-estimate');
        expressData = resp;
        renderTable();
        if (countEl) countEl.textContent = `Найдено: ${(resp.tasks || []).length} задач`;
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:40px;">Ошибка загрузки: ${e.message}</td></tr>`;
        if (countEl) countEl.textContent = 'Ошибка загрузки';
    }
}

// ==================== Cascading computation ====================

function effectiveEffort(item, field) {
    if (item._type === 'task') {
        const epics = item.epics || [];
        if (epics.length > 0) {
            return epics.reduce((s, e) => s + effectiveEffort({ ...e, _type: 'epic' }, field), 0);
        }
        return parseFloat(item[field]) || 0;
    }
    if (item._type === 'epic') {
        const stories = item.stories || [];
        if (stories.length > 0) {
            return stories.reduce((s, st) => s + (parseFloat(st[field]) || 0), 0);
        }
        return parseFloat(item[field]) || 0;
    }
    return 0;
}

function hasChildren(item) {
    if (item._type === 'task') return (item.epics || []).length > 0;
    if (item._type === 'epic') return (item.stories || []).length > 0;
    return false;
}

function sumEffort(field, items) {
    return items.reduce((s, it) => s + (parseFloat(it[field]) || 0), 0);
}

function totalEffort(item) {
    return EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort(item, f), 0);
}

// ==================== Table rendering ====================

function renderTable() {
    const tbody = document.getElementById('express-tasks-tbody');
    if (!tbody) return;
    const tasks = expressData?.tasks || [];
    if (!tasks.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted" style="padding:40px;">Нет задач в статусе «Экспресс-оценка»</td></tr>';
        return;
    }
    const rows = [];
    tasks.forEach(task => {
        const t = { ...task, _type: 'task' };
        rows.push(renderTaskRow(t));
        (task.epics || []).forEach(epic => {
            const e = { ...epic, _type: 'epic' };
            rows.push(renderEpicRow(e, task.id));
            (epic.stories || []).forEach(story => {
                rows.push(renderStoryRow(story, epic.id));
            });
            rows.push(renderAddChildRow('story', epic.id));
        });
        rows.push(renderAddChildRow('epic', task.id));
    });
    tbody.innerHTML = rows.join('');
    bindEffortInputs();
    bindActionButtons();
}

function renderEffortInput(entity, id, field, value, readonly) {
    const v = value ?? '';
    const ro = readonly ? ' readonly' : '';
    return `<input type="number" step="0.5" min="0" class="effort-input${readonly ? ' effort-input--ro' : ''}" data-entity="${entity}" data-id="${id}" data-field="${field}" value="${v}"${ro} style="width:56px;padding:4px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;text-align:center;background:${readonly ? 'var(--bg-tertiary)' : 'var(--bg-primary)'};color:var(--text-primary);">`;
}

function renderEffortCells(entity, id, item) {
    let childType = null;
    if (entity === 'task') childType = 'epic';
    else if (entity === 'epic') childType = 'story';
    const readonly = childType && (item[childType + 's'] || []).length > 0;
    return EFFORT_FIELDS.map(f => {
        const val = readonly ? effectiveEffort({ ...item, _type: entity }, f) : (item[f] ?? '');
        return `<td style="text-align:center;">${renderEffortInput(entity, id, f, val, readonly)}</td>`;
    }).join('');
}

function renderTaskRow(task) {
    const readonly = (task.epics || []).length > 0;
    const total = totalEffort(task);
    const effortCells = renderEffortCells('task', task.id, task);
    return `<tr class="qe-task-row" data-task-id="${task.id}">
        <td>
            <div class="qe-title-text"><strong>${escHtml(task.title)}</strong></div>
            <div class="qe-title-actions">
                <button class="btn btn-xs btn-secondary qe-add-epic" data-task-id="${task.id}" title="Создать эпик">+ Эпик</button>
            </div>
        </td>
        ${effortCells}
        <td style="text-align:center;font-weight:700;">${total.toFixed(1)}</td>
        <td></td>
    </tr>`;
}

function renderEpicRow(epic, taskId) {
    const readonly = (epic.stories || []).length > 0;
    const total = totalEffort({ ...epic, _type: 'epic' });
    const effortCells = renderEffortCells('epic', epic.id, epic);
    return `<tr class="qe-epic-row" data-epic-id="${epic.id}" data-task-id="${taskId}">
        <td style="padding-left:32px !important;">
            <div class="qe-title-text"><span style="color:var(--text-muted);margin-right:6px;">⊟</span> ${escHtml(epic.title)}</div>
            <div class="qe-title-actions">
                <button class="btn btn-xs btn-secondary qe-add-story" data-epic-id="${epic.id}" title="Создать стори">+ Стори</button>
            </div>
        </td>
        ${effortCells}
        <td style="text-align:center;font-weight:600;color:var(--text-secondary);">${total.toFixed(1)}</td>
        <td style="text-align:center;">
            <button class="btn btn-xs btn-danger qe-del-epic" data-epic-id="${epic.id}" title="Удалить эпик">✕</button>
        </td>
    </tr>`;
}

function renderStoryRow(story, epicId) {
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(story[f]) || 0), 0);
    const effortCells = EFFORT_FIELDS.map(f =>
        `<td style="text-align:center;">${renderEffortInput('story', story.id, f, story[f] ?? '', false)}</td>`
    ).join('');
    return `<tr class="qe-story-row" data-story-id="${story.id}" data-epic-id="${epicId}">
        <td style="padding-left:56px !important;">
            <div class="qe-title-text"><span style="color:var(--text-muted);margin-right:6px;">⊟</span> ${escHtml(story.title)}</div>
            <div class="qe-title-actions"></div>
        </td>
        ${effortCells}
        <td style="text-align:center;font-weight:600;color:var(--text-secondary);">${total.toFixed(1)}</td>
        <td style="text-align:center;">
            <button class="btn btn-xs btn-danger qe-del-story" data-story-id="${story.id}" title="Удалить стори">✕</button>
        </td>
    </tr>`;
}

function renderAddChildRow(type, parentId) {
    const placeholder = type === 'epic' ? 'Название эпика' : 'Название стори';
    const label = type === 'epic' ? 'Создать эпик' : 'Создать стори';
    const attr = type === 'epic' ? `data-task-id="${parentId}"` : `data-epic-id="${parentId}"`;
    const padLeft = type === 'epic' ? '16px' : '32px';
    return `<tr class="qe-add-row" ${attr}>
        <td colspan="9" style="padding-left:${padLeft} !important;padding-top:2px;padding-bottom:2px;">
            <div class="qe-inline-form" style="display:none;align-items:center;gap:8px;">
                <input type="text" class="qe-inline-title" placeholder="${placeholder}" style="width:260px;padding:5px 10px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;">
                <button class="btn btn-sm btn-primary qe-inline-save" data-type="${type}" ${attr}>${label}</button>
                <button class="btn btn-sm btn-secondary qe-inline-cancel">Отмена</button>
            </div>
        </td>
    </tr>`;
}

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ==================== Effort Input Auto-Save ====================

function bindEffortInputs() {
    document.querySelectorAll('.effort-input:not(.effort-input--ro)').forEach(input => {
        input.addEventListener('change', () => {
            const entity = input.dataset.entity;
            const id = parseInt(input.dataset.id);
            const field = input.dataset.field;
            const val = input.value === '' ? null : parseFloat(input.value);
            scheduleSave(entity, id, field, val);
        });
    });
}

function scheduleSave(entity, id, field, value) {
    const key = `${entity}_${id}_${field}`;
    if (saveTimers[key]) clearTimeout(saveTimers[key]);
    saveTimers[key] = setTimeout(() => doSave(entity, id, field, value), 400);
}

async function doSave(entity, id, field, value) {
    const app = expressCurrentApp;
    if (!app) return;
    try {
        if (entity === 'task') {
            await app.api.put(`/quick-estimate/tasks/${id}`, { [field]: value });
            updateLocalEffort('task', id, field, value);
            updateDomRow('task', id);
            return;
        }

        // Save child entity
        const endpoint = entity === 'epic' ? 'epics' : 'stories';
        await app.api.put(`/quick-estimate/${endpoint}/${id}`, { [field]: value });
        updateLocalEffort(entity, id, field, value);

        // Cascade: update parent(s) using fresh local data
        if (entity === 'story') {
            const epicId = findEpicIdByStoryId(id);
            if (epicId) {
                await recalcAndSaveEpic(epicId);
                const taskId = findTaskIdByEpicId(epicId);
                if (taskId) {
                    await recalcAndSaveTask(taskId);
                }
            }
            updateDomRow('story', id);
        } else if (entity === 'epic') {
            const taskId = findTaskIdByEpicId(id);
            if (taskId) {
                await recalcAndSaveTask(taskId);
            }
            updateDomRow('epic', id);
        }
    } catch (e) {
        console.error('Save error:', e);
        window.toast('Ошибка сохранения: ' + e.message, 'error');
    }
}

async function recalcAndSaveEpic(epicId) {
    const app = expressCurrentApp;
    const epic = findEpicById(epicId);
    if (!epic) return;
    const stories = epic.stories || [];
    if (!stories.length) return;
    const data = {};
    for (const f of EFFORT_FIELDS) {
        data[f] = stories.reduce((s, st) => s + (parseFloat(st[f]) || 0), 0);
    }
    await app.api.put(`/quick-estimate/epics/${epicId}`, data);
    // Update local cache and DOM
    for (const f of EFFORT_FIELDS) {
        epic[f] = data[f];
    }
    updateDomRow('epic', epicId);
}

async function recalcAndSaveTask(taskId) {
    const app = expressCurrentApp;
    const task = findTaskById(taskId);
    if (!task) return;
    const epics = task.epics || [];
    if (!epics.length) return;
    const data = {};
    for (const f of EFFORT_FIELDS) {
        const total = epics.reduce((s, ep) => {
            const stories = ep.stories || [];
            if (stories.length > 0) {
                return s + stories.reduce((ss, st) => ss + (parseFloat(st[f]) || 0), 0);
            }
            return s + (parseFloat(ep[f]) || 0);
        }, 0);
        data[f] = total;
    }
    await app.api.put(`/quick-estimate/tasks/${taskId}`, data);
    // Update local cache and DOM
    for (const f of EFFORT_FIELDS) {
        task[f] = data[f];
    }
    updateDomRow('task', taskId);
}

function updateLocalEffort(entity, id, field, value) {
    if (entity === 'task') {
        const t = findTaskById(id);
        if (t) t[field] = value;
    } else if (entity === 'epic') {
        const e = findEpicById(id);
        if (e) e[field] = value;
    } else if (entity === 'story') {
        for (const t of (expressData?.tasks || [])) {
            for (const e of (t.epics || [])) {
                const s = (e.stories || []).find(st => st.id === id);
                if (s) { s[field] = value; return; }
            }
        }
    }
}

function updateDomRow(entity, id) {
    if (entity === 'story') {
        // Stories only need total column update (inputs are always editable by browser)
        const total = EFFORT_FIELDS.reduce((s, f) => {
            let story = null;
            for (const t of (expressData?.tasks || [])) {
                for (const e of (t.epics || [])) {
                    story = (e.stories || []).find(st => st.id === id);
                    if (story) break;
                }
                if (story) break;
            }
            return s + (parseFloat(story?.[f]) || 0);
        }, 0);
        const row = document.querySelector(`.qe-story-row[data-story-id="${id}"]`);
        if (row) {
            const totalTd = row.querySelector('td:nth-last-child(2)');
            if (totalTd) totalTd.textContent = total.toFixed(1);
        }
        return;
    }

    const item = entity === 'task' ? findTaskById(id) : findEpicById(id);
    if (!item) return;
    const itemWithType = { ...item, _type: entity };
    const hasCh = entity === 'task' ? (item.epics || []).length > 0 : (item.stories || []).length > 0;

    EFFORT_FIELDS.forEach(f => {
        const val = hasCh ? effectiveEffort(itemWithType, f) : (item[f] ?? '');
        const input = document.querySelector(`.effort-input[data-entity="${entity}"][data-id="${id}"][data-field="${f}"]`);
        if (input) {
            input.value = val ?? '';
            if (hasCh && !input.readOnly) {
                input.readOnly = true;
                input.classList.add('effort-input--ro');
                input.style.background = 'var(--bg-tertiary)';
            } else if (!hasCh && input.readOnly) {
                input.readOnly = false;
                input.classList.remove('effort-input--ro');
                input.style.background = 'var(--bg-primary)';
            }
        }
    });

    const total = totalEffort(itemWithType);
    const selector = entity === 'task' ? '.qe-task-row[data-task-id="' + id + '"]' : '.qe-epic-row[data-epic-id="' + id + '"]';
    const row = document.querySelector(selector);
    if (row) {
        const totalTd = row.querySelector('td:nth-last-child(2)');
        if (totalTd) totalTd.textContent = total.toFixed(1);
    }
}

function findTaskById(taskId) {
    return (expressData?.tasks || []).find(t => t.id === taskId);
}

function findEpicById(epicId) {
    for (const task of (expressData?.tasks || [])) {
        const epic = (task.epics || []).find(e => e.id === epicId);
        if (epic) return epic;
    }
    return null;
}

function findEpicIdByStoryId(storyId) {
    for (const task of (expressData?.tasks || [])) {
        for (const epic of (task.epics || [])) {
            if ((epic.stories || []).some(s => s.id === storyId)) {
                return epic.id;
            }
        }
    }
    return null;
}

function findTaskIdByEpicId(epicId) {
    for (const task of (expressData?.tasks || [])) {
        if ((task.epics || []).some(e => e.id === epicId)) {
            return task.id;
        }
    }
    return null;
}

// ==================== Action Buttons ====================

function bindActionButtons() {
    document.querySelectorAll('.qe-add-epic').forEach(btn => {
        btn.addEventListener('click', () => {
            const taskId = parseInt(btn.dataset.taskId);
            const row = document.querySelector(`.qe-add-row[data-task-id="${taskId}"]`);
            if (row) {
                const form = row.querySelector('.qe-inline-form');
                if (form) form.style.display = 'flex';
            }
        });
    });

    document.querySelectorAll('.qe-add-story').forEach(btn => {
        btn.addEventListener('click', () => {
            const epicId = parseInt(btn.dataset.epicId);
            const row = document.querySelector(`.qe-add-row[data-epic-id="${epicId}"]`);
            if (row) {
                const form = row.querySelector('.qe-inline-form');
                if (form) form.style.display = 'flex';
            }
        });
    });

    document.querySelectorAll('.qe-inline-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
            const form = btn.closest('.qe-inline-form');
            if (form) {
                form.querySelector('.qe-inline-title').value = '';
                form.style.display = 'none';
            }
        });
    });

    document.querySelectorAll('.qe-inline-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const form = btn.closest('.qe-inline-form');
            if (!form) return;
            const titleInput = form.querySelector('.qe-inline-title');
            const title = titleInput.value.trim();
            if (!title) {
                window.toast('Введите название', 'warning');
                return;
            }
            const type = btn.dataset.type;
            const app = expressCurrentApp;
            if (!app) return;
            try {
                if (type === 'epic') {
                    const taskId = parseInt(btn.dataset.taskId);
                    await app.api.post('/quick-estimate/epics', { task_id: taskId, title });
                } else if (type === 'story') {
                    const epicId = parseInt(btn.dataset.epicId);
                    await app.api.post('/quick-estimate/stories', { epic_id: epicId, title });
                }
                titleInput.value = '';
                form.style.display = 'none';
                window.toast('Создано', 'success');
                await loadData(app);
            } catch (e) {
                window.toast('Ошибка: ' + e.message, 'error');
            }
        });
    });

    document.querySelectorAll('.qe-del-epic').forEach(btn => {
        btn.addEventListener('click', async () => {
            const epicId = parseInt(btn.dataset.epicId);
            if (!confirm('Удалить эпик и все его стори?')) return;
            const app = expressCurrentApp;
            if (!app) return;
            try {
                await app.api.delete(`/quick-estimate/epics/${epicId}`);
                window.toast('Эпик удалён', 'success');
                await loadData(app);
            } catch (e) {
                window.toast('Ошибка: ' + e.message, 'error');
            }
        });
    });

    document.querySelectorAll('.qe-del-story').forEach(btn => {
        btn.addEventListener('click', async () => {
            const storyId = parseInt(btn.dataset.storyId);
            if (!confirm('Удалить стори?')) return;
            const app = expressCurrentApp;
            if (!app) return;
            try {
                await app.api.delete(`/quick-estimate/stories/${storyId}`);
                window.toast('Стори удалена', 'success');
                await loadData(app);
            } catch (e) {
                window.toast('Ошибка: ' + e.message, 'error');
            }
        });
    });
}
