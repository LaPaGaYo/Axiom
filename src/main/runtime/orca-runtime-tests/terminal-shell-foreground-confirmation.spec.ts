import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime-test-mocks.spec'
import { store, syncSinglePty } from '../orca-runtime-test-fixtures.spec'
import { PTY_CONTROLLER_LIST_TIMEOUT_MS } from '../orca-runtime-postlude'

const controller = {
  write: () => true,
  kill: () => true,
  getForegroundProcess: async () => 'zsh'
}

describe('confirmTerminalShellForeground', () => {
  afterEach(() => vi.useRealTimers())

  it('returns false for an unknown handle without asking the controller', async () => {
    const confirmShellForeground = vi.fn(async () => true)
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({ ...controller, confirmShellForeground })
    await expect(runtime.confirmTerminalShellForeground('term_unknown')).resolves.toBe(false)
    expect(confirmShellForeground).not.toHaveBeenCalled()
  })

  it('returns false when the controller cannot confirm shell foreground', async () => {
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController(controller)
    syncSinglePty(runtime)
    const [terminal] = (await runtime.listTerminals()).terminals
    await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(false)
  })

  it.each([true, false])('returns the fresh controller proof: %s', async (confirmed) => {
    const confirmShellForeground = vi.fn(async () => confirmed)
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({ ...controller, confirmShellForeground })
    syncSinglePty(runtime)
    const [terminal] = (await runtime.listTerminals()).terminals
    await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(confirmed)
    expect(confirmShellForeground).toHaveBeenCalledExactlyOnceWith('pty-1')
  })

  it.each(['reject', 'throw'] as const)(
    'returns false when the controller fails: %s',
    async (mode) => {
      const confirmShellForeground = vi.fn(() => {
        if (mode === 'throw') {
          throw new Error('controller unavailable')
        }
        return Promise.reject(new Error('controller unavailable'))
      })
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({ ...controller, confirmShellForeground })
      syncSinglePty(runtime)
      const [terminal] = (await runtime.listTerminals()).terminals
      await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(false)
    }
  )

  it('returns false when confirmation exceeds the controller timeout', async () => {
    vi.useFakeTimers()
    const confirmShellForeground = vi.fn(() => new Promise<boolean>(() => {}))
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({ ...controller, confirmShellForeground })
    syncSinglePty(runtime)
    const [terminal] = (await runtime.listTerminals()).terminals
    const confirmation = runtime.confirmTerminalShellForeground(terminal.handle)
    await vi.advanceTimersByTimeAsync(PTY_CONTROLLER_LIST_TIMEOUT_MS + 1)
    await expect(confirmation).resolves.toBe(false)
    expect(confirmShellForeground).toHaveBeenCalledExactlyOnceWith('pty-1')
  })
})
