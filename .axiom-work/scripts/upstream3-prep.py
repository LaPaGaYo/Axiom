#!/usr/bin/env python3
"""UPSTREAM-3 Worker preparation (D72). Run once by the verifier on axiom/upstream-3/merge after the start script.

1. Conflict markers: where `git merge-file` reproduces git's own 2-way markers byte for byte, rewrite the file
   with diff3 markers (adds the fork-point section between `|||||||` and `=======`); relabel the markers of the
   rest so every file names its sides the same way.
2. Writes .axiom-work/reports/UPSTREAM-3-dossier.md: for every path left for the Worker, its class, the Axiom
   commits that changed it (why it diverged), recent upstream commits, upstream's fate for files upstream
   deleted, and the regenerate command for generated files.
3. Writes .axiom-work/upstream-3-seams.tsv and .axiom-work/upstream-3-axiom-added.txt (baseline for
   .axiom-work/scripts/upstream3-seam-check.py).

usage: python3 .axiom-work/scripts/upstream3-prep.py [--dry-run]
Every git read is batched (one log walk per side, one cat-file per revision): per-path `git log -- <path>`
over 3,800 upstream commits took minutes on the mounted checkout.
"""
import os
import re
import subprocess
import sys
from collections import defaultdict

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upstream3_seams import CODE, count_touchpoints  # noqa: E402

DRY = '--dry-run' in sys.argv
os.chdir(subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip())
TGT = dict(line.split() for line in open('.axiom-work/upstream-3.target') if line.strip())
B, O, U = TGT['base'], TGT['main'], TGT['upstream']
LABEL_O, LABEL_B, LABEL_U = f'axiom (main {O[:10]})', f'fork point ({B[:10]})', f'upstream ({U[:10]})'
INVENTORY = '.axiom-work/reports/UPSTREAM-3-inventory.md'
DOSSIER = '.axiom-work/reports/UPSTREAM-3-dossier.md'
SEAMS = '.axiom-work/upstream-3-seams.tsv'
AXIOM_ADDED = '.axiom-work/upstream-3-axiom-added.txt'
GENERATED = {
    'src/shared/rpc-contract/rpc-params-catalog.generated.ts': 'pnpm run generate:rpc-params-catalog',
    'src/cli/bundled-skill-guides.ts': 'pnpm run generate:bundled-skill-guides (after skill-guides/** is resolved)',
    'resources/skills/current-manifest.json': 'pnpm run generate:skill-bundle-manifest (after the skill sources are resolved)',
    'src/renderer/src/i18n/en-runtime-required.json': 'pnpm run sync:localization-runtime-catalog (after en.json and the call sites are resolved)',
    'config/scripts/ci-shard-timings.json': "timing data: take upstream's file, then drop entries for test files that do not exist in the merged tree",
}


def git(*args, data=None):
    r = subprocess.run(['git', *args], input=data, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f'git {" ".join(args[:3])} failed: {r.stderr.decode(errors="replace")}')
    return r.stdout


def gits(*args):
    return git(*args).decode('utf-8', 'surrogateescape')


def blobs(rev, paths):
    """{path: bytes or None} through one `git cat-file --batch`."""
    data, out, i = git('cat-file', '--batch', data=''.join(f'{rev}:{p}\n' for p in paths).encode()), {}, 0
    for p in paths:
        nl = data.index(b'\n', i)
        header = data[i:nl].split()
        if header[-1] == b'missing':
            out[p], i = None, nl + 1
            continue
        size = int(header[2])
        out[p], i = data[nl + 1:nl + 1 + size], nl + 1 + size + 1
    return out


def log_map(rng):
    """{path: [(sha, subject, status)]}, newest first, from one walk."""
    out = defaultdict(list)
    for rec in gits('log', '--format=%x1e%H%x1f%s', '--name-status', '--no-renames', rng).split('\x1e')[1:]:
        head, _, body = rec.partition('\n')
        sha, _, subj = head.partition('\x1f')
        for line in body.splitlines():
            if '\t' in line:
                status, path = line.split('\t', 1)
                out[path].append((sha, subj, status))
    return out


def numstats(a, b):
    out = {}
    for line in gits('diff', '--numstat', '--no-renames', a, b).splitlines():
        added, removed, path = line.split('\t', 2)
        out[path] = f'+{added}/-{removed}'
    return out


def norm_brand(s):
    return s.replace('Axiom', 'Orca').replace('axiom', 'orca').replace('AXIOM', 'ORCA')


