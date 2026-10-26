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


def check():
    required = ("ASSISTANT_DATABASE_URL", "ASSISTANT_GATEWAY_SECRET", "ASSISTANT_SERVICE_TOKEN",
        "ASSISTANT_MODEL_URL", "ASSISTANT_MODEL_KEY", "ASSISTANT_MODEL", "DMB_DATA_API_URL", "ASSISTANT_RUNTIME_IMAGE",
        "ASSISTANT_TLS_CA", "ASSISTANT_TLS_CERT", "ASSISTANT_TLS_KEY")
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise ValueError("Missing settings: " + ", ".join(missing))
    if not os.environ["ASSISTANT_DATABASE_URL"].startswith("postgresql+psycopg://"):
        raise ValueError("Dedicated PostgreSQL required")
    if min(len(os.environ[k]) for k in ("ASSISTANT_GATEWAY_SECRET", "ASSISTANT_SERVICE_TOKEN")) < 32:
        raise ValueError("Service secrets require at least 32 characters")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", os.environ["ASSISTANT_RUNTIME_IMAGE"]):
        raise ValueError("Runtime image must be a local immutable sha256 image ID")
    if not shutil.which("docker") or subprocess.call(["docker", "image", "inspect", os.environ["ASSISTANT_RUNTIME_IMAGE"]],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
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
            with httpx.Client(verify=context, trust_env=False, timeout=2) as client:
                for attempt in range(30):
                    try:
                        for url in ("https://127.0.0.1:9400/health", "https://127.0.0.1:9450/health"):
                            response = client.get(url)
                            response.raise_for_status()
                            assert response.json()["status"] == "ok"
                        break
                    except (httpx.HTTPError, AssertionError):
                        if attempt == 29:
                            raise ValueError("mTLS health unavailable")
                        time.sleep(.5)
        print("Backlog Assistant prerequisites: OK")
        return 0
    except (ValueError, OSError) as exc:
        # Never print URLs/connection exception contents (credentials may be embedded).
        print(str(exc) if isinstance(exc, ValueError) else "Certificate or runtime prerequisite unavailable")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
