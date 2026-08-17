"""
Генератор тестового CSV-файла для импорта задач.

Создаёт 200 строк: ~120 валидных + 80 с ошибками (все 16 типов ошибок).

Запускать:
    python generate_test_csv.py
"""
import csv
import random
import os

# ==================== СПРАВОЧНИКИ ====================
TEAMS = [
    "Pre-Trade", "Post-Trade (Products & Service)", "IB", "Core",
    "Delivery", "Post-Trade (Finance)", "Methodology", "ИТ ЛТ", "AI", "Проектный офис",
]
TEAMS_BAD = [
    "Несуществующая Команда", "Fake Team", "Команда Х", "NonExistent",
    "WrongTeam", "Invalid Team", "Команда 999", "Unknown Team", "BadTeam", "Team404",
]

CHANNELS = ["Почта", "СберЧат", "Встреча/Звонок", "Бизнес-план"]
CHANNELS_BAD = ["НеизвестныйКанал", "FakeChannel", "ЧатПРО", "ChannelX", "НеверныйКанал"]

BCUSTOMERS = ["ДИД", "ДРП", "ДИТ", "ДБ", "УБР", "ДКП"]
BCUSTOMERS_BAD = ["НесущЗаказчик", "FakeCustomer", "ЗаказчикХ", "BadCustomer", "UnknownBC"]

DEPARTMENTS = ["УСИ", "IB", "M&A", "УРК", "ЦУМ", "ФИНАНСЫ", "РИСКИ", "ЦР", "L2P", "ЦИ", "РЕГ. ДИРЕКТОРЫ"]
DEPARTMENTS_BAD = ["НесущПодразд", "FakeDept", "ПодраздХ", "BadDept", "НеизвестноеПодразд"]

PROJECTS = [
    "НОВАЯ СТРАТЕГИЧЕСКАЯ ИНИЦИАТИВА ДИД", "АВТОМАТИЗИРОВАНА ПЕРЕОЦЕНКА ОПЦИОНОВ СБИ",
    "ВЕНДОРОЗАМЕЩЕНИЕ", "ВЫВОД PM В СИГМУ", "ДАШБОРДЫ", "ДЕСК НЕДВИЖИМОСТИ",
    "ДОРАБОТКА ЯДРА И ИНТЕГРАЦИЙ ПЛАТФОРМЫ", "ИМПОРТОЗАМЕЩЕНИЕ", "КАРТОЧКА КЛИЕНТА",
    "ЛИДЫ ДЛЯ КМ", "ЛИДЫ ОТ КМ", "МАРШРУТИЗАЦИЯ", "ПАЙПЛАЙН-СКАНЕР СДЕЛОК",
    "РЕАЛИЗОВАН ПОИСК ПОТЕНЦИАЛОВ ДЛЯ НОВЫХ ВЫПУСКОВ ОБЛИГАЦИЙ",
    "СДЕЛКИ МАРШРУТИЗАЦИИ", "ЦЕЛИ ЛПР", "ЦИФРОВОЙ МЕТОДОЛОГ",
    "AI ПОМОЩНИК IB", "AI-СПРАВКА ПО КЛИЕНТУ", "BI",
]
PROJECTS_BAD = [
    "ФейковыйПроект", "НесущПроект", "FakeProject", "ПроектХ", "BadProject",
    "Проект404", "НеизвестныйПроект", "WrongProject", "InvalidProject",
]

TASK_TYPES = ["КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ", "AD-HOC", "ТЕХДОЛГ", "ИССЛЕДОВАНИЕ", "МЕТРИЧЕСКИЕ KR"]
TASK_TYPES_BAD = ["НесущТипЗадачи", "FakeTaskType", "ТипХ", "BadTaskType", "UnknownType"]

PRIORITIES = ["НИЗКИЙ", "СРЕДНИЙ", "ВЫСОКИЙ"]
PRIORITIES_BAD = ["НесущПриоритет", "FakePriority", "ПриоритетХ", "BadPriority", "InvalidPriority"]

DEADLINES = ["1Q 2026", "2Q 2026", "3Q 2026", "4Q 2026", "Y2026", "1Q 2027", "2Q 2027", "БЕЗ СРОКА"]
DEADLINES_BAD = ["FakeDeadline", "НесущСрок", "СрокХ", "BadDeadline", "InvalidDeadline", "999Q 2099"]

