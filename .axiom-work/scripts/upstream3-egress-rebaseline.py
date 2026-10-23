#!/usr/bin/env python3
"""UPSTREAM-3 one-time vendor-egress re-baseline at the new upstream base (D74 option B, Henry 2026-10-22).

The ratchet's baseline was initialized at the fork point and may only shrink. D74 re-enters, once, the vendor
references that upstream's merged code brings in *test samples and provenance* — files matching the bucket below,
plus lines that only name an npm package under the `@stablyai/` scope — the same way M0-01 initialized the
baseline at the fork point. Every other pair must already be gone (shipped code is cleaned by the M0 rules);
the script refuses to write while one remains. Stale entries shrink to the current count as usual.

usage: python3 .axiom-work/scripts/upstream3-egress-rebaseline.py [--write]
"""
import json
import re
import subprocess
import sys

BASELINE = 'config/vendor-egress-baseline.txt'
# Why config/patches: upstream's third-party patches cite upstream issues in the code they add; editing a patch changes
# its pnpm patch hash and with it the lockfile (attempt 2 found this the hard way), so the citation stays as provenance.
BUCKET = re.compile(r'\.test\.|\.spec\.|test-fixture|test-support|__fixtures__|/fixtures/|__mocks__|^config/reliability-gates\.jsonc$|^config/scripts/ci-shard-timings\.md$|^config/patches/')
PACKAGE_LINE = re.compile(r'@stablyai/[a-z0-9._-]+')

out = subprocess.run(['node', 'config/scripts/check-vendor-egress-ratchet.mjs', '--json'], capture_output=True, text=True)
start = out.stdout.index('[')
current = json.JSONDecoder().raw_decode(out.stdout[start:])[0]
baseline = {}
for line in open(BASELINE, encoding='utf-8').read().splitlines():
    if line.strip() and not line.startswith('#'):
        file, needle, count = line.rsplit(':', 2)
        baseline[(file, needle)] = int(count)

entered, refused, shrunk = [], [], 0
result = {}
for item in current:
    key = (item['file'], item['needle'])
    before = baseline.get(key, 0)
    count = item['count']
    if count <= before:
        result[key] = count
        shrunk += count < before
        continue
    lines = [l['text'] for l in item.get('lines', [])]
    # Matching is case-insensitive in the ratchet; a line qualifies when the needle only occurs inside `@stablyai/<pkg>`.
    package_only = item['needle'] == 'stablyai' and bool(lines) and all(
        'stablyai' not in PACKAGE_LINE.sub('', t.lower()) for t in lines
    )
    if BUCKET.search(item['file']) or package_only:
        result[key] = count
        entered.append(f'{item["file"]}:{item["needle"]}: {before} -> {count}')
    else:
        refused.append(f'{item["file"]}:{item["needle"]}: {before} -> {count}')
shrunk += sum(1 for key in baseline if key not in result)
print(f'current pairs {len(current)}; re-entered {len(entered)}; still to clean {len(refused)}; shrunk or dropped {shrunk}')
for r in refused:
    print('  STILL IN SHIPPED CODE:', r)
if '--write' in sys.argv:
    if refused:
        sys.exit('refusing to write: shipped-code pairs remain (D74 re-enters only test samples and provenance)')
    with open(BASELINE, 'w', encoding='utf-8') as f:
        f.write(''.join(f'{file}:{needle}:{count}\n' for (file, needle), count in sorted(result.items())))
    with open('.axiom-work/reports/UPSTREAM-3-egress-rebaseline.md', 'w', encoding='utf-8') as f:
        f.write('# UPSTREAM-3 vendor-egress re-baseline (D74)\n\n'
                f'Baseline {len(baseline)} pairs → {len(result)} pairs; {len(entered)} re-entered (upstream test samples, fixtures, provenance, `@stablyai/` package names); {shrunk} shrunk or dropped.\n\n'
                + '\n'.join(f'- {e}' for e in entered) + '\n')
    print('written')
