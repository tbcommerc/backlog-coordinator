"""
Генератор Excel-файла для тестирования импорта задач.
Создаёт xlsx с 3 листами: Инструкция, Данные, Ошибки.

Запускать:
    python generate_test_excel.py
"""
import csv
import os
import random
import openpyxl
from openpyxl.styles import (Font, PatternFill, Alignment, Border, Side,
                              GradientFill)
from openpyxl.utils import get_column_letter

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
PROGRESS_BAD = ["-5", "-1", "150", "200", "abc", "high"]
EFFORT_VALID = [1, 5, 10, 20, 50]
EFFORT_BAD = ["abc", "N/A", " много", "десять", "-5"]
JIRA_TEMPLATES = [
    "https://jira.example.com/ABC-{}",
    "https://jira.example.com/PROJ-{}-{}",
    "https://jira.dmb.ru/browse/DMB-{}",
]

HEADERS = [
    "Название задачи", "Ответственная команда", "Описание задачи",
    "Дата получения", "Канал поступления", "Бизнес-заказчик",
    "Подразделение Бизнес-заказчика", "Проект", "Тип задачи",
    "Другие вовлеченные команды", "Приоритет", "Статус задачи",
    "Срок выполнения", "Оценка трудозатрат (ЭО) (ч/д)", "Стоимость по ЭО (руб)",
    "Designee (ЭО)", "Аналитика (ЭО)", "Разработка BE (ЭО)",
    "Разработка python BE (ЭО)", "Разработка FE (ЭО)", "Test (ЭО)",
    "Test Auto (ЭО)", "Delivery (ЭО)", "Фактические трудозатраты (ч/д)",
    "Designee (ФТЗ)", "Аналитика (ФТЗ)", "Разработка BE (ФТЗ)",
    "Разработка python BE (ФТЗ)", "Разработка FE (ФТЗ)", "Test (ФТЗ)",
    "Test Auto (ФТЗ)", "Delivery (ФТЗ)", "Финансовый эффект (value в млн руб.)",
    "Обоснование по расчету финансового эффекта", "C/V", "Прогресс",
    "Ссылка на макеты", "Ссылки на Jira", "Обоснование решения (при отклонении)",
    "Комментарий", "Исполнитель", "Статус для встречи по ключевым проектам",
    "Статус для Директорской оперативки", "Статус для оперативки ДИД",
    "Демо для оперативного статуса ДИД", "Значение для метрического KR (план)",
    "Значение для метрического KR (факт)", "Единица измерения (метрический KR)",
]

def jira_url(n):
    tpl = JIRA_TEMPLATES[n % len(JIRA_TEMPLATES)]
    return tpl.format(random.randint(100, 999), random.randint(1, 99))


