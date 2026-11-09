"""Keep every numbered specification requirement visible, including open gaps.

Catalog family links are candidate coverage, never proof of a requirement PASS.
Evidence acceptance remains explicit in test-matrix.json.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re


def trace(root):
    spec=root/'docs/AGENT_SERVICES_MIGRATION_SPEC_2026-11-02.md'
    plan=root/'docs/AGENT_SERVICES_MIGRATION_TEST_PLAN_2026-11-02.md'
    matrix=json.loads((root/'docs/dev-testing/agent-services/test-matrix.json').read_text(encoding='utf-8'))
    status={entry['test_id']:entry['status'] for entry in matrix['tests']}
    requirements=[]
    for line in spec.read_text(encoding='utf-8').splitlines():
        cells=[cell.strip() for cell in line.split('|')[1:-1]]
        if cells and re.fullmatch(r'(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2}|ACC-[LC]\d{2}|W\d{2})',cells[0]):
            requirements.append((cells[0],cells[1]))
    assert len({identity for identity,_ in requirements})==len(requirements),'duplicate_requirement_id'
    catalog={}
    for line in plan.read_text(encoding='utf-8').splitlines():
        cells=[cell.strip() for cell in line.split('|')[1:-1]]
        if cells and re.fullmatch(r'T-[A-Z]\d{2}',cells[0]):
            assert cells[0] not in catalog,'duplicate_catalog_test'
            catalog[cells[0]]=cells[-1].split(', ')
    assert set(status)==set(catalog),'matrix_catalog_denominator_mismatch'
    entries=[]
    for identity,text in requirements:
        family=identity.rsplit('-',1)[0]
        candidates=[test for test,groups in catalog.items() if identity in groups or family in groups]
        entries.append({'requirement_id':identity,'requirement':text,
            'suggested_catalog_tests':candidates,
            'catalog_statuses':{test:status[test] for test in candidates},
            'requirement_acceptance':'NOT_VERIFIED',
            'gap':'Exact assertion/evidence review remains required' if candidates else
                'No exact catalog link; implementation or explicit decision evidence required'})
    return {'scope':'complete numbered requirement inventory; family links are suggestions, not PASS evidence',
        'spec_sha256':hashlib.sha256(spec.read_bytes()).hexdigest(),
        'test_plan_sha256':hashlib.sha256(plan.read_bytes()).hexdigest(),
        'requirement_denominator':len(entries),'catalog_denominator':len(catalog),
        'real_remote':'NOT_RUN','requirements':entries}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--write',action='store_true')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    output=root/'docs/dev-testing/agent-services/requirement-trace.json'
    expected=trace(root)
    if args.write:
        output.write_text(json.dumps(expected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    else:
        assert json.loads(output.read_text(encoding='utf-8'))==expected,'requirement_trace_drift'
    print(json.dumps({'inventory':'PASS','requirement_denominator':expected['requirement_denominator'],
        'catalog_denominator':expected['catalog_denominator'],'requirement_acceptance':'NOT_VERIFIED'}))


if __name__=='__main__':
    main()
