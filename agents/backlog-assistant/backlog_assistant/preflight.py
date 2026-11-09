"""No writes and no secrets in diagnostics. Invoked before optional local startup."""
import argparse
import os
import re
import shutil
import ssl
import subprocess
import time
from pathlib import Path
import httpx
from backlog_assistant.config import service_port


def check():
    required = ("ASSISTANT_DATABASE_URL", "ASSISTANT_GATEWAY_SECRET", "ASSISTANT_SERVICE_TOKEN",
        "ASSISTANT_MODEL_URL", "ASSISTANT_MODEL_KEY", "ASSISTANT_MODEL", "DMB_DATA_API_URL",
        "ASSISTANT_TLS_CA", "ASSISTANT_TLS_CERT", "ASSISTANT_TLS_KEY")
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise ValueError("Missing settings: " + ", ".join(missing))
    from dmb_agent_contracts.config import validate_go_url
    try:
        validate_go_url(os.environ["ASSISTANT_MODEL_URL"])
    except Exception:
        raise ValueError("BACKLOG_ASSISTANT_MODEL_BASE_URL must use an allowed HTTPS Go origin") from None
    if not os.environ["ASSISTANT_DATABASE_URL"].startswith("postgresql+psycopg://"):
        raise ValueError("Dedicated PostgreSQL required")
    if min(len(os.environ[k]) for k in ("ASSISTANT_GATEWAY_SECRET", "ASSISTANT_SERVICE_TOKEN")) < 32:
        raise ValueError("Service secrets require at least 32 characters")
    if os.environ.get("ASSISTANT_RUNTIME_LOCATION","local_isolated") == "remote":
        from runtime.prepared import load_deployment
        load_deployment()
    else:
        if not os.environ.get("ASSISTANT_RUNTIME_IMAGE"):
            raise ValueError("BACKLOG_ASSISTANT_RUNTIME_IMAGE required for local isolation")
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", os.environ["ASSISTANT_RUNTIME_IMAGE"]):
            raise ValueError("Runtime image must be a local immutable sha256 image ID")
        if not shutil.which("docker") or subprocess.call(["docker", "image", "inspect", os.environ["ASSISTANT_RUNTIME_IMAGE"]],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30) != 0:
            raise ValueError("Docker and the pinned runtime image must be available")
    context = ssl.create_default_context(cafile=os.environ["ASSISTANT_TLS_CA"])
    context.load_cert_chain(os.environ["ASSISTANT_TLS_CERT"], os.environ["ASSISTANT_TLS_KEY"])
    return context


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    try:
        context = check()
        if args.health:
            last_code = "health_not_started"
            health_deadline = time.monotonic()+90
            with httpx.Client(verify=context, trust_env=False, timeout=5) as client:
                while True:
                    try:
                        for component, url in (("api",f"https://127.0.0.1:{service_port('ASSISTANT_PORT',9400)}/health"), ("data",f"https://127.0.0.1:{service_port('ASSISTANT_DATA_API_PORT',9450)}/health")):
                            last_code = component+":transport_unavailable"
                            response = client.get(url)
                            last_code = component+":http_"+str(response.status_code)
                            if response.status_code == 503:
                                try:
                                    reason = response.json().get("reason", response.json().get("detail", ""))
                                    if isinstance(reason,str) and re.fullmatch(r"[a-z_]{1,64}",reason):
                                        last_code += ":"+reason
                                except ValueError:
                                    pass
                            response.raise_for_status()
                            last_code = component+":unexpected_health_state"
                            assert response.json()["status"] == "ok"
                        break
                    except (httpx.HTTPError, AssertionError):
                        if time.monotonic() >= health_deadline:
                            raise ValueError("mTLS health unavailable: "+last_code)
                        time.sleep(.5)
        print("Backlog Assistant prerequisites: OK")
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        # Never print URLs/connection exception contents (credentials may be embedded).
        print(str(exc) if isinstance(exc, ValueError) else "Certificate or runtime prerequisite unavailable")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
