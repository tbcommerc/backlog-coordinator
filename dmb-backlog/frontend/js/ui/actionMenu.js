import { bindPopover } from './popover.js';

export function bindActionMenu({ trigger, panel, label = 'Действия', ...options }) {
  panel.classList.add('ui-action-menu');
  panel.querySelectorAll('button, a[href]').forEach(item => { item.setAttribute('role', 'menuitem'); item.tabIndex = -1; });
  const menu = bindPopover({ ...options, trigger, panel, label, role: 'menu' });
  const select = event => {
    if (event.target.closest('[role="menuitem"]:not(:disabled)')) menu.close();
  };
  panel.addEventListener('click', select);
  const destroy = menu.destroy;
  menu.destroy = () => { panel.removeEventListener('click', select); destroy(); };
  return menu;
}
