import { canEditTask } from '../taskCardPermissions.js';
import { segmentedControl } from '../ui/specialized.js';
import { backlogContexts, hasTeamBacklogAccess } from '../backlogContext.js';
import { parseBacklogRoute, buildBacklogHref, withBacklogReturn } from '../backlogRouteState.js';
import { createBacklogPreferences, normalizeColumns, readBacklogSession, writeBacklogSession, importLegacyPreferences } from '../backlogPreferences.js';
import { configureToolbarPreferences, refreshToolbarViews, clearToolbarDirectories, disposeToolbar, toolbarFilterKeys, getToolbarViewState, applyToolbarViewState, DEFAULT_PINNED_FILTERS } from './filterToolbar.js?v=114';
import { openCreateTaskModal } from './modal.js?v=125';
import { canUseReportingStatusWorkspace, reportingStatusHref } from './reportingStatuses.js?v=22';
import { loadBacklogTaskPages } from '../backlogTaskLoader.js';
import { pagination as kitPagination, alert as uiAlert } from '../ui/forms.js';
import { badge as uiBadge } from '../ui/primitives.js';
import { taskStatusTone, taskPriorityTone } from '../taskDisplay.js';
import { formatCreatedDate, supplementalTaskValue } from '../taskDisplay.js';
import { taskCsv, downloadCsv } from '../taskCsv.js';
import { progress as uiProgress, tag as uiTag } from '../ui/dataDisplay.js';
console.log('[DMB] taskTable.js v20260902.1 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, getToolbarSearchValue, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader, setToolbarSortValue, isDeadlinePast, canEditTaskForScope, updateToolbarTasks, taskCountLabel } from './filterToolbar.js?v=114';
import { renderTaskCard, openTaskModal, setOnTaskSaved, importTasksFromExcel, showBulkOpsModal } from './modal.js?v=125';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';
import { clearQuickEditState, renderQuickEditToolbar, initQuickEdit, enterQuickEdit, requestExitQuickEdit, isQuickEdit, getQuickEditChanges, getQuickEditError, getQuickEditField, isEditableField, renderQuickEditCell } from './quickEdit.js?v=95';
import { disposeQuickFilters, renderQuickFilters, initQuickFilterLayout, initQuickFilters, syncQuickFilterButtons, updateQuickFilterCounts } from './quickFilters.js?v=92';
import { autoSizeColumns, applyColumnWidths, applyColumnSort, toggleSortState, headerCellHtml, registerTableInteractions, persistColumnState, readColumnState, visibleTaskColumns, scrollTableToStart } from './tableUtils.js?v=52';
import { safeExternalUrl } from '../urlUtils.js';
import { escapeHtml } from '../htmlUtils.js';
import { highlightSearchText } from '../htmlUtils.js';
import { bindViewStateAction, fitTableViewState, renderViewState } from './viewState.js';
import { formatTaskPublicId } from '../taskPublicId.js';
import { getSelectedItems, reconcileSelection, setAllSelection } from './tableSelection.js';
import { calculateTaskCv, cvZone } from '../taskMetrics.js';
import { canUseQuarterlyGoalsUpdate, quarterlyGoalsUpdateHref } from './quarterlyGoalsUpdate.js?v=12';

function renderExternalTaskLink(value, label) {
  if (label === 'Jira') {
    let links = value;
    if (typeof links === 'string') {
      try { links = JSON.parse(links); } catch { links = links.split(','); }
    }
    if (!Array.isArray(links)) links = links ? [links] : [];
    return links.filter(Boolean).map(link => {
      const url = safeExternalUrl(typeof link === 'string' ? link.trim() : '');
      return url ? `<a class="ui-entity-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Jira</a>` : 'Некорректная ссылка';
    }).join(', ') || '—';
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const url = safeExternalUrl(raw);
  return url ? `<a class="ui-entity-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : '—';
}

let tasksCache = null;
let currentView = 'table';
const ALL_DEFAULT_OVERRIDES = {
  id: true, title: true, status: true, priority: true, team: true,
  progress: window.innerWidth > 1280, financial_effect: window.innerWidth > 1440,
  effort_days: window.innerWidth > 1440, cv: window.innerWidth > 1280,
  deadline: true, owner: false, channel: false,
  department: false, task_type: false,
  key_project_status: false
};
let DMB_DEFAULT_OVERRIDES = ALL_DEFAULT_OVERRIDES;
let COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };
let columnSettings = buildColumnSettings({}, DMB_DEFAULT_OVERRIDES);
let columnOrder = getAllColumnKeys();

let currentApp = null;
let columnWidths = {};
let columnMinWidths = {};
const columnFixed = {};
const columnSort = { key: null, dir: 'asc' };
let paginationPage = 1;
const PAGE_SIZE = 100;
let generation=0, renderSuppressed=false, workspaceReady=false, dataScope='all', user=null, preferences=null, routeState=null, restoreState=null, lastPublished='', pendingController=null, stale=false, deferredRefresh=false, initialized=false;
let activeCleanup=[];
let workspaceError='';
let memoryWarning='';
let viewBaseline=null, selectedViewId='', columnProvenance='defaults';

let autoRefreshTimer = null;
let keyboardHandler = null;
let tasksLoadInProgress = false;
let tasksReloadQueued = false;
let backlogOperationsMenuCleanup = null;
const backlogSelectedTaskIds = new Set();
const TERMINAL_STATUSES = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];

export function renderBacklogPage(app) {
  disposeBacklogPage();
  currentApp=app; user=app.store.get('currentUser');
  document.addEventListener('dmb:session-ended',disposeBacklogPage,{once:true});activeCleanup.push(()=>document.removeEventListener('dmb:session-ended',disposeBacklogPage));
  routeState=parseBacklogRoute(window.location.hash,toolbarFilterKeys());
  if(!routeState.params.has('scope')&&!routeState.explicit&&routeState.scope==='all'&&!backlogContexts(user).includes('all')&&backlogContexts(user).includes('team'))routeState.scope='team';
  dataScope=routeState.scope;
  workspaceError=routeState.errors.join(' · ');
  if(!backlogContexts(user).includes(dataScope)) workspaceError=dataScope==='team'&&hasTeamBacklogAccess(user)&&!user?.team_id?'Команда не назначена':'Область недоступна';
  if(workspaceError) return `<section><h1>Бэклог</h1>${renderViewState({kind:'error',title:workspaceError,message:'Выберите доступную область или исправьте параметры адреса.'})}${scopeMarkup()}</section>`;
  preferences=createBacklogPreferences(user,{onWarning:message=>{memoryWarning=message;const el=document.getElementById('backlog-storage-warning');if(el){el.textContent=message;el.hidden=false;}}});
  const context=preferences.context(dataScope);
  if(dataScope==='team'&&context.teamId!=null&&context.teamId!==user.team_id){const changedTeam=user.team_id;preferences.update(d=>{d.contexts.team.teamId=changedTeam;d.contexts.team.views.defaultId=null;});}
  columnProvenance=context.columnSource||(Object.keys(context.columns||{}).length?'user':'defaults');
  restoreState=routeState.explicit?{toolbar:routeState.toolbar,page:routeState.page}:readBacklogSession(user,dataScope);
  if(dataScope==='team'&&context.teamId!=null&&context.teamId!==user.team_id)restoreState=routeState.explicit?restoreState:null;
  DMB_DEFAULT_OVERRIDES=dataScope==='team'?{owner:true,team:false,financial_effect:false,effort_days:false,cv:false}:ALL_DEFAULT_OVERRIDES;
  columnSettings=buildColumnSettings({},DMB_DEFAULT_OVERRIDES);columnOrder=getAllColumnKeys();columnWidths={};columnMinWidths={};Object.keys(columnFixed).forEach(k=>delete columnFixed[k]);columnSort.key=null;columnSort.dir='asc';currentView='table';paginationPage=1;tasksCache=null;
  applyToolbarViewState('backlog',restoreState?.toolbar||{});
  configureToolbarPreferences('backlog',preferenceAdapter());

  return `
    ${renderToolbar('backlog', {
      title: 'Бэклог',
      actionsPrefix:scopeMarkup(),
      keepTitleContextInline: true,
      subtitle: '',
      canWrite: canCreate(),
      addTask: true,
      columnSettings,
      columnOrder,
      columnLabels: COLUMN_LABELS,
      onImport: true,
      excel: true,
      onQuickEdit: true,
      onBulkOps: true,
      bulkOpsMenu: true,
      bulkOpsTitle: 'Операции',
      savedViews: true,
      uniformPrimaryActions: true,
      quickFilters: renderQuickFilters('backlog', { loading: true }),
    })}

    <div id="tasks-content" data-ready="false">
    <p id="backlog-storage-warning" role="status" hidden></p>
    <div id="backlog-stale" class="ui-registry-notice" role="status" aria-live="polite" hidden></div>
      <div id="backlog-bulk-actions" class="flex items-center gap-3" style="margin-bottom:var(--space-4);display:none;">
        <span class="text-secondary">Выбрано: <strong id="backlog-selected-count">0</strong></span>
        <button class="btn btn-secondary btn-sm" id="backlog-bulk-selected">Массовые операции (0)</button>
      </div>

      ${renderQuickEditToolbar('backlog')}

      <div id="tasks-container">
        ${renderTasksTableStateMarkup({ kind: 'loading', title: 'Загружаем задачи…' })}
      </div>
    </div>

    <div class="flex justify-between items-center pagination-footer" style="margin-top: var(--space-6);">
      <span class="text-secondary" id="tasks-count" role="status" aria-live="polite"></span>
      <div class="flex gap-2" id="pagination"></div>
    </div>
  `;
}

async function applyDefaultDisplaySettings(app) {
  try {
    const resp = await app.api.get('/admin/display-settings/shared');
    if (resp && resp.settings) {
      const savedKeys = Object.keys(resp.settings);
      if (savedKeys.length > 0) {
        const validKeys = new Set(getAllColumnKeys());
        const KEY_MAP = { financial: 'financial_effect', effort: 'effort_days' };
        const newSettings = {};
        savedKeys.forEach(key => {
          const mapped = KEY_MAP[key] || key;
          if (validKeys.has(mapped) && resp.settings[key] !== undefined) {
            newSettings[mapped] = resp.settings[key];
          }
        });
        columnSettings = buildColumnSettings(newSettings, DMB_DEFAULT_OVERRIDES);
        columnOrder = getAllColumnKeys();
      }
    }
  } catch (e) {
    console.log('[DMB] No display settings, using defaults');
  }
}

export async function initBacklogPage(app) {
  if(workspaceError) { bindScopeControls(); return; }
  bindScopeControls();renderSuppressed=true;
  const onAccessDenied=()=>recheckBacklogAccess();document.addEventListener('dmb:task-access-denied',onAccessDenied);activeCleanup.push(()=>document.removeEventListener('dmb:task-access-denied',onAccessDenied));
  const onCardRender=e=>markTaskOutside(e.detail?.taskId);document.addEventListener('task-card-rendered',onCardRender);activeCleanup.push(()=>document.removeEventListener('task-card-rendered',onCardRender));
  const mountGeneration=generation;
  backlogSelectedTaskIds.clear();
  initQuickFilterLayout();
  COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };
  await applyDefaultDisplaySettings(app);
  if(mountGeneration!==generation)return;
  loadBacklogColumnState();
  renderTasksTableState({ kind: 'loading', title: 'Загружаем задачи…' });
  await loadTasks(app);
  if (mountGeneration!==generation || !isBacklogRouteActive()) return;

  function onFilterChange() {
    paginationPage = 1;
    syncQuickFilterButtons('backlog');
    renderCurrentView();
  }

  const tasks = tasksCache?.items || [];
  initToolbar('backlog', tasks, onFilterChange);

  initQuickFilters('backlog', () => tasksCache?.items || []);

  initToolbarControls('backlog', {
    columnSettings,
    columnOrder,
    columnLabels: COLUMN_LABELS,
    defaultColumnSettings: buildColumnSettings({}, DMB_DEFAULT_OVERRIDES),
    onViewChange: async (view) => {
      if (view !== currentView && isQuickEdit('backlog') && !(await requestExitQuickEdit('backlog'))) return false;
      currentView = view; renderCurrentView(); return true;
    },
    onColumnChange: () => { saveBacklogColumnState(true); renderCurrentView(); },
    onColumnOrderChange: () => { saveBacklogColumnState(true); renderCurrentView(); },
    onColumnReset:()=>{columnOrder.splice(0,columnOrder.length,...getAllColumnKeys());columnWidths={};Object.keys(columnFixed).forEach(k=>delete columnFixed[k]);saveBacklogColumnState(true);renderCurrentView();},
    onExport: () => { if(stale||!tasksCache)return window.toast?.('Полная актуальная выборка ещё не загружена','warning'); if(isQuickEdit('backlog'))window.toast?.('Экспортируются сохранённые данные','info'); exportExcel(getFilteredList()); },
    onImport: async () => { if(!isQuickEdit('backlog')||await requestExitQuickEdit('backlog')) importTasksFromExcel(app,()=>loadTasks(app)); },
    onAddTask: () => openCreateTaskModal(app,{teamId: createTeamId()}),
    onRefresh: () => refreshBacklogPage(),
    onQuickEdit: () => { if (currentView === 'table') { if (isQuickEdit('backlog')) { requestExitQuickEdit('backlog'); } else { enterQuickEdit('backlog'); } } },
    onBulkOps: () => { if (currentView === 'table') openBacklogOperationsMenu(app); },
    showSavedViewRevert: false,
    beforeApplySavedView: () => !isQuickEdit('backlog') || requestExitQuickEdit('backlog'),
    getSavedViewState: () => ({
      view: currentView,
      columns: { ...columnSettings },
      columnOrder: [...columnOrder],
      widths: { ...columnWidths },
      fixed: { ...columnFixed },
      columnSort: { ...columnSort },
    }),
    applySavedViewState: applyBacklogSavedViewState,
  });

  const onSaved=()=>{if(mountGeneration===generation)return loadTasks(app);};
  setOnTaskSaved(onSaved);

  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (!isBacklogRouteActive()) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      return;
    }
    refreshBacklogPage();
  }, 60000);

  if (keyboardHandler) window.removeEventListener('keydown', keyboardHandler);
  keyboardHandler = (e) => {
    if (e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||[...document.querySelectorAll('[role=dialog],[role=menu],.filter-dropdown,.saved-view-dropdown,.column-settings-dropdown')].some(el=>el.getClientRects().length)) return;
    const tag = document.activeElement?.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (e.key === '/' && !editing) {
      e.preventDefault();
      document.getElementById('f-backlog-search')?.focus();
    } else if (e.key.toLowerCase() === 'r' && !editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      refreshBacklogPage();
    }
  };
  window.addEventListener('keydown', keyboardHandler);

  initQuickEdit('backlog', {
    app: currentApp,
    getTasks: () => tasksCache?.items || [],
    getColumnLabel,
    renderView: renderCurrentView,
    afterSave: () => loadTasks(currentApp),
    onAccessDenied: recheckBacklogAccess,
    canEditTask: task => canEditTask(currentApp?.store.get('currentUser'),task),
    tableContainer: '#tasks-container .table-container',
  });

  registerTableInteractions('tasks-table', {
    getWidths: () => columnWidths,
    getMinWidths: () => columnMinWidths,
    getLayout: () => ({ cols: visibleTaskColumns(columnOrder, columnSettings), offset: isQuickEdit('backlog') ? 0 : 1 }),
    getFixed: () => columnFixed,
    onResizeEnd: () => saveBacklogColumnState(true),
    onUnfix: () => { saveBacklogColumnState(true); renderCurrentView(); },
    onSort: (key) => {
      toggleSortState(columnSort, key);
      paginationPage = 1;
      setToolbarSortValue('backlog', 'id-desc');
      saveBacklogColumnState();
      renderCurrentView();
    },
  });

  if(restoreState){
    applyBacklogSavedViewState(restoreState.page||{});
  }
  workspaceReady=true;initialized=true;renderSuppressed=false;
  if(memoryWarning){const el=document.getElementById('backlog-storage-warning');if(el){el.textContent=memoryWarning;el.hidden=false;}}
  const mountedScope=dataScope, mountedTeam=user.team_id;
  preferences.update(d=>{d.lastScope=mountedScope;if(mountedScope==='team')d.contexts.team.teamId=mountedTeam;});
  if(tasksCache)renderCurrentView();
  document.getElementById('tasks-content')?.setAttribute('data-ready','true');
  const scrollEl=document.querySelector('#tasks-container .table-container');if(scrollEl)scrollEl.scrollLeft=restoreState?.page?.scrollX||0;
  const main=document.querySelector('.main-content');if(main)main.scrollTop=restoreState?.page?.scrollY||0;
  const deferredTimer=setInterval(()=>{if(deferredRefresh&&!document.hidden&&!isBacklogInteractionActive()&&!tasksLoadInProgress){deferredRefresh=false;refreshBacklogPage();}},1000);activeCleanup.push(()=>clearInterval(deferredTimer));
  const onVisibility=()=>{if(!document.hidden&&stale)refreshBacklogPage();};
  document.addEventListener('visibilitychange',onVisibility);activeCleanup.push(()=>document.removeEventListener('visibilitychange',onVisibility));
  const onStorage=e=>{if(e.key===`dmb_backlog_workspace_v2:${user.id}`){if(!stale)showBacklogNotice('preferences');if(!document.activeElement?.closest('.saved-view-rename-editor'))refreshToolbarViews('backlog');}};
  window.addEventListener('storage',onStorage);activeCleanup.push(()=>window.removeEventListener('storage',onStorage));
}

function getColumnLabel(key) {
  return COLUMN_LABELS[key] || key;
}

function saveBacklogColumnState(customized = false) {
 if(!preferences||!workspaceReady)return;
 const scope=dataScope;const value=normalizeColumns({settings:columnSettings,order:columnOrder,widths:columnWidths,fixed:columnFixed,sort:columnSort});
 if(JSON.stringify(preferences.context(scope).columns)===JSON.stringify(value))return;
 const source=customized?'user':columnProvenance;columnProvenance=source;
 preferences.update(d=>{d.contexts[scope].columns=value;d.contexts[scope].columnSource=source;});
}

function loadBacklogColumnState() {
  const st = preferences?.context(dataScope).columns;
  if (!st) return;
  const validKeys = new Set(getAllColumnKeys());
  if (st.settings) {
    const newSettings = {};
    Object.keys(st.settings).forEach(k => { if (validKeys.has(k)) newSettings[k] = st.settings[k]; });
    columnSettings = buildColumnSettings(newSettings, columnSettings);
  }
  if (Array.isArray(st.order)) columnOrder = ['id',...new Set([...st.order,...getAllColumnKeys()].filter(k=>validKeys.has(k)&&k!=='id'))];
  if (st.widths) {
    columnWidths = {};
    Object.keys(st.widths).forEach(k => { columnWidths[k] = st.widths[k]; });
  }
  if (st.fixed) {
    Object.keys(columnFixed).forEach(k => delete columnFixed[k]);
    Object.keys(st.fixed).forEach(k => { if (st.fixed[k]) columnFixed[k] = st.fixed[k] === true ? (columnWidths[k] || 90) : st.fixed[k]; });
  }
  if (st.sort && st.sort.key) {
    columnSort.key = st.sort.key;
    columnSort.dir = st.sort.dir || 'asc';
  }
}

function renderSkeletonRows(count) {
  return Array.from({ length: count }, () => `
    <tr class="skeleton-row">
      <td><div class="skeleton skeleton-block w-30"></div></td>
      <td><div class="skeleton skeleton-block w-80"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-30"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
    </tr>
  `).join('');
}

function showBacklogNotice(kind = 'error') {
  const notice = document.getElementById('backlog-stale');
  if (!notice) return;
  const states = {
    error: ['Данные могут быть неактуальны', 'Не удалось обновить список задач.', 'warning', true],
    deferred: ['Обновление отложено', 'Список обновится после завершения редактирования и снятия выделения задач.', 'info', false],
    unknown: ['Результат операции не подтверждён', 'Обновите список задач перед повтором массовой операции.', 'warning', true],
    preferences: ['Настройки изменились в другой вкладке', 'Список сохранённых представлений обновлён.', 'info', false],
    access: ['Не удалось проверить доступ', 'Данные могут быть неактуальны. Повторите обновление списка.', 'warning', true],
  };
  const [title, message, tone, actionable] = states[kind] || states.error;
  notice.innerHTML = uiAlert({ title, message, tone, variant: 'inline', action: actionable ? { label: 'Обновить', attrs: { 'data-backlog-retry': '' } } : null });
  notice.hidden = false;
  notice.querySelector('[data-backlog-retry]')?.addEventListener('click', () => refreshBacklogPage());
  window.lucide?.createIcons();
}

function setBacklogNoticeLoading(loading) {
  const button = document.querySelector('#backlog-stale [data-backlog-retry]');
  if (!button) return;
  button.disabled = loading;
  button.setAttribute('aria-busy', String(loading));
  button.querySelector('span').textContent = loading ? 'Обновляем…' : 'Обновить';
}

async function loadTasks(app) {
  if (tasksLoadInProgress) {
    tasksReloadQueued = true;
    return;
  }
  tasksLoadInProgress = true;
  setBacklogNoticeLoading(true);
  const requestGeneration=generation;
  const existingContainer = document.getElementById('tasks-container');
  if (!tasksCache || existingContainer?.querySelector('.view-state-error')) {
    renderTasksTableState({ kind: 'loading', title: 'Загружаем задачи…' });
    const countEl = document.getElementById('tasks-count');
    if (countEl) countEl.textContent = '';
  }
  try {
    const data = await loadAllTaskPages(app, dataScope==='team'?`team_id=${encodeURIComponent(user.team_id)}`:'');
    if(requestGeneration!==generation)return;
    tasksCache = data; stale=false;
    const notice = document.getElementById('backlog-stale');
    if (notice?.contains(document.activeElement)) document.getElementById('backlog-btn-refresh')?.focus({ preventScroll: true });
    notice?.setAttribute('hidden','');
    renderCurrentView();

  } catch (e) {
    if(requestGeneration!==generation||e?.name === 'AbortError')return;
    stale=true;
    const container = document.getElementById('tasks-container');
    if(tasksCache){const retryFocused=document.getElementById('backlog-stale')?.contains(document.activeElement);showBacklogNotice('error');if(retryFocused)document.querySelector('[data-backlog-retry]')?.focus({preventScroll:true});renderCurrentView();return;}
    if (container) {
      renderTasksTableState({
        kind: 'error',
        message: window.formatErrorMessage?.(e) || 'Повторите попытку позже.',
        actionLabel: 'Повторить',
      });
      bindViewStateAction(container, () => loadTasks(app));
    }
    const countEl = document.getElementById('tasks-count');
    if (countEl) countEl.textContent = 'Не удалось загрузить задачи';
    const pagination = document.getElementById('pagination');
    if (pagination) pagination.innerHTML = '';
  } finally {
    if(requestGeneration!==generation)return;
    tasksLoadInProgress = false;
    setBacklogNoticeLoading(false);
    if (tasksReloadQueued) {
      tasksReloadQueued = false;
      if (isBacklogRouteActive()) await loadTasks(app);
    }
  }
}

function isBacklogRouteActive() {
  return (window.location.hash.slice(1).split('?')[0] || '/') === '/backlog';
}

function isBacklogInteractionActive() {
  return isQuickEdit('backlog')
    || backlogSelectedTaskIds.size > 0
    || document.getElementById('task-detail-overlay') !== null
    || document.getElementById('create-task-overlay') !== null
    || document.getElementById('bulk-modal-overlay') !== null
    || document.getElementById('bulk-result-overlay') !== null;
}

function applyBacklogSavedViewState(state = {}) {
  const previousReady=workspaceReady;workspaceReady=false;
  if(state.paginationPage)paginationPage=state.paginationPage;
  if (state.view === 'table' || state.view === 'cards') currentView = state.view;
  if (state.columns) {
    Object.keys(columnSettings).forEach(key => { if(state.columns[key]!==undefined)columnSettings[key] = !!state.columns[key]; });
  }
  if (Array.isArray(state.columnOrder)) {
    const valid = new Set(getAllColumnKeys());
    const savedOrder = state.columnOrder.filter(key => valid.has(key));
    columnOrder.splice(0, columnOrder.length, ...savedOrder, ...getAllColumnKeys().filter(key => !savedOrder.includes(key)));
  }
  columnSettings.id=true;columnOrder.splice(0,columnOrder.length,'id',...columnOrder.filter(k=>k!=='id'));
  if(state.widths)columnWidths = { ...state.widths };
  if(state.fixed){Object.keys(columnFixed).forEach(key => delete columnFixed[key]);Object.entries(state.fixed).forEach(([key,value])=>{if(value)columnFixed[key]=value===true?(columnWidths[key]||90):value;});}
  columnSort.key = state.columnSort?.key || null;
  columnSort.dir = state.columnSort?.dir || 'asc';
  document.querySelectorAll('#backlog-view-toggle-group [data-view]').forEach(button => {button.classList.toggle('active', button.dataset.view === currentView);button.setAttribute('aria-pressed',String(button.dataset.view === currentView));});
  saveBacklogColumnState();
  renderCurrentView();
  workspaceReady=previousReady;
}

async function loadAllTaskPages(app, extraQuery) {
  pendingController?.abort();pendingController=new AbortController();
  const key=()=>`${app.store.get('currentUser')?.id}:${app.store.get('currentUser')?.team_id}:${dataScope}:${generation}:${JSON.stringify(app.store.get('currentUser')?.permissions)}`;
  return loadBacklogTaskPages(app, extraQuery, '/backlog',{signal:pendingController.signal,contextKey:key});
}

function getFilteredList() {
  if (!tasksCache) return [];
  let list = ftFilteredList('backlog', tasksCache.items || []);
  if (columnSort.key) list = applyColumnSort(list, columnSort.key, columnSort.dir);
  return list;
}

function renderCurrentView() {
  if(renderSuppressed)return;
  const previousScrollX=document.querySelector('#tasks-container .table-container')?.scrollLeft||0;
  const focusedElement=document.activeElement,focusedTask=focusedElement?.closest('#tasks-table tr[data-task-id],#tasks-container .task-card[data-id]');
  const focusedTaskId=focusedTask?.dataset.taskId||focusedTask?.dataset.id;
  updateQuickFilterCounts('backlog', tasksCache?.items || []);
  const list = getFilteredList();
  updateToolbarTasks('backlog', tasksCache?.items || [], list);
  reconcileSelection(backlogSelectedTaskIds, list, task => canEditTaskForScope('backlog', task));
  const countEl = document.getElementById('tasks-count');
  if (countEl) countEl.textContent = taskCountLabel(list.length);
  document.querySelector('#quick-filters')?.setAttribute('title','В выбранной области, до остальных фильтров. Несколько быстрых условий объединяются через И.');
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (paginationPage > totalPages) paginationPage = totalPages;
  const pageList = list.slice((paginationPage - 1) * PAGE_SIZE, paginationPage * PAGE_SIZE);
  if (currentView === 'cards') {
    renderCardView(pageList);
  } else {
    renderTableView(pageList);
  }
  const nextScroller=document.querySelector('#tasks-container .table-container');if(nextScroller)nextScroller.scrollLeft=previousScrollX;
  renderPagination(totalPages);
  publishState();markTaskOutside();
  if(focusedTaskId&&!focusedElement.isConnected){const row=document.querySelector(`#tasks-table tr[data-task-id="${focusedTaskId}"],#tasks-container .task-card[data-id="${focusedTaskId}"]`);const field=focusedElement.dataset.field;const target=(field&&row?.querySelector(`[data-field="${CSS.escape(field)}"]`))||(focusedElement.matches('input[type=checkbox]')&&row?.querySelector('input[type=checkbox]'))||row?.querySelector('a[href],[data-open-task]')||row||document.getElementById('tasks-count');if(target){if(!target.matches('a[href],button,input,select,textarea')&&!target.hasAttribute('tabindex')){target.tabIndex=-1;target.addEventListener('blur',()=>target.removeAttribute('tabindex'),{once:true});}target.focus({preventScroll:true});}}
  const exportButton=document.getElementById('backlog-export-excel');if(exportButton){exportButton.disabled=stale||!tasksCache||!list.length;exportButton.title=stale?'Выборка требует успешного обновления':!list.length?'Нет задач для экспорта':'Экспорт текущей выборки';}
  const dirty=Object.keys(getQuickEditChanges('backlog')||{});const visible=new Set(list.map(t=>String(t.id)));
  const hidden=dirty.filter(id=>!visible.has(String(id))).length;
  if(hidden) { const el=document.getElementById('qe-count-backlog'); if(el)el.textContent+=` · Вне выборки: ${hidden}`; }
}

function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = kitPagination({page:paginationPage,pages:totalPages,label:'Страницы бэклога'});
  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      paginationPage = parseInt(btn.dataset.page);
      renderCurrentView();
      scrollTableToStart('tasks-container');
    });
  });
}

