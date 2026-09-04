/** Экранировать недоверенное значение для текстового/атрибутного HTML-контекста. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Экранировать текст и выделить все регистронезависимые совпадения поискового запроса. */
export function highlightSearchText(value, query) {
  const text = String(value ?? '');
  const needle = String(query ?? '').trim();
  if (!needle) return escapeHtml(text);

  const lowerText = text.toLocaleLowerCase('ru-RU');
  const lowerNeedle = needle.toLocaleLowerCase('ru-RU');
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerNeedle);
  if (matchIndex < 0) return escapeHtml(text);

  const parts = [];
  while (matchIndex >= 0) {
    parts.push(escapeHtml(text.slice(cursor, matchIndex)));
    parts.push(`<mark class="backlog-search-highlight">${escapeHtml(text.slice(matchIndex, matchIndex + needle.length))}</mark>`);
    cursor = matchIndex + needle.length;
    matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  }
  parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('');
}
