console.log('[DMB] expressEstimate.js v20260910.2 loaded');

import { formatTaskPublicId } from '../taskPublicId.js';

const COMPETENCIES = ['Designee', 'Аналитика', 'Разработка BE', 'Разработка python BE', 'Разработка FE', 'Tester', 'Tester Auto', 'Delivery'];
const EFFORT_FIELDS = ['effort_designee', 'effort_analytics', 'effort_be', 'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery'];
const EFFORT_FIELD_MAP = {};
COMPETENCIES.forEach((c, i) => { EFFORT_FIELD_MAP[c] = EFFORT_FIELDS[i]; });
const FIELD_TO_LABEL = {};
EFFORT_FIELDS.forEach((f, i) => { FIELD_TO_LABEL[f] = COMPETENCIES[i]; });
const COMPETENCY_SHORT_LABELS = {
    'Designee': 'Des',
    'Аналитика': 'Аналит.',
    'Разработка BE': 'BE',
    'Разработка python BE': 'Py BE',
    'Разработка FE': 'FE',
    'Tester': 'QA',
    'Tester Auto': 'Auto QA',
    'Delivery': 'Delivery'
};

const CAPACITY_COEFFS = { senior: 1.3, middle: 1.0, junior: 0.8, lossFactor: 0.95 };
const EPIC_PRIORITIES = ['БЛОКИРУЮЩИЙ', 'КРИТИЧНЫЙ', 'ВЫСОКИЙ', 'СРЕДНИЙ', 'НИЗКИЙ'];
const PRIORITY_COLORS = { 'БЛОКИРУЮЩИЙ': '#dc2626', 'КРИТИЧНЫЙ': '#ef4444', 'ВЫСОКИЙ': '#f97316', 'СРЕДНИЙ': '#f59e0b', 'НИЗКИЙ': '#6b7280' };

let expressData = null;
let expressCurrentApp = null;
let teamResources = [];
let competencyCosts = [];
let resourcesEditing = false;
let resourceChartMode = 'util';
let selectedResourceCompetency = null;
let expressTaskSearch = '';
let expressTaskFilter = 'all';
const saveStateTimers = new Map();
const pendingEstimateSaves = new Set();
let resourceHelpOutsideHandler = null;

function effortTotal(item) {
    return EFFORT_FIELDS.reduce((sum, field) => sum + (Number(item?.[field]) || 0), 0);
}

function effortHasNegativeValue(item) {
    return EFFORT_FIELDS.some(field => (Number(item?.[field]) || 0) < 0);
}

function formatRussianCount(value, [one, few, many]) {
    const absolute = Math.abs(Number(value) || 0);
    const mod100 = absolute % 100;
    const mod10 = absolute % 10;
    const word = mod100 >= 11 && mod100 <= 14
        ? many
        : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
    return `${value} ${word}`;
}

export function calculateQuickEstimateReadiness(tasks = []) {
    const blockingTasks = [];

    tasks.forEach(task => {
        const blockers = [];
        const epics = task.epics || [];
        if (epics.length === 0) {
            blockers.push({
                code: 'missing_decomposition',
                entity_type: 'task',
                entity_id: task.id,
                entity_title: task.title,
                message: 'Добавьте хотя бы один эпик.'
            });
        }

        epics.forEach(epic => {
            const stories = epic.stories || [];
            const terminalItems = stories.length > 0
                ? stories.map(story => ({ entityType: 'story', item: story }))
                : [{ entityType: 'epic', item: epic }];
            terminalItems.forEach(({ entityType, item }) => {
                const entityLabel = entityType === 'story' ? 'истории' : 'эпика';
                if (effortHasNegativeValue(item)) {
                    blockers.push({
                        code: 'invalid_effort',
                        entity_type: entityType,
                        entity_id: item.id,
                        entity_title: item.title,
                        message: `Исправьте отрицательные трудозатраты ${entityLabel} «${item.title}».`
                    });
                } else if (effortTotal(item) <= 0) {
                    blockers.push({
                        code: 'missing_effort',
                        entity_type: entityType,
                        entity_id: item.id,
                        entity_title: item.title,
                        message: `Укажите трудозатраты ${entityLabel} «${item.title}».`
                    });
                }
            });
        });

        if (blockers.length > 0) {
            blockingTasks.push({
                task_id: task.id,
                public_id: task.public_id || null,
                title: task.title,
                blockers
            });
        }
    });

    return {
        ready: tasks.length > 0 && blockingTasks.length === 0,
        total_tasks: tasks.length,
        ready_tasks: tasks.length - blockingTasks.length,
        total_blockers: blockingTasks.reduce((sum, task) => sum + task.blockers.length, 0),
        blocking_tasks: blockingTasks
    };
}

function getQuickEstimateReadiness() {
    return expressData?.readiness || calculateQuickEstimateReadiness(expressData?.tasks || []);
}

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
            <button id="express-complete-btn" class="btn btn-primary btn-sm" disabled title="Завершить экспресс-оценку и перейти к принятию решения">
                <i data-lucide="check-circle"></i> Завершить оценку
            </button>
            <button id="express-export-btn" class="btn btn-secondary btn-sm" title="Экспорт в Excel">
                <i data-lucide="download"></i> Excel
            </button>
            <button aria-label="Обновить оценку" id="express-refresh-btn" class="square-icon btn btn-secondary btn-sm">
                <i data-lucide="refresh-cw"></i>
            </button>
        </div>
    </div>

    <div id="express-top-section"></div>
    <div id="express-hierarchy-section"></div>

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
    document.getElementById('express-complete-btn')?.addEventListener('click', showCompleteEstimateModal);
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
        expressData.readiness = resp.readiness || calculateQuickEstimateReadiness(resp.tasks || []);
        teamResources = resources;
        competencyCosts = costs;
        resourcesEditing = false;
        renderAll();
        const count = (resp.tasks || []).length;
        const el = document.getElementById('express-tasks-count');
        if (el) el.textContent = `Найдено: ${formatRussianCount(count, ['задача', 'задачи', 'задач'])}`;
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
    if (window.lucide) window.lucide.createIcons();
    updateCompleteControls();
}

function updateCompleteControls() {
    const button = document.getElementById('express-complete-btn');
    if (!button) return;
    const taskCount = expressData?.tasks?.length || 0;
    const readiness = getQuickEstimateReadiness();
    const isSaving = pendingEstimateSaves.size > 0;

    button.disabled = taskCount === 0 || isSaving;
    button.classList.toggle('btn-primary', readiness.ready && !isSaving);
    button.classList.toggle('btn-secondary', !readiness.ready || isSaving);
    if (isSaving) {
        button.title = 'Дождитесь сохранения текущих оценок';
        button.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Сохраняем оценки…';
    } else if (readiness.ready) {
        button.title = 'Завершить экспресс-оценку и перейти к принятию решения';
        button.innerHTML = '<i data-lucide="check-circle"></i> Завершить оценку';
    } else if (taskCount > 0) {
        button.title = 'Показать, что мешает завершить экспресс-оценку';
        button.innerHTML = '<i data-lucide="alert-triangle"></i> Проверить готовность';
    } else {
        button.title = 'Добавьте задачи для экспресс-оценки';
        button.innerHTML = '<i data-lucide="check-circle"></i> Завершить оценку';
    }
    if (window.lucide) window.lucide.createIcons();
}

function syncReadinessFromTasks() {
    if (!expressData) return;
    expressData.readiness = calculateQuickEstimateReadiness(expressData.tasks || []);

    const previousCard = document.getElementById('qe-readiness-card');
    if (previousCard) {
        previousCard.outerHTML = renderReadinessCard();
        bindReadinessActions();
    }

    const blockedTaskIds = new Set(expressData.readiness.blocking_tasks.map(task => task.task_id));
    document.querySelectorAll('.qe-task-block[data-task-id]').forEach(block => {
        const blocked = blockedTaskIds.has(Number(block.dataset.taskId));
        block.classList.toggle('qe-unestimated', blocked);
        const label = block.querySelector('.qe-task-readiness-label');
        if (label) label.hidden = !blocked;
    });
    applyTaskFilters();
    updateCompleteControls();
}

// ==================== Block 1+2: Resources + Chart (Compact) ====================

