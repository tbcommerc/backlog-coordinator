from telemetry import _trace_response_hook


class _Context:
    is_valid = True
    trace_id = int("1234567890abcdef1234567890abcdef", 16)


class _Span:
    def get_span_context(self):
        return _Context()


def test_trace_response_hook_adds_exact_w3c_trace_id():
    message = {
        "type": "http.response.start",
        "status": 200,
        "headers": [(b"content-type", b"application/json")],
    }
    _trace_response_hook(_Span(), {}, message)
    assert dict(message["headers"])[b"x-trace-id"] == b"1234567890abcdef1234567890abcdef"


def test_trace_response_hook_ignores_response_body():
    message = {"type": "http.response.body", "body": b"{}"}
    _trace_response_hook(_Span(), {}, message)
    assert "headers" not in message
