"""Bounded legacy HTTP projection of an already durable service-owned run."""
from copy import deepcopy
from datetime import timezone
import time
from .model import AgentError
from .run_store import TERMINAL, now


def wait_result(store, row, *, interval=.1, on_status=None):
    """A disconnected waiter never cancels, dispatches or changes ownership.

    The service's persistent worker is the only executor. Reconnecting clients
    use their existing idempotency key; this waiter never extends the deadline.
    """
    previous = None
    while True:
        current = store.get(row['id'], row['caller'], row['actor'])
        if current['result_expired']:
            raise AgentError('result_expired', 410)
        if current['status'] == 'completed':
            if not isinstance(current.get('result'), dict) or 'payload' not in current['result']:
                raise AgentError('invalid_model_result', 502)
            return deepcopy(current['result']['payload'])
        if current['status'] in TERMINAL:
            code = current.get('error') or ('operation_cancelled' if current['status']=='cancelled' else 'operation_interrupted')
            raise AgentError(code, 409 if current['status']=='cancelled' or code=='source_revision_conflict' else 503)
        deadline = current['deadline_at']
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        if now() >= deadline:
            raise AgentError('operation_deadline_exceeded', 504)
        if on_status is not None and current['status'] != previous:
            on_status(current['status'])
            previous = current['status']
        time.sleep(min(interval, max(0, (deadline-now()).total_seconds())))
