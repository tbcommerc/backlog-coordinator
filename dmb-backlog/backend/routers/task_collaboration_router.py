"""Маршруты совместной работы с карточкой задачи: блокировки и зрители."""
from datetime import datetime, timedelta, timezone
import json
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import authorize_task, get_current_user, require_backlog_page_access
from database import get_db
from models import Task, TaskAttachment, TaskComment, TaskHistory, TaskViewer, User
from notifications import notify_comment, notify_mention
from schemas import (
    AttachmentListResponse, AttachmentResponse, CommentCreate, CommentListResponse,
    CommentResponse, SuccessResponse, TaskLockResponse, TaskViewerResponse,
    TaskViewersListResponse,
)


router = APIRouter(dependencies=[Depends(require_backlog_page_access)])
LOCK_DURATION_MINUTES = 15
VIEWER_STALE_MINUTES = 10
VIEWER_ACTIVE_MINUTES = 5
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
MAX_FILE_SIZE = 50 * 1024 * 1024


def _task_or_404(db: Session, task_id: int) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def is_task_lock_active(task: Task) -> bool:
    if not task.lock_owner_id or not task.lock_until:
        return False
    return task.lock_until.replace(tzinfo=None) > datetime.now(timezone.utc).replace(tzinfo=None)


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
    new_until = datetime.now(timezone.utc) + timedelta(minutes=LOCK_DURATION_MINUTES)
    if is_task_lock_active(task) and task.lock_owner_id != current_user.id:
        owner = db.query(User).filter(User.id == task.lock_owner_id).first()
        raise HTTPException(
            status_code=423,
            detail=f"Задача в данный момент редактируется пользователем {owner.name if owner else 'Неизвестный'}. Доступен режим 'только чтение'",
        )
    task.lock_owner_id = current_user.id
    task.lock_until = new_until
    db.commit()
    db.refresh(task)
    return TaskLockResponse(
        locked=True, lock_owner_id=current_user.id, lock_owner_name=current_user.name,
        lock_until=task.lock_until, is_mine=True, version=task.version or 0,
    )


@router.delete("/{task_id}/lock", response_model=TaskLockResponse)
def release_task_lock(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
    if task.lock_owner_id == current_user.id or not is_task_lock_active(task):
        task.lock_owner_id = None
        task.lock_until = None
        db.commit()
    return TaskLockResponse(locked=False, is_mine=False)


def _cleanup_stale_viewers(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=VIEWER_STALE_MINUTES)
    db.query(TaskViewer).filter(TaskViewer.last_seen_at < cutoff).delete(synchronize_session=False)
    db.flush()


@router.post("/{task_id}/viewers", response_model=TaskViewerResponse)
def register_viewer(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    now = datetime.now(timezone.utc)
    viewer = db.query(TaskViewer).filter(
        TaskViewer.task_id == task_id, TaskViewer.user_id == current_user.id,
    ).first()
    if viewer:
        viewer.last_seen_at = now
    else:
        viewer = TaskViewer(task_id=task_id, user_id=current_user.id, last_seen_at=now)
        db.add(viewer)
    db.commit()
    db.refresh(viewer)
    return TaskViewerResponse(user_id=current_user.id, user_name=current_user.name, last_seen_at=viewer.last_seen_at)


@router.get("/{task_id}/viewers", response_model=TaskViewersListResponse)
def list_viewers(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("read", task, current_user)
    _cleanup_stale_viewers(db)
    db.commit()
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
    if data.parent_id and not db.query(TaskComment).filter(
        TaskComment.id == data.parent_id, TaskComment.task_id == task_id,
    ).first():
        raise HTTPException(status_code=404, detail="Parent comment not found")
    mentioned_ids = list(dict.fromkeys(data.mentioned_user_ids or []))
    if mentioned_ids:
        active = {uid for (uid,) in db.query(User.id).filter(User.id.in_(mentioned_ids), User.is_active == True).all()}
        invalid = sorted(set(mentioned_ids) - active)
        if invalid:
            raise HTTPException(
                status_code=422,
                detail={"message": "Упомянуты несуществующие или неактивные пользователи", "user_ids": invalid},
            )
    comment = TaskComment(
        task_id=task_id, user_id=current_user.id, parent_id=data.parent_id,
        text=data.text, mentioned_user_ids=json.dumps(mentioned_ids) if mentioned_ids else None,
    )
    db.add(comment)
    db.add(TaskHistory(
        task_id=task_id, changed_by=current_user.id, field_name="comment",
        old_value=None, new_value=data.text[:200],
    ))
    if mentioned_ids:
        notify_mention(db, task, mentioned_ids, current_user.name, current_user.id)
    notify_comment(db, task, current_user.id, excluded_recipient_ids=set(mentioned_ids))
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
def upload_task_attachment(task_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
    content = file.file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50 MB)")
    stored_name = f"{uuid.uuid4().hex}{os.path.splitext(file.filename or '')[1]}"
    task_dir = os.path.join(UPLOAD_DIR, str(task_id))
    os.makedirs(task_dir, exist_ok=True)
    file_path = os.path.join(task_dir, stored_name)
    try:
        with open(file_path, "wb") as output:
            output.write(content)
        attachment = TaskAttachment(
            task_id=task_id, user_id=current_user.id, filename=stored_name,
            original_name=file.filename or "unknown", mime_type=file.content_type,
            file_size=len(content),
        )
        db.add(attachment)
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
def delete_task_attachment(task_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = _task_or_404(db, task_id)
    authorize_task("edit", task, current_user)
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
    db.commit()
    if os.path.isfile(file_path):
        os.remove(file_path)
    return SuccessResponse(message="Attachment deleted")
