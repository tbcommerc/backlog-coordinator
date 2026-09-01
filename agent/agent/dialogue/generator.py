"""Natural-language templates for non-slot phases.

Used when no LLM is available (mock mode). When an OpenAI-compatible provider
is configured these texts are still good fallbacks; the LLM may rephrase the
questions selected by the planner instead.
"""
from ..context import UserContext, style_for
from .state import DialogueState, SLOT_LABELS

WELCOME_BUSINESS = (
    "Здравствуйте! Я ассистент по формированию требований к платформе "
    "сопровождения инвестиционных сделок. Помогу описать потребность и "
    "подготовить драфт для передачи PO / BA на ревью.\n\n"
    "С чего начнём?"
)

WELCOME_TECHNICAL = (
    "Ассистент аналитика по требованиям к платформе сопровождения "
    "инвестиционных сделок. Могу оформить драфт бизнес-требования для ревью "
    "PO / BA, с проверкой по базе знаний.\n\nУкажите тип обращения."
)


def welcome(ctx: UserContext | None) -> str:
    return WELCOME_TECHNICAL if style_for(ctx) == "technical" else WELCOME_BUSINESS


def reflect(state: DialogueState) -> str:
    parts = []
    if state.get("process"):
        parts.append(f"в части процесса {state.get('process')}")
    if state.get("product"):
        parts.append(f"по {state.get('product')}")
    if state.get("module"):
        parts.append(f"модуля {state.get('module')}")
    if state.get("role"):
        parts.append(f"для роли {state.get('role')}")
    base = "Правильно ли я понимаю, что речь о доработке платформы сопровождения инвестиционных сделок"
    if parts:
        base += " " + ", ".join(parts)
    return base + "? Верно?"


def summarize(state: DialogueState, notes: list | None = None) -> str:
    parts = ["Проверим, что я всё понял правильно. Собранное:"]
    fields = (
        ("Потребность", "need_statement"),
        ("Целевой результат", "to_be"),
        ("Пользователь и доступ", "role"),
        ("Процесс", "process"),
        ("Продукт / сделки", "product"),
        ("Модуль", "module"),
        ("Основные сценарии", "scenarios"),
        ("Бизнес-правила и ограничения", "business_rules"),
        ("Данные и интеграции", "data_integrations"),
        ("Ценность", "value"),
        ("Критерии приёмки", "acceptance_criteria"),
        ("Зависимости", "dependencies"),
        ("Риски", "risks"),
        ("Открытые вопросы", "open_questions"),
    )
    for label, key in fields:
        value = state.get(key)
        if value:
            parts.append(f"• {label}: {value}")
    for note in notes or []:
        if note.strip():
            parts.append(f"• Правка: {note.strip()[:240]}")
    parts.append("")
    parts.append("Всё верно? Подтвердите резюме — после этого я подготовлю драфт. Если нужны изменения, опишите их своими словами.")
    return "\n".join(parts)


def confirm_question() -> str:
    return "Подтверждаете сформулированную потребность? После подтверждения я подготовлю драфт бизнес-требования."


def draft_ready_message(completeness: int, confidence: str) -> str:
    return (
        f"Драфт бизнес-требования готов (полнота {completeness}%, "
        f"уверенность: {confidence}). Это черновик — он не является "
        "утверждённым требованием и будет направлен на ревью PO / BA. "
        "Проверьте формулировки и нажмите «Отправить на ревью»."
    )


def incident_triage(need: str) -> str:
    return (
        f"Принято, это выглядит как инцидент: «{need[:200]}». "
        "По инцидентам рекомендую обратиться в канал поддержки платформы. "
        "При необходимости я могу завести запись о дефекте как вход для "
        "аналитики бэклога."
    )


def clarify_answer(question: str, evidence: list) -> str:
    text = "Отвечу по базе знаний платформы:\n\n"
    if not evidence:
        text += "В базе знаний пока нет подтверждённых данных по этому вопросу. "
        text += "Рекомендую уточнить у PO / BA.\n\n"
    else:
        for item in evidence[:2]:
            text += f"• {item.get('text', '')}\n"
        text += "\n"
    text += "Оформить запрос на доработку по этому вопросу?"
    return text


def edit_prompt() -> str:
    return "Что нужно исправить? Опишите правку своими словами, я внесу её в драфт."


def confirm_after_edit() -> str:
    return "Правка учтена. Проверьте обновлённое резюме и подтвердите или опишите следующую правку."


def sent_for_review(task_id: int, title: str) -> str:
    return (
        f"Запрос #{task_id} «{title[:120]}» создан и отправлен на ревью "
        "PO / BA. Ожидается экспертная проверка и подтверждение владельцем продукта. "
        "Задача в бэклоге НЕ создаётся автоматически — финальное решение принимает человек."
    )
