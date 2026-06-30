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

  const valid = tasks.filter(t => t.effort_rub > 0 && t.financial_effect != null);
  const highValue = valid
    .filter(t => t.financial_effect / t.effort_rub >= 1.5)
    .sort((a, b) => (b.financial_effect / b.effort_rub) - (a.financial_effect / a.effort_rub))
    .slice(0, 5);
  const lowValue = valid
    .filter(t => t.financial_effect / t.effort_rub < 1)
    .sort((a, b) => (a.financial_effect / a.effort_rub) - (b.financial_effect / b.effort_rub))
    .slice(0, 5);

  createChart('chart-lt-high-value', {
    type: 'bar',
    data: {
      labels: highValue.map(t => `#${t.id}`),
      datasets: [{
        label: 'C/V',
        data: highValue.map(t => +(t.financial_effect / t.effort_rub).toFixed(1)),
        backgroundColor: '#10b981', borderRadius: 4
      }]
    },
    options: { ...opts, indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  createChart('chart-lt-low-value', {
    type: 'bar',
    data: {
      labels: lowValue.map(t => `#${t.id}`),
      datasets: [{
        label: 'C/V',
        data: lowValue.map(t => +(t.financial_effect / t.effort_rub).toFixed(1)),
        backgroundColor: '#f43f5e', borderRadius: 4
      }]
    },
    options: { ...opts, indexAxis: 'y', plugins: { legend: { display: false } } }
  });

  const riskByTeam = groupBy(tasks.filter(t => isRiskStatus(t.status)), t => t.team_name || 'Без команды');

  createChart('chart-lt-risk', {
    type: 'bar',
    data: {
      labels: Object.keys(riskByTeam),
      datasets: [{
        label: 'Количество', data: Object.values(riskByTeam).map(v => v.length),
        backgroundColor: '#f59e0b', borderRadius: 4
      }]
    },
    options: opts
  });

  const statusGroups = groupBy(tasks, t => t.status || 'Не указан');
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

function renderPoPlCharts(tasks) {
  if (!tasks || !tasks.length) return;
  const { textColor, gridColor } = getChartColors();
  const opts = getCommonOptions(textColor, gridColor);

  const activeTasks = tasks.filter(t => isActiveStatus(t.status) && t.effort_days != null);
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
    t => t.project || 'Без проекта'
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
  const fields = ['id', 'title', 'team_name', 'project', 'status', 'priority', 'progress', 'financial_effect', 'owner', 'effort_days'];
  const labels = { id:'ID', title:'Наименование', team_name:'Команда', project:'Проект', status:'Статус', priority:'Приоритет', progress:'Прогресс', financial_effect:'Фин. эффект', owner:'Исполнитель', effort_days:'Чел.-дни' };
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
            <h3 class="chart-title">Высокая ценность (C/V &ge; 1.5)</h3>
            <div class="chart-wrap"><canvas id="chart-lt-high-value"></canvas></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Низкая ценность (C/V &lt; 1)</h3>
            <div class="chart-wrap"><canvas id="chart-lt-low-value"></canvas></div>
          </div>
          <div class="card chart-card-analytics">
            <h3 class="chart-title">Риски по командам</h3>
            <div class="chart-wrap"><canvas id="chart-lt-risk"></canvas></div>
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
  try {
    const response = await app.api.get('/tasks?per_page=1000');
    tasks = response.items || [];
  } catch (e) {
    console.error('Analytics data load error:', e);
  }

  const excelId = type === 'tribe' ? 'analytics-excel-tribe' : 'analytics-excel-popl';
  const refreshId = type === 'tribe' ? 'analytics-refresh-tribe' : 'analytics-refresh-popl';

  document.getElementById(excelId)?.addEventListener('click', () => exportAnalyticsExcel(type, tasks));
  document.getElementById(refreshId)?.addEventListener('click', () => initAnalytics(type, app));

  if (window.lucide) window.lucide.createIcons();

  try {
    if (type === 'tribe') {
      renderTribeCharts(tasks);
    } else {
      renderPoPlCharts(tasks);
    }
  } catch (e) {
    console.error('Chart render error:', e);
  }
}