def make_row(**kwargs):
    row = {
        "Название задачи": kwargs["title"],
        "Ответственная команда": kwargs["team"],
        "Описание задачи": kwargs["desc"],
        "Дата получения": kwargs["date"],
        "Канал поступления": kwargs["channel"],
        "Бизнес-заказчик": kwargs["bc"],
        "Подразделение Бизнес-заказчика": kwargs["dept"],
        "Проект": kwargs["proj"],
        "Тип задачи": kwargs["tt"],
        "Другие вовлеченные команды": kwargs.get("involved", ""),
        "Приоритет": kwargs["prio"],
        "Статус задачи": kwargs["status"],
        "Срок выполнения": kwargs["dl"],
        "Оценка трудозатрат (ЭО) (ч/д)": kwargs.get("effort", ""),
        "Стоимость по ЭО (руб)": kwargs.get("effort_rub", ""),
        "Designee (ЭО)": kwargs.get("effort_designee", ""),
        "Аналитика (ЭО)": kwargs.get("effort_analytics", ""),
        "Разработка BE (ЭО)": kwargs.get("effort_be", ""),
        "Разработка python BE (ЭО)": kwargs.get("effort_python_be", ""),
        "Разработка FE (ЭО)": kwargs.get("effort_fe", ""),
        "Test (ЭО)": kwargs.get("effort_test", ""),
        "Test Auto (ЭО)": kwargs.get("effort_test_auto", ""),
        "Delivery (ЭО)": kwargs.get("effort_delivery", ""),
        "Фактические трудозатраты (ч/д)": kwargs.get("actual_days", ""),
        "Designee (ФТЗ)": kwargs.get("actual_designee", ""),
        "Аналитика (ФТЗ)": kwargs.get("actual_analytics", ""),
        "Разработка BE (ФТЗ)": kwargs.get("actual_be", ""),
        "Разработка python BE (ФТЗ)": kwargs.get("actual_python_be", ""),
        "Разработка FE (ФТЗ)": kwargs.get("actual_fe", ""),
        "Test (ФТЗ)": kwargs.get("actual_test", ""),
        "Test Auto (ФТЗ)": kwargs.get("actual_test_auto", ""),
        "Delivery (ФТЗ)": kwargs.get("actual_delivery", ""),
        "Финансовый эффект (value в млн руб.)": kwargs.get("fin_effect", ""),
        "Обоснование по расчету финансового эффекта": kwargs.get("fin_justification", ""),
        "C/V": kwargs.get("cv", ""),
        "Прогресс": kwargs.get("progress", ""),
        "Ссылка на макеты": kwargs.get("link_mockups", ""),
        "Ссылки на Jira": kwargs.get("jira", ""),
        "Обоснование решения (при отклонении)": kwargs.get("rejection_reason", ""),
        "Комментарий": kwargs.get("comment", ""),
        "Исполнитель": kwargs.get("owner", ""),
        "Статус для встречи по ключевым проектам": kwargs.get("kp_status", ""),
        "Статус для Директорской оперативки": kwargs.get("dir_status", ""),
        "Статус для оперативки ДИД": kwargs.get("did_status", ""),
        "Демо для оперативного статуса ДИД": kwargs.get("did_demo", ""),
        "Значение для метрического KR (план)": kwargs.get("metric_kr_plan", ""),
        "Значение для метрического KR (факт)": kwargs.get("metric_kr_fact", ""),
        "Единица измерения (метрический KR)": kwargs.get("metric_kr_unit", ""),
    }
    return row


random.seed(42)
rows = []
error_info = []  # (excel_row, error_type, description)

def add(**kwargs):
    rows.append(make_row(**kwargs))


# --- ВАЛИДНЫЕ (120) ---
for i in range(1, 121):
    jira = ";".join([jira_url(i * 3 + j) for j in range(random.randint(1, 3))])
    add(
        title=f"Задача {i:04d}",
        team=random.choice(TEAMS),
        desc=f"Описание задачи {i}. Тестовые данные для импорта.",
        date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS),
        bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS),
        proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES),
        involved=";".join(random.sample(TEAMS, random.randint(1, 2))),
        prio=random.choice(PRIORITIES),
        dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА",
        owner=random.choice(USERS) if random.random() > 0.3 else "",
        progress=random.choice([0, 25, 50, 75, 100]),
        effort=random.choice(EFFORT_VALID),
        effort_rub=random.randint(100000, 5000000),
        effort_designee=round(random.uniform(0.5, 3), 1),
        effort_analytics=round(random.uniform(0.5, 3), 1),
        effort_be=round(random.uniform(1, 6), 1),
        effort_python_be=round(random.uniform(1, 6), 1),
        effort_fe=round(random.uniform(1, 6), 1),
        effort_test=round(random.uniform(0.5, 4), 1),
        effort_test_auto=round(random.uniform(0.5, 4), 1),
        effort_delivery=round(random.uniform(0.5, 2), 1),
        actual_days=random.choice([1, 2, 3]),
        actual_designee=round(random.uniform(0, 2), 1),
        actual_analytics=round(random.uniform(0, 2), 1),
        actual_be=round(random.uniform(0, 4), 1),
        actual_python_be=round(random.uniform(0, 4), 1),
        actual_fe=round(random.uniform(0, 4), 1),
        actual_test=round(random.uniform(0, 3), 1),
        actual_test_auto=round(random.uniform(0, 3), 1),
        actual_delivery=round(random.uniform(0, 2), 1),
        fin_effect=round(random.uniform(0.1, 5.0), 2),
        fin_justification=f"Обоснование финансового эффекта задачи {i}",
        link_mockups=f"https://figma.com/file/abc-{i}",
        comment=f"Комментарий по задаче {i}",
        kp_status=random.choice(["В работе", "Запланировано", "Выполнено"]),
        dir_status=random.choice(["На контроле", "В работе"]),
        did_status=random.choice(["Готово", "В работе"]),
        did_demo=random.choice(["да", "нет"]),
        metric_kr_plan=random.randint(1, 100),
        metric_kr_fact=random.randint(0, 100),
        metric_kr_unit="млн руб.",
        jira=jira,
    )

