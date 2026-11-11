# M3-06-2b-2 — recovery-side probe (verifier, 2026-11-11)

Why. No e2e spec had ever exercised a recovery-side stop: the paths were covered by unit tests with a mocked terminal only. The order "stop first, then preserve, then settle" (D88 revision row of 2026-11-11 for item 9(c)) rests on two premises about the real runtime — the kernel's stop of a headless Worker reports `stopped`, and the stop leaves the worktree alone. Both were checked on the host before the M3-06-2b-2 brief was written, together with what recovery does after a restart that loses the daemon.

How. One verifier-local smoke spec (git-excluded, generated and removed again by `launchers/m3-06-2b-2-probe.command`), main `ca87240f36`, background Electron (`ORCA_BACKGROUND_LAUNCH=1`), fixture `a6a8413ecd`, the headless Codex stub held on `<ledger>.hold` so that it is alive and idle, one Task (T01), `maxAttempts: 2`. A git-excluded copy of `axiom-fixture-mission.ts` added two knobs read from the test runner's environment: a Task runtime budget and a restart that also stops the daemons (`cleanupE2EDaemons`). The spec dropped an uncommitted file into the Attempt's worktree before each event and recorded audits, kernel rows, the attempt directory, matching processes and the worktree afterwards. Nothing in the product was patched and nothing was committed. Run 01:08:56–01:10:19 MST, 2 tests passed (1.1 min each). Evidence: `.axiom-work/smoke/m3062b2-probe/p1.json`, `p2.json` (local), log `.axiom-work/logs/m3-06-2b-2-probe-20261111-010856.log`.

## P1 — runtime-budget stop of a live headless Worker (Task budget 0.05 min)

- Bound 4.2 s after the test started: worker `ready`, dispatch `dispatched`; three processes behind the Attempt — the wrapper shell, the harness process and the `tee` that writes `events.jsonl`.
- The first reconcile tick after the budget (boot + 60 s; 59 s after the Mission started) wrote `attempt.stopped { reason: 'runtime_budget_exceeded' }`, then `task.stage NEEDS_FIX (runtime_budget_exceeded)` and `READY (retry)` within the same millisecond, and the Scheduler admitted Attempt 2 in that tick.
- After the stop: worker row `stopped`, dispatch `failed`; none of the three processes left; the attempt directory still held `events.jsonl`, `launch.json`, `prompt.md` and **no `exit-code`**; the worktree existed, the dropped file was still there, `git status --porcelain` was unchanged.
- Attempt 2 started from `{ kind: 'integration', reason: 'previous_attempt_not_submitted' }` (today's rule) and submitted under a second after it was admitted.

Established: on this host the kernel's stop of a headless Worker is confirmed (`stopped`) on the first try, takes the whole process tree, writes no exit marker (so the exit path cannot settle that Attempt), and does not touch the worktree or its uncommitted files. Not established: whether a real harness gets to finish anything while its terminal is closed (the stub was idle), and how often a stop comes back `stop_unknown` in the field.

## P2 — restart that also stops the daemons, with a held headless Worker

- Before the restart as in P1. The helper closed the app, stopped the daemons of that profile (which kills the Worker's process tree) and relaunched.
- Recovery's first pass after boot wrote `attempt.unverifiable { reason: 'missing' }` — the terminal is unknown to the new daemon, which folds to `unverifiable` (invariant 9), not to `exited`. Less than half a second later the dispatch was `failed` and the worker `abandoned` (the kernel's assignment settlement; it claims no process exit). No `attempt.failed` and no `attempt.abandoned` audit was written.
- The pass 60 s later settled the Task through the kernel-terminal rule: `NEEDS_FIX (attempt_abandoned)` → `READY (retry)`, `attempt_count` 2 — **counted against `maxAttempts`, no ladder, no refund** — and Attempt 2 started from the integration base. The old worktree and the dropped file were still there.

Finding: a restart that loses the daemon (the probe restarted the app and killed its daemons; a machine reboot also leaves a fresh daemon and should look the same, which was not tested separately) does not reach M3-06-2a's "lost to a runtime restart → interrupted" rule. That rule fires only when the host can positively observe `exited` (the daemon survived and the terminal's process ended). With the daemon gone the Attempt ends as an ordinary kernel abandonment. This differs from what D88 items 2 and 3 intend for a host restart (an external interruption, not counted). It is outside M3-06-2b-2 (the process is not proven gone, so the stop-first rule gives no point at which to preserve) and is recorded in DEFERRED for a decision.

## Limits of this probe

One host (macOS, Electron of main `ca87240f36`), one run of each case, the Codex stub only, an idle Worker. P1 says nothing about a harness that is in the middle of a tool call when the terminal closes; P2 says nothing about a daemon that dies while its children survive. Process lists were matched by the fixture directory and the Attempt id in the command line.
