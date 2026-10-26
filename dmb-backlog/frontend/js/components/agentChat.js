import { bindActionMenu } from '../ui/actionMenu.js';
/**
 * DMB AI Business Analyst Assistant - chat widget.
 * Multi-turn dialogue that collects a business requirement and, after
 * confirmation, creates a real task (send-for-review).
 */
import { confirmAction } from '../uiFeedback.js';
import { enhanceDialogOverlay } from '../modalAccessibility.js';

let isTyping = false;
let sessionId = null;
let currentDraft = null;
let currentDraftRevision = '';
let currentRequestContext = {};
let sessionRestoreFailed = false;
let sentRequestId = null;
let currentSlots = {};
let currentProgress = [];
let currentExpectedSlot = '';
let currentDialogueMode = '';
let currentSources = [];
let sessionHistoryMode = 'active';
let sessionHistoryFilter = 'all';
let sessionHistoryQuery = '';
let sessionHistorySessions = [];
let sidebarControlsAbort = null;
let pendingPollGeneration = 0;
let canGenerateDraft = false;
let workspaceView = 'dialog';
let unreadAssistantMessages = 0;
let composerResizeObserver = null;
let agentLifecycleAbort = null;
let networkRecoveryTimer = null;
let activeChatRequestController = null;
let typingElapsedTimer = null;
let lastDraftChange = null;
let draftChanges = new Map();
const retryErrorMessages = new WeakMap();
const PENDING_MESSAGE_KEY_PREFIX = 'dmb-agent-pending-message:';
const COMPOSER_DRAFT_KEY_PREFIX = 'dmb-agent-composer-draft:v1:';
const TRANSIENT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

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
  { key: 'minimum', label: 'Обязательный минимум', slots: ['need_statement', 'to_be', 'role', 'process'], open: true },
  { key: 'context', label: 'Контекст', slots: ['department', 'product', 'module', 'as_is', 'users'], open: false },
  { key: 'details', label: 'Дополнительные детали', slots: ['scenarios', 'business_rules', 'acceptance_criteria', 'data_integrations', 'value', 'priority'], open: false },
  { key: 'delivery', label: 'Реализация и ограничения', slots: ['dependencies', 'risks', 'regulatory_flags'], open: false },
];

const REQUIRED_SLOTS = new Set(REQUIREMENT_MAP_GROUPS[0].slots);
const CORE_PROGRESS_FIELDS = [
  { key: 'need_statement', label: 'Потребность' },
  { key: 'role', label: 'Пользователь' },
  { key: 'process', label: 'Процесс' },
  { key: 'to_be', label: 'Результат' },
];
const MAP_TO_DRAFT_FIELD = {
  need_statement: 'problem_statement', as_is: 'current_process', to_be: 'target_process',
  value: 'business_value', role: 'primary_role', users: 'affected_users',
};
const DRAFT_TO_MAP_SLOT = {
  problem_statement: 'need_statement', current_process: 'as_is', target_process: 'to_be',
  business_value: 'value', user_roles: 'users', primary_role: 'role', affected_users: 'users',
};

const NORMAL_AGENT_STATUS = 'На связи';
// Canonical customer-facing labels mirror REQUEST_STATUS in requestPresentation.js.
const REQUEST_STATUS_LABELS = Object.freeze({
  draft: 'Черновик', submitted: 'Ожидает ревью', in_review: 'На ревью',
  returned: 'Требуется уточнение', approved: 'Завершён', rejected: 'Отклонён',
  in_progress: 'В проработке', done: 'Завершён', completed: 'Завершён',
});

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

function getLockedRequestId(state = {}) {
  if (!state.request_id) return null;
  return ['returned', 'draft'].includes(String(state.request_status || '').toLowerCase()) ? null : state.request_id;
}

export function renderAgentChat(app) {
  const focusMode = true;

  return `
    <div class="chat-wrapper${focusMode ? ' chat-wrapper--focus' : ''}">
      <div class="chat-layout">
        <a class="chat-skip-to-composer" href="#agent-chat-input">К полю ответа</a>
        ${focusMode ? renderSessionHistory(true) : ''}
        <div class="chat-main" id="chat-dialog-pane" role="tabpanel" aria-labelledby="chat-dialog-tab">
          <div class="chat-container-card">
            <div class="chat-header">
              <div class="chat-header-info">
                <div class="chat-avatar-bot">
                  <i data-lucide="bot" style="width:20px;height:20px;"></i>
                </div>
                <div>
                  <div class="chat-header-title">ИИ-ассистент требований</div>
                  <div class="chat-header-status">
                    <span class="status-dot"></span>
                    <span id="agent-service-status">${NORMAL_AGENT_STATUS}</span>
                  </div>
                </div>
              </div>
              <div class="chat-header-actions">
                ${focusMode ? `<button class="square-icon btn btn-secondary btn-sm chat-history-drawer-toggle" id="chat-history-drawer-toggle" type="button" aria-label="Открыть историю требований" aria-expanded="false"><i data-lucide="history"></i></button>` : ''}
                <div class="chat-session-identity" id="chat-session-identity" hidden>
                  <span class="chat-session-identity-label">ID диалога</span>
                  <code id="chat-session-id">—</code>
                  <button class="btn btn-ghost btn-sm square-icon ui-btn" type="button" id="chat-session-copy" aria-label="Скопировать ID диалога" title="Скопировать ID диалога">
                    <i data-lucide="copy"></i>
                  </button>
                </div>
                <button class="btn btn-secondary btn-sm ui-btn ui-responsive-icon" id="agent-chat-clear-btn" aria-label="Создать новое требование" title="Новое требование">
                  <i data-lucide="file-plus-2"></i>
                  <span class="ui-responsive-icon-label">Новое требование</span>
                </button>
              </div>
            </div>

            <details class="chat-context-disclosure" id="chat-context-disclosure">
              <summary><span id="chat-context-summary">Диалог: стандартный · без внешних источников</span><i data-lucide="chevron-down" aria-hidden="true"></i></summary>
              <div class="chat-context-details" id="chat-context-details"><strong>Как ассистент ведёт диалог</strong><p>Ассистент последовательно уточняет сведения, необходимые для качественного черновика.</p><strong>Источники ответа</strong><p>Ответ основан на сообщениях этого диалога. Внешние справочные материалы не использованы.</p></div>
            </details>

            <div class="chat-messages" id="agent-chat-messages" role="log" aria-live="off" aria-label="История диалога">
              ${renderChatRestoringState()}
            </div>
            <div class="sr-only" id="chat-live-announcer" aria-live="polite" aria-atomic="true"></div>
            <button class="btn btn-secondary btn-sm ui-btn chat-scroll-latest" id="chat-scroll-latest" type="button" hidden>
              <span id="chat-scroll-latest-label">К последним сообщениям</span>
              <i data-lucide="arrow-down" aria-hidden="true"></i>
            </button>

            <div class="chat-input-area">
              <div class="chat-network-status" id="chat-network-status" role="status" hidden>
                <i data-lucide="wifi-off" aria-hidden="true"></i>
                <span>Нет подключения. Можно продолжать писать — текст сохранится на этом устройстве.</span>
              </div>
              <div class="chat-current-question" id="chat-current-question" style="display:none;">
                <div class="chat-current-question-label">Сейчас уточняем</div>
                <div class="chat-current-question-text" id="chat-current-question-text"></div>
              </div>
              <div class="chat-input-wrapper">
                <label class="sr-only" for="agent-chat-input">Ответ ассистенту</label>
                <textarea
                  id="agent-chat-input"
                  class="input ui-control chat-input"
                  placeholder="Опишите проблему или доработку..."
                  rows="1"
                  maxlength="4000"
                  aria-describedby="chat-input-hint chat-input-count"
                ></textarea>
                <button class="square-icon btn btn-primary chat-send-btn" id="agent-chat-send-btn" aria-label="Отправить сообщение" disabled>
                  <i data-lucide="send" aria-hidden="true"></i>
                </button>
              </div>
              <div class="chat-input-meta">
                <span id="chat-input-hint">Ctrl+Enter — отправить</span>
                <span class="chat-input-draft-status" id="chat-input-draft-status" role="status" hidden></span>
                <span id="chat-input-count">0 / 4000</span>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-mobile-tabs" role="tablist" aria-label="Режим страницы">
          <button class="btn btn-secondary btn-sm ui-btn chat-mobile-tab active" id="chat-dialog-tab" data-chat-view="dialog" role="tab" aria-controls="chat-dialog-pane" aria-selected="true" tabindex="0">Диалог</button>
          <button class="btn btn-secondary btn-sm ui-btn chat-mobile-tab" id="chat-requirement-tab" data-chat-view="requirement" role="tab" aria-controls="chat-requirement-pane" aria-selected="false" tabindex="-1">Требование <span class="requirement-tab-count"></span></button>
        </div>

        <aside class="chat-sidebar" id="chat-requirement-pane" role="tabpanel" aria-labelledby="chat-requirement-tab">
          ${focusMode ? '' : renderSessionHistory(false)}

          <div class="requirement-workspace" id="requirement-workspace">
            <div class="requirement-map-card" id="requirement-map-card" style="display:none;">
              <div class="requirement-map-header">
                <div><h2 id="requirement-workspace-title">Требование</h2><span class="requirement-map-caption" id="requirement-workspace-caption">Собирается вместе с диалогом · любое поле можно исправить</span></div>
                <span class="badge badge-info" id="requirement-map-status">Не начато</span>
              </div>
              ${renderCoreRequirementProgress()}
              <div class="chat-early-draft" id="chat-early-draft" hidden>
                <span><strong>Обязательный минимум собран.</strong> Остальные детали можно уточнить позже.</span>
                <button class="btn btn-primary btn-sm" id="chat-generate-draft-btn" type="button">Сформировать черновик</button>
              </div>
              <div class="requirement-review-comment" id="requirement-review-comment" hidden></div>
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



        </aside>
      </div>
    </div>
  `;
}

function renderSessionHistory(persistent = false) {
  return `
          <div class="chat-sessions-card${persistent ? ' chat-history-panel' : ''}">
            ${persistent ? `
            <button class="ui-surface-action chat-sessions-header chat-sessions-header--static" id="chat-history-collapse" type="button" aria-expanded="true" aria-label="Свернуть историю требований">
              <i data-lucide="history" style="width:16px;height:16px;color:var(--primary);"></i>
              <span id="chat-sessions-title">История требований</span>
              <i class="chat-sessions-chevron" data-lucide="panel-left-close"></i>
            </button>` : `
            <button class="ui-surface-action chat-sessions-header" id="chat-sessions-toggle" type="button" aria-expanded="false" aria-controls="chat-sessions-popover">
              <i data-lucide="history" style="width:16px;height:16px;color:var(--primary);"></i>
              <span id="chat-sessions-title">История требований</span>
              <i class="chat-sessions-chevron" data-lucide="chevron-down"></i>
            </button>`}
            <div class="chat-sessions-popover" id="chat-sessions-popover"${persistent ? '' : ' hidden'}>
              <div class="chat-sessions-popover-head">
                <strong>История требований</strong>
                <button type="button" class="btn btn-ghost btn-sm square-icon ui-btn chat-sessions-close" id="chat-sessions-close" aria-label="Закрыть историю">
                  <i data-lucide="x"></i>
                </button>
              </div>
              <div class="chat-sessions-tabs" role="tablist" aria-label="Фильтр истории">
                <button class="btn btn-secondary btn-sm ui-btn chat-sessions-tab active" id="chat-sessions-tab-active" data-session-mode="active" role="tab" aria-controls="chat-sessions-list" aria-selected="true" tabindex="0"><span>Активные</span><span class="chat-sessions-tab-count" data-session-mode-count="active"></span></button>
                <button class="btn btn-secondary btn-sm ui-btn chat-sessions-tab" id="chat-sessions-tab-archive" data-session-mode="archive" role="tab" aria-controls="chat-sessions-list" aria-selected="false" tabindex="-1"><span>Архив</span><span class="chat-sessions-tab-count" data-session-mode-count="archive"></span></button>
              </div>
              <div class="chat-sessions-tools">
                <label class="chat-sessions-search">
                  <i data-lucide="search" aria-hidden="true"></i>
                  <span class="sr-only">Поиск по истории требований</span>
                  <input class="input ui-control" id="chat-sessions-search" type="search" placeholder="Найти требование…" autocomplete="off">
                </label>
                <div class="chat-sessions-filters" role="group" aria-label="Статус требования">
                  <button type="button" class="btn btn-secondary btn-sm ui-btn active" data-session-filter="all" aria-pressed="true"><span>Все</span><span data-session-filter-count="all"></span></button>
                  <button class="btn btn-secondary btn-sm ui-btn" type="button" data-session-filter="action" aria-pressed="false"><span>Нужен ответ</span><span data-session-filter-count="action"></span></button>
                  <button class="btn btn-secondary btn-sm ui-btn" type="button" data-session-filter="draft" aria-pressed="false"><span>Черновики</span><span data-session-filter-count="draft"></span></button>
                  <button class="btn btn-secondary btn-sm ui-btn" type="button" data-session-filter="sent" aria-pressed="false"><span>Отправленные</span><span data-session-filter-count="sent"></span></button>
                </div>
              </div>
              <div class="chat-sessions-notice" id="chat-sessions-notice" role="status" hidden></div>
              <div class="chat-sessions-list" id="chat-sessions-list" role="tabpanel" aria-labelledby="chat-sessions-tab-active">
                <div class="chat-sessions-empty content-loading-state">Загрузка…</div>
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
      <div class="chat-welcome-starters" aria-label="Примеры начала требования">
        <div class="chat-welcome-starters-title">Можно начать с примера</div>
        <button class="ui-surface-action" type="button" data-starter-prompt="Сейчас процесс выполняется вручную и занимает много времени. Хотим автоматизировать основные шаги, сократить ошибки и видеть результат выполнения.">
          <i data-lucide="workflow" aria-hidden="true"></i>
          <span><strong>Автоматизировать процесс</strong><small>Описать текущий и желаемый сценарий</small></span>
        </button>
        <button class="ui-surface-action" type="button" data-starter-prompt="В системе возникает ошибка, из-за которой пользователь не может завершить операцию. Нужно исправить поведение, показать понятную причину и дать безопасно повторить действие.">
          <i data-lucide="alert-circle" aria-hidden="true"></i>
          <span><strong>Исправить проблему</strong><small>Описать ошибку и ожидаемый результат</small></span>
        </button>
        <button class="ui-surface-action" type="button" data-starter-prompt="Нужно изменить интерфейс для рабочей роли: добавить понятное действие и отображать актуальный статус. Доступность действия должна учитывать права пользователя и состояние процесса.">
          <i data-lucide="layout-dashboard" aria-hidden="true"></i>
          <span><strong>Изменить интерфейс</strong><small>Указать роль, действие и ограничения</small></span>
        </button>
        <div class="chat-welcome-starters-note">Пример только заполнит поле — вы сможете изменить текст перед отправкой.</div>
      </div>
    </div>
  `;
}

function renderChatRestoringState() {
  return `<div class="chat-resume-loading content-loading-state" role="status">
    <span class="spinner" aria-hidden="true"></span>
    <div><strong>Восстанавливаем диалог…</strong><span>Проверяем последнюю сессию и черновик требования.</span></div>
  </div>`;
}

function showAgentWelcome(app) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return;
  const userName = app.store.get('currentUser')?.name?.split(' ')[0] || 'Заказчик';
  container.innerHTML = renderAgentWelcome(userName);
  bindWelcomeStarters();
  if (window.lucide) window.lucide.createIcons();
}

