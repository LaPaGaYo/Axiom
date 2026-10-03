import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHarness,
  createIpcHandlerLookup,
  resetStarNagMocks,
  type TestWindow
} from './service-test-harness'

const mocks = vi.hoisted(() => ({
  appMock: {
    getVersion: vi.fn(() => '1.2.3')
  },
  browserWindowMock: {
    getAllWindows: vi.fn<() => TestWindow[]>(() => [])
  },
  checkOrcaStarredMock: vi.fn(),
  starOrcaMock: vi.fn(),
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn(() => ({ nth_repo_added: 3 })),
  ipcMainHandleMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: mocks.appMock,
  BrowserWindow: mocks.browserWindowMock,
  ipcMain: {
    handle: mocks.ipcMainHandleMock
  }
}))

vi.mock('../github/client', () => ({
  checkOrcaStarred: mocks.checkOrcaStarredMock,
  starOrca: mocks.starOrcaMock
}))

vi.mock('../telemetry/client', () => ({
  track: mocks.trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: mocks.getCohortAtEmitMock
}))

const getIpcHandler = createIpcHandlerLookup(mocks.ipcMainHandleMock)

beforeEach(() => resetStarNagMocks(mocks))

describe('disabled star nag', () => {
  it('registers no agent trigger and keeps existing IPC calls inert', async () => {
    const { service, store, onAgentStarted, emitAgentStarted } = createHarness()
    service.start()
    service.registerIpcHandlers()
    emitAgentStarted(1000)
    expect(onAgentStarted).not.toHaveBeenCalled()
    expect(await getIpcHandler('star-nag:agentValueMoment')()).toEqual({ status: 'skipped' })
    expect(await getIpcHandler('star-nag:starOrca')()).toBe(false)
    for (const channel of [
      'dismiss',
      'later',
      'complete',
      'disable',
      'openWeb',
      'forceShow',
      'showAgentValueMoment',
      'onboardingCompleted'
    ]) {
      await getIpcHandler(`star-nag:${channel}`)()
    }
    expect(mocks.checkOrcaStarredMock).not.toHaveBeenCalled()
    expect(mocks.starOrcaMock).not.toHaveBeenCalled()
    expect(mocks.browserWindowMock.getAllWindows).not.toHaveBeenCalled()
    expect(store.getUI).not.toHaveBeenCalled()
    expect(store.updateUI).not.toHaveBeenCalled()
    service.stop()
  })
})
