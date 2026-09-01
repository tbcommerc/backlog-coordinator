/**
 * DMB AI Business Analyst Assistant - chat widget.
 * Multi-turn dialogue that collects a business requirement and, after
 * confirmation, creates a real task (send-for-review).
 */
import { confirmAction } from '../uiFeedback.js';

let isTyping = false;
let sessionId = null;
let currentDraft = null;
let sentRequestId = null;
let currentSlots = {};
let currentProgress = [];
let currentExpectedSlot = '';
let sessionHistoryMode = 'active';
let sessionHistoryFilter = 'all';
let sessionHistoryQuery = '';
let sessionHistorySessions = [];
let sidebarControlsAbort = null;
let pendingPollGeneration = 0;
const retryErrorMessages = new WeakMap();
const PENDING_MESSAGE_KEY_PREFIX = 'dmb-agent-pending-message:';

const SLOT_LABELS = {
  intent: 'Тип изменения', need_statement: 'Потребность', role: 'Основная роль',
  department: 'Подразделение', process: 'Процесс', product: 'Продукт', module: 'Модуль',
  as_is: 'Как сейчас', to_be: 'Целевой результат', users: 'Пользователи',
  scenarios: 'Сценарии', business_rules: 'Бизнес-правила', acceptance_criteria: 'Критерии приёмки',
  data_integrations: 'Данные и интеграции', value: 'Бизнес-ценность', priority: 'Приоритет',
  dependencies: 'Зависимости', risks: 'Риски', regulatory_flags: 'Регуляторные требования',
};

const SLOT_PLACEHOLDERS = {
  need_statement: 'Опишите проблему и почему её важно решить…', role: 'Например: бэк-офицер отдела расчётов…',
  process: 'Какой бизнес-процесс затронут?', product: 'Например: облигации, РЕПО, ПФИ…',
  as_is: 'Как процесс работает сейчас?', to_be: 'Как должен выглядеть целевой результат?',
  acceptance_criteria: 'Например: файл формируется не позднее 60 секунд…',
  value: 'Какой измеримый эффект ожидается?', priority: 'Высокий, средний или низкий приоритет?',
};

const REQUIREMENT_MAP_SLOTS = [
  'need_statement', 'to_be', 'role', 'process', 'product', 'module', 'as_is',
  'users', 'scenarios', 'business_rules', 'acceptance_criteria', 'data_integrations',
  'value', 'priority',
];

const REQUIREMENT_MAP_GROUPS = [
  { key: 'minimum', label: 'Обязательный минимум', slots: ['need_statement', 'to_be', 'role', 'acceptance_criteria'], open: true },
  { key: 'context', label: 'Контекст', slots: ['process', 'department', 'product', 'module', 'as_is', 'users'], open: true },
  { key: 'details', label: 'Дополнительные детали', slots: ['scenarios', 'business_rules', 'data_integrations', 'value', 'priority'], open: false },
  { key: 'delivery', label: 'Реализация и ограничения', slots: ['dependencies', 'risks', 'regulatory_flags'], open: false },
];

const REQUIRED_SLOTS = new Set(REQUIREMENT_MAP_GROUPS[0].slots);
const MAP_TO_DRAFT_FIELD = {
  need_statement: 'problem_statement', as_is: 'current_process', to_be: 'target_process',
  value: 'business_value', role: 'user_roles', users: 'user_roles',
};
const DRAFT_TO_MAP_SLOT = {
  problem_statement: 'need_statement', current_process: 'as_is', target_process: 'to_be',
  business_value: 'value', user_roles: 'role',
};

const PHASE_LABELS = {
  welcome: 'Новый диалог',
  identify_intent: 'Определение типа', need_statement: 'Описание потребности',
  business_context: 'Бизнес-контекст', as_is_to_be: 'As-Is / To-Be',
  roles_scenarios: 'Роли и сценарии', business_rules: 'Правила и критерии',
  data_integrations: 'Данные и интеграции', value_priority: 'Ценность и приоритет',
  summarize: 'Проверка резюме', confirm: 'Подтверждение', draft_ready: 'Черновик готов',
  sent_for_review: 'Отправлено на ревью', done: 'Завершено',
};
const CONFIDENCE_LABELS = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' };

export function renderAgentChat(app) {
  const user = app.store.get('currentUser');
  const userName = user?.name?.split(' ')[0] || 'Заказчик';
  const focusMode = true;

  return `
    <div class="chat-wrapper${focusMode ? ' chat-wrapper--focus' : ''}">
      <div class="chat-layout">
        ${focusMode ? renderSessionHistory(true) : ''}
        <div class="chat-main">
          <div class="chat-container-card">
            <div class="chat-header">
              <div class="chat-header-info">
                <div class="chat-avatar-bot">
                  <i data-lucide="bot" style="width:20px;height:20px;"></i>
                </div>
                <div>
                  <div class="chat-header-title">AI Business Analyst</div>
                  <div class="chat-header-status">
                    <span class="status-dot"></span>
                    <span id="agent-service-status">Готов к работе</span>
                  </div>
                </div>
              </div>
              <div class="chat-header-actions">
                ${focusMode ? `<button class="btn btn-secondary btn-sm chat-history-drawer-toggle" id="chat-history-drawer-toggle" type="button" aria-label="Открыть историю требований" aria-expanded="false"><i data-lucide="history" style="width:14px;height:14px;"></i></button>` : ''}
                <div class="chat-session-identity" id="chat-session-identity" hidden>
                  <span class="chat-session-identity-label">ID диалога</span>
                  <code id="chat-session-id">—</code>
                  <button type="button" id="chat-session-copy" aria-label="Скопировать ID диалога" title="Скопировать ID диалога">
                    <i data-lucide="copy"></i>
                  </button>
                </div>
                <button class="btn btn-secondary btn-sm" id="agent-chat-clear-btn" aria-label="Создать новое требование" title="Новое требование">
                  <i data-lucide="file-plus-2" style="width:14px;height:14px;"></i>
                  <span>Новое требование</span>
                </button>
              </div>
            </div>

            <div class="chat-messages" id="agent-chat-messages" role="log" aria-live="polite" aria-relevant="additions">
              ${renderAgentWelcome(userName)}
            </div>

            <div class="chat-input-area">
              <div class="chat-current-question" id="chat-current-question" style="display:none;" aria-live="polite">
                <div class="chat-current-question-label">Сейчас уточняем</div>
                <div class="chat-current-question-text" id="chat-current-question-text"></div>
              </div>
              <div class="chat-input-wrapper">
                <label class="sr-only" for="agent-chat-input">Ответ ассистенту</label>
                <textarea
                  id="agent-chat-input"
                  class="chat-input"
                  placeholder="Опишите проблему или доработку..."
                  rows="1"
                ></textarea>
                <button class="btn btn-primary chat-send-btn" id="agent-chat-send-btn" aria-label="Отправить сообщение" disabled>
                  <i data-lucide="send" style="width:16px;height:16px;"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-mobile-tabs" role="tablist" aria-label="Режим страницы">
          <button class="chat-mobile-tab active" data-chat-view="dialog" role="tab" aria-selected="true">Диалог</button>
          <button class="chat-mobile-tab" data-chat-view="requirement" role="tab" aria-selected="false">Требование <span class="requirement-tab-count"></span></button>
        </div>

        <aside class="chat-sidebar" id="chat-requirement-pane" aria-label="Карта требования">
          ${focusMode ? '' : renderSessionHistory(false)}

          <div class="requirement-workspace" id="requirement-workspace">
            <div class="requirement-map-card" id="requirement-map-card" style="display:none;">
              <div class="requirement-map-header">
                <div><h2 id="requirement-workspace-title">Требование</h2><span class="requirement-map-caption" id="requirement-workspace-caption">Собирается вместе с диалогом · любое поле можно исправить</span></div>
                <span class="badge badge-info" id="requirement-map-status">Не начато</span>
              </div>
              <div class="requirement-map-empty" id="requirement-map-empty">
                <strong>Здесь будет собираться требование</strong>
                <span>Ассистент выделит потребность, целевой результат, пользователей и критерии приёмки. Любое значение можно будет исправить здесь.</span>
              </div>
              <div class="requirement-map-fields" id="requirement-map-fields"></div>
            </div>

            <div class="chat-draft-panel" id="chat-draft-panel" style="display:none;">
              <div class="chat-draft-panel-header">
                <i data-lucide="clipboard-check" style="width:16px;height:16px;color:var(--success);"></i>
                <span>Финальная проверка</span>
              </div>
              <div class="chat-draft-panel-content" id="chat-draft-panel-content"></div>
              <div class="chat-draft-panel-actions" id="chat-draft-panel-actions"></div>
            </div>
          </div>

          <div class="chat-progress-card" id="chat-progress-card">
            <div class="chat-progress-header">
              <i data-lucide="clipboard-check" style="width:16px;height:16px;color:var(--primary);"></i>
              <span>Готовность требования</span>
            </div>
            <div class="chat-progress-text" id="chat-progress-text">Опишите потребность, чтобы начать</div>
            <div class="chat-progress-list" id="chat-progress-list" hidden></div>
          </div>

        </aside>
      </div>
    </div>
  `;
}

