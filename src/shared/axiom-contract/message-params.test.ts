import { expect, it } from 'vitest'
import {
  AXIOM_MESSAGE_TYPES,
  AxiomMessagePayloadSchema,
  axiomMessageRoutingType
} from './message-params'
import {
  AttemptMessageParams,
  AttemptRequestSubtaskParams,
  AttemptCheckParams
} from './attempt-params'

const fields = {
  version: 1,
  missionId: 'm',
  taskId: 't',
  attemptId: 'a',
  summary: 'Evidence',
  artifactIds: [],
  related: {}
}
const subtask = {
  title: 'Follow-up',
  objective: 'Test it',
  allowedPaths: ['src/'],
  acceptanceCriteria: ['Pass'],
  requiredEvidence: ['Tests'],
  risk: 'low'
}
it('maps all eight product types without extending Orca routing types', () => {
  expect(AXIOM_MESSAGE_TYPES.map(axiomMessageRoutingType)).toEqual([
    'status',
    'escalation',
    'question',
    'status',
    'escalation',
    'handoff',
    'escalation',
    'worker_done'
  ])
})
it('requires subtask only for REQUEST_SUBTASK and rejects unknown payload fields/types', () => {
  expect(
    AxiomMessagePayloadSchema.safeParse({ axiom: { ...fields, type: 'REQUEST_SUBTASK' } }).success
  ).toBe(false)
  expect(
    AxiomMessagePayloadSchema.parse({ axiom: { ...fields, type: 'REQUEST_SUBTASK', subtask } })
      .axiom.subtask
  ).toEqual(subtask)
  for (const extra of [
    { subtask },
    { to: '@all' },
    { type: 'merge_ready' },
    { summary: 'x'.repeat(2001) }
  ]) {
    expect(
      AxiomMessagePayloadSchema.safeParse({ axiom: { ...fields, type: 'INFORM', ...extra } })
        .success
    ).toBe(false)
  }
  expect(
    AxiomMessagePayloadSchema.safeParse({ axiom: { ...fields, type: 'INFORM' }, extra: true })
      .success
  ).toBe(false)
})
it('worker params cannot choose type, recipient or Mission authority', () => {
  const input = { from: 'term_worker', attemptId: 'a', summary: 'Evidence' }
  expect(AttemptMessageParams.parse(input)).toMatchObject({ artifactIds: [], related: {} })
  for (const extra of [
    { type: 'DECISION' },
    { to: '@all' },
    { missionId: 'forged' },
    { subtask }
  ]) {
    expect(AttemptMessageParams.safeParse({ ...input, ...extra }).success).toBe(false)
  }
  expect(AttemptRequestSubtaskParams.safeParse(input).success).toBe(false)
  expect(AttemptRequestSubtaskParams.safeParse({ ...input, subtask }).success).toBe(true)
  expect(
    AttemptCheckParams.safeParse({ from: 'term_worker', attemptId: 'a', timeoutMs: -1 }).success
  ).toBe(false)
})
