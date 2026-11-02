"""Business-requirement quality model, separate from slot completeness."""
from dataclasses import dataclass, field
import hashlib
import re

from .state import DialogueState, SLOT_LABELS


QUALITY_PROFILES = {
    "feature": {
        "required": ["need_statement", "role", "process", "to_be", "scenarios", "acceptance_criteria", "value"],
        "recommended": ["product", "module", "data_integrations", "regulatory_flags", "risks"],
    },
    "change": {
        "required": ["need_statement", "role", "process", "as_is", "to_be", "acceptance_criteria"],
        "recommended": ["product", "module", "data_integrations", "dependencies", "value", "risks"],
    },
    "problem": {
        "required": ["need_statement", "role", "process", "as_is", "to_be", "acceptance_criteria", "value"],
        "recommended": ["product", "module", "scenarios", "risks"],
    },
    "incident": {
        "required": ["need_statement"],
        "recommended": ["role", "module", "product", "data_integrations"],
    },
    "clarification": {
        "required": ["need_statement"],
        "recommended": ["role", "process"],
    },
}

SLOT_PHASE = {
    "intent": "identify_intent", "need_statement": "need_statement",
    "role": "business_context", "process": "business_context", "product": "business_context",
    "module": "business_context", "as_is": "as_is_to_be", "to_be": "as_is_to_be",
    "users": "roles_scenarios", "scenarios": "roles_scenarios",
    "business_rules": "business_rules", "acceptance_criteria": "business_rules",
    "data_integrations": "data_integrations", "dependencies": "data_integrations",
    "risks": "data_integrations", "value": "value_priority", "priority": "value_priority",
    "regulatory_flags": "value_priority",
}

VAGUE_MARKERS = ("удобно", "быстро", "корректно", "качественно", "оптимально", "гибко")
NON_VALUE_MARKERS = (
    "требование руководства", "поручение руководства", "надо сделать",
    "попросило руководство", "решение руководства",
)


@dataclass
class QualityIssue:
    code: str
    message: str
    severity: str = "warning"
    slot: str = ""
    question: str = ""
    details: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {**self.details, **{k: v for k, v in self.__dict__.items() if k != "details"}}


@dataclass
class QualityAssessment:
    score: int
    level: str
    profile: str
    issues: list[QualityIssue] = field(default_factory=list)
    conflicts: list[QualityIssue] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "level": self.level,
            "profile": self.profile,
            "issues": [i.as_dict() for i in self.issues],
            "conflicts": [i.as_dict() for i in self.conflicts],
        }


def profile_for(state: DialogueState) -> dict:
    return QUALITY_PROFILES.get(state.get("intent") or "problem", QUALITY_PROFILES["problem"])


def required_slots_for_phase(state: DialogueState, phase: str) -> list[str]:
    slots = ["intent"] if phase == "identify_intent" else []
    slots.extend(slot for slot in profile_for(state)["required"] if SLOT_PHASE.get(slot) == phase)
    return list(dict.fromkeys(slots))


def split_criteria(value) -> list[str]:
    """Keep G/W/T continuations together, but evaluate separate list items apart."""
    values = value if isinstance(value, list) else [value or ""]
    result = []
    for text in values:
        items = []
        for part in re.split(r"[;\n]+|(?<=\S)\s+(?=\d+[.)]\s+)", str(text)):
            numbered = bool(re.match(r"^\s*(?:[-*•]|\d+[.)])\s+", part))
            part = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", part).strip()
            if not part:
                continue
            if not numbered and items and re.match(r"^(?:когда|тогда|то|when|then)\b", part, re.I):
                items[-1] += " " + part
            else:
                items.append(part)
        result.extend(items)
    return result


_OUTCOME = re.compile(
    r"\b(?:отображ\w*|показыв\w*|видит|формир\w*|сформир\w*|сохран\w*|"
    r"получ\w*|приход\w*|отправ\w*|уведом\w*|запрещ\w*|разреш\w*|доступ\w*|"
    r"недоступ\w*|блокир\w*|отклон\w*|созда\w*|изменя\w*|рассчит\w*|"
    r"вывод\w*|содерж\w*|совпад\w*|отсутств\w*|удаля\w*)\b", re.I,
)
_GENERIC_WORDS = {"система", "должна", "должен", "должно", "все", "всё", "это", "оно", "быть", "будет",
                  "если", "когда", "тогда", "при", "возможно", "пользователь"}


