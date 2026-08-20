console.log('[DMB] expressEstimate.js v27 loaded');

const COMPETENCIES = ['Designee', 'Аналитика', 'Разработка BE', 'Разработка python BE', 'Разработка FE', 'Tester', 'Tester Auto', 'Delivery'];
const EFFORT_FIELDS = ['effort_designee', 'effort_analytics', 'effort_be', 'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery'];
const EFFORT_FIELD_MAP = {};
COMPETENCIES.forEach((c, i) => { EFFORT_FIELD_MAP[c] = EFFORT_FIELDS[i]; });
const FIELD_TO_LABEL = {};
EFFORT_FIELDS.forEach((f, i) => { FIELD_TO_LABEL[f] = COMPETENCIES[i]; });

const CAPACITY_COEFFS = { senior: 1.3, middle: 1.0, junior: 0.8, lossFactor: 0.95 };
const EPIC_PRIORITIES = ['БЛОКИРУЮЩИЙ', 'КРИТИЧНЫЙ', 'ВЫСОКИЙ', 'СРЕДНИЙ', 'НИЗКИЙ'];
const PRIORITY_COLORS = { 'БЛОКИРУЮЩИЙ': '#dc2626', 'КРИТИЧНЫЙ': '#ef4444', 'ВЫСОКИЙ': '#f97316', 'СРЕДНИЙ': '#f59e0b', 'НИЗКИЙ': '#6b7280' };

let expressData = null;
let expressCurrentApp = null;
let teamResources = [];
let competencyCosts = [];
let expressChart = null;
let resourcesEditing = false;

// ==================== Main Render ====================

export function renderExpressEstimate(app) {
    const user = app.store.get('currentUser');
    const teamName = user?.team_name || '—';
    return `
    <div class="page-header animate-fade-in" style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3);">
        <div style="flex:1;min-width:0;">
            <h1>Экспресс-оценка</h1>
            <p>Команда: <strong>${escHtml(teamName)}</strong></p>
        </div>
        <div style="display:flex;gap:8px;">
            <button id="express-export-btn" class="btn btn-secondary btn-sm" title="Экспорт в Excel">
                <i data-lucide="download" style="width:16px;height:16px;"></i> Excel
            </button>
            <button id="express-refresh-btn" class="btn btn-secondary btn-sm">
                <i data-lucide="refresh-cw" style="width:16px;height:16px;"></i>
            </button>
        </div>
    </div>

    <div id="express-top-section"></div>
    <div id="express-hierarchy-section"></div>
    <div id="express-summary-section"></div>

    <div style="margin-top:var(--space-4);">
        <span class="text-secondary" id="express-tasks-count">Загрузка...</span>
    </div>

    <div id="express-modal-container"></div>
    `;
}

export async function initExpressEstimate(app) {
    expressCurrentApp = app;
    document.getElementById('express-refresh-btn')?.addEventListener('click', () => loadData(app));
    document.getElementById('express-export-btn')?.addEventListener('click', exportToExcel);
    await loadData(app);
}

// ==================== Data Loading ====================

async function loadData(app) {
    try {
        const [resp, resources, costs] = await Promise.all([
            app.api.get('/quick-estimate'),
            loadTeamResources(app),
            loadCompetencyCosts(app)
        ]);
        expressData = resp;
        teamResources = resources;
        competencyCosts = costs;
        resourcesEditing = false;
        renderAll();
        const count = (resp.tasks || []).length;
        const el = document.getElementById('express-tasks-count');
        if (el) el.textContent = `Найдено: ${count} задач`;
    } catch (e) {
        console.error('Load error:', e);
        const el = document.getElementById('express-tasks-count');
        if (el) el.textContent = 'Ошибка загрузки: ' + e.message;
    }
}

async function loadTeamResources(app) {
    try {
        const user = app.store.get('currentUser');
        if (!user?.team_id) return [];
        return await app.api.get(`/teams/${user.team_id}/resources`);
    } catch { return []; }
}

async function loadCompetencyCosts(app) {
    try {
        return await app.api.get('/teams/competency-costs');
    } catch { return []; }
}

// ==================== Render All Blocks ====================

function renderAll() {
    renderTopSection();
    renderHierarchyBlock();
    renderSummaryBlock();
}

// ==================== Block 1+2: Resources + Chart (Compact) ====================

