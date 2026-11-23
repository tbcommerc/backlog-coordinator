"""Dictionary metadata and stable foreign-key references, saved in one transaction.

DictionaryItem.id belongs to the editor. reference_id belongs to the typed
lookup table and is the only ID accepted by tasks/teams/projects. Never renumber
either table: existing foreign keys must survive renames and archival.
"""
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_, func, text

from models import (DictionaryItem, Priority, TaskStatus, TaskType, Channel,
                    Deadline, TeamType, ProjectStatus)


REFERENCE_MODELS = {
    "priority": Priority, "status": TaskStatus, "task_type": TaskType,
    "channel": Channel, "deadline": Deadline, "team_type": TeamType,
    "project_status": ProjectStatus,
}


def _key(value):
    return (value or "").strip().casefold()


def lock_catalog(db):
    if db.get_bind().dialect.name == "postgresql":
        # Same lock for batch, individual CRUD and operator reconciliation.
        db.execute(text("LOCK TABLE dictionary_items IN SHARE ROW EXCLUSIVE MODE"))


def synchronize_references(db, dict_type):
    """Bind existing values, then update typed rows. Caller owns commit/rollback.

    Call before editing an unbound snapshot to resolve its ORIGINAL labels, and
    again after editing to propagate changes through the stable binding.
    """
    model = REFERENCE_MODELS.get(dict_type)
    if model is None:
        return
    db.flush()
    items = db.query(DictionaryItem).filter_by(dict_type=dict_type).order_by(DictionaryItem.id).all()
    rows = db.query(model).order_by(model.id).all()
    claimed = {}
    for item in items:
        if item.reference_id is not None:
            matches = [row for row in rows if row.id == item.reference_id]
            if not matches:
                raise HTTPException(409, "DICTIONARY_REFERENCE_MISSING")
        else:
            matches = [row for row in rows if _key(row.name) == _key(item.name)
                       or (item.code and hasattr(model, "code") and _key(row.code) == _key(item.code))]
        if len(matches) > 1:
            raise HTTPException(409, "DICTIONARY_REFERENCE_AMBIGUOUS")
        row = matches[0] if matches else None
        if row and row.id in claimed:
            raise HTTPException(409, "DICTIONARY_REFERENCE_AMBIGUOUS")
        name = (item.name or "").strip()
        if not name or len(name) > model.__table__.c.name.type.length:
            raise HTTPException(422, "DICTIONARY_REFERENCE_NAME_INVALID")
        if row is None:
            row = model(name=name)
            if hasattr(model, "code"):
                row.code = item.code or "custom_" + uuid4().hex
            db.add(row)
            db.flush()
            rows.append(row)
        row.name = name
        if hasattr(model, "code"):
            # A generated code is stable when the editor leaves code blank.
            code = item.code or row.code
            if any(other.id != row.id and _key(other.code) == _key(code) for other in rows):
                raise HTTPException(409, "DICTIONARY_REFERENCE_CODE_CONFLICT")
            row.code = code
        if hasattr(model, "sort_order"):
            row.sort_order = item.sort_order or 0
        if hasattr(model, "color"):
            row.color = item.color
        item.reference_id = row.id
        claimed[row.id] = item.id
    db.flush()


def reference_options(db, dict_type):
    """Read-only options with typed IDs; archived values retain their FK rows."""
    model = REFERENCE_MODELS[dict_type]
    rows = db.query(model, DictionaryItem).outerjoin(DictionaryItem,
        (DictionaryItem.dict_type == dict_type) & (DictionaryItem.reference_id == model.id)
    ).filter(or_(DictionaryItem.id.is_(None), DictionaryItem.is_active.is_(True))).order_by(
        func.coalesce(DictionaryItem.sort_order, getattr(model, "sort_order", 1000000000)), model.name, model.id
    ).all()
    return [{"id": row.id, "name": row.name,
             "code": getattr(row, "code", None),
             "sort_order": item.sort_order if item else getattr(row, "sort_order", 0),
             "color": item.color if item else getattr(row, "color", None)} for row, item in rows]


def reconcile_references(db):
    """Explicit operator operation, never invoked on startup or by a GET."""
    lock_catalog(db)
    added = 0
    for dict_type, model in REFERENCE_MODELS.items():
        items = db.query(DictionaryItem).filter_by(dict_type=dict_type).all()
        for row in db.query(model).order_by(model.id).all():
            if not any(item.reference_id == row.id or _key(item.name) == _key(row.name)
                       or (getattr(row, "code", None) and _key(item.code) == _key(row.code)) for item in items):
                item = DictionaryItem(dict_type=dict_type, name=row.name,
                    code=getattr(row, "code", None), color=getattr(row, "color", None),
                    sort_order=getattr(row, "sort_order", 0), is_active=True, reference_id=row.id)
                db.add(item)
                items.append(item)
                added += 1
        synchronize_references(db, dict_type)
    return added
