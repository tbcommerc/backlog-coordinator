import { field, pageHeader, badge } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { mountWorkList, disposeWorkList } from './workTasks.js?v=26';
import { renderViewState } from './viewState.js';
import { workPager, focusWorkPager } from './workUi.js?v=2';
import { formatErrorMessage } from '../uiFeedback.js';

export function renderWorkProjects() {
    return `<section class="work-page">${pageHeader({title:'Структура работ проекта',actions:'<div id="work-project-picker" class="work-context-picker"></div>'})}<div id="work-project-empty">${renderViewState({title:'Выберите проект',message:'Покажем его крупные обязательства и задачи, созданные непосредственно в проекте.'})}</div><div id="work-project-content" hidden><section class="work-section" aria-labelledby="work-major-title"><header class="work-section-head"><div><h2 id="work-major-title">Крупные обязательства <span id="work-major-count"></span></h2></div></header><div id="work-project-major" class="work-panel" aria-live="polite"></div></section><section class="work-section" aria-labelledby="work-direct-title"><header class="work-section-head"><div><h2 id="work-direct-title" title="Напрямую в проекте, без крупного обязательства">Рабочие задачи проекта</h2></div><div data-work-create-slot></div></header><div id="work-project-direct"></div></section></div></section>`;
}

export async function initWorkProjects(app) {
    const picker = document.getElementById('work-project-picker');
    const major = document.getElementById('work-project-major');
    const direct = document.getElementById('work-project-direct');
    const content = document.getElementById('work-project-content');
    const empty = document.getElementById('work-project-empty');
    const count = document.getElementById('work-major-count');
    let page = 1, generation = 0;
    async function load() {
        const token = ++generation;
        const id = Number(picker.querySelector('select').value);
        if (!id) return;
        count.textContent = '';
        major.innerHTML = renderViewState({kind:'loading',title:'Загружаем обязательства'});
        try {
            const data = await app.api.get(`/projects/${id}/major-tasks?page=${page}`);
            if (token !== generation || !major.isConnected) return;
            count.innerHTML = badge({label:data.total});
            major.innerHTML = data.items.length ? `<ul class="work-major-list">${data.items.map(x => `<li><a class="ui-link work-major-link" href="#/work-projects?task=${x.id}"><span class="work-public-id">${esc(x.public_id)}</span><span>${esc(x.title)}</span><span aria-hidden="true">→</span></a></li>`).join('')}</ul>${workPager(page,data.total,30,'major')}` : renderViewState({title:'Крупных обязательств пока нет',message:'Прямые рабочие задачи проекта доступны ниже.'});
        } catch (e) {
            if (token === generation && major.isConnected) major.innerHTML = renderViewState({kind:'error',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-major':true}});
        }
    }
    async function options() {
        picker.innerHTML = renderViewState({kind:'loading',title:'Загружаем проекты'});
        try {
            const refs = await app.api.get('/work-tasks/options');
            if (!picker.isConnected) return;
            picker.innerHTML = field({id:'work-project',label:'Проект',kind:'select',options:[{value:'',label:'Выберите проект'},...refs.projects.map(x=>({value:x.id,label:x.name}))]});
            if (!refs.projects.length) empty.innerHTML = renderViewState({title:'Нет доступных проектов',message:'Проекты для просмотра пока отсутствуют.'});
            picker.querySelector('select').onchange = () => {
                generation++; page = 1;
                disposeWorkList(direct); direct.innerHTML = '';
                const id = Number(picker.querySelector('select').value);
                content.hidden = !id; empty.hidden = Boolean(id);
                if (!id) return;
                load(); mountWorkList(direct, app, null, id);
            };
        } catch (e) {
            if (picker.isConnected) picker.innerHTML = renderViewState({kind:'error',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-projects':true}});
        }
    }
    major.onclick = async e => {
        const step = e.target.closest('[data-page]')?.dataset.page;
        if (step) { page = Math.max(1,page + Number(step)); await load(); focusWorkPager(major, 'major', step); }
        if (e.target.closest('[data-retry-major]')) load();
    };
    picker.onclick = e => { if (e.target.closest('[data-retry-projects]')) options(); };
    await options();
}
