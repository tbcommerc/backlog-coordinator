import { bindActionMenu } from '../ui/actionMenu.js';
import { canEditTask } from '../taskCardPermissions.js';
import { button, pageHeader, badge } from '../ui/primitives.js';
import { renderViewState } from './viewState.js';
console.log('[DMB] kanbanBoard.js v20260626.7 loaded');
import { renderTaskCard } from './modal.js?v=118';
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

const STATUS_TONES = ['info', 'accent', 'info', 'accent', 'accent', 'accent', 'warning', 'success', 'warning', 'warning', 'danger', 'neutral', 'success'];
const emptyColumn = () => `<div class="empty-state">${renderViewState({ kind: 'empty', title: 'Нет задач' })}</div>`;

export function renderKanban(app) {
    return `${pageHeader({ title: 'Канбан-доска', description: 'Визуальное управление потоком задач',
        actions: button({ label: 'Добавить задачу', icon: 'plus', variant: 'primary', attrs: { id: 'kanban-add-task-btn', disabled: true } }) })}
    <div id="kanban-state">${renderViewState({ kind: 'loading', title: 'Загружаем задачи…' })}</div>
    <div class="kanban-board" id="kanban-board" aria-label="Задачи по статусам" hidden>
        ${KANBAN_STATUSES.map((status, index) => `<section class="kanban-column" data-status="${status}" data-ui-tone="${STATUS_TONES[index]}" aria-labelledby="heading-${index}">
            <div class="kanban-column-header"><h2 class="kanban-column-title" id="heading-${index}">${status}
                <span id="count-${status}" class="kanban-column-count">${badge({ label: '0' })}</span>
            </h2></div>
            <div class="kanban-column-body" data-status="${status}" id="col-${status}"></div>
        </section>`).join('')}
    </div>`;
}

export async function initKanban(app) {
    // Очищаем savingTasks — могли остаться зависшие задачи от предыдущего визита
    savingTasks.clear();
    const state = document.getElementById('kanban-state');
    const board = document.getElementById('kanban-board');
    if (!state || !board) return;
    state.innerHTML = renderViewState({ kind: 'loading', title: 'Загружаем задачи…' });
    state.hidden = false;
    board.hidden = true;
    window.lucide?.createIcons();
    const addButton = document.getElementById('kanban-add-task-btn');
    if (addButton) addButton.disabled = true;

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
        if (!board.isConnected) return;
        renderKanbanCards(app, items);
        state.hidden = true;
        board.hidden = false;

        const { openCreateTaskModal, setOnTaskSaved } = await import('./modal.js?v=118');
        setOnTaskSaved(() => initKanban(app));

        if (addButton?.isConnected) {
            addButton.onclick = () => openCreateTaskModal(app);
            addButton.disabled = false;
        }

    } catch (e) {
        console.error('Kanban error:', e);
        if (!state.isConnected) return;
        state.hidden = false;
        board.hidden = true;
        state.innerHTML = renderViewState({ kind: e.status === 403 ? 'forbidden' : 'error', title: e.status === 403 ? 'Недостаточно прав' : 'Не удалось загрузить канбан', actionLabel: 'Повторить', actionId: 'kanban-retry' });
        state.querySelector('#kanban-retry')?.addEventListener('click', () => initKanban(app));
        window.lucide?.createIcons();
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
            countEl.innerHTML = badge({ label: String(count) });
            if (count === 0 && !body.querySelector('.empty-state')) {
                body.insertAdjacentHTML('beforeend', emptyColumn());
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
            version: response.version ?? kanbanCurrentTasks[idx].version,
            updated_at: response.updated_at
        };
    }
}

async function moveKanbanTask(app, taskId, newStatus) {
    const col = document.getElementById(`col-${newStatus}`);
    if (!col) return;
    const taskToMove = kanbanCurrentTasks.find(task => String(task.id) === String(taskId));
    if (!canEditTask(app.store.get('currentUser'), taskToMove)) return;
            // Set-блокировка: если задача уже сохраняется — игнорируем
            if (savingTasks.has(taskId)) return;
            savingTasks.add(taskId);

            // Находим карточку и добавляем loading-класс
            let card = document.querySelector(`.task-card[data-id="${taskId}"]`);
            if (card) { card.classList.add('task-card--saving'); card.setAttribute('aria-busy','true'); card.draggable=false; card.querySelector('[data-kanban-status]')?.setAttribute('disabled',''); }

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
                    renderKanbanCards(app, kanbanCurrentTasks);
                }
            } catch (err) {
                console.error('Drop save error:', err);
                window.toast(`Ошибка при перемещении задачи: ${err.message}`, 'error');
                // При ошибке откатываем — перезагружаем с сервера
                try {
                    await reloadTasksFromServer(app);
                } catch {
                    if (card?.isConnected && oldCol?.isConnected) {
                        oldCol.querySelector('.empty-state')?.remove();
                        oldCol.append(card);
                        updateColumnCounts();
                    }
                }
            } finally {
                savingTasks.delete(taskId);
                if (card) { card.classList.remove('task-card--saving'); card.removeAttribute('aria-busy'); card.draggable=true; card.querySelector('[data-kanban-status]')?.removeAttribute('disabled'); }
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

            await moveKanbanTask(app, taskId, newStatus);

        });
    });
}

function renderKanbanCards(app, tasks) {
    KANBAN_STATUSES.forEach(s => {
        const col = document.getElementById(`col-${s}`);
        const count = document.getElementById(`count-${s}`);
        if (!col) return;

        const statusTasks = tasks.filter(t => t.status_name === s);
        if (count) count.innerHTML = badge({ label: String(statusTasks.length) });

        if (statusTasks.length === 0) {
            col.innerHTML = emptyColumn();
            return;
        }

        col.innerHTML = statusTasks.map(task => renderTaskCard(task)).join('');

        col.querySelectorAll('.task-card').forEach(card => {
            const editable = canEditTask(app.store.get('currentUser'), tasks.find(task => String(task.id) === card.dataset.id));
            card.draggable = editable;
            card.insertAdjacentHTML('beforeend', button({label:'Изменить статус задачи', icon:'arrow-right-left', variant:'ghost', size:'small', iconOnly:true, attrs:{'data-kanban-status':card.dataset.id,disabled:!editable}}));
            const trigger = card.querySelector('[data-kanban-status]');
            const panel = document.createElement('div'); panel.hidden = true;
            panel.innerHTML = KANBAN_STATUSES.map(status => button({label:status, variant:'ghost', attrs:{'data-next-status':status, disabled:status === s}})).join('');
            card.append(panel);
            bindActionMenu({trigger, panel, label:'Переместить задачу', resolveTrigger:()=>document.querySelector(`[data-kanban-status="${card.dataset.id}"]`)});
            panel.addEventListener('click',async event=>{
                const option=event.target.closest('[data-next-status]');
                if(!option || option.disabled) return;
                await moveKanbanTask(app, card.dataset.id, option.dataset.nextStatus);
                document.querySelector(`[data-kanban-status="${card.dataset.id}"]`)?.focus();
            });
            let dragged = false;
            card.addEventListener('click', (e) => {
                if (dragged) { dragged = false; return; }
                if (e.target.closest('.btn-icon, .btn')) return;
                const t = tasks.find(x => String(x.id) === String(card.dataset.id));
                if (t) {
                    import('./modal.js?v=118').then(mod => mod.openTaskModal(t));
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
    window.lucide?.createIcons();
}
