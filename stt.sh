#!/usr/bin/env bash
# Keeps the local Whisper service alive. Restarts on exit, logs to stt.log.
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements-stt.txt
fi
while true; do
  echo "[stt.sh] starting $(date)" >> stt.log
  .venv/bin/python stt_server.py >> stt.log 2>&1
  echo "[stt.sh] exited ($?), restarting in 2s" >> stt.log
  sleep 2
done
