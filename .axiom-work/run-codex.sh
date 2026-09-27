#!/usr/bin/env bash
# Launch one Codex Attempt for a brief: .axiom-work/run-codex.sh <BRIEF-ID> [seq]
# Works on a branch axiom/attempt/<id>/<seq> in this worktree; logs to .axiom-work/logs/.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ID="${1:?usage: run-codex.sh <BRIEF-ID> [seq]}"; SEQ="${2:-1}"
BRIEF=".axiom-work/briefs/$ID.md"; [ -f "$BRIEF" ] || { echo "missing $BRIEF"; exit 2; }
mkdir -p .axiom-work/logs .axiom-work/reports
TS=$(date +%Y%m%d-%H%M%S); LOG=".axiom-work/logs/$ID-$SEQ-$TS.log"; LAST=".axiom-work/logs/$ID-$SEQ-last.md"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null 2>&1
BRANCH="axiom/attempt/$ID/$SEQ"
git switch -c "$BRANCH" 2>/dev/null || git switch "$BRANCH" || exit 3
{ echo "== codex attempt $ID seq=$SEQ branch=$BRANCH start $(date)"; echo "base: $(git rev-parse --short HEAD)"; echo "codex: $(codex --version 2>&1)"; echo "node: $(node --version 2>&1)"; } | tee "$LOG"
codex exec -s workspace-write --color never -C "$PWD" -o "$LAST" "$(cat "$BRIEF")" 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
{ echo "== codex exit rc=$RC $(date)"; echo "== git status"; git status --porcelain; } | tee -a "$LOG"
# The launcher commits the attempt so the candidate has an immutable identity even if the sandbox
# kept Codex from touching .git; the verifier squashes/renames at integration time.
# Codex's sandbox can leave a stale index.lock behind (it may not be allowed to unlink it); clear it only when no git process is alive.
if [ -f .git/index.lock ] && ! pgrep -x git >/dev/null 2>&1; then rm -f .git/index.lock && echo "== removed stale .git/index.lock" | tee -a "$LOG"; fi
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c core.hooksPath=/dev/null commit -q -m "codex($ID): attempt $SEQ (launcher commit)" -m "Brief: $BRIEF" -m "Log: $LOG" && echo "== committed $(git rev-parse --short HEAD)" | tee -a "$LOG"
fi
{ echo "== last commits"; git log --oneline -3; } | tee -a "$LOG"
