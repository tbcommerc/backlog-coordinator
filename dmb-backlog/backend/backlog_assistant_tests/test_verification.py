from contextlib import nullcontext
from copy import deepcopy
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from services.backlog_assistant_integration import ledger


@pytest.fixture
def verification(monkeypatch):
    result = {"sources": [{"source_id": "r1", "receipt_ref": "r1", "kind": "search_work_items", "version": "v1", "fields": ["total"]}],
        "data": {"items": [{"title": "Разрешённая задача"}], "total": 1}, "snapshot_ref": "r1",
        "observed_at": "2026-10-14T10:00:00Z", "limitations": [],
        "coverage": {"matched_total": 1, "displayed_count": 1, "omitted_count": 0}}
    context = {"surface": "assistant", "filters": {"object_type": "task"}, "timezone": "Europe/Moscow"}
    candidate = {"kind": "answer", "context": context, "as_of": "2099-01-01T00:00:00Z", "coverage": {},
        "sources": deepcopy(result["sources"]), "data_blocks": [{"type": "table", "server_result_ref": "r1"}],
        "summary_claims": [{"text": "Всего 9999 задач", "type": "fact", "source_ids": ["r1"]}],
        "actions": [], "followups": [], "limitations": []}
    payload = {"receipts": ["r1"], "context": context}
    monkeypatch.setattr(ledger, "engine", SimpleNamespace(begin=lambda: nullcontext(object())))
    monkeypatch.setattr(ledger, "execution_row", lambda *a: {"payload": payload, "subject": "synthetic"})
    monkeypatch.setattr(ledger, "validate_receipts", lambda *a: [{"id": "r1", "payload": {"result": result}}])
    monkeypatch.setattr(ledger, "check", lambda *a: None)
    return candidate, result, payload


def test_model_numbers_and_time_are_replaced_by_receipt_facts(verification):
    candidate, result, _ = verification
    answer = ledger.verify_answer("e", "g", candidate, ["r1"])
    assert answer["as_of"] == result["observed_at"]
    assert answer["coverage"] == result["coverage"]
    assert "9999" not in str(answer["summary_claims"])
    assert answer["verified_blocks"][0]["total"] == 1
    assert answer["kind"] == "answer"


def test_omitting_uncited_receipt_is_denied(verification):
    candidate, _, payload = verification
    payload["receipts"].append("uncited")
    with pytest.raises(HTTPException):
        ledger.verify_answer("e", "g", candidate, ["r1"])


@pytest.mark.parametrize("field,value", [("version", "forged"), ("fields", ["private"]), ("receipt_ref", "foreign"), ("source_id", "foreign")])
def test_forged_citation_is_denied(verification, field, value):
    candidate, _, _ = verification
    candidate["sources"][0][field] = value
    with pytest.raises(HTTPException):
        ledger.verify_answer("e", "g", candidate, ["r1"])


def test_unknown_result_block_is_denied(verification):
    candidate, _, _ = verification
    candidate["data_blocks"][0]["server_result_ref"] = "foreign"
    with pytest.raises(HTTPException):
        ledger.verify_answer("e", "g", candidate, ["r1"])


def test_help_is_scoped_and_does_not_invent_unknown_topic():
    from services.backlog_assistant_integration.help import search_help
    assert search_help("история", "task", False)["total"] == 1
    assert search_help("встреча", "report", True)["total"] == 0
    assert search_help("несуществующая функция", "assistant", False)["items"] == []


def test_followup_intent_is_reauthorized_and_bound_to_conversation(monkeypatch):
    current = {"conversation": "same", "user_id": 1}
    receipt = {"payload": {"conversation": "same", "tool_name": "search_work_items", "arguments": {"query": {"missing": ["owner"]}}, "result": {"private": "must not be reused"}}}
    monkeypatch.setattr(ledger, "engine", SimpleNamespace(begin=lambda: nullcontext(object())))
    monkeypatch.setattr(ledger, "execution_row", lambda *a: {"payload": current, "subject": "synthetic"})
    checks = []
    def validate(subject, refs, auth):
        checks.append((subject, refs, auth))
        return [receipt]
    monkeypatch.setattr(ledger, "validate_receipts", validate)
    result = ledger.conversation_context("e", "g", ["r"])
    assert checks == [("synthetic", ["r"], current)]
    assert result["previous_queries"][0]["arguments"]["query"]["missing"] == ["owner"]
    assert "private" not in str(result)
    receipt["payload"]["conversation"] = "other"
    with pytest.raises(HTTPException):
        ledger.conversation_context("e", "g", ["r"])


