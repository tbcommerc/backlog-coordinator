"""Logical model-operation context, independent of HTTP, ORM and domain flows.

The owner may provide a durable run ID/deadline/budget. Nested calls share it;
transport retries reserve attempts at the actual HTTP boundary. Merely creating
a ModelRequest or returning a cached result does not spend an attempt.
"""
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial, wraps
from inspect import iscoroutinefunction,isgeneratorfunction,isasyncgenfunction
from threading import RLock, Lock
from uuid import UUID, uuid4
import time

from .model import AgentError


@dataclass
class OperationContext:
    run_id: UUID
    deadline_at: datetime | None = None
    max_model_attempts: int | None = None
    actor_ref: str = "legacy"
    queue_deadline_at: datetime | None = None
    _attempts: int = field(default=0, init=False, repr=False)
    _cancelled: bool = field(default=False, init=False, repr=False)
    _finished: bool = field(default=False, init=False, repr=False)
    _lock: RLock = field(default_factory=RLock, init=False, repr=False)
    _lease_lock: Lock = field(default_factory=Lock, init=False, repr=False)
    _lease: object = field(default=None, init=False, repr=False)
    _cleanup_pending: bool = field(default=False, init=False, repr=False)
    _cleanup_refs: set = field(default_factory=set, init=False, repr=False)
    release_pending: bool = field(default=False, init=False)
    _last_lease_check: float = field(default=0, init=False, repr=False)
    _physical_activities: int = field(default=0, init=False, repr=False)

    def __post_init__(self):
        self.run_id=UUID(str(self.run_id))
        deadline,limit=self.deadline_at,self.max_model_attempts
        self.deadline_at,self.max_model_attempts=None,None
        self.tighten(deadline,limit)

    def tighten(self, deadline_at=None, max_model_attempts=None):
        if deadline_at is not None:
            if deadline_at.tzinfo is None:
                raise ValueError("operation deadline requires timezone")
            deadline_at=deadline_at.astimezone(timezone.utc)
        if max_model_attempts is not None and (isinstance(max_model_attempts,bool) or not isinstance(max_model_attempts,int) or max_model_attempts < 1):
            raise ValueError("model attempt budget must be positive")
        with self._lock:
            if deadline_at is not None:
                self.deadline_at=min(self.deadline_at,deadline_at) if self.deadline_at else deadline_at
            if max_model_attempts is not None:
                self.max_model_attempts=min(self.max_model_attempts,max_model_attempts) if self.max_model_attempts else max_model_attempts

    @property
    def model_attempts(self):
        with self._lock:
            return self._attempts

    def cancel(self):
        with self._lock:
            self._cancelled=True

    def finish(self):
        with self._lock:
            self._finished=True
            if self._lease is not None:
                if self._cleanup_pending or self._physical_activities:
                    kind="runtime_http" if self._cleanup_pending and self._physical_activities else "runtime" if self._cleanup_pending else "http"
                    self._lease.hold_for_cleanup(kind)
                    self.release_pending = True
                    return
                self._release_slot()

    def _release_slot(self):
        try:
            self._lease.release()
            self.release_pending = False
        except AgentError:
            self.release_pending = True

    def begin_activity(self, *, cleanup=False):
        with self._lock:
            if cleanup:
                if not self._cleanup_pending:
                    raise AgentError("cleanup_scope_required",503)
            else:
                self.check()
            self._physical_activities += 1
            if self._lease is not None:
                try:
                    self._lease.write("runtime_http_cleanup_pending" if self._cleanup_pending else "http_active")
                except BaseException:
                    self._physical_activities -= 1
                    raise

    def end_activity(self):
        with self._lock:
            self._physical_activities -= 1
            if self._physical_activities==0 and self._lease is not None:
                if self._finished:
                    if self._cleanup_pending:
                        self._lease.hold_for_cleanup()
                    else:
                        self._lease.confirm_cleanup()
                        self._release_slot()
                else:
                    self._lease.write("resource_cleanup_pending" if self._cleanup_pending else "active")

    def acquire_slot(self):
        from .limiter import from_environment
        with self._lease_lock:
            if self._lease is None:
                limiter = from_environment()
                if limiter is not None:
                    self.check()
                    if self.queue_deadline_at is not None:
                        from dataclasses import replace
                        from .limiter import RedisLimiter
                        remaining = (self.queue_deadline_at-datetime.now(timezone.utc)).total_seconds()
                        if remaining <= 0:
                            raise AgentError("operation_queue_timeout", 429)
                        limiter = RedisLimiter(replace(limiter.config, queue_seconds=min(limiter.config.queue_seconds, remaining)))
                    limiter.recover_confirmed()
                    lease = limiter.acquire(self.run_id, self.actor_ref, self.check)
                    with self._lock:
                        if self._finished:
                            lease.release()
                            raise AgentError("operation_already_finished", 409)
                        self._lease = lease

    def check_slot(self, force=False):
        if self._lease is not None and (force or time.monotonic()-self._last_lease_check >= .25):
            self._lease.check()
            self._last_lease_check = time.monotonic()

    def hold_slot_for_cleanup(self):
        with self._lock:
            token = uuid4().hex
            self._cleanup_refs.add(token)
            self._cleanup_pending = True
            if self._lease is not None:
                self._lease.hold_for_cleanup("runtime_http" if self._physical_activities else "runtime")
            return token

    def confirm_cleanup(self, token=None):
        with self._lock:
            if token is None:
                if len(self._cleanup_refs) > 1:
                    raise AgentError("cleanup_scope_required", 503)
                self._cleanup_refs.clear()
            elif token not in self._cleanup_refs:
                raise AgentError("cleanup_scope_mismatch", 503)
            else:
                self._cleanup_refs.remove(token)
            self._cleanup_pending = bool(self._cleanup_refs)
            if self._lease is not None:
                if self._cleanup_pending:
                    self._lease.hold_for_cleanup("runtime_http" if self._physical_activities else "runtime")
                elif self._physical_activities:
                    self._lease.hold_for_cleanup("http")
                else:
                    self._lease.cleanup_pending = False
                    self._lease.write("cleanup_confirmed" if self._finished else "cleanup_ready")
                    if self._finished:
                        self._release_slot()

    def check(self):
        with self._lock:
            if self._finished:
                raise AgentError("operation_already_finished",409)
            if self._cancelled:
                raise AgentError("cancelled",409)
            if self.deadline_at and datetime.now(timezone.utc)>=self.deadline_at:
                raise AgentError("operation_deadline_exceeded",504)

    def reserve_model_attempt(self):
        self.acquire_slot()
        with self._lock:
            self.check()
            self.check_slot(force=True)
            if self.max_model_attempts is not None and self._attempts>=self.max_model_attempts:
                raise AgentError("local_budget_exceeded",429)
            self._attempts+=1
            return self._attempts


