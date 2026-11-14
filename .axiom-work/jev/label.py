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
    ('M3-09-2b-4', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the Task page offers one quiet Cancel Task on every unfinished Task as briefed: shown from '
        'the shared lifecycle function, the pending items and the handler only, outside the Task actions '
        'region, never next to the region cancel, gone on a finished Task, present when the pending read '
        'fails; same form with an optional item and the sentence without a number, same confirmation; focus '
        'in, back and to the Task detail as briefed; the task RPC handler awaits the reconciliation of the '
        'Mission after the commit, answers the canceled Task even when that throws and reconciles nothing '
        'after a refusal; titles 1-8 fail at their assertions on the three main files with no load or render '
        'error; new e2e spec green on its first host run with the Attempt stopped on the page without a '
        'refresh, every Mission spec green, e2e red run fails as it must; two screenshots read; no verifier '
        'change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the quiet control and the region each derive whether a pending item lists the cancellation: keep them in step',
            'audit reason of an Attempt stopped by a Task cancellation is still mission_canceled (DEF-21, M3-10)',
            'copy and alignment pass: the ghost button label sits right of the lines around it (M3-10)',
            'later sidecars: say whether test-support files count as non-test files of the missions folder',
            'cancel does not cascade (DEF-21 item 1)',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-3a', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'Mission Home lists the pending view as briefed: one read per refresh shared with the Task '
        'page, rows in the view order with kind, Task link, reason verbatim, gloss and budget reading for the '
        'three wait kinds only, blocks line, action names as text, count equal to rows, a note when the read '
        'fails; the Task table gains a text-only Waiting on column; mutate reports its outcome and the adjust '
        'form closes on success with focus returned once the page is idle; catalogs compared key by key; '
        'titles 1-10 fail at their assertions on the seven main files with no load or render error; new e2e '
        'spec (two flows through the page) green on its first host run, exit m1 still reads the same after a '
        'restart, every Mission spec green, e2e red run fails as it must; two screenshots read; no verifier '
        'change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'cancel control on any unfinished Task (Henry chose B): M3-09-2b-4',
            'settle since for no_eligible_provider in the read model before Mission Home shows times: M3-09-3b',
            'move readMission out of the page controller (283 of 300 lines) before adding the timed refresh',
            'remove the pendingMessages prop and its read once no red check needs main MissionHome',
            'copy pass: zh term for supervision, ASCII comma between action names, the plan sentence under a pending row',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-2b-3', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'Task actions on the Task page as briefed: adjust and cancel are offered only when a pending '
        'item lists them, in item order; the adjust form shows scope and limits from an isolated Task read, one '
        'guidance line by reason, prefilled paths, sends only what was typed and predicts no refusal; cancel '
        'states its cost, takes a rationale and calls only after the confirmation dialog; cancelTask refuses a '
        'secret-looking rationale before its transaction; catalogs compared key by key; titles 1-10 and 14 fail '
        'at their assertions on main files with no load error and 11-13 pass; new e2e spec (three flows through '
        'the page) and every Mission spec green on the host, e2e red run fails as it must; three screenshots '
        'read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'brief gap: a successful adjustment on a Task under review leaves the form open with no feedback; close it on success in the next renderer part',
            'cancel control for a Task that needs nobody: product decision open with Henry',
            'acceptance criteria editor with the plan card: M3-09-4',
            'two controller tests write the contract version as a literal',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-2b-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'review actions on the Task page as briefed: the region offers resolve and rerun only when a '
        'pending item of the Task lists the call, the disposition control comes only from the shared rule, both '
        'actions go through the controller mutate with a receipt id and a re-read and nothing optimistic, a refusal '
        'keeps the form; stored disposition shown with a gloss; three items carried from M3-09-2 done; catalogs '
        'compared key by key; titles 2-14 fail at their assertions on main display files with no load error and '
        '1, 15-17 pass; new e2e spec (four flows through the page) and every Mission spec green on the host, e2e '
        'red run fails as it must; three screenshots read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'adjust and cancel on the Task page: M3-09-2b-3',
            'copy pass in M3-10: 1 entries plural, the fixed label without a control, zh wording of resolve',
            'the two result shapes of resolve and rerun live in the client: move to the contract if a second caller appears',
            'tool versions line reads git git version: display nit left from M3-09-2',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-2b-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'typed disposition on axiom.verification.resolve as briefed: one shared pure rule over the '
        'recorded reason, enforced before the first write inside the existing transaction, stored with the '
        'resolution and its audit, tolerant reader keeps a resolution with an unknown value; resolution code '
        'gains 14 lines and loses none; two existing tests gain one line each; titles 2-6 and 8 fail at their '
        'assertions on main resolution code with no load error and 1, 7, 9, 10 pass; new e2e and every Mission '
        'spec green on the host except one snapshot race in an unchanged spec (intermittent, not the candidate), e2e '
        'red run fails as it must; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the Task page asks for and shows the disposition in M3-09-2b-2',
            'the CLI resolve command cannot succeed (desktop_only): hygiene in M3-10',
            'mission-human-review deterministic final: wait for the worktree release before the snapshot (M3-09-2b-2)',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
        'failures': {'20261113T195215': [('flaky', 'verification_record:M3-09-2b-1-1: the unchanged spec mission-human-review (deterministic final) took its snapshot before the verification worktree was released, only cleanupPending and worktreeId differ; both refused calls return at the run-status check before the changed code; intermittent on the same candidate (rerun by the integrate launcher)')]},
    },
    ('M3-09-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the read half of the Task page as briefed: waiting line with the two waitingOn codes verbatim '
        'and a gloss, the verification record (runs, checks, criteria, diff gate, resolution, excerpt on demand), '
        'a VERIFIED / INTEGRATED stage that is green only with a latest PASS run and lands on it in one click, '
        'tokens per Attempt; a tolerant verdict-record reader tied to the real writer by a main-side test; no '
        'main-process change; titles 1-12 and 16 fail at their assertions on main composition files with no load '
        'error and 13-15 pass; new UI e2e green on its first host run and red on main files; three screenshots '
        'reviewed; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'a resolved run still marks its human criteria as needing a person: fix with the disposition UI',
            'link buttons in the waiting line have no label and no underline at rest',
            'three time formats on one page: one formatter in part 3',
            'the reader drops unreadable entries without counting them',
            'five catalogs lack older missions keys (pre-existing): hygiene in M3-10',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the read model as briefed: a first-match waitingOn on axiom.task.list / show and the read '
        'axiom.mission.pending with nine kinds, blocks over the plan DAG and calls filtered by Mission status, Task '
        'stage and latest run; pure reads over existing rows with bounded audit lookups; the plan-review calls '
        'narrowed to PLAN_REVIEW as the real calls require, named in the report; titles 1-14 fail at their '
        'assertions on main registration files with no load error; new e2e green on its first host run and red on '
        'main registration files; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'unit tests parse responses with local schema copies; client tests must use the contract schemas',
            'axiom.policy.update triggers no scheduler round after a routing change',
            'no call stops one Attempt: a stall notice offers only task.cancel',
            'strict response schemas with enums: parse tolerantly in the renderer',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-3-3b', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'token budget enforcement as briefed: the Task cap stops and preserves through the timeout path '
        'in recovery_token_stop and blocks the Task whatever the remaining attempts, task.adjust maxTokens above the '
        'usage, Task and Mission caps at admission inside the round transactions, a Token budget section that '
        'sameContract skips, and the two ledger rules in the store and the reader; all five group red checks fail at '
        'their assertions with no load error, the controls pass; new e2e green on the host; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the AgentSpec maxTokens still falls back to the Mission cap when the Task has none',
            'endingLine calls a token-stopped run suspect; word it by stop reason',
            'the CLI task adjust has no --max-tokens',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-3-3', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'token metering as briefed: usage-only rollout parse with the kernel delta and dedupe helpers inside '
        'each Attempt window, Claude per-message maximum, a ledger whose final rows never change, no write for a current '
        'Attempt without new tokens, at most 20 finalizations per pass, a read-only usage view; the Worker found and '
        'resolved the brief contradiction about the rate-limit-only record and fixed two reviewer findings; unit and e2e '
        'red checks fail on main recovery-service.ts; new e2e green on its first host run; no verifier change',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'rate-limit-only rollout records mark a reading partial; skip them (M3-06-3-3b)',
            'a lower or unavailable reading replaces recorded numbers; keep the larger numbers (M3-06-3-3b)',
            'axiom-tables-migration.test.ts is at 800 of 800 counted lines: the next schema case needs a new file',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-3-2b', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'reconciliation, evidence and proposals as briefed: once-only audits in their own transactions in the '
        'brief outcome order, indexed window and total, one global open proposal, desktop-only answer with stale and '
        'illegal checks, supersession on a direct global change; unit and e2e red checks fail on main recovery-service.ts '
        'at the assertions; changed e2e green on its first host run; two verifier test-only fixes for exact expectations '
        'the brief had not listed (three unit tests, the M3-06-3-2 stall-stop spec); the Worker reported the unit ones',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the 100-row oldest-first reconciliation scan has no cursor: pending or failing rows can starve newer ones',
            'briefs that add audit rows or response fields must list the existing exact expectations the Worker may update',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
        'failures': {'20261113T000351': [('candidate', 'host check 20261112-164619: its two host e2e failures are the expected red run of the changed budget-stop spec on main recovery-service.ts (triage.mjs did not yet exclude red-run logs) and the M3-06-3-2 stall-stop spec, whose exact view expectation the candidate additive show fields broke (verifier fix 2 80b1d62f95); both follow from the candidate change')] * 2},
    },
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
        # A FULL label may carry the failure labels of one record, keyed by its timestamp; other records need none.
        labels = verdict.pop('failures', {}).get(os.path.basename(path)[: -len('.json')].rsplit('-', 1)[1], [])
        assert len(labels) == len(questions), (path, len(labels), len(questions))
        if labels:
            verdict['failures_caused_by_candidate'] = [label == 'candidate' for label, _ in labels]
            verdict['failure_labels'] = [label for label, _ in labels]
            verdict['label_evidence'] = [evidence for _, evidence in labels]
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
