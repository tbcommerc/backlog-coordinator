// Page-scroll headers for horizontally scrollable registries. One installer owns
// lifecycle across SPA renders; data-ui-sticky-header="page" is an explicit opt-in.
const selector = 'table[data-ui-sticky-header="page"]';
let installed = false;
let frame = 0;
let observer;
const headers = new Map();

export function refreshStickyTableHeaders() {
  if (!installed || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const [table, controller] of headers) {
      if (!table.isConnected || table.tHead !== controller.head) {
        controller.destroy();
        headers.delete(table);
      }
    }
    document.querySelectorAll(selector).forEach(table => {
      if (!headers.has(table) && table.tHead) headers.set(table, createHeader(table));
    });
    headers.forEach(controller => controller.update());
  });
}

export function installStickyTableHeaders() {
  if (installed) return;
  installed = true;
  document.addEventListener('scroll', refreshStickyTableHeaders, { capture: true, passive: true });
  window.addEventListener('resize', refreshStickyTableHeaders, { passive: true });
  observer = new MutationObserver(records => {
    // The fixed projection lives outside the application and must not observe itself.
    if (records.some(record => !record.target.closest?.('.ui-table-sticky-header') && [...record.addedNodes, ...record.removedNodes].some(node => !node.matches?.('.ui-table-sticky-header')))) refreshStickyTableHeaders();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  refreshStickyTableHeaders();
  return () => {
    observer.disconnect();
    document.removeEventListener('scroll', refreshStickyTableHeaders, true);
    window.removeEventListener('resize', refreshStickyTableHeaders);
    cancelAnimationFrame(frame);
    frame = 0;
    headers.forEach(controller => controller.destroy());
    headers.clear();
    installed = false;
  };
}

export function initStickyTableHeader(tableId) {
  const table = document.getElementById(tableId);
  if (table) table.dataset.uiStickyHeader = 'page';
  installStickyTableHeaders();
  refreshStickyTableHeaders();
}

function createHeader(table) {
  const head = table.tHead;
  const main = table.closest('.main-content');
  const container = table.closest('.table-container, .ui-data-table-scroll, .work-table-wrap, .work-queue-panel') || table.parentElement;
  let wrapper, surface, projection, dirty = true;
  const originalVisibility = head.style.visibility;
  const resize = new ResizeObserver(refreshStickyTableHeaders);
  [table, container, main, document.querySelector('.navbar')].filter(Boolean).forEach(el => resize.observe(el));
  const mutations = new MutationObserver(records => {
    if (records.every(record => record.target === head && record.attributeName === 'style')) return;
    dirty = true;
    refreshStickyTableHeaders();
  });
  mutations.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-sort', 'aria-label', 'aria-checked', 'disabled', 'checked', 'style', 'class'] });

  function remove() {
    if (!wrapper) return;
    // Preserve keyboard focus when scrolling back to the original heading.
    const controls = [...projection.querySelectorAll('button, input, [tabindex], a')];
    const focused = controls.indexOf(document.activeElement);
    wrapper.remove();
    wrapper = surface = projection = null;
    head.style.visibility = originalVisibility;
    if (focused >= 0) head.querySelectorAll('button, input, [tabindex], a')[focused]?.focus({ preventScroll: true });
  }

  function build() {
    const focused = wrapper ? [...projection.querySelectorAll('button, input, [tabindex], a')].indexOf(document.activeElement) : -1;
    wrapper?.remove();
    wrapper = document.createElement('div');
    wrapper.className = 'ui-table-sticky-header';
    if (table.id === 'tasks-table') wrapper.id = 'sticky-header-wrapper';
    surface = document.createElement('div');
    surface.className = 'ui-table-sticky-surface';
    projection = table.cloneNode(false);
    projection.removeAttribute('id');
    projection.removeAttribute('data-ui-sticky-header');
    if (table.id) projection.dataset.sourceTable = table.id;
    projection.setAttribute('aria-label', `${table.caption?.textContent.trim() || table.getAttribute('aria-label') || 'Таблица'} — закреплённые заголовки`);
    const cols = document.createElement('colgroup');
    [...head.rows[0].cells].forEach(() => cols.appendChild(document.createElement('col')));
    projection.appendChild(cols);
    const copy = head.cloneNode(true);
    copy.style.visibility = '';
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    const originalControls = [...head.querySelectorAll('button, input, [tabindex], a')];
    copy.querySelectorAll('button, input, [tabindex], a').forEach((control, index) => {
      const original = originalControls[index];
      if (control.matches('input[type="checkbox"]')) {
        control.addEventListener('change', () => {
          original.checked = control.checked;
          original.dispatchEvent(new Event('change', { bubbles: true }));
        });
      } else if (!original.closest('[data-sort]')) {
        control.addEventListener('click', event => { event.preventDefault(); original.click(); });
      }
      // Backlog sorting and resizing already delegate via data-source-table.
    });
    projection.appendChild(copy);
    surface.appendChild(projection);
    wrapper.appendChild(surface);
    document.body.appendChild(wrapper);
    head.style.visibility = 'hidden';
    if (focused >= 0) copy.querySelectorAll('button, input, [tabindex], a')[focused]?.focus({ preventScroll: true });
    dirty = false;
  }

  function update() {
    const rect = table.getBoundingClientRect();
    const headRect = head.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    let top = Math.max(0, mainRect?.top || 0, document.querySelector('.navbar')?.getBoundingClientRect().bottom || 0);
    // Only genuinely fixed/sticky editing controls reserve space. Flow filters leave the viewport.
    main?.querySelectorAll('.sticky-toolbar, .qe-toolbar').forEach(toolbar => {
      const style = getComputedStyle(toolbar);
      if (style.display !== 'none' && ['fixed', 'sticky'].includes(style.position)) top = Math.max(top, toolbar.getBoundingClientRect().bottom);
    });
    const gapToken = getComputedStyle(table).getPropertyValue('--ui-table-sticky-gap').trim();
    const gap = (parseFloat(gapToken) || 1) * (gapToken.endsWith('rem') ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1);
    const isTable = getComputedStyle(head).display === 'table-header-group';
    const scrolled = (main?.scrollTop || window.scrollY) > .5;
    if (!isTable || !scrolled || !rect.width || headRect.top >= top + gap || rect.bottom <= top + gap + headRect.height || !table.tBodies[0]?.rows.length || table.querySelector('.table-view-state-cell')) {
      remove();
      return;
    }
    if (!wrapper || dirty) build();
    const left = Math.max(area.left + container.clientLeft, mainRect?.left || 0);
    const right = Math.min(area.left + container.clientLeft + container.clientWidth, mainRect ? mainRect.left + main.clientWidth : innerWidth);
    wrapper.style.left = `${left}px`;
    wrapper.style.top = `${top}px`;
    wrapper.style.width = `${Math.max(0, right - left)}px`;
    wrapper.style.setProperty('--ui-table-sticky-gap', `${gap}px`);
    surface.style.height = `${headRect.height}px`;
    projection.style.width = `${rect.width}px`;
    projection.style.transform = `translateX(${rect.left - left}px)`;
    const copyCells = projection.tHead.querySelectorAll('th');
    head.querySelectorAll('th').forEach((cell, index) => {
      const copy = copyCells[index];
      const style = getComputedStyle(cell);
      const width = `${cell.getBoundingClientRect().width}px`;
      projection.querySelectorAll('col')[index].style.width = width;
      copy.style.width = copy.style.minWidth = copy.style.maxWidth = width;
      // Retain the resolved UI Kit appearance even outside a page-specific ancestor.
      for (const property of ['padding', 'height', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'color', 'background-color', 'border-bottom']) copy.style.setProperty(property, style.getPropertyValue(property));
      if (style.position === 'sticky' && style.left !== 'auto') {
        copy.style.position = 'relative';
        copy.style.left = '0';
        copy.style.zIndex = '2';
        copy.style.transform = `translateX(${Math.max(0, left - rect.left)}px)`;
      }
    });
    const inputs = head.querySelectorAll('input[type="checkbox"]');
    projection.querySelectorAll('input[type="checkbox"]').forEach((input, i) => {
      input.checked = inputs[i].checked;
      input.indeterminate = inputs[i].indeterminate;
    });
  }
  return { head, update, destroy() { remove(); resize.disconnect(); mutations.disconnect(); } };
}
