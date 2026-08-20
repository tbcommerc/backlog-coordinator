import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const index = read('index.html');
const css = read('css/responsive.css');
const taskTable = read('js/components/taskTable.js');
const teamBacklog = read('js/components/teamBacklog.js');
const app = read('js/app.js');
const fixture = read('tests/fixtures/responsive-shell.html');
const filterToolbar = read('js/components/filterToolbar.js');
const quickFilters = read('js/components/quickFilters.js');

assert.match(index, /responsive\.css\?v=11/, 'responsive stylesheet must be loaded');
for (const breakpoint of ['1279px', '1024px', '640px', '420px']) {
  assert.ok(css.includes(breakpoint), `responsive layer must cover ${breakpoint}`);
}
assert.match(css, /overflow-x:\s*auto\s*!important/, 'wide tables must scroll horizontally');
assert.match(css, /@media \(pointer: coarse\)/, 'touch targets must be adapted for coarse pointers');
assert.match(css, /\.sidebar\.collapsed[\s\S]*?width:\s*min\(300px, 86vw\)/, 'mobile drawer must ignore desktop collapsed width');
assert.doesNotMatch(taskTable, /innerWidth\s*<=/, 'DMB view must not change automatically on resize');
assert.doesNotMatch(teamBacklog, /innerWidth\s*<=/, 'team view must not change automatically on resize');
assert.match(taskTable, /if \(currentView === 'cards'\)/, 'DMB must respect the selected view');
assert.match(teamBacklog, /if \(teamCurrentView === 'cards'\)/, 'team backlog must respect the selected view');
assert.match(app, /matchMedia\('\(max-width: 640px\)'\)/, 'drawer state must be reset after leaving mobile layout');
assert.doesNotMatch(fixture, /task-card-grid/, 'table fixture must not contain task cards');
assert.match(filterToolbar, /class="filter-toolbar-controls"/, 'filter and reset buttons must share a right-aligned group');
assert.match(filterToolbar, /new ResizeObserver\(\(\) => updateStickyOffsets\(\)\)/, 'content offset must follow toolbar height changes');
assert.match(filterToolbar, /toolbarIsFixed[\s\S]*?marginTop[\s\S]*?'0px'/, 'flow toolbar must not leave a synthetic table offset');
assert.match(filterToolbar, /class="toolbar-add-task-label"/, 'add-task text must be independently hideable');
assert.match(css, /\.toolbar-title,[\s\S]*?white-space:\s*nowrap/, 'toolbar title must stay on one line');
assert.match(css, /@media \(max-width: 1024px\)[\s\S]*?\.sticky-toolbar\s*\{[\s\S]*?position:\s*sticky/, 'compact toolbar must participate in scrolling');
assert.match(css, /top:\s*calc\(-1 \* var\(--space-5\)\)/, 'tablet sticky toolbar must cover the main-content top padding');
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.sticky-toolbar\s*\{[\s\S]*?top:\s*calc\(-1 \* var\(--space-3\)\)/, 'mobile sticky toolbar must cover the mobile top padding');
assert.match(filterToolbar, /position:\s*fixed;[\s\S]*?z-index:\s*24;/, 'cloned table header must stay below the toolbar layer');
assert.match(css, /\.toolbar-title-row\s*\{[\s\S]*?align-items:\s*center\s*!important/, 'toolbar actions must keep stable vertical alignment at the compact breakpoint');
assert.match(css, /\.toolbar-add-task-label\s*\{[\s\S]*?display:\s*none/, 'compact add-task button must hide its text');
assert.match(css, /\.filter-search-wrap[\s\S]*?grid-row:\s*1[\s\S]*?\.filter-toolbar-controls[\s\S]*?grid-row:\s*1/, 'search and filter controls must share the first row');
assert.match(filterToolbar, /clearQuickFilterVisualState\(\);[\s\S]*?renderAll\(\)/, 'reset must clear quick-filter highlighting before rerender');
assert.match(filterToolbar, /classList\.remove\('active'\)[\s\S]*?aria-pressed', 'false'/, 'visual reset must clear class and pressed state');
assert.match(quickFilters, /classList\.toggle\('active', active\)[\s\S]*?aria-pressed', String\(active\)/, 'quick-filter state must synchronize class and accessibility state');
assert.match(quickFilters, /quick-filters-mobile-toggle[\s\S]*?aria-expanded="false"/, 'mobile quick filters must use an accessible disclosure control');
assert.match(quickFilters, /activeCount \+= 1[\s\S]*?quick-filters-active-count/, 'mobile control must show the active filter count');
assert.match(quickFilters, /event\.key === 'Escape'/, 'mobile quick-filter panel must close with Escape');
assert.match(css, /#quick-filters\s*\{[\s\S]*?position:\s*static[\s\S]*?display:\s*none/, 'compact quick filters must expand in normal flow');
assert.match(css, /#quick-filters\.mobile-open\s*\{[\s\S]*?display:\s*grid/, 'compact quick filters must open as a grid');
assert.match(css, /@media \(max-width: 1024px\)\s*\{[\s\S]*?\.quick-filters-mobile-toggle/, 'compact quick filters must start at the tablet breakpoint');
assert.match(css, /#quick-filters\s*\{[\s\S]*?background:\s*transparent[\s\S]*?box-shadow:\s*none/, 'compact quick filters must not introduce a separate visual surface');

console.log('responsiveLayout.test.mjs: OK');
