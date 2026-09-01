console.log('[DMB] kanbanBoard.js v20260626.7 loaded');
import { renderTaskCard } from './modal.js?v=90';
import { formatTaskPublicId } from '../taskPublicId.js';

let kanbanCurrentTasks = [];
let statusNameToId = {};
// Базовый маппинг названий статусов в TaskStatus.id (1-13).
// Используется как fallback — если в задаче нет статуса, маппинг всё равно будет известен.
const STATUS_NAME_TO_ID_BASE = {
    'НОВАЯ ЗАДАЧА': 1,
    'НАЗНАЧЕНА КОМАНДА': 2,
    'СБОР ТРЕБОВАНИЙ': 3,
    'ПРОВЕРКА ТРЕБОВАНИЙ': 4,
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': 5,
    'ЭКСПРЕСС-ОЦЕНКА': 6,
    'ПРИНЯТИЕ РЕШЕНИЯ': 7,
    'ПРИНЯТА В РАБОТУ': 8,
    'ОТКЛОНЕНА': 9,
    'НЕ АКТУАЛЬНА': 10,
    'ВЫПОЛНЕНА': 11,
    'ЭСКАЛАЦИЯ НА ЛТ': 12,
    'ХОЛД': 13,
};

const KANBAN_STATUSES = [
    'НОВАЯ ЗАДАЧА', 'НАЗНАЧЕНА КОМАНДА', 'СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ',
    'ЭСКАЛАЦИЯ НА ЛТ', 'ХОЛД', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА', 'ВЫПОЛНЕНА'
];

const savingTasks = new Set();
let dataGeneration = 0; // Монотонный счётчик: увеличивается при перезагрузке данных