function renderTopSection() {
    const el = document.getElementById('express-top-section');
    if (!el) return;

    const isEdit = resourcesEditing;

    const resourceRows = COMPETENCIES.map(competency => {
        const existing = teamResources.find(item => item.competency === competency);
        return existing || {
            competency,
            senior_count: 0,
            middle_count: 0,
            junior_count: 0,
            vacation_days: 0,
            working_days: 66,
            capacity: 0
        };
    });

    let tableRows;
    if (isEdit) {
        tableRows = resourceRows.map(r => `
            <tr>
                <td class="qe-resource-table-name" title="${escAttr(r.competency)}"><strong>${escHtml(COMPETENCY_SHORT_LABELS[r.competency] || r.competency)}</strong><span>${escHtml(r.competency)}</span></td>
                <td style="text-align:center"><input title="Количество специалистов Senior" aria-label="Senior: ${escAttr(r.competency)}" type="number" min="0" class="input input-xs ui-control ui-number-cell res-edit" data-comp="${escHtml(r.competency)}" data-field="senior_count" value="${r.senior_count}" style="width:48px;text-align:center"></td>
                <td style="text-align:center"><input title="Количество специалистов Middle" aria-label="Middle: ${escAttr(r.competency)}" type="number" min="0" class="input input-xs ui-control ui-number-cell res-edit" data-comp="${escHtml(r.competency)}" data-field="middle_count" value="${r.middle_count}" style="width:48px;text-align:center"></td>
                <td style="text-align:center"><input title="Количество специалистов Junior" aria-label="Junior: ${escAttr(r.competency)}" type="number" min="0" class="input input-xs ui-control ui-number-cell res-edit" data-comp="${escHtml(r.competency)}" data-field="junior_count" value="${r.junior_count}" style="width:48px;text-align:center"></td>
                <td style="text-align:center"><input title="Суммарные дни отпуска по компетенции" aria-label="Дни отпуска: ${escAttr(r.competency)}" type="number" min="0" class="input input-xs ui-control ui-number-cell res-edit" data-comp="${escHtml(r.competency)}" data-field="vacation_days" value="${r.vacation_days}" style="width:48px;text-align:center"></td>
                <td style="text-align:center"><input title="Рабочие дни в расчётном периоде" aria-label="Рабочие дни: ${escAttr(r.competency)}" type="number" min="1" class="input input-xs ui-control ui-number-cell res-edit" data-comp="${escHtml(r.competency)}" data-field="working_days" value="${r.working_days}" style="width:48px;text-align:center"></td>
                <td style="text-align:center;font-weight:700">${r.capacity.toFixed(1)}</td>
            </tr>
        `).join('');
    } else {
        tableRows = resourceRows.map(r => `
            <tr>
                <td class="qe-resource-table-name" title="${escAttr(r.competency)}"><strong>${escHtml(COMPETENCY_SHORT_LABELS[r.competency] || r.competency)}</strong><span>${escHtml(r.competency)}</span></td>
                <td style="text-align:center">${r.senior_count}</td>
                <td style="text-align:center">${r.middle_count}</td>
                <td style="text-align:center">${r.junior_count}</td>
                <td style="text-align:center">${r.vacation_days}</td>
                <td style="text-align:center">${r.working_days}</td>
                <td style="text-align:center;font-weight:700">${r.capacity.toFixed(1)}</td>
            </tr>
        `).join('');
    }

    const editBtns = isEdit
        ? `<button class="btn btn-xs btn-danger" id="res-cancel-btn">Отмена</button>
           <button class="btn btn-xs btn-primary" id="res-save-btn">Сохранить</button>`
        : `<button class="btn btn-xs btn-secondary" id="res-edit-btn"><i data-lucide="pencil"></i> Редактировать ресурсы</button>`;

    el.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:8px;">
        <h3 style="font-size:15px;font-weight:600;margin:0;">Ресурсы и потребности</h3>
    </div>
    <div class="qe-resource-meta">
        <span><i data-lucide="calendar-range"></i> Расчётный период: квартал</span>
        <span><i data-lucide="ruler"></i> Единица: чел./дн.</span>
        <details class="qe-resource-help">
            <summary><i data-lucide="info"></i> Как считается</summary>
            <div class="qe-resource-help-popover">
                <strong>Capacity — доступный ресурс</strong>
                <code>(Sr × РД × ${CAPACITY_COEFFS.senior} + Md × РД × ${CAPACITY_COEFFS.middle} + Jr × РД × ${CAPACITY_COEFFS.junior}) × ${CAPACITY_COEFFS.lossFactor} − Отп.</code>
                <span>Sr, Md, Jr — количество Senior, Middle и Junior; РД — рабочие дни в периоде; Отп. — суммарные дни отпуска.</span>
                <span>Demand — сумма оценок задач по компетенции. Если Demand выше Capacity, возникает дефицит.</span>
            </div>
        </details>
    </div>
    <div class="qe-resource-overview">
        <div class="qe-resource-layout">
            <section class="qe-resource-panel qe-capacity-panel">
                <div class="qe-panel-head">
                    <div><strong>Состав команды</strong><span>Специалисты и доступный Capacity · ${resourceRows.length} компетенций</span></div>
                    <div class="qe-panel-actions">
                        ${editBtns}
                    </div>
                </div>
                <div class="qe-resource-table-wrap">
                <table class="ui-table ui-table-editor table qe-resource-table" data-ui-layout="resource">
                    <thead>
                        <tr>
                            <th style="white-space:nowrap">Компетенция</th>
                            <th title="Senior, коэффициент ${CAPACITY_COEFFS.senior}" style="width:56px;text-align:center">Sr</th>
                            <th title="Middle, коэффициент ${CAPACITY_COEFFS.middle}" style="width:56px;text-align:center">Md</th>
                            <th title="Junior, коэффициент ${CAPACITY_COEFFS.junior}" style="width:56px;text-align:center">Jr</th>
                            <th title="Суммарные дни отпуска по компетенции" style="width:56px;text-align:center">Отп.</th>
                            <th title="Рабочие дни в расчётном периоде" style="width:56px;text-align:center">РД</th>
                            <th title="Доступный Capacity, чел./дн." style="width:64px;text-align:center">Capacity</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
                </div>
            </section>
            <section class="qe-resource-panel qe-resource-cockpit-wrap">
                <div id="qe-resource-cockpit"></div>
            </section>
        </div>
    </div>`;

    if (window.lucide) window.lucide.createIcons();
    renderResourceCockpit();
    bindResourceActions();
    bindResourceHelpDismiss();
}

function bindResourceHelpDismiss() {
    if (resourceHelpOutsideHandler) {
        document.removeEventListener('pointerdown', resourceHelpOutsideHandler);
    }
    resourceHelpOutsideHandler = event => {
        const help = document.querySelector('.qe-resource-help[open]');
        if (help && !help.contains(event.target)) help.removeAttribute('open');
    };
    document.addEventListener('pointerdown', resourceHelpOutsideHandler);
}

function renderResourceCockpit() {
    const container = document.getElementById('qe-resource-cockpit');
    if (!container) return;
    const demand = calcTotalDemand();
    const rows = COMPETENCIES.map(competency => {
        const resource = teamResources.find(item => item.competency === competency);
        const capacity = resource?.capacity || 0;
        const needed = demand[competency] || 0;
        const utilization = capacity > 0 ? needed / capacity * 100 : (needed > 0 ? null : 0);
        const balance = capacity - needed;
        const state = capacity <= 0 && needed <= 0 ? 'empty'
            : utilization === null || utilization > 100.05 ? 'over'
                : utilization < 80 ? 'under' : 'good';
        return { competency, capacity, needed, utilization, balance, state };
    });
    const counts = rows.reduce((result, row) => {
        if (row.state !== 'empty') result[row.state]++;
        return result;
    }, { over: 0, good: 0, under: 0 });
    const maxAbsBalance = Math.max(1, ...rows.map(row => Math.abs(row.balance)));
    if (!selectedResourceCompetency || !rows.some(row => row.competency === selectedResourceCompetency)) {
        selectedResourceCompetency = rows.find(row => row.state === 'over')?.competency || rows[0]?.competency;
    }

    const rowsHtml = rows.map(row => {
        let width;
        let offset = 0;
        let value;
        if (resourceChartMode === 'util') {
            width = row.utilization === null ? 100 : Math.min(row.utilization, 160) / 1.6;
            value = row.utilization === null ? '∞' : `${row.utilization.toFixed(0)}%`;
        } else {
            width = Math.abs(row.balance) / maxAbsBalance * 50;
            offset = row.balance < 0 ? 50 - width : 50;
            value = `${row.balance > 0 ? '+' : ''}${row.balance.toFixed(1)}`;
        }
        const selected = row.competency === selectedResourceCompetency;
        return `<button type="button" class="ui-surface-action qe-resource-row" data-competency="${escAttr(row.competency)}" aria-selected="${selected}" aria-label="${escAttr(row.competency)}: Demand ${row.needed.toFixed(1)}, Capacity ${row.capacity.toFixed(1)}, ${value}">
            <span class="qe-resource-name" title="${escAttr(row.competency)}">${escHtml(COMPETENCY_SHORT_LABELS[row.competency] || row.competency)}</span>
            <span class="qe-resource-track ${resourceChartMode}"><span class="qe-resource-bar ${row.state}" style="width:${width}%;margin-left:${offset}%"></span></span>
            <span class="qe-resource-values"><b>${row.needed.toFixed(1)}</b><span>/ ${row.capacity.toFixed(1)}</span><em class="${row.state}">${value}</em></span>
        </button>`;
    }).join('');
    const selectedRow = rows.find(row => row.competency === selectedResourceCompetency) || rows[0];
    let detail = '';
    if (selectedRow) {
        detail = selectedRow.state === 'empty'
            ? `${selectedRow.competency}: Capacity и Demand не заданы`
            : selectedRow.balance < 0
                ? `${selectedRow.competency}: дефицит ${Math.abs(selectedRow.balance).toFixed(1)} чел./дн. — нужно перераспределение или снижение объёма`
                : `${selectedRow.competency}: резерв ${selectedRow.balance.toFixed(1)} чел./дн. — доступен для дополнительной нагрузки`;
    }
    const balanceAxis = resourceChartMode === 'balance';
    container.innerHTML = `
        <div class="qe-cockpit-head">
            <div><strong>Ресурсный баланс</strong><span>Demand / Capacity · чел./дн.</span></div>
            <div class="qe-cockpit-switch" role="group" aria-label="Режим диаграммы">
                <button class="btn btn-secondary btn-sm ui-btn" data-mode="util" aria-pressed="${!balanceAxis}">Утилизация</button>
                <button class="btn btn-secondary btn-sm ui-btn" data-mode="balance" aria-pressed="${balanceAxis}">Баланс</button>
            </div>
        </div>
        <div class="qe-cockpit-column-head">
            <div class="qe-cockpit-summary"><span class="over"><b>${counts.over}</b> дефицит</span><span class="good"><b>${counts.good}</b> в норме</span><span class="under"><b>${counts.under}</b> резерв</span></div>
            <div class="qe-cockpit-axis"><span>${balanceAxis ? `−${maxAbsBalance.toFixed(0)}` : '0%'}</span><span>${balanceAxis ? '0 · баланс' : '100% Capacity'}</span><span>${balanceAxis ? `+${maxAbsBalance.toFixed(0)}` : '160%'}</span></div>
        </div>
        <div class="qe-resource-rows">${rowsHtml}</div>
        <div class="qe-resource-detail">${escHtml(detail)}</div>`;

    container.querySelectorAll('.qe-cockpit-switch button').forEach(button => {
        button.addEventListener('click', () => {
            resourceChartMode = button.dataset.mode;
            renderResourceCockpit();
        });
    });
    container.querySelectorAll('.qe-resource-row').forEach(button => {
        button.addEventListener('click', () => {
            selectedResourceCompetency = button.dataset.competency;
            renderResourceCockpit();
        });
    });
}

function updateChartData() {
    renderResourceCockpit();
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

    const updated = COMPETENCIES.map(competency => {
        const row = { competency };
        document.querySelectorAll(`.res-edit[data-comp="${CSS.escape(competency)}"]`).forEach(inp => {
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
        ? `<div class="qe-empty-state">
            <div class="qe-empty-icon"><i data-lucide="plus-circle"></i></div>
            <h4>Начните экспресс-оценку</h4>
            <p>Добавьте задачу из бэклога и декомпозируйте её до оцениваемых элементов.</p>
            <div class="qe-empty-steps" aria-label="Этапы экспресс-оценки">
                <span><b>1</b> Добавьте задачу</span>
                <i data-lucide="chevron-right"></i>
                <span><b>2</b> Создайте эпики и истории</span>
                <i data-lucide="chevron-right"></i>
                <span><b>3</b> Внесите оценки</span>
            </div>
            <button class="btn btn-primary btn-sm" id="express-empty-add-btn"><i data-lucide="plus"></i> Добавить задачу из бэклога</button>
        </div>`
        : tasks.map(t => renderTaskBlock(t)).join('');

    el.innerHTML = `
    <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <h3 style="font-size:15px;font-weight:600;margin:0;">Экспресс-оценка</h3>
            <button id="express-import-btn" class="btn btn-primary btn-sm">
                <i data-lucide="plus"></i> Добавить задачу из бэклога
            </button>
        </div>
        ${tasks.length > 0 ? renderReadinessCard() : ''}
        <div class="qe-list-toolbar" ${tasks.length === 0 ? 'style="display:none;"' : ''}>
            <label class="qe-task-search">
                <i data-lucide="search" aria-hidden="true"></i>
                <input class="input ui-control" id="qe-task-search-input" type="search" value="${escAttr(expressTaskSearch)}" placeholder="Поиск по ID или названию" aria-label="Поиск задач экспресс-оценки">
            </label>
            <div class="qe-estimate-filters" role="group" aria-label="Фильтр по готовности оценки">
                <button class="btn btn-secondary btn-sm ui-btn qe-estimate-filter${expressTaskFilter === 'all' ? ' active' : ''}" data-filter="all" aria-pressed="${expressTaskFilter === 'all'}">Все</button>
                <button class="btn btn-secondary btn-sm ui-btn qe-estimate-filter${expressTaskFilter === 'blocked' ? ' active' : ''}" data-filter="blocked" aria-pressed="${expressTaskFilter === 'blocked'}">Требуют внимания</button>
                <button class="btn btn-secondary btn-sm ui-btn qe-estimate-filter${expressTaskFilter === 'ready' ? ' active' : ''}" data-filter="ready" aria-pressed="${expressTaskFilter === 'ready'}">Готовые</button>
            </div>
            <span id="qe-filtered-count" class="qe-filtered-count"></span>
            <div class="qe-collapse-actions">
                <button class="btn btn-xs btn-secondary" id="qe-collapse-all-btn" title="Свернуть все задачи и эпики"><i data-lucide="chevrons-up"></i> Свернуть всё</button>
                <button class="btn btn-xs btn-secondary" id="qe-expand-all-btn" title="Развернуть все задачи и эпики"><i data-lucide="chevrons-down"></i> Развернуть всё</button>
            </div>
        </div>
        <div class="qe-task-list-scroll">
            ${tasksHtml}
            <div id="qe-filter-empty" class="qe-filter-empty" style="display:none;">По заданным условиям задач не найдено</div>
        </div>
    </div>`;

    document.getElementById('express-import-btn')?.addEventListener('click', showImportModal);
    document.getElementById('express-empty-add-btn')?.addEventListener('click', showImportModal);
    bindReadinessActions();
    bindListToolbar();
    bindHierarchyActions();
    applyTaskFilters();
}

function renderReadinessCard() {
    const readiness = getQuickEstimateReadiness();
    if (readiness.ready) {
        return `
        <section class="qe-readiness-card is-ready" id="qe-readiness-card" aria-live="polite">
            <div class="qe-readiness-icon"><i data-lucide="check-circle"></i></div>
            <div class="qe-readiness-copy">
                <strong>Готово к завершению: ${formatRussianCount(readiness.total_tasks, ['задача', 'задачи', 'задач'])}</strong>
                <span>Каждая задача декомпозирована, а каждый конечный эпик или история содержит положительную оценку трудозатрат.</span>
            </div>
            <span class="qe-readiness-count">Готово ${readiness.ready_tasks} из ${readiness.total_tasks}</span>
        </section>`;
    }
    return `
    <section class="qe-readiness-card is-blocked" id="qe-readiness-card" aria-live="polite">
        <div class="qe-readiness-icon"><i data-lucide="alert-triangle"></i></div>
        <div class="qe-readiness-copy">
            <strong>Нужно доработать: ${readiness.blocking_tasks.length} из ${formatRussianCount(readiness.total_tasks, ['задачи', 'задач', 'задач'])}</strong>
            <span>${formatRussianCount(readiness.total_blockers, ['элемент', 'элемента', 'элементов'])} ${readiness.total_blockers === 1 ? 'блокирует' : 'блокируют'} завершение. Добавьте декомпозицию и укажите хотя бы одну положительную оценку для каждого конечного элемента.</span>
        </div>
        <button class="btn btn-sm btn-secondary" id="qe-readiness-review-btn">Показать задачи</button>
    </section>`;
}

function bindReadinessActions() {
    document.getElementById('qe-readiness-review-btn')?.addEventListener('click', reviewBlockingTasks);
}

function setEstimateFilter(filter) {
    expressTaskFilter = filter;
    document.querySelectorAll('.qe-estimate-filter').forEach(item => {
        const active = item.dataset.filter === filter;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
    });
    applyTaskFilters();
}

function reviewBlockingTasks() {
    document.getElementById('qe-modal')?.remove();
    setEstimateFilter('blocked');
    const firstTaskId = getQuickEstimateReadiness().blocking_tasks[0]?.task_id;
    const firstBlock = firstTaskId
        ? document.querySelector(`.qe-task-block[data-task-id="${firstTaskId}"]`)
        : null;
    firstBlock?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function bindListToolbar() {
    document.getElementById('qe-task-search-input')?.addEventListener('input', (event) => {
        expressTaskSearch = event.target.value;
        applyTaskFilters();
    });
    document.querySelectorAll('.qe-estimate-filter').forEach(button => {
        button.addEventListener('click', () => {
            setEstimateFilter(button.dataset.filter);
        });
    });
    document.getElementById('qe-collapse-all-btn')?.addEventListener('click', () => setHierarchyCollapsed(true));
    document.getElementById('qe-expand-all-btn')?.addEventListener('click', () => setHierarchyCollapsed(false));
}

function applyTaskFilters() {
    const tasks = expressData?.tasks || [];
    const blockingTaskIds = new Set(getQuickEstimateReadiness().blocking_tasks.map(task => task.task_id));
    const normalizedQuery = expressTaskSearch.trim().toLocaleLowerCase('ru-RU');
    const idQuery = normalizedQuery.replace(/^#/, '');
    let visibleCount = 0;

    tasks.forEach(task => {
        const blocked = blockingTaskIds.has(task.id);
        const matchesSearch = !normalizedQuery
            || String(task.id).includes(idQuery)
            || formatTaskPublicId(task).toLowerCase().includes(idQuery)
            || String(task.title || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery);
        const matchesFilter = expressTaskFilter === 'all'
            || (expressTaskFilter === 'ready' && !blocked)
            || (expressTaskFilter === 'blocked' && blocked);
        const visible = matchesSearch && matchesFilter;
        const block = document.querySelector(`.qe-task-block[data-task-id="${task.id}"]`);
        if (block) block.hidden = !visible;
        if (visible) visibleCount++;
    });

    const count = document.getElementById('qe-filtered-count');
    if (count) count.textContent = `Показано ${visibleCount} из ${tasks.length}`;
    const empty = document.getElementById('qe-filter-empty');
    if (empty) empty.style.display = tasks.length > 0 && visibleCount === 0 ? 'block' : 'none';
}

function setHierarchyCollapsed(collapsed) {
    const section = document.getElementById('express-hierarchy-section');
    if (!section) return;
    section.querySelectorAll('.qe-toggle[data-target]').forEach(toggle => {
        const taskBlock = toggle.closest('.qe-task-block');
        if (taskBlock?.hidden) return;
        const target = document.getElementById(toggle.dataset.target);
        if (!target) return;
        target.style.display = collapsed ? 'none' : '';
        const icon = toggle.matches('svg, i') ? toggle : toggle.querySelector('svg, i');
        if (icon) icon.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
}

function renderTaskBlock(task) {
    const epics = task.epics || [];
    const total = EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort({ ...task, _type: 'task' }, f), 0);
    const isBlocked = getQuickEstimateReadiness().blocking_tasks.some(item => item.task_id === task.id);
    const estimateClass = isBlocked ? ' qe-unestimated' : '';
    const epicsHtml = epics.map(e => renderEpicBlock(e, task.id)).join('');
    const taskToggleAttrs = epics.length
        ? `class="qe-toggle qe-estimate-row" data-target="task-${task.id}"`
        : 'class="qe-estimate-row"';
    const taskEffort = {};
    if (epics.length > 0) {
        COMPETENCIES.forEach(c => { taskEffort[EFFORT_FIELD_MAP[c]] = effectiveEffort({ ...task, _type: 'task' }, EFFORT_FIELD_MAP[c]); });
    }
    return `
    <div class="qe-task-block${estimateClass}" data-task-id="${task.id}" style="border:1px solid var(--border-color);border-radius:6px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px 6px 0 0;" ${taskToggleAttrs}>
            <div class="qe-entity-title" style="display:flex;align-items:center;gap:8px;overflow:hidden;">
                ${epics.length ? '<i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--text-muted);transition:transform .2s;flex-shrink:0;"></i>' : ''}
                <i data-lucide="clipboard-check" style="width:16px;height:16px;color:var(--accent);flex-shrink:0;" title="Задача"></i>
                <strong style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(task.title)}</strong>
                <span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-secondary);white-space:nowrap;">(${epics.length} эпиков)</span>
                <span class="qe-unestimated-label qe-task-readiness-label" ${isBlocked ? '' : 'hidden'} title="Для завершения оценки устраните блокеры">Требует внимания</span>
            </div>
            ${renderEffortInline(task, 'task', true, taskEffort)}
            <span class="qe-effort-total" style="font-weight:700;font-size:13px;min-width:60px;text-align:right;white-space:nowrap;margin-left:auto;" data-total-task="${task.id}">${total.toFixed(1)} ч/д</span>
            <button class="btn btn-sm square-icon btn-secondary qe-exclude-task-btn" data-task-id="${task.id}" title="Исключить из экспресс-оценки" aria-label="Исключить задачу из экспресс-оценки" style="margin-left:8px;"><i data-lucide="minus-circle"></i></button>
        </div>
        <div id="task-${task.id}" style="padding:8px 0 8px 12px;">
            ${epicsHtml}
            <button class="btn btn-xs btn-secondary qe-add-epic-btn" data-task-id="${task.id}" style="margin-top:8px;">
                <i data-lucide="plus"></i> Добавить эпик
            </button>
        </div>
    </div>`;
}

// ==================== Epic Block + Inline Edit ====================

function renderEpicBlock(epic, taskId) {
    const stories = epic.stories || [];
    const total = EFFORT_FIELDS.reduce((s, f) => s + effectiveEffort({ ...epic, _type: 'epic' }, f), 0);
    const estimateClass = total > 0 ? '' : ' qe-unestimated';
    const storiesHtml = stories.map(s => renderStoryBlock(s, epic.id)).join('');
    const priColor = PRIORITY_COLORS[epic.priority] || '#6b7280';
    const priOptions = EPIC_PRIORITIES.map(p => `<option value="${p}" ${epic.priority === p ? 'selected' : ''}>${p}</option>`).join('');
    const hasStories = stories.length > 0;
    const epicToggle = hasStories
        ? `<i data-lucide="chevron-down" style="width:14px;height:14px;color:var(--text-muted);cursor:pointer;transition:transform .2s;flex-shrink:0;" class="qe-toggle" data-target="epic-${epic.id}"></i>`
        : '';
    const epicEffort = {};
    if (hasStories) {
        COMPETENCIES.forEach(c => { epicEffort[EFFORT_FIELD_MAP[c]] = effectiveEffort({ ...epic, _type: 'epic' }, EFFORT_FIELD_MAP[c]); });
    }
    return `
    <div class="qe-epic-block${estimateClass}" data-epic-id="${epic.id}" data-task-id="${taskId}" draggable="true" style="border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;margin-left:16px;">
        <div class="qe-estimate-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:6px 6px 0 0;position:relative;">
            <div class="qe-entity-title" style="display:flex;align-items:center;gap:6px;overflow:hidden;">
                <i data-lucide="grip-vertical" style="width:14px;height:14px;color:var(--text-muted);cursor:grab;flex-shrink:0;" class="qe-drag-handle" data-drag-type="epic" title="Изменить порядок эпика"></i>
                ${epicToggle}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><title>Эпик</title><rect width="16" height="16" rx="2.5" fill="#904EE2"/><g transform="translate(5,4)" fill="#FFF"><path d="M5.92 3.76l-.004-.004c.046-.08.08-.162.08-.256 0-.276-.224-.5-.5-.5H3V.5C3 .224 2.776 0 2.5 0c-.172 0-.315.092-.405.223-.028.04-.051.083-.066.13L.08 4.24l.002.002C.035 4.32 0 4.4 0 4.5c0 .276.224.5.5.5H3v2.5c0 .276.224.5.5.5.18 0 .33-.1.418-.242l.003.002.013-.026c.011-.02.023-.04.031-.062l1.958-3.915z"/></g></svg>
                <input type="text" class="input ui-control qe-inline-field-input" data-entity="epic" data-id="${epic.id}" data-field="title" data-original="${escHtml(epic.title)}" value="${escHtml(epic.title)}" style="min-width:40px;flex:1;overflow:hidden;text-overflow:ellipsis" onfocus="this.style.borderColor='var(--border-color)';this.style.background='var(--bg-primary)';" onblur="this.style.borderColor='transparent';this.style.background='transparent';">
                <select class="input ui-control qe-inline-field-select" data-entity="epic" data-id="${epic.id}" data-field="priority" data-original="${epic.priority || ''}" style="max-width:120px;flex-shrink:0">
                    <option value="">—</option>${priOptions}
                </select>
                <span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-secondary);white-space:nowrap;flex-shrink:0;">(${stories.length})</span>
                ${renderUnestimatedLabel()}
            </div>
            ${renderEffortInline(epic, 'epic', hasStories, hasStories ? epicEffort : null)}
            <span class="qe-effort-total" style="font-weight:600;font-size:13px;min-width:60px;text-align:right;white-space:nowrap;margin-left:auto;" data-total-epic="${epic.id}">${total.toFixed(1)}</span>
            ${renderSaveState('epic', epic.id)}
            <button class="btn btn-sm square-icon btn-danger qe-del-epic-btn" data-epic-id="${epic.id}" title="Удалить" style="margin-left:8px;"><i data-lucide="trash-2"></i></button>
        </div>
        <div id="epic-${epic.id}" style="padding:6px 0 6px 12px;">
            ${storiesHtml}
            <button class="btn btn-xs btn-secondary qe-add-story-btn" data-epic-id="${epic.id}" style="margin-top:6px;">
                <i data-lucide="plus"></i> Добавить историю
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
        return `<td style="text-align:center"><input title="${escAttr(c)}" aria-label="${escAttr(c)}" type="number" step="0.5" min="0" class="input ui-control ui-number-cell qe-effort-input" data-field="${field}" data-panel-id="${epic?.id || 'new-epic'}" value="${val}" placeholder="0" style="width:52px;text-align:center"></td>`;
    }).join('');
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(epic?.[f]) || 0), 0);
    const effortCells = hasNoStories ? effortInputs : COMPETENCIES.map(() => '<td style="text-align:center;color:var(--text-muted)">—</td>').join('');
    return `
    <table class="ui-table ui-table-editor" style="width:100%">
        <thead>
            <tr>
                <th style="text-align:left">Название</th>
                <th style="text-align:left;width:130px">Приоритет</th>
                ${COMPETENCIES.map(c => `<th title="${escAttr(c)}" style="text-align:center">${COMPETENCY_SHORT_LABELS[c] || c}</th>`).join('')}
                <th style="text-align:center;min-width:40px">Итого</th>
                <th style="width:30px"></th>
            </tr>
        </thead>
        <tbody>
        <tr>
            <td style="flex:2"><input type="text" class="input ui-control qe-inline-title" data-entity="epic" data-id="${epic?.id || ''}" value="${escHtml(epic?.title || '')}" placeholder="Название эпика" style="width:100%"></td>
            <td style="flex:0 0 130px"><select class="input ui-control qe-inline-priority" data-entity="epic" data-id="${epic?.id || ''}" style="width:100%"><option value="">—</option>${priOptions}</select></td>
            ${effortCells}
            <td style="text-align:center;font-weight:700;min-width:40px" data-total-panel="${epic?.id || 'new-epic'}">${total.toFixed(1)}</td>
            <td ><button class="btn btn-xs btn-secondary qe-inline-close" data-entity="epic" data-id="${epic?.id || ''}" title="Закрыть (Esc)">&times;</button></td>
        </tr>
        </tbody>
    </table>`;
}