def test_ambiguous_resolution_keeps_clarification(verification):
    candidate, result, _ = verification
    candidate.update(kind="clarification", clarification={"question":"Какой проект?", "options":["Первый", "Второй"]})
    result["tool_name"] = "resolve_context"
    answer = ledger.verify_answer("e", "g", candidate, ["r1"])
    assert answer["kind"] == "clarification"
    assert answer["clarification"]["question"] == "Какой проект?"


def test_aggregate_summary_distinguishes_groups_from_tasks(verification):
    candidate, result, _ = verification
    result["tool_name"] = "aggregate_backlog"
    result["data"].update(total=1101, group_total=2)
    answer = ledger.verify_answer("e", "g", candidate, ["r1"])
    assert answer["summary_claims"][0]["text"] == "Задач в выборке: 1101. Групп: 2."


def test_answer_without_receipts_is_not_success():
    from services.backlog_assistant_integration.presentation import present
    assert present({"kind":"answer"}, {})["kind"] == "unavailable"


def test_truncated_history_is_never_reported_complete():
    from services.backlog_assistant_integration.presentation import coverage_for
    value=coverage_for({"items":[{}],"total":1,"history":[{}]*50,"history_total":61}, [])
    assert not value["history_complete"]
    grouped=coverage_for({"items":[{},{}],"total":1101,"group_total":2}, [])
    assert grouped["matched_total"]==1101 and grouped["omitted_count"]==0


def test_ambiguous_receipts_require_question_even_if_model_fails(verification):
    candidate,result,_=verification
    result['tool_name']='resolve_context'
    result['data']={'items':[{'object_ref':'project:1','title':'Same'},{'object_ref':'project:2','title':'Same'}],'total':2}
    candidate['kind']='partial'
    answer=ledger.verify_answer('e','g',candidate,['r1'])
    assert answer['kind']=='clarification'
    assert answer['clarification']['question']
    assert answer['clarification']['options']==['Same (project:1)','Same (project:2)']


@pytest.mark.parametrize('text,label,kind,expected', [
    ('проектного офиса','Проектный офис','team',True),
    ('В работе','В работе','status',True),
    ('в работе','ПРИНЯТА В РАБОТУ','status',True),
    ('в работе','ВЫПОЛНЕНА','status',False),
    ('4-го квартала','4Q 2026','period',True),
    ('Q4','4Q 2026','period',True),
    ('4 квартал 2025','4Q 2026','period',False),
    ('1 квартал','4Q 2026','period',False),
    ('неизвестной команды','Проектный офис','team',False),
])
def test_filter_label_resolution(text,label,kind,expected):
    from services.backlog_assistant_integration.normalization import context_matches
    assert context_matches(text,label,kind) is expected


def test_intermediate_resolution_is_not_a_task_count(verification):
    from services.backlog_assistant_integration.presentation import present
    _,result,_ = verification
    resolution=deepcopy(result)
    resolution.update(tool_name='resolve_context',snapshot_ref='resolve')
    resolution['data']={'items':[{'title':'Проектный офис','object_ref':'team:1'}],'total':1}
    result.update(tool_name='aggregate_backlog')
    result['data']={'items':[],'total':0,'group_total':0}
    result['coverage'].update(matched_total=0,displayed_count=0)
    answer=present({'kind':'answer'}, {'resolve':resolution,'r1':result})
    assert len(answer['summary_claims'])==1
    assert 'Задач в выборке: 0' in answer['summary_claims'][0]['text']
    assert all(b['tool_name']!='resolve_context' for b in answer['verified_blocks'])
    assert answer['kind']=='no_results'


@pytest.mark.parametrize('total',[0,1,2])
def test_resolution_without_query_requires_clarification(verification,total):
    from services.backlog_assistant_integration.presentation import present
    _,result,_=verification
    result['tool_name']='resolve_context'
    result['data']={'items':[{'title':str(i)} for i in range(total)],'total':total}
    answer=present({'kind':'partial'}, {'r1':result})
    assert answer['kind']=='clarification'
    assert answer['summary_claims']==[]
    assert answer['verified_blocks']==[]
