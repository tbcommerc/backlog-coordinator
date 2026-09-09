"""Маршруты совместной работы с карточкой задачи: блокировки и зрители."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import authorize_task, get_current_user, require_backlog_page_access
from config import settings
from database import get_db
from idempotency import reserve_idempotency
from models import Task, TaskAttachment, TaskComment, TaskHistory, TaskViewer, User
from notifications import invalid_mention_user_ids, notify_comment, notify_mention
from schemas import (
    AttachmentListResponse, AttachmentResponse, CommentCreate, CommentListResponse,
    CommentResponse, SuccessResponse, TaskLockResponse, TaskViewerResponse,
    TaskViewersListResponse,
)
from attachment_scanner import MalwareDetectedError, scan_file


router = APIRouter(dependencies=[Depends(require_backlog_page_access)])
logger = logging.getLogger("dmb_backlog.task_collaboration")
LOCK_DURATION_MINUTES = 15
VIEWER_STALE_MINUTES = 10
VIEWER_ACTIVE_MINUTES = 5
UPLOAD_DIR = str(settings.ATTACHMENT_STORAGE_DIR.resolve())
MAX_FILE_SIZE = 50 * 1024 * 1024
UPLOAD_CHUNK_SIZE = 1024 * 1024
BLOCKED_ATTACHMENT_EXTENSIONS = {
    ".bat", ".cmd", ".com", ".dll", ".exe", ".hta", ".html", ".js", ".msi",
    ".ps1", ".scr", ".svg", ".vbs",
}


def _validate_attachment_signature(extension: str, header: bytes) -> None:
    signatures = {
        ".pdf": (b"%PDF-",),
        ".png": (b"\x89PNG\r\n\x1a\n",),
        ".jpg": (b"\xff\xd8\xff",),
        ".jpeg": (b"\xff\xd8\xff",),
        ".zip": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
        ".docx": (b"PK\x03\x04",),
        ".xlsx": (b"PK\x03\x04",),
        ".pptx": (b"PK\x03\x04",),
    }
    expected = signatures.get(extension)
    if expected and not any(header.startswith(signature) for signature in expected):
        raise HTTPException(status_code=400, detail="Содержимое файла не соответствует его расширению")


def _task_or_404(db: Session, task_id: int) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def is_task_lock_active(task: Task) -> bool:
    if not task.lock_owner_id or not task.lock_until:
        return False
    return task.lock_until.replace(tzinfo=None) > datetime.now(timezone.utc).replace(tzinfo=None)


def _try_acquire_task_lock(
    db: Session,
    task_id: int,
    user_id: int,
    now: datetime,
    new_until: datetime,
) -> bool:
    """Atomically acquire or renew a task edit lease."""
    result = db.execute(
        update(Task)
        .where(
            Task.id == task_id,
            Task.is_deleted == False,
            or_(
                Task.lock_owner_id.is_(None),
                Task.lock_until.is_(None),
                Task.lock_until <= now,
                Task.lock_owner_id == user_id,
            ),
        )
        .values(
            lock_owner_id=user_id,
            lock_until=new_until,
            # A lease heartbeat is not a content edit.
            updated_at=Task.updated_at,
        )
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


def _release_task_lock(db: Session, task_id: int, user_id: int, now: datetime) -> bool:
    """Release only the caller's lease, or clean an already expired lease."""
    result = db.execute(
        update(Task)
        .where(
            Task.id == task_id,
            Task.is_deleted == False,
            or_(
                Task.lock_owner_id == user_id,
                Task.lock_owner_id.is_(None),
                Task.lock_until.is_(None),
                Task.lock_until <= now,
            ),
        )
        .values(lock_owner_id=None, lock_until=None, updated_at=Task.updated_at)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


@router.get("/{task_id}/lock", response_model=TaskLockResponse)
def get_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    if is_task_lock_active(task):
        owner = db.query(User).filter(User.id == task.lock_owner_id).first()
        return TaskLockResponse(
            locked=True, lock_owner_id=task.lock_owner_id,
            lock_owner_name=owner.name if owner else None, lock_until=task.lock_until,
            is_mine=task.lock_owner_id == current_user.id, version=task.version or 0,
        )
    return TaskLockResponse(locked=False, is_mine=False, version=task.version or 0)


@router.post("/{task_id}/lock", response_model=TaskLockResponse)
def acquire_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
    now = datetime.now(timezone.utc)
    new_until = now + timedelta(minutes=LOCK_DURATION_MINUTES)
    if not _try_acquire_task_lock(db, task_id, current_user.id, now, new_until):
        db.rollback()
        task = _task_or_404(db, task_id)
        owner = db.query(User).filter(User.id == task.lock_owner_id).first()
        raise HTTPException(
            status_code=423,
            detail=f"Задача в данный момент редактируется пользователем {owner.name if owner else 'Неизвестный'}. Доступен режим 'только чтение'",
        )
    db.commit()
    task = _task_or_404(db, task_id)
    db.refresh(task)
    return TaskLockResponse(
        locked=True, lock_owner_id=current_user.id, lock_owner_name=current_user.name,
        lock_until=task.lock_until, is_mine=True, version=task.version or 0,
    )


@router.delete("/{task_id}/lock", response_model=TaskLockResponse)
def release_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
    released = _release_task_lock(db, task_id, current_user.id, datetime.now(timezone.utc))
    if released:
        db.commit()
        return TaskLockResponse(locked=False, is_mine=False, version=task.version or 0)

    db.rollback()
    task = _task_or_404(db, task_id)
    owner = db.query(User).filter(User.id == task.lock_owner_id).first()
    return TaskLockResponse(
        locked=is_task_lock_active(task),
        lock_owner_id=task.lock_owner_id,
        lock_owner_name=owner.name if owner else None,
        lock_until=task.lock_until,
        is_mine=task.lock_owner_id == current_user.id,
        version=task.version or 0,
    )


def _cleanup_stale_viewers(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=VIEWER_STALE_MINUTES)
    db.query(TaskViewer).filter(TaskViewer.last_seen_at < cutoff).delete(synchronize_session=False)
    db.flush()


@router.post("/{task_id}/viewers", response_model=TaskViewerResponse)
def register_viewer(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    now = datetime.now(timezone.utc)
    updated = db.execute(
        update(TaskViewer)
        .where(TaskViewer.task_id == task_id, TaskViewer.user_id == current_user.id)
        .values(last_seen_at=now)
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount == 0:
        db.add(TaskViewer(task_id=task_id, user_id=current_user.id, last_seen_at=now))
        try:
            db.flush()
        except IntegrityError:
            # A parallel heartbeat inserted the unique row first.
            db.rollback()
            db.execute(
                update(TaskViewer)
                .where(TaskViewer.task_id == task_id, TaskViewer.user_id == current_user.id)
                .values(last_seen_at=now)
                .execution_options(synchronize_session=False)
            )
    db.commit()
    viewer = db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id, TaskViewer.user_id == current_user.id,
    ).one()
    db.refresh(viewer)
    return TaskViewerResponse(user_id=current_user.id, user_name=current_user.name, last_seen_at=viewer.last_seen_at)


@router.get("/{task_id}/viewers", response_model=TaskViewersListResponse)
def list_viewers(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=VIEWER_ACTIVE_MINUTES)
    viewers = db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id,
        TaskViewer.user_id != current_user.id,
        TaskViewer.last_seen_at >= cutoff,
    ).all()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_([v.user_id for v in viewers])).all()}
    return TaskViewersListResponse(viewers=[
        TaskViewerResponse(user_id=v.user_id, user_name=names.get(v.user_id), last_seen_at=v.last_seen_at)
        for v in viewers
    ])


