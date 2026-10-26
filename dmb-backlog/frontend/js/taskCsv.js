import { calculateTaskCv } from './taskMetrics.js';
import { formatTaskPublicId } from './taskPublicId.js';

export function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Spreadsheet applications must treat user-entered formulas as text.
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRows(rows) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function decodeCsvContent(buffer, details = false) {
  const bytes = new Uint8Array(buffer);
  let text;
  let encoding = "UTF-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'UTF-16 LE'; text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes); }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'UTF-16 BE'; text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes); }
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { encoding = 'Windows-1251'; text = new TextDecoder('windows-1251', { fatal: true }).decode(bytes); }
  }
  if (text.includes('\0')) throw new Error('CSV содержит NUL; для UTF-16 необходим BOM');
  return details ? { text, encoding } : text;
}

export function parseCsvRows(content) {
  const text = String(content).replace(/^\uFEFF/, '').replace(/^(?:[ \t]*\r?\n)+/, '');
  const header = text.split(/\r?\n/, 1)[0];
  let headerQuoted = false, semicolons = 0, commas = 0;
  for (const char of header) {
    if (char === '"') headerQuoted = !headerQuoted;
    else if (!headerQuoted) { if (char === ';') semicolons++; if (char === ',') commas++; }
  }
  const delimiter = semicolons >= commas && semicolons > 0 ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else cell += ch;
  }
  if (quoted) throw new Error('Незакрытые кавычки в CSV');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return { rows, delimiter };
}

function displayValue(value) {
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (value && typeof value === 'object') return value.name ?? value.title ?? value.url ?? '';
  return value ?? '';
}

export function taskCsvValue(task, key) {
  if (key === 'id') return formatTaskPublicId(task);
  if (key === 'cv') {
    const value = calculateTaskCv(task);
    return value == null ? 'Нет данных' : value.toFixed(2);
  }
  if (key === 'did_demo') return task.did_demo == null ? '' : task.did_demo ? 'Да' : 'Нет';
  if (key === 'involved_teams') return displayValue(task.involved_team_names ?? task.involved_teams);
  return displayValue(task[`${key}_name`] ?? task[key]);
}

export function taskCsv(tasks, columns, labels) {
  return csvRows([columns.map(key => labels[key] || key), ...tasks.map(task => columns.map(key => taskCsvValue(task, key)))]);
}

export function downloadCsv(csv, filename) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
