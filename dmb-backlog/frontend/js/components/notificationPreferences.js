import { button, badge, icon } from '../ui/primitives.js';
import { toggleSwitch } from '../ui/switch.js';
import { sectionCard } from '../ui/detailComponents.js';
import { setButtonBusy } from '../ui/controls.js';
import { renderViewState, bindViewStateAction } from './viewState.js';

export function renderNotificationPreferences() {
  return sectionCard({ title: 'Настройки уведомлений', level: 2, collapsible: true, open: false,
    attrs: { id: 'notification-preferences' },
    content: '<div id="notif-prefs-list"></div><div id="notif-prefs-save-status" class="notification-save-status" role="status" aria-live="polite"></div>' });
}

export function initNotificationPreferences(app) {
  const panel = document.getElementById('notification-preferences');
  if (!panel) return;
  let loaded = false;
  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) { loaded = true; loadNotificationPrefs(app); }
  });
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('section') === 'preferences') panel.open = true;
}

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
      ${(app.store.get('currentUser')?.permissions?.customer_portal_mode === 'only' ? [{ title: 'Решения по вашим запросам', description: 'Уведомления о возврате, отклонении, согласовании и начале работы', categories: [{ key: 'request', label: 'Решения по запросам', description: 'Обязательные персональные уведомления', mandatory: true }] }] : NOTIF_GROUPS).map(group => `<section class="notification-preference-group"><div class="notification-preference-group-header"><h3>${group.title}</h3><p>${group.description}</p></div>${group.categories.map(category => category.mandatory
        ? `<div class="notification-preference-row"><span><strong>${category.label}</strong><small>${category.description}</small></span>${badge({ label: 'Всегда включено', tone: 'success' })}</div>`
        : toggleSwitch({ id: `notification-pref-${category.key}`, label: category.label, description: category.description, checked: isEnabled(category.key), className: 'notification-preference-control', attrs: { 'data-category': category.key } })).join('')}</section>`).join('')}`;
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
  if (status) { status.className = 'notification-save-status saving'; status.innerHTML = '<span class="spinner"></span> Сохраняем…'; }
  notificationSaveChain = notificationSaveChain.catch(() => {}).then(() => app.api.put('/notifications/preferences', { preferences })).then(resp => {
    savedNotificationPrefs = { comment: resp?.preferences?.comment !== false };
    applyNotificationPrefs(savedNotificationPrefs);
    if (!status) return;
    status.className = 'notification-save-status success';
    status.innerHTML = '<i data-lucide="check"></i> Все изменения сохранены';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }).catch(() => {
    failedNotificationPrefs = { ...preferences };
    applyNotificationPrefs(savedNotificationPrefs);
    if (!status) return;
    status.className = 'notification-save-status error';
    status.innerHTML = `${icon('alert-circle')} Изменения не сохранены ${button({ label: 'Повторить', variant: 'ghost', size: 'small', attrs: { 'data-retry-notification-save': true } })}`;
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
