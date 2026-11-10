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
ensure_swap

export DEBIAN_FRONTEND=noninteractive
apt-get update
# Lightweight desktop: IceWM + xterm (not full XFCE). Goodies/KDE skipped on purpose for 4 GB boxes.
apt-get install -y --no-install-recommends \\
  ca-certificates curl wget git jq unzip tar sudo rsync \\
  python3 python3-venv python3-pip python3-dev \\
  build-essential \\
  xvfb icewm xterm \\
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
python -m playwright install chromium

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
  DISPLAY=:99 icewm & \\
  sleep 1; \\
  x11vnc -display :99 -localhost -forever -shared -rfbport 5900 -rfbauth \${VNC_PASS_FILE} -ncache 0 & \\
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

systemctl daemon-reload
# Migrate old Oracle unit names if this box was installed earlier
systemctl disable --now oracle-desktop.service 2>/dev/null || true
systemctl disable --now oracle-agent.service 2>/dev/null || true
systemctl enable --now grokpc-desktop.service
systemctl enable --now grokpc-agent.service

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
    description: "FastAPI + WebSocket server with bearer auth, approvals, health, budget, video.",
    language: "python",
    category: "python",
    content: `"""GrokPC FastAPI server — authenticated REST + WebSocket for the mobile control center."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_core import BrowserAgentCore
from auth import cors_origins, require_auth, token_from_ws, tokens_match
from config import AGENT_TOKEN, DRY_RUN, HOST, PORT, require_token
from db import budget_summary, init_db, record_usage
from novnc_proxy import router as novnc_router
from telegram_bridge import TelegramBridge
from video_pipeline import render_video

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("grokpc.main")

clients: list[WebSocket] = []
pending: dict[str, dict[str, Any]] = {}
agent: Optional[BrowserAgentCore] = None
telegram: Optional[TelegramBridge] = None
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


async def resolve_approval(approval_id: str, approved: bool, modified: Optional[str] = None) -> dict[str, Any]:
    item = pending.get(approval_id)
    if not item:
        raise HTTPException(status_code=404, detail="Unknown or expired approval")
    if item.get("resolved"):
        return {"status": "already_resolved", "approval_id": approval_id}
    item["resolved"] = True
    item["approved"] = approved
    if approved and modified is not None:
        if item["type"] == "whatsapp":
            item["message"] = modified
        elif item["type"] == "gmail":
            item["body"] = modified
    await broadcast(
        {
            "type": "approval",
            "title": "Approved" if approved else "Rejected",
            "message": f"{item['type']} {approval_id} {'approved' if approved else 'rejected'}",
            "approvalId": approval_id,
            "approved": approved,
        }
    )
    if not approved:
        pending.pop(approval_id, None)
        record_usage(task_type=item["type"], status="rejected", details=approval_id)
        return {"status": "rejected", "approval_id": approval_id}

    if item["type"] == "whatsapp":
        result = await agent.run_whatsapp_send(item["contact"], item["message"], item.get("attachment_path") or None)
    elif item["type"] == "gmail":
        result = await agent.run_gmail_send(item["recipient"], item.get("subject") or "", item.get("body") or "")
    else:
        result = {"status": "error", "message": f"Unknown type {item['type']}"}
    pending.pop(approval_id, None)
    record_usage(task_type=item["type"], status=result.get("status") or "ok", details=str(result)[:500])
    await broadcast({"type": "action", "title": "Approved task finished", "message": json.dumps(result, default=str)[:500]})
    return {"status": "executed", "approval_id": approval_id, "result": result}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent, telegram, _main_loop
    require_token()
    init_db()
    _main_loop = asyncio.get_running_loop()
    agent = BrowserAgentCore(log_callback=broadcast)
    telegram = TelegramBridge(on_decision=resolve_approval)
    await telegram.start()
    yield
    await telegram.stop()
    if agent:
        await agent.close()


app = FastAPI(title="GrokPC Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(novnc_router)


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def get_health(_auth: str = Depends(require_auth)):
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
            cpu = round(float(f.read().split()[0]) * 25, 1)  # rough % of 4 cores
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
        "chromeProfileLocked": os.path.exists("/data/chrome_profile/SingletonLock"),
        "gdriveMounted": os.path.isdir(gdrive) and os.path.ismount(gdrive),
        "novncPortActive": _port_open("127.0.0.1", 6080),
        "fastapiPortActive": True,
        "dryRun": DRY_RUN,
        "lastPing": int(time.time() * 1000),
    }


def _port_open(host: str, port: int) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


@app.get("/api/budget")
async def get_budget(_auth: str = Depends(require_auth)):
    return budget_summary()


class WhatsAppRequest(BaseModel):
    contact: str
    message: str
    attachment_path: str = ""


class GmailRequest(BaseModel):
    recipient: str
    subject: str = ""
    body: str = ""


class VideoRequest(BaseModel):
    topic: str
    script: str
    language: str = "Hindi"
    duration_seconds: int = 15
    use_google_vids: bool = False


class TaskRequest(BaseModel):
    prompt: str


class ApprovalDecision(BaseModel):
    approval_id: str
    approved: bool
    modified_content: Optional[str] = None


def _queue_approval(kind: str, title: str, recipient: str, content: str, extra: dict[str, Any]) -> dict[str, Any]:
    approval_id = f"{kind}_{uuid.uuid4().hex[:10]}"
    pending[approval_id] = {
        "id": approval_id,
        "type": kind,
        "title": title,
        "recipient": recipient,
        "previewContent": content,
        "createdAt": time.strftime("%H:%M:%S"),
        "resolved": False,
        **extra,
    }
    return {
        "status": "pending_approval",
        "approval_id": approval_id,
        "approval": {k: pending[approval_id][k] for k in ("id", "type", "title", "recipient", "previewContent", "createdAt")},
    }


@app.post("/api/whatsapp/send")
async def send_whatsapp(req: WhatsAppRequest, _auth: str = Depends(require_auth)):
    queued = _queue_approval(
        "whatsapp",
        "WhatsApp dispatch",
        req.contact,
        req.message,
        {"contact": req.contact, "message": req.message, "attachment_path": req.attachment_path},
    )
    await broadcast({"type": "approval", "title": "Approval required", "message": f"WhatsApp to {req.contact}", "pendingApproval": queued["approval"]})
    if telegram:
        await telegram.send_approval(queued["approval_id"], "WhatsApp dispatch", req.contact, req.message)
    return queued


@app.post("/api/gmail/send")
async def send_gmail(req: GmailRequest, _auth: str = Depends(require_auth)):
    queued = _queue_approval(
        "gmail",
        "Gmail send",
        req.recipient,
        req.body,
        {"recipient": req.recipient, "subject": req.subject, "body": req.body},
    )
    await broadcast({"type": "approval", "title": "Approval required", "message": f"Email to {req.recipient}", "pendingApproval": queued["approval"]})
    if telegram:
        await telegram.send_approval(queued["approval_id"], f"Gmail: {req.subject}", req.recipient, req.body)
    return queued


@app.post("/api/approve")
async def approve(req: ApprovalDecision, _auth: str = Depends(require_auth)):
    return await resolve_approval(req.approval_id, req.approved, req.modified_content)


@app.post("/api/vids/generate")
@app.post("/api/video/generate")
async def generate_video(req: VideoRequest, _auth: str = Depends(require_auth)):
    async def _run():
        try:
            if req.use_google_vids:
                task = (
                    f"Open Google Vids (https://docs.google.com/videos) and try to start a video about: {req.topic}. "
                    "If the UI is unavailable, stop and report what you see."
                )
                result = await agent.run_generic_task(task)
                await broadcast({"type": "action", "title": "Google Vids task", "message": str(result.get("result") or result)[:500]})
            result = await render_video(
                topic=req.topic,
                script=req.script,
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


@app.post("/api/task")
async def run_task(req: TaskRequest, _auth: str = Depends(require_auth)):
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Empty prompt")
    lower = prompt.lower()

    # Route obvious WhatsApp / Gmail / video requests, but still require approval for sends.
    if "whatsapp" in lower or lower.startswith("wa "):
        contact = "Unknown"
        # very light parse: "whatsapp Rahul: hello"
        rest = prompt
        for prefix in ("whatsapp", "wa"):
            if lower.startswith(prefix):
                rest = prompt[len(prefix):].strip(" :,-")
                break
        if ":" in rest:
            contact, _, message = rest.partition(":")
        else:
            contact, message = rest, prompt
        return await send_whatsapp(WhatsAppRequest(contact=contact.strip() or "Unknown", message=message.strip() or prompt), _auth)

    async def _run():
        try:
            result = await agent.run_generic_task(prompt)
            await broadcast({"type": "action", "title": "Agent finished", "message": str(result.get("result") or result)[:800]})
        except Exception as exc:
            logger.exception("task")
            await broadcast({"type": "error", "title": "Task failed", "message": str(exc)})

    asyncio.create_task(_run())
    return {"status": "started", "message": "Vision agent started"}


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
            # Optional client commands over the same socket
            if msg.get("cmd") == "ping":
                await websocket.send_text(json.dumps({"type": "system", "title": "pong", "timestamp": time.strftime("%H:%M:%S")}))
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
    description: "Playwright persistent browser, WhatsApp/Gmail helpers, vision-loop tasks.",
    language: "python",
    category: "python",
    content: `"""Playwright persistent browser + WhatsApp/Gmail helpers + vision-loop tasks."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable, Optional

from playwright.async_api import BrowserContext, Page, async_playwright

from config import CHROME_PROFILE_DIR, DRY_RUN, HEADLESS, LOW_MEMORY, VIEWPORT_HEIGHT, VIEWPORT_WIDTH
from vision_loop import MockLLM, run_vision_task

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

    async def emit(self, typ: str, title: str, message: str, **extra: Any) -> None:
        payload = {"type": typ, "title": title, "message": message, **extra}
        logger.info("[%s] %s: %s", typ, title, message)
        if self.log_callback:
            await self.log_callback(payload)

    async def initialize_browser(self, headless: Optional[bool] = None) -> BrowserContext:
        if self.context:
            return self.context
        os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
        await self.emit("system", "Launching browser", f"Profile {CHROME_PROFILE_DIR}")
        self.playwright = await async_playwright().start()
        launch_headless = HEADLESS if headless is None else headless
        # Use the bundled Chromium (playwright install chromium). Do not set channel=
        # and do not spoof an x86_64 UA on Ampere ARM64.
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
        if LOW_MEMORY:
            chrome_args += [
                "--js-flags=--max-old-space-size=384",
                "--renderer-process-limit=2",
                "--disable-features=Translate,BackForwardCache,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion",
                "--disk-cache-size=67108864",
                "--force-device-scale-factor=1",
            ]
        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=CHROME_PROFILE_DIR,
            headless=launch_headless,
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            args=chrome_args,
        )
        pages = self.context.pages
        self.page = pages[0] if pages else await self.context.new_page()
        await self.emit("system", "Browser ready", f"headless={launch_headless} low_mem={LOW_MEMORY} {VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}")
        return self.context

    async def close(self) -> None:
        if self.context:
            await self.context.close()
            self.context = None
            self.page = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None

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

    async def run_whatsapp_send(self, contact: str, message: str, file_path: Optional[str] = None) -> dict[str, Any]:
        """Best-effort WhatsApp Web send using the persistent profile. Call only after approval."""
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser()
                assert self.page is not None
                await self.emit("action", "WhatsApp Web", f"Opening chat for {contact}")
                await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded")
                await asyncio.sleep(4)
                qr = await self.page.query_selector("canvas[aria-label*='QR'], canvas[aria-label*='qr']")
                if qr:
                    await self.emit(
                        "approval",
                        "WhatsApp Auth Required",
                        "Scan the QR code in the live desktop (noVNC), then retry.",
                    )
                    return {"status": "auth_required", "message": "Scan WhatsApp QR in noVNC"}

                search = await self.page.wait_for_selector(
                    "div[contenteditable='true'][data-tab='3'], div[title='Search input textbox'], [data-testid='chat-list-search']",
                    timeout=20000,
                )
                await search.click()
                await self.page.keyboard.type(contact, delay=30)
                await asyncio.sleep(1.2)
                await self.page.keyboard.press("Enter")
                await asyncio.sleep(1.5)

                box = await self.page.wait_for_selector(
                    "div[contenteditable='true'][data-tab='10'], footer div[contenteditable='true'], [data-testid='conversation-compose-box-input']",
                    timeout=15000,
                )
                await box.click()
                await self.page.keyboard.type(message, delay=20)

                if file_path and os.path.exists(file_path):
                    file_input = await self.page.query_selector("input[type='file']")
                    if file_input:
                        await file_input.set_input_files(file_path)
                        await asyncio.sleep(2)

                await self.page.keyboard.press("Enter")
                await asyncio.sleep(1.5)
                await self.emit("action", "WhatsApp Sent", f"Sent to {contact}")
                return {"status": "success", "contact": contact}
            except Exception as exc:
                logger.exception("WhatsApp send failed")
                # Fall back to the vision loop so a changed DOM can still be handled.
                await self.emit("system", "Selector miss", f"{exc}; switching to vision loop")
                task = f"On WhatsApp Web, open the chat with '{contact}' and send this message exactly: {message}"
                return await run_vision_task(self.page, task, log=self.log_callback)
            finally:
                self.is_busy = False

    async def run_gmail_send(self, recipient: str, subject: str, body: str) -> dict[str, Any]:
        """Best-effort Gmail compose. Call only after approval."""
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser()
                assert self.page is not None
                await self.emit("action", "Gmail", f"Composing email to {recipient}")
                await self.page.goto("https://mail.google.com/mail/u/0/#inbox", wait_until="domcontentloaded")
                await asyncio.sleep(3)
                if "accounts.google.com" in (self.page.url or ""):
                    await self.emit(
                        "approval",
                        "Gmail Auth Required",
                        "Log into Google in the live desktop (noVNC), then retry.",
                    )
                    return {"status": "auth_required", "message": "Log into Gmail in noVNC"}
                compose = self.page.locator("div[gh='cm'], div[role='button']:has-text('Compose')").first
                await compose.click(timeout=15000)
                await asyncio.sleep(1)
                to_box = self.page.locator("input[peoplekit-id], textarea[name='to'], input[aria-label*='To']").first
                await to_box.fill(recipient)
                subj = self.page.locator("input[name='subjectbox']").first
                await subj.fill(subject)
                body_box = self.page.locator("div[aria-label='Message Body'], div[role='textbox'][aria-label*='Body']").first
                await body_box.click()
                await self.page.keyboard.type(body, delay=15)
                await self.page.keyboard.press("Control+Enter")
                await asyncio.sleep(2)
                await self.emit("action", "Gmail Sent", f"Sent to {recipient}")
                return {"status": "success", "recipient": recipient}
            except Exception as exc:
                logger.exception("Gmail send failed")
                await self.emit("system", "Selector miss", f"{exc}; switching to vision loop")
                task = (
                    f"In Gmail, compose and send an email to {recipient} "
                    f"with subject '{subject}' and body: {body}"
                )
                return await run_vision_task(self.page, task, log=self.log_callback)
            finally:
                self.is_busy = False
`,
  },
  {
    name: "vision_loop.py",
    path: "/app/agent/vision_loop.py",
    description: "Screenshot → DeepSeek Flash multimodal (Gemini fallback) → JSON click/type/scroll/goto.",
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
- "goto" navigates to url.
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


async def decide_deepseek(prompt: str, screenshot_png: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
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
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
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


async def decide_gemini(prompt: str, screenshot_png: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model=GEMINI_VISION_MODEL,
        contents=[
            types.Part.from_bytes(data=screenshot_png, mime_type="image/png"),
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


async def decide(prompt: str, screenshot_png: bytes, mock: Optional[MockLLM] = None) -> tuple[dict[str, Any], dict[str, Any]]:
    if mock is not None:
        return await mock.decide(prompt, screenshot_png)
    if DRY_RUN:
        return await MockLLM().decide(prompt, screenshot_png)
    if DEEPSEEK_API_KEY:
        try:
            return await decide_deepseek(prompt, screenshot_png)
        except Exception as exc:
            logger.warning("DeepSeek vision failed, falling back to Gemini: %s", exc)
    if GEMINI_API_KEY:
        return await decide_gemini(prompt, screenshot_png)
    raise RuntimeError("No vision LLM configured (set DEEPSEEK_API_KEY or GEMINI_API_KEY, or DRY_RUN=1)")


async def apply_action(page, action: dict[str, Any]) -> str:
    kind = (action.get("action") or "done").lower().strip()
    if kind == "goto":
        url = action.get("url") or ""
        await page.goto(url, wait_until="domcontentloaded")
        return f"Navigated to {url}"
    if kind == "click":
        x, y = int(action.get("x") or 0), int(action.get("y") or 0)
        await page.mouse.click(x, y)
        return f"Clicked ({x},{y})"
    if kind == "type":
        text = action.get("text") or ""
        await page.keyboard.type(text, delay=20)
        return f"Typed {len(text)} chars"
    if kind == "press":
        key = action.get("key") or "Enter"
        await page.keyboard.press(key)
        return f"Pressed {key}"
    if kind == "scroll":
        amount = int(action.get("amount") or 400)
        await page.mouse.wheel(0, amount)
        return f"Scrolled {amount}px"
    if kind == "wait":
        import asyncio

        ms = int(action.get("amount") or 1000)
        await asyncio.sleep(ms / 1000)
        return f"Waited {ms}ms"
    if kind == "done":
        return action.get("text") or action.get("thought") or "Done"
    return f"Unknown action {kind}"


async def run_vision_task(
    page,
    task: str,
    *,
    log: Optional[LogFn] = None,
    mock: Optional[MockLLM] = None,
    max_steps: Optional[int] = None,
) -> dict[str, Any]:
    import asyncio

    steps = max_steps or MAX_VISION_STEPS
    history: list[dict[str, Any]] = []
    last_result = ""
    for step in range(1, steps + 1):
        png = await page.screenshot(type="png", full_page=False)
        prompt = (
            f"Task: {task}\\n"
            f"Step {step}/{steps}. URL: {page.url}\\n"
            f"Last result: {last_result or 'none'}\\n"
            "Decide the next single action."
        )
        action, meta = await decide(prompt, png, mock=mock)
        if log:
            await log(
                {
                    "type": "vision",
                    "title": f"Vision step {step}: {action.get('action')}",
                    "message": action.get("thought") or "",
                    "coords": {"x": action.get("x") or 0, "y": action.get("y") or 0},
                    "costInr": None,
                    "meta": meta,
                    "screenshotPngB64": base64.b64encode(png).decode("ascii") if step <= 8 else None,
                }
            )
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
    description: "FFmpeg + free gTTS video pipeline; optional Gemini TTS behind a flag.",
    language: "python",
    category: "python",
    content: `"""FFmpeg + gTTS video pipeline. Optional Gemini TTS behind USE_GEMINI_TTS."""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import (
    GEMINI_API_KEY,
    GEMINI_TTS_MODEL,
    USE_GEMINI_TTS,
    output_dir,
)
from db import record_usage

logger = logging.getLogger("grokpc.video")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]


async def _emit(log: Optional[LogFn], typ: str, title: str, message: str) -> None:
    if log:
        await log({"type": typ, "title": title, "message": message})


def _write_gtts(script: str, lang: str, dest: Path) -> None:
    from gtts import gTTS

    code = "hi" if (lang or "").lower().startswith("hi") else "en"
    tts = gTTS(text=script, lang=code, slow=False)
    tts.save(str(dest))


async def _gemini_tts(script: str, dest: Path) -> dict[str, Any]:
    """Generate speech with Gemini TTS. Verified model id: gemini-3.8-flash-lite-tts."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model=GEMINI_TTS_MODEL,
        contents=script,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
                )
            ),
        ),
    )
    # google-genai returns inline audio data on the first part when successful
    data = None
    try:
        data = response.candidates[0].content.parts[0].inline_data.data
    except Exception as exc:
        raise RuntimeError(f"Gemini TTS returned no audio: {exc}") from exc
    dest.write_bytes(data)
    usage = getattr(response, "usage_metadata", None)
    tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
    tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
    rec = record_usage(
        task_type="tts",
        status="ok",
        details=GEMINI_TTS_MODEL,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="gemini",
        model=GEMINI_TTS_MODEL,
        kind="tts",
    )
    return rec


