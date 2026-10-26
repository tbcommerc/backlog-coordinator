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

export function progress({ value = null, label = 'Прогресс', tone = 'accent', className = '', showValue = false } = {}) {
  const known = value !== null && value !== '' && Number.isFinite(Number(value));
  const amount = known ? Math.min(100, Math.max(0, Number(value))) : 0;
  const text = known ? `${amount}%` : 'Нет данных';
  return `<span class="ui-progress ${esc(className)}" data-ui-tone="${TONES.has(tone) ? tone : 'accent'}"><span class="ui-progress-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100"${known ? ` aria-valuenow="${amount}"` : ''} aria-valuetext="${text}"><span class="ui-progress-fill" style="width:${amount}%"></span></span>${showValue ? `<span class="ui-progress-value">${text}</span>` : ''}</span>`;
}