export async function initAgentChat(app) {
  agentLifecycleAbort?.abort();
  agentLifecycleAbort = new AbortController();
  const lifecycleSignal = agentLifecycleAbort.signal;
  const pollGeneration = ++pendingPollGeneration;
  isTyping = false;
  sessionId = null;
  currentDraft = null;
  currentRequestContext = {};
  sessionRestoreFailed = false;
  sentRequestId = null;
  currentSlots = {};
  currentProgress = [];
  currentExpectedSlot = '';
  currentDialogueMode = '';
  currentSources = [];
  lastDraftChange = null;
  draftChanges = new Map();
  canGenerateDraft = false;
  workspaceView = 'dialog';
  unreadAssistantMessages = 0;
  sessionHistoryMode = 'active';
  sessionHistoryFilter = 'all';
  sessionHistoryQuery = '';

  const input = document.getElementById('agent-chat-input');
  const sendBtn = document.getElementById('agent-chat-send-btn');
  const clearBtn = document.getElementById('agent-chat-clear-btn');

  input?.addEventListener('input', () => {
    autoResize(input);
    syncSentComposerState();
    updateChatInputMeta(input);
    saveComposerDraft(app, input.value);
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
  document.getElementById('chat-generate-draft-btn')?.addEventListener('click', async event => {
    if (isTyping || sentRequestId || sessionRestoreFailed) return;
    if (!currentDraft) return send(app, 'Подготовить черновик сейчас');
    const first = getDraftBlockingIssues(currentDraft)[0];
    if (first) return fixDraftBlocker(first.slot || 'dialog', first.text);
    await showTeamSelectModal(sessionId, currentDraft, event.currentTarget);
  });
  document.getElementById('chat-interview-progress')?.addEventListener('click', event => {
    const slot = event.target.closest('[data-core-progress-slot]')?.dataset.coreProgressSlot;
    if (!slot || isTyping || sentRequestId || sessionRestoreFailed) return;
    applyWorkspaceView('requirement');
    const fields = document.getElementById('requirement-map-fields');
    if (fields) fields.style.display = 'grid';
    const empty = document.getElementById('requirement-map-empty');
    if (empty) empty.style.display = 'none';
    editRequirementField(slot);
  });
  const messages = document.getElementById('agent-chat-messages');
  messages?.addEventListener('scroll', () => {
    if (isNearChatBottom(messages)) clearUnreadMessages();
  }, { passive: true });
  document.getElementById('chat-scroll-latest')?.addEventListener('click', () => scrollChatToLatest(true));
  bindComposerSize();
  bindAgentNetworkState(app, lifecycleSignal);
  window.addEventListener('hashchange', () => {
    if (!window.location.hash.startsWith('#/customer/create')) {
      activeChatRequestController?.abort('view-changed');
      window.clearInterval(typingElapsedTimer);
    }
  }, { signal: lifecycleSignal });
  document.getElementById('chat-session-copy')?.addEventListener('click', copyCurrentSessionId);
  bindWorkspaceControls();
  bindSidebarControls();
  updateChatInputMeta(input);
  document.getElementById('chat-sessions-search')?.addEventListener('input', event => {
    sessionHistoryQuery = event.target.value.trim().toLocaleLowerCase('ru');
    renderSessions(app);
  });
  document.getElementById('chat-sessions-search')?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.currentTarget.value) {
      event.stopPropagation();
      resetSessionFilters(app, { keepFilter: true, focusSearch: true });
    }
  });
  document.querySelectorAll('[data-session-filter]').forEach(btn => btn.addEventListener('click', () => {
    sessionHistoryFilter = btn.dataset.sessionFilter;
    document.querySelectorAll('[data-session-filter]').forEach(item => {
      const selected = item === btn;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    renderSessions(app);
  }));
  const historyTabs = [...document.querySelectorAll('[data-session-mode]')];
  historyTabs.forEach((btn, index) => btn.addEventListener('click', () => {
    sessionHistoryMode = btn.dataset.sessionMode;
    document.querySelectorAll('[data-session-mode]').forEach(item => {
      const selected = item === btn;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.setAttribute('tabindex', selected ? '0' : '-1');
    });
    const list = document.getElementById('chat-sessions-list');
    list?.setAttribute('aria-labelledby', btn.id);
    renderSessions(app);
  }));
  historyTabs.forEach((btn, index) => btn.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? historyTabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + historyTabs.length) % historyTabs.length;
    historyTabs[next]?.click();
    historyTabs[next]?.focus();
  }));

  if (window.lucide) window.lucide.createIcons();

  let restoredSession = false;
  try {
    const state = await app.api.get('/agent/session');
    if (state && state.active && state.session_id) {
      restoredSession = true;
      sessionId = state.session_id;
      updateSessionIdentity(sessionId);
      currentDraft = state.draft || null;
      sentRequestId = getLockedRequestId(state);
      updateRequirementWorkspace(state);
      const container = document.getElementById('agent-chat-messages');
      if (container) container.innerHTML = '';
      if (state.history && state.history.length) {
        renderHistory(state.history);
        if (state.draft && state.phase === 'draft_ready') {
          appendDraftResume(state.draft, { announce: false });
        }
      } else if (state.draft && state.phase === 'draft_ready') {
        renderDraftResume(state.draft, { announce: false });
      } else {
        showAgentWelcome(app);
      }
      if (sentRequestId) renderRequestLink(state, { focus: false });
      syncSentComposerState();
    }
  } catch (error) {
    restoredSession = true;
    sessionRestoreFailed = true;
    const container = document.getElementById('agent-chat-messages');
    if (container) container.innerHTML = '';
    const notice = addMessage('bot', `Не удалось восстановить диалог: ${formatAgentError(error)} История не удалена. Повторите загрузку страницы или откройте диалог из истории.`, { error: true });
    const retry = document.createElement('button');
    retry.className = 'btn btn-secondary btn-sm ui-btn chat-retry-btn';
    retry.textContent = 'Повторить загрузку';
    retry.addEventListener('click', () => window.location.reload());
    notice?.querySelector('.chat-message-body')?.appendChild(retry);
    syncSentComposerState();
  }

  if (!restoredSession) {
    showAgentWelcome(app);
    updateRequirementWorkspace();
  } else {
    updateInterviewProgress();
  }

  if (sentRequestId) clearComposerDraft(app, sessionId);
  restoreComposerDraft(app, sessionId, { migrateUnassigned: true });

  const pendingMessage = restorePendingUserMessage(app);
  if (pendingMessage) resumePendingProcessing(app, pendingMessage, pollGeneration);

  loadSessions(app);
  trackAgentUx(app, 'chat_opened');
}

async function loadSessions(app) {
  const list = document.getElementById('chat-sessions-list');
  if (!list) return;
  try {
    const data = await app.api.get('/agent/sessions');
    sessionHistorySessions = data.sessions || [];
    renderSessions(app);
  } catch (_) {
    list.innerHTML = `<div class="chat-sessions-empty chat-sessions-empty--error" role="alert">
      <i data-lucide="alert-circle" aria-hidden="true"></i>
      <strong>История временно недоступна</strong>
      <span>Текущий диалог можно продолжить. Попробуйте загрузить историю ещё раз.</span>
      <button class="btn btn-secondary btn-sm" id="chat-sessions-retry">Повторить</button>
    </div>`;
    list.querySelector('#chat-sessions-retry')?.addEventListener('click', () => loadSessions(app));
    if (window.lucide) window.lucide.createIcons();
  }
}

