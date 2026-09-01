from agent.telemetry import _trace_response_hook


class _Context:
    is_valid = True
    trace_id = int("abcdef1234567890abcdef1234567890", 16)


class _Span:
    def get_span_context(self):
        return _Context()


def test_trace_response_hook_adds_exact_w3c_trace_id():
    message = {"type": "http.response.start", "status": 200, "headers": []}
    _trace_response_hook(_Span(), {}, message)
    assert dict(message["headers"])[b"x-trace-id"] == b"abcdef1234567890abcdef1234567890"