def _criterion_observable(text: str) -> bool:
    low = text.lower().replace("ё", "е")
    if any(re.search(rf"\b{marker}\b", low) for marker in VAGUE_MARKERS):
        return False
    if re.search(r"\b(?:время|длительность|задержка|количество|число|доля|сумма|размер|скорость)\b.+"
                 r"(?:не более|не менее|не превышает|равн\w*|до)\s+\d", low):
        return True
    outcome = _OUTCOME.search(low)
    if not outcome:
        return False
    # A number, a condition or an action without an object is not a test oracle.
    other = low[:outcome.start()] + low[outcome.end():]
    return any(len(word) >= 3 and word not in _GENERIC_WORDS
               for word in re.findall(r"[а-яa-z]+", other))


def acceptance_is_measurable(value: str) -> bool:
    criteria = split_criteria(value)
    return bool(criteria) and all(_criterion_observable(item) for item in criteria)


def business_value_is_effect(value: str) -> bool:
    low = (value or "").strip().lower()
    return bool(low) and not any(marker in low for marker in NON_VALUE_MARKERS) and bool(re.search(
        r"сниж|сокра|уменьш|ускор|повыш|увелич|предотвращ|исключ|эконом|"
        r"прозрач|контрол|доступност|соблюден|избеж|освобод|устран", low,
    ))


def _text(value) -> str:
    return "; ".join(str(x) for x in value) if isinstance(value, list) else str(value or "")


def _derived_issue(code: str, message: str, slot: str, question: str, statements: list[dict]) -> QualityIssue:
    identity = "|".join(item["field"] + ":" + item["text"] for item in statements)
    return QualityIssue(code, message, "critical", slot, question, {
        "id": "conflict-" + hashlib.sha256((code + identity).encode()).hexdigest()[:12],
        "derived": True, "status": "open", "statements": statements,
    })


def _integration_required(text: str, *, new_only: bool = False) -> bool:
    for clause in re.split(r"[;\n.!?]|\bно\b", text.lower()):
        if re.search(r"(?:без|нет|никаких)\s+(?:\w+\s+){0,2}интеграц|"
                     r"не\s+(?:\w+\s+){0,2}(?:нуж|треб|использ|получ|переда|обмен|интегр)|"
                     r"интеграц\w*\s+не\s+(?:нуж|треб)", clause):
            continue
        external = re.search(r"\bapi\b|внешн|интеграц|\bабс\b|(?:из|в)\s+(?:\w+\s+){0,2}систем", clause)
        action = re.search(r"получ|загруж|переда|обмен|импорт|выгруз|интегр|подключ|нуж|треб", clause)
        if external and action and (not new_only or re.search(r"нов\w*\s+интеграц|подключ|созда", clause)):
            return True
    return False


def _permission(text: str):
    """Conservative Russian permission templates, same actor/action/object/condition."""
    low = text.lower().replace("ё", "е").strip(" .")
    match = re.match(r"^([а-я\s-]{3,65}?)\s+(не может|может|не разрешено|не доступно|"
                     r"недоступно|запрещено|разрешено|доступно)\s+(.+)$", low)
    if not match:
        return None
    actor, mode, tail = match.groups()
    if re.search(r"\b(?:при|если|когда|кроме|только)\b", actor):
        return None
    action = re.match(r"(с?формир\w*|удал\w*|измен\w*|редактир\w*|созда\w*|просматр\w*|экспорт\w*)\s+(.+)", tail)
    if not action:
        return None
    verb, obj = action.groups()
    verb = next(key for key in ("формир", "удал", "измен", "редактир", "созда", "просматр", "экспорт") if key in verb)
    # Do not merge conditions: 'при ошибке' and 'при успехе' can legitimately differ.
    parts = re.split(r"\b(?=при|если|когда|только|кроме)\b", obj, maxsplit=1)
    def canonical(value):
        return " ".join(re.sub(r"(?:ами|ями|ом|ем|ов|ев|а|у|е|ы|и)$", "", word)
                        if len(word) > 4 else word for word in re.findall(r"[а-я]+", value))
    key = (canonical(actor), verb, canonical(parts[0]), parts[1].strip() if len(parts) > 1 else "")
    if not key[2]:
        return None
    return key, mode in {"не может", "не разрешено", "не доступно", "недоступно", "запрещено"}