function renderSessions(app) {
  const list = document.getElementById('chat-sessions-list');
  if (!list) return;
  const modeSessions = sessionHistorySessions.filter(s => sessionHistoryMode === 'archive' ? s.archived : !s.archived);
  updateSessionHistoryCounts(modeSessions);
  const title = document.getElementById('chat-sessions-title');
  if (title) title.textContent = 'История требований';
  const visibleSessions = sessionHistorySessions
      .filter(s => sessionHistoryMode === 'archive' ? s.archived : !s.archived)
      .filter(s => sessionMatchesFilter(s, sessionHistoryFilter))
      .filter(s => !sessionHistoryQuery || `${s.title || ''} ${PHASE_LABELS[s.phase] || ''} ${s.session_id || ''} ${s.request_id || ''} ${s.request_status || ''}`.toLocaleLowerCase('ru').includes(sessionHistoryQuery))
      .map((session, sourceIndex) => ({ session, sourceIndex }))
      .sort((left, right) => {
        const leftTime = Date.parse(left.session.last_message_at || left.session.updated_at || '') || 0;
        const rightTime = Date.parse(right.session.last_message_at || right.session.updated_at || '') || 0;
        return rightTime - leftTime || left.sourceIndex - right.sourceIndex;
      })
      .map(({ session }) => session);
    if (!visibleSessions.length) {
      const filtered = Boolean(sessionHistoryQuery || sessionHistoryFilter !== 'all');
      list.innerHTML = renderSessionEmptyState({ filtered, mode: sessionHistoryMode });
      list.querySelector('[data-reset-session-filters]')?.addEventListener('click', () => resetSessionFilters(app, { focusSearch: true }));
      list.querySelector('[data-switch-session-mode]')?.addEventListener('click', () => switchSessionHistoryMode(app, 'active'));
      list.querySelector('[data-create-first-dialog]')?.addEventListener('click', () => newDialog(app));
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    list.innerHTML = visibleSessions.map(s => {
      const status = getSessionStatus(s);
      const time = formatSessionTime(s.last_message_at || s.updated_at);
      const sessionTitle = String(s.title || '').trim() || 'Без названия';
      const shortId = String(s.session_id || '').slice(0, 8);
      const requestMeta = s.request_id ? `Запрос #${s.request_id}${s.request_version ? ` · версия ${s.request_version}` : ''}` : `Диалог #${shortId}`;
      const stage = s.request_status ? status.label : (PHASE_LABELS[s.phase] || status.label);
      return `
      <div class="chat-session-row${s.active ? ' active' : ''}">
        <button class="ui-surface-action chat-session-item" data-session-id="${escapeHtml(s.session_id)}" aria-keyshortcuts="ArrowUp ArrowDown ArrowRight" title="${escapeHtml(sessionTitle)}"${s.active ? ' aria-current="true"' : ''}>
          <div class="chat-session-title">${escapeHtml(sessionTitle)}</div>
          <div class="chat-session-meta"><span class="chat-session-state ${status.className}">${escapeHtml(status.label)}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}</div>
          <div class="chat-session-reference">${getLockedRequestId(s) ? 'Открыть диалог отправленного запроса' : 'Продолжить подготовку'} · ${escapeHtml(requestMeta)}</div>
        </button>
        <button class="btn btn-ghost btn-sm square-icon ui-btn chat-session-menu-toggle" tabindex="-1" data-session-menu="${escapeHtml(s.session_id)}" aria-label="Действия с требованием «${escapeHtml(sessionTitle)}»" aria-expanded="false" aria-controls="chat-session-menu-${escapeHtml(s.session_id)}">
          <i data-lucide="more-horizontal" aria-hidden="true"></i>
        </button>
        <div class="chat-session-menu" id="chat-session-menu-${escapeHtml(s.session_id)}" data-session-menu-panel="${escapeHtml(s.session_id)}" hidden>
          ${s.request_id ? `<a href="#/customer/request/${encodeURIComponent(s.request_id)}">Открыть запрос #${escapeHtml(s.request_id)}</a>` : ''}
          <button class="btn btn-secondary btn-sm ui-btn" type="button" data-copy-session="${escapeHtml(s.session_id)}"><i data-lucide="copy" aria-hidden="true"></i>Копировать ID</button>
          <button class="btn btn-secondary btn-sm ui-btn" type="button" data-archive-session="${escapeHtml(s.session_id)}" data-archived="${s.archived ? 'true' : 'false'}"><i data-lucide="${s.archived ? 'archive-restore' : 'archive'}" aria-hidden="true"></i>${s.archived ? 'Вернуть из архива' : 'Переместить в архив'}</button>
        </div>
      </div>
    `}).join('');
    list.querySelectorAll('[data-session-id]').forEach(btn => {
      btn.addEventListener('click', () => switchSession(app, btn.dataset.sessionId));
      btn.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'ArrowRight') {
          btn.closest('.chat-session-row')?.querySelector('[data-session-menu]')?.click();
          return;
        }
        const items = [...list.querySelectorAll('[data-session-id]')];
        const index = items.indexOf(btn);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      });
    });
    list.querySelectorAll('[data-archive-session]').forEach(btn => {
      btn.addEventListener('click', () => setSessionArchived(app, btn.dataset.archiveSession, btn.dataset.archived !== 'true'));
    });
    list.querySelectorAll('[data-copy-session]').forEach(btn => btn.addEventListener('click', () => copySessionId(btn.dataset.copySession)));
    list.querySelectorAll('[data-session-menu]').forEach(trigger => {
      const panel = list.querySelector(`[data-session-menu-panel="${CSS.escape(trigger.dataset.sessionMenu)}"]`);
      if (panel) bindActionMenu({ trigger, panel, label: 'Действия с требованием' });
    });
    if (window.lucide) window.lucide.createIcons();
}

function updateSessionHistoryCounts(modeSessions) {
  const modes = {
    active: sessionHistorySessions.filter(session => !session.archived).length,
    archive: sessionHistorySessions.filter(session => session.archived).length,
  };
  document.querySelectorAll('[data-session-mode-count]').forEach(node => {
    const count = modes[node.dataset.sessionModeCount] || 0;
    node.textContent = String(count);
    node.hidden = count === 0;
  });
  ['all', 'action', 'draft', 'sent'].forEach(filter => {
    const count = filter === 'all' ? modeSessions.length : modeSessions.filter(session => sessionMatchesFilter(session, filter)).length;
    const node = document.querySelector(`[data-session-filter-count="${filter}"]`);
    if (node) {
      node.textContent = String(count);
      node.hidden = count === 0;
    }
  });
}

export function renderSessionEmptyState({ filtered = false, mode = 'active' } = {}) {
  if (filtered) {
    return `<div class="chat-sessions-empty">
      <i data-lucide="search" aria-hidden="true"></i>
      <strong>Ничего не найдено</strong>
      <span>Измените запрос или сбросьте фильтры.</span>
      <button type="button" class="btn btn-secondary btn-sm" data-reset-session-filters>Сбросить фильтры</button>
    </div>`;
  }
  if (mode === 'archive') {
    return `<div class="chat-sessions-empty">
      <i data-lucide="archive" aria-hidden="true"></i>
      <strong>Архив пока пуст</strong>
      <span>Здесь появятся требования, которые вы решите скрыть из активной работы.</span>
      <button type="button" class="btn btn-secondary btn-sm" data-switch-session-mode="active">К активным</button>
    </div>`;
  }
  return `<div class="chat-sessions-empty">
    <i data-lucide="messages-square" aria-hidden="true"></i>
    <strong>Нет активных требований</strong>
    <span>Начните новый диалог — ассистент поможет собрать структуру.</span>
    <button type="button" class="btn btn-primary btn-sm" data-create-first-dialog>Создать требование</button>
  </div>`;
}

function resetSessionFilters(app, { keepFilter = false, focusSearch = false } = {}) {
  sessionHistoryQuery = '';
  const search = document.getElementById('chat-sessions-search');
  if (search) search.value = '';
  if (!keepFilter) {
    sessionHistoryFilter = 'all';
    document.querySelectorAll('[data-session-filter]').forEach(item => {
      const selected = item.dataset.sessionFilter === 'all';
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }
  renderSessions(app);
  if (focusSearch) search?.focus();
}

function switchSessionHistoryMode(app, mode) {
  sessionHistoryMode = mode;
  document.querySelectorAll('[data-session-mode]').forEach(item => {
    const selected = item.dataset.sessionMode === mode;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  renderSessions(app);
}

function sessionMatchesFilter(session, filter) {
  const lifecycle = getSessionLifecycle(session);
  if (filter === 'action') return lifecycle === 'needs-response';
  if (filter === 'draft') return lifecycle === 'draft';
  if (filter === 'sent') return lifecycle === 'sent';
  return true;
}

export function getSessionLifecycle(session = {}) {
  if (session.archived) return 'archived';
  if (session.request_status === 'returned') return 'needs-response';
  if (session.phase === 'sent_for_review' || session.review_task_id || getLockedRequestId(session)) return 'sent';
  if (session.has_draft || session.phase === 'draft_ready') return 'draft';
  if (session.finished || session.phase === 'done') return 'complete';
  if (session.phase === 'welcome' && session.title === 'Новый диалог') return 'idle';
  if (typeof session.needs_user_response === 'boolean') {
    return session.needs_user_response ? 'needs-response' : 'in-progress';
  }
  if (session.last_message_role) {
    return session.last_message_role === 'assistant' ? 'needs-response' : 'in-progress';
  }
  return 'needs-response';
}

export function getSessionStatus(session) {
  const lifecycle = getSessionLifecycle(session);
  if (lifecycle === 'archived') return { label: 'В архиве', className: 'is-archived' };
  if (session.request_status === 'returned') return { label: 'Нужно уточнение', className: 'is-action' };
  if (session.request_status && REQUEST_STATUS_LABELS[session.request_status]) return { label: REQUEST_STATUS_LABELS[session.request_status], className: 'is-sent' };
  if (lifecycle === 'sent') return { label: PHASE_LABELS[session.phase] || 'Отправлено на ревью', className: 'is-sent' };
  if (lifecycle === 'draft') return { label: 'Черновик готов', className: 'is-draft' };
  if (lifecycle === 'complete') return { label: 'Завершён', className: 'is-complete' };
  if (lifecycle === 'idle') return { label: 'Не начато', className: 'is-idle' };
  if (lifecycle === 'needs-response') return { label: 'Нужен ответ', className: 'is-action' };
  return { label: 'В работе', className: 'is-progress' };
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
  notice.innerHTML = `<span>${escapeHtml(message)}</span>${actionLabel ? `<button class="btn btn-secondary btn-sm ui-btn" type="button">${escapeHtml(actionLabel)}</button>` : ''}`;
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
      await newDialog(app, { skipConfirm: true });
      return;
    }
    await loadSessions(app);
    showSessionsNotice(
      archived ? 'Требование перемещено в архив' : 'Требование возвращено в активные',
      archived ? 'Отменить' : '',
      archived ? () => setSessionArchived(app, targetSessionId, false) : null,
    );
  } catch (e) {
    addMessage('bot', `Не удалось изменить архив: ${formatAgentError(e)}`, { error: true });
  }
}

async function switchSession(app, session_id) {
  if (session_id === sessionId) return;
  if (isTyping) {
    showSessionsNotice('Дождитесь ответа ассистента перед сменой диалога');
    return;
  }
  try {
    await app.api.post('/agent/session/' + encodeURIComponent(session_id) + '/activate');
    const state = await app.api.get('/agent/session/' + session_id);
    sessionId = state.session_id || session_id;
    sessionRestoreFailed = false;
    currentRequestContext = {};
    document.getElementById('requirement-map-fields')?.replaceChildren();
    updateSessionIdentity(sessionId);
    currentDraft = state.draft || null;
    sentRequestId = getLockedRequestId(state);
    lastDraftChange = null;
  draftChanges = new Map();
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
    if (sentRequestId) renderRequestLink(state, { focus: false });
    syncSentComposerState();
    trackAgentUx(app, 'session_reopened');
    if (sentRequestId) clearComposerDraft(app, sessionId);
    restoreComposerDraft(app, sessionId);
    if (window.lucide) window.lucide.createIcons();
    closeHistoryPopover();
    closeHistoryDrawer();
    loadSessions(app);
  } catch (e) {
    addMessage('bot', `Не удалось открыть диалог: ${formatAgentError(e)}`, { error: true });
  }
}

async function newDialog(app, { skipConfirm = false } = {}) {
  if (isTyping) {
    showSessionsNotice('Дождитесь ответа ассистента перед созданием нового требования');
    return;
  }
  const hasUnsentText = Boolean(document.getElementById('agent-chat-input')?.value.trim());
  if (!skipConfirm && (currentDraft || hasUnsentText || Object.values(currentSlots).some(hasRequirementValue)) && !sentRequestId) {
    const confirmed = await confirmAction({
      title: 'Создать новое требование?',
      message: hasUnsentText
        ? 'Неотправленный текст сохранён в текущем диалоге. Вы сможете вернуться к нему из истории.'
        : 'Текущий диалог ещё не отправлен. Он останется в истории, и вы сможете вернуться к нему позже.',
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
    sessionRestoreFailed = false;
    currentRequestContext = {};
    document.getElementById('requirement-map-fields')?.replaceChildren();
    updateSessionIdentity(sessionId);
    currentDraft = null;
    sentRequestId = null;
    currentSlots = {};
    currentProgress = [];
    currentExpectedSlot = '';
    currentDialogueMode = '';
    currentSources = [];
    lastDraftChange = null;
  draftChanges = new Map();
    canGenerateDraft = false;
    updateRequirementWorkspace({});
    updateTransparencyPanel();
    syncSentComposerState();
    hideDraftPanel();
    showAgentWelcome(app);
    const input = document.getElementById('agent-chat-input');
    const sendBtn = document.getElementById('agent-chat-send-btn');
    clearComposerDraft(app, sessionId);
    if (input) { input.value = ''; autoResize(input); updateChatInputMeta(input); }
    if (sendBtn) sendBtn.disabled = true;
    await loadSessions(app);
  } catch (e) {
    console.error('[DMB] newDialog error:', e);
    addMessage('bot', `Не удалось создать диалог: ${formatAgentError(e)}`, { error: true });
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
      addMessage('user', lastUserMessage, { announce: false });
    } else if (entry.role === 'assistant') {
      const content = entry.content || '';
      const unavailable = isModelUnavailableMessage(content);
      const messageElement = addMessage('bot', content, { error: unavailable, announce: false, context: entry.context });
      if (unavailable && lastUserMessage) attachRetryButton(lastUserMessage, messageElement);
    }
  });
}

function bindWelcomeStarters() {
  document.querySelectorAll('[data-starter-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById('agent-chat-input');
      const sendButton = document.getElementById('agent-chat-send-btn');
      if (!input || isTyping) return;
      input.value = button.dataset.starterPrompt || '';
      autoResize(input);
      updateChatInputMeta(input);
      saveComposerDraft(window.app, input.value);
      if (sendButton) sendButton.disabled = !input.value.trim() || navigator.onLine === false;
      input.focus();
    });
  });
}

function isModelUnavailableMessage(content) {
  return String(content || '').includes('ИИ-модель сейчас недоступна');
}

function renderDraftResume(draft, options = {}) {
  appendDraftResume(draft, {
    intro: 'Есть собранный черновик требования. Можно отправить его на ревью или внести правки.',
    ...options,
  });
}

function appendDraftResume(draft, opts = {}) {
  if (opts.intro) addMessage('bot', opts.intro, { info: true, announce: opts.announce !== false });
  showDraftPanel(draft, sessionId);
}

async function send(app, rawMessage) {
  const message = rawMessage.trim();
  if (!message || isTyping || sessionRestoreFailed) return;
  if (sentRequestId) {
    renderRequestLink({ request_id: sentRequestId }, { focus: true });
    return;
  }

  if (navigator.onLine === false) {
    saveComposerDraft(app, rawMessage);
    const banner = document.getElementById('chat-network-status');
    if (banner) banner.hidden = false;
    const status = document.getElementById('agent-service-status');
    if (status) status.textContent = 'Нет подключения';
    document.getElementById('agent-chat-input')?.focus();
    return;
  }

  const container = document.getElementById('agent-chat-messages');
  if (!container) return;

  const messageId = newMessageId();
  savePendingUserMessage(app, message, messageId);
  addMessage('user', message);
  trackAgentUx(app, 'message_sent');
  if (document.getElementById('agent-chat-input').value.trim() === message) {
    clearComposerDraft(app, sessionId);
    document.getElementById('agent-chat-input').value = '';
  }
  autoResize(document.getElementById('agent-chat-input'));
  updateChatInputMeta(document.getElementById('agent-chat-input'));
  document.getElementById('agent-chat-send-btn').disabled = true;

  await performChat(app, message, messageId);
}

async function performChat(app, value, messageId = newMessageId()) {
  if (isTyping) return;
  isTyping = true;
  const controller = new AbortController();
  activeChatRequestController = controller;
  showTyping({
    cancellable: true,
    onCancel: () => controller.abort('user-stopped-waiting'),
  });
  let failed = false;
  let modelUnavailable = false;
  let stoppedWaiting = false;
  let streamingReply = null;
  const startedAt = Date.now();
  try {
    const payload = { message: value, message_id: messageId };
    if (sessionId) payload.session_id = sessionId;
    const resp = typeof app.api.stream === 'function'
      ? await app.api.stream('/agent/chat-stream', payload, {
        signal: controller.signal,
        onEvent: ({ event, data }) => {
          if (event === 'status') {
            updateProcessingStage(data?.message || 'Ассистент обрабатывает ответ…');
          } else if (event === 'delta') {
            streamingReply ||= beginStreamingReply(() => controller.abort('user-stopped-waiting'));
            updateStreamingReply(streamingReply, data?.text || '');
          } else if (event === 'replace') {
            streamingReply ||= beginStreamingReply(() => controller.abort('user-stopped-waiting'));
            updateStreamingReply(streamingReply, data?.text || '', true);
          }
        },
      })
      : await app.api.post('/agent/chat', payload, { signal: controller.signal });
    removeStreamingReply(streamingReply);
    streamingReply = null;
    sessionId = resp.session_id || sessionId;
    clearPendingUserMessage(app, messageId);
    updateSessionIdentity(sessionId);
    renderAgentResponse(resp, value);
    trackAgentUx(app, resp.message || resp.draft || resp.action === 'sent' ? 'response_received' : 'response_empty', {
      outcome: resp.message || resp.draft || resp.action === 'sent' ? 'ok' : 'empty',
      duration_ms: Date.now() - startedAt,
    });
    loadSessions(app);
    modelUnavailable = resp.action === 'unavailable';
    if (!modelUnavailable) removeRetryButtons();
  } catch (e) {
    removeStreamingReply(streamingReply);
    streamingReply = null;
    if (controller.signal.aborted) {
      stoppedWaiting = true;
      trackAgentUx(app, 'wait_cancelled', { outcome: 'cancelled', duration_ms: Date.now() - startedAt });
      addMessage('bot', 'Ожидание остановлено. Сообщение сохранено: если ассистент уже обрабатывает его, ответ восстановится при следующем открытии диалога.', { info: true });
    } else {
      failed = true;
      trackAgentUx(app, 'request_failed', { outcome: 'error', duration_ms: Date.now() - startedAt });
      const errorMessage = addMessage('bot', `${formatAgentError(e)} Попробуйте ещё раз.`, { error: true });
      attachRetryButton(value, errorMessage, messageId);
    }
  } finally {
    if (activeChatRequestController === controller) activeChatRequestController = null;
    isTyping = false;
    hideTyping();
    if (stoppedWaiting) {
      const status = document.getElementById('agent-service-status');
      if (status) status.textContent = 'Ожидание остановлено — сообщение сохранено';
    } else if (failed) {
      const status = document.getElementById('agent-service-status');
      if (status) status.textContent = 'Связь потеряна — можно повторить';
    } else if (modelUnavailable) {
      const status = document.getElementById('agent-service-status');
      if (status) status.textContent = 'ИИ-модель недоступна — можно повторить';
    }
  }
}

function updateProcessingStage(message) {
  const label = document.getElementById('chat-processing-label');
  const status = document.getElementById('agent-service-status');
  if (label) label.textContent = message;
  if (status) status.textContent = message.replace(/…$/, '');
}

function beginStreamingReply(onCancel) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return null;
  const stickToLatest = isNearChatBottom(container);
  document.getElementById('agent-typing-indicator')?.remove();
  window.clearInterval(typingElapsedTimer);
  typingElapsedTimer = null;

  const element = document.createElement('div');
  element.className = 'chat-message chat-message-bot chat-message-streaming';
  element.setAttribute('aria-busy', 'true');
  element.innerHTML = `
    <div class="chat-message-avatar"><i data-lucide="bot" style="width:16px;height:16px;"></i></div>
    <div class="chat-message-body">
      <div class="chat-message-header">ИИ-ассистент требований</div>
      <div class="chat-message-content"></div>
      <div class="chat-stream-controls">
        <span><i data-lucide="sparkles" aria-hidden="true"></i> Ответ поступает</span>
        <button type="button" class="btn btn-secondary btn-sm ui-btn chat-stop-waiting">Остановить</button>
      </div>
    </div>
  `;
  element.querySelector('.chat-stop-waiting')?.addEventListener('click', event => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Останавливаем…';
    onCancel?.();
  }, { once: true });
  container.appendChild(element);
  if (stickToLatest) scrollChatToLatest();
  updateProcessingStage('Ответ поступает…');
  if (window.lucide) window.lucide.createIcons();
  return { element, text: '', frame: null };
}

function updateStreamingReply(state, delta, replace = false) {
  if (!state?.element?.isConnected) return;
  state.text = replace ? String(delta || '') : state.text + String(delta || '');
  if (state.frame) return;
  state.frame = window.requestAnimationFrame(() => {
    state.frame = null;
    const content = state.element.querySelector('.chat-message-content');
    if (!content) return;
    const stickToLatest = isNearChatBottom(document.getElementById('agent-chat-messages'));
    content.innerHTML = formatContent(normalizeAgentCopy(state.text));
    if (stickToLatest) scrollChatToLatest();
  });
}

function removeStreamingReply(state) {
  if (!state) return;
  if (state.frame) window.cancelAnimationFrame(state.frame);
  state.element?.remove();
}

function pendingMessageKey(app) {
  const userId = app?.store?.get('currentUser')?.id || 'anonymous';
  return `${PENDING_MESSAGE_KEY_PREFIX}${userId}`;
}

export function composerDraftStorageKey(app, targetSessionId = sessionId) {
  const userId = app?.store?.get('currentUser')?.id || 'anonymous';
  return `${COMPOSER_DRAFT_KEY_PREFIX}user:${userId}:session:${targetSessionId || 'unassigned'}`;
}

function setComposerDraftStatus(message = '') {
  const status = document.getElementById('chat-input-draft-status');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

function saveComposerDraft(app, content, targetSessionId = sessionId) {
  try {
    const key = composerDraftStorageKey(app, targetSessionId);
    if (!String(content || '').trim()) {
      sessionStorage.removeItem(key);
      setComposerDraftStatus();
      return false;
    }
    sessionStorage.setItem(key, JSON.stringify({ content: String(content), saved_at: new Date().toISOString() }));
    setComposerDraftStatus('Черновик сохранён');
    return true;
  } catch (_) {
    setComposerDraftStatus('Не удалось сохранить локально');
    return false;
  }
}

function clearComposerDraft(app, targetSessionId = sessionId) {
  try { sessionStorage.removeItem(composerDraftStorageKey(app, targetSessionId)); } catch (_) { /* restricted storage */ }
  setComposerDraftStatus();
}

function readComposerDraft(app, targetSessionId = sessionId) {
  try {
    const key = composerDraftStorageKey(app, targetSessionId);
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    const savedAt = Date.parse(saved?.saved_at || '');
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > TRANSIENT_MESSAGE_TTL_MS) {
      sessionStorage.removeItem(key);
      return '';
    }
    return typeof saved?.content === 'string' ? saved.content : '';
  } catch (_) {
    return '';
  }
}

function restoreComposerDraft(app, targetSessionId = sessionId, { migrateUnassigned = false } = {}) {
  const input = document.getElementById('agent-chat-input');
  const sendBtn = document.getElementById('agent-chat-send-btn');
  if (!input) return '';
  const typedBeforeSessionLoaded = migrateUnassigned ? (input.value || readComposerDraft(app, null)) : '';
  if (typedBeforeSessionLoaded && targetSessionId) {
    input.value = typedBeforeSessionLoaded;
    saveComposerDraft(app, typedBeforeSessionLoaded, targetSessionId);
    try { sessionStorage.removeItem(composerDraftStorageKey(app, null)); } catch (_) { /* restricted storage */ }
  } else {
    input.value = readComposerDraft(app, targetSessionId);
  }
  autoResize(input);
  updateChatInputMeta(input);
  syncSentComposerState();
  setComposerDraftStatus(input.value.trim() ? 'Черновик восстановлен' : '');
  return input.value;
}

function bindAgentNetworkState(app, signal) {
  const sync = (recovered = false) => {
    const offline = navigator.onLine === false;
    const banner = document.getElementById('chat-network-status');
    const input = document.getElementById('agent-chat-input');
    const sendBtn = document.getElementById('agent-chat-send-btn');
    const serviceStatus = document.getElementById('agent-service-status');
    if (banner) banner.hidden = !offline;
    syncSentComposerState();
    if (offline) {
      if (serviceStatus) serviceStatus.textContent = 'Нет подключения';
      if (input?.value.trim()) saveComposerDraft(app, input.value);
      return;
    }
    if (serviceStatus && !isTyping) serviceStatus.textContent = recovered ? 'Связь восстановлена' : NORMAL_AGENT_STATUS;
    window.clearTimeout(networkRecoveryTimer);
    if (recovered && serviceStatus) {
      networkRecoveryTimer = window.setTimeout(() => {
        if (!isTyping && navigator.onLine !== false) serviceStatus.textContent = NORMAL_AGENT_STATUS;
      }, 3000);
    }
  };
  window.addEventListener('offline', () => sync(false), { signal });
  window.addEventListener('online', () => sync(true), { signal });
  sync(false);
}

function savePendingUserMessage(app, content, messageId) {
  try {
    sessionStorage.setItem(pendingMessageKey(app), JSON.stringify({
      content, message_id: messageId, session_id: sessionId || '', saved_at: new Date().toISOString(),
    }));
  } catch (_) { /* storage may be unavailable */ }
}

function clearPendingUserMessage(app, messageId) {
  try {
    const key = pendingMessageKey(app);
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!pending || !messageId || pending.message_id === messageId) sessionStorage.removeItem(key);
  } catch (_) { /* storage may be unavailable */ }
}

function restorePendingUserMessage(app) {
  try {
    const key = pendingMessageKey(app);
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!pending?.content) return null;
    const savedAt = Date.parse(pending.saved_at || '');
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > TRANSIENT_MESSAGE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    const visibleMessages = [...document.querySelectorAll('.chat-message-user .chat-message-content')];
    const alreadyVisible = visibleMessages.some(node => node.textContent === pending.content);
    if (!alreadyVisible) addMessage('user', pending.content);
    return pending;
  } catch (_) {
    return null;
  }
}

export function clearAgentChatTransientStorage() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index) || '';
      if (key.startsWith(PENDING_MESSAGE_KEY_PREFIX) || key.startsWith(COMPOSER_DRAFT_KEY_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch (_) { /* restricted storage */ }
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
        sentRequestId = getLockedRequestId(state);
        updateSessionIdentity(sessionId);
        updateRequirementWorkspace(state);
        const container = document.getElementById('agent-chat-messages');
        if (container) {
          container.innerHTML = '';
          renderHistory(state.history);
        }
        if (sentRequestId) renderRequestLink(state, { focus: false });
        syncSentComposerState();
        isTyping = false;
        hideTyping();
        return;
      }
    } catch (_) { /* transient polling failure */ }
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }

  isTyping = false;
  hideTyping();
  const status = document.getElementById('agent-service-status');
  if (status) status.textContent = 'Обработка заняла больше обычного';
}

function renderAgentResponse(resp, retryValue = '') {
  if (Object.prototype.hasOwnProperty.call(resp, 'draft')) {
    if (!resp.draft || (currentDraft?.id && resp.draft.id && currentDraft.id !== resp.draft.id)) {
      draftChanges = new Map();
      lastDraftChange = null;
    }
    for (const change of getDraftChanges(currentDraft, resp.draft)) {
      const original = draftChanges.get(change.field);
      draftChanges.set(change.field, { ...change, before: original?.before ?? change.before });
    }
    currentDraft = resp.draft || null;
    if (!currentDraft) hideDraftPanel();
  }
  updateRequirementWorkspace(resp);
  const hasUsefulResponse = Boolean(String(resp.message || '').trim() || resp.draft || resp.action === 'sent');
  const responseMessage = addMessage(
    'bot',
    hasUsefulResponse ? (resp.message || '') : 'Ассистент не вернул содержательный ответ. Повторите запрос — ваш текст сохранён.',
    { error: ['unavailable', 'error', 'validation_error', 'sent_locked'].includes(resp.action) || resp.success === false || !hasUsefulResponse },
  );
  if (!hasUsefulResponse && retryValue) attachRetryButton(retryValue, responseMessage);

  if (resp.action === 'unavailable') {
    const status = document.getElementById('agent-service-status');
    if (status) status.textContent = 'ИИ-модель недоступна';
    if (retryValue) attachRetryButton(retryValue, responseMessage);
  }

  // Update progress panel
  if (resp.progress && resp.progress.length > 0) {
    updateProgressPanel(resp.progress, resp.quality);
  }

  (resp.blocks || []).forEach(block => {
    if (block.type === 'draft_preview' && block.draft) {
      showDraftPanel(block.draft, resp.session_id);
    }
  });

  if (resp.action === 'draft_ready' && resp.draft) {
    trackAgentUx(window.app, 'draft_ready');
    showDraftPanel(resp.draft, resp.session_id);
  }

  if (['sent', 'sent_locked'].includes(resp.action) && resp.request_id) {
    sentRequestId = resp.request_id;
    disableDraftActions(resp.request_id);
    renderRequestLink(resp);
    hideDraftPanel();
    updateProgressPanel(currentProgress, resp.quality || {});
    syncSentComposerState();
    if (resp.action === 'sent') trackAgentUx(window.app, 'request_sent');
  }

  if (window.lucide) window.lucide.createIcons();
}

function updateProgressPanel(progress, quality = {}) {
  const card = document.getElementById('chat-progress-card');
  const text = document.getElementById('chat-progress-text');
  const list = document.getElementById('chat-progress-list');

  if (!card || !progress) return;
  if (sentRequestId) {
    text.textContent = `${REQUEST_STATUS_LABELS[currentRequestContext.request_status] || 'Отправлено на ревью'} · запрос #${sentRequestId}`;
    list.innerHTML = '';
    list.hidden = true;
    return;
  }

  const filled = progress.filter(p => p.filled).length;
  const missingRequired = [...REQUIRED_SLOTS].filter(key => !classifyRequirementValue(
    getRequirementValue(key),
    progress.find(p => p.key === key || p.slot === key) || {},
    true,
  ).resolved).length;
  text.textContent = !filled
    ? 'Опишите потребность, чтобы начать'
    : (missingRequired
      ? `Нужно уточнить ${missingRequired} ${pluralizePoints(missingRequired)}`
      : (quality.issues?.length ? `Можно сформировать черновик · ${quality.issues.length} ${pluralizeRecommendations(quality.issues.length)}` : 'Можно сформировать черновик'));

  const actionable = progress.filter(p => p.needs_review || (!p.filled && !p.skipped)).slice(0, 3);
  list.innerHTML = actionable.map(p => {
    const icon = p.needs_review ? 'alert-circle' : (p.filled ? 'check-circle' : (p.skipped ? 'minus-circle' : 'circle'));
    const color = p.needs_review ? 'var(--warning)' : (p.filled ? 'var(--success)' : (p.skipped ? 'var(--text-muted)' : 'var(--text-secondary)'));
    const suffix = p.needs_review ? ' — требуется проверка' : '';
    return `
      <button type="button" class="ui-surface-action chat-progress-item" data-progress-slot="${escapeHtml(p.key || p.slot || '')}">
        <i data-lucide="${icon}" style="width:14px;height:14px;color:${color};"></i>
        <span>${escapeHtml(p.label + suffix)}</span>
      </button>
    `;
  }).join('');

  list.hidden = !actionable.length;
  list.querySelectorAll('[data-progress-slot]').forEach(btn => btn.addEventListener('click', () => editRequirementField(btn.dataset.progressSlot)));
  if (window.lucide) window.lucide.createIcons();
}

function pluralizeRecommendations(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'рекомендация';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'рекомендации';
  return 'рекомендаций';
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
  if (Object.prototype.hasOwnProperty.call(resp, 'draft')) currentDraftRevision = resp.draft_revision || '';
  if (resp.request_id) currentRequestContext = { ...currentRequestContext, ...resp };
  if (Object.prototype.hasOwnProperty.call(resp, 'can_generate_draft')) canGenerateDraft = Boolean(resp.can_generate_draft);
  currentSlots = resp.slots || currentSlots || {};
  currentProgress = resp.progress || currentProgress || [];
  currentExpectedSlot = resp.expected_slot || '';
  if (Object.prototype.hasOwnProperty.call(resp, 'dialogue_mode')) currentDialogueMode = resp.dialogue_mode || '';
  if (Object.prototype.hasOwnProperty.call(resp, 'sources')) currentSources = Array.isArray(resp.sources) ? resp.sources : [];
  updateTransparencyPanel();
  const comment = document.getElementById('requirement-review-comment');
  if (comment) {
    comment.hidden = !(currentRequestContext.request_status === 'returned' && currentRequestContext.review_comment);
    comment.innerHTML = comment.hidden ? '' : `<strong>Что просит уточнить ревьюер</strong><p>${escapeHtml(currentRequestContext.review_comment)}</p>`;
  }
  const fields = document.getElementById('requirement-map-fields');
  const mapCard = document.getElementById('requirement-map-card');
  const requirementPane = document.getElementById('chat-requirement-pane');
  const empty = document.getElementById('requirement-map-empty');
  const status = document.getElementById('requirement-map-status');
  const title = document.getElementById('requirement-workspace-title');
  const caption = document.getElementById('requirement-workspace-caption');
  const counts = document.querySelectorAll('.requirement-tab-count');
  const allSlots = REQUIREMENT_MAP_GROUPS.flatMap(group => group.slots);
  const fieldStates = new Map(allSlots.map(key => [key, getRequirementFieldState(key)]));
  const resolvedKeys = new Set(allSlots.filter(key => fieldStates.get(key).resolved));
  const visibleKeys = new Set(allSlots.filter(key => hasRequirementValue(getRequirementValue(key)) || ['blocking', 'needs-review'].includes(fieldStates.get(key).key)));
  if (fields) {
    const expanded = new Map([...fields.querySelectorAll('[data-map-group]')].map(item => [item.dataset.mapGroup, item.open]));
    const editors = sentRequestId ? [] : [...fields.querySelectorAll('.requirement-map-field.is-editing')];
    fields.innerHTML = REQUIREMENT_MAP_GROUPS.map(group => {
      const filledInGroup = group.slots.filter(key => resolvedKeys.has(key)).length;
      const visibleInGroup = group.slots.some(key => visibleKeys.has(key));
      const missingRequired = group.slots.filter(key => REQUIRED_SLOTS.has(key) && !resolvedKeys.has(key)).length;
      const groupStatus = missingRequired
        ? `${missingRequired} нужно заполнить`
        : `${filledInGroup} из ${group.slots.length}`;
      const rows = group.slots.map(key => renderRequirementMapField(key, fieldStates.get(key))).join('');
      return `<details class="requirement-map-group" data-map-group="${group.key}"${(expanded.get(group.key) ?? group.open) ? ' open' : ''}>
        <summary><span>${escapeHtml(group.label)}</span><span class="requirement-map-group-status">${group.key === 'minimum' ? '' : (filledInGroup ? 'Есть сведения' : 'По необходимости')}</span></summary>
        <div class="requirement-map-group-fields">${rows}</div>
      </details>`;
    }).join('');
    fields.querySelectorAll('[data-edit-slot]').forEach(btn => btn.addEventListener('click', () => editRequirementField(btn.dataset.editSlot)));
    editors.forEach(editor => fields.querySelector(`[data-slot-card="${CSS.escape(editor.dataset.slotCard)}"]`)?.replaceWith(editor));
  }
  if (empty) empty.style.display = 'none';
  if (fields) fields.style.display = 'grid';
  if (mapCard) {
    mapCard.style.display = 'flex';
    mapCard.classList.toggle('is-final-review', Boolean(currentDraft));
    mapCard.classList.toggle('is-sent', Boolean(sentRequestId));
  }
  if (requirementPane) requirementPane.classList.add('has-requirement-map');
  if (status) {
    const blockers = getDraftBlockingIssues(currentDraft).length;
    status.textContent = sentRequestId
      ? (REQUEST_STATUS_LABELS[currentRequestContext.request_status] || 'Отправлено')
      : (currentDraft
        ? (blockers ? `${blockers} ${pluralizeBlockers(blockers)}` : 'Финальная проверка')
        : (visibleKeys.size ? 'Собираем' : 'Не начато'));
  }
  if (title) title.textContent = currentDraft?.title || 'Требование';
  if (caption) caption.textContent = sentRequestId
    ? `${REQUEST_STATUS_LABELS[currentRequestContext.request_status] || 'Отправлено на ревью'} · запрос #${sentRequestId}`
    : (currentDraft
      ? 'Проверьте документ целиком · изменения вносятся прямо в полях'
      : 'Собирается вместе с диалогом · любое поле можно исправить');
  counts.forEach(count => { count.textContent = ''; });
  updateInterviewProgress();
  updateEarlyDraftAction();
  updateCurrentQuestion(resp.message, currentExpectedSlot);
  if (resp.progress) updateProgressPanel(resp.progress, resp.quality || {});
  if (window.lucide) window.lucide.createIcons();
}

export function getCoreRequirementProgress(values = {}, progress = [], { expectedSlot = '', draft = null, canGenerate = false } = {}) {
  const blockers = getDraftBlockingIssues(draft);
  const fields = CORE_PROGRESS_FIELDS.map(field => {
    const detail = progress.find(item => (item.key || item.slot) === field.key) || {};
    const classified = classifyRequirementValue(values[field.key], detail, true);
    const hasBlocker = blockers.some(item => (DRAFT_TO_MAP_SLOT[item.slot] || item.slot) === field.key);
    const filled = classified.filled;
    const unresolved = ['needs-clarification', 'not-applicable'].includes(classified.key)
      || ['unknown', 'not_applicable', 'skipped'].includes(detail.status) || detail.skipped;
    const state = filled ? (detail.needs_review || hasBlocker ? 'review' : 'filled') : unresolved ? 'unknown' : 'empty';
    const label = { filled: 'Заполнено', review: 'Нужно проверить', unknown: 'Нужно уточнить', empty: 'Нет ответа' }[state];
    return { ...field, filled, state, status: label };
  });
  const count = fields.filter(field => field.filled).length;
  const outstanding = fields.filter(field => !field.filled);
  const next = outstanding.find(field => field.key === expectedSlot) || outstanding[0]
    || fields.find(field => field.state === 'review');
  let message = next ? `${next.state === 'empty' ? 'Осталось добавить' : next.state === 'review' ? 'Проверьте' : 'Нужно уточнить'}: ${next.label.toLocaleLowerCase('ru')}` : 'Основные атрибуты заполнены';
  if (draft && blockers.length) message = `Для отправки исправьте ${blockers.length} ${pluralizeBlockers(blockers.length)}`;
  else if (draft && !next) message = 'Черновик готов — проверьте его перед отправкой';
  else if (count === 4 && !next && canGenerate) message = 'Основа собрана — можно сформировать черновик';
  return { fields, count, total: CORE_PROGRESS_FIELDS.length, message, nextSlot: next?.key || '' };
}

export function renderCoreRequirementProgress() {
  const point = (radius, angle) => [50 + radius * Math.cos(angle * Math.PI / 180), 50 + radius * Math.sin(angle * Math.PI / 180)].map(value => value.toFixed(2)).join(' ');
  const segment = index => {
    const start = index * 90 - 85;
    const end = index * 90 - 5;
    return `M ${point(46, start)} A 46 46 0 0 1 ${point(46, end)} L ${point(37, end)} A 37 37 0 0 0 ${point(37, start)} Z`;
  };
  return `<div class="chat-interview-progress" id="chat-interview-progress" role="status" aria-live="off" aria-label="Заполненность основных атрибутов" hidden>
    <div class="chat-core-ring" aria-hidden="true">
      <svg viewBox="0 0 100 100" class="chat-core-ring-svg">
        <defs><linearGradient id="chat-core-filled-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--success)"/><stop offset="1" stop-color="color-mix(in srgb, var(--success) 75%, var(--text-primary))"/></linearGradient></defs>
        ${CORE_PROGRESS_FIELDS.map((field, index) => `<path d="${segment(index)}" data-core-progress-slot="${field.key}" data-core-segment="${field.key}" data-state="empty"/>`).join('')}
      </svg>
      <div class="chat-core-ring-count"><strong id="chat-core-progress-count">0/4</strong></div>
    </div>
    <div class="chat-core-progress-body">
      <strong class="chat-core-progress-title">Основа требования</strong>
      <button type="button" id="chat-interview-progress-text" class="ui-surface-action chat-core-progress-status" aria-live="polite" aria-atomic="true"></button>
      <div class="chat-core-progress-fields" role="group" aria-label="Открыть основной атрибут">
        ${CORE_PROGRESS_FIELDS.map(field => `<button type="button" class="ui-surface-action chat-core-progress-field" data-core-progress-slot="${field.key}" data-core-field="${field.key}" data-state="empty"><span class="chat-core-field-symbol" aria-hidden="true">·</span><span>${field.label}</span><span class="sr-only" data-core-field-status></span></button>`).join('')}
      </div>
    </div>
  </div>`;
}

function updateInterviewProgress() {
  const wrap = document.getElementById('chat-interview-progress');
  const text = document.getElementById('chat-interview-progress-text');
  if (!wrap || !text) return;
  if (sentRequestId || sessionRestoreFailed) {
    wrap.hidden = true;
    text.textContent = '';
    return;
  }

  const values = Object.fromEntries(CORE_PROGRESS_FIELDS.map(field => [field.key, getRequirementValue(field.key)]));
  const model = getCoreRequirementProgress(values, currentProgress, { expectedSlot: currentExpectedSlot, draft: currentDraft, canGenerate: canGenerateDraft });
  const summary = `<span class="sr-only">Заполнено ${model.count} из ${model.total}. </span>${escapeHtml(model.message)}`;
  if (text.innerHTML !== summary) text.innerHTML = summary;
  text.dataset.coreProgressSlot = model.nextSlot || '';
  text.classList.toggle('is-actionable', Boolean(model.nextSlot));
  text.setAttribute('aria-label', model.nextSlot
    ? `${model.message}. Открыть поле «${SLOT_LABELS[model.nextSlot] || model.nextSlot}»`
    : model.message);
  const count = document.getElementById('chat-core-progress-count');
  if (count) count.textContent = `${model.count}/${model.total}`;
  document.querySelectorAll('.requirement-tab-count').forEach(tabCount => {
    tabCount.textContent = `${model.count}/${model.total}`;
  });
  const requirementTab = document.getElementById('chat-requirement-tab');
  requirementTab?.setAttribute('aria-label', `Требование, заполнено ${model.count} из ${model.total}`);
  model.fields.forEach(field => {
    const button = wrap.querySelector(`[data-core-field="${field.key}"]`);
    const segment = wrap.querySelector(`[data-core-segment="${field.key}"]`);
    if (segment) segment.dataset.state = field.state;
    if (!button) return;
    button.dataset.state = field.state;
    button.disabled = isTyping;
    button.setAttribute('aria-label', `${field.label}: ${field.status}. Открыть поле`);
    button.title = field.status;
    button.querySelector('.chat-core-field-symbol').textContent = field.state === 'filled' ? '✓' : ['review', 'unknown'].includes(field.state) ? '?' : '·';
    button.querySelector('[data-core-field-status]').textContent = field.status;
  });
  wrap.classList.toggle('is-busy', isTyping);
  wrap.hidden = false;
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

export function classifyRequirementValue(value, progress = {}, required = false, blocking = false) {
  const normalized = (Array.isArray(value) ? value.join('; ') : String(value ?? '')).trim().replace(/[.!]+$/u, '').trim();
  const unknown = /^(не знаю(?:,?\s*нужно уточнить)?|нужно уточнить|неизвестно|затрудняюсь)$/iu.test(normalized);
  const notApplicable = /^(не применимо|неприменимо|не относится|n\/a)$/iu.test(normalized);
  if (blocking) return { key: 'blocking', label: 'Блокирует отправку', filled: Boolean(normalized) && !unknown && !notApplicable, resolved: false };
  if (unknown) {
    return { key: 'needs-clarification', label: 'Нужно уточнить', filled: false, resolved: false };
  }
  if (notApplicable) {
    return { key: 'not-applicable', label: 'Не применимо', filled: false, resolved: !required };
  }
  if (progress.needs_review) return { key: 'needs-review', label: 'Нужно проверить', filled: Boolean(normalized), resolved: Boolean(normalized) };
  if (normalized) return { key: 'filled', label: 'Заполнено', filled: true, resolved: true };
  if (progress.skipped && !required) return { key: 'skipped', label: 'Пропущено', filled: false, resolved: true };
  return { key: 'empty', label: required ? 'Обязательно' : 'Необязательно', filled: false, resolved: false };
}

function getRequirementFieldState(key) {
  const progress = currentProgress.find(item => item.key === key || item.slot === key) || {};
  const blocking = getDraftBlockingIssues(currentDraft).some(item => (DRAFT_TO_MAP_SLOT[item.slot] || item.slot) === key);
  return classifyRequirementValue(getRequirementValue(key), progress, REQUIRED_SLOTS.has(key), blocking);
}

function getRequirementFieldEvidence(key) {
  if (!getRequirementFieldState(key).filled) return '';
  const draftField = MAP_TO_DRAFT_FIELD[key] || key;
  const provenance = currentDraft?.field_provenance?.[draftField] ?? currentDraft?.field_provenance?.[key];
  const confidence = currentDraft?.field_confidence?.[draftField] ?? currentDraft?.field_confidence?.[key];
  if (!provenance && confidence === undefined) return '';
  const rawSource = typeof provenance === 'object'
    ? (provenance.label || provenance.title || provenance.source || provenance.type)
    : provenance;
  const sourceLabels = {
    user: 'сообщение пользователя', user_message: 'сообщение пользователя',
    model: 'вывод ассистента', llm_extraction: 'извлечено из диалога', knowledge_base: 'база знаний',
  };
  const source = sourceLabels[rawSource] || String(rawSource || 'не указан');
  const numeric = Number(confidence);
  const confidenceKey = Number.isFinite(numeric)
    ? (numeric >= 0.85 ? 'high' : numeric >= 0.65 ? 'medium' : 'low')
    : String(confidence || '').toLowerCase();
  const confidenceLabel = CONFIDENCE_LABELS[confidenceKey] || 'Не указана';
  return `<div class="requirement-map-evidence"><span>Источник: ${escapeHtml(source)}</span><span>Уверенность: ${escapeHtml(confidenceLabel)}</span></div>`;
}

function renderRequirementMapField(key, state = getRequirementFieldState(key)) {
  const value = getRequirementValue(key);
  const filled = state.filled;
  const review = state.key === 'needs-review';
  const required = REQUIRED_SLOTS.has(key);
  const semanticValue = hasRequirementValue(value) ? (Array.isArray(value) ? value.join('; ') : value) : '';
  const displayValue = semanticValue || (required ? 'Нужно заполнить' : (state.key === 'skipped' ? 'Пропущено' : 'Не добавлено'));
  const valueMarkup = sentRequestId
    ? `<div class="requirement-map-value is-readonly" aria-label="Поле ${escapeHtml(SLOT_LABELS[key] || key)}, только чтение">${escapeHtml(displayValue)}</div>`
    : `<button type="button" class="ui-link requirement-map-value" data-edit-slot="${escapeHtml(key)}" aria-label="Изменить поле ${escapeHtml(SLOT_LABELS[key] || key)}">${escapeHtml(displayValue)}</button>`;
  return `<article class="requirement-map-field state-${escapeHtml(state.key)}${review ? ' needs-review' : ''}${filled ? '' : ' is-empty'}" data-slot-card="${escapeHtml(key)}">
    <div class="requirement-map-field-head">
      <span>${escapeHtml(SLOT_LABELS[key] || key)}</span>
      <span class="requirement-map-field-state">${escapeHtml(state.label)}</span>
    </div>
    ${valueMarkup}
    ${draftChanges.has(MAP_TO_DRAFT_FIELD[key] || key) ? renderDraftChangeSummary(draftChanges.get(MAP_TO_DRAFT_FIELD[key] || key)) : lastDraftChange && (DRAFT_TO_MAP_SLOT[lastDraftChange.field] || lastDraftChange.field) === key ? renderDraftChangeSummary(lastDraftChange) : ''}
    ${getDraftBlockingIssues(currentDraft).filter(item => item.slot === key).map(item => `<p class="requirement-map-warning">${escapeHtml(item.text)}</p>`).join('')}
    ${getRequirementFieldEvidence(key) ? `<details class="requirement-field-source"><summary>Источник формулировки</summary>${getRequirementFieldEvidence(key)}</details>` : ''}
    ${review ? '<div class="requirement-map-warning"><i data-lucide="alert-circle" aria-hidden="true"></i> Ассистент не уверен — проверьте формулировку</div>' : ''}
  </article>`;
}

function updateCurrentQuestion(message, expectedSlot) {
  const wrap = document.getElementById('chat-current-question');
  const text = document.getElementById('chat-current-question-text');
  const input = document.getElementById('agent-chat-input');
  const isQuestion = Boolean(!sentRequestId && expectedSlot && message);
  if (wrap) wrap.style.display = isQuestion ? 'block' : 'none';
  if (text && isQuestion) {
    const paragraphs = String(message).split(/\n+/).map(item => item.trim()).filter(Boolean);
    const question = [...paragraphs].reverse().find(item => item.includes('?')) || paragraphs.at(-1) || '';
    text.textContent = question;
  }
  if (input) input.placeholder = sentRequestId
    ? 'Требование отправлено и доступно только для чтения'
    : (SLOT_PLACEHOLDERS[expectedSlot] || 'Опишите ответ своими словами…');
}

function editRequirementField(slot) {
  if (sentRequestId || isTyping) return;
  slot = DRAFT_TO_MAP_SLOT[slot] || slot;
  const card = document.querySelector(`[data-slot-card="${slot}"]`);
  if (!card) return;
  card.closest('details')?.setAttribute('open', '');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  const raw = getRequirementValue(slot);
  const value = Array.isArray(raw) ? raw.join('; ') : (raw || '');
  card.classList.add('is-editing');
  card.innerHTML = `<label class="requirement-map-editor-label" for="requirement-edit-${escapeHtml(slot)}">${escapeHtml(SLOT_LABELS[slot] || slot)}</label>
    <textarea id="requirement-edit-${escapeHtml(slot)}" class="input ui-control requirement-map-editor" rows="3" maxlength="5000" placeholder="${escapeHtml(SLOT_PLACEHOLDERS[slot] || 'Введите значение…')}">${escapeHtml(value)}</textarea>
    <div class="requirement-map-editor-secondary">
      <button class="btn btn-secondary btn-sm ui-btn" type="button" data-slot-state="${escapeHtml(slot)}" data-state-value="Не знаю, нужно уточнить">Не знаю</button>
      ${REQUIRED_SLOTS.has(slot) ? '' : `<button class="btn btn-secondary btn-sm ui-btn" type="button" data-slot-state="${escapeHtml(slot)}" data-state-value="Не применимо">Не применимо</button>`}
    </div>
    <div class="requirement-map-editor-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-cancel-slot="${escapeHtml(slot)}">Отмена</button>
      <button type="button" class="btn btn-primary btn-sm" data-save-slot="${escapeHtml(slot)}">Сохранить</button>
    </div>`;
  const cancelEdit = () => {
    card.classList.remove('is-editing');
    updateRequirementWorkspace();
    window.requestAnimationFrame(() => document.querySelector(`[data-edit-slot="${CSS.escape(slot)}"]`)?.focus());
  };
  card.querySelector('[data-cancel-slot]')?.addEventListener('click', cancelEdit);
  card.querySelector('[data-save-slot]')?.addEventListener('click', () => saveRequirementField(slot));
  card.querySelectorAll('[data-slot-state]').forEach(btn => btn.addEventListener('click', () => saveRequirementField(slot, btn.dataset.stateValue)));
  const editor = card.querySelector('textarea');
  editor?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelEdit();
  });
  editor?.focus();
}

async function saveRequirementField(slot, explicitValue = '') {
  if (sentRequestId) return;
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
  await send(window.app, `Исправить «${SLOT_LABELS[slot] || slot}»: ${value}`);
}

function bindWorkspaceControls() {
  const tabs = [...document.querySelectorAll('[data-chat-view]')];
  tabs.forEach((btn, index) => {
    btn.addEventListener('click', () => applyWorkspaceView(btn.dataset.chatView));
    btn.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex]?.click();
      tabs[nextIndex]?.focus();
    });
  });
  applyWorkspaceView(workspaceView);
}

