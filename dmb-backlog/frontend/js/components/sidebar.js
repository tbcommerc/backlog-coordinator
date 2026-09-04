/**
 * Backlog Coordinator - Sidebar Component
 */

export function renderSidebar() {
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const user = window.app?.store?.get('currentUser');
    const adminAccess = user?.permissions?.admin || 'none';
    const deadLetterLink = adminAccess === 'full' ? `
                <a href="#/outbox-dead-letters" class="sidebar-item" aria-label="Ошибки доставки событий">
                    <i data-lucide="alert-triangle"></i>
                    <span>Ошибки доставки</span>
                </a>` : '';
    const adminLinks = adminAccess !== 'none' ? `
                ${adminAccess === 'full' ? `<a href="#/reporting-meetings" class="sidebar-item" aria-label="Управление отчётными встречами">
                    <i data-lucide="calendar-clock"></i>
                    <span>Отчётные встречи</span>
                </a>` : ''}
                <a href="#/admin" class="sidebar-item" aria-label="Администрирование">
                    <i data-lucide="shield"></i>
                    <span>Администрирование</span>
                </a>
                <a href="#/audit-log" class="sidebar-item" aria-label="Аудит действий">
                    <i data-lucide="scroll-text"></i>
                    <span>Аудит действий</span>
                </a>
                ${deadLetterLink}` : '';
    const developmentBadge = `
                    <span class="item-badge sidebar-development-badge" title="В разработке" aria-label="В разработке">
                        <i data-lucide="code-2" aria-hidden="true"></i>
                    </span>`;
    return `
    <aside class="sidebar${collapsed ? ' collapsed' : ''}">
        <div class="sidebar-logo">
            <div class="logo-icon" aria-hidden="true">
                <svg viewBox="0 0 36 36" focusable="false">
                    <rect class="brand-card-back" x="4" y="5" width="23" height="24" rx="6" />
                    <rect class="brand-card-front" x="9" y="8" width="23" height="24" rx="6" />
                    <path class="brand-list-lines" d="M14 14h11M14 19h8" />
                    <circle class="brand-check-bg" cx="24" cy="25" r="5.5" />
                    <path class="brand-check" d="m21.5 25 1.7 1.7 3.4-3.7" />
                </svg>
            </div>
            <span class="logo-text">Backlog Coordinator</span>
        </div>
        
        <nav class="sidebar-nav">
            <div class="sidebar-section">
                <div class="sidebar-section-title">Управление бэклогом</div>
                <a href="#/dashboard" class="sidebar-item active" aria-label="Главная">
                    <i data-lucide="layout-dashboard"></i>
                    <span>Главная</span>
                </a>
                <a href="#/backlog" class="sidebar-item" aria-label="Бэклог DMB">
                    <i data-lucide="list"></i>
                    <span>Бэклог DMB</span>
                </a>
                <a href="#/team-backlog" class="sidebar-item" aria-label="Бэклог команды">
                    <i data-lucide="users"></i>
                    <span>Бэклог команды</span>
                </a>
                <a href="#/express-estimate" class="sidebar-item" aria-label="Экспресс-оценка">
                    <i data-lucide="zap"></i>
                    <span>Экспресс-оценка</span>
                    ${developmentBadge}
                </a>
                <a href="#/kanban" class="sidebar-item" aria-label="Канбан-доска">
                    <i data-lucide="columns"></i>
                    <span>Канбан-доска</span>
                </a>
            </div>
            
            <div class="sidebar-section">
                <div class="sidebar-section-title">Аналитика</div>
                <a href="#/reports" class="sidebar-item" aria-label="Статусы для встреч">
                    <i data-lucide="file-text"></i>
                    <span>Статусы для встреч</span>
                </a>
                <a href="#/analytics/tribe" class="sidebar-item" aria-label="Аналитика ЛТ">
                    <i data-lucide="trending-up"></i>
                    <span>Аналитика ЛТ</span>
                </a>
                <a href="#/analytics/po-pl" class="sidebar-item" aria-label="Аналитика PO/PL">
                    <i data-lucide="bar-chart-2"></i>
                    <span>Аналитика PO/PL</span>
                </a>
                <a href="#/analytics/it" class="sidebar-item" aria-label="Аналитика для ИТ">
                    <i data-lucide="loader2"></i>
                    <span>Аналитика для ИТ</span>
                    ${developmentBadge}
                </a>
            </div>
            
            <div class="sidebar-section">
                <div class="sidebar-section-title">Бизнес-заказчику</div>
                <a href="#/customer" class="sidebar-item" aria-label="Мои запросы">
                    <i data-lucide="briefcase"></i>
                    <span>Мои запросы</span>
                </a>
                <a href="#/customer/create" class="sidebar-item sidebar-item-sub" aria-label="Создать запрос">
                    <i data-lucide="bot"></i>
                    <span>ИИ-ассистент</span>
                </a>
                <a href="#/review" class="sidebar-item" aria-label="Ревью запросов">
                    <i data-lucide="clipboard-check"></i>
                    <span>Ревью запросов</span>
                </a>
            </div>

            <div class="sidebar-section">
                <div class="sidebar-section-title">Настройки и администрирование</div>
                <a href="#/notifications" class="sidebar-item" aria-label="Мои уведомления">
                    <i data-lucide="bell"></i>
                    <span>Мои уведомления</span>
                    <span class="item-badge" id="notification-count">0</span>
                </a>
                <a href="#/settings" class="sidebar-item" aria-label="Настройки">
                    <i data-lucide="settings"></i>
                    <span>Настройки</span>
                </a>
                ${adminLinks}
            </div>
        </nav>
        <button class="sidebar-toggle" title="Свернуть/развернуть" aria-label="Свернуть или развернуть боковую панель">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
    </aside>
    `;
}

