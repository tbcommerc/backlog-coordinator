#!/usr/bin/env bash
# Останавливает runtime, поднятый этим клоном. См. start-agent.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$REPO/tools/launch/start-agent.sh" stop
