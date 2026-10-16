#!/usr/bin/env bash
# Run several attempts back to back: .axiom-work/queue.sh [queue-file]  (default .axiom-work/queue.txt)
# Queue lines: "<ID> [seq] [--base <ref>]"; '#' comments and blank lines are skipped. Each line runs attempt.sh;
# the queue continues after a failed line (the failure is in that attempt's summary) and ends back on main.
# Why main(): bash reads a script lazily while it runs; wrapping the body in a function makes bash parse all of it
# before executing, so editing this file during a run cannot corrupt the running instance (FT-01 attempt 1 lesson).
main() {
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
Q="${1:-.axiom-work/queue.txt}"; [ -f "$Q" ] || { echo "missing $Q"; exit 2; }
mkdir -p .axiom-work/logs
LOG=".axiom-work/logs/queue-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee "$LOG") 2>&1
echo "== queue $Q start $(date)"
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"; [ -z "$line" ] && continue
  echo; echo "== queue item: $line  ($(date))"
  # shellcheck disable=SC2086
  # stdin is the queue file itself: give the attempt /dev/null so no child can swallow the remaining lines
  bash .axiom-work/attempt.sh $line </dev/null; echo "== queue item rc=$?"
  git switch -q main 2>/dev/null || true
done < "$Q"
echo; echo "== queue end $(date)"; ls -t .axiom-work/logs/attempt-*.summary 2>/dev/null | head -5 | while read -r s; do echo "---- $s"; cat "$s"; done
}
main "$@"
