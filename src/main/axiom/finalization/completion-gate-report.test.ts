import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { completionGate } from './completion-gate'
import { finalizationFixture, facts, setStage } from './finalization-fixture.test-support'
import { blockingReportApproval } from './completion-report-fixture.test-support'

let f: ReturnType<typeof finalizationFixture>
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
})
afterEach(() => f.db.close())
const item = (id: string) =>
  completionGate(f.store, f.db, f.missionId, facts).find((g) => g.id === id)

it('limitations_recorded fails while an integrated Task has no stored submission', () => {
  f.db.db.prepare('DELETE FROM submissions WHERE task_id = ?').run(f.tasks[0].taskId)
  expect(item('limitations_recorded')).toMatchObject({ pass: false, detail: f.tasks[0].taskId })
  expect(item('limitations_recorded')?.evidence).toEqual([`submission-${f.tasks[1].taskId}`])
  f.store.supersedeActiveCandidate(`candidate-${f.tasks[1].taskId}`)
  expect(item('limitations_recorded')?.detail).toBe(f.tasks.map((t) => t.taskId).join(', '))
})

it('no_open_questions passes with an unanswered question on a settled Task', () => {
  f.db.createGate({ taskId: f.tasks[0].taskId, question: 'Confirm scope' })
  expect(item('no_open_questions')?.pass).toBe(true)
  setStage(f.store, f.tasks[0].taskId, 'CANCELED')
  expect(item('no_open_questions')?.pass).toBe(true)
  setStage(f.store, f.tasks[0].taskId, 'RUNNING')
  expect(item('no_open_questions')).toMatchObject({ pass: false, detail: f.tasks[0].taskId })
})

it('no_open_questions fails while the Mission has a blocking Approval', () => {
  blockingReportApproval(f.db, f.missionId)
  expect(item('no_open_questions')).toMatchObject({
    pass: false,
    detail: 'blocking Approval',
    evidence: f.tasks.map((t) => t.taskId)
  })
})
