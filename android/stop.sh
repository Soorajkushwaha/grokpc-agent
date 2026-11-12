#!/data/data/com.termux/files/usr/bin/bash
# Stop GrokPC processes on Termux (does not delete the Chrome profile).
set -u
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"

pkill -f "cloudflared tunnel" 2>/dev/null || true
pkill -f "uvicorn" 2>/dev/null || true
pkill -f "python main.py" 2>/dev/null || true
pkill -f "websockify" 2>/dev/null || true
# Leave Chromium running if you only want to restart the API; default: stop it too.
if [[ "${GROKPC_KEEP_CHROME:-0}" != "1" ]]; then
  pkill -f -- "--remote-debugging-port=9222" 2>/dev/null || true
  pkill -f chromium 2>/dev/null || true
fi
vncserver -kill :1 >/dev/null 2>&1 || true
echo "GrokPC stopped. Profile is still in ~/.grokpc/chrome_profile"
echo "Wake lock abhi on ho sakta hai:  termux-wake-unlock"
