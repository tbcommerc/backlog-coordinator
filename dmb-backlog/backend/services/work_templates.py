"""Owner-scoped templates; only content, never assignments or reference data."""
from datetime import datetime, timezone
from fastapi import HTTPException
from models import WorkTaskTemplate
from services.work_tasks import editor, require


def scope(db, user):
    require(editor(user, user.team_id))
    return db.query(WorkTaskTemplate).filter_by(owner_id=user.id, is_deleted=False)


def dto(row):
    return {key: getattr(row, key) for key in ('id', 'name', 'content', 'version', 'updated_at')}


def create(db, user, req):
    if scope(db, user).count() >= 100:
        raise HTTPException(422, 'Можно сохранить до 100 личных шаблонов')
    row = WorkTaskTemplate(owner_id=user.id, name=req.name, content=req.content.model_dump(mode='json'), version=1, is_deleted=False)
    db.add(row)
    db.commit()
    db.refresh(row)
    return dto(row)


def change(db, user, template_id, version, values):
    query = scope(db, user).filter_by(id=template_id)
    if query.first() is None:
        raise HTTPException(404, 'Шаблон недоступен')
    count = query.filter_by(version=version).update({**values, 'version': version + 1,
        'updated_at': datetime.now(timezone.utc)}, synchronize_session=False)
    if count != 1:
        db.rollback()
        raise HTTPException(409, 'Шаблон изменён. Обновите список шаблонов.')
    db.commit()
    db.expire_all()
    return {'deleted': True} if values.get('is_deleted') else dto(query.one())
