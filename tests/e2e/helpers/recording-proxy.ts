import { createServer, type IncomingMessage } from 'node:http'
import { runProcess } from '../../../src/shared/child-process/run-process'

type ProcessIdentity = { pid: number; command: string }
type RecordedRequest = {
  method: string
  url: string
  remotePort: number | null
  process: ProcessIdentity | null
}
type AttributedCount = { pid: number | null; command: string | null; count: number }

async function resolvePeerProcess(
  socket: IncomingMessage['socket']
): Promise<ProcessIdentity | null> {
  if ((process.platform !== 'darwin' && process.platform !== 'linux') || !socket.remotePort) {
    return null
  }
  const peer = `${socket.remoteAddress}:${socket.remotePort}->${socket.localAddress}:${socket.localPort}`
  try {
    const result = await runProcess({
      program: 'lsof',
      args: ['-nP', '-a', `-iTCP:${socket.remotePort}`, '-sTCP:ESTABLISHED', '-Fpcn'],
      timeoutMs: 1_000,
      maxOutputBytes: 64 * 1024
    })
    if (result.code !== 0 || result.timedOut || result.outputTruncated) {
      return null
    }
    let pid = 0
    let command = ''
    for (const field of result.stdout.split('\n')) {
      if (field.startsWith('p')) {
        pid = Number(field.slice(1))
        command = ''
      } else if (field.startsWith('c')) {
        command = field.slice(1)
      } else if (field === `n${peer}` && Number.isSafeInteger(pid) && pid > 0 && command) {
        // The port filter includes the proxy's end too; only the client direction owns the request.
        return { pid, command }
      }
    }
  } catch {
    // Missing lsof, permissions and vanished peers must never prevent recording or refusal.
  }
  return null
}

function requestHost({ method, url }: RecordedRequest): string {
  const target = URL.parse(method === 'CONNECT' ? `http://${url}` : url)
  // Keep malformed targets visible in the evidence instead of dropping requests.
  return target?.hostname.toLowerCase().replace(/\.$/, '') || url
}

/** Records attempted destinations without opening any upstream connection. */
export class RecordingProxy {
  readonly recorded: RecordedRequest[] = []
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

  constructor() {
    this.server.on('connect', async (request, socket) => {
      await this.record(request)
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
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
      // Keep the peer established until the bounded lookup finishes, before sending 502/destroy.
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
        counts.push({ pid, command, count: 1 })
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