export function initSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggle = sidebar?.querySelector('.sidebar-toggle');
    if (!sidebar || !toggle) return;

    sidebar.querySelectorAll('.sidebar-item[aria-label]').forEach(item => {
        item.title = item.getAttribute('aria-label');
    });

    toggle.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', isCollapsed);
    });

    // Permission-based visibility (hides items without access)
    setTimeout(() => {
        const user = window.app?.store?.get('currentUser');
        const perms = user?.permissions;
        if (perms?.customer_portal_mode === 'only') {
            const allowedLabels = new Set(['Мои запросы', 'Создать запрос']);
            document.querySelectorAll('.sidebar-item').forEach(el => {
                if (!allowedLabels.has(el.getAttribute('aria-label'))) {
                    el.style.display = 'none';
                }
            });
            document.querySelectorAll('.sidebar-section').forEach(section => {
                const hasVisibleItem = [...section.querySelectorAll('.sidebar-item')]
                    .some(el => el.style.display !== 'none');
                if (!hasVisibleItem) section.style.display = 'none';
            });
            return;
        }
        if (!perms) return; // no permissions data yet — keep everything visible
        const map = {
            'Бэклог DMB': 'backlog_dmb',
            'Канбан-доска': 'backlog_dmb',
            'Бэклог команды': 'backlog_team',
            'Экспресс-оценка': 'backlog_team',
            'Статусы для встреч': 'reports',
            'Управление отчётными встречами': 'admin',
            'Аналитика ЛТ': 'analytics',
            'Аналитика PO/PL': 'analytics',
            'Аналитика для ИТ': 'analytics',
            'Мои запросы': 'customer',
            'Создать запрос': 'customer',
            'Настройки': 'settings',
            'Администрирование': 'admin',
            'Аудит действий': 'admin',
            'Dead-letter outbox': 'admin',
        };
        document.querySelectorAll('.sidebar-item').forEach(el => {
            const label = el.getAttribute('aria-label');
            const perm = map[label];
            if (perm && (perms[perm] || 'none') === 'none') {
                el.style.display = 'none';
            }
            if (label === 'Ревью запросов') {
                const canReview = (perms.review || 'none') !== 'none';
                if (!canReview) {
                    el.style.display = 'none';
                }
            }
        });
    }, 100);
}
