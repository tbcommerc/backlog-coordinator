"""Проверка движка фильтров/сортировки отчётов напрямую через SQLAlchemy.

Нужен для окружений без pytest/httpx. Не трогает продакшн-БД.
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (HERE, BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Task
from routers.reports_router import _apply_report_filters, _report_sort_key

DB_FILE = os.path.join(tempfile.gettempdir(), "dmb_test_reports_engine.db")
if os.path.exists(DB_FILE):
    os.remove(DB_FILE)

ENGINE = create_engine(f"sqlite:///{DB_FILE}", connect_args={"check_same_thread": False})


def _lower(v):
    return v.lower() if isinstance(v, str) else v


@event.listens_for(ENGINE, "connect")
def _register_lower_unicode(dbapi_conn, connection_record):
    dbapi_conn.create_function("lower_unicode", 1, _lower)


Session = sessionmaker(autocommit=False, autoflush=False, bind=ENGINE)


def seed(db):
    from models import (
        BusinessCustomer, Channel, Deadline, Department, Priority, Project,
        TaskStatus, TaskType, Team, User,
    )
    p_high = Priority(name="ВЫСОКИЙ")
    p_mid = Priority(name="СРЕДНИЙ")
    p_low = Priority(name="НИЗКИЙ")
    s_req = TaskStatus(code="S_REQ", name="СБОР ТРЕБОВАНИЙ")
    s_done = TaskStatus(code="S_DONE", name="ВЫПОЛНЕНА")
    team_a = Team(name="Команда А")
    team_b = Team(name="Команда Б")
    proj = Project(code="P_1", name="Проект 1")
    dl_q3 = Deadline(code="D_Q3", name="3Q 2026")
    dl_q4 = Deadline(code="D_Q4", name="4Q 2026")
    tt_kr = TaskType(code="TT_KR", name="МЕТРИЧЕСКИЕ KR")
    tt_reg = TaskType(code="TT_REG", name="Обычная")
    dept = Department(code="DEP_A", name="Департамент А")
    chan = Channel(code="CH_A", name="Канал А")
    bc = BusinessCustomer(name="Заказчик 1")
    owner = User(email="owner@dmb.ru", name="Владелец 1", password_hash="x")
    db.add_all([
        p_high, p_mid, p_low, s_req, s_done, team_a, team_b, proj,
        dl_q3, dl_q4, tt_kr, tt_reg, dept, chan, bc, owner,
    ])
    db.commit()
    for o in [p_high, p_mid, p_low, s_req, s_done, team_a, team_b, proj,
              dl_q3, dl_q4, tt_kr, tt_reg, dept, chan, bc, owner]:
        db.refresh(o)

    tasks = [
        Task(team_id=team_a.id, title="Задача 1", priority_id=p_high.id,
             status_id=s_req.id, deadline_id=dl_q3.id, project_id=proj.id,
             owner_id=owner.id, task_type_id=tt_kr.id,
             business_customer_id=bc.id, department_id=dept.id, channel_id=chan.id,
             did_status="В работе", key_project=True, progress=100,
             financial_effect=10.5),
        Task(team_id=team_a.id, title="Задача 2", priority_id=p_low.id,
             status_id=s_done.id, deadline_id=dl_q4.id, task_type_id=tt_reg.id,
             did_status="", key_project=False, progress=0,
             financial_effect=0),
        Task(team_id=team_b.id, title="Задача 3", priority_id=p_mid.id,
             status_id=s_req.id, deadline_id=dl_q3.id,
             did_status="Требует решения", key_project=True, progress=50),
        Task(team_id=team_b.id, title="Задача 4 (без статуса)", priority_id=p_mid.id,
             deadline_id=dl_q3.id, progress=20),
    ]
    db.add_all(tasks)
    db.commit()
    return tasks


def exec_filter_ids(db, filters):
    q = db.query(Task).filter(Task.is_deleted == False)
    q = _apply_report_filters(q, filters)
    return sorted(t.title for t in q.all())


def build_items(db):
    items = []
    for t in db.query(Task).filter(Task.is_deleted == False).all():
        items.append({
            "id": t.id,
            "title": t.title,
            "team_name": t.team.name if t.team else "",
            "priority_name": t.priority.name if t.priority else "",
            "status_name": t.status.name if t.status else "",
            "project_name": t.project.name if t.project else "",
            "deadline_name": t.deadline.name if t.deadline else "",
            "owner_name": t.owner.name if t.owner else "",
            "task_type_name": t.task_type.name if t.task_type else "",
            "business_customer_name": t.business_customer_rel.name if t.business_customer_rel else "",
            "department_name": t.department.name if t.department else "",
            "channel_name": t.channel.name if t.channel else "",
            "did_status": t.did_status or "",
            "key_project": t.key_project,
            "progress": t.progress or 0,
            "financial_effect": t.financial_effect,
        })
    return items


def sort_items(items, sort_by, sort_order):
    reverse = sort_order == "desc"
    items = list(items)
    items.sort(key=lambda x: _report_sort_key(x, sort_by), reverse=reverse)
    items.sort(key=lambda x: 1 if x.get(sort_by) is None else 0)
    return items


def main():
    Base.metadata.drop_all(bind=ENGINE)
    Base.metadata.create_all(bind=ENGINE)
    db = Session()
    seed(db)

    results = []

    def check(name, cond, extra=""):
        results.append(bool(cond))
        print(f"{'PASS' if cond else 'FAIL'}  {name}  {extra}")

    def titles(filters):
        return sorted(exec_filter_ids(db, filters))

    def F(field, operator, value):
        return [{"field": field, "operator": operator, "value": value}]

    # --- фильтры ---
    check("pip: status_name != Выполнена (регистр не важен, NULL включается)",
          titles(F("status_name", "not_equals", "выполнена")) == ["Задача 1", "Задача 3", "Задача 4 (без статуса)"],
          str(titles(F("status_name", "not_equals", "выполнена"))))
    check("projects: key_project == true (bool)",
          titles(F("key_project", "equals", True)) == ["Задача 1", "Задача 3"])
    check("did-backlog: did_status != '' (не пусто)",
          titles(F("did_status", "not_equals", "")) == ["Задача 1", "Задача 3"])
    check("reg-directors: priority_name == 'высокий' (регистронезависимо)",
          titles(F("priority_name", "equals", "высокий")) == ["Задача 1"])
    check("deadline_name == '3Q 2026'",
          titles(F("deadline_name", "equals", "3Q 2026")) == ["Задача 1", "Задача 3", "Задача 4 (без статуса)"])
    check("owner_name == 'Владелец 1'",
          titles(F("owner_name", "equals", "Владелец 1")) == ["Задача 1"])
    check("task_type_name == 'Обычная'",
          titles(F("task_type_name", "equals", "Обычная")) == ["Задача 2"])
    check("business_customer_name == 'Заказчик 1'",
          titles(F("business_customer_name", "equals", "Заказчик 1")) == ["Задача 1"])
    check("department_name == 'Департамент А'",
          titles(F("department_name", "equals", "Департамент А")) == ["Задача 1"])
    check("channel_name == 'Канал А'",
          titles(F("channel_name", "equals", "Канал А")) == ["Задача 1"])
    check("team_name contains 'Команда'",
          titles(F("team_name", "contains", "Команда")) == ["Задача 1", "Задача 2", "Задача 3", "Задача 4 (без статуса)"])
    check("status_name in [ВЫПОЛНЕНА, СБОР ТРЕБОВАНИЙ]",
          titles(F("status_name", "in", ["ВЫПОЛНЕНА", "СБОР ТРЕБОВАНИЙ"])) == ["Задача 1", "Задача 2", "Задача 3"])
    check("title contains 'Задача'",
          titles(F("title", "contains", "Задача")) == ["Задача 1", "Задача 2", "Задача 3", "Задача 4 (без статуса)"])
    check("progress > 50 (числовой)",
          titles(F("progress", "gt", 50)) == ["Задача 1"])
    check("progress < 50 (числовой, включая 0)",
          titles(F("progress", "lt", 50)) == ["Задача 2", "Задача 4 (без статуса)"])
    check("пустой equals пропускается (не ломает отчёт)",
          titles(F("priority_name", "equals", "")) == ["Задача 1", "Задача 2", "Задача 3", "Задача 4 (без статуса)"])

    # --- сортировка ---
    items = build_items(db)
    by_progress = sort_items(items, "progress", "desc")
    check("sort progress desc числом (45 перед 5)",
          by_progress[0]["progress"] == 100 and
          [i["progress"] for i in by_progress] == sorted((i["progress"] for i in by_progress), reverse=True),
          str([i["progress"] for i in by_progress]))

    by_priority = sort_items(items, "priority_name", "asc")
    names = [i["priority_name"] for i in by_priority]
    check("sort priority_name asc по важности (Низкий->Средний->Высокий)",
          names == ["НИЗКИЙ", "СРЕДНИЙ", "СРЕДНИЙ", "ВЫСОКИЙ"],
          str(names))

    db.close()
    ENGINE.dispose()
    if os.path.exists(DB_FILE):
        try:
            os.remove(DB_FILE)
        except OSError:
            pass
    print("RESULT:", "ALL PASSED" if all(results) else f"{results.count(False)} FAILED")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
