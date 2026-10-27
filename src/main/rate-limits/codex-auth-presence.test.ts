import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { accessMock, homedirMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  homedirMock: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  access: accessMock
}))

vi.mock('node:os', () => ({
  homedir: homedirMock
}))

import { probeCodexAuthPresence } from './codex-auth-presence'

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('probeCodexAuthPresence', () => {
  const originalCodexHome = process.env.CODEX_HOME

  beforeEach(() => {
    vi.clearAllMocks()
    homedirMock.mockReturnValue('/home/alice')
    delete process.env.CODEX_HOME
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = originalCodexHome
    }
  })

  it('checks an explicit managed-account home first', async () => {
    accessMock.mockResolvedValue(undefined)

    await expect(probeCodexAuthPresence('/managed/home')).resolves.toBe('present')
    expect(accessMock).toHaveBeenCalledWith(join('/managed/home', 'auth.json'))
  })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'probes an ambient home only on Windows (%s)',
    async (platform) => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
      process.env.CODEX_HOME = '/custom/codex'
      accessMock.mockResolvedValue(undefined)

      await expect(probeCodexAuthPresence()).resolves.toBe(
        platform === 'win32' ? 'present' : 'absent'
      )
      expect(accessMock).toHaveBeenCalledTimes(platform === 'win32' ? 1 : 0)
    }
  )

  it('does not probe ~/.codex without an account on macOS/Linux', async () => {
    accessMock.mockRejectedValue(fsError('ENOENT'))

    await expect(probeCodexAuthPresence()).resolves.toBe('absent')
    expect(accessMock).not.toHaveBeenCalled()
  })

  it('keeps an inaccessible auth path distinct from confirmed absence', async () => {
    accessMock.mockRejectedValue(fsError('EACCES'))

    await expect(probeCodexAuthPresence('/managed/home')).resolves.toBe('unavailable')
  })

  it('confirms WSL auth absence only when the Codex home is reachable', async () => {
    accessMock.mockRejectedValueOnce(fsError('ENOENT')).mockResolvedValueOnce(undefined)

    await expect(
      probeCodexAuthPresence('\\\\wsl.localhost\\Ubuntu\\home\\alice\\.codex')
    ).resolves.toBe('absent')
    expect(accessMock).toHaveBeenCalledTimes(2)
  })

  it('reports unavailable when WSL cannot resolve either the auth file or its home', async () => {
    accessMock.mockRejectedValue(fsError('ENOENT'))

    await expect(
      probeCodexAuthPresence('\\\\wsl.localhost\\Missing\\home\\alice\\.codex')
    ).resolves.toBe('unavailable')
    expect(accessMock).toHaveBeenCalledTimes(2)
  })

  it('stops waiting for a stalled filesystem check when the caller aborts', async () => {
    let resolveAccess!: () => void
    accessMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAccess = resolve
      })
    )
    const controller = new AbortController()

    const result = probeCodexAuthPresence('/managed/home', { signal: controller.signal })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()

    await expect(result).resolves.toBe('unavailable')
    resolveAccess()
    await Promise.resolve()
  })

  it('bounds a stalled filesystem check even without a caller signal', async () => {
    let resolveAccess!: () => void
    accessMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAccess = resolve
      })
    )
    const timeoutController = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)

    const result = probeCodexAuthPresence('/managed/home')
    expect(timeout).toHaveBeenCalledWith(5_000)
    await Promise.resolve()
    await Promise.resolve()
    timeoutController.abort()

    await expect(result).resolves.toBe('timeout')
    resolveAccess()
    await Promise.resolve()
    timeout.mockRestore()
  })

  it('shares one stalled UNC probe across concurrent callers', async () => {
    let resolveAccess!: () => void
    accessMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveAccess = resolve
      })
    )
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = probeCodexAuthPresence('\\\\wsl.localhost\\Ubuntu\\home\\alice\\.codex', {
      signal: firstController.signal
    })
    const second = probeCodexAuthPresence('\\\\wsl.localhost\\Ubuntu\\home\\alice\\.codex', {
      signal: secondController.signal
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(accessMock).toHaveBeenCalledTimes(1)
    firstController.abort()
    secondController.abort()
    await expect(first).resolves.toBe('unavailable')
    await expect(second).resolves.toBe('unavailable')

    resolveAccess()
    await Promise.resolve()
  })
})
