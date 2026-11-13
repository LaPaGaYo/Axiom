import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { supervisionFixture } from './supervision-fixture.test-support'

export async function tokenBudgetSupervisionFixture() {
  const f = await supervisionFixture()
  const home = path.join(f.directory, 'account')
  const threadId = 'token-budget-fixture-thread'
  f.budget()
  function cap(maxTokens?: number) {
    const task = f.store.getTaskStage(f.t01.taskId)
    if (!task) {
      throw new Error('Missing token budget Task')
    }
    f.store.updateTaskSpec({
      taskId: task.taskId,
      expectedStage: task.stage,
      retryPolicy: task.retryPolicy,
      spec: { ...task.spec, budget: { ...task.spec.budget, maxTokens } }
    })
  }
  function prepare(worker = f.t01, start = f.startedAt, resumed = false) {
    f.db.db
      .prepare(
        'UPDATE worker_dispatches SET start_options = ?, runtime_epoch = ?, created_at = ?, updated_at = ? WHERE dispatch_id = ?'
      )
      .run(
        JSON.stringify({ channel: 'headless', agent: 'codex' }),
        f.runtime.getRuntimeId(),
        new Date(start).toISOString(),
        new Date(f.now()).toISOString(),
        worker.attemptId
      )
    f.store.appendAuditEvent({
      missionId: f.mission.id,
      actor: 'fixture',
      objectKind: 'attempt',
      objectId: worker.attemptId,
      event: 'attempt.headless_prepared',
      before: null,
      after: {
        combination: { effective: { codexHome: { kind: 'account', path: home } } },
        ...(resumed
          ? { session: { strategy: 'resumed_in_place', id: threadId, originSeq: 1, fromSeq: 1 } }
          : {})
      }
    })
    writeFileSync(
      f.eventsFile,
      `${JSON.stringify({ type: 'thread.started', thread_id: threadId })}\n`
    )
    return worker
  }
  function rollout(tokens = 1230, at = f.startedAt) {
    const day = new Date(f.startedAt)
    const directory = path.join(
      home,
      'sessions',
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0')
    )
    mkdirSync(directory, { recursive: true })
    const usage = { input_tokens: tokens, output_tokens: 0, total_tokens: tokens }
    const file = path.join(directory, `rollout-fixture-${threadId}.jsonl`)
    writeFileSync(
      file,
      `${JSON.stringify({
        timestamp: new Date(at).toISOString(),
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: usage, total_token_usage: usage }
        }
      })}\n`
    )
    return file
  }
  function next() {
    f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
    f.db.settleWorkerStop(f.t01.attemptId)
    f.db.updateTaskStatus(f.t01.taskId, 'ready')
    return prepare(f.bind('T01'), f.startedAt + 1000, true)
  }
  prepare()
  return { ...f, cap, prepareUsage: prepare, rollout, next }
}
