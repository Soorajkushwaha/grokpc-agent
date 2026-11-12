#!/usr/bin/env bash
# Run a Cloudflare quick tunnel to 127.0.0.1:<port>; write the public URL to <file>.
# Usage: run_tunnel.sh 8000 /app/data/tunnel_url.txt
set -uo pipefail
PORT="${1:-8000}"
OUT="${2:-/app/data/tunnel_url.txt}"
mkdir -p "$(dirname "$OUT")"
: > "$OUT"
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    echo "${BASH_REMATCH[1]}" > "$OUT"
    echo "[grokpc] tunnel for :${PORT} -> ${BASH_REMATCH[1]}"
  fi
done
