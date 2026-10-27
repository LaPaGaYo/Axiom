import { request } from 'node:http'
import { connect, createServer, type Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as childProcess from '@orca/process-host'
import { RecordingProxy, resolvePeerProcess } from './recording-proxy'

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
      process: { pid: 10, command: 'client-a', ppid: null, ps: null, parent: null }
    },
    {
      method: 'CONNECT',
      url: 'example.invalid:443',
      remotePort: 50002,
      process: { pid: 10, command: 'client-a', ppid: null, ps: null, parent: null }
    },
    {
      method: 'CONNECT',
      url: 'example.invalid:443',
      remotePort: 50003,
      process: { pid: 20, command: 'client-b', ppid: null, ps: null, parent: null }
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
          { pid: 10, command: 'client-a', ppid: null, ps: null, parent: null, count: 2 },
          { pid: 20, command: 'client-b', ppid: null, ps: null, parent: null, count: 1 },
          { pid: null, command: null, ppid: null, ps: null, parent: null, count: 1 }
        ]
      ],
      ['/malformed', [{ pid: null, command: null, ppid: null, ps: null, parent: null, count: 1 }]]
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
        expect(entry.process).toMatchObject({
          pid: process.pid,
          command: expect.any(String),
          ppid: process.ppid,
          ps: expect.any(String),
          parent: expect.objectContaining({ pid: process.ppid })
        })
        expect(entry.process?.command).not.toBe('')
      } else {
        expect(entry.process?.pid ?? null).toBe(entry.process ? process.pid : null)
      }
    }
    expect(proxy.attributedTally()).toEqual(
      new Map([
        [
          'example.invalid',
          [
            {
              pid: proxy.recorded[0].process?.pid ?? null,
              command: proxy.recorded[0].process?.command ?? null,
              ppid: proxy.recorded[0].process?.ppid ?? null,
              ps: proxy.recorded[0].process?.ps ?? null,
              parent: proxy.recorded[0].process?.parent ?? null,
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
      new Map([
        [
          'example.invalid',
          [{ pid: null, command: null, ppid: null, ps: null, parent: null, count: 2 }]
        ]
      ])
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
      new Map([
        [
          'example.invalid',
          [{ pid: null, command: null, ppid: null, ps: null, parent: null, count: 1 }]
        ]
      ])
    )
  })

  it('selects the client endpoint and looks up pipelined requests only once per connection', async () => {
    const socket = connect(Number(new URL(proxyUrl).port), '127.0.0.1')
    const lookup = vi.spyOn(childProcess, 'runProcess').mockImplementation(async ({ program }) => ({
      code: 0,
      signal: null,
      timedOut: false,
      stderr: '',
      stdout:
        program !== 'lsof'
          ? ''
          : [
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
    expect(lookup.mock.calls.filter(([spec]) => spec.program === 'lsof')).toHaveLength(
      supportsLsof ? 1 : 0
    )
    if (supportsLsof) {
      expect(lookup).toHaveBeenCalledWith({
        program: 'lsof',
        args: ['-nP', '-a', `-iTCP:${remotePort}`, '-sTCP:ESTABLISHED', '-Fpcn'],
        timeoutMs: 1_000,
        maxOutputBytes: 1024 * 1024
      })
    }
    expect(proxy.recorded.map((entry) => entry.remotePort)).toEqual([remotePort, remotePort])
    expect(proxy.attributedTally()).toEqual(
      new Map([
        [
          'example.invalid',
          [
            {
              pid: supportsLsof ? 123 : null,
              command: supportsLsof ? 'client' : null,
              ppid: null,
              ps: null,
              parent: null,
              count: 2
            }
          ]
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
      new Map([
        [
          'example.invalid',
          [{ pid: null, command: null, ppid: null, ps: null, parent: null, count: 1 }]
        ]
      ])
    )
  })
})

describe('recording proxy forward policy', () => {
  // Why: the spy's call history must not leak into the attribution suite's exact call assertions.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function tunnel(
    proxyUrl: string,
    target: string
  ): Promise<{ status: number | undefined; socket: Socket }> {
    return new Promise((resolve, reject) => {
      const outgoing = request(proxyUrl, { method: 'CONNECT', path: target, agent: false })
      outgoing.on('error', reject)
      // Node answers a CONNECT request with 'connect' for every status code, so 502s land here too.
      outgoing.on('connect', (response, socket) => resolve({ status: response.statusCode, socket }))
      outgoing.on('response', (response) => {
        reject(new Error(`unexpected response ${response.statusCode} to CONNECT ${target}`))
      })
      outgoing.end()
    })
  }

  async function listen(server: ReturnType<typeof createServer>): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind a TCP port')
    }
    return address.port
  }

  it('tunnels only CONNECT targets the policy allows and records every request', async () => {
    vi.spyOn(childProcess, 'runProcess').mockRejectedValue(new Error('lsof unavailable'))
    const echo = createServer((socket) => socket.pipe(socket))
    const echoPort = await listen(echo)
    const closed = createServer()
    const closedPort = await listen(closed)
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    const proxy = new RecordingProxy({ forward: (host) => host === '127.0.0.1' })
    const proxyUrl = await proxy.start()
    try {
      const allowed = await tunnel(proxyUrl, `127.0.0.1:${echoPort}`)
      expect(allowed.status).toBe(200)
      const echoed = await new Promise<string>((resolve, reject) => {
        allowed.socket.on('error', reject)
        allowed.socket.once('data', (chunk) => resolve(String(chunk)))
        allowed.socket.write('ping')
      })
      expect(echoed).toBe('ping')
      allowed.socket.destroy()
      const byHost = await tunnel(proxyUrl, 'example.invalid:443')
      byHost.socket.destroy()
      expect(byHost.status).toBe(502)
      const unreachable = await tunnel(proxyUrl, `127.0.0.1:${closedPort}`)
      unreachable.socket.destroy()
      expect(unreachable.status).toBe(502)
      expect(proxy.hostTally()).toEqual(
        new Map([
          ['127.0.0.1', 2],
          ['example.invalid', 1]
        ])
      )
    } finally {
      await proxy.close()
      await new Promise<void>((resolve) => echo.close(() => resolve()))
    }
  })
})

describe('process attribution without sockets', () => {
  const peer = {
    remoteAddress: '127.0.0.1',
    remotePort: 50123,
    localAddress: '127.0.0.1',
    localPort: 50124
  }
  const lsof = 'p123\ncgit-remote-http\nn127.0.0.1:50123->127.0.0.1:50124\n'
  const parentPs = '42 /usr/bin/git git fetch https://example.invalid/repo'
  const peerPs = '456 /usr/bin/git-remote-http git-remote-http origin https://example.invalid/repo'
  const oldTable = [
    'Proto Recv-Q Send-Q Local Address Foreign Address (state) rhiwat shiwat pid epid state options',
    `tcp4 0 0 127.0.0.1.50124 127.0.0.1.50123 ESTABLISHED 0 0 ${process.pid} 0 0 0`,
    'tcp4 0 0 127.0.0.1.50123 127.0.0.1.50124 ESTABLISHED 0 0 123 0 0 0'
  ].join('\n')
  const modernTable = [
    'Proto Recv-Q Send-Q Local Address Foreign Address (state) rxbytes txbytes rhiwat shiwat process:pid eprocess:epid state',
    'tcp4 0 0 127.0.0.1.50123 127.0.0.1.50124 ESTABLISHED 0 0 0 0 Electron Helper:123 Electron Helper:123 0'
  ].join('\n')

  function mockCommands(outputs: { lsof?: string; netstat?: string; ps?: string } = {}) {
    return vi.spyOn(childProcess, 'runProcess').mockImplementation(async ({ program, args }) => {
      const stdout =
        program === 'lsof'
          ? (outputs.lsof ?? lsof)
          : program === 'netstat'
            ? (outputs.netstat ?? '')
            : (outputs.ps ?? (args?.[1] === '456' ? parentPs : peerPs))
      return { code: 0, stdout, stderr: '', timedOut: false, signal: null }
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('waits at least 300 ms and retains peer and parent ps evidence', async () => {
    const calls = mockCommands()
    let finished = false
    const pending = resolvePeerProcess(peer).then((value) => {
      finished = true
      return value
    })
    await vi.advanceTimersByTimeAsync(299)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({
      pid: 123,
      command: 'git-remote-http',
      ppid: 456,
      ps: peerPs,
      parent: { pid: 456, ppid: 42, ps: parentPs }
    })
    expect(calls.mock.calls.map(([spec]) => [spec.program, spec.args])).toEqual([
      ['lsof', ['-nP', '-a', '-iTCP:50123', '-sTCP:ESTABLISHED', '-Fpcn']],
      ['netstat', ['-anv', '-p', 'tcp']],
      ['ps', ['-p', '123', '-o', 'ppid=,comm=,args=']],
      ['ps', ['-p', '456', '-o', 'ppid=,comm=,args=']]
    ])
  })

  it.each([oldTable, modernTable])(
    'uses macOS netstat when lsof misses the peer',
    async (netstat) => {
      mockCommands({ lsof: '', netstat })
      const pending = resolvePeerProcess(peer)
      await vi.runAllTimersAsync()
      expect(await pending).toMatchObject({ pid: 123, ppid: 456, ps: peerPs, parent: { pid: 456 } })
    }
  )

  it('keeps the captured endpoint when socket properties change during lookup', async () => {
    mockCommands()
    const changingPeer = { ...peer }
    const pending = resolvePeerProcess(changingPeer)
    changingPeer.remotePort = 9
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ pid: 123 })
  })

  it('prefers a non-proxy netstat owner over lsof naming the proxy', async () => {
    mockCommands({ lsof: lsof.replace('p123', `p${process.pid}`), netstat: modernTable })
    const pending = resolvePeerProcess(peer)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ pid: 123, command: 'Electron Helper' })
  })

  it.each(['CLOSE_WAIT', 'LISTEN'])('ignores non-established netstat rows (%s)', async (state) => {
    mockCommands({ lsof: '', netstat: oldTable.replaceAll('ESTABLISHED', state) })
    const pending = resolvePeerProcess(peer)
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()
  })

  it('does not attribute another socket that shares only one endpoint', async () => {
    mockCommands({ lsof: '', netstat: oldTable.replaceAll('127.0.0.1.50124', '127.0.0.1.9') })
    const pending = resolvePeerProcess(peer)
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()
  })

  it('retains socket identity when ps cannot identify an exited process', async () => {
    mockCommands({ ps: '' })
    const pending = resolvePeerProcess(peer)
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({
      pid: 123,
      command: 'git-remote-http',
      ppid: null,
      ps: null,
      parent: null
    })
  })

  it('scrubs credentials from ps evidence while retaining the git operation', async () => {
    mockCommands({
      ps: '456 git git fetch https://user:password@example.invalid/repo --token=secret'
    })
    const pending = resolvePeerProcess(peer)
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result?.ps).toContain('git fetch https://[redacted]@example.invalid/repo')
    expect(JSON.stringify(result)).not.toMatch(/password|=secret/)
  })

  it.each(['linux', 'win32'] as const)('uses only supported tools on %s', async (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const calls = mockCommands()
    const pending = resolvePeerProcess(peer)
    await vi.runAllTimersAsync()
    expect((await pending)?.pid ?? null).toBe(platform === 'linux' ? 123 : null)
    expect(calls.mock.calls.some(([spec]) => spec.program === 'netstat')).toBe(false)
  })

  it.each(['missing', 'timeout', 'truncated', 'nonzero'])(
    'returns null for %s tools after the hold',
    async (failure) => {
      vi.spyOn(childProcess, 'runProcess').mockImplementation(async () => {
        if (failure === 'missing') {
          throw new Error('not installed')
        }
        return {
          code: failure === 'nonzero' ? 1 : 0,
          stdout: lsof,
          stderr: '',
          signal: null,
          timedOut: failure === 'timeout',
          outputTruncated: failure === 'truncated'
        }
      })
      const pending = resolvePeerProcess(peer)
      await vi.runAllTimersAsync()
      expect(await pending).toBeNull()
    }
  )
})