function applyWorkspaceView(view = 'dialog') {
  workspaceView = view === 'requirement' ? 'requirement' : 'dialog';
  const compact = window.matchMedia('(max-width: 1024px)').matches;
  const main = document.querySelector('.chat-main');
  const pane = document.getElementById('chat-requirement-pane');
  document.querySelectorAll('[data-chat-view]').forEach(item => {
    const selected = item.dataset.chatView === workspaceView;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', selected ? 'true' : 'false');
    item.setAttribute('tabindex', selected ? '0' : '-1');
  });
  main?.classList.toggle('mobile-hidden', compact && workspaceView !== 'dialog');
  pane?.classList.toggle('mobile-visible', compact && workspaceView === 'requirement');
  if (main) {
    main.inert = compact && workspaceView !== 'dialog';
    main.toggleAttribute('inert', compact && workspaceView !== 'dialog');
    main.setAttribute('aria-hidden', main.inert ? 'true' : 'false');
  }
  if (pane) {
    pane.inert = compact && workspaceView !== 'requirement';
    pane.toggleAttribute('inert', compact && workspaceView !== 'requirement');
    pane.setAttribute('aria-hidden', pane.inert ? 'true' : 'false');
  }
  if (workspaceView === 'dialog') closeHistoryPopover();
}

