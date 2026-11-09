"""Summarize the complete catalog without upgrading missing or skipped results."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

STATUSES = ('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN')


def summarize(matrix, catalog):
    expected = re.findall(r'^\| (T-[A-Z]+\d+) \|', catalog, re.MULTILINE)
    if not expected or len(set(expected)) != len(expected):
        raise ValueError('invalid_catalog_ids')
    rows = matrix['tests']
    actual = [row['test_id'] for row in rows]
    if len(set(actual)) != len(actual) or set(actual) != set(expected):
        raise ValueError('acceptance_denominator_mismatch')
    counts = Counter({status: 0 for status in STATUSES})
    for row in rows:
        status = row['status']
        if status not in STATUSES:
            raise ValueError('unknown_acceptance_status')
        if status == 'PASS' and not row.get('evidence'):
            raise ValueError('pass_without_evidence')
        if status != 'PASS' and not row.get('reason'):
            raise ValueError('open_result_without_reason')
        counts[status] += 1
    return {'scope': 'complete_test_catalog', 'denominator': len(expected),
        'counts': dict(counts), 'all_passed': counts['PASS'] == len(expected),
        'local_status': matrix['local_status'], 'real_remote': matrix['real_remote'],
        'tests': rows}


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    matrix = root/'docs/dev-testing/agent-services/test-matrix.json'
    catalog = root/'docs/AGENT_SERVICES_MIGRATION_TEST_PLAN_2026-11-02.md'
    result = summarize(json.loads(matrix.read_text(encoding='utf-8')), catalog.read_text(encoding='utf-8'))
    result['source_sha256'] = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in (matrix, catalog)}
    if args.output:
        target = args.output.resolve()
        if not target.is_relative_to(root/'.runtime'):
            parser.error('Workspace runtime evidence path required')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: result[key] for key in ('denominator', 'counts', 'all_passed', 'real_remote')}))


if __name__ == '__main__':
    main()
