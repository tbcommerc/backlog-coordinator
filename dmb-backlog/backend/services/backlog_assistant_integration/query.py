"""ACL-first domain reads. Called only inside a read-only repeatable-read view."""
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import or_, and_
from .normalization import search_tokens, context_matches
from auth import can_access_task, is_customer_portal_only, check_permission
from models import Task, RequirementRequest, TaskHistory, TaskComment, ReportingMeeting, TaskReportingStatus
from routers.customer_router import _task_to_customer_response
from services.task_metrics import calculate_cost_value_ratio
from .policy import task_clause, request_clause, customer_task_allowed


def denied():
    raise HTTPException(404, "not_found_or_forbidden")


def ref_id(ref, kind):
    prefix, sep, value = ref.partition(":")
    if prefix != kind or not sep or not value.isascii() or not value.isdigit() or int(value) < 1:
        denied()
    return int(value)


def initial_scope(db, user):
    task_ids = [v[0] for v in db.query(Task.id).filter(Task.is_deleted.is_(False), task_clause(user)).all()]
    requests = [v[0] for v in db.query(RequirementRequest.id).filter(RequirementRequest.is_deleted.is_(False), request_clause(user)).all()]
    details = list(task_ids)
    if is_customer_portal_only(user):
        details += [v[0] for v in db.query(RequirementRequest.task_id).filter(
            RequirementRequest.user_id == user.id, RequirementRequest.is_deleted.is_(False), RequirementRequest.task_id.is_not(None)).all()]
    from models import RequirementReview
    from services.requirement_reviews import _visible_clause, _check_read
    reviews = []
    for review in db.query(RequirementReview).filter(_visible_clause(user)).all():
        try:
            _check_read(db, user, review)
            reviews.append(review.id)
        except HTTPException:
            pass
    return {"task": task_ids, "task_detail": sorted(set(details)), "request": requests, "review": reviews,
            "customer": is_customer_portal_only(user)}


def query(db, user, scope, spec):
    kind = spec.get("object_type", "task")
    if scope["customer"] and kind == "task" and (spec.get("project_ids") or spec.get("priority_ids") or spec.get("relationship") == "mine"):
        raise HTTPException(422, "filter_not_supported_for_projection")
    model = Task if kind == "task" else RequirementRequest
    base = db.query(model).filter(model.is_deleted.is_(False), model.id.in_(scope[kind]),
        task_clause(user) if kind == "task" else request_clause(user))
    for field, values in (("team_id", spec.get("team_ids")), ("project_id", spec.get("project_ids")),
                          ("status_id", spec.get("status_ids")), ("priority_id", spec.get("priority_ids"))):
        if values:
            if not hasattr(model, field):
                raise HTTPException(422, "filter_not_supported_for_object")
            base = base.filter(getattr(model, field).in_(values))
    relationship = spec.get("relationship", "all")
    if relationship == "mine":
        base = base.filter((Task.owner_id if kind == "task" else RequirementRequest.user_id) == user.id)
    if relationship == "my_team":
        if user.team_id is None:
            raise HTTPException(422, "team_required")
        base = base.filter(model.team_id == user.team_id)
    for key, column, lower in (("created_from", model.created_at, True), ("created_to", model.created_at, False),
                               ("updated_from", model.updated_at, True), ("updated_to", model.updated_at, False)):
        if spec.get(key):
            value = datetime.fromisoformat(spec[key].replace("Z", "+00:00"))
            if value.tzinfo is None:
                raise HTTPException(422, "timezone_required")
            base = base.filter(column >= value if lower else column < value)
    if spec.get("period"):
        if kind != "task":
            raise HTTPException(422, "filter_not_supported_for_object")
        from models import Deadline
        base = base.filter(Task.deadline.has(Deadline.name == spec["period"]))
    missing_fields = {"owner": "owner_id", "effort": "effort_rub", "effect": "financial_effect", "period": "deadline_id"}
    for name in spec.get("missing", []):
        if kind != "task" or scope["customer"]:
            raise HTTPException(422, "filter_not_supported_for_projection")
        base = base.filter(getattr(Task, missing_fields[name]).is_(None))
    for term in spec.get("terms", []):
        if not term or len(term) > 200:
            raise HTTPException(422, "invalid_search_term")
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        matches = [model.title.ilike("%"+escaped+"%", escape="\\"), model.description.ilike("%"+escaped+"%", escape="\\")]
        if kind == "task":
            matches.append(Task.public_id == term.upper())
        tokens = search_tokens(term)
        if tokens != term.casefold().split():
            expanded = []
            for token in tokens:
                escaped_token = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                expanded.append(or_(model.title.ilike("%"+escaped_token+"%", escape="\\"),
                                    model.description.ilike("%"+escaped_token+"%", escape="\\")))
            matches.append(and_(*expanded))
        base = base.filter(or_(*matches))
    return base.order_by(model.updated_at.desc(), model.id) if spec.get("sort") == "updated_desc" else base.order_by(model.id)


