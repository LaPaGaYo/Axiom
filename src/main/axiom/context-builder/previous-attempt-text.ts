import { redactContext } from './redaction'

const omittedEvidence =
  'Further evidence omitted (8 KiB total limit); see the verification Artifact.'
const evidenceBytes = 8 * 1024 - Buffer.byteLength(omittedEvidence) - 14

export function boundedEvidenceSection(lines: string[]): string {
  let remaining = evidenceBytes
  const retained: string[] = []
  let excerpt = false
  for (const line of lines) {
    const bytes = Buffer.byteLength(line) + 1
    if (bytes > remaining) {
      if (excerpt) {
        retained.push('End excerpt')
      }
      retained.push(omittedEvidence)
      break
    }
    retained.push(line)
    if (line === 'Excerpt:') {
      excerpt = true
    }
    if (line === 'End excerpt') {
      excerpt = false
    }
    remaining -= bytes
  }
  return retained.join('\n')
}

export function quote(text: string): string {
  const characters = Array.from(redactContext(text).content.slice(0, 500))
  const encode = (value: string) =>
    JSON.stringify(value)
      .replaceAll('`', '\\u0060')
      .replaceAll('<', '\\u003c')
      .replaceAll('>', '\\u003e')
  while (Buffer.byteLength(encode(characters.join(''))) > 1600) {
    characters.pop()
  }
  return encode(characters.join(''))
}
export function quotedPaths(paths: string[]): string {
  const displayed: string[] = []
  let remaining = 1024
  for (const path of paths) {
    const quoted = quote(path)
    if (Buffer.byteLength(quoted) + 2 > remaining) {
      break
    }
    displayed.push(quoted)
    remaining -= Buffer.byteLength(quoted) + 2
  }
  const omitted = paths.length - displayed.length
  if (omitted) {
    displayed.push(`(${omitted} paths omitted; see report or adjustment evidence)`)
  }
  return displayed.join(', ')
}

export type AttemptEvidenceLine = { seq: number; kind: 'declaration' | 'adjustment'; text: string }

export function boundedAttemptEvidence(
  entries: AttemptEvidenceLine[],
  reservedLines: string[] = []
) {
  let remaining = Math.max(
    0,
    evidenceBytes - reservedLines.reduce((bytes, line) => bytes + Buffer.byteLength(line) + 1, 0)
  )
  if (!entries.length) {
    return { lines: [], remaining }
  }
  const instruction =
    'If the failures below cannot be fixed inside allowedPaths, say so in limitations and name the paths or commands at fault; do not submit an unchanged tree.'
  const omitted =
    'Earlier Attempt declarations or Task adjustments omitted (8 KiB total evidence limit); see their report Artifacts and audit events.'
  remaining -= Buffer.byteLength(instruction) + Buffer.byteLength(omitted) + 2
  const retained = new Set<number>()
  // Reserve the newest human resolution and declaration before older history; display in source order.
  const priority = entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.seq - a.seq || b.index - a.index)
  const newest = [
    priority.find((entry) => entry.kind === 'adjustment'),
    priority.find((entry) => entry.kind === 'declaration')
  ].filter((entry) => entry !== undefined)
  for (const entry of [...newest, ...priority]) {
    if (retained.has(entry.index)) {
      continue
    }
    const bytes = Buffer.byteLength(entry.text) + 1
    if (bytes <= remaining) {
      retained.add(entry.index)
      remaining -= bytes
    }
  }
  const lines = entries.filter((_, index) => retained.has(index)).map((entry) => entry.text)
  if (retained.size < entries.length) {
    lines.push(omitted)
  } else {
    remaining += Buffer.byteLength(omitted) + 1
  }
  lines.push(instruction)
  return { lines, remaining }
}
