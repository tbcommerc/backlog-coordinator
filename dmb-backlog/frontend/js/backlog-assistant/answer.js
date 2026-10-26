import { escapeHtml as esc } from '../htmlUtils.js';
import { button } from '../ui/primitives.js';
import { assistantHeading } from './presentation.js';

export function safeNavigator(value) {
    return typeof value === 'string' && /^#\/(?:backlog\?task=\d+&tab=(?:main|log)|customer\/(?:task|request)\/\d+|review\/\d+)$/.test(value) ? value : null;
}
const labels = { public_id: 'Номер', title: 'Название', status: 'Статус', team: 'Команда', project: 'Проект', owner: 'Ответственный',
    period: 'Плановый период', priority: 'Приоритет', priority_score: 'Оценка приоритета', progress: 'Прогресс',
    cost_rub: 'Стоимость, ₽', effect_million_rub: 'Эффект, млн ₽', cost_value: 'Cost/Value', group: 'Группа',
    count: 'Количество', old: 'Было', new: 'Стало', at: 'Время', field: 'Поле', description: 'Описание', cost_rub_unknown: 'Без стоимости', effect_million_rub_unknown: 'Без эффекта', comment: 'Комментарий', revision: 'Редакция' };
const text = value => value == null ? 'Не указано' : typeof value === 'object' ? JSON.stringify(value) : String(value);

const observedAt = value => { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' (МСК)' : 'неизвестное время'; };

export function renderAnswer(answer) {
    if (!answer) return '<article class="ba-answer">' + assistantHeading() + '<p>Источники сейчас недоступны. Задайте новый вопрос.</p></article>';
    const blocks = (answer.verified_blocks || []).map(block => {
        const rows = block.items || [];
        const details = rows.map(row => {
            const fields = ['description', 'review_comment', 'priority_justification', 'effect_justification'];
            const names = { description: 'Описание', review_comment: 'Комментарий к решению', priority_justification: 'Обоснование приоритета', effect_justification: 'Обоснование эффекта' };
            const values = fields.filter(k => row[k]).map(k => `<dt>${names[k]}</dt><dd>${esc(text(row[k]))}</dd>`).join('');
            const events = (row.status_history || []).map(e => `<li>${esc(text(e.created_at || e.observed_at))}: ${esc(text(e.status))}${e.comment ? ` — ${esc(text(e.comment))}` : ''}</li>`).join('');
            return values || events ? `<section class="ba-card-details"><h3>${esc(row.title || row.object_ref || 'Карточка')}</h3><dl>${values}</dl>${events ? `<h4>История статусов</h4><ul>${events}</ul>` : ''}</section>` : '';
        }).join('');
        const history = (block.history || []).map(e => `<li>${esc(text(e.at))}: ${esc(text(e.field))} — ${esc(text(e.old))} → ${esc(text(e.new))}</li>`).join('');
        const comments = (block.comments || []).map(c => `<li>${esc(text(c.text))}</li>`).join('');
        const supplemental = `${details}${history ? `<h3>История изменений (${esc(block.history_total)})</h3><ul>${history}</ul>` : ''}${comments ? `<h3>Комментарии (${esc(block.comments_total)})</h3><ul>${comments}</ul>` : ''}`;
        const columns = (block.columns || [...new Set(rows.flatMap(row => Object.keys(row)))]).filter(key => !['navigator', 'object_ref', 'version', 'description', 'priority_justification', 'effect_justification', 'group_id', 'review_comment', 'status_history'].includes(key));
        const searchTerms = (block.search_terms || []).map(item => `${esc(item.term)}${(item.tokens || []).join(' ') !== item.term.toLocaleLowerCase('ru-RU') ? ` (формы слов: ${esc((item.tokens || []).join(', '))})` : ''}`).join('; ');
        return `${searchTerms ? `<p class="text-muted">Условия поиска: ${searchTerms}</p>` : ''}<div class="ba-table-scroll"><table class="ui-table ui-table-prose table"><caption>Доступные данные${block.total != null ? ` · всего ${esc(block.total)}` : ''}</caption>
            <thead><tr>${columns.map(c => `<th scope="col">${esc(labels[c] || c)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${c === 'title' && safeNavigator(row.navigator) ? `<a href="${esc(row.navigator)}">${esc(text(row[c]))}</a>` : esc(text(row[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
            ${supplemental}
            ${block.next_cursor != null && block.result_ref ? button({ label: 'Следующая страница', attrs: { 'data-ba-result': block.result_ref, 'data-ba-cursor': block.next_cursor } }) : ''}`;
    }).join('');
    return `<article class="ba-answer">
        ${assistantHeading()}
        ${answer.kind === 'unavailable' ? '<p>Данные недоступны или запрос не поддерживается в выбранной области. Уточните вопрос.</p>' : ''}
        ${answer.kind === 'no_results' ? '<p>В доступной области по этим условиям ничего не найдено.</p>' : ''}
        ${(answer.summary_claims || []).map(c => `<p>${c.type === 'inference' ? '<strong>Вывод: </strong>' : c.type === 'recommendation' ? '<strong>Рекомендация: </strong>' : ''}${esc(c.text)}</p>`).join('')}
        ${answer.clarification ? `<p>${esc(answer.clarification.question)}</p>${answer.clarification.options.map(o => button({ label: o, attrs: { 'data-followup': o } })).join('')}` : ''}
        ${blocks}
        <p class="ba-answer-meta">Данные на ${esc(observedAt(answer.as_of))} · область: ${esc(answer.context?.object_ref || 'доступный бэклог')}</p>
        <details><summary>Основания и полнота</summary><p>Показано: ${esc(answer.coverage?.displayed_count ?? 0)}. За пределами показа: ${esc(answer.coverage?.omitted_count ?? 0)}.</p>
            <ul>${(answer.sources || []).map(s => `<li>${esc(s.kind)} · ${esc(s.fields.join(', '))}</li>`).join('')}</ul></details>
        ${(answer.limitations || []).map(l => `<p class="text-muted">${esc(l)}</p>`).join('')}
        <div class="ba-actions">${button({ label: 'Скопировать', size: 'small', variant: 'ghost', attrs: { 'data-ba-copy': '' } })}
        ${button({ label: 'Полезно', size: 'small', variant: 'ghost', attrs: { 'data-ba-rating': '1' } })}${button({ label: 'Есть ошибка', size: 'small', variant: 'ghost', attrs: { 'data-ba-rating': '-1' } })}</div>
    </article>`;
}
