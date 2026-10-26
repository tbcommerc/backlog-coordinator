import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const matrix = JSON.parse(read('frontend/ui-catalog/migration-matrix.json'));

test('every static SPA route and component module has an explicit migration disposition', () => {
  const routes = read('frontend/js/router.js').split('this.routes = {')[1].split('};')[0];
  for (const [, path] of routes.matchAll(/'([^']+)':\s*\{/g)) {
    assert.ok(matrix.surfaces.some(row => row.entry === path), `Missing active route: ${path}`);
  }
  const modules = readdirSync(new URL('frontend/js/components/', root)).filter(name => name.endsWith('.js')).map(name => `frontend/js/components/${name}`).sort();
  assert.deepEqual(matrix.componentModules, modules);
  assert.deepEqual(Object.keys(matrix.moduleDisposition).sort(), modules);
  for (const source of modules) {
    if (/createElement\(['"]dialog['"]\)/.test(read(source))) {
      assert.ok(matrix.surfaces.some(row => row.source === source), `Native dialog hidden as helper: ${source}`);
    }
  }
  assert.equal(new Set(matrix.surfaces.map(row => row.id)).size, matrix.surfaces.length);
  for (const row of matrix.surfaces) {
    assert.ok(existsSync(new URL(row.source, root)), row.source);
    assert.ok(row.states.length && row.components.length && row.local, row.id);
    assert.equal(row.status, 'browser-verified', `Unverified surface: ${row.id}`);
    assert.ok(row.tests.some(name => !['modalCatalogComplete.spec.mjs', 'uiKit.spec.mjs', 'modalSystem.spec.mjs'].includes(name)), `A catalog alone cannot accept ${row.id}`);
    assert.ok(row.verifiedScope && row.contractEvidence.length, `Missing evidence scope: ${row.id}`);
    for (const name of row.tests) assert.ok(existsSync(new URL(`frontend/e2e/${name}`, root)), name);
  }
});

test('shared compound surfaces have token-owned appearance and no local geometry escape hatch', () => {
  const css = read('frontend/css/ui/popover.css');
  assert.doesNotMatch(css, /!important|#[0-9a-f]{3,8}\b|rgba?\(/i);
  const toolbar = read('frontend/js/components/filterToolbar.js');
  const reports = read('frontend/js/components/reports.js');
  const reportFilter = reports.slice(reports.indexOf('function renderFilterDropdown'), reports.indexOf('function applyFilterFromDropdown'));
  assert.doesNotMatch(reportFilter, /style\.cssText|#[0-9a-f]{3,8}\b|style="/i);
  assert.doesNotMatch(toolbar, /column-settings-dropdown[^\n]*style=|saved-view-editor[^\n]*style=/);
  assert.doesNotMatch(read('frontend/css/agent-v2.css'), /\.agent-v2-edit-toggle[^}]*\b(?:padding|height|font-size)\s*:/);
  // Geometry exceptions are calculated viewport coordinates, not hard-coded skins.
  assert.match(css, /background:\s*var\(--bg-primary\)/);
  assert.match(css, /box-shadow:\s*var\(--shadow-lg\)/);
});

test('button-specific important dimensions cannot override the shared size contract', () => {
  const directory = new URL('frontend/css/', root);
  const violations = [];
  for (const name of readdirSync(directory).filter(name => name.endsWith('.css'))) {
    const css = read(`frontend/css/${name}`).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(?:\bbutton\b|\.btn(?:[\s.:#>-]|$)|\.(?:[\w-]+-btn|[\w-]+-toggle|[\w-]+-trigger|report-filter-remove)\b)/.test(selector)) continue;
      if (/(?:^|;)\s*(?:height|min-height|max-height|padding(?:-top|-bottom|-block)?|font-size|line-height)\s*:[^;]*!important/.test(declarations)) violations.push(`${name}: ${selector.trim()}`);
    }
  }
  assert.deepEqual(violations, [], 'Add variants in sizing.css; remove local important geometry');
});


test('compound CSS references declared tokens or documented dynamic layout variables', () => {
  const css=read('frontend/css/ui/popover.css');
  const definitions=read('frontend/css/tokens.css')+read('frontend/css/ui/sizing.css')+css;
  const declared=new Set([...definitions.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match=>match[1]));
  declared.add('--ui-column-rows');
  for(const [,token] of css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(declared.has(token),`Undefined token: ${token}`);
});


test('generated migration document is in sync with the checked inventory', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('frontend/ui-catalog/render-migration-matrix.mjs', root)), '--check']);
});
