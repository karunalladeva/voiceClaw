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

if ! command -v flutter >/dev/null 2>&1; then
  echo "[start.sh] Error: flutter is not installed or not in PATH."
  exit 1
fi

echo "[start.sh] Starting backend..."
(
  cd "$ROOT_DIR"
  npm run dev
) &
BACKEND_PID=$!

echo "[start.sh] Ensuring Flutter dependencies..."
(
  cd "$CLIENT_DIR"
  flutter pub get
)

echo "[start.sh] Starting Windows Flutter app..."
(
  cd "$CLIENT_DIR"
  flutter run -d windows
) &
APP_PID=$!

echo "[start.sh] Backend PID: $BACKEND_PID"
echo "[start.sh] App PID: $APP_PID"
echo "[start.sh] Press Ctrl+C to stop both."

wait "$APP_PID"