export function renderKanban(app) {
    return `
    <div class="page-header animate-fade-in">
        <h1>Канбан-доска</h1>
        <p>Визуальное управление потоком задач</p>
    </div>

    <div class="action-bar action-bar--end">
    <button class="btn btn-primary btn-sm" id="kanban-add-task-btn" style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
      <i data-lucide="plus" style="width:14px;height:14px;"></i>
      Добавить задачу
    </button>
    </div>

    <div class="kanban-board" id="kanban-board">
        <div class="kanban-column" data-status="НОВАЯ ЗАДАЧА">
            <div class="kanban-column-header" style="border-top: 3px solid #6366f1;">
                <div class="kanban-column-title">
                    <span style="color:#6366f1;">●</span> НОВАЯ ЗАДАЧА
                    <span class="kanban-column-count" id="count-НОВАЯ ЗАДАЧА">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="НОВАЯ ЗАДАЧА" id="col-НОВАЯ ЗАДАЧА"></div>
        </div>

        <div class="kanban-column" data-status="НАЗНАЧЕНА КОМАНДА">
            <div class="kanban-column-header" style="border-top: 3px solid #8b5cf6;">
                <div class="kanban-column-title">
                    <span style="color:#8b5cf6;">●</span> НАЗНАЧЕНА КОМАНДА
                    <span class="kanban-column-count" id="count-НАЗНАЧЕНА КОМАНДА">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="НАЗНАЧЕНА КОМАНДА" id="col-НАЗНАЧЕНА КОМАНДА"></div>
        </div>

        <div class="kanban-column" data-status="СБОР ТРЕБОВАНИЙ">
            <div class="kanban-column-header" style="border-top: 3px solid #6366f1;">
                <div class="kanban-column-title">
                    <span style="color:#6366f1;">●</span> СБОР ТРЕБОВАНИЙ
                    <span class="kanban-column-count" id="count-СБОР ТРЕБОВАНИЙ">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="СБОР ТРЕБОВАНИЙ" id="col-СБОР ТРЕБОВАНИЙ"></div>
        </div>

        <div class="kanban-column" data-status="ПРОВЕРКА ТРЕБОВАНИЙ">
            <div class="kanban-column-header" style="border-top: 3px solid #a78bfa;">
                <div class="kanban-column-title">
                    <span style="color:#a78bfa;">●</span> ПРОВЕРКА ТРЕБОВАНИЙ
                    <span class="kanban-column-count" id="count-ПРОВЕРКА ТРЕБОВАНИЙ">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ПРОВЕРКА ТРЕБОВАНИЙ" id="col-ПРОВЕРКА ТРЕБОВАНИЙ"></div>
        </div>

        <div class="kanban-column" data-status="УТОЧНЕНИЕ ТРЕБОВАНИЙ">
            <div class="kanban-column-header" style="border-top: 3px solid #c4b5fd;">
                <div class="kanban-column-title">
                    <span style="color:#c4b5fd;">●</span> УТОЧНЕНИЕ ТРЕБОВАНИЙ
                    <span class="kanban-column-count" id="count-УТОЧНЕНИЕ ТРЕБОВАНИЙ">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="УТОЧНЕНИЕ ТРЕБОВАНИЙ" id="col-УТОЧНЕНИЕ ТРЕБОВАНИЙ"></div>
        </div>

        <div class="kanban-column" data-status="ЭКСПРЕСС-ОЦЕНКА">
            <div class="kanban-column-header" style="border-top: 3px solid #8b5cf6;">
                <div class="kanban-column-title">
                    <span style="color:#8b5cf6;">●</span> ЭКСПРЕСС-ОЦЕНКА
                    <span class="kanban-column-count" id="count-ЭКСПРЕСС-ОЦЕНКА">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ЭКСПРЕСС-ОЦЕНКА" id="col-ЭКСПРЕСС-ОЦЕНКА"></div>
        </div>

        <div class="kanban-column" data-status="ПРИНЯТИЕ РЕШЕНИЯ">
            <div class="kanban-column-header" style="border-top: 3px solid #f59e0b;">
                <div class="kanban-column-title">
                    <span style="color:#f59e0b;">●</span> ПРИНЯТИЕ РЕШЕНИЯ
                    <span class="kanban-column-count" id="count-ПРИНЯТИЕ РЕШЕНИЯ">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ПРИНЯТИЕ РЕШЕНИЯ" id="col-ПРИНЯТИЕ РЕШЕНИЯ"></div>
        </div>

        <div class="kanban-column" data-status="ПРИНЯТА В РАБОТУ">
            <div class="kanban-column-header" style="border-top: 3px solid #10b981;">
                <div class="kanban-column-title">
                    <span style="color:#10b981;">●</span> ПРИНЯТА В РАБОТУ
                    <span class="kanban-column-count" id="count-ПРИНЯТА В РАБОТУ">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ПРИНЯТА В РАБОТУ" id="col-ПРИНЯТА В РАБОТУ"></div>
        </div>

        <div class="kanban-column" data-status="ЭСКАЛАЦИЯ НА ЛТ">
            <div class="kanban-column-header" style="border-top: 3px solid #f97316;">
                <div class="kanban-column-title">
                    <span style="color:#f97316;">●</span> ЭСКАЛАЦИЯ НА ЛТ
                    <span class="kanban-column-count" id="count-ЭСКАЛАЦИЯ НА ЛТ">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ЭСКАЛАЦИЯ НА ЛТ" id="col-ЭСКАЛАЦИЯ НА ЛТ"></div>
        </div>

        <div class="kanban-column" data-status="ХОЛД">
            <div class="kanban-column-header" style="border-top: 3px solid #f43f5e;">
                <div class="kanban-column-title">
                    <span style="color:#f43f5e;">●</span> ХОЛД
                    <span class="kanban-column-count" id="count-ХОЛД">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ХОЛД" id="col-ХОЛД"></div>
        </div>

        <div class="kanban-column" data-status="ОТКЛОНЕНА">
            <div class="kanban-column-header" style="border-top: 3px solid #ef4444;">
                <div class="kanban-column-title">
                    <span style="color:#ef4444;">●</span> ОТКЛОНЕНА
                    <span class="kanban-column-count" id="count-ОТКЛОНЕНА">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ОТКЛОНЕНА" id="col-ОТКЛОНЕНА"></div>
        </div>

        <div class="kanban-column" data-status="НЕ АКТУАЛЬНА">
            <div class="kanban-column-header" style="border-top: 3px solid #64748b;">
                <div class="kanban-column-title">
                    <span style="color:#64748b;">●</span> НЕ АКТУАЛЬНА
                    <span class="kanban-column-count" id="count-НЕ АКТУАЛЬНА">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="НЕ АКТУАЛЬНА" id="col-НЕ АКТУАЛЬНА"></div>
        </div>

        <div class="kanban-column" data-status="ВЫПОЛНЕНА">
            <div class="kanban-column-header" style="border-top: 3px solid #22c55e;">
                <div class="kanban-column-title">
                    <span style="color:#22c55e;">●</span> ВЫПОЛНЕНА
                    <span class="kanban-column-count" id="count-ВЫПОЛНЕНА">0</span>
                </div>
            </div>
            <div class="kanban-column-body" data-status="ВЫПОЛНЕНА" id="col-ВЫПОЛНЕНА"></div>
        </div>
    </div>
    `;
}

