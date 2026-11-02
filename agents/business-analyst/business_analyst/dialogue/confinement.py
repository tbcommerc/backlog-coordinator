"""Conversation confinement - keeps the dialogue inside the domain.

First off-topic attempt: gently steer back. Second: explicitly restate the
boundaries. Third: terminate / escalate the scenario.
"""
from ..config import settings
from .state import DialogueState


def register_off_topic(state: DialogueState) -> dict:
    """Increment the off-topic counter and return (text, escalate)."""
    state.ood_strikes += 1
    if state.ood_strikes >= settings.OUT_OF_DOMAIN_MAX_STRIKES:
        state.escalation = True
        return {
            "text": "Мы несколько раз вышли за рамки сценария. Завершаю сбор требований. "
                    "При необходимости начните новый диалог и опишите доработку платформы.",
            "escalate": True,
        }
    if state.ood_strikes == 2:
        return {
            "text": "Напомню: я работаю только с требованиями к платформе сопровождения "
                    "инвестиционных сделок. Пожалуйста, опишите бизнес-проблему или доработку.",
            "escalate": False,
        }
    return {
        "text": "Я помогаю только с формированием требований к платформе сопровождения "
                "инвестиционных сделок. Опишите, пожалуйста, какую бизнес-проблему "
                "или доработку нужно рассмотреть.",
        "escalate": False,
    }
