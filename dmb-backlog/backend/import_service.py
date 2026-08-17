"""
DMB Backlog - CSV import service for tasks.

Полный flow импорта задач из CSV:
  1. Декодирование файла (UTF-8-SIG -> Windows-1251).
  2. Автоопределение разделителя (запятая или точка с запятой).
  3. Построение маппинга "русская метка из field_labels -> ключ БД" по умолчанию.
  4. Построчная валидация (справочники, обязательные поля, форматы).
  5. Сохранение валидных строк (task_jira_links + task_history + audit_log).

Ошибочные строки пропускаются, валидные импортируются. Ошибки не прерывают обработку файла.
"""
import csv
import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from models import (
    Task, Team, Channel, BusinessCustomer, Department, Project, TaskType,
    Priority, Deadline, TaskStatus, User, TaskHistory, AuditLog, TaskJiraLink,
    FieldLabel,
)

# Импортируемые поля (белый список)
IMPORTABLE_FIELDS = [
    'title', 'team_id', 'description', 'date_received',
    'channel_id', 'business_customer_id', 'department_id', 'project_id',
    'task_type_id', 'involved_teams', 'priority_id', 'status_id',
    'deadline_id',
    'effort_days', 'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be',
    'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics',
    'actual_effort_be', 'actual_effort_python_be', 'actual_effort_fe',
    'actual_effort_test', 'actual_effort_test_auto', 'actual_effort_delivery',
    'financial_effect', 'financial_effect_justification', 'cv', 'progress',
    'link_mockups', 'link_jira', 'rejection_reason', 'comment', 'owner_id',
    'key_project_status', 'directorate_status', 'did_status', 'did_demo',
    'metric_kr_plan', 'metric_kr_fact', 'metric_kr_unit',
]
IMPORTABLE_SET = set(IMPORTABLE_FIELDS)

INTEGER_FIELDS = {'effort_days', 'progress'}
FLOAT_FIELDS = {
    'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be',
    'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto',
    'effort_delivery', 'actual_effort_days', 'actual_effort_designee',
    'actual_effort_analytics', 'actual_effort_be', 'actual_effort_python_be',
    'actual_effort_fe', 'actual_effort_test', 'actual_effort_test_auto',
    'actual_effort_delivery', 'financial_effect', 'cv',
    'metric_kr_plan', 'metric_kr_fact',
}
BOOLEAN_FIELDS = {'did_demo'}
DATE_FIELDS = {'date_received'}
LIST_FIELDS = {'involved_teams', 'link_jira'}

DATE_FORMATS = ('%Y-%m-%d', '%d.%m.%Y', '%d/%m/%Y', '%d.%m.%y', '%d/%m/%y')

# Справочные поля: не найдено в справочнике -> строка пропускается (ошибки 1-9)
REFERENCE_FIELDS: List[Dict[str, Any]] = [
    {'key': 'team_id', 'type': 'team_not_found',
     'message': 'Команда "{value}" не найдена в справочнике команд', 'ref': 'teams'},
    {'key': 'channel_id', 'type': 'channel_not_found',
     'message': 'Канал "{value}" не найден в справочнике каналов', 'ref': 'channels'},
    {'key': 'business_customer_id', 'type': 'business_customer_not_found',
     'message': 'Бизнес-заказчик "{value}" не найден в справочнике', 'ref': 'business_customers'},
    {'key': 'department_id', 'type': 'department_not_found',
     'message': 'Подразделение "{value}" не найдено в справочнике подразделений', 'ref': 'departments'},
    {'key': 'project_id', 'type': 'project_not_found',
     'message': 'Проект "{value}" не найден в справочнике проектов', 'ref': 'projects'},
    {'key': 'task_type_id', 'type': 'task_type_not_found',
     'message': 'Тип задачи "{value}" не найден в справочнике типов задач', 'ref': 'task_types'},
    {'key': 'priority_id', 'type': 'priority_not_found',
     'message': 'Приоритет "{value}" не найден в справочнике приоритетов', 'ref': 'priorities'},
    {'key': 'deadline_id', 'type': 'deadline_not_found',
     'message': 'Срок выполнения "{value}" не найден в справочнике сроков', 'ref': 'deadlines'},
    {'key': 'status_id', 'type': 'status_not_found',
     'message': 'Статус "{value}" не найден в справочнике статусов', 'ref': 'statuses'},
]
REFERENCE_BY_KEY = {r['key']: r for r in REFERENCE_FIELDS}

OWNER_FIELD = {'key': 'owner_id', 'type': 'owner_not_found',
               'message': 'Исполнитель "{value}" не найден в справочнике пользователей',
               'ref': 'users'}