_current: ContextVar[OperationContext | None]=ContextVar("dmb_agent_operation",default=None)


def current_operation():
    return _current.get()


@contextmanager
def operation_scope(*,run_id=None,deadline_at=None,max_model_attempts=None,context=None,actor_ref=None,acquire_gate=True,queue_deadline_at=None):
    existing=current_operation()
    if context is not None and not isinstance(context,OperationContext):
        raise ValueError("invalid operation context")
    if existing is not None and context is not None and existing is not context:
        raise AgentError("operation_context_conflict",409)
    if existing is not None:
        if run_id is not None and existing.run_id!=UUID(str(run_id)):
            raise AgentError("operation_context_conflict",409)
        existing.tighten(deadline_at,max_model_attempts)
        yield existing
        return
    owns_context=context is None
    context=context or OperationContext(UUID(str(run_id)) if run_id is not None else uuid4(), actor_ref=actor_ref or "legacy", queue_deadline_at=queue_deadline_at)
    if run_id is not None and context.run_id!=UUID(str(run_id)):
        raise AgentError("operation_context_conflict",409)
    context.tighten(deadline_at,max_model_attempts)
    token=_current.set(context)
    try:
        if owns_context and acquire_gate:
            context.acquire_slot()
        yield context
    finally:
        if owns_context:
            context.finish()
        _current.reset(token)


def bind_request(request):
    """Keep caller subrequest identity; bind the logical run and narrower deadline."""
    context=current_operation()
    if context is None:
        return request
    context.check()
    deadline=min(request.deadline_at,context.deadline_at) if context.deadline_at else request.deadline_at
    return request.model_copy(update={"run_id":context.run_id,"deadline_at":deadline})


def reserve_model_attempt():
    context=current_operation()
    return context.reserve_model_attempt() if context is not None else None


def check_operation():
    context=current_operation()
    if context is not None:
        context.check()
        context.check_slot()


@contextmanager
def physical_activity():
    """A cancelled owner retains its slot until its actual HTTP work is closed."""
    context=current_operation()
    if context is not None:
        context.begin_activity()
    try:
        yield
    finally:
        if context is not None:
            context.end_activity()


def submit_in_operation(executor,function,*args,**kwargs):
    # A separate Context copy is required for every simultaneous executor task;
    # the shared OperationContext itself serializes counter/cancel access.
    return executor.submit(copy_context().run,partial(function,*args,**kwargs))


def model_operation(function):
    """Attach context without changing a domain function's signature or workflow."""
    if isgeneratorfunction(function) or isasyncgenfunction(function):
        raise ValueError("streaming operation requires an explicit operation_scope")
    if iscoroutinefunction(function):
        @wraps(function)
        async def asynchronous(*args,**kwargs):
            import asyncio
            with operation_scope(acquire_gate=False) as context:
                await asyncio.to_thread(context.acquire_slot)
                return await function(*args,**kwargs)
        return asynchronous
    @wraps(function)
    def synchronous(*args,**kwargs):
        with operation_scope():
            return function(*args,**kwargs)
    return synchronous


def limit_timeout(seconds):
    context=current_operation()
    if context is None:
        return seconds
    context.check()
    if context.deadline_at is not None:
        return min(seconds,max(0.0,(context.deadline_at-datetime.now(timezone.utc)).total_seconds()))
    return seconds


@contextmanager
def runtime_cleanup_scope():
    """Bounded abort/delete may run after cancellation, retaining the owner slot.

    This scope is restricted to cleanup transport code. It never authorizes a
    model request or changes the cancelled operation's publication fence.
    """
    context = current_operation()
    if context is None or not context._cleanup_pending:
        yield
        return
    context.begin_activity(cleanup=True)
    token = _current.set(None)
    try:
        yield
    finally:
        _current.reset(token)
        context.end_activity()
