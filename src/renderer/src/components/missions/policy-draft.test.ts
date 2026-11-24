import { expect, it } from 'vitest'
import { policy } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'
import { buildPolicyUpdate, openPolicyDraft, readPolicyRules } from './policy-draft'

const stored = PolicySchema.parse({
  ...policy,
  concurrencyLimit: 4,
  verificationRules: VerificationRulesSchema.parse({
    setupCommands: ['node --version', 'pnpm --version'],
    repositoryGates: { low: ['pnpm test'], medium: ['pnpm tc'], high: ['pnpm lint'] },
    integrationGates: ['pnpm test', 'pnpm tc'],
    timeBudgetMinutes: 45,
    planInvalidPatterns: ['missing-check'],
    inconclusiveRouting: 'human',
    testPathPatterns: ['specs/**'],
    retryOnce: ['node'],
    knownFlaky: ['unstable-case']
  })
})

it('opens a draft with the stored limit and one command per line', () => {
  expect(openPolicyDraft(stored)).toEqual({
    concurrency: '4',
    setup: 'node --version\npnpm --version',
    low: 'pnpm test',
    medium: 'pnpm tc',
    high: 'pnpm lint',
    integration: 'pnpm test\npnpm tc',
    minutes: '45'
  })
  expect(readPolicyRules(stored)).toEqual(stored.verificationRules)
  expect(openPolicyDraft(PolicySchema.parse(policy))).toEqual({
    concurrency: '3',
    setup: '',
    low: '',
    medium: '',
    high: '',
    integration: '',
    minutes: '30'
  })
})

it('sends nothing when no field changed', () => {
  const opened = openPolicyDraft(stored)
  expect(buildPolicyUpdate('mission-1', stored, opened, { ...opened })).toMatchObject({
    params: null,
    changed: []
  })
})

it('sends only the limit when only the limit changed', () => {
  const opened = openPolicyDraft(stored)
  const result = buildPolicyUpdate('mission-1', stored, opened, { ...opened, concurrency: '5' })
  expect(result.params).toEqual({
    missionId: 'mission-1',
    patch: { concurrencyLimit: 5 }
  })
  expect(result.changed).toEqual(['concurrency'])
})

it('replaces only the edited keys of the stored rules', () => {
  const opened = openPolicyDraft(stored)
  const result = buildPolicyUpdate('mission-1', stored, opened, {
    ...opened,
    setup: ' node --version \n\n pnpm install \n',
    minutes: '60'
  })
  const expected = {
    missionId: 'mission-1',
    patch: {
      verificationRules: {
        ...stored.verificationRules,
        setupCommands: ['node --version', 'pnpm install'],
        timeBudgetMinutes: 60
      }
    }
  }
  expect(result.params).toEqual(expected)
  expect(PolicyUpdateParams.parse(result.params)).toEqual(expected)
  expect(result.changed).toEqual(['setup', 'minutes'])
  expect(stored.verificationRules.setupCommands).toEqual(['node --version', 'pnpm --version'])
})

it('keeps an untouched empty list and unsets an emptied field', () => {
  const empty = PolicySchema.parse({
    ...stored,
    verificationRules: {
      ...stored.verificationRules,
      repositoryGates: { low: ['pnpm test'], high: [] },
      integrationGates: []
    }
  })
  const opened = openPolicyDraft(empty)
  const kept = buildPolicyUpdate('mission-1', empty, opened, { ...opened, low: '' })
  expect(kept.params?.patch.verificationRules).toMatchObject({
    repositoryGates: { high: [] },
    integrationGates: []
  })
  expect(kept.params?.patch.verificationRules?.repositoryGates).not.toHaveProperty('low')
  const full = openPolicyDraft(stored)
  const removed = buildPolicyUpdate('mission-1', stored, full, {
    ...full,
    low: ' \n',
    integration: '',
    setup: ''
  })
  expect(removed.params?.patch.verificationRules).not.toHaveProperty('integrationGates')
  expect(removed.params?.patch.verificationRules?.repositoryGates).not.toHaveProperty('low')
  expect(removed.params?.patch.verificationRules?.setupCommands).toEqual([])
})

it('builds on the rules stored now and not on the opened ones', () => {
  const opened = openPolicyDraft(stored)
  const current = PolicySchema.parse({
    ...stored,
    verificationRules: {
      ...stored.verificationRules,
      knownFlaky: ['new-case'],
      repositoryGates: { low: [], high: ['node --version'] }
    }
  })
  const result = buildPolicyUpdate('mission-1', current, opened, {
    ...opened,
    setup: 'pnpm install'
  })
  expect(result.params).toEqual({
    missionId: 'mission-1',
    patch: {
      verificationRules: { ...current.verificationRules, setupCommands: ['pnpm install'] }
    }
  })
  const defaults = PolicySchema.parse(policy)
  const initial = openPolicyDraft(defaults)
  const explicit = buildPolicyUpdate('mission-1', defaults, initial, {
    ...initial,
    setup: 'node --version'
  })
  expect(explicit.params?.patch.verificationRules).toEqual(
    VerificationRulesSchema.parse({ setupCommands: ['node --version'] })
  )
})

it('refuses a number that is not a whole number of at least one', () => {
  const opened = openPolicyDraft(stored)
  for (const field of ['concurrency', 'minutes'] as const) {
    for (const text of ['0', '-1', '1.5', 'abc', '', ' 2', '1e2']) {
      const result = buildPolicyUpdate('mission-1', stored, opened, { ...opened, [field]: text })
      expect(result.params).toBeNull()
      expect(result.invalidNumbers).toContain(field)
    }
  }
  const schemaFailure = buildPolicyUpdate('', stored, opened, { ...opened, concurrency: '5' })
  expect(schemaFailure.params).toBeNull()
  expect(schemaFailure.error).toBeTruthy()
})

it('offers only the limit when the stored rules are not valid', () => {
  const invalid = PolicySchema.parse({ ...stored, verificationRules: { timeBudgetMinutes: 0 } })
  expect(readPolicyRules(invalid)).toBeNull()
  const opened = openPolicyDraft(invalid)
  expect(
    buildPolicyUpdate('mission-1', invalid, opened, {
      ...opened,
      concurrency: '5',
      setup: 'node --version'
    }).params
  ).toEqual({ missionId: 'mission-1', patch: { concurrencyLimit: 5 } })
  expect(
    buildPolicyUpdate('mission-1', invalid, opened, { ...opened, setup: 'node --version' }).params
  ).toBeNull()
  expect(
    buildPolicyUpdate('mission-1', null, opened, { ...opened, concurrency: '5' }).params
  ).toBeNull()
})
