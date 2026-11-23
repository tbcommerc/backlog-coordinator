"""External HTTPS smoke. Password/tokens/cookies stay in memory and out of reports.

Only session login/refresh/logout mutate state; business and protected records
are read-only. Run inside the bank network with a pre-existing account.
"""
import argparse
import getpass
import json
import ssl
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit

import urllib.error
import urllib.request
from http.cookiejar import CookieJar


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _Response:
    def __init__(self, response):
        self.status_code = response.code
        self.headers = response.headers
        self.body = response.read()

    def json(self):
        return json.loads(self.body)


class _Client:
    def __init__(self, base_url, context):
        self.base_url = base_url
        self.headers = {"Origin": base_url}
        self.opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPSHandler(context=context),
            urllib.request.HTTPCookieProcessor(CookieJar()))

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.headers.clear()

    def request(self, method, path, payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = dict(self.headers)
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                return _Response(response)
        except urllib.error.HTTPError as response:
            try:
                return _Response(response)
            finally:
                response.close()

    def get(self, path):
        return self.request("GET", path)

    def post(self, path):
        return self.request("POST", path)



class SmokeFailure(Exception):
    pass


def check_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise SmokeFailure("Base URL must be an exact origin, without credentials or a path")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise SmokeFailure("External stands require HTTPS")
    return f"{parsed.scheme}://{parsed.netloc}"


def run_smoke(base_url, login, password, *, ca_file=None, wait_expiry=False, expect_admin=False):
    origin = check_origin(base_url)
    checks = []
    context = ssl.create_default_context(cafile=ca_file)
    with _Client(origin, context) as client:
        def request(method, path, **kwargs):
            response = client.request(method, "/api/v1/" + path, **kwargs)
            checks.append({"method": method, "path": path, "status": response.status_code})
            if response.status_code != 200:
                raise SmokeFailure(f"{method} {path}: HTTP {response.status_code}; inspect server logs using request ID {response.headers.get('x-request-id', 'unavailable')}")
            return response
        signed_in = False
        try:
            response = request("POST", "auth/login", payload={"login": login, "password": password})
            password = None
            signed_in = True
            cookie = SimpleCookie()
            for header in (response.headers.get_all("set-cookie") or []):
                cookie.load(header)
            refresh = cookie.get("dmb_refresh")
            if not refresh or not refresh["httponly"] or refresh["samesite"].lower() != "strict" or refresh["path"] != "/api/v1/auth":
                raise SmokeFailure("Refresh cookie is missing or has unexpected attributes")
            if origin.startswith("https://") and not refresh["secure"]:
                raise SmokeFailure("HTTPS stand returned a refresh cookie without Secure")
            token_data = response.json()
            client.headers["Authorization"] = "Bearer " + token_data["access_token"]
            expiry_seconds = token_data["expires_in"]
            profile = request("GET", "auth/me").json()
            if expect_admin and profile.get("permissions", {}).get("admin") != "full":
                raise SmokeFailure("The supplied account does not have admin=full")
            if profile.get("permissions", {}).get("admin") == "full":
                for path in ("admin/users", "admin/roles", "admin/teams", "admin/projects", "admin/dict-locks"):
                    request("GET", path)
            reference = request("GET", "tasks/reference").json()
            required = ("priorities", "statuses", "task_types", "channels", "teams")
            empty = [key for key in required if not reference.get(key)]
            if empty:
                raise SmokeFailure("Required reference lists are empty: " + ", ".join(empty))
            if wait_expiry:
                time.sleep(expiry_seconds + 2)
                expired = client.get("/api/v1/auth/me")
                if expired.status_code != 401:
                    raise SmokeFailure("Expired access token did not return 401")
                checks.append({"method": "GET", "path": "auth/me (expired access)", "status": 401})
            token_data = request("POST", "auth/refresh").json()
            client.headers["Authorization"] = "Bearer " + token_data["access_token"]
            refreshed_profile = request("GET", "auth/me").json()
            if refreshed_profile.get("permissions") != profile.get("permissions"):
                raise SmokeFailure("Permissions changed between login and refresh")
            request("GET", "tasks/reference")
            return {"result": "passed", "checks": checks, "reference_counts": {key: len(reference.get(key, [])) for key in required},
                    "access_expiry_checked": wait_expiry}
        finally:
            password = None
            if signed_in:
                response = client.post("/api/v1/auth/logout")
                if response.status_code != 204:
                    raise SmokeFailure(f"Logout failed: HTTP {response.status_code}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--login", required=True)
    parser.add_argument("--ca-file", help="Trusted bank CA PEM file; TLS verification cannot be disabled")
    parser.add_argument("--wait-access-expiry", action="store_true", help="Wait one access-token lifetime before refresh")
    parser.add_argument("--expect-admin", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        check_origin(args.base_url)
        password = getpass.getpass("Password (not saved): ")
        try:
            result = run_smoke(args.base_url, args.login, password, ca_file=args.ca_file,
                wait_expiry=args.wait_access_expiry, expect_admin=args.expect_admin)
        finally:
            password = None
    except (SmokeFailure, urllib.error.URLError, OSError, ValueError) as exc:
        # HTTP exception strings can contain full URLs. Never echo request bodies.
        result = {"result": "failed", "error": str(exc) if isinstance(exc, SmokeFailure) else type(exc).__name__}
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if result["result"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
