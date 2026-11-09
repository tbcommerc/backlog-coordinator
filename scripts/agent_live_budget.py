"""Process-safe finite live-call budget. Never resets previous authorizations."""
import json
import math
import os
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


@contextmanager
def locked(path):
    with Path(str(path)+".worker-lock").open("a+b") as stream:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        deadline = time.monotonic()+3
        while True:
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("live_budget_lock_unavailable") from None
                time.sleep(.01)
        yield


class LiveBudget:
    def __init__(self, path):
        self.path = Path(path).resolve(strict=True)

    def _read(self):
        value = json.loads(self.path.read_text(encoding="utf-8"))
        for field in ("max_calls", "max_seconds", "reserved_calls", "reserved_seconds"):
            if not isinstance(value.get(field), int) or value[field] < 0:
                raise RuntimeError("live_budget_invalid")
        return value

    def _write(self, value):
        temporary = self.path.with_suffix("."+uuid4().hex+".tmp")
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    @contextmanager
    def request(self, maximum_seconds):
        maximum_seconds = max(1, math.ceil(maximum_seconds))
        identity = uuid4().hex
        with locked(self.path):
            value = self._read()
            if (value["reserved_calls"]+1 > value["max_calls"]
                or value["reserved_seconds"]+maximum_seconds > value["max_seconds"]):
                raise RuntimeError("live_budget_exhausted")
            value["reserved_calls"] += 1
            value["reserved_seconds"] += maximum_seconds
            value.setdefault("active_reservations", {})[identity] = maximum_seconds
            self._write(value)
        started = time.monotonic()
        uncertain = False
        try:
            yield {"reservation_ref":identity,"call_number":value["reserved_calls"]}
        except BaseException:
            uncertain = True
            raise
        finally:
            # Only after real transport completion. A dead process leaves its
            # entire reservation charged; an uncertain call never refunds itself.
            elapsed = maximum_seconds if uncertain else min(maximum_seconds, max(1, math.ceil(time.monotonic()-started)))
            with locked(self.path):
                value = self._read()
                if value.get("active_reservations", {}).pop(identity, None) != maximum_seconds:
                    raise RuntimeError("live_budget_reservation_missing")
                value["reserved_seconds"] -= maximum_seconds-elapsed
                self._write(value)
