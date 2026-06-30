from sqlalchemy.orm import Session
from database import SessionLocal, engine
from models import (
    User, Team, Role, Task, Report,
    Channel, Deadline, Department, Priority, TaskType, TeamType,
    ProjectStatus, TaskStatus, Project, BusinessCustomer,
    DictionaryItem
)
from auth import get_password_hash
from datetime import date, timedelta

ALL_DICT_ITEMS = [
    # priorities
    ("priority", "ВЫСОКИЙ", "high", "#f43f5e", 1),
    ("priority", "СРЕДНИЙ", "medium", "#f59e0b", 2),
    ("priority", "НИЗКИЙ", "low", "#94a3b8", 3),
    # statuses
    ("status", "НОВАЯ ЗАДАЧА", "new", "#3b82f6", 1),
    ("status", "НАЗНАЧЕНА КОМАНДА", "team_assigned", "#6366f1", 2),
    ("status", "СБОР ТРЕБОВАНИЙ", "requirements", "#8b5cf6", 3),
    ("status", "ПРОВЕРКА ТРЕБОВАНИЙ", "check_requirements", "#7c3aed", 4),
    ("status", "УТОЧНЕНИЕ ТРЕБОВАНИЙ", "clarify_requirements", "#a78bfa", 5),
    ("status", "ЭКСПРЕСС-ОЦЕНКА", "quick_estimate", "#6d28d9", 6),
    ("status", "ПРИНЯТИЕ РЕШЕНИЯ", "decision", "#f59e0b", 7),
    ("status", "ПРИНЯТА В РАБОТУ", "in_progress", "#10b981", 8),
    ("status", "ОТКЛОНЕНА", "rejected", "#ef4444", 9),
    ("status", "НЕ АКТУАЛЬНА", "irrelevant", "#94a3b8", 10),
    ("status", "ВЫПОЛНЕНА", "done", "#22c55e", 11),
    ("status", "ЭСКАЛАЦИЯ НА ЛТ", "escalation", "#f97316", 12),
    ("status", "ХОЛД", "hold", "#e11d48", 13),
    # task_types
    ("task_type", "КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ", "quarterly_goal", "#6366f1", 1),
    ("task_type", "AD-HOC", "adhoc", "#f59e0b", 2),
    ("task_type", "ТЕХДОЛГ", "tech_debt", "#f43f5e", 3),
    ("task_type", "ИССЛЕДОВАНИЕ", "research", "#10b981", 4),
    ("task_type", "МЕТРИЧЕСКИЕ KR", "metric_kr", "#8b5cf6", 5),
    ("task_type", "БИНАРНЫЕ KR", "binary_kr", "#0ea5e9", 6),
    # channels
    ("channel", "Почта", "email", "#6366f1", 1),
    ("channel", "СберЧат", "sberchat", "#10b981", 2),
    ("channel", "Встреча/Звонок", "meeting_call", "#f59e0b", 3),
    ("channel", "Бизнес-план", "bizplan", "#f43f5e", 4),
    # deadlines
    ("deadline", "1Q 2026", "Q1_2026", "#6366f1", 1),
    ("deadline", "2Q 2026", "Q2_2026", "#10b981", 2),
    ("deadline", "3Q 2026", "Q3_2026", "#f59e0b", 3),
    ("deadline", "4Q 2026", "Q4_2026", "#f43f5e", 4),
    ("deadline", "2026", "Y2026", "#8b5cf6", 5),
    ("deadline", "1Q 2027", "Q1_2027", "#0ea5e9", 6),
    ("deadline", "2Q 2027", "Q2_2027", "#14b8a6", 7),
    ("deadline", "БЕЗ СРОКА", "no_deadline", "#94a3b8", 8),
    # departments
    ("department", "УСИ", "USI", "#6366f1", 1),
    ("department", "IB", "IB", "#10b981", 2),
    ("department", "M&A", "MA", "#f59e0b", 3),
    ("department", "УРК", "URK", "#f43f5e", 4),
    ("department", "ЦУП", "CUP", "#8b5cf6", 5),
    ("department", "ФИНАНСЫ", "FINANCE", "#0ea5e9", 6),
    ("department", "РИСКИ", "RISKS", "#e11d48", 7),
    ("department", "ЦР", "CR", "#14b8a6", 8),
    ("department", "L2P", "L2P", "#a855f7", 9),
    ("department", "ЦИ", "CI", "#64748b", 10),
    ("department", "РЕГ. ДИРЕКТОРЫ", "REG_DIRECTORS", "#dc2626", 11),
    # team_types
    ("team_type", "С разработкой", "with_dev", "#6366f1", 1),
    ("team_type", "Без разработки", "without_dev", "#94a3b8", 2),
    # project_statuses
    ("project_status", "Активен", "active", "#10b981", 1),
    ("project_status", "Завершен", "completed", "#6366f1", 2),
    ("project_status", "Архивный", "archived", "#94a3b8", 3),
]


def seed_dict_always():
    """Always ensure dictionary entries exist (upsert by dict_type+code)."""
    db: Session = SessionLocal()
    try:
        added = 0
        for dt, name, code, color, sort in ALL_DICT_ITEMS:
            existing = db.query(DictionaryItem).filter(
                DictionaryItem.dict_type == dt,
                DictionaryItem.code == code,
            ).first()
            if existing:
                pass  # never overwrite user changes
            else:
                db.add(DictionaryItem(dict_type=dt, name=name, code=code, color=color, sort_order=sort))
                added += 1
        if added:
            db.commit()
            print(f"[seed] Dictionary items upserted: {added}")
    finally:
        db.close()


