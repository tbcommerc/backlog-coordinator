import { pageHeader } from './ui/primitives.js';
import { renderViewState } from './components/viewState.js';
import { escapeHtml } from './htmlUtils.js';
import { renderSecurity, initSecurity } from './components/accountSecurity.js';
import { renderDashboard, initDashboard } from './components/dashboard.js?v=20';
import { renderTasksPage, initTasksPage } from './components/taskTable.js?v=132';
import { renderTeamBacklog, initTeamBacklog } from './components/teamBacklog.js?v=134';
import { renderExpressEstimate, initExpressEstimate } from './components/expressEstimate.js?v=41';
import { renderKanban, initKanban } from './components/kanbanBoard.js?v=14';
import { renderReports, initReports, renderReportPage, initReportPage, renderReportingMeetingsManagement, initReportingMeetingsManagement } from './components/reports.js?v=45';
import { renderAnalytics, initAnalytics } from './components/analytics.js?v=24';
import { renderNotifications, initNotifications } from './components/notifications.js?v=23';
import { renderSettings, initSettings } from './components/settings.js?v=7';
import { renderAdmin, initAdmin } from './components/admin.js?v=15';
import { renderCustomerPortal, initCustomerPortal, renderRequestPage, initRequestPage, renderCustomerTaskPage, initCustomerTaskPage } from './components/customerPortal.js?v=12';
import { renderAgentChat, initAgentChat } from './components/agentChat.js?v=96';
import { renderAuditLog, initAuditLog } from './components/auditLog.js?v=6';
import { renderOutboxDeadLetters, initOutboxDeadLetters } from './components/outboxDeadLetters.js?v=7';
import { renderReviewPage, initReviewPage, renderReviewDetailPage, initReviewDetailPage } from './components/reviewPage.js?v=11';
import { renderReportingStatuses, initReportingStatuses } from './components/reportingStatuses.js?v=21';
import { renderQuarterlyGoalsUpdate, initQuarterlyGoalsUpdate } from './components/quarterlyGoalsUpdate.js?v=11';

export const TASK_DETAIL_TABS = Object.freeze(['main', 'rep', 'com', 'sys', 'log', 'work']);
const TASK_DETAIL_TAB_SET = new Set(TASK_DETAIL_TABS);

export function normalizeTaskDetailTab(tab) {
    const candidate = String(tab || 'main').trim().toLowerCase();
    if (candidate === 'files') return 'sys';
    return TASK_DETAIL_TAB_SET.has(candidate) ? candidate : 'main';
}

export function parsePositiveTaskId(value) {
    const candidate = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(candidate)) return null;
    const taskId = Number(candidate);
    return Number.isSafeInteger(taskId) ? taskId : null;
}

export function shouldClearFailedTaskRoute(error) {
    return new Set([400, 403, 404, 410, 422]).has(Number(error?.status));
}

export function createTaskOpenHandler(app, options = {}) {
    const loadTaskModal = options.loadTaskModal || (() => import('./components/modal.js?v=120'));
    const getTaskOverlay = options.getTaskOverlay || (() => document.getElementById('task-detail-overlay'));
    const dispatchTaskTabChange = options.dispatchTaskTabChange || ((taskId, tab) => {
        document.dispatchEvent(new CustomEvent('task-tab-change', { detail: { taskId, tab } }));
    });
    const onError = options.onError || (() => {});
    let pendingRequest = null;

    const activateExistingOverlay = (taskId, tab, commentId = null) => {
        const overlay = getTaskOverlay();
        if (!overlay) return null;
        const routeTaskId = app.router?.currentTaskRoute?.().taskId;
        if (routeTaskId === taskId) {
            app.router?.pushTaskRoute?.(taskId, tab, commentId);
            dispatchTaskTabChange(taskId, tab);
        }
        return overlay;
    };

    return async function handleTaskOpen(event) {
        const taskId = parsePositiveTaskId(event?.detail?.taskId);
        if (!taskId) return null;
        const tab = normalizeTaskDetailTab(event?.detail?.tab);
        const commentId = tab === 'com' ? parsePositiveTaskId(event?.detail?.commentId) : null;

        const existingOverlay = activateExistingOverlay(taskId, tab, commentId);
        if (existingOverlay) return existingOverlay;

        if (pendingRequest?.taskId === taskId) {
            pendingRequest.tab = tab;
            pendingRequest.commentId = commentId;
            return pendingRequest.promise;
        }

        const request = { taskId, tab, commentId, promise: null };
        pendingRequest = request;
        request.promise = (async () => {
            try {
                const task = await app.api.get(`/tasks/${taskId}`);
                if (task.metric_id) {
                    location.hash = '/metrics/' + task.metric_id;
                    return null;
                }
                if (pendingRequest !== request) return null;
                if (parsePositiveTaskId(task?.id) !== taskId) {
                    const invalidResponse = new Error('Task response does not match the requested task');
                    invalidResponse.status = 404;
                    throw invalidResponse;
                }
                const taskModal = await loadTaskModal();
                if (pendingRequest !== request) return null;

                const overlay = activateExistingOverlay(taskId, request.tab, request.commentId);
                if (overlay) return overlay;

                app.router?.pushTaskRoute?.(taskId, request.tab, request.commentId);
                return taskModal.openTaskModal(task);
            } catch (error) {
                if (pendingRequest !== request) return null;
                if (shouldClearFailedTaskRoute(error)) {
                    app.router?.clearTaskRoute?.({ replace: true, expectedTaskId: taskId });
                }
                onError(error);
                return null;
            } finally {
                if (pendingRequest === request) pendingRequest = null;
            }
        })();
        return request.promise;
    };
}

