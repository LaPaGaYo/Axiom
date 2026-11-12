import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { findCodexSessionRecord } from './codex-session-record'
import { readContinuationThread } from './in-place-evidence'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return { ...original, open: vi.fn(original.open) }
})

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-session-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
it('bounds the actual read request even when the stream is oversized', async () => {
  await writeFile(path.join(root, 'events.jsonl'), 'x'.repeat(1024 * 1024))
  const original = await vi.importActual<typeof FsPromises>('node:fs/promises')
  const file = await original.open(path.join(root, 'events.jsonl'), 'r')
  const read = vi.spyOn(file, 'read')
  vi.mocked(open).mockResolvedValueOnce(file)
  expect(await readContinuationThread(root)).toBeUndefined()
  expect(read).toHaveBeenCalledOnce()
  expect(read.mock.calls[0]).toEqual([expect.any(Buffer), 0, 64 * 1024, 0])
})
it('finds a session record that Codex archived as jsonl.zst', async () => {
  const directory = path.join(root, 'sessions', '2026', '11', '03')
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'rollout-local-thread-1.jsonl.zst'),
    'unread compressed content'
  )
  const args = {
    accountHome: root,
    threadId: 'thread-1',
    startedAt: new Date(2026, 10, 3).getTime(),
    now: new Date(2026, 10, 11).getTime()
  }
  expect(await findCodexSessionRecord({ ...args, includeArchived: true })).toContain('.jsonl.zst')
  expect(await findCodexSessionRecord(args)).toBeUndefined()
  expect(
    await findCodexSessionRecord({ ...args, includeArchived: true, startedAt: args.now })
  ).toBeUndefined()
})
it('reads only the first 64 KiB of host events and the first thread event', async () => {
  const file = path.join(root, 'events.jsonl')
  await writeFile(file, `${' '.repeat(65536)}\n{"type":"thread.started","thread_id":"too-late"}\n`)
  expect(await readContinuationThread(root)).toBeUndefined()
  await writeFile(
    file,
    `{"type":"thread.started","thread_id":"first"}\n{"type":"thread.started","thread_id":"second"}\n${'x'.repeat(
      100000
    )}`
  )
  expect(await readContinuationThread(root)).toBe('first')
  await writeFile(
    file,
    '{"type":"thread.started","thread_id":"../invalid"}\n{"type":"thread.started","thread_id":"second"}\n'
  )
  expect(await readContinuationThread(root)).toBeUndefined()
})
