import pytest
from pydantic import ValidationError

from schemas import TaskLinkUpdate, TaskUpdate


@pytest.mark.parametrize("url", [
    "https://jira.example.com/ABC-1",
    "http://intranet.example.local/mockup",
])
def test_http_links_are_allowed(url):
    assert TaskLinkUpdate(link_mockups=url, version=0).link_mockups == url


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "//example.com/path",
    "not-a-url",
])
def test_unsafe_link_protocols_are_rejected(url):
    with pytest.raises(ValidationError):
        TaskLinkUpdate(link_jira=url, version=0)


def test_all_task_link_fields_are_validated():
    with pytest.raises(ValidationError):
        TaskUpdate(link_mockups="javascript:alert(1)", version=0)
    with pytest.raises(ValidationError):
        TaskUpdate(link_jira=["https://jira.example.com/OK", "data:text/html,bad"], version=0)
    with pytest.raises(ValidationError):
        TaskUpdate(link_requirements=["file:///secret"], version=0)