// ==================== Story Block + Inline Edit ====================

function renderStoryBlock(story, epicId) {
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(story[f]) || 0), 0);
    const estimateClass = total > 0 ? '' : ' qe-unestimated';
    return `
    <div class="qe-story-block${estimateClass}" data-story-id="${story.id}" data-epic-id="${epicId}" draggable="true" style="border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;margin-left:32px;">
        <div class="qe-estimate-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px 6px 0 0;overflow:visible;position:relative;">
            <div class="qe-entity-title" style="display:flex;align-items:center;gap:6px;overflow:hidden;">
                <i data-lucide="grip-vertical" style="width:14px;height:14px;color:var(--text-muted);cursor:grab;flex-shrink:0;" class="qe-drag-handle" data-drag-type="story" title="Изменить порядок истории"></i>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><title>История</title><rect width="16" height="16" rx="2.5" fill="#63BA3C"/><path d="M10 3H6a1 1 0 00-1 1v7a.5.5 0 00.91.269L7.84 9.04a.5.5 0 01.68 0l1.99 2.229A.5.5 0 0011 11V4a1 1 0 00-1-1z" fill="#FFF"/></svg>
                <input type="text" class="input ui-control qe-inline-field-input" data-entity="story" data-id="${story.id}" data-field="title" data-original="${escHtml(story.title)}" value="${escHtml(story.title)}" style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis" onfocus="this.style.borderColor='var(--border-color)';this.style.background='var(--bg-primary)';" onblur="this.style.borderColor='transparent';this.style.background='transparent';">
                ${renderUnestimatedLabel()}
            </div>
            ${renderEffortInline(story, 'story')}
            <span class="qe-effort-total" style="font-weight:600;font-size:13px;min-width:60px;text-align:right;white-space:nowrap;margin-left:auto;" data-total-story="${story.id}">${total.toFixed(1)}</span>
            ${renderSaveState('story', story.id)}
            <button class="btn btn-sm square-icon btn-danger qe-del-story-btn" data-story-id="${story.id}" title="Удалить" style="margin-left:8px;"><i data-lucide="trash-2"></i></button>
        </div>
    </div>`;
}

