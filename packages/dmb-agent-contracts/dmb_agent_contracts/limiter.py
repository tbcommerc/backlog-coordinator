"""Redis logical-operation slots. Active ownership never expires by TTL.

Queue entries expire; running leases do not. Missing/mismatched coordinator
epochs fail closed. A private local journal precedes network acquisition so an
unknown Redis response cannot erase ownership or authorize an unsafe reset.
"""
import json
import hashlib
import os
import re
import socket
import ssl
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4

from .model import AgentError


def process_identity(pid):
    """Birth identity prevents a recycled PID from proving lease ownership."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel.GetProcessTimes.argtypes = (wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)]*4))
        kernel.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        handle = kernel.OpenProcess(0x1000, False, int(pid))
        if not handle:
            return ("dead", None) if ctypes.get_last_error() == 87 else ("unknown", None)
        try:
            created, exited, system, user = (wintypes.FILETIME() for _ in range(4))
            code = wintypes.DWORD()
            if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
                return "unknown", None
            if code.value != 259:
                return "dead", None
            if not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)):
                return "unknown", None
            return "alive", str((created.dwHighDateTime << 32) | created.dwLowDateTime)
        finally:
            kernel.CloseHandle(handle)
    try:
        fields = Path("/proc", str(int(pid)), "stat").read_text().rsplit(")", 1)[1].split()
        return ("dead", None) if fields[0] == "Z" else ("alive", fields[19])
    except FileNotFoundError:
        return "dead", None
    except (OSError, ValueError, IndexError):
        return "unknown", None


def read_journal(path):
    if os.name != "nt":
        return json.loads(path.read_text(encoding="utf-8"))
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel=ctypes.WinDLL("kernel32",use_last_error=True)
    kernel.CreateFileW.argtypes=(wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,wintypes.LPVOID,
        wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE)
    kernel.CreateFileW.restype=wintypes.HANDLE
    handle=kernel.CreateFileW(str(path),0x80000000,7,None,3,0x80,None)
    if handle==wintypes.HANDLE(-1).value:
        error=ctypes.get_last_error()
        if error in (2,3):
            raise FileNotFoundError(str(path))
        raise ctypes.WinError(error)
    descriptor=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY)
    with os.fdopen(descriptor,"r",encoding="utf-8") as stream:
        return json.load(stream)


def replace_journal(source,target):
    deadline=time.monotonic()+2
    while True:
        try:
            os.replace(source,target)
            return
        except OSError as error:
            # Windows scanners can report ACCESS_DENIED for a transient open
            # destination as well as SHARING_VIOLATION. Never change its ACL.
            if getattr(error,"winerror",None) not in (5,32,33) or time.monotonic()>=deadline:
                raise
            time.sleep(.01)


@contextmanager
def journal_lock(path):
    """Serialize cleanup of one lease across replicas; the OS releases on death."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        stream.seek(0, 2)
        if not stream.tell():
            stream.write(b"0")
            stream.flush()
        deadline = time.monotonic()+2
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
                    raise AgentError("limiter_journal_busy", 503) from None
                time.sleep(.01)
        yield


