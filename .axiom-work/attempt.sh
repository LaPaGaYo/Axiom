#!/usr/bin/env bash
# One click = one Attempt + immediate independent verification.
#   .axiom-work/attempt.sh <BRIEF-ID> [seq] [--base <ref>]
# Verification inputs come from the brief's sidecar .axiom-work/briefs/<ID>.verify (optional):
#   targets: <vitest files/dirs, space separated>
#   extra: <shell commands separated by ';'>   (exported as VERIFY_EXTRA)
# Branching policy: seq 1 starts from --base (default main); seq N>1 stacks on axiom/attempt/<ID>/<N-1>.
# Everything is logged to .axiom-work/logs/attempt-<ID>-<seq>-<ts>.log plus a one-screen .summary next to it.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
ID="${1:?usage: attempt.sh <BRIEF-ID> [seq] [--base <ref>]}"; shift
SEQ=1; BASE=main
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    *) SEQ="$1"; shift ;;
  esac
done
BRIEF=".axiom-work/briefs/$ID.md"; [ -f "$BRIEF" ] || { echo "missing $BRIEF"; exit 2; }
mkdir -p .axiom-work/logs
TS=$(date +%Y%m%d-%H%M%S); LOG=".axiom-work/logs/attempt-$ID-$SEQ-$TS.log"; SUMMARY=".axiom-work/logs/attempt-$ID-$SEQ-$TS.summary"
exec > >(tee "$LOG") 2>&1
echo "== attempt $ID seq=$SEQ start $(date)"

# 1. Preconditions: clean tree, correct starting point.
if [ -n "$(git status --porcelain)" ]; then echo "ERROR: working tree not clean; refusing to start an attempt on top of uncommitted changes"; git status --short | head -20; exit 3; fi
if [ -f .git/index.lock ] && ! pgrep -x git >/dev/null 2>&1; then rm -f .git/index.lock && echo "== removed stale .git/index.lock"; fi
BRANCH="axiom/attempt/$ID/$SEQ"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "== branch $BRANCH exists; re-running on it"; git switch -q "$BRANCH" || exit 4
else
  START="$BASE"; [ "$SEQ" -gt 1 ] && START="axiom/attempt/$ID/$((SEQ-1))"
  git switch -q "$START" || { echo "ERROR: cannot switch to start point $START"; exit 4; }
  echo "== starting from $START ($(git rev-parse --short HEAD))"
fi
BASE_SHA=$(git rev-parse HEAD)

# 2. Worker attempt (Codex). run-codex.sh creates/switches the branch and commits whatever the Worker left.
# Why the snapshot: a sandboxed `pnpm install --offline --ignore-scripts` re-links node_modules and strips the
# Electron binary (M0-06a attempt 1); verification must not run on a toolchain the Worker damaged.
nm_fingerprint() { node -e 'const fs=require("fs");for(const p of ["node_modules/.modules.yaml","node_modules/electron/path.txt","node_modules/electron/dist/version"]){try{console.log(p,fs.statSync(p).mtimeMs)}catch{console.log(p,"missing")}}' 2>/dev/null; }
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null 2>&1
NM_BEFORE=$(nm_fingerprint)
bash .axiom-work/run-codex.sh "$ID" "$SEQ"
CODEX_RC=$?
NM_AFTER=$(nm_fingerprint)
if [ "$NM_BEFORE" != "$NM_AFTER" ]; then
  echo "== WARNING: the Worker modified node_modules (install/relink); repairing with pnpm install --frozen-lockfile before verification"
  echo "-- before:"; echo "$NM_BEFORE"; echo "-- after:"; echo "$NM_AFTER"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  pnpm install --frozen-lockfile 2>&1 | tail -5
  echo "== repair rc=${PIPESTATUS[0]}"
  NM_REPAIRED=1
else
  NM_REPAIRED=0
fi
HEAD_SHA=$(git rev-parse HEAD)
echo "== worker finished rc=$CODEX_RC base=$(git rev-parse --short "$BASE_SHA") head=$(git rev-parse --short "$HEAD_SHA")"
{
  echo "attempt: $ID seq=$SEQ branch=$BRANCH"
  echo "worker rc: $CODEX_RC"
  echo "candidate: $HEAD_SHA (base $BASE_SHA)"
  echo "report: $([ -f ".axiom-work/reports/$ID-$SEQ.md" ] && echo present || echo MISSING)"
  [ "$NM_REPAIRED" = 1 ] && echo "node_modules: MODIFIED BY WORKER — repaired before verification (see log)"
} > "$SUMMARY"

if [ "$HEAD_SHA" = "$BASE_SHA" ]; then
  echo "== no candidate commit produced; skipping verification"; echo "verification: SKIPPED (no candidate)" >> "$SUMMARY"
else
  # 3. Independent verification on the same machine, driven by the sidecar.
  SIDECAR=".axiom-work/briefs/$ID.verify"; TARGETS=(); export VERIFY_EXTRA=""
  if [ -f "$SIDECAR" ]; then
    T=$(sed -n 's/^targets:[[:space:]]*//p' "$SIDECAR" | tail -1); [ -n "$T" ] && read -ra TARGETS <<< "$T"
    VERIFY_EXTRA=$(sed -n 's/^extra:[[:space:]]*//p' "$SIDECAR" | tail -1)
  fi
  echo "== verification targets: ${TARGETS[*]:-<none>}; extra: ${VERIFY_EXTRA:-<none>}"
  bash .axiom-work/verify.sh "$ID" "$SEQ" ${TARGETS[@]+"${TARGETS[@]}"}
  VLOG=$(ls -t .axiom-work/logs/verify-"$ID"-"$SEQ"-*.log | head -1)
  { echo "verification log: $VLOG"; grep -E '^---- RESULT|OVERALL=' "$VLOG"; } >> "$SUMMARY"
fi
echo; echo "== SUMMARY ($SUMMARY)"; cat "$SUMMARY"
echo "== attempt $ID seq=$SEQ end $(date)"
