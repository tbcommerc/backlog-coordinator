import { button } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';

// Keep the selected ID in the existing form contract; names are always resolved by the server's ACL.
export function mountWorkPicker(input, app, { kind = 'major', editable = false, label = 'Найти работу', selected = '' } = {}) {
    if (!input || input.dataset.pickerMounted) return;
    input.dataset.pickerMounted = 'true';
    input.type = 'hidden';
    const host = document.createElement('div');
    host.className = 'work-picker';
    const searchId = input.id + '-search';
    const formLabel = input.closest('.ui-field')?.querySelector('label');
    if (formLabel) { formLabel.htmlFor = searchId; formLabel.textContent = label; }
    host.innerHTML = `<div class="work-picker-search"><input id="${esc(searchId)}" class="input ui-control" type="search" autocomplete="off" aria-label="${esc(label)}" placeholder="Название или номер" value="${esc(selected)}">${button({label:'Найти',attrs:{'data-picker-search':''}})}${button({label:'Очистить',variant:'ghost',attrs:{'data-picker-clear':''}})}</div><div class="work-picker-results" role="status"></div><p class="work-muted" data-picker-selected>${selected ? esc(selected) : input.value ? `Выбрана работа № ${esc(input.value)}` : 'Работа не выбрана'}</p>`;
    input.after(host);
    const search = host.querySelector('input'), result = host.querySelector('[role=status]');
    let generation = 0;
    const reset = () => { generation++; input.value = ''; result.replaceChildren(); host.querySelector('[data-picker-selected]').textContent = 'Работа не выбрана'; input.dispatchEvent(new Event('input',{bubbles:true})); };
    search.addEventListener('input', reset);
    host.querySelector('[data-picker-clear]').onclick = () => { reset(); search.value=''; search.focus(); };
    const find = async () => {
        const run = ++generation;
        const resolvedKind = typeof kind === 'function' ? kind() : kind;
        result.textContent = 'Поиск…';
        try {
            const data = await app.api.get(`/work-targets?kind=${resolvedKind}&editable=${editable}&q=${encodeURIComponent(search.value.trim())}`);
            if (!host.isConnected || generation !== run) return;
            result.innerHTML = data.items.map(x=>button({label:`${x.public_id} · ${x.title}${x.team ? ' · '+x.team : ''}${x.context?.title ? ' · '+x.context.title : ''}`,variant:'ghost',attrs:{'data-pick':x.id}})).join('') || 'Доступных работ не найдено';
            result.onclick = e => {
                const target=e.target.closest('[data-pick]');
                if(!target)return;
                const row=data.items.find(x=>String(x.id)===target.dataset.pick);
                input.value=String(row.id); search.value=`${row.public_id} · ${row.title}`;
                host.querySelector('[data-picker-selected]').textContent=`Выбрано: ${search.value}`;
                result.replaceChildren(); input.dispatchEvent(new Event('input',{bubbles:true})); search.focus();
            };
        } catch(e) { if(generation===run && host.isConnected)result.textContent=e.message; }
    };
    host.querySelector('[data-picker-search]').onclick=find;
    search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();find();}};
    return { reset };
}
