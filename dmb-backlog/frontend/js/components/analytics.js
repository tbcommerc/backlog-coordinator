const chartInstances = {};

function getChartColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    textColor: dark ? '#e2e8f0' : '#334155',
    gridColor: dark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(15, 23, 42, 0.08)'
  };
}

function getCommonOptions(textColor, gridColor) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 800, easing: 'easeOutQuart' },
    plugins: {
      legend: { labels: { color: textColor, font: { size: 10 } } }
    },
    scales: {
      x: { ticks: { color: textColor }, grid: { color: gridColor } },
      y: { ticks: { color: textColor }, grid: { color: gridColor } }
    }
  };
}

function groupBy(arr, fn) {
  const map = {};
  for (const item of arr) {
    const key = fn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}

export function isRiskStatus(s) {
  return s === 'ХОЛД' || s === 'ЭСКАЛАЦИЯ НА ЛТ';
}

export function isActiveStatus(s) {
  return ['СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ'].includes(s);
}

function createChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) { console.warn('Canvas not found:', canvasId); return; }
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }
  const ctx = canvas.getContext('2d');
  chartInstances[canvasId] = new window.Chart(ctx, config);
}

function renderTribeCharts(tasks) {
  if (!tasks || !tasks.length) return;
  const { textColor, gridColor } = getChartColors();
  const opts = getCommonOptions(textColor, gridColor);

  const statusGroups = groupBy(tasks, t => t.status_name || 'Не указан');
  const statusColors = ['#64748b', '#8b5cf6', '#f59e0b', '#6366f1', '#94a3b8', '#f43f5e', '#10b981', '#94a3b8'];

  createChart('chart-lt-health', {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusGroups),
      datasets: [{
        data: Object.values(statusGroups).map(v => v.length),
        backgroundColor: Object.keys(statusGroups).map((_, i) => statusColors[i % statusColors.length]),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font: { size: 10 } } }
      }
    }
  });

  const teamFin = groupBy(tasks.filter(t => t.financial_effect != null), t => t.team_name || 'Без команды');
  const teamFinData = Object.entries(teamFin)
    .map(([team, items]) => [team, items.reduce((s, t) => s + (t.financial_effect || 0), 0)])
    .sort((a, b) => b[1] - a[1]);

  createChart('chart-lt-team-fin', {
    type: 'bar',
    data: {
      labels: teamFinData.map(d => d[0]),
      datasets: [{
        label: 'Фин. эффект (млн ₽)', data: teamFinData.map(d => d[1]),
        backgroundColor: '#6366f1', borderRadius: 4
      }]
    },
    options: opts
  });
}

const FunnelStatusOrder = ['НОВАЯ ЗАДАЧА', 'НАЗНАЧЕНА КОМАНДА', 'СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ'];

function renderKpiTiles(tasks) {
  const el = (id) => document.getElementById(id);
  const total = tasks.length;
  const effortDays = tasks.reduce((s, t) => s + (t.effort_days || 0), 0);
  const effortRub = tasks.reduce((s, t) => s + (t.effort_rub || 0), 0);
  const finEffect = tasks.reduce((s, t) => s + (t.financial_effect || 0), 0);
  const roi = effortRub > 0 ? (finEffect / effortRub).toFixed(2) : '—';
  const avgProgress = total ? Math.round(tasks.reduce((s, t) => s + (t.progress || 0), 0) / total) : 0;
  const atRisk = tasks.filter(t => t.directorate_status === 'Риск' || t.did_status === 'Блокировано' || t.did_status === 'Требует решения').length;

  if (el('kpi-total')) el('kpi-total').textContent = total;
  if (el('kpi-effort-days')) el('kpi-effort-days').textContent = effortDays.toLocaleString('ru-RU');
  if (el('kpi-effort-rub')) el('kpi-effort-rub').textContent = effortRub.toFixed(1) + ' млн ₽';
  if (el('kpi-fin-effect')) el('kpi-fin-effect').textContent = finEffect.toFixed(1) + ' млн ₽';
  if (el('kpi-roi')) el('kpi-roi').textContent = roi;
  if (el('kpi-progress')) el('kpi-progress').textContent = avgProgress + '%';
  if (el('kpi-risk')) el('kpi-risk').textContent = atRisk;
}

