import urllib.request, json, sys

BASE = 'http://localhost:7777/api/v1'

try:
    req = urllib.request.Request(f'{BASE}/auth/login',
        data=json.dumps({'email':'t.babiak@dmb.ru','password':'dmb2026'}).encode(),
        headers={'Content-Type':'application/json'}, method='POST')
    r = urllib.request.urlopen(req, timeout=10)
    token = json.loads(r.read())['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    print('LOGIN_OK')
except Exception as e:
    print(f'Login error: {e}')
    sys.exit(1)

# Check all dict endpoints with full content
dict_endpoints = {
    'priorities': 'priority',
    'statuses': 'status',
    'task-types': 'task_type',
    'channels': 'channel',
    'deadlines': 'deadline',
    'departments': 'department',
    'team-types': 'team_type',
    'project-statuses': 'project_status',
}

for ep, dt in dict_endpoints.items():
    try:
        req = urllib.request.Request(f'{BASE}/admin/{ep}', headers=headers)
        r = urllib.request.urlopen(req, timeout=10)
        data = json.loads(r.read())
        print(f'\n/admin/{ep} -> count={len(data)}')
        for item in data:
            print(f'  id={item["id"]} name="{item["name"]}" dict_type="{item["dict_type"]}" code="{item.get("code")}" active={item.get("is_active")}')
    except Exception as e:
        print(f'\n/admin/{ep}: ERROR: {e}')

# Check dict-locks
try:
    req = urllib.request.Request(f'{BASE}/admin/dict-locks', headers=headers)
    r = urllib.request.urlopen(req, timeout=10)
    locks = json.loads(r.read())
    print(f'\n/admin/dict-locks: {json.dumps(locks, indent=2, ensure_ascii=False)}')
except Exception as e:
    print(f'/admin/dict-locks: ERROR: {e}')
