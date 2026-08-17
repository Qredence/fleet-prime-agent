#!/bin/bash
set -euo pipefail

echo "[fleet-prime] Installing project..."
npm ci
pnpm install --dir web
npm run build
echo "[fleet-prime] Done. Run 'fleet-prime' to start."
