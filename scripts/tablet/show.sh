#!/usr/bin/env bash
# Reprint the tablet worker's public tunnel URL and AGENT_TOKEN.
set -uo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
HOME="${HOME:-/data/data/com.termux/files/home}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ ! -f "$ROOT/backend/main.py" && -f "$HOME/grokpc/backend/main.py" ]]; then
  ROOT="$HOME/grokpc"
fi
DATA="${GROKPC_DATA:-$HOME/grokpc-data}"
ENV_FILE="${GROKPC_ENV:-$ROOT/backend/.env}"

url=""
if [[ -s "$DATA/tunnel_url.txt" ]]; then
  url="$(tr -d '[:space:]' < "$DATA/tunnel_url.txt")"
fi
token=""
if [[ -f "$ENV_FILE" ]]; then
  token="$(grep -m1 '^AGENT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
fi

echo "======= GrokPC (tablet) ======="
echo "Backend URL : ${url:-not ready — start.sh chalao / logs dekho}"
echo "AGENT_TOKEN : ${token:-missing — install.sh chalao}"
echo "Env file    : $ENV_FILE"
echo "Logs        : $DATA/logs"
echo "=============================="
echo "App Settings → Tablet me URL + token paste karo, phir Home pe worker 'Tablet' chuno."
