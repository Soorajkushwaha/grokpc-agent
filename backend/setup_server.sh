#!/usr/bin/env bash
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="$SCRIPT_DIR"
APP_DIR="/app/agent"
DATA_DIR="/app/data"
CHROME_DIR="/data/chrome_profile"
OUTPUT_DIR="/data/outputs"
GDRIVE_DIR="/mnt/gdrive"
ENV_FILE="$APP_DIR/.env"
VNC_PASS_FILE="$APP_DIR/.vncpass"
INSTALL_USER="${SUDO_USER:-ubuntu}"
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
if grep -qiE '(microsoft|wsl)' /proc/sys/kernel/osrelease 2>/dev/null || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
  IS_WSL=1
fi
HAS_SYSTEMD=0
if [[ -d /run/systemd/system ]] && [[ "$(ps -p 1 -o comm= 2>/dev/null)" == "systemd" ]]; then
  HAS_SYSTEMD=1
fi
IS_CODESPACE=0
if [[ -n "${CODESPACES:-}" ]]; then IS_CODESPACE=1; fi

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
echo "RAM:  ${MEM_GB} GB  (low-memory mode: $LOW_MEMORY)"
echo "WSL: $IS_WSL  systemd: $HAS_SYSTEMD  codespace: $IS_CODESPACE"
echo "Source: $APP_SRC"
echo "Target: $APP_DIR"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "WARNING: this script is written for Ubuntu 24.04. Detected ${PRETTY_NAME:-unknown}."
  echo "Continuing anyway in 5s... (Ctrl-C to abort)"
  sleep 5
fi