function updateEarlyDraftAction() {
  updateInterviewProgress();
  const action = document.getElementById('chat-early-draft');
  if (action) action.hidden = !((canGenerateDraft || currentDraft) && !sentRequestId && !sessionRestoreFailed);
  const stageButton = document.getElementById('chat-generate-draft-btn');
  if (stageButton) {
    stageButton.disabled = isTyping;
    stageButton.textContent = !currentDraft ? 'Сформировать черновик'
      : getDraftBlockingIssues(currentDraft).length ? 'Уточнить требование'
        : currentRequestContext.request_status === 'returned' ? 'Отправить исправления на ревью' : 'Отправить на ревью';
  }
  const sendButton = document.getElementById('agent-chat-send-btn');
  const hasStageAction = Boolean(currentDraft || canGenerateDraft);
  sendButton?.classList.toggle('btn-primary', !hasStageAction);
  sendButton?.classList.toggle('btn-secondary', hasStageAction);
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
    closeHistoryDrawer(true);
  }, { signal });
  historyDrawerToggle?.addEventListener('click', () => {
    const open = focusWrapper?.classList.toggle('history-drawer-open') || false;
    if (open) focusWrapper?.classList.remove('history-collapsed');
    historyDrawerToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    historyDrawerToggle.setAttribute('aria-label', open ? 'Закрыть историю требований' : 'Открыть историю требований');
    syncHistoryDrawerAccessibility();
    if (open) document.getElementById('chat-sessions-search')?.focus();
  }, { signal });
  historyToggle?.addEventListener('click', () => {
    const open = historyToggle.getAttribute('aria-expanded') !== 'true';
    historyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (historyPopover) historyPopover.hidden = !open;
  }, { signal });
  document.getElementById('chat-sessions-close')?.addEventListener('click', () => {
    closeHistoryDrawer(true);
  }, { signal });

  document.addEventListener('click', event => {
    if (!event.target.closest('.chat-sessions-card, [data-session-menu-panel]') && !event.target.closest('#chat-history-drawer-toggle')) {
      closeHistoryPopover();
      closeHistoryDrawer();
    }
  }, { signal });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeHistoryPopover();
      closeHistoryDrawer(true);
      historyToggle?.focus();
    }
  }, { signal });
  window.addEventListener('resize', () => {
    applyWorkspaceView(workspaceView);
    syncHistoryDrawerAccessibility();
  }, { signal });
  syncHistoryDrawerAccessibility();

}

