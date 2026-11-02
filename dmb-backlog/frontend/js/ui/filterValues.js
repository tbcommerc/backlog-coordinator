// JSON preserves commas and other punctuation in dictionary labels.
export function filterValues(value) {
  if (Array.isArray(value)) return [...new Set(value.map(String))];
  const text = String(value ?? '');
  if (!text) return [];
  if (text.startsWith('[')) {
    try { const values=JSON.parse(text); if(Array.isArray(values))return [...new Set(values.map(String))]; } catch {}
  }
  return [text];
}
export const filterMatches = (selection, value, all = '') => !selection || selection === all || filterValues(selection).includes(String(value ?? ''));
export const encodeFilterValues = values => values.length > 1 ? JSON.stringify(values) : values[0] || '';
export function toggleFilterValues(current,key,all='') {
  const selected=new Set(filterValues(current).filter(value=>value!==all));
  if(key===all)selected.clear();else selected.has(key)?selected.delete(key):selected.add(key);
  return encodeFilterValues([...selected])||all;
}
export function setFilterValue(select,value) {
  if(!select)return;
  const text=String(value ?? '');
  select.querySelectorAll('[data-ui-filter-summary]').forEach(option=>option.remove());
  const values=filterValues(text);
  for(const value of values)if(![...select.options].some(option=>option.value===value)) {
    const missing=new Option(`Недоступное значение: ${value}`,value);
    missing.dataset.uiFilterMissing='';select.add(missing);
  }
  if(values.length>1) {
    const labels=values.map(v=>[...select.options].find(option=>option.value===v)?.label || v);
    const option=new Option(labels.join(' · '),text,true,true);
    option.hidden=true;option.dataset.uiFilterSummary='';select.add(option);
  }
  select.value=text;
}
export function filterSummaryOption(value,options) {
  const values=filterValues(value);
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  if(!values.length)return '';
  if(values.length===1) {
    if(options.some(option=>String(option.value)===values[0]))return '';
    return `<option selected data-ui-filter-missing value="${esc(values[0])}">Недоступное значение: ${esc(values[0])}</option>`;
  }
  return `<option hidden selected data-ui-filter-summary value="${esc(value)}">${esc(values.map(v=>options.find(o=>String(o.value)===v)?.label || v).join(' · '))}</option>`;
}
