# M3-08f step 0 — Claude headless isolation probe (verifier, 2026-10-28)

Question: what does a headless `claude -p --output-format stream-json` load from `CLAUDE_CONFIG_DIR` and from the repository under the isolation flags, and which flag can lock it down in a way the model cannot undo? Needed before writing the M3-08f brief (D83: Mission launches inherit nothing by default) and for the `launch_mismatch` rules that gate `claude` certification (D57).

Method (`.axiom-work/tmp/probe-claude-isolation.sh`, launcher `launchers/probe-claude-isolation.command`; read-only for the user): a throwaway config dir and git repo under `/tmp/axsm/claude-probe-<ts>` (removed afterwards), `env -i` with a fake `HOME`, no credentials, `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` on a dead local port, the M3-08b egress env pins. `system/init` is emitted before authentication and before any network request, so the loaded surfaces are observable without a login. Planted: user tier (`<config>/skills/axiom-probe-skill`, `commands/axiom-probe-command.md`, `agents/axiom-probe-agent.md`, a `SessionStart` hook in `settings.json`, an MCP server in `.claude.json`); repo tier (`.claude/skills/repo-probe-skill`, `.claude/commands`, `.claude/agents`, a hook in `.claude/settings.json`, `.mcp.json`, `CLAUDE.md`). Each variant: `-p "reply with the single word ok" --output-format stream-json --verbose --max-turns 1 <flags>`.

Hosts: Henry's Mac, `/Users/henry/.local/bin/claude` **2.1.309** (`.axiom-work/logs/claude-isolation-probe-20261028-045926.txt`), and the verifier's container, 2.1.312 — identical outcomes on every variant.

| Variant | Flags | Planted user/repo skills, agents, commands | Hooks ran | `mcp_servers` | Residue in `init` |
|---|---|---|---|---|---|
| v1 control | none | all loaded (`axiom-probe-*`, `repo-probe-*`) | both (`axiom-probe-hook`, `repo-probe-hook`) | both (`source: user`, `source: project`) | bundled skills (`deep-research`, `dataviz`, …), builtin plugins `cc-plugin-agents-md`, `cc-plugin-plugin-authoring` |
| v2 | `--setting-sources=` | none | none | `[]` | bundled skills, builtin plugins |
| v3 M3-08b pins | `--setting-sources= --strict-mcp-config --settings '{"syncClaudeAiSkills":false,"syncClaudeAiPlugins":false,"enabledPlugins":{}}'` | none | none | `[]` | same as v2 |
| v4 = v3 + `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` | | none | none | `[]` | skills `doctor`, `plugin-authoring`; builtin plugins |
| v5 | `--managed-settings '{"strictPluginOnlyCustomization":true,"disableAllHooks":true,"disableSkillShellExecution":true,"disableClaudeAiConnectors":true,"disableRemoteControl":true,"isolatePeerMachines":true,"permissions":{"disableBypassPermissionsMode":"disable"}}'` (default setting sources) | none | none | `[]` | bundled skills; builtin plugins + `cc-plugin-sec-default` |
| v6 | `--managed-settings /path/managed.json` (same two keys as a file) | **all loaded** — the file form is silently ignored | both | both | as v1 |
| v7 | `--safe-mode` | none | none | `[]` | bundled skills, builtin plugins; `memory_paths: null` |
| v8 | `--restricted --setting-sources= --strict-mcp-config` | none | none | `[]` | as v2; `Bash`, `WebFetch`, `CronCreate` removed from `tools`, `Glob`/`Grep` listed |

Findings used by the M3-08f brief:

1. `--setting-sources=` (empty) is the load-bearing isolation: it excludes the user tier **and** the repo tier — skills, agents, commands, hooks and MCP (`.claude.json`, `.mcp.json`) — on both versions. The surfaces Orca's account refresh links from `~/.claude` are invisible to a Mission launch.
2. `--managed-settings` works only as inline JSON; the file-path form is ignored without any message. `--help` does not list the flag on either version. The pinned SDK 0.3.284 serializes `Options.managedSettings` (object) to the same argv. The policy tier adds the builtin plugin `cc-plugin-sec-default`.
3. A clean launch reports the harness's own items: plugins with `path: "builtin"` and, with bundled skills disabled by env, the skills `doctor` and `plugin-authoring`. `disableBundledSkills` in managed settings does not hide the bundled skills; the env does. M3-08b's mismatch rules count all of these as unexpected → `launchBaseline` (M3-08f deliverable 5).
4. `--safe-mode` is not stronger than the empty setting sources for this purpose; `--bare` is API-key only (never reads OAuth/Keychain) and is excluded for subscriptions; `--restricted` is a tool-level tightening left to M3-10.
5. On the Mac every variant exited within a second (rc=1 after the refused API call); in the container the CLI retried the API call until the 25 s alarm — same `init` either way.
