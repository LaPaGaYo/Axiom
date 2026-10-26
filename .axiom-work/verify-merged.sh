#!/usr/bin/env bash
# Merged-tree regression on main after integrating one or more tasks: .axiom-work/verify-merged.sh <ID> [<ID>...]
# Runs verify.sh on the current main checkout with the union of the tasks' sidecar targets and extras.
# Why main(): bash reads a script lazily while it runs; wrapping the body in a function makes bash parse all of it
# before executing, so editing this file during a run cannot corrupt the running instance (FT-01 attempt 1 lesson).
main() {
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
# de-duplicate extras by exact text, first occurrence wins (2026-10-26: the union repeated the same guards up to
# 39 times — the vendor-egress grep and typecheck:e2e alone cost ~10 min per run; a sidecar holds no newlines)
IFS=';' read -ra ALL_E <<< "$EXTRAS"; UNIQ_E=(); DUP_E=0
for e in ${ALL_E[@]+"${ALL_E[@]}"}; do
  [ -n "$e" ] || continue
  # Why grep -c, not -q: under pipefail, -q exits at the first match and the printf dies of SIGPIPE, so the pipeline
  # reports failure for matched items once the list is long enough; -c reads the whole input.
  if [ ${#UNIQ_E[@]} -gt 0 ] && [ "$(printf '%s\n' "${UNIQ_E[@]}" | grep -cxF -- "$e")" -gt 0 ]; then DUP_E=$((DUP_E+1)); else UNIQ_E+=("$e"); fi
done
EXTRAS=$(IFS=';'; printf '%s' "${UNIQ_E[*]+"${UNIQ_E[*]}"}")
echo "== extras: ${#UNIQ_E[@]} unique, $DUP_E duplicates dropped"
export VERIFY_EXTRA="$EXTRAS"
echo "== merged-tree verification on main $(git rev-parse --short HEAD) for: $*"
bash .axiom-work/verify.sh merged "$(git rev-parse --short HEAD)" ${UNIQ[@]+"${UNIQ[@]}"}
}
main "$@"
