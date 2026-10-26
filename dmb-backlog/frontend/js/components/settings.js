import { escapeHtml } from '../htmlUtils.js';
import { applyThemePreference } from '../theme.js';
import { button, badge, icon, pageHeader, tab } from '../ui/primitives.js';
import { toggleSwitch } from '../ui/switch.js';
import { mountTabs, setButtonBusy } from '../ui/controls.js';
import { renderViewState, bindViewStateAction } from './viewState.js';

const ACCENTS = [
  { color: 'indigo', label: 'Индиго', hex: '#6366f1' },
  { color: 'emerald', label: 'Изумрудный', hex: '#10b981' },
  { color: 'rose', label: 'Розовый', hex: '#f43f5e' },
  { color: 'amber', label: 'Янтарный', hex: '#f59e0b' },
  { color: 'sky', label: 'Голубой', hex: '#0ea5e9' },
  { color: 'violet', label: 'Фиолетовый', hex: '#8b5cf6' },
];

const NOTIF_GROUPS = [
  { title: 'Обязательные уведомления', description: 'Персональные события и действия, которые нельзя отключить', categories: [
    { key: 'assignment', label: 'Назначение исполнителем', description: 'Вы стали исполнителем задачи', mandatory: true },
    { key: 'reporting', label: 'Обновление статусов к встрече', description: 'В задачах команды не заполнены отчётные статусы', mandatory: true },
    { key: 'mention', label: 'Упоминания через @', description: 'Вас упомянули в комментарии к доступной задаче', mandatory: true },
  ] },
  { title: 'Командные обсуждения', description: 'Комментарии в задачах вашей основной команды', categories: [
    { key: 'comment', label: 'Новые комментарии', description: 'Автор и упомянутые получатели не дублируются' },
  ] },
];

let notificationSaveChain = Promise.resolve();
let savedNotificationPrefs = { comment: true };
let failedNotificationPrefs = null;
let cleanupNavigation = null;
const SECTIONS = [
  { id: 'appearance', label: 'Интерфейс', icon: 'palette' },
  { id: 'notifications', label: 'Уведомления', icon: 'bell' },
  { id: 'account', label: 'Учётная запись', icon: 'user' },
];

