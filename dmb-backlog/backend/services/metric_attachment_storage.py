"""Attachment validation and safe storage for quarterly metrics."""
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException
from config import settings


def store_attachment(file):
    from routers.task_collaboration_router import BLOCKED_ATTACHMENT_EXTENSIONS, MAX_FILE_SIZE, _validate_attachment_signature
    from attachment_scanner import scan_file, MalwareDetectedError
    filename=Path((file.filename or 'file').replace('\\','/')).name[:255]
    extension=Path(filename).suffix.lower()
    if len(extension)>16 or extension in BLOCKED_ATTACHMENT_EXTENSIONS:raise HTTPException(422,'Этот тип файла запрещён')
    folder=settings.ATTACHMENT_STORAGE_DIR.resolve()/'metrics';folder.mkdir(parents=True,exist_ok=True)
    key=uuid4().hex+extension;path=folder/key;size=0;header=b''
    try:
        with path.open('xb') as output:
            while chunk:=file.file.read(1024*1024):
                size+=len(chunk)
                if size>MAX_FILE_SIZE:raise HTTPException(413,'Максимальный размер файла — 50 МБ')
                header=(header+chunk)[:16];output.write(chunk)
        _validate_attachment_signature(extension,header)
        try:scan_file(str(path),settings.CLAMAV_HOST or '',settings.CLAMAV_PORT,settings.CLAMAV_TIMEOUT_SECONDS)
        except MalwareDetectedError:raise HTTPException(422,'Файл отклонён антивирусом')
        except OSError:raise HTTPException(503,'Проверка файла временно недоступна')
        return path,dict(filename=filename,storage_key=key,size=size)
    except Exception:path.unlink(missing_ok=True);raise
