import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import { CLAUDE_SESSION_OPTION_CATALOG } from '../../../shared/agent-session-option-catalog-claude-codex'
import { certifiedCombo } from '../agent-factory/certified-providers'
import { claudeManagedSettingsSha256 } from './claude-launch-policy'
import type { AxiomStore } from '../db/axiom-store'
import { redactContext } from '../context-builder/redaction'
import { claudeWorkerVersion } from './claude-worker-version'
import type { prepareClaudeAttemptFiles } from './headless-attempt-files'
import type { ClaudeInit } from './claude-worker-events'

export async function headlessClaudeCombination(input: {
  spec: AgentSpec
  homePath: string
  allowlist: { skills: string[]; mcpServers: string[] }
  command: string
  files: Awaited<ReturnType<typeof prepareClaudeAttemptFiles>>
  platform?: NodeJS.Platform
}) {
  const { spec, homePath, allowlist, files } = input
  const surfaces = await Promise.all(
    [
      'skills',
      'commands',
      'agents',
      'plugins',
      'hooks',
      'settings.json',
      '.claude.json',
      '.mcp.json'
    ].map(async (name) => {
      const entry = await lstat(join(homePath, name)).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return null
        }
        throw error
      })
      // Inspect the directory entry only: no link targets, children or file contents.
      const kind: 'dir' | 'file' | 'link' | 'absent' = !entry
        ? 'absent'
        : entry.isSymbolicLink()
          ? 'link'
          : entry.isDirectory()
            ? 'dir'
            : 'file'
      return { name, kind }
    })
  )
  const reasons = files.missingMcpServers.map((name) => `mcp_server_missing:${name}`)
  const harnessVersion = await claudeWorkerVersion(input.command)
  if (harnessVersion === null) {
    reasons.push('harness_version_unknown')
  }
  const platform = input.platform ?? process.platform
  const launchBaseline = certifiedCombo('claude')?.launchBaseline ?? null
  return {
    combination: {
      requested: {
        harness: 'claude',
        channel: 'headless',
        model: spec.model,
        effort: spec.reasoning.effort,
        claudeConfigDir: 'selected-account',
        allowlist: { skills: [], mcpServers: allowlist.mcpServers },
        policyTier: 'axiom',
        launchBaseline: launchBaseline
          ? { ...launchBaseline, skills: [...launchBaseline.skills] }
          : null,
        settingSources: [],
        syncedSkills: 'off',
        bundledSkills: 'off',
        plugins: 'off',
        mcp: 'strict',
        ...(spec.selection.crossProvider ? { crossProvider: spec.selection.crossProvider } : {})
      },
      effective: {
        harnessVersion,
        claudeConfigDir: { kind: 'account', path: homePath },
        credentials: platform === 'darwin' ? 'keychain' : platform === 'linux' ? 'file' : 'unknown',
        settingsSha256: files.settingsSha256,
        mcpConfigSha256: files.mcpConfigSha256,
        managedSettingsSha256: claudeManagedSettingsSha256('worker'),
        accountHome: { surfaces }
      }
    },
    reasons
  }
}

const ObservationBaseline = z.object({
  requested: z.object({
    model: z.string(),
    launchBaseline: z
      .object({
        harnessVersion: z.string(),
        skills: z.array(z.string()),
        evidence: z.string()
      })
      .nullable()
      .optional(),
    allowlist: z.object({ skills: z.array(z.string()), mcpServers: z.array(z.string()) })
  }),
  effective: z.object({ harnessVersion: z.string().nullable() })
})
function modelMatches(requested: string, observed: string) {
  if (requested === 'policy-default' || requested === observed) {
    return true
  }
  // Catalog aliases resolve to an exact model in init; a different family still mismatches.
  return (
    CLAUDE_SESSION_OPTION_CATALOG.models.some((entry) => entry.id === requested) &&
    observed.startsWith(`claude-${requested}-`)
  )
}
export function claudeLaunchMismatches(
  init: ClaudeInit,
  baseline: z.infer<typeof ObservationBaseline>
): string[] {
  const { requested, effective } = baseline
  const version = (value: string) => value.replace(/\s*\(Claude Code\)\s*$/, '').trim()
  const observedVersion = init.claude_code_version ? version(init.claude_code_version) : null
  const skills = new Set([
    ...requested.allowlist.skills,
    ...(requested.launchBaseline?.skills ?? [])
  ])
  return [
    ...init.skills.filter((name) => !skills.has(name)).map((name) => `skill_unexpected:${name}`),
    ...init.plugins
      .filter(({ path }) => path !== 'builtin')
      .map(({ name }) => `plugin_unexpected:${name}`),
    ...init.mcp_servers
      .filter(({ name }) => !requested.allowlist.mcpServers.includes(name))
      .map(({ name }) => `mcp_server_unexpected:${name}`),
    ...(init.permissionMode !== 'acceptEdits' ? ['permission_mode_unexpected'] : []),
    ...(!modelMatches(requested.model, init.model) ? ['model_unexpected'] : []),
    ...(init.claude_code_version &&
    effective.harnessVersion &&
    version(init.claude_code_version) !== version(effective.harnessVersion)
      ? ['harness_version_changed']
      : []),
    ...(!requested.launchBaseline
      ? ['harness_baseline_missing']
      : observedVersion && observedVersion !== requested.launchBaseline.harnessVersion
        ? [`harness_baseline_stale:${observedVersion}`]
        : [])
  ]
}

export function recordClaudeLaunchObservation(
  store: AxiomStore,
  missionId: string,
  attemptId: string,
  init: ClaudeInit
) {
  store.transaction('claude_launch_observation', () => {
    const audits = store
      .listAuditEvents({ missionId })
      .filter((event) => event.objectId === attemptId)
    if (audits.some((event) => event.event === 'attempt.launch_observed')) {
      return
    }
    const prepared = audits.find((event) => event.event === 'attempt.headless_prepared')
    const parsed = z.object({ combination: ObservationBaseline }).safeParse(prepared?.after)
    if (!parsed.success) {
      return
    }
    const common = {
      missionId,
      actor: 'AttemptLauncher',
      objectKind: 'attempt',
      objectId: attemptId,
      before: null
    }
    const observed = {
      harnessVersion: init.claude_code_version ?? null,
      model: init.model,
      permissionMode: init.permissionMode,
      skills: init.skills,
      plugins: init.plugins,
      mcpServers: init.mcp_servers,
      apiKeySource: init.apiKeySource ?? null
    }
    store.appendAuditEvent({
      ...common,
      event: 'attempt.launch_observed',
      after: z.json().parse(JSON.parse(redactContext(JSON.stringify(observed)).content))
    })
    const reasons = claudeLaunchMismatches(init, parsed.data.combination)
    if (reasons.length) {
      store.appendAuditEvent({
        ...common,
        event: 'attempt.launch_mismatch',
        after: { reasons: reasons.map((reason) => redactContext(reason).content) }
      })
    }
  })
}