function renderStoryEditPanel(story, epicId) {
    const effortInputs = COMPETENCIES.map(c => {
        const field = EFFORT_FIELD_MAP[c];
        const val = story?.[field] ?? '';
        return `<td style="text-align:center"><input title="${escAttr(c)}" aria-label="${escAttr(c)}" type="number" step="0.5" min="0" class="input ui-control ui-number-cell qe-effort-input" data-field="${field}" data-panel-id="${story?.id || 'new-story'}" value="${val}" placeholder="0" style="width:52px;text-align:center"></td>`;
    }).join('');
    const total = EFFORT_FIELDS.reduce((s, f) => s + (parseFloat(story?.[f]) || 0), 0);
    return `
    <table class="ui-table ui-table-editor" style="width:100%">
        <thead>
            <tr>
                <th style="text-align:left">Название</th>
                ${COMPETENCIES.map(c => `<th title="${escAttr(c)}" style="text-align:center">${COMPETENCY_SHORT_LABELS[c] || c}</th>`).join('')}
                <th style="text-align:center;min-width:40px">Итого</th>
                <th style="width:30px"></th>
            </tr>
        </thead>
        <tbody>
        <tr>
            <td style="flex:2"><input type="text" class="input ui-control qe-inline-title" data-entity="story" data-id="${story?.id || ''}" value="${escHtml(story?.title || '')}" placeholder="Название истории" style="width:100%"></td>
            ${effortInputs}
            <td style="text-align:center;font-weight:700;min-width:40px" data-total-panel="${story?.id || 'new-story'}">${total.toFixed(1)}</td>
            <td ><button class="btn btn-xs btn-secondary qe-inline-close" data-entity="story" data-id="${story?.id || ''}" title="Закрыть (Esc)">&times;</button></td>
        </tr>
        </tbody>
    </table>`;
}