function setHistoryPanelCollapsed(collapsed) {
  const focusWrapper = document.querySelector('.chat-wrapper--focus');
  const control = document.getElementById('chat-history-collapse');
  focusWrapper?.classList.toggle('history-collapsed', Boolean(collapsed));
  if (control) {
    control.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    control.setAttribute('aria-label', collapsed ? 'Развернуть историю требований' : 'Свернуть историю требований');
  }
}

function closeHistoryDrawer(restoreFocus = false) {
  const wrapper = document.querySelector('.chat-wrapper--focus');
  const toggle = document.getElementById('chat-history-drawer-toggle');
  const wasOpen = wrapper?.classList.contains('history-drawer-open');
  wrapper?.classList.remove('history-drawer-open');
  toggle?.setAttribute('aria-expanded', 'false');
  toggle?.setAttribute('aria-label', 'Открыть историю требований');
  syncHistoryDrawerAccessibility();
  if (restoreFocus && wasOpen) toggle?.focus();
}

function syncHistoryDrawerAccessibility() {
  const panel = document.querySelector('.chat-history-panel');
  if (!panel) return;
  const open = document.querySelector('.chat-wrapper--focus')?.classList.contains('history-drawer-open');
  panel.inert = !open;
  panel.toggleAttribute('inert', !open);
  panel.setAttribute('aria-hidden', panel.inert ? 'true' : 'false');
}

function closeHistoryPopover() {
  const toggle = document.getElementById('chat-sessions-toggle');
  const popover = document.getElementById('chat-sessions-popover');
  toggle?.setAttribute('aria-expanded', 'false');
  if (popover && toggle) popover.hidden = true;
}

function updateSessionIdentity(value) {
  const wrap = document.getElementById('chat-session-identity');
  const label = document.getElementById('chat-session-id');
  const normalized = value ? String(value) : '';
  if (label) label.textContent = normalized ? `#${normalized.slice(0, 8)}` : '—';
  if (wrap) wrap.title = normalized ? `ID диалога: ${normalized}` : '';
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
  canGenerateDraft = false;
  document.getElementById('requirement-workspace')?.classList.add('is-final-review');
  panel.style.display = 'flex';
  panel.hidden = false;
  updateRequirementWorkspace();

  const esc = escapeHtml;
  content.innerHTML = `
    ${renderDraftAttentionPanel(draft)}
    ${renderDraftReviewDetails(draft)}
  `;

  content.querySelectorAll('[data-fix-blocker]').forEach(btn => {
    btn.addEventListener('click', () => fixDraftBlocker(btn.dataset.fixBlocker, btn.dataset.blockerQuestion || ''));
  });

  const blockingCount = getDraftBlockingIssues(draft).length;

  actions.innerHTML = `
    <button class="btn btn-primary btn-sm" data-draft-action="${blockingCount ? 'fix' : 'send_review'}" style="width:100%;">
      <i data-lucide="send"></i>
      ${blockingCount ? 'Уточнить требование' : (currentRequestContext.request_status === 'returned' ? 'Отправить исправления на ревью' : 'Отправить на ревью')}
    </button>
    <button class="btn btn-secondary btn-sm" data-draft-action="dialog" style="width:100%;margin-top:8px;">
      <i data-lucide="message-circle"></i>
      Продолжить в диалоге
    </button>
  `;

  actions.querySelectorAll('[data-draft-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.draftAction === 'fix') {
        const first = getDraftBlockingIssues(draft)[0];
        fixDraftBlocker(first?.slot || 'dialog', first?.text);
        return;
      }
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
  ].map(([label, items]) => [label, [...new Set(items)].filter(text => !getDraftBlockingIssues(draft).some(item => item.text === text))]).filter(([, items]) => items.length);
  if (!groups.length) return '';
  return `<section class="chat-review-details" aria-label="Замечания к требованию">
    ${groups.map(([label, items]) => `<details class="chat-review-detail"><summary>${escapeHtml(label)} · ${items.length}</summary><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`).join('')}
  </section>`;
}

