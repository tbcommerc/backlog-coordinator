"""Content preservation regressions, with no working database or user fixtures."""
from copy import deepcopy
from pathlib import Path

import pytest

from agent_v2.v2.document_generation import source_facts, preserve_explicit, validate_transfer
from agent_v2.v2.document_workspace import FIELD_SLOTS, LIST_FIELDS, EDITABLE_FIELDS


TEXT = Path(__file__).with_name('fixtures').joinpath('reminders_requirement.md').read_text(encoding='utf-8')


def sources(text=TEXT):
    return [{"id": "src_test", "version": 1, "content": text}]


def facts(text=TEXT):
    return source_facts(sources(text), FIELD_SLOTS)


@pytest.mark.parametrize('format', ['bold', 'markdown', 'plain', 'compact'])
def test_source_formats_preserve_independently_known_sections(format):
    import re
    from agent_v2.v2.document_generation import analyze_sources
    text = TEXT
    if format != 'bold':
        text = text.replace('**Название:**', 'Название:')
        text = re.sub(r'^\*\*(.+?)\*\*$', lambda m: ('## ' if format == 'markdown' else '') + m[1], text, flags=re.M)
    if format == 'compact':
        text = '\n'.join(line for line in text.splitlines() if line.strip())
    units, parsing = analyze_sources(sources(text), FIELD_SLOTS)
    draft = {}
    preserve_explicit(draft, units, LIST_FIELDS)
    assert len(units) == 23
    assert parsing['status'] == 'complete'
    assert parsing['accounted_lines'] == len([line for line in text.splitlines() if line.strip()])
    assert draft['business_goal'] == 'Снизить долю просроченных задач на 20% относительно месяца до внедрения за первые два месяца использования напоминаний.'
    assert len(draft['business_requirements']) == 1
    assert len(draft['acceptance_criteria']) == 5
    assert len(draft['open_questions']) == 4
    assert draft['scope_out'] == ['Email, SMS, push-уведомления, уведомления руководителям и изменение назначения исполнителей.']
    for fact in units:
        assert fact['quote'] in text.splitlines()[fact['line'] - 1]
        assert fact['evidence_ref'] == f"src_test@1#L{fact['line']}"


def test_short_actual_input_does_not_recover_absent_source_material():
    import re
    text = TEXT.split('**За рамками требования**')[0].replace('**', '')
    text = '\n'.join(line for line in text.splitlines() if line.strip())
    draft = {}
    units = facts(text)
    preserve_explicit(draft, units, LIST_FIELDS)
    assert len(units) == 18
    assert 'scope_out' not in draft and 'open_questions' not in draft
    assert 'Система должна' not in draft['business_goal']
    assert len(draft['business_requirements']) == 1


def test_unknown_plain_label_ends_previous_section_and_is_visible_in_parse_report():
    from agent_v2.v2.document_generation import analyze_sources
    units, parsing = analyze_sources(sources('Цель\nСнизить затраты.\nПримечание автора:\nОбсудить бюджет.'), FIELD_SLOTS)
    assert [unit['field'] for unit in units] == ['business_goal', '']
    assert parsing['status'] == 'partial'
    assert [item['line'] for item in parsing['unresolved']] == [3, 4]


def test_reminders_recover_explicit_content_from_incomplete_generation():
    units = facts()
    draft = {"business_requirements": [{"text": "Автоматические напоминания"}]}
    preserve_explicit(draft, units, LIST_FIELDS)
    assert "вручную открывать" in draft["problem_statement"]
    assert "20%" in draft["business_goal"] and "два месяца" in draft["business_goal"]
    assert len(draft["acceptance_criteria"]) == 5
    assert "пяти минут" in draft["acceptance_criteria"][0]
    assert len(draft["open_questions"]) == 4
    assert "нерабочее время" in draft["open_questions"][1]
    assert any("текущий исполнитель" in rule for rule in draft["business_rules"])
    assert "Email" in draft["scope_out"][0]
    assert draft["title"] == "Напоминания о задачах с приближающимся сроком"
    assert all(unit["quote"] in TEXT for unit in units)