export class Router {
    constructor(app) {
        this.app = app;
        this.routes = {
            '/dashboard': { render: renderDashboard, init: initDashboard },
            '/backlog': { render: renderTasksPage, init: initTasksPage },
            '/team-backlog': { render: renderTeamBacklog, init: initTeamBacklog },
            '/express-estimate': { render: renderExpressEstimate, init: initExpressEstimate },
            '/kanban': { render: renderKanban, init: initKanban },
            '/reports': { render: renderReports, init: initReports },
            '/reporting-statuses': { render: renderReportingStatuses, init: initReportingStatuses },
            '/quarterly-goals-update': { render: renderQuarterlyGoalsUpdate, init: initQuarterlyGoalsUpdate },
            '/reporting-meetings': { render: renderReportingMeetingsManagement, init: initReportingMeetingsManagement },
            '/reports/detail': { render: renderReportPage, init: initReportPage },
            '/analytics/tribe': { render: (app) => renderAnalytics('tribe', app), init: (app) => initAnalytics('tribe', app) },
            '/analytics/po-pl': { render: (app) => renderAnalytics('po-pl', app), init: (app) => initAnalytics('po-pl', app) },
            '/analytics/it': { render: (app) => renderAnalytics('it', app), init: (app) => initAnalytics('it', app) },
            '/notifications': { render: renderNotifications, init: initNotifications },
            '/account/security': { render: renderSecurity, init: initSecurity },
            '/settings': { render: renderSettings, init: initSettings },
            '/admin': { render: renderAdmin, init: initAdmin },
            '/audit-log': { render: renderAuditLog, init: initAuditLog },
            '/outbox-dead-letters': { render: renderOutboxDeadLetters, init: initOutboxDeadLetters },
            '/customer': { render: renderCustomerPortal, init: initCustomerPortal },
            '/customer/create': { render: renderAgentChat, init: initAgentChat },
            '/review': { render: renderReviewPage, init: initReviewPage },
        };
        this.defaultRoute = '/dashboard';
        this.onBeforeNavigate = null;
        this.lastHash = null;
        this.renderedPath = null;
        this.lastDeepLinkedTask = null;
        this.taskOpenTimer = null;
        this.focusSidebarWasCollapsed = null;
        this.navigationGeneration = 0;
    }

    init() {
        // A new authenticated shell has no rendered page, even at the same URL.
        this.lastHash = null;
        this.renderedPath = null;
        this.cancelPendingTaskOpen();
        if (!this.hashChangeHandler) {
            this.hashChangeHandler = () => this.handleRoute();
            window.addEventListener('hashchange', this.hashChangeHandler);
        }
        this.handleRoute();
    }

    navigate(path) {
        window.location.hash = path;
    }

    async refreshCurrentRoute() {
        // Force the active renderer/init pair to run without changing history.
        // Used by debounced realtime invalidations from other workers.
        this.lastHash = null;
        await this.handleRoute();
    }

    currentTaskRoute() {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        const rawTab = params.get('tab');
        const commentId = parsePositiveTaskId(params.get('comment'));
        return {
            path,
            taskId: params.has('task') ? parsePositiveTaskId(params.get('task')) : null,
            tab: rawTab == null && commentId ? 'com' : normalizeTaskDetailTab(rawTab),
            commentId,
        };
    }

