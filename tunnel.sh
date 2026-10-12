#!/usr/bin/env bash
# Keeps a free Cloudflare quick tunnel alive and writes the public URL to .public-url
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
PORT="${PORT:-3210}"
if ! command -v cloudflared >/dev/null; then
  echo "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi
while true; do
  : > tunnel.log
  cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" >> tunnel.log 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tunnel.log | head -1)
    [ -n "$url" ] && echo "$url" > .public-url && break
    sleep 1
  done
  wait $pid
  echo "[tunnel.sh] tunnel exited, restarting in 3s" >> tunnel.log
  sleep 3
done
