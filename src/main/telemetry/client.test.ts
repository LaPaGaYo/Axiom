import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { net } from 'electron'
import { _getBurstCapStateForTests } from './burst-cap'
import { _setShuttingDownForTests, track, trackAppOpenedOnce } from './client'
import { cleanupTelemetryClientTest, setupTelemetryClientTest } from './client-test-harness'

vi.mock('electron', () => ({ net: { fetch: vi.fn(), request: vi.fn() } }))

describe('track()', () => {
  beforeEach(() => {
    setupTelemetryClientTest()
  })
  afterEach(cleanupTelemetryClientTest)

  it('has no SDK imports anywhere in the telemetry modules', () => {
    const directory = join(process.cwd(), 'src/main/telemetry')
    const sources = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)
    )
    for (const entry of sources) {
      const source = readFileSync(join(entry.parentPath, entry.name), 'utf8')
      expect(source, entry.name).not.toMatch(
        /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]posthog-node['"]/
      )
    }
  })

  it('drops valid events without touching Electron net, fetch, or timers', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const interval = vi.spyOn(globalThis, 'setInterval')
    const immediate = vi.spyOn(globalThis, 'setImmediate')
    track('workspace_created', { source: 'command_palette', from_existing_branch: true })
    expect(net.fetch).not.toHaveBeenCalled()
    expect(net.request).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(immediate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(_getBurstCapStateForTests().perSessionCount).toBe(1)
  })

  it('warns on invalid payloads before consuming burst tokens, with the existing warning limit', () => {
    const malformed = {
      error_class: 'unknown',
      agent_kind: 'claude-code',
      error_message: 'leaked message'
    } as const
    track('agent_error', malformed)
    track('agent_error', malformed)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[telemetry] agent_error: <root>:')
    )
    expect(_getBurstCapStateForTests().perSessionCount).toBe(0)
    vi.advanceTimersByTime(60_000)
    track('agent_error', malformed)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('validates even when consent is disabled', () => {
    vi.stubEnv('DO_NOT_TRACK', '1')
    const malformed = { error_class: 'unknown', agent_kind: 'claude-code', extra: true } as const
    track('agent_error', malformed)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('respects the shutdown gate', () => {
    _setShuttingDownForTests(true)
    track('app_opened', {})
    expect(_getBurstCapStateForTests().perSessionCount).toBe(0)
  })

  it('enforces the per-event burst cap', () => {
    for (let i = 0; i < 50; i++) {
      track('app_opened', {})
    }
    expect(_getBurstCapStateForTests().perSessionCount).toBe(30)
    expect(console.warn).toHaveBeenCalledWith(
      "[telemetry] per-event burst cap hit for 'app_opened'; dropping further events"
    )
  })

  it('enforces the per-session ceiling without scheduling a timer', () => {
    for (let i = 0; i < 1500; i++) {
      vi.advanceTimersByTime(10_000)
      track('app_opened', {})
    }
    expect(_getBurstCapStateForTests().perSessionCount).toBe(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('processes app_opened at most once per session', () => {
    trackAppOpenedOnce()
    trackAppOpenedOnce()
    expect(_getBurstCapStateForTests().perSessionCount).toBe(1)
  })
})
