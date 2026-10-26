"""Human decisions for immutable requirement revisions, independent of intake.

Mounted at /api. Creation is deliberately available only through the V2 gateway,
which obtains the actual draft from the authenticated agent session.
"""
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import User
from services import requirement_reviews as service


router = APIRouter(prefix="/requirement-reviews", tags=["Requirement reviews"])


class ReviewAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["claim", "approve", "return", "withdraw"]
    version: int = Field(ge=1, strict=True)
    comment: str = Field(default="", max_length=10000)
    idempotency_key: str = Field(default="", max_length=128)


@router.get("")
def list_reviews(
    limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
    status: str | None = Query(None), artifact_id: str | None = Query(None, max_length=128),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    return service.list_reviews(db, current_user, limit, offset, status, artifact_id)


@router.get("/{review_id}")
def review_detail(review_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return service.serialize_review(service.get_review(db, current_user, review_id), current_user, db)


@router.post("/{review_id}/actions")
def review_action(
    review_id: int, body: ReviewAction, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    if idempotency_key and body.idempotency_key and idempotency_key != body.idempotency_key:
        raise HTTPException(422, detail={"code": "idempotency_key_mismatch", "message": "Ключи операции не совпадают"})
    try:
        row = service.perform_action(db, current_user, review_id, body.action, body.version,
            body.comment, idempotency_key or body.idempotency_key)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return service.serialize_review(row, current_user, db)
