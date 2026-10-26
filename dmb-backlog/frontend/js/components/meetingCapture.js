import { escapeHtml as esc } from '../htmlUtils.js';
import { button, badge, field, checkbox, pageHeader, icon } from '../ui/primitives.js';
import { confirmAction } from '../uiFeedback.js';

const BASE = '/meeting-capture';
const activeAnalysis = state => ['queued', 'running'].includes(state.analysis_status);
const analysisLabel = row => row.status === 'saved' ? 'Сохранено' : ({ queued: 'В очереди', running: 'Анализируется', completed: row.item_count === 0 || row.items?.length === 0 ? 'Пунктов не найдено' : 'Готов к проверке', failed: 'Ошибка анализа' }[row.analysis_status] || 'Черновик');
export function meetingReviewSummary(items) {
    return { total: items.length, checked: items.filter(i => i.selected).length,
        actions: items.filter(i => i.kind === 'action').length,
        agreements: items.filter(i => i.kind === 'agreement').length,
        missingOwner: items.filter(i => !i.owner_text?.trim()).length,
        missingDate: items.filter(i => !i.due_date).length };
}
export const TRANSCRIPT_LIMIT = 60000;
const kindLabel = kind => kind === 'agreement' ? 'Договорённость' : 'Поручение';
const action = (label, name, extra = {}) => button({ label, ...extra, attrs: { 'data-action': name, ...extra.attrs } });

export function newMeetingItem(id = crypto.randomUUID()) {
    return { id, kind: 'action', title: 'Новое поручение', description: '', owner_text: '',
        due_date: null, due_text: '', quote: '', origin: 'manual', selected: false, link_choice: null, task_id: null };
}

export function reviewIssues(items) {
    const chosen = items.filter(item => item.selected);
    if (!chosen.length) return ['Отметьте хотя бы один пункт для сохранения.'];
    return chosen.flatMap((item, index) => [
        !item.title.trim() && `Пункт ${index + 1}: заполните название.`,
        !item.link_choice && `«${item.title}»: выберите крупную задачу или «Без привязки».`,
        item.link_choice === 'task' && !item.task_id && `«${item.title}»: выберите задачу из результатов поиска.`,
    ].filter(Boolean));
}