STATUSES = [
    "НОВАЯ ЗАДАЧА", "НАЗНАЧЕНА КОМАНДА", "СБОР ТРЕБОВАНИЙ", "ПРОВЕРКА ТРЕБОВАНИЙ",
    "УТОЧНЕНИЕ ТРЕБОВАНИЙ", "ЭКСПРЕСС-ОЦЕНКА", "ПРИНЯТИЕ РЕШЕНИЯ", "ПРИНЯТА В РАБОТУ",
    "ОТКЛОНЕНА", "НЕ АКТУАЛЬНА", "ВЫПОЛНЕНА", "ЭСКАЛАЦИЯ НА ЛТ", "ХОЛД",
]
STATUSES_BAD = ["НесущСтатус", "FakeStatus", "СтатусХ", "BadStatus", "InvalidStatus", "Статус404"]

USERS = [
    "Тимофей Бабяк", "А. Коптелов", "М. Первак", "Д. Фомин", "Д. Маркус",
    "Д. Козлов", "В. Баклушин", "Р. Хачатрян", "А. Мазунин", "Ю. Шилов",
    "Д. Андреев", "Л. Куликов", "И. Яковлев", "И. Мишутин", "В. Стодольский",
]
USERS_BAD = [
    "НесущПользователь", "FakeUser", "ПользовательХ", "BadUser", "InvalidUser",
    "Иванов Иван", "Петров Петр", "Сидоров Сидор", "НеизвестныйЮзер",
]

DATES_VALID = ["2026-01-15", "2026-03-20", "2026-05-10", "2026-07-01", "2026-09-15"]
DATES_BAD = ["не-дата", "2026/01/15", "01-15-2026", "invalid", "далекое_будущее", "01.13.2026", ""]

PROGRESS_VALID = [0, 25, 50, 75, 100]
PROGRESS_BAD = [-10, 150, 200, 999, "high", "not_a_number"]

EFFORT_VALID = [1, 5, 10, 20, 50]
EFFORT_BAD = ["abc", "N/A", " много", "десять", "-5"]

JIRA_TEMPLATES = [
    "https://jira.example.com/ABC-{}",
    "https://jira.example.com/PROJ-{}-{}",
    "https://jira.dmb.ru/browse/DMB-{}",
]

# ==================== ЗАГОЛОВКИ ====================
HEADERS = [
    "Название задачи",
    "Ответственная команда",
    "Описание задачи",
    "Дата получения",
    "Канал поступления",
    "Бизнес-заказчик",
    "Подразделение Бизнес-заказчика",
    "Проект",
    "Тип задачи",
    "Другие вовлеченные команды",
    "Приоритет",
    "Статус задачи",
    "Срок выполнения",
    "Оценка трудозатрат (ЭО) (ч/д)",
    "Стоимость по ЭО (руб)",
    "Designee (ЭО)",
    "Аналитика (ЭО)",
    "Разработка BE (ЭО)",
    "Разработка python BE (ЭО)",
    "Разработка FE (ЭО)",
    "Test (ЭО)",
    "Test Auto (ЭО)",
    "Delivery (ЭО)",
    "Фактические трудозатраты (ч/д)",
    "Designee (ФТЗ)",
    "Аналитика (ФТЗ)",
    "Разработка BE (ФТЗ)",
    "Разработка python BE (ФТЗ)",
    "Разработка FE (ФТЗ)",
    "Test (ФТЗ)",
    "Test Auto (ФТЗ)",
    "Delivery (ФТЗ)",
    "Финансовый эффект (value в млн руб.)",
    "Обоснование по расчету финансового эффекта",
    "C/V",
    "Прогресс",
    "Ссылка на макеты",
    "Ссылки на Jira",
    "Обоснование решения (при отклонении)",
    "Комментарий",
    "Исполнитель",
    "Статус для встречи по ключевым проектам",
    "Статус для Директорской оперативки",
    "Статус для оперативки ДИД",
    "Демо для оперативного статуса ДИД",
    "Значение для метрического KR (план)",
    "Значение для метрического KR (факт)",
    "Единица измерения (метрический KR)",
]

# ==================== ПОМОЩНИКИ ====================


def jira_url(n):
    tpl = JIRA_TEMPLATES[n % len(JIRA_TEMPLATES)]
    return tpl.format(random.randint(100, 999), random.randint(1, 99))


