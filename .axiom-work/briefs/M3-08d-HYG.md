# Task M3-08d-HYG — align four kernel tests with D83 ruling ① (the system-default Codex account is retired on macOS / Linux); tests only

You are a Worker on the Axiom project (a product fork of stablyai/orca). Read `docs/decisions/DECISION_LOG.md` **D83** — ruling ① and its 2026-10-26 revision row (platform scope: the retirement applies on macOS / Linux hosts; Windows and WSL keep `null` = the system default). **Change test files only.** Do not fetch, pull, push or commit; leave your changes uncommitted and write your report to `.axiom-work/reports/M3-08d-HYG-<seq>.md`.

## Why

UPSTREAM-4b's full-suite run on the host (2026-11-11, `ORCA_BALANCE_UNIT_SHARDS=1 pnpm test`, main and candidate alike) found four kernel test files that have failed on main since M3-08d implemented D83 ① (2026-10-26/27). The repository gates run each Task's sidecar targets, not the full suite, so nothing reported them. The production behaviour is the decided one; these tests still describe the retired system default.

## Ground truth (verifier, 2026-11-11, main `f462856f7f`)

1. `src/main/codex-accounts/runtime-selection.ts` `refuseRetiredCodexSelection(accountId, target)` throws an `Error` whose message and `code` are `system_default_retired` when `accountId === null`, `process.platform !== 'win32'` and the target is not WSL (comment: "D83 ruling ①: null remains valid on Windows/WSL, including older clients").
2. `src/main/text-generation/commit-message-agent-environment.ts` `prepareLocalCommitMessageAgentEnv`: for agent `codex` on a non-Windows host outside WSL it returns `{ ok: false, error: 'No Codex account selected. Add a Codex account in Settings › Accounts.' }` when the resolvers have no `prepareForCodexLaunch`, and again when `prepareForCodexLaunch` returns no home. `src/main/codex/codex-home-paths.ts` defines an error class with the same message.
3. The failures (host, macOS, Bun runner):
   - `src/main/orcad/orcad-account-services.test.ts` — "serves accounts.* from this host": `accounts.selectCodex({ accountId: null })` rejects with `system_default_retired` where the test expects `{ activeAccountId: null }`. "resolves structured Codex launches to a client-sent home, else this host's selection": the empty-environment branch expects `null` ("null is the real ~/.codex").
   - `src/main/runtime/orca-runtime-git.test.ts` — "uses one-shot resolved params before runtime commit-message defaults", "uses one-shot resolved params before runtime pull-request defaults", "enriches the local commit context with the workspace linked issue", "prefers live meta over the linked issue projected onto the resolved worktree": each receives the "No Codex account selected" result. In the same file "prepares the selected local agent environment before generating commit messages" passes; it gives the runtime `prepareForCodexLaunch: () => '/managed/codex-home'`.
   - `src/main/runtime/orca-runtime-linked-issue-live-meta.integration.test.ts` — "substitutes the linked issue persisted since the last worktree resolution": the generator mock is never called (`mock.calls[0]` is undefined). Inferred, not traced: the same early return.
   - `src/main/ai-vault/structured-chat-cli-fork.test.ts` — "locates the current Codex rollout in its recorded home and materializes the selected home": `ENOENT` on `<tmp>/system/sessions/2026/10/15/rollout-2026-10-15-current-conversation.jsonl` inside `prepareStructuredChatCliFork`. Inferred, not traced: it goes through `prepareLegacySharedCodexSessionResume` and the system-home path that M3-08d changed. **Establish the actual cause before changing this test.**

## Scope

Only these four test files. If one of them needs a fixture change that lives in a test-support file used only by these tests, you may change it and must say why in the report. No production file, no other test, no `package.json`, lock file, `pnpm-workspace.yaml`, `config/**`, `mobile/**` or `src/renderer/**`; do not add dependencies; format only the files you change (never a `.md` file); use only this worktree's toolchain.

For every failing test keep what it was written to test:

1. A test that asserted the system-default behaviour on macOS / Linux asserts the D83 ① behaviour instead (the `system_default_retired` refusal, or the "No Codex account selected" result), under the same platform condition production uses, so the Windows / WSL expectation stays. Use the file's existing way of handling the platform if it has one; do not stub `process.platform` globally unless the file already does.
2. A test that only used Codex as the commit-message agent to test something else (parameter precedence, the linked issue) gets a managed home the way the passing test does, so it still tests that something else.
3. For `structured-chat-cli-fork.test.ts`: read `prepareStructuredChatCliFork` and `prepareLegacySharedCodexSessionResume` in full, find why the rollout is missing, and change the test to the current behaviour. If the production behaviour itself looks wrong (not a consequence of D83 ①), change nothing in that file, stop, and report it.

Test titles you add or rename contain no apostrophe (existing titles may stay as they are).

## Acceptance

- The four files pass under both runners: `pnpm test <the four files>` and `pnpm exec vitest run --config config/vitest.config.ts <the four files>` (if the sandbox blocks a runner, say exactly what it blocked).
- No production file changed; typecheck and lint pass (the launcher runs them).
- The report lists, per changed test: what it asserted before, what it asserts now, and the D83 ① reason; plus every command you ran with its result.
