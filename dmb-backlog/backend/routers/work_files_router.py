"""Work attachments use the existing signature/scanner/storage policy."""
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from auth import get_current_user, require_non_business_customer_access
from database import get_db
from config import settings
from models import User, WorkAttachment
from services import work_tasks as work
from attachment_scanner import scan_file, MalwareDetectedError
from routers.task_collaboration_router import BLOCKED_ATTACHMENT_EXTENSIONS, MAX_FILE_SIZE, _validate_attachment_signature

router = APIRouter(dependencies=[Depends(require_non_business_customer_access)])


def info(row):
    return {'id': row.id, 'filename': row.filename, 'size': row.size, 'created_at': row.created_at}


@router.get('/work-tasks/{work_id}/attachments')
def files(work_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    work.get_work(db, work_id, user)
    return [info(x) for x in db.query(WorkAttachment).filter_by(work_task_id=work_id).order_by(WorkAttachment.id)]


@router.post('/work-tasks/{work_id}/attachments')
def upload(work_id: int, version: int = Form(..., ge=1), file: UploadFile = File(...),
           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = work.get_work(db, work_id, user)
    work.require(work.participant(row, user))
    filename = Path((file.filename or 'file').replace('\\', '/')).name[:255]
    extension = Path(filename).suffix.lower()
    if len(extension) > 16 or extension in BLOCKED_ATTACHMENT_EXTENSIONS: raise HTTPException(422, 'Файлы этого типа запрещены')
    folder = settings.ATTACHMENT_STORAGE_DIR.resolve() / 'work'
    folder.mkdir(parents=True, exist_ok=True)
    storage_key = uuid4().hex + extension
    path = folder / storage_key
    size = 0
    header = b''
    try:
        with path.open('xb') as output:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_SIZE: raise HTTPException(413, 'Максимальный размер файла — 50 МБ')
                header = (header + chunk)[:16]
                output.write(chunk)
        _validate_attachment_signature(extension, header)
        try:
            scan_file(str(path), settings.CLAMAV_HOST or '', settings.CLAMAV_PORT, settings.CLAMAV_TIMEOUT_SECONDS)
        except MalwareDetectedError:
            raise HTTPException(422, 'Файл отклонён антивирусом')
        except OSError:
            raise HTTPException(503, 'Проверка файла временно недоступна')
        work.change(db, row, user, version, {}, 'attachment')
        attachment = WorkAttachment(work_task_id=work_id, author_id=user.id, filename=filename,
                                    storage_key=storage_key, size=size)
        db.add(attachment)
        db.commit()
        return {**info(attachment), 'version': row.version}
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise


@router.get('/work-tasks/{work_id}/attachments/{attachment_id}/download')
def download(work_id: int, attachment_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    work.get_work(db, work_id, user)
    attachment = db.query(WorkAttachment).filter_by(id=attachment_id, work_task_id=work_id).first()
    if not attachment: raise HTTPException(404, 'Файл недоступен')
    path = settings.ATTACHMENT_STORAGE_DIR.resolve() / 'work' / attachment.storage_key
    if not path.is_file(): raise HTTPException(404, 'Файл недоступен')
    return FileResponse(path, filename=attachment.filename, media_type='application/octet-stream',
                        headers={'X-Content-Type-Options': 'nosniff'})
