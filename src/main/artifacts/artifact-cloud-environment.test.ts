import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { isPackaged: false } }))
import { ArtifactCloudService } from './artifact-cloud-service'
import { SkillCloudService } from '../skills/skill-cloud-service'

let root = ''
afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('preserves artifact and skill requests through explicit development environment flags', async () => {
  root = mkdtempSync(join(tmpdir(), 'axiom-sharing-env-'))
  vi.stubEnv('ORCA_ARTIFACTS_API_URL', 'http://localhost:3000')
  vi.stubEnv('ORCA_CLOUD_AUTH_TOKEN', 'test-token')
  vi.stubEnv('NODE_ENV', 'development')
  const fetcher = vi.fn(() => Promise.resolve(Response.json({ artifacts: [], shares: [] })))
  vi.stubGlobal('fetch', fetcher)
  await expect(
    new ArtifactCloudService(root, () => true).list({ authToken: 'test-token' })
  ).resolves.toMatchObject({ status: 'ok', value: { artifacts: [] } })
  await expect(new SkillCloudService(root).listOwnedShares({})).resolves.toEqual({
    status: 'ok',
    value: []
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
  for (const [url, options] of vi.mocked(fetch).mock.calls) {
    expect(String(url)).toMatch(/^http:\/\/localhost:3000\/v1\//)
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-token')
  }
})