function renderDraftAttentionPanel(draft) {
  const blockers = getDraftBlockingIssues(draft).filter(item => !REQUIREMENT_MAP_GROUPS.some(group => group.slots.includes(item.slot)));
  if (!blockers.length) return '';
  return `<section class="chat-review-blockers" aria-labelledby="chat-review-blockers-title">
    <div class="chat-review-blockers-heading">
      <i data-lucide="alert-circle" aria-hidden="true"></i>
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
    document.querySelector('[data-chat-view="requirement"]')?.click();
    window.setTimeout(() => editRequirementField(target), 0);
    return;
  }
  document.querySelector('[data-chat-view="dialog"]')?.click();
  updateCurrentQuestion(question || 'Добавьте недостающее уточнение', 'draft_blocker');
  const input = document.getElementById('agent-chat-input');
  if (!input) return;
  input.focus();
}

function hideDraftPanel() {
  const panel = document.getElementById('chat-draft-panel');
  if (panel) {
    panel.style.display = 'none';
    panel.hidden = true;
  }
  document.getElementById('requirement-workspace')?.classList.remove('is-final-review');
  updateRequirementWorkspace();
}

function renderDraftCard(draft, options = {}) {
  const esc = escapeHtml;
  const rows = [];
  const blockingQuestions = getDraftBlockingIssues(draft).map(q => q.text);
  const fieldLabels = {
    problem_statement: 'Проблема', current_process: 'As-Is', target_process: 'To-Be', business_value: 'Ценность',
    user_roles: 'Пользователи', department: 'Подразделение', product: 'Продукт', module: 'Модуль', scenarios: 'Сценарии',
    business_rules: 'Бизнес-правила', data_integrations: 'Данные и интеграции',
    acceptance_criteria: 'Критерии приёмки', dependencies: 'Зависимости', risks: 'Риски',
    regulatory_flags: 'Регуляторные требования',
  };
  const sourceLabels = { user: 'пользователь', user_message: 'пользователь', llm_extraction: 'извлечено из диалога', knowledge_base: 'база знаний', assumption: 'предположение', system: 'система' };
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
      <div class="chat-draft-title">${esc(draft.title || 'Черновик требования')}</div>
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
  const { blocking, attention } = getDraftIssueSummary(draft);
  if (blocking) return `<span class="requirement-state requirement-state-danger" title="Блокирующие пункты требуют решения перед отправкой"><i data-lucide="alert-circle" aria-hidden="true"></i>${blocking} ${pluralizeBlockers(blocking)}</span>`;
  if (attention) return `<span class="requirement-state requirement-state-warning">${attention} ${pluralizeRemarks(attention)} перед отправкой</span>`;
  return '<span class="requirement-state requirement-state-ready">Готово к отправке</span>';
}

export function getDraftBlockingIssues(draft = {}) {
  if (!draft) return [];
  if (Array.isArray(draft.review_findings)) {
    return draft.review_findings.filter(item => item.severity === 'error')
      .map(item => ({ text: item.message, slot: DRAFT_TO_MAP_SLOT[item.field] || item.field || '', blocking: true }));
  }
  return (draft.open_question_details || []).filter(item => item.blocking);
}

export function getDraftIssueSummary(draft = {}) {
  const blocking = getDraftBlockingIssues(draft).length;
  const openQuestions = (draft.open_question_details || []).filter(item => !item.blocking).length;
  const conflicts = (draft.conflicts || []).length;
  const quality = (draft.quality_issues || []).length;
  const assumptions = (draft.assumptions || []).length;
  return {
    blocking,
    openQuestions,
    conflicts,
    quality,
    assumptions,
    attention: blocking + conflicts + quality,
  };
}

export function getDraftChanges(before, after) {
  if (!before || !after || (before.id && after.id && before.id !== after.id)) return [];
  const normalize = value => Array.isArray(value) ? value.join('; ') : String(value ?? '');
  return REQUIREMENT_MAP_GROUPS.flatMap(group => group.slots).map(slot => {
    const field = MAP_TO_DRAFT_FIELD[slot] || slot;
    return { field, label: SLOT_LABELS[slot], before: normalize(before[field]), after: normalize(after[field]) };
  }).filter(change => change.before !== change.after);
}

export function renderDraftChangeSummary(change) {
  if (!change?.label || change.before === change.after) return '';
  return `<details class="chat-draft-change" open>
    <summary><i data-lucide="git-compare-arrows" aria-hidden="true"></i><span><strong>Раздел «${escapeHtml(change.label)}» обновлён</strong><small>Сравните формулировки перед отправкой</small></span></summary>
    <div class="chat-draft-change-grid">
      <div><span>Было</span><p>${escapeHtml(change.before || 'Не заполнено')}</p></div>
      <div><span>Стало</span><p>${escapeHtml(change.after || 'Не заполнено')}</p></div>
    </div>
  </details>`;
}

function renderDraftActions(respSessionId, draft, buttons) {
  const container = document.getElementById('agent-chat-messages');
  const stickToLatest = isNearChatBottom(container);
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

  finishChatAppend(container, stickToLatest, true);
}

async function showTeamSelectModal(sessionId, draft, triggerBtn) {
  const reviewedRevision = currentDraftRevision;
  const triggerContent = triggerBtn.innerHTML;
  triggerBtn.disabled = true;
  triggerBtn.setAttribute('aria-busy', 'true');
  triggerBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" aria-hidden="true"></i><span>Загружаем маршрут…</span>';
  if (window.lucide) window.lucide.createIcons();
  let teams = [];
  let teamsLoadError = false;
  try {
    teams = await window.app.api.get('/agent/teams');
  } catch (_) {
    teamsLoadError = true;
  } finally {
    triggerBtn.disabled = false;
    triggerBtn.removeAttribute('aria-busy');
    triggerBtn.innerHTML = triggerContent;
    if (window.lucide) window.lucide.createIcons();
  }

  const user = window.app.store.get('currentUser');
  const resubmitting = currentRequestContext.request_status === 'returned';
  const userTeamId = resubmitting ? currentRequestContext.request_team_id : user?.team_id;
  const defaultTeam = teams.find(team => team.id === userTeamId);
  const defaultRoute = defaultTeam?.name || currentRequestContext.request_team_name || (userTeamId ? 'команда вашего профиля' : 'общая очередь ревью');
  const issueSummary = getDraftIssueSummary(draft);
  const options = teams.map(t =>
    `<option value="${t.id}"${t.id === userTeamId ? ' selected' : ''}>${escapeHtml(t.name)}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal chat-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-submit-title" aria-describedby="chat-submit-description">
      <div class="modal-header">
        <div><span class="chat-dialog-eyebrow">Финальный шаг</span><h3 id="chat-submit-title">Проверка и отправка требования</h3></div>
        <button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" id="modal-close" aria-label="Закрыть окно отправки"><span aria-hidden="true">&times;</span></button>
      </div>
      <div class="modal-body">
        <p class="text-muted" id="chat-submit-description">${resubmitting ? `Будет отправлена следующая версия запроса #${escapeHtml(currentRequestContext.request_id)}.` : `После отправки будет создан запрос «${escapeHtml(draft?.title || 'Требование')}».`} Его содержание останется доступно в истории.</p>
        <div class="chat-send-summary">${getDraftReviewStatus(draft)}</div>
        <dl class="chat-submit-facts">
          <div><dt>Блокирующие вопросы</dt><dd>${issueSummary.blocking}</dd></div>
          <div><dt>Противоречия и рекомендации</dt><dd>${issueSummary.conflicts + issueSummary.quality}</dd></div>
          <div><dt>Допущения и открытые вопросы</dt><dd>${issueSummary.assumptions + issueSummary.openQuestions}</dd></div>
        </dl>
        <label class="form-label" for="team-select">Команда для первичного ревью</label>
        <select id="team-select" class="input" style="width:100%;"${teamsLoadError || resubmitting ? ' disabled' : ''}>
          <option value="">По умолчанию: ${escapeHtml(defaultRoute)}</option>
          ${options}
        </select>
        <p class="text-muted chat-submit-route-hint">
          ${resubmitting ? `Маршрут сохранён: ${escapeHtml(defaultRoute)}. Повторная отправка обновит существующий запрос.` : `Запрос будет направлен на ревью выбранной команде. Без выбора: ${escapeHtml(defaultRoute)}.`}
        </p>
        ${teamsLoadError ? '<div class="chat-dialog-notice" role="status"><i data-lucide="alert-circle" aria-hidden="true"></i><span>Список команд не загрузился. При отправке будет использован указанный выше маршрут по умолчанию.</span></div>' : ''}
        <label class="chat-submit-confirm" for="draft-review-confirm">
          <input type="checkbox" id="draft-review-confirm">
          <span>Я проверил(а) черновик и понимаю, что открытые вопросы и допущения потребуют ревью аналитика.</span>
        </label>
        <div class="chat-dialog-error" id="chat-submit-error" role="alert" hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" id="modal-cancel">Отмена</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm" disabled>Отправить на ревью</button>
      </div>
    </div>
  `;
  const controller = mountAgentDialog(modal, {
    initialFocus: '#team-select:not([disabled]), #draft-review-confirm',
    returnFocus: triggerBtn,
    canClose: () => !modal.querySelector('[role="dialog"]')?.matches('[aria-busy="true"]'),
  });
  modal.querySelector('#modal-close').addEventListener('click', controller.requestClose);
  modal.querySelector('#modal-cancel').addEventListener('click', controller.requestClose);
  modal.querySelector('#draft-review-confirm').addEventListener('change', (e) => {
    modal.querySelector('#modal-confirm').disabled = !e.target.checked;
  });
  modal.querySelector('#modal-confirm').addEventListener('click', async () => {
    const dialog = modal.querySelector('[role="dialog"]');
    if (dialog.matches('[aria-busy="true"]')) return;
    const teamId = parseInt(modal.querySelector('#team-select').value) || null;
    const confirmBtn = modal.querySelector('#modal-confirm');
    const cancelBtn = modal.querySelector('#modal-cancel');
    const closeBtn = modal.querySelector('#modal-close');
    const teamSelect = modal.querySelector('#team-select');
    const confirmCheck = modal.querySelector('#draft-review-confirm');
    const error = modal.querySelector('#chat-submit-error');
    dialog.setAttribute('aria-busy', 'true');
    error.hidden = true;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    teamSelect.disabled = true;
    confirmCheck.disabled = true;
    confirmBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" aria-hidden="true"></i><span>Отправляем…</span>';
    triggerBtn.disabled = true;
    triggerBtn.setAttribute('aria-busy', 'true');
    try {
      const resp = await window.app.api.post('/agent/send-for-review', {
        session_id: sessionId,
        title: draft?.title || '',
        team_id: teamId,
        expected_draft_hash: reviewedRevision,
      });
      if (resp.success === false || resp.action !== 'sent' || !resp.request_id) {
        throw Object.assign(new Error(resp.message || 'Сервер не подтвердил отправку.'), { status: 409 });
      }
      controller.close();
      renderAgentResponse(resp);
      loadSessions(window.app);
    } catch (e) {
      triggerBtn.disabled = false;
      triggerBtn.removeAttribute('aria-busy');
      dialog.removeAttribute('aria-busy');
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      teamSelect.disabled = teamsLoadError || resubmitting;
      confirmCheck.disabled = false;
      confirmBtn.disabled = !confirmCheck.checked;
      confirmBtn.textContent = 'Повторить отправку';
      error.textContent = `Не удалось отправить требование: ${formatAgentError(e)}. Выбор сохранён — попробуйте ещё раз.`;
      error.hidden = false;
      confirmBtn.focus();
    }
    if (window.lucide) window.lucide.createIcons();
  });
}

function mountAgentDialog(modal, { initialFocus = 'button, input, select, textarea', returnFocus = document.activeElement, canClose = () => true, onRequestClose = null } = {}) {
  document.body.appendChild(modal);
  const dialog = modal.querySelector('[role="dialog"]') || modal.querySelector('.modal');
  enhanceDialogOverlay(modal, returnFocus);
  let closed = false;
  let requestingClose = false;
  const close = () => {
    if (closed) return;
    closed = true;
    modal.remove();
  };
  const requestClose = async () => {
    if (!canClose() || requestingClose) return;
    requestingClose = true;
    try {
      if (onRequestClose && !(await onRequestClose())) return;
      close();
    } finally {
      requestingClose = false;
    }
  };
  modal.addEventListener('click', event => { if (event.target === modal) requestClose(); });
  window.requestAnimationFrame(() => dialog.querySelector(initialFocus)?.focus());
  return { close, requestClose };
}

export function formatAgentError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const name = String(error?.name || '').toLowerCase();
  if (name === 'aborterror') return 'Ожидание ответа остановлено.';
  if (status === 401) return 'Сессия входа истекла. Войдите снова.';
  if (status === 403) return 'У вас нет доступа к этому действию.';
  if (status === 404) return 'Диалог больше недоступен. Откройте другой из истории.';
  if (status === 409) return error?.message && !/^HTTP \d+$/.test(error.message)
    ? error.message : 'Данные уже изменились. Обновите диалог и повторите действие.';
  if (status === 413 || status === 422) return 'Сообщение не прошло проверку. Сократите или уточните текст.';
  if (status === 429) return 'Сервис занят. Подождите немного и повторите запрос.';
  if (status === 502 || status === 503) return 'Ассистент временно недоступен.';
  if (status === 504) return 'Ответ не успел сформироваться вовремя.';
  const formatted = window.formatErrorMessage?.(error);
  if (formatted && formatted !== error?.message) return formatted;
  return 'Не удалось связаться с ассистентом.';
}

function trackAgentUx(app, event, detail = {}) {
  if (!app?.api?.post) return;
  const payload = {
    event,
    outcome: detail.outcome || 'ok',
    ...(Number.isFinite(detail.duration_ms) ? { duration_ms: Math.max(0, Math.round(detail.duration_ms)) } : {}),
  };
  try {
    Promise.resolve(app.api.post('/agent/ux-event', payload)).catch(() => {});
  } catch (_) { /* metrics never interrupt the workflow */ }
}

function updateTransparencyPanel({ sources: answerSources = currentSources, mode: answerMode = currentDialogueMode, unavailable = false } = {}) {
  const summary = document.getElementById('chat-context-summary');
  const details = document.getElementById('chat-context-details');
  const modeLabels = {
    adaptive: 'адаптивный', standard: 'стандартный', guided: 'пошаговый',
    hybrid: 'сбалансированный', free_form: 'свободный', concise: 'краткий', expert: 'экспертный',
  };
  const modeKey = String(answerMode || '').toLowerCase();
  const mode = modeLabels[modeKey] || 'стандартный';
  const modeDescriptions = {
    adaptive: 'Ассистент меняет глубину уточнений в зависимости от полноты ответа.',
    guided: 'Ассистент последовательно проходит обязательные разделы требования.',
    hybrid: 'Ассистент сначала закрывает обязательные пробелы, а дополнительные детали можно оставить на потом.',
    free_form: 'Ассистент извлекает структуру из свободного описания и уточняет только недостающие сведения.',
    concise: 'Ассистент задаёт минимум уточнений и формирует более короткие ответы.',
    expert: 'Ассистент быстрее переходит к черновику и задаёт меньше уточняющих вопросов.',
    standard: 'Ассистент последовательно уточняет сведения, необходимые для качественного черновика.',
  };
  const modeDescription = modeDescriptions[modeKey] || modeDescriptions.standard;
  const sources = (answerSources || []).map((source, index) => {
    if (typeof source === 'string') return source;
    return source?.title || source?.name || source?.label || source?.source || `Источник ${index + 1}`;
  }).filter(Boolean);
  if (unavailable) {
    if (summary) summary.textContent = 'Контекст этого ответа не сохранён';
    if (details) details.textContent = 'В старой записи нет сведений об источниках этого ответа.';
    return;
  }
  if (summary) summary.textContent = `Диалог: ${mode} · ${sources.length ? `${sources.length} ${pluralizeSources(sources.length)}` : 'без внешних источников'}`;
  if (details) details.innerHTML = `<strong>Как ассистент ведёт диалог</strong><p>${escapeHtml(modeDescription)}</p>${sources.length
    ? `<strong>Использованные материалы</strong><ul>${sources.map(source => `<li>${escapeHtml(source)}</li>`).join('')}</ul>`
    : '<strong>Источники ответа</strong><p>Ответ основан на сообщениях этого диалога. Внешние справочные материалы не использованы.</p>'}`;
}

function pluralizeSources(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'источник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'источника';
  return 'источников';
}

function syncSentComposerState() {
  const sent = Boolean(sentRequestId);
  const input = document.getElementById('agent-chat-input');
  const sendBtn = document.getElementById('agent-chat-send-btn');
  const area = document.querySelector('.chat-input-area');
  area?.classList.toggle('is-sent', sent);
  if (input) {
    input.readOnly = sent;
    input.toggleAttribute('aria-disabled', sent);
    input.placeholder = sent ? 'Требование отправлено и доступно только для чтения' : (SLOT_PLACEHOLDERS[currentExpectedSlot] || 'Опишите ответ своими словами…');
  }
  if (sendBtn) sendBtn.disabled = sent || isTyping || sessionRestoreFailed || !input?.value.trim() || navigator.onLine === false;
  if (sent) {
    const question = document.getElementById('chat-current-question');
    const early = document.getElementById('chat-early-draft');
    if (question) question.style.display = 'none';
    if (early) early.hidden = true;
  }
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
    ['business_value', 'Бизнес-ценность'], ['primary_role', 'Основная роль'], ['affected_users', 'Пользователи'], ['department', 'Подразделение'],
    ['process', 'Процесс'], ['priority', 'Приоритет'],
    ['product', 'Продукт'], ['module', 'Модуль'], ['scenarios', 'Сценарии'],
    ['business_rules', 'Бизнес-правила'], ['data_integrations', 'Данные и интеграции'],
    ['acceptance_criteria', 'Критерии приёмки'], ['dependencies', 'Зависимости'],
    ['risks', 'Риски'], ['regulatory_flags', 'Регуляторные требования'],
  ];
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal chat-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-edit-title" aria-describedby="chat-edit-description">
      <div class="modal-header"><div><span class="chat-dialog-eyebrow">Редактирование черновика</span><h3 id="chat-edit-title">Изменить раздел требования</h3></div><button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" aria-label="Закрыть редактирование"><span aria-hidden="true">&times;</span></button></div>
      <div class="modal-body">
        <p class="text-muted" id="chat-edit-description">Изменение сохранится в текущем черновике. Перед отправкой его можно проверить ещё раз.</p>
        <label class="form-label" for="draft-edit-section">Раздел</label>
        <select id="draft-edit-section" class="input" style="width:100%;">
          ${fields.map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join('')}
        </select>
        <label class="form-label" for="draft-edit-value" style="margin-top:var(--space-3);">Новая формулировка</label>
        <textarea id="draft-edit-value" class="input" rows="5" maxlength="5000" style="width:100%;resize:vertical;" aria-describedby="draft-edit-help draft-edit-error"></textarea>
        <p class="text-muted" style="font-size:var(--text-xs);margin-top:var(--space-2);">Для списков перечислите пункты через точку с запятой.</p>
        <p class="text-muted chat-edit-help" id="draft-edit-help">Проверьте формулировку: после сохранения ассистент обновит итоговый черновик.</p>
        <div class="chat-dialog-error" id="draft-edit-error" role="alert" hidden></div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-cancel>Отмена</button><button class="btn btn-primary btn-sm" data-save>Применить</button></div>
    </div>`;
  const select = modal.querySelector('#draft-edit-section');
  if (initialField && fields.some(([key]) => key === initialField)) select.value = initialField;
  const value = modal.querySelector('#draft-edit-value');
  const fillValue = () => {
    const raw = draft?.[select.value];
    value.value = Array.isArray(raw) ? raw.join('; ') : (raw || '');
  };
  fillValue();
  select.addEventListener('change', fillValue);
  const fieldValue = field => {
    const raw = draft?.[field];
    return Array.isArray(raw) ? raw.join('; ') : (raw || '');
  };
  const hasUnsavedChange = () => value.value !== fieldValue(select.value);
  let saving = false;
  const controller = mountAgentDialog(modal, {
    initialFocus: '#draft-edit-section',
    canClose: () => !saving,
    onRequestClose: async () => {
      if (!hasUnsavedChange()) return true;
      return confirmAction({
        title: 'Отменить изменения?',
        message: 'Новая формулировка не сохранена.',
        confirmText: 'Не сохранять',
        cancelText: 'Продолжить редактирование',
        destructive: true,
      });
    },
  });
  modal.querySelector('.modal-close').addEventListener('click', controller.requestClose);
  modal.querySelector('[data-cancel]').addEventListener('click', controller.requestClose);
  modal.querySelector('[data-save]').addEventListener('click', async () => {
    const text = value.value.trim();
    const error = modal.querySelector('#draft-edit-error');
    if (!text) {
      error.textContent = 'Добавьте формулировку — пустой раздел сохранить нельзя.';
      error.hidden = false;
      value.setAttribute('aria-invalid', 'true');
      value.focus();
      return;
    }
    error.hidden = true;
    value.removeAttribute('aria-invalid');
    const label = fields.find(([key]) => key === select.value)?.[1] || select.value;
    const saveBtn = modal.querySelector('[data-save]');
    const cancelBtn = modal.querySelector('[data-cancel]');
    saving = true;
    modal.querySelector('[role="dialog"]').setAttribute('aria-busy', 'true');
    select.disabled = true;
    value.disabled = true;
    cancelBtn.disabled = true;
    modal.querySelector('.modal-close').disabled = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader" class="animate-spin" aria-hidden="true"></i><span>Сохраняем…</span>';
    if (window.lucide) window.lucide.createIcons();
    const result = await saveDraftSection(select.value, text, label, { inlineError: true });
    saving = false;
    if (result.ok) {
      controller.close();
      return;
    }
    modal.querySelector('[role="dialog"]').removeAttribute('aria-busy');
    select.disabled = false;
    value.disabled = false;
    cancelBtn.disabled = false;
    modal.querySelector('.modal-close').disabled = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Повторить сохранение';
    error.textContent = `Не удалось сохранить изменение: ${result.error}. Текст остался в форме.`;
    error.hidden = false;
    saveBtn.focus();
  });
}

async function saveDraftSection(field, value, label, { inlineError = false } = {}) {
  if (sentRequestId) return { ok: false, error: 'отправленное требование доступно только для чтения' };
  if (isTyping) return { ok: false, error: 'дождитесь завершения текущей операции' };
  isTyping = true;
  showTyping();
  const previousValue = currentDraft?.[field];
  const before = Array.isArray(previousValue) ? previousValue.join('; ') : String(previousValue || '');
  try {
    const resp = await window.app.api.post('/agent/edit-draft-section', {
      session_id: sessionId, field, value,
    });
    if (resp.action === 'sent_locked') {
      sentRequestId = resp.request_id || sentRequestId;
      renderAgentResponse(resp);
      syncSentComposerState();
      return { ok: false, error: resp.message || 'отправленное требование доступно только для чтения' };
    }
    if (resp.success === false || resp.action !== 'draft_ready' || !resp.draft) {
      const error = resp.message || 'Сервер не подтвердил сохранение правки.';
      if (!inlineError) addMessage('bot', `Не удалось изменить раздел: ${error}. Текст остался в форме.`, { error: true });
      return { ok: false, error };
    }
    lastDraftChange = { field, label, before, after: value };
    const slot = DRAFT_TO_MAP_SLOT[field] || field;
    document.querySelector(`[data-slot-card="${CSS.escape(slot)}"]`)?.classList.remove('is-editing');
    addMessage('user', `Исправить раздел «${label}»: ${value}`);
    renderAgentResponse(resp);
    return { ok: true };
  } catch (e) {
    const error = formatAgentError(e);
    if (!inlineError) addMessage('bot', `Не удалось изменить раздел: ${error}`, { error: true });
    return { ok: false, error };
  } finally {
    isTyping = false;
    hideTyping();
  }
}

function renderRequestLink(resp, { focus = true, announce = focus } = {}) {
  const container = document.getElementById('agent-chat-messages');
  if (!container || !resp?.request_id) return null;
  const existing = container.querySelector(`[data-request-card="${CSS.escape(String(resp.request_id))}"]`);
  const requestStatus = REQUEST_STATUS_LABELS[resp.request_status] || 'Отправлено на ревью';
  const stickToLatest = isNearChatBottom(container);
  const el = existing || document.createElement('div');
  el.className = 'chat-message chat-message-bot chat-request-created';
  el.dataset.requestCard = String(resp.request_id);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `Запрос #${resp.request_id}: ${requestStatus}`);
  el.innerHTML = `
    <div class="chat-message-avatar chat-request-created-avatar"><i data-lucide="check" aria-hidden="true"></i></div>
    <div class="chat-message-body">
      <div class="chat-task-link">
        <div class="chat-task-link-copy">
          <span><i data-lucide="check" aria-hidden="true"></i> ${escapeHtml(requestStatus)}</span>
          <strong>Запрос #${escapeHtml(resp.request_id)}${resp.request_version ? ` · версия ${escapeHtml(resp.request_version)}` : ''}</strong>
          <small>Требование сохранено. Актуальный этап и комментарии доступны в карточке запроса.</small>
        </div>
        <div class="chat-task-link-actions">
          <a href="${escapeHtml(resp.request_url || `#/customer/request/${encodeURIComponent(resp.request_id)}`)}" data-open-request="${escapeHtml(resp.request_id)}" aria-label="Открыть запрос #${escapeHtml(resp.request_id)}">
            <span>Открыть запрос</span><i data-lucide="arrow-up-right" aria-hidden="true"></i>
          </a>
          <a class="chat-task-link-secondary" href="#/customer">Все мои запросы</a>
        </div>
      </div>
    </div>
  `;
  if (!existing) container.appendChild(el);
  el.querySelector('[data-open-request]')?.addEventListener('click', () => trackAgentUx(window.app, 'request_opened'));
  finishChatAppend(container, stickToLatest, true);
  if (announce) announceChatUpdate(`Запрос #${resp.request_id}: ${requestStatus}.`);
  if (window.lucide) window.lucide.createIcons();
  if (focus) window.requestAnimationFrame(() => el.querySelector('a')?.focus());
  return el;
}