function renderLowCvList(tasks) {
  const list = document.getElementById('low-cv-list');
  if (!list) return;
  const low = tasks
    .filter(t => t.effort_rub > 0 && t.financial_effect != null)
    .map(t => ({ ...t, cv: t.financial_effect / t.effort_rub }))
    .sort((a, b) => a.cv - b.cv)
    .slice(0, 5);
  if (!low.length) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:8px 0;">Нет данных</p>';
    return;
  }
  list.innerHTML = low.map(t => `
    <div class="kp-card">
      <div class="kp-header">
        <span class="kp-title">#${t.id} · ${t.title}</span>
        <span class="kp-status kp-status--good">C/V ${t.cv.toFixed(2)}</span>
      </div>
      <div class="kp-meta">${t.team_name || '—'} · фин. эффект ${t.financial_effect.toFixed(1)} млн ₽ · затраты ${t.effort_rub.toFixed(1)} млн ₽</div>
    </div>`).join('');
}

function renderTeamStatusHeatmap(tasks) {
  const table = document.getElementById('heatmap-team-status');
  if (!table) return;
  const statuses = FunnelStatusOrder.filter(s => tasks.some(t => t.status_name === s));
  const byTeam = groupBy(tasks, t => t.team_name || 'Без команды');
  const teamNames = Object.keys(byTeam).sort();

  const counts = {};
  let max = 0;
  for (const tn of teamNames) {
    for (const t of byTeam[tn]) {
      const s = t.status_name;
      counts[`${tn}|${s}`] = (counts[`${tn}|${s}`] || 0) + 1;
      max = Math.max(max, counts[`${tn}|${s}`]);
    }
  }

  const cellBg = (v) => {
    const k = v / (max || 1);
    return `rgba(99, 102, 241, ${(0.08 + k * 0.85).toFixed(2)})`;
  };

  let html = `<thead><tr><th>Команда</th>${statuses.map(s => `<th>${s}</th>`).join('')}<th>Всего</th></tr></thead><tbody>`;
  for (const tn of teamNames) {
    const total = byTeam[tn].length;
    html += `<tr><td class="hm-team">${tn}</td>`;
    for (const s of statuses) {
      const v = counts[`${tn}|${s}`] || 0;
      html += `<td class="hm-cell" style="background:${cellBg(v)}">${v || ''}</td>`;
    }
    html += `<td class="hm-total">${total}</td></tr>`;
  }
  html += '</tbody>';
  table.innerHTML = html;
}

function renderCapacity(dash) {
  const data = dash.capacity_by_team || [];
  if (!data.length) return;
  createChart('chart-lt-capacity', {
    type: 'bar',
    data: {
      labels: data.map(d => d.team),
      datasets: [
        { label: 'Ёмкость (ч.-дн)', data: data.map(d => d.capacity), backgroundColor: '#94a3b8', borderRadius: 4 },
        { label: 'Нагрузка (ч.-дн)', data: data.map(d => d.load), backgroundColor: data.map(d => (d.utilisation != null && d.utilisation > 100) ? '#f43f5e' : '#6366f1'), borderRadius: 4 }
      ]
    },
    options: {
      ...getCommonOptions(getChartColors().textColor, getChartColors().gridColor),
      plugins: {
        legend: { labels: { color: getChartColors().textColor, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const d = data[items[0].dataIndex];
              return d.utilisation != null ? [`Загрузка: ${d.utilisation}%`, `Сотрудников: ${d.headcount}`] : [];
            }
          }
        }
      }
    }
  });
}