// ==================== Shared Render Helpers ====================

function renderUnestimatedLabel() {
    return '<span class="qe-unestimated-label" title="Трудозатраты не указаны">Без оценки</span>';
}

function renderSaveState(entity, id) {
    return `<span class="qe-save-state" data-save-state="${entity}-${id}" aria-live="polite"></span>`;
}

function renderEffortInline(item, entityType, readonly = false, computedValues = null) {
    return `<div class="qe-effort-grid">` +
        COMPETENCIES.map(c => {
            const field = EFFORT_FIELD_MAP[c];
            const rawVal = item[field];
            const val = computedValues ? computedValues[field] : rawVal;
            const shortLabel = COMPETENCY_SHORT_LABELS[c] || c;
            if (readonly) {
                const display = (val !== undefined && val !== null && val !== '') ? val : '—';
                return `<div style="display:flex;flex-direction:column;align-items:center;">
                    <span class="qe-competency-label" title="${escAttr(c)}">${shortLabel}</span>
                    <span title="${escAttr(c)}: ${display}" style="width:100%;padding:5px 4px;text-align:center;font-size:12px;font-weight:500;background:#6b728015;border:1px solid #6b728030;border-radius:4px;min-height:24px;color:var(--text-muted);" data-effort-display="${entityType}-${item.id}-${field}">${display}</span>
                </div>`;
            }
            return `<div style="display:flex;flex-direction:column;align-items:center;">
                <span class="qe-competency-label" title="${escAttr(c)}">${shortLabel}</span>
                <input title="${escAttr(c)}" aria-label="${escAttr(c)}" type="number" step="0.5" min="0" class="input ui-control ui-number-cell qe-inline-effort" data-entity="${entityType}" data-id="${item.id}" data-field="${field}" data-original="${val ?? ''}" value="${val ?? ''}" placeholder="0" style="width:48px;text-align:center">
            </div>`;
        }).join('') +
    `</div>`;
}

function renderEffortChips(item) {
    return EFFORT_FIELDS.filter(f => (parseFloat(item[f]) || 0) > 0).map(f => {
        const val = parseFloat(item[f]) || 0;
        const label = FIELD_TO_LABEL[f];
        return `<span style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);padding:1px 5px;border-radius:3px;background:var(--bg-tertiary);color:var(--text-secondary);white-space:nowrap;" title="${label}: ${val} ч/д">${label.substring(0, 3)} ${val}</span>`;
    }).join('');
}

// ==================== Import Task Modal (search/select — not editing) ====================

function showImportModal() {
    const html = `
    <div class="modal-overlay" id="qe-modal">
        <div class="app-modal app-modal--medium" role="dialog" aria-modal="true" aria-labelledby="qe-import-title">
            <div class="app-modal__header"><div><h3 class="app-modal__title" id="qe-import-title">Добавить задачи из бэклога</h3><p class="app-modal__subtitle">Доступны только задачи на этапах подготовки требований. После добавления они перейдут в статус «ЭКСПРЕСС-ОЦЕНКА».</p></div><button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" data-modal-close aria-label="Закрыть">×</button></div>
            <div class="app-modal__body">
            <input class="input ui-control" type="text" id="import-search" placeholder="Поиск по названию..." style="width:100%;margin-bottom:12px">
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
            </div>
            <div class="app-modal__footer"><button class="btn btn-secondary btn-sm" id="qe-modal-close-btn">Закрыть</button></div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const overlay = document.getElementById('qe-modal');
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.getElementById('qe-modal-close-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-modal-close]')?.addEventListener('click', () => overlay.remove());

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
            resultsEl.innerHTML = '<span style="color:var(--text-muted);">Нет задач, которые можно передать на экспресс-оценку</span>';
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
                <input type="checkbox" class="import-task-check" data-task-id="${t.id}" data-task-version="${t.version ?? 0}" style="flex-shrink:0;cursor:pointer;">
                <div style="min-width:0;flex:1;">
                    <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${formatTaskPublicId(t)} ${escHtml(t.title)}</div>
                    <div style="font-size:var(--type-meta-size);line-height:var(--type-meta-line);color:var(--text-secondary);">${escHtml(t.status_name || '')} &middot; ${escHtml(t.priority_name || '')}</div>
                </div>
                <button class="btn btn-xs btn-secondary import-task-btn" data-task-id="${t.id}" data-task-version="${t.version ?? 0}" style="flex-shrink:0;">Добавить</button>
            `;
            div.querySelector('.import-task-check').addEventListener('change', updateImportSelection);
            div.querySelector('.import-task-btn').addEventListener('click', () => importSingleTask(t.id, t.version ?? 0));
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
    const selectedTasks = Array.from(checked).map(cb => ({
        id: parseInt(cb.dataset.taskId),
        version: Number(cb.dataset.taskVersion || 0),
    }));
    const ids = selectedTasks.map(item => item.id);
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
            await app.api.post(`/quick-estimate/import-task/${selectedTasks[i].id}`, {
                version: selectedTasks[i].version,
            });
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
    expressTaskSearch = '';
    expressTaskFilter = 'all';
    await loadData(app);
    revealImportedTasks(ids);
}

