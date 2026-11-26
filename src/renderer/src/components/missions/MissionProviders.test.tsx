// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mission, policy } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import { TERMINAL_MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
import type { PolicyActions } from './policy-actions'
import type { ProviderEligibility } from './providers-draft'
import { providerSlotCopy } from './provider-copy'
import { MissionProviders } from './MissionProviders'

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children
  }: {
    value: string
    onValueChange: (value: string) => void
    disabled: boolean
    children: ReactNode
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))
const stored = PolicySchema.parse({
  ...policy,
  routing: {
    roles: { worker: { provider: 'codex', model: 'stored-model', effort: 'high' } },
    disallowedProviders: ['claude'],
    requireCertified: true
  }
})
const yes = { eligible: true }
const providers: ProviderEligibility[] = [
  {
    provider: 'codex',
    planner: yes,
    worker: { low: yes, medium: yes, high: { eligible: false, reason: 'account_cooldown' } }
  },
  {
    provider: 'claude',
    planner: { eligible: false, reason: 'no_account' },
    worker: {
      low: { eligible: false, reason: 'disallowed' },
      medium: { eligible: false, reason: 'not_installed' },
      high: { eligible: false, reason: 'not_certified' }
    }
  },
  {
    provider: 'opencode',
    planner: { eligible: false, reason: 'tier_too_low' },
    worker: {
      low: yes,
      medium: { eligible: false },
      high: { eligible: false, reason: 'tier_too_low' }
    }
  }
]
const onSave = vi.fn<PolicyActions['updatePolicy']>()
const onEdit = vi.fn()
const onClose = vi.fn()
const props = { mission, policy: stored, busy: false, onSave, onEdit, onClose }
const request = { missionId: mission.id, providers }
const applies =
  'A Planner started after this change and Worker Attempts admitted after it use the new choice. Attempts that are already running keep their provider.'
const hint =
  'This provider is not available in every case shown in the table. Where it is not, the Control Plane chooses another eligible provider, or the Task waits when there is none.'
function value(key: string) {
  return screen
    .getByRole('region', { name: 'Providers' })
    .querySelector(`[data-providers-value="${key}"]`)?.textContent
}
function selects() {
  return screen.getAllByRole<HTMLSelectElement>('combobox')
}
function change(index: number, value: string) {
  fireEvent.change(selects()[index], { target: { value } })
}
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
function checkbox(name: string) {
  return screen.getByRole<HTMLButtonElement>('checkbox', { name })
}
function saveDisabled() {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Save providers' }).disabled
}
beforeEach(() => {
  vi.clearAllMocks()
  onSave.mockResolvedValue(false)
})
afterEach(cleanup)

it('shows the stored roles and the providers not allowed', () => {
  const view = render(<MissionProviders {...props} />)
  expect(screen.getByRole('heading', { name: 'Providers', level: 2 }).id).toBe(
    'mission-providers-heading'
  )
  expect(['planner', 'worker', 'disallowed', 'certified'].map(value)).toEqual([
    'Automatic',
    'Codex · model stored-model · effort high',
    'Claude',
    'Yes'
  ])
  for (const node of screen.getByRole('region', { name: 'Providers' }).querySelectorAll('dd')) {
    expect(node.className).not.toContain('font-mono')
  }
  expect(screen.queryByRole('table')).toBeNull()
  view.rerender(<MissionProviders {...props} policy={PolicySchema.parse(policy)} />)
  expect(['planner', 'worker', 'disallowed', 'certified'].map(value)).toEqual([
    'Automatic',
    'Automatic',
    'None',
    'No'
  ])
  view.rerender(
    <MissionProviders
      {...props}
      policy={PolicySchema.parse({
        ...policy,
        routing: {
          roles: { planner: { model: 'text-only', effort: 'low' } },
          disallowedProviders: ['opencode', 'antigravity']
        }
      })}
    />
  )
  expect(value('planner')).toBe('Automatic · model text-only · effort low')
  expect(value('disallowed')).toBe('OpenCode, Antigravity')
})

