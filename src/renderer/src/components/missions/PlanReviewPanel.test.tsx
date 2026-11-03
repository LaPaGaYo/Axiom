// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { makeProposal } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { PlanRevisionSchema } from '../../../../shared/axiom-contract/mission-objects'
import { PlanReviewPanel } from './PlanReviewPanel'

const container = document.createElement('div')
const root = createRoot(container)
afterEach(() => act(() => root.render(null)))
it('shows command, Artifact, human and legacy criteria with their proof kinds', () => {
  const proposal = makeProposal()
  const plan = PlanRevisionSchema.parse({
    ...proposal,
    id: 'p',
    missionId: 'm',
    revision: 1,
    status: 'PROPOSED',
    tasks: [
      {
        ...proposal.tasks[0],
        acceptanceCriteria: [
          { text: 'Tests pass', check: { kind: 'command', command: 'pnpm test' } },
          { text: 'Report is readable', check: { kind: 'artifact' } },
          { text: 'Visual judgment', check: { kind: 'human' } },
          'Legacy criterion'
        ]
      }
    ]
  })
  act(() =>
    root.render(<PlanReviewPanel plan={plan} busy={false} onApprove={vi.fn()} onReject={vi.fn()} />)
  )
  expect(container.textContent).toContain('Tests pass')
  expect(container.querySelector('code')?.textContent).toBe('pnpm test')
  expect(container.textContent).toContain('Report is readable')
  expect(container.textContent).toContain('Artifact')
  expect(container.textContent).toContain('Visual judgment')
  expect(container.textContent).toContain('Legacy criterion')
  expect(container.textContent?.match(/Human check/g)).toHaveLength(2)
})
