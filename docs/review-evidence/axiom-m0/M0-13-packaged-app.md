# M0 exit evidence — packaged desktop app (identity, archive contents, cold-start egress)

Status: **PASS** on the packaged macOS arm64 bundle — identity is Axiom's, `app.asar` contains only the five allowed root entries, and a 75-second foreground run of the packaged app under a recording proxy recorded **no network attempt to any non-loopback host**.

This complements `M0-08-egress-capture.md` (the headless e2e capture on the development build): the packaged app is what users run, and the e2e harness cannot observe a focused, visible window.

## Runs

| Run | Tree | Command | Log (gitignored, `.axiom-work/logs/`) | Result |
|---|---|---|---|---|
| Packaging A | main `ddb91bcdd` (after M0-12) | `launchers/pack-unpack.command` → `build:computer-macos` + `build:keyboard-layout-macos` + `build:notification-status-macos`, `pnpm run build:unpack` (electron-builder `--dir`, unsigned/ad-hoc) | `pack-unpack-20261016-003346.log` | bundle **895 MB**; `app.asar` 471,071,501 bytes with **15 root entries** — the pipeline tree (`.axiom-work/` 337 MB of logs), `launchers/`, `test-results/`, `.anti-slop-plugin/` and six tooling files were shipping (electron-builder's `files` is a deny-list; it ignores `.gitignore`). → task M0-13 |
| Egress capture A | packaged app from Packaging A | `launchers/e2e-packaged-egress.command` → `node .axiom-work/scripts/packaged-egress-capture.mjs dist/mac-arm64/Axiom.app 75` | `packaged-egress-20261016-003836.log` | `[egress-host-tally packaged] {}` — vendor hosts: none; non-loopback total: 0; app exited code 0 |
| Packaging B | candidate `a13675d04` (M0-13 attempt 1; merged to main as `7a7f17c3e`) | same as A | `pack-unpack-20261016-010021.log` | bundle **572 MB**; `[verify-packaged-app-asar-contents] OK — roots: LICENSE, NOTICE.md, out, package.json, resources`; `app.asar` 133,167,334 bytes, 5 roots, 4,424 entries, zero `.log` / `.axiom-work` / `launchers` / `test-results` / `.git` paths (independent header parse by the verifier) |

Host: macOS arm64, Node v24.21.0, pnpm 12.0.0, Electron 43.7.0, Apple Swift 6.4 (Xcode 26), git 2.54.0 (Apple Git-157).

## Identity of the packaged bundle (Packaging B, `dist/mac-arm64/Axiom.app`)

| Key | Value |
|---|---|
| `CFBundleIdentifier` | `com.lapagayo.axiom` |
| `CFBundleName` / `CFBundleDisplayName` / `CFBundleExecutable` | `Axiom` |
| `CFBundleShortVersionString` | `1.4.214` (upstream version line, unchanged until the first Axiom release Decision) |
| URL scheme | `axiom` |
| `NSAppleEventsUsageDescription` | "Axiom allows terminal-launched developer tools to automate local apps when you request it." (all six usage descriptions say Axiom — M0-12) |
| Helper bundle | `Contents/Resources/Axiom Computer Use.app`, id `com.lapagayo.axiom.computer-use`, display name `Axiom Computer Use` (executable inside the bundle still `orca-computer-use-macos` — identifiers kept by D-scope of M0-12) |
| Sibling helper executables | `orca-keyboard-layout`, `orca-notification-status` (names unchanged; hygiene backlog) |
| Signature | ad-hoc, linker-signed (unsigned build; release signing is out of M0 scope) |
| Vendor strings inside `app.asar` | `onorca.dev` 0, `posthog` 0, `stablyai` 2: (1) `NOTICE.md` attribution (required), (2) the mobile web bundle's `ProtocolBlockScreen` still links to `https://github.com/stablyai/orca/releases` and Orca's App Store listing (`mobile/src/components/ProtocolBlockScreen.tsx`; in the vendor-egress baseline; user-tapped link, not an automatic request) — hygiene backlog |

## Archive root contract (M0-13)

`config/scripts/verify-packaged-app-asar-contents.cjs` runs in electron-builder's `afterPack` and fails packaging unless the `app.asar` root is exactly `out`, `resources`, `package.json`, `LICENSE`, `NOTICE.md`, with no `.log`, `.axiom-work`, `launchers`, `test-results` or `.git` path anywhere in the header (unpacked entries included). The exclusions in `config/electron-builder.config.cjs` and the allow-list cross-reference each other; 25 unit tests cover the guard and the real `FileMatcher` behaviour (`out/mobile-web` stays packaged, D33a).

## Egress capture method (packaged app)

`.axiom-work/scripts/packaged-egress-capture.mjs` starts a loopback recording proxy (answers 502, drops CONNECT after 300 ms so the attempt is attributable), launches `Axiom.app/Contents/MacOS/Axiom` with `--proxy-server=127.0.0.1:<port>`, a throw-away `HOME` and user-data directory, `HTTP(S)_PROXY` / `ALL_PROXY` / `NODE_USE_ENV_PROXY=1` for the Node side and `NO_PROXY=localhost,127.0.0.1,::1`, keeps the app in the foreground (window shown, onboarding visible) for the requested number of seconds, then prints the per-host tally. Exit code 0 only when the tally is `{}`. Chromium's network stack and Node's `fetch`/`http` both honour the proxy; raw TCP from native helpers would not be captured (none are launched on a fresh profile — D37/D38).

## What this does and does not prove

- Proves: the shipped bundle carries Axiom's identity, nothing from the development pipeline, and makes no cold-start / idle / focused-window network attempt on a fresh profile for 75 s (covers the focused-window usage polling and `gh auth status` paths that the headless e2e could not observe).
- Does not prove: behaviour after a provider is activated (by design those paths open connections), Windows/Linux packaging (not built here), or anything about a signed/notarized release build.
