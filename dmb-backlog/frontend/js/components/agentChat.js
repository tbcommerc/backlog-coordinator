/**
 * DMB AI Business Analyst Assistant - chat widget.
 * Multi-turn dialogue that collects a business requirement and, after
 * confirmation, creates a real task (send-for-review).
 */
console.log('[DMB] agentChat.js loaded');

let isTyping = false;
let sessionId = null;

export function renderAgentChat(app) {
  const user = app.store.get('currentUser');
  const userName = user?.name?.split(' ')[0] || 'Заказчик';

  return `
    <div class="page-header animate-fade-in">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:var(--space-1);">
        <a href="#/customer" class="btn btn-secondary btn-sm">
          <i data-lucide="arrow-left" style="width:14px;height:14px;"></i>
        </a>
        <h1>ИИ-ассистент</h1>
        <div class="tooltip-wrapper">
          <button class="tooltip-trigger" id="help-tooltip-btn" title="Как это работает">
            <i data-lucide="help-circle" style="width:18px;height:18px;"></i>
          </button>
          <div class="tooltip-content" id="help-tooltip">
            <div class="tooltip-title">Как это работает</div>
            <ul class="tooltip-list">
              <li>Ассистент уточняет суть потребности</li>
              <li>Собирает контекст, процесс и сценарии</li>
              <li>Готовит драфт и отправляет на ревью</li>
              <li>Решение всегда принимает человек</li>
            </ul>
          </div>
        </div>
      </div>
      <p>Ассистент задаст вопросы, соберёт бизнес-требование и оформит задачу для ревью</p>
    </div>

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
                    Онлайн
                  </div>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" id="agent-chat-clear-btn" aria-label="Начать заново">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
              </button>
            </div>

            <div class="chat-messages" id="agent-chat-messages">
              ${renderAgentWelcome(userName)}
            </div>

            <div class="chat-input-area">
              <div class="chat-input-wrapper">
                <textarea
                  id="agent-chat-input"
                  class="chat-input"
                  placeholder="Опишите проблему или доработку..."
                  rows="1"
                ></textarea>
                <button class="btn btn-primary chat-send-btn" id="agent-chat-send-btn" disabled>
                  <i data-lucide="send" style="width:16px;height:16px;"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-sidebar">
          <div class="chat-progress-card" id="chat-progress-card" style="display:none;">
            <div class="chat-progress-header">
              <i data-lucide="activity" style="width:16px;height:16px;color:var(--primary);"></i>
              <span>Прогресс сбора</span>
            </div>
            <div class="chat-progress-bar">
              <div class="chat-progress-bar-fill" id="chat-progress-fill" style="width:0%"></div>
            </div>
            <div class="chat-progress-text" id="chat-progress-text">0%</div>
            <div class="chat-progress-list" id="chat-progress-list"></div>
          </div>

          <div class="chat-draft-panel" id="chat-draft-panel" style="display:none;">
            <div class="chat-draft-panel-header">
              <i data-lucide="file-text" style="width:16px;height:16px;color:var(--success);"></i>
              <span>Черновик требования</span>
            </div>
            <div class="chat-draft-panel-content" id="chat-draft-panel-content"></div>
            <div class="chat-draft-panel-actions" id="chat-draft-panel-actions"></div>
          </div>

          <div class="chat-sessions-card">
            <div class="chat-sessions-header">
              <i data-lucide="message-square" style="width:16px;height:16px;color:var(--primary);"></i>
              <span>Диалоги</span>
              <button class="btn btn-primary btn-sm chat-new-dialog-btn" id="chat-new-dialog-btn" title="Новый диалог">
                <i data-lucide="plus" style="width:14px;height:14px;"></i>
              </button>
            </div>
            <div class="chat-sessions-list" id="chat-sessions-list">
              <div class="chat-sessions-empty">Загрузка...</div>
            </div>
          </div>
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
        Опишите задачу в свободной форме — я уточню детали и подготовлю черновик требования.
      </div>
      <div class="chat-welcome-hints">
        <div class="chat-welcome-hint-title">Что описать:</div>
        <ul class="chat-welcome-hint-list">
          <li>Какую проблему нужно решить?</li>
          <li>Для кого (роль пользователя)?</li>
          <li>Какой процесс затронут?</li>
        </ul>
        <div class="chat-welcome-example">
          <div class="chat-welcome-example-title">Например:</div>
          <div class="chat-welcome-example-text">
            "Бэк-офицерам нужен реестр несостоявшихся расчётов по облигациям, чтобы не искать их вручную в отчётах"
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function initAgentChat(app) {
  isTyping = false;
  sessionId = null;

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

  // Tooltip: toggle по клику
  const tooltipBtn = document.getElementById('help-tooltip-btn');
  const tooltip = document.getElementById('help-tooltip');

  tooltipBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    tooltip?.classList.toggle('show');
  });

  // Закрытие по клику вне tooltip
  document.addEventListener('click', (e) => {
    if (tooltip && !tooltip.contains(e.target) && e.target !== tooltipBtn && !tooltipBtn?.contains(e.target)) {
      tooltip.classList.remove('show');
    }
  });

  // Закрытие по Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      tooltip?.classList.remove('show');
    }
  });

  if (window.lucide) window.lucide.createIcons();

  const newDialogBtn = document.getElementById('chat-new-dialog-btn');
  console.log('[DMB] chat-new-dialog-btn found:', !!newDialogBtn);
  if (newDialogBtn) {
    newDialogBtn.addEventListener('click', (e) => {
      console.log('[DMB] chat-new-dialog-btn clicked');
      e.preventDefault();
      e.stopPropagation();
      newDialog(app);
    });
  }

  try {
    const state = await app.api.get('/agent/session');
    if (state && state.active && state.session_id) {
      sessionId = state.session_id;
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
    if (!sessions.length) {
      list.innerHTML = '<div class="chat-sessions-empty">Нет диалогов</div>';
      return;
    }
    list.innerHTML = sessions.map(s => `
      <button class="chat-session-item${s.active ? ' active' : ''}" data-session-id="${escapeHtml(s.session_id)}">
        <div class="chat-session-title">${escapeHtml(s.title)}</div>
        <div class="chat-session-meta">${escapeHtml(s.phase || '')}</div>
      </button>
    `).join('');
    list.querySelectorAll('[data-session-id]').forEach(btn => {
      btn.addEventListener('click', () => switchSession(app, btn.dataset.sessionId));
    });
  } catch (_) {
    list.innerHTML = '<div class="chat-sessions-empty">Нет диалогов</div>';
  }
}

async function switchSession(app, session_id) {
  if (session_id === sessionId) return;
  try {
    const state = await app.api.get('/agent/session/' + session_id);
    sessionId = state.session_id || session_id;
    const container = document.getElementById('agent-chat-messages');
    container.innerHTML = '';
    if (state.history && state.history.length) {
      renderHistory(state.history);
    }
    if (state.draft && state.phase === 'draft_ready') {
      appendDraftResume(state.draft);
    }
    if (window.lucide) window.lucide.createIcons();
    loadSessions(app);
  } catch (_) { /* ignore */ }
}

async function newDialog(app) {
  console.log('[DMB] newDialog called');
  const btn = document.getElementById('chat-new-dialog-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;" class="animate-spin"></i>';
    if (window.lucide) window.lucide.createIcons();
  }
  try {
    const resp = await app.api.post('/agent/new-dialog');
    console.log('[DMB] newDialog response:', resp);
    sessionId = resp.session_id || null;
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
    addMessage('bot', 'Создан новый диалог. Опишите вашу потребность, и я помогу сформировать требование.', { info: true });
  } catch (e) {
    console.error('[DMB] newDialog error:', e);
    addMessage('bot', `Ошибка создания диалога: ${e.message}`, { error: true });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="plus" style="width:14px;height:14px;"></i>';
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
  const container = document.getElementById('agent-chat-messages');
  const el = document.createElement('div');
  el.className = 'chat-message chat-message-bot';
  el.innerHTML = `
    <div class="chat-message-avatar"><i data-lucide="bot" style="width:16px;height:16px;"></i></div>
    <div class="chat-message-body">
      <div class="chat-message-header">AI Business Analyst</div>
      ${opts.intro ? `<div class="chat-message-content">${opts.intro}</div>` : ''}
      ${renderDraftCard(draft)}
    </div>
  `;
  container.appendChild(el);
  renderDraftActions(sessionId, draft);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
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
  try {
    const payload = { message: value };
    if (sessionId) payload.session_id = sessionId;
    const resp = await app.api.post('/agent/chat', payload);
    sessionId = resp.session_id || sessionId;
    renderAgentResponse(resp);
    loadSessions(app);
    removeRetryButtons();
  } catch (e) {
    addMessage('bot', `Ошибка связи с ассистентом: ${e.message}. Попробуйте ещё раз.`, { error: true });
    attachRetryButton(value);
  } finally {
    hideTyping();
    isTyping = false;
  }
}

function renderAgentResponse(resp) {
  addMessage('bot', resp.message || '');

  if (resp.action === 'refused') {
    addMessage('bot', 'Если запрос ошибочный — извините. В рамках платформы я помогаю только с требованиями.', { error: true });
  }

  // Update progress panel
  if (resp.progress && resp.progress.length > 0) {
    updateProgressPanel(resp.progress);
  }

  (resp.blocks || []).forEach(block => {
    if (block.type === 'chips' && block.options) {
      renderChips(block.options);
    } else if (block.type === 'draft_preview' && block.draft) {
      renderDraftCard(block.draft);
      // Show sticky draft panel
      showDraftPanel(resp.draft, resp.session_id);
    } else if (block.type === 'actions' && block.buttons) {
      renderDraftActions(resp.session_id, resp.draft, block.buttons);
    }
  });

  if (resp.action === 'sent' && resp.request_id) {
    renderRequestLink(resp);
    hideDraftPanel();
  }

  const container = document.getElementById('agent-chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function updateProgressPanel(progress) {
  const card = document.getElementById('chat-progress-card');
  const fill = document.getElementById('chat-progress-fill');
  const text = document.getElementById('chat-progress-text');
  const list = document.getElementById('chat-progress-list');
  
  if (!card || !progress) return;
  
  card.style.display = 'block';
  
  const filled = progress.filter(p => p.filled).length;
  const total = progress.length;
  const percent = Math.round((filled / total) * 100);
  
  fill.style.width = percent + '%';
  text.textContent = percent + '%';
  
  list.innerHTML = progress.map(p => {
    const icon = p.filled ? 'check-circle' : (p.skipped ? 'minus-circle' : 'circle');
    const color = p.filled ? 'var(--success)' : (p.skipped ? 'var(--text-muted)' : 'var(--text-secondary)');
    return `
      <div class="chat-progress-item">
        <i data-lucide="${icon}" style="width:14px;height:14px;color:${color};"></i>
        <span>${escapeHtml(p.label)}</span>
      </div>
    `;
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

function showDraftPanel(draft, sessionId) {
  const panel = document.getElementById('chat-draft-panel');
  const content = document.getElementById('chat-draft-panel-content');
  const actions = document.getElementById('chat-draft-panel-actions');
  
  if (!panel || !draft) return;
  
  panel.style.display = 'block';
  
  const esc = escapeHtml;
  const rows = [];
  if (draft.problem_statement) rows.push(['Проблема', draft.problem_statement]);
  if (draft.user_roles?.length) rows.push(['Роль', draft.user_roles.join(', ')]);
  if (draft.product) rows.push(['Продукт', draft.product]);
  if (draft.module) rows.push(['Модуль', draft.module]);
  
  content.innerHTML = `
    <div class="chat-draft-panel-title">${esc(draft.title || 'Драфт требования')}</div>
    <div class="chat-draft-panel-meta">
      <span class="badge badge-medium">Полнота: ${draft.completeness_score || 0}%</span>
      <span class="badge badge-low">Уверенность: ${esc(draft.confidence || '—')}</span>
    </div>
    <div class="chat-draft-panel-rows">
      ${rows.map(([k, v]) => `
        <div class="chat-draft-panel-row">
          <span class="chat-draft-panel-key">${esc(k)}</span>
          <span class="chat-draft-panel-val">${esc(v)}</span>
        </div>
      `).join('')}
    </div>
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
        addMessage('user', 'Внести правки');
        await sendRaw('нет');
        hideDraftPanel();
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

function renderChips(options) {
  const container = document.getElementById('agent-chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'chat-chips-row';
  wrap.innerHTML = options.map(opt => `
    <button class="chip" data-chip-value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</button>
  `).join('');
  container.appendChild(wrap);
  wrap.querySelectorAll('[data-chip-value]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.chipValue;
      addMessage('user', btn.textContent.trim());
      sendRaw(val);
    });
  });
  container.scrollTop = container.scrollHeight;
}

