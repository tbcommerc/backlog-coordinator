import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { renderAnalytics } from '../js/components/analytics.js';

const analyticsSource = readFileSync(new URL('../js/components/analytics.js', import.meta.url), 'utf8');

test('LT analytics exposes the seven approved reports on one page', () => {
  const html = renderAnalytics('tribe', {});
  for (const title of [
    'Трудозатраты по типам задач', 'Профиль команд', 'Карта зависимостей',
    'Поток задач', 'Проекты по кварталам', 'Проект 360°',
    'Стоимость и финансовый эффект',
  ]) assert.match(html, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('effort and dependency reports keep the original dashboard design', () => {
  const html = renderAnalytics('tribe', {});
  for (const className of [
    'effort-report', 'kpi-grid', 'rep-card', 'donut', 'rep-table',
    'skp-chart--map', 'skp-kpis', 'skp-tables',
  ]) assert.match(html, new RegExp(`class="[^"]*\\b${className}\\b`));

  assert.match(analyticsSource, /layout:\s*'none'/);
  assert.match(analyticsSource, /roam:\s*false/);
  assert.match(analyticsSource, /edgeLabel:\s*\{/);
});

test('PO/PL analytics contains quality reports and no legacy workload reports', () => {
  const html = renderAnalytics('po-pl', {});
  assert.match(html, /Полнота карточек/);
  assert.match(html, /Конфликты качества/);
  assert.match(html, /Однородность ведения/);
  assert.doesNotMatch(html, /Нагрузка PO|Сроки исполнения|Полнота атрибутов/);
});

test('only reports from the original design render KPI tiles', () => {
  const html = `${renderAnalytics('tribe', {})}${renderAnalytics('po-pl', {})}`;
  assert.doesNotMatch(html, /\ban-kpi\b/);
  assert.match(html, /\bkpi-grid\b/);
  assert.match(html, /\bskp-kpis\b/);
  assert.doesNotMatch(analyticsSource, /\bkpis\s*\(/);
  assert.doesNotMatch(analyticsSource, /(?:profile|sankey|quarter|roi|complete|quality)-kpi/);
});

test('analytics requests use the backend task-router prefix', () => {
  assert.match(analyticsSource, /\/tasks\/analytics\/lt-reports/);
  assert.match(analyticsSource, /\/tasks\/analytics\/po-pl-reports/);
  assert.doesNotMatch(analyticsSource, /api\.get\('\/analytics\//);
});
