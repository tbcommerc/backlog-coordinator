import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const taskTable = readFileSync(new URL('../js/components/taskTable.js', import.meta.url), 'utf8');

assert.match(taskTable, /import \{ escapeHtml \} from '\.\.\/htmlUtils\.js';/);
assert.match(taskTable, /escapeHtml\(task\.title\)/);
