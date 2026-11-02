import { filterChip } from '../ui/primitives.js';
import { taskStatusTone, taskPriorityTone } from '../taskDisplay.js';
console.log('[DMB] quickFilters.js v20260910.4 loaded');

import { columnFilters, renderFilterButtons, filterChangeCallbacks, isDeadlinePast, isCurrentTask, isLastQuarterTask } from './filterToolbar.js?v=108';
import { calculateTaskCv } from '../taskMetrics.js';

const TERMINAL_STATUSES = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];

const QUICK_FILTERS = [
  {
    key: 'overdue',
    label: 'Просрочено',
    icon: 'alert-circle',
    tone: 'danger',
    test: (t) => t.deadline_id != null && !TERMINAL_STATUSES.includes(t.status_name) && isDeadlinePast(t.deadline_name),
  },
  {
    key: 'urgent',
    label: 'Важные задачи',
    icon: 'flame',
    tone: taskPriorityTone('ВЫСОКИЙ'),
    test: (t) => t.priority_name === 'ВЫСОКИЙ',
  },
  {
    key: 'active',
    label: 'В работе',
    icon: 'activity',
    tone: 'info',
    test: (t) => !!t.status_name && !TERMINAL_STATUSES.includes(t.status_name) && t.status_name !== 'ХОЛД',
  },
  {
    key: 'hold',
    label: 'Холд',
    icon: 'pause-circle',
    tone: taskStatusTone('ХОЛД'),
    test: (t) => t.status_name === 'ХОЛД',
  },
  {
    key: 'rejected',
    label: 'Отклонённые',
    icon: 'x-circle',
    tone: taskStatusTone('ОТКЛОНЕНА'),
    test: (t) => t.status_name === 'ОТКЛОНЕНА',
  },
  {
    key: 'current',
    label: 'Текущие задачи',
    icon: 'calendar-check',
    tone: 'info',
    test: (t) => isCurrentTask(t),
  },
  {
    key: 'last_quarter',
    label: 'Прошлый квартал',
    icon: 'history',
    tone: 'neutral',
    test: (t) => isLastQuarterTask(t),
  },
  {
    key: 'high_cv',
    label: 'Проблемный C/V',
    icon: 'alert-triangle',
    tone: 'danger',
    test: (t) => {
      const cv = calculateTaskCv(t);
      return cv == null || cv > 1;
    },
  },
];

export function renderQuickFilters(scope) {
  const filters = QUICK_FILTERS;
  return `
    <div class="quick-filters-shell">
      <button type="button" class="btn btn-secondary btn-sm ui-btn quick-filters-mobile-toggle" id="quick-filters-mobile-toggle" aria-expanded="false" aria-controls="quick-filters">
        <i data-lucide="zap" aria-hidden="true"></i>
        <span>Быстрые фильтры</span>
        <span class="quick-filters-active-count hidden" id="quick-filters-active-count">0</span>
        <i data-lucide="chevron-down" class="quick-filters-toggle-chevron" aria-hidden="true"></i>
      </button>
      <div id="quick-filters" data-scope="${scope}" class="flex gap-2" style="--quick-filter-columns:${filters.length};margin-bottom:var(--space-4);">
        ${filters.map(f => filterChip({ label: f.label, icon: f.icon, tone: f.tone, count: 0, countId: `qf-${f.key}-count`, attrs: { 'data-filter': f.key } })).join('')}
      </div>
    </div>`;
}

let mobileOutsideHandler = null;
let mobileKeyHandler = null;
let quickFilterLayoutObserver = null;

function updateQuickFilterLayout() {
  const panel = document.getElementById('quick-filters');
  if (!panel) return;

  if (window.matchMedia?.('(max-width: 1024px)').matches) {
    panel.classList.remove('quick-filters-measuring', 'quick-filters-single-row');
    return;
  }

  panel.classList.remove('quick-filters-single-row');
  panel.classList.add('quick-filters-measuring');
  const buttons = Array.from(panel.querySelectorAll('.quick-filter-btn'));
  const widestButton = Math.max(0, ...buttons.map(button => button.getBoundingClientRect().width));
  const columnGap = parseFloat(getComputedStyle(panel).columnGap) || 0;
  const requiredEqualWidth = widestButton * buttons.length + columnGap * Math.max(0, buttons.length - 1);
  const fitsWithoutClipping = requiredEqualWidth <= panel.clientWidth + 1;
  panel.classList.remove('quick-filters-measuring');
  panel.classList.toggle('quick-filters-single-row', fitsWithoutClipping);
}

export function initQuickFilterLayout() {
  quickFilterLayoutObserver?.disconnect();
  const shell = document.querySelector('.quick-filters-shell');
  if (!shell) return;
  const scheduleUpdate = () => requestAnimationFrame(updateQuickFilterLayout);
  if (typeof ResizeObserver !== 'undefined') {
    quickFilterLayoutObserver = new ResizeObserver(scheduleUpdate);
    quickFilterLayoutObserver.observe(shell);
  }
  updateQuickFilterLayout();
}

function setMobilePanelOpen(open) {
  const toggle = document.getElementById('quick-filters-mobile-toggle');
  const panel = document.getElementById('quick-filters');
  if (!toggle || !panel) return;
  panel.classList.toggle('mobile-open', open);
  toggle.classList.toggle('active', open);
  toggle.setAttribute('aria-expanded', String(open));
}

export function updateQuickFilterCounts(scope, tasks = []) {
  const panel = document.getElementById('quick-filters');
  if (!panel || panel.dataset.scope !== scope) return;
  QUICK_FILTERS.forEach(filter => {
    const button = panel.querySelector(`[data-filter="${filter.key}"]`);
    const count = tasks.filter(filter.test).length;
    const badge = button?.querySelector('.quick-filter-count');
    if (badge) badge.textContent = String(count);
    button?.setAttribute('aria-label', `${filter.label}: ${count}`);
  });
  requestAnimationFrame(updateQuickFilterLayout);
}

export function initQuickFilters(scope, getTasks) {

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

  const mobileToggle = document.getElementById('quick-filters-mobile-toggle');
  mobileToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    setMobilePanelOpen(mobileToggle.getAttribute('aria-expanded') !== 'true');
  });

  if (mobileOutsideHandler) document.removeEventListener('click', mobileOutsideHandler);
  mobileOutsideHandler = (event) => {
    if (!event.target.closest('.quick-filters-shell')) setMobilePanelOpen(false);
  };
  document.addEventListener('click', mobileOutsideHandler);

  if (mobileKeyHandler) document.removeEventListener('keydown', mobileKeyHandler);
  mobileKeyHandler = (event) => {
    if (event.key === 'Escape') setMobilePanelOpen(false);
  };
  document.addEventListener('keydown', mobileKeyHandler);

  updateQuickFilterCounts(scope, getTasks ? getTasks() : []);
  syncQuickFilterButtons(scope);
  initQuickFilterLayout();
}

export function syncQuickFilterButtons(scope) {
  const cf = columnFilters[scope] || {};
  let activeCount = 0;
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    const fk = `_${btn.dataset.filter}`;
    const active = !!(cf[fk] && cf[fk].size > 0);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    if (active) activeCount += 1;
  });
  const count = document.getElementById('quick-filters-active-count');
  const toggle = document.getElementById('quick-filters-mobile-toggle');
  if (count) {
    count.textContent = String(activeCount);
    count.classList.toggle('hidden', activeCount === 0);
  }
  toggle?.classList.toggle('has-active-filters', activeCount > 0);
}
