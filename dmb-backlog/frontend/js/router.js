import { renderDashboard, initDashboard } from './components/dashboard.js';
import { renderTasksPage, initTasksPage } from './components/taskTable.js?v=45';
import { renderTeamBacklog, initTeamBacklog } from './components/teamBacklog.js?v=45';
import { renderExpressEstimate, initExpressEstimate } from './components/expressEstimate.js';
import { renderKanban, initKanban } from './components/kanbanBoard.js?v=4';
import { renderReports, initReports, renderReportPage, initReportPage } from './components/reports.js';
import { renderAnalytics, initAnalytics } from './components/analytics.js';
import { renderNotifications, initNotifications } from './components/notifications.js';
import { renderSettings, initSettings } from './components/settings.js';
import { renderAdmin, initAdmin } from './components/admin.js';
import { renderCustomerPortal, initCustomerPortal } from './components/customerPortal.js';
import { renderCustomerChat, initCustomerChat } from './components/customerChat.js';
import { renderAuditLog, initAuditLog } from './components/auditLog.js';

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
            '/reports/detail': { render: renderReportPage, init: initReportPage },
            '/analytics/tribe': { render: (app) => renderAnalytics('tribe', app), init: (app) => initAnalytics('tribe', app) },
            '/analytics/po-pl': { render: (app) => renderAnalytics('po-pl', app), init: (app) => initAnalytics('po-pl', app) },
            '/analytics/it': { render: (app) => renderAnalytics('it', app), init: (app) => initAnalytics('it', app) },
            '/notifications': { render: renderNotifications, init: initNotifications },
            '/settings': { render: renderSettings, init: initSettings },
            '/admin': { render: renderAdmin, init: initAdmin },
            '/audit-log': { render: renderAuditLog, init: initAuditLog },
            '/customer': { render: renderCustomerPortal, init: initCustomerPortal },
            '/customer/create': { render: renderCustomerChat, init: initCustomerChat },
        };
        this.defaultRoute = '/dashboard';
        this.onBeforeNavigate = null;
        this.lastHash = null;
    }

    init() {
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    }

    navigate(path) {
        window.location.hash = path;
    }

    async handleRoute() {
        const hash = window.location.hash.slice(1) || this.defaultRoute;
        const [path] = hash.split('?');
        const from = this.lastHash;

        if (this.onBeforeNavigate && from !== null && path !== from.split('?')[0]) {
            const ok = await this.onBeforeNavigate(path, from);
            if (!ok) {
                if (from !== hash && from !== null) {
                    history.replaceState(null, '', '#' + from);
                }
                return;
            }
        }
        this.lastHash = hash;

        const route = this.routes[path];

        if (route) {
            const container = document.getElementById('page-content');
            if (container) {
                container.innerHTML = route.render(this.app);

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
                        '/reports/detail': 'Статус-отчёт',
                        '/analytics/tribe': 'Аналитика ЛТ',
                        '/analytics/po-pl': 'Аналитика PO/PL',
                        '/analytics/it': 'Аналитика для ИТ',
                        '/notifications': 'Мои уведомления',
                        '/settings': 'Настройки',
                        '/admin': 'Администрирование',
                        '/audit-log': 'Аудит действий',
                        '/customer': 'Мои задачи',
                        '/customer/create': 'Создать задачу',
                    };
                    const pageName = names[hash] || hash;
                    // For multi-segment paths like /analytics/tribe, only show the final name
                    const segments = hash.split('/').filter(Boolean);
                    if (segments.length <= 1 || !names[hash]) {
                        bc.innerHTML = `
                            <a href="#/dashboard" style="color: var(--text-muted); text-decoration: none;">DMB Backlog</a>
                            <span style="color: var(--text-muted);">/</span>
                            <span style="color: var(--text-primary); font-weight: 500;">${pageName}</span>`;
                    } else {
                        // Build intermediate links only for named parent paths
                        let path = '';
                        const links = [];
                        for (let i = 0; i < segments.length; i++) {
                            path += '/' + segments[i];
                            if (i === segments.length - 1) {
                                links.push(`<span style="color: var(--text-primary); font-weight: 500;">${pageName}</span>`);
                            } else if (names[path]) {
                                links.push(`<a href="#${path}" style="color: var(--text-muted); text-decoration: none;">${names[path]}</a>`);
                            }
                        }
                        bc.innerHTML = `
                            <a href="#/dashboard" style="color: var(--text-muted); text-decoration: none;">DMB Backlog</a>
                            <span style="color: var(--text-muted);">/</span>
                            ${links.join('<span style="color: var(--text-muted);">/</span>')}`;
                    }
                }

                // Call page-specific init
                if (route.init) {
                    setTimeout(() => route.init(this.app), 50);
                }
            }
        } else {
            this.navigate(this.defaultRoute);
        }

        this.updateSidebarActive(hash);
    }

    updateSidebarActive(path) {
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('href') === `#${path}`) {
                item.classList.add('active');
            }
        });
    }
}
