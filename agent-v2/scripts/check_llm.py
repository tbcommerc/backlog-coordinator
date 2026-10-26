"""Check the configured LLM with synthetic JSON, without sessions or a database.

Run explicitly; this diagnostic makes a real provider request. It never prints
credentials, document contents, provider error bodies or exception strings.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import urllib.error
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_v2.config import settings
from agent_v2.llm.factory import get_llm


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=30.0,
                        help="Per-attempt timeout in seconds (1–60); provider has at most three attempts")
    args = parser.parse_args()
    if not 1 <= args.timeout <= 60:
        parser.error("--timeout must be between 1 and 60")
    if settings.LLM_PROVIDER != "openai_compat" or not settings.OPENAI_API_KEY.strip():
        print(json.dumps({"ok": False, "error": "real_provider_configuration_required"}))
        return 1
    endpoint = urlsplit(settings.OPENAI_BASE_URL)
    print(json.dumps({"stage": "request", "host": endpoint.hostname,
                      "model": settings.OPENAI_MODEL, "synthetic_input": True}), flush=True)
    try:
        provider = get_llm()
        answer = provider.chat_json(
            [{"role": "user", "content": 'Return exactly this JSON object: {"ok":true}'}],
            system_prompt="This is a connection check with synthetic data. Return only valid JSON.",
            temperature=0.0, max_tokens=256, timeout=args.timeout,
        )
        valid = json.loads(answer) == {"ok": True}
        print(json.dumps({"ok": valid, "http_status": provider.last_response_meta.get("http_status"),
                          "json_contract_ok": valid}))
        return 0 if valid else 2
    except urllib.error.HTTPError as exc:
        error_type = None
        categories = []
        try:
            payload = json.loads(exc.read(16000).decode("utf-8"))
            detail = payload.get("error", payload) if isinstance(payload, dict) else {}
            if isinstance(detail, dict):
                code = detail.get("type") or detail.get("code")
                if isinstance(code, str) and re.fullmatch(r"[A-Za-z_]{1,60}", code):
                    error_type = code
                message = str(detail.get("message") or "").lower()
                for category, term in {
                    "subscription": "subscription", "api_key": "api key",
                    "json_mode": "response_format", "session_header": "session",
                    "model": "model", "account_balance": "balance",
                    "unsupported_parameter": "unsupported", "coding_usage": "coding",
                }.items():
                    if term in message:
                        categories.append(category)
        except (ValueError, UnicodeDecodeError):
            pass
        print(json.dumps({"ok": False, "error": "provider_rejected_request", "http_status": exc.code,
                          "provider_error_type": error_type, "reason_categories": categories}))
    except (json.JSONDecodeError, TypeError):
        print(json.dumps({"ok": False, "error": "invalid_json_response"}))
    except Exception as exc:
        # Exception text may include provider response details; do not print it.
        print(json.dumps({"ok": False, "error": "provider_request_failed", "exception_type": type(exc).__name__}))
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
