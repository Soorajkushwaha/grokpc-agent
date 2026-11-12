#!/data/data/com.termux/files/usr/bin/bash
# One-shot GrokPC installer for Termux (Android ARM64). No root.
# Private repo: curl of a raw GitHub URL will not work. Download the ZIP in
# the tablet browser while logged into GitHub, then:
#   termux-setup-storage
#   bash ~/storage/downloads/grokpc-agent-main/android/setup_termux.sh
set -euo pipefail

if [[ -z "${PREFIX:-}" || "$PREFIX" != *com.termux* ]]; then
  echo "Yeh script Termux ke andar chalao (F-Droid / GitHub wala Termux, Play Store nahi)." >&2
  exit 1
fi

export HOME="${HOME:-/data/data/com.termux/files/home}"
export PATH="$PREFIX/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ ! -f "$SRC_ROOT/backend/main.py" ]]; then
  echo "backend/main.py nahi mila. Poora GitHub ZIP extract karke android/setup_termux.sh yahin se chalao." >&2
  exit 1
fi

DEST="$HOME/grokpc"
DATA="$HOME/.grokpc"
LOG="$DATA/logs"
mkdir -p "$DATA/chrome_profile" "$DATA/outputs" "$DATA/data" "$LOG"

echo "=== GrokPC Termux setup ==="
echo "Source: $SRC_ROOT"
echo "Install: $DEST"
echo "Data: $DATA"
echo
echo "Architecture: native Termux + x11-repo Chromium + Playwright CDP."
echo "Ubuntu proot nahi: Ubuntu 24.04 Chromium snap-only hai, snap proot me unreliable."
echo "Playwright official Android browsers nahi deta."
echo

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

if [[ ! -d "$HOME/storage/downloads" ]] && command -v termux-setup-storage >/dev/null 2>&1; then
  echo "termux-setup-storage: Downloads access ke liye ek prompt aayega — Allow dabaao."
  termux-setup-storage || true
fi

echo "[1/7] pkg update + x11-repo..."
pkg update -y
pkg install -y x11-repo
pkg update -y

echo "[2/7] Installing packages (chromium ~160 MB — Wi-Fi use karo)..."
pkg install -y \
  python python-pip python-playwright playwright \
  chromium \
  tigervnc icewm \
  cloudflared \
  ffmpeg git wget curl jq openssl \
  termux-tools

pkg install -y termux-api >/dev/null 2>&1 || echo "termux-api package skip (optional)"

CHROMIUM_BIN="$(command -v chromium || command -v chromium-browser || true)"
if [[ -z "$CHROMIUM_BIN" ]]; then
  echo "ERROR: chromium install fail. pkg install x11-repo && pkg install chromium" >&2
  exit 1
fi
echo "Chromium: $CHROMIUM_BIN"

echo "[3/7] Copying repo to $DEST ..."
mkdir -p "$DEST"
if ! command -v rsync >/dev/null 2>&1; then
  pkg install -y rsync >/dev/null 2>&1 || true
fi
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.git' --exclude 'frontend/node_modules' --exclude 'frontend/dist' \
    --exclude 'backend/.venv' --exclude '**/.venv' \
    "$SRC_ROOT/" "$DEST/"
else
  tar -C "$SRC_ROOT" --exclude .git --exclude frontend/node_modules --exclude frontend/dist -cf - . | tar -C "$DEST" -xf -
fi
chmod +x "$DEST"/android/*.sh "$DEST/android/xstartup" "$DEST"/backend/*.sh 2>/dev/null || true

echo "[4/7] Python venv (system-site-packages so Termux python-playwright is visible)..."
if [[ ! -x "$DATA/venv/bin/python" ]]; then
  python -m venv --system-site-packages "$DATA/venv"
fi
# shellcheck disable=SC1091
source "$DATA/venv/bin/activate"
pip install --upgrade pip
pip install -r "$DEST/backend/requirements-termux.txt"

echo "[5/7] noVNC web files..."
NOVNC_DIR="$DATA/novnc"
if [[ ! -f "$NOVNC_DIR/vnc.html" ]]; then
  tmp="$(mktemp -d)"
  if wget -q -O "$tmp/novnc.tgz" https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz; then
    tar -xzf "$tmp/novnc.tgz" -C "$tmp"
    mkdir -p "$NOVNC_DIR"
    cp -a "$tmp"/noVNC-*/. "$NOVNC_DIR/"
  else
    echo "WARNING: noVNC download fail. start.sh websockify without --web chalayega."
  fi
  rm -rf "$tmp"
fi

echo "[6/7] Secrets, VNC password, .env..."
ENV_FILE="$DATA/.env"
GEN_TOKEN=""
GEN_VNCPW=""
if [[ ! -f "$ENV_FILE" ]]; then
  GEN_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
  GEN_VNCPW="$(python -c 'import secrets,string; a=string.ascii_letters+string.digits; print("".join(secrets.choice(a) for _ in range(8)))')"
  umask 077
  cat > "$ENV_FILE" <<ENVEOF
