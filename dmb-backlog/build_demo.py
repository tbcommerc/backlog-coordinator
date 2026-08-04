"""
Сборка demo.html из исходников
"""
import re, json, os

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

# ── Читаем CSS ──
tokens = read_file(r'D:\Проект\dmb-backlog\frontend\css\tokens.css')
base = read_file(r'D:\Проект\dmb-backlog\frontend\css\base.css')
components = read_file(r'D:\Проект\dmb-backlog\frontend\css\components.css')
pages = read_file(r'D:\Проект\dmb-backlog\frontend\css\pages.css')

def min_css(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    css = re.sub(r'\s+', ' ', css)
    css = re.sub(r'\s*([{};,:])\s*', r'\1', css)
    css = re.sub(r';\s*}', '}', css)
    return css.strip()

all_css = min_css(tokens) + min_css(base) + min_css(components) + min_css(pages)

# ── Мок-данные ──
USERS = [
    {"email":"t.babiak@dmb.ru","name":"Т. Бабиак","team":"ИТ ЛТ","role":"ЛТ"},
    {"email":"a@dmb.ru","name":"Администратор","team":"ИТ ЛТ","role":"Администратор"},
    {"email":"a.koptelev@dmb.ru","name":"А. Коптелов","team":"ИТ ЛТ","role":"ЛТ"},
    {"email":"m.pervak@dmb.ru","name":"М. Первак","team":"Pre-Trade","role":"IT PL"},
    {"email":"d.fomin@dmb.ru","name":"Д. Фомин","team":"Pre-Trade","role":"PO"},
    {"email":"d.markus@dmb.ru","name":"Д. Маркус","team":"Post-Trade (Products & Service)","role":"IT PL"},
    {"email":"d.kozlov@dmb.ru","name":"Д. Козлов","team":"Post-Trade (Products & Service)","role":"PO"},
    {"email":"v.baklushin@dmb.ru","name":"В. Баклушин","team":"Core","role":"IT PL"},
    {"email":"r.khachatryan@dmb.ru","name":"Р. Хачатрян","team":"Core","role":"PO"},
    {"email":"a.mazunin@dmb.ru","name":"А. Мазунин","team":"IB","role":"IT PL"},
    {"email":"u.shilov@dmb.ru","name":"Ю. Шилов","team":"IB","role":"PO"},
    {"email":"d.andreev@dmb.ru","name":"Д. Андреев","team":"Post-Trade (Finance)","role":"PO"},
    {"email":"l.kulikov@dmb.ru","name":"Л. Куликов","team":"Delivery","role":"IT PL"},
    {"email":"i.yakovlev@dmb.ru","name":"И. Яковлев","team":"Methodology","role":"IT PL"},
    {"email":"i.mishutin@dmb.ru","name":"И. Мишутин","team":"AI","role":"IT PL"},
    {"email":"v.stodolsky@dmb.ru","name":"В. Стодольский","team":"Проектный офис","role":"IT PL"},
    {"email":"a.smirnov@dmb.ru","name":"А. Смирнов","team":"Core","role":"BA"},
    {"email":"d.volkov@dmb.ru","name":"Д. Волков","team":"AI","role":"BA"},
]

TASKS_DATA = [
    ("Интеграция с MOEX API","Pre-Trade","requirements","ВЫСОКИЙ","2Q 2026",30,8.5,45.0,40,"Почта","УСИ","М. Первак"),
    ("Модуль ценообразования деривативов","Pre-Trade","in_progress","ВЫСОКИЙ","4Q 2026",60,15.0,80.0,60,"Встреча/Звонок","РИСКИ","Д. Фомин"),
    ("Распределённое кэширование котировок","Pre-Trade","team_assigned","СРЕДНИЙ","3Q 2026",25,5.0,12.0,0,"СберЧат","IB","М. Первак"),
    ("OpenAPI документация Pre-Trade API","Pre-Trade","quick_estimate","НИЗКИЙ","1Q 2026",10,2.0,3.0,0,"Почта","УСИ",""),
    ("Интеграция с системой риск-метрик","Pre-Trade","check_requirements","ВЫСОКИЙ","Y2026",40,10.0,50.0,10,"Встреча/Звонок","РИСКИ","М. Первак"),
    ("Дашборд P&L Pre-Trade","Pre-Trade","clarify_requirements","СРЕДНИЙ","2Q 2026",20,4.0,8.0,0,"СберЧат","ФИНАНСЫ","Д. Фомин"),
    ("Стресс-тестирование портфеля деривативов","Pre-Trade","decision","ВЫСОКИЙ","1Q 2027",55,12.0,60.0,20,"Бизнес-план","РИСКИ","М. Первак"),
    ("Рефакторинг модуля пост-трейд расчётов","Post-Trade (Products & Service)","in_progress","ВЫСОКИЙ","3Q 2026",45,11.0,35.0,50,"Почта","ЦУП","Д. Маркус"),
    ("Автоматизация пост-трейд сверки","Post-Trade (Products & Service)","requirements","ВЫСОКИЙ","4Q 2026",50,12.0,70.0,15,"Встреча/Звонок","ЦУП","Д. Козлов"),
    ("Оптимизация процесса реконсиляции","Post-Trade (Products & Service)","new","СРЕДНИЙ","2Q 2026",20,3.5,5.0,0,"СберЧат","ФИНАНСЫ","Д. Козлов"),
    ("Интеграция с депозитарным учётом","Post-Trade (Products & Service)","team_assigned","СРЕДНИЙ","Y2026",35,8.0,25.0,0,"Бизнес-план","ФИНАНСЫ","Д. Маркус"),
    ("Отчётность по Basel III для пост-трейд","Post-Trade (Products & Service)","check_requirements","ВЫСОКИЙ","1Q 2026",40,9.0,45.0,30,"Почта","РИСКИ","Д. Маркус"),
    ("Единый справочник контрагентов IB","IB","in_progress","ВЫСОКИЙ","4Q 2026",55,14.0,90.0,70,"Бизнес-план","IB","А. Мазунин"),
    ("API шлюз для брокерских систем","IB","requirements","ВЫСОКИЙ","3Q 2026",40,10.0,55.0,25,"Встреча/Звонок","IB","Ю. Шилов"),
    ("Модуль управления ликвидностью IB","IB","quick_estimate","СРЕДНИЙ","1Q 2027",45,11.0,40.0,0,"Почта","ФИНАНСЫ","А. Мазунин"),
    ("Feature flags для IB платформы","IB","team_assigned","НИЗКИЙ","2Q 2026",15,3.0,5.0,0,"СберЧат","IB","Ю. Шилов"),
    ("Интеграция IB с MOEX","IB","clarify_requirements","ВЫСОКИЙ","4Q 2026",50,13.0,75.0,0,"Бизнес-план","IB","А. Мазунин"),
    ("Сканер сделок для IB","IB","decision","ВЫСОКИЙ","2Q 2027",60,15.0,85.0,10,"Встреча/Звонок","IB","Ю. Шилов"),
    ("Разработка сервиса нотификаций","Core","in_progress","ВЫСОКИЙ","3Q 2026",35,7.5,20.0,45,"Почта","УРК","В. Баклушин"),
    ("Миграция легаси-сервисов на микросервисы","Core","in_progress","ВЫСОКИЙ","Y2026",80,18.0,95.0,35,"Бизнес-план","УРК","Р. Хачатрян"),
    ("Модуль аудита действий пользователей","Core","requirements","СРЕДНИЙ","2Q 2026",30,6.0,15.0,10,"Встреча/Звонок","РИСКИ","В. Баклушин"),
    ("Оптимизация запросов к БД ядра","Core","quick_estimate","СРЕДНИЙ","1Q 2026",20,4.0,8.0,0,"СберЧат","УРК","Р. Хачатрян"),
    ("Система управления конфигурациями","Core","team_assigned","НИЗКИЙ","2Q 2026",15,3.5,6.0,0,"Почта","УРК",""),
    ("Мониторинг и алертинг ядра","Core","new","СРЕДНИЙ","1Q 2026",20,4.5,10.0,0,"Почта","УРК","А. Смирнов"),
    ("Двухфакторная аутентификация","Core","check_requirements","ВЫСОКИЙ","3Q 2026",25,5.0,18.0,0,"Встреча/Звонок","РИСКИ","В. Баклушин"),
    ("Внедрение CI/CD pipeline","Delivery","in_progress","ВЫСОКИЙ","2Q 2026",25,5.5,12.0,55,"СберЧат","УРК","Л. Куликов"),
    ("Автоматизация интеграционного тестирования","Delivery","requirements","СРЕДНИЙ","3Q 2026",30,6.0,15.0,20,"Почта","УРК","Л. Куликов"),
    ("Управление конфигурациями сред","Delivery","new","НИЗКИЙ","4Q 2026",15,3.0,5.0,0,"Почта","УРК",""),
    ("Чеклист качества релизов","Delivery","team_assigned","СРЕДНИЙ","1Q 2026",10,2.0,4.0,0,"Встреча/Звонок","УРК","Л. Куликов"),
    ("Финансовая отчётность по МСФО","Post-Trade (Finance)","in_progress","ВЫСОКИЙ","4Q 2026",50,12.0,65.0,60,"Бизнес-план","ФИНАНСЫ","Д. Андреев"),
    ("Автоматизация расчёта торговых сборов","Post-Trade (Finance)","requirements","ВЫСОКИЙ","3Q 2026",35,8.0,30.0,15,"Почта","ФИНАНСЫ","Д. Андреев"),
    ("Дашборд P&L для казначейства","Post-Trade (Finance)","quick_estimate","СРЕДНИЙ","2Q 2026",25,5.0,12.0,0,"СберЧат","ФИНАНСЫ","Д. Андреев"),
    ("Оптимизация отчётов по Basel III","Post-Trade (Finance)","check_requirements","ВЫСОКИЙ","1Q 2026",40,9.0,40.0,30,"Встреча/Звонок","РИСКИ","Д. Андреев"),
    ("Интеграция с системой управления ликвидностью","Post-Trade (Finance)","clarify_requirements","СРЕДНИЙ","4Q 2026",20,4.0,8.0,0,"Бизнес-план","ФИНАНСЫ","Д. Андреев"),
    ("ML-модель предиктивной аналитики рынка","AI","in_progress","ВЫСОКИЙ","1Q 2027",70,16.0,75.0,40,"Бизнес-план","IB","И. Мишутин"),
    ("AI-справочная система по клиентам","AI","requirements","ВЫСОКИЙ","2Q 2027",60,14.0,55.0,10,"Встреча/Звонок","IB","Д. Волков"),
    ("Модуль стресс-тестирования портфеля","AI","decision","СРЕДНИЙ","Y2026",50,11.0,35.0,20,"Почта","РИСКИ","И. Мишутин"),
    ("NLP-анализ клиентских коммуникаций","AI","new","СРЕДНИЙ","4Q 2026",45,10.0,25.0,0,"СберЧат","IB","Д. Волков"),
    ("Внедрение Data Quality framework","Methodology","requirements","ВЫСОКИЙ","3Q 2026",35,7.0,18.0,15,"Встреча/Звонок","ЦР","И. Яковлев"),
    ("Стандарты документации процессов","Methodology","new","СРЕДНИЙ","2Q 2026",20,3.5,6.0,0,"Почта","ЦИ","И. Яковлев"),
    ("Система управления задачами для CL","Methodology","quick_estimate","НИЗКИЙ","4Q 2026",15,3.0,4.0,0,"Почта","ЦР","И. Яковлев"),
    ("Мониторинг статусов ключевых проектов","Проектный офис","in_progress","ВЫСОКИЙ","1Q 2026",10,2.0,5.0,80,"Почта","РЕГ. ДИРЕКТОРЫ","В. Стодольский"),
    ("План импортозамещения DMB","Проектный офис","requirements","ВЫСОКИЙ","2Q 2026",30,6.0,20.0,40,"Бизнес-план","РЕГ. ДИРЕКТОРЫ","В. Стодольский"),
    ("Бюджетирование IT-проектов","Проектный офис","check_requirements","СРЕДНИЙ","1Q 2026",15,3.5,8.0,0,"Бизнес-план","ФИНАНСЫ","Т. Бабиак"),
]

import datetime, random
today = datetime.date.today()
BC_KEYS = ["ДИД","ДРП","ДИТ","ДБ","УБР","ДКП"]
DIR_STATUSES = ["В работе","На контроле","Риск","Выполнен"]
DID_STATUSES = ["В работе","Требует решения","Закрыта","Блокировано"]
STATUSES = ["НОВАЯ ЗАДАЧА","НАЗНАЧЕНА КОМАНДА","СБОР ТРЕБОВАНИЙ","ПРОВЕРКА ТРЕБОВАНИЙ","УТОЧНЕНИЕ ТРЕБОВАНИЙ","ЭКСПРЕСС-ОЦЕНКА","ПРИНЯТИЕ РЕШЕНИЯ","ПРИНЯТА В РАБОТУ","ОТКЛОНЕНА","НЕ АКТУАЛЬНА","ВЫПОЛНЕНА","ЭСКАЛАЦИЯ НА ЛТ","ХОЛД"]
TASK_TYPES = ["КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ","AD-HOC","ТЕХДОЛГ","ИССЛЕДОВАНИЕ","МЕТРИЧЕСКИЕ KR"]

TASKS = []
for idx, t in enumerate(TASKS_DATA):
    title, team, status, prio, deadline, ed, er, fe, progress, ch, dept, owner = t
    TASKS.append({
        "id": idx + 1,
        "title": title,
        "team_name": team,
        "status": status,
        "status_name": status,
        "priority": prio,
        "priority_name": prio,
        "deadline": deadline,
        "deadline_name": deadline,
        "effort_days": ed,
        "effort_rub": er,
        "financial_effect": fe,
        "progress": progress,
        "channel": ch,
        "department": dept,
        "owner_name": owner if owner else "",
        "business_customer": BC_KEYS[idx % len(BC_KEYS)],
        "task_type": TASK_TYPES[idx % len(TASK_TYPES)],
        "task_type_name": TASK_TYPES[idx % len(TASK_TYPES)],
        "description": "Описание задачи: " + title + ". Выполняется командой " + team + ".",
        "date_received": (today - datetime.timedelta(days=(44 - idx) * 3)).isoformat(),
        "updated_at": (today - datetime.timedelta(days=idx % 14)).isoformat(),
        "key_project": idx < 15,
        "is_from_leadership": idx % 5 == 0,
        "is_regular": idx % 7 == 0,
        "ice_score": round(random.uniform(3.0, 9.5), 1),
        "directorate_status": DIR_STATUSES[idx % len(DIR_STATUSES)],
        "did_status": DID_STATUSES[idx % len(DID_STATUSES)],
        "comment": "Комментарий по задаче" if idx % 3 == 0 else None,
        "tags": ["regulatory","backend"] if idx % 4 == 0 else [],
        "link_mockups": "https://figma.com/example" if idx % 6 == 0 else None,
        "link_jira": "https://jira.dmb.ru/browse/DMB-" + str(idx + 100) if idx % 5 == 0 else None,
        "dod": "1. Код написан\n2. Тесты пройдены\n3. Code Review пройден" if idx % 8 == 0 else None,
        "what_if": "При задержке на 2 недели — перенос на следующий квартал" if idx % 9 == 0 else None,
    })

MOCK_JSON = json.dumps({
    "users": USERS,
    "tasks": TASKS,
}, ensure_ascii=False)

# ── Формируем JS-код ──
# Используем обычные строки (НЕ f-строки) во избежание конфликта с ${} в JS

SIDEBAR_HTML = '''<aside class="sidebar">
    <div class="sidebar-logo"><div class="logo-icon">D</div><span class="logo-text">DMB Backlog</span></div>
    <nav class="sidebar-nav">
        <div class="sidebar-section">
            <div class="sidebar-section-title">Управление бэклогом</div>
            <a href="#/dashboard" class="sidebar-item active"><i data-lucide="layout-dashboard"></i><span>Главная</span></a>
            <a href="#/backlog" class="sidebar-item"><i data-lucide="list"></i><span>Бэклог DMB</span></a>
            <a href="#/team-backlog" class="sidebar-item"><i data-lucide="users"></i><span>Бэклог команды</span></a>
            <a href="#/express-estimate" class="sidebar-item"><i data-lucide="zap"></i><span>Экспресс-оценка</span></a>
            <a href="#/kanban" class="sidebar-item"><i data-lucide="columns"></i><span>Канбан-доска</span></a>
        </div>
        <div class="sidebar-section">
            <div class="sidebar-section-title">Аналитика</div>
            <a href="#/reports" class="sidebar-item"><i data-lucide="file-text"></i><span>Статусы для встреч</span></a>
            <a href="#/analytics/tribe" class="sidebar-item"><i data-lucide="trending-up"></i><span>Аналитика ЛТ</span></a>
            <a href="#/analytics/po-pl" class="sidebar-item"><i data-lucide="bar-chart-2"></i><span>Аналитика PO/PL</span></a>
        </div>
        <div class="sidebar-section">
            <div class="sidebar-section-title">Бизнес-заказчику</div>
            <a href="#/customer" class="sidebar-item"><i data-lucide="briefcase"></i><span>Мои задачи</span></a>
            <a href="#/customer/create" class="sidebar-item sidebar-item-sub"><i data-lucide="plus-circle"></i><span>Создать задачу</span></a>
        </div>
        <div class="sidebar-section">
            <div class="sidebar-section-title">Настройки и администрирование</div>
            <a href="#/notifications" class="sidebar-item"><i data-lucide="bell"></i><span>Мои уведомления</span><span class="item-badge" id="notification-count">0</span></a>
            <a href="#/settings" class="sidebar-item"><i data-lucide="settings"></i><span>Настройки</span></a>
            <a href="#/admin" class="sidebar-item"><i data-lucide="shield"></i><span>Администрирование</span></a>
        </div>
    </nav>
    <button class="sidebar-toggle" title="Свернуть/развернуть">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </button>
</aside>'''

LOGIN_HTML = '''<div id="login-screen" style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;background:radial-gradient(circle at 20% 20%,rgba(99,102,241,0.25),transparent 40%),radial-gradient(circle at 80% 80%,rgba(16,185,129,0.18),transparent 40%),linear-gradient(135deg,#0f172a 0%,#1e293b 100%);">
    <div style="width:100%;max-width:448px;">
        <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 30px 60px -10px rgba(15,23,42,0.4),0 0 0 1px rgba(255,255,255,0.06);">
            <div style="padding:32px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                    <div style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:white;background:linear-gradient(135deg,#6366f1 0%,#818cf8 100%);flex-shrink:0;">
                        <i data-lucide="layers" style="width:20px;height:20px;"></i>
                    </div>
                    <div><div style="font-weight:700;color:#0f172a;font-size:18px;">DMB Backlog</div></div>
                </div>
                <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0;">Добро пожаловать</h2>
                <p style="font-size:14px;color:#64748b;margin-top:4px;margin-bottom:0;">Введите учётные данные для продолжения</p>
                <form id="login-form" style="margin-top:24px;">
                    <div style="margin-bottom:16px;">
                        <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">Email</label>
                        <div style="position:relative;">
                            <i data-lucide="mail" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:#94a3b8;pointer-events:none;"></i>
                            <input id="login-email" type="email" value="t.babiak@dmb.ru" style="width:100%;padding:12px 16px 12px 36px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:white;color:#0f172a;box-sizing:border-box;">
                        </div>
                    </div>
                    <div style="margin-bottom:16px;">
                        <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">Пароль</label>
                        <div style="position:relative;">
                            <i data-lucide="lock" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:#94a3b8;pointer-events:none;"></i>
                            <input id="login-password" type="password" style="width:100%;padding:12px 40px 12px 36px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:white;color:#0f172a;box-sizing:border-box;">
                            <button id="login-pw-toggle" type="button" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);padding:6px;border:none;background:transparent;cursor:pointer;border-radius:4px;color:#94a3b8;">
                                <i id="login-eye" data-lucide="eye" style="width:16px;height:16px;display:block;"></i>
                            </button>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#64748b;">
                            <i data-lucide="lightbulb" style="width:14px;height:14px;color:#f59e0b;flex-shrink:0;"></i>
                            <span>Подсказка: пароль <code style="background:#f1f5f9;color:#334155;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">dmb2026</code></span>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;padding-top:4px;margin-bottom:16px;">
                        <label style="display:flex;align-items:center;gap:8px;font-size:14px;color:#475569;cursor:pointer;">
                            <input type="checkbox" checked style="accent-color:#6366f1;width:16px;height:16px;">
                            <span>Запомнить меня</span>
                        </label>
                        <a style="font-size:14px;font-weight:600;color:#6366f1;cursor:pointer;">Забыли пароль?</a>
                    </div>
                    <div id="login-error" style="display:none;align-items:center;gap:8px;font-size:12px;padding:8px 12px;border-radius:8px;background:#fff1f2;border:1px solid #fecaca;color:#be123c;margin-bottom:16px;">
                        <i data-lucide="alert-circle" style="width:16px;height:16px;flex-shrink:0;"></i>
                        <span>Неверный пароль. Попробуйте ещё раз.</span>
                    </div>
                    <button id="login-btn" type="submit" style="width:100%;padding:12px;background:#6366f1;color:white;font-weight:600;border:none;border-radius:8px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 1px 3px rgba(99,102,241,0.3);">
                        <i data-lucide="log-in" style="width:16px;height:16px;"></i>
                        <span id="login-btn-text">Войти в систему</span>
                    </button>
                </form>
            </div>
            <div style="padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;background:#f8fafc;">
                <p style="font-size:12px;color:#64748b;margin:0;">&copy; 2026 DMB Backlog &middot; <a style="color:#6366f1;font-weight:600;cursor:pointer;">Поддержка</a></p>
            </div>
        </div>
    </div>
</div>'''

# ── Собираем JS (обычная строка, без f-string) ──
js_parts = []
js_parts.append('''
// ── Mock Store ──
class Store {
    constructor() { this.state = {}; this.listeners = {}; }
    get(k) { return this.state[k]; }
    set(k, v) { this.state[k] = v; this.notify(k, v); }
    subscribe(k, cb) { (this.listeners[k] = this.listeners[k] || []).push(cb); return () => { this.listeners[k] = this.listeners[k].filter(c => c !== cb); }; }
    notify(k, v) { if (this.listeners[k]) this.listeners[k].forEach(cb => cb(v)); }
}

// ── Mock Data ──
const MOCK = ''' + MOCK_JSON + ''';

const TASKS = MOCK.tasks;
const USERS = MOCK.users;

// ── Helpers ──
function getUserInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name[0].toUpperCase();
}

function getAvatarColor(name) {
    const colors = ['#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#f97316','#f59e0b','#10b981','#06b6d4','#0ea5e9'];
    if (!name) return colors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function escHtml(str) {
    if (!str) return '';
    const m = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return String(str).replace(/[&<>"']/g, c => m[c]);
}
''')

js_parts.append('''
// ── Render functions ──
function renderLoginPage() {
    const app = document.getElementById('app');
    app.innerHTML = `''' + LOGIN_HTML + '''`;
    if (window.lucide) window.lucide.createIcons();
    document.getElementById('login-pw-toggle')?.addEventListener('click', () => {
        const pw = document.getElementById('login-password');
        const eye = document.getElementById('login-eye');
        if (pw.type === 'password') { pw.type = 'text'; eye.setAttribute('data-lucide', 'eye-off'); }
        else { pw.type = 'password'; eye.setAttribute('data-lucide', 'eye'); }
        if (window.lucide) window.lucide.createIcons();
    });
    document.getElementById('login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pw = document.getElementById('login-password').value;
        const user = USERS.find(u => u.email === email);
        if (user && pw === 'dmb2026') {
            window.currentUser = user;
            const initials = getUserInitials(user.name);
            const color = getAvatarColor(user.name);
            const ad = document.getElementById('avatar-display');
            const un = document.getElementById('user-name-display');
            if (ad) { ad.textContent = initials; ad.style.background = color; }
            if (un) un.textContent = user.name;
            renderAppLayout();
        } else {
            const el = document.getElementById('login-error');
            if (el) el.style.display = 'flex';
        }
    });
}

const SIDEBAR_HTML = `''' + SIDEBAR_HTML + '''`;

function renderAppShell(content) {
    const user = window.currentUser || USERS[0];
    const initials = getUserInitials(user.name);
    const avatarColor = getAvatarColor(user.name);
    return `<aside class="sidebar">
        <div class="sidebar-logo"><div class="logo-icon">D</div><span class="logo-text">DMB Backlog</span></div>
        <nav class="sidebar-nav">
            <div class="sidebar-section">
                <div class="sidebar-section-title">\\u0423\\u043f\\u0440\\u0430\\u0432\\u043b\\u0435\\u043d\\u0438\\u0435 \\u0431\\u044d\\u043a\\u043b\\u043e\\u0433\\u043e\\u043c</div>
                <a href="#/dashboard" class="sidebar-item active"><i data-lucide="layout-dashboard"></i><span>\\u0413\\u043b\\u0430\\u0432\\u043d\\u0430\\u044f</span></a>
                <a href="#/backlog" class="sidebar-item"><i data-lucide="list"></i><span>\\u0411\\u044d\\u043a\\u043b\\u043e\\u0433 DMB</span></a>
                <a href="#/team-backlog" class="sidebar-item"><i data-lucide="users"></i><span>\\u0411\\u044d\\u043a\\u043b\\u043e\\u0433 \\u043a\\u043e\\u043c\\u0430\\u043d\\u0434\\u044b</span></a>
                <a href="#/express-estimate" class="sidebar-item"><i data-lucide="zap"></i><span>\\u042d\\u043a\\u0441\\u043f\\u0440\\u0435\\u0441\\u0441-\\u043e\\u0446\\u0435\\u043d\\u043a\\u0430</span></a>
                <a href="#/kanban" class="sidebar-item"><i data-lucide="columns"></i><span>\\u041a\\u0430\\u043d\\u0431\\u0430\\u043d-\\u0434\\u043e\\u0441\\u043a\\u0430</span></a>
            </div>
            <div class="sidebar-section">
                <div class="sidebar-section-title">\\u0410\\u043d\\u0430\\u043b\\u0438\\u0442\\u0438\\u043a\\u0430</div>
                <a href="#/reports" class="sidebar-item"><i data-lucide="file-text"></i><span>\\u0421\\u0442\\u0430\\u0442\\u0443\\u0441\\u044b \\u0434\\u043b\\u044f \\u0432\\u0441\\u0442\\u0440\\u0435\\u0447</span></a>
                <a href="#/analytics/tribe" class="sidebar-item"><i data-lucide="trending-up"></i><span>\\u0410\\u043d\\u0430\\u043b\\u0438\\u0442\\u0438\\u043a\\u0430 \\u041b\\u0422</span></a>
                <a href="#/analytics/po-pl" class="sidebar-item"><i data-lucide="bar-chart-2"></i><span>\\u0410\\u043d\\u0430\\u043b\\u0438\\u0442\\u0438\\u043a\\u0430 PO/PL</span></a>
            </div>
            <div class="sidebar-section">
                <div class="sidebar-section-title">\\u0411\\u0438\\u0437\\u043d\\u0435\\u0441-\\u0437\\u0430\\u043a\\u0430\\u0437\\u0447\\u0438\\u043a\\u0443</div>
                <a href="#/customer" class="sidebar-item"><i data-lucide="briefcase"></i><span>\\u041c\\u043e\\u0438 \\u0437\\u0430\\u0434\\u0430\\u0447\\u0438</span></a>
                <a href="#/customer/create" class="sidebar-item sidebar-item-sub"><i data-lucide="plus-circle"></i><span>\\u0421\\u043e\\u0437\\u0434\\u0430\\u0442\\u044c \\u0437\\u0430\\u0434\\u0430\\u0447\\u0443</span></a>
            </div>
            <div class="sidebar-section">
                <div class="sidebar-section-title">\\u041d\\u0430\\u0441\\u0442\\u0440\\u043e\\u0439\\u043a\\u0438 \\u0438 \\u0430\\u0434\\u043c\\u0438\\u043d\\u0438\\u0441\\u0442\\u0440\\u0438\\u0440\\u043e\\u0432\\u0430\\u043d\\u0438\\u0435</div>
                <a href="#/notifications" class="sidebar-item"><i data-lucide="bell"></i><span>\\u041c\\u043e\\u0438 \\u0443\\u0432\\u0435\\u0434\\u043e\\u043c\\u043b\\u0435\\u043d\\u0438\\u044f</span><span class="item-badge" id="notification-count">0</span></a>
                <a href="#/settings" class="sidebar-item"><i data-lucide="settings"></i><span>\\u041d\\u0430\\u0441\\u0442\\u0440\\u043e\\u0439\\u043a\\u0438</span></a>
                <a href="#/admin" class="sidebar-item"><i data-lucide="shield"></i><span>\\u0410\\u0434\\u043c\\u0438\\u043d\\u0438\\u0441\\u0442\\u0440\\u0438\\u0440\\u043e\\u0432\\u0430\\u043d\\u0438\\u0435</span></a>
            </div>
        </nav>
        <button class="sidebar-toggle" title="\\u0421\\u0432\\u0435\\u0440\\u043d\\u0443\\u0442\\u044c/\\u0440\\u0430\\u0437\\u0432\\u0435\\u0440\\u043d\\u0443\\u0442\\u044c">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
    </aside>
    <div class="sidebar-backdrop"></div>
    <div class="main-wrapper">
        <header class="navbar">
            <div style="display:flex;align-items:center;gap:8px;">
                <button class="btn-hamburger" id="sidebar-toggle-mobile" title="\\u041c\\u0435\\u043d\\u044e">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
                <nav id="breadcrumb-nav" style="display:flex;align-items:center;gap:8px;font-size:14px;">
                    <a href="#/dashboard" style="color:var(--text-muted);text-decoration:none;">DMB Backlog</a>
                    <span style="color:var(--text-muted);">/</span>
                    <span id="breadcrumb-current" style="color:var(--text-primary);font-weight:500;">\\u0413\\u043b\\u0430\\u0432\\u043d\\u0430\\u044f</span>
                </nav>
            </div>
            <div class="search-wrap" style="position:relative;flex:1;max-width:400px;margin:0 16px;">
                <i data-lucide="search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text-muted);pointer-events:none;"></i>
                <input type="text" id="global-search" placeholder="\\u041f\\u043e\\u0438\\u0441\\u043a \\u0437\\u0430\\u0434\\u0430\\u0447..." class="search-input" style="padding-left:36px;">
                <div id="search-results" class="search-dropdown hidden"></div>
            </div>
            <div class="navbar-right" style="display:flex;align-items:center;gap:4px;">
                <button onclick="router.navigate('/notifications')" style="position:relative;padding:8px;border-radius:8px;border:none;background:transparent;cursor:pointer;">
                    <i data-lucide="bell" style="width:20px;height:20px;display:block;color:var(--text-primary);"></i>
                    <span id="notif-badge" class="notif-badge hidden">0</span>
                </button>
                <div style="width:1px;height:24px;background:var(--border-color);margin:0 4px;"></div>
                <button id="theme-toggle" style="padding:8px;border-radius:8px;border:none;background:transparent;cursor:pointer;color:var(--text-muted);" title="\\u041f\\u0435\\u0440\\u0435\\u043a\\u043b\\u044e\\u0447\\u0438\\u0442\\u044c \\u0442\\u0435\\u043c\\u0443">
                    <i data-lucide="moon" style="width:20px;height:20px;display:block;color:var(--text-primary);"></i>
                </button>
                <button id="logout-btn" style="padding:8px;border-radius:8px;border:none;background:transparent;cursor:pointer;color:var(--text-muted);" title="\\u0412\\u044b\\u0439\\u0442\\u0438">
                    <i data-lucide="log-out" style="width:20px;height:20px;display:block;color:var(--text-primary);"></i>
                </button>
                <div style="width:1px;height:24px;background:var(--border-color);margin:0 4px;"></div>
                <div style="position:relative;">
                    <button id="user-avatar-btn" style="display:flex;align-items:center;gap:8px;padding:4px 8px 4px 4px;border-radius:8px;border:none;background:transparent;cursor:pointer;">
                        <div id="avatar-display" style="width:28px;height:28px;border-radius:50%;background:` + "'" + `${avatarColor}` + "'" + `;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:700;flex-shrink:0;">` + "`" + `${initials}` + "`" + `</div>
                        <span id="user-name-display" style="font-size:14px;font-weight:500;color:var(--text-primary);">` + "`" + `${user?.name || 'User'}` + "`" + `</span>
                    </button>
                    <div id="user-dropdown" class="dropdown-menu hidden">
                        <button onclick="router.navigate('/settings')" class="dropdown-item"><i data-lucide="settings" style="width:16px;height:16px;"></i> \\u041d\\u0430\\u0441\\u0442\\u0440\\u043e\\u0439\\u043a\\u0438</button>
                    </div>
                </div>
            </div>
        </header>
        <main class="main-content" id="page-content">` + (content || '') + `</main>
    </div>`;
}
''')

js_parts.append('''
function renderAppLayout() {
    const app = document.getElementById('app');
    app.innerHTML = renderAppShell('<div class="page-header"><h1>\\u0413\\u043b\\u0430\\u0432\\u043d\\u0430\\u044f</h1><p>\\u0414\\u043e\\u0431\\u0440\\u043e \\u043f\\u043e\\u0436\\u0430\\u043b\\u043e\\u0432\\u0430\\u0442\\u044c \\u0432 DMB Backlog</p></div><div class="grid-3" id="dash-stats"></div><div id="dash-content"></div>');
    if (window.lucide) window.lucide.createIcons();
    initApp();
}

function initApp() {
    const sidebar = document.querySelector('.sidebar');
    sidebar?.querySelector('.sidebar-toggle')?.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            const href = this.getAttribute('href');
            if (href) router.navigate(href.replace('#', ''));
        });
    });
    document.getElementById('logout-btn')?.addEventListener('click', () => renderLoginPage());
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
        const icon = document.querySelector('#theme-toggle [data-lucide]');
        if (icon) icon.setAttribute('data-lucide', isDark ? 'moon' : 'sun');
        if (window.lucide) window.lucide.createIcons();
    });
    const avatarBtn = document.getElementById('user-avatar-btn');
    const dropdown = document.getElementById('user-dropdown');
    avatarBtn?.addEventListener('click', (e) => { e.stopPropagation(); dropdown?.classList.toggle('hidden'); });
    document.addEventListener('click', () => dropdown?.classList.add('hidden'));
    renderDashboard();
}
''')

js_parts.append('''
// ── Dashboard ──
function renderDashboard() {
    const total = TASKS.length;
    const inProgress = TASKS.filter(t => t.status === 'in_progress' || t.status === '\\u041f\\u0420\\u0418\\u041d\\u042f\\u0422\\u0410 \\u0412 \\u0420\\u0410\\u0411\\u041e\\u0422\\u0423').length;
    const high = TASKS.filter(t => t.priority === '\\u0412\\u042b\\u0421\\u041e\\u041a\\u0418\\u0419').length;
    const done = TASKS.filter(t => t.status === 'done' || t.status === '\\u0412\\u042b\\u041f\\u041e\\u041b\\u041d\\u0415\\u041d\\u0410').length;
    const ds = document.getElementById('dash-stats');
    if (ds) ds.innerHTML = '<div class="stat-card"><div class="stat-icon" style="background:var(--accent-light);color:var(--accent);"><i data-lucide="list" style="width:20px;height:20px;"></i></div><div class="stat-body"><div class="stat-value">' + total + '</div><div class="stat-label">\\u0412\\u0441\\u0435\\u0433\\u043e \\u0437\\u0430\\u0434\\u0430\\u0447</div></div></div><div class="stat-card"><div class="stat-icon" style="background:var(--info-light);color:var(--info);"><i data-lucide="play-circle" style="width:20px;height:20px;"></i></div><div class="stat-body"><div class="stat-value">' + inProgress + '</div><div class="stat-label">\\u0412 \\u0440\\u0430\\u0431\\u043e\\u0442\\u0435</div></div></div><div class="stat-card"><div class="stat-icon" style="background:var(--danger-light);color:var(--danger);"><i data-lucide="alert-triangle" style="width:20px;height:20px;"></i></div><div class="stat-body"><div class="stat-value">' + high + '</div><div class="stat-label">\\u0412\\u044b\\u0441\\u043e\\u043a\\u0438\\u0439 \\u043f\\u0440\\u0438\\u043e\\u0440\\u0438\\u0442\\u0435\\u0442</div></div></div><div class="stat-card"><div class="stat-icon" style="background:var(--success-light);color:var(--success);"><i data-lucide="check-circle" style="width:20px;height:20px;"></i></div><div class="stat-body"><div class="stat-value">' + done + '</div><div class="stat-label">\\u0412\\u044b\\u043f\\u043e\\u043b\\u043d\\u0435\\u043d\\u043e</div></div></div>';
    if (window.lucide) window.lucide.createIcons();
    const taskSlice = TASKS.slice(0, 10);
    const html = taskSlice.map(t => '<tr class="dash-task-row" data-task-index="' + TASKS.indexOf(t) + '" style="cursor:pointer;">' +
        '<td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);">#' + t.id + '</td>' +
        '<td style="font-weight:500;">' + escHtml(t.title) + '</td>' +
        '<td>' + t.team_name + '</td>' +
        '<td>' + statusBadge(t.status_name) + '</td>' +
        '<td>' + prioBadge(t.priority_name) + '</td>' +
        '<td style="color:var(--text-muted);font-size:12px;">' + t.deadline_name + '</td>' +
        '<td><div class="progress-bar" style="width:80px;display:inline-block;"><div class="progress-fill" style="width:' + t.progress + '%;height:6px;"></div></div></td>' +
        '</tr>').join('');
    const dc = document.getElementById('dash-content');
    if (dc) {
        dc.innerHTML = '<div class="card"><div class="card-header"><div class="card-title">\\u041f\\u043e\\u0441\\u043b\\u0435\\u0434\\u043d\\u0438\\u0435 \\u0437\\u0430\\u0434\\u0430\\u0447\\u0438</div></div><table class="table"><thead><tr><th>ID</th><th>\\u0417\\u0430\\u0434\\u0430\\u0447\\u0430</th><th>\\u041a\\u043e\\u043c\\u0430\\u043d\\u0434\\u0430</th><th>\\u0421\\u0442\\u0430\\u0442\\u0443\\u0441</th><th>\\u041f\\u0440\\u0438\\u043e\\u0440\\u0438\\u0442\\u0435\\u0442</th><th>\\u0421\\u0440\\u043e\\u043a</th><th>\\u041f\\u0440\\u043e\\u0433\\u0440\\u0435\\u0441\\u0441</th></tr></thead><tbody>' + html + '</tbody></table></div>';
        dc.querySelectorAll('.dash-task-row').forEach(row => {
            row.addEventListener('click', () => {
                const idx = parseInt(row.dataset.taskIndex);
                openTaskDetail(TASKS[idx]);
            });
        });
    }
}
''')

js_parts.append('''
function statusBadge(status) {
    const c = {\\u0027\\u041d\\u041e\\u0412\\u0410\\u042f \\u0417\\u0410\\u0414\\u0410\\u0427\\u0410\\u0027:\\u0027#6b7280\\u0027,\\u0027\\u041d\\u0410\\u0417\\u041d\\u0410\\u0427\\u0415\\u041d\\u0410 \\u041a\\u041e\\u041c\\u0410\\u041d\\u0414\\u0410\\u0027:\\u0027#6b7280\\u0027,\\u0027\\u0421\\u0411\\u041e\\u0420 \\u0422\\u0420\\u0415\\u0411\\u041e\\u0412\\u0410\\u041d\\u0418\\u0419\\u0027:\\u0027#6b7280\\u0027,\\u0027\\u041f\\u0420\\u041e\\u0412\\u0415\\u0420\\u041a\\u0410 \\u0422\\u0420\\u0415\\u0411\\u041e\\u0412\\u0410\\u041d\\u0418\\u0419\\u0027:\\u0027#6b7280\\u0027,\\u0027\\u0423\\u0422\\u041e\\u0427\\u041d\\u0415\\u041d\\u0418\\u0415 \\u0422\\u0420\\u0415\\u0411\\u041e\\u0412\\u0410\\u041d\\u0418\\u0419\\u0027:\\u0027#6b7280\\u0027,\\u0027\\u042d\\u041a\\u0421\\u041f\\u0420\\u0415\\u0421\\u0421-\\u041e\\u0426\\u0415\\u041d\\u041a\\u0410\\u0027:\\u0027#6b7280\\u0027,\\u0027\\u041f\\u0420\\u0418\\u041d\\u042f\\u0422\\u0418\\u0415 \\u0420\\u0415\\u0428\\u0415\\u041d\\u0418\\u042f\\u0027:\\u0027#f59e0b\\u0027,\\u0027\\u041f\\u0420\\u0418\\u041d\\u042f\\u0422\\u0410 \\u0412 \\u0420\\u0410\\u0411\\u041e\\u0422\\u0423\\u0027:\\u0027#3b82f6\\u0027,\\u0027\\u042d\\u0421\\u041a\\u0410\\u041b\\u0410\\u0426\\u0418\\u042f \\u041d\\u0410 \\u041b\\u0422\\u0027:\\u0027#8b5cf6\\u0027,\\u0027\\u0425\\u041e\\u041b\\u0414\\u0027:\\u0027#8b5cf6\\u0027,\\u0027\\u041e\\u0422\\u041a\\u041b\\u041e\\u041d\\u0415\\u041d\\u0410\\u0027:\\u0027#ef4444\\u0027,\\u0027\\u041d\\u0415 \\u0410\\u041a\\u0422\\u0423\\u0410\\u041b\\u042c\\u041d\\u0410\\u0027:\\u0027#94a3b8\\u0027,\\u0027\\u0412\\u042b\\u041f\\u041e\\u041b\\u041d\\u0415\\u041d\\u0410\\u0027:\\u0027#10b981\\u0027};
    const b = {\\u0027\\u041d\\u041e\\u0412\\u0410\\u042f \\u0417\\u0410\\u0414\\u0410\\u0427\\u0410\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u041d\\u0410\\u0417\\u041d\\u0410\\u0427\\u0415\\u041d\\u0410 \\u041a\\u041e\\u041c\\u0410\\u041d\\u0414\\u0410\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u0421\\u0411\\u041e\\u0420 \\u0422\\u0420\\u0415\\u0411\\u041e\\u0412\\u0410\\u041d\\u0418\\u0419\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u041f\\u0420\\u041e\\u0412\\u0415\\u0420\\u041a\\u0410 \\u0422\\u0420\\u0415\\u0411\\u041e\\u0412\\u0410\\u041d\\u0418\\u0419\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u0423\\u0422\\u041e\\u0427\\u041d\\u0415\\u041d\\u0418\\u0415 \\u0422\\u0420\\u0415\\u0411\\u041e\\u0412\\u0410\\u041d\\u0418\\u0419\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u042d\\u041a\\u0421\\u041f\\u0420\\u0415\\u0421\\u0421-\\u041e\\u0426\\u0415\\u041d\\u041a\\u0410\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u041f\\u0420\\u0418\\u041d\\u042f\\u0422\\u0418\\u0415 \\u0420\\u0415\\u0428\\u0415\\u041d\\u0418\\u042f\\u0027:\\u0027#fef3c7\\u0027,\\u0027\\u041f\\u0420\\u0418\\u041d\\u042f\\u0422\\u0410 \\u0412 \\u0420\\u0410\\u0411\\u041e\\u0422\\u0423\\u0027:\\u0027#dbeafe\\u0027,\\u0027\\u042d\\u0421\\u041a\\u0410\\u041b\\u0410\\u0426\\u0418\\u042f \\u041d\\u0410 \\u041b\\u0422\\u0027:\\u0027#ede9fe\\u0027,\\u0027\\u0425\\u041e\\u041b\\u0414\\u0027:\\u0027#ede9fe\\u0027,\\u0027\\u041e\\u0422\\u041a\\u041b\\u041e\\u041d\\u0415\\u041d\\u0410\\u0027:\\u0027#fee2e2\\u0027,\\u0027\\u041d\\u0415 \\u0410\\u041a\\u0422\\u0423\\u0410\\u041b\\u042c\\u041d\\u0410\\u0027:\\u0027#f1f5f9\\u0027,\\u0027\\u0412\\u042b\\u041f\\u041e\\u041b\\u041d\\u0415\\u041d\\u0410\\u0027:\\u0027#d1fae5\\u0027};
    const col = c[status]||'#6b7280'; const bg = b[status]||'#f1f5f9';
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;background:' + bg + ';color:' + col + ';"><span style="width:6px;height:6px;border-radius:50%;background:' + col + ';display:inline-block;"></span>' + status + '</span>';
}
''')

js_parts.append('''
function prioBadge(p) {
    const cm = {\\u0027\\u0412\\u042b\\u0421\\u041e\\u041a\\u0418\\u0419\\u0027:\\u0027#ef4444\\u0027,\\u0027\\u0421\\u0420\\u0415\\u0414\\u041d\\u0418\\u0419\\u0027:\\u0027#f59e0b\\u0027,\\u0027\\u041d\\u0418\\u0417\\u041a\\u0418\\u0419\\u0027:\\u0027#6b7280\\u0027};
    const bm = {\\u0027\\u0412\\u042b\\u0421\\u041e\\u041a\\u0418\\u0419\\u0027:\\u0027#fee2e2\\u0027,\\u0027\\u0421\\u0420\\u0415\\u0414\\u041d\\u0418\\u0419\\u0027:\\u0027#fef3c7\\u0027,\\u0027\\u041d\\u0418\\u0417\\u041a\\u0418\\u0419\\u0027:\\u0027#f1f5f9\\u0027};
    const c = cm[p]||'#6b7280'; const bg = bm[p]||'#f1f5f9';
    return '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;background:' + bg + ';color:' + c + ';">' + p + '</span>';
}
''')

js_parts.append('''
// ── Task Detail Modal ──
function renderKpiStrip(task) {
    const progress = task.progress || 0;
    const circumference = 2 * Math.PI * 15.5;
    const offset = circumference - (progress / 100) * circumference;
    const cv = task.financial_effect && task.effort_rub && task.effort_rub > 0 ? (task.financial_effect / task.effort_rub).toFixed(2) : '\\u2014';
    const ownerName = task.owner_name || '\\u2014';
    const initials = getUserInitials(ownerName);
    const avColor = getAvatarColor(ownerName);
    const finEffect = task.financial_effect != null ? Number(task.financial_effect).toLocaleString('ru-RU') : '\\u2014';
    return '<div class="task-detail-kpi-strip">' +
        '<div class="task-detail-kpi-item"><div class="kpi-ring-wrap"><svg viewBox="0 0 36 36" class="kpi-ring"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#e7e5e4" stroke-width="3"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="#6366f1" stroke-width="3" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" stroke-linecap="round"/></svg><div class="kpi-ring-text">' + progress + '%</div></div><div class="kpi-label">\\u041f\\u0440\\u043e\\u0433\\u0440\\u0435\\u0441\\u0441</div></div>' +
        '<div class="task-detail-kpi-item kpi-border-left"><div class="kpi-value">' + (task.ice_score != null ? task.ice_score.toFixed(1) : '\\u2014') + '</div><div class="kpi-label">ICE Score</div></div>' +
        '<div class="task-detail-kpi-item kpi-border-left"><div class="kpi-value">' + cv + '</div><div class="kpi-label">C / V</div></div>' +
        '<div class="task-detail-kpi-item kpi-border-left"><div class="kpi-value">' + finEffect + '</div><div class="kpi-label">\\u0424\\u0438\\u043d. \\u044d\\u0444\\u0444\\u0435\\u043a\\u0442, \\u20bd</div></div>' +
        '<div class="task-detail-kpi-item kpi-border-left"><div class="kpi-value">' + (task.effort_days != null ? task.effort_days : '\\u2014') + '</div><div class="kpi-label">\\u0422\\u0440\\u0443\\u0434\\u043e\\u0437\\u0430\\u0442\\u0440\\u0430\\u0442\\u044b, \\u0447/\\u0434</div></div>' +
        '<div class="task-detail-kpi-item kpi-border-left"><div style="display:flex;align-items:center;gap:8px"><div style="width:28px;height:28px;border-radius:50%;background:' + avColor + ';display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">' + initials + '</div><div><div style="font-size:13px;font-weight:600;color:var(--text-primary);">' + escHtml(ownerName) + '</div><div class="kpi-label">\\u0412\\u043b\\u0430\\u0434\\u0435\\u043b\\u0435\\u0446</div></div></div></div>' +
        '</div>';
}

function overviewTab(task) {
    let html = '<div class="task-detail-section-card">';
    html += '<div class="task-detail-section-title">\\u0411\\u043b\\u043e\\u043a 1 \\u00b7 \\u041e\\u0431\\u0449\\u0430\\u044f \\u0438\\u043d\\u0444\\u043e\\u0440\\u043c\\u0430\\u0446\\u0438\\u044f</div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u041d\\u0430\\u0437\\u0432\\u0430\\u043d\\u0438\\u0435</div><div class="task-detail-value"><strong>' + escHtml(task.title) + '</strong></div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u0422\\u0438\\u043f \\u0437\\u0430\\u0434\\u0430\\u0447\\u0438</div><div class="task-detail-value">' + escHtml(task.task_type_name) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u0421\\u0442\\u0430\\u0442\\u0443\\u0441</div><div class="task-detail-value">' + statusBadge(task.status_name) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u041f\\u0440\\u0438\\u043e\\u0440\\u0438\\u0442\\u0435\\u0442</div><div class="task-detail-value">' + prioBadge(task.priority_name) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u041a\\u043b\\u044e\\u0447\\u0435\\u0432\\u043e\\u0439 \\u043f\\u0440\\u043e\\u0435\\u043a\\u0442</div><div class="task-detail-value">' + (task.key_project ? '<span class="task-detail-badge" style="background:#fef3c7;color:#d97706;border-color:#f59e0b33;">\\u2b50 \\u0414\\u0430</span>' : '<span class="text-muted">\\u2014</span>') + '</div></div>';
    html += '<div class="task-detail-section-title">\\u0411\\u043b\\u043e\\u043a 2 \\u00b7 \\u0411\\u0438\\u0437\\u043d\\u0435\\u0441-\\u043a\\u043e\\u043d\\u0442\\u0435\\u043a\\u0441\\u0442</div>';
    html += '<div class="task-detail-info-row task-detail-info-row-full"><div class="task-detail-label">\\u041e\\u043f\\u0438\\u0441\\u0430\\u043d\\u0438\\u0435</div><div class="task-detail-value">' + escHtml(task.description) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u0411\\u0438\\u0437\\u043d\\u0435\\u0441-\\u0437\\u0430\\u043a\\u0430\\u0437\\u0447\\u0438\\u043a</div><div class="task-detail-value">' + escHtml(task.business_customer) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u041a\\u043e\\u043c\\u0430\\u043d\\u0434\\u0430</div><div class="task-detail-value">' + escHtml(task.team_name) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u0421\\u0440\\u043e\\u043a (\\u0434\\u0435\\u0434\\u043b\\u0430\\u0439\\u043d)</div><div class="task-detail-value">' + escHtml(task.deadline_name) + '</div></div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u041a\\u0430\\u043d\\u0430\\u043b \\u043f\\u043e\\u0441\\u0442\\u0443\\u043f\\u043b\\u0435\\u043d\\u0438\\u044f</div><div class="task-detail-value">' + escHtml(task.channel) + '</div></div>';
    if (task.tags && task.tags.length) {
        html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u0422\\u0435\\u0433\\u0438</div><div class="task-detail-value">' + task.tags.map(t => '<span class="task-detail-tag">' + escHtml(t) + '</span>').join(' ') + '</div></div>';
    }
    html += '</div>';
    return html;
}

function teamTab(task) {
    let html = '<div class="task-detail-section-card"><div class="task-detail-section-title">\\u0411\\u043b\\u043e\\u043a 1 \\u00b7 \\u041e\\u0442\\u0432\\u0435\\u0442\\u0441\\u0442\\u0432\\u0435\\u043d\\u043d\\u044b\\u0435</div>';
    html += '<div class="task-detail-info-row"><div class="task-detail-label">\\u041a\\u043e\\u043c\\u0430\\u043d\\u0434\\u0430</div><div class="task-detail-value"><span class="task-detail-chip task-detail-chip-indigo">' + escHtml(task.team_name) + '</span></div></div>';
    html += '<div class="task-detail-roles-grid">';
    const roles = [[task.owner_name, '\\u0412\\u043b\\u0430\\u0434\\u0435\\u043b\\u0435\\u0446 / PL'],[task.owner_name, '\\u041e\\u0442\\u0432\\u0435\\u0442\\u0441\\u0442\\u0432\\u0435\\u043d\\u043d\\u044b\\u0439 PO'],[task.owner_name, '\\u0411\\u0438\\u0437\\u043d\\u0435\\u0441-\\u0430\\u043d\\u0430\\u043b\\u0438\\u0442\\u0438\\u043a'],[task.owner_name, 'IT Product Lead'],[task.business_customer, '\\u0411\\u0438\\u0437\\u043d\\u0435\\u0441-\\u0437\\u0430\\u043a\\u0430\\u0437\\u0447\\u0438\\u043a']];
    roles.forEach(r => {
        if (!r[0]) return;
        const c = getAvatarColor(r[0]);
        const i = getUserInitials(r[0]);
        html += '<div class="task-detail-role-card"><div style="display:flex;align-items:center;gap:12px"><div style="width:36px;height:36px;border-radius:50%;background:' + c + ';display:flex;align-items:center;justify-content:center;color:white;font-size:14px;font-weight:700;">' + i + '</div><div><div class="task-detail-role-label">' + r[1] + '</div><div class="task-detail-role-name">' + escHtml(r[0]) + '</div></div></div></div>';
    });
    html += '</div></div>';
    return html;
}
''')

js_parts.append('''
function openTaskDetail(task) {
    const t = task;
    const statusName = t.status_name || t.status;
    const prioName = t.priority_name || t.priority;
    const finEffect = t.financial_effect != null ? Number(t.financial_effect).toLocaleString('ru-RU') + ' \\u20bd' : '\\u2014';
    const effDays = t.effort_days != null ? t.effort_days + ' \\u0447/\\u0434' : '\\u2014';
    const modal = document.createElement('div');
    modal.innerHTML = '<div class="modal-overlay" id="task-detail-overlay"><div class="task-detail-modal" id="task-detail-modal">' +
        '<div class="task-detail-modal-header"><div class="task-detail-header-left"><div class="task-detail-badges-row"><span class="task-detail-id">#' + t.id + '</span>' + statusBadge(statusName) + prioBadge(prioName) + '<span class="task-detail-badge" style="background:#f5f3ff;color:#5b21b6;border-color:#c7d2fe;">' + escHtml(t.task_type_name) + '</span>' + (t.key_project ? '<span class="task-detail-badge" style="background:#fef3c7;color:#d97706;border-color:#f59e0b33;">\\u2b50 \\u041a\\u043b\\u044e\\u0447\\u0435\\u0432\\u043e\\u0439</span>' : '') + '</div><h2 class="task-detail-title">' + escHtml(t.title) + '</h2></div><div class="task-detail-header-actions"><button class="task-detail-btn-icon" id="td-close-btn" title="\\u0417\\u0430\\u043a\\u0440\\u044b\\u0442\\u044c"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>' +
        renderKpiStrip(t) +
        '<div class="task-detail-tabs">' +
        '<button class="td-tab-btn active" data-tab="overview"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> \\u041e\\u0431\\u0437\\u043e\\u0440</button>' +
        '<button class="td-tab-btn" data-tab="team"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> \\u041a\\u043e\\u043c\\u0430\\u043d\\u0434\\u0430</button>' +
        '<button class="td-tab-btn" data-tab="metrics"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> \\u041c\\u0435\\u0442\\u0440\\u0438\\u043a\\u0438</button>' +
        '<button class="td-tab-btn" data-tab="docs"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> \\u0414\\u043e\\u043a\\u0443\\u043c\\u0435\\u043d\\u0442\\u044b</button>' +
        '<button class="td-tab-btn" data-tab="reports"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="M7 21h10"/><path d="M12 16v5"/></svg> \\u041e\\u0442\\u0447\\u0451\\u0442\\u043d\\u043e\\u0441\\u0442\\u044c</button>' +
        '<button class="td-tab-btn" data-tab="history"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg> \\u0418\\u0441\\u0442\\u043e\\u0440\\u0438\\u044f</button>' +
        '</div>' +
        '<div class="task-detail-modal-body" id="td-modal-body">' +
        '<div class="td-tab-panel active" id="tab-overview">' + overviewTab(t) + '</div>' +
        '<div class="td-tab-panel" id="tab-team">' + teamTab(t) + '</div>' +
        '<div class="td-tab-panel" id="tab-metrics"><div class="task-detail-section-card"><div style="text-align:center;padding:40px;color:var(--text-muted);">\\u041c\\u0435\\u0442\\u0440\\u0438\\u043a\\u0438: ICE Score ' + (t.ice_score != null ? t.ice_score.toFixed(1) : '\\u2014') + ', \\u0424\\u0438\\u043d\\u0430\\u043d\\u0441\\u043e\\u0432\\u044b\\u0439 \\u044d\\u0444\\u0444\\u0435\\u043a\\u0442 ' + finEffect + ', \\u0422\\u0440\\u0443\\u0434\\u043e\\u0437\\u0430\\u0442\\u0440\\u0430\\u0442\\u044b ' + effDays + '</div></div></div>' +
        '<div class="td-tab-panel" id="tab-docs"><div class="task-detail-section-card"><div style="text-align:center;padding:40px;color:var(--text-muted);">\\u041d\\u0435\\u0442 \\u043f\\u0440\\u0438\\u043a\\u0440\\u0435\\u043f\\u043b\\u0451\\u043d\\u043d\\u044b\\u0445 \\u0434\\u043e\\u043a\\u0443\\u043c\\u0435\\u043d\\u0442\\u043e\\u0432</div></div></div>' +
        '<div class="td-tab-panel" id="tab-reports"><div class="task-detail-section-card"><div class="task-detail-section-title">\\u0421\\u0442\\u0430\\u0442\\u0443\\u0441 \\u0434\\u043b\\u044f \\u043e\\u0442\\u0447\\u0451\\u0442\\u043e\\u0432</div><div class="task-detail-info-row"><div class="task-detail-label">\\u0414\\u0438\\u0440\\u0435\\u043a\\u0442\\u043e\\u0440\\u0441\\u043a\\u0430\\u044f</div><div class="task-detail-value">' + escHtml(t.directorate_status || '\\u2014') + '</div></div><div class="task-detail-info-row"><div class="task-detail-label">\\u0414\\u0418\\u0414</div><div class="task-detail-value">' + escHtml(t.did_status || '\\u2014') + '</div></div></div></div>' +
        '<div class="td-tab-panel" id="tab-history"><div class="task-detail-section-card"><div style="text-align:center;padding:40px;color:var(--text-muted);">\\u0418\\u0441\\u0442\\u043e\\u0440\\u0438\\u044f \\u0438\\u0437\\u043c\\u0435\\u043d\\u0435\\u043d\\u0438\\u0439 \\u043f\\u0443\\u0441\\u0442\\u0430</div></div></div>' +
        '</div>' +
        '<div class="task-detail-modal-footer"><div class="task-detail-footer-info"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>\\u041e\\u0431\\u043d\\u043e\\u0432\\u043b\\u0435\\u043d\\u043e: ' + (t.updated_at ? new Date(t.updated_at).toLocaleString('ru-RU') : '\\u2014') + '</span></div><div class="task-detail-footer-actions"><button class="task-detail-btn task-detail-btn-ghost" id="td-comment-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> \\u041a\\u043e\\u043c\\u043c\\u0435\\u043d\\u0442\\u0430\\u0440\\u0438\\u0439</button></div></div>' +
        '</div></div>';
    const overlay = modal.firstElementChild;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('td-close-btn')?.addEventListener('click', () => overlay.remove());
    document.addEventListener('keydown', function escHandler(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } });
    document.querySelectorAll('.td-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.td-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.td-tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById('tab-' + btn.dataset.tab);
            if (panel) panel.classList.add('active');
        });
    });
}
''')

js_parts.append('''
// ── Router ──
class Router {
    constructor() {
        this.routes = {};
    }
    init() {
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    }
    navigate(path) {
        window.location.hash = path;
    }
    handleRoute() {
        const hash = window.location.hash.slice(1) || '/dashboard';
        const names = {'/dashboard':'\\u0413\\u043b\\u0430\\u0432\\u043d\\u0430\\u044f','/backlog':'\\u0411\\u044d\\u043a\\u043b\\u043e\\u0433 DMB','/team-backlog':'\\u0411\\u044d\\u043a\\u043b\\u043e\\u0433 \\u043a\\u043e\\u043c\\u0430\\u043d\\u0434\\u044b','/express-estimate':'\\u042d\\u043a\\u0441\\u043f\\u0440\\u0435\\u0441\\u0441-\\u043e\\u0446\\u0435\\u043d\\u043a\\u0430','/kanban':'\\u041a\\u0430\\u043d\\u0431\\u0430\\u043d-\\u0434\\u043e\\u0441\\u043a\\u0430','/notifications':'\\u041c\\u043e\\u0438 \\u0443\\u0432\\u0435\\u0434\\u043e\\u043c\\u043b\\u0435\\u043d\\u0438\\u044f','/settings':'\\u041d\\u0430\\u0441\\u0442\\u0440\\u043e\\u0439\\u043a\\u0438','/admin':'\\u0410\\u0434\\u043c\\u0438\\u043d\\u0438\\u0441\\u0442\\u0440\\u0438\\u0440\\u043e\\u0432\\u0430\\u043d\\u0438\\u0435','/customer':'\\u041c\\u043e\\u0438 \\u0437\\u0430\\u0434\\u0430\\u0447\\u0438'};
        const bc = document.getElementById('breadcrumb-current');
        if (bc) bc.textContent = names[hash] || hash;
        if (hash === '/dashboard') renderDashboard();
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.toggle('active', item.getAttribute('href') === '#' + hash);
        });
    }
}

// ── Init ──
const router = new Router();
window.router = router;
const store = new Store();
window.store = store;

document.addEventListener('DOMContentLoaded', () => {
    renderLoginPage();
});

window.openTaskDetail = openTaskDetail;
window.renderLoginPage = renderLoginPage;
console.log('DMB Backlog Demo loaded \\u2014 ' + TASKS.length + ' tasks');
''')

js_code = ''.join(js_parts)

# ── Сборка HTML ──
html = '''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DMB Backlog — Демо</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<style>
''' + all_css + '''
</style>
</head>
<body>
<div id="app"></div>
<div id="toast-container"></div>
<script>
''' + js_code + '''
</script>
</body>
</html>'''

out_path = r'D:\Проект\dmb-backlog\demo.html'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

size = os.path.getsize(out_path)
print(f'OK demo.html written — {size} bytes ({size/1024:.1f} KB)')
