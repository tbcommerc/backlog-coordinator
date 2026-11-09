import asyncio
import logging
import time
import uuid
from contextlib import suppress
from dmb_agent_contracts.runtime import AsyncRuntimePort
from dmb_agent_contracts.operation import operation_scope,current_operation
from dmb_agent_contracts.model import AgentError
from datetime import datetime,timedelta,timezone
from sqlalchemy import select, update, delete
from contracts.models import Answer, Context, DataBlock
from bridge.tools import ToolBridge
from backlog_assistant.store import StoreError, runs, sessions, outbox


def fallback_candidate(bridge, context):
    sources = {s.source_id: s for result in bridge.results for s in result.sources}
    return Answer(kind="partial", context=Context.model_validate(context),
        as_of=bridge.results[-1].observed_at, sources=list(sources.values()),
        data_blocks=[DataBlock(type="table", server_result_ref=r.snapshot_ref) for r in bridge.results],
        coverage=bridge.results[-1].coverage, limitations=["Пояснение недоступно; показаны проверенные серверные данные."])


class Worker:
    def __init__(self, store, data, runtime: AsyncRuntimePort):
        self.store, self.data, self.runtime = store, data, runtime
        self.id = str(uuid.uuid4())

    async def execute(self, row):
        from dmb_agent_contracts.run_store import Store as TechnicalStore
        from .runs import execution_profile
        try:
            technical = TechnicalStore(self.store.engine).get(row["id"])
        except AgentError as error:
            if error.code != "run_not_found":
                raise
            technical = None  # Transitional legacy runs have no common envelope.
        if technical is not None and technical["profile"] != execution_profile(self.runtime):
            self.store.save(row["id"], self.id, status="failed",stage="failed",error_code="runtime_profile_changed")
            return
        queue_deadline=datetime.fromtimestamp(row["created"]+15,timezone.utc)
        deadline=datetime.fromtimestamp(row["created"]+75,timezone.utc)
        try:
            with operation_scope(run_id=row["id"],deadline_at=deadline,max_model_attempts=4,
                    actor_ref=row["owner"],queue_deadline_at=queue_deadline,acquire_gate=False) as context:
                async def waiting_heartbeat():
                    while True:
                        self.store.heartbeat(row["id"],self.id)
                        await asyncio.sleep(1)
                pulse=asyncio.create_task(waiting_heartbeat())
                acquire=asyncio.create_task(asyncio.to_thread(context.acquire_slot))
                try:
                    done,_=await asyncio.wait({pulse,acquire},return_when=asyncio.FIRST_COMPLETED)
                    for finished in done:
                        await finished
                finally:
                    pulse.cancel()
                    with suppress(asyncio.CancelledError,Exception):
                        await pulse
                    if not acquire.done():
                        context.cancel()
                        with suppress(asyncio.CancelledError,Exception):
                            await acquire
                context.tighten(datetime.now(timezone.utc)+timedelta(seconds=60))
                self.store.save(row["id"], self.id, stage="preparing")
                cleanup_token = context.hold_slot_for_cleanup()
                return await self._execute(row, cleanup_token=cleanup_token)
        except AgentError as error:
            if error.code.startswith(("global_limiter_","operation_queue_")) or error.code=="actor_queue_full":
                self.store.defer(row["id"],self.id,error.code)
                return "deferred"
            raise

    async def _execute(self, row, cleanup_token=None):
        rid, execution = row["id"], row["execution_ref"]
        handle, grant, bridge, answer, error = None, None, None, None, None
        deadline = time.monotonic() + 60
        async def heartbeat():
            while True:
                self.store.heartbeat(rid, self.id)
                await asyncio.sleep(1)

        async def work():
            nonlocal grant, handle, bridge, answer
            grant = await self.data.activate(execution, self.id)
            catalog = await self.data.catalog(execution, grant)
            bridge = ToolBridge(self.data, execution, grant, catalog, deadline=deadline, request_text=row["input"]["text"])
            self.store.save(rid, self.id, handle={"instance": execution, "session": None, "run_id":rid})
            handle = await self.runtime.prepare({"execution_ref": execution, "deadline": deadline, "run_id":str(current_operation().run_id),
                "tool_hash": bridge.catalog_hash, "profile_ref":getattr(self.runtime,"profile_ref",None)}, bridge, Answer.model_json_schema())
            dispatch = str(uuid.uuid4())
            # Durable intent precedes sending; only sanitized refs, no credentials.
            self.store.save(rid, self.id, handle=handle, dispatch_ref=dispatch, dispatch_state="dispatching")
            envelope = {"text": row["input"]["text"], "context": row["input"]["context"]}
            previous = [r for r in self.store.session(row["owner"], row["session_id"])["runs"]
                        if r["id"] != rid and r.get("receipts") and r.get("answer")]
            if previous and hasattr(self.data, "conversation"):
                try:
                    envelope["conversation"] = await self.data.conversation(execution, grant, previous[-1]["receipts"])
                except Exception:
                    envelope["conversation"] = {"unavailable": True, "instruction": "Ask for clarification; previous scope is unavailable."}
            accepted = await self.runtime.submit(handle, envelope, dispatch)
            self.store.save(rid, self.id, dispatch_state=accepted, stage="preparing_answer")
            while True:
                await bridge.check()
                state = await self.runtime.inspect(handle)
                if state == "completed":
                    break
                if state in {"failed", "cancelled"}:
                    raise StoreError("runtime_failed")
                await asyncio.sleep(0.2)
            candidate = Answer.model_validate(await self.runtime.collect(handle))
            if candidate.context.model_dump(mode="json") != row["input"]["context"]:
                raise ValueError("candidate_context_mismatch")
            source_refs = {s.receipt_ref for s in candidate.sources}
            if source_refs - set(bridge.receipts):
                raise ValueError("unknown_receipt")
            self.store.save(rid, self.id, stage="verifying", receipts=bridge.receipts)
            # Includes every receipt the runtime has seen, not merely final citations.
            answer = await self.data.verify(execution, grant, candidate, bridge.receipts)

        pulse, task = asyncio.create_task(heartbeat()), asyncio.create_task(work())
        try:
            done, _ = await asyncio.wait({pulse, task}, timeout=50, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                raise TimeoutError()
            for finished in done:
                await finished
        except asyncio.CancelledError:
            error = "interrupted"
        except StoreError as exc:
            error = "cancelled" if exc.code == "cancelled" else "interrupted"
        except TimeoutError:
            error = "expired"
        except Exception as exc:
            logging.getLogger("backlog.worker").error("Run failed: %s%s", type(exc).__name__, ": " + str(exc) if type(exc) is ValueError else "")
            error = "failed"
        finally:
            if error:
                current_operation().cancel()
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
            if error in {"failed", "interrupted", "expired"} and bridge and bridge.failure not in {"source_access_denied", "provider_auth_failed", "provider_quota_exhausted"} and bridge.results and time.monotonic() < deadline:
                # Deterministic fallback from server results only; no second LLM planner.
                try:
                    await self.data.check(execution, grant)
                    candidate = fallback_candidate(bridge, row["input"]["context"])
                    answer = await self.data.verify(execution, grant, candidate, bridge.receipts)
                    error = None
                except Exception:
                    pass
            cleanup_ok = True
            # Revoke access BEFORE trying abort; failure does not restore publication.
            if grant:
                try:
                    await self.data.revoke(execution, grant)
                except Exception:
                    cleanup_ok = False
            if handle:
                if error:
                    with suppress(Exception):
                        await self.runtime.cancel(handle)
                try:
                    await self.runtime.dispose(handle)
                except Exception:
                    cleanup_ok = False
            elif bridge:
                # prepare may have been interrupted after a process was created.
                try:
                    await self.runtime.dispose({"instance": execution, "session": None, "run_id":rid})
                except Exception:
                    cleanup_ok = False
            pulse.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await pulse
            if cleanup_ok:
                current_operation().confirm_cleanup(cleanup_token)
            try:
                self.store.save(rid, self.id, status=error or ("partial" if answer.get("kind") == "partial" else "completed"),
                    stage="done", answer=None if error else answer, receipts=bridge.receipts if bridge else [],
                    error_code=(bridge.failure if error and bridge and bridge.failure in
                        {"provider_auth_failed","provider_quota_exhausted"} else error), cleanup_pending=not cleanup_ok)
            except StoreError:
                # A concurrent cancellation always wins over publication.
                with self.store.engine.begin() as c:
                    c.execute(update(runs).where(runs.c.id == rid, runs.c.lease_owner == self.id,
                        runs.c.status.in_(("running", "cancelling"))).values(status="interrupted", answer=None,
                        error_code="interrupted", cleanup_pending=not cleanup_ok))

    async def janitor(self):
        from dmb_agent_contracts.run_store import Store as RunStore, runs as facade_runs
        RunStore(self.store.engine).expire()
        with self.store.engine.begin() as c:
            expired = c.execute(select(runs).join(facade_runs, facade_runs.c.id == runs.c.id).where(
                facade_runs.c.result_expired == 1, runs.c.status.not_in(("queued", "running", "cancelling")),
                runs.c.answer.is_not(None)).with_for_update()).mappings().all()
            for row in expired:
                if row["receipts"]:
                    c.execute(outbox.insert().values(id=str(uuid.uuid4()), owner=row["owner"], receipts=row["receipts"]))
                c.execute(update(runs).where(runs.c.id == row["id"]).values(answer=None, input={}, receipts=[]))
        with self.store.engine.connect() as c:
            dirty = [dict(r) for r in c.execute(select(runs).where(runs.c.cleanup_pending.is_(True))).mappings()]
            pending = [dict(r) for r in c.execute(select(outbox)).mappings()]
            stale = [dict(r) for r in c.execute(select(sessions).where(sessions.c.updated < time.time()-30*86400)).mappings()]
        for row in dirty:
            try:
                # Service-auth may revoke its own execution even after grant expiry.
                await self.data.revoke(row["execution_ref"], "")
                if row["handle"]:
                    await self.runtime.dispose({**row["handle"], "run_id":row["id"]})
                from dmb_agent_contracts.limiter import from_environment
                limiter=from_environment()
                if limiter is not None:
                    limiter.confirm_run_cleanup(row["id"])
                with self.store.engine.begin() as c:
                    c.execute(update(runs).where(runs.c.id == row["id"]).values(cleanup_pending=False))
            except Exception:
                pass
        for row in stale:
            with suppress(StoreError):
                self.store.remove(row["owner"], row["id"])
        for row in pending:
            try:
                await self.data.purge(row["owner"], row["receipts"])
                with self.store.engine.begin() as c:
                    c.execute(delete(outbox).where(outbox.c.id == row["id"]))
            except Exception:
                pass

    async def run(self):
        while True:
            await self.janitor()
            row = self.store.claim(self.id)
            if row:
                if await self.execute(row)=="deferred":
                    await asyncio.sleep(1)
            else:
                await asyncio.sleep(0.5)