function renderSessionHistory(persistent = false) {
  return `
          <div class="chat-sessions-card${persistent ? ' chat-history-panel' : ''}">
            ${persistent ? `
            <button class="chat-sessions-header chat-sessions-header--static" id="chat-history-collapse" type="button" aria-expanded="true" aria-label="Свернуть историю требований">
              <i data-lucide="history" style="width:16px;height:16px;color:var(--primary);"></i>
              <span id="chat-sessions-title">История требований</span>
              <i class="chat-sessions-chevron" data-lucide="panel-left-close"></i>
            </button>` : `
            <button class="chat-sessions-header" id="chat-sessions-toggle" type="button" aria-expanded="false" aria-controls="chat-sessions-popover">
              <i data-lucide="history" style="width:16px;height:16px;color:var(--primary);"></i>
              <span id="chat-sessions-title">История требований</span>
              <i class="chat-sessions-chevron" data-lucide="chevron-down"></i>
            </button>`}
            <div class="chat-sessions-popover" id="chat-sessions-popover"${persistent ? '' : ' hidden'}>
              <div class="chat-sessions-popover-head">
                <strong>История требований</strong>
                <button type="button" class="chat-sessions-close" id="chat-sessions-close" aria-label="Закрыть историю">
                  <i data-lucide="x"></i>
                </button>
              </div>
              <div class="chat-sessions-tabs" role="tablist" aria-label="Фильтр истории">
                <button class="chat-sessions-tab active" data-session-mode="active" role="tab" aria-selected="true"><i data-lucide="messages-square"></i><span>Активные</span></button>
                <button class="chat-sessions-tab" data-session-mode="archive" role="tab" aria-selected="false"><i data-lucide="archive"></i><span>Архив</span></button>
              </div>
              <div class="chat-sessions-tools">
                <label class="chat-sessions-search">
                  <i data-lucide="search" aria-hidden="true"></i>
                  <span class="sr-only">Поиск по истории требований</span>
                  <input id="chat-sessions-search" type="search" placeholder="Найти требование…" autocomplete="off">
                </label>
                <div class="chat-sessions-filters" role="group" aria-label="Статус требования">
                  <button type="button" class="active" data-session-filter="all">Все</button>
                  <button type="button" data-session-filter="action">Требуют действия</button>
                  <button type="button" data-session-filter="draft">Черновики</button>
                  <button type="button" data-session-filter="sent">Отправленные</button>
                </div>
              </div>
              <div class="chat-sessions-notice" id="chat-sessions-notice" role="status" hidden></div>
              <div class="chat-sessions-list" id="chat-sessions-list">
                <div class="chat-sessions-empty">Загрузка...</div>
              </div>
            </div>
          </div>
  `;
}

function renderAgentWelcome(userName) {
  return `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">
        <i data-lucide="message-circle" style="width:32px;height:32px;"></i>
      </div>
      <div class="chat-welcome-title">Привет, ${escapeHtml(userName)}!</div>
      <div class="chat-welcome-desc">
        Опишите задачу своими словами. Я разберу контекст, уточню только существенные детали и подготовлю черновик требования.
      </div>
    </div>
  `;
}

