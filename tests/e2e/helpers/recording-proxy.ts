import { createServer, type IncomingMessage } from 'node:http'

/** Records attempted destinations without opening any upstream connection. */
export class RecordingProxy {
  readonly recorded: { method: string; url: string }[] = []
  private readonly sockets = new Set<IncomingMessage['socket']>()
  private readonly server = createServer((request, response) => {
    this.record(request)
    response.writeHead(502, { Connection: 'close' })
    response.end()
  })

  constructor() {
    this.server.on('connect', (request, socket) => {
      this.record(request)
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    })
    this.server.on('upgrade', (request, socket) => {
      this.record(request)
      socket.destroy()
    })
    this.server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
  }

  private record(request: IncomingMessage): void {
    this.recorded.push({ method: request.method ?? '', url: request.url ?? '' })
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
    for (const { method, url } of this.recorded) {
      const target = URL.parse(method === 'CONNECT' ? `http://${url}` : url)
      // Keep malformed targets visible in the evidence instead of dropping requests.
      const host = target?.hostname.toLowerCase().replace(/\.$/, '') || url
      tally.set(host, (tally.get(host) ?? 0) + 1)
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
