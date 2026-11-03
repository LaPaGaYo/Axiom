import { describe, expect, it } from 'vitest'
import { TaskSpecSchema } from './mission-objects'
import { SubtaskRequestSchema } from './message-params'
import { makeProposal } from './contract-fixtures.test-support'
import { acceptanceCommands, resolveAcceptance } from './acceptance'

const criteria = [
  { text: 'Unit tests pass', check: { kind: 'command', command: 'pnpm test' } },
  { text: 'Report is attached', check: { kind: 'artifact', artifactKind: 'worker_report' } },
  { text: 'A person confirms the result', check: { kind: 'human' } }
]

describe('acceptance contracts', () => {
  it('accepts all three kinds without the retired field on Task specs', () => {
    const task = { ...makeProposal().tasks[0], acceptanceCriteria: criteria }
    delete task.requiredEvidence
    expect(TaskSpecSchema.safeParse(task).success).toBe(true)
  })

  it.each([
    { text: 'Invalid', check: { kind: 'unknown' } },
    { text: 'Invalid', check: { kind: 'command' } },
    { text: 'Invalid', check: { kind: 'human', command: 'pnpm test' } },
    { text: 'Invalid', check: { kind: 'artifact', artifactKind: 'unknown' } },
    { text: 'Invalid', check: { kind: 'human' }, extra: true }
  ])('rejects invalid or unrecognized acceptance fields', (criterion) => {
    expect(
      TaskSpecSchema.safeParse({ ...makeProposal().tasks[0], acceptanceCriteria: [criterion] })
        .success
    ).toBe(false)
  })

  it('accepts object criteria in strict subtask requests and rejects legacy fields', () => {
    const request = {
      title: 'Review',
      objective: 'Review the change',
      allowedPaths: ['src/'],
      acceptanceCriteria: criteria
    }
    expect(SubtaskRequestSchema.safeParse(request).success).toBe(true)
    expect(
      SubtaskRequestSchema.safeParse({ ...request, requiredEvidence: ['pnpm test'] }).success
    ).toBe(false)
    expect(
      SubtaskRequestSchema.safeParse({ ...request, acceptanceCriteria: ['Tests pass'] }).success
    ).toBe(false)
    expect(SubtaskRequestSchema.safeParse({ ...request, acceptanceCriteria: [] }).success).toBe(
      false
    )
  })
})

describe('compatible acceptance resolution', () => {
  it('turns persisted text into human criteria and appends legacy commands in order', () => {
    expect(
      resolveAcceptance({
        acceptanceCriteria: ['The behavior is correct'],
        requiredEvidence: ['pnpm test', 'node check.js', 'pnpm test']
      })
    ).toEqual([
      { text: 'The behavior is correct', check: { kind: 'human' } },
      { text: 'Command passes: pnpm test', check: { kind: 'command', command: 'pnpm test' } },
      {
        text: 'Command passes: node check.js',
        check: { kind: 'command', command: 'node check.js' }
      }
    ])
  })

  it('preserves object criteria and deduplicates legacy commands with normalized boundaries', () => {
    const criterion = {
      text: 'Tests pass',
      check: { kind: 'command' as const, command: ' pnpm test ' }
    }
    const input = {
      acceptanceCriteria: [criterion, { text: 'Report', check: { kind: 'artifact' as const } }],
      requiredEvidence: ['pnpm test', ' node check.js ', 'node check.js', ' ']
    }
    const before = JSON.stringify(input)
    const resolved = resolveAcceptance(input)
    expect(resolved[0]).toBe(criterion)
    expect(resolved).toEqual([
      ...input.acceptanceCriteria,
      {
        text: 'Command passes: node check.js',
        check: { kind: 'command', command: 'node check.js' }
      }
    ])
    expect(JSON.stringify(input)).toBe(before)
  })

  it('extracts deduplicated commands in criterion order and tolerates no legacy field', () => {
    const resolved = resolveAcceptance({
      acceptanceCriteria: [
        { text: 'A person confirms', check: { kind: 'human' } },
        { text: 'Tests', check: { kind: 'command', command: ' pnpm test ' } },
        { text: 'Report', check: { kind: 'artifact' } },
        { text: 'Again', check: { kind: 'command', command: 'pnpm test' } },
        { text: 'Check', check: { kind: 'command', command: 'node check.js' } }
      ]
    })
    expect(acceptanceCommands(resolved)).toEqual(['pnpm test', 'node check.js'])
  })
})