export async function initKanban(app) {
    // Очищаем savingTasks — могли остаться зависшие задачи от предыдущего визита
    savingTasks.clear();

    try {
        const user = app.store.get('currentUser');
        let teamFilter = '';
        if (user?.team_id) {
            teamFilter = `&team_id=${user.team_id}`;
        } else if (user?.team) {
            try {
                const teamsResp = await app.api.get('/teams/');
                const teams = teamsResp.items || [];
                const userTeam = teams.find(t => t.name === user.team);
                if (userTeam) teamFilter = `&team_id=${userTeam.id}`;
            } catch {}
        }
        const data = await app.api.get(`/tasks/?per_page=500${teamFilter}`);
        const items = data.items || data.tasks || data || [];
        kanbanCurrentTasks = items;
        // Строим statusNameToId: базовый маппинг + из задач (перетирает при совпадении)
        statusNameToId = { ...STATUS_NAME_TO_ID_BASE };
        items.forEach(t => {
            if (t.status_name && t.status_id != null) {
                statusNameToId[t.status_name] = t.status_id;
            }
        });
        // Дополняем из /admin/statuses (DictionaryItem.id: 4-16) — только те статусы, что не нашли в задачах
        try {
            const statusList = await app.api.get('/admin/statuses');
            (Array.isArray(statusList) ? statusList : (statusList.items || [])).forEach(s => {
                if (statusNameToId[s.name] == null) {
                    statusNameToId[s.name] = s.id;
                }
            });
        } catch (e) {
            console.warn('Failed to load statuses from /admin/statuses:', e);
        }
        renderKanbanCards(app, items);

        const { openTaskModal, openCreateTaskModal, setOnTaskSaved } = await import('./modal.js?v=90');
        setOnTaskSaved(() => initKanban(app));

        document.getElementById('kanban-add-task-btn')?.addEventListener('click', async () => {
            openCreateTaskModal(app);
        });

    } catch (e) {
        console.error('Kanban error:', e);
    }
}

/**
 * Перезагружает задачи с сервера и перерисовывает доску.
 * @param {Object} app - экземпляр приложения
 */
async function reloadTasksFromServer(app) {
    const user = app.store?.get('currentUser');
    let teamFilter = '';
    if (user?.team_id) {
        teamFilter = `&team_id=${user.team_id}`;
    } else if (user?.team) {
        try {
            const teamsResp = await app.api.get('/teams/');
            const teams = teamsResp.items || [];
            const userTeam = teams.find(t => t.name === user.team);
            if (userTeam) teamFilter = `&team_id=${userTeam.id}`;
        } catch { /* ignore */ }
    }
    const data = await app.api.get(`/tasks/?per_page=500${teamFilter}`);
    const items = data.items || data.tasks || data || [];
    kanbanCurrentTasks = items;
    // Перестраиваем statusNameToId: базовый маппинг + из свежих задач
    statusNameToId = { ...STATUS_NAME_TO_ID_BASE };
    items.forEach(t => {
        if (t.status_name && t.status_id != null) {
            statusNameToId[t.status_name] = t.status_id;
        }
    });
    dataGeneration++; // Увеличиваем — все in-flight updateLocalTask будут проигнорированы
    renderKanbanCards(app, items);
}

/**
 * Обновляет счётчики задач в каждой колонке на основе текущего DOM.
 */
function updateColumnCounts() {
    KANBAN_STATUSES.forEach(s => {
        const countEl = document.getElementById(`count-${s}`);
        const body = document.getElementById(`col-${s}`);
        if (countEl && body) {
            const count = body.querySelectorAll('.task-card').length;
            countEl.textContent = count;
            if (count === 0 && !body.querySelector('.empty-state')) {
                body.insertAdjacentHTML('beforeend', '<div class="empty-state" style="padding:var(--space-8);"><p class="text-muted">Нет задач</p></div>');
            }
        }
    });
}

/**
 * Обновляет задачу в локальном массиве kanbanCurrentTasks после успешного сохранения.
 * @param {string|number} taskId
 * @param {Object} response - ответ от API
 * @param {string} newStatusName - название нового статуса
 * @param {number} gen - поколение данных на момент запроса (для защиты от гонок)
 */
function updateLocalTask(taskId, response, newStatusName, gen) {
    // Если данные перезагружены (gen не совпадает) — не обновляем устаревший массив
    if (gen !== dataGeneration) return;

    const idx = kanbanCurrentTasks.findIndex(t => String(t.id) === String(taskId));
    if (idx !== -1) {
        kanbanCurrentTasks[idx] = {
            ...kanbanCurrentTasks[idx],
            status_id: response.status_id,
            status_name: response.status_name || newStatusName,
            updated_at: response.updated_at
        };
    }
}