# --- ОШИБКА 1: team_not_found (10) ---
for i in range(1, 11):
    bt = TEAMS_BAD[i % len(TEAMS_BAD)]
    row_num = len(rows) + 2
    add(
        title=f"ERR-1-team [{i}]", team=bt,
        desc=f"team_not_found: '{bt}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=random.choice(PRIORITIES),
        dl=random.choice(DEADLINES), status="НОВАЯ ЗАДАЧА",
    )
    error_info.append((row_num, "team_not_found", f"Строка {row_num}: команда '{bt}'"))

# --- ОШИБКА 2: channel_not_found (5) ---
for i in range(1, 6):
    bc = CHANNELS_BAD[i % len(CHANNELS_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-2-channel [{i}]", team=random.choice(TEAMS),
        desc=f"channel_not_found: '{bc}'", date=random.choice(DATES_VALID),
        channel=bc, bc=random.choice(BCUSTOMERS), dept=random.choice(DEPARTMENTS),
        proj=random.choice(PROJECTS), tt=random.choice(TASK_TYPES),
        prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "channel_not_found", f"Строка {row_num}: канал '{bc}'"))

# --- ОШИБКА 3: bc_not_found (5) ---
for i in range(1, 6):
    bb = BCUSTOMERS_BAD[i % len(BCUSTOMERS_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-3-bc [{i}]", team=random.choice(TEAMS),
        desc=f"business_customer_not_found: '{bb}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=bb, dept=random.choice(DEPARTMENTS),
        proj=random.choice(PROJECTS), tt=random.choice(TASK_TYPES),
        prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "business_customer_not_found", f"Строка {row_num}: бизнес-заказчик '{bb}'"))

# --- ОШИБКА 4: dept_not_found (5) ---
for i in range(1, 6):
    bd = DEPARTMENTS_BAD[i % len(DEPARTMENTS_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-4-dept [{i}]", team=random.choice(TEAMS),
        desc=f"department_not_found: '{bd}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=bd, proj=random.choice(PROJECTS), tt=random.choice(TASK_TYPES),
        prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "department_not_found", f"Строка {row_num}: подразделение '{bd}'"))

# --- ОШИБКА 5: project_not_found (5) ---
for i in range(1, 6):
    bp = PROJECTS_BAD[i % len(PROJECTS_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-5-project [{i}]", team=random.choice(TEAMS),
        desc=f"project_not_found: '{bp}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=bp, tt=random.choice(TASK_TYPES),
        prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "project_not_found", f"Строка {row_num}: проект '{bp}'"))

