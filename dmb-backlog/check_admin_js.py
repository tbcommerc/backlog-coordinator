import urllib.request, json, sys

BASE = 'http://localhost:8000'

try:
    r = urllib.request.urlopen(f'{BASE}/static/js/components/admin.js', timeout=10)
    content = r.read().decode('utf-8', errors='replace')
    print(f'admin.js loaded: {len(content)} bytes')
except Exception as e:
    print(f'Failed to load admin.js: {e}')
    sys.exit(1)

# Check key patterns
checks = [
    ('adminData.taskTypes', 'adminData.taskTypes'),
    ('adminData.channels', 'adminData.channels'),
    ('adminData.deadlines', 'adminData.deadlines'),
    ('adminData.departments', 'adminData.departments'),
    ('adminData.teamTypes', 'adminData.teamTypes'),
    ('adminData.projectStatuses', 'adminData.projectStatuses'),
    ('taskTypes in dicts array', 'key: \'taskTypes\''),
    ('channels in dicts array', 'key: \'channels\''),
    ('deadlines in dicts array', 'key: \'deadlines\''),
    ('departments in dicts array', 'key: \'departments\''),
    ('teamTypes in dicts array', 'key: \'teamTypes\''),
    ('projectStatuses in dicts array', 'key: \'projectStatuses\''),
    ('priority in VALID_DICT_TYPES', '\'priority\''),
    ('status in VALID_DICT_TYPES', '\'status\''),
    ('task_type in VALID_DICT_TYPES', '\'task_type\''),
    ('channel in VALID_DICT_TYPES', '\'channel\''),
    ('deadline in VALID_DICT_TYPES', '\'deadline\''),
    ('department in VALID_DICT_TYPES', '\'department\''),
    ('team_type in VALID_DICT_TYPES', '\'team_type\''),
    ('project_status in VALID_DICT_TYPES', '\'project_status\''),
]

for label, pattern in checks:
    found = pattern in content
    status = 'MISSING!' if not found else 'OK'
    print(f'[{status}] {label}')

# Check for duplicate definitions
import re
for func in ['initAdmin', 'renderDictionariesTab', 'openDictModal', 'saveDictData']:
    matches = list(re.finditer(rf'(async )?function {func}\b', content))
    print(f'  function {func}: {len(matches)} definition(s)')

# Check adminTab default
if 'adminTab =' in content:
    import re
    match = re.search(r"adminTab\s*=\s*'([^']+)'", content)
    if match:
        print(f'  adminTab default: {match.group(1)}')