function addMessage(role, content, options = {}) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return null;
  const normalizedContent = (role === 'bot' ? normalizeAgentCopy(content) : String(content || '')).trim();
  const renderedMessages = container.querySelectorAll('.chat-message:not(.chat-typing-indicator)');
  const previous = renderedMessages[renderedMessages.length - 1];
  if (previous?.dataset.messageRole === role
      && previous.dataset.messageContent === normalizedContent) {
    return previous;
  }
  const stickToLatest = role === 'user' || options.forceScroll || isNearChatBottom(container);
  const activity = getChatActivity(role, normalizedContent);
  if (activity?.kind === 'confirmation' && previous?.classList.contains('chat-message-event--change')) {
    previous.classList.add('is-confirmed');
    const label = previous.querySelector('.chat-message-event-label');
    if (label && !label.textContent.includes('сохранено')) label.textContent = `${label.textContent} · сохранено`;
    previous.setAttribute('aria-label', `${activity.label}. Изменение сохранено`);
    previous.dataset.messageConfirmation = normalizedContent;
    return previous;
  }
  const el = document.createElement('div');
  el.className = `chat-message chat-message-${role}`;
  el.dataset.messageRole = role;
  el.dataset.messageContent = normalizedContent;
  if (activity) {
    el.className += ` chat-message-event chat-message-event--${activity.kind}`;
    el.setAttribute('role', options.announce === false ? 'note' : 'status');
    el.setAttribute('aria-label', activity.label);
    el.innerHTML = `
      <i data-lucide="${activity.icon}" aria-hidden="true"></i>
      <span class="chat-message-event-label">${escapeHtml(activity.label)}</span>
    `;
  } else if (role === 'bot') {
    if (options.error && options.announce !== false) el.setAttribute('role', 'alert');
    const contentClass = options.error ? 'chat-message-error' : (options.info ? 'chat-message-info' : '');
    el.innerHTML = `
      <div class="chat-message-avatar"><i data-lucide="bot" style="width:16px;height:16px;"></i></div>
      <div class="chat-message-body">
        <div class="chat-message-header">ИИ-ассистент требований</div>
        <div class="chat-message-content ${contentClass}">
          ${formatContent(normalizedContent)}
        </div>
        ${options.error || options.info || !normalizedContent ? '' : `<div class="chat-answer-actions" aria-label="Действия с ответом">
          <button class="btn btn-secondary btn-sm ui-btn" type="button" data-answer-copy aria-label="Скопировать ответ"><i data-lucide="copy" aria-hidden="true"></i><span>Копировать</span></button>
          <button class="square-icon btn btn-secondary btn-sm ui-btn" type="button" data-answer-feedback="helpful" aria-label="Ответ полезен" aria-pressed="false"><i data-lucide="thumbs-up" aria-hidden="true"></i></button>
          <button class="square-icon btn btn-secondary btn-sm ui-btn" type="button" data-answer-feedback="problem" aria-label="В ответе есть проблема" aria-pressed="false"><i data-lucide="thumbs-down" aria-hidden="true"></i></button>
          <button class="btn btn-secondary btn-sm ui-btn" type="button" data-answer-sources>Контекст</button>
        </div>`}
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
  if (role === 'bot' && !activity) bindAgentMessageActions(el, normalizedContent, options.context || {
    sources: [...currentSources], mode: currentDialogueMode, unavailable: options.announce === false,
  });
  finishChatAppend(container, stickToLatest, role === 'bot');
  if (role === 'bot' && !activity && !options.error && options.announce !== false) announceChatUpdate(normalizedContent);
  if (window.lucide) window.lucide.createIcons();
  return el;
}

function announceChatUpdate(content) {
  const announcer = document.getElementById('chat-live-announcer');
  if (!announcer) return;
  const readable = document.createElement('div');
  readable.innerHTML = formatContent(String(content || ''));
  const plainText = String(readable.textContent || '').replace(/\s+/g, ' ').trim();
  announcer.textContent = '';
  window.requestAnimationFrame(() => { announcer.textContent = plainText; });
}

function normalizeAgentCopy(content) {
  return String(content || '')
    .replace(/Драфт/g, 'Черновик')
    .replace(/драфт/g, 'черновик')
    .replace(/PO\s*\/\s*BA/g, 'владельцу продукта / бизнес-аналитику')
    .replace(/уверенность:\s*medium/gi, 'уверенность: средняя')
    .replace(/уверенность:\s*high/gi, 'уверенность: высокая')
    .replace(/уверенность:\s*low/gi, 'уверенность: низкая');
}

function bindAgentMessageActions(element, content, context) {
  element.querySelector('[data-answer-copy]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(content);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    button.querySelector('span').textContent = 'Скопировано';
    trackAgentUx(window.app, 'answer_copied');
    window.setTimeout(() => { const label = button.querySelector('span'); if (label) label.textContent = 'Копировать'; }, 1400);
  });
  element.querySelectorAll('[data-answer-feedback]').forEach(button => button.addEventListener('click', () => {
    const selected = button.getAttribute('aria-pressed') !== 'true';
    element.querySelectorAll('[data-answer-feedback]').forEach(item => item.setAttribute('aria-pressed', 'false'));
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    trackAgentUx(window.app, 'answer_feedback', { outcome: selected ? button.dataset.answerFeedback : 'ok' });
  }));
  element.querySelector('[data-answer-sources]')?.addEventListener('click', () => {
    const disclosure = document.getElementById('chat-context-disclosure');
    if (!disclosure) return;
    updateTransparencyPanel(context);
    disclosure.open = true;
    disclosure.querySelector('summary')?.focus();
  });
}

export function getChatActivity(role, content) {
  const normalized = String(content || '').trim();
  const changedField = normalized.match(/^Измен[её]н раздел:\s*([a-z_]+)\.?$/i);
  if (role === 'user' && changedField) {
    const slot = DRAFT_TO_MAP_SLOT[changedField[1]] || changedField[1];
    const label = SLOT_LABELS[slot] || 'Требование';
    return { kind: 'change', icon: 'pencil', label: `Обновлено поле «${label}»` };
  }
  if (role === 'user' && /^Исправить раздел «[^»]+»:/.test(normalized)) {
    return { kind: 'change', icon: 'pencil', label: `Обновлено поле «${normalized.match(/^Исправить раздел «([^»]+)»/)[1]}»` };
  }
  if (role === 'bot' && /^Черновик бизнес-требования готов/.test(normalized)) {
    return { kind: 'confirmation', icon: 'check', label: 'Черновик подготовлен — проверьте документ' };
  }
  if (role === 'bot' && /^Раздел обновл[её]н, показатели черновика пересчитаны\.?$/i.test(normalized)) {
    return { kind: 'confirmation', icon: 'check', label: 'Изменение учтено в требовании' };
  }
  return null;
}

function safeAgentHref(value) {
  const href = String(value || '').trim();
  return /^(https?:\/\/|#\/)/i.test(href) ? href : '';
}

function formatInlineMarkdown(value) {
  const tokens = [];
  const token = html => {
    const key = `%%AGENTTOKEN${tokens.length}%%`;
    tokens.push([key, html]);
    return key;
  };
  let prepared = String(value || '')
    .replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safeHref = safeAgentHref(href);
      return safeHref
        ? token(`<a href="${escapeHtml(safeHref)}"${safeHref.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(label)}</a>`)
        : label;
    });
  prepared = escapeHtml(prepared)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');
  tokens.forEach(([key, html]) => { prepared = prepared.replace(key, html); });
  return prepared;
}

export function formatContent(content) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let listType = '';
  let inCode = false;
  let codeLanguage = '';
  let codeLines = [];
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = '';
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      closeList();
      if (inCode) {
        output.push(`<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        codeLanguage = '';
      } else {
        codeLanguage = fence[1] || '';
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || '')) {
      closeList();
      const splitRow = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headers = splitRow(line);
      index += 1;
      const rows = [];
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) rows.push(splitRow(lines[++index]));
      output.push(`<div class="chat-markdown-table-wrap"><table class="ui-table ui-table-prose"><thead><tr>${headers.map(cell => `<th>${formatInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cellIndex) => `<td>${formatInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) { closeList(); output.push(`<${nextType}>`); listType = nextType; }
      output.push(`<li>${formatInlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const level = heading[1].length + 2; output.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`); continue; }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) { output.push(`<blockquote>${formatInlineMarkdown(quote[1])}</blockquote>`); continue; }
    output.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode || codeLines.length) output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return output.join('');
}

export function formatProcessingElapsed(seconds) {
  const elapsed = Math.max(1, Math.round(Number(seconds) || 0));
  if (elapsed < 10) return `Ожидаем ответ · ${elapsed} с`;
  if (elapsed < 30) return `Ответ ещё формируется · ${elapsed} с`;
  return `Это занимает дольше обычного · ${elapsed} с`;
}

function showTyping({ cancellable = false, onCancel = null } = {}) {
  const container = document.getElementById('agent-chat-messages');
  if (!container || document.getElementById('agent-typing-indicator')) return;
  const stickToLatest = isNearChatBottom(container);
  const el = document.createElement('div');
  el.className = 'chat-message chat-message-bot chat-typing-indicator';
  el.id = 'agent-typing-indicator';
  el.innerHTML = `
    <div class="chat-message-avatar"><i data-lucide="bot" style="width:16px;height:16px;"></i></div>
    <div class="chat-message-body">
      <div class="chat-processing-row">
        <div class="chat-typing-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <span class="chat-processing-label" id="chat-processing-label">Ожидаем ответ…</span>
        ${cancellable ? '<button type="button" class="btn btn-secondary btn-sm ui-btn chat-stop-waiting" id="chat-stop-waiting">Остановить ожидание</button>' : ''}
      </div>
    </div>
  `;
  container.appendChild(el);
  const startedAt = Date.now();
  window.clearInterval(typingElapsedTimer);
  announceChatUpdate('Ассистент формирует ответ.');
  typingElapsedTimer = window.setInterval(() => {
    const label = document.getElementById('chat-processing-label');
    if (!label) return;
    const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    label.textContent = formatProcessingElapsed(seconds);
    if (seconds === 10 || seconds === 30) announceChatUpdate(label.textContent);
  }, 1000);
  el.querySelector('#chat-stop-waiting')?.addEventListener('click', event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Останавливаем…';
    onCancel?.();
  }, { once: true });
  const status = document.getElementById('agent-service-status');
  if (status) status.textContent = 'Ожидаем ответ…';
  const input = document.getElementById('agent-chat-input');
  const sendBtn = document.getElementById('agent-chat-send-btn');
  if (input) { input.readOnly = Boolean(sentRequestId); input.setAttribute('aria-busy', 'true'); }
  if (sendBtn) sendBtn.disabled = true;
  updateEarlyDraftAction();
  if (stickToLatest) scrollChatToLatest();
  if (window.lucide) window.lucide.createIcons();
}

function hideTyping() {
  window.clearInterval(typingElapsedTimer);
  typingElapsedTimer = null;
  const el = document.getElementById('agent-typing-indicator');
  if (el) el.remove();
  const status = document.getElementById('agent-service-status');
  if (status) status.textContent = NORMAL_AGENT_STATUS;
  const input = document.getElementById('agent-chat-input');
  const sendBtn = document.getElementById('agent-chat-send-btn');
  if (input) { input.readOnly = Boolean(sentRequestId); input.removeAttribute('aria-busy'); }
  if (sendBtn) sendBtn.disabled = Boolean(sentRequestId) || !input?.value.trim() || navigator.onLine === false;
  syncSentComposerState();
  updateEarlyDraftAction();
}

function attachRetryButton(value, errorMessage = null, messageId = null) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return;
  const userMessages = container.querySelectorAll('.chat-message-user');
  const last = userMessages[userMessages.length - 1];
  if (!last) return;

  const body = errorMessage?.querySelector('.chat-message-body') || last.querySelector('.chat-message-body');
  if (!body) return;

  const existing = body.querySelector('.chat-retry-btn');
  if (existing) {
    if (errorMessage) retryErrorMessages.set(existing, errorMessage);
    existing.disabled = false;
    existing.removeAttribute('aria-busy');
    existing.title = 'Повторить отправку';
    existing.setAttribute('aria-label', 'Повторить отправку');
    existing.innerHTML = '<i data-lucide="rotate-ccw" aria-hidden="true"></i><span>Повторить</span>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary btn-sm chat-retry-btn';
  btn.type = 'button';
  btn.title = 'Повторить отправку';
  btn.setAttribute('aria-label', 'Повторить отправку');
  btn.innerHTML = '<i data-lucide="rotate-ccw" aria-hidden="true"></i><span>Повторить</span>';
  if (errorMessage) retryErrorMessages.set(btn, errorMessage);
  btn.addEventListener('click', () => {
    retryErrorMessages.get(btn)?.remove();
    retryErrorMessages.delete(btn);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.title = 'Повторная отправка…';
    btn.setAttribute('aria-label', 'Повторная отправка…');
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin" aria-hidden="true"></i><span>Отправляем…</span>';
    if (window.lucide) window.lucide.createIcons();
    performChat(window.app, value, messageId || newMessageId());
  });
  body.appendChild(btn);
  if (window.lucide) window.lucide.createIcons();
}

export function isNearChatBottom(container, threshold = 96) {
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function finishChatAppend(container, stickToLatest, assistantContent = false) {
  if (stickToLatest) {
    scrollChatToLatest();
    return;
  }
  if (assistantContent) {
    unreadAssistantMessages += 1;
    updateScrollLatestButton();
  }
}

function scrollChatToLatest(smooth = false) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return;
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    container.scrollTop = container.scrollHeight;
  }
  clearUnreadMessages();
}

function clearUnreadMessages() {
  unreadAssistantMessages = 0;
  updateScrollLatestButton();
}

function updateScrollLatestButton() {
  const button = document.getElementById('chat-scroll-latest');
  const label = document.getElementById('chat-scroll-latest-label');
  if (!button) return;
  button.hidden = unreadAssistantMessages === 0;
  if (label) label.textContent = unreadAssistantMessages
    ? `${unreadAssistantMessages} ${pluralizeNewMessages(unreadAssistantMessages)}`
    : 'К последним сообщениям';
}

function pluralizeNewMessages(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'новое сообщение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'новых сообщения';
  return 'новых сообщений';
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
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function updateChatInputMeta(textarea) {
  const count = document.getElementById('chat-input-count');
  if (!textarea || !count) return;
  const max = Number(textarea.maxLength) || 4000;
  const length = textarea.value.length;
  count.textContent = `${length} / ${max}`;
  count.classList.toggle('is-near-limit', length >= max * 0.9);
}

function bindComposerSize() {
  composerResizeObserver?.disconnect();
  composerResizeObserver = null;
  const card = document.querySelector('.chat-container-card');
  const composer = document.querySelector('.chat-input-area');
  if (!card || !composer) return;
  const sync = () => card.style.setProperty('--chat-composer-height', `${composer.offsetHeight}px`);
  sync();
  if (typeof ResizeObserver === 'function') {
    composerResizeObserver = new ResizeObserver(sync);
    composerResizeObserver.observe(composer);
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
