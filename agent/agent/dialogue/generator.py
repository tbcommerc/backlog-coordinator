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
    parts = []
    parts.append("Проверим, что я всё понял правильно. Собранное:")
    if state.get("need_statement"):
        parts.append(f"• Потребность: {state.get('need_statement')[:240]}")
    if state.get("to_be"):
        parts.append(f"• Целевой результат: {state.get('to_be')[:240]}")
    if state.get("role"):
        parts.append(f"• Пользователь: {state.get('role')}")
    if state.get("process"):
        parts.append(f"• Процесс: {state.get('process')}")
    if state.get("product"):
        parts.append(f"• Продукт / сделки: {state.get('product')}")
    if state.get("module"):
        parts.append(f"• Модуль: {state.get('module')}")
    if state.get("value"):
        parts.append(f"• Ценность: {state.get('value')[:240]}")
    if state.get("acceptance_criteria"):
        parts.append(f"• Критерии приёмки: {state.get('acceptance_criteria')[:240]}")
    for note in notes or []:
        if note.strip():
            parts.append(f"• Правка: {note.strip()[:240]}")
    parts.append("")
    parts.append("Всё верно? Могу подготовить драфт или вы уточните правки.")
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
