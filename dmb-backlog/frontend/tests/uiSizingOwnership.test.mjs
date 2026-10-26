import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

test('page styles cannot redefine kit size variables or reintroduce migrated panel skins',()=>{
  const cssRoot=fileURLToPath(new URL('../css/',import.meta.url));
  for(const name of readdirSync(cssRoot).filter(name=>name.endsWith('.css')&&name!=='tokens.css')){
    const css=readFileSync(join(cssRoot,name),'utf8');
    assert.doesNotMatch(css,/--(?:ui-(?:size|target|font|icon)|control-(?:height[\w-]*|target-min))\s*:/,name);
    assert.doesNotMatch(css,/\.(?:search-dropdown|mention-dropdown)\s*\{/,name);
  }
  const directorate=readFileSync(join(cssRoot,'directorate-report.css'),'utf8');
  assert.doesNotMatch(directorate,/#[0-9a-f]{3,8}\b|rgba?\(/i,'Report theme must use shared semantic tokens');
});

function* activeModules(root = fileURLToPath(new URL('../js/', import.meta.url))) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Historical V2 prototype and kit internals are not consumer templates.
      if (!['lib', 'assistant-v2', 'ui'].includes(entry.name)) yield* activeModules(join(root, entry.name));
    } else if (entry.name.endsWith('.js')) yield join(root, entry.name);
  }
}

test('every native control in active modules declares a shared UI recipe', () => {
  const recipes = new Set(['btn', 'iconbtn', 'ui-link', 'ui-surface-action', 'ui-plot-target', 'ui-backdrop-action', 'ui-tab', 'quick-filter-btn', 'input', 'ui-control', 'ui-switch-input', 'toast-action']);
  const violations = [];
  for (const name of activeModules()) {
    const source = readFileSync(name, 'utf8');
    for (const match of source.matchAll(/<(button|input|select|textarea)\b[^>]*>/g)) {
      const tag = match[0];
      if (match[1] === 'input' && /type=["'](?:checkbox|radio|file|hidden|range)["']/.test(tag)) continue;
      const classes = tag.match(/class=["']([^"']*)/)?.[1].split(/\s+/) || [];
      if (!classes.some(value => recipes.has(value))) violations.push(`${name}:${source.slice(0, match.index).split('\n').length}`);
    }
    for (const match of source.matchAll(/(\w+) = document\.createElement\('(button|input|textarea|select)'\)/g)) {
      const construction = source.slice(match.index, match.index + 900);
      // Clipboard fallbacks are invisible temporary textareas, not UI fields.
      if (match[2] === 'textarea' && /(?:position = 'fixed'|position:fixed)/.test(construction) && /(?:opacity = '0'|opacity:0)/.test(construction)) continue;
      const classes = construction.match(new RegExp(`${match[1]}\\.className\\s*=\\s*['"]([^'"]+)`))?.[1].split(/\s+/) || [];
      if (!classes.some(value => recipes.has(value))) violations.push(`${name}:${source.slice(0, match.index).split('\n').length} (DOM construction)`);
    }
  }
  assert.deepEqual(violations, [], 'Choose an action, link, surface, plot or field recipe from the UI kit');
});

// Inline dimensions beat every shared stylesheet. Fail at source, before a
// new page silently reintroduces a separate scale for the same component.
test('page CSS cannot set vertical dimensions on shared buttons and fields', () => {
  const directory = fileURLToPath(new URL('../css/', import.meta.url));
  const violations = [];
  for (const name of readdirSync(directory).filter(name => name.endsWith('.css') && !['tokens.css', 'components.css', 'base.css'].includes(name))) {
    const source = readFileSync(join(directory, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Final compound selector targets the control itself, not its label/icon.
      if (!selector.split(',').some(part => !part.includes('textarea') && /\.(?:btn|input|ui-control)(?:[.#][\w-]+|\[[^\]]+\]|:[\w-]+)*\s*$/.test(part))) continue;
      if (/(?:^|;)\s*(?:height|min-height|max-height)\s*:/.test(body)
        || /(?:^|;)\s*padding(?:-[\w-]+)?\s*:[^;]*!important/.test(body)) violations.push(`${name}: ${selector.trim()}`);
    }
  }
  assert.deepEqual(violations, [], 'Move control dimensions into sizing.css');
});

test('shared buttons and single-line fields do not override their geometry inline', () => {
  const violations = [];
  for (const name of activeModules()) {
    const source = readFileSync(name, 'utf8');
    for (const match of source.matchAll(/<(?:button|a|input|select)\b[^>]*>/g)) {
      const tag=match[0], classes=tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) || [];
      if (!classes.some(name => ['btn', 'input', 'ui-control'].includes(name))) continue;
      const style=tag.match(/style="([^"]*)"/)?.[1] || '';
      if (/(?:^|;)\s*(?:height|min-height|max-height|padding(?:-[a-z-]+)?|font(?:-size)?|line-height)\s*:/.test(style)) {
        violations.push(`${name}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(violations, [], 'Choose a shared size instead of overriding button geometry');
});
