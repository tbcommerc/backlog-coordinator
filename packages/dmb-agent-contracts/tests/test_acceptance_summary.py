"""Incomplete acceptance must remain visible in the delivery summary."""
from copy import deepcopy
from pathlib import Path
import runpy

import pytest

summarize = runpy.run_path(str(Path(__file__).resolve().parents[3]/
    'scripts/summarize-agent-acceptance.py'))['summarize']
CATALOG = '\n'.join(f'| T-Q0{i} | scenario | expected | scope |' for i in range(1, 5))


def matrix():
    return {'local_status': 'not_accepted', 'real_remote': 'NOT_RUN', 'tests': [
        {'test_id': f'T-Q0{i}', 'status': status, 'evidence': 'proof.json' if i == 1 else None,
         'reason': 'Unresolved synthetic result' if i != 1 else None}
        for i, status in enumerate(('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'), 1)]}


def test_all_four_results_keep_the_full_denominator():
    source = matrix()
    original = deepcopy(source)
    result = summarize(source, CATALOG)
    assert result['denominator'] == 4 and result['counts'] == dict.fromkeys(
        ('PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'), 1)
    assert result['all_passed'] is False and result['real_remote'] == 'NOT_RUN'
    assert source == original


@pytest.mark.parametrize('fault', ['missing', 'duplicate', 'skip', 'no_evidence', 'no_reason'])
def test_cannot_hide_or_upgrade_an_unverified_case(fault):
    source = matrix()
    if fault == 'missing': source['tests'].pop()
    if fault == 'duplicate': source['tests'].append(deepcopy(source['tests'][0]))
    if fault == 'skip': source['tests'][-1]['status'] = 'SKIP'
    if fault == 'no_evidence': source['tests'][0]['evidence'] = None
    if fault == 'no_reason': source['tests'][-1]['reason'] = None
    with pytest.raises(ValueError):
        summarize(source, CATALOG)
