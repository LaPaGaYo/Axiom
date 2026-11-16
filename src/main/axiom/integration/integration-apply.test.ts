import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  integrationFixture,
  conflictHead,
  recordIntegrationBase,
  gitAt,
  type IntegrationFixture
} from './integration-fixture.test-support'

let root: string
const fixtures: IntegrationFixture[] = []
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-integration-')))
})
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.effects.stop()
    f.db.close()
  }
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const directory = path.join(root, `case-${fixtures.length}`)
  await mkdir(directory)
  const f = await integrationFixture(directory)
  fixtures.push(f)
  return f
}
async function returned(f: IntegrationFixture, before: string) {
  expect(await f.git('worktree', 'list', '--porcelain')).toBe(before)
  expect(await f.git('for-each-ref', 'refs/heads/axiom/integrating')).toBe('')
  expect(f.audits().filter((e) => e.event === 'integration.cleanup_failed')).toEqual([])
  expect(f.runtime.removeManagedWorktree).toHaveBeenCalledWith(expect.any(String), {
    force: true,
    waitForBackgroundRemoval: true
  })
}

it('merges a clean candidate without fast-forward and pins the merge commit', async () => {
  const f = await fixture()
  const hooks = path.join(f.root, 'hooks')
  await mkdir(hooks)
  const log = path.join(f.root, 'checkouts')
  await writeFile(path.join(hooks, 'pre-merge-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await writeFile(
    path.join(hooks, 'reference-transaction'),
    '#!/bin/sh\nwhile read old new ref; do\ncase "$ref" in refs/axiom/*) exit 1;; esac\ndone\n',
    { mode: 0o755 }
  )
  await writeFile(path.join(hooks, 'post-checkout'), `#!/bin/sh\necho checkout >> '${log}'\n`, {
    mode: 0o755
  })
  await f.git('config', 'core.hooksPath', hooks)
  const before = await f.git('worktree', 'list', '--porcelain')
  f.enqueue()
  await f.run()
  expect(f.effect()?.status).toBe('done')
  expect(f.batches()).toHaveLength(1)
  const batch = f.batches()[0]
  expect(batch).toMatchObject({
    status: 'PROMOTED',
    baseCommit: f.baseSha,
    candidateIds: [f.candidate.id]
  })
  const ref = `refs/axiom/batches/${batch.id}/merged`
  expect(await f.git('show', '-s', '--format=%P', batch.mergeCommit!)).toBe(
    `${f.baseSha} ${f.candidate.commitSha}`
  )
  expect(await f.git('rev-parse', ref)).toBe(batch.mergeCommit)
  expect(await f.git('rev-parse', `refs/axiom/candidates/${f.candidate.id}`)).toBe(
    f.candidate.commitSha
  )
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.mergeCommit)
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(await readFile(log, 'utf8')).toBe('checkout\n')
  await returned(f, before)
  expect(
    f.audits().filter((e) => e.objectId === batch.id && e.event.startsWith('integration.'))
  ).toEqual([
    expect.objectContaining({
      actor: 'IntegrationController',
      objectKind: 'integration_batch',
      objectId: batch.id,
      before: null,
      event: 'integration.batch_started',
      after: { status: 'APPLYING', baseCommit: f.baseSha, candidateId: f.candidate.id }
    }),
    expect.objectContaining({
      actor: 'IntegrationController',
      objectKind: 'integration_batch',
      objectId: batch.id,
      before: null,
      event: 'integration.batch_merged',
      after: { status: 'TESTING', mergeCommit: batch.mergeCommit, ref }
    }),
    expect.objectContaining({
      event: 'integration.regression_started',
      objectId: batch.id,
      after: {
        status: 'TESTING',
        runId: expect.any(String),
        mergeCommit: batch.mergeCommit,
        commandCount: 1
      }
    }),
    expect.objectContaining({
      event: 'integration.batch_promotable',
      objectId: batch.id,
      after: { status: 'PROMOTABLE', runId: expect.any(String), mergeCommit: batch.mergeCommit }
    }),
    expect.objectContaining({
      event: 'integration.batch_promoted',
      objectId: batch.id,
      after: {
        status: 'PROMOTED',
        baseCommit: batch.baseCommit,
        mergeCommit: batch.mergeCommit,
        taskIntegrated: true,
        caughtUp: false
      }
    })
  ])
})

