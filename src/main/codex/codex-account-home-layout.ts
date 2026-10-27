import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, readFileSync, readdirSync, readlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { createManagedCommandMatcher, type HookDefinition } from '../agent-hooks/installer-utils'
import { readHooksJsonWithRaw } from '../agent-hooks/hooks-json-read'
import { writeFileAtomicallyIfUnchanged } from '../codex-accounts/fs-utils'
import { applyCodexDaemonSocketGuard } from './codex-daemon-socket-path-guard'
import { CODEX_EVENTS, CODEX_EVENT_LABEL } from './codex-hook-definition'
import { getCodexManagedScriptFileName } from './codex-hook-identity'
import { isKnownOrcaHash, readSavedOrcaHashes } from './codex-hook-orca-hashes'
import { getRealHomeHookKeySourcePaths } from './codex-real-home-hooks-json'
import {
  CODEX_SYSTEM_RESOURCE_ENTRIES,
  getSystemCodexHomePath,
  removeSymlinkedResourceIfOwned
} from './codex-home-paths'
import {
  classifyHookTrustKey,
  getMcpServerTomlSectionName,
  getTomlSections,
  isRuntimePreservedTomlSection,
  isRuntimeProjectTomlSection,
  joinTomlBlocks
} from './config-toml-runtime-owned-sections'
import { escapeTomlBasicString, parseHookStateTomlHeaderKey } from './config-toml-syntax'
import { computeTrustKey, readHookTrustEntriesFromContent } from './config-toml-trust'

type Allowlist = GlobalSettings['codexAccountHomeAllowlist']
export type CodexAccountHomeManifest = {
  configSha256: string
  mcpServers: { name: string; sha256: string }[]
  missingMcpServers: string[]
  disabledSkills: string[]
  enabledUserSkills: string[]
  hookApprovals: string[]
  removedLinks: string[]
}

const sha256 = (contents: string): string => createHash('sha256').update(contents).digest('hex')
const quote = (value: string): string => `"${escapeTomlBasicString(value)}"`

/** D83 method A: one-way layout; auth, sessions, logs and state belong to Codex. */
export function layoutCodexAccountHome({
  homePath,
  allowlist,
  systemHomePath = getSystemCodexHomePath(),
  userHomePath = homedir()
}: {
  homePath: string
  allowlist: Allowlist
  systemHomePath?: string
  userHomePath?: string
}): CodexAccountHomeManifest {
  if (!lstatSync(homePath).isDirectory() || resolve(homePath) === resolve(systemHomePath)) {
    throw new Error('Codex account layout requires a separate directory')
  }
  const removedLinks = CODEX_SYSTEM_RESOURCE_ENTRIES.filter((entry) => {
    const target = join(homePath, entry)
    if (!statEntry(target)?.isSymbolicLink()) {
      return false
    }
    const source = resolve(homePath, readlinkSync(target))
    const tail = relative(resolve(systemHomePath), source)
    return (
      tail !== '..' &&
      !tail.startsWith('../') &&
      !isAbsolute(tail) &&
      removeSymlinkedResourceIfOwned(target, source)
    )
  })
  const configPath = join(homePath, 'config.toml')
  const hooksPath = join(homePath, 'hooks.json')
  // Why: the generic config/hook writers follow dotfile symlinks. Account layout must never do so.
  assertRegularFileOrAbsent(configPath)
  assertRegularFileOrAbsent(hooksPath)
  const previous = readOptionalFile(configPath)
  const snapshot = readHooksJsonWithRaw(hooksPath)
  if (!snapshot.config) {
    throw new Error('Cannot read Codex account hooks.json')
  }
  const { hooks, approvalKeys } = accountHooks(
    homePath,
    snapshot.config.hooks ?? {},
    previous ?? ''
  )
  const runtime = getTomlSections(previous ?? '').flatMap((section) => {
    if (!isRuntimePreservedTomlSection(section.header)) {
      return []
    }
    if (isRuntimeProjectTomlSection(section.header)) {
      return [section.block]
    }
    const key = parseHookStateTomlHeaderKey(section.header)
    const nextKey = key === null ? undefined : approvalKeys.get(key)
    return nextKey === undefined
      ? []
      : [section.block.replace(section.header, `[hooks.state.${quote(nextKey)}]`)]
  })
  const names = [...new Set(allowlist.mcpServers)].sort()
  // Why: an empty allowlist never even opens the system config, let alone its resources.
  const sourceSections = names.length
    ? getTomlSections(readOptionalFile(join(systemHomePath, 'config.toml')) ?? '')
    : []
  const servers = names.map((name) => ({
    name,
    contents: sourceSections
      .filter((section) => getMcpServerTomlSectionName(section.header) === name)
      .map((section) => (section.block.endsWith('\n') ? section.block : `${section.block}\n`))
      .join('')
  }))
  const { disabledSkills, enabledUserSkills } = userSkills(userHomePath, allowlist.skills)
  const generated =
    joinTomlBlocks([
      '# Written by Axiom (D83). Edits are replaced at the next layout.',
      'check_for_update_on_startup = false',
      ...runtime,
      '[features]\napps = false\nplugins = false\nremote_plugin = false',
      '[analytics]\nenabled = false',
      '[feedback]\nenabled = false',
      ...disabledSkills.map((skill) => `[[skills.config]]\npath = ${quote(skill)}\nenabled = false`)
    ]) + servers.map((server) => server.contents).join('')
  const config = applyCodexDaemonSocketGuard(generated, homePath)
  writeChanged(configPath, previous, config)
  if ((lstatSync(configPath).mode & 0o777) !== 0o600) {
    chmodSync(configPath, 0o600)
  }
  if (snapshot.raw !== null) {
    writeChanged(hooksPath, snapshot.raw, `${JSON.stringify({ hooks }, null, 2)}\n`)
  }
  const baseline = join(homePath, '.orca-config-settings-baseline.json')
  if (statEntry(baseline)?.isFile() || statEntry(baseline)?.isSymbolicLink()) {
    unlinkSync(baseline)
  }
  return {
    configSha256: sha256(config),
    mcpServers: servers
      .filter((server) => server.contents)
      .map((server) => ({ name: server.name, sha256: sha256(server.contents) })),
    missingMcpServers: servers.filter((server) => !server.contents).map((server) => server.name),
    disabledSkills,
    enabledUserSkills,
    hookApprovals: [...approvalKeys.values()].sort(),
    removedLinks
  }
}