export async function initAgentChat(app) {
  const pollGeneration = ++pendingPollGeneration;
  isTyping = false;
  sessionId = null;
  currentDraft = null;
  sentRequestId = null;
  currentSlots = {};
  currentProgress = [];
  currentExpectedSlot = '';

  const input = document.getElementById('agent-chat-input');
  const sendBtn = document.getElementById('agent-chat-send-btn');
  const clearBtn = document.getElementById('agent-chat-clear-btn');

  input?.addEventListener('input', () => {
    autoResize(input);
    sendBtn.disabled = !input.value.trim();
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (input.value.trim()) send(app, input.value);
    }
  });
  sendBtn?.addEventListener('click', () => {
    if (input.value.trim()) send(app, input.value);
  });
  clearBtn?.addEventListener('click', () => newDialog(app));
  document.getElementById('chat-session-copy')?.addEventListener('click', copyCurrentSessionId);
  bindWorkspaceControls();
  bindSidebarControls();
  document.getElementById('chat-sessions-search')?.addEventListener('input', event => {
    sessionHistoryQuery = event.target.value.trim().toLocaleLowerCase('ru');
    renderSessions(app);
  });
  document.querySelectorAll('[data-session-filter]').forEach(btn => btn.addEventListener('click', () => {
    sessionHistoryFilter = btn.dataset.sessionFilter;
    document.querySelectorAll('[data-session-filter]').forEach(item => item.classList.toggle('active', item === btn));
    renderSessions(app);
  }));
  document.querySelectorAll('[data-session-mode]').forEach(btn => btn.addEventListener('click', () => {
    sessionHistoryMode = btn.dataset.sessionMode;
    document.querySelectorAll('[data-session-mode]').forEach(item => {
      const selected = item === btn;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    renderSessions(app);
  }));

  if (window.lucide) window.lucide.createIcons();

  try {
    const state = await app.api.get('/agent/session');
    if (state && state.active && state.session_id) {
      sessionId = state.session_id;
      updateSessionIdentity(sessionId);
      currentDraft = state.draft || null;
      sentRequestId = state.request_id || null;
      updateRequirementWorkspace(state);
      if (state.history && state.history.length) {
        const container = document.getElementById('agent-chat-messages');
        container.innerHTML = '';
        renderHistory(state.history);
        if (state.draft && state.phase === 'draft_ready') {
          appendDraftResume(state.draft);
        }
      } else if (state.draft && state.phase === 'draft_ready') {
        renderDraftResume(state.draft);
      }
    }
  } catch (_) { /* agent may be down */ }

  const pendingMessage = restorePendingUserMessage(app);
  if (pendingMessage) resumePendingProcessing(app, pendingMessage, pollGeneration);

  loadSessions(app);
}

async function loadSessions(app) {
  const list = document.getElementById('chat-sessions-list');
  if (!list) return;
  try {
    const data = await app.api.get('/agent/sessions');
    sessionHistorySessions = data.sessions || [];
    renderSessions(app);
  } catch (_) {
    list.innerHTML = `<div class="chat-sessions-empty chat-message-error">Не удалось загрузить диалоги.<br>
      <button class="btn btn-secondary btn-sm" id="chat-sessions-retry">Повторить</button></div>`;
    list.querySelector('#chat-sessions-retry')?.addEventListener('click', () => loadSessions(app));
  }
}

function renderSessions(app) {
  const list = document.getElementById('chat-sessions-list');
  if (!list) return;
  const modeSessions = sessionHistorySessions.filter(s => sessionHistoryMode === 'archive' ? s.archived : !s.archived);
  const title = document.getElementById('chat-sessions-title');
  if (title) title.textContent = `История требований${modeSessions.length ? ` · ${modeSessions.length}` : ''}`;
  const visibleSessions = sessionHistorySessions
      .filter(s => sessionHistoryMode === 'archive' ? s.archived : !s.archived)
      .filter(s => sessionMatchesFilter(s, sessionHistoryFilter))
      .filter(s => !sessionHistoryQuery || `${s.title || ''} ${PHASE_LABELS[s.phase] || ''} ${s.session_id || ''}`.toLocaleLowerCase('ru').includes(sessionHistoryQuery))
      .map((session, sourceIndex) => ({ session, sourceIndex }))
      .sort((left, right) => {
        const leftTime = Date.parse(left.session.last_message_at || left.session.updated_at || '') || 0;
        const rightTime = Date.parse(right.session.last_message_at || right.session.updated_at || '') || 0;
        return rightTime - leftTime || left.sourceIndex - right.sourceIndex;
      })
      .map(({ session }) => session);
    if (!visibleSessions.length) {
      const filtered = Boolean(sessionHistoryQuery || sessionHistoryFilter !== 'all');
      list.innerHTML = `<div class="chat-sessions-empty">${filtered ? 'Ничего не найдено. Измените запрос или фильтр.' : (sessionHistoryMode === 'archive' ? 'Архив пуст' : 'Нет активных диалогов')}</div>`;
      return;
    }
    list.innerHTML = visibleSessions.map(s => {
      const status = getSessionStatus(s);
      const time = formatSessionTime(s.last_message_at || s.updated_at);
      return `
      <div class="chat-session-row${s.active ? ' active' : ''}">
        <button class="chat-session-item" data-session-id="${escapeHtml(s.session_id)}"${s.active ? ' aria-current="true"' : ''}>
          <div class="chat-session-title">${escapeHtml(s.title)}</div>
          <div class="chat-session-meta"><span class="chat-session-state ${status.className}">${escapeHtml(status.label)}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}</div>
        </button>
        <button class="chat-session-menu-toggle" data-session-menu="${escapeHtml(s.session_id)}" aria-label="Действия с требованием «${escapeHtml(s.title)}»" aria-expanded="false">
          <i data-lucide="ellipsis"></i>
        </button>
        <div class="chat-session-menu" data-session-menu-panel="${escapeHtml(s.session_id)}" hidden>
          <button type="button" data-copy-session="${escapeHtml(s.session_id)}"><i data-lucide="copy"></i>Копировать ID</button>
          <button type="button" data-archive-session="${escapeHtml(s.session_id)}" data-archived="${s.archived ? 'true' : 'false'}"><i data-lucide="${s.archived ? 'archive-restore' : 'archive'}"></i>${s.archived ? 'Вернуть из архива' : 'Переместить в архив'}</button>
        </div>
      </div>
    `}).join('');
    list.querySelectorAll('[data-session-id]').forEach(btn => {
      btn.addEventListener('click', () => switchSession(app, btn.dataset.sessionId));
    });
    list.querySelectorAll('[data-archive-session]').forEach(btn => {
      btn.addEventListener('click', () => setSessionArchived(app, btn.dataset.archiveSession, btn.dataset.archived !== 'true'));
    });
    list.querySelectorAll('[data-copy-session]').forEach(btn => btn.addEventListener('click', () => copySessionId(btn.dataset.copySession)));
    list.querySelectorAll('[data-session-menu]').forEach(btn => btn.addEventListener('click', event => {
      event.stopPropagation();
      const panel = list.querySelector(`[data-session-menu-panel="${CSS.escape(btn.dataset.sessionMenu)}"]`);
      const open = panel?.hidden !== false;
      list.querySelectorAll('[data-session-menu-panel]').forEach(item => { item.hidden = true; });
      list.querySelectorAll('[data-session-menu]').forEach(item => item.setAttribute('aria-expanded', 'false'));
      if (panel) panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }));
    if (window.lucide) window.lucide.createIcons();
}

function sessionMatchesFilter(session, filter) {
  if (filter === 'action') return !['draft_ready', 'sent_for_review', 'done'].includes(session.phase) && !(session.phase === 'welcome' && session.title === 'Новый диалог');
  if (filter === 'draft') return session.phase === 'draft_ready';
  if (filter === 'sent') return ['sent_for_review', 'done'].includes(session.phase);
  return true;
}

function getSessionStatus(session) {
  if (session.archived) return { label: 'В архиве', className: 'is-archived' };
  if (['sent_for_review', 'done'].includes(session.phase)) return { label: PHASE_LABELS[session.phase], className: 'is-sent' };
  if (session.phase === 'draft_ready') return { label: 'Черновик готов', className: 'is-draft' };
  if (session.phase === 'welcome') return session.title === 'Новый диалог'
    ? { label: 'Не начато', className: 'is-idle' }
    : { label: 'В работе', className: 'is-action' };
  return { label: 'Требует продолжения', className: 'is-action' };
}

function formatSessionTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Сегодня, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Вчера, ${time}`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

async function copySessionId(value) {
  try {
    await navigator.clipboard.writeText(String(value));
    showSessionsNotice('ID диалога скопирован');
  } catch (_) {
    showSessionsNotice(`ID: ${value}`);
  }
}

function showSessionsNotice(message, actionLabel = '', action = null) {
  const notice = document.getElementById('chat-sessions-notice');
  if (!notice) return;
  notice.hidden = false;
  notice.innerHTML = `<span>${escapeHtml(message)}</span>${actionLabel ? `<button type="button">${escapeHtml(actionLabel)}</button>` : ''}`;
  notice.querySelector('button')?.addEventListener('click', action);
  window.setTimeout(() => { if (notice.textContent.includes(message)) notice.hidden = true; }, 6000);
}

async function setSessionArchived(app, targetSessionId, archived) {
  if (archived && targetSessionId === sessionId) {
    const confirmed = await confirmAction({
      title: 'Переместить диалог в архив?',
      message: 'Текущий диалог будет перемещён в архив, после чего откроется новое требование.',
      confirmText: 'Переместить в архив',
      cancelText: 'Отмена',
    });
    if (!confirmed) return;
  }
  try {
    await app.api.post(`/agent/session/${encodeURIComponent(targetSessionId)}/archive?archived=${archived}`);
    if (archived && targetSessionId === sessionId) {
      currentDraft = null;
      sentRequestId = null;
      await newDialog(app);
      return;
    }
    await loadSessions(app);
    showSessionsNotice(
      archived ? 'Требование перемещено в архив' : 'Требование возвращено в активные',
      archived ? 'Отменить' : '',
      archived ? () => setSessionArchived(app, targetSessionId, false) : null,
    );
  } catch (e) {
    addMessage('bot', `Не удалось изменить архив: ${e.message}`, { error: true });
  }
}

async function switchSession(app, session_id) {
  if (session_id === sessionId) return;
  try {
    await app.api.post('/agent/session/' + encodeURIComponent(session_id) + '/activate');
    const state = await app.api.get('/agent/session/' + session_id);
    sessionId = state.session_id || session_id;
    updateSessionIdentity(sessionId);
    currentDraft = state.draft || null;
    sentRequestId = state.request_id || null;
    updateRequirementWorkspace(state);
    const container = document.getElementById('agent-chat-messages');
    container.innerHTML = '';
    if (state.history && state.history.length) {
      renderHistory(state.history);
    }
    if (state.draft && state.phase === 'draft_ready') {
      appendDraftResume(state.draft);
    } else {
      hideDraftPanel();
    }
    if (window.lucide) window.lucide.createIcons();
    closeHistoryPopover();
    loadSessions(app);
  } catch (e) {
    addMessage('bot', `Не удалось открыть диалог: ${e.message}`, { error: true });
  }
}

async function newDialog(app) {
  if (currentDraft && !sentRequestId) {
    const confirmed = await confirmAction({
      title: 'Создать новое требование?',
      message: 'Текущий черновик ещё не отправлен. Он останется в истории, и вы сможете вернуться к нему позже.',
      confirmText: 'Создать новое',
      cancelText: 'Остаться здесь',
    });
    if (!confirmed) return;
  }
  const btn = document.getElementById('agent-chat-clear-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;" class="animate-spin"></i>';
    if (window.lucide) window.lucide.createIcons();
  }
  try {
    const resp = await app.api.post('/agent/new-dialog');
    sessionId = resp.session_id || null;
    updateSessionIdentity(sessionId);
    currentDraft = null;
    sentRequestId = null;
    currentSlots = {};
    currentProgress = [];
    currentExpectedSlot = '';
    updateRequirementWorkspace({});
    hideDraftPanel();
    const container = document.getElementById('agent-chat-messages');
    if (container) {
      container.innerHTML = renderAgentWelcome(
        app.store.get('currentUser')?.name?.split(' ')[0] || 'Заказчик'
      );
      if (window.lucide) window.lucide.createIcons();
    }
    const input = document.getElementById('agent-chat-input');
    const sendBtn = document.getElementById('agent-chat-send-btn');
    if (input) { input.value = ''; autoResize(input); }
    if (sendBtn) sendBtn.disabled = true;
    await loadSessions(app);
  } catch (e) {
    console.error('[DMB] newDialog error:', e);
    addMessage('bot', `Ошибка создания диалога: ${e.message}`, { error: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="file-plus-2" style="width:14px;height:14px;"></i><span>Новое требование</span>';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

function renderHistory(history) {
  let lastUserMessage = '';
  (history || []).forEach(entry => {
    if (entry.role === 'user') {
      lastUserMessage = entry.content || '';
      addMessage('user', lastUserMessage);
    } else if (entry.role === 'assistant') {
      const content = entry.content || '';
      const unavailable = isModelUnavailableMessage(content);
      const messageElement = addMessage('bot', content, { error: unavailable });
      if (unavailable && lastUserMessage) attachRetryButton(lastUserMessage, messageElement);
    }
  });
}

function isModelUnavailableMessage(content) {
  return String(content || '').includes('ИИ-модель сейчас недоступна');
}

function renderDraftResume(draft) {
  appendDraftResume(draft, {
    intro: 'Есть собранный драфт требования. Можно отправить его на ревью или внести правки.',
  });
}

function appendDraftResume(draft, opts = {}) {
  if (opts.intro) addMessage('bot', opts.intro, { info: true });
  showDraftPanel(draft, sessionId);
}

async function send(app, rawMessage) {
  const message = rawMessage.trim();
  if (!message || isTyping) return;

  const container = document.getElementById('agent-chat-messages');
  if (!container) return;

  const messageId = newMessageId();
  savePendingUserMessage(app, message, messageId);
  addMessage('user', message);
  document.getElementById('agent-chat-input').value = '';
  autoResize(document.getElementById('agent-chat-input'));
  document.getElementById('agent-chat-send-btn').disabled = true;

  await performChat(app, message, messageId);
}

async function performChat(app, value, messageId = newMessageId()) {
  if (isTyping) return;
  showTyping();
  isTyping = true;
  let failed = false;
  let modelUnavailable = false;
  try {
    const payload = { message: value, message_id: messageId };
    if (sessionId) payload.session_id = sessionId;
    const resp = await app.api.post('/agent/chat', payload);
    sessionId = resp.session_id || sessionId;
    clearPendingUserMessage(app, messageId);
    updateSessionIdentity(sessionId);
    renderAgentResponse(resp, value);
    loadSessions(app);
    modelUnavailable = resp.action === 'unavailable';
    if (!modelUnavailable) removeRetryButtons();
  } catch (e) {
    failed = true;
    const errorMessage = addMessage('bot', `Ошибка связи с ассистентом: ${e.message}. Попробуйте ещё раз.`, { error: true });
    attachRetryButton(value, errorMessage, messageId);
  } finally {
    hideTyping();
    if (failed) {
      const status = document.getElementById('agent-service-status');
      if (status) status.textContent = 'Связь потеряна — можно повторить';
    } else if (modelUnavailable) {
      const status = document.getElementById('agent-service-status');
      if (status) status.textContent = 'ИИ-модель недоступна — можно повторить';
    }
    isTyping = false;
  }
}

function pendingMessageKey(app) {
  const userId = app?.store?.get('currentUser')?.id || 'anonymous';
  return `${PENDING_MESSAGE_KEY_PREFIX}${userId}`;
}

function savePendingUserMessage(app, content, messageId) {
  try {
    localStorage.setItem(pendingMessageKey(app), JSON.stringify({
      content, message_id: messageId, session_id: sessionId || '',
    }));
  } catch (_) { /* storage may be unavailable */ }
}

function clearPendingUserMessage(app, messageId) {
  try {
    const key = pendingMessageKey(app);
    const pending = JSON.parse(localStorage.getItem(key) || 'null');
    if (!pending || !messageId || pending.message_id === messageId) localStorage.removeItem(key);
  } catch (_) { /* storage may be unavailable */ }
}

function restorePendingUserMessage(app) {
  try {
    const key = pendingMessageKey(app);
    const pending = JSON.parse(localStorage.getItem(key) || 'null');
    if (!pending?.content) return null;
    const visibleMessages = [...document.querySelectorAll('.chat-message-user .chat-message-content')];
    const alreadyVisible = visibleMessages.some(node => node.textContent === pending.content);
    if (!alreadyVisible) addMessage('user', pending.content);
    return pending;
  } catch (_) {
    return null;
  }
}

function pendingTurnHasAnswer(history, pending) {
  const entries = history || [];
  const userIndex = entries.findIndex(entry => entry.role === 'user' && (
    (pending.message_id && entry.message_id === pending.message_id)
    || (!entry.message_id && entry.content === pending.content)
  ));
  return userIndex >= 0 && entries.slice(userIndex + 1).some(entry => entry.role === 'assistant');
}

async function resumePendingProcessing(app, pending, generation) {
  const targetSessionId = pending.session_id || sessionId;
  if (!targetSessionId || !document.getElementById('agent-chat-messages')) return;
  isTyping = true;
  showTyping();

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (generation !== pendingPollGeneration || !document.getElementById('agent-chat-input')) return;
    try {
      const state = await app.api.get('/agent/session/' + encodeURIComponent(targetSessionId));
      if (pendingTurnHasAnswer(state.history, pending)) {
        clearPendingUserMessage(app, pending.message_id);
        sessionId = state.session_id || targetSessionId;
        currentDraft = state.draft || null;
        sentRequestId = state.request_id || null;
        updateSessionIdentity(sessionId);
        updateRequirementWorkspace(state);
        const container = document.getElementById('agent-chat-messages');
        if (container) {
          container.innerHTML = '';
          renderHistory(state.history);
        }
        hideTyping();
        isTyping = false;
        return;
      }
    } catch (_) { /* transient polling failure */ }
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }

  hideTyping();
  isTyping = false;
  const status = document.getElementById('agent-service-status');
  if (status) status.textContent = 'Обработка заняла больше обычного';
}

function renderAgentResponse(resp, retryValue = '') {
  if (resp.draft) currentDraft = resp.draft;
  updateRequirementWorkspace(resp);
  const responseMessage = addMessage('bot', resp.message || '', { error: resp.action === 'unavailable' });

  if (resp.action === 'unavailable') {
    const status = document.getElementById('agent-service-status');
    if (status) status.textContent = 'ИИ-модель недоступна';
    if (retryValue) attachRetryButton(retryValue, responseMessage);
  }

  if (resp.action === 'refused') {
    addMessage('bot', 'Если запрос ошибочный — извините. В рамках платформы я помогаю только с требованиями.', { error: true });
  }

  // Update progress panel
  if (resp.progress && resp.progress.length > 0) {
    updateProgressPanel(resp.progress, resp.quality);
  }

  let draftActionButtons = null;
  (resp.blocks || []).forEach(block => {
    if (block.type === 'draft_preview' && block.draft) {
      showDraftPanel(block.draft, resp.session_id);
    } else if (block.type === 'actions' && block.buttons) {
      draftActionButtons = block.buttons;
    }
  });

  if (resp.action === 'draft_ready' && resp.draft) {
    showDraftPanel(resp.draft, resp.session_id);
  }

  if (resp.action === 'sent' && resp.request_id) {
    sentRequestId = resp.request_id;
    disableDraftActions(resp.request_id);
    renderRequestLink(resp);
    hideDraftPanel();
  }

  const container = document.getElementById('agent-chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function updateProgressPanel(progress, quality = {}) {
  const card = document.getElementById('chat-progress-card');
  const text = document.getElementById('chat-progress-text');
  const list = document.getElementById('chat-progress-list');
  
  if (!card || !progress) return;
  
  const filled = progress.filter(p => p.filled).length;
  const missingRequired = [...REQUIRED_SLOTS].filter(key => {
    const item = progress.find(p => p.key === key || p.slot === key);
    return !item || (!item.filled && !item.skipped);
  }).length;
  text.textContent = !filled
    ? 'Опишите потребность, чтобы начать'
    : (missingRequired
      ? `Нужно уточнить ${missingRequired} ${pluralizePoints(missingRequired)}`
      : (quality.issues?.length ? `Можно сформировать черновик · ${quality.issues.length} рекомендации` : 'Можно сформировать черновик'));
  
  list.innerHTML = progress.filter(p => p.needs_review || (!p.filled && !p.skipped)).slice(0, 4).map(p => {
    const icon = p.needs_review ? 'alert-circle' : (p.filled ? 'check-circle' : (p.skipped ? 'minus-circle' : 'circle'));
    const color = p.needs_review ? 'var(--warning)' : (p.filled ? 'var(--success)' : (p.skipped ? 'var(--text-muted)' : 'var(--text-secondary)'));
    const suffix = p.needs_review ? ' — требуется проверка' : '';
    return `
      <div class="chat-progress-item">
        <i data-lucide="${icon}" style="width:14px;height:14px;color:${color};"></i>
        <span>${escapeHtml(p.label + suffix)}</span>
      </div>
    `;
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

function pluralizePoints(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пункт';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'пункта';
  return 'пунктов';
}

function pluralizeRemarks(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'замечание';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'замечания';
  return 'замечаний';
}

function pluralizeBlockers(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'блокер';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'блокера';
  return 'блокеров';
}

function updateRequirementWorkspace(resp = {}) {
  currentSlots = resp.slots || currentSlots || {};
  currentProgress = resp.progress || currentProgress || [];
  currentExpectedSlot = resp.expected_slot || '';
  const fields = document.getElementById('requirement-map-fields');
  const mapCard = document.getElementById('requirement-map-card');
  const requirementPane = document.getElementById('chat-requirement-pane');
  const empty = document.getElementById('requirement-map-empty');
  const status = document.getElementById('requirement-map-status');
  const title = document.getElementById('requirement-workspace-title');
  const caption = document.getElementById('requirement-workspace-caption');
  const counts = document.querySelectorAll('.requirement-tab-count');
  const allSlots = REQUIREMENT_MAP_GROUPS.flatMap(group => group.slots);
  const filledKeys = new Set(allSlots.filter(key => hasRequirementValue(getRequirementValue(key))));
  if (fields) {
    fields.innerHTML = REQUIREMENT_MAP_GROUPS.map(group => {
      const filledInGroup = group.slots.filter(key => filledKeys.has(key)).length;
      const missingRequired = group.slots.filter(key => REQUIRED_SLOTS.has(key) && !filledKeys.has(key)).length;
      const groupStatus = missingRequired
        ? `${missingRequired} нужно заполнить`
        : `${filledInGroup} из ${group.slots.length}`;
      const rows = group.slots.map(key => renderRequirementMapField(key, filledKeys)).join('');
      return `<details class="requirement-map-group"${group.open || filledInGroup ? ' open' : ''}>
        <summary><span>${escapeHtml(group.label)}</span><span class="requirement-map-group-status">${escapeHtml(groupStatus)}</span></summary>
        <div class="requirement-map-group-fields">${rows}</div>
      </details>`;
    }).join('');
    fields.querySelectorAll('[data-edit-slot]').forEach(btn => btn.addEventListener('click', () => editRequirementField(btn.dataset.editSlot)));
    fields.querySelectorAll('[data-cancel-slot]').forEach(btn => btn.addEventListener('click', () => updateRequirementWorkspace()));
    fields.querySelectorAll('[data-save-slot]').forEach(btn => btn.addEventListener('click', () => saveRequirementField(btn.dataset.saveSlot)));
    fields.querySelectorAll('[data-slot-state]').forEach(btn => btn.addEventListener('click', () => saveRequirementField(btn.dataset.slotState, btn.dataset.stateValue)));
  }
  if (empty) empty.style.display = filledKeys.size ? 'none' : 'block';
  if (fields) fields.style.display = filledKeys.size ? 'grid' : 'none';
  if (mapCard) mapCard.style.display = 'flex';
  if (requirementPane) requirementPane.classList.add('has-requirement-map');
  if (status) status.textContent = sentRequestId ? 'Отправлено' : (currentDraft ? 'Финальная проверка' : (filledKeys.size ? 'Собираем' : 'Не начато'));
  if (title) title.textContent = currentDraft?.title || 'Требование';
  if (caption) caption.textContent = sentRequestId
    ? `Передано на ревью · запрос #${sentRequestId}`
    : (currentDraft
      ? 'Проверьте документ целиком · изменения вносятся прямо в полях'
      : 'Собирается вместе с диалогом · любое поле можно исправить');
  counts.forEach(count => { count.textContent = filledKeys.size ? `· ${filledKeys.size}` : ''; });
  updateCurrentQuestion(resp.message, currentExpectedSlot);
  if (resp.progress) updateProgressPanel(resp.progress, resp.quality || {});
  if (window.lucide) window.lucide.createIcons();
}

