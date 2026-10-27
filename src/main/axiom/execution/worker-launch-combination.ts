import { basename, dirname } from 'node:path'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { CodexWorkerLaunchHome } from '../../codex/codex-worker-launch-home'
import { fingerprintCodex, probeCodexVersion } from '../../codex/codex-hook-trust-derivation'
import { observeSkillPackage } from '../../skills/skill-package-identity'
export { headlessClaudeCombination } from './claude-worker-combination'

const versions = new Map<string, Promise<string | null>>()
async function harnessVersion(command: string): Promise<string | null> {
  const fingerprint = fingerprintCodex(command)
  if (!fingerprint) {
    return null
  }
  let version = versions.get(fingerprint)
  if (!version) {
    version = probeCodexVersion(command).catch(() => null)
    versions.set(fingerprint, version)
  }
  return version
}

export function tuiWorkerCombination(spec: AgentSpec) {
  return {
    requested: {
      harness: spec.provider,
      channel: 'tui',
      model: spec.model,
      effort: spec.reasoning.effort,
      ...(spec.selection.crossProvider ? { crossProvider: spec.selection.crossProvider } : {})
    },
    effective: null,
    adapter: 'none'
  }
}

export async function headlessWorkerCombination(
  spec: AgentSpec,
  home: CodexWorkerLaunchHome,
  allowlist: { skills: string[]; mcpServers: string[] },
  command: string
) {
  const requested = {
    harness: 'codex',
    channel: 'headless',
    model: spec.model,
    effort: spec.reasoning.effort,
    codexHome: 'selected-account',
    allowlist,
    hooks: 'off',
    ...(spec.selection.crossProvider ? { crossProvider: spec.selection.crossProvider } : {})
  }
  const version = await harnessVersion(command)
  if (home.kind === 'unmanaged') {
    return {
      combination: {
        requested,
        effective: { harnessVersion: version, codexHome: { kind: home.kind, path: home.homePath } }
      },
      reasons: []
    }
  }
  const { manifest } = home
  const userSkills = await Promise.all(
    manifest.enabledUserSkills.map(async (file) => {
      const path = dirname(file)
      return {
        name: basename(path),
        path,
        digest: (await observeSkillPackage(path)).observedDigest
      }
    })
  )
  const reasons = [
    ...manifest.missingMcpServers.map((name) => `mcp_server_missing:${name}`),
    ...[...new Set(allowlist.skills)]
      .filter((name) => !userSkills.some((skill) => skill.name === name))
      .map((name) => `skill_missing:${name}`),
    ...(version === null ? ['harness_version_unknown'] : []),
    ...(home.token === 'refresh_failed' ? ['token_refresh_failed'] : [])
  ]
  return {
    combination: {
      requested,
      effective: {
        harnessVersion: version,
        codexHome: { kind: home.kind, path: home.homePath },
        configSha256: manifest.configSha256,
        mcpServers: manifest.mcpServers,
        userSkills,
        disabledUserSkills: manifest.disabledSkills.length,
        hookApprovals: manifest.hookApprovals.length,
        token: home.token
      }
    },
    reasons
  }
}
