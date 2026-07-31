import urllib.request, json

# Login with seed user
req = urllib.request.Request(
    'http://localhost:7777/api/v1/auth/login',
    data=json.dumps({'email':'t.babiak@dmb.ru', 'password':'dmb2026'}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
r = urllib.request.urlopen(req)
resp = json.loads(r.read())
token = resp['access_token']
print(f'Login OK, user: {resp.get("user",{}).get("name","?")}')
headers = {'Authorization': f'Bearer {token}'}

# Test all dict endpoints
endpoints = ['priorities', 'statuses', 'task-types', 'channels', 'deadlines', 'departments', 'team-types', 'project-statuses']
for ep in endpoints:
    try:
        req = urllib.request.Request(f'http://localhost:7777/api/v1/admin/{ep}', headers=headers)
        r = urllib.request.urlopen(req)
        data = json.loads(r.read())
        print(f'{ep}: status={r.status}, count={len(data)}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:300]
        print(f'{ep}: status={e.code}, body={body}')
