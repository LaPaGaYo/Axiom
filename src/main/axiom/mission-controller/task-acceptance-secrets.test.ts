import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { createInput, fixture, planned } from './controller-fixture.test-support'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => f.db.close())

const snapshot = () =>
  ['missions', 'plan_revisions', 'tasks', 'task_stages', 'mission_task_edges', 'audit_events'].map(
    (table) => f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  )

it('refuses a plan proposal whose criteria hold a secret and stores nothing', () => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const proposal = makeProposal()
  const secret = ['ghp', '_', 'x'.repeat(30)].join('')
  proposal.tasks[1].acceptanceCriteria = [
    { text: `Remove ${secret}`, check: { kind: 'command', command: 'pnpm test' } }
  ]
  const before = snapshot()
  let refusal: unknown
  try {
    f.controller.proposePlan({
      missionId: mission.id,
      planRevision: { ...proposal, goalRevisionId: goalRevision.id },
      provenance
    })
  } catch (error) {
    refusal = error
  }
  expect(refusal).toMatchObject({
    code: 'plan_invalid',
    message: 'plan_invalid',
    data: {
      errors: [
        {
          code: 'secret_in_criterion',
          severity: 'error',
          taskIds: [proposal.tasks[1].id],
          path: ['tasks', 1, 'acceptanceCriteria', 0, 'text'],
          message:
            'Acceptance criterion text matches a secret pattern (provider_token). Remove the secret.'
        }
      ]
    }
  })
  expect(JSON.stringify(refusal)).not.toContain(secret)
  expect(snapshot()).toEqual(before)
  expect(f.store.listPlanRevisions(mission.id)).toEqual([])
  const audits = f.store.listAuditEvents({ missionId: mission.id })
  expect(audits.some(({ event }) => event === 'plan.proposed')).toBe(false)
  expect(JSON.stringify(audits)).not.toContain(secret)
})

it('refuses to create a Task whose criteria hold a secret and stores nothing', () => {
  const { missionId } = planned(f)
  const { id: _id, ...task } = makeProposal().tasks[0]
  const secret = ['AKIA', 'A'.repeat(16)].join('')
  const before = snapshot()
  const tasksBefore = f.store.listTaskStages({ missionId })
  const auditsBefore = f.store
    .listAuditEvents({ missionId })
    .filter(({ event }) => event === 'task.created')
  let refusal: unknown
  try {
    f.controller.createTask({
      missionId,
      task: {
        ...task,
        title: 'New check',
        scope: { allowedPaths: ['new-check.ts'] },
        acceptanceCriteria: [
          { text: 'Checks pass', check: { kind: 'command', command: `node check.js ${secret}` } }
        ]
      },
      dependsOn: [],
      provenance
    })
  } catch (error) {
    refusal = error
  }
  expect(refusal).toMatchObject({
    code: 'plan_invalid',
    message: 'plan_invalid',
    data: {
      errors: [
        {
          code: 'secret_in_criterion',
          severity: 'error',
          taskIds: [expect.any(String)],
          path: ['task', 'acceptanceCriteria', 0, 'check', 'command'],
          message:
            'Acceptance criterion command matches a secret pattern (aws_access_key_id). Remove the secret.'
        }
      ]
    }
  })
  expect(JSON.stringify(refusal)).not.toContain(secret)
  expect(snapshot()).toEqual(before)
  expect(f.store.listTaskStages({ missionId })).toEqual(tasksBefore)
  const audits = f.store.listAuditEvents({ missionId })
  expect(audits.filter(({ event }) => event === 'task.created')).toEqual(auditsBefore)
  expect(JSON.stringify(audits)).not.toContain(secret)
})

it('refuses an adjustment whose new criteria hold a secret and stores nothing', () => {
  const { missionId } = planned(f)
  const task = f.store.listTaskStages({ missionId })[0]
  const secret = [
    '-----BEGIN ',
    'RSA PRIVATE KEY-----\nbody\n-----END ',
    'RSA PRIVATE KEY-----'
  ].join('')
  const before = snapshot()
  let refusal: unknown
  try {
    f.controller.adjustTask({
      taskId: task.taskId,
      rationale: 'Correct the criteria.',
      actor: 'user',
      acceptanceCriteria: [{ text: `Remove ${secret}`, check: { kind: 'artifact' } }]
    })
  } catch (error) {
    refusal = error
  }
  expect(refusal).toMatchObject({
    code: 'plan_invalid',
    message: 'plan_invalid',
    data: {
      errors: [
        {
          code: 'secret_in_criterion',
          severity: 'error',
          taskIds: [task.spec.id],
          path: ['task', 'acceptanceCriteria', 0, 'text'],
          message:
            'Acceptance criterion text matches a secret pattern (private_key). Remove the secret.'
        }
      ]
    }
  })
  expect(JSON.stringify(refusal)).not.toContain(secret)
  expect(snapshot()).toEqual(before)
  expect(f.store.getTaskStage(task.taskId)?.spec).toEqual(task.spec)
  const audits = f.store.listAuditEvents({ missionId })
  expect(audits.some(({ event }) => event === 'task.adjusted')).toBe(false)
  expect(JSON.stringify(audits)).not.toContain(secret)
})

it('approves a stored plan whose criteria hold a secret', () => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const proposal = makeProposal()
  const secret = ['ghp', '_', 'x'.repeat(30)].join('')
  proposal.tasks[0].acceptanceCriteria = [
    { text: `Remove ${secret}`, check: { kind: 'command', command: `node check.js ${secret}` } }
  ]
  const stored = f.store.insertPlanRevision(
    { ...proposal, goalRevisionId: goalRevision.id },
    { missionId: mission.id, status: 'PROPOSED' }
  )
  f.store.updateMissionStatus({
    id: mission.id,
    from: 'ANALYZING',
    to: 'PLAN_REVIEW',
    previousStatus: null
  })
  expect(
    f.controller.approvePlan({ planRevisionId: stored.id, resolver: 'user', provenance })
  ).toMatchObject({ status: 'APPROVED' })
  expect(f.store.getMission(mission.id)).toMatchObject({
    status: 'PLANNED',
    activePlanRevisionId: stored.id
  })
  expect(f.store.getPlanRevision(stored.id)?.tasks).toEqual(stored.tasks)
  const tasks = f.store.listTaskStages({ missionId: mission.id })
  expect(tasks).toHaveLength(proposal.tasks.length)
  expect(
    tasks.find(({ spec }) => spec.id === proposal.tasks[0].id)?.spec.acceptanceCriteria
  ).toEqual(proposal.tasks[0].acceptanceCriteria)
})
