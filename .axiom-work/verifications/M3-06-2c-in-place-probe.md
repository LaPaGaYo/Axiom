# M3-06-2c — in-place probe at the kernel level (verifier, 2026-11-11)

Why. D88's 2026-11-11 revision row ① makes M3-06-2c an in-place continuation — the next Attempt takes over the previous Attempt's worktree and resumes its session — and asks for a host probe first: switch the branch in the previous worktree, start a second dispatch there, resume the session. The upstream learning scan (`claude/upstream-learning-v1.md` §3, Orca #40963) adds: check whether a second dispatch in the same worktree is refused because something still claims it.

How. `launchers/m3-06-2c-in-place-probe.command` on main `746b5f5cef`, background Electron, the e2e test repository, a fake TUI `codex` modelled on `tests/e2e/orchestration-worker-terminal-visibility.spec.ts` (it records pid and working directory). Kernel RPC only, through `RuntimeClient`; nothing in the product was patched or committed. One worktree W (the active one, the repository's main worktree): worker D1 (task A) starts in W; a file is left uncommitted in W; D1 is stopped with `orchestration.workerStop`; `git switch -c probe/in-place-2` in W; worker D2 (task B) and then a worker for task A again start in W. Run 1 (20:59) had no Codex account selected, and every start failed at `terminal_create` with "No Codex account selected…" (D83 ruling ① on macOS) — kept as `.axiom-work/tmp/m3062c/p-run1-no-account.json`. Run 2 (21:03–21:06) seeded the e2e placeholder account (`seedCodexTestAccount`, no login) and is the evidence: `.axiom-work/smoke/m3062c-in-place-probe/p.json`, logs `m3-06-2c-in-place-probe-20261111-210259.log` and its `-e2e-` log.

## Results (run 2)

| Step | Result |
|---|---|
| D1 start (task A) | accepted; effects `worktree reused`, `terminal created`; the fake's ledger shows it running with W as its working directory. The kernel could not observe the fake's turn start, so D1 sits in `start_unknown` / `turn_start_unobserved` — the fake speaks no turn markers; this says nothing about W |
| Stop D1 | `state: stopped`, `processAction: closed_agent_terminal`, `ptyKilled: true`; the fake received SIGTERM. Worker `stopped` / `process_stopped`, dispatch `failed` (`last_failure: stopped`), **D1's terminal resource stays `owned` / `not_requested`** |
| Branch switch in W | `git switch -c probe/in-place-2` succeeded; HEAD unchanged; the uncommitted file still there (`?? probe-uncommitted.txt`) |
| Orca's worktree record right after the switch | `worktree.show` and `worktree.list` still report `refs/heads/main`; the worktree id is path-based and unchanged. About a minute later (after D2 and D3 had started) `worktree.show` reported `refs/heads/probe/in-place-2` on its first read — the record catches up, with a lag of up to a minute in this run |
| D2 start (task B) while D1's terminal resource is still `owned` | **accepted** in W (`worktree reused`, a new terminal, working directory W) |
| Task A again, plain start | **refused**: "Task … is blocked; only a ready Task can start." — after the stop the kernel task is `blocked` (after a failed start, run 1, it was `failed`) |
| Task A again with `retryOf: D1` | **accepted** in W; `retry_of_dispatch_id` = D1. D1's terminal resource is not released by the retry: the kernel releases a retried worker's terminal only when that worker is `failed`, and D1 is `stopped` |
| End | three terminal resources in W, all `owned` / `not_requested` (D1's with its pty killed, D2's, D3's); nothing refused anything because of another worker in W |

## What the brief can rely on

- The kernel has no worktree-level occupancy rule: a worker can start in a worktree where an earlier worker's terminal resource is still `owned`, for another Task or for the same Task. Code reading agrees — the only "already has an active dispatch" guards are per terminal handle (`dispatch-context-store.ts`, `worker-dispatch-authority.ts`), and `startLocalWorker` places an Axiom worker in `controlPlane.worktreeId` through the same `showManagedTerminalWorkspace` path for TUI and headless. The derived record Orca #40963 warns about does not refuse the successor here.
- The successor's kernel start must carry `retryOf` whenever the kernel Task is `failed` or `blocked` — Axiom's launcher already passes the latest dispatch as `retryOf` in exactly those cases. Which state the kernel Task is in depends on how the previous dispatch ended (`ready` after the exit path's `failDispatch`, `blocked` after a stop, `failed` after a failed start).
- `git switch -c` in an Orca worktree keeps HEAD and the uncommitted work. Orca's worktree record shows the old branch for a while afterwards, so 2c must never read the Attempt's branch from the kernel's worktree record — Axiom already uses `binding.branch` and explicit refs.
- Leftover terminal resources stay `owned` (the stopped worker's, and the abandoned worker's of M3-06-2b-3); they do not block anything, but they accumulate and the UI may show them.

## Limits

One host, one run with an account. A fake TUI worker, not the headless channel: the placement path is shared (code), but the headless launch itself was not run in a reused worktree here. The repository's main worktree, not a linked worktree like Axiom's attempt worktrees (the git operation is the same). The session-resume half was not run here: the 2026-11-10 probe (`.axiom-work/verifications/M3-06-2-resume-probe.md`, real `codex-cli 0.163.0`) already resumed interrupted sessions from the same directory and from another one; whether a resume is accepted after Codex has compressed a rollout older than seven days (Orca #40593) is still open.
