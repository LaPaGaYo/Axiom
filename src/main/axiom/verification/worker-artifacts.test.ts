import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verificationFixture } from './verification-fixture.test-support'
import { checkWorkerArtifacts } from './worker-artifacts'

let root: string
let f: ReturnType<typeof verificationFixture>
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-artifact-check-'))
  f = verificationFixture(root)
})
afterEach(async () => {
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
it('treats an unreadable metadata row as a store problem', async () => {
  const artifact = await put(Buffer.from('content'), 'text/plain')
  submit([artifact.id])
  vi.spyOn(f.store, 'getArtifact').mockImplementation(() => {
    throw new Error('PRIVATE_STORE_ERROR')
  })
  const result = await check()
  expect(result.checked).toEqual([
    {
      id: artifact.id,
      kind: null,
      mediaType: null,
      bytes: null,
      problem: 'unreadable'
    }
  ])
  expect(result.counts.unreadable).toBe(1)
  expect(JSON.stringify(result)).not.toContain('PRIVATE_STORE_ERROR')
})
function submit(ids: string[]) {
  f.store.insertSubmission({
    id: 'submission',
    missionId: f.missionId,
    taskId: f.task.taskId,
    candidateId: f.candidate.id,
    attemptId: f.candidate.attemptId,
    report: {
      summary: 'deliverable',
      filesChanged: [],
      checksRun: [],
      artifacts: ids,
      limitations: [],
      risks: [],
      questions: [],
      followUps: []
    }
  })
}
const check = () =>
  checkWorkerArtifacts({
    store: f.store,
    artifacts: f.artifacts,
    attemptId: f.candidate.attemptId,
    required: true
  })
const put = (content: Buffer, mediaType: string) =>
  f.artifacts.put({
    missionId: f.missionId,
    kind: 'worker_report',
    content,
    mediaType,
    related: [f.task.taskId],
    createdBy: 'Worker'
  })

it.each([
  { content: Buffer.alloc(0), mediaType: 'application/octet-stream', problem: 'empty' },
  { content: Buffer.from([0xff]), mediaType: 'text/plain', problem: 'invalid_utf8' },
  { content: Buffer.from([0xc3]), mediaType: 'application/json', problem: 'invalid_utf8' },
  { content: Buffer.from('{'), mediaType: 'application/problem+json', problem: 'invalid_json' },
  {
    content: Buffer.from(' '),
    mediaType: 'application/json; charset=utf-8',
    problem: 'invalid_json'
  },
  { content: Buffer.from('{}'), mediaType: 'Application/Problem+JSON; charset=UTF-8' },
  { content: Buffer.from('null'), mediaType: 'application/json' },
  { content: Buffer.from(' '), mediaType: 'text/plain' },
  { content: Buffer.from([0xff]), mediaType: 'application/octet-stream' }
])('checks $mediaType / $problem', async ({ content, mediaType, problem }) => {
  const artifact = await put(content, mediaType)
  submit([artifact.id])
  const result = await check()
  expect(result.checked).toEqual([
    {
      id: artifact.id,
      kind: 'worker_report',
      mediaType,
      bytes: content.length,
      ...(problem ? { problem } : {})
    }
  ])
  expect(result.counts).toEqual({
    checked: 1,
    unreadable: 0,
    empty: 0,
    invalid_utf8: 0,
    invalid_json: 0,
    ...(problem ? { [problem]: 1 } : {})
  })
})
it.each(['missing', 'corrupt'])(
  'records unreadable for a %s Artifact without raw content or errors',
  async (mode) => {
    const artifact = await put(Buffer.from('original'), 'text/plain')
    submit(mode === 'missing' ? ['absent'] : [artifact.id])
    if (mode === 'corrupt') {
      await writeFile(f.artifacts.pathFor(artifact.sha256), 'PRIVATE_RAW')
    }
    const result = await check()
    expect(result.counts.unreadable).toBe(1)
    expect(result.checked[0].problem).toBe('unreadable')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RAW')
    if (mode === 'missing') {
      expect(result.checked).toEqual([
        {
          id: 'absent',
          kind: null,
          mediaType: null,
          bytes: null,
          problem: 'unreadable'
        }
      ])
    }
  }
)
it('returns empty evidence without a Submission and inspects beyond the 50-entry summary', async () => {
  expect(await check()).toMatchObject({ required: true, checked: [], counts: { checked: 0 } })
  const good = await put(Buffer.from('{}'), 'application/json')
  const bad = await put(Buffer.from('{'), 'application/json')
  submit([...Array<string>(50).fill(good.id), bad.id])
  const result = await check()
  expect(result.checked).toHaveLength(50)
  expect(result.checked.every((entry) => !entry.problem)).toBe(true)
  expect(result.counts).toEqual({
    checked: 51,
    unreadable: 0,
    empty: 0,
    invalid_utf8: 0,
    invalid_json: 1
  })
})
