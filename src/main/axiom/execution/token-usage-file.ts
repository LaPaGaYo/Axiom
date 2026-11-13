import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

export const CODEX_USAGE_BYTES = 32 * 1024 * 1024
export const CLAUDE_USAGE_BYTES = 64 * 1024 * 1024

/** Internal file boundary only; callers expose validated counters, never this text or IO errors. */
export async function readTokenUsageFile(file: string, cap: number, tail: boolean) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) {
      return undefined
    }
    const size = Math.min(stat.size, cap)
    const offset = tail ? stat.size - size : 0
    const buffer = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const { bytesRead } = await handle.read(buffer, read, size - read, offset + read)
      if (!bytesRead) {
        break
      }
      read += bytesRead
    }
    let text = buffer.subarray(0, read).toString('utf8')
    if (offset > 0) {
      const newline = text.indexOf('\n')
      try {
        // An aligned cap can start with a whole record. Only discard a cut JSON prefix.
        JSON.parse(newline === -1 ? text : text.slice(0, newline))
      } catch {
        text = newline === -1 ? '' : text.slice(newline + 1)
      }
    }
    return { text, cut: stat.size > cap || read < size }
  } finally {
    await handle.close()
  }
}
