"""Verify the frozen corpus; create an explicit NOT_RUN report, never model calls."""
import argparse
import hashlib
import json
from pathlib import Path


def check(root):
    manifest = json.loads((root/"manifest.json").read_text(encoding="utf-8"))
    assert manifest["synthetic_only"] is True and manifest["denominator"] == 60
    assert len(manifest["services"]) == 5
    cases, ids = [], set()
    for service, info in manifest["services"].items():
        raw = (root/info["file"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == info["sha256"], "Corpus changed without a new version: "+service
        content = json.loads(raw)
        assert content["version"] == manifest["version"] and content["synthetic_only"] is True
        assert len(content["cases"]) == info["cases"] == 12
        assert sum(case["live_selection"] for case in content["cases"]) == info["live_cases"] == 4
        for case in content["cases"]:
            assert case["service"] == service and case["case_id"] not in ids
            assert case["input"]["text"] and case["expected"]["must_preserve"] and case["expected"]["forbidden_claims_or_effects"]
            assert len(case["expected"]["assertions"]) >= 2
            ids.add(case["case_id"])
            cases.append(case)
    assert len(cases) == 60
    indexed = {case["case_id"]:case for case in cases}
    for service, info in manifest.get("offline_fixtures", {}).items():
        assert service in manifest["services"]
        path = (root/info["file"]).resolve()
        assert path.is_relative_to(root.resolve())
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == info["sha256"], "Offline fixture changed: "+service
        content = json.loads(raw)
        fixture_ids = [case["case_id"] for case in content["cases"]]
        assert len(set(fixture_ids)) == len(fixture_ids)
        assert set(fixture_ids) <= {case["case_id"] for case in cases if case["service"]==service}
        for case in content["cases"]:
            if info["kind"] == "manually_authored_offline_responses":
                assert isinstance(case["model_response"],dict) and case["transcript"]
                assert case["binding"] in {"original_text","scenario_fixture"}
                if case["binding"] == "original_text":
                    assert case["transcript"] == indexed[case["case_id"]]["input"]["text"]
            elif info["kind"] == "validated_synthetic_go_projection":
                assert len(case["source_result_sha256"])==64 and case["responses"]
                for response in case["responses"]:
                    value = json.loads(response)
                    assert set(value)=={"answers","rationale"} and isinstance(value["answers"],dict)
            elif info['kind']=='document_model_fixtures':
                assert case['input_sha256']==hashlib.sha256(indexed[case['case_id']]['input']['text'].encode()).hexdigest()
                assert case['sources'] and isinstance(case['model_response'].get('operations'),list)
                assert case['origin'] in {'manually_authored_offline_model_fixture','validated_synthetic_go_document_projection'}
                if case['origin']=='validated_synthetic_go_document_projection':
                    assert len(case['source_result_sha256'])==64
            elif info['kind']=='dialogue_model_fixtures':
                assert case['input_sha256']==hashlib.sha256(indexed[case['case_id']]['input']['text'].encode()).hexdigest()
                assert case['binding'] in {'original_text','scenario_projection'} and case['turns']
                if case['binding']=='original_text':
                    assert case['turns'][0]['message']==indexed[case['case_id']]['input']['text']
                assert all(turn['response'] is None or isinstance(turn['response'],dict) for turn in case['turns'])
            else:
                raise AssertionError("Unknown offline evidence type")
    return manifest, cases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=Path(__file__).resolve().parents[1]/"docs/dev-testing/agent-services/corpus/v1")
    parser.add_argument("--report-template", type=Path)
    args = parser.parse_args()
    manifest, cases = check(args.corpus)
    if args.report_template:
        if args.report_template.exists():
            raise ValueError("Report exists; refusing to replace evidence")
        result = {"corpus_id": manifest["corpus_id"], "corpus_version": manifest["version"],
                  "scope": "planned_only", "real_remote": "NOT_RUN", "model_calls": 0,
                  "baseline": {case["case_id"]: {"status": "NOT_RUN", "assertions": {a["assertion_id"]: "NOT_RUN" for a in case["expected"]["assertions"]}} for case in cases},
                  "candidate": {case["case_id"]: {"status": "NOT_RUN", "assertions": {a["assertion_id"]: "NOT_RUN" for a in case["expected"]["assertions"]}} for case in cases}}
        args.report_template.parent.mkdir(parents=True, exist_ok=True)
        args.report_template.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
    print("Corpus contract: PASS (60 cases, 5 services, 20 live selections, hashes and assertions); product replay: NOT_RUN")


if __name__ == "__main__":
    main()
