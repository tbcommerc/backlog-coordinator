let adminTab = 'teams';
let adminData = { teams: [], users: [], roles: [], priorities: [], statuses: [], taskTypes: [], businessCustomers: [], channels: [], deadlines: [], departments: [], teamTypes: [], projectStatuses: [], projects: [], reports: [], notifications: [], teamTypeRefs: [] };
let adminModal = { show: false, mode: 'add', type: 'team', data: {} };
let currentAdminUser = null;
let userSort = { field: 'role', dir: 'asc' };
let userSearch = '';
let userFilters = { role: '', team: '', status: '' };

const TEAM_ABBR = {
  'Pre-Trade': 'Pre',
  'Post-Trade (Products & Service)': 'Pst',
  'Core': 'Cr',
  'IB': 'IB',
  'Delivery': 'Dev',
  'Post-Trade (Finance)': 'Fin',
  'Methodology': 'Met',
  'ИТ ЛТ': 'ЛТ',
  'AI': 'AI',
  'Проектный офис': 'POf',
};

function getTeamAbbr(name, abbr) {
  if (abbr) return abbr;
  return TEAM_ABBR[name] || (name ? name.substring(0, 2).toUpperCase() : '??');
}

const COLOR_BGS = {
  indigo: 'linear-gradient(135deg, #6366f1, #4f46e5)',
  emerald: 'linear-gradient(135deg, #10b981, #059669)',
  amber: 'linear-gradient(135deg, #f59e0b, #d97706)',
  rose: 'linear-gradient(135deg, #f43f5e, #e11d48)',
  sky: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
  violet: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  cyan: 'linear-gradient(135deg, #06b6d4, #0891b2)',
  orange: 'linear-gradient(135deg, #f97316, #ea580c)',
  teal: 'linear-gradient(135deg, #14b8a6, #0d9488)',
  purple: 'linear-gradient(135deg, #a855f7, #9333ea)',
  slate: 'linear-gradient(135deg, #64748b, #475569)',
};

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function getColorGradient(color) {
  return COLOR_BGS[color] || COLOR_BGS.slate;
}

window.updateUserAvatarPreview = function(name) {
  const el = document.getElementById('user-avatar-preview');
  if (!el) return;
  el.textContent = window.getUserInitials(name);
  el.style.background = window.getAvatarColor(name);
  const emailInput = document.getElementById('modal-email');
  if (emailInput) {
    emailInput.value = generateEmail(name);
  }
};

const CYR_TO_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e',
  'ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m',
  'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ы':'y','э':'e','ю':'yu','я':'ya',
  'А':'a','Б':'b','В':'v','Г':'g','Д':'d','Е':'e','Ё':'e',
  'Ж':'zh','З':'z','И':'i','Й':'y','К':'k','Л':'l','М':'m',
  'Н':'n','О':'o','П':'p','Р':'r','С':'s','Т':'t','У':'u',
  'Ф':'f','Х':'kh','Ц':'ts','Ч':'ch','Ш':'sh','Щ':'shch',
  'Ы':'y','Э':'e','Ю':'yu','Я':'ya',
};

function transliterate(text) {
  return text.split('').map(ch => CYR_TO_LAT[ch] || ch).join('');
}

function generateEmail(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  let firstInitial, lastName;
  if (parts.length >= 2) {
    firstInitial = parts[0][0];
    lastName = parts.slice(1).join('').replace(/\./g, '');
  } else {
    const dotParts = name.split('.');
    if (dotParts.length >= 2) {
      firstInitial = dotParts[0];
      lastName = dotParts.slice(1).join('').replace(/\./g, '');
    } else {
      firstInitial = name[0];
      lastName = '';
    }
  }
  const latFirst = transliterate(firstInitial);
  const latLast = transliterate(lastName);
  return (latFirst + (latLast ? '.' + latLast : '')).toLowerCase() + '@dmb.ru';
}

function getAccessLabel(level) {
  const map = {
    none: 'Нет доступа',
    read: 'Только просмотр',
    read_own: 'Своя команда',
    write_own: 'Редакт. свою',
    read_all: 'Все команды',
    read_write: 'Просмотр и ред.',
    write_all: 'Редакт. все',
    available: 'Доступно',
    partial: 'Частичный',
    full: 'Полный доступ',
  };
  return map[level] || level;
}

const DICT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6b7280', '#84cc16', '#22c55e',
];

