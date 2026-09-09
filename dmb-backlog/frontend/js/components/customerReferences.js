import { escapeHtml } from '../htmlUtils.js';
import { renderViewState, bindViewStateAction } from './viewState.js';
import { formatErrorMessage } from '../uiFeedback.js';

export async function openCustomerReferences(kind, app) {
  const endpoint = `/admin/customer-references/${kind}`;
  const dialog = document.createElement('dialog');
  dialog.className = 'customer-reference-dialog';
  document.body.appendChild(dialog);
  let items = [];
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  const title = 'Клиенты ДИД';
  function render() {
    dialog.innerHTML = `<div class="did-filter-panel-head"><h2>${title}</h2><button class="modal-close" type="button" data-close data-modal-close aria-label="Закрыть">×</button></div><p class="text-muted">Группировка задач в отчёте для бизнес-заказчиков ДИД.</p><div role="alert" data-error></div><div class="customer-reference-list">${items.map(item => `<div class="customer-reference-row"><span>${escapeHtml(item.name)} ${item.is_active ? '' : '· Неактивна'}</span><button class="btn btn-secondary btn-sm" data-edit="${item.id}">Изменить</button></div>`).join('') || '<p class="empty-state">Справочник пока пуст</p>'}</div><button class="btn btn-primary" data-new>Добавить запись</button><div data-editor></div>`;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-new]').onclick = () => editor(null);
    dialog.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => editor(items.find(i => i.id === Number(b.dataset.edit))); });
  }
  function editor(item) {
    const host = dialog.querySelector('[data-editor]');
    host.innerHTML = `<form class="customer-reference-editor"><h3>${item ? 'Изменить запись' : 'Новая запись'}</h3><label>Название<input class="input" name="name" required maxlength="100" value="${escapeHtml(item?.name || '')}"></label><label>Код<input class="input" name="code" required maxlength="50" value="${escapeHtml(item?.code || '')}"></label><label>Порядок<input class="input" name="order" type="number" min="0" max="100000" value="${item?.sort_order || 0}"></label><label><input name="active" type="checkbox" ${item?.is_active !== false ? 'checked' : ''}> Активна</label><div class="did-actions"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-secondary" type="button" data-cancel>Отмена</button></div></form>`;
    host.querySelector('[data-cancel]').onclick = () => { host.innerHTML = ''; };
    host.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const form = event.target, fields = form.elements;
      const command = { name: fields.name.value, is_active: fields.active.checked, expected: item };
      command.code = fields.code.value; command.sort_order = Number(fields.order.value);
      form.querySelector('button[type=submit]').disabled = true;
      try {
        if (item) await app.api.put(`${endpoint}/${item.id}`, command); else await app.api.post(endpoint, command);
        items = await app.api.get(endpoint); render();
        // Refresh task-editing lists without touching any task or reference record.
        app.didClientGroups = items.filter(i => i.is_active);
      } catch (error) { dialog.querySelector('[data-error]').textContent = formatErrorMessage(error); form.querySelector('button[type=submit]').disabled = false; }
    };
    host.querySelector('input').focus();
  }
  dialog.innerHTML = `<div class="app-modal__state" role="status"><p>Загрузка…</p><button class="btn btn-secondary" data-close data-modal-close>Закрыть</button></div>`;
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  try {
    items = await app.api.get(endpoint);
    if (dialog.isConnected) render();
  } catch (error) { if (dialog.isConnected) { dialog.innerHTML = renderViewState({ kind: 'error', message: formatErrorMessage(error), actionLabel: 'Закрыть' }); bindViewStateAction(dialog, () => dialog.close()); } }
}
