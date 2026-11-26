#!/usr/bin/env bash
# Обновление до последней версии: sudo bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git -c safe.directory="$APP_DIR" pull --ff-only
npm ci --omit=dev
chown -R sellers:sellers "$APP_DIR"
systemctl restart sellers-place
echo "Обновлено. Логи: journalctl -u sellers-place -f"
