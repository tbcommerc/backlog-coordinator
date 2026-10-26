import { field, button } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { assistantApi } from './api.js';
import { renderAnswer } from './answer.js';
import { stateFor, terminal, contextFromLocation } from './state.js';
import { assistantIcon, renderWelcome } from './presentation.js';

let surfaceNumber = 0;
export function renderPage() {
    const inputId = `ba-question-${++surfaceNumber}`;
    return `<section class="ba-page" data-ba-root>
        <header class="ba-header"><span class="ba-brand">${assistantIcon('sparkles')}</span><div class="ba-heading"><p class="ba-eyebrow">ИИ-ПОМОЩНИК</p><h1>Помощник по бэклогу</h1><p class="ba-subtitle">Ответы по вашим задачам с проверяемыми источниками</p></div>
        <div class="ba-header-actions">${button({ label: 'Новый разговор', iconMarkup: assistantIcon('plus'), attrs: { 'data-ba-new': '' } })}</div></header>
        <div class="ba-workspace"><aside class="ba-history"><details open><summary>Мои разговоры</summary><div data-ba-history></div></details></aside>
        <div class="ba-chat"><div data-ba-error role="alert" hidden></div>
        <div class="ba-timeline" data-ba-results role="log" aria-label="Сообщения диалога">${renderWelcome()}</div>
        <div class="ba-activity" data-ba-activity hidden aria-hidden="true"><span class="ba-thinking"><i></i><i></i><i></i></span><span>Помощник готовит ответ</span></div>
        <footer class="ba-composer"><div class="ba-composer-meta"><p data-ba-status role="status" aria-live="polite">Подключаем помощника…</p>
        <details class="ba-context"><summary>${assistantIcon('search')}<span>Область поиска</span><span class="ba-context-chevron" aria-hidden="true">⌄</span></summary><div class="ba-context-fields">${field({ id: `${inputId}-objects`, label: 'Искать в', kind: 'select', options: [{ value: 'task', label: 'Задачах' }, { value: 'request', label: 'Запросах' }], attrs: { 'data-ba-objects': '' } })}
        ${field({ id: `${inputId}-scope`, label: 'Область', kind: 'select', options: [{ value: 'all', label: 'Всё доступное' }, { value: 'mine', label: 'Мои' }, { value: 'my_team', label: 'Моя команда' }], attrs: { 'data-ba-scope': '' } })}</div></details></div>
        <form class="ba-input-box" data-ba-form><label class="ba-input-label" for="${inputId}">Сообщение помощнику</label><textarea id="${inputId}" class="input ui-control" data-ba-question rows="2" maxlength="8000" placeholder="Спросите о задачах и запросах…" required disabled></textarea>
        <div class="ba-composer-bottom"><span><kbd>Enter</kbd> отправить <span class="ba-shortcut-separator">·</span> <kbd>Shift + Enter</kbd> новая строка</span><div class="ba-actions">${button({ label: 'Отправить', iconMarkup: assistantIcon('arrow'), variant: 'primary', attrs: { type: 'submit', 'data-ba-send': '', disabled: true } })}${button({ label: 'Остановить', iconMarkup: assistantIcon('stop'), attrs: { 'data-ba-stop': '', hidden: true } })}</div></div></form><p class="ba-readonly">${assistantIcon('lock')}<span>Только чтение данных · рабочие записи не изменяются</span></p></footer></div></div></section>`;
}

export function initPage(app = window.app) {
    return mount(document.querySelector('[data-ba-root]'), app);
}

