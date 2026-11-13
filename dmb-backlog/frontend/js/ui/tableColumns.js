// Shared UI Kit column sizing, used by Backlog and registry tables.
// Base widths follow rendered value formats rather than potentially long labels.
export const COLUMN_BASE = {
  id: 170, title: 220, description: 180, comment: 180, rejection_reason: 180,
  financial_effect_justification: 180,
  date_received: 110, status: 120, priority: 105, team: 130, channel: 110,
  business_customer: 150, department: 150, project: 150, task_type: 125,
  involved_teams: 170, deadline: 110, owner: 140, created_by: 140,
  created_at: 140, updated_at: 140,
  effort_days: 95, effort_rub: 115, actual_effort_days: 105,
  financial_effect: 120, cv: 75, progress: 120,
  metric_kr_plan: 110, metric_kr_fact: 110, metric_kr_unit: 110,
  key_project_status: 160, directorate_status: 160, did_status: 160,
  key_project_status_updated_at: 130, directorate_status_updated_at: 130,
  did_status_updated_at: 130, did_demo: 80,
  link_mockups: 90, link_jira: 90, tags: 140,
};

const COLUMN_MAX = {
  id: 190, title: 300, description: 240, comment: 240, rejection_reason: 220,
  financial_effect_justification: 220,
  date_received: 120, status: 150, priority: 115, team: 170, channel: 140,
  business_customer: 180, department: 180, project: 180, task_type: 150,
  involved_teams: 220, deadline: 120, owner: 170, created_by: 170,
  created_at: 150, updated_at: 150,
  effort_days: 105, effort_rub: 130, actual_effort_days: 115,
  financial_effect: 140, cv: 80, progress: 140,
  metric_kr_plan: 125, metric_kr_fact: 125, metric_kr_unit: 120,
  key_project_status: 200, directorate_status: 200, did_status: 200,
  key_project_status_updated_at: 140, directorate_status_updated_at: 140,
  did_status_updated_at: 140, did_demo: 90,
  link_mockups: 100, link_jira: 100, tags: 170,
};
const DEFAULT_MAX = 340;
export const DEFAULT_MIN = 90;
export const MIN_RESIZE = 90;
const MIN_LABEL_PX = 32;
const MAX_SAMPLES = 25;

const widthObservers = {};

export function autoSizeColumns(table, cols, widths, minWidths, opts = {}) {
  const offset = opts.offset || 0;
  const ths = Array.from(table.querySelectorAll('thead th'));
  const colEls = Array.from(table.querySelectorAll('colgroup > col'));
  const sampleRows = Array.from(table.querySelectorAll('tbody tr')).slice(0, MAX_SAMPLES);
  cols.forEach((key, i) => {
    const th = ths[i + offset];
    const col = colEls[i + offset];
    if (!th || !col) return;
    if (widths[key]) return;
    const icon = th.querySelector('.sort-icon');
    const iconW = icon ? (icon.offsetWidth || 14) : 14;
    const labelW = th.querySelector('.th-label')?.scrollWidth || 0;
    let w = Math.max(COLUMN_BASE[key] || DEFAULT_MIN, labelW + iconW + 46);
    const maxCell = Math.max(0, ...sampleRows.map(tr => tr.children[i + offset]?.scrollWidth || 0));
    w = Math.max(w, maxCell);
    const cap = opts.maxWidths?.[key] || COLUMN_MAX[key] || DEFAULT_MAX;
    const min = opts.baseWidths?.[key] || COLUMN_BASE[key] || DEFAULT_MIN;
    widths[key] = Math.min(Math.max(w, min), cap);
    minWidths[key] = Math.max(MIN_RESIZE, iconW + 42 + MIN_LABEL_PX);
  });
}

export function applyColumnWidths(table, cols, widths, opts = {}) {
  const offset = opts.offset || 0;
  const fixed = opts.fixed || {};
  if (fixed.id) fixed.id = Math.max(COLUMN_BASE.id, fixed.id);
  const colEls = Array.from(table.querySelectorAll('colgroup > col'));
  const autoCols = cols.filter(k => !fixed[k]);
  autoCols.forEach(key => {
    const min = opts.baseWidths?.[key] || COLUMN_BASE[key] || DEFAULT_MIN;
    const max = opts.maxWidths?.[key] || COLUMN_MAX[key] || DEFAULT_MAX;
    widths[key] = Math.min(Math.max(widths[key] || min, min), max);
  });
  const baseSumAuto = autoCols.reduce((s, k) => s + (widths[k] || 0), 0);
  const fixedSum = cols.reduce((s, k) => s + (fixed[k] || 0), 0);
  const prefixSum = colEls.slice(0, offset).reduce((s, c) => s + (parseFloat(c.style.width) || c.offsetWidth || 0), 0);
  const intrinsicWidth = prefixSum + fixedSum + baseSumAuto;
  const containerWidth = table.parentElement?.clientWidth || 0;
  const extraWidth = autoCols.length > 0 ? Math.max(0, containerWidth - intrinsicWidth) : 0;
  cols.forEach((key, i) => {
    const col = colEls[i + offset];
    if (!col) return;
    const baseWidth = fixed[key] || widths[key] || COLUMN_BASE[key] || DEFAULT_MIN;
    const share = !fixed[key] && baseSumAuto > 0
      ? extraWidth * ((widths[key] || 0) / baseSumAuto)
      : 0;
    col.style.width = (baseWidth + share) + 'px';
  });
  table.style.width = Math.ceil(intrinsicWidth + extraWidth) + 'px';
  table.style.minWidth = '0';
  table.style.tableLayout = 'fixed';
  pinIdentityColumn(table, cols, offset);

  updateWidthValues(table, cols, offset);
  if (opts.observe !== false && typeof ResizeObserver !== 'undefined' && table.id && table.parentElement) {
    const current = widthObservers[table.id];
    if (!current || current.table !== table) {
      current?.observer.disconnect();
      const observer = new ResizeObserver(() => {
        if (!table.isConnected) { observer.disconnect(); delete widthObservers[table.id]; return; }
        applyColumnWidths(table, cols, widths, opts);
      });
      observer.observe(table.parentElement);
      widthObservers[table.id] = { table, observer };
    }
  }
}

