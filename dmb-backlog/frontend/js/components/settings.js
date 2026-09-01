import { escapeHtml } from '../htmlUtils.js';

const ACCENTS = [
  { color: 'indigo', label: 'Индиго', hex: '#6366f1' },
  { color: 'emerald', label: 'Изумрудный', hex: '#10b981' },
  { color: 'rose', label: 'Розовый', hex: '#f43f5e' },
  { color: 'amber', label: 'Янтарный', hex: '#f59e0b' },
  { color: 'sky', label: 'Голубой', hex: '#0ea5e9' },
  { color: 'violet', label: 'Фиолетовый', hex: '#8b5cf6' },
];

const NOTIF_GROUPS = [
  { title: 'Важные события', description: 'События, которые могут потребовать вашего внимания', categories: [
    { key: 'risk', label: 'Риски и эскалации', description: 'Холд, эскалация на ЛТ или отклонение задачи' },
    { key: 'deadline', label: 'Приближение дедлайна', description: 'Напоминания о приближающихся сроках' },
    { key: 'stale', label: 'Застоявшиеся задачи', description: 'Задачи без изменений более 14 дней' },
  ] },
  { title: 'Работа с задачами', description: 'Изменения в задачах и назначениях', categories: [
    { key: 'status_change', label: 'Смена статуса' },
    { key: 'assignment', label: 'Назначение ответственным' },
    { key: 'express', label: 'Экспресс-импорт' },
    { key: 'attrs', label: 'Незаполненные атрибуты' },
  ] },
  { title: 'Обсуждения и система', description: 'Комментарии, упоминания и служебные сообщения', categories: [
    { key: 'mention', label: 'Упоминания в комментариях' },
    { key: 'comment', label: 'Новые комментарии' },
    { key: 'system', label: 'Системные сообщения' },
  ] },
];

let notificationSaveChain = Promise.resolve();
let systemThemeListener = null;