class Redis:
    """Small bounded RESP2 client; no Redis dependency or credential logging."""
    def __init__(self, url, timeout=2):
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in ("redis", "rediss") or not parsed.hostname or parsed.query or parsed.fragment:
                raise ValueError()
            self.host, self.port = parsed.hostname, parsed.port or 6379
            self.database = int(parsed.path.strip("/") or 0)
            if not 0 <= self.database <= 15:
                raise ValueError()
            self.username = unquote(parsed.username) if parsed.username else None
            self.password = unquote(parsed.password) if parsed.password else None
            self.tls, self.timeout = parsed.scheme == "rediss", timeout
        except (ValueError, TypeError):
            raise AgentError("limiter_configuration_invalid", 503) from None

    @staticmethod
    def _encode(values):
        result = bytearray(("*%d\r\n" % len(values)).encode())
        for value in values:
            raw = value if isinstance(value, bytes) else str(value).encode("utf-8")
            result.extend(("$%d\r\n" % len(raw)).encode()+raw+b"\r\n")
        return result

    @classmethod
    def _read(cls, stream, depth=0):
        if depth > 8:
            raise ValueError()
        line = stream.readline(131073)
        if not line.endswith(b"\r\n") or len(line) > 131072:
            raise ValueError()
        kind, value = line[:1], line[1:-2]
        if kind == b"+":
            return value.decode()
        if kind == b"-":
            raise ValueError()  # Redis errors may contain private command input.
        if kind == b":":
            return int(value)
        if kind == b"$":
            length = int(value)
            if length == -1:
                return None
            if not 0 <= length <= 1048576:
                raise ValueError()
            raw = stream.read(length+2)
            if len(raw) != length+2 or raw[-2:] != b"\r\n":
                raise ValueError()
            return raw[:-2].decode()
        if kind == b"*":
            length = int(value)
            if not 0 <= length <= 1024:
                raise ValueError()
            return [cls._read(stream, depth+1) for _ in range(length)]
        raise ValueError()

    def command(self, *values):
        try:
            with socket.create_connection((self.host, self.port), self.timeout) as raw:
                connection = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host) if self.tls else raw
                with connection:
                    connection.settimeout(self.timeout)
                    with connection.makefile("rb") as stream:
                        if self.password:
                            auth = ("AUTH", self.username, self.password) if self.username else ("AUTH", self.password)
                            connection.sendall(self._encode(auth))
                            if self._read(stream) != "OK":
                                raise ValueError()
                        if self.database:
                            connection.sendall(self._encode(("SELECT", self.database)))
                            if self._read(stream) != "OK":
                                raise ValueError()
                        connection.sendall(self._encode(values))
                        return self._read(stream)
        except (OSError, ValueError, UnicodeError):
            raise AgentError("global_limiter_unavailable", 503) from None


BOOTSTRAP = r'''
local server=string.match(redis.call('INFO','server'),'run_id:([0-9a-f]+)')
if not server then return 'unavailable' end
local old=redis.call('GET',KEYS[1])
if old then
  if old~=ARGV[1] then return 'epoch_mismatch' end
  if redis.call('GET',KEYS[2])~=ARGV[2] then return 'profile_mismatch' end
  if not redis.call('GET',KEYS[8]) or not redis.call('GET',KEYS[7]) then return 'state_lost' end
  if tonumber(redis.call('GET',KEYS[8]))~=redis.call('HLEN',KEYS[3]) then return 'state_lost' end
  if redis.call('GET',KEYS[9])~=server then return 'server_restarted' end
  return 'ready'
end
if ARGV[3]~='initialize' then return 'epoch_missing' end
if redis.call('HLEN',KEYS[3])>0 or redis.call('ZCARD',KEYS[4])>0 then return 'orphaned_state' end
redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2])
redis.call('SET',KEYS[8],0);redis.call('SET',KEYS[7],0);redis.call('SET',KEYS[9],server);return 'ready'
'''

ACQUIRE = r'''
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[2])~=ARGV[2] then return 'unavailable' end
if redis.call('GET',KEYS[9])~=string.match(redis.call('INFO','server'),'run_id:([0-9a-f]+)') then return 'unavailable' end
if not redis.call('GET',KEYS[8]) or not redis.call('GET',KEYS[7]) then return 'unavailable' end
if tonumber(redis.call('GET',KEYS[8]))~=redis.call('HLEN',KEYS[3]) then return 'unavailable' end
if redis.call('ZCARD',KEYS[4])~=redis.call('HLEN',KEYS[5]) or redis.call('ZCARD',KEYS[4])~=redis.call('ZCARD',KEYS[6]) then return 'unavailable' end
local active=redis.call('HGET',KEYS[3],ARGV[3])
if active then if active==ARGV[4] then return 'active' else return 'conflict' end end
local clock=redis.call('TIME');local now=tonumber(clock[1])+tonumber(clock[2])/1000000
local expired=redis.call('ZRANGEBYSCORE',KEYS[6],'-inf',now)
for _,token in ipairs(expired) do
 redis.call('ZREM',KEYS[4],token);redis.call('ZREM',KEYS[6],token);redis.call('HDEL',KEYS[5],token)
end
if not redis.call('ZSCORE',KEYS[4],ARGV[3]) then
 if redis.call('ZCARD',KEYS[4])>=tonumber(ARGV[5]) then return 'queue_full' end
 local count=0;local all=redis.call('HVALS',KEYS[5])
 for _,value in ipairs(all) do if value==ARGV[6] then count=count+1 end end
 if count>=tonumber(ARGV[7]) then return 'actor_queue_full' end
 local sequence=redis.call('INCR',KEYS[7])
 redis.call('ZADD',KEYS[4],sequence,ARGV[3]);redis.call('HSET',KEYS[5],ARGV[3],ARGV[6])
 redis.call('ZADD',KEYS[6],now+tonumber(ARGV[8]),ARGV[3])
end
local head=redis.call('ZRANGE',KEYS[4],0,0)[1]
if head==ARGV[3] and redis.call('HLEN',KEYS[3])<tonumber(ARGV[9]) then
 redis.call('ZREM',KEYS[4],ARGV[3]);redis.call('ZREM',KEYS[6],ARGV[3]);redis.call('HDEL',KEYS[5],ARGV[3])
 redis.call('HSET',KEYS[3],ARGV[3],ARGV[4]);redis.call('INCR',KEYS[8]);return 'active'
end
return 'queued'
'''

