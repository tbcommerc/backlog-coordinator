import { bindPopover } from './popover.js';

export function bindActionMenu({ trigger, panel, label = 'Действия', ...options }) {
  panel.classList.add('ui-action-menu');
  panel.querySelectorAll('button, a[href]').forEach(item => { item.setAttribute('role', 'menuitem'); item.tabIndex = -1; });
  const menu = bindPopover({ ...options, trigger, panel, label, role: 'menu' });
  const select = event => {
    const item = event.target.closest('[role="menuitem"]');
    if (!item) return;
    if (item.matches(':disabled, [aria-disabled="true"]')) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    menu.close();
  };
  panel.addEventListener('click', select, true);
  const destroy = menu.destroy;
  menu.destroy = () => { panel.removeEventListener('click', select, true); destroy(); };
  return menu;
}