function updateWidthValues(table, cols, offset) {
  cols.forEach((key, index) => {
    const cell = table.tHead?.rows[0]?.cells[index + offset];
    cell?.querySelector('.th-resize-handle')?.setAttribute('aria-valuenow', String(Math.round(cell.getBoundingClientRect().width)));
  });
}

const columnBindings = new Map();
let interactionsInstalled = false;

// Legacy Backlog and registry adapters share these exact input rules.
export function registerColumnInteractions(tableId, options) {
  columnBindings.set(tableId, options);
  if (interactionsInstalled) return;
  interactionsInstalled = true;
  const resolve = event => {
    const handle = event.target.closest('.th-resize-handle');
    const cell = handle?.closest('th');
    const source = cell?.closest('table');
    const table = source?.dataset.sourceTable ? document.getElementById(source.dataset.sourceTable) : source;
    const options = columnBindings.get(table?.id);
    const layout = options?.getLayout?.();
    const fixed = options?.getFixed?.();
    const key = cell?.dataset.columnKey || cell?.dataset.sort;
    if (!handle || !table || !layout || !fixed || !key) return null;
    const min = Math.max(key === 'id' ? COLUMN_BASE.id : MIN_RESIZE, options.getMinWidths?.()[key] || 0);
    const offset = Math.max(0, table.querySelectorAll('colgroup > col').length - layout.cols.length);
    const sourceCell = table.tHead.rows[0].cells[layout.cols.indexOf(key) + offset];
    return { handle, cell: sourceCell || cell, table, options, layout, fixed, key, min };
  };
  const apply = context => {
    const { table, options, layout, fixed } = context;
    const offset = Math.max(0, table.querySelectorAll('colgroup > col').length - layout.cols.length);
    applyColumnWidths(table, layout.cols, options.getWidths(), { ...layout, offset, fixed });
    context.handle.setAttribute('aria-valuenow', String(Math.round(table.tHead.rows[0].cells[layout.cols.indexOf(context.key) + offset].getBoundingClientRect().width)));
  };
  const reset = context => {
    delete context.fixed[context.key];
    apply(context);
    if (context.options.onUnfix) context.options.onUnfix(context.key);
    else context.options.onResizeEnd?.(context.key, undefined);
  };
  document.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    const context = resolve(event);
    if (!context) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') { reset(context); return; }
    context.fixed[context.key] = Math.max(context.min, context.cell.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10));
    apply(context);
    context.options.onResizeEnd?.(context.key, context.fixed[context.key]);
  });
  document.addEventListener('dblclick', event => {
    const context = resolve(event);
    if (!context) return;
    event.preventDefault(); event.stopPropagation(); reset(context);
  });
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const context = resolve(event);
    if (!context) return;
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX, width = context.cell.getBoundingClientRect().width;
    const previous = context.fixed[context.key];
    let moved = false;
    document.body.classList.add('resizing-table');
    const move = current => {
      if (current.pointerId !== event.pointerId || !context.table.isConnected) return;
      if (Math.abs(current.clientX - startX) < 2 && !moved) return;
      moved = true;
      context.fixed[context.key] = Math.max(context.min, width + current.clientX - startX);
      apply(context);
    };
    const finish = current => {
      if (current.pointerId !== event.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.body.classList.remove('resizing-table');
      if (current.type === 'pointercancel') {
        if (previous == null) delete context.fixed[context.key]; else context.fixed[context.key] = previous;
        apply(context);
      } else if (moved) context.options.onResizeEnd?.(context.key, context.fixed[context.key]);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  });
}

