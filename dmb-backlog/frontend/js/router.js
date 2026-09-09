import { renderDashboard, initDashboard } from './components/dashboard.js?v=6';
import { renderTasksPage, initTasksPage } from './components/taskTable.js?v=116';
import { renderTeamBacklog, initTeamBacklog } from './components/teamBacklog.js?v=117';
import { renderExpressEstimate, initExpressEstimate } from './components/expressEstimate.js?v=30';
import { renderKanban, initKanban } from './components/kanbanBoard.js?v=5';
import { renderReports, initReports, renderReportPage, initReportPage, renderReportingMeetingsManagement, initReportingMeetingsManagement } from './components/reports.js?v=19';
import { renderAnalytics, initAnalytics } from './components/analytics.js?v=18';
import { renderNotifications, initNotifications } from './components/notifications.js?v=11';
import { renderSettings, initSettings } from './components/settings.js';
import { renderAdmin, initAdmin } from './components/admin.js?v=1';
import { renderCustomerPortal, initCustomerPortal, renderRequestPage, initRequestPage, renderCustomerTaskPage, initCustomerTaskPage } from './components/customerPortal.js';
import { renderAgentChat, initAgentChat } from './components/agentChat.js?v=20';
import { renderAuditLog, initAuditLog } from './components/auditLog.js';
import { renderOutboxDeadLetters, initOutboxDeadLetters } from './components/outboxDeadLetters.js?v=1';
import { renderReviewPage, initReviewPage, renderReviewDetailPage, initReviewDetailPage } from './components/reviewPage.js?v=1';
import { renderReportingStatuses, initReportingStatuses } from './components/reportingStatuses.js?v=11';

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
            '/reporting-meetings': { render: renderReportingMeetingsManagement, init: initReportingMeetingsManagement },
            '/reports/detail': { render: renderReportPage, init: initReportPage },
            '/analytics/tribe': { render: (app) => renderAnalytics('tribe', app), init: (app) => initAnalytics('tribe', app) },
            '/analytics/po-pl': { render: (app) => renderAnalytics('po-pl', app), init: (app) => initAnalytics('po-pl', app) },
            '/analytics/it': { render: (app) => renderAnalytics('it', app), init: (app) => initAnalytics('it', app) },
            '/notifications': { render: renderNotifications, init: initNotifications },
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
        this.lastDeepLinkedTask = null;
        this.focusSidebarWasCollapsed = null;
        this.navigationGeneration = 0;
    }

    init() {
        window.addEventListener('hashchange', () => this.handleRoute());
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

    pushTaskRoute(taskId, tab = 'main') {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        if (Number(params.get('task')) === Number(taskId)) return;
        params.set('task', String(taskId));
        if (tab && tab !== 'main') params.set('tab', tab);
        else params.delete('tab');
        const nextHash = `${path}?${params.toString()}`;
        history.pushState({ ...(history.state || {}), dmbTaskModal: true }, '', '#' + nextHash);
        this.lastHash = nextHash;
        this.lastDeepLinkedTask = `${path}:${Number(taskId)}`;
    }

    updateTaskTabRoute(tab) {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        if (!params.has('task')) return;
        if (tab && tab !== 'main') params.set('tab', tab);
        else params.delete('tab');
        const nextHash = `${path}?${params.toString()}`;
        history.replaceState(history.state, '', '#' + nextHash);
        this.lastHash = nextHash;
    }

    clearTaskRoute() {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const params = new URLSearchParams(query);
        if (!params.has('task')) return;
        if (history.state?.dmbTaskModal) {
            history.back();
            return;
        }
        params.delete('task');
        params.delete('tab');
        const nextHash = params.toString() ? `${path}?${params.toString()}` : path;
        history.replaceState(history.state, '', '#' + nextHash);
        this.lastHash = nextHash;
        this.lastDeepLinkedTask = null;
    }

    openDeepLinkedTask(path, query) {
        const params = new URLSearchParams(query);
        const linkedTaskId = Number(params.get('task'));
        const linkedTaskTab = params.get('tab') || 'main';
        if (Number.isInteger(linkedTaskId) && linkedTaskId > 0) {
            const deepLinkKey = `${path}:${linkedTaskId}`;
            if (this.lastDeepLinkedTask !== deepLinkKey) {
                this.lastDeepLinkedTask = deepLinkKey;
                setTimeout(() => document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: linkedTaskId, tab: linkedTaskTab } })), 100);
            } else {
                document.dispatchEvent(new CustomEvent('task-tab-change', { detail: { taskId: linkedTaskId, tab: linkedTaskTab } }));
            }
        } else {
            this.lastDeepLinkedTask = null;
        }
    }

    async handleRoute() {
        const generation = ++this.navigationGeneration;
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path, query = ''] = hash.split('?');
        const from = this.lastHash;

        const user = this.app?.store?.get('currentUser');
        const businessCustomerAllowedPaths = new Set(['/customer', '/customer/create']);
        const isCustomerRequestDetail = /^\/customer\/request\/\d+$/.test(path);
        const isCustomerTaskDetail = /^\/customer\/task\/\d+$/.test(path);
        if (user?.permissions?.customer_portal_mode === 'only' && !businessCustomerAllowedPaths.has(path) && !isCustomerRequestDetail && !isCustomerTaskDetail) {
            if (window.location.hash !== '#/customer') {
                history.replaceState(null, '', '#/customer');
            }
            return this.handleRoute();
        }
        const adminAccess = user?.permissions?.admin || 'none';
        const requiresAdmin = path === '/admin' || path === '/audit-log';
        const requiresFullAdmin = path === '/outbox-dead-letters' || path === '/reporting-meetings';
        if ((requiresAdmin && adminAccess === 'none') || (requiresFullAdmin && adminAccess !== 'full')) {
            const container = document.getElementById('page-content');
            if (container) {
                container.innerHTML = `<div class="state-page state-forbidden"><h1>Недостаточно прав</h1><p>Раздел доступен пользователям с административным доступом.</p><a class="btn btn-primary" href="#/dashboard">Вернуться на главную</a></div>`;
            }
            this.updateSidebarActive(path);
            return;
        }

        if (this.onBeforeNavigate && from !== null && hash !== from) {
            const ok = await this.onBeforeNavigate(path, from);
            if (!ok) {
                if (from !== hash && from !== null) {
                    history.replaceState(null, '', '#' + from);
                }
                return;
            }
        }
        this.lastHash = hash;
        this.syncAssistantFocusMode(path);
        const fromPath = from?.split('?')[0];
        if (from !== null && path === fromPath) {
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
        }

        const resolved = dynamicHandler || route;

        if (resolved) {
            const container = document.getElementById('page-content');
            if (container) {
                const markup = await resolved.render(this.app);
                if (generation !== this.navigationGeneration || (window.location.hash.slice(1) || this.defaultRoute) !== hash) return;
                container.innerHTML = markup;

                if (window.lucide) {
                    window.lucide.createIcons();
                }

                // Update breadcrumb
                const bc = document.getElementById('breadcrumb-nav');
                if (bc) {
                    const names = {
                        '/dashboard': 'Главная',
                        '/backlog': 'Бэклог DMB',
                        '/team-backlog': 'Бэклог команды',
                        '/express-estimate': 'Экспресс-оценка',
                        '/kanban': 'Канбан-доска',
                        '/reports': 'Статусы для встреч',
                        '/reporting-statuses': 'Заполнение статусов',
                        '/reporting-meetings': 'Управление отчётными встречами',
                        '/reports/detail': 'Статус-отчёт',
                        '/analytics/tribe': 'Аналитика ЛТ',
                        '/analytics/po-pl': 'Аналитика PO/PL',
                        '/analytics/it': 'Аналитика для ИТ',
                        '/notifications': 'Мои уведомления',
                        '/settings': 'Настройки',
                        '/admin': 'Администрирование',
                        '/audit-log': 'Аудит действий',
                        '/outbox-dead-letters': 'Ошибки доставки событий',
                        '/customer': 'Мои запросы',
                        '/customer/create': 'ИИ-ассистент',
                        '/review': 'Ревью запросов',
                    };
                    const pageName = names[path] || (requestMatch ? 'Запрос' : '') || (customerTaskMatch ? 'Задача по запросу' : '') || (reviewMatch ? 'Ревью запроса' : path);
                    // For multi-segment paths like /analytics/tribe, only show the final name
                    const segments = path.split('/').filter(Boolean);
                    if (segments.length <= 1 || !names[path]) {
                        bc.innerHTML = `
                            <span class="breadcrumb-current">${pageName}</span>`;
                    } else {
                        // Build intermediate links only for named parent paths
                        let path = '';
                        const links = [];
                        for (let i = 0; i < segments.length; i++) {
                            path += '/' + segments[i];
                            if (i === segments.length - 1) {
                                links.push(`<span class="breadcrumb-current">${pageName}</span>`);
                            } else if (names[path]) {
                                links.push(`<a href="#${path}" class="breadcrumb-parent">${names[path]}</a>`);
                            }
                        }
                        bc.innerHTML = `
                            ${links.join('<span class="breadcrumb-separator">/</span>')}`;
                    }
                }

                // Call page-specific init
                if (resolved.init) {
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
