#!/usr/bin/env python3
"""Run the pins of every earlier Task against the current tree (verifier tooling, read-only).

Usage: python3 -I .axiom-work/scripts/union-sidecar-check.py <repo-root> [--list <file>] [extra-id ...]

The ids come from .axiom-work/sidecar-union.list (one per line, in merge order; --list names another file) plus the
ids on the command line.
For each id the last `extra:` line of .axiom-work/briefs/<id>.verify is split at ';'. An assertion runs when it is a
plain grep / test / ls / [ / git grep / git ls-files / git diff check. It is skipped when it calls pnpm, node or npx,
writes or moves anything, redirects output, or diffs against main or the protected base (such a diff describes the
Task that wrote it, not the tree). A diff against any other ref does run. Each distinct assertion runs once.

"Calls" and "redirects" are judged on the command text only: what stands inside quotes is a pattern or a path, not a
command, so `git grep -E "reset --hard|git clean"` and `grep -q "<title>" file` do run; a `$( )` inside double quotes
is command text again. A name counts only as a whole word (`config/tsconfig.node.json` is not a call of node), and
`2>/dev/null` is not a redirect that writes. An assertion is judged whole, quotes included, as it was before this
rule, when the scanner cannot read it (an unclosed quote) or when it calls something whose quoted argument is a
program (awk, sed, xargs, find, a shell).

A pin that a later, approved Task replaced is retired in .axiom-work/sidecar-union.retired (planner-owned): one line
per pin, three tab-separated fields - the Task that retires it, the Task whose sidecar holds it, and the assertion
exactly as that sidecar has it; lines starting with # say why and what replaced it. A retired assertion is not run.
A line that names a Task other than the first one whose sidecar holds that assertion, or that retires nothing,
counts as a failed assertion (`FAIL [retired] ...`), so the file never holds a stale entry; a malformed line stops
the script before anything runs.

Prints one line per failed assertion, a line `retired N` when the retired file has entries, and a last line
`ran N skipped N failed N unique N` (unique counts the retired ones too).
Exit code: 0 when nothing failed, 1 otherwise, 2 when the list or a listed sidecar is missing or a line of the
retired file is malformed.

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
# assertion text -> [the Task whose sidecar holds it, met]
retired = {}
retired_file = root / '.axiom-work/sidecar-union.retired'
if retired_file.is_file():
    for number, line in enumerate(retired_file.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip() or line.startswith('#'):
            continue
        fields = [field.strip() for field in line.split('\t')]
        if len(fields) != 3 or not all(fields) or fields[2] in retired:
            print('bad line %d in %s' % (number, retired_file))
            sys.exit(2)
        retired[fields[2]] = [fields[1], False]
SAFE = re.compile(r'^(!\s*)?(grep|test|ls|\[|git (grep|ls-files|diff))\b')
WHOLE = re.compile(r'\b(pnpm|node|npx|python3?|rm|mv|cp|tee|git (switch|checkout|reset|commit|merge|stash|clean|branch|update-ref|add|push|fetch))\b|union-sidecar-check|>')
WORD = r'(?<![\w./-])(%s)(?![\w./-])'
CALL = re.compile(
    WORD % r'pnpm|node|npx|python3?|rm|mv|cp|tee|git\s+(switch|checkout|reset|commit|merge|stash|clean|branch|update-ref|add|push|fetch)'
    + r'|union-sidecar-check|>'
)
# For these a quoted argument is a program, not a pattern.
PROGRAM = re.compile(WORD % r'awk|sed|perl|ruby|sh|bash|zsh|eval|exec|find|xargs|env|source')


def command_text(a):
    """The assertion without what stands inside quotes. Single quotes are literal. Double quotes are literal except
    for `$( )`, which is command text again and may hold quotes of its own. Returns None when a quote or a `$( )`
    is not closed."""
    out = []
    stack = ['code']
    i = 0
    while i < len(a):
        c = a[i]
        top = stack[-1]
        if top == 'single':
            if c == "'":
                stack.pop()
                out.append(c)
        elif top == 'double':
            if c == chr(92):
                i += 1
            elif c == '"':
                stack.pop()
                out.append(c)
            elif a.startswith('$(', i):
                stack.append('subst')
                out.append('$(')
                i += 1
        else:
            if c == chr(92):
                i += 1
            elif c == "'":
                stack.append('single')
                out.append(c)
            elif c == '"':
                stack.append('double')
                out.append(c)
            elif a.startswith('$(', i) or c == '(':
                stack.append('subst')
                out.append('$(' if c == '$' else c)
                i += 1 if c == '$' else 0
            elif c == ')' and top == 'subst':
                stack.pop()
                out.append(c)
            else:
                out.append(c)
        i += 1
    return ''.join(out) if stack == ['code'] else None


def blocked(a):
    text = command_text(a)
    if text is None or PROGRAM.search(text):
        return WHOLE.search(a)
    return CALL.search(text.replace('2>/dev/null', ' '))


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
        if a in retired:
            if retired[a][0] != i:
                print('FAIL [retired] names %s but %s holds it first: %s' % (retired[a][0], i, a[:300]))
                failed += 1
            retired[a][1] = True
            continue
        if not SAFE.match(a) or blocked(a) or MAIN_DIFF.search(a):
            skipped += 1
            continue
        ran += 1
        r = subprocess.run(['bash', '-c', a], cwd=root, capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            failed += 1
            print('FAIL [' + i + '] ' + a[:400])
for a, (holder, met) in retired.items():
    if not met:
        print('FAIL [retired] retires nothing (%s): %s' % (holder, a[:300]))
        failed += 1
if retired:
    print('retired %d' % len(retired))
print('ran %d skipped %d failed %d unique %d' % (ran, skipped, failed, len(seen)))
sys.exit(2 if missing else (1 if failed else 0))
