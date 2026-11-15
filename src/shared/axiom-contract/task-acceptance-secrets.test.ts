import { expect, it } from 'vitest'
import { makeProposal } from './contract-fixtures.test-support'
import { validateTaskAcceptance } from './plan-proposal'
import type { TaskSpec } from './mission-objects'

it('flags a secret in the text and in the command of an acceptance criterion', () => {
  const values = [
    {
      name: 'private_key',
      value: ['-----BEGIN ', 'RSA PRIVATE KEY-----\nbody\n-----END ', 'RSA PRIVATE KEY-----'].join(
        ''
      )
    },
    { name: 'provider_token', value: ['ghp', '_', 'x'.repeat(30)].join('') },
    { name: 'aws_access_key_id', value: ['AKIA', 'A'.repeat(16)].join('') }
  ]
  for (const { name, value } of values) {
    const task: TaskSpec = {
      ...makeProposal().tasks[0],
      acceptanceCriteria: [
        { text: `Remove ${value}`, check: { kind: 'command', command: 'pnpm test' } },
        { text: 'Checks pass', check: { kind: 'command', command: `node check.js ${value}` } },
        { text: `Remove ${value}`, check: { kind: 'command', command: `node check.js ${value}` } },
        { text: `Report ${value}`, check: { kind: 'artifact' } },
        { text: `Review ${value}`, check: { kind: 'human' } }
      ]
    }
    const issues = validateTaskAcceptance(task, ['tasks', 2])
    expect(issues).toHaveLength(6)
    for (const [issueIndex, criterionIndex, field] of [
      [0, 0, 'text'],
      [1, 1, 'command'],
      [2, 2, 'text'],
      [3, 2, 'command'],
      [4, 3, 'text'],
      [5, 4, 'text']
    ] as const) {
      expect(issues[issueIndex]).toEqual({
        code: 'secret_in_criterion',
        severity: 'error',
        message: `Acceptance criterion ${field} matches a secret pattern (${name}). Remove the secret.`,
        taskIds: [task.id],
        path: [
          'tasks',
          2,
          'acceptanceCriteria',
          criterionIndex,
          ...(field === 'text' ? ['text'] : ['check', 'command'])
        ]
      })
    }
    expect(JSON.stringify(issues)).not.toContain(value)
    expect(validateTaskAcceptance(task, ['tasks', 2])).toEqual(issues)
  }
  const combined = values.map(({ value }) => value).join('\n')
  const issues = validateTaskAcceptance(
    {
      ...makeProposal().tasks[0],
      acceptanceCriteria: [{ text: combined, check: { kind: 'artifact' } }]
    },
    ['task']
  )
  expect(issues).toHaveLength(1)
  expect(issues[0].message).toBe(
    'Acceptance criterion text matches a secret pattern (private_key, provider_token, aws_access_key_id). Remove the secret.'
  )
  for (const { value } of values) {
    expect(JSON.stringify(issues)).not.toContain(value)
  }
})

it('leaves criteria that only talk about secrets alone', () => {
  const negatives = [
    'No API keys, tokens or passwords appear in logs',
    'node scripts/check-env.mjs OPENAI_API_KEY',
    'Tokens with the sk- or ghp_ prefix are replaced by [REDACTED]',
    'pnpm test -t "redacts sk-proj tokens"',
    'pnpm test src/auth/password-reset.test.ts',
    ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('')
  ]
  for (const text of negatives) {
    expect(
      validateTaskAcceptance(
        {
          ...makeProposal().tasks[0],
          acceptanceCriteria: [{ text, check: { kind: 'command', command: text } }]
        },
        ['task']
      )
    ).toEqual([])
  }
})