export function renderSettings(app) {
  const user = app.store.get('currentUser') || {};
  const userName = user.name || 'Пользователь';
  const userEmail = user.email || '—';
  const userRole = user.role_name || '—';
  const userTeam = user.team_name || '';
  const initials = window.getUserInitials(userName);
  const avatarColor = window.getAvatarColor(userName);
  const savedTheme = localStorage.getItem('dmb_theme') || 'light';
  const savedAccent = localStorage.getItem('dmb_accent') || 'indigo';
  const isCompact = localStorage.getItem('dmb_compact') === 'true';

  const themeOptions = [
    { value: 'system', label: 'Как в системе', icon: 'monitor' },
    { value: 'light', label: 'Светлая', icon: 'sun' },
    { value: 'dark', label: 'Тёмная', icon: 'moon' },
  ].map(option => `
    <button type="button" class="settings-choice${savedTheme === option.value ? ' active' : ''}" data-theme-choice="${option.value}" aria-pressed="${savedTheme === option.value}">
      <i data-lucide="${option.icon}"></i><span>${option.label}</span>
    </button>`).join('');

  const swatches = ACCENTS.map(accent => `
    <button type="button" class="settings-color${savedAccent === accent.color ? ' active' : ''}" data-accent="${accent.color}" aria-label="${accent.label}" aria-pressed="${savedAccent === accent.color}">
      <span class="settings-color-dot" style="--swatch:${accent.hex}"></span><span>${accent.label}</span>
    </button>`).join('');

  return `
    <div class="settings-page animate-fade-in">
      <div class="page-header settings-page-header">
        <div><h1>Персональные настройки</h1><p>Настройте интерфейс и уведомления под свой рабочий процесс</p></div>
        <div class="settings-local-note"><i data-lucide="laptop"></i><span>Интерфейс сохраняется на этом устройстве</span></div>
      </div>
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Разделы настроек">
          <button type="button" class="settings-nav-item active" data-settings-target="appearance" aria-current="page"><i data-lucide="palette"></i><span><strong>Интерфейс</strong><small>Тема и отображение</small></span></button>
          <button type="button" class="settings-nav-item" data-settings-target="notifications"><i data-lucide="bell"></i><span><strong>Уведомления</strong><small>События и оповещения</small></span></button>
          <button type="button" class="settings-nav-item" data-settings-target="account"><i data-lucide="user"></i><span><strong>Учётная запись</strong><small>Профиль и доступ</small></span></button>
        </nav>
        <div class="settings-panel" aria-live="polite">
          <section class="settings-view active" data-settings-view="appearance">
            <div class="settings-view-header"><div class="settings-view-icon"><i data-lucide="palette"></i></div><div><h2>Интерфейс</h2><p>Выберите комфортный вид рабочего пространства</p></div></div>
            <div class="settings-block">
              <div class="settings-block-heading"><h3>Тема</h3><p>Системная тема автоматически меняется вместе с настройками устройства</p></div>
              <div class="settings-choice-group" role="group" aria-label="Тема интерфейса">${themeOptions}</div>
            </div>
            <div class="settings-block">
              <div class="settings-block-heading"><h3>Цвет интерфейса</h3><p>Используется для кнопок, ссылок и активных элементов</p></div>
              <div class="settings-colors" role="group" aria-label="Цвет интерфейса">${swatches}</div>
            </div>
            <div class="settings-block">
              <div class="settings-block-heading"><h3>Плотность</h3><p>Компактный режим уменьшает отступы и показывает больше данных</p></div>
              <div class="settings-choice-group settings-choice-group--density" role="group" aria-label="Плотность интерфейса">
                <button type="button" class="settings-choice${isCompact ? '' : ' active'}" data-density="comfortable" aria-pressed="${!isCompact}"><i data-lucide="list"></i><span>Комфортная</span></button>
                <button type="button" class="settings-choice${isCompact ? ' active' : ''}" data-density="compact" aria-pressed="${isCompact}"><i data-lucide="menu"></i><span>Компактная</span></button>
              </div>
            </div>
            <div class="settings-preview" aria-hidden="true"><div class="settings-preview-top"><span></span><span></span><span></span></div><div class="settings-preview-body"><span class="settings-preview-nav"></span><div><strong>Предпросмотр</strong><span></span><span></span><span></span></div></div></div>
            <div class="settings-inline-status"><i data-lucide="check"></i> Изменения применяются сразу</div>
          </section>
          <section class="settings-view" data-settings-view="notifications" hidden>
            <div class="settings-view-header"><div class="settings-view-icon"><i data-lucide="bell"></i></div><div><h2>Уведомления</h2><p>Выберите события, о которых хотите узнавать</p></div></div>
            <div id="notif-prefs-list" class="settings-notifications"><div class="settings-loading"><span class="spinner"></span> Загружаем настройки…</div></div>
            <div id="notif-prefs-save-status" class="settings-save-status" role="status" aria-live="polite"></div>
          </section>
          <section class="settings-view" data-settings-view="account" hidden>
            <div class="settings-view-header"><div class="settings-view-icon"><i data-lucide="user"></i></div><div><h2>Учётная запись</h2><p>Информация о профиле и доступе</p></div></div>
            <div class="settings-profile-hero"><div class="settings-avatar" style="--avatar-color:${avatarColor}">${escapeHtml(initials)}</div><div><h3>${escapeHtml(userName)}</h3><p>${escapeHtml(userEmail)}</p>${userTeam ? `<span>${escapeHtml(userTeam)}</span>` : ''}</div></div>
            <dl class="settings-profile-list">
              <div><dt>Роль в системе</dt><dd><span class="badge badge-indigo">${escapeHtml(userRole)}</span></dd></div>
              <div><dt>Команда</dt><dd>${escapeHtml(userTeam || 'Не указана')}</dd></div>
              <div><dt>Электронная почта</dt><dd>${escapeHtml(userEmail)}</dd></div>
            </dl>
            <div class="settings-info-callout"><i data-lucide="info"></i><div><strong>Данные профиля управляются администратором</strong><p>Если информация устарела, обратитесь к администратору системы.</p></div></div>
          </section>
        </div>
      </div>
    </div>`;
}

export async function initSettings(app) {
  bindSettingsNavigation();
  openRequestedSettingsSection();
  bindThemeChoices();
  bindColorChoices();
  bindDensityChoices();
  applySavedAppearance();
  loadNotificationPrefs(app);
}

function openRequestedSettingsSection() {
  const [, query = ''] = window.location.hash.slice(1).split('?');
  const section = new URLSearchParams(query).get('section');
  if (!section) return;
  document.querySelector(`[data-settings-target="${section}"]`)?.click();
}

function bindSettingsNavigation() {
  const buttons = document.querySelectorAll('[data-settings-target]');
  const views = document.querySelectorAll('[data-settings-view]');
  buttons.forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.settingsTarget;
    buttons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      active ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current');
    });
    views.forEach(view => {
      const active = view.dataset.settingsView === target;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });
  }));
}

function bindThemeChoices() {
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice;
    localStorage.setItem('dmb_theme', theme);
    applyTheme(theme);
    setPressedState('[data-theme-choice]', button);
  }));
}

