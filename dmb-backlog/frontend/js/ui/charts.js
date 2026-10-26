// ECharts/canvas need resolved colours; SVG and CSS can use the same tokens.
function token(name, fallback) {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function chartPalette() {
  return Array.from({ length: 10 }, (_, index) => token(`--chart-category-${index + 1}`, '#64748b'));
}

export function chartJsTheme() {
  return {
    text: token('--text-secondary', '#64748b'),
    grid: token('--border-color', '#cbd5e1'),
    background: token('--bg-secondary', '#ffffff'),
    foreground: token('--text-primary', '#0f172a'),
    fontFamily: token('--font-family', 'Inter, sans-serif'),
  };
}

export function applyChartJsTheme(chart) {
  const theme = chartJsTheme();
  chart.options.font = { ...chart.options.font, family: theme.fontFamily };
  const plugins = chart.options.plugins ||= {};
  if (plugins.title) { plugins.title.color = theme.text; plugins.title.font = { ...plugins.title.font, family: theme.fontFamily }; }
  if (plugins.legend?.labels) { plugins.legend.labels.color = theme.text; plugins.legend.labels.font = { ...plugins.legend.labels.font, family: theme.fontFamily }; }
  Object.assign(plugins.tooltip ||= {}, { backgroundColor: theme.background, titleColor: theme.foreground, bodyColor: theme.foreground, borderColor: theme.grid, borderWidth: 1 });
  for (const kind of ['titleFont', 'bodyFont', 'footerFont']) plugins.tooltip[kind] = { ...plugins.tooltip[kind], family: theme.fontFamily };
  for (const scale of Object.values(chart.options.scales || {})) {
    if (scale.ticks) { scale.ticks.color = theme.text; scale.ticks.font = { ...scale.ticks.font, family: theme.fontFamily }; }
    if (scale.title) scale.title.font = { ...scale.title.font, family: theme.fontFamily };
    if (scale.grid) scale.grid.color = theme.grid;
  }
  chart.update('none');
}

// Canvas libraries cache text widths. Load the face before their first layout.
export function loadChartFont() {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const font = `400 12px ${token('--font-family', 'Inter, sans-serif')}`;
  return document.fonts.load(font, 'Проверка 012345').catch(() => []);
}

export function chartTheme() {
  const text = token('--text-secondary', '#64748b');
  const fontFamily = token('--font-family', 'Inter, sans-serif');
  return {
    color: chartPalette(),
    backgroundColor: 'transparent',
    textStyle: { color: text, fontFamily },
    tooltip: { backgroundColor: token('--bg-secondary', '#ffffff'), borderColor: token('--border-color', '#cbd5e1'), textStyle: { color: token('--text-primary', '#0f172a'), fontFamily } },
    legend: { textStyle: { color: text, fontFamily } },
  };
}

// Update only presentation; retain filters, data, selection and formatters.
export function applyChartTheme(chart) {
  if (chart.isDisposed()) return;
  const theme = chartTheme();
  const series = (chart.getOption().series || []).map(item => ({
    ...item,
    label: { ...item.label, color: theme.textStyle.color },
    ...(item.type === 'graph' ? {
      edgeLabel: { ...item.edgeLabel, color: theme.textStyle.color, textBorderColor: theme.tooltip.backgroundColor },
      data: item.data.map(node => ({ ...node, label: { ...node.label, color: theme.textStyle.color }, itemStyle: { ...node.itemStyle, borderColor: theme.tooltip.backgroundColor } })),
    } : {}),
  }));
  chart.setOption({ ...theme, series });
}
