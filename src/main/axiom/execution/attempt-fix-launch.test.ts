import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { previousSubmission } from './attempt-baseline.test-support'
import { resolveAttemptBaseline } from './attempt-baseline'
import { prepareWorkerFixLaunch } from './attempt-fix-launch'

let f: ReturnType<typeof planned>
let root: string
let taskId: string
const git = (args: string[]) => gitExecFileAsync(args, gitOptionsForWorktree(root))
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-fix-base-'))
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  taskId = f.store
    .listTaskStages({ missionId: f.missionId })
    .find((task) => task.stage === 'READY')!.taskId
  await git(['init'])
  await writeFile(path.join(root, 'candidate.txt'), 'Candidate tree\n')
  await git(['add', 'candidate.txt'])
  await git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--no-gpg-sign',
    '-m',
    'candidate'
  ])
})
afterEach(async () => {
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})

it('uses a real fallback HEAD read and leaves the repository intact on mismatch', async () => {
  previousSubmission(f.store, { missionId: f.missionId, taskId })
  const before = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  const attempt = { taskId, seq: 2 }
  const baseline = resolveAttemptBaseline(f.store, attempt)
  await expect(
    prepareWorkerFixLaunch(f.db, f.store, attempt, baseline, { path: root })
  ).rejects.toThrow('fix_base_mismatch')
  expect((await git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(before)
  expect((await git(['status', '--porcelain'])).stdout).toBe('')
  if (baseline.kind !== 'candidate') {
    throw new Error('Missing candidate baseline')
  }
  await expect(
    prepareWorkerFixLaunch(
      f.db,
      f.store,
      attempt,
      { ...baseline, candidate: { ...baseline.candidate, commitSha: before } },
      { path: root }
    )
  ).resolves.toMatchObject({ orcaTaskReopened: false })
})

it('keeps the kernel active-dispatch refusal when reopening a completed Task', async () => {
  previousSubmission(f.store, { missionId: f.missionId, taskId, reason: 'secret_detected' })
  const dispatch = f.db.createStartingWorkerDispatch({
    taskId,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: {}
  }).dispatch
  // Simulate an inconsistent task projection; the public transition must still fence the active dispatch.
  f.db.db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(taskId)
  const attempt = { taskId, seq: 2 }
  await expect(
    prepareWorkerFixLaunch(f.db, f.store, attempt, resolveAttemptBaseline(f.store, attempt), {
      path: root
    })
  ).rejects.toMatchObject({ code: 'task_not_startable' })
  expect(f.db.getTask(taskId)?.status).toBe('completed')
  expect(f.db.getDispatchContext(taskId)?.id).toBe(dispatch.id)
})
