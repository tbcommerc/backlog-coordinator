"""Read-only, in-memory counterexamples for the business-requirement composer.

Run from any directory with Python 3.12 and the agent's dependencies installed.
Only artifact_results.json beside this script is written. No live service,
database, protected business data, model provider or network call is used.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
os.environ["SESSION_DATABASE_URL"] = "sqlite:///:memory:"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["OPENAI_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "agent"))

from agent.composer.composer import build_draft
from agent.dialogue.agentic import Fact, TurnDecision, agentic_ba
from agent.dialogue.quality import acceptance_is_measurable
from agent.dialogue.state import DialogueState


def make_state(**overrides: str) -> DialogueState:
    values = {
        "intent": "change",
        "need_statement": "Нужен отчёт о сверке расчётов",
        "role": "Оператор",
        "process": "Сверка расчётов",
        "as_is": "Оператор вручную сверяет расчёты",
        "to_be": "Система автоматически сверяет расчёты",
        "acceptance_criteria": "Отчёт формируется за 60 секунд",
        "product": "Облигации",
        "module": "Расчёты",
        "data_integrations": "Обмен с системой расчётов",
        "dependencies": "Утверждённый формат отчёта",
        "value": "Снижение ручного труда",
        "risks": "Просрочка сверки",
    }
    values.update(overrides)
    state = DialogueState()
    for key, value in values.items():
        state.set(key, value, confirmed=True)
    state.confirmed = True
    return state


def quality_result(draft) -> dict:
    return {
        "quality_score": draft.quality_score,
        "quality_level": draft.quality_level,
        "quality_issues": draft.quality_issues,
        "conflicts": draft.conflicts,
        "review_blocked": draft.review_blocked,
    }


def reproduce() -> dict:
    results = {}
    criteria = [
        "1. Всё должно работать удобно и быстро",
        "Если возможно, сделать всё хорошо",
        "Отчёт формируется за 60 секунд; Всё остальное работает удобно",
        "При пустой выборке пользователь видит сообщение «Данные отсутствуют»",
    ]
    results["acceptance_classifier"] = [
        {"text": text, "accepted_as_measurable": acceptance_is_measurable(text)}
        for text in criteria
    ]

    draft = build_draft(make_state(acceptance_criteria=criteria[0], value="Для красоты"), None)
    assert draft.quality_score == 100 and draft.quality_level == "high"
    assert not draft.quality_issues and not draft.review_blocked
    results["vague_acceptance_high_quality"] = {
        "acceptance_criteria": draft.acceptance_criteria,
        "business_value": draft.business_value,
        **quality_result(draft),
    }

    draft = build_draft(make_state(
        need_statement="Нужен локальный отчёт без интеграций",
        to_be="Формировать отчёт локально без интеграций",
        data_integrations="Нет интеграций",
    ), None)
    assert draft.review_blocked
    assert any(item["code"] == "integration_conflict" for item in draft.conflicts)
    results["negated_integration_false_conflict"] = {
        "problem_statement": draft.problem_statement,
        "target_process": draft.target_process,
        "data_integrations": draft.data_integrations,
        **quality_result(draft),
    }

    draft = build_draft(make_state(
        business_rules="Оператору запрещено формировать отчёт",
        acceptance_criteria="Оператору доступно формирование отчёта",
    ), None)
    assert draft.quality_score == 100 and not draft.conflicts and not draft.review_blocked
    results["cross_field_conflict_not_detected"] = {
        "business_rules": draft.business_rules,
        "acceptance_criteria": draft.acceptance_criteria,
        **quality_result(draft),
    }

    exclusions = {key: "Не применимо" for key in ("data_integrations", "dependencies", "risks")}
    draft = build_draft(make_state(**exclusions), None)
    assert all(not getattr(draft, key) and key not in draft.field_provenance for key in exclusions)
    results["explicit_not_applicable_lost"] = {
        "input": exclusions,
        "artifact_fields": {key: getattr(draft, key) for key in exclusions},
        "artifact_provenance": {key: draft.field_provenance.get(key) for key in exclusions},
        "open_questions": draft.open_questions,
    }

    state = make_state()
    decision = TurnDecision(
        facts=[Fact("acceptance_criteria", "Отчёт формируется за 10 минут")],
        contradictions=["Роль оператора не согласована с ограничением доступа только руководителю"],
    )
    agentic_ba.apply(state, decision)
    state.last_agent_decision = decision.as_dict()
    draft = build_draft(state, None)
    assert len(decision.contradictions) == 2
    assert not draft.conflicts and not draft.gaps and not draft.review_blocked
    results["model_and_update_conflicts_lost"] = {
        "decision_contradictions": decision.contradictions,
        "retained_acceptance_criteria": draft.acceptance_criteria,
        "artifact_gaps": draft.gaps,
        **quality_result(draft),
    }

    draft = build_draft(make_state(data_integrations="Не знаю"), None)
    results["unknown_integration_missing_typed_gap"] = {
        "input": "Не знаю",
        "open_questions": draft.open_questions,
        "integration_gaps": [gap for gap in draft.gaps if gap["slot"] == "data_integrations"],
    }
    assert not results["unknown_integration_missing_typed_gap"]["integration_gaps"]

    draft = build_draft(make_state(acceptance_criteria="Не знаю"), None)
    assert draft.quality_level == "high"
    assert any(item["severity"] == "critical" for item in draft.quality_issues)
    results["missing_acceptance_still_high"] = quality_result(draft)
    return results


if __name__ == "__main__":
    data = {"scope": "In-memory artifact audit; no live LLM or service evaluation", "cases": reproduce()}
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    output = Path(__file__).with_name("artifact_results.json")
    output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")
