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
  const name = 'analytics_po_pl';
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

export function renderAnalytics(type, app) {
  window.__app = app;

  if (type === 'it') {
    return `
      <div class="animate-fade-in">
        <div class="page-header">
          <h1>Аналитика для ИТ</h1>
          <p>Аналитика задач по направлениям ИТ</p>
        </div>
        <div class="card" style="position:relative;display:flex;align-items:center;justify-content:center;border:2px dashed var(--border-color);border-radius:16px;padding:64px 24px;text-align:center;">
          <span class="badge badge-warning" title="В разработке" style="position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;padding:5px;border-radius:var(--radius-full);">
            <i data-lucide="loader2" style="width:14px;height:14px;"></i>
          </span>
          <p class="text-muted" style="max-width:420px;margin:0 auto;">Здесь появится содержимое страницы.</p>
        </div>
      </div>`;
  }

  if (type === 'tribe') {
    return `
      <div class="animate-fade-in">
        <div class="page-header">
          <h1>Аналитика Лидера Трайба</h1>
          <p>Финансовая эффективность, риски и здоровье портфеля</p>
        </div>

        <section class="effort-report">
          <div class="kpi-grid">
            <article class="kpi" style="--kc:#6366f1;--kc-bg:rgba(99,102,241,.12)">
              <div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.5 8.5 4.7L12 12.9 3.5 8.2 12 3.5Z"/><path d="m4.2 13 7.8 4.3 7.8-4.3"/><path d="m4.2 17 7.8 4.3 7.8-4.3"/></svg></div>
              <div><div class="kpi-val" id="kTasks">0</div><div class="kpi-lab">Всего задач в срезе</div></div>
            </article>
            <article class="kpi" style="--kc:#f59e0b;--kc-bg:rgba(245,158,11,.12)">
              <div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></div>
              <div><div class="kpi-val" id="kDays">0</div><div class="kpi-lab">Трудозатраты, чел.-дней</div></div>
            </article>
            <article class="kpi" style="--kc:#10b981;--kc-bg:rgba(16,185,129,.12)">
              <div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5h3.5l2.5-6 4 11 2.5-5H21"/></svg></div>
              <div><div class="kpi-val" id="kAvg">0,0</div><div class="kpi-lab">Средняя трудоёмкость, ч.-д. / задачу</div></div>
            </article>
            <article class="kpi" style="--kc:#8b5cf6;--kc-bg:rgba(139,92,246,.12)">
              <div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.8 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.8Z"/></svg></div>
              <div>
                <div class="kpi-val k-topname"><span class="dot" id="kTopDot" style="--c:#6366f1;--ring:rgba(99,102,241,.15)"></span><span id="kTop">—</span></div>
                <div class="kpi-lab">Крупнейший тип · <b id="kTopPct">0,0%</b></div>
              </div>
            </article>
          </div>

          <div class="rep-card">
            <div class="rep-head">
              <div class="rep-title">
                <h3>Трудозатраты по типам задач</h3>
                <div class="rep-sub" id="repSub">—</div>
              </div>
              <div class="rep-controls">
                <div class="dd" id="squadDd">
                  <button class="dd-btn" id="squadBtn" type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span class="dd-label" id="squadName">Весь трайб</span>
                    <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <div class="dd-panel" id="squadPanel"></div>
                </div>
                <div class="seg" id="periodSeg" style="grid-template-columns:repeat(1,1fr)">
                  <div class="seg-thumb" id="segThumb" style="width:calc(100% - 1.2px)"></div>
                </div>
              </div>
            </div>
            <div class="rep-body">
              <div>
                <div class="donut-wrap">
                  <svg class="donut" viewBox="0 0 200 200">
                    <circle class="donut-track" cx="100" cy="100" r="78"/>
                    <g id="segGroup" transform="rotate(-90 100 100)"></g>
                  </svg>
                  <div class="donut-center">
                    <div class="dc-num" id="dcNum">0</div>
                    <div class="dc-lab">чел.-дней</div>
                    <div class="dc-sub" id="dcSub">0 задач</div>
                  </div>
                </div>
                <div class="donut-cap">Распределение оценённых трудозатрат по типам задач</div>
              </div>
              <div class="table-wrap">
                <table class="rep-table">
                  <colgroup><col style="width:34%"><col style="width:12%"><col style="width:15%"><col style="width:39%"></colgroup>
                  <thead>
                    <tr>
                      <th class="sortable" data-col="name"><span class="th-in">Тип задачи <span class="arr">↕</span></span></th>
                      <th class="sortable" data-col="tasks"><span class="th-in">Задач <span class="arr">↕</span></span></th>
                      <th class="sortable" data-col="days"><span class="th-in">Чел.-дни <span class="arr">↕</span></span></th>
                      <th class="sortable sorted" data-col="share"><span class="th-in">Доля <span class="arr">↓</span></span></th>
                    </tr>
                  </thead>
                  <tbody id="repTbody"></tbody>
                  <tfoot><tr><td>Итого</td><td id="tTasks">0</td><td id="tDays">0</td><td>100%</td></tr></tfoot>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section class="skp-card" id="skp-sankey-card">
          <h2>Потоки работ: заказчики → команды → типы задач</h2>
          <p class="skp-sub">Диаграмма Санки: слева — заказчики, в центре — команды, справа — типы задач. Толщина потока пропорциональна выбранной метрике.</p>
          <div class="skp-controls">
            <div class="skp-seg" id="skp-mode">
              <button type="button" data-mode="tasks" class="active">Количество задач, шт</button>
              <button type="button" data-mode="days">Трудозатраты, чел.-дни</button>
            </div>
            <div class="skp-seg" id="skp-period"></div>
          </div>
          <div class="skp-kpis" id="skp-kpis"></div>
          <div id="skp-sankey" class="skp-chart"></div>
        </section>

        <section class="skp-card" id="skp-map-card">
          <h2>Карта взаимосвязей команд</h2>
          <p class="skp-sub">По каждой задаче одна команда является основной и вовлекает команды-партнёры. Толщина ребра и число на нём — количество совместных задач. Команды расположены по кругу.</p>
          <div class="skp-controls">
            <div class="skp-seg" id="skp-map-period"></div>
          </div>
          <div class="skp-kpis" id="skp-map-kpis"></div>
          <div id="skp-map" class="skp-chart skp-chart--map"></div>
          <div class="skp-tables">
            <div>
              <h3>Топ взаимосвязей</h3>
              <table class="skp-table"><thead><tr><th>#</th><th>Основная команда</th><th>Вовлечённая команда</th><th>Совместных задач</th></tr></thead><tbody id="skp-pairs-body"></tbody></table>
            </div>
            <div>
              <h3>Статистика по командам</h3>
              <table class="skp-table"><thead><tr><th>Команда</th><th>Как основная, задач</th><th>Как партнёр, участий</th><th>Всего взаимосвязей</th></tr></thead><tbody id="skp-teams-body"></tbody></table>
            </div>
          </div>
        </section>
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
          <h3 class="chart-title">Качество данных</h3>
          <div class="chart-wrap"><canvas id="chart-po-attrs"></canvas></div>
        </div>
      </div>
    </div>`;
}

const LT_TYPE_COLORS = ['#6366f1','#f59e0b','#10b981','#8b5cf6','#0ea5e9','#f43f5e','#94a3b8','#14b8a6','#f97316','#ec4899'];
const LT_COLORS_C = ['#4E79A7','#59A14F','#F28E2B','#E15759','#76B7B2','#EDC949','#B07AA1','#FF9DA7','#9C755F','#BAB0AB','#86BCB6'];
const LT_COLORS_T = ['#0EA5E9','#8B5CF6','#F59E0B','#10B981','#EF4444','#6366F1','#14B8A6','#F97316','#EC4899','#84CC16'];
const LT_COLORS_Y = ['#2563EB','#D97706','#0F766E','#A21CAF','#DC2626','#9333EA'];
const LT_COLORS_M = ['#0EA5E9','#8B5CF6','#F59E0B','#10B981','#EF4444','#6366F1','#14B8A6','#F97316','#EC4899'];
const SVG_NS = 'http://www.w3.org/2000/svg';

function ltFmtInt(n) { return Math.round(n).toLocaleString('ru-RU'); }
function ltFmtPct(n) { return n.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
function ltPlural(n, one, few, many) {
  n = Math.round(n); const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function ltEaseOut(x) { return 1 - Math.pow(1 - x, 3); }

let ltState = null;

function ltBuildTypeMap(items) {
  const map = {};
  items.forEach((it, i) => { map[it.type] = { color: LT_TYPE_COLORS[i % LT_TYPE_COLORS.length], ring: LT_TYPE_COLORS[i % LT_TYPE_COLORS.length] + '26' }; });
  return map;
}

function ltCurrentData(period, squad) {
  if (!ltState) return { items: [], totalTasks: 0, totalDays: 0 };
  const raw = ltState.data.effort_by_type[period] || [];
  const typeMap = ltBuildTypeMap(raw);
  let totalTasks = 0, totalDays = 0;
  const items = raw.map(r => {
    let tasks = r.tasks, days = r.days;
    if (squad && squad !== 'all' && r.by_team && r.by_team[squad]) {
      tasks = r.by_team[squad].tasks;
      days = r.by_team[squad].days;
    } else if (squad && squad !== 'all') {
      tasks = 0; days = 0;
    }
    totalTasks += tasks; totalDays += days;
    return { type: r.type, tasks, days, share: 0, color: typeMap[r.type]?.color || '#94a3b8', ring: typeMap[r.type]?.ring || 'rgba(148,163,184,.18)' };
  });
  items.forEach(it => { it.share = totalDays ? it.days / totalDays * 100 : 0; });
  return { items, totalTasks, totalDays };
}

function ltRenderReport(period, squad) {
  const data = ltCurrentData(period, squad);
  const { items, totalTasks, totalDays } = data;
  const segGroup = document.getElementById('segGroup');
  const tbody = document.getElementById('repTbody');
  if (!segGroup || !tbody) return;

  segGroup.innerHTML = '';
  const arcs = items.map((it, i) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', 78);
    c.setAttribute('pathLength', '100'); c.setAttribute('class', 'arc');
    c.setAttribute('stroke', it.color); c.setAttribute('stroke-dasharray', '0 100');
    c.addEventListener('mouseenter', () => ltFocusType(i));
    c.addEventListener('mouseleave', () => ltFocusType(null));
    segGroup.appendChild(c);
    return c;
  });

  tbody.innerHTML = '';
  const rows = items.map((it, i) => {
    const tr = document.createElement('tr');
    if (it.tasks === 0 && it.days === 0) tr.classList.add('zero');
    const badge = (it.tasks > 0 && it.days === 0) ? '<span class="no-eff">нет оценки</span>' : '';
    tr.innerHTML =
      '<td><div class="t-name"><span class="dot" style="--c:' + it.color + ';--ring:' + it.ring + '"></span><span class="lbl">' + it.type + '</span>' + badge + '</div></td>' +
      '<td class="c-tasks">0</td><td class="c-days">0</td>' +
      '<td><div class="t-share"><div class="bar"><i style="--c:' + it.color + '"></i></div><span class="pct">0,0%</span></div></td>';
    tr.style.animation = 'rowIn .45s ' + (0.05 + i * 0.05) + 's both';
    tr.addEventListener('mouseenter', () => ltFocusType(i));
    tr.addEventListener('mouseleave', () => ltFocusType(null));
    tbody.appendChild(tr);
    return { el: tr, tasksEl: tr.querySelector('.c-tasks'), daysEl: tr.querySelector('.c-days'), pctEl: tr.querySelector('.pct'), barEl: tr.querySelector('.bar i'), tasks: it.tasks, days: it.days, share: it.share, label: it.type };
  });

  ltState.rows = rows; ltState.arcs = arcs;
  ltApplySort(true);

  const periodMeta = ltState.data.periods.find(p => p.id === period);
  const squadName = squad && squad !== 'all' ? squad : 'Весь трайб';
  document.getElementById('repSub').textContent = squadName + ' · ' + (periodMeta?.label || period);
  document.getElementById('dcSub').textContent = ltFmtInt(totalTasks) + ' ' + ltPlural(totalTasks, 'задача', 'задачи', 'задач');

  const maxShare = Math.max(...items.map(it => it.share), 0.0001);
  let animId = null;
  const t0 = performance.now(), DUR = 800;
  function step(now) {
    const p = Math.min(1, (now - t0) / DUR), e = ltEaseOut(p);
    let cumRun = 0;
    items.forEach((it, i) => {
      const seg = it.share * e;
      const dash = seg > 0.5 ? Math.max(seg - 1.3, 0.4) : 0;
      arcs[i].setAttribute('stroke-dasharray', dash + ' ' + (100 - dash));
      arcs[i].setAttribute('stroke-dashoffset', String(-(cumRun + 0.65)));
      cumRun += seg;
    });
    rows.forEach(r => {
      r.tasksEl.textContent = ltFmtInt(r.tasks * e);
      r.daysEl.textContent = ltFmtInt(r.days * e);
      r.pctEl.textContent = ltFmtPct(r.share * e);
      r.barEl.style.width = (r.share / maxShare * 100 * e) + '%';
    });
    document.getElementById('dcNum').textContent = ltFmtInt(totalDays * e);
    document.getElementById('tTasks').textContent = ltFmtInt(totalTasks * e);
    document.getElementById('tDays').textContent = ltFmtInt(totalDays * e);
    if (p < 1) animId = requestAnimationFrame(step);
    else {
      rows.forEach(r => { r.tasksEl.textContent = ltFmtInt(r.tasks); r.daysEl.textContent = ltFmtInt(r.days); r.pctEl.textContent = ltFmtPct(r.share); });
      document.getElementById('dcNum').textContent = ltFmtInt(totalDays);
      document.getElementById('tTasks').textContent = ltFmtInt(totalTasks);
      document.getElementById('tDays').textContent = ltFmtInt(totalDays);
    }
  }
  animId = requestAnimationFrame(step);

  let topI = 0;
  items.forEach((it, i) => { if (it.days > items[topI].days) topI = i; });
  const avg = totalTasks ? totalDays / totalTasks : 0;
  const from = ltState.prevKpi || { tasks: 0, days: 0, avg: 0 };
  const target = { tasks: totalTasks, days: totalDays, avg };
  ltState.prevKpi = target;
  const kTop = document.getElementById('kTop');
  const kTopDot = document.getElementById('kTopDot');
  const kTopPct = document.getElementById('kTopPct');
  if (kTop) kTop.textContent = items.length ? items[topI].type : '—';
  if (kTopDot) { kTopDot.style.setProperty('--c', items[topI]?.color || '#6366f1'); kTopDot.style.setProperty('--ring', items[topI]?.ring || 'rgba(99,102,241,.15)'); }
  if (kTopPct) kTopPct.textContent = ltFmtPct(items[topI]?.share || 0);

  let kpiAnim = null;
  const k0 = performance.now();
  function kstep(now) {
    const p = Math.min(1, (now - k0) / 650), e = ltEaseOut(p);
    document.getElementById('kTasks').textContent = ltFmtInt(from.tasks + (target.tasks - from.tasks) * e);
    document.getElementById('kDays').textContent = ltFmtInt(from.days + (target.days - from.days) * e);
    document.getElementById('kAvg').textContent = (from.avg + (target.avg - from.avg) * e).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (p < 1) kpiAnim = requestAnimationFrame(kstep);
  }
  kpiAnim = requestAnimationFrame(kstep);
}

function ltFocusType(i) {
  if (!ltState) return;
  (ltState.arcs || []).forEach((c, j) => { c.style.opacity = (i === null || i === j) ? '1' : '0.2'; c.style.strokeWidth = (i === j) ? '30' : '25'; });
  (ltState.rows || []).forEach((r, j) => { r.el.classList.toggle('hot', i === j); });
}

function ltApplySort(silent) {
  if (!ltState || !ltState.rows) return;
  const { rows, sortState } = ltState;
  const tbody = document.getElementById('repTbody');
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => {
    const ra = rows[a], rb = rows[b];
    if (sortState.col === 'name') return ra.label.localeCompare(rb.label, 'ru') * sortState.dir;
    let va, vb;
    if (sortState.col === 'tasks') { va = ra.tasks; vb = rb.tasks; }
    else if (sortState.col === 'days') { va = ra.days; vb = rb.days; }
    else { va = ra.share; vb = rb.share; }
    return (va - vb) * sortState.dir;
  });
  idx.forEach((i, pos) => {
    const el = rows[i].el;
    tbody.appendChild(el);
    if (!silent) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'rowIn .4s ' + (pos * 0.04) + 's both'; }
  });
  document.querySelectorAll('.rep-table th.sortable').forEach(th => {
    const col = th.getAttribute('data-col'), on = (col === sortState.col);
    th.classList.toggle('sorted', on);
    th.querySelector('.arr').textContent = on ? (sortState.dir > 0 ? '↑' : '↓') : '↕';
  });
}

