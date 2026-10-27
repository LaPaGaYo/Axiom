import { createServer, type IncomingMessage } from 'node:http'
import { connect as connectTcp, type Socket } from 'node:net'
import { redactString } from '../../../src/main/observability/redactor'
import { runProcess } from '@orca/process-host'

type Peer = Pick<Socket, 'remoteAddress' | 'remotePort' | 'localAddress' | 'localPort'>
type SocketOwner = { pid: number; command: string | null }
type ProcessSnapshot = { pid: number; ppid: number; ps: string }
type ProcessIdentity = SocketOwner & {
  ppid: number | null
  ps: string | null
  parent: ProcessSnapshot | null
}

async function inspect(program: string, args: string[]): Promise<string> {
  try {
    const result = await runProcess({
      program,
      args,
      timeoutMs: 1_000,
      maxOutputBytes: 1024 * 1024
    })
    return result.code === 0 && !result.timedOut && !result.outputTruncated ? result.stdout : ''
  } catch {
    // Missing tools, denied access and vanished processes must not prevent recording/refusal.
    return ''
  }
}

function lsofOwner(output: string, peer: Peer): SocketOwner | null {
  const endpoint = `n${peer.remoteAddress}:${peer.remotePort}->${peer.localAddress}:${peer.localPort}`
  let pid = 0
  let command = ''
  for (const field of output.split('\n')) {
    if (field.startsWith('p')) {
      pid = Number(field.slice(1))
      command = ''
    } else if (field.startsWith('c')) {
      command = field.slice(1)
    } else if (field === endpoint && Number.isSafeInteger(pid) && pid > 0 && command) {
      return { pid, command }
    }
  }
  return null
}

function netstatOwner(output: string, peer: Peer): SocketOwner | null {
  // macOS has both numeric pid/epid and newer process:pid/eprocess:epid layouts.
  // Use the header: extra byte-counter columns and spaces in process names shift token indexes.
  const lines = output.split('\n')
  const header = lines.find((line) => line.trimStart().startsWith('Proto '))
  const columns =
    header
      ?.replaceAll('Local Address', 'LocalAddress')
      .replaceAll('Foreign Address', 'ForeignAddress')
      .trim()
      .split(/\s+/) ?? []
  const namedIndex = columns.indexOf('process:pid')
  const pidIndex = namedIndex !== -1 ? namedIndex : columns.indexOf('pid')
  if (pidIndex === -1) {
    return null
  }
  for (const line of lines) {
    const fields = line.trim().split(/\s+/)
    if (
      !fields[0]?.startsWith('tcp') ||
      fields[3] !== `${peer.remoteAddress}.${peer.remotePort}` ||
      fields[4] !== `${peer.localAddress}.${peer.localPort}` ||
      fields[5] !== 'ESTABLISHED'
    ) {
      continue
    }
    const named =
      namedIndex !== -1 ? /^(.*?):(\d+)(?:\s|$)/.exec(fields.slice(pidIndex).join(' ')) : null
    const pid = Number(namedIndex !== -1 ? named?.[2] : fields[pidIndex])
    if (Number.isSafeInteger(pid) && pid > 0) {
      return { pid, command: named?.[1] ?? null }
    }
  }
  return null
}

async function snapshot(pid: number): Promise<ProcessSnapshot | null> {
  const output = (await inspect('ps', ['-p', String(pid), '-o', 'ppid=,comm=,args='])).trim()
  const match = /^(\d+)\s+\S/.exec(output)
  const ppid = Number(match?.[1])
  // Keep comm and args together: both can contain spaces, so splitting them would invent evidence.
  return match && Number.isSafeInteger(ppid) ? { pid, ppid, ps: redactString(output) } : null
}

async function lookup(peer: Peer): Promise<ProcessIdentity | null> {
  if ((process.platform !== 'darwin' && process.platform !== 'linux') || !peer.remotePort) {
    return null
  }
  const [lsof, netstat] = await Promise.all([
    inspect('lsof', ['-nP', '-a', `-iTCP:${peer.remotePort}`, '-sTCP:ESTABLISHED', '-Fpcn']),
    process.platform === 'darwin' ? inspect('netstat', ['-anv', '-p', 'tcp']) : ''
  ])
  const owners = [lsofOwner(lsof, peer), netstatOwner(netstat, peer)]
  // A real loopback unit-test client shares our PID; retain it only when neither tool finds another owner.
  const owner = owners.find((item) => item && item.pid !== process.pid) ?? owners.find(Boolean)
  if (!owner) {
    return null
  }
  const details = await snapshot(owner.pid)
  const parent =
    details && details.ppid > 0 && details.ppid !== owner.pid ? await snapshot(details.ppid) : null
  const command =
    owner.command ??
    ((await inspect('ps', ['-p', String(owner.pid), '-o', 'comm='])).trim() || null)
  return { ...owner, command, ppid: details?.ppid ?? null, ps: details?.ps ?? null, parent }
}

