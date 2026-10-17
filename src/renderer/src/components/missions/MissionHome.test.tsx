// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import { mission, goal } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { MissionHome } from './MissionHome'

const container = document.createElement('div')
const root = createRoot(container)
afterEach(() => act(() => root.render(null)))

const terminal = ['COMPLETED', 'FAILED', 'CANCELED']
describe('MissionHome', () => {
  it.each(MISSION_STATUSES)('admits only legal actions for %s', (status) => {
    const onAction = vi.fn()
    act(() =>
      root.render(
        <TooltipProvider>
          <MissionHome
            mission={{ ...mission, status }}
            goal={null}
            tasks={[]}
            proposedPlans={0}
            busy={false}
            onAction={onAction}
          />
        </TooltipProvider>
      )
    )
    const expected = [
      status === 'PLANNED',
      !terminal.includes(status) && status !== 'PAUSED',
      status === 'PAUSED',
      !terminal.includes(status)
    ]
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons).toHaveLength(4)
    buttons.forEach((button, i) => {
      expect(button.getAttribute('aria-disabled')).toBe(String(!expected[i]))
      act(() => button.click())
    })
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(
      ['start', 'pause', 'resume', 'cancel'].filter((_, i) => expected[i])
    )
  })
  it('shows the active Goal, suspension reason and integrated-only progress', () => {
    act(() =>
      root.render(
        <TooltipProvider>
          <MissionHome
            mission={{ ...mission, status: 'PAUSED', reason: 'Budget review' }}
            goal={{ ...goal, id: 'g1', missionId: mission.id, revision: 1, status: 'ACTIVE' }}
            tasks={(['SUBMITTED', 'INTEGRATED', 'CANCELED'] as const).map((stage) => ({
              id: stage,
              missionId: mission.id,
              planRevisionId: 'p',
              title: stage,
              stage,
              orcaStatus: 'completed'
            }))}
            proposedPlans={1}
            busy
            onAction={vi.fn()}
          />
        </TooltipProvider>
      )
    )
    expect(container.textContent).toContain(goal.objective)
    expect(container.textContent).toContain('Checks pass')
    expect(container.textContent).toContain('Budget review')
    expect(container.querySelector('[data-testid="mission-progress"]')?.textContent).toBe(
      '1 / 3 Tasks integrated'
    )
    expect(
      Array.from(container.querySelectorAll('button')).every(
        (button) => button.getAttribute('aria-disabled') === 'true'
      )
    ).toBe(true)
  })
})
