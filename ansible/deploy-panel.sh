#!/usr/bin/env bash
# deploy-panel.sh — Deploys only the control-plane.
# Usage:
#   ./deploy-panel.sh              # Automatically reads ansible_host IP from hosts.ini
#   ./deploy-panel.sh [IP_ADDRESS]  # Provide IP directly

set -e

REMOTE_USER="aegis-shell"
APP_SRC="$(cd "$(dirname "$0")/../control-plane/app" && pwd)/"
APP_DST="/opt/aegis/app/"

# ── Determine host ────────────────────────────────────────────
HOST="${1:-}"
if [[ -z "$HOST" ]]; then
  # Extract ansible_host value from hosts.ini
  HOSTS_FILE="$(dirname "$0")/inventories/dev/hosts.ini"
  HOST=$(grep -oP 'ansible_host=\K[^\s]+' "$HOSTS_FILE" | head -1)
fi

if [[ -z "$HOST" ]]; then
  echo "❌  Host not found. Usage: ./deploy-panel.sh <host>"
  exit 1
fi

echo "▲  Aegis Panel Deploy"
echo "   host : $HOST"
echo "   src  : $APP_SRC"
echo ""

# ── Copy files to temporary directory (no special permissions required) ──
TMPDIR="/tmp/aegis-deploy-$$"
echo "⟳  Copying files… (tmp: $TMPDIR)"
ssh "${REMOTE_USER}@${HOST}" "mkdir -p ${TMPDIR}"
scp -r "${APP_SRC}." "${REMOTE_USER}@${HOST}:${TMPDIR}/"

# ── Move to final location with sudo + restart service ───────
echo "⟳  Installing and restarting service…"
ssh -t "${REMOTE_USER}@${HOST}" "
  sudo cp -r ${TMPDIR}/. ${APP_DST} &&
  rm -rf ${TMPDIR} &&
  sudo systemctl restart aegis-api &&
  echo '✓  Service restarted.'
"

echo ""
echo "✓  Deploy completed → http://${HOST}:8000"