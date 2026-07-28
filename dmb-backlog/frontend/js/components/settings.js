export function renderSettings(app) {
  const user = app.store.get('currentUser') || {};
  const userName = user.name || 'Пользователь';
  const userEmail = user.email || '—';
  const userRole = user.role_name || '—';
  const userTeam = user.team_name || '';
  const initials = window.getUserInitials(userName);
  const avatarColor = window.getAvatarColor(userName);

  const paletteIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.5-10-10-10Z"/></svg>';
  const userIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const moonIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  const sunIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const themeIcon = isDark ? sunIcon : moonIcon;
  const checkedAttr = isDark ? 'checked' : '';
  const themeToggleClass = 'theme-toggle' + (isDark ? ' active' : '');

  const savedAccent = localStorage.getItem('dmb_accent') || 'indigo';
  const swatches = [
    { color: 'indigo', hex: '#6366f1' },
    { color: 'emerald', hex: '#10b981' },
    { color: 'rose', hex: '#f43f5e' },
    { color: 'amber', hex: '#f59e0b' },
    { color: 'sky', hex: '#0ea5e9' },
    { color: 'violet', hex: '#8b5cf6' },
  ];

  const swatchHtml = swatches.map(s => `
    <button class="color-swatch${savedAccent === s.color ? ' active' : ''}"
            data-accent="${s.color}"
            style="background:${s.hex}"
            title="${s.color}"
            aria-label="${s.color}"></button>
  `).join('');

  const isCompact = localStorage.getItem('dmb_compact') === 'true';
  const compactChecked = isCompact ? 'checked' : '';

  return `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1>Настройки</h1>
        <p>Настройки профиля, темы и интерфейса</p>
      </div>
      <div class="settings-grid" style="display:grid;gap:16px;">
        <div id="settings-notif-prefs" class="card" style="padding:16px;border-radius:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bell"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            <div>
              <h2 style="font-size:15px;font-weight:600;margin:0">Уведомления</h2>
              <p style="margin:2px 0 0;font-size:12px;color:var(--text-muted)">Какие уведомления вы хотите получать</p>
            </div>
          </div>
          <div id="notif-prefs-list" style="display:flex;flex-direction:column;gap:6px;">
            <p style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px;">Загрузка...</p>
          </div>
          <div id="notif-prefs-save-status" style="font-size:11px;color:var(--success);margin-top:8px;min-height:16px;"></div>
        </div>

        <div class="card" style="padding:16px;border-radius:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
            ${paletteIcon}
            <div>
              <h2 style="font-size:15px;font-weight:600;margin:0">Внешний вид</h2>
              <p style="margin:2px 0 0;font-size:12px;color:var(--text-muted)">Тема и цветовые акценты</p>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color)">
            <div>
              <div style="font-weight:500;font-size:13px">Тёмная тема</div>
              <div style="font-size:11px;color:var(--text-muted)">Автоматически следует за системой</div>
            </div>
            <label class="${themeToggleClass}">
              <input type="checkbox" class="theme-toggle-input" ${checkedAttr}>
              <span class="theme-toggle-icon">${themeIcon}</span>
            </label>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color)">
            <div>
              <div style="font-weight:500;font-size:13px">Цвет акцента</div>
              <div style="font-size:11px;color:var(--text-muted)">Выберите основной цвет</div>
            </div>
            <div class="color-swatches">
              ${swatchHtml}
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">
            <div>
              <div style="font-weight:500;font-size:13px">Компактный режим</div>
              <div style="font-size:11px;color:var(--text-muted)">Меньше отступов, больше информации</div>
            </div>
            <label class="compact-toggle" style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
              <input type="checkbox" class="compact-checkbox" ${compactChecked}>
              <span style="font-size:12px;color:var(--text-muted)">Вкл</span>
            </label>
          </div>
        </div>

        <div class="card" style="padding:16px;border-radius:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
            ${userIcon}
            <div>
              <h2 style="font-size:15px;font-weight:600;margin:0">Профиль</h2>
              <p style="margin:2px 0 0;font-size:12px;color:var(--text-muted)">Информация об учётной записи</p>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div style="width:48px;height:48px;border-radius:12px;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;color:white;flex-shrink:0">${initials}</div>
            <div>
              <div style="font-size:14px;font-weight:600">${userName}</div>
              <div style="font-size:12px;color:var(--text-muted)">${userEmail}</div>
              ${userTeam ? `<div style="font-size:11px;color:var(--text-muted)">${userTeam}</div>` : ''}
            </div>
          </div>

          <div style="border-top:1px solid var(--border-color);padding-top:12px">
            <div style="display:flex;justify-content:space-between;padding:6px 0">
              <span style="font-size:12px;color:var(--text-muted)">Роль в системе</span>
              <span class="badge badge-indigo" style="font-size:11px">${userRole}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0">
              <span style="font-size:12px;color:var(--text-muted)">Последний вход</span>
              <span style="font-size:12px">Сегодня, 09:42</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function initSettings(app) {
  const savedTheme = localStorage.getItem('dmb_theme');
  const savedAccent = localStorage.getItem('dmb_accent');
  const savedCompact = localStorage.getItem('dmb_compact');

  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  if (savedAccent) {
    document.documentElement.setAttribute('data-accent', savedAccent);
  }
  if (savedCompact === 'true') {
    document.body.classList.add('compact-mode');
  }

  bindThemeToggle(app);
  bindColorSwatches(app);
  bindCompactToggle(app);
  loadNotificationPrefs(app);
}

function bindThemeToggle(app) {
  const input = document.querySelector('.theme-toggle-input');
  if (!input) return;
  input.addEventListener('change', () => {
    toggleTheme();
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  });
}

function bindColorSwatches(app) {
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.accent;
      setAccent(color);
    });
  });
}

function bindCompactToggle(app) {
  const checkbox = document.querySelector('.compact-checkbox');
  if (!checkbox) return;
  checkbox.addEventListener('change', () => {
    toggleCompactMode();
  });
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);

  const toggle = document.querySelector('.theme-toggle');
  const input = document.querySelector('.theme-toggle-input');
  const iconSpan = document.querySelector('.theme-toggle-icon');

  const isDark = next === 'dark';

  if (toggle) toggle.classList.toggle('active', isDark);
  if (input) input.checked = isDark;

  if (iconSpan) {
    const moon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    const sun = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
    iconSpan.innerHTML = isDark ? sun : moon;
  }

  localStorage.setItem('dmb_theme', isDark ? 'dark' : 'light');
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function setAccent(color) {
  const html = document.documentElement;
  html.setAttribute('data-accent', color);

  document.querySelectorAll('.color-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.accent === color);
  });

  localStorage.setItem('dmb_accent', color);
}

function toggleCompactMode() {
  document.body.classList.toggle('compact-mode');
  const checkbox = document.querySelector('.compact-checkbox');
  const isCompact = document.body.classList.contains('compact-mode');
  if (checkbox) checkbox.checked = isCompact;
  localStorage.setItem('dmb_compact', isCompact ? 'true' : 'false');
}

const NOTIF_CATEGORIES = [
  { key: 'risk',          label: 'Риски (ХОЛД, ЭСКАЛАЦИЯ НА ЛТ, ОТКЛОНЕНА)', icon: 'alert-triangle' },
  { key: 'deadline',      label: 'Приближение дедлайна',                     icon: 'clock' },
  { key: 'status_change', label: 'Смена статуса',                            icon: 'refresh-cw' },
  { key: 'assignment',    label: 'Назначение ответственного',                icon: 'user-plus' },
  { key: 'mention',       label: 'Упоминание в комментарии (@)',             icon: 'at-sign' },
  { key: 'comment',       label: 'Новый комментарий к задаче',               icon: 'message-circle' },
  { key: 'express',       label: 'Экспресс-импорт',                          icon: 'zap' },
  { key: 'stale',         label: 'Застоявшиеся задачи (>14 дней)',           icon: 'timer' },
  { key: 'attrs',         label: 'Незаполненные атрибуты',                   icon: 'file-text' },
  { key: 'system',        label: 'Системные',                                icon: 'info' },
];

async function loadNotificationPrefs(app) {
  const container = document.getElementById('notif-prefs-list');
  if (!container) return;
  try {
    const resp = await app.api.get('/notifications/preferences');
    const prefs = resp.preferences || {};
    const disabledSet = new Set(
      Object.entries(prefs).filter(([_, enabled]) => !enabled).map(([key]) => key)
    );

    container.innerHTML = NOTIF_CATEGORIES.map(cat => {
      const checked = !disabledSet.has(cat.key);
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--text-primary);transition:background 0.15s;"
               onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" class="notif-pref-toggle" data-category="${cat.key}" ${checked ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;">
          <span style="flex:1">${cat.label}</span>
        </label>`;
    }).join('');

    container.addEventListener('change', (e) => {
      if (e.target.classList.contains('notif-pref-toggle')) {
        saveNotifPrefs(app);
      }
    });
  } catch (err) {
    container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px;">Не удалось загрузить</p>';
  }
}

async function saveNotifPrefs(app) {
  const toggles = document.querySelectorAll('.notif-pref-toggle');
  const preferences = {};
  toggles.forEach(t => { preferences[t.dataset.category] = t.checked; });
  const statusEl = document.getElementById('notif-prefs-save-status');
  try {
    await app.api.put('/notifications/preferences', { preferences });
    if (statusEl) { statusEl.textContent = 'Сохранено'; setTimeout(() => { statusEl.textContent = ''; }, 2000); }
  } catch (err) {
    if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Ошибка'; setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 2000); }
  }
}
