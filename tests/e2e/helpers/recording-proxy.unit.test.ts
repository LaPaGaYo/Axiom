import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecordingProxy } from './recording-proxy'

describe('recording proxy', () => {
  let proxy: RecordingProxy
  let proxyUrl: string

  beforeEach(async () => {
    proxy = new RecordingProxy()
    proxyUrl = await proxy.start()
  })

  afterEach(async () => {
    await proxy.close()
  })

  function send(method: string, target: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const outgoing = request(proxyUrl, { method, path: target, agent: false })
      outgoing.on('error', reject)
      outgoing.on('response', (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      outgoing.on('connect', (response, socket) => {
        socket.destroy()
        resolve(response.statusCode)
      })
      outgoing.end()
    })
  }

  it('binds loopback and records and refuses absolute HTTP and CONNECT requests', async () => {
    expect(new URL(proxyUrl).hostname).toBe('127.0.0.1')
    expect(Number(new URL(proxyUrl).port)).toBeGreaterThan(0)
    expect(await send('POST', 'http://Example.invalid:8080/path?query=1')).toBe(502)
    expect(await send('CONNECT', 'example.invalid:443')).toBe(502)
    expect(await send('GET', 'http://another.invalid/path')).toBe(502)
    expect(proxy.recorded).toEqual([
      { method: 'POST', url: 'http://Example.invalid:8080/path?query=1' },
      { method: 'CONNECT', url: 'example.invalid:443' },
      { method: 'GET', url: 'http://another.invalid/path' }
    ])
    expect(proxy.hostTally()).toEqual(
      new Map([
        ['example.invalid', 2],
        ['another.invalid', 1]
      ])
    )
  })

  it('retains loopback, IPv6 and malformed targets in the tally', async () => {
    expect(await send('GET', 'http://localhost:8080/')).toBe(502)
    expect(await send('CONNECT', '[::1]:443')).toBe(502)
    expect(await send('GET', '/not-an-absolute-url')).toBe(502)
    expect(proxy.hostTally()).toEqual(
      new Map([
        ['localhost', 1],
        ['[::1]', 1],
        ['/not-an-absolute-url', 1]
      ])
    )
  })

  it('returns an empty tally before any request', () => {
    expect(proxy.recorded).toEqual([])
    expect(proxy.hostTally()).toEqual(new Map())
  })
})