# ==================== ПОСТРОЕНИЕ СТРОК ====================
rows = []
errors_log = []


def add(task_num, title_val, team_val, desc_val, date_val, channel_val,
        bc_val, dept_val, proj_val, tt_val, prio_val, dl_val, status_val,
        owner_val="", progress_val="", effort_val="", effort_rub_val="",
        jira_val="", expected_error=None,
        involved_val="", effort_designee_val="", effort_analytics_val="",
        effort_be_val="", effort_python_be_val="", effort_fe_val="",
        effort_test_val="", effort_test_auto_val="", effort_delivery_val="",
        actual_days_val="", actual_designee_val="", actual_analytics_val="",
        actual_be_val="", actual_python_be_val="", actual_fe_val="",
        actual_test_val="", actual_test_auto_val="", actual_delivery_val="",
        fin_effect_val="", fin_justification_val="", cv_val="",
        link_mockups_val="", rejection_reason_val="", comment_val="",
        kp_status_val="", dir_status_val="", did_status_val="",
        did_demo_val="", metric_kr_plan_val="", metric_kr_fact_val="",
        metric_kr_unit_val=""):
    row = {
        "Название задачи": title_val,
        "Ответственная команда": team_val,
        "Описание задачи": desc_val,
        "Дата получения": date_val,
        "Канал поступления": channel_val,
        "Бизнес-заказчик": bc_val,
        "Подразделение Бизнес-заказчика": dept_val,
        "Проект": proj_val,
        "Тип задачи": tt_val,
        "Другие вовлеченные команды": involved_val,
        "Приоритет": prio_val,
        "Статус задачи": status_val,
        "Срок выполнения": dl_val,
        "Оценка трудозатрат (ЭО) (ч/д)": effort_val,
        "Стоимость по ЭО (руб)": effort_rub_val,
        "Designee (ЭО)": effort_designee_val,
        "Аналитика (ЭО)": effort_analytics_val,
        "Разработка BE (ЭО)": effort_be_val,
        "Разработка python BE (ЭО)": effort_python_be_val,
        "Разработка FE (ЭО)": effort_fe_val,
        "Test (ЭО)": effort_test_val,
        "Test Auto (ЭО)": effort_test_auto_val,
        "Delivery (ЭО)": effort_delivery_val,
        "Фактические трудозатраты (ч/д)": actual_days_val,
        "Designee (ФТЗ)": actual_designee_val,
        "Аналитика (ФТЗ)": actual_analytics_val,
        "Разработка BE (ФТЗ)": actual_be_val,
        "Разработка python BE (ФТЗ)": actual_python_be_val,
        "Разработка FE (ФТЗ)": actual_fe_val,
        "Test (ФТЗ)": actual_test_val,
        "Test Auto (ФТЗ)": actual_test_auto_val,
        "Delivery (ФТЗ)": actual_delivery_val,
        "Финансовый эффект (value в млн руб.)": fin_effect_val,
        "Обоснование по расчету финансового эффекта": fin_justification_val,
        "C/V": cv_val,
        "Прогресс": progress_val,
        "Ссылка на макеты": link_mockups_val,
        "Ссылки на Jira": jira_val,
        "Обоснование решения (при отклонении)": rejection_reason_val,
        "Комментарий": comment_val,
        "Исполнитель": owner_val,
        "Статус для встречи по ключевым проектам": kp_status_val,
        "Статус для Директорской оперативки": dir_status_val,
        "Статус для оперативки ДИД": did_status_val,
        "Демо для оперативного статуса ДИД": did_demo_val,
        "Значение для метрического KR (план)": metric_kr_plan_val,
        "Значение для метрического KR (факт)": metric_kr_fact_val,
        "Единица измерения (метрический KR)": metric_kr_unit_val,
    }
    rows.append(row)
    if expected_error:
        errors_log.append((len(rows) + 1, expected_error))


# ==================== ГЕНЕРАЦИЯ ====================
random.seed(42)

