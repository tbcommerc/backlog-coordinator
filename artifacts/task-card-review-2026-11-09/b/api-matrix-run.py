"""Read-only task-card QA access matrix. Credentials and auth bodies never logged."""
import json
import urllib.request
import urllib.error
import http.cookiejar
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:8000'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def client():
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def request(opener, path, method='GET', body=None, token=None):
    assert path.startswith('/') and not path.startswith('//')
    headers = {'Origin': BASE, 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with opener.open(req, timeout=20) as response:
            data = response.read()
            return response.status, json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        return error.code, None

health, _ = request(client(), '/api/v1/health')
if health != 200:
    raise SystemExit('Local health preflight failed: ' + str(health))

accounts = json.loads((ROOT / '.runtime/test-accounts.json').read_text(encoding='utf-8-sig'))['accounts']
profiles = [a for a in accounts if a.get('is_active') is True and a.get('credential_state') == 'ready']
endpoints = [('task', ''), ('comments', '/comments'), ('attachments', '/attachments'), ('reporting', '/reporting-statuses/context'), ('work', '/work-tasks')]
results = []
for account in profiles:
    opener = client()
    token = None
    row = {'profile': account['profile'], 'expected_team_id': account.get('team_id'), 'checks': {}}
    try:
        status, auth = request(opener, '/api/v1/auth/login', 'POST', {'login': account['login'], 'password': account['password']})
        row['login'] = status
        if status == 200:
            token = auth.get('access_token')
            auth = None
            status, me = request(opener, '/api/v1/auth/me', token=token)
            row['me'] = status
            row['identity_matches'] = bool(me and me.get('id') == account.get('user_id'))
            row['team_matches'] = bool(me and me.get('team_id') == account.get('team_id'))
            row['customer_binding_matches'] = bool(me and me.get('business_customer_id') == account.get('business_customer_id'))
            me = None
            for task_id in (327, 326):
                checks = {}
                for name, suffix in endpoints:
                    status, data = request(opener, f'/api/v1/tasks/{task_id}' + suffix, token=token)
                    checks[name] = status
                    if name == 'task' and status == 200 and isinstance(data, dict):
                        row.setdefault('task_context', {})[str(task_id)] = {k: data.get(k) for k in ('id', 'team_id', 'business_customer_id')}
                    data = None
                row['checks'][str(task_id)] = checks
    except Exception as error:
        row['error_type'] = type(error).__name__
    finally:
        if token:
            try:
                row['logout'], _ = request(opener, '/api/v1/auth/logout', 'POST', token=token)
                row['me_after_logout'], _ = request(opener, '/api/v1/auth/me', token=token)
            except Exception as error:
                row['logout_error_type'] = type(error).__name__
        token = None
        opener = None
        results.append(row)
        (OUT / 'api-matrix.json').write_text(json.dumps({'created_at': datetime.now(timezone.utc).isoformat(), 'base': BASE, 'results': results}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(account['profile'] + ': login=' + str(row.get('login')) + ', logout=' + str(row.get('logout')), flush=True)
accounts = profiles = account = None

lines = ['# Read-only API matrix — 09.11.2026', '', 'Только штатный login/logout и GET; отдельные HTTP-сессии, браузерный профиль не менялся. Значения секретов и тела объектов не сохранены. Порядок кодов: task / comments / attachments / reporting-context / work-tasks.', '', '| Профиль | Вход/me | Task327 | Task326 | Logout/me после |', '|---|---|---|---|---|']
for r in results:
    def cells(task):
        return '/'.join(str(r.get('checks', {}).get(str(task), {}).get(n, '—')) for n, _ in endpoints)
    lines.append(f"| {r['profile']} | {r.get('login')}/{r.get('me', '—')} | {cells(327)} | {cells(326)} | {r.get('logout', '—')}/{r.get('me_after_logout', '—')} |")
lines += ['', 'HTTP 200 подтверждает чтение; 403/404 фиксируются как фактическая граница доступа, без вывода о дефекте до сверки ACL. Записи327/326 не изменялись этим прогоном. Отрицательные credential profiles не использовались.', '', 'JSON содержит только коды, контроль identity/team/customer-binding и идентификаторы команд/заказчиков задач; паролей, cookies, токенов и пользовательского содержимого нет.']
(OUT / 'api-matrix.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
