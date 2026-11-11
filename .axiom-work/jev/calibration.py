"""Calibration of Jev's failure attribution against evidence labels (verifier-local; DEF-38, 2026-11-11 revision).

Usage: python3 -I .axiom-work/jev/calibration.py <repo-root>
Reads every labelled failure question in .axiom-work/logs/jev-*.json, maps it to its failing file through the
attempt's verify log, and compares Jev with the rules baseline the 2026-11-11 gate names:
  rules baseline  known-environmental list -> environment; otherwise "the candidate changed the failing test or
                  its source" -> candidate; otherwise environment.
The gate counts only failures off the known list, and each test once per task.
"""
import collections
import glob
import json
import os
import re
import subprocess
import sys

root = sys.argv[1]
logs = os.path.join(root, '.axiom-work/logs')
known = set()
for line in open(os.path.join(root, '.axiom-work/jev/known-environmental.txt'), encoding='utf-8'):
    entry = line.split('#')[0].strip()
    if entry:
        known.add(entry)
ansi = re.compile(r'\x1b\[[0-9;]*m')


def latest(prefix, suffix):
    names = sorted(n for n in os.listdir(logs) if n.startswith(prefix) and n.endswith(suffix))
    return os.path.join(logs, names[-1]) if names else None


def failing_files(task, seq):
    path = latest('verify-%s-%s-' % (task, seq), '.log')
    seen = []
    if path:
        text = ansi.sub('', open(path, encoding='utf-8', errors='replace').read())
        for match in re.finditer(r'^ FAIL {2}(\S+)(?: > (.*))?$', text, re.M):
            key = (match.group(1), match.group(2) or '')
            if key not in seen:
                seen.append(key)
    return [f for f, _ in seen[:10]]


def changed_files(task, seq):
    path = latest('attempt-%s-%s-' % (task, seq), '.summary')
    if not path:
        return set()
    match = re.search(r'^candidate: ([0-9a-f]+) \(base ([0-9a-f]+)\)', open(path, encoding='utf-8', errors='replace').read(), re.M)
    if not match:
        return set()
    out = subprocess.run(['git', 'diff', '--name-only', match.group(2), match.group(1)], cwd=root, capture_output=True, text=True, timeout=30)
    return set(out.stdout.split())


items = []
for path in sorted(glob.glob(os.path.join(logs, 'jev-*.json'))):
    record = json.load(open(path, encoding='utf-8'))
    verdict = record.get('human_verdict')
    if not verdict:
        continue
    questions = sorted((k for k in record['request']['questions'] if k.startswith('failure_')), key=lambda k: int(k.split('_')[1]))
    if not questions:
        continue
    name = os.path.basename(path)[len('jev-'):-len('.json')]
    stem = name.rsplit('-', 1)[0]
    task, seq = stem.rsplit('-', 1)
    files = failing_files(task, seq)
    changed = changed_files(task, seq)
    labels = verdict.get('failure_labels') or ['candidate' if c else 'environment' for c in verdict['failures_caused_by_candidate']]
    for index, question in enumerate(questions):
        p = record['response']['answers'].get(question, {}).get('noul')
        failing = files[index] if index < len(files) else '?'
        source = re.sub(r'\.test\.(ts|mjs)$', r'.\1', failing)
        items.append({
            'task': task, 'seq': seq, 'file': failing, 'p': p, 'label': labels[index],
            'known': failing in known, 'changed': failing in changed or source in changed,
        })


def truth(item):
    return item['label'] == 'candidate'


def rules(item):
    return (not item['known']) and item['changed']


def report(title, rows):
    if not rows:
        print(title, 'none')
        return
    jev_right = sum((r['p'] is not None and (r['p'] >= 0.5) == truth(r)) for r in rows)
    rule_right = sum(rules(r) == truth(r) for r in rows)
    candidates = sum(truth(r) for r in rows)
    print('%s: n=%d (candidate %d, environment or flaky %d); Jev right %d, rules baseline right %d'
          % (title, len(rows), candidates, len(rows) - candidates, jev_right, rule_right))
    buckets = collections.OrderedDict((('p<=0.10', []), ('0.10<p<0.50', []), ('0.50<=p<0.90', []), ('p>=0.90', [])))
    for r in rows:
        p = r['p']
        key = 'p<=0.10' if p <= 0.10 else '0.10<p<0.50' if p < 0.5 else '0.50<=p<0.90' if p < 0.9 else 'p>=0.90'
        buckets[key].append(r)
    print('   ' + '; '.join('%s: %d, of which candidate %d' % (k, len(v), sum(truth(x) for x in v)) for k, v in buckets.items()))
    wrong = [r for r in rows if r['p'] is not None and (r['p'] >= 0.5) != truth(r)]
    for r in wrong:
        print('   Jev wrong: %s-%s %s p=%.2f label=%s' % (r['task'], r['seq'], os.path.basename(r['file']), r['p'], r['label']))


print('labelled failure questions:', len(items), '; on the known list:', sum(i['known'] for i in items))
report('all', items)
off = [i for i in items if not i['known']]
report('off the known list', off)
dedup = {}
for item in off:
    dedup.setdefault((item['task'], item['file']), item)
report('off the list, each test once per task', list(dedup.values()))
