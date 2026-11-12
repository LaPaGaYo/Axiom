import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { inPlaceLaunchFixture } from './in-place-launch.test-support'
import { headlessAttemptDirectory } from './headless-attempt-files'
import { resolveAttemptBaseline } from './attempt-baseline'
import { placeAttemptWorktree } from './attempt-placement'
import * as combination from './worker-launch-combination'

let f: Awaited<ReturnType<typeof inPlaceLaunchFixture>>
beforeEach(async () => {
  f = await inPlaceLaunchFixture()
})
afterEach(async () => {
  await f?.close()
})
const Launch = z.object({
  worktreeId: z.string(),
  argv: z.array(z.string()),
  session: z.object({
    strategy: z.string(),
    id: z.string().optional(),
    originSeq: z.number().optional(),
    fromSeq: z.number().optional(),
    reason: z.string().optional()
  }),
  baseline: z.object({ kind: z.string(), commitSha: z.string().optional() })
})

it.each([false, true])(
  'launches from real host records with the same worktree and split prompts (empty %s)',
  async (empty) => {
    const { second, result } = await f.interrupt(empty)
    await f.launch(second)
    const id = f.store.getAttemptBinding(second.taskId, second.seq)?.dispatchId
    if (!id) {
      throw new Error(JSON.stringify(f.store.listAuditEvents({ missionId: f.missionId }).slice(-4)))
    }
    const started = Launch.parse(f.event('attempt.started', id))
    const expected = { strategy: 'resumed_in_place', id: 'session-one', originSeq: 1, fromSeq: 1 }
    expect(started.session).toEqual(expected)
    expect(f.event('attempt.headless_prepared', id)).toMatchObject({ session: expected })
    expect(started.worktreeId).toBe(`repo::${f.repo.root}`)
    expect(f.deps.runtime.createManagedWorktree).toHaveBeenCalledOnce()
    expect(started.argv.slice(-3)).toEqual(['resume', 'session-one', '-'])
    const target = result.status === 'preserved' ? result.snapshot.commitSha : f.repo.baselineSha
    expect(await f.repo.git(['rev-parse', 'HEAD'])).toBe(target)
    expect(await f.repo.git(['rev-parse', f.first.branch])).toBe(f.repo.baselineSha)
    const short = await readFile(path.join(headlessAttemptDirectory(id), 'prompt.md'), 'utf8')
    expect(short).toContain(`Attempt: ${id}`)
    expect(short).toContain(f.repo.root)
    expect(short).toContain(target)
    expect(short).not.toContain('## Task spec')
    expect(await readFile(path.join(f.repo.root, '.axiom/prompt.md'), 'utf8')).toContain(
      '## Task spec'
    )
    expect(f.event('attempt.started', f.firstId)).not.toHaveProperty('session')
    console.log(
      '[M3-06-2c resumed launch]',
      JSON.stringify({ session: started.session, argv: started.argv, prompt: short })
    )
  }
)

it('creates a fresh worktree with the ordinary full prompt when capability is unproven', async () => {
  const { second } = await f.interrupt()
  vi.spyOn(combination, 'harnessVersion').mockResolvedValue('codex-cli 0.0.0-e2e')
  await f.launch(second)
  const id = f.store.getAttemptBinding(second.taskId, second.seq)?.dispatchId
  if (!id) {
    throw new Error('Expected second dispatch')
  }
  const started = Launch.parse(f.event('attempt.started', id))
  expect(started.session).toEqual({ strategy: 'fresh', reason: 'capability_unproven' })
  expect(started.worktreeId).not.toBe(`repo::${f.repo.root}`)
  expect(started.argv).not.toContain('resume')
  expect(f.deps.runtime.createManagedWorktree).toHaveBeenCalledTimes(2)
  const prompt = await readFile(path.join(headlessAttemptDirectory(id), 'prompt.md'), 'utf8')
  const directory = started.argv[started.argv.indexOf('-C') + 1]
  expect(prompt).toContain('## Task spec')
  expect(await readFile(path.join(directory, '.axiom/prompt.md'), 'utf8')).toBe(prompt)
  console.log(
    '[M3-06-2c fresh launch]',
    JSON.stringify({ session: started.session, argv: started.argv })
  )
})

it('falls back with evidence_unreadable when the worktree adapter cannot read its worker row', async () => {
  const { second } = await f.interrupt()
  const getWorker = f.db.getWorkerDispatch.bind(f.db)
  let previousReads = 0
  vi.spyOn(f.db, 'getWorkerDispatch').mockImplementation((id) => {
    if (id === f.firstId && ++previousReads === 2) {
      throw new Error('Unavailable worker evidence')
    }
    return getWorker(id)
  })
  await f.launch(second)
  const id = f.store.getAttemptBinding(second.taskId, second.seq)?.dispatchId
  if (!id) {
    throw new Error('Expected fresh dispatch')
  }
  expect(Launch.parse(f.event('attempt.started', id)).session).toEqual({
    strategy: 'fresh',
    reason: 'evidence_unreadable'
  })
})

it('records a takeover failure after creating the branch without falling back to creation', async () => {
  const { second } = await f.interrupt()
  // A lock encountered only by the real-index step, after the private-index inspection.
  await writeFile(path.join(f.repo.root, '.git/index.lock'), '')
  await f.launch(second)
  expect(f.deps.runtime.createManagedWorktree).toHaveBeenCalledOnce()
  expect(f.deps.startWorker).toHaveBeenCalledOnce()
  expect(f.store.getAttemptBinding(second.taskId, second.seq)?.dispatchId).toBeNull()
  expect(
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .findLast((row) => row.event === 'attempt.launch_failed')?.after
  ).toMatchObject({ session: { strategy: 'resumed_in_place', id: 'session-one' } })
  expect(await f.repo.git(['symbolic-ref', '--short', 'HEAD'])).toBe(second.branch)
  expect(resolveAttemptBaseline(f.store, { taskId: second.taskId, seq: 3 })).toMatchObject({
    kind: 'integration'
  })
})

it('leaves first Attempts, TUI Attempts and planner placement without a session audit', async () => {
  const { second } = await f.interrupt()
  const spec = f.store.getAgentSpec(second.agentSpecId)?.spec
  if (!spec) {
    throw new Error('Missing spec')
  }
  for (const overrides of [{ attempt: f.first }, { headless: false }, { baseline: undefined }]) {
    const audit = {}
    const create = vi.fn(async () => ({ id: 'new', path: '/new' }))
    await placeAttemptWorktree({
      deps: f.deps,
      attempt: second,
      spec,
      headless: true,
      baseline: resolveAttemptBaseline(f.store, second),
      audit,
      create,
      ...overrides
    })
    expect(audit).not.toHaveProperty('session')
    expect(create).toHaveBeenCalledOnce()
  }
})