def test_unknown_heading_never_contaminates_previous_section():
    units = facts("**Цель**\nСнизить затраты.\n**Заметка автора**\nНужно обсудить бюджет.")
    assert [unit['field'] for unit in units] == ['business_goal', '']
    from agent_v2.v2.document_import import parse_requirement_document
    imported = parse_requirement_document(TEXT)
    assert imported.title == 'Напоминания о задачах с приближающимся сроком'
    assert 'Система должна' not in imported.fields['business_goal']
    assert 'Бизнес-требование' in imported.unmapped_sections
    assert 'нерабочее время' in imported.fields['open_questions']


def test_latest_source_version_only_and_unstructured_text_is_retained():
    items = sources('Старое значение.') + [{"id": "src_test", "version": 2, "content": "Новое значение."}]
    units = source_facts(items, FIELD_SLOTS)
    assert len(units) == 1 and units[0]['quote'] == 'Новое значение.'
    assert units[0]['source_ref'] == 'src_test@2'
    assert units[0]['field'] == ''


def test_preservation_does_not_overwrite_conflicting_source_statements():
    units = facts('## Бизнес-цель\nСнизить на 20%.\n## Бизнес-цель\nСнизить на 30%.')
    draft = {}
    preserve_explicit(draft, units, LIST_FIELDS)
    assert '20%' in draft['business_goal'] and '30%' in draft['business_goal']


def test_transfer_requires_each_fact_and_exact_document_evidence():
    units = facts('## Бизнес-цель\nСнизить на 20%.')
    draft = {'business_goal': 'Снизить на 20%.'}
    with pytest.raises(ValueError):
        validate_transfer({'coverage': [], 'questions': [], 'unsupported': []}, draft, units, EDITABLE_FIELDS)
    entry = {'fact_id': units[0]['id'], 'status': 'covered', 'field': 'business_goal', 'quote': 'Снизить на 20%.', 'reason': ''}
    answer = {'coverage': [entry], 'questions': [], 'unsupported': []}
    assert validate_transfer(answer, draft, units, EDITABLE_FIELDS)['status'] == 'complete'
    entry['quote'] = 'Несуществующая цитата'
    with pytest.raises(ValueError):
        validate_transfer(answer, draft, units, EDITABLE_FIELDS)


def test_audit_cannot_hide_changed_numbers_or_wrong_section():
    units = facts('## Бизнес-цель\nСнизить на 20%.')
    answer = {'coverage': [{'fact_id': units[0]['id'], 'status': 'covered', 'field': 'business_goal', 'quote': 'Снизить на 30%.'}], 'questions': [], 'unsupported': []}
    report = validate_transfer(answer, {'business_goal': 'Снизить на 30%.'}, units, EDITABLE_FIELDS)
    assert report['status'] == 'partial'
    assert report['issues'][0]['code'] == 'numbers_changed'
    answer['coverage'][0].update(field='open_questions', quote='Снизить на 20%.')
    answer['questions'] = [{'index': 0, 'decision': 'keep', 'priority': 'behavior', 'reason': 'Проверить условие'}]
    report = validate_transfer(answer, {'open_questions': ['Снизить на 20%.']}, units, EDITABLE_FIELDS)
    assert report['status'] == 'partial'


def test_questions_must_all_be_reviewed_and_author_questions_are_preserved():
    units = facts('## Открытые вопросы\nКак учитывать нерабочее время?')
    draft = {'open_questions': ['Как учитывать нерабочее время?', 'Нужен ли email?'], 'scope_out': ['Email исключён.']}
    answer = {'coverage': [{'fact_id': units[0]['id'], 'status': 'covered', 'field': 'open_questions', 'quote': draft['open_questions'][0]}],
              'questions': [{'index': 0, 'decision': 'keep', 'priority': 'blocking', 'reason': 'Нет правила'},
                            {'index': 1, 'decision': 'out_of_scope', 'priority': 'optional', 'reason': 'Исключено', 'evidence': 'Email исключён.'}], 'unsupported': []}
    report = validate_transfer(answer, draft, units, EDITABLE_FIELDS)
    assert report['questions'][0]['origin'] == 'author'
    assert report['questions'][1]['decision'] == 'out_of_scope'
    broken = deepcopy(answer)
    broken['questions'].pop()
    with pytest.raises(ValueError):
        validate_transfer(broken, draft, units, EDITABLE_FIELDS)


