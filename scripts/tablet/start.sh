#!/usr/bin/env bash
# Start (or watchdog-restart) the GrokPC tablet worker: FastAPI + cloudflared quick tunnel.
# Usage:
#   start.sh          # foreground watchdog loop (Termux:Boot / nohup)
#   start.sh --once   # start missing processes and exit
#   start.sh --watchdog-bg  # launch watchdog in background and return
set -uo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
HOME="${HOME:-/data/data/com.termux/files/home}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ ! -f "$ROOT/backend/main.py" && -f "$HOME/grokpc/backend/main.py" ]]; then
  ROOT="$HOME/grokpc"
fi
DATA="${GROKPC_DATA:-$HOME/grokpc-data}"
LOG="$DATA/logs"
ENV_FILE="${GROKPC_ENV:-$ROOT/backend/.env}"
VENV="${GROKPC_VENV:-$DATA/venv}"
mkdir -p "$LOG" "$DATA/outputs" "$DATA/chrome_profile"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
fi
export GROKPC_ENV="$ENV_FILE"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

running() { pgrep -f "$1" >/dev/null 2>&1; }
WATCHDOG_PIDFILE="$DATA/watchdog.pid"

watchdog_alive() {
  if [[ -f "$WATCHDOG_PIDFILE" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "$WATCHDOG_PIDFILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

start_agent() {
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    return 0
  fi
  if [[ ! -x "$VENV/bin/python" ]]; then
    echo "[grokpc] ERROR: venv missing at $VENV — install.sh chalao" >&2
    return 1
  fi
  echo "[grokpc] starting agent on ${HOST}:${PORT}"
  (
    cd "$ROOT/backend" || exit 1
    export PYTHONUNBUFFERED=1
    export GROKPC_ENV="$ENV_FILE"
    nohup "$VENV/bin/python" main.py >>"$LOG/agent.log" 2>&1 &
  )
  # Give uvicorn a moment to bind.
  for _try in $(seq 1 20); do
    curl -sf --max-time 1 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "[grokpc] agent not healthy yet — see $LOG/agent.log" >&2
  return 1
}

start_tunnel() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[grokpc] cloudflared nahi mila (pkg install cloudflared)" >&2
    return 1
  fi
  if running "run_tunnel.sh ${PORT}"; then
    return 0
  fi
  echo "[grokpc] starting cloudflared quick tunnel for :${PORT}"
  nohup bash "$ROOT/backend/run_tunnel.sh" "$PORT" "$DATA/tunnel_url.txt" >>"$LOG/tunnel.log" 2>&1 &
}

ensure() {
  start_agent || true
  start_tunnel || true
}

MODE="${1:-}"
if [[ "$MODE" == "--once" ]]; then
  ensure
  echo "Backend local: http://127.0.0.1:${PORT}"
  if [[ -s "$DATA/tunnel_url.txt" ]]; then
    echo "Backend URL : $(tr -d '[:space:]' < "$DATA/tunnel_url.txt")"
  else
    echo "Backend URL : (tunnel abhi ready nahi — $LOG/tunnel.log dekho)"
  fi
  exit 0
fi

if [[ "$MODE" == "--watchdog-bg" ]]; then
  if watchdog_alive; then
    ensure
    exit 0
  fi
  nohup bash "$ROOT/scripts/tablet/start.sh" >>"$LOG/watchdog.log" 2>&1 &
  sleep 1
  exit 0
fi

# Foreground watchdog: restart backend + tunnel if they crash.
echo "$$" > "$WATCHDOG_PIDFILE"
echo "[grokpc] watchdog starting (ctrl+c to stop this loop only)"
ensure
while true; do
  if ! curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "[grokpc] agent down — restart"
    start_agent || true
  fi
  if command -v cloudflared >/dev/null 2>&1 && ! running "run_tunnel.sh ${PORT}"; then
    echo "[grokpc] tunnel down — restart"
    start_tunnel || true
  fi
  sleep 20
done