def axiom_classes(paths):
    """brand-only when every line Axiom changed since the fork differs from the fork point only by product-name swaps."""
    hunks = defaultdict(list)
    cur_path, cur = None, None
    for line in gits('diff', '-U0', '--no-color', '--no-renames', B, O, '--', *paths).splitlines():
        if line.startswith('diff --git '):
            cur_path, cur = None, None
        elif line.startswith('+++ b/'):
            cur_path = line[6:]
        elif line.startswith('--- '):
            continue
        elif line.startswith('@@'):
            cur = ([], [])
            if cur_path is None:  # deleted on main: the path comes from the '--- a/' line we skipped; not needed here
                continue
            hunks[cur_path].append(cur)
        elif cur is not None and line[:1] == '-':
            cur[0].append(line[1:])
        elif cur is not None and line[:1] == '+':
            cur[1].append(line[1:])
    out = {}
    for p in paths:
        hs = hunks.get(p)
        if not hs:
            out[p] = 'no Axiom change at this path'
        elif all(len(r) == len(a) and all(norm_brand(x) == norm_brand(y) for x, y in zip(r, a)) for r, a in hs):
            out[p] = 'brand-only'
        else:
            out[p] = 'substantive'
    return out


MARK = re.compile(rb'^(<{7}|>{7}|\|{7})( |$)', re.M)


def convert_markers(path, status, o, b, t):
    """Returns 'diff3', 'merge (relabelled)' or 'no markers'."""
    with open(path, 'rb') as f:
        cur = f.read()
    if not MARK.search(cur):
        return 'no markers'
    if o is not None and t is not None and (b is not None or status == 'AA'):
        tmp = os.path.expanduser('~/.cache/axiom-upstream3-prep')
        os.makedirs(tmp, exist_ok=True)
        fo, fb, ft = (os.path.join(tmp, n) for n in ('ours', 'base', 'theirs'))
        for name, content in ((fo, o), (fb, b or b''), (ft, t)):
            with open(name, 'wb') as f:
                f.write(content)
        two_way = subprocess.run(['git', 'merge-file', '-p', '-L', 'HEAD', '-L', 'base', '-L', U, fo, fb, ft], capture_output=True).stdout
        if two_way == cur:
            if not DRY:
                three_way = subprocess.run(['git', 'merge-file', '-p', '--diff3', '-L', LABEL_O, '-L', LABEL_B, '-L', LABEL_U, fo, fb, ft], capture_output=True).stdout
                with open(path, 'wb') as f:
                    f.write(three_way)
            return 'diff3'
    relabelled = re.sub(rb'^<{7} HEAD$', b'<<<<<<< ' + LABEL_O.encode(), cur, flags=re.M)
    relabelled = re.sub(rb'^>{7} ' + re.escape(U.encode()) + rb'$', b'>>>>>>> ' + LABEL_U.encode(), relabelled, flags=re.M)
    if not DRY and relabelled != cur:
        with open(path, 'wb') as f:
            f.write(relabelled)
    return 'merge (relabelled)'