# ==================== PARSING ====================

def decode_content(raw: bytes) -> str:
    """Декодирует байты файла: UTF-8-SIG (BOM) -> Windows-1251."""
    for enc in ('utf-8-sig', 'cp1251'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, AttributeError):
            continue
    raise ValueError("Не удалось декодировать файл. Убедитесь, что файл в формате UTF-8 или Windows-1251")


def detect_delimiter(content: str) -> str:
    """Автоопределение разделителя: точка с запятой или запятая."""
    first_line = content.split('\n', 1)[0] if content else ''
    semicolons = first_line.count(';')
    commas = first_line.count(',')
    if semicolons > commas:
        return ';'
    if commas > semicolons:
        return ','
    return ';' if semicolons > 0 else ','


def parse_csv(content: str, delimiter: str) -> List[dict]:
    """Парсит CSV в список dict (первая строка — заголовки)."""
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    rows = []
    for raw in reader:
        if not raw:
            continue
        # csv.DictReader возвращает None для недостающих значений
        rows.append({k.strip(): v for k, v in raw.items() if k is not None})
    return rows


# ==================== MAPPING ====================

def _norm(value: str) -> str:
    return re.sub(r'\s+', ' ', str(value).strip().lower())


def field_label(db_key: str, db_key_to_label: dict) -> str:
    return db_key_to_label.get(db_key, db_key)


def build_field_map(db: Session) -> tuple:
    """Строит маппинг заголовков CSV -> ключи БД на основе field_labels.

    Принимаются как русские метки, так и прямые DB-ключи (без учёта регистра).
    Возвращает (field_map, db_key_to_label, required_fields).
    """
    labels = db.query(FieldLabel).all()
    db_key_to_label = {fl.key: fl.label for fl in labels}
    field_map = {}

    for fl in labels:
        if fl.key in IMPORTABLE_SET:
            field_map[_norm(fl.label)] = fl.key
            field_map[_norm(fl.key)] = fl.key

    required_fields = set()
    for fl in labels:
        if fl.is_required and fl.key in IMPORTABLE_SET:
            required_fields.add(fl.key)
    # Обязательные поля по умолчанию (title/team_id) — даже если field_labels не заполнены
    required_fields.add('title')
    required_fields.add('team_id')

    return field_map, db_key_to_label, required_fields


# ==================== REFERENCE INDEXES ====================

def _index_from(items, *attrs):
    index = {}
    for item in items:
        for attr in attrs:
            val = getattr(item, attr, None)
            if val is not None and str(val).strip():
                index.setdefault(_norm(val), item.id)
    return index


def load_reference_indexes(db: Session) -> Dict[str, dict]:
    """Загружает справочники в память: нормализованное имя -> id."""
    refs = {}
    refs['teams'] = _index_from(db.query(Team).all(), 'name', 'abbr')
    refs['channels'] = _index_from(db.query(Channel).all(), 'name', 'code')
    refs['business_customers'] = _index_from(db.query(BusinessCustomer).all(), 'name')
    refs['departments'] = _index_from(db.query(Department).all(), 'name', 'code')
    refs['projects'] = _index_from(db.query(Project).all(), 'name', 'code')
    refs['task_types'] = _index_from(db.query(TaskType).all(), 'name', 'code')
    refs['priorities'] = _index_from(db.query(Priority).all(), 'name', 'code')
    refs['deadlines'] = _index_from(db.query(Deadline).all(), 'name', 'code')
    refs['statuses'] = _index_from(db.query(TaskStatus).all(), 'name', 'code')
    refs['users'] = _index_from(db.query(User).filter(User.is_active == True).all(),
                                'name', 'login', 'email')
    return refs


def _lookup(index: dict, value) -> Optional[int]:
    if value is None or not str(value).strip():
        return None
    return index.get(_norm(value))


# ==================== VALIDATION HELPERS ====================

def _split_list(value: str) -> List[str]:
    return [v.strip() for v in re.split(r'[,;]', str(value)) if v.strip()]


def _parse_date(value: str) -> Optional[date]:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except (ValueError, TypeError):
            continue
    return None


def _parse_number(value: str, is_int: bool):
    """Возвращает (число | None, ошибка | None)."""
    if is_int:
        try:
            return int(str(value).strip()), None
        except (ValueError, TypeError):
            try:
                fval = float(str(value).strip())
                if fval.is_integer():
                    return int(fval), None
            except (ValueError, TypeError):
                pass
            return None, True
    try:
        return float(str(value).strip()), None
    except (ValueError, TypeError):
        return None, True


def _parse_bool(value) -> bool:
    return str(value).strip().lower() in ('true', '1', 'yes', 'да', 'y')