def seed_initial_data():
    """Seed database with initial data if empty"""
    db: Session = SessionLocal()

    if db.query(User).count() > 0:
        db.close()
        return

    print("Seeding initial data...")

    # ========= LOOKUP TABLES =========

    # --- Channels ---
    channels = {}
    for code, name in [
        ("email", "Почта"),
        ("sberchat", "СберЧат"),
        ("meeting_call", "Встреча/Звонок"),
        ("bizplan", "Бизнес-план"),
    ]:
        ch = Channel(code=code, name=name)
        db.add(ch)
        db.flush()
        channels[code] = ch
    channels[""] = None

    # --- Deadlines ---
    deadlines = {}
    for code, name in [
        ("Q1_2026", "1Q 2026"),
        ("Q2_2026", "2Q 2026"),
        ("Q3_2026", "3Q 2026"),
        ("Q4_2026", "4Q 2026"),
        ("Y2026", "Y2026"),
        ("Q1_2027", "1Q 2027"),
        ("Q2_2027", "2Q 2027"),
        ("no_deadline", "БЕЗ СРОКА"),
    ]:
        dl = Deadline(code=code, name=name)
        db.add(dl)
        db.flush()
        deadlines[code] = dl
    deadlines[None] = None

    # --- Departments ---
    departments = {}
    for code, name in [
        ("USI", "УСИ"),
        ("IB", "IB"),
        ("MA", "M&A"),
        ("URK", "УРК"),
        ("CUP", "ЦУП"),
        ("FINANCE", "ФИНАНСЫ"),
        ("RISKS", "РИСКИ"),
        ("CR", "ЦР"),
        ("L2P", "L2P"),
        ("CI", "ЦИ"),
        ("REG_DIRECTORS", "РЕГ. ДИРЕКТОРЫ"),
    ]:
        dep = Department(code=code, name=name)
        db.add(dep)
        db.flush()
        departments[code] = dep
    departments[""] = None

    # --- Priorities ---
    priorities = {}
    for name, sla in [("НИЗКИЙ", 2.0), ("СРЕДНИЙ", 1.5), ("ВЫСОКИЙ", 1.0)]:
        p = Priority(name=name, sla_multiplier=sla)
        db.add(p)
        db.flush()
        priorities[name] = p

    # --- Task Types ---
    task_types = {}
    for code, name, dod, fin in [
        ("quarterly_goal", "КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ", True, True),
        ("adhoc", "AD-HOC", False, False),
        ("tech_debt", "ТЕХДОЛГ", False, False),
        ("research", "ИССЛЕДОВАНИЕ", False, False),
        ("metric_kr", "МЕТРИЧЕСКИЕ KR", True, False),
        ("binary_kr", "БИНАРНЫЕ KR", True, False),
    ]:
        tt = TaskType(code=code, name=name, dod_required=dod, financial_value_required=fin)
        db.add(tt)
        db.flush()
        task_types[code] = tt

    # --- Team Types ---
    team_types = {}
    for code, name in [
        ("with_dev", "С разработкой"),
        ("without_dev", "Без разработки"),
    ]:
        tt = TeamType(code=code, name=name)
        db.add(tt)
        db.flush()
        team_types[code] = tt

    # --- Project Statuses ---
    project_statuses = {}
    for code, name in [
        ("active", "Активен"),
        ("completed", "Завершен"),
        ("archived", "Архивный"),
    ]:
        ps = ProjectStatus(code=code, name=name)
        db.add(ps)
        db.flush()
        project_statuses[code] = ps

    # --- Task Statuses ---
    task_statuses = {}
    status_data = [
        ("new", "НОВАЯ ЗАДАЧА", "backlog", 48, 1, "#3b82f6"),
        ("team_assigned", "НАЗНАЧЕНА КОМАНДА", "backlog", 48, 2, "#6366f1"),
        ("requirements", "СБОР ТРЕБОВАНИЙ", "backlog", 40, 3, "#8b5cf6"),
        ("check_requirements", "ПРОВЕРКА ТРЕБОВАНИЙ", "backlog", 40, 4, "#7c3aed"),
        ("clarify_requirements", "УТОЧНЕНИЕ ТРЕБОВАНИЙ", "backlog", 40, 5, "#a78bfa"),
        ("quick_estimate", "ЭКСПРЕСС-ОЦЕНКА", "backlog", 40, 6, "#6d28d9"),
        ("decision", "ПРИНЯТИЕ РЕШЕНИЯ", "backlog", 32, 7, "#f59e0b"),
        ("in_progress", "ПРИНЯТА В РАБОТУ", "active", 40, 8, "#10b981"),
        ("rejected", "ОТКЛОНЕНА", "closed", None, 9, "#ef4444"),
        ("irrelevant", "НЕ АКТУАЛЬНА", "closed", None, 10, "#94a3b8"),
        ("done", "ВЫПОЛНЕНА", "closed", 40, 11, "#22c55e"),
        ("escalation", "ЭСКАЛАЦИЯ НА ЛТ", "frozen", 24, 12, "#f97316"),
        ("hold", "ХОЛД", "frozen", 40, 13, "#e11d48"),
    ]
    for code, name, group, sla, sort, color in status_data:
        ts = TaskStatus(code=code, name=name, group=group, sla_hours=sla, sort_order=sort, color=color)
        db.add(ts)
        db.flush()
        task_statuses[code] = ts

    # --- Projects ---
    projects = {}
    project_list = [
        ("new_strategy_did", "НОВАЯ СТРАТЕГИЧЕСКАЯ ИНИЦИАТИВА ДИД", "Разработка новой стратегической инициативы ДИД"),
        ("options_revaluation", "АВТОМАТИЗИРОВАНА ПЕРЕОЦЕНКА ОПЦИОНОВ СБИ", "Автоматизация переоценки опционов СБИ"),
        ("vendor_replacement", "ВЕНДОРОЗАМЕЩЕНИЕ", "Программа импортозамещения вендорских решений"),
        ("pm_sigma", "ВЫВОД PM В СИГМУ", "Вывод проектного менеджмента в SIGMA"),
        ("dashboards", "ДАШБОРДЫ", "Разработка управленческих дашбордов"),
        ("desk_real_estate", "ДЕСК НЕДВИЖИМОСТИ", "Автоматизация деска недвижимости"),
        ("core_integrations", "ДОРАБОТКА ЯДРА И ИНТЕГРАЦИЙ ПЛАТФОРМЫ", "Доработка ядра и интеграционных решений платформы"),
        ("import_substitution", "ИМПОРТОЗАМЕЩЕНИЕ", "Программа импортозамещения"),
        ("client_card", "КАРТОЧКА КЛИЕНТА", "Разработка карточки клиента"),
        ("leads_for_km", "ЛИДЫ ДЛЯ КМ", "Система лидов для корпоративных менеджеров"),
        ("leads_from_km", "ЛИДЫ ОТ КМ", "Система лидов от корпоративных менеджеров"),
        ("routing", "МАРШРУТИЗАЦИЯ", "Маршрутизация сделок"),
        ("pipeline_scanner", "ПАЙПЛАЙН-СКАНЕР СДЕЛОК", "Сканер пайплайна сделок"),
        ("bond_potential_search", "РЕАЛИЗОВАН ПОИСК ПОТЕНЦИАЛОВ ДЛЯ НОВЫХ ВЫПУСКОВ ОБЛИГАЦИЙ", "Поиск потенциалов для новых выпусков облигаций"),
        ("deal_routing", "СДЕЛКИ МАРШРУТИЗАЦИИ", "Автоматизация маршрутизации сделок"),
        ("lpr_goals", "ЦЕЛИ ЛПР", "Система целей ЛПР"),
        ("digital_methodologist", "ЦИФРОВОЙ МЕТОДОЛОГ", "Цифровой методолог"),
        ("ai_assistant_ib", "AI ПОМОЩНИК IB", "AI-помощник для investment banking"),
        ("ai_client_reference", "AI-СПРАВКА ПО КЛИЕНТУ", "AI-справочная система по клиентам"),
        ("bi", "BI", "Business Intelligence платформа"),
        ("data", "DATA", "Управление данными"),
        ("ib", "IB", "Investment Banking платформа"),
        ("mis", "MIS", "Management Information System"),
        ("ckp", "ЦКП", "Центр компетенций платформы"),
        ("other_goals", "ПРОЧИЕ ЦЕЛИ", "Прочие стратегические цели"),
    ]
    for code, name, desc in project_list:
        proj = Project(code=code, name=name, description=desc, status_id=project_statuses["active"].id)
        db.add(proj)
        db.flush()
        projects[code] = proj
    projects[""] = None

    # --- Business Customers ---
    business_customers = {}
    bc_data = [
        ("ДИД", "USI"),
        ("ДРП", "USI"),
        ("ДИТ", "IB"),
        ("ДБ", "IB"),
        ("УБР", "USI"),
        ("ДКП", "USI"),
    ]
    for name, dept_code in bc_data:
        bc = BusinessCustomer(name=name, department_id=departments[dept_code].id if dept_code in departments else None)
        db.add(bc)
        db.flush()
        business_customers[name] = bc
    business_customers[""] = None

    # ========= ROLES =========

    roles = {
        "Администратор": Role(
            name="Администратор", status="active",
            backlog_dmb_access="read_write", backlog_team_access="write_all",
            reports_access="read_write", analytics_access="read_write",
            customer_access="read_write", settings_access="available", admin_access="full",
            can_edit_tasks=True, can_delete_tasks=True, can_export=True
        ),
        "PO": Role(
            name="PO", status="active",
            backlog_dmb_access="read", backlog_team_access="write_own",
            reports_access="read", analytics_access="read",
            customer_access="read", settings_access="available", admin_access="none",
            can_edit_tasks=True, can_delete_tasks=False, can_export=True
        ),
        "BA": Role(
            name="BA", status="active",
            backlog_dmb_access="read", backlog_team_access="read_own",
            reports_access="read", analytics_access="read",
            customer_access="read", settings_access="none", admin_access="none",
            can_edit_tasks=True, can_delete_tasks=False, can_export=True
        ),
        "IT PL": Role(
            name="IT PL", status="active",
            backlog_dmb_access="read_write", backlog_team_access="write_own",
            reports_access="read", analytics_access="read_write",
            customer_access="read", settings_access="available", admin_access="none",
            can_edit_tasks=True, can_delete_tasks=False, can_export=True
        ),
        "Бизнес-заказчик": Role(
            name="Бизнес-заказчик", status="active",
            backlog_dmb_access="read", backlog_team_access="read_own",
            reports_access="read", analytics_access="none",
            customer_access="read_write", settings_access="none", admin_access="none",
            can_edit_tasks=False, can_delete_tasks=False, can_export=False
        ),
        "ЛТ": Role(
            name="ЛТ", status="active",
            backlog_dmb_access="read_write", backlog_team_access="write_all",
            reports_access="read_write", analytics_access="read_write",
            customer_access="read", settings_access="available", admin_access="partial",
            can_edit_tasks=True, can_delete_tasks=True, can_export=True
        ),
    }
    for role in roles.values():
        db.add(role)
    db.flush()

    # ========= TEAMS =========

    teams = {
        "Pre-Trade": Team(name="Pre-Trade", team_type_id=team_types["with_dev"].id, color="indigo",
                          domain="Pre-Trade", description="Pre-Trade системы и аналитика",
                          pl="М. Первак", po="Д. Фомин"),
        "Post-Trade (Products & Service)": Team(name="Post-Trade (Products & Service)", team_type_id=team_types["with_dev"].id, color="emerald",
                          domain="Post-Trade", description="Post-Trade обработка и расчёты",
                          pl="Д. Маркус", po="Д. Козлов"),
        "IB": Team(name="IB", team_type_id=team_types["with_dev"].id, color="violet",
                   domain="IB", description="Единая платформа сделок Investment Banking",
                   pl="А. Мазунин", po="Ю. Шилов"),
        "Core": Team(name="Core", team_type_id=team_types["with_dev"].id, color="amber",
                     domain="Core", description="Ядро платформы",
                     pl="В. Баклушин", po="Р. Хачатрян"),
        "Delivery": Team(name="Delivery", team_type_id=team_types["with_dev"].id, color="sky",
                         domain="Delivery", description="Delivery и внедрение",
                         cl="Л. Куликов"),
        "Post-Trade (Finance)": Team(name="Post-Trade (Finance)", team_type_id=team_types["with_dev"].id, color="rose",
                         domain="Finance", description="Финансовый блок",
                         pl="Д. Маркус", po="Д. Андреев"),
        "Methodology": Team(name="Methodology", team_type_id=team_types["without_dev"].id, color="teal",
                            domain="Methodology", description="Методология и процессы",
                            cl="И. Яковлев"),
        "ИТ ЛТ": Team(name="ИТ ЛТ", team_type_id=team_types["without_dev"].id, color="gray",
                       domain="IT LT", description="ИТ Лидеры Трайбов",
                       cl="Т. Бабиак"),
        "AI": Team(name="AI", team_type_id=team_types["with_dev"].id, color="purple",
                   domain="AI", description="Искусственный интеллект и ML",
                   cl="И. Мишутин"),
        "Проектный офис": Team(name="Проектный офис", team_type_id=team_types["without_dev"].id, color="orange",
                          domain="PMO", description="Проектный офис",
                          cl="В. Стодольский"),
    }
    for team in teams.values():
        db.add(team)
    db.flush()

    # ========= USERS =========

    users_data = [
        ("t.babiak@dmb.ru", "Т. Бабиак", "ЛТ · Проектный офис", "ИТ ЛТ", "ЛТ"),
        ("a@dmb.ru", "Администратор", "System Admin", None, "Администратор"),
        ("a.koptelev@dmb.ru", "А. Коптелов", "ЛТ", "ИТ ЛТ", "ЛТ"),
        ("m.pervak@dmb.ru", "М. Первак", "PL Pre-Trade", "Pre-Trade", "IT PL"),
        ("d.fomin@dmb.ru", "Д. Фомин", "PO Pre-Trade", "Pre-Trade", "PO"),
        ("d.markus@dmb.ru", "Д. Маркус", "PL Post-Trade", "Post-Trade (Products & Service)", "IT PL"),
        ("d.kozlov@dmb.ru", "Д. Козлов", "PO Post-Trade", "Post-Trade (Products & Service)", "PO"),
        ("v.baklushin@dmb.ru", "В. Баклушин", "PL Core", "Core", "IT PL"),
        ("r.khachatryan@dmb.ru", "Р. Хачатрян", "PO Core", "Core", "PO"),
        ("a.mazunin@dmb.ru", "А. Мазунин", "PL IB", "IB", "IT PL"),
        ("u.shilov@dmb.ru", "Ю. Шилов", "PO IB", "IB", "PO"),
        ("d.andreev@dmb.ru", "Д. Андреев", "PO Finance", "Post-Trade (Finance)", "PO"),
        ("l.kulikov@dmb.ru", "Л. Куликов", "CL Delivery", "Delivery", "IT PL"),
        ("i.yakovlev@dmb.ru", "И. Яковлев", "CL Methodology", "Methodology", "IT PL"),
        ("i.mishutin@dmb.ru", "И. Мишутин", "CL AI", "AI", "IT PL"),
        ("v.stodolsky@dmb.ru", "В. Стодольский", "CL Проектный офис", "Проектный офис", "IT PL"),
        ("a.smirnov@dmb.ru", "А. Смирнов", "Senior Developer", "Core", "BA"),
        ("d.volkov@dmb.ru", "Д. Волков", "Developer", "AI", "BA"),
    ]

    created_users = []
    for email, name, position, team_name, role_name in users_data:
        user = User(
            email=email,
            password_hash=get_password_hash("dmb2026"),
            name=name,
            position=position,
            team_id=teams[team_name].id if team_name else None,
            role_id=roles[role_name].id,
            is_active=True
        )
        db.add(user)
        db.flush()
        created_users.append(user)

    # Map users by email for lookup
    users_by_email = {u.email: u for u in created_users}

    # ========= TASKS (44 tasks with FK IDs, deterministic) =========

    task_templates = [
        # Pre-Trade (7 tasks)
        ("Интеграция с MOEX API", "Подключение к торговой системе Московской биржи для получения стаканов и сделок в реальном времени",
         "Pre-Trade", "core_integrations", "binary_kr", "requirements", "ВЫСОКИЙ", "Q2_2026", 30, 8.5, 45.0, 40, "email", "USI", users_by_email.get("m.pervak@dmb.ru")),
        ("Модуль ценообразования деривативов", "Расчёт справедливой стоимости деривативов с использованием моделей Блэка-Шоулза и Монте-Карло",
         "Pre-Trade", "options_revaluation", "quarterly_goal", "in_progress", "ВЫСОКИЙ", "Q4_2026", 60, 15.0, 80.0, 60, "meeting_call", "RISKS", users_by_email.get("d.fomin@dmb.ru")),
        ("Распределённое кэширование котировок", "Внедрение Redis Cluster для кэширования потоковых котировок и снижения latency",
         "Pre-Trade", "core_integrations", "tech_debt", "team_assigned", "СРЕДНИЙ", "Q3_2026", 25, 5.0, 12.0, 0, "sberchat", "IB", users_by_email.get("m.pervak@dmb.ru")),
        ("OpenAPI документация Pre-Trade API", "Полная документация всех внешних API Pre-Trade модуля в формате OpenAPI 3.0",
         "Pre-Trade", "core_integrations", "adhoc", "quick_estimate", "НИЗКИЙ", "Q1_2026", 10, 2.0, 3.0, 0, "email", "USI", None),
        ("Интеграция с системой риск-метрик", "Подключение к системе расчёта риск-метрик для Pre-Trade проверки лимитов",
         "Pre-Trade", "core_integrations", "quarterly_goal", "check_requirements", "ВЫСОКИЙ", "Y2026", 40, 10.0, 50.0, 10, "meeting_call", "RISKS", users_by_email.get("m.pervak@dmb.ru")),
        ("Дашборд P&L Pre-Trade", "Интерактивный дашборд для отслеживания P&L pre-trade операций",
         "Pre-Trade", "dashboards", "metric_kr", "clarify_requirements", "СРЕДНИЙ", "Q2_2026", 20, 4.0, 8.0, 0, "sberchat", "FINANCE", users_by_email.get("d.fomin@dmb.ru")),
        ("Стресс-тестирование портфеля деривативов", "Модуль моделирования стрессовых сценариев для портфеля деривативов с отчётами",
         "Pre-Trade", "options_revaluation", "binary_kr", "decision", "ВЫСОКИЙ", "Q1_2027", 55, 12.0, 60.0, 20, "bizplan", "RISKS", users_by_email.get("m.pervak@dmb.ru")),

        # Post-Trade (Products & Service) (5 tasks)
        ("Рефакторинг модуля пост-трейд расчётов", "Оптимизация производительности пост-трейд обработки, переход на асинхронные расчёты",
         "Post-Trade (Products & Service)", "core_integrations", "tech_debt", "in_progress", "ВЫСОКИЙ", "Q3_2026", 45, 11.0, 35.0, 50, "email", "CUP", users_by_email.get("d.markus@dmb.ru")),
        ("Автоматизация пост-трейд сверки", "Система автоматической сверки пост-трейд операций с данными депозитария и биржи",
         "Post-Trade (Products & Service)", "core_integrations", "quarterly_goal", "requirements", "ВЫСОКИЙ", "Q4_2026", 50, 12.0, 70.0, 15, "meeting_call", "CUP", users_by_email.get("d.kozlov@dmb.ru")),
        ("Оптимизация процесса реконсиляции", "Сокращение времени ручной сверки данных между торговой и учётной системами",
         "Post-Trade (Products & Service)", "deal_routing", "adhoc", "new", "СРЕДНИЙ", "Q2_2026", 20, 3.5, 5.0, 0, "sberchat", "FINANCE", users_by_email.get("d.kozlov@dmb.ru")),
        ("Интеграция с депозитарным учётом", "Подключение к системе депозитарного учёта для автоматической выверки остатков",
         "Post-Trade (Products & Service)", "core_integrations", "binary_kr", "team_assigned", "СРЕДНИЙ", "Y2026", 35, 8.0, 25.0, 0, "bizplan", "FINANCE", users_by_email.get("d.markus@dmb.ru")),
        ("Отчётность по Basel III для пост-трейд", "Автоматизация расчёта нормативов ликвидности LCR и NSFR по пост-трейд операциям",
         "Post-Trade (Products & Service)", "import_substitution", "quarterly_goal", "check_requirements", "ВЫСОКИЙ", "Q1_2026", 40, 9.0, 45.0, 30, "email", "RISKS", users_by_email.get("d.markus@dmb.ru")),

        # IB (6 tasks)
        ("Единый справочник контрагентов IB", "Централизованное хранение и управление данными контрагентов с интеграцией в платформу",
         "IB", "client_card", "quarterly_goal", "in_progress", "ВЫСОКИЙ", "Q4_2026", 55, 14.0, 90.0, 70, "bizplan", "IB", users_by_email.get("a.mazunin@dmb.ru")),
        ("API шлюз для брокерских систем", "Gateway API с OAuth2 авторизацией для интеграции с внешними брокерскими системами",
         "IB", "ib", "quarterly_goal", "requirements", "ВЫСОКИЙ", "Q3_2026", 40, 10.0, 55.0, 25, "meeting_call", "IB", users_by_email.get("u.shilov@dmb.ru")),
        ("Модуль управления ликвидностью IB", "Разработка модуля управления ликвидностью для единой платформы сделок IB",
         "IB", "ib", "binary_kr", "quick_estimate", "СРЕДНИЙ", "Q1_2027", 45, 11.0, 40.0, 0, "email", "FINANCE", users_by_email.get("a.mazunin@dmb.ru")),
        ("Feature flags для IB платформы", "Внедрение системы feature flags для постепенного rollout функциональности IB",
         "IB", "ib", "tech_debt", "team_assigned", "НИЗКИЙ", "Q2_2026", 15, 3.0, 5.0, 0, "sberchat", "IB", users_by_email.get("u.shilov@dmb.ru")),
        ("Интеграция IB с MOEX", "Подключение единой платформы сделок IB к торговой системе Московской биржи",
         "IB", "ib", "quarterly_goal", "clarify_requirements", "ВЫСОКИЙ", "Q4_2026", 50, 13.0, 75.0, 0, "bizplan", "IB", users_by_email.get("a.mazunin@dmb.ru")),
        ("Сканер сделок для IB", "Разработка пайплайн-сканера сделок для IB платформы с ML-моделью прогнозирования",
         "IB", "pipeline_scanner", "binary_kr", "decision", "ВЫСОКИЙ", "Q2_2027", 60, 15.0, 85.0, 10, "meeting_call", "IB", users_by_email.get("u.shilov@dmb.ru")),

        # Core (7 tasks)
        ("Разработка сервиса нотификаций", "Централизованный сервис email/push/SMS уведомлений для всех модулей платформы",
         "Core", "core_integrations", "quarterly_goal", "in_progress", "ВЫСОКИЙ", "Q3_2026", 35, 7.5, 20.0, 45, "email", "URK", users_by_email.get("v.baklushin@dmb.ru")),
        ("Миграция легаси-сервисов на микросервисы", "Поэтапная миграция монолитных сервисов на микросервисную архитектуру с Kubernetes",
         "Core", "core_integrations", "tech_debt", "in_progress", "ВЫСОКИЙ", "Y2026", 80, 18.0, 95.0, 35, "bizplan", "URK", users_by_email.get("r.khachatryan@dmb.ru")),
        ("Модуль аудита действий пользователей", "Система логирования и аудита действий пользователей для соответствия требованиям SOX и ЦБ",
         "Core", "import_substitution", "binary_kr", "requirements", "СРЕДНИЙ", "Q2_2026", 30, 6.0, 15.0, 10, "meeting_call", "RISKS", users_by_email.get("v.baklushin@dmb.ru")),
        ("Оптимизация запросов к БД ядра", "Ускорение медленных запросов, добавление индексов, партиционирование таблиц",
         "Core", "core_integrations", "tech_debt", "quick_estimate", "СРЕДНИЙ", "Q1_2026", 20, 4.0, 8.0, 0, "sberchat", "URK", users_by_email.get("r.khachatryan@dmb.ru")),
        ("Система управления конфигурациями", "Настройка Ansible + Terraform для централизованного управления конфигурациями сервисов",
         "Core", "vendor_replacement", "adhoc", "team_assigned", "НИЗКИЙ", "Q2_2026", 15, 3.5, 6.0, 0, "email", "URK", None),
        ("Мониторинг и алертинг ядра", "Настройка Prometheus + Grafana + Alertmanager для микросервисов ядра",
         "Core", "core_integrations", "metric_kr", "new", "СРЕДНИЙ", "Q1_2026", 20, 4.5, 10.0, 0, "email", "URK", users_by_email.get("a.smirnov@dmb.ru")),
        ("Двухфакторная аутентификация", "Интеграция TOTP и SMS-подтверждения для входа в платформу DMB",
         "Core", "import_substitution", "quarterly_goal", "check_requirements", "ВЫСОКИЙ", "Q3_2026", 25, 5.0, 18.0, 0, "meeting_call", "RISKS", users_by_email.get("v.baklushin@dmb.ru")),

        # Delivery (4 tasks)
        ("Внедрение CI/CD pipeline", "Автоматизация сборки, тестирования и деплоя с GitLab CI + ArgoCD",
         "Delivery", "pm_sigma", "tech_debt", "in_progress", "ВЫСОКИЙ", "Q2_2026", 25, 5.5, 12.0, 55, "sberchat", "URK", users_by_email.get("l.kulikov@dmb.ru")),
        ("Автоматизация интеграционного тестирования", "Написание интеграционных и E2E тестов для ключевых сценариев платформы",
         "Delivery", "core_integrations", "metric_kr", "requirements", "СРЕДНИЙ", "Q3_2026", 30, 6.0, 15.0, 20, "email", "URK", users_by_email.get("l.kulikov@dmb.ru")),
        ("Управление конфигурациями сред", "Централизованное управление конфигурациями dev/stage/prod окружений",
         "Delivery", "vendor_replacement", "adhoc", "new", "НИЗКИЙ", "Q4_2026", 15, 3.0, 5.0, 0, "email", "URK", None),
        ("Чеклист качества релизов", "Разработка и автоматизация чеклиста приёмки релизов для контроля качества",
         "Delivery", "pm_sigma", "binary_kr", "team_assigned", "СРЕДНИЙ", "Q1_2026", 10, 2.0, 4.0, 0, "meeting_call", "URK", users_by_email.get("l.kulikov@dmb.ru")),

        # Post-Trade (Finance) (5 tasks)
        ("Финансовая отчётность по МСФО", "Автоматизация подготовки финансовой отчётности в форматах МСФО",
         "Post-Trade (Finance)", "mis", "quarterly_goal", "in_progress", "ВЫСОКИЙ", "Q4_2026", 50, 12.0, 65.0, 60, "bizplan", "FINANCE", users_by_email.get("d.andreev@dmb.ru")),
        ("Автоматизация расчёта торговых сборов", "Система автоматического расчёта биржевых и брокерских комиссий по сделкам",
         "Post-Trade (Finance)", "deal_routing", "binary_kr", "requirements", "ВЫСОКИЙ", "Q3_2026", 35, 8.0, 30.0, 15, "email", "FINANCE", users_by_email.get("d.andreev@dmb.ru")),
        ("Дашборд P&L для казначейства", "Интерактивный дашборд для отслеживания P&L и позиций казначейства в реальном времени",
         "Post-Trade (Finance)", "dashboards", "metric_kr", "quick_estimate", "СРЕДНИЙ", "Q2_2026", 25, 5.0, 12.0, 0, "sberchat", "FINANCE", users_by_email.get("d.andreev@dmb.ru")),
        ("Оптимизация отчётов по Basel III", "Автоматизация расчёта нормативов ликвидности LCR и NSFR для казначейства",
         "Post-Trade (Finance)", "import_substitution", "quarterly_goal", "check_requirements", "ВЫСОКИЙ", "Q1_2026", 40, 9.0, 40.0, 30, "meeting_call", "RISKS", users_by_email.get("d.andreev@dmb.ru")),
        ("Интеграция с системой управления ликвидностью", "Подключение к платформе управления ликвидностью для автоматизации отчётности",
         "Post-Trade (Finance)", "core_integrations", "adhoc", "clarify_requirements", "СРЕДНИЙ", "Q4_2026", 20, 4.0, 8.0, 0, "bizplan", "FINANCE", users_by_email.get("d.andreev@dmb.ru")),

        # AI (4 tasks)
        ("ML-модель предиктивной аналитики рынка", "ML-модель для прогнозирования рыночных трендов на основе исторических данных и новостей",
         "AI", "ai_assistant_ib", "binary_kr", "in_progress", "ВЫСОКИЙ", "Q1_2027", 70, 16.0, 75.0, 40, "bizplan", "IB", users_by_email.get("i.mishutin@dmb.ru")),
        ("AI-справочная система по клиентам", "Разработка AI-справочной системы с NLP для быстрого поиска информации по клиентам",
         "AI", "ai_client_reference", "quarterly_goal", "requirements", "ВЫСОКИЙ", "Q2_2027", 60, 14.0, 55.0, 10, "meeting_call", "IB", users_by_email.get("d.volkov@dmb.ru")),
        ("Модуль стресс-тестирования портфеля", "Инструмент на базе ML для моделирования стрессовых сценариев и оценки влияния на портфель",
         "AI", "options_revaluation", "binary_kr", "decision", "СРЕДНИЙ", "Y2026", 50, 11.0, 35.0, 20, "email", "RISKS", users_by_email.get("i.mishutin@dmb.ru")),
        ("NLP-анализ клиентских коммуникаций", "Автоматический анализ email и чатов клиентов для выявления сигналов и потребностей",
         "AI", "ai_assistant_ib", "research", "new", "СРЕДНИЙ", "Q4_2026", 45, 10.0, 25.0, 0, "sberchat", "IB", users_by_email.get("d.volkov@dmb.ru")),

        # Methodology (3 tasks)
        ("Внедрение Data Quality framework", "Система мониторинга качества данных с автоматическими алертами при отклонениях",
         "Methodology", "data", "binary_kr", "requirements", "ВЫСОКИЙ", "Q3_2026", 35, 7.0, 18.0, 15, "meeting_call", "CR", users_by_email.get("i.yakovlev@dmb.ru")),
        ("Стандарты документации процессов", "Разработка и внедрение единых стандартов документирования бизнес-процессов платформы",
         "Methodology", "digital_methodologist", "adhoc", "new", "СРЕДНИЙ", "Q2_2026", 20, 3.5, 6.0, 0, "email", "CI", users_by_email.get("i.yakovlev@dmb.ru")),
        ("Система управления задачами для CL", "Инструмент для трекинга поручений и статусов задач Control Leader",
         "Methodology", "digital_methodologist", "tech_debt", "quick_estimate", "НИЗКИЙ", "Q4_2026", 15, 3.0, 4.0, 0, "email", "CR", users_by_email.get("i.yakovlev@dmb.ru")),

        # Проектный офис (3 tasks)
        ("Мониторинг статусов ключевых проектов", "Еженедельный сбор и визуализация статусов ключевых проектов платформы DMB",
         "Проектный офис", "ckp", "metric_kr", "in_progress", "ВЫСОКИЙ", "Q1_2026", 10, 2.0, 5.0, 80, "email", "REG_DIRECTORS", users_by_email.get("v.stodolsky@dmb.ru")),
        ("План импортозамещения DMB", "Разработка дорожной карты импортозамещения компонентов платформы на 2026-2027",
         "Проектный офис", "import_substitution", "quarterly_goal", "requirements", "ВЫСОКИЙ", "Q2_2026", 30, 6.0, 20.0, 40, "bizplan", "REG_DIRECTORS", users_by_email.get("v.stodolsky@dmb.ru")),
        ("Бюджетирование IT-проектов", "Формирование и контроль исполнения бюджета IT-проектов платформы на 2026 год",
         "Проектный офис", "ckp", "binary_kr", "check_requirements", "СРЕДНИЙ", "Q1_2026", 15, 3.5, 8.0, 0, "bizplan", "FINANCE", users_by_email.get("t.babiak@dmb.ru")),
    ]

    business_customers_pool = ["ДИД", "ДРП", "ДИТ", "ДБ", "УБР", "ДКП"]
    dir_statuses = ["В работе", "На контроле", "Риск", "Выполнен"]
    did_statuses = ["В работе", "Требует решения", "Закрыта", "Блокировано"]

    bc_keys = ["ДИД", "ДРП", "ДИТ", "ДБ", "УБР", "ДКП"]

    for idx, tmpl in enumerate(task_templates):
        title, desc, team_name, project_code, tt_code, status_code, pri_name, dl_code = tmpl[:8]
        effort_days, effort_rub, fin_effect, progress = tmpl[8:12]
        ch_code = tmpl[12]
        dept_code = tmpl[13]
        owner = tmpl[14]

        date_received_ = date.today() - timedelta(days=(44 - idx) * 3)
        last_updated_ = date.today() - timedelta(days=idx % 14)

        task = Task(
            team_id=teams[team_name].id,
            title=title,
            description=desc,
            date_received=date_received_,
            channel_id=channels[ch_code].id if ch_code in channels and channels[ch_code] else None,
            business_customer=business_customers_pool[idx % len(business_customers_pool)],
            business_customer_id=business_customers[bc_keys[idx % len(bc_keys)]].id if bc_keys[idx % len(bc_keys)] in business_customers and business_customers[bc_keys[idx % len(bc_keys)]] else None,
            department_id=departments[dept_code].id if dept_code in departments and departments[dept_code] else None,
            project_id=projects[project_code].id if project_code in projects and projects[project_code] else None,
            task_type_id=task_types[tt_code].id if tt_code in task_types else task_types["adhoc"].id,
            involved_teams=None,
            priority_id=priorities[pri_name].id if pri_name in priorities else priorities["СРЕДНИЙ"].id,
            status_id=task_statuses[status_code].id if status_code in task_statuses else task_statuses["new"].id,
            deadline_id=deadlines[dl_code].id if dl_code in deadlines and deadlines[dl_code] else None,
            effort_days=effort_days,
            effort_rub=effort_rub,
            financial_effect=fin_effect,
            progress=progress,
            directorate_status=dir_statuses[idx % len(dir_statuses)],
            did_status=did_statuses[idx % len(did_statuses)],
            status_comment=None,
            owner_id=owner.id if owner else None,
            key_project=(idx < 15),
            key_project_status="На контроле" if idx < 10 else ("Выполнен" if idx < 15 else None),
            last_updated=last_updated_,
            created_by=users_by_email.get("a@dmb.ru").id
        )
        db.add(task)
    db.flush()

    # ========= STANDARD REPORTS =========

    standard_reports = [
        Report(name="Статус для оперативки DMB",
               description="Приоритет ВЫСОКИЙ + риски · все команды", type="standard",
               filters='[{"field":"priority","operator":"equals","value":"ВЫСОКИЙ"}]',
               is_public=True),
        Report(name="Статус для оперативки ДИД",
               description="Все активные задачи платформы", type="standard",
               filters='[{"field":"status","operator":"not_equals","value":"ВЫПОЛНЕНА"}]',
               is_public=True),
        Report(name="Статус по ключевым проектам",
               description="Ключевые проекты DMB", type="standard",
               filters='[{"field":"key_project","operator":"equals","value":"true"}]',
               is_public=True),
        Report(name="Отчет для Рег. директоров",
               description="Сводка по ключевым инициативам и рискам", type="standard",
               filters='[{"field":"key_project","operator":"equals","value":"true"}]',
               is_public=True),
    ]
    for report in standard_reports:
        db.add(report)
    db.flush()

    db.commit()
    db.close()
    print("Seed data created successfully!")


if __name__ == "__main__":
    from database import init_db
    init_db()
    seed_dict_always()
    seed_initial_data()
