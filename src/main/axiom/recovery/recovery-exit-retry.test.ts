import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoveryPreservationFixture } from './preservation-fixture.test-support'
import * as files from '../execution/headless-attempt-files'
import { report } from '../execution/submission-fixture.test-support'

let f: Awaited<ReturnType<typeof recoveryPreservationFixture>>
beforeEach(async () => {
  f = await recoveryPreservationFixture()
  f.observe('exited')
})
afterEach(async () => {
  await f.cleanup()
})

it('retries the exit submission after a transient report Artifact failure', async () => {
  const read = vi.mocked(files.readHeadlessFile).getMockImplementation()
  const { filesChanged: _files, ...headlessReport } = report
  vi.mocked(files.readHeadlessFile).mockImplementation(async (directory, name) => {
    if (name === 'exit-code') {
      return '0'
    }
    if (name === 'last-message.md') {
      return `\`\`\`json\n${JSON.stringify(headlessReport)}\n\`\`\``
    }
    return read?.(directory, name)
  })
  f.put.mockRejectedValueOnce(new Error('temporary Artifact write failure'))
  f.snapshotGit.mockResolvedValue({
    commitSha: f.repo.baselineSha,
    treeSha: await f.repo.git(['rev-parse', 'HEAD^{tree}']),
    snapshotCommitted: false
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'reconcile_failed' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  expect(
    f.audits().filter((row) => ['attempt.failed', 'attempt.preserved'].includes(row.event))
  ).toEqual([])
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'submitted' }]
  })
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeDefined()
})

it('retries interruption settlement without losing its classification or refund', async () => {
  const read = vi.mocked(files.readHeadlessFile).getMockImplementation()
  vi.mocked(files.readHeadlessFile).mockImplementation(async (directory, name) => {
    if (name === 'exit-code') {
      return '1'
    }
    if (name === 'events.jsonl') {
      return JSON.stringify({ type: 'turn.failed', error: { message: 'Usage limit reached' } })
    }
    return read?.(directory, name)
  })
  const transaction = f.plane.store.transaction.bind(f.plane.store)
  let reject = true
  vi.spyOn(f.plane.store, 'transaction').mockImplementation((name, run) => {
    if (name === 'headless_exit_failure' && reject) {
      reject = false
      throw new Error('temporary transaction failure')
    }
    return transaction(name, run)
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'reconcile_failed' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(
    f.audits().filter((row) => ['attempt.failed', 'attempt.preserved'].includes(row.event))
  ).toEqual([])
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'interrupted' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.audits().find((row) => row.event === 'attempt.failed')?.after).toMatchObject({
    failure: { class: 'usage_limit' },
    evidence: 'exit_code',
    settlement: { kind: 'interrupted' }
  })
})