function renderPriorityDeadline(dash) {
  const table = document.getElementById('heatmap-priority-deadline');
  if (!table) return;
  const rows = dash.priority_deadline || [];
  if (!rows.length) return;

  const deadlines = [];
  for (const r of rows) for (const v of r.values) if (!deadlines.includes(v.deadline)) deadlines.push(v.deadline);
  const cell = {};
  let max = 0;
  for (const r of rows) for (const v of r.values) {
    cell[`${r.priority}|${v.deadline}`] = v.effort_days;
    max = Math.max(max, v.effort_days);
  }

  const cellBg = (v) => {
    const k = v / (max || 1);
    return `rgba(245, 158, 11, ${(0.08 + k * 0.75).toFixed(2)})`;
  };

  let html = `<thead><tr><th>Приоритет</th>${deadlines.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr><td class="hm-team">${r.priority}</td>`;
    for (const dl of deadlines) {
      const v = cell[`${r.priority}|${dl}`] || 0;
      html += `<td class="hm-cell" style="background:${v ? cellBg(v) : ''}">${v || ''}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;
}

function renderRoi(dash) {
  const data = dash.roi_by_team || [];
  if (!data.length) return;
  createChart('chart-lt-roi', {
    type: 'bar',
    data: {
      labels: data.map(d => d.team),
      datasets: [
        { label: 'Фин. эффект (млн ₽)', data: data.map(d => d.financial_effect), backgroundColor: '#10b981', borderRadius: 4, yAxisID: 'y' },
        { label: 'Затраты (млн ₽)', data: data.map(d => d.effort_rub), backgroundColor: '#f43f5e', borderRadius: 4, yAxisID: 'y' }
      ]
    },
    options: {
      ...getCommonOptions(getChartColors().textColor, getChartColors().gridColor),
      plugins: {
        legend: { labels: { color: getChartColors().textColor, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const d = data[items[0].dataIndex];
              return d.roi != null ? [`ROI: ${d.roi}`] : [];
            }
          }
        }
      }
    }
  });
}

function buildTeamCustomerMatrix(tasks) {
  const matrix = {};
  const teams = [];
  const customers = [];
  const teamSet = new Set();
  const custSet = new Set();
  for (const t of tasks) {
    if (!t.team_name || !t.business_customer_name) continue;
    teamSet.add(t.team_name);
    custSet.add(t.business_customer_name);
    const key = `${t.team_name}|||${t.business_customer_name}`;
    matrix[key] = (matrix[key] || 0) + (t.effort_days || 0);
  }
  teams.push(...teamSet);
  teams.sort();
  customers.push(...custSet);
  customers.sort();
  return { matrix, teams, customers };
}

function renderCustomerShare(tasks, mode) {
  const canvas = document.getElementById('chart-lt-customers');
  if (!canvas) return;
  const { matrix, teams, customers } = buildTeamCustomerMatrix(tasks);
  if (!teams.length || !customers.length) return;

  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316', '#e11d48', '#22c55e', '#64748b'];

  let labels, segKeys, segName;
  if (mode === 'customers') {
    labels = customers;
    segKeys = teams;
    segName = (s) => `Команда: ${s}`;
  } else {
    labels = teams;
    segKeys = customers;
    segName = (s) => `Заказчик: ${s}`;
  }

  const datasets = segKeys.map((seg, i) => {
    const values = labels.map(row => {
      const key = mode === 'customers'
        ? `${seg}|||${row}`
        : `${row}|||${seg}`;
      return matrix[key] || 0;
    });
    const rowTotals = labels.map(row => {
      let sum = 0;
      for (const s of segKeys) {
        const k = mode === 'customers' ? `${s}|||${row}` : `${row}|||${s}`;
        sum += matrix[k] || 0;
      }
      return sum || 1;
    });
    return {
      label: seg,
      data: values.map((v, idx) => +((v / rowTotals[idx]) * 100).toFixed(1)),
      raw: values,
      backgroundColor: palette[i % palette.length],
      borderRadius: 2
    };
  });

  createChart(canvas.id, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      ...getCommonOptions(getChartColors().textColor, getChartColors().gridColor),
      plugins: {
        legend: { position: 'right', labels: { color: getChartColors().textColor, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            title(items) { return items.length ? labels[items[0].dataIndex] : ''; },
            label(ctx) {
              const seg = segKeys[ctx.datasetIndex];
              const val = ctx.parsed.y;
              const raw = datasets[ctx.datasetIndex].raw[ctx.dataIndex];
              return ` ${segName(seg)} ${val.toFixed(1)}% (${raw.toFixed(0)} ч.-дн)`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { color: getChartColors().textColor, maxRotation: 45, minRotation: 30 }, grid: { color: getChartColors().gridColor } },
        y: { stacked: true, ticks: { color: getChartColors().textColor, callback: (v) => v + '%' }, grid: { color: getChartColors().gridColor }, max: 100 }
      }
    }
  });
}

function renderCustomers(tasks, mode = 'teams') {
  renderCustomerShare(tasks, mode);
}

function renderAging(tasks) {
  const today = new Date();
  const bins = [
    { label: '0–30 дней', min: 0, max: 30 },
    { label: '31–60 дней', min: 31, max: 60 },
    { label: '61–90 дней', min: 61, max: 90 },
    { label: '90+ дней', min: 91, max: Infinity }
  ];
  const ages = tasks
    .map(t => ({ t, age: t.date_received ? Math.floor((today - new Date(t.date_received)) / 86400000) : null }))
    .filter(x => x.age != null && x.age >= 0);
  const values = bins.map(b => ages.filter(x => x.age >= b.min && x.age <= b.max).length);

  createChart('chart-lt-aging', {
    type: 'bar',
    data: {
      labels: bins.map(b => b.label),
      datasets: [{
        label: 'Задач', data: values,
        backgroundColor: values.map(v => v > 0 ? (v >= values[values.length - 1] ? '#f43f5e' : '#f59e0b') : '#94a3b8'),
        borderRadius: 4
      }]
    },
    options: { ...getCommonOptions(getChartColors().textColor, getChartColors().gridColor), plugins: { legend: { display: false } } }
  });
}

function renderTribeDashboard(tasks, dash) {
  if (!tasks || !tasks.length) return;
  renderKpiTiles(tasks);
  renderTeamStatusHeatmap(tasks);
  renderAging(tasks);
  renderLowCvList(tasks);
  renderCustomers(tasks, 'teams');
  if (!dash) return;
  renderCapacity(dash);
  renderPriorityDeadline(dash);
  renderRoi(dash);
}

function renderPoPlCharts(tasks) {
  const { textColor, gridColor } = getChartColors();
  const opts = getCommonOptions(textColor, gridColor);

  const activeTasks = tasks.filter(t => isActiveStatus(t.status_name) && t.effort_days != null);
  const workloadByTeam = groupBy(activeTasks, t => t.team_name || 'Без команды');
  const workloadData = Object.entries(workloadByTeam)
    .map(([team, items]) => [team, items.reduce((s, t) => s + (t.effort_days || 0), 0)])
    .sort((a, b) => b[1] - a[1]);

  createChart('chart-po-workload', {
    type: 'bar',
    data: {
      labels: workloadData.map(d => d[0]),
      datasets: [{
        label: 'Человеко-дни', data: workloadData.map(d => d[1]),
        backgroundColor: '#6366f1', borderRadius: 4
      }]
    },
    options: opts
  });

  createChart('chart-po-deadline', {
    type: 'doughnut',
    data: {
      labels: ['В срок', 'Просрочено/Риск'],
      datasets: [{ data: [65, 35], backgroundColor: ['#10b981', '#f43f5e'], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' },
      plugins: { legend: { position: 'right', labels: { color: textColor } } }
    }
  });

  const keyProjects = groupBy(
    tasks.filter(t => t.key_project === true && t.progress != null),
    t => t.project_name || 'Без проекта'
  );
  const avgProgress = Object.entries(keyProjects)
    .map(([proj, items]) => {
      const avg = items.reduce((s, t) => s + (t.progress || 0), 0) / items.length;
      return [proj, Math.round(avg)];
    })
    .sort((a, b) => b[1] - a[1]);

  createChart('chart-po-key-projects', {
    type: 'bar',
    data: {
      labels: avgProgress.map(d => d[0]),
      datasets: [{
        label: 'Прогресс %', data: avgProgress.map(d => d[1]),
        backgroundColor: '#0ea5e9', borderRadius: 4
      }]
    },
    options: { ...opts, scales: { ...opts.scales, y: { min: 0, max: 100 } } }
  });

  const hasEffort = t => t.effort_days != null && t.effort_rub != null;
  const hasNoEval = t => (t.effort_days == null || t.effort_days === '') && (t.effort_rub == null || t.effort_rub === '');
  const hasNoDesc = t => {
    if (hasNoEval(t)) return false;
    return !t.description || String(t.description).trim().length < 10;
  };

  let noEval = 0, noDesc = 0, full = 0;
  for (const t of tasks) {
    if (hasNoEval(t)) { noEval++; }
    else if (hasNoDesc(t)) { noDesc++; }
    else { full++; }
  }

  createChart('chart-po-attrs', {
    type: 'doughnut',
    data: {
      labels: ['Полные', 'Без оценки', 'Без описания'],
      datasets: [{ data: [full, noEval, noDesc], backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' },
      plugins: { legend: { position: 'right', labels: { color: textColor } } }
    }
  });
}

function exportAnalyticsExcel(type, tasks) {
  if (!tasks.length) return;
  const name = type === 'tribe' ? 'analytics_lt' : 'analytics_po_pl';
  const fields = ['id', 'title', 'team_name', 'project_name', 'status_name', 'priority_name', 'progress', 'financial_effect', 'owner_name', 'effort_days'];
  const labels = { id:'ID', title:'Наименование', team_name:'Команда', project_name:'Проект', status_name:'Статус', priority_name:'Приоритет', progress:'Прогресс', financial_effect:'Фин. эффект', owner_name:'Исполнитель', effort_days:'Чел.-дни' };
  const headers = fields.map(f => labels[f] || f);
  const rows = tasks.map(t => fields.map(f => t[f] != null ? String(t[f]) : ''));
  if (typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = fields.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Аналитика');
    XLSX.writeFile(wb, `${name}_report.xlsx`);
  } else {
    const csv = [headers, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.csv`;
    link.click();
  }
}

