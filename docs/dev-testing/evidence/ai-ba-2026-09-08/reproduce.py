"""Read-only, synthetic reproductions for the dated BA logic audit.

Run from the repository root: python docs/dev-testing/evidence/ai-ba-2026-09-08/reproduce.py
Uses an in-memory Python store and mocked model decisions; never opens a database
or calls an LLM. The actual KB files are read without modification.
"""
from __future__ import annotations

import json
import os
import sys
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "agent"))
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["SESSION_DATABASE_URL"] = "sqlite:///:memory:"
sys.dont_write_bytecode = True

from agent.agentic_orchestrator import AgenticOrchestrator
from agent.dialogue.agentic import Fact, LLMUnavailable, TurnDecision
from agent.dialogue.state import DialogueState
from agent.kb.retrieval import retrieval


class MemoryStore:
    def __init__(self, state):
        self.state = deepcopy(state)

    def get(self, _session_id):
        return deepcopy(self.state)

    def save(self, state):
        self.state = deepcopy(state)


def make_state(core=False):
    state = DialogueState(session_id="synthetic-audit", user_id=0)
    if core:
        for name, value in {
            "intent": "feature",
            "need_statement": "Нужен отчёт по сделкам для контроля расчётов",
            "to_be": "Оператор формирует отчёт по сделкам",
            "role": "Оператор",
            "process": "Контроль расчётов",
        }.items():
            state.set(name, value, confidence=1, source="user", confirmed=True)
    return state


def execute(state, messages, decision):
    store = MemoryStore(state)
    orch = AgenticOrchestrator(store)
    responses = []
    with patch("agent.agentic_orchestrator.agentic_ba.decide_strict", side_effect=decision) as model:
        for message in messages:
            response = orch.handle_message(state.session_id, message)
            responses.append({"input": message, "action": response.action, "reply": response.message})
        return store.state, responses, model.call_count


def main():
    out = {"method": "synthetic in-memory state; actual runtime; mocked model; no DB/network", "cases": {}}
    state = make_state()
    state.last_asked_slot = "data_integrations"
    state.add_message("assistant", "Нужны ли интеграции с внешними системами?")
    state, turns, calls = execute(state, ["нет"], lambda *_: TurnDecision(
        facts=[Fact("data_integrations", "Нет интеграций", 1)], reply="Понял.", next_action="reflect"))
    out["cases"]["negative_answer"] = {"turns": turns, "model_calls": calls, "integration_slot": state.get("data_integrations")}

    state = make_state(core=True)
    state.set("regulatory_flags", "Возможно, нужен обязательный контроль", confidence=.3, source="llm")
    state, turns, calls = execute(state, [
        "Уточнение: никаких регуляторных ограничений здесь нет",
        "Я уточнил у владельца процесса, обязательного контроля нет",
        "подготовить черновик сейчас",
    ], lambda *_: TurnDecision(facts=[Fact("regulatory_flags", "Не применимо", 1, correction=True)], reply="Исправлено."))
    out["cases"]["escalation_trap"] = {"turns": turns, "model_calls": calls, "regulatory_slot": state.get("regulatory_flags")}

    state = make_state()
    state.ood_strikes = 3
    state, turns, calls = execute(state, ["Возвращаюсь к требованию: нужен отчёт по расчётам"], lambda *_: TurnDecision(reply="Продолжим."))
    out["cases"]["ood_reentry"] = {"turns": turns, "model_calls": calls, "ood_strikes": state.ood_strikes}

    state = make_state()
    state.add_message("user", "Не нужно добавлять экспорт, я спрашиваю только о текущих возможностях")
    def invalid(*_):
        raise LLMUnavailable("synthetic invalid JSON") from ValueError("synthetic invalid JSON")
    state, turns, calls = execute(state, ["Где находится существующий отчёт по сделкам?"], invalid)
    out["cases"]["invalid_json_recovery"] = {"turns": turns, "model_calls": calls, "recovered_need": state.get("need_statement")}

    state = make_state(core=True)
    state.sources = [{"type": "assumption", "text": "Возможно, требуется согласование руководителем"}]
    state, turns, calls = execute(state, ["подготовить черновик сейчас"], lambda *_: TurnDecision(reply="unused"))
    out["cases"]["assumption_loss"] = {"action": turns[0]["action"], "draft_assumptions": state.draft.get("assumptions"), "sources": state.sources}

    state = make_state(core=True)
    state, turns, calls = execute(state, ["Продолжим обсуждать этот отчёт по сделкам"], lambda *_: TurnDecision(
        next_action="ask", focus="acceptance_criteria", reply="Как проверить результат?", ready_for_draft=True))
    out["cases"]["readiness_shortcut"] = {"turns": turns, "acceptance_criteria": state.get("acceptance_criteria")}

    text = "Правильно понимаю, что оператор выбирает сделки? Какой период нужен в фильтре?"
    out["cases"]["question_focus"] = {"original": text, "focus": "business_rules", "shown": AgenticOrchestrator._one_question(text, "business_rules")}

    queries = [
        "Где в системе посмотреть историю изменения статуса задачи?",
        "Есть ли автоматический повтор расчёта для сделки со статусом Failed?",
        "Кто может изменить лимит по контрагенту?",
        "Как открыть карточку клиента?",
    ]
    out["cases"]["kb_queries"] = [{"query": query, "results": retrieval.answer_from_kb(query, k=4)} for query in queries]
    target = Path(__file__).with_name("reproductions.json")
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps({"saved": str(target), "cases": {
        key: value for key, value in out["cases"].items() if key != "kb_queries"
    }}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
