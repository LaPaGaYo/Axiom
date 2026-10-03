import { describe, expect, it, vi } from 'vitest'

const { ghExecFileAsync, acquire, release } = vi.hoisted(() => ({
  ghExecFileAsync: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn()
}))
vi.mock('../../gh-utils', () => ({ ghExecFileAsync, acquire, release }))

import { ORCA_REPO, checkOrcaStarred, starOrca } from './orca-star'

describe('disabled star policy', () => {
  it('returns the disabled check/create results without acquiring or spawning gh', async () => {
    expect(ORCA_REPO).toBeNull()
    await expect(checkOrcaStarred()).resolves.toBeNull()
    await expect(starOrca()).resolves.toBe(false)
    expect(acquire).not.toHaveBeenCalled()
    expect(ghExecFileAsync).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })
})
