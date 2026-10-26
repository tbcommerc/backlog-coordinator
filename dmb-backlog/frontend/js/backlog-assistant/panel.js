import { button } from '../ui/primitives.js';
import { renderPage, mount } from './page.js';
import { contextFromLocation } from './state.js';
import { assistantIcon } from './presentation.js';

export function openPanel(app = window.app, context = contextFromLocation()) {
    if (document.querySelector('.ba-dialog')) return;
    const trigger = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'ba-dialog'; dialog.setAttribute('aria-label', 'Помощник по бэклогу');
    dialog.innerHTML = renderPage();
    dialog.querySelector('.ba-header-actions').insertAdjacentHTML('beforeend', button({ label: 'Закрыть помощника', variant: 'ghost', iconOnly: true, iconMarkup: assistantIcon('close'), attrs: { 'data-ba-close': '' } }));
    document.body.append(dialog);
    dialog.querySelector('[data-ba-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
        dialog.querySelector('[data-ba-root]').baCleanup?.();
        dialog.remove(); if (trigger?.isConnected) trigger.focus();
    }, { once: true });
    dialog.showModal();
    mount(dialog.querySelector('[data-ba-root]'), app, context);
}