# --- ОШИБКА 6: task_type_not_found (5) ---
for i in range(1, 6):
    btt = TASK_TYPES_BAD[i % len(TASK_TYPES_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-6-tt [{i}]", team=random.choice(TEAMS),
        desc=f"task_type_not_found: '{btt}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=btt, prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "task_type_not_found", f"Строка {row_num}: тип задачи '{btt}'"))

# --- ОШИБКА 7: priority_not_found (5) ---
for i in range(1, 6):
    bpr = PRIORITIES_BAD[i % len(PRIORITIES_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-7-prio [{i}]", team=random.choice(TEAMS),
        desc=f"priority_not_found: '{bpr}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=bpr, dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "priority_not_found", f"Строка {row_num}: приоритет '{bpr}'"))

# --- ОШИБКА 8: deadline_not_found (5) ---
for i in range(1, 6):
    bdl = DEADLINES_BAD[i % len(DEADLINES_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-8-dl [{i}]", team=random.choice(TEAMS),
        desc=f"deadline_not_found: '{bdl}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=random.choice(PRIORITIES),
        dl=bdl, status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "deadline_not_found", f"Строка {row_num}: срок '{bdl}'"))

# --- ОШИБКА 9: status_not_found (5) ---
for i in range(1, 6):
    bst = STATUSES_BAD[i % len(STATUSES_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-9-status [{i}]", team=random.choice(TEAMS),
        desc=f"status_not_found: '{bst}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=random.choice(PRIORITIES),
        dl=random.choice(DEADLINES), status=bst)
    error_info.append((row_num, "status_not_found", f"Строка {row_num}: статус '{bst}'"))

# --- ОШИБКА 10: owner_not_found (5) — НЕ FATAL ---
for i in range(1, 6):
    bu = USERS_BAD[i % len(USERS_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-10-owner [{i}]", team=random.choice(TEAMS),
        desc=f"owner_not_found: '{bu}' (строка импортируется, не fatal)",
        date=random.choice(DATES_VALID), channel=random.choice(CHANNELS),
        bc=random.choice(BCUSTOMERS), dept=random.choice(DEPARTMENTS),
        proj=random.choice(PROJECTS), tt=random.choice(TASK_TYPES),
        prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА", owner=bu)
    error_info.append((row_num, "owner_not_found", f"Строка {row_num}: исполнитель '{bu}' (НЕ fatal)"))

# --- ОШИБКА 11: required_missing (8) ---
required_missing_cases = [
    ("", random.choice(TEAMS), "title пустой"),
    ("", random.choice(TEAMS), "title пустой"),
    (f"ERR-11-no-team [3]", "", "team_id пустой"),
    (f"ERR-11-no-team [4]", "", "team_id пустой"),
    ("", "", "оба пустые"),
    ("", "", "оба пустые"),
    ("", "НесущКомандаXYZ", "title пустой + team_not_found"),
    ("", "НесущКомандаXYZ", "title пустой + team_not_found"),
]
for idx, (t, tm, desc_text) in enumerate(required_missing_cases, 1):
    row_num = len(rows) + 2
    add(title=t, team=tm,
        desc=f"required_missing: {desc_text}",
        date=random.choice(DATES_VALID), channel=random.choice(CHANNELS),
        bc=random.choice(BCUSTOMERS), dept=random.choice(DEPARTMENTS),
        proj=random.choice(PROJECTS), tt=random.choice(TASK_TYPES),
        prio=random.choice(PRIORITIES), dl=random.choice(DEADLINES),
        status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "required_missing",
                       f"Строка {row_num}: обязательное поле пусто ({desc_text})"))

# --- ОШИБКА 12: invalid_date (5) ---
for i in range(1, 6):
    bd = DATES_BAD[i % len(DATES_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-12-date [{i}]", team=random.choice(TEAMS),
        desc=f"invalid_date: '{bd}'", date=bd,
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=random.choice(PRIORITIES),
        dl=random.choice(DEADLINES), status="НОВАЯ ЗАДАЧА")
    error_info.append((row_num, "invalid_date", f"Строка {row_num}: дата '{bd}'"))

# --- ОШИБКА 13: invalid_number (5) ---
for i in range(1, 6):
    be = EFFORT_BAD[i % len(EFFORT_BAD)]
    row_num = len(rows) + 2
    add(title=f"ERR-13-effort [{i}]", team=random.choice(TEAMS),
        desc=f"invalid_number: '{be}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=random.choice(PRIORITIES),
        dl=random.choice(DEADLINES), status="НОВАЯ ЗАДАЧА", effort=be)
    error_info.append((row_num, "invalid_number", f"Строка {row_num}: трудозатраты '{be}'"))

# --- ОШИБКА 14: invalid_progress (6) ---
for i, bp in enumerate(PROGRESS_BAD, 1):
    row_num = len(rows) + 2
    add(title=f"ERR-14-progress [{i}]", team=random.choice(TEAMS),
        desc=f"invalid_progress: '{bp}'", date=random.choice(DATES_VALID),
        channel=random.choice(CHANNELS), bc=random.choice(BCUSTOMERS),
        dept=random.choice(DEPARTMENTS), proj=random.choice(PROJECTS),
        tt=random.choice(TASK_TYPES), prio=random.choice(PRIORITIES),
        dl=random.choice(DEADLINES), status="НОВАЯ ЗАДАЧА", progress=bp)
    error_info.append((row_num, "invalid_progress", f"Строка {row_num}: прогресс '{bp}'"))

# ==================== STYLES ====================
def header_style():
    return {
        "font": Font(bold=True, color="FFFFFF", size=11),
        "fill": PatternFill("solid", fgColor="2E5090"),
        "alignment": Alignment(horizontal="center", vertical="center", wrap_text=True),
        "border": Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        ),
    }


def data_style(row_idx):
    colors = ["FFFFFF", "EEF2F8"]
    return {
        "fill": PatternFill("solid", fgColor=colors[row_idx % 2]),
        "alignment": Alignment(horizontal="left", vertical="center", wrap_text=True),
        "border": Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        ),
    }


def error_style():
    return {
        "font": Font(bold=True, color="FFFFFF"),
        "fill": PatternFill("solid", fgColor="C0392B"),
        "alignment": Alignment(horizontal="center", vertical="center"),
        "border": Border(
            left=Side(style="thin"),
            right=Side(style="thin"),
            top=Side(style="thin"),
            bottom=Side(style="thin"),
        ),
    }


def apply_style(cell, style):
    for attr, val in style.items():
        setattr(cell, attr, val)


def set_col_widths(ws, widths):
    for col, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(col)].width = w


# ==================== CREATE WORKBOOK ====================
wb = openpyxl.Workbook()

# ==================== SHEET 1: ИНСТРУКЦИЯ ====================
ws_inst = wb.active
ws_inst.title = "Инструкция"

instructions = [
    ("ТЕСТОВЫЙ ФАЙЛ ДЛЯ ИМПОРТА ЗАДАЧ", True, 16, "2E5090", "FFFFFF"),
    ("", False, 11, None, None),
    ("ВОПРОСЫ И ОТВЕТЫ", True, 13, "27AE60", "FFFFFF"),
    ("", False, 11, None, None),
    ("Что это за файл?", True, 11, None, None),
    ("Этот файл содержит 209 тестовых строк и 49 колонок (все импортируемые поля) для проверки импорта задач из Excel/CSV.", False, 11, None, None),
    ("Данные на листе 'Данные' можно использовать для импорта в DMB Backlog.", False, 11, None, None),
    ("", False, 11, None, None),
    ("Как импортировать?", True, 11, None, None),
    ("1. Открыть DMB Backlog", False, 11, None, None),
    ("2. Перейти на страницу backlog или Kanban", False, 11, None, None),
    ("3. Нажать кнопку 'Импорт' (иконка загрузки)", False, 11, None, None),
    ("4. Выбрать файл test_import_200.xlsx и нажать 'Импортировать'", False, 11, None, None),
    ("5. После импорта посмотреть результат: созданные задачи и ошибки", False, 11, None, None),
    ("", False, 11, None, None),
    ("Структура файла", True, 11, None, None),
    ("Лист 'Инструкция' — этот лист", False, 11, None, None),
    ("Лист 'Данные' — CSV-данные для импорта (заголовки в первой строке)", False, 11, None, None),
    ("Лист 'Ошибки' — перечень всех 16 типов ошибок с описанием и номерами строк", False, 11, None, None),
    ("", False, 11, None, None),
    ("РАЗДЕЛЫ ДАННЫХ", True, 13, "27AE60", "FFFFFF"),
    ("", False, 11, None, None),
    ("Строки 2-121 (120 шт):", True, 11, "27AE60", None),
    ("  Чисто валидные строки — ошибок нет, задачи создаются", False, 11, None, None),
    ("Строки 122-131 (10 шт):", True, 11, "C0392B", None),
    ("  team_not_found — несуществующая команда", False, 11, None, None),
    ("Строки 132-136 (5 шт):", True, 11, "C0392B", None),
    ("  channel_not_found — неверный канал", False, 11, None, None),
    ("Строки 137-141 (5 шт):", True, 11, "C0392B", None),
    ("  business_customer_not_found — неверный заказчик", False, 11, None, None),
    ("Строки 142-146 (5 шт):", True, 11, "C0392B", None),
    ("  department_not_found — неверное подразделение", False, 11, None, None),
    ("Строки 147-151 (5 шт):", True, 11, "C0392B", None),
    ("  project_not_found — неверный проект", False, 11, None, None),
    ("Строки 152-156 (5 шт):", True, 11, "C0392B", None),
    ("  task_type_not_found — неверный тип задачи", False, 11, None, None),
    ("Строки 157-161 (5 шт):", True, 11, "C0392B", None),
    ("  priority_not_found — неверный приоритет", False, 11, None, None),
    ("Строки 162-166 (5 шт):", True, 11, "C0392B", None),
    ("  deadline_not_found — неверный срок", False, 11, None, None),
    ("Строки 167-171 (5 шт):", True, 11, "C0392B", None),
    ("  status_not_found — неверный статус", False, 11, None, None),
    ("Строки 172-176 (5 шт):", True, 11, "E67E22", None),
    ("  owner_not_found — неверный исполнитель (НЕ fatal, задача создастся)", False, 11, None, None),
    ("Строки 177-184 (8 шт):", True, 11, "C0392B", None),
    ("  required_missing — пустое обязательное поле (title или team_id)", False, 11, None, None),
    ("Строки 185-189 (5 шт):", True, 11, "C0392B", None),
    ("  invalid_date — неверный формат даты", False, 11, None, None),
    ("Строки 190-194 (5 шт):", True, 11, "C0392B", None),
    ("  invalid_number — неверный числовой формат", False, 11, None, None),
    ("Строки 195-200 (6 шт):", True, 11, "C0392B", None),
    ("  invalid_progress — прогресс вне диапазона 0-100", False, 11, None, None),
    ("", False, 11, None, None),
    ("ОЖИДАЕМЫЙ РЕЗУЛЬТАТ", True, 13, "2E5090", "FFFFFF"),
    ("", False, 11, None, None),
    ("  Всего строк: 199", False, 11, None, None),
    ("  Должно создаться: ~125 задач (120 валидных + 5 owner_not_found)", False, 11, None, None),
    ("  Должно пропуститься (fatal): ~69 строк", False, 11, None, None),
    ("  owner_not_found (создастся с предупреждением): 5 строк", False, 11, None, None),
    ("", False, 11, None, None),
    ("СПРАВОЧНИКИ (валидные значения)", True, 13, "27AE60", "FFFFFF"),
    ("", False, 11, None, None),
    ("Команды (teams):", True, 11, None, None),
    (", ".join(TEAMS), False, 10, None, None),
    ("", False, 11, None, None),
    ("Каналы (channels):", True, 11, None, None),
    (", ".join(CHANNELS), False, 10, None, None),
    ("", False, 11, None, None),
    ("Бизнес-заказчики:", True, 11, None, None),
    (", ".join(BCUSTOMERS), False, 10, None, None),
    ("", False, 11, None, None),
    ("Подразделения:", True, 11, None, None),
    (", ".join(DEPARTMENTS), False, 10, None, None),
    ("", False, 11, None, None),
    ("Проекты (неполный список):", True, 11, None, None),
    (", ".join(PROJECTS[:8]) + "...", False, 10, None, None),
    ("", False, 11, None, None),
    ("Типы задач:", True, 11, None, None),
    (", ".join(TASK_TYPES), False, 10, None, None),
    ("", False, 11, None, None),
    ("Приоритеты:", True, 11, None, None),
    (", ".join(PRIORITIES), False, 10, None, None),
    ("", False, 11, None, None),
    ("Сроки:", True, 11, None, None),
    (", ".join(DEADLINES), False, 10, None, None),
    ("", False, 11, None, None),
    ("Статусы:", True, 11, None, None),
    (", ".join(STATUSES), False, 10, None, None),
    ("", False, 11, None, None),
    ("Пользователи (исполнители):", True, 11, None, None),
    (", ".join(USERS), False, 10, None, None),
    ("", False, 11, None, None),
    ("Формат даты: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, DD.MM.YY, DD/MM/YY", False, 10, None, None),
    ("Прогресс: целое число 0-100", False, 10, None, None),
    ("Разделитель множественных значений в 'Ссылки на Jira': точка с запятой (;)", False, 10, None, None),
    ("'Другие вовлеченные команды': названия команд через ';' (в формате Excel)", False, 10, None, None),
]

for row_data in instructions:
    text, bold, size, bg_color, font_color = row_data
    row_num = ws_inst.max_row + 1
    cell = ws_inst.cell(row=row_num, column=1, value=text)
    if bg_color:
        cell.fill = PatternFill("solid", fgColor=bg_color)
    cell.font = Font(bold=bold, size=size,
                     color=font_color if font_color else "000000")
    if bg_color in ("2E5090", "27AE60", "C0392B"):
        cell.font = Font(bold=bold, size=size, color="FFFFFF")
        cell.alignment = Alignment(horizontal="left", vertical="center")
    else:
        cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

ws_inst.column_dimensions["A"].width = 100

# ==================== SHEET 2: ДАННЫЕ ====================
ws_data = wb.create_sheet("Данные")

# Цветные маркеры для групп ошибок
GROUP_COLORS = {
    "valid": "D5E8D4",         # светло-зелёный
    "team_not_found": "FFE6CC",  # светло-оранжевый
    "channel_not_found": "FFE6CC",
    "bc_not_found": "FFE6CC",
    "dept_not_found": "FFE6CC",
    "project_not_found": "FFE6CC",
    "tt_not_found": "FFE6CC",
    "prio_not_found": "FFE6CC",
    "dl_not_found": "FFE6CC",
    "status_not_found": "FFE6CC",
    "owner_not_found": "FFF2CC",  # жёлтый (не fatal)
    "required_missing": "F8CECC", # светло-красный
    "invalid_date": "F8CECC",
    "invalid_number": "F8CECC",
    "invalid_progress": "F8CECC",
}

# Build error row map for coloring
error_row_map = {}
for row_num, err_type, _ in error_info:
    error_row_map[row_num] = err_type

# Write header
for col, header in enumerate(HEADERS, 1):
    cell = ws_data.cell(row=1, column=col, value=header)
    style = header_style()
    apply_style(cell, style)

# Write data rows
for row_idx, row_data in enumerate(rows, 2):
    # Determine color group
    err_type = error_row_map.get(row_idx, "valid")
    if err_type == "owner_not_found":
        color = GROUP_COLORS["owner_not_found"]
    elif err_type in ("team_not_found", "channel_not_found", "business_customer_not_found",
                      "department_not_found", "project_not_found", "task_type_not_found",
                      "priority_not_found", "deadline_not_found", "status_not_found"):
        color = GROUP_COLORS["team_not_found"]
    elif err_type in ("required_missing", "invalid_date", "invalid_number", "invalid_progress"):
        color = GROUP_COLORS["required_missing"]
    else:
        color = GROUP_COLORS["valid"]

    for col, key in enumerate(HEADERS, 1):
        cell = ws_data.cell(row=row_idx, column=col, value=row_data[key])
        cell.fill = PatternFill("solid", fgColor=color)
        cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        cell.border = Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        )
        cell.font = Font(size=10)

# Column widths for data sheet
col_widths_data = [
    15, 30, 25, 40, 14, 18, 18, 30, 35, 22, 25, 12, 16, 18, 14, 14, 12, 14,
    16, 22, 14, 10, 12, 14, 16, 12, 14, 16, 22, 14, 10, 12, 14, 16, 30, 10,
    12, 30, 40, 30, 25, 15, 30, 25, 20, 25, 20, 20, 18,
]
for col, w in enumerate(col_widths_data, 1):
    ws_data.column_dimensions[get_column_letter(col)].width = w

ws_data.row_dimensions[1].height = 40
ws_data.freeze_panes = "A2"

# ==================== SHEET 3: ОШИБКИ ====================
ws_err = wb.create_sheet("Ошибки")

error_types = [
    ("team_not_found", "Справочник 'Команды'",
     "Команда не найдена в справочнике команд. Строка пропускается (fatal).",
     "Убедиться что команда существует в БД. Добавить через админ-панель."),
    ("channel_not_found", "Справочник 'Каналы'",
     "Канал не найден в справочнике каналов. Строка пропускается (fatal).",
     "Убедиться что канал существует в БД."),
    ("business_customer_not_found", "Справочник 'Бизнес-заказчики'",
     "Бизнес-заказчик не найден. Строка пропускается (fatal).",
     "Убедиться что заказчик существует в БД."),
    ("department_not_found", "Справочник 'Подразделения'",
     "Подразделение не найдено. Строка пропускается (fatal).",
     "Убедиться что подразделение существует в БД."),
    ("project_not_found", "Справочник 'Проекты'",
     "Проект не найден. Строка пропускается (fatal).",
     "Убедиться что проект существует в БД."),
    ("task_type_not_found", "Справочник 'Типы задач'",
     "Тип задачи не найден. Строка пропускается (fatal).",
     "Убедиться что тип задачи существует в БД."),
    ("priority_not_found", "Справочник 'Приоритеты'",
     "Приоритет не найден. Строка пропускается (fatal).",
     "Убедиться что приоритет существует в БД."),
    ("deadline_not_found", "Справочник 'Сроки'",
     "Срок выполнения не найден. Строка пропускается (fatal).",
     "Убедиться что срок существует в БД."),
    ("status_not_found", "Справочник 'Статусы'",
     "Статус не найден. Строка пропускается (fatal).",
     "Убедиться что статус существует в БД."),
    ("owner_not_found", "Справочник 'Пользователи'",
     "Исполнитель не найден. Строка ИМПОРТИРУЕТСЯ (не fatal), поле пропускается.",
     "Убедиться что пользователь активен в БД."),
    ("required_missing", "Обязательные поля",
     "Поле title или team_id пустое. Строка пропускается (fatal).",
     "Заполнить обязательное поле в CSV."),
    ("invalid_date", "Формат даты",
     "Дата не соответствует форматам YYYY-MM-DD, DD.MM.YYYY и т.д. Строка пропускается (fatal).",
     "Исправить формат даты в CSV."),
    ("invalid_number", "Числовое поле",
     "Значение не является числом. Строка пропускается (fatal).",
     "Исправить значение на число."),
    ("invalid_progress", "Прогресс",
     "Прогресс вне диапазона 0-100 или не число. Строка пропускается (fatal).",
     "Указать целое число от 0 до 100."),
    ("unknown_error", "Внутренние ошибки",
     "Неизвестная ошибка при обработке строки (исключение в бэкенде). Строка пропускается (fatal).",
     "Проверить логи сервера (backend/logs/ или stdout). В тестовом файле не воспроизводится."),
]

err_headers = ["Код ошибки", "Категория", "Описание", "Что делать", "Строки с этой ошибкой"]
err_header_style = {
    "font": Font(bold=True, color="FFFFFF", size=11),
    "fill": PatternFill("solid", fgColor="2E5090"),
    "alignment": Alignment(horizontal="center", vertical="center", wrap_text=True),
    "border": Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    ),
}

for col, h in enumerate(err_headers, 1):
    cell = ws_err.cell(row=1, column=col, value=h)
    apply_style(cell, err_header_style)

err_row_colors = {
    "owner_not_found": "FFF2CC",
    "team_not_found": "FFE6CC",
    "required_missing": "F8CECC",
    "valid": "D5E8D4",
}

for row_idx, (code, category, desc, solution) in enumerate(error_types, 2):
    # Find rows in error_info
    matching_rows = [str(r) for r, e, _ in error_info if e == code]
    rows_str = ", ".join(matching_rows) if matching_rows else "—"

    color = err_row_colors.get(code, "FFFFFF")
    row_style = {
        "fill": PatternFill("solid", fgColor=color),
        "alignment": Alignment(horizontal="left", vertical="top", wrap_text=True),
        "border": Border(
            left=Side(style="thin"), right=Side(style="thin"),
            top=Side(style="thin"), bottom=Side(style="thin"),
        ),
        "font": Font(size=10),
    }

    for col, val in enumerate([code, category, desc, solution, rows_str], 1):
        cell = ws_err.cell(row=row_idx, column=col, value=val)
        apply_style(cell, row_style)

    # Color code cell differently
    code_cell = ws_err.cell(row=row_idx, column=1)
    code_cell.font = Font(bold=True, size=10,
                          color="FFFFFF" if code not in ("owner_not_found",) else "000000")
    code_cell.fill = PatternFill(
        "solid",
        fgColor={
            "owner_not_found": "F39C12",
            "team_not_found": "E67E22",
            "required_missing": "C0392B",
            "valid": "27AE60",
        }.get(code, "7F8C8D")
    )

ws_err.column_dimensions["A"].width = 25
ws_err.column_dimensions["B"].width = 22
ws_err.column_dimensions["C"].width = 50
ws_err.column_dimensions["D"].width = 45
ws_err.column_dimensions["E"].width = 30
ws_err.row_dimensions[1].height = 35
ws_err.freeze_panes = "A2"

# ==================== SAVE ====================
output_path = os.path.join(os.path.dirname(__file__), "test_import_200.xlsx")
wb.save(output_path)
print(f"Excel записан: {output_path}")
print(f"Всего строк данных: {len(rows)}")
print(f"Групп ошибок: {len(error_types)}")
print(f"Строк с ошибками: {len(error_info)}")
