#!/usr/bin/env bash
# Merged-tree regression on main after integrating one or more tasks: .axiom-work/verify-merged.sh <ID> [<ID>...]
# Runs verify.sh on the current main checkout with the union of the tasks' sidecar targets and extras.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ $# -ge 1 ] || { echo "usage: verify-merged.sh <ID> [<ID>...]"; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean"; exit 3; }
git switch -q main || exit 4
TARGETS=(); EXTRAS=""
for ID in "$@"; do
  SC=".axiom-work/briefs/$ID.verify"; [ -f "$SC" ] || { echo "missing $SC"; continue; }
  T=$(sed -n 's/^targets:[[:space:]]*//p' "$SC" | tail -1); [ -n "$T" ] && read -ra ADD <<< "$T" && TARGETS+=("${ADD[@]}")
  E=$(sed -n 's/^extra:[[:space:]]*//p' "$SC" | tail -1); [ -n "$E" ] && EXTRAS="${EXTRAS:+$EXTRAS;}$E"
done
# de-duplicate targets
UNIQ=(); for t in ${TARGETS[@]+"${TARGETS[@]}"}; do case " ${UNIQ[*]:-} " in *" $t "*) ;; *) UNIQ+=("$t");; esac; done
export VERIFY_EXTRA="$EXTRAS"
echo "== merged-tree verification on main $(git rev-parse --short HEAD) for: $*"
bash .axiom-work/verify.sh merged "$(git rev-parse --short HEAD)" ${UNIQ[@]+"${UNIQ[@]}"}
