export interface BackendFile {
  name: string;
  path: string;
  description: string;
  language: string;
  category: 'script' | 'python' | 'config' | 'compose';
  content: string;
}

/** Generated at build time from ../backend. Do not edit by hand. */
export const BACKEND_FILES: BackendFile[] = [
  {
    name: "setup_server.sh",
    path: "/app/agent/setup_server.sh",
    description: "Idempotent Ubuntu 24.04 installer for x86_64 and aarch64: swapfile, IceWM, venv, Playwright, systemd, secrets. Tuned for 4 GB RAM VPS.",
    language: "bash",
    category: "script",
    content: `#!/usr/bin/env bash
# Idempotent installer for Ubuntu 24.04 (x86_64 or aarch64).
# Tuned for a 4 GB RAM VPS (swapfile, IceWM, tighter Chromium flags).
# Usage (sudo-capable user):
#   sudo bash backend/setup_server.sh
#   sudo bash backend/setup_server.sh --with-kdenlive
set -euo pipefail

WITH_KDENLIVE=0
for arg in "$@"; do
  case "$arg" in
    --with-kdenlive) WITH_KDENLIVE=1 ;;
    -h|--help)
      echo "Usage: sudo bash $0 [--with-kdenlive]"
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run with sudo:  sudo bash $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$SCRIPT_DIR"
APP_DIR="/app/agent"
DATA_DIR="/app/data"
CHROME_DIR="/data/chrome_profile"
OUTPUT_DIR="/data/outputs"
GDRIVE_DIR="/mnt/gdrive"
ENV_FILE="$APP_DIR/.env"
VNC_PASS_FILE="$APP_DIR/.vncpass"
INSTALL_USER="\${SUDO_USER:-ubuntu}"
if ! id "$INSTALL_USER" >/dev/null 2>&1; then
  INSTALL_USER="$(getent passwd 1000 | cut -d: -f1 || echo ubuntu)"
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_FAMILY="x86_64"; CF_DEB_NAME="cloudflared-linux-amd64.deb" ;;
  aarch64|arm64) ARCH_FAMILY="aarch64"; CF_DEB_NAME="cloudflared-linux-arm64.deb" ;;
  *) echo "Unsupported architecture: $ARCH (need x86_64 or aarch64)" >&2; exit 1 ;;
esac

# --- environment detection ---
IS_WSL=0
if grep -qiE '(microsoft|wsl)' /proc/sys/kernel/osrelease 2>/dev/null || [[ -n "\${WSL_DISTRO_NAME:-}" ]]; then
  IS_WSL=1
fi
HAS_SYSTEMD=0
if [[ -d /run/systemd/system ]] && [[ "$(ps -p 1 -o comm= 2>/dev/null)" == "systemd" ]]; then
  HAS_SYSTEMD=1
fi
IS_CODESPACE=0
if [[ -n "\${CODESPACES:-}" ]]; then IS_CODESPACE=1; fi

MEM_KB="$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
MEM_GB=$(( MEM_KB / 1024 / 1024 ))
LOW_MEMORY=0
if [[ "$MEM_KB" -gt 0 && "$MEM_KB" -lt $((6 * 1024 * 1024)) ]]; then
  LOW_MEMORY=1
fi
if [[ "$LOW_MEMORY" -eq 1 ]]; then
  VIEW_W=1280
  VIEW_H=720
  SWAP_SIZE="2G"
else
  VIEW_W=1440
  VIEW_H=900
  SWAP_SIZE="2G"
fi

echo "=== GrokPC server setup ==="
echo "User: $INSTALL_USER"
echo "Arch: $ARCH ($ARCH_FAMILY)"
echo "RAM:  \${MEM_GB} GB  (low-memory mode: $LOW_MEMORY)"
echo "WSL: $IS_WSL  systemd: $HAS_SYSTEMD  codespace: $IS_CODESPACE"
echo "Source: $APP_SRC"
echo "Target: $APP_DIR"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi
if [[ "\${ID:-}" != "ubuntu" || "\${VERSION_ID:-}" != "24.04" ]]; then
  echo "WARNING: this script is written for Ubuntu 24.04. Detected \${PRETTY_NAME:-unknown}."
  echo "Continuing anyway in 5s... (Ctrl-C to abort)"
  sleep 5
fi

# --- swapfile (important on a 4 GB VPS) ---
ensure_swap() {
  local existing
  existing="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  # If we already have >= 1.5 GB swap, leave it alone
  if [[ "\${existing:-0}" -ge $((1500 * 1024)) ]]; then
    echo "Swap already present ($existing kB) — leaving it."
    return 0
  fi
  if [[ -f /swapfile ]]; then
    swapon /swapfile 2>/dev/null || true
    existing="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
    if [[ "\${existing:-0}" -ge $((1500 * 1024)) ]]; then
      echo "Enabled existing /swapfile."
      return 0
    fi
  fi
  echo "Creating \${SWAP_SIZE} swapfile at /swapfile (needed on a 4 GB VPS)..."
  swapoff /swapfile 2>/dev/null || true
  rm -f /swapfile
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l "$SWAP_SIZE" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  else
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -qE '^/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  # Prefer using swap only when RAM is tight
  sysctl -w vm.swappiness=30 >/dev/null
  if ! grep -q '^vm.swappiness' /etc/sysctl.conf 2>/dev/null; then
    echo 'vm.swappiness=30' >> /etc/sysctl.conf
  fi
  echo "Swap is now: $(awk '/SwapTotal:/ {print $2}' /proc/meminfo) kB"
}
if [[ "$IS_WSL" -eq 1 ]]; then
  echo "WSL detected: swap is managed by Windows (.wslconfig) — skipping swapfile."
elif [[ "$IS_CODESPACE" -eq 1 || "$HAS_SYSTEMD" -eq 0 ]]; then
  echo "Container without systemd — skipping swapfile."
else
  ensure_swap
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
# Lightweight desktop: IceWM + xterm (not full XFCE). Goodies/KDE skipped on purpose for 4 GB boxes.
apt-get install -y --no-install-recommends \\
  ca-certificates curl wget git jq unzip tar sudo rsync \\
  python3 python3-venv python3-pip python3-dev \\
  build-essential \\
  xvfb icewm xterm x11-xkb-utils \\
  x11vnc novnc websockify \\
  ffmpeg fonts-dejavu-core \\
  rclone fuse3 sqlite3 \\
  libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \\
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \\
  libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \\
  fonts-liberation libxss1

# Pulse is optional and a bit heavy on 4 GB — skip unless already wanted
if [[ "$LOW_MEMORY" -eq 0 ]]; then
  apt-get install -y --no-install-recommends pulseaudio || true
fi

if [[ "$WITH_KDENLIVE" -eq 1 ]]; then
  echo "Installing Kdenlive (heavy — a 4 GB VPS will struggle; swap will be used)..."
  apt-get install -y --no-install-recommends kdenlive
fi

if [[ -f /etc/fuse.conf ]]; then
  if grep -qE '^#? *user_allow_other' /etc/fuse.conf; then
    sed -i 's/^#\\s*user_allow_other/user_allow_other/' /etc/fuse.conf
  else
    echo "user_allow_other" >> /etc/fuse.conf
  fi
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$CHROME_DIR" "$OUTPUT_DIR" "$GDRIVE_DIR" /app/logs
rsync -a --delete --exclude '.env' --exclude '.venv' --exclude '.vncpass' --exclude '__pycache__' --exclude '.git' \\
  "$APP_SRC/" "$APP_DIR/"
chmod +x "$APP_DIR"/setup_server.sh "$APP_DIR"/run_tunnel.sh "$APP_DIR"/show_urls.sh "$APP_DIR"/start_stack.sh 2>/dev/null || true

if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
  python3 -m venv "$APP_DIR/.venv"
fi
# shellcheck disable=SC1091
source "$APP_DIR/.venv/bin/activate"
pip install --upgrade pip setuptools wheel
# Use exact pins; let pip pick wheels for this CPU (x86_64 or aarch64).
# Optional arch-specific lock files are used when present.
LOCK_FILE=""
if [[ -f "$APP_DIR/requirements-\${ARCH_FAMILY}.lock" ]]; then
  LOCK_FILE="$APP_DIR/requirements-\${ARCH_FAMILY}.lock"
elif [[ -f "$APP_DIR/requirements.lock" && "$ARCH_FAMILY" == "aarch64" ]]; then
  LOCK_FILE="$APP_DIR/requirements.lock"
fi
if [[ -n "$LOCK_FILE" ]]; then
  echo "Installing $LOCK_FILE"
  pip install -r "$LOCK_FILE"
else
  pip install -r "$APP_DIR/requirements.txt"
fi
python -m playwright install-deps chromium || true
sudo -u "$INSTALL_USER" -H "$APP_DIR/.venv/bin/python" -m playwright install chromium

GEN_TOKEN=""
GEN_VNCPW=""
if [[ ! -f "$ENV_FILE" ]]; then
  GEN_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  GEN_VNCPW="$(python3 -c 'import secrets,string; a=string.ascii_letters+string.digits; print("".join(secrets.choice(a) for _ in range(16)))')"
  umask 077
  cat > "$ENV_FILE" <<EOF
AGENT_TOKEN=\${GEN_TOKEN}
DEEPSEEK_API_KEY=
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
HOST=127.0.0.1
PORT=8000
FRONTEND_ORIGINS=https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000
CHROME_PROFILE_DIR=\${CHROME_DIR}
GDRIVE_DIR=\${GDRIVE_DIR}
OUTPUT_DIR=
DB_PATH=\${DATA_DIR}/agent_tasks.db
USE_GEMINI_TTS=0
GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts
GEMINI_VISION_MODEL=gemini-2.5-flash
DEEPSEEK_MODEL=deepseek-flash
USD_INR_RATE=88
MONTHLY_CAP_INR=1000
DRY_RUN=0
HEADLESS=0
MAX_VISION_STEPS=12
NOVNC_UPSTREAM=http://127.0.0.1:6080
LOW_MEMORY=\${LOW_MEMORY}
VIEWPORT_WIDTH=\${VIEW_W}
VIEWPORT_HEIGHT=\${VIEW_H}
EOF
else
  echo "Keeping existing $ENV_FILE"
  # Do not overwrite secrets; fill missing low-mem knobs if absent
  grep -q '^LOW_MEMORY=' "$ENV_FILE" || echo "LOW_MEMORY=\${LOW_MEMORY}" >> "$ENV_FILE"
  grep -q '^VIEWPORT_WIDTH=' "$ENV_FILE" || echo "VIEWPORT_WIDTH=\${VIEW_W}" >> "$ENV_FILE"
  grep -q '^VIEWPORT_HEIGHT=' "$ENV_FILE" || echo "VIEWPORT_HEIGHT=\${VIEW_H}" >> "$ENV_FILE"
fi

if [[ ! -f "$VNC_PASS_FILE" ]]; then
  if [[ -z "\${GEN_VNCPW}" ]]; then
    GEN_VNCPW="$(python3 -c 'import secrets,string; a=string.ascii_letters+string.digits; print("".join(secrets.choice(a) for _ in range(16)))')"
  fi
  x11vnc -storepasswd "$GEN_VNCPW" "$VNC_PASS_FILE" >/dev/null
fi

chown -R "$INSTALL_USER:$INSTALL_USER" /app /data "$GDRIVE_DIR"
chmod 600 "$ENV_FILE" 2>/dev/null || true
chmod 600 "$VNC_PASS_FILE" 2>/dev/null || true

# IceWM is much lighter than XFCE — better on 4 GB RAM.
cat > /etc/systemd/system/grokpc-desktop.service <<EOF
[Unit]
Description=GrokPC virtual desktop (Xvfb + IceWM + x11vnc + noVNC)
After=network.target

[Service]
Type=simple
User=\${INSTALL_USER}
Environment=DISPLAY=:99
Environment=HOME=/home/\${INSTALL_USER}
ExecStartPre=/bin/sh -c 'rm -f /tmp/.X99-lock || true'
ExecStart=/bin/bash -c '\\
  Xvfb :99 -screen 0 \${VIEW_W}x\${VIEW_H}x24 -nolisten tcp & \\
  sleep 2; \\
  DISPLAY=:99 setxkbmap -layout us || true; \\
  DISPLAY=:99 icewm & \\
  sleep 1; \\
  x11vnc -display :99 -localhost -forever -shared -rfbport 5900 -nopw -ncache 0 -xkb -skip_lockkeys -clear_mods -clear_keys & \\
  /usr/share/novnc/utils/novnc_proxy --vnc 127.0.0.1:5900 --listen 127.0.0.1:6080'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# MemoryMax leaves headroom for Chromium + the desktop on a 4 GB box.
AGENT_MEM="3G"
if [[ "$LOW_MEMORY" -eq 1 ]]; then
  AGENT_MEM="2G"
fi

cat > /etc/systemd/system/grokpc-agent.service <<EOF
[Unit]
Description=GrokPC FastAPI agent (localhost only)
After=network.target grokpc-desktop.service

[Service]
Type=simple
User=\${INSTALL_USER}
WorkingDirectory=\${APP_DIR}
Environment=PATH=\${APP_DIR}/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
Environment=DISPLAY=:99
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-\${ENV_FILE}
ExecStart=\${APP_DIR}/.venv/bin/python main.py
Restart=always
RestartSec=5
MemoryMax=\${AGENT_MEM}

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/rclone-gdrive.service <<EOF
[Unit]
Description=Rclone mount for Google Drive (gdrive: -> /mnt/gdrive)
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=\${INSTALL_USER}
ExecStart=/usr/bin/rclone mount gdrive: \${GDRIVE_DIR} \\\\
  --config=/home/\${INSTALL_USER}/.config/rclone/rclone.conf \\\\
  --allow-other \\\\
  --vfs-cache-mode full \\\\
  --vfs-cache-max-size 2G \\\\
  --vfs-read-chunk-size 16M \\\\
  --umask 022
ExecStop=/bin/fusermount3 -u \${GDRIVE_DIR}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# cloudflared for this CPU
if ! command -v cloudflared >/dev/null 2>&1; then
  CF_DEB="$(mktemp /tmp/cloudflared.XXXXXX.deb)"
  wget -q -O "$CF_DEB" "https://github.com/cloudflare/cloudflared/releases/latest/download/\${CF_DEB_NAME}"
  dpkg -i "$CF_DEB" || apt-get install -f -y
  rm -f "$CF_DEB"
fi

# Quick tunnel service: exposes 127.0.0.1:8000 (API + /novnc) and 127.0.0.1:6080,
# writes current URLs to /app/data/tunnel_url.txt and tunnel_vnc_url.txt
cat > /etc/systemd/system/grokpc-tunnel.service <<EOF
[Unit]
Description=GrokPC Cloudflare quick tunnel (API)
After=network-online.target grokpc-agent.service
Wants=network-online.target

[Service]
Type=simple
User=\${INSTALL_USER}
ExecStart=/bin/bash \${APP_DIR}/run_tunnel.sh 8000 \${DATA_DIR}/tunnel_url.txt
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/grokpc-tunnel-vnc.service <<EOF
[Unit]
Description=GrokPC Cloudflare quick tunnel (noVNC)
After=network-online.target grokpc-desktop.service
Wants=network-online.target

[Service]
Type=simple
User=\${INSTALL_USER}
ExecStart=/bin/bash \${APP_DIR}/run_tunnel.sh 6080 \${DATA_DIR}/tunnel_vnc_url.txt
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

if [[ "$HAS_SYSTEMD" -eq 1 ]]; then
  systemctl daemon-reload
  systemctl disable --now oracle-desktop.service 2>/dev/null || true
  systemctl disable --now oracle-agent.service 2>/dev/null || true
  systemctl enable --now grokpc-desktop.service
  systemctl enable --now grokpc-agent.service
  if [[ "\${GROKPC_NO_TUNNEL:-0}" != "1" ]]; then
    systemctl enable --now grokpc-tunnel.service; systemctl disable --now grokpc-tunnel-vnc.service 2>/dev/null || true  # VNC only via token-protected /novnc proxy
  fi
else
  echo "No systemd: starting the stack with start_stack.sh (background processes)."
  sudo -u "$INSTALL_USER" -H bash "$APP_DIR/start_stack.sh" || true
fi

echo
echo "================================================================"
echo "GrokPC setup finished.  arch=\${ARCH}  ram=\${MEM_GB}GB  low_mem=\${LOW_MEMORY}"
echo "================================================================"
echo "Desktop unit:  systemctl status grokpc-desktop"
echo "Agent unit:    systemctl status grokpc-agent"
echo "API (local):   http://127.0.0.1:8000   (not exposed to the internet)"
echo "noVNC (local): http://127.0.0.1:6080/vnc.html"
echo
if [[ -n "\${GEN_TOKEN}" ]]; then
  echo "AGENT_TOKEN (save this, shown only because .env was just created):"
  echo "  \${GEN_TOKEN}"
  echo
fi
if [[ -n "\${GEN_VNCPW}" ]]; then
  echo "VNC password (shown only because it was just created):"
  echo "  \${GEN_VNCPW}"
  echo "  (stored in \${VNC_PASS_FILE})"
  echo
fi
sleep 8
if [[ -s "\${DATA_DIR}/tunnel_url.txt" ]]; then
  echo "Backend tunnel URL:  $(cat "\${DATA_DIR}/tunnel_url.txt")"
fi
if [[ -s "\${DATA_DIR}/tunnel_vnc_url.txt" ]]; then
  echo "noVNC tunnel URL:    $(cat "\${DATA_DIR}/tunnel_vnc_url.txt")/vnc.html"
fi
echo "Show again any time: sudo bash \${APP_DIR}/show_urls.sh"
echo
echo "Next:"
echo "  1. Edit \${ENV_FILE} and add DEEPSEEK_API_KEY (optional GEMINI / Telegram)."
echo "     Then: sudo systemctl restart grokpc-agent"
echo "  2. Expose localhost with Cloudflare Tunnel (see SERVER_STEPS.md)."
echo "       cloudflared tunnel --url http://127.0.0.1:8000"
echo "  3. In the app Settings, paste the tunnel URL and AGENT_TOKEN."
echo "  4. Open noVNC and log into WhatsApp/Gmail once."
echo "  5. Optional Google Drive:"
echo "       sudo -u \${INSTALL_USER} rclone config     # name the remote: gdrive"
echo "       sudo systemctl enable --now rclone-gdrive"
echo "================================================================"
`,
  },
  {
    name: "main.py",
    path: "/app/agent/main.py",
    description: "FastAPI + WebSocket: jobs/channels API, vision /api/task, health, budget. Messaging removed.",
    language: "python",
    category: "python",
    content: `"""GrokPC FastAPI server — video-production jobs + the existing vision agent.

Phase 1 adds jobs/channels/pipeline APIs. The live /api/task vision loop (the
one that already opened YouTube) is unchanged. Messaging endpoints are gone.
Phase 2 features are flag-gated and default OFF.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.websockets import WebSocket, WebSocketDisconnect

from agent_core import BrowserAgentCore
from auth import cors_origins, require_auth, token_from_ws, tokens_match
from channels import add_channel, delete_channel, get_channel, list_channels, update_channel
from config import (
    ANDROID,
    CHROME_PROFILE_DIR,
    DRY_RUN,
    FEATURE_AUTOPILOT,
    FEATURE_YOUTUBE_UPLOAD,
    HOST,
    PORT,
    feature_flags,
    pipeline_steps,
    require_token,
)
from db import budget_summary, init_db, today_stats
from desktop_client import helper_status
from jobs import (
    active_job,
    append_log,
    cancel_job,
    create_job,
    get_job,
    list_jobs,
    list_logs,
    pause_job,
    resume_job,
    running_job,
    update_job,
)
from job_preview import build_preview
from novnc_proxy import router as novnc_router
from pipeline import PipelineRunner
from runtime_settings import load_settings, save_settings
from style_profile import load_profile, save_profile
from video_pipeline import render_video

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("grokpc.main")

clients: list[WebSocket] = []
agent: Optional[BrowserAgentCore] = None
runner: Optional[PipelineRunner] = None
_main_loop: Optional[asyncio.AbstractEventLoop] = None


async def broadcast(payload: dict[str, Any]) -> None:
    if "timestamp" not in payload:
        payload["timestamp"] = time.strftime("%H:%M:%S")
    if "id" not in payload:
        payload["id"] = f"log-{uuid.uuid4().hex[:10]}"
    text = json.dumps(payload, default=str)
    dead: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in clients:
            clients.remove(ws)


def _port_open(host: str, port: int) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


def _health_payload() -> dict[str, Any]:
    import os
    import shutil

    total, used, _free = shutil.disk_usage("/")
    mem_total_gb = mem_used_gb = cpu = None
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                key, _, rest = line.partition(":")
                info[key] = int(rest.split()[0])
            mem_total_gb = round(info.get("MemTotal", 0) / 1024 / 1024, 1)
            avail = info.get("MemAvailable", 0) / 1024 / 1024
            mem_used_gb = round(mem_total_gb - avail, 1) if mem_total_gb else None
    except Exception:
        pass
    try:
        with open("/proc/loadavg") as f:
            cpu = round(float(f.read().split()[0]) * 25, 1)
    except Exception:
        pass
    gdrive = "/mnt/gdrive"
    return {
        "connected": True,
        "hostname": os.uname().nodename,
        "os": " ".join(os.uname()),
        "architecture": os.uname().machine,
        "cpuUsagePercent": cpu or 0,
        "cpuCores": os.cpu_count() or 1,
        "ramTotalGb": mem_total_gb or 0,
        "ramUsedGb": mem_used_gb or 0,
        "diskTotalGb": round(total / (1024**3), 1),
        "diskUsedGb": round(used / (1024**3), 1),
        "chromeProfileLocked": os.path.exists(os.path.join(CHROME_PROFILE_DIR, "SingletonLock")),
        "gdriveMounted": os.path.isdir(gdrive) and os.path.ismount(gdrive),
        "novncPortActive": _port_open("127.0.0.1", 6080),
        "fastapiPortActive": True,
        "dryRun": DRY_RUN,
        "lastPing": int(time.time() * 1000),
        "android": ANDROID,
        "agentBusy": bool(agent and agent.is_busy),
    }


async def _status_payload() -> dict[str, Any]:
    health = _health_payload()
    stats = today_stats()
    settings = load_settings()
    current = running_job()
    if current is None and runner and runner.current_job_id:
        current = get_job(runner.current_job_id)
    helper = await helper_status()
    return {
        "ok": True,
        "phase": 1,
        "features": feature_flags(),
        "steps": pipeline_steps(),
        "dryRun": DRY_RUN,
        "busy": bool(agent and agent.is_busy) or bool(current),
        "agentBusy": bool(agent and agent.is_busy),
        "currentJob": (
            {
                "id": current["id"],
                "topic": current["topic"],
                "status": current["status"],
                "current_step": current["current_step"],
                "channel_id": current["channel_id"],
            }
            if current
            else None
        ),
        "helper": helper,
        "autopilot": {
            "feature": FEATURE_AUTOPILOT,
            "enabled": bool(settings.get("autopilot_enabled")) and FEATURE_AUTOPILOT,
            "quiet_hours": settings.get("quiet_hours"),
            "idle_seconds": settings.get("idle_seconds"),
            "daily_video_cap": settings.get("daily_video_cap"),
            "daily_spend_cap_inr": settings.get("daily_spend_cap_inr"),
        },
        "today": {
            "videos": stats["videosToday"],
            "spendInr": stats["spendInrToday"],
            "videoCap": settings.get("daily_video_cap"),
            "spendCapInr": settings.get("daily_spend_cap_inr"),
        },
        "channels": len(list_channels()),
        "health": {
            "hostname": health["hostname"],
            "ramUsedGb": health["ramUsedGb"],
            "ramTotalGb": health["ramTotalGb"],
            "novncPortActive": health["novncPortActive"],
        },
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent, runner, _main_loop
    require_token()
    init_db()
    from channels import ensure_defaults

    ensure_defaults()
    load_profile()
    _main_loop = asyncio.get_running_loop()
    agent = BrowserAgentCore(log_callback=broadcast)
    runner = PipelineRunner(agent=agent, broadcast=broadcast)
    await runner.start()
    # Phase 2 autopilot loop is intentionally not started unless the flag is on.
    if FEATURE_AUTOPILOT:
        logger.info("FEATURE_AUTOPILOT=1 — scaffold is present; enable the toggle in Settings to use it")
    yield
    if runner:
        await runner.stop()
    if agent:
        await agent.close()


app = FastAPI(title="GrokPC Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)
app.include_router(novnc_router)


# ---------------------------------------------------------------------------
# Health, budget, compact status (for Grok Bot supervision)
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def get_health(_auth: str = Depends(require_auth)):
    body = _health_payload()
    try:
        body["features"] = feature_flags()
        body["phase"] = 1
        current = running_job()
        body["currentJobId"] = current["id"] if current else None
    except Exception:
        pass
    return body


@app.get("/api/budget")
async def get_budget(_auth: str = Depends(require_auth)):
    summary = budget_summary()
    summary.update(today_stats())
    settings = load_settings()
    summary["dailyVideoCap"] = settings.get("daily_video_cap")
    summary["dailySpendCapInr"] = settings.get("daily_spend_cap_inr")
    return summary


@app.get("/api/status")
async def get_status(_auth: str = Depends(require_auth)):
    return await _status_payload()


@app.get("/api/credits")
async def get_credits(_auth: str = Depends(require_auth)):
    """Phase 2 balances. When the flag is off we only report spend, not site quotas."""
    from config import FEATURE_CREDIT_CHECK

    stats = today_stats()
    return {
        "phase": 2 if FEATURE_CREDIT_CHECK else 1,
        "feature": FEATURE_CREDIT_CHECK,
        "todaySpendInr": stats["spendInrToday"],
        "providers": [],
        "note": (
            "Live Veo/Grok credit scrape is Phase 2 and off by default."
            if not FEATURE_CREDIT_CHECK
            else "Credit check enabled — run a generate step to record a decision."
        ),
    }


# ---------------------------------------------------------------------------
# Channels + style + runtime settings
# ---------------------------------------------------------------------------


@app.get("/api/channels")
async def api_list_channels(_auth: str = Depends(require_auth)):
    return {"channels": list_channels()}


class ChannelIn(BaseModel):
    name: str
    niche: str = ""
    language: str = "Hindi"
    style: str = ""
    youtube_url: str = ""
    schedule: Optional[dict[str, Any]] = None
    aspect: str = "16:9"
    enabled: bool = True
    id: Optional[str] = None


@app.post("/api/channels")
async def api_add_channel(req: ChannelIn, _auth: str = Depends(require_auth)):
    try:
        ch = add_channel(req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"channel": ch}


@app.put("/api/channels/{channel_id}")
async def api_update_channel(channel_id: str, req: ChannelIn, _auth: str = Depends(require_auth)):
    try:
        ch = update_channel(channel_id, req.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown channel")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"channel": ch}


@app.delete("/api/channels/{channel_id}")
async def api_delete_channel(channel_id: str, _auth: str = Depends(require_auth)):
    try:
        delete_channel(channel_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown channel")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/style-profile")
async def api_get_style(_auth: str = Depends(require_auth)):
    return {"profile": load_profile()}


@app.put("/api/style-profile")
async def api_put_style(payload: dict[str, Any], _auth: str = Depends(require_auth)):
    return {"profile": save_profile(payload)}


@app.get("/api/settings")
async def api_get_settings(_auth: str = Depends(require_auth)):
    return {"settings": load_settings(), "features": feature_flags()}


class SettingsIn(BaseModel):
    quiet_hours: Optional[str] = None
    idle_seconds: Optional[int] = None
    daily_video_cap: Optional[int] = None
    daily_spend_cap_inr: Optional[float] = None
    autopilot_enabled: Optional[bool] = None


@app.put("/api/settings")
@app.post("/api/settings")
async def api_put_settings(req: SettingsIn, _auth: str = Depends(require_auth)):
    data = save_settings(req.model_dump(exclude_none=True))
    return {"settings": data, "features": feature_flags()}


@app.get("/api/autopilot")
async def api_get_autopilot(_auth: str = Depends(require_auth)):
    settings = load_settings()
    from scheduler import should_run_autopilot

    ok, reason = should_run_autopilot(settings)
    return {
        "feature": FEATURE_AUTOPILOT,
        "enabled": bool(settings.get("autopilot_enabled")) and FEATURE_AUTOPILOT,
        "would_run": ok,
        "reason": reason,
        "settings": settings,
        "note": None if FEATURE_AUTOPILOT else "Phase 2 — FEATURE_AUTOPILOT is off. Toggle does nothing until the flag is enabled.",
    }


class AutopilotIn(BaseModel):
    enabled: bool


@app.post("/api/autopilot")
async def api_set_autopilot(req: AutopilotIn, _auth: str = Depends(require_auth)):
    data = save_settings({"autopilot_enabled": req.enabled})
    return {
        "feature": FEATURE_AUTOPILOT,
        "enabled": bool(data.get("autopilot_enabled")) and FEATURE_AUTOPILOT,
        "settings": data,
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


class JobIn(BaseModel):
    channel_id: str
    topic: str
    idea: str = ""
    autopilot: bool = False


@app.get("/api/jobs")
async def api_list_jobs(
    limit: int = 50,
    status: Optional[str] = None,
    channel_id: Optional[str] = None,
    _auth: str = Depends(require_auth),
):
    return {"jobs": list_jobs(limit=limit, status=status, channel_id=channel_id)}


@app.post("/api/jobs")
async def api_create_job(req: JobIn, _auth: str = Depends(require_auth)):
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic is required")
    if req.channel_id and not get_channel(req.channel_id):
        # Still allow unknown ids so tests / first-run can pass a placeholder,
        # but prefer known channels.
        if not req.channel_id.startswith("ch"):
            raise HTTPException(status_code=404, detail="Unknown channel")
    current = active_job()
    if current:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Ek video already ban raha hai ({current['id']}, {current['status']})"
            ),
        )
    job = create_job(
        channel_id=req.channel_id,
        topic=topic,
        idea=req.idea.strip(),
        autopilot=req.autopilot,
    )
    await broadcast(
        {
            "type": "system",
            "title": "New job",
            "message": f"{job['topic']} ({job['id']})",
            "jobId": job["id"],
        }
    )
    if runner:
        await runner.enqueue_and_kick(job["id"])
    return {"job": job, "status": "queued"}


@app.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str, _auth: str = Depends(require_auth)):
    job = get_job(job_id, with_logs=True, log_limit=80)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    return {"job": job}


@app.get("/api/jobs/{job_id}/logs")
async def api_job_logs(job_id: str, limit: int = 200, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    return {"logs": list_logs(job_id, limit=limit)}


def _job_video_file(job: dict[str, Any]) -> Path | None:
    for key in ("final_path", "video_path"):
        raw = (job.get(key) or "").strip()
        if not raw:
            continue
        path = Path(raw)
        if path.is_file():
            return path
    return None


def _download_filename(job_id: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in job_id)[:80] or "job"
    return f"GrokPC_{safe}.mp4"


@app.get("/api/jobs/{job_id}/preview")
async def api_job_preview(
    job_id: str,
    format: str = "json",
    _auth: str = Depends(require_auth),
):
    """Latest scene still or a frame from the partial/final video, plus the
    current log line. Auth: Bearer or ?token=. Not a live device-screen mirror.
    """
    preview = build_preview(job_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Unknown job")
    if format == "image":
        raw = preview.get("image_b64")
        if not raw:
            raise HTTPException(status_code=404, detail="No preview yet")
        import base64

        return Response(
            content=base64.b64decode(raw),
            media_type=preview.get("mime") or "image/jpeg",
            headers={"Cache-Control": "no-store"},
        )
    return JSONResponse(preview, headers={"Cache-Control": "no-store"})


@app.get("/api/jobs/{job_id}/download")
async def api_download_job(job_id: str, _auth: str = Depends(require_auth)):
    """Return the job's final video as an attachment. Auth: Bearer or ?token=."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    path = _job_video_file(job)
    if not path:
        raise HTTPException(status_code=404, detail="Video file missing")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=_download_filename(job_id),
        content_disposition_type="attachment",
    )


@app.post("/api/jobs/{job_id}/pause")
async def api_pause_job(job_id: str, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    job = pause_job(job_id)
    await broadcast({"type": "system", "title": "Job paused", "message": job_id, "jobId": job_id})
    return {"job": job}


@app.post("/api/jobs/{job_id}/resume")
async def api_resume_job(job_id: str, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    job = resume_job(job_id)
    if runner:
        await runner.enqueue_and_kick(job_id)
    await broadcast({"type": "system", "title": "Job resumed", "message": job_id, "jobId": job_id})
    return {"job": job}


@app.post("/api/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    job = cancel_job(job_id)
    await broadcast({"type": "system", "title": "Job cancelled", "message": job_id, "jobId": job_id})
    return {"job": job}


@app.post("/api/jobs/{job_id}/approve-publish")
async def api_approve_publish(job_id: str, _auth: str = Depends(require_auth)):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    if not FEATURE_YOUTUBE_UPLOAD:
        raise HTTPException(
            status_code=409,
            detail="YouTube publish is Phase 2 and FEATURE_YOUTUBE_UPLOAD is off. The final file is already on disk.",
        )
    if not job.get("youtube_id"):
        raise HTTPException(status_code=409, detail="This job has no private YouTube upload yet")
    from youtube_upload import approve_publish

    result = await approve_publish(job["youtube_id"], agent=agent, log=broadcast)
    if result.get("status") in {"ok", "success"}:
        append_log(job_id, "info", "Approved publish (Public)", step="upload")
        job = update_job(job_id, youtube_privacy="public", status="completed")
    else:
        append_log(job_id, "error", f"Publish failed: {result}", step="upload")
    return {"job": job, "result": result}


# ---------------------------------------------------------------------------
# Existing vision task + leftover video shortcut (kept working)
# ---------------------------------------------------------------------------


class OpenUrlRequest(BaseModel):
    url: str


class TaskRequest(BaseModel):
    prompt: str


class VideoRequest(BaseModel):
    topic: str
    script: str = ""
    language: str = "Hindi"
    duration_seconds: int = 15
    use_google_vids: bool = False
    channel_id: str = ""


@app.post("/api/browser/open")
async def api_open_url(req: OpenUrlRequest, _auth: str = Depends(require_auth)):
    """Open a URL in the visible persistent Chrome profile. No typing, no clicks."""
    if agent is None:
        raise HTTPException(status_code=503, detail="Agent is not ready")
    url = (req.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")
    if len(url) > 2000:
        raise HTTPException(status_code=400, detail="url too long")
    return await agent.open_visible_url(url)


@app.post("/api/task")
async def run_task(req: TaskRequest, _auth: str = Depends(require_auth)):
    """Unchanged vision-agent entry point — 'youtube kholo' still goes here."""
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Empty prompt")

    async def _run():
        try:
            result = await agent.run_generic_task(prompt)
            await broadcast({"type": "action", "title": "Agent finished", "message": str(result.get("result") or result)[:800]})
        except Exception as exc:
            logger.exception("task")
            await broadcast({"type": "error", "title": "Task failed", "message": str(exc)})

    asyncio.create_task(_run())
    return {"status": "started", "message": "Vision agent started"}


@app.post("/api/vids/generate")
@app.post("/api/video/generate")
async def generate_video(req: VideoRequest, _auth: str = Depends(require_auth)):
    """Legacy shortcut. If a channel is given, create a proper job; otherwise
    run the old FFmpeg+gTTS path so existing clients keep working.
    """
    if req.channel_id:
        job = create_job(channel_id=req.channel_id, topic=req.topic, idea=req.script)
        if runner:
            await runner.enqueue_and_kick(job["id"])
        return {"status": "queued", "job": job}

    async def _run():
        try:
            result = await render_video(
                topic=req.topic,
                script=req.script or req.topic,
                language=req.language,
                duration_seconds=req.duration_seconds,
                log=broadcast,
            )
            await broadcast({"type": "system", "title": "Video pipeline finished", "message": result.get("video_path", "")})
        except Exception as exc:
            logger.exception("video pipeline")
            await broadcast({"type": "error", "title": "Video failed", "message": str(exc)})

    asyncio.create_task(_run())
    return {"status": "started", "message": "FFmpeg + gTTS pipeline started (Gemini TTS if enabled)."}


@app.websocket("/ws")
async def websocket_logs(websocket: WebSocket):
    if not tokens_match(token_from_ws(websocket)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    clients.append(websocket)
    await websocket.send_text(
        json.dumps(
            {
                "id": "hello",
                "type": "system",
                "title": "Connected",
                "message": "Connected to GrokPC agent WebSocket.",
                "timestamp": time.strftime("%H:%M:%S"),
            }
        )
    )
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("cmd") == "ping":
                await websocket.send_text(
                    json.dumps({"type": "system", "title": "pong", "timestamp": time.strftime("%H:%M:%S")})
                )
    except WebSocketDisconnect:
        if websocket in clients:
            clients.remove(websocket)


if __name__ == "__main__":
    require_token()
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
`,
  },
  {
    name: "agent_core.py",
    path: "/app/agent/agent_core.py",
    description: "Playwright persistent browser and vision-loop tasks (YouTube etc.).",
    language: "python",
    category: "python",
    content: `"""Playwright persistent browser + vision-loop tasks (the path that already opened YouTube)."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from config import (
    ANDROID, CDP_URL, CHROME_PROFILE_DIR, CHROMIUM_PATH, DRY_RUN, HEADLESS,
    LOW_MEMORY, VIEWPORT_HEIGHT, VIEWPORT_WIDTH,
)
from vision_loop import MockLLM, run_vision_task

try:
    from playwright.async_api import BrowserContext, Page, async_playwright  # type: ignore
    PLAYWRIGHT_AVAILABLE = True
except ImportError:  # tablet / Termux worker has no Playwright
    BrowserContext = Any  # type: ignore[misc,assignment]
    Page = Any  # type: ignore[misc,assignment]
    async_playwright = None  # type: ignore[assignment]
    PLAYWRIGHT_AVAILABLE = False

logger = logging.getLogger("grokpc.agent")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]


class BrowserAgentCore:
    def __init__(self, log_callback: Optional[LogFn] = None):
        self.log_callback = log_callback
        self.playwright = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_busy = False
        self._lock = asyncio.Lock()
        self._external_browser = False  # CDP-attached; do not kill Chromium on close

    async def emit(self, typ: str, title: str, message: str, **extra: Any) -> None:
        payload = {"type": typ, "title": title, "message": message, **extra}
        logger.info("[%s] %s: %s", typ, title, message)
        if self.log_callback:
            await self.log_callback(payload)

    async def initialize_browser(self, headless: Optional[bool] = None) -> BrowserContext:
        if self.context:
            return self.context
        if not PLAYWRIGHT_AVAILABLE or async_playwright is None:
            raise RuntimeError(
                "Playwright is not installed on this worker. "
                "Browser visuals and /api/task are unavailable; "
                "the video pipeline still runs with Gemini/gTTS/FFmpeg fallback visuals."
            )
        os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
        await self.emit("system", "Launching browser", f"Profile {CHROME_PROFILE_DIR}")
        self.playwright = await async_playwright().start()
        launch_headless = HEADLESS if headless is None else headless
        chrome_args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-blink-features=AutomationControlled",
            "--renderer-process-limit=3",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-translate",
            "--mute-audio",
            "--no-first-run",
        ]
        if LOW_MEMORY or ANDROID:
            chrome_args += [
                "--js-flags=--max-old-space-size=384",
                "--renderer-process-limit=2",
                "--disable-features=Translate,BackForwardCache,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion",
                "--disk-cache-size=67108864",
                "--force-device-scale-factor=1",
            ]

        if CDP_URL:
            # Preferred on Termux: attach to a system Chromium we already started.
            last_err: Exception | None = None
            for attempt in range(1, 16):
                try:
                    browser = await self.playwright.chromium.connect_over_cdp(CDP_URL)
                    self._external_browser = True
                    self.context = browser.contexts[0] if browser.contexts else await browser.new_context(
                        viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
                    )
                    pages = self.context.pages
                    self.page = pages[0] if pages else await self.context.new_page()
                    try:
                        await self.page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
                    except Exception:
                        pass
                    await self.emit("system", "Browser ready", f"cdp={CDP_URL} low_mem={LOW_MEMORY} {VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}")
                    return self.context
                except Exception as exc:
                    last_err = exc
                    await self.emit("system", "CDP wait", f"attempt {attempt}/15: {exc}")
                    await asyncio.sleep(2)
            raise RuntimeError(f"Could not connect to Chromium at {CDP_URL}: {last_err}")

        # Bundled Chromium (VPS / WSL) or a system binary via CHROMIUM_PATH (Termux fallback).
        if CHROMIUM_PATH:
            os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "0")
        launch_kwargs: dict[str, Any] = dict(
            user_data_dir=CHROME_PROFILE_DIR,
            headless=launch_headless,
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            args=chrome_args,
        )
        if CHROMIUM_PATH:
            launch_kwargs["executable_path"] = CHROMIUM_PATH
        self.context = await self.playwright.chromium.launch_persistent_context(**launch_kwargs)
        pages = self.context.pages
        self.page = pages[0] if pages else await self.context.new_page()
        how = f"executable_path={CHROMIUM_PATH}" if CHROMIUM_PATH else "bundled"
        await self.emit("system", "Browser ready", f"{how} headless={launch_headless} low_mem={LOW_MEMORY} {VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}")
        return self.context

    async def close(self) -> None:
        if self._external_browser:
            # Leave the system Chromium (and its profile) running for noVNC / next task.
            self.context = None
            self.page = None
        elif self.context:
            await self.context.close()
            self.context = None
            self.page = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None
        self._external_browser = False

    @asynccontextmanager
    async def exclusive_page(self) -> AsyncIterator[Page]:
        """Yield a fresh tab on the existing persistent profile.

        Holds the agent lock so the vision loop and the visuals step never
        launch a second persistent context (Chromium would refuse the profile).
        """
        async with self._lock:
            self.is_busy = True
            page: Optional[Page] = None
            try:
                await self.initialize_browser()
                if self.context is None:
                    raise RuntimeError("browser context was not created")
                page = await self.context.new_page()
                try:
                    await page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
                except Exception:
                    pass
                yield page
            finally:
                if page is not None:
                    try:
                        await page.close()
                    except Exception:
                        pass
                self.is_busy = False

    async def open_visible_url(self, url: str) -> dict[str, Any]:
        """Open a URL in the persistent visible Chrome profile. Does not type or click.

        Leaves the tab open so the user can log in over noVNC. Reuses the
        already-launched context when the agent holds the profile lock.
        """
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser(headless=False)
                if self.context is None:
                    raise RuntimeError("browser context was not created")
                page = await self.context.new_page()
                try:
                    await page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
                except Exception:
                    pass
                await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                self.page = page
                await self.emit("system", "Opened URL", page.url)
                return {"ok": True, "url": page.url, "title": await page.title()}
            finally:
                self.is_busy = False

    async def run_generic_task(self, task: str, mock: Optional[MockLLM] = None) -> dict[str, Any]:
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser()
                await self.emit("action", "Task started", task)
                result = await run_vision_task(self.page, task, log=self.log_callback, mock=mock)
                await self.emit("action", "Task finished", result.get("result") or result.get("status") or "")
                return result
            finally:
                self.is_busy = False
`,
  },
  {
    name: "vision_loop.py",
    path: "/app/agent/vision_loop.py",
    description: "Driver-agnostic vision loop: screenshot → DeepSeek Flash (Gemini fallback) → JSON actions. Browser or Windows desktop.",
    language: "python",
    category: "python",
    content: `"""Playwright vision loop: screenshot -> DeepSeek Flash (multimodal) or Gemini fallback -> JSON action."""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Awaitable, Callable, Optional

import httpx

from config import (
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
    DRY_RUN,
    GEMINI_API_KEY,
    GEMINI_VISION_MODEL,
    MAX_VISION_STEPS,
    SCREENSHOT_FORMAT,
    SCREENSHOT_QUALITY,
    SCREENSHOT_TO_UI,
)
from db import record_usage

logger = logging.getLogger("grokpc.vision")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]

SYSTEM_PROMPT = """You are a computer-use agent driving a real browser.
You see a screenshot of the current page (viewport 1440x900 unless noted).
Reply with ONE JSON object only, no markdown, no extra text, using this schema:
{
  "action": "click" | "type" | "press" | "scroll" | "goto" | "wait" | "done",
  "x": 0,
  "y": 0,
  "text": "",
  "url": "",
  "key": "Enter",
  "amount": 400,
  "thought": "short reason"
}
Rules:
- Coordinates are in CSS pixels from the top-left of the screenshot.
- "type" types into the currently focused or last-clicked field.
- "press" uses a key name like Enter, Tab, Escape, Backspace.
- "scroll" uses amount in pixels (positive = down).
- "goto" navigates to url. To open any website, always use "goto" with the full URL.
- You control ONE tab that is already private (incognito-like). Browser shortcuts for new tabs/windows (Ctrl+T, Ctrl+N, Ctrl+Shift+N) do not work; never use them.
- "wait" waits amount milliseconds (default 1000).
- "done" when the task is finished or blocked; put the result in "text".
"""


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("\`\`\`"):
        text = re.sub(r"^\`\`\`(?:json)?\\s*", "", text)
        text = re.sub(r"\\s*\`\`\`$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\\{.*\\}", text, re.S)
    if match:
        data = json.loads(match.group(0))
        if isinstance(data, dict):
            return data
    raise ValueError(f"Model did not return JSON: {text[:400]}")


def parse_usage(payload: dict[str, Any]) -> tuple[int, int]:
    usage = payload.get("usage") or payload.get("usageMetadata") or {}
    tokens_in = int(
        usage.get("prompt_tokens")
        or usage.get("promptTokenCount")
        or usage.get("input_tokens")
        or 0
    )
    tokens_out = int(
        usage.get("completion_tokens")
        or usage.get("candidatesTokenCount")
        or usage.get("output_tokens")
        or 0
    )
    return tokens_in, tokens_out


class MockLLM:
    """Deterministic actions for smoke tests / DRY_RUN without API keys."""

    def __init__(self, script: Optional[list[dict[str, Any]]] = None):
        self.script = list(
            script
            or [
                {"action": "goto", "url": "about:blank", "thought": "mock start"},
                {"action": "done", "text": "DRY_RUN complete", "thought": "mock done"},
            ]
        )
        self.i = 0

    async def decide(self, prompt: str, screenshot_png: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
        if self.i < len(self.script):
            action = dict(self.script[self.i])
            self.i += 1
        else:
            action = {"action": "done", "text": "DRY_RUN exhausted script", "thought": "end"}
        return action, {"provider": "mock", "model": "mock-llm", "tokens_in": 0, "tokens_out": 0}


async def decide_deepseek(prompt: str, screenshot_png: bytes, mime: str = "image/png") -> tuple[dict[str, Any], dict[str, Any]]:
    b64 = base64.b64encode(screenshot_png).decode("ascii")
    body = {
        "model": DEEPSEEK_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            },
        ],
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
    content = data["choices"][0]["message"]["content"]
    tokens_in, tokens_out = parse_usage(data)
    action = _extract_json(content)
    meta = {
        "provider": "deepseek",
        "model": data.get("model") or DEEPSEEK_MODEL,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    record_usage(
        task_type="vision",
        status="ok",
        details=action.get("thought") or action.get("action") or "",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="deepseek",
        model=meta["model"],
    )
    return action, meta


async def decide_gemini(prompt: str, screenshot_png: bytes, mime: str = "image/png") -> tuple[dict[str, Any], dict[str, Any]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model=GEMINI_VISION_MODEL,
        contents=[
            types.Part.from_bytes(data=screenshot_png, mime_type=mime),
            SYSTEM_PROMPT + "\\n\\nTask:\\n" + prompt,
        ],
    )
    text = response.text or ""
    usage = getattr(response, "usage_metadata", None)
    tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
    tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
    action = _extract_json(text)
    meta = {
        "provider": "gemini",
        "model": GEMINI_VISION_MODEL,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    record_usage(
        task_type="vision",
        status="ok",
        details=action.get("thought") or action.get("action") or "",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="gemini",
        model=GEMINI_VISION_MODEL,
    )
    return action, meta


async def decide(prompt: str, screenshot_png: bytes, mock: Optional[MockLLM] = None, mime: str = "image/png") -> tuple[dict[str, Any], dict[str, Any]]:
    if mock is not None:
        return await mock.decide(prompt, screenshot_png)
    if DRY_RUN:
        return await MockLLM().decide(prompt, screenshot_png)
    # Prefer free Gemini when a key is present; DeepSeek is the paid fallback.
    if GEMINI_API_KEY:
        try:
            return await decide_gemini(prompt, screenshot_png, mime=mime)
        except Exception as exc:
            logger.warning("Gemini vision failed, falling back to DeepSeek: %s", exc)
    if DEEPSEEK_API_KEY:
        return await decide_deepseek(prompt, screenshot_png, mime=mime)
    raise RuntimeError("No vision LLM configured (set GEMINI_API_KEY or DEEPSEEK_API_KEY, or DRY_RUN=1)")


_KEY_ALIASES = {
    "ctrl": "Control", "control": "Control", "cmd": "Meta", "command": "Meta", "win": "Meta",
    "windows": "Meta", "super": "Meta", "meta": "Meta", "alt": "Alt", "option": "Alt",
    "shift": "Shift", "esc": "Escape", "escape": "Escape", "del": "Delete", "delete": "Delete",
    "enter": "Enter", "return": "Enter", "tab": "Tab", "space": " ", "backspace": "Backspace",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "pageup": "PageUp", "pagedown": "PageDown", "home": "Home", "end": "End",
}


def _normalize_key(key: str) -> str:
    parts = [p.strip() for p in re.split(r"\\s*\\+\\s*", str(key).strip()) if p.strip()]
    out = []
    for p in parts:
        alias = _KEY_ALIASES.get(p.lower())
        if alias:
            out.append(alias)
        elif len(p) == 1:
            out.append(p.lower() if len(parts) > 1 else p)
        else:
            out.append(p[0].upper() + p[1:])
    return "+".join(out) or "Enter"


async def apply_action(page, action: dict[str, Any]) -> str:
    """Apply one model action. \`page\` may be a Playwright Page or a Driver."""
    try:
        return await _apply_action(page, action)
    except Exception as exc:  # let the model see the error and try something else
        logger.warning("action failed: %s", exc)
        return f"Action failed: {str(exc)[:200]}. Try a different action (e.g. goto with full URL)."


async def _apply_action(page, action: dict[str, Any]) -> str:
    from drivers import as_driver

    driver = as_driver(page)
    kind = (action.get("action") or "done").lower().strip()
    if kind == "goto":
        return await driver.goto(action.get("url") or "")
    if kind == "click":
        x, y = int(action.get("x") or 0), int(action.get("y") or 0)
        return await driver.click(x, y)
    if kind == "type":
        return await driver.type_text(action.get("text") or "")
    if kind == "press":
        key = _normalize_key(action.get("key") or "Enter")
        return await driver.press(key)
    if kind == "scroll":
        amount = int(action.get("amount") or 400)
        return await driver.scroll(amount)
    if kind == "wait":
        ms = int(action.get("amount") or 1000)
        return await driver.wait(ms)
    if kind == "launch":
        app = action.get("text") or action.get("url") or action.get("app") or ""
        return await driver.launch(app)
    if kind == "done":
        return action.get("text") or action.get("thought") or "Done"
    return f"Unknown action {kind}"



async def _capture_screenshot(page) -> tuple[bytes, str]:
    from drivers import as_driver

    driver = as_driver(page)
    return await driver.screenshot()


def _driver_system_note(kind: str) -> str:
    if kind == "windows":
        return (
            "You are driving a Windows desktop (not a browser tab). "
            "Coordinates are screen pixels from the top-left. "
            "Use click/type/press/scroll/launch/wait. "
            "'goto' is not available. 'launch' opens an installed app (e.g. capcut). "
            "Key names: Enter, Tab, Control+i, Alt+F4, Control+s."
        )
    return ""


async def run_vision_task(
    page,
    task: str,
    *,
    log: Optional[LogFn] = None,
    mock: Optional[MockLLM] = None,
    max_steps: Optional[int] = None,
) -> dict[str, Any]:
    import asyncio
    from drivers import as_driver

    driver = as_driver(page)
    steps = max_steps or MAX_VISION_STEPS
    history: list[dict[str, Any]] = []
    last_result = ""
    extra = _driver_system_note(getattr(driver, "kind", "browser"))
    for step in range(1, steps + 1):
        image, mime = await driver.screenshot()
        try:
            url = await driver.current_url()
        except Exception:
            url = ""
        prompt = (
            f"Task: {task}\\n"
            f"Step {step}/{steps}. Surface: {getattr(driver, 'kind', 'browser')} URL: {url}\\n"
            f"{extra}\\n"
            f"Last result: {last_result or 'none'}\\n"
            "Decide the next single action."
        )
        action, meta = await decide(prompt, image, mock=mock, mime=mime)
        if log:
            payload = {
                "type": "vision",
                "title": f"Vision step {step}: {action.get('action')}",
                "message": action.get("thought") or "",
                "coords": {"x": action.get("x") or 0, "y": action.get("y") or 0},
                "costInr": None,
                "meta": meta,
            }
            if SCREENSHOT_TO_UI and step <= 8:
                payload["screenshotPngB64"] = base64.b64encode(image).decode("ascii")
                payload["screenshotMime"] = mime
            await log(payload)
        last_result = await apply_action(page, action)
        history.append({"step": step, "action": action, "result": last_result, "meta": meta})
        if (action.get("action") or "").lower() == "done":
            return {"status": "success", "result": last_result, "steps": history}
        await asyncio.sleep(0.4)
    return {"status": "max_steps", "result": last_result, "steps": history}
`,
  },
  {
    name: "video_pipeline.py",
    path: "/app/agent/video_pipeline.py",
    description: "FFmpeg + free gTTS video pipeline; optional Gemini TTS; assemble_video fallback editor.",
    language: "python",
    category: "python",
    content: `"""FFmpeg video pipeline: Gemini/edge-tts/gTTS voice, Ken Burns stills, BGM, subtitles."""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import output_dir
from db import record_usage
from voiceover import (  # noqa: F401 — re-exports for existing callers/tests
    load_cues,
    media_duration as _voice_duration,
    save_cues,
    synthesize_voice,
    synthesize_voice_full,
    synthesize_voice_safe,
    write_silent_audio,
)

logger = logging.getLogger("grokpc.video")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]


async def _emit(log: Optional[LogFn], typ: str, title: str, message: str) -> None:
    if log:
        await log({"type": typ, "title": title, "message": message})


async def render_video(
    *,
    topic: str,
    script: str,
    language: str = "Hindi",
    duration_seconds: int = 15,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """Legacy entry used by /api/video: voiceover + FFmpeg assemble (title card if no stills)."""
    out = output_dir()
    stamp = int(time.time())
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in topic)[:40] or "video"
    audio = out / f"voice_{stamp}.mp3"
    final = out / f"{safe}_{stamp}.mp4"
    engine = await synthesize_voice_safe(script, language, audio, log=log)
    if not audio.is_file():
        alt = audio.with_suffix(".wav")
        if alt.is_file():
            audio = alt
    result = await assemble_video(
        title=topic,
        audio_path=audio,
        duration_seconds=max(int(duration_seconds), 8),
        log=log,
        dest=final,
        script=script,
        cues=load_cues(audio),
    )
    result["audio_path"] = str(audio)
    result["voice_engine"] = engine
    return result


def _escape_drawtext(text: str) -> str:
    # ffmpeg drawtext is picky: escape \\\\, :, ', %
    cleaned = (text or "").replace("\\\\", " ").replace(":", " ").replace("'", "").replace("%", " ")
    cleaned = cleaned.replace("\\n", " ")[:80]
    return cleaned




async def media_duration(path: Optional[Path]) -> float:
    """Return duration in seconds via ffprobe, or 0 if unknown."""
    import shutil

    if not path or not Path(path).is_file():
        return 0.0
    if not shutil.which("ffprobe"):
        return 0.0
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        str(path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, _err = await proc.communicate()
    try:
        return max(0.0, float((out or b"").decode("utf-8", "replace").strip() or 0))
    except ValueError:
        return 0.0


async def _normalize_clip(
    src: Path,
    dest: Path,
    size: str,
    target_dur: Optional[float] = None,
) -> bool:
    """Scale/pad a clip to \`size\`, drop audio, optionally loop/trim to target_dur."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    w, h = size.split("x")
    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p"
    )
    src_dur = await media_duration(src)
    inputs: list[str] = ["-i", str(src)]
    if target_dur and src_dur and src_dur < (target_dur - 0.15):
        inputs = ["-stream_loop", "-1", "-i", str(src)]
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-vf", vf,
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    ]
    if target_dur and target_dur > 0:
        cmd += ["-t", f"{target_dur:.3f}"]
    cmd.append(str(dest))
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _o, err = await proc.communicate()
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size < 500:
        logger.info("normalize %s failed: %s", src.name, (err or b"").decode("utf-8", "replace")[-300:])
        return False
    return True


async def assemble_clips(
    clips: list[Path],
    *,
    audio_path: Optional[Path],
    dest: Path,
    size: str,
    duration_seconds: int,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """Concat/scale clips, loop or trim to the voiceover, overlay the voiceover.

    Each clip is re-encoded to the channel aspect so mixed resolutions/codecs
    still concat cleanly. If the joined picture is shorter than the voiceover
    it is looped; if longer, it is trimmed. On any failure the caller falls
    back to the image/title-card path.
    """
    import shutil

    clips = [Path(c) for c in clips if Path(c).is_file()]
    if not clips:
        raise RuntimeError("no clips to assemble")

    work = dest.parent / f".work_{dest.stem}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        audio_dur = await media_duration(audio_path) if audio_path else 0.0
        target = audio_dur if audio_dur >= 1 else float(max(int(duration_seconds), 8))

        # Give each clip an even slice of the voiceover (loop or trim).
        per = target / max(len(clips), 1)
        norms: list[Path] = []
        for i, src in enumerate(clips):
            n = work / f"n{i:02d}.mp4"
            ok = await _normalize_clip(src, n, size, target_dur=per)
            if ok:
                norms.append(n)
        if not norms:
            raise RuntimeError("could not normalize any clip")

        lst = work / "concat.txt"
        lst.write_text("".join(f"file '{n.resolve()}'\\n" for n in norms), encoding="utf-8")
        joined = work / "joined.mp4"
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
            "-movflags", "+faststart",
            str(joined),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        if proc.returncode != 0 or not joined.is_file():
            raise RuntimeError((err or b"").decode("utf-8", "replace")[-800:] or "concat failed")

        joined_dur = await media_duration(joined) or per * len(norms)
        audio_args: list[str] = []
        map_args = ["-map", "0:v"]
        if audio_path and Path(audio_path).is_file():
            audio_args = ["-i", str(audio_path)]
            map_args += ["-map", "1:a", "-c:a", "aac", "-b:a", "128k"]
        loop_args: list[str] = []
        if joined_dur < target - 0.2:
            loop_args = ["-stream_loop", "-1"]

        cmd = [
            "ffmpeg", "-y",
            *loop_args, "-i", str(joined),
            *audio_args,
            *map_args,
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-t", f"{target:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size < 500:
            raise RuntimeError((err or b"").decode("utf-8", "replace")[-800:] or "mux failed")

        await _emit(log, "system", "Video ready", f"Saved to {dest}")
        record_usage(task_type="video", status="ok", details=str(dest), provider="ffmpeg", model="clips")
        return {"status": "success", "video_path": str(dest), "engine": "ffmpeg-clips"}
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def assemble_video(
    *,
    title: str,
    audio_path: Optional[Path] = None,
    images: Optional[list[Path]] = None,
    clips: Optional[list[Path]] = None,
    duration_seconds: int = 20,
    aspect: str = "16:9",
    log: Optional[LogFn] = None,
    dest: Optional[Path] = None,
    cues: Optional[list[dict[str, Any]]] = None,
    script: str = "",
) -> dict[str, Any]:
    """FFmpeg auto-edit (Phase 1 default editor).

    - Images: Ken Burns zoom/pan, crossfades, dark grade, BGM, burned subtitles.
    - Clips (optional Grok downloads): concat, then the same finish (BGM + subs).
    - Else a color title card, then the same finish.
    Output is 30 fps H.264 + AAC. aspect="9:16" yields 720x1280.
    """
    import shutil
    import time as _time

    from edit_fx import assemble_ken_burns, finalize_program

    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed")

    out = dest
    if out is None:
        stamp = int(_time.time())
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in title)[:40] or "video"
        out = output_dir() / f"{safe}_{stamp}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)

    if aspect == "9:16":
        size = "720x1280"
    elif aspect == "1:1":
        size = "720x720"
    else:
        size = "1280x720"

    await _emit(log, "terminal", "FFmpeg", f"Assembling {out.name} ({size})")

    duration = max(int(duration_seconds), 8)
    audio = Path(audio_path) if audio_path and Path(audio_path).is_file() else None
    if cues is None and audio is not None:
        cues = load_cues(audio)
    script = script or title

    async def _run(cmd: list[str]) -> tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        return proc.returncode, err.decode("utf-8", "replace")[-1500:]

    clips = [Path(c) for c in (clips or []) if Path(c).is_file()]
    images = [Path(i) for i in (images or []) if Path(i).is_file()]

    # Stills are the default (Pollinations). Prefer them over any leftover clips.
    if images:
        try:
            result = await assemble_ken_burns(
                images,
                out,
                voice=audio,
                cues=cues or [],
                script=script,
                size=size,
                duration_seconds=duration,
                log=log,
            )
            record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="kenburns")
            return result
        except Exception as exc:
            logger.warning("Ken Burns assemble failed, falling back: %s", exc)
            await _emit(log, "system", "FFmpeg stills", f"Ken Burns fail ({exc}); fallback")

    if clips:
        try:
            stitched = out.parent / f".clips_{out.stem}.mp4"
            raw = await assemble_clips(
                clips,
                audio_path=None,  # finalize_program muxes voice + BGM + subs
                dest=stitched,
                size=size,
                duration_seconds=duration,
                log=log,
            )
            picture = Path(raw["video_path"])
            await finalize_program(
                picture,
                out,
                voice=audio,
                cues=cues or [],
                script=script,
                size=size,
                log=log,
            )
            stitched.unlink(missing_ok=True)
            record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="clips")
            return {"status": "success", "video_path": str(out), "engine": "ffmpeg-clips"}
        except Exception as exc:
            logger.warning("clip assembly failed, falling back: %s", exc)
            await _emit(log, "system", "FFmpeg clips", f"clip stitch fail ({exc}); fallback")

    # Title-card fallback, then still run BGM + subs if we have a voiceover.
    label = _escape_drawtext(title)
    card = out.parent / f".card_{out.stem}.mp4"
    audio_args: list[str] = []
    # Picture only here — audio is mixed in finalize.
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a101f:s={size}:d={duration}",
        "-filter_complex",
        f"drawtext=text='{label}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-an", "-r", "30",
        "-movflags", "+faststart",
        str(card),
    ]
    code, err = await _run(cmd)
    if code != 0:
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x0a101f:s={size}:d={duration}",
            "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-an", "-r", "30",
            "-movflags", "+faststart",
            str(card),
        ]
        code, err = await _run(cmd)
        if code != 0:
            raise RuntimeError(err or "ffmpeg title-card failed")
    try:
        await finalize_program(
            card,
            out,
            voice=audio,
            cues=cues or [],
            script=script,
            size=size,
            duration=float(max(duration, 8)),
            log=log,
        )
        card.unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("title-card finalize failed (%s); copying raw card+voice", exc)
        if audio:
            cmd = [
                "ffmpeg", "-y", "-i", str(card), "-i", str(audio),
                "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                "-shortest", "-movflags", "+faststart",
                str(out),
            ]
            code, err = await _run(cmd)
            if code != 0:
                raise RuntimeError(err or "title-card mux failed") from exc
        else:
            shutil.copy2(card, out)
    await _emit(log, "system", "Video ready", f"Saved to {out}")
    record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="titlecard")
    return {"status": "success", "video_path": str(out), "engine": "ffmpeg-titlecard"}
`,
  },
  {
    name: "pipeline.py",
    path: "/app/agent/pipeline.py",
    description: "Phase 1 job orchestrator: story (ChatGPT/DeepSeek) → voiceover → FFmpeg/CapCut edit.",
    language: "python",
    category: "python",
    content: `"""Phase 1 video pipeline orchestrator.

Order: story+prompts -> voiceover -> visuals (Pollinations stills; optional Grok) -> FFmpeg edit
(CapCut prepared if helper is up). Visuals fall back to the existing title-card path
when not logged in, out of credits, or generation fails. Optional Phase 2 steps
(upload) are inserted only when their flags are on.

The currently working /api/task vision agent is independent: this runner uses
the same BrowserAgentCore lock when it needs the browser (ChatGPT planning),
and otherwise does not touch the Playwright session.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import (
    DRY_RUN,
    FEATURE_AUTOPILOT,
    FEATURE_GOOGLE_VIDS,
    FEATURE_GROK_IMAGINE,
    FEATURE_POLLINATIONS,
    FEATURE_VEO,
    FEATURE_YOUTUBE_UPLOAD,
    TARGET_SCENE_SEC,
    output_dir,
    pipeline_steps,
)
from channels import get_channel
from editors import edit_video
from media_export import copy_final_video
from jobs import (
    append_log,
    cancel_job,
    get_job,
    next_queued,
    pause_job,
    running_job,
    set_step,
    update_job,
)
from planner import plan_story
from video_pipeline import synthesize_voice_safe
from voiceover import load_cues

logger = logging.getLogger("grokpc.pipeline")
LogFn = Callable[[dict[str, Any]], Awaitable[None]]


class PipelineRunner:
    def __init__(self, agent: Any = None, broadcast: Optional[LogFn] = None):
        self.agent = agent
        self.broadcast = broadcast
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._run_lock = asyncio.Lock()
        self.current_job_id: Optional[str] = None

    async def start(self) -> None:
        if self._task is None:
            self._stop.clear()
            self._task = asyncio.create_task(self._loop(), name="pipeline-runner")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def enqueue_and_kick(self, job_id: str) -> None:
        # The loop will pick it up; also try immediately if idle.
        if self._run_lock.locked():
            return
        asyncio.create_task(self._maybe_run_one(), name=f"kick-{job_id}")

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._maybe_run_one()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("pipeline loop")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass

    async def _maybe_run_one(self) -> None:
        if self._run_lock.locked():
            return
        if running_job():
            return
        job = next_queued()
        if not job:
            return
        async with self._run_lock:
            await self.run_job(job["id"])

    async def _emit(self, job_id: str, title: str, message: str, step: str = "", level: str = "info") -> None:
        append_log(job_id, level, f"{title}: {message}" if title else message, step=step)
        if self.broadcast:
            await self.broadcast(
                {
                    "type": "action" if level != "error" else "error",
                    "title": title or "Job",
                    "message": message,
                    "jobId": job_id,
                    "step": step,
                }
            )

    def _paused(self, job_id: str) -> Optional[dict[str, Any]]:
        job = get_job(job_id)
        if not job:
            return {"status": "missing"}
        if job["status"] in {"paused", "cancelled"}:
            return job
        return None

    async def run_job(self, job_id: str) -> dict[str, Any]:
        job = get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] in {"completed", "cancelled"}:
            return job
        self.current_job_id = job_id
        update_job(job_id, status="running", error="")
        await self._emit(job_id, "Pipeline", f"Start: {job['topic']}", step=job.get("current_step") or "story")

        try:
            result = await self._run_steps(job_id)
            return result
        except Exception as exc:
            logger.exception("job %s failed", job_id)
            await self._emit(job_id, "Pipeline", str(exc), level="error")
            set_step(job_id, (get_job(job_id) or {}).get("current_step") or "story", "failed", str(exc)[:500])
            return update_job(job_id, status="failed", error=str(exc)[:800])
        finally:
            if self.current_job_id == job_id:
                self.current_job_id = None

    async def _run_steps(self, job_id: str) -> dict[str, Any]:
        job = get_job(job_id)
        assert job
        channel = get_channel(job["channel_id"]) or {"id": job["channel_id"], "name": job["channel_id"], "language": "Hindi", "aspect": "16:9"}
        steps = [s["name"] for s in job["steps"]] or pipeline_steps()

        # Resume support: skip steps already successful.
        done = {s["name"] for s in job["steps"] if s["status"] == "success"}

        plan = job.get("plan") or {}
        voice_path = Path(job["voice_path"]) if job.get("voice_path") else None
        media_paths = [Path(p) for p in (job.get("media") or []) if p]
        final_path = Path(job["final_path"]) if job.get("final_path") else None

        for name in steps:
            paused = self._paused(job_id)
            if paused:
                return paused

            if name in done:
                continue

            set_step(job_id, name, "running", "")
            update_job(job_id, status="running", current_step=name)
            await self._emit(job_id, "Step", name, step=name)

            if name == "story":
                result = await plan_story(
                    job["topic"],
                    job.get("idea") or "",
                    channel,
                    agent=self.agent,
                    log=self.broadcast,
                )
                plan = result.get("plan") or {}
                update_job(job_id, plan_json=plan, provider=result.get("planner") or "")
                note = result.get("note") or result.get("planner") or "ok"
                set_step(job_id, "story", "success", f"{result.get('planner')}: {plan.get('title') or ''} {note}"[:500])
                await self._emit(job_id, "Story", plan.get("title") or "planned", step="story")

            elif name == "voiceover":
                script = (plan or {}).get("voiceover_script") or job["topic"]
                lang = channel.get("language") or "Hindi"
                dest = output_dir() / f"voice_{job_id}.mp3"
                segments = []
                for sc in (plan or {}).get("scenes") or []:
                    if not isinstance(sc, dict):
                        continue
                    narr = str(sc.get("narration") or "").strip()
                    if not narr:
                        continue
                    try:
                        min_sec = float(sc.get("duration_sec") or 0)
                    except (TypeError, ValueError):
                        min_sec = 0.0
                    if TARGET_SCENE_SEC and min_sec < TARGET_SCENE_SEC:
                        min_sec = float(TARGET_SCENE_SEC)
                    segments.append({"text": narr, "min_sec": min_sec})
                engine = await synthesize_voice_safe(
                    script, lang, dest, log=self.broadcast, segments=segments or None
                )
                # synthesize may write .wav if mp3 encode failed
                if not dest.is_file():
                    alt = dest.with_suffix(".wav")
                    if alt.is_file():
                        dest = alt
                voice_path = dest
                update_job(job_id, voice_path=str(dest))
                set_step(job_id, "voiceover", "success", f"engine={engine}")
                await self._emit(job_id, "Voiceover", f"{engine} -> {dest.name}", step="voiceover")

            elif name in {"visuals", "generate"}:
                # "visuals" is the current step name; "generate" is kept for older jobs.
                if not (FEATURE_VEO or FEATURE_GROK_IMAGINE or FEATURE_GOOGLE_VIDS or FEATURE_POLLINATIONS):
                    set_step(job_id, name, "skipped", "visuals flags off")
                    continue
                from generators import generate_media

                dest = output_dir() / job_id / "clips"
                try:
                    gen = await generate_media(
                        plan or {},
                        job_id=job_id,
                        dest_dir=dest,
                        agent=self.agent,
                        log=self.broadcast,
                    )
                except Exception as exc:
                    logger.exception("visuals step failed")
                    set_step(job_id, name, "skipped", f"error, falling back: {exc}"[:500])
                    await self._emit(job_id, "Visuals", f"fail, basic visuals use honge: {exc}", step=name)
                    continue
                paths = [Path(p) for p in (gen.get("paths") or []) if p]
                media_paths.extend(paths)
                update_job(
                    job_id,
                    media_json=[str(p) for p in media_paths],
                    provider=gen.get("provider") or "",
                    credit_json=gen.get("credit") or gen.get("auth") or {},
                )
                note = (gen.get("note") or "").strip()
                # Never pause the job for credits / login — always fall through to edit.
                if gen.get("status") in {"ok", "success"} and paths:
                    detail = f"{len(paths)} clips"
                    if gen.get("provider"):
                        detail += f" via {gen['provider']}"
                    if note:
                        detail += f" — {note}"
                    set_step(job_id, name, "success", detail[:500])
                    await self._emit(job_id, "Visuals", detail, step=name)
                else:
                    detail = note or gen.get("status") or "no clips; falling back to basic visuals"
                    set_step(job_id, name, "skipped", detail[:500])
                    await self._emit(job_id, "Visuals", detail, step=name)

            elif name == "edit":
                title = (plan or {}).get("title") or job["topic"]
                duration = 20
                if plan and plan.get("scenes"):
                    duration = max(8, sum(int(s.get("duration_sec") or 8) for s in plan["scenes"]))
                aspect = channel.get("aspect") or "16:9"
                images = [p for p in media_paths if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".ppm"}]
                clips = [p for p in media_paths if p.suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"}]
                dest = output_dir() / f"final_{job_id}.mp4"
                script = (plan or {}).get("voiceover_script") or job["topic"]
                cues = load_cues(voice_path) if voice_path else []
                edited = await edit_video(
                    title=title,
                    audio_path=voice_path,
                    images=images,
                    clips=clips,
                    duration_seconds=duration,
                    aspect=aspect,
                    log=self.broadcast,
                    dest=dest,
                    cues=cues,
                    script=script,
                )
                final_path = Path(edited["video_path"])
                update_job(job_id, video_path=str(final_path), final_path=str(final_path))
                exports = copy_final_video(final_path, job_id)
                detail = edited.get("editor") or "ffmpeg"
                if edited.get("capcut"):
                    detail += f" capcut={edited['capcut'].get('status')}"
                if exports:
                    detail += f" saved={exports[0]}"
                set_step(job_id, "edit", "success", detail)
                extra = f" also {exports[0]}" if exports else ""
                await self._emit(job_id, "Edit", str(final_path) + extra, step="edit")

            elif name == "upload":
                if not FEATURE_YOUTUBE_UPLOAD:
                    set_step(job_id, "upload", "skipped", "Phase 2 flag off")
                    continue
                from youtube_upload import upload_private

                if not final_path or not final_path.is_file():
                    set_step(job_id, "upload", "failed", "no final video")
                    return update_job(job_id, status="failed", error="upload: no final video")
                up = await upload_private(
                    final_path,
                    title=(plan or {}).get("title") or job["topic"],
                    description=(plan or {}).get("description") or "",
                    tags=(plan or {}).get("tags") or [],
                    channel=channel,
                    agent=self.agent,
                    log=self.broadcast,
                )
                if up.get("status") == "waiting_login":
                    set_step(job_id, "upload", "failed", "YouTube login needed")
                    return update_job(job_id, status="waiting_login", error=up.get("note") or "YouTube login")
                if up.get("status") == "skipped":
                    set_step(job_id, "upload", "skipped", up.get("note") or "")
                elif up.get("status") in {"ok", "success"}:
                    update_job(
                        job_id,
                        youtube_id=str(up.get("youtube_id") or ""),
                        youtube_privacy=up.get("privacy") or "private",
                    )
                    set_step(job_id, "upload", "success", f"private {up.get('youtube_id')}")
                    return update_job(job_id, status="waiting_approval")
                else:
                    set_step(job_id, "upload", "failed", up.get("note") or up.get("status") or "")
                    return update_job(job_id, status="failed", error=f"upload: {up}")

            else:
                set_step(job_id, name, "skipped", "unknown step")

        if final_path and Path(final_path).is_file():
            copy_final_video(final_path, job_id)
        await self._emit(job_id, "Pipeline", "Complete", step="edit")
        return update_job(job_id, status="completed")
`,
  },
  {
    name: "requirements.txt",
    path: "/app/agent/requirements.txt",
    description: "Pinned Python dependencies.",
    language: "plaintext",
    category: "config",
    content: `fastapi==0.115.6
uvicorn[standard]==0.32.1
httpx==0.28.1
playwright==1.49.0
pydantic==2.10.6
google-genai==2.4.0
gTTS==2.5.4
edge-tts==7.3.1
python-dotenv==1.0.1
websockets==13.1
`,
  },
  {
    name: ".env.example",
    path: "/app/agent/.env.example",
    description: "Environment template. Real secrets stay on the VM in /app/agent/.env.",
    language: "plaintext",
    category: "config",
    content: `# Copy to /app/agent/.env on the machine. Never commit a filled copy.
# The setup script generates AGENT_TOKEN for you. Existing laptop .env is never overwritten.

AGENT_TOKEN=change-me-long-random
DEEPSEEK_API_KEY=
GEMINI_API_KEY=
# Messaging (WhatsApp / Gmail / Telegram) was removed in Phase 1. These names
# are ignored if still present in an older .env.
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=

HOST=127.0.0.1
PORT=8000

# Allowed browser origins for the control center (CORS). Add your custom domain if you use one.
FRONTEND_ORIGINS=https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173

CHROME_PROFILE_DIR=/data/chrome_profile
GDRIVE_DIR=/mnt/gdrive
# Leave OUTPUT_DIR empty to use /mnt/gdrive/Vids_Automation when mounted, else /data/outputs
OUTPUT_DIR=
DB_PATH=/app/data/agent_tasks.db

# Voiceover: Gemini TTS (free, primary) → edge-tts → gTTS. Silent ffmpeg in DRY_RUN.
USE_GEMINI_TTS=1
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_TTS_VOICE=Charon
TTS_VOICE=hi-IN-MadhurNeural
TTS_RATE=-8%
TTS_PITCH=-8Hz
# Optional: pad each scene narration to at least this many seconds (0 = follow speech).
TARGET_SCENE_SEC=0
GEMINI_VISION_MODEL=gemini-3.8-flash
# Free-tier Gemini text planner (default). Leave GEMINI_API_KEY empty until you add a key.
GEMINI_TEXT_MODEL=gemini-3.8-flash
DEEPSEEK_MODEL=deepseek-flash

# Used only to display INR estimates from official USD token prices.
USD_INR_RATE=88
MONTHLY_CAP_INR=1000

# 1 = no real LLM calls, mock plan + silent audio + FFmpeg (for tests)
DRY_RUN=0
# 1 = Playwright headless (use 0 on the laptop so you can watch in noVNC)
HEADLESS=0
MAX_VISION_STEPS=12

NOVNC_UPSTREAM=http://127.0.0.1:6080

# Auto: 1 on machines with under ~6 GB RAM. Forces smaller viewport + tighter Chromium flags.
LOW_MEMORY=
VIEWPORT_WIDTH=
VIEWPORT_HEIGHT=

# Termux / Android tablet: set ANDROID=1, point at system Chromium, skip bundled browsers.
# Playwright does not officially support Android; we connect over CDP (preferred) or executable_path.
# Tablet rollout is Phase 2 — laptop first.
ANDROID=0
CDP_URL=
CHROMIUM_PATH=
PLAYWRIGHT_BROWSERS_PATH=
SCREENSHOT_FORMAT=
SCREENSHOT_QUALITY=45
SCREENSHOT_TO_UI=

# --- Phase 1 (defaults already on; you usually don't need to set these) ---
FEATURE_CAPCUT=1
FEATURE_CHATGPT_PLANNER=1
PLANNER=chatgpt
# Windows desktop helper (CapCut, screenshots, idle). WSL localhost forwarding.
WINDOWS_HELPER_URL=http://127.0.0.1:8765
WINDOWS_HELPER_TOKEN=
# Optional: Windows-visible media folder, e.g. /mnt/c/Users/YOURNAME/Videos/GrokPC
WINDOWS_MEDIA_DIR=
# Optional tablet gallery folder. Empty = ~/storage/movies/GrokPC or /sdcard/Movies/GrokPC
GALLERY_DIR=

# Daily caps / quiet hours (saved from the app Settings too). Autopilot itself is Phase 2.
QUIET_HOURS=23:00-07:00
IDLE_SECONDS=900
DAILY_VIDEO_CAP=3
DAILY_SPEND_CAP_INR=40
AUTOPILOT_ENABLED=0

# --- Visuals step ---
# Default: free Pollinations stills + Ken Burns. Browser clip sites OFF
# (they previously captured marketing-page UI). Enable only if logged in.
FEATURE_POLLINATIONS=1
FEATURE_GROK_IMAGINE=0
FEATURE_GOOGLE_VIDS=0
# Max browser clips per job (Grok only, if enabled). Image scenes use MAX_IMAGE_SCENES.
MAX_CLIPS_PER_JOB=4
CLIP_TIMEOUT_SEC=240
MAX_IMAGE_SCENES=10

# --- Still Phase 2 (default OFF — do not turn on until tested on the laptop) ---
FEATURE_VEO=0
FEATURE_YOUTUBE_UPLOAD=0
FEATURE_AUTOPILOT=0
FEATURE_CREDIT_CHECK=0
FEATURE_AISTUDIO_VOICE=0
`,
  }
];
