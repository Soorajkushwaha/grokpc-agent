#!/usr/bin/env bash
# GrokPC Termux installer: 24x7 tablet worker (story → Gemini/edge-tts/gTTS → Pollinations + FFmpeg).
# Safe to run as: curl -fsSL https://raw.githubusercontent.com/Soorajkushwaha/grokpc-agent/main/scripts/tablet/install.sh | bash
# Interactive prompts always read from /dev/tty so they work when the script is piped.
set -euo pipefail

REPO_URL="https://github.com/Soorajkushwaha/grokpc-agent.git"
DEST="${GROKPC_HOME:-$HOME/grokpc}"
DATA="${GROKPC_DATA:-$HOME/grokpc-data}"
LOG="$DATA/logs"
ENV_FILE=""
VENV="$DATA/venv"
TTY="/dev/tty"

say() { printf '%s\n' "$*"; }
say_tty() {
  if [[ -w "$TTY" ]]; then
    printf '%s\n' "$*" >"$TTY"
  else
    printf '%s\n' "$*"
  fi
}

# When this file is piped (curl | bash), BASH_SOURCE may be /dev/fd/* and not a real path.
_src="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [[ -n "$_src" && -f "$_src" && "$_src" != /dev/fd/* && "$_src" != /proc/self/fd/* ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$_src")" && pwd)"
fi

if [[ -z "${PREFIX:-}" || "$PREFIX" != *com.termux* ]] && [[ -z "${TERMUX_VERSION:-}" ]]; then
  if [[ "${GROKPC_ALLOW_NON_TERMUX:-}" != "1" ]]; then
    say "Yeh script Termux ke andar chalao (F-Droid wala Termux, Play Store nahi)." >&2
    exit 1
  fi
fi

export HOME="${HOME:-/data/data/com.termux/files/home}"
export PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"

read_tty() {
  # $1 = prompt, $2 = 1 for silent
  local prompt="$1"
  local silent="${2:-0}"
  local val=""
  if [[ -r "$TTY" ]]; then
    printf '%s' "$prompt" >"$TTY"
    if [[ "$silent" == "1" ]]; then
      IFS= read -r -s val <"$TTY" || true
      printf '\n' >"$TTY"
    else
      IFS= read -r val <"$TTY" || true
    fi
  elif [[ -t 0 ]]; then
    printf '%s' "$prompt"
    if [[ "$silent" == "1" ]]; then
      IFS= read -r -s val || true
      printf '\n'
    else
      IFS= read -r val || true
    fi
  else
    say "No TTY for interactive input; skipping prompt: $prompt" >&2
  fi
  printf '%s' "$val"
}

env_get() {
  local key="$1"
  local file="${2:-$ENV_FILE}"
  if [[ -f "$file" ]]; then
    grep -m1 "^${key}=" "$file" 2>/dev/null | cut -d= -f2- || true
  fi
}

env_set() {
  local key="$1"
  local val="$2"
  local file="${3:-$ENV_FILE}"
  local tmp
  touch "$file"
  chmod 600 "$file"
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Replace the existing line; values may contain sed-unfriendly chars so use awk.
    awk -v k="$key" -v v="$val" 'BEGIN{done=0} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    rm -f "$tmp"
    printf '%s=%s\n' "$key" "$val" >>"$file"
  fi
  chmod 600 "$file"
}

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

say "=== GrokPC tablet worker setup ==="
say "Install: $DEST"
say "Data:    $DATA"
say

say "[1/6] pkg update + packages..."
if command -v pkg >/dev/null 2>&1; then
  pkg update -y || true
  pkg install -y python ffmpeg git cloudflared curl
  pkg install -y python-pip >/dev/null 2>&1 || true
  pkg install -y termux-services >/dev/null 2>&1 || say "termux-services optional — skip"
  pkg install -y termux-api >/dev/null 2>&1 || say "termux-api optional — skip"
  pkg install -y termux-tools openssl >/dev/null 2>&1 || true
fi

PYTHON_BIN="$(command -v python || command -v python3 || true)"
if [[ -z "$PYTHON_BIN" ]]; then
  say "ERROR: python nahi mila. Termux me: pkg install python" >&2
  exit 1
fi

mkdir -p "$DATA/outputs" "$DATA/chrome_profile" "$LOG"
ENV_FILE="$DEST/backend/.env"

# Gallery access so finished videos can be copied to Movies/GrokPC.
# Non-blocking: the Android permission popup may appear; install continues either way.
if command -v termux-setup-storage >/dev/null 2>&1; then
  if [[ -d "$HOME/storage/movies" || -d "$HOME/storage/shared" ]]; then
    say "Gallery already ready: $HOME/storage/movies"
  else
    say "termux-setup-storage chalaya — permission popup aa sakta hai. Allow dabana."
    say "Agar popup miss ho jaye, baad mein khud 'termux-setup-storage' chalao."
    termux-setup-storage >/dev/null 2>&1 &
  fi
else
  say "termux-setup-storage nahi mila — videos gallery me save karne ke liye baad mein chalao."
fi