async def synthesize_voice(script: str, lang: str, dest: Path, log: Optional[LogFn] = None) -> str:
    if USE_GEMINI_TTS and GEMINI_API_KEY:
        try:
            await _emit(log, "action", "Gemini TTS", f"Synthesizing with {GEMINI_TTS_MODEL}")
            await _gemini_tts(script, dest)
            return "gemini"
        except Exception as exc:
            logger.warning("Gemini TTS failed, falling back to gTTS: %s", exc)
            await _emit(log, "system", "TTS fallback", f"Gemini TTS failed ({exc}); using free gTTS")
    await _emit(log, "action", "gTTS", f"Synthesizing free {lang} voiceover")
    await asyncio.to_thread(_write_gtts, script, lang, dest)
    return "gtts"


async def render_video(
    *,
    topic: str,
    script: str,
    language: str = "Hindi",
    duration_seconds: int = 15,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    out = output_dir()
    stamp = int(time.time())
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in topic)[:40] or "video"
    audio = out / f"voice_{stamp}.mp3"
    final = out / f"{safe}_{stamp}.mp4"

    engine = await synthesize_voice(script, language, audio, log=log)
    await _emit(log, "terminal", "FFmpeg", f"Rendering {final.name}")

    # Title card + voiceover. If audio is raw PCM from Gemini (often audio/L16), try ffmpeg anyway;
    # gTTS writes mp3 which ffmpeg handles natively. If Gemini writes raw bytes, we may need -f.
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a101f:s=1280x720:d={max(duration_seconds, 8)}",
        "-i", str(audio),
        "-filter_complex",
        f"drawtext=text='{topic.replace(chr(39), '')[:80]}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(final),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _out, err = await proc.communicate()
    if proc.returncode != 0:
        # Retry without drawtext (fonts may be missing on a fresh VM)
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x0a101f:s=1280x720:d={max(duration_seconds, 8)}",
            "-i", str(audio),
            "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            str(final),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _out, err = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(err.decode("utf-8", "replace")[-1500:])

    await _emit(log, "system", "Video ready", f"Saved to {final}")
    record_usage(task_type="video", status="ok", details=str(final), provider=engine, model=engine)
    return {
        "status": "success",
        "video_path": str(final),
        "audio_path": str(audio),
        "voice_engine": engine,
    }
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
    content: `# Copy to /app/agent/.env on the Oracle VM. Never commit a filled copy.
# The setup script generates AGENT_TOKEN for you.

AGENT_TOKEN=change-me-long-random
DEEPSEEK_API_KEY=
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

HOST=127.0.0.1
PORT=8000

# Allowed browser origins for the control center (CORS). Add your custom domain if you use one.
FRONTEND_ORIGINS=https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173

CHROME_PROFILE_DIR=/data/chrome_profile
GDRIVE_DIR=/mnt/gdrive
# Leave OUTPUT_DIR empty to use /mnt/gdrive/Vids_Automation when mounted, else /data/outputs
OUTPUT_DIR=
DB_PATH=/app/data/agent_tasks.db

# Optional paid voice. Default is free gTTS.
USE_GEMINI_TTS=0
GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts
GEMINI_VISION_MODEL=gemini-2.5-flash
DEEPSEEK_MODEL=deepseek-flash

# Used only to display INR estimates from official USD token prices.
USD_INR_RATE=88
MONTHLY_CAP_INR=1000

# 1 = no real LLM calls, mock actions (for tests)
DRY_RUN=0
# 1 = Playwright headless (use 0 on the VM so you can watch in noVNC)
HEADLESS=0
MAX_VISION_STEPS=12

NOVNC_UPSTREAM=http://127.0.0.1:6080

# Auto: 1 on machines with under ~6 GB RAM. Forces smaller viewport + tighter Chromium flags.
LOW_MEMORY=
VIEWPORT_WIDTH=
VIEWPORT_HEIGHT=
`,
  }
];