it('offers no provider edit when the Mission is finished', () => {
  const view = render(<MissionProviders {...props} />)
  for (const status of TERMINAL_MISSION_STATUSES) {
    view.rerender(
      <MissionProviders {...props} mission={{ ...mission, status }} request={request} />
    )
    expect(screen.queryByRole('button', { name: 'Edit providers' })).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
    expect(value('worker')).toBe('Codex · model stored-model · effort high')
  }
})

it('shows the read error and no provider edit without a policy', () => {
  render(<MissionProviders {...props} policy={null} />)
  expect(
    screen.getByText("The Mission's policy could not be read. Refresh to try again.")
  ).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('definition')).toBeNull()
})

it('opens the provider form with the stored choices and closes it without a call', async () => {
  const view = render(<MissionProviders {...props} />)
  await click('Edit providers')
  expect(onEdit).toHaveBeenCalledTimes(1)
  view.rerender(<MissionProviders {...props} request={request} />)
  expect(selects().map((select) => select.value)).toEqual(['automatic', 'codex'])
  expect(Array.from(selects()[0].options, (option) => [option.value, option.text])).toEqual([
    ['automatic', 'Automatic'],
    ['codex', 'Codex'],
    ['claude', 'Claude'],
    ['opencode', 'OpenCode']
  ])
  expect(checkbox('Codex').getAttribute('aria-checked')).toBe('true')
  expect(checkbox('Claude').getAttribute('aria-checked')).toBe('false')
  expect(checkbox('Only certified combinations').getAttribute('aria-checked')).toBe('true')
  change(0, 'claude')
  await click('Close')
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(onSave).not.toHaveBeenCalled()
})

it('lists every answered provider in the availability table with its reasons', () => {
  render(<MissionProviders {...props} request={request} />)
  const table = screen.getByRole('table', { name: 'Provider availability' })
  expect(table.querySelector('caption')?.textContent).toBe(
    'Availability under the saved policy, read when this form opened. It does not change as you edit.'
  )
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
  ).toEqual(['Provider', 'Planner', 'Low-risk Tasks', 'Medium-risk Tasks', 'High-risk Tasks'])
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(providers.length)
  providers.forEach((entry, index) => {
    expect(rows[index].getAttribute('data-provider')).toBe(entry.provider)
    expect(within(rows[index]).getByRole('rowheader')).toBeTruthy()
    const slots = [entry.planner, entry.worker.low, entry.worker.medium, entry.worker.high]
    within(rows[index])
      .getAllByRole('cell')
      .forEach((cell, slotIndex) => {
        const copy = providerSlotCopy(slots[slotIndex])
        expect(cell.textContent).toBe(copy.gloss ? `${copy.value} ${copy.gloss}` : copy.value)
        if (copy.gloss) {
          expect(within(cell).getByText(copy.value).className).toContain('font-mono')
        }
      })
  })
  expect(table.parentElement?.className).toContain('scrollbar-sleek')
})

it('says that availability is being read and then that it could not be read', () => {
  const view = render(
    <MissionProviders {...props} request={{ ...request, providers: undefined }} />
  )
  expect(screen.getByText('Reading which providers can be used…').getAttribute('role')).toBe(
    'status'
  )
  expect(screen.queryByRole('table')).toBeNull()
  view.rerender(<MissionProviders {...props} request={{ ...request, providers: null }} />)
  expect(
    screen.getByText(
      'Provider availability could not be read. Only the providers named in the saved policy are listed.'
    )
  ).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
  expect(Array.from(selects()[0].options, (option) => option.value)).toEqual([
    'automatic',
    'codex',
    'claude'
  ])
})

