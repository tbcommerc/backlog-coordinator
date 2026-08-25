/**
 * DMB AI Business Analyst Assistant - chat widget.
 * Multi-turn dialogue that collects a business requirement and, after
 * confirmation, creates a real task (send-for-review).
 */
let isTyping = false;
let sessionId = null;
let currentDraft = null;
let sentRequestId = null;
let currentSlots = {};
let currentProgress = [];
let currentExpectedSlot = '';
let sessionHistoryMode = 'active';

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

  return `
    <div class="chat-wrapper">
      <div class="chat-layout">
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
              <button class="btn btn-secondary btn-sm" id="agent-chat-clear-btn" aria-label="Создать новое требование" title="Новое требование">
                <i data-lucide="file-plus-2" style="width:14px;height:14px;"></i>
                <span>Новое требование</span>
              </button>
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
          <button class="chat-mobile-tab" data-chat-view="requirement" role="tab" aria-selected="false">Требование <span id="requirement-tab-count"></span></button>
        </div>

        <aside class="chat-sidebar" id="chat-requirement-pane" aria-label="Карта требования">
          <div class="chat-sessions-card">
            <div class="chat-sessions-header">
              <i data-lucide="history" style="width:16px;height:16px;color:var(--primary);"></i>
              <span id="chat-sessions-title">История требований</span>
            </div>
            <div class="chat-sessions-tabs" role="tablist" aria-label="Фильтр истории">
              <button class="chat-sessions-tab active" data-session-mode="active" role="tab" aria-selected="true"><i data-lucide="messages-square"></i><span>Активные</span></button>
              <button class="chat-sessions-tab" data-session-mode="archive" role="tab" aria-selected="false"><i data-lucide="archive"></i><span>Архив</span></button>
            </div>
            <div class="chat-sessions-list" id="chat-sessions-list">
              <div class="chat-sessions-empty">Загрузка...</div>
            </div>
          </div>

          <div class="requirement-map-card" id="requirement-map-card" style="display:none;">
            <div class="requirement-map-header">
              <div><h2>Что уже собрано</h2><span class="requirement-map-caption">Поля можно исправлять по ходу диалога</span></div>
              <span class="badge badge-info" id="requirement-map-status">Не начато</span>
            </div>
            <div class="requirement-map-empty" id="requirement-map-empty">Здесь появятся факты, которые понял ассистент. Их можно будет исправить в любой момент.</div>
            <div class="requirement-map-fields" id="requirement-map-fields"></div>
          </div>

          <div class="chat-draft-panel" id="chat-draft-panel" style="display:none;">
            <div class="chat-draft-panel-header">
              <i data-lucide="file-text" style="width:16px;height:16px;color:var(--success);"></i>
              <span>Проверка и отправка</span>
            </div>
            <div class="chat-draft-panel-content" id="chat-draft-panel-content"></div>
            <div class="chat-draft-panel-actions" id="chat-draft-panel-actions"></div>
          </div>

          <div class="chat-progress-card" id="chat-progress-card">
            <div class="chat-progress-header">
              <i data-lucide="clipboard-check" style="width:16px;height:16px;color:var(--primary);"></i>
              <span>Готовность требования</span>
            </div>
            <div class="chat-progress-bar">
              <div class="chat-progress-bar-fill" id="chat-progress-fill" style="width:0%"></div>
            </div>
            <div class="chat-progress-text" id="chat-progress-text">Опишите потребность, чтобы начать</div>
            <div class="chat-progress-list" id="chat-progress-list" hidden></div>
          </div>

        </aside>
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
  bindWorkspaceControls();
  document.querySelectorAll('[data-session-mode]').forEach(btn => btn.addEventListener('click', () => {
    sessionHistoryMode = btn.dataset.sessionMode;
    document.querySelectorAll('[data-session-mode]').forEach(item => {
      const selected = item === btn;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    loadSessions(app);
  }));

  if (window.lucide) window.lucide.createIcons();

  try {
    const state = await app.api.get('/agent/session');
    if (state && state.active && state.session_id) {
      sessionId = state.session_id;
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

  loadSessions(app);
}

async function loadSessions(app) {
  const list = document.getElementById('chat-sessions-list');
  if (!list) return;
  try {
    const data = await app.api.get('/agent/sessions');
    const sessions = data.sessions || [];
    const visibleSessions = sessions.filter(s => sessionHistoryMode === 'archive' ? s.archived : !s.archived);
    if (!visibleSessions.length) {
      const title = document.getElementById('chat-sessions-title');
      if (title) title.textContent = 'История требований';
      list.innerHTML = `<div class="chat-sessions-empty">${sessionHistoryMode === 'archive' ? 'Архив пуст' : 'Нет активных диалогов'}</div>`;
      return;
    }
    const title = document.getElementById('chat-sessions-title');
    if (title) title.textContent = `История требований · ${visibleSessions.length}`;
    list.innerHTML = visibleSessions.map(s => `
      <div class="chat-session-row${s.active ? ' active' : ''}">
        <button class="chat-session-item" data-session-id="${escapeHtml(s.session_id)}">
          <div class="chat-session-title">${escapeHtml(s.title)}</div>
          <div class="chat-session-meta">${escapeHtml(
            s.phase === 'welcome' && s.title !== 'Новый диалог'
              ? ''
              : (PHASE_LABELS[s.phase] || 'В работе')
          )}</div>
        </button>
        <button class="chat-session-archive" data-archive-session="${escapeHtml(s.session_id)}" data-archived="${s.archived ? 'true' : 'false'}" aria-label="${s.archived ? 'Вернуть из архива' : 'Переместить в архив'}" title="${s.archived ? 'Вернуть из архива' : 'В архив'}">
          <i data-lucide="${s.archived ? 'archive-restore' : 'archive'}"></i>
        </button>
      </div>
    `).join('');
    list.querySelectorAll('[data-session-id]').forEach(btn => {
      btn.addEventListener('click', () => switchSession(app, btn.dataset.sessionId));
    });
    list.querySelectorAll('[data-archive-session]').forEach(btn => {
      btn.addEventListener('click', () => setSessionArchived(app, btn.dataset.archiveSession, btn.dataset.archived !== 'true'));
    });
    if (window.lucide) window.lucide.createIcons();
  } catch (_) {
    list.innerHTML = `<div class="chat-sessions-empty chat-message-error">Не удалось загрузить диалоги.<br>
      <button class="btn btn-secondary btn-sm" id="chat-sessions-retry">Повторить</button></div>`;
    list.querySelector('#chat-sessions-retry')?.addEventListener('click', () => loadSessions(app));
  }
}

async function setSessionArchived(app, targetSessionId, archived) {
  try {
    await app.api.post(`/agent/session/${encodeURIComponent(targetSessionId)}/archive?archived=${archived}`);
    if (archived && targetSessionId === sessionId) {
      currentDraft = null;
      sentRequestId = null;
      await newDialog(app);
      return;
    }
    await loadSessions(app);
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
    loadSessions(app);
  } catch (e) {
    addMessage('bot', `Не удалось открыть диалог: ${e.message}`, { error: true });
  }
}

async function newDialog(app) {
  if (currentDraft && !sentRequestId && !window.confirm('Текущий черновик ещё не отправлен. Создать новый диалог?')) return;
  const btn = document.getElementById('agent-chat-clear-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;" class="animate-spin"></i>';
    if (window.lucide) window.lucide.createIcons();
  }
  try {
    const resp = await app.api.post('/agent/new-dialog');
    sessionId = resp.session_id || null;
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
  (history || []).forEach(entry => {
    if (entry.role === 'user') addMessage('user', entry.content || '');
    else if (entry.role === 'assistant') addMessage('bot', entry.content || '');
  });
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

  addMessage('user', message);
  document.getElementById('agent-chat-input').value = '';
  autoResize(document.getElementById('agent-chat-input'));
  document.getElementById('agent-chat-send-btn').disabled = true;

  await performChat(app, message);
}

async function performChat(app, value) {
  if (isTyping) return;
  showTyping();
  isTyping = true;
  let failed = false;
  try {
    const payload = { message: value };
    if (sessionId) payload.session_id = sessionId;
    const resp = await app.api.post('/agent/chat', payload);
    sessionId = resp.session_id || sessionId;
    renderAgentResponse(resp);
    loadSessions(app);
    removeRetryButtons();
  } catch (e) {
    failed = true;
    addMessage('bot', `Ошибка связи с ассистентом: ${e.message}. Попробуйте ещё раз.`, { error: true });
    attachRetryButton(value);
  } finally {
    hideTyping();
    if (failed) {
      const status = document.getElementById('agent-service-status');
      if (status) status.textContent = 'Связь потеряна — можно повторить';
    }
    isTyping = false;
  }
}

function renderAgentResponse(resp) {
  if (resp.draft) currentDraft = resp.draft;
  updateRequirementWorkspace(resp);
  addMessage('bot', resp.message || '', { error: resp.action === 'unavailable' });

  if (resp.action === 'unavailable') {
    const status = document.getElementById('agent-service-status');
    if (status) status.textContent = 'ИИ-модель недоступна';
  }

  if (resp.action === 'refused') {
    addMessage('bot', 'Если запрос ошибочный — извините. В рамках платформы я помогаю только с требованиями.', { error: true });
  }

  // Update progress panel
  if (resp.progress && resp.progress.length > 0) {
    updateProgressPanel(resp.progress, resp.quality);
  }

  (resp.blocks || []).forEach(block => {
    if (block.type === 'draft_preview' && block.draft) {
      showDraftPanel(resp.draft, resp.session_id);
    } else if (block.type === 'actions' && block.buttons) {
      showDraftPanel(resp.draft, resp.session_id);
    }
  });

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
  const fill = document.getElementById('chat-progress-fill');
  const text = document.getElementById('chat-progress-text');
  const list = document.getElementById('chat-progress-list');
  
  if (!card || !progress) return;
  
  const filled = progress.filter(p => p.filled).length;
  const total = progress.length;
  const percent = Number.isFinite(quality.score)
    ? Math.round(quality.score)
    : (total ? Math.round((filled / total) * 100) : 0);
  
  fill.style.width = percent + '%';
  const requiredKeys = ['need_statement', 'to_be', 'role', 'process', 'acceptance_criteria'];
  const missingRequired = requiredKeys.filter(key => {
    const item = progress.find(p => p.key === key || p.slot === key);
    return !item || (!item.filled && !item.skipped);
  }).length;
  text.textContent = !filled
    ? 'Опишите потребность, чтобы начать'
    : (missingRequired
      ? `Нужно уточнить ещё ${missingRequired} ${pluralizePoints(missingRequired)}`
      : 'Можно сформировать черновик');
  
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

function updateRequirementWorkspace(resp = {}) {
  currentSlots = resp.slots || currentSlots || {};
  currentProgress = resp.progress || currentProgress || [];
  currentExpectedSlot = resp.expected_slot || '';
  const fields = document.getElementById('requirement-map-fields');
  const mapCard = document.getElementById('requirement-map-card');
  const requirementPane = document.getElementById('chat-requirement-pane');
  const empty = document.getElementById('requirement-map-empty');
  const status = document.getElementById('requirement-map-status');
  const count = document.getElementById('requirement-tab-count');
  const entries = Object.entries(currentSlots).filter(([, value]) => value !== null && value !== undefined && String(value).trim());
  const filledKeys = new Set(entries.map(([key]) => key));
  if (fields) {
    fields.innerHTML = REQUIREMENT_MAP_SLOTS.map(key => {
      const value = currentSlots[key];
      const filled = filledKeys.has(key);
      const progress = currentProgress.find(item => item.key === key || item.slot === key) || {};
      const review = progress.needs_review;
      const displayValue = filled ? (Array.isArray(value) ? value.join('; ') : value) : 'Не заполнено';
      return `<div class="requirement-map-field${review ? ' needs-review' : ''}${filled ? '' : ' is-empty'}">
        <div class="requirement-map-field-head"><span>${escapeHtml(SLOT_LABELS[key] || key)}</span>
          <button class="requirement-map-edit" data-edit-slot="${escapeHtml(key)}" aria-label="Исправить поле ${escapeHtml(SLOT_LABELS[key] || key)}"><i data-lucide="pencil"></i></button>
        </div>
        <div class="requirement-map-value">${escapeHtml(displayValue)}</div>
        ${review ? '<div class="requirement-map-warning">Нужно проверить формулировку</div>' : ''}
      </div>`;
    }).join('');
    fields.querySelectorAll('[data-edit-slot]').forEach(btn => btn.addEventListener('click', () => editRequirementField(btn.dataset.editSlot)));
  }
  if (empty) empty.style.display = entries.length ? 'none' : 'block';
  if (fields) fields.style.display = entries.length ? 'grid' : 'none';
  if (mapCard) mapCard.style.display = entries.length ? 'flex' : 'none';
  if (requirementPane) requirementPane.classList.toggle('has-requirement-map', Boolean(entries.length));
  if (status) status.textContent = currentDraft ? 'Черновик готов' : (entries.length ? 'Собираем' : 'Не начато');
  if (count) count.textContent = entries.length ? `· ${entries.length}` : '';
  updateCurrentQuestion(resp.message, currentExpectedSlot);
  if (resp.progress) updateProgressPanel(resp.progress, resp.quality || {});
  if (window.lucide) window.lucide.createIcons();
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
  if (currentDraft) {
    const draftField = { need_statement: 'problem_statement', as_is: 'current_process', to_be: 'target_process', value: 'business_value', role: 'user_roles', users: 'user_roles' }[slot] || slot;
    showSectionEditModal(currentDraft, draftField);
    return;
  }
  const input = document.getElementById('agent-chat-input');
  if (!input) return;
  input.value = `Исправить «${SLOT_LABELS[slot] || slot}»: `;
  autoResize(input);
  input.focus();
  document.getElementById('agent-chat-send-btn').disabled = false;
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
  }));
}

function showDraftPanel(draft, sessionId) {
  const panel = document.getElementById('chat-draft-panel');
  const content = document.getElementById('chat-draft-panel-content');
  const actions = document.getElementById('chat-draft-panel-actions');
  
  if (!panel || !draft) return;
  
  panel.style.display = 'block';
  
  const esc = escapeHtml;
  content.innerHTML = `
    <div class="chat-draft-panel-title">${esc(draft.title || 'Драфт требования')}</div>
    <div class="chat-draft-panel-meta">
      <span class="badge badge-medium">Полнота: ${draft.completeness_score || 0}%</span>
      <span class="badge badge-info">Качество: ${draft.quality_score || 0}%</span>
      <span class="badge badge-low">Уверенность: ${esc(CONFIDENCE_LABELS[draft.confidence] || draft.confidence || '—')}</span>
    </div>
    <div class="chat-draft-ready-note">Проверьте карту требования выше. Замечания качества и открытые вопросы будут доступны перед отправкой.</div>
  `;
  
  actions.innerHTML = `
    <button class="btn btn-primary btn-sm" data-draft-action="send_review" style="width:100%;">
      <i data-lucide="send" style="width:14px;height:14px;"></i>
      Отправить на ревью
    </button>
    <button class="btn btn-secondary btn-sm" data-draft-action="edit" style="width:100%;margin-top:8px;">
      <i data-lucide="edit-2" style="width:14px;height:14px;"></i>
      Внести правки
    </button>
  `;
  
  actions.querySelectorAll('[data-draft-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.draftAction === 'edit') {
        showSectionEditModal(draft);
        return;
      }
      if (btn.dataset.draftAction === 'send_review') {
        await showTeamSelectModal(sessionId, draft, btn);
      }
    });
  });
  
  if (window.lucide) window.lucide.createIcons();
}

function hideDraftPanel() {
  const panel = document.getElementById('chat-draft-panel');
  if (panel) panel.style.display = 'none';
}

function renderDraftCard(draft) {
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
      <div class="chat-draft-meta">
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
        <p class="text-muted" style="margin-top:0;">Проверьте содержание, особенно открытые вопросы, допущения и противоречия.</p>
        <div style="max-height:45vh;overflow:auto;margin-bottom:var(--space-4);">${renderDraftCard(draft)}</div>
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
    addMessage('user', `Исправить раздел «${label}»: ${text}`);
    showTyping();
    try {
      const resp = await window.app.api.post('/agent/edit-draft-section', {
        session_id: sessionId, field: select.value, value: text,
      });
      renderAgentResponse(resp);
    } catch (e) {
      addMessage('bot', `Не удалось изменить раздел: ${e.message}`, { error: true });
    } finally {
      hideTyping();
    }
  });
}

function renderRequestLink(resp) {
  const container = document.getElementById('agent-chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-message chat-message-bot';
  el.innerHTML = `
    <div class="chat-message-avatar"><i data-lucide="check-circle" style="width:16px;height:16px;"></i></div>
    <div class="chat-message-body">
      <div class="chat-task-link">
        <i data-lucide="external-link" style="width:14px;height:14px;"></i>
        <a href="#/customer/request/${resp.request_id}">
          Запрос #${resp.request_id} создан — открыть
        </a>
      </div>
    </div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function addMessage(role, content, options = {}) {
  const container = document.getElementById('agent-chat-messages');
  const el = document.createElement('div');
  el.className = `chat-message chat-message-${role}`;
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

function attachRetryButton(value) {
  const container = document.getElementById('agent-chat-messages');
  if (!container) return;
  const userMessages = container.querySelectorAll('.chat-message-user');
  const last = userMessages[userMessages.length - 1];
  if (!last) return;

  const body = last.querySelector('.chat-message-body');
  if (!body || body.querySelector('.chat-retry-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary btn-sm chat-retry-btn';
  btn.innerHTML = '<i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i> Повторить';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    performChat(window.app, value);
  });
  body.appendChild(btn);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
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