say "[2/6] Repo clone / update..."
if [[ -f "$DEST/backend/main.py" ]]; then
  if [[ -d "$DEST/.git" ]]; then
    git -C "$DEST" pull --ff-only || say "git pull skip (local changes?) — existing tree use ho rahi hai"
  fi
elif [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../../backend/main.py" ]]; then
  SRC_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  mkdir -p "$DEST"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude '.git' --exclude 'frontend/node_modules' --exclude 'frontend/dist' --exclude '**/.venv' --exclude 'backend/.env' "$SRC_ROOT/" "$DEST/"
  else
    tar -C "$SRC_ROOT" --exclude .git --exclude frontend/node_modules --exclude frontend/dist --exclude backend/.venv -cf - . | tar -C "$DEST" -xf -
  fi
else
  git clone --depth 1 "$REPO_URL" "$DEST"
fi

if [[ ! -f "$DEST/backend/main.py" ]]; then
  say "ERROR: $DEST/backend/main.py nahi mila." >&2
  exit 1
fi
chmod +x "$DEST"/scripts/tablet/*.sh 2>/dev/null || true
ENV_FILE="$DEST/backend/.env"

say "[3/6] Python venv + pip (playwright skip)..."
if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip >/dev/null
REQ="$DEST/backend/requirements-termux.txt"
if [[ ! -f "$REQ" ]]; then
  REQ="$DEST/backend/requirements.txt"
fi

install_one() {
  local spec="$1"
  local base="${spec%%=*}"
  base="${base%%[*}"
  case "$base" in
    playwright|playwright-*) say "  skip $spec (Playwright Android pe nahi)"; return 0 ;;
  esac
  if pip install "$spec"; then
    return 0
  fi
  say "  failed: $spec — retrying without extras if possible"
  if [[ "$spec" == *\[* ]]; then
    pip install "${base}" || say "  skip (failed): $spec"
  else
    say "  skip (failed): $spec"
  fi
}

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  install_one "$line"
done < "$REQ"

# requirements-termux.txt already omits playwright; if we used it, also make sure core pkgs are present
pip install fastapi uvicorn httpx pydantic google-genai gTTS edge-tts python-dotenv websockets >/dev/null 2>&1 || true

say "[4/6] .env (token + keys)..."
umask 077
mkdir -p "$(dirname "$ENV_FILE")"
created_env=0
if [[ ! -f "$ENV_FILE" ]]; then
  created_env=1
  token="$("$VENV/bin/python" -c 'import secrets; print(secrets.token_urlsafe(32))')"
  cat > "$ENV_FILE" <<ENVEOF
AGENT_TOKEN=${token}
DEEPSEEK_API_KEY=
GEMINI_API_KEY=
HOST=127.0.0.1
PORT=8000
FRONTEND_ORIGINS=https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000
CHROME_PROFILE_DIR=${DATA}/chrome_profile
OUTPUT_DIR=${DATA}/outputs
DB_PATH=${DATA}/agent_tasks.db
GROKPC_ENV=${ENV_FILE}
ANDROID=1
LOW_MEMORY=1
DRY_RUN=0
HEADLESS=1
PLANNER=gemini
GEMINI_TEXT_MODEL=gemini-3.5-flash-lite
FEATURE_GROK_IMAGINE=0
FEATURE_GOOGLE_VIDS=0
FEATURE_POLLINATIONS=1
FEATURE_VEO=0
USE_GEMINI_TTS=1
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_TTS_VOICE=Charon
TTS_VOICE=hi-IN-MadhurNeural
FEATURE_YOUTUBE_UPLOAD=0
FEATURE_AUTOPILOT=0
FEATURE_CAPCUT=0
FEATURE_CHATGPT_PLANNER=0
ENVEOF
else
  say "Existing $ENV_FILE rakh rahe hain — AGENT_TOKEN overwrite nahi hoga."
  [[ -z "$(env_get AGENT_TOKEN)" ]] && env_set AGENT_TOKEN "$("$VENV/bin/python" -c 'import secrets; print(secrets.token_urlsafe(32))')"
  [[ -z "$(env_get HOST)" ]] && env_set HOST 127.0.0.1
  [[ -z "$(env_get PORT)" ]] && env_set PORT 8000
  [[ -z "$(env_get ANDROID)" ]] && env_set ANDROID 1
  [[ -z "$(env_get PLANNER)" ]] && env_set PLANNER gemini
  [[ -z "$(env_get GEMINI_TEXT_MODEL)" ]] && env_set GEMINI_TEXT_MODEL gemini-3.5-flash-lite
  [[ -z "$(env_get FEATURE_GROK_IMAGINE)" ]] && env_set FEATURE_GROK_IMAGINE 0
  [[ -z "$(env_get FEATURE_GOOGLE_VIDS)" ]] && env_set FEATURE_GOOGLE_VIDS 0
  [[ -z "$(env_get FEATURE_POLLINATIONS)" ]] && env_set FEATURE_POLLINATIONS 1
  [[ -z "$(env_get USE_GEMINI_TTS)" ]] && env_set USE_GEMINI_TTS 1
  [[ -z "$(env_get OUTPUT_DIR)" ]] && env_set OUTPUT_DIR "${DATA}/outputs"
  [[ -z "$(env_get DB_PATH)" ]] && env_set DB_PATH "${DATA}/agent_tasks.db"
  [[ -z "$(env_get CHROME_PROFILE_DIR)" ]] && env_set CHROME_PROFILE_DIR "${DATA}/chrome_profile"
  [[ -z "$(env_get FRONTEND_ORIGINS)" ]] && env_set FRONTEND_ORIGINS "https://grokpc-agent.simple-sooraj.workers.dev,http://localhost:3000,http://127.0.0.1:3000"
fi
chmod 600 "$ENV_FILE"

if [[ -z "$(env_get GEMINI_API_KEY)" ]]; then
  say_tty ""
  say_tty "Gemini API key daalo (AI Studio free key). Screen pe type nahi dikhegi."
  gemini_key="$(read_tty "GEMINI_API_KEY: " 1)"
  if [[ -n "$gemini_key" ]]; then
    env_set GEMINI_API_KEY "$gemini_key"
  else
    say_tty "Warning: GEMINI_API_KEY khali hai. Story step tab tak fail hogi jab tak key .env me na ho."
  fi
fi
if [[ -z "$(env_get DEEPSEEK_API_KEY)" ]]; then
  say_tty "DeepSeek key optional hai — Enter se skip."
  deepseek_key="$(read_tty "DEEPSEEK_API_KEY (optional): " 1)"
  if [[ -n "$deepseek_key" ]]; then
    env_set DEEPSEEK_API_KEY "$deepseek_key"
  fi
fi

say "[5/6] Termux:Boot + watchdog..."
BOOT="$HOME/.termux/boot"
mkdir -p "$BOOT"
cat > "$BOOT/grokpc.sh" <<BOOT
#!/data/data/com.termux/files/usr/bin/sh
# GrokPC tablet worker autostart (Termux:Boot).
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi
sleep 8
nohup bash "$DEST/scripts/tablet/start.sh" >>"$LOG/watchdog.log" 2>&1 &
BOOT
chmod +x "$BOOT/grokpc.sh"

mkdir -p "${PREFIX:-/data/data/com.termux/files/usr}/bin" 2>/dev/null || true
if [[ -n "${PREFIX:-}" && -d "$PREFIX/bin" ]]; then
  cat > "$PREFIX/bin/grokpc-start" <<WRAP
#!/data/data/com.termux/files/usr/bin/sh
exec bash "$DEST/scripts/tablet/start.sh" "\$@"
WRAP
  cat > "$PREFIX/bin/grokpc-urls" <<WRAP
#!/data/data/com.termux/files/usr/bin/sh
exec bash "$DEST/scripts/tablet/show.sh" "\$@"
WRAP
  chmod +x "$PREFIX/bin/grokpc-start" "$PREFIX/bin/grokpc-urls"
fi

say "[6/6] Backend + tunnel start..."
bash "$DEST/scripts/tablet/start.sh" --once || true
bash "$DEST/scripts/tablet/start.sh" --watchdog-bg || true

# Wait for the quick-tunnel URL.
url=""
for _i in $(seq 1 45); do
  if [[ -s "$DATA/tunnel_url.txt" ]]; then
    url="$(tr -d '[:space:]' < "$DATA/tunnel_url.txt")"
    [[ -n "$url" ]] && break
  fi
  sleep 2
done

token="$(env_get AGENT_TOKEN)"

say ""
say "================================================================"
say "GrokPC tablet worker ready."
say "================================================================"
if [[ -n "$url" ]]; then
  say "Backend URL : $url"
else
  say "Backend URL : (abhi ready nahi — thodi der baad 'bash $DEST/scripts/tablet/show.sh' chalao)"
fi
if [[ -n "$token" ]]; then
  say "AGENT_TOKEN : $token"
fi
say ""
say "Yeh URL + token app Settings → Tablet me paste karo, phir worker 'Tablet' chuno."
say "URL reprint:  bash $DEST/scripts/tablet/show.sh"
say "              (ya Termux me: grokpc-urls)"
say ""
say "Zaroori tips (warna HyperOS background me maar dega):"
say "  1. Settings → Apps → Termux: battery optimization OFF / No restrictions, Autostart ON."
say "  2. Termux notification ko dismiss mat karo (foreground rakho)."
say "  3. Recents me Termux ko lock karo. Tablet charge pe rakho."
say "  4. Termux:Boot app ek baar kholo (pehli baar zaroori)."
say "  5. Quick tunnel reboot ke baad badal sakti hai — naya URL show.sh se lo."
say "  6. Videos gallery (Movies/GrokPC) me save hon: ek baar 'termux-setup-storage' chalao, Allow dabao."
say "================================================================"
say "Is worker pe Grok Imagine / Google Vids nahi chalte. Story Gemini/DeepSeek,"
say "awaz Gemini TTS (ya edge-tts / gTTS fallback), visuals Pollinations stills"
say "+ FFmpeg Ken Burns se banti hain. Font mile to Hindi subtitles bhi jalenge."
if [[ "$created_env" == "1" ]]; then
  :
fi
