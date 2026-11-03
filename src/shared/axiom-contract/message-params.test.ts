import { expect, it } from 'vitest'
import {
  AXIOM_MESSAGE_TYPES,
  AxiomMessagePayloadSchema,
  axiomMessageRoutingType,
  parseAxiomMessagePayload
} from './message-params'
import {
  AttemptMessageParams,
  AttemptBlockedParams,
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
  acceptanceCriteria: [{ text: 'Pass', check: { kind: 'command', command: 'pnpm test' } }],
  risk: 'low'
}
it('accepts bounded optional question and follow-up payloads only on their product types', () => {
  const question = { text: 'Which format?', options: ['JSON', 'CSV'] }
  const followUp = { text: 'Add a regression test' }
  for (const extra of [
    { type: 'QUESTION', question },
    { type: 'REQUEST', followUp }
  ]) {
    const payload = { axiom: { ...fields, ...extra } }
    expect(AxiomMessagePayloadSchema.parse(payload)).toEqual(payload)
    expect(parseAxiomMessagePayload(JSON.stringify(payload))).toEqual(payload)
  }
  expect(
    AxiomMessagePayloadSchema.parse({
      axiom: {
        ...fields,
        type: 'QUESTION',
        question: { text: 'Which format?' }
      }
    }).axiom.question
  ).toEqual({ text: 'Which format?', options: [] })
  for (const extra of [
    { type: 'REQUEST', question },
    { type: 'QUESTION', followUp },
    { type: 'QUESTION', question: { text: 'x'.repeat(2001) } },
    { type: 'QUESTION', question: { text: 'Q', options: ['x'.repeat(201)] } },
    { type: 'QUESTION', question: { text: 'Q', options: Array(9).fill('A') } },
    { type: 'QUESTION', question: { text: 'Q', extra: true } },
    { type: 'REQUEST', followUp: { text: 'x'.repeat(2001) } },
    { type: 'REQUEST', followUp: { text: 'F', extra: true } }
  ]) {
    expect(AxiomMessagePayloadSchema.safeParse({ axiom: { ...fields, ...extra } }).success).toBe(
      false
    )
  }
  for (const type of ['QUESTION', 'REQUEST']) {
    expect(AxiomMessagePayloadSchema.safeParse({ axiom: { ...fields, type } }).success).toBe(true)
  }
})
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

it('keeps typed BLOCKED reasons and paths through RPC and stored payload parsing', () => {
  for (const reason of ['blocked_by_scope', 'candidate_already_correct', 'cannot_reproduce']) {
    const blocked = { reason, paths: ['src/check.ts'] }
    const payload = { axiom: { ...fields, type: 'BLOCKED', blocked } }
    expect(AxiomMessagePayloadSchema.parse(payload).axiom.blocked).toEqual(blocked)
    expect(parseAxiomMessagePayload(JSON.stringify(payload))?.axiom.blocked).toEqual(blocked)
    expect(
      AttemptBlockedParams.parse({
        from: 'term_worker',
        attemptId: 'a',
        summary: 'Blocked',
        blocked
      }).blocked
    ).toEqual(blocked)
  }
  expect(
    AxiomMessagePayloadSchema.parse({
      axiom: { ...fields, type: 'BLOCKED', blocked: { reason: 'cannot_reproduce' } }
    }).axiom.blocked?.paths
  ).toEqual([])
})
it('rejects blocked payloads on other types, invalid reasons, empty paths and unknown fields', () => {
  const blocked = { reason: 'blocked_by_scope', paths: ['src/check.ts'] }
  for (const extra of [
    { type: 'INFORM', blocked },
    { blocked: { reason: 'other' } },
    { blocked: { ...blocked, paths: [' '] } },
    { blocked: { ...blocked, paths: Array(51).fill('src/check.ts') } },
    { blocked: { ...blocked, extra: true } }
  ]) {
    expect(
      AxiomMessagePayloadSchema.safeParse({ axiom: { ...fields, type: 'BLOCKED', ...extra } })
        .success
    ).toBe(false)
  }
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
it('reads persisted legacy subtasks through acceptance resolution without accepting them at ingress', () => {
  const legacy = {
    ...subtask,
    acceptanceCriteria: ['The migration is correct'],
    requiredEvidence: ['pnpm test', ' pnpm test ', 'node check.js']
  }
  const payload = { axiom: { ...fields, type: 'REQUEST_SUBTASK', subtask: legacy } }
  const stored = JSON.stringify(payload)
  expect(parseAxiomMessagePayload(stored)?.axiom.subtask).toEqual({
    ...subtask,
    acceptanceCriteria: [
      { text: 'The migration is correct', check: { kind: 'human' } },
      { text: 'Command passes: pnpm test', check: { kind: 'command', command: 'pnpm test' } },
      {
        text: 'Command passes: node check.js',
        check: { kind: 'command', command: 'node check.js' }
      }
    ]
  })
  expect(JSON.stringify(payload)).toBe(stored)
  expect(AxiomMessagePayloadSchema.safeParse(payload).success).toBe(false)
  expect(
    AttemptRequestSubtaskParams.safeParse({
      from: 'term_worker',
      attemptId: 'a',
      summary: 'Evidence',
      subtask: legacy
    }).success
  ).toBe(false)
})
it('preserves strict persisted payload validation while reading legacy subtask acceptance', () => {
  const legacy = { ...subtask, acceptanceCriteria: ['Pass'], requiredEvidence: ['pnpm test'] }
  for (const payload of [
    { axiom: { ...fields, type: 'REQUEST_SUBTASK', subtask: { ...legacy, extra: true } } },
    { axiom: { ...fields, type: 'REQUEST_SUBTASK', subtask: legacy, extra: true } },
    { axiom: { ...fields, type: 'REQUEST_SUBTASK', subtask: legacy }, extra: true },
    { axiom: { ...fields, type: 'INFORM', subtask: legacy } },
    { axiom: { ...fields, type: 'REQUEST_SUBTASK', subtask: { ...legacy, requiredEvidence: [1] } } }
  ]) {
    expect(parseAxiomMessagePayload(JSON.stringify(payload))).toBeUndefined()
  }
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
it('accepts an optional Submission relation while keeping related fields strict', () => {
  const payload = { axiom: { ...fields, type: 'SUBMISSION' } }
  expect(AxiomMessagePayloadSchema.parse(payload).axiom.related).toEqual({})
  expect(
    AxiomMessagePayloadSchema.parse({
      axiom: { ...payload.axiom, related: { submissionId: 'submission_1' } }
    }).axiom.related
  ).toEqual({ submissionId: 'submission_1' })
  for (const related of [{ submissionId: '' }, { submissionId: 1 }, { unknown: 'submission_1' }]) {
    expect(
      AxiomMessagePayloadSchema.safeParse({ axiom: { ...payload.axiom, related } }).success
    ).toBe(false)
  }
  expect(
    AxiomMessagePayloadSchema.safeParse({
      axiom: { ...payload.axiom, summary: 'x'.repeat(2001) }
    }).success
  ).toBe(false)
})
