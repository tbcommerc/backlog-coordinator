#!/usr/bin/env python3
"""Проверка окружения и жизненный цикл agent-runtime.

Правила живут здесь, а не в shell-обёртке — по образцу strategy-decomposer,
где `tools/launch/start-cascade.{sh,ps1}` не содержат логики и обе платформы
исполняют одно Python-ядро.

Ключевое отличие от «просто поставьте opencode»: runtime ставится **локальной**
npm-зависимостью в `node_modules` этого репозитория. Глобальная установка не
нужна, версия зафиксирована в package.json, и клон репозитория воспроизводит то
же окружение.

    python3 tools/agent_lifecycle.py preflight
    python3 tools/agent_lifecycle.py start [--port 4097] [--hostname localhost] [--no-install]
    python3 tools/agent_lifecycle.py status
    python3 tools/agent_lifecycle.py stop
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = REPO_ROOT / "var" / "agent-state.json"
LOG_PATH = REPO_ROOT / "var" / "opencode.log"
DEFAULT_PORT = 4097
DEFAULT_HOSTNAME = "127.0.0.1"

MIN_PYTHON = (3, 11)
MIN_NODE_MAJOR = 20


def _check(name: str, ok: bool, fail_detail: str = "", ok_detail: str = "") -> dict:
    """Проверка окружения.

    `fail_detail` — что сделать, чтобы починить; печатается только при провале.
    `ok_detail` — полезный факт (версия, количество), печатается при успехе.
    Смешивать их нельзя: подсказка «выполните npm install» рядом со статусом ok
    читается как невыполненное требование.
    """
    return {
        "name": name,
        "status": "ok" if ok else "fail",
        "detail": (ok_detail if ok else fail_detail),
    }


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _venv_python() -> Path:
    return REPO_ROOT / ".venv" / "bin" / "python"


def _opencode_binary() -> Path:
    return REPO_ROOT / "node_modules" / ".bin" / "opencode"


def _port_open(port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


# --- preflight ---------------------------------------------------------------


def preflight(_args: argparse.Namespace) -> int:
    checks: list[dict] = []

    python_version = sys.version.split()[0]
    checks.append(
        _check(
            "python_version",
            sys.version_info >= MIN_PYTHON,
            f"нужен Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+, найден {python_version}",
            python_version,
        )
    )

    node = shutil.which("node")
    node_major = 0
    if node:
        try:
            raw = subprocess.run(
                [node, "--version"], capture_output=True, text=True, timeout=10
            ).stdout.strip()
            node_major = int(raw.lstrip("v").split(".")[0])
        except (ValueError, subprocess.SubprocessError):
            node_major = 0
    checks.append(
        _check(
            "node",
            bool(node) and node_major >= MIN_NODE_MAJOR,
            f"нужен Node.js {MIN_NODE_MAJOR}+, найден {node_major or 'нет'}",
            f"v{node_major}",
        )
    )
    npm = shutil.which("npm")
    checks.append(_check("npm", npm is not None, "npm не найден в PATH", npm or ""))

    venv = _venv_python()
    checks.append(
        _check(
            "venv",
            venv.exists(),
            f"нет {venv} — выполните python3 -m venv .venv",
            str(venv.relative_to(REPO_ROOT)),
        )
    )

    if venv.exists():
        probe = subprocess.run(
            [
                str(venv),
                "-c",
                "import sqlalchemy, pydantic_settings, yaml, rank_bm25; print('ok')",
            ],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        checks.append(
            _check(
                "python_deps",
                probe.returncode == 0,
                "выполните .venv/bin/pip install -r requirements.txt",
                "sqlalchemy, pydantic-settings, PyYAML, rank-bm25",
            )
        )

    binary = _opencode_binary()
    checks.append(
        _check(
            "opencode_binary",
            binary.exists(),
            "выполните npm install (runtime ставится локально, глобальная установка не нужна)",
            str(binary.relative_to(REPO_ROOT)),
        )
    )

    # Конфигурация агента: ссылки на промпты и инструменты должны существовать,
    # иначе opencode упадёт уже после старта.
    config_path = REPO_ROOT / "opencode.json"
    if not config_path.exists():
        checks.append(_check("opencode_config", False, "нет opencode.json"))
    else:
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            checks.append(_check("opencode_config", False, f"невалидный JSON: {exc}"))
            config = {}
        else:
            checks.append(_check("opencode_config", True))

        missing_prompts = []
        for agent_name, agent in (config.get("agent") or {}).items():
            prompt = str(agent.get("prompt", ""))
            if prompt.startswith("{file:") and prompt.endswith("}"):
                relative = prompt[len("{file:") : -1]
                if not (REPO_ROOT / relative).exists():
                    missing_prompts.append(f"{agent_name} → {relative}")
        checks.append(
            _check("agent_prompts", not missing_prompts, "; ".join(missing_prompts))
        )

    tool_dir = REPO_ROOT / ".opencode" / "tool"
    tools = sorted(p.name for p in tool_dir.glob("*.js")) if tool_dir.is_dir() else []
    checks.append(
        _check(
            "agent_tools",
            bool(tools),
            f"нет инструментов в {tool_dir}",
            f"инструментов: {len(tools)}",
        )
    )

    seed = REPO_ROOT / "data" / "backlog_seed.json"
    checks.append(
        _check(
            "backlog_seed",
            seed.exists(),
            f"нет {seed}",
            f"{seed.stat().st_size // 1024} КБ" if seed.exists() else "",
        )
    )

    db_ready = False
    db_detail = ""
    if venv.exists():
        probe = subprocess.run(
            [str(venv), "-m", "value_priority_assessor.cli", "stats"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        if probe.returncode == 0:
            try:
                stats = json.loads(probe.stdout)
                db_ready = stats.get("total", 0) > 0
                db_detail = (
                    f"задач: {stats.get('total', 0)}, посчитано: {stats.get('computed', 0)}"
                )
            except json.JSONDecodeError:
                pass
    checks.append(
        _check(
            "database",
            db_ready,
            "выполните python -m app.cli init --reset",
            db_detail,
        )
    )

    # Состояние базы знаний: без неё агент отвечает по названию задачи вслепую.
    rag_ready = False
    rag_detail = ""
    if venv.exists():
        probe = subprocess.run(
            [str(venv), "-m", "value_priority_assessor.cli", "rag-status"],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )
        if probe.returncode == 0:
            try:
                status_payload = json.loads(probe.stdout)
                layers = status_payload.get("layers") or {}
                rag_ready = status_payload.get("corpus_size", 0) > 0
                package = status_payload.get("k3_package") or {}
                rag_detail = (
                    f"{status_payload.get('corpus_size')} фрагментов, "
                    f"режим {status_payload.get('retrieval_mode')}, "
                    f"слои {layers}, "
                    f"пакет K3 {package.get('package_version') or 'не установлен'}"
                )
            except json.JSONDecodeError:
                pass
    checks.append(
        _check(
            "rag_corpus",
            rag_ready,
            "проверьте python -m app.cli rag-status",
            rag_detail,
        )
    )

    failed = [c for c in checks if c["status"] != "ok"]
    _emit(
        {
            "command": "preflight",
            "ok": not failed,
            "passed": len(checks) - len(failed),
            "total": len(checks),
            "checks": checks,
        }
    )
    return 0 if not failed else 3


# --- start / status / stop ---------------------------------------------------


def _install_dependencies() -> list[str]:
    """Ставит npm-зависимости, если их ещё нет. Идемпотентно."""
    done: list[str] = []
    if not (REPO_ROOT / "node_modules").is_dir():
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=REPO_ROOT, check=True)
        done.append("node_modules")
    plugin_modules = REPO_ROOT / ".opencode" / "node_modules"
    if not plugin_modules.is_dir():
        subprocess.run(
            ["npm", "install", "--prefix", ".opencode", "--no-package-lock",
             "--ignore-scripts", "--no-audit", "--no-fund"],
            cwd=REPO_ROOT,
            check=True,
        )
        done.append(".opencode/node_modules")
    return done


def _read_state() -> dict | None:
    if not STATE_PATH.exists():
        return None
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def start(args: argparse.Namespace) -> int:
    port = args.port or DEFAULT_PORT

    state = _read_state()
    if state and _process_alive(state.get("pid", -1)) and _port_open(state.get("port", port)):
        _emit({"command": "start", "ok": True, "already_running": True, **state})
        return 0

    installed: list[str] = []
    if not args.no_install:
        try:
            installed = _install_dependencies()
        except subprocess.CalledProcessError as exc:
            _emit({"command": "start", "ok": False, "error": f"npm install: {exc}"})
            return 4

    binary = _opencode_binary()
    if not binary.exists():
        _emit(
            {
                "command": "start",
                "ok": False,
                "error": f"нет {binary}; выполните npm install",
            }
        )
        return 4

    if _port_open(port):
        _emit(
            {
                "command": "start",
                "ok": False,
                "error": f"порт {port} уже занят чужим процессом — этот клон его не запускал",
            }
        )
        return 5

    # Имя вынесено во флаг: opencode слушает ровно то, что ему передали, и
    # `localhost` у него означает только ::1 — проверка готовности порта идёт
    # по IPv4 и такой запуск не дождалась бы. Флаг нужен для смены origin:
    # состояние страницы браузер хранит по паре «хост + порт», и застрявшие
    # данные лечатся переездом на другой адрес.
    hostname = getattr(args, "hostname", None) or DEFAULT_HOSTNAME

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = LOG_PATH.open("a", encoding="utf-8")
    child = subprocess.Popen(
        [str(binary), "serve", "--hostname", hostname, "--port", str(port)],
        cwd=REPO_ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        if child.poll() is not None:
            _emit(
                {
                    "command": "start",
                    "ok": False,
                    "error": f"opencode завершился с кодом {child.returncode}",
                    "log": str(LOG_PATH),
                }
            )
            return 6
        if _port_open(port):
            break
        time.sleep(0.3)
    else:
        child.kill()
        _emit({"command": "start", "ok": False, "error": "таймаут ожидания порта",
               "log": str(LOG_PATH)})
        return 6

    payload = {
        "pid": child.pid,
        "port": port,
        "url": f"http://{hostname}:{port}",
        "repo": str(REPO_ROOT),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _emit({"command": "start", "ok": True, "installed": installed, "log": str(LOG_PATH), **payload})
    return 0


def status(_args: argparse.Namespace) -> int:
    state = _read_state()
    if state is None:
        _emit({"command": "status", "ok": True, "running": False, "detail": "состояние не найдено"})
        return 0

    alive = _process_alive(state.get("pid", -1))
    listening = _port_open(state.get("port", DEFAULT_PORT))
    _emit(
        {
            "command": "status",
            "ok": True,
            "running": alive and listening,
            "process_alive": alive,
            "port_listening": listening,
            **state,
        }
    )
    return 0


def stop(_args: argparse.Namespace) -> int:
    state = _read_state()
    if state is None:
        _emit({"command": "stop", "ok": True, "detail": "нечего останавливать"})
        return 0

    pid = int(state.get("pid", -1))
    # Останавливаем ровно тот процесс, который запустил этот клон. Убийства
    # по имени процесса здесь нет намеренно: на машине разработчика может
    # работать чужой opencode.
    if pid > 0 and _process_alive(pid):
        os.kill(pid, signal.SIGTERM)
        deadline = time.time() + 10
        while time.time() < deadline and _process_alive(pid):
            time.sleep(0.2)
        if _process_alive(pid):
            os.kill(pid, signal.SIGKILL)

    STATE_PATH.unlink(missing_ok=True)
    _emit({"command": "stop", "ok": True, "stopped_pid": pid})
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Жизненный цикл agent-runtime")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pre = sub.add_parser("preflight")
    p_pre.set_defaults(func=preflight)

    p_start = sub.add_parser("start")
    p_start.add_argument("--port", type=int, default=DEFAULT_PORT)
    p_start.add_argument("--hostname", default=DEFAULT_HOSTNAME,
                         help="имя или адрес, на котором слушает opencode")
    p_start.add_argument("--no-install", action="store_true")
    p_start.add_argument("--timeout", type=float, default=90.0)
    p_start.set_defaults(func=start)

    p_status = sub.add_parser("status")
    p_status.set_defaults(func=status)

    p_stop = sub.add_parser("stop")
    p_stop.set_defaults(func=stop)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
