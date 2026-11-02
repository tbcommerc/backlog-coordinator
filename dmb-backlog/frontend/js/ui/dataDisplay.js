import { escapeHtml as esc } from '../htmlUtils.js';

const TONES = new Set(['neutral', 'accent', 'info', 'success', 'warning', 'danger']);
const PALETTE = ['indigo', 'violet', 'rose', 'amber', 'emerald', 'sky'];

export function avatar({ name = '', size = 32, className = '', id = '' } = {}) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(word => [...word][0]).join('').toUpperCase() || '?';
  let hash = 0;
  for (const character of String(name)) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
  const token = [20, 24, 28, 32, 40, 48].includes(size) ? size : 32;
  return `<span${id ? ` id="${esc(id)}"` : ''} class="ui-avatar ${esc(className)}" data-ui-size="${token}" data-ui-color="${PALETTE[Math.abs(hash) % PALETTE.length]}" aria-hidden="true">${esc(initials)}</span>`;
}

export function tag({ label, color = '', className = '' } = {}) {
  // Dictionary colours are data, not arbitrary style declarations.
  const safeColor = /^#[a-f\d]{6}$/i.test(color) ? color : '';
  return `<span class="ui-tag ${esc(className)}"${safeColor ? ` style="--ui-tag-color:${safeColor}"` : ''}>${esc(label)}</span>`;
}

export function progress({ value = null, label = 'Прогресс', tone = 'accent', className = '', showValue = false, state } = {}) {
  const known = value !== null && value !== '' && Number.isFinite(Number(value));
  const amount = known ? Math.min(100, Math.max(0, Number(value))) : 0;
  const mode = ['indeterminate','error'].includes(state) ? state : !known ? 'unknown' : amount === 100 ? 'complete' : 'determinate';
  const text = mode === 'indeterminate' ? 'Выполняется' : mode === 'error' ? 'Ошибка' : known ? `${amount}%` : 'Нет данных';
  return `<span class="ui-progress ${esc(className)}" data-ui-state="${mode}" data-ui-tone="${TONES.has(tone) ? tone : 'accent'}"><span class="ui-progress-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100"${known && mode !== 'indeterminate' ? ` aria-valuenow="${amount}"` : ''} aria-valuetext="${text}"><span class="ui-progress-fill" style="width:${amount}%"></span></span>${showValue || !known || mode === 'error' ? `<span class="ui-progress-value">${text}</span>` : ''}</span>`;
}

// A count is data, never an informational status badge. Null is not zero.
export function counter({ value = null, cap = null, loading = false, tone = 'neutral', label = 'Количество', announce = false, hidden = false, className = '', id = '' } = {}) {
  const known = value !== null && value !== '' && Number.isFinite(Number(value));
  const amount = known ? Math.max(0,Number(value)) : null;
  const text = loading ? '…' : amount === null ? '—' : cap !== null && amount > cap ? `${cap}+` : String(amount);
  const description = `${label}: ${loading ? 'загрузка' : amount === null ? 'неизвестно' : amount}`;
  return `<span class="ui-counter ${esc(className)}"${hidden ? ' hidden' : ''}${id ? ` id="${esc(id)}"` : ''} data-ui-tone="${['selected','unread','warning','danger'].includes(tone)?tone:'neutral'}" aria-label="${esc(description)}"${announce ? ' role="status" aria-live="polite" aria-atomic="true"' : ''}>${esc(text)}</span>`;
}

// Shared display for attachment bytes; zero is a value, missing size is unknown.
export function formatFileSize(value) {
  if (value == null || value === '' || typeof value === 'boolean') return 'Размер неизвестен';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Размер неизвестен';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const unit = bytes < 1024 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / 1024 ** unit;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: unit ? 1 : 0 }).format(amount) + ' ' + units[unit];
}
