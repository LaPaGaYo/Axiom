#!/usr/bin/env python3
"""UPSTREAM-3 (D72, D32): give the new upstream `pt.json` catalog the treatment the start script gave the six
existing catalogs, and clear vendor values the 3-way merge let into any catalog.

- every catalog: a value with a vendor needle (orca.dev, stablyai, posthog, com.stably…) that en.json's value for
  the same key does not have takes en.json's value (English fallback is accepted by D32);
- pt.json: keys the merged en.json no longer has are dropped (Axiom removed them from every catalog, or upstream's
  pt.json kept them stale); every value goes Orca -> Axiom, as `brand()` in upstream3-resolve.py did;
- prints the values that still contain a lowercase `orca` word, for the review the inventory lists for the
  other catalogs (CLI names become `axiom`; `orca.yaml`, `~/.orca`, skill ids stay).

usage: python3 .axiom-work/scripts/upstream3-catalogs.py [--write]
"""
import json
import re
import sys

DIR = 'src/renderer/src/i18n/locales/'
LOCALES = ('es', 'fr', 'ja', 'ko', 'zh', 'pt')
NEEDLE = re.compile(r'onorca\.dev|orca\.dev|stablyai|com\.stably|posthog', re.I)
WRITE = '--write' in sys.argv


def load(loc):
    with open(f'{DIR}{loc}.json', encoding='utf-8') as f:
        return json.load(f)


def walk(node, ref, fn, path=()):
    """Rebuilds `node` in its own key order; fn(path, value, ref_value) returns the new value or a DROP marker."""
    out = {}
    for key, value in node.items():
        sub_ref = ref.get(key) if isinstance(ref, dict) else None
        if isinstance(value, dict):
            child = walk(value, sub_ref if isinstance(sub_ref, dict) else None, fn, path + (key,))
            # Why: keep objects that were empty to begin with; drop only those emptied by dropped keys.
            if child or not value:
                out[key] = child
            continue
        new = fn(path + (key,), value, sub_ref)
        if new is not DROP:
            out[key] = new
    return out


DROP = object()
en = load('en')
report = []
for loc in LOCALES:
    catalog = load(loc)
    changes = {'vendor': 0, 'dropped': 0, 'branded': 0}

    def fix(path, value, en_value, loc=loc, changes=changes):
        if loc == 'pt' and en_value is None:
            changes['dropped'] += 1
            return DROP
        if isinstance(value, str) and NEEDLE.search(value) and isinstance(en_value, str) and not NEEDLE.search(en_value):
            changes['vendor'] += 1
            value = en_value
        if loc == 'pt' and isinstance(value, str) and 'Orca' in value:
            changes['branded'] += 1
            value = value.replace('Orca', 'Axiom')
        if loc == 'pt' and isinstance(value, str) and re.search(r'\borca\b', value):
            report.append(f'- `{".".join(path)}`: {value[:160]!r}')
        return value

    fixed = walk(catalog, en, fix)
    print(loc, changes)
    if WRITE and fixed != catalog:
        with open(f'{DIR}{loc}.json', 'w', encoding='utf-8') as f:
            f.write(json.dumps(fixed, ensure_ascii=False, indent=2) + '\n')
print(f'pt.json values with a lowercase `orca` word: {len(report)}')
if WRITE:
    with open('.axiom-work/reports/UPSTREAM-3-pt-orca-review.md', 'w', encoding='utf-8') as f:
        f.write('# pt.json values with a lowercase `orca` word (review like the inventory lists)\n\n' + '\n'.join(report) + '\n')
