#!/usr/bin/env python3
"""Run the pins of every earlier Task against the current tree (verifier tooling, read-only).

Usage: python3 -I .axiom-work/scripts/union-sidecar-check.py <repo-root> [--list <file>] [extra-id ...]

The ids come from .axiom-work/sidecar-union.list (one per line, in merge order; --list names another file) plus the
ids on the command line.
For each id the last `extra:` line of .axiom-work/briefs/<id>.verify is split at ';'. An assertion runs when it is a
plain grep / test / ls / [ / git grep / git ls-files / git diff check. It is skipped when it calls pnpm, node or npx,
writes or moves anything, redirects output, or diffs against main or the protected base (such a diff describes the
Task that wrote it, not the tree). A diff against any other ref does run. Each distinct assertion runs once.

Prints one line per failed assertion and a last line `ran N skipped N failed N unique N`.
Exit code: 0 when nothing failed, 1 otherwise, 2 when the list or a listed sidecar is missing.

A Task's own sidecar carries only that Task's assertions and one call of this script, written so that it does
nothing on main: `test "$(git branch --show-current)" = main || python3 -I .axiom-work/scripts/union-sidecar-check.py "$PWD"`.
The script never runs an assertion that mentions python or this script, so there is no recursion."""
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
root = Path(sys.argv[1])
args = sys.argv[2:]
listing = root / '.axiom-work/sidecar-union.list'
if args[:1] == ['--list']:
    listing = Path(args[1])
    args = args[2:]
if not listing.is_file():
    print('missing ' + str(listing))
    sys.exit(2)
ids = [line.strip() for line in listing.read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#')]
ids += [i for i in args if i not in ids]
SAFE = re.compile(r'^(!\s*)?(grep|test|ls|\[|git (grep|ls-files|diff))\b')
BLOCK = re.compile(r'\b(pnpm|node|npx|python3?|rm|mv|cp|tee|git (switch|checkout|reset|commit|merge|stash|clean|branch|update-ref|add|push|fetch))\b|union-sidecar-check|>')
# Only the revision arguments count (before ` -- `): a path such as src/main/... is not the ref main.
MAIN_DIFF = re.compile(r'git diff\b(?:(?! -- )[^|;)])*?\s(main|axiom/upstream-3/protected-base)(?=\s|$)')
seen = set()
ran = skipped = failed = missing = 0
for i in ids:
    f = root / '.axiom-work/briefs' / (i + '.verify')
    if not f.is_file():
        print('missing ' + str(f))
        missing += 1
        continue
    extras = [line[len('extra:'):] for line in f.read_text(encoding='utf-8').splitlines() if line.startswith('extra:')]
    if not extras:
        continue
    for a in extras[-1].split(';'):
        a = a.strip()
        if not a or a in seen:
            continue
        seen.add(a)
        if not SAFE.match(a) or BLOCK.search(a) or MAIN_DIFF.search(a):
            skipped += 1
            continue
        ran += 1
        r = subprocess.run(['bash', '-c', a], cwd=root, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            failed += 1
            print('FAIL [' + i + '] ' + a[:400])
print('ran %d skipped %d failed %d unique %d' % (ran, skipped, failed, len(seen)))
sys.exit(2 if missing else (1 if failed else 0))
