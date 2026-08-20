/**
 * DMB Backlog - Sidebar Component
 */

export function renderSidebar() {
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    return `
    <aside class="sidebar${collapsed ? ' collapsed' : ''}">
        <div class="sidebar-logo">
            <div class="logo-icon">D</div>
            <span class="logo-text">DMB Backlog</span>
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
                    <span class="item-badge" title="В разработке" style="background:var(--bg-tertiary);color:var(--text-secondary);display:inline-flex;align-items:center;justify-content:center;padding:3px;min-width:20px;">
                        <i data-lucide="wrench" style="width:12px;height:12px;"></i>
                    </span>
                </a>
            </div>
            
            <div class="sidebar-section">
                <div class="sidebar-section-title">Бизнес-заказчику</div>
                <a href="#/customer" class="sidebar-item" aria-label="Мои задачи">
                    <i data-lucide="briefcase"></i>
                    <span>Мои задачи</span>
                </a>
                <a href="#/customer/create" class="sidebar-item sidebar-item-sub" aria-label="Создать задачу">
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
                <a href="#/admin" class="sidebar-item" aria-label="Администрирование">
                    <i data-lucide="shield"></i>
                    <span>Администрирование</span>
                </a>
                <a href="#/audit-log" class="sidebar-item" aria-label="Аудит действий">
                    <i data-lucide="scroll-text"></i>
                    <span>Аудит действий</span>
                </a>
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
        const roleName = String(user?.role_name || user?.role || '').trim().toLocaleLowerCase('ru-RU');
        if (roleName === 'бизнес-заказчик') {
            const allowedLabels = new Set(['Мои задачи', 'Создать задачу']);
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
            'Аналитика ЛТ': 'analytics',
            'Аналитика PO/PL': 'analytics',
            'Аналитика для ИТ': 'analytics',
            'Мои задачи': 'customer',
            'Создать задачу': 'customer',
            'Настройки': 'settings',
            'Администрирование': 'admin',
            'Аудит действий': 'admin',
        };
        document.querySelectorAll('.sidebar-item').forEach(el => {
            const label = el.getAttribute('aria-label');
            const perm = map[label];
            if (perm && (perms[perm] || 'none') === 'none') {
                el.style.display = 'none';
            }
            if (label === 'Ревью запросов') {
                const canReview = [
                    'po/pl/cl', 'ba/участник команды', 'ba/бизнес-аналитик',
                    'лидер трайба', 'проектный офис (админ)', 'администратор',
                ].includes(roleName);
                if (!canReview) {
                    el.style.display = 'none';
                }
            }
        });
    }, 100);
}