    replaceTaskQuery(path, params, { clearModalMarker = false } = {}) {
        const nextHash = params.toString() ? `${path}?${params.toString()}` : path;
        const nextState = clearModalMarker && history.state
            ? Object.fromEntries(Object.entries(history.state).filter(([key]) => key !== 'dmbTaskModal'))
            : history.state;
        history.replaceState(nextState, '', '#' + nextHash);
        this.lastHash = nextHash;
        return nextHash;
    }

    cancelPendingTaskOpen() {
        if (this.taskOpenTimer !== null) {
            clearTimeout(this.taskOpenTimer);
            this.taskOpenTimer = null;
        }
    }

    pushTaskRoute(taskId, tab, commentId = null) {
        const normalizedTaskId = parsePositiveTaskId(taskId);
        if (!normalizedTaskId) return;
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        const explicitTab = tab !== undefined && tab !== null;
        const normalizedTab = normalizeTaskDetailTab(tab);
        const normalizedCommentId = normalizedTab === 'com' ? parsePositiveTaskId(commentId) : null;
        if (parsePositiveTaskId(params.get('task')) === normalizedTaskId) {
            if (explicitTab) this.updateTaskTabRoute(normalizedTab);
            if (normalizedCommentId) {
                const currentHash = window.location.hash.slice(1) || this.defaultRoute;
                const [currentPath, currentQuery = ''] = currentHash.split('?');
                const currentParams = new URLSearchParams(currentQuery);
                currentParams.set('comment', String(normalizedCommentId));
                this.replaceTaskQuery(currentPath, currentParams);
            }
            return;
        }
        params.set('task', String(normalizedTaskId));
        params.delete('comment');
        if (normalizedTab !== 'main') params.set('tab', normalizedTab);
        else params.delete('tab');
        if (normalizedCommentId) params.set('comment', String(normalizedCommentId));
        else params.delete('comment');
        const nextHash = `${path}?${params.toString()}`;
        history.pushState({ ...(history.state || {}), dmbTaskModal: true }, '', '#' + nextHash);
        this.lastHash = nextHash;
        this.lastDeepLinkedTask = `${path}:${normalizedTaskId}`;
    }

    updateTaskTabRoute(tab) {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        if (!params.has('task')) return;
        const normalizedTab = normalizeTaskDetailTab(tab);
        if (normalizedTab !== 'main') params.set('tab', normalizedTab);
        else params.delete('tab');
        if (normalizedTab !== 'com') params.delete('comment');
        const nextHash = `${path}?${params.toString()}`;
        history.replaceState(history.state, '', '#' + nextHash);
        this.lastHash = nextHash;
    }

    clearTaskRoute(options = {}) {
        const { replace = false, expectedTaskId = null } = options || {};
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        if (path === '/review' && !params.has('task')) return false;
        if (!params.has('task') && !params.has('tab') && !params.has('comment')) return false;
        const currentTaskId = params.has('task') ? parsePositiveTaskId(params.get('task')) : null;
        if (expectedTaskId !== null && currentTaskId !== parsePositiveTaskId(expectedTaskId)) return false;
        this.cancelPendingTaskOpen();
        if (!replace && history.state?.dmbTaskModal) {
            history.back();
            return true;
        }
        params.delete('task');
        params.delete('tab');
        params.delete('comment');
        this.replaceTaskQuery(path, params, { clearModalMarker: replace });
        this.lastDeepLinkedTask = null;
        return true;
    }