RELEASE = r'''
if redis.call('GET',KEYS[1])~=ARGV[1] then return 'unavailable' end
if not redis.call('GET',KEYS[8]) or tonumber(redis.call('GET',KEYS[8]))~=redis.call('HLEN',KEYS[3]) then return 'unavailable' end
local active=redis.call('HGET',KEYS[3],ARGV[2])
if active and active~=ARGV[3] then return 'conflict' end
if redis.call('HDEL',KEYS[3],ARGV[2])==1 then redis.call('DECR',KEYS[8]) end
redis.call('ZREM',KEYS[4],ARGV[2])
redis.call('ZREM',KEYS[6],ARGV[2]);redis.call('HDEL',KEYS[5],ARGV[2]);return 'released'
'''

VERIFY = r'''
if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('GET',KEYS[2])~=ARGV[2] then return 'unavailable' end
if redis.call('GET',KEYS[9])~=string.match(redis.call('INFO','server'),'run_id:([0-9a-f]+)') then return 'unavailable' end
if not redis.call('GET',KEYS[8]) or tonumber(redis.call('GET',KEYS[8]))~=redis.call('HLEN',KEYS[3]) then return 'unavailable' end
if redis.call('HGET',KEYS[3],ARGV[3])~=ARGV[4] then return 'lost' end
return 'active'
'''

RECONCILE = r'''
local epoch=redis.call('GET',KEYS[1]);local profile=redis.call('GET',KEYS[2])
if epoch and epoch~=ARGV[1] then return 'unavailable' end
if profile and profile~=ARGV[2] then return 'unavailable' end
local proof=cjson.decode(ARGV[3]);local proof_count=0
for _,_ in pairs(proof) do proof_count=proof_count+1 end
local active=redis.call('HGETALL',KEYS[3])
for i=1,#active,2 do if proof[active[i]]~=active[i+1] then return 'active_ownership_remains' end end
if tonumber(redis.call('GET',KEYS[8]) or '0')>proof_count then return 'active_ownership_remains' end
local server=string.match(redis.call('INFO','server'),'run_id:([0-9a-f]+)')
if not server then return 'unavailable' end
redis.call('DEL',KEYS[3],KEYS[4],KEYS[5],KEYS[6])
redis.call('SET',KEYS[1],ARGV[1]);redis.call('SET',KEYS[2],ARGV[2]);redis.call('SET',KEYS[7],0)
redis.call('SET',KEYS[8],0);redis.call('SET',KEYS[9],server);return 'ready'
'''