function renderTopSection() {
    const el = document.getElementById('express-top-section');
    if (!el) return;

    const isEdit = resourcesEditing;

    let tableRows;
    if (isEdit) {
        tableRows = teamResources.map(r => `
            <tr>
                <td style="font-weight:500;white-space:nowrap;">${escHtml(r.competency)}</td>
                <td style="text-align:center;"><input type="number" min="0" class="res-edit" data-comp="${escHtml(r.competency)}" data-field="senior_count" value="${r.senior_count}" style="width:48px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;text-align:center;"></td>
                <td style="text-align:center;"><input type="number" min="0" class="res-edit" data-comp="${escHtml(r.competency)}" data-field="middle_count" value="${r.middle_count}" style="width:48px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;text-align:center;"></td>
                <td style="text-align:center;"><input type="number" min="0" class="res-edit" data-comp="${escHtml(r.competency)}" data-field="junior_count" value="${r.junior_count}" style="width:48px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;text-align:center;"></td>
                <td style="text-align:center;"><input type="number" min="0" class="res-edit" data-comp="${escHtml(r.competency)}" data-field="vacation_days" value="${r.vacation_days}" style="width:48px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;text-align:center;"></td>
                <td style="text-align:center;"><input type="number" min="1" class="res-edit" data-comp="${escHtml(r.competency)}" data-field="working_days" value="${r.working_days}" style="width:48px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:13px;text-align:center;"></td>
                <td style="text-align:center;font-weight:700;">${r.capacity.toFixed(1)}</td>
            </tr>
        `).join('');
    } else {
        tableRows = teamResources.map(r => `
            <tr>
                <td style="font-weight:500;white-space:nowrap;">${escHtml(r.competency)}</td>
                <td style="text-align:center;">${r.senior_count}</td>
                <td style="text-align:center;">${r.middle_count}</td>
                <td style="text-align:center;">${r.junior_count}</td>
                <td style="text-align:center;">${r.vacation_days}</td>
                <td style="text-align:center;">${r.working_days}</td>
                <td style="text-align:center;font-weight:700;">${r.capacity.toFixed(1)}</td>
            </tr>
        `).join('');
    }

    const editBtns = isEdit
        ? `<button class="btn btn-xs btn-danger" id="res-cancel-btn">Отмена</button>
           <button class="btn btn-xs btn-primary" id="res-save-btn">Сохранить</button>`
        : `<button class="btn btn-xs btn-secondary" id="res-edit-btn"><i data-lucide="pencil" style="width:12px;height:12px;"></i> Редактировать ресурсы</button>`;

    el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <h3 style="font-size:15px;font-weight:600;margin:0;">Ресурсы и потребности</h3>
        <div style="display:flex;gap:6px;">${editBtns}</div>
    </div>
    <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div style="flex:2;min-width:300px;overflow-x:auto;">
                <table class="table" style="font-size:12px;">
                    <thead>
                        <tr>
                            <th style="white-space:nowrap;">Компетенция</th>
                            <th style="width:56px;text-align:center;">Sr</th>
                            <th style="width:56px;text-align:center;">Md</th>
                            <th style="width:56px;text-align:center;">Jr</th>
                            <th style="width:56px;text-align:center;">Отп.</th>
                            <th style="width:56px;text-align:center;">РД</th>
                            <th style="width:64px;text-align:center;">Ресурс</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <div style="flex:3;min-width:260px;">
                <div style="position:relative;height:220px;">
                    <canvas id="express-chart"></canvas>
                </div>
                <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;color:var(--text-secondary);">
                    <span><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:2px;margin-right:3px;"></span>Capacity</span>
                    <span><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:2px;margin-right:3px;"></span>Demand</span>
                    <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:3px;"></span>Дефицит</span>
                </div>
            </div>
        </div>
    </div>`;

    if (window.lucide) window.lucide.createIcons();
    drawChart();
    bindResourceActions();
}

function drawChart() {
    const canvas = document.getElementById('express-chart');
    if (!canvas || !window.Chart) return;
    if (expressChart) { expressChart.destroy(); expressChart = null; }

    const demand = calcTotalDemand();
    const labels = COMPETENCIES;
    const capacityData = labels.map(c => {
        const r = teamResources.find(x => x.competency === c);
        return r ? r.capacity : 0;
    });
    const demandData = labels.map(c => demand[c] || 0);
    const barColors = labels.map((c, i) => demandData[i] > capacityData[i] ? '#ef4444' : '#3b82f6');

    expressChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Capacity', data: capacityData, backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Demand', data: demandData, backgroundColor: barColors, borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const idx = ctx.dataIndex;
                            const diff = demandData[idx] - capacityData[idx];
                            return diff > 0 ? `Дефицит: ${diff.toFixed(1)} ч/д` : `Профицит: ${Math.abs(diff).toFixed(1)} ч/д`;
                        }
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Чел/д', font: { size: 11 } }, ticks: { font: { size: 10 } } },
                x: { ticks: { font: { size: 10 } } }
            }
        }
    });
}

function updateChartData() {
    if (!expressChart) return;
    const demand = calcTotalDemand();
    const demandData = COMPETENCIES.map(c => demand[c] || 0);
    const capacityData = COMPETENCIES.map(c => {
        const r = teamResources.find(x => x.competency === c);
        return r ? r.capacity : 0;
    });
    expressChart.data.datasets[1].data = demandData;
    expressChart.data.datasets[1].backgroundColor = demandData.map((d, i) => d > capacityData[i] ? '#ef4444' : '#3b82f6');
    expressChart.update('none');
}

function bindResourceActions() {
    document.getElementById('res-edit-btn')?.addEventListener('click', () => {
        resourcesEditing = true;
        renderTopSection();
    });
    document.getElementById('res-cancel-btn')?.addEventListener('click', () => {
        resourcesEditing = false;
        renderTopSection();
    });
    document.getElementById('res-save-btn')?.addEventListener('click', saveResources);
}

async function saveResources() {
    const app = expressCurrentApp;
    const user = app.store.get('currentUser');
    if (!user?.team_id) return;

    const updated = teamResources.map(r => {
        const row = { competency: r.competency };
        document.querySelectorAll(`.res-edit[data-comp="${CSS.escape(r.competency)}"]`).forEach(inp => {
            row[inp.dataset.field] = parseInt(inp.value) || 0;
        });
        return row;
    });

    try {
        await app.api.put(`/teams/${user.team_id}/resources`, updated);
        window.toast('Ресурсы обновлены', 'success');
        await loadData(app);
    } catch (e) {
        window.toast('Ошибка сохранения: ' + e.message, 'error');
    }
}

// ==================== Block 3: Hierarchy ====================

function renderHierarchyBlock() {
    const el = document.getElementById('express-hierarchy-section');
    if (!el) return;
    const tasks = expressData?.tasks || [];

    const tasksHtml = tasks.length === 0
        ? '<div style="padding:24px;text-align:center;color:var(--text-muted);">Нет задач для оценки. Добавьте задачу из бэклога.</div>'
        : tasks.map(t => renderTaskBlock(t)).join('');

    el.innerHTML = `
    <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <h3 style="font-size:15px;font-weight:600;margin:0;">Экспресс-оценка</h3>
            <button id="express-import-btn" class="btn btn-primary btn-sm">
                <i data-lucide="plus" style="width:16px;height:16px;"></i> Добавить задачу из бэклога
            </button>
        </div>
        ${tasksHtml}
    </div>`;

    document.getElementById('express-import-btn')?.addEventListener('click', showImportModal);
    bindHierarchyActions();
}

function renderTaskBlock(task) {
    const epics = task.epics || [];
    const total = EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort({ ...task, _type: 'task' }, f), 0);
    const epicsHtml = epics.map(e => renderEpicBlock(e, task.id)).join('');
    const taskEffort = {};
    if (epics.length > 0) {
        COMPETENCIES.forEach(c => { taskEffort[EFFORT_FIELD_MAP[c]] = effectiveEffort({ ...task, _type: 'task' }, EFFORT_FIELD_MAP[c]); });
    }
    const unestimatedEpics = epics.filter(e => {
        return EFFORT_FIELDS.every(f => !e[f] || e[f] === 0);
    });
    const warnBadge = unestimatedEpics.length > 0
        ? `<span title="${unestimatedEpics.length} эпик(ов) без оценки" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#f59e0b20;color:#f59e0b;font-size:11px;font-weight:700;flex-shrink:0;">${unestimatedEpics.length}</span>`
        : '';
    return `
    <div class="qe-task-block" data-task-id="${task.id}" style="border:1px solid var(--border-color);border-radius:6px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px 6px 0 0;" class="qe-toggle" data-target="task-${task.id}">
            <div style="display:flex;align-items:center;gap:8px;width:300px;flex-shrink:0;overflow:hidden;">
                <i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--text-muted);transition:transform .2s;flex-shrink:0;"></i>
                <i data-lucide="clipboard-check" style="width:16px;height:16px;color:var(--accent);flex-shrink:0;" title="Задача"></i>
                <strong style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(task.title)}</strong>
                <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;">(${epics.length} эпиков)</span>
                ${warnBadge}
            </div>
            ${renderEffortInline(task, 'task', true, taskEffort)}
            <span style="font-weight:700;font-size:13px;min-width:60px;text-align:right;white-space:nowrap;margin-left:auto;" data-total-task="${task.id}">${total.toFixed(1)} ч/д</span>
            <button class="btn btn-xs btn-danger qe-del-task-btn" data-task-id="${task.id}" title="Убрать из экспресс-оценки" style="margin-left:8px;"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
        </div>
        <div id="task-${task.id}" style="padding:8px 0 8px 12px;">
            ${epicsHtml}
            <button class="btn btn-xs btn-secondary qe-add-epic-btn" data-task-id="${task.id}" style="margin-top:8px;">
                <i data-lucide="plus" style="width:14px;height:14px;"></i> Добавить эпик
            </button>
        </div>
    </div>`;
}

// ==================== Epic Block + Inline Edit ====================