function autoDictCode(name) {
  if (!name) return '';
  const code = transliterate(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return code || name.toLowerCase().slice(0, 10);
}

function autoDictColor(name) {
  if (!name) return DICT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return DICT_COLORS[Math.abs(hash) % DICT_COLORS.length];
}

window.autoFillDictRow = function(input) {
  const row = input.closest('div[style]');
  if (!row) return;
  const name = input.value.trim();
  const codeInput = row.querySelector('.dict-code-input');
  if (codeInput && !codeInput.value && !codeInput.dataset.userEdited) {
    codeInput.value = autoDictCode(name);
  }
  const colorInput = row.querySelector('.dict-color-input');
  if (colorInput && !colorInput.dataset.userEdited && name) {
    const c = autoDictColor(name);
    colorInput.value = c;
    const swatch = row.querySelector('.dict-color-swatch');
    if (swatch) swatch.style.background = c;
  }
};

window.markDictEdited = function(input) {
  input.dataset.userEdited = '1';
};

function getStatusBadge(active) {
  return active
    ? '<span class="badge badge-success" style="font-size:11px">Активен</span>'
    : '<span class="badge badge-muted" style="font-size:11px">Неактивен</span>';
}

function getRoleStatusBadge(status) {
  const map = {
    active: '<span class="badge badge-success" style="font-size:11px">Активна</span>',
    in_dev: '<span class="badge badge-warning" style="font-size:11px">В разработке</span>',
    archived: '<span class="badge badge-muted" style="font-size:11px">Архивная</span>',
  };
  return map[status] || map.active;
}

// ==================== RENDER ADMIN ====================

export function renderAdmin(app) {
  adminTab = 'teams';
  const tabs = ['teams', 'projects', 'businessCustomers', 'users', 'roles', 'dictionaries', 'notifications', 'display', 'reports'];
  const tabLabels = { teams: 'Команды', projects: 'Проекты', businessCustomers: 'Бизнес-заказчики', users: 'Пользователи', roles: 'Роли', dictionaries: 'Справочники', notifications: 'Уведомления', display: 'Отображение', reports: 'Отчёты' };
  const tabIcons = { teams: 'users', projects: 'briefcase', businessCustomers: 'user-cog', users: 'user', roles: 'shield', dictionaries: 'book-open', notifications: 'bell', display: 'eye', reports: 'bar-chart-3' };

  const tabBar = tabs.map(t =>
    `<button class="admin-tab${adminTab === t ? ' active' : ''}" data-tab="${t}">
      <i data-lucide="${tabIcons[t]}" style="width:22px;height:22px;"></i>
      <span>${tabLabels[t]}</span>
    </button>`
  ).join('');

  const content = renderTabContent(adminTab, app);

  return `
    <div class="page-header animate-fade-in" style="position:relative;z-index:40">
      <div>
        <h1>Администрирование</h1>
        <p class="text-muted text-sm mt-1">Настройки системы, справочники и управление доступами</p>
      </div>
    </div>
    <div style="position:sticky;top:var(--navbar-height);z-index:30;background:var(--bg-primary);padding-bottom:var(--space-2)">
      <div class="admin-tabs" id="admin-tab-bar">${tabBar}</div>
      <div id="admin-sticky-bar"></div>
    </div>
    <div id="admin-content" style="padding-top:var(--space-2)">${content}</div>
    <div id="admin-modal-root"></div>
  `;
}

function pullStickyBars() {
  const container = document.getElementById('admin-sticky-bar');
  const content = document.getElementById('admin-content');
  if (!container || !content) return;
  container.innerHTML = '';

  const bars = content.querySelectorAll('.admin-action-row');
  bars.forEach(b => container.appendChild(b));
  initAdminStickyThead();
}

let stickyHeader = null;
let stickyScroll = null;

function initAdminStickyThead() {
  if (stickyScroll) { window.removeEventListener('scroll', stickyScroll); stickyScroll = null; }
  if (stickyHeader) { stickyHeader.remove(); stickyHeader = null; }

  const table = document.querySelector('#admin-content table');
  const thead = table?.querySelector('thead');
  if (!table || !thead) return;

  const style = getComputedStyle(document.documentElement);
  const navbarH = parseFloat(style.getPropertyValue('--navbar-height')) || 64;
  const wrapper = document.querySelector('#admin-tab-bar')?.parentElement;

  function update() {
    if (!table.isConnected) { if (stickyHeader) { stickyHeader.remove(); stickyHeader = null; } return; }
    const rect = table.getBoundingClientRect();
    const wrapperH = wrapper ? wrapper.offsetHeight : 56;
    const offsetTop = navbarH + wrapperH;
    const theadH = thead.offsetHeight;

    if (rect.top < offsetTop && rect.bottom > offsetTop + theadH) {
      if (!stickyHeader) {
        stickyHeader = document.createElement('div');
        stickyHeader.style.cssText = 'position:fixed;z-index:20;overflow:hidden;background:var(--bg-tertiary);box-shadow:0 2px 8px rgba(0,0,0,0.15)';
        const cloneTable = document.createElement('table');
        cloneTable.style.cssText = 'margin:0;border-collapse:collapse;font-size:13px;width:' + table.offsetWidth + 'px';
        cloneTable.appendChild(thead.cloneNode(true));
        stickyHeader.appendChild(cloneTable);
        document.body.appendChild(stickyHeader);

        const clonedThs = stickyHeader.querySelectorAll('th');
        const origThs = thead.querySelectorAll('th');
        clonedThs.forEach((th, i) => {
          if (origThs[i]) {
            const w = origThs[i].getBoundingClientRect().width;
            th.style.width = w + 'px';
            th.style.minWidth = w + 'px';
            th.style.maxWidth = w + 'px';
          }
        });
      }
      const cRect = document.querySelector('#admin-content').getBoundingClientRect();
      stickyHeader.style.left = cRect.left + 'px';
      stickyHeader.style.width = cRect.width + 'px';
      stickyHeader.style.top = offsetTop + 'px';
      stickyHeader.style.height = theadH + 'px';
    } else if (stickyHeader) {
      stickyHeader.remove();
      stickyHeader = null;
    }
  }

  stickyScroll = () => update();
  window.addEventListener('scroll', stickyScroll, {passive: true});
  window.addEventListener('resize', stickyScroll, {passive: true});
  update();
}

// ==================== TAB CONTENT RENDERER ====================

function renderTabContent(tab, app) {
  switch (tab) {
    case 'teams': return renderTeamsTab(app);
    case 'projects': return renderProjectsTab(app);
      case 'businessCustomers': return renderBusinessCustomersTab(app);
    case 'users': return renderUsersTab(app);
    case 'roles': return renderRolesTab(app);
    case 'dictionaries': return renderDictionariesTab(app);
    case 'notifications': return renderNotificationsTab(app);
    case 'display': return renderDisplayTab(app);
    case 'reports': return renderReportsTab(app);
    default: return '<p class="text-muted">Выберите вкладку</p>';
  }
}

// ==================== TEAMS TAB ====================

function renderTeamsTab(app) {
  const teams = adminData.teams || [];
  const cards = teams.length
    ? teams.map(t => {
        const leads = [];
        if (t.pl) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">PL: ${t.pl}</div>`);
        if (t.po) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">PO: ${t.po}</div>`);
        if (t.cl) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">CL: ${t.cl}</div>`);
        if (t.it_pl) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">IT PL: ${t.it_pl}</div>`);
        const leadInfo = leads.length ? leads.join('') : '<div style="font-size:11px;color:var(--text-muted);line-height:1.6">Нет руководителей</div>';
        const abbr = getTeamAbbr(t.name, t.abbr);
        const gradient = getColorGradient(t.color);
        return `
          <div class="card card-hover" style="cursor:pointer;padding:16px;display:flex;flex-direction:column;min-height:180px;transition:box-shadow 0.2s,transform 0.15s" onmouseover="this.style.boxShadow='var(--shadow-md)';this.style.transform='translateY(-2px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
              <div style="width:44px;height:44px;border-radius:12px;background:${gradient};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white;flex-shrink:0">${abbr}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px;color:var(--text-primary);word-break:break-word">${t.name}</div>
              </div>
              <div style="flex-shrink:0;display:flex;align-items:flex-start;gap:4px">
                <button class="admin-edit-btn" data-type="team" data-id="${t.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать команду">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                <button class="admin-delete-btn" data-type="team" data-id="${t.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить команду">
                  <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>
              </div>
            </div>
            <div style="flex:1">${leadInfo}</div>
            ${t.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color)">${t.description}</div>` : ''}
          </div>
        `;
      }).join('')
    : '<div class="text-muted" style="grid-column:1/-1;text-align:center;padding:40px">Нет команд</div>';

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="team">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Новая команда
      </button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">${cards}</div>
  `;
}

// ==================== PROJECTS TAB ====================

function renderProjectsTab(app) {
  const projects = adminData.projects || [];
  const statuses = adminData.projectStatuses || [];
  const users = adminData.users || [];
  const rows = projects.map(p => {
    const status = statuses.find(s => s.id === p.status_id);
    const pl = users.find(u => u.id === p.responsible_pl);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted)">#${p.id}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:13px;font-weight:600;color:var(--text-primary)">${p.code}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:13px;color:var(--text-primary)">${p.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.description || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${status ? status.name : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${pl ? pl.name : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:11px;color:var(--text-muted)">${p.created_at ? p.created_at.slice(0, 10) : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);text-align:right">
          <div style="display:flex;gap:4px;justify-content:flex-end">
            <button class="admin-edit-btn" data-type="project" data-id="${p.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
              <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
            </button>
            <button class="admin-delete-btn" data-type="project" data-id="${p.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
              <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm" id="project-add-btn">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Добавить проект
      </button>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:50px">ID</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Код</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Название</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Описание</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Статус</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Ответственный PL</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Создан</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:80px"></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" style="padding:20px;text-align:center;font-size:13px;color:var(--text-muted)">Нет проектов</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// ==================== BUSINESS CUSTOMERS TAB ====================

function renderBusinessCustomersTab(app) {
  const customers = adminData.businessCustomers || [];
  const departments = adminData.departments || [];
  const deptMap = {};
  departments.forEach(d => { deptMap[d.id] = d.name; });

  const rows = customers.map(c => {
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted)">#${c.id}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:13px;font-weight:600;color:var(--text-primary)">${c.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${c.department_name || (c.department_id && deptMap[c.department_id]) || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:11px;color:var(--text-muted)">${c.created_at ? c.created_at.slice(0, 10) : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);text-align:right">
          <div style="display:flex;gap:4px;justify-content:flex-end">
            <button class="admin-edit-btn" data-type="bc" data-id="${c.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
              <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
            </button>
            <button class="admin-delete-btn" data-type="bc" data-id="${c.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
              <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm" id="bc-add-btn">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Добавить бизнес-заказчика
      </button>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:50px">ID</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">ФИО</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Подразделение</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Создан</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:80px"></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:20px;text-align:center;font-size:13px;color:var(--text-muted)">Нет бизнес-заказчиков</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function renderBusinessCustomerForm(data) {
  const departments = adminData.departments || [];
  const deptOpts = departments.map(d => `<option value="${d.id}"${data.department_id == d.id ? ' selected' : ''}>${d.name}</option>`).join('');
  const isEdit = adminModal.mode === 'edit';
  return `
    <div class="form-group">
      <label class="form-label">ID</label>
      <input class="input modal-field" value="${data.id || '—'}" readonly style="color:var(--text-muted)">
    </div>
    <div class="form-group">
      <label class="form-label">ФИО <span class="required">*</span></label>
      <input class="input modal-field" id="bc-name" value="${data.name || ''}" placeholder="ФИО бизнес-заказчика">
    </div>
    <div class="form-group">
      <label class="form-label">Подразделение</label>
      <select class="input modal-field" id="bc-department"><option value="">—</option>${deptOpts}</select>
    </div>
  `;
}

function getBusinessCustomerPayload() {
  return {
    name: getFieldVal('bc-name'),
    department_id: parseInt(getFieldVal('bc-department')) || null,
  };
}

// ==================== USERS TAB ====================

function renderUsersTab(app) {
  const teams = adminData.teams || [];
  const roles = adminData.roles || [];

  let users = [...(adminData.users || [])];

  // Search filter
  if (userSearch) {
    const q = userSearch.toLowerCase();
    users = users.filter(u =>
      (u.name || '').toLowerCase().includes(q)
    );
  }

  // Column filters
  if (userFilters.role) {
    const rid = parseInt(userFilters.role);
    users = users.filter(u => u.role_id === rid);
  }
  if (userFilters.team) {
    const tid = parseInt(userFilters.team);
    users = users.filter(u => u.team_id === tid);
  }
  if (userFilters.status) {
    const active = userFilters.status === '1';
    users = users.filter(u => u.is_active === active);
  }

  // Sort
  const sortDir = userSort.dir === 'asc' ? 1 : -1;
  users.sort((a, b) => {
    let va, vb;
    switch (userSort.field) {
      case 'name':
        va = a.name || ''; vb = b.name || '';
        return va.localeCompare(vb) * sortDir;
      case 'role':
        const ra = (roles.find(r => r.id === a.role_id) || {}).name || '';
        const rb = (roles.find(r => r.id === b.role_id) || {}).name || '';
        const prioA = ra.includes('Tribe') ? 0 : ra.includes('Project Office') ? 1 : 2;
        const prioB = rb.includes('Tribe') ? 0 : rb.includes('Project Office') ? 1 : 2;
        if (prioA !== prioB) return (prioA - prioB) * sortDir;
        return (ra.localeCompare(rb) || (a.name || '').localeCompare(b.name || '')) * sortDir;
      case 'team':
        const ta = (teams.find(t => t.id === a.team_id) || {}).name || '';
        const tb = (teams.find(t => t.id === b.team_id) || {}).name || '';
        return ta.localeCompare(tb) * sortDir;
      case 'email':
        va = a.email || ''; vb = b.email || '';
        return va.localeCompare(vb) * sortDir;
      case 'status':
        va = a.is_active ? 1 : 0; vb = b.is_active ? 1 : 0;
        return (va - vb) * sortDir;
      default:
        return 0;
    }
  });

  const sortArrow = (field) => {
    if (userSort.field !== field) return '';
    return userSort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  const th = (field, label) => `
    <th style="padding:7px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;white-space:nowrap" class="admin-sort-th" data-sort="${field}">
      ${label}${sortArrow(field)}
    </th>`;

  const selStyle = 'font-size:12px;padding:3px 6px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-primary);color:var(--text-primary);width:100%';
  const fOpt = (val, label) => `<option value="${val}"${userFilters[label] === val ? ' selected' : ''}>`;
  const roleFilter = `<select onchange="window._adminFilterChange(this)" id="admin-filter-role" style="${selStyle}"><option value="">Все</option>${roles.map(r => `<option value="${r.id}"${userFilters.role == r.id ? ' selected' : ''}>${r.name}</option>`).join('')}</select>`;
  const teamFilter = `<select onchange="window._adminFilterChange(this)" id="admin-filter-team" style="${selStyle}"><option value="">Все</option>${teams.map(t => `<option value="${t.id}"${userFilters.team == t.id ? ' selected' : ''}>${t.name}</option>`).join('')}</select>`;
  const statusFilter = `<select onchange="window._adminFilterChange(this)" id="admin-filter-status" style="${selStyle}"><option value="">Все</option><option value="1"${userFilters.status == '1' ? ' selected' : ''}>Активен</option><option value="0"${userFilters.status == '0' ? ' selected' : ''}>Неактивен</option></select>`;

  const rows = users.length
    ? users.map(u => {
        const team = teams.find(t => t.id === u.team_id || t.name === u.team);
        const role = roles.find(r => r.id === u.role_id);
        const teamName = team ? team.name : (u.team || '—');
        const initials = window.getUserInitials(u.name);
        const avatarColor = window.getAvatarColor(u.name);
        return `
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color)">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:32px;height:32px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:white;flex-shrink:0">${initials}</div>
                <div>
                  <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${u.name}</div>
                </div>
              </div>
            </td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color)">
              ${role ? `<span class="badge badge-info" style="font-size:11px">${role.name}</span>` : '<span class="text-muted" style="font-size:12px">—</span>'}
            </td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color);color:var(--text-secondary);font-size:13px">${teamName}</td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color);color:var(--text-muted);font-size:12px">${u.email || '—'}</td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color)">${getStatusBadge(u.is_active)}</td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color);text-align:right">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="admin-edit-btn" data-type="user" data-id="${u.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                <button class="admin-delete-btn" data-type="user" data-id="${u.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Деактивировать">
                  <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">Нет пользователей</td></tr>';

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <div style="display:flex;gap:8px;align-items:center">
        <div style="position:relative">
          <i data-lucide="search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-muted)"></i>
          <input class="input" id="admin-user-search" value="${userSearch}" placeholder="Поиск..." style="padding-left:32px;padding-right:32px;font-size:13px;width:200px">
          ${userSearch ? `<button id="admin-user-search-clear" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;cursor:pointer;padding:2px;color:var(--text-muted);line-height:1" title="Очистить"><i data-lucide="x" style="width:12px;height:12px"></i></button>` : ''}
        </div>
        <button class="btn btn-primary btn-sm admin-add-btn" data-type="user">
          <i data-lucide="plus" style="width:14px;height:14px"></i> Новый
        </button>
      </div>
    </div>
    <div class="admin-section" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-tertiary)">
            ${th('name', 'Пользователь')}
            ${th('role', 'Роль')}
            ${th('team', 'Команда')}
            ${th('email', 'Email')}
            ${th('status', 'Статус')}
            <th style="padding:10px 16px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px"></th>
          </tr>
          <tr style="background:var(--bg-primary)">
            <th style="padding:3px 12px 6px"></th>
            <th style="padding:3px 12px 6px">${roleFilter}</th>
            <th style="padding:3px 12px 6px">${teamFilter}</th>
            <th style="padding:3px 12px 6px"></th>
            <th style="padding:3px 12px 6px">${statusFilter}</th>
            <th style="padding:3px 12px 6px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ==================== ROLES TAB ====================

function renderRolesTab(app) {
  const roles = adminData.roles || [];
  const permLevels = [
    { key: 'backlog_dmb_access', label: 'Бэклог DMB' },
    { key: 'backlog_team_access', label: 'Бэклог команды' },
    { key: 'reports_access', label: 'Статусы встреч' },
    { key: 'analytics_access', label: 'Аналитика' },
    { key: 'customer_access', label: 'Бизнес-заказчик' },
    { key: 'settings_access', label: 'Настройки' },
    { key: 'admin_access', label: 'Админ' },
  ];

  const rows = roles.length
    ? roles.map(r => {
        const perms = permLevels.map(p =>
          `<td style="padding:10px 12px;text-align:center;border-bottom:1px solid var(--border-color);font-size:11px;color:var(--text-muted)">${getAccessLabel(r[p.key] || 'none')}</td>`
        ).join('');
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color)">
              <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${r.name}</div>
              ${r.description ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${r.description}</div>` : ''}
            </td>
            ${perms}
            <td style="padding:10px 12px;text-align:center;border-bottom:1px solid var(--border-color)">${getRoleStatusBadge(r.status)}</td>
            <td style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border-color)">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="admin-edit-btn" data-type="role" data-id="${r.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                <button class="admin-delete-btn" data-type="role" data-id="${r.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
                  <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Нет ролей</td></tr>';

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="role">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Новая роль
      </button>
    </div>
    <div class="admin-section" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-tertiary)">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Роль</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Бэклог DMB</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Бэклог команды</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Статусы встреч</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Аналитика</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Бизнес-заказчик</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Настройки</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Админ</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Статус</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ==================== DICTIONARIES TAB ====================

function renderDictionariesTab(app) {
  const dicts = [
    { key: 'priorities', label: 'Приоритеты', icon: 'flag', count: (adminData.priorities || []).length, preview: (adminData.priorities || []).slice(0, 3) },
    { key: 'statuses', label: 'Статусы задачи', icon: 'circle', count: (adminData.statuses || []).length, preview: (adminData.statuses || []).slice(0, 3) },
    { key: 'taskTypes', label: 'Типы задач', icon: 'tag', count: (adminData.taskTypes || []).length, preview: (adminData.taskTypes || []).slice(0, 3) },
    { key: 'channels', label: 'Каналы', icon: 'radio', count: (adminData.channels || []).length, preview: (adminData.channels || []).slice(0, 3) },
    { key: 'deadlines', label: 'Сроки', icon: 'clock', count: (adminData.deadlines || []).length, preview: (adminData.deadlines || []).slice(0, 3) },
    { key: 'departments', label: 'Подразделения', icon: 'building', count: (adminData.departments || []).length, preview: (adminData.departments || []).slice(0, 3) },
    { key: 'teamTypes', label: 'Типы команд', icon: 'layers', count: (adminData.teamTypes || []).length, preview: (adminData.teamTypes || []).slice(0, 3) },
    { key: 'projectStatuses', label: 'Статусы проектов', icon: 'git-branch', count: (adminData.projectStatuses || []).length, preview: (adminData.projectStatuses || []).slice(0, 3) },
  ];

  const cards = dicts.map(d => {
    const previewItems = d.preview.map(v =>
      v.color
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:${v.color}20;color:${v.color};margin:2px">${v.name}</span>`
        : `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:var(--bg-tertiary);color:var(--text-muted);margin:2px">${v.name}</span>`
    ).join('');
    return `
      <div class="card rounded-xl p-5 card-hover admin-dict-card" data-dict="${d.key}" style="cursor:pointer;height:200px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:40px;height:40px;border-radius:10px;background:var(--bg-tertiary);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i data-lucide="${d.icon}" style="width:18px;height:18px;color:var(--accent)"></i>
          </div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px;color:var(--text-primary)">${d.label}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${d.count} значений</div>
          </div>
          <i data-lucide="chevron-right" style="width:16px;height:16px;color:var(--text-muted)"></i>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${previewItems || '<span style="font-size:12px;color:var(--text-muted)">Нет значений</span>'}</div>
      </div>
    `;
  }).join('');

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${cards}</div>
  `;
}

// ==================== REPORTS TAB ====================

function renderReportsTab(app) {
  const reports = adminData.reports.length
    ? adminData.reports
    : [
        { id: 1, name: 'Директорат', code: 'directorate', description: 'Команда, Бизнес-заказчик, Проект, Задача, Тип, Исполнитель, Статус для директорской', icon: 'crown', gradient: 'grad-rose', tasks: 0, filters: 2, fields: 7 },
        { id: 2, name: 'DID', code: 'did', description: 'Команда, Бизнес-заказчик, Проект, Задача, Тип, Исполнитель, Статус для ДИД', icon: 'building-2', gradient: 'grad-indigo', tasks: 0, filters: 1, fields: 7 },
        { id: 3, name: 'Проекты', code: 'projects', description: 'Статус по проектным инициативам', icon: 'target', gradient: 'grad-emerald', tasks: 0, filters: 3, fields: 10 },
        { id: 4, name: 'Рег-директора', code: 'reg-directors', description: 'Сводка для региональных директоров', icon: 'users', gradient: 'grad-violet', tasks: 0, filters: 2, fields: 7 },
      ];

  const cards = reports.map(r => `
    <div class="card rounded-xl p-5 report-card ${r.gradient}" style="color:white;cursor:pointer;min-height:160px;display:flex;flex-direction:column" data-report="${r.code}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <i data-lucide="${r.icon}" style="width:20px;height:20px;opacity:0.9"></i>
        <h4 style="margin:0;font-size:14px;font-weight:600;color:white">${r.name}</h4>
      </div>
      <div style="font-size:12px;opacity:0.85;flex:1">${r.description}</div>
      <div style="display:flex;gap:16px;margin-top:12px;font-size:11px;opacity:0.8">
        <span>Задач: ${r.tasks || '—'}</span>
        <span>Фильтров: ${r.filters || '—'}</span>
        <span>Полей: ${r.fields || '—'}</span>
      </div>
    </div>
  `).join('');

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${cards}</div>
  `;
}

// ==================== NOTIFICATIONS TAB ====================

// ==================== DISPLAY TAB ====================

const DISPLAY_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Задача' },
  { key: 'description', label: 'Описание' },
  { key: 'date_received', label: 'Дата получения' },
  { key: 'status', label: 'Статус' },
  { key: 'priority', label: 'Приоритет' },
  { key: 'team', label: 'Команда' },
  { key: 'channel', label: 'Канал' },
  { key: 'business_customer', label: 'Бизнес-заказчик' },
  { key: 'department', label: 'Подразделение' },
  { key: 'project', label: 'Проект' },
  { key: 'task_type', label: 'Тип задачи' },
  { key: 'involved_teams', label: 'Вовлечённые команды' },
  { key: 'deadline', label: 'Дедлайн' },
  { key: 'deadline_po', label: 'PO-дедлайн' },
  { key: 'effort_days', label: 'Трудозатраты (дни)' },
  { key: 'effort_rub', label: 'Трудозатраты (руб)' },
  { key: 'financial_effect', label: 'Фин. эффект' },
  { key: 'cv', label: 'C/V' },
  { key: 'ice_score', label: 'ICE' },
  { key: 'progress', label: 'Прогресс' },
  { key: 'owner', label: 'Владелец' },
  { key: 'responsible_po', label: 'Ответственный PO' },
  { key: 'business_analyst', label: 'Бизнес-аналитик' },
  { key: 'it_product_lead', label: 'IT Product Lead' },
  { key: 'key_project', label: 'Ключевой проект' },
  { key: 'key_project_status', label: 'Статус ключ. проекта' },
  { key: 'directorate_status', label: 'Статус для директорской' },
  { key: 'did_status', label: 'Статус для ДИД' },
  { key: 'is_from_leadership', label: 'От руководства' },
  { key: 'is_regular', label: 'Регулярная задача' },
  { key: 'what_if', label: 'What-If' },
  { key: 'dod', label: 'Definition of Done' },
  { key: 'link_mockups', label: 'Ссылка на макеты' },
  { key: 'link_jira', label: 'Ссылка на Jira' },
  { key: 'rejection_reason', label: 'Причина отклонения' },
  { key: 'comment', label: 'Комментарий' },
  { key: 'status_comment', label: 'Статус-комментарий' },
  { key: 'last_updated', label: 'Последнее обновление' },
  { key: 'created_at', label: 'Дата создания' },
  { key: 'updated_at', label: 'Дата изменения' },

];

const DISPLAY_DEFAULTS = {
  id: true, title: true, status: true, priority: true, team: true,
  progress: true, financial_effect: true, effort_days: true, cv: true,
  deadline: true, owner: false, channel: false,
  department: false, task_type: false,
  key_project_status: false, ice_score: false
};

let displaySettingsData = {};
let columnLabelsData = {};

function renderDisplayTab(app) {
  const KEY_MAP = { financial: 'financial_effect', effort: 'effort_days' };
  const raw = displaySettingsData.shared || displaySettingsData.backlog_dmb || {};
  const defaultOrder = DISPLAY_COLUMNS.map(c => c.key);
  const validKeys = new Set(defaultOrder);
  const cleaned = {};
  Object.keys(raw).forEach(k => {
    const mapped = KEY_MAP[k] || k;
    if (validKeys.has(mapped)) cleaned[mapped] = raw[k];
  });
  const visibility = Object.keys(cleaned).length > 0 ? cleaned : DISPLAY_DEFAULTS;
  defaultOrder.forEach(k => { if (!(k in visibility)) visibility[k] = DISPLAY_DEFAULTS[k] || false; });

  const items = defaultOrder.map(key => {
    const colDef = DISPLAY_COLUMNS.find(c => c.key === key);
    const label = columnLabelsData[key] || colDef.label;
    const checked = visibility[key];
    return `
      <div class="display-col-item" data-col="${key}" draggable="true" style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;font-size:13px;color:var(--text-primary);background:var(--bg-secondary);border:1px solid var(--border-color);cursor:grab;user-select:none;transition:background 0.15s, border-color 0.15s;" onmouseover="this.style.background='var(--bg-tertiary)'" onmouseout="this.style.borderColor='var(--border-color)';this.style.background=this.dataset.dragging === 'true' ? 'var(--accent-dim)' : 'var(--bg-secondary)'">
        <span style="cursor:grab;color:var(--text-muted);display:flex;align-items:center;flex-shrink:0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="12" x2="16" y2="12"></line><line x1="8" y1="18" x2="16" y2="18"></line></svg>
        </span>
        <input type="checkbox" class="display-col-cb" data-col="${key}" ${checked ? 'checked' : ''} style="width:16px;height:16px;margin:0;flex-shrink:0;">
        <input type="text" class="display-col-label-input" value="${label}" style="flex:1;min-width:100px;font-size:13px;padding:2px 6px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--text-primary);" onfocus="this.style.borderColor='var(--accent)';this.style.background='var(--bg-input)'" onblur="this.style.borderColor='transparent';this.style.background='transparent'">
        <span style="font-size:10px;color:var(--text-muted);font-family:monospace">${key}</span>
      </div>
    `;
  }).join('');

  return `
    <div style="max-width:900px">
      <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" id="save-display-settings">
          <i data-lucide="save" style="width:14px;height:14px"></i> Сохранить настройки
        </button>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="font-size:15px;font-weight:600;margin:0 0 4px 0;color:var(--text-primary)">Колонки бэклогов</h3>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px 0">Настройка применяется к обеим страницам (Бэклог DMB и Бэклог команды). Перетаскивайте колонки для изменения порядка. Отмечайте галочками видимые по умолчанию. Редактируйте названия колонок — изменения сохранятся в БД.</p>
        <div class="display-col-list" style="display:flex;flex-direction:column;gap:4px">${items}</div>
      </div>
    </div>
  `;
}

function bindDisplayEvents(app) {
  initDisplayDragDrop();
  document.getElementById('save-display-settings')?.addEventListener('click', async () => {
    const items = document.querySelectorAll('.display-col-item');
    const validKeys = new Set(DISPLAY_COLUMNS.map(c => c.key));
    const settings = {};
    const labels = {};
    items.forEach(item => {
      const cb = item.querySelector('.display-col-cb');
      const labelInput = item.querySelector('.display-col-label-input');
      const key = item.dataset.col;
      if (!validKeys.has(key)) return;
      settings[key] = cb.checked;
      const label = labelInput.value.trim();
      if (label) labels[key] = label;
    });
    try {
      await app.api.put('/admin/display-settings/shared', { settings });
      await app.api.put('/admin/column-labels', { labels });
      columnLabelsData = labels;
      displaySettingsData.shared = { ...settings };
      toast('Настройки отображения и названия колонок сохранены', 'success');
    } catch (e) {
      toast('Ошибка сохранения: ' + (e.message || 'Неизвестная ошибка'), 'error');
    }
  });
}

function initDisplayDragDrop() {
  document.querySelectorAll('.display-col-list').forEach(list => {
    let dragSrc = null;
    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.display-col-item');
      if (!item) return;
      dragSrc = item;
      item.dataset.dragging = 'true';
      item.style.opacity = '0.4';
      item.style.borderColor = 'var(--accent)';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.display-col-item');
      if (item) {
        item.dataset.dragging = 'false';
        item.style.opacity = '';
        item.style.borderColor = 'var(--border-color)';
      }
      list.querySelectorAll('.display-col-item').forEach(el => {
        el.dataset.dragging = 'false';
        el.style.borderColor = 'var(--border-color)';
        el.style.background = '';
      });
      dragSrc = null;
    });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.display-col-item');
      if (!target || target === dragSrc) return;
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      target.style.borderColor = 'var(--accent)';
      target.style.background = 'color-mix(in srgb, var(--accent) 20%, transparent)';
      target.dataset.dragging = 'true';
    });
    list.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.display-col-item');
      if (target) {
        target.style.borderColor = 'var(--border-color)';
        target.style.background = '';
        target.dataset.dragging = 'false';
      }
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = e.target.closest('.display-col-item');
      if (!target || !dragSrc || target === dragSrc) return;
      list.querySelectorAll('.display-col-item').forEach(el => {
        el.style.borderColor = 'var(--border-color)';
        el.style.background = '';
        el.dataset.dragging = 'false';
      });
      const srcIdx = Array.from(list.children).indexOf(dragSrc);
      const tgtIdx = Array.from(list.children).indexOf(target);
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        if (srcIdx < tgtIdx) {
          list.insertBefore(dragSrc, target.nextSibling);
        } else {
          list.insertBefore(dragSrc, target);
        }
      } else {
        if (srcIdx > tgtIdx) {
          list.insertBefore(dragSrc, target);
        } else {
          list.insertBefore(dragSrc, target.nextSibling);
        }
      }
    });
  });
}

// ==================== NOTIFICATIONS TAB ====================

function renderNotificationsTab(app) {
  const templates = adminData.notifications || [];
  const roles = adminData.roles || [];

  const rows = templates.length
    ? templates.map(t => {
        const freqLabels = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно', quarterly: 'Ежеквартально' };
        const freqText = t.repeat_frequency ? freqLabels[t.repeat_frequency] || t.repeat_frequency : '—';
        const deadlineText = t.deadline_days ? `За ${t.deadline_days} дн.` : '—';
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color)">
              <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${t.name}</div>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.text || ''}</td>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${t.recipients || '—'}</td>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary);text-align:center">${deadlineText}</td>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary);text-align:center">${freqText}</td>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);text-align:center">${t.is_active !== false ? '<span class="badge badge-success" style="font-size:11px">Активен</span>' : '<span class="badge badge-muted" style="font-size:11px">Неактивен</span>'}</td>
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);text-align:right">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="admin-edit-btn" data-type="notif" data-id="${t.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                <button class="admin-delete-btn" data-type="notif" data-id="${t.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
                  <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">Нет шаблонов уведомлений</td></tr>';

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="notif">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Новый шаблон
      </button>
    </div>
    <div class="admin-section" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-tertiary)">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Название</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Текст</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Адресаты</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Срок</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Регулярность</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Статус</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderNotifForm(data) {
  const roles = adminData.roles || [];
  const selectedRecipients = (data.recipients || '').split(',').map(s => s.trim()).filter(Boolean);
  const roleOpts = roles.map(r =>
    `<option value="${r.name}"${selectedRecipients.includes(r.name) ? ' selected' : ''}>${r.name}</option>`
  ).join('');
  const freqHidden = data.repeat_frequency ? '' : 'style="display:none"';
  return `
    <div class="form-group">
      <label class="form-label">Название <span class="required">*</span></label>
      <input class="input modal-field" id="modal-name" value="${data.name || ''}" placeholder="Например: Напоминание о дедлайне">
    </div>
    <div class="form-group">
      <label class="form-label">Текст уведомления <span class="required">*</span></label>
      <textarea class="input modal-field" id="modal-text" rows="4" placeholder="Текст уведомления..." style="min-height:80px">${data.text || ''}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Адресаты (роли)</label>
      <select class="input modal-field" id="modal-recipients" multiple style="min-height:90px">${roleOpts}</select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Ctrl+клик для выбора нескольких ролей</div>
    </div>
    <div class="form-group">
      <label class="form-label">Срок (дней до дедлайна)</label>
      <input class="input modal-field" id="modal-deadline-days" type="number" value="${data.deadline_days ?? ''}" placeholder="Например: 7" style="width:120px">
    </div>
    <div class="form-group">
      <label class="form-label">Регулярность повторения</label>
      <select class="input modal-field" id="modal-repeat-frequency" onchange="toggleRepeatDay(this.value)">
        <option value="">Не повторять</option>
        <option value="daily"${data.repeat_frequency === 'daily' ? ' selected' : ''}>Ежедневно</option>
        <option value="weekly"${data.repeat_frequency === 'weekly' ? ' selected' : ''}>Еженедельно</option>
        <option value="monthly"${data.repeat_frequency === 'monthly' ? ' selected' : ''}>Ежемесячно</option>
        <option value="quarterly"${data.repeat_frequency === 'quarterly' ? ' selected' : ''}>Ежеквартально</option>
      </select>
    </div>
    <div class="form-group" id="repeat-day-group" ${freqHidden}>
      <label class="form-label">День повтора</label>
      <input class="input modal-field" id="modal-repeat-day" type="number" value="${data.repeat_day ?? ''}" placeholder="1-7 (день недели) или 1-31" style="width:120px">
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Для еженедельно: 1=Пн..7=Вс. Для ежемесячно: число месяца</div>
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select class="input modal-field" id="modal-is-active">
        <option value="1"${data.is_active !== false ? ' selected' : ''}>Активен</option>
        <option value="0"${data.is_active === false ? ' selected' : ''}>Неактивен</option>
      </select>
    </div>
  `;
}

