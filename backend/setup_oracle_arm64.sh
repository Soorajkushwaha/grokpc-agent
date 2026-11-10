#!/usr/bin/env bash
# Deprecated name. Use setup_server.sh (Ubuntu 24.04, x86_64 or aarch64).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "note: setup_oracle_arm64.sh is now setup_server.sh (any Ubuntu 24.04 VPS)."
exec bash "$DIR/setup_server.sh" "$@"