const EFFORT_TYPE_COLORS = ['#6366f1', '#8b5cf6', '#f59e0b', '#10b981', '#0ea5e9', '#f43f5e', '#94a3b8'];

function renderEffortByType(data) {
  const canvas = document.getElementById('chart-effort-type');
  const tbody = document.getElementById('effort-table-body');
  if (!canvas || !tbody) return;

  if (chartInstances[canvas.id]) {
    chartInstances[canvas.id].destroy();
    delete chartInstances[canvas.id];
  }

  if (!data.by_type.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">Нет данных за выбранный период</td></tr>';
    return;
  }

  const { textColor } = getChartColors();
  const labels = data.by_type.map(d => d.task_type);
  const values = data.by_type.map(d => d.effort_days);

  createChart(canvas.id, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => EFFORT_TYPE_COLORS[i % EFFORT_TYPE_COLORS.length]),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const item = data.by_type[ctx.dataIndex];
              return ` ${item.task_type}: ${item.effort_days} ч.-дн (${item.share}%)`;
            }
          }
        }
      }
    }
  });

  tbody.innerHTML = data.by_type.map(d => `
    <tr>
      <td>${d.task_type}</td>
      <td>${d.tasks}</td>
      <td>${d.effort_days}</td>
      <td>${d.share}%</td>
    </tr>`).join('') + `
    <tr class="effort-total">
      <td>Итого</td>
      <td>${data.total_tasks}</td>
      <td>${data.total_effort_days}</td>
      <td>100%</td>
    </tr>`;
}

