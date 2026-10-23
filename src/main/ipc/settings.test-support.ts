import { vi, type Mock } from 'vitest'

export const settingsInvokeEvent = { sender: { id: 1 } }
export type SettingsChangedListener = (
  updates: unknown,
  settings: unknown,
  originWebContentsId?: number
) => void

// Keep exported mock types on Vitest's public API during declaration checking.
const mock = (): Mock => vi.fn()

export const store = {
  getSettings: mock(),
  updateSettings: mock(),
  updateSettingsAndFlush: mock(),
  getGitHubCache: mock(),
  setGitHubCache: mock(),
  onSettingsChanged: vi.fn(() => () => {})
}