export async function readTranscriptFile(file) {
    if (!/\.(txt|md|srt|vtt)$/i.test(file.name)) throw new Error('Поддерживаются TXT, MD, SRT и VTT в UTF-8.');
    if (file.size > 240000) throw new Error('Файл слишком большой. Максимум 240 КБ и 60 000 символов.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('Не удалось прочитать UTF-8. Пересохраните файл в этой кодировке.'); }
    if (text.includes('\0')) throw new Error('Файл содержит двоичные данные. Загрузите текстовый файл.');
    if (text.length > TRANSCRIPT_LIMIT) throw new Error('В расшифровке больше 60 000 символов. Разделите её на несколько встреч.');
    if (!text.trim()) throw new Error('Файл пуст.');
    return text;
}

export function renderMeetingCapture() {
    return `<section id="meeting-capture" class="mc-page">
        ${pageHeader({ title: 'Поручения из встреч', description: 'Превратите разговор в согласованный план действий.', actions: action('Новый разбор', 'new', { icon: 'plus' }) })}
        <ol class="mc-steps" aria-label="Этапы разбора">${['Расшифровка', 'Анализ', 'Проверка результатов', 'Сохранение'].map((label, index) => `<li data-step="${index}"><span>${index + 1}</span> ${label}</li>`).join('')}</ol>
        <div id="mc-notice" class="mc-notice" role="status" aria-live="polite"></div>
        <div id="mc-error" class="mc-error" role="alert" hidden></div>
        <div id="mc-workspace"></div>
        <details class="mc-history"><summary>Мои разборы встреч</summary><div id="mc-history-list">Загрузка…</div></details>
    </section>`;
}

function renderItem(item, index, links, suggestions, expanded) {
    const prefix = `mc-${item.id}`;
    const prop = (name, label, props = {}) => field({ id: `${prefix}-${name}`, label, value: item[name] || '', attrs: { 'data-field': name, maxlength: 255 }, ...props });
    const linked = links.find(task => task.id === item.task_id);
    return `<details class="mc-item" data-item="${esc(item.id)}" ${expanded ? 'open' : ''}>
        <summary><strong data-summary-title>${esc(item.title)}</strong><span data-summary-meta>${esc(item.owner_text || 'Исполнитель не указан')} · ${esc(item.due_date || item.due_text || 'Срок не указан')}</span><span data-summary-status>${item.selected ? 'Проверено · включено' : 'Требует проверки'}</span></summary>
        <div class="mc-item-body">
        <div class="mc-item-heading"><span class="mc-item-number">${index + 1}</span>${badge({ label: kindLabel(item.kind), tone: item.kind === 'action' ? 'accent' : 'info' })}
            ${badge({ label: item.origin === 'ai' ? 'Из расшифровки' : 'Добавлено вручную' })}${action('Удалить пункт', 'remove', { icon: 'trash-2', iconOnly: true, variant: 'ghost' })}</div>
        ${prop('title', 'Что согласовано', { required: true })}
        ${prop('kind', 'Тип записи', { kind: 'select', options: [{ value: 'action', label: 'Поручение — нужно выполнить' }, { value: 'agreement', label: 'Договорённость — принятое решение' }] })}
        ${prop('description', 'Ожидаемый результат и детали', { kind: 'textarea', attrs: { 'data-field': 'description', rows: 2, maxlength: 5000 } })}
        <div class="mc-two-fields">${prop('owner_text', 'Исполнитель по расшифровке', { hint: 'Имя текстом. Это не назначение пользователя.', attrs: { 'data-field': 'owner_text', maxlength: 255, placeholder: 'Не указан' } })}${prop('due_date', 'Подтверждённый срок', { type: 'date' })}</div>
        ${prop('due_text', 'Как срок прозвучал на встрече', { attrs: { 'data-field': 'due_text', maxlength: 255, placeholder: 'Например: к следующей пятнице' } })}
        <p class="mc-hint">Проверьте исполнителя и срок. Агент не заполняет отсутствующие факты.</p>
        ${item.quote ? `<details class="mc-evidence"><summary>Основание в расшифровке</summary><blockquote>${esc(item.quote)}</blockquote></details>` : '<p class="mc-hint">Добавлено вручную — цитата не требуется.</p>'}
        <details class="mc-link-box" ${item.link_choice === 'task' || suggestions !== undefined ? 'open' : ''}><summary>Связь с крупной задачей${item.link_choice === 'none' ? ' · без привязки' : item.task_id ? ' · выбрана' : ' · требуется решение'}</summary><p class="mc-hint">Предложение становится связью только после вашего выбора.</p>
            ${field({ id: `${prefix}-link`, label: 'Решение о привязке', kind: 'select', value: item.link_choice || '', options: [{ value: '', label: 'Ещё не выбрано' }, { value: 'task', label: 'Выбрать крупную задачу ниже' }, { value: 'none', label: 'Без привязки' }], attrs: { 'data-field': 'link_choice' } })}
            ${linked ? `<p class="mc-chosen">${icon('link')} ${esc(linked.public_id || '#' + linked.id)} · ${esc(linked.title)}</p>` : item.task_id ? '<p class="mc-error">Ранее выбранная задача недоступна. Измените привязку.</p>' : ''}
            <div class="mc-actions">${action('Предложить соответствия', 'suggest', { icon: 'sparkles', size: 'small' })}</div>
            <div class="mc-two-fields mc-search">${field({ id: `${prefix}-search`, label: 'Поиск по названию или номеру', type: 'search', attrs: { 'data-search': true, maxlength: 255, placeholder: 'Не менее 2 символов' } })}${action('Найти', 'search', { icon: 'search' })}</div>
            <div class="mc-suggestions" aria-live="polite">${suggestions === undefined ? '' : suggestions.length ? suggestions.map(task => `<div class="mc-suggestion">${button({ label: `${task.public_id || '#' + task.id} · ${task.title}`, className: 'mc-task-choice', attrs: { 'data-action': 'link', 'data-task': task.id } })}${task.reason ? `<small>${esc(task.reason)}</small>` : ''}</div>`).join('') : '<p class="mc-hint">Соответствий не найдено. Попробуйте другое название или выберите «Без привязки».</p>'}</div>
        </details>
        ${checkbox({ id: `${prefix}-selected`, label: 'Проверено — включить в сохранение', checked: item.selected, attrs: { 'data-field': 'selected' } })}
        <p class="mc-hint">Непроверенные пункты останутся в составе разбора без создания поручений.</p>
        </div></details>`;
}

function renderAnalysis(state) {
    const phase = state.analysis;
    if (['saving', 'queued', 'running'].includes(phase)) return `<div class="mc-panel mc-analysis">
        <h3 id="mc-analysis-title" tabindex="-1">${phase === 'saving' ? 'Сохраняем расшифровку' : phase === 'queued' ? 'Анализ в очереди' : 'Анализируем расшифровку'}</h3>
        <p>Ищем поручения и договорённости, подбираем цитаты из разговора.</p>
        <p>${phase !== 'saving' ? '✓ Расшифровка сохранена в черновике.' : 'Перед анализом сохраним источник в черновике.'}</p>
        <p aria-hidden="true">Прошло <span id="mc-elapsed" class="mc-elapsed">00:00</span></p>
        <p id="mc-long-wait" hidden>Ответ пока не получен. Повторно запускать разбор не нужно.</p>
        <p class="mc-hint">${phase === 'saving' ? 'Сохраняем источник перед запуском.' : 'Можно уйти со страницы или обновить её. Анализ продолжится на сервере; статус и результат доступны в «Моих разборах встреч».'}</p></div>`;
    if (phase === 'empty') return `<div class="mc-panel mc-empty"><h3 id="mc-analysis-title" tabindex="-1">Разбор завершён</h3><p>Явных поручений и договорённостей не найдено.</p><p>Просмотрите источник, измените текст или добавьте пункт вручную.</p></div>`;
    if (['failed', 'uncertain', 'configuration'].includes(phase)) return `<div class="mc-panel mc-analysis"><h3 id="mc-analysis-title" tabindex="-1">${phase === 'configuration' ? 'Нужно проверить настройки AI' : phase === 'uncertain' ? 'Не удалось получить результат' : 'Не удалось завершить разбор'}</h3>
        <p>${state.sourceSaved ? 'Исходная расшифровка сохранена в черновике.' : 'Текст остаётся на странице. Сохранение черновика не подтверждено.'}</p>
        ${state.analysis_error_message && phase !== 'configuration' ? `<p>${esc(state.analysis_error_message)}</p>` : ''}
        <p>${phase === 'configuration' ? 'Провайдер AI отклонил авторизацию. Попросите администратора проверить ключ и доступ к модели. Повтор без изменения настроек не поможет. Можно добавить пункты вручную.' : phase === 'uncertain' ? 'Связь прервалась: анализ мог продолжиться на сервере. Сначала проверьте результат.' : 'Повторите попытку или добавьте пункты вручную.'}</p>
        ${state.id ? action('Проверить результат', 'reload-result') : ''}</div>`;
    return `<div class="mc-panel mc-empty">${icon('list-checks')}<h3>Здесь появится план действий</h3><p>Добавьте расшифровку и запустите разбор. Каждый пункт можно исправить, дополнить или удалить.</p><p class="mc-hint">Можно начать вручную, даже если AI недоступен.</p></div>`;
}

function renderWorkspace(state) {
    const saved = state.status === 'saved';
    if (state.preview || saved) {
        const chosen = state.items.filter(item => item.selected);
        return `<section class="mc-panel mc-preview"><h2 id="mc-result-title" tabindex="-1">${saved ? 'Результат сохранён' : 'Проверьте перед сохранением'}</h2><p>${esc(state.title)}${state.meeting_date ? ' · ' + esc(state.meeting_date) : ''}</p>
            <p class="mc-hint">${saved ? 'Поручения и договорённости доступны в истории разборов этой страницы.' : `Будет создано записей: ${chosen.length}. Остальные пункты останутся в составе разбора без создания поручений.`}</p>
            <p class="mc-hint">Имя из расшифровки не назначает пользователя и не отправляет уведомлений.</p>
            <div class="mc-review-list">${chosen.map(item => {
                const task = state.links.find(link => link.id === item.task_id);
                return `<article>${badge({ label: kindLabel(item.kind) })}<h3>${esc(item.title)}</h3><p class="mc-preserve">${esc(item.description)}</p>
                    <dl><dt>Исполнитель</dt><dd>${esc(item.owner_text || 'Не указан')}</dd><dt>Срок</dt><dd>${esc(item.due_date || 'Не установлен')}${item.due_text ? ' · ' + esc(item.due_text) : ''}</dd>
                    <dt>Крупная задача</dt><dd>${task ? `<a class="ui-link" href="#/backlog?task=${task.id}">${esc(task.public_id || '#' + task.id)} · ${esc(task.title)}</a>` : item.task_id ? 'Задача недоступна' : 'Без привязки'}</dd></dl>
                    ${item.quote ? `<details><summary>Основание</summary><blockquote>${esc(item.quote)}</blockquote></details>` : ''}</article>`;
            }).join('')}</div>
            ${saved ? `<details><summary>Исходная расшифровка</summary><pre class="mc-preserve">${esc(state.transcript)}</pre></details>` : `<div class="mc-actions">${action('Вернуться к правкам', 'back')}${action(`Создать выбранные записи — ${chosen.length}`, 'confirm', { variant: 'primary', icon: 'check' })}</div>`}
        </section>`;
    }
    const summary = meetingReviewSummary(state.items);
    const analyzing = ['saving', 'queued', 'running'].includes(state.analysis);
    return `<fieldset class="mc-editor"><legend class="mc-sr-only">Разбор встречи</legend><div class="mc-columns">
        <section class="mc-panel mc-source"><div class="mc-section-title">${icon('file-text')}<h2>Расшифровка</h2></div>
            ${field({ id: 'mc-title', label: 'Название встречи', required: true, value: state.title, attrs: { 'data-meta': 'title', maxlength: 255 } })}
            ${field({ id: 'mc-date', label: 'Дата встречи', type: 'date', value: state.meeting_date || '', attrs: { 'data-meta': 'meeting_date' } })}
            <label class="mc-upload" for="mc-file">${icon('upload')}<strong>Загрузить текстовый файл</strong><span>TXT, MD, SRT или VTT · UTF-8 · до 240 КБ</span><input type="file" id="mc-file" accept=".txt,.md,.srt,.vtt,text/plain,text/markdown,text/vtt" ${state.items.length ? 'disabled' : ''}></label>
            ${field({ id: 'mc-transcript', label: 'Или вставьте текст', kind: 'textarea', value: state.transcript, readonly: state.items.length > 0 || analyzing,
                hint: analyzing ? 'Расшифровка сохранена для фонового анализа. Можно читать и копировать текст.' : state.items.length ? 'Источник зафиксирован для сохранения оснований. Для другого текста создайте новый разбор.' : 'До 60 000 символов. Аудио и видео нужно предварительно расшифровать.',
                attrs: { 'data-meta': 'transcript', rows: 12, maxlength: TRANSCRIPT_LIMIT, placeholder: 'Вставьте расшифровку разговора с именами участников…' } })}
            <div class="mc-actions">${action(analyzing ? 'Анализируем…' : state.analysis === 'configuration' ? 'Повторить после настройки AI' : ['failed', 'uncertain'].includes(state.analysis) ? 'Повторить анализ' : 'Найти поручения и договорённости', 'analyze', { variant: 'primary', icon: 'sparkles', attrs: { disabled: state.items.length > 0 || analyzing || state.analysis_status === 'completed' } })}</div>
            <p class="mc-hint">AI отделит поручения от решений и приложит цитаты. Все результаты требуют вашей проверки.</p>
        </section>
        <section class="mc-results" aria-busy="${analyzing}"><div class="mc-section-title"><h2>Поручения и договорённости</h2>${analyzing ? '' : `<span>${state.items.length}</span>`}</div>
            ${state.items.length ? `<div class="mc-review-summary"><p>Поручений: ${summary.actions} · Договорённостей: ${summary.agreements}</p><p role="status">Проверено <span data-review-count>${summary.checked}</span> из ${summary.total}</p><p class="mc-hint">Без исполнителя: <span data-missing-owner>${summary.missingOwner}</span> · Без календарного срока: <span data-missing-date>${summary.missingDate}</span>. Можно сохранить без этих данных.</p>${action('Следующий непроверенный', 'next', { attrs: { disabled: summary.checked === summary.total } })}</div>` + state.items.map((item, index) => renderItem(item, index, state.links, state.suggestions[item.id], state.expandedId === item.id)).join('') : renderAnalysis(state)}
            ${action('Добавить пункт вручную', 'add', { icon: 'plus', attrs: { disabled: state.items.length >= 60 } })}
        </section></div>
        <div class="mc-footer"><span id="mc-draft-status">${state.analysis === 'running' ? 'Расшифровка сохранена · анализ выполняется' : state.analysis === 'queued' ? 'Расшифровка сохранена · анализ в очереди' : state.analysis === 'saving' ? 'Сохраняем расшифровку…' : state.dirty ? 'Есть несохранённые изменения' : state.id ? 'Черновик сохранён' : 'Новый разбор'}</span><div class="mc-actions">${action('Сохранить черновик', 'save', { icon: 'save' })}${action(`Перейти к подтверждению — ${summary.checked}`, 'preview', { variant: 'primary', icon: 'arrow-right', attrs: { disabled: !summary.checked } })}</div></div>
        </fieldset>`;
}

export async function initMeetingCapture(app) {
    const root = document.getElementById('meeting-capture');
    if (!root) return;
    const fresh = () => ({ id: null, createId: crypto.randomUUID(), title: 'Новая встреча', meeting_date: null, transcript: '', items: [], links: [], suggestions: {}, version: 0, status: 'draft', dirty: false, preview: false, analysis: 'idle', analysis_status: 'idle', sourceSaved: false, expandedId: null });
    let state = fresh(), busy = false, analysisTimer = null, analysisStarted = 0, pollTimer = null, viewGeneration = 0, accessDenied = false;
    const referenceKey = `meeting-capture:active:${app.store?.get('currentUser')?.id ?? 'fixture'}`;
    const remember = id => {
        try { if (id) sessionStorage.setItem(referenceKey, id); else sessionStorage.removeItem(referenceKey); } catch { /* History remains available without browser storage. */ }
        const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
        if (query.has('capture')) {
            if (id) query.set('capture', id); else query.delete('capture');
            const route = `/meeting-capture${query.size ? `?${query}` : ''}`;
            history.replaceState(null, '', `#${route}`);
            if (app.router.lastHash !== undefined) app.router.lastHash = route;
        }
    };
    const remembered = () => { try { return sessionStorage.getItem(referenceKey); } catch { return null; } };
    const workspace = root.querySelector('#mc-workspace'), notice = root.querySelector('#mc-notice'), errorBox = root.querySelector('#mc-error');
    const showError = error => {
        errorBox.hidden = false;
        errorBox.textContent = !error?.status && ['TypeError', 'AbortError'].includes(error?.name)
            ? 'Не удалось связаться с сервером. Проверьте соединение и сохранённый результат.'
            : error?.message || 'Не удалось выполнить действие.';
    };
    const clearError = () => { errorBox.hidden = true; errorBox.textContent = ''; };
    const draw = () => {
        if (!root.isConnected) return;
        workspace.innerHTML = renderWorkspace(state);
        const current = state.preview || state.status === 'saved' ? 3 : ['saving', 'queued', 'running', 'failed', 'uncertain', 'configuration'].includes(state.analysis) ? 1 : state.items.length || state.analysis === 'empty' ? 2 : 0;
        root.querySelectorAll('[data-step]').forEach(el => { if (Number(el.dataset.step) === current) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
        if (busy) root.querySelectorAll('button,input,textarea,select').forEach(el => {
            if (el.id === 'mc-transcript') el.readOnly = true;
            else el.disabled = true;
        });
        else if (activeAnalysis(state)) workspace.querySelectorAll('button,input,textarea,select').forEach(el => {
            if (el.tagName === 'TEXTAREA') el.readOnly = true;
            else el.disabled = true;
        });
        root.querySelector('[data-action="new"]').disabled = busy;
        root.querySelectorAll('#mc-history-list button').forEach(el => { el.disabled = busy; });
        if (accessDenied) root.querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = true; });
        window.lucide?.createIcons();
    };
    const stopTimer = () => { clearInterval(analysisTimer); analysisTimer = null; };
    const stopPolling = () => { clearTimeout(pollTimer); pollTimer = null; stopTimer(); };
    const updateTimer = () => {
        if (!root.isConnected) { stopTimer(); return; }
        const seconds = Math.floor((Date.now() - analysisStarted) / 1000);
        const timer = root.querySelector('#mc-elapsed');
        if (timer) timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        const longWait = root.querySelector('#mc-long-wait');
        if (longWait?.hidden && seconds >= 60) notice.textContent = 'Ответ пока не получен. Повторно запускать разбор не нужно.';
        if (longWait) longWait.hidden = seconds < 60;
    };
    const focusItem = id => {
        state.expandedId = id; draw();
        const details = [...root.querySelectorAll('.mc-item')].find(el => el.dataset.item === id);
        details?.querySelector('summary')?.focus();
        details?.scrollIntoView({ block: 'nearest' });
    };
    const focusAnalysis = () => {
        const heading = root.querySelector('#mc-analysis-title');
        heading?.focus({ preventScroll: true });
        heading?.parentElement?.scrollIntoView({ block: 'center' });
    };
    root.addEventListener('toggle', event => {
        if (!event.target.isConnected || !event.target.matches?.('.mc-item')) return;
        if (event.target.open) state.expandedId = event.target.dataset.item;
        else if (state.expandedId === event.target.dataset.item) state.expandedId = null;
    }, true);
    const markDirty = () => { state.dirty = true; const label = root.querySelector('#mc-draft-status'); if (label) label.textContent = 'Есть несохранённые изменения'; };
    const apply = result => {
        state = { ...state, ...result, dirty: false, sourceSaved: true };
        if (result.analysis_status) state.analysis = ({ queued: 'queued', running: 'running', completed: state.items.length ? 'done' : 'empty', failed: state.analysis_error_code === 'meeting_ai_auth' ? 'configuration' : 'failed' })[result.analysis_status] || (state.items.length ? 'done' : 'idle');
        if (state.analysis_requested_at) analysisStarted = Date.parse(state.analysis_requested_at);
        remember(state.id);
    };
    const history = async () => {
        const rows = await app.api.get(`${BASE}/sessions`);
        if (!root.isConnected) return;
        root.querySelector('#mc-history-list').innerHTML = rows.length ? rows.map(row => `<div class="mc-history-row">${button({ label: row.title, variant: 'ghost', attrs: { 'data-action': 'open', 'data-id': row.id } })}${badge({ label: analysisLabel(row), tone: row.status === 'saved' || row.analysis_status === 'completed' ? 'success' : row.analysis_status === 'failed' ? 'danger' : 'neutral' })}</div>`).join('') : '<p class="mc-hint">Сохранённых разборов пока нет.</p>';
    };
    const refreshHistory = () => {
        history().catch(error => {
            if (!root.isConnected) return;
            root.querySelector('#mc-history-list').textContent = 'История временно недоступна. Текущий разбор остаётся на странице.';
            if ([401, 403].includes(error.status)) { accessDenied = true; draw(); showError(error); }
        });
    };
    const syncPolling = () => {
        stopPolling();
        if (!activeAnalysis(state) || !root.isConnected) return;
        updateTimer(); analysisTimer = setInterval(updateTimer, 1000);
        const generation = viewGeneration, captureId = state.id, runId = state.analysis_run_id;
        const current = () => root.isConnected && generation === viewGeneration && state.id === captureId && state.analysis_run_id === runId;
        const poll = async () => {
            if (!current() || !activeAnalysis(state)) return;
            try {
                const status = await app.api.get(`${BASE}/sessions/${captureId}/status`, { passive: true });
                if (!current()) return;
                if (status.analysis_run_id !== runId) {
                    const result = await app.api.get(`${BASE}/sessions/${captureId}`, { passive: true });
                    if (!current()) return;
                    apply(result); state.expandedId = state.items[0]?.id || null; clearError(); draw(); syncPolling();
                    return;
                }
                if (!['queued', 'running'].includes(status.analysis_status)) {
                    const result = await app.api.get(`${BASE}/sessions/${captureId}`, { passive: true });
                    if (!current()) return;
                    apply(result); state.expandedId = state.items[0]?.id || null; clearError(); draw(); stopPolling();
                    notice.textContent = state.analysis_status === 'completed' ? state.items.length ? `Найдено пунктов: ${state.items.length}. Проверьте результат.` : 'Разбор завершён. Явных поручений и договорённостей не найдено.' : state.analysis_error_message || 'Не удалось завершить анализ.';
                    if (state.items.length) focusItem(state.expandedId); else focusAnalysis();
                    refreshHistory();
                    return;
                }
                clearError();
                const changed = status.analysis_status !== state.analysis_status;
                apply(status);
                if (changed) { draw(); updateTimer(); }
            } catch (error) {
                if (!current()) return;
                if ([401, 403, 404].includes(error.status)) { stopPolling(); if ([401, 403].includes(error.status)) { accessDenied = true; draw(); } showError(error); return; }
                errorBox.hidden = false; errorBox.textContent = 'Не удалось обновить статус. Анализ продолжается на сервере; повторим проверку автоматически.';
            }
            if (current() && activeAnalysis(state)) pollTimer = setTimeout(poll, 2000);
        };
        pollTimer = setTimeout(poll, 1000);
    };
    const save = async () => {
        if (!state.title.trim()) throw new Error('Укажите название встречи.');
        if (state.items.some(item => !item.title.trim())) throw new Error('Заполните названия всех пунктов.');
        const payload = { title: state.title, meeting_date: state.meeting_date, transcript: state.transcript, items: state.items };
        if (!state.id) {
            const result = await app.api.post(`${BASE}/sessions/${state.createId}`, payload);
            state.id = result.id; state.version = result.version; state.status = result.status;
            if (state.status !== 'draft') { apply(result); return; }
        }
        apply(await app.api.put(`${BASE}/sessions/${state.id}`, { ...payload, version: state.version }));
    };
    const canLeave = async () => {
        if (busy) { showError(new Error('Дождитесь завершения текущего действия.')); return false; }
        return !state.dirty || confirmAction({ title: 'Оставить несохранённые изменения?', message: 'Изменения после последнего сохранения черновика будут потеряны.', confirmText: 'Оставить изменения', cancelText: 'Продолжить редактирование' });
    };
    const beforeUnload = event => { if (state.dirty || busy) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    const previousGuard = app.router.onBeforeNavigate;
    const guard = async (to, from) => {
        if (to === '/meeting-capture' && !new URLSearchParams(window.location.hash.split('?')[1] || '').has('capture')) return true;
        if (!await canLeave() || (previousGuard && !await previousGuard(to, from))) return false;
        viewGeneration++; stopPolling();
        window.removeEventListener('beforeunload', beforeUnload);
        if (app.router.onBeforeNavigate === guard) app.router.onBeforeNavigate = previousGuard;
        return true;
    };
    app.router.onBeforeNavigate = guard;
    root.addEventListener('input', event => {
        const el = event.target;
        if (busy || activeAnalysis(state)) return;
        if (el.dataset.meta) {
            if (['transcript', 'meeting_date'].includes(el.dataset.meta) && !state.items.length && state.analysis !== 'idle') {
                state.analysis = 'idle';
                state.analysis_status = 'idle';
                const panel = root.querySelector('.mc-results > .mc-panel'); if (panel) panel.outerHTML = renderAnalysis(state);
                root.querySelector('[data-action="analyze"]').textContent = 'Найти поручения и договорённости';
                root.querySelector('[data-action="analyze"]').disabled = false;
                root.querySelector('[aria-current="step"]')?.removeAttribute('aria-current');
                root.querySelector('[data-step="0"]').setAttribute('aria-current', 'step');
            }
            state[el.dataset.meta] = el.value || (el.dataset.meta === 'meeting_date' ? null : ''); markDirty();
        }
        const row = el.closest('[data-item]');
        if (!row || !el.dataset.field) return;
        const item = state.items.find(entry => entry.id === row.dataset.item), key = el.dataset.field;
        item[key] = key === 'selected' ? el.checked : el.value || (['due_date', 'link_choice'].includes(key) ? null : '');
        if (key === 'link_choice') item.task_id = null;
        if (['title', 'description'].includes(key)) delete state.suggestions[item.id];
        if (key !== 'selected') item.selected = false;
        markDirty();
        if (['kind', 'link_choice'].includes(key)) draw();
        else {
            const selected = row.querySelector('[data-field="selected"]'); if (selected) selected.checked = item.selected;
            row.querySelector('[data-summary-title]').textContent = item.title;
            row.querySelector('[data-summary-meta]').textContent = `${item.owner_text || 'Исполнитель не указан'} · ${item.due_date || item.due_text || 'Срок не указан'}`;
            row.querySelector('[data-summary-status]').textContent = item.selected ? 'Проверено · включено' : 'Требует проверки';
            const summary = meetingReviewSummary(state.items);
            root.querySelector('[data-review-count]').textContent = summary.checked;
            root.querySelector('[data-missing-owner]').textContent = summary.missingOwner;
            root.querySelector('[data-missing-date]').textContent = summary.missingDate;
            const preview = root.querySelector('[data-action="preview"]'); preview.disabled = !summary.checked; preview.textContent = `Перейти к подтверждению — ${summary.checked}`;
            root.querySelector('[data-action="next"]').disabled = summary.checked === summary.total;
        }
    });
    root.addEventListener('change', async event => {
        if (event.target.id !== 'mc-file' || busy || activeAnalysis(state)) return;
        clearError();
        const file = event.target.files?.[0];
        if (!file) return;
        const fileState = state;
        try {
            const text = await readTranscriptFile(file);
            if (!root.isConnected || state !== fileState || state.items.length || busy) return;
            if (state.transcript.trim() && !await confirmAction({ title: 'Заменить текст расшифровки?', message: 'Текущий текст будет заменён содержимым файла.', confirmText: 'Заменить' })) return;
            state.transcript = text; state.analysis = 'idle'; state.analysis_status = 'idle';
            if (state.title === 'Новая встреча') state.title = file.name.replace(/\.[^.]+$/, '').slice(0, 255);
            markDirty(); draw();
        } catch (error) { showError(error); }
        finally { event.target.value = ''; }
    });
    root.addEventListener('click', async event => {
        const target = event.target.closest('[data-action]');
        if (!target || busy) return;
        const name = target.dataset.action;
        if (activeAnalysis(state) && !['new', 'open', 'reload-result'].includes(name)) return;
        if (name === 'next') {
            const current = state.items.findIndex(entry => entry.id === state.expandedId);
            const ordered = [...state.items.slice(current + 1), ...state.items.slice(0, current + 1)];
            const next = ordered.find(entry => !entry.selected);
            if (next) focusItem(next.id);
            return;
        }
        clearError();
        if (['new', 'open'].includes(name) && !await canLeave()) return;
        const row = target.closest('[data-item]'), item = row && state.items.find(entry => entry.id === row.dataset.item);
        busy = true;
        const controls = [...root.querySelectorAll('button,input,textarea,select')].map(el => [el, el.disabled]);
        controls.forEach(([el]) => { if (el.id === 'mc-transcript') el.readOnly = true; else el.disabled = true; });
        workspace.setAttribute('aria-busy', 'true');
        notice.textContent = name === 'analyze' ? 'Подготавливаем разбор…' : 'Выполняется…';
        let message = '', analysisSent = false;
        const focusId = document.activeElement?.id;
        try {
            if (name === 'new') { viewGeneration++; stopPolling(); state = fresh(); remember(null); }
            if (name === 'open') { viewGeneration++; stopPolling(); const result = await app.api.get(`${BASE}/sessions/${target.dataset.id}`); state = fresh(); apply(result); state.expandedId = result.items[0]?.id || null; }
            if (name === 'add') { const added = newMeetingItem(); state.items.push(added); state.expandedId = added.id; markDirty(); }
            if (name === 'remove' && await confirmAction({ title: 'Удалить пункт из разбора?', message: item.title, confirmText: 'Удалить', destructive: true })) { state.items = state.items.filter(entry => entry.id !== item.id); markDirty(); }
            if (name === 'back') state.preview = false;
            if (name === 'save') { await save(); message = 'Черновик сохранён. Поручения ещё не созданы.'; }
            if (name === 'analyze' || name === 'reload-result') {
                if (state.id) {
                    const latest = await app.api.get(`${BASE}/sessions/${state.id}`);
                    if (latest.items.length || latest.status === 'saved' || latest.version !== state.version || ['queued', 'running'].includes(latest.analysis_status) || latest.analysis_status === 'completed' && !state.dirty) {
                        if (state.dirty) throw new Error('На сервере есть более новая версия. Скопируйте свои изменения и откройте разбор из истории.');
                        apply(latest);
                        state.expandedId = state.items[0]?.id || null;
                        message = 'Загружена актуальная версия разбора.';
                        return;
                    } else if (name === 'reload-result') {
                        message = 'Готовый результат пока не сохранён. Можно проверить позже или явно повторить анализ.';
                    }
                    if (name === 'reload-result' || state.items.length || latest.status === 'saved') { draw(); return; }
                }
                if (!state.transcript.trim()) throw new Error('Добавьте текст или загрузите файл расшифровки.');
                state.analysis = 'saving'; state.sourceSaved = false; analysisStarted = Date.now(); draw(); focusAnalysis();
                analysisTimer = setInterval(updateTimer, 1000);
                await save(); state.sourceSaved = true; state.analysis = 'running'; draw(); updateTimer(); focusAnalysis();
                notice.textContent = 'Расшифровка сохранена. Анализ выполняется.';
                analysisSent = true;
                apply(await app.api.post(`${BASE}/sessions/${state.id}/analyze`, { version: state.version }));
                if (!state.analysis_status || state.analysis_status === 'idle') state.analysis = state.items.length ? 'done' : 'empty';
                state.expandedId = state.items[0]?.id || null;
                message = activeAnalysis(state) ? 'Анализ запущен в фоне. Можно уйти со страницы или обновить её.' : state.items.length ? `Найдено пунктов: ${state.items.length}. Проверьте текст, сроки и привязки.` : 'Разбор завершён. Явных поручений и договорённостей не найдено.';
            }
            if (name === 'suggest' || name === 'search') {
                const q = row.querySelector('[data-search]').value.trim();
                if (name === 'search' && q.length < 2) throw new Error('Введите минимум 2 символа для поиска.');
                const results = name === 'suggest' ? await app.api.post(`${BASE}/suggestions`, item) : await app.api.get(`${BASE}/tasks?q=${encodeURIComponent(q)}`);
                state.suggestions[item.id] = results;
                for (const result of results) if (!state.links.some(link => link.id === result.id)) state.links.push(result);
                message = name === 'suggest' ? 'Предложения основаны на совпадениях в названии и описании доступных крупных задач.' : '';
            }
            if (name === 'link') { item.task_id = Number(target.dataset.task); item.link_choice = 'task'; item.selected = false; markDirty(); }
            if (name === 'preview') { const issues = reviewIssues(state.items); if (issues.length) throw new Error(issues.join('\n')); await save(); state.preview = true; }
            if (name === 'confirm') { apply(await app.api.post(`${BASE}/sessions/${state.id}/confirm`, { version: state.version })); message = `Сохранено записей: ${state.saved_count}. Повторное подтверждение не создаст дубли.`; }
            draw();
            if (['save', 'analyze', 'confirm', 'preview'].includes(name)) refreshHistory();
        } catch (error) {
            if (name === 'analyze') {
                state.analysis = error.code === 'meeting_ai_auth' ? 'configuration' : analysisSent && !error.status ? 'uncertain' : 'failed';
                if (analysisSent && state.id) {
                    try {
                        const latest = await app.api.get(`${BASE}/sessions/${state.id}`);
                        if (latest.items.length || latest.status === 'saved' || latest.analysis_status && latest.analysis_status !== 'idle') {
                            apply(latest); state.expandedId = state.items[0]?.id || null;
                            message = 'Связь прерывалась. Результат восстановлен из сохранённого разбора.';
                        }
                    } catch { /* Source remains available; outcome is not assumed. */ }
                }
            }
            if (!message) showError(error);
        } finally {
            stopTimer(); busy = false; workspace.removeAttribute('aria-busy'); notice.textContent = message;
            controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
            draw();
            syncPolling();
            if (focusId) document.getElementById(focusId)?.focus();
            if (name === 'analyze' && state.items.length) focusItem(state.expandedId);
            else if (name === 'analyze') focusAnalysis();
            if (['preview', 'confirm', 'open'].includes(name) && (state.preview || state.status === 'saved')) {
                const heading = root.querySelector('#mc-result-title');
                heading?.focus({ preventScroll: true });
                heading?.scrollIntoView({ block: 'nearest' });
            }
        }
    });
    const requestedCapture = new URLSearchParams(window.location.hash.split('?')[1] || '').get('capture');
    const reference = requestedCapture || remembered();
    const canRestore = reference && /^[a-f\d-]{36}$/i.test(reference);
    busy = true;
    if (canRestore) {
        notice.textContent = 'Восстанавливаем сохранённый разбор…';
        workspace.innerHTML = '<div class="mc-panel" role="status">Загружаем источник и текущий статус с сервера…</div>';
        root.querySelector('[data-action="new"]').disabled = true;
    } else draw();
    try {
        if (canRestore) {
            try { apply(await app.api.get(`${BASE}/sessions/${reference}`)); state.expandedId = state.items[0]?.id || null; }
            catch (error) { if ([403, 404].includes(error.status)) remember(null); throw error; }
        }
        refreshHistory();
    }
    catch (error) {
        showError(error); root.querySelector('#mc-history-list').textContent = 'Не удалось загрузить историю. Проверьте доступность сервиса.';
        if ([401, 403].includes(error.status)) accessDenied = true;
    }
    finally {
        if (notice.textContent === 'Восстанавливаем сохранённый разбор…') notice.textContent = '';
        busy = false; draw(); syncPolling();
        if (state.id && (activeAnalysis(state) || ['empty', 'failed', 'configuration'].includes(state.analysis))) focusAnalysis();
        else if (state.id && state.status === 'saved') {
            const heading = root.querySelector('#mc-result-title');
            heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'nearest' });
        } else if (state.items.length) focusItem(state.expandedId);
    }
}
