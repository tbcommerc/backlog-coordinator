"""Notify request participants when execution changes the customer-facing result."""
from models import RequestWorkLink, RequirementRequest, WorkResolution
from notifications import _create_notification


def work_changed(db, work, actor, before):
    if before.get('status') == work.status and before.get('result_revision') == work.result_revision:
        return
    links=db.query(RequestWorkLink).filter_by(work_task_id=work.id,is_active=True).all()
    for link in links:
        req=db.query(RequirementRequest).filter_by(id=link.request_id,is_deleted=False).first()
        if not req or req.status in {'withdrawn','rejected'}:continue
        decision=db.query(WorkResolution).filter_by(request_id=req.id).first()
        if not decision:continue
        changed_confirmed=decision.fulfillment=='fulfilled' and (
            work.status!='done' or (decision.confirmed_work_revisions or {}).get(str(work.id))!=work.result_revision)
        if changed_confirmed or work.status=='cancelled':
            event='needs_verification'
        elif work.status=='done':event='work_completed'
        else:continue
        # No request/resolution writes while holding a work lock: confirmation locks
        # in the opposite order. Read projections detect invalidation on every read.
        label='Результат запроса требует сверки' if event=='needs_verification' else 'Принята работа по запросу'
        for recipient in {req.user_id, req.coordinator_id or req.reviewer_id} - {None, actor.id}:
            url=f'#/customer/request/{req.id}' if recipient==req.user_id else f'#/review/{req.id}'
            _create_notification(db,recipient,None,'request',label,body='Откройте запрос и проверьте результат связанных работ.',
                action_url=url,group_key=f'request-work:{req.id}:{work.id}:{work.version}:{recipient}',event_type=f'request.{event}')
