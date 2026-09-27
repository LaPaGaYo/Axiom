#!/usr/bin/env bash
# Axiom local toolchain setup on the Mac: Node 24 + pnpm (via corepack, version from package.json)
# + pnpm install + smoke typecheck. Everything is logged to .axiom-work/logs/setup-<ts>.log.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
mkdir -p .axiom-work/logs
LOG=".axiom-work/logs/setup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee "$LOG") 2>&1
echo "== axiom setup start $(date)"
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; nvm install 24 >/dev/null 2>&1; nvm use 24 >/dev/null 2>&1; fi
echo "node: $(node --version 2>&1)"
case "$(node --version 2>/dev/null)" in v24.*) ;; *) echo "ERROR: Node 24 required (package.json engines). Install it (nvm install 24) and re-run."; exit 10;; esac
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0   # corepack would otherwise wait for a Y/n on first download of pnpm@12
corepack enable 2>&1 || true
echo "pnpm: $(pnpm --version 2>&1)"
echo "git: $(git rev-parse --short HEAD) on $(git branch --show-current)"
echo "== pnpm install --frozen-lockfile"
time pnpm install --frozen-lockfile
RC=$?; echo "install rc=$RC"; [ $RC -eq 0 ] || exit $RC
echo "== smoke: pnpm tc:node"
time pnpm tc:node
echo "tc:node rc=$?"
echo "== axiom setup end $(date)"
