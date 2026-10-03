import { describe, expect, it, vi } from 'vitest'
import { PluginMarketplaceService } from './plugin-marketplace-service'
import { PluginMarketplaceStore } from './plugin-marketplace-store'
import {
  OFFICIAL_MARKETPLACE_GIT_SOURCE,
  OFFICIAL_MARKETPLACE_OWNER,
  OFFICIAL_MARKETPLACE_REPOSITORY
} from '../../shared/plugins/plugin-marketplace'

describe('disabled official marketplace', () => {
  it('does not award official provenance to a cached former official source', async () => {
    const store = new PluginMarketplaceStore('/unused-when-disabled')
    const source = {
      kind: 'git',
      url: 'https://github.com/legacy/plugins.git',
      ref: 'main'
    } as const
    vi.spyOn(store, 'listSources').mockResolvedValue([{ id: 'cached', source, addedAt: 1 }])
    vi.spyOn(store, 'readSnapshot').mockResolvedValue({
      schemaVersion: 1,
      sourceId: 'cached',
      source,
      marketplaceCommit: 'a'.repeat(40),
      fetchedAt: 1,
      marketplace: {
        name: 'Former official',
        owner: 'legacy',
        plugins: [
          {
            id: 'legacy.orca-notes',
            categories: [],
            source
          }
        ]
      }
    })
    const fetcher = vi.fn()
    const service = new PluginMarketplaceService({ pluginsDataDir: '', store, fetcher })
    await expect(service.listSources()).resolves.toEqual([
      expect.objectContaining({ official: false })
    ])
    await expect(service.listPlugins()).resolves.toEqual([
      expect.objectContaining({ official: false })
    ])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not read or write the store or fetch when seeding is disabled', async () => {
    const store = new PluginMarketplaceStore('/unused-when-disabled')
    const listSources = vi.spyOn(store, 'listSources').mockResolvedValue([])
    const addSource = vi.spyOn(store, 'addSource')
    const readSnapshot = vi.spyOn(store, 'readSnapshot').mockResolvedValue(null)
    const writeSnapshot = vi.spyOn(store, 'writeSnapshot')
    const fetcher = vi.fn()
    const service = new PluginMarketplaceService({ pluginsDataDir: '', store, fetcher })

    expect(OFFICIAL_MARKETPLACE_OWNER).toBeNull()
    expect(OFFICIAL_MARKETPLACE_REPOSITORY).toBeNull()
    expect(OFFICIAL_MARKETPLACE_GIT_SOURCE).toBeNull()
    await expect(service.seedOfficialSource()).resolves.toBeNull()
    await expect(service.seedOfficialSource()).resolves.toBeNull()
    expect(listSources).not.toHaveBeenCalled()
    expect(addSource).not.toHaveBeenCalled()
    expect(readSnapshot).not.toHaveBeenCalled()
    expect(writeSnapshot).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.listSources()).resolves.toEqual([])
    await expect(service.listPlugins()).resolves.toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
})