function getRequirementValue(slot) {
  const draftField = MAP_TO_DRAFT_FIELD[slot] || slot;
  const draftValue = currentDraft?.[draftField];
  if (hasRequirementValue(draftValue)) return draftValue;
  return currentSlots?.[slot];
}

function hasRequirementValue(value) {
  if (Array.isArray(value)) return value.some(item => String(item ?? '').trim());
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function renderRequirementMapField(key, filledKeys) {
  const value = getRequirementValue(key);
  const filled = filledKeys.has(key);
  const progress = currentProgress.find(item => item.key === key || item.slot === key) || {};
  const review = Boolean(progress.needs_review);
  const skipped = Boolean(progress.skipped);
  const required = REQUIRED_SLOTS.has(key);
  const displayValue = filled ? (Array.isArray(value) ? value.join('; ') : value) : (required ? 'Нужно заполнить' : (skipped ? 'Пропущено' : 'Не добавлено'));
  const stateLabel = review ? 'Нужно проверить' : (filled ? 'Заполнено' : (required ? 'Обязательно' : 'Необязательно'));
  return `<article class="requirement-map-field${review ? ' needs-review' : ''}${filled ? '' : ' is-empty'}" data-slot-card="${escapeHtml(key)}">
    <div class="requirement-map-field-head">
      <span>${escapeHtml(SLOT_LABELS[key] || key)}</span>
      <span class="requirement-map-field-state">${escapeHtml(stateLabel)}</span>
    </div>
    <button type="button" class="requirement-map-value" data-edit-slot="${escapeHtml(key)}" aria-label="Изменить поле ${escapeHtml(SLOT_LABELS[key] || key)}">${escapeHtml(displayValue)}</button>
    ${review ? '<div class="requirement-map-warning"><i data-lucide="circle-alert"></i> Ассистент не уверен — проверьте формулировку</div>' : ''}
  </article>`;
}

function updateCurrentQuestion(message, expectedSlot) {
  const wrap = document.getElementById('chat-current-question');
  const text = document.getElementById('chat-current-question-text');
  const input = document.getElementById('agent-chat-input');
  const isQuestion = Boolean(expectedSlot && message);
  if (wrap) wrap.style.display = isQuestion ? 'block' : 'none';
  if (text && isQuestion) text.textContent = `${SLOT_LABELS[expectedSlot] || expectedSlot} — ответьте на последний вопрос ассистента`;
  if (input) input.placeholder = SLOT_PLACEHOLDERS[expectedSlot] || 'Опишите ответ своими словами…';
}

function editRequirementField(slot) {
  slot = DRAFT_TO_MAP_SLOT[slot] || slot;
  const card = document.querySelector(`[data-slot-card="${slot}"]`);
  if (!card) return;
  card.closest('details')?.setAttribute('open', '');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const raw = getRequirementValue(slot);
  const value = Array.isArray(raw) ? raw.join('; ') : (raw || '');
  card.classList.add('is-editing');
  card.innerHTML = `<label class="requirement-map-editor-label" for="requirement-edit-${escapeHtml(slot)}">${escapeHtml(SLOT_LABELS[slot] || slot)}</label>
    <textarea id="requirement-edit-${escapeHtml(slot)}" class="requirement-map-editor" rows="3" placeholder="${escapeHtml(SLOT_PLACEHOLDERS[slot] || 'Введите значение…')}">${escapeHtml(value)}</textarea>
    <div class="requirement-map-editor-secondary">
      <button type="button" data-slot-state="${escapeHtml(slot)}" data-state-value="Не знаю, нужно уточнить">Не знаю</button>
      ${REQUIRED_SLOTS.has(slot) ? '' : `<button type="button" data-slot-state="${escapeHtml(slot)}" data-state-value="Не применимо">Не применимо</button>`}
    </div>
    <div class="requirement-map-editor-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-cancel-slot="${escapeHtml(slot)}">Отмена</button>
      <button type="button" class="btn btn-primary btn-sm" data-save-slot="${escapeHtml(slot)}">Сохранить</button>
    </div>`;
  card.querySelector('[data-cancel-slot]')?.addEventListener('click', () => updateRequirementWorkspace());
  card.querySelector('[data-save-slot]')?.addEventListener('click', () => saveRequirementField(slot));
  card.querySelectorAll('[data-slot-state]').forEach(btn => btn.addEventListener('click', () => saveRequirementField(slot, btn.dataset.stateValue)));
  card.querySelector('textarea')?.focus();
}

async function saveRequirementField(slot, explicitValue = '') {
  const editor = document.getElementById(`requirement-edit-${slot}`);
  const value = String(explicitValue || editor?.value || '').trim();
  if (!value) { editor?.focus(); return; }
  if (currentDraft) {
    const draftField = MAP_TO_DRAFT_FIELD[slot] || slot;
    await saveDraftSection(draftField, value, SLOT_LABELS[slot] || slot);
    return;
  }
  const card = document.querySelector(`[data-slot-card="${slot}"]`);
  card?.classList.add('is-saving');
  await performChat(window.app, `Исправить «${SLOT_LABELS[slot] || slot}»: ${value}`);
}

function bindWorkspaceControls() {
  document.querySelectorAll('[data-chat-view]').forEach(btn => btn.addEventListener('click', () => {
    const view = btn.dataset.chatView;
    document.querySelectorAll('[data-chat-view]').forEach(item => {
      item.classList.toggle('active', item === btn);
      item.setAttribute('aria-selected', item === btn ? 'true' : 'false');
    });
    document.querySelector('.chat-main')?.classList.toggle('mobile-hidden', view !== 'dialog');
    document.getElementById('chat-requirement-pane')?.classList.toggle('mobile-visible', view === 'requirement');
    if (view === 'dialog') closeHistoryPopover();
  }));
}

function bindSidebarControls() {
  sidebarControlsAbort?.abort();
  sidebarControlsAbort = new AbortController();
  const { signal } = sidebarControlsAbort;
  const historyToggle = document.getElementById('chat-sessions-toggle');
  const historyPopover = document.getElementById('chat-sessions-popover');
  const focusWrapper = document.querySelector('.chat-wrapper--focus');
  const historyCollapse = document.getElementById('chat-history-collapse');
  const historyDrawerToggle = document.getElementById('chat-history-drawer-toggle');
  historyCollapse?.addEventListener('click', () => {
    const collapsed = focusWrapper?.classList.toggle('history-collapsed') || false;
    historyCollapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    historyCollapse.setAttribute('aria-label', collapsed ? 'Развернуть историю требований' : 'Свернуть историю требований');
  }, { signal });
  historyDrawerToggle?.addEventListener('click', () => {
    const open = focusWrapper?.classList.toggle('history-drawer-open') || false;
    historyDrawerToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    historyDrawerToggle.setAttribute('aria-label', open ? 'Закрыть историю требований' : 'Открыть историю требований');
  }, { signal });
  historyToggle?.addEventListener('click', () => {
    const open = historyToggle.getAttribute('aria-expanded') !== 'true';
    historyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (historyPopover) historyPopover.hidden = !open;
  }, { signal });
  document.getElementById('chat-sessions-close')?.addEventListener('click', () => {
    closeHistoryPopover();
    historyToggle?.focus();
  }, { signal });

  document.addEventListener('click', event => {
    if (!event.target.closest('.chat-sessions-card')) closeHistoryPopover();
  }, { signal });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeHistoryPopover();
      historyToggle?.focus();
    }
  }, { signal });

}