it('records a conflict with its paths, aborts the merge and sends the Task back', async () => {
  for (const exhausted of [false, true]) {
    const f = await fixture()
    const { paths, head } = await conflictHead(f)
    if (exhausted) {
      f.db.db
        .prepare('UPDATE task_stages SET attempt_count = ? WHERE task_id = ?')
        .run(f.task.retryPolicy.maxAttempts, f.task.taskId)
    }
    const origin = path.join(f.root, 'origin')
    await mkdir(origin)
    await gitAt(origin, 'init', '-q')
    await gitAt(origin, 'config', 'core.bare', 'true')
    await f.git('remote', 'add', 'origin', origin)
    await f.git('push', 'origin', `${f.baseSha}:refs/heads/main`)
    await gitAt(origin, 'branch', 'unfetched', 'main')
    await f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    const before = await f.git('worktree', 'list', '--porcelain')
    const removal = f.runtime.removeManagedWorktree.getMockImplementation()!
    const atRemoval: string[] = []
    f.runtime.removeManagedWorktree.mockImplementation(async (selector) => {
      const w = f.runtime.worktrees.find((row) => `id:${row.id}` === selector)!
      await expect(gitAt(w.path, 'rev-parse', '--verify', 'MERGE_HEAD')).rejects.toMatchObject({
        code: 128
      })
      atRemoval.push(await gitAt(w.path, 'rev-parse', 'HEAD'))
      return removal(selector)
    })
    f.enqueue()
    await f.run()
    expect(f.effect()?.status).toBe('done')
    expect(f.batches()).toHaveLength(1)
    const batch = f.batches()[0]
    expect(batch).toMatchObject({
      status: 'CONFLICT',
      baseCommit: head,
      conflicts: paths,
      mergeCommit: null
    })
    expect(await f.git('for-each-ref', `refs/axiom/batches/${batch.id}/merged`)).toBe('')
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(exhausted ? 'BLOCKED' : 'READY')
    expect(f.store.getCandidate(f.candidate.id)).toMatchObject({
      status: 'SUPERSEDED',
      supersededBy: null
    })
    expect(
      f
        .audits()
        .filter((e) => e.event === 'task.stage')
        .slice(-2)
        .map((e) => e.after)
    ).toEqual([
      expect.objectContaining({ stage: 'NEEDS_FIX', reason: 'integration_conflict' }),
      expect.objectContaining({
        stage: exhausted ? 'BLOCKED' : 'READY',
        reason: exhausted ? 'retry_budget_exhausted' : 'retry'
      })
    ])
    expect(f.audits()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'candidate.superseded',
          actor: 'IntegrationController',
          objectKind: 'candidate',
          objectId: f.candidate.id,
          before: { status: 'ACTIVE' },
          after: { status: 'SUPERSEDED', supersededBy: null, reason: 'integration_conflict' }
        }),
        expect.objectContaining({
          event: 'integration.batch_conflict',
          objectId: batch.id,
          after: { status: 'CONFLICT', conflictCount: paths.length, truncated: false }
        })
      ])
    )
    expect(atRemoval).toEqual([head])
    expect(await f.git('rev-parse', f.integrationRef)).toBe(head)
    expect(await f.git('for-each-ref', 'refs/remotes/origin/unfetched')).toBe('')
    await returned(f, before)
  }
})

it('takes the head itself as the merge commit when it already contains the candidate', async () => {
  const f = await fixture()
  await f.git('commit', '--allow-empty', '--no-gpg-sign', '-qm', 'descendant')
  const head = await f.git('rev-parse', 'HEAD')
  await f.git('update-ref', f.integrationRef, head)
  recordIntegrationBase(f, head)
  const before = await f.git('worktree', 'list', '--porcelain')
  f.enqueue()
  await f.run()
  expect(f.effect()?.status).toBe('done')
  expect(f.batches()).toHaveLength(1)
  const batch = f.batches()[0]
  expect(batch).toMatchObject({ status: 'PROMOTED', baseCommit: head, mergeCommit: head })
  expect(await f.git('rev-parse', `refs/axiom/batches/${batch.id}/merged`)).toBe(head)
  await returned(f, before)
})