def make_error(row: int, db_key: str, db_key_to_label: dict, value: Any,
               error_type: str, message: str, fatal: bool) -> dict:
    return {
        'row': row,
        'field': db_key,
        'field_label': field_label(db_key, db_key_to_label),
        'value': str(value) if value is not None else '',
        'type': error_type,
        'message': message,
        'fatal': fatal,
    }


# ==================== ROW PROCESSING ====================

def process_row(row_num: int, raw: dict, field_map: dict, db_key_to_label: dict,
                refs: dict, required_fields: set,
                db: Session, current_user_id: int) -> tuple:
    """Обрабатывает одну строку CSV.

    Возвращает (task | None, errors: list). Если task None — строка пропущена.
    """
    errors: List[dict] = []
    task_data: Dict[str, Any] = {}
    jira_links: List[str] = []

    for header, raw_value in raw.items():
        key = field_map.get(_norm(header))
        if key is None:
            continue
        value = str(raw_value).strip() if raw_value is not None else ''
        if value == '':
            continue

        if key == 'link_jira':
            jira_links = _split_list(value)
            if jira_links:
                task_data['link_jira'] = jira_links
            continue

        if key == 'involved_teams':
            ids = []
            for v in _split_list(value):
                tid = _lookup(refs['teams'], v)
                if tid is None and str(v).strip().isdigit():
                    tid = int(str(v).strip())
                if tid is None:
                    errors.append(make_error(
                        row_num, key, db_key_to_label, v, 'team_not_found',
                        'Команда "{value}" не найдена в справочнике команд'.format(value=v),
                        fatal=True,
                    ))
                else:
                    ids.append(tid)
            if ids:
                task_data['involved_teams'] = ids
            continue

        if key == 'owner_id':
            uid = _lookup(refs['users'], value)
            if uid is None:
                errors.append(make_error(
                    row_num, key, db_key_to_label, value, OWNER_FIELD['type'],
                    OWNER_FIELD['message'].format(value=value), fatal=False,
                ))
            else:
                task_data[key] = uid
            continue

        ref = REFERENCE_BY_KEY.get(key)
        if ref is not None:
            rid = _lookup(refs[ref['ref']], value)
            if rid is None:
                errors.append(make_error(
                    row_num, key, db_key_to_label, value, ref['type'],
                    ref['message'].format(value=value), fatal=True,
                ))
            else:
                task_data[key] = rid
            continue

        if key in DATE_FIELDS:
            parsed = _parse_date(value)
            if parsed is None:
                errors.append(make_error(
                    row_num, key, db_key_to_label, value, 'invalid_date',
                    f'Неверный формат даты: "{value}"', fatal=True,
                ))
            else:
                task_data[key] = parsed
            continue

        if key == 'progress':
            parsed, err = _parse_number(value, is_int=True)
            if parsed is None or err or parsed < 0 or parsed > 100:
                errors.append(make_error(
                    row_num, key, db_key_to_label, value, 'invalid_progress',
                    f'Неверный формат прогресса: "{value}"', fatal=True,
                ))
            else:
                task_data[key] = parsed
            continue

        if key in INTEGER_FIELDS:
            parsed, err = _parse_number(value, is_int=True)
            if parsed is None or err:
                errors.append(make_error(
                    row_num, key, db_key_to_label, value, 'invalid_number',
                    f'Неверный числовой формат: "{value}"', fatal=True,
                ))
            else:
                task_data[key] = parsed
            continue

        if key in FLOAT_FIELDS:
            parsed, err = _parse_number(value, is_int=False)
            if parsed is None or err:
                errors.append(make_error(
                    row_num, key, db_key_to_label, value, 'invalid_number',
                    f'Неверный числовой формат: "{value}"', fatal=True,
                ))
            else:
                task_data[key] = parsed
            continue

        if key in BOOLEAN_FIELDS:
            task_data[key] = _parse_bool(value)
            continue

        task_data[key] = value

    # Обязательные поля (Обязательность = Да)
    for req_key in sorted(required_fields):
        if req_key not in task_data or task_data[req_key] in (None, ''):
            label = field_label(req_key, db_key_to_label)
            errors.append(make_error(
                row_num, req_key, db_key_to_label, '', 'required_missing',
                f'Поле "{label}" обязательно для заполнения', fatal=True,
            ))

    fatal = any(e['fatal'] for e in errors)
    if fatal:
        return None, errors

    task = _build_task(db, task_data, jira_links, current_user_id)
    return task, errors


