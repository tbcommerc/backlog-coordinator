"""Synthetic fixtures for the isolated Compose rehearsal, never a stand operator API."""
import json
import os
import sys


def main():
    from config import settings
    from sqlalchemy.engine import make_url
    url = make_url(settings.DATABASE_URL)
    if (os.environ.get("DMB_ISOLATED_REHEARSAL") != "1" or url.host != "postgres"
            or not (url.database or "").startswith("codex_deploytest_")):
        raise RuntimeError("Isolated rehearsal database required")
    from database import SessionLocal
    from models import User, Role, Priority, DictionaryItem, Task, Team, Department, BusinessCustomer
    from services.stand_setup import bootstrap_admin
    from services.reference_catalog import reconcile_references
    from services.credentials import hash_password
    operation = sys.argv[1]
    with SessionLocal() as db:
        if operation == "bootstrap":
            user, invitation = bootstrap_admin(db, "browser.demo", "Демонстрационный администратор",
                "isolated-production-rehearsal", demo_data=True)
            role = Role(name="Демонстрационный наблюдатель", admin_access="none",
                backlog_dmb_access="read", backlog_team_access="read_own", task_edit_scope="none",
                task_comment_scope="none", task_delete_scope="none", review_access="none",
                customer_portal_only=False, pip_decision_access=False)
            db.add(role)
            db.flush()
            db.add(User(name="Демонстрационный администратор", login="browser.observer", login_normalized="browser.observer",
                password_hash=hash_password("Isolated observer demonstration 2026!"), credential_state="ready",
                is_active=True, role_id=role.id, can_edit=False, can_delete=False, can_export=False))
            departments = [Department(code='rehearsal_retail',name='Демонстрационная розница'),
                Department(code='rehearsal_business',name='Демонстрационный бизнес')]
            db.add_all(departments)
            db.flush()
            db.add_all([BusinessCustomer(name='Демонстрационный заказчик',department_id=item.id) for item in departments])
            db.commit()
            print(json.dumps({"activation_token": invitation["token"], "user_id": user.id}))
        elif operation == "legacy":
            # Deliberately mismatching editor/FK IDs reproduce a populated old DB.
            if db.get(Priority, 42000) or db.get(DictionaryItem, 70000):
                raise RuntimeError("Legacy rehearsal rows already exist")
            db.add(Priority(id=42000, name="Исторический приоритет"))
            db.add(DictionaryItem(id=70000, dict_type="priority", name="Исторический приоритет", code="legacy_rehearsal", is_active=True))
            db.flush()
            task = Task(title="Историческая задача для проверки миграции", team_id=db.query(Team).first().id, priority_id=42000)
            db.add(task)
            db.commit()
            print(json.dumps({"task_id": task.id, "priority_id": 42000, "editor_id": 70000}))
        elif operation == "reconcile":
            added = reconcile_references(db)
            db.commit()
            print(json.dumps({"added": added, "unbound": db.query(DictionaryItem).filter(
                DictionaryItem.dict_type.in_(["priority", "status", "task_type", "channel", "deadline", "team_type", "project_status"]),
                DictionaryItem.reference_id.is_(None)).count()}))
        elif operation == "inventory":
            print(json.dumps({"users": db.query(User).count(), "roles": db.query(Role).count(), "teams": db.query(Team).count(),
                "dictionary_items": db.query(DictionaryItem).count(), "tasks": db.query(Task).count()}))
        else:
            raise RuntimeError("Unknown rehearsal operation")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Never print SQL parameters, invitation codes, hashes or credentials.
        print(type(exc).__name__ + ": isolated fixture operation failed", file=sys.stderr)
        raise SystemExit(1)
