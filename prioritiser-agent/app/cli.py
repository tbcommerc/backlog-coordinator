"""CLI приоритизатора.

Это же — интерфейс, через который opencode-агент вызывает детерминированное
ядро: каждый инструмент в `.opencode/tool/*.js` запускает одну из этих команд и
возвращает её JSON. Такой же приём использует strategy-decomposer.

    python -m app.cli init --seed data/backlog_seed.json
    python -m app.cli recompute --all
    python -m app.cli show TASK-100-000
    python -m app.cli backlog --sort priority --limit 20
    python -m app.cli stats
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select

from app.core.attribution import AttributionError, run_attribution
from app.core.db import init_db, session_scope
from app.core.loader import load_backlog
from app.core.models import PriorityHistory, Task
from app.core.references import (
    REFERENCE_NAMES,
    ReferenceError,
    get_reference,
    save_reference,
    seed_references,
)
from app.core.scoring import FACTOR_TITLES, PRIORITY_ORDER
from app.core.service import (
    REASON_MANUAL,
    REASON_REFERENCES,
    REASON_WEIGHTS,
    recompute_all,
    recompute_task,
)
from app.rag.search import index_status, search_corpus
from app.strategy.rubric import RubricError, score_dependencies, score_strategy
from app.strategy.store import assessment_summary, save_dependencies, save_strategy

# Слои корпуса: k3 — закрытый пакет знаний банка, knowledge — обезличенные
# описания команд трайба, backlog — исторические задачи, methodology — методика.
RAG_LAYERS = ("k3", "knowledge", "backlog", "methodology")


def _emit(payload: Any) -> None:
    """Единый формат вывода: одна JSON-строка на stdout."""
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def _task_dict(task: Task, verbose: bool = False) -> dict[str, Any]:
    payload = {
        "task_key": task.task_key,
        "team": task.team,
        "title": task.title,
        "task_type": task.task_type,
        "priority": task.priority,
        "priority_score": task.priority_score,
        "priority_original": task.backlog_priority_original,
        "value_internal_mln": task.value_internal_mln,
        "value_low_mln": task.value_low_mln,
        "value_high_mln": task.value_high_mln,
        "value_external_mln": task.value_external_mln,
        "value_external_status": task.value_external_status,
        "value_source": task.value_source,
        "value_confidence": task.value_confidence,
        "cost_rub": task.cost_rub,
        "cost_to_value": task.cost_to_value,
        "deadline": task.deadline,
        "effort_man_days": task.effort_man_days,
    }
    if verbose:
        payload |= {
            "value_hint": task.value_hint,
            "priority_reason": task.priority_reason,
            "factors": {
                FACTOR_TITLES.get(code, code): value
                for code, value in (task.factor_scores or {}).items()
            },
            "contributions": task.factor_contributions,
            "applied_overrides": task.applied_overrides,
            "value_inputs": task.value_inputs,
            "strategy_fit": task.strategy_fit_raw,
            "strategy_fit_rationale": task.strategy_fit_rationale,
            "strategy_fit_confidence": task.strategy_fit_confidence,
            "dependency_score": task.dependency_score,
            "dependency_teams": task.dependency_teams,
            "dependency_rationale": task.dependency_rationale,
            "flags": {
                "regulatory": task.is_regulatory,
                "rnd": task.is_rnd,
                "blocking": task.is_blocking,
            },
        }
    return payload


# --- команды -----------------------------------------------------------------


def cmd_init(args: argparse.Namespace) -> int:
    init_db(drop=args.reset)
    with session_scope() as session:
        seeded = seed_references(session, force=args.reset)
        stats = load_backlog(session, args.seed, replace=args.reset)
    _emit({"ok": True, "references_seeded": seeded, "backlog": stats})
    return 0


def cmd_recompute(args: argparse.Namespace) -> int:
    with session_scope() as session:
        if args.task_key:
            task = session.scalar(select(Task).where(Task.task_key == args.task_key))
            if task is None:
                _emit({"ok": False, "error": f"задача {args.task_key} не найдена"})
                return 1
            recompute_task(
                session,
                task,
                use_llm=not args.no_llm,
                refresh_strategy=args.refresh_strategy,
            )
            _emit({"ok": True, "task": _task_dict(task, verbose=True)})
            return 0

        stats = recompute_all(
            session,
            reason=REASON_WEIGHTS if args.reason == "weights" else REASON_REFERENCES,
            use_llm=not args.no_llm,
            refresh_strategy=args.refresh_strategy,
        )
        _emit({"ok": True, "stats": stats.as_dict()})
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    with session_scope() as session:
        task = session.scalar(select(Task).where(Task.task_key == args.task_key))
        if task is None:
            _emit({"ok": False, "error": f"задача {args.task_key} не найдена"})
            return 1
        history = [
            {
                "created_at": h.created_at,
                "old_priority": h.old_priority,
                "new_priority": h.new_priority,
                "reason": h.reason,
            }
            for h in sorted(task.history, key=lambda h: h.id)
        ]
        _emit({"ok": True, "task": _task_dict(task, verbose=True), "history": history})
    return 0


def cmd_backlog(args: argparse.Namespace) -> int:
    with session_scope() as session:
        query = select(Task)
        if args.team:
            query = query.where(Task.team == args.team)
        if args.priority:
            query = query.where(Task.priority == args.priority)

        if args.sort == "priority":
            # Внутри одного P сортируем по сырому скору: после овверрайдов в P1
            # попадает много задач, и без этого их порядок был бы случайным.
            query = query.order_by(Task.priority.asc(), Task.priority_score.desc())
        elif args.sort == "value":
            query = query.order_by(Task.value_internal_mln.desc().nulls_last())
        elif args.sort == "cv":
            query = query.order_by(Task.cost_to_value.asc().nulls_last())
        else:
            query = query.order_by(Task.task_key.asc())

        tasks = session.scalars(query.limit(args.limit)).all()
        _emit({"ok": True, "count": len(tasks), "tasks": [_task_dict(t) for t in tasks]})
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    with session_scope() as session:
        tasks = list(session.scalars(select(Task)).all())
        by_priority = {p: 0 for p in PRIORITY_ORDER}
        by_team: dict[str, dict[str, int]] = {}
        by_confidence: dict[str, int] = {}

        for task in tasks:
            if task.priority:
                by_priority[task.priority] = by_priority.get(task.priority, 0) + 1
            team_row = by_team.setdefault(task.team or "—", {})
            team_row[task.priority or "—"] = team_row.get(task.priority or "—", 0) + 1
            key = task.value_confidence or "—"
            by_confidence[key] = by_confidence.get(key, 0) + 1

        computed = [t for t in tasks if t.priority is not None]
        _emit(
            {
                "ok": True,
                "total": len(tasks),
                "computed": len(computed),
                "by_priority": by_priority,
                "by_confidence": by_confidence,
                "by_team": by_team,
                "history_records": session.scalar(
                    select(PriorityHistory.id).order_by(PriorityHistory.id.desc()).limit(1)
                )
                or 0,
            }
        )
    return 0


def cmd_reference(args: argparse.Namespace) -> int:
    with session_scope() as session:
        if args.set_file:
            import yaml

            with open(args.set_file, encoding="utf-8") as handle:
                payload = yaml.safe_load(handle)
            try:
                row = save_reference(session, args.name, payload, actor=args.actor)
            except ReferenceError as exc:
                _emit({"ok": False, "error": str(exc)})
                return 1
            _emit({"ok": True, "name": row.name, "version": row.version})
            return 0

        _emit({"ok": True, "name": args.name, "payload": get_reference(session, args.name)})
    return 0


def cmd_attribution(args: argparse.Namespace) -> int:
    with session_scope() as session:
        try:
            result = run_attribution(
                session,
                period=args.period,
                front_actual_revenue_mln=args.front_revenue,
                actor=args.actor,
                only_closed=not args.include_open,
            )
        except AttributionError as exc:
            _emit({"ok": False, "error": str(exc)})
            return 1
        _emit({"ok": True, "result": result})
    return 0


def cmd_rag(args: argparse.Namespace) -> int:
    _emit({"ok": True, **search_corpus(args.query, top_k=args.top_k, layer=args.layer)})
    return 0


def cmd_rag_status(_args: argparse.Namespace) -> int:
    _emit({"ok": True, **index_status()})
    return 0


def _split_evidence(raw: str | None) -> list[str]:
    return [item.strip() for item in (raw or "").split(",") if item.strip()]


def cmd_rubric(args: argparse.Namespace) -> int:
    """Отдаёт рубрику субагенту: критерии, варианты, веса, типы зависимостей."""
    with session_scope() as session:
        rubric = get_reference(session, "strategy_rubric")
    if args.factor == "F5":
        _emit({"ok": True, "strategy_fit": rubric.get("strategy_fit")})
    elif args.factor == "F6":
        _emit({"ok": True, "dependencies": rubric.get("dependencies")})
    else:
        _emit({"ok": True, **rubric})
    return 0


def cmd_assess_strategy(args: argparse.Namespace) -> int:
    """Записывает оценку F5 по ответам субагента на критерии рубрики."""
    try:
        answers = json.loads(args.answers)
    except json.JSONDecodeError as exc:
        _emit({"ok": False, "error": f"ответы не разобрались как JSON: {exc}"})
        return 1

    with session_scope() as session:
        task = session.scalar(select(Task).where(Task.task_key == args.task_key))
        if task is None:
            _emit({"ok": False, "error": f"задача {args.task_key} не найдена"})
            return 1

        rubric = get_reference(session, "strategy_rubric")
        try:
            assessment = score_strategy(
                answers, rubric, rationale=args.rationale or "",
                evidence=_split_evidence(args.evidence),
            )
        except RubricError as exc:
            # Ошибка рубрики возвращается агенту текстом: он должен исправить
            # ответ, а не получить молча записанную неполную оценку.
            _emit({"ok": False, "error": str(exc)})
            return 1

        save_strategy(session, task, assessment, provider="agent", actor=args.actor,
                      model=args.model)
        session.flush()
        recompute_task(session, task, reason=REASON_MANUAL, use_llm=False)

        _emit({
            "ok": True,
            "task_key": task.task_key,
            "assessment": assessment.as_dict(),
            "priority": task.priority,
            "priority_score": task.priority_score,
            "factor_F6": (task.factor_scores or {}).get("F5_strategy_fit"),
        })
    return 0


def cmd_assess_dependencies(args: argparse.Namespace) -> int:
    """Записывает оценку F6: список команд с типом связи."""
    try:
        teams = json.loads(args.teams)
    except json.JSONDecodeError as exc:
        _emit({"ok": False, "error": f"список команд не разобрался как JSON: {exc}"})
        return 1
    if not isinstance(teams, list):
        _emit({"ok": False, "error": "ожидался список зависимостей"})
        return 1

    with session_scope() as session:
        task = session.scalar(select(Task).where(Task.task_key == args.task_key))
        if task is None:
            _emit({"ok": False, "error": f"задача {args.task_key} не найдена"})
            return 1

        rubric = get_reference(session, "strategy_rubric")
        try:
            assessment = score_dependencies(
                teams, rubric, rationale=args.rationale or "",
                evidence=_split_evidence(args.evidence),
            )
        except RubricError as exc:
            _emit({"ok": False, "error": str(exc)})
            return 1

        save_dependencies(session, task, assessment, provider="agent", actor=args.actor,
                          model=args.model)
        session.flush()
        recompute_task(session, task, reason=REASON_MANUAL, use_llm=False)

        _emit({
            "ok": True,
            "task_key": task.task_key,
            "assessment": assessment.as_dict(),
            "priority": task.priority,
            "priority_score": task.priority_score,
            "factor_F7": (task.factor_scores or {}).get("F6_dependencies"),
        })
    return 0


def cmd_assessments(args: argparse.Namespace) -> int:
    with session_scope() as session:
        task = session.scalar(select(Task).where(Task.task_key == args.task_key))
        if task is None:
            _emit({"ok": False, "error": f"задача {args.task_key} не найдена"})
            return 1
        _emit({"ok": True, "task_key": task.task_key, **assessment_summary(session, task)})
    return 0



def cmd_agent(args: argparse.Namespace) -> int:
    """Сценарий Координатора бэклога из командной строки.

    Тот же путь, что и REST-эндпоинты `/agent/value` и `/agent/priority`:
    атрибуты одной задачи внутрь, готовый ответ наружу. Нужен, чтобы контракт
    можно было проверить без поднятия сервиса — и чтобы opencode-инструмент
    оставался тонкой обёрткой над CLI, как остальные.
    """
    from app.api.contract import TaskAttributes
    from app.service import handle_request

    if args.json:
        payload = json.loads(Path(args.json).read_text(encoding="utf-8")
                             if args.json != "-" else sys.stdin.read())
        # Координатор присылает запрос целиком — конверт с типом сценария и
        # вложенными атрибутами, тот же, что принимают REST-эндпоинты. Раньше
        # CLI понимал только голые атрибуты, и файл, составленный по контракту,
        # отвергался с «extra_forbidden»: одна и та же методика принимала
        # разный JSON в зависимости от способа вызова.
        if isinstance(payload, dict) and "task" in payload:
            envelope_type = payload.get("request_type")
            if envelope_type is not None and envelope_type != args.scenario:
                _emit({
                    "ok": False,
                    "error": "сценарий в файле не совпадает с вызванным",
                    "detail": {"в файле": envelope_type, "вызван": args.scenario},
                })
                return 2
            unknown = set(payload) - {"request_type", "task", "prompt"}
            if unknown:
                _emit({
                    "ok": False,
                    "error": "в конверте запроса лишние поля",
                    "detail": sorted(unknown),
                })
                return 2
            payload = payload["task"]
    else:
        payload = {
            "task_id": args.task_id,
            "task_type": args.task_type,
            "team": args.team,
            "title": args.title,
            "description": args.description,
            "customer_division": args.customer_division,
            "project": args.project,
            "deadline": args.deadline,
            "involved_teams": args.involved_teams,
            "effort_man_days": args.effort,
            "business_customer": args.customer,
            "value_internal_mln": args.value,
        }
        payload = {k: v for k, v in payload.items() if v is not None}

    try:
        attrs = TaskAttributes(**payload)
    except ValidationError as exc:
        _emit({"ok": False, "error": "атрибуты не прошли проверку", "detail": exc.errors()})
        return 2

    with session_scope() as session:
        response = handle_request(attrs, args.scenario, session)

    # По умолчанию отдаём ровно тот шаблон, который ждёт Координатор: ответ
    # уходит в чужую систему напрямую, лишние ключи там не нужны. Подробный
    # разбор — по флагу, он для человека и для отладки.
    if args.full:
        _write(args, response.model_dump(mode="json"))
        return 0

    # Координатор всегда получает одну и ту же схему из трёх полей — и при
    # успешном расчёте, и при отказе. Иначе на его стороне пришлось бы
    # обрабатывать два формата, и о втором легко забыть.
    from app.api.contract import (
        ErrorResponse,
        refusal_to_coordinator,
        to_coordinator,
        to_coordinator_priority,
    )

    if isinstance(response, ErrorResponse):
        # Код возврата 0: отказ — это валидный ответ, а не сбой программы.
        # С ненулевым кодом обёртка opencode считала вызов провалившимся и
        # выбрасывала payload, поэтому агент показывал пересказ вместо JSON.
        # Ненулевой код остаётся за настоящими отказами: битые аргументы, падение.
        _write(args, refusal_to_coordinator(response, args.scenario).model_dump(mode="json"))
        return 0

    if args.scenario == "value" and response.value is not None:
        payload = to_coordinator(response.value).model_dump(mode="json")
    elif args.scenario == "priority" and response.priority is not None:
        payload = to_coordinator_priority(response.priority, response.value).model_dump(
            mode="json"
        )
    else:
        payload = response.model_dump(mode="json")

    _write(args, payload)
    return 0


def _write(args: argparse.Namespace, payload: Any) -> None:
    """Печатает ответ или кладёт его в файл, если задан `--out`.

    Координатор принимает на вход JSON-файл, поэтому запись в файл нужна как
    штатный режим, а не как перенаправление вывода: в stdout попадают ещё и
    предупреждения библиотек, и файл из него получился бы битым.
    """
    text = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    if getattr(args, "out", None):
        path = Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "written": str(path)}, ensure_ascii=False))
        return
    print(text)


def cmd_snapshot(args: argparse.Namespace) -> int:
    """Версия и состав зашитого слепка исторических Value."""
    from app.snapshot import get_snapshot

    snapshot = get_snapshot()
    _emit({"ok": snapshot.available, **snapshot.describe()})
    return 0 if snapshot.available else 1


# --- разбор аргументов -------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prioritiser",
        description="Агент-приоритизатор инициатив трайба",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="создать БД и загрузить бэклог")
    p_init.add_argument("--seed", default=None, help="путь к JSON-слепку бэклога")
    p_init.add_argument("--reset", action="store_true", help="пересоздать БД с нуля")
    p_init.set_defaults(func=cmd_init)

    p_rec = sub.add_parser("recompute", help="пересчитать Value и приоритет")
    p_rec.add_argument("task_key", nargs="?", help="ID задачи; без него — весь бэклог")
    p_rec.add_argument("--all", action="store_true", help="весь бэклог (по умолчанию)")
    p_rec.add_argument("--no-llm", action="store_true", help="не обращаться к модели")
    p_rec.add_argument("--refresh-strategy", action="store_true",
                       help="заново опросить Strategy Decomposer")
    p_rec.add_argument("--reason", choices=["weights", "references"], default="references")
    p_rec.set_defaults(func=cmd_recompute)

    p_show = sub.add_parser("show", help="карточка задачи с расшифровкой расчёта")
    p_show.add_argument("task_key")
    p_show.set_defaults(func=cmd_show)

    p_backlog = sub.add_parser("backlog", help="список задач")
    p_backlog.add_argument("--sort", choices=["priority", "value", "cv", "key"], default="priority")
    p_backlog.add_argument("--team")
    p_backlog.add_argument("--priority", choices=list(PRIORITY_ORDER))
    p_backlog.add_argument("--limit", type=int, default=50)
    p_backlog.set_defaults(func=cmd_backlog)

    p_stats = sub.add_parser("stats", help="сводка по бэклогу")
    p_stats.set_defaults(func=cmd_stats)

    p_ref = sub.add_parser("reference", help="просмотр и обновление справочников")
    p_ref.add_argument("name", choices=list(REFERENCE_NAMES))
    p_ref.add_argument("--set-file", help="YAML-файл с новой версией справочника")
    p_ref.add_argument("--actor", default="cli")
    p_ref.set_defaults(func=cmd_reference)

    p_attr = sub.add_parser("attribution", help="ex-post атрибуция value_external")
    p_attr.add_argument("--period", required=True, help="отчётный период, например «3Q 2026»")
    p_attr.add_argument("--front-revenue", type=float, required=True,
                        help="фактический доход фронта за период, млн ₽")
    p_attr.add_argument("--include-open", action="store_true",
                        help="учитывать незакрытые инициативы")
    p_attr.add_argument("--actor", default="cli")
    p_attr.set_defaults(func=cmd_attribution)

    p_rag = sub.add_parser("rag", help="поиск по базе знаний трайба и бэклогу")
    p_rag.add_argument("query")
    p_rag.add_argument("--top-k", type=int, default=5)
    # Слой почти всегда стоит указывать: 440 коротких задач бэклога иначе
    # вытесняют из выдачи длинные секции каталога трайба за счёт нормализации
    # BM25 по длине документа.
    p_rag.add_argument(
        "--layer",
        choices=list(RAG_LAYERS),
        help="ограничить поиск одним слоем корпуса",
    )
    p_rag.set_defaults(func=cmd_rag)

    p_rag_status = sub.add_parser(
        "rag-status", help="состав корпуса, режим поиска и версия пакета K3"
    )
    p_rag_status.set_defaults(func=cmd_rag_status)

    p_rubric = sub.add_parser("rubric", help="рубрика оценки факторов F5 и F6")
    p_rubric.add_argument("--factor", choices=["F5", "F6"], help="только один фактор")
    p_rubric.set_defaults(func=cmd_rubric)

    p_as = sub.add_parser("assess-strategy", help="записать оценку F5 по рубрике")
    p_as.add_argument("task_key")
    p_as.add_argument("--answers", required=True, help='JSON: {"критерий": "вариант"}')
    p_as.add_argument("--rationale", help="обоснование одним-двумя предложениями")
    p_as.add_argument("--evidence", help="идентификаторы фрагментов через запятую")
    p_as.add_argument("--actor", default="strategy-analyst")
    p_as.add_argument("--model")
    p_as.set_defaults(func=cmd_assess_strategy)

    p_ad = sub.add_parser("assess-dependencies", help="записать оценку F6")
    p_ad.add_argument("task_key")
    p_ad.add_argument("--teams", required=True,
                      help='JSON: [{"team": "...", "type": "...", "reason": "..."}]')
    p_ad.add_argument("--rationale", help="общий вывод")
    p_ad.add_argument("--evidence", help="идентификаторы фрагментов через запятую")
    p_ad.add_argument("--actor", default="dependency-analyst")
    p_ad.add_argument("--model")
    p_ad.set_defaults(func=cmd_assess_dependencies)

    p_asm = sub.add_parser("assessments", help="действующие оценки F5 и F6 по задаче")
    p_asm.add_argument("task_key")
    p_asm.set_defaults(func=cmd_assessments)

    p_agent = sub.add_parser(
        "agent", help="сценарий Координатора: Value или приоритет по атрибутам задачи"
    )
    p_agent.add_argument("scenario", choices=["value", "priority"])
    p_agent.add_argument(
        "--json",
        help="файл с запросом: конверт {request_type, task} либо голые атрибуты; «-» — stdin",
    )
    p_agent.add_argument(
        "--out", help="записать ответ в JSON-файл вместо вывода в stdout"
    )
    p_agent.add_argument(
        "--full", action="store_true",
        help="подробный разбор вместо шаблона Координатора (методы, драйверы, аудит)",
    )
    p_agent.add_argument("--task-id", dest="task_id")
    p_agent.add_argument("--task-type", dest="task_type")
    p_agent.add_argument("--team")
    p_agent.add_argument("--title")
    p_agent.add_argument("--description")
    p_agent.add_argument("--customer-division", dest="customer_division")
    p_agent.add_argument("--project")
    p_agent.add_argument("--deadline")
    p_agent.add_argument("--involved-teams", dest="involved_teams")
    p_agent.add_argument("--effort", type=float, help="трудозатраты, ч/д")
    p_agent.add_argument("--customer", help="ФИО бизнес-заказчика")
    p_agent.add_argument("--value", type=float, help="Value, если заполнен человеком")
    p_agent.set_defaults(func=cmd_agent)

    p_snap = sub.add_parser("snapshot", help="версия зашитого слепка исторических Value")
    p_snap.set_defaults(func=cmd_snapshot)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
