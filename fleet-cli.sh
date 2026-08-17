#!/bin/bash
set -euo pipefail

echo "Usage: $0 [install | cli | web | check]"
echo "  install  Full setup + build + link (npm ci, pnpm install, build)"
echo "  cli      Start terminal agent (prime-agent.sh)"
echo "  web      Start web dev server (pnpm --dir web --filter @prime-agent/web dev)"
echo "  check    Run checks (npm run check)"

case "${1:-}" in
  install) bash install.sh ;;
  cli) ./prime-agent.sh ;;
  web) pnpm --dir web --filter @prime-agent/web dev ;;
  check) npm run check ;;
  *) echo "Unknown command: ${1:-}"; exit 1 ;;
esac
