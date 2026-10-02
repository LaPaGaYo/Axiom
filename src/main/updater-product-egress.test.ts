import { beforeEach, describe, expect, it, vi } from 'vitest'
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
import { fetchChangelog } from './updater-changelog'
import { fetchNudge } from './updater-nudge'

describe('disabled update content', () => {
  beforeEach(() => fetchMock.mockReset())
  it('returns no changelog without a request', async () => {
    await expect(fetchChangelog('2.0.0', '1.0.0')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('returns no nudge without a request', async () => {
    await expect(fetchNudge()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
