// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AgentIcon, getAgentCatalog } from './agent-catalog'
import { AGENT_FAVICON_ASSETS } from './agent-favicon-assets'
import { getOpenInAppPresets, OpenInApplicationIcon } from './open-in-app-catalog'

afterEach(cleanup)

it('renders the entire agent picker without remote images', () => {
  const { container } = render(
    <>
      {getAgentCatalog().map(({ id }) => (
        <AgentIcon key={id} agent={id} />
      ))}
    </>
  )
  for (const image of container.querySelectorAll('img')) {
    expect(image.getAttribute('src')).not.toMatch(/^https?:\/\//)
  }
  const { container: codebuddy } = render(<AgentIcon agent="codebuddy" />)
  expect(codebuddy.querySelector('img')?.getAttribute('src')).toBe(AGENT_FAVICON_ASSETS.codebuddy)
})

it('uses the bundled Cursor icon and local fallback for other editor presets', () => {
  for (const preset of getOpenInAppPresets()) {
    const { container } = render(<OpenInApplicationIcon application={preset} />)
    if (preset.id === 'cursor') {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(AGENT_FAVICON_ASSETS.cursor)
    } else {
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('svg')).not.toBeNull()
    }
  }
})
