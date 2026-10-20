import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { getManagedCommand, getManagedScriptPath } from './codex-hook-definition'
import { cleanupLegacySystemManagedHooks } from './codex-hook-legacy-cleanup'
import { getCodexHookTrustSignature } from './codex-hook-identity'
import {
  computeTrustKey,
  normalizeHookTrustKeyForLookup,
  upsertHookTrustEntriesInContent,
  type CodexTrustEntry
} from './config-toml-trust'
import {
  getCodexTrustGrantLedgerPath,
  readCodexTrustGrantLedgerHome,
  writeCodexTrustGrantLedgerHome
} from './codex-trust-grant-ledger'
import { setupCodexHookHomes } from './hook-service-test-harness'
import { _internals as rebaseInternals } from './codex-user-hook-trust-rebase'
import { CodexHookService } from './hook-service'

const { getPathMock, homedirMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>(),
  homedirMock: vi.fn<() => string>()
}))
vi.mock('electron', () => ({ app: { getPath: getPathMock } }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof Os>()),
  homedir: homedirMock
}))

const homes = setupCodexHookHomes(homedirMock, getPathMock)
afterEach(() => vi.restoreAllMocks())

function seedCurrentGrant(): { hooksPath: string; tomlPath: string; entry: CodexTrustEntry } {
  const home = join(homes.tmpHome, '.codex')
  mkdirSync(home, { recursive: true })
  const hooksPath = join(home, 'hooks.json')
  const tomlPath = join(home, 'config.toml')
  const entry: CodexTrustEntry = {
    sourcePath: hooksPath,
    eventLabel: 'stop',
    groupIndex: 0,
    handlerIndex: 0,
    command: getManagedCommand(getManagedScriptPath()),
    timeoutSec: 10,
    trustedHash: 'hash-granted-to-another-instance'
  }
  writeCodexTrustGrantLedgerHome(home, {
    binary: null,
    entries: {
      [normalizeHookTrustKeyForLookup(computeTrustKey(entry))]: {
        signature: getCodexHookTrustSignature(entry),
        trustedHash: entry.trustedHash!
      }
    }
  })
  writeFileSync(tomlPath, upsertHookTrustEntriesInContent('# user config\n', [entry]))
  return { hooksPath, tomlPath, entry }
}

describe('legacy system-home hook sweep', () => {
  it.each([true, false])(
    'explicit service opt-out removes recorded trust with entry present=%s',
    async (present) => {
      const { hooksPath, tomlPath, entry } = seedCurrentGrant()
      const user = { hooks: [{ type: 'command', command: 'user-hook' }] }
      writeFileSync(
        hooksPath,
        JSON.stringify({
          hooks: {
            Stop: present
              ? [{ hooks: [{ type: 'command', command: entry.command, timeout: 10 }] }]
              : [user]
          }
        })
      )

      expect((await new CodexHookService().remove()).state).toBe('not_installed')

      expect(readFileSync(tomlPath, 'utf8')).not.toContain(entry.trustedHash)
      expect(readCodexTrustGrantLedgerHome(join(homes.tmpHome, '.codex'))).toBeNull()
      if (!present) {
        expect(JSON.parse(readFileSync(hooksPath, 'utf8')).hooks.Stop).toEqual([user])
      }
    }
  )

  it('leaves a save made during a failed legacy trust rebase as found', async () => {
    const { hooksPath } = seedCurrentGrant()
    writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: 'command', command: '/bin/sh "/old/agent-hooks/codex-hook.sh"' }] },
            { hooks: [{ type: 'command', command: 'user-hook' }] }
          ]
        }
      })
    )
    const saved = '{"hooks":{"Stop":[{"command":"saved-during-repair"}]}}\n'
    rebaseInternals.setSessionRunner(async (request) => {
      if (request.operation === 'inspect-user-hook-trust') {
        return {
          outcome: 'inspected',
          moves: request.moves.map((move) => ({
            ...move,
            reportedOldKey: move.oldKey,
            wasTrusted: true,
            enabled: true
          }))
        }
      }
      writeFileSync(hooksPath, saved)
      throw new Error('repair transport failed')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(cleanupLegacySystemManagedHooks()).rejects.toThrow('repair transport failed')

    expect(readFileSync(hooksPath, 'utf8')).toBe(saved)
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[codex-real-home-hooks] hooks.json changed during the trust session; leaving it as found',
      { path: hooksPath }
    )
  })

  it.each(['#1019', '#1536'])(
    'current shared entry survives with its trust while %s retired trust is removed',
    async (form) => {
      const { hooksPath, tomlPath, entry } = seedCurrentGrant()
      const script = '/other/orca/agent-hooks/codex-hook.sh'
      const retiredCommand =
        form === '#1019'
          ? `/bin/sh "${script}"`
          : `if [ -x '${script}' ]; then /bin/sh '${script}'; fi`
      const current = { hooks: [{ type: 'command', command: entry.command, timeout: 10 }] }
      const user = { matcher: 'user-*', hooks: [{ type: 'command', command: 'user-hook' }] }
      const retained = { hooks: { Stop: [current, user] }, _managed: { user: [1] } }
      const retired = { hooks: [{ type: 'command', command: retiredCommand }] }
      writeFileSync(
        hooksPath,
        `${JSON.stringify({ ...retained, hooks: { Stop: [current, user, retired] } }, null, 2)}\n`
      )
      const retainedToml = readFileSync(tomlPath, 'utf8')
      const retiredTrust = upsertHookTrustEntriesInContent('', [
        {
          ...entry,
          groupIndex: 2,
          command: retiredCommand,
          timeoutSec: undefined,
          trustedHash: undefined
        }
      ])
      writeFileSync(tomlPath, retainedToml + retiredTrust.trimStart())
      const ledger = readFileSync(getCodexTrustGrantLedgerPath(), 'utf8')
      rebaseInternals.setSessionRunner(async (request) =>
        request.operation === 'inspect-user-hook-trust'
          ? {
              outcome: 'inspected',
              moves: request.moves.map((move) => ({
                ...move,
                reportedOldKey: move.oldKey,
                wasTrusted: true,
                enabled: true
              }))
            }
          : { outcome: 'repaired', repaired: request.moves.length }
      )

      await cleanupLegacySystemManagedHooks()

      expect(readFileSync(hooksPath, 'utf8')).toBe(`${JSON.stringify(retained, null, 2)}\n`)
      expect(readFileSync(tomlPath, 'utf8')).toBe(retainedToml)
      expect(readFileSync(getCodexTrustGrantLedgerPath(), 'utf8')).toBe(ledger)
    }
  )

  it.each([null, '{}\n', '{"hooks":{}}\n', '{invalid'])(
    'never cleans recorded trust or the ledger when hooks.json is %s',
    async (raw) => {
      const { hooksPath, tomlPath } = seedCurrentGrant()
      if (raw !== null) {
        writeFileSync(hooksPath, raw)
      }
      const toml = readFileSync(tomlPath, 'utf8')
      const ledger = readFileSync(getCodexTrustGrantLedgerPath(), 'utf8')

      await cleanupLegacySystemManagedHooks()

      expect(readFileSync(tomlPath, 'utf8')).toBe(toml)
      expect(readFileSync(getCodexTrustGrantLedgerPath(), 'utf8')).toBe(ledger)
    }
  )
})