@router.delete("/{task_id}/viewers")
def unregister_viewer(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id, TaskViewer.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"message": "ok"}


def _comment_response(comment: TaskComment, user_name: str | None, replies=None) -> CommentResponse:
    try:
        mentions = json.loads(comment.mentioned_user_ids) if comment.mentioned_user_ids else None
    except (json.JSONDecodeError, TypeError):
        mentions = None
    return CommentResponse(
        id=comment.id, task_id=comment.task_id, user_id=comment.user_id,
        user_name=user_name, text=comment.text, mentioned_user_ids=mentions,
        parent_id=comment.parent_id, replies=replies, created_at=comment.created_at,
    )


@router.get("/{task_id}/comments", response_model=CommentListResponse)
def get_task_comments(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    comments = db.query(TaskComment).filter(TaskComment.task_id == task_id).order_by(TaskComment.created_at).all()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_([c.user_id for c in comments])).all()}
    mapped = {c.id: _comment_response(c, names.get(c.user_id), []) for c in comments}
    roots = []
    for comment in comments:
        response = mapped[comment.id]
        if comment.parent_id in mapped:
            mapped[comment.parent_id].replies.append(response)
        else:
            roots.append(response)
    return CommentListResponse(items=roots, total=len(comments))


@router.post("/{task_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
def create_task_comment(task_id: int, data: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("comment", task, current_user)
    idempotency, is_new_request = reserve_idempotency(
        db,
        operation=f"task.comment.create:{task_id}",
        user_id=current_user.id,
        request_key=data.client_request_id,
        request_data=data.model_dump(mode="json", exclude={"client_request_id"}),
    )
    if idempotency and not is_new_request:
        existing = db.query(TaskComment).filter(
            TaskComment.id == idempotency.resource_id,
            TaskComment.task_id == task_id,
        ).first()
        if existing:
            author = db.query(User.name).filter(User.id == existing.user_id).scalar()
            return _comment_response(existing, author)
        raise HTTPException(status_code=409, detail="Результат повторного запроса больше недоступен")
    if data.parent_id and not db.query(TaskComment).filter(
        TaskComment.id == data.parent_id, TaskComment.task_id == task_id,
    ).first():
        raise HTTPException(status_code=404, detail="Parent comment not found")
    mentioned_ids = list(dict.fromkeys(data.mentioned_user_ids or []))
    if mentioned_ids:
        invalid = invalid_mention_user_ids(db, task, mentioned_ids)
        if invalid:
            raise HTTPException(
                status_code=422,
                detail={"message": "Упомянуты неактивные пользователи или пользователи без доступа к задаче", "user_ids": invalid},
            )
    comment = TaskComment(
        task_id=task_id, user_id=current_user.id, parent_id=data.parent_id,
        text=data.text, mentioned_user_ids=json.dumps(mentioned_ids) if mentioned_ids else None,
    )
    db.add(comment)
    db.flush()
    if idempotency:
        idempotency.resource_type = "task_comment"
        idempotency.resource_id = comment.id
    db.add(TaskHistory(
        task_id=task_id, changed_by=current_user.id, field_name="comment",
        old_value=None, new_value=data.text[:200],
    ))
    if mentioned_ids:
        notify_mention(
            db, task, mentioned_ids, current_user.name, current_user.id,
            comment_id=comment.id,
        )
    notify_comment(
        db, task, current_user.id,
        excluded_recipient_ids=set(mentioned_ids),
        commenter_name=current_user.name,
        comment_id=comment.id,
    )
    db.commit()
    db.refresh(comment)
    return _comment_response(comment, current_user.name)


def _attachment_response(attachment: TaskAttachment, user_name: str | None) -> AttachmentResponse:
    return AttachmentResponse(
        id=attachment.id, task_id=attachment.task_id, user_id=attachment.user_id,
        user_name=user_name, filename=attachment.filename,
        original_name=attachment.original_name, mime_type=attachment.mime_type,
        file_size=attachment.file_size,
        download_url=f"/api/v1/tasks/{attachment.task_id}/attachments/{attachment.id}/download",
        created_at=attachment.created_at,
    )


@router.get("/{task_id}/attachments", response_model=AttachmentListResponse)
def get_task_attachments(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    rows = db.query(TaskAttachment).filter(TaskAttachment.task_id == task_id).order_by(TaskAttachment.created_at.desc()).all()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_([a.user_id for a in rows])).all()}
    return AttachmentListResponse(items=[_attachment_response(a, names.get(a.user_id)) for a in rows], total=len(rows))


@router.post("/{task_id}/attachments", response_model=AttachmentResponse, status_code=status.HTTP_201_CREATED)
def upload_task_attachment(
    task_id: int,
    file: UploadFile = File(...),
    client_request_id: str | None = Form(None, min_length=8, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension in BLOCKED_ATTACHMENT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Файлы этого типа запрещены")
    stored_name = f"{uuid.uuid4().hex}{extension}"
    task_dir = os.path.join(UPLOAD_DIR, str(task_id))
    os.makedirs(task_dir, exist_ok=True)
    file_path = os.path.join(task_dir, stored_name)
    file_size = 0
    digest = hashlib.sha256()
    header = b""
    try:
        with open(file_path, "xb") as output:
            while chunk := file.file.read(UPLOAD_CHUNK_SIZE):
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
                if len(header) < 16:
                    header = (header + chunk)[:16]
                digest.update(chunk)
                output.write(chunk)
        _validate_attachment_signature(extension, header)
        try:
            scan_file(file_path, settings.CLAMAV_HOST or "", settings.CLAMAV_PORT, settings.CLAMAV_TIMEOUT_SECONDS)
        except MalwareDetectedError:
            raise HTTPException(status_code=400, detail="Файл отклонён антивирусной проверкой")
        except OSError:
            logger.exception("Attachment malware scan unavailable")
            raise HTTPException(status_code=503, detail="Антивирусная проверка временно недоступна")
        idempotency, is_new_request = reserve_idempotency(
            db,
            operation=f"task.attachment.create:{task_id}",
            user_id=current_user.id,
            request_key=client_request_id,
            request_data={
                "task_id": task_id,
                "filename": file.filename or "unknown",
                "mime_type": file.content_type,
                "file_size": file_size,
                "sha256": digest.hexdigest(),
            },
        )
    except Exception:
        if os.path.isfile(file_path):
            os.remove(file_path)
        raise
    if idempotency and not is_new_request:
        existing = db.query(TaskAttachment).filter(
            TaskAttachment.id == idempotency.resource_id,
            TaskAttachment.task_id == task_id,
        ).first()
        if existing:
            os.remove(file_path)
            author = db.query(User.name).filter(User.id == existing.user_id).scalar()
            return _attachment_response(existing, author)
        os.remove(file_path)
        raise HTTPException(status_code=409, detail="Результат повторного запроса больше недоступен")
    try:
        attachment = TaskAttachment(
            task_id=task_id, user_id=current_user.id, filename=stored_name,
            original_name=file.filename or "unknown", mime_type=file.content_type,
            file_size=file_size,
        )
        db.add(attachment)
        db.flush()
        if idempotency:
            idempotency.resource_type = "task_attachment"
            idempotency.resource_id = attachment.id
        db.add(TaskHistory(
            task_id=task_id, changed_by=current_user.id, field_name="attachment",
            old_value=None, new_value=f"Загружен файл: {file.filename}",
        ))
        db.commit()
        db.refresh(attachment)
    except Exception:
        db.rollback()
        if os.path.isfile(file_path):
            os.remove(file_path)
        raise
    return _attachment_response(attachment, current_user.name)


@router.get("/{task_id}/attachments/{attachment_id}/download")
def download_task_attachment(task_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    attachment = db.query(TaskAttachment).filter(
        TaskAttachment.id == attachment_id, TaskAttachment.task_id == task_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    task_dir = os.path.abspath(os.path.join(UPLOAD_DIR, str(task_id)))
    file_path = os.path.abspath(os.path.join(task_dir, attachment.filename))
    if os.path.commonpath([file_path, task_dir]) != task_dir or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Attachment file not found")
    return FileResponse(file_path, media_type=attachment.mime_type or "application/octet-stream", filename=attachment.original_name or attachment.filename)


@router.delete("/{task_id}/attachments/{attachment_id}", response_model=SuccessResponse)
def delete_task_attachment(
    task_id: int,
    attachment_id: int,
    client_request_id: str | None = Query(None, min_length=8, max_length=64),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
    idempotency, is_new_request = reserve_idempotency(
        db,
        operation=f"task.attachment.delete:{task_id}:{attachment_id}",
        user_id=current_user.id,
        request_key=client_request_id,
        request_data={"task_id": task_id, "attachment_id": attachment_id},
    )
    if idempotency and not is_new_request:
        return SuccessResponse(message="Attachment deleted")
    attachment = db.query(TaskAttachment).filter(
        TaskAttachment.id == attachment_id, TaskAttachment.task_id == task_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    file_path = os.path.join(UPLOAD_DIR, str(task_id), attachment.filename)
    db.add(TaskHistory(
        task_id=task_id, changed_by=current_user.id, field_name="attachment",
        old_value=f"Удалён файл: {attachment.original_name}", new_value=None,
    ))
    db.delete(attachment)
    if idempotency:
        idempotency.resource_type = "task_attachment_delete"
        idempotency.resource_id = attachment_id
    db.commit()
    if os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except OSError:
            logger.exception("Attachment metadata deleted but file cleanup failed: %s", file_path)
    return SuccessResponse(message="Attachment deleted")
