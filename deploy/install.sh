#!/usr/bin/env bash
# Установка SELLERS PLACE на чистый VPS (Ubuntu 22.04 / 24.04, Debian 12).
# Запуск: sudo bash deploy/install.sh   (из папки проекта, склонированной в /opt/sellers-place)
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Запустите от root: sudo bash deploy/install.sh"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
case "$APP_DIR" in /root*) echo "Склонируйте проект в /opt/sellers-place, а не в /root"; exit 1;; esac
cd "$APP_DIR"

echo "==> Системные пакеты"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https git

echo "==> Node.js 22"
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Caddy (HTTPS-сертификат выпускается автоматически)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Зависимости приложения"
npm ci --omit=dev

if [ ! -f .env ]; then
  echo "==> Настройка"
  read -rp "Токен бота от @BotFather: " BOT_TOKEN
  IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
  DEFAULT_DOMAIN="${IP//./-}.sslip.io"
  read -rp "Домен (Enter — бесплатный адрес $DEFAULT_DOMAIN): " DOMAIN
  DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
  read -rp "@username админов через запятую [ranjiroakim]: " ADMINS
  ADMINS="${ADMINS:-ranjiroakim}"
  cat > .env <<EOF
BOT_TOKEN=$BOT_TOKEN
WEBAPP_URL=https://$DOMAIN
CHANNEL_ID=@sellersplace2
CHANNEL_USERNAME=sellersplace2
ADMIN_USERNAMES=$ADMINS
ADS_CONTACT=ranjiroakim
GARANT_CONTACT=ranjiroakim
PAYMENT_CONTACT=ranjiroakim
POST_PRICE=150
AUTO_PUBLISH=false
HOST=127.0.0.1
PORT=3000
DATA_DIR=$APP_DIR/data
EOF
fi
chmod 600 .env
DOMAIN="$(grep '^WEBAPP_URL=' .env | sed 's#^WEBAPP_URL=https://##')"

echo "==> Пользователь и права"
id sellers >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin sellers
mkdir -p data
chown -R sellers:sellers "$APP_DIR"

echo "==> Служба systemd"
cat > /etc/systemd/system/sellers-place.service <<EOF
[Unit]
Description=SELLERS PLACE mini app
After=network-online.target
Wants=network-online.target

[Service]
User=sellers
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sellers-place
systemctl restart sellers-place

echo "==> HTTPS для $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80,443/tcp; fi

echo
echo "Готово! Мини-апп: https://$DOMAIN"
echo "Логи: journalctl -u sellers-place -f"
echo "Дальше: добавьте бота админом в канал и нажмите /start в боте с аккаунта администратора."
