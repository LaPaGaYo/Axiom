// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import {
  mission,
  goal,
  attempt,
  message
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
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
            attempts={[]}
            pendingMessages={[]}
            onSelectTask={vi.fn()}
            proposedPlans={0}
            busy={false}
            onAction={onAction}
          />
        </TooltipProvider>
      )
    )
    const expected = [
      status === 'ANALYZING',
      status === 'PLANNED',
      !terminal.includes(status) && status !== 'PAUSED',
      status === 'PAUSED',
      !terminal.includes(status)
    ]
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons).toHaveLength(5)
    buttons.forEach((button, i) => {
      expect(button.getAttribute('aria-disabled')).toBe(String(!expected[i]))
      act(() => button.click())
    })
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(
      ['plan', 'start', 'pause', 'resume', 'cancel'].filter((_, i) => expected[i])
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
            attempts={[]}
            pendingMessages={[]}
            onSelectTask={vi.fn()}
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
  it('counts Workers separately, exposes pending Task jumps and disables duplicate planning', () => {
    const onSelectTask = vi.fn()
    act(() =>
      root.render(
        <TooltipProvider>
          <MissionHome
            mission={{ ...mission, status: 'ANALYZING' }}
            goal={null}
            tasks={[]}
            attempts={[
              attempt,
              { ...attempt, attemptId: 'planner', role: 'planner', state: 'RUNNING' }
            ]}
            pendingMessages={[message]}
            proposedPlans={0}
            busy={false}
            onAction={vi.fn()}
            onSelectTask={onSelectTask}
          />
        </TooltipProvider>
      )
    )
    expect(container.textContent).toContain('0 running / 1 submitted')
    expect(container.textContent).toContain('Planner in progress')
    expect(container.textContent).toContain('1 pending item(s)')
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(
      buttons.find((b) => b.textContent === 'Start Planner')?.getAttribute('aria-disabled')
    ).toBe('true')
    act(() => buttons.find((b) => b.textContent?.includes(message.summary))?.click())
    expect(onSelectTask).toHaveBeenCalledWith(message.taskId)
  })
  it('shows execution counts and prevents planning while a proposal awaits review', () => {
    const props = {
      goal: null,
      tasks: [],
      pendingMessages: [],
      busy: false,
      onSelectTask: vi.fn(),
      onAction: vi.fn(),
      attempts: [
        attempt,
        { ...attempt, attemptId: 'running', state: 'RUNNING' as const },
        { ...attempt, attemptId: 'planner', role: 'planner' as const }
      ]
    }
    act(() =>
      root.render(
        <TooltipProvider>
          <MissionHome {...props} mission={{ ...mission, status: 'EXECUTING' }} proposedPlans={0} />
        </TooltipProvider>
      )
    )
    expect(container.textContent).toContain(
      '1 Attempt(s) running, 1 submitted — verification arrives in M3.'
    )
    act(() =>
      root.render(
        <TooltipProvider>
          <MissionHome {...props} mission={{ ...mission, status: 'ANALYZING' }} proposedPlans={1} />
        </TooltipProvider>
      )
    )
    expect(
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'Start Planner')
        ?.getAttribute('aria-disabled')
    ).toBe('true')
  })
})
