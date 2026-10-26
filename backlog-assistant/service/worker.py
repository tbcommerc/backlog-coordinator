import asyncio
import logging
import time
import uuid
from contextlib import suppress
from sqlalchemy import select, update, delete
from contracts.models import Answer, Context, DataBlock
from bridge.tools import ToolBridge
from service.store import StoreError, runs, sessions, outbox


def fallback_candidate(bridge, context):
    sources = {s.source_id: s for result in bridge.results for s in result.sources}
    return Answer(kind="partial", context=Context.model_validate(context),
        as_of=bridge.results[-1].observed_at, sources=list(sources.values()),
        data_blocks=[DataBlock(type="table", server_result_ref=r.snapshot_ref) for r in bridge.results],
        coverage=bridge.results[-1].coverage, limitations=["Пояснение недоступно; показаны проверенные серверные данные."])


class Worker:
    def __init__(self, store, data, runtime):
        self.store, self.data, self.runtime = store, data, runtime
        self.id = str(uuid.uuid4())

    async def execute(self, row):
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
            self.store.save(rid, self.id, handle={"instance": execution, "session": None})
            handle = await self.runtime.prepare({"execution_ref": execution, "deadline": deadline,
                "tool_hash": bridge.catalog_hash}, bridge, Answer.model_json_schema())
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
            task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await task
            if error in {"failed", "interrupted", "expired"} and bridge and bridge.failure != "source_access_denied" and bridge.results and time.monotonic() < deadline:
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
                    await self.runtime.dispose({"instance": execution, "session": None})
                except Exception:
                    cleanup_ok = False
            pulse.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await pulse
            try:
                self.store.save(rid, self.id, status=error or ("partial" if answer.get("kind") == "partial" else "completed"),
                    stage="done", answer=None if error else answer, receipts=bridge.receipts if bridge else [],
                    error_code=error, cleanup_pending=not cleanup_ok)
            except StoreError:
                # A concurrent cancellation always wins over publication.
                with self.store.engine.begin() as c:
                    c.execute(update(runs).where(runs.c.id == rid, runs.c.lease_owner == self.id,
                        runs.c.status.in_(("running", "cancelling"))).values(status="interrupted", answer=None,
                        error_code="interrupted", cleanup_pending=not cleanup_ok))

    async def janitor(self):
        with self.store.engine.connect() as c:
            dirty = [dict(r) for r in c.execute(select(runs).where(runs.c.cleanup_pending.is_(True))).mappings()]
            pending = [dict(r) for r in c.execute(select(outbox)).mappings()]
            stale = [dict(r) for r in c.execute(select(sessions).where(sessions.c.updated < time.time()-30*86400)).mappings()]
        for row in dirty:
            try:
                # Service-auth may revoke its own execution even after grant expiry.
                await self.data.revoke(row["execution_ref"], "")
                if row["handle"]:
                    await self.runtime.dispose(row["handle"])
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
                await self.execute(row)
            else:
                await asyncio.sleep(0.5)