# --- swapfile (important on a 4 GB VPS) ---
ensure_swap() {
  local existing
  existing="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  # If we already have >= 1.5 GB swap, leave it alone
  if [[ "${existing:-0}" -ge $((1500 * 1024)) ]]; then
    echo "Swap already present ($existing kB) — leaving it."
    return 0
  fi
  if [[ -f /swapfile ]]; then
    swapon /swapfile 2>/dev/null || true
    existing="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
    if [[ "${existing:-0}" -ge $((1500 * 1024)) ]]; then
      echo "Enabled existing /swapfile."
      return 0
    fi
  fi
  echo "Creating ${SWAP_SIZE} swapfile at /swapfile (needed on a 4 GB VPS)..."
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
apt-get install -y --no-install-recommends \
  ca-certificates curl wget git jq unzip tar sudo rsync \
  python3 python3-venv python3-pip python3-dev \
  build-essential \
  xvfb icewm xterm \
  x11vnc novnc websockify \
  ffmpeg fonts-dejavu-core \
  rclone fuse3 sqlite3 \
  libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
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
    sed -i 's/^#\s*user_allow_other/user_allow_other/' /etc/fuse.conf
  else
    echo "user_allow_other" >> /etc/fuse.conf
  fi
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$CHROME_DIR" "$OUTPUT_DIR" "$GDRIVE_DIR" /app/logs
rsync -a --delete --exclude '.env' --exclude '.venv' --exclude '.vncpass' --exclude '__pycache__' --exclude '.git' \
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
if [[ -f "$APP_DIR/requirements-${ARCH_FAMILY}.lock" ]]; then
  LOCK_FILE="$APP_DIR/requirements-${ARCH_FAMILY}.lock"
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
AGENT_TOKEN=${GEN_TOKEN}
DEEPSEEK_API_KEY=
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
HOST=127.0.0.1
PORT=8000
FRONTEND_ORIGINS=https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000
CHROME_PROFILE_DIR=${CHROME_DIR}
GDRIVE_DIR=${GDRIVE_DIR}
OUTPUT_DIR=
DB_PATH=${DATA_DIR}/agent_tasks.db
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
LOW_MEMORY=${LOW_MEMORY}
VIEWPORT_WIDTH=${VIEW_W}
VIEWPORT_HEIGHT=${VIEW_H}
EOF
else
  echo "Keeping existing $ENV_FILE"
  # Do not overwrite secrets; fill missing low-mem knobs if absent
  grep -q '^LOW_MEMORY=' "$ENV_FILE" || echo "LOW_MEMORY=${LOW_MEMORY}" >> "$ENV_FILE"
  grep -q '^VIEWPORT_WIDTH=' "$ENV_FILE" || echo "VIEWPORT_WIDTH=${VIEW_W}" >> "$ENV_FILE"
  grep -q '^VIEWPORT_HEIGHT=' "$ENV_FILE" || echo "VIEWPORT_HEIGHT=${VIEW_H}" >> "$ENV_FILE"
fi

if [[ ! -f "$VNC_PASS_FILE" ]]; then
  if [[ -z "${GEN_VNCPW}" ]]; then
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
User=${INSTALL_USER}
Environment=DISPLAY=:99
Environment=HOME=/home/${INSTALL_USER}
ExecStartPre=/bin/sh -c 'rm -f /tmp/.X99-lock || true'
ExecStart=/bin/bash -c '\
  Xvfb :99 -screen 0 ${VIEW_W}x${VIEW_H}x24 -nolisten tcp & \
  sleep 2; \
  DISPLAY=:99 icewm & \
  sleep 1; \
  x11vnc -display :99 -localhost -forever -shared -rfbport 5900 -nopw -ncache 0 & \
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
User=${INSTALL_USER}
WorkingDirectory=${APP_DIR}
Environment=PATH=${APP_DIR}/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
Environment=DISPLAY=:99
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-${ENV_FILE}
ExecStart=${APP_DIR}/.venv/bin/python main.py
Restart=always
RestartSec=5
MemoryMax=${AGENT_MEM}

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
User=${INSTALL_USER}
ExecStart=/usr/bin/rclone mount gdrive: ${GDRIVE_DIR} \\
  --config=/home/${INSTALL_USER}/.config/rclone/rclone.conf \\
  --allow-other \\
  --vfs-cache-mode full \\
  --vfs-cache-max-size 2G \\
  --vfs-read-chunk-size 16M \\
  --umask 022
ExecStop=/bin/fusermount3 -u ${GDRIVE_DIR}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# cloudflared for this CPU
if ! command -v cloudflared >/dev/null 2>&1; then
  CF_DEB="$(mktemp /tmp/cloudflared.XXXXXX.deb)"
  wget -q -O "$CF_DEB" "https://github.com/cloudflare/cloudflared/releases/latest/download/${CF_DEB_NAME}"
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
User=${INSTALL_USER}
ExecStart=/bin/bash ${APP_DIR}/run_tunnel.sh 8000 ${DATA_DIR}/tunnel_url.txt
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
User=${INSTALL_USER}
ExecStart=/bin/bash ${APP_DIR}/run_tunnel.sh 6080 ${DATA_DIR}/tunnel_vnc_url.txt
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
  if [[ "${GROKPC_NO_TUNNEL:-0}" != "1" ]]; then
    systemctl enable --now grokpc-tunnel.service; systemctl disable --now grokpc-tunnel-vnc.service 2>/dev/null || true  # VNC only via token-protected /novnc proxy
  fi
else
  echo "No systemd: starting the stack with start_stack.sh (background processes)."
  sudo -u "$INSTALL_USER" -H bash "$APP_DIR/start_stack.sh" || true
fi

echo
echo "================================================================"
echo "GrokPC setup finished.  arch=${ARCH}  ram=${MEM_GB}GB  low_mem=${LOW_MEMORY}"
echo "================================================================"
echo "Desktop unit:  systemctl status grokpc-desktop"
echo "Agent unit:    systemctl status grokpc-agent"
echo "API (local):   http://127.0.0.1:8000   (not exposed to the internet)"
echo "noVNC (local): http://127.0.0.1:6080/vnc.html"
echo
if [[ -n "${GEN_TOKEN}" ]]; then
  echo "AGENT_TOKEN (save this, shown only because .env was just created):"
  echo "  ${GEN_TOKEN}"
  echo
fi
if [[ -n "${GEN_VNCPW}" ]]; then
  echo "VNC password (shown only because it was just created):"
  echo "  ${GEN_VNCPW}"
  echo "  (stored in ${VNC_PASS_FILE})"
  echo
fi
sleep 8
if [[ -s "${DATA_DIR}/tunnel_url.txt" ]]; then
  echo "Backend tunnel URL:  $(cat "${DATA_DIR}/tunnel_url.txt")"
fi
if [[ -s "${DATA_DIR}/tunnel_vnc_url.txt" ]]; then
  echo "noVNC tunnel URL:    $(cat "${DATA_DIR}/tunnel_vnc_url.txt")/vnc.html"
fi
echo "Show again any time: sudo bash ${APP_DIR}/show_urls.sh"
echo
echo "Next:"
echo "  1. Edit ${ENV_FILE} and add DEEPSEEK_API_KEY (optional GEMINI / Telegram)."
echo "     Then: sudo systemctl restart grokpc-agent"
echo "  2. Expose localhost with Cloudflare Tunnel (see SERVER_STEPS.md)."
echo "       cloudflared tunnel --url http://127.0.0.1:8000"
echo "  3. In the app Settings, paste the tunnel URL and AGENT_TOKEN."
echo "  4. Open noVNC and log into WhatsApp/Gmail once."
echo "  5. Optional Google Drive:"
echo "       sudo -u ${INSTALL_USER} rclone config     # name the remote: gdrive"
echo "       sudo systemctl enable --now rclone-gdrive"
echo "================================================================"
