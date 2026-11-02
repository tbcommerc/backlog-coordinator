"""Explicit real-model evaluation of synthetic requirements; never uses a DB.

Only the bundled artificial fixture is sent. Credentials/provider bodies are not
printed. A JSON artifact can contain the synthetic document and its audit.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
import sys
import time

os.environ['AGENT_V2_SESSION_DATABASE_URL'] = 'sqlite:///:memory:'
os.environ['AGENT_V2_MCP_SERVERS_JSON'] = '[]'
os.environ['AGENT_V2_TOOLS_CONFIG_JSON'] = '[]'
os.environ['AGENT_V2_OTEL_ENABLED'] = 'false'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from business_analyst_experimental.config import settings
from business_analyst_experimental.dialogue.state import DialogueState
from business_analyst_experimental.v2 import document_workspace as workspace
from business_analyst_experimental.v2.document_workspace import add_source, create_initial_draft


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=1, choices=range(1, 6))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--format', choices=['bold', 'markdown', 'plain', 'compact', 'short'], default='bold')
    args = parser.parse_args()
    if settings.LLM_PROVIDER != 'openai_compat' or not settings.OPENAI_API_KEY:
        print(json.dumps({'ok': False, 'error': 'real_provider_configuration_required'}))
        return 1
    text = Path(__file__).resolve().parents[1].joinpath('business_analyst_experimental/tests/fixtures/reminders_requirement.md').read_text(encoding='utf-8')
    author_questions = [line[2:] for line in text.split('**Намеренно оставленные вопросы для проверки агента V2**')[1].splitlines() if line.startswith('- ')]
    assert len(author_questions) == 4
    if args.format == 'short':
        text = text.split('**За рамками требования**')[0]
    if args.format != 'bold':
        text = text.replace('**Название:**', 'Название:')
        text = re.sub(r'^\*\*(.+?)\*\*$', lambda m: ('## ' if args.format == 'markdown' else '') + m[1], text, flags=re.M)
    if args.format in {'compact', 'short'}:
        text = '\n'.join(line for line in text.splitlines() if line.strip())
    results = []
    original = workspace._model_action
    trace = []
    def traced(*call_args, **kwargs):
        started = time.monotonic()
        answer, meta = original(*call_args, **kwargs)
        trace.append({'action': call_args[1], 'seconds': round(time.monotonic() - started, 1), 'answer': answer})
        print(json.dumps({'stage': call_args[1], 'seconds': trace[-1]['seconds'], 'response_received': True}), flush=True)
        return answer, meta
    workspace._model_action = traced
    for run in range(args.runs):
        started = time.monotonic()
        state = DialogueState(session_id=f'synthetic-generation-{run}', product_mode='requirement_copilot', operator_role='BA')
        add_source(state, {'title': 'Синтетический пример напоминаний', 'content': text})
        print(json.dumps({'stage': 'generation', 'run': run + 1, 'model': settings.OPENAI_MODEL}), flush=True)
        try:
            create_initial_draft(state, 'Подготовь полный рабочий документ из источника. Сохрани все условия и вопросы автора.')
            doc = state.draft
            report = doc['generation_report']
            checks = {
                'core_sections': all(doc.get(key) for key in ('problem_statement', 'business_goal', 'current_process', 'target_process', 'scope_in', 'acceptance_criteria')),
                'five_criteria': len(doc.get('acceptance_criteria', [])) == 5,
                'five_minute_tolerance': 'пяти минут' in '\n'.join(doc.get('acceptance_criteria', [])),
                'author_questions': (not any(f['kind'] == 'author_question' for f in report['source_facts'])) if args.format == 'short' else all(q in doc.get('open_questions', []) for q in author_questions),
                'source_parsing': report['source_parsing']['status'] == 'complete' and len(report['source_facts']) == (18 if args.format == 'short' else 23),
                'goal_boundary': doc.get('business_goal') == 'Снизить долю просроченных задач на 20% относительно месяца до внедрения за первые два месяца использования напоминаний.',
                'current_assignee': any('текущий исполнитель' in rule for rule in doc.get('business_rules', [])),
                'transfer_complete': report['status'] == 'complete',
                'no_redundant_channel_questions': args.format == 'short' or not any(any(term in q.lower() for term in ('email', 'sms', 'push', 'руководител')) for q in doc.get('open_questions', [])),
            }
            result = {'run': run + 1, 'ok': all(checks.values()), 'checks': checks,
                      'seconds': round(time.monotonic() - started, 1), 'document': doc}
            print(json.dumps({key: value for key, value in result.items() if key != 'document'}, ensure_ascii=False), flush=True)
        except Exception as exc:
            result = {'run': run + 1, 'ok': False, 'error': type(exc).__name__}
            if isinstance(exc, ValueError) and re.fullmatch('[a-z_]{1,80}', str(exc)):
                result['validation_code'] = str(exc)
            print(json.dumps(result), flush=True)
        results.append(result)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({'model': settings.OPENAI_MODEL, 'results': results, 'trace': trace}, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if all(result['ok'] for result in results) else 2


if __name__ == '__main__':
    raise SystemExit(main())