function renderTableView(list) {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  const visibleCols = visibleTaskColumns(columnOrder, columnSettings);
  const showCheckbox = !isQuickEdit('backlog') && getFilteredList().some(task => canEditTaskForScope('backlog', task));

  const hasWidths = visibleCols.every(c => columnWidths[c]);

  const colgroupHtml = visibleCols.map((col, i) => {
    const w = columnWidths[col] ? `width:${columnWidths[col]}px;` : '';
    return `<col style="${w}">`;
  }).join('');

  const checkboxCol = showCheckbox ? '<col style="width:40px;">' : '';
  const tableStyle = hasWidths ? 'table-layout:fixed;' : '';

  container.innerHTML = `
    <div class="table-container" style="overflow-x:auto;">
      <table class="ui-table ui-table-data table" data-ui-table="registry" id="tasks-table" style="${tableStyle}">
        <colgroup>${checkboxCol}${colgroupHtml}</colgroup>
        <thead>
          <tr>
            ${showCheckbox ? '<th class="table-selection-cell"><input type="checkbox" id="backlog-select-all" aria-label="Выбрать все отфильтрованные задачи"></th>' : ''}
            ${visibleCols.map(col => headerCellHtml(getColumnLabel(col), col, columnSort.key, columnSort.dir)).join('')}
          </tr>
        </thead>
        <tbody id="tasks-tbody">
          ${list.length === 0
            ? '<tr><td class="table-view-state-cell" colspan="' + (visibleCols.length + (showCheckbox ? 1 : 0)) + '">' + renderViewState({ kind: 'empty', title: 'Задачи не найдены', message: emptyBacklogMessage() }) + '</td></tr>'
            : list.map(task => renderTableRow(task, visibleCols, showCheckbox)).join('')}
        </tbody>
      </table>
    </div>
  `;

  {
    const table = document.getElementById('tasks-table');
    if (!hasWidths) {
      autoSizeColumns(table, visibleCols, columnWidths, columnMinWidths, { offset: showCheckbox ? 1 : 0 });
    }
    applyColumnWidths(table, visibleCols, columnWidths, { offset: showCheckbox ? 1 : 0, fixed: columnFixed });
    saveBacklogColumnState();
  }

  fitTableViewState(container);
  updateStickyOffsets();
  initStickyTableHeader('tasks-table');

  if (!isQuickEdit('backlog')) {
    bindBacklogSelection();
    document.getElementById('tasks-tbody')?.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.backlog-task-checkbox, input, button, a')) return;
        const t = list.find(x => x.id == tr.dataset.taskId);
        if (t) openTaskModal(t);
      });
    });
  }
}

