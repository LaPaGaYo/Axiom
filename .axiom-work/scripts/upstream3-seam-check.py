#!/usr/bin/env python3
"""UPSTREAM-3 verification extra: every Axiom touchpoint that main had inside upstream-owned code is still there.
Compares the candidate working tree against .axiom-work/upstream-3-seams.tsv (written by upstream3-prep.py from
main) and exits 1 when any count dropped. A drop is not automatically wrong (upstream may have merged two call
sites), but each one must be explained in the attempt report."""
import os
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upstream3_seams import CODE, count_touchpoints  # noqa: E402

os.chdir(subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip())
axiom_added = set(open('.axiom-work/upstream-3-axiom-added.txt').read().split())
files = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'src', 'tests', 'config'],
                       capture_output=True, text=True, check=True).stdout.splitlines()
texts = {}
for p in files:
    if CODE.search(p) and p not in axiom_added and os.path.isfile(p):
        with open(p, encoding='utf-8', errors='replace') as f:
            texts[p] = f.read()
now = count_touchpoints(texts, axiom_added)
dropped = []
total = 0
for line in open('.axiom-work/upstream-3-seams.tsv'):
    if line.startswith('#') or not line.strip():
        continue
    kind, module, name, before = line.rstrip('\n').split('\t')
    total += 1
    after = now.get((kind, module, name), 0)
    if after < int(before):
        dropped.append(f'  {kind:6} {name}' + (f' (from {module})' if module != '-' else '') + f': main {before} -> candidate {after}')
print(f'seam check: {total} touchpoints from main, {len(dropped)} dropped')
print('\n'.join(dropped))
sys.exit(1 if dropped else 0)
