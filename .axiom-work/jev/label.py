"""Write evidence-based labels into .axiom-work/logs/jev-*.json (verifier-local; DEF-38, 2026-11-11 revision).

Usage: python3 -I .axiom-work/jev/label.py <repo-root> [--apply]
Without --apply it prints what it would write. A record that already has a human_verdict is never overwritten.

Label rules (evidence, not opinion):
  environment  the failing file is on .axiom-work/jev/known-environmental.txt (it fails identically on main)
  flaky        the file is not changed by the candidate and fails across several unrelated candidates
  candidate    the candidate changed the failing test or its source file, or the verification record shows the
               failure went away only through a change the candidate needed (fixture, expectation, exclusion)
"""
import datetime
import glob
import json
import os
import sys

root = sys.argv[1]
apply = '--apply' in sys.argv[2:]
logs = os.path.join(root, '.axiom-work/logs')
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

KNOWN = 'known_environmental_list'
RECURRING = 'recurring_across_unrelated_candidates'
CHANGED = 'candidate_changed_test_or_source'

# (task, seq) -> one (label, evidence) per failure question, in question order.
BACKFILL = {
    ('M0-05b-2', '3'): [('environment', KNOWN)] * 10,
    ('M1-08', '1'): [('candidate', 'verification_record:M1-08-2: the test mock lacked getOrchestrationDb, which the candidate now calls; fixed by the fixture patch')] * 2,
    ('M1-09', '1'): [('flaky', RECURRING)],
    ('M1-09', '2'): [('flaky', RECURRING)],
    ('M2-00', '1'): [('environment', KNOWN)] * 2,
    ('M2-01', '1'): [('environment', KNOWN)],
    ('M2-02', '1'): [('candidate', 'verification_record:M2-02: namespace-rpc.test.ts updated by the task for its new RPC methods')]
    + [('candidate', CHANGED)] * 4,
    ('M2-02', '2'): [('candidate', 'stacked attempt: the failing test is the task’s own test, not on main')],
    ('M2-04', '1'): [('candidate', 'verification_record:M2-04-2: routing-object expectations changed by the candidate')] * 2,
    ('M2-05', '1'): [('candidate', CHANGED)] * 3,
    ('M2-05', '2'): [('candidate', 'verification_record:M2-05: the new CLI command needed a parity exclusion')] * 2,
    ('M2-06a', '1'): [
        ('candidate', 'candidate changed src/cli/specs/axiom-attempt.ts; the spec search test fails in no other attempt'),
        ('candidate', 'verification_record:M2-06a-3: the fixture needed getDispatchContextById, which the candidate added'),
    ],
    ('M2-07', '1'): [('candidate', CHANGED)] * 3,
    ('M2-08', '1'): [('environment', KNOWN), ('candidate', CHANGED)],
    ('M2-08', '2'): [('environment', KNOWN)],
    ('M2-09', '1'): [('candidate', CHANGED)] * 2,
    ('UPSTREAM-1', '1'): [('flaky', RECURRING)],
    ('UPSTREAM-2', '1'): [('flaky', RECURRING)],
    ('UPSTREAM-2', '2'): [('flaky', RECURRING)],
}

FULL = {
    ('M3-06-3-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'stall modes as briefed: append-only settings table without a schema version, desktop-only update with a '
        'Mission audit, effective mode read per pass, notify once per Attempt and mode and state-free, one shared stop sequence '
        'for timeout and stalled with the timeout transaction name unchanged; unit red check fails on main recovery files at '
        'the assertions; new e2e green on its first host run; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': ['reconciliation, evidence table and upgrade proposals (M3-06-3-2b)'],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-3', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'supervision step as briefed: the runtime stop unchanged apart from the timeout reason and the audit in the '
        'same transaction; stall observation once and state-free, sampled only with an events file; one cadence audit per '
        'Attempt; bounded threshold query once per pass; unit and e2e red checks fail on main; changed e2e green on its first '
        'host run; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': ['the threshold query scans audit_events by event without an index; add one with the M3-06-3-2 migration if the table grows'],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-2c', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'Codex in-place continuation as briefed: twelve ordered rules with lazily read evidence, a ref-and-index-only '
        'takeover to HEAD = snapshot, resume before the final dash, a refused resume settled refunded and due at once; unit and '
        'e2e red checks fail on main for the behaviour; new e2e green on its first host run; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': ['attempt-launcher.ts at 290 of 300 counted lines: the next branch there must move code out first'],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-2b-3', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'restart-lost-daemon ending preserved and settled as an interruption exactly as briefed; red-first unit tests '
        '(24, the kernel verdict from the real reconcileMissingWorkerTerminal); new e2e green on its first host run; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': ['attempt-reconciliation.ts at 286 of 300 counted lines: the next branch there must move code out first'],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-08d-HYG', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'four kernel tests rewritten to D83 ruling 1 with their purpose kept; causes established before editing; '
        'one verifier correction put two old type assertions back on unchanged lines for the changed-code gate',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('UPSTREAM-4', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'four semantic ports match upstream; scope clean; two control tests pass on main by design (the brief asked for them)',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
}


def task_seq(path):
    name = os.path.basename(path)[len('jev-'):-len('.json')]
    stem, _ts = name.rsplit('-', 1)
    task, seq = stem.rsplit('-', 1)
    return task, seq


written = 0
for path in sorted(glob.glob(os.path.join(logs, 'jev-*.json'))):
    with open(path, encoding='utf-8') as handle:
        record = json.load(handle)
    if record.get('human_verdict') is not None:
        continue
    key = task_seq(path)
    questions = sorted(
        (k for k in record['request']['questions'] if k.startswith('failure_')),
        key=lambda k: int(k.split('_')[1]),
    )
    verdict = None
    if key in FULL:
        verdict = dict(FULL[key])
        assert not questions, (path, 'expected no failure questions')
    elif key in BACKFILL:
        labels = BACKFILL[key]
        assert len(labels) == len(questions), (path, len(labels), len(questions))
        verdict = {
            'scope': 'failures_only_backfill',
            'failures_caused_by_candidate': [label == 'candidate' for label, _ in labels],
            'failure_labels': [label for label, _ in labels],
            'label_evidence': [evidence for _, evidence in labels],
        }
    if verdict is None:
        continue
    verdict['by'] = 'claude-verifier'
    verdict['at'] = now
    written += 1
    print(('write ' if apply else 'would write ') + os.path.basename(path), json.dumps(verdict.get('failure_labels', verdict.get('verdict'))))
    if apply:
        record['human_verdict'] = verdict
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as handle:
            json.dump(record, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        os.replace(tmp, path)
print(('wrote ' if apply else 'would write ') + str(written) + ' records')
