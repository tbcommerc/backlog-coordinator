import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  directorateCustomerLine,
  directorateMeetingMeta,
  directorateTaskCountLabel,
  directorateVisibleTasks,
  renderDirectorateReport,
} from '../js/components/directorateReport.js';

const tasks = [
  { id: 1, project_name: 'Альфа', task_type_name: 'AD-HOC' },
  { id: 2, project_name: 'Альфа', task_type_name: 'Метрический KR' },
  { id: 3, project_name: 'Бета', task_type_name: 'AD-HOC' },
];

assert.deepEqual(directorateVisibleTasks(tasks).map(item => item.id), [1, 2, 3]);
assert.deepEqual(directorateVisibleTasks(tasks, { project: 'Альфа' }).map(item => item.id), [1, 2]);
assert.deepEqual(directorateVisibleTasks(tasks, { type: 'AD-HOC' }).map(item => item.id), [1, 3]);
assert.deepEqual(directorateVisibleTasks(tasks, { project: 'Альфа', type: 'Метрический KR' }).map(item => item.id), [2]);

assert.equal(directorateCustomerLine({ department_name: 'Риски', business_customer_name: 'Риски' }), 'Риски');
assert.equal(directorateCustomerLine({ department_name: 'Риски', business_customer_name: 'Иван Иванов' }), 'Риски, Иван Иванов');
assert.deepEqual(directorateMeetingMeta('2026-09-07', new Date(2026, 8, 7, 12)), { label: 'Встреча сегодня · 7 сентября', state: 'today' });
assert.deepEqual(directorateMeetingMeta('2026-09-07', new Date(2026, 8, 8, 12)), { label: 'Встреча не завершена · 7 сентября', state: 'overdue' });
assert.deepEqual(directorateMeetingMeta('2026-09-14', new Date(2026, 8, 8, 12)), { label: 'Встреча запланирована · 14 сентября', state: 'planned' });
assert.deepEqual(directorateMeetingMeta(null, new Date(2026, 8, 8, 12)), { label: 'Дата встречи не назначена', state: 'unscheduled' });
assert.equal(directorateTaskCountLabel(1), '1 задача');
assert.equal(directorateTaskCountLabel(2), '2 задачи');
assert.equal(directorateTaskCountLabel(5), '5 задач');

const app = { store: { get: () => ({ permissions: {}, role_name: 'Участник команды' }) } };
const html = renderDirectorateReport(app);
assert.match(html, /directorate-report-content/);
assert.match(html, /Excel/);
assert.match(html, /Обновить/);
assert.match(html, /Статусы к Директорской оперативке/);
assert.match(html, /В отчёт включено/);
assert.doesNotMatch(html, /Готовые статусы команд для еженедельного доклада/);
assert.match(html, /class="directorate-page-header"/);
assert.match(html, /class="directorate-header-actions"/);
assert.doesNotMatch(html, /class="directorate-hero"/);
assert.doesNotMatch(html, /data-directorate-attention/);

const css = readFileSync(new URL('../css/directorate-report.css', import.meta.url), 'utf8');
assert.match(css, /\.directorate-report\s*\{[^}]*width:\s*100%/s);
assert.match(css, /\.main-content:has\(> \.directorate-report\)[^}]*scrollbar-gutter:\s*stable/s);
assert.match(css, /\.directorate-status-text\s*\{[^}]*grid-area:\s*1\s*\/\s*1[^}]*visibility:\s*hidden/s);

const source = readFileSync(new URL('../js/components/directorateReport.js', import.meta.url), 'utf8');
assert.match(source, /class="directorate-status-stack"/);
assert.match(source, /querySelectorAll\('\.directorate-status-text\[role="tabpanel"\]'\)/);
assert.match(source, /Текущий статус\$\{currentDate/);
assert.doesNotMatch(source, /Текст совпадает с текущим статусом/);
assert.match(source, /team\.total \? 'Задачи не найдены' : 'Нет готовых статусов'/);
assert.match(source, /class="directorate-project-kicker">Проект</);
assert.match(source, /aria-label="Проект: \$\{escapeHtml\(project\)\}"/);
assert.match(source, /class="directorate-project-count">Задач: <strong>\$\{items\.length\}<\/strong>/);
assert.match(source, /class="directorate-task-layout"/);
assert.match(source, /class="directorate-task-info" aria-label="Информация о задаче"/);
assert.match(source, /class="directorate-task-status"/);
assert.match(source, /label: 'Ответственный', value: task.owner_name/);
assert.match(source, /descriptionList\(\{ className: 'directorate-task-meta'/);
assert.doesNotMatch(source, /data-lucide="user-round"/);
assert.doesNotMatch(source, /Выбранная команда/);
assert.match(source, /class="directorate-filter-summary"/);
assert.match(source, /class="directorate-control-panel"/);
assert.match(source, /class="directorate-team-dot"/);
assert.match(source, /Переключайтесь между статусами без перезагрузки страницы/);
assert.match(source, /'data-directorate-reset': '', disabled: !active/);
assert.match(css, /\.directorate-task-layout\s*\{[^}]*grid-template-columns:\s*minmax\(260px, \.52fr\) minmax\(0, 1fr\)/s);
assert.match(css, /\.directorate-task-status\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
assert.match(css, /\.directorate-status-stack\s*\{[^}]*flex:\s*1/s);
assert.doesNotMatch(css, /\.directorate-task-meta dd\s*\{[^}]*font-size:/s, 'readonly typography belongs to UI Kit');
assert.match(css, /\.directorate-page-header\s*\{[^}]*background:\s*var\(--bg-primary\)/s);
assert.match(css, /\.directorate-team-picker\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
assert.match(css, /\.directorate-team\s*\{[^}]*min-height:\s*39px/s);
assert.match(css, /\.directorate-control-panel\s*\{[^}]*border-radius:\s*18px/s);
assert.match(css, /\.directorate-filter-bar\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\)/s);
assert.match(css, /\.directorate-filters\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(180px, 230px\)\) auto/s);
assert.doesNotMatch(css, /linear-gradient\(135deg, #302b63/);

console.log('directorateReport tests passed');