export async function mount(root, app, context = contextFromLocation()) {
    const api = assistantApi(app.api);
    const userId = app.store.get('currentUser')?.id;
    const state = stateFor(userId);
    const storageKey = `backlog-chat:${userId}:${context.object_ref || 'backlog'}`;
    const remember = id => { try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch {} };
    if (state.context && state.context.object_ref !== context.object_ref && !state.run) { state.session = null; state.context = null; }

    const $ = selector => root.querySelector(selector);
    const input = $('[data-ba-question]'), status = $('[data-ba-status]'), error = $('[data-ba-error]');
    let alive = true, timer, pollFailures = 0, enabled = false, sending = false, cancelRequested = false;
    const cleanup = () => { alive = false; clearTimeout(timer); };
    root.baCleanup = cleanup;
    const showError = message => { error.textContent = message; error.hidden = false; };
    const busy = value => {
        root.dataset.busy = String(value);
        $('[data-ba-send]').disabled = !enabled || value || !input.value.trim();
        $('[data-ba-send]').hidden = value;
        $('[data-ba-stop]').hidden = !value;
        if (!value) $('[data-ba-stop]').disabled = false;
        $('[data-ba-activity]').hidden = !value;
        $('[data-ba-new]').disabled = value;
        $('[data-ba-objects]').disabled = value || Boolean(context.object_ref);
        $('[data-ba-scope]').disabled = value;
        input.disabled = !enabled || sending;
    };
    const scroll = () => { const log = $('[data-ba-results]'); log.scrollTop = log.scrollHeight; };
    const questionHtml = text => `<div class="ba-user-message"><span>Вы</span><p>${esc(text)}</p></div>`;
    const clearWelcome = () => $('[data-ba-welcome]')?.remove();
    const runNotice = runStatus => {
        const message = ({ cancelled: 'Ответ остановлен. Вы можете уточнить вопрос или задать новый.',
            failed: 'Не удалось подготовить ответ. Попробуйте задать вопрос ещё раз.',
            interrupted: 'Подготовка ответа была прервана. Задайте вопрос ещё раз.',
            expired: 'Время ожидания истекло. Попробуйте уточнить вопрос.' })[runStatus]
            || 'Этот вопрос завершился без ответа. Можно отправить новый.';
        return '<div class="ba-run-notice">' + assistantIcon('sparkles') + '<span>' + message + '</span></div>';
    };
    const renderRuns = result => { $('[data-ba-results]').innerHTML = result.runs.map(r =>
        `${r.text ? questionHtml(r.text) : ''}${r.answer || r.error_code === 'sources_unavailable' ? `<div data-message="${esc(r.message_id)}">${renderAnswer(r.answer)}</div>` : terminal(r.status) ? runNotice(r.status) : ''}`).join('') || renderWelcome(); scroll(); };
    input.value = state.draft;
    $('[data-ba-objects]').value = context.filters.object_type;
    $('[data-ba-scope]').value = context.filters.relationship || 'all';
    $('[data-ba-objects]').disabled = Boolean(context.object_ref);
    root.querySelectorAll('[data-ba-objects], [data-ba-scope]').forEach(control => control.addEventListener('change', () => {
        if (state.run) { control.value = control.hasAttribute('data-ba-objects') ? context.filters.object_type : context.filters.relationship || 'all'; return; }
        context = { ...context, filters: { ...context.filters, object_type: $('[data-ba-objects]').value, relationship: $('[data-ba-scope]').value } };
        state.pending = null;
    }));
    input.addEventListener('input', () => { state.draft = input.value; busy(sending || Boolean(state.run)); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (enabled && !sending && !state.run) $('[data-ba-form]').requestSubmit(); } });

    async function history() {
        const result = await api.sessions();
        if (alive && root.isConnected) $('[data-ba-history]').innerHTML = result.items.map(s =>
            button({ label: s.title, variant: 'ghost', className: 'ba-history-item', attrs: { 'data-ba-session': s.id, 'aria-current': String(s.id === state.session?.id) } })
                .replace('</button>', '<time class="ba-history-date">' + esc(new Date(s.updated_at * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</time></button>')).join('') || '<p class="ba-history-empty">Здесь появятся ваши разговоры.<br>Начните с первого вопроса.</p>';
    }
    async function poll() {
        if (!alive || !root.isConnected || !state.run) return;
        try {
            const result = await api.run(state.run);
            pollFailures = 0;
            if (!alive || !root.isConnected) return;
            error.hidden = true;
            status.textContent = ({ queued: 'Ожидаем запуска', running: 'Читаем данные и готовим ответ', cancelling: 'Останавливаем',
                completed: 'Готово', partial: 'Частичный ответ', cancelled: 'Отменено', failed: 'Не удалось подготовить ответ',
                interrupted: 'Запуск прерван', expired: 'Время ожидания истекло' })[result.status] || 'Проверяем состояние';
            if (terminal(result.status)) {
                state.run = null; busy(false); error.hidden = true;
                if ((result.answer || result.error_code === 'sources_unavailable') && !root.querySelector(`[data-message="${result.message_id}"]`)) {
                    const node = document.createElement('div');
                    node.dataset.message = result.message_id;
                    node.innerHTML = renderAnswer(result.answer);
                    $('[data-ba-results]').append(node); scroll();
                } else if (!result.answer) {
                    $('[data-ba-results]').insertAdjacentHTML('beforeend', runNotice(result.status)); scroll();
                }
                history().catch(() => {});
                return;
            }
        } catch {
            pollFailures += 1;
            showError('Не удалось проверить состояние. Повторим проверку; вопрос повторно не отправляется.');
        }
        if (alive) timer = setTimeout(poll, Math.min(1000 * 2 ** pollFailures, 15000));
    }
    $('[data-ba-form]').addEventListener('submit', async event => {
        event.preventDefault();
        const text = input.value.trim();
        if (!enabled || !text || sending || state.run) return;
        error.hidden = true; sending = true; cancelRequested = false; busy(true); status.textContent = 'Отправляем вопрос…';
        // Preserve the exact key/body after an ambiguous network outcome.
        if (!state.pending || state.pending.text !== text) state.pending = { text, key: crypto.randomUUID(), createKey: crypto.randomUUID() };
        try {
            if (!state.session || JSON.stringify(state.context) !== JSON.stringify(context)) {
                state.session = await api.create(context, state.pending.createKey);
                state.context = context; remember(state.session.id);
            }
            const result = await api.message(state.session.id, { text, context, context_revision: state.session.context_revision }, state.pending.key);
            state.run = result.run_id; state.pending = null; state.draft = ''; input.value = '';
            clearWelcome(); $('[data-ba-results]').insertAdjacentHTML('beforeend', questionHtml(text)); scroll();
            if (cancelRequested) await api.cancel(state.run);
            poll();
        } catch (e) {
            busy(false); status.textContent = 'Вопрос не отправлен';
            showError(e.status === 409 ? 'Контекст или состояние разговора изменились. Откройте новый разговор; текст сохранён.' : 'Не удалось отправить вопрос. Текст сохранён; повтор использует тот же ключ.');
        } finally { sending = false; busy(Boolean(state.run)); }
    });
    root.addEventListener('click', async event => {
        try {
            if (event.target.closest('[data-ba-new]')) {
                if (sending || state.run) { showError('Дождитесь завершения или остановите текущий вопрос.'); return; }
                state.session = null; state.pending = null; state.context = null; remember(null); error.hidden = true; status.textContent = 'Новый разговор';
                $('[data-ba-results]').innerHTML = renderWelcome();
                root.querySelectorAll('[data-ba-session]').forEach(item => item.setAttribute('aria-current', 'false')); input.focus();
            }
            if (event.target.closest('[data-ba-stop]')) {
                cancelRequested = true; status.textContent = 'Останавливаем'; $('[data-ba-stop]').disabled = true;
                if (state.run) await api.cancel(state.run);
            }
            const historical = event.target.closest('[data-ba-session]');
            if (historical) {
                if (sending || state.run) { showError('Дождитесь завершения текущего вопроса или остановите его.'); return; }
                const result = await api.session(historical.dataset.baSession);
                const savedContext = [...result.runs].reverse().find(r => r.answer)?.answer.context;
                if (savedContext) { state.session = result; state.context = savedContext; context = savedContext;
                    $('[data-ba-objects]').value = context.filters.object_type; $('[data-ba-objects]').disabled = Boolean(context.object_ref);
                    $('[data-ba-scope]').value = context.filters.relationship || 'all'; }
                state.session = result; remember(result.id); renderRuns(result);
                root.querySelectorAll('[data-ba-session]').forEach(item => item.setAttribute('aria-current', String(item.dataset.baSession === result.id)));
                error.hidden = true; status.textContent = 'Разговор загружен';
                const active = result.runs.find(r => !terminal(r.status));
                if (active) { state.run = active.id; busy(true); poll(); }
            }
            const more = event.target.closest('[data-ba-result]');
            if (more) {
                more.disabled = true;
                try {
                    const result = await api.result(more.dataset.baResult, Number(more.dataset.baCursor || 0));
                    const node = document.createElement('div');
                    node.innerHTML = renderAnswer({ kind: 'answer', verified_blocks: [result.data], context,
                        as_of: result.observed_at, limitations: result.limitations, coverage: {}, sources: [] });
                    more.replaceWith(node);
                } finally { more.disabled = false; }
            }
            const copy = event.target.closest('[data-ba-copy]');
            if (copy) { await navigator.clipboard.writeText(copy.closest('.ba-answer').innerText); status.textContent = 'Скопировано'; }
            const rating = event.target.closest('[data-ba-rating]');
            if (rating) { await api.feedback(rating.closest('[data-message]').dataset.message, Number(rating.dataset.baRating)); status.textContent = 'Спасибо, оценка сохранена'; }
            const followup = event.target.closest('[data-followup]');
            if (followup) { input.value = followup.dataset.followup; state.draft = input.value; busy(sending || Boolean(state.run)); input.focus(); }
        } catch { if (event.target.closest('[data-ba-stop]')) $('[data-ba-stop]').disabled = false; showError('Действие сейчас недоступно. Повторите позже.'); }
    });
    try {
        const capabilities = await api.capabilities();
        if (!capabilities.enabled) { status.textContent = 'Помощник пока не включён для вашего профиля.'; return cleanup; }
        enabled = true;
        status.textContent = context.object_ref ? `Контекст: ${context.object_ref}` : 'Контекст: доступный бэклог';
        busy(Boolean(state.run)); await history();
        let savedId = state.session?.id;
        try { savedId ||= localStorage.getItem(storageKey); } catch {}
        if (savedId) {
            try {
                const result = await api.session(savedId);
                const savedContext = [...result.runs].reverse().find(r => r.answer)?.answer.context;
                state.session = result;
                if (savedContext) { state.context = savedContext; context = savedContext;
                    $('[data-ba-objects]').value = context.filters.object_type;
                    $('[data-ba-scope]').value = context.filters.relationship || 'all';
                }
                root.querySelectorAll('[data-ba-session]').forEach(item => item.setAttribute('aria-current', String(item.dataset.baSession === result.id)));
                renderRuns(result);
                const active = result.runs.find(r => !terminal(r.status));
                if (active) state.run = active.id;
            } catch { remember(null); state.session = null; }
        }
        busy(Boolean(state.run)); if (state.run) poll();
    } catch { status.textContent = 'Сервис помощника временно недоступен.'; }
    return cleanup;
}