function setupColumnDropHandlers(app) {
    document.querySelectorAll('.kanban-column-body:not([data-drop-bound])').forEach(col => {
        col.dataset.dropBound = '1';
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            col.classList.add('drag-over');
        });
        col.addEventListener('dragleave', () => {
            col.classList.remove('drag-over');
        });
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const taskId = e.dataTransfer.getData('text/plain');
            const newStatus = col.dataset.status;
            if (!taskId || !newStatus) return;

            // Set-блокировка: если задача уже сохраняется — игнорируем
            if (savingTasks.has(taskId)) return;
            savingTasks.add(taskId);

            // Находим карточку и добавляем loading-класс
            let card = document.querySelector(`.task-card[data-id="${taskId}"]`);
            if (card) card.classList.add('task-card--saving');

            // Оптимистичное обновление: перемещаем карточку сразу
            const oldCol = card?.closest('.kanban-column-body');
            if (card && oldCol && oldCol !== col) {
                const oldEmpty = oldCol.querySelector('.empty-state');
                if (oldEmpty) oldEmpty.remove();
                const newEmpty = col.querySelector('.empty-state');
                if (newEmpty) newEmpty.remove();
                col.appendChild(card);
                card.classList.remove('dragging');
                updateColumnCounts();
            }

            // Сохраняем статус на сервере
            try {
                const statusId = statusNameToId[newStatus];
                if (!statusId) {
                    throw new Error(`Статус "${newStatus}" не найден`);
                }
                const task = kanbanCurrentTasks.find(item => String(item.id) === String(taskId));
                if (!task || task.version === undefined || task.version === null) {
                    throw new Error('Не удалось определить версию задачи. Обновите доску.');
                }
                const response = await app.api.put(`/tasks/${taskId}`, {
                    status_id: statusId,
                    version: task.version,
                });

                // Успех: toast
                window.toast(`Задача ${formatTaskPublicId(taskId)} перемещена в ${newStatus}`, 'success');

                // Перезагружаем доску с сервера — гарантирует актуальные статусы на карточках
                try {
                    await reloadTasksFromServer(app);
                } catch (reloadErr) {
                    console.error('Reload failed after drop:', reloadErr);
                    // Если перезагрузка не удалась — хотя бы обновим локальный массив и карточку
                    updateLocalTask(taskId, response, newStatus, dataGeneration);
                    if (card) {
                        const newHtml = renderTaskCard(response);
                        card.outerHTML = newHtml;
                    }
                }
            } catch (err) {
                console.error('Drop save error:', err);
                window.toast(`Ошибка при перемещении задачи: ${err.message}`, 'error');
                // При ошибке откатываем — перезагружаем с сервера
                try {
                    await reloadTasksFromServer(app);
                } catch { /* ignore */ }
            } finally {
                savingTasks.delete(taskId);
                if (card) card.classList.remove('task-card--saving');
            }
        });
    });
}

function renderKanbanCards(app, tasks) {
    KANBAN_STATUSES.forEach(s => {
        const col = document.getElementById(`col-${s}`);
        const count = document.getElementById(`count-${s}`);
        if (!col) return;

        const statusTasks = tasks.filter(t => t.status_name === s);
        if (count) count.textContent = statusTasks.length;

        if (statusTasks.length === 0) {
            col.innerHTML = `<div class="empty-state" style="padding:var(--space-8);"><p class="text-muted">Нет задач</p></div>`;
            return;
        }

        col.innerHTML = statusTasks.map(task => renderTaskCard(task)).join('');

        col.querySelectorAll('.task-card').forEach(card => {
            card.draggable = true;
            let dragged = false;
            card.addEventListener('click', (e) => {
                if (dragged) { dragged = false; return; }
                if (e.target.closest('.btn-icon, .btn')) return;
                const t = tasks.find(x => String(x.id) === String(card.dataset.id));
                if (t) {
                    import('./modal.js?v=90').then(mod => mod.openTaskModal(t));
                }
            });
            card.addEventListener('dragstart', (e) => {
                dragged = true;
                card.classList.add('dragging');
                e.dataTransfer.setData('text/plain', card.dataset.id);
                e.dataTransfer.effectAllowed = 'move';
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });
        });
    });

    // Вешаем drop-обработчики на колонки (только один раз)
    setupColumnDropHandlers(app);
}
