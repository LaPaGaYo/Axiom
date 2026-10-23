import { vi, type Mock } from 'vitest'
import type * as LocalCommandResolver from '../command-path-resolver'
import type { ProcessSpec } from '@orca/process-host/process-spec'

const {
  handleMock,
  execFileMock,
  execFileAsyncMock,
  runWslProcessMock,
  hydrateShellPathMock,
  mergePathSegmentsMock,
  getBitbucketAuthStatusMock,
  getAzureDevOpsAuthStatusMock,
  getGiteaAuthStatusMock,
  resolveCliCommandsMock,
  isCommandOnLocalPathMock,
  listLocalCommandPathsMock,
  mergePersistedWindowsPathAsyncMock,
  mergePersistedWindowsPathMock
} = vi.hoisted(() => {
  // Keep exported mock types on Vitest's public API during declaration checking.
  const mock = (): Mock => vi.fn()
  return {
    handleMock: mock(),
    execFileMock: mock(),
    execFileAsyncMock: mock(),
    runWslProcessMock: mock(),
    hydrateShellPathMock: mock(),
    mergePathSegmentsMock: mock(),
    getBitbucketAuthStatusMock: mock(),
    getAzureDevOpsAuthStatusMock: mock(),
    getGiteaAuthStatusMock: mock(),
    resolveCliCommandsMock: mock(),
    isCommandOnLocalPathMock: mock(),
    listLocalCommandPathsMock: mock(),
    mergePersistedWindowsPathAsyncMock: mock(),
    mergePersistedWindowsPathMock: mock()
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock
  }
}))

vi.mock('child_process', () => {
  const execFileWithPromisify = Object.assign(execFileMock, {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock
  })
  return {
    execFile: execFileWithPromisify,
    spawn: vi.fn()
  }
})

vi.mock('@orca/process-host', () => ({
  runProcess: async (spec: ProcessSpec) => ({
    ...(await execFileAsyncMock(spec.program, spec.args, {
      encoding: 'utf-8',
      timeout: spec.timeoutMs,
      windowsHide: true,
      ...(spec.env ? { env: spec.env } : {})
    })),
    code: 0,
    timedOut: false
  })
}))

// WSL commands now route through the runner, not execFile('wsl.exe', ...).
vi.mock('../../wsl/wsl-runner', () => ({ runWslProcess: runWslProcessMock }))

vi.mock('../../startup/hydrate-shell-path', () => ({
  hydrateShellPath: hydrateShellPathMock,
  mergePathSegments: mergePathSegmentsMock
}))

vi.mock('../../../shared/node-cli-command-resolution', () => ({
  resolveCliCommands: resolveCliCommandsMock
}))

// Why (#9297): local PATH resolution is now fs-based (no where/which spawn).
// These tests express "which commands are on PATH" via the where/which mock,
// so route the resolver through that same mock to preserve their intent.
vi.mock('../command-path-resolver', async (importOriginal) => ({
  ...(await importOriginal<typeof LocalCommandResolver>()),
  isCommandOnLocalPath: isCommandOnLocalPathMock,
  listLocalCommandPaths: listLocalCommandPathsMock
}))

vi.mock('../../pty/windows-environment-path', () => ({
  mergePersistedWindowsPathAsync: mergePersistedWindowsPathAsyncMock,
  mergePersistedWindowsPath: mergePersistedWindowsPathMock
}))

vi.mock('../../bitbucket/client', () => ({
  getBitbucketAuthStatus: getBitbucketAuthStatusMock
}))

vi.mock('../../azure-devops/client', () => ({
  getAzureDevOpsAuthStatus: getAzureDevOpsAuthStatusMock
}))

vi.mock('../../gitea/client', () => ({
  getGiteaAuthStatus: getGiteaAuthStatusMock
}))

export {
  handleMock,
  execFileMock,
  execFileAsyncMock,
  runWslProcessMock,
  hydrateShellPathMock,
  mergePathSegmentsMock,
  getBitbucketAuthStatusMock,
  getAzureDevOpsAuthStatusMock,
  getGiteaAuthStatusMock,
  resolveCliCommandsMock,
  isCommandOnLocalPathMock,
  listLocalCommandPathsMock,
  mergePersistedWindowsPathAsyncMock,
  mergePersistedWindowsPathMock
}
