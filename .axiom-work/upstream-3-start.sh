#!/usr/bin/env bash
# UPSTREAM-3 (D72): start the one-time full merge of upstream/main on the work branch axiom/upstream-3/merge.
#   bash .axiom-work/upstream-3-start.sh
# 1. fetch upstream (no tags), record upstream / main / merge-base in .axiom-work/upstream-3.target
# 2. git merge --no-ff --no-commit upstream/main on a new work branch
# 3. mechanical resolutions: .axiom-work/scripts/upstream3-resolve.py apply (writes .axiom-work/reports/UPSTREAM-3-inventory.md)
# 4. pnpm install (regenerates pnpm-lock.yaml for the merged package.json; dependency changes are a verifier step)
# 5. commit the merge state as "work commit 0" WITH the remaining conflict markers, for the Worker attempts.
# The work branch is never merged as-is: the final merge commit onto main is built from the fully resolved tree.
# Why main(): bash reads a script lazily while it runs; wrapping the body in a function makes bash parse all of it first.
main() {
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
mkdir -p .axiom-work/logs .axiom-work/reports
TS=$(date +%Y%m%d-%H%M%S); LOG=".axiom-work/logs/upstream-3-start-$TS.log"
exec > >(tee "$LOG") 2>&1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null 2>&1
echo "== UPSTREAM-3 start $(date)"
echo "git: $(git --version)  node: $(node --version)  pnpm: $(pnpm --version 2>&1 | tail -1)  python: $(python3 --version 2>&1)"
WORK=axiom/upstream-3/merge
[ "$(git branch --show-current)" = main ] || { echo "ERROR: expected to be on main"; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "ERROR: working tree not clean"; git status --short | head -20; exit 3; }
if git show-ref --verify --quiet "refs/heads/$WORK"; then echo "ERROR: $WORK already exists"; exit 4; fi
if [ -f .git/index.lock ] && ! pgrep -x git >/dev/null 2>&1; then rm -f .git/index.lock && echo "== removed stale .git/index.lock"; fi
git fetch --no-tags upstream main || { echo "ERROR: fetch failed"; exit 5; }
UP=$(git rev-parse upstream/main); MAIN=$(git rev-parse HEAD); BASE=$(git merge-base HEAD "$UP")
echo "upstream=$UP main=$MAIN merge-base=$BASE upstream-commits=$(git rev-list --count "$BASE..$UP")"
printf 'upstream %s\nmain %s\nbase %s\n' "$UP" "$MAIN" "$BASE" > .axiom-work/upstream-3.target
git switch -q -c "$WORK" || { echo "ERROR: cannot create $WORK"; exit 6; }
T0=$(date +%s)
git -c core.hooksPath=/dev/null -c merge.renameLimit=60000 -c merge.conflictStyle=merge merge --no-ff --no-commit "$UP"; MRC=$?
echo "== git merge rc=$MRC ($(( $(date +%s) - T0 ))s)"
[ -f .git/MERGE_HEAD ] || { echo "ERROR: no merge in progress after git merge (rc=$MRC)"; exit 7; }
git status --porcelain=v1 --untracked-files=no > .axiom-work/reports/UPSTREAM-3-status-at-stop.txt
echo "== unmerged paths at stop: $(git diff --name-only --diff-filter=U | wc -l | tr -d ' ')"
python3 .axiom-work/scripts/upstream3-resolve.py apply || { echo "ERROR: mechanical resolution failed; the merge is left in progress for inspection"; exit 8; }
echo "== pnpm install (regenerate pnpm-lock.yaml for the merged package.json) $(date)"
T1=$(date +%s); pnpm install 2>&1 | tail -30; PRC=${PIPESTATUS[0]}
echo "== pnpm install rc=$PRC ($(( $(date +%s) - T1 ))s)"
echo "== untracked files after install (not committed):"; git status --porcelain | grep '^??' | head -30
git add -u
git add -- .axiom-work/reports/UPSTREAM-3-inventory.md .axiom-work/reports/UPSTREAM-3-status-at-stop.txt
MSG=$(mktemp)
{
  echo "UPSTREAM-3: merge upstream/main ${UP:0:10} - work commit 0 (conflict markers remain)"
  echo
  echo "D72 baseline reset. Mechanical resolutions by .axiom-work/scripts/upstream3-resolve.py: locale JSON"
  echo "3-way merge with the M0-05b-1 brand rule, package.json 3-way merge, pnpm-workspace.yaml and pnpm-lock.yaml"
  echo "from upstream, then pnpm install (rc=$PRC); AGENTS.md and README.md kept; Axiom-deleted paths and new"
  echo "cloud/ files removed. Every other conflict is committed with its markers for the Worker attempts;"
  echo "inventory: .axiom-work/reports/UPSTREAM-3-inventory.md. This work branch is not merged as-is: the final"
  echo "merge commit onto main is built from the fully resolved tree."
} > "$MSG"
git -c core.hooksPath=/dev/null -c user.name="Axiom Launcher" -c user.email="axiom-launcher@localhost" commit --no-verify -q -F "$MSG" || { echo "ERROR: work commit failed"; exit 9; }
rm -f "$MSG"
echo "== work commit $(git rev-parse --short HEAD) parents: $(git log -1 --format=%p)"
echo "== files with conflict markers left: $(grep -c ' hunks$' .axiom-work/reports/UPSTREAM-3-inventory.md)"
git diff --stat HEAD^1 HEAD | tail -1
echo "== UPSTREAM-3 start end $(date)"
}
main "$@"
