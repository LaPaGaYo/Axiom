import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const network = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: true }, net: { fetch: network.fetch } }))
import { ArtifactCloudService } from './artifact-cloud-service'
import { SkillCloudService } from '../skills/skill-cloud-service'
import { skillCloudRequest } from '../skills/skill-cloud-request'

beforeEach(() => {
  vi.stubEnv('ORCA_ARTIFACTS_API_URL', '')
  vi.stubEnv('ORCA_CLOUD_API_URL', '')
  vi.stubEnv('ORCA_CLOUD_CLIENT_ID', '')
  vi.stubGlobal('fetch', network.fetch)
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('packaged sharing without environment configuration', () => {
  it.each([false, true])(
    'returns unconfigured on every artifact lane with publishing enabled=%s',
    async (enabled) => {
      const service = new ArtifactCloudService('/unused', () => enabled)
      const request = {
        sourceKey: 'report',
        content: '# Report',
        fileName: 'report.md',
        contentType: 'text/markdown' as const
      }
      for (const operation of [
        service.list({}),
        service.getPublishedLink(request),
        service.share(request),
        service.publish(request),
        service.update(request),
        service.unshare(request),
        service.delete('id', {})
      ]) {
        await expect(operation).resolves.toMatchObject({ status: 'unconfigured' })
      }
      expect(network.fetch).not.toHaveBeenCalled()
    }
  )

  it('returns unconfigured for authenticated and public skill operations', async () => {
    const service = new SkillCloudService('/unused')
    for (const operation of [
      service.listOwnedShares({}),
      service.resolveShare('share_id', {}),
      service.createDownloadGrant('share_id', {})
    ]) {
      await expect(operation).resolves.toMatchObject({ status: 'unconfigured' })
    }
    await expect(skillCloudRequest({ path: '/v1/skill-shares/share_id' })).rejects.toMatchObject({
      code: 'unconfigured'
    })
    expect(network.fetch).not.toHaveBeenCalled()
  })
})
