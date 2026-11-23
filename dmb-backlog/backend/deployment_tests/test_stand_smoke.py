import json
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest
from stand_smoke import check_origin, run_smoke, SmokeFailure


@pytest.mark.parametrize("url", ["http://bank.internal", "https://user:pass@bank.internal", "https://bank.internal/app", "https://bank.internal?token=x"])
def test_smoke_rejects_insecure_or_ambiguous_destinations(url):
    with pytest.raises(SmokeFailure):
        check_origin(url)


@contextmanager
def stand(redirect=False):
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            self.respond()
        def do_POST(self):
            self.respond()
        def respond(self):
            calls.append((self.command, self.path))
            data, status, cookie = [], 200, False
            if self.path.endswith('/login'):
                assert json.loads(self.rfile.read(int(self.headers['Content-Length'])))['password'] == 'secret-password'
                if redirect:
                    self.send_response(307)
                    self.send_header('Location', 'https://other.invalid/login')
                    self.end_headers()
                    return
                data, cookie = {'access_token': 'secret-access', 'expires_in': 300}, True
            elif self.path.endswith('/refresh'):
                assert 'dmb_refresh=secret-cookie' in self.headers['Cookie']
                data = {'access_token': 'fresh-secret-access'}
            elif self.path.endswith('/logout'):
                status = 204
            elif self.path.endswith('/me'):
                data = {'permissions': {'admin': 'full'}}
            elif self.path.endswith('/reference'):
                data = {key: [{'id': 1}] for key in ('priorities', 'statuses', 'task_types', 'channels', 'teams')}
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            if cookie:
                self.send_header('Set-Cookie', 'dmb_refresh=secret-cookie; HttpOnly; SameSite=Strict; Path=/api/v1/auth')
            self.end_headers()
            if status != 204:
                self.wfile.write(json.dumps(data).encode())
    server = HTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_smoke_checks_real_cookie_jar_and_refresh_without_disclosing_credentials():
    with stand() as (base_url, calls):
        result = run_smoke(base_url, 'demo.admin', 'secret-password', expect_admin=True)
        assert result['result'] == 'passed'
        assert ('POST', '/api/v1/auth/refresh') in calls
        assert calls[-1] == ('POST', '/api/v1/auth/logout')
        assert 'secret' not in json.dumps(result)


def test_smoke_refuses_redirect_instead_of_forwarding_credentials():
    with stand(redirect=True) as (base_url, calls):
        with pytest.raises(SmokeFailure, match='307'):
            run_smoke(base_url, 'demo.admin', 'secret-password')
        assert calls == [('POST', '/api/v1/auth/login')]
