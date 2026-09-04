"""Контракт LLM-адаптера.

Агент обращается к модели ровно за двумя вещами (ТЗ И2):
1. определить тип задачи и вводные для Value, когда явных атрибутов не хватает;
2. помочь сформулировать подсказку под полем Value.

Модель НЕ считает Value, приоритет и C/V — это делает детерминированный код.
Тот же принцип заложен в strategy-decomposer: LLM даёт входы, арифметику
выполняет Python. Иначе одинаковые задачи получали бы разные числа от прогона
к прогону, и методику нельзя было бы защитить перед методологом.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any, Protocol

SYSTEM_PROMPT = """Ты — аналитик трайба инноваций банка. Твоя задача: по краткой \
постановке задачи из бэклога определить, каким методом считать её финансовый \
эффект, и предложить вводные для расчёта.

Правила:
1. Ты НЕ считаешь итоговые суммы. Ты даёшь только вводные, арифметику делает код.
2. Если данных в постановке нет — верни null, а не выдуманное число. Честный \
null лучше правдоподобной цифры: null понижает уровень уверенности и попадает \
в список уточнений для автора задачи.
3. Зарабатывающие команды (IB, Pre-Trade) считаются доходным методом: сколько \
дополнительных сделок в год даёт инициатива.
4. Обслуживающие команды считаются экономией времени: сколько пользователей, \
сколько минут занимает операция, сколько раз в год она выполняется.
5. Регуляторные задачи и исследования/RnD/L2P имеют нулевой финансовый эффект.

Ответ — один JSON-объект без markdown и пояснений вокруг:
{"kind": "revenue|time_saving|regulatory|rnd",
 "deals_per_year": число или null,
 "users": число или null,
 "minutes_per_operation": число или null,
 "operations_per_year": число или null,
 "confident": true|false,
 "rationale": "одно предложение по-русски"}"""


@dataclass
class TaskHints:
    """Вводные, полученные от модели. Все числовые поля могут быть None."""

    kind: str | None = None
    deals_per_year: float | None = None
    users: float | None = None
    minutes_per_operation: float | None = None
    operations_per_year: float | None = None
    confident: bool = False
    rationale: str = ""
    provider: str = "unknown"
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("raw", None)
        return payload


class LLMAdapter(Protocol):
    """Минимальный интерфейс, который обязан реализовать каждый провайдер."""

    name: str

    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        ...

    def complete(self, system: str, user: str, schema: dict[str, Any] | None = None) -> str:
        """Свободный вызов с ответом в JSON — для оценки по рубрикам F5 и F6."""
        ...


# --- Рубрики F5 и F6 ---------------------------------------------------------

RUBRIC_SYSTEM_PROMPT = """Ты — аналитик трайба инноваций банка. Ты оцениваешь \
инициативу по заданной рубрике.

Правила:
1. Ты выбираешь вариант ответа по каждому критерию — ты НЕ выставляешь итоговый \
балл. Балл считает код по весам рубрики.
2. Отвечай только теми вариантами, которые перечислены в критерии.
3. Обоснование — одно-два предложения по-русски, со ссылкой на то, что видно в \
постановке задачи. Не додумывай факты, которых в ней нет.
4. Если постановка слишком скупая, чтобы судить, выбирай осторожный вариант, а \
не оптимистичный: завышенная оценка стратегического соответствия двигает задачу \
вверх в бэклоге, и цена ошибки здесь выше, чем у заниженной.

Ответ — один JSON-объект без markdown и текста вокруг."""


def build_strategy_prompt(
    task_text: str, team: str | None, criteria: list[dict[str, Any]], context: str = ""
) -> str:
    lines = [
        f"Команда-исполнитель: {team or 'не указана'}.",
        f"Постановка задачи: {task_text}",
    ]
    if context:
        lines += ["", "Найденные материалы о продуктах и командах:", context]

    lines += ["", "Критерии рубрики:"]
    for criterion in criteria:
        lines.append(f"\n{criterion['id']} — {criterion.get('title')}")
        lines.append(f"  Вопрос: {' '.join(str(criterion.get('question', '')).split())}")
        for key, option in (criterion.get("options") or {}).items():
            lines.append(f"  * {key}: {option.get('title')}")

    keys = ", ".join(f'"{c["id"]}"' for c in criteria)
    lines += [
        "",
        f"Верни JSON: {{\"answers\": {{{keys}: \"<ключ варианта>\"}}, "
        '"rationale": "<обоснование>"}',
    ]
    return "\n".join(lines)


def build_dependency_prompt(
    task_text: str,
    team: str | None,
    known_teams: list[str],
    declared: str | None,
    types: dict[str, Any],
    context: str = "",
) -> str:
    lines = [
        f"Команда-исполнитель: {team or 'не указана'}.",
        f"Постановка задачи: {task_text}",
    ]
    if declared:
        lines.append(f"В бэклоге указаны вовлечённые команды: {declared}")
    else:
        lines.append("В бэклоге вовлечённые команды не указаны.")
    if context:
        lines += ["", "Найденные материалы о командах трайба:", context]

    lines += [
        "",
        "Команды трайба: " + ", ".join(known_teams),
        "",
        "Типы зависимости:",
    ]
    for key, entry in types.items():
        lines.append(f"  * {key}: {entry.get('title')}")

    lines += [
        "",
        "Перечисли команды, кроме исполнителя, без которых задача не будет завершена.",
        "Если таких нет — верни пустой список: отсутствие зависимостей это нормальный",
        "ответ, а не признак недоработанной оценки.",
        "",
        'Верни JSON: {"teams": [{"team": "<название>", "type": "<тип>", '
        '"reason": "<почему>"}], "rationale": "<общий вывод>"}',
    ]
    return "\n".join(lines)


def parse_json_object(text: str) -> dict[str, Any]:
    """Достаёт JSON-объект из ответа модели, терпя обёртку в ```json ... ```."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("```")
        if len(parts) > 1:
            cleaned = parts[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("модель вернула ответ без JSON")
    return json.loads(cleaned[start : end + 1])


def build_user_prompt(task_text: str, team: str | None, team_class: str) -> str:
    team_class_ru = "зарабатывающая" if team_class == "earning" else "обслуживающая"
    return (
        f"Команда: {team or 'не указана'} ({team_class_ru}).\n"
        f"Постановка задачи: {task_text}\n\n"
        "Верни JSON по заданной схеме."
    )


def prompt_hash(system: str, user: str, model: str) -> str:
    payload = json.dumps({"s": system, "u": user, "m": model}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_hints(text: str, provider: str) -> TaskHints:
    """Разбирает ответ модели, терпя обёртку в ```json ... ```."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("модель вернула ответ без JSON")

    try:
        payload = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError("модель вернула некорректный JSON") from exc

    kind = payload.get("kind")
    if kind not in {"revenue", "time_saving", "regulatory", "rnd"}:
        raise ValueError("модель вернула неизвестный kind")
    if not isinstance(payload.get("confident"), bool):
        raise ValueError("модель вернула некорректный confident")

    def number(key: str) -> float | None:
        value = payload.get(key)
        if value is None or isinstance(value, bool):
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    return TaskHints(
        kind=kind,
        deals_per_year=number("deals_per_year"),
        users=number("users"),
        minutes_per_operation=number("minutes_per_operation"),
        operations_per_year=number("operations_per_year"),
        confident=payload["confident"],
        rationale=str(payload.get("rationale", ""))[:500],
        provider=provider,
        raw=payload,
    )