async function importSingleTask(taskId, version) {
    const app = expressCurrentApp;
    try {
        await app.api.post(`/quick-estimate/import-task/${taskId}`, { version: Number(version || 0) });
        window.toast('Задача добавлена', 'success');
        document.getElementById('qe-modal')?.remove();
        expressTaskSearch = '';
        expressTaskFilter = 'all';
        await loadData(app);
        revealImportedTasks([taskId]);
    } catch (e) {
        window.toast('Ошибка: ' + e.message, 'error');
    }
}

function revealImportedTasks(taskIds) {
    let firstBlock = null;
    taskIds.forEach(taskId => {
        const block = document.querySelector(`.qe-task-block[data-task-id="${taskId}"]`);
        if (!block) return;
        if (!firstBlock) firstBlock = block;
        block.hidden = false;
        const body = document.getElementById(`task-${taskId}`);
        if (body) body.style.display = '';
        const toggle = block.querySelector(`.qe-toggle[data-target="task-${taskId}"]`);
        const icon = toggle?.querySelector('svg, i');
        if (icon) icon.style.transform = '';
        block.classList.add('qe-just-imported');
        setTimeout(() => block.classList.remove('qe-just-imported'), 2200);
    });
    firstBlock?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ==================== Confirm Modal ====================

function showConfirm({ title, message, confirmLabel, danger = false, errorMessage, onConfirm }) {
    const confirmClass = danger ? 'btn-danger' : 'btn-primary';
    const html = `
    <div class="modal-overlay" id="qe-modal">
        <div class="app-modal app-modal--small" role="alertdialog" aria-modal="true" aria-labelledby="qe-confirm-title" aria-describedby="qe-confirm-message">
            <div class="app-modal__header"><h3 class="app-modal__title" id="qe-confirm-title">${escHtml(title)}</h3></div>
            <div class="app-modal__body"><p class="app-modal__subtitle" id="qe-confirm-message">${escHtml(message)}</p></div>
            <div class="app-modal__footer">
                <button class="btn btn-secondary btn-sm" id="qe-confirm-cancel" data-modal-close>Отмена</button>
                <button class="btn ${confirmClass} btn-sm" id="qe-confirm-action">${escHtml(confirmLabel)}</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('qe-modal');
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.getElementById('qe-confirm-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('qe-confirm-action').addEventListener('click', async () => {
        const confirmButton = document.getElementById('qe-confirm-action');
        confirmButton.disabled = true;
        try {
            await onConfirm();
            overlay.remove();
        } catch (e) {
            confirmButton.disabled = false;
            window.toast('Ошибка: ' + (e?.message || errorMessage), 'error');
        }
    });
}

// ==================== Hierarchy Actions (Event Delegation) ====================

let _boundHierarchySection = null;

function bindHierarchyActions() {
    const section = document.getElementById('express-hierarchy-section');
    if (!section) return;
    if (_boundHierarchySection === section) return;
    _boundHierarchySection = section;

    section.addEventListener('click', (e) => {
        const toggle = e.target.closest('.qe-toggle');
        // В шапке задачи есть кнопки и поля. Они должны получить клик
        // раньше обработчика сворачивания всей строки.
        const interactive = e.target.closest('button,input,select,textarea,a');
        if (toggle && !interactive) {
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
            showConfirm({
                title: 'Удалить эпик',
                message: msg,
                confirmLabel: 'Удалить',
                danger: true,
                errorMessage: 'не удалось удалить эпик',
                onConfirm: async () => {
                    await expressCurrentApp.api.delete(`/quick-estimate/epics/${epicId}`);
                    window.toast('Эпик удалён', 'success');
                    await loadData(expressCurrentApp);
                }
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
            showConfirm({
                title: 'Удалить историю',
                message: 'История будет удалена безвозвратно.',
                confirmLabel: 'Удалить',
                danger: true,
                errorMessage: 'не удалось удалить историю',
                onConfirm: async () => {
                    await expressCurrentApp.api.delete(`/quick-estimate/stories/${storyId}`);
                    window.toast('История удалена', 'success');
                    await loadData(expressCurrentApp);
                }
            });
            return;
        }

        if (e.target.closest('.qe-exclude-task-btn')) {
            const btn = e.target.closest('.qe-exclude-task-btn');
            const taskId = parseInt(btn.dataset.taskId);
            const task = (expressData?.tasks || []).find(item => item.id === taskId);
            showConfirm({
                title: 'Исключить из экспресс-оценки',
                message: 'Задача не будет удалена. Она вернётся в статус, который был до начала экспресс-оценки.',
                confirmLabel: 'Исключить',
                errorMessage: 'не удалось исключить задачу из экспресс-оценки',
                onConfirm: async () => {
                    await expressCurrentApp.api.delete(`/quick-estimate/tasks/${taskId}?version=${encodeURIComponent(task?.version ?? 0)}`);
                    window.toast('Задача исключена из экспресс-оценки', 'success');
                    await loadData(expressCurrentApp);
                }
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

    // ---- Drag & Drop reorder (epics inside tasks, stories inside epics) ----
    let _draggedEl = null;
    let _dragReadyEl = null;

    const getDragParent = () => {
        if (!_draggedEl) return null;
        if (_draggedEl.classList.contains('qe-epic-block')) {
            const task = _draggedEl.closest('.qe-task-block');
            return task?.querySelector(`#task-${task.dataset.taskId}`) || null;
        }
        const epic = _draggedEl.closest('.qe-epic-block');
        return epic?.querySelector(`#epic-${epic.dataset.epicId}`) || null;
    };

    const resolveDropTarget = clientY => {
        const parent = getDragParent();
        if (!parent) return null;
        const parentRect = parent.getBoundingClientRect();
        if (clientY < parentRect.top - 12 || clientY > parentRect.bottom + 12) return null;
        const selector = _draggedEl.classList.contains('qe-epic-block')
            ? ':scope > .qe-epic-block'
            : ':scope > .qe-story-block';
        const candidates = [...parent.querySelectorAll(selector)].filter(item => item !== _draggedEl);
        if (!candidates.length) return null;
        return candidates.reduce((nearest, item) => {
            const rect = item.getBoundingClientRect();
            const distance = Math.abs(clientY - (rect.top + rect.height / 2));
            return !nearest || distance < nearest.distance ? { item, distance } : nearest;
        }, null)?.item || null;
    };

    section.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.qe-drag-handle');
        if (!handle) { _dragReadyEl = null; return; }
        _dragReadyEl = handle.dataset.dragType === 'epic'
            ? handle.closest('.qe-epic-block')
            : handle.closest('.qe-story-block');
    });

    section.addEventListener('dragstart', (e) => {
        const source = e.target.closest('.qe-epic-block, .qe-story-block');
        if (!_dragReadyEl || source !== _dragReadyEl) { e.preventDefault(); return; }
        _draggedEl = source;
        source.classList.add('qe-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', source.dataset.epicId || source.dataset.storyId || '');
    });

    section.addEventListener('dragover', (e) => {
        if (!_draggedEl) return;
        const target = resolveDropTarget(e.clientY);
        if (!target) {
            section.querySelectorAll('.qe-drag-over-above, .qe-drag-over-below').forEach(element => {
                element.classList.remove('qe-drag-over-above', 'qe-drag-over-below');
            });
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        section.querySelectorAll('.qe-drag-over-above, .qe-drag-over-below').forEach(element => {
            if (element !== target) element.classList.remove('qe-drag-over-above', 'qe-drag-over-below');
        });
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        target.classList.toggle('qe-drag-over-above', e.clientY < midY);
        target.classList.toggle('qe-drag-over-below', e.clientY >= midY);
    });

    section.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!_draggedEl) return;
        const target = resolveDropTarget(e.clientY);
        if (!target) return;
        target.classList.remove('qe-drag-over-above', 'qe-drag-over-below');

        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        const parent = getDragParent();
        if (parent) {
            if (insertBefore) parent.insertBefore(_draggedEl, target);
            else parent.insertBefore(_draggedEl, target.nextSibling);
        }
        persistSortOrder();
    });

    section.addEventListener('dragend', () => {
        if (_draggedEl) _draggedEl.classList.remove('qe-dragging');
        section.querySelectorAll('.qe-drag-over-above, .qe-drag-over-below').forEach(el => {
            el.classList.remove('qe-drag-over-above', 'qe-drag-over-below');
        });
        _draggedEl = null;
        _dragReadyEl = null;
    });

    if (window.lucide) window.lucide.createIcons();
}

// ==================== Drag & Drop Sort Persistence ====================

function persistSortOrder() {
    const app = expressCurrentApp;
    if (!app) return;
    const payload = { epics: [], stories: [] };
    document.querySelectorAll('.qe-task-block').forEach(taskBlock => {
        const body = taskBlock.querySelector(`#task-${taskBlock.dataset.taskId}`);
        if (!body) return;
        body.querySelectorAll(':scope > .qe-epic-block').forEach((el, idx) => {
            payload.epics.push({ id: parseInt(el.dataset.epicId), sort_order: idx });
        });
    });
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
    setSaveState(entity, id, 'saving');
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
        setSaveState(entity, id, 'saved');
    } catch (e) {
        setSaveState(entity, id, 'error');
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
    const pendingKey = `${entity}-${id}-${field}`;

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
    applyTaskFilters();
    updateChartData();
    pendingEstimateSaves.add(pendingKey);
    setSaveState(entity, id, 'saving');
    syncReadinessFromTasks();

    try {
        if (entity === 'epic') {
            await app.api.put(`/quick-estimate/epics/${id}`, data);
        } else {
            await app.api.put(`/quick-estimate/stories/${id}`, data);
        }
        setSaveState(entity, id, 'saved');
    } catch (e) {
        setSaveState(entity, id, 'error');
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
        applyTaskFilters();
        updateChartData();
    } finally {
        pendingEstimateSaves.delete(pendingKey);
        syncReadinessFromTasks();
    }
}

