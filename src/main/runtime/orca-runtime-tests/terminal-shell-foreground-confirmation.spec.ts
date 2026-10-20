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
    const confirmForegroundProcess = vi.fn(async () => 'zsh')
    const getForegroundProcess = vi.fn(async () => 'zsh')
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({ ...controller, confirmForegroundProcess, getForegroundProcess })
    await expect(runtime.confirmTerminalShellForeground('term_unknown')).resolves.toBe(false)
    expect(confirmForegroundProcess).not.toHaveBeenCalled()
    expect(getForegroundProcess).not.toHaveBeenCalled()
  })

  it('returns false without a controller', async () => {
    const runtime = new OrcaRuntimeService(store)
    syncSinglePty(runtime)
    const [terminal] = (await runtime.listTerminals()).terminals
    await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(false)
  })

  it.each(['zsh', '-zsh', 'bash', 'powershell.exe'])(
    'confirms a fresh shell foreground name: %s',
    async (name) => {
      const confirmForegroundProcess = vi.fn(async () => name)
      const getForegroundProcess = vi.fn(async () => 'node')
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({ ...controller, confirmForegroundProcess, getForegroundProcess })
      syncSinglePty(runtime)
      const [terminal] = (await runtime.listTerminals()).terminals
      await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(true)
      expect(confirmForegroundProcess).toHaveBeenCalledExactlyOnceWith('pty-1')
      expect(getForegroundProcess).not.toHaveBeenCalled()
    }
  )

  it.each(['node', 'codex', 'claude', 'wsl.exe', null, '', '   '])(
    'rejects a foreground result without shell proof: %s',
    async (name) => {
      const confirmForegroundProcess = vi.fn(async () => name)
      const getForegroundProcess = vi.fn(async () => 'zsh')
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({ ...controller, confirmForegroundProcess, getForegroundProcess })
      syncSinglePty(runtime)
      const [terminal] = (await runtime.listTerminals()).terminals
      await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(false)
      expect(confirmForegroundProcess).toHaveBeenCalledExactlyOnceWith('pty-1')
      expect(getForegroundProcess).not.toHaveBeenCalled()
    }
  )

  it('falls back to getForegroundProcess when fresh confirmation is unavailable', async () => {
    const getForegroundProcess = vi.fn(async () => 'zsh')
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({ ...controller, getForegroundProcess })
    syncSinglePty(runtime)
    const [terminal] = (await runtime.listTerminals()).terminals
    await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(true)
    expect(getForegroundProcess).toHaveBeenCalledExactlyOnceWith('pty-1')
  })

  it('ignores the recovery barrier owner when a non-shell process is foreground', async () => {
    const confirmForegroundProcess = vi.fn(async () => 'node')
    const confirmShellForeground = vi.fn(async () => true)
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({ ...controller, confirmForegroundProcess, confirmShellForeground })
    syncSinglePty(runtime)
    const [terminal] = (await runtime.listTerminals()).terminals
    await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(false)
    expect(confirmForegroundProcess).toHaveBeenCalledExactlyOnceWith('pty-1')
    expect(confirmShellForeground).not.toHaveBeenCalled()
  })

  it.each(['reject', 'throw'] as const)(
    'returns false when the controller fails: %s',
    async (mode) => {
      const confirmForegroundProcess = vi.fn(() => {
        if (mode === 'throw') {
          throw new Error('controller unavailable')
        }
        return Promise.reject(new Error('controller unavailable'))
      })
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({ ...controller, confirmForegroundProcess })
      syncSinglePty(runtime)
      const [terminal] = (await runtime.listTerminals()).terminals
      await expect(runtime.confirmTerminalShellForeground(terminal.handle)).resolves.toBe(false)
      expect(confirmForegroundProcess).toHaveBeenCalledExactlyOnceWith('pty-1')
    }
  )

  it.each(['confirmForegroundProcess', 'getForegroundProcess'] as const)(
    'returns false when %s exceeds the controller timeout',
    async (method) => {
      vi.useFakeTimers()
      const foregroundProcess = vi.fn(() => new Promise<string | null>(() => {}))
      const runtime = new OrcaRuntimeService(store)
      runtime.setPtyController({ ...controller, [method]: foregroundProcess })
      syncSinglePty(runtime)
      const [terminal] = (await runtime.listTerminals()).terminals
      const confirmation = runtime.confirmTerminalShellForeground(terminal.handle)
      await vi.advanceTimersByTimeAsync(PTY_CONTROLLER_LIST_TIMEOUT_MS + 1)
      await expect(confirmation).resolves.toBe(false)
      expect(foregroundProcess).toHaveBeenCalledExactlyOnceWith('pty-1')
    }
  )
})