function renderCell(col, task) {
  if (isQuickEdit('backlog') && canEditTaskForScope('backlog', task) && isEditableField(col)) {
    return renderQuickEditCell('backlog', col, task);
  }

  const supplemental = supplementalTaskValue(col, task);
  if (supplemental !== undefined) return `<span class="cell-truncate">${escapeHtml(supplemental)}</span>`;
  const highlight = value => highlightSearchText(value, getToolbarSearchValue('backlog'));
  switch (col) {
    case 'id': return `<span class="task-id-cell"><span class="font-mono" title="${escapeHtml(formatTaskPublicId(task))}">${highlight(formatTaskPublicId(task))}</span><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn" data-copy-task-id="${escapeHtml(formatTaskPublicId(task))}" aria-label="Копировать ${escapeHtml(formatTaskPublicId(task))}" title="Копировать ID">⧉</button></span>`;
    case 'title': return `<a class="cell-truncate ui-table-title" title="${escapeHtml(task.title)}" href="${escapeHtml(buildBacklogHref(dataScope,{toolbar:getToolbarViewState('backlog'),page:pageState()},{task:task.id}))}" aria-label="Открыть задачу: ${escapeHtml(task.title)}">${highlight(task.title)}</a>`;
    case 'description': return `<span class="cell-truncate">${highlight(task.description || '—')}</span>`;
    case 'date_received': return `<span>${escapeHtml(task.date_received || '—')}</span>`;
    case 'status': return `<span>${renderStatus(task.status_name || task.status)}</span>`;
    case 'priority': return `<span>${renderPriority(task.priority_name || task.priority)}</span>`;
    case 'team': return `<span class="badge badge-info">${escapeHtml(task.team_name || '—')}</span>`;
    case 'channel': return `<span>${escapeHtml(task.channel_name || '—')}</span>`;
    case 'did_client_group': return `<span>${escapeHtml(task.did_client_group_name || '—')}</span>`;
    case 'business_customer': return `<span>${escapeHtml(task.business_customer_name || task.business_customer || '—')}</span>`;
    case 'department': return `<span>${escapeHtml(task.department_name || '—')}</span>`;
    case 'project': return `<span>${escapeHtml(task.project_name || '—')}</span>`;
    case 'task_type': return `<span>${escapeHtml(task.task_type_name || '—')}</span>`;
    case 'involved_teams': return `<span class="cell-truncate">${escapeHtml(resolveInvolvedTeams(task.involved_team_names || task.involved_teams))}</span>`;
    case 'deadline': return `<span>${renderDeadline(task)}</span>`;
    case 'deadline_po': return `<span>${escapeHtml(task.deadline_po_name || '—')}</span>`;
    case 'effort_days': return `<span>${task.effort_days != null ? task.effort_days + ' дн' : '—'}</span>`;
    case 'effort_rub': return `<span class="font-mono">${metricFormat(task.effort_rub)}</span>`;
    case 'effort_designee':
    case 'effort_analytics':
    case 'effort_be':
    case 'effort_python_be':
    case 'effort_fe':
    case 'effort_test':
    case 'effort_test_auto':
    case 'effort_delivery':
    case 'actual_effort_days':
    case 'actual_effort_designee':
    case 'actual_effort_analytics':
    case 'actual_effort_be':
    case 'actual_effort_python_be':
    case 'actual_effort_fe':
    case 'actual_effort_test':
    case 'actual_effort_test_auto':
    case 'actual_effort_delivery':
        return `<span class="font-mono">${task[col] != null && task[col] !== '' ? metricFormat(task[col]) : '—'}</span>`;
    case 'financial_effect': return `<span class="font-mono">${metricFormat(task.financial_effect)}</span>`;
    case 'cv': return `<span>${renderCV(task)}</span>`;
    case 'progress': return `<span>${renderProgress(task.progress)}</span>`;
    case 'owner': return `<span>${escapeHtml(task.owner_name || task.owner || '—')}</span>`;
    case 'key_project_status': return `<span class="cell-truncate">${escapeHtml(task.key_project_status || '—')}</span>`;
    case 'directorate_status': return `<span class="cell-truncate">${escapeHtml(task.directorate_status || '—')}</span>`;
    case 'did_status': return `<span class="cell-truncate">${escapeHtml(task.did_status || '—')}</span>`;
    case 'link_mockups': return `<span>${renderExternalTaskLink(task.link_mockups, 'Макеты')}</span>`;
    case 'link_jira': return `<span>${renderExternalTaskLink(task.link_jira, 'Jira')}</span>`;
    case 'rejection_reason': return `<span class="cell-truncate">${escapeHtml(task.rejection_reason || '—')}</span>`;
    case 'comment': return `<span class="cell-truncate">${escapeHtml(task.comment || '—')}</span>`;
    case 'created_at': return `<span>${escapeHtml(formatCreatedDate(task.created_at))}</span>`;
    case 'updated_at': return `<span>${escapeHtml(task.updated_at || '—')}</span>`;
    case 'metric_kr_plan':
    case 'metric_kr_fact': return `<span class="font-mono">${metricFormat(task[col])}${task.metric_kr_unit ? ' ' + task.metric_kr_unit : ''}</span>`;
    case 'metric_kr_unit': return `<span>${escapeHtml(task.metric_kr_unit || '—')}</span>`;
    case 'tags': return renderTags(task.tags);
    default: return '';
  }
}