function renderEpicBlock(epic, taskId) {
    const stories = epic.stories || [];
    const total = EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort({ ...epic, _type: 'epic' }, f), 0);
    const storiesHtml = stories.map(s => renderStoryBlock(s, epic.id)).join('');
    const priColor = PRIORITY_COLORS[epic.priority] || '#6b7280';
    const priOptions = EPIC_PRIORITIES.map(p => `<option value="${p}" ${epic.priority === p ? 'selected' : ''}>${p}</option>`).join('');
    const hasStories = stories.length > 0;
    const epicEffort = {};
    if (hasStories) {
        COMPETENCIES.forEach(c => { epicEffort[EFFORT_FIELD_MAP[c]] = effectiveEffort({ ...epic, _type: 'epic' }, EFFORT_FIELD_MAP[c]); });
    }
    return `
    <div class="qe-epic-block" data-epic-id="${epic.id}" style="border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;margin-left:16px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:6px 6px 0 0;">
            <div style="display:flex;align-items:center;gap:6px;width:272px;flex-shrink:0;overflow:hidden;">
                <i data-lucide="chevron-down" style="width:14px;height:14px;color:var(--text-muted);cursor:pointer;transition:transform .2s;flex-shrink:0;" class="qe-toggle" data-target="epic-${epic.id}"></i>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><title>Эпик</title><rect x="0" y="0" width="14" height="14" rx="2" fill="#904EE2"/><g transform="translate(4,3)" fill="#FFF"><path d="M5.92 3.76l-.004-.004c.046-.08.08-.162.08-.256 0-.276-.224-.5-.5-.5H3V.5C3 .224 2.776 0 2.5 0c-.172 0-.315.092-.405.223-.028.04-.051.083-.066.13L.08 4.24l.002.002C.035 4.32 0 4.4 0 4.5c0 .276.224.5.5.5H3v2.5c0 .276.224.5.5.5.18 0 .33-.1.418-.242l.003.002.013-.026c.011-.02.023-.04.031-.062l1.958-3.915z"/></g></svg>
                <input type="text" class="qe-inline-field-input" data-entity="epic" data-id="${epic.id}" data-field="title" data-original="${escHtml(epic.title)}" value="${escHtml(epic.title)}" style="font-size:13px;font-weight:500;padding:4px 6px;border:1px solid transparent;border-radius:4px;background:transparent;min-width:40px;flex:1;overflow:hidden;text-overflow:ellipsis;" onfocus="this.style.borderColor='var(--border-color)';this.style.background='var(--bg-primary)';" onblur="this.style.borderColor='transparent';this.style.background='transparent';">
                <select class="qe-inline-field-select" data-entity="epic" data-id="${epic.id}" data-field="priority" data-original="${epic.priority || ''}" style="font-size:11px;padding:4px 6px;border-radius:4px;background:${priColor}15;color:${priColor};border:1px solid ${priColor}33;font-weight:600;cursor:pointer;max-width:120px;flex-shrink:0;">
                    <option value="">—</option>${priOptions}
                </select>
                <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;flex-shrink:0;">(${stories.length})</span>
            </div>
            ${renderEffortInline(epic, 'epic', hasStories, hasStories ? epicEffort : null)}
            <span style="font-weight:600;font-size:13px;min-width:60px;text-align:right;white-space:nowrap;margin-left:auto;" data-total-epic="${epic.id}">${total.toFixed(1)}</span>
            <button class="btn btn-xs btn-danger qe-del-epic-btn" data-epic-id="${epic.id}" title="Удалить" style="margin-left:8px;"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
        </div>
        <div id="epic-${epic.id}" style="padding:6px 0 6px 12px;">
            ${storiesHtml}
            <button class="btn btn-xs btn-secondary qe-add-story-btn" data-epic-id="${epic.id}" style="margin-top:6px;">
                <i data-lucide="plus" style="width:12px;height:12px;"></i> Добавить историю
            </button>
        </div>
    </div>`;
}

function renderEpicEditPanel(epic, taskId) {
    const isEdit = !!epic?.id;
    const priOptions = EPIC_PRIORITIES.map(p => `<option value="${p}" ${epic?.priority === p ? 'selected' : ''}>${p}</option>`).join('');
    const hasNoStories = !epic?.stories || epic.stories.length === 0;
    const effortInputs = COMPETENCIES.map(c => {
        const field = EFFORT_FIELD_MAP[c];
        const val = epic?.[field] ?? '';
        return `<td style="padding:2px 3px;text-align:center;"><input type="number" step="0.5" min="0" class="qe-effort-input" data-field="${field}" data-panel-id="${epic?.id || 'new-epic'}" value="${val}" placeholder="0" style="width:52px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:11px;text-align:center;"></td>`;
    }).join('');
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(epic?.[f]) || 0), 0);
    const effortCells = hasNoStories ? effortInputs : COMPETENCIES.map(() => '<td style="text-align:center;color:var(--text-muted);font-size:11px;">—</td>').join('');
    return `
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead>
            <tr>
                <th style="text-align:left;font-size:10px;padding:2px 4px;color:var(--text-secondary);font-weight:500;">Название</th>
                <th style="text-align:left;font-size:10px;padding:2px 4px;color:var(--text-secondary);font-weight:500;width:130px;">Приоритет</th>
                ${COMPETENCIES.map(c => `<th style="text-align:center;font-size:10px;padding:2px 3px;color:var(--text-secondary);font-weight:500;">${c.split(' ').pop()}</th>`).join('')}
                <th style="text-align:center;font-size:10px;padding:2px 4px;color:var(--text-secondary);font-weight:500;min-width:40px;">Итого</th>
                <th style="width:30px;"></th>
            </tr>
        </thead>
        <tbody>
        <tr>
            <td style="padding:2px 4px;flex:2;"><input type="text" class="qe-inline-title" data-entity="epic" data-id="${epic?.id || ''}" value="${escHtml(epic?.title || '')}" placeholder="Название эпика" style="width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;"></td>
            <td style="padding:2px 4px;flex:0 0 130px;"><select class="qe-inline-priority" data-entity="epic" data-id="${epic?.id || ''}" style="width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;"><option value="">—</option>${priOptions}</select></td>
            ${effortCells}
            <td style="padding:2px 4px;text-align:center;font-weight:700;font-size:12px;min-width:40px;" data-total-panel="${epic?.id || 'new-epic'}">${total.toFixed(1)}</td>
            <td style="padding:2px 4px;"><button class="btn btn-xs btn-secondary qe-inline-close" data-entity="epic" data-id="${epic?.id || ''}" title="Закрыть (Esc)">&times;</button></td>
        </tr>
        </tbody>
    </table>`;
}

// ==================== Story Block + Inline Edit ====================

function renderStoryBlock(story, epicId) {
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(story[f]) || 0), 0);
    return `
    <div class="qe-story-block" data-story-id="${story.id}" data-epic-id="${epicId}" draggable="true" style="border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;margin-left:32px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px 6px 0 0;overflow:hidden;">
            <div style="display:flex;align-items:center;gap:6px;width:228px;flex-shrink:0;overflow:hidden;">
                <i data-lucide="grip-vertical" style="width:14px;height:14px;color:var(--text-muted);cursor:grab;flex-shrink:0;" class="qe-drag-handle"></i>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><title>История</title><rect x="0" y="0" width="14" height="14" rx="2" fill="#63BA3C"/><path d="M9 3H5a1 1 0 00-1 1v6.5a.5.5 0 00.5.5c.175 0 .321-.095.41-.231l.004-.001L6.84 8.54a.5.5 0 01.68 0l1.886 2.228.004.001c.089.136.235.231.41.231a.5.5 0 00.5-.5V4a1 1 0 00-1-1z" fill="#FFF"/></svg>
                <input type="text" class="qe-inline-field-input" data-entity="story" data-id="${story.id}" data-field="title" data-original="${escHtml(story.title)}" value="${escHtml(story.title)}" style="font-size:13px;padding:4px 6px;border:1px solid transparent;border-radius:4px;background:transparent;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;" onfocus="this.style.borderColor='var(--border-color)';this.style.background='var(--bg-primary)';" onblur="this.style.borderColor='transparent';this.style.background='transparent';">
            </div>
            ${renderEffortInline(story, 'story')}
            <span style="font-weight:600;font-size:13px;min-width:60px;text-align:right;white-space:nowrap;margin-left:auto;" data-total-story="${story.id}">${total.toFixed(1)}</span>
            <button class="btn btn-xs btn-danger qe-del-story-btn" data-story-id="${story.id}" title="Удалить" style="margin-left:8px;"><i data-lucide="trash-2" style="width:11px;height:11px;"></i></button>
        </div>
    </div>`;
}

