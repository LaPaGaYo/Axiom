// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { StarNagCard } from '../StarNagCard'
import { StarNagToastHost } from './StarNagToastHost'
import { StarNagAgentValueMomentObserver } from './StarNagAgentValueMomentObserver'
import { GeneralSupportSection } from '../settings/GeneralSupportSection'
import { useLandingOrcaStarState } from '../landing-github-star-state'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    vi.fn(() => 0),
    {
      getState: () => ({ agentStatusByPaneKey: {} })
    }
  )
}))

it('mounts no nag UI or listeners when the policy disables stars', () => {
  const onShow = vi.fn(() => vi.fn())
  const onHide = vi.fn(() => vi.fn())
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { starNag: { onShow, onHide } }
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() =>
    root.render(
      <>
        <StarNagCard />
        <StarNagToastHost />
        <StarNagAgentValueMomentObserver />
      </>
    )
  )
  expect(container.childElementCount).toBe(0)
  expect(onShow).not.toHaveBeenCalled()
  expect(onHide).not.toHaveBeenCalled()
  act(() => root.unmount())
})

it('hides landing and settings star invitations without probing GitHub', () => {
  const checkOrcaStarred = vi.fn().mockResolvedValue(null)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { gh: { checkOrcaStarred } }
  })
  function LandingStarState(): React.JSX.Element {
    const [state] = useLandingOrcaStarState()
    return <span>{state}</span>
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() =>
    root.render(
      <>
        <LandingStarState />
        <GeneralSupportSection hasPrecedingSections />
      </>
    )
  )
  expect(container.textContent).toBe('hidden')
  expect(container.querySelector('section')).toBeNull()
  expect(checkOrcaStarred).not.toHaveBeenCalled()
  act(() => root.unmount())
})