function ltRenderSankey() {
  if (!ltState || !ltState.sankeyChart) return;
  const { data, sankeyState, sankeyChart } = ltState;
  const period = sankeyState.period;
  const mode = sankeyState.mode;
  const sd = data.sankey[period];
  if (!sd || !sd.links.length) {
    sankeyChart.clear();
    document.getElementById('skp-kpis').innerHTML = '<div class="skp-kpi"><div class="v">Нет данных</div><div class="l">За выбранный период</div></div>';
    return;
  }
  const unitLabel = mode === 'tasks' ? 'задач' : 'чел.-дней';
  const fmtVal = (v) => mode === 'tasks' ? Math.round(v).toLocaleString('ru-RU') : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const nodeIndex = {};
  const nodes = [];
  const present = {};
  function addNode(key, kind, idx) {
    if (present[key]) return;
    present[key] = 1;
    const dict = kind === 'c' ? sd.customers : kind === 't' ? sd.teams : sd.types;
    const color = kind === 'c' ? LT_COLORS_C : kind === 't' ? LT_COLORS_T : LT_COLORS_Y;
    nodeIndex[key] = dict[idx] || key;
    nodes.push({ name: key, skpLabel: dict[idx] || key, itemStyle: { color: color[idx % color.length], borderColor: color[idx % color.length] } });
  }

  const c2t = {}, t2y = {};
  let total = 0;
  sd.links.forEach(l => {
    const val = mode === 'tasks' ? l.tasks : l.days;
    if (val <= 0) return;
    total += val;
    if (sd.customers.includes(l.source) && sd.teams.includes(l.target)) {
      const key = l.source + '>' + l.target;
      c2t[key] = (c2t[key] || 0) + val;
      addNode(l.source, 'c', sd.customers.indexOf(l.source));
      addNode(l.target, 't', sd.teams.indexOf(l.target));
    } else {
      const key = l.source + '>' + l.target;
      t2y[key] = (t2y[key] || 0) + val;
      addNode(l.source, 't', sd.teams.indexOf(l.source));
      addNode(l.target, 'y', sd.types.indexOf(l.target));
    }
  });

  const links = [];
  Object.keys(c2t).forEach(key => {
    const p = key.split('>');
    links.push({ source: p[0], target: p[1], value: Math.round(c2t[key] * 2) / 2 });
  });
  Object.keys(t2y).forEach(key => {
    const p = key.split('>');
    links.push({ source: p[0], target: p[1], value: Math.round(t2y[key] * 2) / 2 });
  });

  let maxKey = null, maxV = 0;
  Object.keys(c2t).forEach(k => { if (c2t[k] > maxV) { maxV = c2t[k]; maxKey = k; } });
  let maxLabel = '—';
  if (maxKey) { const mp = maxKey.split('>'); maxLabel = nodeIndex[mp[0]] + ' → ' + nodeIndex[mp[1]]; }
  const teamTotals = {};
  Object.keys(t2y).forEach(k => { const t = k.split('>')[0]; teamTotals[t] = (teamTotals[t] || 0) + t2y[k]; });
  let topT = null, topTV = 0;
  Object.keys(teamTotals).forEach(t => { if (teamTotals[t] > topTV) { topTV = teamTotals[t]; topT = t; } });
  const topTeam = topT ? (nodeIndex[topT] || topT) : '—';

  document.getElementById('skp-kpis').innerHTML =
    '<div class="skp-kpi"><div class="v">' + fmtVal(total) + '</div><div class="l">Всего в потоке, ' + unitLabel + '</div></div>' +
    '<div class="skp-kpi"><div class="v">' + Object.keys(c2t).length + '</div><div class="l">Потоков заказчик → команда</div></div>' +
    '<div class="skp-kpi"><div class="v">' + maxLabel + '</div><div class="l">Крупнейший поток (' + fmtVal(maxV) + ' ' + unitLabel + ')</div></div>' +
    '<div class="skp-kpi"><div class="v">' + topTeam + '</div><div class="l">Максимальная загрузка (' + fmtVal(topTV) + ' ' + unitLabel + ')</div></div>';

  sankeyChart.setOption({
    tooltip: { trigger: 'item', formatter: function(p) {
      if (p.dataType === 'edge') return (nodeIndex[p.data.source] || p.data.source) + ' → ' + (nodeIndex[p.data.target] || p.data.target) + '<br/><b>' + fmtVal(p.data.value) + ' ' + unitLabel + '</b>';
      return '<b>' + (nodeIndex[p.data.name] || p.data.name) + '</b><br/>Объём потока: <b>' + fmtVal(p.value) + ' ' + unitLabel + '</b>';
    } },
    series: [{ type: 'sankey', data: nodes, links: links, nodeWidth: 14, nodeGap: 10, layoutIterations: 64, nodeAlign: 'justify', left: 8, right: 220, top: 16, bottom: 16, label: { show: true, fontSize: 12, color: getChartColors().textColor, formatter: function(p) { return p.data.skpLabel || p.data.name; } }, lineStyle: { color: 'gradient', opacity: 0.38, curveness: 0.5 }, itemStyle: { borderWidth: 0 }, emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.65 } } } ]
  }, true);
}