function renderStoryEditPanel(story, epicId) {
    const effortInputs = COMPETENCIES.map(c => {
        const field = EFFORT_FIELD_MAP[c];
        const val = story?.[field] ?? '';
        return `<td style="padding:2px 3px;text-align:center;"><input type="number" step="0.5" min="0" class="qe-effort-input" data-field="${field}" data-panel-id="${story?.id || 'new-story'}" value="${val}" placeholder="0" style="width:52px;padding:3px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:11px;text-align:center;"></td>`;
    }).join('');
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(story?.[f]) || 0), 0);
    return `
    <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead>
            <tr>
                <th style="text-align:left;font-size:10px;padding:2px 4px;color:var(--text-secondary);font-weight:500;">Название</th>
                ${COMPETENCIES.map(c => `<th style="text-align:center;font-size:10px;padding:2px 3px;color:var(--text-secondary);font-weight:500;">${c.split(' ').pop()}</th>`).join('')}
                <th style="text-align:center;font-size:10px;padding:2px 4px;color:var(--text-secondary);font-weight:500;min-width:40px;">Итого</th>
                <th style="width:30px;"></th>
            </tr>
        </thead>
        <tbody>
        <tr>
            <td style="padding:2px 4px;flex:2;"><input type="text" class="qe-inline-title" data-entity="story" data-id="${story?.id || ''}" value="${escHtml(story?.title || '')}" placeholder="Название истории" style="width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;"></td>
            ${effortInputs}
            <td style="padding:2px 4px;text-align:center;font-weight:700;font-size:12px;min-width:40px;" data-total-panel="${story?.id || 'new-story'}">${total.toFixed(1)}</td>
            <td style="padding:2px 4px;"><button class="btn btn-xs btn-secondary qe-inline-close" data-entity="story" data-id="${story?.id || ''}" title="Закрыть (Esc)">&times;</button></td>
        </tr>
        </tbody>
    </table>`;
}

// ==================== Shared Render Helpers ====================

function renderEffortInline(item, entityType, readonly = false, computedValues = null) {
    return `<div style="display:grid;grid-template-columns:repeat(8, 48px);gap:6px;flex-shrink:0;">` +
        COMPETENCIES.map(c => {
            const field = EFFORT_FIELD_MAP[c];
            const rawVal = item[field];
            const val = computedValues ? computedValues[field] : rawVal;
            const shortLabel = c.split(' ').pop();
            if (readonly) {
                const display = (val !== undefined && val !== null && val !== '') ? val : '—';
                return `<div style="display:flex;flex-direction:column;align-items:center;">
                    <span style="font-size:8px;color:var(--text-muted);line-height:1;margin-bottom:2px;">${shortLabel}</span>
                    <span style="width:100%;padding:5px 4px;text-align:center;font-size:12px;font-weight:500;background:#6b728015;border:1px solid #6b728030;border-radius:4px;min-height:24px;color:var(--text-muted);" data-effort-display="${entityType}-${item.id}-${field}">${display}</span>
                </div>`;
            }
            return `<div style="display:flex;flex-direction:column;align-items:center;">
                <span style="font-size:8px;color:var(--text-muted);line-height:1;margin-bottom:2px;">${shortLabel}</span>
                <input type="number" step="0.5" min="0" class="qe-inline-effort" data-entity="${entityType}" data-id="${item.id}" data-field="${field}" data-original="${val ?? ''}" value="${val ?? ''}" placeholder="0" style="width:48px;padding:5px 4px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;text-align:center;">
            </div>`;
        }).join('') +
    `</div>`;
}

function renderEffortChips(item) {
    return EFFORT_FIELDS.filter(f => (parseFloat(item[f]) || 0) > 0).map(f => {
        const val = parseFloat(item[f]) || 0;
        const label = FIELD_TO_LABEL[f];
        return `<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:var(--bg-tertiary);color:var(--text-secondary);white-space:nowrap;" title="${label}: ${val} ч/д">${label.substring(0, 3)} ${val}</span>`;
    }).join('');
}

// ==================== Block 4: Summary Table ====================

function renderSummaryBlock() {
    const el = document.getElementById('express-summary-section');
    if (!el) return;
    const summary = calcSummaryByStatusPriority();
    if (summary.length === 0) {
        el.innerHTML = '';
        return;
    }
    const rows = summary.map((row, idx) => `
        <tr data-status="${escHtml(row.status)}" data-priority="${escHtml(row.priority)}" data-row-idx="${idx}" class="qe-summary-row" style="cursor:pointer;">
            <td style="font-weight:500;">${escHtml(row.status)}</td>
            <td><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${PRIORITY_COLORS[row.priority] || '#6b7280'}15;color:${PRIORITY_COLORS[row.priority] || '#6b7280'};font-weight:600;">${escHtml(row.priority)}</span></td>
            ${COMPETENCIES.map(c => `<td style="text-align:center;">${(row.demand[c] || 0).toFixed(1)}</td>`).join('')}
            <td style="text-align:right;font-weight:700;">${formatRub(row.totalCost)}</td>
        </tr>
    `).join('');
    const totals = summary.reduce((acc, row) => {
        COMPETENCIES.forEach(c => { acc[c] = (acc[c] || 0) + (row.demand[c] || 0); });
        acc.totalCost += row.totalCost;
        return acc;
    }, { totalCost: 0 });

    el.innerHTML = `
    <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px;">
        <h3 style="font-size:15px;font-weight:600;margin:0 0 12px;">Сводная таблица потребности в ресурсах</h3>
        <div style="overflow-x:auto;">
            <table class="table qe-summary-table" style="font-size:12px;">
                <thead>
                    <tr>
                        <th>Статус</th>
                        <th>Приоритет</th>
                        ${COMPETENCIES.map(c => `<th style="width:65px;text-align:center;font-size:11px;">${c.split(' ').pop()}</th>`).join('')}
                        <th style="width:100px;text-align:right;">Total Cost</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                    <tr style="background:var(--bg-secondary);font-weight:700;">
                        <td colspan="2">Итого</td>
                        ${COMPETENCIES.map(c => `<td style="text-align:center;">${(totals[c] || 0).toFixed(1)}</td>`).join('')}
                        <td style="text-align:right;">${formatRub(totals.totalCost)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>`;

    el.querySelectorAll('.qe-summary-row').forEach(tr => {
        tr.addEventListener('click', () => {
            const status = tr.dataset.status;
            const priority = tr.dataset.priority;
            const wasHighlighted = tr.classList.contains('qe-summary-active');
            el.querySelectorAll('.qe-summary-row').forEach(r => r.classList.remove('qe-summary-active'));
            document.querySelectorAll('.qe-task-block').forEach(b => b.classList.remove('qe-highlighted'));
            if (wasHighlighted) return;
            tr.classList.add('qe-summary-active');
            const tasks = expressData?.tasks || [];
            tasks.forEach(task => {
                if ((task.status_name || 'Неизвестно') === status && (task.priority_name || 'СРЕДНИЙ') === priority) {
                    const block = document.querySelector(`.qe-task-block[data-task-id="${task.id}"]`);
                    if (block) block.classList.add('qe-highlighted');
                }
            });
        });
    });
}