function updateParentDisplays(entity, id) {
    updateEstimateHighlight(entity, id);
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
        taskBlock.classList.toggle('qe-unestimated', total <= 0);
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

function updateEstimateHighlight(entity, id) {
    let item;
    let block;
    let total = 0;
    if (entity === 'story') {
        item = findStoryById(id);
        block = document.querySelector(`.qe-story-block[data-story-id="${id}"]`);
        total = item ? EFFORT_FIELDS.reduce((sum, field) => sum + (parseFloat(item[field]) || 0), 0) : 0;
    } else if (entity === 'epic') {
        item = findEpicById(id);
        block = document.querySelector(`.qe-epic-block[data-epic-id="${id}"]`);
        total = item ? EFFORT_FIELDS.reduce((sum, field) => sum + effectiveEffort({ ...item, _type: 'epic' }, field), 0) : 0;
    }
    block?.classList.toggle('qe-unestimated', total <= 0);
}

function setSaveState(entity, id, state) {
    const key = `${entity}-${id}`;
    const element = document.querySelector(`[data-save-state="${key}"]`);
    if (!element) return;
    const previousTimer = saveStateTimers.get(key);
    if (previousTimer) clearTimeout(previousTimer);

    element.dataset.state = state;
    element.textContent = state === 'saving'
        ? 'Сохраняется…'
        : state === 'saved' ? 'Сохранено' : 'Не сохранено';

    if (state === 'saved') {
        const timer = setTimeout(() => {
            element.dataset.state = '';
            element.textContent = '';
            saveStateTimers.delete(key);
        }, 1800);
        saveStateTimers.set(key, timer);
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
        COMPETENCIES.forEach(c => {
            const field = EFFORT_FIELD_MAP[c];
            demand[c] += effectiveEffort({ ...task, _type: 'task' }, field);
        });
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

// ==================== Complete Estimate ====================

function showIncompleteEstimateModal(readiness) {
    const blockerCards = readiness.blocking_tasks.map(task => `
        <article class="qe-blocker-task" data-task-id="${task.task_id}">
            <div class="qe-blocker-task-head">
                <strong>${escHtml(task.public_id || `#${task.task_id}`)} · ${escHtml(task.title)}</strong>
                <span>${task.blockers.length}</span>
            </div>
            <ul>${task.blockers.map(blocker => `<li>${escHtml(blocker.message)}</li>`).join('')}</ul>
        </article>`).join('');
    const html = `
    <div class="modal-overlay qe-complete-overlay" id="qe-modal">
        <div class="qe-complete-modal app-modal app-modal--medium" role="dialog" aria-modal="true" aria-labelledby="qe-complete-title">
            <div class="app-modal__header"><div class="qe-complete-heading">
                <div class="qe-complete-icon is-warning"><i data-lucide="alert-triangle"></i></div>
                <div><h3 id="qe-complete-title">Экспресс-оценка пока не готова</h3><p>Переход к принятию решения заблокирован, пока не устранены все замечания.</p></div>
            </div></div>
            <div class="app-modal__body">
                <div class="qe-complete-warning"><i data-lucide="shield-alert"></i><span><strong>${formatRussianCount(readiness.blocking_tasks.length, ['задача', 'задачи', 'задач'])} ${readiness.blocking_tasks.length === 1 ? 'требует' : 'требуют'} доработки</strong><br>${formatRussianCount(readiness.total_blockers, ['элемент', 'элемента', 'элементов'])} без корректной оценки.</span></div>
                <div class="qe-readiness-rule"><strong>Критерий готовности</strong><span>В каждой задаче есть хотя бы один эпик. Каждый конечный эпик или каждая его история содержит минимум одну положительную оценку трудозатрат.</span></div>
                <div class="qe-blocker-list" aria-label="Блокеры завершения">${blockerCards}</div>
            </div>
            <div class="qe-complete-actions app-modal__footer">
                <button class="btn btn-secondary btn-sm" id="qe-complete-cancel" data-modal-close>Закрыть</button>
                <button class="btn btn-primary btn-sm" id="qe-complete-review"><i data-lucide="list-filter"></i> Показать задачи</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    if (window.lucide) window.lucide.createIcons();
    const overlay = document.getElementById('qe-modal');
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.getElementById('qe-complete-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('qe-complete-review').addEventListener('click', reviewBlockingTasks);
}

function showCompleteEstimateModal() {
    const tasks = expressData?.tasks || [];
    if (tasks.length === 0) return;
    if (pendingEstimateSaves.size > 0) {
        window.toast('Дождитесь сохранения текущих оценок', 'warning');
        return;
    }
    const readiness = getQuickEstimateReadiness();
    if (!readiness.ready) {
        showIncompleteEstimateModal(readiness);
        return;
    }
    const demand = calcTotalDemand();
    const rows = COMPETENCIES.map(competency => {
        const resource = teamResources.find(item => item.competency === competency);
        const capacity = resource?.capacity || 0;
        const needed = demand[competency] || 0;
        const delta = needed - capacity;
        const utilization = capacity > 0 ? (needed / capacity) * 100 : (needed > 0 ? null : 0);
        const state = delta > 0.05 ? 'over' : delta < -0.05 ? 'under' : 'balanced';
        return { competency, capacity, needed, delta, utilization, state };
    });
    const totalDemand = rows.reduce((sum, row) => sum + row.needed, 0);
    const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0);
    const deviationItems = rows.filter(row => row.state !== 'balanced').map(row => {
        if (row.state === 'over') {
            const utilization = row.utilization === null ? 'нет Capacity' : `утилизация ${row.utilization.toFixed(0)}%`;
            return `<li class="over"><strong>${escHtml(row.competency)}</strong>: дефицит ${row.delta.toFixed(1)} чел./дн. (${utilization})</li>`;
        }
        return `<li class="under"><strong>${escHtml(row.competency)}</strong>: резерв ${Math.abs(row.delta).toFixed(1)} чел./дн. (утилизация ${row.utilization.toFixed(0)}%)</li>`;
    }).join('');
    const tableRows = rows.map(row => `
        <tr>
            <td>${escHtml(row.competency)}</td>
            <td>${row.needed.toFixed(1)}</td>
            <td>${row.capacity.toFixed(1)}</td>
            <td class="qe-util-${row.state}">${row.utilization === null ? '—' : row.utilization.toFixed(0) + '%'}</td>
            <td class="qe-util-${row.state}">${row.state === 'over' ? 'Дефицит ' + row.delta.toFixed(1) : row.state === 'under' ? 'Резерв ' + Math.abs(row.delta).toFixed(1) : 'Баланс'}</td>
        </tr>`).join('');

    const html = `
    <div class="modal-overlay qe-complete-overlay" id="qe-modal">
        <div class="qe-complete-modal app-modal app-modal--medium" role="alertdialog" aria-modal="true" aria-labelledby="qe-complete-title">
            <div class="app-modal__header"><div class="qe-complete-heading">
                <div class="qe-complete-icon"><i data-lucide="check-circle"></i></div>
                <div><h3 id="qe-complete-title">Завершить экспресс-оценку?</h3><p>Все ${tasks.length} задач перейдут в статус «ПРИНЯТИЕ РЕШЕНИЯ».</p></div>
            </div></div>
            <div class="app-modal__body">
            <div class="qe-complete-ready"><i data-lucide="badge-check"></i> Все критерии готовности выполнены. После подтверждения вернуться к редактированию оценки можно будет только через отдельное решение по задаче.</div>
            <div class="qe-complete-kpis">
                <div><span>Задач</span><strong>${tasks.length}</strong></div>
                <div><span>Demand</span><strong>${totalDemand.toFixed(1)} <small>чел./дн.</small></strong></div>
                <div><span>Capacity</span><strong>${totalCapacity.toFixed(1)} <small>чел./дн.</small></strong></div>
            </div>
            <h4>Ключевые отклонения</h4>
            <ul class="qe-deviation-list">${deviationItems || '<li class="balanced">Потребность сбалансирована с Capacity по всем компетенциям.</li>'}</ul>
            <details class="qe-complete-details"><summary>Показать сводку по компетенциям</summary>
                <div class="qe-complete-table-wrap"><table class="ui-table ui-table-data"><thead><tr><th>Компетенция</th><th>Demand</th><th>Capacity</th><th>Утилизация</th><th>Отклонение</th></tr></thead><tbody>${tableRows}</tbody></table></div>
            </details>
            </div>
            <div class="qe-complete-actions app-modal__footer">
                <button class="btn btn-secondary btn-sm" id="qe-complete-cancel" data-modal-close>Отмена</button>
                <button class="btn btn-primary btn-sm" id="qe-complete-confirm"><i data-lucide="check"></i> Подтвердить завершение</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    if (window.lucide) window.lucide.createIcons();
    const overlay = document.getElementById('qe-modal');
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    document.getElementById('qe-complete-cancel').addEventListener('click', () => overlay.remove());
    document.getElementById('qe-complete-confirm').addEventListener('click', completeEstimate);
}

function showEstimateHandoffModal(taskCount, detail) {
    const currentUser = expressCurrentApp?.store?.get('currentUser');
    const permissions = currentUser?.permissions || {};
    const canOpenPip = permissions.pip_decision === 'available'
        || (permissions.reports && permissions.reports !== 'none');
    const destination = canOpenPip
        ? `/reports/detail?r=pip&source=express-estimate&transferred=${taskCount}`
        : '/team-backlog';
    const actionLabel = canOpenPip ? 'Перейти к PI-планированию' : 'Вернуться в бэклог команды';
    const actionIcon = canOpenPip ? 'arrow-right' : 'list-tree';
    const accessNote = canOpenPip
        ? 'Очередь PI уже обновлена. Там можно проверить контекст и принять решение по каждой задаче.'
        : 'Задачи переданы в очередь PI. Решение зафиксирует лидер трайба или проектный офис.';
    const html = `
    <div class="modal-overlay qe-complete-overlay" id="qe-handoff-modal">
        <div class="qe-complete-modal app-modal app-modal--medium qe-handoff-modal" role="dialog" aria-modal="true" aria-labelledby="qe-handoff-title">
            <div class="app-modal__header"><div class="qe-complete-heading">
                <div class="qe-complete-icon is-success"><i data-lucide="route"></i></div>
                <div><h3 id="qe-handoff-title">Экспресс-оценка завершена</h3><p>${escHtml(detail || `${formatRussianCount(taskCount, ['задача', 'задачи', 'задач'])} передано на принятие решения.`)}</p></div>
            </div></div>
            <div class="app-modal__body">
                <ol class="qe-handoff-steps" aria-label="Этапы движения задач">
                    <li class="is-done"><span><i data-lucide="check"></i></span><div><strong>Бэклог</strong><small>Задачи отобраны</small></div></li>
                    <li class="is-done"><span><i data-lucide="check"></i></span><div><strong>Экспресс-оценка</strong><small>Объём подтверждён</small></div></li>
                    <li class="is-current" aria-current="step"><span>3</span><div><strong>PI-планирование</strong><small>Ожидается решение</small></div></li>
                </ol>
                <div class="qe-handoff-next"><i data-lucide="info"></i><span>${escHtml(accessNote)}</span></div>
            </div>
            <div class="qe-complete-actions app-modal__footer">
                <button class="btn btn-secondary btn-sm" id="qe-handoff-stay" data-modal-close>Остаться здесь</button>
                <button class="btn btn-primary btn-sm" id="qe-handoff-next">${escHtml(actionLabel)}<i data-lucide="${actionIcon}"></i></button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    window.lucide?.createIcons();
    const overlay = document.getElementById('qe-handoff-modal');
    const close = () => overlay?.remove();
    document.getElementById('qe-handoff-stay')?.addEventListener('click', close);
    overlay?.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.getElementById('qe-handoff-next')?.addEventListener('click', () => {
        close();
        expressCurrentApp.router.navigate(destination);
    });
}

async function completeEstimate() {
    const button = document.getElementById('qe-complete-confirm');
    if (!button || !expressCurrentApp) return;
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-2" class="animate-spin"></i> Завершаем…';
    if (window.lucide) window.lucide.createIcons();
    try {
        const taskCount = expressData?.tasks?.length || 0;
        const versions = Object.fromEntries(
            (expressData?.tasks || []).map(task => [task.id, Number(task.version || 0)])
        );
        const result = await expressCurrentApp.api.put('/quick-estimate/complete', { versions });
        document.getElementById('qe-modal')?.remove();
        await loadData(expressCurrentApp);
        window.toast(result?.detail || 'Экспресс-оценка завершена', 'success');
        showEstimateHandoffModal(taskCount, result?.detail);
    } catch (error) {
        if (error?.code === 'quick_estimate_incomplete') {
            document.getElementById('qe-modal')?.remove();
            await loadData(expressCurrentApp);
            showCompleteEstimateModal();
            return;
        }
        button.disabled = false;
        button.innerHTML = '<i data-lucide="check"></i> Подтвердить завершение';
        if (window.lucide) window.lucide.createIcons();
        window.toast('Ошибка: ' + error.message, 'error');
    }
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

        const rows = [['ID задачи', 'Задача', 'Статус', 'Эпик', 'Приоритет эпика', 'История', ...COMPETENCIES, 'Итого, чел./дн.']];
        for (const task of (expressData?.tasks || [])) {
            if ((task.epics || []).length === 0) {
                rows.push([formatTaskPublicId(task), task.title, task.status_name || '', '', '', '', ...COMPETENCIES.map(() => 0), 0]);
            }
            for (const epic of (task.epics || [])) {
                if ((epic.stories || []).length === 0) {
                    const total = COMPETENCIES.reduce((s, c) => s + (parseFloat(epic[EFFORT_FIELD_MAP[c]]) || 0), 0);
                    rows.push([formatTaskPublicId(task), task.title, task.status_name || '', epic.title, epic.priority || '', '', ...COMPETENCIES.map(c => parseFloat(epic[EFFORT_FIELD_MAP[c]]) || 0), total]);
                }
                for (const story of (epic.stories || [])) {
                    const total = COMPETENCIES.reduce((s, c) => s + (parseFloat(story[EFFORT_FIELD_MAP[c]]) || 0), 0);
                    rows.push([formatTaskPublicId(task), task.title, task.status_name || '', epic.title, epic.priority || '', story.title, ...COMPETENCIES.map(c => parseFloat(story[EFFORT_FIELD_MAP[c]]) || 0), total]);
                }
            }
        }
        const ws1 = XLSX.utils.aoa_to_sheet(rows);
        configureExcelSheet(XLSX, ws1, [12, 36, 22, 32, 22, 36, ...COMPETENCIES.map(() => 16), 18], rows.length, rows[0].length);
        setExcelNumberFormat(XLSX, ws1, 1, rows.length - 1, 6, rows[0].length - 1, '0.0');
        XLSX.utils.book_append_sheet(wb, ws1, 'Иерархия');

        const summary = calcSummaryByStatusPriority();
        const sRows = [['Статус', 'Приоритет', ...COMPETENCIES, 'Стоимость, руб.']];
        summary.forEach(r => {
            sRows.push([r.status, r.priority, ...COMPETENCIES.map(c => r.demand[c] || 0), r.totalCost]);
        });
        const summaryTotals = summary.reduce((acc, row) => {
            COMPETENCIES.forEach(c => { acc[c] = (acc[c] || 0) + (row.demand[c] || 0); });
            acc.totalCost += row.totalCost;
            return acc;
        }, { totalCost: 0 });
        sRows.push(['ИТОГО', '', ...COMPETENCIES.map(c => summaryTotals[c] || 0), summaryTotals.totalCost]);
        const ws2 = XLSX.utils.aoa_to_sheet(sRows);
        configureExcelSheet(XLSX, ws2, [22, 18, ...COMPETENCIES.map(() => 18), 20], sRows.length, sRows[0].length);
        setExcelNumberFormat(XLSX, ws2, 1, sRows.length - 1, 2, sRows[0].length - 2, '0.0');
        setExcelNumberFormat(XLSX, ws2, 1, sRows.length - 1, sRows[0].length - 1, sRows[0].length - 1, '#,##0\" руб.\"');
        XLSX.utils.book_append_sheet(wb, ws2, 'Сводная');

        const demand = calcTotalDemand();
        const resourceRows = [['Компетенция', 'Capacity, чел./дн.', 'Demand, чел./дн.', 'Баланс, чел./дн.', 'Состояние']];
        COMPETENCIES.forEach(c => {
            const resource = teamResources.find(r => r.competency === c);
            const capacity = resource?.capacity || 0;
            const needed = demand[c] || 0;
            const balance = capacity - needed;
            resourceRows.push([c, capacity, needed, balance, balance < 0 ? 'Дефицит' : 'Резерв']);
        });
        resourceRows.push([
            'ИТОГО',
            resourceRows.slice(1).reduce((sum, r) => sum + r[1], 0),
            resourceRows.slice(1).reduce((sum, r) => sum + r[2], 0),
            resourceRows.slice(1).reduce((sum, r) => sum + r[3], 0),
            ''
        ]);
        const ws3 = XLSX.utils.aoa_to_sheet(resourceRows);
        configureExcelSheet(XLSX, ws3, [28, 22, 22, 22, 16], resourceRows.length, resourceRows[0].length);
        setExcelNumberFormat(XLSX, ws3, 1, resourceRows.length - 1, 1, 3, '0.0');
        XLSX.utils.book_append_sheet(wb, ws3, 'Ресурсы');

        const dateStamp = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `express_estimate_${dateStamp}.xlsx`);
        window.toast('Экспорт выполнен', 'success');
    } catch (e) {
        window.toast('Ошибка экспорта: ' + e.message, 'error');
    }
}

function configureExcelSheet(XLSX, sheet, widths, rowCount, columnCount) {
    sheet['!cols'] = widths.map(wch => ({ wch }));
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(0, rowCount - 1), c: columnCount - 1 }) };
    sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
}

function setExcelNumberFormat(XLSX, sheet, startRow, endRow, startColumn, endColumn, format) {
    for (let row = startRow; row <= endRow; row++) {
        for (let column = startColumn; column <= endColumn; column++) {
            const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
            if (cell?.t === 'n') cell.z = format;
        }
    }
}

// ==================== Helpers ====================

function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function escAttr(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
