#!/usr/bin/env bash
# Install GrokPC inside a GitHub Codespace (or any devcontainer).
set -euo pipefail
export CODESPACES="${CODESPACES:-1}"
export DEBIAN_FRONTEND=noninteractive
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "=== GrokPC Codespaces post-create ==="
echo "Repo: $REPO"
# setup_server.sh must run as root; SUDO_USER stays the container user when invoked via sudo -E.
bash "$REPO/backend/setup_server.sh"
echo
echo "Codespaces port-forward URLs (*.app.github.dev) GitHub login maangte hain."
echo "Phone app ke liye trycloudflare URL use karo:"
echo "  sudo bash /app/agent/show_urls.sh"
echo "Quota / limits: dekho CODESPACES.md"
