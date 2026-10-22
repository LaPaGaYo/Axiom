#!/usr/bin/env python3
"""UPSTREAM-3 (D72) mechanical conflict resolution for the full merge of upstream/main.

Modes:
  sim   --base REF --ours REF --theirs REF --out DIR   compute the mechanical merges from refs into DIR (read-only)
  apply                                               resolve the in-progress merge in this worktree (stages :1/:2/:3)

Mechanical rules (everything else is left for the Worker, see the UPSTREAM-3 brief):
  * locale JSON (src/renderer/src/i18n/locales/*.json): per-key 3-way merge, upstream key order, Axiom-only keys kept
    next to their Axiom neighbours; strings taken from upstream get the M0-05b-1 brand rule (capital "Orca" -> "Axiom");
    both-sides-changed keys and lowercase "orca" in upstream strings are listed for review.
  * package.json: per-key 3-way merge; both-sides-changed scripts.lint = upstream chain with Axiom's
    check:vendor-egress-ratchet inserted after check:runtime-electron-ratchet.
  * pnpm-workspace.yaml: upstream text without an electron@43.7.0 release-age exemption.
  * pnpm-lock.yaml: upstream version (the start script regenerates it with pnpm install).
  * AGENTS.md, README.md: Axiom version (upstream AGENTS.md changes are written to the inventory for review).
  * paths Axiom deleted (D33 cloud/, M0 removals) stay deleted; new upstream files under cloud/ are removed.
"""
import json, os, re, subprocess, sys, collections, difflib

MISSING = object()
LOCALE_RE = re.compile(r'^src/renderer/src/i18n/locales/[a-z]{2}\.json$')
KNOWN_SWAPS = {('Orca', 'Axiom'), ('orca ', 'axiom '), ('orca://', 'axiom://'), ('orca-ide', 'axiom'), ('`orca', '`axiom')}

def git(*args, check=True):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=check).stdout