def _build_task(db: Session, task_data: dict, jira_links: List[str],
                current_user_id: int) -> Task:
    """Создаёт объект Task с авторасчётами (без commit)."""
    from routers.tasks_router import (
        compute_actual_effort_days, compute_effort_rub,
        ACTUAL_EFFORT_FIELDS, COMPETENCY_EFFORT_FIELDS,
    )

    task = Task(**task_data)
    task.actual_effort_days = compute_actual_effort_days(
        {f: getattr(task, f) for f in ACTUAL_EFFORT_FIELDS})
    if task.status_id is None:
        task.status_id = 1  # НОВАЯ ЗАДАЧА
    if task.date_received is None:
        task.date_received = date.today()
    if task.created_by is None:
        task.created_by = current_user_id

    # Авторасчёт стоимости по ЭО (если не заполнена напрямую)
    effort_rub = compute_effort_rub(
        db, {f: getattr(task, f) for f, _ in COMPETENCY_EFFORT_FIELDS}, task.effort_rub)
    if effort_rub is not None:
        task.effort_rub = effort_rub
    if task.effort_rub is not None and task.effort_rub > 0 and task.financial_effect is not None:
        task.cv = round(float(task.financial_effect) / float(task.effort_rub), 2)

    return task


def persist_task(db: Session, task: Task, jira_links: List[str],
                 current_user_id: int) -> None:
    """Сохраняет задачу, ссылки Jira (двойная запись), task_history и audit_log."""
    db.add(task)
    db.flush()

    if jira_links:
        for url in jira_links:
            db.add(TaskJiraLink(task_id=task.id, url=url))
        task.link_jira = jira_links

    history_fields = [
        ('title', None, task.title),
        ('status_id', None, str(task.status_id)),
        ('priority_id', None, str(task.priority_id)),
        ('team_id', None, str(task.team_id)),
    ]
    if task.description:
        history_fields.append(('description', None, task.description))
    if task.deadline_id:
        history_fields.append(('deadline_id', None, str(task.deadline_id)))
    if task.financial_effect is not None:
        history_fields.append(('financial_effect', None, str(task.financial_effect)))
    if task.effort_days is not None:
        history_fields.append(('effort_days', None, str(task.effort_days)))
    if task.effort_rub is not None:
        history_fields.append(('effort_rub', None, str(task.effort_rub)))

    for field_name, old_val, new_val in history_fields:
        db.add(TaskHistory(
            task_id=task.id, changed_by=current_user_id,
            field_name=field_name, old_value=old_val, new_value=new_val,
        ))

    db.add(AuditLog(
        user_id=current_user_id,
        action='import',
        entity_type='task',
        entity_id=task.id,
        details=f"Task '{task.title}' imported from CSV",
    ))


# ==================== MAIN ENTRY ====================

def import_tasks_from_csv(db: Session, raw: bytes, current_user: User) -> dict:
    """Основная точка входа. Возвращает результат импорта."""
    content = decode_content(raw)
    delimiter = detect_delimiter(content)
    rows = parse_csv(content, delimiter)

    field_map, db_key_to_label, required_fields = build_field_map(db)
    refs = load_reference_indexes(db)

    result = {
        'total': len(rows),
        'created': 0,
        'skipped': 0,
        'errors': [],
    }
    created_task_ids = []

    for idx, raw in enumerate(rows):
        row_num = idx + 2  # +1 заголовок
        try:
            task, errors = process_row(
                row_num, raw, field_map, db_key_to_label, refs,
                required_fields, db, current_user.id,
            )
        except Exception as e:  # noqa: BLE001 — неизвестная ошибка (тип 16)
            result['errors'].append(make_error(
                row_num, '', db_key_to_label, '',
                'unknown_error', f'Неизвестная ошибка при обработке строки: {e}', fatal=True,
            ))
            result['skipped'] += 1
            continue

        result['errors'].extend(errors)

        if task is None:
            result['skipped'] += 1
            continue

        try:
            persist_task(db, task, jira_links=_jira_of(task), current_user_id=current_user.id)
        except Exception as e:  # noqa: BLE001
            result['errors'].append(make_error(
                row_num, '', db_key_to_label, '',
                'unknown_error', f'Неизвестная ошибка при обработке строки: {e}', fatal=True,
            ))
            result['skipped'] += 1
            continue

        created_task_ids.append(task.id)
        result['created'] += 1

    try:
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        result['created'] = 0
        result['task_ids'] = []
        result['errors'].append({
            'row': None, 'field': '', 'field_label': '',
            'value': '', 'type': 'unknown_error',
            'message': f'Неизвестная ошибка при сохранении импорта: {e}', 'fatal': True,
        })
    result['task_ids'] = created_task_ids
    return result


def _jira_of(task: Task) -> List[str]:
    links = getattr(task, 'link_jira', None)
    if isinstance(links, list):
        return links
    return []
