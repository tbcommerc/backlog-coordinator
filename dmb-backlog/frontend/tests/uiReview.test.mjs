import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { pagination, radioGroup, alert } from '../js/ui/forms.js';
import { chartTheme, chartJsTheme, applyChartTheme, applyChartJsTheme } from '../js/ui/charts.js';

test('pagination clamps invalid pages and disables unavailable transitions', () => {
  const empty = pagination({ page: -3, pages: 0 });
  assert.equal((empty.match(/ disabled/g) || []).length, 2);
  assert.match(empty, /<strong>1<\/strong> из 1/);
  assert.match(pagination({ page: 99, pages: 3 }), /<strong>3<\/strong>/);
  assert.equal((pagination({ page: 2, pages: 4, disabled: true }).match(/ disabled/g) || []).length, 6);
  assert.doesNotMatch(pagination({ page: NaN, pages: Infinity }), /NaN|Infinity/);
});
test('radio group has native form semantics and escapes untrusted content', () => {
  assert.throws(() => radioGroup(), TypeError);
  const html = radioGroup({ id: 'choice', label: '<choice>', value: 'b', required: true, options: [{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: '<B>' }] });
  assert.match(html, /<legend>&lt;choice&gt;<\/legend>/);
  assert.equal((html.match(/ checked/g) || []).length, 1);
  assert.equal((html.match(/name="choice"/g) || []).length, 2);
  assert.match(html, /value="b" checked required/);
  assert.match(alert({ message: '<script>', tone: 'danger', live: true }), /role="alert"/);
  assert.doesNotMatch(alert({ message: '<script>', tone: 'bad"' }), /<script>|bad/);
  assert.doesNotMatch(alert({ message: 'Static' }), /role=/);
});
test('chart themes update presentation without replacing data and formatters', () => {
  assert.equal(chartTheme().color.length, 10);
  assert.ok(chartJsTheme().fontFamily);
  const formatter = value => value;
  const data = [1, 2];
  let received;
  applyChartTheme({ isDisposed: () => false, getOption: () => ({ series: [{ type: 'line', data, label: { formatter } }] }), setOption: option => { received = option; } });
  assert.equal(received.series[0].data, data);
  assert.equal(received.series[0].label.formatter, formatter);
  applyChartTheme({ isDisposed: () => true, getOption: () => { throw new Error('disposed'); } });
  const chart = { options: { scales: { x: { ticks: { callback: formatter }, grid: {} } } }, update: mode => { received = mode; } };
  applyChartJsTheme(chart);
  assert.equal(chart.options.scales.x.ticks.callback, formatter);
  assert.equal(received, 'none');
  assert.ok(chart.options.plugins.tooltip.bodyFont.family);
});
test('active consumers import UI modules using one canonical URL', () => {
  const root = new URL('../', import.meta.url);
  const versions = new Map();
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { if (!['lib'].includes(entry.name)) scan(url); continue; }
      if (!entry.name.endsWith('.js')) continue;
      for (const [, path] of readFileSync(url, 'utf8').matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
        if (!path.startsWith('.')) continue;
        const target = new URL(path, url);
        if (!/\/js\/ui\/|\/(?:uiFeedback|viewState|modalAccessibility)\.js/.test(target.pathname)) continue;
        const variants = versions.get(target.pathname) || new Set();
        variants.add(target.search); versions.set(target.pathname, variants);
      }
    }
  }
  scan(new URL('js/', root)); scan(new URL('ui-catalog/', root));
  for (const [name, variants] of versions) assert.deepEqual([...variants], [''], name);
  const kitVersions = ['index.html', 'ui-catalog/index.html'].map(name => readFileSync(new URL(name, root), 'utf8').match(/kit\.css\?v=(\d+)/)?.[1]);
  assert.ok(kitVersions[0]); assert.equal(kitVersions[0], kitVersions[1]);
});
