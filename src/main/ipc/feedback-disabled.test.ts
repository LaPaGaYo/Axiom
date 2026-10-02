import { beforeEach, describe, expect, it, vi } from 'vitest'
const { fetchMock, getVersionMock, handlers } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  getVersionMock: vi.fn(),
  handlers: new Map<string, (_event: unknown, args: unknown) => unknown>()
}))
vi.mock('electron', () => ({
  net: { fetch: fetchMock },
  app: { getVersion: getVersionMock },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: (name: string, handler: (_event: unknown, args: unknown) => unknown) =>
      handlers.set(name, handler)
  }
}))
import { registerFeedbackHandlers, submitFeedback } from './feedback'
const failure = {
  ok: false,
  status: null,
  reason: 'disabled',
  error: 'Feedback submission is disabled.'
}
const args = { feedback: 'report', githubLogin: null, githubEmail: null }
describe('disabled feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
  })
  it.each(['feedback', 'crash'] as const)(
    'refuses %s before building a body or fetching',
    async (submissionType) => {
      await expect(submitFeedback({ ...args, submissionType })).resolves.toEqual(failure)
      expect(getVersionMock).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )
  it('refuses direct IPC invocations', async () => {
    registerFeedbackHandlers()
    await expect(handlers.get('feedback:submit')?.({}, args)).resolves.toEqual(failure)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