def project_task(task, customer):
    if customer:
        return dict(_task_to_customer_response(task).model_dump(mode="json"), object_ref=f"task:{task.id}", navigator=f"#/customer/task/{task.id}")
    return {"object_ref": f"task:{task.id}", "public_id": task.public_id, "title": task.title,
        "description": task.description, "status": task.status.name if task.status else None,
        "team": task.team.name if task.team else None, "project": task.project.name if task.project else None,
        "owner": task.owner.name if task.owner else None, "period": task.deadline.name if task.deadline else None,
        "priority": task.priority.name if task.priority else None, "priority_score": task.priority_score,
        "priority_justification": task.priority_justification, "progress": task.progress,
        "cost_rub": str(task.effort_rub) if task.effort_rub is not None else None,
        "effect_million_rub": str(task.financial_effect) if task.financial_effect is not None else None,
        "effect_justification": task.financial_effect_justification,
        "cost_value": calculate_cost_value_ratio(task.effort_rub, task.financial_effect), "version": task.version,
        "navigator": f"#/backlog?task={task.id}&tab=main"}


def project_request(row):
    history = row.status_history or []
    current = [event for event in history if event.get("status") == row.status]
    reason = current[-1].get("comment") if current else row.reject_reason if not history else None
    return {"object_ref": f"request:{row.id}", "title": row.title, "description": row.description,
        "status": row.status, "review_comment": reason, "status_history": history,
        "version": row.version, "navigator": f"#/customer/request/{row.id}"}


def task_detail(db, user, scope, ref):
    tid = ref_id(ref, "task")
    row = db.query(Task).filter(Task.id == tid, Task.is_deleted.is_(False)).first()
    allowed = customer_task_allowed(db, user, row) if scope["customer"] else row and can_access_task("read", row, user)
    if tid not in scope["task_detail"] or not allowed or scope["customer"] != is_customer_portal_only(user):
        denied()
    return row


