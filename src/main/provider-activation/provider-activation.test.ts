import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { normalizeProviderActivations } from '../../shared/provider-activation'
import { isProviderActivated, recordProviderActivation } from './provider-activation'

describe('provider activation', () => {
  it('requires explicit profile evidence and preserves the first activation and sibling providers', () => {
    let settings: Pick<GlobalSettings, 'providerActivations'> = {}
    const updateSettings = vi.fn((updates: Partial<GlobalSettings>) => {
      settings = { ...settings, ...updates }
    })
    const store = { getSettings: () => settings, updateSettings }
    expect(isProviderActivated(settings, 'codex')).toBe(false)
    recordProviderActivation(store, 'codex', 'agent-launch')
    const first = settings.providerActivations?.codex
    recordProviderActivation(store, 'gh', 'integrations-recheck')
    recordProviderActivation(store, 'codex', 'settings-hook-install')
    expect(settings.providerActivations?.codex).toEqual(first)
    expect(isProviderActivated(settings, 'gh')).toBe(true)
    expect(isProviderActivated(settings, 'glab')).toBe(false)
    expect(updateSettings).toHaveBeenCalledTimes(2)
  })
  it.each([
    undefined,
    null,
    true,
    { codex: true },
    { codex: { activatedAt: 'bad', source: 'agent-launch' } },
    { codex: { activatedAt: '2026-10-10T00:00:00.000Z', source: 'startup' } },
    { unknown: { activatedAt: '2026-10-10T00:00:00.000Z', source: 'agent-launch' } }
  ])('fails closed for malformed persisted activation %j', (value) => {
    expect(normalizeProviderActivations(value)).toEqual({})
  })
})