// ==================== Import Task Modal (search/select — not editing) ====================

function showImportModal() {
    const html = `
    <div class="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center;" id="qe-modal">
        <div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:600px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);">
            <h3 style="margin:0 0 4px;font-size:16px;">Добавить задачи из бэклога</h3>
            <p style="font-size:12px;color:var(--text-secondary);margin:0 0 12px;">Задачи будут переведены в статус «ЭКСПРЕСС-ОЦЕНКА».</p>
            <input type="text" id="import-search" placeholder="Поиск по названию..." style="width:100%;padding:8px 12px;border:1px solid var(--border-color);border-radius:6px;font-size:13px;margin-bottom:12px;">
            <div id="import-results" style="min-height:60px;color:var(--text-muted);font-size:13px;overflow-y:auto;max-height:50vh;">Введите название для поиска...</div>
            <div id="import-footer" style="display:none;align-items:center;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color);">
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer;">
                    <input type="checkbox" id="import-select-all"> Выбрать все
                </label>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span id="import-selected-count" style="font-size:12px;color:var(--text-secondary);"></span>
                    <button class="btn btn-primary btn-sm" id="import-selected-btn" disabled>Добавить выбранные</button>
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:12px;">
                <button class="btn btn-secondary btn-sm" id="qe-modal-close-btn">Закрыть</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const overlay = document.getElementById('qe-modal');
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.getElementById('qe-modal-close-btn').addEventListener('click', () => overlay.remove());

    let searchTimer = null;
    document.getElementById('import-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        searchTimer = setTimeout(() => searchBacklogTasks(q), 300);
    });
    document.getElementById('import-select-all').addEventListener('change', (e) => {
        document.querySelectorAll('.import-task-check').forEach(cb => { cb.checked = e.target.checked; });
        updateImportSelection();
    });
    document.getElementById('import-selected-btn').addEventListener('click', importSelectedTasks);
    document.getElementById('import-search').focus();
    setTimeout(() => searchBacklogTasks(''), 100);
}

let importState = { q: '', offset: 0, total: 0 };

async function searchBacklogTasks(q, append = false) {
    const resultsEl = document.getElementById('import-results');
    if (!resultsEl) return;
    if (!append) {
        importState = { q, offset: 0, total: 0 };
        resultsEl.innerHTML = '<span style="color:var(--text-muted);">Поиск...</span>';
    }

    try {
        const app = expressCurrentApp;
        const resp = await app.api.get(`/quick-estimate/backlog-tasks?q=${encodeURIComponent(importState.q)}&offset=${importState.offset}`);
        const tasks = resp.items || [];
        importState.total = resp.total || 0;

        if (!append) resultsEl.innerHTML = '';
        if (tasks.length === 0 && !append) {
            resultsEl.innerHTML = '<span style="color:var(--text-muted);">Задач не найдено</span>';
            document.getElementById('import-footer').style.display = 'none';
            return;
        }

        const existingBtn = resultsEl.querySelector('.qe-load-more');
        if (existingBtn) existingBtn.remove();

        const fragment = document.createDocumentFragment();
        tasks.forEach(t => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;';
            div.innerHTML = `
                <input type="checkbox" class="import-task-check" data-task-id="${t.id}" style="flex-shrink:0;cursor:pointer;">
                <div style="min-width:0;flex:1;">
                    <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">#${t.id} ${escHtml(t.title)}</div>
                    <div style="font-size:11px;color:var(--text-secondary);">${escHtml(t.status_name || '')} &middot; ${escHtml(t.priority_name || '')}</div>
                </div>
                <button class="btn btn-xs btn-secondary import-task-btn" data-task-id="${t.id}" style="flex-shrink:0;">Добавить</button>
            `;
            div.querySelector('.import-task-check').addEventListener('change', updateImportSelection);
            div.querySelector('.import-task-btn').addEventListener('click', () => importSingleTask(t.id));
            fragment.appendChild(div);
        });
        resultsEl.appendChild(fragment);

        const shown = resultsEl.querySelectorAll('.import-task-check').length;
        if (shown < importState.total) {
            const loadMore = document.createElement('button');
            loadMore.className = 'btn btn-secondary btn-sm qe-load-more';
            loadMore.style.cssText = 'width:100%;margin-top:4px;';
            loadMore.textContent = `Показать ещё (показано ${shown} из ${importState.total})`;
            loadMore.addEventListener('click', () => {
                importState.offset += 20;
                searchBacklogTasks(importState.q, true);
            });
            resultsEl.appendChild(loadMore);
        }

        document.getElementById('import-footer').style.display = 'flex';
        document.getElementById('import-select-all').checked = false;
        updateImportSelection();
    } catch (e) {
        resultsEl.innerHTML = `<span style="color:var(--danger);">Ошибка: ${escHtml(e.message)}</span>`;
    }
}

function updateImportSelection() {
    const checks = document.querySelectorAll('.import-task-check');
    const checked = document.querySelectorAll('.import-task-check:checked');
    const countEl = document.getElementById('import-selected-count');
    const btnEl = document.getElementById('import-selected-btn');
    if (countEl) countEl.textContent = checked.length > 0 ? `Выбрано: ${checked.length}` : '';
    if (btnEl) btnEl.disabled = checked.length === 0;
    const selectAll = document.getElementById('import-select-all');
    if (selectAll) selectAll.checked = checks.length > 0 && checked.length === checks.length;
}

async function importSelectedTasks() {
    const checked = document.querySelectorAll('.import-task-check:checked');
    if (checked.length === 0) return;
    const ids = Array.from(checked).map(cb => parseInt(cb.dataset.taskId));
    const app = expressCurrentApp;
    const total = ids.length;

    const modal = document.getElementById('qe-modal');
    const footer = document.getElementById('import-footer');
    const searchInput = document.getElementById('import-search');
    if (footer) footer.style.display = 'none';
    if (searchInput) searchInput.disabled = true;
    const progressDiv = document.createElement('div');
    progressDiv.className = 'qe-import-progress';
    progressDiv.innerHTML = `<span class="qe-import-text">Импорт 0 из ${total}...</span><div class="bar"><div class="bar-fill" style="width:0%"></div></div>`;
    const resultsEl = document.getElementById('import-results');
    if (resultsEl) resultsEl.appendChild(progressDiv);

    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
        try {
            await app.api.post(`/quick-estimate/import-task/${ids[i]}`);
            ok++;
        } catch {
            fail++;
        }
        const pct = ((i + 1) / total * 100).toFixed(0);
        const fill = progressDiv.querySelector('.bar-fill');
        const txt = progressDiv.querySelector('.qe-import-text');
        if (fill) fill.style.width = pct + '%';
        if (txt) txt.textContent = `Импорт ${i + 1} из ${total}...`;
    }
    modal?.remove();
    if (fail > 0) window.toast(`Добавлено: ${ok}, ошибок: ${fail}`, 'warning');
    else window.toast(`Добавлено задач: ${ok}`, 'success');
    await loadData(app);
}

async function importSingleTask(taskId) {
    const app = expressCurrentApp;
    try {
        await app.api.post(`/quick-estimate/import-task/${taskId}`);
        window.toast('Задача добавлена', 'success');
        document.getElementById('qe-modal')?.remove();
        await loadData(app);
    } catch (e) {
        window.toast('Ошибка: ' + e.message, 'error');
    }
}

// ==================== Delete Confirm Modal ====================

function showDeleteConfirm(message, onConfirm) {
    const html = `
    <div class="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center;" id="qe-modal">
        <div style="background:var(--bg-primary);border-radius:12px;padding:24px;width:400px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.3);">
            <h3 style="margin:0 0 12px;font-size:16px;">Подтверждение удаления</h3>
            <p style="font-size:13px;color:var(--text-secondary);margin:0 0 16px;">${escHtml(message)}</p>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button class="btn btn-secondary btn-sm" id="qe-confirm-cancel">Отмена</button>
                <button class="btn btn-danger btn-sm" id="qe-confirm-delete">Удалить</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('qe-modal');
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.getElementById('qe-confirm-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('qe-confirm-delete').addEventListener('click', async () => {
        await onConfirm();
        overlay.remove();
    });
}

