# M0 vendor-egress baseline notes

M0-10, based on `24225619072d5970ac75c5280810823731698c5b`. Each row covers one remaining non-test `src/**` path/needle pair (26 pairs). `.test.*` and `.spec.*` files are excluded; fixture and harness files without those suffixes remain listed. Counts are matched lines per needle, not network requests. These notes classify evidence only and do not exempt any file from the ratchet.

| Path | Needle | Why this is not egress | Later task? |
|---|---|---|---|
| `src/cli/handlers/account.ts` | `stablyai` | Comment cites upstream issue #10932 explaining CLI/runtime pairing. | No; retain provenance. |
| `src/main/cli/orca-cli-child-path.ts` | `stablyai` | Two comments cite upstream issue #7904 about Linux command and screen-reader compatibility. | Only with a separately scoped CLI compatibility review. |
| `src/main/codex/codex-app-server-session.ts` | `stablyai` | Comment cites upstream issue #10932 explaining runtime selection. | No; retain provenance. |
| `src/main/github/__fixtures__/work-item-search-metadata.json` | `stablyai` | Recorded GitHub issue URLs in search-result fixture data; no request is issued by this JSON. | No; preserve fixtures. |
| `src/main/observability/bundle.ts` | `posthog` | Comment distinguishes unguessable bundle IDs from historical telemetry identity. | Optional comment cleanup when observability documentation is revised. |
| `src/main/observability/index.ts` | `posthog` | Comment documents separation of diagnostic bundle identity from historical telemetry identity. | Optional comment cleanup; preserve the privacy invariant. |
| `src/main/observability/redactor.ts` | `posthog` | Comments describe removal of historical identity keys from local diagnostic bundles. | No behavior change; retain redaction protection, optionally refresh wording. |
| `src/main/orcad/orcad-profile-state-telemetry.ts` | `posthog` | Comment says the daemon publishes authority selection without importing the desktop telemetry client. | Optional comment cleanup for retired client terminology. |
| `src/main/runtime/push/__fixtures__/push-host-proof-vector.json` | `onorca.dev` | Fixed gateway-origin bytes in a cryptographic proof test vector, not runtime endpoint configuration. | No; preserve the proof vector. |
| `src/main/runtime/push/__fixtures__/push-host-proof-vector.json` | `orca.dev` | Same proof-vector origin; this substring matches the longer hostname too. | No; preserve the proof vector. |
| `src/main/runtime/structured-worker-child-identity-env.ts` | `stablyai` | Comment cites upstream issue #7904 for Linux command compatibility. | Only with a separately scoped CLI compatibility review. |
| `src/main/startup/configure-process.ts` | `stablyai` | Comment cites upstream issue #829 explaining GUI PATH hydration. | No; retain provenance. |
| `src/main/startup/hydrate-shell-path.ts` | `stablyai` | Comment cites upstream issue #829 explaining shell PATH probing. | No; retain provenance. |
| `src/main/telemetry/burst-cap.ts` | `posthog` | Historical comment explains the event-count ceiling; no sink or destination is defined here. | Optional comment cleanup; retain the local burst cap. |
| `src/renderer/src/components/settings/local-network-connection-history.ts` | `orca.dev` | Substring of the persisted localStorage key `orca.developer-permissions.local-network-last-success.v1`, not a hostname or URL. | No casual rename; a future storage migration would need compatibility handling. |
| `src/renderer/src/components/sidebar/worktree-list-groups-test-fixtures.ts` | `stablyai` | Synthetic GitHub project identity used by sidebar tests. | No; preserve fixtures. |
| `src/renderer/src/store/slices/github-slice-test-harness.ts` | `stablyai` | Synthetic project/provider identities in the GitHub slice test harness. | No; preserve fixtures. |
| `src/shared/__fixtures__/cli-runtime-pairing-allowlist.txt` | `stablyai` | Comment cites upstream issue #10932 explaining a native-module runtime constraint. | No; retain compatibility evidence. |
| `src/shared/feedback-image-limits.ts` | `onorca.dev` | Comment records the historical feedback service's request-size limit; the module defines local image limits, not a request. | Refresh rationale only when a replacement feedback service is approved. |
| `src/shared/feedback-image-limits.ts` | `orca.dev` | Same historical size-limit comment, also matching the shorter needle. | Refresh rationale only when a replacement feedback service is approved. |
| `src/shared/github/project-types.ts` | `stablyai` | JSDoc example of `nameWithOwner`, not an endpoint default. | Optional neutral-example cleanup in a later documentation task. |
| `src/shared/mobile-relay-pairing-fixtures.ts` | `onorca.dev` | Fixed pairing URLs and malformed variants used by pairing validation tests. | No; preserve fixtures. |
| `src/shared/mobile-relay-pairing-fixtures.ts` | `orca.dev` | Same pairing-test data, also matching the shorter hostname needle. | No; preserve fixtures. |
| `src/shared/node-cli-command-resolution.ts` | `stablyai` | Two comments cite upstream issue #10932 explaining binary/runtime pairing. | No; retain provenance. |
| `src/shared/tui-agent-config.ts` | `stablyai` | Comment cites upstream PR #926 explaining Claude prefill behavior. | No; retain provenance. |
| `src/shared/workspace-session-partition-owner.ts` | `stablyai` | Comment cites upstream issue #12723 explaining canonical session-partition ownership. | No; retain provenance. |

The scoped cleanup reduces the baseline from 434 to **430 path/needle pairs**, not 400. The 12 tile URLs and five workflow URLs remove **34 matched needle-lines across four pairs** (`onorca.dev` and its substring `orca.dev` in two files). The package metadata removes two `stablyai` matches but leaves that pair because the existing `@stablyai/playwright-test` dependency remains out of scope. The scanner reports no new pairs or count increases. Reducing to 400 pairs would require unrelated changes and is not justified by this hygiene task.
