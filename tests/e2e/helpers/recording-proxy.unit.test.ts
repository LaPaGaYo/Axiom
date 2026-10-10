import { request } from 'node:http'
import { connect } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as childProcess from '../../../src/shared/child-process/run-process'
import { RecordingProxy } from './recording-proxy'

it('returns empty tallies before any request', () => {
  const proxy = new RecordingProxy()
  expect(proxy.recorded).toEqual([])
  expect(proxy.hostTally()).toEqual(new Map())
  expect(proxy.attributedTally()).toEqual(new Map())
})

it('groups each host by process and retains unknown attribution', () => {
  const proxy = new RecordingProxy()
  const entries = [
    {
      method: 'GET',
      url: 'http://Example.invalid:80/path',
      remotePort: 50001,
      process: { pid: 10, command: 'client-a' }
    },
    {
      method: 'CONNECT',
      url: 'example.invalid:443',
      remotePort: 50002,
      process: { pid: 10, command: 'client-a' }
    },
    {
      method: 'CONNECT',
      url: 'example.invalid:443',
      remotePort: 50003,
      process: { pid: 20, command: 'client-b' }
    },
    { method: 'GET', url: 'http://example.invalid./path', remotePort: 50004, process: null },
    { method: 'GET', url: '/malformed', remotePort: null, process: null }
  ]
  proxy.recorded.push(...entries)
  expect(proxy.attributedTally()).toEqual(
    new Map([
      [
        'example.invalid',
        [
          { pid: 10, command: 'client-a', count: 2 },
          { pid: 20, command: 'client-b', count: 1 },
          { pid: null, command: null, count: 1 }
        ]
      ],
      ['/malformed', [{ pid: null, command: null, count: 1 }]]
    ])
  )
  expect(proxy.recorded).toEqual(entries)
  proxy.recorded.length = 0
  expect(proxy.attributedTally()).toEqual(new Map())
})

describe('recording proxy', () => {
  let proxy: RecordingProxy
  let proxyUrl: string

  beforeEach(async () => {
    proxy = new RecordingProxy()
    proxyUrl = await proxy.start()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
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
    expect(proxy.recorded.map(({ method, url }) => ({ method, url }))).toEqual([
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

  it('attributes loopback requests to this process when lsof is available', async () => {
    const supportsLsof = process.platform === 'darwin' || process.platform === 'linux'
    const lsof = supportsLsof
      ? await childProcess
          .runProcess({ program: 'lsof', args: ['-v'], timeoutMs: 2_000 })
          .catch(() => null)
      : null
    expect(await send('GET', 'http://example.invalid/')).toBe(502)
    expect(await send('CONNECT', 'example.invalid:443')).toBe(502)
    for (const entry of proxy.recorded) {
      expect(entry.remotePort).toBeGreaterThan(0)
      if (lsof?.code === 0) {
        expect(entry.process).toEqual({ pid: process.pid, command: expect.any(String) })
        expect(entry.process?.command).not.toBe('')
      } else {
        expect(entry.process).toBeNull()
      }
    }
    expect(proxy.attributedTally()).toEqual(
      new Map([
        [
          'example.invalid',
          [
            {
              pid: lsof?.code === 0 ? process.pid : null,
              command: proxy.recorded[0].process?.command ?? null,
              count: 2
            }
          ]
        ]
      ])
    )
    proxy.recorded.length = 0
    expect(proxy.attributedTally()).toEqual(new Map())
  })

  it('keeps recording and refusing requests when lsof cannot run', async () => {
    vi.spyOn(childProcess, 'runProcess').mockRejectedValue(new Error('lsof unavailable'))
    expect(await send('GET', 'http://example.invalid/')).toBe(502)
    expect(await send('CONNECT', 'example.invalid:443')).toBe(502)
    expect(proxy.recorded.every((entry) => entry.process === null)).toBe(true)
    expect(proxy.hostTally()).toEqual(new Map([['example.invalid', 2]]))
    expect(proxy.attributedTally()).toEqual(
      new Map([['example.invalid', [{ pid: null, command: null, count: 2 }]]])
    )
  })

  it.each([
    { code: 1, stdout: '', timedOut: false },
    { code: 0, stdout: '', timedOut: false },
    { code: 0, stdout: 'p123\ncother\nn127.0.0.1:1->127.0.0.1:2\n', timedOut: false },
    { code: 0, stdout: '', timedOut: true }
  ])('retains null attribution for unusable lsof results: %j', async (result) => {
    vi.spyOn(childProcess, 'runProcess').mockResolvedValue({ ...result, signal: null, stderr: '' })
    expect(await send('CONNECT', 'example.invalid:443')).toBe(502)
    expect(proxy.recorded[0].process).toBeNull()
    expect(proxy.attributedTally()).toEqual(
      new Map([['example.invalid', [{ pid: null, command: null, count: 1 }]]])
    )
  })

  it('selects the client endpoint and looks up pipelined requests only once per connection', async () => {
    const socket = connect(Number(new URL(proxyUrl).port), '127.0.0.1')
    const lookup = vi.spyOn(childProcess, 'runProcess').mockImplementation(async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      stderr: '',
      stdout: [
        'p999',
        'cproxy',
        `n127.0.0.1:${socket.remotePort}->127.0.0.1:${socket.localPort}`,
        'p123',
        'cclient',
        `n127.0.0.1:${socket.localPort}->127.0.0.1:${socket.remotePort}`,
        ''
      ].join('\n')
    }))
    let remotePort: number | undefined
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject)
      socket.on('connect', () => {
        remotePort = socket.localPort
        socket.write(
          'GET http://example.invalid/one HTTP/1.1\r\nHost: example.invalid\r\n\r\n' +
            'GET http://example.invalid/two HTTP/1.1\r\nHost: example.invalid\r\n\r\n'
        )
      })
      socket.resume()
      socket.on('close', () => resolve())
    })
    const supportsLsof = process.platform === 'darwin' || process.platform === 'linux'
    expect(lookup).toHaveBeenCalledTimes(supportsLsof ? 1 : 0)
    if (supportsLsof) {
      expect(lookup).toHaveBeenCalledWith({
        program: 'lsof',
        args: ['-nP', '-a', `-iTCP:${remotePort}`, '-sTCP:ESTABLISHED', '-Fpcn'],
        timeoutMs: 1_000,
        maxOutputBytes: 64 * 1024
      })
    }
    expect(proxy.recorded.map((entry) => entry.remotePort)).toEqual([remotePort, remotePort])
    expect(proxy.attributedTally()).toEqual(
      new Map([
        [
          'example.invalid',
          [{ pid: supportsLsof ? 123 : null, command: supportsLsof ? 'client' : null, count: 2 }]
        ]
      ])
    )
  })

  it('records upgrades before destroying the connection even when attribution fails', async () => {
    vi.spyOn(childProcess, 'runProcess').mockRejectedValue(new Error('lsof unavailable'))
    const socket = connect(Number(new URL(proxyUrl).port), '127.0.0.1')
    let remotePort: number | undefined
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject)
      socket.on('connect', () => {
        remotePort = socket.localPort
        socket.write(
          'GET http://example.invalid/socket HTTP/1.1\r\nHost: example.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
        )
      })
      socket.on('close', () => resolve())
    })
    expect(proxy.recorded).toEqual([
      { method: 'GET', url: 'http://example.invalid/socket', remotePort, process: null }
    ])
    expect(proxy.attributedTally()).toEqual(
      new Map([['example.invalid', [{ pid: null, command: null, count: 1 }]]])
    )
  })
})
