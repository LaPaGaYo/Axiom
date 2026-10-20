# VerificationRun — UPSTREAM-1 attempt 2 (verifier-reconstructed commits)

- Task: UPSTREAM-1 — first D56 intake: three upstream cherry-picks (`2576783d4d` copilot config owner-only, `23a874a2a1` Linux secret sealing, `983250a12e` awaited Codex trust preflight) + semantic port of `5b3366f78e` parts (b)/(c) (vitest real-agent-home write guard + temp-home test fixes; part (a) deferred to the trust-subsystem batch).
- Candidate: `720851248f` (branch `axiom/attempt/UPSTREAM-1/2`): the Worker's attempt-1 tree (launcher commit `63e71074ea`, 27 source/config files + report) re-expressed as 4 provenance commits + report + sidecar fix. `git diff 63e71074ea` on the reconstructed branch is empty (0 files) — byte-identical content.
- Why reconstruction: Codex's sandbox cannot write `.git` (`Unable to create .git/index.lock`), so the Worker applied the patches with `git apply`, resolved the two conflicts by hand and left everything uncommitted; the launcher squashed it into one commit without `cherry picked from` trailers. The verifier re-ran `git cherry-pick -x` for the three picks (taking the Worker's resolved `config/reliability-gates.jsonc` / `src/main/ipc/worktree-remote.ts` for the one conflict) and committed the port from the Worker's files. **Pipeline fact recorded**: Workers cannot commit; provenance commits for intake batches are the launcher/verifier's job.
- Attempt chain: 1 (`63e71074ea`, 18:10–18:21 MDT, 11 min, Codex `gpt-6-astra` reasoning `max` — first attempt under the new config; `verify-UPSTREAM-1-1-20261019-182139.log` OVERALL=FAIL only on the five provenance pins + the known-env pty test); 2 = verifier reconstruction, `verify-UPSTREAM-1-2-20261019-182719.log`.
- Verifier: Claude.

## Gates on the reconstructed branch (`verify-UPSTREAM-1-2-20261019-182719.log`)
| Check | Result |
|---|---|
| vendor-egress ratchet | PASS (the Worker replaced the upstream vendor URL in the new reliability-gate entry with the repository-local source path, keeping the 430-pair baseline) |
| unit tests (sidecar targets: `src/main/{codex,host,startup,ipc}`, trust/claude-agent-teams/adoption-replay tests, guard self-test, new `agent-trust-completion.unit.test.ts`, `src/main/axiom`, contracts, `methods/axiom`) | 800 files passed / 1 failed / 6 skipped — the failure is `src/main/ipc/pty-runtime-hidden-at-spawn-mark.test.ts` (known-environmental list) |
| `tc:node` / `tc:cli` / `tc:web` (clean caches) | PASS |
| changed-code quality | PASS — 0 findings |
| sidecar extras ×23 | 22 PASS; the one FAIL is the file allowlist tripping on the verifier's own `.axiom-work/briefs/UPSTREAM-1.verify` commit (provenance pins rewritten to read recent history so they also hold on main) — not Worker content |
| full `pnpm lint` | PASS (80 s) |

## Independent review
- Picks 1–2 applied cleanly (`2 files, +41/−1`; `8 files, +489`): Copilot config writes now `0600`; Linux keyring backend selection runs before the secret store is installed and preserves explicit choices. Both additive.
- Pick 3: `agent-trust-write-deadline.ts` bounds the Codex trust preflight (20 s) and `worktree-remote.ts` now awaits it instead of discarding the promise; the reliability-gate entry `agent-session.trust-preflight-completion` was inserted without touching Axiom's existing gates; the 15-test suite is included.
- Port: guard file equals upstream + exactly two Axiom path additions (`'.axiom'`, `~/.config/axiom`), self-test byte-identical, registered first in `setupFiles`; eight existing tests gained temp HOME / userData using this tree's APIs; the guard reported zero violations across the broad targeted run (772 files) — i.e. no other unit test in these targets writes the real home. Part (a) correctly deferred; `codex-home-paths.ts` untouched.
- Known imperfection: the pure cherry-pick commit `d4cc697bce` carries upstream's two-argument Copilot test calls, adapted to this tree's one-argument API only in the later port commit (`c9008cfa10`); the branch tip is consistent, intermediate commits are not individually green. Acceptable for an intake batch; noted for bisecting.
- Scope: `package.json` / `pnpm-lock.yaml` / `.github` / `src/renderer` / `src/main/axiom` / `src/cli` / `tui-agent-config.ts` untouched (extra PASS).

## Verdict
PASS — merge `--no-ff` into `main`; verify-main (union through M2-06b + UPSTREAM-1) recorded below.

## Next batches (from the Worker's and verifier's triage)
- UPSTREAM-2 (before M2-09's real-Codex Planner smoke): trust / Codex real-home subsystem — `21d4ae9448` → `9f4311598f` → `cfa43e7eab` chain (needs a subsystem-level sync decision: 42 upstream commits touch `src/main/codex` before the fix, 163 since the fork), then part (a) of `5b3366f78e`.
- UPSTREAM-3: OpenCode readiness pair (`88e9517eb1`, `990b0ed5cd`) before OpenCode certification (D57); agent-launch 7-step series assessment.
- Electron 43.7.0 → 43.7.8: verifier-run on the host (dependency change), separate commit + verify-main.

## Merged-tree check (verify-main, union M1-01 … M2-06b + UPSTREAM-1)
- `verify-merged-92e97431fd-20261019-183212.log` (main `92e97431fd`): unit tests 2,390 files passed / 4 failed / 9 skipped — the four failures are exactly the known-environmental files (`skill-recipe-shell`, `pty-runtime-hidden-at-spawn-mark`, `orchestration-cli-subprocess`, `mobile-web-app-session-terminal-init`); the new real-agent-home write guard ran as the first vitest setup file across the whole union with no violation; `tc:node` / `tc:cli` / `tc:web` PASS; changed-code quality PASS; all 262 sidecar extras PASS (the UPSTREAM-1 provenance pins hold on main); full lint PASS (81 s). Raw `OVERALL=FAIL` is the known set only → **merged tree accepted**.
