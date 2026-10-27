import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStructuredCodexAccountKind } from './structured-agent-account-home'
import { getSystemCodexHomePath, resolveOrcaManagedCodexHomePath } from '../codex/codex-home-paths'
import type { CodexManagedAccount } from '../../shared/managed-account-types'
const ACCOUNT: CodexManagedAccount = {
  id: 'account-a',
  email: 'example@example.test',
  managedHomePath: '/accounts/a/home',
  managedHomeRuntime: 'host',
  createdAt: 0,
  updatedAt: 0,
  lastAuthenticatedAt: 0
}
const SETTINGS = { codexManagedAccounts: [ACCOUNT], activeCodexManagedAccountId: 'account-a' }
afterEach(() => vi.restoreAllMocks())
describe('Codex sign-in instructions follow the probed home', () => {
  it('recognizes a pinned managed account after the current selection changes', () => {
    expect(
      resolveStructuredCodexAccountKind(ACCOUNT.managedHomePath, {
        ...SETTINGS,
        activeCodexManagedAccountId: null
      })
    ).toBe('managed')
  })
  it.each([
    ['darwin', undefined],
    ['linux', undefined],
    ['win32', 'system']
  ] as const)('classifies the system home on %s', (platform, kind) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    expect(resolveStructuredCodexAccountKind(getSystemCodexHomePath(), SETTINGS)).toBe(kind)
  })
  it.each([
    ['darwin', 'account-a', undefined],
    ['darwin', null, undefined],
    ['linux', 'account-a', undefined],
    ['linux', null, undefined],
    ['win32', 'account-a', 'managed'],
    ['win32', null, 'system']
  ] as const)(
    'classifies the shared mirror on %s with selection=%s',
    (platform, activeCodexManagedAccountId, kind) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      expect(
        resolveStructuredCodexAccountKind(resolveOrcaManagedCodexHomePath(), {
          ...SETTINGS,
          activeCodexManagedAccountId
        })
      ).toBe(kind)
    }
  )
  it('does not infer a managed account from a custom or WSL home', () => {
    expect(resolveStructuredCodexAccountKind('/custom/home', SETTINGS)).toBeUndefined()
    expect(
      resolveStructuredCodexAccountKind(ACCOUNT.managedHomePath, {
        ...SETTINGS,
        codexManagedAccounts: [{ ...ACCOUNT, managedHomeRuntime: 'wsl' }]
      })
    ).toBeUndefined()
  })
})
