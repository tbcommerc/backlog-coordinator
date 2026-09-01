export function calculateCv(effortRub, financialEffect) {
  const cost = Number(effortRub);
  const valueMln = Number(financialEffect);
  if (!Number.isFinite(cost) || !Number.isFinite(valueMln) || cost <= 0 || valueMln <= 0) return null;
  return Math.round((cost / (valueMln * 1_000_000)) * 10_000) / 10_000;
}

export function calculateTaskCv(task) {
  return calculateCv(task?.effort_rub, task?.financial_effect);
}

export function cvZone(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'missing';
  if (Number(value) <= 0.30) return 'good';
  if (Number(value) <= 1.00) return 'warning';
  return 'danger';
}
