# M3-06-2b-3 — recovery probe re-run with the kernel rows (verifier, 2026-11-11)

Why. M3.md's M3-06-2b-3 row asks for the M3-06-2b-2 probe's P2 again before the brief, this time recording what the kernel itself writes when a restart also loses the daemon: the worker's stage and last error. The 2b-2 probe recorded only the worker state.

How. `launchers/m3-06-2b-3-probe.command` on main `cac9b6b9fb` (Electron 43.8.6), 18:32:54–18:34:16 MST, background Electron, fixture `a6a8413ecd`, the headless Codex stub held on its ledger, one Task (T01), `maxAttempts: 2`. Same spec as 2b-2 (git-excluded, generated and removed by the launcher) with three additions per snapshot: the raw `worker_dispatches` rows (state, stage, last_error, residual_resources), the `dispatch_contexts` rows (status, failure_count, last_failure) and the `worker_terminal_resources` rows of those dispatches. The runtime budget now uses the fixture's own `taskRuntimeMinutes` option (moved there by M3-06-2b-2); the restart that also stops the daemons is still a generated-helper knob. Nothing in the product was patched or committed. Run 1 (18:32:54) passed both cases, but its P2 restarted while the worker was still `starting` (stage `terminal_creating`); run 2 (18:36:46, `cac9b6b9fb`) added a wait for the worker to be `ready` before the restart and passed both cases again (1.1 min each). Evidence: `.axiom-work/smoke/m3062b3-probe/p1.json`, `p2.json` (run 2), run 1's copies in `.axiom-work/tmp/m3062b3/`; logs `.axiom-work/logs/m3-06-2b-3-probe-20261111-183254.log` and `-183646.log`.

## P2 — a restart that also stops the daemons, with a held headless Worker

| When | Worker | Dispatch | Task |
|---|---|---|---|
| Bound (run 2, 2.9 s) | `ready`, stage `input_accepted` (run 1: `starting`, stage `terminal_creating`) | `dispatched` (run 1: `pending`) | RUNNING, attempt 1 |
| Right after the restart (4.8 s; run 1 5.0 s) | **`abandoned`, stage `terminal_missing`**, last_error "The assigned worker terminal is no longer live after orchestration recovery." | **`failed`, failure_count 1**, last_failure the same text | still RUNNING |
| End (65 s) | unchanged; Attempt 2's worker `succeeded` / `settled` | Attempt 2's dispatch `completed` | VERIFYING, attempt_count 2 |

Both runs end the same way from a `starting` and from a `ready` worker. Run 2's audits for Attempt 1: `attempt.started` 01:37:01.017 UTC; `attempt.unverifiable { reason: 'missing' }` 01:37:02.341 (Axiom's first recovery pass after boot); nothing else for that Attempt; at the next pass, 01:38:02.347, `task.stage NEEDS_FIX (attempt_abandoned)` and `READY (retry)`; Attempt 2 admitted 01:38:02.458 with baseline `integration` / `previous_attempt_not_submitted` (nothing was preserved), submitted a second later.

The terminal resource of the abandoned worker stays `ownership_state: owned`, `release_state: not_requested` to the end (the fixture holds worker releases unless a spec asks for them, so this says nothing about production releases). As in 2b-2, the Task leaves RUNNING only at the next reconcile pass, through the kernel-terminal rule, and the attempt counts against `maxAttempts`.

## P1 — runtime-budget stop, for contrast

Worker `stopped`, stage `process_stopped`, last_error null; dispatch `failed`, failure_count 0, last_failure `stopped`; Attempt 2 then ran in a new worktree (`attempt-<task>-2`) and settled.

## What the brief can key on

A bound Attempt whose kernel worker is `abandoned` with stage `terminal_missing` (dispatch `failed`, failure_count incremented, the "no longer live after orchestration recovery" text) is the restart-lost-the-daemon ending; a recovery stop shows `stopped` / `process_stopped` instead. D88's 2026-11-11 revision ③ accepts that kernel verdict for this one case: an external interruption (not counted, waiting ladder), preserved, then continued in a new worktree with a new session from the snapshot.

## Limits

One host, two runs of each case, the Codex stub only, an idle Worker (run 1 `starting`, run 2 `ready`). A Worker in the middle of a tool call, or a daemon that dies while its children survive, was not exercised.
