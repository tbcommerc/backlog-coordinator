from test_work_tasks import row, user
from services import work_tasks as work
from work_contract import Transition
from fastapi import HTTPException
import pytest

def test_acceptance_preserves_result_revision_and_rejects_rewrite():
    task = row(status='in_acceptance', acceptance_required=True, result_revision=4)
    acceptor = user(3, scope='none')
    values = work.transition_values(task, acceptor, Transition(version=1,status='done'))
    assert values['result_text'] == task.result_text
    assert 'result_revision' not in values
    assert 'done' in work.available_actions(task, acceptor)
    with pytest.raises(HTTPException) as error:
        work.transition_values(task, acceptor, Transition(version=1,status='done',result_text='Подмена'))
    assert error.value.status_code == 422