function accountHooks(
  homePath: string,
  existing: Record<string, HookDefinition[]>,
  config: string
) {
  const keySourcePaths = getRealHomeHookKeySourcePaths(join(homePath, 'hooks.json'))
  const isOrca = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const states = readHookTrustEntriesFromContent(config)
  const hooks: Record<string, HookDefinition[]> = {}
  const approvalKeys = new Map<string, string>()
  for (const event of CODEX_EVENTS) {
    const groups: HookDefinition[] = []
    for (const [groupIndex, group] of (Array.isArray(existing[event])
      ? existing[event]
      : []
    ).entries()) {
      const kept = (Array.isArray(group.hooks) ? group.hooks : []).filter((hook) =>
        isOrca(hook.command)
      )
      if (!kept.length) {
        continue
      }
      for (const [handlerIndex, hook] of (group.hooks ?? []).entries()) {
        const nextHandler = kept.indexOf(hook)
        if (nextHandler === -1) {
          continue
        }
        const hashes = readSavedOrcaHashes(homePath, hook.command)
        for (const sourcePath of keySourcePaths) {
          const entry = {
            sourcePath,
            eventLabel: CODEX_EVENT_LABEL[event],
            command: hook.command,
            groupIndex,
            handlerIndex
          }
          const key = computeTrustKey(entry)
          if (
            classifyHookTrustKey(key, homePath) === 'home-scoped' &&
            isKnownOrcaHash(hashes, entry.eventLabel, states.get(key)?.trustedHash)
          ) {
            approvalKeys.set(
              key,
              computeTrustKey({ ...entry, groupIndex: groups.length, handlerIndex: nextHandler })
            )
          }
        }
      }
      groups.push({
        ...(typeof group.matcher === 'string' ? { matcher: group.matcher } : {}),
        hooks: kept
      })
    }
    if (groups.length) {
      hooks[event] = groups
    }
  }
  return { hooks, approvalKeys }
}

function userSkills(userHome: string, allowed: string[]) {
  const root = join(userHome, '.agents', 'skills')
  let names: string[]
  try {
    names = readdirSync(root).sort()
  } catch (error) {
    if (!isDefinitiveAbsence(error)) {
      throw error
    }
    names = []
  }
  const disabledSkills: string[] = []
  const enabledUserSkills: string[] = []
  for (const name of names) {
    const skill = resolve(root, name, 'SKILL.md')
    const entry = statEntry(skill)
    if (entry?.isFile() || entry?.isSymbolicLink()) {
      ;(allowed.includes(name) ? enabledUserSkills : disabledSkills).push(skill)
    }
  }
  return { disabledSkills, enabledUserSkills }
}

function statEntry(file: string) {
  try {
    return lstatSync(file)
  } catch (error) {
    if (!isDefinitiveAbsence(error)) {
      throw error
    }
    return null
  }
}

function assertRegularFileOrAbsent(file: string): void {
  const entry = statEntry(file)
  if (entry && !entry.isFile()) {
    throw new Error('Codex account layout refuses a non-regular configuration file')
  }
}

function readOptionalFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (!isDefinitiveAbsence(error)) {
      throw error
    }
    return null
  }
}

function writeChanged(file: string, previous: string | null, contents: string): void {
  if (
    previous !== contents &&
    !writeFileAtomicallyIfUnchanged(file, previous, contents, { mode: 0o600 })
  ) {
    throw new Error('Codex account configuration changed during layout; retry preparation')
  }
}
