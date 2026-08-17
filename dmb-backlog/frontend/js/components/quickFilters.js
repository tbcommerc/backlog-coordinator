console.log('[DMB] quickFilters.js loaded');

import { columnFilters, renderFilterButtons, filterChangeCallbacks, isDeadlinePast, isCurrentTask, isLastQuarterTask } from './filterToolbar.js?v=47';

const TERMINAL_STATUSES = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];

const QUICK_FILTERS = [
  {
    key: 'overdue',
    label: 'Просрочено',
    icon: '<i data-lucide="alert-circle" style="width:16px;height:16px;"></i>',
    iconBg: 'background:var(--danger-light);color:var(--danger);',
    test: (t) => t.deadline_id != null && !TERMINAL_STATUSES.includes(t.status_name) && isDeadlinePast(t.deadline_name),
  },
  {
    key: 'urgent',
    label: 'Важные задачи',
    icon: '<i data-lucide="flame" style="width:16px;height:16px;"></i>',
    iconBg: 'background:var(--warning-light);color:var(--warning);',
    test: (t) => t.priority_name === 'ВЫСОКИЙ',
  },
  {
    key: 'active',
    label: 'В работе',
    icon: '<i data-lucide="activity" style="width:16px;height:16px;"></i>',
    iconBg: 'background:var(--info-light);color:var(--info);',
    test: (t) => !!t.status_name && !TERMINAL_STATUSES.includes(t.status_name) && t.status_name !== 'ХОЛД',
  },
  {
    key: 'hold',
    label: 'Холд',
    icon: '<i data-lucide="pause-circle" style="width:16px;height:16px;"></i>',
    iconBg: 'background:var(--warning-light);color:var(--warning);',
    test: (t) => t.status_name === 'ХОЛД',
  },
  {
    key: 'rejected',
    label: 'Отклонённые',
    icon: '<i data-lucide="x-circle" style="width:16px;height:16px;"></i>',
    iconBg: 'background:var(--danger-light);color:var(--danger);',
    test: (t) => t.status_name === 'ОТКЛОНЕНА',
  },
  {
    key: 'current',
    label: 'Текущие задачи',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path></svg>',
    iconBg: 'background:var(--info-light);color:var(--info);',
    test: (t) => isCurrentTask(t),
  },
  {
    key: 'last_quarter',
    label: 'Прошлый квартал',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    iconBg: 'background:var(--bg-tertiary);color:var(--text-secondary);',
    test: (t) => isLastQuarterTask(t),
  },
  {
    key: 'high_cv',
    label: 'C/V > 1',
    icon: '<i data-lucide="alert-triangle" style="width:16px;height:16px;"></i>',
    iconBg: 'background:var(--danger-light);color:var(--danger);',
    test: (t) => t.financial_effect != null && t.effort_rub > 0 && (t.financial_effect / t.effort_rub) > 1,
  },
];

export function renderQuickFilters() {
  return `
    <div id="quick-filters" class="flex gap-2" style="margin-bottom:var(--space-4);flex-wrap:wrap;">
      ${QUICK_FILTERS.map(f => `
        <button class="quick-filter-btn" data-filter="${f.key}">
          <span class="quick-filter-icon" style="${f.iconBg}">${f.icon}</span>
          <span class="quick-filter-info">
            <span class="quick-filter-label">${f.label}</span>
            <span class="quick-filter-count" id="qf-${f.key}-count">0</span>
          </span>
        </button>`).join('')}
    </div>`;
}

export function initQuickFilters(scope, getTasks) {
  function updateCounts() {
    const tasks = getTasks ? getTasks() : [];
    QUICK_FILTERS.forEach(f => {
      const el = document.getElementById(`qf-${f.key}-count`);
      if (el) el.textContent = tasks.filter(f.test).length;
    });
  }

  function applyFilter(key) {
    const cf = columnFilters[scope];
    if (!cf) return;
    const fk = `_${key}`;
    if (cf[fk] && cf[fk].size > 0) {
      delete cf[fk];
    } else {
      cf[fk] = new Set(['yes']);
    }
  }

  function refreshView() {
    const tasks = getTasks ? getTasks() : [];
    renderFilterButtons(scope, tasks);
    const cb = filterChangeCallbacks[scope];
    if (cb) cb();
  }

  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyFilter(btn.dataset.filter);
      refreshView();
    });
  });

  updateCounts();
}

export function syncQuickFilterButtons(scope) {
  const cf = columnFilters[scope] || {};
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    const fk = `_${btn.dataset.filter}`;
    btn.classList.toggle('active', !!(cf[fk] && cf[fk].size > 0));
  });
}