def test_initial_pipeline_repairs_once_filters_new_questions_and_marks_stale(monkeypatch):
    from agent_v2.dialogue.state import DialogueState
    from agent_v2.v2 import document_workspace as workspace
    from agent_v2.v2.document_generation import field_text
    from agent_v2.v2.fingerprint import canonical_fingerprint
    state = DialogueState(session_id='synthetic', product_mode='requirement_copilot')
    workspace.add_source(state, {'content': TEXT + '\n\n## Дополнение\nНужен журнал отправок.'})
    actions = []

    def call(state, action, instruction, field, **kwargs):
        actions.append(action)
        if action in {'create', 'repair'}:
            operations = [{'field': 'open_questions', 'after': ['Нужен ли email?']}]
            if action == 'repair':
                operations.append({'field': 'functional_requirements', 'after': ['Нужен журнал отправок.']})
            return {'operations': operations, 'section_states': {key: {'status': 'missing_data', 'reason': 'В источнике нет отдельного описания'} for key in FIELD_SLOTS}}, {'model': 'test'}
        document = kwargs['extra']['candidate_document']
        coverage = []
        for fact in kwargs['extra']['source_facts']:
            target = fact['field'] or 'functional_requirements'
            present = fact['quote'] in field_text(document, target)
            coverage.append({'fact_id': fact['id'], 'status': 'covered' if present else 'missing',
                             'field': target, 'quote': fact['quote'] if present else '', 'reason': 'Нужен журнал отправок.'})
        questions = [{'index': i, 'decision': 'out_of_scope' if q == 'Нужен ли email?' else 'keep',
                      'priority': 'behavior', 'reason': 'Канал исключён' if q == 'Нужен ли email?' else 'Нет ответа',
                      'evidence': document['scope_out'][0]} for i, q in enumerate(document['open_questions'])]
        return {'coverage': coverage, 'questions': questions, 'unsupported': []}, {'model': 'test'}

    monkeypatch.setattr(workspace, '_model_action', call)
    workspace.create_initial_draft(state, 'Создай документ')
    assert actions == ['create', 'transfer', 'repair', 'transfer']
    report = state.draft['generation_report']
    assert report['status'] == 'partial'  # Model coverage cannot certify an unknown source heading.
    assert report['source_parsing']['status'] == 'partial'
    assert any(item['code'] == 'source_parse_unresolved' for item in report['issues'])
    assert len(state.draft['open_questions']) == 4
    assert report['questions'][-1]['decision'] == 'out_of_scope'
    assert report['repair_attempted'] is True
    assert state.draft['fingerprint'] == canonical_fingerprint(state.draft)
    assert workspace.response_metadata(state)['document_generation']['stale'] is False
    before = deepcopy(state.draft)
    with pytest.raises(ValueError):
        workspace.create_initial_draft(state, 'Повтори')
    assert state.draft == before
    workspace.save_sections(state, {'business_goal': 'Уточнённая цель'})
    assert workspace.response_metadata(state)['document_generation']['stale'] is True


def test_failed_transfer_and_repair_keep_original_candidate_with_unverified_status(monkeypatch):
    from agent_v2.dialogue.state import DialogueState
    from agent_v2.v2 import document_workspace as workspace
    state = DialogueState(session_id='synthetic', product_mode='requirement_copilot')
    workspace.add_source(state, {'content': TEXT})
    calls = []

    def call(state, action, instruction, field, **kwargs):
        calls.append(action)
        if action != 'create':
            raise TimeoutError('test')
        return {'operations': [{'field': 'title', 'after': 'Черновик'}]}, {'model': 'test'}

    monkeypatch.setattr(workspace, '_model_action', call)
    workspace.create_initial_draft(state, '')
    assert calls == ['create', 'transfer', 'repair']
    assert len(state.draft['acceptance_criteria']) == 5
    assert state.draft['generation_report']['status'] == 'unverified'
    assert state.draft['field_provenance']['acceptance_criteria']['confirmed'] is False