function ltRenderMap() {
  if (!ltState || !ltState.mapChart) return;
  const { data, mapState, mapChart } = ltState;
  const period = mapState.period;
  const md = data.map[period];
  const pairsBody = document.getElementById('skp-pairs-body');
  const teamsBody = document.getElementById('skp-teams-body');

  if (!md || !md.edges.length) {
    if (mapChart) mapChart.clear();
    document.getElementById('skp-map-kpis').innerHTML = '<div class="skp-kpi"><div class="v">Нет данных</div><div class="l">Вовлечённые команды не заполнены</div></div>';
    if (pairsBody) pairsBody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Нет данных</td></tr>';
    if (teamsBody) teamsBody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Нет данных</td></tr>';
    return;
  }

  const allTeams = md.teams.map(t => t.name);
  const stat = {};
  allTeams.forEach(t => { stat[t] = { asMain: 0, asPartner: 0 }; });
  const edges = {};
  let totalTasks = 0;
  md.edges.forEach(e => {
    edges[e.source + '→' + e.target] = e.count;
    totalTasks += e.count;
    if (stat[e.source]) stat[e.source].asMain += e.count;
    if (stat[e.target]) stat[e.target].asPartner += e.count;
  });

  const gNodes = allTeams.map((t, i) => {
    const total = (stat[t]?.asMain || 0) + (stat[t]?.asPartner || 0);
    const angle = (i / allTeams.length) * Math.PI * 2 - Math.PI / 2;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    let pos;
    if (cosA > 0.5) pos = 'right'; else if (cosA < -0.5) pos = 'left'; else if (sinA > 0) pos = 'bottom'; else pos = 'top';
    return { name: t, x: cosA * 100, y: sinA * 100, symbolSize: Math.min(26 + total * 2.2, 72), itemStyle: { color: LT_COLORS_M[i % LT_COLORS_M.length] }, label: { show: true, position: pos, fontSize: 12, fontWeight: 600, color: getChartColors().textColor } };
  });

  const nodeSize = {};
  gNodes.forEach(n => { nodeSize[n.name] = n.symbolSize; });
  let maxCount = 0;
  Object.keys(edges).forEach(k => { if (edges[k] > maxCount) maxCount = edges[k]; });
  const gLinks = Object.keys(edges).map(key => {
    const p = key.split('→'), count = edges[key];
    const cap = Math.min(nodeSize[p[0]] || 30, nodeSize[p[1]] || 30) * 0.65;
    const width = Math.min(1.5 + (count / maxCount) * 16, cap);
    return { source: p[0], target: p[1], value: count, lineStyle: { width, curveness: edges[p[1] + '→' + p[0]] ? 0.3 : 0.12, opacity: 0.5, color: LT_COLORS_M[allTeams.indexOf(p[0]) % LT_COLORS_M.length] }, symbol: ['none', 'arrow'], symbolSize: [0, Math.max(6, Math.min(12, width * 0.7))] };
  });

  const sorted = Object.keys(edges).map(k => ({ pair: k, count: edges[k] })).sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const topParts = top ? top.pair.split('→') : ['—', '—'];

  document.getElementById('skp-map-kpis').innerHTML =
    '<div class="skp-kpi"><div class="v">' + totalTasks + '</div><div class="l">Задач в кооперации</div></div>' +
    '<div class="skp-kpi"><div class="v">' + gLinks.length + '</div><div class="l">Уникальных взаимосвязей</div></div>' +
    '<div class="skp-kpi"><div class="v">' + topParts[0] + ' → ' + topParts[1] + '</div><div class="l">Самая частая пара (' + (top ? top.count : 0) + ' задач)</div></div>';

  if (pairsBody) {
    pairsBody.innerHTML = sorted.slice(0, 10).map((e, idx) => {
      const p = e.pair.split('→');
      return '<tr><td>' + (idx + 1) + '</td><td>' + p[0] + '</td><td>' + p[1] + '</td><td><b>' + e.count + '</b></td></tr>';
    }).join('');
  }
  if (teamsBody) {
    teamsBody.innerHTML = allTeams.map(t => {
      const s = stat[t] || { asMain: 0, asPartner: 0 };
      return '<tr><td>' + t + '</td><td>' + s.asMain + '</td><td>' + s.asPartner + '</td><td><b>' + (s.asMain + s.asPartner) + '</b></td></tr>';
    }).join('');
  }

  mapChart.setOption({
    tooltip: { formatter: function(p) {
      if (p.dataType === 'edge') return p.data.source + ' → ' + p.data.target + '<br/>Совместных задач: <b>' + p.data.value + '</b>';
      const s = stat[p.name] || { asMain: 0, asPartner: 0 };
      return '<b>' + p.name + '</b><br/>Как основная: ' + s.asMain + ' задач<br/>Как партнёр: ' + s.asPartner + ' участий';
    } },
    series: [{ type: 'graph', layout: 'none', data: gNodes, links: gLinks, directed: true, roam: false, draggable: false, left: 130, right: 210, top: 40, bottom: 40, edgeSymbol: ['none', 'arrow'], edgeLabel: { show: true, fontSize: 10, color: getChartColors().textColor, formatter: function(p) { return p.data.value; }, backgroundColor: 'var(--bg-secondary)', padding: [2, 4], borderRadius: 4 }, emphasis: { focus: 'adjacency', lineStyle: { opacity: 0.85 } } } ]
  }, true);
}