window.toggleRepeatDay = function(value) {
  const group = document.getElementById('repeat-day-group');
  if (group) group.style.display = value ? '' : 'none';
};

// ==================== MODALS ====================

function renderModal() {
  if (!adminModal.show) return '';
  const { mode, type, data } = adminModal;
  const isEdit = mode === 'edit';
  const isView = mode === 'view';
  const titleLabels = { team: 'команды', user: 'пользователя', role: 'роли', dict: 'справочника', notif: 'шаблона уведомления', project: 'проекта', bc: 'бизнес-заказчика' };
  const title = isEdit ? `Редактирование ${titleLabels[type] || type}` : (isView ? `Просмотр ${titleLabels[type] || type}` : `Добавление ${titleLabels[type] || type}`);

  let body = '';
  if (type === 'team') body = renderTeamForm(data);
  else if (type === 'user') body = renderUserForm(data);
  else if (type === 'role') body = renderRoleForm(data);
  else if (type === 'dict') body = renderDictForm(data);
  else if (type === 'notif') body = renderNotifForm(data);
  else if (type === 'project') body = renderProjectForm(data);
  else if (type === 'bc') body = renderBusinessCustomerForm(data);

  return `
    <div class="admin-modal-overlay" id="admin-modal-overlay" style="z-index:1000">
      <div class="admin-modal" style="max-width:${type === 'role' ? '700' : (type === 'notif' || type === 'project' || type === 'bc') ? '600' : '520'}px">
        <div class="modal-header-sticky">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
            <h3 style="margin:0;font-size:16px;font-weight:600">${title}</h3>
            <button class="modal-close-x" style="width:32px;height:32px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
              <i data-lucide="x" style="width:18px;height:18px;color:var(--text-muted)"></i>
            </button>
          </div>
        </div>
        <div class="modal-body-scroll">
          <div id="modal-form-body">${body}</div>
        </div>
        <div class="modal-footer-sticky">
          ${type === 'project' && isView ? `
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3)">
            <button class="btn btn-secondary modal-cancel-btn">Закрыть</button>
          </div>` : type !== 'dict' ? `
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3)">
            <button class="btn btn-secondary modal-cancel-btn">Отмена</button>
            <button class="btn btn-primary modal-save-btn">${isEdit ? 'Сохранить' : 'Создать'}</button>
          </div>` : `
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3)">
            <button class="btn btn-secondary modal-cancel-btn">Отмена</button>
            <button class="btn btn-primary modal-save-btn">Сохранить</button>
          </div>`}
        </div>
      </div>
    </div>
  `;
}

