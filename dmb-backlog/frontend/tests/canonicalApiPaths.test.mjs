import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../js', import.meta.url));
const files = [];
function collect(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) collect(path);
    else if (name.endsWith('.js')) files.push(path);
  }
}
collect(root);

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const collection of ['tasks', 'reports', 'users', 'teams']) {
    const nonCanonicalCollection = new RegExp(`\\.(?:get|post|put|patch|delete|upload)\\(\\s*['\"\\x60]/${collection}(?:['\"\\x60?])`);
    assert.doesNotMatch(source, nonCanonicalCollection, `${file} uses a non-canonical ${collection} collection URL`);
  }
}

assert.ok(files.some(file => readFileSync(file, 'utf8').includes('/tasks/?')), 'canonical tasks collection URL is used');
