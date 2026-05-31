#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$ROOT_DIR/client"

BACKEND_PID=""
APP_PID=""

cleanup() {
  echo
  echo "[start.sh] Shutting down processes..."
  if [[ -n "${APP_PID}" ]] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  echo "[start.sh] Done."
}

trap cleanup EXIT INT TERM

if ! command -v npm >/dev/null 2>&1; then
  echo "[start.sh] Error: npm is not installed or not in PATH."
  exit 1
fi

START_FLUTTER="${START_FLUTTER:-0}"

if [[ "$START_FLUTTER" == "1" ]]; then
  if ! command -v flutter >/dev/null 2>&1; then
    echo "[start.sh] Error: flutter is not installed or not in PATH."
    exit 1
  fi
fi

echo "[start.sh] Starting backend..."
(
  cd "$ROOT_DIR"
  npm run dev
) &
BACKEND_PID=$!

APP_PID=""
if [[ "$START_FLUTTER" == "1" ]]; then
  echo "[start.sh] Ensuring Flutter dependencies..."
  (
    cd "$CLIENT_DIR"
    flutter pub get
  )
  echo "[start.sh] Starting Flutter app..."
  (
    cd "$CLIENT_DIR"
    flutter run -d windows
  ) &
  APP_PID=$!
fi

echo "[start.sh] Backend PID: $BACKEND_PID"
if [[ -n "$APP_PID" ]]; then
  echo "[start.sh] App PID: $APP_PID"
fi
echo "[start.sh] Admin UI: http://localhost:3000/admin"
echo "[start.sh] Press Ctrl+C to stop."

if [[ -n "$APP_PID" ]]; then
  wait "$APP_PID"
else
  wait "$BACKEND_PID"
fi
