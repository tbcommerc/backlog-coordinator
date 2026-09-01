const TASK_PUBLIC_ID_PATTERN = /^TASK-\d{3}-\d{3}$/;

export function formatTaskPublicId(taskOrId) {
  const stored = taskOrId && typeof taskOrId === 'object' ? taskOrId.public_id : null;
  if (TASK_PUBLIC_ID_PATTERN.test(String(stored || ''))) return stored;

  const rawId = taskOrId && typeof taskOrId === 'object' ? taskOrId.id : taskOrId;
  const numericId = Number(rawId);
  if (!Number.isSafeInteger(numericId) || numericId < 0 || numericId > 999_999) {
    return String(stored || rawId || '');
  }
  const digits = String(numericId).padStart(6, '0');
  return `TASK-${digits.slice(0, 3)}-${digits.slice(3)}`;
}
