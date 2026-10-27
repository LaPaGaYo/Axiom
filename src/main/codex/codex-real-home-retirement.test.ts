import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { retireCodexRealHome } from './codex-real-home-retirement'
import { getCodexManagedScriptFileName } from './codex-hook-identity'

const roots: string[] = []
beforeEach(() => vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin'))
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex-retirement-'))
  roots.push(root)
  const userHome = join(root, 'user')
  const userData = join(root, 'app')
  const system = join(userHome, '.codex')
  const home = join(userData, 'codex-accounts', 'a', 'home')
  mkdirSync(join(system, 'sessions'), { recursive: true })
  mkdirSync(join(home, 'sessions'), { recursive: true })
  writeFileSync(join(home, '.orca-managed-home'), 'a\n')
  let done = false
  const settings = {
    codexManagedAccounts: [{ id: 'a', managedHomePath: home }],
    get codexRealHomeCleanupDone() {
      return done
    }
  }
  const store = {
    getSettings: () => settings,
    updateSettings: () => {
      done = true
    }
  }
  return { root, userHome, userData, system, home, store }
}
it('backs up hooks, removes only owned entries, leaves approvals and the user side of hardlinks intact, once', () => {
  const f = fixture()
  const managed = {
    type: 'command',
    command: `/app/agent-hooks/${getCodexManagedScriptFileName()}`
  }
  const user = { type: 'command', command: 'echo user' }
  const raw = JSON.stringify({ description: 'keep', hooks: { Stop: [{ hooks: [managed, user] }] } })
  writeFileSync(join(f.system, 'hooks.json'), raw)
  writeFileSync(join(f.system, 'config.toml'), '[hooks.state.keep]\nenabled = true\n')
  const source = join(f.system, 'sessions', 'source.jsonl')
  writeFileSync(source, 'session')
  linkSync(source, join(f.home, 'sessions', 'alias.jsonl'))
  writeFileSync(join(f.home, 'sessions', 'own.jsonl'), 'session')
  symlinkSync(join(f.system, 'sessions'), join(f.home, 'sessions', 'external'))
  const audit = vi.spyOn(console, 'info').mockImplementation(() => {})
  retireCodexRealHome({ ...f, now: () => new Date('2026-10-01T00:00:00Z') })
  expect(JSON.parse(readFileSync(join(f.system, 'hooks.json'), 'utf8'))).toEqual({
    description: 'keep',
    hooks: { Stop: [{ hooks: [user] }] }
  })
  expect(readFileSync(join(f.system, 'config.toml'), 'utf8')).toBe(
    '[hooks.state.keep]\nenabled = true\n'
  )
  const backups = readdirSync(join(f.userData, 'codex-real-home-hooks'))
  expect(backups).toEqual(['hooks-2026-10-01T00-00-00.000Z.json'])
  expect(readFileSync(join(f.userData, 'codex-real-home-hooks', backups[0]), 'utf8')).toBe(raw)
  expect(readdirSync(join(f.home, 'sessions')).sort()).toEqual(['external', 'own.jsonl'])
  expect(readFileSync(source, 'utf8')).toBe('session')
  expect(statSync(source).nlink).toBe(1)
  expect(audit).toHaveBeenCalledWith('[codex-real-home-retirement]', {
    hooks: 'removed',
    unlinkedSessions: 1
  })
  writeFileSync(join(f.system, 'hooks.json'), raw)
  retireCodexRealHome(f)
  expect(readFileSync(join(f.system, 'hooks.json'), 'utf8')).toBe(raw)
  expect(audit).toHaveBeenCalledTimes(1)
  expect(f.store.getSettings().codexRealHomeCleanupDone).toBe(true)
})

it('does not modify hooks or mark completion when the backup cannot be created', () => {
  const f = fixture()
  const raw = JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            { type: 'command', command: `/app/agent-hooks/${getCodexManagedScriptFileName()}` }
          ]
        }
      ]
    }
  })
  writeFileSync(join(f.system, 'hooks.json'), raw)
  writeFileSync(join(f.userData, 'codex-real-home-hooks'), 'blocked')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  retireCodexRealHome(f)
  expect(readFileSync(join(f.system, 'hooks.json'), 'utf8')).toBe(raw)
  expect(f.store.getSettings().codexRealHomeCleanupDone).toBe(false)
  expect(warn).toHaveBeenCalledOnce()
})

it('does not run the cleanup or mark it complete on Windows', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const f = fixture()
  const audit = vi.spyOn(console, 'info').mockImplementation(() => {})
  retireCodexRealHome(f)
  expect(f.store.getSettings().codexRealHomeCleanupDone).toBe(false)
  expect(audit).not.toHaveBeenCalled()
})
it.each(['absent', 'unreadable', 'invalid'] as const)(
  'records nothing to do for %s hooks',
  (mode) => {
    const f = fixture()
    if (mode === 'unreadable') {
      writeFileSync(join(f.system, 'hooks.json'), '{}')
      chmodSync(join(f.system, 'hooks.json'), 0o000)
    }
    if (mode === 'invalid') {
      writeFileSync(join(f.system, 'hooks.json'), '{')
    }
    const audit = vi.spyOn(console, 'info').mockImplementation(() => {})
    retireCodexRealHome(f)
    expect(f.store.getSettings().codexRealHomeCleanupDone).toBe(true)
    expect(audit).toHaveBeenCalledWith('[codex-real-home-retirement]', {
      hooks: 'nothing_to_do',
      unlinkedSessions: 0
    })
  }
)