@dataclass(frozen=True)
class LimiterConfig:
    redis_url: str
    namespace: str
    epoch: str
    journal_dir: Path
    limit: int = 2
    queue_capacity: int = 64
    actor_queue_capacity: int = 8
    queue_seconds: float = 15

    def __post_init__(self):
        if not re.fullmatch(r"[a-zA-Z0-9:_-]{1,96}", self.namespace) or not re.fullmatch(r"[0-9a-f]{32}", self.epoch):
            raise AgentError("limiter_configuration_invalid", 503)
        if self.limit not in (1, 2) or not 1 <= self.actor_queue_capacity <= self.queue_capacity <= 128 or not 0 < self.queue_seconds <= 15:
            raise AgentError("limiter_configuration_invalid", 503)
        object.__setattr__(self, "journal_dir", Path(self.journal_dir))

    @property
    def profile(self):
        return json.dumps({"protocol": 3, "limit": self.limit, "queue": self.queue_capacity,
            "actor_queue": self.actor_queue_capacity,
            "journal_scope": hashlib.sha256(os.path.normcase(str(self.journal_dir.resolve())).encode()).hexdigest()},
            sort_keys=True, separators=(",", ":"))


class RedisLimiter:
    def __init__(self, config, client=None):
        self.config = config
        self.client = client or Redis(config.redis_url)
        self.keys = ["dmb:agent-gate:"+config.namespace+":"+name for name in
            ("epoch", "profile", "active", "queue", "actors", "queue_expiry", "sequence", "active_count", "server_run_id")]

    def _eval(self, script, *arguments):
        return self.client.command("EVAL", script, len(self.keys), *self.keys, *arguments)

    def bootstrap(self, initialize=False):
        if initialize and self.config.journal_dir.is_dir():
            for path in self.config.journal_dir.glob("*.json"):
                record = read_journal(path)
                if record.get("namespace") == self.config.namespace and record.get("state") not in ("released", "cleanup_confirmed"):
                    raise AgentError("limiter_recovery_required", 503)
        result = self._eval(BOOTSTRAP, self.config.epoch, self.config.profile, "initialize" if initialize else "check")
        if result != "ready":
            raise AgentError("global_limiter_"+result, 503)

    def acquire(self, run_id, actor_ref, check=lambda: None):
        run_id = str(UUID(str(run_id)))
        if not actor_ref or len(actor_ref) > 512:
            raise AgentError("limiter_actor_required", 422)
        token = uuid4().hex
        identity = json.dumps({"run_id": run_id, "host": socket.gethostname(), "pid": os.getpid(),
            "process_birth": process_identity(os.getpid())[1],
            "service_id": os.environ.get("DMB_AGENT_SERVICE_ID", "legacy"),
            "nonce": token}, sort_keys=True, separators=(",", ":"))
        lease = Lease(self, token, identity, run_id)
        deadline = time.monotonic()+self.config.queue_seconds
        # Journal commit precedes even the first possibly accepted Redis command.
        lease.write("acquiring")
        try:
            while True:
                check()
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise AgentError("operation_queue_timeout", 429)
                result = self._eval(ACQUIRE, self.config.epoch, self.config.profile, token, identity,
                    self.config.queue_capacity, actor_ref, self.config.actor_queue_capacity,
                    remaining, self.config.limit)
                if result == "active":
                    check()
                    if time.monotonic() >= deadline:
                        raise AgentError("operation_queue_timeout", 429)
                    lease.write("active")
                    check()
                    if time.monotonic() >= deadline:
                        raise AgentError("operation_queue_timeout", 429)
                    return lease
                if result != "queued":
                    code = {"queue_full": "operation_queue_full", "actor_queue_full": "actor_queue_full"}.get(result, "global_limiter_unavailable")
                    raise AgentError(code, 429 if result.endswith("full") else 503)
                time.sleep(min(.05, max(0, deadline-time.monotonic())))
        except BaseException:
            # No domain work was started: all possible ownership can be released.
            try:
                lease.release()
            except AgentError:
                pass  # Preserve the journal for explicit confirmed recovery.
            raise

    def recover_confirmed(self):
        """Retry only locally committed cleanup receipts, never TTL/dead PID guesses."""
        recovered = 0
        if not self.config.journal_dir.is_dir():
            return recovered
        for path in self.config.journal_dir.glob("*.json"):
            try:
                record = read_journal(path)
            except FileNotFoundError:
                continue  # Another replica committed this same cleanup receipt.
            except (OSError, ValueError):
                raise AgentError("limiter_journal_invalid", 503) from None
            if record.get("epoch") != self.config.epoch or record.get("namespace") != self.config.namespace:
                continue
            if record.get("state") != "cleanup_confirmed":
                # A crashed direct owner has no isolated resources. A lease with
                # registered runtime cleanup must go through the service janitor.
                if record.get("state") not in ("active", "acquiring", "http_active", "cleanup_ready", "http_cleanup_pending"):
                    continue
                identity = json.loads(record["identity"])
                if identity.get("host") != socket.gethostname() or not identity.get("process_birth"):
                    continue
                status, birth = process_identity(identity["pid"])
                if status == "unknown" or status == "alive" and birth == identity["process_birth"]:
                    continue
            lease = Lease(self, record["token"], record["identity"], record["run_id"])
            if lease.path != path:
                raise AgentError("limiter_journal_invalid", 503)
            lease.release()
            recovered += 1
        return recovered

    def confirm_run_cleanup(self, run_id):
        """Called only by a service janitor after its runtime/grant cleanup proof."""
        run_id = str(UUID(str(run_id)))
        count = 0
        if not self.config.journal_dir.is_dir():
            return count
        for path in self.config.journal_dir.glob("*.json"):
            try:
                record = read_journal(path)
            except FileNotFoundError:
                continue
            except (OSError, ValueError):
                raise AgentError("limiter_journal_invalid", 503) from None
            if record.get("epoch") != self.config.epoch or record.get("namespace") != self.config.namespace or record.get("run_id") != run_id:
                continue
            identity = json.loads(record["identity"])
            if identity.get("service_id") != os.environ.get("DMB_AGENT_SERVICE_ID", "legacy"):
                raise AgentError("limiter_cleanup_scope_mismatch", 403)
            if record.get("state") in ("http_cleanup_pending","runtime_http_cleanup_pending"):
                if identity.get("host") != socket.gethostname():
                    raise AgentError("http_cleanup_unconfirmed",503)
                status,birth=process_identity(identity["pid"])
                if status=="unknown" or status=="alive" and birth==identity.get("process_birth"):
                    raise AgentError("http_cleanup_unconfirmed",503)
            lease = Lease(self, record["token"], record["identity"], run_id)
            lease.confirm_cleanup()
            lease.release()
            count += 1
        return count

    def reconcile_after_restart(self):
        """Explicit repair, only with a shared journal proving all work closed."""
        try:
            self.recover_confirmed()
        except AgentError as error:
            if error.code not in ("operation_release_unconfirmed","global_limiter_unavailable"):
                raise
        approved={}
        for path in self.config.journal_dir.glob("*.json"):
            try:
                record=read_journal(path)
            except FileNotFoundError:
                continue
            if record.get("namespace")==self.config.namespace and record.get("epoch")==self.config.epoch:
                if record.get("state") not in ("cleanup_confirmed","released"):
                    raise AgentError("limiter_recovery_required",503)
                approved[record["token"]]=record["identity"]
        # RDB may also restore already-released leases. Replay only exact local
        # durable cleanup receipts, never assume that restored ownership expired.
        active=self.client.command("HGETALL",self.keys[2])
        for token,identity in zip(active[::2],active[1::2]):
            if not re.fullmatch(r"[0-9a-f]{32}",token):
                raise AgentError("limiter_journal_invalid",503)
            if approved.get(token)!=identity:
                path=self.config.journal_dir/(token+".done")
                if not path.exists():
                    raise AgentError("limiter_recovery_required",503)
                record=read_journal(path)
                if record.get("state")!="released" or record.get("identity")!=identity or record.get("epoch")!=self.config.epoch:
                    raise AgentError("limiter_recovery_required",503)
                approved[token]=identity
        if self._eval(RECONCILE,self.config.epoch,self.config.profile,json.dumps(approved))!="ready":
            raise AgentError("limiter_recovery_required",503)
        self.recover_confirmed()


