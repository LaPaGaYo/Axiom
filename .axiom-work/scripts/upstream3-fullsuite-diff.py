#!/usr/bin/env python3
"""Classify a vitest run's failures against a pristine-upstream baseline run on the same host (UPSTREAM-3).

usage: upstream3-fullsuite-diff.py <candidate.log> <baseline.log> [--report <out.md>]

A test that fails in both logs is environmental on this host; a test that fails only in the candidate log is
merge-caused. Tests are keyed by "<project> <file> > <describe…> > <name>" exactly as vitest prints them in its
"Failed Tests" section. Read-only apart from the optional report.
"""
import collections, re, sys

sys.dont_write_bytecode = True


def failures(path):
    raw = open(path, encoding='utf-8', errors='replace').read()
    text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw)
    start = text.find('Failed Tests')
    blocks = re.split(r'\n(?= FAIL  )', text[start:] if start >= 0 else text)
    found = {}
    for block in blocks[1:]:
        lines = block.split('\n')
        name = re.sub(r'\s+', ' ', lines[0].replace(' FAIL  ', '').strip())
        error = ''
        for line in lines[1:40]:
            s = line.strip()
            if re.match(r'^(\w*Error|Error)\b', s):
                error = s[:200]
                break
        found.setdefault(name, error)
    return found


def by_file(names):
    counts = collections.Counter(n.split(' > ')[0] for n in names)
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    cand, base = failures(argv[1]), failures(argv[2])
    both = sorted(set(cand) & set(base))
    only_cand = sorted(set(cand) - set(base))
    only_base = sorted(set(base) - set(cand))
    print(f'candidate failures {len(cand)}, baseline failures {len(base)}: environmental {len(both)}, '
          f'merge-caused {len(only_cand)}, baseline-only {len(only_base)}')
    for title, names in (('environmental', both), ('merge-caused', only_cand)):
        print(f'== {title}, by file')
        for f, n in by_file(names):
            print(f'{n:5d}  {f}')
    if '--report' in argv:
        out = argv[argv.index('--report') + 1]
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write('## Merge-caused (fail only on the candidate)\n\n')
            for f, n in by_file(only_cand):
                fh.write(f'### `{f}` — {n}\n\n')
                for name in only_cand:
                    if name.split(' > ')[0] == f:
                        fh.write(f'- {name.split(" > ", 1)[1] if " > " in name else name}\n')
                        if cand[name]:
                            fh.write(f'  - `{cand[name]}`\n')
                fh.write('\n')
            fh.write('## Environmental (fail identically on pristine upstream on this host)\n\n')
            for f, n in by_file(both):
                fh.write(f'### `{f}` — {n}\n\n')
                for name in both:
                    if name.split(' > ')[0] == f:
                        fh.write(f'- {name.split(" > ", 1)[1] if " > " in name else name}\n')
                fh.write('\n')
            if only_base:
                fh.write('## Fail only on the baseline\n\n')
                for name in only_base:
                    fh.write(f'- {name}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