# --- ВАЛИДНЫЕ СТРОКИ (120 штук) ---
for i in range(1, 121):
    jira = ";".join([jira_url(i * 3 + j) for j in range(random.randint(1, 3))])
    add(
        task_num=i,
        title_val=f"Задача {i:04d}",
        team_val=random.choice(TEAMS),
        desc_val=f"Описание задачи {i}. Тестовые данные для импорта. Размер: {random.randint(10,500)} символов.",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        involved_val=";".join(random.sample(TEAMS, random.randint(1, 2))),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val=random.choice(USERS) if random.random() > 0.3 else "",
        progress_val=random.choice([0, 25, 50, 75, 100]),
        effort_val=random.choice(EFFORT_VALID),
        effort_rub_val=random.randint(100000, 5000000),
        effort_designee_val=round(random.uniform(0.5, 3), 1),
        effort_analytics_val=round(random.uniform(0.5, 3), 1),
        effort_be_val=round(random.uniform(1, 6), 1),
        effort_python_be_val=round(random.uniform(1, 6), 1),
        effort_fe_val=round(random.uniform(1, 6), 1),
        effort_test_val=round(random.uniform(0.5, 4), 1),
        effort_test_auto_val=round(random.uniform(0.5, 4), 1),
        effort_delivery_val=round(random.uniform(0.5, 2), 1),
        actual_days_val=random.choice([1, 2, 3]),
        actual_designee_val=round(random.uniform(0, 2), 1),
        actual_analytics_val=round(random.uniform(0, 2), 1),
        actual_be_val=round(random.uniform(0, 4), 1),
        actual_python_be_val=round(random.uniform(0, 4), 1),
        actual_fe_val=round(random.uniform(0, 4), 1),
        actual_test_val=round(random.uniform(0, 3), 1),
        actual_test_auto_val=round(random.uniform(0, 3), 1),
        actual_delivery_val=round(random.uniform(0, 2), 1),
        fin_effect_val=round(random.uniform(0.1, 5.0), 2),
        fin_justification_val=f"Обоснование финансового эффекта задачи {i}",
        link_mockups_val=f"https://figma.com/file/abc-{i}",
        comment_val=f"Комментарий по задаче {i}",
        kp_status_val=random.choice(["В работе", "Запланировано", "Выполнено"]),
        dir_status_val=random.choice(["На контроле", "В работе"]),
        did_status_val=random.choice(["Готово", "В работе"]),
        did_demo_val=random.choice(["да", "нет"]),
        metric_kr_plan_val=random.randint(1, 100),
        metric_kr_fact_val=random.randint(0, 100),
        metric_kr_unit_val="млн руб.",
        jira_val=jira,
        expected_error=None,
    )

# --- ОШИБКА 1: team_not_found (10 строк) ---
for i in range(1, 11):
    bad_team = TEAMS_BAD[i % len(TEAMS_BAD)]
    add(
        task_num=200 + i,
        title_val=f"Ошибка-1-team [{i}]",
        team_val=bad_team,
        desc_val=f"Строка с ошибкой team_not_found: команда '{bad_team}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="team_not_found",
    )

# --- ОШИБКА 2: channel_not_found (5 строк) ---
for i in range(1, 6):
    bad_ch = CHANNELS_BAD[i % len(CHANNELS_BAD)]
    add(
        task_num=220 + i,
        title_val=f"Ошибка-2-channel [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный канал: '{bad_ch}'",
        date_val=random.choice(DATES_VALID),
        channel_val=bad_ch,
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="channel_not_found",
    )

# --- ОШИБКА 3: business_customer_not_found (5 строк) ---
for i in range(1, 6):
    bad_bc = BCUSTOMERS_BAD[i % len(BCUSTOMERS_BAD)]
    add(
        task_num=230 + i,
        title_val=f"Ошибка-3-bc [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный бизнес-заказчик: '{bad_bc}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=bad_bc,
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="business_customer_not_found",
    )

# --- ОШИБКА 4: department_not_found (5 строк) ---
for i in range(1, 6):
    bad_dept = DEPARTMENTS_BAD[i % len(DEPARTMENTS_BAD)]
    add(
        task_num=240 + i,
        title_val=f"Ошибка-4-dept [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверное подразделение: '{bad_dept}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=bad_dept,
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="department_not_found",
    )

# --- ОШИБКА 5: project_not_found (5 строк) ---
for i in range(1, 6):
    bad_proj = PROJECTS_BAD[i % len(PROJECTS_BAD)]
    add(
        task_num=250 + i,
        title_val=f"Ошибка-5-project [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный проект: '{bad_proj}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=bad_proj,
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="project_not_found",
    )

