#!/usr/bin/env python3
# UPSTREAM-3 verifier tool. usage (repo root): python3 .axiom-work/scripts/upstream3-rebrand-leftovers.py > report.txt
# For every upstream line the candidate changed where "Orca"/"orca" appeared, take each quoted/regex literal
# fragment containing the brand (>= 10 chars) and look for the same old bytes still present elsewhere in the
# candidate's non-test sources: a reader (regex/replace/includes) or a twin writer the rebrand did not reach.
import subprocess, re, sys, collections
sys.dont_write_bytecode = True
UP = '41661e3312'
EX = [':!*.test.*', ':!*.spec.*', ':!**/__fixtures__/**', ':!**/fixtures/**', ':!**/__mocks__/**', ':!**/test-support/**', ':!**/*.md']
diff = subprocess.run(['git','diff','-U0','--no-color',UP,'HEAD','--','src'] + EX, capture_output=True, text=True).stdout
frags = collections.defaultdict(set)
cur = None
for l in diff.split('\n'):
    if l.startswith('+++ '): cur = l[6:] if l.startswith('+++ b/') else None
    elif l.startswith('-') and not l.startswith('---') and cur:
        body = l[1:]
        if re.match(r'\s*(//|\*|/\*)', body): continue
        for m in re.finditer(r"""'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`|(?<![\w)\]])/((?:[^/\\\n]|\\.)+)/[dgimsuyv]*""", body):
            s = next(g for g in m.groups() if g is not None)
            for piece in re.split(r'\$\{[^}]*\}', s):
                if re.search(r'Orca|orca', piece) and len(piece.strip()) >= 10:
                    frags[piece.strip()].add(cur)
cand = subprocess.run(['git','grep','-n','-I','-e','Orca','-e','orca','--','src'] + EX, capture_output=True, text=True).stdout.split('\n')
hits = []
for frag, srcs in sorted(frags.items()):
    r = [x for x in cand if frag in x]
    if r:
        hits.append((frag, sorted(srcs), r))
for frag, srcs, lines in hits:
    print('## %r  (rebranded in: %s)' % (frag[:110], ', '.join(srcs)[:200]))
    for x in lines[:4]: print('   still:', x[:190])
print('TOTAL fragments', len(frags), 'with leftovers', len(hits))