function bindColorChoices() {
  document.querySelectorAll('[data-accent]').forEach(button => button.addEventListener('click', () => {
    document.documentElement.setAttribute('data-accent', button.dataset.accent);
    localStorage.setItem('dmb_accent', button.dataset.accent);
    setPressedState('[data-accent]', button);
  }));
}

function bindDensityChoices() {
  document.querySelectorAll('[data-density]').forEach(button => button.addEventListener('click', () => {
    const compact = button.dataset.density === 'compact';
    document.documentElement.setAttribute('data-compact', compact ? 'true' : 'false');
    document.body.classList.toggle('compact-mode', compact);
    localStorage.setItem('dmb_compact', compact ? 'true' : 'false');
    setPressedState('[data-density]', button);
  }));
}

function setPressedState(selector, activeButton) {
  document.querySelectorAll(selector).forEach(button => {
    const active = button === activeButton;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function applySavedAppearance() {
  applyTheme(localStorage.getItem('dmb_theme') || 'light');
  const accent = localStorage.getItem('dmb_accent') || 'indigo';
  const compact = localStorage.getItem('dmb_compact') === 'true';
  document.documentElement.setAttribute('data-accent', accent);
  document.documentElement.setAttribute('data-compact', compact ? 'true' : 'false');
  document.body.classList.toggle('compact-mode', compact);
}

function applyTheme(theme) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  document.documentElement.setAttribute('data-theme', theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
  if (systemThemeListener) media.removeEventListener('change', systemThemeListener);
  systemThemeListener = null;
  if (theme === 'system') {
    systemThemeListener = event => document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'light');
    media.addEventListener('change', systemThemeListener);
  }
}

async function loadNotificationPrefs(app) {
  const container = document.getElementById('notif-prefs-list');
  if (!container) return;
  try {
    const resp = await app.api.get('/notifications/preferences');
    const prefs = resp.preferences || {};
    const isEnabled = key => prefs[key] !== false;
    const allEnabled = NOTIF_GROUPS.flatMap(group => group.categories).every(category => isEnabled(category.key));
    container.innerHTML = `
      <label class="settings-notification-master"><span><strong>Все уведомления</strong><small>Быстро включить или отключить все категории</small></span><input type="checkbox" class="settings-switch-input" id="notif-master-toggle" ${allEnabled ? 'checked' : ''}><span class="settings-switch" aria-hidden="true"></span></label>
      ${NOTIF_GROUPS.map(group => `<section class="settings-notification-group"><div class="settings-notification-group-header"><h3>${group.title}</h3><p>${group.description}</p></div>${group.categories.map(category => `<label class="settings-notification-row"><span><strong>${category.label}</strong>${category.description ? `<small>${category.description}</small>` : ''}</span><input type="checkbox" class="settings-switch-input notif-pref-toggle" data-category="${category.key}" ${isEnabled(category.key) ? 'checked' : ''}><span class="settings-switch" aria-hidden="true"></span></label>`).join('')}</section>`).join('')}`;
    container.addEventListener('change', event => {
      if (event.target.id === 'notif-master-toggle') {
        container.querySelectorAll('.notif-pref-toggle').forEach(toggle => { toggle.checked = event.target.checked; });
      } else if (event.target.classList.contains('notif-pref-toggle')) {
        const toggles = [...container.querySelectorAll('.notif-pref-toggle')];
        container.querySelector('#notif-master-toggle').checked = toggles.every(toggle => toggle.checked);
      } else return;
      queueNotificationSave(app);
    });
  } catch (err) {
    container.innerHTML = '<div class="settings-error"><i data-lucide="circle-alert"></i><div><strong>Не удалось загрузить настройки</strong><p>Обновите страницу и попробуйте ещё раз.</p></div></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function queueNotificationSave(app) {
  const status = document.getElementById('notif-prefs-save-status');
  const preferences = {};
  document.querySelectorAll('.notif-pref-toggle').forEach(toggle => { preferences[toggle.dataset.category] = toggle.checked; });
  if (status) { status.className = 'settings-save-status saving'; status.innerHTML = '<span class="spinner"></span> Сохраняем…'; }
  notificationSaveChain = notificationSaveChain.catch(() => {}).then(() => app.api.put('/notifications/preferences', { preferences })).then(() => {
    if (!status) return;
    status.className = 'settings-save-status success';
    status.innerHTML = '<i data-lucide="check"></i> Все изменения сохранены';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }).catch(() => {
    if (!status) return;
    status.className = 'settings-save-status error';
    status.innerHTML = '<i data-lucide="circle-alert"></i> Не удалось сохранить изменения';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });
}
