#!/usr/bin/env bash
# Runs the "Axiom-scoped unit tests" step of .github/workflows/axiom-ci.yml exactly as it is written there: Vitest
# under Node. `pnpm test` (the unit-tests step of verify.sh) runs Vitest under Bun, where a setup file replaces some
# Node built-ins by plain objects; a test can pass there and fail on CI (2026-11-10, CI #98: vi.spyOn on the
# node:fs/promises namespace). The command is read from the workflow (ci_axiom_unit_command.py), so the two cannot
# drift apart. Read-only: it never installs or rebuilds anything.
# Usage: .axiom-work/scripts/ci-axiom-unit.sh [--print]
main() {
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
CMD=$(python3 -I .axiom-work/scripts/ci_axiom_unit_command.py) || { echo "could not read the Axiom-scoped unit tests step from .github/workflows/axiom-ci.yml"; exit 2; }
[ -n "$CMD" ] || { echo "empty CI command"; exit 2; }
printf '%s\n' "$CMD"
if [ "${1:-}" = "--print" ]; then exit 0; fi
# CI installs with native-runtime: node; refuse to run against modules built for another runtime instead of rebuilding.
node config/scripts/ensure-native-runtime.mjs --runtime=node --check-only || { echo "native modules are not built for Node"; exit 2; }
bash -c "$CMD"
}
main "$@"
