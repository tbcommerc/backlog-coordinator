"""Independent reference HTTP fixture, with no pytest or product dependency."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from contextlib import contextmanager

CONFIG = {"permission": {"*": "deny", "StructuredOutput": "allow"}, "provider": {},
          "enabled_providers": [], "mcp": {}, "share": "disabled", "snapshot": False,
          "autoupdate": False, "plugin": [], "instructions": []}
SCHEMA = {"type": "object", "properties": {"items": {"type": "array"}}, "required": ["items"], "additionalProperties": False}


@contextmanager
def emulator(**faults):
    state = {"dispatch_count": 0, "message": None, "permission_rejected": False, **faults}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def send(self, value, code=200):
            raw = b"" if code == 204 else value if isinstance(value, bytes) else json.dumps(value).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def do_GET(self):
            if self.path.startswith("/session?"):
                return self.send([state["session_record"]] if state.get("session_record") else [])
            if self.path == "/session/ses_synthetic":
                return self.send(state.get("session_record", {}))
            if self.path == "/global/health":
                return self.send({"healthy": True, "version": state.get("version", "1.17.13")})
            if self.path == "/config":
                return self.send({**CONFIG, **state.get("config", {})})
            if self.path == "/agent":
                return self.send(state.get("agents", [{"name": "bounded", "mode": "primary",
                    "permission": [{"permission": "*", "pattern": "*", "action": "deny"},
                        {"permission": "StructuredOutput", "pattern": "*", "action": "allow"}], "options": {}}]))
            if self.path == "/permission":
                return self.send([{"id": "per_synthetic", "sessionID":state.get("permission_session","ses_synthetic"),
                    "permission":"bash","patterns":["*"],"metadata":{},"always":[]}] if state.get("permission") else [])
            if "/message" in self.path:
                if state.get('malformed_message'):
                    return self.send(b'{"truncated":')
                if not state["message"]:
                    return self.send([])
                return self.send([{"info": {"id": "msg_assistant", "sessionID": state.get("session", "ses_synthetic"),
                    "providerID": state["dispatch_body"]["model"]["providerID"], "modelID": state.get("model_id", state["dispatch_body"]["model"]["modelID"]),
                    "mode":"bounded","agent":state["dispatch_body"]["agent"],"path":{"cwd":"/isolated/workspace","root":"/isolated"},
                    "cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
                    "parentID": state.get("parent", state["message"]), "role": "assistant", "finish": state.get("finish", "stop"),
                    "time": {"created": 1, "completed": 2}, "structured": state.get("candidate", {"items": []})}, "parts": state.get('parts',[])}])
            self.send({}, 404)
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"null")
            if self.path == "/session":
                state["prepare_count"] = state.get("prepare_count",0)+1
                state["session_record"] = {"id":"ses_synthetic","metadata":body.get("metadata",{}),"title":body.get("title",""),
                    "slug":"synthetic-session","projectID":"global","directory":"/isolated/workspace",
                    "version":"1.17.13","time":{"created":1,"updated":1}}
                if state.get("disconnect_create"):
                    self.close_connection = True
                    return
                return self.send(state["session_record"])
            if self.path.endswith("/prompt_async"):
                state["dispatch_count"] += 1
                state["message"] = body["messageID"]
                state["dispatch_body"] = body
                if state.get("disconnect"):
                    self.close_connection = True
                    return
                return self.send(None, 204)
            if self.path.endswith("/reply"):
                state["permission_rejected"] = body == {"reply": "reject"}
                return self.send(True)
            if self.path.endswith("/abort"):
                state['abort_count']=state.get('abort_count',0)+1
                return self.send(True)
            self.send({}, 404)
        def do_DELETE(self):
            self.send(not state.get("cleanup_failure"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        thread.join()
        server.server_close()
