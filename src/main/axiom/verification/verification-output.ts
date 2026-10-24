import { stripVTControlCharacters } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'
import { redactContext } from '../context-builder/redaction'

const HEAD_BYTES = 1024 * 1024

export function boundVerificationText(text: string, bytes: number): string {
  const buffer = Buffer.from(text)
  if (buffer.length <= bytes) {
    return text
  }
  let end = Math.max(0, bytes)
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1
  }
  return buffer.subarray(0, end).toString('utf8')
}

export class VerificationOutput {
  private decoder = new StringDecoder('utf8')
  private head = Buffer.alloc(0)
  private tail: Buffer[] = []
  private tailBytes = 0
  private originalBytes = 0
  private contentBytes = 0

  append(chunk: Buffer): void {
    this.originalBytes += chunk.length
    // Malformed output expands to replacement characters; cap the actual stored UTF-8 bytes.
    this.capture(Buffer.from(this.decoder.write(chunk)))
  }

  private capture(chunk: Buffer): void {
    this.contentBytes += chunk.length
    const headRemaining = HEAD_BYTES - this.head.length
    if (headRemaining > 0) {
      this.head = Buffer.concat([this.head, chunk.subarray(0, headRemaining)])
      chunk = chunk.subarray(headRemaining)
    }
    if (chunk.length) {
      this.tail.push(chunk)
      this.tailBytes += chunk.length
      const capacity = MAX_ARTIFACT_BYTES - HEAD_BYTES
      while (this.tailBytes > capacity) {
        const first = this.tail[0]
        const drop = Math.min(first.length, this.tailBytes - capacity)
        if (drop === first.length) {
          this.tail.shift()
        } else {
          this.tail[0] = first.subarray(drop)
        }
        this.tailBytes -= drop
      }
    }
  }

  snapshot() {
    this.capture(Buffer.from(this.decoder.end()))
    const truncated = this.contentBytes > MAX_ARTIFACT_BYTES
    let marker = ''
    const retainedTail = Buffer.concat(this.tail)
    // Decode contiguous bytes together; the 1 MiB boundary may split a UTF-8 code point.
    if (!truncated) {
      return {
        content: redactContext(Buffer.concat([this.head, retainedTail]).toString('utf8')).content,
        truncated,
        originalBytes: this.originalBytes
      }
    }
    const headText = new StringDecoder('utf8').write(this.head)
    const headBytes = Buffer.byteLength(headText)
    let tail = retainedTail
    if (truncated) {
      // Reserve the marker itself inside the Artifact cap; converge on its digit count.
      for (let i = 0; i < 4; i += 1) {
        tail = retainedTail.subarray(-(MAX_ARTIFACT_BYTES - headBytes - Buffer.byteLength(marker)))
        while (tail.length && (tail[0] & 0xc0) === 0x80) {
          tail = tail.subarray(1)
        }
        marker = `\n[axiom: ${this.contentBytes - headBytes - tail.length} bytes omitted]\n`
      }
    }
    let content = `${headText}${marker}${tail.toString('utf8')}`
    if (truncated) {
      // A private-key block can span the omitted middle. Never expose its retained fragments.
      content = content.replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
        '[REDACTED]'
      )
      content = content.replace(
        /(?:^|\[axiom: \d+ bytes omitted\]\n)[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        '[REDACTED]'
      )
      if (!content.includes(marker)) {
        content += marker
      }
    }
    return {
      content: boundVerificationText(redactContext(content).content, MAX_ARTIFACT_BYTES),
      truncated,
      originalBytes: this.originalBytes
    }
  }
}

export function verificationExcerpt(output: string): string {
  const lines = stripVTControlCharacters(redactContext(output).content).split(/\r?\n/)
  const selected = new Set<number>()
  for (let i = 0; i < lines.length && selected.size < 40; i += 1) {
    if (/FAIL|×|✗|Error|AssertionError|ERR_|failed|not found/.test(lines[i])) {
      for (
        let j = Math.max(0, i - 2);
        j <= Math.min(lines.length - 1, i + 3) && selected.size < 40;
        j += 1
      ) {
        selected.add(j)
      }
    }
  }
  const excerpt = selected.size
    ? [...selected].sort((a, b) => a - b).map((i) => lines[i])
    : lines.slice(-40)
  return boundVerificationText(excerpt.join('\n'), 4096)
}
