/**
 * DMB Backlog - Navbar Component
 */

export function renderNavbar() {
    return `
    <header class="navbar">
        <div class="navbar-left">
            <nav class="breadcrumb">
                <span class="current" id="breadcrumb-current">Главная</span>
            </nav>
        </div>
        <div class="navbar-right">
            <button class="btn btn-ghost btn-icon" title="Поиск" aria-label="Поиск">
                <i data-lucide="search"></i>
            </button>
            <button class="btn btn-ghost btn-icon" id="logout-btn" title="Выйти" aria-label="Выйти">
                <i data-lucide="log-out"></i>
            </button>
        </div>
    </header>
    `;
}
