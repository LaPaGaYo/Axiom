#!/usr/bin/env bash
# One Codex Attempt in the fixture repository (~/Documents/flowtask-fixture) for a brief kept in this repo, then the fixture's own checks with wall-clock timing.
# Usage: .axiom-work/fixture-attempt.sh <ID> [seq]      (seq 1 branches from main; seq N stacks on N-1)
AX="$(cd "$(dirname "$0")/.." && pwd)"; FX="$HOME/Documents/flowtask-fixture"
ID="${1:?usage: fixture-attempt.sh <ID> [seq]}"; SEQ="${2:-1}"; BRIEF="$AX/.axiom-work/briefs/$ID.md"
[ -f "$BRIEF" ] || { echo "missing $BRIEF"; exit 2; }
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null 2>&1
cd "$FX" || { echo "missing fixture checkout $FX"; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "fixture tree not clean; refusing"; git status --porcelain | head; exit 3; }
BRANCH="attempt/$ID/$SEQ"
if [ "$SEQ" -eq 1 ]; then git switch -q -c "$BRANCH" main || exit 3; else git switch -q -c "$BRANCH" "attempt/$ID/$((SEQ-1))" || exit 3; fi
mkdir -p "$AX/.axiom-work/logs"; TS=$(date +%Y%m%d-%H%M%S); LOG="$AX/.axiom-work/logs/fixture-$ID-$SEQ-$TS.log"; LAST="$AX/.axiom-work/logs/fixture-$ID-$SEQ-$TS.last.txt"
{ echo "== fixture attempt $ID seq=$SEQ branch=$BRANCH base=$(git rev-parse --short HEAD) start $(date)"; echo "codex: $(codex --version 2>&1)"; echo "node: $(node --version) pnpm: $(pnpm --version)"; } | tee "$LOG"
codex exec -s workspace-write --color never -C "$FX" -o "$LAST" "$(cat "$BRIEF")" </dev/null 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
{ echo "== codex exit rc=$RC $(date)"; echo "== git status"; git status --porcelain | head -40; } | tee -a "$LOG"
git add -A && git -c user.name="Axiom Launcher" -c user.email="axiom-launcher@localhost" -c core.hooksPath=/dev/null commit -q -m "codex($ID): attempt $SEQ (launcher commit)" -m "Brief: $BRIEF" && echo "== committed $(git rev-parse --short HEAD)" | tee -a "$LOG"
CAND=$(git rev-parse HEAD)
{
  echo "== verify fixture candidate $CAND $(date)"
  echo "== counts: tracked=$(git ls-files | wc -l | tr -d ' ') test-files=$(git ls-files | grep -c -E '\.test\.ts$')"
  echo "== verify:fast"; S=$(date +%s); pnpm run verify:fast; echo "== verify:fast rc=$? wall=$(( $(date +%s) - S ))s"
  echo "== verify:full"; S=$(date +%s); pnpm run verify:full; echo "== verify:full rc=$? wall=$(( $(date +%s) - S ))s"
  echo "== determinism: second verify:fast"; S=$(date +%s); pnpm run verify:fast >/dev/null 2>&1; echo "== second verify:fast rc=$? wall=$(( $(date +%s) - S ))s"
  echo "== tree after checks (must be clean except dist/ which is ignored):"; git status --porcelain | head
} 2>&1 | tee -a "$LOG"
git switch -q main
echo "== fixture attempt $ID seq=$SEQ end $(date) candidate=$CAND log=$LOG" | tee -a "$LOG"