# --- ОШИБКА 6: task_type_not_found (5 строк) ---
for i in range(1, 6):
    bad_tt = TASK_TYPES_BAD[i % len(TASK_TYPES_BAD)]
    add(
        task_num=260 + i,
        title_val=f"Ошибка-6-task_type [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный тип задачи: '{bad_tt}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=bad_tt,
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="task_type_not_found",
    )

# --- ОШИБКА 7: priority_not_found (5 строк) ---
for i in range(1, 6):
    bad_prio = PRIORITIES_BAD[i % len(PRIORITIES_BAD)]
    add(
        task_num=270 + i,
        title_val=f"Ошибка-7-priority [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный приоритет: '{bad_prio}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=bad_prio,
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="priority_not_found",
    )

# --- ОШИБКА 8: deadline_not_found (5 строк) ---
for i in range(1, 6):
    bad_dl = DEADLINES_BAD[i % len(DEADLINES_BAD)]
    add(
        task_num=280 + i,
        title_val=f"Ошибка-8-deadline [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный срок: '{bad_dl}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=bad_dl,
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="deadline_not_found",
    )

# --- ОШИБКА 9: status_not_found (5 строк) ---
for i in range(1, 6):
    bad_st = STATUSES_BAD[i % len(STATUSES_BAD)]
    add(
        task_num=290 + i,
        title_val=f"Ошибка-9-status [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный статус: '{bad_st}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val=bad_st,
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="status_not_found",
    )

# --- ОШИБКА 10: owner_not_found (5 строк) — НЕ FATAL ---
for i in range(1, 6):
    bad_usr = USERS_BAD[i % len(USERS_BAD)]
    add(
        task_num=300 + i,
        title_val=f"Ошибка-10-owner [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный исполнитель: '{bad_usr}' (задача должна импортироваться)",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val=bad_usr,
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="owner_not_found",
    )

# --- ОШИБКА 11: required_missing (8 строк) ---
# title пустой (2 шт)
for i in range(1, 3):
    add(
        task_num=310 + i,
        title_val="",
        team_val=random.choice(TEAMS),
        desc_val=f"Пустой title — required_missing [{i}]",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="required_missing",
    )
# team_id пустой (2 шт)
for i in range(3, 5):
    add(
        task_num=320 + i,
        title_val=f"Ошибка-11-no-team [{i}]",
        team_val="",
        desc_val=f"Пустой team_id — required_missing [{i}]",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="required_missing",
    )
# оба пустые (2 шт)
for i in range(5, 7):
    add(
        task_num=330 + i,
        title_val="",
        team_val="",
        desc_val=f"Оба обязательных пустые [{i}]",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="required_missing",
    )
# title пустой + team не в справочнике (2 шт — комбинированная)
for i in range(7, 9):
    add(
        task_num=340 + i,
        title_val="",
        team_val="НесуществующаяКомандаXYZ",
        desc_val=f"Комбинированная: title пустой + team_not_found [{i}]",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="team_not_found",
    )

# --- ОШИБКА 12: invalid_date (5 строк) ---
for i in range(1, 6):
    bad_date = DATES_BAD[i % len(DATES_BAD)]
    add(
        task_num=350 + i,
        title_val=f"Ошибка-12-date [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный формат даты: '{bad_date}'",
        date_val=bad_date,
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="invalid_date",
    )

# --- ОШИБКА 13: invalid_number (effort_days) (5 строк) ---
for i in range(1, 6):
    bad_effort = EFFORT_BAD[i % len(EFFORT_BAD)]
    add(
        task_num=360 + i,
        title_val=f"Ошибка-13-effort [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный формат трудозатрат: '{bad_effort}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=0,
        effort_val=bad_effort,
        effort_rub_val="",
        jira_val="",
        expected_error="invalid_number",
    )

# --- ОШИБКА 14: invalid_progress (6 строк) ---
progress_bad_cases = ["-5", "-1", "150", "200", "abc", "high"]
for i in range(1, 7):
    bad_prog = progress_bad_cases[i - 1]
    add(
        task_num=370 + i,
        title_val=f"Ошибка-14-progress [{i}]",
        team_val=random.choice(TEAMS),
        desc_val=f"Неверный прогресс: '{bad_prog}'",
        date_val=random.choice(DATES_VALID),
        channel_val=random.choice(CHANNELS),
        bc_val=random.choice(BCUSTOMERS),
        dept_val=random.choice(DEPARTMENTS),
        proj_val=random.choice(PROJECTS),
        tt_val=random.choice(TASK_TYPES),
        prio_val=random.choice(PRIORITIES),
        dl_val=random.choice(DEADLINES),
        status_val="НОВАЯ ЗАДАЧА",
        owner_val="",
        progress_val=bad_prog,
        effort_val="",
        effort_rub_val="",
        jira_val="",
        expected_error="invalid_progress",
    )

