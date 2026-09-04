"""Детерминированный мок вместо LLM.

Работает без сети и всегда даёт один и тот же ответ на один и тот же текст —
это делает прогон всего бэклога воспроизводимым и позволяет писать тесты на
формулы, не выдавая расхождения за ошибку методики.

Мок сознательно скупой: он определяет вид задачи по ключевым словам и почти
никогда не предлагает числовые вводные. Так и должно быть — вводных в
постановках действительно нет, и подставлять их вместо автора задачи означало
бы ровно ту манипуляцию Value, против которой написано ТЗ.
"""

from __future__ import annotations

import json

from app.llm.base import TaskHints

REVENUE_MARKERS = (
    "доход", "сделк", "выдач", "продаж", "воронк", "конверси", "клиент",
    "лид", "pipeline", "пайплайн", "комисси", "выручк",
)
TIME_SAVING_MARKERS = (
    "автоматиз", "витрин", "отчёт", "отчет", "дашборд", "процесс", "ручн",
    "интеграц", "миграц", "рефактор", "оптимизац", "сервис", "api", "форм",
)
REGULATORY_MARKERS = ("регулятор", "цб рф", "банк россии", "предписан", "надзор", "комплаенс", "нормативн")
RND_MARKERS = ("исследован", "l2p", "rnd", "r&d", "ниокр", "пилот", "гипотез", "poc", "прототип")


class MockAdapter:
    """Классификатор по ключевым словам."""

    name = "mock"

    def classify(self, task_text: str, team: str | None, team_class: str) -> TaskHints:
        text = (task_text or "").lower()

        def has(markers: tuple[str, ...]) -> bool:
            return any(marker in text for marker in markers)

        if has(REGULATORY_MARKERS):
            return TaskHints(
                kind="regulatory",
                confident=True,
                rationale="В постановке есть признаки регуляторного требования.",
                provider=self.name,
            )
        if has(RND_MARKERS):
            return TaskHints(
                kind="rnd",
                confident=True,
                rationale="Задача выглядит как исследование или пилот без прямой монетизации.",
                provider=self.name,
            )

        revenue = has(REVENUE_MARKERS)
        saving = has(TIME_SAVING_MARKERS)

        if team_class == "earning":
            kind = "revenue"
            confident = revenue
            rationale = (
                "Зарабатывающая команда, в постановке есть признаки дохода."
                if revenue
                else "Зарабатывающая команда; признаков дохода и числовых вводных в тексте нет."
            )
        else:
            kind = "time_saving"
            confident = saving
            rationale = (
                "Обслуживающая команда, в постановке есть признаки экономии ручного труда."
                if saving
                else "Обслуживающая команда; числовых вводных в тексте нет."
            )

        # Числовые вводные мок не выдумывает — их извлекает регулярками value.py
        # из самого текста, если они там есть.
        return TaskHints(kind=kind, confident=confident, rationale=rationale, provider=self.name)


    def complete(self, system: str, user: str, schema: dict | None = None) -> str:
        """Детерминированные ответы по рубрике — по ключевым словам постановки.

        Мок сознательно осторожен: при отсутствии явных признаков он выбирает
        нижний вариант, а не средний. Завышенное стратегическое соответствие
        двигает задачу вверх в бэклоге, и цена такой ошибки выше, чем у
        заниженной оценки.
        """
        text = (user or "").lower()

        def has(*markers: str) -> bool:
            return any(m in text for m in markers)

        if '"teams"' in user:
            # Зависимости мок не выдумывает: он не может знать, кто кому что
            # поставляет. Пустой список честнее правдоподобного перечня.
            return json.dumps(
                {
                    "teams": [],
                    "rationale": "Детерминированный мок не определяет зависимости между командами.",
                },
                ensure_ascii=False,
            )

        answers = {
            "strategic_theme": "supporting"
            if has("платформ", "ibp", "ai", "витрин", "процесс")
            else "adjacent",
            "revenue_link": "direct"
            if has("доход", "сделк", "выдач", "воронк", "лид", "продаж")
            else ("enabling" if has("конверси", "клиент", "пайплайн") else "none"),
            "client_impact": "core"
            if has("клиент", "сделк", "заявк")
            else ("partial" if has("отчёт", "отчет", "витрин") else "internal"),
            "platform_leverage": "platform"
            if has("платформ", "ibp", "интеграц", "сервис")
            else "team",
            "mandate_fit": "core",
        }
        return json.dumps(
            {
                "answers": answers,
                "rationale": "Детерминированная оценка мока по ключевым словам постановки.",
            },
            ensure_ascii=False,
        )