def execute(db, user, scope, name, args, context):
    # Context intersects, never overrides question filters.
    spec = args.get("query", {"object_type": "task"})
    rows = []
    manifest = []
    limitations = []
    def selection():
        scoped = query(db, user, scope, spec)
        context_spec = context.get("filters", {})
        if context_spec.get("object_type", "task") != spec.get("object_type", "task"):
            raise HTTPException(422, "context_object_type_conflict")
        model = Task if spec.get("object_type", "task") == "task" else RequirementRequest
        ids = query(db, user, scope, context_spec).with_entities(model.id).subquery()
        scoped = scoped.filter(model.id.in_(db.query(ids.c.id)))
        if context.get("object_ref"):
            scoped = scoped.filter(model.id == ref_id(context["object_ref"], spec.get("object_type", "task")))
        return scoped

    if name in {"search_work_items", "aggregate_backlog", "query_changes", "read_meeting_context"}:
        rows = selection().all()
        kind = spec.get("object_type", "task")
        manifest = [{"kind": kind, "id": row.id, "version": row.version} for row in rows]
        offset, limit = spec.get("cursor", 0), min(args.get("limit", 20), 50)
        if name == "search_work_items":
            search_terms = []
            for term in dict.fromkeys(spec.get("terms", []) + context.get("filters", {}).get("terms", [])):
                tokens = search_tokens(term)
                search_terms.append({"term": term, "tokens": tokens})
            project = project_request if kind == "request" else lambda row: project_task(row, scope["customer"])
            search_fields = {"object_ref", "public_id", "title", "status", "team", "owner", "period", "navigator", "version"}
            data = {"items": [{k: v for k, v in project(row).items() if k in search_fields} for row in rows[offset:offset+limit]], "total": len(rows),
                    "columns": ["public_id", "title", "status", "team", "owner", "period"] if kind == "task" else ["title", "status"],
                    "next_cursor": offset+limit if offset+limit < len(rows) else None}
            data["search_terms"] = search_terms
        elif name == "aggregate_backlog":
            if kind != "task" or scope["customer"] and (args["group_by"] == "project" or any(m != "count" for m in args["metrics"])):
                raise HTTPException(422, "metric_not_supported_for_projection")
            groups = defaultdict(list)
            field = {"team": "team", "project": "project", "status": "status", "period": "deadline"}[args["group_by"]]
            for row in rows:
                relation = getattr(row, field)
                groups[(relation.id, relation.name) if relation else (None, "Не указано")].append(row)
            values = []
            for (gid, label), items in groups.items():
                result = {"group_id": gid, "group": label, "count": len(items)}
                for metric, attribute in (("cost_rub", "effort_rub"), ("effect_million_rub", "financial_effect")):
                    if metric in args["metrics"]:
                        present = [getattr(row, attribute) for row in items if getattr(row, attribute) is not None]
                        result[metric] = str(sum(present, Decimal(0))) if present else None
                        result[metric+"_unknown"] = len(items)-len(present)
                values.append(result)
            data = {"items": values[:50], "total": len(rows), "group_total": len(values), "denominator": len(rows), "units": {"cost_rub": "RUB", "effect_million_rub": "million RUB"}}
            if len(values) > 50:
                limitations.append("Показаны первые 50 групп; знаменатель включает всю доступную выборку.")
        elif name == "query_changes":
            if scope["customer"] or kind != "task":
                denied()
            start, end = (datetime.fromisoformat(args[k].replace("Z", "+00:00")) for k in ("from", "to"))
            if not start.tzinfo or not end.tzinfo or start >= end:
                raise HTTPException(422, "invalid_interval")
            events = db.query(TaskHistory).filter(TaskHistory.task_id.in_([r.id for r in rows]),
                TaskHistory.changed_at >= start, TaskHistory.changed_at < end)
            if args.get("fields"):
                events = events.filter(TaskHistory.field_name.in_(args["fields"]))
            count = events.count()
            unique = events.with_entities(TaskHistory.task_id).distinct().count()
            events = events.order_by(TaskHistory.changed_at, TaskHistory.id).offset(offset).limit(limit).all()
            data = {"items": [{"object_ref": f"task:{e.task_id}", "event_id": e.id, "field": e.field_name,
                "old": e.old_value, "new": e.new_value, "at": e.changed_at.isoformat()} for e in events],
                "total": count, "unique_tasks": unique, "from": args["from"], "to": args["to"],
                "next_cursor": offset+limit if offset+limit < count else None}
            limitations.append("Причины изменений не устанавливаются по близости комментариев во времени.")
        else:
            if scope["customer"] or not check_permission(user, "reports", "read"):
                denied()
            meeting = db.get(ReportingMeeting, ref_id(args["meeting_ref"], "meeting"))
            if not meeting:
                denied()
            statuses = db.query(TaskReportingStatus).filter(TaskReportingStatus.meeting_id == meeting.id,
                TaskReportingStatus.task_id.in_([r.id for r in rows])).all()
            data = {"meeting": {"kind": meeting.kind, "date": str(meeting.scheduled_date), "state": meeting.state},
                "items": [{"object_ref": f"task:{s.task_id}", "status": s.status_text, "weekly": s.weekly_payload} for s in statuses[:20]],
                "total": len(statuses)}
            manifest.append({"kind": "meeting", "id": meeting.id, "version": meeting.version})
    elif name in {"read_task", "compare_tasks"}:
        refs = args.get("task_refs", [args.get("task_ref")])
        rows = [task_detail(db, user, scope, ref) for ref in refs]
        if context.get("object_ref") and any(ref != context["object_ref"] for ref in refs):
            denied()
        allowed_ids = {r.id for r in query(db, user, scope, context.get("filters", {})).all()}
        # Customer request-link exception is only for an explicit detail context.
        if any(r.id not in allowed_ids for r in rows) and not (scope["customer"] and context.get("object_ref") == refs[0] and len(rows) == 1):
            denied()
        manifest = [{"kind": "task_detail", "id": row.id, "version": row.version} for row in rows]
        data = {"items": [project_task(row, scope["customer"]) for row in rows], "total": len(rows)}
        if name == "compare_tasks":
            dimensions = args.get("dimensions", [])
            data["columns"] = ["public_id", "title", *dimensions]
            allowed = {"object_ref", "public_id", "title", "navigator", "version", *dimensions}
            data["items"] = [{k: v for k, v in item.items() if k in allowed} for item in data["items"]]
        if name == "read_task" and not scope["customer"]:
            if "history" in args.get("sections", []):
                events = db.query(TaskHistory).filter(TaskHistory.task_id == rows[0].id).order_by(TaskHistory.id.desc())
                data["history_total"] = events.count()
                data["history"] = [{"field": e.field_name, "old": e.old_value, "new": e.new_value,
                    "at": e.changed_at.isoformat()} for e in events.limit(50)]
                if data["history_total"] > 50:
                    limitations.append("Показаны последние 50 событий; для интервала используйте query_changes.")
            if "comments" in args.get("sections", []):
                comments = db.query(TaskComment).filter(TaskComment.task_id == rows[0].id).order_by(TaskComment.id.desc())
                data["comments_total"] = comments.count()
                data["comments"] = [{"id": c.id, "text": c.text} for c in comments.limit(50)]
                if data["comments_total"] > 50:
                    limitations.append("Показаны последние 50 комментариев.")
    elif name == "read_request":
        row = db.query(RequirementRequest).filter(RequirementRequest.id == ref_id(args["request_ref"], "request"),
            RequirementRequest.id.in_(scope["request"]), RequirementRequest.is_deleted.is_(False), request_clause(user)).first()
        if not row:
            denied()
        context_spec = context.get("filters", {})
        if context_spec.get("object_type", "task") != "request":
            raise HTTPException(422, "request_context_required")
        if context.get("object_ref") and context["object_ref"] != args["request_ref"]:
            denied()
        if not query(db, user, scope, context_spec).filter(RequirementRequest.id == row.id).first():
            denied()
        data = {"items": [project_request(row)], "total": 1}
        manifest = [{"kind": "request", "id": row.id, "version": row.version}]
        if row.task_id:
            try:
                task = task_detail(db, user, scope, f"task:{row.task_id}")
                data["linked_task"] = project_task(task, scope["customer"])
                manifest.append({"kind": "task_detail", "id": task.id, "version": task.version})
            except HTTPException:
                pass
    elif name == "read_requirement_review":
        from services.requirement_reviews import get_review, serialize_review
        row = get_review(db, user, ref_id(args["review_ref"], "review"))
        # Do not extend initial delegation with a newly granted reviewer role.
        if row.id not in scope["review"] or row.target_type not in {"task", "request"} or row.target_id not in scope[row.target_type]:
            denied()
        if context.get("object_ref") and context["object_ref"] != f"{row.target_type}:{row.target_id}":
            denied()
        context_spec = context.get("filters", {})
        if context_spec.get("object_type", "task") != row.target_type:
            denied()
        model = Task if row.target_type == "task" else RequirementRequest
        if not query(db, user, scope, context_spec).filter(model.id == row.target_id).first():
            denied()
        data = {"items": [{"object_ref": f"review:{row.id}", "title": row.title, "status": row.status,
            "comment": row.comment, "revision": row.artifact_revision, "snapshot": row.artifact_snapshot}], "total": 1}
        manifest = [{"kind": "review", "id": row.id, "version": row.version}]
    elif name == "resolve_context":
        # Derive candidates from authorized objects, never unrestricted directories.
        kind = args["kind"]
        if scope["customer"] and kind == "project":
            denied()
        rows = query(db, user, scope, context.get("filters", {})).all()
        if context.get("object_ref"):
            object_kind = context.get("filters", {}).get("object_type", "task")
            identifier = ref_id(context["object_ref"], object_kind)
            rows = [row for row in rows if row.id == identifier]
        values = {}
        for row in rows:
            if kind == "task" and isinstance(row, Task) or kind == "request" and isinstance(row, RequirementRequest):
                values[(kind, row.id)] = row.title
            elif kind in {"team", "project", "period", "status"}:
                relation = getattr(row, "deadline" if kind == "period" else kind, None)
                if relation and hasattr(relation, "id"):
                    values[(kind, relation.id)] = relation.name
        items = [{"object_ref": f"{k}:{i}", "title": label} for (k, i), label in values.items()
                 if context_matches(args["text"], label, kind) or args["text"] == str(i)]
        data = {"items": items[:20], "total": len(items)}
        manifest = [{"kind": "task" if isinstance(row, Task) else "request", "id": row.id, "version": row.version} for row in rows]
    elif name == "search_help":
        from .help import search_help
        data = search_help(args["topic"], args["surface"], scope["customer"])
    else:
        raise HTTPException(422, "unknown_tool")
    return data, manifest, limitations
