import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture, subtask } from '../execution/attempt-channel-fixture.test-support'
import { processSubtaskRequest, resolveSubtask } from './subtask-resolution'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

it('fails the checks of a subtask request whose criteria hold a secret', async () => {
  const worker = f.bind('T04')
  const policy = f.store.getPolicy(f.mission.id)
  if (!policy) {
    throw new Error('Missing policy')
  }
  f.store.upsertPolicy(f.mission.id, {
    ...policy,
    approvalRules: { subtaskAutoCreate: true }
  })
  const secret = ['ghp', '_', 'x'.repeat(30)].join('')
  const tasksBefore = f.store.listTaskStages({ missionId: f.mission.id })
  const createdBefore = f.store
    .listAuditEvents({ missionId: f.mission.id })
    .filter(({ event }) => event === 'task.created')
  for (const decision of ['accept', 'auto_accept'] as const) {
    await f.call('axiom.attempt.request-subtask', {
      from: worker.from,
      attemptId: worker.attemptId,
      summary: 'Check migration',
      subtask: {
        ...subtask,
        allowedPaths: ['src/storage/migrate.ts'],
        acceptanceCriteria: [
          {
            text: `Remove ${secret}`,
            check: { kind: 'command', command: `node check.js ${secret}` }
          }
        ]
      }
    })
    const message = f.db.getUnreadRunMailbox(f.mission.runId).at(-1)!
    if (decision === 'accept') {
      const result = resolveSubtask(f, {
        missionId: f.mission.id,
        messageId: message.id,
        decision,
        rationale: 'Review the follow-up.'
      })
      expect(result).toEqual({ resolved: false, failed: ['secret_in_criterion'] })
      expect(JSON.stringify(result)).not.toContain(secret)
    } else {
      expect(() => processSubtaskRequest(f, f.mission.id, message.id)).not.toThrow()
    }
    const audits = f.store.listAuditEvents({ missionId: f.mission.id })
    const failures = audits.filter(
      ({ event, objectId }) => event === 'subtask.checks_failed' && objectId === message.id
    )
    expect(failures).toMatchObject([
      {
        actor: decision === 'accept' ? 'user' : 'MissionController',
        objectKind: 'message',
        objectId: message.id,
        after: { failed: ['secret_in_criterion'] }
      }
    ])
    expect(JSON.stringify(failures)).not.toContain(secret)
    expect(f.store.listTaskStages({ missionId: f.mission.id })).toEqual(tasksBefore)
    expect(audits.filter(({ event }) => event === 'task.created')).toEqual(createdBefore)
    expect(
      audits.some(({ event, objectId }) => event === 'subtask.resolved' && objectId === message.id)
    ).toBe(false)
  }
})