function requestedSection() {
  const value = new URLSearchParams(window.location.hash.split('?')[1] || '').get('section');
  return SECTIONS.some(section => section.id === value) ? value : 'appearance';
}

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
  const selectedSection = requestedSection();

  const themeOptions = [
    { value: 'system', label: 'Как в системе', icon: 'monitor' },
    { value: 'light', label: 'Светлая', icon: 'sun' },
    { value: 'dark', label: 'Тёмная', icon: 'moon' },
  ].map(option => button({ label: option.label, icon: option.icon, attrs: { 'data-theme-choice': option.value, 'aria-pressed': savedTheme === option.value } })).join('');

  const swatches = ACCENTS.map(accent => button({ label: accent.label, iconMarkup: `<svg class="ui-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="${accent.hex}" /></svg>`, attrs: { 'data-accent-choice': accent.color, 'aria-pressed': savedAccent === accent.color } })).join('');

  return `
    <div class="settings-page animate-fade-in">
      <header class="page-header">${pageHeader({ title: 'Персональные настройки', description: 'Настройте интерфейс и уведомления под свой рабочий процесс', className: 'settings-page-header', actions: `<div class="settings-local-note">${icon('laptop')}<span>Внешний вид хранится на этом устройстве, уведомления — в учётной записи</span></div>` })}</header>
      <div class="settings-layout">
        <div class="settings-nav ui-tabs" role="tablist" aria-label="Разделы настроек" aria-orientation="vertical">
          ${SECTIONS.map(section => tab({ id: `settings-tab-${section.id}`, panelId: `settings-view-${section.id}`, label: section.label, iconMarkup: icon(section.icon), selected: selectedSection === section.id, attrs: { 'data-settings-target': section.id } })).join('')}
        </div>
        <div class="settings-panel">
          <section class="settings-view" id="settings-view-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" tabindex="0" data-settings-view="appearance"${selectedSection === 'appearance' ? '' : ' hidden'}>
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
                ${button({ label: 'Комфортная', icon: 'list', attrs: { 'data-density': 'comfortable', 'aria-pressed': !isCompact } })}
                ${button({ label: 'Компактная', icon: 'menu', attrs: { 'data-density': 'compact', 'aria-pressed': isCompact } })}
              </div>
            </div>
            <div class="settings-preview" aria-hidden="true"><div class="settings-preview-top"><span></span><span></span><span></span></div><div class="settings-preview-body"><span class="settings-preview-nav"></span><div><strong>Предпросмотр</strong><span></span><span></span><span></span></div></div></div>
            <div class="settings-inline-status"><i data-lucide="check"></i> Изменения применяются сразу</div>
          </section>
          <section class="settings-view" id="settings-view-notifications" role="tabpanel" aria-labelledby="settings-tab-notifications" tabindex="0" data-settings-view="notifications"${selectedSection === 'notifications' ? '' : ' hidden'}>
            <div class="settings-view-header"><div class="settings-view-icon"><i data-lucide="bell"></i></div><div><h2>Уведомления</h2><p>Выберите события, о которых хотите узнавать</p></div></div>
            <div id="notif-prefs-list" class="settings-notifications">${renderViewState({ kind: 'loading', title: 'Загружаем настройки…' })}</div>
            <div id="notif-prefs-save-status" class="settings-save-status" role="status" aria-live="polite"></div>
          </section>
          <section class="settings-view" id="settings-view-account" role="tabpanel" aria-labelledby="settings-tab-account" tabindex="0" data-settings-view="account"${selectedSection === 'account' ? '' : ' hidden'}>
            <div class="settings-view-header"><div class="settings-view-icon"><i data-lucide="user"></i></div><div><h2>Учётная запись</h2><p>Информация о профиле и доступе</p></div></div>
            <div class="settings-profile-hero"><div class="settings-avatar" style="--avatar-color:${avatarColor}">${escapeHtml(initials)}</div><div><h3>${escapeHtml(userName)}</h3><p>${escapeHtml(userEmail)}</p>${userTeam ? `<span>${escapeHtml(userTeam)}</span>` : ''}</div></div>
            <dl class="settings-profile-list">
              <div><dt>Роль в системе</dt><dd>${badge({ label: userRole, tone: 'accent' })}</dd></div>
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
  bindThemeChoices();
  bindColorChoices();
  bindDensityChoices();
  applySavedAppearance();
  await loadNotificationPrefs(app);
}

function bindSettingsNavigation() {
  cleanupNavigation?.();
  const root = document.querySelector('.settings-nav');
  const media = window.matchMedia('(max-width: 900px)');
  const orient = () => root.setAttribute('aria-orientation', media.matches ? 'horizontal' : 'vertical');
  orient();
  media.addEventListener('change', orient);
  const cleanupTabs = mountTabs(root, id => {
    const section = document.getElementById(id).dataset.settingsTarget;
    const query = section === 'appearance' ? '' : `?section=${section}`;
    history.replaceState(history.state, '', `#/settings${query}`);
  });
  cleanupNavigation = () => { cleanupTabs(); media.removeEventListener('change', orient); };
}

function bindThemeChoices() {
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice;
    localStorage.setItem('dmb_theme', theme);
    applyThemePreference(theme);
    setPressedState('[data-theme-choice]', button);
  }));
}