# ==================== ЗАПИСЬ CSV ====================
output_path = os.path.join(os.path.dirname(__file__), "test_import_200.csv")

with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=HEADERS, delimiter=";")
    writer.writeheader()
    writer.writerows(rows)

print(f"CSV записан: {output_path}")
print(f"Всего строк (без заголовка): {len(rows)}")

# ==================== ОТЧЁТ ====================
error_counts = {}
for row_num, err_type in errors_log:
    error_counts[err_type] = error_counts.get(err_type, 0) + 1

print("\n=== СТАТИСТИКА ОШИБОК ===")
for err_type, count in sorted(error_counts.items()):
    print(f"  {err_type}: {count}")

# Подсчёт ожидаемых результатов
valid_count = 120
owner_not_fatal = error_counts.get("owner_not_found", 0)
fatal_skipped = sum(
    count for err, count in error_counts.items()
    if err not in ("valid", "owner_not_found")
)

print(f"\n=== ОЖИДАЕМЫЙ РЕЗУЛЬТАТ ИМПОРТА ===")
print(f"  Всего строк: {len(rows)}")
print(f"  Ожидается создано: {valid_count}")
print(f"  Ожидается пропущено (fatal): {fatal_skipped}")
print(f"  owner_not_found (создастся, но с предупреждением): {owner_not_fatal}")

# Запись отчёта
report_path = output_path.replace(".csv", "_errors.txt")
with open(report_path, "w", encoding="utf-8-sig") as f:
    f.write("=== ТЕСТОВЫЙ CSV ДЛЯ ИМПОРТА ЗАДАЧ ===\n")
    f.write(f"Дата: 2026-08-07\n")
    f.write(f"Всего строк: {len(rows)}\n\n")
    f.write("=== СТРУКТУРА ФАЙЛА ===\n")
    f.write("Разделитель: ;\n")
    f.write("Кодировка: UTF-8 with BOM\n")
    f.write(f"Колонок: {len(HEADERS)}\n\n")
    f.write("=== КОЛОНКИ ===\n")
    for i, h in enumerate(HEADERS, 1):
        f.write(f"  {i:2d}. {h}\n")
    f.write("\n=== ТИПЫ ОШИБОК И ИХ ПОКРЫТИЕ ===\n")
    f.write("| Тип ошибки | Кол-во строк |\n")
    f.write("|------------|-------------|\n")
    for err_type, count in sorted(error_counts.items()):
        f.write(f"| {err_type} | {count} |\n")
    f.write("\n=== ОЖИДАЕМЫЙ РЕЗУЛЬТАТ ===\n")
    f.write(f"  Всего строк: {len(rows)}\n")
    f.write(f"  Ожидается создано: {valid_count}\n")
    f.write(f"  Ожидается пропущено (fatal): {fatal_skipped}\n")
    f.write(f"  owner_not_found (создастся с предупреждением): {owner_not_fatal}\n")
    f.write("\n=== СПРАВОЧНИКИ (для справки) ===\n")
    f.write(f"Teams: {', '.join(TEAMS)}\n")
    f.write(f"Channels: {', '.join(CHANNELS)}\n")
    f.write(f"BusinessCustomers: {', '.join(BCUSTOMERS)}\n")
    f.write(f"Departments: {', '.join(DEPARTMENTS)}\n")
    f.write(f"Projects: {', '.join(PROJECTS[:5])}... (+15)\n")
    f.write(f"TaskTypes: {', '.join(TASK_TYPES)}\n")
    f.write(f"Priorities: {', '.join(PRIORITIES)}\n")
    f.write(f"Deadlines: {', '.join(DEADLINES)}\n")
    f.write(f"Statuses: {', '.join(STATUSES)}\n")
    f.write(f"Users: {', '.join(USERS)}\n")

print(f"\nОтчёт об ошибках: {report_path}")
