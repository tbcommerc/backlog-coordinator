// Missing measurements stay unknown; a measured zero remains a value.
export function taskNumber(value) {
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sumTaskMeasurements(values) {
  const known = values.map(taskNumber).filter(value => value !== null);
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
}

export function taskMeasurementCost(value, rate) {
  const measurement = taskNumber(value);
  const price = taskNumber(rate);
  if (measurement === null) return null;
  if (measurement === 0) return 0;
  return price === null ? null : measurement * price;
}

export function sumTaskCosts(entries) {
  const known = entries.filter(([value]) => taskNumber(value) !== null);
  if (!known.length) return null;
  const costs = known.map(([value, rate]) => taskMeasurementCost(value, rate));
  return costs.includes(null) ? null : sumTaskMeasurements(costs);
}