// ==================== Hierarchy Actions (Event Delegation) ====================

let _hierarchyBound = false;

function bindHierarchyActions() {
    if (_hierarchyBound) return;
    _hierarchyBound = true;

    const section = document.getElementById('express-hierarchy-section');
    if (!section) return;

    section.addEventListener('click', (e) => {
        const toggle = e.target.closest('.qe-toggle');
        if (toggle) {
            const target = document.getElementById(toggle.dataset.target);
            if (target) {
                const hidden = target.style.display === 'none';
                target.style.display = hidden ? '' : 'none';
                const icon = toggle.querySelector('i, svg');
                if (icon) icon.style.transform = hidden ? '' : 'rotate(-90deg)';
            }
            return;
        }

        if (e.target.closest('.qe-add-epic-btn')) {
            const btn = e.target.closest('.qe-add-epic-btn');
            toggleEpicCreatePanel(parseInt(btn.dataset.taskId));
            return;
        }

        if (e.target.closest('.qe-del-epic-btn')) {
            const btn = e.target.closest('.qe-del-epic-btn');
            const epicId = parseInt(btn.dataset.epicId);
            const epic = findEpicById(epicId);
            const storyCount = epic?.stories?.length || 0;
            const msg = storyCount > 0
                ? `Удаление эпика приведёт к удалению ${storyCount} связанных историй. Продолжить?`
                : 'Удалить эпик?';
            showDeleteConfirm(msg, async () => {
                await expressCurrentApp.api.delete(`/quick-estimate/epics/${epicId}`);
                window.toast('Эпик удалён', 'success');
                await loadData(expressCurrentApp);
            });
            return;
        }

        if (e.target.closest('.qe-add-story-btn')) {
            const btn = e.target.closest('.qe-add-story-btn');
            toggleStoryCreatePanel(parseInt(btn.dataset.epicId));
            return;
        }

        if (e.target.closest('.qe-del-story-btn')) {
            const btn = e.target.closest('.qe-del-story-btn');
            const storyId = parseInt(btn.dataset.storyId);
            showDeleteConfirm('Удалить историю?', async () => {
                await expressCurrentApp.api.delete(`/quick-estimate/stories/${storyId}`);
                window.toast('История удалена', 'success');
                await loadData(expressCurrentApp);
            });
            return;
        }

        if (e.target.closest('.qe-del-task-btn')) {
            const btn = e.target.closest('.qe-del-task-btn');
            const taskId = parseInt(btn.dataset.taskId);
            showDeleteConfirm('Убрать задачу из экспресс-оценки? Она вернётся в предыдущий статус.', async () => {
                await expressCurrentApp.api.delete(`/quick-estimate/tasks/${taskId}`);
                window.toast('Задача убрана из экспресс-оценки', 'success');
                await loadData(expressCurrentApp);
            });
            return;
        }

        if (e.target.closest('.qe-inline-close')) {
            handleInlineClose(e.target.closest('.qe-inline-close'));
            return;
        }
    });

    section.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('qe-inline-title') && e.key === 'Enter') {
            e.preventDefault();
            handleInlineSave(e.target);
        }
        if (e.target.classList.contains('qe-inline-title') && e.key === 'Escape') {
            handleInlineClose(e.target);
        }
        if (e.target.classList.contains('qe-inline-field-input') && e.key === 'Escape') {
            const orig = e.target.dataset.original;
            if (orig !== undefined) e.target.value = orig;
            e.target.blur();
        }
        if (e.target.classList.contains('qe-inline-effort') && e.key === 'Enter') {
            e.preventDefault();
            const allInputs = Array.from(section.querySelectorAll('.qe-inline-effort'));
            const idx = allInputs.indexOf(e.target);
            if (idx >= 0 && idx < allInputs.length - 1) {
                allInputs[idx + 1].focus();
                allInputs[idx + 1].select();
            } else {
                e.target.blur();
            }
        }
        if (e.target.classList.contains('qe-inline-effort') && e.key === 'Escape') {
            const orig = e.target.dataset.original;
            if (orig !== undefined) e.target.value = orig;
            e.target.blur();
        }
    });

    section.addEventListener('input', (e) => {
        if (e.target.classList.contains('qe-effort-input')) {
            const inp = e.target;
            const panelId = inp.dataset.panelId;
            const container = inp.closest('.qe-create-slot');
            if (!container) return;
            const inputs = container.querySelectorAll('.qe-effort-input');
            let total = 0;
            inputs.forEach(i => { total += parseFloat(i.value) || 0; });
            const totalEl = container.querySelector(`[data-total-panel="${panelId}"]`);
            if (totalEl) totalEl.textContent = total.toFixed(1);
        }
        if (e.target.classList.contains('qe-inline-effort')) {
            const inp = e.target;
            const entityType = inp.dataset.entity;
            const entityId = parseInt(inp.dataset.id);
            const block = inp.closest(`.qe-${entityType}-block`);
            if (block) {
                const inputs = block.querySelectorAll('.qe-inline-effort');
                let total = 0;
                inputs.forEach(i => { total += parseFloat(i.value) || 0; });
                const totalEl = block.querySelector(`[data-total-${entityType}="${entityId}"]`);
                if (totalEl) totalEl.textContent = total.toFixed(1);
            }
        }
    });

    section.addEventListener('blur', (e) => {
        if (e.target.classList.contains('qe-inline-field-input')) {
            handleInlineFieldSave(e.target);
        }
        if (e.target.classList.contains('qe-inline-effort')) {
            handleInlineEffortSave(e.target);
        }
    }, true);

    section.addEventListener('change', (e) => {
        if (e.target.classList.contains('qe-inline-field-select')) {
            handleInlineFieldSave(e.target);
        }
    });

    // ---- Drag & Drop reorder (stories only) ----
    let _draggedEl = null;

    section.addEventListener('dragstart', (e) => {
        const handle = e.target.closest('.qe-drag-handle');
        if (!handle) { e.preventDefault(); return; }
        const block = handle.closest('.qe-story-block');
        if (!block) return;
        _draggedEl = block;
        block.classList.add('qe-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
    });

    section.addEventListener('dragover', (e) => {
        if (!_draggedEl) return;
        const target = e.target.closest('.qe-story-block');
        if (!target || target === _draggedEl) return;
        if (target.dataset.epicId !== _draggedEl.dataset.epicId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        target.classList.toggle('qe-drag-over-above', e.clientY < midY);
        target.classList.toggle('qe-drag-over-below', e.clientY >= midY);
    });

    section.addEventListener('dragleave', (e) => {
        const target = e.target.closest('.qe-story-block');
        if (target) {
            target.classList.remove('qe-drag-over-above', 'qe-drag-over-below');
        }
    });

    section.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!_draggedEl) return;
        const target = e.target.closest('.qe-story-block');
        if (!target || target === _draggedEl) return;
        target.classList.remove('qe-drag-over-above', 'qe-drag-over-below');

        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        const epicBlock = target.closest('.qe-epic-block');
        const body = epicBlock?.querySelector(`#epic-${epicBlock.dataset.epicId}`);
        if (body) {
            if (insertBefore) body.insertBefore(_draggedEl, target);
            else body.insertBefore(_draggedEl, target.nextSibling);
        }
        persistSortOrder();
    });

    section.addEventListener('dragend', () => {
        if (_draggedEl) _draggedEl.classList.remove('qe-dragging');
        section.querySelectorAll('.qe-drag-over-above, .qe-drag-over-below').forEach(el => {
            el.classList.remove('qe-drag-over-above', 'qe-drag-over-below');
        });
        _draggedEl = null;
    });

    if (window.lucide) window.lucide.createIcons();
}

