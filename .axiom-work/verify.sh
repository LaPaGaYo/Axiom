#!/usr/bin/env bash
# Independent verification of an attempt on the Mac toolchain: .axiom-work/verify.sh <BRIEF-ID> <seq> [extra check commands...]
# Runs the repository gates against the checked-out candidate and logs to .axiom-work/logs/verify-<id>-<seq>-<ts>.log
# Why main(): bash reads a script lazily while it runs; wrapping the body in a function makes bash parse all of it
# before executing, so editing this file during a run cannot corrupt the running instance (FT-01 attempt 1 lesson).
main() {
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
# Why: this live-shell suite spawns real login shells synchronously and has hung the host run for 25+ minutes
# (M0-10 attempt 1, 2026-10-15); it is on the known-environmental list, so keep it out of the focused step.
HANGING_EXCLUDES=(--exclude "src/shared/startup-shell-portability.live-shell.test.ts")
if [ ${#TEST_TARGETS[@]} -gt 0 ]; then run unit-tests pnpm test "${TEST_TARGETS[@]}" "${HANGING_EXCLUDES[@]}"; fi
# Why: the three tsconfigs are composite/incremental and a stale config/*.tsbuildinfo can hide a
# cross-file type error (2026-10-17: the first hosted Axiom CI run failed tc:node on a parity check
# that the launcher's 1 s incremental run had passed for nine attempts). A clean run costs seconds.
rm -f config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo
run typecheck-node pnpm tc:node
run typecheck-cli pnpm tc:cli
run typecheck-web pnpm tc:web
run code-quality-changed pnpm run check:code-quality:changed
IFS=';' read -ra EXTRAS <<< "${VERIFY_EXTRA:-}"
# An assertion whose command is missing on this host (e.g. `! rg …` without ripgrep) must not pass vacuously:
# bash -c returns 127, `!` inverts it, and the check would look green. Treat "command not found" as a failed check.
run_extra() { local cmd="$1"; echo; echo "---- CHECK extra :: $cmd"; local t0=$(date +%s); local out; out=$(bash -c "$cmd" 2>&1); local rc=$?; [ -n "$out" ] && printf '%s\n' "$out"; if printf '%s' "$out" | grep -q "command not found"; then echo "---- extra INVALID: a command in this assertion is not installed on this host"; rc=127; fi; local t1=$(date +%s); echo "---- RESULT extra rc=$rc duration=$((t1-t0))s"; [ $rc -eq 0 ] || FAIL=1; }
for extra in "${EXTRAS[@]}"; do [ -n "$extra" ] && run_extra "$extra"; done
run full-lint pnpm lint
echo; echo "== verify $ID seq=$SEQ end $(date) OVERALL=$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)"
}
main "$@"
