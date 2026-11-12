#!/usr/bin/env bash
# Start desktop + agent + tunnels without systemd (Codespaces / plain containers).
# Idempotent: skips anything already running.
set -uo pipefail
APP_DIR="${APP_DIR:-/app/agent}"
DATA_DIR="${DATA_DIR:-/app/data}"
LOG="${DATA_DIR}/logs"; mkdir -p "$LOG"
set -a; [[ -f "$APP_DIR/.env" ]] && . "$APP_DIR/.env"; set +a
W="${VIEWPORT_WIDTH:-1280}"; H="${VIEWPORT_HEIGHT:-720}"
export DISPLAY=:99
run() { local name="$1"; shift; if ! pgrep -f "$name" >/dev/null; then nohup "$@" >"$LOG/$(echo "$name"|tr -c 'a-z0-9' _).log" 2>&1 & fi; }
run "Xvfb :99" Xvfb :99 -screen 0 "${W}x${H}x24" -nolisten tcp
sleep 2
run "icewm" icewm
run "x11vnc -display :99" x11vnc -display :99 -localhost -forever -shared -rfbport 5900 -rfbauth "$APP_DIR/.vncpass" -ncache 0
run "novnc_proxy" /usr/share/novnc/utils/novnc_proxy --vnc 127.0.0.1:5900 --listen 127.0.0.1:6080
( cd "$APP_DIR" && run "python main.py" "$APP_DIR/.venv/bin/python" main.py )
if [[ "${GROKPC_NO_TUNNEL:-0}" != "1" ]] && command -v cloudflared >/dev/null; then
  run "run_tunnel.sh 8000" bash "$APP_DIR/run_tunnel.sh" 8000 "$DATA_DIR/tunnel_url.txt"
  run "run_tunnel.sh 6080" bash "$APP_DIR/run_tunnel.sh" 6080 "$DATA_DIR/tunnel_vnc_url.txt"
fi
sleep 10
bash "$APP_DIR/show_urls.sh"
