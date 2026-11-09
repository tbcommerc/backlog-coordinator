"""Read-only mTLS health probe. No Docker prerequisite check or inference."""
import json
import ssl
import httpx
from backlog_assistant.config import environment,service_port


def probe():
    values = environment()
    required = ["ASSISTANT_TLS_CA", "ASSISTANT_TLS_CERT", "ASSISTANT_TLS_KEY"]
    if any(not values.get(name) for name in required):
        return {"status": "unavailable", "reason": "mtls_configuration_missing"}
    try:
        context = ssl.create_default_context(cafile=values["ASSISTANT_TLS_CA"])
        context.load_cert_chain(values["ASSISTANT_TLS_CERT"], values["ASSISTANT_TLS_KEY"])
        states = {}
        with httpx.Client(verify=context, trust_env=False, follow_redirects=False, timeout=2) as client:
            for name, port in (("api",service_port("ASSISTANT_PORT",9400)),("data_api",service_port("ASSISTANT_DATA_API_PORT",9450))):
                try:
                    response = client.get(f"https://127.0.0.1:{port}/health")
                    states[name] = "ready" if response.status_code == 200 and response.json().get("status") == "ok" else "unavailable"
                except (httpx.HTTPError, ValueError, AttributeError):
                    states[name] = "unavailable"
        return {"status": "ready" if all(value == "ready" for value in states.values()) else "unavailable", **states}
    except (OSError, ValueError):
        return {"status": "unavailable", "reason": "mtls_prerequisite_unavailable"}


def main():
    result = probe()
    print(json.dumps(result))
    return 0 if result["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