const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#2563eb', '#7c3aed', '#475569',
  '#64748b', '#94a3b8', '#78716c', '#d97706', '#dc2626',
  '#059669', '#0284c7', '#9333ea', '#db2777', '#65a30d',
];

function renderTeamForm(data) {
  const colorSwatches = COLOR_PALETTE.map(c =>
    `<span class="color-swatch ${data.color === c ? 'active' : ''}" data-color="${c}" style="background:${c};"></span>`
  ).join('');
  const users = adminData.users || [];
  const teamTypes = adminData.teamTypeRefs || [];
  const typeOpts = teamTypes.map(tt => `<option value="${tt.id}"${data.team_type_id == tt.id ? ' selected' : ''}>${tt.name}</option>`).join('');
  return `
    <div class="form-group">
      <label class="form-label">Название команды <span class="required">*</span></label>
      <input class="input modal-field" id="modal-name" value="${data.name || ''}" placeholder="Название">
    </div>
    <div class="form-group">
      <label class="form-label">Аббревиатура (на аватаре)</label>
      <input class="input modal-field" id="modal-abbr" value="${data.abbr || ''}" placeholder="Напр: PT" maxlength="4" style="width:100px">
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">1-4 буквы, отображаются на аватаре команды</div>
    </div>
    <div class="form-group">
      <label class="form-label">Тип команды</label>
      <select class="input modal-field" id="modal-team-type"><option value="">—</option>${typeOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Цвет</label>
      <input type="hidden" id="modal-color" value="${data.color || '#6366f1'}">
      <div id="color-palette" style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;">${colorSwatches}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Product Leader (PL)</label>
      <select class="input modal-field" id="modal-pl">
        <option value="">—</option>
        ${users.map(u => `<option value="${u.name}"${data.pl === u.name ? ' selected' : ''}>${u.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Product Owner (PO)</label>
      <select class="input modal-field" id="modal-po">
        <option value="">—</option>
        ${users.map(u => `<option value="${u.name}"${data.po === u.name ? ' selected' : ''}>${u.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Cluster Lead (CL)</label>
      <select class="input modal-field" id="modal-cl">
        <option value="">—</option>
        ${users.map(u => `<option value="${u.name}"${data.cl === u.name ? ' selected' : ''}>${u.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">IT Product Lead (IT PL)</label>
      <select class="input modal-field" id="modal-it-pl">
        <option value="">—</option>
        ${users.map(u => `<option value="${u.name}"${data.it_pl === u.name ? ' selected' : ''}>${u.name}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="input modal-field" id="modal-description" placeholder="Описание команды" style="min-height:60px">${data.description || ''}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Домен</label>
      <input class="input modal-field" id="modal-domain" value="${data.domain || ''}" placeholder="Домен">
    </div>
  `;
}

function renderUserForm(data) {
  const teams = adminData.teams || [];
  const roles = adminData.roles || [];
  const teamOpts = teams.map(t => `<option value="${t.id}"${data.team_id == t.id ? ' selected' : ''}>${t.name}</option>`).join('');
  const roleOpts = roles.map(r => `<option value="${r.id}"${data.role_id == r.id ? ' selected' : ''}>${r.name}</option>`).join('');
  const initials = window.getUserInitials(data.name);
  const avatarColor = window.getAvatarColor(data.name);
  return `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
      <div id="user-avatar-preview" style="width:56px;height:56px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:white;flex-shrink:0">${initials}</div>
      <div style="font-size:13px;color:var(--text-muted)">Аватар формируется автоматически по первой букве имени и фамилии</div>
    </div>
    <div class="form-group">
      <label class="form-label">ФИО</label>
      <input class="input modal-field" id="modal-name" value="${data.name || ''}" placeholder="ФИО пользователя" oninput="updateUserAvatarPreview(this.value)">
    </div>
    <div class="form-group">
      <label class="form-label">Email</label>
      <input class="input modal-field" id="modal-email" value="${data.email || ''}" placeholder="Email" type="email">
    </div>
    <div class="form-group">
      <label class="form-label">Роль</label>
      <select class="input modal-field" id="modal-role"><option value="">—</option>${roleOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Команда</label>
      <select class="input modal-field" id="modal-team"><option value="">—</option>${teamOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select class="input modal-field" id="modal-is-active">
        <option value="1"${data.is_active !== false ? ' selected' : ''}>Активен</option>
        <option value="0"${data.is_active === false ? ' selected' : ''}>Неактивен</option>
      </select>
    </div>
  `;
}

function renderRoleForm(data) {
  const permFields = [
    { key: 'backlog_dmb_access', label: 'Бэклог DMB', opts: ['none','read','read_write'] },
    { key: 'backlog_team_access', label: 'Бэклог команды', opts: ['none','read_own','write_own','read_all','write_all'] },
    { key: 'reports_access', label: 'Статусы для встреч', opts: ['none','read','read_write'] },
    { key: 'analytics_access', label: 'Аналитика', opts: ['none','read','read_write'] },
    { key: 'customer_access', label: 'Портал бизнес-заказчика', opts: ['none','read','read_write'] },
    { key: 'settings_access', label: 'Настройки', opts: ['none','available'] },
    { key: 'admin_access', label: 'Администрирование', opts: ['none','partial','full'] },
  ];
  const permHtml = permFields.map(p => {
    const isAdminField = p.key === 'admin_access';
    const isOwnRole = currentAdminUser && data.id === currentAdminUser.role_id;
    const blocked = isAdminField && isOwnRole;
    const opts = p.opts.map(o => {
      const disabled = blocked && o === 'none' ? ' disabled' : '';
      const selected = data[p.key] === o ? ' selected' : '';
      return `<option value="${o}"${selected}${disabled}>${getAccessLabel(o)}${disabled ? ' (заблокировано)' : ''}</option>`;
    }).join('');
    return `
      <div class="form-group">
        <label class="form-label">${p.label}${blocked ? ' <span style="color:#f43f5e;font-size:11px">— нельзя лишить себя доступа</span>' : ''}</label>
        <select class="input modal-field" id="modal-${p.key}">${opts}</select>
      </div>
    `;
  }).join('');

  return `
    <div class="form-group">
      <label class="form-label">Название роли <span class="required">*</span></label>
      <input class="input modal-field" id="modal-name" value="${data.name || ''}" placeholder="Название">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <input class="input modal-field" id="modal-description" value="${data.description || ''}" placeholder="Описание">
    </div>
    <div style="margin:16px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border-color)">
      <strong style="font-size:14px">Права доступа</strong>
    </div>
    ${permHtml}
  `;
}

function renderDictForm(data) {
  const items = data.items || [];
  const list = items.map((item, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px" data-item-id="${item.id || ''}">
      <input type="hidden" class="dict-color-input" value="${item.color || autoDictColor(item.name)}">
      <span class="dict-color-swatch" style="display:inline-block;width:28px;height:28px;border-radius:6px;background:${item.color || autoDictColor(item.name)};cursor:pointer;border:1px solid var(--border-color);flex-shrink:0;" onclick="openDictColorPalette(this)"></span>
      <input class="input dict-value-input" value="${item.name}" placeholder="Значение" style="flex:1" oninput="autoFillDictRow(this)">
      <input class="input dict-code-input" value="${item.code || ''}" placeholder="Код" style="width:100px" oninput="markDictEdited(this)">
      <button class="dict-remove-btn" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#f43f5e" title="Удалить">
        <i data-lucide="x" style="width:14px;height:14px"></i>
      </button>
    </div>
  `).join('');

  return `
    <h4 style="font-size:14px;font-weight:600;margin-bottom:12px">${data.dictLabel}</h4>
    <div id="dict-items-container">${list || '<p class="text-muted" style="font-size:13px">Нет значений</p>'}</div>
    <button class="btn btn-primary btn-sm" id="dict-add-value" style="margin-top:8px">
      <i data-lucide="plus" style="width:14px;height:14px"></i> Добавить значение
    </button>
  `;
}

window.openDictColorPalette = function(swatch) {
    const existing = document.querySelector('.dict-color-popup');
    if (existing) existing.remove();

    const currentColor = swatch.previousElementSibling.value || '#6366f1';
    const popup = document.createElement('div');
    popup.className = 'dict-color-popup';
    popup.style.cssText = 'position:absolute;z-index:1000;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.25);display:flex;flex-wrap:wrap;gap:4px;width:196px;';
    COLOR_PALETTE.forEach(c => {
        const dot = document.createElement('span');
        dot.className = 'color-swatch' + (c === currentColor ? ' active' : '');
        dot.style.cssText = `background:${c};width:22px;height:22px;border-radius:4px;cursor:pointer;border:2px solid ${c === currentColor ? 'var(--accent)' : 'transparent'};`;
        dot.onclick = (e) => {
            e.stopPropagation();
            swatch.style.background = c;
            swatch.previousElementSibling.value = c;
            markDictEdited(swatch.previousElementSibling);
            popup.remove();
        };
        popup.appendChild(dot);
    });
    swatch.parentElement.style.position = 'relative';
    swatch.parentElement.appendChild(popup);

    const closePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== swatch) {
            popup.remove();
            document.removeEventListener('click', closePopup);
        }
    };
    setTimeout(() => document.addEventListener('click', closePopup), 0);
};

// ==================== EVENT HANDLERS ====================

function handleAdminClick(e, app) {
  const target = e.target.closest('button, .modal-close-x, .admin-dict-card, [data-report], .color-swatch, .admin-sort-th');
  if (!target) return;

  if (target.classList.contains('admin-sort-th')) {
    const field = target.dataset.sort;
    if (userSort.field === field) {
      userSort.dir = userSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      userSort.field = field;
      userSort.dir = 'asc';
    }
    document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    if (window.lucide) lucide.createIcons();
    bindAdminEvents(app);
    return;
  }

  if (target.classList.contains('modal-close-x') || target.classList.contains('modal-cancel-btn')) {
    adminModal.show = false;
    const overlay = document.getElementById('admin-modal-overlay');
    if (overlay) overlay.remove();
    return;
  }

  if (target.closest('.color-swatch')) {
    const swatch = target.closest('.color-swatch');
    document.querySelectorAll('.color-swatch').forEach(s => { s.style.borderColor = 'transparent'; });
    swatch.style.borderColor = 'var(--accent)';
    document.getElementById('modal-color').value = swatch.dataset.color;
    return;
  }

  if (target.classList.contains('modal-save-btn')) {
    saveModalData(app);
    return;
  }

  if (target.id === 'project-add-btn') {
    adminModal = { show: true, mode: 'add', type: 'project', data: {} };
    refreshModal();
    return;
  }

  if (target.id === 'bc-add-btn') {
    adminModal = { show: true, mode: 'add', type: 'bc', data: {} };
    refreshModal();
    return;
  }

  if (target.classList.contains('admin-add-btn')) {
    adminModal = { show: true, mode: 'add', type: target.dataset.type, data: {} };
    refreshModal();
    return;
  }

  if (target.classList.contains('admin-edit-btn')) {
    const type = target.dataset.type;
    const id = parseInt(target.dataset.id);
    const keyMap = { team: 'teams', user: 'users', role: 'roles', notif: 'notifications', project: 'projects', bc: 'businessCustomers' };
    const item = (adminData[keyMap[type]] || []).find(d => d.id === id);
    if (!item) return;
    adminModal = { show: true, mode: 'edit', type, data: { ...item } };
    refreshModal();
    return;
  }

  if (target.classList.contains('admin-delete-btn')) {
    confirmDelete(target.dataset.type, parseInt(target.dataset.id), app);
    return;
  }

  if (target.classList.contains('admin-dict-card')) {
    openDictModal(target.dataset.dict, app);
    return;
  }

  if (target.hasAttribute('data-report')) {
    const code = target.getAttribute('data-report');
    toast(`Настройка отчёта "${code}" — в разработке`, 'info');
    return;
  }
}

function handleDictEvents(e, app) {
  const target = e.target;

  if (target.id === 'dict-add-value') {
    const container = document.getElementById('dict-items-container');
    if (!container) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px';
    const defaultColor = autoDictColor('');
    row.innerHTML = `
      <input type="hidden" class="dict-color-input" value="${defaultColor}">
      <span class="dict-color-swatch" style="display:inline-block;width:28px;height:28px;border-radius:6px;background:${defaultColor};cursor:pointer;border:1px solid var(--border-color);flex-shrink:0;" onclick="openDictColorPalette(this)"></span>
      <input class="input dict-value-input" value="" placeholder="Значение" style="flex:1" oninput="autoFillDictRow(this)">
      <input class="input dict-code-input" value="" placeholder="Код" style="width:100px" oninput="markDictEdited(this)">
      <button class="dict-remove-btn" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;color:#f43f5e" title="Удалить">
        <i data-lucide="x" style="width:14px;height:14px"></i>
      </button>
    `;
    container.appendChild(row);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.classList.contains('dict-remove-btn')) {
    const row = target.closest('div[data-item-id], div[style]');
    if (row) row.remove();
    return;
  }

  if (target.classList.contains('dict-color-input') || target.classList.contains('dict-value-input') || target.classList.contains('dict-code-input')) {
    return;
  }
}

function handleAdminTabClick(e, app) {
  const btn = e.target.closest('.admin-tab[data-tab]');
  if (!btn) return;
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  adminTab = btn.dataset.tab;
  const content = document.getElementById('admin-content');
  if (content) {
    content.innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    if (window.lucide) lucide.createIcons();
    bindAdminEvents(app);
  }
}

// ==================== MODAL DATA SAVE ====================

function getFieldVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function getCheckVal(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function saveModalData(app) {
  const { type, mode, data } = adminModal;
  if (type === 'team') {
    const payload = {
      name: getFieldVal('modal-name'),
      abbr: getFieldVal('modal-abbr') || null,
      team_type_id: parseInt(getFieldVal('modal-team-type')) || null,
      color: getFieldVal('modal-color') || '#6366f1',
      pl: getFieldVal('modal-pl'),
      po: getFieldVal('modal-po'),
      cl: getFieldVal('modal-cl'),
      it_pl: getFieldVal('modal-it-pl'),
      description: getFieldVal('modal-description'),
      domain: getFieldVal('modal-domain'),
    };
    if (!payload.name) { toast('Введите название команды', 'error'); return; }
    saveEntity('team', { ...data, ...payload }, app);
  } else if (type === 'user') {
    const teamId = parseInt(getFieldVal('modal-team')) || null;
    const payload = {
      name: getFieldVal('modal-name'),
      email: getFieldVal('modal-email'),
      role_id: parseInt(getFieldVal('modal-role')) || null,
      team_id: teamId,
      is_active: getFieldVal('modal-is-active') === '1',
    };
    if (!payload.name || !payload.email) { toast('Заполните ФИО и email', 'error'); return; }
    const duplicateName = (adminData.users || []).find(u => u.name === payload.name && u.id !== data.id);
    if (duplicateName) {
      toast(`Пользователь с именем "${payload.name}" уже существует`, 'error');
      return;
    }
    if (mode === 'add') {
      payload.password = 'dmb2026';
    }
    saveEntity('user', { ...data, ...payload }, app);
  } else if (type === 'role') {
    const payload = {
      name: getFieldVal('modal-name'),
      description: getFieldVal('modal-description'),
      backlog_dmb_access: getFieldVal('modal-backlog_dmb_access') || 'none',
      backlog_team_access: getFieldVal('modal-backlog_team_access') || 'none',
      reports_access: getFieldVal('modal-reports_access') || 'none',
      analytics_access: getFieldVal('modal-analytics_access') || 'none',
      customer_access: getFieldVal('modal-customer_access') || 'none',
      settings_access: getFieldVal('modal-settings_access') || 'none',
      admin_access: getFieldVal('modal-admin_access') || 'none',
    };
    if (!payload.name) { toast('Введите название роли', 'error'); return; }
    saveEntity('role', { ...data, ...payload }, app);
  } else if (type === 'notif') {
    const sel = document.getElementById('modal-recipients');
    const selectedRoles = sel ? Array.from(sel.selectedOptions).map(o => o.value) : [];
    const payload = {
      name: getFieldVal('modal-name'),
      text: getFieldVal('modal-text'),
      recipients: selectedRoles.join(', '),
      deadline_days: parseInt(getFieldVal('modal-deadline-days')) || null,
      repeat_frequency: getFieldVal('modal-repeat-frequency') || null,
      repeat_day: parseInt(getFieldVal('modal-repeat-day')) || null,
      is_active: getFieldVal('modal-is-active') === '1',
    };
    if (!payload.name || !payload.text) { toast('Заполните название и текст уведомления', 'error'); return; }
    saveEntity('notif', { ...data, ...payload }, app);
} else if (type === 'project') {
    const payload = getProjectPayload();
    if (!payload.code) { toast('Код проекта обязателен', 'error'); return; }
    if (!payload.name) { toast('Название проекта обязательно', 'error'); return; }
    saveEntity('project', { ...data, ...payload }, app);
  } else if (type === 'bc') {
    const payload = getBusinessCustomerPayload();
    if (!payload.name) { toast('ФИО бизнес-заказчика обязательно', 'error'); return; }
    saveEntity('bc', { ...data, ...payload }, app);
  } else if (type === 'dict') {
    saveDictData(app);
  }
}

async function saveDictData(app) {
  const { data } = adminModal;
  const rows = document.querySelectorAll('#dict-items-container > div');
  const items = Array.from(rows).map(row => {
    const colorInput = row.querySelector('.dict-color-input');
    const codeInput = row.querySelector('.dict-code-input');
    const valueInput = row.querySelector('.dict-value-input');
    return {
      id: row.dataset.itemId ? parseInt(row.dataset.itemId) : null,
      name: valueInput ? valueInput.value : '',
      code: codeInput ? codeInput.value : '',
      color: colorInput ? colorInput.value : '',
    };
  });

  const validItems = items.filter(i => i.name.trim());

  const dictTypeMap = {
    priorities: { type: 'priority', endpoint: 'priorities' },
    statuses: { type: 'status', endpoint: 'statuses' },
    taskTypes: { type: 'task_type', endpoint: 'task-types' },
    channels: { type: 'channel', endpoint: 'channels' },
    deadlines: { type: 'deadline', endpoint: 'deadlines' },
    departments: { type: 'department', endpoint: 'departments' },
    teamTypes: { type: 'team_type', endpoint: 'team-types' },
    projectStatuses: { type: 'project_status', endpoint: 'project-statuses' },
  };
  const config = dictTypeMap[data.dictKey];
  if (!config) return;

  const existingIds = new Set((data.items || []).filter(i => i.id).map(i => i.id));
  const newIds = new Set(validItems.filter(i => i.id).map(i => i.id));
  const toDelete = [...existingIds].filter(id => !newIds.has(id));

  try {
    for (const item of validItems) {
      const payload = { dict_type: config.type, name: item.name, code: item.code, color: item.color || '#6366f1', sort_order: 1 };
      if (item.id) {
        await app.api.put(`/admin/${config.endpoint}/${item.id}`, payload);
      } else {
        await app.api.post(`/admin/${config.endpoint}`, payload);
      }
    }
    for (const id of toDelete) {
      await app.api.delete(`/admin/${config.endpoint}/${id}`);
    }
    adminModal.show = false;
    document.getElementById('admin-modal-root').innerHTML = '';
    toast('Справочник сохранён', 'success');
    await initAdmin(app);
  } catch (e) {
    toast('Ошибка сохранения: ' + e.message, 'error');
  }
}

async function saveEntity(type, data, app) {
  const endpointMap = {
    team: '/admin/teams',
    user: '/admin/users',
    role: '/admin/roles',
    notif: '/admin/notification-templates',
    project: '/admin/projects',
    bc: '/admin/business-customers',
  };
  const endpoint = endpointMap[type];
  if (!endpoint) return;

  try {
    if (data.id) {
      await app.api.put(`${endpoint}/${data.id}`, data);
    } else {
      await app.api.post(endpoint, data);
    }
    adminModal.show = false;
    document.getElementById('admin-modal-root').innerHTML = '';
    toast('Сохранено', 'success');
    await initAdmin(app);
  } catch (e) {
    toast('Ошибка: ' + (e.message || 'Неизвестная ошибка'), 'error');
  }
}

async function confirmDelete(type, id, app) {
  const typeLabel = { team: 'команду', user: 'пользователя', role: 'роль', notif: 'шаблон уведомления', project: 'проект', bc: 'бизнес-заказчика' };
  if (!confirm(`Вы уверены? ${(typeLabel[type] || type)} будет полностью удален из системы.`)) return;
  const endpointMap = {
    team: '/admin/teams',
    user: '/admin/users',
    role: '/admin/roles',
    notif: '/admin/notification-templates',
    project: '/admin/projects',
    bc: '/admin/business-customers',
  };
  const endpoint = endpointMap[type];
  if (!endpoint) return;

  try {
    await app.api.delete(`${endpoint}/${id}`);
    toast('Удалено', 'success');
    await initAdmin(app);
  } catch (e) {
    toast('Ошибка: ' + (e.message || 'Неизвестная ошибка'), 'error');
  }
}

function openDictModal(dictKey, app) {
  const keyMap = { priorities: 'priorities', statuses: 'statuses', taskTypes: 'taskTypes', channels: 'channels', deadlines: 'deadlines', departments: 'departments', teamTypes: 'teamTypes', projectStatuses: 'projectStatuses' };
  const labelMap = { priorities: 'Приоритеты', statuses: 'Статусы задачи', taskTypes: 'Типы задач', channels: 'Каналы', deadlines: 'Сроки', departments: 'Подразделения', teamTypes: 'Типы команд', projectStatuses: 'Статусы проектов' };
  adminModal = {
    show: true,
    mode: 'view',
    type: 'dict',
    data: {
      dictKey,
      dictLabel: labelMap[dictKey] || dictKey,
      dictType: dictKey,
      items: (adminData[keyMap[dictKey]] || []).map(i => ({ id: i.id, name: i.name, code: i.code, color: i.color })),
    },
  };
  refreshModal();
}

function refreshModal() {
  const root = document.getElementById('admin-modal-root');
  if (root) {
    root.innerHTML = renderModal();
    if (window.lucide) lucide.createIcons();
  }
}

function renderProjectForm(data) {
  const projectStatuses = adminData.projectStatuses || [];
  const users = adminData.users || [];
  const statusOpts = projectStatuses.map(s => `<option value="${s.id}"${data.status_id == s.id ? ' selected' : ''}>${s.name}</option>`).join('');
  const plOpts = users.map(u => `<option value="${u.id}"${data.responsible_pl == u.id ? ' selected' : ''}>${u.name}</option>`).join('');
  const isEdit = adminModal.mode === 'edit';
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">ID</label>
        <input class="input modal-field" value="${data.id || '—'}" readonly style="color:var(--text-muted)">
      </div>
      <div class="form-group">
        <label class="form-label">Дата создания</label>
        <input class="input modal-field" value="${data.created_at ? data.created_at.slice(0, 10) : '—'}" readonly style="color:var(--text-muted)">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Код проекта <span class="required">*</span></label>
      <input class="input modal-field" id="project-code" value="${data.code || ''}" placeholder="Код проекта" ${isEdit ? 'readonly' : ''}>
    </div>
    <div class="form-group">
      <label class="form-label">Название <span class="required">*</span></label>
      <input class="input modal-field" id="project-name" value="${data.name || ''}" placeholder="Название проекта">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="input modal-field" id="project-description" placeholder="Описание проекта" style="min-height:60px">${data.description || ''}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select class="input modal-field" id="project-status"><option value="">—</option>${statusOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Ответственный PL</label>
      <select class="input modal-field" id="project-pl"><option value="">—</option>${plOpts}</select>
    </div>
  `;
}

function getProjectPayload() {
  return {
    code: getFieldVal('project-code'),
    name: getFieldVal('project-name'),
    description: getFieldVal('project-description') || null,
    status_id: parseInt(getFieldVal('project-status')) || null,
    responsible_pl: parseInt(getFieldVal('project-pl')) || null,
  };
}

// ==================== BIND EVENTS ====================

function bindAdminEvents(app) {
  const page = document.getElementById('page-content');
  if (!page) return;

  page.removeEventListener('click', window._adminClick);
  page.removeEventListener('click', window._adminDictClick);
  window._adminClick = (e) => handleAdminClick(e, app);
  window._adminDictClick = (e) => handleDictEvents(e, app);
  page.addEventListener('click', window._adminClick);
  page.addEventListener('click', window._adminDictClick);

  // Column filters
  window._adminFilterChange = (sel) => {
    if (sel.id === 'admin-filter-role') userFilters.role = sel.value;
    else if (sel.id === 'admin-filter-team') userFilters.team = sel.value;
    else if (sel.id === 'admin-filter-status') userFilters.status = sel.value;
    document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    if (window.lucide) lucide.createIcons();
    bindAdminEvents(app);
  };

  // Search input with debounce
  const searchEl = document.getElementById('admin-user-search');
  if (searchEl) {
    searchEl.removeEventListener('input', window._adminSearch);
    window._adminSearch = (e) => {
      userSearch = e.target.value;
      clearTimeout(window._searchTimer);
      window._searchTimer = setTimeout(() => {
        document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
        pullStickyBars();
        if (window.lucide) lucide.createIcons();
        bindAdminEvents(app);
      }, 300);
    };
    searchEl.addEventListener('input', window._adminSearch);
  }

  // Clear search button
  const clearBtn = document.getElementById('admin-user-search-clear');
  if (clearBtn) {
    clearBtn.removeEventListener('click', window._adminClearSearch);
    window._adminClearSearch = () => {
      userSearch = '';
      document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
      pullStickyBars();
      if (window.lucide) lucide.createIcons();
      bindAdminEvents(app);
    };
    clearBtn.addEventListener('click', window._adminClearSearch);
  }

  const tabBar = document.getElementById('admin-tab-bar');
  if (tabBar) {
    tabBar.removeEventListener('click', window._adminTabClick);
    window._adminTabClick = (e) => handleAdminTabClick(e, app);
    tabBar.addEventListener('click', window._adminTabClick);
  }

  if (adminTab === 'display') {
    bindDisplayEvents(app);
  }
}

// ==================== INIT ====================

export async function initAdmin(app) {
  try {
    currentAdminUser = app.store.get('currentUser');
    const [teams, users, roles, businessCustomers, priorities, statuses, taskTypes, channels, deadlines, departments, teamTypes, projectStatuses, projects, notifications, teamTypeRefs, displaySettings, columnLabels] = await Promise.all([
      app.api.get('/admin/teams').catch(() => []),
      app.api.get('/admin/users').catch(() => []),
      app.api.get('/admin/roles').catch(() => []),
      app.api.get('/admin/business-customers').catch(() => []),
      app.api.get('/admin/priorities').catch(() => []),
      app.api.get('/admin/statuses').catch(() => []),
      app.api.get('/admin/task-types').catch(() => []),
      app.api.get('/admin/channels').catch(() => []),
      app.api.get('/admin/deadlines').catch(() => []),
      app.api.get('/admin/departments').catch(() => []),
      app.api.get('/admin/team-types').catch(() => []),
      app.api.get('/admin/project-statuses').catch(() => []),
      app.api.get('/admin/projects').catch(() => []),
      app.api.get('/admin/notification-templates').catch(() => []),
      app.api.get('/admin/team-types-ref').catch(() => []),
      app.api.get('/admin/display-settings').catch(() => []),
      app.api.get('/admin/column-labels').catch(() => ({})),
    ]);

    adminData.teams = Array.isArray(teams) ? teams : (teams.items || []);
    adminData.users = Array.isArray(users) ? users : (users.items || []);
    adminData.roles = Array.isArray(roles) ? roles : (roles.items || []);
    adminData.businessCustomers = Array.isArray(businessCustomers) ? businessCustomers : (businessCustomers.items || []);
    adminData.priorities = Array.isArray(priorities) ? priorities : (priorities.items || []);
    adminData.statuses = Array.isArray(statuses) ? statuses : (statuses.items || []);
    adminData.taskTypes = Array.isArray(taskTypes) ? taskTypes : (taskTypes.items || []);
    adminData.channels = Array.isArray(channels) ? channels : (channels.items || []);
    adminData.deadlines = Array.isArray(deadlines) ? deadlines : (deadlines.items || []);
    adminData.departments = Array.isArray(departments) ? departments : (departments.items || []);
    adminData.teamTypes = Array.isArray(teamTypes) ? teamTypes : (teamTypes.items || []);
    adminData.projectStatuses = Array.isArray(projectStatuses) ? projectStatuses : (projectStatuses.items || []);
    adminData.projects = Array.isArray(projects) ? projects : (projects.items || []);
    adminData.notifications = Array.isArray(notifications) ? notifications : (notifications.items || []);
    adminData.teamTypeRefs = Array.isArray(teamTypeRefs) ? teamTypeRefs : [];

    const dsList = Array.isArray(displaySettings) ? displaySettings : (displaySettings.items || []);
    displaySettingsData = {};
    dsList.forEach(ds => {
      if (ds.page === 'backlog_dmb' || ds.page === 'team_backlog' || ds.page === 'shared') {
        displaySettingsData[ds.page] = ds.settings;
      }
    });
    columnLabelsData = (typeof columnLabels === 'object' && columnLabels !== null) ? columnLabels : {};

    const content = document.getElementById('admin-content');
    if (content) {
      content.innerHTML = renderTabContent(adminTab, app);
      pullStickyBars();
      if (window.lucide) lucide.createIcons();
      bindAdminEvents(app);
    }
  } catch (e) {
    console.error('Admin init error:', e);
  }
}