export async function resolvePeerProcess({
  remoteAddress,
  remotePort,
  localAddress,
  localPort
}: Peer): Promise<ProcessIdentity | null> {
  const [identity] = await Promise.all([
    lookup({ remoteAddress, remotePort, localAddress, localPort }),
    new Promise<void>((resolve) => setTimeout(resolve, 300))
  ])
  return identity
}

type RecordedRequest = {
  method: string
  url: string
  remotePort: number | null
  process: ProcessIdentity | null
}
type AttributedCount = Omit<ProcessIdentity, 'pid'> & { pid: number | null; count: number }

function requestHost({ method, url }: RecordedRequest): string {
  const target = URL.parse(method === 'CONNECT' ? `http://${url}` : url)
  // Keep malformed targets visible in the evidence instead of dropping requests.
  return target?.hostname.toLowerCase().replace(/\.$/, '') || url
}

/** Which CONNECT targets a RecordingProxy tunnels; everything else is recorded and refused. */
export type RecordingProxyForwardPolicy = (host: string, port: number) => boolean

/** Records attempted destinations; tunnels only the CONNECT targets its forward policy allows. */
export class RecordingProxy {
  readonly recorded: RecordedRequest[] = []
  // Why: the egress tests prove zero egress by refusing everything; a smoke that must reach a
  // provider records the same way but tunnels the hosts its policy allows (no TLS interception).
  private readonly forward: RecordingProxyForwardPolicy
  private readonly sockets = new Set<IncomingMessage['socket']>()
  private readonly attribution = new WeakMap<
    IncomingMessage['socket'],
    Promise<ProcessIdentity | null>
  >()
  private readonly server = createServer(async (request, response) => {
    await this.record(request)
    response.writeHead(502, { Connection: 'close' })
    response.end()
  })

  constructor(options: { forward?: RecordingProxyForwardPolicy } = {}) {
    this.forward = options.forward ?? (() => false)
    this.server.on('connect', async (request, socket, head) => {
      await this.record(request)
      const url = request.url ?? ''
      const host = requestHost({ method: 'CONNECT', url, remotePort: null, process: null })
      // Why not URL.parse: it elides the scheme's default port, and CONNECT host:80 must stay 80.
      const port = Number(/:(\d+)$/.exec(url)?.[1] ?? 443)
      if (!this.forward(host, port)) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      const upstream = connectTcp(port, host)
      let established = false
      upstream.once('connect', () => {
        established = true
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) {
          upstream.write(head)
        }
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
      upstream.on('error', () => {
        if (established || socket.destroyed) {
          socket.destroy()
        } else {
          socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        }
      })
      upstream.on('close', () => {
        if (established) {
          socket.destroy()
        }
      })
      socket.on('error', () => upstream.destroy())
      socket.on('close', () => upstream.destroy())
    })
    this.server.on('upgrade', async (request, socket) => {
      await this.record(request)
      socket.destroy()
    })
    this.server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
  }

  private async record(request: IncomingMessage): Promise<void> {
    const entry: RecordedRequest = {
      method: request.method ?? '',
      url: request.url ?? '',
      remotePort: request.socket.remotePort ?? null,
      process: null
    }
    this.recorded.push(entry)
    let pending = this.attribution.get(request.socket)
    if (!pending) {
      // Keep the peer established for at least 300 ms and through the bounded lookup, before refusal.
      pending = resolvePeerProcess(request.socket)
      this.attribution.set(request.socket, pending)
    }
    entry.process = await pending
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Recording proxy did not bind a TCP port')
    }
    return `http://127.0.0.1:${address.port}`
  }

  hostTally(): Map<string, number> {
    const tally = new Map<string, number>()
    for (const entry of this.recorded) {
      const host = requestHost(entry)
      tally.set(host, (tally.get(host) ?? 0) + 1)
    }
    return tally
  }

  attributedTally(): Map<string, AttributedCount[]> {
    const tally = new Map<string, AttributedCount[]>()
    for (const entry of this.recorded) {
      const host = requestHost(entry)
      const pid = entry.process?.pid ?? null
      const command = entry.process?.command ?? null
      const counts = tally.get(host) ?? []
      const match = counts.find((item) => item.pid === pid && item.command === command)
      if (match) {
        match.count++
      } else {
        counts.push({
          pid,
          command,
          ppid: entry.process?.ppid ?? null,
          ps: entry.process?.ps ?? null,
          parent: entry.process?.parent ?? null,
          count: 1
        })
      }
      tally.set(host, counts)
    }
    return tally
  }

  async close(): Promise<void> {
    if (!this.server.listening) {
      return
    }
    const closed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
    })
    for (const socket of this.sockets) {
      socket.destroy()
    }
    await closed
  }
}