def main():
    inv = open(INVENTORY).read().split('## Left for the Worker')[1].split('\n## ')[0]
    paths = re.findall(r'^- (UU|AA|UD|AU|UA) `([^`]+)`', inv, re.M)
    plist = [p for _, p in paths]
    ax_log, up_log = log_map(f'{B}..{O}'), log_map(f'{B}..{U}')
    picked = {rec.split('\x1f')[0].strip() for rec in gits('log', '--format=%H%x1f%b%x1e', f'{B}..{O}').split('\x1e')
              if 'cherry picked from commit' in rec}
    ax_num, up_num = numstats(B, O), numstats(B, U)
    classes = axiom_classes(plist)
    bo, bb, bt = blobs(O, plist), blobs(B, plist), blobs(U, plist)
    up_tree = gits('ls-tree', '-r', '--name-only', U).splitlines()
    moves_cache = {}

    def moves(sha):
        if sha not in moves_cache:
            rows = [line.split('\t') for line in gits('show', '--format=', '--name-status', '-M30%', sha).splitlines()]
            moves_cache[sha] = {r[1]: f'{r[0]} → `{r[2]}`' for r in rows if len(r) == 3 and r[0][:1] in 'RC'}
        return moves_cache[sha]

    rows = []
    for status, path in paths:
        exists = os.path.exists(path)
        if status == 'UD':
            style = 'Axiom copy in tree' if exists else 'missing'
        else:
            style = convert_markers(path, status, bo[path], bb[path], bt[path]) if exists else 'missing'
        rows.append((status, path, 'generated' if path in GENERATED else classes[path], style))

    out = ['# UPSTREAM-3 Worker dossier', '',
           f'Sides: `{LABEL_O}` = Axiom main at merge start, `{LABEL_B}` = merge-base, `{LABEL_U}` = merge target. '
           'Generated by `.axiom-work/scripts/upstream3-prep.py`. Read-only helper for any path: `.axiom-work/scripts/upstream3-sides.sh <path>`.', '',
           'Classes: **brand-only** = every line Axiom changed in this file since the fork differs from the fork point only by product-name swaps '
           "(take upstream's text and redo the same swaps per D32); **substantive** = Axiom changed behaviour here, merge semantically; "
           '**generated** = regenerate, never hand-merge; **no Axiom change at this path** = git paired it through a rename, use the helper on the old path.', '']
    counts = defaultdict(int)
    for status, _, cls, _ in rows:
        counts[(status, cls)] += 1
    out += ['| status | class | files |', '|---|---|---|'] + [f'| {s} | {c} | {n} |' for (s, c), n in sorted(counts.items())] + ['']
    out += [f'Markers: {sum(r[3] == "diff3" for r in rows)} files rewritten with diff3 markers; '
            f'{sum(r[3].startswith("merge") for r in rows)} keep 2-way markers (git paired a rename or chose different hunks) — use the helper for the fork-point text.', '']
    for section, wanted in (('Both changed (UU / AA)', ('UU', 'AA', 'AU', 'UA')), ('Upstream deleted a file Axiom changed (UD)', ('UD',))):
        out += [f'## {section}', '']
        for status, path, cls, style in rows:
            if status not in wanted:
                continue
            out.append(f'### {status} `{path}` — {cls}')
            out.append(f'- Axiom {ax_num.get(path, "—")} · upstream {up_num.get(path, "—")} · markers: {style}')
            if path in GENERATED:
                out.append(f'- regenerate: {GENERATED[path]}')
            ax = ax_log.get(path, [])
            if ax:
                items = [f'`{s[:10]}` {subj}' + (' **(cherry-pick of an upstream commit)**' if s in picked else '') for s, subj, _ in ax[:5]]
                out.append('- Axiom commits: ' + '; '.join(items) + (f'; … {len(ax) - 5} more' if len(ax) > 5 else ''))
            up = up_log.get(path, [])
            if status == 'UD':
                deleted = next(((s, subj) for s, subj, st in up if st == 'D'), None)
                if deleted:
                    moved = moves(deleted[0]).get(path)
                    out.append(f'- upstream: deleted by `{deleted[0][:10]}` {deleted[1]}' + (f'; in that commit it moved (similarity ≥30%): {moved}' if moved else ''))
                    if not moved:
                        stem = os.path.basename(path).split('.')[0]
                        near = [p for p in up_tree if stem and stem in os.path.basename(p)][:4]
                        if near:
                            out.append('- upstream files with a similar name: ' + ', '.join(f'`{p}`' for p in near))
                else:
                    out.append('- upstream: no deleting commit found in fork..upstream')
            elif up:
                out.append('- recent upstream commits: ' + '; '.join(f'`{s[:10]}` {subj}' for s, subj, _ in up[:3]) + (f' (of {len(up)})' if len(up) > 3 else ''))
            out.append('')

    base_files = set(gits('ls-tree', '-r', '--name-only', B).splitlines())
    main_files = gits('ls-tree', '-r', '--name-only', O).splitlines()
    axiom_added = {p for p in main_files if p not in base_files and p not in set(up_tree)}
    owned = [p for p in main_files if p not in axiom_added and CODE.search(p)]
    texts = {p: c.decode('utf-8', 'replace') for p, c in blobs(O, owned).items() if c is not None}
    seam_rows = sorted(count_touchpoints(texts, axiom_added).items())
    out += ['## Axiom touchpoints inside upstream-owned files (checked by `upstream3-seam-check.py`)', '',
            'Counts on main: each name imported from an Axiom-added module, counted in the upstream-owned files that import it; '
            'each *Axiom* / axiomX / AXIOM_* identifier and `axiom.…` string, counted in all upstream-owned code under src/, tests/, config/. '
            'The candidate must keep at least these counts, or the report must say why a touchpoint was removed on purpose.', '']
    out += [f'- {k} `{n}`' + (f' from `{m}`' if m != '-' else '') + f': {c}' for (k, m, n), c in seam_rows]
    summary = f'{len(rows)} paths; diff3 files: {sum(r[3] == "diff3" for r in rows)}; seam rows: {len(seam_rows)}; Axiom-added files: {len(axiom_added)}'
    if DRY:
        print(summary)
        print('\n'.join(out[8:20]))
        print('\n'.join(f'{k} {m} {n} {c}' for (k, m, n), c in seam_rows[:80]))
        return
    with open(DOSSIER, 'w') as f:
        f.write('\n'.join(out) + '\n')
    with open(SEAMS, 'w') as f:
        f.write('# kind\tmodule\tname\tcount_on_main (written by upstream3-prep.py)\n')
        f.writelines(f'{k}\t{m}\t{n}\t{c}\n' for (k, m, n), c in seam_rows)
    with open(AXIOM_ADDED, 'w') as f:
        f.write('\n'.join(sorted(axiom_added)) + '\n')
    print(summary)


main()
