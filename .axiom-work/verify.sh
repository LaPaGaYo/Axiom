#!/usr/bin/env bash
# Independent verification of an attempt on the Mac toolchain: .axiom-work/verify.sh <BRIEF-ID> <seq> [extra check commands...]
# Runs the repository gates against the checked-out candidate and logs to .axiom-work/logs/verify-<id>-<seq>-<ts>.log
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ID="${1:?}"; SEQ="${2:?}"; shift 2
# Remaining args: vitest targets (files/dirs) for the unit-tests step; VERIFY_EXTRA holds extra shell commands separated by ';'.
TEST_TARGETS=("$@")
mkdir -p .axiom-work/logs
TS=$(date +%Y%m%d-%H%M%S); LOG=".axiom-work/logs/verify-$ID-$SEQ-$TS.log"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null 2>&1
exec > >(tee "$LOG") 2>&1
BRANCH="axiom/attempt/$ID/$SEQ"
echo "== verify $ID seq=$SEQ start $(date)"
echo "branch: $(git branch --show-current) (expected $BRANCH)"; echo "candidate: $(git rev-parse HEAD)"; echo "tree clean: $([ -z "$(git status --porcelain)" ] && echo yes || echo NO)"
echo "node: $(node --version)  pnpm: $(pnpm --version)  git: $(git --version)"
FAIL=0
run() { local name="$1"; shift; echo; echo "---- CHECK $name :: $*"; local t0=$(date +%s); "$@"; local rc=$?; local t1=$(date +%s); echo "---- RESULT $name rc=$rc duration=$((t1-t0))s"; [ $rc -eq 0 ] || FAIL=1; }
run vendor-egress-ratchet pnpm run check:vendor-egress-ratchet
if [ ${#TEST_TARGETS[@]} -gt 0 ]; then run unit-tests pnpm test "${TEST_TARGETS[@]}"; fi
run typecheck-node pnpm tc:node
run typecheck-cli pnpm tc:cli
run typecheck-web pnpm tc:web
run code-quality-changed pnpm run check:code-quality:changed
IFS=';' read -ra EXTRAS <<< "${VERIFY_EXTRA:-}"
for extra in "${EXTRAS[@]}"; do [ -n "$extra" ] && run "extra" bash -c "$extra"; done
run full-lint pnpm lint
echo; echo "== verify $ID seq=$SEQ end $(date) OVERALL=$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)"
