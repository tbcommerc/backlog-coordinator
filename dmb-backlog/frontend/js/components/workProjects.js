import { initProjectWorkspace } from './projectWorkspace.js?v=11';
import { getTaskEditPermission } from '../taskCardPermissions.js';
import { field, pageHeader, badge } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { mountWorkList, disposeWorkList } from './workTasks.js?v=31';
import { renderViewState } from './viewState.js';
import { workPager, focusWorkPager } from './workUi.js?v=2';
import { formatErrorMessage } from '../uiFeedback.js';

const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/><path d="M3 10h18"/></svg>';
const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';

export function renderWorkProjects() {
    return `<section class="work-page" id="work-projects-page">${pageHeader({title:'Проекты'})}<div id="work-project-body"></div></section>`;
}

export async function initWorkProjects(app) {
    return initProjectWorkspace(app, initProjectExecution);
}

export async function initProjectExecution(app, body) {
    const root = document.getElementById('work-projects-page');
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const projectId = Number(params.get('project'));
    const majorId = Number(params.get('major'));
    const directOnly = !majorId && params.get('scope') === 'direct';
    let page = Math.max(1, Math.min(100000,Math.trunc(Number(params.get('mp')) || 1))), generation = 0;
    let selectedMajor = null;
    const href = (major = null, direct = false) => {
        const query = new URLSearchParams(location.hash.split('?')[1] || '');
        query.set('section','execution');
        query.delete('task'); query.delete('major'); query.delete('scope'); query.delete('wp');
        if (major) query.set('major',major);
        else if (direct) query.set('scope','direct');
        if (page > 1) query.set('mp',page);
        return '#/work-projects?' + query;
    };
    const navItem = (url, title, selected, id = '') => `<a class="project-scope-link${selected ? ' is-current' : ''}" href="${esc(url)}"${selected ? ' aria-current="page"' : ''}>${id ? `<span class="project-obligation-id">${esc(id)}</span>` : ''}<span>${esc(title)}</span></a>`;
    const live = () => root.isConnected;
    const clearLists = () => body.querySelectorAll('.work-list-surface').forEach(disposeWorkList);
    async function loadProjects() {
        clearLists();
        root.querySelector('.project-breadcrumb')?.remove();
        body.innerHTML = renderViewState({kind:'loading',title:'Загружаем проекты'});
        try {
            const refs = await app.api.get('/work-tasks/options');
            if (!live()) return;
            if (projectId) {
                const project = refs.projects.find(x => x.id === projectId);
                if (!project) {
                    body.innerHTML = `<a class="ui-link" href="#/work-projects">Все проекты</a>${renderViewState({title:'Проект недоступен'})}`;
                    return;
                }
                root.querySelector('h1').textContent = project.name;

                body.innerHTML = `<div class="project-workspace"><aside class="project-structure" aria-label="Состав проекта"><details class="project-structure-disclosure" open><summary>Состав проекта ${arrowIcon}</summary><nav aria-label="Выбор работ проекта"><div class="project-scope-overview">${navItem(href(), 'Все рабочие задачи', !majorId && !directOnly)}${navItem(href(null,true), 'Напрямую в проекте', directOnly)}</div><div class="project-structure-heading"><h2>Задачи бэклога</h2><span id="work-major-count"></span></div><div id="work-project-major"></div></nav></details></aside><section class="project-work-area" aria-labelledby="project-work-title"><header class="work-section-head project-section-heading"><div><p id="project-work-context" class="project-work-context"></p><h2 id="project-work-title" tabindex="-1">${majorId ? 'Рабочие задачи выбранной задачи бэклога' : directOnly ? 'Напрямую в проекте' : 'Все рабочие задачи'}</h2><p id="project-work-description" class="project-section-note"></p><div id="project-major-card-link"></div></div><div data-work-create-slot></div></header><div id="work-project-direct"></div></section></div>`;
                const disclosure = body.querySelector('.project-structure-disclosure');
                disclosure.open = !matchMedia('(max-width: 900px)').matches;
                const host = body.querySelector('#work-project-direct');
                const description = body.querySelector('#project-work-description');
                if (majorId) {
                    host.innerHTML = renderViewState({kind:'loading',title:'Загружаем задачу бэклога'});
                    loadMajor();
                    try {
                        selectedMajor = await app.api.get(`/tasks/${majorId}`);
                        if (!live()) return;
                        if (Number(selectedMajor.project_id) !== projectId || selectedMajor.id !== majorId) {
                            selectedMajor = null;
                            host.innerHTML = renderViewState({title:'Задача бэклога недоступна в этом проекте',message:'Выберите другую задачу бэклога или все рабочие задачи.'});
                            return;
                        }
                        body.querySelector('#project-work-context').textContent = selectedMajor.public_id;
                        body.querySelector('#project-work-title').textContent = selectedMajor.title;
                        description.textContent = 'Рабочие задачи выбранной задачи бэклога. Новая рабочая задача будет связана с ней.';
                        body.querySelector('#project-major-card-link').innerHTML = `<a class="ui-link" href="${href(majorId)}&task=${majorId}">Карточка задачи →</a>`;
                        // Keep a deep-linked obligation visible even when it belongs to another page.
                        showSelectedMajor();
                        await mountWorkList(host, app, majorId, null, false, false, {canCreate:getTaskEditPermission(app.store.get('currentUser'),selectedMajor).allowed});
                        if (live()) body.querySelector('#project-work-title').focus({preventScroll:true});
                    } catch (e) {
                        if (live()) host.innerHTML = renderViewState({kind:'error',title:'Не удалось открыть задачу бэклога',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-projects':true}});
                    }
                } else {
                    description.textContent = directOnly ? 'Задачи, связанные напрямую с проектом. Новые задачи создаются здесь.' : 'Работы проекта и задач бэклога. Создание — напрямую в проекте.';
                    loadMajor();
                    await mountWorkList(host, app, null, projectId, false, !directOnly);
                    if (live() && directOnly) body.querySelector('#project-work-title').focus({preventScroll:true});
                }
                return;
            }
            body.innerHTML = `<form id="work-project-search-form" class="project-catalog-toolbar">${field({id:'work-project-search',label:'Поиск проекта',type:'search',attrs:{placeholder:'Найти по названию…'}})}<span id="project-search-count" class="project-catalog-count" role="status"></span></form><div id="work-project-list"></div>`;
            const search = body.querySelector('input');
            const list = body.querySelector('#work-project-list');
            const draw = () => {
                const filtered = refs.projects.filter(x => x.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
                body.querySelector('#project-search-count').textContent = `Показано ${filtered.length} из ${refs.projects.length}`;
                list.innerHTML = filtered.length ? `<ul class="project-catalog">${filtered.map(x => `<li><a class="project-card" href="#/work-projects?project=${x.id}" aria-label="${esc(x.name)}"><span class="project-card-icon">${folderIcon}</span><span class="project-card-name">${esc(x.name)}</span><span class="project-card-footer">Открыть проект ${arrowIcon}</span></a></li>`).join('')}</ul>` : renderViewState({title:refs.projects.length ? 'Проекты не найдены' : 'Нет доступных проектов',message:refs.projects.length ? 'Попробуйте другое название или сократите запрос.' : 'Проекты для просмотра пока отсутствуют.'});
            };
            search.oninput = draw;
            body.querySelector('form').onsubmit = e => { e.preventDefault(); draw(); };
            draw();
        } catch(e) {
            if (live()) body.innerHTML = renderViewState({kind:'error',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-projects':true}});
        }
    }
    async function loadMajor() {
        const token = ++generation;
        const major = body.querySelector('#work-project-major');

        major.innerHTML = renderViewState({kind:'loading',title:'Загружаем задачи бэклога'});
        try {
            const data = await app.api.get(`/projects/${projectId}/major-tasks?page=${page}`);
            if (!live() || token !== generation) return;
            body.querySelector('#work-major-count').innerHTML = badge({label:data.total});
            if (!data.items.length && page > 1) { page = Math.max(1,Math.ceil(data.total / 30)); return loadMajor(); }
            major.innerHTML = `<div data-selected-major></div>${data.items.length ? `<ul class="project-obligations">${data.items.map(x => `<li class="work-project-obligation" data-major="${x.id}">${navItem(href(x.id), x.title, x.id === majorId, x.public_id)}</li>`).join('')}</ul>` : renderViewState({title:'Задач бэклога пока нет',message:'Прямые задачи доступны в разделе «Напрямую в проекте».'})}${workPager(page,data.total,30,'major')}`;
            showSelectedMajor();
        } catch(e) {
            if (live() && token === generation) major.innerHTML = renderViewState({kind:'error',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-major':true}});
        }
    }
    function showSelectedMajor() {
        const selected = body.querySelector('[data-selected-major]');
        if (!selected || !selectedMajor) return;
        const listed = body.querySelector(`[data-major="${majorId}"]`);
        selected.innerHTML = listed ? '' : `<p class="project-selected-label">Выбрано</p>${navItem(href(majorId),selectedMajor.title,true,selectedMajor.public_id)}`;
    }
    body.onclick = async e => {
        if (e.target.closest('[data-retry-projects]')) { clearLists(); loadProjects(); }
        if (e.target.closest('[data-retry-major]')) loadMajor();
        const pager = e.target.closest('#work-project-major [data-page-scope=major]');
        const step = pager?.dataset.page;
        if (step) { page = Math.max(1,page + Number(step)); await loadMajor(); if(live()) focusWorkPager(body.querySelector('#work-project-major'),'major',step,pager.dataset.pageAction); }
    };
    await loadProjects();
}
