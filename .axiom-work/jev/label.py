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
    ('M4-5a', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the read side says what integration did: every Task of axiom.task.list and axiom.task.show '
        'carries its latest batch, and axiom.mission.show carries the integration branch and the recorded head; '
        'optional fields on existing responses, no new RPC method; the head lookup of the batch start became a '
        'function both use, with the same events in the same order; no renderer, CLI or store change; '
        'no existing unit test changed; six new tests under both runners; on the host titles 2, 3 and 4 fail '
        'with the two wiring files of main put back and 1, 5 and 6 pass; the integration spec with the added '
        'desktop reads passes three times and fails against the wiring of main; every Mission spec passes on '
        'the first host run; the union script failed 0 with ten pins retired by the planner; no verifier '
        'change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'only the latest batch of a Task is shown; an earlier conflict or failed regression disappears from the '
            'read once the next batch exists',
            'recordedHead is the record, not the branch: it can lag after a promotion and does not notice a branch '
            'moved by hand',
            'each task read lists the batches and candidates of the Mission, and each mission show reads its audit '
            'events a second time',
            'nothing shows the fields yet; the interface is M4-5b',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('SCHEMA-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'a database stamped by a newer Axiom gets no Control Plane: getAxiomControlPlane refuses before '
        'anything is built, with one code, a reason, two numbers and a next step; every axiom request that needs '
        'it and every kernel verb that must ask whether a Mission owns a Run answer that refusal, start and stop '
        'treat it as no Control Plane here, and nothing else changes; the code joins the controller list, so no '
        'kernel, contract, CLI or renderer file changes; no existing test changed; six new tests under both '
        'runners; on the host titles 1, 3, 4 and 5 fail with the two files of main put back and 2 and 6 pass; '
        'the new e2e spec passes three times and fails against the control-plane.ts of main; every Mission spec '
        'passes on the first host run; the union script failed 0 with ten pins retired by the planner; no '
        'verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the check is made when a process first asks for the Control Plane; a plane that exists is not stopped '
            'when another process raises the stamp later',
            'kernel orchestration verbs are refused on such a database even for Runs no Mission owns',
            'the CLI shows the code and the next step, not the reason; the sentence is English',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('SCHEMA-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'Axiom gets a schema version of its own: one row in the new table axiom_schema, a chain of '
        'numbered steps that runs after the kernel chain, and a first step that is the eight columns Axiom added '
        'to existing tables; a stamped database is opened with one read and no write, a stamp from a newer Axiom '
        'is left as it is, a failing step rolls back; the unnumbered column probe is gone and SCHEMA_VERSION '
        'stays 46; the two shared kernel files change by one import and one call and by two removed lines; '
        'one statement added to one existing test and no other existing test changed; eight new tests under '
        'both runners; on the host titles 1, 2, 4, 5 and 6 fail with the four files of main put back; a copy '
        'of the development database (kernel version 42) opens with the candidate, is upgraded and stamped, '
        'passes the integrity check and keeps its row counts; every Mission spec passes on the first host '
        'run; the union script failed 0 '
        'with ten pins retired by the planner; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'nothing reads the stamp yet except tests; what the application does with a newer stamp is SCHEMA-2',
            'the stamp says which Axiom last ran a step, not that every object is intact',
            'an older build that opens a database with a newer stamp still runs its own create-when-missing DDL',
            'upstream_version is a constant until a sync changes the kernel chain',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('SWEEP-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the safety net of the plan row: the existing 60 s reconcile tick asks every EXECUTING Mission '
        'for one round with the new trigger sweep, boot keeps its own resume rounds and no timer is added; a sweep '
        'round does not repeat a refusal that equals the one the read models count, rounds asked for by a real '
        'event write as before; a sweep does not replace a trigger that is already waiting; the four exported '
        'types of scheduler.ts moved unchanged and are re-exported, so no importer changed; no existing test '
        'changed; nine new tests under both runners; on the host titles 1, 2, 6, 7, 8 and 9 fail with the two '
        'files of main put back and 3, 4 and 5 pass, as the brief predicted; every Mission spec passes on the first host run; the union script failed 0 '
        'with ten pins retired by the planner; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'no Mission spec runs with the sweep on; the first spec that needs it sets AXIOM_E2E_RUN_SWEEP=1',
            'an integration request that ended failed while its Task stayed INTEGRATION_READY is asked again '
            'once a minute with no bound; it takes a second fault to get there',
            'a Task held back only by its provider cap has its contracts built again every minute; not '
            'measured on a large Mission',
            'a round that fails for a lasting reason now warns once a minute',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('STRUCT-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'structure only: one scope for hooks-off git writes in a new file, used by the seven places '
        'with the argument arrays, options, order of calls, results and errors they had; the redaction module '
        'moved unchanged and 34 import lines follow; the only differences are the two the brief accepted (one '
        'directory prefix, best-effort recursive removal); no existing test changed apart from two import lines; '
        'five new tests, one with real hooks and a control; both runners green; every Mission spec passes on the '
        'first host run; the union script failed 0 with nine pins retired by the planner; one verifier change, '
        'whitespace in a statement the brief itself had asked for unformatted and one name in the doc; no '
        'other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'five of the seven places have no ceiling and three writes have no deadline; the report lists them '
            'for Henry to decide',
            'git writes that still run repository hooks: branch creation of the integration base, branch -f '
            'in verification, the three calls of the continuation take-over, the private-index calls',
            'a removal that fails leaves a directory in the OS temp folder and nothing sweeps those',
            'the shared function has no comment that says why removal is best effort',
            'a brief must not quote a statement the formatter would lay out differently and ask for it exactly',
            'STRUCT-2 (audit event names) is not started',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-2b', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'requestIntegrations in a new file of the integration directory, called by every Scheduler round '
        'right after readiness is recomputed (two added lines in scheduler.ts): Tasks back in INTEGRATION_READY '
        'whose request is missing or ended are enqueued again, then VERIFIED Tasks with an active candidate, a '
        'passing latest run and all upstream Tasks INTEGRATED move to INTEGRATION_READY with the effect and the '
        'audit event in one transaction per Task, in the order they were verified; a failed Task transaction rolls '
        'back alone and the function never throws; the e2e fixture holds the step unless a spec asks; one new '
        'product file, no existing test file changed; with main scheduler.ts titles 7 and 8 fail at an assertion '
        'and titles 1 to 6 pass; with main scheduler.ts built into the app the new e2e spec fails; every Mission spec passes on the first host run and the new spec three times; both '
        'runners green; the union script failed 0; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'a request that ended failed while its Task stayed INTEGRATION_READY is enqueued again by every later '
            'round, three tries each, with nothing that bounds it',
            'a verified Task that fails a rule is not requested and nothing says why',
            'there is no periodic round: a request is made only when something schedules one',
            'scheduler.ts is at 300 counted lines: the next change to the round needs an extraction first',
            'only the new spec runs integration end to end; every other Mission spec holds the step',
            'verifier details that Henry can overturn: the request is made by the round and not inside the '
            'verdict transaction; nothing is written about a verified Task that is not requested; asking again '
            'looks at the request and not at the runs; the e2e default holds integration',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-1c', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'Before a verification worktree is handed back, removeVerificationWorktree points its HEAD at '
        'its own branch again with one symbolic-ref, hooks off, only when the directory has its own .git, the '
        'branch stands at the commit HEAD stands at and no worktree has it checked out, every git call of the '
        'step under a ceiling at the parent directory; the removal follows as before and the kernel deletes the '
        'branch by its own rule; the five callers pass the branch; the boot sweep compares short names and accepts '
        'full refs; four existing product files change and none is new; the kernel-backed runtime stub is '
        'extracted in place for reuse; titles 1 to 3 fail at an assertion on main verification-worktree.ts and '
        'titles 3 and 4 on main verification-recovery.ts, the controls pass; with main verification-worktree.ts '
        'built into the app the e2e spec fails at its new expectation; every Mission spec passes on the first '
        'host run; both runners green; the union script failed 0; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'with a git older than 2.38 the kernel cannot prove a verification branch merged and keeps it',
            'the removal is not waited for and a preserved branch is not recorded',
            'the sweep still sees only worktrees on a branch',
            'the step takes the git runner default deadlines, as the pin does: the shared git writer is D93',
            'the hooks-off git write now exists in seven places: the structure-only Task after M4-2b (D93)',
            'verifier details that Henry can overturn: nothing waits for the kernel removal; the minimum git '
            'version stays 2.25 for now',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-2a-3', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'After a passed regression the same try returns the scratch, looks at the request once more, '
        'and advances the integration branch from the base of the batch to its merge commit with an expected old '
        'value, hooks off, never under a checkout and never through a symbolic ref; one transaction records '
        'PROMOTED, the Task INTEGRATED and integration.batch_promoted; a new batch starts only from the head the '
        'audit events recorded (integration_head_unexpected otherwise); a PROMOTABLE batch whose merge commit is '
        'the head is recorded as promoted by the next try or by exhaustion and is never abandoned; a PROMOTABLE '
        'batch is promoted without a second merge or regression; a Task unblocked after the promotion is '
        'integrated by its next request; the two git helpers of the integration directory set '
        'GIT_CEILING_DIRECTORIES; five existing product files change and two modules are new; with main '
        'integration-apply.ts, integration-merge.ts, integration-request.ts and integration-scratch.ts written '
        'into the tree, titles 2 to 9 each fail at one assertion and title 1, which tests the new function of '
        'execution/integration-base.ts alone, passes; every Mission spec passes on the first host run; both '
        'runners green; the union script failed 0; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'nothing enqueues integration.apply yet: M4-2b',
            'the checkout check and the update are two git calls; a rebase or bisect of the branch in a worktree '
            'is not seen',
            'the recorded head is read from all audit events of the Mission at every batch start',
            'a moved head blocks every Task of the Mission at integration until the ref is put back: a '
            'Mission-level pending item is M4-4',
            'the hooks-off git write now exists in six places: the structure-only Task after M4-2b (D93)',
            'verifier details that Henry can overturn: a moved head stops the integrations of the Mission; a '
            'checked-out branch is left alone; a Task blocked or cancelled after the ref moved keeps its stage; '
            'a symbolic integration ref is never written',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-2a-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'The merged-tree regression runs in the same try as the merge, on the merge commit, and is '
        'recorded as a verification run of the batch: PASS makes the batch PROMOTABLE, FAIL makes it FAILED and '
        'sends the Task back through the settlement the conflict uses, INCONCLUSIVE keeps TESTING and fails the '
        'try (three tries, then the existing exhaustion); a batch found in TESTING is taken up again without a '
        'second merge; the outbox hands every executor a signal that stop aborts, and a stopped regression spends '
        'no try; a regression that is no longer current cancels its own run and yields; every try first closes '
        'the dead open batches of its Mission; the listing of verification runs answers candidate runs only '
        'unless a batch is named, so no reader file changes; eight existing product files change and three '
        'modules are new; title 1 fails at an assertion on main outbox files, titles 2 and 3 on main '
        'verification-runs-store.ts, titles 4 to 10 on main integration-apply.ts; every Mission spec passes on the '
        'first host run; both runners green; the union script failed 0; no verifier change; no other model CLI '
        'called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'a stop between the last command and the verdict transaction discards that regression and the next '
            'try repeats it',
            'the integration head does not move and a PROMOTABLE batch stays open: M4-2a-3',
            'three reads of mergeCommit of a TESTING batch rely on the store rule and are not checked in place',
            'verifier details that Henry can overturn: an empty plan passes (no_commands); a verdict counts only '
            'while the scratch stands at the merge commit; a regression never goes to a person',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-2a-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'What the merged-tree regression will stand on is in place and unused: verification_runs has the '
        'nullable column batch_id, from the DDL in a new file and added at open in an existing one without a '
        'version number (probe, write lock only when missing, second probe, add, commit); a run can carry a '
        'batchId and a candidate run has no such key; the claim and the recovery of the verification service '
        'skip a run of a batch before they touch anything; the rules accept integrationGates and '
        'resolveIntegrationPlan answers setup, criterion commands and gates while resolveVerificationPlan answers '
        'as before; eight product files change and one module is new; title 1 fails at an assertion on main '
        'create-tables.ts, title 2 on main verification-runs-store.ts, titles 3 and 4 on main claim and recovery; '
        'every Mission spec passes on the first host run; both runners green; the union script failed 0; no '
        'verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the column reaches an existing database without a version number, which is the verifier reading of '
            'the AGENTS.md rule on migrations: Henry decides (pending item 7); AGENTS.md is not edited until then',
            'listVerificationRuns answers runs of a batch among the others and six readers take them as candidate '
            'verifications: M4-2a-2 decides in the listing',
            'when ALTER fails and ROLLBACK fails too the second error replaces the first, as in the numbered runner',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-1b', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'The effect kind integration.apply and its executor do what the brief asks, up to TESTING: the '
        'batch row is written before any git call, the scratch worktree comes from the kernel on the full ref of '
        'the integration head, the candidate is pinned from inside it, the merge runs on a detached HEAD with '
        'repository hooks off and fixed dates, the merge commit is pinned before the batch moves to TESTING, a '
        'conflict is recorded with its paths and sends the Task back, three failed tries supersede the batch and '
        'block the Task; on real repositories with the kernel git functions the temporary branch is gone after '
        'every run and no remote is reached; five product files gain wiring; title 10 fails at an assertion on '
        'main control-plane.ts and titles 1 to 3 on main effect files; 38 of 39 Mission specs pass on the first host '
        'run and the one restart that timed out passes three times on rerun; both runners green; the union script '
        'failed 0; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'a request that has become stale ends done and leaves an open batch of its candidate open, which '
            'defers every other candidate of the Mission: M4-2a-2 must close it before M4-2b enqueues',
            'the executor lists the three terminal Mission statuses instead of TERMINAL_MISSION_STATUSES',
            'a failed removal of the empty hooks directory after a successful git write fails the try',
            'on the full runtime a temporary branch that an interrupted merge left is reused and then kept '
            '(preserveBranchOnDelete); the fixture stops below the runtime and shows it gone: M4-4 sweeps it',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
        'failures': {'20261116T105751': [('flaky', 'verification_record:M4-1b-1: the unchanged spec mission-headless-worker (restart after the durable exit code) timed out once in the restart helper (orca-restart.ts:190, 30 s) waiting for the relaunched window to expose its store, before any assertion about the Mission; the candidate changes no renderer, preload or start-up code and only registers an executor that has no row to run; the helper line appears in no earlier host-check or verify-main log; passed three times on the same candidate (rerun by the integrate launcher before the record was committed); first occurrence, cause not established')]},
    },
    ('M4-1a', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'IntegrationBatch has a contract and a store and every new candidate is pinned by a ref of its '
        'own before its submission is committed, as briefed: the ten statuses and the table of legal moves, a '
        'store whose moves are refused without a write when they are not legal or the row is not in the expected '
        'status, a create-only pin with hooks off that never throws, the pin awaited before the submission '
        'transaction and a failed pin recorded inside it; two product files gain wiring, nothing that runs today '
        'changes; titles 8, 12 and 13 fail at an assertion on main product files and are the only failures of the '
        'whole Axiom step there, title 14 passes; the e2e spec fails at the new expectation on main code; every '
        'Mission spec passes on the host; both runners green; the union script failed 0; no verifier change; no '
        'other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'a pin whose submission is then refused stays behind and nothing removes a pin',
            'pinCommit answers unavailable when its empty hooks directory cannot be removed after a successful write',
            'AGENTS.md names two reference documents that no longer exist',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M4-0', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the start of a Mission is checked before git and the audit, a repository that is not on this '
        'machine and a second Mission on an occupied repository and target branch are refused, a reused integration '
        'base must be an ancestor of the target, and the contract has the two finalization back-edges, as briefed: '
        'one guard module, the call as the first statement of the start transaction, the checks in the handler, the '
        'ancestor check, two table entries and two error codes; no other product change; titles 1 to 5 and the two '
        'changed existing titles fail at an assertion on main product files, titles 6 and 7 pass there; every '
        'Mission spec passes on the host; both runners green; the union script failed 0; no verifier change; no '
        'other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the pending view still offers Start for a PLANNED Mission whose target is occupied',
            'a status for delivered, waiting for the merge (D92 d) has to join the occupying set',
            'integration_base_unavailable has two meanings told apart only by its message',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-4c-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'a committed policy update requests one admission round for its Mission and a trigger that arrives '
        'while a round is failing is run instead of dropped, as briefed: the trigger literal, a three-line controller '
        'method, the call after the transaction in the handler and a catch on the round in the scheduler loop; no '
        'other product change; titles 1, 3, 4 and 6 fail at an assertion on main product files, titles 2 and 5 and '
        'every older scheduler title pass there; the new e2e spec passes on the candidate and fails at its first poll '
        'on main product files; every Mission spec passes on the host; both runners green; the union script failed 0; '
        'no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the error of a failing round that is followed by a pending trigger is neither logged nor returned: one log line at that catch',
            'every committed update requests a round, also one that changes nothing; refusals are not de-duplicated',
            'no screen changes a policy yet (M3-09-4c-2)',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-4b-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the Planner context gains one bounded section with the rejected plan revisions, as briefed: one '
        'new pure module, three lines of wiring in planner-render.ts and the refusal of a secret-looking reason '
        'before the write in MissionController.rejectPlan; no other product file changes; the section text, order, '
        'marking, quoting and the two bounds match the brief line by line and the size arithmetic was re-derived '
        'separately (40,000 random cases never pass 4,096 bytes and never drop the newest rejection); titles 1 to 6 '
        'fail at an assertion on main product files and titles 7 and 8 pass there; both runners green; all Mission '
        'specs pass on the host; the union script failed 0; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'no spec runs a rejection followed by a real Planner launch in the app; whether a real model takes the reason into account is for the hands-on run of 0.1',
            'quoteLine leaves backticks and angle brackets of Task titles as written (DEF-12 item 2)',
            'a reason cut at 500 UTF-16 units carries no mark that it was cut',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-06-2b-4', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'an Attempt lost with its daemon is preserved and settled as an interruption whether or not its '
        'wrapper left an exit marker, as briefed: the marker condition is gone from the lost-daemon branch, the '
        'marker is still read before the capture with the acceptance rule of the exit path, an accepted integer is '
        'kept in the attempt.failed audit as exitMarker and nothing else of the audit changes; no other product '
        'file changes; titles 1, 2 and 4 fail at their first assertion on main product files and titles 3 and 5 '
        'pass there; the new e2e test reaches the state through the fixture hold and fails at its first assertion '
        'on main files; the host experiment that failed twice on main (a 400 ms pause before the signal to the wrapper) passes twice on the candidate with exitMarker 143 in the audit and the work preserved; all 38 Mission specs (74 tests) pass on the first run; both runners green; the union script failed 0; no verifier change; no other '
        'model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'when the exit path commits before the kernel verdict the ending is the exit path one (counted for a signal exit): order of the two paths at boot and classification of signal exits (M3-10)',
            'a finished Attempt whose terminal was lost is preserved and continued, not submitted (V1 decision; M3-10 item)',
            'the fixture restart unit test gained no case for the new option',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-4b-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'acceptance criteria that hold a secret are refused where they are written, as briefed: the three '
        'built-in patterns moved verbatim into one contract module and imported by the redactor; the rule added once, '
        'to validateTaskAcceptance (text of every object criterion, command of a command check), with a typed issue '
        'that names field and pattern and never the value; no call site changed, so the proposal, Task creation and '
        'Task adjustment refuse through plan_invalid, the subtask checks fail with the same name, and the adjust form '
        'predicts it through the function it already calls; stored plans stay approvable; twelve titles as briefed, '
        'titles 1, 3, 4, 5, 7, 8 and 12 fail at one assertion each on main product files with no load or render error '
        'and the five control titles pass there; both runners green; every Mission spec green on the host; the union '
        'script (first Task under the short-sidecar convention) failed 0; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the contract module exports regular-expression objects with the global flag: say so on the export or export sources (M3-10)',
            'a subtask request that fails this check is still stored as received, and three audit rows keep criteria as given: redaction of those rows is not part of this Task',
            'no override for a false positive on a long identifier that starts with one of the prefixes',
            'the Mission secretPatterns take no part in this check, by decision',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-4d', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the acceptance criteria of a Task, as briefed: shown on the Task page as they are now from the '
        'Task read; replaceable as a whole from the adjust form behind an unchecked box, the draft taken once in the '
        'handler and kept across page reads; refusals predicted only with the write path schema and functions '
        '(TaskAdjustParams, validateTaskAcceptance, validateAcceptanceCommands with evidenceCommandMessage), no '
        'default rules filled in when the policy is missing or invalid, no replacement offered for retired evidence; '
        'the transport error keeps the refusal data and the error line words it by one rule; the approved plan card '
        'says Tasks may have been adjusted and an empty Goal coverage is left out; titles 1-10 fail at an assertion '
        'on main wiring files with no load or render error; the new e2e test green on its first host run (told '
        'before sending with the message the contract functions give, replacement through the page, rerun to PASS on '
        'the same Candidate without a second Attempt), every Mission spec green on the host except one run of the '
        'unchanged main-process spec mission-daemon-lost-continuation (a timeout after the restart; three runs alone '
        'on the same tree passed; not the candidate), e2e red run fails where the region should be; one screenshot '
        'read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the three proof kinds are typed in the row component while Artifact kinds come from the contract enum: key the options by the contract kind type',
            'zh says 限额 for a limit where the catalog says 上限 elsewhere: wording pass of M3-10',
            'a legacy Task with requiredEvidence cannot have its criteria replaced: dropping the field on replacement is a main-process change (4b candidate, with Henry)',
            'criteria and commands are not checked for secrets at the write paths (4b candidate, with Henry)',
            'the Task page does not list the commands a rerun will run',
            'mission-daemon-lost-continuation timed out once after the restart, cause not established: attach the Attempt audit rows and the worker row to the failure output (M3-10); the host-check launcher keeps test-results of failed runs',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
        'failures': {'20261115T041009': [('flaky', 'verification_record:M3-09-4d-1: the unchanged main-process spec mission-daemon-lost-continuation timed out once (150 s) waiting for attempt.failed after the restart; the candidate changes no file under src/main, src/preload, src/shared or src/cli and the spec reaches the Control Plane through the preload bridge only; the spec passed in the 18 host checks before and in three runs alone on the same tree; first occurrence, cause not established')]},
    },
    ('M3-09-4a', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the plan card, as briefed: per Task the scope, risk level, limits and how each criterion is '
        'proven, and for a proposed revision the commands verification will run, taken from the contract function '
        'resolveVerificationPlan with rules parsed by VerificationRulesSchema and no default of its own; milestones, '
        'stored warnings and Goal coverage from planCoverage; the earlier rejection with a difference keyed by Task '
        'id; a rejected revision kept on the page; approval behind a non-destructive confirmation; approval and '
        'rejection offered only from the pending view; the transport moved out of the client verbatim and '
        'showPolicy added; the policy read with the Mission and apart from it; titles 1-8 fail at an assertion on '
        'main wiring files with no load or render error; new e2e spec green on its first host run (verification '
        'list equal to the contract function, rejection through the page, revision 2 with its changes, approval '
        'declined then confirmed), every Mission spec green, e2e red run fails where the list should be; one '
        'screenshot read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'Goal coverage renders an empty heading when the Goal lists no acceptance criteria: leave the block out or say so (next renderer Task)',
            'the changes block sits below the Tasks and the dependency list; move it near the top of the card (M3-10 polish)',
            'the sentence for an unreadable or invalid policy repeats under every Task; say it once per card',
            'Task-level blocks are level-3 headings inside a level-3 group: accessibility pass of M3-10',
            'one more call per page read (axiom.policy.show): one read model for the Mission page (M3-10)',
            'PlanCard.test.tsx is at 785 of 800 counted lines and the controller at 245 of 250: the next Task splits',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-3c', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the Mission page gains a Supervision region of its own below Mission Home, as briefed: the stall '
        'mode in effect and its source, one form for the Mission override and one for the global default sending '
        'axiom.supervision.update, a confirmation before stop, and an open upgrade proposal with its evidence whose '
        'answers are offered only while the pending view lists the action; the supervision view is read with the '
        'Mission and any failure of it stays in the region; three client methods written like their neighbours; '
        'the refresh handed to the page no longer takes the quiet flag; titles 1-6 fail at the region query on '
        'main wiring files with no load or render error; new e2e spec green on its first host run (mode set '
        'through the page and read back from the Control Plane, stop declined then confirmed, default changed, '
        'override cleared, an outside update followed without a refresh), every Mission spec green, e2e red run '
        'fails where the region should be; one screenshot read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'Close in the stall mode form is disabled while the page is busy, unlike the other forms of the folder',
            'after an accepted save the focus is left on the document instead of the button that opened the form',
            'the zh catalog has two words for the proposal (the pending row of M3-09-3a and the new block): M3-10 copy pass',
            'one more call per page read (axiom.supervision.show), twelve times a minute while the page is visible: one read model for the Mission page (M3-10)',
            'no test drives a proposal produced by the Control Plane (twenty known outcomes): an e2e-only minimum is the seam M3-10 needs',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-3b-2', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'the Missions page re-reads every five seconds on the kernel visibility interval, installed '
        'once by the page controller and stopped on unmount, as briefed; the timed read is the manual read under '
        'the same generation counter without the busy state and the toast, started only when the page is idle; '
        'a failed timed read keeps the data, shows the failure on the error line and stops the timed reads until '
        'a read that is not timed succeeds; the read lifecycle moved into its own hook and the controller is 230 '
        'lines; titles 1-5 fail at their first assertion on main controller with no load or render error; new '
        'e2e spec green on its first host run (a Mission created from outside appears by itself while a typed '
        'reason keeps text and focus, nothing arrives while the document is hidden, an approval from outside '
        'reaches the plan panel), every Mission spec green with the timed read under it, e2e red run fails where '
        'the second Mission should appear; one screenshot read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'axiom.attempt.list asks the execution host about the terminal of every Attempt on every read, twice per read with a Task selected; the timed read makes that twelve times a minute (M3-10 hygiene)',
            'the refresh handed to the page takes a quiet flag: wrap it when the controller is next touched',
            'the count of unanswered reads includes superseded ones: a read that never answers holds the timed reads back',
            'a read that no longer offers the action of an open form closes it, now possibly without the person asking for a read (reported to Henry)',
            'the native visibilityState of the never-shown e2e window was not measured, only overridden by the new spec',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
    ('M3-09-3b-1', '1'): {
        'verdict': 'VERIFIED',
        'reason': 'every pending row of Mission Home shows the since string of the view verbatim in a time '
        'element before the actions line, as briefed; a provider wait is dated from the oldest refusal above '
        'the stage audit of its Task through one new single-row store read with the boundary admissionWait '
        'uses; pendingMessages and the pending-only read are gone; the Mission read is a pure move into its '
        'own module and the controller is 239 lines; titles 1-3 fail at their assertions on the three main '
        'files with no load or render error; new e2e spec green on its first host run with the three start '
        'times equal to the first refusal audits and unchanged after pause and resume, exit m1 unchanged '
        'across a restart with the times on the page, every Mission spec green, e2e red run fails at the '
        'first row time; one screenshot read; no verifier change; no other model CLI called',
        'scope_creep': False,
        'report_completeness': 3,
        'followups': [
            'the brief said audit times have one-second precision; refusal audits carry the scheduler clock with milliseconds: correct the spec comment and drop its one-second wait (M3-09-3b-2)',
            'two near-identical statements in read-model-audits-store.ts: fold them when a third variant appears',
            'copy pass: one form for times on Mission Home and on the Task page waiting line, catalogs for Since (M3-10)',
            'refusal audits accumulate, one per waiting Task per round (M3-10 hygiene)',
            'the since of a token-budget item still follows the latest measurement and will move under a timed refresh (M3-09-3b-2)',
        ],
        'failures_caused_by_candidate': [],
        'failure_labels': [],
        'label_evidence': [],
    },
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