class Lease:
    def __init__(self, limiter, token, identity, run_id):
        if not re.fullmatch(r"[0-9a-f]{32}", token):
            raise AgentError("limiter_journal_invalid", 503)
        UUID(str(run_id))
        self.limiter, self.token, self.identity, self.run_id = limiter, token, identity, run_id
        self.path = limiter.config.journal_dir / (token+".json")
        self.released = False
        self.cleanup_pending = False

    def write(self, state):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        value = {"namespace": self.limiter.config.namespace, "epoch": self.limiter.config.epoch,
            "token": self.token, "identity": self.identity, "run_id": self.run_id, "state": state}
        temporary = self.path.with_suffix("."+uuid4().hex+".tmp")
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                json.dump(value, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            replace_journal(temporary, self.path)
        except OSError:
            raise AgentError("limiter_journal_unavailable", 503) from None
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def check(self):
        result=self.limiter._eval(VERIFY,self.limiter.config.epoch,self.limiter.config.profile,self.token,self.identity)
        if result=="unavailable":
            raise AgentError("global_limiter_unavailable", 503)
        if result!="active":
            raise AgentError("operation_lease_lost", 503)

    def hold_for_cleanup(self, kind="runtime"):
        self.cleanup_pending = True
        self.write({"runtime":"resource_cleanup_pending","http":"http_cleanup_pending",
            "runtime_http":"runtime_http_cleanup_pending"}[kind])

    def confirm_cleanup(self):
        self.cleanup_pending = False
        self.write("cleanup_confirmed")

    def release(self):
        if self.released or self.cleanup_pending:
            return
        with journal_lock(self.path.with_suffix(".lock")):
            receipt = self.path.with_suffix(".done")
            if receipt.exists():
                record = read_journal(receipt)
                if record.get("identity") != self.identity or record.get("state") != "released":
                    raise AgentError("limiter_journal_invalid", 503)
                self.released = True
                return
            self._release_locked()

    def _release_locked(self):
        self.write("cleanup_confirmed")
        result = self.limiter._eval(RELEASE, self.limiter.config.epoch, self.token, self.identity)
        if result != "released":
            raise AgentError("operation_release_unconfirmed", 503)
        self.released = True
        self.write("released")
        try:
            replace_journal(self.path,self.path.with_suffix(".done"))
        except FileNotFoundError:
            if not self.path.with_suffix(".done").exists():
                raise AgentError("limiter_journal_unavailable", 503) from None
        except OSError:
            raise AgentError("limiter_journal_unavailable", 503) from None


def from_environment():
    mode = os.environ.get("DMB_AGENT_LIMITER_MODE", "")
    if not mode:
        if os.environ.get("DMB_AGENT_REQUIRE_LIMITER") == "true":
            raise AgentError("limiter_configuration_invalid", 503)
        return None  # Explicit application bootstrap supplies the runtime profile.
    if mode not in ("global", "standalone"):
        raise AgentError("limiter_configuration_invalid", 503)
    try:
        config = LimiterConfig(redis_url=os.environ["DMB_AGENT_LIMITER_REDIS_URL"],
            namespace=os.environ["DMB_AGENT_LIMITER_NAMESPACE"], epoch=os.environ["DMB_AGENT_LIMITER_EPOCH"],
            journal_dir=Path(os.environ["DMB_AGENT_LIMITER_JOURNAL_DIR"]), limit=2 if mode == "global" else 1)
    except KeyError:
        raise AgentError("limiter_configuration_invalid", 503) from None
    return RedisLimiter(config)


def limiter_metadata():
    limiter=from_environment()
    if limiter is None:
        return {"mode":"unconfigured","operation_limit":None,"platform_scope":False,"scope_ref":None}
    reference=hashlib.sha256((os.environ["DMB_AGENT_LIMITER_MODE"]+":"+limiter.config.namespace+":"+
        limiter.config.epoch+":"+limiter.config.profile).encode()).hexdigest()
    return {"mode":os.environ["DMB_AGENT_LIMITER_MODE"],"operation_limit":limiter.config.limit,
        "platform_scope":os.environ["DMB_AGENT_LIMITER_MODE"]=="global","scope_ref":reference}


def require_runtime_limiter():
    """Production lifespans cannot bypass the official execution profile."""
    os.environ["DMB_AGENT_REQUIRE_LIMITER"]="true"
    limiter=from_environment()
    if limiter is None:
        raise AgentError("limiter_configuration_invalid",503)
    limiter.bootstrap()
    return limiter