function renderTasksTableStateMarkup(state) {
  const visibleCols = visibleTaskColumns(columnOrder, columnSettings);
  const colspan = Math.max(1, visibleCols.length);
  return `
    <div class="table-container" style="overflow-x:auto;">
      <table class="ui-table ui-table-data table" data-ui-table="registry" id="tasks-table" aria-busy="${state.kind === 'loading'}">
        <thead>
          <tr>${visibleCols.map(col => headerCellHtml(getColumnLabel(col), col, columnSort.key, columnSort.dir)).join('')}</tr>
        </thead>
        <tbody id="tasks-tbody" aria-live="polite">
          <tr><td class="table-view-state-cell" colspan="${colspan}">${renderViewState(state)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderTasksTableState(state) {
  const container = document.getElementById('tasks-container');
  if (!container) return;
  container.innerHTML = renderTasksTableStateMarkup(state);
  fitTableViewState(container);
  updateStickyOffsets();
  initStickyTableHeader('tasks-table');
  window.lucide?.createIcons();
}

function resolveInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  const items = Array.isArray(teams) ? teams : (() => {
    if (typeof teams === 'string') {
      const trimmed = teams.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch (_) {}
      }
      return trimmed.split(',').map(x => x.trim()).filter(Boolean);
    }
    return [teams];
  })();
  if (!items.length) return '—';
  if (!Array.isArray(items)) return '—';
  const teamNames = (window.app?.teams || []).map(team => ({ id: Number(team.id), name: team.name || '' }));
  const map = new Map(teamNames.map(x => [x.id, x.name]));
  return items.map(v => {
    const key = Number(v);
    return Number.isNaN(key) ? String(v) : (map.get(key) || String(v));
  }).join(', ');
}

function renderTableRow(task, cols, showCheckbox) {
  const changes = getQuickEditChanges('backlog');
  const saveError = getQuickEditError('backlog', task.id);
  const cells = cols.map(col => {
    const field = getQuickEditField(col);
    const change = changes[task.id]?.[field];
    const isChanged = !!change;
    const cellStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';
    return `<td style="${cellStyle}">${renderCell(col, task)}</td>`;
  });
  const hasChanges = changes[task.id] && Object.keys(changes[task.id]).length > 0;
  const rowStyle = saveError
    ? `cursor:default;border-left:3px solid var(--danger);background:rgba(239,68,68,.06);`
    : hasChanges
    ? `cursor:default;border-left:3px solid var(--warning);`
    : (isQuickEdit('backlog') ? 'cursor:default;' : 'cursor:pointer;');
  const checkboxHtml = showCheckbox ? `<td class="table-selection-cell">${canEditTaskForScope('backlog', task) ? `<input type="checkbox" class="backlog-task-checkbox" value="${task.id}" aria-label="Выбрать задачу ${task.id}" ${backlogSelectedTaskIds.has(Number(task.id)) ? 'checked' : ''}>` : '<span title="Нет прав на изменение этой задачи" style="color:var(--text-muted);">—</span>'}</td>` : '';
  const errorCell = saveError && cells.length > 0
    ? cells.map((cell, index) => index === 0
      ? cell.replace('>', ` title="${escapeHtml(saveError)}">⚠ `).replace('</td>', `<div style="margin-top:4px;color:var(--danger);font-size:var(--type-meta-size);line-height:var(--type-meta-line);white-space:normal;">${escapeHtml(saveError)}</div></td>`)
      : cell)
    : cells;
  return `<tr data-task-id="${task.id}" style="${rowStyle}" ${saveError ? `aria-label="Ошибка сохранения: ${escapeHtml(saveError)}"` : ''}>${checkboxHtml}${errorCell.join('')}</tr>`;
}

function getBacklogSelectedTasks() {
  return getSelectedItems(backlogSelectedTaskIds, getFilteredList());
}

function updateBacklogBulkBar() {
  const editable = getFilteredList().filter(task => canEditTaskForScope('backlog', task));
  reconcileSelection(backlogSelectedTaskIds, editable);
  const count = backlogSelectedTaskIds.size;
  const bar = document.getElementById('backlog-bulk-actions');
  if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('backlog-selected-count');
  if (countEl) countEl.textContent = String(count);
  const action = document.getElementById('backlog-bulk-selected');
  if (action) action.textContent = `Массовые операции (${count})`;
  const toolbarAction = document.getElementById('backlog-bulk-open');
  if (toolbarAction) toolbarAction.title = count > 0 ? `Массовые операции (${count} выбрано)` : 'Массовые операции';
  const selectAll = document.getElementById('backlog-select-all');
  if (selectAll) {
    selectAll.setAttribute('aria-label',`Выбрать все ${editable.length} доступных для изменения задач в выборке`);
    selectAll.checked = editable.length > 0 && count === editable.length;
    selectAll.indeterminate = count > 0 && count < editable.length;
  }
}

function bindBacklogSelection() {
  document.getElementById('backlog-select-all')?.addEventListener('change', function () {
    setAllSelection(backlogSelectedTaskIds, getFilteredList(), this.checked, task => canEditTaskForScope('backlog', task));
    document.querySelectorAll('.backlog-task-checkbox').forEach(cb => { cb.checked = backlogSelectedTaskIds.has(Number(cb.value)); });
    updateBacklogBulkBar();
  });
  document.querySelectorAll('.backlog-task-checkbox').forEach(cb => cb.addEventListener('change', function () {
    const id = Number(this.value);
    if (this.checked) backlogSelectedTaskIds.add(id);
    else backlogSelectedTaskIds.delete(id);
    updateBacklogBulkBar();
  }));
  document.getElementById('backlog-bulk-selected')?.addEventListener('click', () => openBacklogBulkOps(currentApp));
  updateBacklogBulkBar();
}

async function openBacklogBulkOps(app) {
  if(isQuickEdit('backlog')&&!(await requestExitQuickEdit('backlog')))return;
  const selected = getBacklogSelectedTasks();
  const editable = getFilteredList().filter(task => canEditTaskForScope('backlog', task));
  const result = await showBulkOpsModal(app, 'backlog', selected.length > 0 ? selected : editable);
  if(result?.outcomeUnknown){stale=true;showBacklogNotice('unknown');renderCurrentView();}
  if (result?.success) {
    backlogSelectedTaskIds.clear();
    await loadTasks(app);
  }
}

function closeBacklogOperationsMenu({ restoreFocus = false } = {}) {
  if (backlogOperationsMenuCleanup) {
    const cleanup = backlogOperationsMenuCleanup;
    backlogOperationsMenuCleanup = null;
    cleanup(restoreFocus);
    return;
  }
  document.getElementById('backlog-operations-menu')?.remove();
  document.getElementById('backlog-bulk-open')?.setAttribute('aria-expanded', 'false');
}

function openBacklogOperationsMenu(app) {
  const trigger = document.getElementById('backlog-bulk-open');
  if (!trigger) return;
  if (document.getElementById('backlog-operations-menu')) {
    closeBacklogOperationsMenu({ restoreFocus: true });
    return;
  }

  const selectedCount = getBacklogSelectedTasks().length;
  const canBulkEdit = getFilteredList().some(task => canEditTaskForScope('backlog', task));
  const bulkHint = !canBulkEdit
    ? (getFilteredList().length ? 'Нет прав на изменение задач в этой выборке.' : 'В текущей выборке нет задач для изменения.')
    : selectedCount > 0
    ? `Изменить выбранные задачи: ${selectedCount}`
    : 'Выбрать задачи и поля для изменения';
  const canReporting = canUseReportingStatusWorkspace(app);
  const canOpenQuarterlyGoals = canUseQuarterlyGoalsUpdate(app);
  const menu = document.createElement('div');
  menu.id = 'backlog-operations-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Массовые операции');
  menu.style.cssText = [
    'position:fixed',
    'z-index:1200',
    'width:min(340px,calc(100vw - 24px))',
    'padding:8px',
    'border:1px solid var(--border-color)',
    'border-radius:12px',
    'background:var(--bg-primary)',
    'box-shadow:0 16px 40px rgba(15,23,42,.18)',
    'display:grid',
    'gap:6px',
  ].join(';');
  menu.innerHTML = `
    <button class="btn btn-secondary btn-sm ui-btn" type="button" role="menuitem" data-backlog-operation="bulk" ${canBulkEdit ? '' : 'disabled aria-disabled="true"'} style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:center;width:100%;text-align:left">
      <span aria-hidden="true" style="width:34px;height:34px;border-radius:9px;background:var(--accent-light);color:var(--accent);display:grid;place-items:center;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m16 3 5 5"/><path d="M14 10 21 3"/><path d="M8 12h3"/><path d="M8 16h8"/></svg></span>
      <span style="min-width:0;"><strong style="display:block;font-size:13px;line-height:1.35;">Конструктор массовых изменений</strong><small style="display:block;margin-top:2px;color:var(--text-secondary);font-size:var(--type-meta-size);line-height:var(--type-meta-line);">${bulkHint}</small></span>
    </button>
    ${canOpenQuarterlyGoals ? `
    <button class="btn btn-secondary btn-sm ui-btn" type="button" role="menuitem" data-backlog-operation="quarterly-goals" style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:center;width:100%;text-align:left">
      <span aria-hidden="true" style="width:34px;height:34px;border-radius:9px;background:var(--warning-light);color:var(--warning);display:grid;place-items:center;"><i data-lucide="gauge"></i></span>
      <span style="min-width:0;"><strong style="display:block;font-size:13px;line-height:1.35;">Обновить прогресс и статусы</strong><small style="display:block;margin-top:2px;color:var(--text-secondary);font-size:var(--type-meta-size);line-height:var(--type-meta-line);">Указать факт выполнения и отложенный старт</small></span>
    </button>` : ''}`;
  if(canReporting)menu.insertAdjacentHTML('beforeend',`<button class="btn btn-secondary btn-sm ui-btn" role="menuitem" data-backlog-operation="reporting">Статусы к отчётным встречам</button>`);
  menu.insertAdjacentHTML('beforeend',`<button class="btn btn-secondary btn-sm ui-btn" role="menuitem" data-backlog-operation="export" ${stale||!getFilteredList().length?'disabled title="Нет полной непустой актуальной выборки"':''}>Экспорт текущей выборки</button><button class="btn btn-secondary btn-sm ui-btn" role="menuitem" data-backlog-operation="preferences">Перенести прежние настройки</button>`);
  menu.querySelector('[data-backlog-operation="reporting"]')?.addEventListener('click',()=>{closeBacklogOperationsMenu();window.location.hash=withBacklogReturn(reportingStatusHref({source:'team-backlog'}));});
  menu.querySelector('[data-backlog-operation="export"]')?.addEventListener('click',()=>{closeBacklogOperationsMenu();if(!stale){if(isQuickEdit('backlog'))window.toast?.('Экспортируются сохранённые данные','info');exportExcel(getFilteredList());}});
  menu.querySelector('[data-backlog-operation="preferences"]')?.addEventListener('click',()=>{closeBacklogOperationsMenu();runMigration();});
  document.body.appendChild(menu);
  window.lucide?.createIcons();
  trigger.setAttribute('aria-expanded', 'true');

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
    const below = rect.bottom + 8;
    const top = below + menuHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - menuHeight - 8);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };
  const setHover = (button, active) => {
    button.style.background = active ? 'var(--bg-secondary)' : 'transparent';
  };
  menu.querySelectorAll('[role="menuitem"]').forEach(button => {
    button.addEventListener('mouseenter', () => setHover(button, true));
    button.addEventListener('mouseleave', () => setHover(button, false));
    button.addEventListener('focus', () => setHover(button, true));
    button.addEventListener('blur', () => setHover(button, false));
  });

  const onDocumentClick = (event) => {
    if (!menu.contains(event.target) && event.target !== trigger) closeBacklogOperationsMenu();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBacklogOperationsMenu({ restoreFocus: true });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const current = items.indexOf(document.activeElement);
      if (current >= 0) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        items[(current + direction + items.length) % items.length]?.focus();
      }
    }
  };
  const onViewportChange = () => closeBacklogOperationsMenu();
  backlogOperationsMenuCleanup = (restoreFocus) => {
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('hashchange', onViewportChange);
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger.isConnected) trigger.focus();
  };

  menu.querySelector('[data-backlog-operation="bulk"]')?.addEventListener('click', () => {
    closeBacklogOperationsMenu();
    openBacklogBulkOps(app);
  });
  menu.querySelector('[data-backlog-operation="quarterly-goals"]')?.addEventListener('click', () => {
    closeBacklogOperationsMenu();
    window.location.hash = withBacklogReturn(quarterlyGoalsUpdateHref({ source: dataScope==='team'?'team-backlog':'backlog' }));
  });
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('hashchange', onViewportChange);
  positionMenu();
  menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
}

function renderCardView(list) {
  const container = document.getElementById('tasks-container');
  if (!container) return;
    container.innerHTML = `
    <div class="task-card-grid">
      ${list.length === 0
        ? renderViewState({ kind: 'empty', title: 'Задачи не найдены', message: emptyBacklogMessage() })
        : list.map(task => renderCard(task)).join('')}
    </div>
  `;
  container.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-icon')) return;
      const t = list.find(x => x.id == card.dataset.id);
      if (t) openTaskModal(t);
    });
  });
  updateBacklogBulkBar();
}

function renderCard(task) {
  return renderTaskCard(task, getToolbarSearchValue('backlog'));
}

function renderDeadline(task) {
  const dl = task.deadline_name || task.deadline || '—';
  const overdue = dl !== '—' && task.deadline_id != null && !TERMINAL_STATUSES.includes(task.status_name) && isDeadlinePast(dl);
  return overdue ? `<span style="color:var(--danger-text);font-weight:600;">${escapeHtml(dl)}</span>` : `<span>${escapeHtml(dl)}</span>`;
}

function renderPriority(priority) {
  if (!priority?.trim()) return '<span class="text-muted">—</span>';
  return uiBadge({ label: priority, tone: taskPriorityTone(priority) });
}

function renderStatus(status) {
  if (!status?.trim()) return '<span class="text-muted">—</span>';
  return uiBadge({ label: status, tone: taskStatusTone(status) });
}

function renderProgress(progress) {
  const p = progress;
  return uiProgress({ value: p, tone: p >= 100 ? 'success' : p > 0 ? 'warning' : 'accent', showValue: true });
}

function renderCV(task) {
  const cv = calculateTaskCv(task);
  const zone = cvZone(cv);
  if (zone === 'missing') return '<span class="badge badge-danger">Нет данных</span>';
  const cls = zone === 'good' ? 'badge-status-done' : zone === 'warning' ? 'badge-warning' : 'badge-danger';
  return `<span class="badge ${cls}">${cv.toFixed(2)}</span>`;
}

function renderTags(tags) {
  if (!tags || (Array.isArray(tags) && tags.length === 0) || (typeof tags === 'string' && !tags.trim())) return '—';
  let list;
  if (Array.isArray(tags)) {
    list = tags.map(t => typeof t === 'object' && t !== null
      ? { name: String(t.name || ''), color: t.color || '' }
      : { name: String(t), color: '' });
  } else {
    list = String(tags).split(',').map(t => t.trim()).filter(Boolean).map(t => ({ name: t, color: '' }));
  }
  return list.filter(t => t.name).map(t => {
    const color = /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '';
    return uiTag({ label: t.name, color });
  }).join(' ');
}

function metricFormat(val) {
  if (val === null || val === undefined) return '—';
  return new Intl.NumberFormat('ru-RU').format(val);
}


function exportExcel(list) {
  if (!list?.length) return;
  const columns = visibleTaskColumns(columnOrder, columnSettings);
  downloadCsv(taskCsv(list, columns, COLUMN_LABELS), `backlog_${dataScope}_${new Date().toISOString().slice(0, 10)}.csv`);
}

function canCreate(){return ['write_own','write_all'].includes(user?.permissions?.backlog_team)&&canEditTask(user,{team_id:user?.team_id});}
function createTeamId(){if(dataScope==='team')return user.team_id;const names=getToolbarViewState('backlog').filters.team_name||[];if(names.length!==1)return null;const candidates=[...(tasksCache?.items||[]),...(currentApp?.teams||[]).map(t=>({team_id:t.id,team_name:t.name}))];const ids=[...new Set(candidates.filter(t=>t.team_name===names[0]).map(t=>t.team_id).filter(x=>x!=null))];return ids.length===1?ids[0]:null;}
function scopeMarkup(){
 const scopes=backlogContexts(user);const label=scope=>scope==='team'?'Моя команда · '+(user.team_name||String(user.team_id)):'Все доступные';
 if(scopes.length===1&&!workspaceError)return `<div class="backlog-scope-bar" role="status">${escapeHtml(label(scopes[0]))}</div>`;
 return `<div class="backlog-scope-bar">${segmentedControl({label:'Область бэклога',className:'ui-segmented-compact',size:'small',value:dataScope,items:scopes.map(scope=>({value:scope,label:scope==='team'?'Команда':'Трайб',attrs:{'data-backlog-scope':scope,title:label(scope),'aria-current':scope===dataScope?'true':null}}))})}</div>`;
}

function bindScopeControls(){document.querySelectorAll('[data-backlog-scope]').forEach(el=>el.addEventListener('click',event=>{event.preventDefault();const scope=el.dataset.backlogScope;if(scope===dataScope&&!workspaceError)return;const state=readBacklogSession(user,scope);window.location.hash=state?buildBacklogHref(scope,state):`#/backlog?scope=${scope}`;}));}
function pageState(){return {selectedViewId,view:currentView,columns:{...columnSettings},columnOrder:[...columnOrder],widths:{...columnWidths},fixed:{...columnFixed},columnSort:{...columnSort},paginationPage,scrollX:document.querySelector('#tasks-container .table-container')?.scrollLeft||0,scrollY:document.querySelector('.main-content')?.scrollTop||0};}
function syncBacklogMenu(state){document.querySelector('.sidebar-item[aria-label="Бэклог"]')?.setAttribute('href',buildBacklogHref(dataScope,state));}
function publishState(){
 if(!workspaceReady||workspaceError)return;
 const state={toolbar:getToolbarViewState('backlog'),page:pageState()};
 syncBacklogMenu(state);
 writeBacklogSession(user,dataScope,state);
 const params=new URLSearchParams(window.location.hash.split('?')[1]||'');const card=Object.fromEntries(['task','tab','comment'].map(k=>[k,params.get(k)]));
 const href=buildBacklogHref(dataScope,state,card);
 if(href!==window.location.hash){const old=lastPublished?parseBacklogRoute(lastPublished):null;const searchChanged=old&&old.toolbar.search!==state.toolbar.search;const method=!lastPublished||searchChanged?'replaceState':'pushState';history[method](currentApp?.router?.historyStateFor?.(method)||history.state,'',href);if(currentApp?.router)currentApp.router.lastHash=href.slice(1);}
 lastPublished=href;
}
function preferenceAdapter(){
 const repo=preferences,scope=dataScope;const defaults=DEFAULT_PINNED_FILTERS[scope==='team'?'team':'backlog'];
 let pinnedCache=repo.context(scope).pinnedFilters??defaults;
 return {reset:()=>{columnSort.key=null;columnSort.dir='asc';},initialViewId:readBacklogSession(user,scope)?.page?.selectedViewId||'',selectedView:id=>{selectedViewId=id;},skipDefault:!!restoreState||(scope==='team'&&repo.context(scope).teamId!=null&&repo.context(scope).teamId!==user.team_id),normalizeSavedToolbar:state=>{const next=JSON.parse(JSON.stringify(state));if(scope==='team'&&next.filters?.team_name?.length&&!(next.filters.team_name.length===1&&next.filters.team_name[0]===user.team_name)){delete next.filters.team_name;window.toast?.('Команда прежнего представления заменена текущей областью «Моя команда»','warning');}return next;},defaultPinned:defaults,lockedTeam:scope==='team'?(user.team_name||String(user.team_id)):null,
 readPinned:()=>pinnedCache,
 writePinned:keys=>{pinnedCache=keys;return repo.update(d=>{d.contexts[scope].pinnedFilters=keys;});},
 readViews:capture=>{const views=repo.context(scope).views||{items:[],defaultId:null};if(capture||!viewBaseline)viewBaseline=JSON.parse(JSON.stringify(views));return views;},
 writeViews:async next=>{const before=viewBaseline||{items:[]};let conflict=false,conflictId=null;await repo.update(d=>{
  const c=d.contexts[scope];const live=c.views||{items:[],defaultId:null};const originals=new Map(before.items.map(v=>[v.id,v]));const nexts=new Map(next.items.map(v=>[v.id,v]));
  for(const old of before.items){const updated=nexts.get(old.id);if(JSON.stringify(old)===JSON.stringify(updated))continue;const current=live.items.find(v=>v.id===old.id);if(JSON.stringify(current)!==JSON.stringify(old)){conflict=true;conflictId=old.id;return;}}
  const removed=new Set(before.items.filter(v=>!nexts.has(v.id)).map(v=>v.id));
  live.items=live.items.filter(v=>!removed.has(v.id));for(const v of next.items)if(!originals.has(v.id)||JSON.stringify(v)!==JSON.stringify(originals.get(v.id))){const i=live.items.findIndex(x=>x.id===v.id);const value={...v,revision:(live.items[i]?.revision||0)+1};if(i<0)live.items.push(value);else live.items[i]=value;}
  if(next.defaultId!==before.defaultId)live.defaultId=next.defaultId;c.views=live;
 });if(conflict){const {confirmAction}=await import('../uiFeedback.js');const reload=await confirmAction({title:'Представление изменено в другой вкладке',message:'Перечитать новую редакцию или сохранить ваши настройки отдельной копией?',confirmText:'Перечитать',cancelText:'Сохранить как новое'});let copyId;if(!reload){copyId=crypto.randomUUID();const candidate=next.items.find(v=>v.id===conflictId)||before.items.find(v=>v.id===conflictId);if(candidate)await repo.update(d=>{d.contexts[scope].views.items.push({...candidate,id:copyId,name:(candidate.name.slice(0,70)+' (копия)'),revision:1});});}refreshToolbarViews('backlog',copyId);return false;}return true;}
 };
}
async function runMigration(){if(isQuickEdit('backlog')&&!(await requestExitQuickEdit('backlog')))return;const {confirmAction}=await import('../uiFeedback.js');if(!(await confirmAction({title:'Перенести настройки этого браузера?',message:'Подтвердите, что прежние настройки принадлежат вам. Если они ранее связаны с другой учёткой, перенос в ваш профиль будет выполнен по этому подтверждению. Исходные ключи сохранятся.',confirmText:'Перенести'})))return;let errors;try{errors=await importLegacyPreferences(preferences,user,{allowClaim:true});}catch(error){window.toast?.(error.message,'error');return;}window.toast?.(errors.length?'Часть настроек повреждена: остальные перенесены':'Настройки перенесены','info');const context=preferences.context(dataScope);history.replaceState(history.state,'',buildBacklogHref(dataScope,{toolbar:getToolbarViewState('backlog'),page:{view:currentView,columnSort:context.columns?.sort}}));disposeBacklogPage();await currentApp.router.handleRoute();}
export function handleBacklogQuery(hash){
 if(!workspaceReady)return false;const route=parseBacklogRoute(hash,toolbarFilterKeys());if(route.scope!==dataScope||route.errors.length)return false;
 if(!route.explicit){lastPublished='';publishState();return true;}
 if(route.explicit){workspaceReady=false;applyToolbarViewState('backlog',route.toolbar);applyBacklogSavedViewState(route.page);paginationPage=route.page.paginationPage;workspaceReady=true;lastPublished=hash;renderCurrentView();}
 return true;
}
export function refreshBacklogPage(){
 if(!initialized||workspaceError)return;
 const activeUser=currentApp?.store.get('currentUser');
 if(activeUser?.id!==user.id||activeUser?.team_id!==user.team_id||!backlogContexts(activeUser).includes(dataScope)){if(activeUser?.id===user.id&&activeUser?.team_id!==user.team_id&&dataScope==='team'){history.replaceState(history.state,'','#/backlog?scope=team');window.toast?.('Команда изменилась. Условия прежней команды сброшены.','info');}disposeBacklogPage();return currentApp?.router.handleRoute();}
 if(document.hidden||isBacklogInteractionActive()){stale=true;deferredRefresh=true;showBacklogNotice('deferred');return;}
 deferredRefresh=false;return loadTasks(currentApp);
}
export function disposeBacklogPage(event){
 if(event?.type==='dmb:session-ended'||(user&&currentApp?.store.get('currentUser')?.id!==user.id)){clearQuickEditState();clearToolbarDirectories();}
 if(user&&!workspaceError&&document.getElementById('tasks-content')){const toolbar=getToolbarViewState('backlog');const input=document.getElementById('f-backlog-search');if(input)toolbar.search=input.value;const state={toolbar,page:initialized?pageState():(restoreState?.page||pageState())};writeBacklogSession(user,dataScope,state);syncBacklogMenu(state);}
 workspaceReady=false;initialized=false;renderSuppressed=false;deferredRefresh=false;selectedViewId='';generation++;pendingController?.abort();pendingController=null;tasksLoadInProgress=false;tasksReloadQueued=false;
 if(autoRefreshTimer)clearInterval(autoRefreshTimer);autoRefreshTimer=null;
 if(keyboardHandler)window.removeEventListener('keydown',keyboardHandler);keyboardHandler=null;
 activeCleanup.splice(0).forEach(fn=>fn());closeBacklogOperationsMenu();disposeQuickFilters();disposeToolbar('backlog');setOnTaskSaved(null);backlogSelectedTaskIds.clear();tasksCache=null;lastPublished='';
}

async function recheckBacklogAccess(){
 const owner=user?.id,token=generation;
 try{const fresh=await currentApp.api.get('/auth/me');if(token!==generation||fresh.id!==owner)return;currentApp.store.set('currentUser',fresh);
 if(!backlogContexts(fresh).includes(dataScope)){document.dispatchEvent(new CustomEvent('dmb:session-ended'));currentApp.router.clearTaskRoute({replace:true});return currentApp.router.handleRoute();}
 user=fresh;renderCurrentView();
 }catch{stale=true;showBacklogNotice('access');}
}

function emptyBacklogMessage(){return tasksCache?.items?.length?'Измените условия поиска или сбросьте фильтры.':canCreate()?'Измените фильтры или создайте новую задачу.':'Измените фильтры. Создание задач для вашей роли недоступно.';}

function markTaskOutside(taskId=Number(new URLSearchParams(window.location.hash.split('?')[1]||'').get('task'))){
 if(!tasksCache||!taskId)return;const header=document.querySelector('#task-detail-overlay #mhead');if(!header)return;
 const outside=!getFilteredList().some(t=>Number(t.id)===Number(taskId));const old=document.getElementById('backlog-task-outside');
 if(outside&&!old){const note=document.createElement('p');note.id='backlog-task-outside';note.className='ui-alert';note.dataset.uiTone='info';note.setAttribute('role','status');note.textContent='Задача вне текущей выборки';header.appendChild(note);}else if(!outside)old?.remove();
}