let registryInstaller;
let nextRegistryId = 0;
export function installRegistryColumns() {
  if (registryInstaller) return registryInstaller;
  const controllers = new Map();
  let frame = 0;
  const refresh = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const [table, controller] of controllers) {
        if (!table.isConnected) { controller.destroy(); controllers.delete(table); }
      }
      document.querySelectorAll('table[data-ui-table="registry"]').forEach(table => {
        if (table.closest('.ui-table-sticky-header') || ['tasks-table', 'team-tasks-table'].includes(table.id) || !table.tHead || !table.tBodies.length) return;
        if (!controllers.has(table)) controllers.set(table, enhanceRegistry(table));
        controllers.get(table).update();
      });
    });
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.('.ui-table-sticky-header') && [...record.addedNodes, ...record.removedNodes].some(node => !node.matches?.('.ui-table-sticky-header')))) refresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', refresh);
  refresh();
  registryInstaller = () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    window.removeEventListener('resize', refresh);
    controllers.forEach(controller => controller.destroy());
    registryInstaller = null;
  };
  return registryInstaller;
}

function enhanceRegistry(table) {
  if (!table.id) table.id = `ui-registry-${++nextRegistryId}`;
  const cells = [...table.tHead.rows[0].cells];
  const cols = cells.map((cell, index) => cell.dataset.columnKey || `column-${index}`);
  const widths = {}, minWidths = {}, baseWidths = {}, maxWidths = {}, fixed = {};
  const scope = table.dataset.uiColumnState || table.caption?.textContent.trim() || table.className;
  let user = '';
  try { user = JSON.parse(localStorage.getItem('dmb_user'))?.id || ''; } catch { /* Anonymous catalog. */ }
  const storageKey = `ui.registry.columns.v1:${user}:${location.hash.split('?')[0]}:${scope}`;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    for (const [key, value] of Object.entries(saved || {})) if (typeof value === 'number' && Number.isFinite(value) && value >= MIN_RESIZE) fixed[key] = Math.min(value, 10000);
  } catch { /* Storage is optional. */ }
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(fixed)); } catch { /* Storage is optional. */ } };
  let group, measured = false;
  cells.forEach((cell, index) => {
    cell.dataset.columnKey = cols[index];
    // Action/selection columns keep their fixed compact width.
    if (cell.dataset.uiResizable === 'false' || cell.querySelector('input, .sr-only') || !cell.textContent.trim()) return;
    if (!cell.querySelector('.table-sort-button, .ui-table-heading')) {
      const heading = document.createElement('span');
      heading.className = 'ui-table-heading';
      heading.title = cell.textContent.trim();
      const label = document.createElement('span'); label.className = 'th-label';
      while (cell.firstChild) label.appendChild(cell.firstChild);
      heading.appendChild(label); cell.appendChild(heading);
    }
    const handle = document.createElement('span');
    handle.className = 'th-resize-handle'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Ширина колонки: ${cell.textContent.trim()}`);
    handle.setAttribute('aria-valuemin', String(MIN_RESIZE));
    handle.title = 'Изменить ширину: ← / →; Shift — 50 px; Home или двойной щелчок — автоматически';
    cell.appendChild(handle);
  });
  const layout = { cols, baseWidths, maxWidths, observe: false };
  registerColumnInteractions(table.id, { getWidths: () => widths, getMinWidths: () => minWidths, getFixed: () => fixed, getLayout: () => layout, onResizeEnd: save });
  const update = () => {
    // CSS card layouts (including the work inspector) retain their own width.
    if (getComputedStyle(table).display !== 'table' || getComputedStyle(table.tHead).display !== 'table-header-group') {
      table.style.removeProperty('width'); table.style.removeProperty('min-width');
      if (group) group.hidden = true;
      return;
    }
    if (!measured) {
      const initial = cells.map(cell => cell.getBoundingClientRect().width);
      if (!initial.some(width => width > 0)) return;
      cells.forEach((cell, index) => {
        const key = cols[index], width = Math.max(1, initial[index]);
        // The page supplies an initial profile; the shared algorithm owns layout.
        baseWidths[key] = maxWidths[key] = width;
        minWidths[key] = MIN_RESIZE;
        if (!cell.querySelector('.th-resize-handle')) fixed[key] = width;
      });
      group = document.createElement('colgroup');
      cols.forEach(() => group.appendChild(document.createElement('col')));
      table.insertBefore(group, table.tHead);
      autoSizeColumns(table, cols, widths, minWidths, layout);
      measured = true;
    }
    group.hidden = false;
    applyColumnWidths(table, cols, widths, { ...layout, fixed });
    table.dataset.uiColumns = 'resizable';
  };
  const observer = new ResizeObserver(update);
  observer.observe(table.parentElement);
  return { update, destroy() { observer.disconnect(); columnBindings.delete(table.id); } };
}

function pinIdentityColumn(table, cols, offset) {
  if (!['tasks-table', 'team-tasks-table'].includes(table.id)) return;
  const index = cols.indexOf('id') + offset;
  const left = offset ? 40 : 0;
  table.querySelectorAll('tr').forEach(row => {
    if (offset && row.children.length > 1) row.children[0].classList.add('table-pinned-selection');
    const cell = row.children[index];
    if (cell && !cell.hasAttribute('colspan')) {
      cell.classList.add('table-pinned-id');
      cell.style.setProperty('--pinned-id-left', `${left}px`);
    }
  });
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.querySelector('.th-resize-handle')?.setAttribute('aria-valuenow', String(Math.round(th.getBoundingClientRect().width)));
  });
}

