import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { readTokenUsageFile } from './token-usage-file'

it('preserves a complete first record when the tail cap aligns with a line boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axiom-usage-boundary-'))
  try {
    const file = path.join(directory, 'events.jsonl')
    const line = '{"timestamp":"2026-11-12T12:00:00Z","payload":{"type":"token_count"}}\n'
    await writeFile(file, `older record\n${line}`)
    expect(await readTokenUsageFile(file, Buffer.byteLength(line), true)).toEqual({
      text: line,
      cut: true
    })
    expect(await readTokenUsageFile(file, Buffer.byteLength(line) - 1, true)).toEqual({
      text: '',
      cut: true
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
