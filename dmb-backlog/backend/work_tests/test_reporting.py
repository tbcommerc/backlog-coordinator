from services.work_reporting import metrics

def test_metrics_keep_cancelled_out_of_risks_and_do_not_average_progress():
    rows=[{'status':'done','due_date':'2020-01-01','blocked_reason':'old','assignment_state':'accepted'},
          {'status':'cancelled','due_date':'2020-01-01','blocked_reason':'old','assignment_state':'proposed'},
          {'status':'in_acceptance','due_date':'2020-01-01','blocked_reason':'wait','assignment_state':'accepted'}]
    result=metrics(rows,'2026-10-16')
    assert result == {'total':3,'active':1,'done':1,'overdue':1,'in_acceptance':1,'proposals':0}
    assert 'progress' not in result and 'effect' not in result