function bindColorChoices() {
  document.querySelectorAll('[data-accent-choice]').forEach(button => button.addEventListener('click', () => {
    document.documentElement.setAttribute('data-accent', button.dataset.accentChoice);
    localStorage.setItem('dmb_accent', button.dataset.accentChoice);
    setPressedState('[data-accent-choice]', button);
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
  applyThemePreference(localStorage.getItem('dmb_theme') || 'light');
  const accent = localStorage.getItem('dmb_accent') || 'indigo';
  const compact = localStorage.getItem('dmb_compact') === 'true';
  document.documentElement.setAttribute('data-accent', accent);
  document.documentElement.setAttribute('data-compact', compact ? 'true' : 'false');
  document.body.classList.toggle('compact-mode', compact);
}

async function loadNotificationPrefs(app) {
  const container = document.getElementById('notif-prefs-list');
  if (!container) return;
  container.innerHTML = renderViewState({ kind: 'loading', title: 'Загружаем настройки…' });
  container.setAttribute('aria-busy', 'true');
  window.lucide?.createIcons();
  try {
    const resp = await app.api.get('/notifications/preferences');
    const prefs = resp.preferences || {};
    savedNotificationPrefs = { comment: prefs.comment !== false };
    const isEnabled = key => prefs[key] !== false;
    container.innerHTML = `
      ${(app.store.get('currentUser')?.permissions?.customer_portal_mode === 'only' ? [{ title: 'Решения по вашим запросам', description: 'Уведомления о возврате, отклонении, согласовании и начале работы', categories: [{ key: 'request', label: 'Решения по запросам', description: 'Обязательные персональные уведомления', mandatory: true }] }] : NOTIF_GROUPS).map(group => `<section class="settings-notification-group"><div class="settings-notification-group-header"><h3>${group.title}</h3><p>${group.description}</p></div>${group.categories.map(category => category.mandatory
        ? `<div class="settings-notification-row"><span><strong>${category.label}</strong><small>${category.description}</small></span>${badge({ label: 'Всегда включено', tone: 'success' })}</div>`
        : toggleSwitch({ id: `notification-pref-${category.key}`, label: category.label, description: category.description, checked: isEnabled(category.key), className: 'settings-notification-control', attrs: { 'data-category': category.key } })).join('')}</section>`).join('')}`;
    container.onchange = event => {
      if (!event.target.matches('.ui-switch-input[data-category]')) return;
      queueNotificationSave(app);
    };
    window.lucide?.createIcons();
  } catch (err) {
    container.innerHTML = renderViewState({ kind: 'error', title: 'Не удалось загрузить настройки', message: 'Проверьте соединение и повторите попытку.', actionLabel: 'Повторить' });
    bindViewStateAction(container, () => loadNotificationPrefs(app));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } finally { container.removeAttribute('aria-busy'); }
}

function applyNotificationPrefs(preferences) {
  document.querySelectorAll('.ui-switch-input[data-category]').forEach(toggle => {
    toggle.checked = preferences[toggle.dataset.category] !== false;
  });
}

function queueNotificationSave(app, explicitPreferences = null) {
  const status = document.getElementById('notif-prefs-save-status');
  const preferences = explicitPreferences ? { ...explicitPreferences } : {};
  if (!explicitPreferences) document.querySelectorAll('.ui-switch-input[data-category]').forEach(toggle => { preferences[toggle.dataset.category] = toggle.checked; });
  failedNotificationPrefs = null;
  document.querySelectorAll('.ui-switch-input[data-category]').forEach(toggle => { toggle.disabled = true; toggle.setAttribute('aria-busy', 'true'); });
  if (status) { status.className = 'settings-save-status saving'; status.innerHTML = '<span class="spinner"></span> Сохраняем…'; }
  notificationSaveChain = notificationSaveChain.catch(() => {}).then(() => app.api.put('/notifications/preferences', { preferences })).then(resp => {
    savedNotificationPrefs = { comment: resp?.preferences?.comment !== false };
    applyNotificationPrefs(savedNotificationPrefs);
    if (!status) return;
    status.className = 'settings-save-status success';
    status.innerHTML = '<i data-lucide="check"></i> Все изменения сохранены';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }).catch(() => {
    failedNotificationPrefs = { ...preferences };
    applyNotificationPrefs(savedNotificationPrefs);
    if (!status) return;
    status.className = 'settings-save-status error';
    status.innerHTML = `${icon('circle-alert')} Изменения не сохранены ${button({ label: 'Повторить', variant: 'ghost', size: 'small', attrs: { 'data-retry-notification-save': true } })}`;
    status.querySelector('[data-retry-notification-save]')?.addEventListener('click',event=>{
      if (!failedNotificationPrefs) return;
      setButtonBusy(event.currentTarget, true, 'Сохраняем…');
      applyNotificationPrefs(failedNotificationPrefs);
      queueNotificationSave(app, failedNotificationPrefs);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }).finally(() => {
    document.querySelectorAll('.ui-switch-input[data-category]').forEach(toggle => { toggle.disabled = false; toggle.removeAttribute('aria-busy'); });
  });
}
