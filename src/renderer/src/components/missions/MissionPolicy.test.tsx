// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { mission, policy } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'
import { TERMINAL_MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import { MissionPolicy } from './MissionPolicy'

const stored = PolicySchema.parse({
  ...policy,
  verificationRules: {
    setupCommands: ['node --version', 'pnpm --version'],
    repositoryGates: { low: ['pnpm test'], medium: ['pnpm tc'], high: ['pnpm lint'] },
    integrationGates: ['pnpm test', 'pnpm tc'],
    timeBudgetMinutes: 45
  }
})
const onSave =
  vi.fn<(params: z.infer<typeof PolicyUpdateParams>, consequence: string) => Promise<boolean>>()
const props = { mission, policy: stored, busy: false, onSave }
const runsHere =
  'Setup commands and gates run on this computer when a Task is verified and when its merge is checked. A change applies to runs that start after it.'
const readError = "The Mission's policy could not be read. Refresh to try again."
const fields = [
  'Tasks at once',
  'Setup commands',
  'Gates for low-risk Tasks',
  'Gates for medium-risk Tasks',
  'Gates for high-risk Tasks',
  'Gates on the merged tree',
  'Verification time budget (minutes)'
]
function value(key: string) {
  return screen
    .getByRole('region', { name: 'Policy' })
    .querySelector(`[data-policy-value="${key}"]`)?.textContent
}
function field(label: string) {
  return screen.getByRole<HTMLInputElement>('textbox', { name: label })
}
function change(label: string, text: string) {
  fireEvent.change(field(label), { target: { value: text } })
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
function saveDisabled() {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Save policy' }).disabled
}
beforeEach(() => {
  onSave.mockReset().mockResolvedValue(false)
})
afterEach(cleanup)

it('shows the limit and the commands and the time budget of the policy', () => {
  render(<MissionPolicy {...props} />)
  expect(screen.getByRole('heading', { name: 'Policy', level: 2 }).id).toBe(
    'mission-policy-heading'
  )
  expect(
    ['concurrency', 'setup', 'low', 'medium', 'high', 'integration', 'minutes'].map(value)
  ).toEqual([
    '3',
    'node --version\npnpm --version',
    'pnpm test',
    'pnpm tc',
    'pnpm lint',
    'pnpm test\npnpm tc',
    '45'
  ])
  const region = screen.getByRole('region', { name: 'Policy' })
  expect(Array.from(region.querySelectorAll('dt'), (term) => term.textContent)).toEqual(fields)
  expect(region.querySelector('[data-policy-value="setup"]')?.className).toContain('font-mono')
})

it('says None and names the fallback when nothing is configured', () => {
  const empty = PolicySchema.parse(policy)
  const view = render(<MissionPolicy {...props} policy={empty} />)
  expect(['setup', 'low', 'medium', 'high'].map(value)).toEqual(['None', 'None', 'None', 'None'])
  expect(value('integration')).toBe('Not set: the highest configured gate runs.')
  expect(value('minutes')).toBe('30')
  view.rerender(
    <MissionPolicy {...props} policy={{ ...empty, verificationRules: { integrationGates: [] } }} />
  )
  expect(value('integration')).toBe('None')
  expect(screen.queryByText('Not set: the highest configured gate runs.')).toBeNull()
})

it('says that the policy could not be read and offers no edit', () => {
  render(<MissionPolicy {...props} policy={null} />)
  const region = screen.getByRole('region', { name: 'Policy' })
  expect(within(region).getByText(readError)).toBeTruthy()
  expect(region.querySelector('dl')).toBeNull()
  expect(within(region).queryByRole('button')).toBeNull()
})

it('offers no edit when the Mission is finished', () => {
  const view = render(<MissionPolicy {...props} />)
  for (const status of TERMINAL_MISSION_STATUSES) {
    view.rerender(<MissionPolicy {...props} mission={{ ...mission, status }} />)
    expect(screen.queryByRole('button', { name: 'Edit policy' })).toBeNull()
    expect(value('concurrency')).toBe('3')
    expect(value('setup')).toBe('node --version\npnpm --version')
  }
})

it('shows the limit and the sentence when the stored rules are not valid', async () => {
  render(
    <MissionPolicy {...props} policy={{ ...stored, verificationRules: { timeBudgetMinutes: 0 } }} />
  )
  expect(value('concurrency')).toBe('3')
  expect(value('setup')).toBeUndefined()
  expect(
    screen.getByText(
      "The Mission's verification rules are not valid. Verification would end INCONCLUSIVE (policy_invalid) without running a command."
    ).className
  ).toContain('text-muted-foreground')
  await click('Edit policy')
  expect(screen.getAllByRole('textbox')).toHaveLength(1)
  expect(
    screen.getByText(
      'The verification rules of this Mission are not valid and cannot be edited here.'
    )
  ).toBeTruthy()
  change('Tasks at once', '5')
  await click('Save policy')
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    { missionId: mission.id, patch: { concurrencyLimit: 5 } },
    'This changes: Tasks at once.'
  )
})

it('opens the form with the stored values and closes it without a call', async () => {
  render(<MissionPolicy {...props} />)
  await click('Edit policy')
  expect(screen.getByRole('form', { name: 'Edit the policy of this Mission' })).toBeTruthy()
  expect(fields.map((label) => field(label).value)).toEqual([
    '3',
    'node --version\npnpm --version',
    'pnpm test',
    'pnpm tc',
    'pnpm lint',
    'pnpm test\npnpm tc',
    '45'
  ])
  for (const label of fields.slice(1, -1)) {
    const control = field(label)
    expect(control.tagName).toBe('TEXTAREA')
    expect(control.className).toContain('font-mono')
    expect(
      document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent
    ).toContain('One command per line.')
  }
  change('Tasks at once', '8')
  await click('Close')
  expect(screen.queryByRole('form')).toBeNull()
  expect(value('concurrency')).toBe('3')
  expect(onSave).not.toHaveBeenCalled()
  await click('Edit policy')
  expect(field('Tasks at once').value).toBe('3')
})

it('disables saving until a field changed and while the page is busy', async () => {
  const view = render(<MissionPolicy {...props} busy />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit policy' }).disabled).toBe(true)
  view.rerender(<MissionPolicy {...props} />)
  await click('Edit policy')
  expect(saveDisabled()).toBe(true)
  change('Tasks at once', '4')
  expect(saveDisabled()).toBe(false)
  change('Tasks at once', '3')
  expect(saveDisabled()).toBe(true)
  change('Setup commands', 'node --version')
  view.rerender(<MissionPolicy {...props} busy />)
  for (const control of screen.getAllByRole<HTMLInputElement>('textbox')) {
    expect(control.disabled).toBe(true)
  }
  for (const control of screen.getAllByRole<HTMLButtonElement>('button')) {
    expect(control.disabled).toBe(true)
  }
  await click('Save policy')
  expect(onSave).not.toHaveBeenCalled()
  view.rerender(<MissionPolicy {...props} />)
  expect(saveDisabled()).toBe(false)
})

it('marks a bad number and does not save it', async () => {
  const view = render(<MissionPolicy {...props} />)
  await click('Edit policy')
  for (const label of ['Tasks at once', 'Verification time budget (minutes)']) {
    const initial = field(label).value
    for (const text of ['0', '-1', '1.5', 'abc', '']) {
      change(label, text)
      expect(field(label).getAttribute('aria-invalid')).toBe('true')
      expect(screen.getByText('Enter a whole number of at least 1.')).toBeTruthy()
      expect(saveDisabled()).toBe(true)
      await click('Save policy')
    }
    change(label, initial)
    expect(field(label).getAttribute('aria-invalid')).toBe('false')
  }
  expect(onSave).not.toHaveBeenCalled()
  change('Tasks at once', '5')
  view.rerender(<MissionPolicy {...props} mission={{ ...mission, id: '' }} />)
  const invalid = PolicyUpdateParams.safeParse({ missionId: '', patch: { concurrencyLimit: 5 } })
  if (invalid.success) {
    throw new Error('Expected an invalid Mission id')
  }
  const message = invalid.error.issues[0]?.message
  expect(message).toBeTruthy()
  if (!message) {
    throw new Error('Missing schema message')
  }
  expect(screen.getByText(message).className).toContain('font-mono')
  expect(saveDisabled()).toBe(true)
})

it('keeps the form and blocks saving while the policy cannot be read', async () => {
  const view = render(<MissionPolicy {...props} />)
  await click('Edit policy')
  change('Tasks at once', '6')
  change('Setup commands', 'node --version')
  view.rerender(<MissionPolicy {...props} policy={null} />)
  expect(screen.getByRole('form', { name: 'Edit the policy of this Mission' })).toBeTruthy()
  expect(field('Tasks at once').value).toBe('6')
  expect(field('Setup commands').value).toBe('node --version')
  expect(screen.getByText(readError)).toBeTruthy()
  expect(saveDisabled()).toBe(true)
  await click('Save policy')
  expect(onSave).not.toHaveBeenCalled()
  view.rerender(<MissionPolicy {...props} policy={{ ...stored }} />)
  expect(saveDisabled()).toBe(false)
  await click('Save policy')
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave.mock.calls[0]?.[0].patch.concurrencyLimit).toBe(6)
})

it('names the changed fields when it hands over a save', async () => {
  render(<MissionPolicy {...props} />)
  await click('Edit policy')
  change('Tasks at once', '5')
  await click('Save policy')
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    { missionId: mission.id, patch: { concurrencyLimit: 5 } },
    'This changes: Tasks at once.'
  )
  expect(field('Tasks at once').value).toBe('5')
  onSave.mockClear()
  change('Verification time budget (minutes)', '60')
  change('Gates for low-risk Tasks', '')
  change('Setup commands', ' node --version \n\n pnpm --version \n')
  await click('Save policy')
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    PolicyUpdateParams.parse({
      missionId: mission.id,
      patch: {
        concurrencyLimit: 5,
        verificationRules: {
          ...VerificationRulesSchema.parse(stored.verificationRules),
          setupCommands: ['node --version', 'pnpm --version'],
          repositoryGates: { medium: ['pnpm tc'], high: ['pnpm lint'] },
          timeBudgetMinutes: 60
        }
      }
    }),
    `This changes: Tasks at once, Setup commands, Gates for low-risk Tasks, Verification time budget (minutes). ${runsHere}`
  )
  expect(screen.getByRole('form', { name: 'Edit the policy of this Mission' })).toBeTruthy()
  expect(field('Setup commands').value).toBe(' node --version \n\n pnpm --version \n')
})