async function sendRaw(value) {
  await performChat(window.app, value);
}

function renderDraftCard(draft) {
  const esc = escapeHtml;
  const rows = [];
  rows.push(['Проблема', draft.problem_statement]);
  rows.push(['Целевой процесс (To-Be)', draft.target_process]);
  rows.push(['Бизнес-ценность', draft.business_value]);
  rows.push(['Пользователи', (draft.user_roles || []).join(', ')]);
  rows.push(['Продукт', draft.product]);
  rows.push(['Модуль', draft.module]);
  rows.push(['Сценарии', (draft.scenarios || []).join('; ')]);
  rows.push(['Бизнес-правила', (draft.business_rules || []).join('; ')]);
  rows.push(['Данные и интеграции', (draft.data_integrations || []).join('; ')]);
  rows.push(['Критерии приёмки', (draft.acceptance_criteria || []).join('; ')]);
  rows.push(['Открытые вопросы', (draft.open_questions || []).join('; ')]);
  rows.push(['Допущения', (draft.assumptions || []).join('; ')]);

  return `
    <div class="chat-draft-card">
      <div class="chat-draft-title">${esc(draft.title || 'Драфт требования')}</div>
      <div class="chat-draft-meta">
        <span class="badge badge-info">${esc(draft.status || 'Draft')}</span>
        <span class="badge badge-medium">Полнота: ${draft.completeness_score || 0}%</span>
        <span class="badge badge-low">Уверенность: ${esc(draft.confidence || '—')}</span>
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
        addMessage('user', 'Внести правки');
        await sendRaw('нет');
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
    <div class="modal" style="max-width:420px;">
      <div class="modal-header">
        <h3>Выбор команды для ревью</h3>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <label class="form-label">К какой команде относится запрос?</label>
        <select id="team-select" class="input" style="width:100%;">
          <option value="">— Не знаю / пропустить —</option>
          ${options}
        </select>
        <p class="text-muted" style="font-size:var(--text-xs);margin-top:var(--space-2);">
          Запрос будет направлен на ревью PO/PL/CL выбранной команды. Если не уверены — оставьте пустым.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" id="modal-cancel">Отмена</button>
        <button class="btn btn-primary btn-sm" id="modal-confirm">Отправить на ревью</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#modal-close').addEventListener('click', close);
  modal.querySelector('#modal-cancel').addEventListener('click', close);
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
      renderRequestLink(resp);
    } catch (e) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = 'Отправить на ревью';
      addMessage('bot', `Не удалось отправить: ${e.message}`, { error: true });
    }
    if (window.lucide) window.lucide.createIcons();
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
  container.scrollTop = container.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function hideTyping() {
  const el = document.getElementById('agent-typing-indicator');
  if (el) el.remove();
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
