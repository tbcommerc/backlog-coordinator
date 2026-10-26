function referenceYear(value) {
  const match = String(value || '').trim().match(/(\d{4})$/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

export function deadlineYearFromReference(deadline, references = []) {
  const source = deadline || {};
  const byId = source.id == null
    ? null
    : references.find(item => Number(item?.id) === Number(source.id));
  const byName = byId || references.find(item => String(item?.name || '') === String(source.name || ''));
  return referenceYear(byName?.code) ?? referenceYear(byName?.name) ?? referenceYear(source.name);
}

export function buildCompetencyRateTable(items = []) {
  const table = Object.create(null);
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.is_active === false) continue;
    const competency = String(item.competency || '').trim();
    const year = Number(item.year);
    const rate = Number(item.rate);
    if (!competency || !Number.isInteger(year) || !Number.isFinite(rate)) continue;
    if (!table[competency]) table[competency] = Object.create(null);
    table[competency][year] = rate;
  }
  return table;
}

export function competencyRateForYear(table, competency, year = null) {
  const rates = table?.[competency];
  if (!rates) return 0;
  if (year != null && Object.prototype.hasOwnProperty.call(rates, year)) return Number(rates[year]) || 0;
  const years = Object.keys(rates).map(Number).filter(Number.isFinite);
  if (!years.length) return 0;
  return Number(rates[Math.max(...years)]) || 0;
}