// ==================== Drag & Drop Sort Persistence ====================

function persistSortOrder() {
    const app = expressCurrentApp;
    if (!app) return;
    const payload = { epics: [], stories: [] };
    document.querySelectorAll('.qe-epic-block').forEach(epicBlock => {
        const body = epicBlock.querySelector(`#epic-${epicBlock.dataset.epicId}`);
        if (!body) return;
        body.querySelectorAll('.qe-story-block').forEach((el, idx) => {
            payload.stories.push({ id: parseInt(el.dataset.storyId), sort_order: idx });
        });
    });
    app.api.patch('/quick-estimate/sort', payload).catch(e => {
        window.toast('Ошибка сортировки: ' + e.message, 'error');
        loadData(app);
    });
}

// ==================== Inline Panel Toggle ====================

function closeAllEditPanels() {
    document.querySelectorAll('.qe-create-slot').forEach(s => s.remove());
}

function toggleEpicCreatePanel(taskId) {
    closeAllEditPanels();
    const block = document.querySelector(`.qe-task-block[data-task-id="${taskId}"]`);
    if (!block) return;
    const body = block.querySelector(`#task-${taskId}`);
    if (!body) return;
    const addBtn = body.querySelector('.qe-add-epic-btn');
    const existing = body.querySelector('.qe-create-slot');
    if (existing) { existing.remove(); return; }
    const slot = document.createElement('div');
    slot.className = 'qe-create-slot';
    slot.style.cssText = 'border:1px dashed var(--border-color);border-radius:6px;margin-top:8px;padding:4px 8px;background:var(--bg-secondary);';
    slot.innerHTML = renderEpicEditPanel(null, taskId);
    body.insertBefore(slot, addBtn);
    slot.querySelector('.qe-inline-title')?.focus();
    if (window.lucide) window.lucide.createIcons();
}

function toggleStoryCreatePanel(epicId) {
    closeAllEditPanels();
    const epicBlock = document.querySelector(`.qe-epic-block[data-epic-id="${epicId}"]`);
    if (!epicBlock) return;
    const body = epicBlock.querySelector(`#epic-${epicId}`);
    if (!body) return;
    const addBtn = body.querySelector('.qe-add-story-btn');
    const existing = body.querySelector('.qe-create-slot');
    if (existing) { existing.remove(); return; }
    const slot = document.createElement('div');
    slot.className = 'qe-create-slot';
    slot.style.cssText = 'border:1px dashed var(--border-color);border-radius:6px;margin-top:6px;padding:4px 8px;background:var(--bg-secondary);';
    slot.innerHTML = renderStoryEditPanel(null, epicId);
    body.insertBefore(slot, addBtn);
    slot.querySelector('.qe-inline-title')?.focus();
    if (window.lucide) window.lucide.createIcons();
}

// ==================== Inline Save / Cancel ====================

function handleInlineClose(el) {
    const container = el.closest('.qe-create-slot');
    if (container) container.remove();
}

async function handleInlineFieldSave(el) {
    const app = expressCurrentApp;
    if (!app) return;
    const entity = el.dataset.entity;
    const id = parseInt(el.dataset.id);
    const field = el.dataset.field;
    const value = el.tagName === 'SELECT' ? el.value : el.value.trim();
    const original = el.dataset.original;
    if (String(value) === String(original || '')) return;

    const data = { [field]: value || null };
    try {
        if (entity === 'epic') {
            await app.api.put(`/quick-estimate/epics/${id}`, data);
            const epic = findEpicById(id);
            if (epic) epic[field] = value || null;
        } else {
            await app.api.put(`/quick-estimate/stories/${id}`, data);
            const story = findStoryById(id);
            if (story) story[field] = value || null;
        }
        el.dataset.original = value;
        if (field === 'priority') {
            const color = PRIORITY_COLORS[value] || '#6b7280';
            el.style.color = color;
            el.style.background = `${color}15`;
            el.style.borderColor = `${color}33`;
        }
        window.toast('Сохранено', 'success');
    } catch (e) {
        window.toast('Ошибка: ' + e.message, 'error');
        el.value = original || '';
    }
}

async function handleInlineEffortSave(el) {
    const app = expressCurrentApp;
    if (!app) return;
    const entity = el.dataset.entity;
    const id = parseInt(el.dataset.id);
    const field = el.dataset.field;
    const value = el.value === '' ? null : parseFloat(el.value);
    const original = el.dataset.original;
    if (String(value) === String(original || '')) return;

    const data = { [field]: value };
    if (entity === 'epic') {
        const epic = findEpicById(id);
        if (epic) epic[field] = value;
    } else {
        const story = findStoryById(id);
        if (story) story[field] = value;
    }
    el.dataset.original = value ?? '';
    updateParentDisplays(entity, id);
    updateChartData();

    try {
        if (entity === 'epic') {
            await app.api.put(`/quick-estimate/epics/${id}`, data);
        } else {
            await app.api.put(`/quick-estimate/stories/${id}`, data);
        }
    } catch (e) {
        window.toast('Ошибка: ' + e.message, 'error');
        el.value = original || '';
        el.dataset.original = original || '';
        if (entity === 'epic') {
            const epic = findEpicById(id);
            if (epic) epic[field] = original === '' ? null : parseFloat(original);
        } else {
            const story = findStoryById(id);
            if (story) story[field] = original === '' ? null : parseFloat(original);
        }
        updateParentDisplays(entity, id);
        updateChartData();
    }
}

function updateParentDisplays(entity, id) {
    if (entity === 'story') {
        const story = findStoryById(id);
        if (!story) return;
        const epicBlock = document.querySelector(`.qe-epic-block[data-epic-id="${story.epic_id}"]`);
        if (!epicBlock) return;
        const epicId = story.epic_id;
        const epic = findEpicById(epicId);
        if (!epic) return;
        const total = EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort({ ...epic, _type: 'epic' }, f), 0);
        const totalEl = epicBlock.querySelector(`[data-total-epic="${epicId}"]`);
        if (totalEl) totalEl.textContent = total.toFixed(1);
        COMPETENCIES.forEach(c => {
            const field = EFFORT_FIELD_MAP[c];
            const val = effectiveEffort({ ...epic, _type: 'epic' }, field);
            const displayEl = epicBlock.querySelector(`[data-effort-display="epic-${epicId}-${field}"]`);
            if (displayEl) displayEl.textContent = val || 0;
        });
        updateParentDisplays('epic', epicId);
    } else if (entity === 'epic') {
        const epic = findEpicById(id);
        if (!epic) return;
        const taskBlock = document.querySelector(`.qe-task-block[data-task-id="${epic.task_id}"]`);
        if (!taskBlock) return;
        const taskId = epic.task_id;
        const task = (expressData?.tasks || []).find(t => t.id === taskId);
        if (!task) return;
        const total = EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort({ ...task, _type: 'task' }, f), 0);
        const totalEl = taskBlock.querySelector(`[data-total-task="${taskId}"]`);
        if (totalEl) totalEl.textContent = total.toFixed(1) + ' ч/д';
        COMPETENCIES.forEach(c => {
            const field = EFFORT_FIELD_MAP[c];
            const val = effectiveEffort({ ...task, _type: 'task' }, field);
            const displayEl = taskBlock.querySelector(`[data-effort-display="task-${taskId}-${field}"]`);
            if (displayEl) displayEl.textContent = val || 0;
        });
    }
}

