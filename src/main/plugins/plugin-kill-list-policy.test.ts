import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPluginKillList, PluginKillListService } from './plugin-kill-list-service'
import { PluginKillListStore } from './plugin-kill-list-store'
const empty = { version: 1, generatedAt: '1970-01-01T00:00:00Z', plugins: [] }
afterEach(() => vi.unstubAllGlobals())
describe('disabled plugin kill-list policy', () => {
  it('resolves an empty list without invoking fetch', async () => {
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchPluginKillList()).resolves.toEqual(empty)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps cached revocations during refresh without fetching, writing, or notifying', async () => {
    const pluginsDataDir = await mkdtemp(join(tmpdir(), 'axiom-kill-list-policy-'))
    const store = new PluginKillListStore(pluginsDataDir)
    const cached = {
      version: 1 as const,
      generatedAt: '2026-01-01T00:00:00Z',
      plugins: [{ pluginKey: 'community.unsafe', reason: 'Local advisory' }]
    }
    await store.write(cached)
    const write = vi.spyOn(store, 'write')
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const service = new PluginKillListService({ pluginsDataDir, store })
    const changed = vi.fn()
    service.onChanged(changed)
    await expect(service.refresh()).resolves.toEqual(cached)
    expect(service.reason('community.unsafe')).toBe('Local advisory')
    expect(service.snapshot()).toEqual(cached)
    expect(write).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refreshes an empty local store without a request', async () => {
    const pluginsDataDir = await mkdtemp(join(tmpdir(), 'axiom-kill-list-policy-'))
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    const service = new PluginKillListService({ pluginsDataDir })
    await expect(service.refresh()).resolves.toEqual(empty)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
