#!/usr/bin/env bash
# Idempotent bring-up: Whisper service, web app, tunnel. Prints the public link.
set -e
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Created .env - add your OPENROUTER_API_KEY / KIE_API_KEY"; }
set -a; . ./.env; set +a
PORT="${PORT:-3210}"

running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

if ! running .stt.pid; then
  nohup ./stt.sh > /dev/null 2>&1 & echo $! > .stt.pid
  echo "started whisper service"
fi

if ! running .web.pid; then
  [ -d node_modules ] || pnpm install
  [ -d .next ] || pnpm build
  nohup pnpm start > web.log 2>&1 & echo $! > .web.pid
  echo "started web app on :$PORT"
fi

if command -v cloudflared >/dev/null && ! running .tunnel.pid; then
  rm -f .public-url
  nohup ./tunnel.sh > /dev/null 2>&1 & echo $! > .tunnel.pid
  echo "started tunnel"
fi

for _ in $(seq 1 40); do [ -s .public-url ] && break; sleep 1; done
echo
echo "Local:  http://127.0.0.1:$PORT"
[ -s .public-url ] && echo "Public: $(cat .public-url)"
