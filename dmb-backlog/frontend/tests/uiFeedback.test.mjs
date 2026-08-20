import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const htmlSource = readFileSync(new URL('../js/htmlUtils.js', import.meta.url), 'utf8');
const htmlUrl = `data:text/javascript;base64,${Buffer.from(htmlSource).toString('base64')}`;
const feedbackSource = readFileSync(new URL('../js/uiFeedback.js', import.meta.url), 'utf8')
  .replace("'./htmlUtils.js'", JSON.stringify(htmlUrl));
const feedbackUrl = `data:text/javascript;base64,${Buffer.from(feedbackSource).toString('base64')}`;
const { formatErrorMessage } = await import(feedbackUrl);

assert.equal(
  formatErrorMessage(new Error('Failed to fetch')),
  'Сервер недоступен. Проверьте подключение и попробуйте ещё раз.',
);
assert.equal(formatErrorMessage(new Error('Доступ запрещён')), 'Доступ запрещён');
assert.equal(formatErrorMessage(null), 'Не удалось выполнить операцию. Попробуйте ещё раз.');
