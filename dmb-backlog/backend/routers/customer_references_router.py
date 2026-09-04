"""Explicit administrator maintenance; never seeds or derives contacts from text."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from auth import require_permission
from database import get_db
from models import DidClientGroup

router = APIRouter(dependencies=[Depends(require_permission("admin", "full"))])
Kind = Literal["did-client-groups"]


def model_for(kind):
    return DidClientGroup


def item_dict(item):
    return {"id": item.id, "name": item.name, "is_active": item.is_active,
            "code": item.code, "sort_order": item.sort_order}


class ReferenceCommand(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = Field(default="", max_length=50)
    sort_order: int = Field(default=0, ge=0, le=100000)
    is_active: bool = True
    expected: dict | None = None


@router.get("/{kind}")
def list_items(kind: Kind, db: Session = Depends(get_db)):
    model = model_for(kind)
    return [item_dict(item) for item in db.query(model).order_by(model.id)]


def assign(item, command, db):
    name = command.name.strip()
    if not name:
        raise HTTPException(422, "Укажите название")
    if not command.code.strip() or len(name) > 100:
        raise HTTPException(422, "Укажите код и название длиной до 100 символов")
    item.name, item.code, item.sort_order = name, command.code.strip(), command.sort_order
    item.is_active = command.is_active


def commit(db, item):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Запись с таким кодом уже существует")
    db.refresh(item)
    return item_dict(item)


@router.post("/{kind}", status_code=201)
def create_item(kind: Kind, command: ReferenceCommand, db: Session = Depends(get_db)):
    item = model_for(kind)()
    assign(item, command, db)
    db.add(item)
    return commit(db, item)


@router.put("/{kind}/{item_id}")
def update_item(kind: Kind, item_id: int, command: ReferenceCommand, db: Session = Depends(get_db)):
    item = db.query(model_for(kind)).filter_by(id=item_id).with_for_update().first()
    if item is None:
        raise HTTPException(404, "Запись не найдена")
    if command.expected != item_dict(item):
        raise HTTPException(409, "Запись изменена другим администратором. Обновите справочник.")
    assign(item, command, db)
    return commit(db, item)