AGENT_TOKEN=${GEN_TOKEN}
DEEPSEEK_API_KEY=
GEMINI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
HOST=127.0.0.1
PORT=8000
FRONTEND_ORIGINS=https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000
CHROME_PROFILE_DIR=${DATA}/chrome_profile
GDRIVE_DIR=${HOME}/storage/shared/GrokPC-Drive
OUTPUT_DIR=${DATA}/outputs
DB_PATH=${DATA}/data/agent_tasks.db
USE_GEMINI_TTS=0
DRY_RUN=0
HEADLESS=0
MAX_VISION_STEPS=10
NOVNC_UPSTREAM=http://127.0.0.1:6080
ANDROID=1
LOW_MEMORY=1
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=720
CDP_URL=http://127.0.0.1:9222
CHROMIUM_PATH=${CHROMIUM_BIN}
PLAYWRIGHT_BROWSERS_PATH=0
SCREENSHOT_FORMAT=jpeg
SCREENSHOT_QUALITY=45
SCREENSHOT_TO_UI=0
ENVEOF
else
  echo "Keeping existing $ENV_FILE"
  grep -q '^ANDROID=' "$ENV_FILE" || echo "ANDROID=1" >> "$ENV_FILE"
  grep -q '^CDP_URL=' "$ENV_FILE" || echo "CDP_URL=http://127.0.0.1:9222" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

mkdir -p "$HOME/.vnc"
if [[ ! -f "$HOME/.vnc/passwd" ]]; then
  if [[ -z "$GEN_VNCPW" ]]; then
    GEN_VNCPW="$(python -c 'import secrets,string; a=string.ascii_letters+string.digits; print("".join(secrets.choice(a) for _ in range(8)))')"
  fi
  if command -v vncpasswd >/dev/null 2>&1; then
    printf '%s\n' "$GEN_VNCPW" | vncpasswd -f > "$HOME/.vnc/passwd" 2>/dev/null || true
  fi
  chmod 600 "$HOME/.vnc/passwd" 2>/dev/null || true
  echo "$GEN_VNCPW" > "$DATA/vnc_password.txt"
  chmod 600 "$DATA/vnc_password.txt"
fi
cp -f "$DEST/android/xstartup" "$HOME/.vnc/xstartup"
chmod +x "$HOME/.vnc/xstartup"

echo "[7/7] Termux:Boot autostart + first start..."
BOOT="$HOME/.termux/boot"
mkdir -p "$BOOT"
cat > "$BOOT/grokpc.sh" <<BOOT
#!/data/data/com.termux/files/usr/bin/sh
# GrokPC autostart (Termux:Boot). Wake-lock first, as the Termux wiki recommends.
termux-wake-lock
sleep 8
bash "$DEST/android/start.sh" >>"$LOG/boot.log" 2>&1
BOOT
chmod +x "$BOOT/grokpc.sh"

mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/grokpc-start" <<WRAP
#!/data/data/com.termux/files/usr/bin/sh
exec bash "$DEST/android/start.sh" "\$@"
WRAP
cat > "$PREFIX/bin/grokpc-stop" <<WRAP
#!/data/data/com.termux/files/usr/bin/sh
exec bash "$DEST/android/stop.sh" "\$@"
WRAP
cat > "$PREFIX/bin/grokpc-urls" <<WRAP
#!/data/data/com.termux/files/usr/bin/sh
echo "Backend URL : \$(cat $DATA/tunnel_url.txt 2>/dev/null || echo not-ready)"
v=\$(cat $DATA/tunnel_vnc_url.txt 2>/dev/null || true)
echo "noVNC URL   : \${v:+\$v/vnc.html}"
echo "AGENT_TOKEN : \$(grep -m1 '^AGENT_TOKEN=' $ENV_FILE | cut -d= -f2-)"
WRAP
chmod +x "$PREFIX/bin/grokpc-start" "$PREFIX/bin/grokpc-stop" "$PREFIX/bin/grokpc-urls"

echo
echo "Starting stack for the first time..."
bash "$DEST/android/start.sh" || true

echo
echo "================================================================"
echo "GrokPC Termux setup finished."
echo "================================================================"
if [[ -n "$GEN_TOKEN" ]]; then
  echo "AGENT_TOKEN (save this, shown only because .env was just created):"
  echo "  $GEN_TOKEN"
  echo
fi
if [[ -n "$GEN_VNCPW" ]]; then
  echo "VNC password (8 chars, TigerVNC limit): $GEN_VNCPW"
  echo
fi
echo "Commands:  grokpc-start   grokpc-stop   grokpc-urls"
echo "Env file:  $ENV_FILE   (yahan DEEPSEEK_API_KEY likho)"
echo "Next:"
echo "  1. HyperOS settings (README_HINDI.md): Autostart, No restrictions, lock recents."
echo "  2. Termux:Boot app ek baar kholo."
echo "  3. App Settings me Tablet slot pe tunnel URL + token paste karo."
echo "  4. Trading charts dekhte waqt lag ho toh: grokpc-stop"
echo "================================================================"