def blob(spec):
    r = subprocess.run(['git', 'show', spec], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def brand(s):
    return s.replace('Orca', 'Axiom') if isinstance(s, str) else s

def swaps(a, b):
    out = set()
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != 'equal':
            out.add((a[i1:i2], b[j1:j2]))
    return out

def transfer(base, ours, theirs):
    """If ours differs from base only by known brand swaps, apply the same swaps to theirs."""
    if not all(isinstance(x, str) for x in (base, ours, theirs)):
        return None
    s = swaps(base, ours)
    if not s:
        return None
    norm = set()
    for a, b in s:
        if (a, b) in KNOWN_SWAPS:
            norm.add((a, b))
        elif a.endswith('Orca') and b.endswith('Axiom') and a[:-4] == b[:-5]:
            norm.add(('Orca', 'Axiom'))
        elif 'orca' in a and a.replace('orca', 'axiom') == b:
            norm.add(('orca', 'axiom'))
        else:
            return None
    out = theirs
    for a, b in sorted(norm, key=lambda x: -len(x[0])):
        out = out.replace(a, b)
    return out

def order(od, td):
    keys = list(td.keys())
    olist = list(od.keys())
    present = set(keys)
    for i, k in enumerate(olist):
        if k in present:
            continue
        prev = next((olist[j] for j in range(i - 1, -1, -1) if olist[j] in present), None)
        keys.insert(keys.index(prev) + 1 if prev is not None else 0, k)
        present.add(k)
    return keys

class Ctx:
    def __init__(self, kind):
        self.kind = kind
        self.rec = collections.defaultdict(list)
    def from_theirs(self, v, path):
        if self.kind == 'locale' and isinstance(v, str):
            if re.search(r'\borca\b', v):
                self.rec['upstream string with lowercase orca (review: CLI names become axiom, orca.yaml stays)'].append('.'.join(path))
            if 'Orca' in v:
                self.rec['branded upstream strings (Orca -> Axiom)'].append('.'.join(path))
            return brand(v)
        return v
    def take_theirs_tree(self, t, path):
        if isinstance(t, dict):
            return {k: self.take_theirs_tree(v, path + (k,)) for k, v in t.items()}
        return self.from_theirs(t, path)
    def both(self, path, b, o, t):
        if self.kind == 'package' and path == ('scripts', 'lint'):
            step = 'pnpm run check:vendor-egress-ratchet'
            anchor = 'pnpm run check:runtime-electron-ratchet'
            if step in t:
                return t
            if anchor in t:
                self.rec['package.json scripts.lint: ratchet inserted after runtime-electron ratchet'].append('scripts.lint')
                return t.replace(anchor, anchor + ' && ' + step, 1)
            self.rec['package.json scripts.lint: ratchet appended (anchor missing)'].append('scripts.lint')
            return t + ' && ' + step
        tr = transfer(b if b is not MISSING else '', o, t) if o is not MISSING and t is not MISSING else None
        if tr is not None:
            self.rec['both changed; Axiom brand swap re-applied to upstream value'].append('.'.join(path))
            return tr
        self.rec['both changed differently; upstream value taken (review)'].append('.'.join(path))
        return self.from_theirs(t, path) if t is not MISSING else MISSING

def merge(b, o, t, path, ctx):
    dicts = [x for x in (b, o, t) if x is not MISSING]
    if dicts and all(isinstance(x, dict) for x in dicts):
        if o is MISSING and t is MISSING:
            return MISSING
        if o is MISSING:
            if b is MISSING:
                return ctx.take_theirs_tree(t, path)
            if t != b:
                ctx.rec['Axiom deleted, upstream changed; kept deleted'].append('.'.join(path))
            return MISSING
        if t is MISSING:
            if b is MISSING:
                return o
            if o != b:
                ctx.rec['upstream deleted, Axiom changed; deletion taken'].append('.'.join(path))
            return MISSING
        bd = b if isinstance(b, dict) else {}
        out = {}
        for k in order(o, t):
            v = merge(bd.get(k, MISSING), o.get(k, MISSING), t.get(k, MISSING), path + (k,), ctx)
            if v is not MISSING:
                out[k] = v
        return out
    if o == t:
        return o
    if o == b:
        return MISSING if t is MISSING else ctx.from_theirs(t, path)
    if t == b:
        return o
    if t is MISSING:
        brand_only = isinstance(b, str) and isinstance(o, str) and transfer(b, o, b) is not None
        ctx.rec['upstream deleted a key Axiom only rebranded; deletion taken' if brand_only else 'upstream deleted a key Axiom changed; deletion taken (review)'].append('.'.join(path))
        return MISSING
    if o is MISSING:
        ctx.rec['Axiom deleted a key upstream changed; kept deleted (review)'].append('.'.join(path))
        return MISSING
    return ctx.both(path, b, o, t)

def merge_json(btxt, otxt, ttxt, kind):
    ctx = Ctx(kind)
    b = json.loads(btxt) if btxt else {}
    o = json.loads(otxt) if otxt else {}
    t = json.loads(ttxt) if ttxt else {}
    out = merge(b, o, t, (), ctx)
    return json.dumps(out, indent=2, ensure_ascii=False) + '\n', ctx.rec

def workspace_yaml(ttxt):
    lines = [l for l in ttxt.splitlines(keepends=True) if not re.match(r"^\s*-\s*'?electron@43\.7\.0'?\s*$", l)]
    return ''.join(lines)

def report_section(lines, title, items, limit=400):
    lines.append(f'\n### {title} ({len(items)})\n')
    for it in items[:limit]:
        lines.append(f'- `{it}`')
    if len(items) > limit:
        lines.append(f'- … {len(items) - limit} more')

def sim(argv):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--base'); ap.add_argument('--ours'); ap.add_argument('--theirs'); ap.add_argument('--out')
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    paths = [f'src/renderer/src/i18n/locales/{l}.json' for l in ('en', 'es', 'fr', 'ja', 'ko', 'zh')] + ['package.json']
    for p in paths:
        kind = 'package' if p == 'package.json' else 'locale'
        txt, rec = merge_json(blob(f'{a.base}:{p}'), blob(f'{a.ours}:{p}'), blob(f'{a.theirs}:{p}'), kind)
        dst = os.path.join(a.out, p.replace('/', '__'))
        open(dst, 'w', encoding='utf-8').write(txt)
        print(p, {k: len(v) for k, v in rec.items()})
    open(os.path.join(a.out, 'pnpm-workspace.yaml'), 'w').write(workspace_yaml(blob(f'{a.theirs}:pnpm-workspace.yaml')))

def status_entries():
    raw = subprocess.run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=no'], capture_output=True, check=True).stdout
    parts = raw.split(b'\0')
    out = []
    i = 0
    while i < len(parts):
        e = parts[i]
        if not e:
            i += 1; continue
        code, path = e[:2].decode(), e[3:].decode('utf-8', 'surrogateescape')
        if code[0] in 'RC':
            i += 1  # skip the rename source
        out.append((code, path))
        i += 1
    return out

def count_markers(path):
    try:
        with open(path, 'rb') as f:
            return sum(1 for line in f if line.startswith(b'<<<<<<< '))
    except (FileNotFoundError, IsADirectoryError):
        return 0

def apply(argv):
    os.makedirs('.axiom-work/reports', exist_ok=True)
    entries = status_entries()
    unmerged = [(c, p) for c, p in entries if c in ('UU', 'AA', 'DU', 'UD', 'AU', 'UA', 'DD')]
    initial = collections.Counter(c for c, _ in unmerged)
    done = collections.defaultdict(list)
    review = collections.defaultdict(list)
    def add(p):
        git('add', '--', p)
    def rm(p):
        git('rm', '-q', '--cached', '--ignore-unmatch', '--', p)
        if os.path.lexists(p):
            os.remove(p)
    for code, p in unmerged:
        if code in ('DU', 'DD'):
            rm(p); done['kept deleted (Axiom removed it)'].append(p); continue
        if LOCALE_RE.match(p) and code == 'UU':
            txt, rec = merge_json(blob(f':1:{p}'), blob(f':2:{p}'), blob(f':3:{p}'), 'locale')
            open(p, 'w', encoding='utf-8').write(txt); add(p); done['locale JSON 3-way merge'].append(p)
            for k, v in rec.items():
                review[f'{p}: {k}'].extend(v)
            continue
        if p == 'package.json' and code == 'UU':
            txt, rec = merge_json(blob(f':1:{p}'), blob(f':2:{p}'), blob(f':3:{p}'), 'package')
            open(p, 'w', encoding='utf-8').write(txt); add(p); done['package.json 3-way merge'].append(p)
            for k, v in rec.items():
                review[f'package.json: {k}'].extend(v)
            continue
        if p == 'pnpm-workspace.yaml' and code == 'UU':
            open(p, 'w', encoding='utf-8').write(workspace_yaml(blob(f':3:{p}'))); add(p); done['pnpm-workspace.yaml = upstream minus electron@43.7.0 exemption'].append(p); continue
        if p == 'pnpm-lock.yaml':
            open(p, 'w', encoding='utf-8').write(blob(f':3:{p}')); add(p); done['pnpm-lock.yaml = upstream (regenerated by pnpm install)'].append(p); continue
        if p in ('AGENTS.md', 'README.md') and code == 'UU':
            open(p, 'w', encoding='utf-8').write(blob(f':2:{p}')); add(p); done['Axiom version kept'].append(p); continue
    # New upstream files under cloud/ (D33: the cloud tree stays deleted).
    cloud = [l for l in git('ls-files', '--', 'cloud').splitlines() if l]
    for p in cloud:
        rm(p)
    if cloud:
        done['new upstream cloud/ files removed (D33)'].extend(cloud)
    # Inventory of what is left for the Worker.
    entries = status_entries()
    left = [(c, p) for c, p in entries if c in ('UU', 'AA', 'DU', 'UD', 'AU', 'UA', 'DD')]
    groups = collections.defaultdict(list)
    for c, p in left:
        parts = p.split('/')
        key = '/'.join(parts[:3]) if parts[0] == 'src' and len(parts) > 2 else ('/'.join(parts[:2]) if len(parts) > 1 else parts[0])
        groups[key].append((c, p, count_markers(p)))
    up = git('rev-parse', 'MERGE_HEAD').strip()
    head = git('rev-parse', 'HEAD').strip()
    base = git('merge-base', 'HEAD', 'MERGE_HEAD').strip()
    L = ['# UPSTREAM-3 conflict inventory', '',
         f'- upstream (MERGE_HEAD): `{up}`', f'- Axiom main (HEAD at merge start): `{head}`', f'- merge-base: `{base}`',
         f'- unmerged paths when git stopped: {sum(initial.values())} ({", ".join(f"{k} {v}" for k, v in sorted(initial.items()))})',
         f'- left for the Worker after mechanical resolution: {len(left)} ({", ".join(f"{k} {v}" for k, v in sorted(collections.Counter(c for c, _ in left).items()))})',
         '', 'Status codes: UU = both modified (conflict markers), AA = both added, UD = upstream deleted or moved a file Axiom changed (the Axiom copy is in the tree), AU/UA = added by one side and modified by the other.',
         '', '## Mechanical resolutions (done by the start script)']
    for k, v in done.items():
        report_section(L, k, v, limit=60)
    L.append('\n## Review list from the mechanical merges')
    for k, v in review.items():
        report_section(L, k, v, limit=80)
    L.append('\n## Left for the Worker, by area (status, path, conflict-marker hunks)')
    for key in sorted(groups, key=lambda k: (-len(groups[k]), k)):
        L.append(f'\n### {key} ({len(groups[key])})\n')
        for c, p, n in sorted(groups[key], key=lambda x: x[1]):
            L.append(f'- {c} `{p}`' + (f' — {n} hunks' if n else ''))
    agents = git('diff', base, up, '--', 'AGENTS.md', check=False)
    L += ['\n## Upstream AGENTS.md changes since the fork (Axiom kept its own AGENTS.md; review for platform rules worth adopting)\n', '```diff', agents.rstrip(), '```', '']
    open('.axiom-work/reports/UPSTREAM-3-inventory.md', 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print(f'unmerged at stop: {sum(initial.values())}; left for Worker: {len(left)}')
    for k, v in done.items():
        print(f'  done: {k}: {len(v)}')

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'sim':
        sim(sys.argv[2:])
    elif mode == 'apply':
        apply(sys.argv[2:])
    else:
        print(__doc__); sys.exit(2)
