from datetime import datetime, timezone
from types import SimpleNamespace

from routers.task_collaboration_router import _comment_response


def test_new_and_idempotently_retrieved_comments_have_empty_reply_list():
    comment = SimpleNamespace(id=1, task_id=2, user_id=3, text='Synthetic comment',
                              mentioned_user_ids='[3]', parent_id=None,
                              created_at=datetime.now(timezone.utc))
    response = _comment_response(comment, 'QA')
    assert response.replies == []
    assert response.mentioned_user_ids == [3]
    assert response.model_dump(mode='json')['replies'] == []


def test_explicit_replies_are_preserved():
    comment = SimpleNamespace(id=1, task_id=2, user_id=3, text='Synthetic comment',
                              mentioned_user_ids=None, parent_id=None,
                              created_at=datetime.now(timezone.utc))
    child = _comment_response(comment, 'QA')
    parent = _comment_response(comment, 'QA', [child])
    assert parent.replies == [child]