async function loadEffortByType(app) {
  const scope = document.getElementById('effort-scope')?.value || '';
  const period = document.getElementById('effort-period')?.value || 'quarter';
  let url = `/tasks/analytics/effort-by-type?period=${period}`;
  if (scope) url += `&team_id=${scope}`;
  let data;
  try {
    data = await app.api.get(url);
  } catch (e) {
    console.error('Effort-by-type load error:', e);
    return;
  }
  renderEffortByType(data);
}

async function initEffortControls(app) {
  const scopeEl = document.getElementById('effort-scope');
  if (!scopeEl) return;

  try {
    const teamsResp = await app.api.get('/teams?per_page=100');
    const teams = teamsResp.items || [];
    scopeEl.innerHTML = '<option value="">Весь трайб</option>' +
      teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  } catch (e) {
    console.error('Teams load error:', e);
  }

  scopeEl.addEventListener('change', () => loadEffortByType(app));
  document.getElementById('effort-period')?.addEventListener('change', () => loadEffortByType(app));
  await loadEffortByType(app);
}

export function renderAnalytics(type, app) {
  window.__app = app;

  if (type === 'tribe') {
    return `
      <div class="animate-fade-in">
        <div class="page-header">
          <h1>Аналитика Лидера Трайба</h1>
          <p>Финансовая эффективность, риски и здоровье портфеля</p>
        </div>
        <div class="action-bar action-bar--end">
          <button class="btn btn-secondary btn-sm" id="analytics-excel-tribe"><i data-lucide="file-spreadsheet" style="width:14px;height:14px;"></i> Excel</button>
          <button class="btn btn-primary btn-sm" id="analytics-refresh-tribe"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Обновить</button>
        </div>
        <div class="analytics-grid analytics-grid--tribe">
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Топ-5 задач с самым низким C/V</h3>
            <div id="low-cv-list" class="kp-list"></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Здоровье портфеля</h3>
            <div class="chart-wrap"><canvas id="chart-lt-health"></canvas></div>
          </div>
        </div>
        <div class="card chart-card-analytics chart-card-full">
          <h3 class="chart-title">Топ команд по фин. эффекту</h3>
          <div class="chart-wrap"><canvas id="chart-lt-team-fin"></canvas></div>
        </div>
        <div class="card chart-card-analytics chart-card-full">
          <div class="effort-controls-row">
            <h3 class="chart-title">Трудозатраты по типам задач</h3>
            <div class="effort-controls">
              <select id="effort-scope" class="effort-select">
                <option value="">Весь трайб</option>
              </select>
              <select id="effort-period" class="effort-select">
                <option value="quarter">Текущий квартал</option>
                <option value="ytd">С начала года</option>
              </select>
            </div>
          </div>
          <div class="effort-layout">
            <div class="chart-wrap"><canvas id="chart-effort-type"></canvas></div>
            <div class="effort-table-wrap">
              <table class="effort-table">
                <thead>
                  <tr><th>Тип задачи</th><th>Задач</th><th>Чел.-дни</th><th>Доля</th></tr>
                </thead>
                <tbody id="effort-table-body"></tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="kpi-grid">
          <div class="card kpi-tile"><div class="kpi-label">Задач в портфеле</div><div class="kpi-value" id="kpi-total">—</div></div>
          <div class="card kpi-tile"><div class="kpi-label">Трудозатраты</div><div class="kpi-value" id="kpi-effort-days">—</div></div>
          <div class="card kpi-tile"><div class="kpi-label">Затраты на реализацию</div><div class="kpi-value" id="kpi-effort-rub">—</div></div>
          <div class="card kpi-tile"><div class="kpi-label">Фин. эффект</div><div class="kpi-value" id="kpi-fin-effect">—</div></div>
          <div class="card kpi-tile"><div class="kpi-label">ROI портфеля</div><div class="kpi-value" id="kpi-roi">—</div></div>
          <div class="card kpi-tile"><div class="kpi-label">Средний прогресс</div><div class="kpi-value" id="kpi-progress">—</div></div>
          <div class="card kpi-tile kpi-tile--warn"><div class="kpi-label">На риске / блокировки</div><div class="kpi-value" id="kpi-risk">—</div></div>
        </div>
        <div class="analytics-grid analytics-grid--tribe">
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Команда × Статус (теплая карта)</h3>
            <div class="heatmap-wrap"><table class="heatmap-table" id="heatmap-team-status"></table></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Загрузка команд vs ёмкость</h3>
            <div class="chart-wrap"><canvas id="chart-lt-capacity"></canvas></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Приоритет × Срок (ч.-дн)</h3>
            <div class="heatmap-wrap"><table class="heatmap-table" id="heatmap-priority-deadline"></table></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">ROI по командам</h3>
            <div class="chart-wrap"><canvas id="chart-lt-roi"></canvas></div>
          </div>
          <div class="card chart-card-analytics">
            <div class="effort-controls-row">
              <h3 class="chart-title">Заказчики × Команды</h3>
              <div class="effort-controls">
                <select id="customer-view" class="effort-select">
                  <option value="teams">Команды → Заказчики</option>
                  <option value="customers">Заказчики → Команды</option>
                </select>
              </div>
            </div>
            <div class="chart-wrap"><canvas id="chart-lt-customers"></canvas></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Возраст задач в бэклоге</h3>
            <div class="chart-wrap"><canvas id="chart-lt-aging"></canvas></div>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="animate-fade-in">
      <div class="page-header">
        <h1>Аналитика PO / PL</h1>
        <p>Загрузка команд, соблюдение сроков и качество данных</p>
      </div>
      <div class="action-bar action-bar--end">
        <button class="btn btn-secondary btn-sm" id="analytics-excel-popl"><i data-lucide="file-spreadsheet" style="width:14px;height:14px;"></i> Excel</button>
        <button class="btn btn-primary btn-sm" id="analytics-refresh-popl"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Обновить</button>
      </div>
      <div class="analytics-grid analytics-grid--popl">
        <div class="card chart-card-analytics">
          <h3 class="chart-title">Загрузка команд</h3>
          <div class="chart-wrap"><canvas id="chart-po-workload"></canvas></div>
        </div>
        <div class="card chart-card-analytics">
          <h3 class="chart-title">Соблюдение сроков</h3>
          <div class="chart-wrap"><canvas id="chart-po-deadline"></canvas></div>
        </div>
        <div class="card chart-card-analytics">
          <h3 class="chart-title">Прогресс ключевых проектов</h3>
          <div class="chart-wrap"><canvas id="chart-po-key-projects"></canvas></div>
        </div>
        <div class="card chart-card-analytics">
          <h3 class="chart-title">Качество данных</h3>
          <div class="chart-wrap"><canvas id="chart-po-attrs"></canvas></div>
        </div>
      </div>
    </div>`;
}

export async function initAnalytics(type, app) {
  window.__app = app;

  for (const key of Object.keys(chartInstances)) {
    chartInstances[key].destroy();
    delete chartInstances[key];
  }

  let tasks = [];
  let dash = null;
  try {
    const response = await app.api.get('/tasks?per_page=1000');
    tasks = response.items || [];
  } catch (e) {
    console.error('Analytics data load error:', e);
  }

  if (type === 'tribe') {
    try {
      dash = await app.api.get('/tasks/analytics/tribe-dashboard');
    } catch (e) {
      console.error('Tribe dashboard data load error:', e);
    }
  }

  const excelId = type === 'tribe' ? 'analytics-excel-tribe' : 'analytics-excel-popl';
  const refreshId = type === 'tribe' ? 'analytics-refresh-tribe' : 'analytics-refresh-popl';

  document.getElementById(excelId)?.addEventListener('click', () => exportAnalyticsExcel(type, tasks));
  document.getElementById(refreshId)?.addEventListener('click', () => initAnalytics(type, app));

  if (window.lucide) window.lucide.createIcons();

  try {
    if (type === 'tribe') {
      renderTribeCharts(tasks);
      renderTribeDashboard(tasks, dash);
      document.getElementById('customer-view')?.addEventListener('change', (e) => renderCustomers(tasks, e.target.value));
      await initEffortControls(app);
    } else {
      renderPoPlCharts(tasks);
    }
  } catch (e) {
    console.error('Chart render error:', e);
  }
}