async function handleInlineSave(el) {
    const container = el.closest('.qe-create-slot, .qe-epic-edit-panel, .qe-story-edit-panel');
    if (!container) return;
    const app = expressCurrentApp;
    const entity = container.classList.contains('qe-epic-edit-panel') || container.querySelector('.qe-inline-title[data-entity="epic"]') ? 'epic' : 'story';
    const isCreate = container.classList.contains('qe-create-slot');
    const titleInput = container.querySelector('.qe-inline-title');
    const id = titleInput?.dataset.id;

    if (entity === 'epic') {
        const titleVal = titleInput?.value.trim();
        if (!titleVal) { window.toast('Укажите название эпика', 'warning'); return; }
        const data = {
            title: titleVal,
            priority: container.querySelector('.qe-inline-priority')?.value || null,
        };
        if (isCreate) {
            const taskId = container.closest('.qe-task-block')?.dataset.taskId;
            data.task_id = parseInt(taskId);
        }
        container.querySelectorAll('.qe-effort-input').forEach(inp => {
            data[inp.dataset.field] = inp.value === '' ? null : parseFloat(inp.value);
        });
        try {
            if (isCreate) {
                await app.api.post('/quick-estimate/epics', data);
                window.toast('Эпик создан', 'success');
            } else {
                await app.api.put(`/quick-estimate/epics/${id}`, data);
                window.toast('Эпик обновлён', 'success');
            }
            await loadData(app);
        } catch (e) { window.toast('Ошибка: ' + e.message, 'error'); }

    } else if (entity === 'story') {
        const titleVal = titleInput?.value.trim();
        if (!titleVal) { window.toast('Укажите название истории', 'warning'); return; }
        const data = {
            title: titleVal,
        };
        if (isCreate) {
            const epicId = container.closest('.qe-epic-block')?.dataset.epicId;
            data.epic_id = parseInt(epicId);
        }
        container.querySelectorAll('.qe-effort-input').forEach(inp => {
            data[inp.dataset.field] = inp.value === '' ? null : parseFloat(inp.value);
        });
        try {
            if (isCreate) {
                await app.api.post('/quick-estimate/stories', data);
                window.toast('История создана', 'success');
            } else {
                await app.api.put(`/quick-estimate/stories/${id}`, data);
                window.toast('История обновлена', 'success');
            }
            await loadData(app);
        } catch (e) { window.toast('Ошибка: ' + e.message, 'error'); }
    }
}

// ==================== Cascading Computation ====================

function effectiveEffort(item, field) {
    if (item._type === 'task') {
        const epics = item.epics || [];
        if (epics.length > 0) {
            return epics.reduce((s, e) => s + effectiveEffort({ ...e, _type: 'epic' }, field), 0);
        }
        return 0;
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

function calcTotalDemand() {
    const demand = {};
    COMPETENCIES.forEach(c => { demand[c] = 0; });
    for (const task of (expressData?.tasks || [])) {
        for (const epic of (task.epics || [])) {
            const stories = epic.stories || [];
            for (const story of stories) {
                COMPETENCIES.forEach(c => {
                    demand[c] += parseFloat(story[EFFORT_FIELD_MAP[c]]) || 0;
                });
            }
        }
    }
    return demand;
}

function calcSummaryByStatusPriority() {
    const groups = {};
    for (const task of (expressData?.tasks || [])) {
        const status = task.status_name || 'Неизвестно';
        const priority = task.priority_name || 'СРЕДНИЙ';
        const key = `${status}|||${priority}`;
        if (!groups[key]) groups[key] = { status, priority, demand: {}, totalCost: 0 };
        COMPETENCIES.forEach(c => {
            const field = EFFORT_FIELD_MAP[c];
            const val = effectiveEffort({ ...task, _type: 'task' }, field);
            groups[key].demand[c] = (groups[key].demand[c] || 0) + val;
        });
    }
    return Object.values(groups).map(g => {
        let totalCost = 0;
        COMPETENCIES.forEach(c => {
            const cost = competencyCosts.find(x => x.competency === c);
            totalCost += (g.demand[c] || 0) * (cost?.cost_per_day || 0);
        });
        g.totalCost = totalCost;
        return g;
    });
}

// ==================== Finders ====================

function findEpicById(epicId) {
    for (const t of (expressData?.tasks || [])) {
        const e = (t.epics || []).find(ep => ep.id === epicId);
        if (e) return e;
    }
    return null;
}

function findStoryById(storyId) {
    for (const t of (expressData?.tasks || [])) {
        for (const e of (t.epics || [])) {
            const s = (e.stories || []).find(st => st.id === storyId);
            if (s) return s;
        }
    }
    return null;
}

// ==================== Export ====================

function exportToExcel() {
    try {
        const XLSX = window.XLSX;
        if (!XLSX) { window.toast('Библиотека Excel не загружена', 'error'); return; }
        const wb = XLSX.utils.book_new();

        const rows = [['Задача', 'Эпик', 'Приоритет', 'История', ...COMPETENCIES, 'Итого']];
        for (const task of (expressData?.tasks || [])) {
            for (const epic of (task.epics || [])) {
                if ((epic.stories || []).length === 0) {
                    const total = COMPETENCIES.reduce((s, c) => s + (parseFloat(epic[EFFORT_FIELD_MAP[c]]) || 0), 0);
                    rows.push([task.title, epic.title, epic.priority || '', '', ...COMPETENCIES.map(c => parseFloat(epic[EFFORT_FIELD_MAP[c]]) || 0), total]);
                }
                for (const story of (epic.stories || [])) {
                    const total = COMPETENCIES.reduce((s, c) => s + (parseFloat(story[EFFORT_FIELD_MAP[c]]) || 0), 0);
                    rows.push([task.title, epic.title, epic.priority || '', story.title, ...COMPETENCIES.map(c => parseFloat(story[EFFORT_FIELD_MAP[c]]) || 0), total]);
                }
            }
        }
        const ws1 = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws1, 'Иерархия');

        const summary = calcSummaryByStatusPriority();
        const sRows = [['Статус', 'Приоритет', ...COMPETENCIES, 'Total Cost, руб']];
        summary.forEach(r => {
            sRows.push([r.status, r.priority, ...COMPETENCIES.map(c => (r.demand[c] || 0).toFixed(1)), r.totalCost]);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(sRows);
        XLSX.utils.book_append_sheet(wb, ws2, 'Сводная');

        XLSX.writeFile(wb, 'express_estimate.xlsx');
        window.toast('Экспорт выполнен', 'success');
    } catch (e) {
        window.toast('Ошибка экспорта: ' + e.message, 'error');
    }
}

// ==================== Helpers ====================

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatRub(val) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val || 0);
}