it('hints when the chosen role provider is not eligible everywhere', () => {
  render(<MissionProviders {...props} request={request} />)
  expect(screen.getAllByText(hint)).toHaveLength(1)
  expect(selects()[1].parentElement?.contains(screen.getByText(hint))).toBe(true)
  change(1, 'automatic')
  expect(screen.queryByText(hint)).toBeNull()
  change(0, 'claude')
  expect(screen.getAllByText(hint)).toHaveLength(1)
  expect(selects()[0].parentElement?.contains(screen.getByText(hint))).toBe(true)
  cleanup()
  render(
    <MissionProviders
      {...props}
      policy={PolicySchema.parse({
        ...stored,
        routing: { roles: { planner: { provider: 'antigravity' } } }
      })}
      request={request}
    />
  )
  expect(screen.queryByText(hint)).toBeNull()
})

it('disables saving until a provider field changed and while the page is busy', async () => {
  const view = render(<MissionProviders {...props} busy />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit providers' }).disabled).toBe(
    true
  )
  view.rerender(<MissionProviders {...props} request={request} />)
  expect(saveDisabled()).toBe(true)
  change(1, 'claude')
  expect(saveDisabled()).toBe(false)
  change(1, 'codex')
  expect(saveDisabled()).toBe(true)
  change(1, 'claude')
  view.rerender(<MissionProviders {...props} request={request} busy />)
  for (const select of selects()) {
    expect(select.disabled).toBe(true)
  }
  for (const control of screen.getAllByRole<HTMLButtonElement>('checkbox')) {
    expect(control.disabled).toBe(true)
  }
  for (const control of screen.getAllByRole<HTMLButtonElement>('button')) {
    expect(control.disabled).toBe(true)
  }
  await click('Save providers')
  expect(onSave).not.toHaveBeenCalled()
  view.rerender(<MissionProviders {...props} request={request} policy={null} />)
  expect(selects()[1].value).toBe('claude')
  expect(
    screen.getByText("The Mission's policy could not be read. Refresh to try again.")
  ).toBeTruthy()
  expect(saveDisabled()).toBe(true)
  view.rerender(<MissionProviders {...props} request={request} mission={{ ...mission, id: '' }} />)
  expect(saveDisabled()).toBe(true)
  const parsed = PolicyUpdateParams.safeParse({ missionId: '', patch: {} })
  if (parsed.success) {
    throw new Error('Expected invalid Mission id')
  }
  const message = parsed.error.issues[0]?.message
  if (!message) {
    throw new Error('Expected schema message')
  }
  expect(screen.getByText(message).className).toContain('font-mono')
  view.rerender(<MissionProviders {...props} request={request} />)
  expect(saveDisabled()).toBe(false)
})

it('names the changed provider fields when it hands over a save', async () => {
  render(<MissionProviders {...props} request={request} />)
  fireEvent.click(checkbox('Only certified combinations'))
  fireEvent.click(checkbox('Claude'))
  fireEvent.click(checkbox('OpenCode'))
  change(1, 'automatic')
  change(0, 'claude')
  await click('Save providers')
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    PolicyUpdateParams.parse({
      missionId: mission.id,
      patch: {
        routing: {
          ...stored.routing,
          roles: {
            planner: { provider: 'claude' },
            worker: { model: 'stored-model', effort: 'high' }
          },
          disallowedProviders: ['opencode'],
          requireCertified: false
        }
      }
    }),
    `This changes: Planner, Workers, Allowed providers, Only certified combinations. ${applies}`
  )
})

it('keeps the provider form open when the save is not accepted', async () => {
  render(<MissionProviders {...props} request={request} />)
  change(0, 'codex')
  await click('Save providers')
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('form', { name: 'Edit the providers of this Mission' })).toBeTruthy()
  expect(selects()[0].value).toBe('codex')
  onSave.mockResolvedValueOnce(true)
  await click('Save providers')
  expect(onSave).toHaveBeenCalledTimes(2)
  expect(onClose).toHaveBeenCalledTimes(1)
})