    openDeepLinkedTask(path, query) {
        const params = new URLSearchParams(query);
        if (!params.has('task')) {
            if (path !== '/review' && (params.has('tab') || params.has('comment'))) {
                params.delete('tab');
                params.delete('comment');
                this.replaceTaskQuery(path, params, { clearModalMarker: true });
            }
            this.cancelPendingTaskOpen();
            this.lastDeepLinkedTask = null;
            return;
        }

        const linkedTaskId = parsePositiveTaskId(params.get('task'));
        if (!linkedTaskId) {
            params.delete('task');
            params.delete('tab');
            params.delete('comment');
            this.replaceTaskQuery(path, params, { clearModalMarker: true });
            this.cancelPendingTaskOpen();
            this.lastDeepLinkedTask = null;
            return;
        }

        const rawTab = params.get('tab');
        let commentId = parsePositiveTaskId(params.get('comment'));
        if (params.has('comment') && !commentId) {
            params.delete('comment');
            this.replaceTaskQuery(path, params);
        }
        const linkedTaskTab = rawTab == null && commentId ? 'com' : normalizeTaskDetailTab(rawTab);
        if (rawTab != null && linkedTaskTab !== 'com' && params.has('comment')) {
            params.delete('comment');
            commentId = null;
            this.replaceTaskQuery(path, params);
        }
        if (params.has('tab') && linkedTaskTab === 'main') {
            params.delete('tab');
            this.replaceTaskQuery(path, params);
        } else if (params.has('tab') && rawTab !== linkedTaskTab) {
            params.set('tab', linkedTaskTab);
            this.replaceTaskQuery(path, params);
        }

        const deepLinkKey = `${path}:${linkedTaskId}`;
        if (this.lastDeepLinkedTask !== deepLinkKey || this.taskOpenTimer !== null) {
            this.lastDeepLinkedTask = deepLinkKey;
            this.cancelPendingTaskOpen();
            this.taskOpenTimer = setTimeout(() => {
                this.taskOpenTimer = null;
                const current = this.currentTaskRoute();
                if (current.path !== path || current.taskId !== linkedTaskId) return;
                document.dispatchEvent(new CustomEvent('open-task', {
                    detail: { taskId: linkedTaskId, tab: current.tab },
                }));
            }, 100);
            return;
        }
        document.dispatchEvent(new CustomEvent('open-task', {
            detail: { taskId: linkedTaskId, tab: linkedTaskTab },
        }));
    }