function closeHistoryPopover() {
  const toggle = document.getElementById('chat-sessions-toggle');
  const popover = document.getElementById('chat-sessions-popover');
  toggle?.setAttribute('aria-expanded', 'false');
  if (popover) popover.hidden = true;
}

function updateSessionIdentity(value) {
  const wrap = document.getElementById('chat-session-identity');
  const label = document.getElementById('chat-session-id');
  const normalized = value ? String(value) : '';
  if (label) label.textContent = normalized || '—';
  if (wrap) wrap.hidden = !normalized;
}

async function copyCurrentSessionId() {
  if (!sessionId) return;
  const button = document.getElementById('chat-session-copy');
  try {
    await navigator.clipboard.writeText(String(sessionId));
    button?.classList.add('is-copied');
    if (button) button.title = 'ID скопирован';
    window.setTimeout(() => {
      button?.classList.remove('is-copied');
      if (button) button.title = 'Скопировать ID диалога';
    }, 1400);
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = String(sessionId);
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function showDraftPanel(draft, sessionId) {
  const panel = document.getElementById('chat-draft-panel');
  const content = document.getElementById('chat-draft-panel-content');
  const actions = document.getElementById('chat-draft-panel-actions');
  
  if (!panel || !draft) return;

  // A persisted draft remains attached to the dialogue after submission.
  // Never turn that into a second send action when the request already exists.
  if (sentRequestId) {
    hideDraftPanel();
    updateRequirementWorkspace();
    return;
  }
  
  currentDraft = draft;
  panel.style.display = 'flex';
  panel.hidden = false;
  updateRequirementWorkspace();
  
  const esc = escapeHtml;
  content.innerHTML = `
    <div class="chat-review-lead">
      <div class="chat-draft-panel-title">Перед отправкой</div>
      <div class="chat-review-status">${getDraftReviewStatus(draft)}</div>
    </div>
    ${renderDraftAttentionPanel(draft)}
    ${renderDraftReviewDetails(draft)}
  `;

  content.querySelectorAll('[data-fix-blocker]').forEach(btn => {
    btn.addEventListener('click', () => fixDraftBlocker(btn.dataset.fixBlocker, btn.dataset.blockerQuestion || ''));
  });

  const blockingCount = (draft.open_question_details || []).filter(item => item.blocking).length;
  
  actions.innerHTML = `
    <button class="btn btn-primary btn-sm" data-draft-action="send_review" style="width:100%;"${blockingCount ? ' disabled' : ''}>
      <i data-lucide="send" style="width:14px;height:14px;"></i>
      ${blockingCount ? 'Сначала исправьте блокеры' : 'Отправить на ревью'}
    </button>
    <button class="btn btn-secondary btn-sm" data-draft-action="dialog" style="width:100%;margin-top:8px;">
      <i data-lucide="message-circle" style="width:14px;height:14px;"></i>
      Продолжить в диалоге
    </button>
  `;
  
  actions.querySelectorAll('[data-draft-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.draftAction === 'dialog') {
        document.querySelector('[data-chat-view="dialog"]')?.click();
        document.getElementById('agent-chat-input')?.focus();
        return;
      }
      if (btn.dataset.draftAction === 'send_review') {
        await showTeamSelectModal(sessionId, draft, btn);
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderDraftReviewDetails(draft) {
  const groups = [
    ['Противоречия', (draft.conflicts || []).map(item => item.message || item).filter(Boolean)],
    ['Рекомендации по качеству', (draft.quality_issues || []).map(item => item.message || item).filter(Boolean)],
    ['Допущения', draft.assumptions || []],
    ['Открытые вопросы', (draft.open_question_details || []).filter(item => !item.blocking).map(item => item.text).filter(Boolean)],
  ].filter(([, items]) => items.length);
  if (!groups.length) return '<p class="chat-review-ready-note">Блокирующих замечаний нет. Просмотрите поля выше и отправьте требование на ревью.</p>';
  return `<section class="chat-review-details" aria-label="Замечания к требованию">
    ${groups.map(([label, items]) => `<div class="chat-review-detail"><strong>${escapeHtml(label)}</strong><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`).join('')}
  </section>`;
}

function renderDraftAttentionPanel(draft) {
  const blockers = (draft.open_question_details || []).filter(item => item.blocking);
  if (!blockers.length) return '';
  return `<section class="chat-review-blockers" aria-labelledby="chat-review-blockers-title">
    <div class="chat-review-blockers-heading">
      <i data-lucide="circle-alert" aria-hidden="true"></i>
      <div><strong id="chat-review-blockers-title">Что мешает отправке</strong><span>Ответьте на вопросы ниже — после этого отправка станет доступна.</span></div>
    </div>
    <div class="chat-review-blockers-list">
      ${blockers.map((item, index) => {
        const slot = item.slot || '';
        const target = slot ? `Раздел «${SLOT_LABELS[slot] || slot}»` : 'Требование в целом';
        return `<article class="chat-review-blocker">
          <div class="chat-review-blocker-number">${index + 1}</div>
          <div class="chat-review-blocker-content">
            <span class="chat-review-blocker-target">${escapeHtml(target)}</span>
            <strong>${escapeHtml(item.text || 'Нужно уточнить обязательную информацию')}</strong>
            <span>${slot ? 'Исправьте значение в карте требования.' : 'Добавьте уточнение в диалоге с ассистентом.'}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-fix-blocker="${escapeHtml(slot || 'dialog')}" data-blocker-question="${escapeHtml(item.text || '')}">${slot ? 'Исправить поле' : 'Ответить'}</button>
        </article>`;
      }).join('')}
    </div>
  </section>`;
}

function fixDraftBlocker(target, question) {
  if (target && target !== 'dialog') {
    window.setTimeout(() => editRequirementField(target), 0);
    return;
  }
  document.querySelector('[data-chat-view="dialog"]')?.click();
  const input = document.getElementById('agent-chat-input');
  if (!input) return;
  input.placeholder = question || 'Добавьте недостающее уточнение…';
  input.focus();
}

function hideDraftPanel() {
  const panel = document.getElementById('chat-draft-panel');
  if (panel) {
    panel.style.display = 'none';
    panel.hidden = true;
  }
  updateRequirementWorkspace();
}

function renderDraftCard(draft, options = {}) {
  const esc = escapeHtml;
  const rows = [];
  const blockingQuestions = (draft.open_question_details || []).filter(q => q.blocking).map(q => q.text);
  const fieldLabels = {
    problem_statement: 'Проблема', current_process: 'As-Is', target_process: 'To-Be', business_value: 'Ценность',
    user_roles: 'Пользователи', department: 'Подразделение', product: 'Продукт', module: 'Модуль', scenarios: 'Сценарии',
    business_rules: 'Бизнес-правила', data_integrations: 'Данные и интеграции',
    acceptance_criteria: 'Критерии приёмки', dependencies: 'Зависимости', risks: 'Риски',
    regulatory_flags: 'Регуляторные требования',
  };
  const sourceLabels = { user: 'пользователь', user_message: 'пользователь', knowledge_base: 'база знаний', assumption: 'предположение', system: 'система' };
  const provenance = Object.entries(draft.field_provenance || {}).map(([field, meta]) => {
    const confidence = draft.field_confidence?.[field];
    const source = sourceLabels[meta.source] || meta.source || 'не указан';
    return `${fieldLabels[field] || field}: ${source}${Number.isFinite(confidence) ? `, ${Math.round(confidence * 100)}%` : ''}${meta.assumption ? ', предположение' : ''}`;
  });
  rows.push(['Проблема', draft.problem_statement]);
  rows.push(['Текущий процесс (As-Is)', draft.current_process]);
  rows.push(['Целевой процесс (To-Be)', draft.target_process]);
  rows.push(['Бизнес-ценность', draft.business_value]);
  rows.push(['Пользователи', (draft.user_roles || []).join(', ')]);
  rows.push(['Подразделение', draft.department]);
  rows.push(['Продукт', draft.product]);
  rows.push(['Модуль', draft.module]);
  rows.push(['Сценарии', (draft.scenarios || []).join('; ')]);
  rows.push(['Бизнес-правила', (draft.business_rules || []).join('; ')]);
  rows.push(['Данные и интеграции', (draft.data_integrations || []).join('; ')]);
  rows.push(['Критерии приёмки', (draft.acceptance_criteria || []).join('; ')]);
  rows.push(['Зависимости', (draft.dependencies || []).join('; ')]);
  rows.push(['Риски', (draft.risks || []).join('; ')]);
  rows.push(['Регуляторные требования', (draft.regulatory_flags || []).join('; ')]);
  rows.push(['Приоритет', draft.priority]);
  rows.push(['Открытые вопросы', (draft.open_questions || []).join('; ')]);
  rows.push(['Блокирующие вопросы', blockingQuestions.join('; ')]);
  rows.push(['Противоречия', (draft.conflicts || []).map(x => x.message || '').filter(Boolean).join('; ')]);
  rows.push(['Проблемы качества', (draft.quality_issues || []).map(x => x.message || '').filter(Boolean).join('; ')]);
  rows.push(['Допущения', (draft.assumptions || []).join('; ')]);
  rows.push(['Происхождение и уверенность', provenance.join('; ')]);

  return `
    <div class="chat-draft-card">
      <div class="chat-draft-title">${esc(draft.title || 'Драфт требования')}</div>
      <div class="chat-draft-meta"${options.compactMeta ? ' hidden' : ''}>
        <span class="badge badge-info">${esc(draft.status || 'Draft')}</span>
        <span class="badge badge-medium">Полнота: ${draft.completeness_score || 0}%</span>
        <span class="badge badge-info">Качество: ${draft.quality_score || 0}%</span>
        <span class="badge badge-low">Уверенность: ${esc(CONFIDENCE_LABELS[draft.confidence] || draft.confidence || '—')}</span>
      </div>
      <div class="chat-draft-rows">
        ${rows.filter(r => r[1]).map(([k, v]) => `
          <div class="chat-draft-row">
            <span class="chat-draft-key">${esc(k)}</span>
            <span class="chat-draft-val">${esc(v)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function getDraftReviewStatus(draft) {
  const blocking = (draft.open_question_details || []).filter(item => item.blocking).length;
  const attention = blocking + (draft.conflicts || []).length + (draft.quality_issues || []).length;
  if (blocking) return `<span class="requirement-state requirement-state-danger" title="Блокирующие пункты требуют решения перед отправкой"><i data-lucide="circle-alert" aria-hidden="true"></i>${blocking} ${pluralizeBlockers(blocking)}</span>`;
  if (attention) return `<span class="requirement-state requirement-state-warning">${attention} ${pluralizeRemarks(attention)} перед отправкой</span>`;
  return '<span class="requirement-state requirement-state-ready">Готово к отправке</span>';
}

function renderDraftActions(respSessionId, draft, buttons) {
  const container = document.getElementById('agent-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'chat-actions-row';

  const actions = buttons || [
    { label: 'Отправить на ревью', action: 'send_review' },
    { label: 'Внести правки', action: 'edit' },
  ];

  wrap.innerHTML = actions.map(b => {
    if (b.action === 'send_review') {
      return `<button class="btn btn-primary btn-sm" data-draft-action="send_review">${escapeHtml(b.label)}</button>`;
    }
    if (b.action === 'edit') {
      return `<button class="btn btn-secondary btn-sm" data-draft-action="edit">${escapeHtml(b.label)}</button>`;
    }
    return '';
  }).join('');

  container.appendChild(wrap);

  wrap.querySelectorAll('[data-draft-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.draftAction === 'edit') {
        showSectionEditModal(draft);
        return;
      }
      if (btn.dataset.draftAction === 'send_review') {
        await showTeamSelectModal(respSessionId, draft, btn);
      }
    });
  });

  container.scrollTop = container.scrollHeight;
}

async function showTeamSelectModal(sessionId, draft, triggerBtn) {
  let teams = [];
  try {
    teams = await window.app.api.get('/agent/teams');
  } catch (_) { /* ignore */ }

  const user = window.app.store.get('currentUser');
  const userTeamId = user?.team_id;
  const options = teams.map(t =>
    `<option value="${t.id}"${t.id === userTeamId ? ' selected' : ''}>${escapeHtml(t.name)}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:760px;">
      <div class="modal-header">
        <h3>Проверка и отправка требования</h3>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p class="text-muted" style="margin-top:0;">Вы отправляете «${escapeHtml(draft?.title || 'Требование')}» на ревью. Содержание остаётся доступно в режиме «Проверка».</p>
        <div class="chat-send-summary">${getDraftReviewStatus(draft)}</div>
        <label class="form-label">К какой команде относится запрос?</label>
        <select id="team-select" class="input" style="width:100%;">
          <option value="">— Не знаю / пропустить —</option>
          ${options}
        </select>
        <p class="text-muted" style="font-size:var(--text-xs);margin-top:var(--space-2);">
          Запрос будет направлен на ревью PO/PL/CL выбранной команды. Если не уверены — оставьте пустым.
        </p>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:var(--space-3);">
          <input type="checkbox" id="draft-review-confirm" style="margin-top:3px;">
          <span>Я проверил(а) черновик и понимаю, что открытые вопросы и допущения потребуют ревью аналитика.</span>
        </label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" id="modal-cancel">Отмена</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm" disabled>Отправить на ревью</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modal-close').addEventListener('click', close);
  modal.querySelector('#modal-cancel').addEventListener('click', close);
  modal.querySelector('#draft-review-confirm').addEventListener('change', (e) => {
    modal.querySelector('#modal-confirm').disabled = !e.target.checked;
  });
  modal.querySelector('#modal-confirm').addEventListener('click', async () => {
    const teamId = parseInt(modal.querySelector('#team-select').value) || null;
    close();
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Отправляем...';
    try {
      const resp = await window.app.api.post('/agent/send-for-review', {
        session_id: sessionId,
        title: draft?.title || '',
        team_id: teamId,
      });
      addMessage('bot', resp.message || 'Требование отправлено на ревью.');
      sentRequestId = resp.request_id;
      disableDraftActions(resp.request_id);
      hideDraftPanel();
      renderRequestLink(resp);
    } catch (e) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = 'Отправить на ревью';
      addMessage('bot', `Не удалось отправить: ${e.message}`, { error: true });
    }
    if (window.lucide) window.lucide.createIcons();
  });
}

function disableDraftActions(requestId) {
  document.querySelectorAll('[data-draft-action]').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.draftAction === 'send_review') {
      btn.textContent = requestId ? `Отправлено в запрос #${requestId}` : 'Отправлено на ревью';
    }
  });
}

function showSectionEditModal(draft, initialField = '') {
  const fields = [
    ['problem_statement', 'Проблема'], ['current_process', 'Текущий процесс (As-Is)'], ['target_process', 'Целевой процесс (To-Be)'],
    ['business_value', 'Бизнес-ценность'], ['user_roles', 'Пользователи'], ['department', 'Подразделение'],
    ['product', 'Продукт'], ['module', 'Модуль'], ['scenarios', 'Сценарии'],
    ['business_rules', 'Бизнес-правила'], ['data_integrations', 'Данные и интеграции'],
    ['acceptance_criteria', 'Критерии приёмки'], ['dependencies', 'Зависимости'],
    ['risks', 'Риски'], ['regulatory_flags', 'Регуляторные требования'],
  ];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:620px;">
      <div class="modal-header"><h3>Изменить раздел требования</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <label class="form-label" for="draft-edit-section">Раздел</label>
        <select id="draft-edit-section" class="input" style="width:100%;">
          ${fields.map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('')}
        </select>
        <label class="form-label" for="draft-edit-value" style="margin-top:var(--space-3);">Новая формулировка</label>
        <textarea id="draft-edit-value" class="input" rows="5" style="width:100%;resize:vertical;"></textarea>
        <p class="text-muted" style="font-size:var(--text-xs);margin-top:var(--space-2);">Для списков перечислите пункты через точку с запятой.</p>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-cancel>Отмена</button><button class="btn btn-primary btn-sm" data-save>Применить</button></div>
    </div>`;
  document.body.appendChild(modal);
  const select = modal.querySelector('#draft-edit-section');
  if (initialField && fields.some(([key]) => key === initialField)) select.value = initialField;
  const value = modal.querySelector('#draft-edit-value');
  const fillValue = () => {
    const raw = draft?.[select.value];
    value.value = Array.isArray(raw) ? raw.join('; ') : (raw || '');
  };
  fillValue();
  select.addEventListener('change', fillValue);
  const close = () => modal.remove();
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.querySelector('[data-cancel]').addEventListener('click', close);
  modal.querySelector('[data-save]').addEventListener('click', async () => {
    const text = value.value.trim();
    if (!text) { value.focus(); return; }
    const label = fields.find(([key]) => key === select.value)?.[1] || select.value;
    close();
    await saveDraftSection(select.value, text, label);
  });
}

async function saveDraftSection(field, value, label) {
  addMessage('user', `Исправить раздел «${label}»: ${value}`);
  showTyping();
  try {
    const resp = await window.app.api.post('/agent/edit-draft-section', {
      session_id: sessionId, field, value,
    });
    renderAgentResponse(resp);
  } catch (e) {
    addMessage('bot', `Не удалось изменить раздел: ${e.message}`, { error: true });
  } finally {
    hideTyping();
  }
}

function renderRequestLink(resp) {
  const container = document.getElementById('agent-chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-message chat-message-bot chat-request-created';
  el.innerHTML = `
    <div class="chat-message-avatar chat-request-created-avatar"><i data-lucide="check" aria-hidden="true"></i></div>
    <div class="chat-message-body">
      <div class="chat-task-link">
        <div class="chat-task-link-copy">
          <span><i data-lucide="circle-check" aria-hidden="true"></i> Запрос создан</span>
          <strong>Запрос #${escapeHtml(resp.request_id)} готов к ревью</strong>
          <small>Требование сохранено и передано ответственным.</small>
        </div>
        <a href="#/customer/request/${encodeURIComponent(resp.request_id)}" aria-label="Открыть запрос #${escapeHtml(resp.request_id)}">
          <span>Открыть</span><i data-lucide="arrow-up-right" aria-hidden="true"></i>
        </a>
      </div>
    </div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function addMessage(role, content, options = {}) {
  const container = document.getElementById('agent-chat-messages');
  const normalizedContent = String(content || '').trim();
  const renderedMessages = container.querySelectorAll('.chat-message:not(.chat-typing-indicator)');
  const previous = renderedMessages[renderedMessages.length - 1];
  if (previous?.dataset.messageRole === role
      && previous.dataset.messageContent === normalizedContent) {
    return previous;
  }
  const el = document.createElement('div');
  el.className = `chat-message chat-message-${role}`;
  el.dataset.messageRole = role;
  el.dataset.messageContent = normalizedContent;
  if (role === 'bot') {
    const contentClass = options.error ? 'chat-message-error' : (options.info ? 'chat-message-info' : '');
    el.innerHTML = `
      <div class="chat-message-avatar"><i data-lucide="bot" style="width:16px;height:16px;"></i></div>
      <div class="chat-message-body">
        <div class="chat-message-header">AI Business Analyst</div>
        <div class="chat-message-content ${contentClass}">
          ${formatContent(content)}
        </div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="chat-message-body">
        <div class="chat-message-content">${escapeHtml(content)}</div>
      </div>
    `;
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
  return el;
}

function formatContent(content) {
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function showTyping() {
  const container = document.getElementById('agent-chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-message chat-message-bot chat-typing-indicator';
  el.id = 'agent-typing-indicator';
  el.innerHTML = `
    <div class="chat-message-avatar"><i data-lucide="bot" style="width:16px;height:16px;"></i></div>
    <div class="chat-message-body"><div class="chat-typing-dots"><span></span><span></span><span></span></div></div>
  `;
  container.appendChild(el);
  const status = document.getElementById('agent-service-status');
  if (status) status.textContent = 'Формулирует ответ…';
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function hideTyping() {
  const el = document.getElementById('agent-typing-indicator');
  if (el) el.remove();
  const status = document.getElementById('agent-service-status');
  if (status) status.textContent = 'Готов к работе';
}

function attachRetryButton(value, errorMessage = null, messageId = null) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return;
  const userMessages = container.querySelectorAll('.chat-message-user');
  const last = userMessages[userMessages.length - 1];
  if (!last) return;

  const body = last.querySelector('.chat-message-body');
  if (!body) return;

  const existing = body.querySelector('.chat-retry-btn');
  if (existing) {
    if (errorMessage) retryErrorMessages.set(existing, errorMessage);
    existing.disabled = false;
    existing.removeAttribute('aria-busy');
    existing.title = 'Повторить отправку';
    existing.setAttribute('aria-label', 'Повторить отправку');
    existing.innerHTML = '<i data-lucide="rotate-ccw" aria-hidden="true"></i>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary btn-sm chat-retry-btn';
  btn.type = 'button';
  btn.title = 'Повторить отправку';
  btn.setAttribute('aria-label', 'Повторить отправку');
  btn.innerHTML = '<i data-lucide="rotate-ccw" aria-hidden="true"></i>';
  if (errorMessage) retryErrorMessages.set(btn, errorMessage);
  btn.addEventListener('click', () => {
    retryErrorMessages.get(btn)?.remove();
    retryErrorMessages.delete(btn);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.title = 'Повторная отправка…';
    btn.setAttribute('aria-label', 'Повторная отправка…');
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin" aria-hidden="true"></i>';
    if (window.lucide) window.lucide.createIcons();
    performChat(window.app, value, messageId || newMessageId());
  });
  body.appendChild(btn);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function newMessageId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function removeRetryButtons() {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return;
  container.querySelectorAll('.chat-retry-btn').forEach(btn => btn.remove());
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
