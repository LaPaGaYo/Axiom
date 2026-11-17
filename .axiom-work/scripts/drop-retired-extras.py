#!/usr/bin/env python3
"""Drops retired pins from a ';'-separated list of sidecar assertions (verifier tooling).
Usage: drop-retired-extras.py <retired-file> < extras > kept-extras

.axiom-work/sidecar-union.retired names pins of earlier Tasks that a later, approved Task replaced. The union script
(union-sidecar-check.py) does not run them; verify-merged.sh, which runs every listed Task's sidecar on main, must not
either. An assertion is dropped when its text, stripped, equals the third tab-separated field of a line of that file.
Whether an entry names the right Task, and whether it still retires anything, is the union script's check, not this
one's. Prints the kept assertions joined as they came; the number dropped goes to stderr. Exit 2 on a malformed line."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
retired = set()
for number, line in enumerate(Path(sys.argv[1]).read_text(encoding='utf-8').splitlines(), 1):
    if not line.strip() or line.startswith('#'):
        continue
    fields = [field.strip() for field in line.split('\t')]
    if len(fields) != 3 or not all(fields):
        print('bad line %d in %s' % (number, sys.argv[1]), file=sys.stderr)
        sys.exit(2)
    retired.add(fields[2])
kept, dropped = [], 0
for assertion in sys.stdin.read().split(';'):
    if assertion.strip() in retired:
        dropped += 1
    else:
        kept.append(assertion)
sys.stdout.write(';'.join(kept))
print('== extras retired: %d' % dropped, file=sys.stderr)
