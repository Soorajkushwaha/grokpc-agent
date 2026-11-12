#!/usr/bin/env bash
# Restart the stack after a codespace stop/start (processes do not survive a stop).
set -uo pipefail
export CODESPACES="${CODESPACES:-1}"
if [[ -x /app/agent/start_stack.sh ]]; then
  bash /app/agent/start_stack.sh || true
else
  echo "GrokPC abhi install nahi hua (post-create pending?). Skip."
fi
