console.log('[DMB] customerChat.js loaded');

import { formatTaskPublicId } from '../taskPublicId.js';

let chatHistory = [];
let isTyping = false;
let taskPreview = null;

const QUICK_ACTIONS = [
  { label: 'Функциональность', icon: 'zap', prompt: 'Разработать новую функциональность: ' },
  { label: 'Исправить баг', icon: 'bug', prompt: 'Исправить ошибку: ' },
  { label: 'Технический долг', icon: 'wrench', prompt: 'Рефакторинг/техдолг: ' },
  { label: 'Исследование', icon: 'search', prompt: 'Провести исследование: ' },
];

const EXAMPLE_PROMPTS = [
  'Разработать форму обратной связи с интеграцией в CRM',
  'Добавить экспорт отчётов в Excel с графиками',
  'Исправить ошибку расчёта метрик на дашборде',
];

export function renderCustomerChat(app) {
  const user = app.store.get('currentUser');
  const userName = user?.name?.split(' ')[0] || 'Заказчик';

  return `
    <div class="page-header animate-fade-in" style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:var(--space-3);">
      <div style="flex:1;min-width:0;">
        <h1>Создать задачу</h1>
        <p>Опишите задачу своими словами — бот поможет оформить запрос</p>
      </div>
      <a href="#/customer" class="btn btn-secondary btn-sm">
        <i data-lucide="arrow-left"></i>
        Назад к задачам
      </a>
    </div>

    <div class="chat-layout">
      <div class="chat-main">
        <div class="chat-container-card">
          <div class="chat-header">
            <div class="chat-header-info">
              <div class="chat-avatar-bot">
                <i data-lucide="bot" style="width:20px;height:20px;"></i>
              </div>
              <div>
                <div class="chat-header-title">Ассистент DMB</div>
                <div class="chat-header-status">
                  <span class="status-dot"></span>
                  Онлайн
                </div>
              </div>
            </div>
            <button class="square-icon btn btn-ghost btn-sm" id="chat-clear-btn" aria-label="Очистить чат">
              <i data-lucide="trash-2"></i>
            </button>
          </div>

          <div class="chat-messages" id="chat-messages">
            ${renderWelcomeScreen(userName)}
          </div>

          <div class="chat-input-area">
            <div class="chat-quick-actions" id="chat-quick-actions">
              ${QUICK_ACTIONS.map(action => `
                <button class="btn btn-secondary btn-sm ui-btn quick-action-chip" data-prompt="${escapeHtml(action.prompt)}">
                  <i data-lucide="${action.icon}" style=""></i>
                  ${action.label}
                </button>
              `).join('')}
            </div>
            <div class="chat-input-wrapper">
              <textarea
                id="chat-input"
                class="input ui-control chat-input"
                placeholder="Опишите задачу или выберите тип выше..."
                rows="1"
              ></textarea>
              <div class="chat-input-actions">
                <span class="chat-hint">Ctrl+Enter</span>
                <button aria-label="Отправить сообщение" class="square-icon btn btn-primary chat-send-btn" id="chat-send-btn" disabled>
                  <i data-lucide="send"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-sidebar">
        <div class="chat-tips-card">
          <div class="chat-tips-header">
            <i data-lucide="lightbulb" style="width:16px;height:16px;color:var(--warning);"></i>
            <span>Подсказки</span>
          </div>
          <div class="chat-tips-list">
            <div class="chat-tip-item">
              <i data-lucide="check" style="width:12px;height:12px;color:var(--success);"></i>
              <span>Начните с типа задачи</span>
            </div>
            <div class="chat-tip-item">
              <i data-lucide="check" style="width:12px;height:12px;color:var(--success);"></i>
              <span>Укажите желаемый результат</span>
            </div>
            <div class="chat-tip-item">
              <i data-lucide="check" style="width:12px;height:12px;color:var(--success);"></i>
              <span>Добавьте контекст или примеры</span>
            </div>
          </div>
        </div>

        <div class="chat-examples-card">
          <div class="chat-examples-header">
            <i data-lucide="message-square" style="width:16px;height:16px;color:var(--info);"></i>
            <span>Примеры запросов</span>
          </div>
          <div class="chat-examples-list">
            ${EXAMPLE_PROMPTS.map(prompt => `
              <button class="ui-surface-action chat-example-item" data-prompt="${escapeHtml(prompt)}">
                ${escapeHtml(prompt)}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function initCustomerChat(app) {
  chatHistory = [];
  taskPreview = null;

  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const clearBtn = document.getElementById('chat-clear-btn');
  const quickActions = document.getElementById('chat-quick-actions');

  input?.addEventListener('input', () => {
    autoResizeTextarea(input);
    sendBtn.disabled = !input.value.trim();
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (input.value.trim()) sendMessage(app);
    }
  });

  sendBtn?.addEventListener('click', () => {
    if (input.value.trim()) sendMessage(app);
  });

  clearBtn?.addEventListener('click', () => {
    clearChat();
  });

  quickActions?.querySelectorAll('.quick-action-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      input.value = prompt;
      input.focus();
      autoResizeTextarea(input);
      sendBtn.disabled = false;
    });
  });

  document.querySelectorAll('.chat-example-item').forEach(example => {
    example.addEventListener('click', () => {
      const prompt = example.dataset.prompt;
      input.value = prompt;
      input.focus();
      autoResizeTextarea(input);
      sendBtn.disabled = false;
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderWelcomeScreen(userName) {
  return `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">
        <i data-lucide="message-circle" style="width:32px;height:32px;"></i>
      </div>
      <div class="chat-welcome-title">Привет, ${escapeHtml(userName)}!</div>
      <div class="chat-welcome-desc">Я помогу вам создать задачу. Опишите, что нужно сделать, или выберите тип задачи ниже.</div>
    </div>
  `;
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

async function sendMessage(app) {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || isTyping) return;

  const messagesContainer = document.getElementById('chat-messages');

  if (chatHistory.length === 0) {
    messagesContainer.innerHTML = '';
  }

  addMessage('user', message);
  chatHistory.push({ role: 'user', content: message });

  input.value = '';
  autoResizeTextarea(input);
  document.getElementById('chat-send-btn').disabled = true;

  showTypingIndicator();
  isTyping = true;

  try {
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 700));

    const response = await app.api.post('/customer/chat', { message });

    hideTypingIndicator();
    isTyping = false;

    if (response.success) {
      addMessage('bot', response.response, { taskId: response.task_id });
      chatHistory.push({ role: 'bot', content: response.response });
    } else {
      addMessage('bot', response.response, { isError: true });
    }

  } catch (e) {
    hideTypingIndicator();
    isTyping = false;
    addMessage('bot', `Произошла ошибка: ${e.message}. Попробуйте ещё раз.`, { isError: true });
  }
}

function addMessage(role, content, options = {}) {
  const messagesContainer = document.getElementById('chat-messages');
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message chat-message-${role}`;

  if (role === 'bot') {
    messageEl.innerHTML = `
      <div class="chat-message-avatar">
        <i data-lucide="bot" style="width:16px;height:16px;"></i>
      </div>
      <div class="chat-message-body">
        <div class="chat-message-header">Ассистент DMB</div>
        <div class="chat-message-content ${options.isError ? 'chat-message-error' : ''}">
          ${formatMessageContent(content)}
          ${options.taskId ? renderTaskLink(options.taskId) : ''}
        </div>
      </div>
    `;
  } else {
    messageEl.innerHTML = `
      <div class="chat-message-body">
        <div class="chat-message-content">${escapeHtml(content)}</div>
      </div>
    `;
  }

  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  if (window.lucide) window.lucide.createIcons();
}

function formatMessageContent(content) {
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function renderTaskLink(taskId) {
  return `
    <div class="chat-task-link">
      <i data-lucide="external-link" style="width:14px;height:14px;"></i>
      <a href="#/tasks" onclick="setTimeout(() => { const event = new CustomEvent('open-task', { detail: { taskId: ${taskId} } }); document.dispatchEvent(event); }, 100);">
        Открыть задачу ${formatTaskPublicId(taskId)}
      </a>
    </div>
  `;
}

function showTypingIndicator() {
  const messagesContainer = document.getElementById('chat-messages');
  const indicator = document.createElement('div');
  indicator.className = 'chat-message chat-message-bot chat-typing-indicator';
  indicator.id = 'typing-indicator';
  indicator.innerHTML = `
    <div class="chat-message-avatar">
      <i data-lucide="bot" style="width:16px;height:16px;"></i>
    </div>
    <div class="chat-message-body">
      <div class="chat-typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  messagesContainer.appendChild(indicator);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  if (window.lucide) window.lucide.createIcons();
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

function clearChat() {
  const messagesContainer = document.getElementById('chat-messages');
  const user = window.app.store.get('currentUser');
  const userName = user?.name?.split(' ')[0] || 'Заказчик';

  chatHistory = [];
  taskPreview = null;
  messagesContainer.innerHTML = renderWelcomeScreen(userName);
  if (window.lucide) window.lucide.createIcons();
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