def content_conflicts(values: dict) -> list[QualityIssue]:
    """Recompute bounded semantic checks from actual content, never cached flags."""
    conflicts = []
    as_is = _text(values.get("as_is")).strip().lower()
    to_be = _text(values.get("to_be")).strip().lower()
    if as_is and to_be and re.sub(r"\W+", " ", as_is) == re.sub(r"\W+", " ", to_be):
        conflicts.append(_derived_issue(
            "as_is_equals_to_be", "As-Is и To-Be описаны одинаково.", "to_be",
            "Чем целевое состояние должно отличаться от текущего процесса?",
            [{"field": key, "text": _text(values.get(key))} for key in ("as_is", "to_be")],
        ))
    integrations = _text(values.get("data_integrations")).lower()
    denied = bool(re.search(r"(?:нет|без|никаких)\s+(?:нов\w*\s+)?интеграц|интеграц\w*\s+не\s+(?:нуж|треб)", integrations))
    new_only = bool(re.search(r"нов\w*\s+интеграц", integrations))
    for key in ("need_statement", "to_be", "scenarios", "acceptance_criteria"):
        if not denied or not _integration_required(_text(values.get(key)), new_only=new_only):
            continue
        conflicts.append(_derived_issue(
            "integration_conflict", "Описание одновременно требует и исключает интеграцию.",
            "data_integrations", "Нужен ли обмен данными с внешней системой?",
            [{"field": "data_integrations", "text": _text(values.get("data_integrations"))},
             {"field": key, "text": _text(values.get(key))}],
        ))
        break
    permissions = {}
    for key in ("business_rules", "scenarios", "acceptance_criteria", "to_be"):
        for item in split_criteria(values.get(key)):
            parsed = _permission(item)
            if not parsed:
                continue
            identity, denied = parsed
            previous = permissions.get(identity)
            if previous and previous[0] != denied:
                conflicts.append(_derived_issue(
                    "permission_conflict", "Одно и то же действие пользователя одновременно разрешено и запрещено.",
                    key, "Какое правило доступа действует для этого пользователя и условия?",
                    [{"field": previous[1], "text": previous[2]}, {"field": key, "text": item}],
                ))
            permissions[identity] = (denied, key, item)
    return conflicts


def _conflicts(state: DialogueState) -> list[QualityIssue]:
    result = content_conflicts({key: state.get(key) for key in state.slots})
    for item in getattr(state, "requirement_conflicts", []):
        if item.get("status", "open") == "resolved":
            continue
        result.append(QualityIssue(
            item.get("code", "fact_conflict"), item.get("message") or "Не разрешены разные версии требования.",
            item.get("severity", "warning"), item.get("slot") or item.get("field", ""),
            item.get("question") or item.get("message", "Уточните спорное требование."), dict(item),
        ))
    return result


def assess_quality(state: DialogueState) -> QualityAssessment:
    intent = state.get("intent") or "problem"
    profile = profile_for(state)
    issues = []
    required = profile["required"]
    recommended = profile["recommended"]

    required_filled = 0
    for slot in required:
        if state.get(slot):
            required_filled += 1
        else:
            issues.append(QualityIssue(
                "missing_required", f"Не раскрыто: {SLOT_LABELS.get(slot, slot)}.",
                "critical", slot, f"Уточните: {SLOT_LABELS.get(slot, slot)}.",
            ))
    recommended_filled = sum(1 for slot in recommended if state.get(slot) or state.slots[slot].status == "not_applicable")
    score = int(75 * required_filled / max(1, len(required)) + 25 * recommended_filled / max(1, len(recommended)))

    criteria = state.get("acceptance_criteria") or ""
    failed_criteria = [(i, item) for i, item in enumerate(split_criteria(criteria), 1) if not _criterion_observable(item)]
    for index, item in failed_criteria:
        issues.append(QualityIssue(
            "acceptance_not_measurable", f"Критерий {index} требует наблюдаемого результата: «{item}».",
            "warning", "acceptance_criteria",
            f"Какой наблюдаемый результат подтвердит критерий {index}: «{item}»?",
            {"criterion_index": index, "criterion": item},
        ))
    if failed_criteria:
        score = min(79, max(0, score - min(25, 10 * len(failed_criteria))))

    value = state.get("value") or ""
    if value and not business_value_is_effect(value):
        issues.append(QualityIssue(
            "value_is_driver_not_effect",
            "Указан источник инициативы, но не раскрыт ожидаемый бизнес-эффект.",
            "warning", "value",
            "Какой бизнес-эффект даст изменение или какой риск оно снизит?",
        ))
        score = min(79, max(0, score - 10))

    conflicts = _conflicts(state)
    score = max(0, score - 20 * len(conflicts))
    if any(issue.severity == "critical" for issue in issues + conflicts):
        score = min(score, 79)
    level = "high" if score >= 80 and not conflicts else "medium" if score >= 55 else "low"
    return QualityAssessment(score, level, intent, issues, conflicts)
