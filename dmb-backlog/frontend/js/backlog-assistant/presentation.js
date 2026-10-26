import { escapeHtml as esc } from '../htmlUtils.js';

// Local SVGs also render in the lazy-mounted dialog, without a Lucide rescan.
const paths = {
    sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M20 2v4m-2-2h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    arrow: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    chart: '<path d="M4 4v16h16M9 15v-4m5 4V7m5 8v-6"/>',
    tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6m-6 5h4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
};
export function assistantIcon(name) {
    return `<svg class="ba-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkles}</svg>`;
}

export function renderWelcome() {
    const prompts = [
        ['tasks', 'Найти задачи', 'Покажи 5 доступных задач'],
        ['chart', 'Оценить бэклог', 'Сгруппируй задачи по статусам'],
        ['search', 'Без ответственного', 'Найди задачи без ответственного'],
    ];
    return `<div class="ba-welcome" data-ba-welcome>
        <span class="ba-welcome-icon">${assistantIcon('sparkles')}</span>
        <p class="ba-eyebrow">ВАШ БЭКЛОГ В ДИАЛОГЕ</p>
        <h2>С чего начнём?</h2><p>Найдём нужные задачи, разберём изменения<br class="ba-desktop-break"> и посмотрим, что требует внимания.</p>
        <div class="ba-suggestions">${prompts.map(([icon, title, text]) => `<button type="button" class="ui-surface-action ba-suggestion" data-followup="${esc(text)}"><span class="ba-suggestion-heading">${assistantIcon(icon)}<strong>${esc(title)}</strong></span><span>${esc(text)}</span></button>`).join('')}</div><p class="ba-welcome-hint">Выберите пример или задайте свой вопрос ниже</p>
    </div>`;
}

export function assistantHeading() {
    return `<div class="ba-message-heading"><span class="ba-message-avatar">${assistantIcon('sparkles')}</span><span>Помощник</span><span class="ba-message-tag">По данным бэклога</span></div>`;
}