    async handleRoute() {
        const generation = ++this.navigationGeneration;
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const from = this.lastHash;

        if (this.onBeforeNavigate && from !== null && hash !== from) {
            const ok = await this.onBeforeNavigate(path, from);
            if (generation !== this.navigationGeneration) return;
            if (!ok) {
                if (from !== hash && from !== null) {
                    history.replaceState(null, '', '#' + from);
                }
                return;
            }
        }


        const user = this.app?.store?.get('currentUser');
        const isAssistantV2Route = path === '/assistant-v2' || path.startsWith('/assistant-v2/');
        if (isAssistantV2Route) {
            history.replaceState(null, '', '#/agent-v2');
            return this.handleRoute();
        }
        const isAgentV2Route = path === '/agent-v2' || path.startsWith('/agent-v2/');
        const businessCustomerAllowedPaths = new Set(['/customer', '/customer/create', '/agent-v2', '/backlog-assistant', '/account/security', '/notifications', '/settings']);
        const isCustomerRequestDetail = /^\/customer\/request\/\d+$/.test(path);
        const isCustomerTaskDetail = /^\/customer\/task\/\d+$/.test(path);
        if (user?.permissions?.customer_portal_mode === 'only' && !businessCustomerAllowedPaths.has(path) && !isCustomerRequestDetail && !isCustomerTaskDetail) {
            if (window.location.hash !== '#/customer') {
                history.replaceState(null, '', '#/customer');
            }
            return this.handleRoute();
        }
        if (path === '/kanban') {
            try {
                const options = await this.app.api.get('/work-tasks/options');
                if (generation !== this.navigationGeneration) return;
                if (options.board_enabled === true) {
                    sessionStorage.setItem('work-board-redirect-notice','1');
                    history.replaceState(null,'',`#/work-tasks?display=board&view=${user?.team_id?'team':'all'}&status=active&sort=attention`);
                    return this.handleRoute();
                }
            } catch { /* Keep the legacy route available when capability discovery fails. */ }
        }
        const adminAccess = user?.permissions?.admin || 'none';
        const requiresAdmin = path === '/admin' || path === '/audit-log';
        const requiresFullAdmin = path === '/audit-log' || path === '/outbox-dead-letters' || path === '/reporting-meetings';
        if ((requiresAdmin && adminAccess === 'none') || (requiresFullAdmin && adminAccess !== 'full')) {
            const container = document.getElementById('page-content');
            if (container) {
                container.innerHTML = pageHeader({title:'Недостаточно прав'}) + renderViewState({kind:'forbidden',title:'Раздел недоступен',message:'Раздел доступен пользователям с административным доступом.',actionLabel:'Вернуться на главную',actionAttrs:{'data-route-home':true}});
                container.querySelector('[data-route-home]')?.addEventListener('click',()=>this.navigate('/dashboard'));
                window.lucide?.createIcons();
            }
            this.lastHash = hash;
            this.renderedPath = path;
            this.onBeforeNavigate = null;
            this.syncAssistantFocusMode(path);
            const breadcrumb = document.getElementById('breadcrumb-nav');
            if (breadcrumb) {
                breadcrumb.hidden = false;
                breadcrumb.innerHTML = '<a href="#/dashboard" class="breadcrumb-parent">Главная</a><span class="breadcrumb-separator" aria-hidden="true">/</span><span class="breadcrumb-current" aria-current="page">Недостаточно прав</span>';
            }
            this.updateSidebarActive(path);
            return;
        }

        this.lastHash = hash;
        this.syncAssistantFocusMode(path);
        const fromPath = from?.split('?')[0];
        const projectChanged = path === '/work-projects' && ['project','scope','major','mp','section','year','bucket','bq','bstate','bp','quarter','result','rp','cq','cp'].some(key => new URLSearchParams(query).get(key) !== new URLSearchParams(from?.split('?')[1] || '').get(key));
        const queryDrivenWorkPage = /^\/metrics(?:\/\d+)?$/.test(path) || projectChanged || path === '/work-reports' || /^\/work-tasks(?:\/\d+)?$/.test(path);
        if (from !== null && path === fromPath && this.renderedPath === path && path !== '/meeting-capture' && !queryDrivenWorkPage) {
            this.openDeepLinkedTask(path, query);
            this.updateSidebarActive(path);
            return;
        }

        const route = this.routes[path];

        // dynamic route: /customer/request/{id}
        let dynamicHandler = null;
        const requestMatch = path.match(/^\/customer\/request\/(\d+)$/);
        const customerTaskMatch = path.match(/^\/customer\/task\/(\d+)$/);
        const reviewMatch = path.match(/^\/review\/(\d+)$/);
        if (requestMatch) {
          const requestId = requestMatch[1];
          dynamicHandler = {
            render: () => renderRequestPage(this.app, requestId),
            init: () => initRequestPage(this.app, requestId),
          };
        } else if (customerTaskMatch) {
          const taskId = customerTaskMatch[1];
          dynamicHandler = {
            render: () => renderCustomerTaskPage(this.app, taskId),
            init: () => initCustomerTaskPage(this.app, taskId),
          };
        } else if (reviewMatch) {
          const requestId = reviewMatch[1];
            dynamicHandler = {
            render: () => renderReviewDetailPage(this.app, requestId),
            init: () => initReviewDetailPage(this.app, requestId),
            };
        } else if (isAgentV2Route) {
          // The dedicated page is always discoverable; its API access remains server-gated.
        const module = await import('./agent-v2/routes.js?v=10');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = module.resolveAgentV2Route(path, this.app);
        } else if (path === '/backlog-assistant') {
          const module = await import('./backlog-assistant/page.js');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = { render: module.renderPage, init: module.initPage };
        } else if (path === '/work-reports') {
          const legacy = new URLSearchParams(location.hash.split('?')[1] || '');
          if (!legacy.has('meeting_id')) {
            const next = new URLSearchParams({display:'summary',view:'all'});
            if (legacy.has('task')) next.set('parent',legacy.get('task'));
            if (legacy.has('team_id')) next.set('team',legacy.get('team_id'));
            location.replace('#/work-tasks?'+next);
            return;
          }
          const module = await import('./components/workReports.js?v=8');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = { render: module.renderWorkReports, init: module.initWorkReports };
        } else if (/^\/metrics(?:\/\d+)?$/.test(path)) {
          const module = await import('./components/metrics.js?v=1');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = { render: module.renderMetrics, init: module.initMetrics };
        } else if (path === '/work-projects') {
          const module = await import('./components/workProjects.js?v=27');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = { render: module.renderWorkProjects, init: module.initWorkProjects };
        } else if (/^\/work-tasks(?:\/\d+)?$/.test(path)) {
          const module = await import('./components/workTasks.js?v=31');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = { render: module.renderWorkTasks, init: module.initWorkTasks };
        } else if (path === '/meeting-capture') {
          const module = await import('./components/meetingCapture.js?v=8');
          if (generation !== this.navigationGeneration) return;
          dynamicHandler = { render: module.renderMeetingCapture, init: module.initMeetingCapture };
        }

        const resolved = dynamicHandler || route;

        if (resolved) {
            const container = document.getElementById('page-content');
            if (container) {
                const markup = await resolved.render(this.app);
                if (generation !== this.navigationGeneration || (window.location.hash.slice(1) || this.defaultRoute) !== hash) return;
                container.innerHTML = markup;
                this.renderedPath = path;

                if (window.lucide) {
                    window.lucide.createIcons();
                }

                // Update breadcrumb
                const bc = document.getElementById('breadcrumb-nav');
                if (bc) {
                    bc.hidden = false;
                    const names = {
                        '/dashboard': 'Главная',
                        '/work-tasks': 'Рабочие задачи',
                        '/work-projects': 'Проекты',
                        '/metrics': 'Метрики',
                        '/work-reports': 'Снимок задач встречи',
                        '/meeting-capture': 'Поручения из встреч',
                        '/backlog-assistant': 'Помощник по бэклогу',
                        '/backlog': 'Бэклог DMB',
                        '/team-backlog': 'Бэклог команды',
                        '/express-estimate': 'Экспресс-оценка',
                        '/kanban': 'Канбан-доска',
                        '/reports': 'Статусы для встреч',
                        '/reporting-statuses': 'Заполнение статусов',
                        '/quarterly-goals-update': 'Обновить прогресс и статусы',
                        '/reporting-meetings': 'Управление отчётными встречами',
                        '/reports/detail': 'Статус-отчёт',
                        '/analytics/tribe': 'Аналитика ЛТ',
                        '/analytics/po-pl': 'Аналитика PO/PL',
                        '/analytics/it': 'Аналитика для ИТ',
                        '/notifications': 'Мои уведомления',
                        '/settings': 'Настройки',
                        '/account/security': 'Безопасность аккаунта',
                        '/admin': 'Администрирование',
                        '/audit-log': 'Аудит действий',
                        '/outbox-dead-letters': 'Ошибки доставки событий',
                        '/customer': 'Мои запросы',
                        '/customer/create': 'ИИ-ассистент',
                        '/agent-v2': 'ИИ-ассистент V2',
                        '/review': 'Запросы заказчиков',
                    };
                    const pageName = names[path] || (/^\/metrics\/\d+$/.test(path) ? 'Карточка метрики' : '') || (/^\/work-tasks\/\d+$/.test(path) ? 'Рабочая задача' : '') || (requestMatch ? 'Запрос' : '') || (customerTaskMatch ? 'Задача по запросу' : '') || (reviewMatch ? 'Запрос заказчика' : path);
                    const links = [];
                    if (path !== '/dashboard') links.push('<a href="#/dashboard" class="breadcrumb-parent">Главная</a>');
                    const segments = path.split('/').filter(Boolean);
                    let parentPath = '';
                    for (let i = 0; i < segments.length - 1; i++) {
                        parentPath += '/' + segments[i];
                        if (names[parentPath]) links.push(`<a href="#${parentPath}" class="breadcrumb-parent">${names[parentPath]}</a>`);
                    }
                    const projectId = parsePositiveTaskId(new URLSearchParams(query).get('project'));
                    if (path === '/work-projects' && projectId) {
                        links.push('<a href="#/work-projects" class="breadcrumb-parent">Проекты</a>');
                    }
                    const currentName = path === '/work-projects' && projectId ? 'Обзор проекта' : pageName;
                    links.push(`<span class="breadcrumb-current" aria-current="page">${escapeHtml(currentName)}</span>`);
                    bc.innerHTML = links.join('<span class="breadcrumb-separator" aria-hidden="true">/</span>');
                }

                // Call page-specific init
                if (resolved.init && /^\/metrics(?:\/\d+)?$/.test(path)) {
                    resolved.init(this.app);
                } else if (resolved.init) {
                    setTimeout(() => {
                        if (generation === this.navigationGeneration && (window.location.hash.slice(1) || this.defaultRoute) === hash) resolved.init(this.app);
                    }, 50);
                }
                this.openDeepLinkedTask(path, query);
            }
        } else {
            this.navigate(this.defaultRoute);
        }

        this.updateSidebarActive(path);
    }

    updateSidebarActive(path) {
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('href') === `#${path}`) {
                item.classList.add('active');
            }
        });
    }

    syncAssistantFocusMode(path) {
        const sidebar = document.querySelector('.sidebar');
        const appRoot = document.getElementById('app');
        if (!sidebar || !appRoot) return;

        const enteringFocus = path === '/customer/create';
        if (enteringFocus && this.focusSidebarWasCollapsed === null) {
            this.focusSidebarWasCollapsed = sidebar.classList.contains('collapsed');
        }

        appRoot.classList.toggle('assistant-focus-navigation', enteringFocus);
        if (enteringFocus) {
            sidebar.classList.add('collapsed');
        } else if (this.focusSidebarWasCollapsed !== null) {
            sidebar.classList.toggle('collapsed', this.focusSidebarWasCollapsed);
            this.focusSidebarWasCollapsed = null;
        }
    }
}
