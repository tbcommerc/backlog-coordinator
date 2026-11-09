"""Review regressions; no protected records are created or changed."""
from datetime import date
from project_tests.test_project_workspace import db, user
from services import project_management as service


def projection(id, end, owner='Анна', team='Команда А'):
    return dict(id=id, public_id=f'TASK-{id}', kind='backlog', title=f'Работа {id}',
                owner=owner, team=team, status='В работе', status_code='in_progress',
                spans=[dict(start=date(2026, 1, 1), end=end)], issues=['overdue'],
                is_milestone=False, milestone_on=None, can_edit=False)


def test_attention_order_and_days_are_identical_in_overview_and_full(db, monkeypatch):
    monkeypatch.setattr(service, 'today', lambda: date(2026, 11, 3))
    monkeypatch.setattr(service, 'task_rows', lambda *a: [projection(1,date(2026,9,30)),projection(2,date(2026,6,30))])
    monkeypatch.setattr(service, 'work_issues', lambda *a: [])
    overview=service.management(db,user(),7,2026,4)
    full=service.management(db,user(),7,2026,4,view='deviations')
    assert [r['id'] for r in overview['attention']]==[r['id'] for r in full['items']]==[2,1]
    assert full['items'][0]['overdue_days']==126


def test_plan_filters_sort_and_paging_are_applied_before_slice(db, monkeypatch):
    rows=[projection(i,date(2026,6,30),'Анна' if i%2 else 'Борис') for i in range(1,66)]
    monkeypatch.setattr(service,'task_rows',lambda *a:rows)
    monkeypatch.setattr(service,'work_issues',lambda *a:[])
    result=service.management(db,user(),7,2026,4,horizon='all',page=2,owner='Анна',team='Команда А',state='В работе',sort='due')
    assert result['total']==33 and result['page']==2
    assert [r['id'] for r in result['items']]==[61,63,65]
    assert result['filter_options']['owners']==['Анна','Борис']
    assert service.management(db,user(),7,2026,4,horizon='all',q='no-match')['total']==0
