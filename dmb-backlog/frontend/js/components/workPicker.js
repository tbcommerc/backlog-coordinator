import { entityPicker, bindEntityPicker } from '../ui/entityPicker.js';

// Domain adapter: keep the existing ID and events; the server owns ACL.
export function mountWorkPicker(input, app, { kind = 'major', editable = false, label = 'Найти работу', selected = '' } = {}) {
    if (!input || input.dataset.pickerMounted) return;
    input.dataset.pickerMounted = 'true';
    const originalType = input.type;
    input.type = 'hidden';
    const host = document.createElement('div');
    host.className = 'work-picker';
    const choiceId = input.id + '-choice', searchId = input.id + '-search';
    const formLabel = input.closest('.ui-field')?.querySelector(':scope > label');
    if (formLabel) formLabel.hidden = true;
    host.innerHTML = entityPicker({ id: choiceId, name: choiceId, label: `${label}: выбор`, searchLabel: label,
        selected: input.value ? { value: input.value, label: selected || `Работа № ${input.value}` } : null,
        disabled: input.disabled, hint: 'Название или номер. Выберите запись из результатов поиска.' });
    input.after(host);
    const root = host.querySelector('.ui-entity-picker');
    const search = root.querySelector('[data-entity-query]'), choice = root.querySelector('[data-entity-value]');
    root.querySelector(`label[for="${search.id}"]`).htmlFor = searchId;
    search.id = searchId;
    choice.removeAttribute('name'); // only the original ID belongs to FormData
    search.value = selected;
    const labels = new Map(input.value ? [[input.value, selected || `Работа № ${input.value}`]] : []);
    const sync = item => {
        input.value = item?.value || '';
        if (item) { search.value = item.label; labels.set(item.value, item.label); }
        input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const picker = bindEntityPicker(root, {
        load: async (query, { signal }) => {
            const resolvedKind = typeof kind === 'function' ? kind() : kind;
            const params = new URLSearchParams({ kind: resolvedKind, editable: String(editable), q: query });
            const data = await app.api.get('/work-targets?' + params, { signal });
            return data.items.map(row => ({ value: row.id, label: `${row.public_id} · ${row.title}${row.team ? ' · ' + row.team : ''}${row.context?.title ? ' · ' + row.context.title : ''}` }));
        },
        onChange: sync,
    });
    // Required/domain validation stays with callers and targets searchId.
    let resetTimer;
    const form = input.form;
    const resetForm = event => {
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { if (!event.defaultPrevented && host.isConnected) sync(picker.value); }, 0);
    };
    form?.addEventListener('reset', resetForm);
    return {
        reset() { sync(null); return picker.refresh({ reset: true }); },
        syncFromInput() {
            const value = input.value;
            if (value && ![...choice.options].some(option => option.value === value)) choice.add(new Option(labels.get(value) || `Работа № ${value}`, value));
            choice.value = value;
            if (!value) search.value = '';
            choice.dispatchEvent(new Event('change'));
        },
        destroy() {
            clearTimeout(resetTimer); form?.removeEventListener('reset', resetForm); picker.destroy();
            host.remove(); input.type = originalType; delete input.dataset.pickerMounted;
            if (formLabel) formLabel.hidden = false;
        },
    };
}