def test_partial_repair_preserves_derived_sections_and_their_provenance(monkeypatch):
    from agent_v2.dialogue.state import DialogueState
    from agent_v2.v2 import document_workspace as workspace
    state = DialogueState(session_id='partial-repair', product_mode='requirement_copilot')
    source = workspace.add_source(state, {'content': 'Описание процесса для проверки.'})
    ref = f"{source['id']}@1"
    seen = []

    def call(state, action, instruction, field, **kwargs):
        if action == 'create':
            return {'operations': [
                {'field': 'current_process', 'after': 'Ручная проверка.', 'source_refs': [ref]},
                {'field': 'target_process', 'after': 'Автоматическая проверка.', 'source_refs': [ref]},
            ], 'section_states': {key: {'status': 'missing_data', 'reason': 'Нет данных'}
                                  for key in FIELD_SLOTS}}, {}
        assert action == 'repair'
        return {'operations': [{'field': 'target_process', 'after': 'Проверка с уведомлением.',
                                'source_refs': [ref]}]}, {}

    def transfer(state, document, **kwargs):
        seen.append(deepcopy(document))
        return {'status': 'partial' if len(seen) == 1 else 'complete',
                'issues': [{'code': 'missing'}] if len(seen) == 1 else [], 'questions': [],
                'source_fingerprint': 'synthetic'}

    monkeypatch.setattr(workspace, '_model_action', call)
    monkeypatch.setattr(workspace, 'check_transfer', transfer)
    workspace.create_initial_draft(state, 'Подготовь документ')
    assert seen[1]['current_process'] == seen[0]['current_process'] == 'Ручная проверка.'
    assert state.draft['current_process'] == 'Ручная проверка.'
    assert state.draft['target_process'] == 'Проверка с уведомлением.'
    assert state.draft['field_provenance']['current_process']['source_refs'] == [ref]
    assert state.draft['generation_report']['status'] == 'complete'
    assert state.draft['generation_report']['section_states']['risks']['status'] == 'missing_data'


def test_free_text_has_no_invented_structure_and_changed_sources_stale_report(monkeypatch):
    from agent_v2.dialogue.state import DialogueState
    from agent_v2.v2 import document_workspace as workspace
    state = DialogueState(session_id='synthetic', product_mode='requirement_copilot')
    source = workspace.add_source(state, {'content': 'Сократить ожидание. Лимит не определён.'})
    monkeypatch.setattr(workspace, '_model_action', lambda *a, **k: ({'operations': [{'field': 'business_goal', 'after': 'Сократить ожидание.'}]}, {}))
    workspace.create_initial_draft(state, '')
    assert not state.draft['acceptance_criteria']
    assert not state.draft['scope_in']
    workspace.add_source(state, {'id': source['id'], 'content': 'Лимит — пять минут.'})
    assert workspace.response_metadata(state)['document_generation']['stale'] is True


def test_initial_text_wrappers_are_lossless_but_extra_fields_and_fake_refs_are_rejected():
    from agent_v2.dialogue.state import DialogueState
    from agent_v2.v2 import document_workspace as workspace
    state = DialogueState()
    source = workspace.add_source(state, {'content': 'Описание без заголовка.'})
    ref = f"{source['id']}@1"
    answer = {'operations': [{'field': 'scope_in', 'after': [{'text': 'Функция', 'source_refs': [ref]}]}]}
    candidate, _ = workspace._initial_candidate(state, answer, [])
    assert candidate['scope_in'] == ['Функция']
    assert answer['operations'][0]['after'][0]['text'] == 'Функция'
    answer['operations'][0]['after'][0]['source_refs'] = ['fabricated']
    with pytest.raises(ValueError, match='invalid_source_reference'):
        workspace._initial_candidate(state, answer, [])
    answer['operations'][0]['after'][0] = {'text': 'Функция', 'condition': 'Нельзя потерять'}
    with pytest.raises(ValueError, match='invalid_list_value'):
        workspace._initial_candidate(state, answer, [])


def test_invalid_initial_contract_uses_one_repair_and_retains_source_on_failure(monkeypatch):
    from agent_v2.dialogue.state import DialogueState
    from agent_v2.v2 import document_workspace as workspace
    state = DialogueState()
    workspace.add_source(state, {'content': TEXT})
    calls = []
    def call(*args, **kwargs):
        calls.append(args[1])
        return {'operations': [{'field': 'scope_in', 'after': 123}]}, {}
    monkeypatch.setattr(workspace, '_model_action', call)
    workspace.create_initial_draft(state, '')
    assert calls == ['create', 'repair']
    assert state.draft['generation_report']['status'] == 'unverified'
    assert len(state.draft['acceptance_criteria']) == 5
