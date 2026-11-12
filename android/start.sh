#!/data/data/com.termux/files/usr/bin/bash
# Start GrokPC on Termux: wake-lock, TigerVNC+IceWM, system Chromium (CDP),
# noVNC, FastAPI, Cloudflare quick tunnels. Idempotent.
set -uo pipefail
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
HOME="${HOME:-/data/data/com.termux/files/home}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# If this copy lives in ~/.grokpc/bin, the repo is $HOME/grokpc
if [[ ! -f "$ROOT/backend/main.py" && -f "$HOME/grokpc/backend/main.py" ]]; then
  ROOT="$HOME/grokpc"
fi
DATA="$HOME/.grokpc"
LOG="$DATA/logs"
ENV_FILE="${GROKPC_ENV:-$DATA/.env}"
NOVNC_DIR="$DATA/novnc"
PROFILE="$DATA/chrome_profile"
mkdir -p "$LOG" "$PROFILE" "$DATA"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
export DISPLAY="${DISPLAY:-:1}"
WIDTH="${VIEWPORT_WIDTH:-1280}"
HEIGHT="${VIEWPORT_HEIGHT:-720}"
CHROMIUM_BIN="${CHROMIUM_PATH:-}"
if [[ -z "$CHROMIUM_BIN" ]]; then
  CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || true)"
fi

running() { pgrep -f "$1" >/dev/null 2>&1; }

# --- VNC / desktop ---
if ! running "Xvnc :1" && ! running "Xtightvnc :1" && [[ ! -e /tmp/.X1-lock && ! -e "$HOME/.vnc/localhost:1.pid" ]]; then
  # If a stale :1 exists, try to reuse; otherwise start.
  if ! DISPLAY=:1 xdpyinfo >/dev/null 2>&1; then
    echo "[grokpc] starting TigerVNC :1 ${WIDTH}x${HEIGHT}"
    vncserver :1 -geometry "${WIDTH}x${HEIGHT}" -depth 24 -localhost yes -xstartup "$ROOT/android/xstartup" \
      >"$LOG/vnc.log" 2>&1 || vncserver :1 -geometry "${WIDTH}x${HEIGHT}" -depth 24 -localhost \
      >"$LOG/vnc.log" 2>&1 || true
  fi
fi
export DISPLAY=:1

# --- Chromium with CDP (visible on the VNC display) ---
if ! curl -sf --max-time 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  if [[ -z "$CHROMIUM_BIN" ]]; then
    echo "[grokpc] ERROR: chromium nahi mila. pkg install chromium (x11-repo) chalao." >&2
  else
    echo "[grokpc] starting Chromium ($CHROMIUM_BIN) with CDP :9222"
    nohup "$CHROMIUM_BIN" \
      --user-data-dir="$PROFILE" \
      --remote-debugging-port=9222 \
      --remote-debugging-address=127.0.0.1 \
      --no-first-run --no-default-browser-check \
      --no-sandbox --disable-setuid-sandbox \
      --disable-gpu --disable-dev-shm-usage \
      --disable-extensions --mute-audio \
      --window-size="${WIDTH},${HEIGHT}" \
      --window-position=0,0 \
      --renderer-process-limit=2 \
      --disk-cache-size=67108864 \
      --disable-features=Translate,BackForwardCache,MediaRouter \
      about:blank >"$LOG/chromium.log" 2>&1 &
    for _try in $(seq 1 20); do
      curl -sf --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break
      sleep 1
    done
  fi
fi

# --- noVNC (only streams when a viewer connects) ---
if ! curl -sf --max-time 2 http://127.0.0.1:6080/ >/dev/null 2>&1; then
  echo "[grokpc] starting websockify / noVNC on 127.0.0.1:6080"
  # TigerVNC on display :1 is port 5901
  if [[ -d "$NOVNC_DIR" ]]; then
    nohup "$DATA/venv/bin/websockify" --heartbeat 30 --web="$NOVNC_DIR" 127.0.0.1:6080 127.0.0.1:5901 \
      >"$LOG/novnc.log" 2>&1 &
  else
    nohup "$DATA/venv/bin/websockify" --heartbeat 30 127.0.0.1:6080 127.0.0.1:5901 \
      >"$LOG/novnc.log" 2>&1 &
  fi
fi

# --- FastAPI ---
if ! curl -sf --max-time 2 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
  echo "[grokpc] starting agent on 127.0.0.1:8000"
  (
    cd "$ROOT/backend" || exit 1
    export PYTHONUNBUFFERED=1
    nohup "$DATA/venv/bin/python" main.py >"$LOG/agent.log" 2>&1 &
  )
  sleep 2
fi

# --- Cloudflare quick tunnels (API + noVNC) ---
if command -v cloudflared >/dev/null 2>&1 && [[ "${GROKPC_NO_TUNNEL:-0}" != "1" ]]; then
  if ! running "run_tunnel.sh 8000"; then
    nohup bash "$ROOT/backend/run_tunnel.sh" 8000 "$DATA/tunnel_url.txt" >"$LOG/tunnel.log" 2>&1 &
  fi
  if ! running "run_tunnel.sh 6080"; then
    nohup bash "$ROOT/backend/run_tunnel.sh" 6080 "$DATA/tunnel_vnc_url.txt" >"$LOG/tunnel-vnc.log" 2>&1 &
  fi
  sleep 8
fi

echo
echo "======= GrokPC (tablet) ======="
if [[ -x "$ROOT/backend/show_urls.sh" ]]; then
  # show_urls.sh defaults to /app — print locally instead
  :
fi
echo "Backend URL : $(cat "$DATA/tunnel_url.txt" 2>/dev/null || echo 'not ready — check ~/.grokpc/logs/tunnel.log')"
v="$(cat "$DATA/tunnel_vnc_url.txt" 2>/dev/null || true)"
echo "noVNC URL   : ${v:+$v/vnc.html}"
if [[ -f "$ENV_FILE" ]]; then
  echo "AGENT_TOKEN : $(grep -m1 '^AGENT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
fi
echo "Logs        : $LOG"
echo "Stop        : bash $ROOT/android/stop.sh"
echo "=============================="
