import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './updater-test-module-loader'

const {
  appMock,
  autoUpdaterMock,
  fetchNudgeMock,
  fetchNewerReleaseTagsMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () => (await import('./updater-test-harness')).createUpdaterMocks())

vi.mock('electron', async () => ({
  ...moduleFactories.electron(),
  powerMonitor: new (await import('node:events')).EventEmitter(),
  BrowserWindow: class {
    webContents = { send: vi.fn() }
    static getAllWindows() {
      return []
    }
  }
}))
import { BrowserWindow, powerMonitor } from 'electron'
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('@electron-toolkit/utils', () => moduleFactories.electronToolkitUtils())
vi.mock('./ipc/pty', () => moduleFactories.ipcPty())
vi.mock('./linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./updater-nudge', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('./local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

warmUpdaterModule()

describe('shipped updater policy', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.useFakeTimers()
  })

  it.each([null, 0, Date.now()])(
    'never schedules startup or wake checks with last check %s',
    async (lastCheck) => {
      const { setupAutoUpdater, checkForUpdates } = await loadUpdaterModule()
      setupAutoUpdater(new BrowserWindow(), { getLastUpdateCheckAt: () => lastCheck })
      appMock.emit('browser-window-focus')
      powerMonitor.emit('resume')
      expect(powerMonitor.listenerCount('resume')).toBe(0)
      expect(appMock.on).not.toHaveBeenCalledWith('browser-window-focus', expect.any(Function))
      checkForUpdates()
      await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
      expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
      expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
      expect(fetchNudgeMock).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('checks the product feed from the menu without arming subsequent background checks', async () => {
    const { setupAutoUpdater, checkForUpdatesFromMenu } = await loadUpdaterModule()
    setupAutoUpdater(new BrowserWindow())
    autoUpdaterMock.checkForUpdates.mockImplementation(() => {
      autoUpdaterMock.emit('checking-for-update')
      autoUpdaterMock.emit('update-not-available', { version: '1.0.51' })
      return Promise.resolve(null)
    })
    checkForUpdatesFromMenu()
    await vi.advanceTimersByTimeAsync(0)
    expect(autoUpdaterMock.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/LaPaGaYo/Axiom/releases/latest/download'
    })
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
