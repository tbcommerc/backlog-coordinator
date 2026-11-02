#!/usr/bin/env bash
# Точка входа agent-runtime для macOS и Linux.
#
# Обёртка не содержит правил: проверки и жизненный цикл живут в
# tools/agent_lifecycle.py, чтобы поведение не расходилось между способами
# запуска. Тот же принцип, что в strategy-decomposer.
#
#   bash tools/launch/start-agent.sh preflight
#   bash tools/launch/start-agent.sh start [--port 4097] [--no-install]
#   bash tools/launch/start-agent.sh status
#   bash tools/launch/start-agent.sh stop
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
COMMAND=""
ARGS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    preflight|start|status|stop)
      if [ -z "$COMMAND" ]; then COMMAND="$1"; else ARGS+=("$1"); fi
      shift ;;
    -h|--help)
      echo "usage: bash tools/launch/start-agent.sh <preflight|start|status|stop> [options]"
      exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [ -z "$COMMAND" ]; then
  echo "usage: bash tools/launch/start-agent.sh <preflight|start|status|stop>" >&2
  exit 2
fi

# Виртуальное окружение проекта приоритетнее системного интерпретатора.
if [ -x "$REPO/.venv/bin/python" ]; then
  PYTHON="${PYTHON:-$REPO/.venv/bin/python}"
else
  PYTHON="${PYTHON:-python3}"
fi
command -v "$PYTHON" >/dev/null 2>&1 || { echo "python_missing: нужен Python 3.11+" >&2; exit 3; }

exec "$PYTHON" "$REPO/tools/agent_lifecycle.py" "$COMMAND" ${ARGS[@]+"${ARGS[@]}"}
