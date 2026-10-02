import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, requestMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  requestMock: vi.fn()
}))
vi.mock('electron', () => ({ net: { fetch: fetchMock, request: requestMock } }))
vi.mock('../shared/product-egress-policy', () => ({
  productReleaseRepositorySlug: () => 'LaPaGaYo/Axiom.preview'
}))
import {
  fetchNewerReleaseTagsWithReadiness,
  getReleaseDownloadUrl
} from './updater-prerelease-feed'

const downloadBase = 'https://github.com/LaPaGaYo/Axiom.preview/releases/download'
const assetUrl = `${downloadBase}/v2.0.0/Axiom.exe`
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  fetchMock.mockReset()
  requestMock.mockReset().mockImplementation(() => {
    const request = new EventEmitter()
    return Object.assign(request, {
      abort: vi.fn(),
      end: () => request.emit('redirect', 302)
    })
  })
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/releases.atom')) {
      return new Response(
        [
          '<feed>',
          '<entry><link href="https://github.com/LaPaGaYo/AxiomXpreview/releases/tag/v9.0.0"/></entry>',
          '<entry><link href="https://githubXcom/LaPaGaYo/Axiom.preview/releases/tag/v8.0.0"/></entry>',
          '<entry><link href="https://github.com/LaPaGaYo/Axiom.preview/releases/tag/v2.0.0"/></entry>',
          '</feed>'
        ].join('')
      )
    }
    return new Response(`version: 2.0.0\nfiles:\n  - url: ${assetUrl}\n`)
  })
})
describe('policy-derived prerelease URLs', () => {
  it('escapes repository and host dots when matching release tags', async () => {
    await expect(fetchNewerReleaseTagsWithReadiness('1.0.0', 2)).resolves.toEqual({
      tags: ['v2.0.0'],
      state: 'ready'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.com/LaPaGaYo/Axiom.preview/releases.atom',
      expect.any(Object)
    )
    expect(getReleaseDownloadUrl('v2.0.0')).toBe(`${downloadBase}/v2.0.0`)
  })
  it('uses the product repository for absolute Windows asset readiness probes', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    await expect(fetchNewerReleaseTagsWithReadiness('1.0.0', 1)).resolves.toEqual({
      tags: ['v2.0.0'],
      state: 'ready'
    })
    expect(requestMock).toHaveBeenCalledWith({ method: 'HEAD', url: assetUrl, redirect: 'manual' })
    expect(fetchMock.mock.calls.some(([url]) => url === assetUrl)).toBe(false)
  })
})
