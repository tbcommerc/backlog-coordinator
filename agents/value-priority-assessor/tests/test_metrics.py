from value_priority_assessor.api import main
from value_priority_assessor.service.metrics import record_request, render_prometheus, reset_metrics


def test_prometheus_metrics_include_requests_phases_and_llm_counts():
    reset_metrics()
    record_request(
        request_type="priority",
        status="ok",
        cached=False,
        duration_ms=1250,
        llm_calls=2,
        phases={"factor_assessments": 900},
    )

    body = render_prometheus()

    assert 'request_type="priority",status="ok",cached="false"} 1' in body
    assert "prioritiser_request_duration_seconds_sum" in body
    assert " 1.250000" in body
    assert 'phase="factor_assessments"} 0.900000' in body
    assert "prioritiser_llm_calls_total 2" in body


def test_metrics_endpoint_exposes_registry():
    response = main.metrics()

    assert "prioritiser_requests_total" in response