export async function initAnalytics(type, app) {
  window.__app = app;

  for (const key of Object.keys(chartInstances)) {
    chartInstances[key].destroy();
    delete chartInstances[key];
  }

  if (type === 'it') {
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (type === 'tribe') {
    if (window.lucide) window.lucide.createIcons();

    let data;
    try {
      data = await app.api.get('/tasks/analytics/lt-reports');
    } catch (e) {
      console.error('LT reports load error:', e);
      return;
    }

    ltState = { data, period: data.active_period || (data.periods[0]?.id), squad: 'all', sortState: { col: 'share', dir: -1 }, rows: [], arcs: [], prevKpi: { tasks: 0, days: 0, avg: 0 }, sankeyState: { mode: 'tasks', period: data.active_period || (data.periods[0]?.id) }, mapState: { period: data.active_period || (data.periods[0]?.id) }, sankeyChart: null, mapChart: null, teams: app.teams || [] };

    const periodSeg = document.getElementById('periodSeg');
    const skpPeriod = document.getElementById('skp-period');
    const skpMapPeriod = document.getElementById('skp-map-period');
    const n = data.periods.length;
    if (periodSeg) {
      periodSeg.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
      const thumb = document.getElementById('segThumb');
      if (thumb) thumb.style.width = 'calc(' + (100 / n) + '% - 1.2px)';
      let segHtml = '<div class="seg-thumb" id="segThumb" style="width:calc(' + (100 / n) + '% - 1.2px)"></div>';
      data.periods.forEach((p, i) => {
        const active = p.id === ltState.period ? ' active' : '';
        segHtml += '<button class="seg-btn' + active + '" data-p="' + p.id + '" type="button">' + p.label + '</button>';
      });
      periodSeg.innerHTML = segHtml;
      const activeIdx = data.periods.findIndex(p => p.id === ltState.period);
      const thumb2 = document.getElementById('segThumb');
      if (thumb2) thumb2.style.transform = 'translateX(' + (activeIdx * 100) + '%)';
    }

    if (skpPeriod) {
      skpPeriod.innerHTML = data.periods.map(p => '<button type="button" data-period="' + p.id + '"' + (p.id === ltState.sankeyState.period ? ' class="active"' : '') + '>' + p.label + '</button>').join('');
    }
    if (skpMapPeriod) {
      skpMapPeriod.innerHTML = data.periods.map(p => '<button type="button" data-period="' + p.id + '"' + (p.id === ltState.mapState.period ? ' class="active"' : '') + '>' + p.label + '</button>').join('');
    }

    const squadPanel = document.getElementById('squadPanel');
    if (squadPanel) {
      const teams = [{ id: 'all', name: 'Весь трайб' }, ...(app.teams || []).map(t => ({ id: t.name, name: t.name }))];
      squadPanel.innerHTML = teams.map(t => {
        const sel = t.id === 'all' && ltState.squad === 'all' ? ' sel' : '';
        return '<button class="dd-item' + sel + '" data-id="' + t.id + '" type="button"><span>' + t.name + '</span><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>';
      }).join('');
    }

    const ddEl = document.getElementById('squadDd');
    document.getElementById('squadBtn')?.addEventListener('click', (e) => { e.stopPropagation(); ddEl.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!ddEl?.contains(e.target)) ddEl?.classList.remove('open'); });
    squadPanel?.querySelectorAll('.dd-item').forEach(b => {
      b.addEventListener('click', () => {
        ltState.squad = b.getAttribute('data-id');
        const name = b.querySelector('span').textContent;
        document.getElementById('squadName').textContent = name;
        ddEl.classList.remove('open');
        squadPanel.querySelectorAll('.dd-item').forEach(x => x.classList.toggle('sel', x === b));
        ltRenderReport(ltState.period, ltState.squad);
      });
    });

    document.querySelectorAll('#periodSeg .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        if (ltState.period === b.getAttribute('data-p')) return;
        ltState.period = b.getAttribute('data-p');
        document.querySelectorAll('#periodSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
        const idx = Array.from(document.querySelectorAll('#periodSeg .seg-btn')).indexOf(b);
        const thumb = document.getElementById('segThumb');
        if (thumb) thumb.style.transform = 'translateX(' + (idx * 100) + '%)';
        ltRenderReport(ltState.period, ltState.squad);
      });
    });

    document.querySelectorAll('.rep-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (ltState.sortState.col === col) ltState.sortState.dir *= -1;
        else { ltState.sortState.col = col; ltState.sortState.dir = (col === 'name') ? 1 : -1; }
        ltApplySort(false);
      });
    });

    document.querySelectorAll('#skp-mode button').forEach(btn => {
      btn.addEventListener('click', () => {
        ltState.sankeyState.mode = btn.getAttribute('data-mode');
        document.querySelectorAll('#skp-mode button').forEach(b => b.classList.toggle('active', b === btn));
        ltRenderSankey();
      });
    });

    document.querySelectorAll('#skp-period button').forEach(btn => {
      btn.addEventListener('click', () => {
        ltState.sankeyState.period = btn.getAttribute('data-period');
        document.querySelectorAll('#skp-period button').forEach(b => b.classList.toggle('active', b === btn));
        ltRenderSankey();
      });
    });

    document.querySelectorAll('#skp-map-period button').forEach(btn => {
      btn.addEventListener('click', () => {
        ltState.mapState.period = btn.getAttribute('data-period');
        document.querySelectorAll('#skp-map-period button').forEach(b => b.classList.toggle('active', b === btn));
        ltRenderMap();
      });
    });

    const sankeyEl = document.getElementById('skp-sankey');
    const mapEl = document.getElementById('skp-map');
    if (sankeyEl && window.echarts) {
      ltState.sankeyChart = echarts.init(sankeyEl);
      ltRenderSankey();
    }
    if (mapEl && window.echarts) {
      ltState.mapChart = echarts.init(mapEl);
      ltRenderMap();
    }

    window.addEventListener('resize', () => {
      ltState.sankeyChart?.resize();
      ltState.mapChart?.resize();
    });

    ltRenderReport(ltState.period, ltState.squad);
    return;
  }

  let tasks = [];
  try {
    const response = await app.api.get('/tasks?per_page=1000');
    tasks = response.items || [];
  } catch (e) {
    console.error('Analytics data load error:', e);
  }

  const excelId = 'analytics-excel-popl';
  const refreshId = 'analytics-refresh-popl';

  document.getElementById(excelId)?.addEventListener('click', () => exportAnalyticsExcel(type, tasks));
  document.getElementById(refreshId)?.addEventListener('click', () => initAnalytics(type, app));

  if (window.lucide) window.lucide.createIcons();

  try {
    renderPoPlCharts(tasks);
  } catch (e) {
    console.error('Chart render error:', e);
  }
}
