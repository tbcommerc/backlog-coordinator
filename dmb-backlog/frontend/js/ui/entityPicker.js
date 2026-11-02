import { escapeHtml as esc } from '../htmlUtils.js';
import { attributes, button, field } from './primitives.js';

// A searchable, single entity selection. Native select owns keyboard and form
// validity; the consumer supplies access-filtered results, never a global cache.
export function entityPicker({ id, name, label, searchLabel = 'Поиск', searchName, selected = null, required = false, disabled = false, hint = '', className = '', attrs = {} } = {}) {
  if (!id || !name || !label) throw new TypeError('EntityPicker requires id, name and label');
  const value = selected?.value == null ? '' : String(selected.value);
  return `<div class="ui-entity-picker ${esc(className)}"${attributes({ ...attrs, id: `${id}-picker`, 'data-ui-state': 'idle' })}>
    ${field({ id: `${id}-query`, label: searchLabel, type: 'search', disabled, attrs: { name: searchName, autocomplete: 'off', 'data-entity-query': true } })}
    ${field({ id, label, kind: 'select', value, required, disabled, options: [{ value: '', label: 'Выберите запись' }, ...(value ? [{ value, label: String(selected.label ?? value) }] : [])], attrs: { name, 'data-entity-value': true, 'aria-describedby': `${id}-status` } })}
    ${hint ? `<p class="ui-entity-hint">${esc(hint)}</p>` : ''}
    <p class="ui-entity-selected" data-entity-selected${value ? '' : ' hidden'}>${value ? esc(`Выбрано: ${selected.label ?? value}`) : ''}</p>
    <div class="ui-entity-actions">${button({ label: 'Очистить выбор', variant: 'ghost', attrs: { 'data-entity-clear': true, disabled: disabled || !value } })}${button({ label: 'Повторить поиск', attrs: { 'data-entity-retry': true, hidden: true, disabled } })}</div>
    <p class="ui-entity-status" id="${esc(id)}-status" data-entity-status role="status" aria-live="polite"></p>
  </div>`;
}

const owners = new WeakMap();
export function bindEntityPicker(root, { load, onChange, debounce = 180, errorMessage = () => 'Не удалось загрузить записи. Повторите поиск.' } = {}) {
  if (!root || typeof load !== 'function') throw new TypeError('EntityPicker requires a root and load function');
  owners.get(root)?.destroy();
  const query = root.querySelector('[data-entity-query]'), select = root.querySelector('[data-entity-value]');
  const status = root.querySelector('[data-entity-status]'), summary = root.querySelector('[data-entity-selected]');
  const clear = root.querySelector('[data-entity-clear]'), retry = root.querySelector('[data-entity-retry]');
  if (!query || !select || !status || !summary || !clear || !retry) throw new TypeError('Invalid EntityPicker markup');
  let timer, resetTimer, request, serial = 0, disposed = false;
  const current = () => select.value ? { value: select.value, label: select.selectedOptions[0]?.textContent || select.value } : null;
  let initialSelection = current();
  const syncSelection = () => {
    const item = current();
    summary.hidden = !item; summary.textContent = item ? `Выбрано: ${item.label}` : '';
    clear.disabled = select.disabled || !item;
  };
  const state = (kind, message = '') => {
    root.dataset.uiState = kind; root.setAttribute('aria-busy', String(kind === 'loading'));
    status.textContent = message; retry.hidden = kind !== 'error'; retry.disabled = query.disabled;
  };
  const invalidate = () => { clearTimeout(timer); serial++; request?.abort(); };
  const change = () => { syncSelection(); onChange?.(current()); };
  const resetSelection = () => {
    select.replaceChildren(new Option('Выберите запись', ''));
    syncSelection();
  };
  async function refresh({ reset = false } = {}) {
    invalidate();
    if (disposed || !root.isConnected) return;
    if (reset) { query.value = ''; initialSelection = null; resetSelection(); }
    if (query.disabled || select.disabled) { state('idle'); return; }
    const ticket = serial;
    request = new AbortController();
    state('loading', 'Поиск записей…');
    try {
      const result = await load(query.value.trim(), { signal: request.signal });
      if (disposed || !root.isConnected || ticket !== serial) return;
      if (!Array.isArray(result)) throw new TypeError('EntityPicker load must return an array');
      const seen = new Set(), items = [];
      for (const item of result) {
        if (item?.value == null || String(item.value) === '' || seen.has(String(item.value))) continue;
        const value = String(item.value); seen.add(value);
        items.push({ value, label: String(item.label ?? value), disabled: !!item.disabled });
      }
      const chosen = current(), updated = items.find(item => item.value === chosen?.value);
      const preserved = chosen && !updated ? [chosen] : [];
      const options = [new Option('Выберите запись', '')];
      for (const item of [...preserved, ...items]) {
        const option = new Option(item.label, item.value);
        option.disabled = !!item.disabled; options.push(option);
      }
      select.replaceChildren(...options);
      select.value = updated?.disabled ? '' : chosen?.value || '';
      syncSelection();
      const message = items.length ? `Найдено: ${items.length}.` : 'Ничего не найдено. Измените запрос.';
      state(items.length ? 'ready' : 'empty', message + (preserved.length ? ' Текущий выбор сохранён.' : '') + (updated?.disabled ? ' Прежняя запись больше недоступна для выбора.' : ''));
      if (chosen && updated?.disabled) select.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      if (disposed || !root.isConnected || ticket !== serial) return;
      state('error', String(errorMessage(error)));
    }
  }
  const search = event => {
    if (event.isComposing || query.disabled || disposed) return;
    // Invalidate immediately, not after debounce: an old answer must not flash
    // while a new query is already visible in the field.
    invalidate(); state('loading', 'Поиск записей…');
    timer = setTimeout(() => refresh(), Math.max(0, Number(debounce) || 0));
  };
  const clearSelection = () => {
    if (select.disabled || disposed) return;
    select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); select.focus();
  };
  const retrySearch = () => { if (!retry.disabled) { refresh(); query.focus(); } };
  const searchKey = event => {
    if (event.key !== 'Enter' || event.isComposing || query.disabled) return;
    event.preventDefault(); refresh();
  };
  const resetForm = event => {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      if (event.defaultPrevented || disposed) return;
      resetSelection();
      if (initialSelection) select.add(new Option(initialSelection.label, initialSelection.value, true, true));
      syncSelection(); refresh();
    }, 0);
  };
  query.addEventListener('input', search); query.addEventListener('compositionend', search);
  query.addEventListener('keydown', searchKey);
  select.addEventListener('change', change); clear.addEventListener('click', clearSelection); retry.addEventListener('click', retrySearch);
  const form = select.form; form?.addEventListener('reset', resetForm);
  const controller = { refresh, get value() { return current(); }, destroy() {
    if (disposed) return;
    disposed = true; invalidate(); clearTimeout(resetTimer);
    query.removeEventListener('input', search); query.removeEventListener('compositionend', search);
    query.removeEventListener('keydown', searchKey);
    select.removeEventListener('change', change); clear.removeEventListener('click', clearSelection); retry.removeEventListener('click', retrySearch);
    form?.removeEventListener('reset', resetForm);
    if (owners.get(root) === controller) owners.delete(root);
  } };
  owners.set(root, controller); syncSelection();
  return controller;
}
